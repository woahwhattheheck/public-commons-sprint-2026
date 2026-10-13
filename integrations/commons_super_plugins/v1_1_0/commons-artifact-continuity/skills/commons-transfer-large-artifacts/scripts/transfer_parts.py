#!/usr/bin/env python3
"""Plan and verify byte-exact multipart file transfers. No network access."""
from __future__ import annotations

import argparse
import base64
import contextlib
import hashlib
import json
import os
import stat
from pathlib import Path
import sys
import tempfile

SCHEMA = 'commons.file-part.v1'


def encoded(value):
    return json.dumps(value, ensure_ascii=True, separators=(',', ':'), sort_keys=True).encode('utf-8')


def digest_file(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for part in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(part)
    return digest.hexdigest()


def envelope(transfer, index, count, offset, raw):
    return {'schema': SCHEMA, 'transfer_id': transfer, 'index': index, 'count': count,
            'offset': offset, 'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest(),
            'data_base64': base64.b64encode(raw).decode('ascii')}


def plan(source, budget, raw_limit=None):
    source = Path(source)
    if source.is_symlink() or not source.is_file():
        raise ValueError('source must be an existing regular file, not a link')
    if isinstance(budget, bool) or not isinstance(budget, int) or budget < 512:
        raise ValueError('max request bytes must be an integer of at least 512')
    if raw_limit is not None and (isinstance(raw_limit, bool) or not isinstance(raw_limit, int) or raw_limit < 1):
        raise ValueError('raw chunk limit must be positive')
    size = source.stat().st_size
    if size >= 10 ** 20:
        raise ValueError('file exceeds supported byte range')
    sha = digest_file(source)
    transfer = 'sha256-' + sha
    # A conservative metadata bound keeps every concrete envelope within budget.
    overhead = len(encoded(envelope(transfer, 10 ** 20 - 1, 10 ** 20 - 1, 10 ** 20 - 1, b''))) + 20
    chunk = ((budget - overhead) // 4) * 3
    if raw_limit is not None:
        chunk = min(chunk, raw_limit)
    if chunk < 1:
        raise ValueError('budget leaves no room for file content')
    count = max(1, (size + chunk - 1) // chunk)
    if count > 100000:
        raise ValueError('more than 100000 parts; use a larger budget or native binary upload')
    return {'schema': 'commons.file-transfer.v1', 'transfer_id': transfer, 'bytes': size,
            'sha256': sha, 'parts': count, 'raw_chunk_bytes': chunk,
            'max_request_bytes': budget, 'transport': 'file_envelopes_only', 'uploaded': False}


def write_new(path, raw):
    fd = os.open(str(path), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'wb') as stream:
        stream.write(raw)


def split(source, budget, output, raw_limit=None):
    source, target = Path(source), Path(output)
    data = plan(source, budget, raw_limit)
    if target.exists() or target.is_symlink():
        raise ValueError('output directory already exists')
    target.mkdir(parents=True, mode=0o700, exist_ok=False)
    offset, actual_digest = 0, hashlib.sha256()
    try:
        with source.open('rb') as stream:
            for index in range(data['parts']):
                raw = stream.read(data['raw_chunk_bytes'])
                item = envelope(data['transfer_id'], index, data['parts'], offset, raw)
                payload = encoded(item)
                if len(payload) > budget:
                    raise ValueError('concrete envelope exceeds budget')
                write_new(target / ('part-%06d.json' % index), payload)
                offset += len(raw)
                actual_digest.update(raw)
            if stream.read(1) or offset != data['bytes'] or actual_digest.hexdigest() != data['sha256']:
                raise ValueError('source changed during transfer preparation')
        write_new(target / 'manifest.json', encoded(data))
    except Exception:
        # Incomplete directories intentionally lack a manifest and cannot be joined.
        raise
    return dict(data, state='parts_prepared', directory=str(target))


def join(directory, output):
    root, destination = Path(directory), Path(output)
    if root.is_symlink() or not root.is_dir():
        raise ValueError('parts directory must be a regular directory')
    manifest_path = root / 'manifest.json'
    if manifest_path.is_symlink():
        raise ValueError('manifest cannot be a link')
    meta = json.loads(manifest_path.read_text(encoding='utf-8'))
    if meta.get('schema') != 'commons.file-transfer.v1':
        raise ValueError('unsupported manifest schema')
    count = meta.get('parts')
    if isinstance(count, bool) or not isinstance(count, int) or not 1 <= count <= 100000:
        raise ValueError('invalid part count')
    if destination.exists() or destination.is_symlink():
        raise ValueError('destination already exists')
    expected = {'part-%06d.json' % i for i in range(count)}
    actual = {p.name for p in root.glob('part-*.json')}
    if actual != expected:
        raise ValueError('missing or unexpected parts')
    fd, temp_name = tempfile.mkstemp(prefix='.commons-transfer-', dir=destination.parent)
    tmp = Path(temp_name)
    sha, offset = hashlib.sha256(), 0
    try:
        with os.fdopen(fd, 'wb') as stream:
            for index in range(count):
                path = root / ('part-%06d.json' % index)
                if path.is_symlink() or not path.is_file():
                    raise ValueError('part must be a regular file')
                packed = path.read_bytes()
                if len(packed) > meta['max_request_bytes']:
                    raise ValueError('part exceeds manifest budget')
                item = json.loads(packed)
                expected_fields = {'schema': SCHEMA, 'transfer_id': meta['transfer_id'],
                                   'index': index, 'count': count, 'offset': offset}
                if any(item.get(k) != v for k, v in expected_fields.items()):
                    raise ValueError('part identity, numbering or offset mismatch')
                raw = base64.b64decode(item['data_base64'], validate=True)
                if len(raw) != item['bytes'] or hashlib.sha256(raw).hexdigest() != item['sha256']:
                    raise ValueError('part byte count or digest mismatch')
                stream.write(raw)
                sha.update(raw)
                offset += len(raw)
            stream.flush()
            os.fsync(stream.fileno())
        if offset != meta['bytes'] or sha.hexdigest() != meta['sha256']:
            raise ValueError('full file byte count or digest mismatch')
        if meta['transfer_id'] != 'sha256-' + sha.hexdigest():
            raise ValueError('transfer ID mismatch')
        os.link(tmp, destination)  # Publish without replacing a concurrent destination.
        return {'state': 'restored', 'path': str(destination), 'bytes': offset,
                'sha256': sha.hexdigest(), 'transfer_id': meta['transfer_id']}
    finally:
        tmp.unlink(missing_ok=True)


# Incremental receiving uses the existing manifest and part envelopes. It owns
# only its private local directory and destination; no provider calls or jobs.
RECEIVER_SCHEMA = 'commons.file-receiver.v1'
RECEIVER_NAMES = {'.lock', '.binding.pending', 'receiver.json', 'content.part'}


def strict_json(raw):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError('duplicate JSON key')
            result[key] = value
        return result

    def constant(value):
        raise ValueError('non-finite JSON value')

    return json.loads(raw, object_pairs_hook=pairs, parse_constant=constant)


def integer(value, minimum, maximum, label):
    if isinstance(value, bool) or not isinstance(value, int) or not minimum <= value <= maximum:
        raise ValueError('invalid ' + label)
    return value


def sha256_text(value):
    return isinstance(value, str) and len(value) == 64 and all(c in '0123456789abcdef' for c in value)


def checked_manifest(meta):
    if not isinstance(meta, dict) or meta.get('schema') != 'commons.file-transfer.v1':
        raise ValueError('unsupported manifest schema')
    size = integer(meta.get('bytes'), 0, 10 ** 20 - 1, 'file size')
    chunk = integer(meta.get('raw_chunk_bytes'), 1, sys.maxsize // 2, 'raw chunk size')
    budget = integer(meta.get('max_request_bytes'), 512, sys.maxsize // 2, 'request budget')
    count = integer(meta.get('parts'), 1, 100000, 'part count')
    if chunk > budget or count != max(1, (size + chunk - 1) // chunk):
        raise ValueError('manifest part sizing mismatch')
    if not sha256_text(meta.get('sha256')) or meta.get('transfer_id') != 'sha256-' + meta['sha256']:
        raise ValueError('manifest digest or transfer ID mismatch')
    if meta.get('transport') != 'file_envelopes_only' or meta.get('uploaded') is not False:
        raise ValueError('expected the original file-envelope manifest')
    return meta


def read_regular(path, limit):
    fd = os.open(str(path), os.O_RDONLY | os.O_NOFOLLOW)
    try:
        if not stat.S_ISREG(os.fstat(fd).st_mode):
            raise ValueError('input must be a regular file')
        return read_fd(fd, limit)
    finally:
        os.close(fd)


def read_fd(fd, limit):
    size = os.fstat(fd).st_size
    if size > limit:
        raise ValueError('file exceeds its byte limit')
    raw = bytearray()
    while len(raw) < size:
        part = os.pread(fd, min(1024 * 1024, size - len(raw)), len(raw))
        if not part:
            raise ValueError('file changed while reading')
        raw.extend(part)
    if os.fstat(fd).st_size != size:
        raise ValueError('file changed while reading')
    return bytes(raw)


def fd_digest(fd):
    before = os.fstat(fd)
    digest, offset = hashlib.sha256(), 0
    while offset < before.st_size:
        part = os.pread(fd, min(1024 * 1024, before.st_size - offset), offset)
        if not part:
            raise ValueError('file changed while hashing')
        digest.update(part)
        offset += len(part)
    after = os.fstat(fd)
    if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (
            after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns):
        raise ValueError('file changed while hashing')
    return offset, digest.hexdigest()


def write_all(fd, raw):
    offset = 0
    try:
        while offset < len(raw):
            written = os.write(fd, memoryview(raw)[offset:])
            if written <= 0:
                raise OSError('write made no progress')
            offset += written
        os.fsync(fd)
    except BaseException:
        # An unacknowledged prefix may have reached disk. Keep every byte and
        # attempt to make it durable; the original error remains authoritative.
        try:
            os.fsync(fd)
        except OSError:
            pass
        raise


def same_inode(left, right):
    return (left.st_dev, left.st_ino) == (right.st_dev, right.st_ino)


def private_regular(fd, links=(1,)):
    value = os.fstat(fd)
    if not stat.S_ISREG(value.st_mode) or value.st_uid != os.geteuid() or value.st_mode & 0o077:
        raise ValueError('receiver files must be owned private regular files')
    if value.st_nlink not in links:
        raise ValueError('unexpected receiver file link count')
    return value


def named_file(parent, name, fd):
    value = os.stat(name, dir_fd=parent, follow_symlinks=False)
    if not stat.S_ISREG(value.st_mode) or not same_inode(value, os.fstat(fd)):
        raise ValueError('receiver file name changed')


def open_at(parent, name, flags, create=False):
    flags |= os.O_NOFOLLOW
    if create:
        flags |= os.O_CREAT
    try:
        return os.open(name, flags, 0o600, dir_fd=parent)
    except FileNotFoundError:
        if not create:
            return None
        raise


class Receiver:
    def __init__(self, directory, create=False):
        self.root = Path(os.path.abspath(os.fspath(directory)))
        self.create = create
        self.stack = contextlib.ExitStack()

    def __enter__(self):
        # fcntl is required only for the POSIX receiver. Existing planning,
        # splitting and joining remain usable without this module.
        import fcntl
        try:
            made = False
            if self.create:
                try:
                    self.root.mkdir(mode=0o700)
                    made = True
                except FileExistsError:
                    pass
            self.root_fd = os.open(str(self.root), os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            self.stack.callback(os.close, self.root_fd)
            value = os.fstat(self.root_fd)
            if value.st_uid != os.geteuid() or value.st_mode & 0o077:
                raise ValueError('receiver directory must be owned and private')
            if made:
                parent = os.open(str(self.root.parent), os.O_RDONLY | os.O_DIRECTORY)
                try:
                    os.fsync(parent)
                finally:
                    os.close(parent)
            lock = open_at(self.root_fd, '.lock', os.O_RDWR, create=True)
            self.stack.callback(os.close, lock)
            private_regular(lock)
            fcntl.flock(lock, fcntl.LOCK_EX)
            named_file(self.root_fd, '.lock', lock)
            self.check_root()
            return self
        except BaseException:
            self.stack.close()
            raise

    def __exit__(self, *args):
        self.stack.close()

    def check_root(self):
        value = os.stat(self.root, follow_symlinks=False)
        if not stat.S_ISDIR(value.st_mode) or not same_inode(value, os.fstat(self.root_fd)):
            raise ValueError('receiver directory changed')

    def bind(self, meta, output):
        meta = checked_manifest(meta)
        destination = Path(os.path.abspath(os.fspath(output)))
        if destination.parent == self.root and destination.name in RECEIVER_NAMES:
            raise ValueError('destination uses a receiver state filename')
        expected = {'schema': RECEIVER_SCHEMA, 'manifest': meta, 'destination': str(destination)}
        raw = encoded(expected)
        if len(raw) > 65536:
            raise ValueError('receiver binding exceeds 65536 bytes')
        existing = open_at(self.root_fd, 'receiver.json', os.O_RDONLY)
        if existing is not None:
            os.close(existing)
            self.load()
            if self.binding != expected:
                raise ValueError('existing receiver is bound to another manifest or destination')
            return
        fd = open_at(self.root_fd, '.binding.pending', os.O_RDWR, create=True)
        try:
            private_regular(fd)
            prior = read_fd(fd, len(raw))
            if not raw.startswith(prior):
                raise ValueError('pending receiver binding differs')
            os.lseek(fd, 0, os.SEEK_END)
            write_all(fd, raw[len(prior):])
            named_file(self.root_fd, '.binding.pending', fd)
            self.check_root()
            os.link('.binding.pending', 'receiver.json', src_dir_fd=self.root_fd,
                    dst_dir_fd=self.root_fd, follow_symlinks=False)
            os.fsync(self.root_fd)
            named_file(self.root_fd, 'receiver.json', fd)
            named_file(self.root_fd, '.binding.pending', fd)
            private_regular(fd, (2,))
            os.unlink('.binding.pending', dir_fd=self.root_fd)
            os.fsync(self.root_fd)
        finally:
            os.close(fd)
        self.load()

    def load(self):
        fd = open_at(self.root_fd, 'receiver.json', os.O_RDONLY)
        if fd is None:
            raise ValueError('receiver has no complete binding; resume receive with its original manifest')
        try:
            private_regular(fd, (1, 2))
            binding = strict_json(read_fd(fd, 65536))
            if not isinstance(binding, dict) or set(binding) != {'schema', 'manifest', 'destination'}:
                raise ValueError('invalid receiver binding')
            if binding['schema'] != RECEIVER_SCHEMA:
                raise ValueError('unsupported receiver binding')
            checked_manifest(binding['manifest'])
            destination = binding['destination']
            if not isinstance(destination, str) or not os.path.isabs(destination) or '\0' in destination:
                raise ValueError('invalid bound destination')
            self.destination = Path(destination)
            if str(self.destination) != os.path.abspath(destination):
                raise ValueError('bound destination is not normalized')
            if self.destination.parent == self.root and self.destination.name in RECEIVER_NAMES:
                raise ValueError('destination uses a receiver state filename')
            pending = open_at(self.root_fd, '.binding.pending', os.O_RDONLY)
            if pending is not None:
                try:
                    private_regular(pending, (2,))
                    if not same_inode(os.fstat(fd), os.fstat(pending)):
                        raise ValueError('pending binding does not name the published inode')
                    os.fsync(self.root_fd)
                    named_file(self.root_fd, '.binding.pending', pending)
                    named_file(self.root_fd, 'receiver.json', fd)
                    os.unlink('.binding.pending', dir_fd=self.root_fd)
                    os.fsync(self.root_fd)
                finally:
                    os.close(pending)
            private_regular(fd)
            named_file(self.root_fd, 'receiver.json', fd)
            self.binding, self.meta = binding, binding['manifest']
        finally:
            os.close(fd)

    @contextlib.contextmanager
    def content(self):
        self.check_root()
        with contextlib.ExitStack() as held:
            parent = os.open(str(self.destination.parent),
                             os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            held.callback(os.close, parent)
            directory = os.fstat(parent)
            if directory.st_uid != os.geteuid() or directory.st_mode & 0o022:
                raise ValueError('destination parent must be owned and not writable by others')
            if directory.st_dev != os.fstat(self.root_fd).st_dev:
                raise ValueError('receiver and destination must be on the same filesystem')

            def check_parent():
                self.check_root()
                value = os.stat(self.destination.parent, follow_symlinks=False)
                if not stat.S_ISDIR(value.st_mode) or not same_inode(value, os.fstat(parent)):
                    raise ValueError('destination parent changed')

            complete = open_at(parent, self.destination.name, os.O_RDONLY)
            if complete is not None:
                held.callback(os.close, complete)
                private_regular(complete, (1, 2))
            part = open_at(self.root_fd, 'content.part', os.O_RDWR | os.O_APPEND,
                           create=complete is None)
            if part is not None:
                held.callback(os.close, part)
            if complete is not None:
                size, sha = fd_digest(complete)
                if size != self.meta['bytes'] or sha != self.meta['sha256']:
                    raise ValueError('existing destination differs from the original file')
                if part is not None:
                    private_regular(part, (2,))
                    if not same_inode(os.fstat(part), os.fstat(complete)):
                        raise ValueError('destination is not the retained partial inode')
                    # Recover a process lost after publishing the final hard link.
                    os.fsync(complete)
                    os.fsync(parent)
                    check_parent()
                    named_file(parent, self.destination.name, complete)
                    named_file(self.root_fd, 'content.part', part)
                    os.unlink('content.part', dir_fd=self.root_fd)
                    os.fsync(self.root_fd)
                private_regular(complete)
                named_file(parent, self.destination.name, complete)
                check_parent()
                yield complete, True, parent, check_parent
            else:
                private_regular(part)
                named_file(self.root_fd, 'content.part', part)
                if os.fstat(part).st_size > self.meta['bytes']:
                    raise ValueError('retained prefix exceeds the original file')
                # Persist the new partial's directory entry before any ACK.
                os.fsync(self.root_fd)
                check_parent()
                yield part, False, parent, check_parent

    def summary(self, size, state):
        index = size // self.meta['raw_chunk_bytes']
        if size == self.meta['bytes']:
            index = None
        return {'state': state, 'directory': str(self.root), 'path': str(self.destination),
                'transfer_id': self.meta['transfer_id'], 'bytes': self.meta['bytes'],
                'sha256': self.meta['sha256'], 'received_bytes': size,
                'next_part_index': index,
                'next_part_offset': None if index is None else index * self.meta['raw_chunk_bytes']}

    def status(self):
        with self.content() as (fd, complete, parent, check_parent):
            os.fsync(fd)
            size, sha = fd_digest(fd)
            check_parent()
            named_file(parent if complete else self.root_fd,
                       self.destination.name if complete else 'content.part', fd)
            return dict(self.summary(size, 'restored' if complete else 'receiving'),
                        prefix_sha256=sha)

    def accept(self, packed):
        if len(packed) > self.meta['max_request_bytes']:
            raise ValueError('part exceeds the original request budget')
        item = strict_json(packed)
        fields = {'schema', 'transfer_id', 'index', 'count', 'offset', 'bytes', 'sha256', 'data_base64'}
        if not isinstance(item, dict) or set(item) != fields:
            raise ValueError('expected one original file-part envelope')
        index = integer(item['index'], 0, self.meta['parts'] - 1, 'part index')
        integer(item['count'], 1, 100000, 'part count')
        integer(item['offset'], 0, self.meta['bytes'], 'part offset')
        integer(item['bytes'], 0, self.meta['raw_chunk_bytes'], 'part byte count')
        offset = index * self.meta['raw_chunk_bytes']
        size = min(self.meta['raw_chunk_bytes'], self.meta['bytes'] - offset)
        if (item['schema'] != SCHEMA or item['transfer_id'] != self.meta['transfer_id']
                or item['count'] != self.meta['parts'] or item['offset'] != offset
                or item['bytes'] != size or not sha256_text(item['sha256'])):
            raise ValueError('part identity, numbering, offset or size mismatch')
        if not isinstance(item['data_base64'], str):
            raise ValueError('part base64 must be a string')
        raw = base64.b64decode(item['data_base64'], validate=True)
        if (base64.b64encode(raw).decode('ascii') != item['data_base64']
                or len(raw) != size or hashlib.sha256(raw).hexdigest() != item['sha256']):
            raise ValueError('part bytes or digest mismatch')
        with self.content() as (fd, complete, parent, check_parent):
            before = os.fstat(fd).st_size
            if offset > before:
                raise ValueError('part leaves a gap in the retained prefix')
            overlap = min(size, before - offset)
            if os.pread(fd, overlap, offset) != raw[:overlap]:
                raise ValueError('part differs from the retained prefix')
            replayed = overlap == size
            if not replayed:
                if complete:
                    raise ValueError('cannot append to a completed destination')
                named_file(self.root_fd, 'content.part', fd)
                write_all(fd, raw[overlap:])
            else:
                os.fsync(fd)
            expected_size = max(before, offset + size)
            if os.fstat(fd).st_size != expected_size:
                raise ValueError('retained prefix changed during append')
            private_regular(fd)
            check_parent()
            named_file(parent if complete else self.root_fd,
                       self.destination.name if complete else 'content.part', fd)
            return dict(self.summary(expected_size, 'restored' if complete else 'receiving'),
                        part_index=index, part_sha256=item['sha256'], replayed=replayed)

    def finish(self):
        with self.content() as (fd, complete, parent, check_parent):
            size, sha = fd_digest(fd)
            if size != self.meta['bytes'] or sha != self.meta['sha256']:
                raise ValueError('full file byte count or digest mismatch')
            os.fsync(fd)
            if not complete:
                check_parent()
                private_regular(fd)
                named_file(self.root_fd, 'content.part', fd)
                os.link('content.part', self.destination.name, src_dir_fd=self.root_fd,
                        dst_dir_fd=parent, follow_symlinks=False)
                os.fsync(parent)
                check_parent()
                named_file(parent, self.destination.name, fd)
                named_file(self.root_fd, 'content.part', fd)
                private_regular(fd, (2,))
                os.unlink('content.part', dir_fd=self.root_fd)
                os.fsync(self.root_fd)
                private_regular(fd)
                named_file(parent, self.destination.name, fd)
            return dict(self.summary(size, 'restored'), prefix_sha256=sha)


def receive(manifest, directory, output):
    meta = checked_manifest(strict_json(read_regular(manifest, 65536)))
    with Receiver(directory, create=True) as receiver:
        receiver.bind(meta, output)
        return receiver.status()


def receive_status(directory):
    with Receiver(directory) as receiver:
        receiver.load()
        return receiver.status()


def accept(directory, part):
    with Receiver(directory) as receiver:
        receiver.load()
        budget = receiver.meta['max_request_bytes']
        if part == '-':
            raw = sys.stdin.buffer.read(budget + 1)
        else:
            raw = read_regular(part, budget)
        return receiver.accept(raw)


def finish(directory):
    with Receiver(directory) as receiver:
        receiver.load()
        return receiver.finish()


def stdio_receive(manifest, directory, output):
    fd = sys.stdin.fileno()
    original = None
    try:
        if os.isatty(fd):
            import termios
            original = termios.tcgetattr(fd)
            current = list(original)
            current[6] = list(original[6])
            current[3] &= ~(termios.ICANON | termios.ECHO)
            current[6][termios.VMIN], current[6][termios.VTIME] = 1, 0
            termios.tcsetattr(fd, termios.TCSANOW, current)
        result = receive(manifest, directory, output)
        print(encoded(result).decode('ascii'), flush=True)
        with Receiver(directory) as receiver:
            receiver.load()
            budget = receiver.meta['max_request_bytes']
        while True:
            line = sys.stdin.buffer.readline(budget + 2)
            if not line:
                return 0
            raw = line[:-1] if line.endswith(b'\n') else line
            if len(raw) > budget:
                raise ValueError('input frame exceeds the original request budget')
            command = strict_json(raw)
            if command == {'command': 'status'}:
                result = receive_status(directory)
            elif command == {'command': 'finish'}:
                result = finish(directory)
            else:
                with Receiver(directory) as receiver:
                    receiver.load()
                    result = receiver.accept(raw)
            print(encoded(result).decode('ascii'), flush=True)
    finally:
        if original is not None:
            termios.tcsetattr(fd, termios.TCSANOW, original)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    for name in ('plan', 'split'):
        p = sub.add_parser(name)
        p.add_argument('source')
        p.add_argument('--max-request-bytes', type=int, required=True)
        p.add_argument('--raw-chunk-limit', type=int)
        if name == 'split':
            p.add_argument('--output', required=True)
    p = sub.add_parser('join')
    p.add_argument('directory')
    p.add_argument('--output', required=True)
    p = sub.add_parser('receive', help='create or reopen one durable local receiver')
    p.add_argument('manifest')
    p.add_argument('--directory', required=True)
    p.add_argument('--output', required=True)
    p.add_argument('--stdio', action='store_true', help='accept bounded JSON lines and fsync before each reply')
    p = sub.add_parser('accept', help='accept one original file-part envelope')
    p.add_argument('directory')
    p.add_argument('part', help='part JSON file, or - for stdin')
    for name in ('status', 'finish'):
        p = sub.add_parser(name)
        p.add_argument('directory')
    args = parser.parse_args()
    try:
        if args.command == 'receive':
            if args.stdio:
                return stdio_receive(args.manifest, args.directory, args.output)
            result = receive(args.manifest, args.directory, args.output)
        elif args.command == 'accept':
            result = accept(args.directory, args.part)
        elif args.command == 'status':
            result = receive_status(args.directory)
        elif args.command == 'finish':
            result = finish(args.directory)
        elif args.command == 'join':
            result = join(args.directory, args.output)
        elif args.command == 'split':
            result = split(args.source, args.max_request_bytes, args.output, args.raw_chunk_limit)
        else:
            result = plan(args.source, args.max_request_bytes, args.raw_chunk_limit)
        print(json.dumps(result, indent=2))
        return 0
    except KeyboardInterrupt:
        return 130
    except (ValueError, OSError, KeyError, TypeError, RecursionError) as exc:
        print('transfer-parts: ' + str(exc), file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
