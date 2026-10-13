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
VERSION = "3"
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
    handle, temporary = tempfile.mkstemp(prefix=".write-community-source-", dir=target.parent)
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
    if isinstance(value, dict):
        return "\n".join(str(key).replace("_", " ") + ": " + _text(item)
                         for key, item in value.items()) or "None recorded"
    if isinstance(value, (list, tuple)):
        return "\n".join(_text(item) for item in value) or "None recorded"
    return str(value)


def _table(columns, rows):
    return {"kind": "table", "columns": columns,
            "rows": [[_text(value) for value in row] for row in rows]}


def _metadata_rows(value, prefix=""):
    """Show every retained metadata leaf without serializing a JSON cell."""
    if isinstance(value, dict):
        rows = []
        for key, item in value.items():
            label = str(key).replace("_", " ")
            rows.extend(_metadata_rows(item, prefix + " / " + label if prefix else label))
        return rows or [[prefix or "Value", "None recorded"]]
    if isinstance(value, (list, tuple)):
        if any(isinstance(item, (dict, list, tuple)) for item in value):
            return [row for number, item in enumerate(value, 1)
                    for row in _metadata_rows(item, prefix + " / item " + str(number))]
    return [[prefix or "Value", _text(value)]]


def _coverage(known, total):
    return _text(known) + " of " + _text(total) + " block groups"


def _summary_blocks(summary, income):
    total = summary.get("geoid_count")
    currency = income.get("currency") or "currency unspecified"
    return [
        "Selected block groups: " + _text(total) + ". Complete totals require a value for every selected "
        "block group. Known-group subtotals retain the available source values and their coverage.",
        _table(["Whole-block-group measure", "Complete selected total", "Known-group subtotal",
                "Groups with a value"], [
            [label, summary.get(key), summary.get(key + "_known_sum"),
             _coverage(summary.get(key + "_known_groups"), total)]
            for label, key in (("People", "population_total"), ("Households", "households_total"),
                               ("Households below poverty", "poverty_households_total"))
        ]),
        _table(["Poverty measure", "Saved value", "Source support"], [
            ["Selected-group household poverty (%)", summary.get("household_poverty_percent"),
             "Available only when every selected group has both household and poverty counts"],
            ["Known paired-group household poverty (%)", summary.get("household_poverty_known_percent"),
             _coverage(summary.get("household_poverty_known_groups"), total)],
            ["Paired poverty numerator (households)", summary.get("household_poverty_numerator"),
             "Households below poverty in groups with both counts"],
            ["Paired household denominator (households)", summary.get("household_poverty_denominator"),
             "All households in the same paired groups"],
        ]),
        "The poverty percentage uses the saved paired household numerator and denominator, rather than "
        "an average of block-group percentages. A zero household denominator has no percentage.",
        _table(["Income and membership context", "Saved value"], [
            ["Income reference (" + currency + ")", income.get("threshold")],
            ["Income reference source", income.get("source_reference")],
            ["Block groups with a known median income", _coverage(summary.get("income_known_groups"), total)],
            ["Known block-group medians below the source reference",
             _text(summary.get("below_state_median_count")) + " of " + _text(summary.get("income_known_groups"))],
            ["Lowest block-group median (" + currency + ")", summary.get("median_income_min")],
            ["Highest block-group median (" + currency + ")", summary.get("median_income_max")],
            ["Block groups with multiple original memberships", summary.get("shared_membership_groups")],
        ]),
        "Income bounds describe the individual block-group medians. No pooled community median or mean "
        "household income is calculated. Each selected block group appears once in the overall totals.",
    ]


def _scope_blocks(rows, scope_label):
    blocks = []
    for row in rows:
        total = row.get("geoid_count")
        blocks.append(_table([scope_label + " measure", "Complete total", "Known-group subtotal",
                              "Groups with a value"], [
            [str(row.get("label") or row.get("scope_id") or "Unnamed") + " — " + label,
             row.get(key), row.get(key + "_known_sum"),
             _coverage(row.get(key + "_known_groups"), total)]
            for label, key in (("people", "population_total"), ("households", "households_total"),
                               ("households below poverty", "poverty_households_total"))
        ]))
        blocks.append(_table([scope_label + " identity / paired poverty", "Saved value"], [
            ["Source scope ID", row.get("scope_id")],
            ["Selected block groups", total],
            ["Selected-group household poverty (%)", row.get("household_poverty_percent")],
            ["Known paired-group household poverty (%)", row.get("household_poverty_known_percent")],
            ["Paired-group coverage", _coverage(row.get("household_poverty_known_groups"), total)],
            ["Paired poverty numerator (households)", row.get("household_poverty_numerator")],
            ["Paired household denominator (households)", row.get("household_poverty_denominator")],
        ]))
    return blocks


