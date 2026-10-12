#!/usr/bin/env python3
"""Prepare the pinned WordPress sources in one VM, then enter its original courier."""
from __future__ import annotations

import argparse
import ast
import concurrent.futures
import email.utils
import fcntl
import hashlib
import json
import os
import pathlib
import stat
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

REPOSITORY = "woahwhattheheck/public-commons-sprint-2026"
CARRIER_REF = "bcb7bea412839644f02ac7d64490d836b995b7d9"
CARRIER_PATH = "operations/scf-wordpress-native-83dd-20261012/carrier.json"
CARRIER_BYTES = 1518325
CARRIER_SHA256 = "3e0a2952d6d4f19c439b704cddef3fbadecfcebd9a2cc92bfba8511b37307444"
OPERATION = "scf-wordpress-native-receiving-83dd-20261012"
SOURCE_REF = "f167c3e524b782ceb6dd196df81f6b97886442a9"
COMMISSIONING_REF = "4c62463acfae23b50fb3327d7eafeb087e8b4806"
PREFIX = "stellar/scf-starforge-20261009/"
ROOT = pathlib.Path("/dev/83dd-wordpress-source-receiver")
SOURCE = pathlib.Path("/dev/83dd-wordpress-release/source")
PUBLIC_NAMES = {"input.json", "prepare.py", "host-selection.json", "launch.py"}
PRIVATE_NAME = "host-finalizer.json"
PRINT_LOCK = threading.Lock()


def emit(event, **fields):
    with PRINT_LOCK:
        print(json.dumps({"bootstrap": event, **fields}, separators=(",", ":")), flush=True)


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha256(raw):
    return hashlib.sha256(raw).hexdigest()


def git_blob(raw):
    return hashlib.sha1(b"blob " + str(len(raw)).encode("ascii") + b"\0" + raw).hexdigest()


def physical_directory(path):
    path = pathlib.Path(path).absolute()
    for part in [*reversed(path.parents), path]:
        require(not part.is_symlink(), "Directory contains a link: " + str(part))
        if part.exists():
            require(part.is_dir(), "Selected directory is another file type: " + str(part))
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    require(path.resolve() == path, "Physical directory selection changed")
    return path


def read_regular(path, maximum):
    path = pathlib.Path(path).absolute()
    require(path.parent.resolve() == path.parent, "File parent contains a link: " + str(path))
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, "rb") as stream:
        require(stat.S_ISREG(os.fstat(stream.fileno()).st_mode), "Selected input is not a regular file")
        raw = stream.read(maximum + 1)
    require(len(raw) <= maximum, "Selected file exceeds its declared size: " + str(path))
    return raw


def retain_exact(path, raw, mode=0o600):
    """Create an exact source file; an existing selection must remain identical."""
    path = pathlib.Path(path).absolute()
    physical_directory(path.parent)
    require(not path.is_symlink(), "Selected file is a link: " + str(path))
    if path.exists():
        require(read_regular(path, len(raw)) == raw, "Retained source differs: " + str(path))
        return False
    descriptor, temporary = tempfile.mkstemp(prefix="." + path.name + ".", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(temporary, mode)
        try:
            os.link(temporary, path)
        except FileExistsError:
            require(read_regular(path, len(raw)) == raw, "Concurrent source selection differs: " + str(path))
        parent_fd = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(parent_fd)
        finally:
            os.close(parent_fd)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    return True


def validate_file(item, raw):
    require(isinstance(item.get("bytes"), int) and not isinstance(item["bytes"], bool),
            "Source byte count is missing")
    require(len(raw) == item["bytes"] and sha256(raw) == item["sha256"],
            "Source identity differs: " + item["name"])
    if item["name"].endswith(".py"):
        ast.parse(raw, filename=item["name"])
    return raw


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, newurl):
        return None


