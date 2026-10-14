#!/usr/bin/env python3
"""Build the pinned offline Node/Excel overlay for the existing collection opener.

Run in the current application source tree. Native loader inspection is delegated
unchanged to native_runtime.binary_dependencies; this is not another launcher,
package solver, dependency graph or scientific environment.
"""
from __future__ import annotations

import argparse
import contextlib
import copy
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import stat
import sys
import tarfile
import tempfile
from typing import Any, BinaryIO, Iterator
import zipfile

VERSION = "22.16.0"
BLOCK = 1024 * 1024
SOURCE = "https://nodejs.org/download/release/v22.16.0/"
CHECKSUM_SOURCE = "https://nodejs.org/en/blog/release/v22.16.0"
NODE = {
    "windows-x86_64": {
        "archive": "node-v22.16.0-win-x64.zip",
        "sha256": "21c2d9735c80b8f86dab19305aa6a9f6f59bbc808f68de3eef09d5832e3bfbbd",
        "root": "node-v22.16.0-win-x64", "executable": "node.exe", "format": "pe", "architecture": "x86_64",
    },
    "macos-x86_64": {
        "archive": "node-v22.16.0-darwin-x64.tar.xz",
        "sha256": "5c34638f2c0e3f3aaa7b3a94b58304765a169730da1896ebba8515ea4d987a9c",
        "root": "node-v22.16.0-darwin-x64", "executable": "bin/node", "format": "mach-o", "architecture": "x86_64",
    },
    "macos-arm64": {
        "archive": "node-v22.16.0-darwin-arm64.tar.xz",
        "sha256": "aaf7fc3c936f1b359bc312b63638e41f258689ac2303966ad932cda18c54ea00",
        "root": "node-v22.16.0-darwin-arm64", "executable": "bin/node", "format": "mach-o", "architecture": "arm64",
    },
}
# These are the existing collection opener's exact original pins, not a solve.
WHEELS = {
    "openpyxl-3.1.5-py2.py3-none-any.whl": {
        "bytes": 250910, "sha256": "5282c12b107bffeef825f4617dc029afaf41d0ea60823bbb665ef3079dc79de2",
        "distribution": "openpyxl", "version": "3.1.5",
        "source_url": "https://files.pythonhosted.org/packages/c0/da/977ded879c29cbd04de313843e76868e6e13408a94ed6b987245dc7c8506/openpyxl-3.1.5-py2.py3-none-any.whl",
    },
    "et_xmlfile-2.0.0-py3-none-any.whl": {
        "bytes": 18059, "sha256": "7a91720bc756843502c3b7504c77b8fe44217c85c537d85037f0f536151b2caa",
        "distribution": "et_xmlfile", "version": "2.0.0",
        "source_url": "https://files.pythonhosted.org/packages/c1/8b/5fe2cc11fee489817272089c4203e679c63b570a5aaeb18d852ae3cbba6a/et_xmlfile-2.0.0-py3-none-any.whl",
    },
}


def identity(value: os.stat_result) -> tuple[int, ...]:
    return value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns, value.st_ctime_ns


@contextlib.contextmanager
def original(path: Path, digest: str, size: int | None = None) -> Iterator[BinaryIO]:
    """Hash, consume and finally recheck one held original regular-file handle."""
    if not stat.S_ISREG(path.lstat().st_mode):
        raise ValueError(f"Expected original regular file: {path}")
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    with os.fdopen(fd, "rb") as stream:
        before = os.fstat(stream.fileno())
        if not stat.S_ISREG(before.st_mode) or identity(before) != identity(path.stat()):
            raise ValueError(f"Original changed while opening: {path}")
        measured = hashlib.file_digest(stream, "sha256").hexdigest()
        if measured != digest or (size is not None and before.st_size != size):
            raise ValueError(f"Original bytes do not match the pinned release: {path}")
        stream.seek(0)
        yield stream
        if identity(before) != identity(os.fstat(stream.fileno())) or identity(before) != identity(path.stat()):
            raise ValueError(f"Original changed while reading: {path}")


