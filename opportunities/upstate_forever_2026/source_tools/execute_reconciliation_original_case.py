"""Exercise retained offline-return transactions on isolated copies of an actual plan.

Run with the maintained application on PYTHONPATH. The supplied Workspace is read
only. The paired-value example is explicitly an isolated software fixture; its
changed values and source alias are never observations in the source Workspace.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
from pathlib import Path
import shutil
import tempfile

from model.implementation import ImplementationStore
from model.implementation_schema import (
    RevisionConflict, canonical_bytes, document_digest, validate_plan,
)
from model import implementation_reconciliation as reconciliation

DEFAULT_PLAN = "eighteenmile-2023-original-lake-samples"
ADMIN_FIELDS = frozenset(("id", "notes", "evidence_refs"))


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def file_hash(path):
    digest = hashlib.sha256()
    size = 0
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            size += len(chunk)
            digest.update(chunk)
    return {"bytes": size, "sha256": digest.hexdigest()}


def scientific_rows(plan):
    return {row["id"]: {key: value for key, value in row.items()
                       if key not in ADMIN_FIELDS}
            for row in plan["observations"]}


def original_files(plan_directory):
    """Only immutable plan revisions and original attachments enter the copy."""
    found = {}
    for name in ("revisions", "attachments"):
        bank = plan_directory / name
        require(not bank.is_symlink(), "Original source bank is a symlink")
        if not bank.exists():
            continue
        for path in sorted(bank.rglob("*")):
            require(not path.is_symlink(), "Original plan contains a symlink")
            if path.is_file():
                relative = path.relative_to(plan_directory).as_posix()
                found[relative] = file_hash(path)
    require(any(name.startswith("revisions/") for name in found),
            "The actual plan has no retained revisions")
    return found


def clone_plan(original, destination, plan_id, inventory):
    target = destination / "implementation" / "plans" / plan_id
    for relative, descriptor in inventory.items():
        source = original / relative
        output = target / relative
        output.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, output)
        require(file_hash(output) == descriptor,
                "Original member changed during isolated copy: " + relative)
    return ImplementationStore(str(destination))


def revisions(store, plan_id):
    directory = store._directory(plan_id) / "revisions"
    return {path.name: file_hash(path) for path in sorted(directory.glob("*.json"))}


def stale_return(store, incoming):
    latest = store.get(incoming["id"])
    try:
        store.import_document(incoming, expected_revision=latest["revision"],
                              actor="isolated native transaction exercise")
    except RevisionConflict as error:
        require(bool(error.conflict_ref), "Stale return was not retained")
        return Path(error.conflict_ref).name
    raise AssertionError("A stale, changed original return was accepted without review")


def apply(store, plan_id, conflict_id, preview, choices=None):
    return reconciliation.apply_reconciliation(
        store, plan_id, conflict_id,
        expected_operation_id=preview["operation_id"],
        expected_revision=preview["expected_revision"],
        choices=choices, actor="isolated native transaction exercise")


def check_original_science(expected, actual):
    require(scientific_rows(actual) == scientific_rows(expected),
            "An original scientific measurement definition changed")
    for key in ("sites", "visits", "activities", "source_links", "field12_lab_imports"):
        require(actual.get(key) == expected.get(key),
                "Original source, sample or laboratory history changed: " + key)


def transaction_case(store, plan_id):
    base = store.get(plan_id)
    incoming = copy.deepcopy(base)
    incoming["observations"][0]["notes"] = (
        incoming["observations"][0].get("notes", "") +
        "\nIsolated offline-return administrative annotation.")
    office = copy.deepcopy(base)
    office["description"] = office.get("description", "") + "\nIsolated office annotation."
    current = store.save(office, expected_revision=base["revision"],
                         actor="isolated office edit")
    conflict_id = stale_return(store, incoming)
    preview = reconciliation.preview_reconciliation(store, plan_id, conflict_id)
    require(preview["can_apply"] and preview["summary"]["unresolved_conflicts"] == 0,
            "Independent administrative changes did not produce an applicable review")
    before = revisions(store, plan_id)
    original_write = reconciliation._write

    class ReceiptInterrupted(RuntimeError):
        pass

    fired = False

    def interrupt_receipt(path, value):
        nonlocal fired
        if Path(path).name == "receipt.json" and not fired:
            fired = True
            raise ReceiptInterrupted("Intentional interruption after immutable commit")
        return original_write(path, value)

    reconciliation._write = interrupt_receipt
    try:
        try:
            apply(store, plan_id, conflict_id, preview)
        except ReceiptInterrupted:
            pass
        else:
            raise AssertionError("Receipt interruption did not execute")
    finally:
        reconciliation._write = original_write

    applied = store.get(plan_id)
    require(fired and applied["revision"] == current["revision"] + 1,
            "Interruption did not leave exactly one committed revision")
    after_apply = revisions(store, plan_id)
    require(len(after_apply) == len(before) + 1,
            "The first apply committed more than one revision")
    check_original_science(base, applied)
    target = store._directory(plan_id) / "reconciliations" / preview["operation_id"]
    require((target / "resolution.json").is_file() and
            not (target / "receipt.json").exists(),
            "The intended post-commit/pre-receipt crash window was not reached")
    require(applied["description"] == current["description"] and
            applied["observations"][0]["notes"] == incoming["observations"][0]["notes"],
            "Independent administrative edits were lost")

    later = copy.deepcopy(applied)
    later["description"] += "\nA later native edit that replay must retain."
    live = store.save(later, expected_revision=applied["revision"],
                      actor="isolated later edit")
    before_replay = revisions(store, plan_id)
    receipt = apply(store, plan_id, conflict_id, preview)
    require(receipt["replayed"] and receipt["applied_revision"] == applied["revision"] and
            receipt["current_revision"] == live["revision"],
            "Replay did not reconnect the original apply and later current revision")
    require(revisions(store, plan_id) == before_replay,
            "Interrupted receipt repair wrote another native revision")
    require(store.get(plan_id) == live and receipt["plan"] == applied,
            "Replay replaced a later edit or the original applied result")
    check_original_science(base, receipt["plan"])
    audit_before = {path.name: file_hash(path) for path in target.glob("*.json")}
    repeated = apply(store, plan_id, conflict_id, preview)
    require(repeated["replayed"] and revisions(store, plan_id) == before_replay,
            "Completed replay wrote another native revision")
    require({path.name: file_hash(path) for path in target.glob("*.json")} == audit_before,
            "Completed replay rewrote retained original audit bytes")
    return {"operation_id": preview["operation_id"], "conflict_id": conflict_id,
            "base_revision": base["revision"], "review_revision": current["revision"],
            "applied_revision": applied["revision"], "later_revision": live["revision"],
            "retained_measurements": len(base["observations"]),
            "receipt_repaired": True, "later_edit_preserved": True,
            "repeat_retains_audit_bytes": True}


def paired_definition_case(store, plan_id):
    base = store.get(plan_id)
    original = next(row for row in base["observations"]
                    if row["result_type"] == "numeric"
                    and isinstance(row.get("value"), (int, float))
                    and not isinstance(row["value"], bool)
                    and row.get("unit") and row.get("lab_source", {}).get("source_link_id"))
    row_id = original["id"]
    current = copy.deepcopy(base)
    current_row = next(row for row in current["observations"] if row["id"] == row_id)
    current_row["unit"] = "mg/L" if original["unit"] != "mg/L" else "ug/L"
    saved = store.save(current, expected_revision=base["revision"],
                       actor="isolated paired-definition fixture")
    incoming = copy.deepcopy(base)
    incoming_row = next(row for row in incoming["observations"] if row["id"] == row_id)
    incoming_row["value"] = original["value"] + 1
    require(incoming_row["value"] != original["value"], "Choose a finite distinguishable source value")
    # A distinct source alias names the same real CSV bytes. This exercises a
    # legitimate selected binding change without manufacturing a laboratory file.
    alias = copy.deepcopy(next(source for source in base["source_links"]
                               if source["id"] == original["lab_source"]["source_link_id"]))
    alias["id"] = "reconciliation_fixture_csv_alias"
    require(not any(source["id"] == alias["id"] for source in base["source_links"]),
            "The isolated source alias already exists")
    incoming["source_links"].append(alias)
    incoming_row["lab_source"]["source_link_id"] = alias["id"]
    validate_plan(incoming)
    conflict_id = stale_return(store, incoming)
    preview = reconciliation.preview_reconciliation(store, plan_id, conflict_id)
    atomic = [item for item in preview["conflicts"]
              if item["path"].endswith("/$measurement") and item["required"]]
    require(len(atomic) == 1 and not preview["can_apply"],
            "Paired value/unit edits did not require one complete measurement choice")
    decision = atomic[0]
    require(decision["base"]["value"]["value"] == original["value"] and
            decision["current"]["value"]["unit"] == current_row["unit"] and
            decision["incoming"]["value"]["unit"] == original["unit"],
            "The review did not preserve all three exact measurement definitions")
    for side in ("current", "incoming"):
        reviewed = reconciliation.preview_reconciliation(
            store, plan_id, conflict_id, choices={decision["id"]: side})
        require(reviewed["can_apply"],
                "An explicit whole definition could not be reviewed: " + side)
    choices = {decision["id"]: "incoming"}
    reviewed = reconciliation.preview_reconciliation(
        store, plan_id, conflict_id, choices=choices)
    receipt = apply(store, plan_id, conflict_id, reviewed, choices)
    applied = receipt["plan"]
    expected = scientific_rows(incoming)
    require(scientific_rows(applied) == expected,
            "The selected definition became a hybrid of current and incoming")
    require(applied.get("field12_lab_imports") == base.get("field12_lab_imports"),
            "The isolated source alias altered original laboratory history")
    require(all(source in applied["source_links"] for source in base["source_links"]),
            "An original source link was removed by explicit binding selection")
    return {"fixture": "isolated software transaction; changed value/unit are not observations",
            "source_observation_id": row_id, "operation_id": reviewed["operation_id"],
            "review_revision": saved["revision"], "applied_revision": applied["revision"],
            "whole_definition_choice": True, "selected_original_csv_alias": alias["id"],
            "other_original_measurements_unchanged": len(base["observations"]) - 1}


def run(workspace, plan_id, expected_model_sha256=None):
    root = Path(workspace).expanduser().resolve(strict=True)
    require("/" not in plan_id and "\\" not in plan_id and plan_id not in (".", ".."),
            "Select a native plan ID")
    source = root / "implementation" / "plans" / plan_id
    require(source.is_dir() and not source.is_symlink(), "Select the completed original plan")
    model_path = Path(reconciliation.__file__).resolve()
    model_identity = file_hash(model_path)
    if expected_model_sha256:
        require(model_identity["sha256"] == expected_model_sha256,
                "The installed reconciliation model differs from the reviewed source")
    inventory = original_files(source)
    with tempfile.TemporaryDirectory(prefix="upstate-reconciliation-original-") as scratch:
        temporary = Path(scratch)
        transaction = clone_plan(source, temporary / "transaction", plan_id, inventory)
        base = transaction.get(plan_id)
        counts = {name: sum(row["result_type"] == name for row in base["observations"])
                  for name in ("numeric", "censored", "text", "missing")}
        require(len(base["observations"]) == 88 and counts["numeric"] == 82
                and counts["censored"] == 6 and len(base["sites"]) == 3,
                "Select the completed original Eighteenmile 88-result receiving plan")
        baseline = {"plan_id": plan_id, "revision": base["revision"],
                    "document_digest": document_digest(base), "results": 88,
                    "result_types": counts, "sites": len(base["sites"])}
        result = transaction_case(transaction, plan_id)
        paired = clone_plan(source, temporary / "paired-definition", plan_id, inventory)
        paired_result = paired_definition_case(paired, plan_id)
    for relative, descriptor in inventory.items():
        require(file_hash(source / relative) == descriptor,
                "A selected original source member changed during the isolated run")
    return {"schema": "upstate.native-reconciliation-exercise/v1", "state": "complete",
            "original_workspace": str(root), "original_plan": baseline,
            "model": {"path": str(model_path), **model_identity},
            "transaction": result, "paired_definition": paired_result,
            "original_source_members_verified": len(inventory),
            "original_source_inventory_sha256":
                hashlib.sha256(canonical_bytes(inventory)).hexdigest(),
            "source_workspace_writes": 0, "isolated_directories_removed": True}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--plan-id", default=DEFAULT_PLAN)
    parser.add_argument("--expected-model-sha256")
    parser.add_argument("--output", help="Optional new receipt outside the original Workspace")
    args = parser.parse_args()
    root = Path(args.workspace).expanduser().resolve(strict=True)
    output = Path(args.output).expanduser().resolve() if args.output else None
    if output:
        require(output != root and root not in output.parents,
                "The execution receipt must be outside the original Workspace")
        require(not output.exists(), "Select a new execution receipt path")
    result = run(root, args.plan_id, args.expected_model_sha256)
    body = json.dumps(result, indent=2, sort_keys=True, allow_nan=False) + "\n"
    if output:
        output.parent.mkdir(parents=True, exist_ok=True)
        with output.open("x", encoding="utf-8") as handle:
            handle.write(body)
    print(body, end="")


if __name__ == "__main__":
    main()
