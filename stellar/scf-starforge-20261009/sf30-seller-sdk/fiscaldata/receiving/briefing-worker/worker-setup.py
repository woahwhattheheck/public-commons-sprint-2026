#!/usr/bin/env python3
"""Compose the original 0B8D controller setup for the retained Fiscal report.

Original worker-setup.py SHA256 67dcb7590e5b5fa572447725706368e2c853ded766898102964b37176a5cf968.
The archive reader, original source publication and runtime probes below are
preserved; caller root, selected browser checks and output bindings are added.
"""
from pathlib import Path, PurePosixPath
import fcntl, hashlib, io, json, os, shutil, stat, subprocess, sys, tarfile, tempfile

ROOT = Path("/root/commons-fiscal-briefing-7108-20261012")
EXPECTED = "9ab83b543b260efc13ebabb7e0a6c1474373e3af79ef00a194d6da84d41a55cb"

def private_directory(path):
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise RuntimeError("operation directory must remain private")
    return path

def read_regular(path, limit):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, "rb") as stream:
        before = os.fstat(stream.fileno())
        if not stat.S_ISREG(before.st_mode) or before.st_size > limit:
            raise RuntimeError("source is not the expected bounded regular file")
        content = stream.read(limit + 1)
        after = os.fstat(stream.fileno())
        if len(content) > limit or (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) != (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns):
            raise RuntimeError("source changed during receiving")
        return content

