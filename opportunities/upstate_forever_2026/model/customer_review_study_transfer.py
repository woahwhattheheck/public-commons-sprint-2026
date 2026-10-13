"""Editable transfer of the original customer review and response history.

TokenJunkieLabs. The maintained reviews, handback and reconciliation modules
remain authoritative. Capture reads their native records and CAS files without
creating source views, exporting a new review, or modifying customer decisions.
"""
from __future__ import annotations

from copy import deepcopy
from pathlib import Path

from .common import digest, identifier, read_json
from . import reviews, review_handback, review_receiving, review_reconciliation
from . import scientific_report_study_transfer as report_editions
from . import report_changes_review as comparison_review

ROOT_KINDS = ("reviews",)
IMMUTABLE_KINDS = ("reviews", "review-responses", "review-handbacks",
                   "review-receipts", "review-packet-views")
LABELS = {
    "reviews": "Customer reviews", "review-responses": "Customer response history",
    "review-handbacks": "Engineering handbacks", "review-receipts": "Received review packages",
    "review-packet-views": "Original review viewer records",
}
SCHEMA = "upstate.study-customer-review/v1"
REPORT_SCHEMA = "upstate.scientific-report-review/v1"
REPORT_ROLE = "SCIENTIFIC_REPORT_REVIEW"


def _state(closure):
    if not hasattr(closure, "customer_review_records"):
        closure.customer_review_records = {}
    return closure.customer_review_records


def _record(closure, kind, key):
    key = identifier(key)
    raw = closure.read(kind + "/" + key + ".json")
    if raw.get("schema") != "upstate." + kind + "/v1" or digest(raw) != key:
        raise ValueError("An original customer review record changed: " + kind + "/" + key)
    return {**raw, "id": key}


def _scan(closure, kind):
    """Index native metadata once; capture only records actually in the closure."""
    name = "_customer_review_index"
    indexes = getattr(closure, name, None)
    if indexes is None:
        indexes = {}
        setattr(closure, name, indexes)
    if kind not in indexes:
        rows = []
        for path in sorted((closure.root / kind).glob("*.json")):
            identifier(path.stem)
            original = reviews._regular(closure.root, path.relative_to(closure.root).as_posix())
            raw = reviews._read_json_file(original)
            if not isinstance(raw, dict):
                raise ValueError("An original customer review index is not a record.")
            rows.append({**raw, "id": path.stem})
        indexes[kind] = rows
    return indexes[kind]


def _member(closure, name, expected=None):
    closure.add_file(reviews._relative(name), expected)
    row = closure.files[name]
    if row.get("sha256") is None:
        # Unstamped members here are JSON records, never arbitrary binary data.
        closure.read(name)
        row = closure.files[name]
    return {"path": name, "bytes": row["bytes"], "sha256": row["sha256"]}


