"""Health, error format, auth, users, rate limiting, DB models."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from unittest.mock import patch

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.core.config import get_settings
from app.database.base import Base
from app.main import create_app
from app.models import Profile
from tests.conftest import TEST_JWT_SECRET, TestUser, make_token



async def test_health_and_ready(client: AsyncClient):
    assert (await client.get("/health")).json() == {"status": "ok"}
    r = await client.get("/api/v1/health/ready")
    assert r.status_code == 200
    body = r.json()
    assert body["database"] == "ok" and body["hsp_configured"] is True


async def test_openapi_lists_all_route_groups(client: AsyncClient):
    paths = (await client.get("/openapi.json")).json()["paths"]
    for prefix in ("users", "agents", "services", "procurement", "quotations", "ai", "policies", "payments",
                   "transactions", "blockchain"):
        assert any(p.startswith(f"/api/v1/{prefix}") for p in paths), prefix


async def test_all_twelve_tables_exist():
    assert {
        "profiles", "agents", "services", "procurement_requests", "quotations", "spending_policies",
        "payment_intents", "hsp_payment_flows", "payment_receipts", "agent_messages", "transaction_events", "reviews",
    } <= set(Base.metadata.tables)


async def test_error_format_is_standardized(client: AsyncClient):
    r = await client.get("/api/v1/users/me")
    assert r.status_code == 401
    err = r.json()["error"]
    assert err["code"] == "unauthorized" and err["request_id"] and "message" in err
    assert r.headers["x-request-id"]
    r = await client.get("/api/v1/nope")
    assert r.status_code == 404 and r.json()["error"]["code"] == "http_404"


async def test_validation_error_format(client: AsyncClient, alice: TestUser):
    r = await client.post("/api/v1/agents", json={"name": "x"}, headers=alice.headers)
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "validation_error"
    assert isinstance(r.json()["error"]["details"], list)


# ---------------------------------------------------------------------------------- JWT auth
async def test_valid_token_creates_profile(client: AsyncClient, alice: TestUser, db):
    r = await client.get("/api/v1/users/me", headers=alice.headers)
    assert r.status_code == 200
    body = r.json()
    assert body["id"] == str(alice.id) and body["email"] == alice.email and body["role"] == "user"
    assert (await db.get(Profile, alice.id)) is not None


@pytest.mark.parametrize(
    "token_kwargs",
    [
        {"secret": "wrong-secret-wrong-secret-wrong-secret-xx"},
        {"exp_delta": -10},
        {"aud": "someone-else"},
        {"iss": "https://evil.example.com/auth/v1"},
    ],
)
async def test_bad_tokens_rejected(client: AsyncClient, alice: TestUser, token_kwargs):
    tok = make_token(alice.id, **token_kwargs)
    r = await client.get("/api/v1/users/me", headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 401


async def test_alg_none_and_garbage_rejected(client: AsyncClient, alice: TestUser):
    none_tok = jwt.encode({"sub": str(alice.id), "aud": "authenticated"}, key=None, algorithm="none")
    for tok in (none_tok, "not.a.jwt", ""):
        r = await client.get("/api/v1/users/me", headers={"Authorization": f"Bearer {tok}"})
        assert r.status_code == 401


async def test_missing_sub_rejected(client: AsyncClient):
    now = datetime.now(UTC)
    tok = jwt.encode({"aud": "authenticated", "iss": get_settings().supabase_issuer, "exp": now + timedelta(hours=1)},
                     TEST_JWT_SECRET, algorithm="HS256")
    assert (await client.get("/api/v1/users/me", headers={"Authorization": f"Bearer {tok}"})).status_code == 401


async def test_asymmetric_token_verified_via_jwks(client: AsyncClient, alice: TestUser):
    """ES256 tokens are verified with the JWKS key; an HS256 token can never use a public key as secret."""
    key = ec.generate_private_key(ec.SECP256R1())
    now = datetime.now(UTC)
    claims = {"sub": str(alice.id), "email": alice.email, "aud": "authenticated",
              "iss": get_settings().supabase_issuer, "exp": now + timedelta(hours=1)}
    tok = jwt.encode(claims, key, algorithm="ES256", headers={"kid": "k1"})

    class FakeJWKS:
        def get_signing_key_from_jwt(self, _):  # noqa: ANN001, ANN201
            return type("K", (), {"key": key.public_key()})()

    with patch("app.integrations.supabase.jwt._jwks_client", return_value=FakeJWKS()):
        ok = await client.get("/api/v1/users/me", headers={"Authorization": f"Bearer {tok}"})
        assert ok.status_code == 200
        other = ec.generate_private_key(ec.SECP256R1())
        forged = jwt.encode(claims, other, algorithm="ES256", headers={"kid": "k1"})
        assert (await client.get("/api/v1/users/me", headers={"Authorization": f"Bearer {forged}"})).status_code == 401


async def test_role_cannot_be_set_by_client(client: AsyncClient, alice: TestUser, db):
    # JWT claims claiming admin are ignored; role comes from the profiles table.
    tok = make_token(alice.id, alice.email, extra={"role": "admin", "app_metadata": {"role": "admin"}})
    h = {"Authorization": f"Bearer {tok}"}
    assert (await client.get("/api/v1/users/me", headers=h)).json()["role"] == "user"
    r = await client.patch("/api/v1/users/me", json={"role": "admin"}, headers=h)
    assert r.status_code == 422
    r = await client.post("/api/v1/agents/demo/seed", headers=h)
    assert r.status_code == 403


async def test_update_me(client: AsyncClient, alice: TestUser):
    wallet = "0x" + "ab" * 20
    r = await client.patch("/api/v1/users/me", json={"full_name": "Alice", "wallet_address": wallet},
                           headers=alice.headers)
    assert r.status_code == 200
    assert r.json()["full_name"] == "Alice" and r.json()["wallet_address"].lower() == wallet
    for bad in ({"wallet_address": "0x123"}, {"wallet_address": "0x" + "0" * 40}, {"avatar_url": "http://x.com/a.png"},
                {"id": str(uuid.uuid4())}, {"email": "evil@x.com"}):
        assert (await client.patch("/api/v1/users/me", json=bad, headers=alice.headers)).status_code == 422


async def test_users_are_isolated(client: AsyncClient, alice: TestUser, bob: TestUser):
    await client.patch("/api/v1/users/me", json={"full_name": "Alice"}, headers=alice.headers)
    r = await client.get("/api/v1/users/me", headers=bob.headers)
    assert r.json()["full_name"] is None and r.json()["id"] == str(bob.id)


# ---------------------------------------------------------------------------------- rate limiting
async def test_rate_limit_returns_429(monkeypatch):
    monkeypatch.setenv("RATE_LIMIT_PER_MINUTE", "3")
    get_settings.cache_clear()
    try:
        application = create_app()
        async with AsyncClient(transport=ASGITransport(app=application), base_url="http://test") as c:
            codes = [(await c.get("/api/v1/openapi-probe")).status_code for _ in range(5)]
            assert codes[:3] == [404, 404, 404] and codes[3] == 429
            r = await c.get("/api/v1/openapi-probe")
            assert r.json()["error"]["code"] == "rate_limited" and "retry-after" in r.headers
            assert (await c.get("/health")).status_code == 200  # health is never limited
    finally:
        monkeypatch.undo()
        get_settings.cache_clear()


async def test_secrets_are_redacted_in_logs():
    from app.core.logging import redact

    assert "sk-ant-abcdefSECRET" not in redact("key sk-ant-abcdefSECRETSECRET")
    assert "hunter2" not in redact("password=hunter2")
    assert "s3cr3t" not in redact("postgresql://user:s3cr3t@host/db")
