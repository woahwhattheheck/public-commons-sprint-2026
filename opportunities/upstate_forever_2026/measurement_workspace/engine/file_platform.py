"""Use the application's original directory durability implementation."""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import stat
import sys
import types

SCHEMA = "upstate.measurements-directory-boundary/v1"

def sync_directory(directory):
    selected = Path(directory).absolute()
    info = selected.lstat()
    if not stat.S_ISDIR(info.st_mode) or selected.is_symlink():
        raise ValueError("Use an original real directory: " + str(selected))
    if os.name == "nt":
        # This is the SAME installed full application and original Win32 owner.
        # No independent locking, durability shim or runtime selection is created.
        source = Path(__file__).resolve().parents[2] / "model" / "windows_fs.py"
        source_info = source.lstat()
        if not stat.S_ISREG(source_info.st_mode) or source.is_symlink():
            raise ValueError("Use the original installed Windows platform source")
        body = source.read_bytes()
        # Admit only the exact original platform or its operated long-path successor.
        admitted = {
            (6320, "5f968b8c7248a8dae36f4a13b1c9edb3c85bca14abc1b1dd5a81c3b4022aae36"),
            (6862, "7bf6bf9095f4bc1823099d79b8bdad835f2808d8d407b0d165c6771d77422880"),
        }
        if (len(body), hashlib.sha256(body).hexdigest()) not in admitted:
            raise ValueError("The installed Windows platform source differs from the admitted edition")
        module = types.ModuleType("_measurements_original_windows_fs")
        module.__file__ = str(source)
        module.__package__ = ""
        exec(compile(body, str(source), "exec"), module.__dict__)
        module.sync_directory(selected)
        boundary = "directory-handle-validation"
    else:
        fd = os.open(selected, os.O_RDONLY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
        boundary = "directory-fsync"
    return {"schema": SCHEMA, "operation": "directory", "platform": sys.platform,
            "path": str(selected), "boundary": boundary}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=["directory"])
    parser.add_argument("path")
    args = parser.parse_args()
    print(json.dumps(sync_directory(args.path), ensure_ascii=False, separators=(",", ":")))

if __name__ == "__main__":
    main()
