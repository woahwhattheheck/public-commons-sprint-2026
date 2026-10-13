"""Original editable FIELD12 lineage for selected saved scientific reports.

Called by the maintained scientific-report Study transfer resolver. Source
objects are read through its raw CAS; no source views, reports, imports, native
revisions or replacement scientific identities are created.
"""
from __future__ import annotations

from copy import deepcopy
from pathlib import Path
import re

from .common import digest, held, identifier
from .implementation import ImplementationStore, _file_lock, _same_json
from .implementation_schema import (
    COLLECTIONS, ImplementationError, _safe_id, document_digest, validate_plan,
)
from .portable import member_name
from .portable_implementation import report_edition

CONTEXT_SCHEMA = "upstate.implementation-plan-report-context/v1"
CONTEXT_EDITION = "implementation-plan-report-observed-context-20261013-v1"
RECEIPT_SCHEMA = "upstate.study-implementation-report/v1"
PLAN_ROOT = "implementation/plans"
HEX = re.compile(r"[0-9a-f]{64}")
PROTECTED = {
    "candidates": ("source", "modeled_benefits", "area_ha"),
    "source_links": ("kind", "reference", "snapshot", "source_digest",
                     "source_id", "source_schema", "field_mapping", "sha256", "size_bytes"),
}


class _OriginalStore(ImplementationStore):
    """Reuse native read/validation methods without the constructor's mkdir/fsync."""
    def __init__(self, workspace):
        self.root = Path(workspace.root).resolve()
        self.base = self.root / PLAN_ROOT
        if self.base.is_symlink() or not self.base.is_dir():
            raise ImplementationError("The report needs its original native plan bank.")


def _relative(value):
    if not isinstance(value, str):
        raise ValueError("An original report member needs its retained relative path.")
    member_name(value)
    return value


def _expected(value, *, size_key="bytes"):
    if not isinstance(value, dict):
        raise ValueError("An original report member needs its exact byte descriptor.")
    size = value.get(size_key)
    if type(size) is not int or size < 0:
        raise ValueError("An original report member has an invalid byte count.")
    return {"bytes": size, "sha256": identifier(value.get("sha256"))}


def _records(closure):
    if not hasattr(closure, "implementation_report_records"):
        closure.implementation_report_records = {}
    return closure.implementation_report_records


def _member_index(closure, entry):
    result = {}
    for item in [entry["body"], *entry.get("companions", [])]:
        name = _relative(item.get("view_path", item.get("filename")))
        if name in result:
            raise ValueError("The original plan report repeats a source member.")
        closure.add_file(item["object"], _expected(item))
        result[name] = item
    return result


def _json_member(closure, members, name):
    item = members.get(name)
    if item is None:
        raise ValueError("The original plan report lost its source member: " + name)
    return closure.read(item["object"])


