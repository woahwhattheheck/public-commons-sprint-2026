#!/usr/bin/env python3
"""Own one Windows build process tree, bound its memory, redirect to cloud.

Only a supplied offload adapter submits cloud work. The adapter consumes the
same immutable repo/head/argv spec; this wrapper never executes cloud argv on
the laptop. Import run_bounded(spec, offload_build) from the existing launcher.
"""
from __future__ import annotations

import argparse
import ctypes as C
from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
from typing import Callable

MIB = 1024 * 1024
DWORD, WORD, BOOL = C.c_uint32, C.c_uint16, C.c_int32
HANDLE, SIZE_T, ULONG_PTR = C.c_void_p, C.c_size_t, C.c_size_t


class MEMORYSTATUSEX(C.Structure):
    _fields_ = [("dwLength", DWORD), ("dwMemoryLoad", DWORD)] + [
        (name, C.c_uint64) for name in ("ullTotalPhys", "ullAvailPhys",
        "ullTotalPageFile", "ullAvailPageFile", "ullTotalVirtual",
        "ullAvailVirtual", "ullAvailExtendedVirtual")]


class BASIC_LIMIT(C.Structure):
    _fields_ = [("PerProcessUserTimeLimit", C.c_int64),
        ("PerJobUserTimeLimit", C.c_int64), ("LimitFlags", DWORD),
        ("MinimumWorkingSetSize", SIZE_T), ("MaximumWorkingSetSize", SIZE_T),
        ("ActiveProcessLimit", DWORD), ("Affinity", ULONG_PTR),
        ("PriorityClass", DWORD), ("SchedulingClass", DWORD)]


class IO_COUNTERS(C.Structure):
    _fields_ = [(name, C.c_uint64) for name in ("ReadOperationCount",
        "WriteOperationCount", "OtherOperationCount", "ReadTransferCount",
        "WriteTransferCount", "OtherTransferCount")]


class EXTENDED_LIMIT(C.Structure):
    _fields_ = [("BasicLimitInformation", BASIC_LIMIT), ("IoInfo", IO_COUNTERS),
        ("ProcessMemoryLimit", SIZE_T), ("JobMemoryLimit", SIZE_T),
        ("PeakProcessMemoryUsed", SIZE_T), ("PeakJobMemoryUsed", SIZE_T)]


class BASIC_ACCOUNTING(C.Structure):
    _fields_ = [(name, C.c_int64) for name in ("TotalUserTime", "TotalKernelTime",
        "ThisPeriodTotalUserTime", "ThisPeriodTotalKernelTime")] + [
        (name, DWORD) for name in ("TotalPageFaultCount", "TotalProcesses",
        "ActiveProcesses", "TotalTerminatedProcesses")]


class COMPLETION_ASSOCIATION(C.Structure):
    _fields_ = [("CompletionKey", C.c_void_p), ("CompletionPort", HANDLE)]


class NOTIFICATION_LIMIT(C.Structure):
    _fields_ = [("IoReadBytesLimit", C.c_uint64), ("IoWriteBytesLimit", C.c_uint64),
        ("PerJobUserTimeLimit", C.c_int64), ("JobMemoryLimit", C.c_uint64),
        ("RateControlTolerance", DWORD), ("RateControlToleranceInterval", DWORD),
        ("LimitFlags", DWORD)]


class LIMIT_VIOLATION(C.Structure):
    _fields_ = [("LimitFlags", DWORD), ("ViolationLimitFlags", DWORD)] + [
        (name, C.c_uint64) for name in ("IoReadBytes", "IoReadBytesLimit",
        "IoWriteBytes", "IoWriteBytesLimit", "PerJobUserTime",
        "PerJobUserTimeLimit", "JobMemory", "JobMemoryLimit")] + [
        ("RateControlTolerance", DWORD), ("RateControlToleranceLimit", DWORD)]


