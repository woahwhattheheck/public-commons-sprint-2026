"""Package the complete maintained municipal operator source with the original checker."""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import tempfile
import zipfile

from .engine import Workspace


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    contents = {}
    for parent in ("workspace", "acceptance"):
        for path in sorted((root / parent).rglob("*")):
            if "__pycache__" in path.parts or path.suffix == ".pyc":
                continue
            if path.is_symlink():
                raise ValueError("Package original regular application files: " + str(path))
            if path.is_file() and path.suffix.lower() in {".py", ".js", ".css", ".html", ".md", ".json", ".csv", ".jsonl", ".txt"}:
                relative = path.relative_to(root).as_posix()
                if parent == "workspace" and path.parent not in (root / "workspace", root / "workspace" / "ui", root / "workspace" / "development"):
                    continue
                if parent == "acceptance" and path.parent != root / "acceptance":
                    continue
                contents[relative] = path.read_bytes()
    required = ("workspace/__main__.py", "workspace/engine.py", "workspace/adapters.py",
                "workspace/maximo_target.py", "workspace/maximo_load.py", "workspace/maximo_cli.py",
                "workspace/captures.py", "workspace/geometry_capture.py", "workspace/capture_intake.py", "workspace/public_refresh.py", "workspace/report.py",
                "workspace/server.py", "workspace/ui/app.js", "workspace/ui/index.html",
                "workspace/ui/app.css", "acceptance/verify.py", "workspace/BELLEVILLE.md")
    for name in required:
        if name not in contents:
            raise ValueError("Complete application source is missing: " + name)
    contents["START_HERE.md"] = contents["workspace/BELLEVILLE.md"]
    manifest = {"schema": "municipal-asset-application.v1", "files": [
        {"path": name, "bytes": len(body), "sha256": hashlib.sha256(body).hexdigest()}
        for name, body in sorted(contents.items())]}
    contents["PACKAGE.json"] = (json.dumps(manifest, indent=2) + "\n").encode()
    packet = Workspace._zip(contents)
    with zipfile.ZipFile(io.BytesIO(packet)) as archive:
        for item in manifest["files"]:
            body = archive.read(item["path"])
            if len(body) != item["bytes"] or hashlib.sha256(body).hexdigest() != item["sha256"]:
                raise ValueError("Package member differs from selected source")
    destination = args.output.resolve()
    destination.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=".municipal-package-", dir=destination.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            os.chmod(temporary, 0o600)
            stream.write(packet)
            stream.flush()
            os.fsync(stream.fileno())
        try:
            os.link(temporary, destination)
        except FileExistsError:
            if destination.read_bytes() != packet:
                raise ValueError("Preserve the existing application package; choose a distinct output")
    finally:
        Path(temporary).unlink(missing_ok=True)
    print(json.dumps({"path": str(destination), "bytes": len(packet), "sha256": hashlib.sha256(packet).hexdigest(),
                      "source_files": len(manifest["files"])}, indent=2))


if __name__ == "__main__":
    main()
