#!/usr/bin/env python3
"""Receive an original saved-profile workbook return, complete Workspace and selected Study.

Uses the original request and saved profile. No numerical edit, model execution,
source acquisition or replacement operator is performed.
"""
from __future__ import annotations
import argparse
import csv
import hashlib
import json
import os
from pathlib import Path
import signal
import stat
import subprocess
import sys
import zipfile
from xml.etree import ElementTree

APPLICATION = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(APPLICATION))
from model.common import atomic_json, canonical, describe_file, digest, held, identifier, read_json, verify_file
from model.workspace import Workspace
from model import profile_workbook_return as model
from model.portable import backup, inspect_archive, restore, resume_restore

SCHEMA = "upstate.profile-workbook-return-receiving/v1"


def require(condition, message):
    if not condition:
        raise ValueError(message)


def ordinary(path, directory=False):
    path = Path(path).absolute()
    require(path.resolve(strict=True) == path and not path.is_symlink(),
            "Use a canonical ordinary receiving path")
    info = path.lstat()
    require(stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode),
            "Use an ordinary retained receiving member")
    return path


def inspect_members(workspace, return_id):
    result = model.inspect(workspace, identifier(return_id))
    opened = []
    for role, descriptor in result["files"].items():
        path = verify_file(workspace.root, descriptor)
        suffix = path.suffix.lower()
        details = {}
        if suffix in (".xlsx", ".xlsm"):
            members = []
            with zipfile.ZipFile(path) as archive:
                names = archive.namelist()
                require(len(names) == len(set(names)), "Original workbook has duplicate members")
                for info in archive.infolist():
                    if info.is_dir():
                        continue
                    data = archive.read(info)
                    if info.filename.endswith((".xml", ".rels")):
                        ElementTree.fromstring(data)
                    members.append({"path": info.filename, "bytes": len(data),
                                    "sha256": hashlib.sha256(data).hexdigest()})
            details = {"kind": "complete OOXML workbook", "members": members,
                       "spreadsheet_application_opened": False, "formulas_recalculated": False}
        elif suffix == ".json":
            body = read_json(path)
            details = {"kind": "complete JSON", "schema": body.get("schema") if isinstance(body, dict) else None}
        elif suffix == ".csv":
            with path.open(encoding="utf-8-sig", newline="") as stream:
                reader = csv.reader(stream)
                headers = next(reader, [])
                count = sum(1 for _ in reader)
            details = {"kind": "complete CSV", "columns": headers, "rows": count}
        elif suffix == ".html":
            body = path.read_text(encoding="utf-8")
            require("TokenJunkie" in body, "Preserve the original scientific return attribution")
            details = {"kind": "complete HTML source", "rendered": False}
        else:
            path.read_bytes()
            details = {"kind": "complete original implementation", "sha256_verified": True}
        opened.append({"role": role, "descriptor": descriptor, **details})
    request = read_json(verify_file(workspace.root, result["files"]["selection"]))
    original = {key: value for key, value in result.items() if key != "preview"}
    replay = model.create(workspace, request, operation_id=result["operation_id"], context=result.get("context"))
    require(canonical(replay) == canonical(result), "Original workbook request did not replay exactly")
    # Package validation compares every original unchanged member and the selected
    # original cells against the complete native retained source record.
    return {"project_id": workspace.project["id"], "return_id": return_id,
            "result_sha256": digest(original), "preview_sha256": result["preview_sha256"],
            "operation_id": result["operation_id"], "request_sha256": result["request_sha256"],
            "profile_id": result["profile_id"], "workbook": result["workbook"], "members": opened,
            "mapped_count": result["mapped_count"], "changed_cell_count": result["changed_cell_count"],
            "excluded_count": result["excluded_count"]}


def _child(command, cwd, output):
    """Own one original cold reader, including signals during Popen acquisition."""
    child = None
    original = {}
    deferred = True
    interrupted = []
    def stop(signum, frame):
        if deferred:
            interrupted.append(signum)
        else:
            raise KeyboardInterrupt("Original receiving reader interrupted by signal " + str(signum))
    for signum in (signal.SIGINT, signal.SIGTERM):
        original[signum] = signal.signal(signum, stop)
    primary = None
    try:
        with Path(output).open("xb") as file:
            if interrupted:
                raise KeyboardInterrupt("Original receiving reader interrupted before spawn by signal " + str(interrupted[0]))
            child = subprocess.Popen(command, cwd=cwd, stdout=file, stderr=subprocess.STDOUT, start_new_session=True)
            # The handler could run inside Popen, before its returned handle is
            # assigned. Defer the exception until this exact child is owned.
            deferred = False
            if interrupted:
                raise KeyboardInterrupt("Original receiving reader interrupted during spawn by signal " + str(interrupted[0]))
            code = child.wait()
        require(code == 0, "Original cold reader failed; inspect its retained complete output: " + str(output))
    except BaseException as error:
        primary = error
    finally:
        deferred = True
        cleanup = []
        if child is not None and child.poll() is None:
            try:
                os.killpg(child.pid, signal.SIGTERM)
                try:
                    child.wait(timeout=20)
                except subprocess.TimeoutExpired:
                    os.killpg(child.pid, signal.SIGKILL)
                    child.wait()
            except BaseException as error:
                cleanup.append(error)
        for signum, handler in original.items():
            try:
                signal.signal(signum, handler)
            except BaseException as error:
                cleanup.append(error)
        if primary is None and interrupted:
            primary = KeyboardInterrupt("Original receiving reader interrupted by signal " + str(interrupted[0]))
        if primary is not None and cleanup:
            raise BaseExceptionGroup("Original cold receiving failed and cleanup also failed", [primary, *cleanup])
        if primary is not None:
            raise primary
        if cleanup:
            raise BaseExceptionGroup("Original cold receiving cleanup failed", cleanup)




