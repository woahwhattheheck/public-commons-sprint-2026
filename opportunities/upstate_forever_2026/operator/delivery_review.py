"""Read the retained client report through the original operator file tickets."""
from __future__ import annotations

import html
from html.parser import HTMLParser
import json
import posixpath
from urllib.parse import quote, unquote, urlencode, urlsplit

from model.delivery_review_version import REPORT_EDITION

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


def _ticket(record, descriptor):
    if not isinstance(descriptor, dict):
        return None
    matches = [
        item for item in record.get("_downloads", [])
        if item.get("sha256") == descriptor.get("sha256")
        and item.get("bytes") == descriptor.get("bytes")
    ]
    filename = descriptor.get("filename") or posixpath.basename(descriptor.get("path") or "")
    return next((item for item in matches if item.get("filename") == filename),
                matches[0] if matches else None)


def _files(record):
    result = {}
    for role, descriptor in (record.get("files") or {}).items():
        item = _ticket(record, descriptor)
        if item:
            result[role] = dict(item, role=role, relative_path=descriptor.get("path"))
    return result


def _relative(value):
    if not isinstance(value, str) or not value or "\\" in value or "\0" in value:
        return None
    value = unquote(value)
    if "\\" in value or "\0" in value or value.startswith("/"):
        return None
    result = posixpath.normpath(value)
    if result in {".", ".."} or result.startswith("../"):
        return None
    return result


class _LinkedReport(HTMLParser):
    """Keep the authored report, linking only registered retained local files."""

    def __init__(self, paths):
        super().__init__(convert_charrefs=False)
        self.paths = paths
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
                    retained = self.paths.get(_relative(url.path))
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


def read(operator, workspace, delivery_id, *, preview=False):
    record = operator.item(workspace, "deliveries", delivery_id)
    files = _files(record)
    selection = record.get("selection") or {}
    result = {
        "schema": "upstate.delivery-review/v1",
        "id": record["id"],
        "state": record.get("state"),
        "title": selection.get("title") or "Scientific delivery",
        "current_report_edition": REPORT_EDITION,
        "report_edition": ((selection.get("client_report_edition") or record.get("report_edition") or "")
                           + "|" + (selection.get("report_renderer_version") or
                                      record.get("report_renderer_version") or "")),
        "files": files,
        "preview_url": None,
    }
    model = None
    report_role = "report_data" if files.get("report_data") else "report_model"
    if files.get(report_role):
        model = json.loads(_retained_bytes(operator, files[report_role]))
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
    if files.get("report_html") and model is not None:
        result["preview_url"] = "/api/file/delivery-report?" + urlencode(
            {"workspace": workspace, "id": record["id"]})
    if preview:
        if not result["preview_url"]:
            raise ValueError("Create the current report edition before opening the report preview.")
        paths = {}
        for group in (record.get("files") or {}, record.get("maps") or {}):
            for descriptor in group.values():
                item = _ticket(record, descriptor)
                relative = _relative(descriptor.get("path")) if isinstance(descriptor, dict) else None
                if item and relative:
                    paths[relative] = item
        report_path = _relative(files["report_html"].get("relative_path")) or "report.html"
        report_directory = posixpath.dirname(report_path)
        links = {
            posixpath.relpath(path, report_directory or "."): item
            for path, item in paths.items()
        }
        parser = _LinkedReport(links)
        parser.feed(_retained_bytes(operator, files["report_html"]).decode("utf-8"))
        parser.close()
        result["html"] = "".join(parser.output)
    return result


def send_preview(handler, workspace, delivery_id):
    """The original handler authorizes its scoped file cookie before this call."""
    report = read(handler.app, workspace, delivery_id, preview=True)
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
