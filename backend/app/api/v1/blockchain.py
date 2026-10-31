import uuid

from fastapi import APIRouter

from app.api.deps import ChainDep, SettingsDep
from app.core.errors import ConflictError, ForbiddenError
from app.core.security import CurrentUser, DbSession
from app.integrations.blockchain.client import agent_uuid_to_bytes32
from app.payments.service import log_event
from app.services import marketplace as market

router = APIRouter(prefix="/blockchain", tags=["blockchain"])


@router.get("/status")
async def chain_status(user: CurrentUser, chain: ChainDep) -> dict:
    """Read-only RPC health + configuration (no keys are held by the backend)."""
    return await chain.status()


@router.get("/agents/{agent_id}/onchain")
async def onchain_agent(agent_id: uuid.UUID, user: CurrentUser, db: DbSession, chain: ChainDep) -> dict:
    await market.get_agent_visible(db, agent_id, user)
    onchain = await chain.get_agent(agent_id)
    return {
        "agent_id": str(agent_id),
        "registry_agent_key": "0x" + agent_uuid_to_bytes32(agent_id).hex(),
        "registered": onchain.registered,
        "owner": onchain.owner,
        "category_id": onchain.category_id,
        "metadata_uri": onchain.metadata_uri,
        "active": onchain.active,
        "registered_at": onchain.registered_at,
    }


@router.post("/agents/{agent_id}/verify-registration")
async def verify_registration(
    agent_id: uuid.UUID, user: CurrentUser, db: DbSession, chain: ChainDep, settings: SettingsDep
) -> dict:
    """After the agent owner registers on-chain (from their wallet), the backend VERIFIES the registry
    state itself and stores the reference. Client-supplied claims are never trusted."""
    agent = await market.get_agent_visible(db, agent_id, user)
    market.assert_can_manage_agent(agent, user)
    onchain = await chain.get_agent(agent_id)
    if not onchain.registered:
        raise ConflictError("Agent is not registered on-chain yet", code="not_registered_onchain")
    allowed_owners = {a.lower() for a in (agent.wallet_address, user.wallet_address) if a}
    if (onchain.owner or "").lower() not in allowed_owners:
        raise ForbiddenError(
            "On-chain owner does not match the agent wallet or your profile wallet", code="onchain_owner_mismatch"
        )
    agent.onchain_registration_reference = f"{settings.HSK_CHAIN_ID}:{settings.AGENT_REGISTRY_ADDRESS}:0x" + (
        agent_uuid_to_bytes32(agent_id).hex()
    )
    await log_event(db, "agent_onchain_verified", actor_id=user.id,
                    data={"agent_id": agent.id, "reference": agent.onchain_registration_reference})
    return {"agent_id": str(agent_id), "onchain_registration_reference": agent.onchain_registration_reference}
