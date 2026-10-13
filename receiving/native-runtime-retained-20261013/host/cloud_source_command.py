"""Execute an exact source selection inside the original admitted native child.

Source preparation is durable. Materialization and the reviewed command share
one process tree; the original worker owns admission, exit and selected outputs.
"""
from __future__ import annotations

import argparse
import base64
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys
import tempfile
import zlib

import connected_github_source_reuse as reuse
import native_source_inputs as sources
import native_connected_source as connected
import native_archive_source as archives
import swarm_cloud_job as native

SCHEMA = "commons.native-source-command/v1"
PACKET_SCHEMA = "commons.source-packet/v1"
MAX_SOURCE_BYTES = 64 * 1024 * 1024
MAX_PACKET_BYTES = 96 * 1024 * 1024
MAX_FILES = 16384
SHA256 = re.compile(r"[0-9a-f]{64}")


def require(condition, message):
    if not condition:
        raise ValueError(message)


def encoded(value):
    return json.dumps(value, ensure_ascii=True, sort_keys=True, separators=(",", ":")).encode("ascii")


def decode_packet(value):
    """Use the same complete packet decoder for local and connected inputs."""
    return connected.decode_packet(value)

def read_input(path, *, connected_cache=None, connected_helper=None):
    if str(path) == "-":
        raw = sys.stdin.buffer.read(MAX_PACKET_BYTES + 1)
    else:
        selected = Path(path).expanduser()
        require(stat.S_ISREG(selected.lstat().st_mode), "Select an ordinary source manifest.")
        with selected.open("rb") as stream:
            raw = stream.read(MAX_PACKET_BYTES + 1)
    require(len(raw) <= MAX_PACKET_BYTES, "The source input exceeds 96 MiB.")
    value = decode_packet(json.loads(raw))
    if connected.is_connected(value):
        cache = connected_cache
        if cache is None and str(path) != "-":
            cache = selected.absolute().parent / "connected-source-inputs"
        return connected.read(value, cache_directory=cache, helper_path=connected_helper)
    return value


def freeze_sources(manifest, source_roots=(), git_roots=(), *, captures=(), staging_directory=None,
                   materialization=None):
    """Bind exact source bodies, immutable local files, or an immutable Git archive selection."""
    manifest = decode_packet(manifest)
    if archives.is_git_archive(manifest):
        require(not source_roots and not git_roots and not captures and not materialization,
                "The selected Git archive supplies its exact source; local source and materialization options belong to their original input.")
        return archives.freeze_git_archive(manifest)
    hydrated, _ = sources.merge_source_captures(manifest, captures)
    plan = sources.acquisition_plan(hydrated, source_roots, git_roots)
    require(plan["complete"], "Supply the missing exact source blobs from the original acquisition plan.")
    require(len(plan["request"]["files"]) <= MAX_FILES, "Select at most 16384 original source files.")
    expected_bytes = sum(row["bytes"] for row in plan["reuse"]["files"])
    require(expected_bytes <= MAX_SOURCE_BYTES, "The selected source exceeds 64 MiB.")
    options = reuse.importer.materialization_options(materialization)
    files = []

    def retain(staged):
        selected = reuse._import_manifest(hydrated, plan["reuse"], staged)
        for entry, row in zip(selected["files"], plan["reuse"]["files"]):
            if options and "source_file" in entry and row["status"] != "git_object":
                item = reuse.importer.inspect_source(entry)
                files.append({"path": item["path"], "blob_sha": item["blob_sha"],
                              "size": item["bytes"], "mode": item["mode"],
                              "source_file": item["source_file"]})
            else:
                item = reuse.importer._source(entry)
                files.append({"path": item["path"], "blob_sha": item["blob_sha"],
                              "size": len(item["data"]), "mode": item["mode"],
                              "response": {"sha": item["blob_sha"], "encoding": "base64",
                                           "content": base64.b64encode(item["data"]).decode("ascii")}})

    if any(row["status"] == "git_object" for row in plan["reuse"]["files"]):
        with tempfile.TemporaryDirectory(prefix="commons-source-freeze-", dir=staging_directory) as temporary:
            retain(reuse._extract_objects(plan["reuse"]["files"], Path(temporary)))
    else:
        retain({})
    # A bare blob request can omit byte counts. Freeze the observed counts as
    # well, retaining the earlier acquisition identity beside the full snapshot.
    files.sort(key=lambda row: row["path"])
    request = {**plan["request"], "files": [
        {key: row[key] for key in ("path", "blob_sha", "size", "mode") if row[key] is not None}
        for row in files]}
    frozen = {**request, "files": files}
    sources.verify_provided(frozen, complete=True)
    selection_id = sources.selection_identity(request)
    require(sources.selection_identity(frozen) == selection_id, "The selected source changed during preparation.")
    raw = encoded(frozen)
    require(len(raw) <= MAX_SOURCE_BYTES, "The portable source manifest exceeds 64 MiB.")
    packet = {"schema": PACKET_SCHEMA, "encoding": "gzip+base64", "bytes": len(raw),
              "sha256": hashlib.sha256(raw).hexdigest(),
              "data": base64.b64encode(gzip.compress(raw, compresslevel=6, mtime=0)).decode("ascii")}
    return {"request": request, "selection_id": selection_id,
            "acquisition_selection_id": plan["selection_id"],
            "files": len(files), "bytes": expected_bytes, "packet": packet,
            **({"storage": "immutable-local"} if any("source_file" in row for row in files) else {})}


