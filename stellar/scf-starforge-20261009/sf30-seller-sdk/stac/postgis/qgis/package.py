# SPDX-License-Identifier: MIT
"""Complete original adapter source retained with the existing plugin/package."""
from pathlib import Path

FILES = ("__init__.py","source.py","native.py","operator.py","cli.py","package.py",
         "OPERATIONS.md","connection.schema.json")

def software_files():
    root=Path(__file__).resolve().parent
    files={}
    for name in FILES:
        path=root/name
        if not path.is_file() or path.is_symlink():
            raise ValueError("The complete PostGIS QGIS adapter is missing: "+name)
        files[name]=path.read_bytes()
    return files
