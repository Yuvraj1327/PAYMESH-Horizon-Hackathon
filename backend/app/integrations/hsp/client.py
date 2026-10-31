"""HSP client facade used by the payment services.

`get_hsp_client()` returns the real HTTPX gateway when credentials are configured; otherwise a client that
raises `HSPNotConfiguredError` (503) on every call -- it never fabricates results.
Tests inject a transport-backed `HSPGateway` through FastAPI's dependency overrides.
"""

from __future__ import annotations

from typing import Any, Protocol, runtime_checkable

from app.core.config import get_settings
from app.integrations.hsp.exceptions import HSPNotConfiguredError
from app.integrations.hsp.gateway import HSPGateway
from app.integrations.hsp.schemas import HSPOrderResult, HSPPaymentRecord


@runtime_checkable
class HSPClient(Protocol):
    async def create_order(self, cart_mandate: dict[str, Any], redirect_url: str | None = None) -> HSPOrderResult: ...

    async def get_payment(
        self, *, payment_request_id: str | None = None, flow_id: str | None = None
    ) -> HSPPaymentRecord | None: ...


class UnconfiguredHSPClient:
    async def create_order(self, cart_mandate: dict[str, Any], redirect_url: str | None = None) -> HSPOrderResult:
        raise HSPNotConfiguredError("HSP credentials are not configured (HSP_APP_KEY / HSP_APP_SECRET / merchant key)")

    async def get_payment(
        self, *, payment_request_id: str | None = None, flow_id: str | None = None
    ) -> HSPPaymentRecord | None:
        raise HSPNotConfiguredError("HSP credentials are not configured (HSP_APP_KEY / HSP_APP_SECRET / merchant key)")


_client: HSPClient | None = None


def get_hsp_client() -> HSPClient:
    global _client
    if _client is None:
        s = get_settings()
        _client = HSPGateway(s) if s.hsp_configured else UnconfiguredHSPClient()
    return _client


def reset_hsp_client() -> None:
    global _client
    _client = None


async def aclose_hsp_client() -> None:
    global _client
    if isinstance(_client, HSPGateway):
        await _client.aclose()
    _client = None
