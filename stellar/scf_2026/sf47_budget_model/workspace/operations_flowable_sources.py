"""Flowable source sidecars on the original authenticated SF47 case.

The original Node service owns archive/source inspection and preparation requests.
This bridge streams complete files, verifies original case/Workshare selections,
and returns the original Installation preview. It never saves an Installation.
"""
from __future__ import annotations

from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import stat
import subprocess
import time
import uuid
import zipfile
from urllib.parse import parse_qs

from model import Problem, canonical
import operations_installations as installations
import operations_workshare_installations as workshares

SCHEMA = "stellar-forge.flowable-source-desk.v1"
SERVICE_SCHEMA = "stellar-forge.flowable-installation-preparation-service.v1.result"
MAX_ARCHIVE = 256 * 1024 * 1024
MAX_EXPORT = 8 * 1024 * 1024 * 1024
MAX_JSON = 64 * 1024 * 1024
MAX_INPUT = 8 * 1024 * 1024
TIMEOUT = 1800
CASE = re.compile(r"operation-[a-f0-9]{32}")
UUID = re.compile(r"[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}")
SHA = re.compile(r"[a-f0-9]{64}")
ROUTE = re.compile(r"^/api/operations/(operation-[a-f0-9]{32})/flowable-sources(?:/(.*))?$")
ACTIONS = {"catalogue", "inspect", "template", "prepare"}
KINDS = {"archive", "seed", "bindings", "commissioning", "attachment"}
FIELDS = {
    "catalogue": {"requestId", "archiveId"},
    "inspect": {"requestId", "archiveId", "programmeId", "programmeRevision",
                "expectedProgrammeSha256", "expectedBasisSha256"},
    "template": {"requestId", "inspectionId", "seedId", "commissioningId", "nativeCaseId",
                 "expectedVersion"},
    "prepare": {"requestId", "inspectionId", "seedId", "bindingsId", "commissioningId",
                "nativeCaseId", "attachments", "expectedVersion"},
}


def fail(message, code="FLOWABLE_SOURCE_INPUT", status=422):
    raise Problem(message, status, code)


def require(condition, message, code="FLOWABLE_SOURCE_INPUT", status=422):
    if not condition:
        fail(message, code, status)


def _json(raw):
    return json.loads(raw, parse_constant=lambda value: (_ for _ in ()).throw(ValueError(value)))


def _sync(directory):
    fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def _directory(path):
    try:
        os.mkdir(path, 0o700)
        _sync(path.parent)
    except FileExistsError:
        pass
    value = os.lstat(path)
    require(stat.S_ISDIR(value.st_mode) and value.st_uid == os.getuid() and
            not value.st_mode & 0o077 and path.resolve() == path,
            "Keep the original private case source directory.", "FLOWABLE_SOURCE_DIRECTORY", 409)
    return path


def _root(ops, case_id):
    require(isinstance(case_id, str) and CASE.fullmatch(case_id),
            "Select the existing original Operations case.")
    with ops._snapshot():
        ops._context(case_id)  # Existing case authority precedes sidecar creation.
    root = Path(ops.workspace.root).absolute()
    require(root.resolve() == root and (root / "planning.sqlite3").is_file(),
            "Open the existing original Grant workspace.")
    parent = _directory(root / "flowable-source-desk")
    return _directory(parent / case_id)


def _identity(st):
    return st.st_dev, st.st_ino, st.st_size, st.st_mtime_ns, st.st_ctime_ns


def _read(path, limit=MAX_JSON):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        before = os.fstat(fd)
        require(stat.S_ISREG(before.st_mode) and before.st_uid == os.getuid() and
                not before.st_mode & 0o077 and before.st_size <= limit,
                "Use one complete private original source file.")
        chunks, size = [], 0
        while True:
            chunk = os.read(fd, min(262144, limit - size + 1))
            if not chunk:
                break
            size += len(chunk)
            require(size <= limit, "The complete original file exceeds its declared capacity.", status=413)
            chunks.append(chunk)
        after = os.fstat(fd)
        named = os.lstat(path)
        require(_identity(before) == _identity(after) and
                (named.st_dev, named.st_ino) == (before.st_dev, before.st_ino) and size == before.st_size,
                "The original file changed during reading.", "FLOWABLE_SOURCE_CHANGED", 409)
        return b"".join(chunks)
    finally:
        os.close(fd)


