"""Retain a selected Implementation outcome as an original observed report.

The adapter reads an existing verified report edition. It does not recompute
measurements or model results. Delivery composition uses the existing ordered
OBSERVED_CONTEXT source contract and retains prior selected reports separately.
"""
from __future__ import annotations

import argparse
from copy import deepcopy
import json
from pathlib import Path
import shutil

from . import implementation_outcomes, observed_context
from .implementation_observations import _attachment_inventory
from .common import atomic_json, describe_file, digest, file_digest, held, read_json, verify_file
from .implementation_schema import ImplementationError
from .workspace import Workspace

SCHEMA = "upstate.implementation-outcome-context/v1"
EDITION = "implementation-outcome-observed-context-20261013-v1"
RECIPE_NAME = "observed-report.json"
MANIFEST_NAME = "model-sources.json"
RECEIPT_NAME = "source-receipt.json"


def _workspace(value):
    return value if hasattr(value, "import_sources") and hasattr(value, "root") else Workspace(value)


def _text(value):
    if value is None:
        return "Unavailable"
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False, sort_keys=True, allow_nan=False)
    return str(value)


def _interval(value):
    return implementation_outcomes._interval_text(value)


def _table(columns, rows, caption=None):
    block = {"kind": "table", "columns": list(columns),
             "rows": [[_text(value) for value in row] for row in rows]}
    if caption:
        block["caption"] = caption
    return block


def _group_name(effect):
    if effect.get("label"):
        return _text(effect["label"])
    parts = [effect.get(key) for key in ("parameter", "unit", "basis", "fraction", "method")]
    return " · ".join(_text(value) for value in parts if value)


