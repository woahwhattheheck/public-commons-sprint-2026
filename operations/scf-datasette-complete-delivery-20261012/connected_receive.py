#!/usr/bin/env python3
"""Invocation-private transport for the unchanged original Datasette receiver.

Only the existing three Library actions cross the connected-tool boundary.
Provider bodies and credentials stay in the private invocation directory.
EOF detaches the consumer; only original receiver commands close the child.
"""
import argparse
import base64
import collections
import fcntl
import hashlib
import hmac
import http.server
import json
import os
import pathlib
import secrets
import select
import shutil
import signal
import stat
import subprocess
import sys
import tempfile
import threading
import time
import urllib.parse
import urllib.request
import uuid

OPERATION = "SCF-DATASETTE-SOURCE-EDITIONS-07476-20261012"
ORIGINAL_ROOT = pathlib.Path("/dev/datasette-publisher-a49aa-fq7r4j79")


def selected_storage_root(selection):
    value = selection.get("storage_root", str(ORIGINAL_ROOT))
    if not isinstance(value, str) or "\0" in value:
        raise ValueError("Select the original receiver's actual physical storage root.")
    root = pathlib.Path(value)
    if (not root.is_absolute() or str(root) != value or ".." in root.parts
            or root == pathlib.Path("/") or root.parent.resolve(strict=True) != root.parent
            or not root.parent.is_dir() or not os.access(root.parent, os.W_OK)):
        raise ValueError("The physical storage root needs an existing canonical writable parent.")
    if os.path.lexists(root) and (root.is_symlink() or not root.is_dir() or root.resolve() != root):
        raise ValueError("The retained physical storage root changed type.")
    return root
CONNECTOR = "connector_openai_library"
ACTIONS = ("prepare_materialize", "prepare_uploads", "finalize_uploads")
PROTOCOL = "commons.datasette.connected-library.v1"
MAX_REQUEST = 8 * 1024 * 1024
CHUNK_BYTES = 1024


def encoded(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True,
                      separators=(",", ":"), allow_nan=False).encode("utf-8")


def digest(value):
    return hashlib.sha256(encoded(value)).hexdigest()


def private_json(path, value):
    """Replace one private journal record durably; never publish its secrets."""
    body = encoded(value)
    temporary = path.with_name(path.name + "." + secrets.token_hex(8) + ".tmp")
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, "wb") as output:
            output.write(body)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
        parent_fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(parent_fd)
        finally:
            os.close(parent_fd)
    finally:
        if temporary.exists():
            temporary.unlink()


def require_text(value, label):
    if not isinstance(value, str) or not value or len(value) > 1024:
        raise ValueError("Supply " + label + ".")
    return value


def within(path, root):
    return path == root or root in path.parents



def control_lines(stop):
    """Read bounded controls without a daemon blocked in buffered stdin at exit."""
    descriptor = sys.stdin.fileno()
    original_blocking = os.get_blocking(descriptor)
    os.set_blocking(descriptor, False)
    pending = bytearray()
    try:
        # The bootstrap consumes exactly its first line; retain any bytes its
        # BufferedReader already fetched before switching to this owned reader.
        initial = sys.stdin.buffer.read1(MAX_REQUEST + 1)
        if initial:
            pending.extend(initial)
        while not stop.is_set():
            while b"\n" in pending:
                end = pending.index(b"\n") + 1
                if end > MAX_REQUEST:
                    raise ValueError("The original control line exceeds 8 MiB.")
                line = bytes(pending[:end])
                del pending[:end]
                yield line
                if stop.is_set():
                    return
            if len(pending) > MAX_REQUEST:
                raise ValueError("The original control line exceeds 8 MiB.")
            readable, _, _ = select.select([descriptor], [], [], 0.2)
            if not readable:
                continue
            try:
                chunk = os.read(descriptor, 65536)
            except BlockingIOError:
                continue
            if not chunk:
                if pending:
                    raise ValueError("The original control line ended before its newline.")
                return
            pending.extend(chunk)
    finally:
        os.set_blocking(descriptor, original_blocking)

