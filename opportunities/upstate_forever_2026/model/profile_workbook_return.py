"""Return saved scientific profile values to an explicitly mapped original workbook.

TokenJunkieLabs. Derived workbooks are new immutable artifacts. Original native
profiles, reviews, coefficient tables and workbook sources remain unchanged.
"""
from __future__ import annotations
from copy import deepcopy
import csv
import hashlib
import html
import io
import json
import os
from pathlib import Path
import stat

from . import profile_editions
from . import profile_workbook_xml as workbook_xml
from .common import (atomic_bytes, atomic_json, describe_file, digest, file_digest,
                     held, identifier, now, read_json, relative_file, verify_file,
                     _fd_stat, _path_stat, _native_fs_path)
from .portable_fs import open_file as _open_native_file
from .model_selection import selected

SCHEMA = "upstate.profile-workbook-return/v1"
ROOT = "profile-workbook-returns"
ACTION = "profile.workbook_return.create"
MAX_MAPPINGS = 100000
MAX_TEXT = 20000


def _need(condition, message):
    if not condition:
        raise ValueError(message)


def _text(value, name, required=True, limit=MAX_TEXT):
    _need(isinstance(value, str) and len(value) <= limit and "\0" not in value,
          "Enter complete " + name + " within its supported size.")
    _need(not required or bool(value.strip()), "Enter " + name + ".")
    return value


def _equal(left, right):
    return digest(left) == digest(right)


def _source(value):
    _need(isinstance(value, dict), "Choose an exact saved profile field.")
    kind = value.get("kind")
    if kind == "table":
        _need(set(value) == {"kind", "lucode", "column"}, "Choose one complete native coefficient identity.")
        lucode = _text(value["lucode"], "original land-cover code", limit=80)
        column = _text(value["column"], "original coefficient column", limit=200)
        return {"kind": kind, "lucode": lucode, "column": column}
    _need(kind == "parameter" and set(value) == {"kind", "model", "name"},
          "Choose a saved coefficient or native model parameter.")
    _need(value["model"] in ("ndr", "sdr"), "Choose the saved native model.")
    return {"kind": kind, "model": value["model"],
            "name": _text(value["name"], "native parameter name", limit=200)}


def _source_key(value):
    return digest(_source(value))


def _book_choice(value, *, require_sha=True):
    _need(isinstance(value, dict), "Choose the original workbook.")
    _need(set(value) <= {"source_collection_id", "source_id", "part", "sha256"},
          "Workbook selection contains unsupported fields.")
    result = {"source_collection_id": identifier(value.get("source_collection_id")),
              "source_id": _text(value.get("source_id"), "original source identifier", limit=200),
              "part": value.get("part", 0)}
    _need(type(result["part"]) is int and result["part"] >= 0, "Choose an original source part.")
    if require_sha or value.get("sha256") is not None:
        result["sha256"] = identifier(value.get("sha256"))
    return result


def _selection(value, *, require_preview=False):
    _need(isinstance(value, dict), "Review the complete profile workbook return.")
    allowed = {"profile_id", "workbook", "title", "author", "reason", "mappings", "exclusions", "preview_sha256"}
    _need(not set(value) - allowed, "Return selection has unsupported fields.")
    mappings = value.get("mappings", [])
    exclusions = value.get("exclusions", [])
    _need(isinstance(mappings, list) and isinstance(exclusions, list) and
          len(mappings) + len(exclusions) <= MAX_MAPPINGS, "Retain the complete supported mapping and exclusions.")
    mapped, excluded, destinations = [], [], set()
    source_ids = set()
    for row in mappings:
        _need(isinstance(row, dict) and set(row) == {"sheet", "cell", "source"},
              "Map each saved profile field to a worksheet and A1 cell.")
        source = _source(row["source"]); source_id = _source_key(source)
        sheet = _text(row["sheet"], "worksheet name", limit=100)
        cell = _text(row["cell"], "original A1 address", limit=12)
        workbook_xml.coordinates(cell)
        _need(source_id not in source_ids, "Map or exclude each saved profile field exactly once.")
        _need((sheet, cell) not in destinations, "Each original workbook cell may receive only one profile field.")
        destinations.add((sheet, cell)); source_ids.add(source_id)
        mapped.append({"source": source, "sheet": sheet, "cell": cell})
    for row in exclusions:
        _need(isinstance(row, dict) and set(row) == {"source", "reason"}, "Name every intentionally unreturned profile field.")
        source = _source(row["source"]); source_id = _source_key(source)
        _need(source_id not in source_ids, "Do not both map and exclude the same saved profile field.")
        source_ids.add(source_id)
        excluded.append({"source": source, "reason": _text(row["reason"], "exclusion reason")})
    result = {"profile_id": identifier(value.get("profile_id")),
              "workbook": _book_choice(value.get("workbook")),
              "title": _text(value.get("title"), "derived workbook title", limit=300),
              "author": _text(value.get("author"), "preparer name", limit=300),
              "reason": _text(value.get("reason"), "scientific return purpose"),
              "mappings": mapped, "exclusions": excluded}
    if require_preview:
        result["preview_sha256"] = identifier(value.get("preview_sha256"))
    return result


