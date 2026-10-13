"""Keep saved Published-study reviews editable in selected scientific studies.

This resolver is called only for an explicitly ordered scientific-report source.
It reads exact retained CAS/document bytes and follows the original same-project
review and study edition without materializing views or reinterpreting records.
"""
from __future__ import annotations

from copy import deepcopy

from .common import digest, identifier
from .published_review_report_source import FOLDER, SCHEMA, RECIPE_SCHEMA, _relative
from measurement_workspace.study_reviews import PublishedStudyReviews, _binding


def _same(first, second):
    return all(first.get(field) == second.get(field) for field in ("bytes", "sha256"))


def _body(closure, descriptor):
    closure.add_file(descriptor["object"], descriptor)
    return closure.read(descriptor["object"])


def _capture(closure, entry):
    metadata = entry["metadata"]
    key = identifier(metadata.get("published_review_report_id"))
    if (entry.get("kind") != "document" or entry.get("id") != "published-review-" + key
            or entry.get("uri") != "urn:upstate:published-review-report:" + key
            or metadata.get("report_schema") != RECIPE_SCHEMA
            or metadata.get("scientific_scope") != "saved_review_selected_interpretation"):
        raise ValueError("The selected review source differs from its original producer")
    recipe = _body(closure, entry["body"])
    if recipe.get("schema") != RECIPE_SCHEMA:
        raise ValueError("The saved review source needs its original scientific recipe")
    members = {}
    for item in entry.get("companions", []):
        name = _relative(item.get("view_path", item["filename"]))
        if name in members:
            raise ValueError("The saved review source repeats an original companion")
        closure.add_file(item["object"], item)
        members[name] = item
    requested = recipe.get("inputs")
    if not isinstance(requested, list) or not requested:
        raise ValueError("The saved review recipe lost its original inputs")
    selected = set()
    for item in requested:
        name = _relative(item["path"])
        if name in selected or name not in members or not _same(item, members[name]):
            raise ValueError("The review recipe lost an exact selected input: " + name)
        selected.add(name)
    if selected != set(members):
        raise ValueError("The review source companions differ from its complete scientific recipe")

    def original(name):
        if name not in selected:
            raise ValueError("The review source lacks its original " + name)
        return _body(closure, members[name])

    identity = original("identity.json")
    review = original("review.json")
    PublishedStudyReviews._validate(review)
    context = original("selected-context.json")
    record = original("original-record.json")
    source_manifest = original("original-sources.json")
    lineage = original("lineage.json")
    checkpoint = original("export-capture.json")
    if (identity.get("schema") != SCHEMA or digest(identity) != key
            or not isinstance(identity.get("workspace_id"), str) or not identity["workspace_id"]
            or identity.get("review_id") != review["id"]
            or identity.get("selection") != review["content"]["selection"]
            or identity.get("binding") != review["content"]["binding"]
            or not _same(identity.get("review", {}), members["review.json"])
            or digest(context) != identity.get("interpretation_sha256")
            or context.get("selection") != identity["selection"]
            or _binding(context["record"]) != identity["binding"]
            or _binding(record) != identity["binding"]
            or metadata.get("source_project_id") != identity["workspace_id"]
            or metadata.get("review_id") != review["id"]
            or recipe.get("edition") != identity.get("edition")
            or recipe.get("title") != review["content"]["title"]):
        raise ValueError("The scientific source changed its original review or selected interpretation")
    if (source_manifest.get("schema") != "upstate.sources/v1"
            or members["original-sources.json"]["sha256"] != identity["binding"]["source_manifest_sha256"]
            or not _same(record["source_manifest"], members["original-sources.json"])
            or checkpoint.get("schema") != "upstate.published-review-export-capture/v1"
            or checkpoint.get("review_id") != review["id"]
            or not _same(checkpoint.get("archive", {}), members["original-review.zip"])
            or checkpoint.get("original_export_index", {}).get("review_id") != review["id"]):
        raise ValueError("The review source lost its complete original study/export binding")
    export_index = checkpoint["original_export_index"]
    original_files = {item["path"]: item for item in export_index.get("files", [])}
    if (export_index.get("schema") != "upstate.published-study-review-export/v1"
            or not _same(original_files.get("review.json", {}), members["review.json"])
            or "original-study.zip" not in original_files
            or "selected/selected-context.json" not in original_files):
        raise ValueError("The original review archive lost its editable study or selection")
    if (lineage.get("schema") != "upstate.published-review-report-lineage/v1"
            or lineage.get("report_id") != key or lineage.get("review_id") != review["id"]
            or lineage.get("source_project_id") != identity["workspace_id"]
            or lineage.get("binding") != identity["binding"]
            or lineage.get("selection") != identity["selection"]
            or lineage.get("review_sha256") != identity["review"]["sha256"]
            or lineage.get("interpretation_sha256") != identity["interpretation_sha256"]
            or lineage.get("interpretation_matches_snapshot") != identity["interpretation_matches_snapshot"]):
        raise ValueError("The review report lineage differs from its captured source")
    for name, descriptor in identity.get("implementation", {}).items():
        member = members.get("implementation/" + _relative(name))
        if member is None or not _same(descriptor, member):
            raise ValueError("The selected interpretation lost its producing implementation")
    csv_index = original("selected-records/index.json")
    if csv_index.get("selection") != identity["selection"]:
        raise ValueError("The selected original-cell inventory changed its review cohort")
    for item in csv_index.get("files", []):
        name = _relative(item["path"])
        before = original_files.get(item["original_export_path"])
        if name not in members or not _same(item, members[name]) or not before or not _same(item, before):
            raise ValueError("A selected CSV differs from the original review export")
    return key, identity, review, record, recipe, members


