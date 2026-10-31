"""Backend polling of the HSP gateway (complements webhooks, which can be missed or delayed).

* Only payments that can still change are polled: intents in AWAITING_SIGNATURE..PENDING that have a registered
  HSP order, plus recently closed intents (late-payment grace) whose gateway status is not terminal.
* Terminal payments (SETTLED, or closed with a terminal gateway status) are never polled again.
* Per-payment floor between queries (HSP_POLL_MIN_INTERVAL_SECONDS), bounded batch size, one session per payment.

Run in-process with HSP_BACKGROUND_POLL=true on a SINGLE instance, or call `poll_once` from any scheduler.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import timedelta

from sqlalchemy import or_, select

from app.core.config import Settings
from app.database.session import get_sessionmaker
from app.integrations.blockchain.client import ChainClient
from app.integrations.hsp.client import get_hsp_client
from app.integrations.hsp.schemas import TERMINAL_STATUSES
from app.models import HspPaymentFlow, PaymentIntent
from app.models.enums import PaymentStatus as S
from app.payments.hsp_service import LATE_PAYMENT_GRACE, HSPPaymentService
from app.payments.service import PaymentService
from app.utils.common import utcnow

log = logging.getLogger("paymesh.hsp.monitor")
BATCH = 50
_LIVE = [s.value for s in (S.AWAITING_SIGNATURE, S.SIGNED, S.SUBMITTED, S.PENDING)]
_CLOSED = [s.value for s in (S.EXPIRED, S.CANCELLED, S.FAILED)]


async def poll_once(settings: Settings) -> int:
    sm = get_sessionmaker()
    now = utcnow()
    due = now - timedelta(seconds=settings.HSP_POLL_MIN_INTERVAL_SECONDS)
    async with sm() as db:
        rows = (await db.execute(
            select(PaymentIntent.id).join(HspPaymentFlow, HspPaymentFlow.payment_intent_id == PaymentIntent.id)
            .where(
                HspPaymentFlow.order_state == "created",
                or_(HspPaymentFlow.last_polled_at.is_(None), HspPaymentFlow.last_polled_at <= due),
                or_(
                    PaymentIntent.status.in_(_LIVE),
                    (PaymentIntent.status.in_(_CLOSED))
                    & (HspPaymentFlow.cart_expiry >= now - LATE_PAYMENT_GRACE)
                    & (HspPaymentFlow.gateway_status.is_(None) | HspPaymentFlow.gateway_status.notin_(list(TERMINAL_STATUSES))),
                ),
            ).order_by(HspPaymentFlow.last_polled_at.asc().nulls_first()).limit(BATCH)
        )).scalars().all()
    n = 0
    for intent_id in rows:
        async with sm() as db:
            try:
                svc = HSPPaymentService(db, settings, get_hsp_client(), ChainClient(settings), PaymentService(db, settings))
                intent = await svc.get_intent_system(intent_id)
                await svc.sync(intent, force=True)
                await db.commit()
                n += 1
            except Exception as exc:  # noqa: BLE001 - one bad payment must not stop the loop
                await db.rollback()
                log.warning("poll failed for %s: %s", intent_id, type(exc).__name__)
    return n


async def run_poller(settings: Settings, stop: asyncio.Event) -> None:
    log.info("HSP poller started (interval=%ss)", settings.HSP_POLL_INTERVAL_SECONDS)
    while not stop.is_set():
        try:
            await poll_once(settings)
        except Exception:  # noqa: BLE001
            log.exception("poll cycle failed")
        try:
            await asyncio.wait_for(stop.wait(), timeout=settings.HSP_POLL_INTERVAL_SECONDS)
        except TimeoutError:
            pass
    log.info("HSP poller stopped")
