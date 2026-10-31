from __future__ import annotations

from decimal import Decimal
from typing import Annotated, Generic, TypeVar

from eth_utils import is_address, is_checksum_address, to_checksum_address
from pydantic import AfterValidator, BaseModel, ConfigDict, Field

ZERO_ADDRESS = "0x" + "0" * 40


def validate_eth_address(v: str) -> str:
    v = v.strip()
    if not v.startswith("0x") or len(v) != 42:
        raise ValueError("must be a 0x-prefixed 20-byte hex address")
    if not is_address(v):
        raise ValueError("invalid address")
    body = v[2:]
    # eth_utils.is_address() does not reject mixed-case addresses with a wrong checksum -- enforce EIP-55.
    if body != body.lower() and body != body.upper() and not is_checksum_address(v):
        raise ValueError("bad EIP-55 checksum")
    if v.lower() == ZERO_ADDRESS:
        raise ValueError("zero address is not allowed")
    return v if is_checksum_address(v) else to_checksum_address(v)


EthAddress = Annotated[str, AfterValidator(validate_eth_address)]


def _check_asset(v: str) -> str:
    v = v.strip().upper()
    if not (1 <= len(v) <= 16) or not v.isalnum():
        raise ValueError("asset must be 1-16 alphanumeric characters")
    return v


AssetSymbol = Annotated[str, AfterValidator(_check_asset)]
PositiveAmount = Annotated[Decimal, Field(gt=0, max_digits=38, decimal_places=18)]


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class StrictModel(BaseModel):
    """Request bodies reject unknown fields (e.g. a client trying to set `role` or `owner_id`)."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


T = TypeVar("T")


class Page(BaseModel, Generic[T]):
    items: list[T]
    total: int
    limit: int
    offset: int


class Pagination(BaseModel):
    limit: int = 20
    offset: int = 0