def _local(closure, key, identity, review, record, entry, recipe, members):
    reason = "Original editable saved observation review " + review["id"]
    prefix = FOLDER + "/" + key + "/"
    result = closure.read(prefix + "result.json")
    if (result.get("schema") != SCHEMA or result.get("state") != "complete"
            or result.get("id") != key or result.get("identity") != identity
            or result.get("review_id") != review["id"]
            or result.get("workspace_id") != identity["workspace_id"]
            or result.get("selection") != identity["selection"]):
        raise ValueError("The editable review source differs from its original completed edition")
    for name, item in members.items():
        closure.add_file(prefix + name, item)
    closure.add_file(prefix + "observed-report.json", entry["body"])
    if closure.read(prefix + "observed-report.json") != recipe:
        raise ValueError("The editable review source changed its original recipe")
    for item in result["files"].values():
        closure.add_file(prefix + _relative(item["path"]), item)
    local_source = result["source_choice"]
    original_collection_id = identifier(local_source["source_collection_id"])
    collection = closure.read("sources/" + original_collection_id + ".json")
    if collection.get("schema") != "upstate.sources/v1" or digest(collection) != original_collection_id:
        raise ValueError("The review's original imported source collection changed")
    original_entries = [item for item in collection["entries"] if item["id"] == local_source["source_id"]]
    if (local_source["source_id"] != entry["id"] or len(original_entries) != 1
            or not _same(original_entries[0]["body"], entry["body"])):
        raise ValueError("The editable review source changed its imported document binding")
    closure.need("sources", original_collection_id, reason)
    # Original store IDs are not model hex-only IDs; their strict review
    # validator and exact source binding above govern these native paths.
    binding = identity["binding"]
    study_id, version_id = binding["study_id"], binding["version_id"]
    study_prefix = "published_studies/" + study_id + "/" + version_id + "/"
    local_record = closure.read(study_prefix + "record.json")
    if _binding(local_record) != binding:
        raise ValueError("The editable published study changed its original source edition")
    closure.add_file(study_prefix + "sources.json", members["original-sources.json"])
    if closure.read(study_prefix + "sources.json") != _body(closure, members["original-sources.json"]):
        raise ValueError("The editable published study changed its original source manifest")
    # Capture the exact original source files, not unrelated installed studies
    # or a mutable current-version pointer.
    for item in record["source_files"]:
        closure.add_file(study_prefix + "source/" + _relative(item["path"]), item)
    review_path = "published_studies/reviews/" + review["id"] + ".json"
    closure.add_file(review_path, members["review.json"])
    if closure.read(review_path) != review:
        raise ValueError("The editable saved review differs from its captured original")
    closure.need("sources", identifier(binding["source_collection_id"]), reason)
    closure.tree(prefix.rstrip("/"))
    return {"review_path": review_path, "study_prefix": study_prefix.rstrip("/"),
            "source_product_path": prefix.rstrip("/")}


def include_source(closure, collection_id, entry):
    """Follow this producer only for an explicitly ordered saved-report source."""
    metadata = entry.get("metadata") or {}
    if "published_review_report_id" not in metadata:
        return False
    identifier(collection_id)
    key, identity, review, record, recipe, members = _capture(closure, entry)
    local = identity["workspace_id"] == closure.workspace.project["id"]
    editable = _local(closure, key, identity, review, record, entry, recipe, members) if local else None
    binding = {
        "schema": "upstate.study-report-lineage/v1",
        "source_collection_id": collection_id, "source_id": entry["id"],
        "source_body_sha256": entry["body"]["sha256"],
        "source_project_id": identity["workspace_id"],
        "report_context_kind": "published_study_review",
        "published_review_report_id": key, "producer_edition": identity["edition"],
        "review_id": review["id"], "review_sha256": identity["review"]["sha256"],
        "original_study": deepcopy(identity["binding"]),
        "selection": deepcopy(identity["selection"]),
        "interpretation_sha256": identity["interpretation_sha256"],
        "interpretation_matches_snapshot": identity["interpretation_matches_snapshot"],
        "relationship": "same_project" if local else "external_project",
        "editable": editable,
        "required_records": [{"kind": "sources", "id": identity["binding"]["source_collection_id"]}] if local else [],
        "original_review_archive_sha256": members["original-review.zip"]["sha256"],
    }
    pair = (collection_id, entry["id"])
    previous = closure.report_source_records.get(pair)
    if previous is not None and previous != binding:
        raise ValueError("The saved review lineage changed during study capture")
    closure.report_source_records[pair] = binding
    return True
