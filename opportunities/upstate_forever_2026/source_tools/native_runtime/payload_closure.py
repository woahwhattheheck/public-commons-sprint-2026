"""Complete a selected native runtime staging tree from pinned donor packages.

This is a build/assembly operation. It copies the existing runtime once, repairs
missing loader dependencies from the *same selected package builds*, and keeps
library paths, package metadata and licenses together. It does not resolve new
scientific versions, execute foreign code, rewrite model sources or replace the
maintained conda-pack/runtime receiver. Use prefix_pack.packing_environment to pass its preserved source origins to
that existing packer; do not pack a copied prefix without this origin join. Windows/macOS/Linux inspection works in a Linux cloud builder.
"""
from __future__ import annotations

import argparse
import ast
import mmap
from collections import deque
from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import sys
import unicodedata
import uuid
from typing import Any, Iterable

if __package__:
    from .binary_dependencies import BinaryError, Dependency, Image, inspect
else:
    from binary_dependencies import BinaryError, Dependency, Image, inspect

SCHEMA = "upstate.native-payload-closure/v1"
TARGETS = {"windows-x86_64": ("pe", "x86_64"),
           "macos-x86_64": ("mach-o", "x86_64"), "macos-arm64": ("mach-o", "arm64"),
           "linux-x86_64": ("elf", "x86_64"), "linux-arm64": ("elf", "arm64")}
WINDOWS_DIRS = (".", "Library/bin", "DLLs", "Library/usr/bin", "Library/mingw-w64/bin")
# OS-shipped libraries only. VC++, OpenMP, Fortran, libgcc, GDAL and PROJ are
# intentionally absent: those must travel with their selected runtime.
WINDOWS_SYSTEM = frozenset("""
advapi32.dll avrt.dll bcrypt.dll bcryptprimitives.dll cabinet.dll cfgmgr32.dll
comctl32.dll comdlg32.dll crypt32.dll cryptbase.dll cryptsp.dll dbghelp.dll
dnsapi.dll dwmapi.dll dxgi.dll gdi32.dll gdiplus.dll hid.dll imm32.dll
iphlpapi.dll kernel32.dll kernelbase.dll mpr.dll msvcrt.dll mswsock.dll
ncrypt.dll netapi32.dll normaliz.dll ntdll.dll ole32.dll oleacc.dll oleaut32.dll
pdh.dll powrprof.dll propsys.dll psapi.dll rpcrt4.dll secur32.dll setupapi.dll
shell32.dll shlwapi.dll user32.dll userenv.dll usp10.dll uxtheme.dll version.dll
wevtapi.dll winhttp.dll wininet.dll winmm.dll winscard.dll winspool.drv
wintrust.dll wldap32.dll ws2_32.dll wtsapi32.dll ucrtbase.dll
""".split())
LINUX_SYSTEM = frozenset("""
libc.so.6 libm.so.6 libdl.so.2 libpthread.so.0 librt.so.1 libutil.so.1
libresolv.so.2 ld-linux-x86-64.so.2 ld-linux-aarch64.so.1 linux-vdso.so.1
""".split())
_API_SET = re.compile(r"^(?:api|ext)-ms-win-[a-z0-9-]+\.dll$", re.I)
_RESERVED = re.compile(r"^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)", re.I)


class PayloadError(RuntimeError):
    """Staging cannot preserve the selected native package/loader contract."""


def digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(block)
    return value.hexdigest()


def target_name(value: str) -> str:
    value = value.replace("darwin-", "macos-", 1)
    if value not in TARGETS:
        raise PayloadError("Unsupported native target: " + value)
    return value


def relative(value: str, *, directory: bool = False) -> str:
    if directory and value == ".":
        return value
    if (not isinstance(value, str) or not value or "\\" in value or ":" in value or "\0" in value
            or value.startswith("/") or any(p in ("", ".", "..") for p in value.split("/"))):
        raise PayloadError("Expected a contained prefix-relative path: " + repr(value))
    return value


def _key(value: str) -> str:
    return unicodedata.normalize("NFC", value).casefold()


def _portable_name(value: str, target: str) -> None:
    relative(value)
    if target.startswith("windows-"):
        for part in PurePosixPath(value).parts:
            if (_RESERVED.match(part) or part[-1:] in (".", " ")
                    or any(ord(c) < 32 or c in '<>"|?*' for c in part)):
                raise PayloadError("Name cannot be represented on Windows: " + value)


