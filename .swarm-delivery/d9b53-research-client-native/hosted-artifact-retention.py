#!/usr/bin/env python3
"""Keep one sealed artifact available until the original upload helper saves it."""
from __future__ import annotations

import argparse
import base64
from contextlib import contextmanager
from datetime import datetime, timezone
import fcntl
import hashlib
import importlib
import json
import os
from pathlib import Path
import select
import shutil
import stat
import sys
import tempfile
import time
from urllib.parse import parse_qs, urlparse

SCHEMA = "commons.hosted-artifact-retention/v1"
RETRY_SCHEMA = "commons.hosted-artifact-retry/v1"


def now():
    return datetime.now(timezone.utc).isoformat()


def read_json(path):
    path = Path(path)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, "rb") as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_size > 4 * 1024 * 1024:
            raise ValueError("Selected retention control must be an ordinary JSON file")
        return json.load(stream)


def write_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, temporary = tempfile.mkstemp(prefix=".pending-", dir=path.parent)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(value, stream, ensure_ascii=False, sort_keys=True, indent=2)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        directory_fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    finally:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass


def fingerprint(path):
    path = Path(path)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    digest = hashlib.sha256()
    with os.fdopen(fd, "rb") as stream:
        before = os.fstat(stream.fileno())
        if not stat.S_ISREG(before.st_mode):
            raise ValueError("The sealed return must be an ordinary file")
        for part in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(part)
        after = os.fstat(stream.fileno())
    selected = ("st_dev", "st_ino", "st_size", "st_mtime_ns", "st_ctime_ns")
    if any(getattr(before, key) != getattr(after, key) for key in selected):
        raise ValueError("The sealed return changed while it was being read")
    return {"path": str(path), "bytes": after.st_size, "sha256": digest.hexdigest()}


def expiry(prepared):
    """Read an observed signed-URL expiry; an unknown format remains unknown."""
    url = prepared.get("upload_url")
    if not url:
        return None
    query = parse_qs(urlparse(url).query)
    values = query.get("se") or query.get("Expires")
    if not values or len(values) != 1:
        return None
    try:
        value = values[0]
        if value.isdigit():
            return datetime.fromtimestamp(int(value), timezone.utc)
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed.astimezone(timezone.utc) if parsed.tzinfo else None
    except (ValueError, OverflowError):
        return None


def accepted(value):
    rows = value.get("results", []) if isinstance(value, dict) else []
    return isinstance(rows, list) and len(rows) == 1 and all(
        isinstance(row, dict) and row.get("status") == "succeeded"
        and row.get("library_file_id")
        and row.get("local_metadata_applied") is True
        for row in rows
    )


