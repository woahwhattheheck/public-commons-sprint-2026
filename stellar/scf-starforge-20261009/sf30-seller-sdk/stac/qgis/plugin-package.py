#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Build the complete installable plugin from its maintained original source."""
import argparse
import ast
import hashlib
import json
import os
from pathlib import Path
import stat
import tempfile
import zipfile


def build(out, source=None):
    root = Path(source or __file__).resolve().parent
    plugin = root / "starforge_stac"
    names = ["__init__.py", "model.py", "qgis_project.py", "plugin.py", "cli.py", "metadata.txt"]
    files = {}
    for name in names:
        path = plugin / name
        if not path.is_file() or path.is_symlink():
            raise ValueError("Missing original plugin file: " + name)
        body = path.read_bytes()
        if name.endswith(".py"):
            ast.parse(body, filename=str(path))
        files["starforge_stac/" + name] = body
    for name in ("OPERATIONS.md", "LICENSE"):
        path = root / name
        if not path.is_file():
            path = plugin / name
        if not path.is_file() or path.is_symlink():
            raise ValueError("Missing complete receiving guide: " + name)
        files["starforge_stac/" + name] = path.read_bytes()
    manifest = {"schema": "starforge.stac-qgis-plugin-package.v1",
                "files": [{"path": name, "bytes": len(body), "sha256": hashlib.sha256(body).hexdigest()}
                          for name, body in sorted(files.items())]}
    files["starforge_stac/package-manifest.json"] = (json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode()
    out = Path(out).expanduser().absolute()
    out.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=".qgis-plugin-", suffix=".zip", dir=out.parent)
    os.close(fd)
    try:
        with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
            for name, body in sorted(files.items()):
                info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
                info.external_attr = (stat.S_IFREG | 0o644) << 16
                info.compress_type = zipfile.ZIP_DEFLATED
                archive.writestr(info, body)
        measured = Path(temporary).read_bytes()
        sha256 = hashlib.sha256(measured).hexdigest()
        if out.exists():
            if hashlib.sha256(out.read_bytes()).hexdigest() != sha256:
                raise ValueError("The output already contains a different plugin. Choose a new filename.")
        else:
            os.link(temporary, out)
        return {"path": str(out), "bytes": len(measured), "sha256": sha256,
                "files": manifest["files"], "members": len(files)}
    finally:
        Path(temporary).unlink(missing_ok=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    print(json.dumps(build(args.out), ensure_ascii=False, indent=2))
