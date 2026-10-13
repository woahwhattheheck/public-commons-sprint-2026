#!/usr/bin/env python3
"""Prepare and receive one complete selected Hocuspocus application runtime."""
from __future__ import annotations
import argparse, contextlib, datetime, fcntl, hashlib, json, os, pathlib, platform
import shutil, signal, stat, subprocess, sys, tarfile, tempfile, time, uuid
from archive import atomic_json, checked_manifest, digest_file, inventory, link_target, ordinary_parents, receive_bundle, relative_name, write_bundle
import sources

SCHEMA = "hocuspocus.runtime.v1"
OPERATION = "TIPTAP-HOCUSPOCUS-APPLICATION-WORKSHARE-0C7A-20261012"

def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()

def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode()

def checksum(value):
    return hashlib.sha256(json_bytes(value)).hexdigest()

def read(path):
    path = pathlib.Path(path)
    if path.is_symlink() or not path.is_file():
        raise ValueError("Select an ordinary runtime record: " + str(path))
    return json.loads(path.read_bytes())

def progress(event, **values):
    print(json.dumps({"event": event, "at": now(), **values}, ensure_ascii=False), file=sys.stderr, flush=True)

def private_directory(path):
    path = pathlib.Path(path).absolute()
    current = pathlib.Path(path.anchor)
    for component in path.parts[1:]:
        current = current / component
        if current.is_symlink():
            raise ValueError("A selected runtime path has a linked parent: " + str(current))
        if current.exists() and not current.is_dir():
            raise ValueError("A selected runtime path has a non-directory parent")
        current.mkdir(exist_ok=True, mode=0o700)
    return path

@contextlib.contextmanager
def locked(directory):
    directory = private_directory(directory)
    descriptor = os.open(directory / ".runtime-lock", os.O_CREAT | os.O_RDWR | getattr(os, "O_NOFOLLOW", 0), 0o600)
    try:
        fcntl.flock(descriptor, fcntl.LOCK_EX)
        yield descriptor
    finally:
        # Closing only this descriptor lets an accepted native command keep its
        # inherited lock while an observer/controller is disconnected.
        os.close(descriptor)

def executable(value, default):
    selected = value or shutil.which(default)
    if not selected:
        raise ValueError("Select the installed " + default + " executable")
    selected = pathlib.Path(selected).resolve(strict=True)
    if not selected.is_file() or not os.access(selected, os.X_OK):
        raise ValueError("The selected executable cannot be started: " + str(selected))
    return str(selected)

def node_identity(node):
    result = subprocess.run([node, "-p", "JSON.stringify({executable:process.execPath,version:process.versions.node,abi:process.versions.modules,platform:process.platform,architecture:process.arch})"],
                            check=True, capture_output=True, text=True)
    value = json.loads(result.stdout)
    if int(value["version"].split(".")[0]) < 22:
        raise ValueError("The selected Hocuspocus release requires Node 22 or newer")
    return value

def process_identity(pid):
    try:
        body = pathlib.Path("/proc", str(pid), "stat").read_text()
        fields = body[body.rfind(")") + 2:].split()
        if fields[0] in ("Z", "X"):
            return None
        return {"pid": int(pid), "start": fields[19],
                "boot": pathlib.Path("/proc/sys/kernel/random/boot_id").read_text().strip()}
    except (OSError, ValueError, IndexError):
        return None

def same_process(value):
    return bool(value and process_identity(value.get("pid")) == value)

