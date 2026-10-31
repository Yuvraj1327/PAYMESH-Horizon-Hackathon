"""End-to-end HSP payment lifecycle through the public API, against the spec-strict FakeHSP + FakeChain.

Covers: mandate creation, wallet-step data, status tracking, authoritative verification, receipts, webhooks,
duplicate/replay protection, failure & expiry handling, and the Receiving Agent's confirmation.
(No real money moves and nothing here proves the *live* gateway works -- see test_hsp_live_qa.py.)
"""

from __future__ import annotations

import asyncio
import json
import time
import uuid
from datetime import timedelta
from types import SimpleNamespace

import pytest
from sqlalchemy import func, select, update

from app.core.config import get_settings
from app.integrations.blockchain.client import ERC20_TRANSFER_TOPIC, ChainClient, TokenTransfer
from app.integrations.hsp.webhooks import sign_webhook
from app.models import HspPaymentFlow, HspWebhookEvent, PaymentIntent, PaymentReceipt, TransactionEvent
from app.utils.common import utcnow
from tests.conftest import TestUser, create_request, quote_and_select, set_policy
from tests.hsp_fakes import OFFICIAL_USDT_133, FakeChain, FakeHSP
from tests.test_marketplace import make_agent

S = get_settings()
PAY = "/api/v1/payments/intents"
BUYER_WALLET = "0x" + "55" * 20
TX = "0x" + "ab" * 32
HOOK = "/api/v1/webhooks/hsp"


# ---------------------------------------------------------------------------------------------- helpers
async def ready_intent(client, user: TestUser, *, wallet: str | None = BUYER_WALLET, authorize: bool = True) -> dict:
    if wallet:
        await client.patch("/api/v1/users/me", json={"wallet_address": wallet}, headers=user.headers)
    await set_policy(client, user)
    req = await create_request(client, user)
    await quote_and_select(client, user, req["id"], pick=0)               # cheapest demo quote: 0.25 USDT
    r = await client.post(PAY, json={"request_id": req["id"]}, headers=user.headers)
    assert r.status_code == 201, r.text
    intent = r.json()
    if authorize:
        a = await client.post(f"{PAY}/{intent['id']}/authorize", headers=user.headers)
        assert a.status_code == 200, a.text
    return {"req": req, "intent": intent}


async def with_order(client, user: TestUser, **kw) -> dict:  # noqa: ANN003
    ctx = await ready_intent(client, user, **kw)
    r = await client.post(f"{PAY}/{ctx['intent']['id']}/mandate", headers=user.headers)
    assert r.status_code == 200, r.text
    ctx["order"] = r.json()
    return ctx


def chain_ok(chain: FakeChain, intent: dict, *, tx: str = TX, payer: str = BUYER_WALLET, units: int = 250_000, **kw) -> None:  # noqa: ANN003
    chain.add(tx, token=OFFICIAL_USDT_133, sender=payer, recipient=intent["recipient"], units=units, **kw)


async def status(client, user, iid, refresh=True) -> dict:  # noqa: ANN001
    r = await client.get(f"{PAY}/{iid}/status?refresh={'true' if refresh else 'false'}", headers=user.headers)
    assert r.status_code == 200, r.text
    return r.json()


async def intent_state(client, user, iid) -> str:  # noqa: ANN001
    return (await client.get(f"{PAY}/{iid}", headers=user.headers)).json()["status"]


async def event_types(client, user, iid) -> list[str]:  # noqa: ANN001
    r = await client.get(f"/api/v1/transactions/events?payment_intent_id={iid}&limit=100", headers=user.headers)
    return [e["event_type"] for e in r.json()["items"]]


def hook_request(payload: dict, *, secret: str = S.HSP_APP_SECRET, ts: int | None = None) -> dict:
    raw = json.dumps(payload).encode()
    return {"content": raw, "headers": {"X-Signature": sign_webhook(secret, raw, int(time.time()) if ts is None else ts),
                                        "Content-Type": "application/json"}}


def payload_for(pr: str, st: str, **over) -> dict:  # noqa: ANN003
    return {"event_type": "payment", "payment_request_id": pr, "status": st, **over}


