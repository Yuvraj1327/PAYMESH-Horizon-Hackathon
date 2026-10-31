from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any

from pydantic import BaseModel, Field

from app.models.enums import ProcurementStatus, QuotationStatus, ServiceCategory
from app.schemas.common import AssetSymbol, ORMModel, PositiveAmount, StrictModel


class ProcurementCreate(StrictModel):
    description: str = Field(min_length=10, max_length=4000)
    # Explicit values win over anything the AI extracts.
    max_budget: PositiveAmount | None = None
    budget_asset: AssetSymbol | None = None
    category: ServiceCategory | None = None
    use_ai: bool = True


class ProcurementOut(ORMModel):
    id: uuid.UUID
    buyer_id: uuid.UUID
    description: str
    category: ServiceCategory
    requirements: dict[str, Any]
    max_budget: Decimal
    budget_asset: str
    status: ProcurementStatus
    selected_provider_id: uuid.UUID | None
    selected_quotation_id: uuid.UUID | None
    recommendation: dict[str, Any] | None
    delivery_status: str
    delivery_result: dict[str, Any] | None
    expires_at: datetime | None
    created_at: datetime


class SelectProvider(StrictModel):
    quotation_id: uuid.UUID


class CandidateOut(BaseModel):
    agent_id: uuid.UUID
    agent_name: str
    is_demo: bool
    service_id: uuid.UUID
    service_name: str
    price: Decimal
    payment_asset: str
    delivery_estimate_minutes: int
    reputation: float | None


class QuotationCreate(StrictModel):
    """Submitted by an external provider's owner in response to a service request."""

    request_id: uuid.UUID
    provider_agent_id: uuid.UUID
    service_id: uuid.UUID | None = None
    price: PositiveAmount
    payment_asset: AssetSymbol
    delivery_estimate_minutes: int = Field(ge=1, le=60 * 24 * 30)
    details: str = Field(default="", max_length=4000)


class QuotationOut(ORMModel):
    id: uuid.UUID
    request_id: uuid.UUID
    provider_agent_id: uuid.UUID
    service_id: uuid.UUID | None
    price: Decimal
    payment_asset: str
    chain_id: int
    pay_to_address: str
    delivery_estimate_minutes: int
    response_details: dict[str, Any]
    status: QuotationStatus
    expires_at: datetime
    created_at: datetime


class MessageOut(ORMModel):
    id: uuid.UUID
    request_id: uuid.UUID | None
    sender_role: str
    receiver_role: str
    sender_agent_id: uuid.UUID | None
    receiver_agent_id: uuid.UUID | None
    message_type: str
    payload: dict[str, Any]
    created_at: datetime


class RecommendationOut(BaseModel):
    recommended_quotation_id: uuid.UUID | None
    ranking: list[dict[str, Any]]
    rationale: str
    generated_by: str  # "claude" | "deterministic_fallback"
