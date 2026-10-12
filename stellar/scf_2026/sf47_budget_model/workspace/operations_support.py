"""Original SF74 support receiving through the existing SF47 Operations transaction."""
from __future__ import annotations

import base64
from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import threading
import uuid

from model import Problem, canonical, digest, now, text
import operations_domain as domain

SCHEMA = "stellar-forge.sf47-support-preview.v1"
MAX_HANDOFF = 8 * 1024 * 1024
MAX_READER_OUTPUT = 16 * 1024 * 1024
_READER = threading.BoundedSemaphore(1)
HELPER = Path(__file__).resolve().with_name("support_handoff.mjs")


def fields(value, allowed, label):
    if not isinstance(value, dict) or set(value) - set(allowed):
        raise Problem("Use the declared " + label + ".", 422, "SUPPORT_INPUT_INVALID")
    return value


def handoff_bytes(value):
    if not isinstance(value, str) or len(value) > ((MAX_HANDOFF + 2) // 3) * 4:
        raise Problem("Select an original support handoff up to 8 MiB.", 413, "SUPPORT_HANDOFF_SIZE")
    try:
        raw = base64.b64decode(value, validate=True)
    except (ValueError, TypeError) as exc:
        raise Problem("The original support file encoding is invalid.", 422, "SUPPORT_HANDOFF_INVALID") from exc
    if not raw or len(raw) > MAX_HANDOFF or base64.b64encode(raw).decode("ascii") != value:
        raise Problem("Select an original support handoff up to 8 MiB.", 413, "SUPPORT_HANDOFF_SIZE")
    return raw


def filename(value):
    value = text(value, "Original support filename", 240, True)
    if value in (".", "..") or "/" in value or "\\" in value or any(ord(c) < 32 for c in value):
        raise Problem("Use a plain original support filename.", 422, "SUPPORT_INPUT_INVALID")
    return value


def inspect(raw):
    selected = os.environ.get("SF47_SUPPORT_NODE") or shutil.which("node")
    if not selected or not Path(selected).is_absolute() or not Path(selected).is_file():
        raise Problem("The installed grant runtime needs its Node executable to read the original support product.",
                      503, "SUPPORT_NODE_UNAVAILABLE")
    if not _READER.acquire(blocking=False):
        raise Problem("Another original support review is running. Retry this same review when it completes.",
                      409, "SUPPORT_REVIEW_BUSY")
    try:
        try:
            process = subprocess.run(
                [selected, "--max-old-space-size=192", str(HELPER)],
                input=raw, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                timeout=20, check=False)
        except subprocess.TimeoutExpired as exc:
            raise Problem("The original support reader timed out. Retry the same source selection.",
                          503, "SUPPORT_READER_TIMEOUT") from exc
        except OSError as exc:
            raise Problem("The selected original support reader could not start.",
                          503, "SUPPORT_READER_UNAVAILABLE") from exc
        if len(process.stdout) > MAX_READER_OUTPUT:
            raise Problem("Select a shorter original support capture period.",
                          413, "SUPPORT_REVIEW_SIZE")
        try:
            result = json.loads(process.stdout)
        except (ValueError, UnicodeError) as exc:
            raise Problem("The installed original support reader did not return a complete review.",
                          503, "SUPPORT_READER_UNAVAILABLE") from exc
        if not isinstance(result, dict) or result.get("ok") is not True:
            error = result.get("error", {}) if isinstance(result, dict) else {}
            code = error.get("code", "SUPPORT_HANDOFF_INVALID")
            if not isinstance(code, str) or not re.fullmatch(r"[A-Z0-9_]{1,100}", code):
                code = "SUPPORT_HANDOFF_INVALID"
            raise Problem(str(error.get("message", "The original support handoff is invalid."))[:1000],
                          413 if error.get("status") == 413 else 422, code)
        native = result.get("result")
        if process.returncode != 0 or not isinstance(native, dict) or \
                native.get("schema") != "stellar-forge.sf47-support-source.v1" or \
                native.get("source", {}).get("sha256") != hashlib.sha256(raw).hexdigest() or \
                native.get("source", {}).get("bytes") != len(raw):
            raise Problem("The original support reader returned a different source.",
                          503, "SUPPORT_READER_CHANGED")
        return native
    finally:
        _READER.release()


def preview(context, body):
    fields(body, ("expectedVersion", "filename", "contentBase64"), "support preview")
    expected = domain.integer(body.get("expectedVersion"), "Reviewed operations version", 1, 10000000)
    if context["program"]["version"] != expected:
        raise Problem("The operations case changed. Refresh it before previewing the support file.",
                      409, "OPERATIONS_CONFLICT")
    name = filename(body.get("filename"))
    native = inspect(handoff_bytes(body.get("contentBase64")))
    source = {**native["source"], "filename": name}
    duplicates = [row["id"] for row in context["sources"] if row["sha256"] == source["sha256"]]
    deployments = [{"id": row["id"], "name": row["name"], "operator": row["operator"],
                    "state": row["state"], "sourceIds": row.get("sourceIds", [])}
                   for row in context["records"]["deployments"]]
    result = {"schema": SCHEMA, "caseId": context["program"]["id"], "version": expected,
              "source": source, "workspace": native["workspace"], "metadata": native["metadata"],
              "reader": native["reader"], "report": native["report"], "html": native["html"],
              "retainedSourceIds": duplicates, "deployments": deployments}
    binding = deepcopy(result)
    # These are native calculation timestamps, not retained capture/event dates.
    # All original source times and factual review fields remain in the binding.
    binding["report"].pop("generatedAt", None)
    for side in ("before", "after"):
        capture = binding["report"].get(side)
        if isinstance(capture, dict) and isinstance(capture.get("native"), dict):
            capture["native"].pop("generatedAt", None)
    result["previewSha256"] = digest(binding)
    return result


def _retained_source(operations, context, raw, name, observed_at):
    sha256 = hashlib.sha256(raw).hexdigest()
    for row in context["sources"]:
        if row["sha256"] == sha256 and row["bytes"] == len(raw):
            saved = operations.db.execute(
                "SELECT content FROM ops_sources WHERE program_id=? AND id=?",
                (context["program"]["id"], row["id"])).fetchone()
            if saved is not None and bytes(saved[0]) == raw:
                return row
    value = operations._source_add(context["program"]["id"], {
        "filename": name, "mediaType": "text/html" if name.endswith(".html") else "application/json",
        "kind": "deployment", "sourceUrl": "", "observedAt": observed_at,
        "contentBase64": base64.b64encode(raw).decode("ascii")})
    context["sources"].append(value)
    return value


def receive(operations, context, data, actor, version):
    """Called only inside the original case command's idempotent transaction."""
    fields(data, ("filename", "contentBase64", "expectedPreviewSha256", "deploymentId", "deployment"),
           "support receiving command")
    reviewed = preview(context, {"expectedVersion": context["program"]["version"],
                                "filename": data.get("filename"), "contentBase64": data.get("contentBase64")})
    if reviewed["previewSha256"] != domain.sha(data.get("expectedPreviewSha256"), "Reviewed support preview", False):
        raise Problem("The support source or operations case changed. Preview it again.",
                      409, "SUPPORT_PREVIEW_CONFLICT")
    selected = data.get("deploymentId")
    previous = None
    if selected is not None:
        if data.get("deployment") not in (None, {}):
            raise Problem("Choose the existing deployment or provide a new one.", 422, "SUPPORT_INPUT_INVALID")
        previous = next((row for row in context["records"]["deployments"] if row["id"] == selected), None)
        if previous is None:
            raise Problem("Select a deployment from this operations case.", 404, "SUPPORT_DEPLOYMENT_NOT_FOUND")
        candidate = deepcopy(previous)
    else:
        candidate = fields(data.get("deployment"), (
            "name", "operator", "operatorId", "role", "participantClass", "environment", "state",
            "costIds", "tranche", "endpoint", "releaseRef", "caseRef", "acceptedBy", "acceptedAt",
            "sourceNote"), "new support deployment")
        candidate = deepcopy(candidate)
        candidate["sourceIds"] = []
        # Validate before creating attachments; the outer transaction also rolls back a failure.
        domain.prepare("deployments", candidate, context)
        count = operations.db.execute("SELECT COUNT(*) FROM ops_records WHERE program_id=?",
                                      (context["program"]["id"],)).fetchone()[0]
        if count >= 5000:
            raise Problem("This operations case has reached its retained-record bound.", 413, "SUPPORT_RECORD_LIMIT")
    raw = handoff_bytes(data.get("contentBase64"))
    html = reviewed["html"].encode("utf-8")
    if not html or len(html) > MAX_HANDOFF:
        raise Problem("Select a shorter original support capture period.", 413, "SUPPORT_REVIEW_SIZE")
    prefix = "support-" + reviewed["source"]["sha256"][:20]
    original = _retained_source(operations, context, raw,
        prefix + "--" + reviewed["source"]["filename"][:170], reviewed["source"]["generatedAt"])
    report = _retained_source(operations, context, html,
        prefix + ".runtime.html", reviewed["source"]["generatedAt"])
    sources = list(dict.fromkeys([*candidate.get("sourceIds", []), original["id"], report["id"]]))
    if previous is not None and sources == previous.get("sourceIds", []):
        return {"unchanged": True, "before": previous, "after": previous,
                "sourceIds": [original["id"], report["id"]], "sourceSha256": reviewed["source"]["sha256"]}
    candidate["sourceIds"] = sources
    value = domain.prepare("deployments", candidate, context, previous)
    current = now()
    row = {**value, "id": previous["id"] if previous else "deployment-" + uuid.uuid4().hex,
           "version": version, "createdAt": previous["createdAt"] if previous else current,
           "updatedAt": current, "recordedBy": actor}
    operations._save(context["program"]["id"], "deployments", row)
    return {"unchanged": False, "before": previous, "after": row,
            "sourceIds": [original["id"], report["id"]], "sourceSha256": reviewed["source"]["sha256"]}
