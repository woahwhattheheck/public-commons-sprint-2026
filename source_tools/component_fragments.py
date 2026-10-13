"""Deterministic additive component declarations for retained application source.

The global catalogue remains the selected-edition baseline. Fragments contribute
new component definitions and explicit append-only array extensions. This module
never replaces existing component metadata or executes received application code.
"""
from __future__ import annotations

from copy import deepcopy
import hashlib
import json
from pathlib import Path, PurePosixPath
import re

FRAGMENT_DIRECTORY = "integration/component_fragments"
FRAGMENT_PREFIX = FRAGMENT_DIRECTORY + "/"
FRAGMENT_SCHEMA = "upstate.application-component-fragment/v1"
_ID = re.compile(r"[a-z][a-z0-9._-]*")
_ARRAYS = {"paths", "requires", "import_roots", "source_manifests"}
_FIELDS = {"schema", "id", "components", "extend_components",
           "required_components", "source_reference"}


def _relative(value):
    if (not isinstance(value, str) or not value or "\\" in value
            or any(ord(char) < 32 for char in value)):
        raise ValueError("Fragment paths must be nonempty relative POSIX names")
    path = PurePosixPath(value)
    if (path.is_absolute() or path.as_posix() != value
            or any(part in {".", ".."} or ":" in part for part in path.parts)):
        raise ValueError("Fragment path leaves the application: " + value)
    return value


def _identity(value, label):
    if not isinstance(value, str) or not _ID.fullmatch(value):
        raise ValueError(label + " must be a lowercase component identity")
    return value


def _strings(value, label, *, paths=False, identities=False):
    if (not isinstance(value, list)
            or any(not isinstance(item, str) or not item for item in value)
            or len(value) != len(set(value))):
        raise ValueError(label + " must contain unique nonempty strings")
    for item in value:
        if paths:
            _relative(item)
        if identities:
            _identity(item, label)
    return value


def fragment_paths(files):
    """Return canonical direct JSON members; reject nested fragment declarations."""
    selected = []
    for name in files:
        if not isinstance(name, str):
            raise ValueError("Fragment source maps require string member paths")
        if not name.startswith(FRAGMENT_PREFIX) or not name.endswith(".json"):
            continue
        _relative(name)
        tail = name[len(FRAGMENT_PREFIX):]
        if "/" in tail:
            raise ValueError("Component fragments must be direct directory members: " + name)
        _identity(tail[:-5], "Fragment filename")
        selected.append(name)
    return sorted(selected)


def _object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Fragment JSON repeats object key: " + key)
        result[key] = value
    return result


def _nonfinite(value):
    raise ValueError("Fragment JSON contains a nonfinite number: " + value)


def _load(path, content):
    if fragment_paths([path]) != [path]:
        raise ValueError("Choose a canonical component fragment path: " + str(path))
    if not isinstance(content, str):
        raise ValueError("Component fragment must retain its complete UTF-8 source: " + path)
    value = json.loads(content, object_pairs_hook=_object, parse_constant=_nonfinite)
    if not isinstance(value, dict) or value.get("schema") != FRAGMENT_SCHEMA:
        raise ValueError("Unsupported component fragment schema: " + path)
    if set(value) - _FIELDS:
        raise ValueError("Unknown component fragment fields: " + path)
    key = _identity(value.get("id"), "Fragment")
    if path != FRAGMENT_PREFIX + key + ".json":
        raise ValueError("Fragment identity differs from its source filename: " + path)
    components, extensions = value.get("components", {}), value.get("extend_components", {})
    if not isinstance(components, dict) or not isinstance(extensions, dict):
        raise ValueError("Fragment components and extensions must be objects: " + path)
    if not components and not extensions:
        raise ValueError("A component fragment must declare definitions or extensions: " + path)
    if set(components) & set(extensions):
        raise ValueError("A fragment cannot define and extend the same component: " + path)
    for name, component in components.items():
        _identity(name, "Component")
        if not isinstance(component, dict):
            raise ValueError("A complete component definition must be an object: " + name)
        for field in _ARRAYS:
            if field in component:
                _strings(component[field], name + " " + field,
                         paths=field != "requires", identities=field == "requires")
        if not component.get("paths"):
            raise ValueError("A complete component needs its original source paths: " + name)
    for name, extension in extensions.items():
        _identity(name, "Extended component")
        if (not isinstance(extension, dict) or not extension
                or set(extension) - _ARRAYS):
            raise ValueError("Component extensions may only append paths, requires, import_roots or source_manifests: " + name)
        for field, values in extension.items():
            _strings(values, name + " " + field,
                     paths=field != "requires", identities=field == "requires")
    _strings(value.get("required_components", []), "Fragment required components", identities=True)
    body = content.encode("utf-8")
    record = {"id": key, "path": path, "bytes": len(body),
              "sha256": hashlib.sha256(body).hexdigest()}
    if "source_reference" in value:
        record["source_reference"] = deepcopy(value["source_reference"])
    return value, record


