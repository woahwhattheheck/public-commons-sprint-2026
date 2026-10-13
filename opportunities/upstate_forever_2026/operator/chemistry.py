"""Chemical analysis on the original Operator's workspace, queue and downloads."""
from __future__ import annotations
from copy import deepcopy
import html
from model import chemistry_reports
from model.common import verify_file
from model.chemistry import Chemistry, ACTIONS, invoke
from model.common import digest
READS = {'catalog', 'case', 'run', 'page', 'report'}

class ChemistryOperations:
    def __init__(self, operator, fault):
        self.operator, self.Fault = operator, fault
    def manager(self, workspace):
        return Chemistry(self.operator.ws(workspace))
    def _decorate(self, workspace, value):
        result = deepcopy(value)
        ws = self.operator.ws(workspace)
        if isinstance(result, dict):
            # Native run descriptors are relative to that run; the original
            # download registrar takes descriptors relative to ws.root.
            files = deepcopy(result)
            if result.get('schema') == 'upstate.chemistry-run/v1':
                for item in files.get('artifacts', []):
                    item['path'] = 'chemistry-runs/' + result['id'] + '/' + item['path']
            # The original exporter returns one retained artifact descriptor.
            # Present it through the host's existing artifact collection so the
            # native file registrar exposes the editable ZIP without changing
            # the original exported result or archive identity.
            if 'artifact' in files:
                files.setdefault('artifacts', []).append(files['artifact'])
            result['_downloads'] = self.operator._files(workspace, files, ws.root)
        return result
    def read(self, workspace, operation, payload):
        m = self.manager(workspace)
        if operation == 'catalog':
            value = m.catalog()
            value['reports'] = chemistry_reports.catalog(m.ws)
            # Compact operator state intentionally omits full source entries.
            value['sources'] = [
                {'id': collection['id'], 'title': collection['title'],
                 'entries': [{'id': entry['id'], 'title': entry.get('title', entry['id']),
                              'kind': entry.get('kind')} for entry in collection['entries']]}
                for collection in m.ws._list('sources')]
        elif operation == 'report':
            value = chemistry_reports.inspect(m.ws, payload['report_id'])
            original = verify_file(m.ws.root, value['report']).read_text(encoding='utf-8')
            directory = m.ws.root / chemistry_reports.FOLDER / value['id']
            for item in value['artifacts']:
                path = verify_file(m.ws.root, item)
                relative = path.relative_to(directory).as_posix()
                ticket = self.operator._ticket(workspace, path, item, label=relative)
                old = "href='" + html.escape(relative, quote=True) + "'"
                new = ("href='" + html.escape(ticket['url'], quote=True)
                       + "' target='_blank' rel='noopener'")
                original = original.replace(old, new)
            value = {**value, 'preview_html': original}
        elif operation == 'case': value = m.get_case(payload['case_id'])
        elif operation == 'run': value = m.get_run(payload['run_id'])
        elif operation == 'page':
            value = m.result_page({**payload, 'offset':int(payload.get('offset') or 0),
                                  'limit':int(payload.get('limit') or 200)})
        else: raise self.Fault('CHEMISTRY_VIEW', 'Choose a chemical-analysis view.', 404)
        return {'workspace_key':workspace, **self._decorate(workspace, value)}
    def cancel(self, workspace, payload):
        # This signal must bypass the serial worker that is executing the run.
        return self.manager(workspace).request_cancel(payload['run_id'])
    def invoke(self, task):
        workspace = task['workspace']
        def progress(value):
            # Preserve the original queued task identity and progress store.
            task['chemistry_progress'] = value
            # The original Operator remains the only task writer. Native run
            # progress is persisted by model.chemistry and read by decorate_task.
        value = invoke(self.operator.ws(workspace), task['action'], task['payload'], progress_hook=progress)
        return self._decorate(workspace, value)
    def decorate_task(self, task):
        if task.get('action') not in ACTIONS: return task
        result = deepcopy(task)
        if task.get('action')=='chemistry.run':
            try:
                manager=self.manager(task['workspace'])
                case=manager.get_case(task['payload']['case_id'])
                from model.chemistry import ENGINE_VERSION
                key=digest({'case_id':case['id'],'project_sha256':case['project_sha256'],
                            'request':task['payload'].get('request',{}),'engine_version':ENGINE_VERSION})
                native=manager.get_run(key)
                result['chemistry_run_id']=key
                result['chemistry_progress']=native.get('progress',{})
            except (FileNotFoundError,KeyError,ValueError):pass
        if result.get('state') == 'complete' and isinstance(result.get('result'), dict):
            result['result'] = self._decorate(task['workspace'], result['result'])
            result['_downloads'] = result['result'].get('_downloads', [])
        return result
