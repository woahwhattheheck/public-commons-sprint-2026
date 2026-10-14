#!/usr/bin/env python3
"""Receive missing collection Workspaces through the maintained native archive API."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import sys

SCHEMA = 'upstate.collection-study-payloads/v1'
PROJECT_SCHEMA = 'upstate.scientific-workbench/v1'


def _member(root, value, *, required=True):
    from model.portable_fs import native_path, relative_name
    relative_name(value, windows=True)
    relative = PurePosixPath(value)
    candidate = root.joinpath(*relative.parts)
    for part in (candidate, *candidate.parents):
        if part == root:
            break
        try:
            info = native_path(part).lstat()
        except FileNotFoundError:
            continue
        if stat.S_ISLNK(info.st_mode) or getattr(info, 'st_file_attributes', 0) & 0x400:
            raise ValueError('Preserved a linked collection member: ' + value)
    if required and not native_path(candidate).exists():
        raise ValueError('The complete collection member is missing: ' + value)
    return candidate


def _studies(manifest):
    from model.portable_fs import validate_members
    rows = manifest.get('studies')
    if (manifest.get('schema') != 'upstate.portable-study-collection/v1'
            or not isinstance(rows, list) or not rows):
        raise ValueError('Choose the complete original Study collection.')
    result = {}
    for row in rows:
        if (not isinstance(row, dict) or not isinstance(row.get('workspace'), str)
                or not isinstance(row.get('project_id'), str) or not row['project_id']):
            raise ValueError('A Study row lacks its original Workspace identity.')
        name = row['workspace']
        if name in result or not name.startswith('workspaces/'):
            raise ValueError('Each Study needs its own original workspaces/ directory.')
        result[name] = row
    # IDs may repeat across separately retained editions; directory paths may not.
    validate_members(result, portable=True)
    names = list(result)
    if any(a != b and b.startswith(a + '/') for a in names for b in names):
        raise ValueError('Original Workspace directories may not contain one another.')
    return result


def _existing(path, row):
    from model.common import read_json
    from model.portable_fs import native_path
    physical = native_path(path)
    if not physical.exists():
        return False
    if not physical.is_dir():
        raise ValueError('Preserved an occupied Workspace destination: ' + str(path))
    manifest = physical / 'workspace.json'
    info = manifest.lstat()
    if (not stat.S_ISREG(info.st_mode)
            or getattr(info, 'st_file_attributes', 0) & 0x400):
        raise ValueError('The existing Workspace identity is not an original regular file.')
    project = read_json(manifest)
    if project.get('schema') != PROJECT_SCHEMA or project.get('id') != row['project_id']:
        raise ValueError('Preserved another project at ' + row['workspace'])
    return True


def _payload_rows(root, studies, application):
    from model.common import read_json
    from model.portable_fs import native_path, validate_members
    path = _member(root, 'STUDY_PAYLOADS.json', required=False)
    if not native_path(path).exists():
        return {}
    payload = read_json(path)
    if payload.get('schema') != SCHEMA or not isinstance(payload.get('studies'), list):
        raise ValueError('Receive the complete original Study payload manifest.')
    rows = {}
    paths = set()
    for row in payload['studies']:
        if not isinstance(row, dict):
            raise ValueError('A Study payload row is incomplete.')
        name, project_id, archive = row.get('workspace'), row.get('project_id'), row.get('archive')
        if name not in studies or name in rows or project_id != studies[name]['project_id']:
            raise ValueError('A Study payload differs from its original collection row.')
        if (not isinstance(archive, dict)
                or not isinstance(archive.get('path'), str)
                or type(archive.get('bytes')) is not int or archive['bytes'] <= 0
                or not isinstance(archive.get('sha256'), str)
                or not re.fullmatch(r'[0-9a-f]{64}', archive['sha256'])):
            raise ValueError('A Study payload lacks its complete original archive descriptor.')
        relative = archive['path']
        _member(root, relative, required=False)
        if (relative in ('STUDIES.json', 'STUDY_PAYLOADS.json')
                or relative == application
                or relative.startswith('workspaces/')
                or relative.startswith(application + '/')):
            raise ValueError('Keep payload archives outside application and Workspace trees.')
        paths.add(relative)
        rows[name] = row
    validate_members(paths, portable=True)
    return rows


def receive_studies(root, manifest):
    """Restore absent trees once; existing mutable Workspaces remain unchanged."""
    from model import portable
    from model.common import read_json
    from model.portable_fs import locked, native_path, publish_directory, sync_directory
    root = Path(root).resolve(strict=True)
    studies = _studies(manifest)
    payloads = _payload_rows(root, studies, manifest['application'])
    destinations = {name: _member(root, name, required=False) for name in studies}
    missing = [name for name, path in destinations.items()
               if not _existing(path, studies[name])]
    if not missing:
        return {'received': [], 'reused': list(studies)}
    absent = [name for name in missing if name not in payloads]
    if absent:
        raise ValueError('Receive the original native archive descriptor for: ' + ', '.join(absent))
    # One collection lock protects first receiving even when callers choose
    # different private operator-state directories. No running project is replaced.
    lock = _member(root, 'workspaces/.collection-receiving.lock', required=False)
    received = []
    with locked(lock, blocking=False):
        stage_root = _member(root, 'workspaces/.collection-receiving', required=False)
        native_path(stage_root).mkdir(parents=True, exist_ok=True, mode=0o700)
        plans = []
        for name in missing:
            destination = _member(root, name, required=False)
            if _existing(destination, studies[name]):
                continue
            row = payloads[name]
            archive = _member(root, row['archive']['path'])
            info = native_path(archive).lstat()
            if not stat.S_ISREG(info.st_mode) or info.st_size != row['archive']['bytes']:
                raise ValueError('The original Study archive is incomplete: ' + row['archive']['path'])
            # Read the original archive manifest before publishing any new tree.
            # The maintained restore subsequently verifies every payload byte.
            original = portable.inspect_archive(native_path(archive), verify=False)
            if (original.get('project', {}).get('schema') != PROJECT_SCHEMA
                    or original['project'].get('id') != row['project_id']):
                raise ValueError('The native archive belongs to another Study: ' + name)
            plans.append((name, destination, archive, row))
        for name, destination, archive, row in plans:
            print('Receiving original Workspace: ' + name, flush=True)
            key = hashlib.sha256((name + '\n' + row['archive']['sha256']).encode('utf-8')).hexdigest()
            stage = _member(root, 'workspaces/.collection-receiving/' + key, required=False)
            if native_path(stage).exists():
                result = portable.resume_restore(archive, stage,
                    expected_archive_sha256=row['archive']['sha256'])
            else:
                result = portable.restore(archive, stage)
            if (result.get('identity') != 'MATCH'
                    or result.get('archive_sha256') != row['archive']['sha256']
                    or result.get('project', {}).get('id') != row['project_id']):
                raise ValueError('The restored Study differs from its original payload descriptor.')
            restored = native_path(stage) / 'workspace'
            project = read_json(restored / 'workspace.json')
            if project.get('schema') != PROJECT_SCHEMA or project.get('id') != row['project_id']:
                raise ValueError('The restored Workspace identity differs from its original Study.')
            # Recheck the destination under the same collection lock. Publication
            # uses the maintained no-replace operation on the same filesystem.
            _member(root, name, required=False)
            if native_path(destination).exists():
                raise ValueError('Preserved a Workspace created during receiving: ' + name)
            native_path(destination.parent).mkdir(parents=True, exist_ok=True)
            publish_directory(restored, destination)
            received.append(name)
            # All restored scientific records/artifacts travel inside workspace/.
            # The unchanged original archive remains in the collection. Remove
            # only this completed receive's duplicate application/delivery wrapper.
            shutil.rmtree(native_path(stage))
            sync_directory(stage_root)
    return {'received': received, 'reused': [name for name in studies if name not in received]}


def write_payload_manifest(root, manifest, selected):
    """Describe existing original native archives for the collection packager."""
    from model import portable
    from model.common import read_json
    from source_tools.workbench_session import _write
    from model.portable_fs import fd_stat, native_path, open_file
    studies = _studies(manifest)
    rows, seen = [], set()
    for workspace, archive_name in selected:
        if workspace not in studies or workspace in seen:
            raise ValueError('Choose each original STUDIES Workspace path once.')
        seen.add(workspace)
        archive = _member(root, archive_name)
        if (archive_name.startswith((manifest['application'] + '/', 'workspaces/'))
                or archive_name in (manifest['application'], 'STUDIES.json', 'STUDY_PAYLOADS.json')):
            raise ValueError('Keep native archives outside application and Workspace trees.')
        descriptor = open_file(archive, os.O_RDONLY)
        with os.fdopen(descriptor, 'rb') as stream:
            before = fd_stat(stream.fileno())
            if not stat.S_ISREG(before.st_mode):
                raise ValueError('Choose an original regular native archive.')
            identity = lambda info: (info.st_dev, info.st_ino, info.st_size,
                                     info.st_mtime_ns, info.st_ctime_ns)
            original = portable.inspect_archive(stream, verify=False)
            if original.get('project', {}).get('id') != studies[workspace]['project_id']:
                raise ValueError('The native archive belongs to another original Workspace.')
            stream.seek(0)
            digest, size = hashlib.sha256(), 0
            for block in iter(lambda: stream.read(1024 * 1024), b''):
                digest.update(block)
                size += len(block)
            if identity(before) != identity(fd_stat(stream.fileno())) or size != before.st_size:
                raise ValueError('The original native archive changed while describing it.')
        rows.append({'workspace': workspace, 'project_id': studies[workspace]['project_id'],
                     'archive': {'path': archive_name, 'bytes': size, 'sha256': digest.hexdigest()}})
    value = {'schema': SCHEMA, 'studies': rows}
    output = _member(root, 'STUDY_PAYLOADS.json', required=False)
    if native_path(output).exists():
        if read_json(output) != value:
            raise ValueError('Preserved a different existing Study payload manifest.')
    else:
        _write(output, value, exclusive=True)
    return value


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--collection', type=Path, default=Path(__file__).resolve().parent)
    parser.add_argument('--payload', nargs=2, action='append', metavar=('WORKSPACE', 'ARCHIVE'),
                        help='Write a new payload manifest from exact existing native archives')
    args = parser.parse_args()
    root = args.collection.expanduser().resolve(strict=True)
    manifest = json.loads((root / 'STUDIES.json').read_text(encoding='utf-8'))
    application = root.joinpath(*PurePosixPath(manifest['application']).parts).resolve(strict=True)
    if not application.is_relative_to(root):
        raise ValueError('The selected application leaves the original collection.')
    sys.path.insert(0, str(application))
    if args.payload is not None:
        result = write_payload_manifest(root, manifest, args.payload)
    else:
        result = receive_studies(root, manifest)
    print(json.dumps(result, ensure_ascii=False), flush=True)
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (OSError, ValueError, RuntimeError, KeyError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