class AcknowledgedWire:
    """One bounded stdout frame, retained exactly until its matching ACK."""
    def __init__(self, transport):
        self.transport = transport
        self.directory = transport.directory / "wire"
        self.directory.mkdir(mode=0o700)
        self.condition = threading.Condition(threading.RLock())
        self.queue = collections.deque()
        self.current = None
        self.last_ack = None
        self.acknowledged = {}
        self.sequence = 0
        self.delivered = set()
        self.detached = False
        self.resend_requested = False
        self.stopped = False
        self.worker = threading.Thread(target=self._send, daemon=True)
        self.worker.start()

    def put(self, value):
        value = {"protocol": PROTOCOL, "operation": OPERATION,
                 "invocation_id": self.transport.invocation_id, **value}
        body = encoded(value)
        message_id = str(uuid.uuid4())
        path = self.directory / (message_id + ".json")
        private_json(path, value)
        with self.condition:
            self.queue.append({"message_id": message_id, "path": path,
                               "bytes": len(body), "sha256": hashlib.sha256(body).hexdigest(),
                               "count": max(1, (len(body) + CHUNK_BYTES - 1) // CHUNK_BYTES),
                               "index": 0})
            self.condition.notify_all()
        return message_id

    def _next_locked(self):
        if self.current is not None or not self.queue:
            return
        row = self.queue[0]
        with row["path"].open("rb") as source:
            source.seek(row["index"] * CHUNK_BYTES)
            chunk = source.read(CHUNK_BYTES)
        self.sequence += 1
        self.current = {
            "protocol": PROTOCOL, "operation": OPERATION,
            "invocation_id": self.transport.invocation_id, "type": "chunk",
            "sequence": self.sequence, "message_id": row["message_id"],
            "index": row["index"], "count": row["count"], "bytes": len(chunk),
            "sha256": hashlib.sha256(chunk).hexdigest(),
            "message_bytes": row["bytes"], "message_sha256": row["sha256"],
            "base64": base64.b64encode(chunk).decode("ascii")}
        private_json(self.directory / "current.json", self.current)

    def poll(self):
        with self.condition:
            self._next_locked()
            return self.current

    def ack(self, frame):
        with self.condition:
            identity = {"sequence": frame.get("sequence"), "sha256": frame.get("sha256")}
            if identity["sequence"] in self.acknowledged:
                if self.acknowledged[identity["sequence"]] != identity["sha256"]:
                    raise ValueError("A repeated ACK changed its original hash.")
                return {"acknowledged": True, "duplicate": True}
            self._next_locked()
            if self.current is None or identity != {
                    "sequence": self.current["sequence"], "sha256": self.current["sha256"]}:
                raise ValueError("ACK does not name the outstanding native frame.")
            row = self.queue[0]
            row["index"] += 1
            self.last_ack = identity
            self.acknowledged[identity["sequence"]] = identity["sha256"]
            if row["index"] == row["count"]:
                self.delivered.add(row["message_id"])
                self.queue.popleft()
            self.current = None
            private_json(self.directory / "cursor.json",
                         {"last_ack": self.last_ack, "next_sequence": self.sequence + 1,
                          "queued_message_ids": [item["message_id"] for item in self.queue]})
            self.condition.notify_all()
            return {"acknowledged": True, "duplicate": False}

    def drained(self):
        with self.condition:
            return self.current is None and not self.queue

    def resend(self):
        with self.condition:
            self._next_locked()
            self.resend_requested = True
            self.condition.notify_all()
            return self.current

    def detach(self):
        with self.condition:
            self.detached = True
            self.condition.notify_all()

    def _send(self):
        sent_sequence = None
        while True:
            with self.condition:
                self._next_locked()
                while not self.stopped and (
                        self.current is None or self.detached or
                        (self.current["sequence"] == sent_sequence and not self.resend_requested)):
                    self.condition.wait()
                    self._next_locked()
                if self.stopped:
                    return
                frame = self.current
                self.resend_requested = False
            try:
                # This thread is the only stdout writer. A chunk is <2 KiB ASCII.
                sys.stdout.buffer.write(encoded(frame) + b"\n")
                sys.stdout.buffer.flush()
                sent_sequence = frame["sequence"]
            except (BrokenPipeError, ConnectionResetError, OSError, ValueError):
                # Pending logical messages remain reachable through /control.
                self.detach()
                self.transport.note_detached("STDOUT_DISCONNECTED", wire_already_detached=True)

    def wait_delivered(self, message_id):
        with self.condition:
            while message_id not in self.delivered and not self.stopped:
                self.condition.wait(1)

    def stop(self):
        with self.condition:
            self.stopped = True
            self.condition.notify_all()


class InvocationTransport:
    def __init__(self, selection, directory):
        self.operation = OPERATION
        self.invocation_id = str(uuid.uuid4())
        self.library_nonce = secrets.token_urlsafe(32)
        self.control_nonce = secrets.token_urlsafe(32)
        self.directory = directory
        self.lock = threading.RLock()
        self.pending = {}
        self.by_identity = {}
        self.by_atom = {}
        self.commands = {}
        self.closed = False
        self.child = None
        self.terminal_result = None
        self.terminal_message = None
        self.attachment_active = False
        self.attachment_complete = threading.Event()
        self.child_write_lock = threading.Lock()
        self.detached_reasons = []
        self.private_requests = directory / "requests"
        self.private_requests.mkdir(mode=0o700)
        self.private_commands = directory / "commands"
        self.private_commands.mkdir(mode=0o700)
        destination = selection.get("library_directory")
        if not isinstance(destination, str) or not pathlib.Path(destination).is_absolute():
            raise ValueError("Select the connected host's actual absolute Library destination.")
        # This is the connected provider workspace. It need not be mounted on the
        # native host when the provider returns an actual signed download URL.
        self.library_destination = destination
        self.storage_root = selected_storage_root(selection)
        self.upload_roots = (directory.resolve(), self.storage_root)
        self.azcopy = shutil.which("azcopy")
        if self.azcopy is None and os.access("/usr/local/bin/azcopy", os.X_OK):
            self.azcopy = "/usr/local/bin/azcopy"
        self.wire = AcknowledgedWire(self)

    def publish(self, value):
        return self.wire.put(value)

    def note_detached(self, reason, wire_already_detached=False):
        with self.lock:
            if reason not in self.detached_reasons:
                self.detached_reasons.append(reason)
                private_json(self.directory / "consumer-detached.json",
                             {"operation": OPERATION, "invocation_id": self.invocation_id,
                              "reasons": self.detached_reasons, "at": time.time(),
                              "receiver_pid": self.child.pid if self.child else None,
                              "receiver_returncode": self.child.poll() if self.child else None})
        if not wire_already_detached:
            self.wire.detach()

    def _record(self, pending):
        private_json(self.private_requests / (pending["request_id"] + ".json"),
                     {key: value for key, value in pending.items() if key != "event"})

    def _file_identity(self, value, expected_bytes):
        path = pathlib.Path(require_text(value, "the original upload workspace_path"))
        if not path.is_absolute():
            raise ValueError("Original uploads require an absolute native path.")
        resolved = path.resolve(strict=True)
        if not any(within(resolved, root) for root in self.upload_roots):
            raise ValueError("The upload is outside the original receiver's owned roots.")
        fd = os.open(resolved, os.O_RDONLY | os.O_NOFOLLOW)
        with os.fdopen(fd, "rb") as stream:
            before = os.fstat(stream.fileno())
            if not stat.S_ISREG(before.st_mode):
                raise ValueError("The original upload must be a regular file.")
            whole = hashlib.sha256()
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                whole.update(chunk)
            after = os.fstat(stream.fileno())
        fields = ("st_dev", "st_ino", "st_size", "st_mtime_ns", "st_ctime_ns")
        if any(getattr(before, key) != getattr(after, key) for key in fields):
            raise ValueError("The original upload changed while its identity was read.")
        if isinstance(expected_bytes, bool) or not isinstance(expected_bytes, int) or before.st_size != expected_bytes:
            raise ValueError("The original upload byte count differs.")
        current = resolved.stat()
        if any(getattr(after, key) != getattr(current, key) for key in fields):
            raise ValueError("The original upload path changed during its identity read.")
        return {"path": str(resolved), "bytes": before.st_size, "sha256": whole.hexdigest(),
                "device": before.st_dev, "inode": before.st_ino,
                "mtime_ns": before.st_mtime_ns, "ctime_ns": before.st_ctime_ns}

    def _identity(self, action, arguments):
        if action == "prepare_materialize":
            return {"action": action, "arguments": arguments, "read_id": str(uuid.uuid4())}, [], []
        uploads = arguments.get("uploads")
        if not isinstance(uploads, list) or not uploads or len(uploads) > 1000:
            raise ValueError("Supply the original nonempty upload batch.")
        files, atoms = [], []
        for item in uploads:
            if not isinstance(item, dict):
                raise ValueError("Supply each complete original upload object.")
            if action == "prepare_uploads":
                if item.get("purpose") != "create_library_file":
                    raise ValueError("This original operation creates its own saved files.")
                identity = self._file_identity(item.get("workspace_path"), item.get("file_size_bytes"))
                files.append(identity)
                # Actual content, not timestamps or a helper's fresh UUID, binds
                # duplicate prepares. Original destination/metadata also remain.
                atoms.append(digest({"action": action, "item": item,
                                     "file": {k: identity[k] for k in ("path", "bytes", "sha256")}}))
            else:
                session = require_text(item.get("upload_session_id"), "the original upload_session_id")
                require_text(item.get("file_id"), "the original prepared file_id")
                atoms.append(digest({"action": action, "upload_session_id": session}))
        if len(set(atoms)) != len(atoms):
            raise ValueError("An original upload batch repeats the same mutation identity.")
        identity = {"action": action, "arguments": arguments, "atoms": atoms}
        return identity, atoms, files

    def request(self, action, arguments):
        if action not in ACTIONS or not isinstance(arguments, dict):
            raise ValueError("Only the original supported Library actions are admitted.")
        original = json.loads(encoded(arguments))
        if len(encoded(original)) > MAX_REQUEST:
            raise ValueError("The original Library request exceeds 8 MiB.")
        executed = json.loads(encoded(original))
        if action == "prepare_materialize":
            if not isinstance(executed.get("destination"), dict):
                raise ValueError("The original materialization destination is missing.")
            executed["destination"] = {**executed["destination"],
                                       "directory": self.library_destination}
        identity, atoms, files = self._identity(action, original)
        identity_sha = digest(identity)
        with self.lock:
            if self.closed:
                raise RuntimeError("The original receiver has ended.")
            existing = self.by_identity.get(identity_sha)
            if existing:
                pending = self.pending[existing]
                pending["joined_helpers"] += 1
                self._record(pending)
                # The entire original result (or unresolved grant) is shared.
                return existing, pending
            overlaps = {self.by_atom[atom] for atom in atoms if atom in self.by_atom}
            if overlaps:
                # Rebatching or changing a finalized session is never authority
                # to repeat it. Exact original batches can always be replayed.
                raise ValueError("This mutation belongs to retained original request(s): " +
                                 ",".join(sorted(overlaps)) + "; replay their exact original batch.")
            request_id = str(uuid.uuid4())
            pending = {
                "request_id": request_id, "event": threading.Event(), "action": action,
                "arguments": executed, "original_arguments": original,
                "arguments_sha256": digest(executed),
                "original_arguments_sha256": digest(original),
                "identity_sha256": identity_sha, "identity_atoms": atoms, "files": files,
                "phase": "PENDING", "created_at": time.time(), "joined_helpers": 1,
                "consumer_id": None, "grant_token": None, "result": None,
                "result_sha256": None, "helper_result": None, "compatibility_error": None}
            self._record(pending)
            self.pending[request_id] = pending
            self.by_identity[identity_sha] = request_id
            for atom in atoms:
                self.by_atom[atom] = request_id
            self.publish({
                "type": "tool_request", "request_id": request_id,
                "connector_id": CONNECTOR, "action": action, "arguments": executed,
                "arguments_sha256": pending["arguments_sha256"],
                "original_arguments_sha256": pending["original_arguments_sha256"],
                "identity_sha256": identity_sha})
            return request_id, pending

    def _selected(self, frame):
        request_id = require_text(frame.get("request_id"), "the original request_id")
        pending = self.pending.get(request_id)
        if pending is None:
            raise ValueError("The request does not belong to this invocation.")
        return pending

    def claim(self, frame, status_only=False):
        consumer_id = require_text(frame.get("consumer_id"), "this consumer's unique consumer_id")
        with self.lock:
            pending = self._selected(frame)
            dispatch_allowed = False
            if not status_only and pending["phase"] == "PENDING":
                # Recheck actual native content immediately before authorizing
                # the one model-side provider call.
                for item in pending["files"]:
                    current = self._file_identity(item["path"], item["bytes"])
                    if any(current[key] != item[key] for key in ("path", "bytes", "sha256")):
                        raise ValueError("The original upload changed before its grant.")
                pending["consumer_id"] = consumer_id
                pending["grant_token"] = secrets.token_urlsafe(32)
                pending["phase"] = "CLAIMED"
                pending["claimed_at"] = time.time()
                # Durable claim precedes the only dispatch_allowed:true message.
                self._record(pending)
                dispatch_allowed = True
            same_consumer = pending["consumer_id"] == consumer_id
            answer = {
                "type": "tool_grant", "request_id": pending["request_id"],
                "consumer_id": consumer_id, "granted": same_consumer,
                "dispatch_allowed": dispatch_allowed, "phase": pending["phase"],
                "grant_token": pending["grant_token"] if same_consumer else None,
                "arguments_sha256": pending["arguments_sha256"],
                "identity_sha256": pending["identity_sha256"]}
            self.publish(answer)
            return answer

    @staticmethod
    def _arrays(result, key):
        """Read official MCP envelopes without altering the full retained body."""
        found = []
        def visit(value, depth=0):
            if depth > 12:
                raise ValueError("The provider result nesting exceeds the retained official envelope.")
            if isinstance(value, dict):
                if isinstance(value.get(key), list):
                    found.append(value[key])
                for name in ("structuredContent", "result"):
                    if name in value:
                        visit(value[name], depth + 1)
                content = value.get("content")
                if isinstance(content, list):
                    for item in content:
                        if isinstance(item, dict) and isinstance(item.get("text"), str):
                            try:
                                visit(json.loads(item.get("text", "")), depth + 1)
                            except (ValueError, TypeError):
                                pass
        visit(result)
        return found

    def _compatible(self, pending, result):
        if result.get("isError") is True:
            return None
        if pending["action"] == "prepare_materialize":
            arrays = self._arrays(result, "transfers")
            if not arrays:
                return "The actual provider result contains no complete original transfers array."
            for transfers in arrays:
                for transfer in transfers:
                    if not isinstance(transfer, dict):
                        continue  # The unchanged official parser supplies its exact error.
                    url = transfer.get("download_url")
                    if url:
                        destination = urllib.parse.urlsplit(url)
                        if (destination.scheme != "https" or destination.username or destination.password
                                or destination.hostname in ("chatgpt.com", "chatgpt-staging.com")):
                            return "The actual materialization requires an unsupported authenticated/non-HTTPS download; the local transport credential cannot authorize it."
                    elif transfer.get("workspace_path"):
                        path = pathlib.Path(transfer["workspace_path"])
                        if not path.is_absolute() or not path.is_file() or not os.access(path, os.R_OK):
                            return "The returned actual provider workspace_path is not readable on this receiving host."
        elif pending["action"] == "prepare_uploads":
            arrays = self._arrays(result, "uploads")
            if not arrays:
                return "The actual provider result contains no complete original uploads array."
            for uploads in arrays:
                if len(uploads) != len(pending["files"]):
                    return "The prepared upload count differs from the original complete batch."
                for index, upload in enumerate(uploads):
                    if not isinstance(upload, dict):
                        continue
                    if upload.get("upload_url"):
                        destination = urllib.parse.urlsplit(upload["upload_url"])
                        if (destination.scheme != "https" or destination.username or destination.password
                                or destination.hostname in ("chatgpt.com", "chatgpt-staging.com")):
                            return "This returned upload URL cannot use the unchanged helper's signed azcopy branch on a loopback connector host."
                        if self.azcopy is None:
                            return "The unchanged official upload helper requires azcopy for this actual signed upload URL; the current host has no azcopy executable."
                    elif upload.get("workspace_path"):
                        expected = pending["files"][index]
                        actual_path = pathlib.Path(upload["workspace_path"]).resolve(strict=True)
                        if actual_path != pathlib.Path(expected["path"]):
                            return "The prepared workspace transfer names a different original native file."
                        actual = self._file_identity(str(actual_path), expected["bytes"])
                        if actual["sha256"] != expected["sha256"]:
                            return "The original prepared workspace transfer file changed."
        return None

    def answer(self, frame):
        result = frame.get("result")
        if not isinstance(result, dict) or len(encoded(result)) > MAX_REQUEST:
            raise ValueError("Supply the complete actual connector result within 8 MiB.")
        result = json.loads(encoded(result))
        result_sha = digest(result)
        with self.lock:
            pending = self._selected(frame)
            if frame.get("arguments_sha256") != pending["arguments_sha256"]:
                raise ValueError("The response names different request arguments.")
            if (frame.get("consumer_id") != pending["consumer_id"] or
                    not pending["grant_token"] or
                    not isinstance(frame.get("grant_token"), str) or
                    not hmac.compare_digest(frame["grant_token"], pending["grant_token"])):
                raise ValueError("The response must carry the original exclusive provider grant.")
            if pending["result"] is not None:
                if pending["result_sha256"] != result_sha or pending["result"] != result:
                    raise ValueError("A retained provider result cannot be replaced.")
            else:
                if pending["phase"] != "CLAIMED":
                    raise ValueError("The original request has no unresolved provider grant.")
                try:
                    compatibility_error = self._compatible(pending, result)
                except (ValueError, TypeError, OSError) as error:
                    compatibility_error = "The actual returned transfer cannot be used on this host: " + type(error).__name__ + ": " + str(error)
                pending["result"] = result
                pending["result_sha256"] = result_sha
                pending["compatibility_error"] = compatibility_error
                if pending["compatibility_error"]:
                    pending["helper_result"] = {
                        "isError": True, "content": [{"type": "text", "text": pending["compatibility_error"]}]}
                else:
                    pending["helper_result"] = result
                pending["phase"] = "RESULT_RETAINED"
                pending["returned_at"] = time.time()
                # Full original provider response is durable before either its
                # original helper or the connected consumer is acknowledged.
            # A journal write can fail after the in-memory result was assigned.
            # Exact result replay retries durability, never the provider action.
            self._record(pending)
            pending["event"].set()
            answer = {"type": "tool_result_accepted", "request_id": pending["request_id"],
                      "result_sha256": result_sha, "phase": pending["phase"],
                      "compatibility_error": pending["compatibility_error"]}
            self.publish(answer)
            return answer

    def receiver_input(self, frame):
        command_id = require_text(frame.get("command_id"), "the stable original command_id")
        value = frame.get("value")
        if not isinstance(value, dict) or value.get("operation") != OPERATION:
            raise ValueError("Supply the original controller command.")
        body = encoded(value)
        value_sha = hashlib.sha256(body).hexdigest()
        if len(body) > MAX_REQUEST:
            raise ValueError("The original controller command exceeds 8 MiB.")
        # A source invocation can be large. Serialize only child stdin, never
        # hold the request/claim lock while this original pipe is being written.
        with self.child_write_lock:
            with self.lock:
                previous = self.commands.get(command_id)
                if previous:
                    if previous["value_sha256"] != value_sha or previous["value"] != value:
                        raise ValueError("An original command_id cannot name different source.")
                    answer = {"type": "receiver_input_accepted", "command_id": command_id,
                              "value_sha256": value_sha, "phase": previous["phase"], "duplicate": True}
                    self.publish(answer)
                    return answer
                if self.child is None or self.child.poll() is not None:
                    raise RuntimeError("The original receiver is not alive.")
                row = {"command_id": command_id, "value": value, "value_sha256": value_sha,
                       "phase": "CALLING", "at": time.time()}
                self.commands[command_id] = row
                path = self.private_commands / (hashlib.sha256(command_id.encode()).hexdigest() + ".json")
                private_json(path, row)
            try:
                self.child.stdin.write(body + b"\n")
                self.child.stdin.flush()
                row["phase"] = "DELIVERED"
            except (BrokenPipeError, OSError, ValueError) as error:
                row["phase"] = "UNKNOWN"
                row["error"] = type(error).__name__ + ": " + str(error)
            private_json(path, row)
            answer = {"type": "receiver_input_accepted", "command_id": command_id,
                      "value_sha256": value_sha, "phase": row["phase"], "duplicate": False}
            self.publish(answer)
            return answer

    def control(self, frame):
        if not isinstance(frame, dict) or (frame.get("protocol"), frame.get("operation"),
                frame.get("invocation_id")) != (PROTOCOL, OPERATION, self.invocation_id):
            raise ValueError("The control frame belongs to another original invocation.")
        action = frame.get("type")
        if action == "ack":
            answer = self.wire.ack(frame)
            if self.terminal_message in self.wire.delivered and self.wire.drained():
                answer["terminal"] = self.terminal_result
            return answer
        if action in ("resend", "wire_poll"):
            return {"frame": self.wire.resend() if action == "resend" else self.wire.poll(),
                    "terminal": self.terminal_result if (
                        self.terminal_message in self.wire.delivered and self.wire.drained()) else None}
        if action == "attachment_complete":
            if (self.terminal_message not in self.wire.delivered or self.terminal_result is None
                    or not self.wire.drained()):
                raise ValueError("Consume the original actual receiver exit before closing its attachment.")
            return {"terminal": self.terminal_result, "attachment_complete": True}
        if action == "tool_claim":
            return self.claim(frame)
        if action == "tool_status":
            return self.claim(frame, status_only=True)
        if action == "tool_result":
            return self.answer(frame)
        if action == "receiver_input":
            return self.receiver_input(frame)
        if action in ("invocation_status", "attach"):
            if action == "attach":
                if self.child is None or frame.get("expected_receiver_pid") != self.child.pid:
                    raise ValueError("The attachment must bind the actual original receiver PID.")
                self.attachment_active = True
                self.attachment_complete.clear()
                self.note_detached("EXPLICIT_CONTROL_ATTACHMENT")
                self.publish({"type": "transport_attached", "receiver_pid": self.child.pid,
                              "receiver_returncode": self.child.poll()})
            with self.lock:
                return {"operation": OPERATION, "invocation_id": self.invocation_id,
                        "receiver_pid": self.child.pid if self.child else None,
                        "receiver_returncode": self.child.poll() if self.child else None,
                        "detached": bool(self.detached_reasons),
                        "requests": [{key: row[key] for key in
                                     ("request_id", "action", "phase", "arguments_sha256",
                                      "identity_sha256", "consumer_id", "result_sha256")}
                                     for row in self.pending.values()]}
        raise ValueError("Unsupported connected receiving control frame.")

    def ended(self):
        with self.lock:
            self.closed = True
            for pending in self.pending.values():
                if pending["result"] is None:
                    pending["phase_at_receiver_exit"] = pending["phase"]
                    pending["receiver_ended"] = True
                    self._record(pending)
                    pending["event"].set()


class LibraryRequestHandler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):
        pass

    def _json(self, value, status=200):
        data = encoded(value)
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(data)
        self.wfile.flush()
        self.close_connection = True

    def do_POST(self):
        transport = self.server.transport
        token = transport.control_nonce if self.path == "/control" else transport.library_nonce
        if self.path not in ("/library", "/control") or not hmac.compare_digest(
                self.headers.get("Authorization", ""), "Bearer " + token):
            self.send_error(403)
            return
        streaming = False
        try:
            self.connection.settimeout(90)
            length = int(self.headers.get("Content-Length", "-1"))
            if not 0 <= length <= MAX_REQUEST:
                raise ValueError("Invalid request length.")
            raw = self.rfile.read(length)
            if len(raw) != length:
                raise ValueError("The complete original control body was not received.")
            payload = json.loads(raw)
            if self.path == "/control":
                self._json(transport.control(payload))
                if payload.get("type") == "attachment_complete":
                    # Do not close the server until this response was flushed.
                    transport.attachment_complete.set()
                return
            if not isinstance(payload, dict) or payload.get("jsonrpc") != "2.0":
                raise ValueError("Supply the complete original JSON-RPC request.")
            rpc_id = payload.get("id")
            params = payload.get("params", {})
            if not isinstance(params, dict):
                raise ValueError("Invalid original request parameters.")
            if payload.get("method") == "tools/list":
                self._json({"jsonrpc": "2.0", "id": rpc_id, "result": {
                    "tools": [{"name": "library_" + action,
                               "_meta": {"connector_id": CONNECTOR}} for action in ACTIONS]}})
                return
            if payload.get("method") != "tools/call" or params.get("name") not in [
                    "library_" + action for action in ACTIONS]:
                raise ValueError("This transport supports only the original three Library operations.")
            _, pending = transport.request(params["name"][len("library_"):], params.get("arguments"))
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Connection", "close")
            self.end_headers()
            streaming = True
            while not pending["event"].wait(10):
                self.wfile.write(b": original Library request retained\n\n")
                self.wfile.flush()
            if pending["result"] is None:
                result = {"isError": True, "content": [{"type": "text",
                          "text": "The actual original receiver ended with this provider request unresolved."}]}
            else:
                result = pending["helper_result"]
            self.wfile.write(b"data: " + encoded({"jsonrpc": "2.0", "id": rpc_id, "result": result}) + b"\n\n")
            self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, TimeoutError):
            pass  # Original request, exclusive grant and complete result remain.
        except Exception as error:
            message = type(error).__name__ + ": " + str(error)
            if streaming:
                response = {"jsonrpc": "2.0", "id": locals().get("rpc_id"),
                            "error": {"code": -32603, "message": message}}
                try:
                    self.wfile.write(b"data: " + encoded(response) + b"\n\n")
                    self.wfile.flush()
                except (OSError, ValueError):
                    pass
            else:
                try:
                    self._json({"jsonrpc": "2.0", "id": locals().get("rpc_id"),
                                "error": {"code": -32602, "message": message}})
                except (OSError, ValueError):
                    pass
        finally:
            self.close_connection = True


