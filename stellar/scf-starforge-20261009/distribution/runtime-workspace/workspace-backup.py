#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Streaming complete Runtime workspace backup and exact-location receiving.
Invoked by workspace-backup.mjs, using the original workspace kernel gate.
External path references are declared, never traversed or silently copied.
"""
import contextlib, datetime, errno, fcntl, hashlib, io, json, os, pathlib, re, stat, sys, tarfile, uuid

SCHEMA = "stellar-forge.runtime-workspace-backup.v1"
RECEIVING_SCHEMA = "stellar-forge.runtime-workspace-receiving.v1"
MARKER = ".workspace-backup-receiving.json"
GATE = ".workspace-backup.lock"
MAX_MANIFEST = 64 * 1024 * 1024
MAX_FILES = 250000
MAX_BYTES = 64 * 1024 * 1024 * 1024
CHUNK = 1024 * 1024

class Failure(Exception):
    def __init__(self, code, message):
        super().__init__(message); self.code = code

def require(value, code, message):
    if not value: raise Failure(code, message)

def timestamp():
    return datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z")

def encoded(value):
    return (json.dumps(value, sort_keys=True, ensure_ascii=False, indent=2) + "\n").encode("utf-8")

def sha(bytes_):
    return hashlib.sha256(bytes_).hexdigest()

def absolute(value):
    require(isinstance(value, str) and value and "\0" not in value and os.path.abspath(value) == value,
            "WORKSPACE_BACKUP_PATH", "Use an absolute canonical path.")
    return pathlib.Path(value)

def private(path):
    path = absolute(str(path)); info = path.lstat()
    require(stat.S_ISDIR(info.st_mode) and not path.is_symlink() and path.resolve() == path and
            info.st_uid == os.getuid() and not info.st_mode & 0o077,
            "WORKSPACE_BACKUP_PRIVATE_DIRECTORY", "Use a private real directory owned by this operator: " + str(path))
    return path

def make_private(path):
    path = absolute(str(path))
    require(path.parent.resolve() == path.parent, "WORKSPACE_BACKUP_PARENT", "Use a real destination parent.")
    try:
        path.mkdir(mode=0o700); fsync_directory(path.parent)
    except FileExistsError: pass
    return private(path)

def identifier(value):
    require(isinstance(value, str) and re.fullmatch(r"[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}", value),
            "WORKSPACE_BACKUP_REQUEST", "Keep the original request UUID.")
    return value

def digest_id(value):
    require(isinstance(value, str) and re.fullmatch(r"[a-f0-9]{64}", value),
            "WORKSPACE_BACKUP_DIGEST", "Keep the complete SHA-256 identity.")
    return value

def fsync_directory(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try: os.fsync(fd)
    finally: os.close(fd)

def atomic(path, data):
    data = data if isinstance(data, bytes) else encoded(data)
    temp = path.with_name(path.name + ".pending-" + str(uuid.uuid4()))
    fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(data); handle.flush(); os.fsync(handle.fileno())
        os.replace(temp, path); fsync_directory(path.parent)
    finally:
        if temp.exists(): temp.unlink()

def read_json(path, optional=False, maximum=MAX_MANIFEST):
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    except FileNotFoundError:
        if optional: return None
        raise
    with os.fdopen(fd, "rb") as handle:
        before = os.fstat(handle.fileno())
        require(stat.S_ISREG(before.st_mode) and before.st_size <= maximum,
                "WORKSPACE_BACKUP_RECORD", "The retained record is not a bounded regular file.")
        data = handle.read(maximum + 1); after = os.fstat(handle.fileno())
    require(signature(before) == signature(after) and len(data) == before.st_size,
            "WORKSPACE_BACKUP_CHANGED", "The retained record changed while reading.")
    return json.loads(data.decode("utf-8"))

def signature(info):
    return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns, info.st_mode)

def regular_hash(path, expected=None):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, "rb") as handle:
        before = os.fstat(handle.fileno())
        require(stat.S_ISREG(before.st_mode), "WORKSPACE_BACKUP_FILE", "Only original regular files can be captured.")
        if expected: require(signature(before) == expected, "WORKSPACE_BACKUP_CHANGED", "Source changed before copying.")
        digest = hashlib.sha256(); length = 0
        while True:
            chunk = handle.read(CHUNK)
            if not chunk: break
            digest.update(chunk); length += len(chunk)
        after = os.fstat(handle.fileno())
    require(signature(before) == signature(after) and before.st_size == length,
            "WORKSPACE_BACKUP_CHANGED", "Source changed while reading: " + str(path))
    return {"bytes": length, "sha256": digest.hexdigest()}, signature(before)

def inside(path, root):
    return path == root or root in path.parents

def relative_name(value):
    require(isinstance(value, str) and value and "\0" not in value and "\\" not in value and
            not value.startswith("/") and all(x not in ("", ".", "..") for x in value.split("/")),
            "WORKSPACE_BACKUP_MEMBER", "Archive member has an invalid relative path.")
    return value


def relocated_config(root, config):
    marker = read_json(root / MARKER, optional=True)
    return (isinstance(marker, dict) and marker.get("schema") == RECEIVING_SCHEMA and
            marker.get("mode") == "new-host" and marker.get("directory") == str(root) and
            marker.get("originalDirectory") == config.get("directory") and
            marker.get("workspaceId") == config.get("workspaceId"))

def source_directory(manifest):
    return manifest.get("sourceDirectory", manifest["workspace"]["directory"])

def receiving_mode(params, manifest):
    mode = params.get("mode", "original")
    require(mode in ("original", "new-host"), "WORKSPACE_BACKUP_MODE", "Choose original-path or explicit new-host receiving.")
    # Once history has been isolated by a new-host receipt, later archives never
    # make those imported requests executable again, even at their old path.
    if manifest.get("previousReceiving", {}).get("mode") == "new-host":
        mode = "new-host"
    return mode

def received_history(manifest):
    operations = set(); runtimes = []; homes = []; applications = {}
    for row in manifest["entries"]:
        path = row["path"]
        match = re.match(r"^operations/([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})(?:/|$)", path)
        if match: operations.add(match[1])
        match = re.fullmatch(r"applications/[a-f0-9]{24}/runs/([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})\.json", path)
        if match: operations.add(match[1])
        if row["kind"] != "file": continue
        match = re.fullmatch(r"entries/([a-f0-9]{24})\.json", path)
        if match: runtimes.append(match[1])
        match = re.fullmatch(r"managed-homes/([a-f0-9]{24})\.json", path)
        if match: homes.append(match[1])
        match = re.fullmatch(r"applications/([a-f0-9]{24})/application\.json", path)
        if match: applications[match[1]] = row["sha256"]
    return {"operations": sorted(operations), "runtimes": sorted(runtimes),
            "managedHomes": sorted(homes), "applications": applications}

def original_member(target, manifest, name):
    row = next((row for row in manifest["entries"] if row["path"] == name), None)
    if row is None: return None
    require(row["kind"] == "file", "WORKSPACE_BACKUP_BINDING_SOURCE", "Keep the original regular binding record.")
    path = target / name
    require(regular_hash(path)[0] == {"bytes": row["bytes"], "sha256": row["sha256"]},
            "WORKSPACE_BACKUP_BINDING_SOURCE", "Original binding record changed: " + name)
    return read_json(path)

def runtime_entries(target, manifest):
    result = []
    prior_bindings = manifest.get("previousReceiving", {}).get("hostBindings") or {}
    previous = {item["runtimeId"]: item["directory"] for item in prior_bindings.get("runtimes", [])}
    for ident in received_history(manifest)["runtimes"]:
        saved = original_member(target, manifest, "entries/" + ident + ".json")
        require(isinstance(saved, dict) and saved.get("id") == ident, "WORKSPACE_BACKUP_BINDING_SOURCE", "Keep the original runtime entry identity.")
        absolute(saved.get("directory"))
        observed = original_member(target, manifest, "observations/" + ident + ".json")
        value = (observed or {}).get("result") or {}; expected = {}; source_basis = "retained-observation"; differences = []
        for key in ("sourceCommit", "archiveSha256", "profileId", "lockSha256", "sourceManifestSha256"):
            if isinstance(value.get(key), str) and value[key]: expected[key] = value[key]
        selected = absolute(previous.get(ident, saved["directory"])); source_root = absolute(source_directory(manifest))
        if inside(selected, source_root):
            relative = selected.relative_to(source_root).as_posix()
            plan = original_member(target, manifest, relative + "/runtime-install.json")
            if plan:
                source_basis = "archived-runtime-plan"
                values = {"sourceCommit": plan.get("source", {}).get("sourceCommit"), "archiveSha256": plan.get("archiveSha256"),
                          "profileId": plan.get("profileId"), "sourceManifestSha256": plan.get("source", {}).get("manifestSha256")}
                for key, value in values.items():
                    if isinstance(value, str) and value:
                        if key in expected and expected[key] != value:
                            differences.append({"field": key, "observed": expected[key], "archivedPlan": value})
                        expected[key] = value
                lock = next((row for row in manifest["entries"] if row["path"] == relative + "/package-lock.json" and row["kind"] == "file"), None)
                if lock: expected["lockSha256"] = lock["sha256"]
        result.append({"runtimeId": ident, "label": saved.get("label", ident), "originalDirectory": saved["directory"],
                       "sourceDirectory": str(selected), "expected": expected, "sourceBasis": source_basis, "earlierObservationDifferences": differences})
    return result

def normalize_host_bindings(value, entries):
    require(isinstance(value, dict) and set(value) == {"runtimeHome", "runtimes", "actor", "note"},
            "WORKSPACE_BACKUP_HOST_BINDINGS", "Select current runtimeHome, runtime mappings, actor and review note.")
    home = str(absolute(value["runtimeHome"]))
    require(isinstance(value["actor"], str) and value["actor"].strip() and len(value["actor"]) <= 160 and
            isinstance(value["note"], str) and value["note"].strip() and len(value["note"]) <= 4000,
            "WORKSPACE_BACKUP_HOST_BINDINGS", "Attribute the current-host selection and explain its path bindings.")
    require(isinstance(value["runtimes"], list), "WORKSPACE_BACKUP_HOST_BINDINGS", "Select an explicit runtime mapping list; an empty list retains every old runtime as unbound history.")
    known = {row["runtimeId"] for row in entries}; seen = set(); paths = set(); selected = []
    for row in value["runtimes"]:
        require(isinstance(row, dict) and set(row) == {"runtimeId", "directory"} and row["runtimeId"] in known and row["runtimeId"] not in seen,
                "WORKSPACE_BACKUP_HOST_BINDINGS", "Map each selected original runtime ID once.")
        directory = str(absolute(row["directory"]))
        require(directory not in paths, "WORKSPACE_BACKUP_HOST_BINDINGS", "Keep distinct runtime entries bound to distinct current directories.")
        seen.add(row["runtimeId"]); paths.add(directory); selected.append({"runtimeId": row["runtimeId"], "directory": directory})
    return {"runtimeHome": home, "runtimes": sorted(selected, key=lambda item: item["runtimeId"]), "actor": value["actor"], "note": value["note"]}

def new_host_review(target, manifest, current, selected):
    entries = runtime_entries(target, manifest)
    chosen = normalize_host_bindings(selected, entries) if selected is not None else None
    mappings = {row["runtimeId"]: row["directory"] for row in (chosen or {}).get("runtimes", [])}
    output = []
    for entry in entries:
        row = {**entry, "directory": mappings.get(entry["runtimeId"]), "status": "UNBOUND", "sourceVerified": False}
        if row["directory"]:
            try:
                path = private(absolute(row["directory"])); plan = read_json(path / "runtime-install.json")
                require(isinstance(plan, dict) and plan.get("schema") == "stellar-forge.runtime-install.v1" and plan.get("directory") == str(path),
                        "WORKSPACE_BACKUP_SOURCE_MISMATCH", "Use the original installer to recover this runtime at its actual current directory.")
                actual = {"sourceCommit": plan.get("source", {}).get("sourceCommit"), "archiveSha256": plan.get("archiveSha256"),
                          "profileId": plan.get("profileId"), "sourceManifestSha256": plan.get("source", {}).get("manifestSha256"),
                          "lockSha256": regular_hash(path / "package-lock.json")[0]["sha256"]}
                expected = row["expected"]
                require(all(expected.get(key) for key in ("sourceCommit", "archiveSha256", "profileId")),
                        "WORKSPACE_BACKUP_SOURCE_MISMATCH", "This original entry lacks a complete retained source binding; leave it unbound and attach the current runtime through its original installer.")
                comparisons = {key: {"expected": value, "actual": actual.get(key)} for key, value in expected.items()}
                require(all(item["expected"] == item["actual"] for item in comparisons.values()),
                        "WORKSPACE_BACKUP_SOURCE_MISMATCH", "The current runtime differs from the selected original source, profile or lock.")
                row.update(status="PRESENT", sourceVerified=True, source=actual, comparisons=comparisons)
            except (OSError, ValueError, Failure) as error:
                row.update(status="SOURCE_MISMATCH", error={"code": getattr(error, "code", getattr(error, "errno", None)), "message": str(error)})
        output.append(row)
    try: private(absolute(chosen["runtimeHome"])); home_ready = True
    except (OSError, ValueError, TypeError, Failure): home_ready = False
    return {"hostBindings": chosen, "runtimeEntries": output, "runtimeHomeReady": home_ready,
            "canOpen": chosen is not None and home_ready and not any(row["status"] == "SOURCE_MISMATCH" for row in output),
            "bindings": [{**row, "status": "HISTORICAL_REFERENCE", "sourceVerified": False} for row in manifest["externalBindings"]],
            "importedOperationCount": len(received_history(manifest)["operations"])}


def config_for(root):
    root = private(root); config = read_json(root / "workspace.json")
    require(config.get("schema") == "stellar-forge.runtime-workspace.v1" and (config.get("directory") == str(root) or relocated_config(root, config)),
            "WORKSPACE_BACKUP_IDENTITY", "Keep the original Runtime workspace path and identity.")
    identifier(config.get("workspaceId"))
    absolute(config.get("runtimeHome"))
    return config

def inherited_gate(root):
    raw = os.environ.get("STARFORGE_BACKUP_GATE_FD")
    require(raw and raw.isdecimal(), "WORKSPACE_BACKUP_GATE", "Use the original complete backup controller.")
    fd = int(raw); held = os.fstat(fd); named = os.lstat(root / GATE)
    require(stat.S_ISREG(held.st_mode) and (held.st_dev, held.st_ino) == (named.st_dev, named.st_ino),
            "WORKSPACE_BACKUP_GATE", "The original workspace gate identity changed.")
    # This locks the inherited open-file description. A separate description
    # must remain excluded; the source cannot be captured under a shared gate.
    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    other = os.open(root / GATE, os.O_RDWR | os.O_NOFOLLOW)
    try:
        try: fcntl.flock(other, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as error:
            if error.errno not in (errno.EAGAIN, errno.EACCES): raise
        else: raise Failure("WORKSPACE_BACKUP_GATE", "An exclusive original workspace gate is required.")
    finally: os.close(other)

def snapshot_inventory(root):
    rows = []; total = 0; locks = []
    for parent, dirs, files in os.walk(root, topdown=True, followlinks=False):
        dirs.sort(); files.sort()
        for name in sorted(dirs + files):
            path = pathlib.Path(parent) / name; rel = path.relative_to(root).as_posix()
            if rel == GATE: continue
            info = path.lstat(); mode = stat.S_IMODE(info.st_mode)
            require(info.st_uid == os.getuid(), "WORKSPACE_BACKUP_OWNER", "Every selected workspace member must be owned by this operator: " + rel)
            if stat.S_ISLNK(info.st_mode):
                target = os.readlink(path)
                require("\0" not in target, "WORKSPACE_BACKUP_LINK", "Invalid retained symbolic link.")
                row = {"path": rel, "kind": "symlink", "target": target, "mode": mode}
                if name in dirs: dirs.remove(name)
            elif stat.S_ISDIR(info.st_mode):
                row = {"path": rel, "kind": "directory", "mode": mode}
            elif stat.S_ISREG(info.st_mode):
                content, identity = regular_hash(path, signature(info)); total += content["bytes"]
                row = {"path": rel, "kind": "file", "mode": mode, **content}
                if name.endswith(".lock") and not mode & 0o077:
                    require(info.st_nlink == 1, "WORKSPACE_BACKUP_LEASE", "Keep each original private lease inode.")
                    locks.append(path)
            else:
                raise Failure("WORKSPACE_BACKUP_SPECIAL_FILE", "Stop the applicable service before backing up its special file: " + rel)
            rows.append(row)
            require(len(rows) <= MAX_FILES and total <= MAX_BYTES, "WORKSPACE_BACKUP_LIMIT", "Selected workspace exceeds the complete archive limits.")
    rows.sort(key=lambda row: row["path"])
    return rows, locks

def included_workspace_roots(root):
    result = {root}
    for parent, dirs, files in os.walk(root, topdown=True, followlinks=False):
        dirs[:] = [name for name in dirs if not (pathlib.Path(parent) / name).is_symlink()]
        if "workspace.json" not in files or pathlib.Path(parent) == root: continue
        path = pathlib.Path(parent) / "workspace.json"
        if path.is_symlink(): continue
        try: value = read_json(path)
        except (ValueError, UnicodeError): continue
        if isinstance(value, dict) and value.get("schema") == "stellar-forge.runtime-workspace.v1" :
            private(path.parent); result.add(path.parent)
    return sorted(result, key=str)

def original_operation_directories(root):
    for selected in included_workspace_roots(root):
        operations = selected / "operations"
        if not operations.exists(): continue
        require(operations.is_dir() and not operations.is_symlink(), "WORKSPACE_BACKUP_OPERATIONS", "Keep the original operation directory.")
        for operation in sorted(operations.iterdir()):
            if not re.fullmatch(r"[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}", operation.name): continue
            private(operation); yield operation

def require_settled_operations(root, rows):
    """Use original durable states, never infer process death from a free lock."""
    for row in rows:
        if row["kind"] != "file": continue
        path = root / row["path"]
        if path.name not in ("preparation.json", "install-state.json"): continue
        try: value = read_json(path)
        except (ValueError, UnicodeError): continue
        if path.name == "preparation.json" and isinstance(value, dict) and value.get("schema") == "stellar-forge.runtime-preparation.v1":
            state = read_json(path.parent / "install-state.json", optional=True)
            error = read_json(path.parent / "prepare-error.json", optional=True)
            require(state is not None or error is not None, "WORKSPACE_BACKUP_PREPARATION_UNSETTLED",
                    "Resolve this original native preparation before backup: " + str(path.parent))
        elif path.name == "install-state.json" and isinstance(value, dict) and value.get("schema") == "stellar-forge.runtime-install-state.v1":
            require(value.get("phase") in ("PREPARED", "READY", "FAILED"), "WORKSPACE_BACKUP_INSTALL_UNSETTLED",
                    "Settle the original native installation before backup: " + str(path.parent))
    for operation in original_operation_directories(root):
        state = read_json(operation / "state.json", optional=True)
        require(isinstance(state, dict) and state.get("phase") in ("QUEUED", "SUCCEEDED", "FAILED"),
                "WORKSPACE_BACKUP_OPERATION_UNSETTLED",
                "Stop or recover this original running or initializing operation before backup: " + str(operation))

@contextlib.contextmanager
def quiescent(root):
    inherited_gate(root); handles = []; held_paths = set()
    def hold(path, create=False):
        fd = os.open(path, os.O_RDWR | os.O_NOFOLLOW | (os.O_CREAT if create else 0), 0o600)
        try:
            info = os.fstat(fd); named = os.lstat(path)
            require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_uid == os.getuid() and
                    not info.st_mode & 0o077 and (info.st_dev, info.st_ino) == (named.st_dev, named.st_ino),
                    "WORKSPACE_BACKUP_LEASE", "Original private resource lease changed.")
            try: fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except OSError as error:
                if error.errno in (errno.EAGAIN, errno.EACCES):
                    raise Failure("WORKSPACE_BACKUP_ACTIVE_OPERATION", "Stop or complete the existing operation before backup: " + str(path))
                raise
            handles.append(fd); held_paths.add(path)
        except BaseException: os.close(fd); raise
    try:
        # A retained QUEUED request need not run merely to obtain a backup.
        # Its original worker inode is held before the first full inventory.
        for operation in original_operation_directories(root): hold(operation / "worker.lock", create=True)
        rows, paths = snapshot_inventory(root)
        for path in paths:
            if path not in held_paths: hold(path)
        held, current = snapshot_inventory(root)
        require(held == rows and current == paths, "WORKSPACE_BACKUP_CHANGED", "The workspace changed while acquiring its original resource leases.")
        require_settled_operations(root, rows)
        yield rows
    finally:
        for fd in reversed(handles): os.close(fd)

def scan_paths(value, location=""):
    if isinstance(value, dict):
        for key, nested in value.items():
            yield from scan_paths(nested, location + "/" + str(key).replace("~", "~0").replace("/", "~1"))
    elif isinstance(value, list):
        for index, nested in enumerate(value): yield from scan_paths(nested, location + "/" + str(index))
    elif isinstance(value, str) and value.startswith("/") and "\0" not in value and os.path.abspath(value) == value:
        yield value, location

def bindings(root, rows, config, discovery=None):
    references = {}
    discovery = discovery if discovery is not None else {"parsedJsonFiles": 0, "unscannedJsonFiles": []}
    def add(path, role, location, expected=None):
        path = absolute(path)
        if inside(path, root): return
        item = references.setdefault(str(path), {"path": str(path), "roles": [], "locations": [], "expected": []})
        if role not in item["roles"]: item["roles"].append(role)
        if location not in item["locations"]: item["locations"].append(location)
        if expected and expected not in item["expected"]: item["expected"].append(expected)
    add(config["runtimeHome"], "runtime-home", "workspace.json#/runtimeHome")
    for row in rows:
        if row["kind"] == "symlink":
            path = root / row["path"]; target = pathlib.Path(row["target"])
            target = target if target.is_absolute() else path.parent / target
            add(os.path.abspath(target), "symbolic-link-target", row["path"])
        if row["kind"] != "file" or not row["path"].endswith(".json"): continue
        if row["bytes"] > 4 * 1024 * 1024:
            discovery["unscannedJsonFiles"].append({"path": row["path"], "bytes": row["bytes"], "reason": "Full file retained; generic path discovery is bounded to JSON files at most 4 MiB."})
            continue
        try: value = read_json(root / row["path"], maximum=4 * 1024 * 1024)
        except (ValueError, UnicodeError):
            discovery["unscannedJsonFiles"].append({"path": row["path"], "bytes": row["bytes"], "reason": "Full file retained; not a valid UTF-8 JSON value."})
            continue
        discovery["parsedJsonFiles"] += 1
        if row["path"].startswith("entries/") and isinstance(value, dict) and isinstance(value.get("directory"), str):
            expected = {}
            observed = read_json(root / "observations" / (str(value.get("id", "")) + ".json"), optional=True)
            if isinstance(observed, dict):
                result = observed.get("result") or {}
                expected = {key: result[key] for key in ("sourceCommit", "archiveSha256", "profileId", "lockSha256") if result.get(key)}
            add(value["directory"], "registered-runtime", row["path"] + "#/directory", expected)
        for target, pointer in scan_paths(value):
            role = "retained-path-reference"
            if row["path"].startswith("managed/") and pointer.endswith("/directory"): role = "managed-home"
            add(target, role, row["path"] + "#" + pointer)
    return [references[path] for path in sorted(references)]

def overview(manifest):
    rows = manifest["entries"]
    return {"reviewId": manifest["reviewId"], "reviewSha256": sha(encoded(manifest)),
            "workspaceId": manifest["workspace"]["workspaceId"], "directory": manifest["workspace"]["directory"],
            "sourceDirectory": source_directory(manifest), "runtimeHome": manifest["workspace"]["runtimeHome"], "label": manifest["label"], "createdAt": manifest["createdAt"],
            "files": sum(row["kind"] == "file" for row in rows),
            "directories": sum(row["kind"] == "directory" for row in rows),
            "links": sum(row["kind"] == "symlink" for row in rows),
            "bytes": sum(row.get("bytes", 0) for row in rows), "inventorySha256": manifest["inventorySha256"],
            "externalBindings": manifest["externalBindings"], "externalBindingDiscovery": manifest.get("externalBindingDiscovery"), "excluded": manifest["excluded"]}

def review(params):
    root = private(absolute(params["root"])); store = private(absolute(params["store"]))
    request_id = identifier(params["requestId"]); destination = make_private(store / "reviews" / request_id)
    prior = read_json(destination / "manifest.json", optional=True)
    if prior:
        require(source_directory(prior) == str(root) and prior["label"] == params["label"], "WORKSPACE_BACKUP_REVIEW_REUSED", "Request UUID belongs to another backup review.")
        return overview(prior)
    with quiescent(root) as rows:
        config = config_for(root)
        discovery = {"parsedJsonFiles": 0, "unscannedJsonFiles": [], "externalTreesCopied": False}
        declared = bindings(root, rows, config, discovery)
        manifest = {"schema": SCHEMA, "reviewId": request_id, "label": params["label"], "createdAt": timestamp(),
                    "workspace": config, "sourceDirectory": str(root), "entries": rows, "inventorySha256": sha(encoded(rows)),
                    "externalBindings": declared, "externalBindingDiscovery": discovery,
                    "excluded": [{"path": GATE, "reason": "Existing kernel coordination inode; never replaced by archive or restore."}]}
        # The previous receiving marker is retained in the source inventory;
        # only that controller record is regenerated during another restore.
        if any(row["path"] == MARKER for row in rows):
            manifest["previousReceiving"] = read_json(root / MARKER)
        after, _ = snapshot_inventory(root)
        require(after == rows, "WORKSPACE_BACKUP_CHANGED", "The source changed during complete review.")
        require(len(encoded(manifest)) <= MAX_MANIFEST, "WORKSPACE_BACKUP_MANIFEST_LIMIT", "Complete manifest exceeds 64 MiB.")
        validate_manifest(manifest)
        atomic(destination / "manifest.json", manifest)
        result = overview(manifest); atomic(destination / "review.json", result); return result

def validate_manifest(manifest):
    require(isinstance(manifest, dict) and manifest.get("schema") == SCHEMA, "WORKSPACE_BACKUP_FORMAT", "Use a complete Runtime workspace archive.")
    identifier(manifest.get("reviewId")); config = manifest.get("workspace", {})
    require(config.get("schema") == "stellar-forge.runtime-workspace.v1", "WORKSPACE_BACKUP_FORMAT", "Missing original workspace configuration.")
    identifier(config.get("workspaceId")); absolute(config.get("directory")); absolute(config.get("runtimeHome")); absolute(source_directory(manifest))
    rows = manifest.get("entries")
    require(isinstance(rows, list) and len(rows) <= MAX_FILES, "WORKSPACE_BACKUP_MANIFEST", "Invalid complete member inventory.")
    names = set(); by_name = {}; total = 0
    for row in rows:
        require(isinstance(row, dict), "WORKSPACE_BACKUP_MANIFEST", "Invalid member.")
        name = relative_name(row.get("path")); require(name not in names and name != GATE, "WORKSPACE_BACKUP_MANIFEST", "Duplicate or reserved member.")
        names.add(name); by_name[name] = row
        require(row.get("kind") in ("directory", "file", "symlink") and isinstance(row.get("mode"), int) and
                0 <= row["mode"] <= 0o777, "WORKSPACE_BACKUP_MODE", "Invalid member type or special permission bits.")
        if row["kind"] == "file":
            digest_id(row.get("sha256")); require(isinstance(row.get("bytes"), int) and 0 <= row["bytes"] <= MAX_BYTES, "WORKSPACE_BACKUP_SIZE", "Invalid member size.")
            total += row["bytes"]
        if row["kind"] == "symlink": require(isinstance(row.get("target"), str) and row["target"] and "\0" not in row["target"], "WORKSPACE_BACKUP_LINK", "Invalid link.")
    for name in names:
        parent = pathlib.PurePosixPath(name).parent
        while str(parent) != ".":
            require(by_name.get(str(parent), {}).get("kind") == "directory", "WORKSPACE_BACKUP_PARENT", "Members cannot traverse links or absent directories.")
            parent = parent.parent
    require(total <= MAX_BYTES and by_name.get("workspace.json", {}).get("kind") == "file" and
            sha(encoded(rows)) == manifest.get("inventorySha256"), "WORKSPACE_BACKUP_MANIFEST", "Complete inventory identity does not match.")
    require(isinstance(manifest.get("externalBindings"), list), "WORKSPACE_BACKUP_BINDINGS", "Original external binding declarations are required.")
    for binding in manifest["externalBindings"]:
        require(isinstance(binding, dict), "WORKSPACE_BACKUP_BINDINGS", "Invalid binding declaration.")
        target = absolute(binding.get("path"))
        require(not inside(target, absolute(source_directory(manifest))) and
                isinstance(binding.get("roles"), list) and all(isinstance(role, str) and role for role in binding["roles"]) and
                isinstance(binding.get("locations"), list) and all(isinstance(location, str) for location in binding["locations"]) and
                isinstance(binding.get("expected"), list) and all(isinstance(item, dict) and all(isinstance(key, str) and isinstance(value, str) for key, value in item.items()) for item in binding["expected"]),
                "WORKSPACE_BACKUP_BINDINGS", "Keep complete original external binding declarations.")
    require(by_name["workspace.json"]["bytes"] <= 4 * 1024 * 1024,
            "WORKSPACE_BACKUP_CONFIG_LIMIT", "Keep the original runtime configuration within its native 4 MiB reader limit.")
    return by_name

def archive_read(path, expected_sha, callback=None):
    path = absolute(str(path)); actual, source_stat = regular_hash(path)
    require(actual["sha256"] == digest_id(expected_sha), "WORKSPACE_BACKUP_ARCHIVE_CHANGED", "The complete selected archive SHA-256 does not match.")
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, "rb") as raw:
        require(signature(os.fstat(raw.fileno())) == source_stat, "WORKSPACE_BACKUP_ARCHIVE_CHANGED", "Archive changed before reading.")
        with tarfile.open(fileobj=raw, mode="r|gz") as archive:
            members = iter(archive)
            first = next(members, None)
            require(first is not None and first.name == "manifest.json" and first.isfile() and first.size <= MAX_MANIFEST,
                    "WORKSPACE_BACKUP_MANIFEST", "The archive must begin with its complete original manifest.")
            manifest_bytes = archive.extractfile(first).read(MAX_MANIFEST + 1)
            require(len(manifest_bytes) == first.size, "WORKSPACE_BACKUP_MANIFEST", "Truncated original manifest.")
            manifest = json.loads(manifest_bytes.decode("utf-8")); rows = validate_manifest(manifest)
            require(manifest_bytes == encoded(manifest), "WORKSPACE_BACKUP_MANIFEST", "Keep the canonical complete manifest bytes.")
            expected = {name: row for name, row in rows.items() if row["kind"] == "file"}
            seen = set()
            for member in members:
                require(member.isfile() and member.name.startswith("files/"), "WORKSPACE_BACKUP_MEMBER", "Unexpected archive member type.")
                name = relative_name(member.name[6:])
                require(name in expected and name not in seen and member.size == expected[name]["bytes"],
                        "WORKSPACE_BACKUP_MEMBER", "Archive members must match the complete original inventory once.")
                seen.add(name); stream = archive.extractfile(member); digest = hashlib.sha256(); count = 0
                config_bytes = bytearray() if name == "workspace.json" else None
                writer = callback(name, expected[name]) if callback else None
                try:
                    while True:
                        chunk = stream.read(CHUNK)
                        if not chunk: break
                        count += len(chunk); digest.update(chunk)
                        if config_bytes is not None: config_bytes.extend(chunk)
                        if writer: writer.write(chunk)
                    require(count == expected[name]["bytes"] and digest.hexdigest() == expected[name]["sha256"],
                            "WORKSPACE_BACKUP_MEMBER_CHANGED", "Retained member differs: " + name)
                    if config_bytes is not None:
                        require(json.loads(config_bytes.decode("utf-8")) == manifest["workspace"], "WORKSPACE_BACKUP_IDENTITY",
                                "The archived configuration must match the reviewed original workspace identity.")
                    if writer: writer.commit()
                finally:
                    if writer: writer.close()
            require(seen == set(expected), "WORKSPACE_BACKUP_INCOMPLETE", "Receive every original workspace file.")
        require(signature(os.fstat(raw.fileno())) == source_stat, "WORKSPACE_BACKUP_ARCHIVE_CHANGED", "Archive changed during receiving.")
    return {"archiveId": expected_sha, **actual, "manifestSha256": sha(manifest_bytes), "review": overview(manifest),
            "archiveIdentity": {"dev": str(source_stat[0]), "ino": str(source_stat[1]), "size": str(source_stat[2]),
                                "mtimeNs": str(source_stat[3]), "ctimeNs": str(source_stat[4])}}, manifest

def inspect(params):
    store = private(absolute(params["store"])); archive = absolute(params["archivePath"])
    result, manifest = archive_read(archive, params["sha256"])
    directory = make_private(store / "inspections" / result["archiveId"])
    record = {**result, "archivePath": str(archive), "inspectedAt": timestamp()}
    previous = read_json(directory / "inspection.json", optional=True)
    if previous:
        require(previous["manifestSha256"] == result["manifestSha256"], "WORKSPACE_BACKUP_ARCHIVE_CHANGED", "Archive identity changed.")
        # Retain the original receipt and all later verified source locations.
        record["previousArchivePaths"] = sorted(set(previous.get("previousArchivePaths", []) + [previous["archivePath"]]))
    atomic(directory / "manifest.json", manifest); atomic(directory / "inspection.json", record)
    return record

def operation_record(params, phase, **details):
    directory = private(absolute(params["operationDirectory"]))
    current = read_json(directory / "operation.json")
    require(current["operationId"] == params["operationId"], "WORKSPACE_BACKUP_OPERATION_CHANGED", "Keep the original operation.")
    current.update({"phase": phase, "updatedAt": timestamp(), **details}); atomic(directory / "operation.json", current)
    return current

def export(params):
    root = private(absolute(params["root"])); store = private(absolute(params["store"]))
    source = store / "reviews" / identifier(params["reviewId"]) / "manifest.json"
    manifest = read_json(source); validate_manifest(manifest)
    require(sha(encoded(manifest)) == digest_id(params["reviewSha256"]), "WORKSPACE_BACKUP_REVIEW_CHANGED", "Review the original complete inventory.")
    directory = private(absolute(params["operationDirectory"])); destination = directory / "workspace.tar.gz"
    if destination.exists():
        digest, _ = regular_hash(destination); result, actual = archive_read(destination, digest["sha256"])
        require(actual == manifest, "WORKSPACE_BACKUP_ARCHIVE_CHANGED", "Retained archive belongs to this exact review.")
    else:
        with quiescent(root) as rows:
            require(rows == manifest["entries"] and config_for(root) == manifest["workspace"],
                    "WORKSPACE_BACKUP_REVIEW_CHANGED", "The workspace changed after review; retain this review and create a fresh one.")
            pending = directory / "workspace.tar.gz.pending"
            if pending.exists():
                previous, _ = regular_hash(pending)
                retained = directory / ("interrupted-" + previous["sha256"] + ".tar.gz")
                if retained.exists():
                    require(regular_hash(retained)[0] == previous, "WORKSPACE_BACKUP_PREDECESSOR", "Interrupted archive identity changed.")
                    pending.unlink()
                else: os.rename(pending, retained)
                fsync_directory(directory)
            fd = os.open(pending, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            with os.fdopen(fd, "wb") as raw:
                with tarfile.open(fileobj=raw, mode="w|gz", format=tarfile.PAX_FORMAT) as archive:
                    data = encoded(manifest); header = tarfile.TarInfo("manifest.json"); header.size = len(data); header.mode = 0o600
                    archive.addfile(header, io.BytesIO(data))
                    for row in rows:
                        if row["kind"] != "file": continue
                        path = root / row["path"]; fd_ = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
                        with os.fdopen(fd_, "rb") as file_:
                            before = os.fstat(file_.fileno())
                            require(stat.S_ISREG(before.st_mode) and before.st_size == row["bytes"], "WORKSPACE_BACKUP_CHANGED", "Original source changed.")
                            header = tarfile.TarInfo("files/" + row["path"]); header.size = row["bytes"]; header.mode = 0o600
                            archive.addfile(header, file_)
                            require(signature(before) == signature(os.fstat(file_.fileno())), "WORKSPACE_BACKUP_CHANGED", "Original source changed while copying.")
                raw.flush(); os.fsync(raw.fileno())
            after, _ = snapshot_inventory(root)
            require(after == rows, "WORKSPACE_BACKUP_CHANGED", "The original complete workspace changed during backup.")
            digest, _ = regular_hash(pending); result, actual = archive_read(pending, digest["sha256"])
            require(actual == manifest, "WORKSPACE_BACKUP_ARCHIVE_CHANGED", "Verify the entire completed backup before publication.")
            os.rename(pending, destination); fsync_directory(directory)
    result.update({"filename": "Runtime_Workspace_" + manifest["workspace"]["workspaceId"] + ".tar.gz", "archivePath": str(destination)})
    inspection = inspect({"store": str(store), "archivePath": str(destination), "sha256": result["sha256"]})
    return operation_record(params, "COMPLETE", result={**result, "inspectedAt": inspection["inspectedAt"]})

def marker_for(params, manifest, phase):
    value = {"schema": RECEIVING_SCHEMA, "receivingId": params["operationId"], "operationId": params["operationId"],
             "workspaceId": manifest["workspace"]["workspaceId"], "directory": params["directory"],
             "storageDirectory": params["store"], "archiveId": params["archiveId"], "archiveSha256": params["archiveId"],
             "manifestSha256": params["manifestSha256"], "phase": phase, "createdAt": params["createdAt"],
             "updatedAt": timestamp(), "launchesStarted": 0}
    if receiving_mode(params, manifest) == "new-host":
        value.update(mode="new-host", originalDirectory=manifest["workspace"]["directory"],
                     sourceDirectory=source_directory(manifest), receivedHistory=received_history(manifest))
    if value.get("mode") == "new-host" and phase != "RESTORING":
        nested = []
        for row in manifest["entries"]:
            if row["kind"] != "file" or row["path"] == "workspace.json" or not row["path"].endswith("/workspace.json"): continue
            config = original_member(absolute(params["directory"]), manifest, row["path"])
            if isinstance(config, dict) and config.get("schema") == "stellar-forge.runtime-workspace.v1":
                identifier(config.get("workspaceId")); absolute(config.get("directory"))
                nested.append({"path": row["path"][:-len("/workspace.json")], "workspaceId": config["workspaceId"],
                               "originalDirectory": config["directory"]})
        value["nestedWorkspaces"] = nested
    require(len(encoded(value)) <= 3 * 1024 * 1024, "WORKSPACE_BACKUP_HISTORY_LIMIT", "Keep the complete receiving history within the native marker reader limit.")
    return value

def retain_interrupted(path, directory):
    """Retain a controller-owned partial outside the restored workspace."""
    content, before = regular_hash(path)
    folder = make_private(directory / "interrupted-files")
    destination = folder / content["sha256"]
    if destination.exists():
        require(regular_hash(destination)[0] == content, "WORKSPACE_BACKUP_PREDECESSOR", "Retained partial changed.")
    else:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        with os.fdopen(fd, "rb") as source:
            require(signature(os.fstat(source.fileno())) == before, "WORKSPACE_BACKUP_CHANGED", "Partial changed before preservation.")
            temp = destination.with_name(destination.name + ".pending-" + str(uuid.uuid4()))
            out = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            try:
                with os.fdopen(out, "wb") as target:
                    while True:
                        chunk = source.read(CHUNK)
                        if not chunk: break
                        target.write(chunk)
                    target.flush(); os.fsync(target.fileno())
                require(regular_hash(temp)[0] == content, "WORKSPACE_BACKUP_PREDECESSOR", "Preserve the complete interrupted file.")
                os.link(temp, destination, follow_symlinks=False); temp.unlink(); fsync_directory(folder)
            finally:
                if temp.exists(): temp.unlink()
        require(signature(os.stat(path, follow_symlinks=False)) == before, "WORKSPACE_BACKUP_CHANGED", "Partial changed during preservation.")
    record = folder / (content["sha256"] + "-" + sha(str(path).encode())[:16] + ".json")
    atomic(record, {"originalPath": str(path), **content, "retainedPath": str(destination), "at": timestamp()})
    require(signature(os.stat(path, follow_symlinks=False)) == before, "WORKSPACE_BACKUP_CHANGED", "Keep the changed interrupted file.")
    path.unlink(); fsync_directory(path.parent)

def reconcile_restore_partials(target, rows, operation_id, directory):
    for parent, dirs, files in os.walk(target, topdown=True, followlinks=False):
        dirs[:] = [name for name in dirs if not (pathlib.Path(parent) / name).is_symlink()]
        for name in files:
            path = pathlib.Path(parent) / name; rel = path.relative_to(target).as_posix()
            if rel in rows: continue
            suffix = ".restore-pending-" + operation_id
            if name.endswith(suffix) and path.with_name(name[:-len(suffix)]).relative_to(target).as_posix() in rows:
                retain_interrupted(path, directory)
            elif path.parent == target and re.fullmatch(re.escape(MARKER) + r"\.pending-[a-f0-9-]{36}", name):
                retain_interrupted(path, directory)

def verify_restored(target, rows, complete=False):
    actual, _ = snapshot_inventory(target)
    actual = {row["path"]: row for row in actual if row["path"] != MARKER}
    expected = {name: row for name, row in rows.items() if name != MARKER}
    require(set(actual).issubset(expected), "WORKSPACE_BACKUP_DESTINATION_CHANGED",
            "The original receiving destination contains unrelated entries: " + ", ".join(sorted(set(actual) - set(expected))[:10]))
    if complete:
        require(set(actual) == set(expected), "WORKSPACE_BACKUP_INCOMPLETE", "Receive every original workspace member.")
    for name, row in actual.items():
        wanted = expected[name]
        if not complete and row["kind"] == wanted["kind"] == "directory":
            require(row["mode"] in (0o700, wanted["mode"]), "WORKSPACE_BACKUP_DESTINATION_CHANGED", "Original directory mode changed: " + name)
        else:
            require(row == wanted, "WORKSPACE_BACKUP_DESTINATION_CHANGED", "Original received member changed: " + name)

class Receiver:
    def __init__(self, path, row, operation_id, directory):
        self.path = path; self.row = row; self.file = None; self.temp = None
        if path.exists() or path.is_symlink():
            actual, _ = regular_hash(path)
            require(actual == {"bytes": row["bytes"], "sha256": row["sha256"]} and
                    stat.S_IMODE(path.lstat().st_mode) == row["mode"],
                    "WORKSPACE_BACKUP_DESTINATION_CHANGED", "Keep the original restored file and mode: " + str(path))
            return
        self.temp = path.with_name(path.name + ".restore-pending-" + operation_id)
        if self.temp.exists(): retain_interrupted(self.temp, directory)
        fd = os.open(self.temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        self.file = os.fdopen(fd, "wb")
    def write(self, data):
        if self.file: self.file.write(data)
    def commit(self):
        if not self.file: return
        self.file.flush(); os.fchmod(self.file.fileno(), self.row["mode"]); os.fsync(self.file.fileno())
        self.file.close(); self.file = None
        actual, _ = regular_hash(self.temp)
        require(actual == {"bytes": self.row["bytes"], "sha256": self.row["sha256"]}, "WORKSPACE_BACKUP_MEMBER_CHANGED", "Verify the complete original file.")
        os.link(self.temp, self.path, follow_symlinks=False); self.temp.unlink(); fsync_directory(self.path.parent)
        self.temp = None
    def close(self):
        if self.file: self.file.close(); self.file = None

def restore(params):
    target = absolute(params["directory"]); handles = []
    try:
        for parent in reversed(target.parents):
            value = read_json(parent / "workspace.json", optional=True)
            if not isinstance(value, dict) or value.get("schema") != "stellar-forge.runtime-workspace.v1": continue
            private(parent)
            require(value.get("directory") == str(parent) or relocated_config(parent, value), "WORKSPACE_BACKUP_PARENT", "Keep the containing workspace identity.")
            marker = read_json(parent / MARKER, optional=True)
            require(not marker or marker.get("phase") == "BINDINGS_REVIEWED", "WORKSPACE_BACKUP_PARENT_RECEIVING",
                    "Complete the containing workspace's original receiving first.")
            fd = os.open(parent / GATE, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
            try:
                held = os.fstat(fd); named = os.lstat(parent / GATE)
                require(stat.S_ISREG(held.st_mode) and held.st_nlink == 1 and held.st_uid == os.getuid() and
                        not held.st_mode & 0o077 and (held.st_dev, held.st_ino) == (named.st_dev, named.st_ino),
                        "WORKSPACE_BACKUP_GATE", "Keep the containing workspace's original lease.")
                try: fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                except OSError as error:
                    if error.errno in (errno.EAGAIN, errno.EACCES):
                        raise Failure("WORKSPACE_BACKUP_ACTIVE_OPERATION", "Keep the containing workspace's active operation.")
                    raise
                require(read_json(parent / "workspace.json") == value and read_json(parent / MARKER, optional=True) == marker,
                        "WORKSPACE_BACKUP_PARENT", "The containing workspace changed before its lease.")
                handles.append(fd)
            except BaseException: os.close(fd); raise
        return restore_under_ancestors(params)
    finally:
        for fd in reversed(handles): os.close(fd)

def restore_under_ancestors(params):
    store = private(absolute(params["store"])); archive_id = digest_id(params["archiveId"])
    receipt = read_json(store / "inspections" / archive_id / "inspection.json")
    manifest = read_json(store / "inspections" / archive_id / "manifest.json"); rows = validate_manifest(manifest)
    require(params["manifestSha256"] == receipt["manifestSha256"] == sha(encoded(manifest)), "WORKSPACE_BACKUP_REVIEW_CHANGED", "Keep the selected complete receiving review.")
    target = absolute(params["directory"]); operation_directory = private(absolute(params["operationDirectory"]))
    mode = receiving_mode(params, manifest)
    require(mode == "new-host" or str(target) == manifest["workspace"]["directory"], "WORKSPACE_BACKUP_ORIGINAL_PATH_REQUIRED", "Choose explicit new-host receiving to restore the unchanged workspace at another directory.")
    marker_for(params, manifest, "RESTORING")
    require(not inside(store, target) and not inside(target, store), "WORKSPACE_BACKUP_STORAGE_OVERLAP", "Keep the retained archive outside its destination.")
    require(target.parent.resolve() == target.parent, "WORKSPACE_BACKUP_PARENT", "Use the original real destination parent.")
    # An empty private target is adoptable, but every populated destination needs
    # this exact durable receiving identity. The intent is written before mkdir.
    intent_file = operation_directory / "restore-intent.json"
    intent = {"receivingId": params["operationId"], "directory": str(target), "archiveId": archive_id,
              "manifestSha256": params["manifestSha256"]}
    if params.get("mode") == "new-host": intent["mode"] = "new-host"
    previous_intent = read_json(intent_file, optional=True)
    require(previous_intent is None or previous_intent == intent, "WORKSPACE_BACKUP_RECEIVING_CHANGED", "Retain the same restore intent.")
    if previous_intent is None: atomic(intent_file, intent)
    try: target.mkdir(mode=0o700); fsync_directory(target.parent)
    except FileExistsError: pass
    private(target); identity = target.lstat()
    marker = read_json(target / MARKER, optional=True)
    names = set(os.listdir(target))
    if marker is None:
        own_pending = all(name == GATE or re.fullmatch(re.escape(MARKER) + r"\.pending-[a-f0-9-]{36}", name) for name in names)
        require(not names or (previous_intent == intent and own_pending),
                "WORKSPACE_BACKUP_DESTINATION_EXISTS", "Use an empty original private directory or this exact interrupted restoration.")
    else:
        require(marker.get("schema") == RECEIVING_SCHEMA and marker.get("receivingId") == params["operationId"] and
                marker.get("manifestSha256") == params["manifestSha256"] and marker.get("archiveId") == archive_id and
                marker.get("directory") == str(target) and marker.get("workspaceId") == manifest["workspace"]["workspaceId"],
                "WORKSPACE_BACKUP_DESTINATION_EXISTS", "The destination belongs to another workspace or restoration.")
    gate = os.open(target / GATE, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        info = os.fstat(gate)
        require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_uid == os.getuid() and not info.st_mode & 0o077,
                "WORKSPACE_BACKUP_GATE", "Use the original private destination gate.")
        try: fcntl.flock(gate, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as error:
            if error.errno in (errno.EAGAIN, errno.EACCES):
                raise Failure("WORKSPACE_BACKUP_ACTIVE_OPERATION", "Keep this destination's existing operator and restoration.")
            raise
        current_identity = private(target).lstat(); named = (target / GATE).lstat()
        require((identity.st_dev, identity.st_ino) == (current_identity.st_dev, current_identity.st_ino) and
                (info.st_dev, info.st_ino) == (named.st_dev, named.st_ino),
                "WORKSPACE_BACKUP_DESTINATION_CHANGED", "Destination identity changed before its exclusive receiving lease.")
        current = read_json(target / MARKER, optional=True)
        require(current == marker, "WORKSPACE_BACKUP_DESTINATION_CHANGED", "The original receiving marker changed before its lease.")
        if current is None:
            now_names = set(os.listdir(target))
            require(all(name == GATE or (previous_intent == intent and re.fullmatch(re.escape(MARKER) + r"\.pending-[a-f0-9-]{36}", name)) for name in now_names),
                    "WORKSPACE_BACKUP_DESTINATION_EXISTS", "The original empty destination changed.")
        reconcile_restore_partials(target, rows, params["operationId"], operation_directory)
        verify_restored(target, rows)
        if current and current["phase"] == "BINDINGS_REVIEWED":
            verify_restored(target, rows, complete=True)
            return operation_record(params, "COMPLETE", result={"receivingId": params["operationId"], "directory": str(target),
                "workspaceId": manifest["workspace"]["workspaceId"], "phase": current["phase"], "restoredFiles": overview(manifest)["files"], "launchesStarted": 0})
        atomic(target / MARKER, marker_for(params, manifest, "RESTORING"))
        for name, row in sorted(rows.items(), key=lambda pair: (pair[0].count("/"), pair[0])):
            if row["kind"] != "directory": continue
            path = target / name
            try:
                path.mkdir(mode=0o700); fsync_directory(path.parent)
            except FileExistsError:
                require(stat.S_ISDIR(path.lstat().st_mode) and not path.is_symlink(), "WORKSPACE_BACKUP_DESTINATION_CHANGED", "A retained directory changed.")
        received_count = 0
        def writer(name, row):
            nonlocal received_count
            received_count += 1
            if received_count == 1 or received_count % 25 == 0:
                operation_record(params, "RUNNING", restoredFiles=received_count - 1, restoringPath=name)
            if name == MARKER: return None
            return Receiver(target / name, row, params["operationId"], operation_directory)
        actual, actual_manifest = archive_read(receipt["archivePath"], archive_id, writer)
        require(actual_manifest == manifest, "WORKSPACE_BACKUP_ARCHIVE_CHANGED", "The inspected original archive changed.")
        for name, row in rows.items():
            path = target / name
            if row["kind"] == "symlink":
                if path.exists() or path.is_symlink():
                    require(path.is_symlink() and os.readlink(path) == row["target"], "WORKSPACE_BACKUP_DESTINATION_CHANGED", "Keep the original retained link.")
                else: os.symlink(row["target"], path); fsync_directory(path.parent)
        for name, row in sorted(rows.items(), key=lambda pair: -pair[0].count("/")):
            if row["kind"] == "directory":
                # Open while the temporary receiving mode still permits access.
                # Sync the inode after applying the original mode, including 0000.
                descriptor = os.open(target / name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
                try:
                    os.fchmod(descriptor, row["mode"]); os.fsync(descriptor)
                finally: os.close(descriptor)
        require(config_for(target) == manifest["workspace"], "WORKSPACE_BACKUP_IDENTITY", "Restore the original workspace configuration unchanged.")
        verify_restored(target, rows, complete=True)
        completed = marker_for(params, manifest, "BINDINGS_REVIEW_REQUIRED")
        atomic(target / MARKER, completed)
        result = {"receivingId": params["operationId"], "directory": str(target), "workspaceId": manifest["workspace"]["workspaceId"],
                  "phase": completed["phase"], "restoredFiles": overview(manifest)["files"], "bindings": manifest["externalBindings"], "launchesStarted": 0}
        return operation_record(params, "COMPLETE", result=result)
    finally: os.close(gate)

def binding_review(params):
    store = private(absolute(params["store"])); operation_id = identifier(params["receivingId"])
    operation = read_json(store / "operations" / operation_id / "operation.json")
    require(operation["kind"] == "RESTORE" and operation["phase"] == "COMPLETE", "WORKSPACE_BACKUP_RESTORE_REQUIRED", "Complete the original restoration first.")
    target = private(absolute(operation["input"]["directory"])); current = read_json(target / MARKER)
    require(current["receivingId"] == operation_id, "WORKSPACE_BACKUP_RECEIVING_CHANGED", "Keep the original receiving identity.")
    manifest = read_json(store / "inspections" / current["archiveId"] / "manifest.json"); output = []
    if current.get("mode") == "new-host":
        require(current["manifestSha256"] == sha(encoded(manifest)), "WORKSPACE_BACKUP_REVIEW_CHANGED", "Keep the exact original receiving manifest.")
        if current["phase"] == "BINDINGS_REVIEWED":
            accepted = read_json(store / "binding-reviews" / identifier(current["bindingReview"]["reviewId"]) / "review.json")
            require(accepted["reviewSha256"] == current["bindingReview"]["reviewSha256"] and
                    accepted["reviewSha256"] == sha(encoded({key: value for key, value in accepted.items() if key != "reviewSha256"})),
                    "WORKSPACE_BACKUP_BINDING_REVIEW_CHANGED", "Keep the complete originally accepted binding review.")
            if params.get("hostBindings") is not None:
                require(normalize_host_bindings(params["hostBindings"], accepted["runtimeEntries"]) == accepted["hostBindings"],
                        "WORKSPACE_BACKUP_BINDINGS_ACCEPTED", "This receiving already has accepted bindings. Use original runtime attach and application review/save for later changes.")
            return accepted
        details = new_host_review(target, manifest, current, params.get("hostBindings"))
        result = {"reviewId": str(uuid.uuid4()), "receivingId": operation_id, "directory": str(target),
                  "workspaceId": current["workspaceId"], "mode": "new-host", "originalDirectory": manifest["workspace"]["directory"],
                  "sourceDirectory": source_directory(manifest), "checkedAt": timestamp(), "manifestSha256": current["manifestSha256"],
                  "sourceReadiness": "REQUIRES_ORIGINAL_NATIVE_REVIEW", **details}
        result["reviewSha256"] = sha(encoded(result))
        folder = make_private(store / "binding-reviews" / result["reviewId"]); atomic(folder / "review.json", result)
        return result
    require(params.get("hostBindings") is None, "WORKSPACE_BACKUP_HOST_BINDINGS", "Current host bindings belong to explicit new-host receiving.")

    for binding in manifest["externalBindings"]:
        row = {**binding, "status": "UNAVAILABLE", "sourceVerified": False}
        path = absolute(binding["path"])
        try:
            info = path.lstat()
            row.update({"status": "PRESENT", "kind": "directory" if stat.S_ISDIR(info.st_mode) else "file" if stat.S_ISREG(info.st_mode) else "symlink" if stat.S_ISLNK(info.st_mode) else "special",
                        "mode": stat.S_IMODE(info.st_mode), "owned": info.st_uid == os.getuid()})
            if "runtime-home" in binding["roles"] or "registered-runtime" in binding["roles"]: private(path)
            if "registered-runtime" in binding["roles"]:
                plan = read_json(path / "runtime-install.json")
                require(isinstance(plan, dict) and plan.get("schema") == "stellar-forge.runtime-install.v1" and
                        isinstance(plan.get("source"), dict), "WORKSPACE_BACKUP_SOURCE_MISMATCH",
                        "The registered runtime has no valid original installation plan.")
                actual = {"sourceCommit": plan["source"].get("sourceCommit"), "archiveSha256": plan.get("archiveSha256"),
                          "profileId": plan.get("profileId")}
                if (path / "package-lock.json").exists(): actual["lockSha256"] = regular_hash(path / "package-lock.json")[0]["sha256"]
                require(plan.get("directory") == str(path), "WORKSPACE_BACKUP_SOURCE_MISMATCH", "The retained runtime belongs to a different directory.")
                expected = binding.get("expected", [])
                comparisons = [{key: {"expected": value, "actual": actual.get(key)} for key, value in item.items()} for item in expected]
                require(all(value["actual"] == value["expected"] for item in comparisons for value in item.values()),
                        "WORKSPACE_BACKUP_SOURCE_MISMATCH", "The registered runtime has a different original source or profile.")
                row.update({"source": actual, "comparisons": comparisons, "sourceVerified": any(bool(item) for item in comparisons)})
        except FileNotFoundError: row["status"] = "MISSING"
        except Failure as error:
            row["status"] = "SOURCE_MISMATCH" if error.code == "WORKSPACE_BACKUP_SOURCE_MISMATCH" else "UNAVAILABLE"
            row["error"] = {"code": error.code, "message": str(error)}
        except (OSError, ValueError) as error:
            row["status"] = "UNAVAILABLE"; row["error"] = {"code": getattr(error, "errno", None), "message": str(error)}
        output.append(row)
    home = absolute(manifest["workspace"]["runtimeHome"])
    try: private(home); home_ready = True
    except (OSError, Failure): home_ready = False
    review_id = str(uuid.uuid4())
    result = {"reviewId": review_id, "receivingId": operation_id, "directory": str(target), "workspaceId": current["workspaceId"],
              "checkedAt": timestamp(), "manifestSha256": current["manifestSha256"], "runtimeHomeReady": home_ready,
              "canOpen": home_ready and not any(row["status"] == "SOURCE_MISMATCH" for row in output), "bindings": output,
              "sourceReadiness": "REQUIRES_ORIGINAL_NATIVE_REVIEW"}
    result["reviewSha256"] = sha(encoded(result))
    folder = make_private(store / "binding-reviews" / review_id); atomic(folder / "review.json", result)
    return result

def accept(params):
    root = private(absolute(params["directory"])); inherited_gate(root)
    store = private(absolute(params["store"])); current = read_json(root / MARKER)
    review = read_json(store / "binding-reviews" / identifier(params["reviewId"]) / "review.json")
    require(review.get("reviewSha256") == sha(encoded({key: value for key, value in review.items() if key != "reviewSha256"})),
            "WORKSPACE_BACKUP_BINDING_REVIEW_CHANGED", "The retained full binding review bytes changed.")
    require(review["receivingId"] == params["receivingId"] == current["receivingId"] and
            review["reviewSha256"] == params["reviewSha256"] and review["manifestSha256"] == current["manifestSha256"],
            "WORKSPACE_BACKUP_BINDING_REVIEW_CHANGED", "Keep the selected original receiving and full binding review.")
    require(review["canOpen"] and review["runtimeHomeReady"], "WORKSPACE_BACKUP_BINDINGS_REQUIRED", "Receive the original private runtime home and resolve any source mismatch first.")
    if current["phase"] == "BINDINGS_REVIEWED":
        require(current["bindingReview"]["reviewId"] == review["reviewId"] and current["bindingReview"]["reviewSha256"] == review["reviewSha256"],
                "WORKSPACE_BACKUP_BINDINGS_ACCEPTED", "Reopen the exact accepted review; later workspace edits remain retained.")
        return {"receivingId": current["receivingId"], "directory": str(root), "workspaceId": current["workspaceId"],
                "phase": current["phase"], "launchesStarted": 0, "reopened": True, "sourceReadiness": "REQUIRES_ORIGINAL_NATIVE_REVIEW"}
    fresh = binding_review({"store": str(store), "receivingId": params["receivingId"], **({"hostBindings": review["hostBindings"]} if current.get("mode") == "new-host" else {})})
    stable = lambda data: {key: data[key] for key in ("directory", "workspaceId", "manifestSha256", "runtimeHomeReady", "canOpen", "bindings")}
    require(stable(fresh) == stable(review) and all(fresh.get(key) == review.get(key) for key in ("hostBindings", "runtimeEntries", "mode", "originalDirectory", "importedOperationCount")), "WORKSPACE_BACKUP_BINDING_REVIEW_CHANGED", "Binding availability changed; review the current original bindings.")
    current.update({"phase": "BINDINGS_REVIEWED", "updatedAt": timestamp(),
                    "bindingReview": {"reviewId": review["reviewId"], "reviewSha256": review["reviewSha256"], "checkedAt": review["checkedAt"]},
                    "launchesStarted": 0})
    if current.get("mode") == "new-host":
        current["hostBindings"] = review["hostBindings"]
        current["runtimeEntries"] = review["runtimeEntries"]
        require(len(encoded(current)) <= 4 * 1024 * 1024, "WORKSPACE_BACKUP_HISTORY_LIMIT", "Complete accepted receiving metadata exceeds its native reader limit.")
    atomic(root / MARKER, current)
    return {"receivingId": current["receivingId"], "directory": str(root), "workspaceId": current["workspaceId"],
            "phase": current["phase"], "launchesStarted": 0, "sourceReadiness": "REQUIRES_ORIGINAL_NATIVE_REVIEW"}

def process_record():
    result = {"pid": os.getpid(), "startedAt": timestamp()}
    try:
        text = pathlib.Path("/proc/self/stat").read_text()
        right = text.rindex(")")
        result.update({"procPid": int(text.split(" ", 1)[0]), "processStart": text[right + 2:].split()[19],
                       "pidNamespace": os.readlink("/proc/self/ns/pid")})
    except (OSError, ValueError, IndexError): pass
    return result

def main():
    params = json.loads(sys.stdin.buffer.read(1024 * 1024 + 1).decode("utf-8"))
    action = sys.argv[1]
    try:
        if action in ("export", "restore"): operation_record(params, "RUNNING", startedAt=timestamp(), child=process_record(), error=None)
        result = {"review": review, "export": export, "inspect": inspect, "restore": restore, "bindings": binding_review, "accept": accept}[action](params)
        print(json.dumps({"ok": True, "result": result}, ensure_ascii=False), flush=True)
    except BaseException as error:
        failure = {"code": getattr(error, "code", "WORKSPACE_BACKUP_FAILED"), "message": str(error), "type": type(error).__name__}
        if action in ("export", "restore"):
            try: operation_record(params, "FAILED", error=failure)
            except BaseException: pass
        try: print(json.dumps({"ok": False, "error": failure}), flush=True)
        except BrokenPipeError: pass
        raise SystemExit(1)

if __name__ == "__main__": main()