def _within(root: Path, path: Path) -> str:
    """Normalize .. in loader paths, then require containment (without following links)."""
    path = Path(os.path.abspath(path))
    try:
        return path.relative_to(root).as_posix()
    except ValueError as exc:
        raise PayloadError("Loader path leaves its selected prefix: " + str(path)) from exc


def _version(value: str) -> tuple[int, ...]:
    if not re.fullmatch(r"\d+(?:\.\d+){0,3}", value):
        raise PayloadError("Invalid minimum OS version: " + repr(value))
    parts = tuple(map(int, value.split(".")))
    return parts + (0,) * (4 - len(parts))


@dataclass
class Package:
    record: Path
    body: dict[str, Any]
    files: tuple[str, ...]

    @property
    def key(self) -> tuple[str, str, str]:
        return tuple(str(self.body.get(k, "")) for k in ("name", "version", "build"))


def relocation_records(root: Path) -> dict[str, tuple[str, str]]:
    """Read data literals from the retained conda-unpack, never execute it."""
    result = {}
    for name in ("bin/conda-unpack", "Scripts/conda-unpack-script.py"):
        script = root / name
        if not script.is_file():
            continue
        if script.stat().st_size > 64 * 1024 * 1024:
            raise PayloadError("Oversized relocation source")
        tree = ast.parse(script.read_text(encoding="utf-8"))
        for node in tree.body:
            if not isinstance(node, ast.Assign) or not any(isinstance(t, ast.Name) and t.id == "_prefix_records" for t in node.targets):
                continue
            rows = ast.literal_eval(node.value)
            if not isinstance(rows, (list, tuple)):
                raise PayloadError("Invalid retained relocation records")
            for row in rows:
                if (not isinstance(row, (list, tuple)) or len(row) != 3
                        or not all(isinstance(value, str) for value in row) or row[2] not in ("text", "binary")):
                    raise PayloadError("Invalid retained relocation record")
                rel = relative(row[0].replace("\\", "/"))
                value = (row[1], row[2])
                if rel in result and result[rel] != value:
                    raise PayloadError("Conflicting retained relocation record: " + rel)
                result[rel] = value
    return result


class Prefix:
    def __init__(self, root: str | Path, target: str, original_prefixes: Iterable[Path] = ()):
        self.root, self.target = Path(root).resolve(strict=True), target
        if not self.root.is_dir():
            raise PayloadError("Runtime prefix is not a directory")
        self.original_prefixes = tuple(Path(p).resolve() for p in original_prefixes)
        self.relocations = relocation_records(self.root)
        self.paths: dict[str, str] = {}
        self.packages: dict[str, Package] = {}
        self.owners: dict[str, Package] = {}
        self.refresh()

    def refresh(self) -> None:
        self.paths.clear(); self.packages.clear(); self.owners.clear()
        # Do not follow directory links recursively; their actual target files
        # are indexed once under the owning physical path.
        for parent, dirs, files in os.walk(self.root, followlinks=False):
            for leaf in [*dirs, *files]:
                path = Path(parent) / leaf
                rel = path.relative_to(self.root).as_posix()
                _portable_name(rel, self.target)
                key = _key(rel) if not self.target.startswith("linux-") else rel
                if key in self.paths and self.paths[key] != rel:
                    raise PayloadError("Case/Unicode collision: " + rel + " / " + self.paths[key])
                self.paths[key] = rel
                if path.is_symlink():
                    try:
                        path.resolve(strict=False).relative_to(self.root)
                    except (OSError, ValueError, RuntimeError) as exc:
                        raise PayloadError("Broken or external runtime symlink: " + rel) from exc
        for path in sorted((self.root / "conda-meta").glob("*.json")):
            body = json.loads(path.read_text(encoding="utf-8"))
            if not all(isinstance(body.get(k), str) and body[k] for k in ("name", "version", "build")):
                raise PayloadError("Invalid conda package identity: " + path.name)
            files = tuple(relative(str(x).replace("\\", "/")) for x in body.get("files", []))
            package = Package(path, body, files)
            old = self.packages.get(package.key[0])
            if old and old.key != package.key:
                raise PayloadError("Multiple installed builds of " + package.key[0])
            self.packages[package.key[0]] = package
            for item in files:
                key = _key(item) if not self.target.startswith("linux-") else item
                old_owner = self.owners.get(key)
                if old_owner and old_owner.key != package.key:
                    raise PayloadError("Multiple conda owners of " + item)
                self.owners[key] = package

    def file(self, rel: str) -> Path | None:
        key = _key(rel) if not self.target.startswith("linux-") else rel
        # A path through a contained directory symlink may not appear in walk.
        path = self.root / self.paths.get(key, rel)
        if path.is_file():
            try:
                path.resolve(strict=True).relative_to(self.root)
            except (OSError, ValueError, RuntimeError) as exc:
                raise PayloadError("Dependency escapes its prefix: " + rel) from exc
            return path
        return None

    def package_for(self, rel: str) -> Package | None:
        key = _key(rel) if not self.target.startswith("linux-") else rel
        return self.owners.get(key)


