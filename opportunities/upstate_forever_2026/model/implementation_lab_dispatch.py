"""Prepare laboratory requests from original saved samples and reconcile results."""
from __future__ import annotations
import copy
import csv
import datetime as dt
import hashlib
import io
import json
import os
from pathlib import Path
import tempfile
import re
import zipfile

from .common import atomic_bytes, atomic_json, digest, file_digest, held, read_json
from .implementation import ImplementationStore
from .implementation_schema import ImplementationError, document_digest, validate_plan

EDITION = "laboratory-dispatch-20261013-v1"
SELECTION_SCHEMA = "upstate.implementation-lab-dispatch-selection/v1"
PREVIEW_SCHEMA = "upstate.implementation-lab-dispatch-preview/v1"
SCHEMA = "upstate.implementation-lab-dispatch/v1"
RECONCILIATION_SCHEMA = "upstate.implementation-lab-dispatch-reconciliation/v1"
ORDER_FIELDS = ("activity_id", "parameter", "unit", "basis", "fraction", "method", "notes")
REQUEST_FIELDS = ("parameter", "unit", "basis", "fraction", "method")
RETURN_FIELDS = (
    "dispatch_id", "order_id", "activity_id", "sample_id", "site_id", "visit_id",
    "collected_at", "requested_parameter", "requested_unit", "requested_basis",
    "requested_fraction", "requested_method", "parameter", "original_text",
    "value", "result_type", "unit", "basis", "fraction", "qualifier",
    "detection_limit", "quantitation_limit", "method", "qa_status", "notes",
)
SUBMISSION_FIELDS = (
    "dispatch_id", "order_id", "activity_id", "sample_id", "site_id", "site_label",
    "visit_id", "collected_at", "collection_method", "custody_ref",
    "parameter", "unit", "basis", "fraction", "method", "notes",
)
HEX = re.compile(r"^[0-9a-f]{64}$")


def _text(value, label, *, required=False):
    if value is None and not required:
        return ""
    if not isinstance(value, str) or "\0" in value:
        raise ImplementationError(label + " must be original text")
    if required and not value.strip():
        raise ImplementationError(label + " is required")
    return value


def _selection(value):
    if not isinstance(value, dict) or value.get("schema") != SELECTION_SCHEMA:
        raise ImplementationError("Choose an explicit original laboratory dispatch selection")
    allowed = {"schema", "label", "laboratory", "laboratory_reference",
               "instructions", "orders", "attachment_source_ids"}
    if set(value) - allowed:
        raise ImplementationError("Unknown dispatch selection fields: " +
                                  ", ".join(sorted(set(value) - allowed)))
    result = {"schema": SELECTION_SCHEMA}
    for key in ("label", "laboratory", "laboratory_reference", "instructions"):
        result[key] = _text(value.get(key), key, required=key == "label")
    orders = value.get("orders")
    if not isinstance(orders, list) or not orders:
        raise ImplementationError("Select at least one original sample and requested analysis")
    result["orders"] = []
    seen = set()
    for index, item in enumerate(orders):
        if not isinstance(item, dict) or set(item) - set(ORDER_FIELDS):
            raise ImplementationError("Every requested analysis must use the explicit order fields")
        row = {key: _text(item.get(key), "orders[" + str(index) + "]." + key,
                          required=key in ("activity_id", "parameter")) for key in ORDER_FIELDS}
        key = tuple(row[field] for field in ("activity_id", *REQUEST_FIELDS))
        if key in seen:
            raise ImplementationError("The same original sample and analysis definition was requested twice")
        seen.add(key)
        result["orders"].append(row)
    ids = value.get("attachment_source_ids", [])
    if not isinstance(ids, list) or any(not isinstance(item, str) or not item for item in ids):
        raise ImplementationError("Choose original attachment source IDs")
    if len(ids) != len(set(ids)):
        raise ImplementationError("The original attachment selection contains a duplicate")
    result["attachment_source_ids"] = sorted(ids)
    result["orders"].sort(key=lambda row: tuple(row[field] for field in ORDER_FIELDS))
    return result


