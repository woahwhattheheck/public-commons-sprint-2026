#!/usr/bin/env python3
"""Retained watershed migration for the existing USGS Water application. MIT."""
import contextlib
import hashlib
import html
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import time
import zipfile
from watershed_process import run_owned

SCHEMA = "starforge.water-watershed.v1"
HERE = Path(__file__).resolve().parent
ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$")
PATHNAME = re.compile(r"/[^/\r\n<>\"']*/[^/\r\n<>\"']+/[^/\r\n<>\"']+/[^/\r\n<>\"']*/[^/\r\n<>\"']+/[^/\r\n<>\"']*/")
# Quoted, XML text, assigned, and whitespace-delimited DSS filenames. Wider
# lexical forms win; the same original span is never presented twice.
FILE_PATTERNS = [
    re.compile(r'["\']([^"\'\r\n]*?\.dss)["\']', re.I),
    re.compile(r">([^<>\r\n]*?\.dss)\s*<", re.I),
    re.compile(r"(?im)^[ \t]*(?:[^:=\r\n]*?(?:dss|file)[^:=\r\n]*?)[:=][ \t]*([^\r\n]*?\.dss)[ \t]*(?:$|;)"),
    re.compile(r"(?i)([^\s<>\"'=,;()]+\.dss)(?=$|[\s<>\"',;)])"),
]
TEXT_EXT = {".xml", ".hms", ".basin", ".gage", ".met", ".run", ".control", ".prj",
            ".rsv", ".wtr", ".fcast", ".txt", ".json", ".properties", ".ini",
            ".config", ".ctl", ".mim", ".mip", ".rasmap", ".w01", ".u01", ".p01",
            ".py", ".jython", ".bat", ".cmd", ".wtrshd", ".wksp", ".sh", ".csh", ".ps1"}

class WaterError(Exception):
    def __init__(self, message, code="WATER_WATERSHED_INVALID"):
        super().__init__(message)
        self.code = code

def encoded(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False) + "\n").encode("utf-8")

def digest(value):
    return hashlib.sha256(encoded(value)).hexdigest()

def identity(path):
    h = hashlib.sha256()
    size = 0
    with open(path, "rb") as f:
        while True:
            chunk = f.read(1024 * 1024)
            if not chunk:
                break
            h.update(chunk)
            size += len(chunk)
    return {"bytes": size, "sha256": h.hexdigest()}

def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)

def save(path, value, exclusive=False):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    raw = encoded(value)
    if exclusive and path.exists():
        if path.read_bytes() != raw:
            raise WaterError("This saved name already contains different work.", "WATER_WATERSHED_CHANGED")
        with open(path, "rb") as existing: os.fsync(existing.fileno())
        sync_parent(path)
        return value
    fd, tmp = tempfile.mkstemp(prefix=".saving-", dir=str(path.parent))
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(raw)
            f.flush()
            os.fsync(f.fileno())
        os.chmod(tmp, 0o600)
        if exclusive:
            os.link(tmp, path)
            os.unlink(tmp)
        else:
            os.replace(tmp, path)
        sync_parent(path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)
    return value