def receive_connected(selection):
    if not isinstance(selection, dict) or selection.get("operation") != OPERATION:
        raise ValueError("Supply the original receiving selection.")
    receiver = selection["receiver"]
    source = receiver["content"].encode("utf-8")
    if len(source) != receiver["bytes"] or hashlib.sha256(source).hexdigest() != receiver["sha256"]:
        raise ValueError("The complete selected original receiver differs.")
    compile(source, "receive_original.py", "exec")
    parent = pathlib.Path(selection.get("transport_parent") or "/mnt/data").resolve(strict=True)
    if not parent.is_dir() or not os.access(parent, os.W_OK):
        raise ValueError("Select an existing writable receiving directory.")
    connected_source = selection.get("connected_source")
    if not isinstance(connected_source, dict) or not isinstance(connected_source.get("content"), str):
        raise ValueError("Retain the complete selected connected transport source.")
    connected_body = connected_source["content"].encode("utf-8")
    if (len(connected_body) != connected_source.get("bytes") or
            hashlib.sha256(connected_body).hexdigest() != connected_source.get("sha256")):
        raise ValueError("The selected complete connected transport source differs.")
    compile(connected_body, "connected_receive.py", "exec")
    runtime = selection.get("runtime", {})
    if not isinstance(runtime, dict):
        raise ValueError("Supply the selected actual runtime paths.")
    for key in ("CODEX_PRIMARY_RUNTIME_NODE", "DATASETTE_PLAYWRIGHT", "DATASETTE_CHROMIUM"):
        value = runtime.get(key)
        if value is not None and (not isinstance(value, str) or not pathlib.Path(value).is_absolute()):
            raise ValueError("Runtime paths must be actual absolute host selections.")
    directory = pathlib.Path(tempfile.mkdtemp(prefix="datasette-connected-", dir=parent))
    os.chmod(directory, 0o700)
    selected_source = directory / "receive_original.py"
    fd = os.open(selected_source, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "wb") as output:
        output.write(source)
        output.flush()
        os.fsync(output.fileno())
    transport_source = directory / "connected_receive.py"
    fd = os.open(transport_source, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "wb") as output:
        output.write(connected_body)
        output.flush()
        os.fsync(output.fileno())
    transport = InvocationTransport(selection, directory)
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), LibraryRequestHandler)
    server.daemon_threads = True
    server.transport = transport
    threading.Thread(target=server.serve_forever, daemon=True).start()
    private_json(directory / "connected-control.json", {
        "protocol": PROTOCOL, "operation": OPERATION, "invocation_id": transport.invocation_id,
        "url": "http://127.0.0.1:%d/control" % server.server_port,
        "authorization": "Bearer " + transport.control_nonce,
        "controller_pid": os.getpid(), "receiver_source_sha256": receiver["sha256"]})
    environment = dict(os.environ)
    environment["CODEX_APPS_MCP_URL"] = "http://127.0.0.1:%d/library" % server.server_port
    environment["CODEX_APPS_AUTHORIZATION"] = "Bearer " + transport.library_nonce
    environment.pop("CODEX_APPS_CHATGPT_ACCOUNT_ID", None)
    environment["DATASETTE_TRANSFER_DIRECTORY"] = str(directory)
    environment["DATASETTE_PHYSICAL_ROOT"] = str(transport.storage_root)
    for key, value in runtime.items():
        if key in ("CODEX_PRIMARY_RUNTIME_NODE", "DATASETTE_PLAYWRIGHT", "DATASETTE_CHROMIUM"):
            environment[key] = value
    argv = [sys.executable, "-u", "-B", str(selected_source), "--artifact-directory", "native-return"]
    previous_signals = {}
    received_signals = collections.deque()

    def observe_signal(signum, _frame):
        # Python signal handlers must not acquire journal/wire locks or write
        # stdout. A lost parent signal is detachment, not a save-completion claim.
        received_signals.append(signum)

    for signum in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
        previous_signals[signum] = signal.getsignal(signum)
        signal.signal(signum, observe_signal)
    output_threads = []
    input_stop = threading.Event()
    input_thread = None
    operation_lock = None
    def input_frames():
        try:
            for raw in control_lines(input_stop):
                try:
                    frame = json.loads(raw)
                    if (isinstance(frame, dict) and frame.get("type") == "resend"
                            and frame.get("protocol") == PROTOCOL and frame.get("operation") == OPERATION
                            and frame.get("invocation_id") is None):
                        # Only this invocation's original stdin may recover its
                        # first partially observed frame before the ID is known.
                        # This reads/resends existing bytes; it grants no action.
                        transport.wire.resend()
                    else:
                        transport.control(frame)
                except Exception as error:
                    transport.publish({"type": "input_error",
                                       "error": type(error).__name__ + ": " + str(error)})
            if not input_stop.is_set():
                transport.note_detached("STDIN_EOF")
        except (OSError, ValueError):
            transport.note_detached("STDIN_DISCONNECTED")

    input_thread = threading.Thread(target=input_frames, daemon=True)
    input_thread.start()
    try:
        lock_path = parent / ".datasette-connected-original-07476.lock"
        operation_lock = os.open(lock_path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        lock_stat = os.fstat(operation_lock)
        if not stat.S_ISREG(lock_stat.st_mode):
            raise ValueError("The stable original operation lock is not a regular file.")
        try:
            fcntl.flock(operation_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            result = {"protocol": PROTOCOL, "type": "receiver_exit", "operation": OPERATION,
                      "invocation_id": transport.invocation_id, "returncode": 73,
                      "admission": "ALREADY_ADMITTED", "lock_path": str(lock_path),
                      "transport_directory": str(directory), "receiver_pid": None,
                      "receiver_source_sha256": receiver["sha256"]}
            private_json(directory / "connected-receiver-result.json", result)
            transport.wire.wait_delivered(transport.publish(result))
            return result
        current_lock = lock_path.stat()
        if (current_lock.st_dev, current_lock.st_ino) != (lock_stat.st_dev, lock_stat.st_ino):
            raise ValueError("The stable operation lock pathname changed during admission.")
        lock_record = encoded({"operation": OPERATION, "invocation_id": transport.invocation_id,
                               "controller_pid": os.getpid(), "transport_directory": str(directory)})
        os.ftruncate(operation_lock, 0)
        os.write(operation_lock, lock_record)
        os.fsync(operation_lock)
        process = subprocess.Popen(argv, cwd=directory, env=environment, stdin=subprocess.PIPE,
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
        transport.child = process
        private_json(directory / "connected-control.json", {
            "protocol": PROTOCOL, "operation": OPERATION, "invocation_id": transport.invocation_id,
            "url": "http://127.0.0.1:%d/control" % server.server_port,
            "authorization": "Bearer " + transport.control_nonce,
            "controller_pid": os.getpid(), "receiver_pid": process.pid,
            "receiver_source_sha256": receiver["sha256"],
            "transport_source_file": str(transport_source),
            "transport_source_sha256": connected_source["sha256"]})
        transport.publish({"type": "admitted", "controller_pid": os.getpid(),
                           "receiver_pid": process.pid, "transport_directory": str(directory),
                           "transport_python": sys.executable,
                           "control_file": str(directory / "connected-control.json"),
                           "transport_source_file": str(transport_source),
                           "transport_source_sha256": connected_source["sha256"],
                           "receiver_source_sha256": receiver["sha256"],
                           "library_destination": transport.library_destination,
                           "azcopy": transport.azcopy, "chunk_bytes": CHUNK_BYTES})

        def copy_output(stream, channel):
            log_fd = os.open(directory / ("native-" + channel + ".log"),
                             os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(log_fd, "wb") as log:
                while True:
                    # Bound each logical log message; long lines reassemble from
                    # the exact private log even if a stage spans several reads.
                    value = stream.readline(65536)
                    if not value:
                        break
                    log.write(value)
                    log.flush()
                    transport.publish({"type": "native_output", "channel": channel,
                                       "text": value.decode("utf-8", errors="replace"),
                                       "line_complete": value.endswith(b"\n")})
                os.fsync(log.fileno())

        for stream, channel in ((process.stdout, "stdout"), (process.stderr, "stderr")):
            thread = threading.Thread(target=copy_output, args=(stream, channel), daemon=True)
            thread.start()
            output_threads.append(thread)

        while process.poll() is None:
            while received_signals:
                transport.note_detached("SIGNAL_" + str(received_signals.popleft()))
            time.sleep(0.2)
        returncode = process.wait()
        for thread in output_threads:
            thread.join()
        transport.ended()
        result = {"protocol": PROTOCOL, "type": "receiver_exit", "operation": OPERATION,
                  "invocation_id": transport.invocation_id, "returncode": returncode,
                  "transport_directory": str(directory), "receiver_pid": process.pid,
                  "receiver_source_sha256": receiver["sha256"]}
        private_json(directory / "connected-receiver-result.json", result)
        transport.terminal_result = result
        final_message = transport.publish(result)
        transport.terminal_message = final_message
        # The same private control endpoint remains available after a disconnect,
        # including after actual child exit, until its full result is consumed.
        transport.wire.wait_delivered(final_message)
        if transport.attachment_active:
            transport.attachment_complete.wait()
        return result
    finally:
        # No fallback kill and no unrelated-process signalling. The original
        # receiver owns all programme phases, complete saves and its close path.
        # If an exceptional wrapper error occurs while that child is alive,
        # preserve this same endpoint and operation instead of abandoning it.
        if transport.child is not None and transport.child.poll() is None:
            transport.note_detached("WRAPPER_EXCEPTION")
            while transport.child.poll() is None:
                time.sleep(0.5)
            transport.ended()
            private_json(directory / "connected-receiver-result.json", {
                "operation": OPERATION, "invocation_id": transport.invocation_id,
                "receiver_pid": transport.child.pid, "returncode": transport.child.returncode,
                "transport_error": True})
        input_stop.set()
        if input_thread is not None:
            input_thread.join(timeout=2)
        transport.wire.stop()
        server.shutdown()
        server.server_close()
        if operation_lock is not None:
            os.close(operation_lock)
        for signum, previous in previous_signals.items():
            signal.signal(signum, previous)



def attach_control(argv):
    """Reconnect to one actual live transport; never start a product or child."""
    parser = argparse.ArgumentParser()
    parser.add_argument("--attach-control", required=True)
    parser.add_argument("--expected-invocation", required=True)
    parser.add_argument("--expected-receiver-pid", type=int, required=True)
    args = parser.parse_args(argv)
    path = pathlib.Path(args.attach_control)
    if not path.is_absolute() or args.expected_receiver_pid <= 0:
        raise ValueError("Select the original absolute descriptor and actual receiver PID.")
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, "rb") as source:
        observed = os.fstat(source.fileno())
        if (not stat.S_ISREG(observed.st_mode) or observed.st_uid != os.geteuid()
                or observed.st_mode & 0o077):
            raise ValueError("The original control descriptor must be private to this native owner.")
        body = source.read(MAX_REQUEST + 1)
    if len(body) > MAX_REQUEST:
        raise ValueError("The original control descriptor is oversized.")
    descriptor = json.loads(body)
    if (descriptor.get("protocol"), descriptor.get("operation"),
            descriptor.get("invocation_id"), descriptor.get("receiver_pid")) != (
            PROTOCOL, OPERATION, args.expected_invocation, args.expected_receiver_pid):
        raise ValueError("The control descriptor does not match the retained invocation and receiver.")
    endpoint = urllib.parse.urlsplit(descriptor["url"])
    if (endpoint.scheme != "http" or endpoint.hostname != "127.0.0.1"
            or endpoint.path != "/control" or endpoint.username or endpoint.password
            or endpoint.query or endpoint.fragment or endpoint.port is None):
        raise ValueError("Use only the original private loopback control endpoint.")
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *_args, **_kwargs):
            return None
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    base = {"protocol": PROTOCOL, "operation": OPERATION,
            "invocation_id": args.expected_invocation}
    def call(value):
        request = urllib.request.Request(descriptor["url"], data=encoded(value),
                                         headers={"Content-Type": "application/json",
                                                  "Authorization": descriptor["authorization"]},
                                         method="POST")
        with opener.open(request, timeout=90) as response:
            raw = response.read(MAX_REQUEST + 1)
        if len(raw) > MAX_REQUEST:
            raise ValueError("The original control response is oversized.")
        value = json.loads(raw)
        if isinstance(value, dict) and "error" in value:
            raise RuntimeError("The original control rejected this exact frame.")
        return value
    status = call({**base, "type": "invocation_status"})
    if (status.get("invocation_id"), status.get("receiver_pid")) != (
            args.expected_invocation, args.expected_receiver_pid):
        raise ValueError("The accepting endpoint differs from the retained actual receiver.")
    call({**base, "type": "attach", "expected_receiver_pid": args.expected_receiver_pid})
    # The terminal's default canonical buffer is smaller than a full result.
    if sys.stdin.isatty():
        import termios
        terminal = termios.tcgetattr(sys.stdin.fileno())
        terminal[3] &= ~(termios.ECHO | termios.ICANON)
        terminal[6][termios.VMIN] = 1
        terminal[6][termios.VTIME] = 0
        termios.tcsetattr(sys.stdin.fileno(), termios.TCSANOW, terminal)
    done = threading.Event()
    resend = threading.Event()
    failures = []
    terminal_code = []
    completion_lock = threading.Lock()
    previous = {}
    def detach_client(_signum, _frame):
        done.set()
    for signum in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
        previous[signum] = signal.getsignal(signum)
        signal.signal(signum, detach_client)
    def finish_attachment(value):
        terminal = value.get("terminal") if isinstance(value, dict) else None
        if terminal is None:
            return False
        if ((terminal.get("operation"), terminal.get("invocation_id"), terminal.get("receiver_pid"))
                != (OPERATION, args.expected_invocation, args.expected_receiver_pid)
                or not isinstance(terminal.get("returncode"), int)):
            raise ValueError("The attachment terminal outcome differs from the original receiver.")
        with completion_lock:
            if terminal_code:
                return True
            terminal_code.append(terminal["returncode"])
            try:
                call({**base, "type": "attachment_complete"})
            finally:
                done.set()
        return True
    def receive():
        try:
            for raw in control_lines(done):
                frame = json.loads(raw)
                if not isinstance(frame, dict) or any(frame.get(key) != value for key, value in base.items()):
                    raise ValueError("The attachment control frame changes the original invocation.")
                # Every mutation is sent once. A lost HTTP response remains an
                # uncertain original call, recovered through status/result replay.
                response = call(frame)
                if finish_attachment(response):
                    return
                if frame.get("type") == "resend":
                    resend.set()
        except Exception as error:
            failures.append(type(error).__name__)
        finally:
            done.set()
    input_thread = threading.Thread(target=receive, daemon=True)
    input_thread.start()
    last_sequence = None
    try:
        while not done.is_set():
            response = call({**base, "type": "wire_poll"})
            if finish_attachment(response):
                break
            frame = response.get("frame")
            if frame is not None and (frame.get("sequence") != last_sequence or resend.is_set()):
                if (frame.get("protocol"), frame.get("operation"), frame.get("invocation_id"),
                        frame.get("type")) != (PROTOCOL, OPERATION, args.expected_invocation, "chunk"):
                    raise ValueError("The original control endpoint returned a different wire frame.")
                sys.stdout.buffer.write(encoded(frame) + b"\n")
                sys.stdout.buffer.flush()
                last_sequence = frame["sequence"]
                resend.clear()
            done.wait(0.1)
    except (BrokenPipeError, ConnectionResetError, OSError, ValueError):
        failures.append("CONTROL_CONNECTION_CLOSED")
    finally:
        done.set()
        input_thread.join(timeout=2)
        for signum, handler in previous.items():
            signal.signal(signum, handler)
    return terminal_code[0] if terminal_code else (1 if failures else 0)


if __name__ == "__main__":
    if "connected_selection" in globals():
        raise SystemExit(receive_connected(connected_selection)["returncode"])
    if "--attach-control" in sys.argv[1:]:
        raise SystemExit(attach_control(sys.argv[1:]))
    raise SystemExit("Invoke with the complete original selection or attach to its retained private control.")
