#!/usr/bin/env python3
"""Receive the supplied Node and Excel dependencies into the selected runtime."""
from __future__ import annotations

import argparse
import contextlib
import hashlib
import importlib.metadata
import importlib.util
import json
import os
from pathlib import Path
import platform
import runpy
import stat
import subprocess
import sys
import uuid

BLOCK = 1024 * 1024
PAYLOADS = {
    "measurements-runtime/node": (121509208, "8142d37c6f2f372ef040419e7a111a6baf17df89f8078d02447d6c639ae20c1d"),
    "measurements-runtime/LICENSE": (142078, "1ae62e2015784ba438db7b04ebd33f3c4ff3efdb824c111c4ececd99945fd52d"),
    "workbook-dependencies/openpyxl-3.1.5-py2.py3-none-any.whl": (250910, "5282c12b107bffeef825f4617dc029afaf41d0ea60823bbb665ef3079dc79de2"),
    "workbook-dependencies/et_xmlfile-2.0.0-py3-none-any.whl": (18059, "7a91720bc756843502c3b7504c77b8fe44217c85c537d85037f0f536151b2caa"),
}
WHEELS = (
    ("et_xmlfile", "2.0.0", "workbook-dependencies/et_xmlfile-2.0.0-py3-none-any.whl"),
    ("openpyxl", "3.1.5", "workbook-dependencies/openpyxl-3.1.5-py2.py3-none-any.whl"),
)


ROOT = Path(__file__).resolve().parent
_WINDOWS_FS = None
_FILESYSTEM = None


def portable_fs(application: Path) -> None:
    global _WINDOWS_FS, _FILESYSTEM
    sys.path.insert(0, str(application))
    from model import portable_fs as filesystem
    _FILESYSTEM = filesystem
    _WINDOWS_FS = filesystem.file_locks if os.name == "nt" else None


def native_path(path) -> Path:
    return _FILESYSTEM.native_path(path) if _FILESYSTEM is not None else Path(path)


def no_follow_open(path, flags, mode=0o600):
    if _FILESYSTEM is not None:
        return _FILESYSTEM.open_file(path, flags, mode)
    return os.open(path, flags | getattr(os, "O_NOFOLLOW", 0), mode)


def fd_stat(fd):
    return _FILESYSTEM.fd_stat(fd) if _FILESYSTEM is not None else os.fstat(fd)


def platform_key() -> str:
    system = platform.system()
    machine = platform.machine().lower()
    if system == "Windows" and machine in ("amd64", "x86_64"):
        return "windows-x86_64"
    if system == "Darwin" and machine in ("arm64", "aarch64"):
        return "macos-arm64"
    if system == "Darwin" and machine in ("amd64", "x86_64"):
        return "macos-x86_64"
    if system == "Linux" and machine in ("amd64", "x86_64"):
        return "linux-x86_64"
    raise ValueError("No supplied native dependencies match " + system + " " + machine)


def bundle_member(root: Path, value: str) -> Path:
    from pathlib import PurePosixPath
    if not isinstance(value, str) or not value or "\\" in value or ":" in value:
        raise ValueError("Dependency must name a relative bundle member")
    relative = PurePosixPath(value)
    if relative.is_absolute() or str(relative) != value or any(p in (".", "..") for p in relative.parts):
        raise ValueError("Dependency path leaves the supplied collection")
    member = root.joinpath(*relative.parts)
    for item in (member, *member.parents):
        if item == root:
            break
        info = item.lstat()
        if stat.S_ISLNK(info.st_mode) or getattr(info, "st_file_attributes", 0) & 0x400:
            raise ValueError("Dependency path is an alias: " + str(item))
    return member


