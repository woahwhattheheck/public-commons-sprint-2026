"""Whole acquisitions through the original runbook and native recovery engines."""
from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path
import re
import shutil
import tempfile
import threading
import uuid

from .errors import BuyerError, NativeError, StateError
from .runtime import Runtime
from .storage import digest, dump, parse, read

SCHEMA = "stellar-forge.buyer-acquisitions-command.v1"


def _canonical(value):
    try:
        path = os.fspath(value)
    except TypeError:
        raise StateError("ACQUISITION_CANONICAL_PATH_REQUIRED") from None
    if (not isinstance(path, str) or "\0" in path or not os.path.isabs(path)
            or os.path.normpath(path) != path or path == os.path.sep):
        raise StateError("ACQUISITION_CANONICAL_PATH_REQUIRED")
    return path


def _code(error, fallback="ACQUISITION_NATIVE_COMMAND_FAILED"):
    value = getattr(error, "code", None)
    return value if isinstance(value, str) and re.fullmatch(r"[A-Z0-9_]{1,120}", value) else fallback


@dataclass(frozen=True)
class AcquisitionProcess:
    returncode: int | None
    error: str | None
    interrupted: bool
    started: bool
    native_error: str | None = None
    cleanup_error: str | None = None
    caller_cancelled: bool = False


@dataclass(frozen=True)
class AcquisitionResult:
    """Original completion does not imply that every payment was finalized."""
    command: str
    command_id: str
    native: dict | None
    completion_reported: bool
    process: AcquisitionProcess

    @property
    def ok(self):
        return (self.completion_reported and self.process.returncode == 0
                and not self.process.error and not self.process.native_error
                and not self.process.cleanup_error and not self.process.interrupted)


class AcquisitionError(NativeError):
    """Retains a completed native mutation even when its caller was interrupted."""
    def __init__(self, code, result):
        self.result = result
        super().__init__(code, returncode=result.process.returncode)


