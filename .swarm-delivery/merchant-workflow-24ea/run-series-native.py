import os, sys, json, hashlib, shutil, subprocess, socket, fcntl, signal, tarfile, base64
from pathlib import Path, PurePosixPath
from datetime import datetime, timezone

# A held receiver supplies payload directly. A normal operator can select the complete packet file.
if "payload" not in globals():
    import argparse
    parser = argparse.ArgumentParser(description="Continue the original native merchant/customer operation.")
    parser.add_argument("--source-packet", required=True)
    parser.add_argument("--work-dir")
    parser.add_argument("--directory")
    parser.add_argument("--node")
    parser.add_argument("--node-modules")
    parser.add_argument("--chromium")
    parser.add_argument("--playwright-module")
    parser.add_argument("--dependency-transfers", help="Private JSON file containing the two retained original package download references")
    parser.add_argument("--library-helpers", help="Directory with the complete current Library upload helper and both companions")
    args = parser.parse_args()
    payload = json.loads(Path(args.source_packet).read_bytes())
    names = {"work_dir": "workDir", "directory": "directory", "node": "node", "node_modules": "nodeModules",
             "chromium": "chromiumPath", "playwright_module": "playwrightModule"}
    payload.setdefault("runtime", {}).update({names[key]: value for key, value in vars(args).items() if key in names and value})
    if args.dependency_transfers:
        payload["dependencyTransfers"] = json.loads(Path(args.dependency_transfers).read_bytes())
    if args.library_helpers:
        helper_root = Path(args.library_helpers)
        payload["libraryHelpers"] = {name: (helper_root / name).read_text() for name in
            ("library_upload.py", "library_hosted_apps.py", "library_file_transfer.py")}
operation = "ASTRA-24EA-MERCHANT-WORKFLOW-20261012"
assert payload["operationId"] == operation
assert payload["sourceCommit"] == "7cfe93bd78c747c66d64f413824d534cf7567f8c"
assert len(payload["file_blobs"]) == 692
provided_files = payload.get("files", {})
assert not provided_files or set(provided_files) == set(payload["file_blobs"])
runtime = payload.get("runtime", {})
root = Path(runtime.get("workDir", "/dev/commons-scf-series-814b")).resolve()
source = root / ("source-" + payload["sourceCommit"][:12])
native = Path(runtime.get("directory", str(root / "native"))).resolve()
for path in (root, source, native):
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
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
# Receive only the missing original public packages, with their complete registry metadata.
transfers = payload.get("dependencyTransfers", [])
if transfers:
    import urllib.request, io
    expected_packages = {"yaml": ("2.9.1", 112114), "re2js": ("2.8.6", 213596)}
    if {item["name"] for item in transfers} != set(expected_packages):
        raise RuntimeError("Select both original retained dependency packages.")
    extra_root = root / "native-extra-packages"
    extra_root.mkdir(parents=True, exist_ok=True, mode=0o700)
    for transfer in transfers:
        name = transfer["name"]
        version, expected_bytes = expected_packages[name]
        with urllib.request.urlopen(transfer["metadataUrl"], timeout=60) as response:
            metadata_bytes = response.read()
        metadata = json.loads(metadata_bytes)
        if metadata.get("name") != name or metadata.get("version") != version:
            raise RuntimeError("Receive the original complete npm metadata: " + name)
        with urllib.request.urlopen(transfer["archiveUrl"], timeout=60) as response:
            archive_bytes = response.read()
        integrity = "sha512-" + base64.b64encode(hashlib.sha512(archive_bytes).digest()).decode()
        if len(archive_bytes) != expected_bytes or integrity != metadata["dist"]["integrity"]:
            raise RuntimeError("The original npm archive differs: " + name)
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
    elif not origin.name.startswith("."):
        link_package(origin, dependencies / origin.name)
for name in ("yaml", "re2js"):
    if not (dependencies / name / "package.json").is_file():
        origin = next((path / name for path in module_roots if (path / name / "package.json").is_file()), None)
        if origin is None:
            raise RuntimeError("Receive the complete existing " + name + " package into the selected dependency directory.")
        link_package(origin, dependencies / name)
