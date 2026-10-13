#!/usr/bin/env python3
"""Back up and receive the complete installed SF47 planning workspace."""
from __future__ import annotations

import argparse
import ast
import base64
from datetime import datetime, timezone
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import sqlite3
import stat
import sys
import tempfile
from urllib.parse import urlsplit, urlunsplit
import zipfile

from model import HERE, Problem, Workspace, canonical

SCHEMA = "stellar-forge.sf47-staff-installation.v1"
APPLICATION = PurePosixPath("stellar/scf_2026/sf47_budget_model/workspace")
MANIFEST = "INSTALLATION-MANIFEST.json"
DATABASE = "planning.sqlite3"
SCENARIO = "scenario.json"
SOURCE_PREFIX = "source/"
TRANSIENT_TABLES = ("staff_sessions", "staff_requests", "staff_login_attempts")
CHANGED_TABLES = frozenset((*TRANSIENT_TABLES, "staff_members", "staff_metadata"))
SOURCE_SUFFIXES = frozenset((
    ".py", ".mjs", ".js", ".json", ".md", ".css", ".html", ".txt",
    ".ts", ".mts", ".svg", ".png", ".ico", ".woff", ".woff2",
))
IGNORE_DIRECTORIES = frozenset((".git", "__pycache__", "node_modules", ".pytest_cache"))
# The installed source uses literal relative modules. Asset references are also
# followed, while developer prose and example URLs are not module declarations.
MODULE = re.compile(
    r"(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|"
    r"(?m:^\s*import\s*))['\"](\.[^'\"\r\n]+)['\"]"
)
URL_ASSET = re.compile(r"\bnew\s+URL\s*\(\s*['\"](\.[^'\"\r\n]+)['\"]\s*,\s*import\.meta\.url")
RELATIVE_FILE = re.compile(r"['\"](\.\.?/[^'\"\r\n]+\.(?:mjs|js|json|css|html|svg|txt))['\"]")
CORE_FILES = frozenset((
    "model.py", "server.py", "cli.py", "operations.py", "operations_http.py",
    "managed_launch.py", "launch.mjs", "STAFF_INSTALLATION_RECEIVING.py",
    "staff_access.py", "staff_http.py", "staff_installation.py", "STAFF_INSTALLATION.md",
    "staff.html", "staff.mjs", "staff-session.mjs", "staff.css",
))


def utc():
    return datetime.now(timezone.utc).isoformat()


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def fail(message, code="STAFF_INSTALLATION_INVALID", status=422):
    raise Problem(message, status, code)


def quote(identifier):
    return '"' + identifier.replace('"', '""') + '"'


def private_json(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False) + "\n").encode()


def sync_directory(path):
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def write_private(path, raw):
    path = Path(path)
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "wb") as stream:
        stream.write(raw)
        stream.flush()
        os.fsync(stream.fileno())


def stable_bytes(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, "rb") as stream:
        before = os.fstat(stream.fileno())
        if not stat.S_ISREG(before.st_mode):
            fail("Select an original regular source file.", "STAFF_SOURCE_NOT_REGULAR")
        raw = stream.read()
        after = os.fstat(stream.fileno())
        if (before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (
                after.st_size, after.st_mtime_ns, after.st_ctime_ns) or len(raw) != before.st_size:
            fail("The installed source changed while its backup was being prepared.",
                 "STAFF_SOURCE_CHANGED", 409)
        return raw


def _cell(value):
    if value is None:
        return ["null"]
    if isinstance(value, bytes):
        return ["blob", base64.b64encode(value).decode("ascii")]
    if isinstance(value, int):
        return ["integer", str(value)]
    if isinstance(value, float):
        return ["real", value.hex()]
    return ["text", value]


def table_fingerprints(db, excluded_columns=None):
    """Hash every typed SQLite value, independently of physical page layout."""
    excluded_columns = excluded_columns or {}
    tables = db.execute(
        "SELECT name,sql FROM sqlite_master WHERE type='table' ORDER BY name"
    ).fetchall()
    result = {}
    for name, definition in tables:
        columns = [row[1] for row in db.execute("PRAGMA table_info(" + quote(name) + ")")]
        selected = [column for column in columns if column not in excluded_columns.get(name, ())]
        if not selected:
            continue
        hashes = []
        query = "SELECT " + ",".join(quote(column) for column in selected) + " FROM " + quote(name)
        for row in db.execute(query):
            hashes.append(sha(canonical([_cell(value) for value in row]).encode()))
        digest = hashlib.sha256(canonical({"columns": selected, "sql": definition}).encode())
        for row_hash in sorted(hashes):
            digest.update(bytes.fromhex(row_hash))
        result[name] = {"rows": len(hashes), "sha256": digest.hexdigest(), "columns": selected}
    return result


def business_fingerprints(db):
    return {name: record for name, record in table_fingerprints(db).items()
            if name not in CHANGED_TABLES}


def _table_exists(db, name):
    return db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)).fetchone() is not None


