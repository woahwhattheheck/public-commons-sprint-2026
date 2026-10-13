"""Invoke an original application entry with its selected received native Python.

This process becomes that entry. The original operator owns its queue, native
children, workspaces and run recovery. The invocation retains no credential or
argument log and does not start another scheduler.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sys

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from source_tools.native_runtime import capsule, probe

# Arguments are passed as argv, never interpolated into executable Python.
BOOTSTRAP = r'''
import json, pathlib, runpy, sys
application, entry, inspect_only = sys.argv[1:4]
arguments = sys.argv[4:]
sys.path.insert(0, application)
from model.native import runtime
modules, native = runtime()
if inspect_only == "1":
    print(json.dumps({"schema": "upstate.native-invocation/v1", "state": "ready",
        "python": sys.executable, "prefix": sys.prefix,
        "application": application, "entry": str(pathlib.Path(entry).relative_to(application)),
        "native": native}, ensure_ascii=False, sort_keys=True, allow_nan=False))
else:
    sys.argv = [entry, *arguments]
    runpy.run_path(entry, run_name="__main__")
'''


def prepare(python: str | Path, application: str | Path, entry: str,
            arguments: list[str] | None = None, *, inspect_only: bool = False) -> dict:
    """Resolve a received interpreter without dereferencing a venv executable.

    The application supplies its own source selection. The selected interpreter
    checks its actual official native modules immediately before entering the
    original application. Only GIS data belonging to that interpreter is adopted.
    """
    executable = capsule.resolve_python(python)
    root = Path(application).expanduser().resolve(strict=True)
    if not root.is_dir():
        raise ValueError("Select the complete original application directory")
    selected = probe.selected_source(root)
    relative = Path(entry)
    if relative.is_absolute() or ".." in relative.parts:
        raise ValueError("Select a Python entry relative to the original application")
    target = (root / relative).resolve(strict=True)
    if not target.is_relative_to(root) or not target.is_file() or target.suffix != ".py":
        raise ValueError("The original Python entry must remain inside its application")
    args = list(arguments or [])
    if any(not isinstance(value, str) or "\0" in value for value in args):
        raise ValueError("Original entry arguments must be strings without null bytes")
    actual = capsule.python_identity(executable)
    prefix = Path(actual["prefix"]).resolve(strict=True)
    env = capsule.environment(prefix=prefix)
    # Avoid choosing a different installation's PROJ database after relocation.
    if (prefix / "share" / "proj" / "proj.db").is_file():
        env["PROJ_DATA"] = str(prefix / "share" / "proj")
    if (prefix / "share" / "gdal").is_dir():
        env["GDAL_DATA"] = str(prefix / "share" / "gdal")
    command = [str(executable), "-B", "-c", BOOTSTRAP, str(root), str(target),
               "1" if inspect_only else "0", *args]
    return {"command": command, "environment": env, "application": str(root),
            "entry": str(target), "python": str(executable), "selection": selected}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--python", required=True, help="The received native Python executable")
    parser.add_argument("--application", type=Path, required=True)
    parser.add_argument("--entry", default="operator/server.py",
                        help="Original application-relative Python entry")
    parser.add_argument("--inspect", action="store_true",
                        help="Load the actual pinned native runtime without executing the entry")
    parser.add_argument("arguments", nargs=argparse.REMAINDER,
                        help="Original arguments after --, passed unchanged")
    args = parser.parse_args(argv)
    forwarded = args.arguments[1:] if args.arguments[:1] == ["--"] else args.arguments
    try:
        request = prepare(args.python, args.application, args.entry, forwarded,
                          inspect_only=args.inspect)
        # Keep the operator's original process identity and ordinary signal rules.
        os.execve(request["python"], request["command"], request["environment"])
    except (OSError, ValueError, RuntimeError, KeyError) as error:
        print(json.dumps({"state": "failed", "error": {
            "type": type(error).__name__, "message": str(error)}}, ensure_ascii=False),
            file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
