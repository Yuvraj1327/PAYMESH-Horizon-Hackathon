"""Spending policy enforcement, Payment Guardian rules, intents, idempotency, immutability, state machine."""

from __future__ import annotations

import uuid
from datetime import timedelta
from decimal import Decimal

import pytest
from sqlalchemy import select, update

from app.core.errors import ConflictError
from app.models import Agent, PaymentIntent, PaymentReceipt, ProcurementRequest, Quotation, TransactionEvent
from app.models.enums import PaymentStatus as S
from app.payments.service import PaymentService
from app.payments.state_machine import (
    SERVER_ONLY,
    TERMINAL,
    TRANSITIONS,
    VerifiedSettlement,
    assert_transition,
    can_transition,
)
from app.utils.common import utcnow
from tests.conftest import TestUser, create_request, quote_and_select, set_policy

PAY = "/api/v1/payments/intents"
PROC = "/api/v1/procurement/requests"


async def ready(client, user, *, budget="1", pick=0, **policy):
    await set_policy(client, user, **policy)
    req = await create_request(client, user, budget=budget)
    q = await quote_and_select(client, user, req["id"], pick=pick)
    return req, q


async def failures(r) -> set[str]:
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "payment_validation_failed"
    return {d["rule"] for d in r.json()["error"]["details"]}


# ------------------------------------------------------------------ policies API
async def test_policy_crud_and_validation(client, alice, bob):
    assert (await client.get("/api/v1/policies/me", headers=alice.headers)).status_code == 404
    p = await set_policy(client, alice)
    assert p["user_id"] == str(alice.id) and p["allowed_assets"] == ["USDT"] and p["enabled"] is True
    assert (await client.get("/api/v1/policies/me", headers=bob.headers)).status_code == 404  # private per user
    upd = await set_policy(client, alice, max_transaction_amount="0.5", enabled=False)
    assert upd["id"] == p["id"] and upd["enabled"] is False
    base = {"max_transaction_amount": "1", "daily_spending_limit": "2", "allowed_assets": ["USDT"],
            "allowed_chain_ids": [133]}
    bad_bodies = [
        {**base, "max_transaction_amount": "0"}, {**base, "daily_spending_limit": "-1"},
        {**base, "daily_spending_limit": "0.5"},                      # daily < per-tx
        {**base, "allowed_assets": ["DOGE"]}, {**base, "allowed_assets": []},
        {**base, "allowed_chain_ids": [1]}, {**base, "user_id": str(bob.id)},
    ]
    for b in bad_bodies:
        assert (await client.put("/api/v1/policies/me", json=b, headers=alice.headers)).status_code == 422, b


# ------------------------------------------------------------------ guardian rules
async def test_happy_path_intent_created_with_snapshot(client, alice, demo_agents, db):
    req, q = await ready(client, alice)
    r = await client.post(PAY, json={"request_id": req["id"]}, headers=alice.headers)
    assert r.status_code == 201, r.text
    i = r.json()
    assert i["status"] == "VALIDATED" and i["quotation_id"] == q["id"] and i["buyer_id"] == str(alice.id)
    assert i["recipient"] == q["pay_to_address"] and i["asset"] == "USDT" and i["chain_id"] == 133
    assert Decimal(i["amount"]) == Decimal(q["price"]).quantize(Decimal("0.000001"))
    snap = i["conditions_snapshot"]
    assert snap["recipient"] == i["recipient"] and snap["schema"] == "paymesh.payment_conditions.v1"
    assert len(i["snapshot_hash"]) == 64
    assert (await client.get(f"/api/v1/procurement/requests/{req['id']}", headers=alice.headers)).json()["status"] == "payment_pending"
    ev = (await client.get(f"/api/v1/transactions/events?payment_intent_id={i['id']}", headers=alice.headers)).json()
    assert {e["event_type"] for e in ev["items"]} >= {"payment_intent_created", "payment_validated"}
    # nothing was settled or received
    assert (await client.get("/api/v1/transactions/receipts", headers=alice.headers)).json()["total"] == 0
    rows = (await db.execute(select(PaymentReceipt))).scalars().all()
    assert rows == []


async def test_no_policy_blocks_payment(client, alice, demo_agents):
    req = await create_request(client, alice)
    await quote_and_select(client, alice, req["id"])
    r = await client.post(PAY, json={"request_id": req["id"]}, headers=alice.headers)
    assert "policy_missing" in await failures(r)


