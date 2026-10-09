from __future__ import annotations

import heapq
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
MAX_JSON_DEPTH = 64
MAX_JSON_NODES = 50_000
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

def _reject_constant(value: str) -> Any:
    raise ContractError(f"non-finite JSON number rejected: {value}")

def _strict_float_token(value: str) -> float:
    try:
        result = float(value)
    except (OverflowError, ValueError) as exc:
        raise ContractError("invalid JSON number") from exc
    if not math.isfinite(result):
        raise ContractError("non-finite JSON number rejected")
    return result

def _check_json_shape(value: Any) -> None:
    remaining = MAX_JSON_NODES
    stack: list[tuple[Any, int]] = [(value, 0)]
    while stack:
        item, depth = stack.pop()
        remaining -= 1
        if remaining < 0 or depth > MAX_JSON_DEPTH:
            raise ContractError("JSON structure exceeds limits")
        if isinstance(item, dict):
            stack.extend((child, depth + 1) for child in item.values())
        elif isinstance(item, list):
            stack.extend((child, depth + 1) for child in item)

def strict_json_text(text: str, *, max_bytes: int = MAX_DOC_BYTES) -> Any:
    if not isinstance(text, str):
        raise ContractError("JSON text must be a string")
    try:
        encoded = text.encode("utf-8")
    except UnicodeEncodeError as exc:
        raise ContractError("JSON must be valid UTF-8 text") from exc
    if len(encoded) > max_bytes:
        raise ContractError("JSON text exceeds byte limit")
    try:
        value = json.loads(
            text,
            object_pairs_hook=_strict_object,
            parse_constant=_reject_constant,
            parse_float=_strict_float_token,
        )
    except ContractError:
        raise
    except (json.JSONDecodeError, RecursionError, ValueError) as exc:
        raise ContractError(f"invalid JSON: {exc}") from exc
    _check_json_shape(value)
    return value

def load_json(path: Path, *, max_bytes: int = MAX_DOC_BYTES) -> Any:
    if path.is_symlink():
        raise ContractError(f"symlink input refused: {path}")
    stat = path.stat()
    if not path.is_file():
        raise ContractError(f"regular file required: {path}")
    if stat.st_size > max_bytes:
        raise ContractError(f"input exceeds byte limit: {path}")
    try:
        text = path.read_text(encoding="utf-8")
    except UnicodeDecodeError as exc:
        raise ContractError(f"UTF-8 required: {path}") from exc
    return strict_json_text(text, max_bytes=max_bytes)

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
    try:
        result = float(value)
    except (OverflowError, ValueError, TypeError) as exc:
        raise ContractError(f"{field} must be finite") from exc
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
    entity_ids: frozenset[str] | None = None
    shared: bool = False
    scope_enforced: bool = False

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

def _manifest_scope(corpus_dir: Path) -> dict[str, tuple[frozenset[str] | None, bool]] | None:
    """Load trusted unit-root corpus role and entity scope, not corpus/manifest.json.

    The official scorer cites only manifest-declared corpus members. Every declared
    document is either labelled for one or more entities, marked shared, or barred.
    Units without a root manifest retain the standalone/legacy retrieval API.
    """
    manifest_path = corpus_dir.parent / "manifest.json"
    if not manifest_path.exists() and not manifest_path.is_symlink():
        return None
    manifest = load_json(manifest_path)
    if not isinstance(manifest, dict) or not isinstance(manifest.get("files"), list):
        raise ContractError("unit-root manifest requires files[]")
    scopes: dict[str, tuple[frozenset[str] | None, bool]] = {}
    for row in manifest["files"]:
        if not isinstance(row, dict):
            raise ContractError("manifest file entry must be an object")
        if row.get("role") != "corpus":
            continue
        relative = row.get("path")
        if (not isinstance(relative, str)
                or len(Path(relative).parts) != 2
                or Path(relative).parts[0] != "corpus"
                or not relative.endswith(".json")
                or Path(relative).name == "manifest.json"):
            raise ContractError("manifest corpus path must be corpus/<document>.json")
        filename = Path(relative).name
        if filename in scopes:
            raise ContractError(f"duplicate manifest corpus path: {filename}")
        entity_ids = row.get("entity_ids")
        if entity_ids is not None and (
            not isinstance(entity_ids, list)
            or any(not isinstance(eid, str) or not eid for eid in entity_ids)
        ):
            raise ContractError(f"{filename}.entity_ids must be a list of strings")
        shared = row.get("shared")
        if shared is not None and shared is not True:
            raise ContractError(f"{filename}.shared must be true when present")
        scopes[filename] = (
            frozenset(entity_ids) if entity_ids is not None else None,
            shared is True,
        )
    return scopes

