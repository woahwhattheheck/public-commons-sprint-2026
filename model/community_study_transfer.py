"""Editable Community plan and report dependencies for original Study transfer.

The original immutable records and linked plan revisions remain authoritative.
This module reads their retained sources directly and never creates source views,
new plans, report calculations or a second community store.
"""
from __future__ import annotations

import re

from .common import canonical, digest, identifier, read_json

ROOT_KINDS = ("community-tables", "community-plans", "community-reports", "community-plan-comparisons")
IMMUTABLE_KINDS = ROOT_KINDS
LABELS = {
    "community-tables": "Community source tables",
    "community-plans": "Editable Community plans",
    "community-reports": "Saved Community reports",
    "community-plan-comparisons": "Community revision handovers",
}


def _native(closure, kind, key):
    key = identifier(key)
    value = closure.read(kind + "/" + key + ".json")
    if value.get("schema") != "upstate." + kind + "/v1" or digest(value) != key:
        raise ValueError("The original Community record changed: " + kind + "/" + key)
    return {**value, "id": key}


def _source(closure, source, reason):
    if not isinstance(source, dict):
        raise ValueError("Retain the Community table's original source selection.")
    key = identifier(source.get("collection_id"))
    collection = _native(closure, "sources", key)
    matches = [entry for entry in collection["entries"] if entry.get("id") == source.get("source_id")]
    if len(matches) != 1:
        raise ValueError("The Community table source is absent from its original collection.")
    entry = matches[0]
    if (entry.get("kind") != "table" or entry["body"].get("sha256") != source.get("sha256")
            or entry["body"] != source.get("original")
            or entry.get("uri") != source.get("uri") or entry.get("vintage") != source.get("vintage")):
        raise ValueError("The Community table changed its original source binding.")
    closure.need("sources", key, reason)
    return entry


def _regional(closure, context):
    """Retain the original completed regional edition and every saved source member."""
    regional = context.get("snapshots", {}).get("watershed_context")
    key = context.get("watershed_context_id")
    if regional is None:
        if key:
            raise ValueError("The Community plan lost its selected regional context.")
        return
    if (not isinstance(regional, dict) or not isinstance(key, str)
            or not re.fullmatch(r"watershed-[0-9a-f]{20}", key)
            or regional.get("report_id") != key):
        raise ValueError("The Community plan needs its original regional report identity.")
    prefix = "watershed-context/" + key + "/"
    descriptor = regional.get("report_file")
    if not isinstance(descriptor, dict) or descriptor.get("path") != prefix + "watershed-context.json":
        raise ValueError("The Community plan changed its original regional report member.")
    closure._descriptors(descriptor)
    report = closure.read(descriptor["path"])
    record = closure.read(prefix + "operator-report.json")
    if (report.get("schema") != "upstate.watershed-context/v1" or report.get("id") != key
            or record.get("schema") != "upstate.operator-watershed-context/v1"
            or record.get("id") != key or record.get("state") != "complete"):
        raise ValueError("The Community plan needs its completed original regional report.")
    files = record.get("files")
    if not isinstance(files, dict):
        raise ValueError("The regional context lost its original member inventory.")
    saved = files.get("watershed-context.json")
    if (not isinstance(saved, dict) or saved.get("path") != "watershed-context.json"
            or any(saved.get(field) != descriptor.get(field) for field in ("bytes", "sha256"))):
        raise ValueError("The regional registry differs from the Community plan's retained bytes.")
    if (regional.get("source_fingerprint") is not None
            and regional["source_fingerprint"] != record.get("source_fingerprint")):
        raise ValueError("The regional report changed the Community plan's original calculation inputs.")
    edition = regional.get("source_edition_fingerprint")
    if (edition is not None and edition != record.get("source_edition_fingerprint")
            and edition not in record.get("source_editions", {})):
        raise ValueError("The regional context lost its original retained source edition.")
    for name, item in files.items():
        if not isinstance(item, dict) or item.get("path") != name:
            raise ValueError("The regional context changed a named original member.")
    closure._descriptors(files, prefix)
    # Original received regional reports can carry contained source editions with
    # provenance IDs from another workspace. Preserve those original files rather
    # than interpreting that provenance as a new local source collection.
    closure.tree(prefix.rstrip("/"))