# ============================================================================== the acceptance flow
async def test_full_hsp_payment_lifecycle_to_verified_settlement_and_delivery(client, alice, admin, hsp, chain_fake, demo_agents, db):
    ctx = await with_order(client, alice)
    iid, intent, order = ctx["intent"]["id"], ctx["intent"], ctx["order"]

    # --- 6/7: Cart Mandate registered with HSP; frontend gets the wallet-step data
    assert order["order_state"] == "created" and order["payment_url"].startswith("https://pay.example/")
    assert order["cart_mandate_id"] == f"PM-{iid}" and order["payment_request_id"] == f"PMR-{iid}" and len(order["cart_hash"]) == 64
    sd = (await client.get(f"{PAY}/{iid}/signing-data", headers=alice.headers)).json()
    assert sd["mode"] == "hsp_hosted_checkout" and sd["payment_url"] == order["payment_url"]
    assert sd["review"]["token_address"] == OFFICIAL_USDT_133 and sd["review"]["authorization_scheme"] == "permit2"
    assert sd["review"]["recipient"] == intent["recipient"] and sd["review"]["amount"] == "0.25" and sd["review"]["chain_id"] == 133
    assert "secret" not in json.dumps(sd).lower() and "private" not in json.dumps(sd).lower()

    # the order the gateway holds is exactly the immutable snapshot (amount, payee, chain, token)
    contents = hsp.order_for(order["payment_request_id"])
    md = contents["payment_request"]["method_data"][0]["data"]
    assert (md["pay_to"], md["chain_id"], md["coin"], md["contract_address"]) == (intent["recipient"], 133, "USDT", OFFICIAL_USDT_133)
    assert contents["payment_request"]["details"]["total"]["amount"] == {"currency": "USD", "value": "0.25"}

    # --- idempotent: second /mandate creates no second order
    again = await client.post(f"{PAY}/{iid}/mandate", headers=alice.headers)
    assert again.status_code == 200 and again.json()["payment_url"] == order["payment_url"]
    assert len([c for c in hsp.calls if c[0] == "POST"]) == 1

    pr = order["payment_request_id"]
    # --- nothing paid yet
    st = await status(client, alice, iid)
    assert st["status"] == "AWAITING_SIGNATURE" and st["settled_and_verified"] is False
    # --- user signs in HSP checkout -> payment-submitted -> processing -> included (tx known) -> finalized
    hsp.pay(pr, "payment-submitted", payer=BUYER_WALLET)
    assert (await status(client, alice, iid))["status"] == "SUBMITTED"
    hsp.pay(pr, "payment-processing", payer=BUYER_WALLET)
    assert (await status(client, alice, iid))["status"] == "PENDING"
    hsp.pay(pr, "payment-included", payer=BUYER_WALLET)
    st = await status(client, alice, iid)
    assert st["status"] == "PENDING" and st["hsp"]["tx_hash"] == TX and st["settled_and_verified"] is False
    assert (await client.get(f"{PAY}/{iid}/receipt", headers=alice.headers)).status_code == 404       # no receipt before verification
    # delivery is blocked while merely 'included'
    assert (await client.post(f"/api/v1/procurement/requests/{ctx['req']['id']}/deliver", headers=alice.headers)).status_code == 409

    # --- finalized at the gateway but the CHAIN has no such tx yet -> must NOT settle
    hsp.pay(pr, "payment-finalized", payer=BUYER_WALLET)
    st = await status(client, alice, iid)
    assert st["status"] == "PENDING"
    # --- chain evidence appears -> authoritative verification settles it
    chain_ok(chain_fake, intent)
    v = (await client.post(f"{PAY}/{iid}/verify", headers=alice.headers)).json()
    assert v["settlement_verified"] is True and v["verified_now"] is True and v["status"] == "SETTLED"
    assert v["transaction_hash"] == TX and all(c["ok"] for c in v["checks"])
    assert {"gateway_status", "order_reference", "recipient", "chain", "token", "order_amount", "tx_hash_not_reused",
            "onchain_tx_success", "onchain_finality", "onchain_transfer_to_recipient"} <= {c["name"] for c in v["checks"]}

    # --- receipt + history
    rc = (await client.get(f"{PAY}/{iid}/receipt", headers=alice.headers)).json()
    assert rc["transaction_hash"] == TX and rc["settlement_status"] == "payment-finalized" and rc["chain_id"] == 133
    assert rc["receipt_reference"].startswith("hsp:") and rc["recipient"] == intent["recipient"] and float(rc["verified_amount"]) == 0.25
    assert rc["verification_details"]["ok"] is True
    rows = (await client.get("/api/v1/transactions/receipts", headers=alice.headers)).json()
    assert rows["total"] == 1
    hist = (await client.get(PAY, headers=alice.headers)).json()["items"]
    assert hist[0]["status"] == "SETTLED"
    ev = await event_types(client, alice, iid)
    for e in ("payment_intent_created", "hsp_order_created", "hsp_status_changed", "payment_settled_verified", "payment_settled"):
        assert e in ev, e

    # --- idempotent verification: no second receipt, no second SETTLED event
    v2 = (await client.post(f"{PAY}/{iid}/verify", headers=alice.headers)).json()
    assert v2["settlement_verified"] is True
    assert (await db.execute(select(func.count()).select_from(PaymentReceipt))).scalar_one() == 1
    await db.rollback()

    # --- 14/15: the Receiving Agent (demo provider, admin-operated) confirms payment; delivery eligibility != delivery
    agent_id = intent["provider_agent_id"]
    r = await client.get(f"/api/v1/payments/provider/intents/{iid}/verification", headers=admin.headers)
    assert r.status_code == 200, r.text
    pv = r.json()
    assert pv["settlement_verified"] is True and pv["eligible_for_delivery"] is True and pv["provider_agent_id"] == agent_id
    assert pv["delivery_status"] == "not_started" and pv["checks"]["recipient_matches_snapshot"] is True
    d = await client.post(f"/api/v1/procurement/requests/{ctx['req']['id']}/deliver", headers=alice.headers)
    assert d.status_code == 200 and d.json()["delivery_status"] == "delivered" and d.json()["delivery_result"]["demo_content"] is True
    pv = (await client.get(f"/api/v1/payments/provider/intents/{iid}/verification", headers=admin.headers)).json()
    assert pv["delivery_status"] == "delivered"     # tracked separately from payment verification


# ============================================================================== mandate step guards
async def test_mandate_requires_authorized_intent_and_ownership(client, alice, bob, demo_agents, hsp):
    ctx = await ready_intent(client, alice, authorize=False)
    iid = ctx["intent"]["id"]
    r = await client.post(f"{PAY}/{iid}/mandate", headers=alice.headers)
    assert r.status_code == 409 and "authorize" in r.json()["error"]["message"]
    await client.post(f"{PAY}/{iid}/authorize", headers=alice.headers)
    assert (await client.post(f"{PAY}/{iid}/mandate", headers=bob.headers)).status_code == 404
    assert (await client.get(f"{PAY}/{iid}/signing-data", headers=bob.headers)).status_code == 404
    assert (await client.get(f"{PAY}/{iid}/signing-data", headers=alice.headers)).status_code == 409   # no order yet
    assert hsp.calls == []


