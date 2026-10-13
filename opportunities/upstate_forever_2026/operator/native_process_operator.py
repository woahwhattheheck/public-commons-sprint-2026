"""Native process reports through the existing operator queue and file tickets."""
from __future__ import annotations

from copy import deepcopy
import csv
import hashlib
from pathlib import Path
import zipfile

from model import native_process_report as producer
from model.common import (atomic_json, canonical, describe_file, digest, held,
                          identifier, read_json, relative_file, verify_file)

ACTIONS = {"native.process.build", "native.process.package"}
TABLES = {"quantities": "quantities.csv", "support": "support.csv",
          "changes": "changes.csv", "paired-support": "paired-support.csv"}
DISPLAY_FILES = {"report.pdf", "report.html", "report.md", "report-data.json",
                 "report.json", "processes.json", "quantities.csv", "support.csv",
                 "changes.csv", "paired-support.csv", "identity.json", "sources.json"}
PACKAGE_ROOT = "native-process-packages"


def _record(ws, key):
    key = identifier(key)
    directory = ws.root / producer.ROOT / key
    record = producer.inspect(ws, key)
    identity = read_json(directory / "identity.json")
    if (record.get("schema") != producer.SCHEMA or record.get("id") != key or
            digest(identity) != key or identity.get("project_id") != ws.project["id"] or
            record.get("selection") != identity.get("selection")):
        raise ValueError("Open this process report in its original scientific Workspace")
    return directory, record, identity


def _descriptors(ws, directory, record):
    files = record.get("files") or []
    if not isinstance(files, list):
        raise ValueError("The completed process report has an invalid file inventory")
    if not files and record.get("source_choice") and record.get("source_manifest"):
        # A completed source import survives a later PDF/HTML rendering failure.
        manifest = read_json(verify_file(directory, record["source_manifest"]))
        entry = next((item for item in manifest.get("entries", [])
                      if item.get("id") == record["source_choice"]["source_id"]), None)
        if not entry or entry.get("sha256") != record["recipe"]["sha256"]:
            raise ValueError("The retained partial report source binding differs")
        local = [record["recipe"], record["source_manifest"], *entry.get("companions", [])]
        files = [{**item, "path": (directory / item["path"]).relative_to(ws.root).as_posix()}
                 for item in local]
    result = {}
    for item in files:
        path = relative_file(ws.root, item["path"])
        relative = path.relative_to(directory.resolve()).as_posix()
        if relative in result and result[relative] != item:
            raise ValueError("The process inventory contains conflicting file identities")
        result[relative] = item
    return result


def _source(ws, record):
    choice = record.get("source_choice")
    if not choice:
        return None
    path, entry = ws.source_file(choice["source_collection_id"], choice["source_id"])
    if entry["body"]["sha256"] != record["recipe"]["sha256"]:
        raise ValueError("The retained process recipe differs from its imported original")
    return deepcopy(choice)


def _product(operator, workspace_key, key):
    ws = operator.ws(workspace_key)
    directory, record, identity = _record(ws, key)
    files = _descriptors(ws, directory, record)
    result = {name: deepcopy(record.get(name)) for name in
              ("id", "title", "state", "phase", "selection", "created_at", "updated_at",
               "completed_at", "completed_stages", "error", "rendered", "sections", "figure_count", "panel_count")}
    result.update(workspace_key=workspace_key, versions=identity["versions"],
                  grid_id=identity["grid"]["id"], source_choice=_source(ws, record))
    result["native_runs"] = [
        {"id": run["id"], "selection": run["selection"],
         "stages": {name: {"completed_at": stage["completed_at"],
                          "version": stage["version"], "reused_from": stage.get("reused_from"),
                          "registry_outputs": len(stage["files"]),
                          "registry_companions": len(stage["companions"])}
                    for name, stage in run["stages"].items()}}
        for run in identity["runs"]]
    result["retained_files"] = len(files)
    result["retained_bytes"] = sum(item["bytes"] for item in files.values())
    result["_downloads"] = []
    for name, item in files.items():
        if name in DISPLAY_FILES or name.endswith(".svg"):
            ticket = operator._ticket(workspace_key, relative_file(ws.root, item["path"]), item, name)
            result["_downloads"].append({**ticket, "member": name})
    result["tables"] = [name for name, member in TABLES.items() if member in files]
    result["watershed_labels"] = {}
    if "processes.json" in files:
        processes = read_json(verify_file(ws.root, files["processes.json"]))
        for packet in processes.get("packets", []):
            for watershed in packet.get("watersheds", []):
                result["watershed_labels"].setdefault(watershed["key"], producer._watershed_label(watershed))
    return result


