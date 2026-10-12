#!/usr/bin/env python3
# MIT. Complete private SF88 session archives; the original Node buyer owns all semantics.
from __future__ import annotations
import contextlib, ctypes, errno, fcntl, hashlib, json, os, re, stat, sys, uuid, zipfile
from pathlib import Path

SCHEMA = "stellar-forge.sf88.dataset-session-archive.v1"
LOCATION = ".sf88-location.json"
HISTORY = ".sf88-portable-history"
MANIFEST = "SF88_SESSION.json"
MAX_MANIFEST = 32 * 1024 * 1024
MAX_FILE = 256 * 1024 * 1024
MAX_TOTAL = 16 * 1024**3
MAX_FILES = 250000
HASH = re.compile(r"^[a-f0-9]{64}$")
OPERATION = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$")
BLOCK = 1024 * 1024

class Failure(Exception):
    def __init__(self, code):
        super().__init__(code)
        self.code = code

def need(value, code):
    if not value:
        raise Failure(code)

def sha(raw):
    return hashlib.sha256(raw).hexdigest()

def encoded(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")

def parse(raw):
    def pairs(items):
        result = {}
        for key, value in items:
            need(key not in result, "DATASET_ARCHIVE_DUPLICATE_JSON_KEY")
            result[key] = value
        return result
    try:
        return json.loads(raw.decode("utf-8"), object_pairs_hook=pairs,
                          parse_constant=lambda value: (_ for _ in ()).throw(Failure("DATASET_ARCHIVE_JSON_INVALID")))
    except (UnicodeError, ValueError, TypeError):
        raise Failure("DATASET_ARCHIVE_JSON_INVALID") from None

def absolute(value):
    need(isinstance(value, str) and "\0" not in value and os.path.isabs(value)
         and os.path.normpath(value) == value, "DATASET_ARCHIVE_ABSOLUTE_PATH_REQUIRED")
    return Path(value)

def within(root, path):
    return path == root or root in path.parents

def private_root(path):
    path = absolute(str(path))
    item = path.lstat()
    need(stat.S_ISDIR(item.st_mode) and not stat.S_ISLNK(item.st_mode)
         and path.resolve() == path and item.st_uid == os.getuid()
         and not item.st_mode & 0o077, "DATASET_ARCHIVE_PRIVATE_DIRECTORY_REQUIRED")
    return item

def ordinary(path, directory=False):
    info = path.lstat()
    need(not stat.S_ISLNK(info.st_mode) and
         (stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode))
         and info.st_uid == os.getuid() and not info.st_mode & 0o7000,
         "DATASET_ARCHIVE_SOURCE_TYPE_OR_OWNER")
    if not directory:
        need(info.st_nlink == 1, "DATASET_ARCHIVE_PRIVATE_SOURCE_REQUIRED")
    return info

def identity(info):
    return (info.st_dev, info.st_ino, info.st_mode, info.st_size, info.st_mtime_ns, info.st_ctime_ns)

def sync_directory(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)

def read(path, maximum=MAX_MANIFEST, private=True):
    if private:
        private_root(path.parent)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        info = os.fstat(fd)
        need(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and
             info.st_uid == os.getuid() and info.st_size <= maximum and
             (not private or not info.st_mode & 0o077), "DATASET_ARCHIVE_FILE_INVALID")
        chunks, size = [], 0
        while True:
            raw = os.read(fd, min(BLOCK, maximum + 1 - size))
            if not raw:
                break
            chunks.append(raw)
            size += len(raw)
            need(size <= maximum, "DATASET_ARCHIVE_FILE_LIMIT")
        need(identity(info) == identity(os.fstat(fd)) == identity(path.lstat()),
             "DATASET_ARCHIVE_SOURCE_CHANGED")
        return b"".join(chunks)
    finally:
        os.close(fd)

