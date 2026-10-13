"""Route paired reconciliation through the original private DuckDB listener."""
from __future__ import annotations

from pathlib import Path
from urllib.parse import unquote

from ..storage import read
from .contracts import fields, fail, integer, request_id
from .model import Reconciliation
from .package import export_report

BASE = "/api/reconciliation"
_ASSETS = {
    "/reconciliation": ("index.html", "text/html;charset=utf-8"),
    "/reconciliation/": ("index.html", "text/html;charset=utf-8"),
    "/reconciliation/app.js": ("app.js", "text/javascript;charset=utf-8"),
    "/reconciliation/style.css": ("style.css", "text/css;charset=utf-8"),
    "/reconciliation/OPERATING.md": ("OPERATING.md", "text/plain;charset=utf-8"),
}


def asset(path):
    selected = _ASSETS.get(path)
    if selected is None:
        return None
    name, mime = selected
    root = Path(__file__).parent
    selected = root / name if name == "OPERATING.md" else root / "public" / name
    return read(selected, 2 * 1024 * 1024), mime


def model(operator):
    # Borrow only: no new database, HTTP owner, thread or scheduler.
    return Reconciliation(operator.workspace)


def _parts(path):
    if not path.startswith(BASE + "/"):
        fail("ROUTE_NOT_FOUND")
    return [unquote(part) for part in path[len(BASE) + 1:].split("/")]


def _parameters(parameters, allowed):
    if set(parameters) - set(allowed) or any(not isinstance(value, list) or len(value) != 1 for value in parameters.values()):
        fail("PARAMETERS_INVALID")
    return {key: value[0] for key, value in parameters.items()}


def _number(value):
    if not isinstance(value, str) or not value.isascii() or not value.isdigit() or len(value) > 12:
        fail("PARAMETERS_INVALID")
    return integer(int(value))


def _paging(values):
    return {"offset": _number(values.get("offset", "0")), "limit": _number(values.get("limit", "25"))}


def get(operator, path, parameters):
    parts = _parts(path)
    native = model(operator)
    if parts == ["status"]:
        _parameters(parameters, ())
        return native.status()
    if len(parts) == 1 and parts[0] in {"pairs", "runs", "reports", "operations"}:
        kind = parts[0]
        filter_name = "pair_id" if kind == "runs" else "run_id" if kind == "reports" else None
        values = _parameters(parameters, ("offset", "limit", filter_name) if filter_name else ("offset", "limit"))
        options = _paging(values)
        if filter_name in values:
            options[filter_name] = values[filter_name]
        return native.catalog(kind, **options)
    if len(parts) == 2 and parts[0] == "pairs":
        values = _parameters(parameters, ("revision",))
        return native.pair(parts[1], _number(values["revision"]) if "revision" in values else None)
    if len(parts) == 2 and parts[0] in {"runs", "reports", "requests"}:
        _parameters(parameters, ())
        return getattr(native, {"runs": "run", "reports": "report", "requests": "request"}[parts[0]])(parts[1])
    if len(parts) == 3 and parts[0] == "runs":
        run_id, kind = parts[1:]
        if kind in {"groups", "rows"}:
            allowed = ("category", "duplicates") if kind == "groups" else ("side", "status", "group_id")
            values = _parameters(parameters, ("offset", "limit", *allowed))
            options = _paging(values)
            for name in allowed:
                if name not in values:
                    continue
                if name == "group_id":
                    options[name] = _number(values[name])
                elif name == "duplicates":
                    if values[name] not in {"true", "false"}:
                        fail("DUPLICATES_FILTER_INVALID")
                    options[name] = values[name] == "true"
                else:
                    options[name] = values[name]
            return native.grid(run_id, kind, **options)
        if kind == "row":
            values = _parameters(parameters, ("side", "row"))
            if set(values) != {"side", "row"}:
                fail("ROW_PARAMETERS_REQUIRED")
            return native.row(run_id, values["side"], _number(values["row"]))
        if kind == "decisions":
            values = _parameters(parameters, ("offset", "limit"))
            return native.decisions(run_id, **_paging(values))
    if len(parts) == 3 and parts[0] == "reports" and parts[2] == "changes":
        values = _parameters(parameters, ("offset", "limit"))
        return native.changes(parts[1], **_paging(values))
    fail("ROUTE_NOT_FOUND")


def validate_export(body):
    from ..duckdb_dataset import _hex
    fields(body, ("request_id", "report_id"))
    request_id(body["request_id"])
    _hex(body["report_id"])


def export(operator, body, directory):
    validate_export(body)
    return export_report(operator.workspace, body, directory)


def perform(operator, path, body):
    parts = _parts(path)
    native = model(operator)
    if parts == ["review"]:
        fields(body, ("definition",))
        return native.review(body["definition"])
    if len(parts) == 1 and parts[0] in {"pairs", "run", "decision", "report"}:
        return native.perform(parts[0], body)
    if len(parts) == 3 and parts[0] == "requests" and parts[2] == "resume":
        fields(body, ("workspace_id",))
        return native.resume(parts[1], body["workspace_id"])
    if parts == ["exports"]:
        return operator._retained_action(path, body)
    fail("ROUTE_NOT_FOUND")
