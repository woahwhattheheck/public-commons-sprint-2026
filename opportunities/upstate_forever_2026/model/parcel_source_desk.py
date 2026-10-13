"""Retained county source editions for the original parcel preparation engine.

TokenJunkieLabs. The reporting_parcels module owns acquisition, polygon handling,
coverage and prepared parcel quantities. This module snapshots completed native
inputs, imports its real output, indexes original CSV rows and supplies the same
source binding to the existing conservation and delivery workflows.
"""
from __future__ import annotations

import csv
import html
import json
import os
from pathlib import Path
import sqlite3
import tempfile

from .common import (
    atomic_bytes, atomic_json, canonical, describe_file, digest, file_digest,
    held, identifier, now, read_json, relative_file, retain_file, verify_file,
)

SCHEMA = "upstate.parcel-source-desk/v1"
EDITION_KIND = "parcel-source-editions"
ENGINE_SCHEMA = "upstate.reporting-parcels/v1"
TABLES = {
    "parcels": "parcel_csv", "context": "context_csv",
    "excluded": "excluded_records_csv", "counties": "county_coverage_csv",
    "sources": "county_sources_csv",
}
DISPLAY_COLUMNS = {
    "parcels": ("parcel_id", "county_name", "parcel_ref", "source_edition",
                "record_class", "whole_feature_area_ha", "reporting_area_ha"),
    "context": ("parcel_id", "county_name", "parcel_ref", "record_class",
                "whole_feature_area_ha", "reporting_area_ha"),
    "excluded": ("source_id", "native_oid", "reason"),
    "counties": ("county_name", "capture_status", "expected_ha", "covered_ha",
                 "parcel_coverage_ha", "uncovered_ha", "coverage_fraction"),
    "sources": ("county_name", "provider_id", "source_uri", "native_id_field",
                "captured_at", "source_last_edit_date", "source_selected_features",
                "parcel_features", "context_features"),
}


def _copy(value):
    return json.loads(canonical(value))


def _scalar(value):
    if isinstance(value, list):
        if len(value) != 1:
            raise ValueError("Choose one value for each parcel desk control")
        return value[0]
    return value


def _text(value, label, *, maximum=300, empty=False):
    value = _scalar(value)
    if not isinstance(value, str) or "\0" in value or len(value) > maximum:
        raise ValueError(label + " must be ordinary text")
    value = value.strip()
    if not value and not empty:
        raise ValueError(label + " is required")
    return value


def _capture_plan(root):
    root = Path(root).resolve(strict=True)
    plan = read_json(relative_file(root, "parcel-plan.json"))
    if plan.get("schema") != ENGINE_SCHEMA or plan.get("kind") != "reporting-parcel-plan":
        raise ValueError("Choose an original full-reporting parcel plan directory")
    transfer = read_json(relative_file(root, "plan-transfer.json"))
    if transfer.get("kind") != "plan" or transfer.get("plan_sha256") != digest(plan):
        raise ValueError("The selected parcel plan differs from its retained source identity")
    return root, plan, transfer