def _image(path: Path, target: str) -> Image:
    wanted_format, architecture = TARGETS[target]
    choices = [image for image in inspect(path) if image.format == wanted_format and image.architecture == architecture]
    if len(choices) != 1 or choices[0].bits != 64 or choices[0].kind == "object":
        raise PayloadError(f"{path.name}: no unique loadable 64-bit {target} image")
    image = choices[0]
    if image.byte_order != "little":
        raise PayloadError(f"{path.name}: the selected runtime requires little-endian native images")
    if wanted_format == "mach-o" and image.cpu_subtype not in ((0, 1) if architecture == "arm64" else (3,)):
        raise PayloadError(f"{path.name}: CPU subtype {image.cpu_subtype} needs a more specific target")
    if wanted_format == "mach-o" and image.os_platform not in (None, 1):
        raise PayloadError(f"{path.name}: Mach-O platform {image.os_platform} is not native macOS")
    return image


def _system(name: str, target: str) -> bool:
    if target.startswith("windows-"):
        return name.lower() in WINDOWS_SYSTEM or bool(_API_SET.fullmatch(name))
    if target.startswith("macos-"):
        return name.startswith(("/usr/lib/", "/System/Library/")) and "/../" not in name
    return name in LINUX_SYSTEM


def _same_file(a: Path, b: Path) -> bool:
    if a.is_symlink() or b.is_symlink():
        return a.is_symlink() and b.is_symlink() and os.readlink(a) == os.readlink(b)
    return a.is_file() and b.is_file() and a.stat().st_size == b.stat().st_size and digest(a) == digest(b)


def _copy_one(source: Path, source_root: Path, destination: Path, destination_root: Path) -> None:
    """Copy a stable original body; internal absolute links become portable relative links."""
    mode = source.lstat().st_mode
    if not (stat.S_ISREG(mode) or stat.S_ISLNK(mode)):
        raise PayloadError("A runtime payload member is not a file or symlink: " + str(source))
    destination.parent.mkdir(parents=True, exist_ok=True)
    if stat.S_ISLNK(mode):
        target = source.resolve(strict=False)
        target_rel = target.relative_to(source_root)
        link = os.path.relpath(destination_root / target_rel, destination.parent)
        if destination.exists() or destination.is_symlink():
            if destination.is_symlink() and os.readlink(destination) == link:
                return
            raise PayloadError("Conflicting existing symlink destination: " + str(destination))
        os.symlink(link, destination, target_is_directory=target.is_dir())
        return
    if destination.exists() or destination.is_symlink():
        if _same_file(source, destination):
            return
        raise PayloadError("Different existing package body: " + str(destination))
    before = source.stat()
    with source.open("rb") as incoming, destination.open("xb") as outgoing:
        value = hashlib.sha256()
        for block in iter(lambda: incoming.read(1024 * 1024), b""):
            value.update(block); outgoing.write(block)
        outgoing.flush(); os.fsync(outgoing.fileno())
    after = source.stat()
    if ((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns)
            != (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns)
            or digest(destination) != value.hexdigest()):
        raise PayloadError("Runtime member changed during copying: " + str(source))
    os.chmod(destination, stat.S_IMODE(mode) & 0o777)


