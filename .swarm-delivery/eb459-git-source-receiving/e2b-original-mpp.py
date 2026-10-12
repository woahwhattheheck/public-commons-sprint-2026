#!/usr/bin/env python3
"""Receive the original complete MPP operation on the existing equipped worker."""
from pathlib import Path, PurePosixPath
from types import SimpleNamespace
import argparse, datetime, gzip, hashlib, importlib.util, io, json, os, shutil
import stat, subprocess, sys, tarfile, tempfile, urllib.request, zipfile

os.umask(0o077)
OPERATION = "SCF-MPP-APPLICATIONS-NATIVE-20261012-EB459"
BUSINESS = "SCF-DURABLE-PAID-JOBS-0B8D-20261011"
SANDBOX = "i7uwmcqmeoxkb7g74x51o"
COMMIT = "9ef475062876557d6baf14e0e5414d7afbf3bc7f"
ARCHIVE_SHA = "9ab83b543b260efc13ebabb7e0a6c1474373e3af79ef00a194d6da84d41a55cb"
PACKET_SHA = "e88010db7854addc90d348d66af44ab349565cb2676b4dc4b162f90347837827"
SCRIPT_OIDS = {
    "receive-original-mpp.py": "068d931540bd3fe85061b5fa460b42ac882d967c",
    "git-object-receiving.py": "b4cfcbad88e1d076625e8f59badf315f08f9c23f",
    "runtime-receiving.py": "0f1be6df1c47f8f8fb9517dcaee5b708c71aa4d6",
    "mpp-managed-reception.mjs": "e9fdd60207a7c706ab547ba68d60f53f504e53ec",
}
EXTRA = ["operations/scf-mpp-merchant-mcp-native-20261012/execute.mjs",
         "operations/scf-mpp-merchant-mcp-native-20261012/run.sh"]
SHARED = Path("/root/commons-scf-0b8d-20261012/control")
ROOT_NAME = "commons-mpp-applications-eb459-20261012"

def need(ok, reason):
    if not ok:
        raise RuntimeError(reason)

def regular(path, limit=2 * 1024 * 1024):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, "rb") as stream:
        before = os.fstat(stream.fileno())
        need(stat.S_ISREG(before.st_mode) and before.st_size <= limit, "Expected bounded regular input: " + str(path))
        data = stream.read(limit + 1)
        after = os.fstat(stream.fileno())
        need(len(data) == before.st_size and
             (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) ==
             (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns), "Input changed: " + str(path))
        return data

def directory(path):
    need(path.is_absolute(), "An absolute private directory is required")
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    info = path.lstat()
    need(path.resolve() == path and stat.S_ISDIR(info.st_mode) and
         info.st_uid == os.getuid() and not info.st_mode & 0o077, "Private directory changed: " + str(path))
    return path

