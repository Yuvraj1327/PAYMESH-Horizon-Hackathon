import uuid

from fastapi import APIRouter, Query
from sqlalchemy import func, or_, select

from app.api.deps import PagerDep, ProcurementSvc
from app.core.errors import NotFoundError
from app.core.security import CurrentUser, DbSession
from app.models import Agent, ProcurementRequest, Quotation
from app.schemas.common import Page
from app.schemas.procurement import QuotationCreate, QuotationOut

router = APIRouter(prefix="/quotations", tags=["quotations"])


def _visible_to(user_id: uuid.UUID):  # noqa: ANN202
    """A quotation is visible to the buyer of its request and to the provider agent's owner."""
    return or_(
        Quotation.request_id.in_(select(ProcurementRequest.id).where(ProcurementRequest.buyer_id == user_id)),
        Quotation.provider_agent_id.in_(select(Agent.id).where(Agent.owner_id == user_id)),
    )


@router.post("", response_model=QuotationOut, status_code=201)
async def submit_quotation(body: QuotationCreate, user: CurrentUser, svc: ProcurementSvc) -> QuotationOut:
    """External provider agents respond to a solicited service request. The payout address is always the
    agent's registered wallet; it cannot be supplied here."""
    return QuotationOut.model_validate(await svc.submit_external_quotation(user, body))


@router.get("", response_model=Page[QuotationOut])
async def list_quotations(
    user: CurrentUser, db: DbSession, pager: PagerDep, request_id: uuid.UUID | None = Query(default=None),
    provider_agent_id: uuid.UUID | None = Query(default=None),
) -> Page[QuotationOut]:
    conds = [_visible_to(user.id)]
    if request_id:
        conds.append(Quotation.request_id == request_id)
    if provider_agent_id:
        conds.append(Quotation.provider_agent_id == provider_agent_id)
    total = (await db.execute(select(func.count()).select_from(Quotation).where(*conds))).scalar_one()
    rows = (
        await db.execute(select(Quotation).where(*conds).order_by(Quotation.created_at.desc())
                         .limit(pager.limit).offset(pager.offset))
    ).scalars().all()
    return Page(items=[QuotationOut.model_validate(r) for r in rows], total=total, limit=pager.limit, offset=pager.offset)


@router.get("/{quotation_id}", response_model=QuotationOut)
async def get_quotation(quotation_id: uuid.UUID, user: CurrentUser, db: DbSession) -> QuotationOut:
    row = (
        await db.execute(select(Quotation).where(Quotation.id == quotation_id, _visible_to(user.id)))
    ).scalar_one_or_none()
    if row is None:
        raise NotFoundError("Quotation not found")
    return QuotationOut.model_validate(row)


@router.post("/{quotation_id}/withdraw", response_model=QuotationOut)
async def withdraw(quotation_id: uuid.UUID, user: CurrentUser, svc: ProcurementSvc) -> QuotationOut:
    return QuotationOut.model_validate(await svc.withdraw_quotation(user, quotation_id))
