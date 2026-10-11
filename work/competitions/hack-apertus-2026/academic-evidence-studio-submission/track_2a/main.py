#!/usr/bin/env python3
"""Official HackApertus Track 2A JSONL prediction entrypoint."""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import tempfile
import time
import unicodedata
import urllib.error
import urllib.request
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

try:
    import fitz  # PyMuPDF
except ImportError:  # pragma: no cover - diagnostic outside the image
    fitz = None


LABEL_NAMES = {0: "entailment", 1: "neutral", 2: "contradiction"}
LANGS = ("de", "fr", "it")
STRATEGIES = ("full", "selected", "balanced")
MODEL_PREFIX = "swiss-ai/Apertus-v1.5-"
DEFAULT_MODEL = "swiss-ai/Apertus-v1.5-8B"
USER_AGENT = "HackApertus-OST-Track2A/1.0"
MAX_EVIDENCE_ITEMS = 5
MAX_EVIDENCE_CHARS = 5000


class CaseError(ValueError):
    """Official input case violates the published contract."""


def _no_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"duplicate JSON key: {key!r}")
        result[key] = value
    return result


def _reject_constant(name: str) -> Any:
    raise ValueError(f"non-finite JSON number: {name}")


def strict_loads(text: str | bytes) -> Any:
    """JSON parse that rejects duplicate object keys and non-finite numbers."""
    return json.loads(
        text,
        object_pairs_hook=_no_duplicate_keys,
        parse_constant=_reject_constant,
    )


