#!/usr/bin/env python3
"""Official HackApertus Track 2A JSONL prediction entrypoint."""

from __future__ import annotations

import argparse
import json
import os
import re
import tempfile
import time
import unicodedata
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

try:
    import fitz  # PyMuPDF
except ImportError:  # pragma: no cover - diagnostic outside the image
    fitz = None


LABEL_NAMES = {0: "entailment", 1: "neutral", 2: "contradiction"}
MODEL_PREFIX = "swiss-ai/Apertus-v1.5-"
DEFAULT_MODEL = "swiss-ai/Apertus-v1.5-8B"


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
        value = json.loads(cleaned)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", cleaned, re.DOTALL)
        if not match:
            raise ValueError("model response contains no JSON object")
        value = json.loads(match.group(0))
    if not isinstance(value, dict):
        raise ValueError("model response JSON is not an object")
    return value


def invoke_apertus(case: dict[str, Any], task: str, context: str) -> tuple[dict[str, Any], dict[str, int], int]:
    base_url = os.environ.get("BASE_URL") or os.environ.get("LLM_BASE_URL")
    api_key = os.environ.get("API_KEY") or os.environ.get("LLM_API_KEY")
    model = os.environ.get("MODEL_NAME") or os.environ.get("LLM_NAME") or DEFAULT_MODEL
    if not base_url or not api_key:
        raise RuntimeError("BASE_URL and API_KEY are required at runtime")
    if not model.startswith(MODEL_PREFIX):
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
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
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
    document = json.loads(raw)
    parsed = parse_model_json(document["choices"][0]["message"]["content"])
    usage = document.get("usage") or {}
    tokens = {
        "input_tokens": int(usage.get("prompt_tokens", usage.get("input_tokens", 0)) or 0),
        "output_tokens": int(usage.get("completion_tokens", usage.get("output_tokens", 0)) or 0),
    }
    return parsed, tokens, elapsed_ms


def source_quote(text: str, passages: list[Passage], page: int | None) -> tuple[int | None, str] | None:
    needle = normalize_space(text)
    if not needle:
        return None
    for passage in passages:
        if page is not None and passage.page != page:
            continue
        haystack = normalize_space(passage.text)
        position = haystack.casefold().find(needle.casefold())
        if position >= 0:
            return passage.page, haystack[position : position + len(needle)][:5000]
    return None


def validate_prediction(raw: dict[str, Any], task: str, passages: list[Passage]) -> tuple[int, list[dict[str, Any]]]:
    label = raw.get("label")
    if isinstance(label, str) and label.isdigit():
        label = int(label)
    if label not in LABEL_NAMES:
        raise ValueError(f"invalid label: {label!r}")
    evidence: list[dict[str, Any]] = []
    if label != 1:
        items = raw.get("evidence") or []
        if not isinstance(items, list):
            raise ValueError("evidence must be a list")
        for item in items[:5]:
            if not isinstance(item, dict):
                continue
            page = item.get("page") if task == "A" else None
            if task == "A" and not isinstance(page, int):
                continue
            matched = source_quote(str(item.get("text", "")), passages, page)
            if matched:
                matched_page, text = matched
                evidence.append({"page": matched_page if task == "A" else None, "text": text})
        if task == "A" and not evidence:
            raise ValueError("non-neutral Task A prediction lacks source-verifiable evidence")
    return label, evidence


def predict_case(case: dict[str, Any], input_path: Path, data_root: Path, strategy: str, max_chars: int) -> dict[str, Any]:
    case_id = case.get("id")
    if not isinstance(case_id, (str, int)):
        raise ValueError("case.id must be a string or integer")
    task, pages = case_passages(case, input_path, data_root)
    context_passages = pages if strategy == "full" else select_context(case, pages)
    context = render_context(context_passages, max_chars)
    raw, tokens, elapsed_ms = invoke_apertus(case, task, context)
    label, evidence = validate_prediction(raw, task, context_passages)
    return {
        "id": case_id,
        "label": label,
        "label_name": LABEL_NAMES[label],
        "evidence": evidence,
        "metrics": {**tokens, "inference_time_ms": elapsed_ms},
    }


def read_jsonl(path: Path) -> Iterable[tuple[int, dict[str, Any]]]:
    with path.open("r", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, start=1):
            if not line.strip():
                continue
            value = json.loads(line)
            if not isinstance(value, dict):
                raise ValueError(f"line {line_number} is not a JSON object")
            yield line_number, value


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--strategy", choices=("full", "selected"), default=os.environ.get("CONTEXT_STRATEGY", "selected"))
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
            for line_number, case in read_jsonl(input_path):
                try:
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