def load_corpus(corpus_dir: Path, cutoff: str) -> list[CorpusDoc]:
    if corpus_dir.is_symlink() or not corpus_dir.is_dir():
        raise ContractError("corpus must be a regular directory")
    # Unit-root manifest.json is the scorer's authority for citation membership and
    # entity_ids/shared labels; corpus/manifest.json is merely an uncitable index.
    scopes = _manifest_scope(corpus_dir)
    paths = sorted(path for path in corpus_dir.glob("*.json") if path.name != "manifest.json")
    if not paths:
        if scopes:
            raise ContractError("manifest-declared corpus documents are missing")
        return []
    if len(paths) > MAX_CORPUS_FILES:
        raise ContractError("corpus file count exceeds limit")
    total = 0
    docs: list[CorpusDoc] = []
    seen: set[str] = set()
    manifest_seen: set[str] = set()
    for path in paths:
        if scopes is not None and path.name not in scopes:
            continue  # Unmanifested files can never resolve as official citations.
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
        manifest_seen.add(path.name)
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
        ids, shared = scopes[path.name] if scopes is not None else (None, False)
        docs.append(CorpusDoc(doc_id, doc_date, text, str(raw.get("title", "")), str(raw.get("ticker", "")), path.name,
                              ids, shared, scopes is not None))
    if scopes is not None and scopes.keys() - manifest_seen:
        raise ContractError("manifest-declared corpus documents are missing")
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

def _evidence_windows(doc: CorpusDoc) -> Iterable[tuple[int, int, str]]:
    """Cover whole sentences with overlapping, exact-source bounded passages."""
    overlap = MAX_SPAN_CHARS // 5
    for sentence_start, sentence_end, _ in _sentences(doc):
        cursor = sentence_start
        while cursor < sentence_end:
            end = min(cursor + MAX_SPAN_CHARS, sentence_end)
            # Prefer a word boundary, retaining overlap so boundary words are not lost.
            if end < sentence_end:
                boundary = doc.text.rfind(" ", cursor + MAX_SPAN_CHARS - overlap, end)
                if boundary != -1:
                    end = boundary
            raw = doc.text[cursor:end]
            start = cursor + len(raw) - len(raw.lstrip())
            stop = end - (len(raw) - len(raw.rstrip()))
            if start < stop:
                yield start, stop, doc.text[start:stop]
            if end == sentence_end:
                break
            cursor = end - overlap


@dataclass(frozen=True, slots=True)
class _IndexedSpan:
    doc: CorpusDoc
    start: int
    end: int
    terms: frozenset[str]
    numeric_bonus: float
    recency: float
    length_bonus: float
    short_penalty: float
    text_key: str


class RetrievalIndex:
    """Invocation-local prepared corpus; no disk cache or cross-task retained state."""

    def __init__(self, docs: list[CorpusDoc]):
        spans: list[_IndexedSpan] = []
        for doc in docs:
            recency = date.fromisoformat(doc.doc_date).toordinal() / 1_000_000.0
            for start, end, text in _evidence_windows(doc):
                terms = frozenset(_tokens(text))
                if terms:
                    spans.append(_IndexedSpan(
                        doc, start, end, terms,
                        min(2.0, 0.4 * sum(ch.isdigit() for ch in text)),
                        recency, min(len(text), 240) / 80.0,
                        20.0 if len(text) < 80 else 0.0,
                        " ".join(text.split()),
                    ))
        self.spans = tuple(spans)

    def retrieve(self, task: dict[str, Any], entity: dict[str, Any]) -> list[Evidence]:
        identity_terms, context_terms = _query_terms(task, entity)
        entity_id = str(entity.get("entity_id", ""))
        ticker = entity_id.lower()
        ranked: list[tuple[float, str, int, int, int]] = []
        for index, span in enumerate(self.spans):
            if span.doc.scope_enforced and not (
                span.doc.shared or (span.doc.entity_ids is not None and entity_id in span.doc.entity_ids)
            ):
                continue
            # Reapply the cutoff when querying too, so a prepared index cannot widen it.
            if span.doc.doc_date > task["cutoff_date"]:
                continue
            doc_identity_bonus = 4.0 if ticker and span.doc.ticker.lower() == ticker else 0.0
            score = (
                doc_identity_bonus
                + 5.0 * len(identity_terms & span.terms)
                + 1.25 * len(context_terms & span.terms)
                + span.numeric_bonus
                + span.recency
                + span.length_bonus
                - span.short_penalty
            )
            ranked.append((-score, span.doc.doc_id, span.start, span.end, index))
        # Heap ordering preserves the original score/doc/offset tie-break without sorting
        # every candidate when only a few non-redundant passages are needed.
        heapq.heapify(ranked)
        chosen: list[Evidence] = []
        seen_text: set[str] = set()
        while ranked and len(chosen) < MAX_EVIDENCE_PER_ENTITY:
            negative_score, _, _, _, index = heapq.heappop(ranked)
            span = self.spans[index]
            if span.text_key in seen_text:
                continue
            redundant = any(
                item.doc_id == span.doc.doc_id
                and max(0, min(item.span_end, span.end) - max(item.span_start, span.start))
                >= 0.8 * min(item.span_end - item.span_start, span.end - span.start)
                for item in chosen
            )
            if redundant:
                continue
            chosen.append(Evidence(
                span.doc.doc_id, span.start, span.end,
                span.doc.text[span.start:span.end], -negative_score, span.doc.doc_date,
            ))
            seen_text.add(span.text_key)
        if not chosen:
            return [Evidence("NO_ELIGIBLE_EVIDENCE", 0, 0, "No embargo-eligible evidence available.", -1e9, task["cutoff_date"])]
        return chosen


