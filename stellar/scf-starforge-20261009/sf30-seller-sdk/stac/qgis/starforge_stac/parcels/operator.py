# SPDX-License-Identifier: MIT
"""Original analyst and CLI facade for the parcel workspace."""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import re

from ..model import QgisWorkspace, require, read_json, MAX_JSON, HASH
from .workspace import ParcelWorkspace, json_file
from . import portfolio, comparison, projection, review

ACTIONS = frozenset(("source.preview", "source.import", "source.select", "entity.save", "review.prepare", "review.preview", "review.save",
                     "successor.compare", "successor.review", "portfolio.preview", "portfolio.create", "comparison.preview", "comparison.create", "map.publish"))
WRITES = ACTIONS - {"source.preview", "review.prepare", "review.preview", "successor.compare", "portfolio.preview", "comparison.preview"}

def normalize(action, raw):
    keys = {
        "source.preview": {"directory", "expectedManifestSha256"},
        "source.import": {"directory", "expectedManifestSha256", "previewSha256"},
        "source.select": {"editionId"}, "entity.save": {"definition"},
        "review.prepare": {"editionId", "keys", "rules"},
        "review.preview": {"editionId", "decisions"},
        "review.save": {"editionId", "decisions", "previewSha256"},
        "successor.compare": {"leftEditionId", "rightEditionId"},
        "successor.review": {"definition"}, "portfolio.preview": {"definition"},
        "portfolio.create": {"definition", "previewSha256"}, "map.publish": {"portfolioId"},
        "comparison.preview": {"definition"}, "comparison.create": {"definition", "previewSha256"},
    }
    require(action in ACTIONS and isinstance(raw, dict) and set(raw) <= keys[action],
            "PARCEL_ACTION_INPUT", "Use the selected original parcel action fields.")
    value = dict(raw)
    optional = {"expectedManifestSha256"} if action == "source.preview" else {"previewSha256"} if action == "review.save" else set()
    required = keys[action] - optional
    require(required <= set(value), "PARCEL_ACTION_INPUT", "Keep every required field for this parcel action.")
    if "directory" in value:
        require(isinstance(value["directory"], str) and "\0" not in value["directory"] and
                Path(value["directory"]).expanduser().is_absolute(),
                "PARCEL_INPUT_DIRECTORY", "Select the complete original parcel source directory.")
        value["directory"] = str(Path(value["directory"]).expanduser().absolute())
    for field in ("expectedManifestSha256", "previewSha256", "editionId", "leftEditionId", "rightEditionId"):
        if field in value:
            require(isinstance(value[field], str) and HASH.fullmatch(value[field]),
                    "PARCEL_ACTION_IDENTITY", "Use the exact original source or preview SHA-256.", field=field)
    if action.startswith("comparison."):
        value["definition"] = comparison.definition(value["definition"])
    return value

def execute(workspace, action, payload, common, progress=None):
    payload = normalize(action, payload)
    parcel = ParcelWorkspace(workspace)
    if action == "source.preview":
        return parcel.preview(payload["directory"], payload.get("expectedManifestSha256"), progress=progress)
    if action == "source.import":
        return parcel.import_source(payload["directory"], expected_sha256=payload["expectedManifestSha256"],
            preview_sha256=payload["previewSha256"], progress=progress, **common)
    if action == "source.select": return parcel.select(payload["editionId"], **common)
    if action == "entity.save": return parcel.save_entity(payload["definition"], **common)
    if action == "review.prepare": return review.prepare(parcel, payload["editionId"], payload["keys"], payload["rules"])
    if action == "review.preview": return review.preview(parcel, payload["editionId"], payload["decisions"])
    if action == "review.save": return parcel.review(payload["editionId"], payload["decisions"],
                                                    preview_sha256=payload.get("previewSha256"), **common)
    if action == "successor.compare": return parcel.compare(payload["leftEditionId"], payload["rightEditionId"])
    if action == "successor.review": return parcel.review_successor(payload["definition"], **common)
    if action == "portfolio.preview": return portfolio.preview(parcel, payload["definition"])
    if action == "portfolio.create": return portfolio.create(parcel, payload["definition"], payload["previewSha256"], **common)
    if action == "comparison.preview": return comparison.preview(parcel, payload["definition"])
    if action == "comparison.create": return comparison.create(parcel, payload["definition"], payload["previewSha256"], **common)
    if action == "map.publish": return projection.publish(parcel, payload["portfolioId"], progress=progress, **common)
    raise AssertionError(action)