class STARTUPINFO(C.Structure):
    _fields_ = [("cb", DWORD), ("lpReserved", C.c_wchar_p),
        ("lpDesktop", C.c_wchar_p), ("lpTitle", C.c_wchar_p)] + [
        (name, DWORD) for name in ("dwX", "dwY", "dwXSize", "dwYSize",
        "dwXCountChars", "dwYCountChars", "dwFillAttribute", "dwFlags")] + [
        ("wShowWindow", WORD), ("cbReserved2", WORD), ("lpReserved2", C.c_void_p),
        ("hStdInput", HANDLE), ("hStdOutput", HANDLE), ("hStdError", HANDLE)]


class PROCESS_INFORMATION(C.Structure):
    _fields_ = [("hProcess", HANDLE), ("hThread", HANDLE),
        ("dwProcessId", DWORD), ("dwThreadId", DWORD)]


def cloud_spec(spec: dict) -> dict:
    """Serialize only portable, immutable fields; no cwd/env/host mounts."""
    if not isinstance(spec, dict):
        raise ValueError("job spec must be an object")
    repo, head, argv = spec.get("repo"), spec.get("head"), spec.get("argv")
    if not isinstance(repo, str) or not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repo):
        raise ValueError("repo must be owner/name")
    if not isinstance(head, str) or not re.fullmatch(r"[0-9a-fA-F]{40}", head):
        raise ValueError("head must be an immutable 40-character commit SHA")
    if not isinstance(argv, list) or not argv or any(
            not isinstance(s, str) or not s or "\0" in s for s in argv):
        raise ValueError("argv must be a nonempty list of nonempty strings")
    artifacts = spec.get("artifact_paths", [])
    if not isinstance(artifacts, list) or any(not isinstance(s, str) or not s or
            s.startswith(("/", "\\")) or "\\" in s or ":" in s or
            any(p in ("", "..") for p in s.split("/")) for s in artifacts):
        raise ValueError("artifact_paths must be repo-relative portable paths")
    result = {"repo": repo, "head": head.lower(), "argv": list(argv),
              "artifact_paths": list(artifacts)}
    for field in ("artifact_success_paths", "artifact_failure_paths"):
        paths = spec.get(field, [])
        if not isinstance(paths, list) or any(not isinstance(path, str) or not path or
                path.startswith(("/", "\\")) or "\\" in path or ":" in path or
                any(part in ("", "..") for part in path.split("/")) for path in paths):
            raise ValueError(field + " must contain repo-relative portable paths")
        if paths:
            result[field] = list(paths)
    operation = spec.get("operation_id")
    if operation is None:
        encoded = json.dumps(result, sort_keys=True, separators=(",", ":")).encode()
        operation = "bounded-" + hashlib.sha256(encoded).hexdigest()
    if not isinstance(operation, str) or not re.fullmatch(r"[A-Za-z0-9_.:-]{1,160}", operation):
        raise ValueError("operation_id must be a stable nonempty identifier")
    return {"schema": "commons.offload-build.v1", "operation_id": operation, **result}


def memory_ceiling(available: int, requested: int, floor: int) -> int:
    if any(isinstance(x, bool) or not isinstance(x, int) or x < 1
           for x in (available, requested, floor)):
        raise ValueError("memory byte values must be positive integers")
    # Leave headroom before creating any process, instead of oversubscribing
    # first and hoping a later heartbeat catches it.
    return max(0, min(requested, available - floor))


@dataclass
class LocalResult:
    reason: str
    exit_code: int | None = None
    peak_job_bytes: int | None = None
    minimum_available_bytes: int | None = None
    ceiling_bytes: int | None = None


