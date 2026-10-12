# SPDX-License-Identifier: MIT
"""Compose the original vector and QGIS packages without replacing their providers."""
from __future__ import annotations
import hashlib
import importlib.util
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
STAC = HERE.parent

def _package(name, root):
    root = root.resolve()
    current = sys.modules.get(name)
    if current is not None:
        if Path(current.__file__).resolve() != root / "__init__.py":
            raise RuntimeError("The selected native package changed inside this process.")
        return current
    spec = importlib.util.spec_from_file_location(name, root / "__init__.py",
        submodule_search_locations=[str(root)])
    if spec is None or spec.loader is None:
        raise RuntimeError("The complete original native package is required: " + str(root))
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    try:
        spec.loader.exec_module(module)
    except BaseException:
        for key in list(sys.modules):
            if key == name or key.startswith(name + "."):
                del sys.modules[key]
        raise
    return module

vector = _package("_starforge_migration_vector", STAC / "vector")
qgis = _package("starforge_stac", STAC / "qgis" / "starforge_stac")
from _starforge_migration_vector import common as files
from _starforge_migration_vector import materialize as mapping
from _starforge_migration_vector.capture import selection_contract
from starforge_stac import model
from starforge_stac import qgis_project
from starforge_stac.vector_source import VectorReceivingSource

def program_files():
    """Freeze each declared program file once for hashing and complete archive custody."""
    manifest_path = HERE / "source-files.json"
    files.need(manifest_path.is_file() and not manifest_path.is_symlink(),
               "MIGRATION_PROGRAM_MANIFEST_REQUIRED", str(manifest_path))
    manifest_raw = manifest_path.read_bytes()
    manifest = json.loads(manifest_raw)
    paths = manifest.get("files")
    files.need(manifest.get("schema") == "starforge.gis-migration-program.v1" and
               isinstance(paths, list) and all(isinstance(name, str) for name in paths) and
               len(paths) == len(set(paths)) and "migration/source-files.json" not in paths,
               "MIGRATION_PROGRAM_MANIFEST_INVALID")
    result = [("migration/source-files.json", manifest_raw)]
    for name in sorted(paths):
        path = files.member(STAC, name)
        files.need(name.startswith(("vector/", "qgis/", "postgis/", "migration/")) and
                   path.is_file() and not path.is_symlink(), "MIGRATION_NATIVE_SOURCE_MISSING", name)
        result.append((name, path.read_bytes()))
    return result

def source_closure():
    return {"schema": "starforge.gis-migration-native-source.v1", "files": [
        {"path": name, "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}
        for name, raw in program_files()
    ]}

class MigrationError(ValueError):
    def __init__(self, code, detail=None):
        self.code, self.detail = code, detail
        super().__init__(code + (": " + str(detail) if detail is not None else ""))

def need(ok, code, detail=None):
    if not ok:
        raise MigrationError(code, detail)
