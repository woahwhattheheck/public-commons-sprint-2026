"""Continue a saved Implementation outcome through observed reports and restore.

Uses the existing saved report bank and source importer. The command never
creates a plan, imports laboratory rows, chooses a model cohort, or recomputes
an outcome. Run --list first when more than one saved edition is available.
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

from model import client_report, implementation_outcome_context, implementation_outcomes, observed_context, portable
from model.client_report import _observed_sections
from model.common import atomic_json, describe_file, digest, file_digest, held, read_json, verify_file
from model.implementation_outcome_context import (
    import_outcome_context, preview_outcome_context,
)
from model.workspace import Workspace

SCHEMA = "upstate.implementation-outcome-receiving/v1"
EDITION = "implementation-outcome-receiving-20261013-v1"


def _inside(root, value):
    root = Path(root).resolve()
    path = Path(value)
    path = path.resolve() if path.is_absolute() else (root / path).resolve()
    if not path.is_relative_to(root) or not path.is_file():
        raise ValueError("Choose an original file inside this Workspace: " + str(value))
    return path


def _unchanged_context(value):
    result = deepcopy(value)
    result.pop("observed_context_sources", None)
    result.pop("observed_context_binding", None)
    result["source_roles"] = dict(result.get("source_roles") or {})
    result["source_roles"].pop(observed_context.ROLE, None)
    return result


def _choose_outcome(workspace, plan_id, outcome_id=None, revision=None):
    rows = implementation_outcomes.list_outcomes(workspace, plan_id)
    choices = [row for row in rows
               if (outcome_id is None or row["id"] == outcome_id)
               and (revision is None or row["plan_binding"]["revision"] == revision)]
    if len(choices) != 1:
        available = [{"id": row["id"], "plan_binding": row["plan_binding"],
                      "title": row["selection"]["title"]} for row in choices or rows]
        raise ValueError(
            "Choose one complete saved outcome with --outcome-id or --revision; "
            "the receiver does not create or select a different analysis. Available: "
            + json.dumps(available, ensure_ascii=False, sort_keys=True))
    return implementation_outcomes.get(workspace, plan_id, choices[0]["id"])


def _source_inventory(workspace, choices):
    rows = []
    for choice in choices:
        path, entry = workspace.source_file(
            choice["source_collection_id"], choice["source_id"])
        body = entry["body"]
        if path.stat().st_size != body["bytes"] or file_digest(path) != body["sha256"]:
            raise ValueError("Retained observed recipe changed")
        rows.append({**choice, "title": entry.get("title"),
                     "body_sha256": body["sha256"], "body_bytes": body["bytes"],
                     "companion_count": len(entry.get("companions", []))})
    return rows


def _collect(workspace, selection, directory):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    product = observed_context.collect(workspace, selection, directory, {})
    if not product or product["binding"] != selection["observed_context_binding"]:
        raise ValueError("The actual observed collector did not retain the selected binding")
    for item in product["files"].values():
        verify_file(directory, item)
    # Run the real core client consumer on the same collected sections. This
    # does not require or manufacture a modeled delivery selection.
    client_sections = _observed_sections(product)
    if not product["sections"] or not client_sections:
        raise ValueError("Selected observed studies did not reach both report consumers")
    atomic_json(directory / "observed-product.json", product, immutable=True)
    atomic_json(directory / "client-observed-sections.json", client_sections, immutable=True)
    return {
        "product_sha256": file_digest(directory / "observed-product.json"),
        "client_sections_sha256": file_digest(directory / "client-observed-sections.json"),
        "section_count": len(product["sections"]),
        "client_section_count": len(client_sections),
        "headings": [row[0] for row in product["sections"]],
        "file_count": len(product["files"]),
        "files": product["files"],
        "product": describe_file(directory, directory / "observed-product.json"),
        "client_sections": describe_file(directory, directory / "client-observed-sections.json"),
    }


def _verify_handoff(workspace, original, imported, outcome):
    selected = imported.get("delivery_selection")
    if not isinstance(selected, dict):
        raise ValueError("The receiver requires the original saved delivery draft")
    before = observed_context.source_choices(original)
    after = observed_context.source_choices(selected)
    added = {key: imported[key] for key in ("source_collection_id", "source_id")}
    expected = before if added in before else before + [added]
    if not before or after != expected:
        raise ValueError("Original observed source order or appended outcome identity changed")
    if selected["source_roles"][observed_context.ROLE] != after[0]:
        raise ValueError("The original first study lost its primary source role")
    if _unchanged_context(selected) != _unchanged_context(original):
        raise ValueError("The outcome handoff changed the original non-observed draft")
    if observed_context.bind(workspace, selected) != imported["binding"]:
        raise ValueError("The returned observed binding differs from its original source files")
    if imported["plan_binding"] != outcome["plan_binding"] or imported["outcome_id"] != outcome["id"]:
        raise ValueError("The imported observed report identifies another saved outcome")
    for item in imported["files"]:
        verify_file(workspace.root, item)
    retained = _inside(workspace.root, imported["delivery_selection_path"])
    if read_json(retained) != selected:
        raise ValueError("The reopened saved selection differs from the handoff")
    return after


def _reopen(workspace, plan_id, outcome, original, imported, collected, collection_directory):
    current = implementation_outcomes.get(workspace, plan_id, outcome["id"])
    if (current["plan_binding"] != outcome["plan_binding"]
            or current["selection_digest"] != outcome["selection_digest"]
            or current["files"] != outcome["files"]):
        raise ValueError("Reopening changed the original outcome or its retained original report")
    choices = _verify_handoff(workspace, original, imported, current)
    actual = _collect(workspace, imported["delivery_selection"], collection_directory)
    if actual != collected:
        raise ValueError("Restoring changed collected original study sections or member hashes")
    return {"outcome_id": current["id"], "plan_binding": current["plan_binding"],
            "selection_digest": current["selection_digest"],
            "sources": _source_inventory(workspace, choices),
            "outcome_members": len(current["files"]), "collected": actual}


def receive(workspace_path, plan_id, delivery_selection, output,
            *, outcome_id=None, revision=None):
    workspace = Workspace(Path(workspace_path).resolve())
    selection_path = _inside(workspace.root, delivery_selection)
    original = read_json(selection_path)
    before = observed_context.source_choices(original)
    if not before:
        raise ValueError("Choose the actual saved field/study delivery selection")
    original_binding = observed_context.bind(workspace, original)
    if original.get("observed_context_binding") != original_binding:
        raise ValueError("Reopen the original saved field report binding before receiving")
    outcome = _choose_outcome(workspace, plan_id, outcome_id, revision)
    preview = preview_outcome_context(
        workspace, plan_id, outcome["id"], existing_report_selection=original)
    identity = {
        "schema": SCHEMA, "edition": EDITION,
        "project_id": workspace.project["id"], "plan_binding": outcome["plan_binding"],
        "outcome_id": outcome["id"], "selection_digest": outcome["selection_digest"],
        "original_delivery_selection": describe_file(workspace.root, selection_path),
        "handoff_operation_id": preview["operation_id"],
        "consumer_source_sha256": {module.__name__: file_digest(Path(module.__file__))
                                  for module in (implementation_outcomes, implementation_outcome_context,
                                                 observed_context, client_report, portable)},
        "receiver_source_sha256": file_digest(Path(__file__)),
    }
    operation_id = digest(identity)
    output = Path(output).resolve()
    if output.is_relative_to(workspace.root.resolve()):
        raise ValueError("Keep the archive and restored copy outside the original Workspace")
    operation = output / operation_id
    operation.mkdir(parents=True, exist_ok=True)
    retained = workspace.root / "implementation" / "outcome-receiving" / operation_id
    retained.mkdir(parents=True, exist_ok=True)
    with held(operation / "operation.lock"):
        atomic_json(operation / "identity.json", identity, immutable=True)
        atomic_json(retained / "identity.json", identity, immutable=True)
        atomic_json(retained / "original-delivery-selection.json", original, immutable=True)
        atomic_json(retained / "preview.json", preview, immutable=True)
        imported = import_outcome_context(
            workspace, plan_id, outcome["id"], existing_report_selection=original,
            expected_operation_id=preview["operation_id"])
        choices = _verify_handoff(workspace, original, imported, outcome)
        # Runtime reuse flags may change on retry; the original handoff body and
        # file descriptors stay immutable and are already verified by its owner.
        stable_import = {key: value for key, value in imported.items()
                         if key not in ("reused", "source_reused")}
        atomic_json(retained / "imported.json", stable_import, immutable=True)
        collected_directory = retained / "collected"
        collected = _collect(workspace, imported["delivery_selection"], collected_directory)
        atomic_json(retained / "collected.json", collected, immutable=True)
        reopened = _reopen(workspace, plan_id, outcome, original, imported, collected,
                           collected_directory)
        atomic_json(retained / "reopened.json", reopened, immutable=True)

        archive = operation / "complete-workspace.zip"
        archive_receipt = operation / "archive.json"
        if archive_receipt.is_file():
            archived = read_json(archive_receipt)
            if (archived["project_id"] != workspace.project["id"]
                    or archive.stat().st_size != archived["bytes"]
                    or file_digest(archive) != archived["sha256"]):
                raise ValueError("The completed archive differs from its saved receiving receipt")
        elif archive.exists():
            # Recover a completed atomic backup if the process ended between
            # archive publication and receipt persistence.
            manifest = portable.inspect_archive(archive, verify=True)
            if manifest["project"] != workspace.project:
                raise ValueError("The existing archive belongs to another scientific project")
            bound = manifest["members"].get(
                "workspace/" + (retained / "identity.json").relative_to(workspace.root).as_posix())
            if not bound or bound["sha256"] != file_digest(retained / "identity.json"):
                raise ValueError("The existing archive belongs to another outcome receiving operation")
            archived = {"project_id": workspace.project["id"], "path": str(archive),
                        "bytes": archive.stat().st_size, "sha256": file_digest(archive),
                        "members": len(manifest["members"]), "selection": manifest["selection"]}
            atomic_json(archive_receipt, archived, immutable=True)
        else:
            archived = portable.backup(workspace, archive,
                                       include_intermediates=True, include_deliveries=True)
            atomic_json(archive_receipt, archived, immutable=True)

        restored_root = operation / "restored"
        restore_receipt = operation / "restore.json"
        if not restored_root.exists():
            restored = portable.restore(archive, restored_root)
            atomic_json(restore_receipt, restored, immutable=True)
        elif not restore_receipt.is_file():
            # A published restore is atomic. Still verify every archived body
            # before adopting a directory left by a process interruption.
            manifest = portable.inspect_archive(archive, verify=False)
            for name, item in manifest["members"].items():
                verify_file(restored_root, {"path": name, **item})
            restored = {"workspace": str(restored_root / "workspace"),
                        "application": str(restored_root / "application"),
                        "archive_sha256": archived["sha256"],
                        "project": workspace.project, "recovered_published_restore": True}
            atomic_json(restore_receipt, restored, immutable=True)
        else:
            restored = read_json(restore_receipt)
        if restored["archive_sha256"] != archived["sha256"]:
            raise ValueError("The restored project identifies another original archive")
        received = Workspace(restored_root / "workspace")
        if received.project != workspace.project:
            raise ValueError("The restored original project identity changed")
        relative = collected_directory.relative_to(workspace.root)
        restored_result = _reopen(received, plan_id, outcome, original, imported, collected,
                                  received.root / relative)
        if restored_result != reopened:
            raise ValueError("Original and restored outcome/observed-source results differ")
        result = {
            "schema": SCHEMA + "/result", "operation_id": operation_id,
            "state": "complete", "identity": identity,
            "workspace": str(workspace.root), "project_id": workspace.project["id"],
            "outcome_id": outcome["id"], "plan_binding": outcome["plan_binding"],
            "summary": outcome["summary"],
            "original_source_count": len(before), "selected_source_count": len(choices),
            "sources": reopened["sources"], "outcome_members": reopened["outcome_members"],
            "delivery_selection_path": imported["delivery_selection_path"],
            "binding": imported["binding"], "collected": collected,
            "archive": archived, "restore": restored,
            "restored_verification": "Original outcome, ordered binding, sections and file hashes match",
            "retained_directory": retained.relative_to(workspace.root).as_posix(),
            "receipt": str(operation / "result.json"),
        }
        atomic_json(operation / "result.json", result, immutable=True)
        return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True, type=Path)
    parser.add_argument("--plan-id", required=True)
    parser.add_argument("--outcome-id")
    parser.add_argument("--revision", type=int)
    parser.add_argument("--delivery-selection", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--list", action="store_true", help="List verified saved outcome editions")
    args = parser.parse_args(argv)
    if args.list:
        result = implementation_outcomes.list_outcomes(Workspace(args.workspace), args.plan_id)
    else:
        if not args.delivery_selection or not args.output:
            parser.error("--delivery-selection and --output are required for receiving")
        result = receive(args.workspace, args.plan_id, args.delivery_selection, args.output,
                         outcome_id=args.outcome_id, revision=args.revision)
    print(json.dumps(result, ensure_ascii=False, sort_keys=True, allow_nan=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
