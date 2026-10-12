"""MIT. Typed pointer reads through the maintained ClinicalTrials Decimal parser."""
from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path
import re
import sys

SCHEMA = "sf88-research-source-values/v1"
REQUEST = "sf88-research-source-values-request/v1"
MAX_SOURCE = 16 * 1024 * 1024
MAX_REQUEST = 6 * MAX_SOURCE + 1024 * 1024
MAX_RESPONSE = 64 * 1024 * 1024
_SHA = re.compile(r"[a-f0-9]{64}\Z")
_CODE = re.compile(r"[A-Z][A-Z0-9_]{0,119}\Z")
_INDEX = re.compile(r"(?:0|[1-9][0-9]*)\Z")

_parser_path = Path(__file__).resolve().with_name("clinical-trials-packet.py")
_spec = importlib.util.spec_from_file_location("_research_original_clinicaltrials_packet", _parser_path)
if _spec is None or _spec.loader is None:
    raise RuntimeError("RESEARCH_SOURCE_PARSER_UNAVAILABLE")
_parser = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_parser)


def need(value, code):
    if not value:
        raise ValueError(code)


def _tokens(pointer):
    need(isinstance(pointer, str) and len(pointer) <= 4096 and
         (pointer == "" or pointer.startswith("/")), "RESEARCH_SOURCE_POINTER_INVALID")
    if pointer == "":
        return []
    tokens = []
    for token in pointer[1:].split("/"):
        need(re.search(r"~(?![01])", token) is None, "RESEARCH_SOURCE_POINTER_INVALID")
        tokens.append(token.replace("~1", "/").replace("~0", "~"))
    return tokens


def _lookup(value, tokens):
    for token in tokens:
        if isinstance(value, dict):
            if token not in value:
                return False, None
            value = value[token]
        elif isinstance(value, list):
            if not _INDEX.fullmatch(token) or len(token) > len(str(len(value))):
                return False, None
            index = int(token)
            if index >= len(value):
                return False, None
            value = value[index]
        else:
            return False, None
    return True, value


def resolve_source_pointers(request):
    need(isinstance(request, dict) and set(request) == {
        "schema", "rawText", "expectedSha256", "expectedBytes", "pointers"
    } and request.get("schema") == REQUEST, "RESEARCH_SOURCE_VALUES_REQUEST_INVALID")
    raw_text = request["rawText"]
    need(isinstance(raw_text, str), "RESEARCH_SOURCE_TEXT_REQUIRED")
    raw = raw_text.encode("utf-8", errors="strict")
    need(type(request["expectedBytes"]) is int and 0 < request["expectedBytes"] <= MAX_SOURCE and
         len(raw) == request["expectedBytes"] and isinstance(request["expectedSha256"], str) and
         _SHA.fullmatch(request["expectedSha256"]) is not None and
         hashlib.sha256(raw).hexdigest() == request["expectedSha256"],
         "RESEARCH_SOURCE_BYTES_CHANGED")
    pointers = request["pointers"]
    need(isinstance(pointers, list) and 0 < len(pointers) <= 512 and
         all(isinstance(pointer, str) for pointer in pointers) and
         sum(len(pointer) for pointer in pointers) <= 262144,
         "RESEARCH_SOURCE_POINTERS_REQUIRED")
    selected = [(pointer, _tokens(pointer)) for pointer in pointers]
    document = _parser.document(raw, exact=True)
    values = []
    remaining = MAX_RESPONSE - 1024
    encoder = json.JSONEncoder(ensure_ascii=False, allow_nan=False, separators=(",", ":"))
    for pointer, tokens in selected:
        found, value = _lookup(document, tokens)
        row = {"pointer": pointer, "found": found}
        if found:
            row["typedValue"] = _parser.typed(value)
        # Bound the accumulated result before retaining another selected value.
        # Repeated whole-document pointers must not build an unbounded response.
        for chunk in encoder.iterencode(row):
            remaining -= len(chunk.encode("utf-8"))
            need(remaining >= 0, "RESEARCH_SOURCE_VALUES_RESPONSE_TOO_LARGE")
        remaining -= 1  # The enclosing values array separator.
        need(remaining >= 0, "RESEARCH_SOURCE_VALUES_RESPONSE_TOO_LARGE")
        values.append(row)
    return {
        "schema": SCHEMA, "sourceSha256": request["expectedSha256"], "sourceBytes": len(raw),
        "parser": {"module": "clinical-trials-packet.py",
                   "sha256": hashlib.sha256(_parser_path.read_bytes()).hexdigest()},
        "values": values
    }


def main():
    need(sys.argv[1:] == ["--stdio"], "RESEARCH_SOURCE_VALUES_STDIO_REQUIRED")
    raw = sys.stdin.buffer.read(MAX_REQUEST + 1)
    need(0 < len(raw) <= MAX_REQUEST, "RESEARCH_SOURCE_VALUES_REQUEST_TOO_LARGE")
    # The same original loader rejects duplicate envelope keys and non-JSON constants.
    request = _parser.document(raw)
    result = resolve_source_pointers(request)
    output = (json.dumps(result, ensure_ascii=False, allow_nan=False,
                         separators=(",", ":")) + "\n").encode("utf-8")
    need(len(output) <= MAX_RESPONSE, "RESEARCH_SOURCE_VALUES_RESPONSE_TOO_LARGE")
    sys.stdout.buffer.write(output)
    sys.stdout.buffer.flush()


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        value = str(error)
        code = value if _CODE.fullmatch(value) else "RESEARCH_SOURCE_VALUES_FAILED"
        sys.stdout.write(json.dumps({"schema": SCHEMA, "error": code}) + "\n")
        sys.stdout.flush()
        raise SystemExit(1)
