from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.errors import NotFoundError, UnprocessableError
from app.models import Profile, SpendingPolicy
from app.payments.service import log_event
from app.schemas.payments import PolicyUpsert


async def get_policy(db: AsyncSession, user: Profile) -> SpendingPolicy:
    pol = (await db.execute(select(SpendingPolicy).where(SpendingPolicy.user_id == user.id))).scalar_one_or_none()
    if pol is None:
        raise NotFoundError("No spending policy configured", code="policy_not_found")
    return pol


async def upsert_policy(db: AsyncSession, user: Profile, data: PolicyUpsert, settings: Settings) -> SpendingPolicy:
    bad_assets = [a for a in data.allowed_assets if a not in settings.SUPPORTED_ASSETS]
    bad_chains = [c for c in data.allowed_chain_ids if c not in settings.ALLOWED_CHAIN_IDS]
    if bad_assets or bad_chains:
        raise UnprocessableError(
            "Policy contains unsupported assets or networks",
            code="policy_invalid",
            details={"unsupported_assets": bad_assets, "unsupported_chain_ids": bad_chains},
        )
    if data.daily_spending_limit < data.max_transaction_amount:
        raise UnprocessableError(
            "daily_spending_limit must be >= max_transaction_amount", code="policy_invalid"
        )
    values = dict(
        max_transaction_amount=data.max_transaction_amount,
        daily_spending_limit=data.daily_spending_limit,
        permitted_agent_ids=sorted({str(a) for a in data.permitted_agent_ids}),
        allow_all_agents=data.allow_all_agents,
        allowed_assets=sorted(set(data.allowed_assets)),
        allowed_chain_ids=sorted(set(data.allowed_chain_ids)),
        enabled=data.enabled,
    )
    existing = (
        await db.execute(select(SpendingPolicy).where(SpendingPolicy.user_id == user.id).with_for_update())
    ).scalar_one_or_none()
    before = None
    if existing is None:
        pol = SpendingPolicy(user_id=user.id, **values)
        db.add(pol)
    else:
        before = {k: getattr(existing, k) for k in values}
        for k, v in values.items():
            setattr(existing, k, v)
        pol = existing
    await db.flush()
    await log_event(db, "spending_policy_updated", actor_id=user.id, data={"before": before, "after": values})
    return pol