def inspect_selected(workspace, return_id, transfer_id):
    from model.study_transfer import verify_received_studies
    transfer_id = identifier(transfer_id)
    receipt = read_json(workspace.root / "study-transfers" / (transfer_id + ".json"))
    validations = [row for row in verify_received_studies(workspace) if row["id"] == transfer_id]
    require(len(validations) == 1 and validations[0]["identity"] == "MATCH",
            "The selected Study did not preserve its complete dependency closure")
    roots = receipt.get("identity", {}).get("selection", {}).get("roots", [])
    require(any(row.get("kind") == model.ROOT and row.get("id") == return_id for row in roots),
            "The selected Study lost the original workbook return root")
    return {"return": inspect_members(workspace, return_id), "study": receipt,
            "validation": validations[0]}


def cold_application(received, return_id, out, label, expected, transfer_id=None):
    result_path = out / (label + "-cold-application.json")
    if not result_path.exists():
        index = 0
        while (out / (label + "-cold-attempt-" + str(index) + ".log")).exists():
            index += 1
        helper = Path(received["application"]) / "source_tools/receive_profile_workbook_return.py"
        command = [sys.executable, str(helper), "--inspect-received", "--workspace", received["workspace"],
                   "--return-id", return_id, "--output", str(result_path)]
        if transfer_id:
            command += ["--study-transfer-id", transfer_id]
        _child(command, received["application"], out / (label + "-cold-attempt-" + str(index) + ".log"))
    require(canonical(read_json(result_path)) == canonical(expected),
            "The original copied application reopened another workbook return")


def receive_archive(workspace, return_id, out, original, *, selected=False):
    result = model.inspect(workspace, return_id)
    generation = read_json(workspace.root / model.ROOT / return_id / "result.json")
    label = "selected-study" if selected else "complete-workspace"
    archive_path = out / (label + ".zip")
    receipt_path = out / (label + "-receipt.json")
    saved = read_json(receipt_path) if receipt_path.exists() else None
    target = out / (label + "-received")
    chosen = None
    if selected:
        from model.study_transfer import export_study, inspect_transfer_archive, normalise
        chosen = normalise({"schema": "upstate.study-selection/v1", "title": result["title"],
                            "roots": [{"kind": model.ROOT, "id": return_id}],
                            "include_related_results": True})
    identity = {"schema": SCHEMA, "project_id": workspace.project["id"], "return_id": return_id,
                "original": original, "selection": chosen}
    atomic_json(out / (label + "-intent.json"), identity, immutable=True)
    if saved:
        require(canonical(saved["intent"]) == canonical(identity), "Retain the first original archive generation")
        verify_file(out, saved["archive"])
    if not archive_path.exists():
        if selected:
            export_study(workspace, archive_path, chosen)
        else:
            backup(workspace, archive_path, include_intermediates=True)
    ordinary(archive_path)
    if selected:
        inspection = inspect_transfer_archive(archive_path, verify=True)
        manifest, transfer = inspection["manifest"], inspection["study"]
        require(canonical(transfer["identity"]["selection"]) == canonical(chosen),
                "The selected Study archive names another complete selection")
    else:
        manifest, transfer = inspect_archive(archive_path, verify=True), None
    require(manifest["project"]["id"] == workspace.project["id"], "Retain the original scientific project identity")
    root = "workspace/" + model.ROOT + "/" + return_id + "/"
    require(manifest["members"].get(root + "result.json", {}).get("sha256") ==
            hashlib.sha256(canonical(generation) + b"\n").hexdigest(),
            "The complete archive lost the exact original workbook return receipt")
    for descriptor in result["files"].values():
        member = manifest["members"].get("workspace/" + descriptor["path"])
        require(member is not None and member["bytes"] == descriptor["bytes"]
                and member["sha256"] == descriptor["sha256"],
                "The complete archive lost an original return member: " + descriptor["path"])
    archive = describe_file(out, archive_path)
    received = (resume_restore(archive_path, target, expected_archive_sha256=archive["sha256"])
                if target.exists() else restore(archive_path, target))
    cold_workspace = Workspace(received["workspace"])
    cold = inspect_selected(cold_workspace, return_id, transfer["id"]) if selected else inspect_members(cold_workspace, return_id)
    require(canonical(cold["return"] if selected else cold) == canonical(original),
            "Cold receiving changed original cells, source values, profile or request")
    cold_application(received, return_id, out, label, cold, transfer["id"] if selected else None)
    completed = {"schema": SCHEMA, "intent": identity, "archive": archive, "transfer": transfer,
                 "cold": cold, "receiver": {key: received[key] for key in
                      ("directory", "application", "workspace", "archive_sha256")}}
    if saved:
        require(canonical(completed) == canonical(saved), "The original archive receiving receipt changed")
        return saved
    atomic_json(receipt_path, completed, immutable=True)
    return completed