def _source_identity(closure, entry):
    metadata = entry.get("metadata", {})
    if metadata.get("report_context_kind") != "implementation-plan-report":
        return None
    if entry.get("kind") != "document" or entry.get("role") != "OBSERVED_CONTEXT":
        raise ValueError("The original plan report must remain its declared document source.")
    identity = metadata.get("implementation_plan")
    if (not isinstance(identity, dict) or identity.get("schema") != CONTEXT_SCHEMA
            or identity.get("edition") != CONTEXT_EDITION):
        raise ValueError("The saved plan report needs its original producer identity.")
    key = digest(identity)
    if entry.get("id") != "implementation-plan-report-" + key:
        raise ValueError("The plan report source ID differs from its original identity.")
    binding = identity.get("plan_binding", {})
    plan_id = _safe_id(binding.get("plan_id"), "original plan ID")
    report_id = identifier(identity.get("report_id"))
    if entry.get("uri") != ("urn:upstate:implementation-plan-report:"
                            + str(identity.get("project_id")) + ":" + report_id):
        raise ValueError("The original plan report URI identifies another edition.")
    members = _member_index(closure, entry)
    recipe = closure.read(entry["body"]["object"])
    if (recipe.get("schema") != "upstate.observed-report/v1"
            or recipe.get("edition") != CONTEXT_EDITION
            or recipe.get("implementation_plan_identity") != identity
            or recipe.get("report_context_kind") != "implementation-plan-report"
            or _json_member(closure, members, "context-identity.json") != identity):
        raise ValueError("The report recipe differs from its retained original identity.")
    declared = {}
    for item in recipe.get("inputs", []):
        name = _relative(item.get("path"))
        if name in declared or name not in members or _expected(item) != _expected(members[name]):
            raise ValueError("The plan report recipe differs from its original input files.")
        declared[name] = item
    recipe_name = _relative(entry["body"].get("view_path", entry["body"].get("filename")))
    if set(declared) != set(members) - {recipe_name}:
        raise ValueError("The plan report lost its complete original companion inventory.")
    plan = validate_plan(_json_member(closure, members, "report/plan.json"))
    if (plan["id"] != plan_id or plan["revision"] != binding.get("revision")
            or plan["title"] != binding.get("title")
            or document_digest(plan) != binding.get("document_digest")):
        raise ValueError("The source plan differs from its exact saved revision.")
    manifest = _json_member(closure, members, "report/manifest.json")
    if (members["report/manifest.json"]["sha256"] != report_id
            or manifest.get("schema") != "upstate.implementation-report/v1"
            or manifest.get("plan_id") != plan_id
            or manifest.get("revision") != plan["revision"]
            or manifest.get("document_digest") != binding["document_digest"]
            or manifest.get("as_of") != identity.get("as_of")):
        raise ValueError("The source report manifest differs from its original native edition.")
    expected_members = {}
    for item in manifest.get("files", []):
        name = _relative(item.get("name"))
        if "/" in name or name in expected_members or name == "manifest.json":
            raise ValueError("Original report filenames must be unique native filenames.")
        original = members.get("report/" + name)
        if original is None or _expected(original) != _expected(item, size_key="size_bytes"):
            raise ValueError("The original report lost a native report file: " + name)
        expected_members[name] = _expected(original)
    if not {"plan.json", "summary.json", "report.html"}.issubset(expected_members):
        raise ValueError("The original report lost its plan, summary or readable report.")
    expected_members["manifest.json"] = _expected(members["report/manifest.json"])
    original_members = identity.get("members")
    expected_roster = [{"name": name, **value} for name, value in sorted(expected_members.items())]
    if original_members != expected_roster:
        raise ValueError("The report identity differs from the exact original file roster.")
    summary = _json_member(closure, members, "report/summary.json")
    if summary.get("as_of") != identity["as_of"]:
        raise ValueError("The original plan report changed its report date.")
    inventory = _json_member(closure, members, "original/attachment-inventory.json")
    if inventory != identity.get("original_local_attachments") or not isinstance(inventory, list):
        raise ValueError("The original plan report changed its attachment inventory.")
    links = {row["id"]: row for row in plan["source_links"]}
    for item in inventory:
        link = links.get(item.get("source_link_id"))
        if (link is None or link.get("kind") != "local_file"
                or any(item.get(left) != link.get(right) for left, right in (
                    ("reference", "reference"), ("sha256", "sha256"),
                    ("bytes", "size_bytes"), ("label", "label")))):
            raise ValueError("The attachment inventory differs from the original plan source.")
        if item.get("state") == "retained":
            name = "original/" + _relative(item.get("retained_path"))
            if name not in members or _expected(members[name]) != _expected(item):
                raise ValueError("The plan report lost an original attached file.")
    return key, identity, plan, members



def _operations(closure):
    if not hasattr(closure, "implementation_report_operation_locks"):
        closure.implementation_report_operation_locks = set()
    return closure.implementation_report_operation_locks


def _lab_history(closure, store, history):
    """Retain existing original laboratory operations explicitly named by plan history."""
    visited = set()
    for event in history:
        plan = store._read_record(Path(event["revision_ref"]))["plan"]
        for item in plan.get("field12_lab_imports", []):
            if item.get("schema") != "upstate.implementation-lab-import/v1":
                continue
            key = identifier(item.get("operation_id"))
            if key in visited:
                continue
            visited.add(key)
            prefix = "implementation/lab-imports/" + key
            directory = closure.root / prefix
            if not directory.exists() and not directory.is_symlink():
                # An imported plan may contain an original laboratory history
                # from another machine. Its attached audit/source remains native.
                continue
            identity = closure.read(prefix + "/identity.json")
            if (digest(identity) != key or identity.get("project_id") != closure.workspace.project["id"]
                    or identity.get("plan", {}).get("id") != plan["id"]
                    or identity["plan"].get("revision") != item.get("base_revision")
                    or identity["plan"].get("sha256") != item.get("base_document_digest")
                    or identity.get("source", {}).get("sha256") != item.get("source_sha256")
                    or digest(identity.get("mapping")) != item.get("mapping_sha256")):
                raise ValueError("The native laboratory history changed its original source operation.")
            audit = closure.read(prefix + "/row-decisions.json")
            if audit.get("identity") != identity:
                raise ValueError("The native laboratory row decisions changed their original intent.")
            if (directory / "import.json").exists():
                retained = closure.read(prefix + "/import.json")
                original = store.get(plan["id"], retained.get("applied_revision"))
                if (retained.get("schema") != "upstate.implementation-lab-import/v1"
                        or retained.get("operation_id") != key
                        or retained.get("plan_id") != plan["id"]
                        or retained.get("applied_revision") != item.get("applied_revision")
                        or retained.get("applied_document_digest") != document_digest(original)):
                    raise ValueError("The laboratory receipt differs from its native applied revision.")
                for descriptor in retained.get("files", []):
                    closure.add_file(_relative(descriptor.get("path")), _expected(descriptor))
            _operations(closure).add(prefix + "/operation.lock")
            closure.tree(prefix)


