"""Prepare an ordinary customer review of a complete saved report comparison.

One original source document retains the comparison and both complete report
trees. The maintained review engine owns requests, decisions, response history,
offline export and receiving. No scientific report is rendered here.
"""
from __future__ import annotations

from copy import deepcopy
from pathlib import Path

from .common import atomic_json, describe_file, digest, held, identifier, read_json, verify_file
from . import report_changes, reviews, scientific_report_review
from .workspace import Workspace

SCHEMA = "upstate.scientific-report-comparison-review/v1"
EDITION = "scientific-report-comparison-review-20261013-v1"
ROLE = "SCIENTIFIC_REPORT_COMPARISON_REVIEW"
KIND = "scientific-report-comparison-reviews"


def _workspace(value):
    return value if hasattr(value, "import_sources") and hasattr(value, "root") else Workspace(value)


def comparison_context(workspace, comparison_id):
    """Read the exact complete local pair without importing sources or writing."""
    workspace = _workspace(workspace)
    key = identifier(comparison_id)
    root = workspace.root.resolve()
    directory = root / report_changes.KIND / key
    if (directory.is_symlink() or not directory.resolve().is_relative_to(root)
            or directory.parent.is_symlink()):
        raise ValueError("Keep the original report comparison inside its Workspace")
    record, members = report_changes.members(directory)
    if record["id"] != key:
        raise ValueError("Choose the exact original saved comparison")
    for side in ("left", "right"):
        fingerprint = record["identity"][side]
        edition_id = identifier(fingerprint.get("edition_id"))
        if (fingerprint.get("project_id") != workspace.project["id"]
                or record[side].get("project_id") != workspace.project["id"]
                or record[side].get("id") != edition_id):
            raise ValueError("Choose a native comparison of two saved editions in this project")
        original = report_changes.edition(
            root / "scientific-report-editions" / edition_id,
            project_id=workspace.project["id"])
        if original["fingerprint"] != fingerprint:
            raise ValueError("The comparison differs from its original local saved edition")
    if "index.html" not in members:
        raise ValueError("The comparison lacks its original complete overview")
    inventory = [{"path": name, "bytes": item["bytes"], "sha256": item["sha256"]}
                 for name, item in sorted(members.items())]
    identity = {"schema": SCHEMA, "edition": EDITION,
                "project_id": workspace.project["id"], "comparison_id": key,
                "comparison_record_sha256": digest(record),
                "pair_identity": deepcopy(record["identity"]),
                "primary_path": "index.html", "members": inventory}
    return {"record": record, "directory": directory, "members": members,
            "identity": identity, "source_key": digest(identity), "primary": "index.html"}


def _context(workspace, comparison_id, review_selection):
    context = comparison_context(workspace, comparison_id)
    draft = scientific_report_review._draft(review_selection)
    request = {"schema": SCHEMA + "/preview",
               "source_identity": context["identity"], "review_selection": draft}
    return {**context, "draft": draft, "operation_id": digest(request)}


def preview_review(workspace, comparison_id, review_selection):
    workspace = _workspace(workspace)
    context = _context(workspace, comparison_id, review_selection)
    record = context["record"]
    return {"schema": SCHEMA, "state": "preview",
            "comparison_id": record["id"], "title": record["title"],
            "operation_id": context["operation_id"],
            "review_selection": deepcopy(context["draft"]),
            "source_identity": deepcopy(context["identity"]),
            "member_count": len(context["members"]),
            "bytes": sum(item["bytes"] for item in context["members"].values()),
            "primary_path": context["primary"],
            "members": deepcopy(context["identity"]["members"]),
            "originals": [{"side": side, **deepcopy(record[side])}
                          for side in ("left", "right")],
            "change_count": record["change_count"], "page_count": record["page_count"],
            "plan": deepcopy(record["plan"])}