def report_sections(result):
    """Readable original quantities for the existing observed/scientific recipe."""
    selected, binding = result["selection"], result["plan_binding"]
    event = selected.get("event")
    selection_rows = [
        ["Saved plan", binding["title"] + " · revision " + str(binding["revision"])],
        ["Original plan digest", binding["document_digest"]],
        ["Outcome edition", result["id"]],
        ["Analysis selection digest", result["selection_digest"]],
        ["Before period (inclusive)", selected["before"]["start"] + " through " + selected["before"]["end"]],
        ["After period (inclusive)", selected["after"]["start"] + " through " + selected["after"]["end"]],
        ["Study / impact sites", ", ".join(selected["impact_site_ids"])],
        ["Reference / control sites", ", ".join(selected["control_site_ids"]) or "None selected"],
        ["Calendar time zone", selected["time_zone"]],
        ["Selected calendar months", ", ".join(map(str, selected["calendar_months"]))],
        ["QA labels", "All original labels" if selected["qa_statuses"] is None else _text(selected["qa_statuses"])],
        ["Explicit physical lower bound", selected["lower_bound"] if selected["lower_bound"] is not None else "Unbounded"],
    ]
    if event:
        selection_rows += [["Entered event", event["date"] + " · " + event["label"]],
                           ["Event source references", event.get("source_link_ids", [])],
                           ["Event notes", event.get("notes", "")]]
    sections = [[selected["title"] + " — original measured-period comparison", [
        "This evaluation retains its selected saved plan, original result records and explicit calendar periods. "
        "Study and reference sites are the operator's selected comparison roles.",
        _table(["Selection", "Original value"], selection_rows),
        *result["interpretation"],
    ]]]
    summary_rows = [[key.replace("_", " "), value] for key, value in result["summary"].items()
                    if not isinstance(value, (dict, list))]
    sections.append(["Original observation support", [
        _table(["Support", "Count"], summary_rows),
        "Counts of site–group–date summaries remain separate from distinct site–date combinations "
        "and distinct matched calendar dates. Original result IDs and all excluded or unresolved records "
        "are retained in the linked outcome files.",
    ]])
    for effect in result["effects"]:
        heading = effect.get("site_label") or effect["site_id"]
        blocks = [_group_name(effect),
                  "Original measurement support: " + _text(effect.get("support", {}))]
        choices = [("Original study-site measurements", effect["direct"])]
        if effect.get("controls") is not None:
            choices.append(("Same-date study site minus fixed selected references",
                            effect["controls"]["paired"]))
        for label, comparison in choices:
            blocks.append(label + ". Changes are after minus before in the original unit.")
            phase_rows, subset_rows = [], []
            for phase in ("before", "after"):
                support = comparison[phase]
                phase_rows.append([
                    phase.title(), _interval(support["interval"]), support["days"],
                    support["records"], support["unresolved_records"],
                ])
                subset_rows += [
                    [phase.title(), "Complete sampled dates", _interval(support["supported_dates_interval"]),
                     support["supported_days"]],
                    [phase.title(), "Quantified-only sampled dates", _interval(support["quantified_subset_interval"]),
                     support["quantified_subset_days"]],
                ]
            blocks.append(_table(["Period", "Full mean bound", "Dates", "Results", "Unresolved results"], phase_rows))
            blocks.append(_table(["Period", "Explicit subset", "Mean bound", "Dates"], subset_rows))
            balance = comparison["month_balanced"]
            blocks.append(_table(["Comparison", "Change bound", "Date or month support"], [
                ["After minus before", _interval(comparison["change"]), "All selected dates in this comparison"],
                ["Supported dates: after minus before", _interval(comparison["supported_date_change"]),
                 "Complete sampled dates only"],
                ["Common-month balanced change", _interval(balance["change"]), balance["months"]],
                ["Supported dates: common-month change", _interval(balance["supported_date_change"]),
                 balance["months"]],
                ["Months omitted from balancing", "Unavailable", balance["omitted_months"]],
            ]))
            monthly = comparison.get("monthly", [])
            if monthly:
                blocks.append(_table(["Month", "Before mean", "After mean", "Change", "Dates before / after"], [
                    [row["month"], _interval(row["before"]["interval"]),
                     _interval(row["after"]["interval"]), _interval(row["change"]),
                     str(row["before"]["days"]) + " / " + str(row["after"]["days"])]
                    for row in monthly
                ]))
        if effect.get("controls") is not None:
            controls = effect["controls"]
            blocks.append("Fixed reference sites: " + ", ".join(controls["site_ids"]) + ". " + controls["pairing"] + ".")
            if controls["unpaired_impact_dates"]:
                blocks.append(_table(["Date", "Period", "Study result incomplete", "Missing or incomplete references"], [
                    [row["date"], row["period"], "Yes" if row["impact_incomplete"] else "No",
                     ", ".join(row["missing_or_incomplete_control_site_ids"])]
                    for row in controls["unpaired_impact_dates"]
                ]))
        sections.append([heading + " — " + effect["parameter"], blocks])
    if result.get("event_sources"):
        sections.append(["Original intervention evidence selected by the operator", [
            _table(["Source", "Reference"], [
                [row.get("label", row.get("id", "")), row.get("reference", "")]
                for row in result["event_sources"]
            ]),
            "The complete original source-link records are retained in outcomes.json and plan.json.",
        ]])
    sections.append(["Reopen the original outcome and its source records", [
        {"kind": "links", "items": [
            {"title": "Complete saved outcome report", "path": "outcome/report.html"},
            {"title": "Full calculation, selection and original record decisions", "path": "outcome/outcomes.json"},
            {"title": "Original observation selection CSV", "path": "outcome/outcome_rows.csv"},
            {"title": "Period and monthly comparisons CSV", "path": "outcome/period_summary.csv"},
            {"title": "Sampled-date support CSV", "path": "outcome/sampled_dates.csv"},
            {"title": "Exact-date reference matches CSV", "path": "outcome/matched_controls.csv"},
            {"title": "Original saved Implementation plan", "path": "outcome/plan.json"},
            {"title": "Original Implementation report", "path": "outcome/implementation-plan.html"},
            {"title": "Original outcome file inventory", "path": "outcome/manifest.json"},
        ]},
        *[reference["title"] + ": " + reference["url"] for reference in result.get("references", [])],
    ]])
    return sections


