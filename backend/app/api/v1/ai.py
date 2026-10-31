import uuid

from fastapi import APIRouter
from pydantic import Field
from sqlalchemy import select

from app.agents.buyer import BuyerAgent
from app.agents.payment import PaymentAgent
from app.agents.schemas import ExtractedRequirements, PaymentExplanation
from app.api.deps import ClaudeDep, PagerDep, PaymentSvc, ProcurementSvc, SettingsDep
from app.core.security import CurrentUser, DbSession
from app.models import AgentMessage
from app.schemas.common import Page, StrictModel
from app.schemas.procurement import MessageOut, RecommendationOut

router = APIRouter(prefix="/ai", tags=["ai"])


class ExtractBody(StrictModel):
    text: str = Field(min_length=10, max_length=4000)


@router.get("/status")
async def ai_status(user: CurrentUser, claude: ClaudeDep) -> dict:
    """Whether Claude is configured, the active model and the caller's usage budget (no secrets)."""
    return {"configured": claude.configured, "model": claude.model, "usage": claude.limiter.snapshot(user.id)}


@router.post("/extract-requirements", response_model=ExtractedRequirements)
async def extract_requirements(body: ExtractBody, user: CurrentUser, db: DbSession, claude: ClaudeDep) -> ExtractedRequirements:
    """Preview what the Buyer Agent extracts from free text (not persisted)."""
    return await BuyerAgent(claude, db).extract_requirements(user.id, body.text)


@router.post("/requests/{request_id}/recommend", response_model=RecommendationOut)
async def recommend(request_id: uuid.UUID, user: CurrentUser, svc: ProcurementSvc) -> RecommendationOut:
    res = await svc.recommend(user, request_id)
    return RecommendationOut(
        recommended_quotation_id=res["recommended_quotation_id"], ranking=res["ranking"],
        rationale=res["rationale"], generated_by=res["generated_by"],
    )


@router.get("/requests/{request_id}/messages", response_model=Page[MessageOut])
async def agent_messages(
    request_id: uuid.UUID, user: CurrentUser, db: DbSession, svc: ProcurementSvc, pager: PagerDep
) -> Page[MessageOut]:
    """Agent-to-agent activity timeline for the Agent Console."""
    await svc.get_owned(request_id, user)  # ownership check
    rows = (
        await db.execute(
            select(AgentMessage).where(AgentMessage.request_id == request_id)
            .order_by(AgentMessage.created_at.asc()).limit(pager.limit).offset(pager.offset)
        )
    ).scalars().all()
    return Page(items=[MessageOut.model_validate(r) for r in rows], total=len(rows), limit=pager.limit, offset=pager.offset)


@router.post("/payments/{intent_id}/explain", response_model=dict)
async def explain_payment(
    intent_id: uuid.UUID, user: CurrentUser, claude: ClaudeDep, svc: PaymentSvc, settings: SettingsDep
) -> dict:
    """Plain-language explanation of already-validated conditions. Informational only."""
    intent = await svc.get_owned(intent_id, user)
    agent = PaymentAgent(claude, svc, settings)
    out, by = await agent.explain(user.id, intent)
    return {"explanation": PaymentExplanation.model_validate(out).model_dump(), "generated_by": by,
            "workflow": agent.workflow_status(intent)}
