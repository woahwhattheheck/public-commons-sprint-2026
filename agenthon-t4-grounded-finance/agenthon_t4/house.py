from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Callable

from .agent import ContractError, CorpusDoc, Evidence, retrieve, strict_json_text

_JSON_FENCE = re.compile(r"```(?:json)?\s*(\{.*\})\s*```", re.DOTALL | re.IGNORECASE)
MAX_HOUSE_RESPONSE_BYTES = 1_000_000


class NoRedirect(urllib.request.HTTPRedirectHandler):
    """Refuse redirects so the organizer bearer token cannot be forwarded."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def _endpoint() -> tuple[str, str, str] | None:
    base = os.environ.get("MODEL_ENDPOINT", "").strip().rstrip("/")
    token = os.environ.get("MODEL_TOKEN", "").strip()
    model = os.environ.get("MODEL_NAME", "").strip()
    if not (base and token and model):
        return None
    parsed = urllib.parse.urlsplit(base)
    if (parsed.scheme != "https" or not parsed.hostname or parsed.username is not None
            or parsed.password is not None or parsed.query or parsed.fragment):
        return None
    return base + "/v1/chat/completions", token, model


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


def plan(task: dict[str, Any], docs: list[CorpusDoc], *, timeout: float = 35.0,
         transport: Callable[..., Any] | None = None) -> dict[str, Any] | None:
    """Ask only the organizer House route for prediction numbers/labels.

    Evidence identity and citation spans are never accepted from model output. They are
    derived independently from the frozen corpus by deterministic retrieval.
    """
    config = _endpoint()
    if config is None:
        return None
    url, token, model = config
    evidence_by_entity: dict[str, list[dict[str, Any]]] = {}
    for entity in task["entities"]:
        spans: list[Evidence] = retrieve(task, entity, docs)
        evidence_by_entity[entity["entity_id"]] = [
            {"doc_id": item.doc_id, "span_start": item.span_start, "span_end": item.span_end, "text": item.text}
            for item in spans
        ]
    system = (
        "You are a bounded quantitative-finance prediction component. Use ONLY the supplied frozen task, roster and evidence spans. "
        "Never invent citations, documents or post-cutoff facts. Return one JSON object and no prose: "
        '{"entity_predictions":[{"entity_id":str,"label":str|null,"point_forecast":number,"lo":number,"hi":number}]}. '
        "For classification, label must be one of task.target.labels. For regression/ranking set label null. "
        "Intervals must be finite and ordered. Do not include resolved outcomes you were not given."
    )
    user_payload = {
        "task": {"task_id": task["task_id"], "prompt": task.get("prompt", ""), "cutoff_date": task["cutoff_date"], "interval_level": task["interval_level"], "target": task.get("target", {})},
        "entities": task["entities"],
        "evidence": evidence_by_entity,
    }
    try:
        body = json.dumps({
            "model": model,
            "temperature": 0,
            "max_tokens": min(4000, max(800, 160 * len(task["entities"]))),
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": json.dumps(
                    user_payload, sort_keys=True, separators=(",", ":"), allow_nan=False
                )},
            ],
        }, separators=(",", ":"), allow_nan=False).encode("utf-8")
    except (ValueError, TypeError, OverflowError):
        return None
    request = urllib.request.Request(url, data=body, method="POST", headers={
        "Authorization": f"Bearer {token}", "Content-Type": "application/json", "Accept": "application/json"
    })
    open_request = transport or urllib.request.build_opener(NoRedirect()).open
    try:
        with open_request(request, timeout=timeout) as response:
            if response.status != 200:
                return None
            raw_bytes = response.read(MAX_HOUSE_RESPONSE_BYTES + 1)
            if len(raw_bytes) > MAX_HOUSE_RESPONSE_BYTES:
                return None
        raw = strict_json_text(raw_bytes.decode("utf-8"), max_bytes=MAX_HOUSE_RESPONSE_BYTES)
        content = raw["choices"][0]["message"]["content"]
        if not isinstance(content, str):
            return None
        return _parse_content(content)
    except (ContractError, UnicodeDecodeError, OSError, KeyError, IndexError, TypeError,
            ValueError, urllib.error.URLError):
        return None
