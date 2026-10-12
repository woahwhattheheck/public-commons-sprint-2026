import os, sys, json, hashlib, shutil, subprocess, socket, fcntl, signal, tarfile, base64
from pathlib import Path, PurePosixPath
from datetime import datetime, timezone

# A held receiver supplies payload directly. A normal operator can select the complete packet file.
_merchant_standalone = "payload" not in globals()
if _merchant_standalone:
    import argparse
    parser = argparse.ArgumentParser(description="Continue the original native merchant/customer operation.")
    parser.add_argument("--source-packet", required=True)
    parser.add_argument("--work-dir")
    parser.add_argument("--directory")
    parser.add_argument("--restore-archive", help="Restore a delivered native archive at its original recorded paths")
    parser.add_argument("--restore-source-commit", help="Exact prior product source recorded by the restored archive")
    parser.add_argument("--node")
    parser.add_argument("--node-modules")
    parser.add_argument("--chromium")
    parser.add_argument("--playwright-module")
    dependency_source = parser.add_mutually_exclusive_group()
    dependency_source.add_argument("--dependency-transfers", help="Private JSON file containing the two retained original package download references")
    dependency_source.add_argument("--dependency-archives", help="Complete original public package capsule for native offline receiving")
    parser.add_argument("--checkpoint-dir", help="Shared or persistent directory for each complete original programme archive")
    parser.add_argument("--library-helpers", help="Directory with the complete current Library upload helper and both companions")
    args = parser.parse_args()
    payload = json.loads(Path(args.source_packet).read_bytes())
    names = {"work_dir": "workDir", "directory": "directory", "node": "node", "node_modules": "nodeModules",
             "chromium": "chromiumPath", "playwright_module": "playwrightModule", "restore_archive": "restoreArchive",
             "restore_source_commit": "restoreSourceCommit", "checkpoint_dir": "checkpointDirectory"}
    payload.setdefault("runtime", {}).update({names[key]: value for key, value in vars(args).items() if key in names and value})
    if args.dependency_transfers:
        payload.pop("dependencyArchives", None)
        payload["dependencyTransfers"] = json.loads(Path(args.dependency_transfers).read_bytes())
    if args.dependency_archives:
        payload.pop("dependencyTransfers", None)
        payload["dependencyArchives"] = json.loads(Path(args.dependency_archives).read_bytes())
    if args.library_helpers:
        helper_root = Path(args.library_helpers)
        payload["libraryHelpers"] = {name: (helper_root / name).read_text() for name in
            ("library_upload.py", "library_hosted_apps.py", "library_file_transfer.py")}
operation = "ASTRA-24EA-MERCHANT-WORKFLOW-20261012"
assert payload["operationId"] == operation
assert payload["sourceCommit"] == "6f9623f61d42aabe238d997061366b5dac24a24a"
assert len(payload["file_blobs"]) == 698
provided_files = payload.get("files", {})
assert not provided_files or set(provided_files) == set(payload["file_blobs"])
runtime = payload.get("runtime", {})
restore_source_commit = runtime.get("restoreSourceCommit", payload["sourceCommit"])
if len(restore_source_commit) != 40 or any(character not in "0123456789abcdef" for character in restore_source_commit):
    raise RuntimeError("Select the exact source commit recorded by the original archive.")
allowed_archive_sources = {payload["sourceCommit"], restore_source_commit}
root = Path(runtime.get("workDir", "/dev/commons-scf-series-814b")).resolve()
source = root / ("source-" + payload["sourceCommit"][:12])
native = Path(runtime.get("directory", str(root / "native"))).resolve()
if native == root or root.is_relative_to(native):
    raise RuntimeError("Keep the receiving directory separate from the source work directory.")
