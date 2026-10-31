"""Test harness: in-memory SQLite (fast), signed Supabase-style JWTs, scripted fake Claude."""

from __future__ import annotations

import os
import uuid
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

# --- environment must be set BEFORE the app is imported -----------------------------------------------
TEST_JWT_SECRET = "test-secret-test-secret-test-secret-0123456789"
os.environ.update(
    {
        "APP_ENV": "test",
        "DATABASE_URL": os.environ.get("TEST_DATABASE_URL", "sqlite+aiosqlite:///:memory:"),
        "SUPABASE_URL": "https://testproject.supabase.co",
        "SUPABASE_JWT_SECRET": TEST_JWT_SECRET,
        "ANTHROPIC_API_KEY": "",
        "RATE_LIMIT_PER_MINUTE": "0",
        "RATE_LIMIT_SENSITIVE_PER_MINUTE": "0",
        "HSK_CHAIN_ID": "133",
        "SUPPORTED_ASSETS": "USDT",
        "AGENT_REGISTRY_ADDRESS": "0x" + "ab" * 20,
        "DEMO_CRYPTO_RESEARCH_WALLET": "0x" + "11" * 20,
        "DEMO_MARKET_DATA_WALLET": "0x" + "22" * 20,
        "DEMO_AI_ANALYTICS_WALLET": "0x" + "33" * 20,
    }
)

from cryptography.hazmat.primitives import serialization  # noqa: E402
from cryptography.hazmat.primitives.asymmetric import ec  # noqa: E402

# Throw-away HSP merchant key (secp256k1) + credentials for the spec-checking FakeHSP. Never real.
MERCHANT_KEY = ec.generate_private_key(ec.SECP256K1())
os.environ.update(
    {
        "HSP_APP_KEY": "ak_test_0001",
        "HSP_APP_SECRET": "as_test_secret_0001",
        "HSP_MERCHANT_PRIVATE_KEY_PEM": MERCHANT_KEY.private_bytes(
            serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
        ).decode(),
        "HSP_POLL_MIN_INTERVAL_SECONDS": "0",
        "HSP_BASE_URL": "https://hsp-fake.test",
    }
)

import jwt  # noqa: E402
import pytest  # noqa: E402
import pytest_asyncio  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402

from app.core.config import get_settings  # noqa: E402
from app.database.base import Base  # noqa: E402
from app.database.session import dispose_engine, get_engine, get_sessionmaker  # noqa: E402
from app.integrations.anthropic.client import ClaudeClient, get_claude_client  # noqa: E402
from app.integrations.blockchain.client import get_chain_client  # noqa: E402
from app.integrations.hsp.client import get_hsp_client  # noqa: E402
from app.integrations.hsp.gateway import HSPGateway  # noqa: E402
from tests.hsp_fakes import FakeChain, FakeHSP  # noqa: E402
from app.main import create_app  # noqa: E402
from app.models import Profile  # noqa: E402
from app.models.enums import UserRole  # noqa: E402
from app.services.demo_agents import seed_demo_agents  # noqa: E402

settings = get_settings()


def make_token(user_id: uuid.UUID, email: str = "u@example.com", *, secret: str = TEST_JWT_SECRET,
               alg: str = "HS256", exp_delta: int = 3600, aud: str = "authenticated", iss: str | None = None,
               extra: dict | None = None) -> str:
    now = datetime.now(UTC)
    payload = {
        "sub": str(user_id), "email": email, "aud": aud,
        "iss": iss or settings.supabase_issuer,
        "iat": now, "exp": now + timedelta(seconds=exp_delta),
        **(extra or {}),
    }
    return jwt.encode(payload, secret, algorithm=alg)


class TestUser:
    __test__ = False

    def __init__(self, name: str):
        self.id = uuid.uuid4()
        self.email = f"{name}@example.com"

    @property
    def headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {make_token(self.id, self.email)}"}


# ------------------------------------------------------------------ scripted Claude
def tool_use(name: str, payload: dict, tid: str = "tu_1") -> SimpleNamespace:
    return SimpleNamespace(type="tool_use", name=name, input=payload, id=tid)


def sdk_response(*blocks, tokens: tuple[int, int] = (10, 5)) -> SimpleNamespace:
    return SimpleNamespace(content=list(blocks), usage=SimpleNamespace(input_tokens=tokens[0], output_tokens=tokens[1]))


class FakeMessages:
    def __init__(self) -> None:
        self.script: list = []
        self.calls: list[dict] = []

    async def create(self, **kwargs):  # noqa: ANN003, ANN201
        self.calls.append(kwargs)
        if not self.script:
            raise AssertionError("FakeMessages: no scripted response left")
        item = self.script.pop(0)
        if isinstance(item, BaseException):
            raise item
        return item