def digest_file(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def record(path: Path, root: Path) -> dict[str, Any]:
    return {"path": path.relative_to(root).as_posix(), "bytes": path.stat().st_size, "sha256": digest_file(path)}


def dump_new(path: Path, value: Any) -> None:
    with path.open("x", encoding="utf-8", newline="\n") as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2, sort_keys=True)
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())


def copy_stream(stream: BinaryIO, path: Path, length: int, mode: int) -> None:
    if not 0 < length <= 512 * BLOCK:
        raise ValueError(f"Unexpected selected-member size: {path.name}: {length}")
    path.parent.mkdir(parents=True, exist_ok=True)
    total = 0
    with path.open("xb") as output:
        while block := stream.read(min(BLOCK, length - total + 1)):
            total += len(block)
            if total > length:
                raise ValueError(f"Selected member exceeds original size: {path.name}")
            output.write(block)
        if total != length:
            raise ValueError(f"Truncated selected member: {path.name}")
        output.flush()
        os.fsync(output.fileno())
    path.chmod(mode)


def node_members(stream: BinaryIO, spec: dict[str, str], destination: Path) -> tuple[Path, Path]:
    """Copy only the two exact release members; never extract archive paths."""
    names = {spec["root"] + "/" + spec["executable"]: (destination / Path(spec["executable"]).name, 0o755),
             spec["root"] + "/LICENSE": (destination / "LICENSE", 0o644)}
    if spec["archive"].endswith(".zip"):
        with zipfile.ZipFile(stream) as archive:
            entries = archive.infolist()
            for name, (path, mode) in names.items():
                matches = [entry for entry in entries if entry.filename == name]
                if len(matches) != 1:
                    raise ValueError(f"Release member must occur once: {name}")
                entry = matches[0]
                kind = (entry.external_attr >> 16) & 0o170000
                if entry.is_dir() or kind not in (0, stat.S_IFREG) or entry.flag_bits & 1:
                    raise ValueError(f"Release member is not an ordinary file: {name}")
                with archive.open(entry) as incoming:
                    copy_stream(incoming, path, entry.file_size, mode)
    else:
        with tarfile.open(fileobj=stream, mode="r:xz") as archive:
            entries = archive.getmembers()
            for name, (path, mode) in names.items():
                matches = [entry for entry in entries if entry.name == name]
                if len(matches) != 1 or not matches[0].isfile():
                    raise ValueError(f"Release member must be one regular file: {name}")
                incoming = archive.extractfile(matches[0])
                if incoming is None:
                    raise ValueError(f"Missing release member: {name}")
                with incoming:
                    copy_stream(incoming, path, matches[0].size, mode)
    return tuple(path for path, _ in names.values())


def loader_details(path: Path, spec: dict[str, str]) -> list[dict[str, Any]]:
    # Consume the existing shared native-image reader, including PE delay imports
    # and the selected Mach-O architecture/minimum-OS commands.
    from native_runtime.binary_dependencies import inspect
    images = inspect(path)
    if len(images) != 1:
        raise ValueError(f"Expected the publisher's one target image: {path}")
    image = images[0]
    if (image.format, image.architecture, image.bits, image.kind) != (spec["format"], spec["architecture"], 64, "executable"):
        raise ValueError(f"Native executable disagrees with the selected target: {path}")
    if image.format == "mach-o" and image.os_platform != 1:
        raise ValueError("Node payload must target macOS, not another Darwin platform")
    if not image.minimum_os_version:
        raise ValueError("Native image does not declare a minimum OS")
    return [image.to_dict()]


