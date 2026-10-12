#!/usr/bin/env python3
"""Headless operation of the original SF47 retained planning workspace."""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import re
import sys
import tempfile
import zipfile

from model import HERE, MAX_BUNDLE, SCHEMA, SOURCE_URL, Problem, Workspace, canonical, now, short_id


COLLECTION_SCHEMA = SCHEMA + ".collection.v1"
MAX_COLLECTION = 128 * 1024 * 1024
MAX_COLLECTION_PLANS = 10000
DEFAULT_SOURCE = HERE.parent / "sf10_current_candidate.json"


def sha256(raw):
    return hashlib.sha256(raw).hexdigest()


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n").encode("utf-8")


def read_bytes(filename, maximum=MAX_BUNDLE):
    path = Path(filename).expanduser().resolve()
    with path.open("rb") as source:
        raw = source.read(maximum + 1)
    if len(raw) > maximum:
        raise Problem(f"Input exceeds {maximum} bytes: {path}", 413, "INPUT_TOO_LARGE")
    return raw


def decode_json(raw, label):
    try:
        value = json.loads(raw.decode("utf-8-sig"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise Problem(f"Use a UTF-8 JSON object: {label}", 422, "INVALID_JSON") from exc
    if not isinstance(value, dict):
        raise Problem(f"Use a JSON object: {label}", 422, "INVALID_JSON")
    return value


def read_json(filename):
    return decode_json(read_bytes(filename), filename)


def sync_directory(path):
    handle = os.open(path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(handle)
    finally:
        os.close(handle)


def publish(filename, raw, allow_identical=False):
    """Publish complete private bytes without replacing an existing output."""
    destination = Path(filename).expanduser().absolute()
    if not destination.parent.is_dir():
        raise Problem(f"Output directory does not exist: {destination.parent}", 422, "OUTPUT_DIRECTORY_MISSING")
    expected = sha256(raw)
    if destination.exists() or destination.is_symlink():
        if allow_identical and not destination.is_symlink() and read_bytes(destination, max(len(raw), 1)) == raw:
            return {"path": str(destination), "bytes": len(raw), "sha256": expected, "existing": True}
        raise Problem(f"Output already exists; select a new filename: {destination}", 409, "OUTPUT_EXISTS")
    descriptor, temporary = tempfile.mkstemp(prefix=f".{destination.name}.", dir=destination.parent)
    warning = None
    linked = False
    try:
        with os.fdopen(descriptor, "wb") as stream:
            os.fchmod(stream.fileno(), 0o600)
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        try:
            os.link(temporary, destination)
            linked = True
        except FileExistsError as exc:
            if allow_identical and not destination.is_symlink() and read_bytes(destination, max(len(raw), 1)) == raw:
                return {"path": str(destination), "bytes": len(raw), "sha256": expected, "existing": True}
            raise Problem(f"Output already exists; select a new filename: {destination}", 409, "OUTPUT_EXISTS") from exc
        try:
            sync_directory(destination.parent)
        except OSError as exc:
            # A completed link is visible even if the durability acknowledgment fails.
            # Read back those exact bytes before returning its usable path and warning.
            if read_bytes(destination, max(len(raw), 1)) != raw:
                raise
            warning = f"Complete bytes were read back; directory sync failed: {exc}"
    finally:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass
    result = {"path": str(destination), "bytes": len(raw), "sha256": expected}
    if linked and warning:
        result["durabilityWarning"] = warning
    return result


def summary(plan):
    return {key: plan[key] for key in
            ("id", "name", "revision", "currentRevision", "source", "savedAt", "contentSha256")}


def selected_plan(workspace, plan_id, expected_revision):
    current = workspace.read(plan_id)
    if current["currentRevision"] != expected_revision:
        raise Problem("A newer saved revision exists. Reopen it before exporting.", 409, "REVISION_CONFLICT")
    return current


def planning_input(workspace, args):
    # Preserve the explicitly reviewed revision, including during an exact save replay.
    # Reading the latest planning instead would change the saved request fingerprint.
    if args.planning:
        return read_json(args.planning)
    return workspace.read(args.plan, args.expected_revision)["planning"]


def collection_export(workspace):
    plans = workspace.list()
    if len(plans) > MAX_COLLECTION_PLANS:
        raise Problem("Use individual exports for a collection above 10,000 plans.", 413, "COLLECTION_TOO_LARGE")
    rows = []
    stream = io.BytesIO()
    expanded = 0
    with zipfile.ZipFile(stream, "w", zipfile.ZIP_STORED) as archive:
        for item in plans:
            plan = workspace.read(item["id"])
            raw = workspace.export(item["id"])
            if len(raw) > MAX_BUNDLE:
                raise Problem(f"Plan exceeds the original bundle import limit: {item['id']}", 413, "BUNDLE_TOO_LARGE")
            expanded += len(raw)
            if expanded > MAX_COLLECTION:
                raise Problem("Collection exceeds 128 MiB; use individual plan exports.", 413, "COLLECTION_TOO_LARGE")
            path = f"plans/{item['id']}.zip"
            rows.append({"path": path, "bytes": len(raw), "sha256": sha256(raw), **summary(plan)})
            info = zipfile.ZipInfo(path, (2026, 1, 1, 0, 0, 0))
            info.external_attr = 0o600 << 16
            archive.writestr(info, raw)
        manifest = {"schema": COLLECTION_SCHEMA, "exportedAt": now(), "plans": rows}
        archive.writestr("COLLECTION.json", json_bytes(manifest))
    raw = stream.getvalue()
    if len(raw) > MAX_COLLECTION:
        raise Problem("Collection exceeds 128 MiB; use individual plan exports.", 413, "COLLECTION_TOO_LARGE")
    return raw, manifest


def read_collection(raw):
    """Read an envelope of unchanged native bundles; native import validates each plan."""
    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            infos = archive.infolist()
            names = [item.filename for item in infos]
            if len(infos) > MAX_COLLECTION_PLANS + 1 or len(names) != len(set(names)):
                raise Problem("Collection has duplicate or excessive entries.", 422, "INVALID_COLLECTION")
            if sum(item.file_size for item in infos) > MAX_COLLECTION:
                raise Problem("Expanded collection exceeds 128 MiB.", 413, "COLLECTION_TOO_LARGE")
            if "COLLECTION.json" not in names or archive.getinfo("COLLECTION.json").file_size > MAX_BUNDLE:
                raise Problem("Use a complete SF47 collection export.", 422, "INVALID_COLLECTION")
            manifest = json.loads(archive.read("COLLECTION.json"))
            if not isinstance(manifest, dict) or manifest.get("schema") != COLLECTION_SCHEMA:
                raise Problem("Unrecognized SF47 collection.", 422, "INVALID_COLLECTION")
            if not isinstance(manifest.get("exportedAt"), str) or not 1 <= len(manifest["exportedAt"]) <= 100:
                raise Problem("Collection export time is missing.", 422, "INVALID_COLLECTION")
            rows = manifest.get("plans")
            if not isinstance(rows, list) or not 1 <= len(rows) <= MAX_COLLECTION_PLANS:
                raise Problem("Collection must contain saved plans.", 422, "INVALID_COLLECTION")
            seen = set()
            bundles = []
            for row in rows:
                if not isinstance(row, dict) or not re.fullmatch(r"plan-[a-f0-9]{32}", str(row.get("id", ""))):
                    raise Problem("Collection has an invalid original plan ID.", 422, "INVALID_COLLECTION")
                path = f"plans/{row['id']}.zip"
                if row["id"] in seen or row.get("path") != path:
                    raise Problem("Collection plan identity is repeated or mismatched.", 422, "INVALID_COLLECTION")
                seen.add(row["id"])
                if archive.getinfo(path).file_size > MAX_BUNDLE:
                    raise Problem("A plan exceeds the original 32 MiB bundle limit.", 413, "BUNDLE_TOO_LARGE")
                data = archive.read(path)
                if len(data) != row.get("bytes") or sha256(data) != row.get("sha256"):
                    raise Problem(f"Plan bundle differs from the collection manifest: {path}", 422, "INVALID_COLLECTION")
                # This is transport identity, not a replacement for native bundle validation.
                with zipfile.ZipFile(io.BytesIO(data)) as bundle:
                    info = bundle.getinfo("workspace.json")
                    if info.file_size > MAX_BUNDLE:
                        raise Problem("Native workspace document exceeds 32 MiB.", 413, "BUNDLE_TOO_LARGE")
                    document = json.loads(bundle.read("workspace.json"))
                original = document.get("plan", {})
                revisions = document.get("revisions", [])
                if (original.get("id") != row["id"] or original.get("name") != row.get("name")
                        or original.get("source") != row.get("source") or not revisions
                        or revisions[-1].get("revision") != row.get("revision")
                        or revisions[-1].get("contentSha256") != row.get("contentSha256")):
                    raise Problem(f"Collection identity differs from its native bundle: {path}", 422, "INVALID_COLLECTION")
                bundles.append((row, data))
            if set(names) != {"COLLECTION.json", *(row["path"] for row in rows)}:
                raise Problem("Collection includes unexpected entries.", 422, "INVALID_COLLECTION")
            return manifest, bundles
    except (zipfile.BadZipFile, json.JSONDecodeError, UnicodeDecodeError, KeyError, TypeError, AttributeError, RuntimeError) as exc:
        raise Problem("Use a complete readable SF47 collection export.", 422, "INVALID_COLLECTION") from exc


def collection_import(workspace, raw, request_id, prepared):
    request_id = short_id(request_id, "Request ID")
    manifest, bundles = prepared
    # Pin one operation to exact transport bytes before the first native import.
    # Each native import then supplies its own existing transactional replay contract.
    directory = workspace.root / "cli-imports"
    directory.mkdir(mode=0o700, exist_ok=True)
    record = {"schema": COLLECTION_SCHEMA + ".request", "requestId": request_id,
              "inputSha256": sha256(raw), "plans": [{"id": row["id"], "sha256": row["sha256"]} for row, _ in bundles]}
    checkpoint = directory / (sha256(request_id.encode()) + ".json")
    if checkpoint.exists() and read_bytes(checkpoint) != json_bytes(record):
        raise Problem("This collection request ID already belongs to different bytes.", 409, "REQUEST_CONFLICT")
    publication = publish(checkpoint, json_bytes(record), allow_identical=True)
    imported = []
    for row, data in bundles:
        native_request = "collection-" + sha256((request_id + "\0" + row["id"]).encode())
        try:
            plan = workspace.import_bundle(data, row["name"], native_request)
        except Problem as exc:
            raise Problem(f"Collection import stopped at {row['id']}: {exc}. "
                          f"Retained imports are safe to resume with the same input and request ID; operation record: {checkpoint}",
                          exc.status, exc.code) from exc
        imported.append({"originalId": row["id"], "bundleSha256": row["sha256"], **summary(plan)})
    result = {"inputSha256": record["inputSha256"], "requestId": request_id,
              "exportedAt": manifest["exportedAt"], "operationRecord": str(checkpoint), "plans": imported}
    if publication.get("durabilityWarning"):
        result["durabilityWarning"] = publication["durabilityWarning"]
    return result


def positive_revision(value):
    try:
        revision = int(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("Use a saved revision number.") from exc
    if not 1 <= revision <= 1000000:
        raise argparse.ArgumentTypeError("Revision must be between 1 and 1,000,000.")
    return revision


def operations_extension():
    """Join the original optional operations module without opening state during help."""
    if not Path(__file__).with_name("operations_cli.py").is_file():
        return None
    import operations_cli
    return operations_cli


def parser():
    root = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter,
                                   epilog="Start: init --workspace PATH, then list/show. Every command has --help.\n"
                                          "Use serve for the original private browser workspace. Close it before headless commands.")
    commands = root.add_subparsers(dest="command", required=True)
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--workspace", required=True, help="Private original planning workspace directory")
    common.add_argument("--scenario", default=str(DEFAULT_SOURCE), help="Original scenario used when initializing a new workspace")

    def command(name, help_text):
        return commands.add_parser(name, parents=[common], help=help_text, description=help_text)

    def plan_options(target, expected=False):
        target.add_argument("--plan", required=True, help="Original plan ID from list")
        if expected:
            target.add_argument("--expected-revision", required=True, type=positive_revision,
                                help="Explicit current saved revision reviewed for this action")

    def request_options(target, note=False):
        target.add_argument("--request-id", required=True, help="Stable operation ID; reuse with exact inputs for recovery")
        if note:
            target.add_argument("--note", required=True, help="Reason for this saved revision")

    def output_option(target):
        target.add_argument("--output", help="Write JSON to a new private file instead of stdout")

    command("init", "Initialize the original workspace and canonical source plan")
    target = command("serve", "Open the original private browser workspace")
    target.add_argument("--port", type=int, default=0)
    target.add_argument("--access-file")
    target.add_argument("--startup-format", choices=("legacy", "managed"), default="legacy")
    target.add_argument("--expected-selection-sha256", help="Original managed launch review")
    target.add_argument("--source-directory", help="Installed original source selected by Applications")
    output_option(command("list", "List saved plans and current revisions"))
    target = command("show", "Read a saved revision or one complete source/planning/report section")
    plan_options(target)
    target.add_argument("--revision", type=positive_revision)
    target.add_argument("--part", choices=("all", "scenario", "planning", "report", "delivery", "source"), default="all")
    output_option(target)
    target = command("history", "Read the original saved revision history")
    plan_options(target)
    output_option(target)
    target = command("import-scenario", "Create a named plan from exact original scenario JSON")
    target.add_argument("--file", required=True)
    target.add_argument("--name", required=True)
    target.add_argument("--planning", help="Complete planning JSON; defaults to the original empty planning inputs")
    target.add_argument("--source-url", default=SOURCE_URL)
    request_options(target, note=True)
    for name, help_text in (("estimate", "Calculate a reviewed edit with the original model without saving"),
                            ("save", "Save a reviewed scenario/planning edit as an original revision")):
        target = command(name, help_text)
        plan_options(target, expected=True)
        target.add_argument("--patch", help="Scenario patch JSON; omission preserves the saved scenario")
        target.add_argument("--planning", help="Complete planning JSON; omission preserves the explicitly reviewed revision")
        if name == "save":
            request_options(target, note=True)
        else:
            output_option(target)
    target = command("restore", "Append an original saved revision as the new current revision")
    plan_options(target, expected=True)
    target.add_argument("--revision", required=True, type=positive_revision, help="Earlier saved revision to restore")
    request_options(target, note=True)
    target = command("clone", "Create a named independent plan from a reviewed current revision")
    plan_options(target, expected=True)
    target.add_argument("--name", required=True)
    request_options(target)
    target = command("export", "Export the original complete plan ZIP with every saved revision")
    plan_options(target, expected=True)
    target.add_argument("--output", required=True, help="New output ZIP filename")
    target = command("import-bundle", "Receive an original complete plan ZIP with its history and source")
    target.add_argument("--file", required=True)
    target.add_argument("--name", help="Receiving name; original model supplies its imported name when omitted")
    request_options(target)
    target = command("export-all", "Export every saved plan as an envelope of complete original ZIPs")
    target.add_argument("--output", required=True, help="New collection ZIP filename")
    target = command("import-all", "Receive an entire collection with restart-safe native plan imports")
    target.add_argument("--file", required=True)
    request_options(target)
    extension = operations_extension()
    if extension is not None:
        extension.register(commands, common)
    return root


def operate(args):
    if args.command == "serve":
        from server import main as serve
        argv = [str(HERE / "server.py"), "--workspace", args.workspace, "--scenario", args.scenario, "--port", str(args.port)]
        if args.access_file:
            argv.extend(("--access-file", args.access_file))
        argv.extend(("--startup-format", args.startup_format))
        if args.expected_selection_sha256 is not None:
            argv.extend(("--expected-selection-sha256", args.expected_selection_sha256))
        if args.source_directory is not None:
            argv.extend(("--source-directory", args.source_directory))
        previous = sys.argv
        try:
            sys.argv = argv
            serve()
        finally:
            sys.argv = previous
        return None

    path = Path(args.workspace).expanduser().resolve()
    create_commands = {"init", "import-scenario", "import-bundle", "import-all"}
    if args.command not in create_commands and not (path / "planning.sqlite3").is_file():
        raise Problem("Workspace does not exist. Run init or use an import command first.", 404, "WORKSPACE_NOT_FOUND")
    prepared = None
    raw = None
    if args.command in ("import-scenario", "import-bundle", "import-all"):
        raw = read_bytes(args.file, MAX_COLLECTION if args.command == "import-all" else MAX_BUNDLE)
        if args.command == "import-all":
            prepared = read_collection(raw)
        elif args.command == "import-scenario":
            prepared = decode_json(raw, args.file)
    workspace = Workspace(path, args.scenario)
    try:
        name = args.command
        if name == "operations":
            extension = operations_extension()
            if extension is None:
                raise Problem("The selected source release does not include delivery operations.", 404, "OPERATIONS_UNAVAILABLE")
            return extension.operate(workspace, args)
        if name == "init":
            return {"workspace": str(path), "plans": workspace.list()}
        if name == "list":
            return workspace.list()
        if name == "show":
            plan = workspace.read(args.plan, args.revision)
            if args.part == "all":
                return plan
            if args.part == "delivery":
                return plan["report"]["deliveryPlan"]
            return plan[args.part]
        if name == "history":
            return workspace.history(args.plan)
        if name == "import-scenario":
            return workspace.create(args.name, prepared, read_json(args.planning) if args.planning else {},
                                    args.note, args.request_id, source_name=Path(args.file).name,
                                    source_sha=sha256(raw), source_url=args.source_url, source_bytes=raw)
        if name in ("estimate", "save"):
            patch = read_json(args.patch) if args.patch else {}
            planning = planning_input(workspace, args)
            if name == "estimate":
                return workspace.estimate(args.plan, args.expected_revision, patch, planning)
            return workspace.save(args.plan, args.expected_revision, patch, planning, args.note, args.request_id)
        if name == "restore":
            return workspace.restore(args.plan, args.expected_revision, args.revision, args.note, args.request_id)
        if name == "clone":
            return workspace.clone(args.plan, args.expected_revision, args.name, args.request_id)
        if name == "export":
            plan = selected_plan(workspace, args.plan, args.expected_revision)
            output = publish(args.output, workspace.export(args.plan))
            return {"plan": summary(plan), "output": output}
        if name == "import-bundle":
            plan = workspace.import_bundle(raw, args.name, args.request_id)
            return {"inputSha256": sha256(raw), "plan": plan}
        if name == "export-all":
            raw, manifest = collection_export(workspace)
            return {"plans": manifest["plans"], "output": publish(args.output, raw)}
        if name == "import-all":
            return collection_import(workspace, raw, args.request_id, prepared)
        raise Problem("Unknown command.", 422, "UNKNOWN_COMMAND")
    finally:
        workspace.close()


def main(argv=None):
    args = parser().parse_args(argv)
    try:
        result = operate(args)
        if result is None:
            return 0
        if getattr(args, "output", None) and args.command in ("show", "list", "history", "estimate"):
            result = {"output": publish(args.output, json_bytes(result))}
        sys.stdout.write(json_bytes(result).decode("utf-8"))
        return 0
    except Problem as exc:
        sys.stderr.write(json_bytes({"ok": False, "error": {"code": exc.code, "message": str(exc), "status": exc.status}}).decode())
        return 2
    except (OSError, UnicodeError, ValueError) as exc:
        sys.stderr.write(json_bytes({"ok": False, "error": {"code": "LOCAL_OPERATION_FAILED", "message": str(exc)}}).decode())
        return 2
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