def source_members(entry, identity):
    """Validate the declared complete relative tree without making source views."""
    if (not isinstance(identity, dict) or identity.get("schema") != SCHEMA
            or identity.get("edition") != EDITION
            or identity.get("primary_path") != "index.html"):
        raise ValueError("The comparison review lost its original typed identity")
    key = identifier(identity.get("comparison_id"))
    pair = identity.get("pair_identity")
    if (not isinstance(pair, dict) or pair.get("schema") != report_changes.SCHEMA
            or digest(pair) != key):
        raise ValueError("The comparison review lost its exact original pair and row-key plan")
    source_key = digest(identity)
    metadata = entry.get("metadata") or {}
    if (entry.get("role") != ROLE or entry.get("kind") != "document"
            or entry.get("id") != "report-comparison-review-" + source_key
            or entry.get("uri") != "urn:upstate:scientific-report-comparison:" +
               str(identity.get("project_id")) + ":" + key
            or metadata.get("report_schema") != report_changes.SCHEMA
            or metadata.get("scientific_report_comparison_identity") != identity
            or metadata.get("comparison_id") != key):
        raise ValueError("The review source identifies another original comparison")
    for side in ("left", "right"):
        original = pair.get(side)
        if (not isinstance(original, dict)
                or original.get("project_id") != identity.get("project_id")
                or metadata.get(side + "_edition_id") != identifier(original.get("edition_id"))):
            raise ValueError("The review source changed an original report edition")
    rows = identity.get("members")
    if not isinstance(rows, list) or not rows:
        raise ValueError("Retain the complete comparison member inventory")
    declared = {}
    for item in rows:
        if not isinstance(item, dict):
            raise ValueError("Retain original comparison member descriptors")
        name = report_changes._name(item.get("path"))
        if (name in declared or type(item.get("bytes")) is not int or item["bytes"] < 0
                or not isinstance(item.get("sha256"), str)):
            raise ValueError("The comparison source repeats or changes a member")
        identifier(item["sha256"])
        declared[name] = {field: item[field] for field in ("bytes", "sha256")}
    if not {"index.html", "comparison.json", "identity.json", "summary.json",
            "changes.sqlite", "changes.csv", "comparison.css"}.issubset(declared):
        raise ValueError("The comparison review lost its original overview or change register")
    for side in ("left", "right"):
        side_members = pair[side].get("members")
        if not isinstance(side_members, dict) or not side_members:
            raise ValueError("Retain both complete original report inventories")
        expected = {side + "/" + report_changes._name(name):
                    {field: item[field] for field in ("bytes", "sha256")}
                    for name, item in side_members.items()}
        actual_side = {name: item for name, item in declared.items()
                       if name.startswith(side + "/")}
        if actual_side != expected:
            raise ValueError("The comparison source lost an original report member")
    primary = entry.get("body")
    if not isinstance(primary, dict):
        raise ValueError("The comparison review needs its original HTML body")
    body_name = primary.get("view_path", primary.get("filename"))
    prefix = "" if body_name == "index.html" else "report/" if body_name == "report/index.html" else None
    if prefix is None:
        raise ValueError("The comparison HTML changed its original relative path")
    actual = {}
    companions = entry.get("companions", [])
    if not isinstance(companions, list):
        raise ValueError("Retain the original comparison companions")
    for part in [primary, *companions]:
        if not isinstance(part, dict):
            raise ValueError("Retain the original comparison companion descriptors")
        name = report_changes._name(part.get("view_path", part.get("filename")))
        if name in actual:
            raise ValueError("The comparison review repeats an original source path")
        actual[name] = {field: part[field] for field in ("bytes", "sha256")}
    if actual != {prefix + name: value for name, value in declared.items()}:
        raise ValueError("The review source lost files from its complete original comparison")
    return declared


def _verify_source(workspace, receipt, context):
    if (receipt.get("schema") != SCHEMA
            or receipt.get("source_identity") != context["identity"]
            or receipt.get("source_id") != "report-comparison-review-" + context["source_key"]):
        raise ValueError("The retained review source belongs to another comparison")
    for item in receipt["files"]:
        verify_file(workspace.root, item)
    collection = workspace._get("sources", identifier(receipt["source_collection_id"]))
    if digest(collection) != receipt.get("source_collection_sha256"):
        raise ValueError("The complete original comparison source collection changed")
    entries = [entry for entry in collection["entries"] if entry["id"] == receipt["source_id"]]
    if len(entries) != 1:
        raise ValueError("The imported comparison source is missing or ambiguous")
    source_members(entries[0], context["identity"])
    for part in [entries[0]["body"], *entries[0].get("companions", [])]:
        verify_file(workspace.root, {"path": part["object"],
                    "bytes": part["bytes"], "sha256": part["sha256"]})
    return receipt