def file_digest(path, maximum=MAX_FILE, expected=None):
    info = ordinary(path)
    need(info.st_size <= maximum, "DATASET_ARCHIVE_FILE_LIMIT")
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    h, size = hashlib.sha256(), 0
    try:
        need(identity(info) == identity(os.fstat(fd)), "DATASET_ARCHIVE_SOURCE_CHANGED")
        while True:
            raw = os.read(fd, BLOCK)
            if not raw:
                break
            size += len(raw)
            need(size <= maximum, "DATASET_ARCHIVE_FILE_LIMIT")
            h.update(raw)
        need(identity(info) == identity(os.fstat(fd)) == identity(path.lstat()),
             "DATASET_ARCHIVE_SOURCE_CHANGED")
    finally:
        os.close(fd)
    result = {"bytes": size, "sha256": h.hexdigest(), "mode": stat.S_IMODE(info.st_mode)}
    if expected is not None:
        need(all(result[key] == expected[key] for key in result), "DATASET_ARCHIVE_MEMBER_CHANGED")
    return result, identity(info)

def replace_json(path, value):
    raw = encoded(value)
    temporary = path.with_name(path.name + ".next")
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        info = os.fstat(fd)
        need(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and
             info.st_uid == os.getuid() and not info.st_mode & 0o077, "DATASET_ARCHIVE_CONTROL_CHANGED")
        os.ftruncate(fd, 0)
        with os.fdopen(fd, "wb", closefd=False) as stream:
            stream.write(raw)
            stream.flush()
        os.fsync(fd)
    finally:
        os.close(fd)
    os.replace(temporary, path)
    sync_directory(path.parent)

def create_exact(path, raw, mode=0o600, temporary_directory=None):
    if path.exists():
        need(read(path, max(MAX_MANIFEST, len(raw))) == raw, "DATASET_ARCHIVE_CONTROL_CHANGED")
        return
    # A complete control/member file becomes visible atomically. Partial writes
    # remain in this same operation's separate private control directory.
    directory = temporary_directory or path.parent
    temporary = directory / ("create-" + sha(str(path).encode()) + ".partial")
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        info = os.fstat(fd)
        need(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_uid == os.getuid()
             and not info.st_mode & 0o077, "DATASET_ARCHIVE_CONTROL_CHANGED")
        os.ftruncate(fd, 0)
        with os.fdopen(fd, "wb", closefd=False) as stream:
            stream.write(raw)
            stream.flush()
        os.fchmod(fd, mode)
        os.fsync(fd)
    finally:
        os.close(fd)
    try:
        publish_absent(temporary, path)
    except FileExistsError:
        need(read(path, max(MAX_MANIFEST, len(raw))) == raw, "DATASET_ARCHIVE_CONTROL_CHANGED")


def publish_absent(source, destination):
    # Publish without replacing even an empty directory created by another owner.
    library = ctypes.CDLL(None, use_errno=True)
    function = getattr(library, "renameat2", None)
    need(function is not None, "DATASET_ARCHIVE_NOREPLACE_REQUIRED")
    function.argtypes = (ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint)
    function.restype = ctypes.c_int
    if function(-100, os.fsencode(source), -100, os.fsencode(destination), 1):
        value = ctypes.get_errno()
        if value == errno.EEXIST:
            raise FileExistsError(value, os.strerror(value), str(destination))
        raise OSError(value, os.strerror(value))
    sync_directory(destination.parent)
    if source.parent != destination.parent:
        sync_directory(source.parent)