async def test_disabled_policy_blocks_payment(client, alice, demo_agents):
    req, _ = await ready(client, alice, enabled=False)
    assert "policy_disabled" in await failures(await client.post(PAY, json={"request_id": req["id"]}, headers=alice.headers))


async def test_per_transaction_limit(client, alice, demo_agents):
    req, _ = await ready(client, alice, max_transaction_amount="0.2", daily_spending_limit="5")
    assert "max_transaction_amount" in await failures(await client.post(PAY, json={"request_id": req["id"]}, headers=alice.headers))


async def test_daily_limit_counts_active_intents(client, alice, demo_agents):
    await set_policy(client, alice, max_transaction_amount="0.5", daily_spending_limit="0.5")
    r1 = await create_request(client, alice)
    await quote_and_select(client, alice, r1["id"], pick=0)  # 0.25
    assert (await client.post(PAY, json={"request_id": r1["id"]}, headers=alice.headers)).status_code == 201
    r2 = await create_request(client, alice)
    await quote_and_select(client, alice, r2["id"], pick=1)  # 0.40 -> 0.65 > 0.5
    assert "daily_limit" in await failures(await client.post(PAY, json={"request_id": r2["id"]}, headers=alice.headers))
    # cancelling the first frees the budget
    first = (await client.get(PAY, headers=alice.headers)).json()["items"][0]
    assert (await client.post(f"{PAY}/{first['id']}/cancel", headers=alice.headers)).status_code == 200
    assert (await client.post(PAY, json={"request_id": r2["id"]}, headers=alice.headers)).status_code == 201


async def test_permitted_agents_list(client, alice, demo_agents):
    req = await create_request(client, alice)
    q = await quote_and_select(client, alice, req["id"])
    await set_policy(client, alice, allow_all_agents=False, permitted_agent_ids=[str(uuid.uuid4())])
    assert "policy_agent" in await failures(await client.post(PAY, json={"request_id": req["id"]}, headers=alice.headers))
    await set_policy(client, alice, allow_all_agents=False, permitted_agent_ids=[q["provider_agent_id"]])
    assert (await client.post(PAY, json={"request_id": req["id"]}, headers=alice.headers)).status_code == 201


async def test_policy_asset_and_network_restrictions(client, alice, demo_agents):
    # policy can only list platform-supported values; removing 133 from the policy blocks the payment
    req = await create_request(client, alice)
    await quote_and_select(client, alice, req["id"])
    await set_policy(client, alice, allowed_chain_ids=[177])
    assert "policy_network" in await failures(await client.post(PAY, json={"request_id": req["id"]}, headers=alice.headers))


async def test_expired_quotation_blocks_payment(client, alice, demo_agents, db):
    req, q = await ready(client, alice)
    await db.execute(update(Quotation).where(Quotation.id == uuid.UUID(q["id"])).values(expires_at=utcnow() - timedelta(minutes=1)))
    await db.commit()
    assert "quotation_expired" in await failures(await client.post(PAY, json={"request_id": req["id"]}, headers=alice.headers))


async def test_provider_wallet_change_after_quote_blocks_payment(client, alice, demo_agents, db):
    req, q = await ready(client, alice)
    await db.execute(update(Agent).where(Agent.id == uuid.UUID(q["provider_agent_id"])).values(wallet_address="0x" + "99" * 20))
    await db.commit()
    assert "recipient_changed" in await failures(await client.post(PAY, json={"request_id": req["id"]}, headers=alice.headers))


async def test_inactive_provider_blocks_payment(client, alice, demo_agents, db):
    req, q = await ready(client, alice)
    await db.execute(update(Agent).where(Agent.id == uuid.UUID(q["provider_agent_id"])).values(status="suspended"))
    await db.commit()
    assert "provider_active" in await failures(await client.post(PAY, json={"request_id": req["id"]}, headers=alice.headers))


async def test_self_payment_blocked(client, alice, demo_agents, db):
    req, q = await ready(client, alice)
    await client.patch("/api/v1/users/me", json={"wallet_address": q["pay_to_address"]}, headers=alice.headers)
    assert "self_payment" in await failures(await client.post(PAY, json={"request_id": req["id"]}, headers=alice.headers))


