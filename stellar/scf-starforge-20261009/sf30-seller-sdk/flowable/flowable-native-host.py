#!/usr/bin/env python3
"""Run original Flowable 8.0.0, complete native process operations and original receiving."""
from __future__ import annotations
import argparse
import base64
import ctypes
import fcntl
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import secrets
import shutil
import signal
import socket
import stat
import subprocess
import sys
import tarfile
import time
import urllib.request
import urllib.parse
import urllib.error
import uuid
import zipfile

OPERATION = "FLOWABLE-PROCESS-OPERATIONS-D76C-20261012"
VERSION = "8.0.0"
VENDOR_COMMIT = "0779d68e5a3385b74d8acb8bc37901ff54513249"
PUBLISHER_URL = "https://github.com/flowable/flowable-engine/releases/download/flowable-8.0.0/flowable-8.0.0.zip"
PUBLISHER_SHA256 = "d0f9ad0b7b2170881d66928178cf31c66084f1d6e3ffe6237afb32d8e9f4ad1d"
PUBLISHER_BYTES = 101332703
PREFIX = "stellar/scf-starforge-20261009/sf30-seller-sdk/flowable"
SCHEMA = "stellar-forge.flowable-native-host.v1"
SCOPE = "complete-native-process-history-and-cold-receiving"

def fail(message):
    raise RuntimeError(message)