def _scientific_source(closure, collection_id, entry):
    """Bind the exact S1 source tree to its saved native scientific edition."""
    metadata = entry.get("metadata") or {}
    if entry.get("role") != REPORT_ROLE:
        return None
    identity = metadata.get("scientific_report_identity")
    if (not isinstance(identity, dict) or identity.get("schema") != REPORT_SCHEMA
            or metadata.get("report_schema") != report_editions.SCHEMA):
        raise ValueError("The customer scientific report lost its original typed identity.")
    if identity.get("project_id") != closure.workspace.project["id"]:
        # Imported foreign sources remain complete CAS originals. Never resolve
        # their producer identifiers against this receiving project's records.
        return {"project_id": identity.get("project_id"), "external": True,
                "source_collection_id": collection_id, "source_id": entry["id"],
                "scientific_report_edition_id": identity.get("scientific_report_edition_id")}
    edition_id = identifier(identity.get("scientific_report_edition_id"))
    source_key = digest(identity)
    if (metadata.get("scientific_report_edition_id") != edition_id
            or entry.get("id") != "scientific-report-review-" + source_key
            or entry.get("uri") != "urn:upstate:scientific-report:" +
               closure.workspace.project["id"] + ":" + edition_id):
        raise ValueError("The customer report source changed its original edition linkage.")
    prefix = report_editions.KIND + "/" + edition_id + "/"
    edition = closure.read(prefix + "edition.json")
    render_identity = report_editions._record(closure.workspace, edition_id, edition)
    if (digest(edition) != identity.get("edition_record_sha256")
            or render_identity != identity.get("render_identity")
            or metadata.get("ordered_observed_source_binding") != render_identity.get("binding")):
        raise ValueError("The review source no longer matches its original scientific edition.")
    declared = {}
    for item in identity.get("members", []):
        if not isinstance(item, dict):
            raise ValueError("The customer report needs its complete original member inventory.")
        name = reviews._relative(item.get("path"))
        if name in declared:
            raise ValueError("The customer report repeats an original source member.")
        declared[name] = {key: item[key] for key in ("bytes", "sha256")}
    actual = {}
    for item in edition.get("files", {}).values():
        name = reviews._relative(item["path"])
        value = {key: item[key] for key in ("bytes", "sha256")}
        if name in actual and actual[name] != value:
            raise ValueError("The saved report has conflicting member descriptors.")
        actual[name] = value
    for name in ("edition.json", "operation.json"):
        row = _member(closure, prefix + name)
        actual[name] = {key: row[key] for key in ("bytes", "sha256")}
    if declared != actual or identity.get("primary_path") != edition["files"]["report_html"]["path"]:
        raise ValueError("The customer review lost the full original report edition tree.")
    body_name = entry["body"].get("view_path", entry["body"]["filename"])
    primary = identity["primary_path"]
    prefix_in_source = "" if body_name == primary else "report/" if body_name == "report/" + primary else None
    if prefix_in_source is None:
        raise ValueError("The customer report HTML changed its original relative path.")
    source_members = {}
    for part in [entry["body"], *entry.get("companions", [])]:
        name = reviews._relative(part.get("view_path", part["filename"]))
        if name in source_members:
            raise ValueError("The customer report source repeats a member path.")
        source_members[name] = {key: part[key] for key in ("bytes", "sha256")}
        closure.add_file(part["object"], part)
    if source_members != {prefix_in_source + name: row for name, row in actual.items()}:
        raise ValueError("The original review source no longer contains its complete report.")
    folder = "scientific-report-reviews/" + source_key + "/source"
    receipt_name = folder + "/source-receipt.json"
    original = closure.read(receipt_name)
    collection = _record(closure, "sources", collection_id)
    if (original.get("schema") != REPORT_SCHEMA or original.get("source_identity") != identity
            or original.get("source_collection_id") != collection_id
            or original.get("source_id") != entry["id"]
            or original.get("source_collection_sha256") != digest(collection)
            or original.get("directory") != folder):
        raise ValueError("The original scientific review source receipt changed.")
    expected_paths = {folder + "/model-sources.json",
                      *(folder + "/report/" + name for name in actual)}
    copied = original.get("files")
    if (not isinstance(copied, list) or len(copied) != len(expected_paths)
            or {row.get("path") for row in copied} != expected_paths):
        raise ValueError("The customer review lost its original source capture.")
    for item in copied:
        name = item["path"]
        if name.startswith(folder + "/report/"):
            expected = actual[name[len(folder + "/report/"):]]
            if any(item.get(field) != expected[field] for field in ("bytes", "sha256")):
                raise ValueError("The retained review copy differs from the original report.")
        closure.add_file(name, item)
    manifest = closure.read(folder + "/model-sources.json")
    source_original = collection["original_manifest"]
    manifest_file = closure.files[folder + "/model-sources.json"]
    if any(manifest_file[field] != source_original[field] for field in ("bytes", "sha256")):
        raise ValueError("The scientific review intake differs from its original source manifest.")
    if manifest.get("schema") != "upstate.sources/v1":
        raise ValueError("The scientific review intake has another source schema.")
    closure.need(report_editions.KIND, edition_id, "Scientific edition selected for customer review")
    return {"project_id": identity["project_id"], "external": False,
            "source_collection_id": collection_id, "source_id": entry["id"],
            "scientific_report_edition_id": edition_id, "source_key": source_key,
            "source_identity_sha256": source_key, "source_receipt": receipt_name}