class WindowsJob:
    """Native Job Object and suspended-launch owner (Windows 8+)."""
    def __init__(self):
        if os.name != "nt":
            raise OSError("Windows Job Objects unavailable on this platform")
        self.k = C.WinDLL("kernel32", use_last_error=True)
        prototypes = {
            "CreateJobObjectW": (HANDLE, [C.c_void_p, C.c_wchar_p]),
            "CreateIoCompletionPort": (HANDLE, [HANDLE, HANDLE, ULONG_PTR, DWORD]),
            "SetInformationJobObject": (BOOL, [HANDLE, C.c_int, C.c_void_p, DWORD]),
            "QueryInformationJobObject": (BOOL, [HANDLE, C.c_int, C.c_void_p, DWORD, C.c_void_p]),
            "CreateProcessW": (BOOL, [C.c_wchar_p, C.c_wchar_p, C.c_void_p,
                C.c_void_p, BOOL, DWORD, C.c_void_p, C.c_wchar_p,
                C.POINTER(STARTUPINFO), C.POINTER(PROCESS_INFORMATION)]),
            "AssignProcessToJobObject": (BOOL, [HANDLE, HANDLE]),
            "ResumeThread": (DWORD, [HANDLE]),
            "GetQueuedCompletionStatus": (BOOL, [HANDLE, C.POINTER(DWORD),
                C.POINTER(ULONG_PTR), C.POINTER(C.c_void_p), DWORD]),
            "GlobalMemoryStatusEx": (BOOL, [C.POINTER(MEMORYSTATUSEX)]),
            "GetExitCodeProcess": (BOOL, [HANDLE, C.POINTER(DWORD)]),
            "WaitForSingleObject": (DWORD, [HANDLE, DWORD]),
            "TerminateProcess": (BOOL, [HANDLE, DWORD]),
            "TerminateJobObject": (BOOL, [HANDLE, DWORD]),
            "GetStdHandle": (HANDLE, [DWORD]),
            "CloseHandle": (BOOL, [HANDLE]),
        }
        for name, (restype, argtypes) in prototypes.items():
            func = getattr(self.k, name)
            func.restype, func.argtypes = restype, argtypes
        self.job = self.port = None
        self.proc = PROCESS_INFORMATION()
        self.assigned = False

    def checked(self, success):
        if not success:
            raise C.WinError(C.get_last_error())
        return success

    def available(self) -> int:
        mem = MEMORYSTATUSEX()
        mem.dwLength = C.sizeof(mem)
        self.checked(self.k.GlobalMemoryStatusEx(C.byref(mem)))
        return int(mem.ullAvailPhys)

    def _set(self, kind, value):
        self.checked(self.k.SetInformationJobObject(
            self.job, kind, C.byref(value), C.sizeof(value)))

    def _query(self, kind, structure):
        value = structure()
        self.checked(self.k.QueryInformationJobObject(
            self.job, kind, C.byref(value), C.sizeof(value), None))
        return value

    def launch(self, argv, cwd, ceiling):
        self.job = self.checked(self.k.CreateJobObjectW(None, None))
        self.port = self.checked(self.k.CreateIoCompletionPort(
            HANDLE(-1), None, 0, 1))
        limits = EXTENDED_LIMIT()
        # No breakaway flags: descendants remain in this exact owned tree.
        limits.BasicLimitInformation.LimitFlags = 0x100 | 0x200 | 0x2000
        limits.ProcessMemoryLimit = limits.JobMemoryLimit = ceiling
        self._set(9, limits)  # JobObjectExtendedLimitInformation
        self._set(7, COMPLETION_ASSOCIATION(1, self.port))
        # Hard-limit messages can be dropped. Notification-limit messages are
        # guaranteed; start the redirect before the hard ceiling is reached.
        notice = NOTIFICATION_LIMIT()
        notice.LimitFlags = 0x200
        notice.JobMemoryLimit = ceiling * 9 // 10
        self._set(12, notice)  # JobObjectNotificationLimitInformation
        startup = STARTUPINFO()
        startup.cb = C.sizeof(startup)
        std = [self.k.GetStdHandle(DWORD(n).value) for n in (-10, -11, -12)]
        if all(h not in (None, HANDLE(-1).value) for h in std):
            startup.dwFlags = 0x100  # STARTF_USESTDHANDLES: preserve live logs.
            startup.hStdInput, startup.hStdOutput, startup.hStdError = std
        cmd = C.create_unicode_buffer(subprocess.list2cmdline(argv))
        self.checked(self.k.CreateProcessW(None, cmd, None, None, True,
            0x4, None, str(cwd), C.byref(startup), C.byref(self.proc)))
        # If assignment fails, close() kills the still-suspended process. It
        # never falls back to an unbounded local launch.
        self.checked(self.k.AssignProcessToJobObject(self.job, self.proc.hProcess))
        self.assigned = True
        if self.k.ResumeThread(self.proc.hThread) == 0xFFFFFFFF:
            raise C.WinError(C.get_last_error())

    def _message(self, timeout_ms):
        code, key, detail = DWORD(), ULONG_PTR(), C.c_void_p()
        ok = self.k.GetQueuedCompletionStatus(self.port, C.byref(code),
            C.byref(key), C.byref(detail), timeout_ms)
        if not ok:
            error = C.get_last_error()
            if error != 258:  # WAIT_TIMEOUT
                raise C.WinError(error)
            return None
        return code.value

    def monitor(self, floor, ceiling, initial_available, reservation_check=None):
        minimum = initial_available
        reason = "LOCAL_COMPLETED"
        while True:
            if reservation_check is not None and not reservation_check():
                reason = "LOCAL_RESERVATION_LOST"
                self.checked(self.k.TerminateJobObject(self.job, 1))
                break
            # Drain queued violations BEFORE inspecting root exit. Allocation
            # failure may make a child exit immediately after a limit event.
            message = self._message(100)
            while message is not None:
                if message in (9, 10):
                    reason = "JOB_MEMORY_LIMIT"
                    break
                if message == 11 and self._query(13, LIMIT_VIOLATION).ViolationLimitFlags & 0x200:
                    reason = "JOB_MEMORY_NOTIFICATION"
                    break
                message = self._message(0)
            if reason != "LOCAL_COMPLETED":
                self.checked(self.k.TerminateJobObject(self.job, 0xC0000017))
                break
            available = self.available()
            minimum = min(minimum, available)
            if available < floor:
                reason = "HOST_HEADROOM_FLOOR"
                self.checked(self.k.TerminateJobObject(self.job, 0xC0000017))
                break
            # Root exit alone is not completion: compilers can leave children.
            if self._query(1, BASIC_ACCOUNTING).ActiveProcesses == 0:
                if self._query(13, LIMIT_VIOLATION).ViolationLimitFlags & 0x200:
                    reason = "JOB_MEMORY_NOTIFICATION"
                break
        self.k.WaitForSingleObject(self.proc.hProcess, 1000)
        exit_code = DWORD()
        self.checked(self.k.GetExitCodeProcess(self.proc.hProcess, C.byref(exit_code)))
        peak = self._query(9, EXTENDED_LIMIT).PeakJobMemoryUsed
        if reason == "LOCAL_COMPLETED" and exit_code.value == 0xC0000017:
            reason = "PROCESS_NO_MEMORY"
        return LocalResult(reason, int(exit_code.value), int(peak), minimum, ceiling)

    def close(self):
        # KILL_ON_JOB_CLOSE applies only to this wrapper's job. If the process
        # never reached assignment, terminate that suspended process directly.
        if self.proc.hProcess and not self.assigned:
            self.k.TerminateProcess(self.proc.hProcess, 1)
        for handle in (self.job, self.proc.hThread, self.proc.hProcess, self.port):
            if handle:
                self.k.CloseHandle(handle)
        self.job = self.port = None
        self.proc = PROCESS_INFORMATION()