def workbook_metadata(path: Path, spec: dict[str, Any], licenses: Path) -> list[Path]:
    from email.parser import BytesParser
    retained = []
    with zipfile.ZipFile(path) as wheel:
        entries = wheel.infolist()
        metadata = [entry for entry in entries if entry.filename.endswith(".dist-info/METADATA")]
        if len(metadata) != 1:
            raise ValueError(f"Expected original wheel metadata: {path.name}")
        message = BytesParser().parsebytes(wheel.read(metadata[0]))
        normalize = lambda s: s.lower().replace("-", "_")
        if normalize(message.get("Name", "")) != normalize(spec["distribution"]) or message.get("Version") != spec["version"]:
            raise ValueError(f"Wheel identity disagrees with retained pin: {path.name}")
        for entry in entries:
            if ".dist-info/" in entry.filename and any(word in entry.filename.lower() for word in ("license", "licence", "copying")):
                # Preserve license basename with distribution namespace; no
                # arbitrary wheel extraction or recipient package installation.
                dest = licenses / spec["distribution"] / Path(entry.filename).name
                with wheel.open(entry) as incoming:
                    copy_stream(incoming, dest, entry.file_size, 0o644)
                retained.append(dest)
    if not retained:
        raise ValueError(f"Retain the original wheel license: {path.name}")
    return retained


def build(inputs: Path, wheels: Path, output: Path, targets: list[str] | None = None) -> dict[str, Any]:
    targets = list(NODE) if targets is None else targets
    if not targets or len(set(targets)) != len(targets) or any(target not in NODE for target in targets):
        raise ValueError("Choose distinct supported native targets")
    inputs, wheels = inputs.resolve(strict=True), wheels.resolve(strict=True)
    output = output.absolute()
    if output.exists() or output.is_symlink():
        raise FileExistsError(f"Preserved existing output; choose a fresh overlay directory: {output}")
    output.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix="." + output.name + ".building-", dir=output.parent))
    try:
        manifest: dict[str, Any] = {"schema": "ecosystem-node-dependencies/1", "node_version": VERSION,
            "owner_direction": "2026-10-14.1", "checksum_source": CHECKSUM_SOURCE,
            "platforms": {}, "workbook_dependencies": [], "license_files": [],
            "complete_release_targets": targets == list(NODE) or set(targets) == set(NODE)}
        for target in targets:
            spec = NODE[target]
            archive_path = inputs / spec["archive"]
            with original(archive_path, spec["sha256"]) as incoming:
                executable, license_file = node_members(incoming, spec, staging / "measurements-runtime" / target)
            license_text = license_file.read_text(encoding="utf-8")
            if "Node.js" not in license_text or len(license_text) < 1000:
                raise ValueError("Expected the full original Node and third-party license text")
            image = loader_details(executable, spec)
            manifest["platforms"][target] = {
                "dependencies": {"node": record(executable, staging), "node_license": record(license_file, staging)},
                "node_payload": {"version": VERSION, "source_url": SOURCE + spec["archive"],
                    "archive": spec["archive"], "archive_bytes": archive_path.stat().st_size,
                    "archive_sha256": spec["sha256"], "loader_images": image,
                    "minimum_os_note": "Image loader minimum; final platform support is the maximum across the complete scientific bundle."},
            }
        for name, spec in WHEELS.items():
            destination = staging / "workbook-dependencies" / name
            with original(wheels / name, spec["sha256"], spec["bytes"]) as incoming:
                copy_stream(incoming, destination, spec["bytes"], 0o644)
            manifest["workbook_dependencies"].append({**record(destination, staging),
                                                       "distribution": spec["distribution"], "version": spec["version"]})
            for path in workbook_metadata(destination, spec, staging / "workbook-dependencies/licenses"):
                manifest["license_files"].append(record(path, staging))
        dump_new(staging / "NODE_DEPENDENCIES.json", manifest)
        # The directory has a caller-selected fresh name. A raced empty directory
        # may be replaced by POSIX rename, but a populated artifact is preserved.
        if output.exists() or output.is_symlink():
            raise FileExistsError(f"Output appeared while building: {output}")
        os.rename(staging, output)
        return manifest
    except BaseException:
        shutil.rmtree(staging, ignore_errors=True)
        raise