def source_selection(application, manifest_path):
    application = pathlib.Path(application).absolute()
    if application.is_symlink() or not application.is_dir():
        raise ValueError("Select the original ordinary application source directory")
    raw = pathlib.Path(manifest_path).read_bytes()
    manifest = json.loads(raw)
    listed = manifest.get("files")
    if not isinstance(listed, list) or not listed:
        raise ValueError("The application source manifest needs its complete files array")
    selected = []
    seen = set()
    for original in listed:
        name = str(relative_name(original["path"]))
        if name in seen:
            raise ValueError("The application source manifest repeats a path")
        seen.add(name)
        current = application
        parts = relative_name(name).parts
        for part in parts[:-1]:
            current = current / part
            if current.is_symlink() or not current.is_dir():
                raise ValueError("An original application member has a non-directory parent")
        path = current / parts[-1]
        mode = path.lstat().st_mode
        if stat.S_ISLNK(mode):
            target = os.readlink(path)
            link_target(name, target)
            body = target.encode()
            kind = "symlink"
            item_mode = "120000"
        elif stat.S_ISREG(mode):
            body = path.read_bytes()
            kind = "file"
            item_mode = "100755" if mode & 0o111 else "100644"
        else:
            raise ValueError("Select only original application files and internal links")
        actual = hashlib.sha256(body).hexdigest()
        git_blob = sources.git_hash(body)
        if "sha256" not in original and "git_blob_sha" not in original:
            raise ValueError("Every selected application member needs its original content identity")
        if original.get("sha256", actual) != actual or original.get("git_blob_sha", git_blob) != git_blob:
            raise ValueError("An original application source body differs: " + name)
        if original.get("bytes", len(body)) != len(body):
            raise ValueError("An original application source length differs: " + name)
        if original.get("mode", item_mode) not in (item_mode, int(item_mode, 8)):
            raise ValueError("An original application source mode differs: " + name)
        row = {"path": name, "kind": kind, "bytes": len(body), "sha256": actual,
               "git_blob_sha": git_blob, "mode": item_mode}
        if kind == "symlink":
            row["target"] = target
        selected.append(row)
    if "package.json" not in seen:
        raise ValueError("The complete application source must include package.json")
    selected.sort(key=lambda x: x["path"])
    return {"schema": "hocuspocus.application-source.v1",
            "source_id": checksum(selected), "manifest_sha256": hashlib.sha256(raw).hexdigest(),
            "provenance": {k: manifest[k] for k in ("repository", "commit", "operation", "schema") if k in manifest},
            "files": selected}

def copy_source(application, destination, selection):
    application = pathlib.Path(application)
    destination = private_directory(destination)
    for row in sorted(selection["files"], key=lambda x: (x["kind"] == "symlink", x["path"])):
        target = ordinary_parents(destination, row["path"])
        original = application.joinpath(*relative_name(row["path"]).parts)
        if row["kind"] == "symlink":
            if not original.is_symlink() or os.readlink(original) != row["target"]:
                raise ValueError("An original application link changed while receiving")
            if target.is_symlink() and os.readlink(target) == row["target"]:
                continue
            if target.exists() or target.is_symlink():
                raise ValueError("An existing original application member differs")
            os.symlink(row["target"], target)
            continue
        if original.is_symlink() or not original.is_file() or digest_file(original) != row["sha256"]:
            raise ValueError("An original application source changed while receiving")
        if target.exists() or target.is_symlink():
            if target.is_symlink() or not target.is_file() or digest_file(target) != row["sha256"]:
                raise ValueError("An existing original application source differs")
            continue
        fd, temporary = tempfile.mkstemp(prefix="." + target.name + "-", dir=target.parent)
        try:
            with os.fdopen(fd, "wb") as output, open(original, "rb") as source:
                shutil.copyfileobj(source, output, 1024 * 1024)
                output.flush()
                os.fsync(output.fileno())
            if digest_file(temporary) != row["sha256"]:
                raise ValueError("The copied original application source differs")
            os.chmod(temporary, 0o700 if row["mode"] == "100755" else 0o600)
            os.link(temporary, target)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
    return str(destination)

def runtime_path(directory, metadata, key):
    return pathlib.Path(directory).joinpath(*relative_name(metadata["paths"][key]).parts)

def require_runtime(directory):
    directory = pathlib.Path(directory).absolute()
    metadata = read(directory / "RUNTIME.json")
    if metadata.get("schema") != SCHEMA or metadata.get("status") != "READY":
        raise ValueError("The selected runtime has not finished its original preparation")
    if metadata["directory"] != str(directory):
        raise ValueError("Receive the complete runtime to bind its new selected directory")
    for key in ("application", "source"):
        target = runtime_path(directory, metadata, key)
        current = directory
        for part in target.relative_to(directory).parts:
            current = current / part
            if current.is_symlink():
                raise ValueError("The runtime application/source path has become a link")
        if not target.is_dir():
            raise ValueError("The original runtime application/source directory is missing")
    return metadata

