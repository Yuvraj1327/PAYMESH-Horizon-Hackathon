"""Procurement lifecycle, quotations, ownership, external providers."""

from __future__ import annotations

from tests.conftest import TestUser, create_request, quote_and_select
from tests.test_marketplace import make_agent

BASE = "/api/v1/procurement/requests"


async def test_full_lifecycle_with_three_demo_providers(client, alice, demo_agents):
    req = await create_request(client, alice)
    assert req["status"] == "created" and req["buyer_id"] == str(alice.id)

    cands = (await client.get(f"{BASE}/{req['id']}/candidates", headers=alice.headers)).json()
    assert len(cands) == 3 and all(c["is_demo"] for c in cands)

    r = await client.post(f"{BASE}/{req['id']}/quotations", headers=alice.headers)
    assert r.status_code == 200 and len(r.json()["created_quotations"]) == 3
    assert r.json()["awaiting_external_agents"] == []
    assert (await client.get(f"{BASE}/{req['id']}", headers=alice.headers)).json()["status"] == "quoted"

    quotes = (await client.get(f"{BASE}/{req['id']}/quotations", headers=alice.headers)).json()
    assert [round(float(q["price"]), 2) for q in quotes] == [0.25, 0.4, 0.6]
    assert all(q["chain_id"] == 133 and q["status"] == "submitted" and q["response_details"]["demo"] for q in quotes)

    # re-requesting is idempotent: no duplicate quotations
    r = await client.post(f"{BASE}/{req['id']}/quotations", headers=alice.headers)
    assert r.json()["created_quotations"] == []
    assert len((await client.get(f"{BASE}/{req['id']}/quotations", headers=alice.headers)).json()) == 3

    rec = (await client.post(f"{BASE}/{req['id']}/recommend", headers=alice.headers)).json()
    chosen = rec["recommended_quotation_id"]
    r = await client.post(f"{BASE}/{req['id']}/select", json={"quotation_id": chosen}, headers=alice.headers)
    assert r.status_code == 200
    sel = r.json()
    assert sel["status"] == "selected" and sel["selected_quotation_id"] == chosen
    quotes = (await client.get(f"{BASE}/{req['id']}/quotations", headers=alice.headers)).json()
    assert [q["status"] for q in quotes if q["id"] == chosen] == ["accepted"]

    msgs = (await client.get(f"/api/v1/ai/requests/{req['id']}/messages", headers=alice.headers)).json()["items"]
    types = [m["message_type"] for m in msgs]
    assert types[0] == "task_parsed" and types.count("service_request") == 3 and types.count("quotation") == 3
    assert "recommendation" in types and types[-1] == "selection"


async def test_requests_are_private_to_their_buyer(client, alice, bob, demo_agents):
    req = await create_request(client, alice)
    for method, path in (("get", ""), ("get", "/candidates"), ("post", "/quotations"), ("post", "/recommend"),
                         ("get", "/quotations"), ("post", "/cancel")):
        r = await getattr(client, method)(f"{BASE}/{req['id']}{path}", headers=bob.headers)
        assert r.status_code == 404, path
    assert (await client.get(BASE, headers=bob.headers)).json()["total"] == 0
    assert (await client.get(BASE, headers=alice.headers)).json()["total"] == 1
    assert (await client.get(f"/api/v1/ai/requests/{req['id']}/messages", headers=bob.headers)).status_code == 404


async def test_budget_and_validation(client, alice):
    h = alice.headers
    base = {"description": "Find crypto research please", "category": "crypto_research", "use_ai": False}
    for bad in ("0", "-1", "abc"):
        assert (await client.post(BASE, json={**base, "max_budget": bad}, headers=h)).status_code == 422
    r = await client.post(BASE, json=base, headers=h)  # no budget at all
    assert r.status_code == 422 and r.json()["error"]["code"] == "budget_required"
    r = await client.post(BASE, json={"description": "Find crypto research please", "max_budget": "1", "use_ai": False}, headers=h)
    assert r.status_code == 422 and r.json()["error"]["code"] == "category_required"
    r = await client.post(BASE, json={**base, "max_budget": "1", "budget_asset": "DOGE"}, headers=h)
    assert r.status_code == 422 and r.json()["error"]["code"] == "unsupported_asset"
    assert (await client.post(BASE, json={**base, "max_budget": "1", "buyer_id": str(alice.id)}, headers=h)).status_code == 422
    assert (await client.post(BASE, json={**base, "max_budget": "1", "description": "short"}, headers=h)).status_code == 422