def sync_parent(path):
    if os.name != "nt":
        fd = os.open(str(Path(path).parent), os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
        try: os.fsync(fd)
        finally: os.close(fd)

def sync_saved(path):
    # These are retained, privately owned copies, never the external source.
    with open(path, "r+b") as stream: os.fsync(stream.fileno())
    sync_parent(path)

def atomic_bytes(path, raw):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, temporary = tempfile.mkstemp(prefix=".writing-", dir=str(path.parent))
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(raw); stream.flush(); os.fsync(stream.fileno())
        os.chmod(temporary, 0o600)
        os.replace(temporary, path); sync_parent(path)
    finally:
        if os.path.exists(temporary): os.unlink(temporary)

def atomic_copy(source, target, expected):
    target = Path(target)
    target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, temporary = tempfile.mkstemp(prefix=".copying-", dir=str(target.parent))
    try:
        with open(source, "rb") as original, os.fdopen(fd, "wb") as copied:
            shutil.copyfileobj(original, copied); copied.flush(); os.fsync(copied.fileno())
        os.chmod(temporary, 0o600)
        if identity(temporary) != expected: raise WaterError("The complete selected source changed during copying.")
        os.replace(temporary, target); sync_parent(target)
    finally:
        if os.path.exists(temporary): os.unlink(temporary)

def verify_native_artifacts(root, result):
    key = result["requestSha256"]
    if not re.fullmatch(r"[0-9a-f]{64}", key): raise WaterError("The native result has another request identity.")
    folder = root / "native" / key
    binding = load(folder / "request.json")
    if digest(binding) != key or result.get("status") != "COMPLETE" or result.get("action") != binding["action"]:
        raise WaterError("The complete native request/result binding changed.")
    sealed = load(folder / "result.json")
    if sealed != result: raise WaterError("The retained complete native result changed.")
    for artifact in result.get("artifacts", []):
        path = within(folder, artifact["file"])
        if identity(path) != {k: artifact[k] for k in ("bytes", "sha256")}:
            raise WaterError("A complete native record artifact changed: " + artifact["file"])
    expected = {row["payload"]["file"] for row in result.get("files", [])}
    if result.get("action") == "convert-verify":
        expected |= {result["original"]["payload"]["file"], result["converted"]["payload"]["file"], "comparison.json"}
    if expected != {row["file"] for row in result.get("artifacts", [])}:
        raise WaterError("The complete native record artifact inventory changed.")
    descriptors = result.get("files", []) if result["action"] == "inventory" else [result["original"], result["converted"]]
    for descriptor in descriptors:
        payload = descriptor["payload"]
        if identity(within(folder, payload["file"])) != {k: payload[k] for k in ("bytes", "sha256")}:
            raise WaterError("A complete native payload descriptor differs from its retained file.")
    for name in ["request.json", "result.json"] + [row["file"] for row in result["artifacts"]]:
        sync_saved(within(folder, name))
    return result

def verify_complete(root, saved=None):
    saved = saved or read_operation(root)
    result = saved.get("result")
    if not result or saved["status"] != "COMPLETE": raise WaterError("The migration is not complete.")
    payload = {k: v for k, v in result.items() if k != "resultSha256"}
    if digest(payload) != result.get("resultSha256") or saved.get("resultSha256") != result["resultSha256"]:
        raise WaterError("The saved complete native result changed.")
    accepted = load(root / "accepted-plan.json")
    if digest({k: v for k, v in accepted.items() if k != "planSha256"}) != accepted["planSha256"] or accepted["planSha256"] != result["planSha256"] or accepted["sourceSha256"] != saved["sourceSha256"]:
        raise WaterError("The complete accepted receiving plan changed.")
    if digest(accepted["review"]) != accepted["reviewSha256"]:
        raise WaterError("The accepted complete review changed.")
    catalog = load(root / "catalog.json")
    if digest(catalog) != saved["catalogSha256"] or digest(catalog) != accepted["catalogSha256"]:
        raise WaterError("The original native catalog changed.")
    verify_native_artifacts(root, catalog)
    if inventory(root / "original") != saved["source"]["files"] or inventory(root / "migrated") != result["files"]:
        raise WaterError("The complete original or migrated watershed changed.")
    rebuilt = build_plan(root, review_override=accepted["review"])
    if rebuilt != accepted or not accepted["ready"]:
        raise WaterError("The complete accepted plan no longer reproduces from its original inputs.")
    selected = {row["path"]: row for row in accepted["files"]}
    source_rows = {row["path"]: row for row in saved["source"]["files"]}
    native_catalog = {row["path"]: row for row in catalog["files"]}
    if len(native_catalog) != len(catalog["files"]) or set(native_catalog) != {name for name in source_rows if name.lower().endswith(".dss")} or set(selected) != set(native_catalog):
        raise WaterError("The accepted native file inventory is incomplete or repeated.")
    native_rows = result["native"]
    if len(native_rows) != len(selected) or {row["path"] for row in native_rows} != set(selected):
        raise WaterError("Every accepted DSS file needs its unique complete native result.")
    if {row["path"] for row in result["files"]} != set(source_rows) or len(result["files"]) != len(source_rows):
        raise WaterError("The complete migrated watershed must retain every original member.")
    for native_result in native_rows:
        verify_native_artifacts(root, native_result)
        name = native_result["path"]
        request = load(root / "native" / native_result["requestSha256"] / "request.json")
        expected_source = {k: source_rows[name][k] for k in ("bytes", "sha256")}
        if request["action"] != "convert-verify" or request["request"]["path"] != name or request["request"]["original"] != expected_source:
            raise WaterError("A native result belongs to another original file.")
        if native_result["planSha256"] != accepted["planSha256"] or request["request"]["planSha256"] != accepted["planSha256"] or identity(within(root / "migrated", name)) != native_result["output"]:
            raise WaterError("The complete converted file differs from its original native operation.")
        if native_catalog[name]["original"] != expected_source:
            raise WaterError("The native catalog belongs to another retained source.")
        for key in ("version", "records", "datasets", "catalogSha256"):
            if native_result["original"][key] != native_catalog[name][key]:
                raise WaterError("A native original descriptor differs from its inspected source.")
        before = native_result["original"]["datasets"]
        after = native_result["converted"]["datasets"]
        left = {row["key"]: row for row in before}; right = {row["key"]: row for row in after}
        if len(left) != len(before) or len(right) != len(after) or set(left) != set(right) or native_result["converted"]["version"] != 7:
            raise WaterError("The complete original and converted native dataset sets differ.")
        expected_matches = []
        for key in sorted(left):
            old, new = left[key], right[key]
            if old["class"] != new["class"] or old["payloadSha256"] != new["payloadSha256"]:
                raise WaterError("A complete native dataset changed during conversion.")
            expected_matches.append({"original": old["path"], "converted": new["path"], "class": old["class"],
                                     "originalType": old["recordType"], "convertedType": new["recordType"],
                                     "payloadSha256": old["payloadSha256"]})
        comparison = {"equal": True, "missing": [], "extra": [], "differences": [], "matches": expected_matches,
                      "originalRawRecords": len(native_result["original"]["records"]),
                      "convertedRawRecords": len(native_result["converted"]["records"])}
        if native_result["comparison"] != comparison:
            raise WaterError("The complete native comparison differs from its retained datasets.")
        folder = root / "native" / native_result["requestSha256"]
        if load(folder / "comparison.json") != comparison:
            raise WaterError("The retained native comparison body changed.")
    edits = {}
    for edit in accepted["edits"]: edits.setdefault(edit["file"], []).append(edit)
    converted = {name for name, row in selected.items() if row["action"] == "convert"}
    for row in result["files"]:
        name = row["path"]
        if name in edits:
            raw = edited_bytes(root, name, edits[name])
            if identity(within(root / "migrated", name)) != {"bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}:
                raise WaterError("A migrated model file differs from its exact reviewed edits.")
        elif name not in converted and row != source_rows[name]:
            raise WaterError("An unrelated retained file changed.")
    # Retry durability for complete existing files before adopting an earlier
    # result or received directory whose final parent sync may have failed.
    for row in inventory(root):
        if row["path"] != "operation.lock": sync_saved(within(root, row["path"]))
    sync_parent(root)
    return saved

def commit_complete(root, saved, result):
    candidate = {**saved, "status": "COMPLETE", "result": result, "resultSha256": result["resultSha256"]}
    verify_complete(root, candidate)
    state = {k: candidate[k] for k in ("schema", "id", "originalDirectory", "sourceSha256",
             "sourceManifestSha256", "createdAt", "catalogSha256", "status", "resultSha256")}
    save(root / "state.json", state)
    return read_operation(root)

def safe_name(value):
    if not isinstance(value, str) or not ID.fullmatch(value):
        raise WaterError("Use a migration name containing letters, digits, underscores or hyphens.")
    return value

def relative(value):
    if not isinstance(value, str) or "\\" in value or "\x00" in value:
        raise WaterError("Use a relative forward-slash file path.")
    p = PurePosixPath(value)
    if p.is_absolute() or not p.parts or any(x in ("", ".", "..") for x in value.split("/")):
        raise WaterError("The file path leaves the retained watershed.")
    return str(p)

def within(root, value):
    p = Path(root) / relative(value)
    if p.is_symlink() or p.resolve() != p.absolute():
        raise WaterError("Retained files must not be symbolic links.")
    return p

@contextlib.contextmanager
def locked(root):
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    lock = root / "operation.lock"
    # OS-held locks survive neither process death nor reboot. No stale-PID override.
    with open(lock, "a+b") as f:
        if os.name == "nt":
            import msvcrt
            f.seek(0); f.write(b"0"); f.flush(); f.seek(0)
            try:
                msvcrt.locking(f.fileno(), msvcrt.LK_NBLCK, 1)
            except OSError:
                raise WaterError("This migration is running in another process.", "WATER_WATERSHED_ACTIVE")
            try:
                yield f.fileno()
            finally:
                f.seek(0); msvcrt.locking(f.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl
            try:
                fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise WaterError("This migration is running in another process.", "WATER_WATERSHED_ACTIVE")
            try:
                yield f.fileno()
            finally:
                fcntl.flock(f, fcntl.LOCK_UN)

def inventory(root):
    rows = []
    root = Path(root)
    for folder, dirs, files in os.walk(root, followlinks=False):
        dirs.sort(); files.sort()
        for name in dirs + files:
            path = Path(folder) / name
            mode = path.lstat().st_mode
            if stat.S_ISLNK(mode) or not (stat.S_ISREG(mode) or stat.S_ISDIR(mode)):
                raise WaterError("The selected tree contains a link or special file: " + str(path))
        for name in files:
            path = Path(folder) / name
            rows.append({"path": path.relative_to(root).as_posix(), **identity(path)})
    return sorted(rows, key=lambda row: row["path"])

def copy_exact(source, destination, rows):
    destination.mkdir(parents=True, exist_ok=True, mode=0o700)
    for row in rows:
        src, target = within(source, row["path"]), within(destination, row["path"])
        target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        if target.exists():
            if identity(target) != {k: row[k] for k in ("bytes", "sha256")}:
                raise WaterError("An interrupted copy differs at " + row["path"], "WATER_WATERSHED_CHANGED")
            sync_saved(target)
        else:
            atomic_copy(src, target, {k: row[k] for k in ("bytes", "sha256")})
    if inventory(destination) != rows:
        raise WaterError("The complete copied tree differs from its selected source.")

def decode_text(raw, fallback=None):
    if raw.startswith(b"\xff\xfe"):
        encoding = "utf-16-le"
    elif raw.startswith(b"\xfe\xff"):
        encoding = "utf-16-be"
    elif raw.startswith(b"\xef\xbb\xbf"):
        encoding = "utf-8-sig"
    else:
        encoding = "utf-8"
    try:
        text = raw.decode(encoding)
        if "\x00" in text:
            return None
        if text.encode(encoding) != raw:
            return None
        return text, encoding
    except UnicodeError:
        if fallback:
            try:
                text = raw.decode(fallback)
                if "\x00" not in text and text.encode(fallback) == raw: return text, fallback
            except (UnicodeError, LookupError): pass
        return None

def dss_matches(candidate, pattern):
    # Only the DSS pathname wildcards are special; brackets remain literal.
    expression = "".join(".*" if c == "*" else "." if c == "?" else re.escape(c) for c in pattern)
    return re.fullmatch(expression, candidate, re.I) is not None

def normalize_dss_path(path):
    parts = path.split("/")
    if len(parts) == 8:
        m = re.fullmatch(r"(\d+)(min|mon)", parts[5], re.I)
        if m:
            parts[5] = m.group(1) + ("Minute" if m.group(2).lower() == "min" else "Month")
    return "/".join(parts)

def resolve_reference(model_path, value, files):
    val = html.unescape(value).replace("\\", "/").strip()
    options = []
    if not re.match(r"^(?:[A-Za-z]:|/|%|\$)", val):
        for base in (PurePosixPath(model_path).parent, PurePosixPath(".")):
            candidate = os.path.normpath(str(base / val)).replace("\\", "/")
            if not candidate.startswith("../") and candidate in files:
                options.append(candidate)
    return sorted(set(options))

def references(root, rows, fallback=None):
    found, skipped, coverage = [], [], []
    all_files = {r["path"] for r in rows}
    for row in rows:
        path = row["path"]
        if Path(path).suffix.lower() not in TEXT_EXT and not re.search(r"\.[pguf]\d\d$", path, re.I):
            coverage.append({"path": path, "status": "NATIVE_DSS" if path.lower().endswith(".dss") else "RETAINED_OTHER_FORMAT"})
            continue
        raw = within(root, path).read_bytes()
        result = decode_text(raw, fallback)
        if result is None:
            skipped.append({"path": path, "reason": "This model text does not round-trip through Unicode or the selected legacy encoding."})
            coverage.append({"path": path, "status": "UNREAD_MODEL_TEXT"})
            continue
        text, encoding = result
        coverage.append({"path": path, "status": "SCANNED_MODEL_TEXT", "encoding": encoding})
        spans = []
        for expression in FILE_PATTERNS:
            for match in expression.finditer(text):
                start, end = match.span(1)
                while start < end and text[start].isspace(): start += 1
                while end > start and text[end-1].isspace(): end -= 1
                if any(start < other[1] and end > other[0] for other in spans): continue
                spans.append((start, end, "file"))
        for match in PATHNAME.finditer(text):
            if any(match.start() < b and match.end() > a for a, b, _ in spans): continue
            spans.append((match.start(), match.end(), "pathname"))
        for start, end, kind in sorted(spans):
            value = text[start:end]
            ref = {"file": path, "fileSha256": row["sha256"], "encoding": encoding,
                   "kind": kind, "start": start, "end": end, "value": value,
                   "line": text.count("\n", 0, start) + 1,
                   "context": text[text.rfind("\n", 0, start)+1:text.find("\n", end) if "\n" in text[end:] else len(text)]}
            ref["id"] = digest({k: ref[k] for k in ("file", "fileSha256", "start", "end", "value")})[:24]
            if kind == "file":
                ref["candidates"] = resolve_reference(path, value, all_files)
            else:
                ref["suggested"] = normalize_dss_path(value)
            found.append(ref)
    return {"references": found, "unreadText": skipped, "referenceCoverage": coverage}

def operation(project, migration_id):
    return Path(project).resolve() / "watersheds" / safe_name(migration_id)

def read_operation(root):
    saved = load(root / "state.json")
    if saved.get("schema") != SCHEMA:
        raise WaterError("The saved watershed has another schema.")
    manifest = load(root / "source.json")
    if digest(manifest["files"]) != saved["sourceSha256"] or digest(manifest) != saved["sourceManifestSha256"]:
        raise WaterError("The retained source inventory changed.", "WATER_WATERSHED_CHANGED")
    return {**saved, "source": manifest,
            "review": load(root / "review.json") if (root / "review.json").exists() else None,
            "plan": load(root / "plan.json") if (root / "plan.json").exists() else None,
            "result": load(root / "result.json") if (root / "result.json").exists() else None}

def capture(project, data):
    root = operation(project, data["id"])
    source = Path(data["source"]).expanduser().resolve(strict=True)
    if not source.is_dir() or source == root or source in root.parents or root in source.parents:
        raise WaterError("Select a source directory separate from the Water project.")
    fallback = data.get("textEncoding") or None
    if fallback not in (None, "cp1252", "iso-8859-1"):
        raise WaterError("Choose automatic Unicode, Windows-1252 or ISO-8859-1 for legacy model text.")
    with locked(root):
        if (root / "state.json").exists():
            saved = read_operation(root)
            if saved["originalDirectory"] != str(source) or saved["source"].get("textEncoding") != fallback:
                raise WaterError("This migration name belongs to another source directory.")
            return saved
        rows = inventory(source)
        request = {"schema": SCHEMA, "id": data["id"], "originalDirectory": str(source),
                   "files": rows, "sourceSha256": digest(rows), "textEncoding": fallback}
        save(root / "capture-request.json", request, exclusive=True)
        preserve_interrupted_staging(root, rows, "original")
        copy_exact(source, root / "original", rows)
        if inventory(source) != rows:
            raise WaterError("Source files changed during capture. Retained copies remain available.")
        refs = references(root / "original", rows, fallback)
        manifest = {"files": rows, "textEncoding": fallback, **refs}
        save(root / "source.json", manifest, exclusive=True)
        save(root / "state.json", {"schema": SCHEMA, "id": data["id"], "originalDirectory": str(source),
                                 "sourceSha256": digest(rows), "sourceManifestSha256": digest(manifest),
                                 "status": "CAPTURED", "createdAt": time.time()})
        return read_operation(root)

def native(root, action, request, lease_fd=None):
    command = json.loads(os.environ.get("USGS_DSS_LEGACY_COMMAND", "[]"))
    if not isinstance(command, list) or not command or any(not isinstance(v, str) or not v for v in command):
        raise WaterError('Set USGS_DSS_LEGACY_COMMAND to the installed compatible DSSVue/Jython launcher argv JSON.', "WATER_WATERSHED_RUNTIME")
    binding = {"action": action, "request": request,
               "driverSha256": identity(HERE / "watershed_native.py")["sha256"], "command": command}
    key = digest(binding)
    folder = root / "native" / key
    folder.mkdir(parents=True, exist_ok=True, mode=0o700)
    input_path, result_path = folder / "request.json", folder / "result.json"
    save(input_path, binding, exclusive=True)
    if result_path.exists():
        result = load(result_path)
        if result.get("requestSha256") == key and result.get("status") == "COMPLETE":
            return verify_native_artifacts(root, result)
    attempt = len(list(folder.glob("process-*.json"))) + 1
    log = folder / ("process-%04d.log" % attempt)
    record = {"requestSha256": key, "command": command, "startedAt": time.time()}
    process_path = folder / ("process-%04d.json" % attempt)
    record["log"] = log.relative_to(root).as_posix()
    save(process_path, record)
    def started(owner):
        record["process"] = owner
        save(process_path, record)
    try:
        with open(log, "ab", buffering=0) as stream:
            outcome = run_owned(command + [str(HERE / "watershed_native.py"), str(input_path), str(result_path), key],
                                stream, lease_fd=lease_fd, on_started=started)
        record.update(returncode=outcome["returncode"], lifetimes=outcome["lifetimes"],
                      process=outcome["process"], completedAt=time.time())
        save(process_path, record)
    except BaseException as error:
        record.update(error=str(error), completedAt=time.time())
        save(process_path, record)
        raise
    if not result_path.exists():
        raise WaterError("The native runtime ended without its complete result. Open " + record["log"], "WATER_WATERSHED_NATIVE")
    result = load(result_path)
    if outcome["returncode"] or result.get("requestSha256") != key or result.get("status") != "COMPLETE":
        raise WaterError(result.get("error", "The native operation needs correction.") + " See " + record["log"], "WATER_WATERSHED_NATIVE")
    return verify_native_artifacts(root, result)

def inspect(project, data):
    root = operation(project, data["id"])
    with locked(root) as lease_fd:
        saved = read_operation(root)
        if saved["status"] == "COMPLETE": return verify_complete(root, saved)
        rows = saved["source"]["files"]
        if inventory(root / "original") != rows:
            raise WaterError("Retained original files changed.")
        entries = []
        for row in rows:
            if row["path"].lower().endswith(".dss"):
                # Native readers use working copies; the original stays exact.
                copy = root / "native-read" / row["path"]
                copy.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                if not copy.exists(): atomic_copy(within(root / "original", row["path"]), copy, {k: row[k] for k in ("bytes", "sha256")})
                if identity(copy) != {k: row[k] for k in ("bytes", "sha256")}:
                    raise WaterError("The native read copy changed at " + row["path"])
                entries.append({"path": row["path"], "file": str(copy), **identity(copy)})
        result = native(root, "inventory", {"files": entries}, lease_fd=lease_fd)
        save(root / "catalog.json", result)
        state = {k: saved[k] for k in ("schema", "id", "originalDirectory", "sourceSha256", "sourceManifestSha256", "createdAt")}
        save(root / "state.json", {**state, "status": "INSPECTED", "catalogSha256": digest(result)})
        return {**read_operation(root), "catalog": result}

def save_review(project, data):
    root = operation(project, data["id"])
    with locked(root):
        saved = read_operation(root)
        if saved["sourceSha256"] != data["sourceSha256"]:
            raise WaterError("Review the original saved source before editing.")
        previous = saved["review"]
        expected = data.get("expectedRevision", 0)
        if not isinstance(expected, int) or isinstance(expected, bool) or expected < 0:
            raise WaterError("Use the current non-negative review revision.")
        review = {"schema": SCHEMA + ".review", "revision": expected + 1,
                  "sourceSha256": saved["sourceSha256"], "title": data.get("title", data["id"]),
                  "note": data.get("note", ""), "choices": data.get("choices", {}),
                  "receivingApplication": data.get("receivingApplication", "")}
        if not all(isinstance(review[k], str) for k in ("title", "note", "receivingApplication")) or not isinstance(review["choices"], dict):
            raise WaterError("Provide a complete text review and reference-choice object.")
        if expected != (previous or {}).get("revision", 0):
            if previous == review:
                sync_saved(root / "reviews" / ("%06d.json" % review["revision"]))
                sync_saved(root / "review.json")
                return previous  # Adopt the same accepted save after response loss.
            raise WaterError("The saved review changed in another view.", "WATER_WATERSHED_CHANGED")
        save(root / "reviews" / ("%06d.json" % review["revision"]), review, exclusive=True)
        save(root / "review.json", review)
        return review

def build_plan(root, review_override=None):
    saved = read_operation(root)
    review = saved["review"] if review_override is None else review_override
    if not review:
        raise WaterError("Save the receiving application and reference review first.")
    if review.get("schema") != SCHEMA + ".review" or review.get("sourceSha256") != saved["sourceSha256"]:
        raise WaterError("The complete review belongs to another original watershed.")
    catalog = load(root / "catalog.json")
    verify_native_artifacts(root, catalog)
    if digest(catalog) != saved.get("catalogSha256"):
        raise WaterError("The native source catalog differs from the inspected edition.")
    files = {row["path"]: row for row in saved["source"]["files"]}
    findings, edits, resolved = [], [], []
    if not review["receivingApplication"].strip():
        findings.append({"code": "RECEIVER", "message": "Enter the receiving HEC application and version."})
    refs = saved["source"]["references"]
    extra = sorted(set(review["choices"]) - {r["id"] for r in refs})
    if extra: findings.append({"code": "STALE_CHOICES", "references": extra})
    for ref in refs:
        choice = review["choices"].get(ref["id"], {})
        action = choice.get("action")
        if action not in ("retain", "replace", "output"):
            findings.append({"code": "CHOOSE", "id": ref["id"], "file": ref["file"], "line": ref["line"]})
            continue
        replacement = ref["value"] if action == "retain" else choice.get("value")
        if not isinstance(replacement, str) or not replacement or any(c in replacement for c in ("\x00", "\r", "\n")):
            findings.append({"code": "VALUE", "id": ref["id"]}); continue
        if ref["kind"] == "file":
            targets = resolve_reference(ref["file"], replacement, files)
            if action == "output":
                value = html.unescape(replacement).replace("\\", "/")
                candidate = os.path.normpath(str(PurePosixPath(ref["file"]).parent / value)).replace("\\", "/")
                if re.match(r"^(?:[A-Za-z]:|/|%|\$)", value) or candidate.startswith("../") or not value.lower().endswith(".dss"):
                    findings.append({"code": "OUTPUT_REFERENCE", "id": ref["id"], "message": "Use a relative future model output inside this watershed."})
                else:
                    resolved.append({"id": ref["id"], "file": ref["file"], "target": candidate, "role": "model-output", "replacement": replacement})
            elif len(targets) != 1:
                findings.append({"code": "FILE_REFERENCE", "id": ref["id"], "value": replacement,
                                 "candidates": targets, "message": "Select one retained DSS file with a relative model reference."})
            else:
                resolved.append({"id": ref["id"], "file": ref["file"], "target": targets[0]})
        else:
            if not PATHNAME.fullmatch(replacement):
                findings.append({"code": "PATHNAME", "id": ref["id"]})

        if replacement != ref["value"]:
            edits.append({**ref, "replacement": replacement})
    record_bindings = []
    native_files = {item["path"]: item for item in catalog["files"]}
    outputs = {item["target"] for item in resolved if item.get("role") == "model-output"}
    for ref in refs:
        if ref["kind"] != "pathname": continue
        choice = review["choices"].get(ref["id"], {})
        selected_file = choice.get("file")
        replacement = ref["value"] if choice.get("action") == "retain" else choice.get("value")
        if not selected_file or not isinstance(replacement, str): continue
        try: selected_file = relative(selected_file)
        except WaterError:
            findings.append({"code": "RECORD_FILE", "id": ref["id"]}); continue
        if choice.get("action") == "output":
            if selected_file not in outputs:
                findings.append({"code": "RECORD_OUTPUT", "id": ref["id"], "message": "Select a declared future model output."})
            else:
                record_bindings.append({"id": ref["id"], "file": ref["file"], "target": selected_file,
                                        "value": replacement, "role": "model-output", "matches": []})
            continue
        selected = native_files.get(selected_file)
        if not selected:
            findings.append({"code": "RECORD_FILE", "id": ref["id"], "message": "Bind the pathname to one retained native DSS file."})
            continue
        matches = []
        for record in selected["records"]:
            wanted = replacement.upper()
            candidate = record["key"]
            if record["isTimeSeries"]:
                parts = wanted.split("/")
                source_parts = candidate.split("/")
                if len(parts) == 8 and not parts[4]:
                    source_parts[4] = ""
                    candidate = "/".join(source_parts)
            if dss_matches(candidate, wanted):
                matches.append({"original": record["path"], "converted": record["key"], "class": record["class"],
                                "isTimeSeries": record["isTimeSeries"]})
        if not matches:
            findings.append({"code": "RECORD_REFERENCE", "id": ref["id"], "target": selected_file,
                             "value": replacement, "message": "This complete pathname selects no original native records after typed DSS7 interval conversion."})
        else:
            record_bindings.append({"id": ref["id"], "file": ref["file"], "target": selected_file,
                                    "value": replacement, "role": "input", "matches": matches})
    for ref in refs:
        if ref["kind"] == "pathname" and not review["choices"].get(ref["id"], {}).get("file"):
            findings.append({"code": "RECORD_FILE", "id": ref["id"], "message": "Choose the exact DSS file for this pathname."})
    for row in saved["source"]["unreadText"]:
        findings.append({"code": "TEXT_ENCODING", **row})
    decisions = []
    for row in catalog["files"]:
        if row["version"] not in (6, 7):
            findings.append({"code": "DSS_VERSION", "file": row["path"], "version": row["version"]})
        decisions.append({"path": row["path"], "version": row["version"],
                          "action": "convert" if row["version"] == 6 else "retain",
                          "catalogSha256": row["catalogSha256"], "recordCount": len(row["records"])})
    plan = {"schema": SCHEMA + ".plan", "id": saved["id"], "sourceSha256": saved["sourceSha256"],
            "catalogSha256": digest(catalog), "reviewSha256": digest(review),
            "review": review, "files": decisions, "edits": edits, "resolvedReferences": resolved,
            "recordBindings": record_bindings, "findings": findings, "ready": not findings}
    return {**plan, "planSha256": digest(plan)}

def preview(project, data):
    root = operation(project, data["id"])
    with locked(root):
        plan = build_plan(root)
        save(root / "plan.json", plan)
        return plan

def preserve_interrupted_staging(root, rows, section="migrated"):
    selected = {row["path"] for row in rows}
    staging = root / section
    if not staging.exists(): return
    for row in inventory(staging):
        if row["path"] in selected: continue
        name = Path(row["path"]).name
        if not name.startswith((".copying-", ".writing-", ".saving-")):
            raise WaterError("The staged watershed contains an unexpected file: " + row["path"])
        target = root / "interrupted-staging" / (str(time.time_ns()) + "-" + name)
        target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.replace(within(staging, row["path"]), target); sync_parent(target)

def edited_bytes(root, name, edits):
    original = within(root / "original", name).read_bytes()
    if hashlib.sha256(original).hexdigest() != edits[0]["fileSha256"]:
        raise WaterError("The original model file changed: " + name)
    text = original.decode(edits[0]["encoding"])
    for edit in sorted(edits, key=lambda x: x["start"], reverse=True):
        if text[edit["start"]:edit["end"]] != edit["value"]:
            raise WaterError("The original reference span changed: " + name)
        text = text[:edit["start"]] + edit["replacement"] + text[edit["end"]:]
    return text.encode(edits[0]["encoding"])

def apply_edits(root, plan):
    groups = {}
    for edit in plan["edits"]: groups.setdefault(edit["file"], []).append(edit)
    for name, edits in groups.items():
        original = within(root / "original", name).read_bytes()
        raw = edited_bytes(root, name, edits)
        target = within(root / "migrated", name)
        if target.read_bytes() not in (original, raw):
            raise WaterError("The staged model file contains another edit: " + name)
        atomic_bytes(target, raw)

def execute(project, data):
    root = operation(project, data["id"])
    with locked(root) as lease_fd:
        saved = read_operation(root)
        plan = build_plan(root)
        if plan["planSha256"] != data["planSha256"] or not plan["ready"]:
            raise WaterError("Refresh and resolve the complete current receiving plan.", "WATER_WATERSHED_PLAN_CHANGED")
        save(root / "accepted-plan.json", plan, exclusive=True)
        if saved.get("result") and saved["result"]["planSha256"] == plan["planSha256"]:
            return commit_complete(root, saved, saved["result"])
        rows = saved["source"]["files"]
        if inventory(root / "original") != rows:
            raise WaterError("Original files changed after review.")
        preserve_interrupted_staging(root, rows)
        # Copy each source member once; converted members may already exist on resume.
        for row in rows:
            target = within(root / "migrated", row["path"])
            if not target.exists():
                target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                atomic_copy(within(root / "original", row["path"]), target, {k: row[k] for k in ("bytes", "sha256")})
        completed = []
        for decision in plan["files"]:
            name = decision["path"]
            original = within(root / "original", name)
            target = within(root / "migrated", name)
            result = native(root, "convert-verify", {"source": str(original), "target": str(target),
                           "original": identity(original), "path": name, "planSha256": plan["planSha256"]}, lease_fd=lease_fd)
            if result["output"] != identity(target):
                raise WaterError("The saved converted file changed: " + name)
            completed.append(result)
        native_by_file = {item["path"]: item for item in completed}
        for binding in plan["recordBindings"]:
            if binding["role"] == "model-output": continue
            converted_file = native_by_file[binding["target"]]["converted"]
            wanted = binding["value"].upper()
            selected_parts = wanted.split("/")
            matches = []
            for row in converted_file["records"]:
                candidate = row["key"]
                if row["isTimeSeries"] and len(selected_parts) == 8 and not selected_parts[4]:
                    parts = candidate.split("/"); parts[4] = ""; candidate = "/".join(parts)
                if dss_matches(candidate, wanted): matches.append(row)
            if not matches:
                raise WaterError("The reviewed model pathname selects no converted native records: " + binding["value"])
            # Complete value comparison already covers every original dataset.
            # A literal D part must still select the actual converted catalog;
            # blank D parts intentionally select a whole time-series dataset.
        apply_edits(root, plan)
        if inventory(root / "original") != rows:
            raise WaterError("The original watershed changed during conversion.")
        output = inventory(root / "migrated")
        if [r["path"] for r in output] != [r["path"] for r in rows]:
            raise WaterError("The migrated watershed has missing or unexpected members.")
        converted = {row["path"] for row in plan["files"] if row["action"] == "convert"}
        edited = {row["file"] for row in plan["edits"]}
        original_by_path = {r["path"]: r for r in rows}
        for row in output:
            if row["path"] not in converted | edited and row != original_by_path[row["path"]]:
                raise WaterError("An unrelated watershed member changed: " + row["path"])
        recheck = references(root / "migrated", output, saved["source"].get("textEncoding"))
        declared_outputs = {(r["file"], r["replacement"]) for r in plan["resolvedReferences"] if r.get("role") == "model-output"}
        unresolved = [r for r in recheck["references"] if r["kind"] == "file" and len(r["candidates"]) != 1 and (r["file"], r["value"]) not in declared_outputs]
        if unresolved:
            raise WaterError("Some migrated model file references do not resolve.")
        result = {"schema": SCHEMA + ".result", "id": saved["id"], "status": "COMPLETE",
                  "planSha256": plan["planSha256"], "sourceSha256": saved["sourceSha256"],
                  "files": output, "native": completed, "references": recheck,
                  "completedAt": time.time()}
        result["resultSha256"] = digest(result)
        save(root / "result.json", result)
        return commit_complete(root, saved, result)

def handover(project, data):
    root = operation(project, data["id"])
    with locked(root):
        saved = read_operation(root)
        verify_complete(root, saved)
        if inventory(root / "original") != saved["source"]["files"] or inventory(root / "migrated") != saved["result"]["files"]:
            raise WaterError("The complete handover files changed.")
        output = root / "handover.zip"
        temp = root / ".handover.zip"
        names = [r["path"] for r in inventory(root) if not r["path"].startswith(("native-read/", ".")) and r["path"] not in ("operation.lock", "handover.zip")]
        with zipfile.ZipFile(temp, "w", compression=zipfile.ZIP_DEFLATED, allowZip64=True) as z:
            members = []
            for name in names:
                path = within(root, name)
                z.write(path, name)
                members.append({"path": name, **identity(path)})
            z.writestr("handover-manifest.json", encoded({"schema": SCHEMA + ".handover", "id": saved["id"], "files": members,
                                                        "sourceSha256": saved["sourceSha256"], "resultSha256": saved["result"]["resultSha256"]}))
        with open(temp, "rb") as complete: os.fsync(complete.fileno())
        os.chmod(temp, 0o600); os.replace(temp, output); sync_parent(output)
        return {"path": str(output), "filename": data["id"] + "-watershed-handover.zip", "mime": "application/zip", **identity(output)}

def receive(project, data):
    source = Path(data["file"]).resolve(strict=True)
    parent = Path(project).resolve() / "watersheds"
    parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    stage = Path(tempfile.mkdtemp(prefix=".receiving-", dir=parent))
    try:
        with zipfile.ZipFile(source) as z:
            listing = z.infolist()
            names = [relative(i.filename) for i in listing]
            if len(names) != len(set(names)): raise WaterError("The handover contains repeated paths.")
            manifest = json.loads(z.read("handover-manifest.json"))
            if manifest.get("schema") != SCHEMA + ".handover": raise WaterError("Select a complete watershed handover.")
            expected = {r["path"]: r for r in manifest["files"]}
            if set(names) != set(expected) | {"handover-manifest.json"}: raise WaterError("The handover inventory differs from its members.")
            for info in listing:
                if info.filename == "handover-manifest.json": continue
                if stat.S_ISLNK(info.external_attr >> 16): raise WaterError("The handover contains a symbolic link.")
                target = within(stage, info.filename)
                target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                with z.open(info) as src, open(target, "xb") as dst:
                    shutil.copyfileobj(src, dst); dst.flush(); os.fsync(dst.fileno())
                os.chmod(target, 0o600); sync_parent(target)
                if identity(target) != {k: expected[info.filename][k] for k in ("bytes", "sha256")}:
                    raise WaterError("A complete handover member differs: " + info.filename)
        saved = verify_complete(stage)
        if saved["id"] != manifest["id"] or saved["sourceSha256"] != manifest["sourceSha256"] or saved["result"]["resultSha256"] != manifest["resultSha256"]:
            raise WaterError("The received history differs from the original handover.")
        if inventory(stage / "original") != saved["source"]["files"] or inventory(stage / "migrated") != saved["result"]["files"]:
            raise WaterError("The received watershed differs from its retained files.")
        target = operation(project, saved["id"])
        with locked(parent):
            if target.exists():
                with locked(target):
                    existing = verify_complete(target)
                    if existing["sourceSha256"] != saved["sourceSha256"] or existing.get("result", {}).get("resultSha256") != manifest["resultSha256"]:
                        raise WaterError("This project contains another watershed with the same name.")
                    return {**existing, "alreadyReceived": True}
            os.rename(stage, target); sync_parent(target)
        return {**verify_complete(target), "received": True}
    finally:
        if stage.exists(): shutil.rmtree(stage)


def download(project, data):
    root = operation(project, data["id"])
    saved = read_operation(root)
    kind = data["kind"]
    if kind == "handover":
        return handover(project, data)
    if kind in ("original", "migrated"):
        rows = saved["source"]["files"] if kind == "original" else (saved.get("result") or {}).get("files", [])
        selected = next((row for row in rows if row["path"] == data.get("file")), None)
        if selected is None: raise WaterError("Choose a retained watershed file.")
        path = within(root / kind, selected["path"])
        if identity(path) != {key: selected[key] for key in ("bytes", "sha256")}:
            raise WaterError("The selected retained file changed.")
        return {"path": str(path), "filename": path.name, "mime": "application/octet-stream", **identity(path)}
    mapping = {"source": "source.json", "review": "review.json", "plan": "plan.json", "result": "result.json", "catalog": "catalog.json"}
    if kind not in mapping: raise WaterError("Choose a complete watershed download.")
    path = root / mapping[kind]
    return {"path": str(path), "filename": data["id"] + "-" + mapping[kind], "mime": "application/json", **identity(path)}

def working_copy(project, data):
    root = operation(project, data["id"])
    saved = read_operation(root)
    return {"schema": SCHEMA + ".working", "id": saved["id"], "sourceSha256": saved["sourceSha256"],
            "review": saved["review"], "source": saved["source"]}

def reopen_working(project, data):
    working = data["working"]
    saved = read_operation(operation(project, data["id"]))
    if working.get("schema") != SCHEMA + ".working" or working.get("id") != saved["id"] or working.get("sourceSha256") != saved["sourceSha256"] or working.get("source") != saved["source"]:
        raise WaterError("This working file belongs to another original watershed.")
    review = working.get("review")
    if not isinstance(review, dict): raise WaterError("The working file contains no saved review.")
    return save_review(project, {**review, "id": data["id"], "sourceSha256": saved["sourceSha256"],
                                "expectedRevision": data["expectedRevision"]})

def main(command, project, data):
    if command == "list":
        parent = Path(project).resolve() / "watersheds"
        return [] if not parent.exists() else [load(p / "state.json") for p in sorted(parent.iterdir()) if p.is_dir() and ID.fullmatch(p.name) and (p / "state.json").exists()]
    if command == "read":
        root = operation(project, data["id"])
        result = read_operation(root)
        if (root / "catalog.json").exists(): result["catalog"] = load(root / "catalog.json")
        return result
    commands = {"capture": capture, "inspect": inspect, "review": save_review, "preview": preview,
                "execute": execute, "handover": handover, "receive": receive, "download": download,
                "working": working_copy, "reopen-working": reopen_working}
    if command not in commands: raise WaterError("Choose a watershed command from the Water CLI.")
    return commands[command](project, data)

if __name__ == "__main__":
    try:
        payload = json.loads(sys.stdin.buffer.read().decode("utf-8"))
        result = main(sys.argv[1], sys.argv[2], payload)
        sys.stdout.buffer.write(encoded(result))
    except Exception as error:
        sys.stdout.buffer.write(encoded({"error": {"code": getattr(error, "code", "WATER_WATERSHED_FAILED"), "message": str(error)}}))
        sys.exit(1)
