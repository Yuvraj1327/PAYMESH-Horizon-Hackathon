"""Application configuration, loaded from environment variables / .env.

Secrets live here (server-side only) and are never returned by any API.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Annotated, Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


def _split_csv(v: object) -> object:
    if isinstance(v, str):
        v = v.strip()
        if v.startswith("["):
            return v  # let pydantic parse JSON
        return [p.strip() for p in v.split(",") if p.strip()]
    return v


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore", case_sensitive=True
    )

    # --- App ---
    APP_ENV: Literal["development", "test", "staging", "production"] = "development"
    APP_NAME: str = "PayMesh API"
    LOG_LEVEL: str = "INFO"
    LOG_JSON: bool = False
    CORS_ORIGINS: Annotated[list[str], NoDecode] = ["http://localhost:3000"]
    RATE_LIMIT_PER_MINUTE: int = 120
    RATE_LIMIT_SENSITIVE_PER_MINUTE: int = 20  # /ai and /payments

    # --- Database ---
    DATABASE_URL: str
    DB_POOL_SIZE: int = 5
    DB_MAX_OVERFLOW: int = 5
    DB_ECHO: bool = False

    # --- Supabase ---
    SUPABASE_URL: str = ""
    SUPABASE_ANON_KEY: str = ""
    SUPABASE_SERVICE_ROLE_KEY: str = ""
    # HS256 secret for projects still on legacy JWT secrets. Projects on asymmetric
    # signing keys are verified through the JWKS endpoint instead.
    SUPABASE_JWT_SECRET: str = ""
    SUPABASE_JWT_AUDIENCE: str = "authenticated"

    # --- Anthropic ---
    ANTHROPIC_API_KEY: str = ""
    ANTHROPIC_MODEL: str = "claude-sonnet-5-5"
    ANTHROPIC_TIMEOUT_SECONDS: float = 30.0
    ANTHROPIC_MAX_RETRIES: int = 2
    ANTHROPIC_MAX_TOKENS: int = 1500
    AI_MAX_TOOL_TURNS: int = 4
    AI_MAX_CALLS_PER_USER_PER_DAY: int = 200
    AI_MAX_TOKENS_PER_USER_PER_DAY: int = 400_000

    # --- HSP (HashKey Merchant) -- names follow the official docs: app_key / app_secret / merchant ES256K key ---
    # QA/testnet: https://merchant-qa.hashkeymerchant.com   Staging (mainnet tokens): https://merchant-stg.hashkeymerchant.com
    # Production (mainnet tokens): https://hsp.hashkey.com
    HSP_BASE_URL: str = "https://merchant-qa.hashkeymerchant.com"
    HSP_APP_KEY: str = ""
    HSP_APP_SECRET: str = ""
    HSP_MERCHANT_NAME: str = "PayMesh"
    HSP_MERCHANT_PRIVATE_KEY_PEM: str = ""        # secp256k1 PEM (PKCS8 or SEC1); \n escapes allowed
    HSP_MERCHANT_PRIVATE_KEY_FILE: str = ""       # alternative: path to the PEM file
    HSP_JWT_AUDIENCE: str = "HashkeyMerchant"     # official docs: aud must be "HashkeyMerchant"
    HSP_JWT_TTL_SECONDS: int = 3600
    HSP_REDIRECT_URL: str = ""                    # optional post-payment redirect
    HSP_HTTP_TIMEOUT_SECONDS: float = 15.0
    HSP_MAX_RETRIES: int = 2                      # idempotent GETs only; order creation is never auto-retried
    # Gateway status at which a payment may be considered settled (still independently verified on-chain).
    HSP_SETTLEMENT_MIN_STATUS: Literal["payment-safe", "payment-finalized"] = "payment-finalized"
    HSP_POLL_MIN_INTERVAL_SECONDS: int = 5        # per-payment floor between gateway queries
    HSP_BACKGROUND_POLL: bool = False             # run the in-process poller (use one instance only)
    HSP_POLL_INTERVAL_SECONDS: int = 15
    HSP_ONCHAIN_CHECK: Literal["strict", "tx_only", "off"] = "strict"
    HSP_MIN_CONFIRMATIONS: int = 12               # used when the RPC has no 'finalized' tag
    HSP_AMOUNT_SHORTFALL_BPS: int = 0             # tolerated on-chain shortfall vs order (basis points)
    HSP_CART_EXPIRY_MINUTES: int = 120

    # --- HashKey Chain ---
    HSK_RPC_URL: str = "https://testnet.hsk.xyz"
    HSK_CHAIN_ID: int = 133
    AGENT_REGISTRY_ADDRESS: str = ""
    BLOCKCHAIN_TIMEOUT_SECONDS: float = 10.0

    # --- Payment policy defaults / platform allow-lists ---
    # Asset *symbols* only. Token contract addresses are deliberately not configured
    # until they are verified against the official HSP guide (Step 2).
    SUPPORTED_ASSETS: Annotated[list[str], NoDecode] = ["USDT"]
    ALLOWED_CHAIN_IDS: Annotated[list[int], NoDecode] = [133, 177]
    PAYMENT_INTENT_TTL_MINUTES: int = 30
    QUOTATION_TTL_MINUTES: int = 60
    PROCUREMENT_TTL_HOURS: int = 24

    # --- Demo provider agents: payout wallets supplied via env, never hardcoded ---
    DEMO_CRYPTO_RESEARCH_WALLET: str = ""
    DEMO_MARKET_DATA_WALLET: str = ""
    DEMO_AI_ANALYTICS_WALLET: str = ""

    @field_validator("CORS_ORIGINS", "SUPPORTED_ASSETS", "ALLOWED_CHAIN_IDS", mode="before")
    @classmethod
    def _csv(cls, v: object) -> object:
        return _split_csv(v)

    @field_validator("SUPPORTED_ASSETS")
    @classmethod
    def _upper_assets(cls, v: list[str]) -> list[str]:
        return [a.upper() for a in v]

    @field_validator("DATABASE_URL")
    @classmethod
    def _normalize_db_url(cls, v: str) -> str:
        # Supabase hands out postgresql:// URLs; SQLAlchemy async needs the asyncpg driver.
        if v.startswith("postgres://"):
            v = "postgresql://" + v[len("postgres://") :]
        if v.startswith("postgresql://"):
            v = "postgresql+asyncpg://" + v[len("postgresql://") :]
        return v

    @property
    def is_production(self) -> bool:
        return self.APP_ENV == "production"

    @property
    def is_sqlite(self) -> bool:
        return self.DATABASE_URL.startswith("sqlite")

    @property
    def hsp_configured(self) -> bool:
        return bool(self.HSP_APP_KEY and self.HSP_APP_SECRET and self.merchant_private_key_pem())

    def hsp_environment_error(self) -> str | None:
        """Official docs: QA host = testnet tokens only; staging/production hosts = mainnet tokens only.
        Refuse to mix them (real-value payments must never go to QA, test chains never to production)."""
        from urllib.parse import urlparse

        host = (urlparse(self.HSP_BASE_URL).hostname or "").lower()
        if host == "merchant-qa.hashkeymerchant.com" and self.HSK_CHAIN_ID != 133:
            return f"HSP QA host is testnet-only but HSK_CHAIN_ID={self.HSK_CHAIN_ID} (expected 133)"
        if host in ("merchant-stg.hashkeymerchant.com", "hsp.hashkey.com") and self.HSK_CHAIN_ID != 177:
            return f"HSP staging/production hosts are mainnet-only but HSK_CHAIN_ID={self.HSK_CHAIN_ID} (expected 177)"
        return None

    def merchant_private_key_pem(self) -> str:
        if self.HSP_MERCHANT_PRIVATE_KEY_PEM:
            return self.HSP_MERCHANT_PRIVATE_KEY_PEM.replace("\\n", "\n")
        if self.HSP_MERCHANT_PRIVATE_KEY_FILE:
            try:
                with open(self.HSP_MERCHANT_PRIVATE_KEY_FILE, encoding="utf-8") as f:
                    return f.read()
            except OSError:
                return ""
        return ""

    @property
    def supabase_issuer(self) -> str:
        return f"{self.SUPABASE_URL.rstrip('/')}/auth/v1" if self.SUPABASE_URL else ""

    @property
    def supabase_jwks_url(self) -> str:
        return f"{self.supabase_issuer}/.well-known/jwks.json" if self.SUPABASE_URL else ""

    def sync_database_url(self) -> str:
        """Sync (psycopg) URL used by Alembic offline mode and tooling."""
        return self.DATABASE_URL.replace("+asyncpg", "+psycopg").replace("+aiosqlite", "")


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]


# Convenience for tests that mutate env and need a fresh object.
def reset_settings_cache() -> None:
    get_settings.cache_clear()


_ = Field  # keep import used for downstream extension
