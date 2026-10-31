"""Internal payment-intent management and audit logging.

No HSP network calls happen here (Step 1). The service creates *validated* intents with
immutable condition snapshots, walks them through the pre-signature states, and writes
an append-only audit trail.
"""

from __future__ import annotations

import logging
import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.errors import ConflictError, ForbiddenError, NotFoundError
from app.core.logging import request_id_var
from app.models import HspPaymentFlow, PaymentIntent, ProcurementRequest, Profile, Quotation, SpendingPolicy, TransactionEvent
from app.models.enums import PaymentStatus as S
from app.models.enums import ProcurementStatus
from app.payments.conditions import ValidatedConditions, snapshot_hash
from app.payments.state_machine import PRE_SUBMISSION, VerifiedSettlement, assert_transition
from app.payments.validator import PaymentGuardian, PaymentValidationError
from app.utils.common import as_utc, to_jsonable, utcnow

log = logging.getLogger(__name__)


async def log_event(
    db: AsyncSession,
    event_type: str,
    *,
    actor_id: uuid.UUID | None,
    payment_intent_id: uuid.UUID | None = None,
    data: dict[str, Any] | None = None,
) -> TransactionEvent:
    ev = TransactionEvent(
        payment_intent_id=payment_intent_id,
        actor_id=actor_id,
        event_type=event_type,
        event_data=to_jsonable(data or {}),
        request_id=request_id_var.get(),
    )
    db.add(ev)
    await db.flush()
    log.info("audit %s intent=%s actor=%s", event_type, payment_intent_id, actor_id)
    return ev


