from fastapi import APIRouter

from app.api.v1 import (
    agents, ai, blockchain, health, payments, policies, procurement, quotations, services, transactions, users, webhooks,
)

api_router = APIRouter()
for module in (users, agents, services, procurement, quotations, ai, policies, payments, transactions, blockchain, webhooks):
    api_router.include_router(module.router)
api_router.include_router(health.router)
