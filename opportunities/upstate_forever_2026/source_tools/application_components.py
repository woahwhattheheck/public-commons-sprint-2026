"""Static source closure for an explicitly selected application edition."""
from __future__ import annotations

import ast
import base64
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path, PurePosixPath
import posixpath
import re
import sys
from urllib.parse import unquote, urlsplit

CATALOG_PATH = "integration/application_components.json"
MODULE_PATH = "source_tools/application_components.py"
CATALOG_SCHEMA = "upstate.application-components/v1"
REPORT_SCHEMA = "upstate.application-component-closure/v1"
EXTENSION_SCHEMA = "upstate.operator-extension/v1"
_EXCLUDED = {".git", ".venv", "venv", "node_modules", "__pycache__"}


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False,
                      separators=(",", ":"), allow_nan=False).encode("utf-8")


def digest(value):
    return hashlib.sha256(value).hexdigest()


def relative(value):
    if (not isinstance(value, str) or not value or "\\" in value
            or any(ord(char) < 32 for char in value)):
        raise ValueError("Component paths must be nonempty relative POSIX names")
    path = PurePosixPath(value)
    if (path.is_absolute() or path.as_posix() != value
            or any(part in {".", ".."} or ":" in part for part in path.parts)):
        raise ValueError("Component path leaves the application: " + value)
    return value


def strings(value, label, *, nonempty=False):
    if (not isinstance(value, list) or (nonempty and not value)
            or any(not isinstance(item, str) or not item for item in value)
            or len(value) != len(set(value))):
        raise ValueError(label + " must contain unique nonempty strings")
    return value


def validate_catalog(catalog):
    if not isinstance(catalog, dict) or catalog.get("schema") != CATALOG_SCHEMA:
        raise ValueError("Select an explicit application component catalogue")
    if not isinstance(catalog.get("edition"), str) or not catalog["edition"].strip():
        raise ValueError("The component catalogue needs its edition name")
    components = catalog.get("components")
    if not isinstance(components, dict) or not components:
        raise ValueError("The edition needs its component definitions")
    required = strings(catalog.get("required_components"), "Required components", nonempty=True)
    for name, component in components.items():
        if (not isinstance(name, str) or not re.fullmatch(r"[a-z][a-z0-9._-]*", name)
                or not isinstance(component, dict)):
            raise ValueError("Invalid component identity: " + str(name))
        for path in strings(component.get("paths"), name + " source paths", nonempty=True):
            relative(path)
        for root in strings(component.get("import_roots", []), name + " Python roots"):
            relative(root)
        for dependency in strings(component.get("requires", []), name + " dependencies"):
            if dependency not in components:
                raise ValueError(name + " requires an undefined component: " + dependency)
    if any(name not in components for name in required):
        raise ValueError("The edition selects an undefined component")
    return catalog


def _selected(catalog, extra):
    selected, active = set(), set()

    def visit(name):
        if name not in catalog["components"]:
            raise ValueError("Unknown selected component: " + name)
        if name in active:
            raise ValueError("Component dependency cycle includes " + name)
        if name in selected:
            return
        active.add(name)
        for dependency in catalog["components"][name].get("requires", []):
            visit(dependency)
        active.remove(name)
        selected.add(name)

    for name in [*catalog["required_components"], *strings(list(extra), "Extra components")]:
        visit(name)
    return sorted(selected)


def _text(files, metadata, path):
    content = files[path]
    if not isinstance(content, str):
        raise ValueError("Source declaration is not text: " + path)
    encoding = metadata.get(path, {}).get("encoding", "utf-8")
    if encoding == "base64":
        return base64.b64decode(content, validate=True).decode("utf-8")
    if encoding not in {"utf-8", "utf8"}:
        raise ValueError("Unsupported original source encoding: " + path)
    return content


def _module_candidates(name, roots=("", "operator")):
    if not isinstance(name, str) or not re.fullmatch(r"[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*", name):
        raise ValueError("Backend module must name installed Python source")
    base = name.replace(".", "/")
    return [prefix + base + suffix for root in roots
            for prefix in (root + "/" if root else "",)
            for suffix in (".py", "/__init__.py")]