class PaymentService:
    def __init__(self, db: AsyncSession, settings: Settings):
        self.db = db
        self.settings = settings
        self.guardian = PaymentGuardian(db, settings)

    # ---------------------------------------------------------------- queries
    async def get_owned(self, intent_id: uuid.UUID, user: Profile, *, for_update: bool = False) -> PaymentIntent:
        q = select(PaymentIntent).where(PaymentIntent.id == intent_id)
        if for_update:
            # FOR NO KEY UPDATE: serializes writers but does not conflict with the FK checks of child inserts
            # (audit events, HSP flows, receipts) -- plain FOR UPDATE deadlocks against them.
            q = q.with_for_update(key_share=True)
        intent = (await self.db.execute(q)).scalar_one_or_none()
        # Same response for "missing" and "someone else's" to avoid ID probing.
        if intent is None or intent.buyer_id != user.id:
            raise NotFoundError("Payment intent not found")
        await self._expire_if_due(intent)
        return intent

    async def get_system(self, intent_id: uuid.UUID) -> PaymentIntent:
        """Load without an ownership check. ONLY for callers that perform their own authorization (provider/system)."""
        intent = await self.db.get(PaymentIntent, intent_id)
        if intent is None:
            raise NotFoundError("Payment intent not found")
        return intent

    async def _expire_if_due(self, intent: PaymentIntent) -> None:
        if S(intent.status) in PRE_SUBMISSION and as_utc(intent.expires_at) <= utcnow():
            await self._transition(intent, S.EXPIRED, actor_id=None, reason="expired", internal=True)

    async def expire_stale(self) -> int:
        """Sweeper entry point (call from a scheduler). Returns number of expired intents."""
        rows = (
            await self.db.execute(
                select(PaymentIntent).where(
                    PaymentIntent.status.in_([s.value for s in PRE_SUBMISSION]),
                    PaymentIntent.expires_at <= utcnow(),
                )
            )
        ).scalars().all()
        for intent in rows:
            await self._transition(intent, S.EXPIRED, actor_id=None, reason="expired", internal=True)
        return len(rows)

    # ---------------------------------------------------------------- transitions
    async def _transition(
        self,
        intent: PaymentIntent,
        to: S,
        *,
        actor_id: uuid.UUID | None,
        reason: str | None = None,
        internal: bool = False,
        settlement: VerifiedSettlement | None = None,
    ) -> None:
        src = S(intent.status)
        assert_transition(src, to, internal=internal, settlement=settlement)
        intent.status = to.value
        if reason and to in (S.FAILED, S.EXPIRED, S.CANCELLED):
            intent.failure_reason = reason
        await log_event(
            self.db,
            f"payment_{to.value.lower()}",
            actor_id=actor_id,
            payment_intent_id=intent.id,
            data={"from": src.value, "to": to.value, "reason": reason},
        )
        if to in (S.EXPIRED, S.CANCELLED, S.FAILED):
            req = await self.db.get(ProcurementRequest, intent.request_id)
            if req and req.status == ProcurementStatus.PAYMENT_PENDING.value:
                req.status = ProcurementStatus.SELECTED.value

    # ---------------------------------------------------------------- commands
    async def create_intent(
        self,
        user: Profile,
        request_id: uuid.UUID,
        quotation_id: uuid.UUID | None,
        idempotency_key: str | None,
    ) -> tuple[PaymentIntent, bool]:
        """Returns (intent, created). Idempotent on (buyer, key)."""
        request = await self.db.get(ProcurementRequest, request_id)
        if request is None or request.buyer_id != user.id:
            raise NotFoundError("Procurement request not found")
        qid = quotation_id or request.selected_quotation_id
        if qid is None:
            raise ConflictError("No provider has been selected for this request", code="no_selection")
        quotation = await self.db.get(Quotation, qid)
        if quotation is None or quotation.request_id != request.id:
            raise NotFoundError("Quotation not found for this request")

        key = (idempotency_key or f"{request.id}:{quotation.id}")[:128]
        existing = (
            await self.db.execute(
                select(PaymentIntent).where(PaymentIntent.buyer_id == user.id, PaymentIntent.idempotency_key == key)
            )
        ).scalar_one_or_none()
        if existing is not None:
            if existing.request_id != request.id or existing.quotation_id != quotation.id:
                raise ConflictError("Idempotency key was used for a different payment", code="idempotency_conflict")
            await self._expire_if_due(existing)
            return existing, False

        # Serialize concurrent intent creation per user so the daily-limit check is race-free.
        policy = (
            await self.db.execute(select(SpendingPolicy).where(SpendingPolicy.user_id == user.id).with_for_update())
        ).scalar_one_or_none()

        try:
            conditions = await self.guardian.validate(user=user, request=request, quotation=quotation, policy=policy)
        except PaymentValidationError as exc:
            await log_event(
                self.db,
                "payment_validation_rejected",
                actor_id=user.id,
                data={"request_id": request.id, "quotation_id": quotation.id, "failures": exc.details},
            )
            await self.db.commit()  # persist the audit record even though the request fails
            raise

        snapshot = conditions.snapshot()
        intent = PaymentIntent(
            request_id=request.id,
            quotation_id=quotation.id,
            buyer_id=user.id,
            provider_agent_id=conditions.provider_agent_id,
            amount=conditions.amount,
            asset=conditions.asset,
            chain_id=conditions.chain_id,
            recipient=conditions.recipient,
            status=S.DRAFT.value,
            conditions_snapshot=snapshot,
            snapshot_hash=snapshot_hash(snapshot),
            idempotency_key=key,
            expires_at=conditions.expires_at,
        )
        try:
            async with self.db.begin_nested():
                self.db.add(intent)
                await self.db.flush()
        except IntegrityError as exc:
            raise ConflictError(
                "An active payment already exists for this quotation", code="duplicate_payment"
            ) from exc

        await log_event(self.db, "payment_intent_created", actor_id=user.id, payment_intent_id=intent.id,
                        data={"snapshot_hash": intent.snapshot_hash})
        await self._transition(intent, S.VALIDATED, actor_id=user.id, internal=True)
        request.status = ProcurementStatus.PAYMENT_PENDING.value
        return intent, True

    async def authorize(self, intent_id: uuid.UUID, user: Profile) -> tuple[PaymentIntent, dict[str, Any]]:
        """VALIDATED -> AWAITING_SIGNATURE after a full re-validation. Produces the review payload."""
        intent = await self.get_owned(intent_id, user, for_update=True)
        if S(intent.status) is not S.VALIDATED:
            raise ConflictError(f"Cannot request authorization from status {intent.status}", code="illegal_transition")

        # Snapshot integrity: stored hash must match stored snapshot and the intent columns.
        if snapshot_hash(intent.conditions_snapshot) != intent.snapshot_hash:
            await self._fail(intent, user, "snapshot_tampered")
            await self.db.commit()  # persist FAILED even though this request errors (fail closed)
            raise ConflictError("Payment conditions failed integrity check", code="snapshot_integrity")

        request = await self.db.get(ProcurementRequest, intent.request_id)
        quotation = await self.db.get(Quotation, intent.quotation_id)
        policy = (
            await self.db.execute(select(SpendingPolicy).where(SpendingPolicy.user_id == user.id).with_for_update())
        ).scalar_one_or_none()
        try:
            fresh: ValidatedConditions = await self.guardian.validate(
                user=user, request=request, quotation=quotation, policy=policy,  # type: ignore[arg-type]
                exclude_intent_id=intent.id,
            )
        except PaymentValidationError as exc:
            await self._fail(intent, user, "revalidation_failed", exc.details)
            await self.db.commit()
            raise

        if (fresh.amount, fresh.asset, fresh.chain_id, fresh.recipient.lower()) != (
            intent.amount, intent.asset, intent.chain_id, intent.recipient.lower()
        ):
            await self._fail(intent, user, "conditions_changed")
            await self.db.commit()
            raise ConflictError("Payment conditions changed; create a new payment intent", code="conditions_changed")

        await self._transition(intent, S.AWAITING_SIGNATURE, actor_id=user.id, internal=True)
        review = {
            "payer_user_id": str(user.id),
            "payer_wallet": user.wallet_address,
            "provider_agent_id": str(intent.provider_agent_id),
            "provider_name": intent.conditions_snapshot.get("provider_name"),
            "recipient": intent.recipient,
            "amount": format(intent.amount.normalize(), "f"),
            "asset": intent.asset,
            "chain_id": intent.chain_id,
            "expires_at": as_utc(intent.expires_at).isoformat(),  # type: ignore[union-attr]
            "snapshot_hash": intent.snapshot_hash,
            "verified_settlement": False,
        }
        return intent, review

    async def cancel(self, intent_id: uuid.UUID, user: Profile) -> PaymentIntent:
        intent = await self.get_owned(intent_id, user, for_update=True)
        if S(intent.status) not in PRE_SUBMISSION:
            raise ConflictError(
                f"Payment in status {intent.status} can no longer be cancelled", code="illegal_transition"
            )
        flow = (await self.db.execute(select(HspPaymentFlow).where(HspPaymentFlow.payment_intent_id == intent.id))).scalar_one_or_none()
        if flow is not None:
            # HSP has no order-cancel API in the public docs: the payer could still complete payment at payment_url.
            raise ConflictError(
                "An HSP order is already registered for this payment and cannot be withdrawn; it expires at "
                f"{as_utc(flow.cart_expiry).isoformat() if flow.cart_expiry else 'its cart expiry'}.",  # type: ignore[union-attr]
                code="hsp_order_registered",
            )
        await self._transition(intent, S.CANCELLED, actor_id=user.id, reason="cancelled_by_user")
        return intent

    async def _fail(self, intent: PaymentIntent, user: Profile, reason: str, details: Any = None) -> None:
        await self._transition(intent, S.FAILED, actor_id=user.id, reason=reason, internal=True)
        if details:
            await log_event(self.db, "payment_failure_details", actor_id=user.id, payment_intent_id=intent.id,
                            data={"details": details})

    # ---------------------------------------------------------------- Step 2 hook (not exposed via API)
    async def mark_settled(self, intent: PaymentIntent, settlement: VerifiedSettlement) -> None:
        """Only callable from the HSP verification pipeline. Requires verified evidence."""
        await self._transition(intent, S.SETTLED, actor_id=None, internal=True, settlement=settlement)


_ = ForbiddenError