class Downloader:
    """Unauthenticated immutable public reads, with a shared provider retry clock."""
    def __init__(self, enabled=True):
        self.enabled = enabled
        self.lock = threading.Lock()
        self.next_read = 0.0

    def wait(self):
        while True:
            with self.lock:
                remaining = self.next_read - time.time()
            if remaining <= 0:
                return
            time.sleep(min(remaining, 10.0))

    def defer(self, headers, attempt):
        delay = min(2 ** attempt, 10)
        retry = headers.get("Retry-After")
        if retry:
            try:
                delay = max(delay, float(retry))
            except ValueError:
                try:
                    delay = max(delay, email.utils.parsedate_to_datetime(retry).timestamp() - time.time())
                except (TypeError, ValueError, OverflowError):
                    pass
        if headers.get("X-RateLimit-Remaining") == "0":
            try:
                delay = max(delay, float(headers["X-RateLimit-Reset"]) - time.time())
            except (KeyError, ValueError):
                pass
        with self.lock:
            self.next_read = max(self.next_read, time.time() + max(0, delay))
        return max(0, delay)

    def get(self, url, maximum):
        require(self.enabled, "Pinned public source is missing from the selected local cache")
        require(url.startswith("https://raw.githubusercontent.com/" + REPOSITORY + "/"),
                "Download must use the original public repository")
        for attempt in range(1, 4):
            self.wait()
            try:
                request = urllib.request.Request(
                    url, headers={"User-Agent": "tjlabs-scf-native-bootstrap/1", "Accept-Encoding": "identity"})
                # Each worker owns its opener; no credentials or private headers are used.
                with urllib.request.build_opener(NoRedirect()).open(request, timeout=45) as response:
                    require(response.status == 200, "Public source returned an unexpected status")
                    raw = response.read(maximum + 1)
                require(len(raw) <= maximum, "Public source exceeds its declared envelope")
                return raw
            except urllib.error.HTTPError as error:
                headers = {name: error.headers[name] for name in (
                    "Retry-After", "X-RateLimit-Limit", "X-RateLimit-Remaining",
                    "X-RateLimit-Reset", "X-RateLimit-Resource") if error.headers.get(name) is not None}
                can_retry = error.code in {408, 429, 502, 503, 504} or (
                    error.code == 403 and headers.get("X-RateLimit-Remaining") == "0")
                delay = self.defer(headers, attempt) if can_retry and attempt < 3 else None
                emit("public-read-error", url=url, status=error.code, headers=headers,
                     attempt=attempt, retry_seconds=delay)
                error.close()
                if not can_retry or attempt == 3:
                    raise
            except (urllib.error.URLError, TimeoutError, ConnectionError) as error:
                emit("public-transport-error", url=url, error=type(error).__name__, attempt=attempt)
                if attempt == 3:
                    raise
                self.defer({}, attempt)
        raise RuntimeError("Public source retrieval ended without a response")


def raw_url(ref, path):
    return ("https://raw.githubusercontent.com/" + REPOSITORY + "/" + ref + "/" +
            urllib.parse.quote(path, safe="/"))


def receive_frame(event, maximum, **fields):
    if sys.stdin.isatty():
        import tty
        tty.setraw(sys.stdin.fileno())
    emit(event, operation_id=OPERATION, **fields)
    raw = bytearray()
    while len(raw) <= maximum:
        part = os.read(sys.stdin.fileno(), 1)
        require(part, "Source input ended before its complete JSON line")
        if part == b"\n":
            break
        raw.extend(part)
    require(len(raw) <= maximum, "Source envelope exceeds its declared maximum")
    value = json.loads(raw)
    require(isinstance(value, dict), "Receive one JSON object")
    return value


