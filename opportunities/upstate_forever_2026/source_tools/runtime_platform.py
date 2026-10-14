"""Platform selection and native filesystem adapters for offline runtime receiving.

This module has no third-party dependencies and can run before InVEST is unpacked.
Windows file operations reuse the application's maintained Win32 implementation.
"""
from __future__ import annotations

from functools import lru_cache
import hashlib
import importlib.util
import os
from pathlib import Path, PurePosixPath
import platform
import re
import stat
import struct
import subprocess
import unicodedata

SCHEMA_V2 = 'upstate.offline-native-runtime/v2'
TARGETS = {
    'linux-x86_64': {'system': 'Linux', 'machine': 'x86_64'},
    'windows-x86_64': {'system': 'Windows', 'machine': 'x86_64'},
    'macos-x86_64': {'system': 'Darwin', 'machine': 'x86_64'},
    'macos-arm64': {'system': 'Darwin', 'machine': 'arm64'},
}


def target_id(system: str, machine: str) -> str:
    if not isinstance(system, str) or not isinstance(machine, str):
        raise ValueError('Runtime OS and CPU names must be strings.')
    system = {'macos': 'Darwin', 'darwin': 'Darwin', 'windows': 'Windows',
              'linux': 'Linux'}.get(system.lower(), system)
    machine = {'amd64': 'x86_64', 'aarch64': 'arm64'}.get(machine.lower(), machine.lower())
    for key, value in TARGETS.items():
        if value == {'system': system, 'machine': machine}:
            return key
    raise ValueError(f'No supplied scientific runtime supports {system} {machine}.')


def host_target() -> str:
    system, machine = platform.system(), platform.machine()
    if system == 'Darwin' and machine.lower() in ('x86_64', 'amd64'):
        # A bootstrap running under Rosetta must still select native Apple Silicon.
        try:
            arm = subprocess.run(['/usr/sbin/sysctl', '-n', 'hw.optional.arm64'],
                                 capture_output=True, text=True, timeout=3, check=False)
            if arm.returncode == 0 and arm.stdout.strip() == '1':
                machine = 'arm64'
        except (OSError, subprocess.TimeoutExpired):
            pass
    if system == 'Windows':
        machine = os.environ.get('PROCESSOR_ARCHITEW6432', machine)
    return target_id(system, machine)


def relative(value: str, *, empty: bool = False) -> str:
    if empty and value in ('', '.'):
        return ''
    if (not isinstance(value, str) or not value or '\\' in value or ':' in value
            or any(ord(c) < 32 for c in value)):
        raise ValueError('Runtime paths must be nonempty, relative POSIX paths.')
    path = PurePosixPath(value)
    if path.is_absolute() or '..' in path.parts or not path.parts:
        raise ValueError('Runtime paths must remain inside their supplied directory.')
    return path.as_posix()


def minimum_os(spec: dict) -> None:
    minimum = spec.get('minimum_os_version')
    if not minimum:
        return
    system = spec['platform']['system']
    if system == 'Darwin':
        actual = platform.mac_ver()[0]
    elif system == 'Windows':
        actual = platform.win32_ver()[1]
    else:
        # Linux compatibility is a libc/toolchain property, not a macOS version.
        raise ValueError('Use minimum_glibc_version, not minimum_os_version, for Linux.')
    def version(value):
        if not re.fullmatch(r'\d+(?:\.\d+)*', str(value)):
            raise ValueError('Cannot determine the OS version required by this runtime.')
        return tuple(int(part) for part in str(value).split('.'))
    wanted, running = version(minimum), version(actual)
    width = max(len(wanted), len(running))
    if running + (0,) * (width-len(running)) < wanted + (0,) * (width-len(wanted)):
        raise ValueError(f'This runtime requires {system} {minimum} or later; this computer is {actual}.')


def default_storage(system: str | None = None) -> Path:
    system = system or platform.system()
    if system == 'Windows':
        home = Path(os.environ.get('LOCALAPPDATA') or Path.home() / 'AppData/Local')
        return home / 'Ecosystem Workbench/runtimes'
    if system == 'Darwin':
        return Path.home() / 'Library/Application Support/Ecosystem Workbench/runtimes'
    return Path(os.environ.get('XDG_DATA_HOME') or Path.home() / '.local/share') / 'ecosystem-workbench/runtimes'