def staff_roster(db):
    if not _table_exists(db, "staff_members"):
        return []
    columns = [row[1] for row in db.execute("PRAGMA table_info(staff_members)") if row[1] != "credential_hash"]
    return [dict(zip(columns, row)) for row in db.execute(
        "SELECT " + ",".join(quote(column) for column in columns) + " FROM staff_members ORDER BY id"
    )]


def connection_selections(db):
    """Retain saved accounting identities without connecting to their servers."""
    if not _table_exists(db, "commercial_receivables_connections"):
        return []
    result = []
    for identifier, document in db.execute(
            "SELECT id,document FROM commercial_receivables_connections ORDER BY id"):
        try:
            value = json.loads(document)
            parsed = urlsplit(value.get("baseUrl", ""))
            authority = parsed.hostname or ""
            if ":" in authority:
                authority = "[" + authority + "]"
            if parsed.port is not None:
                authority += ":" + str(parsed.port)
            endpoint = urlunsplit((parsed.scheme, authority, parsed.path, "", ""))
            result.append({
                "id": identifier, "label": value.get("label"),
                "baseUrl": endpoint, "workspaceId": value.get("workspaceId"),
                "sourcesSha256": value.get("sourcesSha256"),
                "state": "ORIGINAL_SERVER_REQUIRED",
            })
        except (ValueError, TypeError, AttributeError):
            result.append({"id": identifier, "state": "SAVED_CONFIGURATION_REVIEW_REQUIRED"})
    return result


def _relative_member(name):
    if not isinstance(name, str) or not name or "\\" in name or "\x00" in name:
        fail("The installation contains an invalid file name.")
    path = PurePosixPath(name)
    if path.is_absolute() or any(part in ("", ".", "..") for part in path.parts) or str(path) != name:
        fail("The installation contains a nonportable file name.")
    return path



def launcher_boot_files(source_directory):
    """Read the selected original Python launcher's complete literal inventory."""
    selected = Path(source_directory).expanduser().resolve()
    try:
        tree = ast.parse(stable_bytes(selected / "managed_launch.py"), filename="managed_launch.py")
        assignments = [node.value for node in tree.body
                       if isinstance(node, ast.Assign)
                       and any(isinstance(target, ast.Name) and target.id == "BOOT_FILES"
                               for target in node.targets)]
        assignments.extend(node.value for node in tree.body
                           if isinstance(node, ast.AnnAssign)
                           and isinstance(node.target, ast.Name)
                           and node.target.id == "BOOT_FILES")
        if len(assignments) != 1:
            fail("The selected managed launcher has no single original source inventory.",
                 "STAFF_LAUNCH_SOURCE_INVALID")
        names = ast.literal_eval(assignments[0])
    except (SyntaxError, UnicodeError, ValueError, TypeError, MemoryError, RecursionError):
        fail("The selected managed launcher source inventory is not a literal list of files.",
             "STAFF_LAUNCH_SOURCE_INVALID")
    if (not isinstance(names, (tuple, list)) or not names
            or any(not isinstance(name, str) or not name or "\\" in name or "\x00" in name
                   or Path(name).is_absolute() for name in names)
            or len(names) != len(set(names))):
        fail("The selected managed launcher source inventory contains invalid or repeated files.",
             "STAFF_LAUNCH_SOURCE_INVALID")
    return tuple(names)