for path in (root, source, native):
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
operation_lease = (root / "native-operation.lock").open("a+b")
fcntl.flock(operation_lease.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
lease = (native / "native-receiving.lock").open("a+b")
fcntl.flock(lease.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)

def emit(value):
    print(json.dumps(value, separators=(",", ":")), flush=True)

def atomic(path, data):
    temporary = path.with_name(path.name + ".814b-pending")
    with temporary.open("wb") as output:
        os.chmod(temporary, 0o600); output.write(data); output.flush(); os.fsync(output.fileno())
    os.replace(temporary, path)

def original_record(path):
    if not path.exists():
        return None
    value = json.loads(path.read_text())
    if value.get("operationId") != operation:
        raise RuntimeError("Existing directory belongs to a different original operation: " + str(path))
    return value

identity = {"hostname": socket.gethostname(), "bootId": Path("/proc/sys/kernel/random/boot_id").read_text().strip(),
            "pidNamespace": os.readlink("/proc/self/ns/pid")}
prior = original_record(native / "native-active.json")
if prior and prior.get("phase") in ("STARTING", "RUNNING") and prior.get("host") != identity:
    raise RuntimeError("Recover the original active merchant host before moving its operation.")
if prior and prior.get("phase") in ("STARTING", "RUNNING") and prior.get("host") == identity and prior.get("pid"):
    stat = Path("/proc/" + str(prior["pid"]) + "/stat")
    if stat.exists():
        current_start = stat.read_text().rsplit(")", 1)[1].split()[19]
        if prior.get("processStart") == current_start:
            raise RuntimeError("Continue the already active original merchant child " + str(prior["pid"]))
for name in ("workflow-receiving-checkpoint.json", "workflow-native-run.json", "workflow-recipes-receiving-checkpoint.json",
             "workflow-recipes-native-run.json", "workflow-series-receiving-checkpoint.json", "workflow-series-native-run.json"):
    previous = original_record(native / name)
    if previous and previous.get("directory") != str(native):
        raise RuntimeError("Reopen the original recorded operation directory: " + previous.get("directory", ""))
for name, expected_blob in payload["file_blobs"].items():
    parts = PurePosixPath(name)
    if parts.is_absolute() or ".." in parts.parts or "\\" in name:
        raise RuntimeError("Invalid original source path")
    destination = source.joinpath(*parts.parts)
    data = provided_files[name].encode("utf-8") if provided_files else destination.read_bytes()
    blob = hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()
    if blob != expected_blob:
        raise RuntimeError("Original source blob differs: " + name)
    destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if destination.exists():
        if destination.read_bytes() != data:
            raise RuntimeError("Selected source directory contains another edition: " + name)
    else:
        atomic(destination, data)
# Full file bodies are no longer needed once every selected source is retained.
provided_files.clear()
payload.pop("files", None)
del data
emit({"event": "SCF_SERIES_SOURCE_ACCEPTED", "operationId": operation, "files": len(payload["file_blobs"]),
      "sourceCommit": payload["sourceCommit"], "source": str(source), "directory": str(native),
      "host": identity, "controllerPid": os.getpid(), "freeBytes": shutil.disk_usage(root).free})

def selected_file(candidates, executable=False):
    for candidate in candidates:
        if not candidate:
            continue
        path = Path(candidate).resolve()
        if path.is_file() and (not executable or os.access(path, os.X_OK)):
            return path
    raise RuntimeError("Installed original runtime file unavailable: " + json.dumps([x for x in candidates if x]))

node = selected_file([runtime.get("node"), os.environ.get("CODEX_PRIMARY_RUNTIME_NODE"),
    "/opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node"], True)
module_roots = [Path(value).resolve() for value in [runtime.get("nodeModules"),
    "/workspace/scratch/9345d3fc660b/native-runtime/node_modules", os.environ.get("CODEX_PRIMARY_RUNTIME_NODE_MODULES"),
    "/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules"] if value]
def original_package(name, version):
    for module_root in module_roots:
        candidate = module_root / name
        manifest_path = candidate / "package.json"
        if not manifest_path.is_file():
            continue
        manifest = json.loads(manifest_path.read_text())
        if manifest.get("name") == name and manifest.get("version") == version and not manifest.get("dependencies"):
            return candidate
    return None

# Receive complete original public packages from retained archive bytes or current download references.
transfers = payload.get("dependencyTransfers", [])
retained_dependencies = payload.get("dependencyArchives")
if transfers and retained_dependencies:
    raise RuntimeError("Select one complete original dependency carrier.")
if retained_dependencies:
    if (retained_dependencies.get("schema") != "commons.original-public-npm-archives.v1"
            or retained_dependencies.get("operationId") != operation):
        raise RuntimeError("Select the original merchant dependency source.")
    transfers = retained_dependencies["packages"]
if transfers:
    import urllib.request, io
    expected_packages = {"yaml": ("2.9.1", 112114), "re2js": ("2.8.6", 213596)}
    if len(transfers) != len(expected_packages) or {item["name"] for item in transfers} != set(expected_packages):
        raise RuntimeError("Select both complete original retained dependency packages.")
    extra_root = root / "native-extra-packages"
    extra_root.mkdir(parents=True, exist_ok=True, mode=0o700)
    for transfer in transfers:
        name = transfer["name"]
        version, expected_bytes = expected_packages[name]
        if retained_dependencies:
            if transfer["version"] != version:
                raise RuntimeError("Retain the selected original dependency version: " + name)
            metadata_bytes = transfer["metadataText"].encode("utf-8")
            archive_bytes = base64.b64decode(transfer["archiveBase64"], validate=True)
            for body, size_key, digest_key in ((metadata_bytes, "metadataBytes", "metadataSha256"),
                                                (archive_bytes, "archiveBytes", "archiveSha256")):
                if size_key in transfer and len(body) != transfer[size_key]:
                    raise RuntimeError("Receive the complete original dependency body: " + name)
                if digest_key in transfer and hashlib.sha256(body).hexdigest() != transfer[digest_key]:
                    raise RuntimeError("Receive the unchanged original dependency body: " + name)
        else:
            with urllib.request.urlopen(transfer["metadataUrl"], timeout=60) as response:
                metadata_bytes = response.read()
            with urllib.request.urlopen(transfer["archiveUrl"], timeout=60) as response:
                archive_bytes = response.read()
        metadata = json.loads(metadata_bytes)
        if metadata.get("name") != name or metadata.get("version") != version:
            raise RuntimeError("Receive the original complete npm metadata: " + name)
        integrity = "sha512-" + base64.b64encode(hashlib.sha512(archive_bytes).digest()).decode()
        if len(archive_bytes) != expected_bytes or integrity != metadata["dist"]["integrity"]:
            raise RuntimeError("The original npm archive differs: " + name)
        installed = original_package(name, version)
        if installed is not None:
            emit({"event": "ORIGINAL_NATIVE_DEPENDENCY_REUSED", "name": name, "version": version,
                  "path": str(installed.resolve()), "originalArchiveIntegrity": integrity})
            continue
        package_root = extra_root / name
        package_root.mkdir(parents=True, exist_ok=True, mode=0o700)
        with tarfile.open(fileobj=io.BytesIO(archive_bytes), mode="r:gz") as archive:
            for member in archive:
                parts = PurePosixPath(member.name)
                if parts.is_absolute() or ".." in parts.parts or not parts.parts or parts.parts[0] != "package":
                    raise RuntimeError("Invalid original npm member: " + member.name)
                destination = package_root.joinpath(*parts.parts[1:])
                if member.isdir():
                    destination.mkdir(parents=True, exist_ok=True, mode=0o700)
                elif member.isfile():
                    contents = archive.extractfile(member).read()
                    destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                    if destination.exists():
                        if destination.read_bytes() != contents:
                            raise RuntimeError("Retain the selected original npm package: " + name)
                    else:
                        atomic(destination, contents)
                else:
                    raise RuntimeError("Unsupported original npm package entry: " + member.name)
        manifest = json.loads((package_root / "package.json").read_text())
        if manifest.get("name") != name or manifest.get("version") != version or manifest.get("dependencies"):
            raise RuntimeError("Select the complete original dependency-free package: " + name)
        atomic(extra_root / (name + "-" + version + ".tar.gz"), archive_bytes)
        atomic(extra_root / (name + "-" + version + "-npm.json"), metadata_bytes)
        emit({"event": "ORIGINAL_NATIVE_DEPENDENCY_RECEIVED", "name": name, "version": version,
              "bytes": len(archive_bytes), "integrity": integrity, "license": manifest.get("license")})
    module_roots.append(extra_root)
    payload.pop("dependencyArchives", None)
    transfers.clear()
    if retained_dependencies:
        retained_dependencies.clear()
    del archive_bytes, metadata_bytes, transfer
base = next((path for path in module_roots if (path / "@x402/core/package.json").is_file()), None)
if base is None:
    raise RuntimeError("Select the existing full @x402 2.28.0 dependency directory in payload.runtime.nodeModules.")
dependencies = root / "native-dependency-view" / "node_modules"
dependencies.mkdir(parents=True, exist_ok=True, mode=0o700)
# Keep each installed package at its real location. Node resolves that package's
# own imports through its original dependency tree, while this view stays small.
def link_package(origin, destination):
    target = origin.resolve(strict=True)
    if destination.is_symlink() or destination.exists():
        if not destination.is_symlink() or destination.resolve() != target:
            raise RuntimeError("Keep the selected original package location: " + str(destination))
    else:
        destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        destination.symlink_to(target, target_is_directory=target.is_dir())
for origin in base.iterdir():
    if origin.name.startswith("@") and origin.is_dir():
        for package in origin.iterdir():
            link_package(package, dependencies / origin.name / package.name)
    elif not origin.name.startswith(".") and origin.name not in ("yaml", "re2js"):
        link_package(origin, dependencies / origin.name)
for name, version in {"yaml": "2.9.1", "re2js": "2.8.6"}.items():
    origin = original_package(name, version)
    if origin is None:
        raise RuntimeError("Receive the complete original " + name + " " + version + " package into the selected dependency directory.")
    link_package(origin, dependencies / name)
expected = {"@x402/core": "2.28.0", "@x402/stellar": "2.28.0", "@x402/extensions": "2.28.0",
            "@stellar/stellar-sdk": "16.3.1", "yaml": "2.9.1", "re2js": "2.8.6"}
versions = {}
for name in expected:
    versions[name] = json.loads((dependencies / name / "package.json").read_text())["version"]
    if name in expected and versions[name] != expected[name]:
        raise RuntimeError("Select the original installed " + name + " " + expected[name])
modules = source / "node_modules"
if modules.exists() or modules.is_symlink():
    if modules.resolve() != dependencies.resolve():
        raise RuntimeError("Keep the selected original application dependency view.")
else:
    modules.symlink_to(dependencies, target_is_directory=True)
playwright = selected_file([runtime.get("playwrightModule"),
    "/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.js"])
chromium = selected_file([runtime.get("chromiumPath"),
    "/workspace/scratch/bc0850d7ba23/browser-runtime/chrome-headless-shell"], True)
env = dict(os.environ)
env.update({"PATH": str(node.parent) + os.pathsep + env.get("PATH", ""), "TMPDIR": str(root), "PYTHONDONTWRITEBYTECODE": "1"})
selection = {"operationId": operation, "sourceCommit": payload["sourceCommit"], "nativeEntry": payload["nativeEntry"],
    "files": payload["file_blobs"], "directory": str(native), "source": str(source),
    "runtime": {"node": str(node), "chromium": str(chromium), "playwrightModule": str(playwright),
                "nodeModules": str(dependencies), "packages": versions}}
atomic(root / "series-source-selection.json", (json.dumps(selection, indent=2) + "\n").encode())
entry = source / payload["nativeEntry"]
argv = [str(node), str(entry), "--directory", str(native), "--chromium", str(chromium),
        "--playwright-module", str(playwright), "--source-commit", payload["sourceCommit"]]
def sha_file(path):
    result = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(65536), b""):
            result.update(chunk)
    return result.hexdigest()

