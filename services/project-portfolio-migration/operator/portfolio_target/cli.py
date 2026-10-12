"""CLI for the same retained portfolio target workspace used by the browser."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
import uuid

from portfolio import PortfolioWorkspace

from .storage import checked_id, sync_directory
from .target import TargetError, canonical
from .workspace import ACTIONS, TargetWorkspace


def read_arguments(path):
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise TargetError("ACTION_ARGUMENTS", "The original action arguments must be a JSON object.")
    return data


def copy_artifact(workspace, identity, destination):
    """Retain an exact original object without replacing another output."""
    source = workspace.store.root / "objects" / checked_id(identity)
    destination = Path(destination).expanduser().resolve()
    destination.parent.mkdir(parents=True, exist_ok=True)
    hasher, count = hashlib.sha256(), 0
    fd, temp = tempfile.mkstemp(prefix="." + destination.name + ".", suffix=".incoming", dir=destination.parent)
    try:
        with open(source, "rb") as original, os.fdopen(fd, "wb") as output:
            for chunk in iter(lambda: original.read(1024 * 1024), b""):
                hasher.update(chunk)
                count += len(chunk)
                output.write(chunk)
            output.flush()
            os.fsync(output.fileno())
        if hasher.hexdigest() != identity:
            raise TargetError("OBJECT_HASH", "The retained object differs from its original SHA-256.")
        try:
            os.link(temp, destination)
        except FileExistsError:
            current = hashlib.sha256()
            with open(destination, "rb") as original:
                for chunk in iter(lambda: original.read(1024 * 1024), b""):
                    current.update(chunk)
            if current.hexdigest() != identity:
                raise TargetError("ARTIFACT_EXISTS", "The selected output already contains different bytes.")
        sync_directory(destination.parent)
        return {"path": str(destination), "sha256": identity, "bytes": count}
    finally:
        try:
            Path(temp).unlink()
        except FileNotFoundError:
            pass


def parser():
    result = argparse.ArgumentParser(description="Operate the original portfolio migration and receiving workspace.")
    result.add_argument("--workspace", help="The complete PortfolioWorkspace directory.")
    result.add_argument("--profiles", help="Private target profile JSON outside the portable workspace.")
    commands = result.add_subparsers(dest="command", required=True)
    commands.add_parser("state", help="Read retained editions, migrations, profiles and actions.")
    upload = commands.add_parser("upload", help="Retain an original project or companion file.")
    upload.add_argument("file")
    action = commands.add_parser("action", help="Save and run one original operator action.")
    action.add_argument("kind", choices=sorted(ACTIONS))
    action.add_argument("--request-id", help="Retained full SHA-256-format request ID; generated if omitted.")
    action.add_argument("--arguments-file", required=True)
    action.add_argument("--queue-only", action="store_true")
    request = commands.add_parser("request", help="Read or resume the exact retained local action.")
    request.add_argument("request_id")
    request.add_argument("--resume", action="store_true")
    deployment = commands.add_parser("deployment", help="Read the saved native plan, review and acceptance.")
    deployment.add_argument("deployment_id")
    pause = commands.add_parser("pause", help="Pause before the next native call; retain the current reply.")
    pause.add_argument("deployment_id")
    pause.add_argument("--request-id")
    artifact = commands.add_parser("artifact", help="Copy an exact original SHA object to a named file.")
    artifact.add_argument("sha256")
    artifact.add_argument("--output", required=True)
    receive = commands.add_parser("receive", help="Receive the original complete portable workspace.")
    receive.add_argument("archive")
    receive.add_argument("--destination", required=True)
    return result


def main(argv=None):
    args = parser().parse_args(argv)
    try:
        if args.command == "receive":
            result = PortfolioWorkspace.receive_workspace(args.archive, args.destination)
            # Opening uses the same original A/B stores. Target credentials are
            # selected separately; none are inferred from archive records.
            reopened = TargetWorkspace(args.destination, profile_config=args.profiles)
            result = {"receipt": result, "reopened": reopened.state()}
        else:
            if not args.workspace:
                raise TargetError("WORKSPACE_REQUIRED", "Select the original --workspace directory.")
            workspace = TargetWorkspace(args.workspace, profile_config=args.profiles)
            if args.command == "state":
                result = workspace.state()
            elif args.command == "upload":
                source = Path(args.file).expanduser().resolve(strict=True)
                before = source.stat()
                if before.st_size > 256 * 1024 * 1024:
                    raise TargetError("SOURCE_SIZE", "Select a complete source file up to 256 MiB.")
                with open(source, "rb") as stream:
                    result = workspace.store.upload_stream(stream, before.st_size, source.name)
                after = source.stat()
                if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) != (
                        after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns):
                    raise TargetError("SOURCE_CHANGED", "The selected source changed during upload; reopen the exact original file.")
            elif args.command == "action":
                identity = args.request_id or hashlib.sha256(uuid.uuid4().bytes).hexdigest()
                request = workspace.request(identity, args.kind, read_arguments(args.arguments_file))
                if not args.queue_only:
                    workspace.run(identity)
                result = workspace.request_result(request["id"])
            elif args.command == "request":
                if args.resume:
                    saved = workspace.store.index("requests", args.request_id)
                    workspace.request(saved["id"], saved["kind"], saved["arguments"], retry_failed=True)
                    workspace.run(args.request_id)
                result = workspace.request_result(args.request_id)
            elif args.command == "deployment":
                result = workspace.deployment(args.deployment_id)
            elif args.command == "pause":
                workspace.store.index("deployments", args.deployment_id)
                result = workspace.store.control(args.deployment_id,
                    args.request_id or hashlib.sha256(uuid.uuid4().bytes).hexdigest(), pause=True)
            elif args.command == "artifact":
                result = copy_artifact(workspace, args.sha256, args.output)
            else:
                raise TargetError("OPERATOR_COMMAND", "Unknown original operator command.")
        sys.stdout.buffer.write(canonical(result) + b"\n")
        return 1 if isinstance(result, dict) and result.get("state") == "FAILED" else 0
    except Exception as exc:
        sys.stdout.buffer.write(canonical({"error": {"code": getattr(exc, "code", type(exc).__name__),
                                                   "message": str(exc)}}) + b"\n")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
