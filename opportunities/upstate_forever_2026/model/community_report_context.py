"""Receive a saved Community planning report into the ordered scientific report."""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import tempfile

from . import observed_context
from .common import (atomic_json, describe_file, digest, file_digest, held,
                     identifier, read_json, verify_file)
from .communities import REPORT_KIND

SCHEMA = "upstate.community-report-context/v1"
VERSION = "1"
RECIPE = "community-scientific-report.json"
MANIFEST = "sources.json"


def _relative(value):
    if not isinstance(value, str) or "\\" in value or "\0" in value:
        raise ValueError("Original Community report members need canonical relative names")
    path = PurePosixPath(value)
    if path.is_absolute() or not path.parts or ".." in path.parts or path.as_posix() != value:
        raise ValueError("Original Community report members must stay in their report")
    return path


def _copy(source, target, expected):
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        if target.stat().st_size != expected["bytes"] or file_digest(target) != expected["sha256"]:
            raise ValueError("A retained Community report member changed: " + str(target))
        return
    handle, temporary = tempfile.mkstemp(prefix=".community-source-", dir=target.parent)
    try:
        size, sha = 0, hashlib.sha256()
        with os.fdopen(handle, "wb") as output, open(source, "rb") as original:
            for block in iter(lambda: original.read(1024 * 1024), b""):
                output.write(block)
                size += len(block)
                sha.update(block)
            output.flush()
            os.fsync(output.fileno())
        if size != expected["bytes"] or sha.hexdigest() != expected["sha256"]:
            raise ValueError("The original Community report changed during receiving")
        os.replace(temporary, target)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def _text(value):
    if value is None:
        return "Unspecified"
    if isinstance(value, bool):
        return "Yes" if value else "No"
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False, sort_keys=True, allow_nan=False)
    return str(value)


def _table(columns, rows):
    return {"kind": "table", "columns": columns,
            "rows": [[_text(value) for value in row] for row in rows]}


