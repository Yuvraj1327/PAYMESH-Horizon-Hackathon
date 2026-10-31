"""Procurement lifecycle: request -> discovery -> quotations -> recommendation -> selection -> delivery."""

from __future__ import annotations

import logging
import uuid
from datetime import timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.buyer import BuyerAgent
from app.agents.provider import ProviderAgent
from app.agents.schemas import ExtractedRequirements
from app.core.config import Settings
from app.core.errors import ConflictError, ForbiddenError, NotFoundError, UnprocessableError, UpstreamError
from app.integrations.anthropic.client import ClaudeClient
from app.models import (
    Agent,
    AgentMessage,
    PaymentIntent,
    PaymentReceipt,
    ProcurementRequest,
    Profile,
    Quotation,
)
from app.models.enums import (
    ACTIVE_PAYMENT_STATES,
    AgentKind,
    AgentRole,
    AgentStatus,
    DeliveryStatus,
    MessageType,
    PaymentStatus,
    ProcurementStatus,
    QuotationStatus,
    ServiceCategory,
)
from app.payments.service import log_event
from app.schemas.procurement import ProcurementCreate, QuotationCreate
from app.services.discovery import Candidate, discover_candidates
from app.utils.common import as_utc, clean_text, to_jsonable, utcnow

log = logging.getLogger(__name__)

OPEN_FOR_QUOTES = (ProcurementStatus.CREATED.value, ProcurementStatus.QUOTING.value, ProcurementStatus.QUOTED.value)


async def add_message(
    db: AsyncSession, *, request_id: uuid.UUID | None, sender: AgentRole, receiver: AgentRole,
    mtype: MessageType, payload: dict[str, Any], sender_agent_id: uuid.UUID | None = None,
    receiver_agent_id: uuid.UUID | None = None,
) -> AgentMessage:
    msg = AgentMessage(
        request_id=request_id, sender_role=sender.value, receiver_role=receiver.value,
        sender_agent_id=sender_agent_id, receiver_agent_id=receiver_agent_id,
        message_type=mtype.value, payload=to_jsonable(payload),
    )
    db.add(msg)
    await db.flush()
    return msg