def _selection(workspace, value):
    if value is None:
        selected = {"source_roles": {}}
    elif isinstance(value, dict):
        selected = deepcopy(value)
    else:
        raise ImplementationError("Supply the existing delivery selection as an object.")
    roles = selected.get("source_roles", {})
    if not isinstance(roles, dict):
        raise ImplementationError("Existing delivery source roles must be an object.")
    selected["source_roles"] = roles
    choices = observed_context.source_choices(selected)
    binding = observed_context.bind(workspace, selected)
    declared = selected.get("observed_context_binding")
    if declared is not None and declared != binding:
        raise ImplementationError("The existing observed-source binding changed; reopen its current original selection.")
    return selected, choices, binding


def _context(workspace, plan_id, outcome_id, existing_report_selection):
    result = implementation_outcomes.get(workspace, plan_id, outcome_id)
    root = Path(workspace.root).resolve()
    members = []
    names = set()
    for item in result["files"]:
        name = item.get("name")
        if (not isinstance(name, str) or Path(name).name != name or name in (".", "..")
                or "/" in name or "\\" in name or name in names):
            raise ImplementationError("Original outcome files require unique retained member names.")
        names.add(name)
        path = verify_file(root, item)
        if not path.resolve().is_relative_to(root):
            raise ImplementationError("The original outcome must remain inside its Workspace.")
        members.append({"name": name, "bytes": item["bytes"], "sha256": item["sha256"],
                        "source_path": item["path"], "path": path})
    required = {"plan.json", "manifest.json", "report.html", "implementation-plan.html",
                "outcomes.json", "outcome_rows.csv", "period_summary.csv",
                "sampled_dates.csv", "matched_controls.csv"}
    if not required.issubset(names):
        raise ImplementationError("The selected outcome lacks its complete source and report members.")
    plan_member = next(member for member in members if member["name"] == "plan.json")
    original_plan = read_json(plan_member["path"])
    attachments, attachment_files = _attachment_inventory(workspace, original_plan)
    identity = {
        "schema": SCHEMA, "edition": EDITION, "project_id": workspace.project["id"],
        "outcome_id": result["id"], "plan_binding": result["plan_binding"],
        "selection_digest": result["selection_digest"], "method": result["method"],
        "original_local_attachments": attachments,
        "members": [{key: row[key] for key in ("name", "bytes", "sha256")}
                    for row in sorted(members, key=lambda row: row["name"])],
    }
    selected, choices, previous_binding = _selection(workspace, existing_report_selection)
    source_key = digest(identity)
    supplied = existing_report_selection is not None
    handoff_identity = {"schema": SCHEMA + "/handoff", "source_identity": identity,
                        "observed_context_edition": observed_context.EDITION,
                        "original_delivery_selection": selected if supplied else None,
                        "original_observed_context_binding": previous_binding}
    return {"result": result, "members": members, "attachments": attachments,
            "attachment_files": attachment_files, "source_identity": identity,
            "source_key": source_key, "operation_id": digest(handoff_identity),
            "handoff_identity": handoff_identity, "selection": selected,
            "choices": choices, "previous_binding": previous_binding,
            "selection_supplied": supplied}


def preview_outcome_context(workspace, plan_id, outcome_id, *, existing_report_selection=None):
    workspace = _workspace(workspace)
    context = _context(workspace, plan_id, outcome_id, existing_report_selection)
    result = context["result"]
    return {"schema": SCHEMA, "operation_id": context["operation_id"],
            "source_identity": context["source_identity"],
            "plan_binding": result["plan_binding"], "outcome_id": result["id"],
            "title": result["selection"]["title"],
            "selection": deepcopy(result["selection"]), "summary": deepcopy(result["summary"]),
            "existing_observed_sources": deepcopy(context["choices"]),
            "original_observed_context_binding": deepcopy(context["previous_binding"]),
            "original_delivery_selection_digest": digest(context["selection"] if context["selection_supplied"] else None),
            "delivery_selection_supplied": context["selection_supplied"],
            "source_member_count": len(context["members"]) + len({row["retained_path"] for _, row in context["attachment_files"]}) + 3,
            "original_outcome_member_count": len(context["members"]),
            "attachment_count": len({row["retained_path"] for _, row in context["attachment_files"]}),
            "attachment_inventory": deepcopy(context["attachments"]),
            "state": "preview"}


