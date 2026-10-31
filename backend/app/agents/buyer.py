"""Buyer Agent: requirement extraction + quotation comparison/recommendation.

Claude proposes; deterministic code decides eligibility and validates every ID it returns.
If Claude is unavailable or returns something invalid, comparison falls back to a transparent
weighted score so the workflow never depends on the model being up.
"""

from __future__ import annotations

import logging
import re
import uuid
from decimal import Decimal, InvalidOperation
from typing import Any

from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.common import wrap_untrusted
from app.agents.prompts import BUYER_SYSTEM
from app.agents.schemas import ExtractedRequirements, RankedQuote, RecommendationOutput
from app.integrations.anthropic.client import ClaudeClient, ToolSpec
from app.core.errors import UpstreamError
from app.models import ProcurementRequest, Quotation
from app.models.enums import ServiceCategory
from app.services.discovery import discover_candidates, reputation_map
from app.utils.common import as_utc

log = logging.getLogger(__name__)

_NUM = re.compile(r"\d+(?:[.,]\d+)?")


def budget_grounded(description: str, value: Decimal) -> bool:
    """Anti-hallucination: an AI-extracted budget must literally appear in the user's text."""
    for m in _NUM.findall(description):
        try:
            if Decimal(m.replace(",", ".")) == value:
                return True
        except InvalidOperation:
            continue
    return False


class _SearchArgs(BaseModel):
    category: ServiceCategory | None = None
    max_price: Decimal | None = Field(default=None, gt=0)


class _ReputationArgs(BaseModel):
    agent_id: uuid.UUID


def deterministic_ranking(
    quotes: list[Quotation], reputations: dict[uuid.UUID, float], budget: Decimal, deadline_minutes: int | None
) -> list[RankedQuote]:
    """Transparent score: 50% price, 30% delivery speed, 20% reputation (unrated = neutral)."""
    if not quotes:
        return []
    max_delivery = deadline_minutes or max(q.delivery_estimate_minutes for q in quotes) or 1
    ranked = []
    for q in quotes:
        price_s = max(0.0, 1.0 - float(Decimal(str(q.price)) / budget)) if budget > 0 else 0.0
        deliv_s = max(0.0, 1.0 - min(1.0, q.delivery_estimate_minutes / max_delivery))
        rep = reputations.get(q.provider_agent_id)
        rep_s = (rep / 5.0) if rep is not None else 0.5
        score = round(100 * (0.5 * price_s + 0.3 * deliv_s + 0.2 * rep_s), 2)
        ranked.append(
            RankedQuote(
                quotation_id=q.id,
                score=score,
                notes=f"price {q.price} {q.payment_asset}, delivery {q.delivery_estimate_minutes} min, "
                f"reputation {rep if rep is not None else 'unrated'}",
            )
        )
    return sorted(ranked, key=lambda r: r.score, reverse=True)