def _recipe_members(closure, entry):
    if entry.get("kind") != "document" or entry.get("role") != "OBSERVED_CONTEXT":
        raise ValueError("An original Implementation report must be its declared source document.")
    members = _member_index(closure, entry)
    recipe = closure.read(entry["body"]["object"])
    if recipe.get("schema") != "upstate.observed-report/v1":
        raise ValueError("The original Implementation report has another source schema.")
    declared = {}
    for item in recipe.get("inputs", []):
        name = _relative(item.get("path"))
        if name in declared or name not in members or _expected(item) != _expected(members[name]):
            raise ValueError("The original report input changed: " + name)
        declared[name] = item
    body_name = _relative(entry["body"].get("view_path", entry["body"].get("filename")))
    if set(declared) != set(members) - {body_name}:
        raise ValueError("The original report lost its complete source-member inventory.")
    return recipe, members


def _outcome_source_identity(closure, entry):
    identity = entry.get("metadata", {}).get("implementation_outcome")
    if identity is None:
        return None
    if (not isinstance(identity, dict)
            or identity.get("schema") != "upstate.implementation-outcome-context/v1"
            or identity.get("edition") != "implementation-outcome-observed-context-20261013-v1"):
        raise ValueError("The original outcome source changed its producer identity.")
    key = digest(identity)
    outcome_id = identifier(identity.get("outcome_id"))
    if (entry.get("id") != "implementation-outcome-" + key
            or entry.get("uri") != "urn:upstate:implementation-outcome:"
               + str(identity.get("project_id")) + ":" + outcome_id):
        raise ValueError("The outcome source names another original retained result.")
    recipe, members = _recipe_members(closure, entry)
    if (recipe.get("edition") != identity["edition"]
            or recipe.get("implementation_outcome_identity") != identity
            or _json_member(closure, members, "context-identity.json") != identity):
        raise ValueError("The outcome recipe differs from its complete original identity.")
    plan = validate_plan(_json_member(closure, members, "outcome/plan.json"))
    binding = identity["plan_binding"]
    if any(binding.get(name) != value for name, value in {
            "plan_id": plan["id"], "revision": plan["revision"], "title": plan["title"],
            "document_digest": document_digest(plan)}.items()):
        raise ValueError("The outcome source changed its original saved plan.")
    manifest = _json_member(closure, members, "outcome/manifest.json")
    result = _json_member(closure, members, "outcome/outcomes.json")
    if (members["outcome/manifest.json"]["sha256"] != outcome_id
            or manifest.get("schema") != "upstate.implementation-report/v1"
            or result.get("plan_binding") != binding
            or result.get("method") != identity.get("method")
            or result.get("selection_digest") != identity.get("selection_digest")
            or digest(result.get("selection")) != identity["selection_digest"]
            or manifest.get("selection_digest") != identity["selection_digest"]
            or recipe.get("implementation_outcome_selection") != result.get("selection")
            or any(manifest.get(name) != binding[name]
                   for name in ("plan_id", "revision", "document_digest"))):
        raise ValueError("The original outcome result, selection and report differ.")
    native = {"manifest.json": _expected(members["outcome/manifest.json"])}
    for item in manifest.get("files", []):
        name = _relative(item.get("name"))
        if "/" in name or name in native:
            raise ValueError("The original outcome repeats a report member.")
        source = members.get("outcome/" + name)
        if source is None or _expected(source) != _expected(item, size_key="size_bytes"):
            raise ValueError("The original outcome lost a report member: " + name)
        native[name] = _expected(source)
    required = {"plan.json", "summary.json", "report.html", "implementation-plan.html",
                "outcomes.json", "outcome_rows.csv", "period_summary.csv",
                "sampled_dates.csv", "matched_controls.csv"}
    if (not required.issubset(native)
            or identity.get("members") != [{"name": name, **value} for name, value in sorted(native.items())]):
        raise ValueError("The outcome source lost its complete native report roster.")
    if _json_member(closure, members, "original/attachment-inventory.json") != identity["original_local_attachments"]:
        raise ValueError("The outcome source changed its original local attachment inventory.")
    return key, identity, plan, members


def _field_source_identity(closure, entry):
    if not str(entry.get("id", "")).startswith("field-observed-report-"):
        return None
    recipe, members = _recipe_members(closure, entry)
    identity = recipe.get("implementation_observation_identity")
    if (not isinstance(identity, dict)
            or identity.get("schema") != "upstate.implementation-observation-report-source/v1"):
        raise ValueError("The field report needs its original saved-revision identity.")
    key = digest(identity)
    if entry.get("id") != "field-observed-report-" + key[:24]:
        raise ValueError("The original field report changed its operation ID.")
    binding = identity["plan"]
    expected_uri = ("urn:upstate:implementation:" + identity["project_id"] + ":"
                    + binding["id"] + ":" + str(binding["revision"]) + ":" + binding["sha256"])
    if entry.get("uri") != expected_uri or entry.get("metadata", {}).get("implementation_plan") != binding:
        raise ValueError("The field source names another native saved revision.")
    plan = validate_plan(_json_member(closure, members, "field/original/plan.json"))
    revision = _json_member(closure, members, "field/original/revision.json")
    if (binding != {"id": plan["id"], "revision": plan["revision"],
                    "sha256": document_digest(plan), "title": plan["title"]}
            or not _same_json(revision.get("plan"), plan)
            or _expected(members["field/original/revision.json"]) != _expected(identity["revision_file"])
            or _json_member(closure, members, "field/identity.json") != identity
            or _json_member(closure, members, "original-delivery-selection.json") != identity["original_delivery_selection"]
            or _json_member(closure, members, "field/original/attachment-inventory.json") != identity["attachment_inventory"]):
        raise ValueError("The field report changed its original revision, context or source files.")
    return key, identity, plan, members, recipe


