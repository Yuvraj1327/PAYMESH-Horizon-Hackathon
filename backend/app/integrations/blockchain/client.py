"""Read-only HashKey Chain access via web3.py. The backend holds NO private keys and sends no transactions."""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass

from eth_utils import to_checksum_address
from web3 import AsyncWeb3, AsyncHTTPProvider

from app.core.config import Settings
from app.core.errors import ServiceUnavailableError

log = logging.getLogger(__name__)

# Minimal ABI for the read-only functions of contracts/contracts/AgentRegistry.sol
AGENT_REGISTRY_ABI = [
    {
        "type": "function",
        "name": "getAgent",
        "stateMutability": "view",
        "inputs": [{"name": "agentId", "type": "bytes32"}],
        "outputs": [
            {
                "name": "",
                "type": "tuple",
                "components": [
                    {"name": "owner", "type": "address"},
                    {"name": "categoryId", "type": "bytes32"},
                    {"name": "metadataURI", "type": "string"},
                    {"name": "active", "type": "bool"},
                    {"name": "registeredAt", "type": "uint64"},
                ],
            }
        ],
    },
    {
        "type": "function",
        "name": "isRegistered",
        "stateMutability": "view",
        "inputs": [{"name": "agentId", "type": "bytes32"}],
        "outputs": [{"name": "", "type": "bool"}],
    },
    {"type": "function", "name": "agentCount", "stateMutability": "view", "inputs": [], "outputs": [{"name": "", "type": "uint256"}]},
]

ERC20_TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"  # keccak("Transfer(address,address,uint256)")

CHAIN_NAMES = {133: "HashKey Chain Testnet", 177: "HashKey Chain Mainnet"}


def agent_uuid_to_bytes32(agent_id: uuid.UUID) -> bytes:
    """UUID (16 bytes) left-aligned in a bytes32 -- deterministic and reversible."""
    return agent_id.bytes + b"\x00" * 16


def category_to_bytes32(category: str) -> bytes:
    """Category slug right-padded into a bytes32 (e.g. 'crypto_research')."""
    raw = category.encode()
    if len(raw) > 32:
        raise ValueError("category too long")
    return raw + b"\x00" * (32 - len(raw))


@dataclass(frozen=True)
class TokenTransfer:
    token: str
    sender: str
    recipient: str
    value: int


@dataclass(frozen=True)
class TxEvidence:
    """What the chain itself says about a transaction (independent of any gateway claim)."""

    tx_hash: str
    success: bool
    block_number: int
    confirmations: int
    finalized: bool | None          # None when the RPC does not support the 'finalized' tag
    transfers: tuple[TokenTransfer, ...]


@dataclass(frozen=True)
class OnchainAgent:
    registered: bool
    owner: str | None = None
    category_id: str | None = None
    metadata_uri: str | None = None
    active: bool | None = None
    registered_at: int | None = None


class ChainClient:
    def __init__(self, settings: Settings, w3: AsyncWeb3 | None = None):
        self.settings = settings
        self.w3 = w3 or AsyncWeb3(
            AsyncHTTPProvider(settings.HSK_RPC_URL, request_kwargs={"timeout": settings.BLOCKCHAIN_TIMEOUT_SECONDS})
        )

    async def status(self) -> dict:
        try:
            chain_id = await self.w3.eth.chain_id
            block = await self.w3.eth.block_number
        except Exception as exc:
            log.warning("RPC status failed: %s", type(exc).__name__)
            raise ServiceUnavailableError("Blockchain RPC unreachable", code="rpc_unreachable") from exc
        return {
            "rpc_chain_id": chain_id,
            "configured_chain_id": self.settings.HSK_CHAIN_ID,
            "chain_id_matches": chain_id == self.settings.HSK_CHAIN_ID,
            "network": CHAIN_NAMES.get(chain_id, "unknown"),
            "latest_block": block,
            "registry_address": self.settings.AGENT_REGISTRY_ADDRESS or None,
            "registry_configured": bool(self.settings.AGENT_REGISTRY_ADDRESS),
        }

    def _registry(self):  # noqa: ANN202
        if not self.settings.AGENT_REGISTRY_ADDRESS:
            raise ServiceUnavailableError("AgentRegistry address is not configured", code="registry_not_configured")
        return self.w3.eth.contract(
            address=to_checksum_address(self.settings.AGENT_REGISTRY_ADDRESS), abi=AGENT_REGISTRY_ABI
        )

    async def get_tx_evidence(self, tx_hash: str) -> TxEvidence | None:
        """Fetch the receipt and decode ERC-20 Transfer logs. Returns None if the node has no such transaction."""
        from web3.exceptions import TransactionNotFound

        try:
            chain_id = await self.w3.eth.chain_id
            if chain_id != self.settings.HSK_CHAIN_ID:
                raise ServiceUnavailableError("RPC chain id does not match configuration", code="wrong_chain")
            try:
                receipt = await self.w3.eth.get_transaction_receipt(tx_hash)
            except TransactionNotFound:
                return None
            head = await self.w3.eth.block_number
            finalized: bool | None
            try:
                fin = await self.w3.eth.get_block("finalized")
                finalized = receipt["blockNumber"] <= fin["number"]
            except Exception:  # noqa: BLE001 - tag unsupported on this RPC
                finalized = None
        except ServiceUnavailableError:
            raise
        except Exception as exc:
            log.warning("Tx evidence read failed: %s", type(exc).__name__)
            raise ServiceUnavailableError("Blockchain read failed", code="rpc_error") from exc

        transfers = []
        for lg in receipt["logs"]:
            topics = [bytes(t) for t in lg["topics"]]
            if len(topics) == 3 and "0x" + topics[0].hex().removeprefix("0x") == ERC20_TRANSFER_TOPIC:
                data = bytes(lg["data"]) if not isinstance(lg["data"], str) else bytes.fromhex(lg["data"].removeprefix("0x"))
                if len(data) == 32:
                    transfers.append(TokenTransfer(
                        token=to_checksum_address(lg["address"]),
                        sender=to_checksum_address(topics[1][-20:]),
                        recipient=to_checksum_address(topics[2][-20:]),
                        value=int.from_bytes(data, "big"),
                    ))
        number = int(receipt["blockNumber"])
        return TxEvidence(
            tx_hash=tx_hash, success=int(receipt["status"]) == 1, block_number=number,
            confirmations=max(0, int(head) - number + 1), finalized=finalized, transfers=tuple(transfers),
        )

    async def get_agent(self, agent_id: uuid.UUID) -> OnchainAgent:
        registry = self._registry()
        key = agent_uuid_to_bytes32(agent_id)
        try:
            # Guard against a misconfigured RPC/chain: refuse to read from the wrong network.
            chain_id = await self.w3.eth.chain_id
            if chain_id != self.settings.HSK_CHAIN_ID:
                raise ServiceUnavailableError("RPC chain id does not match configuration", code="wrong_chain")
            if not await registry.functions.isRegistered(key).call():
                return OnchainAgent(registered=False)
            owner, category_id, uri, active, ts = await registry.functions.getAgent(key).call()
        except ServiceUnavailableError:
            raise
        except Exception as exc:
            log.warning("Registry read failed: %s", type(exc).__name__)
            raise ServiceUnavailableError("Blockchain read failed", code="rpc_error") from exc
        return OnchainAgent(True, to_checksum_address(owner), "0x" + category_id.hex(), uri, active, ts)


def get_chain_client() -> ChainClient:
    from app.core.config import get_settings

    return ChainClient(get_settings())
