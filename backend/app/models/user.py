from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import Boolean, ForeignKey, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base, JSONType, Money, created_col, enum_check, updated_col
from app.models.enums import UserRole


class Profile(Base):
    """1:1 with Supabase auth.users. `id` is the auth user id (JWT `sub`)."""

    __tablename__ = "profiles"
    __table_args__ = (enum_check("role", UserRole, "ck_profiles_role"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    full_name: Mapped[str | None] = mapped_column(String(200))
    email: Mapped[str | None] = mapped_column(String(320), index=True)
    avatar_url: Mapped[str | None] = mapped_column(String(2048))
    wallet_address: Mapped[str | None] = mapped_column(String(42), index=True)
    role: Mapped[str] = mapped_column(String(16), default=UserRole.USER.value, nullable=False)
    created_at: Mapped[datetime] = created_col()
    updated_at: Mapped[datetime] = updated_col()


class SpendingPolicy(Base):
    __tablename__ = "spending_policies"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("profiles.id", ondelete="CASCADE"), unique=True, nullable=False
    )
    max_transaction_amount: Mapped[Decimal] = mapped_column(Money, nullable=False)
    daily_spending_limit: Mapped[Decimal] = mapped_column(Money, nullable=False)
    permitted_agent_ids: Mapped[list] = mapped_column(JSONType, default=list, nullable=False)
    allow_all_agents: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    allowed_assets: Mapped[list] = mapped_column(JSONType, default=list, nullable=False)
    allowed_chain_ids: Mapped[list] = mapped_column(JSONType, default=list, nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = created_col()
    updated_at: Mapped[datetime] = updated_col()
