"""Retained coefficient evidence working revisions on the original Workspace.

All scientific publication uses biophysical_evidence.preview_evidence/save_evidence.
Working records preserve unfinished strings; original coefficient values are fixed.
"""
from __future__ import annotations
from copy import deepcopy
import argparse
import csv
import io
import json
from pathlib import Path
import re

from . import biophysical_evidence as evidence
from .common import (atomic_bytes, atomic_json, canonical, describe_file, digest,
                     file_digest, held, identifier, now, read_json, verify_file,
                     _sync_directory)

DRAFT_SCHEMA = "upstate.biophysical-evidence-authoring/v1"
PACKAGE_SCHEMA = "upstate.biophysical-evidence-authoring-package/v1"
KIND = "biophysical-authoring"
IMPORT_KIND = "biophysical-authoring-imports"
REGISTRATION_KIND = "biophysical-authoring-registrations"
FIELDS = tuple(evidence.CSV_FIELDS)
FIXED = FIELDS[:5]
EDITABLE = FIELDS[5:]
FILTERS = {"all", "unfinished", "documented", "unknown", "ranged"}
MAX_BYTES = 16 * 1024 * 1024
MAX_IMPORT_DEPTH = 16


def _object(value, keys, label, required=None):
    if (not isinstance(value, dict) or set(value) - set(keys)
            or not set(keys if required is None else required) <= set(value)):
        raise ValueError(label + " must retain its original supported fields")
    return value


def _text(value, label, *, nonempty=False):
    if not isinstance(value, str) or (nonempty and not value.strip()):
        raise ValueError(label + " must be " + ("nonempty " if nonempty else "") + "text")
    return value


def _request_id(value):
    _text(value, "Request identity", nonempty=True)
    if len(value) > 128 or any(ord(char) < 32 for char in value):
        raise ValueError("Use the original request identity, at most 128 characters")
    return value


def _series(value):
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}", value):
        raise ValueError("Use a portable named working-series identity")
    return value


def _bounded(value):
    if len(canonical(value)) + 1 > MAX_BYTES:
        raise ValueError("The complete working JSON exceeds 16 MiB")
    return value


def _binding(catalog):
    return {"workspace_id": catalog["workspace_id"], "profile_id": catalog["profile"]["id"],
            "table_sha256": catalog["table"]["sha256"],
            "source_collection_id": catalog["table"]["source_collection_id"],
            "source_id": catalog["table"]["source_id"], "models": catalog["profile"]["models"]}


def _fixed(cell):
    return {"lucode": cell["lucode"], "parameter": cell["parameter"],
            "value": cell["table_value_text"], "units": cell["units"],
            "load_type": cell.get("load_type") or ""}


def inspect_draft(workspace, draft, *, catalog=None):
    _bounded(draft)
    _object(draft, ("schema", "binding", "title", "note", "origin_evidence_id", "rows", "view"),
            "Working coefficient evidence")
    if draft["schema"] != DRAFT_SCHEMA or not isinstance(draft["binding"], dict):
        raise ValueError("Choose complete original coefficient evidence working JSON")
    catalog = catalog or evidence.catalog(workspace, identifier(draft["binding"].get("profile_id")))
    if draft["binding"] != _binding(catalog):
        raise ValueError("Working evidence belongs to a different workspace, profile, table or model scope")
    _text(draft["title"], "Working title")
    _text(draft["note"], "Working note")
    if draft["origin_evidence_id"] is not None:
        original = evidence.inspect_evidence(workspace, identifier(draft["origin_evidence_id"]))
        if (original["workspace_id"] != draft["binding"]["workspace_id"]
                or original["profile_id"] != draft["binding"]["profile_id"]
                or original["table"]["sha256"] != draft["binding"]["table_sha256"]):
            raise ValueError("The starting evidence differs from the exact original profile and table")
    if not isinstance(draft["rows"], list) or len(draft["rows"]) != len(catalog["cells"]):
        raise ValueError("Retain every original coefficient cell in its original order")
    keys = []
    for row, cell in zip(draft["rows"], catalog["cells"]):
        _object(row, FIELDS, "Working coefficient row")
        if (isinstance(row["lucode"], bool) or not isinstance(row["lucode"], int)
                or abs(row["lucode"]) > 9007199254740991
                or {key: row[key] for key in FIXED} != _fixed(cell)):
            raise ValueError("Original coefficient identity, text, units or load type changed")
        for key in EDITABLE:
            _text(row[key], key)
        keys.append(str(row["lucode"]) + ":" + row["parameter"])
    view = _object(draft["view"], ("search", "filter", "page", "selected", "batch"), "Working view")
    batch = _object(view["batch"], ("source_title", "source_uri", "source_locator", "source_period", "notes"),
                    "Unapplied batch citation")
    for key, value in batch.items():
        _text(value, "Unapplied batch " + key)
    _text(view["search"], "Search")
    if (not isinstance(view["filter"], str) or view["filter"] not in FILTERS
            or isinstance(view["page"], bool) or not isinstance(view["page"], int)
            or not 0 <= view["page"] <= 9007199254740991
            or not isinstance(view["selected"], list)
            or any(not isinstance(key, str) or key not in keys for key in view["selected"])
            or len(set(view["selected"])) != len(view["selected"])):
        raise ValueError("Keep a valid working view and distinct original coefficient selections")
    return deepcopy(draft)