def _copy_tree(source: Path, destination: Path) -> None:
    destination.mkdir()
    for parent, dirs, files in os.walk(source, followlinks=False):
        rel = Path(parent).relative_to(source)
        here = destination / rel
        here.mkdir(parents=True, exist_ok=True)
        for name in dirs[:]:
            path = Path(parent) / name
            if path.is_symlink():
                _copy_one(path, source, here / name, destination)
                dirs.remove(name)
            else:
                (here / name).mkdir(exist_ok=True)
        for name in files:
            _copy_one(Path(parent) / name, source, here / name, destination)


def _roots(prefix: Prefix, supplied: Iterable[str]) -> list[str]:
    paths = list(supplied)
    if paths:
        for path in paths:
            relative(path)
        return list(dict.fromkeys(paths))
    python = "python.exe" if prefix.target.startswith("windows-") else "bin/python"
    if prefix.file(python):
        paths.append(python)
    # Python native extensions and installed GIS/shared libraries can be loaded
    # dynamically and need roots of their own. Do not treat distlib's packaged
    # cross-architecture .exe resources as executing runtime programs.
    for rel in prefix.paths.values():
        lower = rel.lower()
        if (lower.endswith((".pyd", ".dylib", ".dll", ".so")) or ".so." in lower):
            path = prefix.file(rel)
            if path:
                images = inspect(path)
                if images:
                    paths.append(rel)
    if not paths:
        raise PayloadError("No native entry point found; supply --root prefix-relative-path")
    return list(dict.fromkeys(paths))


