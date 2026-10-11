"""Local staff interface; private business files stay behind the same session."""
import base64
import hmac
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import sys
from urllib.parse import parse_qs, quote, unquote, urlsplit

from .model import Fault, ROOT, require


class Server(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address, workspace, origin):
        super().__init__(address, Handler)
        self.workspace, self.origin = workspace, origin.rstrip('/')


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def log_message(self, *args):
        pass

    def headers_for(self, status, mime, length, extra=None):
        self.send_response(status)
        for key, value in {'Content-Type': mime, 'Content-Length': str(length), 'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin',
            'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'",
            **(extra or {})}.items():
            self.send_header(key, value)
        self.end_headers()

    def json(self, value, status=200, extra=None):
        content = (json.dumps(value, ensure_ascii=False, allow_nan=False) + '\n').encode()
        self.headers_for(status, 'application/json; charset=utf-8', len(content), extra)
        if self.command != 'HEAD':
            self.wfile.write(content)

    def binary(self, path, filename, mime='application/octet-stream', temporary=None):
        try:
            with path.open('rb') as source:
                self.headers_for(200, mime, path.stat().st_size,
                    {'Content-Disposition': "attachment; filename*=UTF-8''" + quote(filename, safe='')})
                if self.command != 'HEAD':
                    for chunk in iter(lambda: source.read(65536), b''):
                        self.wfile.write(chunk)
        finally:
            if temporary:
                temporary.cleanup()

    def body(self):
        require(self.headers.get('Content-Type', '').split(';')[0] == 'application/json', 'Send JSON content', 415)
        raw_length = self.headers.get('Content-Length', '')
        require(raw_length.isdecimal() and 0 < int(raw_length) <= 29 * 1024 * 1024, 'The request is too large or incomplete', 413)
        require(self.headers.get('Origin') == self.server.origin, 'Use the configured workspace origin', 403)
        raw = self.rfile.read(int(raw_length))
        require(len(raw) == int(raw_length), 'The request is incomplete')
        try:
            value = json.loads(raw)
        except (ValueError, UnicodeDecodeError) as exc:
            raise Fault('Supply a JSON object') from exc
        require(isinstance(value, dict), 'Supply a JSON object')
        return value

    def token(self):
        cookie = SimpleCookie()
        try:
            cookie.load(self.headers.get('Cookie', ''))
            return cookie['sumter_workspace'].value if 'sumter_workspace' in cookie else ''
        except Exception:
            return ''

    def cookie(self, value, age=28800):
        return ('sumter_workspace=' + value + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=' + str(age) +
                ('; Secure' if self.server.origin.startswith('https://') else ''))

    def route(self):
        parsed = urlsplit(self.path)
        path = unquote(parsed.path)
        require(self.headers.get('Host') == urlsplit(self.server.origin).netloc, 'Use the configured workspace host', 400)
        if self.command in ('GET', 'HEAD') and path in ('/', '/app.js', '/style.css'):
            filename, mime = {'/': ('index.html', 'text/html'), '/app.js': ('app.js', 'text/javascript'),
                              '/style.css': ('style.css', 'text/css')}[path]
            data = (ROOT / 'workspace/static' / filename).read_bytes()
            self.headers_for(200, mime + '; charset=utf-8', len(data))
            if self.command != 'HEAD':
                self.wfile.write(data)
            return
        if path == '/health' and self.command in ('GET', 'HEAD'):
            return self.json({'ready': True})
        store = self.server.workspace
        value = self.body() if self.command == 'POST' else None
        if path == '/api/login' and self.command == 'POST':
            result = store.login(value.get('name'), value.get('password'))
            return self.json({'user': result['user'], 'csrf': result['csrf']}, extra={'Set-Cookie': self.cookie(result['token'])})
        token = self.token()
        actor = store.session(token)
        if self.command == 'POST':
            require(hmac.compare_digest(self.headers.get('X-CSRF-Token', ''), actor['csrf']), 'Refresh the current workspace session', 403)
        query = {k: v[0] for k, v in parse_qs(parsed.query).items()}
        parts = path.strip('/').split('/')
        if path == '/api/session':
            return self.json({'user': {k: actor[k] for k in ('id', 'name', 'role')}, 'csrf': actor['csrf']})
        if path == '/api/logout' and self.command == 'POST':
            store.logout(token)
            return self.json({'signed_out': True}, extra={'Set-Cookie': self.cookie('', 0)})
        if path == '/api/dashboard' and self.command in ('GET', 'HEAD'):
            return self.json(store.dashboard(actor))
        if path == '/api/library' and self.command == 'POST':
            return self.json(store.save_library(actor, value))
        if path == '/api/library/review' and self.command == 'POST':
            return self.json(store.review_library(actor, value))
        if len(parts) == 4 and parts[:2] == ['api', 'library'] and self.command in ('GET', 'HEAD'):
            with store.db() as db:
                record = store.library_record(db, parts[2], parts[3], int(query['revision']) if 'revision' in query else None)
                record['history'] = [dict(r) for r in db.execute('SELECT revision,hash,author,created FROM library WHERE kind=? AND key=? ORDER BY revision DESC', (parts[2], parts[3]))]
                return self.json(record)
        if path == '/api/users' and self.command == 'POST':
            return self.json(store.add_user(actor, value.get('name'), value.get('role'), value.get('password')))
        if len(parts) == 3 and parts[:2] == ['api', 'users'] and self.command == 'POST':
            return self.json(store.update_user(actor, parts[2], value))
        if path == '/api/projects' and self.command == 'POST':
            return self.json(store.create_project(actor, value), 201)
        if path == '/api/sources':
            if self.command == 'POST':
                return self.upload(store, actor, None, value)
            with store.db() as db:
                return self.json({'files': [dict(r) for r in db.execute('SELECT * FROM files WHERE project IS NULL ORDER BY created DESC')]})
        if len(parts) == 3 and parts[:2] == ['api', 'files'] and self.command in ('GET', 'HEAD'):
            file, metadata = store.file(actor, parts[2])
            return self.binary(file, metadata['name'])
        if len(parts) >= 3 and parts[:2] == ['api', 'projects']:
            project = parts[2]
            if len(parts) == 3 and self.command in ('GET', 'HEAD'):
                return self.json(store.project(actor, project, query.get('revision')))
            if len(parts) == 4:
                action = parts[3]
                if action == 'preview' and self.command == 'GET':
                    return self.json(store.preview(actor, project, int(query['revision']) if 'revision' in query else None))
                actions = {'save': store.edit_project, 'members': store.set_member, 'locks': store.set_lock,
                           'reviews': store.review_project, 'freeze': store.freeze, 'lifecycle': store.lifecycle,
                           'adoptions': store.record_adoption}
                if self.command == 'POST' and action in actions:
                    return self.json(actions[action](actor, project, value))
                if self.command == 'POST' and action == 'files':
                    return self.upload(store, actor, project, value)
        if len(parts) == 4 and parts[:2] == ['api', 'releases'] and self.command in ('GET', 'HEAD'):
            release_id, kind = parts[2:]
            if kind == 'accepted-handover':
                file, temporary = store.accepted_handover(actor, release_id)
                return self.binary(file, release_id + '-accepted-handover.zip', 'application/zip', temporary)
            file, metadata = store.release_file(actor, release_id, kind)
            return self.binary(file, metadata['name'], 'application/zip')
        if path == '/api/export' and self.command in ('GET', 'HEAD'):
            file, temporary = store.export_workspace(actor)
            return self.binary(file, 'sumter-workspace-transfer.zip', 'application/zip', temporary)
        raise Fault('Workspace route not found', 404)

    def upload(self, store, actor, project, value):
        require(isinstance(value.get('data'), str), 'Choose a source file')
        try:
            data = base64.b64decode(value['data'], validate=True)
        except ValueError as exc:
            raise Fault('The file transfer is incomplete') from exc
        return self.json(store.upload(actor, project, value.get('name'), value.get('mime'), value.get('source'), data), 201)

    def handle_request(self):
        self.connection.settimeout(35)
        try:
            self.route()
        except (BrokenPipeError, ConnectionResetError):
            return
        except Fault as exc:
            self.json({'error': str(exc), 'detail': exc.detail}, exc.status)
        except (ValueError, TypeError, KeyError) as exc:
            self.json({'error': 'The supplied value does not match this workspace action.'}, 400)
        except Exception as exc:
            sys.stderr.write('Workspace request failed: ' + type(exc).__name__ + '\n')
            self.json({'error': 'The operation could not complete; the retained revision is unchanged.'}, 500)

    do_GET = handle_request
    do_HEAD = handle_request
    do_POST = handle_request