def command_parts(command, cwd="."):
    require(isinstance(command, (list, tuple)) and 0 < len(command) <= 256 and command[0] and
            all(isinstance(part, str) and "\0" not in part for part in command) and
            sum(len(part) for part in command) <= 32768 and command[0] != "--",
            "Supply the exact executable and argument array, at most 256 parts and 32768 characters.")
    require(cwd == "." or isinstance(cwd, str) and reuse._path(cwd) == cwd,
            "Select a relative working directory inside the source project.")
    return list(command), cwd


def save_new(path, value):
    """Publish once; an interrupted write cannot leave a truncated source review."""
    raw = encoded(value) + b"\n"
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if path.exists():
        require(stat.S_ISREG(path.lstat().st_mode) and path.read_bytes() == raw,
                "This operation already retains a different source command. Reopen its original review.")
        return hashlib.sha256(raw).hexdigest()
    pending = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix=".source-pending-", delete=False) as stream:
            pending = Path(stream.name)
            os.chmod(pending, 0o600)
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        try:
            os.link(pending, path, follow_symlinks=False)
        except FileExistsError:
            require(stat.S_ISREG(path.lstat().st_mode) and path.read_bytes() == raw,
                    "This operation already retains a different source command.")
        descriptor = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    finally:
        if pending is not None:
            pending.unlink(missing_ok=True)
    return hashlib.sha256(raw).hexdigest()


def execution_command(path, sha256, operation, records_root):
    return [sys.executable, "-B", str(Path(__file__).resolve()), "execute", "--selection", str(path),
            "--selection-sha256", sha256, "--native-operation", operation,
            "--records-root", str(Path(records_root).resolve())]



def command_materialization(command, value=None):
    """Retain the selected Python script's directory and sibling imports."""
    options = reuse.importer.materialization_options(value)
    executable = Path(command[0]).name
    python = re.fullmatch(r"(?:python|pypy)(?:[0-9]+(?:\.[0-9]+)*)?(?:\.exe)?", executable, re.IGNORECASE)
    if options.get("link_fallback") == "symlink" and python:
        return {**options, "link_fallback": "copy", "link_anchors": []}, {
            "requested_materialization": options,
            "materialization_adjustment": "python_selected_imports_require_copy"}
    return options, {}