def _record_body(record, kind):
    if not isinstance(record, dict) or record.get("schema") != "upstate." + kind + "/v1":
        raise ValueError("The retained authoring record schema changed")
    key = identifier(record.get("id"))
    if digest({name: value for name, value in record.items() if name != "id"}) != key:
        raise ValueError("The retained authoring record bytes changed")
    return record


def _summary(record):
    return {key: record[key] for key in ("id", "series_id", "revision", "parent_id", "created_at")} | {
        "title": record["draft"]["title"], "binding": deepcopy(record["draft"]["binding"])}


def _validate_records(workspace, records, imports, *, depth=0):
    if not isinstance(records, list) or not records:
        raise ValueError("Retain the complete nonempty working revision chain")
    if not isinstance(imports, list):
        raise ValueError("Retain the complete original imported histories")
    if depth > MAX_IMPORT_DEPTH:
        raise ValueError("The working import ancestry exceeds the supported depth")
    imported = {}
    for item in imports:
        _record_body(item, IMPORT_KIND)
        _object(item, ("id", "schema", "package"), "Retained imported working history")
        if item["id"] in imported:
            raise ValueError("Duplicate imported working history")
        inspect_package(workspace, item["package"], _depth=depth + 1)
        imported[item["id"]] = item
    catalog = None
    prior = None
    used_imports = set()
    requests = set()
    for record in records:
        _record_body(record, KIND)
        _object(record, ("id", "schema", "series_id", "revision", "parent_id", "request_id",
                         "request_sha256", "created_at", "draft", "imported_from"), "Working revision")
        _series(record["series_id"])
        _request_id(record["request_id"])
        _text(record["created_at"], "Retained creation time", nonempty=True)
        if record["request_id"] in requests:
            raise ValueError("Working history repeats a request identity")
        requests.add(record["request_id"])
        if (type(record["revision"]) is not int or record["revision"] != (prior["revision"] + 1 if prior else 1)
                or record["parent_id"] != (prior["id"] if prior else None)
                or prior and record["series_id"] != prior["series_id"]):
            raise ValueError("Retain the original complete linear working revision chain")
        if catalog is None:
            catalog = evidence.catalog(workspace, identifier(record["draft"].get("binding", {}).get("profile_id")))
        draft = inspect_draft(workspace, record["draft"], catalog=catalog)
        selected = {"request_id": record["request_id"], "series_id": record["series_id"],
                    "parent_id": record["parent_id"], "draft": draft}
        if record["imported_from"] is not None:
            if prior or record["imported_from"] not in imported:
                raise ValueError("Only the first revision may retain an original imported history")
            incoming = imported[record["imported_from"]]["package"]
            if draft["binding"] != incoming["records"][-1]["draft"]["binding"]:
                raise ValueError("The imported working descendant changed its original source binding")
            selected["imported_package"] = incoming
            used_imports.add(record["imported_from"])
        if digest(selected) != record["request_sha256"]:
            raise ValueError("Working revision changed its original save request")
        prior = record
    if used_imports != set(imported):
        raise ValueError("The package contains unrelated imported working histories")
    return records


def inspect_package(workspace, package, *, _depth=0):
    if _depth == 0:
        _bounded(package)
    _object(package, ("schema", "workspace_id", "profile_id", "revision_id", "records", "imports"),
            "Complete working package")
    if package["schema"] != PACKAGE_SCHEMA or package["workspace_id"] != workspace.project["id"]:
        raise ValueError("Choose the complete working package for this original workspace")
    _validate_records(workspace, package["records"], package["imports"], depth=_depth)
    last = package["records"][-1]
    if package["revision_id"] != last["id"] or package["profile_id"] != last["draft"]["binding"]["profile_id"]:
        raise ValueError("The package selection differs from its retained original revision")
    return package


