"""Prepare existing customer reviews from original saved scientific reports.

The completed HTML is a native source document; its PDF, data, figures, original
source members and edition records remain beside it. Existing review export,
responses, reconciliation and complete Workspace receiving own the review flow.
"""
from __future__ import annotations

import argparse
from copy import deepcopy
from pathlib import Path
import json
import shutil

from . import reviews, scientific_report_editions
from .common import atomic_json, describe_file, digest, file_digest, held, read_json, verify_file
from .workspace import Workspace

SCHEMA = "upstate.scientific-report-review/v1"
EDITION = "scientific-report-review-20261013-v1"
ROLE = "SCIENTIFIC_REPORT_REVIEW"


def _workspace(value):
    return value if hasattr(value, "import_sources") and hasattr(value, "root") else Workspace(value)


def _draft(value):
    if not isinstance(value, dict):
        raise ValueError("Provide the customer review title, purpose and review questions")
    allowed = {"title", "purpose", "requirements", "notes"}
    if set(value) - allowed:
        raise ValueError("Unknown scientific report review field: " + ", ".join(sorted(set(value) - allowed)))
    draft = {
        "title": reviews._text(value.get("title"), "Review title", required=True, maximum=300),
        "purpose": reviews._text(value.get("purpose"), "Selected review purpose", required=True),
    }
    requirements = []
    for item in reviews._list(value.get("requirements", []), "requirements"):
        if not isinstance(item, dict) or set(item) - {"id", "title", "detail"}:
            raise ValueError("Each requirement needs id, title and detail")
        requirements.append({
            "id": reviews._key(item.get("id"), "Requirement ID"),
            "title": reviews._text(item.get("title"), "Requirement title", required=True, maximum=500),
            "detail": reviews._text(item.get("detail", ""), "Requirement detail"),
        })
    reviews._unique([item["id"] for item in requirements], "requirements")
    draft["requirements"] = requirements
    draft["notes"] = [reviews._text(item, "Review note")
                      for item in reviews._list(value.get("notes", []), "notes")]
    return draft


def _context(workspace, edition_id, review_selection):
    record, directory, result = scientific_report_editions.inspect(workspace, edition_id)
    members = scientific_report_editions.files(record, directory)
    primary = members.get("report_html")
    if not isinstance(primary, dict) or not str(primary.get("path", "")).endswith(".html"):
        raise ValueError("Choose a completed scientific edition with its original HTML report")
    inventory, by_path = [], {}
    for role, item in sorted(members.items()):
        path = verify_file(directory, item)
        if not path.resolve().is_relative_to(directory.resolve()):
            raise ValueError("Scientific report members must stay inside their original edition")
        relative = path.relative_to(directory).as_posix()
        descriptor = {"path": relative, "bytes": item["bytes"], "sha256": item["sha256"]}
        if relative in by_path:
            if by_path[relative] != descriptor:
                raise ValueError("One scientific report member has conflicting identities")
        else:
            by_path[relative] = descriptor
            inventory.append(descriptor)
    inventory.sort(key=lambda item: item["path"])
    primary_path = primary["path"]
    if primary_path not in by_path:
        raise ValueError("The original HTML is absent from the complete report inventory")
    required = {"edition.json", "operation.json", "selection.json"}
    if not required.issubset(by_path):
        raise ValueError("The report lacks its original edition, operation or selection")
    identity = {
        "schema": SCHEMA, "edition": EDITION, "project_id": workspace.project["id"],
        "scientific_report_edition_id": record["id"], "edition_record_sha256": digest(record),
        "render_identity": deepcopy(record["render_identity"]),
        "primary_path": primary_path, "members": inventory,
    }
    draft = _draft(review_selection)
    source_key = digest(identity)
    request = {"schema": SCHEMA + "/preview", "source_identity": identity, "review_selection": draft}
    return {"record": record, "directory": directory, "members": by_path,
            "identity": identity, "source_key": source_key, "draft": draft,
            "operation_id": digest(request), "primary": primary_path}