def native_dependencies(root: Path, spec_path: Path | None):
    key = platform_key()
    spec_path = spec_path or root / "NATIVE_RUNTIME.json"
    spec = json.loads(spec_path.read_text(encoding="utf-8")) if spec_path.is_file() else {}
    if "platforms" not in spec:
        if key != "linux-x86_64":
            raise ValueError("Receive the platform-matched NATIVE_RUNTIME.json and dependency payloads")
        return [(name, expected) for name, expected in PAYLOADS.items()][:2]
    descriptor = spec.get("platforms", {}).get(key)
    if not isinstance(descriptor, dict):
        raise ValueError("The supplied runtime manifest has no " + key + " target")
    deps = descriptor.get("dependencies")
    if not isinstance(deps, dict):
        raise ValueError("The " + key + " runtime must include its Node and license descriptors")
    result = []
    for name in ("node", "node_license"):
        row = deps.get(name)
        if not isinstance(row, dict):
            raise ValueError("Missing platform dependency descriptor: " + name)
        size, digest = row.get("bytes"), row.get("sha256")
        if type(size) is not int or size <= 0 or not isinstance(digest, str) or len(digest) != 64:
            raise ValueError("Invalid original dependency size/hash: " + name)
        if any(c not in "0123456789abcdef" for c in digest):
            raise ValueError("Dependency checksum must be a lowercase SHA-256: " + name)
        bundle_member(root, row.get("path"))
        result.append((row["path"], (size, digest)))
    return result


def run_probe(command, lease_fd, **kwargs):
    # These original probes read their inputs. Only POSIX inherits the lock fd.
    if os.name != "nt":
        kwargs["pass_fds"] = (lease_fd,)
    return subprocess.run(command, **kwargs)


def install_wheels(python: Path, prefix: Path, pending, env, lease_fd):
    arguments = ["--isolated", "install", "--no-index", "--no-deps", "--no-input",
                 "--disable-pip-version-check", "--only-binary=:all:", "--prefix", str(prefix), *pending]
    if os.name != "nt":
        subprocess.run([str(python), "-I", "-m", "pip", *arguments],
                       check=True, env=env, pass_fds=(lease_fd,))
        return
    # The same isolated selected interpreter and lock own every wheel write.
    # Running the two supplied pure wheels in-process avoids a child outliving
    # its parent's Windows file lock. No builds, index access, or dependencies.
    argv, environment = sys.argv, dict(os.environ)
    try:
        os.environ.clear()
        os.environ.update(env)
        sys.argv = ["pip", *arguments]
        try:
            runpy.run_module("pip", run_name="__main__", alter_sys=True)
        except SystemExit as result:
            if result.code not in (None, 0):
                raise RuntimeError("Offline workbook dependency installation failed: " + str(result.code)) from result
    finally:
        sys.argv = argv
        os.environ.clear()
        os.environ.update(environment)


def regular(path: Path):
    value = (_FILESYSTEM.path_stat(path) if _FILESYSTEM is not None else path.lstat())
    if not stat.S_ISREG(value.st_mode):
        raise ValueError("Expected an original regular file: " + str(path))
    return value


def checked(path: Path, expected: tuple[int, str]):
    path = native_path(path)
    before = regular(path)
    fd = no_follow_open(path, os.O_RDONLY)
    try:
        opened = fd_stat(fd)
        if (before.st_dev, before.st_ino) != (opened.st_dev, opened.st_ino):
            raise ValueError("File changed while opening: " + str(path))
        digest = hashlib.sha256()
        size = 0
        with os.fdopen(fd, "rb", closefd=False) as stream:
            for block in iter(lambda: stream.read(BLOCK), b""):
                digest.update(block)
                size += len(block)
        after = fd_stat(fd)
        current = regular(path)
        state = lambda v: (v.st_dev, v.st_ino, v.st_size, v.st_mtime_ns, v.st_ctime_ns)
        if state(before) != state(after) or state(after) != state(current):
            raise ValueError("File changed while checking: " + str(path))
        if (size, digest.hexdigest()) != expected:
            raise ValueError("Preserved differing file; receive the original payload: " + str(path))
        return current
    finally:
        os.close(fd)


def directory(path: Path) -> None:
    path = native_path(path)
    for parent in path.parents:
        if parent.is_symlink() or (parent.exists() and getattr(parent.lstat(), "st_file_attributes", 0) & 0x400):
            raise ValueError("Runtime directory parent is an alias: " + str(parent))
    if path.exists() or path.is_symlink():
        if path.is_symlink() or not path.is_dir():
            raise ValueError("Keep runtime directories as real directories: " + str(path))
    else:
        directory(path.parent)
        path.mkdir(mode=0o755)


