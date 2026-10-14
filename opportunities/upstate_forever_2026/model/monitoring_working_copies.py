"""Immutable Sampling working copies beside the original scientific records.

TokenJunkieLabs. Drafts may be incomplete. Saving or opening a draft never
compiles recommendations, runs a solver, or resumes a retained queue request.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import html
import json
import math
import re
import uuid
from pathlib import Path

from .monitoring_common import ContractError, canonical_bytes, digest, held, atomic_json, load_json
from . import monitoring_recommendations as recommendations

COLLECTION = "monitoring_working_copies"
SCHEMA = "upstate.sampling-working-copy/v1"
RECORD_SCHEMA = "upstate.monitoring_working_copies/v1"
MAX_BYTES = 8 * 1024 * 1024
FIELDS = {"schema", "project_id", "workspace_key", "context_id", "context_digest",
          "recommendation_id", "recommendation_digest", "design_id", "design_digest",
          "draft", "design_draft", "pending_request", "retained_requests", "filters",
          "title", "operator", "notes", "editor_state"}
REQUIRED = FIELDS - {"editor_state"}


def _json_object(value, label):
    if not isinstance(value, dict):
        raise ContractError(label + " must be an object")
    return value


def _strict_pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ContractError("Working JSON repeats an object field: " + key)
        result[key] = value
    return result


def _json_value(value, depth=0):
    if depth > 60:
        raise ContractError("Working JSON exceeds the supported nesting depth")
    if value is None or type(value) in (str, bool, int):
        return
    if type(value) is float:
        if not math.isfinite(value):
            raise ContractError("Working JSON requires finite numbers")
        return
    if isinstance(value, list):
        for item in value:
            _json_value(item, depth + 1)
        return
    if isinstance(value, dict) and all(isinstance(key, str) for key in value):
        for item in value.values():
            _json_value(item, depth + 1)
        return
    raise ContractError("Working files contain JSON values only")


def _input(working_file):
    if isinstance(working_file, bytes):
        if len(working_file) > MAX_BYTES:
            raise ContractError("The working file exceeds 8 MiB")
        try:
            text = working_file.decode("utf-8", errors="strict")
        except UnicodeError as exc:
            raise ContractError("The working file must be UTF-8 JSON") from exc
    elif isinstance(working_file, str):
        text = working_file
    else:
        _json_value(working_file)
        try:
            text = canonical_bytes(working_file).decode("utf-8")
        except (UnicodeError, ValueError) as exc:
            raise ContractError("The working file must be valid UTF-8 JSON") from exc
    try:
        body = text.encode("utf-8", errors="strict")
    except UnicodeError as exc:
        raise ContractError("The working file must be valid UTF-8 JSON") from exc
    if len(body) > MAX_BYTES:
        raise ContractError("The working file exceeds 8 MiB")
    try:
        value = json.loads(text, object_pairs_hook=_strict_pairs,
                           parse_constant=lambda v: (_ for _ in ()).throw(
                               ContractError("Nonfinite JSON number: " + v)))
    except (ValueError, RecursionError) as exc:
        raise ContractError("The working file is not complete JSON: " + str(exc)) from exc
    _json_value(value)
    return value, text, {"bytes": len(body), "sha256": hashlib.sha256(body).hexdigest()}


def _pin(value, name):
    if not isinstance(value, str) or not re.fullmatch(r"[0-9a-f]{64}", value):
        raise ContractError(name + " must be the exact retained SHA-256")
    return value


def _same(a, b):
    return canonical_bytes(a) == canonical_bytes(b)


def _changes(before, after, path=""):
    """Exact authored JSON differences; no numeric coercion or solver estimate."""
    if _same(before, after):
        return []
    if isinstance(before, dict) and isinstance(after, dict):
        result = []
        for key in sorted(set(before) | set(after)):
            child = path + "/" + key.replace("~", "~0").replace("/", "~1")
            if key not in before or key not in after:
                result.append({"path": child, "before_present": key in before,
                               "after_present": key in after,
                               "before": copy.deepcopy(before.get(key)),
                               "after": copy.deepcopy(after.get(key))})
            else:
                result.extend(_changes(before[key], after[key], child))
        return result
    return [{"path": path or "/", "before_present": True, "after_present": True,
             "before": copy.deepcopy(before), "after": copy.deepcopy(after)}]


def _request(value, label):
    if value is None:
        return
    _json_object(value, label)
    if value.get("kind") not in {"prepare", "design", "export", "working-save", "working-export"}:
        raise ContractError(label + " has an unknown original operation kind")
    _json_object(value.get("payload"), label + ".payload")
    recommendations._id(value.get("operation_id"), label + ".operation_id")
    if value.get("task_id") is not None:
        recommendations._id(value["task_id"], label + ".task_id")
    recommendations._text(value.get("state"), label + ".state", limit=200)
    if "metadata" in value:
        _json_object(value["metadata"], label + ".metadata")
    origin = value.get("workspace_key", (value.get("metadata") or {}).get("workspace_key"))
    if origin is not None:
        recommendations._text(origin, label + ".workspace_key", limit=500)
    # Extra original request/editor metadata is retained verbatim and is inert.
    # These fields never authorize dispatch or claim that a task exists here.


def _binding(workspace, value):
    if not isinstance(value, dict) or set(value) - FIELDS or REQUIRED - set(value):
        raise ContractError("Retain the complete supported sampling working-file fields")
    if value["schema"] != SCHEMA:
        raise ContractError("Unsupported sampling working-file schema")
    if value["project_id"] != workspace.project["id"]:
        raise ContractError("This working file belongs to another original project")
    recommendations._text(value["workspace_key"], "workspace_key", limit=500)
    for key in ("title", "operator", "notes"):
        recommendations._text(value[key], key, empty=True)
    for key in ("draft", "design_draft", "filters"):
        _json_object(value[key], key)
    if "editor_state" in value:
        _json_object(value["editor_state"], "editor_state")
    _request(value["pending_request"], "pending_request")
    if not isinstance(value["retained_requests"], list):
        raise ContractError("retained_requests must preserve an ordered array")
    for item in value["retained_requests"]:
        if item is None:
            raise ContractError("A retained request cannot be null")
        _request(item, "retained request")
    context = recommendations.observed_context.inspect(
        workspace, recommendations._id(value["context_id"], "context_id"))
    if digest(context) != _pin(value["context_digest"], "context_digest"):
        raise ContractError("The working file differs from its retained original context")
    view = recommendations._context_view(context)
    draft = value["draft"]
    if draft.get("context_id") not in (None, "", context["id"]):
        raise ContractError("The draft selects a different original context")
    targets = draft.get("targets", [])
    if not isinstance(targets, list):
        raise ContractError("Draft targets must be an ordered array")
    stations = {row["source_station_id"] for row in view["stations"]}
    cohorts = {row["id"] for row in view["cohorts"]}
    evidence, seen_sources = [], set()
    for target in targets:
        _json_object(target, "Draft target")
        for name, known in (("station_id", stations), ("cohort_id", cohorts)):
            if target.get(name) not in (None, "") and (not isinstance(target[name], str) or target[name] not in known):
                raise ContractError("The draft selects an unknown original " + name)
        selected = target.get("model_evidence")
        if selected is not None:
            _json_object(selected, "Draft model evidence")
            collection, source = selected.get("source_collection_id"), selected.get("source_id")
            if collection or source:
                if not collection or not source:
                    raise ContractError("Select both original native evidence source identifiers")
                key = collection, source
                if key not in seen_sources:
                    original = recommendations.native_evidence.describe(workspace, *key)
                    evidence.append(original)
                    seen_sources.add(key)
    proposal = None
    if value["recommendation_id"] is not None:
        proposal = recommendations.inspect(workspace, value["recommendation_id"])
        if (proposal["context_id"] != context["id"]
                or digest(proposal) != _pin(value["recommendation_digest"], "recommendation_digest")):
            raise ContractError("The selected proposal differs from the original context or digest")
    elif value["recommendation_digest"] is not None:
        raise ContractError("A proposal digest requires its original proposal ID")
    design = None
    if value["design_id"] is not None:
        if proposal is None:
            raise ContractError("A saved design requires its original selected proposal")
        design = recommendations.inspect_design(workspace, value["design_id"])
        if (design["recommendation_id"] != proposal["id"]
                or digest(design) != _pin(value["design_digest"], "design_digest")):
            raise ContractError("The selected design differs from its original proposal or digest")
    elif value["design_digest"] is not None:
        raise ContractError("A design digest requires its original saved design ID")
    from .monitoring_workspace import MonitoringWorkspace
    service = MonitoringWorkspace(workspace)
    network = service.get("networks", context["network_id"])
    service.verify_sources(network)
    if digest(network) != context["network_digest"]:
        raise ContractError("The original context network changed")
    binding = {"project_id": workspace.project["id"], "context_id": context["id"],
               "context_digest": digest(context), "network_id": network["id"],
               "network_digest": digest(network),
               "recommendation_id": proposal["id"] if proposal else None,
               "recommendation_digest": digest(proposal) if proposal else None,
               "design_id": design["id"] if design else None,
               "design_digest": digest(design) if design else None,
               "native_evidence_sources": [copy.deepcopy(row["source"]) for row in evidence]}
    return binding, context, proposal, design, network, evidence


def _comparison(value, proposal, design):
    result = {"semantics": "Exact authored-input differences, not predicted scientific outcomes.",
              "proposal_selection_changes": _changes(proposal["selection"], value["draft"]) if proposal else [],
              "selected_design_configuration": copy.deepcopy(design["configuration"]) if design else None,
              "design_form_values": copy.deepcopy(value["design_draft"]),
              "draft_configuration": None, "configuration_changes": [], "configuration_issue": None}
    supplied = value["design_draft"].get("configuration")
    if supplied is not None:
        if isinstance(supplied, dict):
            result["draft_configuration"] = copy.deepcopy(supplied)
            if design:
                result["configuration_changes"] = _changes(design["configuration"], supplied)
        else:
            result["configuration_issue"] = "The authored effective configuration is not an object."
    advanced = value["design_draft"].get("advanced")
    if advanced is not None:
        if not isinstance(advanced, str):
            raise ContractError("design_draft.advanced must retain the exact JSON text")
        try:
            parsed = json.loads(advanced, object_pairs_hook=_strict_pairs,
                                parse_constant=lambda _: (_ for _ in ()).throw(ValueError("nonfinite")))
            _json_value(parsed)
            if not isinstance(parsed, dict):
                raise ValueError("not an object")
        except (ContractError, ValueError, RecursionError) as exc:
            result["configuration_issue"] = "Advanced JSON is incomplete or invalid; its original text is retained: " + str(exc)
    if supplied is None:
        result["configuration_issue"] = result["configuration_issue"] or "No assembled native configuration is attached; retained form values have not been compiled."
    return result


def preview(workspace, *, working_file, workspace_key=None):
    value, text, source = _input(working_file)
    binding, context, proposal, design, network, evidence = _binding(workspace, value)
    same_workspace = workspace_key is not None and value["workspace_key"] == workspace_key
    requests = ([value["pending_request"]] if value["pending_request"] else []) + value["retained_requests"]
    origins = [item.get("workspace_key", (item.get("metadata") or {}).get("workspace_key",
               value["workspace_key"])) for item in requests]
    pending_origins_match = same_workspace and all(origin == workspace_key for origin in origins)
    warnings = ["This is an editable planning draft, not a saved scientific result.",
                "Retained requests are historical source records. Opening or saving this file never dispatches them."]
    if not pending_origins_match and requests:
        warnings.append("Original queue identity differs or is unavailable. Pending requests remain preserved; reconcile them with their original operator before retrying.")
    return {"working_file": copy.deepcopy(value), "binding": binding,
            "comparison": _comparison(value, proposal, design), "warnings": warnings,
            "source_sha256": source["sha256"], "source_bytes": source["bytes"],
            "original_workspace_matches": same_workspace, "pending_origins_match": pending_origins_match,
            # Matching a label cannot prove an operator queue survived a cold reopen.
            "can_resume_pending": False, "pending_requires_original_task_check": True}


def _record(workspace, identity):
    value = workspace._get(COLLECTION, identity)
    if value.get("schema") != RECORD_SCHEMA:
        raise ContractError("Unsupported immutable Sampling working record")
    request = value.get("request_payload")
    if (not isinstance(request, dict) or set(request) != {
            "kind", "source_text", "parent_id", "expected_parent_digest"}
            or request["kind"] != "working-save"
            or value.get("request_fingerprint") != digest(request)):
        raise ContractError("Saved working request identity changed")
    original, text, source = _input(request["source_text"])
    if (not _same(original, value.get("working_file")) or value.get("source") != source
            or value.get("parent_id") != request["parent_id"]
            or request["expected_parent_digest"] != request["parent_id"]):
        raise ContractError("Saved working file differs from its original request")
    recommendations._id(value.get("operation_id"), "operation_id")
    if type(value.get("revision")) is not int or value["revision"] < 1:
        raise ContractError("Working revision must be a positive integer")
    return value


def inspect(workspace, working_id):
    value = _record(workspace, working_id)
    current, seen = value, set()
    while current:
        if current["id"] in seen:
            raise ContractError("Working revision ancestry contains a cycle")
        seen.add(current["id"])
        binding = _binding(workspace, current["working_file"])[0]
        if not _same(current.get("binding"), binding):
            raise ContractError("Saved working source binding changed")
        parent_id = current["parent_id"]
        if parent_id is None:
            if current["revision"] != 1:
                raise ContractError("An initial working copy must be revision 1")
            break
        parent = _record(workspace, parent_id)
        if (parent["working_file"]["project_id"] != value["working_file"]["project_id"]
                or parent["working_file"]["context_id"] != value["working_file"]["context_id"]
                or current["revision"] != parent["revision"] + 1):
            raise ContractError("Working ancestry changes its original project/context or revision sequence")
        current = parent
    return value


def list_saved(workspace):
    records = []
    for path in sorted((workspace.root / COLLECTION).glob("*.json")):
        value = inspect(workspace, path.stem)
        fields = value["working_file"]
        records.append({"id": value["id"], "digest": value["id"],
                        "parent_id": value["parent_id"], "revision": value["revision"],
                        **{key: fields[key] for key in ("title", "operator", "context_id",
                           "recommendation_id", "design_id", "workspace_key")},
                        "pending_requests": int(fields["pending_request"] is not None) + len(fields["retained_requests"])})
    return {"records": records}


def get(workspace, working_id, *, workspace_key=None):
    value = inspect(workspace, working_id)
    return {"record": value, **preview(workspace, working_file=value["request_payload"]["source_text"],
                                      workspace_key=workspace_key)}


def save(workspace, *, working_file, operation_id, parent_id=None, expected_parent_digest=None):
    _, text, source = _input(working_file)
    request = {"kind": "working-save", "source_text": text, "parent_id": parent_id,
               "expected_parent_digest": expected_parent_digest}
    operation_id = recommendations._id(operation_id, "operation_id")
    key, fingerprint = digest({"operation_id": operation_id}), digest(request)
    path = workspace.root / "monitoring_working_operations" / (key + ".json")
    with held(path.with_suffix(".lock")):
        if path.exists():
            prior = load_json(path)
            if prior.get("fingerprint") != fingerprint:
                raise ContractError("The original working-save operation belongs to another request")
            return inspect(workspace, prior["record_id"])
        for item in sorted((workspace.root / COLLECTION).glob("*.json")):
            prior = workspace._get(COLLECTION, item.stem)
            if prior.get("operation_id") == operation_id:
                if prior.get("request_fingerprint") != fingerprint:
                    raise ContractError("This operation already retained another working file")
                value = inspect(workspace, prior["id"])
                atomic_json(path, {"fingerprint": fingerprint, "record_id": value["id"]})
                return value
        checked = preview(workspace, working_file=text)
        parent = inspect(workspace, parent_id) if parent_id else None
        if expected_parent_digest != parent_id:
            raise ContractError("Choose the exact immutable working parent identity")
        if parent and (parent["working_file"]["context_id"] != checked["working_file"]["context_id"]
                       or parent["working_file"]["project_id"] != checked["working_file"]["project_id"]):
            raise ContractError("A changed context starts a new working-copy family")
        value = workspace._save(COLLECTION, {
            "working_file": checked["working_file"], "source": source,
            "binding": checked["binding"], "parent_id": parent_id,
            "revision": parent["revision"] + 1 if parent else 1,
            "operation_id": operation_id, "request_fingerprint": fingerprint,
            "request_payload": request})
        atomic_json(path, {"fingerprint": fingerprint, "record_id": value["id"]})
        return value


def report_html(value, comparison):
    esc = lambda v: html.escape(str(v))
    pretty = lambda v: esc(json.dumps(v, ensure_ascii=False, indent=2, allow_nan=False))
    working = value["working_file"]
    return ("<!doctype html><html lang='en'><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>"
            "<title>" + esc(working["title"] or "Sampling working copy") + "</title>"
            "<style>body{font:15px/1.5 system-ui;max-width:1100px;margin:32px auto;padding:0 18px;color:#222;background:#fff;color-scheme:light}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f4f4f4;padding:14px}h1,h2{line-height:1.2}h1,h2,p{overflow-wrap:anywhere}@media print{body{margin:0;max-width:none}pre{font-size:10px}}</style>"
            "<h1>" + esc(working["title"] or "Sampling working copy") + "</h1>"
            "<p>Editable planning draft. Revision " + str(value["revision"]) + ". No solver was run by saving or exporting this file.</p>"
            "<p><a href='working-copy.json' download>Complete original working JSON</a> · <a href='working-history.json' download>Saved working history</a> · <a href='comparison.json' download>Exact input comparison</a></p>"
            "<h2>Original source binding</h2><pre>" + pretty(value["binding"]) + "</pre>"
            "<h2>Authored recommendation draft</h2><pre>" + pretty(working["draft"]) + "</pre>"
            "<h2>Selected original design and authored changes</h2><p>Input differences do not predict changes in scientific outcomes. Use the original Design action to calculate a revised design.</p><pre>" + pretty(comparison) + "</pre>"
            "<h2>Retained requests</h2><p>These requests retain their original operator identity. They are not automatically resumed on receiving.</p><pre>" +
            pretty({"workspace_key": working["workspace_key"], "pending_request": working["pending_request"],
                    "retained_requests": working["retained_requests"]}) + "</pre>"
            "<h2>Operator notes</h2><pre>" + esc(working["notes"]) + "</pre>"
            "<p>TokenJunkieLabs · Original Sampling and Monitoring workspace</p></html>")



def _context_dependencies(workspace, context):
    """Retain the original context's frozen plan/campaign ancestry, not its live head."""
    from .monitoring_workspace import MonitoringWorkspace
    from .monitoring_packet import bytes_member, file_member
    from .monitoring_sources import source_export_members
    from .common import verify_file
    service = MonitoringWorkspace(workspace)
    queue = [("networks", context["network_id"])]
    if context.get("plan_id"):
        queue.append(("plans", context["plan_id"]))
    if context.get("campaign_revision_id"):
        queue.append(("revisions", context["campaign_revision_id"]))
    seen = set()
    while queue:
        kind, identity = queue.pop()
        if (kind, identity) in seen:
            continue
        seen.add((kind, identity))
        original = service.get(kind, identity)
        prefix = "original-monitoring/" + kind + "/" + identity + "/"
        yield prefix + "record.json", bytes_member(canonical_bytes(original))
        if kind == "networks":
            service.verify_sources(original)
            for label, source in original["source_bindings"].items():
                if not source:
                    continue
                for name, member in source_export_members(workspace, label, source):
                    yield prefix + name, member
        if kind in {"plans", "revisions", "events"}:
            for field, target in (("network_id", "networks"), ("plan_id", "plans")):
                if original.get(field):
                    queue.append((target, original[field]))
        if kind == "revisions":
            if original.get("parent_id"):
                queue.append(("revisions", original["parent_id"]))
            queue.extend(("events", identity) for identity in original.get("event_ids", []))
    native = context.get("native_observation_binding") or {}
    if native.get("project_id") == workspace.project["id"]:
        from .monitoring_native_observations import _native
        source, path = _native(workspace, native["observation_id"])
        prefix = "original-monitoring/native-observations/" + source["id"] + "/"
        yield prefix + "record.json", file_member(path, path.stat().st_size, native["record_sha256"])
        body = source["original"]
        original_file = verify_file(workspace.root, {**body, "path": body["object"]})
        # Fixed safe name preserves the original filename in record.json.
        yield prefix + "original-source", file_member(original_file, body["bytes"], body["sha256"])


