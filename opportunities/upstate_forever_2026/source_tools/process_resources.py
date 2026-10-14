"""Optional native process-memory observations, always recorded in bytes.

This module neither controls processes nor chooses scientific execution settings.
Process-lifetime peaks are not per-stage allocation measurements. A caller
observing another PID must check its recorded process identity before and after.
Only the stdlib is required, including when this source travels with a grid export.
"""
from __future__ import annotations

import ctypes
from functools import lru_cache
import json
import os
from pathlib import Path
import shutil
import sys
from typing import Callable, Mapping

MIB = 1024 * 1024


class _MemoryCounters(ctypes.Structure):
    # DWORD remains 32 bits on Win64; SIZE_T follows the native pointer width.
    _fields_ = [("cb", ctypes.c_uint32), ("PageFaultCount", ctypes.c_uint32)] + [
        (name, ctypes.c_size_t) for name in (
            "PeakWorkingSetSize", "WorkingSetSize", "QuotaPeakPagedPoolUsage",
            "QuotaPagedPoolUsage", "QuotaPeakNonPagedPoolUsage",
            "QuotaNonPagedPoolUsage", "PagefileUsage", "PeakPagefileUsage",
            "PrivateUsage")]


@lru_cache(maxsize=1)
def _windows_api():
    api = ctypes.WinDLL("kernel32", use_last_error=True)
    api.GetCurrentProcess.argtypes = []
    api.GetCurrentProcess.restype = ctypes.c_void_p
    api.OpenProcess.argtypes = [ctypes.c_uint32, ctypes.c_int, ctypes.c_uint32]
    api.OpenProcess.restype = ctypes.c_void_p
    api.CloseHandle.argtypes = [ctypes.c_void_p]
    api.CloseHandle.restype = ctypes.c_int
    api.K32GetProcessMemoryInfo.argtypes = [
        ctypes.c_void_p, ctypes.POINTER(_MemoryCounters), ctypes.c_uint32]
    api.K32GetProcessMemoryInfo.restype = ctypes.c_int
    return api


def _windows_memory(pid: int) -> dict:
    api = _windows_api()
    current = pid == os.getpid()
    handle = api.GetCurrentProcess() if current else api.OpenProcess(0x1000, False, pid)
    if not handle:
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        counters = _MemoryCounters()
        counters.cb = ctypes.sizeof(counters)
        if not api.K32GetProcessMemoryInfo(handle, ctypes.byref(counters), counters.cb):
            raise ctypes.WinError(ctypes.get_last_error())
        # PrivateUsage is committed private memory, NOT virtual address-space
        # size and NOT resident memory. Preserve those distinct meanings.
        return {
            "source": "K32GetProcessMemoryInfo",
            "resident_bytes": int(counters.WorkingSetSize),
            "peak_resident_bytes": int(counters.PeakWorkingSetSize),
            "private_commit_bytes": int(counters.PrivateUsage),
            "peak_private_commit_bytes": int(counters.PeakPagefileUsage),
            "page_faults": int(counters.PageFaultCount),
        }
    finally:
        if not current:
            api.CloseHandle(handle)


def _linux_memory(pid: int) -> dict:
    source = Path("/proc") / ("self" if pid == os.getpid() else str(pid)) / "status"
    result = {"source": "/proc/pid/status"}
    names = {"VmRSS": "resident_bytes", "VmHWM": "peak_resident_bytes",
             "VmSize": "virtual_bytes"}
    for line in source.read_text(encoding="utf-8").splitlines():
        name, _, raw = line.partition(":")
        fields = raw.split()
        if name in names and len(fields) == 2 and fields[1] == "kB":
            result[names[name]] = int(fields[0]) * 1024
        elif name == "Threads":
            result["threads"] = int(raw)
    return result


def _rusage_bytes(value: int, platform: str) -> int:
    """Normalize the two supported POSIX ABIs without guessing other systems."""
    if type(value) is not int or value < 0:
        raise ValueError("Invalid native peak-resident counter")
    if platform == "darwin":
        return value
    if platform.startswith("linux"):
        return value * 1024
    raise NotImplementedError("Peak-resident units are not declared for this platform")


def process_memory(pid: int | None = None, *,
                   darwin_reader: Callable[[], Mapping] | None = None) -> dict:
    """Observe a native process; unavailable counters are omitted, never zeroed.

    The application supplies its maintained identity-aware Mac task reader.
    Standalone copied grid tools need only the current-process rusage peak.
    Observation errors remain metadata so they cannot replace scientific errors.
    """
    pid = os.getpid() if pid is None else pid
    result = {"pid": pid, "platform": sys.platform, "memory_unit": "bytes"}
    errors = []

    def problem(source: str, error: Exception) -> None:
        errors.append({"source": source, "type": type(error).__name__})

    if type(pid) is not int or not 0 < pid <= 0xFFFFFFFF:
        problem("process-memory", ValueError("Invalid PID"))
    else:
        try:
            if sys.platform == "win32":
                result.update(_windows_memory(pid))
            elif sys.platform.startswith("linux"):
                result.update(_linux_memory(pid))
            elif sys.platform == "darwin":
                if darwin_reader is not None:
                    observed = dict(darwin_reader())
                    for key in ("resident_bytes", "virtual_bytes", "threads"):
                        value = observed.get(key)
                        if type(value) is int and value >= 0:
                            result[key] = value
                    result["source"] = "libproc/PROC_PIDTASKINFO"
                else:
                    result["source"] = "getrusage/RUSAGE_SELF"
            else:
                raise NotImplementedError("Process-memory observer is unavailable")
        except Exception as error:
            problem("process-memory", error)
        if pid == os.getpid() and (sys.platform == "darwin" or sys.platform.startswith("linux")):
            try:
                import resource
                peak = _rusage_bytes(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
                                     sys.platform)
                result["peak_resident_bytes"] = peak
                result["peak_source"] = "getrusage/RUSAGE_SELF"
            except Exception as error:
                problem("getrusage/RUSAGE_SELF", error)
    # Existing execution receipts and screens consume these byte aliases.
    # VmSize is supplied ONLY for an actual virtual-address-space counter.
    for canonical, legacy in (("resident_bytes", "VmRSS_bytes"),
                              ("peak_resident_bytes", "VmHWM_bytes"),
                              ("virtual_bytes", "VmSize_bytes")):
        if canonical in result:
            result[legacy] = result[canonical]
    if errors:
        result["read_errors"] = errors
    return result


def peak_memory() -> dict:
    """Return one process-lifetime peak observation for a completed tool result."""
    observed = process_memory()
    value = observed.get("peak_resident_bytes")
    result = {"peak_rss_bytes": value,
              "peak_rss_mib": round(value / MIB, 3) if value is not None else None,
              "memory_unit": "MiB", "memory_platform": sys.platform,
              "memory_source": observed.get("peak_source", observed.get("source"))}
    if observed.get("read_errors"):
        result["memory_read_errors"] = observed["read_errors"]
    return result


def retain_source(directory: Path) -> None:
    """Retain the exact observer beside exported standalone compiler sources."""
    source = Path(__file__).resolve()
    destination = Path(directory) / source.name
    if destination.resolve() != source:
        shutil.copy2(source, destination)


if __name__ == "__main__":
    print(json.dumps(process_memory(), ensure_ascii=False, allow_nan=False, indent=2))