def compose(runtime: dict[str, Any], overlay: dict[str, Any]) -> dict[str, Any]:
    """Join exact dependencies without changing a runtime/boot/science selection."""
    if overlay.get("schema") != "ecosystem-node-dependencies/1" or overlay.get("node_version") != VERSION:
        raise ValueError("Expected the pinned Node dependency overlay")
    result = copy.deepcopy(runtime)
    platforms = result.get("platforms")
    if not isinstance(platforms, dict):
        raise ValueError("Supply the maintained v2 scientific platform manifest")
    for target, incoming in overlay.get("platforms", {}).items():
        if target not in NODE or not isinstance(platforms.get(target), dict):
            raise ValueError(f"Preserve the scientific selection; no selected runtime for {target}")
        dependencies = platforms[target].setdefault("dependencies", {})
        if not isinstance(dependencies, dict):
            raise ValueError(f"Malformed existing dependency descriptor: {target}")
        for name in ("node", "node_license"):
            row = incoming["dependencies"][name]
            relative = PurePosixPath(row["path"])
            expected_name = "node.exe" if target == "windows-x86_64" else "node"
            expected = f"measurements-runtime/{target}/{expected_name if name == 'node' else 'LICENSE'}"
            if str(relative) != expected or type(row.get("bytes")) is not int or row["bytes"] <= 0:
                raise ValueError(f"Invalid exact dependency path/size: {target}/{name}")
            digest = row.get("sha256")
            if not isinstance(digest, str) or len(digest) != 64 or any(c not in "0123456789abcdef" for c in digest):
                raise ValueError(f"Invalid dependency hash: {target}/{name}")
            prior = dependencies.get(name)
            if prior is not None and (not isinstance(prior, dict) or any(prior.get(k) != row[k] for k in ("path", "bytes", "sha256"))):
                raise ValueError(f"Preserved an existing different dependency: {target}/{name}")
            if prior is None:
                dependencies[name] = copy.deepcopy(row)
    return result