def _comparison_source(closure, collection_id, entry):
    """Retain the exact complete pair selected as an ordinary review source."""
    if entry.get("role") != comparison_review.ROLE:
        return None
    metadata = entry.get("metadata") or {}
    identity = metadata.get("scientific_report_comparison_identity")
    declared = comparison_review.source_members(entry, identity)
    comparison_id = identifier(identity["comparison_id"])
    source_key = digest(identity)
    body_name = entry["body"].get("view_path", entry["body"]["filename"])
    prefix = "report/" if body_name == "report/index.html" else ""
    parts = {}
    for part in [entry["body"], *entry.get("companions", [])]:
        name = part.get("view_path", part["filename"])[len(prefix):]
        parts[name] = part
        closure.add_file(part["object"], part)
    copied_record = closure.read(parts["comparison.json"]["object"])
    if (copied_record.get("schema") != comparison_review.report_changes.SCHEMA
            or copied_record.get("state") != "complete"
            or copied_record.get("id") != comparison_id
            or digest(copied_record) != identity.get("comparison_record_sha256")
            or copied_record.get("identity") != identity["pair_identity"]):
        raise ValueError("The review source changed its original completed comparison")
    expected = {name: {field: item[field] for field in ("bytes", "sha256")}
                for name, item in copied_record["files"].items()}
    expected["comparison.json"] = {field: parts["comparison.json"][field]
                                    for field in ("bytes", "sha256")}
    if expected != declared:
        raise ValueError("The review source lost the exact complete comparison tree")
    base = {"project_id": identity["project_id"],
            "source_collection_id": collection_id, "source_id": entry["id"],
            "comparison_id": comparison_id,
            "left_edition_id": identity["pair_identity"]["left"]["edition_id"],
            "right_edition_id": identity["pair_identity"]["right"]["edition_id"],
            "source_identity_sha256": source_key}
    if identity["project_id"] != closure.workspace.project["id"]:
        return {**base, "external": True}
    current = comparison_review.comparison_context(closure.workspace, comparison_id)
    if current["identity"] != identity:
        raise ValueError("The customer review differs from its saved local comparison")
    folder = comparison_review.KIND + "/" + source_key + "/source"
    receipt_name = folder + "/source-receipt.json"
    receipt = closure.read(receipt_name)
    collection = _record(closure, "sources", collection_id)
    if (receipt.get("schema") != comparison_review.SCHEMA
            or receipt.get("source_identity") != identity
            or receipt.get("source_collection_id") != collection_id
            or receipt.get("source_id") != entry["id"]
            or receipt.get("source_collection_sha256") != digest(collection)
            or receipt.get("directory") != folder):
        raise ValueError("The original comparison review source receipt changed")
    expected_paths = {folder + "/model-sources.json",
                      *(folder + "/report/" + name for name in declared)}
    copies = receipt.get("files")
    if (not isinstance(copies, list) or len(copies) != len(expected_paths)
            or any(not isinstance(row, dict) for row in copies)
            or {row.get("path") for row in copies} != expected_paths):
        raise ValueError("The customer review lost its original comparison capture")
    for item in copies:
        name = item["path"]
        if name.startswith(folder + "/report/"):
            native = declared[name[len(folder + "/report/"):]]
            if any(item.get(field) != native[field] for field in ("bytes", "sha256")):
                raise ValueError("The retained review copy differs from the original comparison")
        closure.add_file(name, item)
    manifest = closure.read(folder + "/model-sources.json")
    original = collection["original_manifest"]
    copied = closure.files[folder + "/model-sources.json"]
    if (manifest.get("schema") != "upstate.sources/v1"
            or any(copied[field] != original[field] for field in ("bytes", "sha256"))):
        raise ValueError("The comparison review intake changed its original source manifest")
    closure.need(comparison_review.report_changes.KIND, comparison_id,
                 "Complete scientific report comparison selected for customer review")
    return {**base, "external": False, "source_key": source_key,
            "source_directory": folder, "source_receipt": receipt_name}


def _review_files(closure, review):
    cache, linked_reports, linked_comparisons = {}, [], []
    for pin in review["selections"]:
        kind, key = pin["kind"], identifier(pin["id"])
        if kind not in ("sources", "runs", "deliveries", "spatial-exports"):
            raise ValueError("The customer review names an unsupported original selection.")
        closure.need(kind, key, "Original customer review selection")
        if kind == "sources":
            collection = _record(closure, kind, key)
            cache[(kind, key)] = collection
            for entry in collection["entries"]:
                # The native resolver uses these exact entries without making
                # source_file() views (hard links alter already captured ctime).
                cache[(key, entry["id"])] = entry
                linked = _scientific_source(closure, key, entry)
                if linked is not None:
                    linked_reports.append(linked)
                comparison = _comparison_source(closure, key, entry)
                if comparison is not None:
                    linked_comparisons.append(comparison)
    reviews._validate_bindings(closure.workspace, review)
    members = []
    for artifact in review["artifacts"]:
        path = reviews._resolve(closure.workspace, artifact, cache)
        relative = path.resolve(strict=True).relative_to(closure.root).as_posix()
        members.append(_member(closure, relative, artifact))
    return linked_reports, linked_comparisons, members


