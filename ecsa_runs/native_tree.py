"""Receive a retained native workspace dependency tree without changing identities."""
from __future__ import annotations
import hashlib
import os
from pathlib import Path
import shutil
import tempfile
from .provider import safe_relative
from .store import RunStore


def _directories(names, values):
    """Validate declared directories and every native file's parent path."""
    if not isinstance(values, (list, tuple)):
        raise ValueError('Native directories must be an explicit sequence')
    declared = []
    for name in values:
        relative = safe_relative(name).as_posix()
        if relative != name:
            raise ValueError('Native directories must be canonical')
        declared.append(name)
    if len(declared) != len(set(declared)):
        raise ValueError('Duplicate native directories')
    required = set(declared)
    for name in [*names, *declared]:
        path = safe_relative(name)
        if path.as_posix() != name:
            raise ValueError('Native workspace paths must be canonical')
        required.update(parent.as_posix() for parent in path.parents
                        if parent.as_posix() != '.')
    if required.intersection(names):
        raise ValueError('A native member is both a file and a directory')
    return sorted(declared), sorted(required)


def capture_tree(store: RunStore, files: dict[str, str | Path], *,
                 directories: tuple[str, ...] = (),
                 expected: dict[str, dict] | None = None) -> dict:
    declared, _ = _directories(list(files), directories)
    if expected is not None and not isinstance(expected, dict):
        raise TypeError('Expected native files must be a descriptor mapping')
    expected = expected or {}
    if set(expected).difference(files):
        raise ValueError('A declared original native file is absent from its capture')
    members = []
    for name, source in sorted(files.items()):
        relative = safe_relative(name).as_posix()
        if relative != name:
            raise ValueError('Native workspace paths must be canonical')
        path = Path(source)
        if path.is_symlink() or not path.is_file():
            raise ValueError(f'Native member must be an ordinary file: {name}')
        sha, size = store.put_file(path, expected=expected.get(name))
        members.append({'path': name, 'sha256': sha, 'bytes': size})
    result = {'schema': 'ecsa.native-workspace-tree/v1', 'files': members}
    if declared:
        result['directories'] = declared
    return result


def _hash(path: Path) -> str:
    h = hashlib.sha256()
    with path.open('rb') as src:
        for chunk in iter(lambda: src.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def restore_tree(store: RunStore, descriptor: dict, destination: str | Path,
                 *, repair_missing: bool = False) -> dict:
    """Create an independent native workspace, or repair only absent retained files.

    Existing different files are NEVER overwritten. All existing members are checked
    before the first repair; a conflict therefore cannot leave half a repaired tree.
    Byte-identical retained files are reused. A new receive is staged and renamed.
    """
    if descriptor.get('schema') != 'ecsa.native-workspace-tree/v1':
        raise ValueError('Unknown native tree schema')
    dest = Path(destination).absolute()
    if dest.is_symlink():
        raise ValueError('Native destination cannot be a symlink')
    names = [item['path'] for item in descriptor['files']]
    if len(names) != len(set(names)):
        raise ValueError('Duplicate native tree members')
    declared, required_directories = _directories(names, descriptor.get('directories', ()))
    directory_result = {'directories': len(declared)} if declared else {}
    for item in descriptor['files']:
        if safe_relative(item['path']).as_posix() != item['path']:
            raise ValueError('Noncanonical native member')
        if store.verify_blob(item['sha256']) != item['bytes']:
            raise ValueError('Native member size mismatch')
    if dest.exists() and not repair_missing:
        raise FileExistsError(dest)
    if not dest.exists():
        dest.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='.native-receive-', dir=dest.parent) as temp:
            stage = Path(temp) / 'workspace'
            stage.mkdir()
            for relative in declared:
                (stage / relative).mkdir(parents=True, exist_ok=True)
            for item in descriptor['files']:
                store.copy_blob(item['sha256'], stage / item['path'])
            # Reserve the destination create-only after all bytes are staged.
            # An existing directory, including an empty one, is a conflict.
            dest.mkdir(mode=0o700)
            try:
                os.rename(stage, dest)
            except BaseException:
                try: dest.rmdir()
                except OSError: pass
                raise
        return {'directory': str(dest), 'members': len(names), 'restored': len(names),
                **directory_result}
    if not dest.is_dir():
        raise NotADirectoryError(dest)
    missing = []
    root = dest.resolve()

    def target_path(relative):
        target = dest / relative
        for part in [target, *target.parents]:
            if part == dest.parent:
                break
            if part.is_symlink():
                raise ValueError('Native repair cannot follow symlinks')
        if not target.resolve().is_relative_to(root):
            raise ValueError('Native member escapes receiving root')
        return target

    for relative in required_directories:
        target = target_path(relative)
        if target.exists() and not target.is_dir():
            raise ValueError('Native directory is occupied by a file: ' + relative)
    for item in descriptor['files']:
        target = target_path(item['path'])
        if target.exists():
            if not target.is_file() or target.stat().st_size != item['bytes'] or _hash(target) != item['sha256']:
                raise ValueError(f'Existing native member differs: {item["path"]}')
        else:
            missing.append((target, item))
    for relative in declared:
        target_path(relative).mkdir(parents=True, exist_ok=True)
    # Stage each complete file; link gives create-only installation even when
    # another process creates a member after the preflight.
    for target, item in missing:
        target.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='.native-repair-', dir=target.parent) as temp:
            source = Path(temp) / 'member'
            store.copy_blob(item['sha256'], source)
            try:
                os.link(source, target)
            except FileExistsError:
                if target.is_symlink() or not target.is_file() or _hash(target) != item['sha256']:
                    raise ValueError(f'Native repair race at {item["path"]}')
    return {'directory': str(dest), 'members': len(names), 'restored': len(missing),
            **directory_result}