class Closure:
    def __init__(self, prefix: Prefix, *, roots: Iterable[str] = (), library_dirs: Iterable[str] = (),
                 executable: str | None = None):
        self.prefix = prefix
        self.roots = _roots(prefix, roots)
        default = "python.exe" if prefix.target.startswith("windows-") else "bin/python"
        self.executable = relative(executable or (default if prefix.file(default) else self.roots[0]))
        self.library_dirs = [relative(p, directory=True) for p in library_dirs]
        self.nodes: dict[str, dict] = {}
        self.edges: list[dict] = []
        self.missing: list[dict] = []
        self.relocation: list[dict] = []
        self.optional: list[dict] = []
        self.minimum_os_version: str | None = None

    def _expand(self, value: str, loader: str) -> str:
        root = self.prefix.root
        replacements = {"@loader_path": str((root / loader).parent),
                        "@executable_path": str((root / self.executable).parent),
                        "${ORIGIN}": str((root / loader).parent),
                        "$ORIGIN": str((root / loader).parent)}
        for key, replacement in replacements.items():
            if value == key or value.startswith(key + "/"):
                value = replacement + value[len(key):]
                break
        if value.startswith(("@", "$")) or not value.startswith("/"):
            raise PayloadError("Unsupported relative loader search path: " + value)
        aliases = list(self.prefix.original_prefixes)
        record = self.prefix.relocations.get(loader)
        if record is None:
            actual = self.prefix.file(loader)
            if actual:
                record = self.prefix.relocations.get(actual.resolve().relative_to(root).as_posix())
        if record and record[0].startswith("/"):
            aliases.append(Path(record[0]))
        for old in sorted(aliases, key=lambda p: len(str(p)), reverse=True):
            if Path(value).is_relative_to(old):
                value = str(root / Path(value).relative_to(old))
                break
        return _within(root, Path(value))

    def run(self) -> dict[str, Any]:
        queue = deque((rel, ()) for rel in self.roots)
        visited = set()
        while queue:
            rel, inherited = queue.popleft()
            path = self.prefix.file(rel)
            if path is None:
                raise PayloadError("Missing selected native entry point: " + rel)
            # Keep its original alias as loader_path. Symlinked bin/python and
            # framework entry points may carry a different loader context.
            image = _image(path, self.prefix.target)
            own_rpaths: list[str] = []
            raw_paths = image.runpaths or image.rpaths
            for raw in raw_paths:
                if raw.startswith("/"):
                    self.relocation.append({"file": rel, "kind": "absolute-search-path", "path": raw})
                try:
                    own_rpaths.append(self._expand(raw, rel))
                except PayloadError:
                    # Never let host/user/global directories satisfy the bundle.
                    self.relocation.append({"file": rel, "kind": "external-search-path", "path": raw})
            search = tuple(dict.fromkeys(own_rpaths + list(inherited)))
            key = (rel, search)
            if key in visited:
                continue
            visited.add(key)
            if len(visited) > 100000:
                raise PayloadError("Native loader closure exceeds 100000 contexts")
            if rel not in self.nodes:
                self.nodes[rel] = {"path": rel, "bytes": path.stat().st_size,
                                   "sha256": digest(path), "image": image.to_dict()}
            if image.minimum_os_version:
                if (self.minimum_os_version is None or _version(image.minimum_os_version) > _version(self.minimum_os_version)):
                    self.minimum_os_version = image.minimum_os_version
            for dependency in image.dependencies:
                name = dependency.name
                edge = {"from": rel, "dependency": name, "kind": dependency.kind}
                if _system(name, self.prefix.target):
                    self.edges.append({**edge, "resolution": "operating-system"})
                    continue
                candidates: list[str] = []
                try:
                    if image.format == "pe":
                        if any(c in name for c in ("/", "\\", ":")):
                            raise PayloadError("PE import is not a DLL basename: " + name)
                        directories = [PurePosixPath(rel).parent.as_posix(), *WINDOWS_DIRS, *self.library_dirs]
                        candidates = [(PurePosixPath(d) / name).as_posix() for d in dict.fromkeys(directories)]
                    elif image.format == "mach-o":
                        if name.startswith("@rpath/"):
                            candidates = [str(PurePosixPath(d) / name[7:]) for d in search]
                        elif name.startswith(("@loader_path/", "@executable_path/")):
                            candidates = [self._expand(name, rel)]
                        elif name.startswith("/"):
                            candidates = [self._expand(name, rel)]
                            self.relocation.append({"file": rel, "kind": "absolute-dependency", "path": name})
                        else:
                            raise PayloadError("Mach-O dependency has no portable loader anchor: " + name)
                    else:
                        if "/" in name:
                            candidates = [self._expand(name, rel)]
                        else:
                            candidates = [str(PurePosixPath(d) / name) for d in (*search, *self.library_dirs)]
                except PayloadError as exc:
                    edge["detail"] = str(exc)
                candidates = list(dict.fromkeys(_within(self.prefix.root, self.prefix.root / p) for p in candidates))
                found = [(candidate, self.prefix.file(candidate)) for candidate in candidates]
                found = [(relpath, p) for relpath, p in found if p is not None]
                if not found:
                    issue = {**edge, "destinations": candidates}
                    if dependency.kind == "weak":
                        self.optional.append(issue)
                    else:
                        self.missing.append(issue)
                    continue
                # A conflicting added DLL directory is not a deterministic
                # loader choice. POSIX loader search has defined ordered paths.
                if image.format == "pe" and len({digest(p) for _, p in found}) > 1:
                    raise PayloadError("Conflicting DLL bodies for " + name + " in " + ", ".join(p for p, _ in found))
                chosen, actual = found[0]
                _image(actual, self.prefix.target)
                self.edges.append({**edge, "resolution": "bundled", "to": chosen})
                # ELF RUNPATH is not inherited by grandchildren; Darwin rpaths
                # and old ELF RPATH are carried along the actual loader chain.
                child_search = () if image.format == "elf" and image.runpaths else search
                queue.append((chosen, child_search))
        return {"schema": SCHEMA, "target": self.prefix.target, "roots": self.roots,
                "executable": self.executable, "library_dirs": self.library_dirs,
                "binary_declared_minimum_os": self.minimum_os_version,
                "nodes": list(self.nodes.values()), "edges": self.edges,
                "missing": self.missing, "optional": self.optional,
                "relocation_required": list({json.dumps(row, sort_keys=True): row for row in self.relocation}.values())}


def inspect_prefix(prefix: str | Path, *, target: str, roots: Iterable[str] = (),
                   library_dirs: Iterable[str] = (), executable: str | None = None) -> dict:
    return Closure(Prefix(prefix, target_name(target)), roots=roots, library_dirs=library_dirs,
                   executable=executable).run()


def _package_match(wanted: Package, candidate: Package) -> bool:
    if wanted.key != candidate.key:
        return False
    for key in ("subdir", "sha256", "md5"):
        if wanted.body.get(key) and candidate.body.get(key) and wanted.body[key] != candidate.body[key]:
            return False
    return True