def _chain(workspace, revision_id):
    records, seen = [], set()
    key = identifier(revision_id)
    while key is not None:
        if key in seen:
            raise ValueError("Working revision ancestry contains a cycle")
        seen.add(key)
        record = workspace._get(KIND, key)
        records.append(record)
        key = record.get("parent_id")
    records.reverse()
    imports = [workspace._get(IMPORT_KIND, records[0]["imported_from"])] if records[0].get("imported_from") else []
    _validate_records(workspace, records, imports)
    return records, imports


def inspect(workspace, revision_id):
    records, _ = _chain(workspace, revision_id)
    return {"record": records[-1], "history": [_summary(record) for record in records]}


def list_series(workspace, profile_id):
    catalog = evidence.catalog(workspace, identifier(profile_id))
    grouped = {}
    for record in workspace._list(KIND):
        if record.get("draft", {}).get("binding", {}).get("profile_id") == profile_id:
            grouped.setdefault(record["series_id"], []).append(record)
    result = []
    for series, records in grouped.items():
        records.sort(key=lambda row: row["revision"])
        imports = [workspace._get(IMPORT_KIND, records[0]["imported_from"])] if records[0].get("imported_from") else []
        _validate_records(workspace, records, imports)
        head = records[-1]
        result.append({"series_id": series, "title": head["draft"]["title"],
                       "head_id": head["id"], "revision": head["revision"],
                       "updated_at": head["created_at"], "binding": deepcopy(head["draft"]["binding"])})
    return {"schema": "upstate.biophysical-evidence-authoring-catalog/v1",
            "profile_id": catalog["profile"]["id"], "series": sorted(result, key=lambda row: (row["updated_at"], row["series_id"]), reverse=True)}


def _sync(workspace, directory):
    current = directory
    while current != workspace.root:
        _sync_directory(current)
        current = current.parent
    _sync_directory(workspace.root)


def _operation(workspace, action, selection):
    request = _request_id(selection.get("request_id"))
    directory = workspace.root / "biophysical-authoring-operations" / digest({"action": action, "request_id": request})
    return directory, digest(selection)


def _context(workspace, directory, action, selection, created_at=None):
    path = directory / "request.json"
    if path.exists():
        context = read_json(path)
        if context.get("action") != action or context.get("selection") != selection or context.get("request_sha256") != digest(selection):
            raise ValueError("This request identity belongs to different original authoring work")
    else:
        context = {"schema": "upstate.biophysical-authoring-operation/v1", "action": action,
                   "request_sha256": digest(selection), "selection": deepcopy(selection),
                   "created_at": created_at or now()}
        atomic_json(path, context, immutable=True)
    _sync(workspace, directory)
    return context


