"""Paired ensemble actions/readers for the maintained ECSA extension registry.

This module follows the published upstate.operator-extension/v1 function
contract. The original operator owns authorization, workspace selection,
serial actions, request identities, restore verification and file transport.
"""
from __future__ import annotations

import base64
import hashlib
import html
import json
from pathlib import Path
import re
import zipfile
from urllib.parse import unquote

from model.paired_ensemble import EnsembleWorkspace
from model.paired_ensemble.designs import catalog_run
from model.paired_ensemble.ensemble_store import digest, fingerprint, identifier, read as read_json, verify
from model.paired_ensemble.ensemble_portable import _manifest, receive_project

ACTIONS = frozenset({'paired_ensemble.build', 'paired_ensemble.resume',
                     'paired_ensemble.export', 'paired_ensemble.receive'})
_CATALOG = {}


def _service(operator, workspace_key):
    return EnsembleWorkspace(operator.ws(workspace_key))


def _files(operator, workspace_key, result):
    app = _service(operator, workspace_key)
    root = app.root / identifier(result['id'])
    records = list(result.get('artifacts', {}).values()) + result.get('reports', {}).get('files', [])
    records += [{'path': 'analysis.json', **fingerprint(root / 'analysis.json')}]
    by_name = {}
    for record in records:
        path = verify(root, record)
        ticket = operator._ticket(workspace_key, path, record, 'Paired ensemble: ' + record['path'])
        by_name[record['path']] = ticket
    return by_name


def _ticket_url(ticket):
    value = ticket.get('url') or ticket.get('href') or ('/api/file/' + identifier(ticket['id']))
    if not isinstance(value, str) or not value.startswith('/api/file/') or '\\' in value:
        raise ValueError('Original file transport returned an unexpected ticket URL')
    return value


def _preview_document(app, result, tickets):
    """Embed only verified PNGs; preserve original download transport for files.

    The original complete HTML stays untouched on disk and in portable exports.
    The browser hosts this derived document in a script-free sandboxed iframe.
    """
    root = app.root / identifier(result['id'])
    report = next(r for r in result['reports']['files'] if r['path'] == 'index.html')
    document = verify(root, report).read_text(encoding='utf-8')
    records = {r['path']: r for r in result['reports']['files']}
    def link(match):
        attribute, encoded = match.groups()
        value = html.unescape(encoded)
        if value.startswith('#'):
            return match.group(0)
        name = unquote(value)
        if attribute == 'src':
            record = records.get(name)
            if record is None or Path(name).suffix.lower() != '.png':
                raise ValueError('The retained report references an undeclared preview image')
            data = verify(root, record).read_bytes()
            if not data.startswith(b'\x89PNG\r\n\x1a\n'):
                raise ValueError('A retained preview is not a PNG image')
            return 'src="data:image/png;base64,' + base64.b64encode(data).decode('ascii') + '"'
        ticket = tickets.get(name)
        if ticket is None:
            raise ValueError('The retained report references an undeclared download: ' + name)
        return 'href="' + html.escape(_ticket_url(ticket), quote=True) + '"'
    return re.sub(r'\b(src|href)="([^"]*)"', link, document)


def invoke(operator, workspace_key, action, payload):
    if action not in ACTIONS:
        raise ValueError('Choose an original paired ensemble action')
    app = _service(operator, workspace_key)
    if action == 'paired_ensemble.build':
        return app.build(payload)
    if action == 'paired_ensemble.resume':
        return app.resume(payload)
    if action == 'paired_ensemble.export':
        key = identifier(payload['ensemble_id'])
        result = app.describe(key)
        if result['state'] != 'complete':
            raise ValueError('Complete this ensemble before exporting it')
        # An updated report rendition becomes a distinct export while repeated
        # delivery of the exact retained result reuses the same archive.
        revision = digest({'analysis': fingerprint(app.root / key / 'analysis.json'),
                           'reports': result['reports']})
        destination = operator.root / 'outputs' / ('paired-ensemble-' + revision + '.zip')
        if destination.exists():
            with zipfile.ZipFile(destination) as archive:
                manifest, _ = _manifest(archive, None)
            if manifest['ensemble_id'] != key:
                raise ValueError('Retained export identifies a different ensemble')
            for name, record in manifest['members'].items():
                verify(app.root / key, {**record, 'path': name})
            return {'ensemble_id': key, 'path': str(destination), **fingerprint(destination), 'reused': True}
        return app.portable(key, destination)
    uploaded = operator.upload(payload['upload_id'])
    with zipfile.ZipFile(uploaded['path']) as archive:
        manifest, _ = _manifest(archive, operator.extraction_limit)
    key = identifier(manifest['ensemble_id'])
    destination = app.root / key
    if destination.exists():
        result = app.describe(key)
        if result['state'] != 'complete':
            raise ValueError('The selected ensemble already has an incomplete local computation; resume it or receive into another original workspace')
        for name, record in manifest['members'].items():
            verify(destination, {**record, 'path': name})
        return {'id': key, 'state': 'complete', 'reused': True}
    received = receive_project(uploaded['path'], destination, max_bytes=operator.extraction_limit)
    return {'id': key, 'state': 'complete', 'received': received}