def _copy_package(donor: Prefix, package: Package, stage: Prefix) -> dict:
    chosen = stage.packages.get(package.key[0])
    if chosen is None or not _package_match(chosen, package):
        raise PayloadError("Donor package is not the selected build: " + "=".join(package.key))
    copied = []
    for rel in package.files:
        source = donor.root / rel
        if not (source.is_file() or source.is_symlink()):
            # Directory entries are legal in old package records.
            if source.is_dir():
                continue
            raise PayloadError("Donor package is incomplete: " + rel)
        destination = stage.root / rel
        existed = destination.exists() or destination.is_symlink()
        _copy_one(source, donor.root, destination, stage.root)
        if not existed:
            copied.append(rel)
    # Keep the selected recipient metadata, not the donor's link/cache location.
    return {"package": {key: package.body.get(key) for key in ("name", "version", "build", "subdir", "sha256", "md5", "license")},
            "added_files": copied, "donor_record_sha256": digest(package.record)}


def _copy_licenses(donor: Prefix, stage: Prefix, package: Package, package_caches: Iterable[Path]) -> list[dict]:
    """Retain installed license files and original conda-cache info/licenses."""
    rows = []
    installed = [p for p in package.files if re.search(r"(?:^|/)(?:licenses?|copying|notice)(?:[./_-]|$)", p, re.I)]
    for rel in installed:
        path = donor.file(rel)
        if path:
            rows.append({"path": rel, "sha256": digest(path), "bytes": path.stat().st_size})
    folder = "-".join(package.key)
    for cache in package_caches:
        candidate = cache / folder
        index = candidate / "info/index.json"
        if not index.is_file():
            continue
        body = json.loads(index.read_text(encoding="utf-8"))
        if tuple(str(body.get(k, "")) for k in ("name", "version", "build")) != package.key:
            raise PayloadError("Package-cache license identity mismatch: " + folder)
        for source in sorted((candidate / "info/licenses").rglob("*")):
            if not source.is_file():
                continue
            # A cached license symlink must remain within the supplied package.
            source.resolve(strict=True).relative_to(candidate.resolve(strict=True))
            rel = "licenses/" + folder + "/" + source.relative_to(candidate / "info/licenses").as_posix()
            _copy_one(source.resolve(strict=True), candidate, stage.root / rel, stage.root)
            path = stage.root / rel
            rows.append({"path": rel, "sha256": digest(path), "bytes": path.stat().st_size})
    return list({row["path"]: row for row in rows}.values())


