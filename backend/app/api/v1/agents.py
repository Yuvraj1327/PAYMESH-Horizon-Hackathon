import uuid
from typing import Annotated

from fastapi import APIRouter, Query, Response

from app.api.deps import PagerDep, SettingsDep
from app.core.security import AdminUser, CurrentUser, DbSession
from app.models.enums import AgentKind, AgentStatus, ServiceCategory
from app.schemas.common import Page
from app.schemas.marketplace import AgentCreate, AgentOut, AgentUpdate
from app.services import marketplace as svc
from app.services.demo_agents import seed_demo_agents

router = APIRouter(prefix="/agents", tags=["agents"])


@router.post("", response_model=AgentOut, status_code=201)
async def register_agent(body: AgentCreate, user: CurrentUser, db: DbSession) -> AgentOut:
    agent = await svc.register_agent(db, user, body)
    return (await svc.to_agent_out(db, [agent]))[0]


@router.get("", response_model=Page[AgentOut])
async def discover_agents(
    user: CurrentUser,
    db: DbSession,
    pager: PagerDep,
    category: ServiceCategory | None = None,
    kind: AgentKind | None = None,
    q: Annotated[str | None, Query(max_length=100)] = None,
    mine: bool = False,
) -> Page[AgentOut]:
    rows, total = await svc.list_agents(
        db, user, category=category.value if category else None, kind=kind.value if kind else None,
        q=q, mine=mine, limit=pager.limit, offset=pager.offset,
    )
    return Page(items=await svc.to_agent_out(db, rows), total=total, limit=pager.limit, offset=pager.offset)


@router.post("/demo/seed", tags=["admin"])
async def seed_demo(admin: AdminUser, db: DbSession, settings: SettingsDep) -> dict:
    """Admin only. Idempotently creates the three demo provider agents (wallets come from env)."""
    return await seed_demo_agents(db, settings)


@router.get("/{agent_id}", response_model=AgentOut)
async def get_agent(agent_id: uuid.UUID, user: CurrentUser, db: DbSession) -> AgentOut:
    agent = await svc.get_agent_visible(db, agent_id, user)
    return (await svc.to_agent_out(db, [agent]))[0]


@router.patch("/{agent_id}", response_model=AgentOut)
async def update_agent(agent_id: uuid.UUID, body: AgentUpdate, user: CurrentUser, db: DbSession) -> AgentOut:
    agent = await svc.update_agent(db, user, agent_id, body)
    return (await svc.to_agent_out(db, [agent]))[0]


@router.post("/{agent_id}/suspend", response_model=AgentOut, tags=["admin"])
async def suspend_agent(agent_id: uuid.UUID, admin: AdminUser, db: DbSession) -> AgentOut:
    agent = await svc.update_agent(db, admin, agent_id, AgentUpdate(status=AgentStatus.SUSPENDED))
    return (await svc.to_agent_out(db, [agent]))[0]


@router.delete("/{agent_id}", status_code=204)
async def delete_agent(agent_id: uuid.UUID, user: CurrentUser, db: DbSession) -> Response:
    await svc.delete_agent(db, user, agent_id)
    return Response(status_code=204)