def publish(path, content):
    private_directory(path.parent)
    if path.exists() or path.is_symlink():
        if read_regular(path, len(content)) != content:
            raise RuntimeError("existing controller source differs")
        return
    fd, temporary = tempfile.mkstemp(prefix=".source-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.link(temporary, path, follow_symlinks=False)
    finally:
        os.unlink(temporary)

def command(argv):
    result = subprocess.run(argv, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=10)
    if result.returncode:
        raise RuntimeError("required runtime command failed: " + argv[0])
    return result.stdout.strip()

for relative in ("", "inbox", "controller", "worker-output", "control", "control/records", "control/capacity", "control/capacity/memory", "control/capacity/disk", "control/workers", "control/tmp"):
    private_directory(ROOT / relative)

archive = ROOT / "inbox/native-controller.tar.gz"
raw = read_regular(archive, 1048576)
if hashlib.sha256(raw).hexdigest() != EXPECTED:
    raise RuntimeError("original native controller archive digest mismatch")
count, total = 0, 0
with tarfile.open(fileobj=io.BytesIO(raw), mode="r:gz") as carrier:
    for member in carrier:
        relative = PurePosixPath(member.name)
        if relative.is_absolute() or ".." in relative.parts or not relative.parts:
            raise RuntimeError("invalid controller member path")
        if relative.parts[0] not in {"host", "source-manifest.json", "carrier-manifest.json"}:
            raise RuntimeError("unexpected controller member")
        target = ROOT / "controller" / str(relative)
        if member.isdir():
            private_directory(target)
            continue
        if not member.isfile() or member.size > 2 * 1024 * 1024:
            raise RuntimeError("controller archive requires ordinary bounded files")
        total += member.size
        if total > 16 * 1024 * 1024:
            raise RuntimeError("controller archive exceeds original source size")
        stream = carrier.extractfile(member)
        if stream is None:
            raise RuntimeError("controller member missing")
        with stream:
            data = stream.read(member.size + 1)
        if len(data) != member.size:
            raise RuntimeError("controller member size mismatch")
        publish(target, data)
        count += 1

node, npm = shutil.which("node"), shutil.which("npm")
if not node or not npm:
    raise RuntimeError("template Node/npm runtime missing")
node_version = command([node, "--version"])
if node_version != "v24.19.0":
    raise RuntimeError("template Node version differs from original native runtime")
memory = {}
for name in ("memory.max", "memory.current"):
    path = Path("/sys/fs/cgroup") / name
    if path.is_file():
        memory[name] = path.read_text().strip()
disk = os.statvfs(ROOT)
receipt = {
    "operation": "fiscal-treasury-briefing-7108-20261012",
    "original_worker": "SCF-DURABLE-PAID-JOBS-0B8D-20261011-e2b-01",
    "original_setup_sha256": "67dcb7590e5b5fa572447725706368e2c853ded766898102964b37176a5cf968",
    "sandbox_id": "i7uwmcqmeoxkb7g74x51o",
    "root": str(ROOT),
    "controller": {"archive_sha256": EXPECTED, "files": count, "source_bytes": total,
        "source_manifest_sha256": hashlib.sha256(read_regular(ROOT / "controller/source-manifest.json", 1048576)).hexdigest()},
    "runtime": {"node": node, "node_version": node_version, "npm": npm, "npm_version": command([npm, "--version"]),
        "python": sys.executable, "python_version": sys.version.split()[0], "git": command(["git", "--version"]),
        "flock": shutil.which("flock"), "openssl": command(["openssl", "version"])},
    "memory": memory,
    "disk": {"available_bytes": disk.f_bavail * disk.f_frsize, "free_bytes": disk.f_bfree * disk.f_frsize,
        "available_inodes": disk.f_favail}
}

config_bytes = read_regular(ROOT / "inbox/worker-config.json", 65536)
config = json.loads(config_bytes)
if config.get("schema") != "fiscal-briefing-worker.v1" or config.get("operationId") != receipt["operation"] or config.get("directory") != str(ROOT):
    raise RuntimeError("retain the reviewed receiving selection")
if config.get("sandboxId") != receipt["sandbox_id"] or config.get("workerId") != receipt["original_worker"]:
    raise RuntimeError("retain the existing worker identity")
if Path(config["controllerHost"]) != ROOT / "controller/host":
    raise RuntimeError("retain the original controller inside this private handoff")
shared = Path("/root/commons-scf-0b8d-20261012/control")
expected_roots = {
    "sharedStateRoot": shared,
    "memoryReservationsRoot": shared / "capacity/memory",
    "diskReservationsRoot": shared / "capacity/disk",
    "runtimeConsumersRoot": shared / "jobs/runtime-consumers",
}
for key, expected in expected_roots.items():
    if config.get(key) != str(expected):
        raise RuntimeError("preserve the original shared " + key)
if not shared.is_dir():
    raise RuntimeError("the existing worker control directory is unavailable")
if config.get("runtimeSelection") != "existing-installed":
    raise RuntimeError("select the existing installed runtime without downloads")

configuration_sha256 = hashlib.sha256(config_bytes).hexdigest()
runtime_path = ROOT / "worker-runtime.json"
inventory = {"schema": "fiscal-briefing-runtime-inventory.v1",
    "configuration_sha256": configuration_sha256, "node": node, "node_version": node_version,
    "playwright_candidates": [], "chromium_candidates": []}

def retain_inventory():
    body = (json.dumps(inventory, sort_keys=True, indent=2) + "\n").encode()
    target = ROOT / "worker-output" / ("runtime-inventory." + hashlib.sha256(body).hexdigest() + ".json")
    publish(target, body)
    return str(target)

def select_runtime():
    if config.get("node") and Path(config["node"]).resolve(strict=True) != Path(node).resolve(strict=True):
        raise RuntimeError("selected Node differs from the observed original runtime")
    module_roots = []
    for candidate in [config.get("playwrightModules"),
            os.environ.get("CODEX_PRIMARY_RUNTIME_NODE_MODULES"),
            *os.environ.get("NODE_PATH", "").split(os.pathsep),
            str(ROOT / "node_modules"), "/root/commons-scf-0b8d-20261012/node_modules",
            "/root/node_modules", "/usr/local/lib/node_modules", "/usr/lib/node_modules",
            command([npm, "root", "--global"])]:
        if candidate and candidate not in module_roots:
            module_roots.append(candidate)
    probe = r"""
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const input=JSON.parse(fs.readFileSync(0,'utf8'));
const attempts=[];let selected=null;
for(const root of [...input.roots,...Module.globalPaths,null]){
 try{
  const packagePath=root?require.resolve(path.join(root,'playwright/package.json')):require.resolve('playwright/package.json');
  const packageRoot=fs.realpathSync(path.dirname(packagePath));
  const api=require(packageRoot),metadata=JSON.parse(fs.readFileSync(path.join(packageRoot,'package.json'),'utf8'));
  if(typeof api.chromium?.executablePath!=='function')throw Error('Chromium API missing');
  selected={modules:path.dirname(packageRoot),module:require.resolve(packageRoot),version:metadata.version,
    executable:api.chromium.executablePath()};
  attempts.push({root,packagePath,available:true});break;
 }catch(error){attempts.push({root,available:false,reason:error.code||error.name});}
}
process.stdout.write(JSON.stringify({selected,attempts}));
"""
    result = subprocess.run([node, "-e", probe], input=json.dumps({"roots": module_roots}),
        stdin=None, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=15)
    if result.returncode:
        inventory["playwright_probe_exit"] = result.returncode
        raise RuntimeError("existing Playwright probe failed; inventory " + retain_inventory())
    observed = json.loads(result.stdout)
    inventory["playwright_candidates"] = observed["attempts"]
    playwright = observed["selected"]
    if not playwright:
        raise RuntimeError("no existing Playwright installation was found; inventory " + retain_inventory())
    if config.get("playwrightModules") and Path(config["playwrightModules"]).resolve(strict=True) != Path(playwright["modules"]).resolve(strict=True):
        raise RuntimeError("the explicitly selected Playwright installation is unavailable")
    chromium_candidates = [config.get("chromium"), os.environ.get("PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH"),
        os.environ.get("CHROME_BIN"), os.environ.get("CHROMIUM_PATH"), playwright["executable"]]
    chromium_candidates += [shutil.which(name) for name in ("chromium", "chromium-browser", "google-chrome", "chrome", "chrome-headless-shell")]
    browser_cache = Path(os.environ.get("PLAYWRIGHT_BROWSERS_PATH") or str(Path.home() / ".cache/ms-playwright"))
    if browser_cache.is_dir():
        for pattern in ("chromium-*/chrome-linux/chrome", "chromium-*/chrome-linux64/chrome",
                "chromium_headless_shell-*/chrome-linux/headless_shell",
                "chromium_headless_shell-*/chrome-linux64/headless_shell",
                "chromium_headless_shell-*/chrome-headless-shell-linux64/chrome-headless-shell"):
            chromium_candidates += [str(path) for path in sorted(browser_cache.glob(pattern))]
    visited = set()
    chromium, chromium_version = None, None
    for candidate in chromium_candidates:
        if not candidate or candidate in visited:
            continue
        visited.add(candidate)
        try:
            selected = Path(candidate).resolve(strict=True)
            if not selected.is_file() or not os.access(selected, os.X_OK):
                raise RuntimeError("not executable")
            version = command([str(selected), "--version"])
            if "chrom" not in version.lower():
                raise RuntimeError("unrecognized Chromium version")
            if config.get("chromium") and selected != Path(config["chromium"]).resolve(strict=True):
                raise RuntimeError("explicit Chromium selection unavailable")
            inventory["chromium_candidates"].append({"path": str(selected), "available": True, "version": version})
            chromium, chromium_version = selected, version
            break
        except (OSError, RuntimeError, subprocess.SubprocessError) as error:
            inventory["chromium_candidates"].append({"path": candidate, "available": False, "reason": type(error).__name__})
    if chromium is None:
        raise RuntimeError("no existing Chromium executable was found; inventory " + retain_inventory())
    return {
        "schema": "fiscal-briefing-worker-runtime.v1", "configurationSha256": configuration_sha256,
        "operationId": config["operationId"], "workerId": config["workerId"], "sandboxId": config["sandboxId"],
        "directory": str(ROOT), "selection": "existing-installed",
        "node": str(Path(node).resolve(strict=True)), "nodeVersion": node_version,
        "playwrightModules": str(Path(playwright["modules"]).resolve(strict=True)),
        "playwrightModule": playwright["module"], "playwrightVersion": playwright["version"],
        "chromium": str(chromium), "chromiumDirectory": str(chromium.parent),
        "chromiumVersion": chromium_version, "inventory": retain_inventory()
    }

with open(ROOT / "runtime-selection.lock", "a+b") as selection_lock:
    os.chmod(ROOT / "runtime-selection.lock", 0o600)
    fcntl.flock(selection_lock.fileno(), fcntl.LOCK_EX)
    if runtime_path.exists():
        selected_runtime = json.loads(read_regular(runtime_path, 65536))
        if selected_runtime.get("schema") != "fiscal-briefing-worker-runtime.v1" or selected_runtime.get("configurationSha256") != configuration_sha256:
            raise RuntimeError("retained runtime selection belongs to another immutable input")
        if Path(selected_runtime["node"]).resolve(strict=True) != Path(node).resolve(strict=True) or selected_runtime["nodeVersion"] != node_version:
            raise RuntimeError("retained Node selection changed")
        checked = json.loads(command([node, "-e",
            "const p=process.argv[1];const m=require(p+'/playwright');const q=require(p+'/playwright/package.json');"
            "if(!m.chromium)throw Error('Chromium API missing');process.stdout.write(JSON.stringify({module:require.resolve(p+'/playwright'),version:q.version}));",
            selected_runtime["playwrightModules"]]))
        if checked["module"] != selected_runtime["playwrightModule"] or checked["version"] != selected_runtime["playwrightVersion"]:
            raise RuntimeError("retained Playwright selection changed")
        if command([selected_runtime["chromium"], "--version"]) != selected_runtime["chromiumVersion"]:
            raise RuntimeError("retained Chromium selection changed")
    else:
        selected_runtime = select_runtime()
        publish(runtime_path, (json.dumps(selected_runtime, sort_keys=True, indent=2) + "\n").encode())
    directory_fd = os.open(ROOT, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(directory_fd)
    finally:
        os.close(directory_fd)
receipt["selected_runtime"] = selected_runtime
receipt["runtime"]["playwright"] = {"module": selected_runtime["playwrightModule"], "version": selected_runtime["playwrightVersion"]}
receipt["runtime"]["chromium"] = selected_runtime["chromium"]
receipt["runtime"]["chromium_version"] = selected_runtime["chromiumVersion"]
receipt["shared_roots"] = {key: str(value) for key, value in expected_roots.items()}
worker = read_regular(ROOT / "inbox/worker-receive.mjs", 32768)
if hashlib.sha256(worker).hexdigest() != "1abd427637fef60982989a7bbc9daa54dd8722a54a4dd92867d2d1a6dc184b5f":
    raise RuntimeError("reviewed original receiving carrier changed")
publish(ROOT / "worker-receive.mjs", worker)
receipt_bytes = (json.dumps(receipt, sort_keys=True, indent=2) + "\n").encode()
receipt_path = ROOT / "worker-output" / ("setup-receipt." + hashlib.sha256(receipt_bytes).hexdigest() + ".json")
publish(receipt_path, receipt_bytes)
receipt["retained_receipt"] = str(receipt_path)
print(json.dumps(receipt, sort_keys=True), flush=True)