def _auxiliary(closure, review):
    """Retain original returned documents and interrupted/native merge receipts."""
    members, reconciliations, drafts, locks = {}, [], [], set()
    directory = closure.root / review_reconciliation.DIRECTORY
    for path in sorted(directory.glob("*/prepared.json")):
        raw = reviews._read_json_file(reviews._regular(closure.root, path.relative_to(closure.root).as_posix()))
        if raw.get("review_id") != review["id"]:
            continue
        operation = identifier(path.parent.name)
        captured = review_reconciliation.inspect_reconciliation(closure.workspace, operation)
        prepared = captured["prepared"]
        if prepared.get("operation_id") != operation:
            raise ValueError("The original reconciliation changed its operation identity.")
        prefix = review_reconciliation.DIRECTORY + "/" + operation + "/"
        for name in ("prepared.json", "returned-response.json"):
            expected = prepared["original_file"] if name == "returned-response.json" else None
            row = _member(closure, prefix + name, expected)
            members[row["path"]] = row
        completed = captured["completed"]
        if completed is not None:
            row = _member(closure, prefix + "completed.json")
            members[row["path"]] = row
            closure.need("review-responses", completed["response_id"], "Completed response reconciliation")
        reconciliations.append({"operation_id": operation, "prepared_id": prepared["id"],
                                "completed_id": completed["id"] if completed else None})
        locks.add(prefix + ".reconciliation.lock")
    for path in sorted((directory / "inbox").glob("*/draft.json")):
        raw = reviews._read_json_file(reviews._regular(closure.root, path.relative_to(closure.root).as_posix()))
        if raw.get("review_id") != review["id"]:
            continue
        key = identifier(path.parent.name)
        record = review_reconciliation.read_draft(closure.workspace, key, include_response=True)
        prefix = review_reconciliation.DIRECTORY + "/inbox/" + key + "/"
        for name in ("draft.json", "returned-response.json"):
            row = _member(closure, prefix + name,
                          record["original_file"] if name == "returned-response.json" else None)
            members[row["path"]] = row
        drafts.append(key)
        locks.add(prefix + ".returned-response.lock")
    return list(members.values()), reconciliations, drafts, locks


