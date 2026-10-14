"""Assemble and inspect the original Mac runtime's native-library closure.

Runs on a cloud Linux builder using only Python's standard library. It never
executes foreign code, downloads libraries, rewrites Mach-O/code signatures, or
substitutes a system Python/GIS. Optional repairs copy exact dependencies from
explicitly supplied, already-qualified prefix donors, and restore entry modes.
"""
from __future__ import annotations

import argparse
from collections import deque
import hashlib
import json
import mmap
import os
import posixpath
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import struct
import sys
import tempfile
from typing import Any

SCHEMA = "upstate.macos-native-closure/v1"
CPUS = {"macos-x86_64": 0x01000007, "macos-arm64": 0x0100000C}
MAGICS = {b"\xcf\xfa\xed\xfe": ("<", True), b"\xfe\xed\xfa\xcf": (">", True),
          b"\xce\xfa\xed\xfe": ("<", False), b"\xfe\xed\xfa\xce": (">", False)}
FAT = {b"\xca\xfe\xba\xbe": (">", False), b"\xbe\xba\xfe\xca": ("<", False),
       b"\xca\xfe\xba\xbf": (">", True), b"\xbf\xba\xfe\xca": ("<", True)}
LOADS = {0xC: "load", 0x80000018: "weak", 0x8000001F: "reexport",
         0x20: "lazy", 0x80000023: "upward"}
SYSTEM_ROOTS = ("/usr/lib/", "/System/Library/")


class BundleError(ValueError):
    """An original artifact cannot be interpreted or safely assembled."""


def digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(block)
    return value.hexdigest()


def _version(value: int) -> str:
    return f"{value >> 16}.{value >> 8 & 255}.{value & 255}"


def version_tuple(value: str) -> tuple[int, int, int]:
    if not re.fullmatch(r"\d+(?:\.\d+){0,2}", str(value)):
        raise BundleError(f"Invalid macOS version: {value!r}")
    values = tuple(map(int, str(value).split(".")))
    return (values + (0, 0))[:3]


def target_key(target: str) -> str:
    target = target.replace("darwin-", "macos-")
    if target not in CPUS:
        raise BundleError(f"Unsupported Mac target: {target}")
    return target


def _slice(data: Any, offset: int, size: int) -> dict[str, Any]:
    if size < 28 or offset < 0 or offset + size > len(data):
        raise BundleError("Truncated Mach-O slice")
    magic = bytes(data[offset:offset + 4])
    if magic not in MAGICS:
        raise BundleError("A universal slice is not Mach-O")
    endian, wide = MAGICS[magic]
    header = 32 if wide else 28
    if size < header:
        raise BundleError("Truncated Mach-O header")
    cpu, subtype, filetype, count, command_bytes, flags = struct.unpack_from(endian + "6I", data, offset + 4)
    end = offset + header + command_bytes
    if command_bytes > size - header or count > command_bytes // 8:
        raise BundleError("Mach-O load-command bounds are inconsistent")
    result: dict[str, Any] = dict(cpu=cpu, subtype=subtype, bits=64 if wide else 32,
        filetype=filetype, flags=flags, rpaths=[], dependencies=[], minimum_os=[],
        install_id=None, code_signature=None)
    position = offset + header
    for _ in range(count):
        if position + 8 > end:
            raise BundleError("Truncated Mach-O load command")
        command, length = struct.unpack_from(endian + "II", data, position)
        if length < 8 or length % (8 if wide else 4) or position + length > end:
            raise BundleError("Invalid Mach-O load-command size")
        def string_at(field: int, minimum: int) -> str:
            if length < minimum:
                raise BundleError("Truncated Mach-O string command")
            index = struct.unpack_from(endian + "I", data, position + field)[0]
            if not minimum <= index < length:
                raise BundleError("Invalid Mach-O load-command string offset")
            raw = bytes(data[position + index:position + length])
            if b"\0" not in raw:
                raise BundleError("Unterminated Mach-O load-command string")
            return raw.split(b"\0", 1)[0].decode("utf-8", "strict")
        if command in LOADS or command == 0xD:
            name = string_at(8, 24)
            _, current, compatible = struct.unpack_from(endian + "III", data, position + 12)
            if command == 0xD:
                result["install_id"] = name
                result["compatibility_version"] = _version(compatible)
                result["current_version"] = _version(current)
            else:
                result["dependencies"].append(dict(name=name, kind=LOADS[command],
                    compatibility_version=_version(compatible), current_version=_version(current)))
        elif command == 0x8000001C:
            result["rpaths"].append(string_at(8, 12))
        elif command == 0x24:
            if length < 16:
                raise BundleError("Truncated macOS version command")
            minimum, sdk = struct.unpack_from(endian + "II", data, position + 8)
            result["minimum_os"].append(dict(platform=1, minimum=_version(minimum), sdk=_version(sdk)))
        elif command == 0x32:
            if length < 24:
                raise BundleError("Truncated build-version command")
            platform_id, minimum, sdk, tools = struct.unpack_from(endian + "4I", data, position + 8)
            if tools > (length - 24) // 8:
                raise BundleError("Truncated build-tool records")
            result["minimum_os"].append(dict(platform=platform_id, minimum=_version(minimum), sdk=_version(sdk)))
        elif command in (0x25, 0x2F, 0x30):
            # iOS, tvOS, watchOS legacy version commands are not macOS slices.
            result["minimum_os"].append(dict(platform={0x25: 2, 0x2F: 3, 0x30: 4}[command], minimum="0.0.0", sdk="0.0.0"))
        elif command == 0x1D:
            if length < 16:
                raise BundleError("Truncated code-signature command")
            start, amount = struct.unpack_from(endian + "II", data, position + 8)
            if start > size or amount > size - start:
                raise BundleError("Code signature is outside its Mach-O slice")
            result["code_signature"] = dict(bytes=amount)
        position += length
    if position != end:
        raise BundleError("Mach-O command count does not consume its declared table")
    return result


