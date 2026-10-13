"""Retain original laboratory request reconciliation in the scientific report.

The source is a deterministic view of one retained dispatch and one exact saved
field-plan revision. It composes the existing observed report source, preserves
all original package and current laboratory files, and uses the native delivery
collector. Preparing this source does not change a plan or observation dataset.
"""
from __future__ import annotations

import copy
import csv
import io
from pathlib import Path
import re

from .common import atomic_bytes, atomic_json, describe_file, digest, held, read_json
from .implementation import ImplementationStore
from .implementation_schema import ImplementationError, document_digest, validate_plan
from .implementation_lab_dispatch import dispatch_files, reconcile_dispatch
from .implementation_observation_quality import method_context
from .implementation_observations import (
    _attachment_inventory, _compose_existing, _retain, _same,
    _composition_selection, _composition_identity, _compose_report_selection,
)
from . import observed_context

EDITION = "laboratory-dispatch-report-20261013-v2-method-definition"
SCHEMA = "upstate.implementation-lab-dispatch-report/v1"
IDENTITY_SCHEMA = "upstate.implementation-lab-dispatch-report-identity/v1"
MAX_VISIBLE_ROWS = 100
HEX = re.compile(r"^[0-9a-f]{64}$")

REQUEST_FIELDS = (
    "order_id", "activity_id", "sample_id", "parameter", "unit", "basis",
    "fraction", "method", "method_context", "method_name", "returned_method_definitions", "status", "observation_ids",
    "ambiguous_observation_ids", "result_types", "issues",
)
RESULT_FIELDS = (
    "observation_id", "relation", "matched_order_ids", "competing_order_ids",
    "activity_id", "sample_id", "site_id", "visit_id", "collected_at",
    "collection_method", "custody_ref", "parameter", "result_type",
    "numeric_value", "original_text", "unit", "basis", "fraction", "method",
    "method_context", "method_name", "method_source_definition",
    "qualifier", "qa_status", "detection_limit", "quantitation_limit",
    "lab_source_link_id", "original_csv_record", "original_csv_sha256",
    "original_dispatch_id", "original_order_id", "original_observation",
)
CONTEXT_FIELDS = (
    "order_id", "activity_id", "status", "context_changed",
    "original_sample_id", "current_sample_id", "original_site_id", "current_site_id",
    "original_visit_id", "current_visit_id", "original_collected_at", "current_collected_at",
)


def _clone(value):
    return copy.deepcopy(value)


def _text(value):
    if value is None:
        return ""
    if isinstance(value, (dict, list, bool)):
        import json
        return json.dumps(value, ensure_ascii=False, sort_keys=True, allow_nan=False)
    return str(value)


def _csv(fields, rows):
    body = io.StringIO(newline="")
    writer = csv.DictWriter(body, fieldnames=fields, lineterminator="\r\n")
    writer.writeheader()
    for row in rows:
        writer.writerow({field: _text(row.get(field)) for field in fields})
    return body.getvalue().encode("utf-8")


def _description(root, path):
    return describe_file(Path(root), Path(path))


def _selection(workspace, value, dispatch_id, plan_digest):
    """Reopen this exact laboratory producer while retaining ordered source choices."""
    def matches(source, identity):
        return (identity.get("schema") == IDENTITY_SCHEMA
                and identity.get("project_id") == workspace.project["id"]
                and identity.get("dispatch_id") == dispatch_id
                and identity.get("plan", {}).get("document_digest") == plan_digest
                and source["entry"].get("metadata", {}).get("laboratory_report_operation") == digest(identity))
    return _composition_selection(
        workspace, value, "implementation_dispatch_report_identity", matches)


