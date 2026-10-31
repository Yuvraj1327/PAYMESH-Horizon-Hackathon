from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import CheckConstraint, ForeignKey, Index, Integer, String, Text, UniqueConstraint, Uuid, event, text
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base, JSONType, Money, UTCDateTime, created_col, enum_check, updated_col
from app.models.enums import ACTIVE_PAYMENT_STATES, PaymentStatus

_ACTIVE_SQL = "status IN (" + ", ".join(f"'{s.value}'" for s in ACTIVE_PAYMENT_STATES) + ")"

# Columns that make up the immutable payment-condition snapshot.
IMMUTABLE_INTENT_COLUMNS = (
    "request_id",
    "quotation_id",
    "buyer_id",
    "provider_agent_id",
    "amount",
    "asset",
    "chain_id",
    "recipient",
    "conditions_snapshot",
    "snapshot_hash",
    "idempotency_key",
)


class PaymentIntent(Base):
    __tablename__ = "payment_intents"
    __table_args__ = (
        enum_check("status", PaymentStatus, "ck_payment_intents_status"),
        CheckConstraint("amount > 0", name="ck_payment_intents_amount_positive"),
        UniqueConstraint("buyer_id", "idempotency_key", name="uq_payment_intent_idempotency"),
        # At most one live intent per quotation => duplicate payment prevention at the DB level.
        Index(
            "uq_payment_intent_active_quotation",
            "quotation_id",
            unique=True,
            postgresql_where=text(_ACTIVE_SQL),
            sqlite_where=text(_ACTIVE_SQL),
        ),
        Index("ix_payment_intents_buyer_status", "buyer_id", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    request_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("procurement_requests.id", ondelete="RESTRICT"), index=True, nullable=False
    )
    quotation_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("quotations.id", ondelete="RESTRICT"), nullable=False)
    buyer_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("profiles.id", ondelete="RESTRICT"), nullable=False)
    provider_agent_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("agents.id", ondelete="RESTRICT"), index=True, nullable=False
    )
    amount: Mapped[Decimal] = mapped_column(Money, nullable=False)
    asset: Mapped[str] = mapped_column(String(16), nullable=False)
    chain_id: Mapped[int] = mapped_column(Integer, nullable=False)
    recipient: Mapped[str] = mapped_column(String(42), nullable=False)
    status: Mapped[str] = mapped_column(String(24), default=PaymentStatus.DRAFT.value, nullable=False)
    conditions_snapshot: Mapped[dict] = mapped_column(JSONType, nullable=False)
    snapshot_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    idempotency_key: Mapped[str] = mapped_column(String(128), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False)
    failure_reason: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = created_col()
    updated_at: Mapped[datetime] = updated_col()


@event.listens_for(PaymentIntent, "before_update")
def _forbid_snapshot_mutation(mapper, connection, target: PaymentIntent) -> None:  # noqa: ANN001
    """Application-level guard for the immutable snapshot (a DB trigger backs this up on Postgres)."""
    from sqlalchemy import inspect

    state = inspect(target)
    for col in IMMUTABLE_INTENT_COLUMNS:
        hist = state.attrs[col].history
        if hist.has_changes() and hist.deleted:
            raise ValueError(f"payment_intents.{col} is immutable once created")


class HspPaymentFlow(Base):
    """One HSP order (Cart Mandate) per payment intent. Written only by the HSP integration; holds NO secrets
    (no app secret, no merchant key, no JWT -- only its `jti`)."""

    __tablename__ = "hsp_payment_flows"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    payment_intent_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("payment_intents.id", ondelete="RESTRICT"), unique=True, nullable=False
    )
    # Official ID model (docs): ID1 cart_mandate_id, ID2 payment_request_id, ID3 flow_id
    mandate_reference: Mapped[str] = mapped_column(String(200), unique=True, nullable=False)       # cart_mandate_id (ID1)
    payment_request_id: Mapped[str | None] = mapped_column(String(200), unique=True)               # ID2
    hsp_flow_reference: Mapped[str | None] = mapped_column(String(200), unique=True)               # flow_id (ID3)
    payment_url: Mapped[str | None] = mapped_column(Text)
    cart_hash: Mapped[str | None] = mapped_column(String(64))
    cart_expiry: Mapped[datetime | None] = mapped_column(UTCDateTime)
    merchant_jti: Mapped[str | None] = mapped_column(String(100))
    gateway_status: Mapped[str | None] = mapped_column(String(64))       # last official status seen
    order_state: Mapped[str] = mapped_column(String(24), default="creating", nullable=False)  # creating|created|create_failed|create_uncertain
    tx_hash: Mapped[str | None] = mapped_column(String(66), unique=True)
    payer_address: Mapped[str | None] = mapped_column(String(42))
    last_polled_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    last_event_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    raw_gateway_response: Mapped[dict | None] = mapped_column(JSONType)  # last gateway record, for audit
    created_at: Mapped[datetime] = created_col()
    updated_at: Mapped[datetime] = updated_col()


class PaymentReceipt(Base):
    """Verified settlement receipts only. Never written from client input, a webhook body or a simulation."""

    __tablename__ = "payment_receipts"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    payment_intent_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("payment_intents.id", ondelete="RESTRICT"), unique=True, nullable=False
    )
    receipt_reference: Mapped[str] = mapped_column(String(200), unique=True, nullable=False)
    transaction_hash: Mapped[str | None] = mapped_column(String(66), unique=True)
    settlement_status: Mapped[str] = mapped_column(String(32), nullable=False)  # official HSP status at verification
    chain_id: Mapped[int | None] = mapped_column(Integer)
    token_address: Mapped[str | None] = mapped_column(String(42))
    payer_address: Mapped[str | None] = mapped_column(String(42))
    recipient: Mapped[str | None] = mapped_column(String(42))
    verified_amount: Mapped[Decimal | None] = mapped_column(Money)
    block_number: Mapped[int | None] = mapped_column(Integer)
    verification_details: Mapped[dict] = mapped_column(JSONType, default=dict, nullable=False)
    verified_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    created_at: Mapped[datetime] = created_col()


class HspWebhookEvent(Base):
    """Every webhook delivery that passed signature verification (dedupe + audit). Bodies are notifications only."""

    __tablename__ = "hsp_webhook_events"
    __table_args__ = (Index("ix_hsp_webhook_pr_created", "payment_request_id", "created_at"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    body_sha256: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)   # exact-duplicate guard
    payment_request_id: Mapped[str] = mapped_column(String(200), nullable=False)
    status: Mapped[str] = mapped_column(String(64), nullable=False)
    payload: Mapped[dict] = mapped_column(JSONType, nullable=False)
    outcome: Mapped[str | None] = mapped_column(String(64))       # processed | ignored_unknown_order | error
    processed_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    created_at: Mapped[datetime] = created_col()


class TransactionEvent(Base):
    """Append-only audit log for payment lifecycle and other security-relevant actions."""

    __tablename__ = "transaction_events"
    __table_args__ = (Index("ix_transaction_events_intent_created", "payment_intent_id", "created_at"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    payment_intent_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("payment_intents.id", ondelete="RESTRICT"), index=True
    )
    actor_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, index=True)
    event_type: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    event_data: Mapped[dict] = mapped_column(JSONType, default=dict, nullable=False)
    request_id: Mapped[str | None] = mapped_column(String(64))  # HTTP request correlation id
    created_at: Mapped[datetime] = created_col()


_ = updated_col
