"""Authenticated HTTP adapter for the original SF47 local workspace."""
from __future__ import annotations

from urllib.parse import parse_qs, unquote
import re

from model import Problem
from operations import Operations, decoded


def register_static(static):
    static.update({"/operations.mjs": ("operations.mjs", "text/javascript; charset=utf-8"),
                   "/operations.css": ("operations.css", "text/css; charset=utf-8")})


def store(handler):
    with handler.server.workspace.mutex:
        if not hasattr(handler.server, "operations"):
            handler.server.operations = Operations(handler.server.workspace)
        return handler.server.operations


def read(handler, parsed):
    if not parsed.path.startswith("/api/operations"):
        return False
    ops, query = store(handler), parse_qs(parsed.query)
    path = parsed.path
    if path == "/api/operations":
        handler.send(200, {"cases": ops.list(query.get("planId", [None])[0])})
        return True
    match = re.fullmatch(r"/api/operations/(operation-[a-f0-9]{32})(?:/(report|history|export.zip|sources/source-[a-f0-9]{32}|reviews/review-[a-f0-9]{32}))?", path)
    if not match:
        raise Problem("Operations page not found.", 404, "NOT_FOUND")
    ident, action = match.groups()
    if not action:
        handler.send(200, ops.read(ident))
    elif action == "report":
        handler.send(200, ops.report(ident))
    elif action == "history":
        handler.send(200, ops.history(ident, int(query.get("after", ["0"])[0]), int(query.get("limit", ["100"])[0])))
    elif action == "export.zip":
        handler.send(200, ops.export(ident), "application/zip", ident + ".zip")
    elif action.startswith("sources/"):
        metadata, raw = ops.source(ident, action.split("/")[1])
        # All original documents are downloads, never executable inline content.
        safe_name = re.sub(r'[^A-Za-z0-9._ -]', "_", metadata["filename"])
        handler.send(200, raw, "application/octet-stream", safe_name)
    else:
        handler.send(200, ops.review(ident, action.split("/")[1]))
    return True


def write(handler, parsed):
    if not parsed.path.startswith("/api/operations"):
        return False
    ops, path = store(handler), parsed.path
    if path == "/api/operations/import":
        query = parse_qs(parsed.query)
        result = ops.import_bundle(handler.raw_body(), query.get("name", ["Imported delivery operations"])[0],
                                   handler.headers.get("X-Request-ID"), unquote(handler.headers.get("X-Recorded-By", "")))
    elif path == "/api/operations/intake":
        from operations_intake import import_source_intake
        body = handler.json_body()
        raw = decoded(body.pop("packetBase64", None))
        result = import_source_intake(ops, raw, body)
    elif path == "/api/operations":
        result = ops.create(handler.json_body())
    else:
        match = re.fullmatch(r"/api/operations/(operation-[a-f0-9]{32})/command", path)
        if not match:
            raise Problem("Operations command not found.", 404, "NOT_FOUND")
        result = ops.command(match.group(1), handler.json_body())
    handler.send(200, result)
    return True
