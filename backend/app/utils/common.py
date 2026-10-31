"""Small shared helpers: time, hashing, canonical JSON, text hygiene."""

from __future__ import annotations

import hashlib
import json
import re
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any


def utcnow() -> datetime:
    return datetime.now(UTC)


def as_utc(dt: datetime | None) -> datetime | None:
    """SQLite returns naive datetimes; treat them as UTC."""
    if dt is None:
        return None
    return dt.replace(tzinfo=UTC) if dt.tzinfo is None else dt.astimezone(UTC)


def _default(o: Any) -> Any:
    if isinstance(o, Decimal):
        return format(o.normalize(), "f")
    if isinstance(o, datetime):
        return as_utc(o).isoformat()  # type: ignore[union-attr]
    if hasattr(o, "hex") and o.__class__.__name__ == "UUID":
        return str(o)
    raise TypeError(f"not serializable: {type(o)}")


def canonical_json(obj: Any) -> str:
    """Deterministic JSON (sorted keys, no whitespace). Used for local snapshot hashing only.

    NOTE: this is NOT the HSP/AP2 cart-hash canonicalization (RFC 8785 JCS is reported
    but unverified) -- that is a Step 2 item.
    """
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), default=_default, ensure_ascii=False)


def sha256_hex(data: str) -> str:
    return hashlib.sha256(data.encode()).hexdigest()


def to_jsonable(obj: Any) -> Any:
    """Round-trip through canonical JSON so Decimals/UUIDs/datetimes become JSON-safe."""
    return json.loads(canonical_json(obj))


_CTRL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


def clean_text(s: str, max_len: int = 4000) -> str:
    s = _CTRL.sub("", s).strip()
    return s[:max_len]