def inspect_macho(path: Path) -> list[dict[str, Any]]:
    """Decode thin/universal headers and load commands without otool or a Mac."""
    size = path.stat().st_size
    if size < 4:
        return []
    with path.open("rb") as stream:
        magic = stream.read(4)
        if magic not in MAGICS and magic not in FAT:
            return []
        with mmap.mmap(stream.fileno(), 0, access=mmap.ACCESS_READ) as data:
            if magic in MAGICS:
                return [_slice(data, 0, size)]
            if size < 8:
                raise BundleError("Truncated universal header")
            endian, wide = FAT[magic]
            count = struct.unpack_from(endian + "I", data, 4)[0]
            width = 32 if wide else 20
            table_end = 8 + count * width
            if not 0 < count <= 64 or table_end > size:
                raise BundleError("Invalid universal architecture table")
            slices, spans, cpus = [], [], set()
            for index in range(count):
                at = 8 + index * width
                cpu, subtype = struct.unpack_from(endian + "II", data, at)
                offset, amount, align = struct.unpack_from(endian + ("QQI" if wide else "III"), data, at + 8)
                if align > 31 or offset < table_end or offset % (1 << align) or offset + amount > size:
                    raise BundleError("Invalid universal slice bounds/alignment")
                if any(offset < b and a < offset + amount for a, b in spans):
                    raise BundleError("Overlapping universal slices")
                identity = (cpu, subtype)
                if identity in cpus:
                    raise BundleError("Duplicate universal CPU/subtype")
                value = _slice(data, offset, amount)
                if (value["cpu"], value["subtype"]) != identity:
                    raise BundleError("Universal table CPU disagrees with its slice")
                spans.append((offset, offset + amount))
                cpus.add(identity)
                slices.append(value)
            return slices


def selected_slice(slices: list[dict[str, Any]], target: str) -> dict[str, Any]:
    cpu = CPUS[target_key(target)]
    baseline = 3 if cpu == CPUS["macos-x86_64"] else 0
    available = [item for item in slices if item["cpu"] == cpu and item["bits"] == 64
                 and item["subtype"] & 0xFFFFFF == baseline]
    if len(available) != 1:
        raise BundleError(f"Expected one baseline {target} slice, found {len(available)}")
    value = available[0]
    if any(row["platform"] != 1 for row in value["minimum_os"]):
        raise BundleError("Selected CPU slice targets another Apple OS")
    return value


