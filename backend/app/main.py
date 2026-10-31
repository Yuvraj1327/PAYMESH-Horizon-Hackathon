from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1 import health
from app.api.v1.router import api_router
from app.core.config import get_settings
from app.core.errors import register_exception_handlers
from app.core.logging import configure_logging
from app.database.session import dispose_engine
from app.middleware.http import RateLimitMiddleware, RequestContextMiddleware

log = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):  # noqa: ANN201
    s = get_settings()
    configure_logging(s.LOG_LEVEL, s.LOG_JSON)
    log.info("Starting %s env=%s chain=%s", s.APP_NAME, s.APP_ENV, s.HSK_CHAIN_ID)
    env_err = s.hsp_environment_error() if s.hsp_configured else None
    if env_err:
        if s.is_production:
            raise RuntimeError(f"Refusing to start: {env_err}")
        log.error("HSP environment mismatch: %s", env_err)
    if s.is_production and s.HSK_CHAIN_ID != 177:
        log.warning("APP_ENV=production but HSK_CHAIN_ID=%s (mainnet is 177)", s.HSK_CHAIN_ID)
    stop = asyncio.Event()
    poller = None
    if s.HSP_BACKGROUND_POLL and s.hsp_configured:
        from app.payments.monitor import run_poller

        poller = asyncio.create_task(run_poller(s, stop))
    elif s.HSP_BACKGROUND_POLL:
        log.warning("HSP_BACKGROUND_POLL is on but HSP credentials are missing; poller not started")
    yield
    stop.set()
    if poller:
        await poller
    from app.integrations.hsp.client import aclose_hsp_client

    await aclose_hsp_client()
    await dispose_engine()


def create_app() -> FastAPI:
    s = get_settings()
    app = FastAPI(
        title=s.APP_NAME,
        version="0.1.0",
        description="PayMesh: AI agent-to-agent procurement and payments on HashKey Chain (Step 1: core backend).",
        lifespan=lifespan,
        docs_url=None if s.is_production else "/docs",
        redoc_url=None if s.is_production else "/redoc",
        openapi_url=None if s.is_production else "/openapi.json",
    )
    # Middleware order: last added = outermost.
    app.add_middleware(RateLimitMiddleware, default_limit=s.RATE_LIMIT_PER_MINUTE,
                       sensitive_limit=s.RATE_LIMIT_SENSITIVE_PER_MINUTE)
    app.add_middleware(
        CORSMiddleware, allow_origins=s.CORS_ORIGINS, allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "Idempotency-Key", "X-Request-ID"],
    )
    app.add_middleware(RequestContextMiddleware)
    register_exception_handlers(app)
    app.include_router(api_router, prefix="/api/v1")
    app.include_router(health.router)  # also at /health for platform health checks
    return app


app = create_app()