def python_source_dependencies(path, raw, repository, observed, cache=None):
    """Follow each entry point's ordered imports without rewalking function trees."""
    cache = cache if cache is not None else {}
    parsed = cache.setdefault("parsed", {})
    scheduled = cache.setdefault("deferred", set())
    source_bytes = cache.setdefault("source_bytes", {})
    dependencies = set()
    deferred = []

    def search_identity(search):
        # Repeated path entries select the same first source and need no new walk.
        return tuple(dict.fromkeys(search))

    def source(candidate):
        if candidate not in source_bytes:
            source_bytes[candidate] = stable_bytes(candidate)
        return source_bytes[candidate]

    def literal(node, scope):
        if isinstance(node, ast.Constant) and isinstance(node.value, (str, int)):
            return node.value
        if isinstance(node, ast.Name):
            return scope.get(node.id)
        if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Div):
            left, right = literal(node.left, scope), literal(node.right, scope)
            return left / right if isinstance(left, Path) and isinstance(right, str) else None
        if isinstance(node, ast.Attribute):
            value = literal(node.value, scope)
            if isinstance(value, Path) and node.attr == "parent":
                return value.parent
        if (isinstance(node, ast.Subscript) and isinstance(node.value, ast.Attribute)
                and node.value.attr == "parents"):
            value, index = literal(node.value.value, scope), literal(node.slice, scope)
            if isinstance(value, Path) and type(index) is int and 0 <= index < len(value.parents):
                return value.parents[index]
        if isinstance(node, ast.Call):
            if (isinstance(node.func, ast.Name) and node.func.id in ("Path", "str")
                    and len(node.args) == 1 and not node.keywords):
                value = literal(node.args[0], scope)
                return value if isinstance(value, Path) else None
            if isinstance(node.func, ast.Attribute):
                value = literal(node.func.value, scope)
                if isinstance(value, Path) and not node.keywords:
                    if node.func.attr in ("resolve", "absolute") and not node.args:
                        return value.absolute()
                    if node.func.attr in ("with_name", "joinpath"):
                        args = [literal(arg, scope) for arg in node.args]
                        if args and all(isinstance(arg, str) for arg in args):
                            return (value.with_name(args[0]) if node.func.attr == "with_name" and len(args) == 1
                                    else value.joinpath(*args) if node.func.attr == "joinpath" else None)
        return None

    def inspect(node, scope, search):
        value = literal(node, scope)
        if isinstance(value, Path) and value.suffix in SOURCE_SUFFIXES:
            dependencies.add(value)
        if (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                and node.func.attr in ("insert", "append")
                and isinstance(node.func.value, ast.Attribute)
                and isinstance(node.func.value.value, ast.Name)
                and node.func.value.value.id == "sys" and node.func.value.attr == "path"
                and node.args):
            directory = literal(node.args[-1], scope)
            if isinstance(directory, Path):
                if node.func.attr == "append":
                    search.append(directory)
                else:
                    index = literal(node.args[0], scope) if len(node.args) > 1 else 0
                    search.insert(index if type(index) is int else 0, directory)
        # Statement blocks are visited with their own execution context below.
        # Walking a function body here would apply a deferred sys.path mutation
        # before its caller, and inspecting it again would apply it twice.
        for child in ast.iter_child_nodes(node):
            if not isinstance(child, ast.stmt):
                inspect(child, scope, search)

    def checked_source(candidate):
        if candidate.is_symlink():
            fail("The installed application contains a source symlink.", "STAFF_SOURCE_SYMLINK")
        selected = candidate.resolve()
        try:
            selected.relative_to(repository)
        except ValueError:
            fail("An installed source dependency leaves its original repository.", "STAFF_SOURCE_LAYOUT")
        return selected

    def scan(entry, data, search, loaded):
        entry = checked_source(entry)
        identity = (len(data), sha(data))
        previous = observed.setdefault(entry, identity)
        if previous != identity:
            fail("An imported source changed during its backup.", "STAFF_SOURCE_CHANGED", 409)
        if entry in loaded:
            return
        loaded.add(entry)
        if entry not in parsed:
            try:
                parsed[entry] = ast.parse(data, filename=str(entry))
            except (SyntaxError, UnicodeError):
                fail("The installed Python source cannot be read: " + str(entry), "STAFF_SOURCE_ENCODING")
        tree = parsed[entry]
        source_bytes.setdefault(entry, data)

        def receive_module(candidate, import_search, imported):
            selected = checked_source(candidate)
            dependencies.add(selected)
            if selected not in imported:
                scan(selected, source(selected), import_search, imported)
            return selected

        def imports(node, search, loaded):
            if isinstance(node, ast.Import):
                modules = [(name.name, 0) for name in node.names]
            elif node.module:
                modules = [(node.module, node.level)]
            else:
                modules = [(name.name, node.level) for name in node.names if name.name != "*"]
            for module, level in modules:
                if not level and module.split(".", 1)[0] in sys.stdlib_module_names:
                    continue
                roots = list(search)
                if level:
                    base = entry.parent
                    for _ in range(level - 1):
                        base = base.parent
                    roots = [base]
                suffix = Path(*module.split("."))
                candidates = [candidate for root in roots for candidate in
                              (root / suffix.with_suffix(".py"), root / suffix / "__init__.py")]
                selected = next((candidate for candidate in candidates if candidate.is_file()), None)
                if selected is None:
                    if level or len(search) > 1:
                        fail("Complete the original local Python import " + module + " in " + str(entry) +
                             "; searched " + ", ".join(str(candidate) for candidate in candidates),
                             "STAFF_SOURCE_INCOMPLETE")
                    continue
                # A package initializer executes before its selected submodule.
                for root in roots:
                    try:
                        relative = selected.relative_to(root)
                    except ValueError:
                        continue
                    for index in range(1, len(relative.parts)):
                        initializer = root.joinpath(*relative.parts[:index], "__init__.py")
                        if initializer.is_file() and initializer != selected:
                            receive_module(initializer, search, loaded)
                    break
                selected = receive_module(selected, search, loaded)
                if selected.name == "__init__.py" and isinstance(node, ast.ImportFrom):
                    for name in node.names:
                        if name.name == "*":
                            continue
                        for child in (selected.parent / (name.name + ".py"),
                                      selected.parent / name.name / "__init__.py"):
                            if child.is_file():
                                receive_module(child, search, loaded)
                                break

        def visit(statements, scope, search, loaded):
            for node in statements:
                if isinstance(node, (ast.Import, ast.ImportFrom)):
                    # The imported module's literal top-level path changes are
                    # visible to the following import in this same entry point.
                    imports(node, search, loaded)
                    continue
                inspect(node, scope, search)
                if isinstance(node, (ast.Assign, ast.AnnAssign)):
                    value = literal(node.value, scope)
                    targets = node.targets if isinstance(node, ast.Assign) else [node.target]
                    for target in targets:
                        if isinstance(target, ast.Name):
                            if value is None:
                                scope.pop(target.id, None)
                            else:
                                scope[target.id] = value
                if (isinstance(node, ast.For) and isinstance(node.target, ast.Name)
                        and isinstance(node.iter, (ast.Tuple, ast.List))):
                    values = [literal(item, scope) for item in node.iter.elts]
                    if values and all(value is not None for value in values):
                        for value in values:
                            scope[node.target.id] = value
                            visit(node.body, scope, search, loaded)
                        visit(node.orelse, scope, search, loaded)
                        continue
                if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    # A definition does not execute its imports. Queue the body
                    # after the module's ordered imports have finished, retaining
                    # its own mutable module context until that point.
                    deferred.append((entry, node, visit, scope, search, loaded))
                    continue
                if isinstance(node, ast.ClassDef):
                    visit(node.body, scope.copy(), search, loaded)
                    continue
                # Conditional/deferred paths retain their local imports without
                # changing an unrelated sibling product's module-search context.
                for field in ("body", "orelse", "finalbody"):
                    block = getattr(node, field, None)
                    if isinstance(block, list):
                        visit(block, scope.copy(), search.copy(), loaded.copy())
                for handler in getattr(node, "handlers", ()):
                    visit(handler.body, scope.copy(), search.copy(), loaded.copy())

        visit(tree.body, {"__file__": entry}, search, loaded)

    scan(path, raw, [path.parent], set())
    cursor = 0
    while cursor < len(deferred):
        entry, node, visit, enclosing, search, loaded = deferred[cursor]
        cursor += 1
        local = enclosing.copy()
        arguments = [*node.args.posonlyargs, *node.args.args, *node.args.kwonlyargs]
        for argument in arguments:
            local.pop(argument.arg, None)
        for argument in (node.args.vararg, node.args.kwarg):
            if argument is not None:
                local.pop(argument.arg, None)
        roots = search_identity(search)
        identity = (entry, node.lineno, node.col_offset, roots, tuple(sorted(local.items())))
        if identity in scheduled:
            continue
        scheduled.add(identity)
        visit(node.body, local, list(roots), loaded.copy())
    return dependencies


