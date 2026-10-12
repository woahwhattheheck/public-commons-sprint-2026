#!/usr/bin/env python3
"""Original-application support for one complete Workbench browser receiving journey.

No repository connection is made here. Inspection uses the selected received
application. Package and workspace receiving call its original public functions.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import stat
import sys
import zipfile

sys.dont_write_bytecode = True
SCHEMA = "stellar-forge.preservation-workbench-browser.v1"

def canonical(value):
    return (json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False,
                       allow_nan=False) + "\n").encode("utf-8")

def identity(path):
    path = Path(path)
    if path.is_symlink():
        raise ValueError("An original file must not be a symlink: " + str(path))
    digest, length = hashlib.sha256(), 0
    with path.open("rb") as handle:
        before = os.fstat(handle.fileno())
        if not stat.S_ISREG(before.st_mode):
            raise ValueError("Expected an original regular file: " + str(path))
        while block := handle.read(262144):
            digest.update(block)
            length += len(block)
        after = os.fstat(handle.fileno())
    keys = ("st_dev", "st_ino", "st_size", "st_mtime_ns", "st_ctime_ns")
    if any(getattr(before, name) != getattr(after, name) for name in keys):
        raise ValueError("Original file changed during inspection: " + str(path))
    return {"bytes": length, "sha256": digest.hexdigest()}

def inventory(w, root):
    result = {}
    for name, path in sorted(w.tree_files(root).items()):
        if name == "workspace.lock" or name.endswith(("/workspace.lock", "/operation.lock")):
            continue
        result[name] = identity(path)
    return result

def load(application):
    application = Path(application).resolve()
    directory = application / "research/preservation"
    sys.path.insert(0, str(directory))
    import preservation as p
    import preservica as q
    import preservica_client as c
    import workbench as w
    for module in (p, q, c, w):
        if Path(module.__file__).resolve().parent != directory:
            raise ValueError("The selected original application was not imported.")
    return application, p, q, c, w

def inspect(args, p, q, c, w):
    root = Path(args.workspace).resolve()
    control = root.parent / (root.name + ".operator")
    selected_path = control / "operations" / args.operation_id / "selection.json"
    selected = w.read_json(selected_path)
    if selected["id"] != args.operation_id or selected["provider"] != "preservica":
        raise ValueError("Select the completed original Preservica destination.")
    prepared = selected_path.parent / "prepared"
    progress = c.show(prepared, args.operation_id)
    handoff = q.verify_workspace(prepared)
    status = p.show(root)
    source_files = inventory(w, prepared)
    reviews = {name: identity(path) for name, path in sorted(w.tree_files(root).items())
               if name.startswith("reviews/")}
    return {
        "schema": SCHEMA + ".inspection", "workspace": str(root),
        "control": str(control), "prepared": str(prepared),
        "status": status, "history": w.review_history(root, status),
        "operation": selected, "operationFile": identity(selected_path),
        "progress": progress, "handoffId": handoff["id"],
        "preparedInventory": source_files,
        "preparedInventorySha256": hashlib.sha256(canonical(source_files)).hexdigest(),
        "reviewFiles": reviews,
    }

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", required=True)
    actions = parser.add_subparsers(dest="action", required=True)
    check = actions.add_parser("inspect")
    check.add_argument("--workspace", required=True)
    check.add_argument("--operation-id", required=True)
    bag = actions.add_parser("package")
    bag.add_argument("--source", required=True)
    bag.add_argument("--output")
    receive = actions.add_parser("receive")
    receive.add_argument("--source", required=True)
    receive.add_argument("--output", required=True)
    args = parser.parse_args()
    application, p, q, c, w = load(args.application)
    if args.action == "inspect":
        value = inspect(args, p, q, c, w)
    elif args.action == "package":
        value = {"verification": p.verify(args.source), "archive": identity(args.source)}
        if args.output:
            value["receiving"] = p.receive(args.source, args.output)
    else:
        with zipfile.ZipFile(args.source) as archive:
            manifest = w.snapshot_manifest(archive)
        received = w.receive_workspace(args.source, args.output)
        target = Path(args.output)
        members, preserved_runtime = {}, {}
        runtime_members = {"operator/jobs.json", "operator/artifacts.json"}
        for name, expected in manifest["files"].items():
            relative = name.split("/")
            path = target.joinpath(*(
                ["workspace.operator"] + relative[1:] if relative[0] == "operator" else relative))
            actual = identity(path)
            if actual != expected:
                if received.get("reused") and name in runtime_members:
                    # Opening the original Workbench records its retained interrupted
                    # local export job; this does not change a provider operation.
                    preserved_runtime[name] = {"archived": expected, "current": actual}
                    continue
                raise ValueError("Cold receiving member changed: " + name)
            members[name] = actual
        value = {"received": received, "archive": identity(args.source),
                 "manifest": manifest, "verifiedMembers": len(members),
                 "preservedRuntimeRecords": preserved_runtime,
                 "memberInventorySha256": hashlib.sha256(canonical(members)).hexdigest()}
    print(json.dumps(value, ensure_ascii=False, sort_keys=True, allow_nan=False))

if __name__ == "__main__":
    main()