def _context(closure, plan):
    context = plan.get("context")
    if not isinstance(context, dict) or not isinstance(context.get("snapshots"), dict):
        raise ValueError("The Community plan lost its original scientific context.")
    snapshots = context["snapshots"]
    if digest(snapshots) != context.get("snapshot_sha256"):
        raise ValueError("The Community plan's scientific snapshot changed.")
    collections = context.get("source_collection_ids", [])
    rows = snapshots.get("source_collections", [])
    if (not isinstance(collections, list) or len(collections) != len(set(collections))
            or [row.get("id") for row in rows] != collections):
        raise ValueError("The Community plan changed its selected source cohort.")
    for row in rows:
        key = identifier(row.get("id"))
        original = {name: value for name, value in row.items() if name != "id"}
        if original.get("schema") != "upstate.sources/v1" or digest(original) != key:
            raise ValueError("A retained Community scientific source snapshot changed.")
        closure.need("sources", key, "Original Community scientific source collection")
    baseline = context.get("baseline_run_id")
    alternatives = context.get("scenario_run_ids", [])
    if (not isinstance(alternatives, list) or len(alternatives) != len(set(alternatives))
            or baseline in alternatives or alternatives and not baseline):
        raise ValueError("The Community plan changed its original native cohort.")
    expected = ([baseline] if baseline else []) + alternatives
    runs = snapshots.get("runs", [])
    if not isinstance(runs, list) or [row.get("id") for row in runs] != expected:
        raise ValueError("The Community scientific snapshot names another native cohort.")
    grid = context.get("grid_id")
    grid_snapshot = snapshots.get("grid")
    if grid:
        if not isinstance(grid_snapshot, dict) or grid_snapshot.get("id") != grid:
            raise ValueError("The Community plan changed its prepared-grid snapshot.")
        closure.need("grids", grid, "Original Community scientific grid")
    elif grid_snapshot is not None:
        raise ValueError("The Community plan lost its original prepared-grid identity.")
    for row in runs:
        key = identifier(row.get("id"))
        selection = row.get("selection")
        if (not isinstance(selection, dict) or digest(selection) != key
                or selection.get("grid_id") != grid):
            raise ValueError("The Community plan changed a retained native run selection.")
        closure.need("runs", key, "Original Community scientific run")
        closure._descriptors(row.get("artifacts", {}), "runs/" + key + "/")
    comparisons = snapshots.get("comparisons", [])
    if not isinstance(comparisons, list):
        raise ValueError("The Community plan lost its native comparison snapshots.")
    for row in comparisons:
        key = identifier(row.get("id"))
        if (row.get("baseline_run_id") != baseline
                or not any(item.get("run_id") in alternatives for item in row.get("alternatives", []))):
            raise ValueError("A Community comparison differs from its selected native cohort.")
        closure.need("comparisons", key, "Original Community common-support comparison")
    delivery = context.get("delivery_id")
    saved_delivery = snapshots.get("delivery")
    if delivery:
        if not isinstance(saved_delivery, dict) or saved_delivery.get("id") != delivery:
            raise ValueError("The Community plan changed its saved client delivery.")
        closure.need("deliveries", delivery, "Original Community map and client delivery")
    elif saved_delivery is not None:
        raise ValueError("The Community plan lost its original delivery identity.")
    _regional(closure, context)


def _plan(closure, key, plan):
    table = _native(closure, "community-tables", plan.get("table_id"))
    if plan.get("source") != table.get("source"):
        raise ValueError("The Community plan differs from its original table source.")
    closure.need("community-tables", table["id"], "Original editable Community table")
    number = plan.get("revision_number")
    if type(number) is not int or number < 1:
        raise ValueError("The Community plan lost its original revision number.")
    previous_id = plan.get("previous_plan_id")
    if previous_id:
        previous = _native(closure, "community-plans", previous_id)
        if (previous.get("table_id") != table["id"]
                or type(previous.get("revision_number")) is not int
                or previous["revision_number"] + 1 != number):
            raise ValueError("Community history must retain consecutive revisions of its original table.")
        closure.need("community-plans", previous_id, "Original linked Community plan history")
    elif number != 1:
        raise ValueError("The first retained Community plan is missing its original history.")
    imported = plan.get("intervention_import")
    if imported is not None:
        if (not isinstance(imported, dict)
                or imported.get("schema") != "upstate.intervention-csv-import/v1"
                or imported.get("table_id") != table["id"]):
            raise ValueError("The Community plan changed its original intervention CSV binding.")
        source = imported.get("source", {})
        original = source.get("text")
        if not isinstance(original, str):
            raise ValueError("The Community plan lost its full original intervention CSV.")
        import hashlib
        raw = original.encode("utf-8")
        if len(raw) != source.get("bytes") or hashlib.sha256(raw).hexdigest() != source.get("sha256"):
            raise ValueError("The original received intervention CSV changed.")
        compared_id = imported.get("previous_plan_id")
        if compared_id:
            compared = _native(closure, "community-plans", compared_id)
            if compared.get("table_id") != table["id"] or compared.get("revision_number", number) >= number:
                raise ValueError("The received intervention CSV lost its earlier original comparison plan.")
            closure.need("community-plans", compared_id, "Original intervention CSV comparison plan")
    _source(closure, plan["source"], "Original Community table source")
    _context(closure, plan)