@lru_cache(maxsize=1)
def windows_fs():
    source = Path(__file__).resolve().parents[1] / 'model/windows_fs.py'
    spec = importlib.util.spec_from_file_location('_ecosystem_runtime_windows_fs', source)
    if spec is None or spec.loader is None:
        raise ImportError('Receive the maintained model/windows_fs.py with this application.')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def native_path(path: Path) -> Path:
    return windows_fs().native_path(path) if os.name == 'nt' else path


def linked(path: Path) -> bool:
    try:
        value = path.lstat()
    except FileNotFoundError:
        return False
    return stat.S_ISLNK(value.st_mode) or bool(getattr(value, 'st_file_attributes', 0) & 0x400)


def open_file(path: Path, flags: int, mode: int = 0o600) -> int:
    if os.name == 'nt':
        return windows_fs().no_follow_open(path, flags, mode)
    return os.open(path, flags | getattr(os, 'O_NOFOLLOW', 0), mode)


def replace(source: Path, destination: Path) -> None:
    if os.name == 'nt':
        windows_fs().replace(source, destination)
    else:
        os.replace(source, destination)


def sync_directory(path: Path) -> None:
    if os.name == 'nt':
        windows_fs().sync_directory(path)
    else:
        fd = os.open(path, os.O_RDONLY | getattr(os, 'O_DIRECTORY', 0))
        try:
            os.fsync(fd)
        finally:
            os.close(fd)


def file_locks():
    if os.name == 'nt':
        return windows_fs()
    import fcntl
    return fcntl


def stamp_file(value) -> list[int]:
    return [value.st_size, value.st_mtime_ns, value.st_ctime_ns,
            value.st_ino, value.st_dev, stat.S_IMODE(value.st_mode)]


def file_hash(path: Path) -> tuple[str, list[int]]:
    fd = open_file(path, os.O_RDONLY)
    with os.fdopen(fd, 'rb') as stream:
        before = os.fstat(stream.fileno())
        if not stat.S_ISREG(before.st_mode):
            raise ValueError(f'Runtime member is not a regular file: {path}')
        digest = hashlib.sha256()
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
        after = os.fstat(stream.fileno())
        if stamp_file(before) != stamp_file(after):
            raise ValueError(f'Runtime member changed while being read: {path}')
        return digest.hexdigest(), stamp_file(after)


def check_member_names(entries: list[tuple[str, str]], spec: dict) -> None:
    """Reject nonrepresentable destination names rather than silently renaming code."""
    system = spec['platform']['system']
    fold = system in ('Windows', 'Darwin')
    seen, kinds, parents = {}, {}, set()
    for raw, kind in entries:
        name = relative(raw.rstrip('/'))
        if raw.rstrip('/') != name:
            raise ValueError(f'Runtime archive has a noncanonical name: {raw}')
        parts = PurePosixPath(name).parts
        if system == 'Windows':
            for part in parts:
                stem = part.split('.')[0].upper()
                if (part.endswith((' ', '.')) or any(c in part for c in '<>"|?*')
                        or stem in {'CON', 'PRN', 'AUX', 'NUL', 'CONIN$', 'CONOUT$'}
                        or re.fullmatch(r'(COM|LPT)[1-9¹²³]', stem)):
                    raise ValueError(f'Runtime archive name cannot be represented on Windows: {raw}')
        # Include implicit directories, otherwise A/x and a/y collide invisibly.
        for index in range(1, len(parts)+1):
            part_name = '/'.join(parts[:index])
            key = unicodedata.normalize('NFD', part_name).casefold() if fold else part_name
            if key in seen and seen[key] != part_name:
                raise ValueError(f'Runtime archive destination-name collision: {seen[key]} / {part_name}')
            seen[key] = part_name
            if index < len(parts) and kinds.get(part_name) not in (None, 'directory'):
                raise ValueError(f'Runtime member is used as a directory: {part_name}')
        if name in kinds:
            raise ValueError(f'Duplicate runtime archive member: {name}')
        if kind != 'directory' and name in parents:
            raise ValueError(f'Runtime member replaces a directory: {name}')
        kinds[name] = kind
        parents.update('/'.join(parts[:i]) for i in range(1,len(parts)))


