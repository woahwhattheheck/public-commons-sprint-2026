"""Editable GIS inside the original Operator task, upload and download lifecycle."""
from __future__ import annotations
import re
import urllib.parse
import zipfile
from model import gis_project as gis
from model import gis_workspace

ACTIONS = frozenset({'gis.project.export', 'gis.project.receive', 'gis.project.adopt-sources'})
# Received HTML has an opaque sandbox origin: it cannot read the operator session.
VIEW_POLICY = ("sandbox allow-scripts allow-downloads; default-src 'none'; "
               "script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; "
               "connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; "
               "frame-ancestors 'self'")


def identity(value):
    if not isinstance(value, str) or not re.fullmatch(r'[0-9a-f]{64}', value):
        raise ValueError('Choose a retained GIS project identity')
    return value


class GISProjects:
    """Stateless adapter; mutations are queued by Operator.submit and its workspace gate."""
    def __init__(self, operator):
        self.operator = operator

    def _record(self, workspace, kind, key):
        ws = self.operator.ws(workspace)
        identity(key)
        if kind not in {'export', 'received'}:
            raise ValueError('Choose an exported or received GIS project')
        parent = ws.root / ('gis-exports' if kind == 'export' else 'gis-received') / key
        record = gis.load(parent / ('export.json' if kind == 'export' else 'receipt.json'))
        if record['id'] != key or record['project_id'] != ws.project['id']:
            raise ValueError('The GIS record belongs to another original project')
        if record['state'] != 'complete':
            raise ValueError('Complete this GIS operation before opening its files')
        return ws, parent, record

    def member(self, workspace, kind, key, name):
        ws, parent, record = self._record(workspace, kind, key)
        root = parent / 'project'
        gis.member(name)
        inv = gis.load(root / 'inventory.json')
        if gis.fingerprint(inv['files']) != inv['fingerprint']:
            raise ValueError('GIS inventory changed')
        # A local desktop edit must be sealed into a new edition and received explicitly.
        if inv['fingerprint'] != record['result']['fingerprint']:
            raise ValueError('This GIS working edition changed; receive its new sealed archive')
        expected = next((item for item in inv['files'] if item['path'] == name), None)
        if expected is None:
            if name != 'inventory.json':
                raise ValueError('This file is not a member of the retained GIS project')
            expected = gis.record(root, root / name)
        path = gis.checked(root, expected)
        ticket = self.operator._ticket(workspace, path, expected, name)
        # Apply the opaque-origin policy to ALL members, including supplied SVG/HTML.
        return ticket, VIEW_POLICY

    def describe(self, workspace, kind, key):
        ws, parent, record = self._record(workspace, kind, key)
        archive = gis.local(ws.root, record['archive']['path'])
        if archive.stat().st_size != record['archive']['bytes']:
            raise ValueError('The retained GIS ZIP changed')
        ticket = self.operator._ticket(workspace, archive, record['archive'],
                                       'Complete editable GIS project ZIP')
        prefix = '/api/file/gis-project/' + '/'.join(
            urllib.parse.quote(str(part), safe='') for part in (workspace, kind, key)) + '/'
        return {**record, 'kind': kind, 'viewer_url': prefix + 'OPEN_GIS.html',
                'qgis_url': prefix + 'project.qgz?download=1', 'archive_download': ticket,
                'layers': record['result']['layers'], 'bytes': record['result']['bytes']}

    def catalogue(self, workspace):
        ws = self.operator.ws(workspace)
        result = gis_workspace.catalogue(ws)
        result['exports'] = [self.describe(workspace, 'export', r['id']) for r in result['exports']]
        result['received'] = [self.describe(workspace, 'received', gis.load(p)['id'])
                              for p in sorted((ws.root / 'gis-received').glob('*/receipt.json'))]
        result['adoptions'] = [gis.load(p) for p in sorted((ws.root / 'gis-source-adoptions').glob('*/adoption.json'))]
        for record in result['received']:
            project = gis.load(ws.root / 'gis-received' / record['id'] / 'project' / 'project.json')
            record.update(gis_workspace.adoption_choices(project))
        result['grids'] = [{k: row.get(k) for k in ('id', 'state', 'spec', 'grid')}
                           for row in (gis.load(p) for p in sorted((ws.root / 'grids').glob('*/grid.json')))]
        result['comparisons'] = [{k: row.get(k) for k in ('id', 'baseline_run_id', 'direction')}
                                 for row in (gis.load(p) for p in sorted((ws.root / 'comparisons').glob('*/comparison.json')))]
        # Human titles come from retained scenario records, not inferred run hashes.
        for row in result['runs']:
            scenario = ws._get('scenarios', row['selection']['scenario_id'])
            row['title'] = scenario['title']
        return {**result, 'workspace_key': workspace}

    def invoke(self, task):
        ws = self.operator.ws(task['workspace'])
        if task['action'] == 'gis.project.export':
            return gis_workspace.export(ws, task['payload'])
        if task['action'] == 'gis.project.adopt-sources':
            return gis_workspace.adopt_sources(ws, task['payload'])
        if task['action'] != 'gis.project.receive':
            raise ValueError('Unsupported GIS operation')
        upload = self.operator.upload(task['payload']['upload_id'])
        return gis_workspace.receive(ws, upload['path'], source_upload_id=upload['id'])

    def decorate_task(self, task):
        if task['action'] == 'gis.project.adopt-sources' and task['state'] == 'complete':
            collection_id = task['result']['source_collection_id']
            record = self.operator.item(task['workspace'], 'sources', collection_id)
            return {**task, '_item': {'kind': 'sources', 'id': collection_id},
                    '_downloads': record['_downloads']}
        if task['action'] in {'gis.project.export', 'gis.project.receive'} and task['state'] == 'complete':
            kind = 'export' if task['action'] == 'gis.project.export' else 'received'
            result = self.describe(task['workspace'], kind, task['result']['id'])
            viewer, _ = self.member(task['workspace'], kind, task['result']['id'], 'OPEN_GIS.html')
            task = {**task, 'result': result,
                    '_downloads': [result['archive_download'],
                        {**viewer, 'url': result['viewer_url'],
                         'label': 'Open GIS layer view and operating guide'}]}
        return task


