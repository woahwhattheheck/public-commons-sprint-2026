"""Editable transfer of an original completed scientific report comparison.

The original comparison engine owns exact pairing, row keys and output bytes.
This resolver adds the same-project saved editions and their existing editable
scientific source closure; it does not calculate another comparison.
"""
from __future__ import annotations

from copy import deepcopy
from pathlib import Path

from .common import identifier, read_json
from . import report_changes as producer

KIND = producer.KIND
ROOT_KINDS = (KIND,)
DOCUMENTS = {KIND: "comparison.json"}
LOCKS = {}
LABELS = {KIND: "Scientific report comparisons"}
RECEIPT_SCHEMA = "upstate.study-scientific-report-comparison/v1"


def _local_record(workspace, key, value):
    identifier(key)
    identity = value.get("identity")
    if (value.get("schema") != producer.SCHEMA or value.get("state") != "complete"
            or value.get("id") != key or not isinstance(identity, dict)
            or producer.digest(identity) != key or identity.get("schema") != producer.SCHEMA):
        raise ValueError("Choose an original complete saved report comparison.")
    for side in ("left", "right"):
        fingerprint = identity.get(side)
        if not isinstance(fingerprint, dict):
            raise ValueError("The saved comparison lacks its original edition fingerprint.")
        identifier(fingerprint.get("edition_id"))
        if fingerprint.get("project_id") != workspace.project["id"]:
            raise ValueError(
                "This comparison contains another project's standalone edition. "
                "Use its original complete comparison ZIP receiving workflow; "
                "editable Study transfer needs both saved editions in this project.")
        if (value.get(side) or {}).get("id") != fingerprint["edition_id"]:
            raise ValueError("The saved comparison summary names a different original edition.")
    if value.get("plan") != identity.get("plan"):
        raise ValueError("The comparison's original ordered row-key plan changed.")
    return identity


def _member(closure, prefix, name, descriptor=None):
    # The producer's path/member validator admits its exact original portable names.
    producer._name(name)
    relative = prefix + "/" + name
    closure.add_file(relative, descriptor)
    item = closure.files[relative]
    if item.get("sha256") is None:
        path = closure.root / relative
        actual = producer._descriptor(path.parent, path)
        closure.add_file(relative, actual)
        item = closure.files[relative]
    return {"path": relative, "bytes": item["bytes"], "sha256": item["sha256"]}


def visit(closure, kind, key, value):
    if kind != KIND:
        return False
    identity = _local_record(closure.workspace, key, value)
    prefix = KIND + "/" + key
    # This inspection reads frozen original report trees directly. It neither
    # opens a live SQLite writer nor creates any CAS/source-view hardlinks.
    record, members = producer.members(closure.root / prefix)
    if record != value:
        raise ValueError("The original report comparison changed during selection.")
    retained = [_member(closure, prefix, name, descriptor)
                for name, descriptor in sorted(members.items())]
    editions = []
    for side in ("left", "right"):
        frozen = identity[side]
        edition_id = frozen["edition_id"]
        directory = closure.root / "scientific-report-editions" / edition_id
        # Compare complete original source fingerprints before following their
        # ordered producer histories through the maintained view-free resolver.
        original = producer.edition(directory, project_id=closure.workspace.project["id"])
        if original["fingerprint"] != frozen:
            raise ValueError("The " + side + " saved edition differs from its frozen comparison.")
        closure.need("scientific-report-editions", edition_id,
                     "Original " + side + " edition of saved report comparison " + key)
        editions.append({"side": side, **deepcopy(frozen)})
    archive = None
    archive_name = "scientific-report-comparison-exports/" + key + ".zip"
    path = closure.root / archive_name
    if path.exists() or path.is_symlink():
        # The optional original ZIP must contain exactly the same whole pair.
        closure.add_file(archive_name)
        manifest = producer.inspect_archive(path)
        if manifest.get("comparison_id") != key or manifest.get("members") != members:
            raise ValueError("The retained comparison ZIP differs from its completed pair.")
        descriptor = producer._descriptor(path.parent, path)
        closure.add_file(archive_name, descriptor)
        archive = {"path": archive_name, "bytes": descriptor["bytes"],
                   "sha256": descriptor["sha256"]}
    row = {
        "schema": RECEIPT_SCHEMA, "id": key,
        "project_id": closure.workspace.project["id"], "title": record["title"],
        "identity": deepcopy(identity), "plan": deepcopy(record["plan"]),
        "change_count": record["change_count"], "page_count": record["page_count"],
        "original_editions": editions, "members": retained, "archive": archive,
    }
    previous = closure.report_comparison_records.get(key)
    if previous is not None and previous != row:
        raise ValueError("The selected report comparison changed during transfer preparation.")
    closure.report_comparison_records[key] = row
    closure.nodes[(kind, key)].update(
        title=record["title"], state="complete",
        left_edition_id=identity["left"]["edition_id"],
        right_edition_id=identity["right"]["edition_id"],
        change_count=record["change_count"],
        row_key_plan=deepcopy(record["plan"]),
    )
    return True


