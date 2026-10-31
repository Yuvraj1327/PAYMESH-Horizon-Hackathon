from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import Field, field_validator

from app.models.enums import AgentKind, AgentStatus, ServiceCategory
from app.schemas.common import AssetSymbol, EthAddress, ORMModel, PositiveAmount, StrictModel


class UserOut(ORMModel):
    id: uuid.UUID
    email: str | None
    full_name: str | None
    avatar_url: str | None
    wallet_address: str | None
    role: str
    created_at: datetime


class UserUpdate(StrictModel):
    full_name: str | None = Field(default=None, max_length=200)
    avatar_url: str | None = Field(default=None, max_length=2048)
    wallet_address: EthAddress | None = None

    @field_validator("avatar_url")
    @classmethod
    def _https(cls, v: str | None) -> str | None:
        if v and not v.lower().startswith("https://"):
            raise ValueError("avatar_url must be an https URL")
        return v


class AgentCreate(StrictModel):
    name: str = Field(min_length=2, max_length=120)
    description: str = Field(default="", max_length=4000)
    wallet_address: EthAddress
    category: ServiceCategory
    capabilities: list[str] = Field(default_factory=list, max_length=25)

    @field_validator("capabilities")
    @classmethod
    def _caps(cls, v: list[str]) -> list[str]:
        return [c.strip()[:80] for c in v if c.strip()]


class AgentUpdate(StrictModel):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    description: str | None = Field(default=None, max_length=4000)
    wallet_address: EthAddress | None = None
    category: ServiceCategory | None = None
    capabilities: list[str] | None = Field(default=None, max_length=25)
    status: AgentStatus | None = None  # owners may only toggle active/inactive; enforced in service


class AgentOut(ORMModel):
    id: uuid.UUID
    owner_id: uuid.UUID | None
    kind: AgentKind
    is_demo: bool
    name: str
    description: str
    wallet_address: str
    category: ServiceCategory
    capabilities: list[str]
    status: AgentStatus
    onchain_registration_reference: str | None
    reputation: float | None = None
    created_at: datetime


class ServiceCreate(StrictModel):
    provider_agent_id: uuid.UUID
    name: str = Field(min_length=2, max_length=160)
    description: str = Field(default="", max_length=4000)
    price: PositiveAmount
    payment_asset: AssetSymbol
    is_available: bool = True
    delivery_estimate_minutes: int = Field(default=60, ge=1, le=60 * 24 * 30)


class ServiceUpdate(StrictModel):
    name: str | None = Field(default=None, min_length=2, max_length=160)
    description: str | None = Field(default=None, max_length=4000)
    price: PositiveAmount | None = None
    payment_asset: AssetSymbol | None = None
    is_available: bool | None = None
    delivery_estimate_minutes: int | None = Field(default=None, ge=1, le=60 * 24 * 30)


class ServiceOut(ORMModel):
    id: uuid.UUID
    provider_agent_id: uuid.UUID
    name: str
    description: str
    price: Decimal
    payment_asset: str
    is_available: bool
    delivery_estimate_minutes: int
    created_at: datetime
