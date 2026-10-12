#!/usr/bin/env python3
"""Launch the exact selected original controller and Library adapter."""
import base64
import hashlib
import json
from pathlib import Path
import sys

def git(body):
    return hashlib.sha1(b"blob " + str(len(body)).encode() + b"\0" + body).hexdigest()

def bind(body, expected):
    if len(body) != expected["bytes"] or hashlib.sha256(body).hexdigest() != expected["sha256"]:
        raise RuntimeError("The selected complete program differs from the executing bytes")
    if "blob" in expected and git(body) != expected["blob"]:
        raise RuntimeError("The selected original Git blob differs")

selection_file = Path(sys.argv[1]).resolve(strict=True)
selection = json.loads(selection_file.read_text())
folder = Path(__file__).resolve().parent
controller = (folder / "cloud-recovery-run.py").read_bytes()
child = (folder / "library-child.py").read_bytes()
bind(controller, selection["controller"])
bind(child, selection["library_child"])
sys.argv = [str(folder / "cloud-recovery-run.py"), json.dumps(selection), base64.b64encode(child).decode()]
exec(compile(controller, str(folder / "cloud-recovery-run.py"), "exec"),
     {"__name__": "__main__", "__file__": str(folder / "cloud-recovery-run.py"),
      "EXECUTED_SOURCE_BYTES": controller})