def native_inspection(directory, metadata, node=None):
    node = executable(node or metadata["node"]["executable"], "node")
    application = runtime_path(directory, metadata, "application")
    result = subprocess.run([node, str(pathlib.Path(__file__).with_name("inspect.mjs")), "--application", str(application)],
                            check=True, capture_output=True, text=True)
    inspected = json.loads(result.stdout)
    if inspected["lockSha256"] != metadata["lock_sha256"]:
        raise ValueError("The installed runtime package lock changed")
    return inspected

def inspect_runtime(directory, full=False, node=None):
    directory = pathlib.Path(directory).absolute()
    metadata = require_runtime(directory)
    actual = native_inspection(directory, metadata, node)
    if full:
        original = read(runtime_path(directory, metadata, "inventory"))
        actual_files = inventory(runtime_path(directory, metadata, "application"))
        if actual_files != original["files"] or checksum(original) != metadata["application_inventory_sha256"]:
            raise ValueError("The complete installed application differs from its saved source/runtime")
        frozen = runtime_path(directory, metadata, "source")
        for row in metadata["source"]["files"]:
            path = frozen.joinpath(*relative_name(row["path"]).parts)
            if row["kind"] == "symlink":
                if not path.is_symlink() or os.readlink(path) != row["target"]:
                    raise ValueError("The retained original application link differs")
            elif path.is_symlink() or not path.is_file() or digest_file(path) != row["sha256"]:
                raise ValueError("The retained original application source differs")
    return {"schema": "hocuspocus.runtime-status.v1", "id": metadata["id"], "status": "READY",
            "directory": str(directory), "application": str(runtime_path(directory, metadata, "application")),
            "source_id": metadata["source"]["source_id"], "full": full, "native": actual}

def run_child(job_directory, lock_descriptor):
    job_directory = pathlib.Path(job_directory)
    command = read(job_directory / "COMMAND.json")
    accepted = {"schema": "hocuspocus.runtime-command.v1", "request_id": command["request_id"],
                "started_at": now(), "helper": process_identity(os.getpid())}
    atomic_json(job_directory / "RUNNING.json", accepted)
    child = stdout = stderr = None
    first = code = None
    try:
        env = os.environ.copy()
        env.update(command["environment"])
        stdout = open(job_directory / "stdout.log", "ab", buffering=0)
        stderr = open(job_directory / "stderr.log", "ab", buffering=0)
        child = subprocess.Popen(command["argv"], cwd=command["cwd"], env=env,
                                 stdout=stdout, stderr=stderr, pass_fds=(lock_descriptor,))
        accepted["native"] = process_identity(child.pid)
        atomic_json(job_directory / "RUNNING.json", accepted)
        code = child.wait()
    except BaseException as error:
        first = error
    finally:
        # A failed native-identity or RUNNING publication must not abandon the
        # actual acquired npm/build child. Its same inherited runtime lock and
        # original log descriptors remain owned until wait really completes.
        if child is not None:
            while code is None:
                try:
                    code = child.wait()
                except BaseException as error:
                    first = first or error
                    try:
                        time.sleep(0.05)
                    except BaseException as pause_error:
                        first = first or pause_error
        for stream in (stdout, stderr):
            if stream is not None:
                try:
                    stream.close()
                except BaseException as error:
                    first = first or error
    result = {**accepted, "finished_at": now(), "exit_code": code if first is None else None,
              "stdout": str(job_directory / "stdout.log"), "stderr": str(job_directory / "stderr.log")}
    if first is not None:
        result.update({"error": str(first), "native_exit_code": code})
    atomic_json(job_directory / "RESULT.json", result)
    return result