def _read_exact(path, body, *, digest_only=False):
    """Receive original file bytes under the same native platform identity."""
    path = _native_fs_path(path)
    before = _path_stat(path)
    size = body["bytes"]
    _need(stat.S_ISREG(before.st_mode) and before.st_size == size
          and size <= workbook_xml.h.MAX_EXPANDED,
          "The complete original file is missing or exceeds its retained size.")
    with os.fdopen(_open_native_file(path, os.O_RDONLY), "rb") as stream:
        opened = _fd_stat(stream.fileno())
        if digest_only:
            checksum, count = hashlib.sha256(), 0
            for block in iter(lambda: stream.read(1024 * 1024), b""):
                checksum.update(block)
                count += len(block)
            raw = None
        else:
            raw = stream.read(size + 1)
            count = len(raw)
            checksum = hashlib.sha256(raw)
        after_fd = _fd_stat(stream.fileno())
    after = _path_stat(path)
    def identity(value):
        return (value.st_dev, value.st_ino, value.st_size,
                value.st_mtime_ns, value.st_ctime_ns)
    _need(stat.S_ISREG(opened.st_mode) and
          identity(before) == identity(opened) ==
          identity(after_fd) == identity(after) and
          count == size and checksum.hexdigest() == body["sha256"],
          "The original source bytes changed while they were read.")
    return raw


def _original(ws, value):
    chosen = _book_choice(value, require_sha=False)
    collection = ws._get("sources", chosen["source_collection_id"])
    entry = next((x for x in collection["entries"] if x["id"] == chosen["source_id"]), None)
    _need(entry is not None, "Choose an actual retained original source.")
    bodies = [entry["body"], *entry.get("companions", [])]
    _need(chosen["part"] < len(bodies), "Selected original source part is absent.")
    body = bodies[chosen["part"]]
    filename = body.get("view_path") or body.get("filename") or ""
    _need(Path(filename).suffix.lower() in (".xlsx", ".xlsm"), "Choose a retained XLSX or XLSM original.")
    _need(chosen.get("sha256", body["sha256"]) == body["sha256"], "Reopen the exact original workbook edition.")
    path = relative_file(ws.root, body["object"])
    raw = _read_exact(path, body)
    descriptor = {**chosen, "sha256": body["sha256"], "bytes": body["bytes"],
                  "filename": Path(filename).name, "title": entry["title"],
                  "collection_title": collection["title"], "uri": entry.get("uri"),
                  "vintage": entry.get("vintage")}
    return descriptor, raw


def profile(ws, profile_id):
    current = profile_editions.inspect(ws, identifier(profile_id))
    saved, table = current["profile"], current["table"]
    methods = profile_editions.methods()
    table_rules = {row["name"]: row for row in methods["table_fields"]}
    fields = []
    for row_number, row in enumerate(table["rows"], 1):
        for column in table["columns"]:
            if column == "lucode":
                continue
            source = {"kind": "table", "lucode": row["lucode"], "column": column}
            rule = table_rules.get(column, {})
            fields.append({"key": _source_key(source), "source": source,
                           "label": "Land-cover " + row["lucode"] + " · " + rule.get("label", column),
                           "value": row[column], "text": row[column], "value_type": "coefficient_text",
                           "units": rule.get("units", "Not declared by the native field catalog"),
                           "reference": rule.get("reference"), "native_row": row_number,
                           "models": rule.get("models", []),
                           "cell_type": "number" if rule.get("type") in ("number", "integer") and row[column] != "" else "text"})
    for model in selected(saved):
        rules = {row["name"]: row for row in methods["parameters"][model]}
        for name, value in saved[model].items():
            _need(value is None or type(value) in (str, int, float, bool), "Saved model parameters must be scalar.")
            source = {"kind": "parameter", "model": model, "name": name}
            rule = rules.get(name, {})
            text = "" if value is None else json.dumps(value, ensure_ascii=False, allow_nan=False) if type(value) in (int, float, bool) else value
            fields.append({"key": _source_key(source), "source": source,
                           "label": model.upper() + " · " + rule.get("label", name),
                           "value": value, "text": text, "value_type": "null" if value is None else type(value).__name__,
                           "units": rule.get("units", "Not declared by the native field catalog"),
                           "reference": rule.get("reference"), "models": [model],
                           "cell_type": "blank" if value is None else "boolean" if type(value) is bool else "number" if type(value) in (int, float) else "text"})
    _need(len({x["key"] for x in fields}) == len(fields), "Saved native source field identities repeat.")
    return {"schema": SCHEMA, "project_id": ws.project["id"], "profile_id": saved["id"],
            "profile": saved, "profile_sha256": file_digest(ws.root / "profiles" / (saved["id"] + ".json")),
            "table": table, "source_values": fields, "review_state": current["review_state"],
            "lineage": current["lineage"]}