def _publish(path, raw):
    """Retain exact owner inputs without replacing any existing source."""
    try:
        existing = _read(path, max(MAX_JSON, len(raw)))
    except FileNotFoundError:
        existing = None
    if existing is not None:
        require(existing == raw, "This request ID retains different complete input.",
                "FLOWABLE_SOURCE_REQUEST_CHANGED", 409)
        return path
    temporary = path.parent / ("." + path.name + ".pending-" + str(uuid.uuid4()))
    fd = None
    try:
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        view = memoryview(raw)
        while view:
            count = os.write(fd, view)
            require(count > 0, "The original input write did not advance.")
            view = view[count:]
        os.fsync(fd)
        os.close(fd)
        fd = None
        try:
            os.link(temporary, path, follow_symlinks=False)
        except FileExistsError:
            require(_read(path, max(MAX_JSON, len(raw))) == raw,
                    "The retained original request has different bytes.", "FLOWABLE_SOURCE_REQUEST_CHANGED", 409)
        _sync(path.parent)
    finally:
        if fd is not None:
            os.close(fd)
        try:
            temporary.unlink()
            _sync(path.parent)
        except FileNotFoundError:
            pass
    return path


def _cli():
    selected = os.environ.get("GRANT_FLOWABLE_NODE", "node")
    node = shutil.which(selected)
    require(node is not None, "Select the installed original Node runtime.",
            "FLOWABLE_SOURCE_ENGINE_UNAVAILABLE", 503)
    script = Path(__file__).resolve().parents[2] / "sf49_data_commissioning" / \
             "installation-workorders" / "flowable-installation" / "service-cli.mjs"
    require(script.is_file(), "The selected package lacks the original Flowable service CLI.",
            "FLOWABLE_SOURCE_ENGINE_UNAVAILABLE", 503)
    return str(Path(node).resolve()), str(script)


