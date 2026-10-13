"""Retain the native domain original for independently editable measured projects.

The outer Workspace remains authoritative. A received project's pinned original
is a fallback only after its native database has admitted that exact archive.
No file outside the measurement workspace is changed during receiving.
"""
from __future__ import annotations
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import tempfile

FORMAT = 'upper-savannah-measured-domain-original/v1'


def _digest(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def _inside(root: Path, relative: str) -> Path:
    if not isinstance(relative, str) or not relative or '\\' in relative:
        raise ValueError('Native domain source must be a relative original path')
    result = (root / relative).resolve(strict=True)
    if not result.is_relative_to(root.resolve()) or not result.is_file():
        raise ValueError('Native domain original is outside its retained workspace')
    return result


def capture_native_domain(workspace_root: Path, directory: Path) -> dict | None:
    """Capture the explicit original bound by the native operator before export."""
    directory = Path(directory).resolve()
    registry = directory / 'native-domain.json'
    if not registry.is_file():
        return None
    binding = json.loads(registry.read_text('utf-8'))
    source = (Path(workspace_root).resolve() / binding['source_path']).resolve()
    if (not source.is_relative_to(Path(workspace_root).resolve()) or
            not source.is_file() or _digest(source) != binding['source_sha256']):
        # A independently received binding may already carry its exact original.
        if retained_native_reaches(directory, binding) is not None:
            return json.loads((directory / 'portable-native-domain.json').read_text('utf-8'))
        raise ValueError('The selected native domain original changed; select its retained edition before exporting')
    target = directory / 'native-source-editions' / (binding['source_sha256'] + '.json')
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        if _digest(target) != binding['source_sha256']:
            raise ValueError('The retained native domain original differs')
    else:
        fd, temporary = tempfile.mkstemp(prefix='.domain-original-', dir=target.parent)
        try:
            with os.fdopen(fd, 'wb') as out, source.open('rb') as inp:
                for block in iter(lambda: inp.read(1024 * 1024), b''):
                    out.write(block)
                out.flush(); os.fsync(out.fileno())
            if _digest(Path(temporary)) != binding['source_sha256']:
                raise ValueError('Native domain original changed during capture')
            try:
                os.link(temporary, target)
            except FileExistsError:
                if _digest(target) != binding['source_sha256']:
                    raise ValueError('Concurrent native domain original differs')
        finally:
            Path(temporary).unlink(missing_ok=True)
    metadata = {'format': FORMAT, 'binding_sha256': _digest(registry),
                'source_sha256': binding['source_sha256'],
                'original_source_path': binding['source_path'],
                'retained_source_path': target.relative_to(directory).as_posix()}
    fd, temporary = tempfile.mkstemp(prefix='.portable-domain-', dir=directory)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as stream:
            json.dump(metadata, stream, ensure_ascii=False); stream.write('\n')
            stream.flush(); os.fsync(stream.fileno())
        os.replace(temporary, directory / 'portable-native-domain.json')
    finally:
        Path(temporary).unlink(missing_ok=True)
    return metadata


def retained_native_reaches(directory: Path, binding: dict) -> list[dict] | None:
    """Resolve a received, source-pinned domain, never a guessed external source."""
    directory = Path(directory).resolve()
    registry = directory / 'native-domain.json'
    metadata_file = directory / 'portable-native-domain.json'
    database = directory / 'measurements.sqlite'
    if not all(p.is_file() for p in (registry, metadata_file, database)):
        return None
    metadata = json.loads(metadata_file.read_text('utf-8'))
    binding_sha = _digest(registry)
    if (metadata.get('format') != FORMAT or metadata.get('binding_sha256') != binding_sha or
            metadata.get('source_sha256') != binding.get('source_sha256')):
        return None
    source = _inside(directory, metadata['retained_source_path'])
    if _digest(source) != binding['source_sha256']:
        raise ValueError('Received native domain original checksum differs')
    connection = sqlite3.connect(database.as_uri() + '?mode=ro', uri=True)
    try:
        if not connection.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='large_receives'").fetchone():
            return None
        admitted = any(any(f['path'] == 'native-domain.json' and f['sha256'] == binding_sha
                           for f in json.loads(row[0])['files'])
                       for row in connection.execute('SELECT manifest FROM large_receives'))
    finally:
        connection.close()
    if not admitted:
        return None
    # Re-evaluate the original explicit selectors. The IDs remain original strings.
    value = json.loads(source.read_text('utf-8'))
    def at(item, field):
        for part in field.split('.') if field else []:
            item = item[part]
        return item
    selected = at(value, binding.get('items_path', ''))
    if not isinstance(selected, list):
        raise ValueError('Received domain selection is not a list')
    ids = [at(item, binding.get('id_path', '')) for item in selected]
    if (any(not isinstance(identity, str) or not identity for identity in ids) or
            len(set(ids)) != len(ids) or ids != [row['id'] for row in binding['reaches']]):
        raise ValueError('Received native domain identifiers differ from their original')
    return binding['reaches']


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('workspace', type=Path); parser.add_argument('measurements', type=Path)
    args = parser.parse_args()
    print(json.dumps(capture_native_domain(args.workspace, args.measurements)))