def _sections(payload, report_id, report_sha256):
    plan = payload["plan"]
    sections = [
        ["Community planning context", [
            plan.get("purpose") or "Saved utility and community intervention programme.",
            "This section retains the selected whole census block groups, utility memberships and saved "
            "intervention decisions. Population and household counts describe the source geographies. "
            "Utility service populations describe their whole systems; overlapping utility and watershed "
            "summaries retain their original membership and are not additive.",
            "Interventions, priorities, progress labels and cost estimates are the saved planning decisions. "
            "They are separate from measured environmental outcomes and modeled export reductions.",
            _table(["Original selection", "Saved value"], [
                ["Plan", plan.get("title")], ["Plan ID", plan["id"]],
                ["Original community source", plan.get("source")],
                ["Saved report", report_id], ["Original report JSON SHA256", report_sha256],
                ["Whole-block-group summary", plan.get("summaries", {}).get("all")],
            ]),
        ]],
        ["Selected utilities and source communities", [
            _table(["Utility", "Block groups", "Block-group population", "Households",
                    "Poverty households", "Approximate whole-system service population", "Service population basis"], [
                [row.get("label"), row.get("geoid_count"), row.get("population_total"),
                 row.get("households_total"), row.get("poverty_households_total"),
                 row.get("approximate_service_population"), row.get("service_population_basis")]
                for row in payload.get("utility_summaries", [])
            ]),
            _table(["Block group", "Utility memberships", "HUC12 memberships", "Population", "Households",
                    "Median household income", "Poverty households", "Original source notes"], [
                [row.get("geoid"), row.get("utility_ids"), row.get("watershed_ids"),
                 row.get("population"), row.get("households"), row.get("median_household_income"),
                 row.get("households_below_poverty"), row.get("source_notes")]
                for row in payload.get("communities", [])
            ]),
        ]],
        ["Ordered intervention programme", [
            "The original editable interventions.csv accompanies this report. When this plan received an edited "
            "CSV, its unchanged received-interventions.csv and INTERVENTION_IMPORT.json accompany it too.",
            _table(["Order", "Intervention", "Priority / recorded status", "Utility / HUC12", "Strategy",
                    "Estimated USD", "Owner", "Reason", "Next step"], [
                [row.get("position"), row.get("title"),
                 str(row.get("priority", "")) + " / " + str(row.get("status", "")),
                 str(row.get("utility_id", "")) + " / " + str(row.get("watershed_id", "")),
                 row.get("strategy"), row.get("cost_estimate_usd"), row.get("owner"),
                 row.get("reason"), row.get("next_step")]
                for row in payload.get("interventions", [])
            ]),
        ]],
    ]
    regional = payload.get("regional_watershed_context")
    if regional:
        hucs = regional.get("hucs", [])
        sections.append(["Original regional watershed planning context", [
            *payload.get("watershed_scope_notes", []),
            "A complete South Carolina query with zero selected-class matches describes the named target "
            "classes in that source edition. Water-quality condition and impairment decisions use their "
            "assessment sources. Whole-HUC area is shown once; state portions retain each original edition.",
            _table(["HUC12 / watershed", "Whole-HUC acres", "NRCS edition", "Priority states",
                    "Original programme labels", "Selected classification matches", "Query coverage"], [
                [str(row.get("huc12", "")) + " / " + str(row.get("name", "")),
                 row.get("area_acres"), row.get("nrcs_edition"), row.get("priority_states"),
                 row.get("system_types"), row.get("selected_classification_count"),
                 row.get("classification_query_coverage")]
                for row in hucs
            ]),
            _table(["HUC12", "State", "NRCS edition", "Original state acres", "Original designation",
                    "Programme label", "Resource concern"], [
                [row.get("huc12"), state.get("st_usps"), row.get("nrcs_edition"),
                 state.get("st_ac"), state.get("fy26_status"), state.get("system_type"),
                 state.get("resource_concern")]
                for row in hucs for state in row.get("nrcs_state_rows", [])
            ]),
            _table(["Regional source", "Saved identity"], [
                ["Original report", regional.get("report_id")],
                ["Original report file", regional.get("report_file")],
                ["Source fingerprint", regional.get("source_fingerprint")],
                ["Selected HUC12s", regional.get("selected_huc12s")],
            ]),
        ]])
    physical = payload.get("physical_context", [])
    if physical:
        sections.append(["Original modeled physical context", [
            *payload.get("scientific_scope_notes", []),
            _table(["Original run", "Metric", "Original value", "Units", "Run valid cells",
                    "Alternative minus baseline", "Comparison valid cells", "Comparison basis"], [
                [row.get("run_id"), row.get("pollutant"), row.get("value"), row.get("unit"),
                 row.get("run_valid_cells"), row.get("alternative_minus_baseline"),
                 row.get("comparison_valid_cells"), row.get("comparison_spatial_basis")]
                for row in physical
            ]),
        ]])
    sections.append(["Editable original report and source lineage", [
        "The complete original Community report edition accompanies these sections: its HTML, Markdown, "
        "JSON, all indexed CSVs, REPORT.json, original community source, complete report ZIP, and any "
        "original regional source and received intervention CSV. The original JSON retains full precision, "
        "original selections and saved scientific context.",
        _table(["Original lineage", "Saved value"], [
            ["Parent plan", plan.get("previous_plan_id")],
            ["Scientific context snapshot", plan.get("context", {}).get("snapshot_sha256")],
            ["Received intervention source", plan.get("intervention_import", {}).get("source", {}).get("sha256")],
            ["CSV handling", payload.get("csv_text_handling")],
        ]),
    ]])
    return sections


def delivery_selection(workspace, source, delivery_id=None):
    selection = {}
    if delivery_id:
        original = workspace.retained_item("deliveries", identifier(delivery_id))
        selection = copy.deepcopy(original["selection"])
    choices = observed_context.source_choices(selection)
    if source not in choices:
        choices.append(source)
    selection["observed_context_sources"] = choices
    selection.setdefault("source_roles", {})[observed_context.ROLE] = choices[0]
    selection.pop("observed_context_binding", None)
    return selection


