"""Agent + service management, ownership, discovery, demo agents."""

from __future__ import annotations

import pytest
from httpx import AsyncClient

from tests.conftest import TestUser


WALLET = "0x" + "44" * 20


async def make_agent(client: AsyncClient, user: TestUser, **over) -> dict:  # noqa: ANN003
    body = {"name": "Alice Research Bot", "description": "Does research", "wallet_address": WALLET,
            "category": "crypto_research", "capabilities": ["research"]}
    body.update(over)
    r = await client.post("/api/v1/agents", json=body, headers=user.headers)
    assert r.status_code == 201, r.text
    return r.json()


async def test_register_agent_sets_owner_server_side(client, alice: TestUser, bob: TestUser):
    a = await make_agent(client, alice)
    assert a["owner_id"] == str(alice.id) and a["kind"] == "external" and a["is_demo"] is False
    assert a["status"] == "active" and a["onchain_registration_reference"] is None
    # a client cannot choose the owner / kind / status
    r = await client.post("/api/v1/agents", headers=alice.headers, json={
        "name": "Sneaky", "wallet_address": WALLET, "category": "other", "owner_id": str(bob.id), "kind": "demo"})
    assert r.status_code == 422


async def test_wallet_validation(client, alice):
    for bad in ("0x1234", "not-an-address", "0x" + "0" * 40, "0x" + "zz" * 20):
        r = await client.post("/api/v1/agents", headers=alice.headers,
                              json={"name": "Bad", "wallet_address": bad, "category": "other"})
        assert r.status_code == 422, bad
    # mixed-case with a wrong checksum is rejected; all-lowercase is normalized to checksum
    r = await client.post("/api/v1/agents", headers=alice.headers, json={
        "name": "Ok", "wallet_address": "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed", "category": "other"})
    assert r.status_code == 201
    r = await client.post("/api/v1/agents", headers=alice.headers, json={
        "name": "Bad checksum", "wallet_address": "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAeD", "category": "other"})
    assert r.status_code == 422


async def test_ownership_enforced_on_update_and_delete(client, alice, bob):
    a = await make_agent(client, alice)
    assert (await client.patch(f"/api/v1/agents/{a['id']}", json={"name": "Hacked"}, headers=bob.headers)).status_code == 403
    assert (await client.delete(f"/api/v1/agents/{a['id']}", headers=bob.headers)).status_code == 403
    r = await client.patch(f"/api/v1/agents/{a['id']}", json={"name": "Renamed"}, headers=alice.headers)
    assert r.status_code == 200 and r.json()["name"] == "Renamed"
    assert (await client.delete(f"/api/v1/agents/{a['id']}", headers=alice.headers)).status_code == 204
    assert (await client.get(f"/api/v1/agents/{a['id']}", headers=alice.headers)).status_code == 404


async def test_discovery_filters_pagination_and_visibility(client, alice, bob):
    a1 = await make_agent(client, alice, name="Alpha Research", category="crypto_research")
    await make_agent(client, alice, name="Beta Data", category="market_data")
    a3 = await make_agent(client, alice, name="Gamma Hidden", category="market_data")
    await client.patch(f"/api/v1/agents/{a3['id']}", json={"status": "inactive"}, headers=alice.headers)

    r = await client.get("/api/v1/agents", headers=bob.headers)
    names = {i["name"] for i in r.json()["items"]}
    assert names == {"Alpha Research", "Beta Data"} and r.json()["total"] == 2  # inactive hidden from others
    r = await client.get("/api/v1/agents?category=market_data", headers=bob.headers)
    assert [i["name"] for i in r.json()["items"]] == ["Beta Data"]
    r = await client.get("/api/v1/agents?q=alpha", headers=bob.headers)
    assert r.json()["items"][0]["id"] == a1["id"]
    r = await client.get("/api/v1/agents?limit=1&offset=1", headers=bob.headers)
    assert len(r.json()["items"]) == 1 and r.json()["total"] == 2
    assert (await client.get("/api/v1/agents?limit=1000", headers=bob.headers)).status_code == 422
    # the inactive agent is visible to its owner only
    assert (await client.get(f"/api/v1/agents/{a3['id']}", headers=bob.headers)).status_code == 404
    assert (await client.get(f"/api/v1/agents/{a3['id']}", headers=alice.headers)).status_code == 200
    mine = (await client.get("/api/v1/agents?mine=true", headers=alice.headers)).json()
    assert mine["total"] == 3


async def test_owner_cannot_unsuspend_or_suspend(client, alice, admin):
    a = await make_agent(client, alice)
    r = await client.patch(f"/api/v1/agents/{a['id']}", json={"status": "suspended"}, headers=alice.headers)
    assert r.status_code == 403
    assert (await client.post(f"/api/v1/agents/{a['id']}/suspend", headers=alice.headers)).status_code == 403
    r = await client.post(f"/api/v1/agents/{a['id']}/suspend", headers=admin.headers)
    assert r.status_code == 200 and r.json()["status"] == "suspended"
    r = await client.patch(f"/api/v1/agents/{a['id']}", json={"status": "active"}, headers=alice.headers)
    assert r.status_code == 403