def preview(capture_directory):
    """Read retained metadata only; complete original bytes are checked by the job."""
    root, plan, transfer = _capture_plan(capture_directory)
    progress_path = root / "capture-progress.json"
    progress = read_json(progress_path) if progress_path.is_file() else {}
    if progress and progress.get("plan_sha256") != digest(plan):
        raise ValueError("The capture progress belongs to another parcel plan")
    statuses = {row["fips"]: row for row in progress.get("counties", [])}
    completed = {}
    counties = []
    for county in plan["counties"]:
        provider = county.get("provider") or {}
        key = provider.get("id")
        row = {
            "fips": county["fips"], "name": county["name"],
            "expected_reporting_area_ha": county["reporting_area_ha"],
            "provider_id": key, "source_uri": provider.get("url"),
            "source_provenance": provider.get("provenance"),
            "source_status": provider.get("source_status"),
            "source_edition": provider.get("source_edition"),
            "parcel_reference_fields": provider.get("parcel_id_fields", []),
            "classification": provider.get("classification"),
            "status": "pending" if key else "source_required",
            "selected_native_features": None,
            "native_id_field": None, "source_crs": None, "exception": None,
        }
        if county["fips"] in statuses:
            observed = statuses[county["fips"]]
            if observed.get("provider_id") != key:
                raise ValueError("Capture progress belongs to another county provider")
            for name in ("status", "selected_native_features", "exception"):
                row[name] = observed.get(name)
        if key:
            path = root / "layers" / key / "layer-capture.json"
            if path.is_file():
                record = read_json(relative_file(root, path.relative_to(root).as_posix()))
                if record.get("id") != key or record.get("uri") != provider.get("url"):
                    raise ValueError("The retained county record belongs to another provider")
                identity = {
                    "provider_id": key, "county_fips": county["fips"],
                    "sha256": identifier(record.get("sha256")),
                    "feature_count": record["feature_count"],
                    "capture_record_sha256": digest(record),
                }
                completed[key] = identity
                row.update(status="complete", selected_native_features=record["feature_count"],
                           native_id_field=record.get("id_field"),
                           source_crs=record.get("source_crs"), source_sha256=record["sha256"],
                           exception=None)
        counties.append(row)
    selection = {
        "schema": SCHEMA, "plan_sha256": digest(plan),
        "transfer_sha256": digest(transfer),
        "sources": [completed[key] for key in sorted(completed)],
    }
    selection_id = digest(selection)
    inventory_path = root / "parcel-inventory.json"
    prepared = read_json(inventory_path) if inventory_path.is_file() else None
    if prepared and prepared.get("plan_sha256") != selection["plan_sha256"]:
        prepared = None
    return {
        "schema": SCHEMA, "selection": selection, "selection_id": selection_id,
        "plan_sha256": selection["plan_sha256"],
        "reporting_area_ha": plan["reporting_area_ha"],
        "county_partition_gap_ha": plan.get("county_partition_gap_ha"),
        "county_intersection_sum_ha": plan.get("county_intersection_sum_ha"),
        "counties": counties, "complete_counties": len(completed),
        "required_counties": len(counties),
        "state": "complete" if counties and all(row["status"] == "complete" for row in counties) else "partial",
        "updated_at": progress.get("updated_at"),
        "prepared": prepared,
    }


def _expected(value):
    if not isinstance(value, dict) or value.get("schema") != SCHEMA:
        raise ValueError("Preview and select an original parcel capture")
    identifier(value.get("plan_sha256"))
    identifier(value.get("transfer_sha256"))
    sources = value.get("sources")
    if not isinstance(sources, list) or not sources:
        raise ValueError("Receive at least one complete county source before preparation")
    return _copy(value)


def _snapshot_unlocked(workspace, capture_directory, expected, notify):
    """Retain one immutable input set while its original acquisition continues."""
    from source_tools import reporting_parcels as native

    key = digest(expected)
    destination = workspace.root / "parcel-source-inputs" / key
    destination.mkdir(parents=True, exist_ok=True)
    manifest_path = destination / "desk-input-snapshot.json"
    if manifest_path.exists():
        saved = read_json(manifest_path)
        if saved.get("selection") != expected:
            raise ValueError("The retained parcel snapshot belongs to another selection")
        for item in saved["files"]:
            verify_file(destination, item)
        return destination
    if capture_directory is None:
        raise ValueError("Reattach the original selected parcel capture to finish retaining its source snapshot")
    capture = Path(capture_directory).resolve(strict=True)
    current = preview(capture)
    if current["selection"] != expected:
        raise ValueError("The county source edition changed after preview. Refresh the capture and choose its current completed counties.")
    plan, _ = native._verify_plan(capture)
    records = native._capture_records(capture, plan)
    by_id = {row["provider_id"]: row for row in expected["sources"]}
    if set(records) != set(by_id):
        raise ValueError("Completed county source membership changed during selection")
    transfer = read_json(capture / "plan-transfer.json")
    files = {item["path"]: item for item in transfer["files"]}
    files["plan-transfer.json"] = describe_file(capture, capture / "plan-transfer.json")
    for key, record in records.items():
        wanted = by_id[key]
        if (record["sha256"] != wanted["sha256"]
                or record["feature_count"] != wanted["feature_count"]
                or digest(record) != wanted["capture_record_sha256"]):
            raise ValueError("A selected original county capture changed: " + key)
        for item in record["files"]:
            source = relative_file(capture / "layers", item["path"])
            name = "layers/" + item["path"]
            files[name] = {**item, "path": name}
        record_path = capture / "layers" / key / "layer-capture.json"
        files[record_path.relative_to(capture).as_posix()] = describe_file(capture, record_path)
    ordered = sorted(files)
    for index, name in enumerate(ordered):
        item = files[name]
        source = verify_file(capture, item)
        target = destination / name
        if not target.parent.resolve().is_relative_to(destination.resolve()):
            raise ValueError("An original parcel input leaves its retained snapshot")
        native._retain(source, target)
        if index % 20 == 0 or index + 1 == len(ordered):
            notify("Retaining original county inputs", completed=index + 1, total=len(ordered))
    progress = {
        "schema": ENGINE_SCHEMA, "kind": "reporting-parcel-progress",
        "state": current["state"], "plan_sha256": current["plan_sha256"],
        "counties": [{key: row.get(key) for key in (
            "fips", "name", "expected_reporting_area_ha", "provider_id", "status",
            "selected_native_features", "source_uri", "exception")}
            for row in current["counties"]],
        "updated_at": current.get("updated_at"),
    }
    atomic_json(destination / "capture-progress.json", progress)
    atomic_json(manifest_path, {
        "schema": SCHEMA, "selection": expected,
        "files": [files[name] for name in ordered],
    }, immutable=True)
    return destination