class AcquisitionWorkspace:
    """Construction does not create a Buyer, workspace, ledger or restore target."""
    def __init__(self, *, checkout, directory=None, configs_directory=None,
                 operator_settings=None, paid_file_claim_envs=None, temporary_directory=None, result_limit=33_554_432,
                 node="node", environment=None, timeout=360, output_limit=2_097_152):
        self.runtime = Runtime(checkout, node=node, environment=environment,
                               timeout=timeout, output_limit=output_limit)
        self._selection(directory, configs_directory, operator_settings, temporary_directory, result_limit,
                        paid_file_claim_envs)

    def _selection(self, directory, configs_directory, operator_settings, temporary_directory, result_limit,
                   paid_file_claim_envs=None):
        self.directory = None if directory is None else _canonical(directory)
        self.configs_directory = None if configs_directory is None else _canonical(configs_directory)
        self.operator_settings = None if operator_settings is None else _canonical(operator_settings)
        if paid_file_claim_envs is not None and (
                not isinstance(paid_file_claim_envs, (list, tuple)) or not 1 <= len(paid_file_claim_envs) <= 32
                or any(not isinstance(name, str) or not re.fullmatch(r"[A-Z][A-Z0-9_]{1,64}", name)
                       for name in paid_file_claim_envs) or len(set(paid_file_claim_envs)) != len(paid_file_claim_envs)):
            raise StateError("PAID_FILE_CLAIM_ENVS_INVALID")
        self.paid_file_claim_envs = None if paid_file_claim_envs is None else tuple(paid_file_claim_envs)
        self.temporary_directory = None if temporary_directory is None else _canonical(temporary_directory)
        if type(result_limit) is not int or not 1_048_576 <= result_limit <= 268_435_456:
            raise StateError("ACQUISITION_RESULT_LIMIT_INVALID")
        self.result_limit = result_limit

    @classmethod
    def from_buyer(cls, buyer, *, directory=None, configs_directory=None,
                   operator_settings=None, paid_file_claim_envs=None, temporary_directory=None, result_limit=33_554_432):
        if not isinstance(getattr(buyer, "runtime", None), Runtime):
            raise StateError("ORIGINAL_BUYER_RUNTIME_REQUIRED")
        value = cls.__new__(cls)
        value.runtime = buyer.runtime
        value._selection(directory, configs_directory, operator_settings, temporary_directory, result_limit,
                         paid_file_claim_envs)
        return value

    def _command(self, command, parameters=None, *, cancel_event=None):
        parameters = {key: value for key, value in (parameters or {}).items() if value is not None}
        if command not in ("verify", "restore") and self.directory is None:
            raise StateError("ACQUISITION_WORKSPACE_REQUIRED")
        command_id = str(uuid.uuid4())
        workspace = {key: value for key, value in {
            "directory": self.directory, "configsDirectory": self.configs_directory,
            "operatorSettings": self.operator_settings,
            "paidFileClaimEnvs": self.paid_file_claim_envs,
        }.items() if value is not None}
        payload = {"schema": SCHEMA, "command": command, "commandId": command_id,
                   "parameters": parameters, "resultLimit": self.result_limit}
        if workspace:
            payload["workspace"] = workspace
        directory = None
        result_file = None
        run = None
        record = None
        problem = cleanup = None
        started = False

        def on_started(_pid):
            nonlocal started
            started = True

        try:
            requested = (os.path.dirname(_canonical(parameters["stateRoot"]))
                         if "stateRoot" in parameters else self.temporary_directory or tempfile.gettempdir())
            parent = os.path.realpath(requested)
            if (self.temporary_directory or "stateRoot" in parameters) and parent != requested:
                raise StateError("ACQUISITION_CANONICAL_PATH_REQUIRED")
            for selected in (self.directory, self.configs_directory, parameters.get("stateRoot")):
                if selected and (parent == selected or parent.startswith(selected + os.path.sep)):
                    raise StateError("ACQUISITION_TEMPORARY_DIRECTORY_INSIDE_SOURCE")
            directory = Path(tempfile.mkdtemp(prefix=".sf88-acquisitions-", dir=parent))
            input_file, result_file = directory / "input.json", directory / "result.json"
            dump(input_file, payload, exclusive=True)
            run = self.runtime.run([str(input_file), str(result_file)], target="acquisitions",
                                   started=on_started, cancel_event=cancel_event)
            raw = read(result_file, self.result_limit)
            record = parse(raw)
            summary = run.output
            if isinstance(summary, dict) and (
                    summary.get("schema") != SCHEMA or summary.get("commandId") != command_id
                    or summary.get("command") != command or summary.get("resultBytes") != len(raw)
                    or summary.get("resultSha256") != digest(raw)):
                problem = "ACQUISITION_RESULT_SUMMARY_MISMATCH"
        except KeyboardInterrupt:
            problem = "NATIVE_INTERRUPTED"
        except (BuyerError, OSError) as error:
            problem = _code(error)
        finally:
            # Read the same owned descriptor after a process/log error too:
            # original publication must never be discarded as an absent result.
            if record is None and result_file is not None:
                try:
                    record = parse(read(result_file, self.result_limit))
                except (BuyerError, OSError):
                    pass
            if directory is not None:
                try:
                    shutil.rmtree(directory)
                except OSError as error:
                    cleanup = _code(error, "ACQUISITION_TEMPORARY_CLEANUP_FAILED")
        valid = (isinstance(record, dict) and record.get("schema") == SCHEMA
                 and record.get("command") == command and record.get("commandId") == command_id
                 and type(record.get("completed")) is bool)
        if not valid:
            problem = problem or "ACQUISITION_NATIVE_RESULT_INVALID"
        caller_cancelled = isinstance(cancel_event, threading.Event) and cancel_event.is_set()
        process = AcquisitionProcess(
            run.returncode if run else None, problem or (run.error if run else None),
            bool(caller_cancelled or (run and run.interrupted) or problem == "NATIVE_INTERRUPTED"
                 or (valid and record.get("interrupted"))),
            started, record.get("error") if valid else None,
            cleanup or (record.get("cleanupError") if valid else None), caller_cancelled)
        result = AcquisitionResult(command, command_id, record.get("native") if valid else None,
                                   bool(valid and record["completed"]), process)
        if not result.ok:
            raise AcquisitionError(process.error or process.native_error or process.cleanup_error
                                   or "ACQUISITION_NATIVE_COMMAND_FAILED", result)
        return result

    def state(self, *, cancel_event=None):
        return self._command("state", cancel_event=cancel_event)

    def attach_run(self, run, *, cancel_event=None):
        return self._command("attach", {"run": _canonical(run)}, cancel_event=cancel_event)

    def request(self, request_id, *, cancel_event=None):
        return self._command("request", {"id": request_id}, cancel_event=cancel_event)

    def receive_request(self, file, *, filename=None, cancel_event=None):
        return self._command("receive", {"file": _canonical(file), "filename": filename}, cancel_event=cancel_event)

    def review_request(self, request_id, *, accept_index, total_atomic, daily_atomic, cancel_event=None):
        return self._command("review-request", {"id": request_id, "acceptIndex": accept_index,
                             "totalAtomic": total_atomic, "dailyAtomic": daily_atomic}, cancel_event=cancel_event)

    def prepare_request(self, request_id, *, review_sha256, cancel_event=None):
        return self._command("prepare-request", {"id": request_id, "reviewSha256": review_sha256}, cancel_event=cancel_event)

    def paid_file(self, order_id, *, cancel_event=None):
        return self._command("paid-file", {"id": order_id}, cancel_event=cancel_event)

    def receive_paid_file(self, file, *, filename=None, cancel_event=None):
        return self._command("receive-paid-file", {"file": _canonical(file), "filename": filename},
                             cancel_event=cancel_event)

    def review_paid_file(self, order_id, *, expected_revision, total_atomic, daily_atomic,
                         filename, claim_env, cancel_event=None):
        return self._command("review-paid-file", {"id": order_id, "expectedRevision": expected_revision,
                             "totalAtomic": total_atomic, "dailyAtomic": daily_atomic, "filename": filename,
                             "claimEnv": claim_env}, cancel_event=cancel_event)

    def prepare_paid_file(self, order_id, *, review_sha256, cancel_event=None):
        return self._command("prepare-paid-file", {"id": order_id, "reviewSha256": review_sha256},
                             cancel_event=cancel_event)

    def retrieve_paid_file(self, acquisition_id, *, only, config_sha256, handoff_sha256, cancel_event=None):
        return self._command("retrieve-paid-file", {"id": acquisition_id, "only": only,
                             "configSha256": config_sha256, "handoffSha256": handoff_sha256},
                             cancel_event=cancel_event)

    def reset_paid_file(self, acquisition_id, *, only, config_sha256, handoff_sha256, cancel_event=None):
        return self._command("reset-paid-file", {"id": acquisition_id, "only": only,
                             "configSha256": config_sha256, "handoffSha256": handoff_sha256},
                             cancel_event=cancel_event)

    def download_paid_file(self, acquisition_id, operation_id, destination, *, cancel_event=None):
        return self._command("download-paid-file", {"id": acquisition_id, "operationId": operation_id,
                             "destination": _canonical(destination)}, cancel_event=cancel_event)

    def export_paid_file(self, order_id, *, destination, cancel_event=None):
        return self._command("export-paid-file", {"id": order_id, "destination": _canonical(destination)},
                             cancel_event=cancel_event)

    def draft(self, acquisition_id, *, revision=None, cancel_event=None):
        return self._command("draft", {"id": acquisition_id, "revision": revision}, cancel_event=cancel_event)

    def save(self, manifest, *, acquisition_id=None, expected_revision=0, cancel_event=None):
        return self._command("save", {"id": acquisition_id, "expectedRevision": expected_revision,
                                     "manifest": manifest}, cancel_event=cancel_event)

    def initialize(self, acquisition_id, *, expected_revision, review_sha256, cancel_event=None):
        return self._command("initialize", {"id": acquisition_id, "expectedRevision": expected_revision,
                             "reviewSha256": review_sha256}, cancel_event=cancel_event)

    def inspect(self, acquisition_id, *, cancel_event=None):
        return self._command("inspect", {"id": acquisition_id}, cancel_event=cancel_event)

    def execute(self, acquisition_id, *, expected_plan_sha256, only=None, cancel_event=None):
        return self._command("execute", {"id": acquisition_id, "only": only,
                             "expectedPlanSha256": expected_plan_sha256}, cancel_event=cancel_event)

    def recover(self, acquisition_id, *, cancel_event=None):
        return self._command("recover", {"id": acquisition_id}, cancel_event=cancel_event)

    def unlock(self, acquisition_id, *, owner_pid, cancel_event=None):
        return self._command("unlock", {"id": acquisition_id, "ownerPid": owner_pid}, cancel_event=cancel_event)

    def finalize(self, acquisition_id, *, only=None, cancel_event=None):
        return self._command("finalize", {"id": acquisition_id, "only": only}, cancel_event=cancel_event)

    def bind_accounting(self, acquisition_id, *, only, workspace, cancel_event=None):
        return self._command("bind-accounting", {"id": acquisition_id, "only": only,
                             "workspace": _canonical(workspace)}, cancel_event=cancel_event)

    def preview(self, acquisition_id, operation_id, *, cancel_event=None):
        return self._command("preview", {"id": acquisition_id, "operationId": operation_id}, cancel_event=cancel_event)

    def download(self, acquisition_id, operation_id, destination, *, cancel_event=None):
        return self._command("download", {"id": acquisition_id, "operationId": operation_id,
                             "destination": _canonical(destination)}, cancel_event=cancel_event)

    def export(self, acquisition_id, *, format, destination, cancel_event=None):
        return self._command("export", {"id": acquisition_id, "format": format,
                             "destination": _canonical(destination)}, cancel_event=cancel_event)

    def export_request(self, request_id, *, kind, destination, cancel_event=None):
        return self._command("export-request", {"id": request_id, "kind": kind,
                             "destination": _canonical(destination)}, cancel_event=cancel_event)

    def backup_review(self, *, state_root, cancel_event=None):
        return self._command("backup-review", {"stateRoot": _canonical(state_root)}, cancel_event=cancel_event)

    def backup(self, *, state_root, output, review_sha256, quiesced,
               passphrase_env=None, cancel_event=None):
        if quiesced is not True:
            raise StateError("WORKSPACE_RECOVERY_QUIESCED_SOURCE_REQUIRED")
        return self._command("backup", {"stateRoot": _canonical(state_root), "output": _canonical(output),
                             "expectedReviewSha256": review_sha256, "quiesced": True,
                             "passEnv": passphrase_env}, cancel_event=cancel_event)

    def verify(self, *, bundle, expected_record_sha256=None, passphrase_env=None,
               python=None, cancel_event=None):
        return self._command("verify", {"bundle": _canonical(bundle), "expected": expected_record_sha256,
                             "passEnv": passphrase_env, "python": None if python is None else _canonical(python)},
                             cancel_event=cancel_event)

    def restore(self, *, bundle, expected_record_sha256=None, passphrase_env=None,
                python=None, cancel_event=None):
        return self._command("restore", {"bundle": _canonical(bundle), "expected": expected_record_sha256,
                             "passEnv": passphrase_env, "python": None if python is None else _canonical(python)},
                             cancel_event=cancel_event)
