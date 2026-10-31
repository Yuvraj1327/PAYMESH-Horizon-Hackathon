"""Immutable payment-condition snapshots."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from typing import Any

from app.utils.common import canonical_json, sha256_hex, to_jsonable


@dataclass(frozen=True)
class ValidatedConditions:
    request_id: uuid.UUID
    quotation_id: uuid.UUID
    buyer_id: uuid.UUID
    provider_agent_id: uuid.UUID
    provider_name: str
    amount: Decimal
    asset: str
    chain_id: int
    recipient: str
    expires_at: datetime
    service_id: uuid.UUID | None
    policy_id: uuid.UUID
    policy_version_ts: datetime

    def snapshot(self) -> dict[str, Any]:
        return to_jsonable(
            {
                "schema": "paymesh.payment_conditions.v1",
                "request_id": self.request_id,
                "quotation_id": self.quotation_id,
                "buyer_id": self.buyer_id,
                "provider_agent_id": self.provider_agent_id,
                "provider_name": self.provider_name,
                "service_id": self.service_id,
                "amount": self.amount,
                "asset": self.asset,
                "chain_id": self.chain_id,
                "recipient": self.recipient,
                "expires_at": self.expires_at,
                "policy_id": self.policy_id,
                "policy_updated_at": self.policy_version_ts,
            }
        )


def snapshot_hash(snapshot: dict[str, Any]) -> str:
    return sha256_hex(canonical_json(snapshot))