def prepare(workspace, report_id, *, report_sha256, delivery_id=None, import_source=True):
    """Retain every original report member and append this source once."""
    report_id, report_sha256 = identifier(report_id), identifier(report_sha256)
    report = workspace._get(REPORT_KIND, report_id)
    files = report.get("files")
    if not isinstance(files, dict) or not {"REPORT.json", "community-report.json", "community-report.zip"} <= files.keys():
        raise ValueError("Choose a complete saved Community report with its original file index")
    paths = {name: verify_file(workspace.root, item) for name, item in files.items()}
    if files["community-report.json"]["sha256"] != report_sha256:
        raise ValueError("The selected Community report edition changed; reopen the saved report")
    original_index = read_json(paths["REPORT.json"])
    payload = read_json(paths["community-report.json"])
    if (original_index.get("schema") != "upstate.community-report-files/v1"
            or payload.get("schema") != "upstate.community-report/v1"
            or original_index.get("plan_id") != report.get("plan_id")
            or payload.get("plan", {}).get("id") != report.get("plan_id")
            or original_index.get("table_id") != report.get("table_id")
            or payload.get("original_table", {}).get("id") != report.get("table_id")
            or original_index.get("title") != report.get("title")
            or payload.get("title") != report.get("title")):
        raise ValueError("The original Community report does not match its saved plan and table")
    indexed = original_index.get("files")
    if not isinstance(indexed, dict) or set(indexed) != set(files) - {"REPORT.json", "community-report.zip"}:
        raise ValueError("The original Community report file inventory is incomplete")
    for name, item in indexed.items():
        if any(item.get(key) != files[name].get(key) for key in ("path", "bytes", "sha256")):
            raise ValueError("The original Community report index differs: " + name)
    if payload["plan"].get("context", {}).get("snapshot_sha256") != report.get("context_snapshot_sha256"):
        raise ValueError("The original Community report scientific context differs")
    identity = {"schema": SCHEMA, "version": VERSION, "project_id": workspace.project["id"],
                "report_id": report_id, "report_sha256": report_sha256,
                "original_files": {name: {"bytes": item["bytes"], "sha256": item["sha256"]}
                                   for name, item in sorted(files.items())},
                "producer_sha256": file_digest(Path(__file__)),
                "report_loader_edition": observed_context.EDITION}
    operation_id = digest(identity)
    directory = paths["REPORT.json"].parent / "scientific-context" / operation_id
    lock = workspace.root / "locks" / ("community-report-context-" + operation_id + ".lock")
    with held(lock):
        inputs = []
        for name, item in sorted(files.items()):
            member = "retained/" + _relative(name).as_posix()
            target = directory.joinpath(*PurePosixPath(member).parts)
            _copy(paths[name], target, item)
            inputs.append(describe_file(directory, target))
        atomic_json(directory / "retained" / "saved-report.json", report, immutable=True)
        inputs.append(describe_file(directory, directory / "retained" / "saved-report.json"))
        title = (report.get("title") or payload["title"]) + " — community planning context"
        recipe = {"schema": observed_context.SCHEMA, "title": title,
                  "edition": "community-planning-" + VERSION,
                  "report_context_kind": "community_planning",
                  "project_id": workspace.project["id"], "community_report_id": report_id,
                  "plan_id": report["plan_id"], "report_sha256": report_sha256,
                  "inputs": inputs, "sections": _sections(payload, report_id, report_sha256),
                  "source_links": [item["path"] for item in inputs], "figures": []}
        atomic_json(directory / RECIPE, recipe, immutable=True)
        source_id = "community-planning-report-" + operation_id[:20]
        manifest = {"schema": "upstate.sources/v1", "title": title,
                    "captured_at": report.get("created_at"),
                    "scope": {"project_id": workspace.project["id"], "plan_id": report["plan_id"],
                              "community_report_id": report_id, "report_sha256": report_sha256},
                    "entries": [{
                        "id": source_id, "kind": "document", "title": title,
                        "role": "community-planning-report-context", "path": RECIPE,
                        "uri": "workspace://" + workspace.project["id"] + "/" + REPORT_KIND + "/" + report_id,
                        "vintage": report.get("created_at"), "sha256": file_digest(directory / RECIPE),
                        "metadata": {"report_schema": observed_context.SCHEMA,
                                     "report_context_kind": "community_planning",
                                     "plan_id": report["plan_id"], "community_report_id": report_id},
                        "companions": inputs,
                    }]}
        atomic_json(directory / MANIFEST, manifest, immutable=True)
        result = {"schema": SCHEMA, "id": operation_id, "title": title,
                  "project_id": workspace.project["id"], "community_report_id": report_id,
                  "plan_id": report["plan_id"], "report_sha256": report_sha256,
                  "source_id": source_id, "original_member_count": len(files),
                  "files": [describe_file(workspace.root, directory / name) for name in (MANIFEST, RECIPE)] +
                           [describe_file(workspace.root, directory / "retained" / "community-report.zip")]}
        if import_source:
            collection = workspace.import_sources(directory / MANIFEST)
            source = {"source_collection_id": collection["id"], "source_id": source_id}
            result.update(source=source, observed_context_binding=observed_context.bind(
                workspace, {"observed_context_sources": [source]}))
            atomic_json(directory / "registered-context.json", result, immutable=True)
            result["delivery_selection"] = delivery_selection(workspace, source, delivery_id)
            result["selected_delivery_id"] = delivery_id
        return result


def main(argv=None):
    from .workspace import Workspace
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--report-id", required=True)
    parser.add_argument("--report-sha256", required=True)
    parser.add_argument("--delivery-id")
    parser.add_argument("--prepare-only", action="store_true")
    args = parser.parse_args(argv)
    if args.prepare_only and args.delivery_id:
        parser.error("--delivery-id requires source import")
    result = prepare(Workspace(args.workspace), args.report_id,
                     report_sha256=args.report_sha256, delivery_id=args.delivery_id,
                     import_source=not args.prepare_only)
    print(json.dumps(result, indent=2, ensure_ascii=False, allow_nan=False))


if __name__ == "__main__":
    main()