async def test_unsupported_chain_blocked(client, alice, demo_agents, db):
    req, q = await ready(client, alice)
    await db.execute(update(Quotation).where(Quotation.id == uuid.UUID(q["id"])).values(chain_id=1))
    await db.commit()
    assert "network_supported" in await failures(await client.post(PAY, json={"request_id": req["id"]}, headers=alice.headers))


async def test_price_over_budget_blocked_even_if_data_is_tampered(client, alice, demo_agents, db):
    req, q = await ready(client, alice, budget="1")
    await db.execute(update(ProcurementRequest).where(ProcurementRequest.id == uuid.UUID(req["id"])).values(max_budget=Decimal("0.1")))
    await db.commit()
    assert "budget_exceeded" in await failures(await client.post(PAY, json={"request_id": req["id"]}, headers=alice.headers))


async def test_all_failures_reported_together_and_audited(client, alice, demo_agents, db):
    req, _ = await ready(client, alice, max_transaction_amount="0.1", daily_spending_limit="0.1")
    f = await failures(await client.post(PAY, json={"request_id": req["id"]}, headers=alice.headers))
    assert {"max_transaction_amount", "daily_limit"} <= f
    ev = (await db.execute(select(TransactionEvent).where(TransactionEvent.event_type == "payment_validation_rejected"))).scalars().all()
    assert len(ev) == 1 and ev[0].actor_id == alice.id  # audit row survived the failed request
    await db.rollback()  # release the test session's read transaction (single shared SQLite connection)
    assert (await client.get(PAY, headers=alice.headers)).json()["total"] == 0


async def test_cannot_pay_for_someone_elses_request_or_quote(client, alice, bob, demo_agents):
    req, q = await ready(client, alice)
    await set_policy(client, bob)
    r = await client.post(PAY, json={"request_id": req["id"]}, headers=bob.headers)
    assert r.status_code == 404
    bob_req = await create_request(client, bob)
    r = await client.post(PAY, json={"request_id": bob_req["id"], "quotation_id": q["id"]}, headers=bob.headers)
    assert r.status_code == 404  # quotation belongs to alice's request
    r = await client.post(PAY, json={"request_id": bob_req["id"]}, headers=bob.headers)
    assert r.status_code == 409 and r.json()["error"]["code"] == "no_selection"


async def test_quotation_must_be_the_selected_one(client, alice, demo_agents):
    req, q = await ready(client, alice)
    quotes = (await client.get(f"{PROC}/{req['id']}/quotations", headers=alice.headers)).json()
    other = next(x for x in quotes if x["id"] != q["id"])
    f = await failures(await client.post(PAY, json={"request_id": req["id"], "quotation_id": other["id"]}, headers=alice.headers))
    assert "provider_selection" in f and "quotation_status" in f


# ------------------------------------------------------------------ duplicates / idempotency
async def test_idempotent_creation(client, alice, demo_agents):
    req, _ = await ready(client, alice)
    h = {**alice.headers, "Idempotency-Key": "order-123"}
    r1 = await client.post(PAY, json={"request_id": req["id"]}, headers=h)
    r2 = await client.post(PAY, json={"request_id": req["id"]}, headers=h)
    assert r1.status_code == 201 and r2.status_code == 200 and r1.json()["id"] == r2.json()["id"]
    assert (await client.get(PAY, headers=alice.headers)).json()["total"] == 1
    # same key, different payment -> conflict
    req2 = await create_request(client, alice)
    await quote_and_select(client, alice, req2["id"])
    r3 = await client.post(PAY, json={"request_id": req2["id"]}, headers=h)
    assert r3.status_code == 409 and r3.json()["error"]["code"] == "idempotency_conflict"


async def test_duplicate_payment_for_same_quotation_blocked(client, alice, demo_agents):
    req, _ = await ready(client, alice)
    assert (await client.post(PAY, json={"request_id": req["id"]}, headers={**alice.headers, "Idempotency-Key": "a"})).status_code == 201
    r = await client.post(PAY, json={"request_id": req["id"]}, headers={**alice.headers, "Idempotency-Key": "b"})
    assert r.status_code == 409 and r.json()["error"]["code"] == "duplicate_payment"
    assert (await client.get(PAY, headers=alice.headers)).json()["total"] == 1