def encoded(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8")

def digest(path):
    h = hashlib.sha256()
    count = 0
    with open(path, "rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            count += len(block)
            h.update(block)
    return {"bytes": count, "sha256": h.hexdigest()}

def sync_directory(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)

def private_directory(path):
    path = Path(path)
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode) or path.resolve() != path or info.st_mode & 0o077:
        fail("Use an original private, canonical operation directory: " + str(path))
    return path

def atomic(path, data):
    path = Path(path)
    tmp = path.with_name(path.name + ".pending-" + uuid.uuid4().hex)
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(tmp, path)
        sync_directory(path.parent)
    finally:
        tmp.unlink(missing_ok=True)

def save(path, value):
    atomic(path, encoded(value))

def read_json(path):
    with open(path, "rb") as stream:
        return json.load(stream)

def read_private(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_mode & 0o077:
            fail("The retained private file has changed: " + str(path))
        with os.fdopen(os.dup(fd), "rb") as stream:
            return json.load(stream)
    finally:
        os.close(fd)

def fetch_bytes(url, maximum=64 * 1024 * 1024):
    req = urllib.request.Request(url, headers={"User-Agent": "TJLabs-Flowable-native-receiving/1"})
    with urllib.request.urlopen(req, timeout=90) as response:
        data = response.read(maximum + 1)
        if len(data) > maximum:
            fail("Original publisher metadata exceeds the declared receiving limit.")
        return data, {"url": url, "receivedUrl": urllib.parse.urlsplit(response.geturl())._replace(query="", fragment="").geturl(), "status": response.status,
                      "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(),
                      "receivedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}

def download(url, path, expected_sha, expected_size=None):
    path = Path(path)
    if path.exists():
        actual = digest(path)
        if actual["sha256"] != expected_sha or (expected_size is not None and actual["bytes"] != expected_size):
            fail("Existing retained artifact differs from its original publisher selection: " + str(path))
        return {"url": url, "path": str(path), **actual}
    tmp = path.with_name(path.name + ".pending-" + uuid.uuid4().hex)
    h = hashlib.sha256()
    count = 0
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "TJLabs-Flowable-native-receiving/1"})
        with urllib.request.urlopen(req, timeout=90) as response, open(tmp, "xb") as stream:
            os.chmod(tmp, 0o600)
            final_url = urllib.parse.urlsplit(response.geturl())._replace(query="", fragment="").geturl()
            for block in iter(lambda: response.read(1024 * 1024), b""):
                count += len(block)
                if count > (expected_size if expected_size is not None else 1024 * 1024 * 1024):
                    fail("Original artifact exceeded its selected size.")
                h.update(block)
                stream.write(block)
            stream.flush()
            os.fsync(stream.fileno())
        if h.hexdigest() != expected_sha or (expected_size is not None and count != expected_size):
            fail("Original publisher artifact failed its selected byte identity.")
        os.replace(tmp, path)
        sync_directory(path.parent)
        return {"url": url, "receivedUrl": final_url, "path": str(path), "bytes": count, "sha256": h.hexdigest()}
    finally:
        tmp.unlink(missing_ok=True)

def command(argv, log_path, env=None, cwd=None):
    with open(log_path, "ab", buffering=0) as log:
        result = subprocess.run([str(x) for x in argv], stdout=log, stderr=subprocess.STDOUT,
                                env=env, cwd=cwd, check=False)
    if result.returncode:
        fail("Original command exited " + str(result.returncode) + "; full log: " + str(log_path))

def proc_identity(pid):
    try:
        value = Path("/proc", str(pid), "stat").read_text()
        rest = value[value.rfind(")") + 2:].split()
        if rest[0] == "Z":
            return None
        return {"pid": pid, "startTicks": rest[19], "processGroup": int(rest[2]),
                "session": int(rest[3]), "bootId": Path("/proc/sys/kernel/random/boot_id").read_text().strip(), "command": Path("/proc", str(pid), "cmdline").read_bytes().replace(b"\0", b" ").decode("utf-8", "replace")}
    except FileNotFoundError:
        return None

def same_process(saved):
    current = proc_identity(saved["pid"])
    return current is not None and all(current[key] == saved[key] for key in ("pid", "startTicks", "processGroup", "session", "bootId"))

def stop_owned(saved):
    if not same_process(saved):
        return {"pid": saved["pid"], "state": "EXITED"}
    if saved["processGroup"] != saved["pid"] or saved["session"] != saved["pid"]:
        fail("The saved native owner is no longer its original process group.")
    try:
        os.killpg(saved["pid"], signal.SIGTERM)
    except ProcessLookupError:
        return {"pid": saved["pid"], "state": "EXITED"}
    deadline = time.monotonic() + 20
    while same_process(saved) and time.monotonic() < deadline:
        time.sleep(0.1)
    if same_process(saved):
        try:
            os.killpg(saved["pid"], signal.SIGKILL)
        except ProcessLookupError:
            return {"pid": saved["pid"], "state": "EXITED"}
        deadline = time.monotonic() + 5
        while same_process(saved) and time.monotonic() < deadline:
            time.sleep(0.1)
    if same_process(saved):
        fail("The original native owner did not drain: " + str(saved["pid"]))
    return {"pid": saved["pid"], "state": "CLOSED"}

def native_engine_environment(environment):
    # The operation's private properties own this engine's Spring/Flowable settings.
    # Keep the browser/Node environment separate from native JVM configuration.
    injectors = {"JAVA_TOOL_OPTIONS", "_JAVA_OPTIONS", "JDK_JAVA_OPTIONS", "JAVA_OPTIONS", "JAVA_OPTS", "CLASSPATH"}
    return {key: value for key, value in environment.items()
            if key.upper() not in injectors
            and not key.upper().startswith(("SPRING_", "SPRING.", "FLOWABLE_", "FLOWABLE.", "SERVER_", "SERVER."))}


def close_native_owners(state_path, state):
    originals = list(reversed(state.get("processes", [])))
    if state.get("closeState") == "CLOSED" and not any(same_process(item) for item in originals):
        return {"state": "CLOSED", "closedAt": state["closedAt"], "processes": state.get("closedProcesses", [])}
    state["closeState"] = "CLOSING"
    state["closeStartedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    state["closedProcesses"] = []
    state.pop("closeFailures", None)
    save(state_path, state)
    failures = []
    for original in originals:
        identity = {key: original[key] for key in ("role", "pid", "startTicks", "processGroup", "session", "bootId")}
        try:
            outcome = {**identity, **stop_owned(original)}
            state["closedProcesses"].append(outcome)
        except BaseException as error:
            failures.append({**identity, "type": type(error).__name__, "message": str(error)})
        state["closeFailures"] = failures
        save(state_path, state)
    if failures or any(same_process(item) for item in originals):
        state["closeState"] = "INTERRUPTED"
        save(state_path, state)
        fail("Resume the original native owner close from " + str(state_path))
    state["closeState"] = "CLOSED"
    state["closedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    state.pop("closeFailures", None)
    save(state_path, state)
    return {"state": "CLOSED", "closedAt": state["closedAt"], "processes": state["closedProcesses"]}


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]

def wait_ready(check, process, label, seconds=90):
    deadline = time.monotonic() + seconds
    last = None
    while time.monotonic() < deadline:
        if process is not None and process.poll() is not None:
            fail(label + " exited before readiness: " + str(process.returncode))
        try:
            value = check()
            if value:
                return value
        except (OSError, ValueError) as error:
            last = str(error)
        time.sleep(0.25)
    fail(label + " did not become ready: " + str(last))


def child_lifetime():
    # The saved native operation owns both process groups if its parent is interrupted.
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(1, signal.SIGTERM, 0, 0, 0) != 0:
        raise OSError(ctypes.get_errno(), "Native parent lifetime could not be attached")


def original_java(root, selected, artifact_lock, environment):
    known = artifact_lock.get("java")
    if known:
        binary = Path(known["path"])
        if binary.is_file() and digest(binary)["sha256"] == known["sha256"]:
            return binary
        fail("Retain the exact selected Java runtime in the original operation")
    found = selected or shutil.which("java")
    if found:
        binary = Path(found).resolve()
        result = subprocess.run([str(binary), "-version"], capture_output=True, text=True, check=False, env=environment)
        version = result.stderr + result.stdout
        match = re.search(r'version "(\d+)', version)
        if result.returncode == 0 and match and int(match.group(1)) >= 17:
            artifact_lock["java"] = {"path": str(binary), "versionOutput": version.strip(), **digest(binary)}
            save(root / "artifact-lock.json", artifact_lock)
            return binary
        if selected:
            fail("The selected Flowable Java runtime must be Java17 or later")
    architecture = {"x86_64": "x64", "aarch64": "aarch64"}.get(platform.machine())
    if architecture is None:
        fail("Select an installed Java17+ runtime for this original machine architecture")
    acquisition = private_directory(root / "acquisition")
    metadata_path = acquisition / "original-adoptium-jre21.json"
    selection = artifact_lock.get("javaSelection")
    if selection is None:
        url = ("https://api.adoptium.net/v3/assets/latest/21/hotspot?architecture=" + architecture +
               "&image_type=jre&os=linux&vendor=eclipse")
        raw, receipt = fetch_bytes(url, 4 * 1024 * 1024)
        atomic(metadata_path, raw)
        releases = json.loads(raw)
        candidates = [item for item in releases if item.get("binary", {}).get("architecture") == architecture
                      and item["binary"].get("os") == "linux" and item["binary"].get("image_type") == "jre"]
        if len(candidates) != 1:
            fail("Select one exact original Temurin21 JRE from the publisher metadata")
        chosen = candidates[0]
        package = chosen["binary"]["package"]
        if not re.fullmatch(r"[0-9a-f]{64}", package.get("checksum", "")) or not isinstance(package.get("size"), int):
            fail("The original Java publisher metadata must provide exact artifact identity")
        selection = {"architecture": architecture, "metadata": receipt, "release": chosen}
        artifact_lock["javaSelection"] = selection
        save(root / "artifact-lock.json", artifact_lock)
    package = selection["release"]["binary"]["package"]
    archive = acquisition / Path(package["name"]).name
    downloaded = download(package["link"], archive, package["checksum"], package["size"])
    vendor = private_directory(root / "vendor")
    destination = vendor / "temurin-jre21"
    if not destination.exists():
        pending = private_directory(vendor / (".java-" + uuid.uuid4().hex))
        try:
            with tarfile.open(archive, "r:gz") as source:
                roots = {Path(member.name).parts[0] for member in source.getmembers()}
                if len(roots) != 1 or any(name in (".", "..", "") for name in roots):
                    fail("The original Java publisher archive has an unexpected root")
                source.extractall(pending, filter="data")
            os.rename(pending / next(iter(roots)), destination)
            sync_directory(vendor)
        finally:
            if pending.exists():
                shutil.rmtree(pending)
    binary = destination / "bin/java"
    if not binary.is_file() or not os.access(binary, os.X_OK):
        fail("The original Java runtime did not provide its executable")
    result = subprocess.run([str(binary), "-version"], capture_output=True, text=True, check=False, env=environment)
    version = result.stderr + result.stdout
    if result.returncode or not re.search(r'version "21[.]', version):
        fail("The original selected Temurin21 runtime did not start")
    artifact_lock["java"] = {"path": str(binary), "versionOutput": version.strip(), "download": downloaded, **digest(binary)}
    save(root / "artifact-lock.json", artifact_lock)
    return binary


def flowable_package(root, artifact_lock):
    acquisition = private_directory(root / "acquisition")
    archive = acquisition / ("flowable-" + VERSION + ".zip")
    downloaded = download(PUBLISHER_URL, archive, PUBLISHER_SHA256, PUBLISHER_BYTES)
    vendor = private_directory(root / "vendor")
    war = vendor / "flowable-rest.war"
    selected = artifact_lock.get("flowable")
    if war.exists():
        actual = digest(war)
        if not selected or actual != selected["war"]:
            fail("Keep the original selected Flowable REST application")
        return war
    temporary = war.with_name(war.name + ".pending-" + uuid.uuid4().hex)
    try:
        with zipfile.ZipFile(archive) as source:
            members = [member for member in source.infolist() if member.filename == "wars/flowable-rest.war"]
            if len(members) != 1 or members[0].file_size > 512 * 1024 * 1024:
                fail("The original Flowable distribution must contain one wars/flowable-rest.war")
            with source.open(members[0]) as incoming, temporary.open("xb") as output:
                os.fchmod(output.fileno(), 0o600)
                shutil.copyfileobj(incoming, output, 1024 * 1024)
                output.flush()
                os.fsync(output.fileno())
        actual = digest(temporary)
        receipt = {"version": VERSION, "sourceCommit": VENDOR_COMMIT, "download": downloaded,
                   "member": "wars/flowable-rest.war", "war": actual, "path": str(war)}
        # Retain selection before publication; a restarted extraction checks those same bytes.
        artifact_lock["flowable"] = receipt
        save(root / "artifact-lock.json", artifact_lock)
        os.replace(temporary, war)
        sync_directory(vendor)
        return war
    finally:
        temporary.unlink(missing_ok=True)


def browser_runtime(root, source_root, node, args, environment, artifact_lock):
    selected = args.playwright_module
    modules = [os.environ.get("CODEX_PRIMARY_RUNTIME_NODE_MODULES", ""), str(source_root / "node_modules"),
               str(root / "browser-runtime/node_modules")]
    if not selected:
        selected = next((str(Path(base) / "playwright/index.mjs") for base in modules
                         if base and (Path(base) / "playwright/index.mjs").is_file()), None)
    if not selected:
        runtime = private_directory(root / "browser-runtime")
        npm = shutil.which("npm")
        if not npm:
            fail("Supply the installed Playwright module or original npm runtime")
        selection = artifact_lock.get("playwrightSelection")
        if selection is None:
            raw, receipt = fetch_bytes("https://registry.npmjs.org/playwright/latest", 4 * 1024 * 1024)
            metadata = json.loads(raw)
            if metadata.get("name") != "playwright" or not re.fullmatch(r"\d+\.\d+\.\d+", metadata.get("version", "")):
                fail("Select one original published Playwright package")
            atomic(root / "acquisition/original-playwright-metadata.json", raw)
            selection = {"version": metadata["version"], "dist": metadata["dist"], "metadata": receipt}
            artifact_lock["playwrightSelection"] = selection
            save(root / "artifact-lock.json", artifact_lock)
        command([npm, "install", "--ignore-scripts", "--no-audit", "--no-fund", "--prefix", runtime,
                 "--save-exact", "playwright@" + selection["version"]], root / "playwright-acquisition.log", env=environment)
        selected = str(runtime / "node_modules/playwright/index.mjs")
    if not Path(selected).is_file():
        fail("The original Playwright module is absent")
    selected = str(Path(selected).resolve())
    query = "const p=await import(process.argv[1]);process.stdout.write(p.chromium.executablePath());"
    result = subprocess.run([str(node), "--input-type=module", "-e", query, Path(selected).as_uri()],
                            capture_output=True, text=True, env=environment, check=False)
    original_path = result.stdout.strip() if result.returncode == 0 else None
    candidates = [args.chromium, os.environ.get("PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH"), os.environ.get("CHROMIUM_PATH"),
                  original_path, shutil.which("chromium"), shutil.which("chromium-browser"), shutil.which("google-chrome")]
    browser = next((str(Path(value).resolve()) for value in candidates
                    if value and Path(value).is_file() and os.access(value, os.X_OK)), None)
    if browser is None:
        environment["PLAYWRIGHT_BROWSERS_PATH"] = str(private_directory(root / "browser"))
        cli = Path(selected).parent / "cli.js"
        command([node, cli, "install", "chromium"], root / "browser-acquisition.log", env=environment)
        result = subprocess.run([str(node), "--input-type=module", "-e", query, Path(selected).as_uri()],
                                capture_output=True, text=True, env=environment, check=False)
        browser = result.stdout.strip()
        if result.returncode or not Path(browser).is_file() or not os.access(browser, os.X_OK):
            fail("The original Playwright installer did not provide its browser executable")
    artifact_lock["browser"] = {"playwrightModule": {"path": selected, **digest(Path(selected))},
                                "chromium": {"path": browser, **digest(Path(browser))}}
    save(root / "artifact-lock.json", artifact_lock)
    return selected, browser


def native_json(base, credentials, path, method="GET", body=None):
    payload = None if body is None else json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    authorization = base64.b64encode((credentials["username"] + ":" + credentials["password"]).encode("utf-8")).decode("ascii")
    request = urllib.request.Request(base + path, data=payload, method=method,
        headers={"Authorization": "Basic " + authorization, "Accept": "application/json",
                 **({"Content-Type": "application/json"} if payload is not None else {})})
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            raw = response.read(8 * 1024 * 1024 + 1)
            if len(raw) > 8 * 1024 * 1024:
                fail("The original native setup response exceeded its receiving limit")
            return response.status, json.loads(raw) if raw else None, raw
    except urllib.error.HTTPError as error:
        raw = error.read(8 * 1024 * 1024 + 1)
        if error.code == 404:
            return error.code, json.loads(raw) if raw else None, raw
        raise


def ensure_reviewer(root, base, credentials, reviewer_id):
    path = "/identity/users/" + urllib.parse.quote(reviewer_id, safe="")
    status, user, raw = native_json(base, credentials, path)
    if status == 404:
        secret_path = root / "reviewer-identity.private.json"
        if secret_path.exists():
            payload = read_private(secret_path)
        else:
            payload = {"id": reviewer_id, "firstName": "Native", "lastName": "Reviewer",
                       "password": secrets.token_hex(32), "email": reviewer_id + "@example.invalid"}
            save(secret_path, payload)
        status, user, raw = native_json(base, credentials, "/identity/users", method="POST", body=payload)
        if status != 201:
            fail("The original Flowable identity service did not create the selected reviewer")
    status, user, raw = native_json(base, credentials, path)
    if status != 200 or user.get("id") != reviewer_id:
        fail("The original native reviewer identity differs")
    receipt = {"id": reviewer_id, "status": status, "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}
    save(root / "native-reviewer.json", receipt)
    return receipt


def complete_archive(root, source_revision, native_result):
    journey = root / "journey"
    entries = []
    for path in sorted(journey.rglob("*")):
        if path.is_symlink():
            fail("The original complete receiving contains an unexpected symbolic link")
        if not path.is_file() or path.name.endswith(".lock") or ".pending-" in path.name:
            continue
        relative = path.relative_to(journey).as_posix()
        entries.append({"path": relative, **digest(path)})
    manifest = {"schema": "stellar-forge.flowable-complete-native-receiving.v1",
                "operation": OPERATION, "sourceRevision": source_revision, "scope": SCOPE,
                "journey": native_result["stateFile"], "files": entries}
    manifest_path = root / "native-receiving-manifest.json"
    save(manifest_path, manifest)
    archive = root / "flowable-complete-native-receiving.zip"
    temporary = archive.with_name(archive.name + ".pending-" + uuid.uuid4().hex)
    try:
        with zipfile.ZipFile(temporary, "x", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as target:
            source_entries = [(journey / item["path"], "journey/" + item["path"], item) for item in entries]
            source_entries.append((manifest_path, manifest_path.name, digest(manifest_path)))
            for path, name, expected in source_entries:
                info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                info.create_system = 3
                info.external_attr = (stat.S_IFREG | 0o600) << 16
                with path.open("rb") as incoming, target.open(info, "w") as output:
                    shutil.copyfileobj(incoming, output, 256 * 1024)
                if digest(path) != {key: expected[key] for key in ("bytes", "sha256")}:
                    fail("The original closed receiving changed during packaging")
        with temporary.open("rb") as stream:
            os.fsync(stream.fileno())
        if archive.exists():
            if digest(archive) != digest(temporary):
                fail("Preserve the original completed native receiving archive")
        else:
            os.link(temporary, archive, follow_symlinks=False)
            sync_directory(root)
        return {"path": str(archive), **digest(archive), "manifest": {"path": str(manifest_path), **digest(manifest_path)},
                "files": len(entries)}
    finally:
        temporary.unlink(missing_ok=True)


def run(args):
    os.umask(0o077)
    root = private_directory(Path(args.directory).absolute())
    lock = os.open(root / "native-host.lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return run_locked(args, root)
    finally:
        os.close(lock)


def run_locked(args, root):
    if platform.system() != "Linux":
        fail("Use the existing Linux native execution host")
    if args.operation != OPERATION or not re.fullmatch(r"[a-f0-9]{40}", args.source_revision):
        fail("Keep the original company operation and exact installed source revision")
    source_root = Path(args.source_root).resolve()
    runtime_root = Path(args.runtime_directory).absolute()
    if runtime_root.resolve() != runtime_root or not runtime_root.is_dir() or runtime_root.is_symlink():
        fail("Use the retained original installed runtime directory")
    installed_source = runtime_root / "package/source"
    manifest_path = runtime_root / "package/manifest.json"
    manifest = read_json(manifest_path)
    if manifest.get("sourceCommit") != args.source_revision or \
       manifest.get("sourceSelection", {}).get("id") != "flowable-merchant":
        fail("The installed runtime must contain the same selected Flowable source")
    for relative in (PREFIX + "/native-journey.mjs", PREFIX + "/native.mjs",
                     "products/flowable-merchant/native-installed-journey.mjs"):
        if not (source_root / relative).is_file() or not (installed_source / relative).is_file():
            fail("Receive the complete original source including " + relative)
    binding = {"schema": SCHEMA, "operation": OPERATION, "sourceRevision": args.source_revision,
               "sourceRoot": str(source_root), "runtimeDirectory": str(runtime_root),
               "runtimeManifest": digest(manifest_path), "nativeVersion": VERSION, "vendorCommit": VENDOR_COMMIT}
    binding_path = root / "operation.json"
    if binding_path.exists():
        if read_private(binding_path) != binding:
            fail("Resume the original native host with its exact source and operation")
    else:
        save(binding_path, binding)
    state_path = root / "host-state.json"
    state = read_private(state_path) if state_path.exists() else {**binding, "processes": [], "state": "PREPARING"}
    if any(state.get(key) != value for key, value in binding.items()):
        fail("The retained native host state belongs to a different operation or source")
    completed_path = root / "delivery.json"
    if completed_path.exists():
        completed = read_private(completed_path)
        if completed.get("state") != "PASSED" or completed.get("sourceRevision") != args.source_revision:
            fail("The retained complete native delivery differs")
        for item in (completed["completeReceiving"], completed["nativeResult"]["stateFile"]):
            if digest(Path(item["path"])) != {key: item[key] for key in ("bytes", "sha256")}:
                fail("The original completed native receiving bytes changed")
        native_close = close_native_owners(state_path, state)
        if completed.get("nativeClose") != native_close:
            completed["nativeClose"] = native_close
            save(completed_path, completed)
        state["state"] = "PASSED"
        save(state_path, state)
        print(json.dumps(completed, separators=(",", ":")), flush=True)
        return completed
    artifact_path = root / "artifact-lock.json"
    artifact_lock = read_private(artifact_path) if artifact_path.exists() else {"schema": SCHEMA, "operation": OPERATION}
    private_directory(root / "acquisition")
    node = args.node or os.environ.get("CODEX_PRIMARY_RUNTIME_NODE") or shutil.which("node")
    if not node:
        fail("Use the existing original Node24 runtime")
    node = str(Path(node).resolve())
    actual_node = subprocess.run([node, "--version"], capture_output=True, text=True, check=False)
    if actual_node.returncode or not re.match(r"v(?:2[4-9]|[3-9][0-9])\.", actual_node.stdout):
        fail("The original installed workspace requires Node24 or later")
    artifact_lock["node"] = {"path": node, "version": actual_node.stdout.strip(), **digest(Path(node))}
    save(artifact_path, artifact_lock)
    inspect_module = installed_source / "stellar/scf-starforge-20261009/sf46-release/runtime-package.mjs"
    inspect_code = ("const {inspectMerchantRuntime}=await import(process.argv[1]);"
                    "process.stdout.write(JSON.stringify(await inspectMerchantRuntime(process.argv[2],"
                    "{load:true,expectedManifest:process.argv[3]})));")
    inspected = subprocess.run([node, "--input-type=module", "--eval", inspect_code,
                                inspect_module.as_uri(), str(runtime_root), digest(manifest_path)["sha256"]],
                               capture_output=True, text=True, check=False)
    if inspected.returncode:
        atomic(root / "runtime-inspection-error.log", inspected.stderr.encode("utf-8"))
        fail("Continue the original installed runtime using " + str(root / "runtime-inspection-error.log"))
    installed_runtime = json.loads(inspected.stdout)
    if installed_runtime.get("state") != "READY" or installed_runtime.get("sourceCommit") != args.source_revision or \
       installed_runtime.get("sourceRoot") != str(installed_source):
        fail("The complete original installed runtime differs")
    save(root / "installed-runtime.json", installed_runtime)
    environment = dict(os.environ)
    engine_environment = native_engine_environment(environment)
    java = original_java(root, args.java, artifact_lock, engine_environment)
    war = flowable_package(root, artifact_lock)
    playwright, chromium = browser_runtime(root, installed_source, node, args, environment, artifact_lock)
    runtime_path = root / "runtime.private.json"
    if runtime_path.exists():
        runtime = read_private(runtime_path)
    else:
        short = hashlib.sha256(OPERATION.encode()).hexdigest()[:12]
        runtime = {"port": free_port(), "username": "sf-admin-" + short, "password": secrets.token_hex(32),
                   "reviewerUserId": "sf-reviewer-" + short, "databasePassword": secrets.token_hex(32)}
        save(runtime_path, runtime)
    database = private_directory(root / "database")
    properties = "\n".join([
        "server.address=127.0.0.1", "server.port=" + str(runtime["port"]),
        "server.servlet.context-path=/flowable-rest", "flowable.process.servlet.path=/service",
        "spring.datasource.url=jdbc:h2:file:" + str(database / "flowable") + ";DB_CLOSE_ON_EXIT=FALSE",
        "spring.datasource.username=flowable", "spring.datasource.password=" + runtime["databasePassword"],
        "spring.datasource.driver-class-name=org.h2.Driver", "flowable.database-schema-update=true",
        "flowable.history-level=full", "flowable.dmn.enabled=true", "flowable.dmn.history-enabled=true",
        "flowable.dmn.servlet.path=/dmn-api", "flowable.async-executor-activate=false",
        "flowable.async-history-executor-activate=false", "flowable.rest.app.create-demo-definitions=false",
        "flowable.rest.app.authentication-mode=verify-privilege",
        "flowable.rest.app.admin.user-id=" + runtime["username"], "flowable.rest.app.admin.password=" + runtime["password"],
        "spring.main.banner-mode=off", "spring.application.name=sf-flowable-native-receiving", ""
    ])
    properties_path = root / "application.private.properties"
    if properties_path.exists():
        if properties_path.read_text() != properties:
            fail("Keep the original native engine configuration")
    else:
        atomic(properties_path, properties.encode("utf-8"))
    base = "http://127.0.0.1:" + str(runtime["port"]) + "/flowable-rest/service"
    dmn_base = "http://127.0.0.1:" + str(runtime["port"]) + "/flowable-rest/dmn-api"
    credentials = {"username": runtime["username"], "password": runtime["password"]}
    engine_saved = next((item for item in reversed(state["processes"]) if item["role"] == "flowable" and same_process(item)), None)
    engine_process = None
    try:
        if engine_saved is None:
            log = open(root / "flowable-engine.log", "ab", buffering=0)
            engine_process = subprocess.Popen([str(java), "-Xms128m", "-Xmx" + str(args.java_heap_mib) + "m",
                "-XX:ActiveProcessorCount=" + str(args.native_cpus), "-Djava.awt.headless=true", "-jar", str(war),
                "--spring.config.additional-location=" + properties_path.as_uri()],
                stdout=log, stderr=subprocess.STDOUT, env=engine_environment, start_new_session=True, preexec_fn=child_lifetime)
            log.close()
            engine_saved = proc_identity(engine_process.pid)
            if engine_saved is None:
                fail("The original Flowable engine exited before retaining its process identity")
            engine_saved["role"] = "flowable"
            state["processes"].append(engine_saved)
            state["closeState"] = "OPEN"
            state["state"] = "ENGINE_STARTING"
            save(state_path, state)
            print(json.dumps({"phase": "original-flowable-engine-starting", "process": engine_saved,
                              "log": str(root / "flowable-engine.log")}), flush=True)
        def ready():
            status, value, raw = native_json(base, credentials, "/repository/process-definitions?size=1")
            return status == 200 and isinstance(value.get("data"), list)
        wait_ready(ready, engine_process, "Original Flowable8 REST engine", seconds=240)
        def dmn_ready():
            status, value, raw = native_json(dmn_base, credentials, "/dmn-repository/decisions?size=1")
            return status == 200 and isinstance(value.get("data"), list)
        wait_ready(dmn_ready, engine_process, "Original Flowable8 DMN REST engine", seconds=240)
        reviewer = ensure_reviewer(root, base, credentials, runtime["reviewerUserId"])
        environment["FLOWABLE_NATIVE_USERNAME"] = runtime["username"]
        environment["FLOWABLE_NATIVE_PASSWORD"] = runtime["password"]
        private_environment_path = root / "application-environment.private.json"
        private_environment = {"FLOWABLE_NATIVE_USERNAME": runtime["username"],
                               "FLOWABLE_NATIVE_PASSWORD": runtime["password"]}
        if private_environment_path.exists():
            if read_private(private_environment_path) != private_environment:
                fail("Resume with the original private Applications environment")
        else:
            save(private_environment_path, private_environment)
        connection = {"id": "native-flowable", "label": "Original Flowable8 process engine", "baseUrl": base,
                      "usernameEnv": "FLOWABLE_NATIVE_USERNAME", "passwordEnv": "FLOWABLE_NATIVE_PASSWORD"}
        dmn_connection = {"id": "native-flowable-dmn", "label": "Original Flowable8 decision engine", "baseUrl": dmn_base,
                          "usernameEnv": "FLOWABLE_NATIVE_USERNAME", "passwordEnv": "FLOWABLE_NATIVE_PASSWORD"}
        configuration = {"schema": "stellar-forge.flowable-native-journey.v1", "operation": OPERATION,
            "sourceRevision": args.source_revision, "installedVersion": VERSION, "connection": connection, "dmnConnection": dmn_connection,
            "runtimeDirectory": str(runtime_root), "installedSourceRoot": str(installed_source),
            "environmentFile": str(private_environment_path),
            "adminUserId": runtime["username"], "reviewerUserId": runtime["reviewerUserId"],
            "playwrightModule": playwright, "chromiumExecutable": chromium}
        configuration_path = root / "journey-configuration.json"
        if configuration_path.exists() and read_private(configuration_path) != configuration:
            fail("Keep the original native receiving journey configuration")
        save(configuration_path, configuration)
        state["state"] = "NATIVE_JOURNEY_RUNNING"
        state["reviewer"] = reviewer
        save(state_path, state)
        log_path = root / "native-journey.log"
        log = open(log_path, "ab", buffering=0)
        process = subprocess.Popen([node, str(installed_source / PREFIX / "native-journey.mjs"),
                                    str(configuration_path), str(root / "journey")],
                                   stdout=log, stderr=subprocess.STDOUT, env=environment,
                                   start_new_session=True, preexec_fn=child_lifetime)
        log.close()
        child = proc_identity(process.pid)
        if child:
            child["role"] = "native-journey"
            state["processes"].append(child)
            state["closeState"] = "OPEN"
        save(state_path, state)
        print(json.dumps({"phase": "complete-original-native-journey", "process": child,
                          "log": str(log_path)}), flush=True)
        result = process.wait()
        if result:
            fail("The original native journey exited " + str(result) + "; resume from " + str(log_path))
        lines = log_path.read_text().splitlines()
        native_result = None
        for line in reversed(lines):
            try:
                candidate = json.loads(line)
            except json.JSONDecodeError:
                continue
            if candidate.get("schema") == "stellar-forge.flowable-native-journey.v1" and candidate.get("state") == "PASSED":
                native_result = candidate
                break
        if not native_result or native_result["operation"] != OPERATION or native_result["scope"] != SCOPE:
            fail("The original complete Flowable journey result is absent")
        journey = read_json(root / "journey/journey.json")
        if journey["state"] != "PASSED" or journey["operation"] != OPERATION or \
           journey["configuration"]["sourceRevision"] != args.source_revision:
            fail("The retained original native journey state differs")
        if digest(Path(native_result["stateFile"]["path"])) != {key: native_result["stateFile"][key] for key in ("bytes", "sha256")}:
            fail("The complete native journey identity changed")
        state["state"] = "NATIVE_JOURNEY_COMPLETE"
        state["nativeResult"] = native_result
        save(state_path, state)
        native_close = close_native_owners(state_path, state)
        complete = complete_archive(root, args.source_revision, native_result)
        receipt = {**binding, "scope": SCOPE, "state": "PASSED", "nativeResult": native_result, "nativeClose": native_close,
                   "completeReceiving": complete, "artifactLock": {"path": str(artifact_path), **digest(artifact_path)},
                   "completedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
        save(completed_path, receipt)
        state["state"] = "PASSED"
        save(state_path, state)
        print(json.dumps(receipt, separators=(",", ":")), flush=True)
        return receipt
    except BaseException as error:
        state["state"] = "INTERRUPTED"
        state["failure"] = {"type": type(error).__name__, "message": str(error),
                            "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
        save(state_path, state)
        raise
    finally:
        if state.get("closeState") != "CLOSED":
            close_native_owners(state_path, state)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root", required=True)
    parser.add_argument("--source-revision", required=True)
    parser.add_argument("--runtime-directory", required=True)
    parser.add_argument("--directory", required=True)
    parser.add_argument("--operation", default=OPERATION)
    parser.add_argument("--node")
    parser.add_argument("--java")
    parser.add_argument("--playwright-module")
    parser.add_argument("--chromium")
    parser.add_argument("--native-cpus", type=int, choices=range(1, 9), default=2)
    parser.add_argument("--java-heap-mib", type=int, choices=range(256, 8193), default=768)
    args = parser.parse_args()
    run(args)


if __name__ == "__main__":
    main()