expected = {"@x402/core": "2.28.0", "@x402/stellar": "2.28.0", "@x402/extensions": "2.28.0", "@stellar/stellar-sdk": "16.3.1"}
versions = {}
for name in [*expected, "yaml", "re2js"]:
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
started = datetime.now(timezone.utc).isoformat()
with (native / "workflow-series-native-output.log").open("ab", buffering=0) as output:
    child = subprocess.Popen(argv, cwd=source, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        start_new_session=True, pass_fds=(lease.fileno(),))
    process_start = Path("/proc/" + str(child.pid) + "/stat").read_text().rsplit(")", 1)[1].split()[19]
    active = {"operationId": operation, "phase": "RUNNING", "pid": child.pid, "processStart": process_start,
        "controllerPid": os.getpid(), "host": identity, "directory": str(native),
        "sourceCommit": payload["sourceCommit"], "startedAt": started}
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
artifact_names = set(["native-active.json", "workflow-series-native-output.log"])
for name in ("workflow-receiving-checkpoint.json", "workflow-native-run.json", "workflow-recipes-receiving-checkpoint.json",
             "workflow-recipes-native-run.json", "workflow-series-receiving-checkpoint.json", "workflow-series-native-run.json"):
    path = native / name
    if path.is_file():
        artifact_names.add(name)
        for artifact in json.loads(path.read_text()).get("artifacts", []):
            artifact_names.add(artifact["name"])
for role in ("source-console", "receiver-console"):
    directory = native / role
    if directory.is_dir():
        for path in directory.rglob("*"):
            if path.is_file() and not path.is_symlink():
                artifact_names.add(path.relative_to(native).as_posix())
bundle = root / "merchant-original-native-artifacts.tar.gz"
archived_names = []
with tarfile.open(bundle, "w:gz") as archive:
    for name in sorted(artifact_names):
        path = native / name
        if path.is_file() and path.resolve().is_relative_to(native) and not path.is_symlink() and path.suffix.lower() != ".png":
            archive.add(path, arcname=name, recursive=False)
            archived_names.append(name)
bundle_bytes = bundle.stat().st_size
bundle_digest = hashlib.sha256()
with bundle.open("rb") as stream:
    for chunk in iter(lambda: stream.read(65536), b""):
        bundle_digest.update(chunk)
bundle_sha256 = bundle_digest.hexdigest()
emit({"event": "ORIGINAL_NATIVE_OUTPUT_READY", "operationId": operation, "exitCode": code, "directory": str(native),
      "bundle": str(bundle), "bytes": bundle_bytes, "sha256": bundle_sha256, "artifactCount": len(archived_names)})

# Preserve the original native customer results before releasing this host.
helpers = payload.get("libraryHelpers", {})
if set(helpers) == {"library_upload.py", "library_hosted_apps.py", "library_file_transfer.py"}:
    import tempfile
    helper_directory = Path(tempfile.mkdtemp(prefix="library-current-", dir=root))
    for name, body in helpers.items():
        atomic(helper_directory / name, body.encode("utf-8"))
    summary = root / "merchant-native-customer-delivery.md"
    lines = ["# Original merchant customer receiving", "",
        "Operation: " + operation, "",
        "Selected product source: " + payload["sourceCommit"], "",
        "Native process exit code: " + str(code), "",
        "| Programme | Retained result | Original run |",
        "| --- | --- | --- |"]
    saved_programmes = []
    for name, label in (("workflow", "Merchant"), ("workflow-recipes", "Recipe"), ("workflow-series", "Recurring customers")):
        record = original_record(native / (name + "-native-run.json")) or original_record(native / (name + "-receiving-checkpoint.json"))
        if record:
            saved_programmes.append(record)
            run_id = (record.get("run") or {}).get("id", "")
            lines.append("| " + label + " | " + str(record.get("result", "")) + " | " + run_id + " |")
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
        "The companion archive contains the complete native reports, frozen continuation requests, customer files, "
        "profile handovers and both Console states selected by this original operation.",
        "", "Archive bytes: " + str(bundle_bytes), "", "Archive SHA-256: " + bundle_sha256, ""])
    for record in saved_programmes:
        if record.get("error"):
            lines.extend(["## Current native result", "", str(record["error"].get("message", "")), ""])
    atomic(summary, "\n".join(lines).encode("utf-8"))
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

# Retain this foreground host while its complete produced outputs are transferred.
# Each response is short enough for a normal tool output window; source and token files stay outside this archive.
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