def _query(query, allowed):
    require(set(query) <= allowed and all(isinstance(value, list) and len(value) == 1 for value in query.values()),
            "PARCEL_QUERY", "Use one value for each supported parcel filter.")
    return {key: values[0] for key, values in query.items()}

def read_route(workspace, path, query):
    parcel = ParcelWorkspace(workspace)
    if path == "/api/parcels/capture":
        from .capture_operator import status
        values = _query(query, {"directory"})
        require(set(values) == {"directory"}, "PARCEL_CAPTURE_DIRECTORY", "Choose the original named capture directory.")
        return status(workspace, values["directory"])
    if path == "/api/parcels/captures":
        from .capture_operator import records
        values = _query(query, {"offset", "limit"})
        for name, default in (("offset", "0"), ("limit", "50")):
            text = values.get(name, default)
            require(re.fullmatch(r"[0-9]{1,9}", text) is not None, "PARCEL_CAPTURE_PAGE", "Choose a retained capture page.")
            values[name] = int(text)
        return records(workspace, **values)
    if path == "/api/parcels":
        require(not query, "PARCEL_QUERY", "Use the original parcel workspace route.")
        return parcel.view()
    if path == "/api/parcels/rows":
        values = _query(query, {"editionId", "offset", "limit", "query", "ward", "issue", "review"})
        for field, default in (("offset", "0"), ("limit", "50")):
            text = values.pop(field, default)
            require(re.fullmatch(r"[0-9]{1,9}", text) is not None, "PARCEL_PAGE", "Choose an original parcel page.")
            values[field] = int(text)
        edition = values.pop("editionId", None)
        return parcel.rows(edition, **values)
    if path in ("/api/parcels/detail", "/api/parcels/source-record"):
        allowed = {"editionId", "key"} | ({"recordId"} if path.endswith("source-record") else set())
        values = _query(query, allowed)
        require(set(values) == allowed, "PARCEL_QUERY", "Select the original source edition and parcel record.")
        if path.endswith("source-record"): return parcel.raw_record(values["editionId"], values["key"], values["recordId"])
        return parcel.detail(values["editionId"], values["key"])
    if path == "/api/parcels/portfolio":
        values = _query(query, {"portfolioId"})
        require(set(values) == {"portfolioId"}, "PARCEL_QUERY", "Select a saved original portfolio.")
        record, value = portfolio.get(parcel, values["portfolioId"])
        return {"portfolio": record, "groups": value["groups"], "summary": value["summary"],
                "examples": value["rows"][:25], "selectedKeys": value["selectedKeys"]}
    if path == "/api/parcels/comparison":
        values = _query(query, {"comparisonId", "offset", "limit", "query", "cohort"})
        require("comparisonId" in values, "PARCEL_COMPARISON_REQUIRED", "Select a saved comparison.")
        record, value = comparison.get(parcel, values["comparisonId"])
        for field, default in (("offset", "0"), ("limit", "50")):
            text = values.get(field, default)
            require(re.fullmatch(r"[0-9]{1,9}", text) is not None,
                    "PARCEL_COMPARISON_PAGE", "Choose a comparison row page.")
            values[field] = int(text)
        require(1 <= values["limit"] <= 250, "PARCEL_COMPARISON_PAGE", "Use 1–250 rows per page.")
        cohort = values.get("cohort", "")
        require(cohort in ("", "added", "removed", "common", "changed", "attention"),
                "PARCEL_COMPARISON_FILTER", "Choose a supported comparison cohort.")
        needle = values.get("query", "").casefold()
        require(len(needle) <= 1000, "PARCEL_COMPARISON_FILTER", "Keep the search text within 1000 characters.")
        rows = value["rows"]
        def matches(row):
            a, b = row["left"] or {}, row["right"] or {}
            text = " ".join(str(x or "") for x in (row["parcelKey"], a.get("owner"), b.get("owner"),
                a.get("accountable"), b.get("accountable"), a.get("ward"), b.get("ward"))).casefold()
            selected = not cohort or row["cohort"] == cohort or (
                cohort == "changed" and row["cohort"] == "common" and row["changed"]) or (
                cohort == "attention" and row["cohort"] == "common" and (
                    not row["assessment"]["comparable"] or not row["area"]["comparable"]))
            return selected and (not needle or needle in text)
        rows = [row for row in rows if matches(row)]
        offset, limit = values["offset"], values["limit"]
        return {"comparison": record, "summary": value["summary"], "groups": value["groups"],
                "left": value["left"], "right": value["right"],
                "rows": rows[offset:offset + limit], "total": len(rows),
                "offset": offset, "limit": limit, "sourceRowCount": len(value["rows"])}
    if path == "/api/parcels/compare":
        values = _query(query, {"leftEditionId", "rightEditionId"})
        require(set(values) == {"leftEditionId", "rightEditionId"}, "PARCEL_QUERY", "Select both original parcel editions.")
        return parcel.compare(values["leftEditionId"], values["rightEditionId"])
    return None

