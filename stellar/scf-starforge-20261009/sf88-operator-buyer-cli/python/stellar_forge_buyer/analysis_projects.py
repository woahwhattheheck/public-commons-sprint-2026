"""Installed opening and complete following delivery of an original Analysis project.

The selected project keeps its own verified Python and Node source cohort.
Receiving, database ownership and export jobs remain with the original engines.
"""
from __future__ import annotations
import argparse
from contextlib import contextmanager
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import signal
import stat
import subprocess
import sys
import tempfile
import uuid
import zipfile

SCHEMA = "stellar-forge.analysis-project-command.v1"
PREFIX = Path("stellar/scf-starforge-20261009/sf88-operator-buyer-cli")
MAX_PROJECT = 1024 * 1024 * 1024
MAX_CONTROL = 16 * 1024 * 1024


def encoded(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode()


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def stamp(info):
    return info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns


def absolute(value):
    path = Path(value).expanduser().absolute()
    if path.resolve() != path:
        raise ValueError("Select a canonical path without symlink components: " + str(path))
    return path


def original(path, maximum=MAX_CONTROL):
    path = absolute(path)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, "rb") as stream:
        before = os.fstat(stream.fileno())
        if not stat.S_ISREG(before.st_mode) or before.st_size > maximum:
            raise ValueError("Select the complete regular file: " + str(path))
        raw = stream.read(maximum + 1)
        if len(raw) != before.st_size or stamp(before) != stamp(os.fstat(stream.fileno())):
            raise ValueError("The selected original file changed while reading.")
        return raw


def private(path):
    path = absolute(path)
    if not path.exists():
        private(path.parent)
        path.mkdir(mode=0o700)
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.geteuid() or info.st_mode & 0o077:
        raise ValueError("Select a private directory owned by this operator: " + str(path))
    return path