def _summary(result):
    return {key: deepcopy(result[key]) for key in ("id", "profile_id", "title", "author", "reason", "created_at",
                                                  "changed_cell_count", "mapped_count", "excluded_count", "workbook")}


def catalog(ws):
    books, seen = [], set()
    for collection in ws.sources():
        for entry in collection["entries"]:
            for part, body in enumerate([entry["body"], *entry.get("companions", [])]):
                name = body.get("view_path") or body.get("filename") or ""
                if Path(name).suffix.lower() not in (".xlsx", ".xlsm"):
                    continue
                # Distinct source editions stay distinct. Repeated companion
                # views are not silently substituted for a chosen original.
                key = collection["id"], entry["id"], part
                if key in seen: continue
                seen.add(key)
                books.append({"source_collection_id": collection["id"], "source_id": entry["id"], "part": part,
                              "sha256": body["sha256"], "bytes": body["bytes"], "filename": Path(name).name,
                              "title": entry["title"], "collection_title": collection["title"]})
    returns = []
    for path in sorted((ws.root / ROOT).glob("*/result.json")):
        record = read_json(path)
        _need(record["project_id"] == ws.project["id"], "Retained return belongs to another project.")
        returns.append(_summary(record))
    return {"schema": SCHEMA, "project_id": ws.project["id"],
            "profiles": [{"id": p["id"], "title": p["title"], "source_collection_id": p["source_collection_id"],
                          "biophysical_source_id": p["biophysical_source_id"]} for p in ws._list("profiles")],
            "workbooks": books, "returns": returns,
            "limits": {"original_bytes": workbook_xml.MAX_ORIGINAL, "mapped_fields": MAX_MAPPINGS, "page_cells": 500}}


def _source_ancestry(ws, current):
    """Follow retained native derivations, checking both declared source hashes."""
    references = [(current["profile"]["source_collection_id"], current["profile"]["biophysical_source_id"], current["table"]["sha256"])]
    for edition in current["lineage"]:
        original = edition.get("original_table") or {}
        if original.get("source_collection_id") and original.get("biophysical_source_id"):
            references.append((original["source_collection_id"], original["biophysical_source_id"], original["sha256"]))
    pending = list(references)
    visited, entries, records, edges = {}, [], [], {}
    while pending:
        collection_id, source_id, expected = pending.pop(0)
        key = (identifier(collection_id), source_id)
        if key in visited:
            _need(visited[key] == expected, "Profile lineage gives conflicting original table hashes.")
            continue
        _need(len(visited) < 1000, "Profile source ancestry exceeds the supported complete lineage.")
        collection = ws._get("sources", collection_id)
        entry = next((x for x in collection["entries"] if x["id"] == source_id), None)
        _need(entry is not None and entry["body"]["sha256"] == expected, "Original profile source ancestry is absent or changed.")
        path, native_entry = ws.source_file(collection_id, source_id)
        _read_exact(path, native_entry["body"], digest_only=True)
        visited[key] = expected
        entries.append(entry)
        record = {"source_collection_id": collection_id, "source_id": source_id, "sha256": expected,
                  "source": deepcopy(entry)}
        derivation = entry.get("derivation")
        declared = current["profile"].get("experiment_derivation", {}).get("biophysical")
        if key == (current["profile"]["source_collection_id"], current["profile"]["biophysical_source_id"]) and declared:
            _need(_equal(declared, derivation), "Saved experimental profile and original table derivation differ.")
        if isinstance(derivation, dict) and derivation.get("schema") == "upstate.biophysical-derivation/v1":
            _need(
                  derivation.get("derived_sha256") == expected,
                  "Use the original complete biophysical derivation and its derived hash.")
            original_collection = identifier(derivation.get("original_source_collection_id"))
            original_id = _text(derivation.get("original_source_id"), "derived original source identifier", limit=200)
            original_sha = identifier(derivation.get("original_sha256"))
            _need((original_collection, original_id) != key, "Original biophysical derivation contains a self-cycle.")
            matching = [body for body in entry.get("companions", [])
                        if Path(body.get("view_path") or body.get("filename") or "").name == "lineage.json"]
            _need(len(matching) == 1, "Retain the exact original biophysical lineage document.")
            raw = _read_exact(relative_file(ws.root, matching[0]["object"]), matching[0])
            _need(_equal(json.loads(raw), derivation), "Biophysical lineage and retained source metadata differ.")
            base = ws._get("profiles", identifier(derivation["base_profile_id"]))
            _need(base["source_collection_id"] == original_collection and base["biophysical_source_id"] == original_id and
                  base["table_summary"]["sha256"] == original_sha,
                  "Biophysical derivation no longer matches its original native base profile.")
            edges[key] = (original_collection, original_id)
            pending.append((original_collection, original_id, original_sha))
        records.append(record)
    for origin in edges:
        trail = set(); node = origin
        while node in edges:
            _need(node not in trail, "Original biophysical source derivation contains a cycle.")
            trail.add(node); node = edges[node]
    return entries, records


