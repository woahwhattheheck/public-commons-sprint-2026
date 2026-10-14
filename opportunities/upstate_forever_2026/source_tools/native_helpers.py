"""Select the source-bound, target-native numerical helpers shipped with a workbench.

Only generic application files are read. Selection never downloads, compiles,
changes a manifest, or substitutes a different scientific implementation.
"""
from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import platform
import re
import struct
import sys
from typing import Any

SCHEMA = "upstate.native-helpers/v1"
MANIFEST_NAME = "NATIVE_HELPERS.json"
TOOLS = {
    "terrain_flood": "source_tools/terrain_flood.cpp",
    "matched_control_exact": "source_tools/matched_control_exact.cpp",
}
_SHA256 = re.compile(r"^[a-f0-9]{64}$")
_TARGETS = {
    "windows-x86_64": ("Windows", "x86_64", "pe", 0x8664),
    "macos-x86_64": ("Darwin", "x86_64", "mach-o", 0x01000007),
    "macos-arm64": ("Darwin", "arm64", "mach-o", 0x0100000C),
    "linux-x86_64": ("Linux", "x86_64", "elf", 62),
    "linux-arm64": ("Linux", "arm64", "elf", 183),
}


class NativeHelperError(RuntimeError):
    """A shipped helper does not match its application, platform, or manifest."""


@dataclass(frozen=True)
class NativeHelper:
    name: str
    path: Path
    target: str
    source_sha256: str
    binary_sha256: str
    manifest_sha256: str
    minimum_os_version: str | None

    def identity(self) -> dict[str, Any]:
        """Portable provenance; deliberately exclude machine-specific paths."""
        return {
            "schema": SCHEMA,
            "name": self.name,
            "target": self.target,
            "source_sha256": self.source_sha256,
            "binary_sha256": self.binary_sha256,
            "manifest_sha256": self.manifest_sha256,
            "minimum_os_version": self.minimum_os_version,
        }


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def target_key(system: str | None = None, machine: str | None = None) -> str:
    """Match the executing interpreter's CPU, including an Intel process on Rosetta."""
    system = platform.system() if system is None else system
    machine = platform.machine() if machine is None else machine
    if not isinstance(system, str) or not isinstance(machine, str):
        raise NativeHelperError("Native helper system and machine must be strings")
    systems = {"windows": "windows", "darwin": "macos", "macos": "macos", "linux": "linux"}
    machines = {"amd64": "x86_64", "x86_64": "x86_64", "x64": "x86_64",
                "arm64": "arm64", "aarch64": "arm64"}
    normalized = systems.get(system.lower(), system.lower()) + "-" + machines.get(machine.lower(), machine.lower())
    return normalized


def _contained(root: Path, relative: Any, label: str) -> Path:
    if not isinstance(relative, str) or not relative or "\\" in relative or ":" in relative or "\x00" in relative:
        raise NativeHelperError(f"Invalid {label} path in {MANIFEST_NAME}")
    components = PurePosixPath(relative)
    if components.is_absolute() or any(part in {"", ".", ".."} for part in relative.split("/")):
        raise NativeHelperError(f"Invalid {label} path in {MANIFEST_NAME}")
    candidate = root.joinpath(*components.parts)
    try:
        resolved = candidate.resolve(strict=True)
        resolved.relative_to(root)
    except (OSError, ValueError, RuntimeError) as exc:
        raise NativeHelperError(f"Missing or uncontained {label}: {relative}") from exc
    if not resolved.is_file():
        raise NativeHelperError(f"Expected a regular {label}: {relative}")
    return resolved


def _digest_field(value: Any, label: str) -> str:
    if not isinstance(value, str) or not _SHA256.fullmatch(value):
        raise NativeHelperError(f"Invalid {label} SHA256 in {MANIFEST_NAME}")
    return value