# Current upstate.operator-extension/v1 host callbacks. Both integration routes
# invoke this same feature implementation through the original queue.
def invoke(operator, workspace_key, action, payload):
    return GISProjects(operator).invoke({'workspace': workspace_key, 'action': action, 'payload': payload})


def read(operator, workspace_key, operation, payload):
    adapter = GISProjects(operator)
    if operation == 'catalogue':
        return adapter.catalogue(workspace_key)
    raise ValueError('Choose the GIS catalogue operation')


def overview(operator, workspace_key):
    ws = operator.ws(workspace_key)
    rows = []
    for kind, pattern in [('export', 'gis-exports/*/export.json'), ('received', 'gis-received/*/receipt.json')]:
        for path in sorted(ws.root.glob(pattern)):
            record = gis.load(path)
            rows.append({'id': record['id'], 'title': record['title'], 'kind': kind,
                         'state': record['state'], 'edition_id': record['result']['edition_id']})
    return rows


def decorate_task(operator, task):
    return GISProjects(operator).decorate_task(task)


def verify_workspace(workspace):
    rows = []
    for pattern in ('gis-exports/*/export.json', 'gis-received/*/receipt.json'):
        for path in sorted(workspace.root.glob(pattern)):
            record = gis.load(path)
            result = gis.verify(path.parent / 'project')
            if record['result']['fingerprint'] != result['fingerprint']:
                raise ValueError('GIS project differs from its recorded receiving/export edition')
            gis.checked(workspace.root, record['archive'])
            rows.append(result)
    for path in sorted((workspace.root / 'gis-source-adoptions').glob('*/adoption.json')):
        adoption = gis.load(path)
        workspace._get('sources', adoption['source_collection_id'])
        gis.checked(workspace.root, adoption['manifest'])
    return {'schema': 'upstate.gis-workspace-readback/v1', 'projects': rows}


def member(operator, workspace_key, kind, project_id, member_path):
    """Bind the existing inventory-checked member to the shared file transport."""
    return GISProjects(operator).member(workspace_key, kind, project_id, member_path)