def save(workspace, selection, *, created_at=None):
    _bounded(selection)
    _object(selection, ("request_id", "series_id", "parent_id", "draft", "imported_package"),
            "Working save", required=("request_id", "series_id", "parent_id", "draft"))
    _series(selection["series_id"])
    if selection["parent_id"] is not None:
        identifier(selection["parent_id"])
    directory, request_sha = _operation(workspace, "save", selection)
    with held(workspace.root / ".workspace.lock"), held(workspace.root / ".biophysical-authoring.lock"):
        # Recover the original exact request before evaluating any newer head.
        matches = [record for record in workspace._list(KIND) if record.get("request_id") == selection["request_id"]]
        if matches:
            if len(matches) != 1 or matches[0]["request_sha256"] != request_sha:
                raise ValueError("This save request identity already belongs to different original work")
            context = _context(workspace, directory, "save", selection, created_at)
            result = inspect(workspace, matches[0]["id"])
            atomic_json(directory / "result.json", {"revision_id": result["record"]["id"]}, immutable=True)
            _sync(workspace, workspace.root / KIND)
            _sync(workspace, directory)
            return result
        draft = inspect_draft(workspace, selection["draft"])
        old = [record for record in workspace._list(KIND) if record.get("series_id") == selection["series_id"]]
        old.sort(key=lambda row: row["revision"])
        parent = old[-1] if old else None
        if selection["parent_id"] != (parent["id"] if parent else None):
            raise ValueError("WORKING_PARENT_CHANGED: reopen the current named revision or explicitly save a new series")
        if parent:
            inspect(workspace, parent["id"])
            if parent["draft"]["binding"] != draft["binding"]:
                raise ValueError("A named working series keeps its original exact profile and table")
        imported_from = None
        if "imported_package" in selection:
            if parent:
                raise ValueError("Import a complete original working package into a new named series")
            package = inspect_package(workspace, selection["imported_package"])
            if package["records"][-1]["draft"]["binding"] != draft["binding"]:
                raise ValueError("An imported working descendant keeps its exact original source binding")
            imported_from = workspace._save(IMPORT_KIND, {"package": package})["id"]
            _sync(workspace, workspace.root / IMPORT_KIND)
        context = _context(workspace, directory, "save", selection, created_at)
        body = {"series_id": selection["series_id"],
            "revision": parent["revision"] + 1 if parent else 1, "parent_id": selection["parent_id"],
            "request_id": selection["request_id"], "request_sha256": request_sha,
            "created_at": context["created_at"], "draft": draft, "imported_from": imported_from}
        proposed = {**body, "schema": "upstate." + KIND + "/v1"}
        proposed = {**proposed, "id": digest(proposed)}
        # An acknowledged revision must remain exportable and reopenable with
        # its complete history, not just with its latest editor fields.
        retained_imports = ([workspace._get(IMPORT_KIND, (old[0]["imported_from"] if old else imported_from))]
                            if (old[0].get("imported_from") if old else imported_from) else [])
        _bounded({"schema": PACKAGE_SCHEMA, "workspace_id": workspace.project["id"],
                  "profile_id": draft["binding"]["profile_id"], "revision_id": proposed["id"],
                  "records": old + [proposed], "imports": retained_imports})
        record = workspace._save(KIND, body)
        _sync(workspace, workspace.root / KIND)
        atomic_json(directory / "result.json", {"revision_id": record["id"]}, immutable=True)
        _sync(workspace, directory)
        return inspect(workspace, record["id"])


def export_package(workspace, revision_id):
    records, imports = _chain(workspace, revision_id)
    package = {"schema": PACKAGE_SCHEMA, "workspace_id": workspace.project["id"],
               "profile_id": records[-1]["draft"]["binding"]["profile_id"],
               "revision_id": records[-1]["id"], "records": records, "imports": imports}
    return _bounded(package)


def csv_bytes(draft):
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=FIELDS, lineterminator="\n")
    writer.writeheader()
    writer.writerows({key: row[key] for key in FIELDS} for row in draft["rows"])
    return output.getvalue().encode("utf-8")


def export_files(workspace, revision_id):
    with held(workspace.root / ".workspace.lock"):
        return _export_files_locked(workspace, revision_id)


def _export_files_locked(workspace, revision_id):
    package = export_package(workspace, revision_id)
    directory = workspace.root / "biophysical-authoring-exports" / package["revision_id"]
    atomic_json(directory / "working-history.json", package, immutable=True)
    atomic_json(directory / "working-draft.json", package["records"][-1]["draft"], immutable=True)
    atomic_bytes(directory / "working-evidence.csv", csv_bytes(package["records"][-1]["draft"]), immutable=True)
    _sync(workspace, directory)
    return {"package": package, "files": {
        "Complete working history": describe_file(workspace.root, directory / "working-history.json", media_type="application/json"),
        "Current editable working draft": describe_file(workspace.root, directory / "working-draft.json", media_type="application/json"),
        "Working CSV (may contain unfinished evidence)": describe_file(workspace.root, directory / "working-evidence.csv", media_type="text/csv")}}


def _registration_files(workspace, directory, selection, context, package):
    draft = package["records"][-1]["draft"]
    atomic_json(directory / "working-history.json", package, immutable=True)
    atomic_json(directory / "working-draft.json", draft, immutable=True)
    atomic_bytes(directory / "evidence.csv", csv_bytes(draft), immutable=True)
    source_id = "coefficient-evidence-" + selection["revision_id"]
    manifest = {"schema": "upstate.sources/v1", "title": selection["title"],
                "captured_at": context["created_at"], "notes": [selection["note"]],
                "scope": {"profile_id": draft["binding"]["profile_id"],
                          "working_revision_id": selection["revision_id"], "binding": draft["binding"]},
                "entries": [{"id": source_id, "kind": "table", "path": "evidence.csv",
                    "sha256": file_digest(directory / "evidence.csv"), "title": selection["title"],
                    "uri": "urn:upstate:biophysical-authoring:" + workspace.project["id"] + ":" + selection["revision_id"],
                    "vintage": context["created_at"], "companions": [
                        {"path": name, "sha256": file_digest(directory / name)}
                        for name in ("working-history.json", "working-draft.json")]}]}
    atomic_json(directory / "sources.json", manifest, immutable=True)
    _sync(workspace, directory)
    return manifest