async def test_mandate_fails_closed_when_hsp_is_not_configured(client, app, alice, demo_agents, hsp):
    ctx = await ready_intent(client, alice)
    app.dependency_overrides[get_settings] = lambda: S.model_copy(update={"HSP_APP_KEY": ""})
    r = await client.post(f"{PAY}/{ctx['intent']['id']}/mandate", headers=alice.headers)
    assert r.status_code == 503 and r.json()["error"]["code"] == "hsp_not_configured"
    assert hsp.calls == []


async def test_revalidation_at_mandate_time_blocks_changed_conditions(client, alice, demo_agents, hsp):
    ctx = await ready_intent(client, alice)
    await set_policy(client, alice, enabled=False)                      # user policy turned off after authorization
    r = await client.post(f"{PAY}/{ctx['intent']['id']}/mandate", headers=alice.headers)
    assert r.status_code == 422 and "policy_disabled" in {d["rule"] for d in r.json()["error"]["details"]}
    assert await intent_state(client, alice, ctx["intent"]["id"]) == "FAILED"
    assert hsp.calls == []                                              # nothing left the system


async def test_tampered_snapshot_blocks_mandate(client, alice, demo_agents, hsp, db):
    ctx = await ready_intent(client, alice)
    iid = ctx["intent"]["id"]
    forged = {**ctx["intent"]["conditions_snapshot"], "recipient": "0x" + "99" * 20}
    await db.execute(update(PaymentIntent).where(PaymentIntent.id == uuid.UUID(iid)).values(conditions_snapshot=forged))
    await db.commit()
    r = await client.post(f"{PAY}/{iid}/mandate", headers=alice.headers)
    assert r.status_code == 409 and r.json()["error"]["code"] == "snapshot_integrity"
    assert await intent_state(client, alice, iid) == "FAILED" and hsp.calls == []


async def test_nearly_expired_intent_does_not_create_an_order(client, alice, demo_agents, hsp, db):
    ctx = await ready_intent(client, alice)
    iid = ctx["intent"]["id"]
    await db.execute(update(PaymentIntent).where(PaymentIntent.id == uuid.UUID(iid)).values(expires_at=utcnow() + timedelta(seconds=20)))
    await db.commit()
    r = await client.post(f"{PAY}/{iid}/mandate", headers=alice.headers)
    assert r.status_code == 409 and r.json()["error"]["code"] == "intent_expiring" and hsp.calls == []


async def test_ambiguous_order_creation_is_never_retried(client, alice, demo_agents, hsp, db):
    ctx = await ready_intent(client, alice)
    iid = ctx["intent"]["id"]
    hsp.create_script = ["timeout"]
    r = await client.post(f"{PAY}/{iid}/mandate", headers=alice.headers)
    assert r.status_code == 504 and r.json()["error"]["code"] == "hsp_outcome_unknown"
    flow = (await db.execute(select(HspPaymentFlow))).scalar_one()
    assert flow.order_state == "create_uncertain"
    await db.rollback()
    r = await client.post(f"{PAY}/{iid}/mandate", headers=alice.headers)       # a retry must NOT create a second order
    assert r.status_code == 409 and r.json()["error"]["code"] == "hsp_order_uncertain"
    assert len([c for c in hsp.calls if c[0] == "POST"]) == 1
    assert (await client.get(f"{PAY}/{iid}/signing-data", headers=alice.headers)).status_code == 409
    assert "hsp_order_create_uncertain" in await event_types(client, alice, iid)


async def test_definitive_failure_is_retryable_with_the_same_order_ids(client, alice, demo_agents, hsp):
    ctx = await ready_intent(client, alice)
    iid = ctx["intent"]["id"]
    good = hsp.app_secret
    hsp.app_secret = "rotated-elsewhere"                                        # our credentials are rejected
    r = await client.post(f"{PAY}/{iid}/mandate", headers=alice.headers)
    assert r.status_code == 502 and r.json()["error"]["code"] == "hsp_auth_failed"
    assert "rotated-elsewhere" not in r.text and S.HSP_APP_SECRET not in r.text
    hsp.app_secret = good
    r = await client.post(f"{PAY}/{iid}/mandate", headers=alice.headers)
    assert r.status_code == 200 and r.json()["cart_mandate_id"] == f"PM-{iid}"
    assert len(hsp.orders) == 1


async def test_cannot_cancel_once_an_hsp_order_exists(client, alice, demo_agents):
    ctx = await with_order(client, alice)
    r = await client.post(f"{PAY}/{ctx['intent']['id']}/cancel", headers=alice.headers)
    assert r.status_code == 409 and r.json()["error"]["code"] == "hsp_order_registered"
    assert await intent_state(client, alice, ctx["intent"]["id"]) == "AWAITING_SIGNATURE"


async def test_validate_endpoint_is_a_pure_dry_run(client, alice, demo_agents):
    ctx = await ready_intent(client, alice, authorize=False)
    iid = ctx["intent"]["id"]
    ok = (await client.post(f"{PAY}/{iid}/validate", headers=alice.headers)).json()
    assert ok["valid"] is True and ok["failures"] == [] and ok["status"] == "VALIDATED"
    await set_policy(client, alice, max_transaction_amount="0.1", daily_spending_limit="1")
    bad = (await client.post(f"{PAY}/{iid}/validate", headers=alice.headers)).json()
    assert bad["valid"] is False and "max_transaction_amount" in {f["rule"] for f in bad["failures"]}
    assert await intent_state(client, alice, iid) == "VALIDATED"          # unchanged by validation


# ============================================================================== verification is authoritative
async def settle_ctx(client, alice, hsp, chain_fake, demo_agents, **kw):  # noqa: ANN001, ANN003
    ctx = await with_order(client, alice, **kw)
    ctx["pr"] = ctx["order"]["payment_request_id"]
    ctx["iid"] = ctx["intent"]["id"]
    return ctx


