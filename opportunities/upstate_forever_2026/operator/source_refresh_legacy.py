"""Source refresh extension for the ORIGINAL operator HTTP handler.

``extend_handler`` subclasses the caller's current BaseHTTPRequestHandler and
forwards every other route unchanged. Supply the original Workspace resolver and
existing async job submission function; it creates neither a server nor workers.
"""
from __future__ import annotations
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit, parse_qs
import json

from model.common import canonical, identifier
from model.source_refresh import SourceRefresh


@dataclass(frozen=True)
class Response:
    body: bytes
    content_type: str = 'application/json; charset=utf-8'
    status: int = 200
    filename: str | None = None


def encoded(value, status=200):
    return Response(canonical(value), status=status)


def dispatch(workspace, action, payload=None, *, submit=None):
    """Transport-independent API, usable by the operator's existing job registry.

    ``submit(kind, payload, callable)`` must return the ORIGINAL operator job
    descriptor. The callable takes no arguments and opens no new Workspace.
    """
    value = payload if payload is not None else {}
    if not isinstance(value, dict):
        raise ValueError('Expected a JSON object')
    refresh = SourceRefresh(workspace)
    if action == 'catalog':
        return encoded({'workspace': workspace.project,
            'sources': [{'id': s['id'], 'title': s.get('title', s['id']),
                         'captured_at': s.get('captured_at'), 'entries': len(s['entries'])}
                        for s in workspace.sources()],
            'plans': [{'id': item['plan']['id'], 'title': item['plan']['title'],
                       'from_collection_id': item['plan']['from_collection_id'],
                       'to_collection_id': item['plan']['to_collection_id'],
                       'status': item['state']['status']} for item in refresh.list()
                      if item.get('engine', 'roots') == 'roots']})
    if action in ('diff', 'plan'):
        old, new = identifier(value['from_collection_id']), identifier(value['to_collection_id'])
        mapping = value.get('mapping')
        if mapping is not None and not isinstance(mapping, dict):
            raise ValueError('mapping must be an object of old source ID to replacement source ID')
        if action == 'diff': return encoded(refresh.source_diff(old, new, mapping))
        return encoded(refresh.plan(old, new, mapping=mapping, roots=value.get('roots'),
                                    title=value.get('title', 'Source refresh')), 201)
    key = identifier(value['plan_id'])
    if action == 'show': return encoded({'plan': refresh.get(key), 'state': refresh.state(key)})
    if action == 'status': return encoded(refresh.state(key))
    if action == 'apply':
        execute = value.get('execute_runs', True)
        if not isinstance(execute, bool): raise ValueError('execute_runs must be a boolean')
        refresh.get(key)
        if submit is None:
            raise RuntimeError('Register the original operator job submitter for source-refresh.apply')
        # Native stage execution belongs to the original supervisor, not an HTTP thread.
        return encoded(submit('source-refresh.apply', {'plan_id': key, 'execute_runs': execute},
                              lambda: refresh.apply(key, execute_runs=execute).state), 202)
    if action == 'export':
        refresh.get(key)
        if submit is None:
            raise RuntimeError('Register the original workspace backup queue')
        return encoded(submit('workspace.backup', {'include_intermediates': True, 'source_refresh_plan_id': key}, None), 202)
    if action == 'report':
        fmt = value.get('format', 'html')
        if fmt not in ('json', 'csv', 'html'): raise ValueError('Choose json, csv or html')
        report = refresh.report(key)[fmt]
        body = canonical(report) if fmt == 'json' else report.encode('utf-8')
        return Response(body, {'json':'application/json', 'csv':'text/csv', 'html':'text/html'}[fmt] +
                        '; charset=utf-8', filename='source-refresh-' + key[:16] + '.' + fmt)
    raise ValueError('Unknown source refresh operation: ' + action)


