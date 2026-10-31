"""HSP authentication, exactly as specified in the official docs (docs/en/authentication.md, cart-mandate.md).

Layer 1 -- HMAC-SHA256 request signing on every /api/v1/merchant/* call:
    headers: X-App-Key, X-Signature, X-Timestamp (unix s), X-Nonce (UUID or 12-32 hex)
    bodyHash  = hex(SHA256(canonicalJSON(body)))          ("" when there is no body)
    message   = "{METHOD}\\n{PATH}\\n{QUERY}\\n{bodyHash}\\n{timestamp}\\n{nonce}"
    signature = hex(HMAC_SHA256(app_secret, message))
    skew +-300 s; nonce unique per app_key within 5 min.

Layer 2 -- ES256K JWT (`merchant_authorization`):
    header {"alg":"ES256K","typ":"JWT"}; claims iss, sub (merchant name), aud "HashkeyMerchant",
    iat, exp, jti, cart_hash = hex(SHA256(canonicalJSON(cart_mandate.contents))).

Canonical JSON: keys sorted recursively, compact separators, arrays keep order. (The docs also cite RFC 8785;
for this payload -- strings, ints, no floats -- sorted-keys compact JSON is byte-identical to JCS. Do not put
floats or astral-plane keys into a cart.)
"""

from __future__ import annotations

import hashlib
import hmac
import json
import re
import time
import uuid
from dataclasses import dataclass
from typing import Any

import jwt

from app.core.config import Settings
from app.integrations.hsp.exceptions import HSPNotConfiguredError

_NONCE_RE = re.compile(r"^[0-9a-fA-F]{12,32}$|^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")


def canonical_json(obj: Any) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)


def sha256_hex(data: str | bytes) -> str:
    return hashlib.sha256(data.encode() if isinstance(data, str) else data).hexdigest()


def body_hash(body: Any | None) -> str:
    return "" if body is None else sha256_hex(canonical_json(body))


def cart_hash(contents: dict[str, Any]) -> str:
    return sha256_hex(canonical_json(contents))


def signing_message(method: str, path: str, query: str, body_hash_hex: str, timestamp: int | str, nonce: str) -> str:
    return "\n".join([method.upper(), path, query, body_hash_hex, str(timestamp), nonce])


def hmac_signature(app_secret: str, message: str) -> str:
    return hmac.new(app_secret.encode(), message.encode(), hashlib.sha256).hexdigest()


@dataclass(frozen=True)
class SignedRequest:
    headers: dict[str, str]
    body_bytes: bytes | None
    query: str


def sign_request(
    *, app_key: str, app_secret: str, method: str, path: str, query: str = "", body: Any | None = None,
    timestamp: int | None = None, nonce: str | None = None,
) -> SignedRequest:
    """Build the four auth headers. A fresh timestamp+nonce MUST be used for every attempt (replay protection)."""
    if not app_key or not app_secret:
        raise HSPNotConfiguredError("HSP app credentials are not configured")
    ts = int(time.time()) if timestamp is None else timestamp
    nonce = nonce or uuid.uuid4().hex
    if not _NONCE_RE.match(nonce):
        raise ValueError("nonce must be a UUID or 12-32 hex characters")
    # The bytes we SEND are the canonical JSON that we hashed, so signer and verifier cannot disagree.
    body_bytes = canonical_json(body).encode() if body is not None else None
    msg = signing_message(method, path, query, body_hash(body), ts, nonce)
    headers = {
        "X-App-Key": app_key,
        "X-Signature": hmac_signature(app_secret, msg),
        "X-Timestamp": str(ts),
        "X-Nonce": nonce,
    }
    if body_bytes is not None:
        headers["Content-Type"] = "application/json"
    return SignedRequest(headers=headers, body_bytes=body_bytes, query=query)


def build_merchant_authorization(contents: dict[str, Any], settings: Settings, *, now: int | None = None) -> tuple[str, dict]:
    """Return (compact ES256K JWT, claims). The private key is read from server-side config only."""
    pem = settings.merchant_private_key_pem()
    if not pem:
        raise HSPNotConfiguredError("HSP merchant signing key is not configured")
    iat = int(time.time()) if now is None else now
    claims = {
        "iss": settings.HSP_MERCHANT_NAME,
        "sub": settings.HSP_MERCHANT_NAME,
        "aud": settings.HSP_JWT_AUDIENCE,
        "iat": iat,
        "exp": iat + settings.HSP_JWT_TTL_SECONDS,
        "jti": f"JWT-{iat}-{uuid.uuid4().hex[:12]}",
        "cart_hash": cart_hash(contents),
    }
    try:
        token = jwt.encode(claims, pem, algorithm="ES256K", headers={"typ": "JWT"})
    except Exception as exc:  # bad PEM / wrong curve -- never echo key material
        raise HSPNotConfiguredError("HSP merchant signing key is invalid (expected secp256k1 PEM)") from exc
    return token, claims
