#!/usr/bin/env python3
"""Provision two isolated original Tyk Gateways + Redis in the saved native journey."""
from __future__ import annotations
import argparse
import ctypes
import fcntl
import gzip
import hashlib
import http.server
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
import threading
import time
import urllib.request
import urllib.parse
import uuid

OPERATION = "TYK-API-MIGRATION-ROLLOUT-D76C-20261012"
VERSION = "5.15.1"
REDIS_VERSION = "6.2.20"
REDIS_SHA256 = "7f8b8a7aed53c445a877adf9e3743cdd323518524170135a58c0702f2dba6ef4"
REDIS_URL = "https://download.redis.io/releases/redis-6.2.20.tar.gz"
VENDOR_COMMIT = "51a1e2e96b08eb0bd734b7d162333d4dc0555096"
PREFIX = "stellar/scf-starforge-20261009/sf30-seller-sdk/tyk"
SCHEMA = "stellar-forge.tyk-native-host.v1"
SEED = "{\n    \"name\": \"Tyk Test API\",\n    \"api_id\": \"1\",\n    \"org_id\": \"default\",\n    \"definition\": {\n        \"location\": \"header\",\n        \"key\": \"version\"\n    },\n    \"auth\": {\n        \"auth_header_name\": \"authorization\"\n    },\n    \"version_data\": {\n        \"not_versioned\": true,\n        \"versions\": {\n            \"Default\": {\n                \"name\": \"Default\",\n                \"expires\": \"3000-01-02 15:04\",\n                \"use_extended_paths\": true,\n                \"extended_paths\": {\n                    \"ignored\": [],\n                    \"white_list\": [],\n                    \"black_list\": []\n                }\n            }\n        }\n    },\n    \"proxy\": {\n        \"listen_path\": \"/tyk-api-test/\",\n        \"target_url\": \"http://httpbin.org\",\n        \"strip_listen_path\": true\n    },\n    \"enable_batch_request_support\": true\n}\n"
ORIGINAL_CONFIG = "{\n  \"listen_address\": \"\",\n  \"listen_port\": 8080,\n  \"secret\": \"352d20ee67be67f6340b4c0605b044b7\",\n  \"template_path\": \"/opt/tyk-gateway/templates\",\n  \"use_db_app_configs\": false,\n  \"app_path\": \"/opt/tyk-gateway/apps\",\n  \"middleware_path\": \"/opt/tyk-gateway/middleware\",\n  \"storage\": {\n    \"type\": \"redis\",\n    \"host\": \"redis\",\n    \"port\": 6379,\n    \"username\": \"\",\n    \"password\": \"\",\n    \"database\": 0,\n    \"optimisation_max_idle\": 2000,\n    \"optimisation_max_active\": 4000\n  },\n  \"enable_analytics\": false,\n  \"analytics_config\": {\n    \"type\": \"\",\n    \"ignored_ips\": []\n  },\n  \"dns_cache\": {\n    \"enabled\": false,\n    \"ttl\": 3600,\n    \"check_interval\": 60\n  },\n  \"allow_master_keys\": false,\n  \"policies\": {\n    \"policy_source\": \"file\",\n    \"allow_explicit_policy_id\": true\n  },\n  \"http_server_options\": {\n    \"xff_depth\": 1,\n    \"enable_strict_routes\": true,\n    \"enable_path_prefix_matching\": true,\n    \"enable_path_suffix_matching\": true\n  },\n  \"hash_keys\": true,\n  \"hash_key_function\": \"murmur64\",\n  \"suppress_redis_signal_reload\": false,\n  \"force_global_session_lifetime\": false,\n  \"max_idle_connections_per_host\": 500\n}\n"

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
    req = urllib.request.Request(url, headers={"User-Agent": "TJLabs-Tyk-native-receiving/1"})
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
        req = urllib.request.Request(url, headers={"User-Agent": "TJLabs-Tyk-native-receiving/1"})
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

