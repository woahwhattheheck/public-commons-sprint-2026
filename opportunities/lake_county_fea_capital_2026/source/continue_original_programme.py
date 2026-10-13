#!/usr/bin/env python3
"""Continue the original complete FEA programme with the maintained process controller.

The selected saved work order supplies the entire original producer. The controller
runs that whole producer, so its existing collector/checkpoint acknowledgement
conversation and guarded saves retain their original process relationship.
"""
from __future__ import annotations

import argparse
import ast
import base64
import hashlib
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import re
import sys
import tempfile
import traceback
import zipfile

OPERATION = "FEA-LAKE-COUNTY-CAPITAL-OPERATING-018A-20261012-01"
CONTROLLER_SHA256 = "1833c0bb77717fc453d1d0ae03984d650132e1e75a325a25eeee99c50a51f4b2"
PRODUCER_SHA256 = "6e8e43ff89688c571f326b4efdf81cc5532682a0355272d3ad20131e97a0e0df"
WORK_ORDER_SHA256 = "a43943541594b8c659d51cf1f8557be6e1f2694f11e69d27908fc6eb5f1e491c"


def identity(data):
    return {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}


def original_bytes(path, expected):
    value = Path(path).read_bytes()
    if identity(value) != expected:
        raise ValueError("The complete selected source differs: " + str(path))
    return value


def retain(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with path.open("xb") as stream:
        path.chmod(0o600)
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())