def _saved(workspace, saved_plan):
    plan = validate_plan(saved_plan)
    if plan["revision"] < 1:
        raise ImplementationError("Save the field plan before preparing laboratory work")
    actual = ImplementationStore(workspace).get(plan["id"], plan["revision"])
    checksum = document_digest(plan)
    if document_digest(actual) != checksum or actual != plan:
        raise ImplementationError("The selected saved revision differs from the native original")
    return plan, {"id": plan["id"], "revision": plan["revision"],
                  "document_digest": checksum, "title": plan["title"]}


def _issue(code, message, *, severity="error", **fields):
    return {"severity": severity, "code": code, "message": message, **fields}


def _attachment(workspace, plan, link):
    reference = link.get("reference")
    expected_sha, expected_size = link.get("sha256"), link.get("size_bytes")
    if (link.get("kind") != "local_file" or not isinstance(reference, str)
            or not isinstance(expected_sha, str) or not HEX.fullmatch(expected_sha)
            or type(expected_size) is not int or expected_size < 0):
        raise ImplementationError("The selected source needs its original local-file identity")
    relative = Path(reference)
    if relative.is_absolute() or ".." in relative.parts:
        raise ImplementationError("Original attachment reference must remain inside its plan")
    root = workspace.root.resolve()
    bank = (root / "implementation" / "plans" / plan["id"] / "attachments").resolve()
    source = root / relative
    if source.is_symlink() or not source.is_file() or not source.resolve().is_relative_to(bank):
        raise ImplementationError("The selected original attachment is unavailable")
    if source.stat().st_size != expected_size or file_digest(source) != expected_sha:
        raise ImplementationError("The selected original attachment differs from its retained identity")
    return source, {
        "source_link_id": link["id"], "label": link["label"], "reference": reference,
        "bytes": expected_size, "sha256": expected_sha,
        "path": "attachments/" + expected_sha + "-" + source.name,
    }


def _context(workspace, saved_plan, selection):
    plan, binding = _saved(workspace, saved_plan)
    selected = _selection(selection)
    activities = {row["id"]: row for row in plan["activities"]}
    visits = {row["id"]: row for row in plan["visits"]}
    sites = {row["id"]: row for row in plan["sites"]}
    campaigns = {row["id"]: row for row in plan["monitoring_plans"]}
    links = {row["id"]: row for row in plan["source_links"]}
    issues, orders, samples, attachments, attachment_paths = [], [], {}, [], {}
    for request in selected["orders"]:
        activity = activities.get(request["activity_id"])
        if activity is None or activity.get("kind") != "sample":
            issues.append(_issue("original_sample", "Choose an original saved sample activity",
                                 activity_id=request["activity_id"]))
            continue
        visit, site = visits[activity["visit_id"]], sites[activity["site_id"]]
        order_id = "order-" + digest({"plan": binding, "request": request})[:32]
        if not activity.get("collected_at"):
            issues.append(_issue("collection_time", "Record the original collection timestamp before dispatch",
                                 activity_id=activity["id"], order_id=order_id))
        if visit["status"] == "cancelled":
            issues.append(_issue("cancelled_visit", "This original sample belongs to a cancelled visit",
                                 severity="warning", activity_id=activity["id"], order_id=order_id))
        if not activity.get("custody_ref"):
            issues.append(_issue("custody_unstated", "This original sample has no recorded custody reference",
                                 severity="warning", activity_id=activity["id"], order_id=order_id))
        row = {
            "order_id": order_id, **request, "sample_id": activity["sample_id"],
            "site_id": site["id"], "site_label": site["label"], "visit_id": visit["id"],
            "collected_at": activity.get("collected_at"),
            "collection_method": activity.get("method"), "custody_ref": activity.get("custody_ref"),
        }
        orders.append(row)
        samples[activity["id"]] = {
            "activity": copy.deepcopy(activity), "visit": copy.deepcopy(visit),
            "site": copy.deepcopy(site),
            "monitoring_plan": copy.deepcopy(campaigns.get(visit.get("monitoring_plan_id"))),
        }
    for source_id in selected["attachment_source_ids"]:
        link = links.get(source_id)
        if link is None:
            issues.append(_issue("attachment_missing", "The selected source is absent from the saved revision",
                                 source_link_id=source_id))
            continue
        try:
            path, entry = _attachment(workspace, plan, link)
        except (OSError, ImplementationError) as error:
            issues.append(_issue("attachment_changed", str(error), source_link_id=source_id))
        else:
            attachments.append(entry)
            attachment_paths[entry["path"]] = path
    identity = {
        "schema": SCHEMA, "edition": EDITION, "project_id": workspace.project["id"],
        "plan": binding, "selection": selected, "attachments": attachments,
    }
    operation_id = digest(identity)
    for row in orders:
        row["dispatch_id"] = operation_id
    return {
        "identity": identity, "operation_id": operation_id, "plan_document": plan,
        "plan": binding, "selection": selected, "orders": orders,
        "samples": list(samples.values()), "attachments": attachments,
        "attachment_paths": attachment_paths, "issues": issues,
        "summary": {"samples": len(samples), "orders": len(orders), "attachments": len(attachments)},
    }