def source_inventory(source_directory=None):
    """Carry the original application and its actual local module dependencies."""
    selected = Path(source_directory or HERE).expanduser().resolve()
    if len(selected.parents) < 4:
        fail("Select the original installed Grant Operations source.", "STAFF_SOURCE_REQUIRED")
    repository = selected.parents[3]
    if selected.relative_to(repository).as_posix() != APPLICATION.as_posix():
        fail("Keep the installed source in its original repository layout.", "STAFF_SOURCE_LAYOUT")
    missing_core = [name for name in CORE_FILES if not (selected / name).is_file()]
    if missing_core or not (selected.parent / "budget.py").is_file():
        fail("The installed application source is incomplete.", "STAFF_SOURCE_INCOMPLETE")
    # Every selected Applications boot file is required, including entries in
    # neighboring product directories. An absent literal must never disappear
    # merely because an optional source-reference scan could not open it.
    pending = [selected / name for name in launcher_boot_files(selected)]
    for directory, subdirs, names in os.walk(selected):
        subdirs[:] = sorted(name for name in subdirs
                            if name not in IGNORE_DIRECTORIES and not name.startswith("."))
        for name in sorted(names):
            path = Path(directory) / name
            if not name.startswith(".") and path.suffix in SOURCE_SUFFIXES:
                pending.append(path)
    pending.extend(path for path in selected.parent.iterdir()
                   if path.is_file() and not path.name.startswith(".") and path.suffix in SOURCE_SUFFIXES)
    files, missing, observed_python, python_cache = {}, set(), {}, {}
    while pending:
        path = pending.pop()
        if path.is_symlink():
            fail("The installed application contains a source symlink.", "STAFF_SOURCE_SYMLINK")
        path = path.resolve()
        try:
            relative = path.relative_to(repository).as_posix()
        except ValueError:
            fail("An installed source dependency leaves its original repository.", "STAFF_SOURCE_LAYOUT")
        member = SOURCE_PREFIX + relative
        if member in files:
            continue
        if not path.is_file():
            missing.add(relative)
            continue
        raw = stable_bytes(path)
        files[member] = raw
        if path.suffix == ".py":
            pending.extend(python_source_dependencies(path, raw, repository, observed_python, python_cache))
        if path.suffix not in (".mjs", ".js", ".mts", ".ts"):
            continue
        try:
            code = raw.decode("utf-8")
        except UnicodeError:
            fail("An installed JavaScript module is not UTF-8.", "STAFF_SOURCE_ENCODING")
        required = set(MODULE.findall(code))
        required.update(name for name in URL_ASSET.findall(code)
                        if not name.endswith("/") and (path.parent / name).suffix)
        # Some original source readers retain a list of exact files whose hashes
        # they inspect with new URL(relative, import.meta.url).
        optional = set(RELATIVE_FILE.findall(code)) - required
        for name in required | optional:
            if "?" in name or "#" in name:
                name = name.split("?", 1)[0].split("#", 1)[0]
            dependency = path.parent / name
            if dependency.is_file() or name in required:
                pending.append(dependency)
    if missing:
        fail("Complete these original installed source dependencies before exporting: " +
             ", ".join(sorted(missing)), "STAFF_SOURCE_INCOMPLETE")
    # A source editor changing an earlier member while later dependencies are read
    # is detected before the complete archive is published.
    for member, raw in files.items():
        if stable_bytes(repository / member[len(SOURCE_PREFIX):]) != raw:
            fail("The installed source changed during its backup.", "STAFF_SOURCE_CHANGED", 409)
    return files


