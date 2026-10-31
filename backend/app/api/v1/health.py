from fastapi import APIRouter
from sqlalchemy import text

from app.api.deps import ClaudeDep, SettingsDep
from app.core.errors import ServiceUnavailableError
from app.core.security import DbSession

router = APIRouter(tags=["health"])


@router.get("/health")
async def liveness() -> dict:
    return {"status": "ok"}


@router.get("/health/ready")
async def readiness(db: DbSession, settings: SettingsDep, claude: ClaudeDep) -> dict:
    try:
        await db.execute(text("SELECT 1"))
    except Exception as exc:
        raise ServiceUnavailableError("Database unavailable", code="db_unavailable") from exc
    return {
        "status": "ready",
        "env": settings.APP_ENV,
        "database": "ok",
        "supabase_auth_configured": bool(settings.SUPABASE_URL),
        "anthropic_configured": claude.configured,
        "hsp_configured": settings.hsp_configured,
        "hsp_environment": settings.HSP_BASE_URL,
    }