async def verify(client, user, iid):  # noqa: ANN001, ANN201
    return await client.post(f"{PAY}/{iid}/verify", headers=user.headers)


async def assert_not_settled(client, user, iid, db):  # noqa: ANN001
    assert await intent_state(client, user, iid) != "SETTLED"
    assert (await db.execute(select(func.count()).select_from(PaymentReceipt))).scalar_one() == 0
    await db.rollback()
    assert (await client.get(f"{PAY}/{iid}/receipt", headers=user.headers)).status_code == 404


async def test_http_200_alone_never_settles(client, alice, hsp, chain_fake, demo_agents, db):
    c = await settle_ctx(client, alice, hsp, chain_fake, demo_agents)
    hsp.pay(c["pr"], "payment-submitted", payer=BUYER_WALLET)
    v = (await verify(client, alice, c["iid"])).json()
    assert v["verified_now"] is False and {x["name"] for x in v["checks"] if not x["ok"]} >= {"gateway_status", "tx_hash_present"}
    await assert_not_settled(client, alice, c["iid"], db)


async def test_unconfirmed_tx_hash_is_not_settlement(client, alice, hsp, chain_fake, demo_agents, db):
    c = await settle_ctx(client, alice, hsp, chain_fake, demo_agents)
    hsp.pay(c["pr"], "payment-included", payer=BUYER_WALLET)                      # hash known, below finalized
    chain_ok(chain_fake, c["intent"])
    v = (await verify(client, alice, c["iid"])).json()
    assert v["verified_now"] is False and [x for x in v["checks"] if x["name"] == "gateway_status"][0]["ok"] is False
    await assert_not_settled(client, alice, c["iid"], db)


async def test_payment_safe_is_enough_only_when_configured(client, app, alice, hsp, chain_fake, demo_agents, db):
    c = await settle_ctx(client, alice, hsp, chain_fake, demo_agents)
    hsp.pay(c["pr"], "payment-safe", payer=BUYER_WALLET)
    chain_ok(chain_fake, c["intent"])
    assert (await verify(client, alice, c["iid"])).json()["verified_now"] is False        # default: finalized required
    app.dependency_overrides[get_settings] = lambda: S.model_copy(update={"HSP_SETTLEMENT_MIN_STATUS": "payment-safe"})
    assert (await verify(client, alice, c["iid"])).json()["verified_now"] is True


NEGATIVE_CASES = [
    # (id, gateway-record overrides, chain overrides, expected failing check)
    ("amount_too_low", {"order_amount": "0.20", "product_amount": "0.20"}, {}, "order_amount"),
    ("payer_not_buyer_wallet", {"payer_address": "0x" + "66" * 20}, {"payer": "0x" + "66" * 20}, "payer_is_registered_buyer_wallet"),
    ("rate_depegged", {"usd_amount_rate": "0.5"}, {}, "stablecoin_rate_sane"),
    ("no_tx_hash", {"tx_signature": None}, {}, "tx_hash_present"),
    ("malformed_tx_hash", {"tx_signature": "0x1234"}, {}, "tx_hash_present"),
    ("chain_has_no_tx", {}, {"skip": True}, "onchain_tx_found"),
    ("tx_reverted", {}, {"success": False}, "onchain_tx_success"),
    ("not_finalized", {}, {"finalized": False}, "onchain_finality"),
    ("few_confirmations_no_finality_tag", {}, {"finalized": None, "confirmations": 2}, "onchain_finality"),
    ("underpaid_on_chain", {}, {"units": 100_000}, "onchain_transfer_to_recipient"),
    ("paid_someone_else", {}, {"recipient_override": "0x" + "77" * 20}, "onchain_transfer_to_recipient"),
    ("transfer_from_other_account", {}, {"sender_override": "0x" + "88" * 20}, "onchain_transfer_to_recipient"),
    ("wrong_token_transferred", {}, {"token_override": "0x" + "99" * 20}, "onchain_transfer_to_recipient"),
]


@pytest.mark.parametrize("case", NEGATIVE_CASES, ids=[c[0] for c in NEGATIVE_CASES])
async def test_verification_rejects(case, client, alice, hsp, chain_fake, demo_agents, db):
    _, rec_over, ch, failing = case
    c = await settle_ctx(client, alice, hsp, chain_fake, demo_agents)
    rec = hsp.pay(c["pr"], "payment-finalized", payer=BUYER_WALLET, **rec_over)
    tx = rec["tx_signature"] or TX
    if not ch.get("skip") and rec["tx_signature"] and rec["tx_signature"].startswith("0x" + "ab"):
        chain_fake.add(tx, token=ch.get("token_override", OFFICIAL_USDT_133), sender=ch.get("sender_override", ch.get("payer", BUYER_WALLET)),
                       recipient=ch.get("recipient_override", c["intent"]["recipient"]), units=ch.get("units", 250_000),
                       success=ch.get("success", True), finalized=ch.get("finalized", True), confirmations=ch.get("confirmations", 50))
    v = (await verify(client, alice, c["iid"])).json()
    assert v["verified_now"] is False, v
    assert failing in {x["name"] for x in v["checks"] if not x["ok"]}
    await assert_not_settled(client, alice, c["iid"], db)
    assert "payment_verification_failed" in await event_types(client, alice, c["iid"])


@pytest.mark.parametrize("field,value", [("to_pay_address", "0x" + "ee" * 20), ("chain", "eip155:177"),
                                          ("token_address", "0x" + "dd" * 20), ("payment_request_id", "PMR-someone-else"),
                                          ("content_id", "PM-someone-else")])
