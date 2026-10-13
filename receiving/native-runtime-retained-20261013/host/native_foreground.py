#!/usr/bin/env python3
"""Start or resume one original native command in this foreground process."""
from __future__ import annotations

import argparse
import importlib
import json
import os
from pathlib import Path
import sys


SCHEMA = "commons.native-cloud-foreground/v1"


def load_native(host_root):
    host_root = Path(host_root).expanduser().resolve(strict=True)
    entry = host_root / "swarm_cloud_job.py"
    if not entry.is_file():
        raise ValueError("Select the existing native host directory containing swarm_cloud_job.py")
    sys.path.insert(0, str(host_root))
    native = importlib.import_module("swarm_cloud_job")
    if Path(native.__file__).resolve() != entry:
        raise ValueError("A different native runtime is already imported in this process")
    if (native.SCHEMA != "commons.native_cloud_command/v1" or
            getattr(native, "MEMORY_ADMISSION_SCHEMA", None) != "commons.native-cloud-memory/v1" or
            getattr(native, "NATIVE_COMPLETION_SCHEMA", None) != "commons.native-command-completion/v1"):
        raise ValueError("This operation requires the native memory and retained-completion runtime")
    return native


class ForegroundLaunch:
    """Acquire an original launch callback, acknowledge, then exec its supervisor.

    Only use in a dedicated process whose owner will retain it. Native start or
    recovery owns validation and the record lock; this object neither schedules
    work nor retries an existing operation. The environment stays in memory.
    Optional on_finalized retains that same process through the original
    supervisor's synchronous tail before its memory/disk reservations release.
    """
    retains_native_supervisor = True

    def __init__(self, native, *, on_finalized=None, temporary_placement=None,
                 required_artifact_retention=False):
        if (getattr(native, "NATIVE_LAUNCH_SCHEMA", None) != "commons.native-supervisor-launch/v1" or
                getattr(native, "NATIVE_SUPERVISOR_LOCK_SCHEMA", None) != "commons.native-supervisor-lock/v1"):
            raise ValueError("Install the complete original foreground and supervisor-lock runtime")
        if on_finalized is not None:
            if (not callable(on_finalized) or getattr(native, "NATIVE_FINALIZER_SCHEMA", None)
                    != "commons.native-supervisor-finalizer/v1"):
                raise ValueError("Select the original source-owned supervisor finalizer capability")
        if temporary_placement is not None:
            from native_receiving_storage import validate_temporary_placement
            validate_temporary_placement(temporary_placement)
            if temporary_placement["ephemeral"] and on_finalized is None:
                raise ValueError("An ephemeral original placement requires its same-process finalizer")
        if type(required_artifact_retention) is not bool:
            raise ValueError("Choose whether the original launch requires retained output copies")
        if required_artifact_retention and getattr(native, "NATIVE_ARTIFACT_RETENTION_SCHEMA", None) != "commons.native-artifact-retention/v1":
            raise ValueError("The selected native runtime cannot retain output bytes")
        self.required_artifact_retention = required_artifact_retention
        self.temporary_placement = temporary_placement
        self.on_finalized = on_finalized
        self.native = native
        self.root = self.environment = self.identity = None
        self.supervisor_descriptor = None

    def __call__(self, root, environment):
        if self.root is not None:
            raise ValueError("A foreground process can own only one original supervisor")
        native = self.native
        if self.temporary_placement is not None:
            from native_receiving_storage import validate_temporary_placement, temporary_environment
            validate_temporary_placement(self.temporary_placement, refresh=True)
            expected = temporary_environment(self.temporary_placement, environment)
            if any(environment.get(key) != expected[key] for key in ("TMPDIR", "TMP", "TEMP")):
                raise ValueError("The original native command must retain its selected temporary environment")
        request = native.read_json(root / "request.json")
        if (not request or request.get("schema") != native.SCHEMA or
                native.run_path(request["intent"]["operation_id"], root.parent) != root):
            raise ValueError("The original native request does not match its retained record")
        if self.required_artifact_retention and request["intent"].get("retain_artifacts") is not True:
            raise ValueError("The native request did not retain the selected output-copy requirement")
        if any((root / name).exists() for name in
               ("process.json", "output.log", "command-completion.dat", "result.json", "stop-request.json")):
            raise ValueError("A dispatched or stopped operation cannot acquire another supervisor")
        descriptor = native.supervisor_lock_descriptor(root)
        try:
            if os.getpgrp() != os.getpid():
                os.setpgid(0, 0)
            identity = native.process_identity(os.getpid())
            if not identity:
                raise ValueError("The foreground process could not retain its original procfs identity")
            intent = request["intent"]
            # Keep capacity requests recoverable if the owner ends before exec.
            # The unchanged supervisor makes the actual admission decision.
            state = "queued_disk" if intent.get("disk") else "queued_memory" if intent.get("memory") else "starting"
            native.save_json(root / "state.json", {
                "state": state, "supervisor": identity, "supervisor_mode": "foreground",
                "acquired_at": native.now()})
        except BaseException:
            os.close(descriptor)
            raise
        self.root, self.environment, self.identity = root, dict(environment), identity
        self.supervisor_descriptor = descriptor

    def handoff(self):
        if self.root is None:
            return None
        native, root = self.native, self.root
        supervisor_descriptor = self.supervisor_descriptor
        if supervisor_descriptor is None:
            raise ValueError("The original foreground supervisor lock was already transferred")
        # The caller already emitted its bounded acknowledgement. A lost reader
        # does not cancel this acquired owner or release its lifetime lock.
        for stream in (sys.stdout, sys.stderr):
            try:
                stream.flush()
            except OSError:
                pass
        try:
            native.validate_supervisor_lock_descriptor(root, supervisor_descriptor)
            descriptor = os.open(root / "supervisor.log", os.O_CREAT | os.O_APPEND | os.O_WRONLY, 0o600)
            try:
                os.dup2(descriptor, 1)
                os.dup2(descriptor, 2)
            finally:
                os.close(descriptor)
            if self.on_finalized is None:
                environment = dict(self.environment)
                environment["SWARM_NATIVE_SUPERVISOR_LOCK_FD"] = str(supervisor_descriptor)
                os.set_inheritable(supervisor_descriptor, True)
                os.execve(sys.executable, [sys.executable, "-B", str(Path(__file__).resolve()),
                                          "_supervise", str(Path(native.__file__).resolve().parent),
                                          str(root)], environment)
        except OSError as exc:
            failure = {
                "state": "launch_failed", "ended_at": native.now(),
                "supervisor": self.identity, "error": type(exc).__name__,
                "stop_requested": False, "error_stage": "supervisor_handoff"}
            if type(exc.errno) is int:
                failure["errno"] = exc.errno
            try:
                native.save_json(root / "result.json", failure)
            finally:
                os.close(supervisor_descriptor)
                self.supervisor_descriptor = None
            return 127
        except BaseException:
            os.close(supervisor_descriptor)
            self.supervisor_descriptor = None
            raise

        # A callable cannot survive exec. Keep this same acquired process and
        # locked description through the source-owned finalizer instead.
        os.environ.clear()
        os.environ.update(self.environment)
        self.supervisor_descriptor = None
        return supervise_foreground(native, root, on_finalized=self.on_finalized,
                                    supervisor_descriptor=supervisor_descriptor)