def _retain(source, destination, expected):
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists() or destination.is_symlink():
        if (destination.is_symlink() or not destination.is_file()
                or destination.stat().st_size != expected["bytes"]
                or file_digest(destination) != expected["sha256"]):
            raise ImplementationError("Retained outcome member differs: " + destination.name)
        return
    pending = destination.with_name("." + destination.name + ".pending")
    try:
        shutil.copyfile(source, pending)
        if pending.stat().st_size != expected["bytes"] or file_digest(pending) != expected["sha256"]:
            raise ImplementationError("Original outcome member changed while retaining it.")
        pending.replace(destination)
    finally:
        if pending.exists():
            pending.unlink()


def _source(workspace, context, root):
    receipt_path = root / RECEIPT_NAME
    if receipt_path.is_file():
        receipt = read_json(receipt_path)
        if receipt.get("schema") != SCHEMA or receipt.get("source_identity") != context["source_identity"]:
            raise ImplementationError("The retained outcome source belongs to another original edition.")
        for item in receipt["files"]:
            verify_file(Path(workspace.root), item)
        choice = {key: receipt[key] for key in ("source_collection_id", "source_id")}
        actual = observed_context.bind(workspace, {"source_roles": {observed_context.ROLE: choice}})
        original = receipt["binding"]
        for key in ("source_collection_id", "source_id", "body_sha256", "member_sha256"):
            if actual.get(key) != original.get(key):
                raise ImplementationError("The imported outcome source identity changed.")
        return {**receipt, "binding": actual, "reused": True}
    names = []
    for member in context["members"]:
        name = "outcome/" + member["name"]
        _retain(member["path"], root / name, member)
        names.append(name)
    attachment_names = set()
    for path, item in context["attachment_files"]:
        name = "original/" + item["retained_path"]
        _retain(path, root / name, item)
        attachment_names.add(name)
    names.extend(sorted(attachment_names))
    atomic_json(root / "original" / "attachment-inventory.json", context["attachments"], immutable=True)
    names.append("original/attachment-inventory.json")
    atomic_json(root / "context-identity.json", context["source_identity"], immutable=True)
    names.append("context-identity.json")
    companions = [describe_file(root, root / name) for name in sorted(names)]
    result = context["result"]
    sections = report_sections(result)
    attachment_blocks = [
        _table(["Original local source", "Original reference", "Retained state"], [
            [row["label"], row["reference"], row["state"]] for row in context["attachments"]
        ]),
        {"kind": "links", "items": [
            {"title": "Original local attachment inventory", "path": "original/attachment-inventory.json"},
            *[{"title": row["label"], "path": "original/" + row["retained_path"]}
              for _, row in context["attachment_files"]],
        ]},
    ]
    sections.append(["Original local source files", attachment_blocks])
    recipe = {
        "schema": observed_context.SCHEMA, "edition": EDITION,
        "title": result["selection"]["title"] + " — retained Implementation outcome",
        "sections": sections, "inputs": companions,
        "source_links": ["outcome/report.html", "outcome/outcomes.json", "outcome/plan.json",
                         "outcome/manifest.json", "context-identity.json",
                         "original/attachment-inventory.json"],
        "implementation_outcome_identity": context["source_identity"],
        "implementation_outcome_selection": result["selection"],
    }
    atomic_json(root / RECIPE_NAME, recipe, immutable=True)
    entry = {
        "id": "implementation-outcome-" + context["source_key"],
        "kind": "document", "role": observed_context.ROLE, "title": recipe["title"],
        "uri": "urn:upstate:implementation-outcome:" + workspace.project["id"] + ":" + result["id"],
        "vintage": "Saved plan revision " + str(result["plan_binding"]["revision"]),
        "units": "original recorded measurement units and result bounds",
        **describe_file(root, root / RECIPE_NAME),
        "companions": companions,
        "metadata": {"report_schema": observed_context.SCHEMA,
                     "implementation_outcome": context["source_identity"]},
    }
    manifest = {"schema": "upstate.sources/v1", "title": recipe["title"], "entries": [entry]}
    atomic_json(root / MANIFEST_NAME, manifest, immutable=True)
    imported = workspace.import_sources(root / MANIFEST_NAME)
    choice = {"source_collection_id": imported["id"], "source_id": entry["id"]}
    binding = observed_context.bind(workspace, {"source_roles": {observed_context.ROLE: choice}})
    receipt = {
        "schema": SCHEMA, "source_identity": context["source_identity"],
        **choice, "source_role": observed_context.ROLE, "binding": binding,
        "directory": root.relative_to(workspace.root).as_posix(),
        "files": [describe_file(Path(workspace.root), root / name)
                  for name in sorted(names + [RECIPE_NAME, MANIFEST_NAME])],
    }
    atomic_json(receipt_path, receipt, immutable=True)
    return {**receipt, "reused": False}


