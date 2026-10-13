"""Explicitly admit one captured external review through the original importer.

The foreign report, original review ZIP and scientific source edition remain
immutable. Admission creates a local editable review through PublishedStudyReviews,
retaining the original source and import lineage for later selected-Study exports.
"""
from __future__ import annotations

from collections import OrderedDict
from copy import deepcopy
import json
import threading

from .common import atomic_json, canonical, describe_file, digest, file_digest, held, identifier, now, read_json, verify_file

DIRECTORY = "published-review-admissions"
SCHEMA = "upstate.published-review-admission/v1"
EDITION = "captured-original-review/1"


def _require(condition, message):
    if not condition:
        raise ValueError(message)


def _reviews(workspace):
    from measurement_workspace.published_studies import PublishedStudyStore
    from measurement_workspace.study_reviews import PublishedStudyReviews
    return PublishedStudyReviews(PublishedStudyStore(workspace, workspace.root / "published_studies"))


def _captured(workspace, identity):
    """Read original typed source bytes without requiring the entire old Study."""
    from .study_transfer import _Closure
    from .published_review_study_transfer import _capture
    closure = _Closure(workspace, identity["study_selection"])
    source = identity["source"]
    collection_id = identifier(source["source_collection_id"])
    collection = closure.read("sources/" + collection_id + ".json")
    _require(digest(collection) == collection_id, "The original review source collection changed")
    entries = [row for row in collection["entries"] if row["id"] == source["source_id"]]
    _require(len(entries) == 1 and entries[0]["body"]["sha256"] == identity["source_body_sha256"],
             "The original captured review source changed")
    key, source_identity, review, record, recipe, members = _capture(closure, entries[0])
    before = identity["captured_lineage"]
    _require(
        before["report_context_kind"] == "published_study_review"
        and before["relationship"] == "external_project"
        and before["source_project_id"] == source_identity["workspace_id"] != identity["project_id"]
        and before["source_collection_id"] == collection_id
        and before["source_id"] == source["source_id"]
        and before["source_body_sha256"] == identity["source_body_sha256"]
        and before["published_review_report_id"] == key
        and before["review_id"] == review["id"]
        and before["review_sha256"] == source_identity["review"]["sha256"]
        and before["original_study"] == source_identity["binding"] == review["content"]["binding"]
        and before["selection"] == source_identity["selection"] == review["content"]["selection"]
        and before["interpretation_sha256"] == source_identity["interpretation_sha256"]
        and before["original_review_archive_sha256"] == members["original-review.zip"]["sha256"],
        "The admission differs from the received original review and interpretation")
    archive = members["original-review.zip"]
    archive_descriptor = {"path": archive["object"], "bytes": archive["bytes"], "sha256": archive["sha256"]}
    archive_path = verify_file(workspace.root, archive_descriptor)
    closure.assert_unchanged()
    return review, record, archive_descriptor, archive_path


def _context(workspace, payload):
    from . import study_receiving
    _require(isinstance(payload, dict) and not set(payload) - {
        "study_id", "source_collection_id", "source_id", "source_body_sha256",
        "review_id", "archive_sha256", "admission_id"},
        "Select the received Study and its exact original review source")
    study_id = identifier(payload.get("study_id"))
    source = {"source_collection_id": identifier(payload.get("source_collection_id")),
              "source_id": payload.get("source_id")}
    _require(isinstance(source["source_id"], str) and source["source_id"],
             "Choose the original captured source")
    # The existing reader verifies all original selected-Study lineage before
    # this explicit admission can be created. Later get/export only needs the
    # retained source and admission, so a revised-only export stays independent.
    detail = study_receiving.detail(workspace, study_id)
    rows = [row for row in detail.get("published_reviews", []) if row["source"] == source]
    _require(len(rows) == 1, "Choose a saved review captured in this received Study")
    selected = rows[0]
    _require(selected["relationship"] == "external_project" and selected["native"] is None,
             "Open the existing native review for a source already local to this project")
    _require(selected["source_body_sha256"] == identifier(payload.get("source_body_sha256"))
             and selected["review"]["id"] == payload.get("review_id")
             and selected["original_review_archive_sha256"] == identifier(payload.get("archive_sha256")),
             "Reopen the exact captured review before admitting it")
    retained = study_receiving._receipt(workspace, study_id)
    lineage = [row for row in retained["identity"].get("scientific_report_sources", [])
               if row.get("source_collection_id") == source["source_collection_id"]
               and row.get("source_id") == source["source_id"]
               and row.get("report_context_kind") == "published_study_review"]
    _require(len(lineage) == 1, "The saved Study lost its original review lineage")
    identity = {
        "edition": EDITION, "producer_sha256": file_digest(__file__),
        "project_id": workspace.project["id"], "study_id": study_id,
        "study_selection": deepcopy(retained["identity"]["selection"]),
        "source": source, "source_body_sha256": selected["source_body_sha256"],
        "captured_lineage": deepcopy(lineage[0]),
    }
    key = digest(identity)
    if payload.get("admission_id") is not None:
        _require(identifier(payload["admission_id"]) == key,
                 "The original review preview changed; reopen this captured source")
    review, record, archive, path = _captured(workspace, identity)
    _require(review == selected["review"], "The received view differs from its original saved review")
    return identity, key, review, record, archive, path


