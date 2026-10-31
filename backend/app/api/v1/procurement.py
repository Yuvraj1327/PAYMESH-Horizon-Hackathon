import uuid

from fastapi import APIRouter, Query
from sqlalchemy import func, select

from app.api.deps import PagerDep, ProcurementSvc
from app.core.security import CurrentUser, DbSession
from app.models import ProcurementRequest
from app.models.enums import ProcurementStatus
from app.schemas.common import Page
from app.schemas.procurement import (
    CandidateOut,
    ProcurementCreate,
    ProcurementOut,
    QuotationOut,
    RecommendationOut,
    SelectProvider,
)

router = APIRouter(prefix="/procurement", tags=["procurement"])


@router.post("/requests", response_model=ProcurementOut, status_code=201)
async def create_request(body: ProcurementCreate, user: CurrentUser, svc: ProcurementSvc) -> ProcurementOut:
    """Create a procurement request. The Buyer Agent (Claude) extracts requirements from the text;
    explicit `max_budget` / `category` in the body always override the AI."""
    return ProcurementOut.model_validate(await svc.create_request(user, body))


@router.get("/requests", response_model=Page[ProcurementOut])
async def list_requests(
    user: CurrentUser, db: DbSession, pager: PagerDep, status: ProcurementStatus | None = Query(default=None)
) -> Page[ProcurementOut]:
    conds = [ProcurementRequest.buyer_id == user.id]
    if status:
        conds.append(ProcurementRequest.status == status.value)
    total = (await db.execute(select(func.count()).select_from(ProcurementRequest).where(*conds))).scalar_one()
    rows = (
        await db.execute(
            select(ProcurementRequest).where(*conds).order_by(ProcurementRequest.created_at.desc())
            .limit(pager.limit).offset(pager.offset)
        )
    ).scalars().all()
    return Page(items=[ProcurementOut.model_validate(r) for r in rows], total=total, limit=pager.limit, offset=pager.offset)


@router.get("/requests/{request_id}", response_model=ProcurementOut)
async def get_request(request_id: uuid.UUID, user: CurrentUser, svc: ProcurementSvc) -> ProcurementOut:
    return ProcurementOut.model_validate(await svc.get_owned(request_id, user))


@router.get("/requests/{request_id}/candidates", response_model=list[CandidateOut])
async def discover(request_id: uuid.UUID, user: CurrentUser, svc: ProcurementSvc) -> list[CandidateOut]:
    cands = await svc.discover(user, request_id)
    return [
        CandidateOut(
            agent_id=c.agent.id, agent_name=c.agent.name, is_demo=c.agent.is_demo, service_id=c.service.id,
            service_name=c.service.name, price=c.service.price, payment_asset=c.service.payment_asset,
            delivery_estimate_minutes=c.service.delivery_estimate_minutes, reputation=c.reputation,
        )
        for c in cands
    ]


@router.post("/requests/{request_id}/quotations", response_model=dict)
async def request_quotations(request_id: uuid.UUID, user: CurrentUser, svc: ProcurementSvc) -> dict:
    """Broadcast the request to matching providers. Demo agents quote immediately; external agents
    are notified and respond via POST /api/v1/quotations."""
    res = await svc.request_quotations(user, request_id)
    return {
        "candidates": res["candidates"],
        "created_quotations": [QuotationOut.model_validate(q).model_dump(mode="json") for q in res["created_quotations"]],
        "awaiting_external_agents": [str(a) for a in res["awaiting_external_agents"]],
    }


@router.get("/requests/{request_id}/quotations", response_model=list[QuotationOut])
async def list_quotations(request_id: uuid.UUID, user: CurrentUser, svc: ProcurementSvc) -> list[QuotationOut]:
    return [QuotationOut.model_validate(q) for q in await svc.list_quotations(user, request_id)]


@router.post("/requests/{request_id}/recommend", response_model=RecommendationOut)
async def recommend(request_id: uuid.UUID, user: CurrentUser, svc: ProcurementSvc) -> RecommendationOut:
    res = await svc.recommend(user, request_id)
    return RecommendationOut(
        recommended_quotation_id=res["recommended_quotation_id"], ranking=res["ranking"],
        rationale=res["rationale"], generated_by=res["generated_by"],
    )


@router.post("/requests/{request_id}/select", response_model=ProcurementOut)
async def select_provider(
    request_id: uuid.UUID, body: SelectProvider, user: CurrentUser, svc: ProcurementSvc
) -> ProcurementOut:
    return ProcurementOut.model_validate(await svc.select(user, request_id, body.quotation_id))


@router.post("/requests/{request_id}/cancel", response_model=ProcurementOut)
async def cancel_request(request_id: uuid.UUID, user: CurrentUser, svc: ProcurementSvc) -> ProcurementOut:
    return ProcurementOut.model_validate(await svc.cancel(user, request_id))


@router.post("/requests/{request_id}/deliver", response_model=ProcurementOut)
async def deliver(request_id: uuid.UUID, user: CurrentUser, svc: ProcurementSvc) -> ProcurementOut:
    """Triggers delivery by a DEMO provider. Refused (409) unless the payment is SETTLED with a verified receipt."""
    return ProcurementOut.model_validate(await svc.deliver(user, request_id))
