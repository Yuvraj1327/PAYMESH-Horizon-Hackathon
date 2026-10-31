import uuid

from fastapi import APIRouter
from sqlalchemy import func, select

from app.api.deps import PagerDep
from app.core.security import CurrentUser, DbSession
from app.models import PaymentIntent, PaymentReceipt, TransactionEvent
from app.schemas.common import Page
from app.schemas.payments import ReceiptOut, TransactionEventOut

router = APIRouter(prefix="/transactions", tags=["transactions"])


def _mine(user_id: uuid.UUID):  # noqa: ANN202
    return TransactionEvent.payment_intent_id.in_(select(PaymentIntent.id).where(PaymentIntent.buyer_id == user_id))


@router.get("/events", response_model=Page[TransactionEventOut])
async def list_events(
    user: CurrentUser, db: DbSession, pager: PagerDep, payment_intent_id: uuid.UUID | None = None
) -> Page[TransactionEventOut]:
    """Audit trail of the caller's own payment lifecycle events (read-only)."""
    conds = [_mine(user.id)]
    if payment_intent_id:
        conds.append(TransactionEvent.payment_intent_id == payment_intent_id)
    total = (await db.execute(select(func.count()).select_from(TransactionEvent).where(*conds))).scalar_one()
    rows = (
        await db.execute(select(TransactionEvent).where(*conds).order_by(TransactionEvent.created_at.desc())
                         .limit(pager.limit).offset(pager.offset))
    ).scalars().all()
    return Page(items=[TransactionEventOut.model_validate(r) for r in rows], total=total, limit=pager.limit, offset=pager.offset)


@router.get("/receipts", response_model=Page[ReceiptOut])
async def list_receipts(user: CurrentUser, db: DbSession, pager: PagerDep) -> Page[ReceiptOut]:
    """Verified settlement receipts only. Empty until Step 2 (HSP verification) writes real ones."""
    conds = [PaymentReceipt.payment_intent_id.in_(select(PaymentIntent.id).where(PaymentIntent.buyer_id == user.id))]
    total = (await db.execute(select(func.count()).select_from(PaymentReceipt).where(*conds))).scalar_one()
    rows = (
        await db.execute(select(PaymentReceipt).where(*conds).order_by(PaymentReceipt.created_at.desc())
                         .limit(pager.limit).offset(pager.offset))
    ).scalars().all()
    return Page(items=[ReceiptOut.model_validate(r) for r in rows], total=total, limit=pager.limit, offset=pager.offset)