def binary_target(path: Path) -> tuple[str, set[str]]:
    with path.open('rb') as stream:
        head = stream.read(4096)
        if head[:2] == b'MZ' and len(head) >= 64:
            offset = struct.unpack_from('<I', head, 60)[0]
            stream.seek(offset)
            pe = stream.read(6)
            if pe[:4] != b'PE\0\0':
                raise ValueError(f'Invalid PE executable: {path}')
            arch = {0x8664: 'x86_64', 0xaa64: 'arm64'}.get(struct.unpack_from('<H', pe, 4)[0])
            return 'Windows', {arch} if arch else set()
        if head[:4] == b'\x7fELF' and len(head) >= 20:
            endian = '<' if head[5] == 1 else '>'
            arch = {62: 'x86_64', 183: 'arm64'}.get(struct.unpack_from(endian+'H', head, 18)[0])
            return 'Linux', {arch} if arch else set()
        magics = {b'\xcf\xfa\xed\xfe': '<', b'\xfe\xed\xfa\xcf': '>'}
        cpus = {0x01000007: 'x86_64', 0x0100000c: 'arm64'}
        if head[:4] in magics and len(head) >= 8:
            arch = cpus.get(struct.unpack_from(magics[head[:4]]+'I', head, 4)[0])
            return 'Darwin', {arch} if arch else set()
        fat = {b'\xca\xfe\xba\xbe': ('>',20), b'\xbe\xba\xfe\xca': ('<',20),
               b'\xca\xfe\xba\xbf': ('>',32), b'\xbf\xba\xfe\xca': ('<',32)}
        if head[:4] in fat:
            endian, stride = fat[head[:4]]
            count = struct.unpack_from(endian+'I', head, 4)[0]
            if count > 64 or len(head) < 8 + count * stride:
                raise ValueError(f'Invalid universal Mach-O header: {path}')
            return 'Darwin', {cpus[c] for i in range(count)
                              if (c := struct.unpack_from(endian+'I', head, 8+i*stride)[0]) in cpus}
    raise ValueError(f'The selected native executable has an unrecognized format: {path}')


def windows_custody_file(path: Path) -> int:
    """Open a no-share file description, retained by explicitly inherited handles.

    This is intentionally not a LockFileEx ownership-transfer claim. The share
    exclusion survives parent exit until the last duplicate handle closes.
    """
    import ctypes
    from ctypes import wintypes
    import errno
    import msvcrt
    kernel = ctypes.WinDLL('kernel32',use_last_error=True)
    kernel.CreateFileW.argtypes = [wintypes.LPCWSTR,wintypes.DWORD,wintypes.DWORD,
        ctypes.c_void_p,wintypes.DWORD,wintypes.DWORD,wintypes.HANDLE]
    kernel.CreateFileW.restype = wintypes.HANDLE
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel.GetFileInformationByHandleEx.argtypes = [wintypes.HANDLE,ctypes.c_int,ctypes.c_void_p,wintypes.DWORD]
    handle = kernel.CreateFileW(str(native_path(path)),0xC0000000,0,None,4,0x00200080,None)
    if handle == ctypes.c_void_p(-1).value:
        error = ctypes.get_last_error()
        if error in (32,33):
            raise BlockingIOError(errno.EAGAIN,'The runtime is already being prepared',str(path))
        raise ctypes.WinError(error)
    try:
        class Tag(ctypes.Structure):
            _fields_ = [('attributes',wintypes.DWORD),('tag',wintypes.DWORD)]
        tag = Tag()
        if not kernel.GetFileInformationByHandleEx(handle,9,ctypes.byref(tag),ctypes.sizeof(tag)):
            raise ctypes.WinError(ctypes.get_last_error())
        if tag.attributes & (0x400|0x10):
            raise ValueError('The runtime custody file must be a regular, non-reparse file.')
        fd = msvcrt.open_osfhandle(handle,os.O_RDWR|os.O_BINARY)
        handle = None
        try:
            os.set_inheritable(fd,False)
        except BaseException:
            os.close(fd)
            raise
        return fd
    finally:
        if handle is not None:
            kernel.CloseHandle(handle)
