from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .core import (EvidenceError, strict_json_loads, _validate_request, _validate_plan,
                   canonical_bytes, sha256_hex)
from .run_storage import atomic_json, utc_now


BASE_URL = "https://api.tokenfactory.nebius.com/v1"
MAX_RESPONSE_BYTES = 1024 * 1024


def _endpoint(path):
    project = os.environ.get("NEBIUS_PROJECT_ID")
    return BASE_URL + path + ("?" + urllib.parse.urlencode({"ai_project_id": project}) if project else "")


def _is_nvidia(model):
    return isinstance(model, str) and ("nvidia" in model.lower() or "nemotron" in model.lower())


class ProviderRequestError(EvidenceError):
    """Nonsecret provider failure; the original HTTP record stays with its run."""

    def __init__(self, message, *, code="provider_request_failed", status=None):
        super().__init__(message)
        self.code = code
        self.status = status

class _RejectAuthenticatedRedirect(urllib.request.HTTPRedirectHandler):
    """Provider credentials must never be forwarded to a redirect destination."""

    def redirect_request(self, request, fp, code, msg, headers, newurl):
        return None


_PROVIDER_OPENER = urllib.request.build_opener(_RejectAuthenticatedRedirect())


@dataclass(frozen=True)
class TokenFactoryResult:
    model: str
    response_id: str
    content: str
    model_inventory_checked: bool
    response_model: str | None = None
    created: int | None = None
    usage: dict[str, Any] | None = None
    request_id: str | None = None
    finish_reason: str | None = None
    service_tier: str | None = None
    observed_at: str | None = None
    request_body_sha256: str | None = None
    response_body_sha256: str | None = None
    inventory_sha256: str | None = None
    api_record_sha256: str | None = None
    cost: dict[str, Any] | None = None

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
            "service_tier": self.service_tier,
            "observed_at": self.observed_at,
            "request_body_sha256": self.request_body_sha256,
            "response_body_sha256": self.response_body_sha256,
            "inventory_sha256": self.inventory_sha256,
            "api_record_sha256": self.api_record_sha256,
            "cost": self.cost or {"status": "not_returned", "reported": {}},
        }


def _request_json(url: str, token: str, *, body: dict[str, Any] | None = None,
                  timeout_seconds: float = 60, capture: dict | None = None,
                  capture_path: Path | None = None) -> dict[str, Any]:
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
    started = time.monotonic()
    observation = {"schema": "evidenceforge-provider-http/v1", "method": method,
                   "url": url, "started_at": utc_now(), "state": "DISPATCHING",
                   "request_body": data.decode("utf-8") if data else None,
                   "request_body_sha256": sha256_hex(data) if data else None}
    if capture_path:
        atomic_json(capture_path, observation)
    status = None
    response_headers = {}
    raw = b""
    try:
        try:
            response = _PROVIDER_OPENER.open(req, timeout=timeout_seconds)
        except urllib.error.HTTPError as response_error:
            response = response_error
        with response:
            status = response.status
            raw = response.read(MAX_RESPONSE_BYTES + 1)
            response_headers = {name.lower(): value for name, value in response.headers.items()
                                if name.lower() in {"request-id", "x-request-id", "date",
                                                     "content-type", "retry-after"}}
        if len(raw) > MAX_RESPONSE_BYTES:
            raise ProviderRequestError("Token Factory response exceeded the retained byte limit",
                                       code="provider_response_too_large", status=status)
        payload = raw.decode("utf-8")
        if token in payload or any(token in value for value in response_headers.values()):
            raise ProviderRequestError("Token Factory response contained credential material; not retained",
                                       code="provider_credential_echo", status=status)
        try:
            parsed = strict_json_loads(payload)
        except EvidenceError:
            parsed = None
        if parsed is not None and token in json.dumps(parsed, ensure_ascii=False):
            raise ProviderRequestError("Token Factory response contained credential material; not retained",
                                       code="provider_credential_echo", status=status)
        observation.update(state="RESPONSE_RECEIVED", status=status, headers=response_headers,
                           response_body=payload, response_body_sha256=sha256_hex(raw),
                           finished_at=utc_now(), elapsed_seconds=time.monotonic() - started)
        if capture_path:
            atomic_json(capture_path, observation)
        if capture is not None:
            capture.update(observation)
        if status != 200:
            raise ProviderRequestError("Token Factory returned HTTP " + str(status),
                                       code="provider_http_error", status=status)
        if not isinstance(parsed, dict):
            raise ProviderRequestError("Token Factory returned an invalid JSON object",
                                       code="provider_json_invalid", status=status)
    except (urllib.error.URLError, TimeoutError, UnicodeDecodeError, ProviderRequestError) as exc:
        # Never retain arbitrary exception text: URL/auth libraries may include
        # credentials. Any complete, credential-free HTTP response is already saved.
        code = exc.code if isinstance(exc, ProviderRequestError) else "provider_transport_error"
        observation.update(state="FAILED", error=code, status=status,
                           finished_at=utc_now(), elapsed_seconds=time.monotonic() - started)
        if capture_path:
            atomic_json(capture_path, observation)
        if capture is not None:
            capture.update(observation)
        if isinstance(exc, ProviderRequestError):
            raise
        raise ProviderRequestError("Token Factory transport did not complete; inspect the retained operation",
                                   code=code, status=status) from None
    request_id = response_headers.get("request-id") or response_headers.get("x-request-id")
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
    if not _is_nvidia(model):
        raise EvidenceError(
            "competition adapter requires a live NVIDIA/Nemotron model from Token Factory"
        )
    return True