def run_native(stage, log_name, native_entry=None):
    selected_entry = native_entry or payload["nativeEntry"]
    if selected_entry not in payload["file_blobs"]:
        raise RuntimeError("Run a complete selected original native programme.")
    selected_argv = [str(node), str(source / selected_entry), *argv[2:]]
    started = datetime.now(timezone.utc).isoformat()
    with (native / log_name).open("ab", buffering=0) as output:
        child = subprocess.Popen(selected_argv, cwd=source, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            start_new_session=True, pass_fds=(lease.fileno(), operation_lease.fileno()))
        try:
            process_start = Path("/proc/" + str(child.pid) + "/stat").read_text().rsplit(")", 1)[1].split()[19]
        except FileNotFoundError:
            process_start = None  # An immediate native exit is still collected from this child below.
        active = {"operationId": operation, "phase": "RUNNING", "stage": stage, "pid": child.pid,
            "processStart": process_start, "controllerPid": os.getpid(), "host": identity,
            "directory": str(native), "sourceCommit": payload["sourceCommit"], "nativeEntry": selected_entry, "startedAt": started}
        atomic(native / "native-active.json", (json.dumps(active) + "\n").encode())
        emit({"event": "ORIGINAL_NATIVE_DISPATCH", **active})
        try:
            for line in child.stdout:
                output.write(line)
                sys.stdout.write(line.decode("utf-8", "replace")); sys.stdout.flush()
            code = child.wait()
        except BaseException:
            try:
                os.killpg(child.pid, signal.SIGTERM)
                child.wait(timeout=15)
            except ProcessLookupError:
                pass
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, signal.SIGKILL); child.wait()
            raise
    active.update({"phase": "COMPLETE" if code == 0 else "FAILED", "exitCode": code,
                   "finishedAt": datetime.now(timezone.utc).isoformat()})
    atomic(native / "native-active.json", (json.dumps(active) + "\n").encode())
    emit({"event": "ORIGINAL_NATIVE_RETURNED", **active})
    return code

def source_path(name):
    parts = PurePosixPath(name)
    if parts.is_absolute() or ".." in parts.parts or "\\" in name:
        raise RuntimeError("Retain a file inside the original receiving directory: " + name)
    path = native.joinpath(*parts.parts)
    if not path.resolve().is_relative_to(native):
        raise RuntimeError("Keep the original receiving file within its directory: " + name)
    return path

