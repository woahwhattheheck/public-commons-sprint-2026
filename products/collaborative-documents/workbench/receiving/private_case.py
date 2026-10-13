#!/usr/bin/env python3
"""Private packaging adapter for the complete original Node receiving programme.

The original application produces every project, Yjs binary and NDJSON-gzip
handover. This adapter selects its source, verifies its completed closed result
and packages that physical private operation without invoking business actions.
"""
from __future__ import annotations
import datetime
import fcntl
import hashlib
import json
import os
import re
import stat
import zipfile
from pathlib import Path, PurePosixPath

OPERATION = "TIPTAP-HOCUSPOCUS-APPLICATION-WORKSHARE-0C7A-20261012"
NATIVE_OPERATION = "TIPTAP-HOCUSPOCUS-WORKSHARE-0C7A-20261012"
INPUT_SCHEMA = "document-workshop.original-receiver-input.v1"
RESULT_SCHEMA = "document-workshop.original-receiver-closed.v1"
SOURCE_SCHEMA = "tjlabs.tiptap-source-manifest.v1"
CHUNK = 1024 * 1024
MAX_JSON = 64 * 1024 * 1024
MAX_CASE = 32 * 1024**3
HEX = re.compile(r"^[0-9a-f]{64}$")

class CourseError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def need(value, code, message):
    if not value:
        raise CourseError(code, message)


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True,
                       separators=(",", ":"), allow_nan=False) + "\n").encode("utf-8")


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        need(key not in result, "JSON_DUPLICATE", "An original JSON document repeats a field.")
        result[key] = value
    return result


def parse_json(raw):
    return json.loads(raw.decode("utf-8"), object_pairs_hook=unique_object,
                      parse_constant=lambda value: (_ for _ in ()).throw(
                          CourseError("JSON_NUMBER", "An original JSON number is not finite.")))


def relative(value):
    need(isinstance(value, str) and value and "\\" not in value
         and not any(ord(c) < 32 for c in value), "PATH", "Use an exact original relative path.")
    path = PurePosixPath(value)
    need(not path.is_absolute() and path.as_posix() == value
         and all(part not in ("", ".", "..") for part in path.parts),
         "PATH", "Use a normalized project-relative path.")
    return value


def absolute(value, directory=False, create=False, private=False):
    selected = Path(value)
    need(selected.is_absolute() and ".." not in selected.parts,
         "PATH", "Use an absolute original path.")
    for parent in [*reversed(selected.parents), selected]:
        try:
            information = parent.lstat()
        except FileNotFoundError:
            need(create and directory, "PATH_MISSING", "The selected original path is absent: " + str(parent))
            parent.mkdir(mode=0o700)
            sync_directory(parent.parent)
            information = parent.lstat()
        need(not stat.S_ISLNK(information.st_mode), "PATH_LINK", "The selected path is linked: " + str(parent))
        if parent != selected or directory:
            need(stat.S_ISDIR(information.st_mode), "PATH_DIRECTORY", "The original path parent is not a directory.")
    if private:
        information = selected.lstat()
        need(information.st_uid == os.getuid() and not (information.st_mode & 0o077),
             "PRIVATE_PATH", "Keep this original case path private: " + str(selected))
    return selected


