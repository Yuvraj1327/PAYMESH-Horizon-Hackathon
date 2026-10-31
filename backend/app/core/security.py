"""FastAPI auth dependencies.

Identity comes ONLY from the verified Supabase JWT. The user's role is read from the
`profiles` table (server-controlled); nothing about role/ownership is accepted from the client.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.errors import ForbiddenError, UnauthorizedError
from app.database.session import get_db
from app.integrations.supabase.jwt import verify_supabase_jwt
from app.models import Profile
from app.models.enums import UserRole

bearer_scheme = HTTPBearer(auto_error=False)


async def get_current_user(
    request: Request,
    creds: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
    db: Annotated[AsyncSession, Depends(get_db)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> Profile:
    if creds is None or creds.scheme.lower() != "bearer":
        raise UnauthorizedError("Missing bearer token")
    auth_user = await verify_supabase_jwt(creds.credentials, settings)

    profile = await db.get(Profile, auth_user.id)
    if profile is None:
        # First request after sign-up: create the profile from *verified* token claims only.
        profile = Profile(id=auth_user.id, email=auth_user.email, role=UserRole.USER.value)
        try:
            async with db.begin_nested():
                db.add(profile)
        except IntegrityError:  # concurrent first requests
            profile = (await db.execute(select(Profile).where(Profile.id == auth_user.id))).scalar_one()
    request.state.user_id = str(profile.id)
    return profile


async def require_admin(user: Annotated[Profile, Depends(get_current_user)]) -> Profile:
    if user.role != UserRole.ADMIN.value:
        raise ForbiddenError("Administrator privileges required")
    return user


CurrentUser = Annotated[Profile, Depends(get_current_user)]
AdminUser = Annotated[Profile, Depends(require_admin)]
DbSession = Annotated[AsyncSession, Depends(get_db)]