def provider_state():
    """Read the configured account's inventory, without inference or secrets."""
    token = os.environ.get("NEBIUS_API_KEY")
    result = {"configured": bool(token), "default_model": os.environ.get("NEBIUS_MODEL"),
              "models": [], "inventory_status": "not_configured", "observed_at": None,
              "inventory_sha256": None, "message": "Set NEBIUS_API_KEY in the server environment to use the existing account."}
    if not token:
        return result
    try:
        payload = _request_json(_endpoint("/models"), token, timeout_seconds=20)
        if not isinstance(payload.get("data"), list):
            raise EvidenceError("Token Factory inventory missing data[]")
        models = []
        for row in payload["data"]:
            if isinstance(row, dict) and _is_nvidia(row.get("id")):
                models.append({key: row[key] for key in ("id", "owned_by", "context_length", "pricing") if key in row})
        result.update(inventory_status="ready", models=models, observed_at=utc_now(),
                      inventory_sha256=sha256_hex(canonical_bytes(payload)),
                      message="Current account inventory read from Nebius Token Factory.")
        if not models:
            result["message"] = "This inventory returned no NVIDIA/Nemotron models. Select a current enabled NVIDIA model in the existing account."
    except EvidenceError as exc:
        result.update(inventory_status="error", observed_at=utc_now(),
                      message=str(exc), error=getattr(exc, "code", "provider_inventory_invalid"))
    return result


