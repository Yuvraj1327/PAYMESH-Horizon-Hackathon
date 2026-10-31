"""Blockchain read-only layer (mocked RPC + optional live connectivity) and the HSP Step-1 boundary."""

from __future__ import annotations

import os
import uuid

import pytest

from app.core.config import get_settings
from app.core.errors import ServiceUnavailableError
from app.integrations.blockchain.client import (
    ChainClient,
    agent_uuid_to_bytes32,
    category_to_bytes32,
    get_chain_client,
)
from tests.test_marketplace import make_agent

settings = get_settings()
OWNER = "0x" + "44" * 20


class _Call:
    def __init__(self, value):  # noqa: ANN001
        self.value = value

    async def call(self):  # noqa: ANN201
        if isinstance(self.value, Exception):
            raise self.value
        return self.value


class FakeFunctions:
    def __init__(self, registered: dict):
        self.registered = registered

    def isRegistered(self, key):  # noqa: ANN001, ANN201, N802
        return _Call(key in self.registered)

    def getAgent(self, key):  # noqa: ANN001, ANN201, N802
        return _Call(self.registered[key])


class FakeEth:
    def __init__(self, chain_id=133, block=12345, registered=None, fail=False):  # noqa: ANN001
        self._chain_id, self._block, self.fail = chain_id, block, fail
        self.registered = registered or {}

    @property
    async def chain_id(self):  # noqa: ANN201
        if self.fail:
            raise ConnectionError("rpc down")
        return self._chain_id

    @property
    async def block_number(self):  # noqa: ANN201
        return self._block

    def contract(self, address, abi):  # noqa: ANN001, ANN201
        return type("C", (), {"functions": FakeFunctions(self.registered)})()


class FakeW3:
    def __init__(self, **kw):  # noqa: ANN003
        self.eth = FakeEth(**kw)


def chain(**kw) -> ChainClient:  # noqa: ANN003
    return ChainClient(settings, w3=FakeW3(**kw))  # type: ignore[arg-type]


def test_key_encoding_roundtrip_and_category():
    aid = uuid.uuid4()
    key = agent_uuid_to_bytes32(aid)
    assert len(key) == 32 and uuid.UUID(bytes=key[:16]) == aid and key[16:] == b"\x00" * 16
    cat = category_to_bytes32("crypto_research")
    assert len(cat) == 32 and cat.rstrip(b"\x00") == b"crypto_research"
    with pytest.raises(ValueError):
        category_to_bytes32("x" * 33)


async def test_status_reports_chain_and_mismatch():
    ok = await chain(chain_id=133).status()
    assert ok["chain_id_matches"] is True and ok["network"] == "HashKey Chain Testnet" and ok["latest_block"] == 12345
    bad = await chain(chain_id=177).status()
    assert bad["chain_id_matches"] is False and bad["network"] == "HashKey Chain Mainnet"
    with pytest.raises(ServiceUnavailableError):
        await chain(fail=True).status()


async def test_get_agent_registered_and_unregistered():
    aid = uuid.uuid4()
    key = agent_uuid_to_bytes32(aid)
    c = chain(registered={key: (OWNER, category_to_bytes32("crypto_research"), "ipfs://meta", True, 1700000000)})
    got = await c.get_agent(aid)
    assert got.registered and got.owner.lower() == OWNER and got.active is True and got.metadata_uri == "ipfs://meta"
    assert (await c.get_agent(uuid.uuid4())).registered is False


async def test_get_agent_refuses_wrong_chain_and_missing_registry(monkeypatch):
    with pytest.raises(ServiceUnavailableError) as e:
        await chain(chain_id=1).get_agent(uuid.uuid4())
    assert e.value.code == "wrong_chain"
    s = settings.model_copy(update={"AGENT_REGISTRY_ADDRESS": ""})
    with pytest.raises(ServiceUnavailableError) as e:
        await ChainClient(s, w3=FakeW3()).get_agent(uuid.uuid4())  # type: ignore[arg-type]
    assert e.value.code == "registry_not_configured"


async def test_backend_holds_no_signing_capability():
    """The chain client is read-only by construction: no key material, no send/sign methods."""
    c = chain()
    assert not any(hasattr(c, n) for n in ("send_transaction", "sign", "private_key", "account"))
    # The only private key the backend may hold is the HSP *merchant* ES256K key (signs Cart Mandate JWTs; it cannot
    # move funds). No wallet / deployer / payer key may ever appear in configuration.
    private_fields = {k for k in type(settings).model_fields if "PRIVATE" in k or "MNEMONIC" in k or "SEED" in k}
    assert private_fields <= {"HSP_MERCHANT_PRIVATE_KEY_PEM", "HSP_MERCHANT_PRIVATE_KEY_FILE"}


