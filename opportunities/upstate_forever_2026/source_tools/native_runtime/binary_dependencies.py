"""Read native runtime loader metadata without executing a target binary.

Windows PE imports (including delay imports and forwarded exports), Darwin
thin/universal Mach-O load commands, and Linux ELF dynamic tables. All returned
paths are strings from the binary; no host library search or subprocess occurs.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
import mmap
from pathlib import Path
import struct
from typing import Any


class BinaryError(ValueError):
    """A recognized image has malformed or unsupported loader metadata."""


@dataclass(frozen=True)
class Dependency:
    name: str
    kind: str = "required"


@dataclass
class Image:
    format: str
    architecture: str
    bits: int
    kind: str
    dependencies: list[Dependency] = field(default_factory=list)
    rpaths: list[str] = field(default_factory=list)
    runpaths: list[str] = field(default_factory=list)
    identity: str | None = None
    interpreter: str | None = None
    minimum_os_version: str | None = None
    os_platform: int | None = None
    cpu_subtype: int | None = None
    byte_order: str = "little"
    slice_offset: int = 0
    slice_size: int = 0

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class Reader:
    def __init__(self, data: Any, offset: int = 0, size: int | None = None):
        self.data, self.offset = data, offset
        self.size = len(data) - offset if size is None else size
        if offset < 0 or self.size < 0 or offset + self.size > len(data):
            raise BinaryError("Image range is outside the file")

    def require(self, offset: int, size: int) -> None:
        if offset < 0 or size < 0 or offset > self.size - size:
            raise BinaryError(f"Image range {offset}+{size} is outside {self.size} bytes")

    def unpack(self, fmt: str, offset: int) -> tuple:
        self.require(offset, struct.calcsize(fmt))
        return struct.unpack_from(fmt, self.data, self.offset + offset)

    def bytes(self, offset: int, size: int) -> bytes:
        self.require(offset, size)
        return self.data[self.offset + offset:self.offset + offset + size]

    def text(self, offset: int, limit: int = 65536) -> str:
        self.require(offset, 1)
        end = min(self.offset + self.size, self.offset + offset + limit)
        zero = self.data.find(b"\0", self.offset + offset, end)
        if zero < 0:
            raise BinaryError("Unterminated loader string")
        try:
            return self.data[self.offset + offset:zero].decode("utf-8", "strict")
        except UnicodeDecodeError as exc:
            raise BinaryError("Invalid UTF-8 loader string") from exc


def _version(value: int) -> str:
    return f"{value >> 16}.{(value >> 8) & 255}.{value & 255}"


def _unique(deps: list[Dependency]) -> list[Dependency]:
    return list(dict.fromkeys(deps))


def _pe(r: Reader) -> Image:
    pe = r.unpack("<I", 60)[0]
    if r.bytes(pe, 4) != b"PE\0\0":
        raise BinaryError("Invalid PE signature")
    machine, nsects, _, _, _, optsize, flags = r.unpack("<HHIIIHH", pe + 4)
    architecture = {0x8664: "x86_64", 0xAA64: "arm64", 0x14C: "x86"}.get(machine, hex(machine))
    if not 1 <= nsects <= 4096:
        raise BinaryError("Invalid PE section count")
    opt = pe + 24
    r.require(opt, optsize)
    magic = r.unpack("<H", opt)[0]
    if magic == 0x20B:
        bits, dd, countat = 64, 112, 108
        imagebase = r.unpack("<Q", opt + 24)[0]
    elif magic == 0x10B:
        bits, dd, countat = 32, 96, 92
        imagebase = r.unpack("<I", opt + 28)[0]
    else:
        raise BinaryError("Expected PE32 or PE32+ optional header")
    if optsize < dd:
        raise BinaryError("Truncated PE optional header")
    count = r.unpack("<I", opt + countat)[0]
    if count > (optsize - dd) // 8:
        raise BinaryError("PE data-directory count exceeds optional header")
    header_size = r.unpack("<I", opt + 60)[0]
    major, minor = r.unpack("<HH", opt + 48)  # subsystem version, not a marketing Windows release
    sections = []
    for i in range(nsects):
        section = opt + optsize + 40 * i
        virtual_size, va, rawsize, raw = r.unpack("<IIII", section + 8)
        if rawsize:
            r.require(raw, rawsize)
        sections.append((va, virtual_size, rawsize, raw))

    def location(rva: int, size: int = 1) -> int:
        if rva < header_size:
            if rva + size > header_size:
                raise BinaryError("PE RVA crosses header boundary")
            r.require(rva, size)
            return rva
        matches = [(raw + rva - va, rawsize - (rva - va))
                   for va, vs, rawsize, raw in sections
                   if va <= rva < va + max(vs, rawsize)]
        if len(matches) != 1 or matches[0][1] < size:
            raise BinaryError("Unmapped, ambiguous or zero-filled PE RVA")
        offset = matches[0][0]
        r.require(offset, size)
        return offset

    def directory(index: int) -> tuple[int, int]:
        return r.unpack("<II", opt + dd + index * 8) if count > index else (0, 0)

    def name(rva: int) -> str:
        # Bound a string by its file-backed section, not a neighboring section.
        off = location(rva)
        remain = next((rawsize - (rva - va) for va, _, rawsize, _ in sections
                       if va <= rva < va + rawsize), header_size - rva)
        return r.text(off, min(remain, 65536))

    image = Image("pe", architecture, bits, "library" if flags & 0x2000 else "executable",
                  minimum_os_version=f"{major}.{minor}", slice_size=r.size)
    for index, stride, kind in ((1, 20, "required"), (13, 32, "delay")):
        address, size = directory(index)
        if not address:
            continue
        if size < stride or size // stride > 65536:
            raise BinaryError("Invalid PE import directory size")
        terminated = False
        for i in range(size // stride):
            row = r.unpack("<" + "I" * (stride // 4), location(address + i * stride, stride))
            if not any(row):
                terminated = True
                break
            if index == 1:
                dll = row[3]
            else:
                if row[0] & ~1:
                    raise BinaryError("Unknown delay-import address attributes")
                dll = row[1] if row[0] & 1 else row[1] - imagebase
            image.dependencies.append(Dependency(name(dll), kind))
        if not terminated:
            raise BinaryError("Unterminated PE import directory")
    # Forwarded exports may add a dependency absent from the normal import table.
    address, size = directory(0)
    if address and size:
        off = location(address, 40)
        nfunctions, functions = r.unpack("<I", off + 20)[0], r.unpack("<I", off + 28)[0]
        if nfunctions > 1000000:
            raise BinaryError("Oversized PE export table")
        for i in range(nfunctions):
            target = r.unpack("<I", location(functions + i * 4, 4))[0]
            if address <= target < address + size:
                forward = name(target)
                if "." not in forward:
                    raise BinaryError("Malformed PE forwarded export")
                dll = forward.rsplit(".", 1)[0]
                image.dependencies.append(Dependency(dll if dll.lower().endswith(".dll") else dll + ".dll", "forward"))
    image.dependencies = _unique(image.dependencies)
    return image


_MACH = {b"\xce\xfa\xed\xfe": ("<", 32), b"\xcf\xfa\xed\xfe": ("<", 64),
         b"\xfe\xed\xfa\xce": (">", 32), b"\xfe\xed\xfa\xcf": (">", 64)}
_FAT = {b"\xca\xfe\xba\xbe": (">", False), b"\xbe\xba\xfe\xca": ("<", False),
        b"\xca\xfe\xba\xbf": (">", True), b"\xbf\xba\xfe\xca": ("<", True)}


def _mach(r: Reader) -> Image:
    endian, bits = _MACH[r.bytes(0, 4)]
    cpu, subtype, kind, ncmds, commandbytes, _ = r.unpack(endian + "IIIIII", 4)
    architecture = {0x1000007: "x86_64", 0x100000C: "arm64", 7: "x86", 12: "arm"}.get(cpu, hex(cpu))
    start = 32 if bits == 64 else 28
    r.require(start, commandbytes)
    if ncmds > commandbytes // 8:
        raise BinaryError("Invalid Mach-O load-command count")
    image = Image("mach-o", architecture, bits,
                  {2: "executable", 6: "library", 8: "module", 1: "object"}.get(kind, str(kind)),
                  cpu_subtype=subtype & 0xFFFFFF, byte_order="little" if endian == "<" else "big",
                  slice_offset=r.offset, slice_size=r.size)
    offset = start
    for _ in range(ncmds):
        command, size = r.unpack(endian + "II", offset)
        if size < 8 or size % (8 if bits == 64 else 4) or offset + size > start + commandbytes:
            raise BinaryError("Invalid Mach-O load-command range")
        base = command & 0x7FFFFFFF

        def cmdtext(minimum: int) -> str:
            if size < minimum:
                raise BinaryError("Truncated Mach-O string command")
            pos = r.unpack(endian + "I", offset + 8)[0]
            if not minimum <= pos < size:
                raise BinaryError("Mach-O string is outside its command")
            return r.text(offset + pos, size - pos)

        if base in (0xC, 0xD, 0x18, 0x1F, 0x20, 0x23):
            value = cmdtext(24)
            if base == 0xD:
                image.identity = value
            else:
                image.dependencies.append(Dependency(value, "weak" if base == 0x18 else "required"))
        elif base == 0x1C:
            image.rpaths.append(cmdtext(12))
        elif base == 0xE:  # LC_LOAD_DYLINKER
            image.interpreter = cmdtext(12)
        elif base == 0x24:  # LC_VERSION_MIN_MACOSX
            if size < 16:
                raise BinaryError("Truncated Mach-O minimum-version command")
            version = _version(r.unpack(endian + "I", offset + 8)[0])
            image.minimum_os_version = _max_version(image.minimum_os_version, version)
            image.os_platform = 1
        elif base == 0x32:  # LC_BUILD_VERSION
            if size < 24:
                raise BinaryError("Truncated Mach-O build-version command")
            target, minimum, _, tools = r.unpack(endian + "IIII", offset + 8)
            if 24 + tools * 8 > size:
                raise BinaryError("Truncated Mach-O build-tool list")
            if image.os_platform is not None and image.os_platform != target:
                raise BinaryError("Contradictory Mach-O platform commands")
            image.os_platform = target
            image.minimum_os_version = _max_version(image.minimum_os_version, _version(minimum))
        offset += size
    if offset != start + commandbytes:
        raise BinaryError("Mach-O command size differs from its header")
    image.dependencies = _unique(image.dependencies)
    return image


def _max_version(a: str | None, b: str) -> str:
    key = lambda s: tuple(map(int, s.split("."))) + (0,) * (4 - len(s.split(".")))
    return b if not a or key(b) > key(a) else a


def _elf(r: Reader) -> Image:
    bits = {1: 32, 2: 64}.get(r.bytes(4, 1)[0])
    endian = {1: "<", 2: ">"}.get(r.bytes(5, 1)[0])
    if not bits or not endian:
        raise BinaryError("Invalid ELF class or byte order")
    kind, machine = r.unpack(endian + "HH", 16)
    if bits == 64:
        phoff = r.unpack(endian + "Q", 32)[0]
        entsize, count = r.unpack(endian + "HH", 54)
        fmt = endian + "IIQQQQQQ"
    else:
        phoff = r.unpack(endian + "I", 28)[0]
        entsize, count = r.unpack(endian + "HH", 42)
        fmt = endian + "IIIIIIII"
    if count == 0xFFFF or (count and entsize < struct.calcsize(fmt)):
        raise BinaryError("Unsupported or invalid ELF program table")
    r.require(phoff, count * entsize)
    loads, dynamics, interp = [], None, None
    for i in range(count):
        row = r.unpack(fmt, phoff + i * entsize)
        if bits == 64:
            typ, _, off, va, _, size, _, _ = row
        else:
            typ, off, va, _, size, _, _, _ = row
        r.require(off, size)
        if typ == 1:
            loads.append((va, size, off))
        elif typ == 2:
            dynamics = (off, size)
        elif typ == 3:
            interp = r.text(off, size)
    image = Image("elf", {62: "x86_64", 183: "arm64", 3: "x86", 40: "arm"}.get(machine, str(machine)),
                  bits, "executable" if kind == 2 or interp else "library" if kind == 3 else "object",
                  interpreter=interp, byte_order="little" if endian == "<" else "big", slice_size=r.size)
    if dynamics is None:
        return image
    entryfmt = endian + ("qQ" if bits == 64 else "iI")
    stride = struct.calcsize(entryfmt)
    tags: dict[int, list[int]] = {}
    terminated = False
    for off in range(dynamics[0], dynamics[0] + dynamics[1] - stride + 1, stride):
        tag, value = r.unpack(entryfmt, off)
        if tag == 0:
            terminated = True
            break
        tags.setdefault(tag, []).append(value)
    if not terminated:
        raise BinaryError("Unterminated ELF dynamic table")
    if not any(key in tags for key in (1, 14, 15, 29)):
        return image
    if len(tags.get(5, [])) != 1 or len(tags.get(10, [])) != 1:
        raise BinaryError("Missing ELF dynamic string table")
    address, size = tags[5][0], tags[10][0]
    candidates = [off + address - va for va, n, off in loads if va <= address and address + size <= va + n]
    if len(candidates) != 1:
        raise BinaryError("Unmapped ELF dynamic string table")
    def text(offset: int) -> str:
        if not 0 <= offset < size:
            raise BinaryError("ELF string offset exceeds table")
        return r.text(candidates[0] + offset, size - offset)
    image.dependencies = [Dependency(text(x)) for x in tags.get(1, [])]
    image.rpaths = [path for x in tags.get(15, []) for path in text(x).split(":")]
    image.runpaths = [path for x in tags.get(29, []) for path in text(x).split(":")]
    image.identity = text(tags[14][0]) if tags.get(14) else None
    return image


def inspect(path: str | Path) -> list[Image]:
    """Return every native image slice; [] means an ordinary non-native file.

    Inspecting an object does not make it an executable. Recognized malformed
    images raise BinaryError instead of being mistaken for ordinary data.
    """
    path = Path(path)
    with path.open("rb") as stream:
        magic = stream.read(4)
        if len(magic) < 4:
            return []
        recognized = magic[:2] == b"MZ" or magic == b"\x7fELF" or magic in _MACH or magic in _FAT
        if not recognized:
            return []
        with mmap.mmap(stream.fileno(), 0, access=mmap.ACCESS_READ) as data:
            r = Reader(data)
            if magic[:2] == b"MZ":
                return [_pe(r)]
            if magic == b"\x7fELF":
                return [_elf(r)]
            if magic in _MACH:
                return [_mach(r)]
            endian, fat64 = _FAT[magic]
            count = r.unpack(endian + "I", 4)[0]
            if not 1 <= count <= 64:
                raise BinaryError("Invalid universal Mach-O slice count")
            fmt = endian + ("IIQQII" if fat64 else "IIIII")
            stride = struct.calcsize(fmt)
            r.require(8, count * stride)
            ranges, result, cpus = [], [], set()
            for i in range(count):
                row = r.unpack(fmt, 8 + i * stride)
                cpu, subtype, off, size, align = row[:5]
                if align > 63 or off < 8 + count * stride or off % (1 << align):
                    raise BinaryError("Invalid universal Mach-O slice alignment")
                r.require(off, size)
                if any(off < end and start < off + size for start, end in ranges):
                    raise BinaryError("Overlapping universal Mach-O slices")
                if (cpu, subtype) in cpus:
                    raise BinaryError("Duplicate universal Mach-O CPU slice")
                cpus.add((cpu, subtype)); ranges.append((off, off + size))
                child = Reader(data, off, size)
                if child.bytes(0, 4) not in _MACH or child.unpack(endian + "I", 4)[0] != cpu:
                    # Slice byte order can differ from the fat wrapper.
                    if child.bytes(0, 4) not in _MACH or child.unpack(_MACH[child.bytes(0, 4)][0] + "I", 4)[0] != cpu:
                        raise BinaryError("Universal Mach-O slice CPU/header mismatch")
                result.append(_mach(child))
            return result
