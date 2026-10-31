"""HSP schemas -- built ONLY from the official HashKey Merchant docs (docs/en/*.md @ 8460bdd).

Extra fields from the gateway are preserved (`extra="allow"`) but never trusted or relied on.

NOT modelled on purpose (undocumented in the public reference): the payer-side PaymentMandate submission
(`/api/v1/payment/pay-mandate`) request body. The hosted checkout (`payment_url`) builds and submits it.
"""

from __future__ import annotations

from enum import Enum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class HSPStatus(str, Enum):
    """Official payment states (docs/en/cart-mandate.md, 'Payment state machine')."""

    REQUIRED = "payment-required"
    SUBMITTED = "payment-submitted"
    VERIFIED = "payment-verified"
    PROCESSING = "payment-processing"
    INCLUDED = "payment-included"
    SAFE = "payment-safe"
    FINALIZED = "payment-finalized"
    FAILED = "payment-failed"


# progress order on the success path
STATUS_RANK = {
    HSPStatus.REQUIRED.value: 0,
    HSPStatus.SUBMITTED.value: 1,
    HSPStatus.VERIFIED.value: 2,
    HSPStatus.PROCESSING.value: 3,
    HSPStatus.INCLUDED.value: 4,
    HSPStatus.SAFE.value: 5,
    HSPStatus.FINALIZED.value: 6,
}
TERMINAL_STATUSES = frozenset({HSPStatus.FINALIZED.value, HSPStatus.FAILED.value})


class HSPOrderResult(BaseModel):
    """`POST /merchant/orders` -> data. NOTE: the API reference lists payment_request_id, payment_url and
    multi_pay (the docs overview also mentions flow_id, but the reference response does not include it;
    flow_id (ID3) is obtained from payment queries)."""

    model_config = ConfigDict(extra="allow")

    payment_request_id: str
    payment_url: str
    multi_pay: bool = False


class HSPPaymentRecord(BaseModel):
    """`GET /merchant/payments` record (PaymentItemResponse). Amount/fee fields are token-denominated decimal strings."""

    model_config = ConfigDict(extra="allow")

    status: str
    content_id: str | None = None            # cart_mandate.contents.id (ID1)
    payment_request_id: str | None = None    # ID2
    request_id: str | None = None            # ID5
    flow_id: str | None = None               # ID3
    token: str | None = None
    token_address: str | None = None
    payer_address: str | None = None
    to_pay_address: str | None = None
    chain: str | None = None                 # CAIP-2, e.g. eip155:177
    network: str | None = None
    extra_protocol: str | None = None        # eip3009 | permit2
    product_amount: str | None = None
    order_amount: str | None = None
    pay_amount: str | None = None
    usd_product_amount: str | None = None
    usd_additional_amount: str | None = None
    usd_amount: str | None = None
    usd_pay_amount: str | None = None
    usd_amount_rate: str | None = None
    tx_signature: str | None = None          # tx hash once included on chain
    status_reason: str | None = None
    deadline_time: str | None = None
    created_at: str | None = None
    updated_at: str | None = None
    broadcast_at: str | None = None
    included_at: str | None = None
    completed_at: str | None = None


class HSPWebhookPayload(BaseModel):
    """Payment webhook body (docs/en/webhook.md). Treated as a *hint* only -- settlement is re-queried."""

    model_config = ConfigDict(extra="allow")

    event_type: str
    payment_request_id: str
    status: str
    request_id: str | None = None
    cart_mandate_id: str | None = None
    payer_address: str | None = None
    to_pay_address: str | None = None
    amount: str | None = None
    order_amount: str | None = None
    pay_amount: str | None = None
    token: str | None = None
    token_address: str | None = None
    chain: str | None = None
    network: str | None = None
    tx_signature: str | None = None
    status_reason: str | None = None
    created_at: str | None = None


class HSPEnvelope(BaseModel):
    model_config = ConfigDict(extra="allow")

    code: int
    msg: str | None = None
    data: Any | None = Field(default=None)