def supervise_foreground(native, root, *, on_finalized=None, supervisor_descriptor=None):
    """Retain supervisor failures and return the original command outcome on completion."""
    code = native.supervise(root, on_finalized=on_finalized,
                            supervisor_descriptor=supervisor_descriptor)
    if code != 0:
        return code
    # A successful supervisor finalized its lifecycle, which can include a
    # failed command. Use the same result-to-exit mapping as native run/follow.
    # A competing or interrupted owner without a retained result is incomplete.
    result = native.read_json(root / "result.json")
    return native.exit_status(result) if result is not None else 75


def start_foreground(native, args, *, report_format="summary", on_finalized=None,
                     temporary_placement=None):
    """Start one reviewed native command in this same retained foreground.

    Validate requested retention before native.start can create its record.
    An older installed native runtime may otherwise ignore extra Namespace
    fields. Existing operation IDs continue through native.start unchanged.
    """
    if getattr(args, "queue_directory", None) is not None:
        raise ValueError("Continue a selected shared queue through its original launch path")
    retaining = getattr(args, "retain_artifacts", False)
    if type(retaining) is not bool:
        raise ValueError("Choose whether to retain original output copies")
    if retaining and getattr(native, "NATIVE_ARTIFACT_RETENTION_SCHEMA", None) != "commons.native-artifact-retention/v1":
        raise ValueError("The selected native runtime cannot retain output bytes; install its complete retention source before starting")
    if report_format not in ("summary", "full"):
        raise ValueError("Select summary or full for the original launch acknowledgement")
    launch = ForegroundLaunch(native, on_finalized=on_finalized,
                              temporary_placement=temporary_placement,
                              required_artifact_retention=retaining)
    try:
        report = native.start(args, launcher=launch)
        if launch.root is not None:
            from native_result_view import select
            print(json.dumps(select(report, report_format)), flush=True)
        return report
    finally:
        # A lost acknowledgement cannot abandon an already acquired native
        # supervisor. Preserve the same lifetime descriptor through handoff.
        if launch.root is not None:
            code = launch.handoff()
            if code is not None:
                raise SystemExit(code)