def gateway_package(root, architecture, artifact_lock):
    receipt = artifact_lock.get("gateway")
    acquisition = private_directory(root / "acquisition")
    if receipt is None:
        base = "https://packagecloud.io/tyk/tyk-gateway/debian/"
        index_url = base + "dists/buster/main/binary-" + architecture + "/Packages.gz"
        compressed, index_receipt = fetch_bytes(index_url)
        atomic(acquisition / "original-tyk-Packages.gz", compressed)
        packages = gzip.decompress(compressed).decode("utf-8")
        candidates = []
        for paragraph in packages.split("\n\n"):
            item = {}
            for line in paragraph.splitlines():
                if line and not line[0].isspace() and ": " in line:
                    key, value = line.split(": ", 1)
                    item[key] = value
            if item.get("Package") == "tyk-gateway" and item.get("Version") == VERSION and item.get("Architecture") == architecture:
                candidates.append(item)
        if len(candidates) != 1:
            fail("Select one original Tyk 5.15.1 package in the publisher index; found " + str(len(candidates)))
        selected = candidates[0]
        filename = selected["Filename"]
        if filename.startswith("/") or ".." in Path(filename).parts or "://" in filename:
            fail("The original package index contains an unexpected artifact path.")
        if not re.fullmatch(r"[0-9a-f]{64}", selected.get("SHA256", "")):
            fail("The original publisher index must supply the package SHA-256.")
        receipt = {"version": VERSION, "architecture": architecture, "publisherIndex": index_receipt,
                   "package": selected, "url": base + filename,
                   "sourceCommit": VENDOR_COMMIT}
        artifact_lock["gateway"] = receipt
        save(root / "artifact-lock.json", artifact_lock)
    if receipt["version"] != VERSION or receipt["architecture"] != architecture:
        fail("Keep the original selected Gateway version and architecture.")
    package = acquisition / ("tyk-gateway_" + VERSION + "_" + architecture + ".deb")
    downloaded = download(receipt["url"], package, receipt["package"]["SHA256"], int(receipt["package"]["Size"]))
    vendor = private_directory(root / "vendor")
    directory = vendor / ("tyk-gateway-" + VERSION)
    if not directory.exists():
        pending = vendor / (".gateway-" + uuid.uuid4().hex)
        private_directory(pending)
        try:
            command(["dpkg-deb", "--extract", package, pending], root / "gateway-acquisition.log")
            os.rename(pending, directory)
            sync_directory(vendor)
        finally:
            if pending.exists():
                shutil.rmtree(pending)
    binary = directory / "opt/tyk-gateway/tyk"
    if not binary.is_file() or not os.access(binary, os.X_OK) or directory not in binary.resolve().parents:
        fail("The original extracted Gateway executable is absent.")
    identity = digest(binary)
    if receipt.get("binary") and receipt["binary"] != identity:
        fail("The original retained Gateway executable changed.")
    receipt.update({"download": downloaded, "binary": identity, "binaryPath": str(binary)})
    save(root / "artifact-lock.json", artifact_lock)
    return binary, directory / "opt/tyk-gateway"

def redis_binary(root, selected, artifact_lock):
    if selected:
        binary = Path(selected).resolve()
    else:
        present = shutil.which("redis-server")
        output = subprocess.run([present, "--version"], capture_output=True, text=True, check=False).stdout if present else ""
        if re.search(r"\bv=" + re.escape(REDIS_VERSION) + r"\b", output):
            binary = Path(present).resolve()
        else:
            acquisition = private_directory(root / "acquisition")
            tar_path = acquisition / ("redis-" + REDIS_VERSION + ".tar.gz")
            artifact = download(REDIS_URL, tar_path, REDIS_SHA256)
            vendor = private_directory(root / "vendor")
            directory = vendor / ("redis-" + REDIS_VERSION)
            if not directory.exists():
                pending = private_directory(vendor / (".redis-" + uuid.uuid4().hex))
                try:
                    with tarfile.open(tar_path, "r:gz") as archive:
                        if any(Path(member.name).parts[0] != "redis-" + REDIS_VERSION for member in archive.getmembers()):
                            fail("The original Redis archive has an unexpected root.")
                        archive.extractall(pending, filter="data")
                    os.rename(pending / ("redis-" + REDIS_VERSION), directory)
                    sync_directory(vendor)
                finally:
                    if pending.exists():
                        shutil.rmtree(pending)
            binary = directory / "src/redis-server"
            if not binary.exists():
                command(["make", "-j1", "MALLOC=libc", "BUILD_TLS=no", "redis-server", "redis-cli"],
                        root / "redis-build.log", cwd=directory)
            artifact_lock["redisSource"] = {"version": REDIS_VERSION, "archive": artifact,
                "hashesRepository": "redis/redis-hashes", "hashesPath": "README", "hashesGitBlobSha": "aa145cb7c71e9ca3925ce114fd214a4213f69050"}
    actual = subprocess.run([str(binary), "--version"], capture_output=True, text=True, check=False)
    if actual.returncode or not re.search(r"\bv=" + re.escape(REDIS_VERSION) + r"\b", actual.stdout):
        fail("Use the selected original Redis " + REDIS_VERSION + " executable.")
    identity = {"path": str(binary), "versionOutput": actual.stdout.strip(), **digest(binary)}
    if artifact_lock.get("redis") and artifact_lock["redis"]["sha256"] != identity["sha256"]:
        fail("The original retained Redis executable changed.")
    artifact_lock["redis"] = identity
    save(root / "artifact-lock.json", artifact_lock)
    return binary

def proc_identity(pid):
    try:
        value = Path("/proc", str(pid), "stat").read_text()
        rest = value[value.rfind(")") + 2:].split()
        if rest[0] == "Z":
            return None
        return {"pid": pid, "startTicks": rest[19], "processGroup": int(rest[2]),
                "session": int(rest[3]), "command": Path("/proc", str(pid), "cmdline").read_bytes().replace(b"\0", b" ").decode("utf-8", "replace")}
    except FileNotFoundError:
        return None

def same_process(saved):
    current = proc_identity(saved["pid"])
    return current is not None and all(current[key] == saved[key] for key in ("pid", "startTicks", "processGroup", "session"))

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