def overview(operator, workspace_key):
    """Read compact metadata once per actual edition change, not every poll."""
    app = _service(operator, workspace_key)
    root_key = str(app.root.resolve())
    cached = _CATALOG.setdefault(root_key, {})
    current = set()
    rows = []
    for path in sorted(app.root.glob('*/analysis.json')):
        current.add(path.parent.name)
        stat = path.stat()
        signature = (stat.st_ino, stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns)
        old = cached.get(path.parent.name)
        if old is None or old[0] != signature:
            value = read_json(path)
            if value.get('id') != path.parent.name or digest(value['selection']) != value['id']:
                raise ValueError('Retained ensemble catalogue identity changed')
            row = {'id': value['id'], 'title': value['selection']['title'], 'state': value['state'],
                   'members': value['selection']['selected_member_count'],
                   'pollutants': value['selection']['pollutants'], 'completed_at': value.get('completed_at')}
            cached[path.parent.name] = (signature, row)
        rows.append(dict(cached[path.parent.name][1]))
    for key in set(cached)-current:
        del cached[key]
    return rows


def read(operator, workspace_key, operation, payload):
    app = _service(operator, workspace_key)
    if operation == 'catalog':
        data = app.workspace.overview()
        return {'schema': 'upstate.paired-ensemble-catalog/v1', 'workspace_id': app.workspace.project['id'],
                'runs': [catalog_run(app.workspace.inspect_run(identifier(row['id'])))
                         for row in data.get('runs', [])], 'profiles': data.get('profiles', []),
                'scenarios': data.get('scenarios', []), 'grids': data.get('grids', []),
                'editions': overview(operator, workspace_key)}
    if operation == 'edition':
        result = app.describe(identifier(payload['id']))
        if result['state'] == 'complete':
            tickets = _files(operator, workspace_key, result)
            result['_downloads'] = list(tickets.values())
            result['document'] = _preview_document(app, result, tickets)
        return result
    if operation == 'preview':
        selection = payload['selection']
        return {**app.preview(selection), 'selection_id': digest(selection)}
    if operation == 'pause':
        return app.cancel(payload['selection'])
    if operation == 'progress':
        if payload.get('task_id'):
            task = operator.task(identifier(payload['task_id']))
            if task['workspace'] != workspace_key or task['action'] not in ('paired_ensemble.build', 'paired_ensemble.resume'):
                raise ValueError('Progress task differs from the selected ensemble workspace')
            key = digest(task['payload'])
        else:
            key = identifier(payload['selection_id'])
        path = app.root / 'controls' / (key + '.json')
        return read_json(path) if path.exists() else {'state': 'not_started'}
    raise ValueError('Choose an original paired ensemble reader')


def decorate_task(operator, task):
    if task['action'] not in ACTIONS or task['state'] != 'complete':
        return task
    workspace_key, result = task['workspace'], task['result']
    if task['action'] == 'paired_ensemble.export':
        task['_downloads'] = [operator._ticket(workspace_key, result['path'], result, 'Complete paired ensemble result project')]
    else:
        app = _service(operator, workspace_key)
        edition = app.describe(result['id'])
        if edition['state'] == 'complete':
            task['_downloads'] = list(_files(operator, workspace_key, edition).values())
            task['_paired_ensemble_id'] = edition['id']
    return task


def verify_workspace(workspace):
    app = EnsembleWorkspace(workspace)
    count = 0
    for path in sorted(app.root.glob('*/analysis.json')):
        edition = app.describe(identifier(path.parent.name))
        if edition['state'] == 'complete':
            if edition.get('reports', {}).get('ensemble_id') != edition['id']:
                raise ValueError('Retained report identifies a different ensemble')
            for artifact in list(edition['artifacts'].values()) + edition['reports']['files']:
                verify(path.parent, artifact)
        count += 1
    return {'paired_ensemble_products': count}
