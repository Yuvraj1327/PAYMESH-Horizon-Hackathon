from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import CheckConstraint, ForeignKey, Index, Integer, String, Text, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base, JSONType, Money, UTCDateTime, created_col, enum_check, updated_col
from app.models.enums import AgentRole, DeliveryStatus, MessageType, ProcurementStatus, QuotationStatus


class ProcurementRequest(Base):
    __tablename__ = "procurement_requests"
    __table_args__ = (
        enum_check("status", ProcurementStatus, "ck_procurement_status"),
        enum_check("delivery_status", DeliveryStatus, "ck_procurement_delivery_status"),
        CheckConstraint("max_budget > 0", name="ck_procurement_budget_positive"),
        Index("ix_procurement_buyer_status", "buyer_id", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    buyer_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("profiles.id", ondelete="CASCADE"), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    category: Mapped[str] = mapped_column(String(32), nullable=False)
    requirements: Mapped[dict] = mapped_column(JSONType, default=dict, nullable=False)
    max_budget: Mapped[Decimal] = mapped_column(Money, nullable=False)
    budget_asset: Mapped[str] = mapped_column(String(16), nullable=False)
    status: Mapped[str] = mapped_column(String(24), default=ProcurementStatus.CREATED.value, nullable=False)
    selected_provider_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("agents.id", ondelete="SET NULL"))
    selected_quotation_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("quotations.id", ondelete="SET NULL", use_alter=True, name="fk_procurement_selected_quotation")
    )
    recommendation: Mapped[dict | None] = mapped_column(JSONType)
    delivery_status: Mapped[str] = mapped_column(
        String(16), default=DeliveryStatus.NOT_STARTED.value, nullable=False
    )
    delivery_result: Mapped[dict | None] = mapped_column(JSONType)
    delivered_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    expires_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    created_at: Mapped[datetime] = created_col()
    updated_at: Mapped[datetime] = updated_col()


class Quotation(Base):
    __tablename__ = "quotations"
    __table_args__ = (
        enum_check("status", QuotationStatus, "ck_quotations_status"),
        CheckConstraint("price > 0", name="ck_quotations_price_positive"),
        UniqueConstraint("request_id", "provider_agent_id", name="uq_quotation_request_provider"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    request_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("procurement_requests.id", ondelete="CASCADE"), index=True, nullable=False
    )
    provider_agent_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("agents.id", ondelete="RESTRICT"), index=True, nullable=False
    )
    service_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("services.id", ondelete="SET NULL"))
    price: Mapped[Decimal] = mapped_column(Money, nullable=False)
    payment_asset: Mapped[str] = mapped_column(String(16), nullable=False)
    chain_id: Mapped[int] = mapped_column(Integer, nullable=False)
    # Payout address captured at quote time; payment validation re-checks it against the agent.
    pay_to_address: Mapped[str] = mapped_column(String(42), nullable=False)
    delivery_estimate_minutes: Mapped[int] = mapped_column(Integer, nullable=False)
    response_details: Mapped[dict] = mapped_column(JSONType, default=dict, nullable=False)
    status: Mapped[str] = mapped_column(String(16), default=QuotationStatus.SUBMITTED.value, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False)
    created_at: Mapped[datetime] = created_col()


class AgentMessage(Base):
    """A2A message log shown in the agent console. Content is untrusted data."""

    __tablename__ = "agent_messages"
    __table_args__ = (
        enum_check("sender_role", AgentRole, "ck_agent_messages_sender_role"),
        enum_check("receiver_role", AgentRole, "ck_agent_messages_receiver_role"),
        enum_check("message_type", MessageType, "ck_agent_messages_type"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    request_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("procurement_requests.id", ondelete="CASCADE"), index=True
    )
    sender_role: Mapped[str] = mapped_column(String(24), nullable=False)
    receiver_role: Mapped[str] = mapped_column(String(24), nullable=False)
    sender_agent_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("agents.id", ondelete="SET NULL"), index=True)
    receiver_agent_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("agents.id", ondelete="SET NULL"), index=True
    )
    message_type: Mapped[str] = mapped_column(String(32), nullable=False)
    payload: Mapped[dict] = mapped_column(JSONType, default=dict, nullable=False)
    created_at: Mapped[datetime] = created_col()


_ = (Integer, Text)  # silence unused-import linters