def retain_original(path, data):
    """Publish one complete original checkpoint and reuse only identical bytes."""
    path = Path(path)
    if path.exists() or path.is_symlink():
        info = path.lstat()
        if not stat.S_ISREG(info.st_mode) or path.is_symlink() or info.st_mode & 0o077 or path.read_bytes() != data:
            fail("Preserve the original target-selection checkpoint: " + str(path))
        return
    temporary = path.with_name(path.name + ".pending-" + uuid.uuid4().hex)
    try:
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        try:
            os.link(temporary, path, follow_symlinks=False)
        except FileExistsError:
            info = path.lstat()
            if not stat.S_ISREG(info.st_mode) or path.is_symlink() or info.st_mode & 0o077 or path.read_bytes() != data:
                fail("Concurrent original target-selection checkpoint differs: " + str(path))
        sync_directory(path.parent)
    finally:
        temporary.unlink(missing_ok=True)


def receiving_edition(config):
    # The earlier completed Gateway/Dashboard archives keep their exact inputs.
    return config["scope"] + ("-gateway-cohort" if config.get("gatewayProduction") else "")


def gateway_core(config):
    original = dict(config)
    original.pop("dashboard", None)
    original.pop("gatewayProduction", None)
    original.pop("gatewayCommissioningApiCount", None)
    original["scope"] = "gateway"
    return original


def retain_target_addition(root, previous, config, state, source_revision):
    """Bind an additive target before replacing the original saved input."""
    if previous is None or previous.get("gatewayProduction"):
        return
    if gateway_core(previous) != gateway_core(config):
        fail("The additive production Gateway changed the original Gateway/runtime input.")
    history = private_directory(root / "configuration-history")
    previous_bytes = encoded(previous)
    previous_hash = hashlib.sha256(previous_bytes).hexdigest()
    retain_original(history / (previous_hash + ".json"), previous_bytes)
    for name in ("result.json", "delivery.json", "journey/result.json", "journey/journey.json"):
        path = root / name
        if path.exists():
            content = path.read_bytes()
            # Content-addressed originals preserve completed and interrupted editions.
            label = name.replace("/", "-").removesuffix(".json")
            retain_original(history / (label + "-" + hashlib.sha256(content).hexdigest() + ".json"), content)
    addition = {"schema": "stellar-forge.tyk-native-target-addition.v1",
                "operation": config["operation"], "previousConfigurationSha256": previous_hash,
                "previousSourceRevision": state.get("sourceRevision"),
                "sourceRevision": source_revision, "gateway": previous["gateway"],
                "gatewayProduction": config["gatewayProduction"],
                "gatewayCommissioningApiCount": config["gatewayCommissioningApiCount"]}
    retain_original(root / "production-target-addition.json", encoded(addition))


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]

def redis_ping(port, password):
    fields = ["AUTH", password]
    def resp(items):
        return ("*" + str(len(items)) + "\r\n" + "".join("$" + str(len(item.encode())) + "\r\n" + item + "\r\n" for item in items)).encode()
    with socket.create_connection(("127.0.0.1", port), timeout=2) as sock:
        sock.sendall(resp(fields))
        if not sock.recv(1024).startswith(b"+OK"):
            return False
        sock.sendall(resp(["PING"]))
        return sock.recv(1024).startswith(b"+PONG")

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

def browser_runtime(root, source_root, node, args, environment):
    selected = args.playwright_module
    modules = [os.environ.get("CODEX_PRIMARY_RUNTIME_NODE_MODULES", ""), str(source_root / "node_modules"),
        "/workspace/scratch/9345d3fc660b/native-runtime/node_modules"]
    if not selected:
        selected = next((str(Path(base) / "playwright/index.mjs") for base in modules if base and (Path(base) / "playwright/index.mjs").is_file()), None)
    if not selected or not Path(selected).is_file():
        fail("Supply the original installed Playwright module through --playwright-module.")
    candidates = [args.chromium, os.environ.get("PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH"), os.environ.get("CHROMIUM_PATH"),
        shutil.which("chromium"), shutil.which("chromium-browser"), shutil.which("google-chrome"),
        "/workspace/scratch/bc0850d7ba23/browser-runtime/chrome-headless-shell",
        "/workspace/scratch/883218df7be2/browser-runtime/chrome-headless-shell"]
    browser = next((str(Path(value).resolve()) for value in candidates if value and Path(value).is_file() and os.access(value, os.X_OK)), None)
    if browser is None:
        environment["PLAYWRIGHT_BROWSERS_PATH"] = str(private_directory(root / "browser"))
        cli = Path(selected).parent / "cli.js"
        if not cli.is_file():
            fail("The original Playwright browser installer is absent.")
        command([node, cli, "install", "chromium"], root / "browser-acquisition.log", env=environment)
        query = "const p=await import(process.argv[1]);process.stdout.write(p.chromium.executablePath());"
        result = subprocess.run([str(node), "--input-type=module", "-e", query, Path(selected).resolve().as_uri()],
                                capture_output=True, text=True, env=environment, check=False)
        browser = result.stdout.strip()
        if result.returncode or not Path(browser).is_file() or not os.access(browser, os.X_OK):
            fail("The original Playwright installer did not provide its browser executable.")
    return str(Path(selected).resolve()), browser