def _integer(value, name, minimum=0, maximum=None):
    if isinstance(value, bool):
        raise ValueError(name + " must be an integer")
    if isinstance(value, str) and value.isdecimal():
        value = int(value)
    if not isinstance(value, int) or value < minimum or maximum is not None and value > maximum:
        raise ValueError(name + " is outside the supported range")
    return value


TABLE_FILTERS = ("model", "run_id", "baseline_run_id", "alternative_run_id",
                 "watershed", "quantity", "field", "units")
REVIEW_SCHEMA = "upstate.native-process-table-review/v1"
MAX_REVIEW_BYTES = 32 * 1024 * 1024
MAX_REVIEW_ROWS = 100000
TABLE_BASES = {
    "quantities": "Native model-domain watershed quantities and explicitly named derivations.",
    "support": "Original per-quantity finite-cell support and reconstructed pixel-centre masses.",
    "changes": "Native watershed quantities; change is alternative minus baseline.",
    "paired-support": "Identical finite cells for each quantity; paired masses and support changes.",
}


def _table(ws, payload, *, complete=False):
    directory, record, identity = _record(ws, payload.get("id"))
    name = payload.get("table", "quantities")
    if name not in TABLES:
        raise ValueError("Choose an original process quantity or support table")
    offset = 0 if complete else _integer(payload.get("offset", 0), "Row offset")
    limit = MAX_REVIEW_ROWS if complete else _integer(payload.get("limit", 100), "Page size", 1, 250)
    member = TABLES[name]
    files = _descriptors(ws, directory, record)
    if member not in files:
        raise ValueError("Finish this original process table before opening it")
    source = files[member]
    expected = payload.get("expected_source")
    if expected is not None and expected != source:
        raise ValueError("This table selection belongs to a different original CSV edition")
    path = verify_file(ws.root, source)
    filters = {field: payload.get(field, "") for field in TABLE_FILTERS}
    if any(not isinstance(value, str) for value in filters.values()):
        raise ValueError("Choose original string table selectors")
    rows, row_numbers, options, total, matched = [], [], {}, 0, 0
    estimated_bytes = 0
    labels = {}
    with path.open(newline="", encoding="utf-8") as stream:
        reader = csv.DictReader(stream)
        columns = reader.fieldnames or []
        if len(set(columns)) != len(columns):
            raise ValueError("The original table contains duplicate column names")
        if any(value and field not in columns for field, value in filters.items()):
            raise ValueError("This selector is not a column in the chosen original table")
        filters = {field: value for field, value in filters.items() if field in columns}
        options = {field: set() for field in filters}
        for row in reader:
            total += 1
            if None in row or any(value is None for value in row.values()):
                raise ValueError("The original table has an incomplete or extra CSV cell")
            for field in options:
                if row[field]:
                    options[field].add(row[field])
            if row.get("quantity") and row.get("label"):
                labels.setdefault("quantity", {})[row["quantity"]] = row["label"]
            if any(value and row[field] != value for field, value in filters.items()):
                continue
            if offset <= matched < offset + limit:
                if complete:
                    estimated_bytes += len(canonical(row)) + 32
                    if estimated_bytes > MAX_REVIEW_BYTES:
                        raise ValueError("Narrow the table selection before saving; the complete original CSV remains available")
                rows.append(row)
                row_numbers.append(total)
            matched += 1
        if complete and matched > MAX_REVIEW_ROWS:
            raise ValueError("Narrow the table selection to at most 100000 rows; the complete original CSV remains available")
    if any(value and value not in options[field] for field, value in filters.items()):
        raise ValueError("A selected value is absent from this original table")
    result = {
        "report_id": record["id"], "table": name, "columns": columns, "rows": rows,
        "row_numbers": row_numbers, "offset": offset, "limit": limit,
        "total_rows": total, "selected_rows": matched,
        "next_offset": offset + len(rows) if offset + len(rows) < matched else None,
        "filters": filters, "options": {key: sorted(value) for key, value in options.items()},
        "option_labels": labels, "source": source,
        "scope": "original_native_model_domain_watersheds", "basis": TABLE_BASES[name],
    }
    if complete:
        review = {
            "schema": REVIEW_SCHEMA, "project_id": ws.project["id"],
            "report_id": record["id"], "report_title": record["title"],
            "grid_id": identity["grid"]["id"], "run_selection": record["selection"],
            "table": name, "source": deepcopy(source), "scope": result["scope"],
            "basis": result["basis"], "filters": filters, "columns": columns,
            "total_rows": total, "selected_rows": matched,
            "row_numbers": row_numbers, "rows": rows,
        }
        review["review_id"] = digest(review)
        if len(canonical(review)) > MAX_REVIEW_BYTES:
            raise ValueError("Narrow the table selection before saving; the complete original CSV remains available")
        return review
    return result