class ProcurementService:
    def __init__(self, db: AsyncSession, settings: Settings, claude: ClaudeClient):
        self.db = db
        self.settings = settings
        self.claude = claude
        self.buyer = BuyerAgent(claude, db)
        self.provider = ProviderAgent(claude)

    # ------------------------------------------------------------------ helpers
    async def get_owned(self, request_id: uuid.UUID, user: Profile) -> ProcurementRequest:
        req = await self.db.get(ProcurementRequest, request_id)
        if req is None or req.buyer_id != user.id:
            raise NotFoundError("Procurement request not found")  # same answer for missing / foreign
        await self._expire_if_due(req)
        return req

    async def _expire_if_due(self, req: ProcurementRequest) -> None:
        if (
            req.expires_at
            and as_utc(req.expires_at) <= utcnow()
            and req.status in (*OPEN_FOR_QUOTES, ProcurementStatus.SELECTED.value)
        ):
            req.status = ProcurementStatus.EXPIRED.value

    def _require_open(self, req: ProcurementRequest, allowed: tuple[str, ...] = OPEN_FOR_QUOTES) -> None:
        if req.status not in allowed:
            raise ConflictError(f"Request status '{req.status}' does not allow this action", code="invalid_status")

    # ------------------------------------------------------------------ create
    async def create_request(self, user: Profile, data: ProcurementCreate) -> ProcurementRequest:
        description = clean_text(data.description)
        extracted: ExtractedRequirements | None = None
        ai_status = "disabled"
        if data.use_ai:
            if self.claude.configured:
                try:
                    extracted = await self.buyer.extract_requirements(user.id, description)
                    ai_status = "claude"
                except UpstreamError as exc:
                    ai_status = f"unavailable:{exc.code}"
                    log.warning("Requirement extraction unavailable: %s", exc.code)
            else:
                ai_status = "not_configured"

        category = data.category or (extracted.category if extracted else None)
        if category is None:
            raise UnprocessableError(
                "Could not determine the service category; please specify `category`", code="category_required"
            )
        budget: Decimal | None = data.max_budget or (extracted.max_budget if extracted else None)
        if budget is None:
            raise UnprocessableError("A maximum budget is required; please specify `max_budget`", code="budget_required")
        asset = (data.budget_asset or (extracted.budget_asset if extracted else None) or self.settings.SUPPORTED_ASSETS[0]).upper()
        if asset not in self.settings.SUPPORTED_ASSETS:
            raise UnprocessableError(f"Asset {asset} is not supported", code="unsupported_asset")

        req = ProcurementRequest(
            buyer_id=user.id,
            description=description,
            category=ServiceCategory(category).value,
            requirements={
                "summary": extracted.summary if extracted else description[:600],
                "constraints": extracted.constraints if extracted else [],
                "delivery_deadline_minutes": extracted.delivery_deadline_minutes if extracted else None,
                "budget_source": "user" if data.max_budget else "ai_extracted",
                "category_source": "user" if data.category else "ai_extracted",
                "ai_extraction": ai_status,
            },
            max_budget=budget,
            budget_asset=asset,
            status=ProcurementStatus.CREATED.value,
            expires_at=utcnow() + timedelta(hours=self.settings.PROCUREMENT_TTL_HOURS),
        )
        self.db.add(req)
        await self.db.flush()
        await add_message(
            self.db, request_id=req.id, sender=AgentRole.BUYER_AGENT, receiver=AgentRole.USER,
            mtype=MessageType.TASK_PARSED,
            payload={"category": req.category, "max_budget": req.max_budget, "asset": asset,
                     "requirements": req.requirements},
        )
        return req

    # ------------------------------------------------------------------ discovery + quotes
    async def discover(self, user: Profile, request_id: uuid.UUID) -> list[Candidate]:
        req = await self.get_owned(request_id, user)
        return await discover_candidates(
            self.db, category=req.category, max_price=Decimal(str(req.max_budget)), asset=req.budget_asset
        )

    async def request_quotations(self, user: Profile, request_id: uuid.UUID) -> dict[str, Any]:
        req = await self.get_owned(request_id, user)
        self._require_open(req)
        candidates = await discover_candidates(
            self.db, category=req.category, max_price=Decimal(str(req.max_budget)), asset=req.budget_asset
        )
        created: list[Quotation] = []
        awaiting: list[uuid.UUID] = []
        for c in candidates:
            already = (
                await self.db.execute(
                    select(Quotation).where(Quotation.request_id == req.id, Quotation.provider_agent_id == c.agent.id)
                )
            ).scalar_one_or_none()
            if already is not None:
                continue
            await add_message(
                self.db, request_id=req.id, sender=AgentRole.BUYER_AGENT, receiver=AgentRole.PROVIDER_AGENT,
                mtype=MessageType.SERVICE_REQUEST, receiver_agent_id=c.agent.id,
                payload={"service_id": c.service.id, "category": req.category,
                         "max_budget": req.max_budget, "asset": req.budget_asset,
                         "summary": req.requirements.get("summary")},
            )
            if c.agent.kind == AgentKind.DEMO.value:
                quote = await self._demo_quote(user, req, c)
                created.append(quote)
            else:
                awaiting.append(c.agent.id)
        req.status = ProcurementStatus.QUOTING.value
        if await self._quote_count(req.id):
            req.status = ProcurementStatus.QUOTED.value
        await self.db.flush()
        return {"created_quotations": created, "awaiting_external_agents": awaiting, "candidates": len(candidates)}

    async def _quote_count(self, request_id: uuid.UUID) -> int:
        rows = (await self.db.execute(select(Quotation.id).where(Quotation.request_id == request_id))).all()
        return len(rows)

    async def _demo_quote(self, user: Profile, req: ProcurementRequest, c: Candidate) -> Quotation:
        details = await self.provider.build_quotation_details(user.id, c.agent, c.service, req)
        expires = min(
            utcnow() + timedelta(minutes=self.settings.QUOTATION_TTL_MINUTES),
            *([as_utc(req.expires_at)] if req.expires_at else []),
        )
        quote = Quotation(
            request_id=req.id,
            provider_agent_id=c.agent.id,
            service_id=c.service.id,
            price=c.service.price,                    # price is ALWAYS the published service price
            payment_asset=c.service.payment_asset,
            chain_id=self.settings.HSK_CHAIN_ID,
            pay_to_address=c.agent.wallet_address,    # ALWAYS the agent's registered wallet
            delivery_estimate_minutes=c.service.delivery_estimate_minutes,
            response_details=to_jsonable(details),
            status=QuotationStatus.SUBMITTED.value,
            expires_at=expires,
        )
        self.db.add(quote)
        await self.db.flush()
        await add_message(
            self.db, request_id=req.id, sender=AgentRole.PROVIDER_AGENT, receiver=AgentRole.BUYER_AGENT,
            mtype=MessageType.QUOTATION, sender_agent_id=c.agent.id,
            payload={"quotation_id": quote.id, "price": quote.price, "asset": quote.payment_asset,
                     "delivery_estimate_minutes": quote.delivery_estimate_minutes, "demo": True},
        )
        return quote

    async def submit_external_quotation(self, user: Profile, data: QuotationCreate) -> Quotation:
        agent = await self.db.get(Agent, data.provider_agent_id)
        if agent is None or agent.owner_id != user.id or agent.kind != AgentKind.EXTERNAL.value:
            raise ForbiddenError("You do not own this provider agent")
        if agent.status != AgentStatus.ACTIVE.value:
            raise ConflictError("Agent is not active", code="agent_inactive")
        req = await self.db.get(ProcurementRequest, data.request_id)
        if req is None:
            raise NotFoundError("Procurement request not found")
        await self._expire_if_due(req)
        self._require_open(req)
        solicited = (
            await self.db.execute(
                select(AgentMessage.id).where(
                    AgentMessage.request_id == req.id,
                    AgentMessage.receiver_agent_id == agent.id,
                    AgentMessage.message_type == MessageType.SERVICE_REQUEST.value,
                )
            )
        ).first()
        if solicited is None:
            raise ForbiddenError("This agent was not asked to quote on this request", code="not_solicited")
        if data.payment_asset != req.budget_asset or data.payment_asset not in self.settings.SUPPORTED_ASSETS:
            raise UnprocessableError("Quotation asset must match the request budget asset", code="asset_mismatch")
        if Decimal(str(data.price)) > Decimal(str(req.max_budget)):
            raise UnprocessableError("Quotation exceeds the request budget", code="budget_exceeded")
        if data.service_id:
            from app.models import Service

            svc = await self.db.get(Service, data.service_id)
            if svc is None or svc.provider_agent_id != agent.id:
                raise UnprocessableError("service_id does not belong to this agent", code="service_mismatch")
        expires = min(
            utcnow() + timedelta(minutes=self.settings.QUOTATION_TTL_MINUTES),
            *([as_utc(req.expires_at)] if req.expires_at else []),
        )
        quote = Quotation(
            request_id=req.id, provider_agent_id=agent.id, service_id=data.service_id,
            price=data.price, payment_asset=data.payment_asset, chain_id=self.settings.HSK_CHAIN_ID,
            pay_to_address=agent.wallet_address,  # never caller-supplied
            delivery_estimate_minutes=data.delivery_estimate_minutes,
            response_details={"summary": clean_text(data.details, 4000), "demo": False, "generated_by": "provider"},
            status=QuotationStatus.SUBMITTED.value, expires_at=expires,
        )
        try:
            async with self.db.begin_nested():
                self.db.add(quote)
                await self.db.flush()
        except IntegrityError as exc:
            raise ConflictError("This agent already quoted on this request", code="duplicate_quotation") from exc
        req.status = ProcurementStatus.QUOTED.value
        await add_message(
            self.db, request_id=req.id, sender=AgentRole.PROVIDER_AGENT, receiver=AgentRole.BUYER_AGENT,
            mtype=MessageType.QUOTATION, sender_agent_id=agent.id,
            payload={"quotation_id": quote.id, "price": quote.price, "asset": quote.payment_asset, "demo": False},
        )
        return quote

    async def withdraw_quotation(self, user: Profile, quotation_id: uuid.UUID) -> Quotation:
        quote = await self.db.get(Quotation, quotation_id)
        agent = await self.db.get(Agent, quote.provider_agent_id) if quote else None
        if quote is None or agent is None or agent.owner_id != user.id:
            raise NotFoundError("Quotation not found")
        if quote.status != QuotationStatus.SUBMITTED.value:
            raise ConflictError(f"Quotation in status {quote.status} cannot be withdrawn", code="invalid_status")
        quote.status = QuotationStatus.WITHDRAWN.value
        await self.db.flush()
        return quote

    async def list_quotations(self, user: Profile, request_id: uuid.UUID) -> list[Quotation]:
        await self.get_owned(request_id, user)
        rows = await self.db.execute(
            select(Quotation).where(Quotation.request_id == request_id).order_by(Quotation.price.asc())
        )
        return list(rows.scalars().all())

    def _eligible(self, req: ProcurementRequest, quotes: list[Quotation]) -> list[Quotation]:
        now = utcnow()
        return [
            q for q in quotes
            if q.status in (QuotationStatus.SUBMITTED.value, QuotationStatus.ACCEPTED.value)
            and as_utc(q.expires_at) > now
            and Decimal(str(q.price)) <= Decimal(str(req.max_budget))
            and q.payment_asset == req.budget_asset
        ]

    # ------------------------------------------------------------------ recommend / select
    async def recommend(self, user: Profile, request_id: uuid.UUID) -> dict[str, Any]:
        req = await self.get_owned(request_id, user)
        self._require_open(req, (*OPEN_FOR_QUOTES, ProcurementStatus.SELECTED.value))
        quotes = await self.list_quotations(user, request_id)
        eligible = self._eligible(req, quotes)
        rec, generated_by = await self.buyer.recommend(user.id, req, eligible)
        result = {
            "recommended_quotation_id": rec.recommended_quotation_id,
            "ranking": [r.model_dump(mode="json") for r in rec.ranking],
            "rationale": rec.rationale,
            "generated_by": generated_by,
            "generated_at": utcnow().isoformat(),
        }
        req.recommendation = to_jsonable(result)
        await add_message(
            self.db, request_id=req.id, sender=AgentRole.BUYER_AGENT, receiver=AgentRole.USER,
            mtype=MessageType.RECOMMENDATION, payload=result,
        )
        return to_jsonable(result)

    async def select(self, user: Profile, request_id: uuid.UUID, quotation_id: uuid.UUID) -> ProcurementRequest:
        req = await self.get_owned(request_id, user)
        self._require_open(req, (ProcurementStatus.QUOTED.value, ProcurementStatus.SELECTED.value))
        quote = await self.db.get(Quotation, quotation_id)
        if quote is None or quote.request_id != req.id:
            raise NotFoundError("Quotation not found for this request")
        if quote not in self._eligible(req, [quote]):
            raise UnprocessableError("Quotation is not eligible (status, expiry, budget or asset)", code="quotation_ineligible")
        agent = await self.db.get(Agent, quote.provider_agent_id)
        if agent is None or agent.status != AgentStatus.ACTIVE.value:
            raise UnprocessableError("Provider is not active", code="provider_inactive")

        live = (
            await self.db.execute(
                select(PaymentIntent.id).where(
                    PaymentIntent.request_id == req.id,
                    PaymentIntent.status.in_([s.value for s in ACTIVE_PAYMENT_STATES]),
                )
            )
        ).first()
        if live is not None:
            raise ConflictError("A payment already exists for this request; cancel it first", code="payment_exists")

        if req.selected_quotation_id and req.selected_quotation_id != quote.id:
            prev = await self.db.get(Quotation, req.selected_quotation_id)
            if prev and prev.status == QuotationStatus.ACCEPTED.value:
                prev.status = QuotationStatus.SUBMITTED.value
        quote.status = QuotationStatus.ACCEPTED.value
        req.selected_quotation_id = quote.id
        req.selected_provider_id = quote.provider_agent_id
        req.status = ProcurementStatus.SELECTED.value
        await add_message(
            self.db, request_id=req.id, sender=AgentRole.USER, receiver=AgentRole.PAYMENT_AGENT,
            mtype=MessageType.SELECTION, receiver_agent_id=None,
            payload={"quotation_id": quote.id, "provider_agent_id": quote.provider_agent_id},
        )
        await log_event(self.db, "provider_selected", actor_id=user.id,
                        data={"request_id": req.id, "quotation_id": quote.id})
        return req

    async def cancel(self, user: Profile, request_id: uuid.UUID) -> ProcurementRequest:
        req = await self.get_owned(request_id, user)
        self._require_open(req, (*OPEN_FOR_QUOTES, ProcurementStatus.SELECTED.value))
        live = (
            await self.db.execute(
                select(PaymentIntent.id).where(
                    PaymentIntent.request_id == req.id,
                    PaymentIntent.status.in_([s.value for s in ACTIVE_PAYMENT_STATES]),
                )
            )
        ).first()
        if live is not None:
            raise ConflictError("Cancel the payment first", code="payment_exists")
        req.status = ProcurementStatus.CANCELLED.value
        return req

    # ------------------------------------------------------------------ delivery (post-settlement only)
    async def deliver(self, user: Profile, request_id: uuid.UUID) -> ProcurementRequest:
        req = await self.get_owned(request_id, user)
        if req.delivery_status == DeliveryStatus.DELIVERED.value:
            return req
        intent = (
            await self.db.execute(
                select(PaymentIntent).where(
                    PaymentIntent.request_id == req.id, PaymentIntent.status == PaymentStatus.SETTLED.value
                )
            )
        ).scalar_one_or_none()
        receipt = None
        if intent is not None:
            receipt = (
                await self.db.execute(select(PaymentReceipt.id).where(PaymentReceipt.payment_intent_id == intent.id))
            ).first()
        if intent is None or receipt is None:
            raise ConflictError(
                "Delivery requires a payment that is SETTLED with a verified receipt", code="payment_not_settled"
            )
        agent = await self.db.get(Agent, intent.provider_agent_id)
        if agent is None or agent.kind != AgentKind.DEMO.value:
            raise ConflictError("External providers deliver through their own agent", code="external_provider")
        req.delivery_result = to_jsonable(await self.provider.deliver(user.id, agent, req))
        req.delivery_status = DeliveryStatus.DELIVERED.value
        req.delivered_at = utcnow()
        req.status = ProcurementStatus.COMPLETED.value
        await add_message(
            self.db, request_id=req.id, sender=AgentRole.PROVIDER_AGENT, receiver=AgentRole.BUYER_AGENT,
            mtype=MessageType.DELIVERY, sender_agent_id=agent.id, payload={"delivered": True},
        )
        return req