def _field_operation(closure, collection_id, entry, key, identity, members, recipe):
    prefix = "implementation/observed-context/" + key
    retained = closure.read(prefix + "/import.json")
    report = retained.get("report_source", {})
    if (retained.get("schema") != "upstate.implementation-observation-context/v1"
            or retained.get("operation_id") != key or retained.get("plan") != identity["plan"]
            or retained.get("state") != "imported"
            or closure.read(prefix + "/identity.json") != identity
            or report.get("source_collection_id") != collection_id or report.get("source_id") != entry["id"]
            or report.get("directory") != prefix + "/report"
            or retained.get("source_collection_id") != recipe.get("implementation_source_collection_id")
            or retained.get("observation_ids") != recipe.get("implementation_observation_ids")):
        raise ValueError("The original field source lost its native import receipt.")
    for descriptor in retained.get("files", []):
        path = _relative(descriptor.get("path"))
        if not path.startswith(prefix + "/"):
            raise ValueError("The field receipt changed its retained source directory.")
        closure.add_file(path, _expected(descriptor))
    for name, item in members.items():
        closure.add_file(prefix + "/report/" + name, _expected(item))
    declared = report.get("binding", {})
    candidates = declared.get("reports", []) if declared.get("schema") == "upstate.observed-report-set-binding/v2" else [declared]
    matches = [row for row in candidates if row.get("source_collection_id") == collection_id
               and row.get("source_id") == entry["id"]]
    if len(matches) != 1:
        raise ValueError("The native field report lost its original ordered source binding.")
    binding = matches[0]
    if (binding.get("source_collection_id") != collection_id
            or binding.get("source_id") != entry["id"]
            or binding.get("body_sha256") != entry["body"]["sha256"]
            or binding.get("member_sha256") != {name: members[name]["sha256"] for name in sorted(members)}):
        raise ValueError("The native field report changed its exact original source binding.")
    closure.need("sources", identifier(retained["source_collection_id"]), "Original field source collection")
    for key_id in retained["observation_ids"]:
        key_id = identifier(key_id)
        observed = closure.read("observations/" + key_id + ".json")
        if (digest(observed) != key_id
                or observed.get("metadata", {}).get("implementation_observation_operation") != key):
            raise ValueError("The original field observation edition changed.")
        closure.need("observations", key_id, "Original native field observations")
    path = _relative(report.get("delivery_selection_path"))
    if path != prefix + "/report/delivery-selection.json" or closure.read(path) != report.get("delivery_selection"):
        raise ValueError("The original field delivery selection changed.")
    closure._source_refs(identity["original_delivery_selection"], "Original field report context")
    closure._source_refs(report["delivery_selection"], "Original completed field report sources")
    _operations(closure).add(prefix + "/operation.lock")
    closure.tree(prefix)


def _native_sources(closure, plan, previous_links, event):
    """Keep declared original files and original Monitoring lineage when available."""
    unavailable = []
    for link in plan["source_links"]:
        if link.get("kind") == "local_file" and link.get("reference"):
            reference = link["reference"]
            managed = reference.startswith(PLAN_ROOT + "/" + plan["id"] + "/attachments/")
            required = event.get("operation") == "attach_file" and link["id"] not in previous_links
            if required and not managed:
                raise ValueError("The native attachment left its original saved plan bank.")
            complete = (isinstance(link.get("sha256"), str) and HEX.fullmatch(link["sha256"])
                        and type(link.get("size_bytes")) is int and link["size_bytes"] >= 0)
            if not complete:
                if required:
                    raise ValueError("A native attachment lost its original byte descriptor.")
                unavailable.append({"id": link["id"], "reference": reference,
                                    "state": "original_reference_without_complete_file_descriptor"})
            else:
                reference = _relative(reference)
                path = closure.root / reference
                if path.exists() or path.is_symlink():
                    closure.add_file(reference, _expected(link, size_key="size_bytes"))
                elif required:
                    raise ValueError("The native plan lost an original attached file: " + reference)
                else:
                    unavailable.append({"id": link["id"], "reference": reference,
                                        "state": "original_reference_file_unavailable"})
        if link.get("kind") == "monitoring_campaign":
            snapshot = link.get("snapshot", {})
            revision = snapshot.get("campaign_revision")
            if not isinstance(revision, dict) or digest(snapshot) != link.get("source_digest"):
                raise ValueError("The native fieldwork changed its original campaign snapshot.")
            key = identifier(link.get("source_id"))
            if revision.get("id") != key or link.get("reference") != "monitoring_revisions/" + key + ".json":
                raise ValueError("The fieldwork campaign names another original revision.")
            if closure.exists("monitoring_revisions", key):
                original = closure.read("monitoring_revisions/" + key + ".json")
                if {**original, "id": key} != revision:
                    raise ValueError("The fieldwork snapshot differs from the native Monitoring revision.")
                closure.need("monitoring_revisions", key, "Original saved fieldwork campaign")
                campaign_id = identifier(revision.get("campaign_id"))
                closure.need("monitoring_heads", campaign_id, "Editable original fieldwork campaign",
                             required=False)
            else:
                closure.need("monitoring_revisions", key, "Contained original fieldwork campaign",
                             required=False)
    return unavailable