def _result_records(plan, reconciliation):
    observations = {item["id"]: item for item in plan["observations"]}
    activities = {item["id"]: item for item in plan["activities"]}
    visits = {item["id"]: item for item in plan["visits"]}
    matched, competing = {}, {}
    for order in reconciliation["orders"]:
        for key in order["observation_ids"]:
            matched.setdefault(key, []).append(order["order_id"])
        for key in order["ambiguous_observation_ids"]:
            competing.setdefault(key, []).append(order["order_id"])
    unrequested = set(reconciliation["unrequested_observation_ids"])
    preexisting = set(reconciliation["preexisting_observation_ids"])
    referenced = set(matched) | set(competing) | unrequested | preexisting
    result = []
    for key in sorted(referenced):
        if key not in observations:
            raise ImplementationError("Reconciliation names an observation absent from its saved plan")
        observation = observations[key]
        activity = activities[observation["activity_id"]]
        visit = visits[activity["visit_id"]]
        lab = observation.get("lab_source")
        lab = lab if isinstance(lab, dict) else {}
        original_row = lab.get("original_row")
        original_row = original_row if isinstance(original_row, dict) else {}
        relations = []
        if key in matched:
            relations.append("linked")
        if key in competing:
            relations.append("competing")
        if key in unrequested:
            relations.append("unrequested")
        if key in preexisting:
            relations.append("preexisting")
        declared_method = method_context(observation, activity)
        row = {
            "observation_id": key, "relation": relations,
            "matched_order_ids": matched.get(key, []), "competing_order_ids": competing.get(key, []),
            "activity_id": activity["id"], "sample_id": activity.get("sample_id"),
            "site_id": activity["site_id"], "visit_id": visit["id"],
            "collected_at": activity.get("collected_at"), "collection_method": activity.get("method"),
            "custody_ref": activity.get("custody_ref"),
            **{field: observation.get(field) for field in (
                "parameter", "result_type", "original_text", "unit", "basis", "fraction",
                "method", "qualifier", "qa_status", "detection_limit", "quantitation_limit")},
            "method_context": declared_method["method_context"],
            "method_name": declared_method["method_name"],
            "method_source_definition": declared_method,
            "numeric_value": observation.get("value"),
            "lab_source_link_id": lab.get("source_link_id"), "original_csv_record": lab.get("record"),
            "original_csv_sha256": lab.get("csv_sha256"),
            "original_dispatch_id": original_row.get("dispatch_id"),
            "original_order_id": original_row.get("order_id"),
            "original_observation": _clone(observation),
        }
        result.append(row)
    return result


def _sample_contexts(reconciliation):
    rows = []
    for order in reconciliation["orders"]:
        original = order.get("original_sample_context") or {}
        current = order.get("current_sample_context") or {}
        row = {
            "order_id": order["order_id"], "activity_id": order["activity_id"],
            "status": order["status"],
            "context_changed": any(item.get("code") == "sample_context_changed"
                                   for item in order.get("issues", [])),
        }
        for field in ("sample_id", "site_id", "visit_id", "collected_at"):
            row["original_" + field] = original.get(field)
            row["current_" + field] = current.get(field)
        rows.append(row)
    return rows


def _context(workspace, saved_plan, dispatch_id, existing_report_selection):
    plan = validate_plan(saved_plan)
    store = ImplementationStore(workspace)
    retained = store.get(plan["id"], revision=plan["revision"])
    checksum = document_digest(plan)
    if retained != plan or document_digest(retained) != checksum:
        raise ImplementationError("Select the exact saved field-plan revision before preparing its report")
    package, package_files = dispatch_files(workspace, plan["id"], dispatch_id)
    reconciliation = reconcile_dispatch(workspace, plan, dispatch_id)
    if reconciliation["plan"]["document_digest"] != checksum:
        raise ImplementationError("The reconciliation changed its original saved revision")
    revision_path = store._directory(plan["id"]) / "revisions" / ("%016d.json" % plan["revision"])
    revision = store._read_record(revision_path)
    if document_digest(revision["plan"]) != checksum:
        raise ImplementationError("The original saved revision event changed")
    attachments, attachment_files = _attachment_inventory(workspace, plan)
    selected, original_binding, composition = _selection(workspace, existing_report_selection, dispatch_id, checksum)
    identity = {
        "schema": IDENTITY_SCHEMA, "edition": EDITION,
        "project_id": workspace.project["id"], "dispatch_id": dispatch_id,
        "dispatch_plan": package["plan"], "plan": reconciliation["plan"],
        "package_files": _clone(package["files"]),
        "revision_file": _description(workspace.root, revision_path),
        "attachment_inventory": attachments,
        "reconciliation_sha256": digest(reconciliation),
        "original_delivery_selection": selected,
        "original_observed_context_binding": original_binding,
        **_composition_identity(selected, composition),
    }
    records = _result_records(plan, reconciliation)
    contexts = _sample_contexts(reconciliation)
    summary = {
        **reconciliation["summary"],
        "samples": package["summary"]["samples"],
        "source_result_records": len(records),
        "source_result_types": {
            kind: sum(row["result_type"] == kind for row in records)
            for kind in ("numeric", "censored", "text", "missing")
        },
        "sample_context_changes": sum(row["context_changed"] for row in contexts),
        "package_members": len(package_files),
        "current_attachment_files": len(attachment_files),
        "current_attachment_references": len(attachments),
        "existing_report_composed": original_binding is not None,
    }
    operation_id = digest(identity)
    preview = {
        "schema": SCHEMA, "edition": EDITION, "operation_id": operation_id,
        "dispatch_id": dispatch_id, "dispatch_plan": package["plan"],
        "plan": reconciliation["plan"], "summary": summary,
        "interpretation": reconciliation["interpretation"],
        "source_collection_id": None, "report_source": None,
        "delivery_selection": None, "state": "preview",
    }
    return {
        "identity": identity, "operation_id": operation_id, "plan": plan,
        "revision_path": revision_path, "package": package, "package_files": package_files,
        "reconciliation": reconciliation, "records": records, "contexts": contexts,
        "attachment_files": attachment_files, "preview": preview,
        "report_composition": composition,
    }