def package(root: Path, output: Path) -> dict[str, Any]:
    """Make a deterministic short-path overlay ZIP, preserving execute modes."""
    root = root.resolve(strict=True)
    paths = sorted(path for path in root.rglob("*") if path.is_file())
    for path in root.rglob("*"):
        if path.is_symlink() or not (path.is_file() or path.is_dir()):
            raise ValueError(f"Only regular generated overlay files may be packaged: {path}")
    if output.absolute().is_relative_to(root):
        raise ValueError("Write the ZIP outside its input overlay")
    # Exclusive creation means a saved complete outgoing ZIP is never replaced.
    with output.open("xb") as stream:
        try:
            with zipfile.ZipFile(stream, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
                for path in paths:
                    name = path.relative_to(root).as_posix()
                    info = zipfile.ZipInfo(name, (2026, 10, 14, 0, 0, 0))
                    info.create_system = 3
                    info.compress_type = zipfile.ZIP_DEFLATED
                    executable = name.startswith("measurements-runtime/") and path.name in ("node", "node.exe")
                    info.external_attr = (stat.S_IFREG | (0o755 if executable else 0o644)) << 16
                    with path.open("rb") as incoming, archive.open(info, "w", force_zip64=True) as outgoing:
                        shutil.copyfileobj(incoming, outgoing, BLOCK)
            stream.flush()
            os.fsync(stream.fileno())
        except BaseException:
            # Leave the partial artifact explicit for diagnosis; never label it complete.
            raise
    return {"path": output.name, "bytes": output.stat().st_size, "sha256": digest_file(output), "members": len(paths)}


def fetch_inputs(directory: Path) -> list[dict[str, Any]]:
    """Acquire only the five fixed original inputs on a network-equipped host.

    This command is explicitly separate from offline build and recipient opening.
    Existing exact files reuse; differing files and concurrent publication stay.
    """
    from urllib.request import Request, urlopen
    directory.mkdir(parents=True, exist_ok=True)
    directory = directory.resolve(strict=True)
    rows = [{"name": spec["archive"], "url": SOURCE + spec["archive"], "sha256": spec["sha256"]}
            for spec in NODE.values()]
    rows += [{"name": name, "url": spec["source_url"], "sha256": spec["sha256"], "bytes": spec["bytes"]}
             for name, spec in WHEELS.items()]
    result = []
    for row in rows:
        path = directory / row["name"]
        if path.exists() or path.is_symlink():
            with original(path, row["sha256"], row.get("bytes")):
                pass
            result.append({**record(path, directory), "source_url": row["url"], "reused": True})
            continue
        fd, pending_name = tempfile.mkstemp(prefix="." + row["name"] + ".downloading-", dir=directory)
        pending = Path(pending_name)
        try:
            digest, size = hashlib.sha256(), 0
            request = Request(row["url"], headers={"User-Agent": "Ecosystem-native-payload-builder/1"})
            with os.fdopen(fd, "wb") as outgoing:
                with urlopen(request, timeout=60) as incoming:
                    if incoming.status != 200:
                        raise ValueError(f"Incomplete original response: {row['name']}: {incoming.status}")
                    while block := incoming.read(BLOCK):
                        size += len(block)
                        if size > 512 * BLOCK:
                            raise ValueError("Original archive exceeds selected payload size limit")
                        digest.update(block)
                        outgoing.write(block)
                if digest.hexdigest() != row["sha256"] or ("bytes" in row and size != row["bytes"]):
                    raise ValueError(f"Original download checksum differs: {row['name']}")
                outgoing.flush()
                os.fsync(outgoing.fileno())
            # Both publication paths are create-only. Assembly normally runs in
            # the cloud on a hard-link-capable filesystem, never the recipient PC.
            try:
                if os.name == "nt":
                    os.rename(pending, path)
                else:
                    os.link(pending, path, follow_symlinks=False)
            except FileExistsError:
                with original(path, row["sha256"], row.get("bytes")):
                    pass
            result.append({**record(path, directory), "source_url": row["url"], "reused": False})
        finally:
            pending.unlink(missing_ok=True)
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    fetch_args = commands.add_parser("fetch", help="Acquire/reuse the five pinned publisher inputs on a network-equipped host")
    fetch_args.add_argument("--output", type=Path, required=True)
    build_args = commands.add_parser("build", help="Receive official original archives and the two existing wheels")
    build_args.add_argument("--inputs", type=Path, required=True)
    build_args.add_argument("--wheels", type=Path, required=True)
    build_args.add_argument("--output", type=Path, required=True)
    build_args.add_argument("--target", action="append", choices=list(NODE))
    build_args.add_argument("--zip", type=Path)
    merge_args = commands.add_parser("compose", help="Write a new manifest preserving the selected native runtimes")
    merge_args.add_argument("--runtime", type=Path, required=True)
    merge_args.add_argument("--overlay", type=Path, required=True)
    merge_args.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.command == "fetch":
        result = {"inputs": fetch_inputs(args.output)}
    elif args.command == "build":
        manifest = build(args.inputs, args.wheels, args.output, args.target)
        result = {"overlay": str(args.output), "targets": list(manifest["platforms"])}
        if args.zip:
            result["archive"] = package(args.output, args.zip)
    else:
        native = json.loads(args.runtime.read_text(encoding="utf-8"))
        overlay = json.loads(args.overlay.read_text(encoding="utf-8"))
        joined = compose(native, overlay)
        dump_new(args.output, joined)
        result = {"manifest": str(args.output), "sha256": digest_file(args.output)}
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, KeyError, zipfile.BadZipFile, tarfile.TarError) as error:
        print(f"Node dependency assembly: {error}", file=sys.stderr)
        raise SystemExit(2)