def load_carrier(path, downloader, from_stdin=False):
    if from_stdin:
        frame = receive_frame("awaiting-carrier-input", CARRIER_BYTES * 6 + 4096,
                              name="carrier.json", bytes=CARRIER_BYTES, sha256=CARRIER_SHA256,
                              format="one JSON line with name and content")
        require(set(frame) == {"name", "content"} and frame["name"] == "carrier.json"
                and isinstance(frame["content"], str), "Receive the exact original public carrier")
        raw = frame["content"].encode("utf-8")
    elif path is None:
        sibling = pathlib.Path(__file__).absolute().parent / "carrier.json"
        raw = read_regular(sibling, CARRIER_BYTES) if sibling.is_file() else downloader.get(
            raw_url(CARRIER_REF, CARRIER_PATH), CARRIER_BYTES)
    else:
        raw = read_regular(path, CARRIER_BYTES)
    require(len(raw) == CARRIER_BYTES and sha256(raw) == CARRIER_SHA256,
            "Carrier differs from the reviewed immutable commit")
    carrier = json.loads(raw)
    require(carrier["schema"] == "stellar-forge.wordpress-native-carrier.v1" and
            carrier["operationId"] == OPERATION and carrier["sourceRef"] == SOURCE_REF and
            carrier["commissioningRef"] == COMMISSIONING_REF, "Original carrier selection differs")
    public = carrier["files"]
    require(len(public) == 4 and {item["name"] for item in public} == PUBLIC_NAMES,
            "The reviewed four public source inputs are required")
    private = carrier["privateInputs"]
    require(len(private) == 1 and private[0]["name"] == PRIVATE_NAME, "Original private input differs")
    for item in public:
        validate_file(item, item["content"].encode("utf-8"))
    launch = next(item for item in public if item["name"] == "launch.py")
    require(all(carrier["courierSource"][key] == launch[key] for key in ("name", "bytes", "sha256")),
            "Courier source binding differs")
    return carrier, raw


def receive_private(item, selected, use_stdin):
    if selected is not None:
        return validate_file(item, read_regular(selected, item["bytes"]))
    retained = ROOT / PRIVATE_NAME
    if not use_stdin and retained.exists():
        return validate_file(item, read_regular(retained, item["bytes"]))
    # No buffering crosses the eventual exec; later courier controls stay on stdin.
    frame = receive_frame("awaiting-private-input", item["bytes"] * 6 + 4096,
                          name=PRIVATE_NAME, bytes=item["bytes"], sha256=item["sha256"],
                          format="one JSON line with name and content")
    require(isinstance(frame, dict) and set(frame) == {"name", "content"} and
            frame["name"] == PRIVATE_NAME and isinstance(frame["content"], str),
            "Receive exactly the original private source name and UTF-8 content")
    return validate_file(item, frame["content"].encode("utf-8"))


def prepare_once():
    process = subprocess.Popen(
        [sys.executable, "-B", str(ROOT / "prepare.py")],
        stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
        env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1", "GIT_NO_LAZY_FETCH": "1",
             "GIT_OPTIONAL_LOCKS": "0", "GIT_TERMINAL_PROMPT": "0"})
    for line in process.stdout:
        emit("preparation-output", line=line.rstrip("\n"))
    code = process.wait()
    require(code == 0, "Original source/host preparation returned " + str(code))
    report = json.loads(read_regular(ROOT / "SOURCE_CLOSURE.json", 8 * 1024 * 1024))
    require(report["sourceRef"] == SOURCE_REF and report["commissioningRef"] == COMMISSIONING_REF and
            report["directory"] == str(SOURCE) and isinstance(report["missing"], dict),
            "Original source closure selection differs")
    require((ROOT / "HOST_CLOSURE.json").is_file(), "Original host closure was not prepared")
    emit("source-closure", files=len(report["files"]), bytes=report["bytes"],
         missing=len(report["missing"]), manifest=str(ROOT / "SOURCE_CLOSURE.json"))
    return report


def validate_dependency(name, expected, inputs):
    require(isinstance(name, str) and name.startswith(PREFIX), "Source is outside the original project")
    path = pathlib.PurePosixPath(name)
    require(not path.is_absolute() and str(path) == name and ".." not in path.parts,
            "Original source path is not canonical")
    declared = inputs["files"].get(name)
    require(isinstance(declared, dict), "Missing source is outside original metadata")
    blob = inputs.get("overlayBlobs", {}).get(name, declared.get("sha"))
    require(expected.get("sha") == blob and isinstance(blob, str) and len(blob) == 40,
            "Missing source Git identity differs")
    size = declared.get("size")
    if expected.get("bytes") is not None:
        require(size == expected["bytes"], "Missing source byte count differs")
    require(size is None or (isinstance(size, int) and not isinstance(size, bool) and 0 <= size <= 32*1024*1024),
            "Original source size is outside the receiving envelope")
    return blob, size