class BuyerAgent:
    def __init__(self, claude: ClaudeClient, db: AsyncSession):
        self.claude = claude
        self.db = db

    # ------------------------------------------------------------------ extraction
    async def extract_requirements(self, user_id: uuid.UUID, description: str) -> ExtractedRequirements:
        out = await self.claude.run_structured(
            user_id=user_id,
            system=BUYER_SYSTEM,
            user_content=(
                "Extract the structured procurement requirements from the buyer's request.\n"
                + wrap_untrusted("buyer_request", description)
            ),
            output_model=ExtractedRequirements,
            output_description="Structured requirements extracted from the buyer's request.",
        )
        if out.max_budget is not None and (out.max_budget <= 0 or not budget_grounded(description, out.max_budget)):
            out = out.model_copy(update={"max_budget": None, "budget_asset": None})
        if out.budget_asset:
            out = out.model_copy(update={"budget_asset": out.budget_asset.strip().upper()})
        return out

    # ------------------------------------------------------------------ discovery tools
    def _tools(self) -> list[ToolSpec]:
        async def search(args: _SearchArgs) -> Any:
            cands = await discover_candidates(
                self.db, category=args.category.value if args.category else None,
                max_price=args.max_price, asset=None, limit=10,
            )
            return [
                {
                    "agent_id": str(c.agent.id),
                    "agent_name": wrap_untrusted("agent_name", c.agent.name, 120),
                    "service_name": wrap_untrusted("service_name", c.service.name, 160),
                    "price": str(c.service.price),
                    "asset": c.service.payment_asset,
                    "delivery_minutes": c.service.delivery_estimate_minutes,
                    "reputation": c.reputation,
                    "is_demo": c.agent.is_demo,
                }
                for c in cands
            ]

        async def reputation(args: _ReputationArgs) -> Any:
            reps = await reputation_map(self.db, [args.agent_id])
            return {"agent_id": str(args.agent_id), "reputation": reps.get(args.agent_id)}

        return [
            ToolSpec("search_services", "Search available provider services (read-only).", _SearchArgs, search),
            ToolSpec("get_provider_reputation", "Average review rating for a provider agent (read-only).",
                     _ReputationArgs, reputation),
        ]

    # ------------------------------------------------------------------ recommendation
    async def recommend(
        self, user_id: uuid.UUID, request: ProcurementRequest, eligible: list[Quotation]
    ) -> tuple[RecommendationOutput, str]:
        """Returns (recommendation, generated_by). `eligible` is pre-filtered by deterministic rules."""
        reps = await reputation_map(self.db, list({q.provider_agent_id for q in eligible}))
        deadline = (request.requirements or {}).get("delivery_deadline_minutes")
        fallback_rank = deterministic_ranking(eligible, reps, Decimal(str(request.max_budget)), deadline)

        if not eligible:
            return (
                RecommendationOutput(
                    recommended_quotation_id=None, ranking=[],
                    rationale="No eligible quotations (within budget, in the right asset, and not expired).",
                ),
                "deterministic_fallback",
            )

        def fallback() -> tuple[RecommendationOutput, str]:
            top = fallback_rank[0]
            return (
                RecommendationOutput(
                    recommended_quotation_id=top.quotation_id,
                    ranking=fallback_rank,
                    rationale="Ranked by a transparent weighted score (50% price, 30% delivery speed, "
                    f"20% reputation). Top choice: {top.notes}.",
                ),
                "deterministic_fallback",
            )

        if not self.claude.configured:
            return fallback()

        quotes_payload = [
            {
                "quotation_id": str(q.id),
                "provider_agent_id": str(q.provider_agent_id),
                "price": str(q.price),
                "asset": q.payment_asset,
                "delivery_estimate_minutes": q.delivery_estimate_minutes,
                "reputation": reps.get(q.provider_agent_id),
                "details": q.response_details,
                "expires_at": as_utc(q.expires_at).isoformat(),  # type: ignore[union-attr]
            }
            for q in eligible
        ]
        content = (
            f"Budget: {request.max_budget} {request.budget_asset}. Category: {request.category}.\n"
            "Compare these eligible quotations and recommend one.\n"
            + wrap_untrusted("buyer_request", request.description, 2000)
            + "\n"
            + wrap_untrusted("quotations", quotes_payload, 12000)
        )
        try:
            out = await self.claude.run_structured(
                user_id=user_id, system=BUYER_SYSTEM, user_content=content,
                output_model=RecommendationOutput, tools=self._tools(),
                output_description="Ranking and recommendation of quotations.",
            )
        except UpstreamError as exc:
            log.warning("Buyer recommend fell back: %s", exc.code)
            return fallback()

        eligible_ids = {q.id for q in eligible}
        valid = (out.recommended_quotation_id in eligible_ids) and all(r.quotation_id in eligible_ids for r in out.ranking)
        if not valid:
            log.warning("Model referenced unknown quotation ids; using fallback")
            return fallback()
        return out, "claude"
