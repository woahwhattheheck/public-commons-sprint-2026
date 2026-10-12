#!/usr/bin/env python3
"""Operate and package the original OpenLineage receiving programs.

Standard library only. This driver uses the immutable 41-file source packet and
the programs' own checkpoints. It never installs dependencies or substitutes a
receiving implementation.

Example on retained storage:
  python3 delivery_driver.py --directory /private/openlineage \
    --packet source-packet.json --guide carrier-README.md prepare
  python3 delivery_driver.py --directory /private/openlineage run
  python3 delivery_driver.py --directory /private/openlineage package

Use --source-dir, --receiving-dir and --producer-dir to select already retained
original directories. Select a stopped producer operation before resuming it.
An interrupted RECEIVING.mjs directory is preserved for its original owner.
For an execution-private /dev runtime use deliver with --handover-command-json.
That file contains the current canonical upload helper argv array. The helper
receives one complete closed-stdin request for the archive and Markdown summary.
"""
from __future__ import annotations

import argparse
import base64
import contextlib
import datetime as dt
import gzip
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import signal
import subprocess
import sys
import tarfile
import tempfile
import time
import uuid

OPERATION = "SCF-OPENLINEAGE-OPERATIONS-6804-20261012"
PACKET_GIT_BLOB = "c3cdef0798617b2f0d31685876688f870bb530d3"
CARRIER_COMMIT = "a4b62345a3a52d628e06635964edbc426906cc63"
GUIDE_GIT_BLOB = "f432c3e5e3b29f3f57adb13ecd92516fc4258c7e"
SOURCE_COUNT = 41
STATE_SCHEMA = "commons.openlineage.delivery-driver.v1"
RECEIVING_SCHEMA = "commons.openlineage.receiving.v1"
PRODUCER_SCHEMA = "commons.openlineage.producer-receiving.v1"
PRODUCER_STAGES = (
    "configuration", "concurrent-originals", "writer-backpressure",
    "reviewed-edition", "restart-replay", "complete-export",
    "independent-receiving",
)
RECEIVING_OUTPUTS = (
    "receiving.json", "openlineage-workspace.json",
    "report.json", "report.csv", "report.html",
)
PRODUCER_OUTPUTS = (
    "producer-receiving.json", "producer-operation.json",
    "producer-workspace.json",
)
PRODUCER_OPTIONAL_OUTPUTS = (
    "original-simple.json", "original-simple.json.gz",
    "original-full.json", "original-full.json.gz",
    "report.json", "report.csv", "report.html",
)


class DeliveryError(RuntimeError):
    pass


def utc():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def encoded(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True,
                       indent=2) + "\n").encode("utf-8")


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def git_blob(data):
    return hashlib.sha1(b"blob " + str(len(data)).encode("ascii")
                        + b"\0" + data).hexdigest()


def plain_file(path):
    if path.is_symlink() or not path.is_file():
        raise DeliveryError("Expected a regular original file: " + str(path))
    return path.read_bytes()


def load_json(path):
    try:
        value = json.loads(plain_file(path))
    except (UnicodeError, ValueError) as error:
        raise DeliveryError("Invalid JSON in " + str(path)) from error
    if not isinstance(value, dict):
        raise DeliveryError("Expected an object in " + str(path))
    return value


def private_directory(path):
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    if not path.is_dir():
        raise DeliveryError("Expected a directory: " + str(path))


