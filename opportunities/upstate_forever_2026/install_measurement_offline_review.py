#!/usr/bin/env python3
"""Install the additive offline-review feature into an original Measurements app."""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import tempfile

FILES = (
    'measurement_workspace/engine/offline_review.mjs',
    'measurement_workspace/engine/offline_review_cli.mjs',
    'measurement_workspace/web/offline_review.html',
    'MEASUREMENT_OFFLINE_REVIEWS.md',
    'MEASUREMENT_OFFLINE_REVIEWS_SOURCE.json',
    'integration/component_fragments/measurement-offline-review.json',
)

def member(root: Path, name: str) -> Path:
    parts = PurePosixPath(name).parts
    if not parts or PurePosixPath(name).is_absolute() or any(p in ('.', '..') or ':' in p for p in parts):
        raise ValueError('Invalid member path')
    current = root
    for part in parts:
        current = current / part
        if current.is_symlink():
            raise ValueError('Symbolic links cannot be installed: ' + name)
    return current

def install(application: Path, source: Path) -> dict:
    application = application.resolve(strict=True)
    source = source.resolve(strict=True)
    for name in ('workspace.mjs', 'collections.mjs', 'normalise.mjs', 'parse.mjs'):
        if not member(application, 'measurement_workspace/engine/' + name).is_file():
            raise ValueError('The original Measurements collection engine is required: ' + name)
    bodies = {name: member(source, name).read_bytes() for name in FILES}
    # Preflight every leaf before creating any feature file. Native files are never copied.
    for name, body in bodies.items():
        target = member(application, name)
        if target.exists() and (not target.is_file() or target.read_bytes() != body):
            raise ValueError('A different installed feature edition was retained: ' + name)
    created, reused = [], []
    with tempfile.TemporaryDirectory(prefix='.offline-review-install-', dir=application) as staging:
        for index, (name, body) in enumerate(bodies.items()):
            target = member(application, name)
            if target.exists():
                reused.append(name)
                continue
            temporary = Path(staging) / str(index)
            with temporary.open('xb') as stream:
                stream.write(body)
                stream.flush()
                os.fsync(stream.fileno())
            target.parent.mkdir(parents=True, exist_ok=True)
            try:
                os.link(temporary, target)
                created.append(name)
            except FileExistsError:
                if target.is_symlink() or target.read_bytes() != body:
                    raise ValueError('Concurrent source change retained: ' + name)
                reused.append(name)
    return {'format': 'upper-savannah-offline-review-install/v1', 'application': str(application),
            'created': created, 'reused': reused,
            'files': [{'path': n, 'bytes': len(b), 'sha256': hashlib.sha256(b).hexdigest()}
                      for n, b in bodies.items()]}

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--application', type=Path, required=True)
    parser.add_argument('--source-root', type=Path, default=Path(__file__).resolve().parent)
    args = parser.parse_args()
    print(json.dumps(install(args.application, args.source_root), indent=2))
