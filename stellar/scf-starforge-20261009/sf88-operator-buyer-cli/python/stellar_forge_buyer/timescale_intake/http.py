"""Timescale intake over the original authenticated DuckDB listener."""
from __future__ import annotations

from io import BytesIO
from pathlib import Path
from urllib.parse import unquote
import re

from .._analysis_export_http import send_export
from ..storage import read
from .model import TimescaleIntake, report_file_bytes
from .source import (MAX_REPORT, CommissioningReport, fail, need, fields,
                     integer, request_id, hash_id, filename, read_original)

BASE = "/api/timescale-intake"
_ASSETS = {
    "/timescale-intake": ("index.html", "text/html;charset=utf-8"),
    "/timescale-intake/": ("index.html", "text/html;charset=utf-8"),
    "/timescale-intake/app.js": ("app.js", "text/javascript;charset=utf-8"),
    "/timescale-intake/style.css": ("style.css", "text/css;charset=utf-8"),
    "/timescale-intake/OPERATING.md": ("OPERATING.md", "text/plain;charset=utf-8"),
}


def asset(path):
    selected = _ASSETS.get(path)
    if selected is None:
        return None
    name, mime = selected
    root = Path(__file__).parent
    target = root / name if name == "OPERATING.md" else root / "public" / name
    return read(target, 2 * 1024 * 1024), mime


def model(operator):
    return TimescaleIntake(operator.workspace)


def _parts(path):
    need(path.startswith(BASE + "/"), "ROUTE_NOT_FOUND")
    return [unquote(part) for part in path[len(BASE) + 1:].split("/")]


def _parameters(values, allowed):
    need(not set(values) - set(allowed) and all(
        isinstance(value, list) and len(value) == 1 for value in values.values()), "PARAMETERS_INVALID")
    return {key: value[0] for key, value in values.items()}


def _number(value):
    need(isinstance(value, str) and value.isascii() and value.isdigit()
         and len(value) <= 12, "PARAMETERS_INVALID")
    return integer(int(value))


def _paging(values):
    return {"offset": _number(values.get("offset", "0")),
            "limit": _number(values.get("limit", "25"))}


def get(operator, path, parameters):
    parts, native = _parts(path), model(operator)
    if parts == ["status"]:
        _parameters(parameters, ())
        return native.status()
    if len(parts) == 1 and parts[0] in {"reports", "reviews", "operations"}:
        values = _parameters(parameters, ("offset", "limit"))
        return getattr(native, parts[0])(**_paging(values))
    if len(parts) == 2 and parts[0] in {"reports", "requests"}:
        _parameters(parameters, ())
        return getattr(native, "report" if parts[0] == "reports" else "request")(parts[1])
    if len(parts) == 4 and parts[0] == "reports" and parts[2] == "sources":
        values = _parameters(parameters, ("offset", "limit", "q"))
        return native.source(parts[1], parts[3], **_paging(values), q=values.get("q", ""))
    fail("ROUTE_NOT_FOUND")


def download(handler, operator, path, parameters):
    """The existing Range/ETag sender owns HTTP; this scope owns only its stream."""
    parts = _parts(path)
    if len(parts) != 3 or parts[0] != "reports" or parts[2] != "file":
        return False
    values = _parameters(parameters, ("name",))
    name = values.get("name", "original-commissioning.json")
    raw, declared, saved = report_file_bytes(operator.workspace, hash_id(parts[1]), name)
    with BytesIO(raw) as stream:
        send_export(handler, stream, {"name": saved["filename"] if name == "original-commissioning.json" else name,
                    "bytes": len(raw), "sha256": declared["sha256"],
                    "mime": "text/markdown;charset=utf-8" if name.endswith(".md") else "application/json"})
    return True


def upload(operator, raw, headers):
    def single(name):
        values = headers.get_all(name, [])
        need(len(values) == 1, "UPLOAD_HEADER_REQUIRED")
        return values[0]
    encoded = single("X-DuckDB-Filename")
    need(encoded.isascii() and len(encoded) <= 3 * 240
         and re.search(r"%(?![0-9A-Fa-f]{2})", encoded) is None, "FILENAME_ENCODING_INVALID")
    name = filename(unquote(encoded, encoding="utf-8", errors="strict"))
    body = {"request_id": request_id(single("X-DuckDB-Request-ID")),
            "workspace_id": request_id(single("X-DuckDB-Workspace-ID")),
            "filename": name, "sha256": hash_id(single("X-DuckDB-Source-Sha256"))}
    with operator.mutex:
        return model(operator).retain(body, raw)


def inspect_report(body):
    """Trusted host inspection; no request record or warehouse write."""
    fields(body, ("report_path", "sha256", "filename"))
    raw = read_original(body["report_path"])
    report = CommissioningReport(raw, hash_id(body["sha256"]))
    return {**report.summary(filename(body["filename"])), "sources": report.descriptors()}


def perform(operator, path, body):
    parts, native = _parts(path), model(operator)
    if parts == ["inspect"]:
        return inspect_report(body)
    if parts == ["retain"]:
        return native.retain_path(body)
    if parts == ["reviews"]:
        return native.review(body)
    if parts == ["imports"]:
        return native.import_review(body)
    if parts == ["pair-review"]:
        fields(body, ("definition",))
        return native.pair_review(body["definition"])
    if parts == ["pairs"]:
        return native.pair(body)
    if len(parts) == 3 and parts[0] == "requests" and parts[2] == "resume":
        fields(body, ("workspace_id",))
        return native.resume(parts[1], body["workspace_id"])
    fail("ROUTE_NOT_FOUND")