def prepare_selection(*, operation, records_root, project, command, manifest, selection,
                      cwd=".", source_roots=(), git_roots=(), captures=(), staging_directory=None,
                      materialization=None):
    project = Path(project).expanduser().resolve(strict=True)
    require(project.is_dir(), "Select an existing source project directory.")
    record = native.run_path(operation, records_root)
    require(not record.is_relative_to(project),
            "Keep the original native records outside the source project so execution cannot replace them.")
    command, cwd = command_parts(command, cwd)
    options, adjustment = command_materialization(command, materialization)
    frozen = freeze_sources(manifest, source_roots, git_roots, captures=captures,
                            staging_directory=staging_directory or project, materialization=options)
    selected = {"schema": SCHEMA, "operation_id": operation, "records_root": str(record.parent),
                "project": str(project), "cwd": cwd, "command": command, "source": frozen,
                **({"materialization": options} if options else {}), **adjustment}
    require(len(encoded(selected)) + 1 <= MAX_PACKET_BYTES,
            "The complete source command review exceeds its 96 MiB receiving limit.")
    selection = Path(selection).expanduser().absolute()
    require(not selection.is_relative_to(project), "Retain the source review outside its temporary project.")
    sha = save_new(selection, selected)
    return selected, {"path": str(selection), "sha256": sha,
                      "command": execution_command(selection, sha, operation, record.parent)}


def read_selection(path, expected):
    path = Path(path).expanduser().absolute()
    require(isinstance(expected, str) and SHA256.fullmatch(expected), "Retain the exact source-review SHA-256.")
    require(stat.S_ISREG(path.lstat().st_mode), "The source review must remain an ordinary file.")
    with path.open("rb") as stream:
        raw = stream.read(MAX_PACKET_BYTES + 1)
    require(len(raw) <= MAX_PACKET_BYTES and hashlib.sha256(raw).hexdigest() == expected,
            "The source command review differs from its original native argv.")
    value = json.loads(raw)
    require(value.get("schema") == SCHEMA, "Select an original native source-command review.")
    command_parts(value.get("command"), value.get("cwd"))
    source = value["source"]
    options = reuse.importer.materialization_options(value.get("materialization"))
    if source.get("storage") == "git-archive":
        require(not options, "The original Git archive selection uses ordinary materialized source files.")
        _, manifest = archives.frozen_git_archive(source)
    else:
        manifest = decode_packet(source["packet"])
        sources.verify_provided(manifest, complete=True)
        require(options or not any("source_file" in row for row in manifest["files"]),
                "Local source references require the original immutable materialization selection.")
    require(sources.selection_identity(source["request"]) == source["selection_id"] ==
            sources.selection_identity(manifest), "The source packet differs from its reviewed selection.")
    return value, manifest


def binding_from_request(report, request):
    command = request["intent"].get("command", [])
    require(len(command) == 12 and command[1] == "-B" and Path(command[2]).name == "cloud_source_command.py"
            and command[3] == "execute" and command[4] == "--selection"
            and command[6] == "--selection-sha256" and command[8] == "--native-operation"
            and command[10] == "--records-root", "This is not an original native source command.")
    require(command[9] == report["operation_id"] == request["intent"]["operation_id"],
            "The source command belongs to another native operation.")
    selected, _ = read_selection(command[5], command[7])
    require(selected["operation_id"] == command[9] and selected["records_root"] == command[11]
            and Path(command[11]) == Path(report["record"]).parent
            and selected["project"] == request["intent"]["project"],
            "The source review differs from its original native record.")
    return selected, {"path": command[5], "sha256": command[7]}