def _database_check(db):
    if db.execute("PRAGMA integrity_check").fetchone() != ("ok",):
        fail("The planning database did not pass SQLite's integrity check.",
             "STAFF_DATABASE_INTEGRITY")
    if not _table_exists(db, "plans") or not _table_exists(db, "revisions"):
        fail("Select a complete original SF47 planning database.", "STAFF_DATABASE_REQUIRED")


def _original_scenario(db):
    row = db.execute(
        "SELECT id,source_name,source_sha,source_bytes FROM plans ORDER BY created_at,id LIMIT 1"
    ).fetchone()
    if row is None or row[3] is None:
        fail("The original planning scenario bytes are unavailable.", "STAFF_SCENARIO_REQUIRED")
    raw = bytes(row[3])
    if sha(raw) != row[2]:
        fail("The original scenario bytes differ from their saved identity.", "STAFF_SCENARIO_CHANGED")
    try:
        json.loads(raw)
    except (ValueError, UnicodeError):
        fail("The retained original scenario is not readable JSON.", "STAFF_SCENARIO_INVALID")
    return raw, {"planId": row[0], "filename": row[1], "sha256": row[2], "bytes": len(raw)}


def export_installation(workspace, *, source_directory=None):
    """Return (ZIP bytes, manifest) from one complete original SQLite snapshot."""
    sources = source_inventory(source_directory)
    with tempfile.TemporaryDirectory(prefix="sf47-installation-backup-") as temporary:
        database = Path(temporary) / DATABASE
        with workspace.mutex:
            if workspace.db is None:
                fail("Open the original planning workspace before exporting.", "STAFF_WORKSPACE_CLOSED", 409)
            if workspace.db.in_transaction:
                fail("Finish the current save before exporting the installation.",
                     "STAFF_SAVE_IN_PROGRESS", 409)
            snapshot = sqlite3.connect(database, isolation_level=None)
            try:
                workspace.db.backup(snapshot)
                snapshot.execute("PRAGMA journal_mode=DELETE")
                _database_check(snapshot)
                original, scenario = _original_scenario(snapshot)
                tables = table_fingerprints(snapshot)
                retained = business_fingerprints(snapshot)
                roster = staff_roster(snapshot)
                connections = connection_selections(snapshot)
            finally:
                snapshot.close()
        os.chmod(database, 0o600)
        files = {DATABASE: stable_bytes(database), SCENARIO: original, **sources}
        manifest = {
            "schema": SCHEMA, "createdAt": utc(), "scenario": scenario,
            "database": {"file": DATABASE, "tables": tables, "businessTables": retained},
            "staff": {"roster": roster, "rosterSha256": sha(canonical(roster).encode()),
                      "restore": "REISSUE_LOGIN_CODES"},
            "connections": connections,
            "application": {
                "directory": SOURCE_PREFIX + APPLICATION.as_posix(),
                "entrypoint": SOURCE_PREFIX + (APPLICATION / "cli.py").as_posix(),
                "sourceFiles": len(sources),
            },
            "files": [{"path": name, "bytes": len(raw), "sha256": sha(raw)}
                      for name, raw in sorted(files.items())],
        }
        output = io.BytesIO()
        with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED, compresslevel=6, allowZip64=True) as archive:
            for name, raw in sorted({**files, MANIFEST: private_json(manifest)}.items()):
                info = zipfile.ZipInfo(name, (2026, 1, 1, 0, 0, 0))
                info.create_system = 3
                info.external_attr = (stat.S_IFREG | 0o600) << 16
                info.compress_type = zipfile.ZIP_DEFLATED
                archive.writestr(info, raw)
        return output.getvalue(), manifest


