"""Payment Guardian: deterministic financial validation. The AI cannot bypass or influence it.

`PaymentGuardian.validate` collects *all* failed rules so the user sees every problem at once.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from eth_utils import is_address
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.errors import UnprocessableError
from app.models import Agent, PaymentIntent, ProcurementRequest, Profile, Quotation, SpendingPolicy
from app.models.enums import ACTIVE_PAYMENT_STATES, AgentStatus, ProcurementStatus, QuotationStatus
from app.payments.conditions import ValidatedConditions
from app.utils.common import as_utc, utcnow


@dataclass
class RuleFailure:
    rule: str
    message: str

    def as_dict(self) -> dict[str, str]:
        return {"rule": self.rule, "message": self.message}


class PaymentValidationError(UnprocessableError):
    code = "payment_validation_failed"

    def __init__(self, failures: list[RuleFailure]):
        super().__init__(
            "Payment validation failed: " + "; ".join(f.rule for f in failures),
            details=[f.as_dict() for f in failures],
        )
        self.failures = failures


def _start_of_utc_day(now: datetime) -> datetime:
    return now.astimezone(UTC).replace(hour=0, minute=0, second=0, microsecond=0)


class PaymentGuardian:
    def __init__(self, db: AsyncSession, settings: Settings):
        self.db = db
        self.settings = settings

    async def daily_spent(
        self, user_id: uuid.UUID, asset: str, now: datetime, exclude_intent_id: uuid.UUID | None = None
    ) -> Decimal:
        q = select(func.coalesce(func.sum(PaymentIntent.amount), 0)).where(
            PaymentIntent.buyer_id == user_id,
            PaymentIntent.asset == asset,
            PaymentIntent.status.in_([s.value for s in ACTIVE_PAYMENT_STATES]),
            PaymentIntent.created_at >= _start_of_utc_day(now),
        )
        if exclude_intent_id:
            q = q.where(PaymentIntent.id != exclude_intent_id)
        return Decimal(str((await self.db.execute(q)).scalar_one()))

    async def validate(
        self,
        *,
        user: Profile,
        request: ProcurementRequest,
        quotation: Quotation,
        policy: SpendingPolicy | None,
        now: datetime | None = None,
        exclude_intent_id: uuid.UUID | None = None,
    ) -> ValidatedConditions:
        now = now or utcnow()
        s = self.settings
        fails: list[RuleFailure] = []

        def fail(rule: str, msg: str) -> None:
            fails.append(RuleFailure(rule, msg))

        # --- authorization / association ---------------------------------------------------------
        if request.buyer_id != user.id:
            fail("request_ownership", "Procurement request does not belong to the user")
        if quotation.request_id != request.id:
            fail("quotation_association", "Quotation does not belong to this procurement request")
        if request.selected_quotation_id != quotation.id or request.selected_provider_id != quotation.provider_agent_id:
            fail("provider_selection", "Quotation is not the provider selected for this request")
        if request.status not in (ProcurementStatus.SELECTED.value, ProcurementStatus.PAYMENT_PENDING.value):
            fail("request_status", f"Request status '{request.status}' does not allow payment")
        if request.expires_at and as_utc(request.expires_at) <= now:
            fail("request_expired", "Procurement request has expired")
        if quotation.status != QuotationStatus.ACCEPTED.value:
            fail("quotation_status", f"Quotation status '{quotation.status}' is not accepted")
        if as_utc(quotation.expires_at) <= now:
            fail("quotation_expired", "Quotation has expired")

        # --- provider / recipient -----------------------------------------------------------------
        agent = await self.db.get(Agent, quotation.provider_agent_id)
        if agent is None:
            fail("provider_exists", "Provider agent no longer exists")
        else:
            if agent.status != AgentStatus.ACTIVE.value:
                fail("provider_active", "Provider agent is not active")
            if agent.wallet_address.lower() != quotation.pay_to_address.lower():
                fail("recipient_changed", "Provider wallet changed since the quotation was issued")
        if not is_address(quotation.pay_to_address) or int(quotation.pay_to_address, 16) == 0:
            fail("recipient_valid", "Recipient address is invalid")
        if user.wallet_address and user.wallet_address.lower() == quotation.pay_to_address.lower():
            fail("self_payment", "Recipient is the buyer's own wallet")

        # --- amount / asset / network -------------------------------------------------------------
        amount = Decimal(str(quotation.price))
        if amount <= 0:
            fail("amount_positive", "Amount must be greater than zero")
        if amount > Decimal(str(request.max_budget)):
            fail("budget_exceeded", "Quotation price exceeds the request budget")
        if quotation.payment_asset != request.budget_asset:
            fail("asset_mismatch", "Quotation asset differs from the request budget asset")
        if quotation.payment_asset not in s.SUPPORTED_ASSETS:
            fail("asset_supported", f"Asset {quotation.payment_asset} is not supported by the platform")
        if quotation.chain_id != s.HSK_CHAIN_ID or quotation.chain_id not in s.ALLOWED_CHAIN_IDS:
            fail("network_supported", f"Chain {quotation.chain_id} is not allowed")

        # --- user spending policy -----------------------------------------------------------------
        if policy is None:
            fail("policy_missing", "No spending policy configured; create one before paying")
        elif not policy.enabled:
            fail("policy_disabled", "Spending policy is disabled")
        else:
            if amount > Decimal(str(policy.max_transaction_amount)):
                fail("max_transaction_amount", "Amount exceeds the per-transaction limit")
            if quotation.payment_asset not in policy.allowed_assets:
                fail("policy_asset", "Asset is not permitted by the spending policy")
            if quotation.chain_id not in policy.allowed_chain_ids:
                fail("policy_network", "Network is not permitted by the spending policy")
            if not policy.allow_all_agents and str(quotation.provider_agent_id) not in policy.permitted_agent_ids:
                fail("policy_agent", "Provider agent is not on the permitted-agents list")
            spent = await self.daily_spent(user.id, quotation.payment_asset, now, exclude_intent_id)
            if spent + amount > Decimal(str(policy.daily_spending_limit)):
                fail(
                    "daily_limit",
                    f"Daily spending limit exceeded (already committed {spent} {quotation.payment_asset})",
                )

        if fails or agent is None or policy is None:
            raise PaymentValidationError(fails)

        expires = min(
            as_utc(quotation.expires_at),
            now + timedelta(minutes=s.PAYMENT_INTENT_TTL_MINUTES),
            *( [as_utc(request.expires_at)] if request.expires_at else [] ),
        )
        return ValidatedConditions(
            request_id=request.id,
            quotation_id=quotation.id,
            buyer_id=user.id,
            provider_agent_id=agent.id,
            provider_name=agent.name,
            amount=amount,
            asset=quotation.payment_asset,
            chain_id=quotation.chain_id,
            recipient=quotation.pay_to_address,
            expires_at=expires,
            service_id=quotation.service_id,
            policy_id=policy.id,
            policy_version_ts=as_utc(policy.updated_at),  # type: ignore[arg-type]
        )
