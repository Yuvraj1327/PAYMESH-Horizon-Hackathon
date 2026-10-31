from __future__ import annotations

from typing import Annotated

from fastapi import Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.security import CurrentUser, DbSession
from app.integrations.anthropic.client import ClaudeClient, get_claude_client
from app.integrations.blockchain.client import ChainClient, get_chain_client
from app.integrations.hsp.client import HSPClient, get_hsp_client
from app.payments.hsp_service import HSPPaymentService
from app.payments.service import PaymentService
from app.services.procurement import ProcurementService

SettingsDep = Annotated[Settings, Depends(get_settings)]
ClaudeDep = Annotated[ClaudeClient, Depends(get_claude_client)]
ChainDep = Annotated[ChainClient, Depends(get_chain_client)]


class Pager:
    def __init__(
        self,
        limit: Annotated[int, Query(ge=1, le=100)] = 20,
        offset: Annotated[int, Query(ge=0)] = 0,
    ):
        self.limit = limit
        self.offset = offset


PagerDep = Annotated[Pager, Depends()]


def get_payment_service(db: DbSession, settings: SettingsDep) -> PaymentService:
    return PaymentService(db, settings)


def get_procurement_service(db: DbSession, settings: SettingsDep, claude: ClaudeDep) -> ProcurementService:
    return ProcurementService(db, settings, claude)


def get_hsp_service(
    db: DbSession, settings: SettingsDep, payments: PaymentService = Depends(get_payment_service),
    hsp: HSPClient = Depends(get_hsp_client), chain: ChainClient = Depends(get_chain_client),
) -> HSPPaymentService:
    return HSPPaymentService(db, settings, hsp, chain, payments)


HspSvc = Annotated[HSPPaymentService, Depends(get_hsp_service)]
PaymentSvc = Annotated[PaymentService, Depends(get_payment_service)]
ProcurementSvc = Annotated[ProcurementService, Depends(get_procurement_service)]

_ = (AsyncSession, CurrentUser)