def sync_directory(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def private_directory(value):
    return absolute(value, directory=True, create=True, private=True)


def identity(information):
    return (information.st_dev, information.st_ino, information.st_size,
            information.st_mtime_ns, information.st_ctime_ns, stat.S_IMODE(information.st_mode))


def same_inode(left, right):
    return (left.st_dev, left.st_ino) == (right.st_dev, right.st_ino)


def inspect_file(filename, expected=None, *, capture=False, maximum=MAX_CASE,
                 private=False, stop=None):
    filename = absolute(filename)
    number, first, result = None, None, None
    try:
        number = os.open(filename, os.O_RDONLY | os.O_NOFOLLOW)
        before = os.fstat(number)
        need(stat.S_ISREG(before.st_mode) and before.st_size <= maximum,
             "FILE_BOUND", "Select a complete bounded regular file: " + str(filename))
        if private:
            need(before.st_uid == os.getuid() and not before.st_mode & 0o077,
                 "PRIVATE_FILE", "The original file must remain private.")
        checksum = hashlib.sha256()
        git_checksum = hashlib.sha1(("blob " + str(before.st_size) + "\0").encode("ascii")) if expected is not None and "git_blob_sha" in expected else None
        chunks, size = ([] if capture else None), 0
        while True:
            if stop is not None:
                stop.check()
            chunk = os.read(number, CHUNK)
            if not chunk:
                break
            size += len(chunk)
            need(size <= maximum, "FILE_BOUND", "The original file grew beyond its declared bound.")
            checksum.update(chunk)
            if git_checksum is not None:
                git_checksum.update(chunk)
            if capture:
                chunks.append(chunk)
        after, current = os.fstat(number), filename.lstat()
        if stop is not None:
            stop.check()
        if git_checksum is not None:
            need(git_checksum.hexdigest() == expected["git_blob_sha"], "SOURCE_GIT_BLOB",
                 "The complete original Git source blob differs: " + str(filename))
        need(size == before.st_size and identity(before) == identity(after) == identity(current),
             "FILE_CHANGED", "The original file changed while reading: " + str(filename))
        value = {"path": str(filename), "bytes": size, "sha256": checksum.hexdigest(),
                 "mode": stat.S_IMODE(after.st_mode)}
        if expected is not None:
            need(type(expected.get("bytes")) is int and expected["bytes"] == size
                 and expected.get("sha256") == value["sha256"],
                 "FILE_CHANGED", "The complete original file differs from its selected bytes: " + str(filename))
            if "mode" in expected and type(expected["mode"]) is int:
                need(expected["mode"] == value["mode"], "FILE_MODE", "The original file mode differs.")
        result = (value, b"".join(chunks)) if capture else value
    except BaseException as error:
        first = error
    finally:
        if number is not None:
            closing, number = number, None
            try:
                os.close(closing)
            except BaseException as error:
                first = first or error
    if first:
        raise first
    return result

def descriptor(value, *, private=False, capture=False, maximum=MAX_CASE, stop=None):
    need(isinstance(value, dict) and HEX.fullmatch(value.get("sha256", "")) is not None
         and type(value.get("bytes")) is int and 0 <= value["bytes"] <= maximum,
         "FILE_SELECTION", "Supply the exact original file path, byte count and SHA-256.")
    return inspect_file(value["path"], value, private=private, capture=capture,
                        maximum=maximum, stop=stop)


def selected_file(value, *, private=False, maximum=MAX_JSON):
    information, raw = descriptor(value, private=private, capture=True, maximum=maximum)
    return parse_json(raw), information, raw


def short_file(value):
    return {key: value[key] for key in ("path", "bytes", "sha256")}


def read_json(path, *, private=True):
    information, raw = inspect_file(path, private=private, capture=True, maximum=MAX_JSON)
    return parse_json(raw), information


def safe_unlink_temporary(filename):
    if not filename.exists() and not filename.is_symlink():
        return
    information = filename.lstat()
    need(stat.S_ISREG(information.st_mode) and information.st_uid == os.getuid()
         and not (information.st_mode & 0o077), "TEMPORARY_OWNER",
         "The original owned temporary changed its type or privacy.")
    filename.unlink()
    sync_directory(filename.parent)


def publish_bytes(path, raw, *, replace=False):
    path = Path(path)
    private_directory(path.parent)
    expected = {"bytes": len(raw), "sha256": digest(raw), "mode": 0o600}
    if path.exists() or path.is_symlink():
        current = inspect_file(path, private=True)
        if current["bytes"] == len(raw) and current["sha256"] == expected["sha256"]:
            sync_directory(path.parent)
            return current
        need(replace, "PUBLICATION_CONFLICT", "This original publication already has different bytes: " + str(path))
    temporary = path.parent / (".native-next-" + digest(str(path).encode("utf-8")) + ".tmp")
    # This function runs only under the matching original course intent/flock.
    safe_unlink_temporary(temporary)
    descriptor_number = None
    first = None
    temporary_identity = None
    try:
        descriptor_number = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        temporary_identity = os.fstat(descriptor_number)
        for offset in range(0, len(raw), CHUNK):
            chunk, written = raw[offset:offset + CHUNK], 0
            while written < len(chunk):
                count = os.write(descriptor_number, chunk[written:])
                need(count > 0, "WRITE_FAILED", "The complete original publication did not advance.")
                written += count
        os.fsync(descriptor_number)
        closing, descriptor_number = descriptor_number, None
        os.close(closing)
        if replace:
            os.replace(temporary, path)
        else:
            try:
                os.link(temporary, path, follow_symlinks=False)
            except FileExistsError:
                inspect_file(path, expected, private=True)
        sync_directory(path.parent)
    except BaseException as error:
        first = error
    finally:
        if descriptor_number is not None:
            closing, descriptor_number = descriptor_number, None
            try:
                os.close(closing)
            except BaseException as error:
                first = first or error
        if temporary.exists() or temporary.is_symlink():
            try:
                need(temporary_identity is not None and same_inode(temporary.lstat(), temporary_identity),
                     "TEMPORARY_OWNER", "The original publication temporary changed identity.")
                temporary.unlink()
                sync_directory(temporary.parent)
            except BaseException as error:
                first = first or error
    if first:
        raise first
    return inspect_file(path, expected, private=True)


def publish_json(path, value, *, replace=False):
    return publish_bytes(path, json_bytes(value), replace=replace)


def owned_tree_files(root, *, excluded=()):
    root = absolute(root, directory=True)
    excluded = set(excluded)
    result = []
    for directory, directories, files in os.walk(root, followlinks=False):
        current = Path(directory)
        directories.sort()
        files.sort()
        kept = []
        for name in directories:
            item = current / name
            relative_path = item.relative_to(root).as_posix()
            if relative_path in excluded:
                continue
            information = item.lstat()
            need(stat.S_ISDIR(information.st_mode) and not stat.S_ISLNK(information.st_mode),
                 "CASE_DIRECTORY", "A closed original case directory changed its type: " + relative_path)
            kept.append(name)
        directories[:] = kept
        for name in files:
            item = current / name
            relative_path = item.relative_to(root).as_posix()
            if relative_path in excluded:
                continue
            information = item.lstat()
            need(stat.S_ISREG(information.st_mode) and not stat.S_ISLNK(information.st_mode),
                 "CASE_FILE", "The closed original case contains a non-regular member: " + relative_path)
            result.append((relative_path, item))
    return result



REQUIRED_SOURCE = frozenset(["CORE-CONTRACT.md","LICENSE","OPERATOR.md","README.md","SOURCE-CONTRACT.md","WORKSHARE.md","cli.mjs","core/archive.mjs","core/auth.mjs","core/common.mjs","core/jobs.mjs","core/migration.mjs","core/objects.mjs","core/store.mjs","core/uploads.mjs","core/workspace.mjs","delivery/render_workshare.py","delivery/workshare-input.json","native/runtime.mjs","native/selection.mjs","package-lock.json","package.json","receiving/browser.mjs","receiving/receive.mjs","reference/documents.json","reference/schema.mjs","runtime/ORIGINAL_SOURCE_RECEIVING.json","runtime/RUNTIME.md","runtime/archive.py","runtime/client.mjs","runtime/inspect.mjs","runtime/manage.py","runtime/sources.py","runtime/upstreams.json","scripts/build.mjs","scripts/install.mjs","server.mjs","vendor/stellar-expert/LICENSE","vendor/stellar-expert/SOURCE.json","vendor/stellar-expert/exact-json.mjs","vendor/stellar-expert/provider.mjs","vendor/stellar-expert/schema.mjs","vendor/stellar-expert/store.mjs","web/app.mjs","web/editor.mjs","web/index.html","web/style.css","receiving/private_case.py","receiving/run_and_save.py","receiving/SAVING.md"])
REFERENCE = {"path": "reference/documents.json", "bytes": 3818,
             "sha256": "752bb3a767e5b2f456308df021bff017059e0631fb4370f31509346ad3a45237"}

def source_manifest(application, binding, *, stop=None):
    selected, information, raw = selected_file(binding, private=False)
    need(selected.get("schema") == SOURCE_SCHEMA and isinstance(selected.get("sourceRef"), str)
         and selected["sourceRef"] and selected.get("repository") == "woahwhattheheck/commons"
         and isinstance(selected.get("files"), list) and selected["files"],
         "SOURCE_SELECTION", "Select the complete original application source manifest.")
    application = absolute(application, directory=True)
    names, total = set(), 0
    for row in selected["files"]:
        name = relative(row.get("path"))
        need(name not in names, "SOURCE_DUPLICATE", "The complete source repeats a path.")
        names.add(name)
        expected = dict(row)
        if row.get("gitBlob"):
            need(re.fullmatch(r"[0-9a-f]{40}", row["gitBlob"]), "SOURCE_GIT", "Invalid original Git blob.")
            expected["git_blob_sha"] = row["gitBlob"]
        actual = inspect_file(application / name, expected, stop=stop)
        total += actual["bytes"]
        need(total <= 256 * 1024**2, "SOURCE_BOUND", "The complete source exceeds its declared bound.")
    need(REQUIRED_SOURCE <= names, "SOURCE_INCOMPLETE",
         "Retain the original complete product and save adapter: " + ", ".join(sorted(REQUIRED_SOURCE - names)))
    inspect_file(application / REFERENCE["path"], REFERENCE)
    return selected, information, raw


def runtime_selection(source, binding, node):
    ready, info, _ = selected_file(binding, private=False)
    need(ready.get("schema") == "tjlabs.tiptap-runtime-ready.v1" and ready.get("state") == "ready"
         and ready.get("sourceRoot") == str(source) and ready.get("node", {}).get("executable") == node["path"]
         and re.fullmatch(r"v24\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?", ready["node"].get("version", "")),
         "RUNTIME_SELECTION", "Keep the actual original Node 24 installation receipt and its source location.")
    need(ready.get("schemaSelection", {}).get("schemaId") == "reference-v1"
         and ready["schemaSelection"].get("field") == "default"
         and HEX.fullmatch(ready.get("selectionSha256", "")),
         "RUNTIME_SCHEMA", "Keep the original shared reference-v1/default schema.")
    for name, selected in (("package.json", ready.get("packageJson")),
                           ("package-lock.json", ready.get("lockfile")),
                           ("reference/schema.mjs", ready.get("schemaSelection"))):
        need(isinstance(selected, dict), "RUNTIME_DESCRIPTOR", "Retain the actual runtime-selected file.")
        inspect_file(source / name, selected)
    packages = ready.get("packages")
    need(isinstance(packages, list) and packages, "RUNTIME_PACKAGES", "Retain the complete original package selection.")
    package, _ = read_json(source / "package.json", private=False)
    names = set()
    for row in packages:
        need(row.get("name") not in names and package["dependencies"].get(row.get("name")) == row.get("version"),
             "RUNTIME_PACKAGES", "The installed dependency differs from the original locked selection.")
        names.add(row["name"])
        for key, sha_key in (("modulePath", "moduleSha256"), ("packagePath", "packageJsonSha256")):
            selected = absolute(row[key])
            need(source in selected.parents, "RUNTIME_LOCATION", "Keep dependencies inside their original installation.")
            need(inspect_file(selected)["sha256"] == row[sha_key], "RUNTIME_PACKAGE_BYTES", "An installed original package changed.")
    need(names == set(package["dependencies"]), "RUNTIME_PACKAGES", "The complete direct installed dependency set differs.")
    return ready, short_file(info)


def native_input(value):
    need(value.get("schema") == INPUT_SCHEMA and value.get("operation") == OPERATION
         and value.get("nativeOperation") == NATIVE_OPERATION
         and isinstance(value.get("caseId"), str) and re.fullmatch(r"[0-9a-f]{32}", value["caseId"]),
         "NATIVE_INPUT", "Keep the original complete receiving selection.")
    source = absolute(value["source"], directory=True)
    case = absolute(value["directory"], directory=True, private=True)
    manifest, _, _ = source_manifest(source, value["sourceManifest"])
    node = descriptor(value["node"])
    ready, ready_file = runtime_selection(source, value["runtimeReady"], node)
    playwright, chromium = descriptor(value["playwright"]), descriptor(value["chromium"])
    need(os.access(node["path"], os.X_OK) and os.access(chromium["path"], os.X_OK),
         "NATIVE_EXECUTABLE", "Select the actual executable Node and Chromium files.")
    receiving = absolute(value["receivingSource"], directory=True)
    need(receiving != source and receiving not in source.parents and source not in receiving.parents,
         "RECEIVING_INSTALLATION", "Use the independent installed receiving source tree.")
    source_manifest(receiving, value["sourceManifest"])
    receiving_ready, receiving_file = runtime_selection(receiving, value["receivingRuntimeReady"], node)
    need(receiving_ready["node"] == ready["node"], "RUNTIME_NODE", "Both original installations must select the same actual Node.")
    for installation in (source, receiving):
        need(case != installation and case not in installation.parents and installation not in case.parents,
             "CASE_PLACEMENT", "Keep private receiving state outside installed source.")
    return {"operationId": NATIVE_OPERATION, "source": str(source), "sourceRef": manifest["sourceRef"],
            "sourceManifestSha256": value["sourceManifest"]["sha256"],
            "runtimeReadySha256": ready_file["sha256"], "runtimeReadyFile": ready_file["path"],
            "node": ready["node"], "reference": REFERENCE,
            "playwright": playwright["path"], "chromium": chromium["path"],
            "receivingInstallation": {"source": str(receiving), "sourceManifestSha256": value["sourceManifest"]["sha256"],
                "runtimeReadyFile": receiving_file["path"], "runtimeReadySha256": receiving_file["sha256"]}}


class DirectoryLease:
    """Use the original Node receiver's exact flock on its directory inode."""
    def __init__(self, root, *, directory=True):
        self.root = absolute(root, directory=directory, private=True)
        self.fd, self.before = None, None
        try:
            self.fd = os.open(self.root, os.O_RDONLY | os.O_NOFOLLOW | (os.O_DIRECTORY if directory else 0))
            self.before = os.fstat(self.fd)
            fcntl.flock(self.fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.assert_owned()
        except BaseException as error:
            if self.fd is not None:
                closing, self.fd = self.fd, None
                try:
                    os.close(closing)
                except BaseException as cleanup:
                    raise error from cleanup
            raise
    def assert_owned(self):
        need(self.fd is not None and same_inode(self.before, os.fstat(self.fd))
             and same_inode(self.before, self.root.lstat()), "CASE_LEASE_CHANGED", "The original receiver directory changed.")
    def close(self):
        if self.fd is not None:
            closing, self.fd = self.fd, None
            os.close(closing)


EXCLUDED = frozenset({
    "private-auth.json",
    "source-workspace/local-session-secret", "receiving-workspace/local-session-secret",
    "browser-working/profiles", "browser-working/tmp",
    "browser-receiving/profiles", "browser-receiving/tmp",
})

def case_members(root):
    rows = []
    for name, filename in owned_tree_files(root, excluded=EXCLUDED):
        if name.endswith("/workspace.lock") or ".tmp-" in Path(name).name:
            continue
        # Private operation state is copied with private ZIP member permissions;
        # source mode is retained separately in the manifest.
        info = inspect_file(filename)
        rows.append({"path": name, "bytes": info["bytes"], "sha256": info["sha256"],
                     "mode": 0o600, "sourceMode": info["mode"]})
    need(sum(row["bytes"] for row in rows) <= MAX_CASE and len(rows) <= 100000,
         "CASE_BOUND", "The complete closed case exceeds its original bounds.")
    return rows


def closed_receipt(root, subdirectory, schema, original_input, result_file, flags):
    path = Path(root) / subdirectory
    need(path.exists() or path.is_symlink(), "OWNER_CLOSURE_MISSING",
         "The original completed result needs its local post-lease closure publication.")
    directory = absolute(path, directory=True, private=True)
    # The Node producer hashes exactly JSON.stringify(input, null, 2) + newline.
    raw = (json.dumps(original_input, ensure_ascii=False, indent=2, allow_nan=False) + "\n").encode("utf-8")
    input_sha = digest(raw)
    selected = []
    for path in sorted(directory.iterdir(), key=lambda item: item.name):
        if not path.name.endswith(".json"):
            continue
        receipt, info = read_json(path)
        need(receipt.get("schema") == schema and receipt.get("operationId") == NATIVE_OPERATION
             and isinstance(receipt.get("attemptId"), str) and path.name == receipt["attemptId"] + ".json",
             "OWNER_CLOSURE", "Retain each complete original owner-closure publication.")
        expected_result = {"path": "result.json", "bytes": result_file["bytes"], "sha256": result_file["sha256"]}
        bound_result = receipt.get("result")
        if not isinstance(bound_result, dict) or {key: bound_result.get(key) for key in ("path", "bytes", "sha256")} != expected_result:
            continue
        need(receipt.get("inputSha256") == input_sha and isinstance(receipt.get("closedAt"), str)
             and isinstance(receipt.get("closed"), dict)
             and all(receipt["closed"].get(name) is True for name in flags),
             "OWNER_CLOSURE", "The completed original result lacks its actual full owner closure.")
        selected.append((receipt["closedAt"], {"value": receipt, "file": short_file(info)}))
    need(selected, "OWNER_CLOSURE_MISSING", "The original completed result has no post-lease owner-closure receipt.")
    return max(selected, key=lambda pair: pair[0])[1]


def completed_result(value, *, expected=None, require_closures=True):
    root = absolute(value["directory"], directory=True, private=True)
    selected_input = native_input(value)
    result, info = read_json(root / "result.json")
    if expected is not None:
        inspect_file(root / "result.json", expected, private=True)
    ledger, _ = read_json(root / "receiving.json")
    need(result.get("schema") == "tjlabs.tiptap-receiving-result.v1"
         and result.get("operationId") == NATIVE_OPERATION and result.get("state") == "complete"
         and result.get("input") == selected_input and isinstance(result.get("ownersClosedAt"), str)
         and result.get("referenceDocuments") == 3 and result.get("tenants") == 2
         and ledger.get("schema") == "tjlabs.tiptap-receiving.v1"
         and ledger.get("input") == selected_input and ledger.get("finalCandidate") == result,
         "NATIVE_RESULT", "The original immutable result and journal must select the same completed, closed course.")
    required = {"nativeMigration", "concurrentEditors", "completeDeletionPersistence",
                "offlineNativeMerge", "tenantIsolation", "oldEpochIsolation",
                "configurationPreservesContent", "originalHTTPReplay",
                "freshSameForwardOlderReceiving", "historicalRevision", "reopen", "desktopMobile"}
    need(isinstance(result.get("checks"), dict) and all(result["checks"].get(k) is True for k in required),
         "NATIVE_COURSE", "The complete original receiving course has unfinished outcomes.")
    need(isinstance(result.get("files"), list) and result["files"], "NATIVE_FILES", "Retain all actual original outputs.")
    names = set()
    for row in result["files"]:
        name = relative(row.get("path"))
        need(name not in names, "NATIVE_FILES", "The original output inventory repeats a path.")
        names.add(name)
        inspect_file(root / name, row)
    closures, browser_results = {}, {}
    for browser in ("browser-working", "browser-receiving"):
        browser_result, browser_file = read_json(root / browser / "result.json")
        need(browser_result.get("state") == "complete" and browser_result.get("ownersClosedAt"),
             "BROWSER_CLOSED", "Retain both completed original browser journeys after actual owner closure.")
        browser_results[browser] = (browser_result, browser_file)
    need(all(row.get("closedAt") for row in ledger.get("servers", {}).values())
         and {"source", "receiving"} <= set(ledger.get("servers", {})),
         "NATIVE_OWNERS", "The original source and receiving server owners must both be closed.")
    if require_closures:
        need(ledger.get("state") == "complete", "NATIVE_LOCAL_PUBLICATION_PENDING",
             "The original immutable result needs its same-case completed journal publication.")
        closures["receiving"] = closed_receipt(root, "receiving-closures",
                "tjlabs.tiptap-receiving-owner-closed.v1", result["input"], info,
                ("applications", "browserJourneys", "httpBodies", "files", "lease"))
        for browser, (browser_result, browser_file) in browser_results.items():
            closures[browser] = closed_receipt(root / browser, "owner-closures",
                "tjlabs.tiptap-browser-owner-closed.v1", browser_result["input"], browser_file,
                ("browser", "contexts", "downloads", "tasks", "files", "lease", "operator", "profiles"))
    return result, short_file(info), closures

def inspect_case_archive(filename, expected=None):
    information = inspect_file(filename, expected, private=True, maximum=MAX_CASE + 128 * 1024 * 1024)
    with zipfile.ZipFile(information["path"], "r") as archive:
        members = archive.infolist()
        need(len(members) <= 100_002 and len({row.filename for row in members}) == len(members),
             "PRIVATE_CASE_ZIP", "The complete private archive has duplicate or excessive members.")
        manifest_member = archive.getinfo("PRIVATE_CASE.json")
        need(manifest_member.file_size <= MAX_JSON, "PRIVATE_CASE_ZIP", "The complete private manifest exceeds its bound.")
        manifest_raw = archive.read(manifest_member)
        manifest = parse_json(manifest_raw)
        need(manifest.get("schema") == "document-workshop.private-case.v1"
             and manifest.get("operation") == OPERATION and isinstance(manifest.get("files"), list),
             "PRIVATE_CASE_ZIP", "The private archive has another original case schema.")
        expected_rows = {}
        total = 0
        for row in manifest["files"]:
            name = relative(row.get("path"))
            need(name != "PRIVATE_CASE.json" and name not in expected_rows
                 and type(row.get("bytes")) is int and row["bytes"] >= 0
                 and HEX.fullmatch(row.get("sha256", "")) is not None
                 and type(row.get("mode")) is int,
                 "PRIVATE_CASE_ZIP", "The original complete archive inventory is invalid.")
            expected_rows[name] = row
            total += row["bytes"]
        need(total <= MAX_CASE and {row.filename for row in members} == set(expected_rows) | {"PRIVATE_CASE.json"},
             "PRIVATE_CASE_ZIP", "The complete private archive member set differs.")
        for member in members:
            need(not member.is_dir() and not stat.S_ISLNK(member.external_attr >> 16)
                 and member.compress_type in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED)
                 and not member.flag_bits & 1,
                 "PRIVATE_CASE_ZIP", "Use only the complete ordinary original private members.")
            if member.filename == "PRIVATE_CASE.json":
                continue
            row = expected_rows[member.filename]
            need(member.file_size == row["bytes"] and stat.S_IMODE(member.external_attr >> 16) == row["mode"],
                 "PRIVATE_CASE_ZIP", "An original archived length or mode differs.")
            checksum = hashlib.sha256()
            count = 0
            with archive.open(member) as stream:
                while True:
                    chunk = stream.read(CHUNK)
                    if not chunk:
                        break
                    count += len(chunk)
                    need(count <= row["bytes"], "PRIVATE_CASE_ZIP", "An original archived member grew.")
                    checksum.update(chunk)
            need(count == row["bytes"] and checksum.hexdigest() == row["sha256"],
                 "PRIVATE_CASE_ZIP", "The complete original archived bytes differ.")
    inspect_file(filename, information, private=True)
    return {**short_file(information), "manifestSha256": digest(manifest_raw),
            "members": len(manifest["files"]), "uncompressedBytes": total,
            "state": manifest["state"], "caseId": manifest["caseId"],
            "inputSha256": manifest["inputSha256"]}


def write_case_archive(root, manifest, guard, destination):
    guard.assert_owned()
    raw = json_bytes(manifest)
    manifest_sha = digest(raw)
    directory = private_directory(destination)
    manifest_path = directory / (manifest_sha + ".manifest.json")
    publish_bytes(manifest_path, raw)
    filename = directory / ("DOCUMENT_WORKSHOP_CASE_" + manifest_sha + ".zip")
    if filename.exists():
        actual = inspect_case_archive(filename)
        need(actual["manifestSha256"] == manifest_sha,
             "PRIVATE_CASE_CONFLICT", "The retained archive belongs to another complete case snapshot.")
        sync_directory(directory)
        return actual
    temporary = directory / (".case-" + manifest_sha + ".tmp")
    safe_unlink_temporary(temporary)
    raw_fd, stream, archive = None, None, None
    first, temporary_identity = None, None
    try:
        raw_fd = os.open(temporary, os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        temporary_identity = os.fstat(raw_fd)
        stream = os.fdopen(raw_fd, "w+b")
        raw_fd = None
        archive = zipfile.ZipFile(stream, "w", compression=zipfile.ZIP_DEFLATED,
                                  compresslevel=6, allowZip64=True)
        for row in [{"path": "PRIVATE_CASE.json", "bytes": len(raw), "sha256": manifest_sha, "mode": 0o600},
                    *manifest["files"]]:
            name = relative(row["path"])
            member = zipfile.ZipInfo(name)
            member.create_system = 3
            need(type(row["mode"]) is int and 0 <= row["mode"] <= 0o777 and not row["mode"] & 0o077,
                 "PRIVATE_CASE_MODE", "Keep every complete original case member private.")
            member.external_attr = (stat.S_IFREG | row["mode"]) << 16
            member.compress_type = zipfile.ZIP_DEFLATED
            member.file_size = row["bytes"]
            if name == "PRIVATE_CASE.json":
                archive.writestr(member, raw)
                continue
            filename_source = absolute(Path(root) / name)
            source_fd, source_error = None, None
            try:
                source_fd = os.open(filename_source, os.O_RDONLY | os.O_NOFOLLOW)
                before = os.fstat(source_fd)
                need(stat.S_ISREG(before.st_mode) and before.st_size == row["bytes"],
                     "CASE_SOURCE", "The selected original case member changed.")
                checksum, count = hashlib.sha256(), 0
                with archive.open(member, "w", force_zip64=row["bytes"] >= 2 * 1024**3) as destination:
                    while True:
                        chunk = os.read(source_fd, CHUNK)
                        if not chunk:
                            break
                        count += len(chunk)
                        need(count <= row["bytes"], "CASE_SOURCE", "The original case member grew.")
                        checksum.update(chunk)
                        destination.write(chunk)
                need(count == row["bytes"] and checksum.hexdigest() == row["sha256"]
                     and identity(before) == identity(os.fstat(source_fd)) == identity(filename_source.lstat()),
                     "CASE_SOURCE", "The complete original case member changed during packaging.")
            except BaseException as error:
                source_error = error
            finally:
                if source_fd is not None:
                    closing_source, source_fd = source_fd, None
                    try:
                        os.close(closing_source)
                    except BaseException as error:
                        source_error = source_error or error
            if source_error:
                raise source_error
        closing, archive = archive, None
        closing.close()
        stream.flush()
        os.fsync(stream.fileno())
        closing, stream = stream, None
        closing.close()
        verified = inspect_case_archive(temporary)
        need(verified["manifestSha256"] == manifest_sha, "PRIVATE_CASE_ZIP", "The completed private ZIP changed its input.")
        try:
            os.link(temporary, filename, follow_symlinks=False)
        except FileExistsError:
            inspect_case_archive(filename, verified)
        sync_directory(directory)
        guard.assert_owned()
    except BaseException as error:
        first = error
    finally:
        for resource in (archive, stream):
            if resource is not None:
                try:
                    resource.close()
                except BaseException as error:
                    first = first or error
        if raw_fd is not None:
            closing, raw_fd = raw_fd, None
            try:
                os.close(closing)
            except BaseException as error:
                first = first or error
        if temporary.exists() or temporary.is_symlink():
            try:
                need(temporary_identity is not None and same_inode(temporary.lstat(), temporary_identity),
                     "TEMPORARY_OWNER", "The original case temporary changed.")
                temporary.unlink()
                sync_directory(directory)
            except BaseException as error:
                first = first or error
    if first:
        raise first
    result = inspect_case_archive(filename)
    need(result["manifestSha256"] == manifest_sha, "PRIVATE_CASE_ZIP", "The published case inventory differs.")
    return result



def package_completed(value, input_information, save_directory, save_guard):
    root = absolute(value["directory"], directory=True, private=True)
    lease, first, output = None, None, None
    owners = []
    try:
        lease = DirectoryLease(root)
        # These are the exact original application/browser leases. Holding
        # their real inodes prevents an independently opened owner mutating a
        # closed workspace while its physical files are copied.
        for name, directory in (("source-workspace/workspace.lock", False),
                                ("receiving-workspace/workspace.lock", False),
                                ("browser-working", True), ("browser-receiving", True)):
            owners.append(DirectoryLease(root / name, directory=directory))
        native_result, result_file, closures = completed_result(value)
        destination = private_directory(Path(save_directory) / "cases" / result_file["sha256"])
        manifest = {"schema": "document-workshop.private-case.v1", "operation": OPERATION,
                    "nativeOperation": NATIVE_OPERATION, "caseId": value["caseId"], "state": "COMPLETED",
                    "inputSha256": input_information["sha256"], "nativeResult": result_file,
                    "sourceManifest": value["sourceManifest"], "nativeInput": value,
                    "ownerClosures": closures,
                    "excludedPrivateState": sorted(EXCLUDED),
                    "files": case_members(root)}
        lease.assert_owned()
        save_guard.assert_owned()
        archive = write_case_archive(root, manifest, lease, destination)
        need(manifest["files"] == case_members(root), "CASE_CHANGED", "The complete original case changed while packaging.")
        completed_result(value, expected=result_file)
        save_guard.assert_owned()
        closed = {"schema": RESULT_SCHEMA, "operation": OPERATION, "nativeOperation": NATIVE_OPERATION,
                  "caseId": value["caseId"], "status": "COMPLETED",
                  "inputSha256": input_information["sha256"], "nativeOutcome": result_file,
                  "nativeResult": native_result, "sourceManifest": value["sourceManifest"],
                  "privateCase": archive}
        info = publish_json(destination / "CLOSED_CASE.json", closed)
        output = {"value": closed, "file": short_file(info), "archive": archive}
    except BaseException as error:
        first = error
    finally:
        for owner in reversed(owners):
            try:
                owner.close()
            except BaseException as error:
                first = first or error
        if lease is not None:
            try:
                lease.close()
            except BaseException as error:
                first = first or error
    if first:
        raise first
    return output
