"""Package a completed prefix through conda-pack without losing source origins.

The dependency completer produces a private staging copy. Passing only its new
path to conda-pack loses the old prefix/cache metadata. This adapter keeps each
original File record (or its exact selected donor record), and carries retained
conda-unpack relocation literals into the normal conda-pack writer. No foreign
executable is run and no replacement relocation implementation is introduced.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import sys
import stat
import uuid
from typing import Callable, Iterable

if __package__:
    from .payload_closure import PayloadError, Prefix, digest, target_name, _same_file
    from .transport import atomic_json, canonical, file_hash, read_json, stamp
    from .conda_sources import CacheSources, path_key
else:
    from payload_closure import PayloadError, Prefix, digest, target_name, _same_file
    from transport import atomic_json, canonical, file_hash, read_json, stamp
    from conda_sources import CacheSources, path_key

from model import portable_fs as fs


SCHEMA = "upstate.native-pack-transaction/v1"
BLOCK = 1024 * 1024


class PackingError(ValueError):
    """The requested packing operation differs from its retained source or output."""


def _exists(path: Path) -> bool:
    try:
        fs.native_path(path).lstat()
    except FileNotFoundError:
        return False
    return True


def _regular(path: Path):
    value = fs.path_stat(path)
    if not stat.S_ISREG(value.st_mode):
        raise PackingError("Expected a regular packing file: " + str(path))
    return value


def _identity(value):
    return (value.st_dev, value.st_ino, value.st_size,
            value.st_mtime_ns, value.st_ctime_ns, value.st_mode)


def _directory(path: Path) -> Path:
    path = fs.native_path(path)
    value = path.lstat()
    if not stat.S_ISDIR(value.st_mode) or path.is_symlink():
        raise PackingError("Packing directory must not be a link: " + str(path))
    # Windows reparse directories also require the existing native path check.
    if os.name == "nt":
        fs.sync_directory(path)
    return path


def source_snapshot(prefixes: Iterable[str | Path]) -> dict:
    """Bind original, completed and donor files, including modes and link targets.

    Hard-linked bodies are read once per snapshot. File identity is checked
    across each read so concurrent source edits cannot silently enter a pack.
    Symlinks are inventoried, not traversed, and must remain inside their prefix.
    The receipt stores the resulting tree digests rather than all file names.
    """
    def walk_error(error):
        raise error

    result = []
    bodies = {}
    for value in prefixes:
        root = fs.native_path(Path(value).resolve(strict=True))
        _directory(root)
        tree = hashlib.sha256()
        count = 0
        amount = 0
        for directory, subdirs, files in os.walk(root, followlinks=False, onerror=walk_error):
            subdirs.sort()
            for name in sorted(subdirs + files):
                path = Path(directory) / name
                before = path.lstat()
                relative = path.relative_to(root).as_posix()
                row = {"path": relative, "mode": stat.S_IMODE(before.st_mode)}
                if stat.S_ISLNK(before.st_mode):
                    target = os.readlink(path)
                    try:
                        path.resolve(strict=True).relative_to(root)
                    except (ValueError, OSError, RuntimeError) as exc:
                        raise PackingError("Packing source link leaves its prefix: " + relative) from exc
                    if _identity(path.lstat()) != _identity(before):
                        raise PackingError("Packing source link changed: " + relative)
                    row.update(kind="link", target=target)
                elif stat.S_ISDIR(before.st_mode):
                    # On Windows a junction is not necessarily classified as a
                    # symlink. The native layer rejects the reparse point.
                    if os.name == "nt":
                        fs.sync_directory(path)
                    row["kind"] = "directory"
                elif stat.S_ISREG(before.st_mode):
                    # Native Windows ChangeTime must be used on both sides;
                    # pathlib st_ctime can instead mean file creation time.
                    before = fs.path_stat(path)
                    key = _identity(before)
                    digest = bodies.get(key)
                    if digest is None:
                        digest_state = hashlib.sha256()
                        descriptor = fs.open_file(path, os.O_RDONLY)
                        with os.fdopen(descriptor, "rb") as stream:
                            opened = fs.fd_stat(stream.fileno())
                            if _identity(opened) != key:
                                raise PackingError("Packing source changed before reading: " + relative)
                            for block in iter(lambda: stream.read(BLOCK), b""):
                                digest_state.update(block)
                            if _identity(fs.fd_stat(stream.fileno())) != key:
                                raise PackingError("Packing source changed while reading: " + relative)
                        digest = digest_state.hexdigest()
                        bodies[key] = digest
                    if _identity(fs.path_stat(path)) != key:
                        raise PackingError("Packing source changed after reading: " + relative)
                    row.update(kind="file", bytes=before.st_size, sha256=digest)
                    count += 1
                    amount += before.st_size
                else:
                    raise PackingError("Unsupported packing source member: " + relative)
                tree.update(canonical(row) + b"\n")
        result.append({"prefix": str(root), "files": count, "bytes": amount,
                       "tree_sha256": tree.hexdigest()})
    return {"prefixes": result}


def _read(path: Path) -> dict:
    _regular(path)
    body = read_json(fs.native_path(path))
    if not isinstance(body, dict):
        raise PackingError("Invalid native packing record: " + path.name)
    return body


def _state(path: Path, request_sha256: str, phase: str, **fields) -> dict:
    value = {"schema": SCHEMA, "request_sha256": request_sha256,
             "phase": phase, "updated_at": stamp(), **fields}
    atomic_json(path, value)
    return value


def _payload_path(journal: Path, name: str) -> Path:
    if (not isinstance(name, str) or len(name) != 48
            or not name.startswith("payload-") or not name.endswith(".partial")
            or any(c not in "0123456789abcdef" for c in name[8:-8])):
        raise PackingError("Invalid retained packing payload name")
    return journal / name


def _verify(path: Path, record: dict) -> None:
    info = _regular(path)
    if info.st_size != record.get("bytes") or file_hash(fs.native_path(path)) != record.get("sha256"):
        raise PackingError("Completed native archive differs from retained bytes: " + str(path))


def _result(state: dict, output: Path, journal: Path, reused: bool) -> dict:
    result = dict(state["result"])
    archive = dict(result["archive"])
    archive["filename"] = output.name
    result.update(archive=archive, reused=reused,
                  packing_operation={"schema": SCHEMA,
                      "request_sha256": state["request_sha256"]})
    return result


def publish_archive(output: str | Path, request: dict, build: Callable[[Path], dict], *,
                    resume: bool = False, check_source: Callable[[], dict] | None = None) -> dict:
    """Publish or recover one source-bound archive made by the maintained writer.

    build(path) writes a new archive and returns the existing platform descriptor
    with archive:{filename,bytes,sha256}. The exact payload is retained before
    publication. --resume can finish publication or reuse an owned final output;
    it cannot adopt another writer's file or change a retained request.
    """
    if not isinstance(request, dict):
        raise PackingError("A native packing request must be an object")
    output = fs.native_path(Path(output).absolute())
    output.parent.mkdir(parents=True, exist_ok=True)
    output = output.parent.resolve(strict=True) / output.name
    journal = output.with_name("." + output.name + ".native-pack")
    lock = output.with_name("." + output.name + ".native-pack.lock")
    # A nonblocking shared native lock avoids launching a second compression
    # stream when another seat still owns the same output.
    with fs.locked(lock, blocking=False):
        if _exists(journal):
            _directory(journal)
            if not resume:
                raise PackingError("Packing operation already exists; resume its original request: " + str(journal))
            retained = _read(journal / "request.json")
            if retained.get("schema") != SCHEMA or retained.get("request") != request:
                raise PackingError("Native packing request changed; select a new output archive")
            signature = hashlib.sha256(canonical(request)).hexdigest()
            if retained.get("request_sha256") != signature:
                raise PackingError("Native packing request record changed")
            state = _read(journal / "state.json")
            if state.get("schema") != SCHEMA or state.get("request_sha256") != signature:
                raise PackingError("Native packing state does not belong to this request")
        else:
            if _exists(output):
                raise PackingError("Output exists without this packing operation: " + str(output))
            signature = hashlib.sha256(canonical(request)).hexdigest()
            temporary = journal.with_name(journal.name + "." + uuid.uuid4().hex + ".new")
            temporary.mkdir(mode=0o700)
            atomic_json(temporary / "request.json", {"schema": SCHEMA, "request": request,
                                                       "request_sha256": signature})
            state = _state(temporary / "state.json", signature, "pending")
            fs.publish_directory(temporary, journal)
        state_path = journal / "state.json"
        phase = state.get("phase")
        if phase in ("packed", "complete"):
            if not isinstance(state.get("result"), dict) or not isinstance(state["result"].get("archive"), dict):
                raise PackingError("Invalid retained native archive result")
            archive = state["result"]["archive"]
            if _exists(output):
                _verify(output, archive)
            else:
                payload = _payload_path(journal, state.get("payload"))
                _verify(payload, archive)
                fs.publish_file(payload, output)
                fs.sync_directory(output.parent)
            if phase != "complete":
                state = _state(state_path, signature, "complete", result=state["result"],
                               payload=state["payload"])
            return _result(state, output, journal, True)
        if phase not in ("pending", "packing", "interrupted"):
            raise PackingError("Unknown native packing phase: " + str(phase))
        if _exists(output):
            raise PackingError("An unrelated output appeared before native packing completed")
        # Retain interrupted partial bytes under their original unique name.
        # A new attempt never overwrites or mistakes them for a finished pack.
        payload = journal / ("payload-" + uuid.uuid4().hex + ".partial")
        _state(state_path, signature, "packing", payload=payload.name)
        try:
            result = build(payload)
            if not isinstance(result, dict) or not isinstance(result.get("archive"), dict):
                raise PackingError("Native packer did not return an archive descriptor")
            _verify(payload, result["archive"])
            # Windows FlushFileBuffers requires a write-capable handle.
            descriptor = fs.open_file(payload, os.O_RDWR)
            with os.fdopen(descriptor, "r+b") as stream:
                os.fsync(stream.fileno())
            if check_source is not None and check_source() != request.get("sources"):
                raise PackingError("Native source changed while packing; select a new output")
            result = dict(result)
            result["archive"] = {**result["archive"], "filename": output.name}
            # This is the recovery commit point. A lost process after here can
            # publish or finish the receipt using the same completed bytes.
        except BaseException as exc:
            _state(state_path, signature, "interrupted", payload=payload.name,
                   error={"type": type(exc).__name__, "message": str(exc)})
            raise
        state = _state(state_path, signature, "packed", result=result, payload=payload.name)
        # Deliberately outside the interrupted handler: a publication collision
        # or a lost final response must leave the valid 'packed' record intact.
        fs.publish_file(payload, output)
        fs.sync_directory(output.parent)
        state = _state(state_path, signature, "complete", result=result, payload=payload.name)
        return _result(state, output, journal, False)


def packing_environment(original_prefix: str | Path, completed_prefix: str | Path, *,
                        target: str, donors: Iterable[str | Path] = (),
                        package_caches: Iterable[str | Path] = (), _cache_sources=None):
    """Return the official CondaEnv with preserved per-file relocation origins.

    Invoke using the selected build host's conda-pack. On a POSIX cloud host,
    the isolated Windows writer retains Windows layout/relocation semantics.
    Previously relocated binaries without original cache/raw-prefix records
    cannot be made generally relocatable by guessing a new shorter placeholder.
    Supply the original unpacked archive or retained build package cache instead.
    """
    import inspect as signature_inspect
    if __package__:
        from .windows_packing import select_writer
    else:
        from windows_packing import select_writer

    target = target_name(target)
    conda_pack, writer_core = select_writer(target)
    _scripts, load_environment = writer_core._scripts, writer_core.load_environment
    original = Prefix(original_prefix, target)
    completed = Prefix(completed_prefix, target)
    if original.root == completed.root:
        raise PayloadError('Select the separate completed staging prefix')
    owners = [original, *(Prefix(path, target) for path in donors)]
    package_caches = tuple(package_caches)
    cache_sources = _cache_sources
    if cache_sources is None and package_caches:
        cache_sources = CacheSources((owner.root for owner in owners), package_caches, target=target)
    # These are regenerated by the original writer, not duplicated as archive
    # members. Its installed activation script list is authoritative.
    generated = {str(pair[1]).replace('\\', '/') for pair in _scripts}
    generated.update({'bin/conda-unpack', 'bin/conda_unpack_progress.py',
                      'Scripts/conda-unpack-script.py', 'Scripts/conda-unpack.exe',
                      'Scripts/conda_unpack_progress.py'})
    descriptions = {}
    for owner in owners:
        options = {'ignore_missing_files': True}
        if 'on_missing_cache' in signature_inspect.signature(load_environment).parameters:
            options['on_missing_cache'] = 'ignore'
        env = conda_pack.CondaEnv.from_prefix(str(owner.root), **options)
        descriptions[owner.root] = {path_key(f.target, target): f for f in env.files}
        if cache_sources is not None:
            descriptions[owner.root] = cache_sources.augment(owner.root, conda_pack, descriptions[owner.root], core=writer_core)
    files = []
    for parent, directories, names in os.walk(completed.root, followlinks=False):
        for name in directories[:]:
            if (Path(parent) / name).is_symlink():
                names.append(name); directories.remove(name)
        for name in sorted(names):
            staged = Path(parent) / name
            rel = staged.relative_to(completed.root).as_posix()
            if rel in generated or rel.startswith(('bin/__pycache__/conda_unpack_progress.',
                                                   'Scripts/__pycache__/conda_unpack_progress.')):
                continue
            origin = None
            for owner in owners:
                candidate = owner.root / owner.paths.get(path_key(rel, target), rel)
                if candidate.exists() or candidate.is_symlink():
                    if staged.is_symlink() and candidate.is_symlink():
                        try:
                            equivalent = (staged.resolve(strict=False).relative_to(completed.root)
                                          == candidate.resolve(strict=False).relative_to(owner.root))
                        except ValueError:
                            equivalent = False
                    else:
                        equivalent = _same_file(candidate, staged)
                    if equivalent:
                        origin = owner; break
            if origin is None:
                if rel != 'NATIVE_PAYLOAD_CLOSURE.json' and not rel.startswith('licenses/'):
                    raise PayloadError('Staged file has no unchanged source origin: ' + rel)
                files.append(conda_pack.File(str(staged), rel, is_conda=False))
                continue
            description = descriptions[origin.root].get(path_key(rel, target))
            if staged.is_symlink():
                # Use the completed relative link, not an original absolute link.
                files.append(conda_pack.File(str(staged), rel,
                                             is_conda=bool(description and description.is_conda)))
                continue
            if description is not None and description.file_mode != 'unknown':
                # A cached original File can point to a long raw package prefix;
                # retain that source and its official conda-pack placeholder.
                files.append(conda_pack.File(description.source, rel, description.is_conda,
                                             description.file_mode, description.prefix_placeholder))
                continue
            source = origin.root / origin.paths.get(path_key(rel, target), rel)
            source_relative = source.relative_to(origin.root).as_posix()
            retained = origin.relocations.get(source_relative)
            with source.open('rb') as stream:
                data = stream.read()
            placeholder = retained[0] if retained and retained[0].encode() in data else None
            mode = retained[1] if placeholder else None
            if not placeholder:
                old_prefix = str(origin.root)
                if old_prefix.encode() in data:
                    if b'\0' in data and not target.startswith('windows-'):
                        raise PayloadError('Already-relocated binary needs its original raw archive/package cache: ' + rel)
                    placeholder, mode = old_prefix, ('binary' if b'\0' in data else 'text')
                elif b'\0' not in data:
                    # Text can contain the base build prefix even when it is
                    # absent today; the standard writer will also repair scripts.
                    placeholder, mode = old_prefix, 'text'
            files.append(conda_pack.File(str(source), rel, bool(description and description.is_conda),
                                         mode, placeholder))
    files.sort(key=lambda f: f.target)
    return conda_pack.CondaEnv(str(original.root), files)


def pack_completed(original_prefix: str | Path, completed_prefix: str | Path, output: str | Path, *,
                   target: str, donors: Iterable[str | Path] = (), format: str = 'tar.gz',
                   archive_root: str = 'runtime', resume: bool = False,
                   package_caches: Iterable[str | Path] = ()) -> dict:
    """Pack once and recover the same archive across interrupted handoffs."""
    target = target_name(target)
    if format not in ('tar.gz', 'zip'):
        raise PayloadError('Use the maintained tar.gz or zip receiving format')
    if archive_root not in ('', 'runtime'):
        raise PayloadError('archive_root must match the receiver: empty or runtime')
    output = Path(output).absolute()
    output = fs.native_path(output.parent.resolve(strict=False) / output.name)
    donors = tuple(donors)
    prefixes = (original_prefix, completed_prefix, *donors)
    package_caches = tuple(package_caches)
    cache_sources = CacheSources((original_prefix, *donors), package_caches, target=target) if package_caches else None
    if cache_sources is not None:
        prefixes += cache_sources.roots
    for source in (*prefixes, *package_caches):
        if output.is_relative_to(fs.native_path(Path(source).resolve(strict=True))):
            raise PayloadError('Output archive must be outside runtime prefixes and package caches')
    sources = source_snapshot(prefixes)
    request = {'schema': 'upstate.native-payload-pack-request/v1',
               'target': target, 'format': format, 'archive_root': archive_root,
               'output': str(output), 'sources': sources}
    if cache_sources is not None:
        request['package_sources'] = cache_sources.receipt

    def build(temporary):
        environment = packing_environment(original_prefix, completed_prefix, target=target, donors=donors,
                                          package_caches=package_caches, _cache_sources=cache_sources)
        environment.pack(output=str(temporary), format=format, arcroot=archive_root,
                         zip_symlinks=True, zip_64=True, n_threads=1, verbose=False)
        return {'schema': 'upstate.native-payload-archive/v1', 'target': target,
                'archive': {'filename': output.name, 'bytes': temporary.stat().st_size,
                            'sha256': digest(temporary)},
                'format': format, 'archive_root': archive_root,
                'relocation': {'script': 'Scripts/conda-unpack-script.py' if target.startswith('windows-') else 'bin/conda-unpack'}}

    return publish_archive(output, request, build, resume=resume,
                           check_source=lambda: source_snapshot(prefixes))


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('original_prefix', type=Path); p.add_argument('completed_prefix', type=Path)
    p.add_argument('output', type=Path); p.add_argument('--target', required=True)
    p.add_argument('--donor', action='append', type=Path, default=[])
    p.add_argument('--package-cache', action='append', type=Path, default=[],
                   help='Reconnect selected raw packages from a transported extracted conda cache')
    p.add_argument('--format', choices=('tar.gz', 'zip'), default='tar.gz')
    p.add_argument('--archive-root', choices=('', 'runtime'), default='runtime')
    p.add_argument('--json', type=Path)
    p.add_argument('--resume', action='store_true', help='Recover the same source-bound packing operation without replacing another output')
    a = p.parse_args(argv)
    try:
        if a.json:
            report = fs.native_path(a.json.resolve(strict=False))
            output = fs.native_path(a.output.resolve(strict=False))
            journal = output.with_name('.' + output.name + '.native-pack')
            lock = output.with_name('.' + output.name + '.native-pack.lock')
            if report in (output, lock) or report.is_relative_to(journal):
                raise PayloadError('JSON report must be separate from the archive and its packing state')
            if any(report.is_relative_to(fs.native_path(path.resolve(strict=True)))
                   for path in (a.original_prefix, a.completed_prefix, *a.donor, *a.package_cache)):
                raise PayloadError('JSON report must remain outside native prefixes and package caches')
        result = pack_completed(a.original_prefix, a.completed_prefix, a.output, target=a.target,
                                donors=a.donor, format=a.format, archive_root=a.archive_root, resume=a.resume,
                                package_caches=a.package_cache)
        text = json.dumps(result, indent=2) + '\n'
        if a.json:
            atomic_json(a.json, result)
        print(text, end=''); return 0
    except (PayloadError, OSError, ValueError, ImportError) as exc:
        print('Native payload packing: ' + str(exc), file=sys.stderr); return 2


if __name__ == '__main__':
    raise SystemExit(main())
