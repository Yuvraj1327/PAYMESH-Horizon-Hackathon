"""Async engine / session management."""

from __future__ import annotations

from collections.abc import AsyncIterator

from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.core.config import get_settings

_engine: AsyncEngine | None = None
_sessionmaker: async_sessionmaker[AsyncSession] | None = None


def build_engine(url: str | None = None) -> AsyncEngine:
    s = get_settings()
    url = url or s.DATABASE_URL
    kwargs: dict = {"echo": s.DB_ECHO, "pool_pre_ping": True}
    if url.startswith("sqlite"):
        if ":memory:" in url or url.endswith("///"):
            kwargs.update(poolclass=StaticPool, connect_args={"check_same_thread": False})
    else:
        kwargs.update(pool_size=s.DB_POOL_SIZE, max_overflow=s.DB_MAX_OVERFLOW)
        # Supabase transaction pooler (pgbouncer) does not support prepared statements.
        if "pooler.supabase.com" in url or ":6543" in url:
            kwargs["connect_args"] = {"statement_cache_size": 0, "prepared_statement_cache_size": 0}
    engine = create_async_engine(url, **kwargs)
    if url.startswith("sqlite"):
        _configure_sqlite(engine)
    return engine


def _configure_sqlite(engine: AsyncEngine) -> None:
    """SQLite is for unit tests only: make SAVEPOINTs work and enforce foreign keys like Postgres."""

    @event.listens_for(engine.sync_engine, "connect")
    def _on_connect(dbapi_conn, _):  # noqa: ANN001
        dbapi_conn.isolation_level = None
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA foreign_keys=ON")
        cur.close()

    @event.listens_for(engine.sync_engine, "begin")
    def _on_begin(conn):  # noqa: ANN001
        conn.exec_driver_sql("BEGIN")


def get_engine() -> AsyncEngine:
    global _engine, _sessionmaker
    if _engine is None:
        _engine = build_engine()
        _sessionmaker = async_sessionmaker(_engine, expire_on_commit=False, class_=AsyncSession)
    return _engine


def get_sessionmaker() -> async_sessionmaker[AsyncSession]:
    get_engine()
    assert _sessionmaker is not None
    return _sessionmaker


async def get_db() -> AsyncIterator[AsyncSession]:
    """Request-scoped session: commit on success, roll back on any exception."""
    async with get_sessionmaker()() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


async def dispose_engine() -> None:
    global _engine, _sessionmaker
    if _engine is not None:
        await _engine.dispose()
    _engine = None
    _sessionmaker = None