def resume_foreground(native, operation_id, records_root=None, *, action="resume-memory", recover_failure=None, report_format="full", queue_directory=None, on_finalized=None, temporary_placement=None):
    """Replace this process with the unchanged original supervisor after guarding its record.

    This is a CLI process handoff, not a background launcher or a library worker.
    A completed/running operation returns its existing observation instead.
    """
    root = native.run_path(operation_id, records_root)
    if action not in ("resume-memory", "resume-capacity"):
        raise ValueError("Select resume-memory or resume-capacity for the original queue")
    if not root.is_dir():
        raise ValueError("The original native operation does not exist")
    # The native recovery API owns registration, liveness reconciliation and
    # optional runtime/failure handoffs under the original record lock.
    if queue_directory is None:
        launch = ForegroundLaunch(native, on_finalized=on_finalized,
                                  temporary_placement=temporary_placement)
    else:
        if on_finalized is not None or temporary_placement is not None:
            raise ValueError("Continue the original placement and finalizer in its foreground process")
        from native_queue import QueueLaunch
        launch = QueueLaunch(native, queue_directory)
    try:
        options = {} if recover_failure is None else {"recover_failure": recover_failure}
        report = native.resume_capacity(root, require_memory=action == "resume-memory",
                                        launcher=launch, **options)
        if launch.root is not None:
            from native_result_view import select
            print(json.dumps(select(report, report_format)), flush=True)
        return report
    finally:
        # Acquisition remains owned even if writing the later handoff journal
        # or printing its acknowledgement fails.
        if launch.root is not None:
            code = launch.handoff()
            if code is not None:
                raise SystemExit(code)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("resume-memory", "resume-capacity", "amend-memory", "amend-disk",
                                           "review-runtime", "amend-runtime"))
    parser.add_argument("operation_id")
    parser.add_argument("--records-root", help="the same native records directory used at original launch")
    parser.add_argument("--report-format", choices=("summary", "full"), default="summary")
    parser.add_argument("--host-root", default=str(Path(__file__).resolve().parent),
                        help="existing native host runtime; defaults to this script's directory")
    parser.add_argument("--queue-directory",
                        help="existing private shared admission controller; resume actions only")
    parser.add_argument("--recover-failure", metavar="SHA256",
                        help="exact original pre-dispatch failure SHA-256 from native status")
    parser.add_argument("--amendment-id", help="stable identity of one explicit capacity declaration change")
    parser.add_argument("--expected-memory-sha256", help="SHA-256 of the exact retained memory intent")
    parser.add_argument("--memory-mib", type=int, help="new declared native peak; amend-memory only")
    parser.add_argument("--memory-reserve-mib", type=int, help="explicit new reserve; omitted preserves it")
    parser.add_argument("--memory-reclaim", choices=("none", "clean-cache"),
                        help="explicit original admission mode; omitted preserves it")
    parser.add_argument("--memory-storage", choices=("included", "additional"),
                        help="explicit original memory/storage contract; omitted preserves it")
    parser.add_argument("--expected-disk-sha256", help="SHA-256 of the exact retained disk intent")
    parser.add_argument("--disk-space", action="append", metavar="ABSOLUTE_PATH=MIB",
                        help="replace byte declarations with these paths; omitted preserves them")
    parser.add_argument("--disk-inodes", action="append", metavar="ABSOLUTE_PATH=COUNT",
                        help="replace inode declarations with these paths; omitted preserves them")
    parser.add_argument("--disk-reserve-mib", type=int, help="new filesystem reserve; omitted preserves it")
    parser.add_argument("--disk-reserve-inodes", type=int, help="new inode reserve; omitted preserves it")
    parser.add_argument("--runtime-path", action="append",
                        help="required replacement runtime paths; review-runtime/amend-runtime only")
    parser.add_argument("--optional-runtime-path", action="append",
                        help="replacement runtime paths that may be absent; review-runtime/amend-runtime only")
    parser.add_argument("--expected-runtime-selection-sha256",
                        help="exact selection returned by review-runtime")
    parser.add_argument("--reason", help="concrete reason for revising the original declaration")
    args = parser.parse_args(argv)
    try:
        native = load_native(args.host_root)
        if args.queue_directory is not None and args.action not in ("resume-memory", "resume-capacity"):
            raise ValueError("Select the shared queue only while resuming the original operation")
        memory_options = (args.expected_memory_sha256, args.memory_mib,
                          args.memory_reserve_mib, args.memory_reclaim, args.memory_storage)
        disk_options = (args.expected_disk_sha256, args.disk_space, args.disk_inodes,
                        args.disk_reserve_mib, args.disk_reserve_inodes)
        runtime_options = (args.runtime_path, args.optional_runtime_path,
                           args.expected_runtime_selection_sha256)
        if args.action in ("review-runtime", "amend-runtime"):
            if any(value is not None for value in (*memory_options, *disk_options, args.recover_failure)):
                raise ValueError("Runtime declaration review/amendment is separate from capacity changes and resume")
            import runtime_declarations
            root = native.run_path(args.operation_id, args.records_root)
            if args.action == "review-runtime":
                if any(value is not None for value in
                       (args.expected_runtime_selection_sha256, args.amendment_id, args.reason)):
                    raise ValueError("Review the complete replacement paths, then apply that exact selection")
                report = runtime_declarations.review_request(
                    root, selected_paths=args.runtime_path or [],
                    optional_paths=args.optional_runtime_path or [])
            else:
                report = runtime_declarations.amend_request(root, selected_paths=args.runtime_path or [],
                    optional_paths=args.optional_runtime_path or [], amendment_id=args.amendment_id,
                    expected_selection_sha256=args.expected_runtime_selection_sha256, reason=args.reason)
            print(json.dumps(report))
            return 0
        if any(value is not None for value in runtime_options):
            raise ValueError("Use review-runtime or amend-runtime for runtime declaration options")
        if args.action == "amend-memory":
            if args.recover_failure is not None:
                raise ValueError("Select the retained failure with resume-memory or resume-capacity")
            if any(value is not None for value in disk_options):
                raise ValueError("Use amend-disk for disk declarations")
            from cloud_memory import amend_request
            report = amend_request(native.run_path(args.operation_id, args.records_root),
                amendment_id=args.amendment_id, expected_memory_sha256=args.expected_memory_sha256,
                memory_mib=args.memory_mib, reserve_mib=args.memory_reserve_mib,
                reclaim_mode=args.memory_reclaim, storage_mode=args.memory_storage, reason=args.reason)
        elif args.action == "amend-disk":
            if args.recover_failure is not None:
                raise ValueError("Select the retained failure with resume-memory or resume-capacity")
            if any(value is not None for value in memory_options):
                raise ValueError("Use amend-memory for memory declarations")
            from cloud_disk import amend_request
            report = amend_request(native.run_path(args.operation_id, args.records_root),
                amendment_id=args.amendment_id, expected_disk_sha256=args.expected_disk_sha256,
                disk_space=args.disk_space, disk_inodes=args.disk_inodes,
                reserve_mib=args.disk_reserve_mib, reserve_inodes=args.disk_reserve_inodes,
                reason=args.reason)
        else:
            if any(value is not None for value in (*memory_options, *disk_options, args.amendment_id, args.reason)):
                raise ValueError("Use amend-memory or amend-disk for an explicit declaration change, then resume the same operation")
            report = resume_foreground(native, args.operation_id, args.records_root, action=args.action,
                                       recover_failure=args.recover_failure, report_format=args.report_format,
                                       queue_directory=args.queue_directory)
        from native_result_view import select
        print(json.dumps(select(report, args.report_format)))
        if args.action in ("resume-memory", "resume-capacity") and report["state"] in native.TERMINAL:
            return native.exit_status(report)
        return 0
    except (OSError, ValueError, KeyError, ImportError) as exc:
        print(json.dumps({"ok": False, "schema": SCHEMA, "error": type(exc).__name__,
                          "message": str(exc)}), file=sys.stderr)
        return 2


if __name__ == "__main__":
    if len(sys.argv) == 4 and sys.argv[1] == "_supervise":
        native = load_native(sys.argv[2])
        inherited_lock = os.environ.pop("SWARM_NATIVE_SUPERVISOR_LOCK_FD", None)
        raise SystemExit(supervise_foreground(native, Path(sys.argv[3]).resolve(),
            supervisor_descriptor=int(inherited_lock) if inherited_lock is not None else None))
    raise SystemExit(main())
