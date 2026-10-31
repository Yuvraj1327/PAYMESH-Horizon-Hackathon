"""LIVE checks against the real HSP QA gateway. Skipped unless you provide QA credentials.

    HSP_LIVE_QA=1 HSP_QA_APP_KEY=... HSP_QA_APP_SECRET=... HSP_QA_MERCHANT_KEY_FILE=/path/merchant_private_key.pem \
    HSP_QA_PAY_TO=0xYourTestRecipient  pytest -m hsp_live -s

Creating an order moves NO funds (money moves only if a wallet pays at payment_url). These tests are the only ones
that can show the real gateway accepts our signatures and Cart Mandate -- everything else in the suite uses FakeHSP.
"""

from __future__ import annotations

import os
import uuid
from datetime import timedelta

import pytest

from app.core.config import get_settings
from app.integrations.hsp.gateway import HSPGateway
from app.integrations.hsp.mandate import build_order_request, payment_request_id_for
from app.utils.common import utcnow

pytestmark = [
    pytest.mark.hsp_live,
    pytest.mark.skipif(
        not (os.getenv("HSP_LIVE_QA") and os.getenv("HSP_QA_APP_KEY") and os.getenv("HSP_QA_APP_SECRET")
             and os.getenv("HSP_QA_MERCHANT_KEY_FILE") and os.getenv("HSP_QA_PAY_TO")),
        reason="set HSP_LIVE_QA=1 and HSP_QA_* credentials to run against the real QA gateway"),
]


def live_settings():  # noqa: ANN201
    return get_settings().model_copy(update={
        "HSP_BASE_URL": os.getenv("HSP_QA_BASE_URL", "https://merchant-qa.hashkeymerchant.com"),
        "HSP_APP_KEY": os.environ["HSP_QA_APP_KEY"], "HSP_APP_SECRET": os.environ["HSP_QA_APP_SECRET"],
        "HSP_MERCHANT_PRIVATE_KEY_PEM": "", "HSP_MERCHANT_PRIVATE_KEY_FILE": os.environ["HSP_QA_MERCHANT_KEY_FILE"],
        "HSK_CHAIN_ID": 133,
    })


async def test_real_qa_accepts_our_signed_cart_mandate_and_serves_status_queries():
    s = live_settings()
    snap = {"amount": "0.01", "asset": os.getenv("HSP_QA_ASSET", "USDT"), "chain_id": 133,
            "recipient": os.environ["HSP_QA_PAY_TO"], "provider_name": "PayMesh live QA"}
    iid = uuid.uuid4()
    body, _ = build_order_request(snap, iid, s, cart_expiry=utcnow() + timedelta(minutes=30))
    gw = HSPGateway(s)
    try:
        res = await gw.create_order(body["cart_mandate"], body.get("redirect_url"))
        print("\nLIVE QA ORDER:", res.payment_request_id, res.payment_url)
        assert res.payment_request_id == payment_request_id_for(iid)
        assert res.payment_url.startswith("https://")
        rec = await gw.get_payment(payment_request_id=res.payment_request_id)
        assert rec is None or rec.status == "payment-required"
    finally:
        await gw.aclose()
