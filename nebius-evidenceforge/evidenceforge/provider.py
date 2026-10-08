from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any

from .core import EvidenceError, strict_json_loads, _validate_request, _validate_plan


BASE_URL = "https://api.tokenfactory.nebius.com/v1"


@dataclass(frozen=True)
class TokenFactoryResult:
    model: str
    response_id: str
    content: str
    model_inventory_checked: bool
    response_model: str | None = None
    created: int | None = None

    def evidence(self) -> dict[str, Any]:
        return {
            "provider": "nebius-token-factory",
            "model": self.response_model or self.model,
            "requested_model": self.model,
            "created": self.created,
            "response_id": self.response_id,
            "model_inventory_checked": self.model_inventory_checked,
        }


def _request_json(url: str, token: str, *, body: dict[str, Any] | None = None) -> dict[str, Any]:
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
        with urllib.request.urlopen(req, timeout=60) as response:
            payload = response.read().decode("utf-8")
    except (urllib.error.URLError, TimeoutError, UnicodeDecodeError) as exc:
        raise EvidenceError(f"Token Factory request failed: {exc}") from exc
    parsed = strict_json_loads(payload)
    if not isinstance(parsed, dict):
        raise EvidenceError("Token Factory returned a non-object JSON payload")
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


def generate_plan(request_json: str, *, api_key: str | None = None, model: str | None = None) -> TokenFactoryResult:
    """Call Nebius Token Factory using its OpenAI-compatible API.

    Model identity is checked against `/v1/models` at runtime instead of
    hard-coding a model identifier that can become stale.
    """

    request = strict_json_loads(request_json)
    if not isinstance(request, dict):
        raise EvidenceError("request must be a JSON object")
    request = _validate_request(request)

    token = api_key or os.environ.get("NEBIUS_API_KEY")
    chosen_model = model or os.environ.get("NEBIUS_MODEL")
    if not token:
        raise EvidenceError("NEBIUS_API_KEY is required for provider mode")
    if not chosen_model:
        raise EvidenceError("NEBIUS_MODEL is required; choose a current NVIDIA/Nemotron model")

    inventory = _request_json(f"{BASE_URL}/models", token)
    _nvidia_model_present(inventory, chosen_model)

    system = (
        "You are EvidenceForge's untrusted planning model. Return JSON only. "
        "The object must have exactly keys summary and operations. "
        'Each operation must be one of {"kind":"read","path":"..."}, '
        '{"kind":"write","path":"...","content":"..."}, or '
        '{"kind":"test","name":"..."}, with exactly those keys. '
        "summary must be nonempty text; operations must be a JSON array. "
        "Never invent paths/tests outside the human request. Never claim approval, "
        "deployment, payment, or external authority. Run every required test exactly "
        "once and in the request order."
    )
    body = {
        "model": chosen_model,
        "temperature": 0,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": json.dumps(request, ensure_ascii=False)},
        ],
    }
    response = _request_json(f"{BASE_URL}/chat/completions", token, body=body)
    response_id = response.get("id")
    response_model = response.get("model")
    created = response.get("created")
    if not isinstance(response_model, str) or not response_model.strip():
        raise EvidenceError("Token Factory chat response missing model")
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
    return TokenFactoryResult(
        model=chosen_model,
        response_id=response_id,
        content=message["content"],
        model_inventory_checked=True,
        response_model=response_model,
        created=created,
    )