def receive(args):
    source = ordinary(args.workspace, directory=True)
    workspace = Workspace(source)
    out = Path(args.output).absolute()
    require(not out.is_relative_to(source) and not out.is_relative_to(APPLICATION),
            "Receive outside both the original Workspace and application source")
    out.mkdir(parents=True, exist_ok=True)
    ordinary(out, directory=True)
    require(bool(args.return_id) != bool(args.selection),
            "Choose one already-created return or one complete original selection file")
    selection_raw = ordinary(args.selection).read_bytes() if args.selection else None
    request = {"schema": SCHEMA, "project_id": workspace.project["id"], "workspace": str(source),
               "return_id": args.return_id, "selection_sha256": hashlib.sha256(selection_raw).hexdigest() if selection_raw else None,
               "operation_id": args.operation_id}
    with held(out / ".profile-workbook-return-receiving.lock", blocking=False):
        atomic_json(out / "receiving-intent.json", request, immutable=True)
        if selection_raw is not None:
            from model.common import atomic_bytes
            atomic_bytes(out / "original-selection.json", selection_raw, immutable=True)
            chosen = json.loads(selection_raw.decode("utf-8-sig"))
            result = model.create(workspace, chosen, operation_id=args.operation_id)
            return_id = result["id"]
        else:
            return_id = identifier(args.return_id)
        original = inspect_members(workspace, return_id)
        result_file = out / "receiving-result.json"
        saved = read_json(result_file) if result_file.exists() else None
        if saved:
            require(canonical(saved["request"]) == canonical(request)
                    and canonical(saved["original"]) == canonical(original),
                    "Resume the exact first completed workbook receiving operation")
        whole = receive_archive(workspace, return_id, out, original)
        selected = receive_archive(workspace, return_id, out, original, selected=True)
        current = model.inspect(workspace, return_id)
        completed = {"schema": SCHEMA, "state": "OPERATED_AWAITING_LITERAL_INSPECTION",
                     "request": request, "return_id": return_id, "original": original,
                     "complete_workspace": whole, "selected_study": selected,
                     "literal_inspection": {
                         "required": True, "formulas_recalculated": False,
                         "instruction": "Use the original browser/Office owner to view the original and derived XLSX/XLSM, all sheets and changed cells, actual formulas and formatting; recalculate only in the recipient application and retain that as a separate observed edition. View complete HTML, CSV, JSON and both extracted archives. Operate the original and cold Profile workbench at desktop and 390 px, including original-request receiving and working-file reopen. Retain actual observations and screenshots separately.",
                         "html": str(workspace.root / current["files"]["html"]["path"]),
                         "original_workbook": str(workspace.root / current["files"]["original_workbook"]["path"]),
                         "derived_workbook": str(workspace.root / current["files"]["derived_workbook"]["path"]),
                         "source_unchanged": True}}
        if saved:
            require(canonical(saved) == canonical(completed), "The immutable first receiving outcome changed")
            return saved
        atomic_json(result_file, completed, immutable=True)
        return completed


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--return-id")
    parser.add_argument("--selection")
    parser.add_argument("--operation-id")
    parser.add_argument("--output", required=True)
    parser.add_argument("--inspect-received", action="store_true")
    parser.add_argument("--study-transfer-id")
    args = parser.parse_args(argv)
    if args.inspect_received:
        workspace = Workspace(ordinary(args.workspace, directory=True))
        return_id = identifier(args.return_id)
        result = (inspect_selected(workspace, return_id, args.study_transfer_id)
                  if args.study_transfer_id else inspect_members(workspace, return_id))
        atomic_json(args.output, result, immutable=True)
    else:
        require(isinstance(args.operation_id, str) and 0 < len(args.operation_id) <= 150,
                "Retain the same original receiving operation identity")
        result = receive(args)
    print(json.dumps(result, ensure_ascii=False, allow_nan=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