def preview_dispatch_report(workspace, saved_plan, dispatch_id, *, existing_report_selection=None):
    """Describe the exact source-bound report operation without writing files."""
    try:
        return _clone(_context(workspace, saved_plan, dispatch_id, existing_report_selection)["preview"])
    except ImplementationError:
        raise
    except (ValueError, KeyError, TypeError, OSError) as error:
        raise ImplementationError("Laboratory dispatch report preview: " + str(error)) from error


def _table(columns, rows):
    return {"kind": "table", "columns": columns,
            "rows": [[_text(value) for value in row] for row in rows]}


def _links(items):
    return {"kind": "links", "items": [{"title": title, "path": path} for title, path in items]}


def _sections(context):
    package = context["package"]
    reconciliation = context["reconciliation"]
    plan = context["identity"]["plan"]
    orders, records, contexts = reconciliation["orders"], context["records"], context["contexts"]
    summary = context["preview"]["summary"]
    prefix = "laboratory/"
    request_rows = []
    for row in orders[:MAX_VISIBLE_ROWS]:
        requested = "; ".join(key + ": " + _text(row[key]) for key in
                              ("unit", "basis", "fraction", "method", "method_context", "method_name") if row.get(key))
        request_rows.append([
            row["sample_id"], row["parameter"] + ("; " + requested if requested else ""),
            row["status"], len(row["observation_ids"]), len(row["ambiguous_observation_ids"]),
            "; ".join(item.get("message", item.get("code", "")) for item in row.get("issues", [])),
        ])
    result_rows = [[
        _text(row["sample_id"]) + "\n" + _text(row["collected_at"]),
        row["parameter"],
        row["result_type"] + "; numeric: " + _text(row["numeric_value"]) +
        "; original: " + _text(row["original_text"]) + "; relationship: " + _text(row["relation"]),
        "; ".join(key + ": " + _text(row[key]) for key in ("unit", "basis", "fraction") if row.get(key)),
        "\n".join(label + ": " + _text(row[key]) for key, label in
                    (("method", "Method"), ("method_context", "Context"), ("method_name", "Full name"))
                    if row.get(key)),
        "; ".join(key + ": " + _text(row[key]) for key in ("qualifier", "qa_status") if row.get(key)),
    ] for row in records[:MAX_VISIBLE_ROWS]]
    changed = [row for row in contexts if row["context_changed"]]
    sections = [
        ["Laboratory requests and returned source records", [
            "This section binds a retained laboratory request to one exact saved field-plan revision.",
            _table(["Original source", "Value"], [
                ["Dispatch ID", package["dispatch_id"]],
                ["Request label", package["selection"]["label"]],
                ["Laboratory", package["selection"]["laboratory"]],
                ["Laboratory reference", package["selection"]["laboratory_reference"]],
                ["Request instructions", package["selection"]["instructions"]],
                ["Original requested plan", package["plan"]["id"]],
                ["Original requested revision", package["plan"]["revision"]],
                ["Original requested document digest", package["plan"]["document_digest"]],
                ["Compared saved revision", plan["revision"]],
                ["Compared document digest", plan["document_digest"]],
            ]),
            reconciliation["interpretation"],
            _table(["Count", "Value"], [[key.replace("_", " "), summary[key]] for key in
                                       ("samples", "orders", "returned", "missing", "ambiguous",
                                        "unrequested", "preexisting", "sample_context_changes")]),
            "Source result-type counts include the distinct matched, competing, unrequested and pre-existing "
            "records listed below; an observation appearing against several orders is counted once.",
            _table(["Original result type", "Distinct source records"],
                   list(summary["source_result_types"].items())),
        ]],
        ["Explicit requested analyses and their return status", [
            "Each request keeps its original parameter and any specified unit, chemical basis, fraction and "
            "method, naming context and full name. Requested context/name compare exact declared source text; "
            "a missing or different declared definition remains unresolved. A blank optional request field "
            "imposes no restriction. Status follows the native "
            "reconciliation; competing result IDs remain separate from directly linked IDs. A returned status "
            "describes new or changed saved records, not a recorded shipment or receipt event.",
            _table(["Original sample", "Requested parameter / definition", "Status",
                    "Linked results", "Competing results", "Issues"], request_rows),
            "Showing " + str(min(len(orders), MAX_VISIBLE_ROWS)) + " of " + str(len(orders)) +
            " original orders. The retained CSV and JSON contain every exact order/result ID, result type and issue.",
            _links([("Complete requested/returned rows", prefix + "tables/requests.csv"),
                    ("Complete native reconciliation", prefix + "reconciliation.json")]),
        ]],
        ["Original results supporting the laboratory reconciliation", [
            "Numeric values are copied from their original saved records. Censored, text and missing records "
            "keep their original result types and text. Original QA and qualifier fields are shown as recorded.",
            _table(["Sample / collection time", "Parameter", "Original result / type",
                    "Unit / basis / fraction", "Method", "Original QA / qualifier"], result_rows),
            "Showing " + str(min(len(records), MAX_VISIBLE_ROWS)) + " of " + str(len(records)) +
            " distinct source records. Complete records retain original limits, laboratory CSV rows, "
            "mapping choices, collection methods, custody references and source IDs.",
            _links([("All original result records with relationships", prefix + "result-records.json"),
                    ("Complete result detail table", prefix + "tables/results.csv"),
                    ("Exact compared field plan", prefix + "current/plan.json"),
                    ("Original revision event", prefix + "current/revision.json")]),
        ]],
        ["Original and current sample context", [
            "Original sample, site, visit and collection timestamp come from the saved request. "
            "The comparison uses the selected saved revision. Equal timezone-aware collection instants "
            "remain equivalent even when their retained offset strings differ.",
            _table(["Original / current sample", "Original site / visit", "Current site / visit",
                    "Original collection", "Current collection"], [
                [_text(row["original_sample_id"]) + "\n" + _text(row["current_sample_id"]),
                 _text(row["original_site_id"]) + "\n" + _text(row["original_visit_id"]),
                 _text(row["current_site_id"]) + "\n" + _text(row["current_visit_id"]),
                 row["original_collected_at"], row["current_collected_at"]]
                for row in changed[:MAX_VISIBLE_ROWS]
            ]),
            str(len(changed)) + " requested analyses have a recorded sample-context change. "
            "The complete context table includes every order, including unchanged context.",
            _links([("All original/current sample contexts", prefix + "tables/sample-context.csv")]),
        ]],
        ["Laboratory request and result source files", [
            _table(["Current source", "Original reference", "Availability"], [
                [row["source_link_id"], row.get("reference"), row["state"]]
                for row in context["identity"]["attachment_inventory"][:MAX_VISIBLE_ROWS]
            ]),
            "The retained source includes every original laboratory package member and all available "
            "current local-file sources verified against their recorded byte counts and hashes. "
            "Unresolved original file references remain explicit in the full inventory.",
            _links([("Complete original laboratory package", prefix + "dispatch/laboratory-package.zip"),
                    ("Original submission table", prefix + "dispatch/lab-submission.csv"),
                    ("Original request and sample metadata", prefix + "dispatch/dispatch.json"),
                    ("Complete current attachment inventory", prefix + "current/attachment-inventory.json"),
                    ("Source-bound report operation", prefix + "identity.json")]),
        ]],
    ]
    return sections


