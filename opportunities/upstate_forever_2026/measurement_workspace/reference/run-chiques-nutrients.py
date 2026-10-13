#!/usr/bin/env python3
"""One original Chiques source receiving continuation; retain the same directory."""
import fcntl
import os
from pathlib import Path
import subprocess
import sys

def durable_directory(path):
    try:
        path.mkdir(mode=0o700)
    except FileNotFoundError:
        durable_directory(path.parent)
        durable_directory(path)
        return
    except FileExistsError:
        pass
    if path.is_symlink() or not path.is_dir():
        raise ValueError("Retain an ordinary original operation directory: " + str(path))
    for selected in (path, path.parent):
        descriptor = os.open(selected, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)

arguments = sys.argv[1:]
if "--operation" not in arguments:
    raise SystemExit("Select the original --operation directory")
operation = Path(arguments[arguments.index("--operation") + 1]).expanduser().resolve()
durable_directory(operation)
with (operation / "receiving.lock").open("a+b") as guard:
    fcntl.flock(guard, fcntl.LOCK_EX | fcntl.LOCK_NB)
    os.set_inheritable(guard.fileno(), True)
    command = [os.environ.get("MEASUREMENTS_NODE", "node"), "--experimental-sqlite",
               str(Path(__file__).with_suffix(".mjs")),
               *arguments, "--guard-fd", str(guard.fileno())]
    # The inherited descriptor keeps the same lease if the caller loses transport.
    result = subprocess.run(command, pass_fds=(guard.fileno(),))
    raise SystemExit(result.returncode)
