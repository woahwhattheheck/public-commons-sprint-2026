#!/usr/bin/env python3
"""Lossless ZIP64 envelope around the original complete Measurements edition."""
from __future__ import annotations
import argparse, hashlib, json, os, shutil, stat, tempfile, zipfile
from pathlib import Path
from large_archive import CHUNK, relative, digest
from file_platform import sync_directory

FORMAT = 'upper-savannah-measurements-handover-files/v1'
MANIFEST = 'HANDOVER_MANIFEST.json'

def sync(directory):
    return sync_directory(directory)

def mkdir(directory):
    directory = Path(directory).absolute()
    if directory.exists():
        if directory.is_symlink() or not directory.is_dir(): raise ValueError('Use an ordinary owned directory')
        sync(directory); sync(directory.parent); return
    mkdir(directory.parent)
    directory.mkdir(mode=0o700); sync(directory); sync(directory.parent)

def member(name):
    name = relative(name)
    if any(':' in part or any(ord(c) < 32 or ord(c) == 127 for c in part) for part in name.split('/')):
        raise ValueError('Unsupported member name')
    return name

def pack(source, output):
    source = source.resolve(strict=True); output = output.absolute()
    if output.is_relative_to(source) or output.exists(): raise ValueError('Use a new archive outside its complete source')
    rows = []
    for f in sorted(source.rglob('*')):
        if f.is_symlink(): raise ValueError('Symbolic links are not handover members')
        if f.is_file():
            name = member(f.relative_to(source).as_posix())
            if name == MANIFEST: raise ValueError('Reserved handover manifest')
            rows.append({'path': name, **digest(f)})
        elif not f.is_dir(): raise ValueError('Non-regular handover member')
    if not {'project.zip', 'edition.json', 'selection.json'} <= {x['path'] for x in rows}:
        raise ValueError('Complete original project, edition and selection are required')
    manifest = {'format': FORMAT, 'files': rows}
    mkdir(output.parent)
    fd, temporary = tempfile.mkstemp(prefix='.handover-', dir=output.parent); os.close(fd); temporary = Path(temporary)
    try:
        with zipfile.ZipFile(temporary, 'w', compression=zipfile.ZIP_STORED, allowZip64=True) as z:
            for row in rows:
                z.write(source / row['path'], row['path'])
                if digest(source / row['path']) != {k: row[k] for k in ('bytes', 'sha256')}:
                    raise ValueError('Original member changed during packaging')
            z.writestr(MANIFEST, json.dumps(manifest, ensure_ascii=False, separators=(',', ':')) + '\n')
        with temporary.open('r+b') as f: os.fsync(f.fileno())
        os.link(temporary, output); sync(output.parent)
    finally: temporary.unlink(missing_ok=True)
    return {'manifest': manifest, **digest(output)}

def unpack(archive, destination):
    destination = destination.absolute()
    if destination.exists(): raise FileExistsError(str(destination))
    mkdir(destination.parent)
    with tempfile.TemporaryDirectory(prefix='.handover-read-', dir=destination.parent) as name:
        temp = Path(name)
        with zipfile.ZipFile(archive) as z:
            infos = z.infolist(); names = [i.filename for i in infos]
            if len(names) != len(set(names)): raise ValueError('Duplicate ZIP member')
            for i in infos:
                member(i.filename)
                if i.is_dir() or i.flag_bits & 1 or stat.S_ISLNK(i.external_attr >> 16): raise ValueError('Unsupported ZIP entry')
                mode = i.external_attr >> 16
                if stat.S_IFMT(mode) not in (0, stat.S_IFREG): raise ValueError('Non-regular ZIP entry')
            if z.getinfo(MANIFEST).file_size > 32 * 1024 * 1024: raise ValueError('Handover manifest exceeds 32MiB')
            manifest = json.loads(z.read(MANIFEST))
            if manifest.get('format') != FORMAT or not isinstance(manifest.get('files'), list): raise ValueError('Unknown handover format')
            rows = manifest['files']; declared = [member(r['path']) for r in rows]
            if len(declared) != len(set(declared)) or set(declared) | {MANIFEST} != set(names) or MANIFEST in declared:
                raise ValueError('Whole handover inventory differs')
            if not {'project.zip', 'edition.json', 'selection.json'} <= set(declared): raise ValueError('Incomplete native handover')
            for r in rows:
                if type(r.get('bytes')) is not int or r['bytes'] < 0 or not isinstance(r.get('sha256'), str) or len(r['sha256']) != 64 or any(c not in '0123456789abcdef' for c in r['sha256']):
                    raise ValueError('Invalid whole member identity')
            if sum(r['bytes'] for r in rows) > shutil.disk_usage(temp).free: raise OSError('Insufficient space for complete handover')
            for row in rows:
                info = z.getinfo(row['path'])
                if info.file_size != row['bytes']: raise ValueError('Member size differs')
                target = temp / row['path']; mkdir(target.parent)
                h = hashlib.sha256(); count = 0
                with z.open(info) as inp, target.open('xb') as out:
                    for b in iter(lambda: inp.read(CHUNK), b''):
                        count += len(b)
                        if count > row['bytes']: raise ValueError('Expanded member exceeds declared bytes')
                        out.write(b); h.update(b)
                    out.flush(); os.fsync(out.fileno())
                sync(target.parent)
                if count != row['bytes'] or h.hexdigest() != row['sha256']: raise ValueError('Complete original member differs')
        os.rename(temp, destination); sync(destination); sync(destination.parent)
    return manifest

if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__); s = p.add_subparsers(dest='command', required=True)
    a = s.add_parser('pack'); a.add_argument('source', type=Path); a.add_argument('output', type=Path)
    a = s.add_parser('unpack'); a.add_argument('source', type=Path); a.add_argument('output', type=Path)
    a = p.parse_args()
    print(json.dumps(pack(a.source, a.output) if a.command == 'pack' else unpack(a.source, a.output), separators=(',', ':')))