def _native_plan(closure, identity, contained_plan):
    plan_id = identity["plan_binding"]["plan_id"]
    prefix = PLAN_ROOT + "/" + plan_id
    store = _OriginalStore(closure.workspace)
    directory = store._directory(plan_id)
    history = store.history(plan_id)
    if not history:
        raise ValueError("The native report needs its original saved plan history.")
    frozen = {name: {} for name in PROTECTED}
    unavailable = {}
    previous_links = set()
    creation = None
    for path in store._revision_paths(directory):
        relative = path.relative_to(closure.root).as_posix()
        record = closure.read(relative)
        plan = validate_plan(record["plan"])
        if creation is not None and creation != plan["created_at"]:
            raise ValueError("The native plan changed its original creation time.")
        creation = plan["created_at"]
        for collection, fields in PROTECTED.items():
            for row in plan[collection]:
                value = {field: row.get(field) for field in fields}
                previous = frozen[collection].get(row["id"])
                if previous is not None and not _same_json(previous, value):
                    raise ValueError("The native plan reused an original source ID with changed evidence.")
                frozen[collection][row["id"]] = value
        for row in _native_sources(closure, plan, previous_links, record["event"]):
            unavailable[row["id"]] = row
        previous_links = {row["id"] for row in plan["source_links"]}
    selected = store.get(plan_id, identity["plan_binding"]["revision"])
    if not _same_json(selected, contained_plan):
        raise ValueError("The report's original plan differs from its exact native saved revision.")
    selected_report_id = identity.get("report_id", identity.get("outcome_id"))
    if selected_report_id is not None:
        report = report_edition(store, directory / "reports" / selected_report_id)
        if (report["id"] != selected_report_id
                or report["document_digest"] != identity["plan_binding"]["document_digest"]
                or ("as_of" in identity and report["as_of"] != identity["as_of"])):
            raise ValueError("The original report differs from its native retained edition.")
        for item in identity["members"]:
            closure.add_file(prefix + "/reports/" + selected_report_id + "/" + item["name"],
                             _expected(item))
    # Retain every report edition; the selected source may be a field-observation
    # context without any native report yet.
    report_root = directory / "reports"
    if report_root.is_symlink():
        raise ValueError("The native report bank must be an ordinary directory.")
    for folder in sorted(report_root.iterdir()) if report_root.exists() else []:
        if HEX.fullmatch(folder.name):
            original_report = report_edition(store, folder)
            if original_report["id"] != folder.name or original_report["plan_id"] != plan_id:
                raise ValueError("A retained native report changed its original identity.")
    _lab_history(closure, store, history)
    deployments = []
    deployment_root = directory / "deployments"
    if deployment_root.exists() or deployment_root.is_symlink():
        if deployment_root.is_symlink() or not deployment_root.is_dir():
            raise ValueError("The original deployment packet bank must be an ordinary directory.")
        for folder in sorted(deployment_root.iterdir()):
            if not HEX.fullmatch(folder.name):
                continue
            if (folder / "deployment.json").exists():
                from .field_deployment import inspect
                inspect(closure.workspace, plan_id, folder.name)
                deployments.append(folder.name)
            elif (folder / "intent.json").exists():
                intent = closure.read(folder.relative_to(closure.root).as_posix() + "/intent.json")
                if (digest(intent) != folder.name
                        or intent.get("workspace_id") != closure.workspace.project["id"]
                        or intent.get("plan", {}).get("plan_id") != plan_id):
                    raise ValueError("The partial deployment changed its original native intent.")
    closure.tree(prefix)
    current = store.get(plan_id)
    return {
        "plan_id": plan_id, "title": current["title"], "revision": current["revision"],
        "document_digest": document_digest(current), "revision_count": len(history),
        "selected_revision": selected["revision"],
        "selected_document_digest": document_digest(selected),
        "selected_report_id": selected_report_id,
        "record_counts": {name: len(current[name]) for name in COLLECTIONS},
        "retained_deployment_ids": deployments,
        "unavailable_original_references": sorted(unavailable.values(), key=lambda row: row["id"]),
    }