async def test_gateway_record_for_a_different_order_is_never_applied(field, value, client, alice, hsp, chain_fake, demo_agents, db):
    c = await settle_ctx(client, alice, hsp, chain_fake, demo_agents)
    rec = hsp.pay(c["pr"], "payment-finalized", payer=BUYER_WALLET)
    chain_ok(chain_fake, c["intent"])
    hsp.payments[c["pr"]] = {**rec, field: value}
    r = await verify(client, alice, c["iid"])
    assert r.status_code == 409 and r.json()["error"]["code"] == "hsp_record_mismatch"
    st = await status(client, alice, c["iid"])
    assert st["status"] == "AWAITING_SIGNATURE"                                  # the mismatching record moved nothing
    assert "hsp_record_mismatch" in await event_types(client, alice, c["iid"])
    await assert_not_settled(client, alice, c["iid"], db)


async def test_receipt_and_tx_hash_cannot_be_reused_for_another_order(client, alice, hsp, chain_fake, demo_agents, db):
    a = await settle_ctx(client, alice, hsp, chain_fake, demo_agents)
    hsp.pay(a["pr"], "payment-finalized", payer=BUYER_WALLET)
    chain_ok(chain_fake, a["intent"])
    assert (await verify(client, alice, a["iid"])).json()["verified_now"] is True

    b = await settle_ctx(client, alice, hsp, chain_fake, demo_agents)             # second order, same buyer / provider
    hsp.pay(b["pr"], "payment-finalized", payer=BUYER_WALLET)                      # gateway (wrongly/maliciously) reports the SAME tx
    chain_ok(chain_fake, b["intent"])                                              # and the chain transfer even pays b's payee
    v = (await verify(client, alice, b["iid"])).json()
    assert v["verified_now"] is False and "tx_hash_not_reused" in {x["name"] for x in v["checks"] if not x["ok"]}
    assert await intent_state(client, alice, b["iid"]) == "PENDING"
    assert (await db.execute(select(func.count()).select_from(PaymentReceipt))).scalar_one() == 1
    await db.rollback()


async def test_database_enforces_one_receipt_per_intent_and_per_tx(client, alice, hsp, chain_fake, demo_agents, db):
    from sqlalchemy.exc import IntegrityError

    a = await settle_ctx(client, alice, hsp, chain_fake, demo_agents)
    hsp.pay(a["pr"], "payment-finalized", payer=BUYER_WALLET)
    chain_ok(chain_fake, a["intent"])
    await verify(client, alice, a["iid"])
    rc = (await db.execute(select(PaymentReceipt))).scalar_one()
    for dup in (dict(payment_intent_id=rc.payment_intent_id, receipt_reference="other", transaction_hash="0x" + "cd" * 32),
                dict(payment_intent_id=uuid.uuid4(), receipt_reference=rc.receipt_reference, transaction_hash=None)):
        db.add(PaymentReceipt(settlement_status="payment-finalized", verification_details={}, **dup))
        with pytest.raises(IntegrityError):
            await db.flush()
        await db.rollback()


async def test_gateway_failure_and_outage_handling(client, alice, hsp, chain_fake, demo_agents):
    c = await settle_ctx(client, alice, hsp, chain_fake, demo_agents)
    hsp.script = ["503", "503", "503"]                                              # gateway down for all retries
    r = await client.get(f"{PAY}/{c['iid']}/status", headers=alice.headers)
    assert r.status_code == 504 and r.json()["error"]["code"] == "hsp_unavailable"
    assert await intent_state(client, alice, c["iid"]) == "AWAITING_SIGNATURE"      # outage never changes money state
    hsp.pay(c["pr"], "payment-failed", payer=BUYER_WALLET, status_reason="timeout reconciliation: broadcast never succeeded")
    assert (await status(client, alice, c["iid"]))["status"] == "FAILED"
    # request is released so the user can try again with a new intent
    assert (await client.get(f"/api/v1/procurement/requests/{c['req']['id']}", headers=alice.headers)).json()["status"] == "selected"
    # a later (bogus) 'finalized' on a failed payment cannot resurrect it
    hsp.pay(c["pr"], "payment-finalized", payer=BUYER_WALLET)
    chain_ok(chain_fake, c["intent"])
    assert (await client.post(f"{PAY}/{c['iid']}/verify", headers=alice.headers)).status_code == 409
    assert await intent_state(client, alice, c["iid"]) == "FAILED"


async def test_payment_arriving_after_intent_expiry_is_flagged_not_settled(client, alice, hsp, chain_fake, demo_agents, db):
    c = await settle_ctx(client, alice, hsp, chain_fake, demo_agents)
    await db.execute(update(PaymentIntent).where(PaymentIntent.id == uuid.UUID(c["iid"])).values(expires_at=utcnow() - timedelta(seconds=1)))
    await db.commit()
    hsp.pay(c["pr"], "payment-submitted", payer=BUYER_WALLET)
    st = await status(client, alice, c["iid"])
    assert st["status"] == "EXPIRED"
    assert "payment_received_for_closed_intent" in await event_types(client, alice, c["iid"])
    hsp.pay(c["pr"], "payment-finalized", payer=BUYER_WALLET)
    chain_ok(chain_fake, c["intent"])
    assert (await client.post(f"{PAY}/{c['iid']}/verify", headers=alice.headers)).status_code == 409
    assert await intent_state(client, alice, c["iid"]) == "EXPIRED"                  # needs manual review/refund, never delivery
    assert (await client.post(f"/api/v1/procurement/requests/{c['req']['id']}/deliver", headers=alice.headers)).status_code == 409


async def test_status_polling_is_throttled_per_payment(client, app, alice, hsp, chain_fake, demo_agents):
    c = await settle_ctx(client, alice, hsp, chain_fake, demo_agents)
    app.dependency_overrides[get_settings] = lambda: S.model_copy(update={"HSP_POLL_MIN_INTERVAL_SECONDS": 60})
    hsp.pay(c["pr"], "payment-submitted", payer=BUYER_WALLET)
    first = await status(client, alice, c["iid"])
    n = len(hsp.calls)
    second = await status(client, alice, c["iid"])
    assert first["throttled"] is False and second["throttled"] is True and len(hsp.calls) == n    # no extra gateway call
    cached = await status(client, alice, c["iid"], refresh=False)
    assert cached["status"] == "SUBMITTED" and len(hsp.calls) == n