def _include_review(closure, key):
    review = _record(closure, "reviews", key)
    reports, comparisons, artifacts = _review_files(closure, review)
    original_responses = [_record(closure, "review-responses", row["id"])
                          for row in _scan(closure, "review-responses")
                          if row.get("review_id") == key]
    responses = reviews.history_from_records(closure.workspace, review, original_responses)
    members = {row["path"]: row for row in artifacts}
    members["reviews/" + key + ".json"] = _member(closure, "reviews/" + key + ".json")
    for row in responses:
        closure.need("review-responses", row["id"], "Complete original customer response chain")
        path = "review-responses/" + row["id"] + ".json"
        members[path] = _member(closure, path)
    handbacks = []
    groups = set()
    for row in _scan(closure, "review-handbacks"):
        if row.get("review_id") != key and row.get("revised_review_id") != key:
            continue
        record = _record(closure, "review-handbacks", row["id"])
        groups.add((record["review_id"], record["response_id"]))
        closure.need("reviews", record["review_id"], "Original review behind engineering handback")
        if record.get("revised_review_id"):
            closure.need("reviews", record["revised_review_id"], "Revised selection for engineering handback")
        closure.need("review-handbacks", row["id"], "Original engineering response and revisions")
        handbacks.append(row["id"])
        path = "review-handbacks/" + row["id"] + ".json"
        members[path] = _member(closure, path)
    for original, response in sorted(groups):
        review_handback.history(closure.workspace, original, response)
    receipts, views = [], []
    for row in _scan(closure, "review-receipts"):
        if row.get("review_id") != key:
            continue
        retained = _record(closure, "review-receipts", row["id"])
        original, inspected = review_receiving.inspect_received(closure.workspace, row["id"])
        incoming_review = deepcopy(inspected["packet"]["review"])
        for artifact in incoming_review["artifacts"]:
            artifact.pop("preview", None)
        if original != retained or incoming_review != review:
            raise ValueError("The received original review package changed its selected review.")
        incoming = [item["id"] for item in inspected["packet"]["responses"]]
        if [item["id"] for item in responses[:len(incoming)]] != incoming:
            raise ValueError("The received customer package no longer matches the retained response prefix.")
        closure.need("review-receipts", row["id"], "Received original customer review archive")
        path = "review-receipts/" + row["id"] + ".json"
        members[path] = _member(closure, path)
        archive = retained["archive"]
        members[archive["object"]] = _member(closure, archive["object"], archive)
        receipts.append(row["id"])
    for row in _scan(closure, "review-packet-views"):
        if row.get("review_id") != key:
            continue
        retained = _record(closure, "review-packet-views", row["id"])
        original, unused = review_receiving._view_record(closure.workspace, row["id"])
        if original != retained:
            raise ValueError("The original review viewer record changed.")
        closure.need("review-packet-views", row["id"], "Original received-review viewer identity")
        closure.need("review-receipts", row["receipt_id"], "Original review archive for reopening")
        path = "review-packet-views/" + row["id"] + ".json"
        members[path] = _member(closure, path)
        views.append(row["id"])
    extra, reconciliations, drafts, locks = _auxiliary(closure, review)
    for row in extra:
        members[row["path"]] = row
    for report in reports:
        if not report["external"]:
            locks.add("scientific-report-reviews/" + report["source_key"] + "/source/source.lock")
    for comparison in comparisons:
        if not comparison["external"]:
            locks.add(comparison["source_directory"] + "/source.lock")
    # Source capture files are native immutable producer records, not view caches.
    for report in [*reports, *comparisons]:
        if report["external"]:
            continue
        receipt_name = report["source_receipt"]
        original = closure.read(receipt_name)
        members[receipt_name] = _member(closure, receipt_name)
        for descriptor in original["files"]:
            members[descriptor["path"]] = _member(closure, descriptor["path"], descriptor)
    row = {
        "schema": SCHEMA, "id": key, "project_id": closure.workspace.project["id"],
        "review_sha256": digest(review), "title": review["title"], "purpose": review["purpose"],
        "response_ids": [item["id"] for item in responses],
        "handback_ids": sorted(handbacks), "received_package_ids": sorted(receipts),
        "viewer_record_ids": sorted(views), "returned_response_ids": sorted(drafts),
        "reconciliations": sorted(reconciliations, key=lambda item: item["operation_id"]),
        "scientific_reports": sorted(reports, key=lambda item: (item["source_collection_id"], item["source_id"])),
        "members": [members[name] for name in sorted(members)],
        "lock_paths": sorted(locks),
    }
    if comparisons:
        row["report_comparisons"] = sorted(comparisons,
            key=lambda item: (item["source_collection_id"], item["source_id"]))
    previous = _state(closure).get(key)
    if previous is not None and previous != row:
        raise ValueError("The original customer review history changed during transfer preparation.")
    _state(closure)[key] = row
    closure.nodes[("reviews", key)].update(
        title=review["title"], state=responses[-1]["response"]["disposition"] if responses else "in-review",
        responses=len(responses), handbacks=len(handbacks), received_packages=len(receipts),
        returned_responses=len(drafts), reconciliations=len(reconciliations),
        scientific_report_editions=[item["scientific_report_edition_id"] for item in reports if not item["external"]])
    if comparisons:
        closure.nodes[("reviews", key)]["scientific_report_comparisons"] = [
            item["comparison_id"] for item in comparisons if not item["external"]]


def visit(closure, kind, key, value):
    if kind not in IMMUTABLE_KINDS:
        return False
    if kind == "reviews":
        _include_review(closure, key)
    else:
        row = _record(closure, kind, key)
        if row.get("project_id") != closure.workspace.project["id"]:
            raise ValueError("The customer review history belongs to another original project.")
        closure.need("reviews", row["review_id"], "Original review owning this history")
        if kind == "review-handbacks":
            closure.need("review-responses", row["response_id"], "Customer requests behind this handback")
            if row.get("revised_review_id"):
                closure.need("reviews", row["revised_review_id"], "Revised original review")
        if kind == "review-packet-views":
            closure.need("review-receipts", row["receipt_id"], "Received original review package")
    return True