def inspect_executable(path: Path, target: str) -> str:
    """Read PE/ELF/thin-Mach-O headers without executing a foreign binary."""
    if target not in _TARGETS:
        raise NativeHelperError(f"Unsupported native helper target: {target}")
    _, _, expected_format, expected_machine = _TARGETS[target]
    with path.open("rb") as stream:
        header = stream.read(64)
        if expected_format == "pe":
            if len(header) < 64 or header[:2] != b"MZ":
                raise NativeHelperError("Expected a Windows PE executable")
            offset = struct.unpack_from("<I", header, 60)[0]
            if offset < 64 or offset > path.stat().st_size - 26:
                raise NativeHelperError("Invalid Windows PE header offset")
            stream.seek(offset)
            pe = stream.read(26)
            if pe[:4] != b"PE\x00\x00" or struct.unpack_from("<H", pe, 4)[0] != expected_machine:
                raise NativeHelperError(f"Windows helper CPU does not match {target}")
            characteristics = struct.unpack_from("<H", pe, 22)[0]
            if not characteristics & 2 or characteristics & 0x2000 or pe[24:26] != b"\x0b\x02":
                raise NativeHelperError("Expected an executable PE32+ program, not a DLL")
        elif expected_format == "mach-o":
            if len(header) < 32 or header[:4] != b"\xcf\xfa\xed\xfe":
                raise NativeHelperError("Expected a thin little-endian 64-bit Mach-O executable")
            cpu, _, file_type = struct.unpack_from("<III", header, 4)
            if cpu != expected_machine or file_type != 2:
                raise NativeHelperError(f"Mach-O executable CPU does not match {target}")
        else:
            if len(header) < 64 or header[:6] != b"\x7fELF\x02\x01":
                raise NativeHelperError("Expected a little-endian 64-bit ELF executable")
            file_type, machine = struct.unpack_from("<HH", header, 16)
            if file_type not in (2, 3) or machine != expected_machine:
                raise NativeHelperError(f"ELF executable CPU does not match {target}")
    return expected_format


def _version(value: str, label: str) -> tuple[int, ...]:
    if not isinstance(value, str) or not re.fullmatch(r"\d+(?:\.\d+){0,3}", value):
        raise NativeHelperError(f"Invalid {label}: {value!r}")
    result = tuple(int(part) for part in value.split("."))
    return result + (0,) * (4 - len(result))


def _check_minimum(target: str, minimum: Any, check_host: bool) -> str | None:
    if minimum is None:
        return None
    wanted = _version(minimum, "minimum OS version")
    if check_host and target.startswith("macos-"):
        actual = platform.mac_ver()[0]
        if actual and _version(actual, "macOS version") < wanted:
            raise NativeHelperError(f"This helper requires macOS {minimum} or later")
    elif check_host and target.startswith("windows-") and hasattr(sys, "getwindowsversion"):
        actual = sys.getwindowsversion()
        if (actual.major, actual.minor, actual.build, 0) < wanted:
            raise NativeHelperError(f"This helper requires Windows {minimum} or later")
    return minimum