def run_local(spec, requested, floor, reservation_check=None) -> LocalResult:
    job = WindowsJob()
    try:
        available = job.available()
        ceiling = memory_ceiling(available, requested, floor)
        if ceiling < 64 * MIB:
            return LocalResult("INSUFFICIENT_HEADROOM", minimum_available_bytes=available,
                               ceiling_bytes=ceiling)
        # Explicit local_argv permits Windows-specific interpreter names;
        # portable argv remains unchanged in the cloud submission.
        argv = spec.get("local_argv", spec["argv"])
        if not isinstance(argv, list) or not argv or any(
                not isinstance(x, str) or not x or "\0" in x for x in argv):
            raise ValueError("local_argv must be a nonempty string array")
        cwd = Path(spec.get("local_cwd", ".")).resolve(strict=True)
        if not cwd.is_dir():
            raise ValueError("local_cwd must be a directory")
        # A Git-visible dirty/different tree is not the immutable cloud source.
        # Read only; never checkout, fetch, reset, or copy onto the laptop.
        head = subprocess.run(["git", "-C", str(cwd), "rev-parse", "HEAD"],
            text=True, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            check=False, timeout=5)
        dirty = subprocess.run(["git", "-C", str(cwd), "status", "--porcelain",
            "--untracked-files=all"], text=True, stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL, check=False, timeout=5)
        if head.returncode or dirty.returncode or dirty.stdout or head.stdout.strip().lower() != spec["head"].lower():
            return LocalResult("LOCAL_SOURCE_MISMATCH")
        available = job.available()
        ceiling = memory_ceiling(available, requested, floor)
        if ceiling < 64 * MIB:
            return LocalResult("INSUFFICIENT_HEADROOM", minimum_available_bytes=available,
                               ceiling_bytes=ceiling)
        if reservation_check is not None and not reservation_check():
            return LocalResult("LOCAL_RESERVATION_LOST", minimum_available_bytes=available,
                               ceiling_bytes=ceiling)
        job.launch(argv, cwd, ceiling)
        return job.monitor(floor, ceiling, available, reservation_check)
    finally:
        job.close()


