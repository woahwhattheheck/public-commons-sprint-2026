from __future__ import annotations

import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Callable

from .agent import ContractError, CorpusDoc, Evidence, RetrievalIndex, strict_json_text

_JSON_FENCE = re.compile(r"```(?:json)?\s*(\{.*\})\s*```", re.DOTALL | re.IGNORECASE)
MAX_HOUSE_RESPONSE_BYTES = 1_000_000


class NoRedirect(urllib.request.HTTPRedirectHandler):
    """Refuse redirects so the organizer bearer token cannot be forwarded."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def _endpoint() -> tuple[str, str, str] | None:
    base = os.environ.get("MODEL_ENDPOINT", "").strip()
    token = os.environ.get("MODEL_TOKEN", "").strip()
    model = os.environ.get("MODEL_NAME", "").strip()
    if not (base and token and model):
        return None
    # The organizer injects an origin (including HTTP inside the audited network).
    # Preserve that scheme; do not rewrite it or bypass the environment's proxy.
    # Contract: Agenthon-2026/Agenthon2026-public/docs/HOUSE-MODEL.md.
    if any(char.isspace() or ord(char) < 32 or ord(char) == 127 for char in base):
        return None
    try:
        parsed = urllib.parse.urlsplit(base)
        port = parsed.port  # Validate malformed/out-of-range ports before any request.
    except ValueError:
        return None
    if (parsed.scheme not in {"http", "https"} or not parsed.hostname
            or parsed.username is not None or parsed.password is not None
            or parsed.path not in {"", "/"} or "?" in base or "#" in base
            or port == 0):
        return None
    return base.rstrip("/") + "/v1/chat/completions", token, model


def _parse_content(content: str) -> dict[str, Any] | None:
    text = content.strip()
    match = _JSON_FENCE.fullmatch(text)
    if match:
        text = match.group(1)
    try:
        value = strict_json_text(text, max_bytes=MAX_HOUSE_RESPONSE_BYTES)
    except (ContractError, TypeError):
        return None
    if not isinstance(value, dict) or not isinstance(value.get("entity_predictions"), list):
        return None
    out: dict[str, Any] = {}
    for row in value["entity_predictions"]:
        if not isinstance(row, dict):
            return None
        eid = row.get("entity_id")
        if not isinstance(eid, str) or not eid or eid in out:
            return None
        out[eid] = row
    return out


MAX_HOUSE_REQUESTS_PER_UNIT = 25  # Track 4 official House allocation.
MAX_ENTITIES_PER_HOUSE_REQUEST = 10
MAX_HOUSE_PLAN_SECONDS = 420.0  # Reserve part of the 600s unit clock for output.


def plan(task: dict[str, Any], docs: list[CorpusDoc], *, timeout: float = 35.0,
         transport: Callable[..., Any] | None = None) -> dict[str, Any] | None:
    """Request bounded roster slices, never exceeding the per-unit House budget.

    Every slice uses the same frozen task/corpus generation. Failures retain earlier
    usable predictions, while deterministic fallback handles unresolved entities.
    No House retry is issued, even for transient failures or truncated responses.
    """
    config = _endpoint()
    if config is None:
        return None
    url, token, model = config
    retrieval = RetrievalIndex(docs)
    open_request = transport or urllib.request.build_opener(NoRedirect()).open
    started = time.monotonic()
    predictions: dict[str, Any] = {}
    entities = task["entities"]
    budgeted = min(len(entities), MAX_HOUSE_REQUESTS_PER_UNIT * MAX_ENTITIES_PER_HOUSE_REQUEST)
    system = (
        "You are a bounded quantitative-finance prediction component. Use ONLY the supplied frozen task, roster and evidence spans. "
        "Never invent citations, documents or post-cutoff facts. Return one JSON object and no prose: "
        '{"entity_predictions":[{"entity_id":str,"label":str|null,"point_forecast":number,"lo":number,"hi":number}]}. '
        "For classification, label must be one of task.target.labels. For regression/ranking set label null. "
        "Intervals must be finite and ordered. Do not include resolved outcomes you were not given."
    )
    task_context = {
        "task_id": task["task_id"], "prompt": task.get("prompt", ""),
        "cutoff_date": task["cutoff_date"], "interval_level": task["interval_level"],
        "target": task.get("target", {}),
    }
    for start in range(0, budgeted, MAX_ENTITIES_PER_HOUSE_REQUEST):
        remaining = MAX_HOUSE_PLAN_SECONDS - (time.monotonic() - started)
        if remaining <= 1.0:
            break
        batch = entities[start:start + MAX_ENTITIES_PER_HOUSE_REQUEST]
        evidence_by_entity: dict[str, list[dict[str, Any]]] = {}
        for entity in batch:
            spans: list[Evidence] = retrieval.retrieve(task, entity)
            evidence_by_entity[entity["entity_id"]] = [
                {"doc_id": item.doc_id, "span_start": item.span_start,
                 "span_end": item.span_end, "text": item.text}
                for item in spans
            ]
        user_payload = {"task": task_context, "entities": batch, "evidence": evidence_by_entity}
        try:
            body = json.dumps({
                "model": model,
                "temperature": 0,
                "max_tokens": min(4000, max(800, 200 * len(batch))),
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": json.dumps(
                        user_payload, sort_keys=True, separators=(",", ":"), allow_nan=False
                    )},
                ],
            }, separators=(",", ":"), allow_nan=False).encode("utf-8")
            request = urllib.request.Request(url, data=body, method="POST", headers={
                "Authorization": f"Bearer {token}", "Content-Type": "application/json",
                "Accept": "application/json",
            })
            # Total planning time stays below the per-unit 600-second deadline.
            with open_request(request, timeout=min(timeout, remaining)) as response:
                if response.status != 200:
                    break
                raw_bytes = response.read(MAX_HOUSE_RESPONSE_BYTES + 1)
                if len(raw_bytes) > MAX_HOUSE_RESPONSE_BYTES:
                    break
            raw = strict_json_text(raw_bytes.decode("utf-8"), max_bytes=MAX_HOUSE_RESPONSE_BYTES)
            content = raw["choices"][0]["message"]["content"]
            if not isinstance(content, str):
                break
            parsed = _parse_content(content)
            if parsed is None:
                break
            matched = False
            for entity in batch:
                entity_id = entity["entity_id"]
                if entity_id in parsed:
                    predictions[entity_id] = parsed[entity_id]
                    matched = True
            if not matched:
                break
        except (ContractError, UnicodeDecodeError, OSError, KeyError, IndexError,
                TypeError, ValueError, urllib.error.URLError):
            break
    return predictions or None