def relative(root: Path, path: Path) -> str:
    return path.relative_to(root).as_posix()


def inside(root: Path, path: Path, *, existing: bool = False) -> Path:
    """Resolve symlinks as well as lexical containment; never follow a donor out."""
    try:
        value = path.resolve(strict=existing)
        value.relative_to(root)
    except (ValueError, OSError, RuntimeError) as exc:
        raise BundleError(f"Path is missing or leaves the selected prefix: {path.name}") from exc
    return value


def _ordered(values):
    return list(dict.fromkeys(values))


class Bundle:
    def __init__(self, root: Path, target: str, *, mapped_prefixes=(), python="bin/python"):
        self.root = root.resolve(strict=True)
        if not self.root.is_dir():
            raise BundleError("Runtime prefix must be a directory")
        self.target = target_key(target)
        self.mapped_prefixes = tuple(str(PurePosixPath(p)).rstrip("/") for p in mapped_prefixes)
        if any(not p.startswith("/") or p == "" for p in self.mapped_prefixes):
            raise BundleError("Mapped original prefixes must be absolute non-root paths")
        if Path(python).is_absolute() or ".." in PurePosixPath(python).parts:
            raise BundleError("Selected interpreter must be prefix-relative")
        self.python = python
        self.images: dict[str, dict[str, Any]] = {}
        self.problems: list[dict[str, Any]] = []
        self.warnings: list[dict[str, Any]] = []
        self.links: list[dict[str, str]] = []
        self.relocations: list[dict[str, str]] = []
        self.minimum = (0, 0, 0)
        self.packages: list[dict[str, Any]] = []

    def problem(self, code, path, **detail):
        self.problems.append(dict(code=code, path=path, **detail))

    def inventory(self):
        for directory, subdirs, filenames in os.walk(self.root, followlinks=False):
            subdirs.sort()
            for name in sorted(subdirs + filenames):
                path = Path(directory) / name
                rel = relative(self.root, path)
                try:
                    mode = path.lstat().st_mode
                    if stat.S_ISLNK(mode):
                        target = os.readlink(path)
                        inside(self.root, path, existing=True)
                        self.links.append(dict(path=rel, target=target))
                        if os.path.isabs(target):
                            self.problem("absolute_symlink_requires_relocation", rel, target=target)
                        continue
                    if not stat.S_ISREG(mode):
                        continue
                    slices = inspect_macho(path)
                    if not slices:
                        if path.suffix in (".so", ".dylib", ".node"):
                            self.problem("foreign_or_unreadable_native_library", rel)
                        continue
                    # Static object files/debug companions are not loadable runtime images.
                    if all(row["filetype"] not in (2, 6, 8) for row in slices):
                        continue
                    chosen = selected_slice(slices, self.target)
                    if chosen["filetype"] not in (2, 6, 8):
                        raise BundleError("Selected slice is not a loadable runtime image")
                    if not chosen["minimum_os"]:
                        self.warnings.append(dict(code="missing_os_version_command", path=rel))
                    for row in chosen["minimum_os"]:
                        self.minimum = max(self.minimum, version_tuple(row["minimum"]))
                    record = dict(chosen, path=rel, bytes=path.stat().st_size,
                                  sha256=digest(path), mode=stat.S_IMODE(mode),
                                  available_cpus=[row["cpu"] for row in slices])
                    self.images[rel] = record
                    if chosen["filetype"] == 2 and not mode & 0o111:
                        self.problem("missing_executable_mode", rel)
                    tags = re.findall(r"\.cpython-(\d+)", path.name)
                    if tags and any(tag != "312" for tag in tags):
                        self.problem("wrong_cpython_extension", rel, found=tags, expected="312")
                except (BundleError, OSError, UnicodeError) as exc:
                    self.problem("invalid_native_member", rel, error=str(exc))
        metadata = self.root / "conda-meta"
        if metadata.is_dir():
            for path in sorted(metadata.glob("*.json")):
                try:
                    body = json.loads(path.read_text(encoding="utf-8"))
                    if not isinstance(body, dict) or not isinstance(body.get("depends", []), list):
                        raise BundleError("Invalid original conda metadata record")
                    row = {k: body.get(k) for k in ("name", "version", "build", "subdir", "license")}
                    row["metadata_sha256"] = digest(path)
                    self.packages.append(row)
                    expected = "osx-64" if self.target.endswith("x86_64") else "osx-arm64"
                    if body.get("subdir") not in (None, "noarch", expected):
                        self.problem("foreign_conda_package", relative(self.root, path), subdir=body["subdir"])
                    for requirement in body.get("depends", []):
                        if not isinstance(requirement, str):
                            raise BundleError("Invalid conda dependency requirement")
                        if requirement.startswith("__osx"):
                            # Report supported lower bounds; do not implement a second conda solver.
                            match = re.search(r">=\s*(\d+(?:\.\d+){0,2})", requirement)
                            if match:
                                self.minimum = max(self.minimum, version_tuple(match.group(1)))
                except (ValueError, OSError) as exc:
                    self.problem("invalid_conda_metadata", relative(self.root, path), error=str(exc))
        return self

    def expand(self, value: str, loader: str, executable: str) -> Path | None:
        if value == "@loader_path" or value.startswith("@loader_path/"):
            return self.root / Path(loader).parent / value[len("@loader_path"):].lstrip("/")
        if value == "@executable_path" or value.startswith("@executable_path/"):
            return self.root / Path(executable).parent / value[len("@executable_path"):].lstrip("/")
        if value.startswith("/"):
            for old in self.mapped_prefixes:
                if value == old or value.startswith(old + "/"):
                    suffix = value[len(old):].lstrip("/")
                    self.relocations.append(dict(path=loader, original=value, relative=suffix))
                    return self.root / suffix
            return Path(value)
        return None

    def image_for(self, path: Path) -> tuple[str, dict[str, Any]] | None:
        try:
            real = inside(self.root, path, existing=True)
        except BundleError:
            return None
        rel = relative(self.root, real)
        return (rel, self.images[rel]) if rel in self.images else None

    def closure(self):
        edges, covered, seen = [], set(), set()
        executables = [name for name, value in self.images.items() if value["filetype"] == 2]
        primary = self.image_for(self.root / self.python)
        if primary is None:
            self.problem("missing_selected_python", self.python)
        if primary is not None and primary[1]["filetype"] != 2:
            self.problem("selected_python_not_executable", self.python)
        primary_name = primary[0] if primary else self.python
        queue = deque((name, name, ()) for name in executables)
        # dlopen extensions are independent roots in the selected interpreter's context.
        inherited = ()
        if primary:
            inherited = tuple(self.expand(r, primary_name, primary_name) for r in primary[1]["rpaths"])
            inherited = tuple(p for p in inherited if p is not None)
        deferred = deque(name for name, image in self.images.items() if image["filetype"] in (6, 8))
        while queue or deferred:
            if not queue:
                orphan = deferred.popleft()
                if orphan in covered:
                    continue
                queue.append((orphan, primary_name, inherited))
            name, executable, inherited = queue.popleft()
            image = self.images[name]
            local = [self.expand(r, name, executable) for r in image["rpaths"]]
            runpaths = tuple(_ordered(Path(os.path.normpath(p)) for p in
                                      [p for p in local if p is not None] + list(inherited)))
            key = (name, executable, tuple(str(p) for p in runpaths))
            if key in seen:
                continue
            seen.add(key)
            covered.add(name)
            for dep in image["dependencies"]:
                requested = dep["name"]
                edge = dict(source=name, executable=executable, name=requested, kind=dep["kind"])
                if posixpath.normpath(requested).startswith(SYSTEM_ROOTS):
                    edge["resolution"] = "system"
                    edges.append(edge)
                    continue
                if requested.startswith("@rpath/"):
                    paths = [p / requested[len("@rpath/"):] for p in runpaths]
                else:
                    path = self.expand(requested, name, executable)
                    paths = [] if path is None else [path]
                candidates = []
                resolved = None
                system_path = None
                for path in paths:
                    normalized = posixpath.normpath(str(path))
                    if normalized.startswith(SYSTEM_ROOTS):
                        system_path = normalized
                        break
                    try:
                        actual = inside(self.root, path)
                        candidate = relative(self.root, actual)
                    except BundleError:
                        continue
                    candidates.append(candidate)
                    found = self.image_for(path)
                    if found is not None:
                        resolved = found
                        break
                if system_path is not None:
                    edge.update(resolution="system", destination=system_path)
                elif resolved:
                    target_name, target_image = resolved
                    if target_image["filetype"] != 6:
                        self.problem("dependency_is_not_dylib", name, name=requested,
                                     dependency=target_name, filetype=target_image["filetype"])
                    available = target_image.get("current_version", "0.0.0")
                    required = dep["compatibility_version"]
                    if version_tuple(available) < version_tuple(required):
                        self.problem("incompatible_library_version", name, name=requested,
                                     dependency=target_name, required=required, available=available)
                    edge.update(resolution="bundled", destination=target_name)
                    queue.append((target_name, executable, runpaths))
                else:
                    edge.update(resolution="weak_missing" if dep["kind"] == "weak" else "missing",
                                candidates=_ordered(candidates))
                    if dep["kind"] != "weak":
                        self.problem("missing_dependency", name, name=requested,
                                     executable=executable, candidates=edge["candidates"])
                edges.append(edge)
        unique = {json.dumps(row, sort_keys=True): row for row in edges}
        self.edges = list(unique.values())
        return self

    def result(self, advertised_minimum=None):
        if advertised_minimum and version_tuple(advertised_minimum) < self.minimum:
            self.problem("minimum_os_understated", "NATIVE_RUNTIME.json", declared=advertised_minimum,
                         required=".".join(map(str, self.minimum)))
        problems = list({json.dumps(p, sort_keys=True): p for p in self.problems}.values())
        relocations = list({json.dumps(p, sort_keys=True): p for p in self.relocations}.values())
        return dict(schema=SCHEMA, target=self.target, status=("needs_repair" if problems else "prepared_for_relocation" if relocations else "ready"),
            inspection="static native dependency closure; native execution is performed by the existing receiver",
            minimum_os_version=".".join(map(str, self.minimum)),
            images=list(self.images.values()), dependencies=self.edges, symlinks=self.links,
            packages=self.packages, required_prefix_relocations=relocations,
            problems=problems, warnings=self.warnings,
            native_runtime_fragment=dict(platform=dict(system="Darwin", machine=self.target[6:]),
                                         minimum_os_version=".".join(map(str, self.minimum))))


