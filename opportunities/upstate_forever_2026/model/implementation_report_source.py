"""Publish an original saved Implementation plan report into the ordered report composer."""
from __future__ import annotations

import argparse
from copy import deepcopy
import json
import re
import os
import tempfile
from pathlib import Path
import shutil

from . import observed_context
from .implementation import ImplementationStore
from .implementation_schema import _safe_id
from .portable_implementation import report_edition
from .implementation_observations import _attachment_inventory
from .common import atomic_json, describe_file, digest, file_digest, held, read_json, verify_file
from .implementation_schema import ImplementationError
from .workspace import Workspace

SCHEMA = "upstate.implementation-plan-report-context/v1"
EDITION = "implementation-plan-report-observed-context-20261013-v1"
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


def _table(columns, rows, caption=None):
    block = {"kind": "table", "columns": list(columns),
             "rows": [[_text(value) for value in row] for row in rows]}
    if caption:
        block["caption"] = caption
    return block


def report_sections(result):
    """Present the saved operational records without inferring field results."""
    plan, summary = result["plan"], result["summary"]
    binding = result["plan_binding"]
    sections = [[plan["title"] + " — implementation and fieldwork", [
        plan.get("description") or "Saved implementation and fieldwork plan.",
        _table(["Original selection", "Value"], [
            ["Plan ID", plan["id"]], ["Saved revision", plan["revision"]],
            ["Native report date", result["as_of"]],
            ["Start date", plan["start_date"]], ["Target date", plan.get("target_date")],
            ["Original plan digest", binding["document_digest"]],
            ["Original report edition", result["id"]],
        ]),
        "Task progress, planned dates, actual field timestamps and the cost ledger are the recorded "
        "values of this saved revision. They do not infer completed work or measured environmental effects.",
    ]]]
    sections.append(["Work plan", [
        _table(["Task ID", "Work", "Phase", "Owner", "Status", "Progress %", "Duration (working days)",
                "Not before", "Dependencies", "Evidence", "Notes"], [
            [row["id"], row["title"], row["phase"], row["assignee"], row["status"],
             row["progress_pct"], row["duration_days"], row.get("start_not_before"),
             row["depends_on"], row["evidence_refs"], row["notes"]] for row in plan["tasks"]
        ]),
        "The linked original report and tasks CSV retain the native calendar calculation, dependencies "
        "and unscheduled work. A missing duration remains unavailable.",
    ]])
    sections.append(["Recorded budget, commitments and actual costs", [
        "Currency: " + plan["currency"] + ". Original amount_minor values are integer cents. "
        "Budget, commitment and actual entries remain separate ledger kinds.",
        _table(["Entry ID", "Task ID", "Kind", "Label", "Original amount (cents)", "Date", "Reference"], [
            [row["id"], row.get("task_id"), row["kind"], row["label"], row["amount_minor"],
             row.get("date"), row.get("reference")] for row in plan["budget_lines"]
        ]),
    ]])
    sections.append(["Sites and monitoring design", [
        _table(["Site ID", "Site", "Latitude", "Longitude", "Candidate ID", "Original source"], [
            [row["id"], row["label"], row.get("latitude"), row.get("longitude"),
             row.get("candidate_id"), row.get("source_ref")] for row in plan["sites"]
        ]),
        _table(["Monitoring plan ID", "Title", "Objective", "Site IDs", "Parameters",
                "Frequency", "Method reference", "Notes"], [
            [row["id"], row["title"], row["objective"], row["site_ids"], row["parameters"],
             row.get("frequency"), row.get("method_ref"), row["notes"]]
            for row in plan["monitoring_plans"]
        ]),
    ]])
    sections.append(["Recorded visits and field activities", [
        _table(["Visit ID", "Site ID", "Planned date", "Status", "Actual timestamp",
                "Observer", "Evidence", "Notes"], [
            [row["id"], row["site_id"], row.get("planned_date"), row["status"], row.get("visited_at"),
             row["observer"], row["evidence_refs"], row["notes"]] for row in plan["visits"]
        ]),
        _table(["Activity ID", "Visit ID", "Site ID", "Kind", "Sample ID", "Collected at",
                "Method", "Custody reference", "Evidence", "Notes"], [
            [row["id"], row["visit_id"], row["site_id"], row["kind"], row.get("sample_id"),
             row.get("collected_at"), row.get("method"), row.get("custody_ref"),
             row.get("evidence_refs", []), row["notes"]] for row in plan["activities"]
        ]),
    ]])
    sections.append(["Original results and intervention sources", [
        str(len(plan["observations"])) + " original result records are retained in plan.json and observations.csv. "
        "Their original units, detection bounds, flags, source and activity references are unchanged.",
        _table(["Candidate ID", "Candidate", "Original area (ha)", "Source", "Retained modeled quantities"], [
            [row["id"], row["label"], row.get("area_ha"), row["source"], row["modeled_benefits"]]
            for row in plan["candidates"]
        ]),
        _table(["Source ID", "Label", "Kind", "Original reference"], [
            [row["id"], row["label"], row["kind"], row.get("reference")] for row in plan["source_links"]
        ]),
    ]])
    sections.append(["Reopen the complete original plan report", [
        {"kind": "links", "items": [
            {"title": name, "path": "report/" + name} for name in result["members"]
        ]},
        "The complete saved plan, native summary and original CSV files preserve additional fields. "
        "This source can be combined with other retained scientific reports in their selected order.",
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


def _context(workspace, plan_id, report_id, existing_report_selection):
    plan_id = _safe_id(plan_id, "plan_id")
    if not isinstance(report_id, str) or not re.fullmatch(r"[0-9a-f]{64}", report_id):
        raise ImplementationError("Choose the original saved native report edition.")
    store = ImplementationStore(workspace)
    root = Path(workspace.root).resolve()
    directory = store.base / plan_id / "reports" / report_id
    if not directory.resolve().is_relative_to(root):
        raise ImplementationError("The original report must remain in its Workspace.")
    edition = report_edition(store, directory)
    if edition["id"] != report_id or edition["plan_id"] != plan_id:
        raise ImplementationError("The original report names another saved plan edition.")
    original_plan = read_json(directory / "plan.json")
    summary = read_json(directory / "summary.json")
    members = []
    for name in edition["members"]:
        path = directory / name
        item = describe_file(root, path)
        members.append({"name": name, "bytes": item["bytes"], "sha256": item["sha256"],
                        "source_path": item["path"], "path": path})
    attachments, attachment_files = _attachment_inventory(workspace, original_plan)
    binding = {"plan_id": plan_id, "title": original_plan["title"],
               "revision": edition["revision"], "document_digest": edition["document_digest"]}
    result = {**edition, "plan": original_plan, "summary": summary, "plan_binding": binding}
    identity = {
        "schema": SCHEMA, "edition": EDITION, "project_id": workspace.project["id"],
        "report_id": report_id, "plan_binding": binding, "as_of": edition["as_of"],
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


def preview_report_source(workspace, plan_id, report_id, *, existing_report_selection=None):
    workspace = _workspace(workspace)
    context = _context(workspace, plan_id, report_id, existing_report_selection)
    result = context["result"]
    return {"schema": SCHEMA, "operation_id": context["operation_id"],
            "source_identity": context["source_identity"],
            "plan_binding": result["plan_binding"], "report_id": result["id"],
            "title": result["plan"]["title"], "as_of": result["as_of"],
            "counts": {key: len(result["plan"][key]) for key in
                       ("tasks", "budget_lines", "sites", "monitoring_plans", "visits", "activities", "observations")},
            "existing_observed_sources": deepcopy(context["choices"]),
            "original_observed_context_binding": deepcopy(context["previous_binding"]),
            "original_delivery_selection_digest": digest(context["selection"] if context["selection_supplied"] else None),
            "delivery_selection_supplied": context["selection_supplied"],
            "source_member_count": len(context["members"]) + len({row["retained_path"] for _, row in context["attachment_files"]}) + 2,
            "original_report_member_count": len(context["members"]),
            "attachment_count": len({row["retained_path"] for _, row in context["attachment_files"]}),
            "attachment_inventory": deepcopy(context["attachments"]), "state": "preview"}


def _retain(source, destination, expected):
    """Stream one verified original body into an independently retained file."""
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists() or destination.is_symlink():
        if (destination.is_symlink() or not destination.is_file()
                or destination.stat().st_size != expected["bytes"]
                or file_digest(destination) != expected["sha256"]):
            raise ImplementationError("Retained plan report member differs: " + destination.name)
        return
    pending = None
    try:
        with Path(source).open("rb") as incoming, tempfile.NamedTemporaryFile(
                dir=destination.parent, prefix=".report-source-", delete=False) as outgoing:
            pending = Path(outgoing.name)
            shutil.copyfileobj(incoming, outgoing, 1024 * 1024)
            outgoing.flush()
            os.fsync(outgoing.fileno())
        if pending.stat().st_size != expected["bytes"] or file_digest(pending) != expected["sha256"]:
            raise ImplementationError("Original plan report member changed while retaining it.")
        os.replace(pending, destination)
    finally:
        if pending is not None:
            pending.unlink(missing_ok=True)


def _source(workspace, context, root):
    receipt_path = root / RECEIPT_NAME
    if receipt_path.is_file():
        receipt = read_json(receipt_path)
        if receipt.get("schema") != SCHEMA or receipt.get("source_identity") != context["source_identity"]:
            raise ImplementationError("The retained plan report source belongs to another original edition.")
        for item in receipt["files"]:
            verify_file(Path(workspace.root), item)
        choice = {key: receipt[key] for key in ("source_collection_id", "source_id")}
        actual = observed_context.bind(workspace, {"source_roles": {observed_context.ROLE: choice}})
        original = receipt["binding"]
        for key in ("source_collection_id", "source_id", "body_sha256", "member_sha256"):
            if actual.get(key) != original.get(key):
                raise ImplementationError("The imported plan report source identity changed.")
        return {**receipt, "binding": actual, "reused": True}
    names = []
    for member in context["members"]:
        name = "report/" + member["name"]
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
        "title": result["plan"]["title"] + " — Implementation revision " + str(result["revision"]),
        "sections": sections, "inputs": companions,
        "source_links": ["report/" + name for name in result["members"]],
        "report_context_kind": "implementation-plan-report",
        "implementation_plan_identity": context["source_identity"],
    }
    atomic_json(root / RECIPE_NAME, recipe, immutable=True)
    entry = {
        "id": "implementation-plan-report-" + context["source_key"],
        "kind": "document", "role": observed_context.ROLE, "title": recipe["title"],
        "uri": "urn:upstate:implementation-plan-report:" + workspace.project["id"] + ":" + result["id"],
        "vintage": "Saved plan revision " + str(result["plan_binding"]["revision"]),
        "units": "original recorded units; monetary ledger in USD cents; dates and field timestamps",
        **describe_file(root, root / RECIPE_NAME),
        "companions": companions,
        "metadata": {"report_schema": observed_context.SCHEMA,
                     "implementation_plan": context["source_identity"],
                     "report_context_kind": "implementation-plan-report"},
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


def import_report_source(workspace, plan_id, report_id, *, existing_report_selection=None,
                           expected_operation_id=None):
    """Import one retained plan report and append it to the ordered original reports."""
    workspace = _workspace(workspace)
    context = _context(workspace, plan_id, report_id, existing_report_selection)
    if expected_operation_id is not None and expected_operation_id != context["operation_id"]:
        raise ImplementationError("The original plan report or delivery selection changed; preview it again.")
    root = Path(workspace.root) / "implementation" / "report-context" / context["source_key"]
    if root.is_symlink():
        raise ImplementationError("The retained plan report source directory is a symlink.")
    root.mkdir(parents=True, exist_ok=True)
    with held(workspace.root / ".workspace.lock"), held(root / "source.lock"):
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
            "report_id": context["result"]["id"], "plan_id": plan_id,
            "revision": context["result"]["revision"], "as_of": context["result"]["as_of"],
            "state": "imported", **choice,
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
                raise ImplementationError("The original plan report handoff changed.")
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
        return {**value, "source_key": context["source_key"], "files": files, "reused": reused}


def get_report_source(workspace, source_key, operation_id):
    """Reopen an exact imported source after task, browser or Workspace restart."""
    workspace = _workspace(workspace)
    for key in (source_key, operation_id):
        if not isinstance(key, str) or not re.fullmatch(r"[0-9a-f]{64}", key):
            raise ImplementationError("Choose the retained report source and handoff identities.")
    root = workspace.root / "implementation" / "report-context" / source_key
    if root.is_symlink() or not root.resolve().is_relative_to(workspace.root.resolve()):
        raise ImplementationError("The retained report source directory changed.")
    receipt = read_json(root / RECEIPT_NAME)
    handoff_path = root / "handoffs" / operation_id / "handoff.json"
    result = read_json(handoff_path)
    identity = receipt.get("source_identity")
    if (receipt.get("schema") != SCHEMA or digest(identity) != source_key
            or result.get("schema") != SCHEMA or digest(result.get("identity")) != operation_id
            or result.get("operation_id") != operation_id
            or result["identity"].get("source_identity") != identity
            or identity.get("project_id") != workspace.project["id"]):
        raise ImplementationError("The report source differs from its original operation.")
    store = ImplementationStore(workspace)
    edition = report_edition(store, store.base / _safe_id(result["plan_id"]) / "reports" / result["report_id"])
    binding = result["plan_binding"]
    if (edition["id"] != identity["report_id"] or edition["revision"] != binding["revision"]
            or edition["document_digest"] != binding["document_digest"]
            or edition["as_of"] != identity["as_of"]):
        raise ImplementationError("The report source differs from its saved native report.")
    files = list(receipt["files"])
    for item in files:
        path = verify_file(workspace.root, item)
        if not path.resolve().is_relative_to(root.resolve()):
            raise ImplementationError("A retained report source member leaves its original operation.")
    choice = {key: receipt[key] for key in ("source_collection_id", "source_id")}
    if any(result.get(key) != value for key, value in choice.items()):
        raise ImplementationError("The source handoff names another imported edition.")
    actual = observed_context.bind(workspace, {"source_roles": {observed_context.ROLE: choice}})
    for key in ("source_collection_id", "source_id", "body_sha256", "member_sha256"):
        if actual.get(key) != receipt["binding"].get(key):
            raise ImplementationError("The retained report source bytes changed.")
    files += [describe_file(workspace.root, root / RECEIPT_NAME),
              describe_file(workspace.root, handoff_path)]
    if result.get("delivery_selection_path"):
        path = workspace.root / result["delivery_selection_path"]
        if not path.resolve().is_relative_to(root.resolve()) or read_json(path) != result["delivery_selection"]:
            raise ImplementationError("The retained ordered delivery selection changed.")
        files.append(describe_file(workspace.root, path))
    original_plan = read_json(store.base / _safe_id(result["plan_id"]) / "reports" / result["report_id"] / "plan.json")
    attachments = deepcopy(identity.get("original_local_attachments", []))
    available = {item["retained_path"] for item in attachments if item.get("retained_path")}
    original_selection = result["identity"].get("original_delivery_selection")
    report_preview = {
        "schema": SCHEMA, "operation_id": operation_id,
        "source_identity": deepcopy(identity), "plan_binding": deepcopy(binding),
        "report_id": result["report_id"], "title": original_plan["title"], "as_of": result["as_of"],
        "counts": {key: len(original_plan[key]) for key in
                   ("tasks", "budget_lines", "sites", "monitoring_plans", "visits", "activities", "observations")},
        "existing_observed_sources": deepcopy(observed_context.source_choices(original_selection or {})),
        "delivery_selection_supplied": original_selection is not None,
        "original_report_member_count": len(identity["members"]),
        "attachment_count": len(available), "attachment_inventory": attachments,
        "state": "retained",
    }
    return {**result, "source_key": source_key, "files": files, "reused": True,
            "report_preview": report_preview}


def list_report_sources(workspace, plan_id, *, report_id=None):
    """Discover committed original report handoffs without browser state or registration."""
    workspace = _workspace(workspace)
    plan_id = _safe_id(plan_id, "plan_id")
    if report_id is not None and (not isinstance(report_id, str)
            or not re.fullmatch(r"[0-9a-f]{64}", report_id)):
        raise ImplementationError("Choose an original saved report edition.")
    ImplementationStore(workspace).get(plan_id)
    base = workspace.root / "implementation" / "report-context"
    if base.is_symlink() or not base.resolve().is_relative_to(workspace.root.resolve()):
        raise ImplementationError("The retained report source inventory leaves its Workspace.")
    if not base.exists():
        return []
    items = []
    for root in sorted(base.iterdir()):
        if not re.fullmatch(r"[0-9a-f]{64}", root.name):
            continue
        if root.is_symlink() or not root.is_dir():
            raise ImplementationError("A retained report source directory changed.")
        receipt_path = root / RECEIPT_NAME
        if not receipt_path.exists():
            continue  # An interrupted source build has no committed handoff.
        if receipt_path.is_symlink():
            raise ImplementationError("A retained report source receipt changed.")
        receipt = read_json(receipt_path)
        identity = receipt.get("source_identity", {})
        if identity.get("plan_binding", {}).get("plan_id") != plan_id:
            continue
        if report_id is not None and identity.get("report_id") != report_id:
            continue
        handoffs = root / "handoffs"
        if handoffs.is_symlink():
            raise ImplementationError("The retained report handoff inventory changed.")
        if not handoffs.exists():
            continue
        for directory in sorted(handoffs.iterdir()):
            if not re.fullmatch(r"[0-9a-f]{64}", directory.name):
                continue
            if directory.is_symlink() or not directory.is_dir():
                raise ImplementationError("A retained report handoff directory changed.")
            path = directory / "handoff.json"
            if not path.exists():
                continue
            if path.is_symlink():
                raise ImplementationError("A retained report handoff record changed.")
            result = get_report_source(workspace, root.name, directory.name)
            if result["plan_id"] != plan_id or (report_id is not None and result["report_id"] != report_id):
                raise ImplementationError("The retained report handoff names another saved plan.")
            selection = result.get("delivery_selection")
            choices = observed_context.source_choices(selection) if selection is not None else [
                {key: result[key] for key in ("source_collection_id", "source_id")}]
            items.append({
                "source_key": root.name, "operation_id": directory.name,
                "plan_id": plan_id, "report_id": result["report_id"],
                "plan_binding": deepcopy(result["plan_binding"]),
                "revision": result["revision"], "as_of": result["as_of"],
                "title": result["report_preview"]["title"],
                "delivery_selection_supplied": selection is not None,
                "source_count": len(choices), "sources": deepcopy(choices),
                "delivery_mode": selection.get("delivery_mode") if selection is not None else None,
            })
    return sorted(items, key=lambda item: (item["revision"], item["as_of"], item["report_id"],
                                          item["source_key"], item["operation_id"]), reverse=True)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--plan-id", required=True)
    parser.add_argument("--report-id", required=True)
    parser.add_argument("--delivery-selection", type=Path)
    parser.add_argument("--expected-operation-id")
    parser.add_argument("--preview", action="store_true")
    args = parser.parse_args(argv)
    selection = read_json(args.delivery_selection) if args.delivery_selection else None
    if args.preview:
        result = preview_report_source(args.workspace, args.plan_id, args.report_id,
                                         existing_report_selection=selection)
    else:
        result = import_report_source(args.workspace, args.plan_id, args.report_id,
                                        existing_report_selection=selection,
                                        expected_operation_id=args.expected_operation_id)
    print(json.dumps(result, ensure_ascii=False, sort_keys=True, allow_nan=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
