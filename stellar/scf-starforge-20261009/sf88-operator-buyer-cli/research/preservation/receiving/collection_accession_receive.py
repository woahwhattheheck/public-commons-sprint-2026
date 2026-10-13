#!/usr/bin/env python3
"""Manual original-file accession -> complete editable Workbench receiving.

Uses an explicitly selected real source directory and complete operator review.
No provider request, new collection fixture or automatic browser installation.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import uuid
import zipfile

sys.dont_write_bytecode = True
SCHEMA = "stellar-forge.collection-accession-receiving.v1"

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("application", "source", "workspace", "settings", "review", "operation"):
        parser.add_argument("--" + name, required=True)
    args = parser.parse_args(argv)
    application, source, workspace, operation = [
        Path(getattr(args, key)).expanduser().absolute() for key in ("application", "source", "workspace", "operation")]
    module_root = application / "research/preservation"
    sys.path.insert(0, str(module_root))
    import preservation as p
    import collection_accession as c
    import workbench as w
    for module in (p, c, w):
        if Path(module.__file__).resolve().parent != module_root.resolve():
            raise ValueError("The selected actual application was not imported.")

    def identity(path):
        return w.file_digest(Path(path))
    def publish(path, value, replace=False):
        data = p.canonical(value)
        if Path(path).exists() and not replace:
            if Path(path).read_bytes() != data:
                raise ValueError("Retained original output differs: " + str(path))
            return
        (p.replace_bytes if replace else p.write_new)(Path(path), data)
    control = workspace.parent / (workspace.name + ".operator")
    for original in (source, workspace, control):
        if operation.resolve().is_relative_to(original.resolve()):
            raise ValueError("Keep receiving records outside original source/workspace/control trees.")
    if workspace.resolve().is_relative_to(source.resolve()) or control.resolve().is_relative_to(source.resolve()):
        raise ValueError("Retained workspace/control must be outside the original source.")
    operation.mkdir(parents=True, exist_ok=True, mode=0o700)
    p.fsync_dir(operation.parent)
    # Same original operating case, held before reading or writing its journal.
    with p.project_lock(operation):
        inv = c.inventory(source)
        settings_bytes = Path(args.settings).read_bytes()
        review_bytes = Path(args.review).read_bytes()
        selected = c.settings(p.parse_json(settings_bytes))
        requested = c.normalize_review(p.parse_json(review_bytes), inv)
        original_review = {"schema": c.REVIEW, "inventorySha256": inv["sha256"], "decisions": [], "note": ""}
        if requested == original_review:
            raise ValueError("Select an actual operator-authored review differing from the opening edition.")
        source_names = list(w.APPLICATION) + list(w.COLLECTION_APPLICATION)
        for group in (w.PRESERVICA_APPLICATION, w.LIBNOVA_APPLICATION, w.ARCHIVEMATICA_APPLICATION):
            present = [(application / name).is_file() for name in group]
            if any(present):
                if not all(present):
                    raise ValueError("Selected provider source closure is incomplete.")
                source_names.extend(group)
        source_names.append("research/preservation/receiving/collection_accession_receive.py")
        source_files = {name: identity(application / name) for name in sorted(set(source_names))}
        intent = {"schema": SCHEMA + ".selection", "application": str(application), "source": str(source),
                  "workspace": str(workspace), "operation": str(operation), "settings": selected,
                  "inventory": inv, "review": requested, "sourceFiles": source_files}
        publish(operation / "selection.json", intent)
        # Retain exact complete producing code and original caller inputs before mutation.
        for name in source_files:
            target = operation / "producing-source" / name
            data = (application / name).read_bytes()
            if identity(application / name) != source_files[name]:
                raise ValueError("Actual source changed before retention.")
            if target.exists():
                if target.read_bytes() != data: raise ValueError("Retained producing source differs.")
            else: p.write_new(target, data)
        for name, data in (("original-settings.json", settings_bytes), ("original-review.json", review_bytes)):
            target = operation / name
            if target.exists():
                if target.read_bytes() != data: raise ValueError("Original input changed.")
            else: p.write_new(target, data)

        journal_path = operation / "progress.json"
        journal = p.parse_json(journal_path.read_bytes()) if journal_path.exists() else {
            "schema": SCHEMA + ".progress", "selectionSha256": p.digest(p.canonical(intent)), "steps": {}}
        if journal["selectionSha256"] != p.digest(p.canonical(intent)):
            raise ValueError("The original operating selection changed.")
        def checkpoint(name, result):
            prior = journal["steps"].get(name)
            if prior is not None and prior != result:
                raise ValueError("Original completed step differs: " + name)
            journal["steps"][name] = result
            publish(journal_path, journal, replace=True)
            print(json.dumps({"phase": name, "retained": True}), flush=True)
            return result

        app = w.Workbench(workspace)
        try:
            accession = app.accession(selected["id"])
            observed = c.initialize(source, accession, selected, inv["sha256"])
            if observed["inventory"] != inv:
                raise ValueError("Retained original inventory changed.")
            checkpoint("original-retained", {"id": selected["id"], "inventorySha256": inv["sha256"]})
            record, retained_inv = c.project(accession, True)
            versions = c.history(accession, retained_inv)
            if versions[0]["review"] != original_review:
                raise ValueError("Opening original review changed.")
            before = app.packages / ("Collection_" + selected["id"] + "_opening.zip")
            if not before.exists():
                if len(versions) != 1:
                    raise ValueError("Original opening package is missing after a later review; preserve the current case.")
                c.build(accession, before, 0)
            expected_before = c.documentation(record, retained_inv, versions[0])[0]
            if c.verify_bag(before)["identity"] != expected_before:
                raise ValueError("Opening package differs from original edition.")
            app.artifact(before, "collection-transfer")
            checkpoint("opening-transfer", {"file": str(before), **identity(before)})

            current = c.show(accession, True)
            if current["revision"] == 0:
                c.save_review(accession, requested, 0)
            versions = c.history(accession, retained_inv)
            if len(versions) < 2 or versions[1]["review"] != requested:
                raise ValueError("Original requested review was not retained as its next edition.")
            after = app.packages / ("Collection_" + selected["id"] + "_reviewed.zip")
            if not after.exists():
                if len(versions) != 2:
                    raise ValueError("Original reviewed package is missing after subsequent local work.")
                c.build(accession, after, 1)
            if c.verify_bag(after)["identity"] != c.documentation(record, retained_inv, versions[1])[0]:
                raise ValueError("Reviewed package differs from original selected edition.")
            app.artifact(after, "collection-transfer")
            checkpoint("reviewed-transfer", {"file": str(after), **identity(after)})
            comparison = c.compare(before, after)
            publish(operation / "original-to-reviewed.json", comparison)
            checkpoint("edition-comparison", {"file": str(operation / "original-to-reviewed.json"),
                **identity(operation / "original-to-reviewed.json"), "changes": len(comparison["changes"])})

            complete = app.deliveries / ("Collection_" + selected["id"] + "_complete.zip")
            if not complete.exists():
                if len(versions) != 2:
                    raise ValueError("The original complete archive is missing after subsequent review.")
                w.export_workspace(app, complete)
            else:
                with zipfile.ZipFile(complete) as archive:
                    manifest = w.snapshot_manifest(archive)
                bindings = {row["id"]: row for row in manifest["collectionBindings"]}
                if (bindings.get(selected["id"], {}).get("inventorySha256") != inv["sha256"] or
                        bindings[selected["id"]]["reviewSha256"] != versions[1]["reviewSha256"]):
                    raise ValueError("Existing complete export has a different selected accession.")
                app.artifact(complete, "complete-workspace", manifest["selection"])
            checkpoint("complete-export", {"file": str(complete), **identity(complete)})
        finally:
            app.close()

        received = operation / "received"
        receipt = w.receive_workspace(complete, received)
        with zipfile.ZipFile(complete) as archive:
            manifest = w.snapshot_manifest(archive)
        member_count = 0
        for name, expected in manifest["files"].items():
            parts = name.split("/")
            target = received.joinpath(*(["workspace.operator"] + parts[1:] if parts[0] == "operator" else parts))
            # Opening a received host records its own original local job lifecycle.
            runtime_record = name in {"operator/jobs.json", "operator/artifacts.json"} and (operation / "COMPLETE.json").exists()
            if identity(target) != expected and not runtime_record:
                raise ValueError("Cold original member changed: " + name)
            member_count += 1
        restored = received / "workspace.operator/accessions" / selected["id"]
        result = c.show(restored, True)
        if result["inventory"] != inv or result["reviewHistory"][1]["reviewSha256"] != versions[1]["reviewSha256"]:
            raise ValueError("Complete original accession/history did not reopen.")
        # Use the actual copied application in a separate native process.
        command = [sys.executable, "-B", str(received / "application/research/preservation/collection_accession.py"),
                   "show", "--workspace", str(restored), "--verify"]
        observed = subprocess.run(command, check=True, capture_output=True, text=True)
        native = p.parse_json(observed.stdout.encode())
        if native != result:
            raise ValueError("Received native application returned another complete accession.")
        checkpoint("native-cold-open", {"command": command, "inventorySha256": native["inventory"]["sha256"],
            "reviewSha256": native["reviewSha256"], "verifiedMembers": member_count})
        # Original source and complete code are checked again before claiming the result.
        if c.inventory(source) != inv or any(identity(application / name) != expected for name, expected in source_files.items()):
            raise ValueError("Original source or executed application changed during receiving.")
        final = {"schema": SCHEMA + ".result", "phase": "COMPLETE", "selectionSha256": journal["selectionSha256"],
            "sourceFiles": source_files, "source": inv, "settings": selected,
            "workspace": str(workspace), "accession": str(accession), "received": str(received),
            "openingTransfer": journal["steps"]["opening-transfer"], "reviewedTransfer": journal["steps"]["reviewed-transfer"],
            "completeExport": journal["steps"]["complete-export"], "comparison": comparison,
            "originalReviewSha256": versions[0]["reviewSha256"], "reviewedSha256": versions[1]["reviewSha256"],
            "coldOpen": journal["steps"]["native-cold-open"],
            "browser": "Separate original-case browser programme and producer rendered inspection are required."}
        publish(operation / "COMPLETE.json", final)
        print(json.dumps(final, ensure_ascii=False, allow_nan=False))
        return 0

if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(json.dumps({"phase": "FAILED", "error": type(error).__name__, "message": str(error)}), file=sys.stderr)
        raise SystemExit(1)