def _asset(value):
    if not isinstance(value, str):
        raise ValueError("Extension asset must be a relative web path")
    value = value.removeprefix("/web/")
    relative(value)
    path = PurePosixPath(value)
    if (any(not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]*", part) for part in path.parts)
            or path.suffix not in {".mjs", ".css", ".html"}):
        raise ValueError("Extension asset differs from the installed registry contract")
    return "operator/web/" + value


class _WebReferences(HTMLParser):
    def __init__(self):
        super().__init__()
        self.references = []

    def handle_starttag(self, tag, attrs):
        for name, value in attrs:
            if value and ((tag in {"script", "img", "source", "iframe", "audio", "video"} and name == "src")
                          or (tag == "link" and name == "href")
                          or (tag == "object" and name == "data")):
                self.references.append(value)


def local_resource(owner, value):
    """Resolve one authored local resource identically in maps and directories."""
    url = urlsplit(value)
    if url.scheme or url.netloc or not url.path:
        return None
    value = unquote(url.path)
    if value.startswith("/web/"):
        target = "operator/web/" + value[len("/web/"):]
    elif value.startswith("/"):
        return None
    else:
        target = posixpath.normpath(posixpath.join(posixpath.dirname(owner), value))
    return relative(target)


def inspect(document, *, catalog=None, extra_components=(), allow_embedded=True):
    """Return original member identities and exact gaps without executing source."""
    files = document.get("files")
    metadata = document.get("file_metadata", {})
    if not isinstance(files, dict) or not isinstance(metadata, dict):
        raise ValueError("Choose the original application source map")
    if catalog is None:
        if CATALOG_PATH not in files:
            raise ValueError("The application has no selected-edition catalogue: " + CATALOG_PATH)
        catalog = json.loads(_text(files, metadata, CATALOG_PATH))
    catalog = validate_catalog(catalog)
    selected = _selected(catalog, extra_components)
    files, metadata = dict(files), dict(metadata)
    embedded = {}
    bank_path = "integration/source_binary_inputs.json"
    if allow_embedded and bank_path in files:
        bank = json.loads(_text(files, metadata, bank_path))
        if not isinstance(bank, dict) or bank.get("schema") != "commons.embedded-source-inputs/v1":
            raise ValueError("Choose the original embedded source input bank")
        records = bank.get("files")
        if not isinstance(records, list) or len(records) > 10000:
            raise ValueError("Embedded source input inventory exceeds its receiving limit")
        total, seen = 0, set()
        for item in records:
            name = relative(item["path"])
            if name in seen or name == bank_path:
                raise ValueError("Embedded source input repeats a member: " + name)
            seen.add(name)
            body = base64.b64decode(item["content_base64"], validate=True)
            total += len(body)
            if total > 256 * 1024 * 1024:
                raise ValueError("Embedded source inputs exceed their receiving limit")
            expected = {"bytes": len(body), "sha256": digest(body)}
            if any(item.get(key) != expected[key] for key in expected):
                raise ValueError("Embedded original source identity differs: " + name)
            if name in files:
                current = (base64.b64decode(files[name], validate=True)
                           if metadata.get(name, {}).get("encoding") == "base64"
                           else files[name].encode("utf-8"))
                if current != body:
                    raise ValueError("Embedded source conflicts with retained member: " + name)
                continue
            try:
                files[name] = body.decode("utf-8")
                metadata[name] = expected
            except UnicodeError:
                files[name] = base64.b64encode(body).decode("ascii")
                metadata[name] = {**expected, "encoding": "base64"}
            embedded[name] = bank_path
    required, issues, descriptors, edges = set(), [], [], []
    roots = ["", "operator"]
    for name in selected:
        roots.extend(root for root in catalog["components"][name].get("import_roots", [])
                     if root not in roots)
    module_names = set()
    for path in files:
        relative(path)
        if path.endswith(".py"):
            name = path[:-3].replace("/", ".").removesuffix(".__init__")
            module_names.add(name)
            for root in roots:
                prefix = root.replace("/", ".") + "." if root else ""
                if prefix and name.startswith(prefix):
                    module_names.add(name[len(prefix):])
    declared_paths = {path for component in catalog["components"].values()
                      for path in component["paths"]}
    local_roots = {"model", "source_tools", "measurement_workspace"}
    local_roots.update(path[:-3] for path in declared_paths
                       if "/" not in path and path.endswith(".py"))
    local_roots.update(name.split(".", 1)[0] for name in module_names)

    # A folder named operator does not shadow Python's standard-library module.
    # Only an actual module file or package initializer can do so.
    for name in set(local_roots) & (set(getattr(sys, "stdlib_module_names", ())) | {"operator"}):
        if not any(candidate in files for candidate in _module_candidates(name, roots)):
            local_roots.discard(name)

    def issue(kind, path, target, reason, **details):
        issues.append({"kind": kind, "path": path, "target": target,
                       "reason": reason, **details})

    def require(path, owner, kind):
        relative(path)
        required.add(path)
        edges.append({"path": owner, "target": path, "kind": kind})
        if path not in files:
            issue(kind, owner, path, "Required original source member is absent")

    def require_module(name, owner, kind, *, namespace=False):
        candidates = _module_candidates(name, roots)
        found = [candidate for candidate in candidates if candidate in files]
        if found:
            for candidate in found:
                require(candidate, owner, kind)
            return
        targets = [(root + "/" if root else "") + name.replace(".", "/") + "/" for root in roots]
        if namespace and any(path.startswith(target) for path in files for target in targets):
            return
        issue(kind, owner, name, "Installed Python module is absent", candidates=candidates)

    exports_cache = {}

    def namespace_exports(module, function):
        """Read literal exports from an original globals-namespace installer."""
        result = set()
        for candidate in _module_candidates(module, roots):
            if candidate not in files:
                continue
            try:
                tree = ast.parse(_text(files, metadata, candidate), filename=candidate)
            except (SyntaxError, ValueError):
                continue
            declaration = next((item for item in tree.body
                                if isinstance(item, ast.FunctionDef)
                                and item.name == function), None)
            if declaration is None:
                continue
            arguments = declaration.args
            positional = [*arguments.posonlyargs, *arguments.args]
            if (len(positional) != 1 or arguments.vararg or arguments.kwarg
                    or arguments.kwonlyargs):
                continue
            namespace = positional[0].arg

            def statements(items):
                for item in items:
                    if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                        continue
                    if isinstance(item, ast.Expr) and isinstance(item.value, ast.Call):
                        call = item.value
                        if (isinstance(call.func, ast.Attribute)
                                and isinstance(call.func.value, ast.Name)
                                and call.func.value.id == namespace
                                and call.func.attr == "update"
                                and len(call.args) == 1 and not call.keywords
                                and isinstance(call.args[0], ast.Dict)):
                            result.update(key.value for key in call.args[0].keys
                                          if isinstance(key, ast.Constant)
                                          and isinstance(key.value, str)
                                          and key.value.isidentifier())
                    for child in ast.iter_child_nodes(item):
                        if isinstance(child, ast.stmt):
                            statements([child])
                        elif isinstance(child, ast.ExceptHandler):
                            statements(child.body)
            statements(declaration.body)
        return result

    def module_exports(name, visiting=()):
        if name in exports_cache:
            return exports_cache[name]
        if name in visiting:
            return set()
        exported = set()
        for candidate in _module_candidates(name, roots):
            if candidate not in files:
                continue
            try:
                tree = ast.parse(_text(files, metadata, candidate), filename=candidate)
            except (SyntaxError, ValueError):
                continue

            installers = {}

            def names(target):
                if isinstance(target, ast.Name):
                    return {target.id}
                if isinstance(target, (ast.Tuple, ast.List)):
                    return set().union(*(names(item) for item in target.elts))
                return set()

            def statements(items):
                for item in items:
                    if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                        exported.add(item.name)
                        continue
                    if isinstance(item, ast.Import):
                        exported.update(alias.asname or alias.name.split(".")[0] for alias in item.names)
                    elif isinstance(item, ast.ImportFrom):
                        exported.update(alias.asname or alias.name for alias in item.names if alias.name != "*")
                        if item.module:
                            package = list(PurePosixPath(candidate).parent.parts)
                            if item.level and item.level <= len(package):
                                target = ".".join([*package[:len(package) - item.level + 1],
                                                   item.module])
                            elif not item.level:
                                target = item.module
                            else:
                                target = None
                            if target:
                                installers.update({alias.asname or alias.name: (target, alias.name)
                                                   for alias in item.names if alias.name != "*"})
                                if any(alias.name == "*" for alias in item.names):
                                    exported.update(module_exports(target, (*visiting, name)))
                    elif isinstance(item, (ast.Assign, ast.AnnAssign)):
                        targets = item.targets if isinstance(item, ast.Assign) else [item.target]
                        for target in targets:
                            exported.update(names(target))
                    elif isinstance(item, (ast.For, ast.AsyncFor)):
                        exported.update(names(item.target))
                    elif isinstance(item, ast.Expr) and isinstance(item.value, ast.Call):
                        call = item.value
                        if (isinstance(call.func, ast.Name) and call.func.id in installers
                                and len(call.args) == 1 and not call.keywords
                                and isinstance(call.args[0], ast.Call)
                                and isinstance(call.args[0].func, ast.Name)
                                and call.args[0].func.id == "globals"
                                and not call.args[0].args and not call.args[0].keywords
                                and "globals" not in exported):
                            exported.update(namespace_exports(*installers[call.func.id]))
                    # Conditional imports and declarations still belong to the
                    # module; function and class locals were excluded above.
                    for child in ast.iter_child_nodes(item):
                        if isinstance(child, ast.stmt):
                            statements([child])
                        elif isinstance(child, ast.ExceptHandler):
                            statements(child.body)
            statements(tree.body)
        exports_cache[name] = exported
        return exported

    def require_from(name, aliases, owner, line):
        require_module(name, owner, "python-import", namespace=True)
        exports = module_exports(name)
        module_files = [candidate for candidate in _module_candidates(name, roots) if candidate in files]
        is_package = (any(candidate.endswith("/__init__.py") for candidate in module_files)
                      or not module_files)
        for alias in aliases:
            if alias.name == "*" or alias.name in exports:
                continue
            if is_package:
                require_module(name + "." + alias.name, owner, "python-import", namespace=True)
            elif module_files:
                issue("python-import", owner, name + "." + alias.name,
                      "Imported name is absent from the retained module", line=line)

    for name in selected:
        for path in catalog["components"][name]["paths"]:
            require(path, "component:" + name, "component")

    ids = {}
    for path in sorted(files):
        if not (path.startswith("operator/extensions/") and path.endswith(".json")
                and "/" not in path[len("operator/extensions/"):]):
            continue
        required.add(path)
        try:
            manifest = json.loads(_text(files, metadata, path))
            if not isinstance(manifest, dict) or manifest.get("schema") != EXTENSION_SCHEMA:
                raise ValueError("Unsupported installed extension schema")
            extension_id = manifest.get("id")
            if not isinstance(extension_id, str) or not re.fullmatch(r"[a-z][a-z0-9-]*", extension_id):
                raise ValueError("Extension needs its original lowercase identity")
            if extension_id in ids:
                raise ValueError("Duplicate extension identity also declared by " + ids[extension_id])
            ids[extension_id] = path
            assets = {_asset(value) for value in strings(manifest.get("assets", []), "Extension assets")}
            for asset in sorted(assets):
                require(asset, path, "extension-asset")
            backend = manifest.get("backend") or {}
            if not isinstance(backend, dict):
                raise ValueError("Extension backend must be an object")
            if backend.get("module"):
                require_module(backend["module"], path, "extension-backend")
            bindings = [backend.get(name) for name in
                        ("factory", "invoke", "state", "decorate_task", "verify_workspace")]
            for name in ("routes", "file_routes", "items"):
                values = backend.get(name, [])
                if not isinstance(values, list):
                    raise ValueError("Extension " + name + " must be a list")
                bindings.extend(values)
            for binding in bindings:
                if binding is None:
                    continue
                if not isinstance(binding, dict):
                    raise ValueError("Extension binding must be an object")
                if binding.get("module"):
                    require_module(binding["module"], path, "extension-binding")
            client = manifest.get("client") or {}
            if not isinstance(client, dict):
                raise ValueError("Extension browser declaration must be an object")
            if client:
                entry = _asset(client.get("module"))
                if entry not in assets or not entry.endswith(".mjs"):
                    raise ValueError("Browser entry must be an explicitly declared .mjs asset")
                require(entry, path, "extension-client")
                for style in strings(client.get("styles", []), "Extension styles"):
                    target = _asset(style)
                    if target not in assets:
                        raise ValueError("Browser stylesheet is absent from declared assets")
                    require(target, path, "extension-style")
            descriptors.append({"id": extension_id, "path": path, "assets": sorted(assets)})
        except (ValueError, TypeError, KeyError) as error:
            issue("extension-descriptor", path, path, str(error))

    js_pattern = re.compile(
        r"""(?:\b(?:import|export)\s+(?:[^;\n]*?\s+from\s*)?|\bimport\s*\(\s*)["'](\.[^"']+)["']""")
    for path in sorted(files):
        if not path.endswith((".py", ".js", ".mjs", ".html")):
            continue
        try:
            content = _text(files, metadata, path)
        except ValueError as error:
            issue("source-encoding", path, path, str(error))
            continue
        if path.endswith(".py"):
            try:
                tree = ast.parse(content, filename=path)
            except SyntaxError as error:
                issue("python-syntax", path, path, error.msg, line=error.lineno)
                continue
            package = list(PurePosixPath(path).parent.parts)
            for node in ast.walk(tree):
                if isinstance(node, ast.Import):
                    for alias in node.names:
                        if alias.name.split(".", 1)[0] in local_roots:
                            require_module(alias.name, path, "python-import", namespace=True)
                elif isinstance(node, ast.ImportFrom):
                    if node.level:
                        if node.level > len(package):
                            issue("python-import", path, node.module,
                                  "Relative import leaves the application", line=node.lineno)
                            continue
                        prefix = package[:len(package) - node.level + 1]
                        name = ".".join([*prefix, *([node.module] if node.module else [])])
                        require_from(name, node.names, path, node.lineno)
                    elif node.module and node.module.split(".", 1)[0] in local_roots:
                        require_from(node.module, node.names, path, node.lineno)
        elif path.endswith((".js", ".mjs")):
            for match in js_pattern.finditer(content):
                value = match[1].split("?", 1)[0].split("#", 1)[0]
                target = posixpath.normpath(posixpath.join(posixpath.dirname(path), value))
                try:
                    require(target, path, "javascript-import")
                except ValueError as error:
                    issue("javascript-import", path, value, str(error))
        elif path.endswith(".html"):
            parser = _WebReferences()
            parser.feed(content)
            for value in parser.references:
                try:
                    target = local_resource(path, value)
                    if target is not None:
                        require(target, path, "html-asset")
                except ValueError as error:
                    issue("html-asset", path, value, str(error))

    retained_embedded = {name: container for name, container in embedded.items() if name in required}
    for container in set(retained_embedded.values()):
        required.add(container)
    identities = {}
    for path in sorted(required & files.keys()):
        record = metadata.get(path)
        if isinstance(record, dict) and record.get("encoding") == "base64":
            body = base64.b64decode(files[path], validate=True)
        else:
            body = files[path].encode("utf-8")
        identities[path] = {"bytes": len(body), "sha256": digest(body)}
        if isinstance(record, dict) and any(record.get(key) != identities[path][key]
                                           for key in ("bytes", "sha256")):
            issue("source-identity", path, path, "Member metadata differs from original source bytes")
    distinct = {canonical(item): item for item in issues}
    missing = [distinct[key] for key in sorted(distinct)]
    return {
        "schema": REPORT_SCHEMA, "edition": catalog["edition"],
        "catalog_sha256": digest(canonical(catalog)),
        "selected_components": selected, "ready": not missing,
        "components": [{"id": name, "title": catalog["components"][name].get("title", name),
                        "paths": catalog["components"][name]["paths"],
                        "requires": catalog["components"][name].get("requires", []),
                        "source_reference": catalog["components"][name].get("source_reference")}
                       for name in selected],
        "extensions": descriptors, "members": identities,
        "embedded_members": retained_embedded,
        "dependencies": sorted(edges, key=lambda row: (row["path"], row["kind"], row["target"])),
        "issues": missing,
    }