def _native_source_receipt(closure, collection_id, entry, key, identity, members, *, family="report"):
    prefix = "implementation/" + ("outcome-context/" if family == "outcome" else "report-context/") + key
    schema = identity["schema"]
    receipt = closure.read(prefix + "/source-receipt.json")
    if (receipt.get("schema") != schema or receipt.get("source_identity") != identity
            or receipt.get("directory") != prefix
            or receipt.get("source_collection_id") != collection_id
            or receipt.get("source_id") != entry["id"]):
        raise ValueError("The original plan report receipt names another imported source.")
    original_binding = receipt.get("binding", {})
    expected_binding = {
        "source_collection_id": collection_id, "source_id": entry["id"],
        "body_sha256": entry["body"]["sha256"],
        "member_sha256": {name: members[name]["sha256"] for name in sorted(members)},
    }
    if any(original_binding.get(name) != value for name, value in expected_binding.items()):
        raise ValueError("The original plan report receipt changed its exact source binding.")
    collection = closure.read("sources/" + collection_id + ".json")
    if collection.get("schema") != "upstate.sources/v1" or digest(collection) != collection_id:
        raise ValueError("The original plan report source collection changed.")
    expected_files = {prefix + "/" + name: _expected(item) for name, item in members.items()}
    expected_files[prefix + "/model-sources.json"] = _expected(collection["original_manifest"])
    retained_files = {}
    for descriptor in receipt.get("files", []):
        relative = _relative(descriptor.get("path"))
        if (relative in retained_files or relative not in expected_files
                or _expected(descriptor) != expected_files[relative]):
            raise ValueError("A plan report receipt changed an original source file.")
        closure.add_file(relative, expected_files[relative])
        retained_files[relative] = descriptor
    if set(retained_files) != set(expected_files):
        raise ValueError("The plan report receipt lost its complete original source files.")
    # All original handoffs are retained, including their selected source order.
    handoffs = closure.root / prefix / "handoffs"
    if handoffs.exists() or handoffs.is_symlink():
        if handoffs.is_symlink() or not handoffs.is_dir():
            raise ValueError("The original report handoffs must remain ordinary directories.")
        for folder in sorted(handoffs.iterdir()):
            if not HEX.fullmatch(folder.name):
                continue
            handoff = closure.read(prefix + "/handoffs/" + folder.name + "/handoff.json")
            original = handoff.get("identity")
            if (handoff.get("schema") != schema or not isinstance(original, dict)
                    or digest(original) != folder.name or handoff.get("operation_id") != folder.name
                    or original.get("source_identity") != identity or handoff.get("state") != "imported"
                    or handoff.get("source_collection_id") != collection_id
                    or handoff.get("source_id") != entry["id"]):
                raise ValueError("The saved plan report handoff changed its original identity.")
            selection = handoff.get("delivery_selection")
            if selection is not None:
                path = _relative(handoff.get("delivery_selection_path"))
                if not path.startswith(prefix + "/") or closure.read(path) != selection:
                    raise ValueError("The original ordered report selection changed.")
                closure._source_refs(selection, "Original ordered plan report sources")
            closure._source_refs(original.get("original_delivery_selection"),
                                 "Original prior report sources")
    closure.tree(prefix)



def _dispatch_source_identity(closure, entry):
    """Resolve the retained laboratory recipe without recomputing its results."""
    metadata = entry.get("metadata", {})
    if not str(entry.get("id", "")).startswith("laboratory-report-"):
        return None
    recipe, members = _recipe_members(closure, entry)
    identity = recipe.get("implementation_dispatch_report_identity")
    if (not isinstance(identity, dict)
            or identity.get("schema") != "upstate.implementation-lab-dispatch-report-identity/v1"):
        raise ValueError("The laboratory report needs its original dispatch identity.")
    key = digest(identity)
    dispatch_id = identifier(identity.get("dispatch_id"))
    if (entry.get("id") != "laboratory-report-" + key[:24]
            or entry.get("uri") != "urn:upstate:field-laboratory-report:" + key
            or metadata.get("laboratory_report_operation") != key
            or metadata.get("laboratory_dispatch_id") != dispatch_id
            or metadata.get("implementation_plan") != identity.get("plan")
            or _json_member(closure, members, "laboratory/identity.json") != identity):
        raise ValueError("The laboratory report changed its source or dispatch identity.")
    plan = validate_plan(_json_member(closure, members, "laboratory/current/plan.json"))
    binding = identity["plan"]
    if any(binding.get(name) != value for name, value in {
            "id": plan["id"], "revision": plan["revision"], "title": plan["title"],
            "document_digest": document_digest(plan)}.items()):
        raise ValueError("The laboratory report changed its exact saved plan revision.")
    revision = _json_member(closure, members, "laboratory/current/revision.json")
    reconciliation = _json_member(closure, members, "laboratory/reconciliation.json")
    package = _json_member(closure, members, "laboratory/dispatch-package.json")
    if (not _same_json(revision.get("plan"), plan)
            or _expected(members["laboratory/current/revision.json"]) != _expected(identity["revision_file"])
            or digest(reconciliation) != identity.get("reconciliation_sha256")
            or reconciliation.get("plan") != binding
            or reconciliation.get("dispatch_id") != dispatch_id
            or package.get("dispatch_id") != dispatch_id
            or package.get("plan") != identity.get("dispatch_plan")
            or package.get("files") != identity.get("package_files")
            or _json_member(closure, members, "original-delivery-selection.json")
               != identity.get("original_delivery_selection")
            or _json_member(closure, members, "laboratory/current/attachment-inventory.json")
               != identity.get("attachment_inventory")):
        raise ValueError("The laboratory report lost its original revision, requests or result reconciliation.")
    for item in identity["package_files"]:
        name = "laboratory/dispatch/" + _relative(item.get("path"))
        if name not in members or _expected(members[name]) != _expected(item):
            raise ValueError("The laboratory report lost an original request package member.")
    return key, identity, plan, members