def _write_sources(context, root):
    atomic_json(root / "identity.json", context["identity"], immutable=True)
    atomic_json(root / "reconciliation.json", context["reconciliation"], immutable=True)
    atomic_json(root / "result-records.json", context["records"], immutable=True)
    atomic_json(root / "dispatch-package.json", context["package"], immutable=True)
    atomic_json(root / "current/plan.json", context["plan"], immutable=True)
    atomic_json(root / "current/attachment-inventory.json",
                context["identity"]["attachment_inventory"], immutable=True)
    _retain(context["revision_path"], root / "current/revision.json",
            context["identity"]["revision_file"])
    names = [
        "identity.json", "reconciliation.json", "result-records.json", "dispatch-package.json",
        "current/plan.json", "current/revision.json", "current/attachment-inventory.json",
    ]
    for descriptor, path in context["package_files"]:
        name = "dispatch/" + observed_context._relative(descriptor["path"]).as_posix()
        _retain(path, root / name, descriptor)
        names.append(name)
    for path, descriptor in context["attachment_files"]:
        name = "current/" + descriptor["retained_path"]
        _retain(path, root / name, descriptor)
        names.append(name)
    for name, fields, rows in (
        ("tables/requests.csv", REQUEST_FIELDS, context["reconciliation"]["orders"]),
        ("tables/results.csv", RESULT_FIELDS, context["records"]),
        ("tables/sample-context.csv", CONTEXT_FIELDS, context["contexts"]),
    ):
        atomic_bytes(root / name, _csv(fields, rows), immutable=True)
        names.append(name)
    return [_description(root, root / name) for name in sorted(set(names))]