def run(args):
    if platform.system() != "Linux" or sys.version_info < (3, 12):
        fail("Use the original Linux/Python 3.12+ host with Node 24.")
    os.umask(0o077)
    root = private_directory(Path(args.directory).absolute())
    lock_fd = os.open(root / "bootstrap.lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        fail("The same original bootstrap owner is already active: " + str(root))
    try:
        return run_locked(args, root)
    finally:
        os.close(lock_fd)

def run_locked(args, root):
    source_root = Path(args.source_root).resolve()
    driver = source_root / PREFIX / "native-journey.mjs"
    if not driver.is_file():
        fail("Supply the complete merged Tyk product source.")
    node = Path(args.node or os.environ.get("CODEX_PRIMARY_RUNTIME_NODE") or shutil.which("node") or "").resolve()
    actual_node = subprocess.run([str(node), "--version"], capture_output=True, text=True, check=False)
    if actual_node.returncode or not re.fullmatch(r"v24\.\d+\.\d+\s*", actual_node.stdout):
        fail("The native receiving operation requires Node 24.")
    state_path = root / "bootstrap.json"
    state = read_private(state_path) if state_path.exists() else {"schema": SCHEMA, "operation": args.operation,
        "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "processes": {}, "attempts": []}
    if state.get("schema") != SCHEMA or state["operation"] != args.operation:
        fail("Keep the original operation and private directory.")
    for identity in state.get("processes", {}).values():
        stop_owned(identity)
    state["processes"] = {}
    dashboard = read_json(Path(args.dashboard_config).resolve()) if args.dashboard_config else None
    dashboard = dashboard.get("dashboard", dashboard) if dashboard is not None else None
    previous_input = read_private(root / "native-input.json") if (root / "native-input.json").exists() else None
    same_scope = dashboard is None or (previous_input is not None and previous_input.get("dashboard") == dashboard)
    if state.get("nativeCompleted") and same_scope and previous_input and previous_input.get("gatewayProduction"):
        if state.get("sourceRevision") != args.source_revision:
            fail("A completed two-Gateway result retains its original source revision; use its saved receiving source.")
        if previous_input.get("gatewayCommissioningApiCount") != args.gateway_commissioning_apis:
            fail("Keep the original complete Gateway cohort size during receiving replay.")
        artifacts = read_private(root / "artifact-lock.json")
        result = finish_receiving(root, args, state, artifacts, read_private(root / "journey/result.json"))
        return result
    private_directory(root / "vendor")
    private_directory(root / "apps")
    private_directory(root / "middleware")
    private_directory(root / "redis-data")
    private_directory(root / "downloads")
    production_root = private_directory(root / "production-gateway")
    private_directory(production_root / "apps")
    private_directory(production_root / "middleware")
    artifacts = read_private(root / "artifact-lock.json") if (root / "artifact-lock.json").exists() else {"schema": SCHEMA, "operation": args.operation}
    architecture = {"x86_64": "amd64", "aarch64": "arm64"}.get(platform.machine())
    if not architecture:
        fail("The pinned original publisher package supports this bootstrap on amd64 or arm64.")
    binary, gateway_home = gateway_package(root, architecture, artifacts)
    redis = redis_binary(root, args.redis_server, artifacts)
    secret_path = root / "native-secrets.json"
    credentials = read_private(secret_path) if secret_path.exists() else {"gateway": secrets.token_hex(32), "redis": secrets.token_hex(32)}
    if "gatewayProduction" not in credentials:
        credentials["gatewayProduction"] = secrets.token_hex(32)
        save(secret_path, credentials)
    elif not secret_path.exists():
        save(secret_path, credentials)
    if "ports" not in state:
        ports = {}
        for name in ("gateway", "redis", "upstream"):
            value = free_port()
            while value in ports.values():
                value = free_port()
            ports[name] = value
        state["ports"] = ports
        save(state_path, state)
    ports = state["ports"]
    if "gatewayProduction" not in ports:
        value = free_port()
        while value in ports.values():
            value = free_port()
        ports["gatewayProduction"] = value
        save(state_path, state)
    if set(ports) != {"gateway", "gatewayProduction", "redis", "upstream"} or len(set(ports.values())) != 4:
        fail("The two original Gateway, Redis and upstream ports must be distinct.")
    environment = dict(os.environ)
    environment["TYK_NATIVE_GATEWAY_AUTH"] = credentials["gateway"]
    environment["TYK_NATIVE_GATEWAY_PRODUCTION_AUTH"] = credentials["gatewayProduction"]
    environment["MALLOC_ARENA_MAX"] = "2"
    environment["GOMAXPROCS"] = str(args.native_cpus)
    module_path, chromium = browser_runtime(root, source_root, node, args, environment)
    upstream_url = "http://127.0.0.1:" + str(ports["upstream"]) + "/"
    gateway_url = "http://127.0.0.1:" + str(ports["gateway"]) + "/"
    production_url = "http://127.0.0.1:" + str(ports["gatewayProduction"]) + "/"
    seed = json.loads(SEED)
    seed_id = "d76c-seed-" + hashlib.sha256(args.operation.encode()).hexdigest()[:16]
    seed.update({"api_id": seed_id, "name": args.operation + " original upstream seed", "active": True, "use_keyless": True})
    seed["proxy"].update({"listen_path": "/d76c-original-seed/", "target_url": upstream_url, "strip_listen_path": True})
    seed_path = root / "apps/receiving-seed.json"
    if seed_path.exists() and seed_path.read_bytes() != encoded(seed):
        fail("Preserve the original seed definition; its retained file changed.")
    if not seed_path.exists():
        save(seed_path, seed)
    conf = json.loads(ORIGINAL_CONFIG)
    conf.update({"listen_address": "127.0.0.1", "listen_port": ports["gateway"], "secret": credentials["gateway"],
        "pid_file_location": str(root / "gateway.pid"),
        "template_path": str(gateway_home / "templates"), "app_path": str(root / "apps"),
        "middleware_path": str(root / "middleware"), "use_db_app_configs": False, "enable_analytics": False})
    conf["storage"].update({"host": "127.0.0.1", "port": ports["redis"], "password": credentials["redis"],
        "optimisation_max_idle": 16, "optimisation_max_active": 64})
    conf["storage"]["database"] = 0
    save(root / "tyk.conf", conf)
    production_seed = json.loads(SEED)
    production_seed_id = "d76c-production-seed-" + hashlib.sha256(args.operation.encode()).hexdigest()[:16]
    production_seed.update({"api_id": production_seed_id,
        "name": args.operation + " original production upstream seed", "active": True, "use_keyless": True})
    production_seed["proxy"].update({"listen_path": "/d76c-original-production-seed/",
        "target_url": upstream_url, "strip_listen_path": True})
    production_seed_path = production_root / "apps/receiving-seed.json"
    retain_original(production_seed_path, encoded(production_seed))
    production_conf = json.loads(ORIGINAL_CONFIG)
    production_conf.update({"listen_address": "127.0.0.1", "listen_port": ports["gatewayProduction"],
        "secret": credentials["gatewayProduction"], "pid_file_location": str(production_root / "gateway.pid"),
        "template_path": str(gateway_home / "templates"), "app_path": str(production_root / "apps"),
        "middleware_path": str(production_root / "middleware"),
        "use_db_app_configs": False, "enable_analytics": False})
    production_conf["storage"].update({"host": "127.0.0.1", "port": ports["redis"],
        "password": credentials["redis"], "database": 1,
        "optimisation_max_idle": 16, "optimisation_max_active": 64})
    save(production_root / "tyk.conf", production_conf)
    redis_conf = '\n'.join(["bind 127.0.0.1", "port " + str(ports["redis"]), "protected-mode yes",
        "requirepass " + credentials["redis"], "dir " + json.dumps(str(root / "redis-data")),
        "daemonize no", 'save ""', "appendonly yes", "appendfsync everysec", "loglevel notice"]) + "\n"
    atomic(root / "redis.conf", redis_conf.encode())
    config = {"schema": "stellar-forge.tyk-native-journey.v1", "scope": "gateway", "operation": args.operation,
        "gateway": {"connection": {"id": "receiving-gateway", "label": "Owned original Gateway", "kind": "gateway",
            "baseUrl": gateway_url, "authEnv": "TYK_NATIVE_GATEWAY_AUTH"}, "installedVersion": "v" + VERSION,
            "classicSeedApiId": seed_id, "upstreamUrl": upstream_url, "publicBaseUrl": gateway_url,
            "probePath": "native-probe", "expectedUpstreamStatus": 200},
        "gatewayProduction": {"connection": {"id": "receiving-gateway-production",
            "label": "Owned original production Gateway", "kind": "gateway",
            "baseUrl": production_url, "authEnv": "TYK_NATIVE_GATEWAY_PRODUCTION_AUTH"},
            "installedVersion": "v" + VERSION, "classicSeedApiId": production_seed_id,
            "upstreamUrl": upstream_url, "publicBaseUrl": production_url},
        "gatewayCommissioningApiCount": args.gateway_commissioning_apis,
        "chromiumExecutablePath": chromium, "playwrightModulePath": module_path}
    config_path = root / "native-input.json"
    if config_path.exists():
        previous = read_private(config_path)
        if gateway_core(previous) != gateway_core(config):
            fail("Keep the exact original Gateway/runtime configuration during native continuation.")
        if previous.get("gatewayProduction") and (
                previous["gatewayProduction"] != config["gatewayProduction"] or
                previous.get("gatewayCommissioningApiCount") != config["gatewayCommissioningApiCount"]):
            fail("Keep the exact already-selected production Gateway and complete cohort input.")
    if args.dashboard_config:
        if previous_input and previous_input.get("dashboard") is not None and previous_input["dashboard"] != dashboard:
            fail("Keep the exact original Dashboard target during additive Gateway continuation.")
        config.update({"scope": "all", "dashboard": dashboard})
    elif previous_input and previous_input.get("scope") == "all":
        config.update({"scope": "all", "dashboard": previous_input["dashboard"]})
    retain_target_addition(root, previous_input, config, state, args.source_revision)
    # Clear completion before publishing the additive input. A crash must not
    # republish an earlier single-Gateway result as the new complete course.
    state.update({"state": "PREPARING", "nativeCompleted": False, "completed": False})
    save(state_path, state)
    save(config_path, config)
    state.update({"sourceRoot": str(source_root), "sourceRevision": args.source_revision,
        "node": {"path": str(node), "version": actual_node.stdout.strip()}, "scope": config["scope"],
        "managementUrl": gateway_url, "publicUrl": gateway_url, "upstreamUrl": upstream_url,
        "seed": {"apiId": seed_id, "originalBlob": "e080f6e7c4b03048000f74b91baf11da34e28325", **digest(seed_path)},
        "authEnvironment": "TYK_NATIVE_GATEWAY_AUTH",
        "gatewayProduction": {"managementUrl": production_url, "publicUrl": production_url,
            "redisDatabase": 1, "authEnvironment": "TYK_NATIVE_GATEWAY_PRODUCTION_AUTH",
            "configuration": {"path": str(production_root / "tyk.conf")},
            "seed": {"apiId": production_seed_id,
                "originalBlob": "e080f6e7c4b03048000f74b91baf11da34e28325", **digest(production_seed_path)}},
        "gatewayRedisDatabase": 0,
        "browser": {"path": chromium, **digest(chromium)}, "processes": {}})
    save(state_path, state)
    processes, streams, native_result, failure = {}, [], None, None
    upstream_events = open(root / "upstream.jsonl", "ab", buffering=0)
    event_lock = threading.Lock()
    class Handler(http.server.BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass
        def do_GET(self):
            value = {"schema": "stellar-forge.tyk-original-upstream.v1", "operation": args.operation,
                     "method": self.command, "path": self.path}
            data = encoded(value)
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            # Bind the exact reply before its last byte can reach a native probe.
            with event_lock:
                upstream_events.write(encoded({"request": value, "response": {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}}).replace(b"\n", b"") + b"\n")
            self.wfile.write(data)
    upstream = http.server.ThreadingHTTPServer(("127.0.0.1", ports["upstream"]), Handler)
    # server_close must join every original request handler before its log closes.
    upstream.daemon_threads = False
    upstream.block_on_close = True
    upstream_thread = threading.Thread(target=upstream.serve_forever, daemon=True)
    upstream_thread.start()
    def launch(role, argv, env=environment, stdout=None):
        log = open(root / (role + ".log"), "ab", buffering=0) if stdout is None else stdout
        if stdout is None:
            streams.append(log)
        process = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), "_child", str(os.getpid()), "--"] + [str(x) for x in argv],
            cwd=gateway_home if role in ("gateway", "gateway-production") else root, env=env, stdout=log,
            stderr=subprocess.STDOUT, start_new_session=True)
        identity = proc_identity(process.pid)
        if identity is None:
            fail("The original " + role + " process exited before its identity was retained.")
        state["processes"][role] = identity
        processes[role] = process
        save(state_path, state)
        print(json.dumps({"operation": args.operation, "phase": role, "state": "STARTED", "process": identity}), flush=True)
        return process
    try:
        redis_process = launch("redis", [redis, root / "redis.conf"])
        wait_ready(lambda: redis_ping(ports["redis"], credentials["redis"]), redis_process, "Redis")
        gateway_environment = {key: value for key, value in environment.items() if not key.startswith("TYK_GW_")}
        gateway_process = launch("gateway", [binary, "--conf=" + str(root / "tyk.conf")], env=gateway_environment)
        production_process = launch("gateway-production",
            [binary, "--conf=" + str(production_root / "tyk.conf")], env=gateway_environment)
        def hello(url):
            data, _receipt = fetch_bytes(url + "hello", 1024 * 1024)
            value = json.loads(data)
            return value if value.get("status") == "pass" and value.get("details", {}).get("redis", {}).get("status") == "pass" else None
        health = wait_ready(lambda: hello(gateway_url), gateway_process, "Staging Gateway")
        production_health = wait_ready(lambda: hello(production_url), production_process, "Production Gateway")
        for label, observed_health in (("staging", health), ("production", production_health)):
            if str(observed_health.get("version", "")).lstrip("v") != VERSION:
                fail("The actual " + label + " Gateway differs from the selected 5.15.1 publisher version.")
        state["health"] = health
        state["gatewayProduction"]["health"] = production_health
        state["attempts"].append({"startedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "scope": config["scope"]})
        save(state_path, state)
        proc = launch("journey", [node, "--max-old-space-size=384", driver, config_path, root / "journey"], stdout=subprocess.PIPE)
        with open(root / "journey-output.jsonl", "ab", buffering=0) as output:
            for line in iter(proc.stdout.readline, b""):
                output.write(line)
                sys.stdout.buffer.write(line)
                sys.stdout.buffer.flush()
        proc.wait()
        if proc.returncode:
            fail("The original native journey exited " + str(proc.returncode) + "; original state remains in " + str(root / "journey"))
        native_result = read_private(root / "journey/result.json")
        if native_result["state"] != "PASSED" or native_result["summary"]["scope"] != config["scope"]:
            fail("The actual native journey did not complete its selected original scope.")
        original_journey = read_private(root / "journey/journey.json")
        probe = original_journey["steps"]["gateway-native-create-and-explicit-reload"]["value"]["probe"]
        upstream_events.flush()
        observed = [json.loads(line) for line in (root / "upstream.jsonl").read_bytes().splitlines() if line]
        if not any(item["response"]["sha256"] == probe["sha256"] and item["response"]["bytes"] == probe["bytes"] for item in observed):
            fail("The actual Gateway response did not match an original upstream response.")
        validate_gateway_commissioning(native_result, config, observed)
    except BaseException as error:
        failure = error
    finally:
        drains = []
        state["state"] = "CLOSING"
        state["drain"] = drains
        save(state_path, state)
        for role in ("journey", "gateway-production", "gateway", "redis"):
            identity = state["processes"].get(role)
            if identity:
                entry = {"role": role, "pid": identity["pid"], "state": "CLOSING"}
                drains.append(entry)
                save(state_path, state)
                try:
                    entry.update(stop_owned(identity))
                    processes[role].wait(timeout=5)
                except BaseException as error:
                    entry.update({"state": "CLOSE_FAILED", "message": str(error)})
                    failure = failure or error
                save(state_path, state)
        try:
            upstream.shutdown()
            upstream.server_close()
            upstream_thread.join(timeout=5)
            if upstream_thread.is_alive():
                fail("The original upstream owner did not drain.")
            drains.append({"role": "upstream", "state": "CLOSED"})
        except BaseException as error:
            drains.append({"role": "upstream", "state": "CLOSE_FAILED", "message": str(error)})
            failure = failure or error
        upstream_events.close()
        for stream in streams:
            stream.close()
        state["drain"] = drains
        state["processes"] = {role: identity for role, identity in state["processes"].items() if same_process(identity)}
        state["state"] = "INTERRUPTED" if failure else "PASSED"
        state["nativeCompleted"] = not bool(failure)
        state["completed"] = False
        state["finishedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        if failure:
            state["failure"] = {"type": type(failure).__name__, "message": str(failure)}
        save(state_path, state)
    if failure:
        raise failure
    state.pop("failure", None)
    return finish_receiving(root, args, state, artifacts, native_result)

def validate_gateway_commissioning(native_result, config, upstream_events):
    course = native_result.get("summary", {}).get("gatewayCommissioning")
    if not isinstance(course, dict) or course.get("state") != "COMPLETE":
        fail("Complete the original staging and production Gateway commissioning course.")
    expected = {"staging": config["gateway"]["connection"]["baseUrl"],
                "production": config["gatewayProduction"]["connection"]["baseUrl"]}
    for role, url in expected.items():
        if course.get(role, {}).get("baseUrl") != url:
            fail("The completed " + role + " Gateway is not the original retained target.")
    probes = course.get("probes")
    if not isinstance(probes, list) or not probes:
        fail("Retain actual HTTP response identities from both original Gateways.")
    seen = set()
    for probe in probes:
        role = probe.get("target")
        if role not in expected or not isinstance(probe.get("url"), str):
            fail("Every Gateway probe must select its original target and URL.")
        url, base = urllib.parse.urlsplit(probe["url"]), urllib.parse.urlsplit(expected[role])
        if (url.scheme, url.netloc) != (base.scheme, base.netloc) or url.username or url.password:
            fail("The actual Gateway probe reached a different original target.")
        if not isinstance(probe.get("bytes"), int) or isinstance(probe["bytes"], bool) or probe["bytes"] < 1 or not re.fullmatch(r"[a-f0-9]{64}", probe.get("sha256", "")):
            fail("The actual Gateway probe has no complete response identity.")
        if not any(item.get("response", {}).get("sha256") == probe["sha256"] and
                   item.get("response", {}).get("bytes") == probe["bytes"] for item in upstream_events):
            fail("The " + role + " Gateway reply did not match an actual original upstream response.")
        seen.add(role)
    if seen != set(expected):
        fail("Both original staging and production Gateways require actual upstream-matching probes.")
    return course


def finish_receiving(root, args, state, artifacts, native_result):
    config = read_private(root / "native-input.json")
    if state.get("processes") or any(item.get("state") not in ("CLOSED", "EXITED") for item in state.get("drain", [])):
        fail("The original native owners must drain before receiving publication.")
    if config.get("gatewayProduction"):
        observed = [json.loads(line) for line in (root / "upstream.jsonl").read_bytes().splitlines() if line]
        commissioning = validate_gateway_commissioning(native_result, config, observed)
        closed_roles = {item["role"] for item in state.get("drain", [])}
        if not {"journey", "gateway", "gateway-production", "redis", "upstream"} <= closed_roles:
            fail("Retain both Gateway owners and the original upstream/Redis/journey drain receipts.")
    else:
        commissioning = None
    summary = {"schema": SCHEMA, "operation": args.operation, "state": "PASSED", "scope": config["scope"],
        "nativeResult": native_result, "sourceRevision": state["sourceRevision"], "originalGateway": artifacts["gateway"],
        "originalRedis": artifacts["redis"], "health": state["health"], "managementUrl": state["managementUrl"],
        "publicUrl": state["publicUrl"], "upstreamUrl": state["upstreamUrl"], "seed": state["seed"], "ownerDrain": state["drain"]}
    if commissioning is not None:
        summary.update({"gatewayProduction": state["gatewayProduction"], "gatewayCommissioning": commissioning,
                        "gatewayRedisDatabase": state["gatewayRedisDatabase"]})
    save(root / "result.json", summary)
    # The customer archives already contain the complete original native workspace history.
    # This transport groups those exact delivered bytes with its original source/visual reports.
    edition = receiving_edition(config)
    archive_path = root / ("tyk-" + edition + "-native-receiving.tar.gz")
    selected = [root / name for name in ("result.json", "artifact-lock.json", "native-input.json", "upstream.jsonl", "journey-output.jsonl")]
    selected += [path for path in (root / "journey").iterdir() if path.is_file() and path.suffix in (".json", ".png")]
    selected += sorted((root / "journey/downloads").rglob("*"))
    if (root / "production-target-addition.json").exists():
        selected.append(root / "production-target-addition.json")
    if (root / "configuration-history").exists():
        selected += sorted((root / "configuration-history").glob("*.json"))
    members = []
    for path in selected:
        if path.is_symlink():
            fail("The original receiving member became a symlink.")
        if path.is_file():
            members.append({"name": str(path.relative_to(root)), **digest(path)})
    members.sort(key=lambda item: item["name"])
    manifest_path = root / ("archive-input-" + edition + ".json")
    if manifest_path.exists():
        manifest = read_private(manifest_path)
        if manifest["members"] != members:
            fail("Preserve the original complete receiving archive inputs.")
    else:
        manifest = {"schema": SCHEMA, "operation": args.operation, "scope": config["scope"], "edition": edition, "members": members}
        save(manifest_path, manifest)
    if archive_path.exists():
        with tarfile.open(archive_path, "r:gz") as archive:
            actual = archive.getmembers()
            if [item.name for item in actual] != [item["name"] for item in members]:
                fail("The retained receiving archive members differ.")
            for item, expected in zip(actual, members):
                if not item.isfile() or item.size != expected["bytes"]:
                    fail("The retained original archive member changed.")
                h = hashlib.sha256()
                with archive.extractfile(item) as stream:
                    for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                        h.update(chunk)
                if h.hexdigest() != expected["sha256"]:
                    fail("The retained original archive bytes changed.")
    else:
        temporary = archive_path.with_name(archive_path.name + ".pending-" + uuid.uuid4().hex)
        try:
            with open(temporary, "xb") as out:
                with gzip.GzipFile(filename="", mode="wb", fileobj=out, mtime=0) as compressor:
                    with tarfile.open(fileobj=compressor, mode="w") as archive:
                        for item in members:
                            info = tarfile.TarInfo(item["name"])
                            info.size, info.mode, info.mtime = item["bytes"], 0o600, 0
                            with open(root / item["name"], "rb") as stream:
                                archive.addfile(info, stream)
                out.flush()
                os.fsync(out.fileno())
            os.replace(temporary, archive_path)
            sync_directory(root)
        finally:
            temporary.unlink(missing_ok=True)
    delivered = {**summary, "completeReceiving": {"path": str(archive_path), **digest(archive_path)},
                 "retainedDirectory": str(root)}
    save(root / "delivery.json", delivered)
    if args.return_directory:
        destination = private_directory(Path(args.return_directory).absolute())
        target = destination / archive_path.name
        if target.exists() and digest(target) != digest(archive_path):
            fail("The existing return artifact differs; preserve its original receiving identity.")
        if not target.exists():
            with open(archive_path, "rb") as src:
                tmp = destination / (target.name + ".pending-" + uuid.uuid4().hex)
                try:
                    with open(tmp, "xb") as out:
                        shutil.copyfileobj(src, out, 1024 * 1024)
                        out.flush()
                        os.fsync(out.fileno())
                    os.replace(tmp, target)
                    sync_directory(destination)
                finally:
                    tmp.unlink(missing_ok=True)
        delivered["completeReceiving"]["returnedPath"] = str(target)
        save(destination / (archive_path.name + ".json"), delivered)
        save(root / "delivery.json", delivered)
    state["completed"] = True
    save(root / "bootstrap.json", state)
    print(json.dumps(delivered), flush=True)
    return delivered

def main():
    if len(sys.argv) > 1 and sys.argv[1] == "_child":
        parent = int(sys.argv[2])
        argv = sys.argv[4:]
        if not argv:
            fail("Missing original native executable.")
        if ctypes.CDLL(None, use_errno=True).prctl(1, signal.SIGTERM, 0, 0, 0) != 0:
            fail("Cannot bind the original native process to its bootstrap owner.")
        if os.getppid() != parent:
            sys.exit(143)
        os.execvpe(argv[0], argv, os.environ)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root", required=True)
    parser.add_argument("--source-revision", required=True)
    parser.add_argument("--directory", required=True)
    parser.add_argument("--operation", default=OPERATION)
    parser.add_argument("--node")
    parser.add_argument("--redis-server")
    parser.add_argument("--playwright-module")
    parser.add_argument("--chromium")
    parser.add_argument("--dashboard-config")
    parser.add_argument("--return-directory")
    parser.add_argument("--native-cpus", type=int, choices=range(1, 9), default=2)
    parser.add_argument("--gateway-commissioning-apis", type=int, choices=range(2, 21), default=12)
    run(parser.parse_args())

if __name__ == "__main__":
    main()