def retained_dependency(name, expected, inputs, cache):
    blob, size = validate_dependency(name, expected, inputs)
    maximum = size if size is not None else 32 * 1024 * 1024
    target = SOURCE / name
    for root in [SOURCE, *([cache] if cache is not None else [])]:
        path = root / name
        if path.is_file() and not path.is_symlink():
            raw = read_regular(path, maximum)
            if (size is None or len(raw) == size) and git_blob(raw) == blob:
                written = retain_exact(target, raw, 0o755 if inputs["files"][name].get("mode") == "100755" else 0o644)
                return {"path": name, "bytes": len(raw), "origin": "retained", "written": written}
    return None


def fill_dependency(name, expected, inputs, downloader, cache):
    retained = retained_dependency(name, expected, inputs, cache)
    if retained is not None:
        return retained
    blob, size = validate_dependency(name, expected, inputs)
    maximum = size if size is not None else 32 * 1024 * 1024
    target = SOURCE / name
    # Every commissioned override is already a complete captured source input.
    require(name not in inputs["special"] and name not in inputs.get("overlayBlobs", {}),
            "A complete captured source must be recovered from its original input")
    raw = downloader.get(raw_url(SOURCE_REF, name), maximum)
    require((size is None or len(raw) == size) and git_blob(raw) == blob,
            "Downloaded original Git source differs: " + name)
    raw.decode("utf-8")
    written = retain_exact(target, raw, 0o755 if inputs["files"][name].get("mode") == "100755" else 0o644)
    return {"path": name, "bytes": len(raw), "origin": "pinned-public-source", "written": written}


def receive_sources(missing, inputs):
    selections = {name: validate_dependency(name, item, inputs) for name, item in missing.items()}
    declared = sum((size if size is not None else 32 * 1024 * 1024) for _, size in selections.values())
    maximum = min(128 * 1024 * 1024, declared * 6 + len(missing) * 4096 + 8192)
    frame = receive_frame("awaiting-source-input", maximum,
                          missing=missing, format="one JSON line with sources: [{path, content}]")
    require(set(frame) == {"sources"} and isinstance(frame["sources"], list),
            "Receive the original requested source members")
    values = frame["sources"]
    require(len(values) == len(missing), "Source bundle must contain every requested member exactly once")
    validated = {}
    for item in values:
        require(isinstance(item, dict) and set(item) == {"path", "content"} and
                isinstance(item["path"], str) and isinstance(item["content"], str),
                "Source member must contain only path and UTF-8 content")
        name = item["path"]
        require(name in selections and name not in validated, "Source bundle contains another or repeated member")
        raw = item["content"].encode("utf-8")
        blob, size = selections[name]
        require((size is None or len(raw) == size) and git_blob(raw) == blob,
                "Received original source identity differs: " + name)
        validated[name] = raw
    require(set(validated) == set(missing), "Original source bundle membership differs")
    # Validate the whole requested selection before materializing any member.
    for name, raw in validated.items():
        retain_exact(SOURCE / name, raw, 0o755 if inputs["files"][name].get("mode") == "100755" else 0o644)
    emit("source-round", received=len(validated), bytes=sum(len(raw) for raw in validated.values()),
         failures=[], origin="received-original-source")
    return len(validated)


