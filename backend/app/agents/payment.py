"""Payment Agent.

Authority lives in deterministic code (PaymentGuardian / PaymentService). This agent:
  * receives payment conditions (from a quotation) and validates required payment information,
  * prepares the structured payment data handed to the HSP integration (Step 2),
  * coordinates authorization and tracks workflow state,
  * optionally asks Claude for a plain-language explanation (never authoritative).
"""

from __future__ import annotations

import logging
import uuid
from typing import Any

from app.agents.common import wrap_untrusted
from app.agents.prompts import PAYMENT_SYSTEM
from app.agents.schemas import PaymentExplanation
from app.core.config import Settings
from app.core.errors import UpstreamError
from app.integrations.anthropic.client import ClaudeClient
from app.models import PaymentIntent, Profile
from app.payments.service import PaymentService

log = logging.getLogger(__name__)

REQUIRED_PAYMENT_FIELDS = ("recipient", "amount", "asset", "chain_id", "expires_at", "provider_agent_id")


class PaymentAgent:
    def __init__(self, claude: ClaudeClient, payments: PaymentService, settings: Settings):
        self.claude = claude
        self.payments = payments
        self.settings = settings

    @staticmethod
    def missing_fields(snapshot: dict[str, Any]) -> list[str]:
        return [f for f in REQUIRED_PAYMENT_FIELDS if not snapshot.get(f)]

    async def prepare_authorization(self, intent_id: uuid.UUID, user: Profile):  # noqa: ANN201
        intent, review = await self.payments.authorize(intent_id, user)
        missing = self.missing_fields(intent.conditions_snapshot)
        if missing:  # defensive: guardian guarantees these, but never proceed on gaps
            raise ValueError(f"missing payment fields: {missing}")
        return intent, review

    def workflow_status(self, intent: PaymentIntent) -> dict[str, Any]:
        return {
            "payment_intent_id": str(intent.id),
            "status": intent.status,
            "settled_and_verified": False if intent.status != "SETTLED" else True,
            "next_step": {
                "VALIDATED": "request_authorization",
                "AWAITING_SIGNATURE": "create_hsp_order (/mandate) then user signs in HSP checkout (payment_url)",
                "SIGNED": "await_hsp_status",
                "SUBMITTED": "await_hsp_status",
                "PENDING": "verify_settlement (/verify)",
            }.get(intent.status, "none"),
        }

    async def explain(self, user_id: uuid.UUID, intent: PaymentIntent) -> tuple[PaymentExplanation, str]:
        snap = intent.conditions_snapshot
        facts = (
            f"Pay {snap.get('amount')} {snap.get('asset')} to {snap.get('recipient')} on chain "
            f"{snap.get('chain_id')} for provider '{snap.get('provider_name')}'. Expires {snap.get('expires_at')}."
        )
        if self.claude.configured:
            try:
                out = await self.claude.run_structured(
                    user_id=user_id, system=PAYMENT_SYSTEM,
                    user_content="Explain these validated payment conditions.\n" + wrap_untrusted("conditions", facts),
                    output_model=PaymentExplanation, output_description="Plain-language explanation.",
                )
                return out, "claude"
            except UpstreamError as exc:
                log.warning("Payment explanation fell back: %s", exc.code)
        return (
            PaymentExplanation(
                summary=facts,
                points_to_check=[
                    "Recipient address matches the provider you selected",
                    "Amount and asset match the quotation",
                    "Network is HashKey Chain as expected",
                    "Nothing has been paid yet; settlement is only confirmed after HSP verification",
                ],
            ),
            "template",
        )