def _snapshot(workspace, capture_directory, expected, notify):
    destination = workspace.root / "parcel-source-inputs" / digest(expected)
    destination.mkdir(parents=True, exist_ok=True)
    with held(destination / ".desk-snapshot.lock", blocking=False):
        return _snapshot_unlocked(workspace, capture_directory, expected, notify)


def _augmented_manifest(snapshot, result):
    """Add the actual reporting polygon for the existing conservation source path."""
    manifest = read_json(relative_file(snapshot, result["source_manifest"]))
    if manifest.get("schema") != "upstate.sources/v1":
        raise ValueError("The original parcel engine returned another source format")
    plan = read_json(snapshot / "parcel-plan.json")
    key = result["plan_sha256"]
    entry = {
        "id": "parcel-reporting-boundary-" + key[:20],
        "title": "Original Upper Savannah parcel reporting boundary",
        "kind": "vector", "role": "REPORTING_AREA",
        "uri": "urn:sha256:" + key,
        "vintage": "Original PlanningBasins2023 Upper Savannah feature",
        **describe_file(snapshot, snapshot / "reporting.geojson"),
        "metadata": {
            "plan_sha256": key, "analysis_crs": "EPSG:5070",
            "reporting_area_ha": plan["reporting_area_ha"],
            "original_reporting": plan["reporting"],
        },
        "companions": [
            describe_file(snapshot, snapshot / "original-reporting" / row["name"])
            for row in plan["reporting_members"]
        ],
    }
    if any(row["id"] == entry["id"] for row in manifest["entries"]):
        raise ValueError("The native parcel source already contains this reporting-boundary identity")
    manifest["entries"].append(entry)
    manifest.setdefault("notes", []).append(
        "The parcel desk adds the original reporting polygon for the existing conservation source-context operation.")
    path = snapshot / ("parcel-desk-import-" + digest(manifest)[:24] + ".json")
    atomic_json(path, manifest, immutable=True)
    return path


def _bindings(collection):
    roles = {row.get("role"): row for row in collection["entries"] if row.get("role")}
    required = ("PARCEL", "PARCEL_CONTEXT", "PARCEL_COVERAGE", "PARCEL_COVERAGE_GAPS", "REPORTING_AREA")
    if any(role not in roles for role in required):
        raise ValueError("The native parcel import did not supply its complete parcel/context/coverage source set")
    result = {}
    for name, role in (("parcels", "PARCEL"), ("context", "PARCEL_CONTEXT"),
                       ("coverage", "PARCEL_COVERAGE"), ("gaps", "PARCEL_COVERAGE_GAPS"),
                       ("reporting", "REPORTING_AREA")):
        row = roles[role]
        binding = {"source_collection_id": collection["id"], "source_id": row["id"]}
        for field in ("layer", "id_field", "label_field"):
            if row.get(field):
                binding[field] = row[field]
        if role in ("PARCEL", "PARCEL_CONTEXT"):
            binding["label_field"] = "parcel_ref"
        result[name] = binding
    return result


