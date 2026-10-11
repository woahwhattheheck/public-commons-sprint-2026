"""Customer APIs for original SF88/SF101 workspace recovery, without a new store."""
from __future__ import annotations

from dataclasses import dataclass
import os
import re
from typing import Literal

from .errors import BuyerError, NativeError, StateError
from .runtime import Runtime

RecoveryOperation = Literal["inspect", "snapshot", "verify", "restore"]
SCHEMA = "stellar-forge.sf88.workspace-recovery.v1"
STATUSES = {
    "snapshot": "BUYER_STATE_BACKUP_CREATED",
    "verify": "BUYER_STATE_BACKUP_VERIFIED",
    "restore": "BUYER_STATE_RESTORED",
}


def _canonical(value) -> str:
    try:
        path = os.fspath(value)
    except TypeError:
        raise StateError("WORKSPACE_RECOVERY_CANONICAL_PATH_REQUIRED") from None
    if (not isinstance(path, str) or "\0" in path or not os.path.isabs(path)
            or os.path.normpath(path) != path or path == os.path.sep):
        raise StateError("WORKSPACE_RECOVERY_CANONICAL_PATH_REQUIRED")
    return path


def _passphrase_name(value: str) -> str:
    if not isinstance(value, str) or not re.fullmatch(r"[A-Z][A-Z0-9_]{4,63}", value):
        raise StateError("WORKSPACE_RECOVERY_PASSPHRASE_NAME_INVALID")
    return value


def _completion(operation, native):
    if (not isinstance(native, dict) or native.get("schema") != SCHEMA
            or not isinstance(native.get("stateRoot"), str)
            or not isinstance(native.get("directory"), str)):
        return False
    if operation == "inspect":
        return (native.get("restoreMode") == "ORIGINAL_CANONICAL_STATE_ROOT"
                and isinstance(native.get("selected"), list)
                and isinstance(native.get("inboxes"), list))
    return (native.get("status") == STATUSES[operation]
            and isinstance(native.get("recordSha256"), str)
            and re.fullmatch(r"[a-f0-9]{64}", native["recordSha256"]) is not None)


@dataclass(frozen=True)
class WorkspaceRecoveryProcess:
    returncode: int | None
    error: str | None
    interrupted: bool
    started: bool


@dataclass(frozen=True)
class WorkspaceRecoveryResult:
    """Completion metadata is independent of interruption/exit state."""
    operation: RecoveryOperation
    native: dict | None
    process: WorkspaceRecoveryProcess

    @property
    def completion_reported(self) -> bool:
        return _completion(self.operation, self.native)

    @property
    def ok(self) -> bool:
        return (self.completion_reported and self.process.returncode == 0
                and self.process.error is None and not self.process.interrupted)

    @property
    def record_sha256(self) -> str | None:
        return self.native.get("recordSha256") if self.native else None

    @property
    def state_root(self) -> str | None:
        return self.native.get("stateRoot") if self.native else None

    @property
    def directory(self) -> str | None:
        return self.native.get("directory") if self.native else None

    @property
    def checkpoint(self) -> dict | None:
        return self.native.get("checkpoint") if self.native else None


class WorkspaceRecoveryError(NativeError):
    """Retains the original result; a failed process can already have restored state."""
    def __init__(self, code: str, result: WorkspaceRecoveryResult):
        self.result = result
        super().__init__(code, returncode=result.process.returncode)


