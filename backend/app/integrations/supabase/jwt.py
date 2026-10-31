"""Supabase JWT verification.

Supports both Supabase signing modes:
  * legacy shared secret (HS256)  -> SUPABASE_JWT_SECRET
  * asymmetric signing keys (ES256/RS256/EdDSA) -> JWKS at <SUPABASE_URL>/auth/v1/.well-known/jwks.json

The algorithm family is chosen from the *allow-list*, never trusted blindly from the token:
an HS256 token can only be verified with the shared secret, an asymmetric token only with
JWKS keys, and `alg: none` is always rejected (algorithm-confusion protection).
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from dataclasses import dataclass
from typing import Any

import jwt
from jwt import PyJWKClient

from app.core.config import Settings
from app.core.errors import ServiceUnavailableError, UnauthorizedError

log = logging.getLogger(__name__)

SYMMETRIC_ALGS = {"HS256"}
ASYMMETRIC_ALGS = {"ES256", "RS256", "EdDSA"}


@dataclass(frozen=True)
class AuthenticatedUser:
    id: uuid.UUID
    email: str | None
    claims: dict[str, Any]


_jwks_clients: dict[str, PyJWKClient] = {}


def _jwks_client(url: str) -> PyJWKClient:
    if url not in _jwks_clients:
        _jwks_clients[url] = PyJWKClient(url, cache_keys=True, lifespan=3600, timeout=5)
    return _jwks_clients[url]


async def verify_supabase_jwt(token: str, settings: Settings) -> AuthenticatedUser:
    try:
        header = jwt.get_unverified_header(token)
    except jwt.PyJWTError as exc:
        raise UnauthorizedError("Invalid authentication token") from exc

    alg = header.get("alg", "")
    options = {"require": ["exp", "sub"], "verify_aud": True, "verify_iss": bool(settings.supabase_issuer)}
    kwargs: dict[str, Any] = {"audience": settings.SUPABASE_JWT_AUDIENCE, "options": options}
    if settings.supabase_issuer:
        kwargs["issuer"] = settings.supabase_issuer

    if alg in SYMMETRIC_ALGS:
        if not settings.SUPABASE_JWT_SECRET:
            raise UnauthorizedError("Invalid authentication token")
        key: Any = settings.SUPABASE_JWT_SECRET
    elif alg in ASYMMETRIC_ALGS:
        if not settings.supabase_jwks_url:
            raise ServiceUnavailableError("Authentication is not configured", code="auth_not_configured")
        try:
            signing_key = await asyncio.to_thread(_jwks_client(settings.supabase_jwks_url).get_signing_key_from_jwt, token)
        except jwt.PyJWTError as exc:
            raise UnauthorizedError("Invalid authentication token") from exc
        except Exception as exc:  # network failure fetching JWKS
            log.warning("JWKS fetch failed: %s", type(exc).__name__)
            raise ServiceUnavailableError("Authentication provider unreachable", code="auth_unavailable") from exc
        key = signing_key.key
    else:
        raise UnauthorizedError("Invalid authentication token")  # includes alg=none

    try:
        claims = jwt.decode(token, key=key, algorithms=[alg], **kwargs)
    except jwt.ExpiredSignatureError as exc:
        raise UnauthorizedError("Token expired") from exc
    except jwt.PyJWTError as exc:
        raise UnauthorizedError("Invalid authentication token") from exc

    try:
        user_id = uuid.UUID(str(claims["sub"]))
    except ValueError as exc:
        raise UnauthorizedError("Invalid authentication token") from exc

    return AuthenticatedUser(id=user_id, email=claims.get("email"), claims=claims)