def run_command(directory, name, argv, cwd, environment, lock_descriptor, binding=None, renew=False):
    directory = pathlib.Path(directory)
    command = {"argv": [str(x) for x in argv], "cwd": str(cwd), "environment": environment, "binding": binding}
    command["request_id"] = checksum(command)
    jobs = private_directory(directory / "jobs" / str(relative_name(name)))
    attempts = sorted((x for x in jobs.iterdir() if x.is_dir() and not x.is_symlink() and x.name.isdigit()), key=lambda x: int(x.name))
    for attempt in reversed(attempts):
        saved = read(attempt / "COMMAND.json") if (attempt / "COMMAND.json").exists() else None
        if not saved or saved.get("request_id") != command["request_id"]:
            continue
        if (attempt / "RESULT.json").exists():
            result = read(attempt / "RESULT.json")
            if result.get("request_id") != command["request_id"]:
                raise ValueError("A native command result belongs to another request")
            if result.get("exit_code") == 0 and not renew:
                progress("native_command_received", name=name, attempt=str(attempt))
                return result
            break
        if (attempt / "RUNNING.json").exists():
            running = read(attempt / "RUNNING.json")
            if same_process(running.get("helper")) or same_process(running.get("native")):
                progress("native_command_active", name=name, original=running)
                raise RuntimeError("The original native command still owns this preparation")
        atomic_json(attempt / "INTERRUPTED.json", {"request_id": command["request_id"], "observed_at": now(),
                                                "reason": "The original native process ended without a final command result"})
        break
    number = max([int(x.name) for x in attempts] or [0]) + 1
    attempt = jobs / str(number)
    attempt.mkdir(mode=0o700)
    atomic_json(attempt / "COMMAND.json", command)
    progress("native_command_starting", name=name, attempt=str(attempt))
    process = subprocess.Popen([sys.executable, "-B", str(pathlib.Path(__file__).resolve()), "_child",
                                "--job", str(attempt), "--lock-descriptor", str(lock_descriptor)],
                               stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                               pass_fds=(lock_descriptor,), start_new_session=True)
    process.wait()
    if not (attempt / "RESULT.json").exists():
        raise RuntimeError("The original native command has no completed result; its attempt and logs are retained at " + str(attempt))
    result = read(attempt / "RESULT.json")
    if result.get("request_id") != command["request_id"] or result.get("exit_code") != 0:
        raise RuntimeError("The native " + name + " command did not complete; inspect " + str(attempt))
    progress("native_command_finished", name=name, attempt=str(attempt), exit_code=0)
    return result