def cloud_acknowledgement(portable: dict, cloud: dict) -> dict:
    """Validate one original adapter acknowledgement for both dispatch roads."""
    if not isinstance(cloud, dict) or cloud.get("operation_id") != portable["operation_id"]:
        raise ValueError("cloud adapter must return the same operation_id")
    status = cloud.get("status")
    if status not in ("queued", "running", "completed", "failed"):
        raise ValueError("cloud adapter status must be queued/running/completed/failed")
    allowed = ("operation_id", "status", "job_id", "artifact_handle", "exit_code")
    for key, maximum in (("job_id", 512), ("artifact_handle", 4096)):
        if key in cloud and (not isinstance(cloud[key], str) or not cloud[key]
                or len(cloud[key]) > maximum or any(c in cloud[key] for c in "\0\r\n")):
            raise ValueError("cloud receipt identifiers must be bounded single-line strings")
    if "exit_code" in cloud and (type(cloud["exit_code"]) is not int or
            not -(2 ** 31) <= cloud["exit_code"] <= 2 ** 32 - 1):
        raise ValueError("cloud exit_code must be an integer process code")
    if status in ("queued", "running") and not cloud.get("job_id"):
        raise ValueError("acknowledged queued/running work requires job_id")
    if status == "completed" and (type(cloud.get("exit_code")) is not int or
            cloud["exit_code"] != 0 or not isinstance(cloud.get("artifact_handle"), str)
            or not cloud["artifact_handle"]):
        raise ValueError("completed cloud receipt requires exit_code=0 and artifact_handle")
    return {k: cloud[k] for k in allowed if k in cloud}


