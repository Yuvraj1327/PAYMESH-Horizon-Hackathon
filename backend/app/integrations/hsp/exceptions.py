"""Centralized HSP error types. Messages are safe to return to API clients (no secrets, no raw gateway bodies)."""

from __future__ import annotations

from typing import Any

from app.core.errors import AppError


class HSPError(AppError):
    status_code = 502
    code = "hsp_error"


class HSPNotConfiguredError(HSPError):
    status_code = 503
    code = "hsp_not_configured"


class HSPAuthError(HSPError):
    """The gateway rejected OUR credentials/signature (config problem, not the user's)."""

    code = "hsp_auth_failed"


class HSPApiError(HSPError):
    code = "hsp_api_error"

    def __init__(self, message: str, *, hsp_code: int | None = None, http_status: int | None = None, details: Any = None):
        super().__init__(message, details=details)
        self.hsp_code = hsp_code
        self.http_status = http_status


class HSPNotFoundError(HSPApiError):
    code = "hsp_not_found"


class HSPRateLimitedError(HSPApiError):
    status_code = 503
    code = "hsp_rate_limited"


class HSPUnavailableError(HSPError):
    status_code = 504
    code = "hsp_unavailable"


class HSPAmbiguousOutcomeError(HSPUnavailableError):
    """A non-idempotent call (order creation) failed after the request may have been processed."""

    code = "hsp_outcome_unknown"


class HSPProtocolError(HSPError):
    """The gateway answered with something that does not match the documented contract."""

    code = "hsp_protocol_error"


class HSPWebhookError(HSPError):
    status_code = 401
    code = "hsp_webhook_invalid"
