"""HSP payment orchestration: Cart Mandate/order creation, status sync, settlement verification, webhooks.

Lifecycle (internal state <- official HSP status):
    AWAITING_SIGNATURE   payment-required   (order registered; the user signs in HSP checkout)
    SIGNED -> SUBMITTED  payment-submitted | payment-verified
    PENDING              payment-processing | payment-included | payment-safe
    SETTLED              only after verify_settlement() passes (gateway record + on-chain evidence + receipt row)
    FAILED               payment-failed

Money-safety rules enforced here:
  * the Cart Mandate is built from the intent's immutable snapshot after a full guardian re-validation
  * one HSP order per intent (deterministic ids + unique columns); an ambiguous create is never silently retried
  * a webhook body is only a trigger: state changes come from a fresh gateway query
  * payments that arrive for an intent we already closed (expired/cancelled/failed) are flagged, never ignored
"""

from __future__ import annotations

import hashlib
import logging
import uuid
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.errors import ConflictError, NotFoundError, UnprocessableError
from app.integrations.blockchain.client import ChainClient
from app.integrations.hsp.client import HSPClient
from app.integrations.hsp.exceptions import (
    HSPAmbiguousOutcomeError,
    HSPApiError,
    HSPAuthError,
    HSPNotConfiguredError,
    HSPUnavailableError,
)
from app.integrations.hsp.mandate import (
    build_order_request,
    cart_mandate_id_for,
    payment_request_id_for,
    resolve_token,
    validate_amount_rules,
)
from app.integrations.hsp.schemas import STATUS_RANK, TERMINAL_STATUSES, HSPPaymentRecord, HSPStatus
from app.integrations.hsp.verification import VerificationResult, verify_settlement
from app.integrations.hsp.webhooks import verify_webhook
from app.models import (
    HspPaymentFlow,
    HspWebhookEvent,
    PaymentIntent,
    PaymentReceipt,
    ProcurementRequest,
    Profile,
    Quotation,
    SpendingPolicy,
)
from app.models.enums import PaymentStatus as S
from app.payments.service import PaymentService, log_event
from app.payments.state_machine import VerifiedSettlement
from app.payments.validator import PaymentValidationError
from app.utils.common import as_utc, to_jsonable, utcnow

log = logging.getLogger("paymesh.hsp.service")

# order in which a successful payment walks the internal states
_PATH = [S.AWAITING_SIGNATURE, S.SIGNED, S.SUBMITTED, S.PENDING]
_ACTIVE_FOR_SYNC = (S.AWAITING_SIGNATURE, S.SIGNED, S.SUBMITTED, S.PENDING)
_CLOSED = (S.EXPIRED, S.CANCELLED, S.FAILED)
LATE_PAYMENT_GRACE = timedelta(hours=2)


def target_state(hsp_status: str) -> S | None:
    """Internal state implied by an official HSP status (None = no movement; failed handled separately)."""
    rank = STATUS_RANK.get(hsp_status)
    if rank is None or rank == 0:
        return None
    if rank <= 2:
        return S.SUBMITTED
    return S.PENDING