def read(operator, workspace_key, operation, payload):
    ws = operator.ws(workspace_key)
    if operation == "catalog":
        return producer.catalog(ws)
    if operation == "preview":
        return producer.preview(ws, payload["selection"])
    if operation == "report":
        return _product(operator, workspace_key, payload.get("id"))
    if operation == "table":
        return _table(ws, payload)
    if operation == "table-selection":
        return _table(ws, payload, complete=True)
    if operation == "delivery":
        key = identifier(payload.get("id"))
        # Read the ORIGINAL saved selection rather than accept a browser reconstruction.
        delivery = ws.retained_item("deliveries", identifier(payload.get("delivery_id")))
        selection = producer.attach(ws, key, delivery["selection"])
        return {"report_id": key, "delivery_id": delivery["id"], "selection": selection,
                "source_choice": _source(ws, _record(ws, key)[1])}
    raise ValueError("Choose a registered native process report operation")


def _package(ws, key):
    directory, record, identity = _record(ws, key)
    if record.get("state") != "complete":
        raise ValueError("Finish this process report before exporting its complete source package")
    files = _descriptors(ws, directory, record)
    operation_bytes = canonical(record) + b"\n"
    operation = {"path": "operation.json", "bytes": len(operation_bytes),
                 "sha256": hashlib.sha256(operation_bytes).hexdigest()}
    package_identity = {"schema": "upstate.native-process-package/v1",
                        "project_id": ws.project["id"], "report_id": record["id"],
                        "selection": record["selection"], "source_choice": _source(ws, record),
                        "members": {path: {"bytes": item["bytes"], "sha256": item["sha256"]}
                                    for path, item in sorted(files.items())},
                        "operation": operation}
    package_id = digest(package_identity)
    parent = ws.root / PACKAGE_ROOT / package_id
    parent.mkdir(parents=True, exist_ok=True)
    with held(parent / ".package.lock", blocking=False):
        retained = parent / "package.json"
        if retained.exists():
            value = read_json(retained)
            if value.get("id") != package_id or value.get("identity") != package_identity:
                raise ValueError("The original process package identity differs")
            verify_file(parent, value["archive"])
            return value
        pending, target = parent / ".process-report.zip.pending", parent / "process-report.zip"
        try:
            with zipfile.ZipFile(pending, "w", zipfile.ZIP_DEFLATED, compresslevel=3,
                                 allowZip64=True) as archive:
                for name, item in sorted(files.items()):
                    source = relative_file(ws.root, item["path"])
                    count, checksum = 0, hashlib.sha256()
                    with source.open("rb") as stream, archive.open(name, "w", force_zip64=True) as out:
                        for block in iter(lambda: stream.read(1024 * 1024), b""):
                            out.write(block)
                            count += len(block)
                            checksum.update(block)
                    if count != item["bytes"] or checksum.hexdigest() != item["sha256"]:
                        raise ValueError("An original process member changed: " + name)
                archive.writestr("operation.json", operation_bytes)
                archive.writestr("NATIVE_PROCESS_PACKAGE.json",
                                 canonical({**package_identity, "id": package_id}) + b"\n")
            pending.replace(target)
            value = {"schema": "upstate.native-process-package/v1", "id": package_id,
                     "report_id": record["id"], "title": record["title"],
                     "identity": package_identity, "archive": describe_file(parent, target)}
            atomic_json(retained, value, immutable=True)
            return value
        finally:
            pending.unlink(missing_ok=True)


