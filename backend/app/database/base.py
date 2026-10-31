"""Declarative base, shared column types and enum helpers."""

from __future__ import annotations

import enum
import uuid
from datetime import datetime

from sqlalchemy import JSON, CheckConstraint, DateTime, Numeric, String, Uuid, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy.types import TypeDecorator

from app.utils.common import as_utc, utcnow

JSONType = JSON().with_variant(JSONB(), "postgresql")
Money = Numeric(38, 18)


class UTCDateTime(TypeDecorator):
    """Timezone-aware datetimes everywhere (SQLite drops tzinfo; normalize on load)."""

    impl = DateTime(timezone=True)
    cache_ok = True

    def process_bind_param(self, value, dialect):  # noqa: ANN001
        return as_utc(value)

    def process_result_value(self, value, dialect):  # noqa: ANN001
        return as_utc(value)


class Base(DeclarativeBase):
    pass


class StrEnum(str, enum.Enum):
    def __str__(self) -> str:  # pragma: no cover
        return self.value


def enum_check(column: str, enum_cls: type[enum.Enum], name: str) -> CheckConstraint:
    values = ", ".join(f"'{e.value}'" for e in enum_cls)
    return CheckConstraint(f"{column} IN ({values})", name=name)


def pk() -> Mapped[uuid.UUID]:
    return mapped_column(Uuid, primary_key=True, default=uuid.uuid4)


def created_col() -> Mapped[datetime]:
    return mapped_column(UTCDateTime, default=utcnow, server_default=func.now(), nullable=False)


def updated_col() -> Mapped[datetime]:
    return mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow, server_default=func.now(), nullable=False)


def status_col(default: str, length: int = 32) -> Mapped[str]:
    return mapped_column(String(length), default=default, nullable=False)