def _suggestions(ws, profile_id, descriptor, raw):
    current = profile(ws, profile_id)
    entries, ancestry = _source_ancestry(ws, current)
    matches = []
    for entry in entries:
        client = entry.get("client_source") or {}
        projection = entry.get("field_projection") or {}
        if client.get("source_sha256") != descriptor["sha256"] or not projection.get("original_sheet"):
            continue
        choices = client.get("selection") or {}
        if choices.get("confirmed") is not True:
            continue
        mapping = projection.get("mapping") or {}
        if "lucode" not in mapping: continue
        matches.append((entry, projection, mapping))
    if not matches:
        return {"mappings": [], "issues": ["This profile has no retained original workbook projection. Choose every destination explicitly."],
                "source_ancestry": ancestry}
    signatures = {digest({"sheet": p["original_sheet"], "header": p["original_header_row"], "mapping": m}) for _, p, m in matches}
    if len(signatures) != 1:
        return {"mappings": [], "issues": ["Profile lineage has different original worksheet mappings. Inspect and choose each destination explicitly."]}
    entry, projection, mapping = matches[0]
    package = workbook_xml._parts(raw)
    _, records, _ = workbook_xml._sheet(package, projection["original_sheet"])
    rows = {}
    for item in records:
        rows.setdefault(item["row"], {})[item["column"]] = item
    def column(field):
        _need(isinstance(field, str) and re_full_column(field), "Retained original column identity is invalid.")
        return int(field[1:]) + 1
    key_column = column(mapping["lucode"])
    codes = {}
    for number, cells in rows.items():
        if number <= projection["original_header_row"]: continue
        original = cells.get(key_column)
        if original is None or original["value"] is None: continue
        try:
            value = workbook_xml.Decimal(original["value"])
            if not value.is_finite() or value != value.to_integral_value(): continue
            code = str(int(value))
        except (workbook_xml.InvalidOperation, ValueError): continue
        codes.setdefault(code, []).append((number, cells))
    suggestions, issues = [], []
    for field in current["source_values"]:
        source = field["source"]
        if source["kind"] != "table" or source["column"] not in mapping: continue
        try: code = str(int(source["lucode"]))
        except ValueError: continue
        matching = codes.get(code, [])
        if len(matching) != 1:
            issues.append(field["label"] + ": original land-cover row is missing or ambiguous.")
            continue
        number, cells = matching[0]; cell = cells.get(column(mapping[source["column"]]))
        if cell is None:
            issues.append(field["label"] + ": original destination cell is absent.")
            continue
        suggestions.append({"sheet": projection["original_sheet"], "cell": cell["cell"], "source": source})
    return {"mappings": suggestions, "issues": issues,
            "source_ancestry": ancestry,
            "basis": {"original_source_id": entry["id"], "field_projection": deepcopy(projection),
                      "meaning": "Retained original column map and exact original land-cover codes; explicitly apply before preview."}}


def re_full_column(value):
    return len(value) > 1 and value[0] == "c" and value[1:].isdigit() and int(value[1:]) < 16384


def book(ws, value):
    _need(isinstance(value, dict), "Select the original workbook and page.")
    chosen = {key: value[key] for key in ("source_collection_id", "source_id", "part", "sha256") if key in value}
    descriptor, raw = _original(ws, chosen)
    result = workbook_xml.inspect(raw, sheet=value.get("sheet"), offset=value.get("offset", 0), limit=value.get("limit", 100))
    if value.get("cell") is not None:
        _need(isinstance(value.get("sheet"), str), "Choose the original worksheet for the exact cell.")
        cell = workbook_xml.cell_records(raw, [{"sheet": value["sheet"], "cell": value["cell"]}])[(value["sheet"], value["cell"])]
        result.update(cells=[cell], total=1, offset=0, limit=1, next_offset=None)
    result.update(schema=SCHEMA, project_id=ws.project["id"], workbook=descriptor)
    if value.get("profile_id"):
        result["suggestions"] = _suggestions(ws, value["profile_id"], descriptor, raw)
    return result



