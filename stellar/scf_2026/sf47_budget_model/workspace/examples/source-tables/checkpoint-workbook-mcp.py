#!/usr/bin/env python3
"""Save the original workbook MCP case after its native workspace clients close."""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import stat
import sys
import uuid
import zipfile
from contextlib import ExitStack

SCHEMA = "stellar-forge.planning-workbook-mcp.receiving.v1"
OPERATION = "SCF-WORKBOOK-MCP-CEDAR-8047-20261012"
PHASE = "14-complete-workbook-handover"
PREFIX = "SCF_Native_Workbook_Operating_Case_94FE"

def private_directory(path):
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    value = path.lstat()
    if not stat.S_ISDIR(value.st_mode) or path.resolve() != path or value.st_mode & 0o077:
        raise RuntimeError("Select an original private checkpoint directory.")
    return path

def identity(path):
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return {"bytes": path.stat().st_size, "sha256": digest.hexdigest()}

def atomic_json(path, value):
    content = (json.dumps(value, ensure_ascii=True, sort_keys=True, indent=2) + "\n").encode("utf-8")
    pending = path.with_name(path.name + ".pending-" + uuid.uuid4().hex)
    try:
        with pending.open("xb") as target:
            os.chmod(pending, 0o600)
            target.write(content)
            target.flush()
            os.fsync(target.fileno())
        os.replace(pending, path)
        fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
    finally:
        pending.unlink(missing_ok=True)

def receive(request):
    if request.get("schema") != SCHEMA + ".checkpoint-request" \
            or request.get("operationId") != OPERATION or request.get("phase") != PHASE:
        raise RuntimeError("Select the original complete workbook handover checkpoint.")
    case = Path(request["directory"])
    if not case.is_absolute() or case.is_symlink() or case.resolve() != case or not case.is_dir():
        raise RuntimeError("Select the original complete native case directory.")
    selected = os.environ.get("SF47_WORKBOOK_MCP_CHECKPOINT_DIRECTORY")
    if not selected:
        raise RuntimeError("Set the private complete-case checkpoint directory.")
    directory = Path(selected)
    if not directory.is_absolute() or directory == case or case in directory.parents:
        raise RuntimeError("Keep the checkpoint outside the original case directory.")
    private_directory(directory)
    area = private_directory(case / "mcp-receiving")
    original = json.loads((case / "WORKBOOK_HANDOVER_RECEIVING.json").read_text("utf-8"))
    inputs = json.loads((area / "INPUTS.json").read_text("utf-8"))
    handover = json.loads((area / "phases" / (PHASE + ".json")).read_text("utf-8"))
    if not original.get("nativePortableOutputComplete") \
            or original.get("received", {}).get("contentSha256") != request["originalContentSha256"] \
            or inputs.get("originalContentSha256") != request["originalContentSha256"] \
            or handover.get("retention", {}).get("state") != "COMPLETE" \
            or handover.get("originalMemberCount") != 15 or len(handover.get("files", [])) != 4 \
            or handover.get("archive", {}).get("file", {}).get("sha256") != request["handoverArchiveSha256"]:
        raise RuntimeError("Preserve the same original native plan and its complete retained handover.")
    for field in ("originalContentSha256", "handoverArchiveSha256"):
        value = request.get(field)
        if not isinstance(value, str) or len(value) != 64 or any(c not in "0123456789abcdef" for c in value):
            raise RuntimeError("Keep the original complete content identities.")
    stem = "workbook-mcp-" + request["handoverArchiveSha256"]
    archive = directory / (stem + ".zip")
    record = directory / (stem + ".json")
    if record.exists():
        value = json.loads(record.read_text("utf-8"))
        if value.get("schema") != SCHEMA + ".checkpoint" or value.get("state") != "COMPLETE" \
                or any(value.get(k) != request[k] for k in ("operationId", "phase",
                    "originalContentSha256", "handoverArchiveSha256")) \
                or archive.is_symlink() or not archive.is_file() \
                or identity(archive) != {k: value["archive"][k] for k in ("bytes", "sha256")}:
            raise RuntimeError("Retain the original completed checkpoint and its full archive.")
        return {**value, "location": {**value["location"], "path": str(archive)}}
    context = {k: request[k] for k in ("operationId", "phase", "originalContentSha256", "handoverArchiveSha256")}
    context["schema"] = SCHEMA + ".checkpoint-context"
    context_path = area / "CHECKPOINT_CONTEXT.json"
    if context_path.exists():
        if json.loads(context_path.read_text("utf-8")) != context:
            raise RuntimeError("Keep the checkpoint of the original complete handover.")
    else:
        atomic_json(context_path, context)
    with ExitStack() as stack:
        for name in ("authoring", "receiving"):
            lock_path = area / name / "workspace.lock"
            if lock_path.is_symlink() or not lock_path.is_file():
                raise RuntimeError("Keep both original native workspaces with their operating locks.")
            lock = stack.enter_context(lock_path.open("rb"))
            try:
                fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as error:
                raise RuntimeError("Close both original native workspace clients before preserving the case.") from error
        if archive.exists():
            if archive.is_symlink() or not archive.is_file():
                raise RuntimeError("Keep the original regular checkpoint archive.")
            with zipfile.ZipFile(archive) as saved:
                if json.loads(saved.read(PREFIX + "/mcp-receiving/CHECKPOINT_CONTEXT.json")) != context \
                        or saved.testzip() is not None:
                    raise RuntimeError("The earlier complete-case checkpoint differs.")
        else:
            pending = archive.with_name(archive.name + ".pending-" + uuid.uuid4().hex)
            try:
                with zipfile.ZipFile(pending, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6,
                        allowZip64=True) as saved:
                    for base, dirs, files in os.walk(case, followlinks=False):
                        dirs.sort()
                        for name in dirs:
                            if (Path(base) / name).is_symlink():
                                raise RuntimeError("Keep original case directories without symlinks.")
                        for name in sorted(files):
                            path = Path(base) / name
                            if path.is_symlink() or not path.is_file():
                                raise RuntimeError("Keep every regular original case member.")
                            saved.write(path, (Path(PREFIX) / path.relative_to(case)).as_posix())
                os.chmod(pending, 0o600)
                with pending.open("rb") as saved:
                    os.fsync(saved.fileno())
                os.link(pending, archive)
            finally:
                pending.unlink(missing_ok=True)
        value = {**context, "schema": SCHEMA + ".checkpoint", "state": "COMPLETE",
            "archive": {"fileName": archive.name, **identity(archive)},
            "location": {"kind": "local-file", "fileName": archive.name}}
        atomic_json(record, value)
        return {**value, "location": {**value["location"], "path": str(archive)}}

if __name__ == "__main__":
    os.umask(0o077)
    try:
        if sys.stdin.isatty():
            raise RuntimeError("Send one complete checkpoint request as JSON and close stdin.")
        print(json.dumps(receive(json.load(sys.stdin)), separators=(",", ":")), flush=True)
    except Exception as error:
        print("Complete-case checkpoint failed: " + str(error), file=sys.stderr, flush=True)
        sys.exit(1)