def preview_review(workspace, edition_id, review_selection):
    """Verify a complete saved scientific edition without changing its Workspace."""
    workspace = _workspace(workspace)
    context = _context(workspace, edition_id, review_selection)
    record = context["record"]
    return {
        "schema": SCHEMA, "state": "preview", "operation_id": context["operation_id"],
        "scientific_report_edition_id": record["id"], "title": record["title"],
        "review_selection": deepcopy(context["draft"]),
        "source_identity": deepcopy(context["identity"]),
        "original_study_count": record["source_count"],
        "section_count": record["section_count"], "figure_count": record["figure_count"],
        "sources": deepcopy(record["sources"]),
        "member_count": len(context["members"]),
        "bytes": sum(row["bytes"] for row in context["members"].values()),
        "primary_path": context["primary"],
        "members": deepcopy(context["identity"]["members"]),
    }


def _copy_original(source, target, descriptor):
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists() or target.is_symlink():
        if (target.is_symlink() or not target.is_file()
                or target.stat().st_size != descriptor["bytes"]
                or file_digest(target) != descriptor["sha256"]):
            raise ValueError("A retained original scientific report file differs: " + descriptor["path"])
        return
    pending = target.with_name("." + target.name + ".pending")
    try:
        shutil.copyfile(source, pending)
        if pending.stat().st_size != descriptor["bytes"] or file_digest(pending) != descriptor["sha256"]:
            raise ValueError("The original scientific report changed while being retained")
        pending.replace(target)
    finally:
        pending.unlink(missing_ok=True)


def _verify_source(workspace, receipt, context):
    if receipt.get("schema") != SCHEMA or receipt.get("source_identity") != context["identity"]:
        raise ValueError("The saved report review source belongs to another original edition")
    for item in receipt["files"]:
        verify_file(workspace.root, item)
    primary_path, entry = workspace.source_file(receipt["source_collection_id"], receipt["source_id"])
    if (entry.get("role") != ROLE or entry.get("metadata", {}).get("scientific_report_identity") != context["identity"]
            or entry["body"]["sha256"] != context["members"][context["primary"]]["sha256"]
            or entry["body"]["bytes"] != context["members"][context["primary"]]["bytes"]):
        raise ValueError("The imported review source differs from the original report")
    collection = workspace._get("sources", receipt["source_collection_id"])
    if digest(collection) != receipt["source_collection_sha256"]:
        raise ValueError("The retained scientific review source collection changed")
    if file_digest(primary_path) != entry["body"]["sha256"]:
        raise ValueError("The original report HTML source changed")
    actual = {}
    for item in [entry["body"], *entry.get("companions", [])]:
        native_path = item.get("view_path", item["filename"])
        if native_path in actual:
            raise ValueError("The imported review source repeats an original member")
        actual[native_path] = {"bytes": item["bytes"], "sha256": item["sha256"]}
    # Workspace source views may remove the common report/ directory. The
    # filename-relative tree itself must remain identical for original HTML links.
    body_name = entry["body"].get("view_path", entry["body"]["filename"])
    prefix = "report/" if body_name == "report/" + context["primary"] else ""
    expected = {prefix + path: {key: row[key] for key in ("bytes", "sha256")}
                for path, row in context["members"].items()}
    if actual != expected:
        raise ValueError("The imported source does not retain the complete original report tree")
    return receipt


