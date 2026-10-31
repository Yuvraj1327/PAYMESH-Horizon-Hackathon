import uuid
from typing import Annotated

from fastapi import APIRouter, Header, Query, Response
from sqlalchemy import func, select

from app.agents.payment import PaymentAgent
from app.api.deps import ClaudeDep, HspSvc, PagerDep, PaymentSvc, SettingsDep
from app.core.errors import ForbiddenError, NotFoundError
from app.core.security import CurrentUser, DbSession
from app.models import Agent, HspPaymentFlow, PaymentIntent, PaymentReceipt, ProcurementRequest
from app.models.enums import PaymentStatus
from app.schemas.common import Page
from app.schemas.payments import AuthorizationRequestOut, PaymentIntentCreate, PaymentIntentOut, ReceiptOut
from app.services.marketplace import is_admin

router = APIRouter(prefix="/payments", tags=["payments"])


# ---------------------------------------------------------------------------------------------- intents
@router.post("/intents", response_model=PaymentIntentOut)
async def create_intent(
    body: PaymentIntentCreate,
    response: Response,
    user: CurrentUser,
    svc: PaymentSvc,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key", max_length=128)] = None,
) -> PaymentIntentOut:
    """Validate (Payment Guardian) and create a payment intent with an immutable condition snapshot.
    Idempotent per Idempotency-Key. Nothing is signed, submitted or settled by this call."""
    intent, created = await svc.create_intent(user, body.request_id, body.quotation_id, idempotency_key)
    response.status_code = 201 if created else 200
    return PaymentIntentOut.model_validate(intent)


@router.get("/intents", response_model=Page[PaymentIntentOut])
async def list_intents(
    user: CurrentUser, db: DbSession, pager: PagerDep, status: PaymentStatus | None = Query(default=None),
    request_id: uuid.UUID | None = None,
) -> Page[PaymentIntentOut]:
    """Payment history for the caller."""
    conds = [PaymentIntent.buyer_id == user.id]
    if status:
        conds.append(PaymentIntent.status == status.value)
    if request_id:
        conds.append(PaymentIntent.request_id == request_id)
    total = (await db.execute(select(func.count()).select_from(PaymentIntent).where(*conds))).scalar_one()
    rows = (
        await db.execute(select(PaymentIntent).where(*conds).order_by(PaymentIntent.created_at.desc())
                         .limit(pager.limit).offset(pager.offset))
    ).scalars().all()
    return Page(items=[PaymentIntentOut.model_validate(r) for r in rows], total=total, limit=pager.limit, offset=pager.offset)


@router.get("/intents/{intent_id}", response_model=PaymentIntentOut)
async def get_intent(intent_id: uuid.UUID, user: CurrentUser, svc: PaymentSvc) -> PaymentIntentOut:
    return PaymentIntentOut.model_validate(await svc.get_owned(intent_id, user))


@router.post("/intents/{intent_id}/validate")
async def validate_intent(intent_id: uuid.UUID, user: CurrentUser, svc: PaymentSvc, hsp: HspSvc) -> dict:
    """Dry-run the full Payment Guardian against current data. Changes nothing."""
    intent = await svc.get_owned(intent_id, user)
    return await hsp.validate(intent, user)


@router.post("/intents/{intent_id}/authorize", response_model=AuthorizationRequestOut)
async def request_authorization(
    intent_id: uuid.UUID, user: CurrentUser, svc: PaymentSvc, claude: ClaudeDep, settings: SettingsDep
) -> AuthorizationRequestOut:
    """Re-validate everything and move VALIDATED -> AWAITING_SIGNATURE; returns the review payload."""
    agent = PaymentAgent(claude, svc, settings)
    intent, review = await agent.prepare_authorization(intent_id, user)
    return AuthorizationRequestOut(payment_intent=PaymentIntentOut.model_validate(intent), review=review)


@router.post("/intents/{intent_id}/mandate")
async def create_mandate(intent_id: uuid.UUID, user: CurrentUser, svc: PaymentSvc, hsp: HspSvc) -> dict:
    """Build the official **Cart Mandate** from the intent's immutable snapshot, sign it (ES256K, server-side
    merchant key) and register the order with the HSP gateway. Idempotent: one HSP order per intent.
    Returns the `payment_url` where the user signs the Payment Mandate with their wallet."""
    intent = await svc.get_owned(intent_id, user, for_update=True)
    flow = await hsp.create_order(intent, user)
    return {
        "payment_intent_id": str(intent.id), "cart_mandate_id": flow.mandate_reference,
        "payment_request_id": flow.payment_request_id, "payment_url": flow.payment_url,
        "cart_hash": flow.cart_hash, "cart_expiry": flow.cart_expiry, "order_state": flow.order_state,
        "next_step": "GET /payments/intents/{id}/signing-data",
    }


@router.get("/intents/{intent_id}/signing-data")
async def signing_data(intent_id: uuid.UUID, user: CurrentUser, svc: PaymentSvc, hsp: HspSvc) -> dict:
    """Everything the frontend needs for the wallet step (see HSP_INTEGRATION.md for why this is a hosted checkout)."""
    intent = await svc.get_owned(intent_id, user)
    return await hsp.signing_data(intent)


@router.get("/intents/{intent_id}/status")
async def payment_status(
    intent_id: uuid.UUID, user: CurrentUser, svc: PaymentSvc, hsp: HspSvc,
    refresh: Annotated[bool, Query(description="Query the HSP gateway now (rate-limited per payment)")] = True,
) -> dict:
    intent = await svc.get_owned(intent_id, user, for_update=True)
    if not refresh:
        return hsp.status_view(intent, await hsp._flow(intent), None)
    return await hsp.sync(intent)