async def test_terminal_payments_are_not_polled_again(client, alice, hsp, chain_fake, demo_agents):
    c = await settle_ctx(client, alice, hsp, chain_fake, demo_agents)
    hsp.pay(c["pr"], "payment-finalized", payer=BUYER_WALLET)
    chain_ok(chain_fake, c["intent"])
    assert (await status(client, alice, c["iid"]))["status"] == "SETTLED"             # auto-verified from polling
    n = len(hsp.calls)
    await status(client, alice, c["iid"])
    await status(client, alice, c["iid"])
    assert len(hsp.calls) == n


# ============================================================================== webhooks
async def test_valid_webhook_triggers_requery_and_verified_settlement(client, alice, hsp, chain_fake, demo_agents):
    c = await settle_ctx(client, alice, hsp, chain_fake, demo_agents)
    hsp.pay(c["pr"], "payment-finalized", payer=BUYER_WALLET)
    chain_ok(chain_fake, c["intent"])
    before = len(hsp.calls)
    r = await client.post(HOOK, **hook_request(payload_for(c["pr"], "payment-finalized", tx_signature=TX)))
    assert r.status_code == 200 and r.json()["code"] == 0
    assert len(hsp.calls) > before                                                        # it re-queried the gateway
    assert await intent_state(client, alice, c["iid"]) == "SETTLED"
    assert "hsp_webhook_processed" in await event_types(client, alice, c["iid"])


async def test_forged_webhook_claim_cannot_settle(client, alice, hsp, chain_fake, demo_agents):
    c = await settle_ctx(client, alice, hsp, chain_fake, demo_agents)
    hsp.pay(c["pr"], "payment-processing", payer=BUYER_WALLET)                          # truth at the gateway: still processing
    chain_ok(chain_fake, c["intent"])
    # a correctly SIGNED webhook (even from HSP itself) is only a hint; its claimed status is ignored
    r = await client.post(HOOK, **hook_request(payload_for(c["pr"], "payment-finalized", tx_signature=TX)))
    assert r.status_code == 200
    assert await intent_state(client, alice, c["iid"]) == "PENDING"


async def test_webhook_authenticity_is_enforced(client, alice, hsp, chain_fake, demo_agents, db):
    c = await settle_ctx(client, alice, hsp, chain_fake, demo_agents)
    hsp.pay(c["pr"], "payment-finalized", payer=BUYER_WALLET)
    chain_ok(chain_fake, c["intent"])
    p = payload_for(c["pr"], "payment-finalized", tx_signature=TX)
    for bad in (hook_request(p, secret="not-the-secret"), hook_request(p, ts=int(time.time()) - 3600)):
        assert (await client.post(HOOK, **bad)).status_code == 401
    raw = json.dumps(p).encode()
    assert (await client.post(HOOK, content=raw)).status_code == 401                      # no signature at all
    tampered = hook_request(p)
    tampered["content"] = tampered["content"].replace(b"finalized", b"finalizeD")
    assert (await client.post(HOOK, **tampered)).status_code == 401
    assert (await client.post(HOOK, content=b"not json", headers={"X-Signature": sign_webhook(S.HSP_APP_SECRET, b"not json", int(time.time()))})).status_code == 401
    assert await intent_state(client, alice, c["iid"]) == "AWAITING_SIGNATURE"
    assert (await db.execute(select(func.count()).select_from(HspWebhookEvent))).scalar_one() == 0   # rejected deliveries leave no trace
    await db.rollback()


async def test_duplicate_webhook_delivery_is_idempotent(client, alice, hsp, chain_fake, demo_agents, db):
    c = await settle_ctx(client, alice, hsp, chain_fake, demo_agents)
    hsp.pay(c["pr"], "payment-finalized", payer=BUYER_WALLET)
    chain_ok(chain_fake, c["intent"])
    req = hook_request(payload_for(c["pr"], "payment-finalized", tx_signature=TX))
    r1 = await client.post(HOOK, **req)
    n = len(hsp.calls)
    r2 = await client.post(HOOK, **req)
    assert r1.json() == {"code": 0} and r2.json()["duplicate"] is True and len(hsp.calls) == n
    assert (await db.execute(select(func.count()).select_from(PaymentReceipt))).scalar_one() == 1
    assert (await db.execute(select(func.count()).select_from(HspWebhookEvent))).scalar_one() == 1
    await db.rollback()
    types = await event_types(client, alice, c["iid"])
    assert types.count("payment_settled_verified") == 1


async def test_webhook_for_unknown_order_is_acknowledged_and_ignored(client, hsp, demo_agents, db):
    r = await client.post(HOOK, **hook_request(payload_for("PMR-unknown", "payment-finalized")))
    assert r.status_code == 200 and r.json()["ignored"] is True
    ev = (await db.execute(select(HspWebhookEvent))).scalar_one()
    assert ev.outcome == "ignored_unknown_order"
    await db.rollback()


async def test_webhook_during_gateway_outage_errors_so_hsp_retries_then_succeeds(client, alice, hsp, chain_fake, demo_agents, db):
    c = await settle_ctx(client, alice, hsp, chain_fake, demo_agents)
    hsp.pay(c["pr"], "payment-finalized", payer=BUYER_WALLET)
    chain_ok(chain_fake, c["intent"])
    req = hook_request(payload_for(c["pr"], "payment-finalized", tx_signature=TX))
    hsp.script = ["503", "503", "503"]
    r = await client.post(HOOK, **req)
    assert r.status_code >= 500                                                          # non-2xx => HSP retries later
    assert (await db.execute(select(HspWebhookEvent.outcome))).scalar_one() == "error"
    await db.rollback()
    assert await intent_state(client, alice, c["iid"]) == "AWAITING_SIGNATURE"
    r = await client.post(HOOK, **req)                                                    # HSP retry: same body is reprocessed
    assert r.status_code == 200 and await intent_state(client, alice, c["iid"]) == "SETTLED"


