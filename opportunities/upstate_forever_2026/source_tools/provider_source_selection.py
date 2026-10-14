#!/usr/bin/env python3
"""Build source selection from one original materialized ecsa provider snapshot.

Reads retained manifest and files only. Does not import the provider or run science.
Use the resulting selection with the maintained Python source collector against
the same snapshot root. Ordinary application source remains a separate closure.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import stat
import tempfile


def relative(value):
    if not isinstance(value, str) or not value or "\\" in value:
        raise ValueError("Use a retained portable snapshot path")
    p = PurePosixPath(value)
    if p.is_absolute() or any(part in ("", ".", "..") or ":" in part for part in value.split("/")):
        raise ValueError("Snapshot member escapes its original root")
    return p


def read_member(root, name):
    current = root
    for part in relative(name).parts:
        current = current / part
        if current.is_symlink():
            raise ValueError("Retain ordinary original snapshot files, not symlinks")
    before = current.stat()
    if not stat.S_ISREG(before.st_mode):
        raise ValueError("Snapshot member must be an ordinary file")
    with current.open("rb") as handle:
        opened = os.fstat(handle.fileno())
        raw = handle.read()
        after = os.fstat(handle.fileno())
    fields = lambda row: (row.st_dev, row.st_ino, row.st_size, row.st_mtime_ns, row.st_ctime_ns)
    if fields(before) != fields(opened) or fields(opened) != fields(after) or len(raw) != after.st_size:
        raise ValueError("Original snapshot changed while being read")
    return raw


def provider_selection(root, manifest_path, external_modules=()):
    root = Path(root).resolve(strict=True)
    manifest_path = relative(manifest_path).as_posix()
    manifest_raw = read_member(root, manifest_path)
    manifest = json.loads(manifest_raw.decode("utf-8"))
    if not isinstance(manifest, dict) or manifest.get("format") != "ecsa-provider-v1":
        raise ValueError("Select the actual retained ecsa-provider-v1 manifest")
    code_dir = relative(manifest["code_dir"])
    entry = relative(manifest["entry"])
    data_dir = relative(manifest["data_dir"])
    try:
        provider = entry.relative_to(code_dir)
    except ValueError:
        raise ValueError("Original provider entry must be inside its declared code tree")
    if provider.suffix != ".py":
        raise ValueError("Original loader's provider entry must be Python source")
    parts = list(provider.with_suffix("").parts)
    if parts[-1] == "__init__":
        parts.pop()
    if not parts or any(not part.isidentifier() for part in parts):
        raise ValueError("Retain the original provider's valid dotted module name")
    rows = manifest.get("files")
    if not isinstance(rows, list) or not rows:
        raise ValueError("The original provider manifest must retain all captured members")
    names, aliases = set(), set()
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError("Every captured member needs its complete original identity")
        name = relative(row["path"]).as_posix()
        alias = name.casefold()
        if name in names or alias in aliases:
            raise ValueError("Duplicate or case-aliased original captured member")
        names.add(name)
        aliases.add(alias)
        raw = read_member(root, name)
        if type(row.get("bytes")) is not int or len(raw) != row["bytes"] or hashlib.sha256(raw).hexdigest() != row.get("sha256"):
            raise ValueError("Original provider member differs: " + name)
    if entry.as_posix() not in names:
        raise ValueError("Original provider entry is absent from the captured manifest")
    # This is the original worker's own sys.path insertion, scoped solely to this
    # selected provider collection. Never add it to the application-wide roots.
    return {
        "schema": "commons.python-source-selection/v1",
        "label": "Original captured provider " + hashlib.sha256(manifest_raw).hexdigest(),
        "entrypoints": [{"module": ".".join(parts)}],
        "module_roots": [code_dir.as_posix()],
        "resources": sorted(names | {manifest_path}),
        "external_modules": list(external_modules),
        "dynamic_imports": [],
        "context_analysis": "package-context-v1",
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", required=True)
    parser.add_argument("--manifest", required=True, help="Actual retained manifest path relative to snapshot root")
    parser.add_argument("--external-module", action="append", default=[])
    parser.add_argument("--output", required=True)
    args = parser.parse_args(argv)
    value = provider_selection(args.root, args.manifest, args.external_module)
    raw = (json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n").encode("utf-8")
    output = Path(args.output)
    if output.exists():
        if output.is_symlink() or output.read_bytes() != raw:
            raise ValueError("Keep the existing different source selection unchanged")
    else:
        fd, temporary = tempfile.mkstemp(prefix=".provider-selection-", dir=output.parent)
        try:
            with os.fdopen(fd, "wb") as handle:
                handle.write(raw)
                handle.flush()
                os.fsync(handle.fileno())
            try:
                os.link(temporary, output)
            except FileExistsError:
                if output.is_symlink() or output.read_bytes() != raw:
                    raise ValueError("Existing source selection differs")
        finally:
            os.unlink(temporary)
    print(json.dumps({"status": "SELECTED", "path": str(output), "bytes": len(raw),
                      "sha256": hashlib.sha256(raw).hexdigest(), "selection": value}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
