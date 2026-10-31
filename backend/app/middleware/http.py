"""Request-id, access logging, security headers and in-memory rate limiting."""

from __future__ import annotations

import logging
import time
import uuid
from collections import defaultdict, deque

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from app.core.logging import request_id_var

log = logging.getLogger("paymesh.access")


class RequestContextMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):  # noqa: ANN001
        rid = request.headers.get("x-request-id", "")[:64] or uuid.uuid4().hex
        token = request_id_var.set(rid)
        start = time.perf_counter()
        try:
            response: Response = await call_next(request)
        finally:
            elapsed = (time.perf_counter() - start) * 1000
            log.info("%s %s %.1fms", request.method, request.url.path, elapsed)
            request_id_var.reset(token)
        response.headers["X-Request-ID"] = rid
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Cache-Control"] = "no-store"
        return response


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Sliding-window limiter keyed by client IP. Process-local (use Redis when scaling out).

    Sensitive prefixes (/ai, /payments) get a stricter budget. Behind a proxy, configure
    uvicorn's --proxy-headers / --forwarded-allow-ips so request.client is the real client.
    """

    SENSITIVE_PREFIXES = ("/api/v1/ai", "/api/v1/payments")

    def __init__(self, app, default_limit: int, sensitive_limit: int, window_seconds: int = 60):  # noqa: ANN001
        super().__init__(app)
        self.default_limit = default_limit
        self.sensitive_limit = sensitive_limit
        self.window = window_seconds
        self.hits: dict[tuple[str, str], deque[float]] = defaultdict(deque)

    async def dispatch(self, request: Request, call_next):  # noqa: ANN001
        path = request.url.path
        if path.startswith("/health") or request.method == "OPTIONS":
            return await call_next(request)
        sensitive = path.startswith(self.SENSITIVE_PREFIXES)
        limit = self.sensitive_limit if sensitive else self.default_limit
        if limit <= 0:
            return await call_next(request)
        ip = request.client.host if request.client else "unknown"
        bucket = (ip, "s" if sensitive else "d")
        now = time.monotonic()
        q = self.hits[bucket]
        while q and now - q[0] > self.window:
            q.popleft()
        if len(q) >= limit:
            retry = max(1, int(self.window - (now - q[0])))
            return JSONResponse(
                {
                    "error": {
                        "code": "rate_limited",
                        "message": "Too many requests",
                        "details": None,
                        "request_id": request_id_var.get(),
                    }
                },
                status_code=429,
                headers={"Retry-After": str(retry)},
            )
        q.append(now)
        return await call_next(request)