def build_archive(require_completed=False):
    names, directories = set(), set()
    required_path = native / "native-required-artifacts.json"
    if require_completed and not required_path.is_file():
        raise RuntimeError("Retain the complete native artifact selection before delivering a completed case.")
    if required_path.exists():
        required = original_record(required_path)
        if required.get("schema") != "stellar-forge.native-delivery-artifacts.v1" or required.get("directory") != str(native):
            raise RuntimeError("Use the original complete native artifact selection.")
        if require_completed:
            for item in required["files"]:
                path = source_path(item["name"])
                if path.stat().st_size != item["bytes"] or sha_file(path) != item["sha256"]:
                    raise RuntimeError("A required native artifact changed: " + item["name"])
                names.add(item["name"])
        names.add(required_path.name)
    # A restored selection describes the previous checkpoint. Capture the current original
    # reports and their customer artifacts after each child, including an interrupted child.
    for name in ("workflow-receiving-checkpoint.json", "workflow-native-run.json",
                 "workflow-recipes-receiving-checkpoint.json", "workflow-recipes-native-run.json",
                 "workflow-series-receiving-checkpoint.json", "workflow-series-native-run.json"):
        record = original_record(native / name)
        if record:
            names.add(name)
            if record.get("artifactContract") == "stellar-forge.native-receiving-artifacts.v2":
                names.update(item["name"] for item in record.get("artifacts", []))
    # These are complete owned application stores. Browser profiles and inspection files are transient.
    for role in ("source-console", "receiver-console", "merchant", "merchant-inputs", "series-source-editions"):
        directory = native / role
        if directory.is_dir():
            directories.add(directory.relative_to(native).as_posix())
            for path in directory.rglob("*"):
                if path.is_symlink():
                    raise RuntimeError("Retain the complete owned native file, not a symlink: " + str(path))
                if path.is_file():
                    names.add(path.relative_to(native).as_posix())
                elif path.is_dir():
                    directories.add(path.relative_to(native).as_posix())
    execution = native / "native-execution"
    execution.mkdir(parents=True, exist_ok=True, mode=0o700)
    for path in execution.rglob("*"):
        if path.is_symlink():
            raise RuntimeError("Retain the original ordinary native execution output.")
        if path.is_file():
            names.add(path.relative_to(native).as_posix())
    for original, retained in (("native-active.json", "completed-native-process.json"),
                               ("workflow-series-native-output.log", "original-native-output.log"),
                               ("workflow-series-archive-reopen-output.log", "archive-continuation-output.log")):
        path = native / original
        if path.is_file():
            destination = execution / retained
            with path.open("rb") as incoming, destination.open("wb") as outgoing:
                os.chmod(destination, 0o600); shutil.copyfileobj(incoming, outgoing, 65536)
            names.add(destination.relative_to(native).as_posix())
    external_inputs = []
    configuration = native / "merchant" / "merchant-mcp.json"
    if configuration.is_file():
        raw = json.loads(configuration.read_text())
        for alias, entry in raw.get("sources", {}).items():
            for field in ("spec", "selections", "bindings"):
                if field not in entry:
                    continue
                path = (configuration.parent / entry[field]).resolve()
                if path.is_relative_to(native):
                    names.add(path.relative_to(native).as_posix())
                    continue
                # Earlier completed operations selected these original inputs beside their source checkout.
                # Retain the exact existing bytes and their existing location without rewriting the old configuration.
                if not path.is_relative_to(root):
                    raise RuntimeError("Select the original work directory containing its configured native source input: " + str(path))
                digest = sha_file(path)
                target = native / "native-source-inputs" / (digest + "-" + path.name)
                target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                if not target.exists():
                    with path.open("rb") as incoming, target.open("wb") as outgoing:
                        os.chmod(target, 0o600); shutil.copyfileobj(incoming, outgoing, 65536)
                if target.stat().st_size != path.stat().st_size or sha_file(target) != digest:
                    raise RuntimeError("Keep the original configured input bytes: " + str(path))
                name = target.relative_to(native).as_posix()
                names.add(name)
                external_inputs.append({"sourceAlias": alias, "field": field, "originalPath": str(path),
                    "archivedName": name, "bytes": path.stat().st_size, "sha256": digest})
    files = []
    for name in sorted(names):
        path = source_path(name)
        if not path.is_file() or path.is_symlink():
            raise RuntimeError("Retain the complete original native output file: " + name)
        files.append({"name": name, "bytes": path.stat().st_size, "sha256": sha_file(path)})
    manifest = {"schema": "stellar-forge.native-workspace-archive.v1", "operationId": operation,
        "directory": str(native), "workDirectory": str(root), "sourceCommit": payload["sourceCommit"],
        "files": files, "directories": sorted(directories), "sourceInputs": external_inputs}
    atomic(native / "native-delivery-manifest.json", (json.dumps(manifest, indent=2) + "\n").encode())
    bundle = root / "merchant-original-native-artifacts.tar.gz"
    pending_bundle = bundle.with_name(bundle.name + ".814b-pending")
    with tarfile.open(pending_bundle, "w:gz") as archive:
        for item in files:
            archive.add(source_path(item["name"]), arcname=item["name"], recursive=False)
        archive.add(native / "native-delivery-manifest.json", arcname="native-delivery-manifest.json", recursive=False)
    os.replace(pending_bundle, bundle)
    return bundle, manifest