async def test_cancel_allows_retry_and_restores_request(client, alice, demo_agents):
    req, _ = await ready(client, alice)
    i = (await client.post(PAY, json={"request_id": req["id"]}, headers=alice.headers)).json()
    c = await client.post(f"{PAY}/{i['id']}/cancel", headers=alice.headers)
    assert c.json()["status"] == "CANCELLED"
    assert (await client.get(f"{PROC}/{req['id']}", headers=alice.headers)).json()["status"] == "selected"
    again = await client.post(PAY, json={"request_id": req["id"]}, headers={**alice.headers, "Idempotency-Key": "retry"})
    assert again.status_code == 201 and again.json()["id"] != i["id"]
    # terminal intents cannot be cancelled twice
    assert (await client.post(f"{PAY}/{i['id']}/cancel", headers=alice.headers)).status_code == 409


# ------------------------------------------------------------------ authorize / expiry / privacy
async def test_authorize_moves_to_awaiting_signature_without_hsp(client, alice, demo_agents):
    req, q = await ready(client, alice)
    i = (await client.post(PAY, json={"request_id": req["id"]}, headers=alice.headers)).json()
    r = await client.post(f"{PAY}/{i['id']}/authorize", headers=alice.headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["payment_intent"]["status"] == "AWAITING_SIGNATURE"
    assert "mandate" in body["next_step"] and "Nothing has been signed" in body["note"]
    assert body["review"]["verified_settlement"] is False and body["review"]["recipient"] == q["pay_to_address"]
    assert body["review"]["snapshot_hash"] == i["snapshot_hash"]
    # cannot authorize twice, and cancelling is still possible before signing
    assert (await client.post(f"{PAY}/{i['id']}/authorize", headers=alice.headers)).status_code == 409
    assert (await client.post(f"{PAY}/{i['id']}/cancel", headers=alice.headers)).json()["status"] == "CANCELLED"


async def test_authorize_revalidates_and_fails_closed(client, alice, demo_agents, db):
    req, q = await ready(client, alice)
    i = (await client.post(PAY, json={"request_id": req["id"]}, headers=alice.headers)).json()
    await set_policy(client, alice, enabled=False)  # policy turned off after intent creation
    r = await client.post(f"{PAY}/{i['id']}/authorize", headers=alice.headers)
    assert r.status_code == 422 and "policy_disabled" in {d["rule"] for d in r.json()["error"]["details"]}
    assert (await client.get(f"{PAY}/{i['id']}", headers=alice.headers)).json()["status"] == "FAILED"


async def test_expired_intent_becomes_expired(client, alice, demo_agents, db):
    req, _ = await ready(client, alice)
    i = (await client.post(PAY, json={"request_id": req["id"]}, headers=alice.headers)).json()
    await db.execute(update(PaymentIntent).where(PaymentIntent.id == uuid.UUID(i["id"])).values(expires_at=utcnow() - timedelta(seconds=1)))
    await db.commit()
    got = (await client.get(f"{PAY}/{i['id']}", headers=alice.headers)).json()
    assert got["status"] == "EXPIRED"
    assert (await client.post(f"{PAY}/{i['id']}/authorize", headers=alice.headers)).status_code == 409
    # and the request returns to 'selected' so the user can retry
    assert (await client.get(f"{PROC}/{req['id']}", headers=alice.headers)).json()["status"] == "selected"


async def test_payment_intents_are_private(client, alice, bob, demo_agents):
    req, _ = await ready(client, alice)
    i = (await client.post(PAY, json={"request_id": req["id"]}, headers=alice.headers)).json()
    for path, m in ((f"{PAY}/{i['id']}", "get"), (f"{PAY}/{i['id']}/authorize", "post"), (f"{PAY}/{i['id']}/cancel", "post")):
        assert (await getattr(client, m)(path, headers=bob.headers)).status_code == 404
    assert (await client.get(PAY, headers=bob.headers)).json()["total"] == 0
    ev = await client.get(f"/api/v1/transactions/events?payment_intent_id={i['id']}", headers=bob.headers)
    assert ev.json()["total"] == 0


async def test_no_endpoint_can_sign_submit_or_settle(client, alice, demo_agents):
    req, _ = await ready(client, alice)
    i = (await client.post(PAY, json={"request_id": req["id"]}, headers=alice.headers)).json()
    for action in ("sign", "submit", "settle", "confirm", "success"):
        r = await client.post(f"{PAY}/{i['id']}/{action}", json={"status": "SETTLED"}, headers=alice.headers)
        assert r.status_code in (404, 405)
    for verb in (client.patch, client.put):
        assert (await verb(f"{PAY}/{i['id']}", json={"status": "SETTLED"}, headers=alice.headers)).status_code == 405
    assert (await client.get(f"{PAY}/{i['id']}", headers=alice.headers)).json()["status"] == "VALIDATED"


# ------------------------------------------------------------------ snapshot immutability
async def test_condition_snapshot_is_immutable_at_orm_level(client, alice, demo_agents, db):
    req, _ = await ready(client, alice)
    i = (await client.post(PAY, json={"request_id": req["id"]}, headers=alice.headers)).json()
    intent = await db.get(PaymentIntent, uuid.UUID(i["id"]))
    for col, val in (("amount", Decimal("0.01")), ("recipient", "0x" + "ee" * 20), ("snapshot_hash", "0" * 64),
                     ("conditions_snapshot", {"x": 1}), ("asset", "USDC"), ("chain_id", 1)):
        setattr(intent, col, val)
        with pytest.raises(ValueError, match="immutable"):
            await db.flush()
        await db.rollback()
        intent = await db.get(PaymentIntent, uuid.UUID(i["id"]))
    # status/updated_at are the only mutable fields
    intent.failure_reason = "x"
    await db.flush()


async def test_tampered_snapshot_detected_on_authorize(client, alice, demo_agents, db):
    req, _ = await ready(client, alice)
    i = (await client.post(PAY, json={"request_id": req["id"]}, headers=alice.headers)).json()
    # simulate DB-level tampering that bypasses the ORM guard (Core UPDATE)
    forged = {**i["conditions_snapshot"], "amount": "0.0001"}
    await db.execute(update(PaymentIntent).where(PaymentIntent.id == uuid.UUID(i["id"])).values(conditions_snapshot=forged))
    await db.commit()
    r = await client.post(f"{PAY}/{i['id']}/authorize", headers=alice.headers)
    assert r.status_code == 409 and r.json()["error"]["code"] == "snapshot_integrity"
    assert (await client.get(f"{PAY}/{i['id']}", headers=alice.headers)).json()["status"] == "FAILED"


# ------------------------------------------------------------------ state machine (unit)
def test_state_machine_table_is_consistent():
    assert set(TRANSITIONS) == set(S)
    assert TERMINAL == {S.SETTLED, S.FAILED, S.EXPIRED, S.CANCELLED}
    for t in TERMINAL:
        assert all(not can_transition(t, s) for s in S)
    assert can_transition(S.DRAFT, S.VALIDATED) and not can_transition(S.DRAFT, S.SETTLED)
    assert not can_transition(S.VALIDATED, S.SETTLED) and not can_transition(S.SIGNED, S.SETTLED)
    assert not can_transition(S.SETTLED, S.CANCELLED) and not can_transition(S.SUBMITTED, S.CANCELLED)
    # happy path is connected end-to-end
    path = [S.DRAFT, S.VALIDATED, S.AWAITING_SIGNATURE, S.SIGNED, S.SUBMITTED, S.PENDING, S.SETTLED]
    assert all(can_transition(a, b) for a, b in zip(path, path[1:], strict=False))


def test_settled_requires_verified_evidence():
    with pytest.raises(ConflictError) as e:
        assert_transition(S.PENDING, S.SETTLED, internal=True)
    assert e.value.code == "settlement_not_verified"
    assert_transition(S.PENDING, S.SETTLED, internal=True, settlement=VerifiedSettlement("r1", "0xabc", "test"))


def test_server_only_states_need_internal_flag():
    for dst in SERVER_ONLY:
        src = next(s for s, nxt in TRANSITIONS.items() if dst in nxt)
        with pytest.raises(ConflictError):
            assert_transition(src, dst, internal=False)
    with pytest.raises(ConflictError):
        assert_transition(S.SETTLED, S.CANCELLED, internal=True)


async def test_mark_settled_hook_enforces_evidence(client, alice, demo_agents, db):
    from app.core.config import get_settings

    req, _ = await ready(client, alice)
    i = (await client.post(PAY, json={"request_id": req["id"]}, headers=alice.headers)).json()
    svc = PaymentService(db, get_settings())
    intent = await db.get(PaymentIntent, uuid.UUID(i["id"]))
    with pytest.raises(ConflictError):  # VALIDATED -> SETTLED is not a legal edge, evidence or not
        await svc.mark_settled(intent, VerifiedSettlement("r", "0x1", "test"))
    assert intent.status == "VALIDATED"