def extend_handler(base_handler, workspace_for_handler, *, submit_for_handler, authorize_for_handler, prefix='/source-refresh'):
    """Return a handler for the SAME original server, preserving its other routes.

    Call this at the existing handler construction site. The original handler's
    access policy must also cover these paths via the required authorization
    callback returning True on success. The extension additionally rejects
    cross-origin and Fetch-Metadata cross-site writes; no browser cookie or token is
    inspected or logged here.
    """
    assets = Path(__file__).resolve().parent / 'web' / 'source-refresh-legacy'
    if not prefix.startswith('/') or prefix.endswith('/'):
        raise ValueError('Use an absolute path prefix without a trailing slash')

    class SourceRefreshHandler(base_handler):
        def _refresh_send(self, response):
            self.close_connection = True
            self.send_response(response.status)
            self.send_header('Content-Type', response.content_type)
            self.send_header('Content-Length', str(len(response.body)))
            self.send_header('Connection', 'close')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Security-Policy',
                "default-src 'none'; style-src 'unsafe-inline'; sandbox" if response.filename else
                "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'")
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('Referrer-Policy', 'no-referrer')
            if response.filename:
                self.send_header('Content-Disposition', 'attachment; filename="' + response.filename + '"')
            self.end_headers(); self.wfile.write(response.body)

        def _refresh_authorize(self, write=False):
            if authorize_for_handler(self, write) is not True:
                raise PermissionError('The original operator access policy denied this request')
            if write:
                if self.headers.get('Sec-Fetch-Site') == 'cross-site':
                    raise PermissionError('Cross-site writes are not accepted')
                origin = self.headers.get('Origin')
                if origin:
                    actual = urlsplit(origin)
                    if actual.scheme not in ('http','https') or actual.netloc != self.headers.get('Host'):
                        raise PermissionError('Use the original operator origin')

        def _refresh_error(self, exc):
            status = 403 if isinstance(exc, PermissionError) else 404 if isinstance(exc, FileNotFoundError) else 400
            self._refresh_send(encoded({'error': str(exc), 'type': type(exc).__name__}, status))

        def do_GET(self):
            target = urlsplit(self.path)
            if not (target.path == prefix or target.path.startswith(prefix + '/')):
                return super().do_GET()
            try:
                self._refresh_authorize()
                name = target.path[len(prefix):] or '/'
                if name == '/':
                    return self._refresh_send(Response((assets / 'source-refresh.html').read_text(encoding='utf-8').replace('__SOURCE_REFRESH_BASE__', prefix).encode('utf-8'), 'text/html; charset=utf-8'))
                if name in ('/source-refresh.mjs', '/source-refresh.css', '/source-refresh-nav.css'):
                    mime = 'text/javascript' if name.endswith('.mjs') else 'text/css'
                    return self._refresh_send(Response((assets / name[1:]).read_bytes(), mime + '; charset=utf-8'))
                query = parse_qs(target.query, strict_parsing=True)
                if any(len(values) != 1 for values in query.values()):
                    raise ValueError('Duplicate query parameters are not accepted')
                payload = {key: values[0] for key, values in query.items()}
                actions = {'/api/catalog':'catalog', '/api/show':'show', '/api/status':'status', '/api/report':'report'}
                action = actions.get(name)
                if action is None: raise FileNotFoundError('Unknown source-refresh route')
                self._refresh_send(dispatch(workspace_for_handler(self), action, payload))
            except (BrokenPipeError, ConnectionResetError):
                self.close_connection = True
            except Exception as exc:
                self._refresh_error(exc)

        def do_POST(self):
            target = urlsplit(self.path)
            if not target.path.startswith(prefix + '/api/'):
                return super().do_POST()
            try:
                self._refresh_authorize(write=True)
                if target.query: raise ValueError('POST operations do not accept query parameters')
                length = int(self.headers.get('Content-Length', '-1'))
                if length < 0 or length > 1024 * 1024: raise ValueError('Supply a JSON body up to 1 MiB')
                if self.headers.get('Content-Type', '').split(';')[0].strip() != 'application/json':
                    raise ValueError('Use application/json')
                raw = self.rfile.read(length)
                if len(raw) != length: raise ValueError('Incomplete request body')
                def pairs(values):
                    result = {}
                    for key, item in values:
                        if key in result: raise ValueError('Duplicate JSON member: ' + key)
                        result[key] = item
                    return result
                def invalid(value):
                    raise ValueError('JSON numbers must be finite')
                payload = json.loads(raw, object_pairs_hook=pairs, parse_constant=invalid)
                if not isinstance(payload, dict): raise ValueError('Expected a JSON object')
                self._source_refresh_payload = payload
                action = {'/api/diff':'diff','/api/plan':'plan','/api/apply':'apply','/api/export':'export'}.get(target.path[len(prefix):])
                if action is None: raise ValueError('Unknown source refresh operation')
                submit = submit_for_handler(self)
                self._refresh_send(dispatch(workspace_for_handler(self), action, payload, submit=submit))
            except (BrokenPipeError, ConnectionResetError):
                self.close_connection = True
            except Exception as exc:
                self._refresh_error(exc)

    return SourceRefreshHandler