# ============================================================================== Receiving Agent (external provider)
async def test_external_provider_confirms_payment_and_strangers_cannot(client, alice, bob, admin, hsp, chain_fake):
    provider, buyer, stranger = alice, bob, TestUser("mallory")
    agent = await make_agent(client, provider, name="External Research", wallet_address="0x" + "44" * 20)
    await client.post("/api/v1/services", headers=provider.headers, json={
        "provider_agent_id": agent["id"], "name": "Custom report", "price": "0.25", "payment_asset": "USDT"})
    await client.patch("/api/v1/users/me", json={"wallet_address": BUYER_WALLET}, headers=buyer.headers)
    await set_policy(client, buyer)
    req = await create_request(client, buyer)
    await client.post(f"/api/v1/procurement/requests/{req['id']}/quotations", headers=buyer.headers)
    q = (await client.post("/api/v1/quotations", headers=provider.headers, json={
        "request_id": req["id"], "provider_agent_id": agent["id"], "price": "0.25", "payment_asset": "USDT",
        "delivery_estimate_minutes": 30})).json()
    assert (await client.post(f"/api/v1/procurement/requests/{req['id']}/select", json={"quotation_id": q["id"]}, headers=buyer.headers)).status_code == 200
    intent = (await client.post(PAY, json={"request_id": req["id"]}, headers=buyer.headers)).json()
    iid = intent["id"]
    await client.post(f"{PAY}/{iid}/authorize", headers=buyer.headers)
    pr = (await client.post(f"{PAY}/{iid}/mandate", headers=buyer.headers)).json()["payment_request_id"]
    assert intent["recipient"] == agent["wallet_address"]

    vurl = f"/api/v1/payments/provider/intents/{iid}/verification"
    pv = (await client.get(vurl, headers=provider.headers)).json()
    assert pv["settlement_verified"] is False and pv["eligible_for_delivery"] is False and pv["payment_status"] == "AWAITING_SIGNATURE"
    assert (await client.get(vurl, headers=stranger.headers)).status_code == 404
    assert (await client.get(vurl, headers=buyer.headers)).status_code == 404              # buyer is not the receiving agent
    listing = (await client.get(f"/api/v1/payments/provider/intents", headers=provider.headers)).json()
    assert listing["total"] == 1 and (await client.get(f"/api/v1/payments/provider/intents", headers=stranger.headers)).json()["total"] == 0

    hsp.pay(pr, "payment-finalized", payer=BUYER_WALLET)
    chain_ok(chain_fake, intent)
    pv = (await client.get(vurl + "?refresh=true", headers=provider.headers)).json()     # provider re-checks independently
    assert pv["settlement_verified"] is True and pv["eligible_for_delivery"] is True and pv["checks"]["recipient_is_agents_wallet_now"] is True
    assert pv["receipt"]["tx_hash"] == TX and pv["delivery_status"] == "not_started"
    # the buyer sees the very same receipt
    assert (await client.get(f"{PAY}/{iid}/receipt", headers=buyer.headers)).json()["transaction_hash"] == TX
    # payout address changed AFTER payment: still verified against the snapshot, and the discrepancy is visible
    await client.patch(f"/api/v1/agents/{agent['id']}", json={"wallet_address": "0x" + "12" * 20}, headers=provider.headers)
    pv = (await client.get(vurl, headers=provider.headers)).json()
    assert pv["eligible_for_delivery"] is True and pv["checks"]["recipient_is_agents_wallet_now"] is False


# ============================================================================== background poller
async def test_poller_advances_only_open_payments(client, app, alice, hsp, chain_fake, demo_agents, monkeypatch):
    from app.payments import monitor

    c = await settle_ctx(client, alice, hsp, chain_fake, demo_agents)
    monkeypatch.setattr(monitor, "get_hsp_client", lambda: app.state.gateway)
    monkeypatch.setattr(monitor, "ChainClient", lambda settings: chain_fake)
    hsp.pay(c["pr"], "payment-finalized", payer=BUYER_WALLET)
    chain_ok(chain_fake, c["intent"])
    assert await monitor.poll_once(S) == 1
    assert await intent_state(client, alice, c["iid"]) == "SETTLED"
    n = len(hsp.calls)
    assert await monitor.poll_once(S) == 0                                               # terminal -> never polled again
    assert len(hsp.calls) == n


# ============================================================================== chain evidence decoding (real ABI shapes)
class _Eth:
    def __init__(self, receipt, head=1300, finalized=1250, chain_id=133, no_final_tag=False):  # noqa: ANN001
        self._r, self._head, self._fin, self._cid, self._nof = receipt, head, finalized, chain_id, no_final_tag

    @property
    async def chain_id(self):  # noqa: ANN202
        return self._cid

    @property
    async def block_number(self):  # noqa: ANN202
        return self._head

    async def get_transaction_receipt(self, h):  # noqa: ANN001, ANN202
        from web3.exceptions import TransactionNotFound

        if self._r is None:
            raise TransactionNotFound(h)
        return self._r

    async def get_block(self, tag):  # noqa: ANN001, ANN202
        if self._nof:
            raise ValueError("finalized tag not supported")
        return {"number": self._fin}