def preview(workspace, payload):
    identity, key, review, record, archive, path = _context(workspace, payload)
    receipt = workspace.root / DIRECTORY / key / "receipt.json"
    return {
        "schema": SCHEMA, "id": key, "project_id": workspace.project["id"],
        "source": deepcopy(identity["source"]), "source_body_sha256": identity["source_body_sha256"],
        "source_project_id": identity["captured_lineage"]["source_project_id"],
        "review_id": review["id"], "title": review["content"]["title"],
        "binding": deepcopy(review["content"]["binding"]),
        "selection": deepcopy(review["content"]["selection"]), "archive": archive,
        "existing_admission": get(workspace, key) if receipt.exists() else None,
    }


def create(workspace, payload):
    _require(isinstance(payload, dict) and payload.get("admission_id") is not None,
             "Preview this exact captured review before admitting it")
    identity, key, review, record, archive, path = _context(workspace, payload)
    directory = workspace.root / DIRECTORY / key
    with held(directory / ".admission.lock", blocking=False):
        if (directory / "receipt.json").exists():
            return get(workspace, key)
        plan_path = directory / "admission.json"
        previous = read_json(plan_path) if plan_path.exists() else None
        created_at = previous["created_at"] if previous else now()
        plan = {"schema": SCHEMA, "id": key, "identity": identity, "created_at": created_at,
                "original_review": deepcopy(review), "archive": deepcopy(archive)}
        atomic_json(plan_path, plan, immutable=True)
        # This original importer preserves an existing current study edition
        # (make_current=False) and independently validates the complete archive,
        # original study binding, canonical filters and immutable review content.
        imported = _reviews(workspace).receive(path, operation_id="review-admission-" + key)
        local = imported["review"]
        _require(local["id"] == review["id"] and local["content"] == review["content"],
                 "The admitted review changed its original content or selection")
        review_path = workspace.root / "published_studies" / "reviews" / (review["id"] + ".json")
        receipt = {
            "schema": SCHEMA, "id": key, "state": "complete", "identity": identity,
            "created_at": created_at, "project_id": workspace.project["id"],
            "source_project_id": identity["captured_lineage"]["source_project_id"],
            "original_source": deepcopy(identity["source"]),
            "original_source_body_sha256": identity["source_body_sha256"],
            "review_id": local["id"], "title": local["content"]["title"],
            "binding": deepcopy(local["content"]["binding"]),
            "selection": deepcopy(local["content"]["selection"]),
            "review_saved_at": local["saved_at"],
            "files": {"admission": describe_file(workspace.root, plan_path),
                      "review": describe_file(workspace.root, review_path),
                      "original_review_archive": deepcopy(archive)},
        }
        atomic_json(directory / "receipt.json", receipt, immutable=True)
    return get(workspace, key)


