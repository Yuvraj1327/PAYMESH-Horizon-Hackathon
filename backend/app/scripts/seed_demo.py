"""CLI: seed the three platform-operated demo provider agents.

    python -m app.scripts.seed_demo

Requires DEMO_*_WALLET env vars (payout addresses you control). Idempotent.
"""

from __future__ import annotations

import asyncio

from app.core.config import get_settings
from app.core.logging import configure_logging
from app.database.session import dispose_engine, get_sessionmaker
from app.services.demo_agents import seed_demo_agents


async def main() -> None:
    s = get_settings()
    configure_logging(s.LOG_LEVEL, s.LOG_JSON)
    async with get_sessionmaker()() as db:
        result = await seed_demo_agents(db, s)
        await db.commit()
    print(result)
    await dispose_engine()


if __name__ == "__main__":
    asyncio.run(main())
