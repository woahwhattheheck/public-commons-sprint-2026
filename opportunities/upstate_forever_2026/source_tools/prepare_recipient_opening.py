#!/usr/bin/env python3
"""Add the maintained one-action opener to a complete received project."""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import stat
import tempfile

APPLICATION = Path(__file__).resolve().parents[1]
REQUIRED = (
    "operator/server.py",
    "source_tools/open_received_study.py",
    "source_tools/workbench_session.py",
    "source_tools/native_runtime/invocation.py",
    "operator/web/startup_guide.mjs",
    "operator/web/startup_guide.css",
    "source_tools/open_windows_browser.py",
)

def prepare(project_directory, *, include_wsl=False):
    project = Path(project_directory).expanduser().resolve(strict=True)
    app = project / "application"
    workspace = project / "workspace"
    if not project.is_dir() or app.is_symlink() or workspace.is_symlink():
        raise ValueError("Select the complete received project with ordinary application and workspace directories")
    if app.resolve(strict=True) != APPLICATION:
        raise ValueError("Run the preparer from this received project's own application")
    for relative in REQUIRED:
        member = app / relative
        if member.is_symlink() or not member.is_file():
            raise ValueError("Receive the complete maintained application member: " + relative)
    identity_file = workspace / "workspace.json"
    if identity_file.is_symlink() or not identity_file.is_file():
        raise ValueError("The original workspace/workspace.json must be a regular file")
    identity = json.loads(identity_file.read_text(encoding="utf-8"))
    if (identity.get("schema") != "upstate.scientific-workbench/v1"
            or not isinstance(identity.get("id"), str) or not identity["id"]):
        raise ValueError("Select the original scientific Workspace")
    outputs = []
    templates = [("Open_Workbench.sh", 0o755)]
    if include_wsl:
        templates.append(("Open_Workbench_WSL.cmd", 0o644))
    for name, mode in templates:
        source = APPLICATION / "source_tools" / name
        if source.is_symlink() or not source.is_file():
            raise ValueError("Receive the complete maintained opening source: " + name)
        body = source.read_bytes()
        destination = project / name
        if destination.is_symlink():
            raise ValueError("Preserve the existing opening symbolic link: " + name)
        if destination.exists() and (not destination.is_file() or destination.read_bytes() != body):
            raise ValueError("Preserve and compose the different existing opening file: " + name)
        outputs.append((destination, body, mode))
    # Both original destinations are checked before publishing either opener.
    results = []
    for destination, body, mode in outputs:
        with tempfile.NamedTemporaryFile(prefix=".workbench-opening-", dir=project, delete=False) as stream:
            temporary = Path(stream.name)
            try:
                stream.write(body)
                stream.flush()
                os.fsync(stream.fileno())
            except BaseException:
                temporary.unlink(missing_ok=True)
                raise
        try:
            temporary.chmod(mode)
            try:
                # Create-only publication: never replace a competing original.
                os.link(temporary, destination)
                reused = False
            except FileExistsError:
                if destination.is_symlink() or not destination.is_file() or destination.read_bytes() != body:
                    raise ValueError("Preserve the changed existing opening file: " + destination.name)
                reused = True
        finally:
            temporary.unlink(missing_ok=True)
        if destination.is_symlink() or destination.read_bytes() != body:
            raise RuntimeError("The received opening file changed during readback: " + destination.name)
        results.append({"path": destination.name, "bytes": len(body),
                        "sha256": hashlib.sha256(body).hexdigest(), "reused": reused})
    return {
        "schema": "upstate.recipient-opening/v1",
        "project_id": identity["id"],
        "project_directory": str(project),
        "files": results,
        "platform": "Linux x86_64; Windows shortcut requires an existing Linux x86_64 WSL distribution",
        "launches_model_on_open": False,
    }

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("project_directory")
    parser.add_argument("--include-wsl", action="store_true", help="Also copy the optional shortcut for a verified existing WSL recipient")
    args = parser.parse_args(argv)
    print(json.dumps(prepare(args.project_directory, include_wsl=args.include_wsl), indent=2, sort_keys=True))

if __name__ == "__main__":
    main()
