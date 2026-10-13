"""Retain declared native output files, including raster/shapefile sidecar trees."""
from __future__ import annotations
import copy
from pathlib import Path
from .store import RunStore


def retain_artifacts(store: RunStore, result: dict, pointers=(), base: Path | None = None) -> list[dict]:
    from .provider import _pointer
    artifacts = []
    for pointer in pointers:
        parent, key = _pointer(result, pointer)
        value = parent[key]
        path = Path(value).expanduser()
        if not path.is_absolute(): path = (base or Path.cwd()) / path
        path = path.resolve(strict=True)
        paths = [path] if path.is_file() else sorted(path.rglob('*'))
        files = []
        for src in paths:
            if src.is_symlink(): raise ValueError(f'Output symlink must be resolved explicitly: {src}')
            if not src.is_file(): continue
            sha, size = store.put_file(src)
            files.append({'relative': src.name if path.is_file() else src.relative_to(path).as_posix(),
                          'sha256': sha, 'bytes': size})
        artifacts.append({'pointer': pointer, 'original_path': str(value), 'name': path.name,
                          'directory': path.is_dir(), 'path_type': isinstance(value, Path), 'files': files})
    return artifacts


def restore_artifacts(store: RunStore, result: dict, job_id: str) -> dict:
    from .provider import _pointer, safe_relative
    result = copy.deepcopy(result)
    for i, item in enumerate(result.get('_ecsa_execution', {}).get('result_artifacts', [])):
        root = store.root / 'outputs' / job_id / str(i)
        # Paths are reconstructed from verified content addresses, never sender paths.
        for f in item['files']:
            path = root / safe_relative(f['relative'])
            path.parent.mkdir(parents=True, exist_ok=True)
            if path.exists():
                import hashlib
                h = hashlib.sha256()
                with path.open('rb') as stream:
                    for chunk in iter(lambda: stream.read(1024*1024), b''): h.update(chunk)
                if h.hexdigest() == f['sha256']: continue
            store.copy_blob(f['sha256'], path)
        root.mkdir(parents=True, exist_ok=True)
        value = root if item['directory'] else root / safe_relative(item['files'][0]['relative'])
        parent, key = _pointer(result, item['pointer'])
        parent[key] = value if item['path_type'] else str(value)
    return result