def _log(token, frm, to, value):  # noqa: ANN001, ANN202
    pad = lambda a: bytes.fromhex(a[2:]).rjust(32, b"\x00")  # noqa: E731
    return {"address": token, "topics": [bytes.fromhex(ERC20_TRANSFER_TOPIC[2:]), pad(frm), pad(to)], "data": value.to_bytes(32, "big")}


async def test_chain_client_decodes_transfers_and_finality():
    payer, payee = BUYER_WALLET, "0x" + "44" * 20
    nft_log = {"address": OFFICIAL_USDT_133, "topics": [bytes.fromhex(ERC20_TRANSFER_TOPIC[2:])] + [b"\x00" * 32] * 3, "data": b""}  # ERC-721 shape: ignored
    receipt = {"status": 1, "blockNumber": 1200, "logs": [_log(OFFICIAL_USDT_133, payer, payee, 250_000), nft_log]}
    c = ChainClient(S, w3=SimpleNamespace(eth=_Eth(receipt)))  # type: ignore[arg-type]
    ev = await c.get_tx_evidence(TX)
    assert ev.success and ev.block_number == 1200 and ev.confirmations == 101 and ev.finalized is True
    assert len(ev.transfers) == 1
    t = ev.transfers[0]
    assert (t.token, t.sender.lower(), t.recipient.lower(), t.value) == (OFFICIAL_USDT_133, payer, payee, 250_000)
    # RPC without a 'finalized' tag -> finalized is None (caller falls back to confirmations)
    ev = await ChainClient(S, w3=SimpleNamespace(eth=_Eth(receipt, no_final_tag=True))).get_tx_evidence(TX)  # type: ignore[arg-type]
    assert ev.finalized is None
    assert (await ChainClient(S, w3=SimpleNamespace(eth=_Eth(None))).get_tx_evidence(TX)) is None          # type: ignore[arg-type]
    from app.core.errors import ServiceUnavailableError

    with pytest.raises(ServiceUnavailableError):
        await ChainClient(S, w3=SimpleNamespace(eth=_Eth(receipt, chain_id=1))).get_tx_evidence(TX)        # type: ignore[arg-type]


_ = (asyncio, TokenTransfer, FakeHSP, TransactionEvent)


async def test_mandate_refuses_mixed_testnet_mainnet_configuration(client, app, alice, demo_agents, hsp):
    ctx = await ready_intent(client, alice)
    app.dependency_overrides[get_settings] = lambda: S.model_copy(update={"HSP_BASE_URL": "https://hsp.hashkey.com"})   # prod host, chain 133
    r = await client.post(f"{PAY}/{ctx['intent']['id']}/mandate", headers=alice.headers)
    assert r.status_code == 409 and r.json()["error"]["code"] == "hsp_environment_mismatch"
    assert hsp.calls == []


# ============================================================================== concurrency (real Postgres only)
needs_pg = pytest.mark.skipif(S.is_sqlite, reason="needs real PostgreSQL row locks (run with TEST_DATABASE_URL=postgresql://...)")


@needs_pg
async def test_concurrent_mandate_requests_create_exactly_one_hsp_order(client, alice, demo_agents, hsp):
    ctx = await ready_intent(client, alice)
    iid = ctx["intent"]["id"]
    rs = await asyncio.gather(*[client.post(f"{PAY}/{iid}/mandate", headers=alice.headers) for _ in range(5)])
    assert len(hsp.orders) == 1 and len([c for c in hsp.calls if c[0] == "POST"]) == 1
    assert sorted({r.status_code for r in rs}) in ([200], [200, 409])           # losers either reuse the order or are told to retry
    assert any(r.status_code == 200 for r in rs)
    final = await client.post(f"{PAY}/{iid}/mandate", headers=alice.headers)
    assert final.status_code == 200 and final.json()["order_state"] == "created"


@needs_pg
async def test_concurrent_verifications_and_webhooks_settle_exactly_once(client, alice, hsp, chain_fake, demo_agents, db):
    c = await settle_ctx(client, alice, hsp, chain_fake, demo_agents)
    hsp.pay(c["pr"], "payment-finalized", payer=BUYER_WALLET)
    chain_ok(chain_fake, c["intent"])
    hook = hook_request(payload_for(c["pr"], "payment-finalized", tx_signature=TX))
    calls = [client.post(f"{PAY}/{c['iid']}/verify", headers=alice.headers) for _ in range(3)] + \
            [client.post(HOOK, **hook) for _ in range(3)] + \
            [client.get(f"{PAY}/{c['iid']}/status", headers=alice.headers) for _ in range(2)]
    rs = await asyncio.gather(*calls)
    assert all(r.status_code in (200, 409) for r in rs), [r.text for r in rs if r.status_code not in (200, 409)]
    assert await intent_state(client, alice, c["iid"]) == "SETTLED"
    assert (await db.execute(select(func.count()).select_from(PaymentReceipt))).scalar_one() == 1
    await db.rollback()
    assert (await event_types(client, alice, c["iid"])).count("payment_settled") == 1


@needs_pg
async def test_concurrent_intent_creation_cannot_exceed_daily_limit(client, alice, demo_agents):
    """Two requests, each valid alone, whose sum exceeds the daily limit: the policy row lock serializes them."""
    await client.patch("/api/v1/users/me", json={"wallet_address": BUYER_WALLET}, headers=alice.headers)
    await set_policy(client, alice, max_transaction_amount="0.3", daily_spending_limit="0.3")
    reqs = []
    for _ in range(3):
        r = await create_request(client, alice)
        await quote_and_select(client, alice, r["id"], pick=0)                 # 0.25 each
        reqs.append(r)
    rs = await asyncio.gather(*[client.post(PAY, json={"request_id": r["id"]}, headers=alice.headers) for r in reqs])
    codes = sorted(r.status_code for r in rs)
    assert codes == [201, 422, 422], codes                                      # exactly one fits under 0.30/day