class Retention:
    def __init__(self, root, artifact, operation_id, helper_directory,
                 emit=print, artifact_type=None):
        self.root = Path(root).resolve(strict=True)
        self.control = self.root / "hosted-return-retention"
        self.control.mkdir(mode=0o700, exist_ok=True)
        if self.control.is_symlink() or not self.control.is_dir():
            raise ValueError("Use the original ordinary private retention directory")
        self.state_path = self.control / "state.json"
        if (not isinstance(operation_id, str) or not operation_id
                or len(operation_id) > 240 or any(ord(c) < 32 for c in operation_id)):
            raise ValueError("Select the original printable operation identity")
        self.operation_id = operation_id
        self.artifact = dict(artifact)
        if (set(self.artifact) != {"path", "bytes", "sha256"}
                or isinstance(self.artifact["bytes"], bool)
                or not isinstance(self.artifact["bytes"], int)
                or self.artifact["bytes"] < 0
                or not isinstance(self.artifact["sha256"], str)
                or len(self.artifact["sha256"]) != 64
                or any(c not in "0123456789abcdef" for c in self.artifact["sha256"])):
            raise ValueError("Select the sealed path, byte length and lowercase SHA256")
        path = Path(self.artifact["path"])
        if not path.is_absolute() or path.is_symlink():
            raise ValueError("Select the original absolute ordinary return file")
        path = path.resolve(strict=True)
        path.relative_to(self.root)
        self.artifact["path"] = str(path)
        self.emit = emit
        self.helper_directory = Path(helper_directory).resolve()
        self.artifact_type = artifact_type
        self.state = None
        self.current_attempt = None
        self.force_finalize = False
        self.refresh_unused = False

    @contextmanager
    def lock(self):
        descriptor = os.open(
            self.control / "owner.lock",
            os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW,
            0o600,
        )
        with os.fdopen(descriptor, "a") as stream:
            fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            yield

    def verify_artifact(self):
        actual = fingerprint(self.artifact["path"])
        if actual != self.artifact:
            raise ValueError("The original sealed return identity changed")

    def persist(self):
        self.state["updatedAt"] = now()
        write_json(self.state_path, self.state)
        if self.current_attempt:
            record = self.control / "attempts" / (hashlib.sha256(
                self.current_attempt.encode("utf-8")).hexdigest() + ".json")
            value = dict(self.state["attempt"])
            value.update(schema=SCHEMA, operationId=self.operation_id,
                         artifactSha256=self.artifact["sha256"])
            write_json(record, value)

    def summary(self):
        state = self.state
        return {
            "schema": SCHEMA, "operationId": self.operation_id,
            "state": state["status"], "artifact": self.artifact,
            "libraryArtifactType": state.get("libraryArtifactType"),
            "uploadSessionId": state.get("uploadSessionId"),
            "stage": state.get("attempt", {}).get("stage"),
            "attemptId": state.get("attempt", {}).get("id"),
            "transferObserved": state.get("transfer", {}).get("complete", False),
            "finalizationStarted": state.get("finalization", {}).get("started", False),
            "providerResultObserved": "providerResult" in state.get("finalization", {}),
            "diagnostics": state.get("transfer", {}).get("diagnostics", []),
            "retryRequest": str(self.control / "retry-request.json"),
            "receipt": state.get("receipt") if accepted(state.get("receipt")) else None,
        }

    def publish_summary(self):
        self.emit(json.dumps(self.summary(), ensure_ascii=False, separators=(",", ":")))

    def initialize(self, prepared_upload=None):
        self.verify_artifact()
        if self.state_path.exists():
            self.state = read_json(self.state_path)
            if (self.state.get("schema") != SCHEMA
                    or self.state.get("operationId") != self.operation_id
                    or self.state.get("artifact") != self.artifact):
                raise ValueError("Existing retention belongs to a different original return")
            if (self.artifact_type is not None
                    and self.artifact_type != self.state.get("libraryArtifactType")):
                raise ValueError("Existing retention uses a different artifact classification")
        else:
            selected_type = (
                prepared_upload.get("library_artifact_type")
                if prepared_upload is not None else self.artifact_type
            )
            if (prepared_upload is not None and self.artifact_type is not None
                    and self.artifact_type != selected_type):
                raise ValueError("Keep the supplied preparation's original classification")
            self.state = {
                "schema": SCHEMA, "operationId": self.operation_id,
                "artifact": self.artifact, "status": "prepared",
                "libraryArtifactType": selected_type,
                "createdAt": now(), "attempt": {}, "transfer": {},
                "finalization": {}, "receipt": None,
            }
            self.persist()
            if prepared_upload is not None:
                self.install_prepared(prepared_upload, reason="original reservation")
        if accepted(self.state.get("receipt")):
            self.state["status"] = "saved"
            self.persist()

    def prepared(self):
        selected = self.state.get("preparedFile")
        return read_json(self.control / selected) if selected else None

    def install_prepared(self, value, reason):
        value = dict(value)
        if (value.get("purpose") != "create_library_file"
                or value.get("store_in_library") is not True
                or value.get("file_name") != Path(self.artifact["path"]).name
                or not value.get("upload_session_id")
                or not value.get("file_id")
                or bool(value.get("upload_url")) == bool(value.get("workspace_path"))):
            raise ValueError("Use the original complete prepared create-upload object")
        if ("library_artifact_type" in value
                and value["library_artifact_type"] != self.state.get("libraryArtifactType")):
            raise ValueError("The selected preparation changes the artifact classification")
        if self.state.get("finalization", {}).get("started"):
            raise ValueError("Reconcile the original finalization before changing its session")
        identifier = str(value["upload_session_id"])
        relative = "prepared/" + hashlib.sha256(identifier.encode()).hexdigest() + ".json"
        destination = self.control / relative
        if destination.exists() and read_json(destination) != value:
            raise ValueError("The original prepared session changed")
        write_json(destination, value)
        self.state.update(
            uploadSessionId=identifier, preparedFile=relative,
            transfer={}, finalization={}, receipt=None,
        )
        self.state["preparedReceipt"] = {
            "reason": reason, "receivedAt": now(),
            "expiresAt": expiry(value).isoformat() if expiry(value) else None,
        }
        self.persist()

    def attempt(self, request):
        self.verify_artifact()
        if accepted(self.state.get("receipt")):
            self.state["status"] = "saved"
            self.persist()
            return self.state["receipt"]
        if not isinstance(request, dict) or request.get("schema") != RETRY_SCHEMA:
            raise ValueError("Use the original retention retry schema")
        if (request.get("operationId") != self.operation_id
                or request.get("artifactSha256") != self.artifact["sha256"]):
            raise ValueError("Retry selects a different original return")
        retry_id = request.get("retryId")
        if (not isinstance(retry_id, str) or not retry_id or len(retry_id) > 160
                or any(ord(c) < 32 for c in retry_id)):
            raise ValueError("Select one printable retry identity")
        mode = request.get("mode", "same-session")
        if mode not in ("same-session", "retry-finalize", "refresh-unused"):
            raise ValueError("Unknown original retention retry mode")
        record = self.control / "attempts" / (
            hashlib.sha256(retry_id.encode("utf-8")).hexdigest() + ".json")
        request_sha = hashlib.sha256(json.dumps(
            {key: value for key, value in request.items() if key != "action"},
            sort_keys=True, ensure_ascii=False, separators=(",", ":"),
        ).encode("utf-8")).hexdigest()
        previous = read_json(record) if record.exists() else None
        if previous is None and self.state.get("attempt", {}).get("id") == retry_id:
            previous = self.state["attempt"]
        if previous is not None:
            if previous.get("requestSha256") != request_sha:
                raise ValueError("The original retry identity selects a different request")
            self.publish_summary()
            return self.state.get("receipt")
        expected = request.get("expectedUploadSessionId")
        if expected != self.state.get("uploadSessionId"):
            raise ValueError("The pending upload session changed before this retry")
        if mode == "retry-finalize" and not self.state.get("finalization", {}).get("started"):
            raise ValueError("No original finalization was dispatched for this session")
        if mode == "refresh-unused" and self.state.get("finalization", {}).get("started"):
            raise ValueError("The same original finalization needs reconciliation")
        if request.get("preparedUpload") is not None and mode != "refresh-unused":
            raise ValueError("A replacement unused reservation requires refresh-unused")
        self.current_attempt = retry_id
        self.force_finalize = mode == "retry-finalize"
        self.refresh_unused = mode == "refresh-unused"
        self.state["status"] = "saving"
        self.state["attempt"] = {
            "id": retry_id, "mode": mode, "stage": "intent",
            "requestSha256": request_sha,
            "startedAt": now(), "sessionId": self.state.get("uploadSessionId"),
        }
        self.persist()  # The retry is consumed before any provider dispatch.
        if request.get("preparedUpload") is not None:
            self.install_prepared(request["preparedUpload"], reason="selected unused renewal")
            self.refresh_unused = False

        helper_path = str(self.helper_directory)
        if helper_path not in sys.path:
            sys.path.insert(0, helper_path)
        upload_module = importlib.import_module("library_upload")
        files_module = importlib.import_module("library_file_transfer")
        apps_module = importlib.import_module("library_hosted_apps")
        for module, name in (
            (upload_module, "library_upload.py"),
            (files_module, "library_file_transfer.py"),
            (apps_module, "library_hosted_apps.py"),
        ):
            if Path(module.__file__).resolve() != self.helper_directory / name:
                raise ValueError("A different original upload helper is already imported")
        retention = self

        class ObservedUploader:
            def __init__(self):
                self.original = upload_module.SignedUrlUploader()

            def upload(self, uploads, directory):
                if len(uploads) != 1:
                    raise ValueError("Retain the one original return")
                if retention.state.get("transfer", {}).get("complete"):
                    return {uploads[0].request.index}
                retention.state["attempt"]["stage"] = "transfer"
                retention.state["transfer"] = {
                    "started": True, "complete": False, "attemptId": retry_id,
                    "startedAt": now(), "sessionId": retention.state["uploadSessionId"],
                }
                retention.persist()
                executable = shutil.which("azcopy")
                if executable is None and Path("/usr/local/bin/azcopy").is_file():
                    executable = "/usr/local/bin/azcopy"
                retention.state["transfer"]["transportObservation"] = {
                    "hostedUpload": self.original._is_estuary_upload(uploads[0]),
                    "azcopyExecutable": executable,
                }
                retention.persist()
                try:
                    transferred = self.original.upload(uploads, directory)
                    retention.verify_artifact()
                    retention.state["transfer"].update(
                        complete=uploads[0].request.index in transferred,
                        observedAt=now(),
                    )
                    retention.persist()
                    return transferred
                finally:
                    # These are original helper diagnostics, kept private with the
                    # signed session and outside the already sealed return.
                    source = Path(directory)
                    target = retention.control / "helper-diagnostics" / hashlib.sha256(
                        retry_id.encode("utf-8")).hexdigest()
                    captured = []
                    for original in sorted(source.rglob("*")):
                        if original.is_symlink() or not original.is_file():
                            continue
                        relative = original.relative_to(source)
                        destination = target / relative
                        destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                        shutil.copyfile(original, destination)
                        os.chmod(destination, 0o600)
                        captured.append(fingerprint(destination))
                    retention.state["transfer"]["diagnostics"] = captured
                    retention.persist()

        class ObservedWorkflow(upload_module.LibraryUploadWorkflow):
            def _prepare(self, requests):
                if len(requests) != 1:
                    raise ValueError("Retain the one original return")
                selected = retention.prepared()
                expired_unused = (
                    selected is not None and expiry(selected) is not None
                    and expiry(selected) <= datetime.now(timezone.utc)
                    and not retention.state.get("transfer", {}).get("started")
                    and not retention.state.get("finalization", {}).get("started")
                )
                if selected is not None and not retention.refresh_unused and not expired_unused:
                    return ((upload_module.PreparedUpload.parse(requests[0], selected),),
                            {}, frozenset())
                if retention.state.get("finalization", {}).get("started"):
                    raise ValueError("The original finalization keeps its prepared session")
                retention.state["attempt"]["stage"] = "prepare"
                retention.persist()
                prepared, failures, fallbacks = super()._prepare(requests)
                if len(prepared) != 1 or failures or fallbacks:
                    return prepared, failures, fallbacks
                value = prepared[0].payload
                retention.install_prepared(
                    value, reason="expired unused reservation" if expired_unused
                    else "original helper preparation",
                )
                return prepared, failures, fallbacks

            def _finalize(self, uploads):
                if not uploads:
                    return []
                if len(uploads) != 1:
                    raise ValueError("Finalize the one original return")
                retention.verify_artifact()
                previous = retention.state.get("finalization", {})
                cached = previous.get("providerResult")
                if cached is not None and not retention.force_finalize:
                    return [(uploads[0], cached)]
                if previous.get("started") and not retention.force_finalize:
                    raise ValueError(
                        "The original finalization has no observed response; "
                        "reconcile it or select an explicit retry-finalize attempt"
                    )
                retention.state["attempt"]["stage"] = "finalize"
                retention.state["finalization"] = {
                    "started": True, "attemptId": retry_id, "startedAt": now(),
                    "sessionId": retention.state["uploadSessionId"],
                }
                retention.persist()
                returned = super()._finalize(uploads)
                if len(returned) != 1:
                    raise ValueError("Original finalization returned a different result count")
                retention.state["finalization"].update(
                    providerResult=returned[0][1], observedAt=now(),
                )
                retention.persist()
                return returned

        state_parent = self.control / "helper-state"
        state_parent.mkdir(mode=0o700, exist_ok=True)
        try:
            workflow = ObservedWorkflow(
                apps_module.HostedAppsClient(), files_module.LibraryFileMaterializer(),
                ObservedUploader(), state_parent=state_parent,
            )
            upload_request = {
                "local_path": self.artifact["path"], "purpose": "create_library_file",
            }
            if self.state.get("libraryArtifactType") is not None:
                upload_request["library_artifact_type"] = self.state["libraryArtifactType"]
            receipt = workflow.run({"uploads": [upload_request]})
            self.state["receipt"] = receipt
            self.state["status"] = "saved" if accepted(receipt) else "awaiting-retry"
            self.state["attempt"].update(stage="returned", returnedAt=now())
            self.persist()
            return receipt
        except Exception as error:
            self.state["status"] = "saved" if accepted(self.state.get("receipt")) else "awaiting-retry"
            self.state["attempt"]["exception"] = {
                "type": type(error).__name__, "message": str(error),
                "observedAt": now(),
            }
            self.persist()
            return None
        finally:
            self.publish_summary()
            self.current_attempt = None


    def safe_attempt(self, request):
        try:
            return self.attempt(request)
        except Exception as error:
            self.state["status"] = "saved" if accepted(self.state.get("receipt")) else "awaiting-retry"
            self.state.setdefault("attempt", {})["exception"] = {
                "type": type(error).__name__, "message": str(error), "observedAt": now(),
            }
            try:
                self.persist()
            except OSError:
                pass
            self.publish_summary()
            self.current_attempt = None
            return None

    def read_bytes(self, request):
        if (request.get("operationId") != self.operation_id
                or request.get("artifactSha256") != self.artifact["sha256"]):
            raise ValueError("Read selects a different original return")
        offset = request.get("offset", 0)
        length = request.get("maxBytes", 64 * 1024)
        if (isinstance(offset, bool) or not isinstance(offset, int) or offset < 0
                or offset > self.artifact["bytes"] or isinstance(length, bool)
                or not isinstance(length, int) or not 1 <= length <= 256 * 1024):
            raise ValueError("Select an original byte range of at most 262144 bytes")
        descriptor = os.open(self.artifact["path"], os.O_RDONLY | os.O_NOFOLLOW)
        try:
            before = os.fstat(descriptor)
            if not stat.S_ISREG(before.st_mode):
                raise ValueError("The original return is not an ordinary file")
            digest = hashlib.sha256()
            for part in iter(lambda: os.read(descriptor, 1024 * 1024), b""):
                digest.update(part)
            data = os.pread(descriptor, length, offset)
            after = os.fstat(descriptor)
            keys = ("st_dev", "st_ino", "st_size", "st_mtime_ns", "st_ctime_ns")
            if (any(getattr(before, key) != getattr(after, key) for key in keys)
                    or after.st_size != self.artifact["bytes"]
                    or digest.hexdigest() != self.artifact["sha256"]):
                raise ValueError("The original return changed during its byte read")
        finally:
            os.close(descriptor)
        return {
            "schema": SCHEMA, "operationId": self.operation_id,
            "state": "artifact-bytes", "artifact": self.artifact,
            "offset": offset, "bytes": len(data),
            "sha256": hashlib.sha256(data).hexdigest(),
            "base64": base64.b64encode(data).decode("ascii"),
            "eof": offset + len(data) == self.artifact["bytes"],
        }

    def command(self, request):
        if not isinstance(request, dict):
            raise ValueError("Use one original retention command object")
        action = request.get("action", "retry")
        if action == "status":
            self.publish_summary()
        elif action == "read":
            self.emit(json.dumps(self.read_bytes(request), separators=(",", ":")))
        elif action == "retry":
            self.safe_attempt(request)
        else:
            raise ValueError("Use status, read or retry on the original return")

    def request(self, retry_id, mode="same-session"):
        return {
            "schema": RETRY_SCHEMA, "operationId": self.operation_id,
            "artifactSha256": self.artifact["sha256"], "retryId": retry_id,
            "expectedUploadSessionId": self.state.get("uploadSessionId"), "mode": mode,
        }

    def hold(self, prepared_upload=None, input_stream=None):
        with self.lock():
            self.initialize(prepared_upload)
            if accepted(self.state.get("receipt")):
                self.publish_summary()
                return self.state["receipt"]
            # A previous initial attempt remains consumed even if its reservation
            # advanced or process return was lost. Re-entry waits for a new retry ID.
            initial_record = self.control / "attempts" / (
                hashlib.sha256(b"initial").hexdigest() + ".json")
            if (not initial_record.exists()
                    and self.state.get("attempt", {}).get("id") != "initial"):
                self.safe_attempt(self.request("initial"))
            self.publish_summary()
            retry_path = self.control / "retry-request.json"
            previous_file = None
            active_input = input_stream
            input_bytes = bytearray()
            pending_input = []
            while not accepted(self.state.get("receipt")):
                retry = None
                try:
                    info = retry_path.lstat()
                    selected = (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns)
                    if selected != previous_file:
                        previous_file = selected
                        retry = read_json(retry_path)
                except FileNotFoundError:
                    pass
                except (OSError, ValueError) as error:
                    self.emit(json.dumps({
                        "state": "retry-file-attention", "operationId": self.operation_id,
                        "type": type(error).__name__,
                    }))
                if retry is None and not pending_input and active_input is not None:
                    try:
                        readable, _, _ = select.select([active_input], [], [], 1)
                        if readable:
                            chunk = os.read(active_input.fileno(), 64 * 1024)
                            if not chunk:
                                active_input = None
                                if input_bytes:
                                    pending_input.append(bytes(input_bytes))
                                    input_bytes.clear()
                            else:
                                input_bytes.extend(chunk)
                                if len(input_bytes) > 1024 * 1024:
                                    input_bytes.clear()
                                    raise ValueError("Retention input exceeds one MiB")
                                while b"\n" in input_bytes:
                                    line, _, remaining = input_bytes.partition(b"\n")
                                    input_bytes = bytearray(remaining)
                                    if line.strip():
                                        pending_input.append(bytes(line))
                    except (OSError, ValueError) as error:
                        self.emit(json.dumps({
                            "state": "retry-stream-attention",
                            "operationId": self.operation_id,
                            "type": type(error).__name__,
                        }))
                        active_input = None
                if retry is None and pending_input:
                    line = pending_input.pop(0)
                    try:
                        retry = json.loads(line)
                    except (ValueError, UnicodeDecodeError) as error:
                        self.emit(json.dumps({
                            "state": "retry-input-attention",
                            "operationId": self.operation_id,
                            "type": type(error).__name__,
                        }))
                if retry is not None:
                    try:
                        self.command(retry)
                    except (ValueError, OSError) as error:
                        self.emit(json.dumps({
                            "state": "retry-input-attention",
                            "operationId": self.operation_id,
                            "type": type(error).__name__, "message": str(error),
                        }))
                elif active_input is None:
                    time.sleep(1)
            return self.state["receipt"]


def retain_artifact(root, artifact, operation_id, helper_directory,
                    prepared_upload=None, input_stream=None, emit=print,
                    artifact_type=None):
    return Retention(
        root, artifact, operation_id, helper_directory, emit, artifact_type,
    ).hold(
        prepared_upload=prepared_upload, input_stream=input_stream,
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", required=True)
    parser.add_argument("--artifact", required=True)
    parser.add_argument("--bytes", type=int, required=True)
    parser.add_argument("--sha256", required=True)
    parser.add_argument("--operation", required=True)
    parser.add_argument("--helper-directory", required=True)
    parser.add_argument("--prepared-file")
    parser.add_argument("--artifact-type")
    args = parser.parse_args()
    prepared = read_json(args.prepared_file) if args.prepared_file else None
    retain_artifact(
        args.root, {"path": args.artifact, "bytes": args.bytes, "sha256": args.sha256},
        args.operation, args.helper_directory, prepared_upload=prepared,
        input_stream=sys.stdin, emit=lambda text: print(text, flush=True),
        artifact_type=args.artifact_type,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