def sync_directory(path: Path) -> None:
    if _FILESYSTEM is None:
        raise RuntimeError("Load the selected application's portable filesystem first")
    _FILESYSTEM.sync_directory(path)


def received_mode(path: Path, expected: tuple[int, str], mode: int, *, created=False) -> None:
    """Restore execute permission only on the byte-verified original executable.

    Windows ZIP round trips and the shared no-hardlink fallback may remove POSIX
    modes. Repair the owned installed file, never its original supplied payload.
    """
    before = checked(path, expected)
    if os.name == "nt":
        return
    desired = mode if created else stat.S_IMODE(before.st_mode) | (mode & 0o111)
    if stat.S_IMODE(before.st_mode) != desired:
        fd = no_follow_open(path, os.O_RDONLY)
        try:
            opened = fd_stat(fd)
            identity = lambda v: (v.st_dev, v.st_ino, v.st_size, v.st_mtime_ns, v.st_ctime_ns)
            if identity(opened) != identity(before):
                raise ValueError("Runtime file changed before mode restoration: " + str(path))
            os.fchmod(fd, desired)
            os.fsync(fd)
        finally:
            os.close(fd)
        checked(path, expected)
    if mode & 0o111 and not os.access(path, os.X_OK):
        raise ValueError("The verified runtime file cannot be executed: " + str(path))


def install_exact(source: Path, destination: Path, expected: tuple[int, str], mode: int) -> None:
    if _FILESYSTEM is None:
        raise RuntimeError("Load the selected application's portable filesystem first")
    source, destination = native_path(source), native_path(destination)
    directory(destination.parent)
    if destination.exists() or destination.is_symlink():
        received_mode(destination, expected, mode)
        return
    temporary = destination.with_name("." + destination.name + ".receiving-" + uuid.uuid4().hex)
    fd = no_follow_open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        source_fd = no_follow_open(source, os.O_RDONLY)
        digest, size = hashlib.sha256(), 0
        with os.fdopen(source_fd, "rb") as incoming, os.fdopen(fd, "wb", closefd=False) as outgoing:
            before = fd_stat(source_fd)
            for block in iter(lambda: incoming.read(BLOCK), b""):
                outgoing.write(block)
                digest.update(block)
                size += len(block)
            after = fd_stat(source_fd)
            identity = lambda v: (v.st_dev, v.st_ino, v.st_size, v.st_mtime_ns, v.st_ctime_ns)
            if (size, digest.hexdigest()) != expected or identity(before) != identity(after):
                raise ValueError("Payload changed while receiving: " + str(source))
            outgoing.flush()
            if hasattr(os, "fchmod"):
                os.fchmod(fd, mode)
            else:
                os.chmod(temporary, mode)
            os.fsync(fd)
        # Close the writable staging handle before either native publication
        # path. The existing installation lock remains held by the caller.
        os.close(fd)
        fd = None
        created = False
        try:
            _FILESYSTEM.publish_file(temporary, destination)
            created = True
        except FileExistsError:
            checked(destination, expected)
        received_mode(destination, expected, mode, created=created)
        sync_directory(destination.parent)
    finally:
        if fd is not None:
            os.close(fd)
        temporary.unlink(missing_ok=True)