def download_route(workspace, path, query):
    if not path.startswith("/download/parcels/"): return None
    require(not query, "PARCEL_DOWNLOAD", "Use the original retained file link.")
    parcel = ParcelWorkspace(workspace)
    match = re.fullmatch(r"/download/parcels/editions/([a-f0-9]{64})/exceptions", path)
    if match:
        edition = parcel.edition(match[1])
        return {"record": edition["exceptions"], "name": "parcel-source-exceptions.json",
                "type": "application/json; charset=utf-8"}
    match = re.fullmatch(r"/download/parcels/editions/([a-f0-9]{64})/files/([a-f0-9]{64})", path)
    if match:
        edition = parcel.edition(match[1])
        row = next((item for item in edition["inputs"] if item["sha256"] == match[2]), None)
        require(row is not None, "PARCEL_DOWNLOAD", "Choose an original file in this source edition.")
        mime = "text/csv; charset=utf-8" if row["family"].endswith("-csv") else "application/json; charset=utf-8"
        return {"record": row["object"], "name": Path(row["path"]).name, "type": mime}
    match = re.fullmatch(r"/download/parcels/portfolios/(portfolio-[a-f0-9]{64})/(portfolio.json|parcels.csv|groups.json)", path)
    if match:
        record, _ = portfolio.get(parcel, match[1])
        file = next((item for item in record["files"] if item["path"].endswith("/" + match[2])), None)
        require(file is not None, "PARCEL_DOWNLOAD", "Choose an original saved portfolio file.")
        return {"record": file, "name": match[2],
                "type": "text/csv; charset=utf-8" if match[2].endswith(".csv") else "application/json; charset=utf-8"}
    match = re.fullmatch(r"/download/parcels/comparisons/(comparison-[a-f0-9]{64})/(comparison.json|changes.csv|report.html)", path)
    if match:
        record, _ = comparison.get(parcel, match[1])
        file = next((item for item in record["files"] if item["path"].endswith("/" + match[2])), None)
        require(file is not None, "PARCEL_DOWNLOAD", "Choose an original saved comparison file.")
        mime = "text/csv" if match[2].endswith(".csv") else "text/html" if match[2].endswith(".html") else "application/json"
        return {"record": file, "name": match[2], "type": mime + "; charset=utf-8"}
    raise ValueError("Unknown original parcel download.")

def run_file(workspace, path, progress=None):
    value, _ = read_json(path, limit=32 * 1024 * 1024)
    require(isinstance(value, dict) and set(value) <= {"action", "payload", "revision", "requestId", "actor"} and
            isinstance(value.get("payload"), dict), "PARCEL_COMMAND",
            "Use one original parcel command JSON with action, payload, revision, requestId and actor.")
    action = value.get("action")
    common = {}
    if action in WRITES:
        require(all(key in value for key in ("revision", "requestId", "actor")),
                "PARCEL_COMMAND", "A parcel change retains its displayed revision, request ID and analyst.")
        common = {"revision": value["revision"], "request_id": value["requestId"], "actor": value["actor"]}
    return execute(workspace, action, value["payload"], common, progress=progress)

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--action-file", required=True)
    args = parser.parse_args(argv)
    print(json.dumps(run_file(QgisWorkspace(args.workspace), args.action_file), ensure_ascii=False, allow_nan=False))
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