@contextlib.contextmanager
def control_lease(directory):
    directory.mkdir(mode=0o700, exist_ok=True)
    private_root(directory)
    fd = os.open(directory / "lease.lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        info = os.fstat(fd)
        need(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and
             info.st_uid == os.getuid() and not info.st_mode & 0o077, "DATASET_ARCHIVE_CONTROL_CHANGED")
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise Failure("DATASET_ARCHIVE_OPERATION_RUNNING") from None
        yield
    finally:
        os.close(fd)

def relpath(value, directory=False):
    need(isinstance(value, str) and "\\" not in value and "\0" not in value
         and len(value.encode("utf-8")) <= 4096, "DATASET_ARCHIVE_MEMBER_PATH")
    if directory and value == "":
        return value
    need(value and not value.startswith("/") and
         all(part not in ("", ".", "..") for part in value.split("/"))
         and not any(ord(c) < 32 or ord(c) == 127 for c in value),
         "DATASET_ARCHIVE_MEMBER_PATH")
    return value

def inventory(root, *, exclude=True):
    files, directories, identities = [], [], {}
    stack = [root]
    while stack:
        directory = stack.pop()
        info = ordinary(directory, True)
        relative = directory.relative_to(root).as_posix()
        if relative == ".":
            relative = ""
        directories.append({"path": relative, "mode": stat.S_IMODE(info.st_mode)})
        identities[relative + "/"] = identity(info)
        for item in sorted(directory.iterdir(), key=lambda path: path.name, reverse=True):
            key = item.relative_to(root).as_posix()
            if exclude and key in ("run.lock", LOCATION):
                continue
            relpath(key)
            info = item.lstat()
            if stat.S_ISDIR(info.st_mode) and not stat.S_ISLNK(info.st_mode):
                stack.append(item)
            else:
                body, inode = file_digest(item)
                files.append({"path": key, **body})
                identities[key] = inode
            need(len(files) + len(directories) <= MAX_FILES, "DATASET_ARCHIVE_MEMBER_LIMIT")
    files.sort(key=lambda item: item["path"])
    directories.sort(key=lambda item: item["path"])
    return files, directories, identities

@contextlib.contextmanager
def source_wire_leases(root):
    held = []
    try:
        for directory, names, files in os.walk(root, followlinks=False):
            for name in names:
                need(not Path(directory, name).is_symlink(), "DATASET_ARCHIVE_SOURCE_TYPE_OR_OWNER")
            if "active.lock" not in files:
                continue
            path = Path(directory, "active.lock")
            info = ordinary(path)
            fd = os.open(path, os.O_RDWR | os.O_NOFOLLOW)
            try:
                need(identity(info) == identity(os.fstat(fd)), "DATASET_ARCHIVE_SOURCE_CHANGED")
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BaseException:
                os.close(fd)
                raise
            held.append(fd)
        yield
    except BlockingIOError:
        raise Failure("DATASET_ARCHIVE_ORIGINAL_WIRE_ACTIVE") from None
    finally:
        for fd in held:
            os.close(fd)

def validate_manifest(value, maximum):
    need(isinstance(value, dict) and value.get("schema") == SCHEMA and
         OPERATION.fullmatch(value.get("operation", "")) and
         HASH.fullmatch(value.get("sessionSha256", "")) and
         HASH.fullmatch(value.get("configurationSha256", "")),
         "DATASET_ARCHIVE_MANIFEST_INVALID")
    absolute(value.get("sourceDirectory"))
    need(isinstance(value.get("files"), list) and isinstance(value.get("directories"), list)
         and 1 <= len(value["files"]) <= MAX_FILES and
         1 <= len(value["directories"]) <= MAX_FILES and
         len(value["files"]) + len(value["directories"]) <= MAX_FILES,
         "DATASET_ARCHIVE_MEMBER_LIMIT")
    names, total = set(), 0
    directories = set()
    for item in value["directories"]:
        need(isinstance(item, dict) and set(item) == {"path", "mode"}, "DATASET_ARCHIVE_DIRECTORY_INVALID")
        key = relpath(item["path"], True)
        need(key not in names and type(item["mode"]) is int and
             0 <= item["mode"] <= 0o777 and item["mode"] & 0o500 == 0o500,
             "DATASET_ARCHIVE_DIRECTORY_INVALID")
        names.add(key)
        directories.add(key)
    need("" in directories and not next(item for item in value["directories"] if item["path"] == "")["mode"] & 0o077,
         "DATASET_ARCHIVE_PRIVATE_DIRECTORY_REQUIRED")
    for item in value["files"]:
        need(isinstance(item, dict) and set(item) == {"path", "mode", "bytes", "sha256"},
             "DATASET_ARCHIVE_MEMBER_INVALID")
        key = relpath(item["path"])
        need(key not in names and key not in ("run.lock", LOCATION) and
             type(item["mode"]) is int and 0 <= item["mode"] <= 0o777 and item["mode"] & 0o400 and
             type(item["bytes"]) is int and 0 <= item["bytes"] <= MAX_FILE and
             HASH.fullmatch(item["sha256"] or ""), "DATASET_ARCHIVE_MEMBER_INVALID")
        names.add(key)
        total += item["bytes"]
        need(total <= maximum, "DATASET_ARCHIVE_TOTAL_LIMIT")
    for key in names:
        if key:
            parent = key.rpartition("/")[0]
            need(parent in directories, "DATASET_ARCHIVE_PARENT_MISSING")
    need(sum(item["path"] == "session.json" for item in value["files"]) == 1 and
         next(item for item in value["files"] if item["path"] == "session.json")["sha256"] == value["sessionSha256"]
         and value.get("bytes") == total and
         isinstance(value.get("inspection"), dict), "DATASET_ARCHIVE_MANIFEST_INVALID")
    return value

def checked_archive(path, expected, maximum, *, verify=True):
    private_root(path.parent)
    info = ordinary(path)
    need(not info.st_mode & 0o077 and info.st_size <= maximum + MAX_MANIFEST + MAX_FILES * 1024,
         "DATASET_ARCHIVE_PRIVATE_PACKAGE_REQUIRED")
    actual, _ = file_digest(path, maximum + MAX_MANIFEST + MAX_FILES * 1024)
    need(expected is None or actual["sha256"] == expected, "DATASET_ARCHIVE_DIGEST_MISMATCH")
    with zipfile.ZipFile(path) as archive:
        entries = archive.infolist()
        need(len(entries) <= MAX_FILES + 2 and len({entry.filename for entry in entries}) == len(entries),
             "DATASET_ARCHIVE_DUPLICATE_OR_EXCESS_MEMBER")
        try:
            entry = archive.getinfo(MANIFEST)
        except KeyError:
            raise Failure("DATASET_ARCHIVE_MANIFEST_MISSING") from None
        need(entry.file_size <= MAX_MANIFEST, "DATASET_ARCHIVE_MANIFEST_LIMIT")
        manifest_raw = archive.read(entry)
        manifest = validate_manifest(parse(manifest_raw), maximum)
        expected_names = {MANIFEST}
        expected_names.update("session/" + item["path"] + ("/" if item["path"] else "")
                              for item in manifest["directories"])
        expected_names.update("session/" + item["path"] for item in manifest["files"])
        need({entry.filename for entry in entries} == expected_names, "DATASET_ARCHIVE_CLOSURE_MISMATCH")
        files = {item["path"]: item for item in manifest["files"]}
        dirs = {item["path"]: item for item in manifest["directories"]}
        for entry in entries:
            need(not entry.flag_bits & 1 and entry.compress_type in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED),
                 "DATASET_ARCHIVE_ENCODING_UNSUPPORTED")
            mode = entry.external_attr >> 16
            if entry.filename == MANIFEST:
                need(not entry.is_dir() and stat.S_ISREG(mode), "DATASET_ARCHIVE_MEMBER_INVALID")
                continue
            key = entry.filename[len("session/"):]
            directory = entry.is_dir()
            key = key[:-1] if directory and key else key
            item = dirs.get(key) if directory else files.get(key)
            need(item is not None and stat.S_IMODE(mode) == item["mode"] and
                 (stat.S_ISDIR(mode) if directory else stat.S_ISREG(mode)) and
                 entry.file_size == (0 if directory else item["bytes"]), "DATASET_ARCHIVE_MEMBER_INVALID")
            if verify and not directory:
                h, size = hashlib.sha256(), 0
                with archive.open(entry) as stream:
                    while True:
                        raw = stream.read(BLOCK)
                        if not raw:
                            break
                        size += len(raw)
                        need(size <= item["bytes"], "DATASET_ARCHIVE_MEMBER_LIMIT")
                        h.update(raw)
                need(size == item["bytes"] and h.hexdigest() == item["sha256"],
                     "DATASET_ARCHIVE_MEMBER_CHANGED")
        session = parse(archive.read("session/session.json"))
        need(session.get("directory") == manifest["sourceDirectory"] and
             session.get("configurationSha256") == manifest["configurationSha256"],
             "DATASET_ARCHIVE_SESSION_CHANGED")
    need(identity(info) == identity(path.lstat()), "DATASET_ARCHIVE_SOURCE_CHANGED")
    return {"archive": str(path), "sha256": actual["sha256"], "bytes": actual["bytes"],
            "manifestSha256": sha(manifest_raw), "manifest": manifest}, manifest_raw