def preview_dispatch(workspace, saved_plan, selection):
    context = _context(workspace, saved_plan, selection)
    return {
        "schema": PREVIEW_SCHEMA, "operation_id": context["operation_id"],
        "can_prepare": not any(row["severity"] == "error" for row in context["issues"]),
        **{key: copy.deepcopy(context[key]) for key in
           ("plan", "selection", "summary", "issues", "orders")},
    }


def _root(workspace, dispatch_id):
    if not isinstance(dispatch_id, str) or not HEX.fullmatch(dispatch_id):
        raise ImplementationError("Choose an exact retained laboratory dispatch ID")
    base = workspace.root.resolve() / "implementation" / "laboratory-dispatch"
    root = base / dispatch_id
    if (not base.resolve().is_relative_to(workspace.root.resolve()) or root.is_symlink()
            or root.resolve().parent != base.resolve()):
        raise ImplementationError("The laboratory dispatch directory changed")
    return root


def _member(root, descriptor):
    relative = descriptor.get("path")
    if (not isinstance(relative, str) or not relative or Path(relative).is_absolute()
            or ".." in Path(relative).parts):
        raise ImplementationError("The laboratory package member path is invalid")
    path = root / relative
    if (path.is_symlink() or not path.is_file()
            or not path.resolve().is_relative_to(root.resolve())
            or type(descriptor.get("bytes")) is not int
            or path.stat().st_size != descriptor["bytes"]
            or file_digest(path) != descriptor.get("sha256")):
        raise ImplementationError("A retained laboratory package member changed: " + relative)
    return path


def _describe(root, path):
    return {"path": path.relative_to(root).as_posix(), "bytes": path.stat().st_size,
            "sha256": file_digest(path)}


def _retain_file(source, destination, expected):
    """Retain verified originals without loading attachments into memory."""
    source, destination = Path(source), Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        if (destination.is_symlink() or not destination.is_file()
                or destination.stat().st_size != expected["bytes"]
                or file_digest(destination) != expected["sha256"]):
            raise ImplementationError("Retained laboratory member changed: " + destination.name)
        return
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(prefix=".dispatch-", dir=destination.parent, delete=False) as output:
            temporary = Path(output.name)
            checksum, size = hashlib.sha256(), 0
            with source.open("rb") as original:
                for chunk in iter(lambda: original.read(1024 * 1024), b""):
                    checksum.update(chunk)
                    size += len(chunk)
                    output.write(chunk)
            output.flush()
            os.fsync(output.fileno())
        if size != expected["bytes"] or checksum.hexdigest() != expected["sha256"]:
            raise ImplementationError("Original laboratory member changed while retaining: " + source.name)
        try:
            os.link(temporary, destination)
        except FileExistsError:
            if (destination.is_symlink() or not destination.is_file()
                    or destination.stat().st_size != size or file_digest(destination) != checksum.hexdigest()):
                raise ImplementationError("Concurrent laboratory member differs: " + destination.name)
        descriptor = os.open(destination.parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def _csv(fields, rows):
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=fields, lineterminator="\r\n")
    writer.writeheader()
    writer.writerows({key: row.get(key) for key in fields} for row in rows)
    return output.getvalue().encode("utf-8")


