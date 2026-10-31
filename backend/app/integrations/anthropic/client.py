"""Thin, safe wrapper around the official Anthropic Python SDK.

Features: configurable model, timeouts, bounded retries, per-user usage limits,
tool-use loop with Pydantic-validated tool inputs, and Pydantic-validated structured output.

Security properties:
  * The model only ever receives data the caller passes in; it has no wallet, key or
    payment capability. Tools given to it are read-only lookups.
  * Every tool input and the final structured output are validated; invalid output raises
    `AIOutputError` and callers must fall back to deterministic logic or fail closed.
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from collections import defaultdict
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from typing import Any, TypeVar

import anthropic
from pydantic import BaseModel, ValidationError

from app.core.config import Settings
from app.core.errors import AppError, RateLimitError, UpstreamError

log = logging.getLogger(__name__)
T = TypeVar("T", bound=BaseModel)

OUTPUT_TOOL_NAME = "submit_result"


class AIUnavailableError(UpstreamError):
    code = "ai_unavailable"


class AIOutputError(UpstreamError):
    code = "ai_invalid_output"


@dataclass
class ToolSpec:
    """A read-only helper tool the model may call during a run."""

    name: str
    description: str
    input_model: type[BaseModel]
    handler: Callable[[Any], Awaitable[Any]]

    def schema(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "description": self.description,
            "input_schema": _clean_schema(self.input_model.model_json_schema()),
        }


def _clean_schema(schema: dict[str, Any]) -> dict[str, Any]:
    schema = json.loads(json.dumps(schema))
    schema.pop("title", None)
    return schema


@dataclass
class _Usage:
    day: date = field(default_factory=lambda: datetime.now(UTC).date())
    calls: int = 0
    tokens: int = 0


class UsageLimiter:
    """Per-user daily call/token budget. Process-local; swap for Redis when scaling out."""

    def __init__(self, max_calls: int, max_tokens: int):
        self.max_calls = max_calls
        self.max_tokens = max_tokens
        self._usage: dict[uuid.UUID, _Usage] = defaultdict(_Usage)

    def _current(self, user_id: uuid.UUID) -> _Usage:
        u = self._usage[user_id]
        today = datetime.now(UTC).date()
        if u.day != today:
            u.day, u.calls, u.tokens = today, 0, 0
        return u

    def check(self, user_id: uuid.UUID) -> None:
        u = self._current(user_id)
        if u.calls >= self.max_calls or u.tokens >= self.max_tokens:
            raise RateLimitError("Daily AI usage limit reached", code="ai_usage_limit")

    def record(self, user_id: uuid.UUID, tokens: int) -> None:
        u = self._current(user_id)
        u.calls += 1
        u.tokens += tokens

    def snapshot(self, user_id: uuid.UUID) -> dict[str, int]:
        u = self._current(user_id)
        return {
            "calls_today": u.calls,
            "tokens_today": u.tokens,
            "max_calls_per_day": self.max_calls,
            "max_tokens_per_day": self.max_tokens,
        }


class ClaudeClient:
    def __init__(self, settings: Settings, sdk_client: Any | None = None, limiter: UsageLimiter | None = None):
        self.settings = settings
        self.model = settings.ANTHROPIC_MODEL
        self.limiter = limiter or UsageLimiter(
            settings.AI_MAX_CALLS_PER_USER_PER_DAY, settings.AI_MAX_TOKENS_PER_USER_PER_DAY
        )
        self._sdk = sdk_client
        if self._sdk is None and settings.ANTHROPIC_API_KEY:
            self._sdk = anthropic.AsyncAnthropic(
                api_key=settings.ANTHROPIC_API_KEY,
                timeout=settings.ANTHROPIC_TIMEOUT_SECONDS,
                max_retries=settings.ANTHROPIC_MAX_RETRIES,
            )

    @property
    def configured(self) -> bool:
        return self._sdk is not None

    async def run_structured(
        self,
        *,
        user_id: uuid.UUID,
        system: str,
        user_content: str,
        output_model: type[T],
        output_description: str = "Submit the final structured result.",
        tools: list[ToolSpec] | None = None,
    ) -> T:
        """Run a (possibly multi-turn) tool-use conversation and return validated structured output."""
        if not self.configured:
            raise AIUnavailableError("AI provider is not configured")
        self.limiter.check(user_id)

        tools = tools or []
        by_name = {t.name: t for t in tools}
        output_tool = {
            "name": OUTPUT_TOOL_NAME,
            "description": output_description,
            "input_schema": _clean_schema(output_model.model_json_schema()),
        }
        tool_defs = [t.schema() for t in tools] + [output_tool]
        messages: list[dict[str, Any]] = [{"role": "user", "content": user_content}]
        max_turns = max(1, self.settings.AI_MAX_TOOL_TURNS) if tools else 1

        for turn in range(max_turns):
            last = turn == max_turns - 1
            tool_choice = (
                {"type": "tool", "name": OUTPUT_TOOL_NAME} if last or not tools else {"type": "any"}
            )
            resp = await self._create(
                user_id=user_id, system=system, messages=messages, tools=tool_defs, tool_choice=tool_choice
            )
            tool_uses = [b for b in resp.content if getattr(b, "type", None) == "tool_use"]
            if not tool_uses:
                raise AIOutputError("Model did not return a structured result")

            for block in tool_uses:
                if block.name == OUTPUT_TOOL_NAME:
                    try:
                        return output_model.model_validate(block.input)
                    except ValidationError as exc:
                        log.warning("AI output failed validation: %s", exc.error_count())
                        raise AIOutputError("Model output failed validation") from exc

            messages.append({"role": "assistant", "content": resp.content})
            results = []
            for block in tool_uses:
                results.append(await self._run_tool(by_name.get(block.name), block))
            messages.append({"role": "user", "content": results})

        raise AIOutputError("Model did not finish within the tool-turn limit")

    async def _run_tool(self, spec: ToolSpec | None, block: Any) -> dict[str, Any]:
        if spec is None:
            return {"type": "tool_result", "tool_use_id": block.id, "content": "Unknown tool", "is_error": True}
        try:
            args = spec.input_model.model_validate(block.input)
            out = await spec.handler(args)
            return {
                "type": "tool_result",
                "tool_use_id": block.id,
                "content": json.dumps(out, default=str)[:20_000],
            }
        except ValidationError:
            return {"type": "tool_result", "tool_use_id": block.id, "content": "Invalid tool input", "is_error": True}
        except AppError as exc:
            return {"type": "tool_result", "tool_use_id": block.id, "content": exc.message, "is_error": True}
        except Exception:  # never leak internals to the model
            log.exception("tool %s failed", spec.name)
            return {"type": "tool_result", "tool_use_id": block.id, "content": "Tool failed", "is_error": True}

    async def _create(self, *, user_id: uuid.UUID, system: str, messages: list, tools: list, tool_choice: dict) -> Any:
        try:
            resp = await asyncio.wait_for(
                self._sdk.messages.create(
                    model=self.model,
                    max_tokens=self.settings.ANTHROPIC_MAX_TOKENS,
                    system=system,
                    messages=messages,
                    tools=tools,
                    tool_choice=tool_choice,
                ),
                timeout=self.settings.ANTHROPIC_TIMEOUT_SECONDS + 5,
            )
        except TimeoutError as exc:
            raise AIUnavailableError("AI request timed out", code="ai_timeout") from exc
        except anthropic.APITimeoutError as exc:
            raise AIUnavailableError("AI request timed out", code="ai_timeout") from exc
        except anthropic.APIError as exc:
            log.warning("Anthropic API error: %s", type(exc).__name__)
            raise AIUnavailableError("AI provider error") from exc
        usage = getattr(resp, "usage", None)
        tokens = int(getattr(usage, "input_tokens", 0) or 0) + int(getattr(usage, "output_tokens", 0) or 0)
        self.limiter.record(user_id, tokens)
        return resp


_claude: ClaudeClient | None = None


def get_claude_client() -> ClaudeClient:
    from app.core.config import get_settings

    global _claude
    if _claude is None:
        _claude = ClaudeClient(get_settings())
    return _claude


def reset_claude_client() -> None:
    global _claude
    _claude = None