def inspect_prefix(prefix: Path, target: str, *, mapped_prefixes=(), python="bin/python", minimum_os=None):
    return Bundle(Path(prefix), target, mapped_prefixes=mapped_prefixes, python=python).inventory().closure().result(minimum_os)


def _copy_exact(source: Path, destination: Path) -> str:
    """Create-only publication. Retrying a completed equal-byte copy is harmless."""
    expected = digest(source)
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        if digest(destination) != expected:
            raise BundleError(f"Refusing to replace existing different library: {destination.name}")
        return expected
    fd, temporary = tempfile.mkstemp(prefix=".mac-library-", dir=destination.parent)
    temporary = Path(temporary)
    try:
        with os.fdopen(fd, "wb") as output, source.open("rb") as incoming:
            shutil.copyfileobj(incoming, output, 1024 * 1024)
            output.flush()
            os.fsync(output.fileno())
        if digest(temporary) != expected or digest(source) != expected:
            raise BundleError("Source library changed during its copy")
        os.chmod(temporary, stat.S_IMODE(source.stat().st_mode))
        # Same-directory hard-link publication is atomic and create-only on the
        # Linux/APFS/NTFS build staging volumes. Never leave a partial public body.
        try:
            os.link(temporary, destination, follow_symlinks=False)
        except FileExistsError:
            if digest(destination) != expected:
                raise BundleError("Concurrent different dependency publication")
        if digest(destination) != expected:
            raise BundleError("Published library checksum differs")
        return expected
    finally:
        temporary.unlink(missing_ok=True)