def prepare(application, manifest, directory, node=None, npm=None, upstream_manifest=None, mounted=None, build=True, repair_dependencies=False):
    original = pathlib.Path(application).absolute()
    directory = pathlib.Path(directory).absolute()
    if directory == original or original in directory.parents:
        raise ValueError("Prepare the runtime outside the selected application source")
    selected = source_selection(original, manifest)
    node = executable(node, "node")
    npm = executable(npm, "npm")
    host = node_identity(node)
    upstream_manifest = pathlib.Path(upstream_manifest or pathlib.Path(__file__).with_name("upstreams.json")).resolve(strict=True)
    upstream_bytes = upstream_manifest.read_bytes()
    upstream = json.loads(upstream_bytes)
    if upstream.get("schema") != "hocuspocus.upstreams.v1" or upstream.get("operation") != OPERATION:
        raise ValueError("Select the original workshare's complete upstream source manifest")
    request = {"schema": "hocuspocus.runtime-preparation.v1", "operation": OPERATION,
               "directory": str(directory), "source_id": selected["source_id"],
               "source_manifest_sha256": selected["manifest_sha256"],
               "upstream_manifest_sha256": hashlib.sha256(upstream_bytes).hexdigest(),
               "node": host, "npm": npm, "build": bool(build)}
    with locked(directory) as lock_descriptor:
        saved_path = directory / "PREPARATION.json"
        if saved_path.exists():
            if read(saved_path)["request"] != request:
                raise ValueError("This runtime directory belongs to another source or installation selection")
        else:
            if set(x.name for x in directory.iterdir()) - {".runtime-lock"}:
                raise ValueError("Select a new runtime directory")
            atomic_json(saved_path, {"request": request, "id": str(uuid.uuid4()), "created_at": now()})
        if (directory / "RUNTIME.json").exists():
            if repair_dependencies:
                raise ValueError("Prepare the retained original source into a new runtime directory to replace a finished installation")
            return inspect_runtime(directory, full=True, node=node)
        frozen = directory / "source" / "application"
        copy_source(original, frozen, selected)
        atomic_json(directory / "source" / "APPLICATION_SOURCE.json", selected)
        upstream_file = directory / "source" / "UPSTREAMS.json"
        if upstream_file.exists() and upstream_file.read_bytes() != upstream_bytes:
            raise ValueError("The retained upstream manifest differs")
        if not upstream_file.exists():
            upstream_file.write_bytes(upstream_bytes)
            os.chmod(upstream_file, 0o600)
        upstream_result = sources.collect(upstream_file, directory / "source" / "upstream", mounted)
        working = directory / "application"
        copied = directory / "APPLICATION_COPIED.json"
        if not copied.exists():
            copy_source(frozen, working, selected)
            atomic_json(copied, {"source_id": selected["source_id"], "copied_at": now()})
        elif read(copied)["source_id"] != selected["source_id"]:
            raise ValueError("The working application belongs to another source edition")
        package = read(working / "package.json")
        dependencies = {**package.get("dependencies", {}), **package.get("devDependencies", {}), **package.get("optionalDependencies", {})}
        releases = {item["id"]: item["tag"].removeprefix("v") for item in upstream["repositories"]}
        expected = {"@hocuspocus/server": releases["hocuspocus"], "@hocuspocus/provider": releases["hocuspocus"],
                    "@hocuspocus/transformer": releases["hocuspocus"], "@tiptap/core": releases["tiptap"]}
        configuration = directory / "npm-userconfig"
        if not configuration.exists():
            configuration.write_text("audit=false\nfund=false\n", encoding="utf-8")
            os.chmod(configuration, 0o600)
        environment = {"PATH": str(pathlib.Path(node).parent) + os.pathsep + os.environ.get("PATH", ""),
                       "NPM_CONFIG_USERCONFIG": str(configuration), "NPM_CONFIG_CACHE": str(directory / "cache" / "npm"),
                       "NPM_CONFIG_AUDIT": "false", "NPM_CONFIG_FUND": "false",
                       "NODE_ENV": "development"}
        lock_path = working / "package-lock.json"
        resolution_path = directory / "RESOLUTION.json"
        if not resolution_path.exists():
            if not lock_path.exists():
                run_command(directory, "resolve", [npm, "install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"],
                            working, environment, lock_descriptor, selected["source_id"])
            lock = read(lock_path)
            if lock.get("lockfileVersion") not in (2, 3) or not isinstance(lock.get("packages"), dict):
                raise ValueError("Retain the actual complete npm package lock")
            retained_lock = directory / "source" / "RESOLVED_PACKAGE_LOCK.json"
            fd, temporary_lock = tempfile.mkstemp(prefix=".resolved-package-lock-", dir=retained_lock.parent)
            with os.fdopen(fd, "wb") as output, open(lock_path, "rb") as source:
                shutil.copyfileobj(source, output, 1024 * 1024)
                output.flush()
                os.fsync(output.fileno())
            os.chmod(temporary_lock, 0o600)
            os.replace(temporary_lock, retained_lock)
            atomic_json(resolution_path, {"lock_sha256": digest_file(lock_path),
                                        "received_at": now(), "source_id": selected["source_id"]})
        resolution = read(resolution_path)
        if digest_file(lock_path) != resolution["lock_sha256"] or digest_file(directory / "source" / "RESOLVED_PACKAGE_LOCK.json") != resolution["lock_sha256"]:
            raise ValueError("The actual selected package lock changed after resolution")
        run_command(directory, "install", [npm, "ci", "--include=dev", "--foreground-scripts", "--no-audit", "--no-fund"],
                    working, environment, lock_descriptor, resolution["lock_sha256"], renew=repair_dependencies)
        if build and package.get("scripts", {}).get("build"):
            run_command(directory, "build", [npm, "run", "build"], working, environment, lock_descriptor,
                        {"source": selected["source_id"], "lock": resolution["lock_sha256"]}, renew=repair_dependencies)
        if digest_file(lock_path) != resolution["lock_sha256"]:
            raise ValueError("The original application build changed its selected package lock")
        inspection = run_command(directory, "inspect", [node, str(pathlib.Path(__file__).with_name("inspect.mjs")), "--application", str(working)],
                                 working, environment, lock_descriptor, resolution["lock_sha256"], renew=True)
        inspected = read(inspection["stdout"])
        if inspected.get("schema") != "hocuspocus.runtime-inspection.v1" or inspected["lockSha256"] != resolution["lock_sha256"]:
            raise ValueError("The installed original packages do not match the selected lock")
        for item in inspected["packages"]:
            if item["name"] in expected and item["version"] != expected[item["name"]]:
                raise ValueError("The installed application package differs from the original retained release: " + item["name"])
        application_files = {"schema": "hocuspocus.installed-files.v1", "files": inventory(working)}
        atomic_json(directory / "APPLICATION_FILES.json", application_files)
        original_preparation = read(saved_path)
        metadata = {"schema": SCHEMA, "operation": OPERATION, "id": original_preparation["id"],
                    "status": "READY", "directory": str(directory),
                    "paths": {"application": "application", "source": "source/application", "inventory": "APPLICATION_FILES.json"},
                    "source": selected, "upstreams": upstream_result,
                    "upstream_manifest_sha256": request["upstream_manifest_sha256"],
                    "node": inspected["node"], "npm": npm,
                    "lock_sha256": resolution["lock_sha256"],
                    "application_inventory_sha256": checksum(application_files),
                    "packages": inspected["packages"], "capabilities": inspected["capabilities"],
                    "created_at": original_preparation["created_at"], "ready_at": now()}
        atomic_json(directory / "RUNTIME.json", metadata)
        return {"schema": "hocuspocus.runtime-status.v1", "status": "READY", "id": metadata["id"],
                "directory": str(directory), "application": str(working), "source_id": selected["source_id"],
                "native": inspected, "upstream_files": sum(x["files"] for x in upstream_result["repositories"])}

