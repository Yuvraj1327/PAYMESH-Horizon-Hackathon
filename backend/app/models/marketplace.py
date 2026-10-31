from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import Boolean, CheckConstraint, ForeignKey, Integer, String, Text, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base, JSONType, Money, created_col, enum_check, updated_col
from app.models.enums import AgentKind, AgentStatus, ServiceCategory


class Agent(Base):
    __tablename__ = "agents"
    __table_args__ = (
        enum_check("kind", AgentKind, "ck_agents_kind"),
        enum_check("status", AgentStatus, "ck_agents_status"),
        enum_check("category", ServiceCategory, "ck_agents_category"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    # NULL for platform-operated demo agents.
    owner_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("profiles.id", ondelete="SET NULL"), index=True
    )
    kind: Mapped[str] = mapped_column(String(16), default=AgentKind.EXTERNAL.value, nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="", nullable=False)
    wallet_address: Mapped[str] = mapped_column(String(42), index=True, nullable=False)
    category: Mapped[str] = mapped_column(String(32), index=True, nullable=False)
    capabilities: Mapped[list] = mapped_column(JSONType, default=list, nullable=False)
    status: Mapped[str] = mapped_column(String(16), default=AgentStatus.ACTIVE.value, index=True, nullable=False)
    # "<chainId>:<registryAddress>:<agentIdBytes32>" once verified on-chain by the backend.
    onchain_registration_reference: Mapped[str | None] = mapped_column(String(200))
    created_at: Mapped[datetime] = created_col()
    updated_at: Mapped[datetime] = updated_col()

    @property
    def is_demo(self) -> bool:
        return self.kind == AgentKind.DEMO.value


class Service(Base):
    __tablename__ = "services"
    __table_args__ = (CheckConstraint("price > 0", name="ck_services_price_positive"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    provider_agent_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("agents.id", ondelete="CASCADE"), index=True, nullable=False
    )
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="", nullable=False)
    price: Mapped[Decimal] = mapped_column(Money, nullable=False)
    payment_asset: Mapped[str] = mapped_column(String(16), nullable=False)
    is_available: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    delivery_estimate_minutes: Mapped[int] = mapped_column(Integer, default=60, nullable=False)
    created_at: Mapped[datetime] = created_col()
    updated_at: Mapped[datetime] = updated_col()


class Review(Base):
    __tablename__ = "reviews"
    __table_args__ = (
        CheckConstraint("rating BETWEEN 1 AND 5", name="ck_reviews_rating"),
        UniqueConstraint("reviewer_id", "request_id", name="uq_reviews_reviewer_request"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    provider_agent_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("agents.id", ondelete="CASCADE"), index=True, nullable=False
    )
    reviewer_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("profiles.id", ondelete="CASCADE"), nullable=False)
    request_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("procurement_requests.id", ondelete="CASCADE"), nullable=False
    )
    rating: Mapped[int] = mapped_column(Integer, nullable=False)
    feedback: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = created_col()