class HSPPaymentService:
    def __init__(self, db: AsyncSession, settings: Settings, hsp: HSPClient, chain: ChainClient, payments: PaymentService):
        self.db = db
        self.s = settings
        self.hsp = hsp
        self.chain = chain
        self.payments = payments

    # ================================================================== helpers
    async def _flow(self, intent: PaymentIntent, *, for_update: bool = False) -> HspPaymentFlow | None:
        q = select(HspPaymentFlow).where(HspPaymentFlow.payment_intent_id == intent.id)
        if for_update:
            q = q.with_for_update()
        return (await self.db.execute(q)).scalar_one_or_none()

    async def get_intent_system(self, intent_id: uuid.UUID, *, for_update: bool = True) -> PaymentIntent:
        q = select(PaymentIntent).where(PaymentIntent.id == intent_id)
        if for_update:
            q = q.with_for_update(key_share=True)   # see PaymentService.get_owned
        intent = (await self.db.execute(q)).scalar_one_or_none()
        if intent is None:
            raise NotFoundError("Payment intent not found")
        return intent

    async def get_receipt(self, intent: PaymentIntent) -> PaymentReceipt | None:
        return (await self.db.execute(select(PaymentReceipt).where(PaymentReceipt.payment_intent_id == intent.id))).scalar_one_or_none()

    def _require_hsp(self) -> None:
        if not self.s.hsp_configured:
            raise HSPNotConfiguredError("HSP credentials are not configured (HSP_APP_KEY / HSP_APP_SECRET / merchant key)")
        mismatch = self.s.hsp_environment_error()
        if mismatch:
            raise ConflictError(mismatch, code="hsp_environment_mismatch")

    # ================================================================== 1. validate (dry run)
    async def validate(self, intent: PaymentIntent, user: Profile) -> dict[str, Any]:
        request = await self.db.get(ProcurementRequest, intent.request_id)
        quotation = await self.db.get(Quotation, intent.quotation_id)
        policy = (await self.db.execute(select(SpendingPolicy).where(SpendingPolicy.user_id == user.id))).scalar_one_or_none()
        failures: list[dict[str, str]] = []
        try:
            fresh = await self.payments.guardian.validate(
                user=user, request=request, quotation=quotation, policy=policy, exclude_intent_id=intent.id  # type: ignore[arg-type]
            )
            if (fresh.amount, fresh.asset, fresh.chain_id, fresh.recipient.lower()) != (
                intent.amount, intent.asset, intent.chain_id, intent.recipient.lower()
            ):
                failures.append({"rule": "conditions_changed", "message": "Live conditions differ from the immutable snapshot"})
        except PaymentValidationError as exc:
            failures.extend(exc.details)
        try:
            resolve_token(intent.conditions_snapshot, self.s)
        except UnprocessableError as exc:
            failures.append({"rule": exc.code, "message": exc.message})
        return {"payment_intent_id": str(intent.id), "status": intent.status, "valid": not failures,
                "failures": failures, "hsp_configured": self.s.hsp_configured}

    # ================================================================== 2. mandate (Cart Mandate -> HSP order)
    async def create_order(self, intent: PaymentIntent, user: Profile) -> HspPaymentFlow:
        flow = await self._flow(intent, for_update=True)
        if flow is not None and flow.order_state == "created":
            return flow  # idempotent
        if flow is not None and flow.order_state in ("creating", "create_uncertain"):
            raise ConflictError(
                "A previous order-creation attempt has an unknown outcome; to avoid a double order it will not be retried. "
                "Let the intent expire and create a new one, or contact support.", code="hsp_order_uncertain")
        if S(intent.status) is not S.AWAITING_SIGNATURE:
            raise ConflictError(f"Intent is {intent.status}; call /authorize first (must be AWAITING_SIGNATURE)", code="illegal_transition")
        self._require_hsp()

        # integrity + full re-validation immediately before anything leaves the system
        from app.payments.conditions import snapshot_hash

        if snapshot_hash(intent.conditions_snapshot) != intent.snapshot_hash:
            await self.payments._fail(intent, user, "snapshot_tampered")
            await self.db.commit()
            raise ConflictError("Payment conditions failed integrity check", code="snapshot_integrity")
        check = await self.validate(intent, user)
        if not check["valid"]:
            await self.payments._fail(intent, user, "revalidation_failed", check["failures"])
            await self.db.commit()
            raise PaymentValidationError([_rf(f) for f in check["failures"]])

        now = utcnow()
        cart_expiry = min(as_utc(intent.expires_at), now + timedelta(minutes=self.s.HSP_CART_EXPIRY_MINUTES))  # type: ignore[type-var]
        if cart_expiry <= now + timedelta(seconds=60):
            raise ConflictError("Payment window is too short; create a new intent", code="intent_expiring")
        body, meta = build_order_request(intent.conditions_snapshot, intent.id, self.s, cart_expiry=cart_expiry)
        validate_amount_rules(meta["contents"])

        if flow is None:
            flow = HspPaymentFlow(
                payment_intent_id=intent.id, mandate_reference=cart_mandate_id_for(intent.id),
                payment_request_id=payment_request_id_for(intent.id), cart_hash=meta["cart_hash"],
                cart_expiry=cart_expiry, merchant_jti=meta["jti"], order_state="creating",
            )
            self.db.add(flow)
        else:  # retry after a definitive create_failed
            flow.order_state, flow.cart_hash, flow.cart_expiry, flow.merchant_jti = "creating", meta["cart_hash"], cart_expiry, meta["jti"]
        await self.db.flush()
        await self.db.commit()  # persist intent-to-order link BEFORE the network call (no orphan orders)

        try:
            result = await self.hsp.create_order(body["cart_mandate"], body.get("redirect_url"))
        except HSPApiError as exc:
            # 40001 / 10004 mean the order (or id) already exists at HSP -> we cannot recover its URL: uncertain
            state = "create_uncertain" if exc.hsp_code in (40001, 10004) else "create_failed"
            await self._order_failed(intent, flow, state, exc)
            raise
        except HSPAuthError as exc:
            await self._order_failed(intent, flow, "create_failed", exc)
            raise
        except (HSPAmbiguousOutcomeError, HSPUnavailableError) as exc:
            await self._order_failed(intent, flow, "create_uncertain", exc)
            raise

        if result.payment_request_id != flow.payment_request_id:
            await self._order_failed(intent, flow, "create_uncertain", ValueError("payment_request_id mismatch"))
            raise ConflictError("HSP returned an unexpected order id", code="hsp_protocol_error")
        flow.payment_url = result.payment_url
        flow.order_state = "created"
        flow.gateway_status = HSPStatus.REQUIRED.value
        await log_event(self.db, "hsp_order_created", actor_id=user.id, payment_intent_id=intent.id,
                        data={"cart_mandate_id": flow.mandate_reference, "payment_request_id": flow.payment_request_id,
                              "cart_hash": flow.cart_hash, "cart_expiry": cart_expiry, "base_url": self.s.HSP_BASE_URL})
        return flow

    async def _order_failed(self, intent: PaymentIntent, flow: HspPaymentFlow, state: str, exc: Exception) -> None:
        flow.order_state = state
        await log_event(self.db, f"hsp_order_{state}", actor_id=None, payment_intent_id=intent.id,
                        data={"error": type(exc).__name__, "hsp_code": getattr(exc, "hsp_code", None)})
        await self.db.commit()

    # ================================================================== 3. signing data for the frontend
    async def signing_data(self, intent: PaymentIntent) -> dict[str, Any]:
        flow = await self._flow(intent)
        if flow is None or flow.order_state != "created" or not flow.payment_url:
            raise ConflictError("No HSP order yet; call /mandate first", code="no_hsp_order")
        if S(intent.status) in _CLOSED or S(intent.status) is S.SETTLED:
            raise ConflictError(f"Intent is {intent.status}; nothing to sign", code="illegal_transition")
        token = resolve_token(intent.conditions_snapshot, self.s)
        return {
            "mode": "hsp_hosted_checkout",
            "payment_url": flow.payment_url,
            "cart_mandate_id": flow.mandate_reference,
            "payment_request_id": flow.payment_request_id,
            "expires_at": as_utc(flow.cart_expiry).isoformat() if flow.cart_expiry else None,  # type: ignore[union-attr]
            "review": {
                "recipient": intent.recipient, "amount": format(intent.amount.normalize(), "f"), "asset": intent.asset,
                "chain_id": intent.chain_id, "token_address": token.address, "authorization_scheme": token.protocol,
                "snapshot_hash": intent.snapshot_hash, "provider_name": intent.conditions_snapshot.get("provider_name"),
            },
            "wallet": "MetaMask (or any wallet supported by the HSP checkout)",
            "instructions": [
                "Send the user to payment_url (redirect, new tab, or QR). The HSP checkout shows the order and asks the wallet for the EIP-712 signature.",
                "HSP builds and submits the PaymentMandate itself; PayMesh never sees or handles the signature.",
                "Poll GET /payments/intents/{id}/status (or rely on the webhook). The payment counts as settled only after POST /verify succeeds.",
            ],
        }

    # ================================================================== 4. sync from gateway
    async def sync(self, intent: PaymentIntent, *, force: bool = False, auto_verify: bool = True) -> dict[str, Any]:
        flow = await self._flow(intent, for_update=True)
        if flow is None or flow.order_state != "created":
            return self.status_view(intent, flow, None)
        status = S(intent.status)
        grace_over = flow.cart_expiry is not None and utcnow() > as_utc(flow.cart_expiry) + LATE_PAYMENT_GRACE  # type: ignore[operator]
        done = status is S.SETTLED or (status in _CLOSED and (flow.gateway_status in TERMINAL_STATUSES or grace_over))
        if done:
            return self.status_view(intent, flow, None)
        if not force and flow.last_polled_at and (utcnow() - as_utc(flow.last_polled_at)).total_seconds() < self.s.HSP_POLL_MIN_INTERVAL_SECONDS:  # type: ignore[operator]
            return self.status_view(intent, flow, None, throttled=True)
        self._require_hsp()
        record = await self.hsp.get_payment(payment_request_id=flow.payment_request_id)
        flow.last_polled_at = utcnow()
        if record is None:  # no payer activity yet
            return self.status_view(intent, flow, None)
        await self._apply_record(intent, flow, record, source="poll")
        if auto_verify and S(intent.status) in (S.SUBMITTED, S.PENDING) and STATUS_RANK.get(record.status, -1) >= STATUS_RANK[self.s.HSP_SETTLEMENT_MIN_STATUS]:
            await self._verify_locked(intent, flow, record, actor_id=None)
        return self.status_view(intent, flow, record)

    async def _apply_record(self, intent: PaymentIntent, flow: HspPaymentFlow, record: HSPPaymentRecord, *, source: str) -> bool:
        """Apply a gateway record to local state. Returns False if the record does not belong to this order."""
        snap = intent.conditions_snapshot
        token = resolve_token(snap, self.s)
        mismatches = []
        if record.payment_request_id not in (None, flow.payment_request_id):
            mismatches.append("payment_request_id")
        if record.content_id not in (None, flow.mandate_reference):
            mismatches.append("cart_mandate_id")
        if record.to_pay_address and record.to_pay_address.lower() != intent.recipient.lower():
            mismatches.append("recipient")
        if record.chain and record.chain != token.caip2:
            mismatches.append("chain")
        if record.token_address and record.token_address.lower() != token.address.lower():
            mismatches.append("token_address")
        if mismatches:
            await log_event(self.db, "hsp_record_mismatch", actor_id=None, payment_intent_id=intent.id,
                            data={"fields": mismatches, "source": source, "status": record.status})
            log.error("HSP record mismatch intent=%s fields=%s", intent.id, mismatches)
            return False

        previous = flow.gateway_status
        flow.gateway_status = record.status
        flow.raw_gateway_response = to_jsonable(record.model_dump(mode="json"))
        flow.last_event_at = utcnow()
        if record.flow_id and not flow.hsp_flow_reference:
            flow.hsp_flow_reference = record.flow_id
        if record.payer_address:
            flow.payer_address = record.payer_address
        if record.tx_signature and not flow.tx_hash:
            other = (await self.db.execute(select(HspPaymentFlow.id).where(
                HspPaymentFlow.tx_hash == record.tx_signature, HspPaymentFlow.id != flow.id))).first()
            if other is not None:
                await log_event(self.db, "hsp_tx_hash_reuse_detected", actor_id=None, payment_intent_id=intent.id,
                                data={"tx_hash": record.tx_signature})
            else:
                flow.tx_hash = record.tx_signature
        if previous != record.status:
            await log_event(self.db, "hsp_status_changed", actor_id=None, payment_intent_id=intent.id,
                            data={"from": previous, "to": record.status, "source": source})

        status = S(intent.status)
        if status in _CLOSED:
            if STATUS_RANK.get(record.status, 0) >= 1 and previous != record.status:
                await log_event(self.db, "payment_received_for_closed_intent", actor_id=None, payment_intent_id=intent.id,
                                data={"intent_status": status.value, "hsp_status": record.status, "tx_hash": record.tx_signature,
                                      "action_required": "manual review / refund"})
                log.critical("HSP payment activity on closed intent %s (%s)", intent.id, status.value)
            return True
        if status is S.SETTLED:
            return True

        if record.status == HSPStatus.FAILED.value:
            await self.payments._transition(intent, S.FAILED, actor_id=None, reason=f"hsp:{(record.status_reason or 'failed')[:200]}", internal=True)
            return True
        tgt = target_state(record.status)
        if tgt is not None:
            await self._advance(intent, tgt)
        return True

    async def _advance(self, intent: PaymentIntent, target: S) -> None:
        cur = S(intent.status)
        if cur not in _PATH or target not in _PATH:
            return
        for nxt in _PATH[_PATH.index(cur) + 1 : _PATH.index(target) + 1]:
            await self.payments._transition(intent, nxt, actor_id=None, internal=True)

    # ================================================================== 5. verification -> SETTLED
    async def verify(self, intent: PaymentIntent, *, actor_id: uuid.UUID | None) -> dict[str, Any]:
        flow = await self._flow(intent, for_update=True)
        if S(intent.status) is S.SETTLED:
            return await self.verification_view(intent)
        if flow is None or flow.order_state != "created":
            raise ConflictError("No HSP order for this intent", code="no_hsp_order")
        if S(intent.status) in _CLOSED:
            raise ConflictError(f"Intent is {intent.status}", code="illegal_transition")
        self._require_hsp()
        record = await self.hsp.get_payment(payment_request_id=flow.payment_request_id)   # fresh, authoritative
        flow.last_polled_at = utcnow()
        if record is None:
            raise ConflictError("HSP has no payment record for this order yet", code="payment_not_found")
        if not await self._apply_record(intent, flow, record, source="verify"):
            raise ConflictError("Gateway record does not match this order", code="hsp_record_mismatch")
        if S(intent.status) in _CLOSED:
            raise ConflictError(f"Intent is {intent.status}", code="illegal_transition")
        if S(intent.status) is S.AWAITING_SIGNATURE:
            raise ConflictError("The payer has not submitted a payment yet", code="payment_not_submitted")
        res = await self._verify_locked(intent, flow, record, actor_id=actor_id)
        view = await self.verification_view(intent)
        view["checks"] = res.details()["checks"]
        view["verified_now"] = res.ok
        return view

    async def _verify_locked(self, intent: PaymentIntent, flow: HspPaymentFlow, record: HSPPaymentRecord,
                             actor_id: uuid.UUID | None) -> VerificationResult:
        token = resolve_token(intent.conditions_snapshot, self.s)
        buyer = await self.db.get(Profile, intent.buyer_id)
        tx = record.tx_signature
        reused = False
        if tx:
            reused = (await self.db.execute(select(PaymentReceipt.id).where(
                PaymentReceipt.transaction_hash == tx, PaymentReceipt.payment_intent_id != intent.id))).first() is not None
            reused = reused or (await self.db.execute(select(HspPaymentFlow.id).where(
                HspPaymentFlow.tx_hash == tx, HspPaymentFlow.id != flow.id))).first() is not None
        res = await verify_settlement(
            settings=self.s, chain=self.chain, record=record, token=token, snapshot=intent.conditions_snapshot,
            cart_mandate_id=flow.mandate_reference, payment_request_id=flow.payment_request_id or "",
            buyer_wallet=buyer.wallet_address if buyer else None, tx_already_used_elsewhere=reused,
        )
        if not res.ok:
            await log_event(self.db, "payment_verification_failed", actor_id=actor_id, payment_intent_id=intent.id,
                            data={"failed": [c.as_dict() for c in res.failed], "hsp_status": record.status})
            return res

        status = S(intent.status)
        if status not in (S.SUBMITTED, S.PENDING):  # defensive: verification only settles in-flight payments
            return res
        reference = f"hsp:{flow.hsp_flow_reference or flow.payment_request_id}"
        receipt = PaymentReceipt(
            payment_intent_id=intent.id, receipt_reference=reference, transaction_hash=res.tx_hash,
            settlement_status=record.status, chain_id=intent.chain_id, token_address=token.address,
            payer_address=record.payer_address, recipient=intent.recipient, verified_amount=res.verified_amount,
            block_number=res.block_number, verification_details=to_jsonable(res.details()), verified_at=utcnow(),
        )
        try:
            async with self.db.begin_nested():
                self.db.add(receipt)
                await self.db.flush()
        except IntegrityError:
            await log_event(self.db, "receipt_reuse_blocked", actor_id=actor_id, payment_intent_id=intent.id,
                            data={"receipt_reference": reference, "tx_hash": res.tx_hash})
            res.ok = False
            res.checks.append(_failed("receipt_unique", "receipt/tx already attributed to another payment"))
            return res
        await self.payments.mark_settled(intent, VerifiedSettlement(reference, res.tx_hash, f"hsp_gateway:{record.status}+onchain:{self.s.HSP_ONCHAIN_CHECK}"))
        await log_event(self.db, "payment_settled_verified", actor_id=actor_id, payment_intent_id=intent.id,
                        data={"receipt_reference": reference, "tx_hash": res.tx_hash, "block": res.block_number,
                              "verified_amount": res.verified_amount})
        return res

    # ================================================================== views
    def status_view(self, intent: PaymentIntent, flow: HspPaymentFlow | None, record: HSPPaymentRecord | None,
                    throttled: bool = False) -> dict[str, Any]:
        return {
            "payment_intent_id": str(intent.id),
            "status": intent.status,
            "settled_and_verified": S(intent.status) is S.SETTLED,
            "hsp": None if flow is None else {
                "order_state": flow.order_state, "gateway_status": flow.gateway_status,
                "payment_request_id": flow.payment_request_id, "flow_id": flow.hsp_flow_reference,
                "tx_hash": flow.tx_hash, "payer_address": flow.payer_address,
                "cart_expiry": as_utc(flow.cart_expiry).isoformat() if flow.cart_expiry else None,  # type: ignore[union-attr]
                "last_polled_at": as_utc(flow.last_polled_at).isoformat() if flow.last_polled_at else None,  # type: ignore[union-attr]
            },
            "throttled": throttled,
            "note": "SETTLED means independently verified (gateway + chain). Gateway statuses before that are informational.",
        }

    async def verification_view(self, intent: PaymentIntent) -> dict[str, Any]:
        receipt = await self.get_receipt(intent)
        return {
            "payment_intent_id": str(intent.id), "status": intent.status,
            "settlement_verified": S(intent.status) is S.SETTLED and receipt is not None,
            "receipt_reference": receipt.receipt_reference if receipt else None,
            "transaction_hash": receipt.transaction_hash if receipt else None,
        }

    # ================================================================== webhooks
    async def ingest_webhook(self, raw: bytes, signature_header: str | None) -> dict[str, Any]:
        payload = verify_webhook(signature_header, raw, self.s.HSP_APP_SECRET)      # raises HSPWebhookError (401)
        digest = hashlib.sha256(raw).hexdigest()
        existing = (await self.db.execute(select(HspWebhookEvent).where(HspWebhookEvent.body_sha256 == digest).with_for_update())).scalar_one_or_none()
        if existing is not None and existing.outcome in ("processed", "ignored_unknown_order"):
            return {"code": 0, "duplicate": True}
        if existing is None:
            event = HspWebhookEvent(body_sha256=digest, payment_request_id=payload.payment_request_id[:200],
                                    status=payload.status[:64], payload=to_jsonable(payload.model_dump(mode="json")))
            try:
                async with self.db.begin_nested():
                    self.db.add(event)
                    await self.db.flush()
            except IntegrityError:  # concurrent identical delivery
                return {"code": 0, "duplicate": True}
        else:
            event = existing

        flow = (await self.db.execute(select(HspPaymentFlow).where(
            HspPaymentFlow.payment_request_id == payload.payment_request_id))).scalar_one_or_none()
        if flow is None:
            event.outcome, event.processed_at = "ignored_unknown_order", utcnow()
            return {"code": 0, "ignored": True}
        intent = await self.get_intent_system(flow.payment_intent_id)
        try:
            # The body is a hint: re-query the gateway (authoritative) and run the same pipeline as polling.
            await self.sync(intent, force=True)
        except Exception:
            event.outcome = "error"
            await self.db.commit()  # keep the error marker; HSP will retry the delivery
            raise
        event.outcome, event.processed_at = "processed", utcnow()
        await log_event(self.db, "hsp_webhook_processed", actor_id=None, payment_intent_id=intent.id,
                        data={"status_hint": payload.status})
        return {"code": 0}


def _rf(d: dict[str, str]):  # noqa: ANN202
    from app.payments.validator import RuleFailure

    return RuleFailure(d["rule"], d["message"])


def _failed(name: str, note: str):  # noqa: ANN202
    from app.integrations.hsp.verification import Check

    return Check(name, False, note=note)


_ = (datetime, uuid)