def _dependencies(catalog):
    components = catalog["components"]
    for name, component in components.items():
        _identity(name, "Component")
        if not isinstance(component, dict):
            raise ValueError("Component definition must be an object: " + name)
        for dependency in _strings(component.get("requires", []),
                                   name + " dependencies", identities=True):
            if dependency not in components:
                raise ValueError(name + " requires an undefined component: " + dependency)
    for name in _strings(catalog.get("required_components"), "Required components", identities=True):
        if name not in components:
            raise ValueError("The edition selects an undefined component: " + name)
    active, complete = set(), set()

    def visit(name):
        if name in active:
            raise ValueError("Component dependency cycle includes " + name)
        if name in complete:
            return
        active.add(name)
        for dependency in components[name].get("requires", []):
            visit(dependency)
        active.remove(name)
        complete.add(name)

    for name in sorted(components):
        visit(name)


def compose_catalog(base, fragment_sources):
    """Return (effective catalogue, exact fragment records) without mutating base.

    Callers retain explicit-catalogue overrides by choosing not to invoke this
    function. With no fragments the exact original object is returned unchanged.
    """
    sources = list(fragment_sources)
    if not sources:
        return base, []
    if (not isinstance(base, dict) or not isinstance(base.get("components"), dict)
            or not isinstance(base.get("required_components"), list)):
        raise ValueError("Component fragments require the original catalogue baseline")
    if "component_fragments" in base:
        raise ValueError("Compose fragments from the original baseline, not an already composed catalogue")
    parsed, seen_paths, seen_ids = [], set(), set()
    for item in sources:
        if not isinstance(item, (tuple, list)) or len(item) != 2:
            raise ValueError("Each component fragment needs its path and complete source text")
        path, text = item
        value, record = _load(path, text)
        if path in seen_paths or value["id"] in seen_ids:
            raise ValueError("Duplicate component fragment identity: " + value["id"])
        seen_paths.add(path)
        seen_ids.add(value["id"])
        parsed.append((path, value, record))
    parsed.sort(key=lambda row: row[0])
    catalog = deepcopy(base)
    components = catalog["components"]
    owners = {name: "base catalogue" for name in components}
    # Collect every complete definition before resolving cross-fragment additions.
    for path, value, _ in parsed:
        for name, component in value.get("components", {}).items():
            if name in components:
                raise ValueError("Component " + name + " is already defined by " + owners[name]
                                 + "; use an append-only extension: " + path)
            components[name] = deepcopy(component)
            owners[name] = path
    for path, value, _ in parsed:
        for name, extension in value.get("extend_components", {}).items():
            if name not in components:
                raise ValueError("Fragment extends an undefined component: " + name)
            component = components[name]
            for field, additions in extension.items():
                original = _strings(component.get(field, []), name + " " + field,
                                    paths=field != "requires", identities=field == "requires")
                component[field] = [*original, *(item for item in additions if item not in original)]
        for name in value.get("required_components", []):
            if name not in catalog["required_components"]:
                catalog["required_components"].append(name)
    _dependencies(catalog)
    records = [record for _, _, record in parsed]
    catalog["component_fragments"] = deepcopy(records)
    return catalog, records


def read_directory_fragments(root):
    """Read the same direct fragment members before native binary collection."""
    root = Path(root).resolve(strict=True)
    directory = root / FRAGMENT_DIRECTORY
    if not directory.exists():
        if directory.is_symlink():
            raise ValueError("Component fragment directory is an alias")
        return []
    for path in (directory, *directory.parents):
        if path == root:
            break
        if path.is_symlink():
            raise ValueError("Component fragment directory contains an alias")
    if not directory.is_dir() or not directory.resolve(strict=True).is_relative_to(root):
        raise ValueError("Component fragment directory leaves the application")
    candidates = [path.relative_to(root).as_posix() for path in directory.rglob("*.json")]
    sources = []
    for name in fragment_paths(candidates):
        path = root.joinpath(*PurePosixPath(name).parts)
        if path.is_symlink() or not path.resolve(strict=True).is_relative_to(root):
            raise ValueError("Component fragment leaves the application: " + name)
        for parent in path.parents:
            if parent == root:
                break
            if parent.is_symlink():
                raise ValueError("Component fragment contains an alias: " + name)
        if not path.is_file():
            raise ValueError("Component fragment is not a regular file: " + name)
        sources.append((name, path.read_bytes().decode("utf-8")))
    return sources
