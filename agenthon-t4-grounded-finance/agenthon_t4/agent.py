from __future__ import annotations

import json
import math
import os
import re
import tempfile
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any, Iterable

MAX_CORPUS_FILES = 4096
MAX_CORPUS_BYTES = 256 * 1024 * 1024
MAX_DOC_BYTES = 8 * 1024 * 1024
MAX_EVIDENCE_PER_ENTITY = 3
MAX_SPAN_CHARS = 900
_TOKEN_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._%+-]*")
_SENTENCE_RE = re.compile(r"\S(?:.*?)(?:[.!?](?=\s|$)|$)", re.DOTALL)
_STOP = frozenset("a an and are as at be by for from given in into is it of on or predict support that the their this to with will whether each table below above".split())

class ContractError(ValueError):
    pass

def _strict_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key, value in pairs:
        if key in out:
            raise ContractError(f"duplicate JSON key: {key}")
        out[key] = value
    return out

def load_json(path: Path, *, max_bytes: int = MAX_DOC_BYTES) -> Any:
    if path.is_symlink():
        raise ContractError(f"symlink input refused: {path}")
    stat = path.stat()
    if not path.is_file():
        raise ContractError(f"regular file required: {path}")
    if stat.st_size > max_bytes:
        raise ContractError(f"input exceeds byte limit: {path}")
    try:
        return json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=_strict_object)
    except UnicodeDecodeError as exc:
        raise ContractError(f"UTF-8 required: {path}") from exc
    except json.JSONDecodeError as exc:
        raise ContractError(f"invalid JSON: {path}: {exc}") from exc

def _iso_day(value: Any, field: str) -> str:
    if not isinstance(value, str):
        raise ContractError(f"{field} must be an ISO date string")
    try:
        return date.fromisoformat(value).isoformat()
    except ValueError as exc:
        raise ContractError(f"{field} must be YYYY-MM-DD") from exc