def _report(closure, key, report):
    plan = _native(closure, "community-plans", report.get("plan_id"))
    table = _native(closure, "community-tables", report.get("table_id"))
    if (plan.get("table_id") != table["id"] or report.get("source") != plan.get("source")
            or report.get("context_snapshot_sha256") != plan.get("context", {}).get("snapshot_sha256")):
        raise ValueError("The saved Community report differs from its original plan or scientific context.")
    selection = {"schema": "upstate.community-report-selection/v1", "plan_id": plan["id"],
                 "title": report.get("title"), "format_version": report.get("format_version")}
    selection_id = identifier(report.get("selection_id"))
    if digest(selection) != selection_id:
        raise ValueError("The Community report changed its original saved selection.")
    files = report.get("files")
    required = {"REPORT.json", "community-report.json", "community-report.zip"}
    if not isinstance(files, dict) or not required <= files.keys():
        raise ValueError("The complete original Community report is missing.")
    prefix = "community-reports/" + selection_id + "/"
    for name, descriptor in files.items():
        if not isinstance(descriptor, dict) or descriptor.get("path") != prefix + name:
            raise ValueError("A Community report member names another saved edition.")
    closure._descriptors(files)
    packet = closure.read(files["REPORT.json"]["path"])
    payload = closure.read(files["community-report.json"]["path"])
    if (packet.get("schema") != "upstate.community-report-files/v1"
            or payload.get("schema") != "upstate.community-report/v1"
            or packet.get("plan_id") != plan["id"] or packet.get("table_id") != table["id"]
            or packet.get("title") != report.get("title") or payload.get("title") != report.get("title")
            or payload.get("plan") != plan or payload.get("original_table") != table):
        raise ValueError("The retained Community report differs from its exact saved plan and table.")
    indexed = packet.get("files")
    if not isinstance(indexed, dict) or set(indexed) != set(files) - {"REPORT.json", "community-report.zip"}:
        raise ValueError("The Community report member index is incomplete.")
    for name, item in indexed.items():
        if any(item.get(field) != files[name].get(field) for field in ("path", "bytes", "sha256")):
            raise ValueError("The Community report member index changed: " + name)
    closure.need("community-plans", plan["id"], "Editable plan behind the saved Community report")
    closure.need("community-tables", table["id"], "Original table behind the saved Community report")



