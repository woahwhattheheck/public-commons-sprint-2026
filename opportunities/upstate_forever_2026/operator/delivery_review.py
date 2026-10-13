"""Read the retained client report through the original operator file tickets."""
from __future__ import annotations

import html
from html.parser import HTMLParser
import json
import posixpath
from urllib.parse import quote, unquote, urlencode, urlsplit

from model.delivery_review_version import REPORT_EDITION
from model.delivery_catalogue import REPORT_ROLES
from delivery_inspection import _snapshot, _url, preview as member_ticket

REPORT_LIMIT = 16 * 1024 * 1024


def _retained_bytes(operator, ticket, limit=REPORT_LIMIT):
    if ticket["bytes"] > limit:
        raise ValueError("The retained report exceeds the browser preview capacity. Download the original file.")
    stream, record = operator.open_download(ticket["id"])
    try:
        body = stream.read(limit + 1)
    finally:
        stream.close()
    if len(body) > limit or len(body) != record["bytes"]:
        raise ValueError("The retained report changed during preview. Reopen the delivery.")
    return body


def _files(operator, workspace, delivery_id, record):
    """Issue only the small fixed report set, never the complete GIS inventory."""
    result = {}
    for role in REPORT_ROLES:
        descriptor = (record.get("files") or {}).get(role)
        if descriptor is not None:
            ticket, _ = member_ticket(operator, workspace, delivery_id, descriptor["path"])
            result[role] = dict(ticket, role=role, relative_path=descriptor["path"])
    return result


def _relative(value, directory=""):
    if not isinstance(value, str) or not value or "\\" in value or "\0" in value:
        return None
    value = unquote(value)
    if ("\\" in value or any(ord(char) < 32 or ord(char) == 127 for char in value)
            or value.startswith("/") or ":" in value):
        return None
    result = posixpath.normpath(posixpath.join(directory, value))
    if result in {".", ".."} or result.startswith("../"):
        return None
    return result


class _LinkedReport(HTMLParser):
    """Keep the authored report, linking only registered retained local files."""

    def __init__(self, paths, directory=""):
        super().__init__(convert_charrefs=False)
        self.paths = paths
        self.directory = directory
        self.output = []

    def handle_decl(self, declaration):
        self.output.append("<!" + declaration + ">")

    def handle_starttag(self, tag, attrs):
        values = []
        anchor_target = None
        for name, value in attrs:
            if tag == "a" and name in {"target", "rel"}:
                continue
            if name in {"href", "src"} and value:
                url = urlsplit(value)
                if url.scheme in {"http", "https"} or (name == "src" and url.scheme == "data"):
                    if tag == "a":
                        anchor_target = "_blank"
                elif not url.scheme and not url.netloc and not url.path and url.fragment:
                    anchor_target = "_self"
                elif not url.scheme and not url.netloc:
                    retained = self.paths.get(_relative(url.path, self.directory))
                    if retained:
                        value = retained["url"]
                        if name == "href" and "download=1" in url.query.split("&"):
                            value += "?download=1"
                        if url.fragment:
                            value += "#" + quote(url.fragment, safe="=&")
                        if tag == "a":
                            anchor_target = "_blank"
                    else:
                        value = "#" if name == "href" else ""
                        if tag == "a":
                            values.append(("title", "Open this reference from the complete delivery download."))
                else:
                    value = "#" if name == "href" else ""
            values.append((name, value))
        if tag == "a" and anchor_target:
            values.extend([("target", anchor_target), ("rel", "noopener noreferrer")])
        rendered = "".join(
            " " + name + ("" if value is None else '="' + html.escape(value, quote=True) + '"')
            for name, value in values
        )
        self.output.append("<" + tag + rendered + ">")

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        self.output[-1] = self.output[-1][:-1] + " />"

    def handle_endtag(self, tag):
        self.output.append("</" + tag + ">")

    def handle_data(self, data):
        self.output.append(data)

    def handle_entityref(self, name):
        self.output.append("&" + name + ";")

    def handle_charref(self, name):
        self.output.append("&#" + name + ";")

    def handle_comment(self, data):
        self.output.append("<!--" + data + "-->")


def read(operator, workspace, delivery_id, *, preview=False, report="scientific"):
    if report not in {"scientific", "client"}:
        raise ValueError("Choose the retained scientific report or client companion.")
    _, snapshot = _snapshot(operator, workspace, delivery_id)
    record = snapshot["record"]
    files = _files(operator, workspace, delivery_id, record)
    selection = record.get("selection") or {}
    prefix = "client_" if report == "client" else ""
    selected_files = {role: files[prefix + role] for role in
                      ("report", "report_html", "report_markdown", "report_data", "report_model")
                      if prefix + role in files}
    result = {
        "schema": "upstate.delivery-review/v1",
        "id": record["id"],
        "state": record.get("state"),
        "title": selection.get("title") or "Scientific delivery",
        "current_report_edition": REPORT_EDITION,
        "report_edition": ((selection.get("client_report_edition") or record.get("report_edition") or "")
                           + "|" + (selection.get("report_renderer_version") or
                                      record.get("report_renderer_version") or "") + "|" +
                           (selection.get("client_companion_edition") or
                            record.get("client_companion_edition") or "")),
        "files": files,
        "selected_files": selected_files,
        "report_kind": report,
        "preview_url": None,
    }
    model = None
    report_role = "report_data" if selected_files.get("report_data") else "report_model"
    if selected_files.get(report_role):
        model = json.loads(_retained_bytes(operator, selected_files[report_role]))
        if not isinstance(model, dict):
            raise ValueError("The retained file is not a report model.")
        if isinstance(model.get("schema"), str) and model["schema"].startswith("upstate.scientific-report/v"):
            binding = model.get("binding")
            report_delivery = binding.get("delivery_id") if isinstance(binding, dict) else None
        elif model.get("schema") == "upstate.client-report/v1":
            report_delivery = model.get("delivery_id")
        else:
            raise ValueError("The retained file is not a supported report model.")
        if report_delivery != record["id"]:
            raise ValueError("The report belongs to another retained delivery.")
        result["title"] = model.get("title") or result["title"]
    if selected_files.get("report_html") and model is not None:
        result["preview_url"] = "/api/file/delivery-report?" + urlencode(
            {"workspace": workspace, "id": record["id"], "report": report})
    if preview:
        if not result["preview_url"]:
            raise ValueError("Create the current report edition before opening the report preview.")
        paths = {
            member: {"url": _url(workspace, record["id"], member)}
            for member in snapshot["inventory"]
        }
        report_path = _relative(selected_files["report_html"].get("relative_path")) or "report.html"
        report_directory = posixpath.dirname(report_path)
        parser = _LinkedReport(paths, report_directory)
        parser.feed(_retained_bytes(operator, selected_files["report_html"]).decode("utf-8"))
        parser.close()
        result["html"] = "".join(parser.output)
    return result


def send_preview(handler, workspace, delivery_id, *, report="scientific"):
    """The original handler authorizes its scoped file cookie before this call."""
    report = read(handler.app, workspace, delivery_id, preview=True, report=report)
    body = report["html"].encode("utf-8")
    handler.close_connection = True
    handler.send_response(200)
    handler.send_header("Content-Type", "text/html; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Connection", "close")
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("Referrer-Policy", "no-referrer")
    handler.send_header("X-Content-Type-Options", "nosniff")
    handler.send_header(
        "Content-Security-Policy",
        "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; "
        "script-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; "
        "frame-ancestors 'self'; sandbox allow-same-origin allow-popups "
        "allow-popups-to-escape-sandbox allow-downloads")
    handler.end_headers()
    handler.wfile.write(body)
