"""Seed the three platform-operated DEMO provider agents.

Demo agents are real marketplace participants (they quote and, after verified payment, deliver),
but their deliverables are demonstration content and they are flagged `kind=demo` everywhere.
Their payout wallets come from environment variables -- nothing is hardcoded.
"""

from __future__ import annotations

import logging
from decimal import Decimal

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.models import Agent, Service
from app.models.enums import AgentKind, AgentStatus, ServiceCategory
from app.schemas.common import validate_eth_address

log = logging.getLogger(__name__)

DEMO_DEFINITIONS = [
    {
        "name": "Crypto Research Agent (Demo)",
        "env": "DEMO_CRYPTO_RESEARCH_WALLET",
        "category": ServiceCategory.CRYPTO_RESEARCH,
        "description": "Demonstration agent that produces a cryptocurrency market research brief.",
        "capabilities": ["market_research", "token_overview", "risk_summary"],
        "service": ("Crypto market research report", Decimal("0.25"), 60),
    },
    {
        "name": "Market Data Agent (Demo)",
        "env": "DEMO_MARKET_DATA_WALLET",
        "category": ServiceCategory.CRYPTO_RESEARCH,
        "description": "Demonstration agent that delivers a structured market-data snapshot summary.",
        "capabilities": ["price_data", "volume_summary", "market_snapshot"],
        "service": ("Market data snapshot", Decimal("0.40"), 15),
    },
    {
        "name": "AI Analytics Agent (Demo)",
        "env": "DEMO_AI_ANALYTICS_WALLET",
        "category": ServiceCategory.CRYPTO_RESEARCH,
        "description": "Demonstration agent that performs AI-driven analytics on a crypto topic.",
        "capabilities": ["ai_analysis", "trend_analysis", "scenario_analysis"],
        "service": ("AI analytics deep-dive", Decimal("0.60"), 90),
    },
]


async def seed_demo_agents(db: AsyncSession, settings: Settings) -> dict[str, list[str]]:
    """Idempotent. Returns {'created': [...], 'existing': [...], 'skipped': [...]}."""
    result: dict[str, list[str]] = {"created": [], "existing": [], "skipped": []}
    asset = settings.SUPPORTED_ASSETS[0]
    for d in DEMO_DEFINITIONS:
        raw = getattr(settings, d["env"])
        try:
            wallet = validate_eth_address(raw) if raw else None
        except (ValueError, ValidationError):
            wallet = None
        if wallet is None:
            log.warning("Skipping %s: set %s to a valid address", d["name"], d["env"])
            result["skipped"].append(f"{d['name']} (set {d['env']})")
            continue
        existing = (
            await db.execute(select(Agent).where(Agent.kind == AgentKind.DEMO.value, Agent.name == d["name"]))
        ).scalar_one_or_none()
        if existing is not None:
            result["existing"].append(d["name"])
            continue
        agent = Agent(
            owner_id=None, kind=AgentKind.DEMO.value, name=d["name"], description=d["description"],
            wallet_address=wallet, category=d["category"].value, capabilities=d["capabilities"],
            status=AgentStatus.ACTIVE.value,
        )
        db.add(agent)
        await db.flush()
        title, price, minutes = d["service"]
        db.add(Service(provider_agent_id=agent.id, name=title, description=d["description"], price=price,
                       payment_asset=asset, is_available=True, delivery_estimate_minutes=minutes))
        await db.flush()
        result["created"].append(d["name"])
    return result