def restore_archive(bundle):
    with tarfile.open(bundle, "r:gz") as archive:
        manifest = json.load(archive.extractfile("native-delivery-manifest.json"))
        if manifest.get("schema") != "stellar-forge.native-workspace-archive.v1" or manifest.get("operationId") != operation:
            raise RuntimeError("Restore the original complete native workspace archive.")
        if manifest.get("directory") != str(native) or manifest.get("workDirectory") != str(root):
            raise RuntimeError("Restore at the original recorded receiving and work directories.")
        if manifest.get("sourceCommit") not in allowed_archive_sources:
            raise RuntimeError("Select the exact original archive source with --restore-source-commit.")
        expected = {item["name"]: item for item in manifest["files"]}
        if len(expected) != len(manifest["files"]):
            raise RuntimeError("Use one complete original archive entry per file.")
        members = archive.getmembers()
        if len({item.name for item in members}) != len(members):
            raise RuntimeError("Use unique original archive member names.")
        if {item.name for item in members} != set(expected) | {"native-delivery-manifest.json"}:
            raise RuntimeError("The complete native archive member selection changed.")
        for member in members:
            if not member.isfile():
                raise RuntimeError("Restore only the original ordinary native files.")
            path = source_path(member.name)
            item = expected.get(member.name)
            if item and member.size != item["bytes"]:
                raise RuntimeError("The complete native archive file size changed: " + member.name)
            if path.exists():
                if member.name == "native-delivery-manifest.json":
                    if json.loads(path.read_text()) != manifest:
                        raise RuntimeError("Keep the original native delivery manifest.")
                elif path.stat().st_size != item["bytes"] or sha_file(path) != item["sha256"]:
                    raise RuntimeError("Preserve different existing native data: " + member.name)
                continue
            path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            temporary = path.with_name(path.name + ".814b-restore-pending")
            with archive.extractfile(member) as incoming, temporary.open("wb") as outgoing:
                os.chmod(temporary, 0o600); shutil.copyfileobj(incoming, outgoing, 65536)
                outgoing.flush(); os.fsync(outgoing.fileno())
            if item and sha_file(temporary) != item["sha256"]:
                raise RuntimeError("The original native archive file digest changed: " + member.name)
            os.replace(temporary, path)
    for item in manifest["sourceInputs"]:
        destination = Path(item["originalPath"]).resolve()
        original = source_path(item["archivedName"])
        if not destination.is_relative_to(root):
            raise RuntimeError("Restore configured source inputs inside the original owned work directory.")
        if destination.exists():
            if destination.stat().st_size != item["bytes"] or sha_file(destination) != item["sha256"]:
                raise RuntimeError("Preserve a different existing configured source: " + str(destination))
        else:
            destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            with original.open("rb") as incoming, destination.open("xb") as outgoing:
                os.chmod(destination, 0o600); shutil.copyfileobj(incoming, outgoing, 65536)
    # Preserve empty application directories, including first-time customer receiving storage.
    directories = manifest.get("directories", [])
    if not isinstance(directories, list) or len(set(directories)) != len(directories):
        raise RuntimeError("Restore each original application directory once.")
    for name in directories:
        path = source_path(name)
        if path.is_symlink() or path.exists() and not path.is_dir():
            raise RuntimeError("Preserve a different existing application path: " + name)
        path.mkdir(parents=True, exist_ok=True, mode=0o700)
    if "directories" not in manifest:
        # Earlier source archives retained ordinary files only. This configured empty directory
        # was required by readMerchantConfig when the original workspace was created.
        configuration = native / "merchant" / "merchant-mcp.json"
        if configuration.is_file():
            raw = json.loads(configuration.read_text())
            if "exportsDirectory" in raw:
                exports = (configuration.parent / raw["exportsDirectory"]).resolve()
                if not exports.is_relative_to(native) or exports == native:
                    raise RuntimeError("Restore customer exports inside the original merchant workspace.")
                exports.mkdir(parents=True, exist_ok=True, mode=0o700)
    return manifest

reopen_path = root / "native-archive-reopen.json"
archive_state = original_record(reopen_path)
bundle = root / "merchant-original-native-artifacts.tar.gz"
manifest = None
code = 0

def retain_archive(selected_bundle):
    digest = sha_file(selected_bundle)
    history = root / "retained-native-archives"
    history.mkdir(parents=True, exist_ok=True, mode=0o700)
    retained = history / (digest + ".tar.gz")
    if retained.exists():
        if retained.is_symlink() or retained.stat().st_size != selected_bundle.stat().st_size or sha_file(retained) != digest:
            raise RuntimeError("Preserve the original complete retained archive.")
    else:
        # All receiving archives are on this owned filesystem. The hard link preserves bytes
        # without copying another archive into constrained native memory.
        os.link(selected_bundle, retained)
    return retained

def prepare_archive_state(selected_bundle, imported=False, origin_sha256=None):
    selected_bundle = retain_archive(selected_bundle)
    digest = sha_file(selected_bundle)
    with tarfile.open(selected_bundle, "r:gz") as archive:
        selected_manifest = json.load(archive.extractfile("native-delivery-manifest.json"))
        try:
            completed = json.load(archive.extractfile("workflow-series-native-run.json"))
        except KeyError:
            completed = None
    backup = native.with_name(native.name + "-before-archive-reopen-" + digest[:12])
    if backup.exists() or backup.is_symlink():
        raise RuntimeError("Preserve the different existing workspace backup: " + str(backup))
    original_directory = native.stat()
    state = {"operationId": operation, "phase": "PREPARED", "directory": str(native),
        "sourceCommit": payload["sourceCommit"], "archiveSourceCommit": selected_manifest["sourceCommit"],
        "bundle": str(selected_bundle), "bytes": selected_bundle.stat().st_size, "sha256": digest,
        "backup": str(backup), "backupDevice": original_directory.st_dev, "backupInode": original_directory.st_ino,
        "importedArchive": imported, "completeAtSelection": bool(completed and completed.get("result") == "PASS"),
        "originArchiveSha256": origin_sha256 or digest}
    atomic(reopen_path, (json.dumps(state, indent=2) + "\n").encode())
    return state


def checkpoint_archive(selected_bundle, stage, native_exit):
    selected_bundle = retain_archive(selected_bundle)
    result = {"operationId": operation, "stage": stage, "nativeExitCode": native_exit,
        "directory": str(native), "workDirectory": str(root), "sourceCommit": payload["sourceCommit"],
        "bytes": selected_bundle.stat().st_size, "sha256": sha_file(selected_bundle),
        "path": str(selected_bundle), "savedAt": datetime.now(timezone.utc).isoformat()}
    if runtime.get("checkpointDirectory"):
        receiving = Path(runtime["checkpointDirectory"]).resolve()
        receiving.mkdir(parents=True, exist_ok=True, mode=0o700)
        prior_checkpoint = original_record(receiving / "latest.json")
        if prior_checkpoint and (prior_checkpoint.get("directory") != str(native)
                or prior_checkpoint.get("workDirectory") != str(root)):
            raise RuntimeError("Continue the original shared receiving checkpoint.")
        target = receiving / (result["sha256"] + ".tar.gz")
        if target.exists():
            if target.is_symlink() or target.stat().st_size != result["bytes"] or sha_file(target) != result["sha256"]:
                raise RuntimeError("Preserve the original shared archive bytes.")
        else:
            pending = target.with_name(target.name + "." + str(os.getpid()) + ".pending")
            with selected_bundle.open("rb") as incoming, pending.open("wb") as outgoing:
                os.chmod(pending, 0o600); shutil.copyfileobj(incoming, outgoing, 65536)
                outgoing.flush(); os.fsync(outgoing.fileno())
            if sha_file(pending) != result["sha256"]:
                raise RuntimeError("Receive every original checkpoint archive byte.")
            os.replace(pending, target)
        result["path"] = str(target)
        atomic(receiving / "latest.json", (json.dumps(result, indent=2) + "\n").encode())
    emit({"event": "ORIGINAL_NATIVE_PROGRAMME_SAVED", **result})
    return result

