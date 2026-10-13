#!/usr/bin/env python3
"""One complete Python/JavaScript application source edition, using both maintained collectors.

This composes source analysis and private create-only receiving. It never imports the
selected application, installs dependencies, starts its servers, or infers launch roots.
"""
from __future__ import annotations
import argparse
import gzip
import hashlib
import json
import os
import shutil
import signal
import stat
import subprocess
import sys
import tempfile
from pathlib import Path
import python_source_closure as python_source

SCHEMA = "commons.application-source-closure/v1"
SELECTION = "commons.application-source-selection/v1"
MAX_PACKET = python_source.MAX_PACKET
MAX_MEMBERS = 8192
MAX_SOURCE_BYTES = 64 * 1024 * 1024
MAX_FILE_BYTES = 8 * 1024 * 1024
TOOLS = [
    "application_source_closure.py", "application_source_bridge.cjs",
    "python_source_closure.py", "source_closure_cli.cjs",
    "connected_javascript_source_closure.cjs",
    "vendor/acorn-source-closure/acorn.cjs",
]
IDENTITY_KEYS = ("path", "bytes", "sha256", "git_blob_sha1", "mode")
fail = python_source.fail
portable = python_source.portable
json_bytes = python_source.json_bytes
row_bytes = python_source.row_bytes
read_regular = python_source.read_regular
publish = python_source.publish
safe_path = python_source.safe_path
ordinary_directory = python_source.ordinary_directory


def selection(value):
    allowed = {"schema", "label", "python", "javascript", "resources", "directories"}
    if not isinstance(value, dict) or set(value) - allowed or value.get("schema") != SELECTION:
        fail("APPLICATION_SELECTION", "Use the complete mixed application source selection.")
    if not isinstance(value.get("label"), str) or not value["label"].strip():
        fail("APPLICATION_SELECTION", "Give the original application source a readable label.")
    python_source.selection(value.get("python"))
    js = value.get("javascript")
    if not isinstance(js, dict) or js.get("schema") != "commons.javascript-source-selection/v1":
        fail("APPLICATION_SELECTION", "Retain the original complete JavaScript selection.")
    if not isinstance(js.get("paths"), list) or not js["paths"]:
        fail("APPLICATION_SELECTION", "Select the original Node/browser entry files.")
    for key in ("paths", "resources"):
        if not isinstance(js.get(key, []), list) or any(not isinstance(name, str) for name in js.get(key, [])):
            fail("APPLICATION_SELECTION", "Use original JavaScript relative path lists.", {"field": key})
        for name in js.get(key, []):
            portable(name)
    for key in ("resources", "directories"):
        rows = value.get(key, [])
        if not isinstance(rows, list) or any(not isinstance(p, str) for p in rows):
            fail("APPLICATION_SELECTION", "Use complete relative path lists.", {"field": key})
        for name in rows:
            portable(name)
        if len(set(rows)) != len(rows):
            fail("APPLICATION_SELECTION", "Duplicate explicit paths.", {"field": key})
    return value


def toolchain():
    root = Path(__file__).resolve().parent
    rows = []
    for name in TOOLS:
        raw, _ = read_regular(safe_path(root, name), MAX_FILE_BYTES)
        rows.append({"path": name, **python_source.identity(raw)})
    return {"schema": "commons.application-source-tools/v1", "files": rows}


def original_tools(value):
    actual = toolchain()
    if value != actual:
        fail("APPLICATION_TOOLS_CHANGED", "Inspect this source with its original complete collector tools.",
             {"expected": value, "actual": actual})
    return actual


def node_command(node):
    if not isinstance(node, str) or not node:
        fail("APPLICATION_NODE", "Select the installed Node executable explicitly or by PATH.")
    executable = shutil.which(node)
    if executable is None:
        fail("APPLICATION_NODE", "The selected Node executable is unavailable.", {"node": node})
    return executable