@router.post("/intents/{intent_id}/verify")
async def verify_payment(intent_id: uuid.UUID, user: CurrentUser, svc: PaymentSvc, hsp: HspSvc) -> dict:
    """Authoritative settlement verification (fresh gateway query + on-chain evidence). Only a pass can mark
    the payment SETTLED and write the receipt."""
    intent = await svc.get_owned(intent_id, user, for_update=True)
    return await hsp.verify(intent, actor_id=user.id)


@router.get("/intents/{intent_id}/receipt", response_model=ReceiptOut)
async def get_receipt(intent_id: uuid.UUID, user: CurrentUser, svc: PaymentSvc, db: DbSession) -> ReceiptOut:
    intent = await svc.get_owned(intent_id, user)
    row = (await db.execute(select(PaymentReceipt).where(PaymentReceipt.payment_intent_id == intent.id))).scalar_one_or_none()
    if row is None:
        raise NotFoundError("No verified receipt for this payment yet", code="receipt_not_found")
    return ReceiptOut.model_validate(row)


@router.post("/intents/{intent_id}/cancel", response_model=PaymentIntentOut)
async def cancel_intent(intent_id: uuid.UUID, user: CurrentUser, svc: PaymentSvc) -> PaymentIntentOut:
    return PaymentIntentOut.model_validate(await svc.cancel(intent_id, user))


# ---------------------------------------------------------------------------- receiving (provider) agent
async def _provider_intent(db, svc: PaymentSvc, user, intent_id: uuid.UUID) -> tuple[PaymentIntent, Agent]:  # noqa: ANN001
    intent = await svc.get_system(intent_id)
    agent = await db.get(Agent, intent.provider_agent_id)
    if agent is None or not (is_admin(user) or agent.owner_id == user.id):
        raise NotFoundError("Payment intent not found")   # same answer as 'missing': no probing
    return intent, agent


@router.get("/provider/intents", response_model=Page[PaymentIntentOut])
async def provider_intents(
    user: CurrentUser, db: DbSession, pager: PagerDep, status: PaymentStatus | None = Query(default=None)
) -> Page[PaymentIntentOut]:
    """Incoming payments addressed to the caller's provider agents (Provider Dashboard)."""
    conds = [PaymentIntent.provider_agent_id.in_(select(Agent.id).where(Agent.owner_id == user.id))]
    if status:
        conds.append(PaymentIntent.status == status.value)
    total = (await db.execute(select(func.count()).select_from(PaymentIntent).where(*conds))).scalar_one()
    rows = (await db.execute(select(PaymentIntent).where(*conds).order_by(PaymentIntent.created_at.desc())
                             .limit(pager.limit).offset(pager.offset))).scalars().all()
    return Page(items=[PaymentIntentOut.model_validate(r) for r in rows], total=total, limit=pager.limit, offset=pager.offset)


@router.get("/provider/intents/{intent_id}/verification")
async def provider_verification(
    intent_id: uuid.UUID, user: CurrentUser, svc: PaymentSvc, hsp: HspSvc, db: DbSession,
    refresh: Annotated[bool, Query(description="Re-query HSP and the chain before answering")] = False,
) -> dict:
    """The Receiving Agent's confirmation that it was genuinely paid. `eligible_for_delivery` proves PAYMENT only;
    it says nothing about service quality, and `delivery_status` is tracked separately."""
    intent, agent = await _provider_intent(db, svc, user, intent_id)
    live = (PaymentStatus.AWAITING_SIGNATURE, PaymentStatus.SIGNED, PaymentStatus.SUBMITTED, PaymentStatus.PENDING)
    if refresh and PaymentStatus(intent.status) in live:
        intent = await hsp.get_intent_system(intent.id)
        try:
            await hsp.sync(intent, force=True)       # fresh gateway query -> state update -> authoritative verification
        except Exception:  # noqa: BLE001 - a failed refresh must not hide the current, stored state
            pass
    receipt = await hsp.get_receipt(intent)
    flow = (await db.execute(select(HspPaymentFlow).where(HspPaymentFlow.payment_intent_id == intent.id))).scalar_one_or_none()
    request = await db.get(ProcurementRequest, intent.request_id)
    settled = PaymentStatus(intent.status) is PaymentStatus.SETTLED and receipt is not None
    recipient_ok = bool(receipt and receipt.recipient and receipt.recipient.lower() == intent.recipient.lower())
    checks_ok = bool(receipt and receipt.verification_details.get("ok") is True)
    asset_chain_ok = bool(receipt and receipt.chain_id == intent.chain_id)
    return {
        "payment_intent_id": str(intent.id),
        "provider_agent_id": str(agent.id),
        "payment_status": intent.status,
        "settlement_verified": settled and checks_ok,
        "checks": {
            "recipient_matches_snapshot": recipient_ok,
            "recipient_is_agents_wallet_now": intent.recipient.lower() == agent.wallet_address.lower(),
            "chain_matches": asset_chain_ok,
            "asset": intent.asset,
            "amount": format(intent.amount.normalize(), "f"),
            "receipt_present": receipt is not None,
            "verification_checks_passed": checks_ok,
        },
        "receipt": None if receipt is None else {"reference": receipt.receipt_reference, "tx_hash": receipt.transaction_hash,
                                                  "verified_amount": str(receipt.verified_amount) if receipt.verified_amount is not None else None},
        "gateway_status": flow.gateway_status if flow else None,
        "eligible_for_delivery": bool(settled and checks_ok and recipient_ok and asset_chain_ok),
        "delivery_status": request.delivery_status if request else None,
        "note": "Payment verification is separate from delivery: 'delivered' says nothing about quality.",
    }


_ = (ForbiddenError, Response)