def _stop(child):
    if child.poll() is not None:
        return
    try:
        os.killpg(child.pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    try:
        child.wait(timeout=15)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(child.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        child.wait()


def _engine(ops, case_id, action, value):
    root = _root(ops, case_id)
    calls = _directory(root / "bridge")
    body = {"action": action, "input": value,
            "context": {"caseId": case_id, "workspaceDirectory": str(Path(ops.workspace.root).resolve())}}
    raw = (canonical(body) + "\n").encode("utf-8")
    require(len(raw) <= MAX_INPUT, "The complete request exceeds its original JSON capacity.", status=413)
    request = value.get("requestId") if isinstance(value, dict) else None
    token = hashlib.sha256(raw).hexdigest()
    input_path = _publish(calls / (token + ".json"), raw)
    attempt = str(uuid.uuid4())
    output_path, error_path = calls / (attempt + ".stdout"), calls / (attempt + ".stderr")
    output = errors = child = None
    try:
        output = open(output_path, "xb", buffering=0)
        os.chmod(output_path, 0o600)
        errors = open(error_path, "xb", buffering=0)
        os.chmod(error_path, 0o600)
        node, cli = _cli()
        child = subprocess.Popen([node, cli, "--directory", str(root / "service"),
                                  "--input", str(input_path)],
                                 stdin=subprocess.DEVNULL, stdout=output, stderr=errors,
                                 start_new_session=True)
        try:
            child.wait(timeout=TIMEOUT)
        except subprocess.TimeoutExpired as exc:
            _stop(child)
            raise Problem("The original request did not return in its time budget. Keep its UUID and recover "
                          "the saved service request before retrying.", 504, "FLOWABLE_SOURCE_OUTCOME_UNKNOWN") from exc
        output.flush()
        errors.flush()
        os.fsync(output.fileno())
        os.fsync(errors.fileno())
        raw_result = _read(output_path, MAX_JSON)
        if child.returncode:
            diagnostic = _read(error_path, MAX_JSON)
            try:
                error = _json(diagnostic)
            except (ValueError, UnicodeError):
                error = {}
            code = error.get("code") if isinstance(error, dict) else None
            message = error.get("message") if isinstance(error, dict) else None
            status = error.get("status") if isinstance(error, dict) else None
            definite = (code == "FLOWABLE_SOURCE_DESK_INPUT" and isinstance(status, int) and
                        not isinstance(status, bool) and status in (400, 409, 413, 415, 422))
            fail(str(message or "The original Flowable request did not return a complete result.")[:12000],
                 str(code or "FLOWABLE_SOURCE_ENGINE_FAILED"), status if definite else 502)
        try:
            result = _json(raw_result)
        except (ValueError, UnicodeError) as exc:
            raise Problem("The original Flowable service returned no complete JSON result.", 502,
                          "FLOWABLE_SOURCE_ENGINE_RESPONSE") from exc
        require(isinstance(result, (dict, list)) or result is None,
                "Keep the original service response shape.", "FLOWABLE_SOURCE_ENGINE_RESPONSE", 502)
        return result
    finally:
        if child is not None:
            _stop(child)
        if output is not None:
            output.close()
        if errors is not None:
            errors.close()


def _descriptor(ops, case_id, value):
    require(isinstance(value, dict) and isinstance(value.get("file"), dict) and isinstance(value.get("path"), str),
            "The original service did not return its owned file descriptor.", "FLOWABLE_SOURCE_FILE", 502)
    file, path = deepcopy(value["file"]), Path(value["path"])
    root = _root(ops, case_id)
    original_path = path.is_relative_to(root / "service") or (
        file.get("kind") == "preparation-archive" and path.is_relative_to(root / "exports"))
    maximum = MAX_EXPORT if file.get("kind") == "preparation-archive" else MAX_ARCHIVE
    require(path.is_absolute() and path.resolve() == path and original_path and
            isinstance(file.get("sha256"), str) and SHA.fullmatch(file["sha256"]) and
            isinstance(file.get("bytes"), int) and not isinstance(file["bytes"], bool) and
            0 <= file["bytes"] <= maximum,
            "The complete original file descriptor is outside this case source sidecar.",
            "FLOWABLE_SOURCE_FILE", 502)
    # Native source member paths remain in ordinary metadata; never expose a host path.
    file.pop("path", None)
    return file, path


def _verified_handle(ops, case_id, descriptor):
    file, path = _descriptor(ops, case_id, descriptor)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        before = os.fstat(fd)
        require(stat.S_ISREG(before.st_mode) and before.st_uid == os.getuid() and
                not before.st_mode & 0o077 and before.st_size == file["bytes"],
                "The original file descriptor changed.", "FLOWABLE_SOURCE_CHANGED", 409)
        actual = hashlib.sha256()
        size = 0
        while True:
            block = os.read(fd, 262144)
            if not block:
                break
            actual.update(block)
            size += len(block)
        named = os.lstat(path)
        require(size == file["bytes"] and actual.hexdigest() == file["sha256"] and
                _identity(before) == _identity(os.fstat(fd)) and
                (named.st_dev, named.st_ino) == (before.st_dev, before.st_ino),
                "The complete original file differs from its saved identity.", "FLOWABLE_SOURCE_CHANGED", 409)
        os.lseek(fd, 0, os.SEEK_SET)
        return file, fd, before
    except BaseException:
        os.close(fd)
        raise


def _seed(ops, case_id, body):
    descriptor = _engine(ops, case_id, "file", {"fileId": body["seedId"]})
    file, fd, before = _verified_handle(ops, case_id, descriptor)
    try:
        require(file["bytes"] <= MAX_INPUT, "Keep the original compact Installation seed.", status=413)
        raw = b""
        while len(raw) < file["bytes"]:
            block = os.read(fd, min(262144, file["bytes"] - len(raw)))
            require(bool(block), "The original seed was truncated.")
            raw += block
        require(_identity(before) == _identity(os.fstat(fd)) and hashlib.sha256(raw).hexdigest() == file["sha256"],
                "The original seed changed during reading.", "FLOWABLE_SOURCE_CHANGED", 409)
    finally:
        os.close(fd)
    seed = _json(raw)
    with ops._snapshot():
        context = ops._context(case_id)
        installations._current(context, body.get("expectedVersion"))
        require(isinstance(seed, dict), "Retain the complete original Installation seed.")
        document = installations.normalized(context, seed.get("document"))
        require(bool(document.get("workshare")), "Receive the original commercial Workshare before preparing.")
        workshares.verify_document(ops, context, document)
        require(isinstance(seed, dict) and seed.get("source") == installations._source(context) and
                seed.get("document") == document and seed.get("installationId") is None and
                seed.get("expectedRevision") == 0 and body.get("nativeCaseId") == case_id,
                "The selected seed must retain this exact case, Workshare and original source edition.",
                "FLOWABLE_SOURCE_SEED_CHANGED", 409)
        return installations._source(context)


def perform(ops, case_id, action, body):
    require(action in ACTIONS and isinstance(body, dict) and not set(body) - FIELDS[action],
            "Use the complete declared Flowable source request.")
    request_id = body.get("requestId")
    require(isinstance(request_id, str) and UUID.fullmatch(request_id),
            "Keep the original explicit UUID for this preparation.")
    root = _root(ops, case_id)
    requests = _directory(root / "case-requests")
    retained = (canonical({"schema": SCHEMA, "caseId": case_id, "action": action, "input": body}) + "\n").encode()
    _publish(requests / (request_id + ".json"), retained)
    receipt_path = requests / (request_id + ".result.json")
    try:
        result = _json(_read(receipt_path))
    except FileNotFoundError:
        result = None
    if result is not None:
        return result
    request = {key: deepcopy(value) for key, value in body.items() if key != "expectedVersion"}
    prior = _engine(ops, case_id, "get", {"requestId": request_id})
    recovered = isinstance(prior, dict) and prior.get("status") == "COMPLETE"
    if recovered:
        native_request = prior.get("request", {})
        require(prior.get("type") == action and all(native_request.get(key) == value for key, value in request.items()),
                "The completed native request has different retained input.", "FLOWABLE_SOURCE_REQUEST_CHANGED", 409)
        result = prior
        source = (result.get("installation", {}).get("source") if action == "prepare" else
                  result.get("seed", {}).get("source") if action == "template" else None)
        if action in ("template", "prepare"):
            require(isinstance(source, dict) and source.get("caseId") == case_id and
                    source.get("version") == body.get("expectedVersion"),
                    "The recovered preparation differs from the original case edition.", "FLOWABLE_SOURCE_CHANGED", 409)
    else:
        source = _seed(ops, case_id, body) if action in ("template", "prepare") else None
        result = _engine(ops, case_id, action, request)
    require(isinstance(result, dict) and result.get("schema") == SERVICE_SCHEMA and
            result.get("requestId") == request_id, "Keep the complete same-request native result.",
            "FLOWABLE_SOURCE_ENGINE_RESPONSE", 502)
    result = deepcopy(result)
    result["caseId"] = case_id
    result["status"] = "COMPLETE"
    result["request"] = deepcopy(body)
    if source is not None:
        result["nativeSource"] = source
    if action == "prepare":
        prepared = result.get("installation")
        require(isinstance(prepared, dict) and prepared.get("source") == source,
                "The native preparation differs from the selected original case source.",
                "FLOWABLE_SOURCE_CHANGED", 409)
        with ops._snapshot():
            context = ops._context(case_id)
            if recovered and context["program"]["version"] != body["expectedVersion"]:
                result["nativePreview"] = None
                result["requiresCurrentPreview"] = True
            else:
                result["nativePreview"] = installations.preview(ops, context, prepared["preview"])
    _publish(receipt_path, (canonical(result) + "\n").encode())
    return result


def import_stream(ops, case_id, stream, *, request_id, kind, name, size, sha256):
    require(isinstance(request_id, str) and UUID.fullmatch(request_id) and kind in KINDS,
            "Keep the original upload UUID and declared source kind.")
    require(isinstance(name, str) and 1 <= len(name) <= 200 and name not in (".", "..") and
            not re.search(r"[/\\\x00-\x1f\x7f]", name), "Keep one plain original source filename.")
    maximum = MAX_ARCHIVE if kind in ("archive", "attachment") else (2 * 1024 * 1024 if kind in ("seed", "bindings") else MAX_INPUT)
    require(isinstance(size, int) and not isinstance(size, bool) and 0 <= size <= maximum and
            isinstance(sha256, str) and SHA.fullmatch(sha256),
            "Keep the full declared original byte count and SHA256.", status=413)
    root = _root(ops, case_id)
    inputs = _directory(root / "uploads")
    intent = {"requestId": request_id, "kind": kind, "name": name, "bytes": size, "sha256": sha256}
    _publish(inputs / (request_id + ".json"), (canonical(intent) + "\n").encode())
    target = inputs / (request_id + ".source")
    temporary = inputs / ("." + request_id + ".upload-" + str(uuid.uuid4()))
    fd = None
    try:
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        digest, remaining = hashlib.sha256(), size
        while remaining:
            block = stream.read(min(262144, remaining))
            require(isinstance(block, bytes) and bool(block) and len(block) <= remaining,
                    "The complete original upload was interrupted.", "FLOWABLE_SOURCE_UPLOAD_INCOMPLETE", 400)
            digest.update(block)
            remaining -= len(block)
            view = memoryview(block)
            while view:
                count = os.write(fd, view)
                require(count > 0, "The original upload write did not advance.")
                view = view[count:]
        require(digest.hexdigest() == sha256, "The full uploaded file differs from the declared original SHA256.",
                "FLOWABLE_SOURCE_CHANGED", 409)
        os.fsync(fd)
        os.close(fd)
        fd = None
        try:
            os.link(temporary, target, follow_symlinks=False)
        except FileExistsError:
            old_fd = os.open(target, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
            try:
                before = os.fstat(old_fd)
                require(stat.S_ISREG(before.st_mode) and before.st_size == size,
                        "The retained upload differs.", "FLOWABLE_SOURCE_CHANGED", 409)
                h = hashlib.sha256()
                while True:
                    block = os.read(old_fd, 262144)
                    if not block:
                        break
                    h.update(block)
                require(h.hexdigest() == sha256 and _identity(before) == _identity(os.fstat(old_fd)),
                        "The retained upload differs.", "FLOWABLE_SOURCE_CHANGED", 409)
            finally:
                os.close(old_fd)
        _sync(inputs)
    finally:
        if fd is not None:
            os.close(fd)
        try:
            temporary.unlink()
            _sync(inputs)
        except FileNotFoundError:
            pass
    value = {"requestId": request_id, "kind": kind, "name": name, "path": str(target),
             "expectedSha256": sha256}
    result = _engine(ops, case_id, "import-file", value)
    require(isinstance(result, dict) and result.get("schema") == SERVICE_SCHEMA and
            result.get("requestId") == request_id, "Keep the complete original upload receipt.",
            "FLOWABLE_SOURCE_ENGINE_RESPONSE", 502)
    return {**result, "caseId": case_id}


def lookup(ops, case_id, request_id):
    require(isinstance(request_id, str) and UUID.fullmatch(request_id), "Keep the original request UUID.")
    root = _root(ops, case_id)
    try:
        result = _json(_read(root / "case-requests" / (request_id + ".result.json")))
    except FileNotFoundError:
        result = _engine(ops, case_id, "get", {"requestId": request_id})
    try:
        original = _json(_read(root / "case-requests" / (request_id + ".json")))
    except FileNotFoundError:
        original = None
    if original is not None:
        require(original.get("caseId") == case_id and original.get("input", {}).get("requestId") == request_id,
                "Keep the original same-case request.")
        result = {**result, "caseId": case_id, "type": original["action"],
                  "nativeRequest": result.get("request"), "request": original["input"]}
    return result


def file_descriptor(ops, case_id, *, file_id=None, inspection_id=None, path=None):
    if file_id is not None:
        require(isinstance(file_id, str) and SHA.fullmatch(file_id), "Select an original retained file ID.")
        value = _engine(ops, case_id, "file", {"fileId": file_id})
    else:
        require(isinstance(inspection_id, str) and UUID.fullmatch(inspection_id) and
                isinstance(path, str) and 1 <= len(path) <= 4096 and "\0" not in path,
                "Select the exact original inspected source member.")
        value = _engine(ops, case_id, "source-file", {"inspectionId": inspection_id, "path": path})
    _descriptor(ops, case_id, value)
    return value


def _query(parsed, allowed, required=()):
    query = parse_qs(parsed.query, keep_blank_values=True)
    require(not set(query) - set(allowed) and all(len(v) == 1 for v in query.values()) and
            all(key in query for key in required), "Keep the complete declared original query.")
    return {key: value[0] for key, value in query.items()}


def _download(handler, ops, case_id, descriptor, describe=False):
    started = False
    file, fd, before = _verified_handle(ops, case_id, descriptor)
    try:
        if describe:
            handler.send(200, file)
            return
        name = re.sub(r'[^A-Za-z0-9._ -]', "_", file.get("filename") or "source.bin")
        handler.send_response(200)
        handler.send_header("Content-Type", "application/octet-stream")
        handler.send_header("Content-Length", str(file["bytes"]))
        handler.send_header("Content-Disposition", 'attachment; filename="' + name + '"')
        handler.send_header("Cache-Control", "no-store")
        handler.send_header("X-Content-Type-Options", "nosniff")
        handler.send_header("Content-Security-Policy", "default-src 'none'; sandbox")
        handler.send_header("X-Content-SHA256", file["sha256"])
        handler.end_headers()
        started = True
        if handler.command == "HEAD":
            return
        digest = hashlib.sha256()
        remaining = file["bytes"]
        while remaining:
            block = os.read(fd, min(262144, remaining))
            require(bool(block), "The complete source download was interrupted.")
            digest.update(block)
            remaining -= len(block)
            # The final bytes are withheld until exact end identity is checked.
            if remaining == 0:
                require(digest.hexdigest() == file["sha256"] and _identity(before) == _identity(os.fstat(fd)),
                        "The original source changed during streaming.", "FLOWABLE_SOURCE_CHANGED", 409)
            handler.wfile.write(block)
    except BaseException as exc:
        handler.close_connection = True
        if started:
            raise ConnectionResetError("The complete original download was interrupted.") from exc
        raise
    finally:
        os.close(fd)


def register_static(static):
    static["/operations_flowable_sources.mjs"] = ("operations_flowable_sources.mjs", "text/javascript; charset=utf-8")
    static["/operations_flowable_sources.css"] = ("operations_flowable_sources.css", "text/css; charset=utf-8")
    static["/FLOWABLE_SOURCE_DESK.md"] = ("FLOWABLE_SOURCE_DESK.md", "text/markdown; charset=utf-8")


def handle(handler, parsed, ops, method):
    match = ROUTE.fullmatch(parsed.path)
    if not match:
        return False
    case_id, action = match[1], match[2] or "requests"
    if method == "POST" and action == "import":
        query = _query(parsed, {"requestId", "kind", "name", "bytes", "sha256"},
                       {"requestId", "kind", "name", "bytes", "sha256"})
        require(handler.headers.get_content_type() == "application/octet-stream" and
                not handler.headers.get("Transfer-Encoding") and
                len(handler.headers.get_all("Content-Length", [])) == 1,
                "Send the complete original binary with one Content-Length.", status=415)
        require(query["bytes"].isdigit() and handler.headers["Content-Length"].isdigit() and
                int(query["bytes"]) == int(handler.headers["Content-Length"]),
                "The upload Content-Length differs from its original identity.", status=400)
        value = import_stream(ops, case_id, handler.rfile, request_id=query["requestId"],
                              kind=query["kind"], name=query["name"], size=int(query["bytes"]), sha256=query["sha256"])
        handler.send(200, value)
    elif method == "POST" and action in ACTIONS:
        _query(parsed, set())
        handler.send(200, public_result(perform(ops, case_id, action, handler.json_body())))
    elif method == "GET" and action == "requests":
        query = _query(parsed, {"offset", "limit"})
        value = _engine(ops, case_id, "list", {"offset": int(query.get("offset", "0")),
                                              "limit": int(query.get("limit", "100"))})
        handler.send(200, value)
    elif method == "GET" and re.fullmatch(r"requests/[^/]+/archive.zip", action):
        query = _query(parsed, {"describe"})
        _download(handler, ops, case_id, preparation_archive(ops, case_id, action.split("/")[1]),
                  query.get("describe") == "1")
    elif method == "GET" and action.startswith("requests/"):
        _query(parsed, set())
        handler.send(200, public_result(lookup(ops, case_id, action[len("requests/"):])))
    elif method == "GET" and action.startswith("files/"):
        query = _query(parsed, {"describe"})
        _download(handler, ops, case_id, file_descriptor(ops, case_id, file_id=action[len("files/"):]),
                  query.get("describe") == "1")
    elif method == "GET" and re.fullmatch(r"sources/[^/]+/file", action):
        query = _query(parsed, {"path", "describe"}, {"path"})
        _download(handler, ops, case_id, file_descriptor(ops, case_id, inspection_id=action.split("/")[1],
                                                       path=query["path"]), query.get("describe") == "1")
    else:
        fail("Use the declared original Flowable source route.", "FLOWABLE_SOURCE_ROUTE", 405)
    return True


def export_file(ops, case_id, destination, expected_sha256, *, file_id=None, inspection_id=None, path=None):
    """Stream one exact original file to an explicit create-only terminal output."""
    descriptor = file_descriptor(ops, case_id, file_id=file_id, inspection_id=inspection_id, path=path)
    return export_descriptor(ops, case_id, descriptor, destination, expected_sha256)


def export_descriptor(ops, case_id, descriptor, destination, expected_sha256):
    file, source_fd, before = _verified_handle(ops, case_id, descriptor)
    require(file["sha256"] == expected_sha256, "Select the reviewed original download SHA256.",
            "FLOWABLE_SOURCE_CHANGED", 409)
    target = Path(destination).expanduser().absolute()
    require(target.parent.resolve() == target.parent and target.parent.is_dir(),
            "Select an existing canonical output directory.")
    temporary = target.parent / ("." + target.name + ".flowable-" + str(uuid.uuid4()))
    fd = None
    try:
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        digest, size = hashlib.sha256(), 0
        while True:
            block = os.read(source_fd, 262144)
            if not block:
                break
            size += len(block)
            require(size <= file["bytes"], "The source download grew.")
            digest.update(block)
            view = memoryview(block)
            while view:
                count = os.write(fd, view)
                require(count > 0, "The complete output write did not advance.")
                view = view[count:]
        require(size == file["bytes"] and digest.hexdigest() == file["sha256"] and
                _identity(before) == _identity(os.fstat(source_fd)),
                "The complete original source changed during export.", "FLOWABLE_SOURCE_CHANGED", 409)
        os.fsync(fd)
        os.close(fd)
        fd = None
        try:
            os.link(temporary, target, follow_symlinks=False)
        except FileExistsError:
            old = os.open(target, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
            try:
                first = os.fstat(old)
                require(stat.S_ISREG(first.st_mode) and first.st_size == size,
                        "The destination retains a different complete file.", "FLOWABLE_SOURCE_CHANGED", 409)
                h = hashlib.sha256()
                while True:
                    block = os.read(old, 262144)
                    if not block:
                        break
                    h.update(block)
                require(h.hexdigest() == file["sha256"] and _identity(first) == _identity(os.fstat(old)),
                        "The existing destination differs from this exact output.", "FLOWABLE_SOURCE_CHANGED", 409)
            finally:
                os.close(old)
        _sync(target.parent)
    finally:
        os.close(source_fd)
        if fd is not None:
            os.close(fd)
        try:
            temporary.unlink()
            _sync(target.parent)
        except FileNotFoundError:
            pass
    return {"path": str(target), "filename": target.name, "bytes": file["bytes"], "sha256": file["sha256"],
            "original": file}


def public_result(value):
    """Remove only the local receiving-directory capability from HTTP JSON."""
    value = deepcopy(value)
    if isinstance(value, dict) and isinstance(value.get("readyReceiving"), dict):
        value["readyReceiving"].pop("preparationDirectory", None)
    return value


def preparation_archive(ops, case_id, request_id):
    """Bundle the same full original preparation; the existing receiver adopts it."""
    require(isinstance(request_id, str) and UUID.fullmatch(request_id), "Keep the original preparation UUID.")
    result = lookup(ops, case_id, request_id)
    require(result.get("schema") == SERVICE_SCHEMA and result.get("type") == "prepare" and
            isinstance(result.get("files"), list) and result["files"],
            "Complete the original full preparation before downloading it.", "FLOWABLE_SOURCE_NOT_PREPARED", 409)
    root = _root(ops, case_id)
    directory = Path(result.get("readyReceiving", {}).get("preparationDirectory", ""))
    require(directory.is_absolute() and directory.resolve() == directory and
            directory.is_relative_to(root / "service"),
            "Keep the original service-owned complete preparation directory.", "FLOWABLE_SOURCE_FILE", 409)
    manifest_name = "FLOWABLE_PREPARATION_ARCHIVE.json"
    files, names, total = [], set(), 0
    for row in result["files"]:
        require(isinstance(row, dict) and isinstance(row.get("name"), str),
                "Preserve every original prepared file descriptor.")
        name = row["name"]
        require(name and not name.startswith("/") and "\\" not in name and "\0" not in name and
                all(part not in ("", ".", "..") for part in name.split("/")) and
                name not in names and name != manifest_name,
                "Preserve distinct complete original preparation-relative paths.")
        require(isinstance(row.get("bytes"), int) and not isinstance(row["bytes"], bool) and
                0 <= row["bytes"] <= MAX_ARCHIVE and SHA.fullmatch(row.get("sha256", "")),
                "Keep each full original prepared byte identity.")
        names.add(name)
        total += row["bytes"]
        files.append(deepcopy(row))
    manifest = {"schema": SCHEMA + ".preparation-archive", "caseId": case_id, "requestId": request_id,
                "preparationSha256": result.get("preparationSha256"), "files": files,
                "preparation": public_result(result),
                "receiving": "Use the unchanged runFlowableInstallationReceiving with all original preparation files."}
    manifest_raw = (canonical(manifest) + "\n").encode()
    require(total + len(manifest_raw) <= MAX_EXPORT, "The complete original receiving archive exceeds eight GiB.", status=413)
    exports = _directory(root / "exports")
    target, receipt_path = exports / (request_id + ".zip"), exports / (request_id + ".json")
    manifest_sha = hashlib.sha256(manifest_raw).hexdigest()
    try:
        receipt = _json(_read(receipt_path))
    except FileNotFoundError:
        receipt = None
    if receipt is not None:
        require(receipt.get("manifestSha256") == manifest_sha,
                "The retained preparation archive belongs to a different complete source.", "FLOWABLE_SOURCE_CHANGED", 409)
        descriptor = {"path": str(target), "file": receipt["file"]}
        _, fd, _ = _verified_handle(ops, case_id, descriptor)
        os.close(fd)
        return descriptor
    temporary = exports / ("." + request_id + ".zip-pending-" + str(uuid.uuid4()))
    handle = None
    try:
        fd = os.open(temporary, os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        handle = os.fdopen(fd, "w+b")
        with zipfile.ZipFile(handle, "w", compression=zipfile.ZIP_STORED, allowZip64=True) as archive:
            for row in files:
                path = directory.joinpath(*row["name"].split("/"))
                descriptor = {"path": str(path), "file": {**row, "filename": row["name"]}}
                _, original, before = _verified_handle(ops, case_id, descriptor)
                try:
                    info = zipfile.ZipInfo(row["name"], date_time=(1980, 1, 1, 0, 0, 0))
                    info.compress_type = zipfile.ZIP_STORED
                    info.external_attr = 0o100600 << 16
                    info.file_size = row["bytes"]
                    digest, count = hashlib.sha256(), 0
                    with archive.open(info, "w", force_zip64=True) as out:
                        while True:
                            block = os.read(original, 262144)
                            if not block:
                                break
                            digest.update(block)
                            count += len(block)
                            require(count <= row["bytes"], "The prepared member grew during archive receiving.")
                            out.write(block)
                    require(count == row["bytes"] and digest.hexdigest() == row["sha256"] and
                            _identity(before) == _identity(os.fstat(original)),
                            "An original prepared member changed during archive receiving.", "FLOWABLE_SOURCE_CHANGED", 409)
                finally:
                    os.close(original)
            info = zipfile.ZipInfo(manifest_name, date_time=(1980, 1, 1, 0, 0, 0))
            info.external_attr = 0o100600 << 16
            archive.writestr(info, manifest_raw)
        handle.flush()
        os.fsync(handle.fileno())
        size = os.fstat(handle.fileno()).st_size
        require(size <= MAX_EXPORT, "The complete ZIP framing exceeds eight GiB.", status=413)
        handle.seek(0)
        with zipfile.ZipFile(handle, "r") as archive:
            members = archive.infolist()
            require([m.filename for m in members] == [row["name"] for row in files] + [manifest_name] and
                    [m.file_size for m in members] == [row["bytes"] for row in files] + [len(manifest_raw)] and
                    archive.read(manifest_name) == manifest_raw,
                    "The complete preparation ZIP did not reopen with its original inventory.")
        handle.seek(0)
        digest = hashlib.sha256()
        while True:
            block = handle.read(262144)
            if not block:
                break
            digest.update(block)
        file = {"schema": SCHEMA + ".file", "id": digest.hexdigest(), "fileId": digest.hexdigest(), "kind": "preparation-archive",
                "filename": "Flowable_Preparation_" + request_id + ".zip", "name": target.name,
                "bytes": size, "sha256": digest.hexdigest()}
        handle.close()
        handle = None
        try:
            os.link(temporary, target, follow_symlinks=False)
        except FileExistsError:
            _, previous, _ = _verified_handle(ops, case_id, {"path": str(target), "file": file})
            os.close(previous)
        _sync(exports)
        _publish(receipt_path, (canonical({"manifestSha256": manifest_sha, "file": file}) + "\n").encode())
        return {"path": str(target), "file": file}
    finally:
        if handle is not None:
            handle.close()
        try:
            temporary.unlink()
            _sync(exports)
        except FileNotFoundError:
            pass