def bridge(command, working, node):
    """File-based ABI avoids source-sized command arguments and pipe buffering."""
    directory = Path(tempfile.mkdtemp(prefix="javascript-call-", dir=working))
    request, response = directory / "request.json", directory / "response.json"
    publish(request, json_bytes(command))
    stdout, stderr = directory / "stdout.txt", directory / "stderr.txt"
    args = [node_command(node), str(Path(__file__).resolve().with_name("application_source_bridge.cjs")),
            "--request", str(request), "--response", str(response)]
    process = None
    with stdout.open("xb") as out, stderr.open("xb") as err:
        try:
            process = subprocess.Popen(args, stdin=subprocess.DEVNULL, stdout=out, stderr=err,
                                       start_new_session=(os.name == "posix"))
            try:
                code = process.wait(timeout=240)
            except subprocess.TimeoutExpired:
                fail("APPLICATION_PARSER_TIMEOUT", "The original JavaScript collector exceeded its parser allowance.")
        finally:
            if process is not None and process.poll() is None:
                if os.name == "posix":
                    os.killpg(process.pid, signal.SIGTERM)
                else:
                    process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    if os.name == "posix":
                        os.killpg(process.pid, signal.SIGKILL)
                    else:
                        process.kill()
                    process.wait()
    if code:
        raw, _ = read_regular(stderr, MAX_PACKET)
        fail("APPLICATION_JAVASCRIPT", "The original JavaScript collector returned an error.",
             {"exit_code": code, "stderr": raw.decode("utf-8", errors="replace")})
    value, _ = python_source.read_packet(response)
    return value


def effective_javascript(spec, python_files):
    value = json.loads(json.dumps(spec["javascript"]))
    value["resources"] = list(dict.fromkeys(
        value.get("resources", []) + spec.get("resources", []) + list(python_files)))
    return value


def compact(packet):
    return {"analysis": {k: v for k, v in packet.items() if k != "files"},
            "members": [row["path"] for row in packet["files"]]}


def expand(part, files):
    if not isinstance(part, dict) or set(part) != {"analysis", "members"}:
        fail("APPLICATION_COMPONENT", "Retain the complete original analysis and member order.")
    names = part["members"]
    if not isinstance(part["analysis"], dict) or "files" in part["analysis"]:
        fail("APPLICATION_COMPONENT", "Original analysis must use the common whole-file table.")
    if not isinstance(names, list) or any(not isinstance(name, str) for name in names) or len(set(names)) != len(names) or any(name not in files for name in names):
        fail("APPLICATION_COMPONENT", "Original component members are missing or duplicated.")
    return {**part["analysis"], "files": [files[name] for name in names]}


def union_members(groups):
    files = {}
    for rows in groups:
        for row in rows:
            raw = row_bytes(row)
            name = row["path"]
            # Never reuse the path embedded in a hash-cache object for another requested path.
            fresh = python_source.row_for(name, raw, row["mode"])
            if name in files and files[name] != fresh:
                fail("APPLICATION_SOURCE_CONFLICT", "The language collectors captured different source editions.",
                     {"path": name})
            files[name] = fresh
    if len(files) > MAX_MEMBERS or sum(row["bytes"] for row in files.values()) > MAX_SOURCE_BYTES:
        fail("APPLICATION_SOURCE_LIMIT", "The complete application exceeds the source ceiling.")
    if any(row["bytes"] > MAX_FILE_BYTES for row in files.values()):
        fail("APPLICATION_SOURCE_LIMIT", "An application member exceeds the file ceiling.")
    return files


def directory_population(files, explicit):
    directories = set(explicit)
    for name in list(files) + list(directories):
        portable(name)
        pieces = name.split("/")
        directories.update("/".join(pieces[:i]) for i in range(1, len(pieces)))
    aliases = {}
    for name in list(files) + sorted(directories):
        key = name.casefold()
        if key in aliases and aliases[key] != name:
            fail("APPLICATION_SOURCE_ALIAS", "Source paths have a case alias.", {"paths": [aliases[key], name]})
        aliases[key] = name
    overlap = set(files) & directories
    if overlap:
        fail("APPLICATION_SOURCE_ALIAS", "An application file is also a selected directory.",
             {"paths": sorted(overlap)})
    return sorted(directories)