def invoke(operator, workspace_key, action, payload):
    ws = operator.ws(workspace_key)
    if action == "native.process.build":
        render = payload.get("render", True)
        if type(render) is not bool:
            raise ValueError("Choose whether to render the original PDF and HTML report")
        proposed = producer.preview(ws, payload["selection"])
        if proposed["id"] != identifier(payload.get("expected_preview_id")):
            raise ValueError("The selected native execution changed; preview its current original stage again")
        with held(ws.root / ".workspace.lock", blocking=False):
            result = producer.build(ws, payload["selection"], render=render)
        return {name: deepcopy(result.get(name)) for name in
                ("id", "title", "state", "selection", "source_choice", "phase", "rendered")}
    if action == "native.process.package":
        with held(ws.root / ".workspace.lock", blocking=False):
            result = _package(ws, payload.get("id"))
        return {name: result[name] for name in ("id", "report_id", "title", "archive")}
    raise ValueError("Choose a registered native process report action")


def decorate_task(operator, task):
    if task.get("action") not in ACTIONS:
        return task
    workspace_key = task["workspace"]
    ws = operator.ws(workspace_key)
    if task["action"] == "native.process.build":
        if task.get("state") not in {"complete", "failed", "interrupted", "cancelled"}:
            return task
        key = (task.get("result") or {}).get("id") or task.get("payload", {}).get("expected_preview_id")
        if not isinstance(key, str):
            return task
        try:
            key = identifier(key)
        except ValueError:
            return task
        if not (ws.root / producer.ROOT / key / "operation.json").is_file():
            return task
        unused, record, identity = _record(ws, key)
        # Preserve only a verified actually-created product, including imported
        # scientific sources retained before a later rendering failure.
        source = _source(ws, record)
        task["_native_process"] = {"id": key, "state": record.get("state"),
                                   "phase": record.get("phase"), "source_choice": source}
    elif task.get("state") == "complete":
        result = task["result"]
        task["_native_process"] = {"id": result["report_id"]}
        item = result["archive"]
        path = relative_file(ws.root / PACKAGE_ROOT / identifier(result["id"]), item["path"])
        task["_downloads"] = [operator._ticket(workspace_key, path, item,
                                              "Complete original process report and source files")]
    return task


def verify_workspace(workspace):
    reports, packages = 0, 0
    for path in sorted((workspace.root / producer.ROOT).glob("*/operation.json")):
        directory, record, identity = _record(workspace, path.parent.name)
        if record.get("state") == "complete":
            for item in _descriptors(workspace, directory, record).values():
                original = relative_file(workspace.root, item["path"])
                if original.stat().st_size != item["bytes"]:
                    raise ValueError("Received native process file length differs")
            _source(workspace, record)
        reports += 1
    for path in sorted((workspace.root / PACKAGE_ROOT).glob("*/package.json")):
        record = read_json(path)
        if record.get("id") != path.parent.name or digest(record["identity"]) != record["id"]:
            raise ValueError("Received process package identity differs")
        original = relative_file(path.parent, record["archive"]["path"])
        if original.stat().st_size != record["archive"]["bytes"]:
            raise ValueError("Received process package length differs")
        packages += 1
    return {"native_process_reports": reports, "native_process_packages": packages}
