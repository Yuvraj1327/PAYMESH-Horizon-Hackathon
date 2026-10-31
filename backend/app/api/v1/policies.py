from fastapi import APIRouter

from app.api.deps import SettingsDep
from app.core.security import CurrentUser, DbSession
from app.schemas.payments import PolicyOut, PolicyUpsert
from app.services import policies as svc

router = APIRouter(prefix="/policies", tags=["policies"])


@router.get("/me", response_model=PolicyOut)
async def get_my_policy(user: CurrentUser, db: DbSession) -> PolicyOut:
    return PolicyOut.model_validate(await svc.get_policy(db, user))


@router.put("/me", response_model=PolicyOut)
async def put_my_policy(body: PolicyUpsert, user: CurrentUser, db: DbSession, settings: SettingsDep) -> PolicyOut:
    """Create/replace the caller's spending policy. Enforced server-side before any payment intent."""
    return PolicyOut.model_validate(await svc.upsert_policy(db, user, body, settings))