def _package_owners(root: Path) -> dict[str, dict[str, Any]]:
    """Original conda package identities, not a second dependency solver."""
    owners = {}
    for path in sorted((root / "conda-meta").glob("*.json")):
        try:
            body = json.loads(path.read_text(encoding="utf-8"))
        except ValueError as exc:
            raise BundleError(f"Invalid conda metadata: {path.name}") from exc
        if not isinstance(body, dict) or not isinstance(body.get("files", []), list):
            raise BundleError(f"Invalid conda original file inventory: {path.name}")
        pin = {key: body.get(key) for key in ("name", "version", "build", "subdir", "sha256", "md5")}
        entry = dict(pin=pin, license=body.get("license"), metadata_sha256=digest(path))
        for member in body.get("files", []):
            if not isinstance(member, str):
                raise BundleError("Invalid conda original file inventory")
            prior = owners.get(member)
            if prior is not None and prior.get("pin") != pin:
                # Shared documentation paths can legitimately overlap. Only an
                # ambiguous required native library prevents selecting a donor.
                owners[member] = dict(ambiguous=True)
            else:
                owners[member] = entry
    return owners


def _sealed_member(root: Path, path: Path) -> bool:
    """Do not alter symlinks covered by a nested app/framework resource seal."""
    return any((parent / "_CodeSignature").exists() or
               (parent / "Contents" / "_CodeSignature").exists()
               for parent in (path.parent, *path.parents)
               if parent == root or parent.is_relative_to(root))