def _open_archive(value):
    if isinstance(value, (str, os.PathLike)):
        return zipfile.ZipFile(Path(value))
    if isinstance(value, (bytes, bytearray)):
        return zipfile.ZipFile(io.BytesIO(value))
    fail("Select the complete installation ZIP.", "STAFF_ARCHIVE_REQUIRED")


def _validated_archive(archive):
    try:
        entries = archive.infolist()
        names = [entry.filename for entry in entries]
        if len(names) != len(set(names)) or MANIFEST not in names:
            fail("The installation archive has duplicate files or no manifest.")
        for entry in entries:
            _relative_member(entry.filename)
            mode = entry.external_attr >> 16
            if entry.is_dir() or (stat.S_IFMT(mode) not in (0, stat.S_IFREG)):
                fail("The installation must contain regular files only.")
        manifest = json.loads(archive.read(MANIFEST), parse_constant=lambda value: (
            _ for _ in ()).throw(ValueError("Non-finite manifest number")))
        if not isinstance(manifest, dict) or manifest.get("schema") != SCHEMA:
            fail("Select an original staff installation backup.", "STAFF_ARCHIVE_SCHEMA")
        database, staff = manifest.get("database"), manifest.get("staff")
        if (not isinstance(database, dict) or database.get("file") != DATABASE
                or not isinstance(database.get("tables"), dict)
                or not isinstance(database.get("businessTables"), dict)
                or not isinstance(staff, dict) or not isinstance(staff.get("roster"), list)
                or any(not isinstance(row, dict) for row in staff["roster"])
                or staff.get("restore") != "REISSUE_LOGIN_CODES"
                or not isinstance(manifest.get("scenario"), dict)
                or not isinstance(manifest.get("connections"), list)):
            fail("The installation's database, staff or connection manifest is incomplete.")
        for name, record in database["tables"].items():
            if (not isinstance(name, str) or not name or not isinstance(record, dict)
                    or type(record.get("rows")) is not int or record["rows"] < 0
                    or not isinstance(record.get("sha256"), str)
                    or not re.fullmatch(r"[a-f0-9]{64}", record["sha256"])
                    or not isinstance(record.get("columns"), list)
                    or any(not isinstance(column, str) for column in record["columns"])):
                fail("The installation's original table identities are incomplete.")
        if database["businessTables"] != {
                name: row for name, row in database["tables"].items() if name not in CHANGED_TABLES}:
            fail("The retained business table selection differs from the complete database.")
        if staff.get("rosterSha256") != sha(canonical(staff["roster"]).encode()):
            fail("The installation's staff roster differs from its original identity.")
        records = manifest.get("files")
        if not isinstance(records, list):
            fail("The installation file manifest is incomplete.")
        members = {}
        for record in records:
            if not isinstance(record, dict):
                fail("The installation file manifest is incomplete.")
            name = record.get("path")
            _relative_member(name)
            if name in members or name == MANIFEST:
                fail("The installation file manifest contains duplicates.")
            if not (name in (DATABASE, SCENARIO) or name.startswith(SOURCE_PREFIX)):
                fail("The installation contains a file outside its database, scenario and source.")
            if type(record.get("bytes")) is not int or record["bytes"] < 0 or not re.fullmatch(
                    r"[a-f0-9]{64}", record.get("sha256", "")):
                fail("The installation file identity is invalid.")
            members[name] = record
        if set(members) | {MANIFEST} != set(names):
            fail("The installation archive differs from its complete manifest.")
        required = {DATABASE, SCENARIO, SOURCE_PREFIX + str(APPLICATION.parent / "budget.py")}
        required |= {SOURCE_PREFIX + str(APPLICATION / name) for name in CORE_FILES}
        if not required <= set(members):
            fail("The installation has no complete original application source.")
        expected_app = {
            "directory": SOURCE_PREFIX + APPLICATION.as_posix(),
            "entrypoint": SOURCE_PREFIX + (APPLICATION / "cli.py").as_posix(),
            "sourceFiles": sum(name.startswith(SOURCE_PREFIX) for name in members),
        }
        if manifest.get("application") != expected_app:
            fail("The installed application selection differs from its source files.")
        for name, record in members.items():
            info = archive.getinfo(name)
            if info.file_size != record["bytes"]:
                fail("An installation file size differs: " + name)
            digest = hashlib.sha256()
            with archive.open(name) as stream:
                while True:
                    block = stream.read(1024 * 1024)
                    if not block:
                        break
                    digest.update(block)
            if digest.hexdigest() != record["sha256"]:
                fail("An installation file digest differs: " + name)
        return manifest, members
    except (zipfile.BadZipFile, KeyError, UnicodeError, ValueError, TypeError, RuntimeError) as error:
        if isinstance(error, Problem):
            raise
        fail("The installation ZIP is incomplete or unreadable.", "STAFF_ARCHIVE_UNREADABLE")