def _retained(workspace, key):
    key = identifier(key)
    directory = workspace.root / DIRECTORY / key
    receipt = read_json(directory / "receipt.json")
    _require(receipt.get("schema") == SCHEMA and receipt.get("state") == "complete"
             and receipt.get("id") == key == digest(receipt.get("identity"))
             and receipt.get("project_id") == workspace.project["id"] == receipt["identity"].get("project_id"),
             "Choose an original review admission in this project")
    identity = receipt["identity"]
    _require(receipt["source_project_id"] == identity["captured_lineage"]["source_project_id"]
             and receipt["original_source"] == identity["source"]
             and receipt["original_source_body_sha256"] == identity["source_body_sha256"],
             "The admission changed its original source identity")
    expected_plan = DIRECTORY + "/" + key + "/admission.json"
    expected_review = "published_studies/reviews/" + identity["captured_lineage"]["review_id"] + ".json"
    _require(receipt["files"]["admission"]["path"] == expected_plan
             and receipt["files"]["review"]["path"] == expected_review,
             "The admission points outside its original records")
    for descriptor in receipt["files"].values():
        verify_file(workspace.root, descriptor)
    plan = read_json(workspace.root / expected_plan)
    original, record, archive, path = _captured(workspace, identity)
    _require(plan == {"schema": SCHEMA, "id": key, "identity": identity,
                      "created_at": receipt["created_at"], "original_review": original, "archive": archive}
             and receipt["files"]["original_review_archive"] == archive,
             "The admission lost its exact original review or archive")
    from measurement_workspace.study_reviews import PublishedStudyReviews
    value = PublishedStudyReviews._validate(read_json(workspace.root / expected_review), receipt["review_id"])
    _require(value["id"] == original["id"] == receipt["review_id"]
             and value["content"] == original["content"]
             and value["content"]["title"] == receipt["title"]
             and value["content"]["binding"] == receipt["binding"]
             and value["content"]["selection"] == receipt["selection"]
             and value["saved_at"] == receipt["review_saved_at"],
             "The native editable review differs from its original admission")
    return {**receipt, "native": {"review_id": value["id"], "study_id": receipt["binding"]["study_id"],
                       "version_id": receipt["binding"]["version_id"]},
            "files": {**receipt["files"],
                      "receipt": describe_file(workspace.root, directory / "receipt.json")}}


def get(workspace, key):
    receipt = _retained(workspace, key)
    local = _reviews(workspace).get(receipt["review_id"])
    _require(local["review"]["content"]["binding"] == receipt["binding"]
             and local["review"]["content"]["selection"] == receipt["selection"],
             "The editable review no longer resolves to its original source selection")
    return {**receipt, "interpretation_matches_snapshot": local["interpretation_matches_snapshot"]}


# A listing may reuse prior retained-admission validation only while every
# original dependency has the same ordinary-file identity. Full get/capture
# paths below never use this cache. Budgets bound memory, not valid admissions.
_LISTING_FIELDS = (
    "id", "created_at", "title", "source_project_id", "original_source",
    "review_id", "binding", "selection", "native",
)
_LISTING_MAX_ENTRIES = 128
_LISTING_MAX_BYTES = 8 * 1024 * 1024
_listing_entries = OrderedDict()
_listing_bytes = 0
_listing_lock = threading.RLock()


def _listing_identity(root, relative):
    from .study_transfer import _identity, _member
    return _identity(_member(root, relative))


def _listing_document(root, relative, dependencies):
    from .study_transfer import _member
    before = _listing_identity(root, relative)
    if relative in dependencies and dependencies[relative] != before:
        raise ValueError("The original admission changed during metadata reading: " + relative)
    value = read_json(_member(root, relative))
    if _listing_identity(root, relative) != before:
        raise ValueError("The original admission changed during metadata reading: " + relative)
    dependencies[relative] = before
    return value


def _listing_unchanged(root, dependencies):
    return all(_listing_identity(root, name) == tuple(expected)
               for name, expected in dependencies.items())


def _listing_dependencies(workspace, key):
    """Snapshot every raw dependency used by the original _retained reader."""
    root = workspace.root.resolve()
    dependencies = {}
    receipt_path = DIRECTORY + "/" + identifier(key) + "/receipt.json"
    receipt = _listing_document(root, receipt_path, dependencies)
    source = receipt["identity"]["source"]
    collection_id = identifier(source["source_collection_id"])
    collection = _listing_document(root, "sources/" + collection_id + ".json", dependencies)
    entries = [row for row in collection["entries"] if row["id"] == source["source_id"]]
    _require(len(entries) == 1, "The admission needs its original captured source")
    entry = entries[0]
    paths = [row["path"] for row in receipt["files"].values()]
    paths.extend(row["object"] for row in [entry["body"], *entry.get("companions", [])])
    for relative in paths:
        current = _listing_identity(root, relative)
        if relative in dependencies and dependencies[relative] != current:
            raise ValueError("The original admission changed during metadata reading: " + relative)
        dependencies[relative] = current
    _require(_listing_unchanged(root, dependencies),
             "The original admission changed before metadata validation")
    return dependencies