def related(closure):
    if not getattr(closure, "customer_review_lineage_enabled", True):
        return
    editions = {key for kind, key in closure.nodes if kind == report_editions.KIND}
    if not editions:
        return
    for row in _scan(closure, "reviews"):
        if ("reviews", row["id"]) in closure.nodes:
            continue
        matched = False
        for selected in row.get("selections", []):
            if selected.get("kind") != "sources":
                continue
            for entry in selected.get("source", {}).get("entries", []):
                identity = entry.get("metadata", {}).get("scientific_report_identity") or {}
                if (entry.get("role") == REPORT_ROLE and identity.get("schema") == REPORT_SCHEMA
                        and identity.get("project_id") == closure.workspace.project["id"]
                        and identity.get("scientific_report_edition_id") in editions):
                    matched = True
        if matched:
            closure.need("reviews", row["id"], "Customer feedback on the selected scientific report")


def lock_paths(closure):
    return sorted({path for row in _state(closure).values() for path in row["lock_paths"]})


def receipt(closure):
    return [deepcopy(row) for unused, row in sorted(_state(closure).items())]


def verify_receipt(closure, captured):
    """Keep original history and bytes while allowing subsequent native replies."""
    actual = {row["id"]: row for row in receipt(closure)}
    for original in captured:
        current = actual.get(original.get("id"))
        if current is None or any(current.get(name) != original.get(name) for name in (
                "schema", "id", "project_id", "review_sha256", "title", "purpose", "scientific_reports")):
            raise ValueError("The received study lost an original customer review binding.")
        if current.get("report_comparisons", []) != original.get("report_comparisons", []):
            raise ValueError("The received review lost its original scientific comparison binding.")
        old_responses = original["response_ids"]
        if current["response_ids"][:len(old_responses)] != old_responses:
            raise ValueError("The received customer response history lost its original prefix.")
        for name in ("handback_ids", "received_package_ids", "viewer_record_ids", "returned_response_ids"):
            if not set(original[name]).issubset(current[name]):
                raise ValueError("The received customer review lost original " + name.replace("_", " ") + ".")
        rows = {item["operation_id"]: item for item in current["reconciliations"]}
        for item in original["reconciliations"]:
            found = rows.get(item["operation_id"])
            if (found is None or found["prepared_id"] != item["prepared_id"]
                    or item["completed_id"] is not None and found["completed_id"] != item["completed_id"]):
                raise ValueError("The received review lost an original response reconciliation.")
        members = {item["path"]: item for item in current["members"]}
        if any(members.get(item["path"]) != item for item in original["members"]):
            raise ValueError("The received review lost exact original feedback or report bytes.")
    return {"reviews": len(captured),
            "responses": sum(len(row["response_ids"]) for row in captured),
            "handbacks": sum(len(row["handback_ids"]) for row in captured)}


def catalogue(workspace, kind="reviews"):
    if kind != "reviews":
        raise ValueError("Choose original customer reviews.")
    rows = []
    for path in sorted((Path(workspace.root) / "reviews").glob("*.json")):
        key = path.stem
        try:
            review = workspace._get("reviews", identifier(key))
            chain = reviews.history(workspace, key)
            reports = sorted({entry["metadata"]["scientific_report_identity"]["scientific_report_edition_id"]
                              for selected in review["selections"] if selected["kind"] == "sources"
                              for entry in selected["source"]["entries"]
                              if entry.get("role") == REPORT_ROLE and isinstance(
                                  entry.get("metadata", {}).get("scientific_report_identity"), dict)})
            rows.append({"kind": kind, "id": key, "title": review["title"],
                         "state": chain[-1]["response"]["disposition"] if chain else "in-review",
                         "updated_at": chain[-1]["imported_at"] if chain else review["created_at"],
                         "selection": {"scientific_report_edition_ids": reports},
                         "counts": {"responses": len(chain), "artifacts": len(review["artifacts"]),
                                    "requirements": len(review["requirements"])}})
        except (OSError, ValueError, KeyError, TypeError) as error:
            rows.append({"kind": kind, "id": key, "title": key[:12], "state": "unreadable",
                         "updated_at": "", "error": {"type": type(error).__name__, "message": str(error)}})
    return rows