def complete_sources(inputs, downloader, cache, workers, source_stdin=False):
    previous = None
    while True:
        report = prepare_once()
        missing = report["missing"]
        if not missing:
            return report
        signature = (len(report["files"]), tuple(sorted((name, item["sha"]) for name, item in missing.items())))
        require(signature != previous, "Original dependency preparation made no progress")
        previous = signature
        if source_stdin:
            retained = []
            for name, expected in missing.items():
                item = retained_dependency(name, expected, inputs, cache)
                if item is not None:
                    retained.append(item)
            if retained:
                emit("source-round", received=len(retained), bytes=sum(item["bytes"] for item in retained),
                     failures=[], origin="retained-source-cache")
                continue
            receive_sources(missing, inputs)
            continue
        complete = []
        failures = []
        with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
            futures = {pool.submit(fill_dependency, name, expected, inputs, downloader, cache): name
                       for name, expected in missing.items()}
            for future in concurrent.futures.as_completed(futures):
                try:
                    complete.append(future.result())
                except Exception as error:
                    failures.append({"path": futures[future], "error": type(error).__name__,
                                     "message": str(error)[:500]})
                if (len(complete) + len(failures)) % 25 == 0:
                    emit("source-receiving", complete=len(complete), failed=len(failures), selected=len(missing))
        emit("source-round", received=len(complete), bytes=sum(item["bytes"] for item in complete),
             failures=failures, workers=workers)
        require(not failures, "Public source receiving requires the reported original paths; retained bytes remain available")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    carrier_input = parser.add_mutually_exclusive_group()
    carrier_input.add_argument("--carrier", type=pathlib.Path, help="An exact local copy of the pinned public carrier")
    carrier_input.add_argument("--carrier-stdin", action="store_true", help="Receive the pinned public carrier as one JSON line")
    private = parser.add_mutually_exclusive_group()
    private.add_argument("--host-finalizer", type=pathlib.Path, help="The exact private fifth source input")
    private.add_argument("--host-finalizer-stdin", action="store_true", help="Receive that original input as one private JSON line")
    parser.add_argument("--source-cache", type=pathlib.Path, help="Optional retained source tree, verified by original Git blob")
    parser.add_argument("--source-stdin", action="store_true", help="Receive each requested original dependency bundle on stdin")
    parser.add_argument("--no-network", action="store_true", help="Use only exact retained inputs and sources")
    parser.add_argument("--workers", type=int, choices=range(1, 5), default=4)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--prepare-only", action="store_true")
    mode.add_argument("--status", action="store_true")
    mode.add_argument("--restore", type=pathlib.Path, metavar="ARCHIVE")
    mode.add_argument("--restore-checkpoint", type=pathlib.Path, metavar="CHECKPOINT")
    parser.add_argument("--sha256", help="Actual selected archive or checkpoint digest")
    args = parser.parse_args(argv)
    require(bool(args.sha256) == bool(args.restore or args.restore_checkpoint),
            "Select --sha256 exactly when restoring the original archive or checkpoint")
    downloader = Downloader(enabled=not args.no_network)
    physical_directory(ROOT)
    physical_directory(SOURCE)
    lock_fd = os.open(ROOT / ".bootstrap.lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(lock_fd, "a+b") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        carrier, carrier_raw = load_carrier(args.carrier, downloader, args.carrier_stdin)
        host = receive_private(carrier["privateInputs"][0], args.host_finalizer, args.host_finalizer_stdin)
        inputs = json.loads(next(item["content"] for item in carrier["files"] if item["name"] == "input.json"))
        require(inputs["sourceRef"] == SOURCE_REF and inputs["commissioningRef"] == COMMISSIONING_REF,
                "Original source metadata differs")
        for item in carrier["files"]:
            retain_exact(ROOT / item["name"], item["content"].encode("utf-8"))
        retain_exact(ROOT / PRIVATE_NAME, host)
        retain_exact(ROOT / "carrier-pinned.json", carrier_raw)
        emit("five-inputs-retained", operation_id=OPERATION, carrier_sha256=CARRIER_SHA256,
             files=[{"name": item["name"], "bytes": item["bytes"], "sha256": item["sha256"]}
                    for item in [*carrier["files"], carrier["privateInputs"][0]]])
        report = complete_sources(inputs, downloader, args.source_cache, args.workers, args.source_stdin)
        emit("preparation-complete", operation_id=OPERATION, files=len(report["files"]),
             bytes=report["bytes"], source_ref=SOURCE_REF, commissioning_ref=COMMISSIONING_REF)
        if args.prepare_only:
            return 0
    options = []
    if args.status:
        options = ["--status"]
    elif args.restore:
        options = ["--restore", str(args.restore.absolute()), "--sha256", args.sha256]
    elif args.restore_checkpoint:
        options = ["--restore-checkpoint", str(args.restore_checkpoint.absolute()), "--sha256", args.sha256]
    emit("enter-original-courier", operation_id=OPERATION, pid=os.getpid(), mode=options or ["original-operation"])
    # One process becomes the existing courier. It owns registration, native recovery,
    # unmodified checkpoint frames, the supervisor finalizer and full result custody.
    os.execv(sys.executable, [sys.executable, "-B", str(ROOT / "launch.py"), *options])


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        emit("error", operation_id=OPERATION, error=type(error).__name__, message=str(error)[:1500],
             errno=getattr(error, "errno", None), filename=getattr(error, "filename", None))
        raise SystemExit(74)
