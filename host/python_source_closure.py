#!/usr/bin/env python3
"""Collect complete Python source without importing or executing the selected application.

The search model is the standard filesystem source finder under explicitly ordered
module roots. Original source bytes, parser observations and dynamic selections travel
together. No environment package lookup, package installation or network IO is used.
"""
from __future__ import annotations

import argparse
import _imp
import ast
import base64
import gzip
import hashlib
import io
import json
import os
import re
import stat
import sys
import tempfile
import tokenize
from pathlib import Path

SCHEMA = "commons.python-source-closure/v1"
SELECTION_SCHEMA = "commons.python-source-selection/v1"
MATERIALIZATION_SCHEMA = "commons.source-materialization/v1"
DEFAULTS = {"max_files": 8192, "max_source_bytes": 64 * 1024 * 1024,
            "max_file_bytes": 8 * 1024 * 1024, "max_probes": 100000,
            "max_references": 100000}
MAX_PACKET = 256 * 1024 * 1024
MAX_COMPRESSED = 128 * 1024 * 1024
_RESERVED = re.compile(r"^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)", re.I)
_HEX = re.compile(r"^[0-9a-f]{64}$")


class SourceError(Exception):
    def __init__(self, code, message, detail=None):
        super().__init__(message)
        self.code, self.detail = code, detail

    def record(self):
        result = {"code": self.code, "message": str(self)}
        if self.detail is not None:
            result["detail"] = self.detail
        return result


def fail(code, message, detail=None):
    raise SourceError(code, message, detail)


def portable(value, root=False):
    if root and value == ".":
        return value
    if not isinstance(value, str) or not value or value.startswith("/") or "\\" in value:
        fail("SOURCE_PATH", "Use an ordinary portable relative path.", {"path": value})
    if any(ord(c) < 32 or ord(c) == 127 or c == ":" for c in value):
        fail("SOURCE_PATH", "Source path contains a control or drive/stream separator.")
    for part in value.split("/"):
        if not part or part in (".", "..") or part.endswith((".", " ")) or _RESERVED.match(part):
            fail("SOURCE_PATH", "Source path has a non-portable component.", {"path": value})
    return value


def module_name(value, empty=False):
    if empty and value == "":
        return value
    if not isinstance(value, str) or not value or not all(p.isidentifier() for p in value.split(".")):
        fail("SOURCE_MODULE", "Use a complete dotted Python module name.", {"module": value})
    return value


def join_path(parent, name):
    return name if parent == "." else parent + "/" + name


def identity(raw):
    return {"bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest(),
            "git_blob_sha1": hashlib.sha1(b"blob " + str(len(raw)).encode("ascii") + b"\0" + raw).hexdigest()}


def row_for(name, raw, mode="100644"):
    try:
        content = raw.decode("utf-8")
        encoding = "utf-8"
    except UnicodeDecodeError:
        content, encoding = base64.b64encode(raw).decode("ascii"), "base64"
    return {"path": portable(name), "content": content, "encoding": encoding,
            "mode": mode, **identity(raw)}


def row_bytes(row):
    if not isinstance(row, dict) or not isinstance(row.get("content"), str):
        fail("SOURCE_MEMBER", "Every source member must carry its complete body.")
    portable(row.get("path"))
    if row.get("mode") not in ("100644", "100755"):
        fail("SOURCE_MODE", "Use an ordinary file mode.", {"path": row["path"]})
    try:
        if row.get("encoding", "utf-8") == "utf-8":
            raw = row["content"].encode("utf-8")
        elif row.get("encoding") == "base64":
            raw = base64.b64decode(row["content"], validate=True)
            if base64.b64encode(raw).decode("ascii") != row["content"]:
                fail("SOURCE_ENCODING", "Source Base64 must be canonical.")
        else:
            fail("SOURCE_ENCODING", "Use complete UTF-8 or Base64.")
    except (ValueError, UnicodeError) as error:
        fail("SOURCE_ENCODING", str(error), {"path": row["path"]})
    actual = identity(raw)
    for key, value in actual.items():
        if row.get(key) != value:
            fail("SOURCE_IDENTITY", "Complete source member identity differs.",
                 {"path": row["path"], "field": key})
    return raw


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n").encode("utf-8")


