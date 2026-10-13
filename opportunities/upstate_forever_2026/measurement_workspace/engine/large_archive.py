#!/usr/bin/env python3
"""Stream a complete Measurements directory into/out of a verified ZIP64 archive.

Invoked by the installed Node measurement engine, not a second scientific writer.
All hashes are computed from complete files. Existing destinations are never replaced.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import stat
import tempfile
import zipfile

CHUNK = 1024 * 1024
FORMAT = 'upper-savannah-measurements-files/v1'

def relative(name: str) -> str:
    if not isinstance(name, str) or not name or '\\' in name or '\0' in name:
        raise ValueError('Invalid archive member')
    if PurePosixPath(name).is_absolute() or any(x in {'', '.', '..'} for x in name.split('/')):
        raise ValueError('Archive member escapes its destination')
    return name

def digest(file: Path) -> dict:
    h = hashlib.sha256()
    size = 0
    with file.open('rb') as stream:
        for b in iter(lambda: stream.read(CHUNK), b''):
            h.update(b); size += len(b)
    return {'bytes': size, 'sha256': h.hexdigest()}

def pack(source: Path, output: Path, revision: int) -> dict:
    source = source.resolve(strict=True)
    output = output.absolute()
    if output.is_relative_to(source):
        raise ValueError('Place the archive outside its snapshot directory')
    if output.exists():
        raise FileExistsError(str(output))
    rows = []
    for file in sorted(source.rglob('*')):
        if file.is_symlink():
            raise ValueError('A complete workspace cannot contain a symlink')
        if file.is_file():
            name = relative(file.relative_to(source).as_posix())
            if name == 'MEASUREMENTS_ARCHIVE.json':
                raise ValueError('Reserved manifest name in workspace')
            rows.append({'path': name, **digest(file)})
        elif not file.is_dir():
            raise ValueError('A workspace member is not a regular file')
    if not any(x['path'] == 'measurements.sqlite' for x in rows):
        raise ValueError('Native measurement database is absent')
    manifest = {'format': FORMAT, 'revision': revision, 'files': rows}
    output.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix='.measurements-', dir=output.parent)
    os.close(fd)
    temporary = Path(temporary)
    try:
        with zipfile.ZipFile(temporary, 'w', compression=zipfile.ZIP_DEFLATED,
                             compresslevel=6, allowZip64=True) as archive:
            for row in rows:
                archive.write(source / row['path'], row['path'])
                if digest(source / row['path']) != {k: row[k] for k in ('bytes', 'sha256')}:
                    raise ValueError('Snapshot member changed while archiving: ' + row['path'])
            archive.writestr('MEASUREMENTS_ARCHIVE.json', json.dumps(manifest, ensure_ascii=False,
                              sort_keys=True, separators=(',', ':')) + '\n')
        with temporary.open('rb') as stream:
            os.fsync(stream.fileno())
        os.link(temporary, output)
    finally:
        temporary.unlink(missing_ok=True)
    return {'manifest': manifest, **digest(output)}

def unpack(archive_path: Path, destination: Path) -> dict:
    """A complete verified directory appears only after every original member passes."""
    destination = destination.absolute()
    if destination.exists():
        raise FileExistsError(str(destination))
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='.receive-measurements-', dir=destination.parent) as temp:
        temp = Path(temp)
        with zipfile.ZipFile(archive_path) as archive:
            infos = archive.infolist()
            names = [x.filename for x in infos]
            if len(names) != len(set(names)):
                raise ValueError('Duplicate archive member names')
            for info in infos:
                relative(info.filename)
                if info.flag_bits & 1 or stat.S_ISLNK(info.external_attr >> 16) or info.is_dir():
                    raise ValueError('Unsupported archive member type')
            m = archive.getinfo('MEASUREMENTS_ARCHIVE.json')
            if m.file_size > 32 * 1024 * 1024:
                raise ValueError('Workspace manifest exceeds 32 MiB')
            manifest = json.loads(archive.read(m))
            if manifest.get('format') != FORMAT or not isinstance(manifest.get('files'), list):
                raise ValueError('Unknown Measurements archive format')
            if type(manifest.get('revision')) is not int or manifest['revision'] < 0:
                raise ValueError('Invalid native revision')
            declared = [relative(x['path']) for x in manifest['files']]
            if len(declared) != len(set(declared)) or set(declared) | {'MEASUREMENTS_ARCHIVE.json'} != set(names):
                raise ValueError('Complete archive member inventory differs')
            if 'MEASUREMENTS_ARCHIVE.json' in declared or 'measurements.sqlite' not in declared:
                raise ValueError('Invalid native archive inventory')
            need = sum(x['bytes'] for x in manifest['files'] if type(x.get('bytes')) is int and x['bytes'] >= 0)
            if need > shutil.disk_usage(temp).free:
                raise OSError('Not enough disk space for the complete editable receiving copy')
            for row in manifest['files']:
                if type(row.get('bytes')) is not int or row['bytes'] < 0 or not isinstance(row.get('sha256'), str) or len(row['sha256']) != 64:
                    raise ValueError('Invalid original member metadata')
                info = archive.getinfo(row['path'])
                if info.file_size != row['bytes']:
                    raise ValueError('Original member length differs')
                file = temp / row['path']
                file.parent.mkdir(parents=True, exist_ok=True)
                h, n = hashlib.sha256(), 0
                with archive.open(info) as inp, file.open('xb') as out:
                    for b in iter(lambda: inp.read(CHUNK), b''):
                        n += len(b)
                        if n > row['bytes']:
                            raise ValueError('Expanded member exceeds its declared size')
                        out.write(b); h.update(b)
                    out.flush(); os.fsync(out.fileno())
                if n != row['bytes'] or h.hexdigest() != row['sha256']:
                    raise ValueError('Original member checksum differs: ' + row['path'])
            (temp / 'MEASUREMENTS_ARCHIVE.json').write_text(json.dumps(manifest, indent=2) + '\n')
        # The engine checks source interpretation before admitting this retained copy.
        os.rename(temp, destination)
    return manifest

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='operation', required=True)
    p = sub.add_parser('pack'); p.add_argument('source', type=Path); p.add_argument('output', type=Path); p.add_argument('--revision', type=int, required=True)
    p = sub.add_parser('unpack'); p.add_argument('archive', type=Path); p.add_argument('destination', type=Path)
    a = parser.parse_args()
    result = pack(a.source, a.output, a.revision) if a.operation == 'pack' else unpack(a.archive, a.destination)
    print(json.dumps(result, separators=(',', ':')))