def import_outcome_context(workspace, plan_id, outcome_id, *, existing_report_selection=None,
                           expected_operation_id=None):
    """Import one retained outcome and append it to the ordered original reports."""
    workspace = _workspace(workspace)
    context = _context(workspace, plan_id, outcome_id, existing_report_selection)
    if expected_operation_id is not None and expected_operation_id != context["operation_id"]:
        raise ImplementationError("The original outcome or delivery selection changed; preview it again.")
    root = Path(workspace.root) / "implementation" / "outcome-context" / context["source_key"]
    if root.is_symlink():
        raise ImplementationError("The retained outcome source directory is a symlink.")
    root.mkdir(parents=True, exist_ok=True)
    with held(root / "source.lock"):
        source = _source(workspace, context, root)
        selected = deepcopy(context["selection"])
        choices = deepcopy(context["choices"])
        choice = {key: source[key] for key in ("source_collection_id", "source_id")}
        if choice not in choices:
            choices.append(choice)
        selected["observed_context_sources"] = choices
        selected["source_roles"][observed_context.ROLE] = deepcopy(choices[0])
        selected["observed_context_binding"] = observed_context.bind(workspace, selected)
        selection_path = None
        if context["selection_supplied"]:
            selection_path = root / "handoffs" / context["operation_id"] / "delivery-selection.json"
            atomic_json(selection_path, selected, immutable=True)
        handoff = root / "handoffs" / context["operation_id"] / "handoff.json"
        value = {
            "schema": SCHEMA, "operation_id": context["operation_id"],
            "identity": context["handoff_identity"], "plan_binding": context["result"]["plan_binding"],
            "outcome_id": context["result"]["id"], **choice,
            "source_role": observed_context.ROLE,
            "source_binding": source["binding"],
            "binding": selected["observed_context_binding"],
            "original_observed_context_binding": context["previous_binding"],
            "delivery_selection": selected if context["selection_supplied"] else None,
            "delivery_selection_path": (selection_path.relative_to(workspace.root).as_posix()
                                        if selection_path is not None else None),
            "directory": root.relative_to(workspace.root).as_posix(),
            "source_reused": source["reused"],
        }
        if handoff.exists():
            previous = read_json(handoff)
            comparable = {key: item for key, item in value.items() if key != "source_reused"}
            if {key: item for key, item in previous.items() if key != "source_reused"} != comparable:
                raise ImplementationError("The original outcome handoff changed.")
            reused = True
        else:
            atomic_json(handoff, value, immutable=True)
            reused = False
        files = source["files"] + [
            describe_file(Path(workspace.root), root / RECEIPT_NAME),
            describe_file(Path(workspace.root), handoff),
        ]
        if selection_path is not None:
            files.append(describe_file(Path(workspace.root), selection_path))
        return {**value, "files": files, "reused": reused}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--plan-id", required=True)
    parser.add_argument("--outcome-id", required=True)
    parser.add_argument("--delivery-selection", type=Path)
    parser.add_argument("--expected-operation-id")
    parser.add_argument("--preview", action="store_true")
    args = parser.parse_args(argv)
    selection = read_json(args.delivery_selection) if args.delivery_selection else None
    if args.preview:
        result = preview_outcome_context(args.workspace, args.plan_id, args.outcome_id,
                                         existing_report_selection=selection)
    else:
        result = import_outcome_context(args.workspace, args.plan_id, args.outcome_id,
                                        existing_report_selection=selection,
                                        expected_operation_id=args.expected_operation_id)
    print(json.dumps(result, ensure_ascii=False, sort_keys=True, allow_nan=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