def _return_mapping():
    fields = (
        "activity_id", "sample_id", "site_id", "visit_id", "collected_at", "parameter",
        "original_text", "value", "result_type", "unit", "basis", "fraction", "qualifier",
        "detection_limit", "quantitation_limit", "method", "qa_status", "notes",
    )
    return {
        "schema": "upstate.implementation-lab-mapping/v1", "delimiter": ",",
        "encoding": "utf-8-sig", "columns": {key: key for key in fields},
        "constants": {}, "fallback_columns": {},
        "result_type_values": {kind: kind for kind in ("numeric", "censored", "text", "missing")},
        "decimal_separator": ".", "fill_missing_collection_times": False, "row_actions": {},
    }


def _return_rows(context):
    rows = []
    for order in context["orders"]:
        row = {key: order.get(key) for key in
               ("dispatch_id", "order_id", "activity_id", "sample_id", "site_id",
                "visit_id", "collected_at")}
        row.update({"requested_" + key: order[key] for key in REQUEST_FIELDS})
        row["parameter"] = order["parameter"]
        rows.append(row)
    return rows


README = """# Laboratory submission preparation

This package records an explicit analysis request against an original saved
field-plan revision. Original sample IDs, collection timestamps, site/visit
relationships and custody references are retained exactly.

## Files
- lab-submission.csv: one row per explicitly requested analysis.
- return-template.csv: one matching row per request with result cells left blank.
- return-mapping.json: explicit mapping for the completed original template.
- dispatch.json: complete reviewed orders and original sample/site/visit/campaign records.
- original-plan.json: the original saved field-plan revision.
- selection.json: the explicit request and selected source-file IDs.
- attachments/: selected original source files, when included.
- manifest.json: identities and complete original file hashes.

## Returning results
Retain dispatch_id, order_id, the original activity/sample/site/visit IDs and
collection timestamp. Fill each result from the actual laboratory record. The
requested fields are separate from returned parameter, unit, basis, fraction
and method; fill the actual result fields explicitly. Supply result_type as
numeric, censored, text or missing. Numeric values use a decimal point. Keep
the original result text. Censored results use an empty numeric value with the
original qualifier and unit. Only enter detection or quantitation limits when
the source explicitly identifies those limit types.

Import the completed original CSV through Laboratory results with the supplied
mapping, review its rows and save its results. The original CSV preserves
dispatch/order columns alongside the original measurements. Reconcile the saved
dispatch against a selected later saved plan revision to see returned, missing,
ambiguous and unrequested records. Results already present and unchanged at
the dispatch revision are listed separately as pre-existing records.

Preparing this package preserves a request. Record any actual transfer or
receipt in the existing original custody/source records. Keep the original
laboratory report and returned CSV as evidence.
"""