def reconcile_python_observations(python_packet, files, directories):
    present = {name: "file" for name in files}
    present.update({name: "directory" for name in directories})
    present["."] = "directory"
    for row in python_packet["observations"]:
        actual = present.get(row["path"])
        if actual is not None and actual != row["kind"]:
            fail("APPLICATION_SEARCH_CONFLICT", "Other application members contradict an original Python search.",
                 {"path": row["path"], "observed": row["kind"], "retained": actual})


def coverage(python_packet, javascript_review, files, directories):
    contexts = {row["path"] for row in python_packet["contexts"]}
    return {
        "complete": bool(python_packet["coverage"]["complete"] and javascript_review["coverage"]["complete"]),
        "files": len(files), "source_bytes": sum(row["bytes"] for row in files.values()),
        "directories": len(directories),
        "python": python_packet["coverage"],
        "javascript": javascript_review["coverage"],
        "retained_python_resources": sorted(name for name in files
                                            if name.endswith((".py", ".pyi")) and name not in contexts),
        "scope": "Original explicit Python contexts and literal JavaScript/browser requests; complete selected resources",
        "application_execution": False,
    }


def assemble(spec, python_packet, javascript_packet, javascript_review, resources, explicit_directories, tools):
    files = union_members([python_packet["files"], javascript_packet["files"], resources])
    directories = directory_population(files, [*python_packet["directories"], *explicit_directories])
    reconcile_python_observations(python_packet, files, directories)
    return {
        "schema": SCHEMA, "selection": spec, "toolchain": tools,
        "python": compact(python_packet), "javascript": compact(javascript_packet),
        "javascript_inspection": javascript_review,
        "resource_members": [row["path"] for row in resources],
        "directories": directories, "files": [files[name] for name in sorted(files)],
        "coverage": coverage(python_packet, javascript_review, files, directories),
    }


def collect_application(root, spec, node="node", temporary_parent=None):
    spec = selection(spec)
    tools = toolchain()
    original = python_source.FilesystemSource(root, python_source.selected_limits(spec["python"].get("limits")))
    python_packet = python_source.Collector(original, spec["python"]).run()
    resources = [original.read(name) for name in spec.get("resources", [])]
    for name in spec.get("directories", []):
        if original.kind(name) != "directory":
            fail("APPLICATION_DIRECTORY", "An explicitly selected directory is unavailable.", {"path": name})
    js_spec = effective_javascript(spec, [row["path"] for row in python_packet["files"]])
    with tempfile.TemporaryDirectory(prefix="application-source-", dir=temporary_parent) as working:
        working = Path(working)
        spec_path, packet_path = working / "javascript-selection.json", working / "javascript-source.json"
        publish(spec_path, json_bytes(js_spec))
        bridge({"command": "collect", "root": str(original.root), "spec": str(spec_path),
                "output": str(packet_path)}, working, node)
        javascript_packet, _ = python_source.read_packet(packet_path)
        javascript_review = bridge({"command": "inspect", "input": str(packet_path)}, working, node)
        # The byte identity below is recomputable after rebuilding the compact component.
        javascript_review.pop("original", None)
        result = assemble(spec, python_packet, javascript_packet, javascript_review,
                          resources, spec.get("directories", []), tools)
        # Re-read all members from the one original root after BOTH collectors finish.
        for row in result["files"]:
            raw, mode = read_regular(safe_path(original.root, row["path"]), MAX_FILE_BYTES)
            if python_source.row_for(row["path"], raw, mode) != row:
                fail("APPLICATION_SOURCE_CHANGED", "The application changed during collection.", {"path": row["path"]})
        for name in result["directories"]:
            if original._kind(name) != "directory":
                fail("APPLICATION_SOURCE_CHANGED", "An application directory changed.", {"path": name})
        original.unchanged()
        original_tools(tools)
        return result


