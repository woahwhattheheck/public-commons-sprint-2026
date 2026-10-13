"""Editable GIS inside the original Operator task, upload and download lifecycle."""
from __future__ import annotations
import hashlib
import json
from pathlib import Path
import re
import urllib.parse
import zipfile
from model import gis_project as gis
from model import gis_workspace

ACTIONS = frozenset({'gis.project.export', 'gis.project.receive', 'gis.project.adopt-sources', 'gis.project.review'})
# Received HTML has an opaque sandbox origin: it cannot read the operator session.
VIEW_POLICY = ("sandbox allow-scripts allow-downloads; default-src 'none'; "
               "script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; "
               "connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; "
               "frame-ancestors 'self'")


# Only a byte-exact rendering by the installed review producer may share the
# operator origin. Retained/imported HTML keeps VIEW_POLICY, even in a review.
GENERATED_REVIEW_POLICY = VIEW_POLICY.replace(
    "sandbox allow-scripts allow-downloads;",
    "sandbox allow-scripts allow-downloads allow-same-origin;", 1)


def _review_template_matches(retained, rendered, template):
    """Match installed code exactly while tolerating retained JSON object order."""
    marker = "__GIS_REVIEW_PAYLOAD__"
    if template.count(marker) != 1:
        return False
    prefix, suffix = template.split(marker)
    values = []
    for document in (retained, rendered):
        if (not document.startswith(prefix) or not document.endswith(suffix)
                or len(document) < len(prefix) + len(suffix)):
            return False
        text = document[len(prefix):len(document)-len(suffix)] if suffix else document[len(prefix):]
        value = json.loads(text)
        # Round-trip the original renderer's safe encoding. This also rejects
        # duplicate keys, nonfinite values and literal script-closing markup.
        encoded = json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
        for character, escaped in (("<", "\\u003c"), (">", "\\u003e"), ("&", "\\u0026"),
                                   ("\u2028", "\\u2028"), ("\u2029", "\\u2029")):
            encoded = encoded.replace(character, escaped)
        if encoded != text:
            return False
        values.append(gis.canonical(value))
    return values[0] == values[1]