class WorkspaceRecovery:
    """Construct before restore: no Buyer, private state, or ledger is initialized."""

    def __init__(self, *, checkout, node="node", environment=None, timeout=360,
                 output_limit=2_097_152):
        self.runtime = Runtime(checkout, node=node, environment=environment,
                               timeout=timeout, output_limit=output_limit)
        self._application_directory = None

    @classmethod
    def from_buyer(cls, buyer) -> WorkspaceRecovery:
        if not isinstance(getattr(buyer, "runtime", None), Runtime):
            raise StateError("ORIGINAL_BUYER_RUNTIME_REQUIRED")
        recovery = cls.__new__(cls)
        recovery.runtime = buyer.runtime
        recovery._application_directory = _canonical(buyer.state_dir)
        return recovery

    def _selection(self, directory, state_root, inboxes, include):
        if (not isinstance(inboxes, (list, tuple)) or not isinstance(include, (list, tuple))
                or len(inboxes) > 64 or len(include) > 64):
            raise StateError("WORKSPACE_RECOVERY_ROOT_LIST_INVALID")
        selected = [_canonical(path) for path in include]
        if self._application_directory is not None:
            selected.append(self._application_directory)
        selected = list(dict.fromkeys(selected))
        if len(selected) > 64:
            raise StateError("WORKSPACE_RECOVERY_ROOT_LIST_INVALID")
        args = ["--dir", _canonical(directory), "--state-root", _canonical(state_root)]
        for path in inboxes:
            args.extend(("--inbox", _canonical(path)))
        for path in selected:
            args.extend(("--include", path))
        return args

    @staticmethod
    def _archive(bundle, passphrase_env, python, expected_record_sha256):
        args = ["--bundle", _canonical(bundle), "--pass-env", _passphrase_name(passphrase_env),
                "--python", _canonical(python)]
        if expected_record_sha256 is not None:
            if (not isinstance(expected_record_sha256, str)
                    or not re.fullmatch(r"[a-f0-9]{64}", expected_record_sha256)):
                raise StateError("WORKSPACE_RECOVERY_EXPECTED_RECORD_INVALID")
            args.extend(("--expect", expected_record_sha256))
        return args

    def _command(self, operation: RecoveryOperation, args) -> WorkspaceRecoveryResult:
        started = False

        def on_started(_pid):
            nonlocal started
            started = True

        try:
            # Original bounded pipes; no logs or temporary files inside the source
            # and no Buyer constructor that would recreate the restore target.
            run = self.runtime.run(args, started=on_started)
            native = run.output if isinstance(run.output, dict) and run.output.get("schema") == SCHEMA else None
            process = WorkspaceRecoveryProcess(run.returncode, run.error, run.interrupted, started)
        except KeyboardInterrupt:
            native = None
            process = WorkspaceRecoveryProcess(None, "NATIVE_INTERRUPTED", True, started)
        except (BuyerError, OSError) as error:
            code = getattr(error, "code", None)
            if not isinstance(code, str) or not re.fullmatch(r"[A-Z0-9_]{1,120}", code):
                code = "WORKSPACE_RECOVERY_NATIVE_COMMAND_FAILED"
            native = None
            process = WorkspaceRecoveryProcess(getattr(error, "returncode", None), code, False, started)
        result = WorkspaceRecoveryResult(operation, native, process)
        if not result.ok:
            code = process.error or ("WORKSPACE_RECOVERY_NATIVE_COMMAND_FAILED"
                                     if process.returncode != 0 else "WORKSPACE_RECOVERY_NATIVE_RESULT_INVALID")
            raise WorkspaceRecoveryError(code, result)
        return result

    def inspect(self, *, directory, state_root, inboxes=(), include=()) -> WorkspaceRecoveryResult:
        args = self._selection(directory, state_root, inboxes, include)
        return self._command("inspect", ["--inspect-workspace-backup", *args])

    def snapshot(self, *, directory, state_root, output, quiesced, inboxes=(), include=(),
                 passphrase_env="SF88_BACKUP_PASSPHRASE") -> WorkspaceRecoveryResult:
        if quiesced is not True:
            raise StateError("WORKSPACE_RECOVERY_QUIESCED_SOURCE_REQUIRED")
        args = self._selection(directory, state_root, inboxes, include)
        args.extend(("--out", _canonical(output), "--quiesced", "--pass-env",
                     _passphrase_name(passphrase_env)))
        return self._command("snapshot", ["--backup-workspace", *args])

    def verify(self, *, bundle, passphrase_env="SF88_BACKUP_PASSPHRASE",
               python="/usr/bin/python3", expected_record_sha256=None) -> WorkspaceRecoveryResult:
        args = self._archive(bundle, passphrase_env, python, expected_record_sha256)
        return self._command("verify", ["--verify-workspace-backup", *args])

    def restore(self, *, bundle, passphrase_env="SF88_BACKUP_PASSPHRASE",
                python="/usr/bin/python3", expected_record_sha256=None) -> WorkspaceRecoveryResult:
        args = self._archive(bundle, passphrase_env, python, expected_record_sha256)
        # Original authenticated record selects its root. Never delete, rewrite,
        # retry, execute, or initialize buyer state from this adapter.
        return self._command("restore", ["--restore-workspace", *args])

