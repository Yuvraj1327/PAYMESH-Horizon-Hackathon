import uuid
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Query, Response

from app.api.deps import PagerDep, SettingsDep
from app.core.security import CurrentUser, DbSession
from app.models.enums import ServiceCategory
from app.schemas.common import Page
from app.schemas.marketplace import ServiceCreate, ServiceOut, ServiceUpdate
from app.services import marketplace as svc

router = APIRouter(prefix="/services", tags=["services"])


@router.post("", response_model=ServiceOut, status_code=201)
async def create_service(body: ServiceCreate, user: CurrentUser, db: DbSession, settings: SettingsDep) -> ServiceOut:
    return ServiceOut.model_validate(await svc.create_service(db, user, body, settings))


@router.get("", response_model=Page[ServiceOut])
async def list_services(
    user: CurrentUser,
    db: DbSession,
    pager: PagerDep,
    agent_id: uuid.UUID | None = None,
    category: ServiceCategory | None = None,
    asset: Annotated[str | None, Query(max_length=16)] = None,
    max_price: Annotated[Decimal | None, Query(gt=0)] = None,
    available_only: bool = True,
) -> Page[ServiceOut]:
    rows, total = await svc.list_services(
        db, agent_id=agent_id, category=category.value if category else None, asset=asset,
        max_price=max_price, available_only=available_only, limit=pager.limit, offset=pager.offset,
    )
    return Page(items=[ServiceOut.model_validate(r) for r in rows], total=total, limit=pager.limit, offset=pager.offset)


@router.get("/{service_id}", response_model=ServiceOut)
async def get_service(service_id: uuid.UUID, user: CurrentUser, db: DbSession) -> ServiceOut:
    return ServiceOut.model_validate(await svc.get_service(db, service_id))


@router.patch("/{service_id}", response_model=ServiceOut)
async def update_service(
    service_id: uuid.UUID, body: ServiceUpdate, user: CurrentUser, db: DbSession, settings: SettingsDep
) -> ServiceOut:
    return ServiceOut.model_validate(await svc.update_service(db, user, service_id, body, settings))


@router.delete("/{service_id}", status_code=204)
async def delete_service(service_id: uuid.UUID, user: CurrentUser, db: DbSession) -> Response:
    await svc.delete_service(db, user, service_id)
    return Response(status_code=204)