def restore_queued_project(root, request):
    """Restore only the directory of a validated, guarded pre-dispatch source queue.

    The original native resume path holds run_lock and has established that the
    prior supervisor ended before command allocation. Source bytes remain in the
    saved review and are materialized by the admitted original child.
    """
    root = Path(root)
    selected, binding = binding_from_request(
        {"operation_id": request["intent"]["operation_id"], "record": str(root)}, request)
    project = Path(selected["project"])
    require(project.is_absolute() and str(project) == selected["project"] and
            project.resolve() == project, "The original source project path now resolves elsewhere.")
    require(not root.resolve().is_relative_to(project) and
            not Path(binding["path"]).resolve().is_relative_to(project),
            "Keep the original source review and native record outside its temporary project.")
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC
    descriptor = os.open(project.anchor, flags)
    created = []
    current = Path(project.anchor)
    try:
        for part in project.parts[1:]:
            current = current / part
            try:
                child = os.open(part, flags, dir_fd=descriptor)
            except FileNotFoundError:
                try:
                    os.mkdir(part, 0o700, dir_fd=descriptor)
                    created.append(str(current))
                    os.fsync(descriptor)
                except FileExistsError:
                    pass
                child = os.open(part, flags, dir_fd=descriptor)
            os.close(descriptor)
            descriptor = child
    finally:
        os.close(descriptor)
    return {"schema": "commons.native-source-project-recovery/v1",
            "project": str(project), "created": str(project) in created,
            "created_directories": created, "selection_id": selected["source"]["selection_id"],
            "selection_sha256": binding["sha256"]}


def summary(selected, binding):
    return {"schema": SCHEMA, **binding, "operation_id": selected["operation_id"],
            "project": selected["project"], "destination": selected["project"],
            "command": selected["command"], "cwd": selected["cwd"],
            **{key: selected["source"][key] for key in ("selection_id", "files", "bytes")},
            **sources.metadata(selected["source"]["request"]),
            **({"materialization": selected["materialization"]} if selected.get("materialization") else {}),
            **{key: selected[key] for key in ("requested_materialization", "materialization_adjustment")
               if key in selected},
            "source_storage": selected["source"].get("storage", "embedded")}


def view(report, request):
    selected, binding = binding_from_request(report, request)
    result = native.read_json(Path(report["record"]) / "source-execution.json")
    return {**summary(selected, binding), "request": selected["source"]["request"],
            "execution": True, "result": result, "can_select": False}


