"""Original saved Published-study reviews inside received editable Studies.

The maintained selected-Study resolver validates source lineage and captures the
native review/study edition. This reader exposes those same original records and
declared file descriptors without deriving another scientific interpretation.
"""
from __future__ import annotations

from copy import deepcopy

from .common import digest, identifier
from . import published_review_study_transfer as review_transfer

CONTEXT = "published_study_review"
SCHEMA = "upstate.received-published-study-review/v1"


def summary(identity):
    rows = [row for row in identity.get("scientific_report_sources", [])
            if row.get("report_context_kind") == CONTEXT]
    return {
        "published_review_source_count": len(rows),
        "editable_published_review_count": len({
            (row["source_project_id"], row["review_id"]) for row in rows
            if row.get("relationship") == "same_project" and row.get("editable")}),
    }


def augment(closure, retained, result):
    """Expose exact captured review editions after the original closure resolves."""
    result["published_reviews"] = []
    resolved = getattr(closure, "report_source_records", {})
    for captured in retained["identity"].get("scientific_report_sources", []):
        if captured.get("report_context_kind") != CONTEXT:
            continue
        collection_id = identifier(captured["source_collection_id"])
        source_id = captured["source_id"]
        if resolved.get((collection_id, source_id)) != captured:
            raise ValueError("The received Study changed its original review lineage.")
        collection = closure.read("sources/" + collection_id + ".json")
        if digest(collection) != collection_id:
            raise ValueError("The received review source collection changed.")
        matches = [entry for entry in collection.get("entries", [])
                   if entry.get("id") == source_id]
        if len(matches) != 1 or matches[0]["body"]["sha256"] != captured["source_body_sha256"]:
            raise ValueError("The received review lost its original scientific source.")
        entry = matches[0]
        key, identity, review, record, recipe, members = review_transfer._capture(closure, entry)
        if (key != captured["published_review_report_id"]
                or review["id"] != captured["review_id"]
                or identity["binding"] != captured["original_study"]
                or identity["selection"] != captured["selection"]
                or identity["review"]["sha256"] != captured["review_sha256"]
                or identity["interpretation_sha256"] != captured["interpretation_sha256"]):
            raise ValueError("The received review differs from its captured source edition.")
        native = None
        if captured["relationship"] == "same_project":
            editable = captured.get("editable")
            if (not editable or captured["source_project_id"] != closure.workspace.project["id"]
                    or closure.read(editable["review_path"]) != review):
                raise ValueError("The received original review lost its editable native record.")
            native = {"review_id": review["id"],
                      "study_id": identity["binding"]["study_id"],
                      "version_id": identity["binding"]["version_id"]}
        elif captured["relationship"] != "external_project":
            raise ValueError("Choose an original local or external review source.")
        source = {"source_collection_id": collection_id, "source_id": source_id}
        inventory = []
        for name, item in [("observed-report.json", entry["body"]), *sorted(members.items())]:
            closure.add_file(item["object"], item)
            original = closure.files[item["object"]]
            inventory.append({"path": item["object"], "bytes": original["bytes"],
                              "sha256": original["sha256"], "label": name})
        result["published_reviews"].append({
            "schema": SCHEMA, "source": source, "source_project_id": captured["source_project_id"],
            "source_body_sha256": captured["source_body_sha256"],
            "relationship": captured["relationship"], "native": native,
            "published_review_report_id": key, "review": deepcopy(review),
            "study_title": review["content"]["study_title"],
            "original_study": deepcopy(identity["binding"]),
            "selection": deepcopy(identity["selection"]),
            "interpretation_matches_snapshot": identity["interpretation_matches_snapshot"],
            "interpretation_sha256": identity["interpretation_sha256"],
            "original_review_archive_sha256": captured["original_review_archive_sha256"],
            "source_members": inventory,
            "report_ids": [row["id"] for row in result.get("reports", [])
                           if source in row.get("source_choices", [])],
        })
    return result
