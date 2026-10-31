"""Async HTTPX client for the HashKey Merchant gateway (merchant APIs only -- see schemas.py for scope).

Documented endpoints used (docs/en/api-reference.md):
    POST /api/v1/merchant/orders      create one-time order (Cart Mandate)   -> never auto-retried
    GET  /api/v1/merchant/payments    query by cart_mandate_id | payment_request_id | flow_id   (retried safely)

Every attempt gets a fresh timestamp + nonce (the gateway rejects replayed nonces for 5 minutes).
Secrets are never logged and never included in raised errors.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any
from urllib.parse import urlencode, urlparse

import httpx
from pydantic import ValidationError

from app.core.config import Settings
from app.integrations.hsp.authentication import sign_request
from app.integrations.hsp.exceptions import (
    HSPAmbiguousOutcomeError,
    HSPApiError,
    HSPAuthError,
    HSPNotConfiguredError,
    HSPNotFoundError,
    HSPProtocolError,
    HSPRateLimitedError,
    HSPUnavailableError,
)
from app.integrations.hsp.schemas import HSPOrderResult, HSPPaymentRecord

log = logging.getLogger("paymesh.hsp")

ORDERS_PATH = "/api/v1/merchant/orders"
PAYMENTS_PATH = "/api/v1/merchant/payments"


class HSPGateway:
    def __init__(self, settings: Settings, transport: httpx.AsyncBaseTransport | None = None):
        if not settings.hsp_configured:
            raise HSPNotConfiguredError("HSP credentials are not configured")
        self.settings = settings
        self._http = httpx.AsyncClient(
            base_url=settings.HSP_BASE_URL.rstrip("/"),
            timeout=httpx.Timeout(settings.HSP_HTTP_TIMEOUT_SECONDS, connect=5.0),
            transport=transport,
            follow_redirects=False,
            headers={"Accept": "application/json", "User-Agent": "paymesh-backend/0.2"},
        )

    async def aclose(self) -> None:
        await self._http.aclose()

    # ------------------------------------------------------------------ core request
    async def _request(self, method: str, path: str, *, query: dict[str, str] | None = None,
                       body: dict[str, Any] | None = None, retryable: bool) -> Any:
        query_str = urlencode(query or {})
        attempts = (self.settings.HSP_MAX_RETRIES + 1) if retryable else 1
        last: Exception | None = None
        for attempt in range(attempts):
            signed = sign_request(
                app_key=self.settings.HSP_APP_KEY, app_secret=self.settings.HSP_APP_SECRET,
                method=method, path=path, query=query_str, body=body,
            )
            url = path + (f"?{query_str}" if query_str else "")
            try:
                resp = await self._http.request(method, url, headers=signed.headers, content=signed.body_bytes)
            except (httpx.TimeoutException, httpx.TransportError) as exc:
                last = exc
                log.warning("HSP %s %s transport error (%s) attempt=%d", method, path, type(exc).__name__, attempt + 1)
                if not retryable:
                    raise HSPAmbiguousOutcomeError(
                        "HSP request outcome unknown (network failure); do not assume it was or was not processed"
                    ) from exc
                await asyncio.sleep(min(2 ** attempt * 0.3, 3))
                continue

            retry_status = resp.status_code in (429, 500, 502, 503, 504)
            if retry_status and retryable and attempt < attempts - 1:
                log.warning("HSP %s %s -> HTTP %d, retrying", method, path, resp.status_code)
                await asyncio.sleep(min(2 ** attempt * 0.3, 3))
                continue
            return self._parse(method, path, resp)
        raise HSPUnavailableError("HSP gateway unreachable") from last

    def _parse(self, method: str, path: str, resp: httpx.Response) -> Any:
        try:
            payload = resp.json()
            code = int(payload["code"])
        except (ValueError, KeyError, TypeError, json.JSONDecodeError) as exc:
            log.error("HSP %s %s -> HTTP %d with non-conforming body", method, path, resp.status_code)
            if resp.status_code >= 500:
                raise HSPUnavailableError("HSP gateway error") from exc
            raise HSPProtocolError("HSP returned an unexpected response") from exc
        msg = str(payload.get("msg", ""))[:200]
        log.info("HSP %s %s -> http=%d code=%d", method, path, resp.status_code, code)
        if code == 0:
            return payload.get("data")
        if code == 10002 or resp.status_code == 401:
            raise HSPAuthError("HSP rejected the merchant credentials or signature", details={"hsp_code": code})
        if code == 10003 or resp.status_code == 404:
            raise HSPNotFoundError("HSP resource not found", hsp_code=code, http_status=resp.status_code)
        if code == 10007 or resp.status_code == 429:
            raise HSPRateLimitedError("HSP rate limit hit", hsp_code=code, http_status=resp.status_code)
        if resp.status_code >= 500:
            raise HSPUnavailableError("HSP gateway error")
        raise HSPApiError(f"HSP error {code}: {msg}", hsp_code=code, http_status=resp.status_code,
                          details={"hsp_code": code, "hsp_msg": msg})

    # ------------------------------------------------------------------ operations
    async def create_order(self, cart_mandate: dict[str, Any], redirect_url: str | None = None) -> HSPOrderResult:
        body: dict[str, Any] = {"cart_mandate": cart_mandate}
        if redirect_url:
            body["redirect_url"] = redirect_url
        data = await self._request("POST", ORDERS_PATH, body=body, retryable=False)
        try:
            result = HSPOrderResult.model_validate(data)
        except ValidationError as exc:
            raise HSPProtocolError("HSP order response is missing documented fields") from exc
        # payment_url is forwarded to browsers: never accept anything but https (no javascript:, data:, http:)
        if urlparse(result.payment_url).scheme != "https":
            raise HSPProtocolError("HSP returned a non-https payment_url")
        return result

    async def get_payment(self, *, payment_request_id: str | None = None, flow_id: str | None = None) -> HSPPaymentRecord | None:
        """Single-record query (exactly one filter, per docs). Returns None when HSP has no payment record yet."""
        if (payment_request_id is None) == (flow_id is None):
            raise ValueError("provide exactly one of payment_request_id / flow_id")
        q = {"payment_request_id": payment_request_id} if payment_request_id else {"flow_id": flow_id}  # type: ignore[dict-item]
        try:
            data = await self._request("GET", PAYMENTS_PATH, query=q, retryable=True)
        except HSPNotFoundError:
            return None
        if data is None:
            return None
        if isinstance(data, list):  # defensive: documented as a single object for these filters
            if len(data) != 1:
                raise HSPProtocolError("HSP returned an unexpected number of payment records")
            data = data[0]
        try:
            return HSPPaymentRecord.model_validate(data)
        except ValidationError as exc:
            raise HSPProtocolError("HSP payment record is malformed") from exc

    async def list_payments_by_cart(self, cart_mandate_id: str) -> list[HSPPaymentRecord]:
        data = await self._request("GET", PAYMENTS_PATH, query={"cart_mandate_id": cart_mandate_id}, retryable=True)
        rows = data if isinstance(data, list) else ([] if data is None else [data])
        try:
            return [HSPPaymentRecord.model_validate(r) for r in rows]
        except ValidationError as exc:
            raise HSPProtocolError("HSP payment record is malformed") from exc
