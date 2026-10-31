"""Structured outputs the Claude agents must produce (validated with Pydantic)."""

from __future__ import annotations

import uuid
from decimal import Decimal

from pydantic import BaseModel, Field

from app.models.enums import ServiceCategory


class ExtractedRequirements(BaseModel):
    category: ServiceCategory = Field(description="Best matching service category")
    summary: str = Field(max_length=600, description="One-paragraph restatement of what the buyer needs")
    max_budget: Decimal | None = Field(default=None, description="Maximum budget if the user stated one, else null")
    budget_asset: str | None = Field(default=None, max_length=16, description="Asset symbol such as USDT, if stated")
    delivery_deadline_minutes: int | None = Field(default=None, ge=1, description="Required delivery time, if stated")
    constraints: list[str] = Field(default_factory=list, max_length=10, description="Other explicit user conditions")


class RankedQuote(BaseModel):
    quotation_id: uuid.UUID
    score: float = Field(ge=0, le=100)
    notes: str = Field(max_length=400)


class RecommendationOutput(BaseModel):
    recommended_quotation_id: uuid.UUID | None = Field(
        description="ID of the best eligible quotation, or null if none is suitable"
    )
    ranking: list[RankedQuote] = Field(max_length=20)
    rationale: str = Field(max_length=1500, description="Plain-language explanation for the user")


class QuoteNarrative(BaseModel):
    summary: str = Field(max_length=800)
    deliverables: list[str] = Field(max_length=10)
    assumptions: list[str] = Field(default_factory=list, max_length=10)


class DeliveryOutput(BaseModel):
    title: str = Field(max_length=200)
    content_markdown: str = Field(max_length=8000)


class PaymentExplanation(BaseModel):
    summary: str = Field(max_length=800)
    points_to_check: list[str] = Field(max_length=8)