def zip_info(name, mode, directory=False):
    entry = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
    entry.create_system = 3
    entry.external_attr = ((stat.S_IFDIR if directory else stat.S_IFREG) | mode) << 16
    if directory:
        entry.external_attr |= 0x10
    entry.compress_type = zipfile.ZIP_DEFLATED
    return entry

def summary(package, **fields):
    manifest = package["manifest"]
    return {"schema": SCHEMA, "archive": package["archive"], "archiveSha256": package["sha256"],
            "archiveBytes": package["bytes"], "manifestSha256": package["manifestSha256"],
            "sourceDirectory": manifest["sourceDirectory"], "sessionSha256": manifest["sessionSha256"],
            "configurationSha256": manifest["configurationSha256"],
            "files": len(manifest["files"]), "directories": len(manifest["directories"]),
            "sourceBytes": manifest["bytes"], "inspection": manifest["inspection"], **fields}

def export_session(request):
    source, destination = absolute(request["directory"]), absolute(request["archive"])
    private_root(source)
    private_root(destination.parent)
    need(not within(source, destination) and not within(destination, source),
         "DATASET_ARCHIVE_OUTPUT_OVERLAPS_SOURCE")
    operation = request["operation"]
    need(OPERATION.fullmatch(operation), "DATASET_ARCHIVE_OPERATION_REQUIRED")
    control = destination.parent / (".sf88-export-" + sha(str(destination).encode())[:24])
    maximum = request["maxBytes"]
    with control_lease(control), source_wire_leases(source):
        intent_path, manifest_path = control / "intent.json", control / "manifest.json"
        binding = {"schema": SCHEMA + ".export", "operation": operation, "source": str(source),
                   "archive": str(destination), "sourceDirectory": request["sourceDirectory"],
                   "configurationSha256": request["configurationSha256"],
                   "sessionSha256": sha(read(source / "session.json", 262144))}
        if intent_path.exists():
            need(parse(read(intent_path)) == binding, "DATASET_ARCHIVE_EXPORT_SELECTION_CHANGED")
        else:
            need(not destination.exists(), "DATASET_ARCHIVE_DESTINATION_EXISTS")
            create_exact(intent_path, encoded(binding))
        if destination.exists():
            package, raw = checked_archive(destination, None, maximum)
            need(read(manifest_path) == raw, "DATASET_ARCHIVE_EXPORT_CHANGED")
            return summary(package, operation=operation, state="EXPORTED", reused=True)
        if manifest_path.exists():
            manifest_raw = read(manifest_path)
            manifest = validate_manifest(parse(manifest_raw), maximum)
            files, directories, before = inventory(source)
            need(files == manifest["files"] and directories == manifest["directories"],
                 "DATASET_ARCHIVE_SOURCE_CHANGED")
        else:
            files, directories, before = inventory(source)
            manifest = validate_manifest({"schema": SCHEMA, "operation": operation,
                "sourceDirectory": request["sourceDirectory"], "sessionSha256": binding["sessionSha256"],
                "configurationSha256": request["configurationSha256"], "files": files,
                "directories": directories, "bytes": sum(item["bytes"] for item in files),
                "inspection": request["inspection"]}, maximum)
            manifest_raw = encoded(manifest)
            need(len(manifest_raw) <= MAX_MANIFEST, "DATASET_ARCHIVE_MANIFEST_LIMIT")
            create_exact(manifest_path, manifest_raw)
        temporary = control / "archive.partial"
        fd = os.open(temporary, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        try:
            info = os.fstat(fd)
            need(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and
                 info.st_uid == os.getuid() and not info.st_mode & 0o077, "DATASET_ARCHIVE_CONTROL_CHANGED")
            os.ftruncate(fd, 0)
            with os.fdopen(fd, "w+b", closefd=False) as output:
                with zipfile.ZipFile(output, "w", allowZip64=True, compression=zipfile.ZIP_DEFLATED,
                                     compresslevel=6) as archive:
                    archive.writestr(zip_info(MANIFEST, 0o600), manifest_raw)
                    for item in directories:
                        archive.writestr(zip_info("session/" + item["path"] + ("/" if item["path"] else ""),
                                                  item["mode"], True), b"")
                    for item in files:
                        path = source / item["path"]
                        need(identity(ordinary(path)) == before[item["path"]], "DATASET_ARCHIVE_SOURCE_CHANGED")
                        source_fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
                        try:
                            need(identity(os.fstat(source_fd)) == before[item["path"]], "DATASET_ARCHIVE_SOURCE_CHANGED")
                            h, size = hashlib.sha256(), 0
                            with archive.open(zip_info("session/" + item["path"], item["mode"]), "w",
                                              force_zip64=True) as member:
                                while True:
                                    block = os.read(source_fd, BLOCK)
                                    if not block:
                                        break
                                    size += len(block)
                                    need(size <= item["bytes"], "DATASET_ARCHIVE_SOURCE_CHANGED")
                                    h.update(block)
                                    member.write(block)
                            need(size == item["bytes"] and h.hexdigest() == item["sha256"]
                                 and identity(os.fstat(source_fd)) == before[item["path"]],
                                 "DATASET_ARCHIVE_SOURCE_CHANGED")
                        finally:
                            os.close(source_fd)
                output.flush()
            os.fsync(fd)
        finally:
            os.close(fd)
        after_files, after_dirs, after = inventory(source)
        need(files == after_files and directories == after_dirs and before == after,
             "DATASET_ARCHIVE_SOURCE_CHANGED")
        package, raw = checked_archive(temporary, None, maximum)
        need(raw == manifest_raw, "DATASET_ARCHIVE_EXPORT_CHANGED")
        publish_absent(temporary, destination)
        package["archive"] = str(destination)
        return summary(package, operation=operation, state="EXPORTED", reused=False)

def receive_binding(request, package, destination):
    return {"schema": SCHEMA + ".receive", "operation": request["operation"],
            "destination": str(destination), "archiveSha256": package["sha256"],
            "manifestSha256": package["manifestSha256"],
            "sessionSha256": package["manifest"]["sessionSha256"],
            "configurationSha256": package["manifest"]["configurationSha256"]}

def stage_location(package, operation):
    manifest = package["manifest"]
    return {"schema": "stellar-forge.sf88.dataset-location.v1",
            "sourceDirectory": manifest["sourceDirectory"],
            "sessionSha256": manifest["sessionSha256"],
            "configurationSha256": manifest["configurationSha256"],
            "archiveSha256": package["sha256"], "manifestSha256": package["manifestSha256"],
            "operation": operation}

def selected_tree(stage, manifest, archive_sha, *, complete=False):
    wanted_files = {item["path"]: item for item in manifest["files"]}
    wanted_dirs = {item["path"]: item for item in manifest["directories"]}
    found = set()
    for directory, dirs, files in os.walk(stage, followlinks=False):
        root = Path(directory)
        key = root.relative_to(stage).as_posix()
        key = "" if key == "." else key
        need(key in wanted_dirs or key == HISTORY, "DATASET_ARCHIVE_UNEXPECTED_STAGE_MEMBER")
        info = ordinary(root, True)
        # A stage uses writable original-owner directories until final publication.
        for name in dirs:
            ordinary(root / name, True)
        for name in files:
            path = root / name
            key = path.relative_to(stage).as_posix()
            if key == LOCATION or key == HISTORY + "/" + archive_sha + ".json":
                continue
            need(key in wanted_files, "DATASET_ARCHIVE_UNEXPECTED_STAGE_MEMBER")
            file_digest(path, expected=wanted_files[key])
            found.add(key)
    if complete:
        need(found == set(wanted_files), "DATASET_ARCHIVE_STAGE_INCOMPLETE")

def receive_session(request, publish=False):
    archive, destination = absolute(request["archive"]), absolute(request["destination"])
    operation = request["operation"]
    need(OPERATION.fullmatch(operation) and HASH.fullmatch(request.get("expectedSha256", "")),
         "DATASET_ARCHIVE_EXACT_SOURCE_REQUIRED")
    private_root(destination.parent)
    package, manifest_raw = checked_archive(archive, request["expectedSha256"], request["maxBytes"], verify=not publish)
    manifest = package["manifest"]
    logical = absolute(manifest["sourceDirectory"])
    need(destination == logical or not within(destination, logical) and not within(logical, destination),
         "DATASET_LOCATION_ROOTS_OVERLAP")
    need(not within(destination, archive), "DATASET_ARCHIVE_INPUT_OVERLAPS_DESTINATION")
    control = destination.parent / (".sf88-receive-" + sha(str(destination).encode())[:24])
    binding = receive_binding(request, package, destination)
    with control_lease(control):
        intent = control / "intent.json"
        if intent.exists():
            need(parse(read(intent)) == binding, "DATASET_ARCHIVE_RECEIVE_SELECTION_CHANGED")
        else:
            need(not destination.exists(), "DATASET_ARCHIVE_DESTINATION_EXISTS")
            create_exact(intent, encoded(binding))
        record_path = control / "stage.json"
        record = parse(read(record_path)) if record_path.exists() else None
        if record is not None:
            need(isinstance(record, dict) and all(record.get(key) == value for key, value in binding.items()),
                 "DATASET_ARCHIVE_STAGE_SELECTION_CHANGED")
            stage = absolute(record["stage"])
            need(stage.parent == control and re.fullmatch(r"stage-[a-f0-9]{32}", stage.name),
                 "DATASET_ARCHIVE_STAGE_SELECTION_CHANGED")
        else:
            stage = control / ("stage-" + uuid.uuid4().hex)
        location_raw = encoded(stage_location(package, operation))
        if destination.exists():
            info = private_root(destination)
            need(record is not None and record["device"] == info.st_dev and record["inode"] == info.st_ino
                 and read(destination / LOCATION, 16384) == location_raw
                 and sha(read(destination / "session.json", 262144)) == manifest["sessionSha256"],
                 "DATASET_ARCHIVE_DESTINATION_CHANGED")
            record["state"] = "RECEIVED"
            replace_json(record_path, record)
            return summary(package, operation=operation, directory=str(destination), state="RECEIVED", reused=True)
        if record is None:
            stage.mkdir(mode=0o700)
            sync_directory(control)
            info = private_root(stage)
            record = {**binding, "stage": str(stage), "device": info.st_dev,
                      "inode": info.st_ino, "state": "RECEIVING"}
            create_exact(record_path, encoded(record))
        info = ordinary(stage, True)
        need(info.st_dev == record["device"] and info.st_ino == record["inode"],
             "DATASET_ARCHIVE_STAGE_IDENTITY_CHANGED")
        # Only recorded own directories regain write permission for continuation.
        for item in sorted(manifest["directories"], key=lambda item: item["path"].count("/")):
            target = stage / item["path"]
            if target.exists():
                ordinary(target, True)
                os.chmod(target, item["mode"] | 0o700)
            else:
                target.mkdir(mode=0o700)
                sync_directory(target.parent)
        selected_tree(stage, manifest, package["sha256"])
        if not publish:
            with zipfile.ZipFile(archive) as source:
                for item in manifest["files"]:
                    target = stage / item["path"]
                    if target.exists():
                        file_digest(target, expected=item)
                        continue
                    temporary = control / ("member-" + sha(item["path"].encode()) + ".partial")
                    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW, 0o600)
                    try:
                        info = os.fstat(fd)
                        need(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_uid == os.getuid(),
                             "DATASET_ARCHIVE_CONTROL_CHANGED")
                        os.ftruncate(fd, 0)
                        h, size = hashlib.sha256(), 0
                        with source.open("session/" + item["path"]) as input_:
                            with os.fdopen(fd, "wb", closefd=False) as output:
                                while True:
                                    raw = input_.read(BLOCK)
                                    if not raw:
                                        break
                                    size += len(raw)
                                    need(size <= item["bytes"], "DATASET_ARCHIVE_MEMBER_LIMIT")
                                    h.update(raw)
                                    output.write(raw)
                                output.flush()
                        need(size == item["bytes"] and h.hexdigest() == item["sha256"],
                             "DATASET_ARCHIVE_MEMBER_CHANGED")
                        os.fchmod(fd, item["mode"])
                        os.fsync(fd)
                    finally:
                        os.close(fd)
                    publish_absent(temporary, target)
            history = stage / HISTORY
            history.mkdir(mode=0o700, exist_ok=True)
            private_root(history)
            create_exact(history / (package["sha256"] + ".json"), manifest_raw, temporary_directory=control)
            create_exact(stage / LOCATION, location_raw, temporary_directory=control)
            selected_tree(stage, manifest, package["sha256"], complete=True)
            record["state"] = "PREPARED"
            replace_json(record_path, record)
            return summary(package, operation=operation, directory=str(stage), destination=str(destination),
                           state="PREPARED", reused=False)
        need(record["state"] in ("PREPARED", "PUBLISHING"), "DATASET_ARCHIVE_RECEIVE_PREPARATION_REQUIRED")
        need(read(stage / LOCATION, 16384) == location_raw and
             read(stage / HISTORY / (package["sha256"] + ".json")) == manifest_raw,
             "DATASET_ARCHIVE_CONTROL_CHANGED")
        selected_tree(stage, manifest, package["sha256"], complete=True)
        record["state"] = "PUBLISHING"
        replace_json(record_path, record)
        for item in sorted(manifest["directories"], key=lambda item: item["path"].count("/"), reverse=True):
            os.chmod(stage / item["path"], item["mode"])
        publish_absent(stage, destination)
        record["state"] = "RECEIVED"
        replace_json(record_path, record)
        return summary(package, operation=operation, directory=str(destination), state="RECEIVED", reused=False)