def _comparison(closure, key, record):
    """Retain the owner's exact chosen-pair handover and its editable originals."""
    from . import community_revisions
    selection = record.get("selection")
    if (not isinstance(selection, dict)
            or selection.get("schema") != community_revisions.SCHEMA + "/selection"
            or selection.get("format_version") != record.get("format_version")
            or selection.get("title") != record.get("title")):
        raise ValueError("The Community comparison changed its original chosen-pair selection.")
    selection_id = identifier(record.get("selection_id"))
    if digest(selection) != selection_id:
        raise ValueError("The Community comparison changed its saved selection identity.")
    comparison = record.get("comparison")
    if (not isinstance(comparison, dict) or digest(comparison) != record.get("comparison_sha256")
            or comparison.get("schema") != community_revisions.SCHEMA
            or comparison.get("project_id") != closure.workspace.project["id"]):
        raise ValueError("The Community comparison changed its original comparison result.")
    lineage_rows = comparison.get("lineage")
    if not isinstance(lineage_rows, list) or len(lineage_rows) < 2:
        raise ValueError("The comparison lost its complete original plan lineage.")
    lineage = [_native(closure, "community-plans", row.get("id")) for row in lineage_rows]
    if (lineage[0]["id"] != selection.get("before_plan_id")
            or lineage[-1]["id"] != selection.get("after_plan_id")):
        raise ValueError("The handover names another pair of original Community plans.")
    table = _native(closure, "community-tables", comparison.get("table_id"))
    if community_revisions.compare_saved(closure.workspace.project["id"], lineage, table) != comparison:
        raise ValueError("The handover differs from its original retained Community plans.")
    for plan in lineage:
        closure.need("community-plans", plan["id"], "Editable original Community comparison lineage")
    closure.need("community-tables", table["id"], "Original Community comparison table")
    report_ids = selection.get("report_ids")
    if not isinstance(report_ids, list) or len(report_ids) != len(set(report_ids)):
        raise ValueError("The Community comparison changed its attached report roster.")
    endpoint_ids = {lineage[0]["id"], lineage[-1]["id"]}
    for report_id in report_ids:
        report = _native(closure, "community-reports", report_id)
        if report.get("plan_id") not in endpoint_ids or report.get("table_id") != table["id"]:
            raise ValueError("A handover report belongs to another original plan pair.")
        closure.need("community-reports", report_id, "Original report attached to the Community comparison")
    files = record.get("files")
    required = {"COMPARISON.json", "comparison.json", "community-revision-comparison.zip"}
    if not isinstance(files, dict) or not required <= files.keys():
        raise ValueError("The completed original Community revision handover is missing.")
    prefix = "community-plan-comparisons/" + selection_id + "/"
    if any(not isinstance(item, dict) or item.get("path") != prefix + name
           for name, item in files.items()):
        raise ValueError("A Community handover member names another original comparison.")
    closure._descriptors(files)
    inventory = closure.read(files["COMPARISON.json"]["path"])
    expected_files = {name: value for name, value in files.items()
                      if name not in {"COMPARISON.json", "community-revision-comparison.zip"}}
    if (inventory.get("schema") != community_revisions.SCHEMA + "/files"
            or inventory.get("project_id") != closure.workspace.project["id"]
            or inventory.get("selection") != selection
            or inventory.get("comparison_sha256") != record["comparison_sha256"]
            or inventory.get("files") != expected_files
            or closure.read(files["comparison.json"]["path"]) != comparison):
        raise ValueError("The completed Community handover inventory differs from its retained originals.")
    for plan in lineage:
        name = "plans/" + plan["id"] + ".json"
        if name not in files or closure.read(files[name]["path"]) != {
                field: value for field, value in plan.items() if field != "id"}:
            raise ValueError("The handover lost an original saved plan member.")
    name = "tables/" + table["id"] + ".json"
    if name not in files or closure.read(files[name]["path"]) != {
            field: value for field, value in table.items() if field != "id"}:
        raise ValueError("The handover lost its original saved table member.")


def visit(closure, kind, key, value):
    if kind not in IMMUTABLE_KINDS:
        return False
    if value.get("schema") != "upstate." + kind + "/v1" or digest(value) != key:
        raise ValueError("The original Community record changed: " + kind + "/" + key)
    if kind == "community-tables":
        _source(closure, value.get("source"), "Original Community table source")
    elif kind == "community-plans":
        _plan(closure, key, value)
    elif kind == "community-plan-comparisons":
        _comparison(closure, key, value)
    else:
        _report(closure, key, value)
    return True


def include_source(closure, collection_id, entry):
    """Follow a selected original Community report into its editable local history."""
    from . import observed_context
    if entry.get("role") != "community-planning-report-context":
        return False
    closure._body(entry["body"])
    recipe = closure.read(entry["body"]["object"])
    if (recipe.get("schema") != observed_context.SCHEMA
            or recipe.get("report_context_kind") != "community_planning"):
        raise ValueError("The selected Community source lost its original scientific recipe.")
    project_id = recipe.get("project_id")
    if not isinstance(project_id, str) or not project_id:
        raise ValueError("The selected Community source lost its declared original project.")
    key, plan_id = identifier(recipe.get("community_report_id")), identifier(recipe.get("plan_id"))
    metadata = entry.get("metadata", {})
    if (entry.get("uri") != "workspace://" + project_id + "/community-reports/" + key
            or metadata.get("report_schema") != observed_context.SCHEMA
            or metadata.get("report_context_kind") != "community_planning"
            or metadata.get("community_report_id") != key or metadata.get("plan_id") != plan_id):
        raise ValueError("The selected Community source changed its original producer identity.")
    if project_id != closure.workspace.project["id"]:
        return False
    report = _native(closure, "community-reports", key)
    if (report.get("plan_id") != plan_id
            or report.get("files", {}).get("community-report.json", {}).get("sha256")
            != recipe.get("report_sha256")):
        raise ValueError("The local Community source differs from its original report revision.")
    companions = {}
    for item in entry.get("companions", []):
        name = item.get("view_path", item.get("filename"))
        if name in companions:
            raise ValueError("The Community source repeats an original report companion.")
        companions[name] = item
    for name, descriptor in report["files"].items():
        retained = companions.get("retained/" + name)
        if retained is None or any(retained.get(field) != descriptor.get(field) for field in ("bytes", "sha256")):
            raise ValueError("The Community source lost an original report companion: " + name)
        closure._body(retained)
    saved = companions.get("retained/saved-report.json")
    if saved is None:
        raise ValueError("The Community source lost its original saved-report record.")
    closure._body(saved)
    if closure.read(saved["object"]) != report:
        raise ValueError("The Community source belongs to another original saved report.")
    closure.need("community-reports", key, "Editable history of the explicitly ordered Community report")
    return True