def execute_selection(args):
    selected, manifest = read_selection(args.selection, args.selection_sha256)
    record = native.run_path(args.native_operation, args.records_root)
    request = native.read_json(record / "request.json")
    require(request is not None, "Start the source command through its original native worker.")
    binding_from_request({"operation_id": args.native_operation, "record": str(record)}, request)
    require(request["intent"]["command"] == execution_command(args.selection, args.selection_sha256,
                                                              args.native_operation, args.records_root),
            "The running source helper differs from its original native command.")
    require(native._same_process(native.process_identity(os.getpid()), native.read_json(record / "process.json")),
            "Materialize source in the original native command child after admission.")
    project = Path(selected["project"]).resolve(strict=True)
    require(str(project) == selected["project"], "The selected temporary project now resolves elsewhere.")
    binding = {"path": str(args.selection), "sha256": args.selection_sha256}
    try:
        options, adjustment = command_materialization(selected["command"], selected.get("materialization"))
        if selected["source"].get("storage") == "git-archive":
            archive, _ = archives.frozen_git_archive(selected["source"])
            result = archives.receive_git_archive(archive, project, staging_parent=project)
        else:
            result = reuse.importer.materialize(manifest, project, staging_directory=project, **options)
        command = list(selected["command"])
        flags = result.get("runtime_requirements", {}).get("node_flags", [])
        if flags and Path(command[0]).name in ("node", "node.exe"):
            command[1:1] = flags
        directory = project / selected["cwd"]
        require(directory.resolve(strict=True) == directory and directory.is_dir(),
                "The selected command directory must be an ordinary directory inside its project.")
        outcome = {**summary(selected, binding), "materialized_at": native.now(),
                   "state": "materialized", "import_result": result, "executed_command": command,
                   **({"materialization": options} if options else {}), **adjustment}
        native.save_json(record / "source-execution.json", outcome)
        print(json.dumps({"source_execution": {key: outcome[key] for key in
                          ("operation_id", "selection_id", "files", "bytes", "state")}}),
              file=sys.stderr, flush=True)
        os.chdir(directory)
        os.execvp(command[0], command)
    except (OSError, ValueError, KeyError) as exc:
        failure = {**summary(selected, binding), "state": "source_command_failed", "ended_at": native.now(),
                   "error": getattr(exc, "code", type(exc).__name__),
                   "detail": getattr(exc, "detail", str(exc))}
        if isinstance(exc, archives.GitArchiveHTTPError):
            failure.update({key: getattr(exc, key) for key in
                            ("status", "retry_after", "rate_limit_reset")})
        if isinstance(exc, reuse.importer.SourceImportIOError):
            failure.update(reuse.importer._io_error_result(exc, operation=exc.operation, path=exc.source_path,
                                                         completed_files=exc.completed_files))
        native.save_observation(record / "source-execution.json", failure)
        print(json.dumps(failure), file=sys.stderr, flush=True)
        return 127 if isinstance(exc, OSError) and not isinstance(exc, reuse.importer.SourceImportIOError) else 2


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    command = []
    if argv and argv[0] in ("run", "start", "prepare") and "--" in argv:
        at = argv.index("--")
        command, argv = argv[at + 1:], argv[:at]
    parser = argparse.ArgumentParser(description=__doc__)
    actions = parser.add_subparsers(dest="action", required=True)
    for action in ("run", "start", "prepare"):
        sub = actions.add_parser(action)
        native.launch_options(sub)
        if action == "run" and callable(getattr(native, "report_value", None)):
            sub.set_defaults(report_format="summary")
        sub.add_argument("--manifest", required=True, help="original local/connected source request, Git archive selection or compressed packet; - reads stdin")
        sub.add_argument("--connected-helper", help="current unchanged library_hosted_apps.py for connected source reads")
        sub.add_argument("--connected-cache", help="retained exact connected source editions and original provider reads")
        sub.add_argument("--source-root", action="append", default=[])
        sub.add_argument("--git-root", action="append", default=[])
        sub.add_argument("--capture", action="append", default=[])
        sub.add_argument("--cwd", default=".", help="reviewed working directory relative to the source project")
        sub.add_argument("--staging-directory", help="source-freeze scratch inside this same process namespace")
        reuse.importer.materialization_arguments(sub)
    execute = actions.add_parser("execute")
    execute.add_argument("--selection", required=True, type=Path)
    execute.add_argument("--selection-sha256", required=True)
    execute.add_argument("--native-operation", required=True)
    execute.add_argument("--records-root", required=True)
    args = parser.parse_args(argv)
    try:
        if args.action == "execute":
            return execute_selection(args)
        record = native.run_path(args.operation_id, getattr(args, "records_root", None))
        with native.run_lock(record):
            selected, binding = prepare_selection(operation=args.operation_id, records_root=record.parent,
                project=args.project, command=command, cwd=args.cwd,
                manifest=read_input(args.manifest, connected_cache=args.connected_cache,
                                    connected_helper=args.connected_helper),
                selection=record / "source-command.json", source_roots=args.source_root, git_roots=args.git_root,
                captures=[reuse.read_manifest(path) for path in args.capture],
                staging_directory=args.staging_directory,
                materialization=reuse.importer.materialization_from_args(args))
        args.command = binding["command"]
        if args.action == "prepare":
            print(json.dumps({"source": summary(selected, binding),
                              "native": {key: value for key, value in vars(args).items()
                                         if key not in ("manifest", "source_root", "git_root", "capture",
                                                        "cwd", "staging_directory", "action", "connected_helper", "connected_cache", "immutable_links",
                                                        "link_fallback", "link_anchor")}}))
            return 0
        return native.launch_selected(args)
    except (OSError, ValueError, KeyError, zlib.error) as exc:
        print(json.dumps({"ok": False, "schema": SCHEMA,
                          "error": getattr(exc, "code", type(exc).__name__),
                          "detail": getattr(exc, "detail", str(exc))}), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