# ------------------------------------------------------------------ API
async def test_blockchain_api_status_and_onchain_read(client, app, alice):
    app.dependency_overrides[get_chain_client] = lambda: chain()
    r = await client.get("/api/v1/blockchain/status", headers=alice.headers)
    assert r.status_code == 200 and r.json()["chain_id_matches"] is True
    ag = await make_agent(client, alice)
    r = await client.get(f"/api/v1/blockchain/agents/{ag['id']}/onchain", headers=alice.headers)
    assert r.status_code == 200 and r.json()["registered"] is False
    assert r.json()["registry_agent_key"] == "0x" + agent_uuid_to_bytes32(uuid.UUID(ag["id"])).hex()
    assert (await client.get("/api/v1/blockchain/status")).status_code == 401


async def test_verify_registration_is_server_verified(client, app, alice, bob):
    ag = await make_agent(client, alice)  # wallet = 0x4444...
    aid = uuid.UUID(ag["id"])
    key = agent_uuid_to_bytes32(aid)
    url = f"/api/v1/blockchain/agents/{ag['id']}/verify-registration"

    app.dependency_overrides[get_chain_client] = lambda: chain()
    r = await client.post(url, headers=alice.headers)  # not registered yet
    assert r.status_code == 409 and r.json()["error"]["code"] == "not_registered_onchain"

    # registered on-chain by someone else's wallet -> rejected
    app.dependency_overrides[get_chain_client] = lambda: chain(
        registered={key: ("0x" + "77" * 20, category_to_bytes32("x"), "", True, 1)})
    r = await client.post(url, headers=alice.headers)
    assert r.status_code == 403 and r.json()["error"]["code"] == "onchain_owner_mismatch"

    # only the agent's owner may even try
    assert (await client.post(url, headers=bob.headers)).status_code == 403

    # registered by the agent's wallet -> reference stored (derived by the backend, not supplied by the client)
    app.dependency_overrides[get_chain_client] = lambda: chain(registered={key: (OWNER, category_to_bytes32("x"), "", True, 1)})
    r = await client.post(url, headers=alice.headers)
    assert r.status_code == 200
    ref = r.json()["onchain_registration_reference"]
    assert ref.startswith(f"133:{settings.AGENT_REGISTRY_ADDRESS}:0x")
    got = (await client.get(f"/api/v1/agents/{ag['id']}", headers=alice.headers)).json()
    assert got["onchain_registration_reference"] == ref
    # changing the payout wallet invalidates the on-chain reference
    r = await client.patch(f"/api/v1/agents/{ag['id']}", json={"wallet_address": "0x" + "88" * 20}, headers=alice.headers)
    assert r.json()["onchain_registration_reference"] is None


@pytest.mark.network
@pytest.mark.skipif(not os.getenv("RUN_NETWORK_TESTS"), reason="set RUN_NETWORK_TESTS=1 to hit the real HashKey RPC")
async def test_live_testnet_connectivity():
    s = settings.model_copy(update={"HSK_RPC_URL": "https://testnet.hsk.xyz", "HSK_CHAIN_ID": 133})
    st = await ChainClient(s).status()
    assert st["rpc_chain_id"] == 133 and st["latest_block"] > 0


# ------------------------------------------------------------------ no fabricated HSP data
async def test_no_fabricated_hsp_data_is_ever_stored(client, alice, demo_agents, db):
    from sqlalchemy import func, select

    from app.models import HspPaymentFlow, PaymentReceipt
    from tests.conftest import create_request, quote_and_select, set_policy

    await set_policy(client, alice)
    req = await create_request(client, alice)
    await quote_and_select(client, alice, req["id"])
    i = (await client.post("/api/v1/payments/intents", json={"request_id": req["id"]}, headers=alice.headers)).json()
    await client.post(f"/api/v1/payments/intents/{i['id']}/authorize", headers=alice.headers)
    for model in (HspPaymentFlow, PaymentReceipt):
        assert (await db.execute(select(func.count()).select_from(model))).scalar_one() == 0
    await db.rollback()


def test_python_abi_matches_compiled_contract():
    """Guards against drift between contracts/AgentRegistry.sol and the backend's hand-written read ABI."""
    import json
    from pathlib import Path

    from app.integrations.blockchain.client import AGENT_REGISTRY_ABI

    artifact = Path(__file__).resolve().parents[2] / "contracts/artifacts/contracts/AgentRegistry.sol/AgentRegistry.json"
    if not artifact.exists():
        pytest.skip("compile the contract first (cd contracts && npm run compile)")
    compiled = {e["name"]: e for e in json.loads(artifact.read_text())["abi"] if e["type"] == "function"}
    for fn in AGENT_REGISTRY_ABI:
        real = compiled[fn["name"]]
        assert [i["type"] for i in fn["inputs"]] == [i["type"] for i in real["inputs"]], fn["name"]
        assert fn["stateMutability"] == real["stateMutability"] == "view"
        assert [o["type"] for o in fn["outputs"]] == [o["type"] for o in real["outputs"]], fn["name"]
        if fn["name"] == "getAgent":
            names = [c["name"] for c in fn["outputs"][0]["components"]]
            assert names == [c["name"] for c in real["outputs"][0]["components"]]