def _dispatch_operation(closure, collection_id, entry, key, identity, members):
    """Retain the existing editable request and the completed source operation."""
    from .implementation_lab_dispatch import dispatch_files
    plan_id, dispatch_id = identity["plan"]["id"], identity["dispatch_id"]
    package, files = dispatch_files(closure.workspace, plan_id, dispatch_id)
    if package != _json_member(closure, members, "laboratory/dispatch-package.json"):
        raise ValueError("The native laboratory request differs from its retained report source.")
    store = _OriginalStore(closure.workspace)
    original = store.get(plan_id, identity["dispatch_plan"]["revision"])
    if (document_digest(original) != identity["dispatch_plan"]["document_digest"]
            or original != _json_member(closure, members, "laboratory/dispatch/original-plan.json")):
        raise ValueError("The laboratory request lost its original saved sample revision.")
    dispatch_prefix = "implementation/laboratory-dispatch/" + dispatch_id
    for descriptor, path in files:
        relative = path.relative_to(closure.root).as_posix()
        if relative != dispatch_prefix + "/" + _relative(descriptor["path"]):
            raise ValueError("The laboratory package left its original native directory.")
        closure.add_file(relative, _expected(descriptor))
    closure.read(dispatch_prefix + "/receipt.json")
    _operations(closure).add(dispatch_prefix + "/operation.lock")
    closure.tree(dispatch_prefix)
    prefix = "implementation/laboratory-reports/" + key
    retained = closure.read(prefix + "/import.json")
    report = retained.get("report_source", {})
    if (retained.get("schema") != "upstate.implementation-lab-dispatch-report/v1"
            or retained.get("operation_id") != key or retained.get("state") != "imported"
            or retained.get("plan") != identity["plan"]
            or retained.get("dispatch_plan") != identity["dispatch_plan"]
            or retained.get("dispatch_id") != dispatch_id
            or retained.get("source_collection_id") != collection_id
            or closure.read(prefix + "/identity.json") != identity
            or report.get("source_collection_id") != collection_id
            or report.get("source_id") != entry["id"]
            or report.get("directory") != prefix + "/report"
            or report.get("delivery_selection") != retained.get("delivery_selection")):
        raise ValueError("The laboratory report lost its original native registration.")
    for item in retained.get("files", []):
        relative = _relative(item.get("path"))
        if not relative.startswith(prefix + "/"):
            raise ValueError("A laboratory report member left its original operation.")
        closure.add_file(relative, _expected(item))
    for name, item in members.items():
        closure.add_file(prefix + "/report/" + name, _expected(item))
    declared = report.get("binding", {})
    choices = declared.get("reports", []) if declared.get("schema") == "upstate.observed-report-set-binding/v2" else [declared]
    found = [row for row in choices if row.get("source_collection_id") == collection_id
             and row.get("source_id") == entry["id"]]
    expected = {"body_sha256": entry["body"]["sha256"],
                "member_sha256": {name: members[name]["sha256"] for name in sorted(members)}}
    if (len(found) != 1 or any(found[0].get(name) != value for name, value in expected.items())
            or report.get("original_binding") != identity.get("original_observed_context_binding")):
        raise ValueError("The native laboratory report changed its original ordered source binding.")
    selection_path = prefix + "/report/delivery-selection.json"
    if (report.get("delivery_selection_path") != selection_path
            or closure.read(selection_path) != report.get("delivery_selection")):
        raise ValueError("The laboratory report lost its retained complete source selection.")
    closure._source_refs(identity.get("original_delivery_selection"), "Original laboratory report context")
    closure._source_refs(report["delivery_selection"], "Original completed laboratory report sources")
    # Retain editable producer history behind the nested recipe; its scientific
    # sections already reside in the laboratory source and are not appended again.
    from . import observed_context
    for choice in observed_context.source_choices(identity.get("original_delivery_selection") or {}):
        original_id = identifier(choice["source_collection_id"])
        original_collection = closure.read("sources/" + original_id + ".json")
        if original_collection.get("schema") != "upstate.sources/v1" or digest(original_collection) != original_id:
            raise ValueError("The inherited laboratory context changed its original source collection.")
        originals = [item for item in original_collection["entries"] if item["id"] == choice["source_id"]]
        if len(originals) != 1 or (original_id, choice["source_id"]) == (collection_id, entry["id"]):
            raise ValueError("The laboratory report has an invalid inherited source.")
        include_source(closure, original_id, originals[0])
    _operations(closure).add(prefix + "/operation.lock")
    closure.tree(prefix)
    return {"dispatch_id": dispatch_id, "operation_id": key,
            "request_revision": identity["dispatch_plan"]["revision"],
            "result_revision": identity["plan"]["revision"],
            "source_collection_id": collection_id, "source_id": entry["id"],
            "delivery_selection": deepcopy(report["delivery_selection"]),
            "delivery_selection_path": selection_path}


