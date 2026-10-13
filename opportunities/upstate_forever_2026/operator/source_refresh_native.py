"""Bind source refresh to the existing Operator, Handler and durable task queue.

install(vars(server)) composes the maintained server in place before start_server.
The handler reuses the original Host/Origin policy, session bearer and Workspace
registry. Tasks retain the original operation identity and resume through _invoke.
"""
from __future__ import annotations
from functools import wraps
from urllib.parse import parse_qs, urlsplit
import uuid

from model.common import identifier, held
from model.source_refresh import SourceRefresh
from source_refresh import extend_handler

ACTION = 'source-refresh.apply'


def install(namespace):
    """Register once; delegate every other original route and action unchanged."""
    if namespace.get('_source_refresh_registered'):
        return namespace['Handler']
    original = namespace['Operator']
    invoke = original._invoke

    @wraps(invoke)
    def with_refresh(self, task):
        if task['action'] == 'workspace.backup' and task['payload'].get('source_refresh_plan_id'):
            refresh = SourceRefresh(self.ws(task['workspace']))
            key = identifier(task['payload']['source_refresh_plan_id'])
            refresh._validate_plan(refresh.get(key))
            with held(refresh._state_path(key).parent / '.refresh.lock'):
                return invoke(self, task)
        if task['action'] != ACTION:
            return invoke(self, task)
        value = task['payload']
        execute = value.get('execute_runs', True)
        if not isinstance(execute, bool):
            raise ValueError('execute_runs must be a boolean')
        return SourceRefresh(self.ws(task['workspace'])).apply(
            identifier(value['plan_id']), execute_runs=execute).state

    def selected(handler):
        value = getattr(handler, '_source_refresh_payload', None)
        if value is not None:
            return value.get('workspace')
        query = parse_qs(urlsplit(handler.path).query)
        values = query.get('workspace', [None])
        if len(values) != 1:
            raise ValueError('Choose one original workspace')
        return values[0]

    def workspace(handler):
        key = handler.selected_workspace(selected(handler),
                    write=getattr(handler, '_source_refresh_write', False))
        handler.app.team.require_payload(getattr(handler, '_source_refresh_payload', {}))
        return handler.app.ws(key)

    def authorize(handler, write):
        if '/api/' in urlsplit(handler.path).path:
            handler.authorized()
            handler._source_refresh_write = bool(write and not urlsplit(handler.path).path.endswith('/api/diff'))
        else:
            handler.check_host()
        return True

    def submitter(handler):
        def submit(action, payload, _callable):
            incoming = getattr(handler, '_source_refresh_payload', {})
            operation = incoming.get('operation_id') or uuid.uuid4().hex
            key = handler.selected_workspace(selected(handler), write=True)
            return handler.app.submit(key, action, payload, operation)
        return submit

    base = extend_handler(namespace['Handler'], workspace,
                          submit_for_handler=submitter, authorize_for_handler=authorize)

    class NativeSourceRefreshHandler(base):
        def _refresh_error(self, error):
            # Preserve the original native fault code/status and JSON structure.
            return self.fail(error)

    original._invoke = with_refresh
    namespace['ACTIONS'].add(ACTION)
    namespace['Handler'] = NativeSourceRefreshHandler
    namespace['_source_refresh_registered'] = True
    return NativeSourceRefreshHandler