def prepare_dispatch(workspace, saved_plan, selection, *, expected_operation_id, actor=""):
    # A completed immutable package reconnects from its own retained originals,
    # even if the source plan's separate attachment files later become unavailable.
    original_plan, binding = _saved(workspace, saved_plan)
    selected = _selection(selection)
    prior_root = _root(workspace, expected_operation_id)
    if (prior_root / "receipt.json").is_file():
        existing = get_dispatch(workspace, original_plan["id"], expected_operation_id)
        if existing["plan"] != binding or existing["selection"] != selected:
            raise ImplementationError("The retained package belongs to another original reviewed request")
        return dict(existing, status="reconnected")
    context = _context(workspace, original_plan, selected)
    if expected_operation_id != context["operation_id"]:
        raise ImplementationError("The original sample selection or source files changed after preview")
    if any(row["severity"] == "error" for row in context["issues"]):
        raise ImplementationError("Resolve the laboratory preparation issues before creating the package")
    root = _root(workspace, context["operation_id"])
    root.mkdir(parents=True, exist_ok=True)
    with held(root / "operation.lock"):
        if (root / "receipt.json").is_file():
            return dict(get_dispatch(workspace, context["plan"]["id"], context["operation_id"]),
                        status="reconnected")
        intent_path = root / "intent.json"
        if intent_path.exists():
            intent = read_json(intent_path)
            if intent.get("identity") != context["identity"]:
                raise ImplementationError("The retained dispatch operation has another original selection")
        else:
            intent = {
                "identity": context["identity"], "actor": _text(actor, "actor"),
                "prepared_at": dt.datetime.now(dt.timezone.utc).isoformat(),
            }
            atomic_json(intent_path, intent, immutable=True)
        atomic_json(root / "original-plan.json", context["plan_document"], immutable=True)
        atomic_json(root / "selection.json", context["selection"], immutable=True)
        dispatch = {
            "schema": SCHEMA, "dispatch_id": context["operation_id"], "edition": EDITION,
            "identity": context["identity"], "prepared_at": intent["prepared_at"], "actor": intent["actor"],
            **{key: copy.deepcopy(context[key]) for key in
               ("plan", "selection", "orders", "samples", "attachments", "issues", "summary")},
            "source_links": copy.deepcopy(context["plan_document"]["source_links"]),
        }
        atomic_json(root / "dispatch.json", dispatch, immutable=True)
        atomic_bytes(root / "lab-submission.csv", _csv(SUBMISSION_FIELDS, context["orders"]), immutable=True)
        atomic_bytes(root / "return-template.csv", _csv(RETURN_FIELDS, _return_rows(context)), immutable=True)
        atomic_json(root / "return-mapping.json", _return_mapping(), immutable=True)
        atomic_bytes(root / "README.md", README.encode("utf-8"), immutable=True)
        names = ["original-plan.json", "selection.json", "dispatch.json", "lab-submission.csv",
                 "return-template.csv", "return-mapping.json", "README.md"]
        for entry in context["attachments"]:
            path = context["attachment_paths"][entry["path"]]
            _retain_file(path, root / entry["path"], entry)
            names.append(entry["path"])
        members = [_describe(root, root / name) for name in sorted(set(names))]
        manifest = {
            "schema": "upstate.implementation-lab-dispatch-manifest/v1",
            "dispatch_id": context["operation_id"], "identity": context["identity"],
            "prepared_at": intent["prepared_at"], "files": members,
        }
        atomic_json(root / "manifest.json", manifest, immutable=True)
        members.append(_describe(root, root / "manifest.json"))
        with tempfile.TemporaryDirectory(prefix=".dispatch-zip-", dir=root) as temporary:
            archive_path = Path(temporary) / "laboratory-package.zip"
            with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
                for entry in sorted(members, key=lambda item: item["path"]):
                    path = _member(root, entry)
                    info = zipfile.ZipInfo(entry["path"], date_time=(1980, 1, 1, 0, 0, 0))
                    info.compress_type = zipfile.ZIP_DEFLATED
                    info.external_attr = 0o100644 << 16
                    checksum, size = hashlib.sha256(), 0
                    with path.open("rb") as original, archive.open(info, "w", force_zip64=True) as target:
                        for chunk in iter(lambda: original.read(1024 * 1024), b""):
                            target.write(chunk)
                            checksum.update(chunk)
                            size += len(chunk)
                    if size != entry["bytes"] or checksum.hexdigest() != entry["sha256"]:
                        raise ImplementationError("Original member changed while packaging: " + entry["path"])
            _retain_file(archive_path, root / "laboratory-package.zip",
                         {"bytes": archive_path.stat().st_size, "sha256": file_digest(archive_path)})
        members.append(_describe(root, root / "laboratory-package.zip"))
        receipt = {
            "schema": SCHEMA, "dispatch_id": context["operation_id"],
            "operation_id": context["operation_id"], "edition": EDITION,
            "project_id": workspace.project["id"], "plan_id": context["plan"]["id"],
            "revision": context["plan"]["revision"], "document_digest": context["plan"]["document_digest"],
            "label": context["selection"]["label"], "laboratory": context["selection"]["laboratory"],
            "prepared_at": intent["prepared_at"], "status": "prepared",
            "summary": context["summary"], "files": members,
            "directory": root.relative_to(workspace.root.resolve()).as_posix(),
        }
        atomic_json(root / "receipt.json", receipt, immutable=True)
        return get_dispatch(workspace, context["plan"]["id"], context["operation_id"])


