"""Official HSP-supported payment tokens on HashKey Chain.

SOURCE (verified): HashKey Merchant docs, "Merchant onboarding" -> supported chain/token tables
(https://github.com/hashkey-merchant/hashkey-merchant.github.io, branch `page`, docs/en/onboarding.md,
commit 8460bdd). Token addresses MUST come from there; do not add entries from any other source.
Re-check this table against the live docs before every release: HSP adds/changes tokens (docs changelog).
"""

from __future__ import annotations

from dataclasses import dataclass

from eth_utils import to_checksum_address

DOCS_REFERENCE = "hashkey-merchant docs/en/onboarding.md @ 8460bdd (2026-10)"


@dataclass(frozen=True)
class HSPToken:
    network: str          # HSP network name used in method_data.data.network
    chain_id: int
    symbol: str
    address: str          # EIP-55 checksum
    decimals: int
    protocol: str         # "eip3009" | "permit2" (payer-side authorization scheme, informational)
    stablecoin: bool = True

    @property
    def caip2(self) -> str:
        return f"eip155:{self.chain_id}"

    def to_units(self, amount) -> int:  # noqa: ANN001
        from decimal import ROUND_DOWN, Decimal

        return int((Decimal(str(amount)) * (Decimal(10) ** self.decimals)).to_integral_value(rounding=ROUND_DOWN))


def _t(network: str, chain_id: int, symbol: str, address: str, decimals: int, protocol: str) -> HSPToken:
    return HSPToken(network, chain_id, symbol, to_checksum_address(address), decimals, protocol)


_TOKENS: tuple[HSPToken, ...] = (
    # HashKey Chain mainnet (177) -- network name "hashkey"
    _t("hashkey", 177, "USDC", "0x054ed45810DbBAb8B27668922D110669c9D88D0a", 6, "eip3009"),
    _t("hashkey", 177, "USDT", "0xf1b50ed67a9e2cc94ad3c477779e2d4cbfff9029", 6, "permit2"),
    # HashKey Chain testnet (133) -- network name "hashkey-testnet"
    _t("hashkey-testnet", 133, "USDC", "0x8FE3cB719Ee4410E236Cd6b72ab1fCDC06eF53c6", 6, "eip3009"),
    _t("hashkey-testnet", 133, "USDT", "0x372325443233fEbaC1F6998aC750276468c83CC6", 6, "permit2"),
)


def all_tokens() -> tuple[HSPToken, ...]:
    return _TOKENS


def find_token(chain_id: int, symbol: str) -> HSPToken | None:
    sym = symbol.upper()
    for t in _TOKENS:
        if t.chain_id == chain_id and t.symbol == sym:
            return t
    return None
