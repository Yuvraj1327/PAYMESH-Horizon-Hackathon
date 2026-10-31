"""Public webhook receiver. Authenticity = HMAC signature (X-Signature: t=..,v1=..); there is no JWT here."""

import logging

from fastapi import APIRouter, Request

from app.api.deps import HspSvc
from app.core.errors import AppError

router = APIRouter(prefix="/webhooks", tags=["webhooks"])
log = logging.getLogger("paymesh.hsp.webhook")


@router.post("/hsp")
async def hsp_webhook(request: Request, hsp: HspSvc) -> dict:
    """HSP payment notifications. Returns 2xx only once the event is handled (HSP retries non-2xx up to 6 times).

    The signature is verified over the RAW body; the body is then used only as a hint -- the gateway is re-queried
    and the chain is checked before any state change. Replays/duplicates are idempotent."""
    raw = await request.body()
    try:
        return await hsp.ingest_webhook(raw, request.headers.get("x-signature"))
    except AppError:
        raise
    except Exception:  # noqa: BLE001
        log.exception("webhook processing failed")
        raise AppError("Webhook processing failed", status_code=500, code="webhook_error") from None