def retrieve(task: dict[str, Any], entity: dict[str, Any], docs: list[CorpusDoc]) -> list[Evidence]:
    # Preserve the public single-entity API; roster callers share one index below.
    return RetrievalIndex(docs).retrieve(task, entity)

def _numeric_anchor(entity: dict[str, Any], task: dict[str, Any]) -> float:
    target_name = str((task.get("target") or {}).get("name", ""))
    for key in [target_name, f"consensus_{target_name}", "consensus_eps", "consensus", "estimate", "point_estimate", "value", "score"]:
        value = entity.get(key)
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            return _finite_number(value, f"entity.{key}")
    for key in sorted(entity):
        value = entity[key]
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            return _finite_number(value, f"entity.{key}")
    return 0.0

def _fallback_candidate(task: dict[str, Any], entity: dict[str, Any]) -> dict[str, Any]:
    point = _numeric_anchor(entity, task)
    label = None
    if task["_target_type"] == "classification":
        label = "inline" if "inline" in task["_labels"] else task["_labels"][0]
    width = max(abs(point) * 0.12, 0.10)
    lo, hi = point - width, point + width
    if not all(math.isfinite(number) for number in (width, lo, hi)):
        raise ContractError("fallback interval must remain finite")
    return {"entity_id": entity["entity_id"], "label": label, "point_forecast": point, "lo": lo, "hi": hi}

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
    # The diagnostic no-evidence sentinel is not a real manifest document or valid citation.
    return [{"doc_id": ev.doc_id, "span_start": ev.span_start, "span_end": ev.span_end, "claim": ev.text}
            for ev in evidence if ev.doc_id != "NO_ELIGIBLE_EVIDENCE"]

def build_answer(task: dict[str, Any], docs: list[CorpusDoc], model_candidates: dict[str, Any] | None = None) -> dict[str, Any]:
    predictions: list[dict[str, Any]] = []
    evidence_total = 0
    retrieval = RetrievalIndex(docs)
    for entity in task["entities"]:
        evidence = retrieval.retrieve(task, entity)
        evidence_total += sum(ev.doc_id != "NO_ELIGIBLE_EVIDENCE" for ev in evidence)
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
    try:
        payload = json.dumps(
            value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False
        ) + "\n"
    except (ValueError, TypeError, OverflowError) as exc:
        raise ContractError("output must be strict finite JSON") from exc
    path.parent.mkdir(parents=True, exist_ok=True)
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

def run_loaded(task: dict[str, Any], docs: list[CorpusDoc], out_path: Path, *,
               model_candidates: dict[str, Any] | None = None) -> dict[str, Any]:
    """Build and publish from one already-validated task/corpus generation."""
    answer = build_answer(task, docs, model_candidates=model_candidates)
    atomic_write_json(out_path, answer)
    return answer

def run(task_path: Path, corpus_dir: Path, out_path: Path, *, model_candidates: dict[str, Any] | None = None) -> dict[str, Any]:
    task = validate_task(load_json(task_path))
    docs = load_corpus(corpus_dir, task["cutoff_date"])
    return run_loaded(task, docs, out_path, model_candidates=model_candidates)