def export_members(workspace, working_id):
    from .monitoring_packet import bytes_member, add_member
    from .monitoring_sources import source_export_members
    value = inspect(workspace, working_id)
    binding, context, proposal, design, network, evidence = _binding(workspace, value["working_file"])
    comparison = _comparison(value["working_file"], proposal, design)
    history, current = [], value
    while current:
        history.append(current)
        current = inspect(workspace, current["parent_id"]) if current["parent_id"] else None
    files = {}
    for name, member in _context_dependencies(workspace, context):
        add_member(files, name, member)
    add_member(files, "working-copy.json", bytes_member(value["request_payload"]["source_text"].encode("utf-8")))
    for name, data in (("working-record.json", value), ("working-history.json", list(reversed(history))),
                       ("comparison.json", comparison)):
        add_member(files, name, bytes_member(canonical_bytes(data)))
    add_member(files, "sampling-working-review.html", bytes_member(report_html(value, comparison).encode("utf-8")))
    if proposal:
        for name, member in recommendations.export_members(workspace, proposal["id"]).items():
            add_member(files, "selected-proposal/" + name, member)
    else:
        for name, member in recommendations.observed_context.export_members(workspace, context["id"]):
            add_member(files, name, member)
        add_member(files, "network.json", bytes_member(canonical_bytes(network)))
        for name, source in network["source_bindings"].items():
            if not source:
                continue
            for path, member in source_export_members(workspace, name, source):
                add_member(files, path, member)
    # Draft evidence can differ from the selected saved proposal. Retain its
    # complete source entry/companions independently, using the original exporter.
    for name, member in recommendations.native_evidence.export_members(
            workspace, [{"targets": [{"model_evidence": item} for item in evidence]}]):
        add_member(files, "draft-" + name, member)
    # Older working revisions can select other proposal branches or draft evidence.
    # Keep every original dependency referenced by the immutable working history.
    retained_proposals = {proposal["id"]} if proposal else set()
    retained_designs = {design["id"]} if design else set()
    for ancestor in history[1:]:
        _, _, old_proposal, old_design, _, old_evidence = _binding(workspace, ancestor["working_file"])
        if old_proposal and old_proposal["id"] not in retained_proposals:
            for name, member in recommendations.export_members(workspace, old_proposal["id"]).items():
                add_member(files, "originals/proposals/" + old_proposal["id"] + "/" + name, member)
            retained_proposals.add(old_proposal["id"])
        if old_design and old_design["id"] not in retained_designs:
            add_member(files, "originals/designs/" + old_design["id"] + ".json",
                       bytes_member(canonical_bytes(old_design)))
            retained_designs.add(old_design["id"])
        for name, member in recommendations.native_evidence.export_members(
                workspace, [{"targets": [{"model_evidence": item} for item in old_evidence]}]):
            add_member(files, "draft-" + name, member)
    if design:
        add_member(files, "selected-design.json", bytes_member(canonical_bytes(design)))
        add_member(files, "selected-design-configuration.json", bytes_member(canonical_bytes(design["configuration"])))
    add_member(files, "README.txt", bytes_member((
        "Open sampling-working-review.html and working-copy.json. Drafts may be incomplete. "
        "This packet retains exact working input, immutable history and original scientific dependencies; it creates no solver result. "
        "Open the working JSON in Sampling priorities in the original or restored same-project Workspace. "
        "Use the separate complete Workspace export for independent editing on another machine; restore it with the original application/model/cli.py restore command. "
        "Pending requests remain bound to their original operator and never auto-resume. "
        "Native source eligibility, the Monitoring solver, and saved scientific records are unchanged.\n").encode("utf-8")))
    add_member(files, "manifest.json", bytes_member(canonical_bytes({
        "schema": "upstate.sampling-working-export/v1", "working_id": value["id"],
        "binding": binding, "files": [{"path": name, "bytes": item["bytes"], "sha256": item["sha256"]}
                                     for name, item in sorted(files.items())]})))
    return files