def inspect_application(packet, node="node", temporary_parent=None):
    required = {"schema", "selection", "toolchain", "python", "javascript", "javascript_inspection",
                "resource_members", "directories", "files", "coverage"}
    if not isinstance(packet, dict) or set(packet) != required or packet.get("schema") != SCHEMA:
        fail("APPLICATION_PACKET", "Retain the whole supported application source packet.")
    spec = selection(packet["selection"])
    original_tools(packet["toolchain"])
    if not isinstance(packet["files"], list) or len(packet["files"]) > MAX_MEMBERS:
        fail("APPLICATION_PACKET", "Retain the complete bounded source member table.")
    if len({row.get("path") for row in packet["files"] if isinstance(row, dict)}) != len(packet["files"]):
        fail("APPLICATION_SOURCE_ALIAS", "Duplicate source member paths.")
    files = union_members([packet["files"]])
    python_packet, js_packet = expand(packet["python"], files), expand(packet["javascript"], files)
    if python_packet["selection"] != spec["python"]:
        fail("APPLICATION_SELECTION_CHANGED", "The Python component no longer uses its original selection.")
    python_source.inspect_source(python_packet)
    if js_packet.get("selection") != effective_javascript(spec, packet["python"]["members"]):
        fail("APPLICATION_SELECTION_CHANGED", "The JavaScript component no longer uses the composed original selection.")
    if packet["resource_members"] != spec.get("resources", []) or any(p not in files for p in packet["resource_members"]):
        fail("APPLICATION_RESOURCES", "The original explicit resources differ.")
    with tempfile.TemporaryDirectory(prefix="application-inspect-", dir=temporary_parent) as working:
        working = Path(working)
        input_path = working / "javascript-source.json"
        publish(input_path, json_bytes(js_packet))
        review = bridge({"command": "inspect", "input": str(input_path)}, working, node)
        review.pop("original", None)
    expected = assemble(spec, python_packet, js_packet, review,
                        [files[name] for name in packet["resource_members"]],
                        spec.get("directories", []), packet["toolchain"])
    # Preserve every original member, analysis, order and reconstructed source identity.
    if expected != packet:
        changed = [key for key in expected if expected[key] != packet.get(key)]
        fail("APPLICATION_ANALYSIS_CHANGED", "The original mixed source analysis differs.", {"fields": changed})
    original_tools(packet["toolchain"])
    return expected


def summary(packet):
    return {"schema": SCHEMA, "status": "COMPLETE" if packet["coverage"]["complete"] else "INCOMPLETE",
            "label": packet["selection"]["label"], "coverage": packet["coverage"],
            "directories": packet["directories"],
            "python": {key: packet["python"]["analysis"][key]
                       for key in ("contexts", "resolved", "external", "computed", "errors")},
            "javascript": packet["javascript_inspection"],
            "files": [{key: row[key] for key in IDENTITY_KEYS} for row in packet["files"]]}