def _related_row(closure, path):
    try:
        value = read_json(path)
        if not isinstance(value, dict):
            raise ValueError("The related Community record is not an object.")
        return value
    except Exception as error:
        closure.related_issues.append({
            "path": path.relative_to(closure.root).as_posix(),
            "message": str(error), "type": type(error).__name__,
        })
        return None


def related(closure):
    """Add original reports, and plans of explicitly selected source-table roots."""
    explicit_tables = {row["id"] for row in closure.selection["roots"] if row["kind"] == "community-tables"}
    plans = {key for kind, key in closure.nodes if kind == "community-plans"}
    if explicit_tables:
        for path in sorted((closure.root / "community-plans").glob("*.json")):
            value = _related_row(closure, path)
            if value is not None and value.get("table_id") in explicit_tables:
                key = identifier(path.stem)
                closure.need("community-plans", key, "Editable plans of the explicitly selected Community table")
                plans.add(key)
    for path in sorted((closure.root / "community-reports").glob("*.json")):
        value = _related_row(closure, path)
        if value is not None and value.get("plan_id") in plans:
            closure.need("community-reports", identifier(path.stem), "Saved report of the selected Community history")
    for path in sorted((closure.root / "community-plan-comparisons").glob("*.json")):
        value = _related_row(closure, path)
        selection = value.get("selection", {}) if value is not None else {}
        if selection.get("before_plan_id") in plans and selection.get("after_plan_id") in plans:
            closure.need("community-plan-comparisons", identifier(path.stem),
                         "Saved chosen-pair handover of the selected Community history")



def lock_paths(closure):
    paths = set()
    for kind, key in closure.nodes:
        if kind not in {"community-reports", "community-plan-comparisons"}:
            continue
        report = _native(closure, kind, key)
        lock = ".report.lock" if kind == "community-reports" else ".comparison.lock"
        paths.add(closure.root / kind / identifier(report["selection_id"]) / lock)
    return sorted(paths, key=str)


def catalogue(workspace, kind):
    if kind not in ROOT_KINDS:
        raise ValueError("Choose original Community tables, plans or reports.")
    rows = []
    for path in (workspace.root / kind).glob("*.json"):
        key = path.stem
        try:
            identifier(key)
            value = read_json(path)
            if value.get("schema") != "upstate." + kind + "/v1" or digest(value) != key:
                raise ValueError("The original Community record changed.")
            row = {"kind": kind, "id": key, "title": value.get("title") or key[:12],
                   "state": "saved", "updated_at": "", "selection": {},
                   "counts": {"revision": value.get("revision_number"),
                              "interventions": len(value.get("interventions", [])),
                              "groups": value.get("group_count", len(value.get("selected_groups", []))) }}
            for name in ("table_id", "plan_id", "previous_plan_id"):
                if value.get(name):
                    row["selection"][name] = value[name]
            if kind == "community-plan-comparisons":
                row["selection"] = dict(value.get("selection", {}))
                row["counts"] = value.get("comparison", {}).get("counts", {})
            if kind == "community-plans":
                row["selection"].update({name: value["context"][name] for name in
                    ("grid_id", "baseline_run_id", "scenario_run_ids", "delivery_id")
                    if value["context"].get(name)})
        except Exception as error:
            row = {"kind": kind, "id": key, "title": key[:12], "state": "unreadable",
                   "updated_at": "", "selection": {},
                   "error": {"type": type(error).__name__, "message": str(error)}}
        rows.append(row)
    return rows
