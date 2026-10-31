from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any

from pydantic import BaseModel, Field, field_validator

from app.models.enums import PaymentStatus
from app.schemas.common import AssetSymbol, ORMModel, PositiveAmount, StrictModel


class PolicyUpsert(StrictModel):
    max_transaction_amount: PositiveAmount
    daily_spending_limit: PositiveAmount
    permitted_agent_ids: list[uuid.UUID] = Field(default_factory=list, max_length=200)
    allow_all_agents: bool = False
    allowed_assets: list[AssetSymbol] = Field(min_length=1, max_length=10)
    allowed_chain_ids: list[int] = Field(min_length=1, max_length=5)
    enabled: bool = True

    @field_validator("daily_spending_limit")
    @classmethod
    def _noop(cls, v: Decimal) -> Decimal:
        return v


class PolicyOut(ORMModel):
    id: uuid.UUID
    user_id: uuid.UUID
    max_transaction_amount: Decimal
    daily_spending_limit: Decimal
    permitted_agent_ids: list[str]
    allow_all_agents: bool
    allowed_assets: list[str]
    allowed_chain_ids: list[int]
    enabled: bool
    updated_at: datetime


class PaymentIntentCreate(StrictModel):
    request_id: uuid.UUID
    # Optional: defaults to the request's selected quotation; if given it must match it.
    quotation_id: uuid.UUID | None = None


class PaymentIntentOut(ORMModel):
    id: uuid.UUID
    request_id: uuid.UUID
    quotation_id: uuid.UUID
    buyer_id: uuid.UUID
    provider_agent_id: uuid.UUID
    amount: Decimal
    asset: str
    chain_id: int
    recipient: str
    status: PaymentStatus
    conditions_snapshot: dict[str, Any]
    snapshot_hash: str
    expires_at: datetime
    failure_reason: str | None
    created_at: datetime
    updated_at: datetime


class AuthorizationRequestOut(BaseModel):
    """Result of /authorize: the conditions the user is about to pay. Next: POST .../mandate."""

    payment_intent: PaymentIntentOut
    review: dict[str, Any]
    next_step: str = "POST /api/v1/payments/intents/{id}/mandate"
    note: str = "Nothing has been signed, submitted or settled yet."


class TransactionEventOut(ORMModel):
    id: uuid.UUID
    payment_intent_id: uuid.UUID | None
    event_type: str
    event_data: dict[str, Any]
    created_at: datetime


class ReceiptOut(ORMModel):
    id: uuid.UUID
    payment_intent_id: uuid.UUID
    receipt_reference: str
    transaction_hash: str | None
    settlement_status: str
    chain_id: int | None = None
    token_address: str | None = None
    payer_address: str | None = None
    recipient: str | None = None
    verified_amount: Decimal | None = None
    block_number: int | None = None
    verification_details: dict[str, Any]
    verified_at: datetime | None = None
    created_at: datetime


class ValidationFailure(BaseModel):
    rule: str
    message: str


_ = AssetSymbol, ORMModel