async def test_demo_agents_seeded_labelled_and_protected(client, alice, admin, demo_agents):
    assert len(demo_agents["created"]) == 3
    r = await client.get("/api/v1/agents?kind=demo", headers=alice.headers)
    items = r.json()["items"]
    assert len(items) == 3 and all(i["is_demo"] and i["kind"] == "demo" and i["owner_id"] is None for i in items)
    names = {i["name"] for i in items}
    assert any("Crypto Research" in n for n in names) and any("Market Data" in n for n in names) \
        and any("AI Analytics" in n for n in names)
    demo = items[0]
    assert (await client.patch(f"/api/v1/agents/{demo['id']}", json={"name": "x" * 5}, headers=alice.headers)).status_code == 403
    assert (await client.delete(f"/api/v1/agents/{demo['id']}", headers=alice.headers)).status_code == 403
    # seeding is admin-only and idempotent
    assert (await client.post("/api/v1/agents/demo/seed", headers=alice.headers)).status_code == 403
    again = (await client.post("/api/v1/agents/demo/seed", headers=admin.headers)).json()
    assert again["created"] == [] and len(again["existing"]) == 3


async def test_demo_seed_skips_when_wallet_missing(db, monkeypatch):
    from app.core.config import get_settings
    from app.services.demo_agents import seed_demo_agents

    s = get_settings().model_copy(update={"DEMO_MARKET_DATA_WALLET": "", "DEMO_AI_ANALYTICS_WALLET": "garbage"})
    res = await seed_demo_agents(db, s)
    assert len(res["created"]) == 1 and len(res["skipped"]) == 2


async def test_service_crud_and_ownership(client, alice, bob):
    a = await make_agent(client, alice)
    body = {"provider_agent_id": a["id"], "name": "Weekly report", "description": "d", "price": "0.5",
            "payment_asset": "usdt", "delivery_estimate_minutes": 30}
    assert (await client.post("/api/v1/services", json=body, headers=bob.headers)).status_code == 403
    r = await client.post("/api/v1/services", json=body, headers=alice.headers)
    assert r.status_code == 201, r.text
    s = r.json()
    assert s["payment_asset"] == "USDT" and s["price"] == "0.500000000000000000" or s["price"].startswith("0.5")

    assert (await client.patch(f"/api/v1/services/{s['id']}", json={"price": "0.7"}, headers=bob.headers)).status_code == 403
    r = await client.patch(f"/api/v1/services/{s['id']}", json={"price": "0.7"}, headers=alice.headers)
    assert r.status_code == 200 and float(r.json()["price"]) == 0.7

    lst = (await client.get(f"/api/v1/services?agent_id={a['id']}", headers=bob.headers)).json()
    assert lst["total"] == 1
    assert (await client.get(f"/api/v1/services?max_price=0.1", headers=bob.headers)).json()["total"] == 0
    assert (await client.delete(f"/api/v1/services/{s['id']}", headers=bob.headers)).status_code == 403
    assert (await client.delete(f"/api/v1/services/{s['id']}", headers=alice.headers)).status_code == 204
    assert (await client.get(f"/api/v1/services/{s['id']}", headers=alice.headers)).status_code == 404


async def test_service_validation(client, alice):
    a = await make_agent(client, alice)
    base = {"provider_agent_id": a["id"], "name": "Svc", "price": "1", "payment_asset": "USDT"}
    assert (await client.post("/api/v1/services", json={**base, "price": "0"}, headers=alice.headers)).status_code == 422
    assert (await client.post("/api/v1/services", json={**base, "price": "-1"}, headers=alice.headers)).status_code == 422
    r = await client.post("/api/v1/services", json={**base, "payment_asset": "DOGE"}, headers=alice.headers)
    assert r.status_code == 422 and r.json()["error"]["code"] == "unsupported_asset"


async def test_agent_with_history_cannot_be_deleted(client, alice, bob, demo_agents):
    from tests.conftest import create_request

    req = await create_request(client, bob)
    await client.post(f"/api/v1/procurement/requests/{req['id']}/quotations", headers=bob.headers)
    quotes = (await client.get(f"/api/v1/procurement/requests/{req['id']}/quotations", headers=bob.headers)).json()
    assert quotes  # demo agents quoted; demo agents are protected anyway
    ext = await make_agent(client, alice, name="History Agent")
    # give the external agent history by hand through the API: service + solicited quote
    await client.post("/api/v1/services", headers=alice.headers, json={
        "provider_agent_id": ext["id"], "name": "Short report", "price": "0.3", "payment_asset": "USDT"})
    req2 = await create_request(client, bob)
    await client.post(f"/api/v1/procurement/requests/{req2['id']}/quotations", headers=bob.headers)
    q = await client.post("/api/v1/quotations", headers=alice.headers, json={
        "request_id": req2["id"], "provider_agent_id": ext["id"], "price": "0.3", "payment_asset": "USDT",
        "delivery_estimate_minutes": 10})
    assert q.status_code == 201, q.text
    r = await client.delete(f"/api/v1/agents/{ext['id']}", headers=alice.headers)
    assert r.status_code == 409 and r.json()["error"]["code"] == "agent_in_use"