def inspect_installation(value):
    """Validate every member without executing source or opening a connection."""
    try:
        with _open_archive(value) as archive:
            manifest, _ = _validated_archive(archive)
            return manifest
    except zipfile.BadZipFile:
        fail("Select a complete installation ZIP.", "STAFF_ARCHIVE_UNREADABLE")


def _reset_access(db):
    reset = {}
    for name in TRANSIENT_TABLES:
        if _table_exists(db, name):
            reset[name] = db.execute("SELECT COUNT(*) FROM " + quote(name)).fetchone()[0]
            db.execute("DELETE FROM " + quote(name))
    if _table_exists(db, "staff_members"):
        columns = {row[1] for row in db.execute("PRAGMA table_info(staff_members)")}
        if "credential_hash" in columns:
            reset["loginCodes"] = db.execute(
                "SELECT COUNT(*) FROM staff_members WHERE credential_hash IS NOT NULL"
            ).fetchone()[0]
            db.execute("UPDATE staff_members SET credential_hash=NULL")
    if _table_exists(db, "staff_metadata"):
        reset["installationIdentity"] = db.execute(
            "SELECT COUNT(*) FROM staff_metadata WHERE key='installation_id'"
        ).fetchone()[0]
        db.execute("DELETE FROM staff_metadata WHERE key='installation_id'")
    return reset


