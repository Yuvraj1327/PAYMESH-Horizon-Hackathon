"""Agent + service management with server-side ownership enforcement."""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.errors import ConflictError, ForbiddenError, NotFoundError, UnprocessableError
from app.models import Agent, PaymentIntent, Profile, Quotation, Service
from app.models.enums import AgentKind, AgentStatus, UserRole
from app.payments.service import log_event
from app.schemas.marketplace import AgentCreate, AgentOut, AgentUpdate, ServiceCreate, ServiceUpdate
from app.services.discovery import reputation_map


def is_admin(user: Profile) -> bool:
    return user.role == UserRole.ADMIN.value


def assert_can_manage_agent(agent: Agent, user: Profile) -> None:
    if is_admin(user):
        return
    if agent.kind == AgentKind.DEMO.value or agent.owner_id is None:
        raise ForbiddenError("Demo agents are managed by the platform", code="demo_agent_protected")
    if agent.owner_id != user.id:
        raise ForbiddenError("You do not own this agent")


async def to_agent_out(db: AsyncSession, agents: list[Agent]) -> list[AgentOut]:
    reps = await reputation_map(db, [a.id for a in agents])
    out = []
    for a in agents:
        o = AgentOut.model_validate(a)
        o.reputation = reps.get(a.id)
        out.append(o)
    return out


async def register_agent(db: AsyncSession, user: Profile, data: AgentCreate) -> Agent:
    agent = Agent(
        owner_id=user.id,
        kind=AgentKind.EXTERNAL.value,
        name=data.name,
        description=data.description,
        wallet_address=data.wallet_address,
        category=data.category.value,
        capabilities=data.capabilities,
        status=AgentStatus.ACTIVE.value,
    )
    db.add(agent)
    await db.flush()
    await log_event(db, "agent_registered", actor_id=user.id, data={"agent_id": agent.id, "wallet": agent.wallet_address})
    return agent


async def list_agents(
    db: AsyncSession, user: Profile | None, *, category: str | None, kind: str | None, q: str | None,
    mine: bool, limit: int, offset: int,
) -> tuple[list[Agent], int]:
    conds = []
    if mine:
        if user is None:
            return [], 0
        conds.append(Agent.owner_id == user.id)
    else:
        # public discovery only exposes active agents
        conds.append(Agent.status == AgentStatus.ACTIVE.value)
    if category:
        conds.append(Agent.category == category)
    if kind:
        conds.append(Agent.kind == kind)
    if q:
        like = f"%{q.strip().lower()}%"
        conds.append(or_(func.lower(Agent.name).like(like), func.lower(Agent.description).like(like)))
    total = (await db.execute(select(func.count()).select_from(Agent).where(*conds))).scalar_one()
    rows = (
        await db.execute(select(Agent).where(*conds).order_by(Agent.created_at.desc()).limit(limit).offset(offset))
    ).scalars().all()
    return list(rows), total


async def get_agent_visible(db: AsyncSession, agent_id: uuid.UUID, user: Profile | None) -> Agent:
    agent = await db.get(Agent, agent_id)
    if agent is None:
        raise NotFoundError("Agent not found")
    if agent.status != AgentStatus.ACTIVE.value and not (
        user and (is_admin(user) or agent.owner_id == user.id)
    ):
        raise NotFoundError("Agent not found")
    return agent


async def update_agent(db: AsyncSession, user: Profile, agent_id: uuid.UUID, data: AgentUpdate) -> Agent:
    agent = await db.get(Agent, agent_id)
    if agent is None:
        raise NotFoundError("Agent not found")
    assert_can_manage_agent(agent, user)
    changes: dict[str, Any] = data.model_dump(exclude_unset=True)

    if "status" in changes:
        new = AgentStatus(changes.pop("status"))
        if not is_admin(user):
            if new is AgentStatus.SUSPENDED:
                raise ForbiddenError("Only administrators can suspend agents")
            if agent.status == AgentStatus.SUSPENDED.value:
                raise ForbiddenError("Suspended agents can only be reinstated by an administrator")
        agent.status = new.value
    if "wallet_address" in changes:
        new_wallet = changes.pop("wallet_address")
        if new_wallet.lower() != agent.wallet_address.lower():
            await log_event(db, "agent_wallet_changed", actor_id=user.id,
                            data={"agent_id": agent.id, "old": agent.wallet_address, "new": new_wallet})
            agent.wallet_address = new_wallet
            agent.onchain_registration_reference = None  # must be re-verified
    if "category" in changes:
        agent.category = changes.pop("category").value
    for k in ("name", "description", "capabilities"):
        if k in changes and changes[k] is not None:
            setattr(agent, k, changes[k])
    await db.flush()
    return agent