def export_runtime(directory, output, node=None):
    directory = pathlib.Path(directory).absolute()
    output = pathlib.Path(output).absolute()
    with locked(directory):
        metadata = require_runtime(directory)
        export_id = checksum({"runtime_id": metadata["id"], "source_id": metadata["source"]["source_id"], "output": str(output)})
        record_directory = private_directory(directory / "exports" / export_id)
        record = record_directory / "RESULT.json"
        if record.exists():
            result = read(record)
            if output.is_symlink() or not output.is_file() or output.stat().st_size != result["bytes"] or digest_file(output) != result["sha256"]:
                raise ValueError("The original completed runtime export differs")
            return result
        inspect_runtime(directory, full=True, node=node)
        original_request = {"export_id": export_id, "runtime_id": metadata["id"],
                            "source_id": metadata["source"]["source_id"], "output": str(output)}
        request_path = record_directory / "REQUEST.json"
        if request_path.exists() and read(request_path) != original_request:
            raise ValueError("The runtime export belongs to another selection")
        atomic_json(request_path, original_request)
        archive_metadata = {**original_request, "operation": OPERATION,
                            "application_inventory_sha256": metadata["application_inventory_sha256"]}
        if output.exists() or output.is_symlink():
            if output.is_symlink() or not output.is_file():
                raise ValueError("The runtime export path is occupied")
            with tarfile.open(output, "r:gz") as archive:
                contents, raw, _ = checked_manifest(archive)
            if contents["metadata"] != archive_metadata:
                raise ValueError("The existing runtime export belongs to another operation")
            result = {"schema": "hocuspocus.runtime.archive.v1", "path": str(output),
                      "bytes": output.stat().st_size, "sha256": digest_file(output),
                      "manifest_sha256": hashlib.sha256(raw).hexdigest(),
                      "files": sum(x["kind"] != "directory" for x in contents["files"]),
                      "uncompressed_bytes": sum(x.get("bytes", 0) for x in contents["files"])}
        else:
            result = write_bundle(directory, output, archive_metadata, exclude_root=(".runtime-lock",))
        result.update({"runtime_id": metadata["id"], "source_id": metadata["source"]["source_id"],
                       "export_id": export_id})
        atomic_json(record, result)
        return result