def resolve_helper(name: str, *, application: Path | None = None,
                   target: str | None = None, required: bool = False) -> NativeHelper | None:
    """Return a fully checked bundled helper, or None for an unbundled legacy app.

    A manifest which advertises the current target must contain both helpers.
    Missing/changed advertised files are errors, never silent fallback. The
    explicit target is for packaging inspection; it does not execute the file.
    """
    if name not in TOOLS:
        raise NativeHelperError(f"Unknown native helper: {name}")
    root = (Path(application) if application is not None else Path(__file__).resolve().parents[1]).resolve()
    native_target = target_key()
    selected = native_target if target is None else target.replace("darwin-", "macos-", 1)
    manifest_path = root / MANIFEST_NAME
    if not manifest_path.exists() and not manifest_path.is_symlink():
        if required:
            raise NativeHelperError(f"The application does not include {MANIFEST_NAME}")
        return None
    manifest_path = _contained(root, MANIFEST_NAME, "helper manifest")
    if manifest_path.stat().st_size > 1024 * 1024:
        raise NativeHelperError("Native helper manifest is unexpectedly large")
    raw = manifest_path.read_bytes()
    try:
        manifest = json.loads(raw)
    except (ValueError, UnicodeError) as exc:
        raise NativeHelperError("Native helper manifest cannot be read") from exc
    if not isinstance(manifest, dict) or manifest.get("schema") != SCHEMA or not isinstance(manifest.get("platforms"), dict):
        raise NativeHelperError("Unsupported native helper manifest schema")
    entries = manifest["platforms"]
    entry = entries.get(selected)
    alias = selected.replace("macos-", "darwin-", 1)
    if alias != selected and selected in entries and alias in entries and entries[selected] != entries[alias]:
        raise NativeHelperError("Conflicting macOS platform aliases in the helper manifest")
    if entry is None and selected.startswith("macos-"):
        entry = entries.get(selected.replace("macos-", "darwin-", 1))
    if entry is None:
        if required:
            raise NativeHelperError(f"No bundled native helper for {selected}")
        return None
    if selected == native_target and struct.calcsize("P") != 8:
        raise NativeHelperError("These numerical helpers require the bundled 64-bit Python interpreter")
    if selected not in _TARGETS or not isinstance(entry, dict):
        raise NativeHelperError(f"Invalid native helper platform: {selected}")
    system, machine, expected_format, _ = _TARGETS[selected]
    declared = entry.get("platform")
    if not isinstance(declared, dict) or target_key(declared.get("system", ""), declared.get("machine", "")) != selected:
        raise NativeHelperError("Native helper platform metadata disagrees with its target")
    tools = entry.get("tools")
    if not isinstance(tools, dict) or not all(tool in tools for tool in TOOLS):
        raise NativeHelperError(f"Incomplete {selected} bundle: both numerical helpers are required")
    row = tools[name]
    if not isinstance(row, dict) or row.get("source") != TOOLS[name]:
        raise NativeHelperError(f"Incorrect original source path for {name}")
    source_sha = _digest_field(row.get("source_sha256"), "source")
    binary_sha = _digest_field(row.get("sha256"), "executable")
    source = _contained(root, row["source"], "original helper source")
    executable = _contained(root, row.get("path"), "bundled helper")
    expected_size = row.get("bytes")
    if isinstance(expected_size, bool) or not isinstance(expected_size, int) or expected_size <= 0:
        raise NativeHelperError(f"Invalid executable byte count for {name}")
    if source_sha != sha256(source):
        raise NativeHelperError(f"The bundled {name} was built from a different source; rebuild the helper package")
    if executable.stat().st_size != expected_size or sha256(executable) != binary_sha:
        raise NativeHelperError(f"The bundled {name} has changed; restore the original release files")
    if row.get("format") != expected_format or inspect_executable(executable, selected) != expected_format:
        raise NativeHelperError(f"Incorrect executable format for {name}")
    if selected.startswith("windows-") and executable.suffix.lower() != ".exe":
        raise NativeHelperError("A Windows helper must retain its .exe filename")
    if selected == native_target and os.name != "nt" and not os.access(executable, os.X_OK):
        raise NativeHelperError(f"The bundled {name} is not executable; restore executable modes from the release archive")
    minimum = _check_minimum(selected, entry.get("minimum_os_version"), selected == native_target)
    return NativeHelper(name, executable, selected, source_sha, binary_sha,
                        hashlib.sha256(raw).hexdigest(), minimum)


def bundled_executable(name: str, *, application: Path | None = None) -> Path | None:
    selected = resolve_helper(name, application=application)
    return selected.path if selected is not None else None


def main(argv: list[str] | None = None) -> int:
    """Inspect complete target pairs without invoking foreign executables."""
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", type=Path)
    parser.add_argument("--require-target", action="append", dest="targets",
                        help="Required target; repeat for all release platforms")
    args = parser.parse_args(argv)
    try:
        selected = []
        for target in args.targets or [target_key()]:
            for name in TOOLS:
                helper = resolve_helper(name, application=args.application,
                                        target=target, required=True)
                selected.append(helper.identity())
        print(json.dumps({"state": "complete", "helpers": selected}, indent=2))
        return 0
    except (NativeHelperError, OSError, ValueError) as error:
        print(json.dumps({"state": "failed", "message": str(error)}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