def _repair_links(root: Path, mapped_prefixes, operations):
    # Mapping is explicit and stays inside the received prefix. Iterate so a
    # python -> python3 -> python3.12 alias chain can be received in any order.
    while True:
        changed = False
        for directory, dirs, files in os.walk(root, followlinks=False):
            dirs.sort()
            for name in sorted(dirs + files):
                path = Path(directory) / name
                if not path.is_symlink():
                    continue
                original = os.readlink(path)
                if not original.startswith("/") or _sealed_member(root, path):
                    continue
                candidate = Path(original)
                for old in mapped_prefixes:
                    old = str(PurePosixPath(old)).rstrip("/")
                    if old and (original == old or original.startswith(old + "/")):
                        candidate = root / original[len(old):].lstrip("/")
                        break
                try:
                    actual = inside(root, candidate, existing=True)
                except BundleError:
                    continue
                if os.readlink(path) != original:
                    raise BundleError("Symlink changed during runtime assembly")
                link = os.path.relpath(actual, path.parent)
                # A private sibling directory prevents a stale temporary name
                # from breaking interrupted assembly or colliding with peers.
                temporary_dir = Path(tempfile.mkdtemp(prefix=".mac-link-", dir=path.parent))
                try:
                    temporary = temporary_dir / "link"
                    os.symlink(link, temporary)
                    os.replace(temporary, path)
                finally:
                    shutil.rmtree(temporary_dir)
                operations.append(dict(action="relative_symlink", path=relative(root, path), target=link))
                changed = True
        if not changed:
            return