def run_programmes(stage, log_name):
    programmes = (
        ("merchant", "workflow-journey.mjs", "workflow-native-run.json"),
        ("recipe", "workflow-recipes-journey.mjs", "workflow-recipes-native-run.json"),
        ("recurring-customers", "workflow-series-journey.mjs", "workflow-series-native-run.json"))
    selected_bundle, selected_manifest = None, None
    for label, filename, report_name in programmes:
        previous = original_record(native / report_name)
        if previous and previous.get("result") == "PASS":
            continue
        selected_entry = "stellar-forge/mcp-merchant-operator/receiving/" + filename
        native_exit = run_native(stage + "-" + label, log_name, selected_entry)
        returned = original_record(native / report_name)
        if native_exit == 0 and (not returned or returned.get("result") != "PASS"):
            native_exit = 1
            emit({"event": "ORIGINAL_NATIVE_PROGRAMME_INCOMPLETE", "operationId": operation,
                "stage": label, "nativeEntry": selected_entry, "report": report_name})
        selected_bundle, selected_manifest = build_archive(
            require_completed=label == "recurring-customers" and native_exit == 0)
        checkpoint_archive(selected_bundle, label, native_exit)
        if native_exit:
            return native_exit, selected_bundle, selected_manifest
    if selected_bundle is None:
        selected_bundle, selected_manifest = build_archive(require_completed=True)
    return 0, selected_bundle, selected_manifest

# Restore the original archive, then continue its saved programme. An incomplete delivery
# becomes a new complete archive before the same customer's cold reopening is attempted.
if runtime.get("restoreArchive"):
    incoming_bundle = Path(runtime["restoreArchive"]).resolve(strict=True)
    with tarfile.open(incoming_bundle, "r:gz") as archive:
        incoming_manifest = json.load(archive.extractfile("native-delivery-manifest.json"))
    if incoming_manifest.get("schema") != "stellar-forge.native-workspace-archive.v1" or incoming_manifest.get("operationId") != operation:
        raise RuntimeError("Select the original complete merchant workspace archive.")
    if (incoming_manifest.get("directory") != str(native) or incoming_manifest.get("workDirectory") != str(root)
            or incoming_manifest.get("sourceCommit") not in allowed_archive_sources):
        raise RuntimeError("Select the original receiving paths and exact prior source commit from the archive.")
    incoming_digest = sha_file(incoming_bundle)
    if archive_state:
        if incoming_digest not in (archive_state["sha256"], archive_state.get("originArchiveSha256")):
            raise RuntimeError("Continue the original selected archive restoration.")
    else:
        if bundle.exists():
            if bundle.stat().st_size != incoming_bundle.stat().st_size or sha_file(bundle) != incoming_digest:
                raise RuntimeError("Preserve a different existing original output archive.")
        elif incoming_bundle != bundle:
            try:
                os.link(incoming_bundle, bundle)
            except OSError as error:
                import errno
                if error.errno != errno.EXDEV:
                    raise
                temporary = bundle.with_name(bundle.name + ".814b-import-pending")
                with incoming_bundle.open("rb") as incoming, temporary.open("wb") as outgoing:
                    os.chmod(temporary, 0o600); shutil.copyfileobj(incoming, outgoing, 65536)
                    outgoing.flush(); os.fsync(outgoing.fileno())
                if sha_file(temporary) != incoming_digest:
                    raise RuntimeError("Receive the complete original archive bytes before restoration.")
                os.replace(temporary, bundle)
        archive_state = prepare_archive_state(bundle, imported=True)
if archive_state is None:
    code, bundle, manifest = run_programmes("merchant-and-recurring-customer", "workflow-series-native-output.log")
    if code == 0:
        archive_state = prepare_archive_state(bundle)