def _finite_number(value: Any, field: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ContractError(f"{field} must be numeric")
    result = float(value)
    if not math.isfinite(result):
        raise ContractError(f"{field} must be finite")
    return result

def _tokens(value: str) -> list[str]:
    return [tok.lower() for tok in _TOKEN_RE.findall(value) if tok.lower() not in _STOP]

@dataclass(frozen=True)
class CorpusDoc:
    doc_id: str
    doc_date: str
    text: str
    title: str
    ticker: str
    path: str

@dataclass(frozen=True)
class Evidence:
    doc_id: str
    span_start: int
    span_end: int
    text: str
    score: float
    doc_date: str

def validate_task(task: Any) -> dict[str, Any]:
    if not isinstance(task, dict):
        raise ContractError("task root must be an object")
    task_id = task.get("task_id")
    if not isinstance(task_id, str) or not task_id:
        raise ContractError("task_id is required")
    cutoff = _iso_day(task.get("cutoff_date"), "cutoff_date")
    interval_level = _finite_number(task.get("interval_level"), "interval_level")
    if not 0.0 < interval_level < 1.0:
        raise ContractError("interval_level must be between 0 and 1")
    target = task.get("target")
    if not isinstance(target, dict):
        raise ContractError("target object is required")
    target_type = task.get("target_type") or target.get("type")
    if target_type not in {"classification", "regression", "ranking"}:
        raise ContractError("unsupported target type")
    labels = target.get("labels", [])
    if labels is None:
        labels = []
    if not isinstance(labels, list) or any(not isinstance(x, str) or not x for x in labels):
        raise ContractError("target.labels must be a list of non-empty strings")
    if target_type == "classification" and not labels:
        raise ContractError("classification target requires labels")
    entities = task.get("entities")
    if not isinstance(entities, list) or not entities:
        raise ContractError("entities must be a non-empty list")
    ids: set[str] = set()
    for row in entities:
        if not isinstance(row, dict):
            raise ContractError("entity row must be an object")
        eid = row.get("entity_id")
        if not isinstance(eid, str) or not eid:
            raise ContractError("entity_id is required")
        if eid in ids:
            raise ContractError(f"duplicate entity_id: {eid}")
        ids.add(eid)
    normalized = dict(task)
    normalized["cutoff_date"] = cutoff
    normalized["interval_level"] = interval_level
    normalized["_target_type"] = target_type
    normalized["_labels"] = list(labels)
    return normalized

def load_corpus(corpus_dir: Path, cutoff: str) -> list[CorpusDoc]:
    if corpus_dir.is_symlink() or not corpus_dir.is_dir():
        raise ContractError("corpus must be a regular directory")
    # The organizer ships corpus/manifest.json as an index in most public units. It is not
    # a citable document and must never enter retrieval or citation resolution.
    paths = sorted(path for path in corpus_dir.glob("*.json") if path.name != "manifest.json")
    if not paths:
        return []
    if len(paths) > MAX_CORPUS_FILES:
        raise ContractError("corpus file count exceeds limit")
    total = 0
    docs: list[CorpusDoc] = []
    seen: set[str] = set()
    for path in paths:
        if path.is_symlink():
            raise ContractError(f"symlink corpus file refused: {path.name}")
        total += path.stat().st_size
        if total > MAX_CORPUS_BYTES:
            raise ContractError("corpus byte total exceeds limit")
        raw = load_json(path)
        if not isinstance(raw, dict):
            raise ContractError(f"corpus document must be an object: {path.name}")
        # QFBench citation resolution keys documents by the manifest-declared filename stem.
        # The public files currently repeat that value inside the JSON, but the filename is
        # authoritative and avoids trusting redundant participant-visible metadata.
        doc_id = path.stem
        if doc_id in seen:
            raise ContractError(f"duplicate doc_id: {doc_id}")
        seen.add(doc_id)
        doc_date = _iso_day(raw.get("doc_date"), f"{doc_id}.doc_date")
        text = raw.get("text")
        if not isinstance(text, str) or not text.strip():
            spans = raw.get("spans")
            if not isinstance(spans, list) or not spans:
                raise ContractError(f"{doc_id} requires text or non-empty spans")
            parts: list[str] = []
            for idx, span in enumerate(spans):
                if not isinstance(span, dict) or not isinstance(span.get("text"), str):
                    raise ContractError(f"{doc_id}.spans[{idx}].text must be a string")
                parts.append(span["text"])
            text = " ".join(parts)
            if not text.strip():
                raise ContractError(f"{doc_id}.spans resolve to empty text")
        if doc_date > cutoff:
            continue
        docs.append(CorpusDoc(doc_id, doc_date, text, str(raw.get("title", "")), str(raw.get("ticker", "")), path.name))
    return docs

def _sentences(doc: CorpusDoc) -> Iterable[tuple[int, int, str]]:
    for match in _SENTENCE_RE.finditer(doc.text):
        start, end = match.span()
        raw = doc.text[start:end]
        if not raw.strip():
            continue
        left = len(raw) - len(raw.lstrip())
        right = len(raw.rstrip())
        exact_start = start + left
        exact_end = start + right
        yield exact_start, exact_end, doc.text[exact_start:exact_end]

def _query_terms(task: dict[str, Any], entity: dict[str, Any]) -> tuple[set[str], set[str]]:
    identity = " ".join(str(entity.get(k, "")) for k in ("entity_id", "name", "sector"))
    prompt = " ".join([str(task.get("prompt", "")), str((task.get("target") or {}).get("name", "")), "earnings revenue margin guidance forecast consensus estimate risk cash flow debt credit"])
    return set(_tokens(identity)), set(_tokens(prompt))

def retrieve(task: dict[str, Any], entity: dict[str, Any], docs: list[CorpusDoc]) -> list[Evidence]:
    identity_terms, context_terms = _query_terms(task, entity)
    ticker = str(entity.get("entity_id", "")).lower()
    scored: list[Evidence] = []
    for doc in docs:
        doc_identity_bonus = 4.0 if ticker and doc.ticker.lower() == ticker else 0.0
        for start, end, text in _sentences(doc):
            span = text[:MAX_SPAN_CHARS]
            end = start + len(span)
            terms = set(_tokens(span))
            if not terms:
                continue
            ident_hits = len(identity_terms & terms)
            context_hits = len(context_terms & terms)
            numeric_bonus = min(2.0, 0.4 * sum(ch.isdigit() for ch in span))
            recency = date.fromisoformat(doc.doc_date).toordinal() / 1_000_000.0
            # Short fragments remain eligible as a fail-safe, but substantive premises rank far
            # above abbreviation/name-only sentences for the downstream NLI faithfulness gate.
            length_bonus = min(len(span), 240) / 80.0
            short_penalty = 20.0 if len(span) < 80 else 0.0
            score = (
                doc_identity_bonus
                + 5.0 * ident_hits
                + 1.25 * context_hits
                + numeric_bonus
                + recency
                + length_bonus
                - short_penalty
            )
            scored.append(Evidence(doc.doc_id, start, end, doc.text[start:end], score, doc.doc_date))
    scored.sort(key=lambda e: (-e.score, e.doc_id, e.span_start, e.span_end))
    chosen: list[Evidence] = []
    seen: set[tuple[str, int, int]] = set()
    for item in scored:
        key = (item.doc_id, item.span_start, item.span_end)
        if key in seen:
            continue
        chosen.append(item)
        seen.add(key)
        if len(chosen) >= MAX_EVIDENCE_PER_ENTITY:
            break
    if not chosen:
        # No embargo-eligible premise exists. A post-cutoff citation would be worse: it is an
        # explicit embargo violation. Emit a schema-shaped unresolved marker so the container
        # still writes answer.json and exits cleanly; this unit is expected to fail citation
        # admission, but never by leaking or citing future evidence.
        return [Evidence("NO_ELIGIBLE_EVIDENCE", 0, 0, "No embargo-eligible evidence available.", -1e9, task["cutoff_date"])]
    return chosen

def _numeric_anchor(entity: dict[str, Any], task: dict[str, Any]) -> float:
    target_name = str((task.get("target") or {}).get("name", ""))
    for key in [target_name, f"consensus_{target_name}", "consensus_eps", "consensus", "estimate", "point_estimate", "value", "score"]:
        value = entity.get(key)
        if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(float(value)):
            return float(value)
    for key in sorted(entity):
        value = entity[key]
        if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(float(value)):
            return float(value)
    return 0.0

def _fallback_candidate(task: dict[str, Any], entity: dict[str, Any]) -> dict[str, Any]:
    point = _numeric_anchor(entity, task)
    label = None
    if task["_target_type"] == "classification":
        label = "inline" if "inline" in task["_labels"] else task["_labels"][0]
    width = max(abs(point) * 0.12, 0.10)
    return {"entity_id": entity["entity_id"], "label": label, "point_forecast": point, "lo": point - width, "hi": point + width}

def _candidate_from_model(task: dict[str, Any], entity: dict[str, Any], raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict) or raw.get("entity_id") != entity["entity_id"]:
        return None
    try:
        point = _finite_number(raw.get("point_forecast"), "model.point_forecast")
        lo = _finite_number(raw.get("lo"), "model.lo")
        hi = _finite_number(raw.get("hi"), "model.hi")
    except ContractError:
        return None
    if lo > hi:
        lo, hi = hi, lo
    label = raw.get("label")
    if task["_target_type"] == "classification":
        if label not in task["_labels"]:
            return None
    else:
        label = None
    return {"entity_id": entity["entity_id"], "label": label, "point_forecast": point, "lo": lo, "hi": hi}

def _claims(evidence: list[Evidence]) -> list[dict[str, Any]]:
    return [{"doc_id": ev.doc_id, "span_start": ev.span_start, "span_end": ev.span_end, "claim": ev.text} for ev in evidence]

def build_answer(task: dict[str, Any], docs: list[CorpusDoc], model_candidates: dict[str, Any] | None = None) -> dict[str, Any]:
    predictions: list[dict[str, Any]] = []
    evidence_total = 0
    for entity in task["entities"]:
        evidence = retrieve(task, entity, docs)
        evidence_total += len(evidence)
        candidate = _candidate_from_model(task, entity, model_candidates.get(entity["entity_id"])) if model_candidates is not None else None
        if candidate is None:
            candidate = _fallback_candidate(task, entity)
        row: dict[str, Any] = {
            "entity_id": entity["entity_id"],
            "point_forecast": candidate["point_forecast"],
            "interval": {"level": task["interval_level"], "lo": candidate["lo"], "hi": candidate["hi"]},
            "claims": _claims(evidence),
        }
        if task["_target_type"] == "classification":
            row["label"] = candidate["label"]
        predictions.append(row)
    return {
        "task_id": task["task_id"],
        "schema_version": "3",
        "target_type": task["_target_type"],
        "entity_predictions": predictions,
        "evidence_trace": f"Embargo-filtered deterministic retrieval over {len(docs)} eligible corpus documents; {evidence_total} exact source span(s) retained for {len(predictions)} roster entities. House candidate used only when available and contract-valid; otherwise deterministic fallback.",
    }

def atomic_write_json(path: Path, value: Any) -> None:
    if path.exists() and path.is_symlink():
        raise ContractError("output symlink refused")
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False) + "\n"
    fd, tmp_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=str(path.parent), text=True)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(payload)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp_name, path)
    finally:
        try:
            os.unlink(tmp_name)
        except FileNotFoundError:
            pass

def run(task_path: Path, corpus_dir: Path, out_path: Path, *, model_candidates: dict[str, Any] | None = None) -> dict[str, Any]:
    task = validate_task(load_json(task_path))
    docs = load_corpus(corpus_dir, task["cutoff_date"])
    answer = build_answer(task, docs, model_candidates=model_candidates)
    atomic_write_json(out_path, answer)
    return answer