@contextlib.contextmanager
def installation_lock(prefix: Path):
    path = prefix / ".ecosystem-runtime-dependencies.lock"
    fd = no_follow_open(path, os.O_RDWR | os.O_CREAT, 0o600)
    try:
        if not stat.S_ISREG(fd_stat(fd).st_mode):
            raise ValueError("Runtime dependency lock is not a regular file")
        if _WINDOWS_FS is not None:
            _WINDOWS_FS.flock(fd, _WINDOWS_FS.LOCK_EX)
        else:
            import fcntl
            fcntl.flock(fd, fcntl.LOCK_EX)
        yield fd
    finally:
        os.close(fd)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", type=Path, required=True)
    parser.add_argument("--spec", type=Path)
    args = parser.parse_args()
    root = Path(__file__).resolve().parent
    application = args.application.expanduser().resolve(strict=True)
    portable_fs(application)
    root, application = native_path(root), native_path(application)
    payloads = native_dependencies(root, args.spec)
    probe = application / "measurement_workspace/node_runtime.py"
    if not probe.is_file():
        raise ValueError("Receive the complete application Measurements runtime source")
    prefix = native_path(Path(sys.prefix).resolve(strict=True))
    selected_python = native_path(Path(os.path.abspath(sys.executable)))
    # Match the maintained selector's runtime-sibling location, including its
    # treatment of a selected executable symlink.
    node = selected_python.resolve(strict=True).parent / ("node.exe" if os.name == "nt" else "node")
    if not node.is_relative_to(prefix):
        raise ValueError("Select the qualified scientific runtime's own Python executable")
    for name, expected in [*payloads, *((row[2], PAYLOADS[row[2]]) for row in WHEELS)]:
        path = bundle_member(root, name)
        if path.parent.is_symlink():
            raise ValueError("Bundled dependency directory is an alias: " + str(path.parent))
        checked(path, expected)

    with installation_lock(prefix) as lease_fd:
        install_exact(root / payloads[0][0], node, payloads[0][1], 0o755)
        install_exact(root / payloads[1][0],
                      prefix / "share/licenses/ecosystem-measurements-node/LICENSE",
                      payloads[1][1], 0o644)
        pending = []
        for name, version, relative in WHEELS:
            try:
                current = importlib.metadata.version(name)
            except importlib.metadata.PackageNotFoundError:
                if importlib.util.find_spec(name) is not None:
                    raise ValueError("Preserved an unrecognized installed Python module: " + name)
                pending.append(str(root / relative))
            else:
                if current != version:
                    raise ValueError("Preserved installed " + name + " " + current
                                     + "; select the supplied scientific runtime")
        env = {key: value for key, value in os.environ.items()
               if not key.startswith(("PYTHON", "PIP_", "CONDA_"))
               and key not in ("VIRTUAL_ENV",)}
        env["PIP_CONFIG_FILE"] = os.devnull
        env["PIP_NO_INDEX"] = "1"
        env["PYTHONNOUSERSITE"] = "1"
        env["PATH"] = os.pathsep.join([str(node.parent), str(prefix / "Library/bin"), env.get("PATH", "")])
        if platform.system() == "Linux" and (prefix / "lib").is_dir():
            env["LD_LIBRARY_PATH"] = str(prefix / "lib") + (
                os.pathsep + env["LD_LIBRARY_PATH"] if env.get("LD_LIBRARY_PATH") else "")
        if pending:
            install_wheels(selected_python, prefix, pending, env, lease_fd)
        result = run_probe(
            [str(selected_python), "-I", "-B", str(probe), "--node", str(node)],
            check=True, capture_output=True, text=True, env=env, lease_fd=lease_fd)
        native = json.loads(result.stdout)
        if native.get("ready") is not True:
            raise RuntimeError("Original Measurements capability probe did not become ready")
        # Also inspect the actual normal selection; explicit MEASUREMENTS_NODE
        # remains authoritative and never silently falls back to the bundle.
        run_probe([str(selected_python), "-I", "-B", str(probe)],
                       check=True, env=env, lease_fd=lease_fd)
        excel = run_probe(
            [str(selected_python), "-I", "-B", "-c",
             "import importlib.metadata as m,openpyxl,et_xmlfile,json;"
             "print(json.dumps({n:m.version(n) for n in ('openpyxl','et_xmlfile')}))"],
            check=True, capture_output=True, text=True, env=env, lease_fd=lease_fd)
        print(json.dumps({"node": native, "excel": json.loads(excel.stdout)}, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, RuntimeError, subprocess.CalledProcessError) as error:
        print(type(error).__name__ + ": " + str(error), file=sys.stderr)
        raise SystemExit(2)
