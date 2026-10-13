"""Complete an original observed-source selection through scientific review.

Reads the actual saved delivery-selection or imports ordered original scientific
source manifests into the existing Workspace. Uses the
same scientific preview/render lifecycle as SourceReports, then the maintained
Customer review export and complete Workspace receiving command.
"""
from __future__ import annotations

import argparse
from copy import deepcopy
import json
from pathlib import Path
import sys

APPLICATION = Path(__file__).resolve().parents[1]
if str(APPLICATION) not in sys.path:
    sys.path.insert(0, str(APPLICATION))

from model import observed_context, reviews, scientific_report_editions, scientific_report_review
from model.common import atomic_bytes, atomic_json, describe_file, digest, file_digest, held, now, read_json, verify_file
from model.workspace import Workspace
from source_tools import receive_scientific_report_review as review_receiver

SCHEMA = "upstate.observed-scientific-review-workflow/v1"
EDITION = "observed-scientific-review-workflow-20261013-v2-ordered-manifests"


def _event(stage, **values):
    print(json.dumps({"stage": stage, **values}, ensure_ascii=False,
                     sort_keys=True, allow_nan=False), file=sys.stderr, flush=True)


def _inside(root, value):
    root = Path(root).resolve()
    path = Path(value)
    path = path.resolve() if path.is_absolute() else (root / path).resolve()
    if not path.is_relative_to(root) or not path.is_file():
        raise ValueError("Choose the original saved delivery-selection inside this Workspace")
    return path


def _source_identity(path):
    path = Path(path)
    if path.is_symlink() or not path.is_file():
        raise ValueError("Choose an original ordinary authored input file")
    return {"filename": path.name, "bytes": path.stat().st_size, "sha256": file_digest(path)}


def _preview_content(value):
    """Compare original prepared content while preserving its source-host ID."""
    result = deepcopy(value)
    for name in ("workspace", "workspace_key", "id", "operation_id", "existing"):
        result.pop(name, None)
    result["render_identity"].pop("workspace", None)
    return result




def source_selection_import(workspace, selected):
    """Reopen an original manifest selection after Workspace relocation."""
    selected = _inside(workspace.root, selected)
    relative = selected.relative_to(workspace.root.resolve())
    if not relative.parts or relative.parts[0] != "scientific-report-source-selections":
        return None
    if len(relative.parts) != 3 or relative.parts[2] != "delivery-selection.json":
        raise ValueError("Use the original retained scientific source selection")
    retained, key = selected.parent, relative.parts[1]
    identity = read_json(retained / "identity.json")
    selection = read_json(selected)
    receipt_path = retained / "receipt.json"
    receipt = read_json(receipt_path)
    choices = observed_context.source_choices(selection)
    records = identity.get("manifests")
    if (identity.get("schema") != SCHEMA + "/source-selection"
            or digest(identity) != key or identity.get("project_id") != workspace.project["id"]
            or identity.get("selection") != selection
            or not isinstance(records, list) or len(records) != len(choices)
            or receipt.get("schema") != SCHEMA + "/source-selection-receipt"
            or receipt.get("state") != "complete" or receipt.get("operation_id") != key
            or receipt.get("project_id") != workspace.project["id"]
            or receipt.get("source_count") != len(choices)
            or receipt.get("selection") != describe_file(workspace.root, selected)
            or receipt.get("observed_binding") != selection.get("observed_context_binding")
            or len(receipt.get("sources", [])) != len(records)):
        raise ValueError("The retained scientific manifest selection changed its original identity")
    for index, (record, saved, choice) in enumerate(zip(records, receipt["sources"], choices)):
        if {name: record.get(name) for name in ("source_collection_id", "source_id")} != choice:
            raise ValueError("The retained scientific manifest order changed")
        member = saved.get("retained_manifest")
        if not isinstance(member, dict) or member.get("path") != "manifests/" + str(index).zfill(4) + ".json":
            raise ValueError("The original scientific manifest member changed")
        verify_file(retained, member)
        if (saved != {**record, "retained_manifest": member}
                or member["sha256"] != record["original"]["sha256"]
                or member["bytes"] != record["original"]["bytes"]):
            raise ValueError("The original scientific manifest copy differs")
        collection = workspace._get("sources", choice["source_collection_id"])
        entries = [item for item in collection["entries"] if item["id"] == choice["source_id"]]
        if len(entries) != 1:
            raise ValueError("The original scientific source is absent from its collection")
        entry = entries[0]
        if (collection["original_manifest"] != record["original_manifest"]
                or any(entry[name] != record[name] for name in ("title", "uri", "vintage"))
                or entry["body"] != record["recipe"]
                or entry.get("companions", []) != record["companions"]):
            raise ValueError("The original scientific source collection differs from its manifest receipt")
    return {"receipt": describe_file(workspace.root, receipt_path),
            "operation_id": key, "source_count": len(choices), "sources": choices}