def _build_index(workspace, snapshot, native_result, notify):
    root = workspace.root / "parcel-source-indexes"
    root.mkdir(parents=True, exist_ok=True)
    identity = digest({"source_fingerprint": native_result["source_fingerprint"],
                       "tables": {name: native_result["files"][role]["sha256"] for name, role in TABLES.items()},
                       "schema": 1})
    destination = root / (identity + ".sqlite3")
    if destination.is_file():
        with sqlite3.connect(destination.as_uri() + "?mode=ro", uri=True) as db:
            if db.execute("SELECT value FROM metadata WHERE key='identity'").fetchone() != (identity,):
                raise ValueError("A different parcel index owns this source selection")
            summary = json.loads(db.execute("SELECT value FROM metadata WHERE key='tables'").fetchone()[0])
        return describe_file(workspace.root, destination), summary
    handle = tempfile.NamedTemporaryFile(prefix=".parcel-index-", suffix=".sqlite3", dir=root, delete=False)
    temporary = Path(handle.name)
    handle.close()
    summary = {}
    try:
        with sqlite3.connect(temporary) as db:
            db.executescript("""
                CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                CREATE TABLE records (
                    kind TEXT NOT NULL, ordinal INTEGER NOT NULL, county_fips TEXT NOT NULL,
                    county_name TEXT NOT NULL, parcel_ref TEXT NOT NULL, parcel_id TEXT NOT NULL,
                    search_text TEXT NOT NULL, original_json TEXT NOT NULL,
                    PRIMARY KEY (kind, ordinal));
                CREATE INDEX record_county ON records(kind, county_fips, parcel_ref, parcel_id, ordinal);
            """)
            for kind, role in TABLES.items():
                path = verify_file(snapshot, native_result["files"][role])
                count = 0
                county_values = {}
                with path.open("r", encoding="utf-8-sig", newline="") as stream:
                    reader = csv.DictReader(stream)
                    columns = list(reader.fieldnames or [])
                    if not columns:
                        raise ValueError("The original parcel output has no column header: " + kind)
                    rows = []
                    for count, row in enumerate(reader, 1):
                        if None in row:
                            raise ValueError("The original parcel CSV has an unexpected column count")
                        original = {key: value if value is not None else "" for key, value in row.items()}
                        fips = original.get("county_fips", "")
                        county = original.get("county_name", "")
                        if fips:
                            county_values[fips] = county or fips
                        rows.append((
                            kind, count, fips, county, original.get("parcel_ref", ""),
                            original.get("parcel_id", ""),
                            "\n".join(original.values()).casefold(),
                            json.dumps(original, ensure_ascii=False, allow_nan=False),
                        ))
                        if len(rows) >= 1000:
                            db.executemany("INSERT INTO records VALUES (?,?,?,?,?,?,?,?)", rows)
                            rows.clear()
                            notify("Indexing original " + kind + " rows", completed=count)
                    if rows:
                        db.executemany("INSERT INTO records VALUES (?,?,?,?,?,?,?,?)", rows)
                summary[kind] = {"rows": count, "columns": columns,
                                 "counties": [{"fips": fips, "name": county_values[fips]}
                                              for fips in sorted(county_values)]}
            db.execute("INSERT INTO metadata VALUES ('identity', ?)", (identity,))
            db.execute("INSERT INTO metadata VALUES ('tables', ?)", (json.dumps(summary, ensure_ascii=False),))
        with temporary.open("rb") as stream:
            os.fsync(stream.fileno())
        try:
            os.link(temporary, destination)
        except FileExistsError:
            with sqlite3.connect(destination.as_uri() + "?mode=ro", uri=True) as db:
                if db.execute("SELECT value FROM metadata WHERE key='identity'").fetchone() != (identity,):
                    raise ValueError("Concurrent parcel index differs")
        return describe_file(workspace.root, destination), summary
    finally:
        temporary.unlink(missing_ok=True)