def include_source(closure, collection_id, entry):
    """Join declared plan, outcome and field sources to their native editable lineage."""
    metadata = entry.get("metadata", {})
    family = "report"
    if metadata.get("report_context_kind") == "implementation-plan-report":
        parsed = _source_identity(closure, entry)
    elif metadata.get("implementation_outcome") is not None:
        family, parsed = "outcome", _outcome_source_identity(closure, entry)
    elif str(entry.get("id", "")).startswith("field-observed-report-"):
        family, parsed = "field", _field_source_identity(closure, entry)
    elif str(entry.get("id", "")).startswith("laboratory-report-"):
        captured = getattr(closure, "implementation_source_keys", None)
        if captured is not None and (collection_id, entry["id"]) not in captured:
            return False  # Preserve the actual dependency set of older received Studies.
        family, parsed = "laboratory", _dispatch_source_identity(closure, entry)
    else:
        return False
    key, identity, plan, members = parsed[:4]
    collection_id = identifier(collection_id)
    token = collection_id + ":" + entry["id"]
    if token in _records(closure):
        return True
    row = {"schema": RECEIPT_SCHEMA, "source_collection_id": collection_id,
           "source_id": entry["id"], "source_identity": deepcopy(identity),
           "source_key": key, "source_family": family, "native_plan": None}
    if identity["project_id"] == closure.workspace.project["id"]:
        native_identity = identity
        if family in {"field", "laboratory"}:
            native_identity = {"plan_binding": {
                "plan_id": plan["id"], "revision": plan["revision"], "title": plan["title"],
                "document_digest": document_digest(plan)}}
        row["native_plan"] = _native_plan(closure, native_identity, plan)
        if family == "field":
            _field_operation(closure, collection_id, entry, key, identity, members, parsed[4])
        elif family == "laboratory":
            row["laboratory"] = _dispatch_operation(closure, collection_id, entry, key, identity, members)
        else:
            _native_source_receipt(closure, collection_id, entry, key, identity, members, family=family)
            if family == "outcome":
                from .implementation_outcomes import _retained_result
                store = _OriginalStore(closure.workspace)
                original = _retained_result(store, store._directory(plan["id"]) / "reports" / identity["outcome_id"])
                if (original["plan_binding"] != identity["plan_binding"]
                        or original["selection_digest"] != identity["selection_digest"]
                        or original["method"] != identity["method"]):
                    raise ValueError("The outcome source differs from its native retained result.")
    _records(closure)[token] = row
    return True


def lock_paths(closure):
    """The native plan-bank lock precedes the selected native per-plan locks."""
    plans = sorted({row["native_plan"]["plan_id"] for row in _records(closure).values()
                    if row.get("native_plan") is not None})
    if not plans:
        return []
    return ["implementation/.plans.lock", *[PLAN_ROOT + "/" + key + "/.lock" for key in plans]]


def capture_locks(stack, closure, already):
    """Use the original native cross-platform lock, without a second lock format."""
    # Original laboratory writers take their operation lock before the plan
    # lock. Preserve that order for every discovered original import.
    for relative in sorted(_operations(closure)):
        token = ("implementation-report-operation", relative)
        if token not in already:
            stack.enter_context(held(closure.root / relative, blocking=False))
            already.add(token)
    for relative in lock_paths(closure):
        token = ("implementation-report-owner", relative)
        if token not in already:
            stack.enter_context(_file_lock(closure.root / relative, blocking=False))
            already.add(token)


def receipt(closure):
    return [deepcopy(row) for unused, row in sorted(_records(closure).items())]


def verify_receipt(closure, captured):
    """Exact source/revision custody while allowing later native edits and packets."""
    current = {(row["source_collection_id"], row["source_id"]): row for row in receipt(closure)}
    for original in captured:
        key = (original["source_collection_id"], original["source_id"])
        actual = current.get(key)
        if actual is None or any(actual.get(name) != value for name, value in original.items()
                                 if name != "native_plan"):
            raise ValueError("The received study lost an original Implementation report source.")
        wanted, observed = original.get("native_plan"), actual.get("native_plan")
        if wanted is None:
            if observed is not None:
                raise ValueError("The received foreign report was rebound to a local plan.")
            continue
        if observed is None or any(observed.get(name) != wanted.get(name) for name in
                                   ("plan_id", "selected_revision", "selected_document_digest",
                                    "selected_report_id")):
            raise ValueError("The received plan report lost its original editable revision.")
        if not set(wanted.get("retained_deployment_ids", [])).issubset(
                observed.get("retained_deployment_ids", [])):
            raise ValueError("The received plan lost an original deployment packet.")