def read_regular(file, maximum):
    file = Path(file)
    before_path = file.lstat()
    if not stat.S_ISREG(before_path.st_mode):
        fail("SOURCE_FILE", "Select an ordinary non-symlink file.", {"file": str(file)})
    if before_path.st_size > maximum:
        fail("SOURCE_SIZE_LIMIT", "File exceeds the selected byte limit.", {"file": str(file)})
    fd = os.open(str(file), os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    try:
        before = os.fstat(fd)
        if (before.st_dev, before.st_ino) != (before_path.st_dev, before_path.st_ino) or not stat.S_ISREG(before.st_mode):
            fail("SOURCE_CHANGED", "Source changed while opening.", {"file": str(file)})
        with os.fdopen(fd, "rb", closefd=False) as handle:
            raw = handle.read(maximum + 1)
        after = os.fstat(fd)
        if len(raw) > maximum or len(raw) != before.st_size or (
                before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (
                after.st_size, after.st_mtime_ns, after.st_ctime_ns):
            fail("SOURCE_CHANGED", "Source changed while reading.", {"file": str(file)})
        return raw, "100755" if before.st_mode & 0o111 else "100644"
    finally:
        os.close(fd)


def safe_path(root, relative, allow_missing=False):
    portable(relative)
    current = Path(root)
    missing = False
    for index, piece in enumerate(relative.split("/")):
        current = current / piece
        if missing:
            continue
        try:
            st = current.lstat()
        except FileNotFoundError:
            if not allow_missing:
                raise
            missing = True
            continue
        if stat.S_ISLNK(st.st_mode) or (index < len(relative.split("/")) - 1 and not stat.S_ISDIR(st.st_mode)):
            fail("SOURCE_SYMLINK", "Source requires ordinary directories and files.", {"path": relative})
    return current


def selected_limits(value):
    if value is None:
        return dict(DEFAULTS)
    if not isinstance(value, dict) or set(value) - set(DEFAULTS):
        fail("SOURCE_LIMITS", "Use the documented source limits.")
    result = {**DEFAULTS, **value}
    for key, number in result.items():
        if type(number) is not int or number < 1 or number > DEFAULTS[key]:
            fail("SOURCE_LIMITS", "Limits must be positive and no larger than the standard ceiling.", {"key": key})
    return result


def selection(value):
    allowed = {"schema", "label", "entrypoints", "module_roots", "resources",
               "external_modules", "dynamic_imports", "limits"}
    if not isinstance(value, dict) or set(value) - allowed or value.get("schema") != SELECTION_SCHEMA:
        fail("SOURCE_SELECTION", "Use the complete supported Python source selection.")
    roots = value.get("module_roots")
    if not isinstance(roots, list) or not roots:
        fail("SOURCE_ROOTS", "Supply the original ordered import roots, including a script directory where appropriate.")
    for root in roots:
        portable(root, root=True)
    if len(set(roots)) != len(roots):
        fail("SOURCE_ROOTS", "Import roots must be unique.")
    entries = value.get("entrypoints")
    if not isinstance(entries, list) or not entries:
        fail("SOURCE_ENTRYPOINT", "Select at least one original script or module.")
    for entry in entries:
        if not isinstance(entry, dict):
            fail("SOURCE_ENTRYPOINT", "Select an explicit script path or module name.")
        if set(entry) == {"script"}:
            portable(entry["script"])
        elif set(entry) == {"module"}:
            module_name(entry["module"])
        else:
            fail("SOURCE_ENTRYPOINT", "Use exactly script or module per entrypoint.")
    resources = value.get("resources", [])
    if not isinstance(resources, list):
        fail("SOURCE_RESOURCES", "Resources must be a complete path list.")
    for name in resources:
        portable(name)
    externals = value.get("external_modules", [])
    if not isinstance(externals, list):
        fail("SOURCE_EXTERNAL", "external_modules must be an explicit module-name list.")
    for name in externals:
        module_name(name)
    dynamic = value.get("dynamic_imports", [])
    if not isinstance(dynamic, list):
        fail("SOURCE_DYNAMIC", "dynamic_imports must contain exact source-bound selections.")
    seen = set()
    for mapping in dynamic:
        required = {"source", "source_sha256", "line", "column", "expression", "modules", "resources"}
        if not isinstance(mapping, dict) or not required.issubset(mapping) or set(mapping) - required - {"files"}:
            fail("SOURCE_DYNAMIC", "A dynamic selection requires the complete source/expression identity and both selected lists.")
        portable(mapping["source"])
        if not isinstance(mapping["source_sha256"], str) or not _HEX.fullmatch(mapping["source_sha256"]):
            fail("SOURCE_DYNAMIC", "Bind a dynamic selection to the full original source SHA-256.")
        if type(mapping["line"]) is not int or mapping["line"] < 1 or type(mapping["column"]) is not int or mapping["column"] < 0:
            fail("SOURCE_DYNAMIC", "Use actual AST line and UTF-8 column positions.")
        if not isinstance(mapping["expression"], str) or not mapping["expression"]:
            fail("SOURCE_DYNAMIC", "Retain the whole original expression.")
        if not isinstance(mapping["modules"], list) or not isinstance(mapping["resources"], list):
            fail("SOURCE_DYNAMIC", "Selected modules and resources must be lists.")
        if not mapping["modules"] and not mapping["resources"] and not mapping.get("files"):
            fail("SOURCE_DYNAMIC", "A mapped dynamic call needs a complete explicit selection.")
        for name in mapping["modules"]:
            module_name(name)
        for name in mapping["resources"]:
            portable(name)
        if not isinstance(mapping.get("files", []), list):
            fail("SOURCE_DYNAMIC", "Explicit loaded files must be a complete context list.")
        for loaded in mapping.get("files", []):
            if not isinstance(loaded, dict) or set(loaded) != {"path", "module", "package"}:
                fail("SOURCE_DYNAMIC", "A custom file load needs its original path, module and package.")
            portable(loaded["path"])
            module_name(loaded["module"])
            module_name(loaded["package"], empty=True)
        key = (mapping["source"], mapping["line"], mapping["column"])
        if key in seen:
            fail("SOURCE_DYNAMIC", "Duplicate dynamic source position.")
        seen.add(key)
    selected_limits(value.get("limits"))
    # Keep the original selection byte-for-byte as JSON values; do not infer an environment.
    return value


class FilesystemSource:
    """Ordinary source lookup. Every positive and negative search observation is retained."""
    def __init__(self, root, limits):
        self.root = Path(root).resolve(strict=True)
        if not self.root.is_dir():
            fail("SOURCE_ROOT", "Select the complete existing source root.")
        self.limits = limits
        self.probes = {}
        self.reads = {}

    def _kind(self, name):
        if name == ".":
            return "directory"
        try:
            st = safe_path(self.root, name, allow_missing=True).lstat()
        except FileNotFoundError:
            return "missing"
        if stat.S_ISREG(st.st_mode):
            return "file"
        if stat.S_ISDIR(st.st_mode):
            return "directory"
        fail("SOURCE_FILE", "Selected source search encountered a special file.", {"path": name})

    def kind(self, name):
        portable(name, root=True)
        if name not in self.probes:
            if len(self.probes) >= self.limits["max_probes"]:
                fail("SOURCE_PROBE_LIMIT", "Source search exceeds its declared probe limit.")
            self.probes[name] = self._kind(name)
        return self.probes[name]

    def read(self, name):
        portable(name)
        if self.kind(name) != "file":
            fail("SOURCE_MISSING", "Selected original source file is missing.", {"path": name})
        if name not in self.reads:
            raw, mode = read_regular(safe_path(self.root, name), self.limits["max_file_bytes"])
            self.reads[name] = row_for(name, raw, mode)
        return self.reads[name]

    def unchanged(self):
        for name, kind in self.probes.items():
            if self._kind(name) != kind:
                fail("SOURCE_CHANGED", "Import search changed during collection.", {"path": name})
        for name, row in self.reads.items():
            raw, mode = read_regular(safe_path(self.root, name), self.limits["max_file_bytes"])
            if identity(raw) != {k: row[k] for k in ("bytes", "sha256", "git_blob_sha1")} or mode != row["mode"]:
                fail("SOURCE_CHANGED", "Selected source changed during collection.", {"path": name})


class PacketSource:
    """Reopen the original filesystem observations and full members without native imports."""
    def __init__(self, packet, limits):
        observations = packet.get("observations")
        if not isinstance(observations, list) or len(observations) > limits["max_probes"]:
            fail("SOURCE_OBSERVATIONS", "Retain the complete original source-search observations.")
        self.probes = {}
        aliases = {}
        for row in observations:
            if not isinstance(row, dict) or set(row) != {"path", "kind"}:
                fail("SOURCE_OBSERVATIONS", "An observation must contain path and kind.")
            name = portable(row["path"], root=True)
            if name in self.probes or row["kind"] not in ("file", "directory", "missing"):
                fail("SOURCE_OBSERVATIONS", "Duplicate or unknown original source observation.")
            self.probes[name] = row["kind"]
        self.files = {}
        total = 0
        for row in packet.get("files", []):
            raw = row_bytes(row)
            name = row["path"]
            alias = name.casefold()
            if name in self.files or (alias in aliases and aliases[alias] != name):
                fail("SOURCE_ALIAS", "Duplicate or case-aliased source member.", {"path": name})
            aliases[alias] = name
            total += len(raw)
            if len(raw) > limits["max_file_bytes"] or total > limits["max_source_bytes"]:
                fail("SOURCE_SIZE_LIMIT", "Original complete source exceeds the declared byte limit.")
            self.files[name] = row
        if len(self.files) > limits["max_files"]:
            fail("SOURCE_FILE_LIMIT", "Original source exceeds the member limit.")
        for name in self.files:
            parts = name.split("/")
            if any("/".join(parts[:i]) in self.files for i in range(1, len(parts))):
                fail("SOURCE_ALIAS", "A retained file is also used as a directory.", {"path": name})
            if self.probes.get(name) != "file":
                fail("SOURCE_OBSERVATIONS", "A retained member lacks its original file observation.", {"path": name})

    def kind(self, name):
        portable(name, root=True)
        if name not in self.probes:
            fail("SOURCE_OBSERVATIONS", "A required original source lookup is absent.", {"path": name})
        return self.probes[name]

    def read(self, name):
        if self.kind(name) != "file" or name not in self.files:
            fail("SOURCE_MEMBER_MISSING", "Complete selected source body is absent.", {"path": name})
        return self.files[name]


def absolute_name(name, package, level):
    if not level:
        return module_name(name)
    if not package:
        fail("SOURCE_RELATIVE_IMPORT", "A script has no package for this relative import.")
    parts = package.split(".")
    if level > len(parts):
        fail("SOURCE_RELATIVE_IMPORT", "Relative import goes beyond its top-level package.")
    parent = ".".join(parts[:len(parts) - level + 1])
    return parent + ("." + name if name else "")


class Collector:
    def __init__(self, source, spec, python_environment=None):
        self.source, self.spec = source, selection(spec)
        self.limits = selected_limits(spec.get("limits"))
        self.files, self.aliases, self.queue, self.visited = {}, {}, [], set()
        self.resolved, self.external, self.computed, self.errors = [], [], [], []
        self.references, self.module_cache = 0, {}
        self.namespace_directories = set()
        self.dynamic = {(r["source"], r["line"], r["column"]): r for r in spec.get("dynamic_imports", [])}
        self.used_dynamic = set()
        if python_environment is None:
            python_environment = {
                "implementation": sys.implementation.name, "version": list(sys.version_info[:3]),
                "builtin_modules": sorted(sys.builtin_module_names),
                "stdlib_modules": sorted(getattr(sys, "stdlib_module_names", ())),
                "frozen_modules": sorted(name for name in getattr(sys, "stdlib_module_names", ()) if _imp.is_frozen(name)),
            }
        if not isinstance(python_environment, dict) or not isinstance(python_environment.get("builtin_modules"), list) or not isinstance(python_environment.get("stdlib_modules"), list) or not isinstance(python_environment.get("frozen_modules"), list):
            fail("SOURCE_PYTHON", "Preserve the original parser/runtime module classification.")
        for name in python_environment["builtin_modules"] + python_environment["stdlib_modules"] + python_environment["frozen_modules"]:
            module_name(name)
        self.python = python_environment
        self.builtins = set(python_environment["builtin_modules"])
        self.stdlib = set(python_environment["stdlib_modules"])
        self.frozen = set(python_environment["frozen_modules"])

    def add(self, name, module=None, package=None):
        portable(name)
        if name not in self.files:
            row = self.source.read(name)
            if row.get("path") != name:
                fail("SOURCE_PATH_IDENTITY", "Source reader returned another selected path.", {"path": name})
            raw = row_bytes(row)
            alias = name.casefold()
            if alias in self.aliases and self.aliases[alias] != name:
                fail("SOURCE_ALIAS", "Source contains a case-aliased path.", {"path": name})
            self.aliases[alias] = name
            if len(self.files) >= self.limits["max_files"] or sum(r["bytes"] for r in self.files.values()) + len(raw) > self.limits["max_source_bytes"]:
                fail("SOURCE_SIZE_LIMIT", "Complete selected source exceeds its limit.")
            self.files[name] = row
        if module is not None:
            self.queue.append((name, module, package or ""))
        return self.files[name]

    def lookup(self, name):
        module_name(name)
        if name in self.module_cache:
            return self.module_cache[name]
        parts, locations, bodies = name.split("."), list(self.spec["module_roots"]), []
        # Native builtin and frozen finders precede filesystem lookup.
        if parts[0] in self.builtins or parts[0] in self.frozen:
            result = {"kind": "external", "basis": "builtin" if parts[0] in self.builtins else "frozen", "module": name}
            self.module_cache[name] = result
            return result
        for index, part in enumerate(parts):
            prefix = ".".join(parts[:index + 1])
            found, portions = None, []
            for root in locations:
                package_dir = join_path(root, part)
                init = package_dir + "/__init__.py"
                if self.source.kind(package_dir) == "directory":
                    if self.source.kind(init) == "file":
                        found = {"kind": "package", "path": init, "locations": [package_dir]}
                        break
                    portions.append(package_dir)
                module_file = join_path(root, part + ".py")
                if self.source.kind(module_file) == "file":
                    found = {"kind": "module", "path": module_file, "locations": []}
                    break
            if found is None and portions:
                found = {"kind": "namespace", "locations": portions}
            if found is None:
                if index == 0:
                    matched = next((item for item in self.spec.get("external_modules", [])
                                    if name == item or name.startswith(item + ".")), None)
                    if matched:
                        result = {"kind": "external", "basis": "declared", "module": name, "declaration": matched}
                    elif parts[0] in self.stdlib:
                        result = {"kind": "external", "basis": "stdlib", "module": name}
                    else:
                        result = {"kind": "missing", "module": name, "missing": prefix}
                else:
                    result = {"kind": "missing", "module": name, "missing": prefix, "parents": bodies}
                self.module_cache[name] = result
                return result
            if found["kind"] == "namespace":
                self.namespace_directories.update(found["locations"])
            if "path" in found:
                body = {"path": found["path"], "module": prefix,
                        "package": prefix if found["kind"] == "package" else prefix.rpartition(".")[0]}
                bodies.append(body)
            if index < len(parts) - 1 and found["kind"] == "module":
                result = {"kind": "missing", "module": name, "missing": ".".join(parts[:index + 2]), "parents": bodies,
                          "reason": "parent_is_module"}
                self.module_cache[name] = result
                return result
            locations = found["locations"]
        result = {"kind": found["kind"], "module": name, "bodies": bodies, "locations": locations}
        self.module_cache[name] = result
        return result

    def import_module(self, name, origin, optional_attribute=False):
        result = self.lookup(name)
        for body in result.get("bodies", result.get("parents", [])):
            self.add(body["path"], body["module"], body["package"])
        if result["kind"] == "missing":
            if not optional_attribute:
                self.errors.append({"code": "SOURCE_MODULE_MISSING", **origin, **result})
            return result
        if result["kind"] == "external":
            self.external.append({**origin, **result})
        else:
            self.resolved.append({**origin, "module": name, "kind": result["kind"],
                                  "paths": [b["path"] for b in result["bodies"]],
                                  "namespace_locations": result["locations"] if result["kind"] == "namespace" else []})
        return result

    def origin(self, node, name, text):
        self.references += 1
        if self.references > self.limits["max_references"]:
            fail("SOURCE_REFERENCE_LIMIT", "Source AST exceeds its declared reference limit.")
        return {"source": name, "line": node.lineno, "column": node.col_offset,
                "expression": ast.get_source_segment(text, node) or ast.unparse(node)}

    def dynamic_call(self, origin, reason):
        key = (origin["source"], origin["line"], origin["column"])
        mapping = self.dynamic.get(key)
        record = {**origin, "reason": reason, "mapped": False}
        if mapping is not None:
            if mapping["source_sha256"] != self.files[origin["source"]]["sha256"] or mapping["expression"] != origin["expression"]:
                fail("SOURCE_DYNAMIC_CHANGED", "The mapped import expression or original source edition changed.", origin)
            self.used_dynamic.add(key)
            record["mapped"] = True
            record["selection"] = mapping
            for module in mapping["modules"]:
                self.import_module(module, {**origin, "via": "explicit_dynamic_selection"})
            for resource in mapping["resources"]:
                self.add(resource)
            for loaded in mapping.get("files", []):
                self.add(loaded["path"], loaded["module"], loaded["package"])
        self.computed.append(record)

    def scan(self, name, module, package):
        raw = row_bytes(self.files[name])
        try:
            encoding, _ = tokenize.detect_encoding(io.BytesIO(raw).readline)
            text = raw.decode(encoding)
            tree = ast.parse(raw, filename=name)
        except (SyntaxError, UnicodeError, LookupError) as error:
            self.errors.append({"code": "SOURCE_PARSE", "source": name, "message": str(error),
                                "line": getattr(error, "lineno", None), "column": getattr(error, "offset", None)})
            return
        importlib_names = {"importlib"}
        builtin_names = {"builtins"}
        direct_imports = set()
        builtin_imports = {"__import__"}
        loader_names = {"SourceFileLoader", "SourcelessFileLoader"}
        plugin_names = {"entry_points", "iter_entry_points"}
        assignments = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for item in node.names:
                    if item.name == "importlib":
                        importlib_names.add(item.asname or "importlib")
                    elif item.name == "builtins":
                        builtin_names.add(item.asname or "builtins")
            elif isinstance(node, ast.ImportFrom):
                if node.module == "importlib" and node.level == 0:
                    direct_imports.update(item.asname or item.name for item in node.names if item.name == "import_module")
                if node.module in ("importlib.metadata", "pkg_resources") and node.level == 0:
                    plugin_names.update(item.asname or item.name for item in node.names if item.name in ("entry_points", "iter_entry_points"))
                if node.module == "builtins" and node.level == 0:
                    builtin_imports.update(item.asname or item.name for item in node.names if item.name == "__import__")
                if node.module == "importlib.util" and node.level == 0:
                    loader_names.update(item.asname or item.name for item in node.names if item.name == "spec_from_file_location")
                if node.module == "importlib.machinery" and node.level == 0:
                    loader_names.update(item.asname or item.name for item in node.names if item.name in ("SourceFileLoader", "SourcelessFileLoader"))
            elif isinstance(node, ast.Name) and isinstance(node.ctx, (ast.Store, ast.Del)):
                assignments.add(node.id)
            elif isinstance(node, ast.arg):
                assignments.add(node.arg)
        nodes = sorted((node for node in ast.walk(tree) if isinstance(node, (ast.Import, ast.ImportFrom, ast.Call))),
                       key=lambda node: (node.lineno, node.col_offset))
        for node in nodes:
            if isinstance(node, ast.Import):
                origin = self.origin(node, name, text)
                for item in node.names:
                    self.import_module(item.name, {**origin, "via": "import"})
            elif isinstance(node, ast.ImportFrom):
                origin = self.origin(node, name, text)
                try:
                    full = absolute_name(node.module or "", package, node.level)
                except SourceError as error:
                    self.errors.append({**error.record(), **origin})
                    continue
                base = self.import_module(full, {**origin, "via": "from"})
                # A from-list name can be an existing attribute. Include an actual
                # filesystem submodule when present, without inventing one for a value.
                if base["kind"] in ("package", "namespace"):
                    for item in node.names:
                        if item.name == "*":
                            self.dynamic_call(origin, "package_star_import")
                        else:
                            self.import_module(full + "." + item.name, {**origin, "via": "from_member"}, optional_attribute=True)
            else:
                func = node.func
                call_name = func.id if isinstance(func, ast.Name) else func.attr if isinstance(func, ast.Attribute) else ""
                builtin_call = (isinstance(func, ast.Name) and func.id in builtin_imports) or (
                    isinstance(func, ast.Attribute) and isinstance(func.value, ast.Name)
                    and func.value.id in builtin_names and func.attr == "__import__")
                import_call = builtin_call or (isinstance(func, ast.Name) and func.id in direct_imports) or (
                    isinstance(func, ast.Attribute) and isinstance(func.value, ast.Name)
                    and func.value.id in importlib_names and func.attr == "import_module")
                special = call_name in plugin_names | loader_names | {"spec_from_file_location"}
                if not import_call and not special:
                    continue
                origin = self.origin(node, name, text)
                if special:
                    self.dynamic_call(origin, "plugin_or_file_loader")
                    continue
                shadow = func.id if isinstance(func, ast.Name) else func.value.id
                if shadow in assignments:
                    self.dynamic_call(origin, "import_callable_rebound")
                    continue
                if any(isinstance(arg, ast.Starred) for arg in node.args) or any(k.arg is None for k in node.keywords):
                    self.dynamic_call(origin, "expanded_import_arguments")
                    continue
                if builtin_call:
                    # __import__ carries globals/fromlist/level semantics. Only the
                    # literal absolute one-argument form is inferred automatically.
                    if len(node.args) != 1 or node.keywords:
                        self.dynamic_call(origin, "builtin_import_arguments")
                        continue
                    target_node = node.args[0]
                    package_node = None
                else:
                    keywords = {k.arg: k.value for k in node.keywords}
                    if set(keywords) - {"name", "package"} or len(node.args) > 2 or (
                            node.args and "name" in keywords) or (len(node.args) > 1 and "package" in keywords):
                        self.dynamic_call(origin, "import_argument_binding")
                        continue
                    target_node = node.args[0] if node.args else keywords.get("name")
                    package_node = node.args[1] if len(node.args) > 1 else keywords.get("package")
                if not isinstance(target_node, ast.Constant) or not isinstance(target_node.value, str):
                    self.dynamic_call(origin, "computed_module_name")
                    continue
                target = target_node.value
                if target.startswith("."):
                    if isinstance(package_node, ast.Constant) and isinstance(package_node.value, str):
                        base_package = package_node.value
                    elif isinstance(package_node, ast.Name) and package_node.id == "__package__" and "__package__" not in assignments:
                        base_package = package
                    else:
                        self.dynamic_call(origin, "computed_import_package")
                        continue
                    level = len(target) - len(target.lstrip("."))
                    try:
                        target = absolute_name(target[level:], base_package, level)
                    except SourceError as error:
                        self.errors.append({**error.record(), **origin})
                        continue
                try:
                    module_name(target)
                except SourceError as error:
                    self.errors.append({**error.record(), **origin})
                    continue
                self.import_module(target, {**origin, "via": "literal_dynamic_import"})

    def run(self):
        for root in self.spec["module_roots"]:
            if self.source.kind(root) != "directory":
                fail("SOURCE_ROOTS", "A selected original import root is not a directory.", {"path": root})
        for name in self.spec.get("resources", []):
            self.add(name)
        for entry in self.spec["entrypoints"]:
            if "script" in entry:
                self.add(entry["script"], "__main__", "")
            else:
                self.import_module(entry["module"], {"source": None, "via": "entrypoint"})
        position = 0
        while position < len(self.queue):
            context = self.queue[position]
            position += 1
            if context in self.visited:
                continue
            self.visited.add(context)
            self.scan(*context)
        unused = set(self.dynamic) - self.used_dynamic
        if unused:
            fail("SOURCE_DYNAMIC_UNUSED", "A dynamic mapping does not match a selected computed import.",
                 {"positions": [list(key) for key in sorted(unused)]})
        unmapped = sum(not row["mapped"] for row in self.computed)
        directories = set(root for root in self.spec["module_roots"] if root != ".")
        directories.update(self.namespace_directories)
        for row in self.resolved:
            directories.update(row.get("namespace_locations", []))
        for name in list(self.files) + list(directories):
            parts = name.split("/")
            directories.update("/".join(parts[:i]) for i in range(1, len(parts)))
        if any(name in self.files for name in directories):
            fail("SOURCE_ALIAS", "A selected file is also used as a source directory.")
        directory_aliases = dict(self.aliases)
        for name in directories:
            alias = name.casefold()
            if alias in directory_aliases and directory_aliases[alias] != name:
                fail("SOURCE_ALIAS", "Selected directories have a case-aliased path.", {"path": name})
            directory_aliases[alias] = name
            if self.source.kind(name) != "directory":
                fail("SOURCE_DIRECTORY", "A selected source directory changed.", {"path": name})
        return {"schema": SCHEMA, "selection": self.spec, "python": self.python,
                "files": [self.files[name] for name in sorted(self.files)],
                "directories": sorted(directories),
                "observations": [{"path": name, "kind": kind} for name, kind in sorted(self.source.probes.items())],
                "contexts": [{"path": name, "module": module, "package": package}
                             for name, module, package in sorted(self.visited)],
                "resolved": self.resolved, "external": self.external,
                "computed": self.computed, "errors": self.errors,
                "coverage": {"complete": not self.errors and unmapped == 0,
                             "files": len(self.files), "source_bytes": sum(row["bytes"] for row in self.files.values()),
                             "python_contexts": len(self.visited), "references": self.references,
                             "unmapped_dynamic": unmapped, "limits": self.limits}}


def collect_source(root, spec):
    spec = selection(spec)
    source = FilesystemSource(root, selected_limits(spec.get("limits")))
    result = Collector(source, spec).run()
    source.unchanged()
    return result


def inspect_source(packet):
    if not isinstance(packet, dict) or packet.get("schema") != SCHEMA or not isinstance(packet.get("files"), list):
        fail("SOURCE_PACKET", "Use the complete original Python source packet.")
    spec = selection(packet.get("selection"))
    source = PacketSource(packet, selected_limits(spec.get("limits")))
    result = Collector(source, spec, packet.get("python")).run()
    # Original analysis is part of the received edition, not an editable assertion.
    for key in ("files", "directories", "observations", "contexts", "resolved", "external", "computed", "errors", "coverage"):
        if result[key] != packet.get(key):
            fail("SOURCE_ANALYSIS_CHANGED", "The retained source analysis does not match its original members/selection.",
                 {"field": key})
    return result


def read_packet(file):
    raw, _ = read_regular(file, MAX_PACKET)
    if raw[:2] == b"\x1f\x8b":
        if len(raw) > MAX_COMPRESSED:
            fail("SOURCE_SIZE_LIMIT", "Compressed source packet exceeds its limit.")
        with gzip.GzipFile(fileobj=io.BytesIO(raw)) as handle:
            raw = handle.read(MAX_PACKET + 1)
        if len(raw) > MAX_PACKET:
            fail("SOURCE_SIZE_LIMIT", "Expanded source packet exceeds its limit.")
    try:
        value = json.loads(raw.decode("utf-8"))
    except (ValueError, UnicodeError) as error:
        fail("SOURCE_JSON", "Retain the complete UTF-8 JSON packet.", {"message": str(error)})
    return value, raw


def publish(file, raw, temporary_directory=None):
    file = Path(file).absolute()
    if not file.parent.is_dir():
        fail("OUTPUT_PARENT", "Create the original output parent first.", {"path": str(file.parent)})

    def previous():
        existing, _ = read_regular(file, max(len(raw), 1))
        if existing != raw:
            fail("OUTPUT_EXISTS", "The original output has different bytes.", {"path": str(file)})
        return {"path": str(file), **identity(raw), "reused": True}

    try:
        file.lstat()
    except FileNotFoundError:
        pass
    else:
        return previous()
    fd, temporary = tempfile.mkstemp(prefix=".source-write-", suffix=".part", dir=temporary_directory or file.parent)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(raw)
            handle.flush()
            os.fsync(handle.fileno())
        try:
            os.link(temporary, file)
        except FileExistsError:
            return previous()
        return {"path": str(file), **identity(raw), "reused": False}
    finally:
        os.unlink(temporary)


def ordinary_directory(path):
    path = Path(path)
    try:
        path.mkdir(mode=0o700)
    except FileExistsError:
        pass
    if not stat.S_ISDIR(path.lstat().st_mode):
        fail("RECEIVING_ROOT", "The original receiving directory must be ordinary.", {"path": str(path)})


def receive_source(packet, original_raw, directory):
    if json.loads(original_raw.decode("utf-8")) != packet:
        fail("SOURCE_PACKET", "The original packet bytes do not describe this source.")
    result = inspect_source(packet)
    if not result["coverage"]["complete"]:
        fail("SOURCE_INCOMPLETE", "Resolve missing imports and dynamic selections before receiving.", summary(result))
    directory = Path(directory).absolute()
    parent = directory.parent.resolve(strict=True)
    directory = parent / directory.name
    operation = {"schema": MATERIALIZATION_SCHEMA, "source_schema": SCHEMA,
                 "source_sha256": hashlib.sha256(original_raw).hexdigest(), "source_bytes": len(original_raw),
                 "directories": result["directories"],
                 "files": [{k: row[k] for k in ("path", "bytes", "sha256", "git_blob_sha1", "mode")}
                           for row in result["files"]]}
    op_raw = json_bytes(operation)
    try:
        directory.mkdir(mode=0o700)
    except FileExistsError:
        if not stat.S_ISDIR(directory.lstat().st_mode):
            fail("RECEIVING_ROOT", "The original receiving root is not an ordinary directory.")
        try:
            saved, _ = read_regular(directory / "operation.json", MAX_PACKET)
        except FileNotFoundError:
            if any(directory.iterdir()):
                fail("RECEIVING_IDENTITY", "An unidentified receiving directory is not empty.")
        else:
            if saved != op_raw:
                fail("RECEIVING_IDENTITY", "The directory belongs to another source operation.")
    publish(directory / "operation.json", op_raw)
    publish(directory / "source-packet.json", original_raw)
    pending, target = directory / "pending", directory / "source"
    ordinary_directory(pending)
    ordinary_directory(target)
    allowed = {row["path"] for row in result["files"]}
    allowed_directories = set(result["directories"])
    stack = [(target, "")]
    while stack:
        absolute, prefix = stack.pop()
        for item in absolute.iterdir():
            relative = prefix + item.name
            st = item.lstat()
            if stat.S_ISDIR(st.st_mode):
                if relative not in allowed_directories:
                    fail("RECEIVING_EXTRA", "An unselected directory is present.", {"path": relative})
                stack.append((item, relative + "/"))
            elif not stat.S_ISREG(st.st_mode) or relative not in allowed:
                fail("RECEIVING_EXTRA", "An unselected or special source member is present.", {"path": relative})
    for name in sorted(allowed_directories, key=lambda item: (item.count("/"), item)):
        ordinary_directory(safe_path(target, name, allow_missing=True))
    for row in result["files"]:
        parts = row["path"].split("/")
        current = target
        for piece in parts[:-1]:
            current /= piece
            ordinary_directory(current)
        file = safe_path(target, row["path"], allow_missing=True)
        publish(file, row_bytes(row), pending)
        os.chmod(file, 0o700 if row["mode"] == "100755" else 0o600)
    for row in result["files"]:
        raw, mode = read_regular(safe_path(target, row["path"]), result["coverage"]["limits"]["max_file_bytes"])
        if identity(raw) != {k: row[k] for k in ("bytes", "sha256", "git_blob_sha1")} or mode != row["mode"]:
            fail("SOURCE_IDENTITY", "Received source differs.", {"path": row["path"]})
    complete = {**operation, "status": "COMPLETE", "source_directory": "source"}
    publish(directory / "complete.json", json_bytes(complete))
    return {**complete, "directory": str(directory), "source_directory": str(target)}


def summary(result):
    return {"schema": result["schema"], "status": "COMPLETE" if result["coverage"]["complete"] else "INCOMPLETE",
            "coverage": result["coverage"], "directories": result["directories"], "contexts": result["contexts"],
            "resolved": result["resolved"], "external": result["external"],
            "computed": result["computed"], "errors": result["errors"],
            "files": [{k: v for k, v in row.items() if k != "content"} for row in result["files"]]}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    collect = commands.add_parser("collect", help="Retain complete source and actual static import closure")
    collect.add_argument("--root", required=True)
    collect.add_argument("--spec", required=True)
    collect.add_argument("--output", required=True)
    collect.add_argument("--gzip", action="store_true")
    inspect = commands.add_parser("inspect", help="Reopen and reproduce the complete original source analysis")
    inspect.add_argument("--input", required=True)
    receive = commands.add_parser("receive", help="Materialize or resume this exact original source packet")
    receive.add_argument("--input", required=True)
    receive.add_argument("--directory", required=True)
    args = parser.parse_args(argv)
    try:
        if args.command == "collect":
            spec, _ = read_packet(args.spec)
            result = collect_source(args.root, spec)
            raw = json_bytes(result)
            if len(raw) > MAX_PACKET:
                fail("SOURCE_SIZE_LIMIT", "Complete source packet exceeds its byte limit.")
            output = gzip.compress(raw, compresslevel=9, mtime=0) if args.gzip else raw
            receipt = publish(args.output, output)
            response = {**summary(result), "output": receipt, "uncompressed": identity(raw)}
        else:
            packet, raw = read_packet(args.input)
            if args.command == "inspect":
                response = {**summary(inspect_source(packet)), "original": identity(raw)}
            else:
                response = receive_source(packet, raw, args.directory)
        print(json.dumps(response, ensure_ascii=False, indent=2))
        return 2 if response["status"] == "INCOMPLETE" else 0
    except (SourceError, OSError, ValueError, EOFError) as error:
        record = error.record() if isinstance(error, SourceError) else {
            "code": type(error).__name__, "message": str(error)}
        print(json.dumps({"status": "ERROR", **record}, ensure_ascii=False, indent=2), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
