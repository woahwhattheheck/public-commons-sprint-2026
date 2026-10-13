"""Add ensemble results to the maintained operator, without replacing its queue.

Call install(sys.modules[__name__]) once after defining Operator and Handler.
All previous routes and operations are preserved by delegation.
Copyright 2026 TokenJunkieLabs.
"""
from __future__ import annotations
import json
from pathlib import Path
import urllib.parse
from model.paired_ensemble.ensemble_workspace import EnsembleWorkspace
from model.paired_ensemble.ensemble_store import digest, fingerprint, identifier, read, verify
from model.paired_ensemble.ensemble_portable import export_project, receive_project

ACTIONS = {'paired_ensemble.build', 'paired_ensemble.resume', 'paired_ensemble.export', 'paired_ensemble.receive'}
REPORT_POLICY = "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; sandbox allow-same-origin allow-downloads; base-uri 'none'; form-action 'none'"


def install(server):
    """Idempotently extend the current classes and their existing auth boundary."""
    if getattr(server.Operator, '_paired_ensemble_installed', False):
        return
    original_invoke = server.Operator._invoke
    original_state = server.Operator.state
    original_item = server.Operator.item
    original_task_view = server.Operator.task_view
    original_get = server.Handler.do_GET
    original_post = server.Handler.do_POST
    server.ACTIONS.update(ACTIONS)
    server.KINDS.add('paired_ensemble_products')

    def service(self, workspace):
        return EnsembleWorkspace(self.ws(workspace))

    def invoke(self, task):
        action, value = task['action'], task['payload']
        if action not in ACTIONS:
            return original_invoke(self, task)
        app = service(self, task['workspace'])
        if action == 'paired_ensemble.build':
            return app.build(value)
        if action == 'paired_ensemble.resume':
            return app.resume(value)
        if action == 'paired_ensemble.export':
            key = identifier(value['ensemble_id'])
            out = self.root / 'outputs' / (task['id'] + '.ensemble.zip')
            if out.exists():
                # A task retry may occur after the completed archive was written.
                import zipfile
                with zipfile.ZipFile(out) as archive:
                    manifest = json.loads(archive.read('ensemble-project.json'))
                if manifest.get('ensemble_id') != key:
                    raise ValueError('Retained export belongs to a different ensemble')
                return {'ensemble_id': key, 'path': str(out), **fingerprint(out)}
            return app.portable(key, out)
        uploaded = self.upload(value['upload_id'])
        import zipfile
        with zipfile.ZipFile(uploaded['path']) as archive:
            manifest = json.loads(archive.read('ensemble-project.json'))
        key = identifier(manifest['ensemble_id'])
        destination = app.root / key
        if destination.exists():
            retained = app.describe(key)
            for name, expected in manifest['members'].items():
                verify(destination, {**expected, 'path': name})
            return {'id': key, 'state': retained['state'], 'reused': True}
        result = receive_project(uploaded['path'], destination, max_bytes=self.extraction_limit)
        return {'id': key, 'state': 'complete', 'received': result}

    def state(self, workspace):
        result = original_state(self, workspace)
        result['data']['paired_ensemble_products'] = service(self, workspace).list()
        return result

    def item(self, workspace, kind, key):
        if kind != 'paired_ensemble_products':
            return original_item(self, workspace, kind, key)
        app = service(self, workspace)
        result = app.describe(key)
        reports = result.get('reports', {}).get('files', []) if result.get('state') == 'complete' else []
        records = list(result.get('artifacts', {}).values()) + reports
        result['_downloads'] = [self._ticket(workspace, app.root / key / row['path'], row, row['path']) for row in records]
        if any(row.get('path') == 'index.html' for row in reports):
            result['_report_url'] = '/api/file/paired-ensemble/' + workspace + '/' + key + '/index.html'
        return result

    def task_view(self, key):
        result = original_task_view(self, key)
        if result['state'] == 'complete' and result['action'] == 'paired_ensemble.export':
            out = result['result']
            result['_downloads'] = [self._ticket(result['workspace'], out['path'], out, 'Complete ensemble result project')]
        elif result['state'] == 'complete' and result['action'] in ('paired_ensemble.build', 'paired_ensemble.resume', 'paired_ensemble.receive'):
            out = self.item(result['workspace'], 'paired_ensemble_products', result['result']['id'])
            result['_downloads'] = out['_downloads']
            if '_report_url' in out:
                result['_report_url'] = out['_report_url']
        return result

    def get(self):
        url = urllib.parse.urlsplit(self.path)
        if not (url.path.startswith('/api/paired-ensemble/') or url.path.startswith('/api/file/paired-ensemble/') or
                url.path in ('/web/paired_ensemble.html', '/web/paired_ensemble.mjs', '/web/paired_ensemble.css')):
            return original_get(self)
        try:
            self.check_host()
            if url.path.startswith('/web/'):
                name = url.path.rsplit('/', 1)[1]
                body = (Path(__file__).parent / 'web' / name).read_bytes()
                kind = {'html': 'text/html', 'mjs': 'text/javascript', 'css': 'text/css'}[name.rsplit('.', 1)[1]]
                self.close_connection = True
                self.send_response(200)
                self.send_header('Content-Type', kind + '; charset=utf-8')
                self.send_header('Content-Length', str(len(body)))
                self.send_header('Cache-Control', 'no-store')
                self.send_header('X-Content-Type-Options', 'nosniff')
                self.send_header('Referrer-Policy', 'no-referrer')
                self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
                self.end_headers()
                self.wfile.write(body)
                return
            if url.path.startswith('/api/file/paired-ensemble/'):
                self.authorized(file=True)
                parts = url.path.removeprefix('/api/file/paired-ensemble/').split('/', 2)
                if len(parts) != 3:
                    raise ValueError('Select a retained ensemble report member')
                workspace, key, name = parts
                name = urllib.parse.unquote(name)
                app = service(self.app, workspace)
                result = app.describe(key)
                reports = result.get('reports', {}).get('files', []) if result.get('state') == 'complete' else []
                records = list(result.get('artifacts', {}).values()) + reports
                records += [{'path': 'analysis.json', **fingerprint(app.root / key / 'analysis.json')}]
                record = next((row for row in records if row['path'] == name), None)
                if record is None:
                    raise server.Fault('ENSEMBLE_MEMBER', 'Choose a complete retained ensemble file.', 404)
                path = verify(app.root / key, record)
                ticket = self.app._ticket(workspace, path, record, path.name)
                return self.send_file(ticket['id'], download=urllib.parse.parse_qs(url.query).get('download') == ['1'],
                                      content_security_policy=REPORT_POLICY if path.suffix == '.html' else None)
            self.authorized()
            query = urllib.parse.parse_qs(url.query)
            workspace = query.get('workspace', [self.app.primary])[0]
            app = service(self.app, workspace)
            if url.path == '/api/paired-ensemble/progress':
                if 'task_id' in query:
                    task = self.app.task(identifier(query['task_id'][0]))
                    if task['workspace'] != workspace or task['action'] not in ('paired_ensemble.build', 'paired_ensemble.resume'):
                        raise ValueError('Progress task differs from the selected ensemble workspace')
                    key = digest(task['payload'])
                else:
                    key = identifier(query['selection_id'][0])
                path = app.root / 'controls' / (key + '.json')
                return self.send_json(200, read(path) if path.exists() else {'state': 'not_started'})
            raise server.Fault('ENSEMBLE_ROUTE', 'Choose a supported ensemble read.', 404)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except BaseException as exc:
            self.fail(exc)

    def post(self):
        url = urllib.parse.urlsplit(self.path)
        if url.path not in ('/api/paired-ensemble/preview', '/api/paired-ensemble/pause'):
            return original_post(self)
        try:
            self.authorized()
            value = self.body()
            app = service(self.app, value.get('workspace', self.app.primary))
            selection = value['selection']
            if url.path.endswith('/pause'):
                # Immediate control record, not queued behind the running build.
                return self.send_json(200, app.cancel(selection))
            return self.send_json(200, {**app.preview(selection), 'selection_id': digest(selection)})
        except (BrokenPipeError, ConnectionResetError):
            pass
        except BaseException as exc:
            self.fail(exc)

    server.Operator._invoke = invoke
    server.Operator.state = state
    server.Operator.item = item
    server.Operator.task_view = task_view
    server.Handler.do_GET = get
    server.Handler.do_POST = post
    server.Operator._paired_ensemble_installed = True