def write_exact(path, data):
    """Create an exact original once; never replace an unrelated postimage."""
    private_directory(path.parent)
    if path.exists() or path.is_symlink():
        if plain_file(path) != data:
            raise DeliveryError("Existing file differs; preserved: " + str(path))
        return
    descriptor, temporary = tempfile.mkstemp(prefix="." + path.name + ".",
                                            dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        try:
            os.link(temporary, path)
        except FileExistsError:
            if plain_file(path) != data:
                raise DeliveryError("Concurrent file differs; preserved: " + str(path))
    finally:
        Path(temporary).unlink(missing_ok=True)


def replace_private_json(path, value):
    private_directory(path.parent)
    if path.is_symlink():
        raise DeliveryError("State target is a symlink: " + str(path))
    descriptor, temporary = tempfile.mkstemp(prefix="." + path.name + ".",
                                            dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(encoded(value))
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)


@contextlib.contextmanager
def operation_lock(directory):
    """Exclude another invocation of this driver for the same retained state."""
    try:
        import fcntl
    except ImportError as error:
        raise DeliveryError("Use the existing Linux/POSIX receiving runtime") from error
    private_directory(directory)
    descriptor = os.open(directory / "delivery.lock", os.O_CREAT | os.O_RDWR, 0o600)
    try:
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise DeliveryError("The original delivery driver is already running") from error
        yield
    finally:
        os.close(descriptor)


def process_start(pid):
    """Linux process identity, avoiding PID-reuse guesses after interruption."""
    try:
        value = Path("/proc") / str(pid) / "stat"
        return plain_file(value).decode().rsplit(")", 1)[1].split()[19]
    except (OSError, ValueError, IndexError, DeliveryError):
        return None


class Driver:
    def __init__(self, args):
        self.args = args
        self.directory = args.directory.expanduser().resolve()
        self.source = (args.source_dir or self.directory / "source").expanduser().resolve()
        self.receiving = (args.receiving_dir or self.directory / "receiving").expanduser().resolve()
        self.producers = (args.producer_dir or self.directory / "producers").expanduser().resolve()
        self.state_dir = (args.state_dir or self.directory / ".delivery").expanduser().resolve()
        self.state_path = self.state_dir / "delivery.json"
        paths = [self.source, self.receiving, self.producers, self.state_dir]
        if len(set(paths)) != len(paths):
            raise DeliveryError("Source, receiving, producer and driver state directories must differ")
        for first in paths:
            for second in paths:
                if first != second and first in second.parents:
                    raise DeliveryError("Selected operation directories must be separate siblings or independent paths")
        self.guide_git_blob = args.guide_git_blob
        self.binding = {
            "operation_id": OPERATION, "packet_git_blob": PACKET_GIT_BLOB,
            "carrier_commit": CARRIER_COMMIT, "guide_git_blob": self.guide_git_blob,
            "source_directory": str(self.source),
            "receiving_directory": str(self.receiving),
            "producer_directory": str(self.producers),
            "state_directory": str(self.state_dir),
        }
        self.state = None
        self.packet_raw = None
        self.files = None
        self.guide_raw = None

    def save(self):
        self.state["updated_at"] = utc()
        replace_private_json(self.state_path, self.state)

    def load_state(self, create=False):
        if self.state_path.exists():
            self.state = load_json(self.state_path)
            if (self.state.get("schema") != STATE_SCHEMA
                    or self.state.get("binding") != self.binding):
                raise DeliveryError("Retained driver state belongs to different original inputs or directories")
        elif create:
            self.state = {
                "schema": STATE_SCHEMA, "binding": self.binding,
                "created_at": utc(), "runs": [], "packages": [],
            }
            self.save()
        else:
            self.state = {"schema": STATE_SCHEMA, "binding": self.binding,
                          "runs": [], "packages": []}

    def packet(self, materialize=False):
        path = self.args.packet or self.state_dir / "SOURCE_PACKET.json"
        raw = plain_file(path.expanduser().resolve())
        if git_blob(raw) != PACKET_GIT_BLOB:
            raise DeliveryError("Source packet differs from immutable Git blob " + PACKET_GIT_BLOB)
        packet = json.loads(raw)
        if (packet.get("schema") != "commons.source-bundle.v1"
                or packet.get("operation") != OPERATION):
            raise DeliveryError("Source packet schema or original operation differs")
        records = packet.get("files")
        if not isinstance(records, list) or len(records) != SOURCE_COUNT:
            raise DeliveryError("The original source packet must contain exactly 41 files")
        files = {}
        for record in records:
            if not isinstance(record, dict):
                raise DeliveryError("Invalid source entry")
            name, content = record.get("path"), record.get("content")
            if (not isinstance(name, str) or not name or name in {".", ".."}
                    or "/" in name or "\\" in name or "\0" in name
                    or PurePosixPath(name).is_absolute()
                    or not isinstance(content, str) or name in files):
                raise DeliveryError("Source packet has an invalid or repeated flat filename")
            files[name] = content.encode("utf-8")
        required = {"RECEIVING.mjs", "PRODUCER_RECEIVING.mjs", "cli.mjs", "producer.mjs"}
        if not required.issubset(files):
            raise DeliveryError("Original receiving application files are missing")
        self.packet_raw, self.files = raw, files
        if materialize:
            write_exact(self.state_dir / "SOURCE_PACKET.json", raw)
            private_directory(self.source)
            for name, data in files.items():
                write_exact(self.source / name, data)
        else:
            for name, data in files.items():
                if plain_file(self.source / name) != data:
                    raise DeliveryError("Materialized source differs: " + name)
        guide = (self.args.guide or self.state_dir / "CARRIER_README.md").expanduser().resolve()
        if guide.exists():
            self.guide_raw = plain_file(guide)
            if git_blob(self.guide_raw) != self.guide_git_blob:
                raise DeliveryError("Carrier README differs from immutable Git blob " + self.guide_git_blob)
            if materialize:
                write_exact(self.state_dir / "CARRIER_README.md", self.guide_raw)

    def prepare(self):
        self.load_state(create=True)
        self.packet(materialize=True)
        self.state["source"] = {
            "git_blob": PACKET_GIT_BLOB, "sha256": sha256(self.packet_raw),
            "bytes": len(self.packet_raw), "files": len(self.files),
            "guide_git_blob": self.guide_git_blob if self.guide_raw else None,
        }
        self.save()

    def native(self, phase):
        directory = self.receiving if phase == "receiving" else self.producers
        result_name = "receiving.json" if phase == "receiving" else "producer-receiving.json"
        result_path = directory / result_name
        result = {"phase": phase, "directory": str(directory),
                  "result_file": str(result_path), "complete": False}
        if not directory.exists():
            return {**result, "status": "UNSTARTED"}
        if result_path.exists():
            native = load_json(result_path)
            if phase == "receiving":
                if (native.get("schema") != RECEIVING_SCHEMA
                        or native.get("state") != "COMPLETE"
                        or not native.get("completedAt")
                        or not isinstance(native.get("operations"), list)):
                    raise DeliveryError("Original receiving.json is not a complete native result")
                actual_source = native.get("source", {}).get("applicationDirectory")
                if not actual_source or Path(actual_source).resolve() != self.source:
                    raise DeliveryError("Receiving result refers to a different original application directory")
                if not (directory / "openlineage-workspace.json").is_file():
                    raise DeliveryError("Completed receiving result is missing its portable workspace")
                result["operation_count"] = len(native["operations"])
                result["completed_at"] = native["completedAt"]
            else:
                if (native.get("schema") != PRODUCER_SCHEMA
                        or native.get("operationId") != OPERATION
                        or not native.get("workspaceId")
                        or not native.get("completedAt")
                        or not isinstance(native.get("completed"), dict)
                        or not set(PRODUCER_STAGES).issubset(native["completed"])):
                    raise DeliveryError("Original producer-receiving.json lacks completed native stages")
                self.check_producer_sources(native)
                if not (directory / "producer-workspace.json").is_file():
                    raise DeliveryError("Completed producer result is missing its portable workspace")
                result["workspace_id"] = native["workspaceId"]
                result["completed_stages"] = list(PRODUCER_STAGES)
                result["completed_at"] = native["completedAt"]
            return {**result, "status": "COMPLETE", "complete": True,
                    "result_sha256": sha256(plain_file(result_path))}
        if phase == "receiving":
            interrupted = directory / "receiving-interrupted.json"
            return {**result, "status": "INTERRUPTED" if interrupted.exists() else "EXISTING_NONCOMPLETE",
                    "interruption_file": str(interrupted) if interrupted.exists() else None}
        checkpoint = directory / "producer-operation.json"
        if checkpoint.exists():
            value = load_json(checkpoint)
            self.check_producer_checkpoint(value)
            return {**result, "status": "CHECKPOINT",
                    "workspace_id": value.get("workspaceId"),
                    "completed_stages": sorted(value.get("completed", {})),
                    "checkpoint_sha256": sha256(plain_file(checkpoint))}
        if any(directory.iterdir()):
            raise DeliveryError("Nonempty producer directory has no original producer-operation.json")
        return {**result, "status": "UNSTARTED"}

    def check_producer_sources(self, value):
        expected = sha256(self.files["producer.mjs"])
        if expected not in json.dumps(value.get("applicationSources", []), sort_keys=True):
            raise DeliveryError("Producer checkpoint/result belongs to different application source")

    def check_producer_checkpoint(self, value):
        if (value.get("schema") != PRODUCER_SCHEMA
                or value.get("operationId") != OPERATION
                or value.get("directory") != str(self.producers)
                or not isinstance(value.get("completed"), dict)):
            raise DeliveryError("Producer checkpoint differs from the original selected operation/directory")
        self.check_producer_sources(value)

    def observed_status(self):
        return {
            "schema": STATE_SCHEMA, "operation_id": OPERATION,
            "source_git_blob": PACKET_GIT_BLOB, "source_files": len(self.files),
            "receiving": self.native("receiving"),
            "producers": self.native("producers"),
            "runs": self.state.get("runs", []),
            "baseline": self.state.get("baseline"),
            "packages": self.state.get("packages", []),
        }

    def node(self):
        executable = shutil.which(self.args.node)
        if executable is None:
            raise DeliveryError("Configured Node executable is unavailable: " + self.args.node)
        return str(Path(executable).resolve())

    def recover_run_record(self, phase):
        for record in reversed(self.state.get("runs", [])):
            if record.get("phase") == phase and record.get("status") == "RUNNING":
                identity = process_start(record.get("pid"))
                if identity is not None and identity == record.get("process_start"):
                    raise DeliveryError("Original child is still active; retained PID " + str(record["pid"]))
                record["status"] = "EXIT_UNOBSERVED"
                record["recovered_at"] = utc()
                record["exit_code"] = None
                self.save()
                return

    def command(self, phase, arguments, stdin_bytes=None, owner_record=None):
        self.recover_run_record(phase)
        private_directory(self.state_dir / "logs")
        identifier = uuid.uuid4().hex
        stdout = self.state_dir / "logs" / (phase + "-" + identifier + ".stdout")
        stderr = self.state_dir / "logs" / (phase + "-" + identifier + ".stderr")
        record = {
            "id": identifier, "phase": phase, "started_at": utc(),
            "command": arguments, "cwd": str(self.source),
            "stdout_private": str(stdout), "stderr_private": str(stderr),
            "status": "STARTING", "exit_code": None,
        }
        self.state["runs"].append(record)
        if owner_record is not None:
            owner_record.update(run_id=identifier, stdout_private=str(stdout), stderr_private=str(stderr))
        self.save()
        with stdout.open("xb") as out, stderr.open("xb") as err:
            os.chmod(stdout, 0o600)
            os.chmod(stderr, 0o600)
            try:
                child = subprocess.Popen(arguments, cwd=self.source, stdout=out, stderr=err,
                                         stdin=subprocess.PIPE if stdin_bytes is not None else subprocess.DEVNULL)
            except OSError:
                record.update(status="NOT_STARTED", finished_at=utc())
                self.save()
                raise
            record.update(status="RUNNING", pid=child.pid,
                          process_start=process_start(child.pid))
            self.save()
            try:
                if stdin_bytes is None:
                    code = child.wait()
                else:
                    child.communicate(input=stdin_bytes)
                    code = child.returncode
            except KeyboardInterrupt:
                child.send_signal(signal.SIGINT)
                try:
                    code = child.wait(timeout=20)
                except subprocess.TimeoutExpired:
                    record.update(status="RUNNING", interrupted_at=utc())
                    self.save()
                    raise DeliveryError("Original child is still exiting; recover its retained PID and logs")
                record.update(status="INTERRUPTED", exit_code=code, finished_at=utc())
                self.save()
                raise
            record.update(status="EXITED", exit_code=code, finished_at=utc())
            self.save()
        if phase == "handover":
            self.forward_library_receipts(stderr)
        return code, record

    @staticmethod
    def forward_library_receipts(path):
        """Preserve the canonical save binding; all other helper stderr stays private."""
        prefix = b"__OPENAI_LIBRARY_FILE_WRITE_RECEIPT_V1__="
        with path.open("rb") as handle:
            for line in handle:
                if line.startswith(prefix):
                    sys.stderr.buffer.write(line if line.endswith(b"\n") else line + b"\n")
                    sys.stderr.buffer.flush()

    def run_phase(self, phase):
        self.recover_run_record(phase)
        before = self.native(phase)
        if before["complete"]:
            return {"phase": phase, "action": "REUSED_COMPLETE", "native": before}
        directory = self.receiving if phase == "receiving" else self.producers
        if phase == "receiving" and directory.exists():
            raise DeliveryError("RECEIVING.mjs cannot resume an existing noncomplete directory; preserved "
                                + str(directory) + " and its original interruption record")
        private_directory(directory.parent)
        program = "RECEIVING.mjs" if phase == "receiving" else "PRODUCER_RECEIVING.mjs"
        code, record = self.command(phase, [self.node(), str(self.source / program), str(directory)])
        after = self.native(phase)
        record["native_after"] = after
        self.save()
        if code != 0:
            raise DeliveryError("Original " + program + " exited " + str(code)
                                + "; private stdout/stderr and original phase records are retained")
        if not after["complete"]:
            raise DeliveryError("Original " + program + " exited without its complete native result")
        return {"phase": phase, "action": "EXECUTED", "exit_code": code, "native": after}

    def baseline(self):
        supplied = self.args.baseline_archive or self.args.baseline_export
        if supplied is None:
            return None
        original_path = supplied.expanduser().resolve()
        source = plain_file(original_path)
        checksum = sha256(source)
        if self.args.baseline_sha256 and checksum != self.args.baseline_sha256:
            raise DeliveryError("Original baseline input SHA-256 differs")
        prior = self.state.get("baseline")
        if (prior and prior.get("input_sha256") == checksum
                and prior.get("packet_git_blob") == PACKET_GIT_BLOB
                and prior.get("exit_code") == 0):
            path = Path(prior["export_private"])
            if sha256(plain_file(path)) == prior["export_sha256"]:
                return prior
            raise DeliveryError("Retained verified baseline export differs")
        if self.args.baseline_archive:
            with tarfile.open(fileobj=io.BytesIO(source), mode="r:*") as archive:
                matches = [entry for entry in archive.getmembers()
                           if PurePosixPath(entry.name).name == "openlineage-workspace.json"]
                if len(matches) != 1 or not matches[0].isfile():
                    raise DeliveryError("Baseline archive needs one regular openlineage-workspace.json")
                entry = matches[0]
                if PurePosixPath(entry.name).is_absolute() or ".." in PurePosixPath(entry.name).parts:
                    raise DeliveryError("Baseline workspace member has an unsafe path")
                stream = archive.extractfile(entry)
                if stream is None:
                    raise DeliveryError("Original baseline member is unreadable")
                export = stream.read()
                if len(export) != entry.size:
                    raise DeliveryError("Original baseline member is incomplete")
        else:
            export = source
        export_path = self.state_dir / "baseline" / (sha256(export) + ".json")
        write_exact(export_path, export)
        code, record = self.command("baseline", [
            self.node(), str(self.source / "cli.mjs"), "verify", "--input", str(export_path)])
        self.state["baseline"] = {
            "input_private": str(original_path), "input_sha256": checksum,
            "input_bytes": len(source), "export_private": str(export_path),
            "export_sha256": sha256(export), "export_bytes": len(export),
            "packet_git_blob": PACKET_GIT_BLOB, "exit_code": code,
            "run_id": record["id"], "verified_at": record["finished_at"] if code == 0 else None,
        }
        self.save()
        if code:
            raise DeliveryError("Original CLI baseline verification exited " + str(code))
        return self.state["baseline"]

    def private_tokens(self):
        values = set()
        for directory in (self.receiving, self.producers):
            for name in ("operator-token", "producer-token"):
                path = directory / name
                if path.exists():
                    value = plain_file(path).strip()
                    if value:
                        values.add(value)
                        values.add(base64.b64encode(value))
        return values

    def package(self):
        before = {phase: self.native(phase) for phase in ("receiving", "producers")}
        if not all(value["complete"] for value in before.values()):
            raise DeliveryError("Complete handover requires both original receiving results")
        if self.guide_raw is None:
            raise DeliveryError("Supply the original carrier README with --guide before packaging")
        entries = {("source/" + name): data for name, data in self.files.items()}
        entries["delivery/SOURCE_PACKET.json"] = self.packet_raw
        entries["delivery/CARRIER_README.md"] = self.guide_raw
        entries["delivery/delivery_driver.py"] = plain_file(Path(__file__).resolve())
        for name in RECEIVING_OUTPUTS:
            entries["receiving/" + name] = plain_file(self.receiving / name)
        duplicate = self.receiving / "merchant-workspace.json"
        aliases = []
        if duplicate.exists():
            if plain_file(duplicate) != entries["receiving/openlineage-workspace.json"]:
                raise DeliveryError("Original receiving export aliases differ; both originals are preserved")
            aliases.append({
                "original_name": "merchant-workspace.json",
                "canonical_archive_member": "receiving/openlineage-workspace.json",
                "sha256": sha256(entries["receiving/openlineage-workspace.json"]),
            })
        for name in PRODUCER_OUTPUTS:
            entries["producers/" + name] = plain_file(self.producers / name)
        for name in PRODUCER_OPTIONAL_OUTPUTS:
            path = self.producers / name
            if path.exists():
                entries["producers/" + name] = plain_file(path)
        baseline = self.state.get("baseline")
        if baseline:
            if baseline.get("exit_code") != 0:
                raise DeliveryError("Selected original baseline verification is incomplete")
            raw = plain_file(Path(baseline["export_private"]))
            if sha256(raw) != baseline["export_sha256"]:
                raise DeliveryError("Verified baseline export changed")
            entries["baseline/openlineage-workspace.json"] = raw
        runs = []
        for record in self.state.get("runs", []):
            if record.get("phase") not in {"receiving", "producers", "baseline"}:
                continue
            runs.append({key: record[key] for key in (
                "id", "phase", "status", "started_at", "finished_at", "exit_code",
                "recovered_at", "interrupted_at") if key in record})
        manifest = {
            "schema": "commons.openlineage.complete-handover.v1",
            "operation_id": OPERATION, "source_packet_git_blob": PACKET_GIT_BLOB,
            "source_packet_sha256": sha256(self.packet_raw), "application_files": SOURCE_COUNT,
            "carrier_commit": CARRIER_COMMIT, "carrier_readme_git_blob": self.guide_git_blob,
            "native_results": before, "native_runs": runs, "export_aliases": aliases,
            "baseline": ({key: baseline[key] for key in (
                "input_sha256", "input_bytes", "export_sha256", "export_bytes",
                "exit_code", "verified_at")} if baseline else None),
            "members": [{"path": name, "bytes": len(data), "sha256": sha256(data)}
                        for name, data in sorted(entries.items())],
        }
        entries["delivery/HANDOVER.json"] = encoded(manifest)
        tokens = self.private_tokens()
        for name, data in entries.items():
            inspected = gzip.decompress(data) if name.endswith(".json.gz") else data
            if any(token in inspected for token in tokens):
                raise DeliveryError("Generated credential detected in selected output; preserve privately: " + name)
        output = (self.args.output or self.directory / "handover" /
                  "OpenLineage_Operations_6804.tar.gz").expanduser().resolve()
        if not output.name.endswith((".tar.gz", ".tgz")):
            raise DeliveryError("Handover output must end in .tar.gz or .tgz")
        if any(path == output or path in output.parents
               for path in (self.source, self.receiving, self.producers)):
            raise DeliveryError("Write the handover outside original source and native runtime directories")
        private_directory(output.parent)
        descriptor, temporary = tempfile.mkstemp(prefix="." + output.name + ".",
                                                dir=output.parent)
        try:
            with os.fdopen(descriptor, "wb") as raw:
                with gzip.GzipFile(filename="", fileobj=raw, mode="wb", mtime=0) as compressed:
                    with tarfile.open(fileobj=compressed, mode="w|") as archive:
                        for name, data in sorted(entries.items()):
                            member = tarfile.TarInfo(name)
                            member.size = len(data)
                            member.mode = 0o600
                            member.mtime = 0
                            archive.addfile(member, io.BytesIO(data))
                raw.flush()
                os.fsync(raw.fileno())
            payload = Path(temporary).read_bytes()
            write_exact(output, payload)
        finally:
            Path(temporary).unlink(missing_ok=True)
        with tarfile.open(output, mode="r:gz") as archive:
            members = archive.getmembers()
            if sorted(member.name for member in members) != sorted(entries):
                raise DeliveryError("Written handover membership differs")
            for member in members:
                stream = archive.extractfile(member)
                if stream is None or stream.read() != entries[member.name]:
                    raise DeliveryError("Written handover member differs: " + member.name)
        result = {
            "path": str(output), "bytes": len(payload), "sha256": sha256(payload),
            "members": len(entries), "application_files": SOURCE_COUNT,
            "operation_id": OPERATION, "completed_at": utc(),
        }
        prior = next((item for item in self.state.get("packages", [])
                      if item.get("sha256") == result["sha256"]
                      and item.get("path") == str(output)), None)
        if prior:
            result["completed_at"] = prior["completed_at"]
        result["receipt_path"] = str(Path(str(output) + ".json"))
        result["summary_path"] = str(output.with_name(output.name + ".summary.md"))
        summary = self.summary(result, before, runs, baseline)
        write_exact(Path(result["summary_path"]), summary.encode("utf-8"))
        replace_private_json(Path(result["receipt_path"]), result)
        if not prior:
            self.state["packages"].append(result)
            self.save()
        return result

    def summary(self, package, native, runs, baseline):
        lines = [
            "# OpenLineage operations delivery", "",
            "Both original receiving programs completed. This handover contains the",
            "complete 41-file application, portable workspaces, original reports and",
            "producer payloads, the original source packet and guide, and this driver.", "",
            "## Original source", "",
            "- Operation: " + OPERATION,
            "- Source carrier commit: " + CARRIER_COMMIT,
            "- Source packet Git blob: " + PACKET_GIT_BLOB,
            "- Carrier guide Git blob: " + self.guide_git_blob, "",
            "## Native results", "",
            "- Merchant receiving: " + str(native["receiving"]["operation_count"]) + " completed operations.",
            "- Producer receiving: " + str(len(PRODUCER_STAGES)) + " completed stages.",
            "- Merchant completion: " + native["receiving"]["completed_at"],
            "- Producer completion: " + native["producers"]["completed_at"], "",
            "| Native phase | Recorded process status | Exit code |",
            "| --- | --- | --- |",
        ]
        for run in runs:
            code = run.get("exit_code")
            lines.append("| " + str(run["phase"]) + " | " + str(run["status"])
                         + " | " + ("unobserved" if code is None else str(code)) + " |")
        if not runs:
            lines.append("| Retained native results | Reused complete original results | unobserved |")
        lines.extend([
            "", "Native result files are retained in full inside the archive.",
            "They remain authoritative when an earlier process exit was unobserved.", "",
            "## Handover", "",
            "- Archive: " + Path(package["path"]).name,
            "- SHA-256: " + package["sha256"],
            "- Bytes: " + str(package["bytes"]),
            "- Members: " + str(package["members"]), "",
            "Start with delivery/CARRIER_README.md. The source directory preserves",
            "all original application filenames. Each workspace JSON includes its",
            "complete portable application and original workspace history. The",
            "delivery/HANDOVER.json member records every delivered member's SHA-256.", "",
        ])
        if baseline:
            lines.extend(["## Accepted earlier baseline", "",
                          "The original CLI verified the retained baseline workspace with exit 0.",
                          "- Input SHA-256: " + baseline["input_sha256"],
                          "- Workspace SHA-256: " + baseline["export_sha256"], ""])
        return "\n".join(lines)

    def check_runtime_lifetime(self):
        def execution_private(path):
            return Path("/dev") in path.parents and not (
                path == Path("/dev/shm") or Path("/dev/shm") in path.parents)
        private = any(execution_private(path) for path in (
            self.source, self.receiving, self.producers, self.state_dir))
        if private and self.args.command != "status":
            if (self.args.command not in {"deliver", "package"}
                    or self.args.handover_command_json is None):
                raise DeliveryError("Execution-private /dev paths require deliver/package with "
                                    "--handover-command-json in this invocation; otherwise select "
                                    "a retained /workspace or /dev/shm operation directory")

    @staticmethod
    def substitute(value, replacements):
        if isinstance(value, str):
            for key, replacement in replacements.items():
                value = value.replace("{" + key + "}", replacement)
            return value
        if isinstance(value, list):
            return [Driver.substitute(item, replacements) for item in value]
        if isinstance(value, dict):
            return {key: Driver.substitute(item, replacements) for key, item in value.items()}
        return value

    def handover(self, package):
        """Run the owner's current canonical upload helper before this process ends."""
        replacements = {"archive": package["path"], "receipt": package["receipt_path"],
                        "summary": package["summary_path"]}
        command_path = self.args.handover_command_json.expanduser().resolve()
        arguments = self.substitute(json.loads(plain_file(command_path)), replacements)
        if (not isinstance(arguments, list) or not arguments
                or not all(isinstance(item, str) and item for item in arguments)):
            raise DeliveryError("Handover command JSON must be a nonempty argv array")
        if self.args.handover_input_json:
            request = self.substitute(load_json(
                self.args.handover_input_json.expanduser().resolve()), replacements)
        else:
            request = {"uploads": [
                {"local_path": package["path"], "purpose": "create_library_file",
                 "library_artifact_type": "other"},
                {"local_path": package["summary_path"], "purpose": "create_library_file",
                 "library_artifact_type": "report"},
            ]}
        uploads = request.get("uploads")
        if set(request) != {"uploads"} or not isinstance(uploads, list) or not uploads:
            raise DeliveryError("Handover input must be the canonical helper's uploads object")
        allowed = set(replacements.values())
        paths = []
        for item in uploads:
            if not isinstance(item, dict) or item.get("local_path") not in allowed:
                raise DeliveryError("Handover may include only this complete archive, summary and receipt")
            plain_file(Path(item["local_path"]))
            paths.append(item["local_path"])
        if (len(set(paths)) != len(paths) or package["path"] not in paths
                or package["summary_path"] not in paths):
            raise DeliveryError("Upload the archive and summary exactly once in this ordered request")
        input_bytes = encoded(request)
        identity = sha256(encoded({"archive_sha256": package["sha256"],
                                  "request": request, "argv": arguments}))
        prior = next((item for item in self.state.get("handovers", [])
                      if item.get("identity") == identity), None)
        if prior:
            if prior.get("stderr_private") and Path(prior["stderr_private"]).is_file():
                self.forward_library_receipts(Path(prior["stderr_private"]))
            # Reconcile the original helper's receipt after a lost wrapper exit.
            self.reconcile_handover(prior, uploads)
            return prior
        if any(item.get("archive_sha256") == package["sha256"]
               for item in self.state.get("handovers", [])):
            raise DeliveryError("This archive already has an upload operation; reconcile its original "
                                "receipt before changing the request or destination")
        private_directory(self.state_dir / "handover")
        request_path = self.state_dir / "handover" / (identity + ".request.json")
        write_exact(request_path, input_bytes)
        record = {"identity": identity, "archive_sha256": package["sha256"],
                  "request_sha256": sha256(input_bytes), "request_private": str(request_path),
                  "status": "STARTING", "started_at": utc(), "results": []}
        self.state.setdefault("handovers", []).append(record)
        self.save()
        code, run = self.command("handover", arguments, stdin_bytes=input_bytes, owner_record=record)
        record.update(run_id=run["id"], stdout_private=run["stdout_private"],
                      stderr_private=run["stderr_private"], exit_code=code,
                      finished_at=run["finished_at"])
        self.save()
        self.reconcile_handover(record, uploads)
        return record

    def reconcile_handover(self, record, uploads):
        if record.get("status") == "SAVED":
            return
        run = next((item for item in self.state.get("runs", [])
                    if item.get("id") == record.get("run_id")), None)
        if run:
            if run.get("status") == "RUNNING":
                identity = process_start(run.get("pid"))
                if identity is not None and identity == run.get("process_start"):
                    record["status"] = "RUNNING"
                    self.save()
                    return
            if run.get("exit_code") is not None:
                record["exit_code"] = run["exit_code"]
            if run.get("finished_at"):
                record["finished_at"] = run["finished_at"]
        raw_path = record.get("stdout_private")
        if raw_path is None:
            record["status"] = "OUTCOME_UNOBSERVED"
            self.save()
            return
        try:
            result = load_json(Path(raw_path))
        except (DeliveryError, OSError):
            record["status"] = "OUTCOME_UNOBSERVED"
            self.save()
            return
        items = result.get("results")
        if not isinstance(items, list) or len(items) != len(uploads):
            record["status"] = "OUTCOME_UNOBSERVED"
            self.save()
            return
        selected = []
        for request, item in zip(uploads, items):
            if (not isinstance(item, dict) or item.get("local_path") != request["local_path"]
                    or item.get("purpose") != request.get("purpose")
                    or item.get("status") not in {"succeeded", "failed"}
                    or (item["status"] == "succeeded" and not item.get("library_file_id"))):
                record["status"] = "OUTCOME_UNOBSERVED"
                self.save()
                return
            selected.append({key: item[key] for key in (
                "local_path", "purpose", "status", "file_id", "library_file_id",
                "file_name", "path", "current_version_number", "local_metadata_applied",
                "error_code") if key in item})
        record["results"] = selected
        record["status"] = "SAVED" if all(item["status"] == "succeeded" for item in selected) else "PARTIAL_OR_FAILED"
        record["reconciled_at"] = utc()
        self.save()

    @staticmethod
    def public_handover(record):
        return {key: record[key] for key in (
            "identity", "archive_sha256", "status", "started_at", "finished_at",
            "exit_code", "reconciled_at", "results") if key in record}


def parser():
    root = argparse.ArgumentParser(description=__doc__,
                                   formatter_class=argparse.RawDescriptionHelpFormatter)
    root.add_argument("--directory", type=Path, required=True,
                      help="Original private operation root")
    root.add_argument("--packet", type=Path, help="Exact immutable 41-file source packet JSON")
    root.add_argument("--guide", type=Path, help="Exact original carrier README")
    root.add_argument("--guide-git-blob", default=GUIDE_GIT_BLOB,
                      help="Verified immutable README Git blob; defaults to original carrier guide")
    root.add_argument("--source-dir", type=Path, help="Select an existing exact application source directory")
    root.add_argument("--receiving-dir", type=Path, help="Original RECEIVING.mjs result directory")
    root.add_argument("--producer-dir", type=Path, help="Original resumable PRODUCER_RECEIVING.mjs directory")
    root.add_argument("--state-dir", type=Path, help="Retained private driver state; reuse this on every continuation")
    root.add_argument("--node", default="node", help="Existing Node executable; no dependency installation")
    root.add_argument("--only", choices=("both", "receiving", "producers"), default="both",
                      help="Native phase selection for run/deliver")
    original = root.add_mutually_exclusive_group()
    original.add_argument("--baseline-archive", type=Path, help="Original accepted baseline tar.gz")
    original.add_argument("--baseline-export", type=Path, help="Original accepted portable workspace JSON")
    root.add_argument("--baseline-sha256", help="Expected exact SHA-256 of the selected baseline input")
    root.add_argument("--output", type=Path, help="Complete handover .tar.gz outside original runtime directories")
    root.add_argument("--handover-command-json", type=Path,
                      help="Existing canonical helper argv JSON; receives archive+summary in one closed stdin request")
    root.add_argument("--handover-input-json", type=Path,
                      help="Optional canonical uploads JSON template with {archive}, {summary}, {receipt}")
    root.add_argument("command", choices=("prepare", "status", "run", "verify-baseline",
                                         "package", "deliver"))
    return root


def main(argv=None):
    args = parser().parse_args(argv)
    if (len(args.guide_git_blob) != 40
            or any(char not in "0123456789abcdef" for char in args.guide_git_blob)):
        parser().error("--guide-git-blob must be an exact lowercase Git blob SHA")
    if args.handover_input_json and not args.handover_command_json:
        parser().error("--handover-input-json requires --handover-command-json")
    if args.handover_command_json and args.command not in {"deliver", "package"}:
        parser().error("--handover-command-json is used with deliver or package")
    if args.baseline_sha256:
        if (len(args.baseline_sha256) != 64
                or any(char not in "0123456789abcdef" for char in args.baseline_sha256)):
            parser().error("--baseline-sha256 must be a lowercase SHA-256")
        if not (args.baseline_archive or args.baseline_export):
            parser().error("--baseline-sha256 requires a baseline input")
    if args.command == "verify-baseline" and not (args.baseline_archive or args.baseline_export):
        parser().error("verify-baseline requires the original archive or workspace JSON")
    # All new runtime/receipt/log/archive files remain private in the owner's runtime.
    os.umask(0o077)
    try:
        driver = Driver(args)
        driver.check_runtime_lifetime()
        if args.command == "status":
            driver.load_state()
            driver.packet()
            print(json.dumps(driver.observed_status(), sort_keys=True))
            return 0
        with operation_lock(driver.state_dir):
            driver.prepare()
            result = {"operation_id": OPERATION, "command": args.command}
            if args.command in ("run", "deliver"):
                phases = ("receiving", "producers") if args.only == "both" else (args.only,)
                result["phases"] = [driver.run_phase(phase) for phase in phases]
            if args.command in ("verify-baseline", "deliver"):
                result["baseline"] = driver.baseline()
            if args.command in ("package", "deliver"):
                result["handover"] = driver.package()
            if args.handover_command_json:
                result["saved"] = driver.public_handover(driver.handover(result["handover"]))
            if args.command == "prepare":
                result["source"] = driver.state["source"]
            print(json.dumps(result, sort_keys=True))
        return 0 if not args.handover_command_json or result["saved"]["status"] == "SAVED" else 1
    except KeyboardInterrupt:
        print(json.dumps({"operation_id": OPERATION, "error": "Interrupted; original phase records are retained"}),
              file=sys.stderr)
        return 130
    except (DeliveryError, OSError, ValueError, tarfile.TarError) as error:
        print(json.dumps({"operation_id": OPERATION, "error": str(error)}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