def _nonempty_str(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def validate_case(case: Any) -> str:
    """Validate one official case BEFORE any extraction or model call.

    Returns 'A' (booklet PDF) or 'B' (reference text). Enforces exactly the
    published contract: unchanged non-empty string id, non-empty vote and
    claim.text, de/fr/it claim and source languages, and exactly ONE source
    key whose object is well-formed (a second source key, even malformed,
    fails the case). Booleans and numbers are never accepted where the
    contract requires strings.
    """
    if not isinstance(case, dict):
        raise CaseError("case must be a JSON object")
    if not _nonempty_str(case.get("id")):
        raise CaseError("case.id must be a non-empty string")
    if not _nonempty_str(case.get("vote")):
        raise CaseError("case.vote must be a non-empty string")
    claim = case.get("claim")
    if not isinstance(claim, dict) or not _nonempty_str(claim.get("text")):
        raise CaseError("case.claim.text must be a non-empty string")
    if claim.get("language") not in LANGS:
        raise CaseError("case.claim.language must be one of de|fr|it")
    sources = [key for key in ("booklet", "reference") if key in case]
    if len(sources) != 1:
        raise CaseError(
            "case must contain exactly one of 'booklet' or 'reference'"
        )
    source_key = sources[0]
    source = case[source_key]
    if not isinstance(source, dict):
        raise CaseError(f"case.{source_key} must be an object")
    if source.get("language") not in LANGS:
        raise CaseError(f"case.{source_key}.language must be one of de|fr|it")
    if source_key == "booklet":
        if not _nonempty_str(source.get("path")):
            raise CaseError("case.booklet.path must be a non-empty string")
        return "A"
    if not _nonempty_str(source.get("text")):
        raise CaseError("case.reference.text must be a non-empty string")
    return "B"


@dataclass(frozen=True)
class Passage:
    page: int | None
    text: str


def normalize_space(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def lexical_terms(value: str) -> set[str]:
    folded = unicodedata.normalize("NFKD", value).casefold()
    return {token for token in re.findall(r"[^\W\d_]{3,}", folded, re.UNICODE)}


def safe_source_path(raw_path: str, input_path: Path, data_root: Path) -> Path:
    candidate = Path(raw_path)
    if not candidate.is_absolute():
        candidate = input_path.parent / candidate
    resolved = candidate.resolve(strict=True)
    root = data_root.resolve(strict=True)
    try:
        resolved.relative_to(root)
    except ValueError as exc:
        raise ValueError(f"booklet path escapes data root: {raw_path}") from exc
    if not resolved.is_file():
        raise ValueError(f"booklet path is not a file: {raw_path}")
    return resolved


def extract_pdf(path: Path) -> list[Passage]:
    if fitz is None:
        raise RuntimeError("PyMuPDF is required for Task A PDF extraction")
    pages: list[Passage] = []
    with fitz.open(path) as document:
        for number, page in enumerate(document, start=1):
            text = page.get_text("text", sort=True)
            if normalize_space(text):
                pages.append(Passage(number, text))
    if not pages:
        raise ValueError(f"no extractable text in booklet: {path.name}")
    return pages


def case_passages(case: dict[str, Any], input_path: Path, data_root: Path) -> tuple[str, list[Passage]]:
    has_booklet = isinstance(case.get("booklet"), dict)
    has_reference = isinstance(case.get("reference"), dict)
    if has_booklet == has_reference:
        raise ValueError("case must contain exactly one booklet or reference")
    if has_booklet:
        raw_path = case["booklet"].get("path")
        if not isinstance(raw_path, str) or not raw_path:
            raise ValueError("booklet.path must be a non-empty string")
        return "A", extract_pdf(safe_source_path(raw_path, input_path, data_root))
    text = case["reference"].get("text")
    if not isinstance(text, str) or not normalize_space(text):
        raise ValueError("reference.text must be a non-empty string")
    return "B", [Passage(None, text)]


def split_passages(pages: Iterable[Passage], target_chars: int = 1800) -> list[Passage]:
    chunks: list[Passage] = []
    for passage in pages:
        paragraphs = [part.strip() for part in re.split(r"\n\s*\n|(?<=[.!?])\s+(?=[A-ZÀ-ÖØ-Þ])", passage.text) if part.strip()]
        current: list[str] = []
        size = 0
        for paragraph in paragraphs:
            if current and size + len(paragraph) + 1 > target_chars:
                chunks.append(Passage(passage.page, "\n".join(current)))
                current, size = [], 0
            if len(paragraph) > target_chars:
                if current:
                    chunks.append(Passage(passage.page, "\n".join(current)))
                    current, size = [], 0
                for offset in range(0, len(paragraph), target_chars):
                    chunks.append(Passage(passage.page, paragraph[offset : offset + target_chars]))
                continue
            current.append(paragraph)
            size += len(paragraph) + 1
        if current:
            chunks.append(Passage(passage.page, "\n".join(current)))
    return chunks


def select_context(case: dict[str, Any], pages: list[Passage], limit: int = 8) -> list[Passage]:
    claim = case.get("claim") or {}
    claim_text = claim.get("text", "") if isinstance(claim, dict) else str(claim)
    vote = case.get("vote") or ""
    query = lexical_terms(f"{vote} {claim_text}")
    vote_terms = lexical_terms(str(vote))
    chunks = split_passages(pages)
    scored: list[tuple[float, int, Passage]] = []
    for index, chunk in enumerate(chunks):
        terms = lexical_terms(chunk.text)
        overlap = len(query & terms)
        vote_overlap = len(vote_terms & terms)
        phrase_bonus = 3 if vote and normalize_space(str(vote)).casefold() in normalize_space(chunk.text).casefold() else 0
        scored.append((overlap + 2 * vote_overlap + phrase_bonus + 0.25 / (1 + index), index, chunk))
    chosen = sorted(scored, key=lambda item: (-item[0], item[1]))[: max(1, limit)]
    return [item[2] for item in sorted(chosen, key=lambda item: item[1])]


def retrieval_features(text: str) -> Counter[str]:
    """Language-independent surface anchors, never translated source text.

    Accent folding joins e.g. French/Italian cognates; short character ngrams
    also tolerate inflection and compounds. These are surface similarities,
    not semantic cross-language equivalence. Numeric anchors survive a claim
    language change. The original passages remain untouched for quotation.
    """
    folded = "".join(char for char in unicodedata.normalize("NFKD", text.casefold())
                     if not unicodedata.combining(char))
    features: Counter[str] = Counter()
    for token in re.findall(r"[^\W\d_]+|\d+", folded, re.UNICODE):
        if token.isdecimal():
            features["n:" + token] += 1
        elif len(token) >= 3:
            features["w:" + token] += 1
            if len(token) >= 5:
                for offset in range(len(token) - 2):
                    features["g:" + token[offset:offset + 3]] += 1
    return features


def balanced_context(case: dict[str, Any], pages: list[Passage], limit: int = 8) -> list[Passage]:
    """Optional sparse-retrieval arm with document-wide coverage.

    BM25-style document frequency and length normalization rank surface
    anchors. Half the budget is reserved for distributed coverage when source
    and claim languages differ, because a missing lexical match is not evidence
    of irrelevance. Same-language cases reserve a quarter. Return original
    chunks in source order; no gold labels or additional provider calls are used.
    """
    chunks = split_passages(pages)
    budget = min(len(chunks), max(1, limit))
    if len(chunks) <= budget:
        return chunks
    claim = case["claim"]
    source = case.get("reference") or case.get("booklet")
    cross_language = claim["language"] != source["language"]
    query = retrieval_features(claim["text"])
    query.update(retrieval_features(str(case.get("vote", ""))))
    features = [retrieval_features(chunk.text) for chunk in chunks]
    frequencies: Counter[str] = Counter()
    for terms in features:
        frequencies.update(terms.keys())
    lengths = [sum(count for feature, count in terms.items() if not feature.startswith("g:"))
               for terms in features]
    mean_length = max(1.0, sum(lengths) / len(lengths))
    weights = {"w": 1.0, "n": 2.5, "g": 0.15}
    scored = []
    for index, terms in enumerate(features):
        score = 0.0
        length_factor = 1.2 * (0.25 + 0.75 * lengths[index] / mean_length)
        for feature in query.keys() & terms.keys():
            tf = terms[feature]
            df = frequencies[feature]
            idf = math.log(1 + (len(chunks) - df + 0.5) / (df + 0.5))
            score += weights[feature[0]] * idf * tf * 2.2 / (tf + length_factor)
        scored.append((score, index))
    coverage = max(1, budget // (2 if cross_language else 4))
    ranked = sorted(scored, key=lambda item: (-item[0], item[1]))
    # With no shared surface anchors, use the entire budget for coverage.
    anchor_budget = 0 if ranked[0][0] == 0 else budget - coverage
    chosen = {index for _, index in ranked[:anchor_budget]}
    # Fill the largest uncovered source interval at each step. Endpoints first
    # avoid the previous prefix tie-break; subsequent midpoints cover the body.
    while len(chosen) < budget:
        if not chosen:
            candidate = 0
        else:
            candidate = max((index for index in range(len(chunks)) if index not in chosen),
                            key=lambda index: (min(abs(index - selected) for selected in chosen), -index))
        chosen.add(candidate)
    return [chunks[index] for index in sorted(chosen)]


def render_context(passages: list[Passage], max_chars: int) -> str:
    rendered: list[str] = []
    size = 0
    for index, passage in enumerate(passages, start=1):
        marker = f"[PASSAGE {index}; PAGE {passage.page if passage.page is not None else 'null'}]\n"
        available = max_chars - size - len(marker)
        if available <= 0:
            break
        body = passage.text[:available]
        rendered.append(marker + body)
        size += len(marker) + len(body)
    if not rendered:
        raise ValueError("context is empty after truncation")
    return "\n\n".join(rendered)


def chat_url(base_url: str) -> str:
    base = base_url.rstrip("/")
    return base if base.endswith("/chat/completions") else base + "/chat/completions"


def parse_model_json(content: Any) -> dict[str, Any]:
    if isinstance(content, list):
        content = "".join(part.get("text", "") if isinstance(part, dict) else str(part) for part in content)
    if not isinstance(content, str):
        raise ValueError("model response content is not text")
    cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", content.strip(), flags=re.IGNORECASE)
    try:
        value = strict_loads(cleaned)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", cleaned, re.DOTALL)
        if not match:
            raise ValueError("model response contains no JSON object")
        value = strict_loads(match.group(0))
    if not isinstance(value, dict):
        raise ValueError("model response JSON is not an object")
    return value


def invoke_apertus(case: dict[str, Any], task: str, context: str) -> tuple[dict[str, Any], dict[str, int], int]:
    base_url = os.environ.get("BASE_URL") or os.environ.get("LLM_BASE_URL")
    api_key = os.environ.get("API_KEY") or os.environ.get("LLM_API_KEY")
    model = os.environ.get("MODEL_NAME") or os.environ.get("LLM_NAME") or DEFAULT_MODEL
    if not base_url or not api_key:
        raise RuntimeError("BASE_URL and API_KEY are required at runtime")
    # Public AI uses lowercase provider IDs; CSCS/Hugging Face use mixed
    # case. Check the family without rewriting the provider's actual ID.
    if not model.casefold().startswith(MODEL_PREFIX.casefold()):
        raise RuntimeError(f"MODEL_NAME must identify an Apertus v1.5 model ({MODEL_PREFIX}*)")

    claim = case.get("claim") or {}
    claim_text = claim.get("text") if isinstance(claim, dict) else str(claim)
    claim_language = claim.get("language") if isinstance(claim, dict) else case.get("claim_language")
    source = case.get("booklet") if task == "A" else case.get("reference")
    source_language = source.get("language") if isinstance(source, dict) else None
    prompt = f"""You are solving document-grounded natural language inference over an official Swiss voting source.
Return exactly one JSON object, with no Markdown, using this schema:
{{"label":0|1|2,"evidence":[{{"page":integer_or_null,"text":"verbatim source quote"}}]}}
Labels: 0 entailment (source supports claim), 1 neutral (source neither entails nor contradicts), 2 contradiction (source conflicts with claim).
Judge only from the supplied source. Do not judge general political truth. Handle cross-lingual claims. For labels 0 or 2, quote the smallest decisive verbatim passage. For label 1, evidence must be []. Task A evidence page is the 1-based PDF page in its passage marker; Task B page is null.

Source language: {source_language}
Claim language: {claim_language}
Vote/topic: {case.get('vote', '')}
Claim: {claim_text}

SOURCE:
{context}
"""
    payload = {
        "model": model,
        "temperature": 0,
        "messages": [{"role": "user", "content": prompt}],
        "response_format": {"type": "json_object"},
    }
    request = urllib.request.Request(
        chat_url(base_url),
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        # Public AI requires an identifying User-Agent on every API request.
        # Keep it deterministic and credential-free across both dev arms.
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json",
                 "User-Agent": USER_AGENT},
        method="POST",
    )
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(request, timeout=float(os.environ.get("REQUEST_TIMEOUT_SECONDS", "180"))) as response:
            raw = response.read()
    except urllib.error.HTTPError as exc:
        detail = exc.read(2000).decode("utf-8", "replace")
        raise RuntimeError(f"Apertus HTTP {exc.code}: {detail}") from exc
    elapsed_ms = round((time.perf_counter() - started) * 1000)
    document = strict_loads(raw)
    parsed = parse_model_json(document["choices"][0]["message"]["content"])
    usage = document.get("usage")
    if not isinstance(usage, dict):
        raise RuntimeError(
            "Apertus response omitted the usage object; token metrics cannot "
            "be reported honestly (no substitute is invented)"
        )
    tokens: dict[str, int] = {}
    for metric_key, usage_keys in (
        ("input_tokens", ("prompt_tokens", "input_tokens")),
        ("output_tokens", ("completion_tokens", "output_tokens")),
    ):
        value = next((usage[key] for key in usage_keys if key in usage), None)
        if (
            isinstance(value, bool)
            or not isinstance(value, (int, float))
            or not math.isfinite(value)
            or value < 0
            or int(value) != value
        ):
            raise RuntimeError(
                f"Apertus usage lacks a finite non-negative integer count for "
                f"{metric_key} (expected one of {usage_keys}); refusing to "
                f"report invented token metrics"
            )
        tokens[metric_key] = int(value)
    return parsed, tokens, elapsed_ms


def _norm_with_map(text: str) -> tuple[str, list[int]]:
    """normalize_space() equivalent that also returns, for every emitted
    character, the index of the ORIGINAL character it came from (a collapsed
    whitespace run maps to its first character)."""
    out: list[str] = []
    mapping: list[int] = []
    pending_space = -1
    for index, char in enumerate(text):
        if char.isspace():
            if out and pending_space < 0:
                pending_space = index
            continue
        if pending_space >= 0:
            out.append(" ")
            mapping.append(pending_space)
            pending_space = -1
        out.append(char)
        mapping.append(index)
    return "".join(out), mapping


def _fold_with_map(text: str) -> tuple[str, list[int]]:
    """casefold() equivalent that maps every folded character back to the
    index of its ORIGINAL character (expansions like ß->ss share one index)."""
    out: list[str] = []
    mapping: list[int] = []
    for index, char in enumerate(text):
        folded = char.casefold()
        out.append(folded)
        mapping.extend([index] * len(folded))
    return "".join(out), mapping


def _find_quote(passage: Passage, needle_raw: str) -> tuple[int | None, str] | None:
    """Locate needle in passage and return (page, verbatim ORIGINAL span).

    Match order: exact raw substring, then whitespace-collapsed exact match,
    then casefolded match. Folded positions are mapped back through the
    normalization/folding index maps so the returned text is sliced from the
    ORIGINAL source characters — expansions like 'ß'->'ss' can never skew the
    returned span. No match returns None; nothing is fabricated.
    """
    position = passage.text.find(needle_raw)
    if position >= 0:
        return passage.page, passage.text[position : position + len(needle_raw)][:MAX_EVIDENCE_CHARS]
    normalized, norm_map = _norm_with_map(passage.text)
    needle_norm = normalize_space(needle_raw)
    position = normalized.find(needle_norm)
    if position >= 0:
        start = norm_map[position]
        end = norm_map[position + len(needle_norm) - 1] + 1
        return passage.page, passage.text[start:end][:MAX_EVIDENCE_CHARS]
    folded, fold_map = _fold_with_map(normalized)
    folded_needle = needle_norm.casefold()
    position = folded.find(folded_needle)
    if position >= 0 and folded_needle:
        norm_start = fold_map[position]
        norm_end = fold_map[position + len(folded_needle) - 1] + 1
        start = norm_map[norm_start]
        end = norm_map[norm_end - 1] + 1
        return passage.page, passage.text[start:end][:MAX_EVIDENCE_CHARS]
    return None


def source_quote(text: str, passages: list[Passage], page: int | None) -> tuple[int | None, str] | None:
    needle = normalize_space(text)
    if not needle:
        return None

    def find(candidates: Iterable[Passage]) -> tuple[int | None, str] | None:
        for passage in candidates:
            matched = _find_quote(passage, text)
            if matched is not None:
                return matched
        return None

    if page is not None:
        matched = find(p for p in passages if p.page == page)
        if matched is not None:
            return matched
    # Fall back to the whole source: a verified quote keeps its real
    # provenance, so the recorded page is the page it was found on even if
    # the model named a different one.
    return find(passages)


def validate_prediction(raw: dict[str, Any], task: str, passages: list[Passage]) -> tuple[int, list[dict[str, Any]]]:
    label = raw.get("label")
    # The contract label is a JSON integer 0|1|2. Booleans, floats and
    # digit-strings are rejected rather than coerced.
    if type(label) is not int or label not in LABEL_NAMES:
        raise ValueError(f"invalid label (must be integer 0|1|2): {label!r}")
    evidence: list[dict[str, Any]] = []
    if label != 1:
        items = raw.get("evidence")
        if items is None:
            items = []
        if not isinstance(items, list):
            raise ValueError("evidence must be a list")
        for item in items[:MAX_EVIDENCE_ITEMS]:
            if not isinstance(item, dict):
                continue
            quote = item.get("text")
            if not _nonempty_str(quote):
                continue
            if task == "A":
                page = item.get("page")
                if type(page) is not int or page < 1:
                    continue
            else:
                # Task B evidence page MUST be null; a non-null page makes
                # the item contract-invalid rather than silently rewriting it.
                if item.get("page") is not None:
                    continue
                page = None
            matched = source_quote(quote, passages, page)
            if matched:
                matched_page, text = matched
                evidence.append({"page": matched_page if task == "A" else None, "text": text})
        if task == "A" and not evidence:
            raise ValueError("non-neutral Task A prediction lacks source-verifiable evidence")
    return label, evidence


def predict_case(case: dict[str, Any], input_path: Path, data_root: Path, strategy: str, max_chars: int) -> dict[str, Any]:
    # inference_time_ms is the FULL case wall clock: validation, extraction,
    # context selection, the model call and output verification — not only
    # the HTTP duration.
    started = time.perf_counter()
    if strategy not in STRATEGIES:
        raise ValueError(f"strategy must be one of {STRATEGIES}, got {strategy!r}")
    task = validate_case(case)
    case_id = case["id"]
    _, pages = case_passages(case, input_path, data_root)
    if strategy == "full":
        context_passages = pages
    elif strategy == "selected":
        context_passages = select_context(case, pages)
    else:
        context_passages = balanced_context(case, pages)
    context = render_context(context_passages, max_chars)
    raw, tokens, _http_ms = invoke_apertus(case, task, context)
    label, evidence = validate_prediction(raw, task, context_passages)
    inference_ms = round((time.perf_counter() - started) * 1000)
    return {
        "id": case_id,
        "label": label,
        "label_name": LABEL_NAMES[label],
        "evidence": evidence,
        "metrics": {**tokens, "inference_time_ms": inference_ms},
    }


def read_jsonl(path: Path) -> Iterable[tuple[int, dict[str, Any]]]:
    with path.open("r", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, start=1):
            if not line.strip():
                continue
            try:
                value = strict_loads(line)
            except ValueError as exc:
                raise ValueError(f"line {line_number} is invalid JSON: {exc}") from exc
            if not isinstance(value, dict):
                raise ValueError(f"line {line_number} is not a JSON object")
            yield line_number, value


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    # Default is the actual full-document baseline; 'selected' remains an
    # explicit experimental strategy via flag or CONTEXT_STRATEGY override.
    parser.add_argument("--strategy", choices=STRATEGIES, default=os.environ.get("CONTEXT_STRATEGY", "full"))
    parser.add_argument("--max-context-chars", type=int, default=int(os.environ.get("MAX_CONTEXT_CHARS", "120000")))
    args = parser.parse_args()

    input_path = args.input.resolve(strict=True)
    data_root = Path(os.environ.get("DATA_ROOT", "/data"))
    if not data_root.exists():
        data_root = input_path.parent
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temp_name: str | None = None
    try:
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=args.output.parent, prefix=".predictions-", suffix=".jsonl", delete=False) as output:
            temp_name = output.name
            seen_ids: set[str] = set()
            for line_number, case in read_jsonl(input_path):
                try:
                    validate_case(case)
                    if case["id"] in seen_ids:
                        raise CaseError(f"duplicate input id: {case['id']!r}")
                    seen_ids.add(case["id"])
                    prediction = predict_case(case, input_path, data_root, args.strategy, args.max_context_chars)
                except Exception as exc:
                    raise RuntimeError(f"case at input line {line_number} failed: {exc}") from exc
                output.write(json.dumps(prediction, ensure_ascii=False, separators=(",", ":")) + "\n")
            output.flush()
            os.fsync(output.fileno())
        os.replace(temp_name, args.output)
    except Exception:
        if temp_name:
            Path(temp_name).unlink(missing_ok=True)
        raise
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