def get_dispatch(workspace, plan_id, dispatch_id):
    root = _root(workspace, dispatch_id)
    receipt = read_json(root / "receipt.json")
    if (receipt.get("schema") != SCHEMA or receipt.get("dispatch_id") != dispatch_id
            or receipt.get("plan_id") != plan_id or receipt.get("project_id") != workspace.project["id"]):
        raise ImplementationError("The retained laboratory package belongs to another original plan")
    for entry in receipt["files"]:
        _member(root, entry)
    dispatch = read_json(root / "dispatch.json")
    original = read_json(root / "original-plan.json")
    if (dispatch.get("schema") != SCHEMA or digest(dispatch.get("identity")) != dispatch_id
            or dispatch.get("dispatch_id") != dispatch_id
            or dispatch["plan"]["document_digest"] != receipt["document_digest"]
            or document_digest(original) != receipt["document_digest"]
            or original["id"] != plan_id or original["revision"] != receipt["revision"]):
        raise ImplementationError("The retained laboratory package identity changed")
    return {
        **receipt, "plan": dispatch["plan"], "selection": dispatch["selection"],
        "orders": dispatch["orders"], "samples": dispatch["samples"],
        "attachments": dispatch["attachments"], "issues": dispatch["issues"],
    }


def dispatch_files(workspace, plan_id, dispatch_id):
    result = get_dispatch(workspace, plan_id, dispatch_id)
    root = _root(workspace, dispatch_id)
    return result, [(entry, _member(root, entry)) for entry in result["files"]]


def list_dispatches(workspace, plan_id):
    base = workspace.root.resolve() / "implementation" / "laboratory-dispatch"
    items = []
    for path in sorted(base.glob("*/receipt.json")) if base.is_dir() else ():
        if path.is_symlink() or path.parent.is_symlink():
            continue
        value = read_json(path)
        if value.get("schema") != SCHEMA or value.get("plan_id") != plan_id:
            continue
        if value.get("project_id") != workspace.project["id"] or value.get("dispatch_id") != path.parent.name:
            raise ImplementationError("A retained laboratory dispatch catalogue identity changed")
        items.append({key: value[key] for key in
                      ("dispatch_id", "operation_id", "plan_id", "revision", "document_digest",
                       "label", "laboratory", "prepared_at", "status", "summary")})
    return {"schema": "upstate.implementation-lab-dispatch-list/v1",
            "plan_id": plan_id, "items": sorted(items, key=lambda row: (row["prepared_at"], row["dispatch_id"]),
                                               reverse=True)}


def _explicit_order(observation):
    lab = observation.get("lab_source")
    original = lab.get("original_row") if isinstance(lab, dict) else None
    if not isinstance(original, dict):
        return None, None
    dispatch_id, order_id = original.get("dispatch_id"), original.get("order_id")
    if any(value is not None and not isinstance(value, str) for value in (dispatch_id, order_id)):
        return "__invalid_original_dispatch__", "__invalid_original_order__"
    return dispatch_id, order_id


def _compatible(order, observation):
    return (order["activity_id"] == observation["activity_id"]
            and order["parameter"] == observation["parameter"]
            and all(not order.get(key) or order[key] == (observation.get(key) or "")
                    for key in ("unit", "basis", "fraction", "method")))