def complete(prefix: str | Path, destination: str | Path, *, target: str,
             donors: Iterable[str | Path] = (), roots: Iterable[str] = (),
             library_dirs: Iterable[str] = (), executable: str | None = None,
             package_caches: Iterable[str | Path] = (), minimum_os_version: str | None = None) -> dict:
    """Create a new completed staging prefix; never mutate the supplied runtime.

    Donors can fill files only from exact packages already selected in the
    prefix's conda-meta records. Every advertised package body is copied together
    (or matched byte-for-byte), not just the first DLL that happens to load.
    Use prefix_pack.packing_environment for the maintained native packer, and
    retain the existing receiver after this build step.
    """
    target = target_name(target)
    original = Prefix(prefix, target)
    sources = [Prefix(path, target) for path in donors]
    caches = [Path(path).resolve(strict=True) for path in package_caches]
    destination = Path(destination).absolute()
    if destination.exists() or destination.is_symlink():
        raise PayloadError("Use a new staging destination: " + str(destination))
    for root in [original.root, *(source.root for source in sources), *caches]:
        if destination.is_relative_to(root):
            raise PayloadError("Staging must be outside every source prefix/cache")
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name("." + destination.name + "." + uuid.uuid4().hex + ".partial")
    additions, licenses = [], []
    roots, library_dirs = tuple(roots), tuple(library_dirs)
    try:
        _copy_tree(original.root, temporary)
        stage = Prefix(temporary, target, [original.root, *(source.root for source in sources)])
        installed: set[tuple[str, str, str]] = set()
        for _ in range(256):
            report = Closure(stage, roots=roots, library_dirs=library_dirs, executable=executable).run()
            if not report["missing"]:
                break
            changed = False
            for issue in report["missing"]:
                candidates = []
                for donor in sources:
                    for rel in issue["destinations"]:
                        source = donor.file(rel)
                        package = donor.package_for(rel)
                        selected = stage.packages.get(package.key[0]) if package else None
                        if source and package and selected and _package_match(selected, package):
                            try:
                                _image(source, target)
                            except (BinaryError, PayloadError):
                                continue
                            candidates.append((donor, package, rel, digest(source)))
                bodies = {item[3] for item in candidates}
                if len(bodies) > 1:
                    raise PayloadError("Conflicting pinned donor bodies for " + issue["dependency"])
                if not candidates:
                    continue
                donor, package, _, _ = candidates[0]
                if package.key in installed:
                    continue
                additions.append(_copy_package(donor, package, stage))
                licenses.extend(_copy_licenses(donor, stage, package, caches))
                installed.add(package.key); changed = True
            if not changed:
                names = "; ".join(row["from"] + " -> " + row["dependency"] for row in report["missing"][:20])
                raise PayloadError("No matching selected donor package for: " + names)
            stage.refresh()
        else:
            raise PayloadError("Package dependency completion did not converge")
        if minimum_os_version is not None:
            if report["binary_declared_minimum_os"] and _version(minimum_os_version) < _version(report["binary_declared_minimum_os"]):
                raise PayloadError("Declared minimum OS is lower than a shipped binary requires")
            _version(minimum_os_version)
        # Retain cache licenses for already-complete packages too.
        for package in stage.packages.values():
            licenses.extend(_copy_licenses(stage, stage, package, caches))
        report.update(added_packages=additions,
                      licenses=list({row["path"]: row for row in licenses}.values()),
                      minimum_os_version=minimum_os_version,
                      operation="complete-selected-native-prefix", publication="staging-for-existing-packer")
        # Loader commands retain their actual raw references for assembly;
        # scientific/package bytes are never edited by this completion step.
        output = temporary / "NATIVE_PAYLOAD_CLOSURE.json"
        if output.exists():
            raise PayloadError("Input already contains NATIVE_PAYLOAD_CLOSURE.json; select the original prefix")
        output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        with output.open("rb") as stream:
            os.fsync(stream.fileno())
        if destination.exists() or destination.is_symlink():
            raise PayloadError("Staging destination appeared during assembly: " + str(destination))
        os.rename(temporary, destination)
        return report
    except BaseException:
        if temporary.is_dir():
            shutil.rmtree(temporary)
        raise


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=("inspect", "complete"))
    parser.add_argument("prefix", type=Path)
    parser.add_argument("--target", required=True, choices=tuple(TARGETS))
    parser.add_argument("--root", action="append", default=[], help="Native prefix-relative load root; repeat for dynamic entry points")
    parser.add_argument("--executable", help="Prefix-relative main executable for @executable_path")
    parser.add_argument("--library-dir", action="append", default=[], help="Already-activated prefix-relative loader directory")
    parser.add_argument("--destination", type=Path, help="New completed staging prefix")
    parser.add_argument("--donor", action="append", type=Path, default=[], help="Existing prefix containing identical selected package builds")
    parser.add_argument("--package-cache", action="append", type=Path, default=[], help="Conda package cache supplying original info/licenses")
    parser.add_argument("--minimum-os-version")
    parser.add_argument("--json", type=Path, help="Write full machine-readable output; stdout stays a short operation summary")
    args = parser.parse_args(argv)
    common = dict(target=args.target, roots=args.root, library_dirs=args.library_dir, executable=args.executable)
    try:
        if args.operation == "complete":
            if args.destination is None:
                parser.error("complete requires --destination")
            report = complete(args.prefix, args.destination, donors=args.donor,
                              package_caches=args.package_cache, minimum_os_version=args.minimum_os_version, **common)
        else:
            report = inspect_prefix(args.prefix, **common)
        if args.json:
            args.json.parent.mkdir(parents=True, exist_ok=True)
            args.json.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(json.dumps({"operation": args.operation, "target": args.target, "binaries": len(report["nodes"]),
                          "loader_edges": len(report["edges"]), "missing": len(report["missing"]),
                          "added_packages": len(report.get("added_packages", [])),
                          "relocation_required": len(report["relocation_required"]),
                          "binary_declared_minimum_os": report["binary_declared_minimum_os"],
                          "destination": str(args.destination) if args.destination else None}, ensure_ascii=False))
        return 2 if report["missing"] else 0
    except (PayloadError, BinaryError, OSError, ValueError) as exc:
        print("Native payload: " + str(exc), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
