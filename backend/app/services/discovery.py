"""Marketplace discovery queries shared by the API, the procurement engine and the AI tools."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from decimal import Decimal

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Agent, Review, Service
from app.models.enums import AgentStatus


@dataclass
class Candidate:
    agent: Agent
    service: Service
    reputation: float | None


async def reputation_map(db: AsyncSession, agent_ids: list[uuid.UUID]) -> dict[uuid.UUID, float]:
    if not agent_ids:
        return {}
    rows = await db.execute(
        select(Review.provider_agent_id, func.avg(Review.rating))
        .where(Review.provider_agent_id.in_(agent_ids))
        .group_by(Review.provider_agent_id)
    )
    return {aid: round(float(avg), 2) for aid, avg in rows.all()}


async def discover_candidates(
    db: AsyncSession,
    *,
    category: str | None,
    max_price: Decimal | None,
    asset: str | None,
    q: str | None = None,
    limit: int = 20,
) -> list[Candidate]:
    stmt = (
        select(Service, Agent)
        .join(Agent, Agent.id == Service.provider_agent_id)
        .where(Agent.status == AgentStatus.ACTIVE.value, Service.is_available.is_(True))
        .order_by(Service.price.asc(), Agent.created_at.asc())
        .limit(max(1, min(limit, 50)))
    )
    if category:
        stmt = stmt.where(Agent.category == category)
    if max_price is not None:
        stmt = stmt.where(Service.price <= max_price)
    if asset:
        stmt = stmt.where(Service.payment_asset == asset.upper())
    if q:
        like = f"%{q.strip().lower()}%"
        stmt = stmt.where(or_(func.lower(Agent.name).like(like), func.lower(Service.name).like(like)))
    rows = (await db.execute(stmt)).all()
    reps = await reputation_map(db, list({a.id for _, a in rows}))
    # One (cheapest) service per agent
    seen: set[uuid.UUID] = set()
    out: list[Candidate] = []
    for svc, agent in rows:
        if agent.id in seen:
            continue
        seen.add(agent.id)
        out.append(Candidate(agent=agent, service=svc, reputation=reps.get(agent.id)))
    return out
