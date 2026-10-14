"""Produce and combine the maintained terrain/matching native helper payloads.

Build-machine tool only: no downloads, dependency installation, scientific source
rewrites, GitHub Actions or recipient-side compilation. Uses the application-root
NATIVE_HELPERS.json contract shared by the existing Workbench helper resolver.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import platform
import re
import shutil
import struct
import subprocess
import sys
import sysconfig
import tempfile
import zipfile

SCHEMA = "upstate.native-helpers/v1"
TOOLS = ("terrain_flood", "matched_control_exact")
TARGETS = {
    "windows-x86_64": ("Windows", "x86_64", "x86_64-windows-gnu"),
    "macos-x86_64": ("Darwin", "x86_64", "x86_64-macos"),
    "macos-arm64": ("Darwin", "arm64", "aarch64-macos"),
    "linux-x86_64": ("Linux", "x86_64", "x86_64-linux-musl"),
    "linux-arm64": ("Linux", "arm64", "aarch64-linux-musl"),
}
LICENSES = (
    "LICENSE", "lib/libcxx/LICENSE.TXT", "lib/libcxxabi/LICENSE.TXT",
    "lib/libunwind/LICENSE.TXT", "lib/libc/mingw/COPYING",
    "lib/libc/mingw/COPYING.MinGW-w64", "lib/libc/mingw/COPYING.MinGW-w64-runtime",
    "lib/libc/musl/COPYRIGHT",
)
LOCAL_INCLUDE = re.compile(r'^\s*#\s*include\s*"([^"\n]+)"', re.MULTILINE)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for data in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(data)
    return digest.hexdigest()


def current_target() -> str:
    system, machine = platform.system(), platform.machine().lower()
    if system == "Windows":
        machine = {"win-amd64": "x86_64", "win-arm64": "arm64", "win32": "x86"}.get(sysconfig.get_platform().lower(), machine)
    machine = {"amd64": "x86_64", "aarch64": "arm64"}.get(machine, machine)
    return {"Windows": "windows", "Darwin": "macos", "Linux": "linux"}.get(system, system.lower()) + "-" + machine


def member(root: Path, name: str) -> Path:
    relative = PurePosixPath(name)
    if not name or relative.is_absolute() or str(relative) != name or "\\" in name or ":" in name or any(x in (".", "..") for x in relative.parts):
        raise ValueError("Non-relative bundle path: " + repr(name))
    result = root.joinpath(*relative.parts)
    if not result.resolve().is_relative_to(root.resolve()):
        raise ValueError("Bundle member leaves its root: " + name)
    return result


def record(root: Path, path: Path) -> dict:
    return {"path": path.relative_to(root).as_posix(), "bytes": path.stat().st_size, "sha256": sha256(path)}


def atomic_json(path: Path, value: dict) -> None:
    fd, name = tempfile.mkstemp(prefix=".manifest-", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as stream:
            json.dump(value, stream, indent=2, sort_keys=True, allow_nan=False)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, path)
    finally:
        Path(name).unlink(missing_ok=True)


def inspect_executable(path: Path) -> dict:
    """Read actual PE/ELF/Mach-O headers and OS-loader references, without running."""
    data = path.read_bytes()
    if data[:2] == b"MZ" and len(data) >= 64:
        pe = struct.unpack_from("<I", data, 60)[0]
        if data[pe:pe + 4] != b"PE\0\0":
            raise ValueError("Invalid PE header")
        machine, sections = struct.unpack_from("<HH", data, pe + 4)
        optional_size, flags = struct.unpack_from("<HH", data, pe + 20)
        optional = pe + 24
        if machine != 0x8664 or struct.unpack_from("<H", data, optional)[0] != 0x20b or flags & 0x2000:
            raise ValueError("Expected a PE32+ AMD64 executable, not a DLL")
        os_version = struct.unpack_from("<HH", data, optional + 40)
        subsystem_version = struct.unpack_from("<HH", data, optional + 48)
        table = optional + optional_size
        def rva_offset(rva: int) -> int:
            for i in range(sections):
                base = table + i * 40
                virtual_size, address, size, offset = struct.unpack_from("<IIII", data, base + 8)
                if address <= rva < address + max(virtual_size, size):
                    return offset + rva - address
            raise ValueError("PE import points outside its sections")
        libraries = []
        import_rva, import_size = struct.unpack_from("<II", data, optional + 120)
        if import_rva and import_size:
            cursor = rva_offset(import_rva)
            while any(data[cursor:cursor + 20]):
                name_rva = struct.unpack_from("<I", data, cursor + 12)[0]
                offset = rva_offset(name_rva)
                end = data.find(b"\0", offset, offset + 4096)
                if end < 0:
                    raise ValueError("Unterminated PE import name")
                libraries.append(data[offset:end].decode("ascii"))
                cursor += 20
        return {"format": "pe", "target": "windows-x86_64", "libraries": libraries,
                "minimum_os_version": ".".join(map(str, os_version)),
                "subsystem_version": ".".join(map(str, subsystem_version))}
    if data[:4] == b"\xcf\xfa\xed\xfe" and len(data) >= 32:
        cpu, _, filetype, count, command_bytes = struct.unpack_from("<IIIII", data, 4)
        machine = {0x01000007: "x86_64", 0x0100000c: "arm64"}.get(cpu)
        if not machine or filetype != 2 or command_bytes > len(data) - 32:
            raise ValueError("Expected a thin 64-bit Mach-O executable")
        result = {"format": "mach-o", "target": "macos-" + machine, "libraries": [], "rpaths": [], "code_signature": False}
        offset = 32
        for _ in range(count):
            command, size = struct.unpack_from("<II", data, offset)
            if size < 8 or offset + size > 32 + command_bytes:
                raise ValueError("Invalid Mach-O load command")
            entry = data[offset:offset + size]
            if command in (0xc, 0x80000018, 0x8000001f, 0x8000001c):
                start = struct.unpack_from("<I", entry, 8)[0]
                name = entry[start:].split(b"\0", 1)[0].decode("utf-8")
                result["rpaths" if command == 0x8000001c else "libraries"].append(name)
            if command in (0x24, 0x32):
                version = struct.unpack_from("<I", entry, 12 if command == 0x32 else 8)[0]
                result["minimum_os_version"] = f"{version >> 16}.{(version >> 8) & 255}.{version & 255}"
            if command == 0x1d:
                location, length = struct.unpack_from("<II", entry, 8)
                result["code_signature"] = length > 0 and location + length <= len(data)
            offset += size
        return result
    if data[:6] == b"\x7fELF\x02\x01" and len(data) >= 64:
        machine = {62: "x86_64", 183: "arm64"}.get(struct.unpack_from("<H", data, 18)[0])
        if not machine:
            raise ValueError("Unsupported ELF architecture")
        return {"format": "elf", "target": "linux-" + machine, "minimum_os_version": None}
    raise ValueError("Unknown executable format: " + str(path))


def source_closure(application: Path, tool: str) -> dict[str, bytes]:
    found: dict[str, bytes] = {}
    todo = ["source_tools/" + tool + ".cpp"]
    while todo:
        name = todo.pop()
        if name in found:
            continue
        path = member(application, name)
        data = path.read_bytes()
        found[name] = data
        for included in LOCAL_INCLUDE.findall(data.decode("utf-8")):
            child = (path.parent / included).resolve()
            if not child.is_relative_to(application.resolve()):
                raise ValueError("A retained local header is outside the application")
            todo.append(child.relative_to(application.resolve()).as_posix())
    return found


def build(application: Path, output: Path, targets: list[str], *, zig: Path | None = None,
          compiler: str | None = None, minimum_macos: str = "11.0") -> Path:
    application, output = application.resolve(), output.resolve()
    if output.exists():
        raise FileExistsError("Use a fresh output directory; retain the previous bundle: " + str(output))
    output.parent.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix=".native-helper-build-", dir=output.parent))
    targets = list(dict.fromkeys(targets))
    if not targets or any(target not in TARGETS for target in targets):
        raise ValueError("Select supported native targets")
    if zig:
        zig = zig.expanduser().resolve(strict=True)
        version = subprocess.run([str(zig), "version"], check=True, capture_output=True, text=True).stdout.strip()
        identity = {"kind": "zig-c++", "version": version, "sha256": sha256(zig)}
    else:
        if any(target != current_target() for target in targets):
            raise ValueError("A cross-platform build requires the explicitly supplied --zig compiler")
        compiler = compiler or shutil.which("g++") or shutil.which("clang++") or shutil.which("c++")
        if not compiler:
            raise FileNotFoundError("No C++17 compiler on this build machine")
        version = subprocess.run([compiler, "--version"], check=True, capture_output=True, text=True).stdout.splitlines()[0]
        identity = {"kind": "native-c++", "version": version}
    manifest = {"schema": SCHEMA, "producer": "ECO-HELPER-PRODUCER-7065/1.0.0",
                "created_at": datetime.now(timezone.utc).isoformat(), "platforms": {}}
    try:
        closures = {tool: source_closure(application, tool) for tool in TOOLS}
        sources = {}
        for closure in closures.values():
            for name, data in closure.items():
                if name in sources and sources[name] != data:
                    raise ValueError("Source changed during its snapshot: " + name)
                sources[name] = data
                target_file = member(stage, name)
                target_file.parent.mkdir(parents=True, exist_ok=True)
                target_file.write_bytes(data)
        # Do not label a changing source/header tree as one retained source edition.
        for name, data in sources.items():
            if member(application, name).read_bytes() != data:
                raise ValueError("Source changed during its snapshot: " + name)
        license_records = []
        if zig:
            for name in LICENSES:
                source = zig.parent / name
                if source.is_file():
                    destination = stage / "native_helpers/licenses" / (name.replace("/", "-") + ".txt")
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copyfile(source, destination)
                    license_records.append(record(stage, destination))
            if not license_records:
                raise FileNotFoundError("Keep the compiler/runtime licenses with the supplied Zig distribution")
        for target in targets:
            system, machine, triple = TARGETS[target]
            platform_record = {"platform": {"system": system, "machine": machine}, "tools": {}, "licenses": license_records}
            for tool in TOOLS:
                source_name = "source_tools/" + tool + ".cpp"
                executable = member(stage, "native_helpers/" + target + "/" + tool + (".exe" if system == "Windows" else ""))
                executable.parent.mkdir(parents=True, exist_ok=True)
                command = [str(zig), "c++", "-target", triple, "-mcpu=baseline"] if zig else [compiler]
                command.extend(["-std=c++17", "-O2", "-fno-fast-math", "-Wall", "-Wextra"])
                if system == "Windows":
                    command.extend(["-municode", "-static"])
                if system == "Darwin":
                    command.append("-mmacosx-version-min=" + minimum_macos)
                command.extend([str(member(stage, source_name)), "-o", str(executable)])
                result = subprocess.run(command, capture_output=True, text=True)
                if result.returncode:
                    raise RuntimeError(target + "/" + tool + " compile failed:\n" + result.stderr[-12000:])
                executable.chmod(0o755)
                inspected = inspect_executable(executable)
                if inspected["target"] != target:
                    raise ValueError("Compiler emitted the wrong target: " + tool)
                entry = record(stage, executable)
                entry.update(source=source_name, source_sha256=sha256(member(stage, source_name)),
                             source_files=[record(stage, member(stage, name)) for name in sorted(closures[tool])],
                             format=inspected["format"], loader=inspected,
                             build={"compiler": identity, "arguments": [arg.replace(str(stage) + os.sep, "") if i else Path(arg).name for i, arg in enumerate(command)]})
                platform_record["tools"][tool] = entry
            minima = [x["loader"].get("minimum_os_version") for x in platform_record["tools"].values()]
            platform_record["minimum_os_version"] = max((x for x in minima if x), key=lambda x: tuple(map(int, x.split("."))), default=None)
            manifest["platforms"][target] = platform_record
        atomic_json(stage / "NATIVE_HELPERS.json", manifest)
        inspect_bundle(stage)
        os.replace(stage, output)
        return output
    except BaseException:
        # Preserve compiled/source bytes for a stopped cloud seat or failed target.
        print("Retained build workspace: " + str(stage), file=sys.stderr)
        raise


def inspect_bundle(root: Path) -> dict:
    root = root.resolve()
    manifest = json.loads((root / "NATIVE_HELPERS.json").read_text(encoding="utf-8"))
    if manifest.get("schema") != SCHEMA or not manifest.get("platforms"):
        raise ValueError("Missing native helper platform manifest")
    canonical = {}
    for key, specification in manifest["platforms"].items():
        target = "macos-" + key[7:] if key.startswith("darwin-") else key
        if target in canonical and canonical[target] != specification:
            raise ValueError("Conflicting native helper platform aliases: " + target)
        canonical[target] = specification
    manifest["platforms"] = canonical
    for target, specification in canonical.items():
        if target not in TARGETS:
            raise ValueError("Unknown native helper target: " + target)
        expected_system, expected_machine, _ = TARGETS[target]
        declared = specification.get("platform", {})
        if declared.get("system") != expected_system or declared.get("machine") != expected_machine:
            raise ValueError("Platform identity differs from its target: " + target)
        for tool in TOOLS:
            entry = specification["tools"][tool]
            rows = [entry, *entry.get("source_files", []), *specification.get("licenses", [])]
            for row in rows:
                path = member(root, row["path"])
                if not path.is_file() or path.is_symlink() or path.stat().st_size != row["bytes"] or sha256(path) != row["sha256"]:
                    raise ValueError("Bundle member differs from its manifest: " + row["path"])
            if entry["source"] != "source_tools/" + tool + ".cpp" or sha256(member(root, entry["source"])) != entry["source_sha256"]:
                raise ValueError("Retained source differs from the helper build: " + tool)
            inspected = inspect_executable(member(root, entry["path"]))
            if inspected["target"] != target or inspected["format"] != entry["format"]:
                raise ValueError("Executable identity differs from its platform: " + tool)
    return manifest


def merge(output: Path, inputs: list[Path]) -> Path:
    output = output.resolve()
    if output.exists():
        raise FileExistsError("Use a fresh merged output directory")
    output.parent.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix=".helper-merge-", dir=output.parent))
    combined = {"schema": SCHEMA, "producer": "ECO-HELPER-PRODUCER-7065/1.0.0", "platforms": {}}
    try:
        for root in inputs:
            root = root.resolve()
            manifest = inspect_bundle(root)
            for target, specification in manifest["platforms"].items():
                if target in combined["platforms"] and combined["platforms"][target] != specification:
                    raise ValueError("Conflicting platform builds: " + target)
                combined["platforms"][target] = specification
                rows = list(specification.get("licenses", []))
                for tool in TOOLS:
                    entry = specification["tools"][tool]
                    rows.extend([entry, *entry.get("source_files", []), {"path": entry["source"], "sha256": entry["source_sha256"]}])
                for row in rows:
                    source, destination = member(root, row["path"]), member(stage, row["path"])
                    if destination.exists():
                        if sha256(destination) != row["sha256"]:
                            raise ValueError("Different source/dependency editions share " + row["path"])
                    else:
                        destination.parent.mkdir(parents=True, exist_ok=True)
                        shutil.copy2(source, destination)
        atomic_json(stage / "NATIVE_HELPERS.json", combined)
        inspect_bundle(stage)
        os.replace(stage, output)
        return output
    except BaseException:
        print("Retained merge workspace: " + str(stage), file=sys.stderr)
        raise


def exercise(root: Path) -> dict:
    """Execute both real kernels from the selected bundle using Unicode data paths."""
    root = root.resolve()
    manifest = inspect_bundle(root)
    target = current_target()
    tools = manifest["platforms"][target]["tools"]
    with tempfile.TemporaryDirectory(prefix="eco-helper-") as directory:
        folder = Path(directory) / "Étude 東京 Δ"; folder.mkdir()
        # Exactly the existing Priority-Flood raw arrays, dimensions and count protocol.
        z = [8.0] * 25
        for index in (6, 7, 8, 11, 12, 13, 16, 17, 18):
            z[index] = float(index % 4)
        elevation, valid, seeds, filled = [folder / name for name in ("élévation.bin", "validité.bin", "départs.bin", "sortie.bin")]
        elevation.write_bytes(struct.pack("<25d", *z)); valid.write_bytes(bytes([1] * 25))
        seeds.write_bytes(bytes(int(i // 5 in (0, 4) or i % 5 in (0, 4)) for i in range(25)))
        flood = member(root, tools["terrain_flood"]["path"])
        if os.name != "nt" and not os.access(flood, os.X_OK):
            copied = Path(directory) / flood.name; shutil.copyfile(flood, copied); copied.chmod(0o700); flood = copied
        run = subprocess.run([str(flood), "5", "5", str(elevation), str(valid), str(seeds), str(filled)], capture_output=True, text=True, check=True)
        if run.stdout.strip() != "25" or filled.read_bytes() != struct.pack("<25d", *([8.0] * 25)):
            raise ValueError("Priority-Flood protocol/result differs")
        # Existing ECO1D01/ECOPA01 protocol. Its exact minimum L1 objective is 3.
        incoming, outgoing = folder / "précipitations.bin", folder / "paires.bin"
        points = [(10, 100), (40, 101), (90, 102), (9, 200), (39, 201), (41, 202), (91, 203)]
        incoming.write_bytes(b"ECO1D01\n" + struct.pack("<QQ", 3, 4) + b"".join(struct.pack("<qQ", *point) for point in points))
        matcher = member(root, tools["matched_control_exact"]["path"])
        if os.name != "nt" and not os.access(matcher, os.X_OK):
            copied = Path(directory) / matcher.name; shutil.copyfile(matcher, copied); copied.chmod(0o700); matcher = copied
        run = subprocess.run([str(matcher), str(incoming), str(outgoing)], capture_output=True, text=True, check=True)
        metrics = json.loads(run.stdout); data = outgoing.read_bytes()
        if data[:16] != b"ECOPA01\n" + struct.pack("<Q", 3) or len(data) != 88:
            raise ValueError("Exact matcher output protocol differs")
        pairs = list(struct.iter_unpack("<QQq", data[16:]))
        values = {cell: value for value, cell in points}
        if ({p[0] for p in pairs} != {100, 101, 102} or len({p[1] for p in pairs}) != 3
                or any(p[1] not in {200, 201, 202, 203} or values[p[1]] - values[p[0]] != p[2] for p in pairs)
                or sum(abs(p[2]) for p in pairs) != 3 or metrics.get("objective_integer_units") != "3"
                or metrics.get("algorithm") != "convex-prefix-exact-l1/v1"):
            raise ValueError("Exact matcher reconstruction/objective differs")
        return {"target": target, "host": platform.platform(), "unicode_paths": True,
                "terrain_cells": 25, "terrain_output_sha256": sha256(filled),
                "matching_pairs": 3, "matching_objective_integer_units": "3", "matching_output_sha256": sha256(outgoing),
                "binary_sha256": {tool: tools[tool]["sha256"] for tool in TOOLS}}


def make_zip(root: Path, destination: Path) -> None:
    inspect_bundle(root)
    if destination.exists():
        raise FileExistsError("Preserve the existing ZIP: " + str(destination))
    if destination.resolve().is_relative_to(root.resolve()):
        raise ValueError("Write the ZIP outside its source bundle")
    with zipfile.ZipFile(destination, "x", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for path in sorted(root.rglob("*")):
            if path.is_file() and not path.is_symlink():
                archive.write(path, path.relative_to(root).as_posix())


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    item = commands.add_parser("build")
    item.add_argument("--application", type=Path, default=Path(__file__).resolve().parent.parent)
    item.add_argument("--output", type=Path, required=True)
    item.add_argument("--target", choices=TARGETS, action="append", required=True)
    item.add_argument("--zig", type=Path); item.add_argument("--compiler")
    item.add_argument("--minimum-macos", default="11.0")
    item = commands.add_parser("merge"); item.add_argument("output", type=Path); item.add_argument("inputs", type=Path, nargs="+")
    for command in ("inspect", "exercise"):
        item = commands.add_parser(command); item.add_argument("root", type=Path)
    item = commands.add_parser("zip"); item.add_argument("root", type=Path); item.add_argument("output", type=Path)
    args = parser.parse_args(argv)
    if args.command == "build":
        output = build(args.application, args.output, args.target, zig=args.zig, compiler=args.compiler, minimum_macos=args.minimum_macos)
        result = {"output": str(output), "platforms": list(inspect_bundle(output)["platforms"])}
    elif args.command == "merge":
        output = merge(args.output, args.inputs); result = {"output": str(output), "platforms": list(inspect_bundle(output)["platforms"])}
    elif args.command == "inspect":
        result = inspect_bundle(args.root)
    elif args.command == "exercise":
        result = exercise(args.root)
    else:
        make_zip(args.root, args.output); result = record(args.output.parent, args.output)
    print(json.dumps(result, indent=2, sort_keys=True, allow_nan=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