def generated_review_policy(folder, record, member, expected):
    """Keep cookie-backed member downloads usable for the trusted review template."""
    if member != 'REVIEW.html' or expected.get('path') != 'REVIEW.html':
        return VIEW_POLICY
    from model import gis_edition_review
    if record.get('selection', {}).get('version') != gis_edition_review.VERSION:
        return VIEW_POLICY
    descriptor = record.get('files', {}).get('review.json')
    if not isinstance(descriptor, dict) or descriptor.get('path') != 'review.json':
        return VIEW_POLICY
    try:
        report_path = gis.checked(folder, descriptor)
        report = gis.load(report_path)
        if (report.get('schema') != gis_edition_review.SCHEMA
                or report.get('state') != 'complete'
                or report.get('id') != record['id']
                or report.get('selection') != record['selection']
                or report.get('layers') != record['layers']):
            return VIEW_POLICY
        # Integrity alone does not establish script provenance. Reconstruct
        # current trusted code and verified data, then bind the original bytes.
        from model import gis_review_raster
        retained = gis.checked(folder, expected).read_bytes()
        if (len(retained) != expected['bytes']
                or hashlib.sha256(retained).hexdigest() != expected['sha256']):
            return VIEW_POLICY
        rendered = gis_edition_review._report_html(report, folder)
        template = Path(gis_review_raster.__file__).with_name(
            gis_review_raster.TEMPLATE).read_text(encoding='utf-8')
        if _review_template_matches(retained.decode('utf-8'), rendered, template):
            return GENERATED_REVIEW_POLICY
    except (OSError, ValueError, TypeError, KeyError):
        # Prior producer editions and unavailable rendering companions retain
        # their original opaque document view and downloadable report archive.
        pass
    return VIEW_POLICY


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
        if kind == 'review':
            from model import gis_edition_review
            gis.member(name)
            review_id, separator, member = name.partition('/')
            if not separator:
                raise ValueError('Choose an original GIS review member')
            ws = self.operator.ws(workspace)
            folder, record = gis_edition_review.read(ws, identity(key), identity(review_id), verify_files=False)
            expected = record['files'].get(member)
            if expected is None:
                raise ValueError('Choose a declared original GIS review file')
            path = gis.checked(folder, expected)
            policy = generated_review_policy(folder, record, member, expected)
            return self.operator._ticket(workspace, path, expected, member), policy
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

    def describe_review(self, workspace, receipt_id, review_id):
        from model import gis_edition_review
        folder, record = gis_edition_review.read(self.operator.ws(workspace), receipt_id, review_id, verify_files=False)
        prefix = '/api/file/gis-project/' + '/'.join(urllib.parse.quote(str(part), safe='')
                   for part in (workspace, 'review', receipt_id, review_id)) + '/'
        downloads = [{**item, 'label': label, 'url': prefix + name} for name, label in
                     [('REVIEW.html', 'Open received-edition review'), ('review.zip', 'Complete change report ZIP'),
                      ('review.json', 'Complete review JSON'), ('layers.csv', 'Layer change summary')]
                     if (item := record['files'].get(name)) is not None]
        layers = []
        for row in record['layers']:
            detail = row['comparison']
            headers = detail.get('headers', {})
            old, new = headers.get('exported', {}), headers.get('received', {})
            layers.append({key: row.get(key) for key in
                           ('layer_id', 'title', 'kind', 'units', 'working_files_changed')} |
                          {'counts': detail.get('counts', {}), 'scope': detail.get('scope', detail.get('method')),
                           'comparison': detail.get('comparison'), 'difference': detail.get('difference'),
                           'reason': detail.get('reason') or detail.get('physical_comparison'),
                           'metadata_changed': row.get('metadata_changed', [])})
        return {'id': record['id'], 'state': record['state'], 'title': record['title'],
                'created_at': record.get('created_at'),
                'selection': record['selection'], 'layers': layers, 'downloads': downloads}

    def catalogue(self, workspace, native_study_collection=None, native_study_source=None,
                  scientific_report_id=None, execution_history_id=None):
        ws = self.operator.ws(workspace)
        if native_study_collection:
            from model import gis_native_study
            return {'workspace_key': workspace, 'native_study': gis_native_study.preview(ws, {
                'source_collection_id': native_study_collection,
                'source_id': native_study_source or 'saved-native-ensemble-study',
                'scientific_report_id': scientific_report_id,
                'execution_history_id': execution_history_id})}
        from model import gis_edition_review
        result = gis_workspace.catalogue(ws)
        from model import gis_native_study
        result['native_studies'] = gis_native_study.choices(ws)
        result['exports'] = [self.describe(workspace, 'export', r['id']) for r in result['exports']]
        result['received'] = [self.describe(workspace, 'received', gis.load(p)['id'])
                              for p in sorted((ws.root / 'gis-received').glob('*/receipt.json'))]
        result['adoptions'] = [gis.load(p) for p in sorted((ws.root / 'gis-source-adoptions').glob('*/adoption.json'))]
        for record in result['received']:
            project = gis.load(ws.root / 'gis-received' / record['id'] / 'project' / 'project.json')
            record.update(gis_workspace.adoption_choices(project))
            record['review_exports'] = [{'id': row['id'], 'title': row['title'],
                'edition_id': row['result']['edition_id'], 'fingerprint': row['result']['fingerprint']}
                for row in result['exports'] if row['result']['selection_id'] == project['selection_id']]
            record['reviews'] = [self.describe_review(workspace, record['id'], path.parent.name)
                for path in sorted((ws.root/'gis-received'/record['id']/'reviews').glob('*/review-state.json'))
                if gis.load(path).get('state') == 'complete']
        result['grids'] = [{k: row.get(k) for k in ('id', 'state', 'spec', 'grid')}
                           for row in (gis.load(p) for p in sorted((ws.root / 'grids').glob('*/grid.json')))]
        result['comparisons'] = [{k: row.get(k) for k in ('id', 'baseline_run_id', 'direction')}
                                 for row in (gis.load(p) for p in sorted((ws.root / 'comparisons').glob('*/comparison.json')))]
        # Human titles come from retained scenario records, not inferred run hashes.
        for row in result['runs']:
            scenario = ws._get('scenarios', row['selection']['scenario_id'])
            row['title'] = scenario['title']
        return {**result, 'workspace_key': workspace, 'review_version': gis_edition_review.VERSION}

    def invoke(self, task):
        ws = self.operator.ws(task['workspace'])
        if task['action'] == 'gis.project.review':
            from model import gis_edition_review
            return gis_edition_review.review(ws, task['payload'])
        if task['action'] == 'gis.project.export':
            return gis_workspace.export(ws, task['payload'])
        if task['action'] == 'gis.project.adopt-sources':
            return gis_workspace.adopt_sources(ws, task['payload'])
        if task['action'] != 'gis.project.receive':
            raise ValueError('Unsupported GIS operation')
        upload = self.operator.upload(task['payload']['upload_id'])
        return gis_workspace.receive(ws, upload['path'], source_upload_id=upload['id'])

    def decorate_task(self, task):
        if task['action'] == 'gis.project.review' and task['state'] == 'complete':
            result = self.describe_review(task['workspace'], task['result']['selection']['receipt_id'], task['result']['id'])
            return {**task, 'result': result, '_downloads': result['downloads']}
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
        return adapter.catalogue(workspace_key, payload.get('native_study_collection'),
                                 payload.get('native_study_source'), payload.get('scientific_report_id'),
                                 payload.get('execution_history_id'))
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
    from model import gis_edition_review
    reviews = []
    for path in sorted(workspace.root.glob('gis-received/*/reviews/*/review-state.json')):
        state = gis.load(path)
        if state.get('state') == 'complete':
            _, value = gis_edition_review.read(workspace, path.parents[2].name, path.parent.name)
            reviews.append(value['id'])
    return {'schema': 'upstate.gis-workspace-readback/v1', 'projects': rows, 'reviews': reviews}


def member(operator, workspace_key, kind, project_id, member_path):
    """Bind the existing inventory-checked member to the shared file transport."""
    return GISProjects(operator).member(workspace_key, kind, project_id, member_path)