class FakeSDK:
    def __init__(self) -> None:
        self.messages = FakeMessages()


@pytest.fixture
def fake_sdk() -> FakeSDK:
    return FakeSDK()


@pytest.fixture
def claude(fake_sdk: FakeSDK) -> ClaudeClient:
    """A configured ClaudeClient backed by the scripted fake SDK (no network)."""
    return ClaudeClient(settings, sdk_client=fake_sdk)


# ------------------------------------------------------------------ app / db
@pytest_asyncio.fixture
async def app():  # noqa: ANN201
    engine = get_engine()
    async with engine.begin() as conn:
        if not settings.is_sqlite:  # running the suite against real PostgreSQL: start every test clean
            await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    application = create_app()
    # Default: Claude NOT configured -> exercises deterministic fallbacks.
    application.dependency_overrides[get_claude_client] = lambda: ClaudeClient(settings)
    # No test may reach a real HSP gateway or RPC: both are replaced by in-process fakes.
    import httpx

    fake_hsp = FakeHSP(settings.HSP_APP_KEY, settings.HSP_APP_SECRET, MERCHANT_KEY.public_key())
    gateway = HSPGateway(settings, transport=httpx.MockTransport(fake_hsp.handler))
    fake_chain = FakeChain()
    application.dependency_overrides[get_hsp_client] = lambda: gateway
    application.dependency_overrides[get_chain_client] = lambda: fake_chain
    application.state.fake_hsp, application.state.fake_chain, application.state.gateway = fake_hsp, fake_chain, gateway
    yield application
    await gateway.aclose()
    await dispose_engine()


@pytest.fixture
def hsp(app) -> FakeHSP:  # noqa: ANN001
    return app.state.fake_hsp


@pytest.fixture
def chain_fake(app) -> FakeChain:  # noqa: ANN001
    return app.state.fake_chain


@pytest_asyncio.fixture
async def client(app):  # noqa: ANN001, ANN201
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest.fixture
def use_claude(app):  # noqa: ANN001, ANN201
    def _use(c: ClaudeClient) -> None:
        app.dependency_overrides[get_claude_client] = lambda: c

    return _use


@pytest_asyncio.fixture
async def db(app):  # noqa: ANN001, ANN201
    async with get_sessionmaker()() as session:
        yield session


@pytest.fixture
def alice() -> TestUser:
    return TestUser("alice")


@pytest.fixture
def bob() -> TestUser:
    return TestUser("bob")


@pytest_asyncio.fixture
async def admin(client: AsyncClient, db) -> TestUser:  # noqa: ANN001
    u = TestUser("admin")
    r = await client.get("/api/v1/users/me", headers=u.headers)  # creates the profile via JWT
    assert r.status_code == 200
    prof = await db.get(Profile, u.id)
    prof.role = UserRole.ADMIN.value  # promoted directly in the DB, never via API
    await db.commit()
    return u


@pytest_asyncio.fixture
async def demo_agents(db) -> dict:  # noqa: ANN001
    res = await seed_demo_agents(db, settings)
    await db.commit()
    return res


# ------------------------------------------------------------------ flow helpers
async def set_policy(client: AsyncClient, user: TestUser, **over) -> dict:  # noqa: ANN003
    body = {
        "max_transaction_amount": "1.0", "daily_spending_limit": "2.0", "allow_all_agents": True,
        "allowed_assets": ["USDT"], "allowed_chain_ids": [133], "enabled": True,
    }
    body.update(over)
    r = await client.put("/api/v1/policies/me", json=body, headers=user.headers)
    assert r.status_code == 200, r.text
    return r.json()


async def create_request(client: AsyncClient, user: TestUser, budget: str = "1", **over) -> dict:  # noqa: ANN003
    body = {"description": "Find an AI agent for cryptocurrency market research.", "max_budget": budget,
            "category": "crypto_research", "use_ai": False}
    body.update(over)
    r = await client.post("/api/v1/procurement/requests", json=body, headers=user.headers)
    assert r.status_code == 201, r.text
    return r.json()


async def quote_and_select(client: AsyncClient, user: TestUser, request_id: str, pick: int = 0) -> dict:
    r = await client.post(f"/api/v1/procurement/requests/{request_id}/quotations", headers=user.headers)
    assert r.status_code == 200, r.text
    quotes = (await client.get(f"/api/v1/procurement/requests/{request_id}/quotations", headers=user.headers)).json()
    assert quotes, "expected quotations"
    chosen = quotes[pick]
    r = await client.post(f"/api/v1/procurement/requests/{request_id}/select",
                          json={"quotation_id": chosen["id"]}, headers=user.headers)
    assert r.status_code == 200, r.text
    return chosen
