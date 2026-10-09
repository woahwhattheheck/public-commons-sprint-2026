from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any

from .core import EvidenceError, strict_json_loads, _validate_request, _validate_plan


BASE_URL = "https://api.tokenfactory.nebius.com/v1"


class _RejectTokenFactoryRedirect(urllib.request.HTTPRedirectHandler):
    """Never forward a bearer token to a redirected provider URL."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise EvidenceError("Token Factory redirect rejected to protect authorization")


@dataclass(frozen=True)
class TokenFactoryResult:
    model: str
    response_id: str
    content: str
    model_inventory_checked: bool
    response_model: str | None = None
    created: int | None = None
    usage: dict[str, int] | None = None
    request_id: str | None = None
    finish_reason: str | None = None

    def evidence(self) -> dict[str, Any]:
        return {
            "provider": "nebius-token-factory",
            "model": self.response_model or self.model,
            "requested_model": self.model,
            "created": self.created,
            "response_id": self.response_id,
            "model_inventory_checked": self.model_inventory_checked,
            "usage": dict(self.usage or {}),
            "request_id": self.request_id,
            "finish_reason": self.finish_reason,
        }


def _request_json(url: str, token: str, *, body: dict[str, Any] | None = None,
                  timeout_seconds: float = 60) -> dict[str, Any]:
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
    }
    data = None
    method = "GET"
    if body is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(body, separators=(",", ":"), allow_nan=False).encode("utf-8")
        method = "POST"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.build_opener(_RejectTokenFactoryRedirect()).open(req, timeout=timeout_seconds) as response:
            raw = response.read(1048577)
            request_id = response.headers.get("request-id") or response.headers.get("x-request-id")
        if len(raw) > 1048576:
            raise EvidenceError("Token Factory response size exceeded")
        payload = raw.decode("utf-8")
    except (urllib.error.URLError, TimeoutError, UnicodeDecodeError) as exc:
        raise EvidenceError("Token Factory request failed; inspect the operation before retry") from None
    if token in payload:
        raise EvidenceError("Token Factory response contained credential material; not retained")
    parsed = strict_json_loads(payload)
    if not isinstance(parsed, dict):
        raise EvidenceError("Token Factory returned a non-object JSON payload")
    if request_id:
        parsed["_request_id"] = request_id
    return parsed


def _nvidia_model_present(models_payload: dict[str, Any], model: str) -> bool:
    data = models_payload.get("data")
    if not isinstance(data, list):
        raise EvidenceError("Token Factory model inventory missing data[]")
    ids = []
    for row in data:
        if isinstance(row, dict) and isinstance(row.get("id"), str):
            ids.append(row["id"])
    if model not in ids:
        raise EvidenceError(f"configured model is not in live Token Factory inventory: {model}")
    lowered = model.lower()
    if "nvidia" not in lowered and "nemotron" not in lowered:
        raise EvidenceError(
            "competition adapter requires a live NVIDIA/Nemotron model from Token Factory"
        )
    return True


def generate_plan(request_json: str, *, api_key: str | None = None, model: str | None = None,
                  source_context: dict[str, str] | None = None,
                  baseline_evidence: dict[str, Any] | None = None,
                  maximum_output_tokens: int = 4096,
                  timeout_seconds: float = 60) -> TokenFactoryResult:
    """Call Nebius Token Factory using its OpenAI-compatible API.

    Model identity is checked against `/v1/models` at runtime instead of
    hard-coding a model identifier that can become stale.
    """

    request = strict_json_loads(request_json)
    if not isinstance(request, dict):
        raise EvidenceError("request must be a JSON object")
    request = _validate_request(request)
    if type(maximum_output_tokens) is not int or not 128 <= maximum_output_tokens <= 8192:
        raise EvidenceError("maximum_output_tokens must be 128–8192")
    if type(timeout_seconds) not in (int, float) or not 0 < timeout_seconds <= 60:
        raise EvidenceError("timeout_seconds must be positive and at most 60")
    context = source_context or {}
    if not isinstance(context, dict) or any(path not in request["allowed_paths"] or
            not isinstance(content, str) or len(content.encode("utf-8")) > 16000
            for path, content in context.items()):
        raise EvidenceError("source context must use bounded allowed policy files")
    user_content = json.dumps({"request": request, "allowed_source": context,
                               "observed_baseline": baseline_evidence or {}}, ensure_ascii=False)
    if len(user_content.encode("utf-8")) > 65536:
        raise EvidenceError("provider input exceeds byte limit")

    token = api_key or os.environ.get("NEBIUS_API_KEY")
    chosen_model = model or os.environ.get("NEBIUS_MODEL")
    if not token:
        raise EvidenceError("NEBIUS_API_KEY is required for provider mode")
    if not chosen_model:
        raise EvidenceError("NEBIUS_MODEL is required; choose a current NVIDIA/Nemotron model")

    inventory = _request_json(f"{BASE_URL}/models", token, timeout_seconds=timeout_seconds)
    _nvidia_model_present(inventory, chosen_model)

    system = (
        "You are EvidenceForge's untrusted planning model. Return JSON only. "
        "The object must have exactly keys summary and operations. "
        'Each operation must be one of {"kind":"read","path":"..."}, '
        '{"kind":"write","path":"...","content":"..."}, or '
        '{"kind":"test","name":"..."}, with exactly those keys. '
        "summary must be nonempty text; operations must be a JSON array. "
        "Never invent paths/tests outside the human request. Never claim approval, "
        "When allowed Python source is supplied, preserve its pure-function style: "
        "only its existing imported libraries, no annotations, classes, decorators, "
        "f-strings, reflection, dunder identifiers, file/network/process operations. "
        "deployment, payment, or external authority. Run every required test exactly "
        "once and in the request order."
    )
    body = {
        "model": chosen_model,
        "temperature": 0,
        "max_tokens": maximum_output_tokens,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user_content},
        ],
    }
    response = _request_json(f"{BASE_URL}/chat/completions", token, body=body,
                             timeout_seconds=timeout_seconds)
    response_id = response.get("id")
    response_model = response.get("model")
    created = response.get("created")
    if not isinstance(response_model, str) or not response_model.strip():
        raise EvidenceError("Token Factory chat response missing model")
    _nvidia_model_present(inventory, response_model)
    if type(created) is not int or created < 0:
        raise EvidenceError("Token Factory chat response missing Unix created timestamp")
    choices = response.get("choices")
    if not isinstance(response_id, str) or not response_id.strip() or not isinstance(choices, list) or not choices:
        raise EvidenceError("Token Factory chat response missing id/choices")
    first = choices[0]
    if not isinstance(first, dict):
        raise EvidenceError("Token Factory choice must be an object")
    if first.get("finish_reason") != "stop":
        raise EvidenceError("Token Factory plan did not complete normally")
    message = first.get("message")
    if not isinstance(message, dict) or not isinstance(message.get("content"), str):
        raise EvidenceError("Token Factory choice missing text content")
    plan = strict_json_loads(message["content"])
    if not isinstance(plan, dict):
        raise EvidenceError("Token Factory plan must be a JSON object")
    _validate_plan(plan, request)
    raw_usage = response.get("usage", {})
    if not isinstance(raw_usage, dict):
        raise EvidenceError("Token Factory usage must be an object")
    usage = {key: value for key, value in raw_usage.items()
             if key in {"prompt_tokens", "completion_tokens", "total_tokens"}
             and type(value) is int and value >= 0}
    if usage.get("completion_tokens", 0) > maximum_output_tokens:
        raise EvidenceError("Token Factory output exceeded requested token bound")
    return TokenFactoryResult(
        model=chosen_model,
        response_id=response_id,
        content=message["content"],
        model_inventory_checked=True,
        response_model=response_model,
        created=created,
        usage=usage,
        request_id=response.get("_request_id"),
        finish_reason=first.get("finish_reason"),
    )