def _revision_change_rows(revision):
    rows = []
    for change in revision.get("changes", []):
        before, after = change.get("before"), change.get("after")
        label = str(change.get("intervention_id", "")) + " / " + str(change.get("title", ""))
        if isinstance(before, dict) or isinstance(after, dict):
            left = dict(_metadata_rows(before)) if isinstance(before, dict) else {}
            right = dict(_metadata_rows(after)) if isinstance(after, dict) else {}
            for field in dict.fromkeys([*left, *right]):
                rows.append([change.get("change"), label, str(change.get("field", "")) + " / " + field,
                             left.get(field, "Absent from this edition"),
                             right.get(field, "Absent from this edition")])
        else:
            rows.append([change.get("change"), label, change.get("field"), before, after])
    return rows


def _revision_blocks(revision):
    selection = revision.get("selection", {})
    before_summary, after_summary = (selection.get(name, {}) for name in ("before_summary", "after_summary"))
    costs = revision.get("costs", {})
    before_cost, after_cost = (costs.get(name, {}) for name in ("before", "after"))
    context = revision.get("scientific_context", {})
    csv = revision.get("received_csv", {})
    changes = revision.get("plan_changes", []) + context.get("identifier_changes", [])
    blocks = [
        _table(["Saved revision", "Original value"], [
            ["Previous plan", revision.get("previous_plan_id")],
            ["Current plan", revision.get("plan_id")],
            ["Previous revision number", revision.get("previous_revision_number")],
            ["Current revision number", revision.get("revision_number")],
            ["Original community table", revision.get("table_id")],
            ["Original community source SHA256", revision.get("source_sha256")],
        ]),
        _table(["Recorded change count", "Value"], _metadata_rows(revision.get("counts", {}))),
        selection.get("basis") or "Selection changes describe whole-block-group membership.",
        _table(["Selected membership / source measure", "Previous edition", "Current edition"], [
            ["Utility filters", selection.get("before", {}).get("utility_ids"),
             selection.get("after", {}).get("utility_ids")],
            ["Watershed filters", selection.get("before", {}).get("watershed_ids"),
             selection.get("after", {}).get("watershed_ids")],
            ["Whole block groups", before_summary.get("geoid_count"), after_summary.get("geoid_count")],
            ["Selected GEOIDs", before_summary.get("geoids"), after_summary.get("geoids")],
            ["Added selected GEOIDs", "Not applicable", selection.get("added_geoids")],
            ["Removed selected GEOIDs", selection.get("removed_geoids"), "Not applicable"],
            ["Complete population total", before_summary.get("population_total"),
             after_summary.get("population_total")],
            ["Groups with population", _coverage(before_summary.get("population_total_known_groups"),
                                                before_summary.get("geoid_count")),
             _coverage(after_summary.get("population_total_known_groups"), after_summary.get("geoid_count"))],
            ["Complete household total", before_summary.get("households_total"),
             after_summary.get("households_total")],
            ["Groups with households", _coverage(before_summary.get("households_total_known_groups"),
                                                before_summary.get("geoid_count")),
             _coverage(after_summary.get("households_total_known_groups"), after_summary.get("geoid_count"))],
        ]),
        costs.get("basis") or "Entered planning estimates retain their original availability.",
        _table(["Entered planning estimates (" + str(costs.get("currency") or "currency unspecified") + ")",
                "Previous edition", "Current edition"], [
            ["Entered total", before_cost.get("entered_total_usd"), after_cost.get("entered_total_usd")],
            ["Interventions with an estimate", before_cost.get("known_estimate_count"),
             after_cost.get("known_estimate_count")],
            ["Interventions with an unspecified estimate", before_cost.get("unknown_estimate_count"),
             after_cost.get("unknown_estimate_count")],
        ]),
        _table(["Saved signed change", "Value"], [
            ["Current minus previous entered estimates (USD)", costs.get("entered_estimate_difference_usd")],
        ]),
        _table(["Change", "Intervention", "Original field", "Previous value", "Current value"],
               _revision_change_rows(revision)),
    ]
    if changes:
        blocks.append(_table(["Plan / scientific selection field", "Previous value", "Current value"],
                             [[row.get("field"), row.get("before"), row.get("after")] for row in changes]))
    blocks.append(_table(["Revision source lineage", "Previous edition", "Current edition"], [
        ["Scientific snapshot SHA256", context.get("before_snapshot_sha256"), context.get("after_snapshot_sha256")],
        ["Scientific snapshot changed", "Not applicable", context.get("snapshot_changed")],
        ["Received intervention CSV SHA256", csv.get("before_sha256"), csv.get("after_sha256")],
        ["Received CSV parent plan", csv.get("before_import_plan_id"), csv.get("after_import_plan_id")],
    ]))
    return blocks