def export(workspace, *, working_id, format="bundle", export_root=None):
    from .monitoring_workspace import MonitoringWorkspace
    from .monitoring_packet import retain_packet
    value = inspect(workspace, working_id)
    if format not in {"bundle", "workspace"}:
        raise ContractError("Choose a complete working bundle or original Workspace export")
    service = MonitoringWorkspace(workspace, export_root=export_root)
    base = service.export_root or workspace.root.parent / (workspace.root.name + "-monitoring-exports")
    if Path(base).resolve().is_relative_to(workspace.root.resolve()):
        raise ContractError("Keep working exports outside the original Workspace")
    folder = Path(base) / ("sampling-working-" + uuid.uuid4().hex)
    folder.mkdir(parents=True, exist_ok=False)
    if format == "workspace":
        path = folder / "sampling-editable-workspace.zip"
        with held(workspace.root / ".operator-session.lock", blocking=False):
            manifest = workspace.backup(path, include_intermediates=True)
        return service._download(path, {"format": "original-workspace", "working_id": value["id"],
                                        "native_manifest": manifest})
    files = export_members(workspace, value["id"])
    path = folder / "sampling-working-copy.zip"
    retain_packet(path, files, metadata="export")
    return service._download(path, {"format": "sampling-working-copy", "working_id": value["id"],
                                    "files": len(files), "binding": value["binding"]})