def register(workspace, selection, *, created_at=None):
    _object(selection, ("request_id", "revision_id", "title", "note"), "Saved evidence registration")
    _bounded(selection)
    identifier(selection["revision_id"])
    _text(selection["title"], "Source edition title", nonempty=True)
    _text(selection["note"], "Source edition note")
    directory, request_sha = _operation(workspace, "register", selection)
    with held(workspace.root / ".workspace.lock"), held(workspace.root / ".biophysical-authoring.lock"):
        receipt = directory / "result.json"
        if receipt.exists():
            context = _context(workspace, directory, "register", selection, created_at)
            result = read_json(receipt)
            return inspect_registration(workspace, result["registration_id"])
        package = export_package(workspace, selection["revision_id"])
        if any(value.strip() for value in package["records"][-1]["draft"]["view"]["batch"].values()):
            raise ValueError("Apply or explicitly clear the saved pending batch citation before registering evidence")
        context = _context(workspace, directory, "register", selection, created_at)
        manifest = _registration_files(workspace, directory, selection, context, package)
        collection = workspace.import_sources(directory / "sources.json")
        source = {"profile_id": package["profile_id"], "source_collection_id": collection["id"],
                  "source_id": manifest["entries"][0]["id"]}
        # This unchanged native authority accepts completed evidence, including
        # explicitly unknown cells. It never fills missing citations implicitly.
        proposed = evidence.preview_evidence(workspace, source)
        saved = evidence.save_evidence(workspace, source)
        if proposed != saved:
            raise ValueError("Saved coefficient evidence differs from its original native preview")
        registration = workspace._save(REGISTRATION_KIND, {
            "workspace_id": workspace.project["id"], "revision_id": selection["revision_id"],
            "request_id": selection["request_id"], "request_sha256": request_sha,
            "created_at": context["created_at"], "selection": deepcopy(selection),
            "source": source, "evidence_id": saved["id"],
            "files": {name: describe_file(workspace.root, directory / name)
                      for name in ("request.json", "working-history.json", "working-draft.json", "evidence.csv", "sources.json")}})
        _sync(workspace, workspace.root / REGISTRATION_KIND)
        atomic_json(receipt, {"registration_id": registration["id"]}, immutable=True)
        _sync(workspace, directory)
        return inspect_registration(workspace, registration["id"])


