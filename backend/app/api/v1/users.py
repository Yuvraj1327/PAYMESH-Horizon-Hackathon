from fastapi import APIRouter

from app.core.security import CurrentUser, DbSession
from app.payments.service import log_event
from app.schemas.marketplace import UserOut, UserUpdate

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/me", response_model=UserOut)
async def get_me(user: CurrentUser) -> UserOut:
    return UserOut.model_validate(user)


@router.patch("/me", response_model=UserOut)
async def update_me(body: UserUpdate, user: CurrentUser, db: DbSession) -> UserOut:
    """Only profile fields are writable. `role`, `id`, `email` are rejected by the schema (extra=forbid)."""
    changes = body.model_dump(exclude_unset=True)
    if "wallet_address" in changes and changes["wallet_address"] != user.wallet_address:
        await log_event(db, "profile_wallet_changed", actor_id=user.id,
                        data={"old": user.wallet_address, "new": changes["wallet_address"]})
    for k, v in changes.items():
        setattr(user, k, v)
    await db.flush()
    return UserOut.model_validate(user)