def retain_source_selection(workspace, manifests):
    """Import original report manifests in explicit order and retain their selection.

    Both published recipe metadata and the maintained OBSERVED_CONTEXT role are
    accepted. The native source importer verifies all declared original members;
    observed_context.bind then verifies the complete selected recipes.
    """
    if not isinstance(manifests, (list, tuple)) or not manifests:
        raise ValueError("Choose at least one original scientific report source manifest")
    originals = []
    for value in manifests:
        path = Path(value).resolve(strict=True)
        identity = _source_identity(path)
        raw = path.read_bytes()
        manifest = json.loads(raw.decode("utf-8"))
        if (manifest.get("schema") != "upstate.sources/v1"
                or not isinstance(manifest.get("entries"), list)):
            raise ValueError("Use an original upstate.sources/v1 manifest")
        matches = [entry for entry in manifest["entries"]
                   if isinstance(entry, dict) and (
                       entry.get("role") == observed_context.ROLE
                       or (isinstance(entry.get("metadata"), dict)
                           and entry["metadata"].get("report_schema") == observed_context.SCHEMA))]
        if len(matches) != 1 or matches[0].get("kind") != "document":
            raise ValueError("Choose exactly one original scientific report document per manifest: " + path.name)
        if file_digest(path) != identity["sha256"]:
            raise ValueError("A scientific source manifest changed while being read")
        originals.append((path, raw, identity, matches[0]["id"]))
    records, choices = [], []
    for path, raw, original, source_id in originals:
        collection = workspace.import_sources(path)
        retained_manifest = collection["original_manifest"]
        if (retained_manifest["sha256"] != original["sha256"]
                or retained_manifest["bytes"] != original["bytes"]
                or file_digest(path) != original["sha256"]):
            raise ValueError("The native import changed its original scientific manifest")
        choice = {"source_collection_id": collection["id"], "source_id": source_id}
        unused_path, entry = workspace.source_file(collection["id"], source_id)
        choices.append(choice)
        records.append({"original": original, **choice,
                        "original_manifest": retained_manifest,
                        "title": entry["title"], "uri": entry["uri"], "vintage": entry["vintage"],
                        "recipe": entry["body"],
                        "companions": entry.get("companions", [])})
    selection = {"source_roles": {observed_context.ROLE: choices[0]},
                 "observed_context_sources": choices}
    # source_choices rejects repeated documents and verifies primary ordering.
    observed_context.source_choices(selection)
    selection["observed_context_binding"] = observed_context.bind(workspace, selection)
    identity = {"schema": SCHEMA + "/source-selection",
                "project_id": workspace.project["id"], "manifests": records,
                "selection": selection}
    operation_id = digest(identity)
    retained = workspace.root / "scientific-report-source-selections" / operation_id
    with held(retained / "selection.lock"):
        atomic_json(retained / "identity.json", identity, immutable=True)
        imported = []
        for index, (path, raw, original, source_id) in enumerate(originals):
            relative = "manifests/" + str(index).zfill(4) + ".json"
            saved = retained / relative
            atomic_bytes(saved, raw, immutable=True)
            descriptor = describe_file(retained, saved)
            if descriptor["sha256"] != original["sha256"] or descriptor["bytes"] != original["bytes"]:
                raise ValueError("The retained original manifest differs from its source")
            imported.append({**records[index], "retained_manifest": descriptor})
        selected = retained / "delivery-selection.json"
        atomic_json(selected, selection, immutable=True)
        receipt = {"schema": SCHEMA + "/source-selection-receipt",
                   "state": "complete", "operation_id": operation_id,
                   "project_id": workspace.project["id"],
                   "source_count": len(choices), "sources": imported,
                   "selection": describe_file(workspace.root, selected),
                   "observed_binding": selection["observed_context_binding"]}
        receipt_path = retained / "receipt.json"
        atomic_json(receipt_path, receipt, immutable=True)
    return selected, source_selection_import(workspace, selected)