def assemble_prefix(prefix: Path, target: str, *, donors=(), mapped_prefixes=(),
                    python="bin/python", executables=(), minimum_os=None):
    """Fill missing native dependencies from selected prefix donors and retain bytes.

    Only the exact relative load candidate is eligible; there is no basename
    search, PATH lookup, automatic network access or foreign-package solver.
    Call on a staged runtime, before its original packer freezes the archive.
    """
    root = Path(prefix).resolve(strict=True)
    target = target_key(target)
    donors = [Path(value).resolve(strict=True) for value in donors]
    mapped_prefixes = tuple(mapped_prefixes)
    operations = []
    expected_owners = _package_owners(root)
    donor_owners = {donor: _package_owners(donor) for donor in donors}
    # Validate mapping syntax before any writes.
    Bundle(root, target, mapped_prefixes=mapped_prefixes, python=python)
    _repair_links(root, mapped_prefixes, operations)
    while True:
        result = inspect_prefix(root, target, mapped_prefixes=mapped_prefixes, python=python)
        added = 0
        for problem in result["problems"]:
            if problem["code"] != "missing_dependency":
                continue
            for candidate in problem["candidates"]:
                destination = inside(root, root / candidate)
                if destination.exists():
                    continue
                originals = []
                for donor in donors:
                    try:
                        source = inside(donor, donor / candidate, existing=True)
                        if not source.is_file():
                            continue
                        chosen = selected_slice(inspect_macho(source), target)
                        if chosen["filetype"] != 6:
                            continue
                    except (BundleError, OSError):
                        continue
                    metadata = donor_owners[donor].get(candidate) or donor_owners[donor].get(relative(donor, source))
                    expected = expected_owners.get(candidate)
                    if (expected and expected.get("ambiguous")) or (metadata and metadata.get("ambiguous")):
                        raise BundleError(f"Ambiguous native package ownership: {candidate}")
                    if expected and (not metadata or expected["pin"] != metadata["pin"]):
                        raise BundleError(f"Donor package differs from the selected original pin: {candidate}")
                    originals.append((source, digest(source), metadata))
                hashes = {row[1] for row in originals}
                if len(hashes) > 1:
                    raise BundleError(f"Donors disagree on exact required library: {candidate}")
                if originals:
                    actual = _copy_exact(originals[0][0], destination)
                    operations.append(dict(action="copy_original_dependency", path=candidate, sha256=actual,
                                           package=originals[0][2]))
                    added += 1
                    break
        if not added:
            break
    _repair_links(root, mapped_prefixes, operations)
    names = set(executables) | {row["path"] for row in result["images"] if row["filetype"] == 2}
    for name in sorted(names):
        if Path(name).is_absolute() or ".." in PurePosixPath(name).parts:
            raise BundleError("Declared executables must be prefix-relative")
        path = inside(root, root / name, existing=True)
        if not path.is_file():
            raise BundleError(f"Declared executable is not a regular file: {name}")
        mode = stat.S_IMODE(path.stat().st_mode)
        if not mode & 0o111:
            new_mode = mode | ((mode & 0o444) >> 2)
            if not new_mode & 0o111:
                raise BundleError(f"Cannot infer executable access for unreadable file: {name}")
            os.chmod(path, new_mode)
            operations.append(dict(action="executable_mode", path=name, before=mode, after=new_mode,
                                   sha256=digest(path)))
    result = inspect_prefix(root, target, mapped_prefixes=mapped_prefixes, python=python, minimum_os=minimum_os)
    result["assembly_operations"] = operations
    return result


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("prefix", type=Path)
    parser.add_argument("--target", required=True, choices=tuple(CPUS))
    parser.add_argument("--python", default="bin/python", help="Selected prefix-relative interpreter")
    parser.add_argument("--map-prefix", action="append", default=[], help="Explicit original prefix handled by the existing relocator")
    parser.add_argument("--minimum-os", help="Check the final advertised minimum against actual selected slices/packages")
    parser.add_argument("--assemble", action="store_true", help="Repair a staged prefix using exact selected donor bytes and file modes")
    parser.add_argument("--donor", type=Path, action="append", default=[])
    parser.add_argument("--executable", action="append", default=[], help="Additional prefix-relative script whose execution mode must be retained")
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args(argv)
    try:
        options = dict(mapped_prefixes=args.map_prefix, python=args.python, minimum_os=args.minimum_os)
        if args.assemble:
            result = assemble_prefix(args.prefix, args.target, donors=args.donor, executables=args.executable, **options)
        else:
            if args.donor or args.executable:
                parser.error("--donor and --executable require --assemble")
            result = inspect_prefix(args.prefix, args.target, **options)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"{args.target}: {len(result['images'])} native images; {len(result['dependencies'])} dependency edges; "
              f"minimum macOS {result['minimum_os_version']}; {len(result['problems'])} repair items")
        for item in result["problems"][:12]:
            print(f"  {item['code']}: {item['path']} {item.get('name', '')}")
        print(f"Full result: {args.output}")
        return 1 if result["status"] == "needs_repair" else 0
    except (BundleError, OSError, UnicodeError) as exc:
        print(f"Mac runtime assembly: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