def _report(workspace, context, root, source_members):
    directory = root / "report"
    selected = context["identity"]["original_delivery_selection"]
    composition = context["report_composition"]
    recipe, binding, names = _compose_existing(workspace, selected, directory, composition)
    if binding != context["identity"]["original_observed_context_binding"]:
        raise ImplementationError("The original scientific context changed during composition")
    for descriptor in source_members:
        name = "laboratory/" + descriptor["path"]
        _retain(root / descriptor["path"], directory / name, descriptor)
        names.append(name)
    atomic_json(directory / "original-delivery-selection.json", selected, immutable=True)
    names.append("original-delivery-selection.json")
    companions = [_description(directory, directory / name) for name in sorted(set(names))]
    sections = list(recipe.get("sections", [])) + _sections(context)
    # The inherited field producer sentinel identifies its own top-level recipe.
    # Keeping it active here would let a later field-source reopen strip this
    # additional laboratory context. Its complete original recipe remains a
    # hashed existing-context member and the prior identity stays descriptive.
    if "implementation_observation_identity" in recipe:
        recipe["preceding_field_observation_identity"] = recipe.pop("implementation_observation_identity")
    title = context["plan"]["title"] + " — laboratory requests and returned results"
    recipe.update({
        "schema": observed_context.SCHEMA, "title": title, "sections": sections,
        "inputs": companions,
        "source_links": list(dict.fromkeys(list(recipe.get("source_links", [])) + [
            "laboratory/reconciliation.json", "laboratory/result-records.json",
            "laboratory/tables/requests.csv", "laboratory/tables/results.csv",
            "laboratory/tables/sample-context.csv", "laboratory/dispatch/laboratory-package.zip",
            "laboratory/current/plan.json", "laboratory/current/revision.json",
        ])),
        "implementation_dispatch_report_identity": context["identity"],
    })
    atomic_json(directory / "observed-report.json", recipe, immutable=True)
    entry = {
        "id": "laboratory-report-" + context["operation_id"][:24],
        "kind": "document", "role": observed_context.ROLE,
        "metadata": {"report_schema": observed_context.SCHEMA,
                     "implementation_plan": context["identity"]["plan"],
                     "laboratory_dispatch_id": context["identity"]["dispatch_id"],
                     "laboratory_report_operation": context["operation_id"]},
        "title": title, "uri": "urn:upstate:field-laboratory-report:" + context["operation_id"],
        "vintage": "Request revision " + str(context["package"]["revision"]) +
                   "; compared saved revision " + str(context["plan"]["revision"]),
        "units": "original recorded units, requested definitions and result types",
        **_description(directory, directory / "observed-report.json"), "companions": companions,
    }
    atomic_json(directory / "model-sources.json",
                {"schema": "upstate.sources/v1", "title": title, "entries": [entry]}, immutable=True)
    collection = workspace.import_sources(directory / "model-sources.json")
    choice = {"source_collection_id": collection["id"], "source_id": entry["id"]}
    selection = _compose_report_selection(workspace, selected, choice, composition)
    atomic_json(directory / "delivery-selection.json", selection, immutable=True)
    paths = sorted(set(names + ["observed-report.json", "model-sources.json", "delivery-selection.json"]))
    return {
        **choice, "source_role": observed_context.ROLE,
        "binding": selection["observed_context_binding"], "original_binding": binding,
        "delivery_selection": selection,
        "delivery_selection_path": (directory / "delivery-selection.json").relative_to(workspace.root).as_posix(),
        "directory": directory.relative_to(workspace.root).as_posix(),
        "files": [_description(workspace.root, directory / name) for name in paths],
    }