def receive(workspace_path, delivery_selection, review_selection, output, *,
            title=None, contact=None, created_at=None, context_receipt=None,
            source_manifests=None):
    workspace = Workspace(Path(workspace_path).resolve())
    source_import = None
    if source_manifests is not None:
        if delivery_selection is not None or context_receipt is not None:
            raise ValueError("Choose source manifests or one original saved selection")
        delivery_selection, source_import = retain_source_selection(workspace, source_manifests)
    selected_path = _inside(workspace.root, delivery_selection)
    if source_import is None:
        source_import = source_selection_import(workspace, selected_path)
    selected_descriptor = describe_file(workspace.root, selected_path)
    original = read_json(selected_path)
    verify_file(workspace.root, selected_descriptor)
    choices = observed_context.source_choices(original)
    if not choices:
        raise ValueError("The actual saved selection has no original observed report sources")
    binding = observed_context.bind(workspace, original)
    if original.get("observed_context_binding") != binding:
        raise ValueError("Use the original saved selection with its complete observed source binding")
    context_identity = None
    if context_receipt is not None:
        receipt_path = Path(context_receipt).resolve()
        context_identity = _source_identity(receipt_path)
        receipt = read_json(receipt_path)
        if (receipt.get("schema") != "upstate.implementation-outcome-receiving/v1/result"
                or receipt.get("state") != "complete"
                or receipt.get("project_id") != workspace.project["id"]
                or _inside(workspace.root, receipt.get("delivery_selection_path", "")) != selected_path
                or receipt.get("binding") != binding
                or file_digest(receipt_path) != context_identity["sha256"]):
            raise ValueError("Choose the completed original outcome-context result for this Workspace selection")
    authored_path = Path(review_selection).resolve()
    authored_identity = _source_identity(authored_path)
    authored = read_json(authored_path)
    draft = scientific_report_review._draft(authored)
    if file_digest(authored_path) != authored_identity["sha256"]:
        raise ValueError("The authored review questions changed while being read")
    if contact is None:
        contact = {}
    payload = {"sources": choices, "title": title, "contact": contact}
    current_preview = scientific_report_editions.preview(workspace, payload)
    requested_time = (reviews._date(created_at, "Review creation time")
                      if created_at is not None else None)
    identity = {
        "schema": SCHEMA, "edition": EDITION,
        "project_id": workspace.project["id"],
        "original_delivery_selection": selected_descriptor,
        "observed_source_choices": choices, "observed_binding": binding,
        "report_options": {"title": current_preview["title"], "contact": current_preview["render_identity"]["contact"]},
        "review_selection": draft, "authored_review_file": authored_identity,
        "outcome_context_receipt": context_identity,
        "source_manifest_import": source_import,
        "requested_created_at": requested_time,
        "rendering_sources": current_preview["render_identity"].get("rendering_sources"),
        "receiver_source_sha256": file_digest(Path(__file__)),
        "lifecycle_source_sha256": file_digest(Path(scientific_report_editions.__file__)),
        "review_receiver_source_sha256": file_digest(Path(review_receiver.__file__)),
    }
    operation_id = digest(identity)
    output = Path(output).resolve()
    if (output.is_relative_to(workspace.root.resolve())
            or output.is_relative_to(APPLICATION.resolve())):
        raise ValueError("Keep the native workflow output outside the original Workspace and application")
    operation = output / operation_id
    operation.mkdir(parents=True, exist_ok=True)
    retained = workspace.root / "scientific-report-workflows" / operation_id
    retained.mkdir(parents=True, exist_ok=True)
    with held(retained / "workflow.lock"), held(operation / "operation.lock"):
        atomic_json(retained / "identity.json", identity, immutable=True)
        atomic_json(operation / "identity.json", identity, immutable=True)
        atomic_json(retained / "original-delivery-selection.json", original, immutable=True)
        atomic_json(retained / "review-selection.json", draft, immutable=True)
        atomic_bytes(retained / "review-request-original.json", authored_path.read_bytes(), immutable=True)
        preview_path = retained / "report-preview.json"
        request_path = retained / "request.json"
        external_request = operation / "request.json"
        requests = [read_json(path) for path in (request_path, external_request) if path.is_file()]
        if requests:
            request = requests[0]
            if any(value != request for value in requests[1:]):
                raise ValueError("The original retained and external workflow requests differ")
            if (request["operation_id"] != operation_id
                    or (requested_time is not None and request["created_at"] != requested_time)):
                raise ValueError("The native workflow request identifies another authored review")
            reviews._date(request["created_at"], "Review creation time")
            prepared = read_json(verify_file(retained, request["preview"]))
        else:
            if preview_path.is_file():
                prepared = read_json(preview_path)
            else:
                prepared = current_preview
                atomic_json(preview_path, prepared, immutable=True)
            request = {"operation_id": operation_id, "created_at": requested_time or now(),
                       "preview": describe_file(retained, preview_path)}
        if _preview_content(prepared) != _preview_content(current_preview):
            raise ValueError("The original report preview changed its sources, records, methods or rendering bodies")
        if prepared["id"] != digest(prepared["render_identity"]):
            raise ValueError("The retained native report preview has another edition identity")
        atomic_json(request_path, request, immutable=True)
        atomic_json(external_request, request, immutable=True)
        _event("prepare-saved-scientific-edition", operation_id=operation_id,
               source_count=len(choices), scientific_report_edition_id=prepared["id"])
        rendered = scientific_report_editions.render_prepared(workspace, prepared)
        if rendered["scientific_report_edition_id"] != prepared["id"]:
            raise ValueError("Rendering changed the reviewed original scientific edition")
        record, directory, result = scientific_report_editions.inspect(workspace, prepared["id"])
        members = scientific_report_editions.files(record, directory)
        if record["render_identity"] != prepared["render_identity"]:
            raise ValueError("The saved edition differs from the original retained preview")
        edition_identity = {
            "scientific_report_edition_id": record["id"], "title": record["title"],
            "operation_id": record["operation_id"], "source_count": record["source_count"],
            "section_count": record["section_count"], "figure_count": record["figure_count"],
            "render_identity": record["render_identity"],
            "members": {name: row for name, row in sorted(members.items())},
            "preview": request["preview"],
        }
        atomic_json(retained / "saved-edition.json", edition_identity, immutable=True)
        _event("receive-scientific-review", scientific_report_edition_id=record["id"])
        received = review_receiver.receive(
            workspace.root, record["id"], retained / "review-selection.json",
            operation / "review-receiving", created_at=request["created_at"])
        if (received["scientific_report_edition_id"] != record["id"]
                or received["project_id"] != workspace.project["id"]
                or received["created_at"] != request["created_at"]):
            raise ValueError("The completed review receiver identifies another original report request")
        selected = read_json(selected_path)
        if selected != original or observed_context.bind(workspace, selected) != binding:
            raise ValueError("The native workflow changed the original ordered delivery-selection")
        final = {
            "schema": SCHEMA + "/result", "state": "complete",
            "operation_id": operation_id, "identity": identity,
            "workspace": str(workspace.root), "project_id": workspace.project["id"],
            "original_delivery_selection": selected_descriptor,
            "source_manifest_import": source_import,
            "observed_source_choices": choices, "observed_binding": binding,
            "scientific_report_edition": edition_identity,
            "review": received,
            "reviewer_index": received["export"]["index"],
            "received_reviewer_index": received["received_review"]["index"],
            "restored_workspace": received["restore"]["workspace"],
            "retained_directory": retained.relative_to(workspace.root).as_posix(),
            "receipt": str(operation / "result.json"),
        }
        atomic_json(operation / "result.json", final, immutable=True)
        _event("complete", review_id=received["review_id"], receipt=final["receipt"])
        return final


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True, type=Path)
    selected_input = parser.add_mutually_exclusive_group(required=True)
    selected_input.add_argument("--delivery-selection", type=Path)
    selected_input.add_argument("--context-receipt", type=Path,
                                help="Completed receive_implementation_outcome_context result JSON")
    selected_input.add_argument("--source-manifest", type=Path, action="append",
                                help="Original report manifest; repeat in the intended scientific report order")
    parser.add_argument("--review-selection", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--title")
    parser.add_argument("--contact", type=Path, help="Original report contact JSON (name, organization, email)")
    parser.add_argument("--created-at")
    args = parser.parse_args(argv)
    selected = args.delivery_selection
    if args.context_receipt:
        receipt = read_json(args.context_receipt)
        selected = receipt.get("delivery_selection_path")
        if not isinstance(selected, str) or not selected:
            parser.error("--context-receipt must identify its actual saved delivery-selection")
    result = receive(args.workspace, selected, args.review_selection, args.output,
                     title=args.title, contact=read_json(args.contact) if args.contact else None,
                     created_at=args.created_at, context_receipt=args.context_receipt,
                     source_manifests=args.source_manifest)
    print(json.dumps(result, ensure_ascii=False, sort_keys=True, allow_nan=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