def _same_cell(cell, field):
    kind = field["cell_type"]
    if kind == "blank":
        return cell["value"] is None and cell["type"] == "n"
    if kind == "text":
        return cell["type"] in ("s", "inlineStr", "str") and cell["value"] == field["text"]
    if kind == "number":
        return cell["type"] == "n" and cell["value"] == field["text"]
    if kind == "boolean":
        return cell["type"] == "b" and cell["value"] in (("true", "1") if field["value"] else ("false", "0"))
    raise ValueError("Unsupported saved native field type.")


def preview(ws, value):
    selection = _selection(value)
    selected_profile = profile(ws, selection["profile_id"])
    descriptor, raw = _original(ws, selection["workbook"])
    _, ancestry = _source_ancestry(ws, selected_profile)
    fields = {x["key"]: x for x in selected_profile["source_values"]}
    targets = workbook_xml.cell_records(raw, selection["mappings"])
    accounted, mappings, changes, issues = set(), [], [], []
    for row in selection["mappings"]:
        key = _source_key(row["source"])
        _need(key in fields, "Mapped field is absent from this exact saved profile.")
        accounted.add(key); field = fields[key]; cell = targets[(row["sheet"], row["cell"])]
        item = {**row, "source_value": deepcopy(field), "original": cell,
                "value": field["text"], "cell_type": field["cell_type"], "original_cell_sha256": cell["original_cell_sha256"],
                "changed": not _same_cell(cell, field)}
        if not cell["selectable"]:
            issues.append({"code": "BLOCKED_CELL", "source": row["source"], "sheet": row["sheet"], "cell": row["cell"],
                           "message": "Choose another destination or explicitly exclude this field: " + ", ".join(cell["issues"])})
        mappings.append(item)
        if item["changed"]: changes.append(item)
    exclusions = []
    for row in selection["exclusions"]:
        key = _source_key(row["source"])
        _need(key in fields, "Excluded field is absent from this saved profile.")
        accounted.add(key)
        exclusions.append({**row, "source_value": deepcopy(fields[key])})
    unassigned = [x for key, x in fields.items() if key not in accounted]
    for item in unassigned:
        issues.append({"code": "UNASSIGNED_FIELD", "source": item["source"],
                       "message": "Map or explicitly exclude " + item["label"] + "."})
    for item in mappings:
        if item["cell_type"] == "number":
            numeric = item["value"]
            try:
                valid = bool(workbook_xml.NUMBER.fullmatch(numeric)) and workbook_xml.Decimal(numeric).is_finite()
            except workbook_xml.InvalidOperation:
                valid = False
            if not valid:
                issues.append({"code": "NUMERIC_VALUE", "source": item["source"], "message": "The saved native numeric field is not a finite complete number."})
        elif workbook_xml.h.utf16_length(item["value"]) > workbook_xml.h.MAX_CELL:
            issues.append({"code": "CELL_CAPACITY", "source": item["source"], "message": "The complete saved value exceeds Excel cell capacity; no text was shortened."})
    if not changes:
        issues.append({"code": "NO_CHANGED_CELL", "message": "The selected fields do not change an original cell; retain the original workbook."})
    result = {"schema": SCHEMA, "project_id": ws.project["id"], "selection": selection,
              "profile": selected_profile["profile"], "profile_sha256": selected_profile["profile_sha256"],
              "table_sha256": selected_profile["table"]["sha256"], "workbook": descriptor,
              "source_values": selected_profile["source_values"], "source_ancestry": ancestry, "mappings": mappings, "changes": changes,
              "exclusions": exclusions, "unassigned": unassigned, "issues": issues, "eligible": not issues,
              "mapped_count": len(mappings), "changed_cell_count": len(changes), "excluded_count": len(exclusions),
              "scientific_status": "Derived file from a saved profile; no new scientific review or native model run.",
              "formula_status": "Formulas/macros/external links are preserved, not evaluated. Recalculate and inspect in the recipient spreadsheet application."}
    result["preview_sha256"] = digest(result)
    return result


def _directory(ws, operation_id):
    _text(operation_id, "original operation identity", limit=2000)
    return ws.root / ROOT / digest({"operation_id": operation_id})


def _implementation():
    return [("profile_workbook_return.py", Path(__file__)), ("profile_workbook_xml.py", Path(workbook_xml.__file__)),
            ("source_workbook_append.py", workbook_xml._HELPER)]