def _report(workspace, operation_root, title, native_result, collection, input_selection):
    escape = lambda value: html.escape(str(value if value is not None else ""))
    def number(value):
        return "Unavailable" if value is None else format(float(value), ",.3f")
    rows = []
    for row in native_result["county_coverage"]:
        rows.append("<tr>" + "".join("<td>" + escape(value) + "</td>" for value in (
            row.get("county_name"), row.get("capture_status"),
            number(row.get("expected_ha")), number(row.get("covered_ha")),
            number(row.get("parcel_coverage_ha")), number(row.get("uncovered_ha")),
            number(row.get("overlap_excess_ha")))) + "</tr>")
    sources = next(row for row in collection["entries"] if row.get("role") == "PARCEL").get("metadata", {}).get("input_sources", [])
    source_rows = []
    for row in sources:
        source_rows.append("<tr>" + "".join("<td>" + escape(value) + "</td>" for value in (
            row.get("county_name"), row.get("provider_id"), row.get("native_id_field"),
            row.get("captured_at"), row.get("source_selected_features"),
            row.get("source_uri"))) + "</tr>")
    body = """<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>{title}</title>
<style>body{{font:15px/1.5 system-ui,sans-serif;color:#202020;background:#fff;max-width:1100px;margin:2rem auto;padding:0 1rem}}
h1,h2{{line-height:1.2}}table{{border-collapse:collapse;width:100%;margin:1rem 0}}th,td{{border:1px solid #bbb;padding:.5rem;text-align:left;overflow-wrap:anywhere}}
th{{background:#eee}}.meta{{font:12px/1.5 ui-monospace,monospace;overflow-wrap:anywhere}}@media print{{body{{max-width:none;font-size:10pt}}tr{{break-inside:avoid}}}}</style>
<h1>{title}</h1><p>TokenJunkieLabs · County parcel source edition</p>
<p>This edition contains {parcels} parcel candidates and {context} cadastral context records from {counties} completed county sources. Acquisition state: <strong>{state}</strong>.</p>
<h2>Reporting geography and source coverage</h2><p>All area columns are hectares in EPSG:5070. Cadastral coverage is the unique union of available eligible parcel, road and water geometry. Parcel coverage contains parcel candidates alone. Overlap records the excess from adding independent source records.</p>
<table><thead><tr><th>County</th><th>Capture</th><th>Reporting ha</th><th>Cadastral ha</th><th>Parcel ha</th><th>Uncovered ha</th><th>Overlap excess ha</th></tr></thead><tbody>{coverage}</tbody></table>
<p>A pending county source and a completed source with an uncovered area have separate classes in the geographic gap layer. Each provider's retained classification determines parcel candidates and the separate cadastral context records.</p>
<h2>Original county editions</h2><table><thead><tr><th>County</th><th>Provider</th><th>Native ID field</th><th>Captured</th><th>Source records</th><th>Original URI</th></tr></thead><tbody>{sources}</tbody></table>
<h2>Use in the original application</h2><p>Open Parcel sources, choose this saved edition, inspect the county and parcel tables, then create a source-context inventory or bind completed original model runs. Conservation plans provides manual or ranked portfolios, union quantities and the saved-portfolio land-cover scenario. Maps and delivery accepts this edition's exact parcel selection.</p>
<p>Whole-feature hectares describe the original county feature. Reporting hectares describe its positive-area intersection with the retained Upper Savannah reporting polygon. Parcel references remain strings; the full qualified parcel ID also retains county, provider and native OID.</p>
<h2>Saved selection</h2><p class="meta">Source collection: {collection}<br>Plan: {plan}<br>Native inventory: {inventory}<br>Input selection: {input}</p>
</html>""".format(
        title=escape(title), parcels=native_result["parcel_count"],
        context=native_result["cadastral_context_count"], counties=len(input_selection["sources"]),
        state=escape(native_result["capture_state"]), coverage="".join(rows),
        sources="".join(source_rows), collection=escape(collection["id"]),
        plan=escape(native_result["plan_sha256"]),
        inventory=escape(native_result["source_fingerprint"]), input=escape(digest(input_selection)),
    )
    path = operation_root / "parcel-source-report.html"
    atomic_bytes(path, body.encode("utf-8"), immutable=True)
    return describe_file(workspace.root, path)