while archive_state:
    try:
        selected_bundle = Path(archive_state["bundle"])
        if (selected_bundle.is_symlink() or not selected_bundle.resolve().is_relative_to(root)
                or selected_bundle.stat().st_size != archive_state["bytes"] or sha_file(selected_bundle) != archive_state["sha256"]):
            raise RuntimeError("Continue from the original complete shipped archive bytes.")
        if archive_state.get("directory") != str(native) or archive_state.get("sourceCommit") not in allowed_archive_sources:
            raise RuntimeError("Continue the selected original workspace and explicit source edition.")
        if "completeAtSelection" not in archive_state:
            with tarfile.open(selected_bundle, "r:gz") as archive:
                selected_manifest = json.load(archive.extractfile("native-delivery-manifest.json"))
                try:
                    completed = json.load(archive.extractfile("workflow-series-native-run.json"))
                except KeyError:
                    completed = None
            archive_state["completeAtSelection"] = bool(completed and completed.get("result") == "PASS")
            archive_state["archiveSourceCommit"] = selected_manifest["sourceCommit"]
        # Older receiver journals pointed at the mutable output name.
        selected_bundle = retain_archive(selected_bundle)
        archive_state["bundle"] = str(selected_bundle)
        atomic(reopen_path, (json.dumps(archive_state, indent=2) + "\n").encode())
        backup = Path(archive_state["backup"])
        if backup.parent != native.parent or backup == native or backup.is_symlink():
            raise RuntimeError("Keep the original private workspace backup.")
        if archive_state["phase"] in ("PREPARED", "RESTORING"):
            if not backup.exists():
                archive_state["phase"] = "PREPARED"
                atomic(reopen_path, (json.dumps(archive_state, indent=2) + "\n").encode())
                selected_directory = native.stat()
                if (selected_directory.st_dev, selected_directory.st_ino) != (archive_state["backupDevice"], archive_state["backupInode"]):
                    raise RuntimeError("Preserve the different existing original receiving directory.")
                os.rename(native, backup)
            original_directory = backup.stat()
            if (original_directory.st_dev, original_directory.st_ino) != (archive_state["backupDevice"], archive_state["backupInode"]):
                raise RuntimeError("Continue with the actual original preserved workspace directory.")
            native.mkdir(parents=True, exist_ok=True, mode=0o700)
            lock_path = native / "native-receiving.lock"
            if not lock_path.exists():
                os.link(backup / "native-receiving.lock", lock_path)
            archive_state["phase"] = "RESTORING"
            atomic(reopen_path, (json.dumps(archive_state, indent=2) + "\n").encode())
            manifest = restore_archive(selected_bundle)
            if manifest["sourceCommit"] != archive_state["archiveSourceCommit"]:
                raise RuntimeError("Continue the recorded original archive source.")
            if (native / "native-access-token").exists() or (native / "native-inspections").exists() or (native / "browser").exists():
                raise RuntimeError("The shipped workspace must restore independently of transient access and browser files.")
            archive_state["phase"] = "RESTORED"
            atomic(reopen_path, (json.dumps(archive_state, indent=2) + "\n").encode())
        if archive_state["phase"] in ("RESTORED", "REOPEN_RUNNING", "REOPEN_FAILED"):
            archive_state.pop("error", None)
            archive_state["phase"] = "REOPEN_RUNNING"
            atomic(reopen_path, (json.dumps(archive_state, indent=2) + "\n").encode())
            stage = "shipped-workspace-reopen" if archive_state["completeAtSelection"] else "saved-workspace-continuation"
            if archive_state["completeAtSelection"]:
                code = run_native(stage, "workflow-series-archive-reopen-output.log")
            else:
                code, bundle, manifest = run_programmes(stage, "workflow-series-archive-reopen-output.log")
            archive_state["phase"] = "REOPENED" if code == 0 else "REOPEN_FAILED"
            archive_state["exitCode"] = code
            archive_state["finishedAt"] = datetime.now(timezone.utc).isoformat()
            atomic(reopen_path, (json.dumps(archive_state, indent=2) + "\n").encode())
        elif archive_state["phase"] == "REOPENED":
            code = archive_state.get("exitCode", 0)
        else:
            raise RuntimeError("Continue the original archive restoration phase: " + archive_state["phase"])
        if not archive_state["completeAtSelection"]:
            # Save all progress from this actual continuation, including another native failure.
            previous_archive = archive_state
            previous_archive["continuedArchive"] = {"path": str(bundle), "bytes": bundle.stat().st_size,
                "sha256": sha_file(bundle), "exitCode": code}
            atomic(root / ("native-continuation-" + previous_archive["sha256"] + ".json"),
                (json.dumps(previous_archive, indent=2) + "\n").encode())
            archive_state = prepare_archive_state(bundle, imported=True,
                origin_sha256=previous_archive.get("originArchiveSha256", previous_archive["sha256"]))
            emit({"event": "ORIGINAL_NATIVE_CONTINUATION_SAVED", "operationId": operation,
                "originalArchiveSha256": previous_archive["sha256"], **previous_archive["continuedArchive"]})
            if code == 0:
                continue
            break
        if code == 0:
            archive_state.pop("error", None)
            reopened = original_record(native / "workflow-series-reopened.json")
            if not reopened or reopened.get("result") != "PASS":
                raise RuntimeError("Read the actual reopened original customer workspace result.")
            emit({"event": "ORIGINAL_NATIVE_ARCHIVE_REOPENED", "operationId": operation,
                  "bundleSha256": archive_state["sha256"], "result": reopened})
        else:
            # Preserve the complete failed cold-read output while keeping its selected archive immutable.
            bundle, manifest = build_archive(require_completed=False)
        break
    except Exception as error:
        code = 1
        archive_state["error"] = {"type": type(error).__name__, "message": str(error)}
        atomic(reopen_path, (json.dumps(archive_state, indent=2) + "\n").encode())
        emit({"event": "ORIGINAL_NATIVE_ARCHIVE_REOPEN_FAILED", "operationId": operation, "error": archive_state["error"]})
        break
with tarfile.open(bundle, "r:gz") as archive:
    manifest = json.load(archive.extractfile("native-delivery-manifest.json"))
bundle_bytes = bundle.stat().st_size
bundle_sha256 = sha_file(bundle)
emit({"event": "ORIGINAL_NATIVE_OUTPUT_READY", "operationId": operation, "exitCode": code, "directory": str(native),
      "bundle": str(bundle), "bytes": bundle_bytes, "sha256": bundle_sha256,
      "artifactCount": len(manifest["files"]) + 1, "archiveSourceCommit": manifest["sourceCommit"],
      "archiveReopen": archive_state.get("phase") if archive_state else None})

# Keep a complete readable customer result alongside the exact archive on every native host.
summary = root / "merchant-native-customer-delivery.md"
lines = ["# Original merchant customer receiving", "",
    "Operation: " + operation, "",
    "Selected product source: " + payload["sourceCommit"], "",
    "Native process exit code: " + str(code), "",
    "| Programme | Retained result | Original run |",
    "| --- | --- | --- |"]
saved_programmes = []
with tarfile.open(bundle, "r:gz") as archive:
    archived_names = {item.name for item in archive.getmembers()}
    for name, label in (("workflow", "Merchant"), ("workflow-recipes", "Recipe"), ("workflow-series", "Recurring customers")):
        selected_report = next((name + suffix for suffix in ("-native-run.json", "-receiving-checkpoint.json")
            if name + suffix in archived_names), None)
        if selected_report:
            record = json.load(archive.extractfile(selected_report))
            if record.get("operationId") != operation or record.get("directory") != str(native):
                raise RuntimeError("Summarize the actual original archived programme.")
            saved_programmes.append(record)
            run_id = (record.get("run") or {}).get("id", "")
            lines.append("| " + label + " | " + str(record.get("result", "")) + " | " + run_id + " |")
last_native = original_record(native / "native-active.json")
if last_native:
    lines.extend(["", "Last native stage: " + str(last_native.get("stage", "")),
        "", "Last native child exit code: " + str(last_native.get("exitCode", "")), ""])
