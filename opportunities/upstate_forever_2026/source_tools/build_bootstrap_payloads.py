#!/usr/bin/env python3
"""Build offline first-stage Python payloads without installing target runtimes.

Consumes pinned upstream install_only archives; preserves their complete Python
installation and licenses. The original scientific receiver still owns conda
relocation, qualification and cache state. This builder never executes a foreign
architecture and never modifies studies, application source or a scientific pack.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import platform
import re
import shutil
import stat
import struct
import subprocess
import sys
import tarfile
import tempfile
import unicodedata
import urllib.parse
import urllib.request
import uuid
import zipfile

SCHEMA = 'upstate.bootstrap-sources/v1'
DESCRIPTORS = 'upstate.bootstrap-payloads/v1'
TARGETS = {'windows-x86_64': ('Windows', 'x86_64', 'python.exe'),
           'macos-x86_64': ('Darwin', 'x86_64', 'bin/python3'),
           'macos-arm64': ('Darwin', 'arm64', 'bin/python3'),
           'linux-x86_64': ('Linux', 'x86_64', 'bin/python3')}
ALIASES = {'darwin-x86_64': 'macos-x86_64', 'darwin-arm64': 'macos-arm64'}
BLOCK = 1024 * 1024
MAX_ARCHIVE = 512 * BLOCK
MAX_EXPANDED = 3 * 1024 * BLOCK
RECEIPT = '.ecosystem-bootstrap.json'
RESERVED = re.compile(r'^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)', re.I)


def target_key(value: str) -> str:
    value = ALIASES.get(value, value)
    if value not in TARGETS:
        raise ValueError('Unsupported bootstrap target: ' + value)
    return value


def host_target() -> str:
    system = platform.system()
    machine = platform.machine().lower()
    machine = {'amd64': 'x86_64', 'aarch64': 'arm64'}.get(machine, machine)
    # A translated x86 Python may run on Apple Silicon. Select native arm64.
    if system == 'Darwin' and machine == 'x86_64':
        query = subprocess.run(['/usr/sbin/sysctl', '-n', 'hw.optional.arm64'],
                               capture_output=True, text=True, check=False)
        if query.returncode == 0 and query.stdout.strip() == '1':
            machine = 'arm64'
    return {'Windows': 'windows', 'Darwin': 'macos', 'Linux': 'linux'}.get(system, system.lower()) + '-' + machine


def relative(value: str, *, empty: bool = False) -> str:
    if empty and value == '':
        return ''
    if not isinstance(value, str) or not value or '\\' in value:
        raise ValueError('Expected a nonempty portable relative path: ' + repr(value))
    p = PurePosixPath(value)
    if p.is_absolute() or str(p) != value or any(part in ('.', '..') for part in p.parts):
        raise ValueError('Noncanonical or escaping path: ' + value)
    for part in p.parts:
        if part[-1:] in (' ', '.') or RESERVED.match(part) or any(ord(c) < 32 or c in ':*?"<>|' for c in part):
            raise ValueError('Path is not portable to the receiving Windows filesystem: ' + value)
    return value


def digest_file(path: Path) -> tuple[int, str]:
    if path.is_symlink():
        raise ValueError('Expected a regular file, not a link: ' + str(path))
    with path.open('rb') as stream:
        before = os.fstat(stream.fileno())
        if not stat.S_ISREG(before.st_mode):
            raise ValueError('Expected a regular file: ' + str(path))
        h = hashlib.sha256()
        count = 0
        while data := stream.read(BLOCK):
            h.update(data)
            count += len(data)
        after = os.fstat(stream.fileno())
    if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) != (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns) or count != before.st_size:
        raise ValueError('Source changed while being read: ' + str(path))
    return count, h.hexdigest()


def json_bytes(value: dict) -> bytes:
    return (json.dumps(value, sort_keys=True, indent=2, ensure_ascii=False, allow_nan=False) + '\n').encode('utf-8')


def write_new(path: Path, data: bytes) -> None:
    """Publish a complete new file; do not overwrite any concurrently placed file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name('.' + path.name + '.' + uuid.uuid4().hex)
    try:
        with temporary.open('xb') as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        # Same-directory hard linking is atomic and preserves an occupied name.
        os.link(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def read_sources(path: Path) -> dict:
    value = json.loads(path.read_text(encoding='utf-8'))
    if value.get('schema') != SCHEMA or not isinstance(value.get('platforms'), dict):
        raise ValueError('Use a pinned upstate.bootstrap-sources/v1 source manifest.')
    rows = {}
    for key, row in value['platforms'].items():
        key = target_key(key)
        if key in rows:
            raise ValueError('Two source records resolve to the same target: ' + key)
        row = copy.deepcopy(row)
        if not re.fullmatch('[0-9a-f]{64}', row.get('sha256', '')):
            raise ValueError('A complete upstream SHA-256 is required for ' + key)
        url = urllib.parse.urlsplit(row.get('url', ''))
        if url.scheme != 'https' or not url.hostname or url.username or url.password or url.fragment:
            raise ValueError('Use an explicit public HTTPS artifact URL without credentials.')
        relative(row.get('archive_root', ''))
        relative(row.get('python', TARGETS[key][2]))
        name = row.get('filename', '')
        if relative(name) != PurePosixPath(name).name:
            raise ValueError('Archive filename must be a single portable name.')
        if 'bytes' in row and (type(row['bytes']) is not int or not 0 < row['bytes'] <= MAX_ARCHIVE):
            raise ValueError('Invalid pinned artifact byte count.')
        rows[key] = row
    value['platforms'] = rows
    return value


def verify_archive(path: Path, row: dict) -> dict:
    size, sha = digest_file(path)
    if size > MAX_ARCHIVE or sha != row['sha256'] or ('bytes' in row and size != row['bytes']):
        raise ValueError('Bootstrap archive does not match its pinned upstream identity: ' + str(path))
    return {'filename': row['filename'], 'bytes': size, 'sha256': sha, 'url': row['url']}


def fetch(row: dict, cache: Path) -> Path:
    """Fetch a pinned public artifact into a content-addressed, reusable cache."""
    root = cache / row['sha256']
    root.mkdir(parents=True, exist_ok=True)
    destination = root / row['filename']
    if destination.exists() or destination.is_symlink():
        verify_archive(destination, row)
        return destination
    temporary = root / ('.download-' + uuid.uuid4().hex)
    request = urllib.request.Request(row['url'], headers={'User-Agent': 'Ecosystem-Workbench-Packaging/1'})
    try:
        with urllib.request.urlopen(request, timeout=60) as response, temporary.open('xb') as output:
            if urllib.parse.urlsplit(response.url).scheme != 'https':
                raise ValueError('Refusing a downgrade from HTTPS for a bootstrap artifact.')
            length = 0
            while chunk := response.read(BLOCK):
                length += len(chunk)
                if length > MAX_ARCHIVE:
                    raise ValueError('Bootstrap artifact exceeded the archive size limit.')
                output.write(chunk)
            output.flush()
            os.fsync(output.fileno())
        verify_archive(temporary, row)
        try:
            os.link(temporary, destination)
        except FileExistsError:
            verify_archive(destination, row)
    finally:
        temporary.unlink(missing_ok=True)
    return destination


def archive_index(archive: tarfile.TarFile, root: str) -> dict[str, tarfile.TarInfo]:
    """Validate once and resolve links later without creating filesystem links."""
    entries, names, total = {}, {}, 0
    for member in archive:
        name = member.name.rstrip('/')
        relative(name)
        if name == root and member.isdir():
            continue
        if not name.startswith(root + '/'):
            raise ValueError('Bootstrap archive contains another root: ' + name)
        leaf = relative(name[len(root) + 1:])
        if leaf.casefold() == RECEIPT.casefold():
            raise ValueError('Bootstrap archive occupies a reserved packaging receipt.')
        folded = unicodedata.normalize('NFC', leaf).casefold()
        if folded in names:
            raise ValueError('Duplicate or case/Unicode-colliding bootstrap members: ' + leaf)
        names[folded] = leaf
        if not (member.isfile() or member.isdir() or member.issym() or member.islnk()):
            raise ValueError('Unsupported special bootstrap member: ' + leaf)
        if member.size < 0:
            raise ValueError('Negative archive member size: ' + leaf)
        entries[leaf] = member
        total += member.size
        if len(entries) > 50000 or total > MAX_EXPANDED:
            raise ValueError('Bootstrap archive exceeds extraction limits.')
    for name in entries:
        for ancestor in PurePosixPath(name).parents:
            if str(ancestor) == '.':
                continue
            parent = entries.get(str(ancestor))
            if parent and not parent.isdir():
                raise ValueError('A bootstrap member uses a file/link as a directory: ' + name)
    return entries


def link_target(name: str, member: tarfile.TarInfo, root: str) -> str:
    link = member.linkname
    if not link or '\\' in link or link.startswith('/'):
        raise ValueError('Invalid bootstrap link: ' + name)
    if member.islnk():
        if not link.startswith(root + '/'):
            raise ValueError('Bootstrap hard link leaves its original root: ' + name)
        parts = []
        values = link[len(root) + 1:].split('/')
    else:
        parts = list(PurePosixPath(name).parent.parts)
        values = link.split('/')
    for part in values:
        if part in ('', '.'):
            continue
        if part == '..':
            if not parts:
                raise ValueError('Bootstrap link leaves its original root: ' + name)
            parts.pop()
        else:
            parts.append(part)
    return relative('/'.join(parts))


def regular_member(name: str, entries: dict, root: str) -> tarfile.TarInfo:
    seen = set()
    while True:
        if name in seen or name not in entries:
            raise ValueError('Cyclic or missing bootstrap link destination: ' + name)
        seen.add(name)
        member = entries[name]
        if member.isfile():
            return member
        if not (member.issym() or member.islnk()):
            raise ValueError('Directory aliases are not supported in a flat bootstrap payload: ' + name)
        name = link_target(name, member, root)


def executable_identity(path: Path, target: str) -> dict:
    """Read the binary header; this never runs an executable for another target."""
    with path.open('rb') as stream:
        head = stream.read(4096)
        if target.startswith('windows-'):
            if head[:2] != b'MZ' or len(head) < 64:
                raise ValueError('The Windows bootstrap interpreter is not a PE executable.')
            offset = struct.unpack_from('<I', head, 60)[0]
            stream.seek(offset)
            pe = stream.read(26)
            if len(pe) < 26 or pe[:4] != b'PE\0\0' or struct.unpack_from('<H', pe, 4)[0] != 0x8664 or struct.unpack_from('<H', pe, 24)[0] != 0x20b:
                raise ValueError('The Windows bootstrap is not PE32+ x86-64.')
            return {'format': 'pe', 'machine': 'x86_64'}
        if target.startswith('macos-'):
            if head[:4] != b'\xcf\xfa\xed\xfe' or len(head) < 32:
                raise ValueError('Use the thin 64-bit Mach-O bootstrap for the selected Mac target.')
            cpu = struct.unpack_from('<I', head, 4)[0]
            expected = 0x100000c if target == 'macos-arm64' else 0x1000007
            if cpu != expected:
                raise ValueError('The Mac bootstrap CPU does not match the selected target.')
            command_bytes = struct.unpack_from('<I', head, 20)[0]
            if command_bytes > BLOCK:
                raise ValueError('Invalid Mach-O load-command table.')
            stream.seek(32)
            commands = stream.read(command_bytes)
            offset, minimum = 0, None
            count = struct.unpack_from('<I', head, 16)[0]
            for _ in range(count):
                if offset + 8 > len(commands):
                    raise ValueError('Truncated Mach-O load command.')
                kind, length = struct.unpack_from('<II', commands, offset)
                if length < 8 or offset + length > len(commands):
                    raise ValueError('Invalid Mach-O load command length.')
                if kind == 0x32 and length >= 24:  # LC_BUILD_VERSION
                    minimum = struct.unpack_from('<I', commands, offset + 12)[0]
                elif kind == 0x24 and length >= 16:  # LC_VERSION_MIN_MACOSX
                    minimum = struct.unpack_from('<I', commands, offset + 8)[0]
                offset += length
            result = {'format': 'mach-o', 'machine': TARGETS[target][1]}
            if minimum is not None:
                result['minimum_os_version'] = f'{minimum >> 16}.{(minimum >> 8) & 255}.{minimum & 255}'
            return result
        if head[:6] != b'\x7fELF\x02\x01' or len(head) < 20 or struct.unpack_from('<H', head, 18)[0] != 62:
            raise ValueError('The Linux reference bootstrap is not ELF64 x86-64.')
        return {'format': 'elf', 'machine': 'x86_64'}


def validate_payload(collection: Path, descriptor: dict) -> None:
    directory = collection / relative(descriptor['directory'])
    for row in descriptor['files']:
        path = directory / relative(row['path'])
        if digest_file(path) != (row['bytes'], row['sha256']):
            raise ValueError('An existing bootstrap file differs: ' + str(path))
    if descriptor['python'] not in {row['path'] for row in descriptor['files']}:
        raise ValueError('Bootstrap inventory omits its interpreter.')


def stage(archive_path: Path, source: dict, target: str, collection: Path) -> dict:
    target = target_key(target)
    upstream = verify_archive(archive_path, source)
    parent = collection / 'bootstrap'
    parent.mkdir(parents=True, exist_ok=True)
    destination = parent / target
    descriptor_path = parent / (target + '.json')
    if destination.exists() or destination.is_symlink():
        receipt = destination / RECEIPT
        if destination.is_symlink() or not destination.is_dir() or receipt.is_symlink() or not receipt.is_file():
            raise ValueError('Occupied bootstrap destination has no complete embedded descriptor: ' + str(destination))
        descriptor = json.loads(receipt.read_text(encoding='utf-8'))
        if descriptor.get('directory') != 'bootstrap/' + target:
            raise ValueError('An existing bootstrap receipt names another target.')
        if descriptor.get('upstream') != upstream:
            raise ValueError('Keep the existing bootstrap; use a new collection for a changed pinned source.')
        validate_payload(collection, descriptor)
        # Recover publication interrupted after the atomic directory rename.
        # Existing executable bytes are always checked before its index is restored.
        try:
            write_new(descriptor_path, json_bytes(descriptor))
        except FileExistsError:
            if descriptor_path.is_symlink() or descriptor_path.read_bytes() != json_bytes(descriptor):
                raise ValueError('Existing bootstrap descriptor differs: ' + str(descriptor_path))
        return descriptor
    temporary = Path(tempfile.mkdtemp(prefix='.' + target + '-', dir=parent))
    published = False
    try:
        files, expanded = [], 0
        # The SHA was checked before opening. Recheck the open file's identity
        # after extraction to detect a concurrent source replacement or mutation.
        with archive_path.open('rb') as raw:
            initial = os.fstat(raw.fileno())
            with tarfile.open(fileobj=raw, mode='r:gz') as archive:
                entries = archive_index(archive, source['archive_root'])
                required = source.get('python', TARGETS[target][2])
                if required not in entries:
                    raise ValueError('The pinned archive lacks its declared interpreter: ' + required)
                for name, entry in sorted(entries.items()):
                    output = temporary / name
                    if entry.isdir():
                        output.mkdir(parents=True, exist_ok=True)
                        continue
                    original = regular_member(name, entries, source['archive_root'])
                    expanded += original.size
                    if expanded > MAX_EXPANDED:
                        raise ValueError('Resolved bootstrap links exceed extraction limits.')
                    output.parent.mkdir(parents=True, exist_ok=True)
                    source_stream = archive.extractfile(original)
                    if source_stream is None:
                        raise ValueError('Missing archive file body: ' + name)
                    h, size = hashlib.sha256(), 0
                    with source_stream, output.open('xb') as dest:
                        while chunk := source_stream.read(BLOCK):
                            dest.write(chunk)
                            size += len(chunk)
                            h.update(chunk)
                    if size != original.size:
                        raise ValueError('Truncated bootstrap file body: ' + name)
                    mode = 0o755 if original.mode & 0o111 or name == required else 0o644
                    output.chmod(mode)
                    files.append({'path': name, 'bytes': size, 'sha256': h.hexdigest(), 'mode': oct(mode)[2:]})
            final = os.fstat(raw.fileno())
            if (initial.st_ino, initial.st_dev, initial.st_size, initial.st_mtime_ns) != (final.st_ino, final.st_dev, final.st_size, final.st_mtime_ns):
                raise ValueError('Bootstrap archive changed during extraction.')
        if not any('license' in row['path'].lower() or 'copying' in row['path'].lower() for row in files):
            raise ValueError('The supplied installation contains no license text; retain the upstream licenses.')
        descriptor = {'directory': 'bootstrap/' + target, 'python': required,
                      'files': files, 'upstream': upstream,
                      'python_version': source['python_version'],
                      'platform': {'system': TARGETS[target][0], 'machine': TARGETS[target][1]},
                      'executable': executable_identity(temporary / required, target),
                      'link_materialization': 'regular-file-copies',
                      'file_count': len(files), 'total_bytes': sum(row['bytes'] for row in files)}
        # Hash again before publishing executable bytes, not after installing them.
        verify_archive(archive_path, source)
        # Keep the completed descriptor inside the atomically published directory.
        write_new(temporary / RECEIPT, json_bytes(descriptor))
        os.rename(temporary, destination)
        published = True
        try:
            write_new(descriptor_path, json_bytes(descriptor))
        except FileExistsError:
            if descriptor_path.read_bytes() != json_bytes(descriptor):
                raise ValueError('Concurrent bootstrap descriptor differs: ' + str(descriptor_path))
        return descriptor
    finally:
        if not published:
            shutil.rmtree(temporary, ignore_errors=True)


def probe_host(collection: Path, target: str, descriptor: dict) -> dict:
    if target_key(target) != host_target():
        raise ValueError('A native bootstrap probe needs the actual target OS and CPU.')
    validate_payload(collection, descriptor)
    executable = collection / descriptor['directory'] / descriptor['python']
    clean = {k: v for k, v in os.environ.items() if not k.startswith(('PYTHON', 'CONDA_', 'PIP_')) and k not in ('VIRTUAL_ENV', 'LD_LIBRARY_PATH', 'DYLD_LIBRARY_PATH')}
    clean['PYTHONDONTWRITEBYTECODE'] = '1'
    code = '''import bz2,ctypes,gzip,hashlib,json,lzma,os,ssl,subprocess,sys,tarfile,tempfile,zipfile,zlib
assert hasattr(tarfile,"data_filter")
assert hashlib.sha256(b"bootstrap").hexdigest()
assert bz2.decompress(bz2.compress(b"data")) == b"data"
assert lzma.decompress(lzma.compress(b"data")) == b"data"
with tempfile.TemporaryDirectory(prefix="eco bootstrap ") as d:
 p=os.path.join(d,"own-data.txt")
 with open(p,"w",encoding="utf-8") as f:f.write("original")
 assert open(p,encoding="utf-8").read()=="original"
child=subprocess.run([sys.executable,"-I","-B","-c","print('ready')"],capture_output=True,text=True,check=True)
assert child.stdout.strip()=="ready"
print(json.dumps({"python_version":sys.version.split()[0],"platform":sys.platform,"ssl":ssl.OPENSSL_VERSION,"stdlib_receive":"ready","child_start":"ready"}))'''
    result = subprocess.run([str(executable), '-I', '-B', '-c', code],
                            capture_output=True, text=True, check=False, env=clean, timeout=60)
    if result.returncode:
        raise RuntimeError('The native bootstrap probe failed: ' + result.stderr.strip())
    answer = json.loads(result.stdout)
    if answer['python_version'] != descriptor['python_version']:
        raise ValueError('The runnable bootstrap Python differs from its pinned version.')
    return answer


def join_spec(spec: dict, descriptors: dict) -> dict:
    if spec.get('schema') != 'upstate.offline-native-runtime/v2' or not isinstance(spec.get('platforms'), dict):
        raise ValueError('Join bootstraps into the existing v2 platforms runtime manifest.')
    result = copy.deepcopy(spec)
    for key, descriptor in descriptors['platforms'].items():
        key = target_key(key)
        matching = [name for name in result['platforms'] if target_key(name) == key]
        if len(matching) != 1:
            raise ValueError('The actual scientific runtime target must exist exactly once: ' + key)
        row = result['platforms'][matching[0]]
        if row.get('bootstrap') not in (None, descriptor):
            raise ValueError('Preserve the existing different bootstrap selection for ' + key)
        row['bootstrap'] = copy.deepcopy(descriptor)
    return result


def make_zip(collection: Path, descriptors: dict, output: Path) -> dict:
    names = set()
    for key, row in descriptors['platforms'].items():
        validate_payload(collection, row)
        names.add('bootstrap/' + key + '.json')
        names.add(row['directory'] + '/' + RECEIPT)
        for file_row in row['files']:
            names.add(row['directory'] + '/' + file_row['path'])
    temporary = output.with_name('.' + output.name + '.' + uuid.uuid4().hex)
    output.parent.mkdir(parents=True, exist_ok=True)
    try:
        with zipfile.ZipFile(temporary, 'x', compression=zipfile.ZIP_DEFLATED, compresslevel=6, allowZip64=True) as archive:
            for name in sorted(names):
                path = collection / name
                info = zipfile.ZipInfo(name, (2026, 10, 14, 0, 0, 0))
                info.create_system = 3
                info.compress_type = zipfile.ZIP_DEFLATED
                mode = 0o755 if path.stat().st_mode & 0o111 else 0o644
                info.external_attr = (stat.S_IFREG | mode) << 16
                with path.open('rb') as source, archive.open(info, 'w', force_zip64=True) as destination:
                    shutil.copyfileobj(source, destination, BLOCK)
            info = zipfile.ZipInfo('BOOTSTRAPS.json', (2026, 10, 14, 0, 0, 0))
            info.create_system = 3
            info.external_attr = (stat.S_IFREG | 0o644) << 16
            archive.writestr(info, json_bytes(descriptors))
        os.link(temporary, output)
    finally:
        temporary.unlink(missing_ok=True)
    size, sha = digest_file(output)
    return {'filename': output.name, 'bytes': size, 'sha256': sha}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sources', type=Path, required=True)
    parser.add_argument('--collection', type=Path, required=True)
    parser.add_argument('--cache', type=Path)
    parser.add_argument('--archive', action='append', default=[], metavar='TARGET=PATH')
    parser.add_argument('--target', action='append', default=[])
    parser.add_argument('--fetch', action='store_true', help='Explicit build-time public artifact download; never used by recipient opening.')
    parser.add_argument('--probe-host', action='store_true')
    parser.add_argument('--spec', type=Path, help='Existing scientific v2 manifest to join without replacing it.')
    parser.add_argument('--spec-output', type=Path)
    parser.add_argument('--zip', type=Path)
    args = parser.parse_args(argv)
    sources = read_sources(args.sources)
    chosen = [target_key(t) for t in args.target] or list(sources['platforms'])
    if len(set(chosen)) != len(chosen):
        raise ValueError('Select each target once.')
    explicit = {}
    for assignment in args.archive:
        key, separator, value = assignment.partition('=')
        key = target_key(key)
        if not separator or not value or key in explicit:
            raise ValueError('Use one TARGET=PATH archive assignment per target.')
        explicit[key] = Path(value).expanduser().absolute()
    collection = args.collection.expanduser().absolute()
    if collection.is_symlink():
        raise ValueError('Use a real collection staging directory.')
    descriptors = {'schema': DESCRIPTORS, 'platforms': {}}
    probes = {}
    for key in chosen:
        if key not in sources['platforms']:
            raise ValueError('No pinned source for ' + key)
        row = sources['platforms'][key]
        if key in explicit:
            archive_path = explicit[key]
        elif args.fetch and args.cache:
            archive_path = fetch(row, args.cache)
        elif args.cache:
            archive_path = args.cache / row['sha256'] / row['filename']
        else:
            raise ValueError('Provide an original archive or explicit --fetch --cache for ' + key)
        descriptors['platforms'][key] = stage(archive_path, row, key, collection)
        if args.probe_host and key == host_target():
            probes[key] = probe_host(collection, key, descriptors['platforms'][key])
    body = json_bytes(descriptors)
    manifest = collection / 'BOOTSTRAPS.json'
    if manifest.exists():
        if manifest.read_bytes() != body:
            raise ValueError('The existing BOOTSTRAPS.json selects different payloads; use a new staging directory.')
    else:
        write_new(manifest, body)
    result = {'bootstrap_manifest': str(manifest), 'targets': chosen, 'native_probes': probes}
    if args.spec or args.spec_output:
        if not args.spec or not args.spec_output or args.spec.resolve() == args.spec_output.resolve():
            raise ValueError('Provide distinct --spec and --spec-output paths for composition.')
        spec = json.loads(args.spec.read_text(encoding='utf-8'))
        write_new(args.spec_output, json_bytes(join_spec(spec, descriptors)))
        result['composed_runtime_manifest'] = str(args.spec_output)
    if args.zip:
        result['bootstrap_overlay'] = make_zip(collection, descriptors, args.zip)
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        raise SystemExit(130)
    except (OSError, ValueError, RuntimeError, tarfile.TarError, subprocess.SubprocessError) as error:
        print('Bootstrap packaging: ' + str(error), file=sys.stderr)
        raise SystemExit(2)