def _root(workspace, operation_id):
    if not isinstance(operation_id, str) or not HEX.fullmatch(operation_id):
        raise ImplementationError("Choose the exact laboratory report operation")
    base = Path(workspace.root).resolve()
    root = base / "implementation" / "laboratory-reports" / operation_id
    if root.is_symlink() or not root.resolve().is_relative_to(base):
        raise ImplementationError("The laboratory report directory escapes its original workspace")
    return root


def _reopen(workspace, receipt_path, context):
    receipt = read_json(receipt_path)
    if (receipt.get("schema") != SCHEMA or receipt.get("operation_id") != context["operation_id"]
            or receipt.get("plan") != context["identity"]["plan"]
            or receipt.get("dispatch_id") != context["identity"]["dispatch_id"]
            or receipt.get("dispatch_plan") != context["identity"]["dispatch_plan"]):
        raise ImplementationError("The retained laboratory report belongs to another original operation")
    for descriptor in receipt["files"]:
        path = Path(workspace.root) / observed_context._relative(descriptor["path"])
        if not path.resolve().is_relative_to(Path(workspace.root).resolve()) or not _same(path, descriptor):
            raise ImplementationError("A retained laboratory report member changed: " + descriptor["path"])
    report = receipt["report_source"]
    if (observed_context.bind(workspace, report["delivery_selection"]) != report["binding"]
            or receipt["source_collection_id"] != report["source_collection_id"]
            or receipt["delivery_selection"] != report["delivery_selection"]):
        raise ImplementationError("The retained laboratory report source binding changed")
    workspace._get("sources", receipt["source_collection_id"])
    return {**receipt, "reused": True}


def import_dispatch_report(workspace, saved_plan, dispatch_id, *,
                           expected_operation_id, existing_report_selection=None):
    """Prepare one immutable source edition for the existing client-report flow."""
    try:
        context = _context(workspace, saved_plan, dispatch_id, existing_report_selection)
        if expected_operation_id != context["operation_id"]:
            raise ImplementationError("The original laboratory report source changed after preview")
        root = _root(workspace, context["operation_id"])
        root.mkdir(parents=True, exist_ok=True)
        with held(root / "operation.lock"):
            receipt_path = root / "import.json"
            if receipt_path.exists():
                return _reopen(workspace, receipt_path, context)
            members = _write_sources(context, root)
            report = _report(workspace, context, root, members)
            receipt = {
                **context["preview"], "state": "imported",
                "source_collection_id": report["source_collection_id"],
                "report_source": report, "delivery_selection": report["delivery_selection"],
                "directory": root.relative_to(workspace.root).as_posix(),
                "files": [_description(workspace.root, root / item["path"]) for item in members] + report["files"],
            }
            atomic_json(receipt_path, receipt, immutable=True)
            return {**receipt, "reused": False}
    except ImplementationError:
        raise
    except (ValueError, KeyError, TypeError, OSError) as error:
        raise ImplementationError("Laboratory dispatch scientific report: " + str(error)) from error
