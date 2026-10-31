"""Cart Mandate construction (merchant-side payment order) per docs/en/cart-mandate.md.

PayMesh is the merchant of record. The Cart Mandate is built ONLY from the immutable, guardian-validated
payment-condition snapshot of the intent -- never from live quotation/agent data or AI output -- so conditions
cannot drift between user review and the order registered with HSP.

The payer-side **Payment Mandate** is produced by the user's wallet in HSP's hosted checkout (EIP-712 signature,
EIP-3009 for USDC / Permit2 for USDT per the official token table) and submitted to the gateway there.
"""

from __future__ import annotations

import re
from datetime import datetime
from decimal import Decimal
from typing import Any

from app.core.config import Settings
from app.core.errors import UnprocessableError
from app.integrations.hsp.authentication import build_merchant_authorization, cart_hash
from app.integrations.hsp.tokens import HSPToken, find_token
from app.utils.common import as_utc

X402 = "https://www.x402.org/"
_LABEL_CLEAN = re.compile(r"[^\w\s\-\.,()&'/]")


def cart_mandate_id_for(intent_id: Any) -> str:
    """ID1 -- deterministic per intent so order creation is naturally one-per-intent (HSP rejects duplicates)."""
    return f"PM-{intent_id}"


def payment_request_id_for(intent_id: Any) -> str:
    """ID2 -- 1:1 with cart_mandate_id for one-time orders."""
    return f"PMR-{intent_id}"


def _rfc3339(dt: datetime) -> str:
    return as_utc(dt).strftime("%Y-%m-%dT%H:%M:%SZ")  # type: ignore[union-attr]


def _usd(amount: Decimal) -> str:
    # Stablecoin amount treated as USD 1:1 (the cart currency must be USD per the docs).
    return format(Decimal(str(amount)).normalize(), "f") if Decimal(str(amount)) != 0 else "0"


def resolve_token(snapshot: dict[str, Any], settings: Settings) -> HSPToken:
    token = find_token(int(snapshot["chain_id"]), str(snapshot["asset"]))
    if token is None:
        raise UnprocessableError(
            f"{snapshot['asset']} on chain {snapshot['chain_id']} is not an HSP-supported token", code="hsp_token_unsupported"
        )
    return token


def build_cart_contents(snapshot: dict[str, Any], intent_id: Any, settings: Settings, *, cart_expiry: datetime) -> dict[str, Any]:
    """Build `cart_mandate.contents` from an intent's conditions snapshot."""
    token = resolve_token(snapshot, settings)
    amount = Decimal(str(snapshot["amount"]))
    if amount <= 0:
        raise UnprocessableError("Amount must be positive", code="invalid_amount")
    label = _LABEL_CLEAN.sub("", f"PayMesh: {snapshot.get('provider_name', 'service')}")[:80].strip() or "PayMesh order"
    value = _usd(amount)
    return {
        "id": cart_mandate_id_for(intent_id),
        "user_cart_confirmation_required": True,
        "payment_request": {
            "method_data": [
                {
                    "supported_methods": X402,
                    "data": {
                        "x402Version": 2,
                        "network": token.network,
                        "chain_id": token.chain_id,
                        "contract_address": token.address,
                        "pay_to": snapshot["recipient"],
                        "coin": token.symbol,
                    },
                }
            ],
            "details": {
                "id": payment_request_id_for(intent_id),
                "display_items": [{"label": label, "amount": {"currency": "USD", "value": value}}],
                "total": {"label": "Total", "amount": {"currency": "USD", "value": value}},
            },
        },
        "cart_expiry": _rfc3339(cart_expiry),
        "merchant_name": settings.HSP_MERCHANT_NAME,
    }


def build_order_request(
    snapshot: dict[str, Any], intent_id: Any, settings: Settings, *, cart_expiry: datetime
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Return (request_body, meta). meta has cart_hash, jwt claims id (jti) and the contents for auditing."""
    contents = build_cart_contents(snapshot, intent_id, settings, cart_expiry=cart_expiry)
    jwt_token, claims = build_merchant_authorization(contents, settings)
    body: dict[str, Any] = {"cart_mandate": {"contents": contents, "merchant_authorization": jwt_token}}
    if settings.HSP_REDIRECT_URL:
        body["redirect_url"] = settings.HSP_REDIRECT_URL
    return body, {"cart_hash": cart_hash(contents), "jti": claims["jti"], "contents": contents}


def validate_amount_rules(contents: dict[str, Any]) -> None:
    """Local mirror of the gateway's documented amount validation (rule 1; modifiers are not used by PayMesh)."""
    details = contents["payment_request"]["details"]
    total = Decimal(details["total"]["amount"]["value"])
    items = details.get("display_items") or []
    if items and sum(Decimal(i["amount"]["value"]) for i in items) != total:
        raise UnprocessableError("display_items do not sum to total", code="hsp_cart_invalid")
    if any(d["amount"]["currency"] != "USD" for d in [details["total"], *items]):
        raise UnprocessableError("cart currency must be USD", code="hsp_cart_invalid")