def main():
    request = parse(sys.stdin.buffer.read(MAX_MANIFEST + 1))
    need(isinstance(request, dict), "DATASET_ARCHIVE_REQUEST_REQUIRED")
    maximum = request.get("maxBytes", 2 * 1024**3)
    need(type(maximum) is int and 1 <= maximum <= MAX_TOTAL, "DATASET_ARCHIVE_TOTAL_LIMIT")
    request["maxBytes"] = maximum
    action = request.get("action")
    if action == "inspect":
        expected = request.get("expectedSha256")
        need(expected is None or HASH.fullmatch(expected), "DATASET_ARCHIVE_DIGEST_REQUIRED")
        package, _ = checked_archive(absolute(request["archive"]), expected, maximum)
        return summary(package, state="INSPECTED", operation=package["manifest"]["operation"])
    if action == "export":
        return export_session(request)
    if action in ("receive", "publish"):
        return receive_session(request, action == "publish")
    raise Failure("DATASET_ARCHIVE_ACTION_REQUIRED")

if __name__ == "__main__":
    try:
        result = main()
        sys.stdout.write(json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n")
    except Exception as error:
        code = error.code if isinstance(error, Failure) else (
            "DATASET_ARCHIVE_IO_" + errno.errorcode.get(error.errno, "FAILED")
            if isinstance(error, OSError) else "DATASET_ARCHIVE_INVALID")
        sys.stdout.write(json.dumps({"schema": SCHEMA, "state": "ERROR", "code": code}) + "\n")
        sys.exit(75 if code == "DATASET_ARCHIVE_OPERATION_RUNNING" else 2)