def related(closure):
    # Only the user's explicit edition roots discover companion comparisons.
    # An edition reached through another comparison does not pull in every pair.
    selected = {row["id"] for row in closure.selection["roots"]
                if row["kind"] == "scientific-report-editions"}
    if not selected:
        return
    for path in sorted((closure.root / KIND).glob("*/comparison.json")):
        try:
            value = read_json(path)
            identity = value.get("identity") or {}
            if not any((identity.get(side) or {}).get("edition_id") in selected
                       for side in ("left", "right")):
                continue
            _local_record(closure.workspace, path.parent.name, value)
            closure.need(KIND, path.parent.name, "Saved comparison of an explicitly selected report")
        except (OSError, ValueError, KeyError, TypeError) as error:
            closure.related_issues.append({
                "path": path.relative_to(closure.root).as_posix(), "message": str(error)})


def lock_paths(closure):
    for key in sorted(closure.report_comparison_records):
        # These are the original producer locks, both siblings of their target.
        yield KIND + "/." + key + ".lock"
        yield "scientific-report-comparison-exports/." + key + ".zip.lock"


def receipt(closure):
    return [deepcopy(row) for unused, row in sorted(closure.report_comparison_records.items())]


def verify_receipt(closure, captured):
    actual = {row["id"]: row for row in receipt(closure)}
    for original in captured:
        current = actual.get(original["id"])
        if current is None or any(
                current.get(name) != value for name, value in original.items()
                if name != "archive"):
            raise ValueError("The received Study lost its exact saved report comparison.")
        if original.get("archive") is not None and current.get("archive") != original["archive"]:
            raise ValueError("The received Study lost its original complete comparison ZIP.")
    return {"comparisons": len(captured), "identity": "MATCH"}


def catalogue(workspace, kind=KIND):
    if kind != KIND:
        return []
    root = Path(workspace.root).resolve()
    result = []
    for path in sorted((root / KIND).glob("*/comparison.json")):
        key = path.parent.name
        try:
            if path.is_symlink() or path.parent.is_symlink() or not path.resolve().is_relative_to(root):
                raise ValueError("Keep the original comparison inside its Workspace.")
            value = read_json(path)
            identity = _local_record(workspace, key, value)
            result.append({
                "kind": KIND, "id": key, "title": value["title"], "state": "complete",
                "updated_at": "", "selection": deepcopy(identity),
                "counts": {"changes": value["change_count"], "pages": value["page_count"]},
            })
        except (OSError, ValueError, KeyError, TypeError) as error:
            result.append({"kind": KIND, "id": key, "title": key[:12], "state": "unreadable",
                           "updated_at": "", "error": {"type": type(error).__name__,
                                                       "message": str(error)}})
    return result