def receive_application(packet, raw, directory, node="node", temporary_parent=None):
    if json.loads(raw.decode("utf-8")) != packet:
        fail("APPLICATION_PACKET", "Original packet bytes differ from this application.")
    result = inspect_application(packet, node, temporary_parent)
    if not result["coverage"]["complete"]:
        fail("APPLICATION_INCOMPLETE", "Resolve the original collector errors before receiving.", summary(result))
    directory = Path(directory).absolute()
    directory = directory.parent.resolve(strict=True) / directory.name
    operation = {
        "schema": python_source.MATERIALIZATION_SCHEMA, "source_schema": SCHEMA,
        "source_sha256": hashlib.sha256(raw).hexdigest(), "source_bytes": len(raw),
        "directories": result["directories"],
        "files": [{key: row[key] for key in IDENTITY_KEYS} for row in result["files"]],
    }
    operation_raw = json_bytes(operation)
    try:
        directory.mkdir(mode=0o700)
    except FileExistsError:
        if not stat.S_ISDIR(directory.lstat().st_mode):
            fail("RECEIVING_ROOT", "The receiving root must be an ordinary private directory.")
        try:
            saved, _ = read_regular(directory / "operation.json", MAX_PACKET)
        except FileNotFoundError:
            if any(directory.iterdir()):
                fail("RECEIVING_IDENTITY", "An unidentified receiving directory is not empty.")
        else:
            if saved != operation_raw:
                fail("RECEIVING_IDENTITY", "This directory belongs to another original source operation.")
    publish(directory / "operation.json", operation_raw)
    publish(directory / "source-packet.json", raw)
    pending, target = directory / "pending", directory / "source"
    ordinary_directory(pending)
    ordinary_directory(target)
    allowed, allowed_directories = {row["path"] for row in result["files"]}, set(result["directories"])
    stack = [(target, "")]
    while stack:
        absolute, prefix = stack.pop()
        for item in absolute.iterdir():
            name, st = prefix + item.name, item.lstat()
            if stat.S_ISDIR(st.st_mode):
                if name not in allowed_directories:
                    fail("RECEIVING_EXTRA", "An unselected source directory exists.", {"path": name})
                stack.append((item, name + "/"))
            elif not stat.S_ISREG(st.st_mode) or name not in allowed:
                fail("RECEIVING_EXTRA", "An unselected or special source member exists.", {"path": name})
    for name in sorted(allowed_directories, key=lambda value: (value.count("/"), value)):
        ordinary_directory(safe_path(target, name, allow_missing=True))
    for row in result["files"]:
        path = safe_path(target, row["path"], allow_missing=True)
        publish(path, row_bytes(row), pending)
        os.chmod(path, 0o700 if row["mode"] == "100755" else 0o600)
    for row in result["files"]:
        body, mode = read_regular(safe_path(target, row["path"]), MAX_FILE_BYTES)
        if python_source.row_for(row["path"], body, mode) != row:
            fail("SOURCE_IDENTITY", "Received application bytes differ.", {"path": row["path"]})
    complete = {**operation, "status": "COMPLETE", "source_directory": "source"}
    publish(directory / "complete.json", json_bytes(complete))
    return {**complete, "directory": str(directory), "source_directory": str(target)}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    collect = commands.add_parser("collect", help="Collect one mixed application from its original root")
    collect.add_argument("--root", required=True)
    collect.add_argument("--spec", required=True)
    collect.add_argument("--output", required=True)
    collect.add_argument("--gzip", action="store_true")
    inspect = commands.add_parser("inspect", help="Replay both original analyses against complete source")
    inspect.add_argument("--input", required=True)
    receive = commands.add_parser("receive", help="Receive or resume the exact same whole application")
    receive.add_argument("--input", required=True)
    receive.add_argument("--directory", required=True)
    for command in (collect, inspect, receive):
        command.add_argument("--node", default="node")
        command.add_argument("--temporary-parent", help="Existing writable private directory for the original parser calls")
    args = parser.parse_args(argv)
    try:
        if args.command == "collect":
            spec, _ = python_source.read_packet(args.spec)
            packet = collect_application(args.root, spec, args.node, args.temporary_parent)
            raw = json_bytes(packet)
            if len(raw) > MAX_PACKET:
                fail("APPLICATION_PACKET_LIMIT", "The complete application source packet exceeds its byte ceiling.")
            output = gzip.compress(raw, compresslevel=9, mtime=0) if args.gzip else raw
            receipt = publish(args.output, output)
            result = {**summary(packet), "output": receipt, "uncompressed": python_source.identity(raw)}
        else:
            packet, raw = python_source.read_packet(args.input)
            if args.command == "inspect":
                result = {**summary(inspect_application(packet, args.node, args.temporary_parent)),
                          "original": python_source.identity(raw)}
            else:
                result = receive_application(packet, raw, args.directory, args.node, args.temporary_parent)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 2 if result["status"] == "INCOMPLETE" else 0
    except (python_source.SourceError, OSError, ValueError, EOFError) as error:
        record = error.record() if isinstance(error, python_source.SourceError) else {
            "code": type(error).__name__, "message": str(error)}
        print(json.dumps({"status": "ERROR", **record}, ensure_ascii=False, indent=2), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