def _html(preview_value, title, files):
    e = lambda value: html.escape("" if value is None else str(value), quote=True)
    rows = []
    for item in preview_value["mappings"]:
        rows.append("<tr><td>" + e(item["source_value"]["label"]) + "</td><td>" + e(item["source_value"]["units"]) +
                    "</td><td>" + e(item["sheet"] + "!" + item["cell"]) + "</td><td>" + e(item["original"]["value"]) +
                    "</td><td>" + e(item["value"]) + "</td><td>" + ("Changed" if item["changed"] else "Unchanged") + "</td></tr>")
    excluded = "".join("<tr><td>" + e(x["source_value"]["label"]) + "</td><td>" + e(x["source_value"]["text"]) +
                       "</td><td>" + e(x["reason"]) + "</td></tr>" for x in preview_value["exclusions"])
    return ("<!doctype html><html lang='en'><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>"
            "<title>" + e(title) + "</title><style>body{font:16px/1.5 system-ui;color:#222;background:#fff;max-width:1200px;margin:2rem auto;padding:0 1rem}"
            "table{border-collapse:collapse;width:100%}th,td{border:1px solid #aaa;padding:.5rem;text-align:left;vertical-align:top;overflow-wrap:anywhere}"
            "th{background:#eee}.scroll{overflow:auto}a{color:inherit}p,li{overflow-wrap:anywhere}</style><main><h1>" + e(title) +
            "</h1><p>Prepared by " + e(preview_value["selection"]["author"]) + "</p><p>" + e(preview_value["selection"]["reason"]) +
            "</p><h2>Scientific identity</h2><p>Saved profile: " + e(preview_value["profile"]["title"]) + " · " +
            e(preview_value["profile"]["id"]) + "</p><p>Original workbook: " + e(preview_value["workbook"]["filename"]) +
            " · " + e(preview_value["workbook"]["sha256"]) + "</p><p>" + e(preview_value["scientific_status"]) +
            "</p><p><strong>" + e(preview_value["formula_status"]) + "</strong></p><h2>Every selected cell</h2>"
            "<div class='scroll'><table><thead><tr><th>Saved field</th><th>Native units</th><th>Original destination</th>"
            "<th>Original value</th><th>Saved profile value</th><th>Change</th></tr></thead><tbody>" + "".join(rows) +
            "</tbody></table></div><h2>Explicit exclusions</h2><div class='scroll'><table><thead><tr><th>Saved field</th><th>Saved value</th>"
            "<th>Reason</th></tr></thead><tbody>" + excluded + "</tbody></table></div><h2>Complete originals and result</h2><ul>" +
            "".join("<li><a href='" + e(row["path"].split("/files/", 1)[-1]) + "'>" + e(name) + "</a> · " + e(row["sha256"]) + "</li>"
                    for name, row in files.items()) + "</ul><footer><p>Prepared with the TokenJunkieLabs Eco Profile Workbench.</p></footer></main></html>\n")


def _verify_result(ws, result):
    _need(result["schema"] == SCHEMA and result["project_id"] == ws.project["id"], "Retained return project identity changed.")
    directory = ws.root / ROOT / identifier(result["id"])
    intent = read_json(directory / "intent.json")
    _need(intent["project_id"] == ws.project["id"] and intent["request_sha256"] == result["request_sha256"] and
          intent["operation_id"] == result["operation_id"] and digest(intent["request"]) == result["request_sha256"],
          "Retained return request and first receipt differ.")
    _need(_equal(result.get("context"), intent.get("context")), "Retained original task context differs.")
    required = {"original_workbook", "derived_workbook", "preview", "package_review", "selection", "profile", "coefficients", "changes_csv", "html",
                *("implementation_" + name for name in intent["implementation"])}
    _need(set(result["files"]) == required, "The complete returned file inventory differs.")
    for descriptor in result["files"].values():
        path = verify_file(ws.root, descriptor)
        _need(path.is_relative_to((directory / "files").resolve()), "Returned file leaves its original operation.")
    retained_preview = read_json(verify_file(ws.root, result["files"]["preview"]))
    _need(retained_preview["preview_sha256"] == result["preview_sha256"] and
          digest({k: v for k, v in retained_preview.items() if k != "preview_sha256"}) == result["preview_sha256"],
          "Retained changed-cell preview identity differs.")
    _need(retained_preview["profile"]["id"] == result["profile_id"] and _equal(retained_preview["workbook"], result["workbook"]),
          "Returned workbook/profile binding differs.")
    _need(_equal(intent["request"], {**retained_preview["selection"], "preview_sha256": result["preview_sha256"]}),
          "Original operation no longer selects its exact preview.")
    for key in ("title", "author", "reason"):
        _need(result[key] == retained_preview["selection"][key], "Retained return description differs from its original request.")
    for key in ("mapped_count", "changed_cell_count", "excluded_count"):
        _need(type(result[key]) is int and result[key] == retained_preview[key], "Retained return count differs.")
    _need(result["created_at"] == intent["created_at"], "Retained original return creation time differs.")
    _need(result["files"]["original_workbook"]["sha256"] == result["workbook"]["sha256"] and
          result["files"]["original_workbook"]["bytes"] == result["workbook"]["bytes"], "The original workbook copy differs.")
    _need(result["files"]["profile"]["sha256"] == retained_preview["profile_sha256"] and
          result["files"]["coefficients"]["sha256"] == retained_preview["table_sha256"], "Saved native profile/table copy differs.")
    package_review = read_json(verify_file(ws.root, result["files"]["package_review"]))
    _need(package_review["original_sha256"] == result["workbook"]["sha256"] and
          package_review["sha256"] == result["files"]["derived_workbook"]["sha256"] and
          package_review["bytes"] == result["files"]["derived_workbook"]["bytes"], "Derived workbook member receipt differs.")
    _need(_equal(read_json(verify_file(ws.root, result["files"]["selection"])), intent["request"]), "Returned selection differs from the original request.")
    profile_path = ws.root / "profiles" / (result["profile_id"] + ".json")
    _need(file_digest(profile_path) == retained_preview["profile_sha256"], "Original saved profile changed.")
    return result