async def delete_agent(db: AsyncSession, user: Profile, agent_id: uuid.UUID) -> None:
    agent = await db.get(Agent, agent_id)
    if agent is None:
        raise NotFoundError("Agent not found")
    assert_can_manage_agent(agent, user)
    refs = (await db.execute(select(func.count()).select_from(Quotation).where(Quotation.provider_agent_id == agent.id))).scalar_one()
    refs += (await db.execute(select(func.count()).select_from(PaymentIntent).where(PaymentIntent.provider_agent_id == agent.id))).scalar_one()
    if refs:
        raise ConflictError(
            "Agent has quotation/payment history and cannot be deleted; deactivate it instead", code="agent_in_use"
        )
    await log_event(db, "agent_deleted", actor_id=user.id, data={"agent_id": agent.id})
    await db.delete(agent)
    await db.flush()


# ---------------------------------------------------------------------------- services
async def create_service(db: AsyncSession, user: Profile, data: ServiceCreate, settings: Settings) -> Service:
    agent = await db.get(Agent, data.provider_agent_id)
    if agent is None:
        raise NotFoundError("Provider agent not found")
    assert_can_manage_agent(agent, user)
    _check_asset(data.payment_asset, settings)
    svc = Service(
        provider_agent_id=agent.id, name=data.name, description=data.description, price=data.price,
        payment_asset=data.payment_asset, is_available=data.is_available,
        delivery_estimate_minutes=data.delivery_estimate_minutes,
    )
    db.add(svc)
    await db.flush()
    return svc


def _check_asset(asset: str, settings: Settings) -> None:
    if asset not in settings.SUPPORTED_ASSETS:
        raise UnprocessableError(
            f"Asset {asset} is not supported; supported: {', '.join(settings.SUPPORTED_ASSETS)}", code="unsupported_asset"
        )


async def get_service(db: AsyncSession, service_id: uuid.UUID) -> Service:
    svc = await db.get(Service, service_id)
    if svc is None:
        raise NotFoundError("Service not found")
    return svc


async def update_service(
    db: AsyncSession, user: Profile, service_id: uuid.UUID, data: ServiceUpdate, settings: Settings
) -> Service:
    svc = await get_service(db, service_id)
    agent = await db.get(Agent, svc.provider_agent_id)
    assert_can_manage_agent(agent, user)  # type: ignore[arg-type]
    changes = data.model_dump(exclude_unset=True)
    if "payment_asset" in changes and changes["payment_asset"] is not None:
        _check_asset(changes["payment_asset"], settings)
    for k, v in changes.items():
        if v is not None:
            setattr(svc, k, v)
    await db.flush()
    return svc


async def delete_service(db: AsyncSession, user: Profile, service_id: uuid.UUID) -> None:
    svc = await get_service(db, service_id)
    agent = await db.get(Agent, svc.provider_agent_id)
    assert_can_manage_agent(agent, user)  # type: ignore[arg-type]
    await db.delete(svc)
    await db.flush()


async def list_services(
    db: AsyncSession, *, agent_id: uuid.UUID | None, category: str | None, asset: str | None,
    max_price: Any, available_only: bool, limit: int, offset: int,
) -> tuple[list[Service], int]:
    stmt = select(Service).join(Agent, Agent.id == Service.provider_agent_id).where(
        Agent.status == AgentStatus.ACTIVE.value
    )
    if agent_id:
        stmt = stmt.where(Service.provider_agent_id == agent_id)
    if category:
        stmt = stmt.where(Agent.category == category)
    if asset:
        stmt = stmt.where(Service.payment_asset == asset.upper())
    if max_price is not None:
        stmt = stmt.where(Service.price <= max_price)
    if available_only:
        stmt = stmt.where(Service.is_available.is_(True))
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    rows = (await db.execute(stmt.order_by(Service.price.asc()).limit(limit).offset(offset))).scalars().all()
    return list(rows), total