def restore_installation(value, destination):
    """Receive into an atomic, new private target; keep the original untouched."""
    target = Path(destination).expanduser().absolute()
    if target == target.parent or target.is_symlink():
        fail("Choose a new empty private installation directory.", "STAFF_RESTORE_TARGET")
    target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    if target.exists() and (not target.is_dir() or any(target.iterdir())):
        fail("Choose an empty directory. This restoration keeps existing workspaces intact.",
             "STAFF_RESTORE_TARGET_EXISTS", 409)
    if target.exists() and target.stat().st_uid != os.getuid():
        fail("Use a private restoration directory owned by this operator.", "STAFF_RESTORE_TARGET")
    staging = Path(tempfile.mkdtemp(prefix="." + target.name + "-restore-", dir=target.parent))
    os.chmod(staging, 0o700)
    installed = False
    try:
        with _open_archive(value) as archive:
            manifest, members = _validated_archive(archive)
            for name in sorted(members):
                path = staging.joinpath(*PurePosixPath(name).parts)
                with archive.open(name) as stream:
                    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
                    with os.fdopen(fd, "wb") as output:
                        shutil.copyfileobj(stream, output, length=1024 * 1024)
                        output.flush()
                        os.fsync(output.fileno())
        db = sqlite3.connect(staging / DATABASE, isolation_level=None)
        try:
            db.execute("PRAGMA journal_mode=DELETE")
            _database_check(db)
            if table_fingerprints(db) != manifest["database"]["tables"]:
                fail("The received database differs from the original full snapshot.",
                     "STAFF_DATABASE_CHANGED")
            raw_scenario, scenario_identity = _original_scenario(db)
            if (stable_bytes(staging / SCENARIO) != raw_scenario
                    or manifest["scenario"] != scenario_identity):
                fail("The received scenario differs from the original planning source.")
            if connection_selections(db) != manifest["connections"]:
                fail("The received commercial selections differ from the original database.")
            original_roster = staff_roster(db)
            if sha(canonical(original_roster).encode()) != manifest["staff"]["rosterSha256"]:
                fail("The received staff assignments differ from the original installation.")
            db.execute("PRAGMA secure_delete=ON")
            db.execute("BEGIN IMMEDIATE")
            try:
                reset = _reset_access(db)
                if business_fingerprints(db) != manifest["database"]["businessTables"]:
                    fail("A business table changed during access reset.", "STAFF_BUSINESS_CHANGED")
                if staff_roster(db) != original_roster:
                    fail("A staff role or case assignment changed during access reset.",
                         "STAFF_ROSTER_CHANGED")
                db.execute("COMMIT")
            except BaseException:
                db.execute("ROLLBACK")
                raise
            _database_check(db)
            if business_fingerprints(db) != manifest["database"]["businessTables"]:
                fail("The restored business tables differ from their original snapshot.",
                     "STAFF_BUSINESS_CHANGED")
        finally:
            db.close()
        # Validate the actual received relative module closure, using only source
        # reads. Source from the archive is never imported during restoration.
        actual_source = source_inventory(staging / SOURCE_PREFIX / APPLICATION)
        expected_source = {name: record for name, record in members.items() if name.startswith(SOURCE_PREFIX)}
        if set(actual_source) != set(expected_source) or any(
                sha(raw) != expected_source[name]["sha256"] for name, raw in actual_source.items()):
            fail("The restored application source closure differs from its original manifest.",
                 "STAFF_SOURCE_CHANGED")
        result = {
            "schema": SCHEMA, "restoredAt": utc(), "state": "RESTORED",
            "workspace": str(target),
            "sourceDirectory": str(target / SOURCE_PREFIX / APPLICATION),
            "scenarioFile": str(target / SCENARIO),
            "entrypoint": str(target / SOURCE_PREFIX / APPLICATION / "cli.py"),
            "start": ["python3", str(target / SOURCE_PREFIX / APPLICATION / "cli.py"),
                      "serve", "--workspace", str(target), "--scenario", str(target / SCENARIO)],
            "sourceManifestSha256": sha(private_json(manifest)),
            "businessTables": manifest["database"]["businessTables"],
            "staffRosterSha256": manifest["staff"]["rosterSha256"],
            "staffMembers": len(original_roster), "accessReset": reset,
            "connections": manifest["connections"],
            "ownerAction": "Open the new owner's private access file and reissue staff login codes.",
        }
        write_private(staging / MANIFEST, private_json(manifest))
        write_private(staging / "INSTALLATION.json", private_json(result))
        guide = (
            "# Restored SCF workspace\n\n"
            "The original planning database, case histories, source documents, staff roles and assignments are installed here.\n\n"
            "From this directory, run:\n\n"
            "    python3 source/stellar/scf_2026/sf47_budget_model/workspace/cli.py serve --workspace . --scenario scenario.json\n\n"
            "The normal server creates a fresh access.key, installation identity and private open-workspace.html. "
            "The owner opens that file, reviews the retained staff roster and issues new login codes. "
            "Keep the owner's access file private; distribute each staff member's own new code.\n\n"
            "Saved commercial connections still select their original receivables workspace and source identity. "
            "Start or restore those original services using their own delivery package, then inspect and reconnect them through "
            "the application's original connection workflow.\n\n"
            "INSTALLATION.json records the complete restoration and access reset. "
            "The original installation manifest and all source-file hashes remain in INSTALLATION-MANIFEST.json.\n"
        )
        write_private(staging / "START.md", guide.encode())
        sync_directory(staging)
        # POSIX rename publishes the complete directory atomically and refuses a
        # populated destination. A concurrent save therefore keeps its own data.
        os.rename(staging, target)
        installed = True
        sync_directory(target.parent)
        return result
    except zipfile.BadZipFile:
        fail("Select a complete installation ZIP.", "STAFF_ARCHIVE_UNREADABLE")
    except OSError as error:
        if error.errno in (17, 39):
            fail("The restoration target now contains another operation. Choose a new empty directory.",
                 "STAFF_RESTORE_TARGET_EXISTS", 409)
        raise
    finally:
        if not installed:
            shutil.rmtree(staging)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    backup = sub.add_parser("backup", help="Save the complete original workspace and installed source")
    backup.add_argument("--workspace", required=True, type=Path)
    backup.add_argument("--output", required=True, type=Path)
    backup.add_argument("--source-directory", type=Path, default=HERE)
    backup.add_argument("--scenario", type=Path, default=HERE.parent / "sf10_current_candidate.json")
    inspect = sub.add_parser("inspect", help="Read and verify the complete installation manifest")
    inspect.add_argument("--file", required=True, type=Path)
    restore = sub.add_parser("restore", help="Install into a new empty private workspace directory")
    restore.add_argument("--file", required=True, type=Path)
    restore.add_argument("--directory", required=True, type=Path)
    args = parser.parse_args(argv)
    if args.command == "backup":
        if not (args.workspace / DATABASE).is_file():
            fail("Select the existing original planning workspace.", "STAFF_DATABASE_REQUIRED")
        workspace = Workspace(args.workspace, args.scenario)
        try:
            raw, manifest = export_installation(workspace, source_directory=args.source_directory)
        finally:
            workspace.close()
        write_private(args.output, raw)
        result = {"schema": SCHEMA, "file": str(args.output.absolute()), "bytes": len(raw),
                  "sha256": sha(raw), "staffMembers": len(manifest["staff"]["roster"]),
                  "sourceFiles": manifest["application"]["sourceFiles"],
                  "businessTables": len(manifest["database"]["businessTables"])}
    elif args.command == "inspect":
        result = inspect_installation(args.file)
    else:
        result = restore_installation(args.file, args.directory)
    print(json.dumps(result, ensure_ascii=False, sort_keys=True, allow_nan=False))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Problem as error:
        print(json.dumps({"error": {"code": error.code, "message": str(error), "status": error.status}}))
        raise SystemExit(2)