def inspect(ws, return_id):
    result = read_json(ws.root / ROOT / identifier(return_id) / "result.json")
    _need(result["id"] == return_id, "Retained workbook return changed its selected ID.")
    _verify_result(ws, result)
    return {**deepcopy(result), "preview": read_json(verify_file(ws.root, result["files"]["preview"]))}


def operation(ws, operation_id):
    directory = _directory(ws, operation_id)
    path = directory / "intent.json"
    if not path.exists():
        return {"schema": SCHEMA, "project_id": ws.project["id"], "operation_id": operation_id, "state": "NOT_FOUND", "result": None}
    intent = read_json(path)
    _need(intent["operation_id"] == operation_id and intent["project_id"] == ws.project["id"],
          "Original return operation belongs to another project.")
    result_path = directory / "result.json"
    result = inspect(ws, directory.name) if result_path.exists() else None
    return {"schema": SCHEMA, "project_id": ws.project["id"], "operation_id": operation_id,
            "state": "COMPLETE" if result else "PREPARED", "request": intent["request"],
            "request_sha256": intent["request_sha256"], "context": intent.get("context"), "result": result}


def create(ws, value, *, operation_id=None, context=None):
    request = _selection(value, require_preview=True)
    request_sha = digest(request)
    operation_id = operation_id or "profile-workbook-return:" + request_sha
    directory = _directory(ws, operation_id)
    _need(context is None or isinstance(context, dict), "Retain the complete original task context.")
    with held(directory / ".operation.lock"):
        with held(ws.root / ".workspace.lock", blocking=False):
            intent_path = directory / "intent.json"
            if intent_path.exists():
                intent = read_json(intent_path)
                _need(intent["request_sha256"] == request_sha and _equal(intent["request"], request) and
                      intent["project_id"] == ws.project["id"] and intent["operation_id"] == operation_id,
                      "This original operation already belongs to another complete return request.")
                _need(context is None or _equal(context, intent.get("context")), "Original task context changed.")
                if (directory / "result.json").exists():
                    return inspect(ws, directory.name)
                for name, path in _implementation():
                    _need(file_digest(path) == intent["implementation"][name]["sha256"],
                          "Continue this prepared return with its retained original source edition.")
            else:
                proposed = preview(ws, request)
                _need(proposed["eligible"] and proposed["preview_sha256"] == request["preview_sha256"],
                      "Review the complete current original-cell preview before creating this derived workbook.")
                implementation = {}
                for name, path in _implementation():
                    target = directory / "files" / "implementation" / name
                    source_body = describe_file(path.parent, path)
                    atomic_bytes(target, _read_exact(path, source_body), immutable=True)
                    implementation[name] = describe_file(ws.root, target)
                intent = {"schema": SCHEMA, "project_id": ws.project["id"], "id": directory.name,
                          "operation_id": operation_id, "request": request, "request_sha256": request_sha,
                          "created_at": now(), "context": deepcopy(context), "implementation": implementation}
                atomic_json(intent_path, intent, immutable=True)
            proposed = preview(ws, request)
            _need(proposed["eligible"] and proposed["preview_sha256"] == request["preview_sha256"],
                  "Retained source/profile/cell selection differs; keep this operation and prepare an explicit new return.")
            descriptor, original = _original(ws, request["workbook"])
            files_root = directory / "files"
            files = {}
            def write(name, filename, data, media_type):
                target = files_root / filename
                atomic_bytes(target, data, immutable=True)
                files[name] = describe_file(ws.root, target, media_type=media_type)
            def write_json(name, filename, body):
                write(name, filename, (json.dumps(body, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False) + "\n").encode("utf-8"),
                      "application/json")
            suffix = Path(descriptor["filename"]).suffix.lower()
            write("original_workbook", "original" + suffix, original,
                  "application/vnd.ms-excel.sheet.macroEnabled.12" if suffix == ".xlsm" else
                  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
            derived_path = files_root / ("derived-profile" + suffix)
            existing = None
            if derived_path.exists():
                descriptor = describe_file(ws.root, derived_path)
                existing = _read_exact(derived_path, descriptor)
            rendered, package_review = workbook_xml.render(original, proposed["changes"], existing=existing)
            write("derived_workbook", "derived-profile" + suffix, rendered, files["original_workbook"]["media_type"])
            write_json("preview", "cell-preview.json", proposed)
            write_json("package_review", "workbook-members.json", package_review)
            write_json("selection", "return-selection.json", request)
            profile_path = ws.root / "profiles" / (request["profile_id"] + ".json")
            profile_body = describe_file(ws.root, profile_path)
            _need(profile_body["sha256"] == selected_profile["profile_sha256"],
                  "Original saved profile differs from the selected edition.")
            write("profile", "saved-profile.json",
                  _read_exact(profile_path, profile_body), "application/json")
            selected_profile = profile(ws, request["profile_id"])
            table_path, entry = ws.source_file(selected_profile["profile"]["source_collection_id"],
                                               selected_profile["profile"]["biophysical_source_id"])
            write("coefficients", "saved-coefficients.csv", _read_exact(table_path, entry["body"]), "text/csv")
            csv_buffer = io.StringIO(newline="")
            writer = csv.writer(csv_buffer, lineterminator="\n")
            writer.writerow(["source_kind", "source_identity", "label", "units", "sheet", "cell", "original_value", "profile_value", "changed", "exclusion_reason"])
            for row in proposed["mappings"]:
                writer.writerow([row["source"]["kind"], json.dumps(row["source"], ensure_ascii=False, sort_keys=True),
                                 row["source_value"]["label"], row["source_value"]["units"], row["sheet"], row["cell"],
                                 row["original"]["value"], row["value"], str(row["changed"]).lower(), ""])
            for row in proposed["exclusions"]:
                writer.writerow([row["source"]["kind"], json.dumps(row["source"], ensure_ascii=False, sort_keys=True),
                                 row["source_value"]["label"], row["source_value"]["units"], "", "", "", row["source_value"]["text"], "", row["reason"]])
            write("changes_csv", "cell-changes.csv", csv_buffer.getvalue().encode("utf-8"), "text/csv")
            files.update({"implementation_" + name: item for name, item in intent["implementation"].items()})
            write("html", "index.html", _html(proposed, request["title"], files).encode("utf-8"), "text/html")
            result = {"schema": SCHEMA, "id": directory.name, "project_id": ws.project["id"],
                      "operation_id": operation_id, "request_sha256": request_sha, "context": intent.get("context"),
                      "preview_sha256": proposed["preview_sha256"], "profile_id": request["profile_id"],
                      "title": request["title"], "author": request["author"], "reason": request["reason"],
                      "workbook": proposed["workbook"], "created_at": intent["created_at"],
                      "mapped_count": proposed["mapped_count"], "changed_cell_count": proposed["changed_cell_count"],
                      "excluded_count": proposed["excluded_count"], "files": files}
            atomic_json(directory / "result.json", result, immutable=True)
            return inspect(ws, directory.name)


def verify_all(ws):
    records, pending = [], []
    for path in sorted((ws.root / ROOT).glob("*/intent.json")):
        intent = read_json(path)
        _need(intent["id"] == path.parent.name and intent["project_id"] == ws.project["id"] and
              digest(intent["request"]) == intent["request_sha256"] and
              _directory(ws, intent["operation_id"]).name == intent["id"],
              "Retained workbook return intent differs.")
        for body in intent["implementation"].values(): verify_file(ws.root, body)
        if (path.parent / "result.json").exists():
            result = inspect(ws, path.parent.name)
            records.append(_summary(result))
        else:
            pending.append({"id": intent["id"], "operation_id": intent["operation_id"], "state": "PREPARED"})
    return {"schema": SCHEMA, "project_id": ws.project["id"], "returns": records, "pending": pending}