def _sections(payload, report_id, report_sha256):
    plan = payload["plan"]
    source = plan.get("source") or {}
    income = plan.get("metadata", {}).get("income_reference", {})
    currency = income.get("currency") or "currency unspecified"
    aggregate = plan.get("summaries", {}).get("all", {})
    utilities = payload.get("utility_summaries", [])
    cost = plan.get("cost_summary", {})
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
                ["Saved report", report_id], ["Original report JSON SHA256", report_sha256],
            ]),
            *_summary_blocks(aggregate, income),
        ]],
        ["Original community source", [
            _table(["Source field", "Saved value"], [
                ["Source title", source.get("title")],
                ["Original source URI", source.get("uri")],
                ["Source vintage", source.get("vintage")],
                ["Source collection", source.get("collection_id")],
                ["Source member", source.get("source_id")],
                ["Original source SHA256", source.get("sha256")],
            ]),
            _table(["Retained original file", "Saved value"],
                   _metadata_rows(source.get("original"), "Original file")),
            *plan.get("metadata", {}).get("limitations", []),
        ]],
        ["Selected utilities and source communities", [
            _table(["Utility", "Approximate whole-system service population", "Service population basis",
                    "Original service population source"], [
                [row.get("label"), row.get("approximate_service_population"),
                 row.get("service_population_basis"), row.get("service_population_source")]
                for row in utilities
            ]),
            *_scope_blocks(utilities, "Utility"),
            "The following values belong to each original whole block group. Memberships identify the "
            "selected utility and watershed associations without dividing household or population counts.",
            _table(["Block group", "Population", "Households",
                    "Median household income (" + currency + ")", "Households below poverty"], [
                [row.get("geoid"), row.get("population"), row.get("households"),
                 row.get("median_household_income"), row.get("households_below_poverty")]
                for row in payload.get("communities", [])
            ]),
            _table(["Block group", "Utility memberships", "HUC12 memberships", "Original source notes"], [
                [row.get("geoid"), row.get("utility_ids"), row.get("watershed_ids"), row.get("source_notes")]
                for row in payload.get("communities", [])
            ]),
        ]],
        ["Selected watershed community context", [
            "These totals retain whole block groups associated with each selected watershed. Groups shared "
            "by watersheds remain present in each membership summary; totals across watersheds cannot be added.",
            *_scope_blocks(payload.get("watershed_summaries", []), "Watershed"),
        ]],
        ["Ordered intervention programme", [
            "The original editable interventions.csv accompanies this report. When this plan received an edited "
            "CSV, its unchanged received-interventions.csv and INTERVENTION_IMPORT.json accompany it too.",
            _table(["Planning cost coverage", "Saved value"], [
                ["Interventions", cost.get("intervention_count")],
                ["Interventions with an entered estimate", cost.get("known_estimate_count")],
                ["Total of entered estimates (USD)", cost.get("known_estimate_total")],
            ]),
            "The cost total includes entered estimates only. An unspecified cost is an open planning input; "
            "it does not become a zero estimate or a measured economic benefit.",
            _table(["Order / intervention", "Priority / recorded status", "Utility / HUC12", "Strategy",
                    "Estimated USD"], [
                [str(row.get("position", "")) + " / " + str(row.get("title", "")),
                 str(row.get("priority", "")) + " / " + str(row.get("status", "")),
                 str(row.get("utility_id", "")) + " / " + str(row.get("watershed_id", "")),
                 row.get("strategy"), row.get("cost_estimate_usd")]
                for row in payload.get("interventions", [])
            ]),
            _table(["Order / intervention", "Owner", "Reason", "Next step"], [
                [str(row.get("position", "")) + " / " + str(row.get("title", "")),
                 row.get("owner"), row.get("reason"), row.get("next_step")]
                for row in payload.get("interventions", [])
            ]),
        ]],
    ]
    revision = payload.get("plan_revision")
    if revision:
        sections.insert(1, ["Changes from previous saved Community plan", _revision_blocks(revision)])
    regional = payload.get("regional_watershed_context")
    if regional:
        hucs = regional.get("hucs", [])
        coverage = regional.get("classification_coverage") or {}
        sections.append(["Original regional watershed planning context", [
            *payload.get("watershed_scope_notes", []),
            "A complete South Carolina query with zero selected-class matches describes the named target "
            "classes in that source edition. Water-quality condition and impairment decisions use their "
            "assessment sources. Whole-HUC area is shown once; state portions retain each original edition.",
            _table(["HUC12 / watershed", "Whole-HUC acres", "NRCS edition", "Priority states",
                    "Original programme labels"], [
                [str(row.get("huc12", "")) + " / " + str(row.get("name", "")),
                 row.get("area_acres"), row.get("nrcs_edition"), row.get("priority_states"),
                 row.get("system_types")] for row in hucs
            ]),
            _table(["HUC12", "Selected classification matches", "Query coverage", "Original HUC assignment"], [
                [row.get("huc12"), row.get("selected_classification_count"),
                 row.get("classification_query_coverage"), row.get("classification_assignment")]
                for row in hucs
            ]),
            _table(["HUC12 / state", "NRCS edition", "Original state acres", "Original designation",
                    "Programme label / resource concern"], [
                [str(row.get("huc12", "")) + " / " + str(state.get("st_usps", "")),
                 row.get("nrcs_edition"), state.get("st_ac"), state.get("fy26_status"),
                 _text(state.get("system_type")) + "\n" + _text(state.get("resource_concern"))]
                for row in hucs for state in row.get("nrcs_state_rows", [])
            ]),
            _table(["Regional source", "Saved identity"], [
                ["Original report", regional.get("report_id")],
                ["Source fingerprint", regional.get("source_fingerprint")],
                ["Selected HUC12s", regional.get("selected_huc12s")],
                ["Queried target classes", coverage.get("selected_classes")],
                ["Classification jurisdiction", coverage.get("source_jurisdiction")],
            ]),
            _table(["Original regional report file", "Saved value"],
                   _metadata_rows(regional.get("report_file"), "Report file")),
        ]])
    physical = payload.get("physical_context", [])
    if physical:
        sections.append(["Original modeled physical context", [
            *payload.get("scientific_scope_notes", []),
            _table(["Original run", "Metric", "Reporting-area total", "Units", "Run valid cells"], [
                [row.get("run_id"), row.get("pollutant"), row.get("value"), row.get("unit"),
                 row.get("run_valid_cells")] for row in physical
            ]),
            _table(["Original alternative run", "Metric", "Alternative minus baseline", "Units",
                    "Comparison valid cells", "Comparison basis"], [
                [row.get("run_id"), row.get("pollutant"), row.get("alternative_minus_baseline"),
                 row.get("unit"), row.get("comparison_valid_cells"), row.get("comparison_spatial_basis")]
                for row in physical if row.get("comparison_id")
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
    revision = payload.get("plan_revision")
    if report.get("plan_revision") != revision:
        raise ValueError("The original Community revision register differs from its saved report")
    if revision:
        if (revision.get("schema") != "upstate.community-plan-revision/v1"
                or revision.get("plan_id") != report.get("plan_id")
                or revision.get("previous_plan_id") != payload["plan"].get("previous_plan_id")
                or revision.get("table_id") != report.get("table_id")):
            raise ValueError("The original Community revision register differs from its saved plan")
        if not {"plan-revision-summary.json", "plan-revision-changes.csv", "previous-plan.json"} <= paths.keys():
            raise ValueError("The original Community revision register is missing its retained companions")
        if read_json(paths["plan-revision-summary.json"]) != revision:
            raise ValueError("The original Community revision summary differs from its report")
        previous = read_json(paths["previous-plan.json"])
        if previous.get("id") != revision["previous_plan_id"]:
            raise ValueError("The original Community revision register names a different previous plan")
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
        vintage = "Retained Community report format " + str(report["format_version"]) + "; selection " + report["selection_id"]
        manifest = {"schema": "upstate.sources/v1", "title": title,
                    "scope": {"project_id": workspace.project["id"], "plan_id": report["plan_id"],
                              "community_report_id": report_id, "report_sha256": report_sha256},
                    "entries": [{
                        "id": source_id, "kind": "document", "title": title,
                        "role": "community-planning-report-context", "path": RECIPE,
                        "uri": "workspace://" + workspace.project["id"] + "/" + REPORT_KIND + "/" + report_id,
                        "vintage": vintage, "sha256": file_digest(directory / RECIPE),
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


def _archived_copy(original, target, expected):
    """Retain one verified ZIP member without replacing an earlier received byte."""
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.is_symlink():
        raise ValueError("Keep archived Community members as regular received files")
    if target.exists():
        verify_file(target.parent, {**expected, "path": target.name})
        return
    handle, temporary = tempfile.mkstemp(prefix=".write-community-member-", dir=target.parent)
    try:
        size, sha = 0, hashlib.sha256()
        with os.fdopen(handle, "wb") as output:
            while block := original.read(1024 * 1024):
                size += len(block)
                if size > expected["bytes"]:
                    raise ValueError("An archived Community member exceeds its retained length")
                sha.update(block)
                output.write(block)
            output.flush()
            os.fsync(output.fileno())
        if size != expected["bytes"] or sha.hexdigest() != expected["sha256"]:
            raise ValueError("An archived Community member differs from its retained bytes")
        try:
            os.link(temporary, target)
        except FileExistsError:
            verify_file(target.parent, {**expected, "path": target.name})
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def prepare_archive(workspace, archive_path, report_record, *, original_project_id,
                    report_sha256, delivery_id=None, import_source=True):
    """Receive an original report edition as source, retaining its donor identities.

    The destination is an actual Workspace. Original Community IDs remain source
    provenance; this entry point does not create editable table or plan records.
    """
    import stat
    import uuid
    import zipfile

    donor = str(uuid.UUID(original_project_id))
    if donor != original_project_id:
        raise ValueError("Use the exact original Community project UUID")
    report_sha256 = identifier(report_sha256)
    report_record = Path(report_record).absolute()
    record_bytes = report_record.read_bytes()
    report = json.loads(record_bytes)
    key = identifier(report.get("id"))
    if (report.get("schema") != "upstate.community-reports/v1"
            or digest({name: value for name, value in report.items() if name != "id"}) != key):
        raise ValueError("The original saved Community report record changed")
    selection_id = identifier(report.get("selection_id"))
    if digest({"schema": "upstate.community-report-selection/v1", "plan_id": report["plan_id"],
               "title": report["title"], "format_version": report["format_version"]}) != selection_id:
        raise ValueError("The saved Community report selection changed")
    files = report.get("files")
    required = {"REPORT.json", "community-report.json", "community-report.zip"}
    if not isinstance(files, dict) or not required <= files.keys():
        raise ValueError("Receive the complete original Community report inventory")
    prefix = "community-reports/" + selection_id + "/"
    for name, item in files.items():
        _relative(name)
        if (not isinstance(item, dict) or item.get("path") != prefix + name
                or type(item.get("bytes")) is not int or item["bytes"] < 0):
            raise ValueError("A Community report member belongs to another saved edition")
        identifier(item.get("sha256"))
    if files["community-report.json"]["sha256"] != report_sha256:
        raise ValueError("The selected original Community report JSON changed")
    if donor == workspace.project["id"] and workspace._get(REPORT_KIND, key) != report:
        raise ValueError("The same-project Community source must match its original saved record")
    archive_path = Path(archive_path).absolute()
    if archive_path.is_symlink():
        raise ValueError("Receive the original Community archive as a regular file")
    expected_archive = files["community-report.zip"]
    record_descriptor = {"path": report_record.name, "bytes": len(record_bytes),
                         "sha256": hashlib.sha256(record_bytes).hexdigest()}
    identity = {
        "schema": SCHEMA, "version": VERSION, "receiving": "original-report-archive-v1",
        "project_id": workspace.project["id"], "original_project_id": donor,
        "report_id": key, "report_sha256": report_sha256,
        "archive": {name: expected_archive[name] for name in ("bytes", "sha256")},
        "saved_record": {name: record_descriptor[name] for name in ("bytes", "sha256")},
        "producer_sha256": file_digest(Path(__file__)),
        "report_loader_edition": observed_context.EDITION,
    }
    operation_id = digest(identity)
    directory = workspace.root / "community-report-contexts" / operation_id
    lock = workspace.root / "locks" / ("community-report-context-" + operation_id + ".lock")

    def file_state(value):
        return (value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns, value.st_ctime_ns)

    with held(lock), archive_path.open("rb") as source:
        initial = os.fstat(source.fileno())
        if not stat.S_ISREG(initial.st_mode) or initial.st_size != expected_archive["bytes"]:
            raise ValueError("The original Community archive has a different size or file type")
        checksum = hashlib.sha256()
        for block in iter(lambda: source.read(1024 * 1024), b""):
            checksum.update(block)
        if checksum.hexdigest() != expected_archive["sha256"]:
            raise ValueError("The original complete Community report archive changed")
        source.seek(0)
        inputs = []
        with zipfile.ZipFile(source) as bundle:
            members = bundle.infolist()
            names = [item.filename for item in members]
            expected_names = set(files) - {"community-report.zip"}
            if len(names) != len(set(names)) or set(names) != expected_names:
                raise ValueError("The original Community ZIP member inventory differs")
            for member in members:
                _relative(member.filename)
                mode = (member.external_attr >> 16) & 0xFFFF
                if (member.is_dir() or member.flag_bits & 1 or stat.S_ISLNK(mode)
                        or stat.S_IFMT(mode) not in (0, stat.S_IFREG)
                        or member.file_size != files[member.filename]["bytes"]):
                    raise ValueError("Keep each original Community ZIP member as its declared regular file")
            # Every member is length/hash/CRC checked before its JSON is trusted.
            for name in sorted(expected_names):
                target = directory / "retained" / name
                if not target.parent.resolve().is_relative_to(directory.resolve()):
                    raise ValueError("Keep original Community members inside their receiving directory")
                with bundle.open(name) as original:
                    _archived_copy(original, target, files[name])
                inputs.append(describe_file(directory, target))
        retained = directory / "retained"
        index = read_json(retained / "REPORT.json")
        payload = read_json(retained / "community-report.json")
        plan, table = payload.get("plan", {}), payload.get("original_table", {})
        for kind, record, expected in (("community-plans", plan, report["plan_id"]),
                                       ("community-tables", table, report["table_id"])):
            if (record.get("id") != expected or record.get("schema") != "upstate." + kind + "/v1"
                    or digest({name: value for name, value in record.items() if name != "id"}) != expected):
                raise ValueError("The archived Community " + kind + " identity changed")
        if (index.get("schema") != "upstate.community-report-files/v1"
                or payload.get("schema") != "upstate.community-report/v1"
                or any(index.get(name) != report.get(name) for name in ("plan_id", "table_id", "title"))
                or payload.get("title") != report["title"] or plan.get("table_id") != table["id"]
                or report.get("source") != plan.get("source") or plan.get("source") != table.get("source")
                or plan.get("context", {}).get("snapshot_sha256") != report.get("context_snapshot_sha256")):
            raise ValueError("The archived report differs from its original plan, table or scientific context")
        indexed = index.get("files")
        if not isinstance(indexed, dict) or set(indexed) != set(files) - {"REPORT.json", "community-report.zip"}:
            raise ValueError("The archived Community report index is incomplete")
        for name, item in indexed.items():
            if any(item.get(field) != files[name].get(field) for field in ("path", "bytes", "sha256")):
                raise ValueError("The archived original report index changed: " + name)
        if report.get("plan_revision") != payload.get("plan_revision"):
            raise ValueError("The archived Community plan revision register changed")
        revision = payload.get("plan_revision")
        if revision:
            if (revision.get("schema") != "upstate.community-plan-revision/v1"
                    or revision.get("plan_id") != plan["id"]
                    or revision.get("previous_plan_id") != plan.get("previous_plan_id")
                    or revision.get("table_id") != table["id"]
                    or not {"plan-revision-summary.json", "plan-revision-changes.csv",
                            "previous-plan.json"} <= expected_names
                    or read_json(retained / "plan-revision-summary.json") != revision):
                raise ValueError("Receive the original complete Community revision register")
            previous = read_json(retained / "previous-plan.json")
            if (previous.get("id") != revision["previous_plan_id"]
                    or digest({name: value for name, value in previous.items() if name != "id"}) != previous["id"]):
                raise ValueError("The archived previous Community plan changed")
        # Keep the byte-exact saved record and original ZIP alongside all members.
        _copy(report_record, retained / "saved-report.json", record_descriptor)
        inputs.append(describe_file(directory, retained / "saved-report.json"))
        source.seek(0)
        _archived_copy(source, retained / "community-report.zip", expected_archive)
        inputs.append(describe_file(directory, retained / "community-report.zip"))
        if (file_state(os.fstat(source.fileno())) != file_state(initial)
                or file_state(archive_path.lstat()) != file_state(initial)):
            raise ValueError("The original Community archive changed during receiving")
        title = report["title"] + " — community planning context"
        recipe = {
            "schema": observed_context.SCHEMA, "title": title,
            "edition": "community-planning-archive-" + VERSION,
            "report_context_kind": "community_planning",
            "project_id": donor, "community_report_id": key, "plan_id": plan["id"],
            "report_sha256": report_sha256, "inputs": inputs,
            "sections": _sections(payload, key, report_sha256),
            "source_links": [item["path"] for item in inputs], "figures": [],
            "archive_receiving": identity,
        }
        atomic_json(directory / RECIPE, recipe, immutable=True)
        source_id = "community-planning-report-" + operation_id[:20]
        manifest = {
            "schema": "upstate.sources/v1", "title": title,
            "scope": {"original_project_id": donor, "plan_id": plan["id"],
                      "community_report_id": key, "report_sha256": report_sha256},
            "entries": [{
                "id": source_id, "kind": "document", "title": title,
                "role": "community-planning-report-context", "path": RECIPE,
                "uri": "workspace://" + donor + "/" + REPORT_KIND + "/" + key,
                "vintage": "Retained Community report format " + str(report["format_version"])
                           + "; selection " + selection_id,
                "sha256": file_digest(directory / RECIPE),
                "metadata": {"report_schema": observed_context.SCHEMA,
                             "report_context_kind": "community_planning",
                             "plan_id": plan["id"], "community_report_id": key},
                "companions": inputs,
            }],
        }
        atomic_json(directory / MANIFEST, manifest, immutable=True)
        result = {**identity, "id": operation_id, "title": title, "source_id": source_id,
                  "community_report_id": key, "plan_id": plan["id"],
                  "original_member_count": len(files),
                  "files": [describe_file(workspace.root, directory / name) for name in (MANIFEST, RECIPE)]
                           + [describe_file(workspace.root, retained / "community-report.zip")]}
        if import_source:
            collection = workspace.import_sources(directory / MANIFEST)
            choice = {"source_collection_id": collection["id"], "source_id": source_id}
            result.update(source=choice, observed_context_binding=observed_context.bind(
                workspace, {"observed_context_sources": [choice]}))
            atomic_json(directory / "registered-context.json", result, immutable=True)
            result["delivery_selection"] = delivery_selection(workspace, choice, delivery_id)
            result["selected_delivery_id"] = delivery_id
        return result


def main(argv=None):
    from .workspace import Workspace
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    selected = parser.add_mutually_exclusive_group(required=True)
    selected.add_argument("--report-id")
    selected.add_argument("--report-archive")
    parser.add_argument("--report-record")
    parser.add_argument("--original-project-id")
    parser.add_argument("--report-sha256", required=True)
    parser.add_argument("--delivery-id")
    parser.add_argument("--prepare-only", action="store_true")
    args = parser.parse_args(argv)
    if args.prepare_only and args.delivery_id:
        parser.error("--delivery-id requires source import")
    if args.report_archive:
        if not args.report_record or not args.original_project_id:
            parser.error("--report-archive requires --report-record and --original-project-id")
        result = prepare_archive(
            Workspace(args.workspace), args.report_archive, args.report_record,
            original_project_id=args.original_project_id, report_sha256=args.report_sha256,
            delivery_id=args.delivery_id, import_source=not args.prepare_only)
    else:
        if args.report_record or args.original_project_id:
            parser.error("--report-record and --original-project-id require --report-archive")
        result = prepare(Workspace(args.workspace), args.report_id,
                         report_sha256=args.report_sha256, delivery_id=args.delivery_id,
                         import_source=not args.prepare_only)
    print(json.dumps(result, indent=2, ensure_ascii=False, allow_nan=False))


if __name__ == "__main__":
    main()