def publish(path, data):
    directory(path.parent)
    if path.exists() or path.is_symlink():
        need(regular(path, len(data)) == data, "Existing exact source differs: " + str(path))
        return
    fd, temp = tempfile.mkstemp(prefix=".receiving-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(data); stream.flush(); os.fsync(stream.fileno())
        try:
            os.link(temp, path, follow_symlinks=False)
        except FileExistsError:
            need(regular(path, len(data)) == data, "Concurrent source differs: " + str(path))
    finally:
        os.unlink(temp)

def object_id(data):
    return hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()

def json_bytes(value):
    return (json.dumps(value, sort_keys=True, ensure_ascii=False) + "\n").encode()

def load_selection(root):
    raw = regular(root / "inbox/worker-profile.json", 65536)
    value = json.loads(raw)
    need(value.get("schema") == "stellar-forge.mpp-existing-worker.v1", "Original MPP worker profile required")
    need(value.get("operation") == OPERATION and value.get("businessOperation") == BUSINESS and
         value.get("sandboxId") == SANDBOX, "Existing business/native worker identity changed")
    need(value.get("workerId") == BUSINESS + "-e2b-01", "Original worker metadata differs")
    need(Path(value["root"]) == root and root.name == ROOT_NAME, "Original operation root differs")
    for key in ("node", "python", "controllerArchive", "followingReady"):
        path = Path(value[key])
        need(path.is_absolute(), "Actual absolute worker path required: " + key)
    need(Path(value["followingReady"]).parent == root, "Keep the original descriptor under this private operation")
    donor = value.get("sourceDonor")
    need(isinstance(donor, dict) and donor.get("kind") in ("git", "directory", "public-archive"), "Select the original source donor")
    if donor["kind"] != "public-archive":
        path = Path(donor.get("path", ""))
        need(path.is_absolute() and path.resolve() == path, "Actual source donor path required")
    need(Path(value["controllerArchive"]).is_relative_to(SHARED.parent), "Borrow the accepted original worker controller")
    need(value.get("controllerArchiveSha256") == ARCHIVE_SHA, "Accepted controller archive identity changed")
    return value, raw

def prepare(root):
    directory(root)
    for name in ("inbox", "controller", "source-packet", "run", "results", "control/records", "control/worker", "control/tmp"):
        directory(root / name)
    profile_text = os.environ.pop("MPP_WORKER_PROFILE_JSON", None)
    if profile_text is not None:
        supplied = json.loads(profile_text)
        for name, discovered in (("node", shutil.which("node")), ("python", sys.executable)):
            executable = supplied.get(name) or discovered
            need(executable is not None and Path(executable).is_absolute(), "An actual installed runtime is required: " + name)
            supplied[name] = str(Path(executable).resolve(strict=True))
        publish(root / "inbox/worker-profile.json", json_bytes(supplied))
    value, raw = load_selection(root)
    for name, oid in SCRIPT_OIDS.items():
        need(object_id(regular(root / "inbox" / name)) == oid, "Original script differs: " + name)
    packet = regular(root / "inbox/source-packet.zip", 1024 * 1024)
    need(len(packet) == 430362 and hashlib.sha256(packet).hexdigest() == PACKET_SHA, "Original source packet differs")
    with zipfile.ZipFile(io.BytesIO(packet)) as archive:
        names = set()
        total = 0
        for entry in archive.infolist():
            relative = PurePosixPath(entry.filename)
            need(not relative.is_absolute() and ".." not in relative.parts and
                 entry.filename not in names and not entry.is_dir(), "Invalid source-packet member")
            names.add(entry.filename)
            need(entry.file_size <= 4 * 1024 * 1024 and not stat.S_ISLNK(entry.external_attr >> 16), "Source-packet member is not regular")
            total += entry.file_size
            need(total <= 8 * 1024 * 1024, "Source-packet expansion exceeds its complete original size")
            publish(root / "source-packet" / str(relative), archive.read(entry))
    need((root / "source-packet/9ef475-metadata.json.gz").is_file() and
         (root / "source-packet/incoming").is_dir(), "Original source packet layout is missing")
    controller = regular(Path(value["controllerArchive"]), 1024 * 1024)
    need(hashlib.sha256(controller).hexdigest() == ARCHIVE_SHA, "Accepted original controller archive differs")
    count, total = 0, 0
    with tarfile.open(fileobj=io.BytesIO(controller), mode="r:gz") as archive:
        for member in archive:
            relative = PurePosixPath(member.name)
            need(not relative.is_absolute() and ".." not in relative.parts and relative.parts and
                 relative.parts[0] in ("host", "source-manifest.json", "carrier-manifest.json"), "Invalid original controller member")
            target = root / "controller" / str(relative)
            if member.isdir():
                directory(target); continue
            need(member.isfile() and member.size <= 2 * 1024 * 1024, "Controller member must be regular")
            total += member.size
            need(total <= 16 * 1024 * 1024, "Original controller exceeds its source budget")
            with archive.extractfile(member) as stream:
                data = stream.read(member.size + 1)
            need(len(data) == member.size, "Original controller member is incomplete")
            publish(target, data); count += 1
    node_version = subprocess.run([value["node"], "--version"], capture_output=True, text=True, timeout=10)
    need(node_version.returncode == 0 and node_version.stdout.strip().startswith("v24."), "Actual Node24 runtime differs")
    python_version = subprocess.run([value["python"], "-c", "import sys; print('.'.join(map(str,sys.version_info[:3])))"],
                                    capture_output=True, text=True, timeout=10)
    need(python_version.returncode == 0 and tuple(map(int, python_version.stdout.strip().split("."))) >= (3, 11),
         "Actual Python3.11+ runtime is required")
    for required in ("git", "openssl"):
        need(shutil.which(required) is not None, "Original runtime command missing: " + required)
    for path in (SHARED, SHARED / "capacity/memory", SHARED / "capacity/disk"):
        need(path.is_dir() and path.resolve() == path, "Original worker shared capacity path missing")
    publish(root / "selection.json", raw)
    print(json.dumps({"schema": "stellar-forge.mpp-existing-worker-prepared.v1", "operation": OPERATION,
                      "root": str(root), "sourceCommit": COMMIT, "controllerFiles": count,
                      "workerProfileSha256": hashlib.sha256(raw).hexdigest(), "sharedControl": str(SHARED)}), flush=True)

def command(argv, cwd, log):
    with log.open("w") as output:
        process = subprocess.Popen(argv, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                   text=True, bufsize=1)
        for line in process.stdout:
            output.write(line); output.flush(); print(line, end="", flush=True)
        return process.wait()

def reclaim_unpublished(parent, prefix):
    """Only this operation's unpublished temporary files; the native owner is exclusive."""
    for path in parent.iterdir():
        if not path.name.startswith(prefix):
            continue
        info = path.lstat()
        need(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid() and
             info.st_nlink == 1 and not info.st_mode & 0o077,
             "An unpublished operation path changed identity: " + str(path))
        path.unlink()


def acquire_archive(root):
    """Receive only original selected Git source bytes from the canonical pinned archive."""
    reclaim_unpublished(root, ".source-download-")
    packet = root / "source-packet"
    metadata = json.loads(gzip.decompress(regular(packet / "9ef475-metadata.json.gz", 4 * 1024 * 1024)))
    need(metadata.get("source", {}).get("commit") == COMMIT, "Original selected commit differs")
    rows = {row["path"]: row for row in metadata["tree"]["tree"]} if isinstance(metadata["tree"], dict) else {row["path"]: row for row in metadata["tree"]}
    selected = list(dict.fromkeys(metadata["requiredPaths"] + EXTRA))
    need(all(name in rows for name in selected), "Original source selection is incomplete")
    donor = directory(root / "original-source-donor")
    archive_path = root / "original-source.zip"
    receipt = root / "original-source-archive.json"
    url = "https://codeload.github.com/woahwhattheheck/public-commons-sprint-2026/zip/" + COMMIT
    if archive_path.exists():
        with archive_path.open("rb") as stream:
            digest = hashlib.file_digest(stream, "sha256").hexdigest()
        observed = {"url": url, "sourceCommit": COMMIT, "bytes": archive_path.stat().st_size, "sha256": digest}
        publish(receipt, json_bytes(observed))
    else:
        fd, temp = tempfile.mkstemp(prefix=".source-download-", dir=root)
        size = 0; digest = hashlib.sha256()
        try:
            with os.fdopen(fd, "wb") as output:
                request = urllib.request.Request(url, headers={"User-Agent": "Commons-original-MPP-receiving/1"})
                with urllib.request.urlopen(request, timeout=90) as response:
                    need(response.status == 200, "Original source archive download failed")
                    for data in iter(lambda: response.read(256 * 1024), b""):
                        size += len(data)
                        need(size <= 256 * 1024 * 1024, "Original compressed source exceeds its acquisition budget")
                        output.write(data); digest.update(data)
                output.flush(); os.fsync(output.fileno())
            os.link(temp, archive_path, follow_symlinks=False)
            publish(receipt, json_bytes({"url": url, "sourceCommit": COMMIT, "bytes": size, "sha256": digest.hexdigest()}))
        finally:
            os.unlink(temp)
    prefix = "public-commons-sprint-2026-" + COMMIT + "/"
    total = 0
    with zipfile.ZipFile(archive_path) as archive:
        index = {entry.filename: entry for entry in archive.infolist()}
        need(len(index) == len(archive.infolist()), "Original archive has duplicate members")
        for name in selected:
            row = rows[name]
            need(row["type"] == "blob" and row["mode"] in ("100644", "100755") and
                 type(row.get("size")) is int and 0 <= row["size"] <= 2 * 1024 * 1024, "Selected Git source is not a regular file")
            entry = index.get(prefix + name)
            need(entry is not None and entry.file_size == row["size"] and not entry.is_dir() and
                 not stat.S_ISLNK(entry.external_attr >> 16), "Original source archive member differs: " + name)
            data = archive.read(entry)
            need(object_id(data) == row["sha"], "Original Git blob differs: " + name)
            total += len(data)
            need(total <= 64 * 1024 * 1024, "Original selected source exceeds 64 MiB")
            publish(donor / name, data)
    print(json.dumps({"phase": "ORIGINAL_PINNED_ARCHIVE_RECEIVED", "files": len(selected),
                      "sourceBytes": total, "sourceCommit": COMMIT, "receipt": str(receipt)}), flush=True)
    return donor

def execute(root):
    value, raw = load_selection(root)
    need(regular(root / "selection.json", 65536) == raw, "Prepared worker selection changed")
    donor = value["sourceDonor"]
    if donor["kind"] == "git":
        repository = Path(donor["path"])
    else:
        source = acquire_archive(root) if donor["kind"] == "public-archive" else Path(donor["path"])
        args = [value["python"], "-B", str(root / "inbox/git-object-receiving.py"),
                "--metadata", str(root / "source-packet/9ef475-metadata.json.gz"), "--commit", COMMIT,
                "--directory", str(root / "source-donor-cache"), "--donor-source", str(source),
                "--incoming", str(root / "source-packet/incoming")]
        for path in EXTRA:
            args += ["--additional-path", path]
        code = command(args, root, root / "results/original-source-donor.log")
        if code:
            return code
        donor_state = json.loads(regular(root / "source-donor-cache/source-receiving.json", 4 * 1024 * 1024))
        need(donor_state.get("missingObjects") == 0, "Original Git donor is incomplete")
        repository = Path(donor_state["repository"])
    argv = [value["python"], "-B", str(root / "inbox/receive-original-mpp.py"),
            "--run-directory", str(root / "run"), "--records-directory", str(root / "results"),
            "--source-packet", str(root / "source-packet"), "--donor-repository", str(repository),
            "--git-receiver", str(root / "inbox/git-object-receiving.py"),
            "--runtime-receiver", str(root / "inbox/runtime-receiving.py"),
            "--application-caller", str(root / "inbox/mpp-managed-reception.mjs"),
            "--following-ready", value["followingReady"], "--node", value["node"],
            "--cache", str(root / "runtime-archives"), "--cache-limit-bytes", "4194304"]
    return command(argv, root, root / "results/complete-operation.log")

def launch(root):
    value, raw = load_selection(root)
    need(regular(root / "selection.json", 65536) == raw, "Prepared worker selection changed")
    os.environ["SWARM_STATE_ROOT"] = str(SHARED)
    sys.path.insert(0, str(root / "controller/host"))
    from native_foreground import load_native, ForegroundLaunch
    native = load_native(root / "controller/host")
    args = SimpleNamespace(
        peer="eb459-mpp-applications", operation_id=OPERATION, project=str(root),
        java=None, node=None,
        artifact=["results/mpp-original-complete-native-result.json.gz", "results/complete-operation.log",
                  "results/native-return.tar.gz", "results/run-artifacts.json"],
        runtime_path=[str(root / "controller/host"), str(root / "inbox"), value["node"], value["python"]],
        command=[value["python"], "-B", str(root / "inbox/e2b-original-mpp.py"), "run", str(root)],
        memory_mib=512, memory_reserve_mib=256, memory_reclaim="clean-cache",
        memory_reservations_root=str(SHARED / "capacity/memory"),
        disk_space=[str(root) + "=1024"], disk_inodes=[str(root) + "=18000"],
        disk_reserve_mib=128, disk_reserve_inodes=512,
        disk_reservations_root=str(SHARED / "capacity/disk"),
        records_root=str(root / "control/records"), worker_root=str(root / "control/worker"),
        temp_root=str(root / "control/tmp"))
    owner = ForegroundLaunch(native)
    try:
        result = native.start(args, launcher=owner)
        print(json.dumps({key: result.get(key) for key in
              ("ok", "state", "operation_id", "record", "memory", "disk", "process", "supervisor", "reused")}), flush=True)
    finally:
        if owner.root is not None:
            code = owner.handoff()
            if code is not None:
                raise SystemExit(code)

def capture(root, exit_code):
    """Keep actual source inputs, original native state, client files and complete logs."""
    results = directory(root / "results")
    reclaim_unpublished(results, ".return-")
    selected = []
    fixed = ["selection.json", "original-source-archive.json", "controller/source-manifest.json"]
    fixed += ["inbox/" + name for name in (*SCRIPT_OIDS, "e2b-original-mpp.py", "worker-profile.json")]
    for relative in fixed:
        path = root / relative
        if path.exists():
            selected.append((relative, path))
    for folder in ("run", "results"):
        base = root / folder
        for parent, dirs, names in os.walk(base, followlinks=False):
            relative_parent = Path(parent).relative_to(root)
            kept = []
            for name in dirs:
                relative = relative_parent / name
                if str(relative) in ("run/source", "run/9ef475-cache", "run/tmp", "run/mpp-mcp-run/runtime"):
                    continue
                need(not (Path(parent) / name).is_symlink(), "Original retained directory became a link")
                kept.append(name)
            dirs[:] = kept
            for name in names:
                relative = relative_parent / name
                if folder == "results" and (name in ("native-return.tar.gz", "run-artifacts.json") or name.startswith((".return-", "previous-return-"))):
                    continue
                if str(relative) == "run/operation.lock":
                    continue
                selected.append((str(relative), root / relative))
    runtime = root / "run/mpp-mcp-run/runtime"
    for name in ("package.json", "package-lock.json"):
        if (runtime / name).exists():
            selected.append((str((runtime / name).relative_to(root)), runtime / name))
    selected = sorted(dict(selected).items())
    files, total = [], 0
    fd, temporary = tempfile.mkstemp(prefix=".return-", dir=results)
    os.close(fd)
    try:
        with tarfile.open(temporary, mode="w:gz") as archive:
            for relative, path in selected:
                data = regular(path, 64 * 1024 * 1024)
                total += len(data)
                need(total <= 128 * 1024 * 1024, "Selected original outputs exceed the declared return budget")
                member = tarfile.TarInfo(relative)
                member.size, member.mode = len(data), 0o600
                archive.addfile(member, io.BytesIO(data))
                files.append({"path": relative, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()})
        with open(temporary, "rb") as stream:
            archive_sha = hashlib.file_digest(stream, "sha256").hexdigest()
        destination = results / "native-return.tar.gz"
        if destination.exists():
            with destination.open("rb") as stream:
                old_sha = hashlib.file_digest(stream, "sha256").hexdigest()
            previous = results / ("previous-return-" + old_sha + ".tar.gz")
            if not previous.exists():
                os.link(destination, previous, follow_symlinks=False)
        os.replace(temporary, destination)
        value = {"schema": "stellar-forge.mpp-existing-worker-artifacts.v1",
                 "operation": OPERATION, "sourceCommit": COMMIT, "exitCode": exit_code,
                 "capturedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                 "archive": {"path": str(destination), "bytes": destination.stat().st_size, "sha256": archive_sha},
                 "files": files, "selectedBytes": total}
        data = json_bytes(value)
        fd2, temp_manifest = tempfile.mkstemp(prefix=".return-", dir=results)
        try:
            with os.fdopen(fd2, "wb") as stream:
                stream.write(data); stream.flush(); os.fsync(stream.fileno())
            os.replace(temp_manifest, results / "run-artifacts.json")
        finally:
            if os.path.exists(temp_manifest):
                os.unlink(temp_manifest)
        print(json.dumps({"phase": "MPP_ORIGINAL_OUTPUTS_RETAINED", "operation": OPERATION,
                          "exitCode": exit_code, "files": len(files), "archive": value["archive"]}), flush=True)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("prepare", "launch", "run"))
    parser.add_argument("root", type=Path)
    options = parser.parse_args()
    root = options.root
    need(root.is_absolute() and root.name == ROOT_NAME, "Use this original operation's absolute root")
    if options.action == "prepare":
        prepare(root); return 0
    if options.action == "launch":
        launch(root); return 0
    code = 1
    try:
        code = execute(root)
        return code
    finally:
        capture(root, code)

if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, KeyError, RuntimeError, subprocess.SubprocessError) as error:
        print(json.dumps({"phase": "MPP_EXISTING_WORKER_ERROR", "error": type(error).__name__,
                          "message": str(error)[:1200]}), file=sys.stderr, flush=True)
        raise SystemExit(1)