def _listing_projection(workspace, key):
    global _listing_bytes
    root = workspace.root.resolve()
    cache_key = (str(root), workspace.project["id"], identifier(key))
    with _listing_lock:
        encoded = _listing_entries.get(cache_key)
    if encoded is not None:
        cached = json.loads(encoded)
        try:
            unchanged = _listing_unchanged(root, cached["dependencies"])
        except (OSError, ValueError):
            unchanged = False
        if unchanged:
            with _listing_lock:
                if _listing_entries.get(cache_key) is encoded:
                    _listing_entries.move_to_end(cache_key)
            return cached["summary"]
        with _listing_lock:
            removed = _listing_entries.pop(cache_key, None)
            if removed is not None:
                _listing_bytes -= len(removed)
    dependencies = _listing_dependencies(workspace, key)
    value = _retained(workspace, key)
    _require(_listing_unchanged(root, dependencies),
             "The original admission changed during full listing validation")
    summary = {name: deepcopy(value[name]) for name in _LISTING_FIELDS}
    encoded = canonical({"dependencies": dependencies, "summary": summary})
    # Cache only canonical bytes: caller edits never change the retained value.
    # A large valid projection simply uses its original uncached read.
    with _listing_lock:
        removed = _listing_entries.pop(cache_key, None)
        if removed is not None:
            _listing_bytes -= len(removed)
        if _LISTING_MAX_ENTRIES and len(encoded) <= _LISTING_MAX_BYTES:
            while _listing_entries and (
                    len(_listing_entries) >= _LISTING_MAX_ENTRIES
                    or _listing_bytes + len(encoded) > _LISTING_MAX_BYTES):
                _, removed = _listing_entries.popitem(last=False)
                _listing_bytes -= len(removed)
            _listing_entries[cache_key] = encoded
            _listing_bytes += len(encoded)
    return summary


def list_admissions(workspace, *, study_id=None, source=None, binding=None,
                    sources=None, metadata_only=False):
    """List exact admissions; opt-in UI metadata may reuse stable validation."""
    if type(metadata_only) is not bool:
        raise ValueError("Choose an explicit metadata listing mode")
    rows = []
    for path in sorted((workspace.root / DIRECTORY).glob("*/receipt.json")):
        receipt = read_json(path)
        identity = receipt.get("identity", {})
        if study_id is not None and identity.get("study_id") != study_id:
            continue
        if source is not None and identity.get("source") != source:
            continue
        if sources is not None and identity.get("source") not in sources:
            continue
        if binding is not None and receipt.get("binding") != binding:
            continue
        if metadata_only:
            value = _listing_projection(workspace, path.parent.name)
        else:
            value = _retained(workspace, path.parent.name)
        rows.append({name: deepcopy(value[name]) for name in _LISTING_FIELDS})
    return rows


def include_review(closure, review):
    """Retain source admission using raw records, without materializing views."""
    from measurement_workspace.study_reviews import _binding
    binding = review["content"]["binding"]
    for row in list_admissions(closure.workspace, binding=binding):
        key = row["id"]
        prefix = DIRECTORY + "/" + key + "/"
        receipt = closure.read(prefix + "receipt.json")
        for descriptor in receipt["files"].values():
            closure.add_file(descriptor["path"], descriptor)
        # A revision or Save-as-new review still uses this admitted source
        # edition. Retain its initial review independently; no parent chain or
        # changed review identity is invented.
        original_review = closure.read(receipt["files"]["review"]["path"])
        _require(original_review["id"] == receipt["review_id"]
                 and original_review["content"]["binding"] == binding,
                 "The selected source edition lost its initial admitted review")
        study_prefix = "published_studies/" + binding["study_id"] + "/" + binding["version_id"] + "/"
        original_record = closure.read(study_prefix + "record.json")
        _require(_binding(original_record) == binding, "The admitted original study changed")
        closure.add_file(study_prefix + "sources.json", original_record["source_manifest"])
        for item in original_record["source_files"]:
            closure.add_file(study_prefix + "source/" + item["path"], item)
        closure.need("sources", identifier(binding["source_collection_id"]),
                     "Original study edition retained with explicit review admission")
        parent_id = identifier(receipt["original_source"]["source_collection_id"])
        closure.need("sources", parent_id,
                     "Original foreign scientific review retained with its explicit admission")


def verify_all(workspace):
    for path in sorted((workspace.root / DIRECTORY).glob("*/receipt.json")):
        get(workspace, path.parent.name)