def retain_json(path, value):
    retain(path, (json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n").encode())


def complete_order(producer):
    match = re.search(r'^ORDER=json\.loads\(base64\.b64decode\("([A-Za-z0-9+/=]+)"\)\)', producer, re.M)
    if not match:
        raise ValueError("The selected original producer has no complete embedded work order")
    value = json.loads(base64.b64decode(match.group(1), validate=True))
    if value.get("operation_id") != OPERATION:
        raise ValueError("Retain the original FEA operation")
    return value


def selected_cache(checkpoint, descriptor, order, cache):
    """Reuse exact original application sources already present in the saved ZIP."""
    raw = original_bytes(checkpoint, {key: descriptor[key] for key in ("bytes", "sha256")})
    prefix = "Lake_County_FEA_Capital_Programme_20261012/"
    with zipfile.ZipFile(Path(checkpoint)) as package:
        names = package.namelist()
        if len(names) != len(set(names)):
            raise ValueError("The selected checkpoint repeats an archive member")
        manifest = json.loads(package.read(prefix + "DELIVERY.json"))
        if (manifest.get("operation_id") != OPERATION or
                manifest.get("source_commit") != order["source_commit"] or
                manifest.get("complete") is not False or
                manifest.get("safe_source_reuse") is not True):
            raise ValueError("Select the saved source checkpoint for this original operation")
        members = manifest["files"]
        if set(names) != {prefix + "DELIVERY.json", *(prefix + item["path"] for item in members)}:
            raise ValueError("The original complete archive member inventory differs")
        source_names = {}
        for item in members:
            relative = item["path"]
            if (PurePosixPath(relative).is_absolute() or "\\" in relative or
                    any(part in ("", ".", "..") for part in relative.split("/"))):
                raise ValueError("Invalid original checkpoint member path")
            info = package.getinfo(prefix + relative)
            if (info.external_attr >> 16) & 0o170000 == 0o120000:
                raise ValueError("Retain original files, not symbolic links")
            data = package.read(info)
            if identity(data) != {key: item[key] for key in ("bytes", "sha256")}:
                raise ValueError("The complete original archive member differs: " + relative)
            source_names[relative] = info
        reused = []
        for item in order["files"] + [order["packet"]] + order.get("support_sources", []):
            relative = item["path"]
            archive_name = relative if relative.startswith("source/") else "application/" + relative
            if archive_name not in source_names:
                continue
            data = package.read(source_names[archive_name])
            if identity(data) != {key: item[key] for key in ("bytes", "sha256")}:
                continue
            retain(cache / relative, data)
            reused.append({key: item[key] for key in ("path", "bytes", "sha256")})
    return {"checkpoint": identity(raw), "verified_archive_members": len(names), "reused_sources": reused}


def compose(producer):
    edits = [
        (
            'ROOT=pathlib.Path(tempfile.mkdtemp(prefix="fea-capital-complete-018a-",dir="/dev"));os.chmod(ROOT,0o700)',
            'ROOT=pathlib.Path(os.environ["FEA_NATIVE_ATTEMPT_ROOT"]).resolve();os.chmod(ROOT,0o700)',
        ),
        (
            'def emit(v):print(json.dumps(v,ensure_ascii=False),flush=True)',
            '''def emit(v):
    selected=pathlib.Path(os.environ["FEA_NATIVE_PROGRESS"])
    temporary=selected.with_name(selected.name+".pending")
    value={"schema":"lake-county.native-progress/v1","operation_id":ORDER["operation_id"],
           "observed_at_utc":now(),"phase":v.get("phase"),"event":v}
    with temporary.open("w",encoding="utf-8") as stream:
        os.chmod(temporary,0o600);json.dump(value,stream,ensure_ascii=False);stream.write("\\n")
        stream.flush();os.fsync(stream.fileno())
    os.replace(temporary,selected)
    print(json.dumps(v,ensure_ascii=False),flush=True)''',
        ),
        (
            '    relative=item["path"];url="https://raw.githubusercontent.com/woahwhattheheck/public-commons-sprint-2026/"+ORDER["source_commit"]+"/opportunities/lake_county_fea_capital_2026/"+relative',
            '''    relative=item["path"]
    cached=pathlib.Path(os.environ["FEA_NATIVE_SOURCE_CACHE"])/relative
    if cached.is_file():
        data=cached.read_bytes()
        if len(data)!=item["bytes"] or hashlib.sha256(data).hexdigest()!=item["sha256"]:
            raise ValueError("The selected retained source cache differs: "+relative)
        return (ROOT/relative if relative.startswith("source/") else APP/relative),data
    url="https://raw.githubusercontent.com/woahwhattheheck/public-commons-sprint-2026/"+ORDER["source_commit"]+"/opportunities/lake_county_fea_capital_2026/"+relative''',
        ),
        (
            '    options={"root":str(ROOT/"browser-runtime"),"reuseRoots":["/workspace/scratch/5403360e55a4/fleet-lightweight/shared/swarm/toolchains/browser"],"install":True}',
            '''    options={"root":str(ROOT/"browser-runtime"),
             "reuseRoots":json.loads(os.environ["FEA_BROWSER_REUSE_ROOTS"])+["/workspace/scratch/5403360e55a4/fleet-lightweight/shared/swarm/toolchains/browser"],
             "install":True}''',
        ),
        (
            '    number=str(preservation_state["number"]).zfill(4)\n    directory=ROOT/"preservation";directory.mkdir(mode=0o700,exist_ok=True)',
            '''    number=str(preservation_state["number"]).zfill(4)
    # The live controller stays outside this frozen delivery. Each saved edition
    # retains complete immutable observations taken at this original save boundary.
    observation=ROOT/"native-observations"/number
    control_root=pathlib.Path(os.environ["FEA_NATIVE_CONTROL_ROOT"])
    for name in ["native-process.json","original-producer.log","controller-context.json"]:
        selected=control_root/name
        if selected.is_file():write(observation/name,selected.read_bytes())
    directory=ROOT/"preservation";directory.mkdir(mode=0o700,exist_ok=True)''',
        ),
        (
            '    ORDER["resume_checkpoint"]["local_path"]="/workspace/scratch/018a3064f623/fea-checkpoint-resume/Lake_County_FEA_Capital_Programme_20261012.zip"',
            '    ORDER["resume_checkpoint"]["local_path"]=os.environ["FEA_NATIVE_CHECKPOINT"]',
        ),
    ]
    result = producer
    records = []
    for before, after in edits:
        if result.count(before) != 1:
            raise ValueError("The original complete producer join differs: " + before[:100])
        result = result.replace(before, after, 1)
        records.append({"before": before, "after": after})
    ast.parse(result, filename="native-producer.py")
    return result, records


def last_saved_delivery(run_root, library_file_id):
    directory = run_root / "preservation"
    results = sorted(directory.glob("*-save-result.json"))
    if not results:
        return None
    path = results[-1]
    result = json.loads(path.read_text())
    intent_path = path.with_name(path.name.replace("-save-result.json", "-save-intent.json"))
    intent = json.loads(intent_path.read_text())
    rows = result.get("results", [])
    if (len(rows) != 1 or rows[0].get("status") != "succeeded" or
            rows[0].get("library_file_id") != library_file_id or
            type(rows[0].get("current_version_number")) is not int or
            rows[0]["current_version_number"] != intent["request"]["expected_current_version"] + 1):
        return {"saved": False, "intent": str(intent_path), "result": str(path)}
    return {"saved": True, "complete": intent["artifact"]["complete"],
            "artifact": intent["artifact"], "library_file_id": library_file_id,
            "file_id": rows[0].get("file_id"),
            "current_version_number": rows[0]["current_version_number"],
            "intent": str(intent_path), "result": str(path)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--work-order", required=True, type=Path)
    parser.add_argument("--controller", required=True, type=Path)
    parser.add_argument("--checkpoint", required=True, type=Path)
    parser.add_argument("--working-directory", required=True, type=Path)
    parser.add_argument("--reuse-browser-root", action="append", default=[])
    parser.add_argument("--timeout-seconds", type=float, default=3600)
    args = parser.parse_args()
    order_raw = original_bytes(args.work_order, {"bytes": 301642, "sha256": WORK_ORDER_SHA256})
    selected = json.loads(order_raw)
    if selected.get("operation_id") != OPERATION:
        raise ValueError("Select the original full receiving work order")
    envelope = selected["producer_envelope"]
    producer_raw = base64.b64decode(envelope["base64"], validate=True)
    if (identity(producer_raw) != {key: envelope[key] for key in ("bytes", "sha256")} or
            hashlib.sha256(producer_raw).hexdigest() != PRODUCER_SHA256):
        raise ValueError("The selected complete corrected producer differs")
    producer = producer_raw.decode()
    order = complete_order(producer)
    controller_raw = original_bytes(args.controller, {"bytes": 22630, "sha256": CONTROLLER_SHA256})
    ast.parse(controller_raw, filename="scf_native_process.py")
    joined, joins = compose(producer)
    # This is a new execution directory for the same operation, not a replacement
    # of an earlier process record. The original saved checkpoint remains selected.
    parent = args.working_directory.resolve()
    parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    control_root = Path(tempfile.mkdtemp(prefix="fea-native-controller-018a-", dir=parent))
    run_root = Path(tempfile.mkdtemp(prefix="fea-capital-complete-018a-", dir=parent))
    control_root.chmod(0o700)
    run_root.chmod(0o700)
    cache = control_root / "source-cache"
    cache.mkdir(mode=0o700)
    controller_file = control_root / "scf_native_process.py"
    retain(controller_file, controller_raw)
    retain(control_root / "selected-work-order.json", order_raw)
    retain(control_root / "selected-original-producer.py", producer_raw)
    retain_json(control_root / "producer-source-joins.json", joins)
    joined_path = control_root / "observed-original-producer.py"
    retain(joined_path, joined.encode())
    source_context = {
        "source_commit": order["source_commit"], "work_order": identity(order_raw),
        "selected_producer": identity(producer_raw), "composed_producer": identity(joined.encode()),
        "controller": {"repository": "woahwhattheheck/tjlabs-stellar-merchant-workspace",
                       "commit": "004039d83f11b95009bfae10806b70b9725d3bbf",
                       **identity(controller_raw)},
        "control_root": str(control_root), "original_native_root": str(run_root),
        "checkpoint": {key: selected["resume_checkpoint"][key] for key in
                       ("library_file_id", "current_version_number", "bytes", "sha256")},
    }
    retain_json(control_root / "controller-context.json", source_context)
    spec = importlib.util.spec_from_file_location("fea_maintained_native_process", controller_file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.preserve_console(control_root / "controller-console.log")
    controller = module.NativeProcessController(
        OPERATION, run_root, control_root / "native-process.json", source_context)
    print(json.dumps({"phase": "FEA_CONTROLLER_READY", "operation_id": OPERATION,
                      "native_root": str(run_root), "controller_root": str(control_root),
                      "record": str(control_root / "native-process.json")}), flush=True)
    result_path = control_root / "controller-result.json"
    try:
        cache_result = selected_cache(
            args.checkpoint, selected["resume_checkpoint"], order, cache)
        retain_json(control_root / "retained-source-selection.json", cache_result)
        print(json.dumps({"phase": "FEA_COMPLETE_CHECKPOINT_REUSED",
                          "operation_id": OPERATION, **cache_result}), flush=True)
        retain(run_root / "selected-native-producer.py", producer_raw)
        retain_json(run_root / "native-source-joins.json", joins)
        environment = os.environ.copy()
        environment.update(FEA_NATIVE_ATTEMPT_ROOT=str(run_root),
                           FEA_NATIVE_CONTROL_ROOT=str(control_root),
                           FEA_NATIVE_PROGRESS=str(control_root / "progress.json"),
                           FEA_NATIVE_SOURCE_CACHE=str(cache),
                           FEA_NATIVE_CHECKPOINT=str(args.checkpoint.resolve()),
                           FEA_BROWSER_REUSE_ROOTS=json.dumps(args.reuse_browser_root),
                           PYTHONDONTWRITEBYTECODE="1", PYTHONUNBUFFERED="1")
        entry = ("import pathlib,sys; p=pathlib.Path(sys.argv[1]); b=p.read_bytes(); "
                 "n={'__name__':'__main__','__file__':str(p),'SELECTED_PRODUCER_RAW':b}; "
                 "exec(compile(b,str(p),'exec'),n,n)")
        phase = controller.run(
            "complete-original-fea-programme",
            [sys.executable, "-B", "-u", "-c", entry, str(joined_path)],
            control_root / "original-producer.log", cwd=run_root, env=environment,
            timeout_seconds=args.timeout_seconds, progress_path=control_root / "progress.json")
        outcome_path = run_root / "native-outcome.json"
        outcome = json.loads(outcome_path.read_text()) if outcome_path.is_file() else None
        saved = last_saved_delivery(run_root, selected["outputs"]["same_library_file_id"])
        complete = bool(phase["state"] == "COMPLETE" and outcome and
                        outcome.get("operation_id") == OPERATION and outcome.get("complete") is True and
                        saved and saved["saved"] and saved["complete"])
        result = {"schema": "lake-county.native-controller-result/v1", "operation_id": OPERATION,
                  "complete": complete, "native_root": str(run_root), "controller_root": str(control_root),
                  "phase_state": phase["state"], "exit_code": phase["exit_code"],
                  "outcome": outcome, "saved_delivery": saved}
        retain_json(result_path, result)
        controller.finish("COMPLETE" if complete else "INCOMPLETE", application_result=result_path)
        print(json.dumps({"phase": "FEA_CONTROLLER_FINISHED", **result}), flush=True)
        return 0 if complete else 2
    except BaseException as exc:
        result = {"schema": "lake-county.native-controller-result/v1", "operation_id": OPERATION,
                  "complete": False, "native_root": str(run_root), "controller_root": str(control_root),
                  "error": {"type": type(exc).__name__, "message": str(exc), "traceback": traceback.format_exc()}}
        if not result_path.exists():
            retain_json(result_path, result)
        controller.finish("INTERRUPTED" if isinstance(exc, KeyboardInterrupt) else "INCOMPLETE",
                          application_result=result_path, error=result["error"])
        print(json.dumps({"phase": "FEA_CONTROLLER_FINISHED", **result}), flush=True)
        return 130 if isinstance(exc, KeyboardInterrupt) else 2


if __name__ == "__main__":
    raise SystemExit(main())