def verify_workspace(workspace):
    identities = [p.stem for p in sorted((workspace.root / COLLECTION).glob("*.json"))]
    for identity in identities:
        inspect(workspace, identity)
    return {"sampling_working_copies": len(identities)}


def main():
    from .workspace import Workspace
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--workspace-key")
    parser.add_argument("--output", type=Path)
    commands = parser.add_subparsers(dest="action", required=True)
    commands.add_parser("list")
    for name in ("get", "export"):
        command = commands.add_parser(name)
        command.add_argument("--id", required=True)
        if name == "export":
            command.add_argument("--format", choices=("bundle", "workspace"), default="bundle")
            command.add_argument("--export-root", type=Path)
    for name in ("preview", "save"):
        command = commands.add_parser(name)
        command.add_argument("--file", type=Path, required=True)
        if name == "save":
            command.add_argument("--operation-id", required=True)
            command.add_argument("--parent-id")
            command.add_argument("--expected-parent-digest")
    args = parser.parse_args()
    workspace = Workspace(args.workspace)
    if args.action == "list":
        result = list_saved(workspace)
    elif args.action == "get":
        result = get(workspace, args.id, workspace_key=args.workspace_key)
    elif args.action == "export":
        result = export(workspace, working_id=args.id, format=args.format, export_root=args.export_root)
    else:
        with args.file.open("rb") as incoming:
            body = incoming.read(MAX_BYTES + 1)
        if args.action == "preview":
            result = preview(workspace, working_file=body, workspace_key=args.workspace_key)
        else:
            result = save(workspace, working_file=body, operation_id=args.operation_id,
                          parent_id=args.parent_id, expected_parent_digest=args.expected_parent_digest)
    if args.output:
        atomic_json(args.output, result, immutable=True)
    print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