def generate_plan(request_json: str, *, api_key: str | None = None, model: str | None = None,
                  source_context: dict[str, str] | None = None,
                  baseline_evidence: dict[str, Any] | None = None,
                  maximum_output_tokens: int = 4096,
                  timeout_seconds: float = 60,
                  evidence_dir: Path | None = None) -> TokenFactoryResult:
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
    input_context = {"request": request, "allowed_source": context,
                     "observed_baseline": baseline_evidence or {}}
    if context:
        # Tell the model the actual original fixture-runner capabilities. This
        # supplies its execution rules, never the authored corrected solution.
        from .restricted_runner import METHODS, MODULE_EXPORTS, MAX_SOURCE_BYTES
        input_context["execution_constraints"] = {
            "maximum_source_bytes": MAX_SOURCE_BYTES,
            "permitted_module_exports": {name: sorted(exports) for name, exports in MODULE_EXPORTS.items()},
            "permitted_attribute_names": sorted(METHODS),
            "module_top_level": "imports and plain function definitions only",
            "excluded_syntax": ["annotations", "classes", "decorators", "f-strings", "lambda",
                                "with", "async", "yield", "global", "nonlocal", "starred arguments"],
            "excluded_capabilities": ["dunder names", "reflection", "dynamic execution", "file access",
                                      "network access", "process access"],
        }
    user_content = json.dumps(input_context, ensure_ascii=False)
    if len(user_content.encode("utf-8")) > 65536:
        raise EvidenceError("provider input exceeds byte limit")

    token = api_key or os.environ.get("NEBIUS_API_KEY")
    chosen_model = model or os.environ.get("NEBIUS_MODEL")
    if not token:
        raise EvidenceError("NEBIUS_API_KEY is required for provider mode")
    if not chosen_model:
        raise EvidenceError("NEBIUS_MODEL is required; choose a current NVIDIA/Nemotron model")

    evidence_dir = Path(evidence_dir) if evidence_dir is not None else None
    inventory_trace, completion_trace = {}, {}
    inventory_kwargs = ({"capture": inventory_trace, "capture_path": evidence_dir / "provider-inventory.json"}
                        if evidence_dir is not None else {})
    inventory = _request_json(_endpoint("/models"), token, timeout_seconds=timeout_seconds,
                              **inventory_kwargs)
    _nvidia_model_present(inventory, chosen_model)

    system = (
        "You are EvidenceForge's untrusted planning model. Return JSON only. "
        "The object must have exactly keys summary and operations. "
        'Each operation must be one of {"kind":"read","path":"..."}, '
        '{"kind":"write","path":"...","content":"..."}, or '
        '{"kind":"test","name":"..."}, with exactly those keys. '
        "summary must be nonempty text; operations must be a JSON array. "
        "Never invent paths/tests outside the human request. Never claim approval, "
        "deployment, payment, or external authority. Finish every write before any test. "
        "When allowed Python source is supplied, preserve its pure-function style: "
        "only its existing imported libraries, no annotations, classes, decorators, "
        "f-strings, reflection, dunder identifiers, file/network/process operations. "
        "Run every required test exactly "
        "once and in the request order."
    )
    body = {
        "model": chosen_model,
        "temperature": 0,
        "max_tokens": maximum_output_tokens,
        "response_format": {"type": "json_object"},
        "n": 1,
        "stream": False,
        "store": False,
        "service_tier": "default",
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user_content},
        ],
    }
    completion_kwargs = ({"capture": completion_trace, "capture_path": evidence_dir / "provider-api.json"}
                         if evidence_dir is not None else {})
    response = _request_json(_endpoint("/chat/completions"), token, body=body,
                             timeout_seconds=timeout_seconds, **completion_kwargs)
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
    usage = dict(raw_usage)
    for key in ("prompt_tokens", "completion_tokens", "total_tokens"):
        if key in usage and (type(usage[key]) is not int or usage[key] < 0):
            raise EvidenceError("Token Factory returned invalid token usage")
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
        service_tier=response.get("service_tier"),
        observed_at=completion_trace.get("finished_at"),
        request_body_sha256=completion_trace.get("request_body_sha256"),
        response_body_sha256=completion_trace.get("response_body_sha256"),
        inventory_sha256=inventory_trace.get("response_body_sha256"),
        api_record_sha256=(sha256_hex((evidence_dir / "provider-api.json").read_bytes())
                           if evidence_dir is not None else None),
        cost={"status": "returned" if any(key in response or key in raw_usage for key in
              ("cost", "cost_usd", "total_cost", "total_cost_usd")) else "not_returned",
              "reported": {scope: {key: obj[key] for key in ("cost", "cost_usd", "total_cost", "total_cost_usd")
                                   if key in obj} for scope, obj in (("response", response), ("usage", raw_usage))}},
    )
