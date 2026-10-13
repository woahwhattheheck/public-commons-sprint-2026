"""Report edition comparison on the maintained operator queue and file transport."""
from __future__ import annotations
from pathlib import Path
from urllib.parse import quote
from model import report_changes as engine
from model.common import held, identifier
from source_report_editions import ScientificReportEditions
from source_reports import document_policy

ACTIONS = frozenset({'report-changes.prepare', 'report-changes.export'})


class ReportChanges:
    def __init__(self, operator, fault):
        self.operator, self.Fault = operator, fault
        self.editions = ScientificReportEditions(operator, fault)
        # A verified inode signature permits subsequent page/file reads without
        # hashing all retained originals again. Any mutation invalidates its entry.
        self.cache = {}

    def _directory(self, ws, key):
        root = ws.root.resolve()
        result = root / engine.KIND / identifier(key)
        if result.is_symlink() or not result.resolve().is_relative_to(root):
            raise ValueError('Keep the saved report comparison in its Workspace')
        return result

    @staticmethod
    def _summary(record):
        return {name: record[name] for name in
                ('id', 'title', 'state', 'left', 'right', 'change_count', 'page_count')}

    def _pair(self, ws, payload):
        left = self.editions._inspect(ws, identifier(payload.get('left')))[1]
        right = self.editions._inspect(ws, identifier(payload.get('right')))[1]
        return left, right

    def catalog(self, workspace):
        ws = self.operator.ws(workspace)
        comparisons, issues = [], []
        for path in sorted((ws.root / engine.KIND).glob('*/comparison.json')):
            if path.parent.name.startswith('.'):
                continue
            try:
                record = engine.inspect(self._directory(ws, path.parent.name), cache=self.cache)
                comparisons.append(self._summary(record))
            except (OSError, ValueError) as exc:
                issues.append({'id': path.parent.name, 'message': str(exc)})
        return {'workspace_key': workspace, 'editions': self.editions.saved(workspace),
                'comparisons': comparisons, 'issues': issues}

    def preview(self, workspace, payload):
        ws = self.operator.ws(workspace)
        left, right = self._pair(ws, payload)
        result = engine.preview(left, right)
        key = engine.identity_for(left, right, payload.get('plan'))
        return {'workspace_key': workspace, **result, 'id': key,
                'plan': engine._plan(payload.get('plan'), engine._tables(engine.edition(left)),
                                     engine._tables(engine.edition(right))),
                'existing': (self._directory(ws, key) / 'comparison.json').is_file()}

    def prepare(self, workspace, payload):
        ws = self.operator.ws(workspace)
        key = identifier(payload.get('preview_id'))
        with held(ws.root / '.workspace.lock'):
            left, right = self._pair(ws, payload)
            record = engine.build(left, right, self._directory(ws, key),
                                  plan=payload.get('plan'), expected_id=key)
        return {'comparison_id': record['id'], 'state': 'complete',
                'title': record['title'], 'change_count': record['change_count']}

    @staticmethod
    def _url(workspace, key, name):
        return '/api/file/report-changes/' + '/'.join(quote(str(v), safe='') for v in
            (workspace, key)) + '/' + quote(name, safe='/')

    def detail(self, workspace, key):
        directory = self._directory(self.operator.ws(workspace), key)
        record = engine.inspect(directory, cache=self.cache)
        file_roles = [('index.html', 'Open complete comparison'), ('changes.csv', 'Complete CSV register'),
                      ('changes.sqlite', 'Indexed change database'), ('summary.json', 'Structured summary')]
        files = [{'label': label, **record['files'][name], 'url': self._url(workspace, key, name)}
                 for name, label in file_roles]
        originals = []
        for side in ('left', 'right'):
            source = engine.edition(directory / side, cache=self.cache)
            original = source['record']['files'].get('report_html')
            originals.append({'side': side, **record[side],
                              'viewer_url': self._url(workspace, key, side + '/' + original['path']) if original else None})
        return {'workspace_key': workspace, 'comparison': {k:v for k,v in record.items()
                if k not in ('identity', 'files')}, 'files': files, 'originals': originals,
                'viewer_url': self._url(workspace, key, 'index.html'),
                '_downloads': [self.operator._ticket(workspace, engine._verify(directory, row, self.cache),
                                                     row, row['label']) for row in files]}

    def member(self, workspace, key, name):
        directory = self._directory(self.operator.ws(workspace), key)
        _, selected = engine.members(directory, cache=self.cache)
        if name not in selected:
            raise self.Fault('REPORT_COMPARISON_MEMBER', 'Choose a file retained in this exact comparison.', 404)
        item = selected[name]
        path = engine._verify(directory, item, self.cache)
        policy = document_policy(path.read_bytes()) if path.suffix.lower() in ('.html','.htm') else None
        return self.operator._ticket(workspace, path, item, name), policy

    def export(self, workspace, key):
        ws = self.operator.ws(workspace)
        directory = self._directory(ws, key)
        target = ws.root / 'scientific-report-comparison-exports' / (identifier(key) + '.zip')
        with held(ws.root / '.workspace.lock'):
            item = engine.export(directory, target)
        return {'comparison_id': key, 'state': 'complete',
                'download': self.operator._ticket(workspace, target, item,
                                                  'Complete report comparison and both original editions')}

    def read(self, workspace, operation, payload):
        if operation == 'catalog':
            return self.catalog(workspace)
        if operation == 'preview':
            return self.preview(workspace, payload)
        if operation == 'detail':
            return self.detail(workspace, identifier(payload.get('id')))
        if operation == 'rows':
            result = engine.rows(self._directory(self.operator.ws(workspace), payload.get('id')),
                                 after=int(payload.get('after', 0)), limit=int(payload.get('limit', 100)),
                                 category=payload.get('category') or None, table_id=payload.get('table_id') or None,
                                 status=payload.get('status') or None, cache=self.cache)
            return {'workspace_key': workspace, **result}
        raise self.Fault('REPORT_COMPARISON_READ', 'Choose an original report comparison operation.', 404)

    def invoke(self, task):
        if task['action'] == 'report-changes.prepare':
            return self.prepare(task['workspace'], task['payload'])
        if task['action'] == 'report-changes.export':
            return self.export(task['workspace'], identifier(task['payload'].get('id')))
        raise self.Fault('REPORT_COMPARISON_ACTION', 'Choose a report comparison task.')

    def decorate_task(self, task):
        if task['state'] != 'complete' or task['action'] not in ACTIONS:
            return task
        result = task.get('result') or {}
        if task['action'] == 'report-changes.export':
            # Reissue a fresh verified ticket rather than preserving an expired URL.
            ws = self.operator.ws(task['workspace'])
            key = identifier(result.get('comparison_id'))
            target = ws.root / 'scientific-report-comparison-exports' / (key + '.zip')
            manifest = engine.inspect_archive(target)
            _, selected = engine.members(self._directory(ws, key), cache=self.cache)
            if manifest['comparison_id'] != key or manifest['members'] != selected:
                raise ValueError('The retained export contains a different report comparison')
            item = engine._descriptor(target.parent, target)
            downloads = [self.operator._ticket(task['workspace'], target, item,
                                              'Complete report comparison and both original editions')]
        else:
            downloads = self.detail(task['workspace'], result['comparison_id'])['_downloads']
        return {**task, '_downloads': downloads}

    def verify_workspace(self, workspace):
        rows = []
        for path in sorted((workspace.root / engine.KIND).glob('*/comparison.json')):
            if path.parent.name.startswith('.'):
                continue
            record = engine.inspect(self._directory(workspace, path.parent.name))
            if any(record[side]['project_id'] != workspace.project['id'] for side in ('left','right')):
                raise ValueError('A native comparison belongs to another original Workspace')
            rows.append(self._summary(record))
        return {'scientific_report_comparisons': rows, 'verified_count': len(rows)}
