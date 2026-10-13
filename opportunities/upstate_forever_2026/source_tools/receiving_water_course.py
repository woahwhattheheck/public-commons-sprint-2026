#!/usr/bin/env python3
"""Operate the existing receiving-water desk, then receive its full scientific work."""
from __future__ import annotations
import argparse
import hashlib
from copy import deepcopy
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import sys
import time
import uuid
import zipfile

sys.dont_write_bytecode = True
APP = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(APP))
from model.common import atomic_json, canonical, digest, file_digest, held, read_json
from model.workspace import Workspace
from model.chemistry import Chemistry
from model import portable

OPERATION = "ECO-RECEIVING-WATER-9B2C-20261013"
SCHEMA = "upstate.receiving-water-course/v1"


def record(path):
    path = Path(path).resolve(strict=True)
    if not path.is_file() or path.is_symlink():
        raise ValueError("Retain an original ordinary file: " + str(path))
    return {"path": str(path), "bytes": path.stat().st_size, "sha256": file_digest(path)}


def exact(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        if path.is_symlink() or path.read_bytes() != data:
            raise ValueError("Retained file differs: " + str(path))
        return record(path)
    pending = path.with_name("." + path.name + "." + uuid.uuid4().hex)
    try:
        with pending.open("xb") as target:
            target.write(data); target.flush(); os.fsync(target.fileno())
        try:
            os.link(pending, path)
        except FileExistsError:
            if path.read_bytes() != data:
                raise ValueError("A different retained file already exists")
    finally:
        pending.unlink(missing_ok=True)
    return record(path)


def exact_json(path, value):
    return exact(path, canonical(value) + b"\n")


def load_operator():
    spec = importlib.util.spec_from_file_location("original_operator_receiving", APP / "operator/receiving.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.OperatorProcess


def inventory(root):
    root = Path(root).resolve(strict=True)
    values = {}
    for path in sorted(root.rglob("*")):
        if path.is_symlink():
            raise ValueError("Workspace inventory contains a symlink: " + str(path))
        if path.is_file() and not path.name.endswith(".lock"):
            values[path.relative_to(root).as_posix()] = {"bytes": path.stat().st_size, "sha256": file_digest(path)}
    return values


def preserve(root, before):
    root = Path(root)
    for name, expected in before.items():
        actual = record(root / name)
        if {k: actual[k] for k in ("bytes", "sha256")} != expected:
            raise ValueError("Earlier original workspace work changed: " + name)


def extract_complete(archive, destination):
    """Open complete delivered archives after checking their existing byte identity."""
    destination = Path(destination)
    with zipfile.ZipFile(archive) as z:
        names = z.namelist()
        if len(names) != len(set(names)):
            raise ValueError("Archive repeats a member")
        out = []
        for item in z.infolist():
            name = item.filename
            p = PurePosixPath(name)
            if item.is_dir():
                continue
            if (p.is_absolute() or ".." in p.parts or str(p) != name or "\\" in name or "\0" in name
                    or item.flag_bits & 1 or ((item.external_attr >> 16) & 0o170000) not in (0, 0o100000)):
                raise ValueError("Unsafe delivered archive member: " + name)
            target = destination / name
            if target.is_symlink() or not target.parent.resolve().is_relative_to(destination.resolve()):
                raise ValueError("Archive member escapes receiving")
            out.append(exact(target, z.read(item)))
    return out


def checked_sources(source, output):
    manifest = read_json(source / "sources.json")
    receipts = read_json(source / "source-receipts.json")
    periods = read_json(source / "selected-source-periods.json")
    if manifest.get("schema") != "upstate.sources/v1" or len(manifest.get("entries", [])) != 12:
        raise ValueError("Select the complete original twelve-file Hartwell source edition")
    if receipts.get("schema") != "upstate.receiving-water-originals/v1" or len(receipts.get("files", [])) != 12:
        raise ValueError("Original twelve source receipts are required")
    entries = {x["path"]: x for x in manifest["entries"]}
    matrix = {}
    for receipt in receipts["files"]:
        entry = entries.get(receipt["path"])
        path = source / receipt["path"]
        got = record(path)
        if (not entry or entry["sha256"] != receipt["sha256"] or entry["uri"] != receipt["url"]
                or got["sha256"] != receipt["sha256"] or got["bytes"] != receipt["bytes"]):
            raise ValueError("An original source receipt differs")
        key = (receipt["quarter"], receipt["role"])
        if key in matrix:
            raise ValueError("Duplicate quarter/source role")
        matrix[key] = (entry, json.loads(path.read_bytes()))
        exact(output / "originals" / receipt["path"], path.read_bytes())
    if set(matrix) != {(q, r) for q in ("q1", "q2", "q3", "q4") for r in ("inflow", "outflow", "storage")}:
        raise ValueError("All four original quarterly source families are required")
    if [x["quarter"] for x in periods] != ["q1", "q2", "q3", "q4"]:
        raise ValueError("Preserve the four complete original selected periods in order")
    for name in ("sources.json", "source-receipts.json", "selected-source-periods.json"):
        exact(output / "originals" / name, (source / name).read_bytes())
    return manifest, periods, matrix


def selections(collection, periods, matrix, template, ids, authored):
    values = []
    for period in periods:
        q = period["quarter"]
        bindings = {}
        for role in ("inflow", "outflow", "storage"):
            entry, raw = matrix[(q, role)]
            bindings[role] = {
                "sources": [{"source_collection_id": collection["id"], "source_id": entry["id"]}],
                "format": "cwms-json", "name": raw["name"], "office": raw["office-id"],
                "units": raw["units"], "interval_seconds": 3600,
                "value_support": "instantaneous" if role == "storage" else "interval-ending",
                "quality_type": "integer", "quality_codes": [0] if role == "storage" else [3],
            }
        values.append({"quarter": q, "selection": {
            "schema": "upstate.receiving-water-chemistry-selection/v1",
            "template_case_id": template["id"],
            "title": "Hartwell " + q.upper() + " 2025 — " + ("authored unit tracer" if authored else template["title"]),
            "reason": "Complete original 21-day Hartwell hydrology; weekly signed-value means. "
                      + ("Chemical starting mass is an explicitly authored 1 kg tracer, not an observation. "
                         if authored else "The selected original chemical template is retained unchanged. ")
                      + "Flow quality [3], storage quality [0]; later storage is comparison only.",
            "begin": period["begin"], "end": period["end"], "period_hours": 168,
            "template_period_policy": "repeat-single-phase",
            "signed_value_policy": "mean-preserve-signed-originals",
            "flow_bindings": [
                {"flow_id": ids["inflow"], **bindings["inflow"]},
                {"flow_id": ids["outflow"], **bindings["outflow"]}],
            "storage_bindings": [{"reach_id": ids["reach"], **bindings["storage"]}],
        }})
    return values


def run_child(argv, directory, name, timeout, lock_fd):
    directory.mkdir(parents=True, exist_ok=True)
    with (directory / (name + ".stdout")).open("wb") as out, (directory / (name + ".stderr")).open("wb") as err:
        env = dict(os.environ, PYTHONDONTWRITEBYTECODE="1")
        process = subprocess.Popen(argv, stdout=out, stderr=err, env=env, pass_fds=(lock_fd,))
        try:
            code = process.wait(timeout=timeout)
        except BaseException:
            process.terminate()
            try: process.wait(timeout=30)
            except subprocess.TimeoutExpired:
                process.kill(); process.wait()
            raise
    if code:
        raise RuntimeError(name + " stopped; retain the exact journal and inspect " + str(directory / (name + ".stderr")))
    return record(directory / (name + ".stdout"))


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--workspace", required=True, type=Path)
    p.add_argument("--output", required=True, type=Path)
    p.add_argument("--scratch", required=True, type=Path)
    p.add_argument("--source-directory", type=Path, default=APP / "source/receiving-water-hartwell-2025")
    group = p.add_mutually_exclusive_group(required=True)
    group.add_argument("--template-case")
    group.add_argument("--authored-unit-tracer", action="store_true")
    p.add_argument("--inflow-id"); p.add_argument("--outflow-id"); p.add_argument("--reach-id")
    p.add_argument("--operator-state", type=Path)
    p.add_argument("--node", required=True, type=Path)
    p.add_argument("--node-modules", required=True, type=Path)
    p.add_argument("--chromium", required=True, type=Path)
    p.add_argument("--source-revision", required=True)
    p.add_argument("--task-timeout-seconds", type=int, default=14400)
    p.add_argument("--upload-limit-mib", type=int, default=4096)
    p.add_argument("--resume-failed-tasks", action="store_true")
    args = p.parse_args()
    if args.task_timeout_seconds <= 0 or not 1 <= args.upload_limit_mib <= 65536:
        raise ValueError("Select positive task observation and original upload capacity")
    for value in (args.workspace, args.output, args.scratch, args.node, args.node_modules, args.chromium):
        if not value.is_absolute():
            raise ValueError("Use absolute owned paths")
    for value in (args.node, args.chromium, args.node_modules / "playwright/index.mjs"):
        if not value.is_file():
            raise ValueError("Select the actual existing installed runtime: " + str(value))
    ws = Workspace(args.workspace)
    output, scratch = args.output.resolve(), args.scratch.resolve()
    if output.is_relative_to(ws.root) or scratch.is_relative_to(ws.root):
        raise ValueError("Keep course output and receiving outside the original scientific workspace")
    output.mkdir(parents=True, exist_ok=True, mode=0o700)
    scratch.mkdir(parents=True, exist_ok=True, mode=0o700)
    journal = output / "course.json"
    # Hold the same course lock in every browser child, including parent failure.
    import fcntl
    with (output / ".course.lock").open("a+b") as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        manifest, periods, matrix = checked_sources(args.source_directory.resolve(), output)
        ids = {"inflow": args.inflow_id or ("in" if args.authored_unit_tracer else None),
               "outflow": args.outflow_id or ("out" if args.authored_unit_tracer else None),
               "reach": args.reach_id or ("reservoir" if args.authored_unit_tracer else None)}
        if not all(ids.values()):
            raise ValueError("Select the actual template inflow, outflow and storage reach IDs")
        identity = {"operation_id": OPERATION, "workspace_id": ws.project["id"],
                    "workspace": str(ws.root), "output": str(output), "scratch": str(scratch),
                    "manifest_sha256": file_digest(args.source_directory / "sources.json"),
                    "periods_sha256": file_digest(args.source_directory / "selected-source-periods.json"),
                    "template_case_id": args.template_case, "authored_unit_tracer": args.authored_unit_tracer,
                    "bindings": ids}
        if journal.exists():
            state = read_json(journal)
            if state.get("schema") != SCHEMA or state["identity"] != identity:
                raise ValueError("Continue the same original receiving-water selection")
        else:
            state = {"schema": SCHEMA, "identity": identity, "stages": {}, "source_editions": [],
                     "before": inventory(ws.root), "complete": False}
            atomic_json(journal, state)
        if state.get("complete"):
            for item in state["files"]:
                if record(item["path"]) != item:
                    raise ValueError("A completed course file differs")
            print(json.dumps({"complete": True, "reused": True, "result": record(journal)}))
            return
        source_paths = ["source_tools/receiving_water_course.py", "source_tools/receiving_water_browser.mjs",
                        "model/receiving_water_chemistry.py", "model/chemistry.py",
                        "model/reach_chemistry/model.py", "model/reach_chemistry/solver.py",
                        "model/reach_chemistry/storage.py", "model/reach_chemistry/inference.py",
                        "model/reach_chemistry/io.py", "model/reach_chemistry/reporting.py",
                        "operator/web/receiving-water-chemistry.mjs", "operator/web/chemistry.mjs"]
        source_files = []
        for name in source_paths:
            raw = (APP / name).read_bytes()
            checksum = hashlib.sha256(raw).hexdigest()
            source_files.append(exact(output / "source-editions" / checksum / name, raw))
        source_edition = {"revision": args.source_revision, "files": source_files}
        if source_edition not in state["source_editions"]:
            state["source_editions"].append(source_edition); atomic_json(journal, state)
        def stage(name, operation):
            if name in state["stages"]:
                return state["stages"][name]
            value = operation()
            state["stages"][name] = value; atomic_json(journal, state)
            return value
        collection = stage("original-source-intake", lambda: ws.import_sources(output / "originals/sources.json"))
        if args.authored_unit_tracer:
            def make_template():
                from model.reach_chemistry.study_storage import single
                raw = single("Authored 1 kg conservative unit tracer — hydrology response only", 1.0, 1.0)
                raw["initial"][0]["kg"] = 1.0
                raw["provenance"] = {"kind": "authored-unit-response",
                    "reference": OPERATION + "; 1 kg initial conservative tracer; no measured chemical concentration"}
                for group_name in ("species", "reaches", "flows", "initial"):
                    for row in raw[group_name]:
                        row["provenance"] = deepcopy(raw["provenance"])
                return Chemistry(ws).save_case({"project": raw, "source_refs": [],
                    "reason": "Explicitly selected authored 1 kg tracer using the original single() physical case. "
                              "Hydrological records are observed; these chemical inputs are illustrative."})
            template = stage("chemical-template", make_template)
        else:
            template = stage("chemical-template", lambda: Chemistry(ws).get_case(args.template_case))
        if len(template["project"]["phases"]) != 1:
            raise ValueError("Select the actual one-phase chemical template")
        flows = {x["id"]: x for x in template["project"].get("flows", [])}
        if (flows.get(ids["inflow"], {}).get("target") != ids["reach"]
                or flows.get(ids["inflow"], {}).get("source") is not None
                or flows.get(ids["outflow"], {}).get("source") != ids["reach"]
                or flows.get(ids["outflow"], {}).get("target") is not None):
            raise ValueError("The selected Hartwell bindings must be the template's boundary inflow and outflow")
        selected = selections(collection, periods, matrix, template, ids, args.authored_unit_tracer)
        case_input = {"operation_id": OPERATION, "workspace_id": ws.project["id"],
                      "collection": collection, "template": template, "seasons": selected,
                      "request": {"mode": "simulate", "sample_days": list(range(22))},
                      "originals": [record(output / "originals" / x["path"]) for x in manifest["entries"]],
                      "source_assumptions": "Flow quality [3]; storage quality [0]. No chemistry inferred from hydrology."}
        input_file = exact_json(output / "course-input.json", case_input)
        OperatorProcess = load_operator()
        control = output / "private/control.json"
        def browser(mode, workspace, app, extra=None):
            run_dir = output / "attempts" / (mode + "-" + uuid.uuid4().hex)
            run_dir.mkdir(parents=True)
            op_state = (args.operator_state or output / "private/original-operator") if mode == "operate" else output / "private" / (mode + "-operator")
            server = OperatorProcess(app, workspace, op_state, scratch / ("operator-" + mode), run_dir,
                                     mode, args.upload_limit_mib)
            try:
                if mode != "editable" and server.receipt["project"]["id"] != ws.project["id"]:
                    raise ValueError("Original operator opened another workspace")
                private = {"mode": mode, "operator_url": server.receipt["operator_url"],
                    "workspace_key": server.receipt["workspace_key"], "output": str(output),
                    "input": case_input, "input_sha256": input_file["sha256"],
                    "node_modules": str(args.node_modules), "chromium": str(args.chromium),
                    "task_timeout_seconds": args.task_timeout_seconds,
                    "resume_failed_tasks": args.resume_failed_tasks, **(extra or {})}
                atomic_json(control, private)
                run_child([str(args.node), str(app / "source_tools/receiving_water_browser.mjs"), str(control)],
                          run_dir, "browser", args.task_timeout_seconds * 12, lock.fileno())
                return record(output / ("browser-" + mode + ".json"))
            finally:
                server.close(); control.unlink(missing_ok=True)
        stage("operator-course", lambda: browser("operate", ws.root, APP))
        operated = read_json(output / "browser-operate.json")
        if not operated.get("complete") or operated["input_sha256"] != input_file["sha256"]:
            raise ValueError("Complete the actual browser source-to-analysis course")
        # All delivered files are retained before viewing extracted relative-link reports.
        attachment_files = []
        for season in operated["seasons"]:
            for item in season["downloads"]:
                if record(item["path"]) != {k:item[k] for k in ("path", "bytes", "sha256")}:
                    raise ValueError("Original downloaded result changed")
                if item["path"].lower().endswith(".zip"):
                    attachment_files += extract_complete(item["path"],
                        output / "opened-archives" / item["sha256"])
            case = Chemistry(ws).get_case(season["case_id"])
            run = Chemistry(ws).get_run(season["run_id"])
            if run["state"] != "complete" or run["case_id"] != case["id"]:
                raise ValueError("Original season analysis is incomplete")
            # Every original source stays unchanged, including ineligible later storage.
            if case["project"]["source_period_support"]["selection"]["storage_bindings"][0]["quality_codes"] != [0]:
                raise ValueError("Storage eligibility changed")
            if season["quarter"] == "q4":
                row = case["project"]["source_period_support"]["periods"][-1]["storage"][0]
                if row["observed_storage"]["state"] != "quality-excluded" or row["observed_minus_predicted_m3"] is not None:
                    raise ValueError("October final quality-excluded storage was silently treated as eligible")
        def receive_editable():
            recipient = Workspace(scratch / "editable-recipient", create=True,
                                  title="Independent receiving — original Hartwell chemistry editions")
            results = []
            for season in operated["seasons"]:
                transfer = season["editable"]
                if record(transfer["path"]) != transfer:
                    raise ValueError("Selected editable archive changed")
                got = Chemistry(recipient).receive(transfer["path"])
                original = Chemistry(ws).get_case(season["case_id"])
                incoming = Chemistry(recipient).get_case(got["case_id"])
                if incoming["project"] != original["project"]:
                    raise ValueError("Editable receiving changed the complete chemical project")
                pairs = got["adopted_runs"]
                if not any(x["original_run_id"] == season["run_id"] for x in pairs):
                    raise ValueError("Editable receiving omitted its completed original run")
                for pair in pairs:
                    before = Chemistry(ws).get_run(pair["original_run_id"])
                    after = Chemistry(recipient).get_run(pair["run_id"])
                    if before["artifacts"] != after["artifacts"]:
                        raise ValueError("Receiving changed original numerical result files")
                results.append({"quarter": season["quarter"], "receipt": got})
            # Expose the same full received ZIPs through original Sources so the
            # recipient browser operates the actual Chemistry receiving control.
            intake_entries = []
            for season in operated["seasons"]:
                original_zip = Path(season["editable"]["path"])
                copied = output / "editable-intake" / (season["quarter"] + "-editable-chemistry.zip")
                exact(copied, original_zip.read_bytes())
                intake_entries.append({"id": season["quarter"], "path": copied.name,
                    "sha256": season["editable"]["sha256"], "kind": "document",
                    "title": "Original " + season["quarter"] + " editable Chemistry",
                    "uri": "urn:sha256:" + season["editable"]["sha256"],
                    "vintage": "2025", "notes": ["Complete original editable archive; receive through the existing Chemistry desk."]})
            intake_manifest = output / "editable-intake/sources.json"
            exact_json(intake_manifest, {"schema": "upstate.sources/v1",
                "title": "Original completed Hartwell editable archives", "entries": intake_entries})
            intake = recipient.import_sources(intake_manifest)
            # A later explicit child confirms editability without recalculating accepted results.
            incoming = Chemistry(recipient).get_case(results[0]["receipt"]["case_id"])
            edited = deepcopy(incoming["project"])
            edited["title"] += " — receiving notes edition"
            edited["receiving_notes"] = "Independent recipient retained all original hydrology and chemistry, then saved this notes edition."
            child = Chemistry(recipient).save_case({"project": edited, "parent_id": incoming["id"],
                "source_refs": incoming["source_refs"], "reason": edited["receiving_notes"]})
            before = inventory(recipient.root)
            replay = Chemistry(recipient).receive(operated["seasons"][0]["editable"]["path"])
            if replay != results[0]["receipt"]:
                raise ValueError("Original editable receive replay differs")
            preserve(recipient.root, before)
            return {"workspace": str(recipient.root), "project": recipient.project, "seasons": results,
                    "later_case": child, "receive_source_collection_id": intake["id"],
                    "original_receive_replayed_after_later_work": True}
        editable = stage("independent-editable-receiving", receive_editable)
        stage("editable-browser", lambda: browser("editable", Path(editable["workspace"]), APP,
                                                  {"editable": editable}))
        preserve(ws.root, state["before"])
        exact_json(output / "complete-original-catalog.json", Chemistry(ws).catalog())
        before_backup = stage("complete-workspace-before-backup", lambda: {name: {k: record(ws.root / name)[k] for k in ("bytes", "sha256")} for name in portable._inventory(ws.root, include_intermediates=True, include_deliveries=True, excluded=set())})
        archive = output / "complete-scientific-workspace.zip"
        def make_backup():
            if archive.exists():
                inspected = portable.inspect_archive(archive, verify=True)
                # Native inspection is authoritative; complete current original members are checked on receiving below.
                return {"file": record(archive), "native": inspected}
            value = portable.backup(ws, archive)
            return {"file": record(archive), "native": value}
        backup = stage("complete-workspace-backup", make_backup)
        destination = scratch / "complete-workspace-received"
        def receive_whole():
            if destination.exists():
                return portable.resume_restore(archive, destination, expected_archive_sha256=backup["file"]["sha256"])
            return portable.restore(archive, destination)
        whole = stage("complete-workspace-receiving", receive_whole)
        if whole["project"]["id"] != ws.project["id"] or whole["archive_sha256"] != backup["file"]["sha256"]:
            raise ValueError("Whole workspace receiving changed original identity")
        reopened = Workspace(whole["workspace"])
        # The native receiver verifies every frozen member, including SQLite snapshots.
        # Original plain source/case/run files remain exact; native database receiving
        # owns checkpoint/registration details rather than a second database copier.
        portable.inspect_archive(archive, verify=True)
        for name, expected in before_backup.items():
            if name.endswith((".sqlite", ".sqlite3", ".db", "-wal", "-shm")):
                continue
            got = record(reopened.root / name)
            if {k: got[k] for k in ("bytes", "sha256")} != expected:
                raise ValueError("Whole receiving changed an original member: " + name)
        for season in operated["seasons"]:
            if Chemistry(reopened).get_case(season["case_id"]) != Chemistry(ws).get_case(season["case_id"]):
                raise ValueError("Whole receiving changed original immutable case")
            if Chemistry(reopened).get_run(season["run_id"]) != Chemistry(ws).get_run(season["run_id"]):
                raise ValueError("Whole receiving changed original completed analysis")
        stage("whole-workspace-browser-reopen", lambda: browser("reopened", reopened.root,
                                                               Path(whole["application"]), {"original_browser": operated}))
        # Prefer each complete extracted member's original relative layout for viewing.
        # A downloaded report and its archive member can have the same bytes.
        by_hash = {}
        for f in [*attachment_files, *case_input["originals"],
                  *[f for s in operated["seasons"] for f in s["downloads"]]]:
            by_hash.setdefault(f["sha256"], f)
        views = list(by_hash.values())
        exact_json(output / "attachment-view-input.json", views)
        stage("complete-attachment-browser", lambda: browser("attachments", ws.root, APP,
            {"attachments": views}))
        preserve(ws.root, state["before"])
        state.update(complete=True, completed_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                     workspace_archive=backup["file"], editable_receiving=editable,
                     whole_receiving=whole, seasons=operated["seasons"],
                     screenshots_require_producer_view=True)
        state["files"] = [input_file, backup["file"], record(output / "complete-original-catalog.json"),
                          record(output / "attachment-view-input.json")]
        for mode in ("operate", "editable", "reopened", "attachments"):
            state["files"].append(record(output / ("browser-" + mode + ".json")))
        atomic_json(journal, state)
        print(json.dumps({"complete": True, "operation_id": OPERATION, "result": record(journal),
                          "workspace_archive": backup["file"], "workspace_id": ws.project["id"]}))


if __name__ == "__main__":
    main()