def run_bounded(spec: dict, offload_build: Callable[[dict], dict], *,
                memory_mib: int = 768, floor_mib: int = 1024,
                receipt_path: Path | None = None,
                reservation_check: Callable[[], bool] | None = None) -> dict:
    portable = cloud_spec(spec)
    if not callable(offload_build):
        raise ValueError("an existing cloud offload adapter is required")
    if reservation_check is not None and not callable(reservation_check):
        raise ValueError("reservation_check must be callable when supplied")
    if any(isinstance(x, bool) or not isinstance(x, int) or x < 1
           for x in (memory_mib, floor_mib)):
        raise ValueError("memory_mib and floor_mib must be positive integers")
    try:
        local = run_local(spec, memory_mib * MIB, floor_mib * MIB, reservation_check)
    except (OSError, subprocess.TimeoutExpired) as exc:
        # Native setup/measurement unavailable: never launch unbounded. Keep
        # a numeric OS code instead of arbitrary exception text in receipts.
        local = LocalResult("LOCAL_BOUND_UNAVAILABLE")
        local_error = getattr(exc, "winerror", None) or getattr(exc, "errno", None)
    else:
        local_error = None
    receipt = {"schema": "commons.bounded-build.v1",
        "operation_id": portable["operation_id"], "repo": portable["repo"],
        "head": portable["head"], "local": vars(local), "local_error": local_error}
    if local.reason == "LOCAL_COMPLETED":
        receipt.update(status="LOCAL_COMPLETED" if local.exit_code == 0 else "LOCAL_FAILED",
                       exit_code=local.exit_code)
        if receipt_path:
            save_receipt(Path(receipt_path), receipt)
        return receipt
    receipt["status"] = "CLOUD_SUBMITTING"
    if receipt_path:
        save_receipt(Path(receipt_path), receipt)
    # No repeated invocation when acknowledgement is uncertain. The adapter
    # owns durable single-flight/provider reconciliation for this operation.
    try:
        cloud = offload_build(portable)
        receipt["cloud"] = cloud_acknowledgement(portable, cloud)
        receipt["status"] = "CLOUD_" + receipt["cloud"]["status"].upper()
    except Exception as exc:
        # A timeout/malformed acknowledgement can follow a real submission.
        # Preserve the operation for provider reconciliation, never re-submit.
        receipt.update(status="CLOUD_UNCONFIRMED", adapter_error=type(exc).__name__)
    if receipt_path:
        save_receipt(Path(receipt_path), receipt)
    return receipt


def command_adapter(argv: list[str]) -> Callable[[dict], dict]:
    if not isinstance(argv, list) or not argv or any(
            not isinstance(x, str) or not x or "\0" in x for x in argv):
        raise ValueError("offload command must be a nonempty argv array")

    def submit(spec):
        # Invoke the existing lightweight dispatcher, never the heavy job.
        process = subprocess.run(argv, input=json.dumps(spec), text=True,
            stdout=subprocess.PIPE, check=False, timeout=60, shell=False)
        if process.returncode:
            raise RuntimeError("offload adapter failed: exit=" + str(process.returncode))
        if len(process.stdout) > 32768:
            raise ValueError("offload acknowledgement exceeds 32 KiB")
        return json.loads(process.stdout)
    return submit


def save_receipt(path: Path, result):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp = tempfile.mkstemp(prefix=".bounded-", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(result, handle, sort_keys=True, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp, path)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--spec", type=Path, required=True)
    parser.add_argument("--offload-command-json", required=True,
                        help="Existing dispatcher argv as JSON; portable job JSON on stdin")
    parser.add_argument("--memory-mib", type=int, default=768)
    parser.add_argument("--floor-mib", type=int, default=1024)
    parser.add_argument("--receipt", type=Path)
    args = parser.parse_args(argv)
    result = run_bounded(json.loads(args.spec.read_text(encoding="utf-8")),
        command_adapter(json.loads(args.offload_command_json)),
        memory_mib=args.memory_mib, floor_mib=args.floor_mib, receipt_path=args.receipt)
    print(json.dumps(result, sort_keys=True))
    if result["status"] in ("LOCAL_COMPLETED", "CLOUD_COMPLETED"):
        return 0
    if result["status"] in ("CLOUD_QUEUED", "CLOUD_RUNNING"):
        return 75  # Submission acknowledged; completion remains asynchronous.
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