def require_complete(document, **kwargs):
    report = inspect(document, **kwargs)
    if not report["ready"]:
        missing = "; ".join(row["path"] + " -> " + str(row["target"])
                            + ": " + row["reason"] for row in report["issues"][:20])
        error = ValueError("Selected application edition is incomplete: " + missing)
        error.component_closure = report
        raise error
    return report


def inspect_directory(root, *, required=False, allow_embedded=False):
    """Read original files; do not import backends or run scientific models."""
    root = Path(root).resolve(strict=True)
    files, metadata = {}, {}
    catalog_file = root / CATALOG_PATH
    if not catalog_file.is_file():
        raise ValueError("Receive the original selected-edition catalogue: " + CATALOG_PATH)
    catalog = validate_catalog(json.loads(catalog_file.read_text("utf-8")))
    declared = {path for component in catalog["components"].values() for path in component["paths"]}
    for path in sorted(root.rglob("*")):
        relative_path = path.relative_to(root)
        if any(part in _EXCLUDED or part.startswith(".") for part in relative_path.parts):
            continue
        if path.is_symlink():
            raise ValueError("Component source contains an alias: " + str(relative_path))
        if not path.is_file():
            continue
        name = relative_path.as_posix()
        if name not in declared and not name.endswith((".py", ".js", ".mjs", ".html", ".json", ".css")):
            continue
        body = path.read_bytes()
        record = {"bytes": len(body), "sha256": digest(body)}
        try:
            files[name] = body.decode("utf-8")
        except UnicodeError:
            files[name] = base64.b64encode(body).decode("ascii")
            record["encoding"] = "base64"
        metadata[name] = record
    # Load only resources actually referenced by retained HTML. This keeps a
    # figure present on disk from appearing absent in the source-map inspection,
    # without reading unrelated original geospatial payloads.
    pending = [name for name in files if name.endswith(".html")]
    scanned = set()
    while pending:
        name = pending.pop()
        if name in scanned:
            continue
        scanned.add(name)
        parser = _WebReferences()
        parser.feed(_text(files, metadata, name))
        for value in parser.references:
            target = local_resource(name, value)
            if target is None or target in files:
                continue
            path = root.joinpath(*PurePosixPath(target).parts)
            if not path.is_file():
                continue
            if path.is_symlink() or any(parent.is_symlink()
                                       for parent in path.parents if parent != root.parent):
                raise ValueError("Original resource contains an alias: " + target)
            if path.stat().st_size > 256 * 1024 * 1024:
                raise ValueError("Referenced application resource exceeds the receiving limit: " + target)
            with path.open("rb") as stream:
                body = stream.read(256 * 1024 * 1024 + 1)
            if len(body) > 256 * 1024 * 1024:
                raise ValueError("Referenced application resource exceeds the receiving limit: " + target)
            record = {"bytes": len(body), "sha256": digest(body)}
            try:
                files[target] = body.decode("utf-8")
            except UnicodeError:
                files[target] = base64.b64encode(body).decode("ascii")
                record["encoding"] = "base64"
            metadata[target] = record
            if target.endswith(".html"):
                pending.append(target)
    document = {"files": files, "file_metadata": metadata}
    return (require_complete(document, allow_embedded=allow_embedded) if required
            else inspect(document, allow_embedded=allow_embedded))
