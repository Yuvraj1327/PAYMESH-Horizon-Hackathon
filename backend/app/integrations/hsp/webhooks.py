"""Webhook authentication (docs/en/webhook.md).

    X-Signature: t=<unix_ts>,v1=<hex>
    v1 = hex(HMAC_SHA256(app_secret, f"{t}.{raw_request_body}"))     tolerance +-300 s, constant-time compare.

The payload is only a *notification*: PayMesh never settles from a webhook body; it re-queries the gateway
(and the chain) before changing a payment to SETTLED.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import time

from pydantic import ValidationError

from app.integrations.hsp.exceptions import HSPWebhookError
from app.integrations.hsp.schemas import HSPWebhookPayload

TOLERANCE_SECONDS = 300
MAX_BODY_BYTES = 64 * 1024


def sign_webhook(app_secret: str, raw_body: bytes, timestamp: int) -> str:
    """Produce the header value (used by tests and local tooling; the gateway signs real deliveries)."""
    mac = hmac.new(app_secret.encode(), f"{timestamp}.".encode() + raw_body, hashlib.sha256).hexdigest()
    return f"t={timestamp},v1={mac}"


def verify_webhook(header: str | None, raw_body: bytes, app_secret: str, *, now: int | None = None) -> HSPWebhookPayload:
    if not app_secret:
        raise HSPWebhookError("Webhook verification is not configured")
    if not header:
        raise HSPWebhookError("Missing X-Signature")
    if len(raw_body) > MAX_BODY_BYTES:
        raise HSPWebhookError("Payload too large")
    ts: int | None = None
    received: str | None = None
    for part in header.split(","):
        part = part.strip()
        if part.startswith("t="):
            try:
                ts = int(part[2:])
            except ValueError:
                raise HSPWebhookError("Malformed X-Signature") from None
        elif part.startswith("v1="):
            received = part[3:]
    if ts is None or not received:
        raise HSPWebhookError("Malformed X-Signature")
    current = int(time.time()) if now is None else now
    if abs(current - ts) > TOLERANCE_SECONDS:
        raise HSPWebhookError("Signature timestamp outside tolerance")
    expected = hmac.new(app_secret.encode(), f"{ts}.".encode() + raw_body, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, received.lower()):
        raise HSPWebhookError("Signature mismatch")
    try:
        return HSPWebhookPayload.model_validate(json.loads(raw_body))
    except (ValueError, ValidationError) as exc:
        raise HSPWebhookError("Malformed webhook payload") from exc
