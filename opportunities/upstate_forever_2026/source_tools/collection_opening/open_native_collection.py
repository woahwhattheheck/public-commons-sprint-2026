#!/usr/bin/env python3
"""Prepare the supplied native tools, then open the original whole collection."""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import platform
import stat
import subprocess
import sys


def platform_key() -> str:
    system, machine = platform.system(), platform.machine().lower()
    if system == "Windows" and machine in ("amd64", "x86_64"):
        return "windows-x86_64"
    if system == "Darwin" and machine in ("arm64", "aarch64"):
        return "macos-arm64"
    if system == "Darwin" and machine in ("amd64", "x86_64"):
        return "macos-x86_64"
    if system == "Linux" and machine in ("amd64", "x86_64"):
        return "linux-x86_64"
    raise ValueError("This collection has no supplied runtime for " + system + " " + machine)


def member(root: Path, value: str) -> Path:
    if not isinstance(value, str) or not value or "\\" in value or ":" in value:
        raise ValueError("A runtime member must be a relative bundle path")
    relative = PurePosixPath(value)
    if relative.is_absolute() or str(relative) != value or any(p in (".", "..") for p in relative.parts):
        raise ValueError("A runtime member leaves its supplied directory")
    result = root.joinpath(*relative.parts)
    for path in (result, *result.parents):
        if path == root:
            break
        info = path.lstat()
        if stat.S_ISLNK(info.st_mode) or getattr(info, "st_file_attributes", 0) & 0x400:
            raise ValueError("Runtime member is an alias: " + str(path))
    return result


def verify_bootstrap(root: Path, descriptor: dict) -> None:
    bootstrap = descriptor.get("bootstrap")
    if not isinstance(bootstrap, dict):
        raise ValueError("Receive the complete supplied bootstrap for this computer")
    directory = member(root, bootstrap.get("directory"))
    executable = member(directory, bootstrap.get("python"))
    files = bootstrap.get("files")
    if not isinstance(files, list) or not files:
        raise ValueError("The bootstrap needs its original file inventory")
    seen = set()
    for row in files:
        if not isinstance(row, dict):
            raise ValueError("Invalid bootstrap file descriptor")
        relative = row.get("path")
        path = member(directory, relative)
        canonical = relative.casefold() if os.name == "nt" else relative
        if canonical in seen:
            raise ValueError("Duplicate bootstrap file descriptor: " + relative)
        seen.add(canonical)
        expected_size, expected_hash = row.get("bytes"), row.get("sha256")
        if type(expected_size) is not int or expected_size < 0 or not isinstance(expected_hash, str):
            raise ValueError("Invalid bootstrap file size/hash: " + relative)
        before = path.stat()
        if not stat.S_ISREG(before.st_mode):
            raise ValueError("Bootstrap member is not a regular file: " + relative)
        digest, total = hashlib.sha256(), 0
        with path.open("rb") as stream:
            opened = os.fstat(stream.fileno())
            if (before.st_dev, before.st_ino) != (opened.st_dev, opened.st_ino):
                raise ValueError("Bootstrap member changed while opening: " + relative)
            for block in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(block)
                total += len(block)
            after = os.fstat(stream.fileno())
        final = path.stat()
        state = lambda v: (v.st_dev, v.st_ino, v.st_size, v.st_mtime_ns)
        if state(before) != state(after) or state(after) != state(final):
            raise ValueError("Bootstrap member changed while receiving: " + relative)
        if total != expected_size or digest.hexdigest() != expected_hash:
            raise ValueError("Incomplete or different bootstrap file: " + relative)
    selected_name = bootstrap["python"].casefold() if os.name == "nt" else bootstrap["python"]
    if selected_name not in seen:
        raise ValueError("The supplied bootstrap interpreter is absent from its inventory")
    if not executable.is_file():
        raise ValueError("The supplied bootstrap interpreter is absent")


def selected_path(name: str) -> Path | None:
    value = os.environ.get(name)
    return Path(value).expanduser() if value else None


def main(arguments: list[str] | None = None) -> int:
    root = Path(__file__).resolve().parent
    arguments = list(sys.argv[1:] if arguments is None else arguments)
    if arguments[:1] == ["--"]:
        arguments.pop(0)
    spec_path = root / "NATIVE_RUNTIME.json"
    spec = json.loads(spec_path.read_text(encoding="utf-8"))
    key = platform_key()
    explicit_python = selected_path("ECOSYSTEMS_PYTHON")
    if "platforms" in spec:
        descriptor = spec["platforms"].get(key)
        if not isinstance(descriptor, dict):
            raise ValueError("The supplied runtime manifest has no " + key + " target")
        if explicit_python is None:
            verify_bootstrap(root, descriptor)
    elif key != "linux-x86_64":
        raise ValueError("Receive the matching Windows or macOS runtime manifest")
    application = root / "application"
    sys.path.insert(0, str(application))
    from source_tools import receive_native_runtime as receiver
    result = receiver.receive(
        application, spec_path, archive=selected_path("ECOSYSTEMS_RUNTIME_ARCHIVE"),
        storage=selected_path("ECOSYSTEMS_RUNTIME_STORAGE"), python=explicit_python)
    if result.get("state") != "ready":
        raise RuntimeError("The supplied scientific runtime did not become ready")
    python = Path(result["python"])
    if not python.is_absolute() or not python.is_file():
        raise ValueError("The receiver did not select an installed Python executable")
    environment = receiver.environment(Path(result["prefix"]))
    environment["ECOSYSTEMS_PYTHON"] = str(python)
    environment["PYTHONNOUSERSITE"] = "1"
    environment.pop("PYTHONHOME", None)
    environment.pop("PYTHONPATH", None)
    subprocess.run([str(python), "-I", "-B", str(root / "prepare_runtime_dependencies.py"),
                    "--application", str(application), "--spec", str(spec_path)],
                   env=environment, check=True)
    command = [str(python), "-B", str(root / "open_collection.py"), *arguments]
    if os.name == "nt":
        # Keep the owning terminal present until the original controller exits.
        return subprocess.run(command, env=environment).returncode
    os.execve(str(python), command, environment)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print("Opening interrupted. Reopen this collection to continue.", file=sys.stderr)
        raise SystemExit(130)
    except (OSError, ValueError, RuntimeError, KeyError, subprocess.SubprocessError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(2)
