#!/usr/bin/env python3
"""Install the delivered document wheels into a new offline customer runtime."""
import argparse
import hashlib
import json
import subprocess
import sys
import venv
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--wheelhouse", required=True, type=Path)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--destination", required=True, type=Path)
    args = parser.parse_args()
    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    if manifest.get("schema") != "atssc.document-runtime.v1":
        parser.error("The wheel manifest is not the delivered document runtime")
    if sys.version_info[:2] != (3, 12) or sys.platform != "linux":
        parser.error("The delivered offline wheels require Linux with Python 3.12. For another platform, install requirements-documents.txt with that platform's Python.")
    wheelhouse = args.wheelhouse.resolve(strict=True)
    entries = manifest.get("wheels", [])
    if len(entries) != 6 or len({x["path"] for x in entries}) != 6:
        parser.error("The full document runtime has six distinct wheels")
    for entry in entries:
        if Path(entry["path"]).name != entry["path"]:
            parser.error("A runtime wheel path is not a filename")
        path = wheelhouse / entry["path"]
        if path.is_symlink() or not path.is_file():
            parser.error("A delivered runtime wheel is missing")
        data = path.read_bytes()
        if len(data) != entry["bytes"] or hashlib.sha256(data).hexdigest() != entry["sha256"]:
            parser.error("A delivered runtime wheel differs from its complete inventory")
    destination = args.destination.resolve()
    if destination.exists():
        parser.error("Choose a new runtime directory")
    requirements = Path(__file__).resolve().with_name("requirements-documents-lock.txt")
    if not requirements.is_file():
        parser.error("The application is missing its pinned document requirements")
    venv.EnvBuilder(with_pip=True).create(destination)
    python = destination / "bin" / "python"
    subprocess.run([str(python), "-m", "pip", "install", "--no-index", "--find-links", str(wheelhouse), "--require-hashes", "-r", str(requirements)], check=True)
    subprocess.run([str(python), "-c", "import docx, reportlab, lxml, PIL, charset_normalizer, typing_extensions"], check=True)
    print(json.dumps({"python":str(python), "wheel_count":len(entries), "wheel_bytes":sum(x["bytes"] for x in entries), "offline_install":"complete"}))


if __name__ == "__main__":
    main()