def reconcile_dispatch(workspace, saved_plan, dispatch_id):
    plan, binding = _saved(workspace, saved_plan)
    package = get_dispatch(workspace, plan["id"], dispatch_id)
    if plan["revision"] < package["revision"]:
        raise ImplementationError("Choose the dispatch revision or a later saved revision")
    original = read_json(_root(workspace, dispatch_id) / "original-plan.json")
    baseline = {row["id"]: row for row in original["observations"]}
    orders = package["orders"]
    current_activities = {row["id"]: row for row in plan["activities"]}
    original_samples = {row["activity"]["id"]: row for row in package["samples"]}
    order_index = {row["order_id"]: row for row in orders}
    by_order = {key: [] for key in order_index}
    ambiguous, unrequested, problems, preexisting = {}, [], [], []
    relevant_activity_ids = {row["activity_id"] for row in orders}
    for observation in plan["observations"]:
        if baseline.get(observation["id"]) == observation:
            if observation["activity_id"] in relevant_activity_ids:
                preexisting.append(observation["id"])
            continue
        original_dispatch, original_order = _explicit_order(observation)
        if original_dispatch or original_order:
            if original_dispatch != dispatch_id:
                if observation["activity_id"] in relevant_activity_ids:
                    unrequested.append(observation["id"])
                continue
            if original_order not in order_index:
                unrequested.append(observation["id"])
                problems.append(_issue("unknown_order", "Returned CSV names an unknown original order",
                                       severity="warning", observation_id=observation["id"],
                                       order_id=original_order))
                continue
            order = order_index[original_order]
            by_order[original_order].append(observation)
            if not _compatible(order, observation):
                problems.append(_issue("request_definition", "Returned result differs from the original requested sample or analysis definition",
                                       severity="warning", observation_id=observation["id"],
                                       order_id=original_order))
            continue
        if observation["activity_id"] not in relevant_activity_ids:
            continue
        candidates = [row["order_id"] for row in orders if _compatible(row, observation)]
        if len(candidates) == 1:
            by_order[candidates[0]].append(observation)
        elif len(candidates) > 1:
            for key in candidates:
                ambiguous.setdefault(key, []).append(observation["id"])
            problems.append(_issue("ambiguous_request", "This original result matches more than one requested definition",
                                   severity="warning", observation_id=observation["id"],
                                   candidate_order_ids=candidates))
        else:
            unrequested.append(observation["id"])
    rows = []
    for order in orders:
        matches = by_order[order["order_id"]]
        competing = ambiguous.get(order["order_id"], [])
        current_activity = current_activities.get(order["activity_id"])
        original_activity = original_samples[order["activity_id"]]["activity"]
        context_fields = ("sample_id", "site_id", "visit_id", "collected_at")
        original_context = {key: original_activity.get(key) for key in context_fields}
        current_context = ({key: current_activity.get(key) for key in context_fields}
                           if current_activity is not None else None)
        # Exact original text stays visible. Equal timezone-aware instants
        # describe the same collection time even if their offset text differs.
        def collection_instant(value):
            return dt.datetime.fromisoformat(value.replace("Z", "+00:00")) if value else None
        context_changed = (current_context is None or any(
            original_context[key] != current_context[key] for key in context_fields if key != "collected_at"
        ) or collection_instant(original_context["collected_at"]) !=
             collection_instant(current_context["collected_at"]))
        if context_changed:
            problems.append(_issue("sample_context_changed",
                                   "The current sample identity, site, visit or collection time differs from the original request",
                                   severity="warning", order_id=order["order_id"],
                                   activity_id=order["activity_id"]))
        row_issues = [item for item in problems if item.get("order_id") == order["order_id"]
                      or order["order_id"] in item.get("candidate_order_ids", [])]
        if (competing or len(matches) > 1 or (matches and context_changed)
                or any(item["code"] == "request_definition" for item in row_issues)):
            status = "ambiguous"
        elif not matches or matches[0]["result_type"] == "missing":
            status = "missing"
        else:
            status = "returned"
        rows.append({
            **{key: order[key] for key in ("order_id", "activity_id", "sample_id", "parameter",
                                          "unit", "basis", "fraction", "method")},
            "status": status, "observation_ids": [row["id"] for row in matches],
            "ambiguous_observation_ids": competing,
            "original_sample_context": original_context, "current_sample_context": current_context,
            "result_types": [item["result_type"] for item in matches], "issues": row_issues,
        })
    return {
        "schema": RECONCILIATION_SCHEMA, "dispatch_id": dispatch_id,
        "dispatch_plan": package["plan"], "plan": binding, "orders": rows,
        "summary": {
            "orders": len(rows), "returned": sum(row["status"] == "returned" for row in rows),
            "missing": sum(row["status"] == "missing" for row in rows),
            "ambiguous": sum(row["status"] == "ambiguous" for row in rows),
            "unrequested": len(set(unrequested)), "preexisting": len(preexisting), "issues": len(problems),
        },
        "issues": problems, "unrequested_observation_ids": sorted(set(unrequested)),
        "preexisting_observation_ids": preexisting,
        "interpretation": "Returned counts describe exact new or changed saved records, including censored/text results. Unchanged records from the dispatch revision remain pre-existing. Missing records or explicit missing results remain missing. Multiple matching results, overlapping requests and changed request definitions remain ambiguous. Original QA codes are retained without an acceptance decision.",
    }