def sync(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def publish(path, raw):
    """Create one immutable command receipt; the original engines own their state."""
    if os.path.lexists(path):
        if original(path) != raw:
            raise ValueError("The original operation selection differs: " + str(path))
        return
    fd, name = tempfile.mkstemp(prefix="." + path.name + "-", dir=path.parent)
    temporary = Path(name)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        os.link(temporary, path)
        sync(path.parent)
    finally:
        temporary.unlink(missing_ok=True)


@contextmanager
def ownership(path):
    descriptor = os.open(path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        info = os.fstat(descriptor)
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_uid != os.geteuid() or info.st_mode & 0o077:
            raise ValueError("Keep the original private operation lock.")
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise ValueError("This same project operation is already running.") from None
        yield
    finally:
        os.close(descriptor)


def tools(checkout):
    directory = absolute(checkout) / PREFIX / "examples/analysis-project-opening"
    launcher = directory / "open_project.py"
    builder = directory / "build_project.py"
    viewer = directory / "portable.html"
    for path in (launcher, builder, viewer):
        original(path, 2 * 1024 * 1024)
    spec = importlib.util.spec_from_file_location("_analysis_project_original", launcher)
    helper = importlib.util.module_from_spec(spec)
    previous = sys.dont_write_bytecode
    try:
        sys.dont_write_bytecode = True
        spec.loader.exec_module(helper)
    finally:
        sys.dont_write_bytecode = previous
    return helper, launcher, builder, viewer


def inspect_selection(project, helper, *, expected_manifest=None, expected_archive=None):
    """Check all original bytes without extraction, database access or source execution."""
    project = absolute(project)
    if project.is_dir():
        if expected_archive is not None:
            raise ValueError("A ZIP digest applies only to the selected ZIP.")
        manifest = helper.inspect_project(project, expected_manifest_sha256=expected_manifest)
        raw = original(project / "project-manifest.json")
        result = {"kind": "directory", "manifest_sha256": sha(raw), "manifest": manifest}
    else:
        fd = os.open(project, os.O_RDONLY | os.O_NOFOLLOW)
        with os.fdopen(fd, "rb") as stream:
            before = os.fstat(stream.fileno())
            if not stat.S_ISREG(before.st_mode) or before.st_size > MAX_PROJECT:
                raise ValueError("Select the complete project ZIP within the 1 GiB limit.")
            archive_sha256 = hashlib.file_digest(stream, "sha256").hexdigest()
            if expected_archive is not None and archive_sha256 != expected_archive:
                raise ValueError("The selected project ZIP differs from its reviewed bytes.")
            stream.seek(0)
            with zipfile.ZipFile(stream) as archive:
                infos = archive.infolist()
                if len(infos) > 100001 or len({row.filename for row in infos}) != len(infos):
                    raise ValueError("The complete ZIP inventory repeats a member or exceeds its limit.")
                if sum(row.file_size for row in infos) > MAX_PROJECT:
                    raise ValueError("The complete expanded project exceeds the 1 GiB limit.")
                for row in infos:
                    helper.relative(row.filename)
                    mode = row.external_attr >> 16
                    if row.is_dir() or row.flag_bits & 1 or stat.S_IFMT(mode) not in (0, stat.S_IFREG):
                        raise ValueError("Keep the original regular, unencrypted project members.")
                info = archive.getinfo("project-manifest.json")
                if info.file_size > MAX_CONTROL:
                    raise ValueError("The selected manifest exceeds its original control limit.")
                raw = archive.read(info)
                manifest = helper.validate_manifest(raw)
                if expected_manifest is not None and sha(raw) != expected_manifest:
                    raise ValueError("The project differs from its reviewed manifest.")
                selected = {row["path"]: row for row in manifest["files"]}
                if set(selected) | {"project-manifest.json"} != {row.filename for row in infos}:
                    raise ValueError("The complete ZIP differs from its declared project inventory.")
                for row in manifest["files"]:
                    member = archive.getinfo(row["path"])
                    if member.file_size != row["bytes"]:
                        raise ValueError("The selected project member length changed.")
                    with archive.open(member) as source:
                        if hashlib.file_digest(source, "sha256").hexdigest() != row["sha256"]:
                            raise ValueError("The selected project member digest changed.")
            if stamp(before) != stamp(os.fstat(stream.fileno())):
                raise ValueError("The selected project ZIP changed during verification.")
        result = {"kind": "zip", "manifest_sha256": sha(raw),
                  "archive": {"bytes": before.st_size, "sha256": archive_sha256}, "manifest": manifest}
    # Following exports need the complete native source and original reader template.
    selected = {row["path"] for row in result["manifest"]["files"]}
    required = {"runtime/python/stellar_forge_buyer/analysis_workspace.py",
                "runtime/python/stellar_forge_buyer/response_sources.py",
                "runtime/native/stellar-forge/mcp-paid-agent/result-store.mjs"}
    if not required <= selected:
        raise ValueError("Retain this project's complete original runtime cohort.")
    return result


def summary(selection, project):
    manifest = selection["manifest"]
    return {"schema": SCHEMA, "state": "VERIFIED", "project": str(project),
            "kind": selection["kind"], "workspace_id": manifest["workspace_id"],
            "manifest_sha256": selection["manifest_sha256"], "native_archive": manifest["archive"],
            "members": len(manifest["files"]) + 1,
            "bytes": sum(row["bytes"] for row in manifest["files"]),
            **({"archive": selection["archive"]} if "archive" in selection else {})}


def materialize(project, cache, selection, helper):
    if selection["kind"] == "directory":
        return project
    cache = absolute(cache)
    private(cache.parent)
    with ownership(cache.parent / ("." + cache.name + ".lock")):
        if cache.exists():
            private(cache)
            helper.inspect_project(cache, expected_manifest_sha256=selection["manifest_sha256"])
            return cache
        stage = Path(tempfile.mkdtemp(prefix="." + cache.name + "-", dir=cache.parent))
        try:
            # Copy only the already selected complete inventory. Verify each copy
            # again so a changed ZIP cannot enter the private executable cohort.
            with zipfile.ZipFile(project) as archive:
                rows = selection["manifest"]["files"]
                for row in rows:
                    target = stage / row["path"]
                    target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                    with archive.open(row["path"]) as source, target.open("xb") as output:
                        os.chmod(target, 0o600)
                        shutil.copyfileobj(source, output, 1024 * 1024)
                        output.flush()
                        os.fsync(output.fileno())
                    helper.verified(target, row)
                raw = archive.read("project-manifest.json")
                if sha(raw) != selection["manifest_sha256"]:
                    raise ValueError("The selected project manifest changed before extraction.")
                publish(stage / "project-manifest.json", raw)
            helper.inspect_project(stage, expected_manifest_sha256=selection["manifest_sha256"])
            os.rename(stage, cache)
            sync(cache.parent)
        finally:
            if stage.exists():
                shutil.rmtree(stage)
        return cache


def separated(path, other):
    if path == other or path in other.parents or other in path.parents:
        raise ValueError("Keep the database, source project and delivery output in separate directories.")


def node_executable(value):
    found = shutil.which(value)
    if found is None:
        raise ValueError("Select the original installed Node executable.")
    return str(Path(found).resolve(strict=True))


def child(command, environment, directory, label):
    """Observe the original foreground child and keep each returned attempt."""
    attempt = private(directory / (label + "-" + uuid.uuid4().hex))
    publish(attempt / "command.json", encoded({"command": command}))
    interrupted = []
    handlers = {}
    process = None

    def stop(signum, frame):
        interrupted.append(signum)
        if process is not None and process.poll() is None:
            process.send_signal(signal.SIGINT)

    with (attempt / "stdout").open("xb") as stdout, (attempt / "stderr").open("xb") as stderr:
        os.chmod(attempt / "stdout", 0o600)
        os.chmod(attempt / "stderr", 0o600)
        try:
            for signum in (signal.SIGINT, signal.SIGTERM):
                handlers[signum] = signal.signal(signum, stop)
            try:
                os.fstat(3)
                inherited = (3,)
            except OSError:
                inherited = ()
            if interrupted:
                raise KeyboardInterrupt
            process = subprocess.Popen(command, env=environment, stdin=subprocess.DEVNULL,
                                       stdout=stdout, stderr=stderr, close_fds=True, pass_fds=inherited)
            if interrupted and process.poll() is None:
                process.send_signal(signal.SIGINT)
            publish(attempt / "process.json", encoded({"pid": process.pid}))
            code = process.wait()
            publish(attempt / "exit.json", encoded({"exit_observed": True, "exit_code": code,
                                                  "signals": interrupted}))
        finally:
            if process is not None and process.poll() is None:
                process.send_signal(signal.SIGINT)
                process.wait()
            for signum, handler in handlers.items():
                signal.signal(signum, handler)
    if interrupted:
        raise KeyboardInterrupt
    if code != 0:
        raise RuntimeError("The original " + label + " command exited " + str(code) +
                           "; its complete output is retained at " + str(attempt))
    return json.loads(original(attempt / "stdout"))


EXPORT = r'''
import json,sys,time
from stellar_forge_buyer.analysis_workspace import AnalysisWorkspace
from stellar_forge_buyer.response_sources import retain_response
directory,checkout,node,workspace_id,operation,previous=sys.argv[1:]
current=AnalysisWorkspace.read_state(directory)
if current["workspace_id"]!=workspace_id:
    raise ValueError("The selected database belongs to another original project.")
workspace=AnalysisWorkspace(directory,checkout=checkout,node=node)
try:
    if workspace.identity!=workspace_id:
        raise ValueError("The current original workspace identity changed.")
    with workspace.database._connection(readonly=True) as db:
        old=db.execute("SELECT id FROM sf_analysis_jobs WHERE id=?",(operation,)).fetchone()
        sources=[json.loads(row[0]) for row in db.execute("SELECT record FROM sf_analysis_response_sources ORDER BY name")]
    retained=[]
    if old is None:
        for source in sources:
            if source.get("input_kind") in {"stream","mcp"}:
                retained.append(retain_response(workspace.database.directory,source,checkout=checkout,node=node))
    job=workspace.start("workspace-export",{"id":operation,"include_previous_backups":previous=="true"})
    while job["status"]=="RUNNING":
        time.sleep(.1)
        job=workspace.job(operation)
    if job["status"]!="COMPLETE":
        raise RuntimeError("The original archive operation returned "+job["status"]+": "+str(job.get("error")))
    print(json.dumps({"job":job,"retained_sources":len(retained)}),flush=True)
finally:
    workspace.close()
'''


def python_command(root, entry, *args, code=False):
    # Keep the lexical installed interpreter and the selected source ahead of
    # cwd/user-site/PYTHONPATH, while preserving the installed dependency cohort.
    bootstrap = ("import runpy,sys; source,mode,entry=sys.argv[1:4]; "
                 "sys.path.insert(0,source); sys.argv=[entry,*sys.argv[4:]]; "
                 "exec(compile(entry,'<original-export>','exec'),{'__name__':'__main__'}) "
                 "if mode=='code' else runpy.run_path(entry,run_name='__main__')")
    return [sys.executable, "-I", "-B", "-c", bootstrap, str(root / "runtime/python"),
            "code" if code else "file", str(entry), *args]


def export_project(args, root, selection, helper, builder, viewer, node):
    output = absolute(args.output)
    database = absolute(args.database)
    separated(output, root)
    separated(output, database)
    separated(database, root)
    output = private(output)
    with ownership(output / ".project-command.lock"):
        intent = {"schema": SCHEMA, "operation_id": args.operation,
                  "workspace_id": selection["manifest"]["workspace_id"],
                  "database": str(database), "source_project": str(root),
                  "source_manifest_sha256": selection["manifest_sha256"],
                  "title": args.title, "include_previous_backups": args.include_previous_backups}
        publish(output / "project-operation.json", encoded(intent))
        final = output / "project-operation-result.json"
        if final.exists():
            result = json.loads(original(final))
            if result.get("operation") != intent:
                raise ValueError("The completed following delivery belongs to another operation.")
            for row in (result["delivery"]["archive"], result["delivery"]["project"],
                        {"path": str(output / "project-data.json"), **result["delivery"]["snapshot"]}):
                helper.verified(Path(row["path"]), row)
            return {**result, "reused": True}
        environment = {**os.environ, "PYTHONPATH": str(root / "runtime/python"),
                       "PYTHONDONTWRITEBYTECODE": "1"}
        attempts = private(output / "command-attempts")
        saved_job = output / "native-export.json"
        if saved_job.exists():
            acquired = json.loads(original(saved_job))
        else:
            acquired = child(python_command(root, EXPORT, str(database),
                              str(root / "runtime/native"), node, intent["workspace_id"],
                              args.operation, "true" if args.include_previous_backups else "false", code=True),
                             environment, attempts, "native-export")
            publish(saved_job, encoded(acquired))
        job = acquired["job"]
        if job["id"] != args.operation or job["kind"] != "workspace-export" or job["status"] != "COMPLETE":
            raise ValueError("Keep the completed original workspace export operation.")
        native = job["result"]
        if native["id"] != args.operation or native["workspace_id"] != intent["workspace_id"]:
            raise ValueError("The native archived project identity differs.")
        archive_row = next(row for row in native["files"] if row["name"] == "workspace.zip")
        archive = Path(native["directory"]) / archive_row["name"]
        helper.verified(archive, archive_row)
        original_viewer = root / "source/portable.html"
        viewer_row = next((row for row in selection["manifest"]["files"] if row["path"] == "source/portable.html"), None)
        if viewer_row is not None:
            helper.verified(original_viewer, viewer_row)
            viewer = original_viewer
        # Preserve the original executable source cohort and complete receiving
        # history. Only the native database snapshot and its reader are rebuilt.
        extras = []
        for row in selection["manifest"]["files"]:
            name = row["path"]
            if name.startswith(("archives/", "workspace/")) or name in {"project.html", "project-data.json"}:
                continue
            extras.append({"path": name, "source": str(root / name),
                           "bytes": row["bytes"], "sha256": row["sha256"]})
        receipt = encoded({**intent, "schema": SCHEMA + "/following-delivery",
                           "native_archive": {"id": args.operation,
                           "bytes": archive_row["bytes"], "sha256": archive_row["sha256"]}})
        receipt_path = output / "following-delivery.json"
        publish(receipt_path, receipt)
        extras.append({"path": "receiving/project-export-" + args.operation + ".json",
                       "source": str(receipt_path), "bytes": len(receipt), "sha256": sha(receipt)})
        # Reusing the original archive id with another source project is rejected
        # by the immutable selection above and the original builder's input file.
        extra_path = output / "project-extra-files.json"
        publish(extra_path, encoded(extras))
        delivery = child(python_command(root, builder, "--archive", str(archive),
                          "--archive-sha256", archive_row["sha256"], "--viewer-template", str(viewer),
                          "--output", str(output), "--extra-files", str(extra_path), "--title", args.title),
                         environment, attempts, "complete-project")
        result = {"schema": SCHEMA, "state": "COMPLETE", "operation": intent, "delivery": delivery}
        publish(final, encoded(result))
        return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--checkout", required=True, help="Selected installed source checkout.")
    parser.add_argument("--project", required=True, help="Complete original project ZIP or extracted directory.")
    parser.add_argument("--manifest-sha256", help="Exact reviewed project manifest.")
    parser.add_argument("--project-sha256", help="Exact selected ZIP digest.")
    parser.add_argument("--workspace-id", help="Original workspace identity from the reviewed project.")
    parser.add_argument("--project-cache", help="Private retained extraction directory for a ZIP.")
    parser.add_argument("--database", help="Original private received Analysis database.")
    parser.add_argument("--node", default=os.environ.get("CODEX_PRIMARY_RUNTIME_NODE") or "node")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("inspect", help="Verify the complete source selection without receiving or launching.")
    receive = commands.add_parser("receive", help="Receive or reopen the same project without a listener.")
    receive.add_argument("--operation", help="Original receiving UUID32.")
    launch = commands.add_parser("serve", help="Receive the project and own its original Analysis listener.")
    launch.add_argument("--operation", help="Original receiving UUID32.")
    launch.add_argument("--port", type=int, default=0)
    launch.add_argument("--open", action="store_true")
    export = commands.add_parser("export", help="Export a complete following project from the customer's current database.")
    export.add_argument("--operation", required=True, help="Retained original native archive UUID32; keep it on retry.")
    export.add_argument("--output", required=True, help="Private following-delivery directory outside the database.")
    export.add_argument("--title", default="Analysis project")
    export.add_argument("--include-previous-backups", action="store_true")
    args = parser.parse_args(argv)
    if sys.version_info < (3, 12):
        raise RuntimeError("Use Python 3.12 or later for this original project source.")
    for name in ("manifest_sha256", "project_sha256"):
        value = getattr(args, name)
        if value is not None and not re.fullmatch(r"[a-f0-9]{64}", value):
            raise ValueError("Use an exact SHA256 for the reviewed project.")
    if getattr(args, "operation", None) is not None and not re.fullmatch(r"[a-f0-9]{32}", args.operation):
        raise ValueError("Keep an original UUID32 receiving or archive operation.")
    if args.command == "export" and (not args.title.strip() or len(args.title) > 240):
        raise ValueError("Use a project title from 1 to 240 characters.")
    helper, launcher, builder, viewer = tools(args.checkout)
    project = absolute(args.project)
    selection = inspect_selection(project, helper, expected_manifest=args.manifest_sha256,
                                  expected_archive=args.project_sha256)
    if args.workspace_id is not None and args.workspace_id != selection["manifest"]["workspace_id"]:
        raise ValueError("The selected project workspace identity changed.")
    if args.command == "inspect":
        print(encoded(summary(selection, project)).decode(), end="")
        return 0
    if not args.database:
        raise ValueError("Select the original private Analysis database.")
    database = absolute(args.database)
    cache = absolute(args.project_cache) if args.project_cache else database.parent / ("analysis-project-" + selection["manifest_sha256"])
    if selection["kind"] == "zip":
        separated(cache, database)
        if project == cache or cache in project.parents:
            raise ValueError("Keep the source ZIP outside its extraction directory.")
    if selection["kind"] == "directory":
        separated(project, database)
    root = materialize(project, cache, selection, helper)
    if args.command == "export":
        print(encoded(export_project(args, root, selection, helper, builder, viewer,
                                     node_executable(args.node))).decode(), end="")
        return 0
    if args.command == "serve" and not 0 <= args.port <= 65535:
        raise ValueError("Use a local port from 0 to 65535.")
    command = [sys.executable, "-I", "-B", str(launcher), "--project", str(root),
               "--manifest-sha256", selection["manifest_sha256"], "--workspace", str(database)]
    if args.operation:
        command += ["--operation", args.operation]
    if args.command == "receive":
        command += ["--receive-only"]
    else:
        command += ["--node", node_executable(args.node), "--checkout", str(root / "runtime/native"),
                    "--port", str(args.port)]
        if not args.open:
            command += ["--no-open"]
    # Fresh interpreter imports the project's package, without the installed
    # command package already present in sys.modules. PID and managed lease stay.
    os.execve(sys.executable, command, {**os.environ, "PYTHONDONTWRITEBYTECODE": "1"})


if __name__ == "__main__":
    raise SystemExit(main())