def _source(workspace, context):
    root = workspace.root / "scientific-report-reviews" / context["source_key"] / "source"
    if root.is_symlink():
        raise ValueError("Keep report review sources inside their original Workspace")
    root.mkdir(parents=True, exist_ok=True)
    receipt_path = root / "source-receipt.json"
    with held(root / "source.lock"):
        if receipt_path.is_file():
            return _verify_source(workspace, read_json(receipt_path), context)
        for relative, descriptor in context["members"].items():
            original = verify_file(context["directory"], descriptor)
            _copy_original(original, root / "report" / relative, descriptor)
        originals = {relative: describe_file(root, root / "report" / relative)
                     for relative in context["members"]}
        primary = originals[context["primary"]]
        record = context["record"]
        source_id = "scientific-report-review-" + context["source_key"]
        entry = {
            "id": source_id, "kind": "document", "role": ROLE,
            "title": record["title"],
            "uri": "urn:upstate:scientific-report:" + workspace.project["id"] + ":" + record["id"],
            "vintage": "Saved scientific edition " + record["id"],
            "description": "Completed original scientific report with its PDF, data, figures, "
                           "source members and immutable edition records.",
            **primary,
            "companions": [row for name, row in originals.items() if name != context["primary"]],
            "metadata": {
                "report_schema": scientific_report_editions.SCHEMA,
                "scientific_report_identity": deepcopy(context["identity"]),
                "scientific_report_edition_id": record["id"],
                "ordered_observed_source_binding": deepcopy(record["render_identity"]["binding"]),
                "original_study_count": record["source_count"],
                "section_count": record["section_count"], "figure_count": record["figure_count"],
            },
        }
        manifest = {"schema": "upstate.sources/v1",
                    "title": record["title"] + " — original scientific review edition",
                    "entries": [entry],
                    "notes": ["Native rendered report files are retained unchanged in one relative tree.",
                              "Original observed study ordering and source binding remain in the edition metadata."]}
        atomic_json(root / "model-sources.json", manifest, immutable=True)
        collection = workspace.import_sources(root / "model-sources.json")
        receipt = {
            "schema": SCHEMA, "source_identity": context["identity"],
            "source_collection_id": collection["id"], "source_id": source_id,
            "source_collection_sha256": digest(collection),
            "directory": root.relative_to(workspace.root).as_posix(),
            "files": [describe_file(workspace.root, root / "model-sources.json"),
                      *[describe_file(workspace.root, root / "report" / relative)
                        for relative in sorted(context["members"])]],
        }
        _verify_source(workspace, receipt, context)
        atomic_json(receipt_path, receipt, immutable=True)
        return receipt


def create_review(workspace, edition_id, review_selection, *, expected_operation_id, created_at):
    """Prepare an original review using its queue-retained creation timestamp."""
    workspace = _workspace(workspace)
    context = _context(workspace, edition_id, review_selection)
    if expected_operation_id != context["operation_id"]:
        raise ValueError("The report edition or review questions changed; preview them again")
    original_time = reviews._date(created_at, "Review creation time")
    source = _source(workspace, context)
    selection = {"schema": reviews.SELECTION_SCHEMA, **deepcopy(context["draft"]),
                 "source_collection_ids": [source["source_collection_id"]],
                 "run_ids": [], "delivery_ids": [], "spatial_export_ids": []}
    review = reviews.create_review(workspace, selection, created_at=original_time)
    reviewed = reviews.show_review(workspace, review["id"], previews=False)
    if reviewed["review"]["id"] != review["id"]:
        raise ValueError("The created customer review could not be reopened")
    return {
        "schema": SCHEMA, "state": "complete", "operation_id": context["operation_id"],
        "scientific_report_edition_id": context["record"]["id"],
        "review_id": review["id"], "created_at": original_time,
        "title": review["title"], "purpose": review["purpose"],
        "source_collection_id": source["source_collection_id"], "source_id": source["source_id"],
        "source_identity": context["identity"], "review_selection": selection,
        "artifact_count": len(review["artifacts"]),
        "original_study_count": context["record"]["source_count"],
        "source_member_count": len(context["members"]),
        "source_directory": source["directory"],
        "source_receipt": describe_file(workspace.root, workspace.root / source["directory"] / "source-receipt.json"),
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--edition-id", required=True)
    parser.add_argument("--review-selection", required=True, type=Path)
    parser.add_argument("--preview", action="store_true")
    parser.add_argument("--expected-operation-id")
    parser.add_argument("--created-at")
    args = parser.parse_args(argv)
    selection = read_json(args.review_selection)
    if args.preview:
        result = preview_review(args.workspace, args.edition_id, selection)
    else:
        if not args.expected_operation_id or not args.created_at:
            parser.error("Review creation needs the preview operation ID and original creation timestamp")
        result = create_review(args.workspace, args.edition_id, selection,
                               expected_operation_id=args.expected_operation_id, created_at=args.created_at)
    print(json.dumps(result, ensure_ascii=False, sort_keys=True, allow_nan=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