async def test_budget_filters_candidates(client, alice, demo_agents):
    req = await create_request(client, alice, budget="0.3")
    cands = (await client.get(f"{BASE}/{req['id']}/candidates", headers=alice.headers)).json()
    assert len(cands) == 1 and float(cands[0]["price"]) == 0.25
    r = await client.post(f"{BASE}/{req['id']}/quotations", headers=alice.headers)
    assert len(r.json()["created_quotations"]) == 1


async def test_no_matching_providers(client, alice):
    req = await create_request(client, alice, category="ai_analytics")
    r = await client.post(f"{BASE}/{req['id']}/quotations", headers=alice.headers)
    assert r.json()["candidates"] == 0 and r.json()["created_quotations"] == []
    rec = (await client.post(f"{BASE}/{req['id']}/recommend", headers=alice.headers)).json()
    assert rec["recommended_quotation_id"] is None and "No eligible" in rec["rationale"]
    r = await client.post(f"{BASE}/{req['id']}/select", json={"quotation_id": "00000000-0000-0000-0000-000000000001"},
                          headers=alice.headers)
    assert r.status_code == 409  # status is 'quoting', nothing to select


async def test_select_validations(client, alice, bob, demo_agents):
    req = await create_request(client, alice)
    other = await create_request(client, bob)
    await client.post(f"{BASE}/{req['id']}/quotations", headers=alice.headers)
    await client.post(f"{BASE}/{other['id']}/quotations", headers=bob.headers)
    mine = (await client.get(f"{BASE}/{req['id']}/quotations", headers=alice.headers)).json()
    theirs = (await client.get(f"{BASE}/{other['id']}/quotations", headers=bob.headers)).json()
    # quotation from another request
    r = await client.post(f"{BASE}/{req['id']}/select", json={"quotation_id": theirs[0]["id"]}, headers=alice.headers)
    assert r.status_code == 404
    # unknown id
    r = await client.post(f"{BASE}/{req['id']}/select", json={"quotation_id": "00000000-0000-0000-0000-000000000009"},
                          headers=alice.headers)
    assert r.status_code == 404
    assert (await client.post(f"{BASE}/{req['id']}/select", json={"quotation_id": mine[0]["id"]}, headers=alice.headers)).status_code == 200
    # switching selection before payment is allowed and keeps exactly one accepted quotation
    assert (await client.post(f"{BASE}/{req['id']}/select", json={"quotation_id": mine[1]["id"]}, headers=alice.headers)).status_code == 200
    qs = (await client.get(f"{BASE}/{req['id']}/quotations", headers=alice.headers)).json()
    assert [q["status"] for q in qs].count("accepted") == 1


async def test_cancel_request(client, alice, demo_agents):
    req = await create_request(client, alice)
    assert (await client.post(f"{BASE}/{req['id']}/cancel", headers=alice.headers)).json()["status"] == "cancelled"
    assert (await client.post(f"{BASE}/{req['id']}/quotations", headers=alice.headers)).status_code == 409


async def test_deliver_requires_verified_settlement(client, alice, demo_agents):
    from tests.conftest import set_policy

    await set_policy(client, alice)
    req = await create_request(client, alice)
    await quote_and_select(client, alice, req["id"])
    r = await client.post(f"{BASE}/{req['id']}/deliver", headers=alice.headers)
    assert r.status_code == 409 and r.json()["error"]["code"] == "payment_not_settled"
    await client.post("/api/v1/payments/intents", json={"request_id": req["id"]}, headers=alice.headers)
    r = await client.post(f"{BASE}/{req['id']}/deliver", headers=alice.headers)  # VALIDATED is not SETTLED
    assert r.status_code == 409


