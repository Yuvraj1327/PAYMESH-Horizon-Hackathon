"""Payment-intent lifecycle state machine.

    DRAFT -> VALIDATED -> AWAITING_SIGNATURE -> SIGNED -> SUBMITTED -> PENDING -> SETTLED
                 \\______________\\_____________\\__________\\__________\\ FAILED / EXPIRED / CANCELLED

Rules enforced here (not by the AI, not by the client):
  * SETTLED can only be reached with a `VerifiedSettlement` produced by the (Step 2) HSP
    verifier -- an HTTP 200 or a client-side claim is never enough.
  * SIGNED/SUBMITTED/PENDING/SETTLED are reachable only by internal (server) callers.
  * Terminal states never transition.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.core.errors import ConflictError
from app.models.enums import PaymentStatus as S

TRANSITIONS: dict[S, frozenset[S]] = {
    S.DRAFT: frozenset({S.VALIDATED, S.FAILED, S.CANCELLED, S.EXPIRED}),
    S.VALIDATED: frozenset({S.AWAITING_SIGNATURE, S.FAILED, S.CANCELLED, S.EXPIRED}),
    S.AWAITING_SIGNATURE: frozenset({S.SIGNED, S.FAILED, S.CANCELLED, S.EXPIRED}),
    S.SIGNED: frozenset({S.SUBMITTED, S.FAILED, S.CANCELLED, S.EXPIRED}),
    S.SUBMITTED: frozenset({S.PENDING, S.SETTLED, S.FAILED}),
    S.PENDING: frozenset({S.SETTLED, S.FAILED, S.EXPIRED}),
    S.SETTLED: frozenset(),
    S.FAILED: frozenset(),
    S.EXPIRED: frozenset(),
    S.CANCELLED: frozenset(),
}

TERMINAL = frozenset(s for s, nxt in TRANSITIONS.items() if not nxt)
# States in which the user may still cancel / the intent may still expire (nothing sent to HSP yet).
PRE_SUBMISSION = frozenset({S.DRAFT, S.VALIDATED, S.AWAITING_SIGNATURE, S.SIGNED})
# Reachable only through the (Step 2) HSP integration, never via a public endpoint.
SERVER_ONLY = frozenset({S.SIGNED, S.SUBMITTED, S.PENDING, S.SETTLED})


@dataclass(frozen=True)
class VerifiedSettlement:
    """Evidence object. Constructed only by the HSP verification code path (Step 2)."""

    receipt_reference: str
    transaction_hash: str | None
    verified_via: str  # e.g. "hsp_gateway_status+onchain"


def can_transition(src: S, dst: S) -> bool:
    return dst in TRANSITIONS[src]


def assert_transition(
    src: S, dst: S, *, internal: bool = False, settlement: VerifiedSettlement | None = None
) -> None:
    if not can_transition(src, dst):
        raise ConflictError(f"Illegal payment transition {src.value} -> {dst.value}", code="illegal_transition")
    if dst in SERVER_ONLY and not internal:
        raise ConflictError(f"Transition to {dst.value} is not permitted from this context", code="illegal_transition")
    if dst is S.SETTLED and settlement is None:
        raise ConflictError(
            "SETTLED requires a verified settlement receipt", code="settlement_not_verified"
        )
