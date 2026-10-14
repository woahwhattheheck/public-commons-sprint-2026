"""Read native Windows/macOS capacity without optional packages or host changes.

Windows uses quota-aware 64-bit volume counters and current process commit
availability. macOS uses the installed one-shot vm_stat, including its reported
page size, rather than assuming Intel's page size on Apple Silicon.
"""
from __future__ import annotations

import ctypes as C
import os
from pathlib import Path
import re
import subprocess


class _MemoryStatus(C.Structure):
    _fields_ = [("length", C.c_uint32), ("load", C.c_uint32)] + [
        (name, C.c_uint64) for name in (
            "total_phys", "avail_phys", "total_commit", "avail_commit",
            "total_virtual", "avail_virtual", "extended")]


def _kernel():
    return C.WinDLL("kernel32", use_last_error=True)


def _function(library, name, arguments, result=C.c_int32):
    function = getattr(library, name)
    function.argtypes, function.restype = arguments, result
    return function


def windows_filesystem(probe):
    """Observe the resolved destination directory, including UNC/mounted volumes."""
    kernel = _kernel()
    pointer = C.POINTER(C.c_uint64)
    available, total, free = C.c_uint64(), C.c_uint64(), C.c_uint64()
    # GetDiskFreeSpaceExW accepts directories, not file names. Trailing slash is
    # required for a UNC share root and harmless for an existing subdirectory.
    directory = str(probe).rstrip("\\/") + "\\"
    space = _function(kernel, "GetDiskFreeSpaceExW", [C.c_wchar_p, pointer, pointer, pointer])
    if not space(directory, C.byref(available), C.byref(total), C.byref(free)):
        raise C.WinError(C.get_last_error())
    volume = C.create_unicode_buffer(32768)
    volume_path = _function(kernel, "GetVolumePathNameW", [C.c_wchar_p, C.c_wchar_p, C.c_uint32])
    metadata = {"mountpoint": None, "filesystem": None, "memory_backed": None,
                "read_only": False, "read_only_observed": False,
                "allocation_unit_bytes": None, "available_inodes": None}
    # Remote filesystem servers may supply capacity but not volume-management
    # metadata. Keep the usable capacity instead of treating that as zero space.
    if volume_path(directory, volume, len(volume)):
        root = volume.value.rstrip("\\/") + "\\"
        metadata["mountpoint"] = root
        drive_type = _function(kernel, "GetDriveTypeW", [C.c_wchar_p], C.c_uint32)(root)
        metadata["drive_type"] = drive_type
        metadata["memory_backed"] = True if drive_type == 6 else False if drive_type in (2, 3, 4, 5) else None
        flags = C.c_uint32()
        name = C.create_unicode_buffer(256)
        dword = C.POINTER(C.c_uint32)
        info = _function(kernel, "GetVolumeInformationW", [
            C.c_wchar_p, C.c_wchar_p, C.c_uint32, dword, dword, dword, C.c_wchar_p, C.c_uint32])
        if info(root, None, 0, None, None, C.byref(flags), name, len(name)):
            metadata.update(filesystem=name.value, read_only=bool(flags.value & 0x80000),
                            read_only_observed=True)
        sectors, unit = C.c_uint32(), C.c_uint32()
        clusters, count = C.c_uint32(), C.c_uint32()
        geometry = _function(kernel, "GetDiskFreeSpaceW", [C.c_wchar_p, dword, dword, dword, dword])
        if geometry(root, C.byref(sectors), C.byref(unit), C.byref(clusters), C.byref(count)):
            metadata["allocation_unit_bytes"] = sectors.value * unit.value
    return {**metadata, "total_bytes": total.value, "available_bytes": available.value,
            "free_including_reserved_bytes": free.value,
            "reserved_bytes": max(0, free.value - available.value),
            "accounting": "GetDiskFreeSpaceExW caller quota; optional native volume metadata"}


def _memory_result(total, available, accounting, **extra):
    return {"host_total_bytes": total, "host_available_bytes": available,
            "effective_available_bytes": available, "limiting_cgroup": None,
            "cgroups": [], "accounting": accounting, **extra}


def windows_memory():
    value = _MemoryStatus()
    value.length = C.sizeof(value)
    function = _function(_kernel(), "GlobalMemoryStatusEx", [C.POINTER(_MemoryStatus)])
    if not function(C.byref(value)):
        raise C.WinError(C.get_last_error())
    result = _memory_result(value.total_phys, value.avail_phys,
                           "GlobalMemoryStatusEx; minimum physical, process commit and virtual availability",
                           process_commit_available_bytes=value.avail_commit,
                           process_virtual_available_bytes=value.avail_virtual)
    result["effective_available_bytes"] = min(value.avail_phys, value.avail_commit, value.avail_virtual)
    return result


def _command(arguments):
    return subprocess.run(arguments, check=True, stdin=subprocess.DEVNULL,
                          stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                          text=True, encoding="utf-8", timeout=5,
                          env={**os.environ, "LC_ALL": "C", "LANG": "C"}).stdout


def _darwin_memory_values(text, total):
    page_match = re.search(r"page size of ([0-9]+) bytes", text)
    if not page_match or int(page_match[1]) <= 0 or total <= 0:
        raise ValueError("macOS did not return its native memory page size and total")
    page_size = int(page_match[1])
    fields = {key: int(value) for key, value in
              re.findall(r"^([^:\n]+):\s*([0-9]+)\.?\s*$", text, re.MULTILINE)}
    if not {"Pages free", "Pages inactive", "Pages speculative"} <= fields.keys():
        raise ValueError("macOS vm_stat omitted native page counters")
    # Apple's vm_stat prints free_count MINUS speculative_count. Add speculative
    # once, not twice. Inactive is an estimate of reclaimable pages; purgeable,
    # anonymous and compressed counts overlap other classes and are not added.
    free = (fields["Pages free"] + fields["Pages speculative"]) * page_size
    inactive = fields["Pages inactive"] * page_size
    return _memory_result(total, min(total, free + inactive),
                          "vm_stat free plus speculative plus inactive pages; reclaimability estimate",
                          page_size_bytes=page_size, free_bytes=free, inactive_bytes=inactive,
                          availability_is_estimate=True)


def darwin_memory():
    total = int(_command(["/usr/sbin/sysctl", "-n", "hw.memsize"]).strip())
    return _darwin_memory_values(_command(["/usr/bin/vm_stat"]), total)


def native_memory(platform):
    try:
        return windows_memory() if platform == "win32" else darwin_memory()
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        # Failure to observe is not an observed exhaustion. The existing writer
        # still handles real disk/OS errors and retains its committed prefix.
        return _memory_result(None, None, "Native memory observation unavailable",
                              observation_error=type(error).__name__ + ": " + str(error))
