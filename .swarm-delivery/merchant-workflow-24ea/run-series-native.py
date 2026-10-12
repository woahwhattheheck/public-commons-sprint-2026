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
    args = parser.parse_args()
    payload = json.loads(Path(args.source_packet).read_bytes())
    names = {"work_dir": "workDir", "directory": "directory", "node": "node", "node_modules": "nodeModules",
             "chromium": "chromiumPath", "playwright_module": "playwrightModule"}
    payload["runtime"] = {names[key]: value for key, value in vars(args).items() if key in names and value}
operation = "ASTRA-24EA-MERCHANT-WORKFLOW-20261012"
assert payload["operationId"] == operation
assert payload["sourceCommit"] == "7cfe93bd78c747c66d64f413824d534cf7567f8c"
assert len(payload["files"]) == 692 and set(payload["files"]) == set(payload["file_blobs"])
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
for name, content in payload["files"].items():
    parts = PurePosixPath(name)
    if parts.is_absolute() or ".." in parts.parts or "\\" in name:
        raise RuntimeError("Invalid original source path")
    data = content.encode("utf-8")
    blob = hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()
    if blob != payload["file_blobs"][name]:
        raise RuntimeError("Original source blob differs: " + name)
    destination = source.joinpath(*parts.parts)
    destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if destination.exists():
        if destination.read_bytes() != data:
            raise RuntimeError("Selected source directory contains another edition: " + name)
    else:
        atomic(destination, data)
emit({"event": "SCF_SERIES_SOURCE_ACCEPTED", "operationId": operation, "files": len(payload["files"]),
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
base = next((path for path in module_roots if (path / "@x402/core/package.json").is_file()), None)
if base is None:
    raise RuntimeError("Select the existing full @x402 2.28.0 dependency directory in payload.runtime.nodeModules.")
dependencies = root / "native-dependencies" / "node_modules"
if not dependencies.exists():
    shutil.copytree(base, dependencies, symlinks=False)
for name in ("yaml", "re2js"):
    if not (dependencies / name / "package.json").is_file():
        origin = next((path / name for path in module_roots if (path / name / "package.json").is_file()), None)
        if origin is None:
            raise RuntimeError("Receive the complete existing " + name + " package into the selected dependency directory.")
        shutil.copytree(origin, dependencies / name, symlinks=False)
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
with tarfile.open(bundle, "w:gz") as archive:
    for name in sorted(artifact_names):
        path = native / name
        if path.is_file() and path.resolve().is_relative_to(native) and not path.is_symlink():
            archive.add(path, arcname=name, recursive=False)
data = bundle.read_bytes()
emit({"event": "ORIGINAL_NATIVE_OUTPUT_READY", "operationId": operation, "exitCode": code, "directory": str(native),
      "bundle": str(bundle), "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(), "artifactCount": len(artifact_names)})
# Retain this foreground host while its complete produced outputs are transferred.
# Each response is short enough for a normal tool output window; source and token files stay outside this archive.
for line in sys.stdin:
    command = json.loads(line)
    if command.get("op") == "read-bundle":
        offset, length = command["offset"], min(command.get("length", 8192), 8192)
        if not isinstance(offset, int) or offset < 0 or offset > len(data):
            raise ValueError("Select a valid complete-output byte offset.")
        chunk = data[offset:offset + length]
        emit({"event": "ORIGINAL_NATIVE_OUTPUT_CHUNK", "offset": offset, "bytes": len(chunk),
              "data": base64.b64encode(chunk).decode(), "done": offset + len(chunk) == len(data)})
    elif command.get("op") == "close":
        emit({"event": "ORIGINAL_NATIVE_RECEIVER_CLOSED", "exitCode": code}); break
    else:
        emit({"event": "ORIGINAL_NATIVE_OUTPUT_READY", "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()})