def _source(workspace, context):
    folder = KIND + "/" + context["source_key"] + "/source"
    root = workspace.root / folder
    if root.is_symlink() or not root.resolve().is_relative_to(workspace.root.resolve()):
        raise ValueError("Keep comparison review sources inside their original Workspace")
    root.mkdir(parents=True, exist_ok=True)
    receipt_path = root / "source-receipt.json"
    with held(root / "source.lock"):
        if receipt_path.is_file():
            return _verify_source(workspace, read_json(receipt_path), context)
        for name, descriptor in context["members"].items():
            original = report_changes._verify(context["directory"], descriptor)
            target = root / "report" / name
            current = root
            for part in ("report", *Path(name).parts):
                current = current / part
                if current.is_symlink():
                    raise ValueError("Keep copied comparison members in their original source tree")
            if not target.resolve().is_relative_to(root.resolve()):
                raise ValueError("Keep copied comparison members in their original source tree")
            scientific_report_review._copy_original(original, target, descriptor)
        copied = {name: describe_file(root, root / "report" / name)
                  for name in context["members"]}
        record, identity = context["record"], context["identity"]
        source_id = "report-comparison-review-" + context["source_key"]
        entry = {
            "id": source_id, "kind": "document", "role": ROLE,
            "title": record["title"],
            "uri": "urn:upstate:scientific-report-comparison:" +
                   workspace.project["id"] + ":" + record["id"],
            "vintage": "Saved scientific report comparison " + record["id"],
            "description": "Exact comparison, ordered row-key plan, complete change register "
                           "and both original scientific report trees.",
            **copied[context["primary"]],
            "companions": [item for name, item in copied.items() if name != context["primary"]],
            "metadata": {"report_schema": report_changes.SCHEMA,
                "scientific_report_comparison_identity": deepcopy(identity),
                "comparison_id": record["id"],
                "left_edition_id": record["identity"]["left"]["edition_id"],
                "right_edition_id": record["identity"]["right"]["edition_id"],
                "change_count": record["change_count"], "page_count": record["page_count"]},
        }
        manifest = {"schema": "upstate.sources/v1",
                    "title": record["title"] + " — original customer review",
                    "entries": [entry],
                    "notes": ["Both complete original editions and all comparison files remain "
                              "unchanged in one relative source tree.",
                              "Original scientific results and table matching are not recalculated."]}
        atomic_json(root / "model-sources.json", manifest, immutable=True)
        collection = workspace.import_sources(root / "model-sources.json")
        receipt = {"schema": SCHEMA, "source_identity": deepcopy(identity),
                   "source_collection_id": collection["id"], "source_id": source_id,
                   "source_collection_sha256": digest(collection), "directory": folder,
                   "files": [describe_file(workspace.root, root / "model-sources.json"),
                             *[describe_file(workspace.root, root / "report" / name)
                               for name in sorted(context["members"])]]}
        _verify_source(workspace, receipt, context)
        atomic_json(receipt_path, receipt, immutable=True)
        return receipt


def create_review(workspace, comparison_id, review_selection, *, expected_operation_id, created_at):
    workspace = _workspace(workspace)
    context = _context(workspace, comparison_id, review_selection)
    if identifier(expected_operation_id) != context["operation_id"]:
        raise ValueError("The comparison or review questions changed; preview them again")
    selected_time = reviews._date(created_at, "Review creation time")
    source = _source(workspace, context)
    selection = {"schema": reviews.SELECTION_SCHEMA, **deepcopy(context["draft"]),
                 "source_collection_ids": [source["source_collection_id"]],
                 "run_ids": [], "delivery_ids": [], "spatial_export_ids": []}
    review = reviews.create_review(workspace, selection, created_at=selected_time)
    packet = reviews.show_review(workspace, review["id"], previews=False)
    if packet["review"]["id"] != review["id"]:
        raise ValueError("The original comparison review could not be reopened")
    return {"schema": SCHEMA, "state": "complete", "kind": "review",
            "operation_id": context["operation_id"], "comparison_id": comparison_id,
            "review_id": review["id"], "created_at": selected_time,
            "title": review["title"], "purpose": review["purpose"],
            "source_collection_id": source["source_collection_id"], "source_id": source["source_id"],
            "source_identity": deepcopy(context["identity"]), "review_selection": selection,
            "artifact_count": len(review["artifacts"]), "source_member_count": len(context["members"]),
            "source_directory": source["directory"],
            "source_receipt": describe_file(workspace.root,
                workspace.root / source["directory"] / "source-receipt.json")}