# ------------------------------------------------------------------ external providers
async def _external_setup(client, provider: TestUser, buyer: TestUser):
    ext = await make_agent(client, provider, name="External Research")
    svc = await client.post("/api/v1/services", headers=provider.headers, json={
        "provider_agent_id": ext["id"], "name": "Custom report", "price": "0.45", "payment_asset": "USDT"})
    assert svc.status_code == 201
    req = await create_request(client, buyer)
    r = await client.post(f"{BASE}/{req['id']}/quotations", headers=buyer.headers)
    assert ext["id"] in r.json()["awaiting_external_agents"]
    return ext, req


async def test_external_provider_quotes_after_being_solicited(client, alice, bob):
    ext, req = await _external_setup(client, alice, bob)
    r = await client.post("/api/v1/quotations", headers=alice.headers, json={
        "request_id": req["id"], "provider_agent_id": ext["id"], "price": "0.45", "payment_asset": "USDT",
        "delivery_estimate_minutes": 45, "details": "I will deliver a PDF."})
    assert r.status_code == 201, r.text
    q = r.json()
    assert q["pay_to_address"] == ext["wallet_address"]  # payout address is the agent's registered wallet
    assert q["chain_id"] == 133 and q["response_details"]["demo"] is False
    # duplicates blocked
    r = await client.post("/api/v1/quotations", headers=alice.headers, json={
        "request_id": req["id"], "provider_agent_id": ext["id"], "price": "0.40", "payment_asset": "USDT",
        "delivery_estimate_minutes": 45})
    assert r.status_code == 409
    # buyer and provider can see it; a stranger cannot
    assert (await client.get(f"/api/v1/quotations/{q['id']}", headers=bob.headers)).status_code == 200
    assert (await client.get(f"/api/v1/quotations/{q['id']}", headers=alice.headers)).status_code == 200
    assert (await client.get(f"/api/v1/quotations/{q['id']}", headers=TestUser("eve").headers)).status_code == 404
    assert (await client.get("/api/v1/quotations", headers=TestUser("eve").headers)).json()["total"] == 0
    assert (await client.get(f"/api/v1/quotations?request_id={req['id']}", headers=alice.headers)).json()["total"] == 1


async def test_external_quotation_guards(client, alice, bob):
    ext, req = await _external_setup(client, alice, bob)
    body = {"request_id": req["id"], "provider_agent_id": ext["id"], "price": "0.45", "payment_asset": "USDT",
            "delivery_estimate_minutes": 45}
    # not the owner
    assert (await client.post("/api/v1/quotations", headers=bob.headers, json=body)).status_code == 403
    # over budget / wrong asset
    assert (await client.post("/api/v1/quotations", headers=alice.headers, json={**body, "price": "1.01"})).status_code == 422
    assert (await client.post("/api/v1/quotations", headers=alice.headers, json={**body, "payment_asset": "USDC"})).status_code == 422
    # client cannot supply a payout address
    assert (await client.post("/api/v1/quotations", headers=alice.headers,
                              json={**body, "pay_to_address": "0x" + "99" * 20})).status_code == 422
    # an agent that was never solicited (different category) cannot quote
    stray = await make_agent(client, alice, name="Stray Agent", category="other")
    r = await client.post("/api/v1/quotations", headers=alice.headers, json={**body, "provider_agent_id": stray["id"]})
    assert r.status_code == 403 and r.json()["error"]["code"] == "not_solicited"
    # unknown request
    r = await client.post("/api/v1/quotations", headers=alice.headers,
                          json={**body, "request_id": "00000000-0000-0000-0000-000000000009"})
    assert r.status_code == 404


async def test_provider_can_withdraw_and_withdrawn_cannot_be_selected(client, alice, bob):
    ext, req = await _external_setup(client, alice, bob)
    q = (await client.post("/api/v1/quotations", headers=alice.headers, json={
        "request_id": req["id"], "provider_agent_id": ext["id"], "price": "0.45", "payment_asset": "USDT",
        "delivery_estimate_minutes": 45})).json()
    assert (await client.post(f"/api/v1/quotations/{q['id']}/withdraw", headers=bob.headers)).status_code == 404
    assert (await client.post(f"/api/v1/quotations/{q['id']}/withdraw", headers=alice.headers)).json()["status"] == "withdrawn"
    r = await client.post(f"{BASE}/{req['id']}/select", json={"quotation_id": q["id"]}, headers=bob.headers)
    assert r.status_code == 422 and r.json()["error"]["code"] == "quotation_ineligible"