def operate(workspace, capture_directory, selection, *, title, operation_id, locator=None):
    """Complete retained snapshot -> original prepare -> original import -> source desk."""
    from source_tools import reporting_parcels as native

    expected = _expected(selection)
    title = _text(title, "Parcel source edition title")
    operation_id = identifier(operation_id)
    operation_root = workspace.root / "parcel-source-operations" / operation_id
    operation_root.mkdir(parents=True, exist_ok=True)
    path = operation_root / "operation.json"
    request = {"selection": expected, "title": title}
    with held(operation_root / ".operation.lock", blocking=False):
        if path.exists():
            state = read_json(path)
            if state.get("request_sha256") != digest(request):
                raise ValueError("This parcel operation belongs to another selected source edition")
            if state.get("state") == "complete":
                return get(workspace, state["edition_id"])
        else:
            state = {"schema": SCHEMA, "id": operation_id, "project_id": workspace.project["id"],
                     "request_sha256": digest(request), "request": request,
                     "created_at": now(), "title": title, "locator": locator,
                     "state": "running", "stage": "Retaining source selection"}
        state.update(state="running", error=None)
        def notify(stage, **progress):
            state.update(stage=stage, progress=progress, updated_at=now())
            atomic_json(path, state)
        try:
            notify("Retaining source selection")
            snapshot = _snapshot(workspace, capture_directory, expected, notify)
            notify("Preparing original parcel and coverage layers")
            result = native.prepare(snapshot)
            returned_manifest = read_json(relative_file(snapshot, result["source_manifest"]))
            parcel_entry = next(row for row in returned_manifest["entries"] if row.get("role") == "PARCEL")
            if parcel_entry.get("metadata", {}).get("geometry_scope") != "whole_source_polygons":
                raise ValueError("Install the current whole-source parcel preparation engine, then resume this operation")
            actual_sources = {
                row["provider_id"]: row["source_sha256"]
                for row in parcel_entry.get("metadata", {}).get("input_sources", [])
            }
            expected_sources = {row["provider_id"]: row["sha256"] for row in expected["sources"]}
            if result["plan_sha256"] != expected["plan_sha256"] or actual_sources != expected_sources:
                raise ValueError("The prepared parcel inventory differs from the selected original county inputs")
            notify("Importing prepared parcel sources")
            manifest = _augmented_manifest(snapshot, result)
            collection = workspace.import_sources(manifest)
            notify("Indexing complete parcel source tables")
            index, tables = _build_index(workspace, snapshot, result, notify)
            files = {name: {**item, "path": (snapshot / item["path"]).relative_to(workspace.root).as_posix()}
                     for name, item in result["files"].items()}
            files["import_manifest"] = describe_file(workspace.root, manifest)
            files["source_index"] = index
            files["report"] = _report(workspace, operation_root, title, result, collection, expected)
            binding = _bindings(collection)
            edition = workspace._save(EDITION_KIND, {
                "title": title, "project_id": workspace.project["id"],
                "operation_id": operation_id, "source_collection_id": collection["id"],
                "input_selection": expected, "snapshot_id": digest(expected),
                "native_inventory": result, "bindings": binding, "tables": tables,
                "files": files, "meaning": "Original county parcel editions prepared on the full retained reporting polygon",
            })
            state.update(state="complete", stage="Parcel source edition ready", progress={},
                         edition_id=edition["id"], completed_at=now(), updated_at=now())
            atomic_json(path, state)
            return edition
        except (Exception, KeyboardInterrupt, SystemExit) as error:
            state.update(state="interrupted" if isinstance(error, (KeyboardInterrupt, SystemExit)) else "failed",
                         error={"type": type(error).__name__, "message": str(error)}, updated_at=now())
            atomic_json(path, state)
            raise


def get(workspace, edition_id):
    edition = workspace._get(EDITION_KIND, identifier(edition_id))
    if edition.get("project_id") != workspace.project["id"]:
        raise ValueError("The parcel edition belongs to another project")
    workspace._get("sources", edition["source_collection_id"])
    return edition


def overview(workspace):
    editions = []
    for edition in workspace._list(EDITION_KIND):
        native = edition["native_inventory"]
        editions.append({
            "id": edition["id"], "title": edition["title"],
            "source_collection_id": edition["source_collection_id"],
            "operation_id": edition["operation_id"],
            "capture_state": native["capture_state"],
            "parcel_count": native["parcel_count"],
            "context_count": native["cadastral_context_count"],
            "complete_counties": len(edition["input_selection"]["sources"]),
            "plan_sha256": native["plan_sha256"],
        })
    operations = []
    for path in sorted((workspace.root / "parcel-source-operations").glob("*/operation.json")):
        row = read_json(path)
        operations.append({key: row.get(key) for key in
            ("id", "state", "stage", "progress", "title", "created_at", "updated_at", "edition_id", "error")})
    return {"schema": SCHEMA, "project_id": workspace.project["id"], "editions": editions,
            "operations": operations}