def archived_runtime(path):
    with tarfile.open(path, "r:gz") as archive:
        item = archive.getmember("RUNTIME.json")
        if not item.isfile() or item.size > 32 * 1024 * 1024:
            raise ValueError("The original runtime metadata is unavailable")
        metadata = json.loads(archive.extractfile(item).read())
    if metadata.get("schema") != SCHEMA or metadata.get("status") != "READY" or metadata.get("operation") != OPERATION:
        raise ValueError("Select the complete prepared runtime for this application")
    for value in metadata["paths"].values():
        relative_name(value)
    return metadata

def rebase_paths(value, original, receiving):
    if isinstance(value, dict):
        return {k: rebase_paths(v, original, receiving) for k, v in value.items()}
    if isinstance(value, list):
        return [rebase_paths(x, original, receiving) for x in value]
    if isinstance(value, str) and (value == original or value.startswith(original + "/")):
        return receiving + value[len(original):]
    return value

def receive_runtime(archive, directory, node=None):
    archive = pathlib.Path(archive).resolve(strict=True)
    directory = pathlib.Path(directory).absolute()
    if archive == directory or directory in archive.parents:
        raise ValueError("Keep the selected original archive outside its receiving directory")
    original = archived_runtime(archive)
    original_hash = digest_file(archive)
    node = executable(node, "node")
    host = node_identity(node)
    if (host["platform"], host["architecture"]) != (original["node"]["platform"], original["node"]["architecture"]):
        raise ValueError("Prepare the retained source and lock on this host architecture before selecting its runtime")
    request = {"schema": "hocuspocus.runtime-receiving.v1", "operation": OPERATION,
               "archive_sha256": original_hash, "archive_bytes": archive.stat().st_size,
               "original_runtime_id": original["id"], "source_id": original["source"]["source_id"],
               "directory": str(directory), "node": host}
    with locked(directory):
        request_path = directory / "RECEIVING.json"
        if request_path.exists():
            saved = read(request_path)
            if saved["request"] != request:
                raise ValueError("This receiving directory belongs to another original archive or host selection")
        else:
            if set(x.name for x in directory.iterdir()) - {".runtime-lock"}:
                raise ValueError("Select a new runtime receiving directory")
            saved = {"request": request, "id": str(uuid.uuid4()), "created_at": now()}
            atomic_json(request_path, saved)
        result_path = directory / "RECEIVE_RESULT.json"
        if result_path.exists():
            result = read(result_path)
            current = require_runtime(directory)
            if result["id"] != saved["id"] or current["id"] != saved["id"] or current["received_from"]["archive_sha256"] != original_hash:
                raise ValueError("The completed runtime receiving identity differs")
            inspect_runtime(directory, full=True, node=node)
            return result
        payload = directory / "payload"
        received = receive_bundle(archive, payload, temporary_directory=directory / "receiving-temporary")
        if received["archive"]["sha256"] != original_hash:
            raise ValueError("The original runtime archive changed while receiving")
        if inventory(payload) != received["manifest"]["files"]:
            raise ValueError("The received complete runtime contains missing or additional files")
        retained = read(payload / "RUNTIME.json")
        if retained != original:
            raise ValueError("The received runtime metadata differs from the selected original")
        manifest_metadata = received["manifest"]["metadata"]
        if (manifest_metadata.get("runtime_id"), manifest_metadata.get("source_id"),
            manifest_metadata.get("application_inventory_sha256")) != (
            original["id"], original["source"]["source_id"], original["application_inventory_sha256"]):
            raise ValueError("The complete archive and its original runtime identities differ")
        native_addons = [x["path"] for x in received["manifest"]["files"]
                         if x["kind"] == "file" and x["path"].startswith(original["paths"]["application"] + "/")
                         and x["path"].endswith(".node")]
        if native_addons and host["abi"] != original["node"]["abi"]:
            raise ValueError("Prepare the retained lock on this Node ABI before selecting its native dependency binaries")
        metadata = rebase_paths(original, original["directory"], str(payload))
        metadata.update({"id": saved["id"], "directory": str(directory), "node": host,
                         "paths": {key: "payload/" + value for key, value in original["paths"].items()},
                         "created_at": saved["created_at"], "ready_at": saved["created_at"],
                         "received_from": {"runtime_id": original["id"], "archive_sha256": original_hash,
                                           "source_id": original["source"]["source_id"],
                                           "manifest_sha256": received["manifest_sha256"],
                                           "received_at": saved["created_at"]}})
        actual = native_inspection(directory, metadata, node)
        metadata["packages"] = actual["packages"]
        metadata["capabilities"] = actual["capabilities"]
        atomic_json(directory / "RECEIVED_FILES.json", received["manifest"])
        atomic_json(directory / "RUNTIME.json", metadata)
        inspected = inspect_runtime(directory, full=True, node=node)
        result = {**inspected, "schema": "hocuspocus.runtime-receiving-result.v1",
                  "original_runtime_id": original["id"], "archive_sha256": original_hash,
                  "received_at": saved["created_at"]}
        atomic_json(result_path, result)
        return result

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    prepare_parser = commands.add_parser("prepare", help="Install the complete selected original application")
    prepare_parser.add_argument("--application", required=True)
    prepare_parser.add_argument("--manifest", required=True)
    prepare_parser.add_argument("--directory", required=True)
    prepare_parser.add_argument("--node")
    prepare_parser.add_argument("--npm")
    prepare_parser.add_argument("--upstream-manifest")
    prepare_parser.add_argument("--hocuspocus-archive")
    prepare_parser.add_argument("--tiptap-archive")
    prepare_parser.add_argument("--no-build", action="store_true")
    prepare_parser.add_argument("--repair-dependencies", action="store_true",
                                help="Repeat a failed preparation's dependency/build commands, retaining all original attempts")
    prepare_parser.add_argument("--export", dest="export_path")
    inspect_parser = commands.add_parser("inspect", help="Read original runtime and package identities")
    inspect_parser.add_argument("--directory", required=True)
    inspect_parser.add_argument("--node")
    inspect_parser.add_argument("--full", action="store_true")
    export_parser = commands.add_parser("export", help="Export the complete editable sources and installed runtime")
    export_parser.add_argument("--directory", required=True)
    export_parser.add_argument("--output", required=True)
    export_parser.add_argument("--node")
    receive_parser = commands.add_parser("receive", help="Independently receive the complete original runtime")
    receive_parser.add_argument("--archive", required=True)
    receive_parser.add_argument("--directory", required=True)
    receive_parser.add_argument("--node")
    child_parser = commands.add_parser("_child", help=argparse.SUPPRESS)
    child_parser.add_argument("--job", required=True)
    child_parser.add_argument("--lock-descriptor", type=int, required=True)
    args = parser.parse_args(argv)
    if args.command == "_child":
        value = run_child(args.job, args.lock_descriptor)
        return 0 if value.get("exit_code") == 0 else 1
    if args.command == "prepare":
        mounted = {key: value for key, value in (("hocuspocus", args.hocuspocus_archive), ("tiptap", args.tiptap_archive)) if value}
        result = prepare(args.application, args.manifest, args.directory, args.node, args.npm,
                         args.upstream_manifest, mounted, not args.no_build, args.repair_dependencies)
        if args.export_path:
            result["export"] = export_runtime(args.directory, args.export_path, args.node)
    elif args.command == "inspect":
        with locked(args.directory):
            result = inspect_runtime(args.directory, args.full, args.node)
    elif args.command == "export":
        result = export_runtime(args.directory, args.output, args.node)
    else:
        result = receive_runtime(args.archive, args.directory, args.node)
    print(json.dumps(result, ensure_ascii=False, indent=2), flush=True)
    return 0

if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:
        progress("runtime_error", error=str(error), error_type=type(error).__name__)
        sys.exit(1)
