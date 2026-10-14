#!/usr/bin/env python3
"""Open your receiving Workspace with optional original reference Studies."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import runpy
import sys


def receiving_workspace(root, manifest, member, selected):
    """Bind one recipient-owned Workspace separately from original references."""
    from model.common import atomic_json
    from model.workspace import Workspace

    receiving = manifest.get('receiving_workspace')
    if receiving is None:
        relative = 'workspaces/my-data'
        workspace = member(relative, required=False)
    else:
        if (not isinstance(receiving, dict)
                or receiving.get('purpose') != 'own-data'
                or not isinstance(receiving.get('project_id'), str)):
            raise ValueError('The receiving Workspace selection is incomplete.')
        relative = receiving.get('workspace')
        workspace = member(relative)
    parts = PurePosixPath(relative).parts
    if len(parts) < 2 or parts[0] != 'workspaces':
        raise ValueError('Keep the receiving Workspace inside workspaces/.')
    for _, original in selected:
        if (workspace == original or workspace.is_relative_to(original)
                or original.is_relative_to(workspace)):
            raise ValueError('Keep your data separate from the original reference projects.')
    application = member(manifest['application'])
    if (workspace == application or workspace.is_relative_to(application)
            or application.is_relative_to(workspace)):
        raise ValueError('Keep the receiving Workspace separate from application source.')
    if receiving is None:
        # An interrupted first opening may leave only the empty original
        # Workspace manifest and its maintained lock. Never adopt populated
        # data as a newly created recipient Workspace.
        if workspace.exists():
            if not workspace.is_dir() or any(
                    item.name not in ('workspace.json', '.workspace.lock')
                    for item in workspace.iterdir()):
                raise ValueError('The new receiving path is occupied. Retain its explicit '
                                 'Workspace/project identity in STUDIES.json before opening.')
        original = Workspace(workspace, create=True, title='Tim — Own data')
        if original.project.get('title') != 'Tim — Own data':
            raise ValueError('The unbound receiving path belongs to another Workspace.')
        if original.project['id'] in {row['project_id'] for row, _ in selected}:
            raise ValueError('The receiving Workspace must have its own project identity.')
        receiving = {'workspace': relative, 'project_id': original.project['id'],
                     'title': original.project['title'], 'purpose': 'own-data'}
        manifest = {**manifest, 'receiving_workspace': receiving}
        atomic_json(root / 'STUDIES.json', manifest)
    else:
        original = Workspace(workspace)
        if original.project.get('id') != receiving['project_id']:
            raise ValueError('The receiving Workspace differs from its retained project identity.')
        if original.project['id'] in {row['project_id'] for row, _ in selected}:
            raise ValueError('The receiving Workspace is an original reference project.')
    return receiving, workspace


def main() -> int:
    root = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--operator-state', type=Path)
    parser.add_argument('--no-browser', action='store_true')
    parser.add_argument('--prepare-only', action='store_true')
    parser.add_argument('--port', type=int, default=0)
    runtime = parser.add_mutually_exclusive_group()
    runtime.add_argument('--native', dest='native', action='store_true')
    runtime.add_argument('--plain', dest='native', action='store_false')
    parser.set_defaults(native=True)
    parser.add_argument('--advertised-origin')
    parser.add_argument('--connector-config', type=Path)
    args = parser.parse_args()
    if not 0 <= args.port <= 65535:
        parser.error('Select a port from 0 through 65535.')
    manifest = json.loads((root / 'STUDIES.json').read_text(encoding='utf-8'))
    if manifest.get('schema') != 'upstate.portable-study-collection/v1':
        raise ValueError('Select the included original Study collection.')

    def member(value: str, *, required=True) -> Path:
        if not isinstance(value, str) or not value:
            raise ValueError('A Study path must name a collection member.')
        path = PurePosixPath(value)
        if path.is_absolute() or str(path) != value or any(p in ('.', '..') for p in path.parts):
            raise ValueError('A Study path leaves the portable collection.')
        selected = root.joinpath(*path.parts).resolve(strict=required)
        if not selected.is_relative_to(root):
            raise ValueError('A Study path leaves the portable collection.')
        return selected

    application = member(manifest['application'])
    studies = manifest['studies']
    if not studies:
        raise ValueError('The collection contains no original Studies.')
    selected = []
    for row in studies:
        workspace = member(row['workspace'])
        project = json.loads((workspace / 'workspace.json').read_text(encoding='utf-8'))
        if (project.get('schema') != 'upstate.scientific-workbench/v1'
                or project.get('id') != row['project_id']):
            raise ValueError('The included Workspace belongs to another Study.')
        selected.append((row, workspace))
    default_state = (Path.home() / 'Library/Application Support'
                     if sys.platform == 'darwin' else Path.home() / '.local/state')
    local = Path(os.environ.get('LOCALAPPDATA') or os.environ.get('XDG_STATE_HOME')
                 or default_state)
    key = hashlib.sha256(str(root).encode()).hexdigest()[:20]
    state = (args.operator_state or local / 'ecosystem-workbench' / ('collection-' + key)).expanduser().resolve()
    if state.is_relative_to(root):
        raise ValueError('Keep private operator state outside the portable collection.')
    state.mkdir(parents=True, exist_ok=True, mode=0o700)
    if os.name != 'nt':
        state.chmod(0o700)
    # Use the maintained launch lock and live-session validation before touching
    # the registry. An ordinary second opening must not initialize another
    # Operator against the state owned by the already-running original process.
    sys.path.insert(0, str(application))
    sys.path.insert(0, str(application / 'operator'))
    from source_tools import workbench_session as session
    with session._launch_lock(state):
        # Another normal first opening may have retained the receiving identity
        # before this process acquired the maintained launch lock.
        current_manifest = json.loads((root / 'STUDIES.json').read_text(encoding='utf-8'))
        if (current_manifest.get('schema') != manifest['schema']
                or current_manifest.get('application') != manifest['application']
                or current_manifest.get('studies') != manifest['studies']):
            raise ValueError('The original collection selection changed while opening.')
        receiving, primary_workspace = receiving_workspace(
            root, current_manifest, member, selected)
        launch_args = argparse.Namespace(
            profile=None, application=str(application), workspace=str(primary_workspace),
            python_path=sys.executable, operator_state=str(state), native=args.native,
            port=args.port, source_manifest=None, source_root=None,
            advertised_origin=args.advertised_origin)
        selection, selected_state, _ = session.resolve_selection(launch_args, application)
        if selected_state != state or selection['project_id'] != receiving['project_id']:
            raise ValueError('The maintained launcher selected different receiving state.')
        # Retain the existing private HTTPS selection. The maintained launcher
        # still owns its connector process, private pointer and shutdown.
        transport_source = application / 'source_tools/workbench_transport.py'
        if transport_source.is_file():
            transport = runpy.run_path(str(transport_source))
            transport['prepare'](selection, state, args.connector_config)
        elif (args.connector_config is not None or (state / 'eco-transport.json').exists()
                or (state / 'workbench-transport.json').exists()):
            raise ValueError('Receive the complete workbench HTTPS opening source for this private selection')
        record = session.existing_session(state / 'workbench-session.json', selection)
        if record is not None:
            current = session._request(record['operator_url'], '/api/whoami')
            rows = current.get('workspaces', [])
            primary_key = session._digest({'directory': str(primary_workspace)})
            if current.get('default_workspace') != primary_key:
                raise RuntimeError('The running workbench has another default Workspace.')
            for row, workspace in [(receiving, primary_workspace), *selected]:
                key = session._digest({'directory': str(workspace)})
                if not any(isinstance(item, dict) and item.get('id') == key
                           and item.get('project_id') == row['project_id']
                           and item.get('available') is True for item in rows):
                    raise RuntimeError(
                        'The running original operator does not include Workspace '
                        + row['project_id'] + '. Close it from its owning terminal '
                        'after its active task, then reopen this collection.')
            print('Reusing your receiving Workspace with ' + str(len(selected))
                  + ' optional original reference projects.', flush=True)
        else:
            # Primary registration uses the same recipient-owned Workspace as
            # final launch. The five originals retain their archive provenance.
            native = runpy.run_path(str(application / 'operator/server.py'))
            operator = native['Operator'](primary_workspace, state)
            try:
                operator.register(native['Workspace'](primary_workspace), received={
                    'receiving': 'complete-portable-study-collection',
                    'purpose': 'own-data'})
                for row, workspace in selected:
                    operator.register(native['Workspace'](workspace), received={
                        'archive_sha256': row['original_archive_sha256'],
                        'archive_bytes': row['original_archive_bytes'],
                        'receiving': 'complete-portable-study-collection',
                        'purpose': 'optional-reference'})
                print('Ready: Tim — Own data. Registered ' + str(len(selected))
                      + ' optional original reference projects.', flush=True)
            finally:
                operator.close()
    if args.prepare_only:
        return 0
    command = [sys.executable, '-B', str(application / 'source_tools/open_received_study.py'),
               '--workspace', str(primary_workspace), '--python', sys.executable,
               '--operator-state', str(state), '--port', str(args.port),
               '--native' if args.native else '--plain']
    if selection.get('advertised_origin') is not None:
        command.extend(['--advertised-origin', selection['advertised_origin']])
    if args.connector_config is not None:
        command.extend(['--connector-config', str(args.connector_config)])
    if args.no_browser:
        command.append('--no-browser')
    if os.name == 'nt':
        # Remain in the root caller's process until the maintained controller
        # closes; Windows execv does not preserve the waited process identity.
        return session.main(application, command[3:])
    os.execv(sys.executable, command)
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (OSError, ValueError, RuntimeError, KeyError) as error:
        print(type(error).__name__ + ': ' + str(error), file=sys.stderr)
        raise SystemExit(1)