def rows(workspace, edition_id, *, table="parcels", county="", query="", offset=0, limit=100):
    edition = get(workspace, edition_id)
    table = _text(table, "Inventory table")
    if table not in TABLES:
        raise ValueError("Choose a parcel, context, excluded, county or source table")
    county = _text(county, "County selection", maximum=20, empty=True)
    query = _text(query, "Search", maximum=300, empty=True)
    for name, value in (("offset", offset), ("limit", limit)):
        if isinstance(value, str) and value.isdecimal():
            value = int(value)
        if isinstance(value, bool) or not isinstance(value, int) or value < (1 if name == "limit" else 0):
            raise ValueError("Use an ordinary nonnegative inventory page")
        if name == "limit":
            if value > 500:
                raise ValueError("Each inventory page contains at most 500 original rows")
            limit = value
        else:
            offset = value
    index = relative_file(workspace.root, edition["files"]["source_index"]["path"])
    if index.stat().st_size != edition["files"]["source_index"]["bytes"]:
        raise ValueError("The retained parcel index length changed")
    conditions, values = ["kind=?"], [table]
    if county:
        conditions.append("county_fips=?")
        values.append(county)
    if query:
        literal = query.casefold().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        conditions.append("search_text LIKE ? ESCAPE '\\'")
        values.append("%" + literal + "%")
    where = " AND ".join(conditions)
    with sqlite3.connect(index.as_uri() + "?mode=ro", uri=True) as db:
        total = db.execute("SELECT count(*) FROM records WHERE " + where, values).fetchone()[0]
        page = db.execute(
            "SELECT ordinal,original_json FROM records WHERE " + where +
            " ORDER BY county_fips,parcel_ref,parcel_id,ordinal LIMIT ? OFFSET ?",
            values + [limit, offset],
        ).fetchall()
    return {
        "schema": SCHEMA, "edition_id": edition["id"], "table": table,
        "columns": edition["tables"][table]["columns"],
        "display_columns": [name for name in DISPLAY_COLUMNS[table] if name in edition["tables"][table]["columns"]],
        "counties": edition["tables"][table]["counties"],
        "source_rows": edition["tables"][table]["rows"],
        "total": total, "offset": offset, "limit": limit,
        "rows": [{"ordinal": ordinal, "values": json.loads(value)} for ordinal, value in page],
        "next_offset": offset + len(page) if offset + len(page) < total else None,
    }


def study_selection(workspace, edition_id, value):
    """Construct a selection consumed unchanged by the existing conservation engine."""
    edition = get(workspace, edition_id)
    spec = _copy(value)
    spec["title"] = _text(spec.get("title"), "Conservation inventory title")
    mode = spec.get("mode", "source_context")
    if mode not in ("source_context", "native_model"):
        raise ValueError("Select a source-context or original native-model inventory")
    spec.update(mode=mode, unit_type="parcel", planning_unit_label="County parcels")
    spec["parcels"] = _copy(edition["bindings"]["parcels"])
    county = spec.pop("county_fips", "")
    if county:
        counties = {row["county_fips"] for row in edition["native_inventory"]["county_coverage"]}
        if county not in counties:
            raise ValueError("Choose a county represented in this original parcel edition")
        spec["parcels"]["where"] = {"county_fips": county}
    spec.setdefault("purpose", "screening")
    spec.setdefault("contexts", {})
    spec.setdefault("rules", {})
    if mode == "source_context":
        spec["reporting_area"] = _copy(edition["bindings"]["reporting"])
        spec["analysis_crs"] = "EPSG:5070"
        spec["baseline_run_id"] = None
        spec["alternative_run_ids"] = []
        spec.setdefault("score", {"basis": "context", "context_weights": {}})
    else:
        identifier(spec.get("baseline_run_id"))
        alternatives = spec.get("alternative_run_ids", [])
        if not isinstance(alternatives, list):
            raise ValueError("Choose the actual completed alternative runs")
        for item in alternatives:
            identifier(item)
        spec.setdefault("score", {"basis": "current_export", "scale": "total"})
    return spec


def verify_workspace(workspace):
    """Verify saved desk outputs during the original whole-project receiving flow."""
    count = 0
    for edition in workspace._list(EDITION_KIND):
        get(workspace, edition["id"])
        for item in edition["files"].values():
            verify_file(workspace.root, item)
        count += 1
    return {"parcel_source_editions": count}