lines.extend(["", "## Customer periods", "",
    "| Period | Original native run | Complete customer files | Customer archive SHA-256 |",
    "| --- | --- | --- | --- |"])
for record in saved_programmes:
    for period in record.get("periods", []):
        lines.append("| " + str((period.get("request") or {}).get("key", period.get("index", ""))) + " | " +
            str((period.get("run") or {}).get("id", "")) + " | " +
            str(len((period.get("customer") or {}).get("files", []))) + " | " +
            str((period.get("archive") or {}).get("sha256", "")) + " |")
lines.extend(["", "## Retained delivery", "",
    "The companion archive retains the native reports, frozen continuation requests, customer files, "
    "profile handovers, merchant stores and both Console states produced by this original operation.",
    "", "Archive bytes: " + str(bundle_bytes), "", "Archive SHA-256: " + bundle_sha256, ""])
if archive_state:
    lines.extend(["## Restored customer workspace", "",
        "Archive restoration phase: " + str(archive_state.get("phase", "")), ""])
    if archive_state.get("phase") == "REOPENED" and code == 0:
        lines.extend(["The exact companion archive was extracted at its original receiving path and reopened "
            "through the actual merchant launchers with a fresh local credential.", ""])
    reopened = original_record(native / "workflow-series-reopened.json")
    if reopened:
        lines.extend(["\x60\x60\x60json", json.dumps(reopened, indent=2), "\x60\x60\x60", ""])
    if archive_state.get("error"):
        lines.extend(["Current restoration result: " + archive_state["error"]["message"], ""])
for record in saved_programmes:
    if record.get("error"):
        lines.extend(["## Current native result", "", str(record["error"].get("message", "")), ""])
reopen_log = native / "workflow-series-archive-reopen-output.log"
if reopen_log.is_file():
    lines.extend(["## Archive reopen output", "", "\x60\x60\x60text",
        reopen_log.read_text(errors="replace"), "\x60\x60\x60", ""])
atomic(summary, "\n".join(lines).encode("utf-8"))

# Preserve the original native customer results before releasing this host.
helpers = payload.get("libraryHelpers", {})
if set(helpers) == {"library_upload.py", "library_hosted_apps.py", "library_file_transfer.py"}:
    import tempfile
    helper_directory = Path(tempfile.mkdtemp(prefix="library-current-", dir=root))
    for name, body in helpers.items():
        atomic(helper_directory / name, body.encode("utf-8"))
    receipt_path = root / "native-library-save.json"
    prior_save = json.loads(receipt_path.read_text()) if receipt_path.exists() else None
    previous = {item["local_path"]: item for item in (prior_save or {}).get("result", {}).get("results", [])
                if item.get("status") == "succeeded" and item.get("library_file_id")}
    uploads = []
    unknown_prior = prior_save and (prior_save.get("phase") == "DISPATCHING" or
        len(prior_save.get("result", {}).get("results", [])) != 2)
    for path, kind in ((bundle, "other"), (summary, "report")):
        prior_item = previous.get(str(path))
        item = {"local_path": str(path)}
        if prior_item:
            item.update({"purpose": "replace_library_file", "library_file_id": prior_item["library_file_id"],
                         "version_reason": "Continue the same original native merchant customer operation"})
            if isinstance(prior_item.get("current_version_number"), int):
                item["expected_current_version"] = prior_item["current_version_number"]
        else:
            item.update({"purpose": "create_library_file", "library_artifact_type": kind})
        uploads.append(item)
    if unknown_prior:
        emit({"event": "ORIGINAL_NATIVE_LIBRARY_CONTINUATION", "phase": "existing upload outcome needs reconciliation",
              "record": str(receipt_path)})
    else:
        atomic(receipt_path, (json.dumps({"operationId": operation, "phase": "DISPATCHING", "uploads": uploads}) + "\n").encode())
        saved = subprocess.run([sys.executable, str(helper_directory / "library_upload.py")],
            input=json.dumps({"uploads": uploads}).encode(), cwd=root, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        try:
            returned = json.loads(saved.stdout)
        except (json.JSONDecodeError, UnicodeDecodeError):
            returned = {"results": [], "message": "The original save returned without a complete result."}
        receipt = {"operationId": operation, "phase": "RETURNED", "exitCode": saved.returncode,
                   "result": returned, "stderr": saved.stderr.decode("utf-8", "replace")}
        atomic(receipt_path, (json.dumps(receipt, indent=2) + "\n").encode())
        emit({"event": "ORIGINAL_NATIVE_LIBRARY_SAVED", "exitCode": saved.returncode,
            "results": [{key: item[key] for key in ("local_path", "status", "file_name", "library_file_id",
                "file_id", "path", "current_version_number", "local_metadata_applied", "error_code") if key in item}
                for item in returned.get("results", [])]})

# Retain a held foreground host while its complete produced outputs are transferred.
# Each response is short enough for a normal tool output window; source and token files stay outside this archive.
if not globals().get("_merchant_standalone", False):
    for line in sys.stdin:
        command = json.loads(line)
        if command.get("op") == "read-bundle":
            offset, length = command["offset"], min(command.get("length", 8192), 8192)
            if not isinstance(offset, int) or offset < 0 or offset > bundle_bytes:
                raise ValueError("Select a valid complete-output byte offset.")
            with bundle.open("rb") as stream:
                stream.seek(offset)
                chunk = stream.read(length)
            emit({"event": "ORIGINAL_NATIVE_OUTPUT_CHUNK", "offset": offset, "bytes": len(chunk),
                  "data": base64.b64encode(chunk).decode(), "done": offset + len(chunk) == bundle_bytes})
        elif command.get("op") == "close":
            emit({"event": "ORIGINAL_NATIVE_RECEIVER_CLOSED", "exitCode": code}); break
        else:
            emit({"event": "ORIGINAL_NATIVE_OUTPUT_READY", "bytes": bundle_bytes, "sha256": bundle_sha256})

# A normal command returns the native result after preserving its complete outputs.
# The held receiver remains available for the next original-operation command.
if globals().get("_merchant_standalone", False):
    raise SystemExit(code)
