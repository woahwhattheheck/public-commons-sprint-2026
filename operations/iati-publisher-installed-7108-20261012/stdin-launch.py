#!/usr/bin/env python3
"""Start the original IATI foreground with its exact gzip arriving on stdin."""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path

def launch_from_bytes(source, configuration):
    selected = json.loads(configuration)
    expected = selected["launcher"]
    if len(source) != expected["bytes"] or hashlib.sha256(source).hexdigest() != expected["sha256"]:
        raise ValueError("Select the exact original foreground source")
    project = Path(selected["project"])
    target = Path(expected["path"])
    input_path = Path(selected["inputPath"])
    if (str(project) != "/dev/7108-iati-publisher-native" or target != project / "foreground.py"
            or input_path != project / "foreground-input.json"):
        raise ValueError("Keep the selected original foreground inside its one private project")
    scope = {"__name__": "selected_iati_foreground", "__file__": str(target)}
    exec(compile(source, str(target), "exec"), scope)
    scope["directory"](project)
    with scope["lease"](Path(selected["intake"]["retainedShared"]["lock"])):
        scope["publish_bytes"](target, source)
        scope["publish_bytes"](input_path, configuration)
    print(json.dumps({"phase": "PRIVATE_FOREGROUND_READY", "operationId": selected["operationId"],
                      "source": scope["file_identity"](target), "input": scope["file_identity"](input_path),
                      "sourceSyntax": "PASS"}), flush=True)
    python = selected["paths"]["pythonExecutable"]
    os.execv(python, [python, "-B", str(target), "--intake-stdin", str(input_path)])

def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-directory", required=True)
    args = parser.parse_args()
    root = Path(args.source_directory).resolve(strict=True)
    launch_from_bytes((root / "foreground.py").read_bytes(), (root / "stdin-input.json").read_bytes())

if __name__ == "__main__":
    main()