def inspect_registration(workspace, registration_id):
    record = workspace._get(REGISTRATION_KIND, identifier(registration_id))
    _object(record, ("id", "schema", "workspace_id", "revision_id", "request_id", "request_sha256",
                     "created_at", "selection", "source", "evidence_id", "files"), "Saved evidence registration")
    selection = record["selection"]
    if (record["workspace_id"] != workspace.project["id"] or digest(selection) != record["request_sha256"]
            or selection.get("revision_id") != record["revision_id"]
            or selection.get("request_id") != record["request_id"]):
        raise ValueError("Evidence registration changed its original working selection")
    package = export_package(workspace, record["revision_id"])
    required = {"request.json", "working-history.json", "working-draft.json", "evidence.csv", "sources.json"}
    if set(record["files"]) != required:
        raise ValueError("Evidence registration must retain every original source companion")
    files = {name: verify_file(workspace.root, value) for name, value in record["files"].items()}
    context = read_json(files["request.json"])
    if context != {"schema": "upstate.biophysical-authoring-operation/v1", "action": "register",
                   "request_sha256": record["request_sha256"], "selection": selection, "created_at": record["created_at"]}:
        raise ValueError("Evidence registration changed its original operation")
    if (read_json(files["working-history.json"]) != package
            or read_json(files["working-draft.json"]) != package["records"][-1]["draft"]
            or files["evidence.csv"].read_bytes() != csv_bytes(package["records"][-1]["draft"])):
        raise ValueError("Registered source differs from the complete original saved working revision")
    draft = package["records"][-1]["draft"]
    source_id = "coefficient-evidence-" + record["revision_id"]
    expected_manifest = {"schema": "upstate.sources/v1", "title": selection["title"],
        "captured_at": record["created_at"], "notes": [selection["note"]],
        "scope": {"profile_id": package["profile_id"], "working_revision_id": record["revision_id"],
                  "binding": draft["binding"]},
        "entries": [{"id": source_id, "kind": "table", "path": "evidence.csv",
            "sha256": record["files"]["evidence.csv"]["sha256"], "title": selection["title"],
            "uri": "urn:upstate:biophysical-authoring:" + workspace.project["id"] + ":" + record["revision_id"],
            "vintage": record["created_at"], "companions": [
                {"path": name, "sha256": record["files"][name]["sha256"]}
                for name in ("working-history.json", "working-draft.json")]}]}
    if read_json(files["sources.json"]) != expected_manifest:
        raise ValueError("Registered manifest differs from its original saved revision and request")
    saved = evidence.inspect_evidence(workspace, record["evidence_id"])
    if (record["source"] != {"profile_id": package["profile_id"],
                            "source_collection_id": saved["source"]["source_collection_id"],
                            "source_id": saved["source"]["source_id"]}
            or saved["source"]["sha256"] != record["files"]["evidence.csv"]["sha256"]):
        raise ValueError("Registered evidence differs from its original authored CSV and profile")
    collection = workspace._get("sources", record["source"]["source_collection_id"])
    if collection["original_manifest"]["sha256"] != record["files"]["sources.json"]["sha256"]:
        raise ValueError("Registered evidence changed its original source manifest")
    if (collection.get("title") != selection["title"] or collection.get("captured_at") != record["created_at"]
            or collection.get("notes") != expected_manifest["notes"]
            or collection.get("scope") != expected_manifest["scope"] or len(collection["entries"]) != 1):
        raise ValueError("Registered source collection differs from its original manifest")
    entry = collection["entries"][0]
    expected_entry = {key: value for key, value in expected_manifest["entries"][0].items()
                      if key not in {"path", "sha256", "companions"}}
    if {key: value for key, value in entry.items() if key not in {"body", "companions"}} != expected_entry:
        raise ValueError("Registered source attribution differs from its original manifest")
    actual = {body["filename"]: (body["sha256"], body["bytes"]) for body in [entry["body"], *entry["companions"]]}
    expected = {name: (record["files"][name]["sha256"], record["files"][name]["bytes"])
                for name in ("evidence.csv", "working-history.json", "working-draft.json")}
    if actual != expected:
        raise ValueError("Registered evidence lost an original working companion")
    return {"registration": record, "evidence": saved, "files": record["files"]}


def verify_all(workspace):
    records = workspace._list(KIND)
    groups = {}
    for record in records:
        groups.setdefault(record["series_id"], []).append(record)
    imports_used = set()
    for rows in groups.values():
        rows.sort(key=lambda row: row["revision"])
        imports = [workspace._get(IMPORT_KIND, rows[0]["imported_from"])] if rows[0].get("imported_from") else []
        _validate_records(workspace, rows, imports)
        imports_used.update(item["id"] for item in imports)
    # Retain and inspect orphaned imports from an interrupted first save too.
    imports = workspace._list(IMPORT_KIND)
    for item in imports:
        _record_body(item, IMPORT_KIND)
        inspect_package(workspace, item["package"])
    registrations = workspace._list(REGISTRATION_KIND)
    for record in registrations:
        inspect_registration(workspace, record["id"])
    return {"working_revisions": len(records), "working_series": len(groups),
            "imported_histories": len(imports), "registered_evidence": len(registrations)}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True, type=Path)
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("list"); p.add_argument("--profile", required=True)
    for name in ("inspect", "export"):
        p = sub.add_parser(name); p.add_argument("--revision", required=True)
        if name == "export": p.add_argument("--output", required=True, type=Path)
    for name in ("save", "register"):
        p = sub.add_parser(name); p.add_argument("--request", required=True, type=Path)
    args = parser.parse_args(argv)
    from .workspace import Workspace
    workspace = Workspace(args.workspace)
    if args.command == "list":
        result = list_series(workspace, args.profile)
    elif args.command == "inspect":
        result = inspect(workspace, args.revision)
    elif args.command == "export":
        result = export_package(workspace, args.revision)
        # Caller-selected exports never replace another user's file.
        with args.output.open("xb") as stream:
            stream.write(canonical(result) + b"\n")
            stream.flush()
            import os
            os.fsync(stream.fileno())
        _sync_directory(args.output.parent)
        result = {"output": str(args.output), "bytes": args.output.stat().st_size,
                  "sha256": file_digest(args.output), "revision_id": args.revision}
    else:
        selection = read_json(args.request)
        result = save(workspace, selection) if args.command == "save" else register(workspace, selection)
    print(json.dumps(result, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
