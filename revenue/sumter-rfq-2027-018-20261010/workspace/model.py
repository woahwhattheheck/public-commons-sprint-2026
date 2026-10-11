"""Persistent authoring, approval and handover over the original template compiler.

Library and project revisions are immutable. Working section locks are separate
from those revisions. Every release resolves exact pinned records and file bytes.
"""
from contextlib import contextmanager
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import sqlite3
import subprocess
import tempfile
import threading
import time
import zipfile

ROOT = Path(__file__).resolve().parents[1]
BASE_FIELDS = ('agency', 'project_title', 'solicitation_id', 'procurement_contact', 'approved_submission_instructions')
ROLES = ('admin', 'author', 'reviewer', 'viewer')
VISIBILITY = ('internal', 'public', 'withheld')


class Fault(Exception):
    def __init__(self, message, status=400, detail=None):
        super().__init__(message)
        self.status, self.detail = status, detail


def require(condition, message, status=400, detail=None):
    if not condition:
        raise Fault(message, status, detail)


def text(value, name, maximum=50000, empty=False):
    require(isinstance(value, str) and len(value) <= maximum and '\x00' not in value
            and (empty or value.strip()), 'Enter ' + name)
    return value


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False)


def sha(value):
    return hashlib.sha256(value if isinstance(value, bytes) else value.encode()).hexdigest()


def ident():
    return secrets.token_hex(12)


def now():
    return datetime.now(timezone.utc).isoformat()


def compiler(request):
    try:
        result = subprocess.run(['node', str(ROOT / 'workspace/compiler.mjs')],
            input=canonical(request), text=True, capture_output=True, timeout=30, check=False)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise Fault('The local Node 22 compiler could not complete. Check the installed runtime.', 503) from exc
    require(result.returncode == 0, 'Compiler: ' + result.stderr.strip())
    return json.loads(result.stdout)


SCHEMA = '''
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT NOT NULL,role TEXT NOT NULL,
 salt TEXT NOT NULL,password_hash TEXT NOT NULL,active INTEGER NOT NULL,created TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),
 csrf TEXT NOT NULL,expires REAL NOT NULL);
CREATE TABLE IF NOT EXISTS login_attempts(name TEXT PRIMARY KEY,failures INTEGER NOT NULL,last REAL NOT NULL);
CREATE TABLE IF NOT EXISTS library(kind TEXT NOT NULL,key TEXT NOT NULL,revision INTEGER NOT NULL,
 payload TEXT NOT NULL,source TEXT NOT NULL,hash TEXT NOT NULL,author TEXT NOT NULL,created TEXT NOT NULL,
 PRIMARY KEY(kind,key,revision));
CREATE TABLE IF NOT EXISTS library_reviews(id INTEGER PRIMARY KEY,kind TEXT NOT NULL,key TEXT NOT NULL,
 revision INTEGER NOT NULL,reviewer TEXT NOT NULL,decision TEXT NOT NULL,note TEXT NOT NULL,created TEXT NOT NULL,
 FOREIGN KEY(kind,key,revision) REFERENCES library(kind,key,revision));
CREATE INDEX IF NOT EXISTS library_review_version ON library_reviews(kind,key,revision,id);
CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,title TEXT NOT NULL,kind TEXT NOT NULL,
 state TEXT NOT NULL,revision INTEGER NOT NULL,owner TEXT NOT NULL,created TEXT NOT NULL,updated TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS members(project TEXT NOT NULL REFERENCES projects(id),user_id TEXT NOT NULL REFERENCES users(id),
 role TEXT NOT NULL,PRIMARY KEY(project,user_id));
CREATE TABLE IF NOT EXISTS revisions(project TEXT NOT NULL REFERENCES projects(id),revision INTEGER NOT NULL,
 document TEXT NOT NULL,hash TEXT NOT NULL,actor TEXT NOT NULL,note TEXT NOT NULL,created TEXT NOT NULL,
 PRIMARY KEY(project,revision));
CREATE TABLE IF NOT EXISTS locks(project TEXT NOT NULL REFERENCES projects(id),section TEXT NOT NULL,
 user_id TEXT NOT NULL REFERENCES users(id),created TEXT NOT NULL,PRIMARY KEY(project,section));
CREATE TABLE IF NOT EXISTS reviews(id INTEGER PRIMARY KEY,project TEXT NOT NULL,revision INTEGER NOT NULL,
 stage TEXT NOT NULL,reviewer TEXT NOT NULL,decision TEXT NOT NULL,note TEXT NOT NULL,created TEXT NOT NULL,
 FOREIGN KEY(project,revision) REFERENCES revisions(project,revision));
CREATE INDEX IF NOT EXISTS review_version ON reviews(project,revision,id);
CREATE TABLE IF NOT EXISTS files(id TEXT PRIMARY KEY,project TEXT REFERENCES projects(id),hash TEXT NOT NULL,
 bytes INTEGER NOT NULL,name TEXT NOT NULL,mime TEXT NOT NULL,source TEXT NOT NULL,actor TEXT NOT NULL,created TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS releases(id TEXT PRIMARY KEY,project TEXT NOT NULL,revision INTEGER NOT NULL,
 parent TEXT,document_hash TEXT NOT NULL,internal_sha TEXT NOT NULL,public_sha TEXT NOT NULL,
 created TEXT NOT NULL,actor TEXT NOT NULL,UNIQUE(project,revision),
 FOREIGN KEY(project,revision) REFERENCES revisions(project,revision));
CREATE TABLE IF NOT EXISTS adoptions(id TEXT PRIMARY KEY,release_id TEXT NOT NULL REFERENCES releases(id),
 template TEXT NOT NULL,record TEXT NOT NULL,actor TEXT NOT NULL,created TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY,project TEXT,actor TEXT NOT NULL,
 action TEXT NOT NULL,detail TEXT NOT NULL,created TEXT NOT NULL);
'''


class Workspace:
    def __init__(self, root):
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(self.root, 0o700)
        for name in ('blobs', 'releases', 'temporary'):
            (self.root / name).mkdir(exist_ok=True, mode=0o700)
        self.lock = threading.RLock()
        self.release_lock = threading.Lock()
        with self.db(True) as db:
            db.executescript(SCHEMA)
            if not db.execute('SELECT 1 FROM library LIMIT 1').fetchone():
                kit = json.loads((ROOT / 'template-kit.json').read_text())
                for blueprint in kit['templates']:
                    source = {'reference': kit['basis'], 'issuer': kit['source'], 'files': []}
                    payload = canonical(blueprint)
                    db.execute('INSERT INTO library VALUES(?,?,?,?,?,?,?,?)',
                        ('template', blueprint['id'], 1, payload, canonical(source), sha(payload), 'original-kit', now()))
        os.chmod(self.root / 'workspace.sqlite3', 0o600)

    @contextmanager
    def db(self, write=False):
        with self.lock:
            db = sqlite3.connect(self.root / 'workspace.sqlite3', timeout=20)
            db.row_factory = sqlite3.Row
            db.execute('PRAGMA foreign_keys=ON')
            db.execute('PRAGMA journal_mode=WAL')
            try:
                db.execute('BEGIN IMMEDIATE' if write else 'BEGIN')
                yield db
                db.commit()
            except BaseException:
                db.rollback()
                raise
            finally:
                db.close()

    @staticmethod
    def event(db, actor, action, detail, project=None):
        db.execute('INSERT INTO events(project,actor,action,detail,created) VALUES(?,?,?,?,?)',
                   (project, actor['id'], action, canonical(detail), now()))

    def add_user(self, actor, name, role, password, user_id=None):
        text(name, 'the operator name', 120)
        require(role in ROLES, 'Choose an existing role')
        text(password, 'a password of at least 16 characters', 2000)
        require(len(password) >= 16, 'Use a password of at least 16 characters')
        salt = secrets.token_hex(16)
        encoded = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1).hex()
        with self.db(True) as db:
            if actor is None:
                require(not db.execute('SELECT 1 FROM users').fetchone(), 'Bootstrap is already complete', 409)
                require(role == 'admin', 'The first operator must be an administrator')
            else:
                require(actor['role'] == 'admin', 'Administrator access is required', 403)
            user_id = user_id or ident()
            require(not db.execute('SELECT 1 FROM users WHERE name=?', (name,)).fetchone(), 'That operator name is already used', 409)
            db.execute('INSERT INTO users VALUES(?,?,?,?,?,1,?)', (user_id, name, role, salt, encoded, now()))
            self.event(db, actor or {'id': user_id}, 'operator_created', {'user': user_id, 'role': role})
        return {'id': user_id, 'name': name, 'role': role}

    def login(self, name, password):
        text(name, 'the operator name', 120)
        text(password, 'the password', 2000)
        with self.db(True) as db:
            attempt = db.execute('SELECT * FROM login_attempts WHERE name=?', (name,)).fetchone()
            require(not attempt or attempt['failures'] < 6 or time.time() - attempt['last'] > 60,
                    'Wait one minute before another sign-in attempt', 429)
            row = db.execute('SELECT * FROM users WHERE name=? AND active=1', (name,)).fetchone()
            salt = row['salt'] if row else '00' * 16
            candidate = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1).hex()
            good = row is not None and hmac.compare_digest(candidate, row['password_hash'])
            if not good:
                count = attempt['failures'] + 1 if attempt and time.time() - attempt['last'] <= 60 else 1
                db.execute('INSERT OR REPLACE INTO login_attempts VALUES(?,?,?)', (name, count, time.time()))
            else:
                db.execute('DELETE FROM login_attempts WHERE name=?', (name,))
                db.execute('DELETE FROM sessions WHERE expires<?', (time.time(),))
                token, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(24)
                db.execute('INSERT INTO sessions VALUES(?,?,?,?)', (sha(token), row['id'], csrf, time.time() + 28800))
                return {'token': token, 'csrf': csrf, 'user': {k: row[k] for k in ('id', 'name', 'role')}}
        raise Fault('The operator name or password is incorrect', 401)

    def session(self, token):
        with self.db() as db:
            row = db.execute('SELECT u.id,u.name,u.role,s.csrf FROM sessions s JOIN users u ON u.id=s.user_id '
                             'WHERE s.token_hash=? AND s.expires>? AND u.active=1', (sha(token), time.time())).fetchone()
            require(row, 'Sign in to the implementation workspace', 401)
            return dict(row)

    def logout(self, token):
        with self.db(True) as db:
            db.execute('DELETE FROM sessions WHERE token_hash=?', (sha(token),))

    @staticmethod
    def project_row(db, actor, project, roles=None):
        row = db.execute('SELECT * FROM projects WHERE id=?', (project,)).fetchone()
        member = db.execute('SELECT role FROM members WHERE project=? AND user_id=?', (project, actor['id'])).fetchone()
        require(row and (actor['role'] == 'admin' or member), 'Project not found', 404)
        role = 'admin' if actor['role'] == 'admin' else member['role']
        require(not roles or role in roles or role == 'admin', 'Your project role cannot perform this action', 403)
        return dict(row), role

    @staticmethod
    def revision(db, project, revision):
        row = db.execute('SELECT * FROM revisions WHERE project=? AND revision=?', (project, revision)).fetchone()
        require(row, 'Project revision not found', 404)
        return dict(row) | {'document': json.loads(row['document'])}

    @staticmethod
    def library_record(db, kind, key, revision=None):
        row = db.execute('SELECT * FROM library WHERE kind=? AND key=?' +
                         (' AND revision=?' if revision is not None else '') + ' ORDER BY revision DESC LIMIT 1',
                         (kind, key, revision) if revision is not None else (kind, key)).fetchone()
        require(row, 'Library revision not found: ' + key, 404)
        review = db.execute('SELECT * FROM library_reviews WHERE kind=? AND key=? AND revision=? ORDER BY id DESC LIMIT 1',
                            (kind, key, row['revision'])).fetchone()
        return dict(row) | {'payload': json.loads(row['payload']), 'source': json.loads(row['source']),
                            'review': dict(review) if review else None}

    def dashboard(self, actor):
        with self.db() as db:
            projects = db.execute('SELECT p.* FROM projects p WHERE ? OR EXISTS '
                '(SELECT 1 FROM members m WHERE m.project=p.id AND m.user_id=?) ORDER BY updated DESC',
                (actor['role'] == 'admin', actor['id'])).fetchall()
            library = [self.library_record(db, r['kind'], r['key']) for r in db.execute('SELECT DISTINCT kind,key FROM library ORDER BY kind,key')]
            users = [dict(r) for r in db.execute('SELECT id,name,role,active FROM users ORDER BY name')]
        return {'user': {k: actor[k] for k in ('id', 'name', 'role')}, 'projects': list(map(dict, projects)),
                'library': library, 'users': users, 'issuer': json.loads((ROOT / 'template-kit.json').read_text())['source']}

    def save_library(self, actor, value):
        require(actor['role'] in ('admin', 'author'), 'Library author access is required', 403)
        kind, key, payload = value.get('kind'), value.get('key'), value.get('payload')
        require(kind in ('template', 'clause'), 'Choose template or clause')
        pattern = r'[a-z][a-z0-9-]{1,70}' if kind == 'template' else r'[a-z][a-z0-9_]{0,80}'
        require(isinstance(key, str) and re.fullmatch(pattern, key), 'Use a valid library key')
        require(isinstance(payload, dict), 'Supply the library content')
        source = value.get('source', {})
        require(isinstance(source, dict), 'Supply the original source reference')
        text(source.get('reference'), 'the original source reference')
        require(isinstance(source.get('files', []), list), 'Source files must be a list')
        if kind == 'template':
            require(payload.get('id') == key, 'The template ID must match its library key')
            payload = compiler({'operation': 'validate', 'kit': {'schema': 'tjl.procurement-template-kit.v1',
                                'templates': [payload]}})['templates'][0]
        else:
            require(set(payload) <= {'text', 'title'}, 'Clause content accepts title and text')
            text(payload.get('text'), 'the original clause text')
            text(payload.get('title', key), 'the clause title', 500)
        encoded = canonical(payload)
        with self.db(True) as db:
            for file_id in source.get('files', []):
                f = db.execute('SELECT * FROM files WHERE id=? AND project IS NULL', (file_id,)).fetchone()
                require(f, 'Use an uploaded library source file')
            current = db.execute('SELECT MAX(revision) FROM library WHERE kind=? AND key=?', (kind, key)).fetchone()[0] or 0
            require(value.get('revision', 0) == current, 'The library item changed. Reopen its current revision.', 409)
            revision = current + 1
            db.execute('INSERT INTO library VALUES(?,?,?,?,?,?,?,?)',
                (kind, key, revision, encoded, canonical(source), sha(encoded), actor['id'], now()))
            self.event(db, actor, 'library_revision', {'kind': kind, 'key': key, 'revision': revision})
            return self.library_record(db, kind, key, revision)

    def review_library(self, actor, value):
        require(actor['role'] in ('admin', 'reviewer'), 'Library reviewer access is required', 403)
        require(value.get('decision') in ('approved', 'changes_requested'), 'Choose a review decision')
        note = text(value.get('note'), 'the review note')
        with self.db(True) as db:
            record = self.library_record(db, value.get('kind'), value.get('key'), value.get('revision'))
            db.execute('INSERT INTO library_reviews(kind,key,revision,reviewer,decision,note,created) VALUES(?,?,?,?,?,?,?)',
                (record['kind'], record['key'], record['revision'], actor['id'], value['decision'], note, now()))
            self.event(db, actor, 'library_review', {k: value[k] for k in ('kind', 'key', 'revision', 'decision')})
            return self.library_record(db, record['kind'], record['key'], record['revision'])

    def validate_document(self, db, document, project):
        require(isinstance(document, dict), 'Supply a project document')
        text(document.get('title'), 'the project title', 500)
        require(document.get('kind') in ('solicitation', 'contract'), 'Choose solicitation or contract')
        require(document.get('mode') in ('operator', 'demonstration'), 'Choose operator or demonstration mode')
        require(isinstance(document.get('templates'), list) and document['templates'], 'Select at least one template')
        ids = set()
        for selected in document['templates']:
            require(isinstance(selected, dict) and selected.get('visibility') in ('internal', 'public'), 'Choose template visibility')
            key = selected.get('key')
            require(key not in ids, 'Select each template only once')
            ids.add(key)
            self.library_record(db, 'template', key, selected.get('revision'))
            require(isinstance(selected.get('revision'), int), 'Pin the exact template revision')
        require(isinstance(document.get('fields'), dict), 'Supply project field values')
        for key, value in document['fields'].items():
            require(re.fullmatch(r'[a-z][a-z0-9_]{0,80}', key), 'Use an original compiler field key')
            text(value, 'plain text for ' + key, empty=True)
        require(isinstance(document.get('clauses'), dict), 'Supply pinned clause revisions')
        for key, revision in document['clauses'].items():
            require(isinstance(revision, int), 'Pin the exact clause revision')
            self.library_record(db, 'clause', key, revision)
        require(isinstance(document.get('attachments'), list), 'Supply the attachment selection')
        seen = set()
        for attachment in document['attachments']:
            require(isinstance(attachment, dict) and attachment.get('visibility') in VISIBILITY, 'Classify each attachment')
            require(set(attachment) <= {'id', 'visibility', 'templates'}, 'Select a retained file by ID; its original metadata is read from the source register')
            f = db.execute('SELECT * FROM files WHERE id=? AND (project=? OR project IS NULL)', (attachment.get('id'), project)).fetchone()
            require(f and f['id'] not in seen, 'Choose each available project or library file once')
            seen.add(f['id'])
            require(isinstance(attachment.get('templates', []), list) and set(attachment.get('templates', [])) <= ids,
                    'Attachment destinations must be selected templates')
        stages = document.get('workflow')
        require(isinstance(stages, list) and stages, 'Configure at least one approval stage')
        stage_ids = set()
        for stage in stages:
            require(isinstance(stage, dict) and re.fullmatch(r'[a-z][a-z0-9-]{0,70}', str(stage.get('id', '')))
                    and stage['id'] not in stage_ids, 'Use unique approval stage IDs')
            stage_ids.add(stage['id'])
            text(stage.get('label'), 'the approval stage name', 300)
            require(isinstance(stage.get('reviewers'), list), 'Choose the reviewers for each stage')
            for user in stage['reviewers']:
                require(db.execute('SELECT 1 FROM users WHERE id=? AND active=1', (user,)).fetchone(), 'Choose an active reviewer')
        if document.get('parent_release'):
            require(db.execute('SELECT 1 FROM releases WHERE id=? AND project=?', (document['parent_release'], project)).fetchone(),
                    'An amendment must refer to an exact release of this project')

    def create_project(self, actor, value):
        require(actor['role'] in ('admin', 'author'), 'Project author access is required', 403)
        project = ident()
        with self.db(True) as db:
            selected = value.get('templates', [])
            doc = {'title': value.get('title'), 'kind': value.get('kind', 'solicitation'), 'mode': value.get('mode', 'operator'),
                'templates': selected, 'fields': {}, 'clauses': {}, 'attachments': [],
                'workflow': [{'id': 'procurement-review', 'label': 'Procurement review', 'reviewers': []}], 'parent_release': None}
            self.validate_document(db, doc, project)
            stamp = now()
            db.execute('INSERT INTO projects VALUES(?,?,?,\'draft\',1,?,?,?)', (project, doc['title'], doc['kind'], actor['id'], stamp, stamp))
            db.execute('INSERT INTO members VALUES(?,?,?)', (project, actor['id'], 'author'))
            db.execute('INSERT INTO revisions VALUES(?,1,?,?,?,?,?)', (project, canonical(doc), sha(canonical(doc)), actor['id'], 'Project created', stamp))
            self.event(db, actor, 'project_created', {'revision': 1}, project)
        return self.project(actor, project)

    def project(self, actor, project, revision=None):
        with self.db() as db:
            row, role = self.project_row(db, actor, project)
            saved = self.revision(db, project, int(revision) if revision is not None else row['revision'])
            return row | {'role': role, 'selected_revision': saved['revision'], 'document': saved['document'], 'document_hash': saved['hash'],
                'library_records': self.material(db, project, saved)[2],
                'locks': [dict(r) for r in db.execute('SELECT l.*,u.name FROM locks l JOIN users u ON u.id=l.user_id WHERE project=?', (project,))],
                'members': [dict(r) for r in db.execute('SELECT m.*,u.name FROM members m JOIN users u ON u.id=m.user_id WHERE project=?', (project,))],
                'history': [dict(r) for r in db.execute('SELECT revision,hash,actor,note,created FROM revisions WHERE project=? ORDER BY revision DESC', (project,))],
                'files': [dict(r) for r in db.execute('SELECT * FROM files WHERE project=? OR project IS NULL ORDER BY created DESC', (project,))],
                'reviews': [dict(r) for r in db.execute('SELECT * FROM reviews WHERE project=? ORDER BY id DESC', (project,))],
                'releases': [dict(r) for r in db.execute('SELECT * FROM releases WHERE project=? ORDER BY created DESC', (project,))],
                'adoptions': [dict(r) | {'record': json.loads(r['record'])} for r in db.execute('SELECT a.* FROM adoptions a JOIN releases r ON r.id=a.release_id WHERE r.project=? ORDER BY a.created DESC', (project,))],
                'readiness': self.readiness(db, project, saved)}

    @staticmethod
    def section(document, key):
        if key.startswith('field:'):
            return document['fields'].get(key[6:])
        require(key in ('title', 'templates', 'clauses', 'attachments', 'workflow'), 'Choose an editable project section')
        return document.get(key)

    def edit_project(self, actor, project, value):
        changes = value.get('changes')
        require(isinstance(changes, dict) and changes, 'Supply the changed sections')
        note = text(value.get('note'), 'the revision note', 2000)
        with self.db(True) as db:
            row, role = self.project_row(db, actor, project, ('author',))
            require(row['state'] not in ('archived', 'released'), 'Reopen the project or start an amendment before editing', 409)
            current = self.revision(db, project, row['revision'])
            base = self.revision(db, project, value.get('revision'))
            doc = deepcopy(current['document'])
            conflicts = []
            for section, value in changes.items():
                owner = db.execute('SELECT user_id FROM locks WHERE project=? AND section=?', (project, section)).fetchone()
                require(not owner or owner['user_id'] == actor['id'], 'This section is locked by another operator: ' + section, 409)
                if self.section(base['document'], section) != self.section(doc, section):
                    conflicts.append(section)
                if section.startswith('field:'):
                    doc['fields'][section[6:]] = value
                else:
                    doc[section] = value
            require(not conflicts, 'The same section changed. Reopen its current contents before saving.', 409,
                    {'sections': conflicts, 'current_revision': row['revision']})
            self.validate_document(db, doc, project)
            if canonical(doc) == canonical(current['document']):
                return {'revision': row['revision'], 'unchanged': True}
            revision = row['revision'] + 1
            db.execute('INSERT INTO revisions VALUES(?,?,?,?,?,?,?)', (project, revision, canonical(doc), sha(canonical(doc)), actor['id'], note, now()))
            db.execute('UPDATE projects SET title=?,kind=?,state=\'draft\',revision=?,updated=? WHERE id=?',
                       (doc['title'], doc['kind'], revision, now(), project))
            self.event(db, actor, 'project_revision', {'revision': revision, 'sections': list(changes), 'merged_from': base['revision']}, project)
        return self.project(actor, project)

    def set_member(self, actor, project, value):
        with self.db(True) as db:
            row, _ = self.project_row(db, actor, project)
            require(actor['role'] == 'admin' or actor['id'] == row['owner'], 'The project owner assigns access', 403)
            user, role = value.get('user_id'), value.get('role')
            require(role in ('author', 'reviewer', 'viewer'), 'Choose a project role')
            require(db.execute('SELECT 1 FROM users WHERE id=? AND active=1', (user,)).fetchone(), 'Choose an active operator')
            db.execute('INSERT OR REPLACE INTO members VALUES(?,?,?)', (project, user, role))
            self.event(db, actor, 'project_member', {'user': user, 'role': role}, project)
        return self.project(actor, project)

    def set_lock(self, actor, project, value):
        with self.db(True) as db:
            row, _ = self.project_row(db, actor, project, ('author',))
            section = text(value.get('section'), 'the section', 120)
            self.section(self.revision(db, project, row['revision'])['document'], section)
            previous = db.execute('SELECT * FROM locks WHERE project=? AND section=?', (project, section)).fetchone()
            if value.get('locked'):
                require(not previous or previous['user_id'] == actor['id'], 'Another operator owns this section lock', 409)
                db.execute('INSERT OR REPLACE INTO locks VALUES(?,?,?,?)', (project, section, actor['id'], now()))
            else:
                require(not previous or previous['user_id'] == actor['id'] or actor['role'] == 'admin', 'Only the owner or an administrator can release this lock', 403)
                if previous and previous['user_id'] != actor['id']:
                    text(value.get('note'), 'the administrator release reason')
                db.execute('DELETE FROM locks WHERE project=? AND section=?', (project, section))
            self.event(db, actor, 'section_lock', value, project)
        return self.project(actor, project)

    def upload(self, actor, project, name, mime, source, data):
        text(name, 'the file name', 250)
        text(source, 'the original file reference', 4000)
        require(0 < len(data) <= 20 * 1024 * 1024, 'Choose a file between 1 byte and20 MiB')
        name = Path(name.replace('\\', '/')).name
        require(name not in ('', '.', '..') and '\r' not in name and '\n' not in name, 'Choose a file name')
        fingerprint, file_id = sha(data), ident()
        with self.db(True) as db:
            if project:
                self.project_row(db, actor, project, ('author',))
            else:
                require(actor['role'] in ('admin', 'author'), 'Library author access is required', 403)
            path = self.root / 'blobs' / fingerprint
            if not path.exists():
                with path.open('xb') as f:
                    os.chmod(path, 0o600)
                    f.write(data)
            else:
                require(path.stat().st_size == len(data) and sha(path.read_bytes()) == fingerprint, 'Stored file hash mismatch', 500)
            db.execute('INSERT INTO files VALUES(?,?,?,?,?,?,?,?,?)', (file_id, project, fingerprint, len(data), name,
                       str(mime or 'application/octet-stream')[:150], source, actor['id'], now()))
            self.event(db, actor, 'file_retained', {'id': file_id, 'hash': fingerprint, 'bytes': len(data)}, project)
            return dict(db.execute('SELECT * FROM files WHERE id=?', (file_id,)).fetchone())

    def material(self, db, project, saved, selected=None):
        doc = saved['document']
        records, templates, clauses = [], [], {}
        fields, clause_keys = set(BASE_FIELDS), set()
        for item in doc['templates']:
            if selected is not None and item['key'] not in selected:
                continue
            record = self.library_record(db, 'template', item['key'], item['revision'])
            records.append(record)
            templates.append(record['payload'])
            fields.update(record['payload']['required_fields'])
            clause_keys.update(record['payload']['approved_clause_keys'])
        for key in clause_keys:
            if key in doc['clauses']:
                record = self.library_record(db, 'clause', key, doc['clauses'][key])
                records.append(record)
                review = record['review']
                clauses[key] = {'text': record['payload']['text'], 'source_reference': record['source']['reference'],
                    'approved_by': ('Workspace review by ' + review['reviewer'] + ' on ' + review['created'])
                    if review and review['decision'] == 'approved' else ''}
        kit = {'schema': 'tjl.procurement-template-kit.v1', 'status': 'PINNED_IMPLEMENTATION_REVISION',
               'source': json.loads((ROOT / 'template-kit.json').read_text())['source'], 'templates': templates}
        context = {'schema': 'tjl.procurement-template-context.v1', 'mode': doc['mode'],
                   'fields': {k: v for k, v in doc['fields'].items() if k in fields}, 'clauses': clauses}
        return kit, context, records

    def readiness(self, db, project, saved):
        kit, context, records = self.material(db, project, saved)
        missing = sorted({'field:' + key for t in kit['templates'] for key in (*BASE_FIELDS, *t['required_fields'])
                          if not context['fields'].get(key, '').strip()} |
                         {'clause:' + key for t in kit['templates'] for key in t['approved_clause_keys']
                          if key not in context['clauses'] or not context['clauses'][key]['approved_by']})
        pending = [r['kind'] + ':' + r['key'] + '@' + str(r['revision']) for r in records
                   if not r['review'] or r['review']['decision'] != 'approved']
        updates = [r['kind'] + ':' + r['key'] for r in records if db.execute(
            'SELECT MAX(revision) FROM library WHERE kind=? AND key=?', (r['kind'], r['key'])).fetchone()[0] > r['revision']]
        stages = []
        for stage in saved['document']['workflow']:
            row = db.execute('SELECT * FROM reviews WHERE project=? AND revision=? AND stage=? ORDER BY id DESC LIMIT 1',
                             (project, saved['revision'], stage['id'])).fetchone()
            stages.append(stage | {'review': dict(row) if row else None})
        approved = all(s['review'] and s['review']['decision'] == 'approved' for s in stages)
        return {'missing': missing, 'library_reviews_needed': pending, 'newer_library_versions': updates,
                'stages': stages, 'content_complete': not missing and not pending,
                'ready_to_release': not missing and not pending and approved}

    def review_project(self, actor, project, value):
        require(value.get('decision') in ('approved', 'changes_requested'), 'Choose a review decision')
        text(value.get('note'), 'the decision note')
        with self.db(True) as db:
            row, _ = self.project_row(db, actor, project, ('reviewer',))
            require(row['revision'] == value.get('revision'), 'The project changed. Review its current revision.', 409)
            saved = self.revision(db, project, row['revision'])
            ready = self.readiness(db, project, saved)
            stage = next((s for s in ready['stages'] if s['id'] == value.get('stage')), None)
            require(stage, 'Choose a configured approval stage')
            require(not stage['reviewers'] or actor['id'] in stage['reviewers'], 'This stage is assigned to another reviewer', 403)
            if value['decision'] == 'approved':
                require(ready['content_complete'], 'Complete source fields and pinned library reviews first', 409, ready)
                for previous in ready['stages']:
                    if previous['id'] == stage['id']:
                        break
                    require(previous['review'] and previous['review']['decision'] == 'approved', 'Complete earlier approval stages first', 409)
            db.execute('INSERT INTO reviews(project,revision,stage,reviewer,decision,note,created) VALUES(?,?,?,?,?,?,?)',
                (project, row['revision'], stage['id'], actor['id'], value['decision'], value['note'], now()))
            db.execute('UPDATE projects SET state=?,updated=? WHERE id=?',
                ('reviewed' if self.readiness(db, project, saved)['ready_to_release'] else 'in_review', now(), project))
            self.event(db, actor, 'project_review', {k: value[k] for k in ('revision', 'stage', 'decision')}, project)
        return self.project(actor, project)

    def preview(self, actor, project, revision=None):
        with self.db() as db:
            row, _ = self.project_row(db, actor, project)
            saved = self.revision(db, project, revision if revision is not None else row['revision'])
            kit, context, _ = self.material(db, project, saved)
        with tempfile.TemporaryDirectory(prefix='preview-', dir=self.root / 'temporary') as temporary:
            root = Path(temporary)
            (root / 'kit.json').write_text(canonical(kit))
            (root / 'context.json').write_text(canonical(context))
            compiler({'operation': 'render', 'options': {'kitPath': str(root / 'kit.json'),
                'contextPath': str(root / 'context.json'), 'outPath': str(root / 'rendered')}})
            result = json.loads((root / 'rendered/configuration-map.json').read_text())
            return {'revision': saved['revision'], 'map': result,
                    'documents': {t['id']: (root / 'rendered' / t['file']).read_text() for t in result['templates']}}

    def lifecycle(self, actor, project, value):
        note = text(value.get('note'), 'the lifecycle reason', 2000)
        action = value.get('action')
        require(action in ('archive', 'reopen', 'amend'), 'Choose archive, reopen or amend')
        with self.db(True) as db:
            row, _ = self.project_row(db, actor, project, ('author', 'reviewer'))
            require(row['revision'] == value.get('revision'), 'Reopen the current project revision', 409)
            if action == 'archive':
                db.execute('UPDATE projects SET state=\'archived\',updated=? WHERE id=?', (now(), project))
            else:
                doc = deepcopy(self.revision(db, project, row['revision'])['document'])
                if action == 'amend':
                    release = db.execute('SELECT * FROM releases WHERE project=? AND id=?', (project, value.get('release_id'))).fetchone()
                    require(release, 'Choose the exact released parent', 404)
                    doc = deepcopy(self.revision(db, project, release['revision'])['document'])
                    doc['parent_release'] = release['id']
                    doc['fields']['parent_solicitation_id'] = doc['fields'].get('solicitation_id', '')
                    if not any(t['key'] == 'addendum-and-qa' for t in doc['templates']):
                        template = self.library_record(db, 'template', 'addendum-and-qa')
                        doc['templates'].append({'key': template['key'], 'revision': template['revision'], 'visibility': 'internal'})
                    for key in ('addendum_number', 'issue_date', 'change_summary', 'qa_responses', 'revised_deadlines', 'acknowledgment_instructions'):
                        doc['fields'][key] = ''
                self.validate_document(db, doc, project)
                revision = row['revision'] + 1
                db.execute('INSERT INTO revisions VALUES(?,?,?,?,?,?,?)', (project, revision, canonical(doc), sha(canonical(doc)), actor['id'], note, now()))
                db.execute('UPDATE projects SET state=\'draft\',revision=?,updated=? WHERE id=?', (revision, now(), project))
            self.event(db, actor, action, {'note': note, 'parent_release': value.get('release_id')}, project)
        return self.project(actor, project)

    def file(self, actor, file_id):
        with self.db() as db:
            row = db.execute('SELECT * FROM files WHERE id=?', (file_id,)).fetchone()
            require(row, 'File not found', 404)
            if row['project']:
                self.project_row(db, actor, row['project'])
            result = dict(row)
        path = self.root / 'blobs' / result['hash']
        require(path.is_file() and path.stat().st_size == result['bytes'], 'The retained file is unavailable', 500)
        return path, result

    @staticmethod
    def write_json(path, value):
        path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
        os.chmod(path, 0o600)

    @staticmethod
    def zip_directory(source, output):
        manifest = {}
        for path in sorted(source.rglob('*')):
            if path.is_file():
                manifest[path.relative_to(source).as_posix()] = {'bytes': path.stat().st_size, 'sha256': sha(path.read_bytes())}
        Workspace.write_json(source / 'MANIFEST.json', {'schema': 'tjl.template-delivery-manifest.v1', 'files': manifest})
        with zipfile.ZipFile(output, 'x', compression=zipfile.ZIP_DEFLATED) as archive:
            for name in (*manifest, 'MANIFEST.json'):
                archive.write(source / name, name)
        os.chmod(output, 0o600)
        return sha(output.read_bytes())

    def freeze(self, actor, project, value):
        with self.release_lock:
            with self.db() as db:
                row, _ = self.project_row(db, actor, project, ('author', 'reviewer'))
                requested = value.get('revision')
                require(requested == row['revision'], 'The project changed. Freeze the reviewed current revision.', 409)
                previous = db.execute('SELECT * FROM releases WHERE project=? AND revision=?', (project, requested)).fetchone()
                if previous:
                    return dict(previous) | {'replayed': True}
                require(row['state'] != 'archived', 'Reopen the archived project before creating a release', 409)
                saved = self.revision(db, project, requested)
                ready = self.readiness(db, project, saved)
                require(ready['ready_to_release'], 'Complete the current revision and its configured reviews', 409, ready)
                kit, context, records = self.material(db, project, saved)
                review_hash = sha(canonical([r['review'] for r in records]) + canonical(ready['stages']))
                doc = saved['document']
                attachments = []
                for selected in doc['attachments']:
                    f = dict(db.execute('SELECT * FROM files WHERE id=?', (selected['id'],)).fetchone())
                    attachments.append(f | {'visibility': selected['visibility'], 'templates': selected.get('templates', [])})
                members = [dict(r) for r in db.execute('SELECT user_id,role FROM members WHERE project=?', (project,))]
            release_id = ident()
            directory = self.root / 'releases' / release_id
            directory.mkdir(mode=0o700)
            committed = False
            try:
                with tempfile.TemporaryDirectory(prefix='release-', dir=self.root / 'temporary') as temporary:
                    root = Path(temporary)
                    self.write_json(root / 'selected-kit.json', kit)
                    self.write_json(root / 'project-context.json', context)
                    compiler({'operation': 'render', 'options': {'kitPath': str(root / 'selected-kit.json'),
                        'contextPath': str(root / 'project-context.json'), 'outPath': str(root / 'internal')}})
                    internal, public = root / 'internal', root / 'public'
                    public.mkdir(mode=0o700)
                    manifest = json.loads((internal / 'configuration-map.json').read_text())
                    require(manifest['unresolvedCount'] == 0, 'The original compiler found unresolved content', 409)
                    self.write_json(internal / 'selected-kit.json', kit)
                    self.write_json(internal / 'project-context.json', context)
                    self.write_json(internal / 'project-revision.json', saved)
                    self.write_json(internal / 'library-revisions.json', records)
                    self.write_json(internal / 'approval-and-role-map.json', {'stages': ready['stages'], 'members': members})
                    self.write_json(internal / 'attachment-register.json', attachments)
                    public_ids = {t['key'] for t in doc['templates'] if t['visibility'] == 'public'}
                    for t in manifest['templates']:
                        if t['id'] in public_ids:
                            shutil.copyfile(internal / t['file'], public / t['file'])
                    public_attachments = []
                    for selected in attachments:
                        if selected['visibility'] == 'withheld':
                            continue
                        path = self.root / 'blobs' / selected['hash']
                        require(path.is_file() and sha(path.read_bytes()) == selected['hash'], 'Attachment content changed: ' + selected['name'], 500)
                        relative = Path('attachments') / (selected['id'] + '-' + selected['name'])
                        (internal / relative).parent.mkdir(exist_ok=True)
                        shutil.copyfile(path, internal / relative)
                        if selected['visibility'] == 'public' and (not selected.get('templates') or public_ids.intersection(selected['templates'])):
                            (public / relative).parent.mkdir(exist_ok=True)
                            shutil.copyfile(path, public / relative)
                            public_attachments.append({k: selected[k] for k in ('id', 'name', 'hash', 'bytes')})
                    stamp = now()
                    common = {'schema': 'tjl.template-release.v1', 'id': release_id, 'project': project,
                        'revision': requested, 'document_hash': saved['hash'], 'parent_release': doc.get('parent_release'),
                        'mode': doc['mode'], 'created': stamp}
                    self.write_json(internal / 'release.json', common | {'purpose': 'Reviewed implementation handover',
                        'native_configuration': 'Record the actual selected-platform IDs and mappings after the operator transfer.'})
                    self.write_json(public / 'release.json', common | {'purpose': 'Selected publication copy for the authorized operator',
                        'templates': sorted(public_ids), 'attachments': public_attachments})
                    (public / 'READ-ME.txt').write_text('This copy contains only the templates and attachments explicitly selected for public handling.\n'
                        'The responsible operator completes publication through the selected platform and records its actual native IDs.\n')
                    internal_sha = self.zip_directory(internal, directory / 'implementation.zip')
                    public_sha = self.zip_directory(public, directory / 'publication-copy.zip')
                with self.db(True) as db:
                    current, _ = self.project_row(db, actor, project, ('author', 'reviewer'))
                    require(current['revision'] == requested and current['state'] != 'archived', 'The project changed during compilation. Reopen the current revision.', 409)
                    previous = db.execute('SELECT * FROM releases WHERE project=? AND revision=?', (project, requested)).fetchone()
                    if previous:
                        return dict(previous) | {'replayed': True}
                    refreshed = self.readiness(db, project, saved)
                    _, _, refreshed_records = self.material(db, project, saved)
                    require(refreshed['ready_to_release'] and review_hash == sha(canonical([r['review'] for r in refreshed_records]) + canonical(refreshed['stages'])),
                        'An approval changed during compilation. Review the current decisions.', 409)
                    db.execute('INSERT INTO releases VALUES(?,?,?,?,?,?,?,?,?)', (release_id, project, requested,
                        doc.get('parent_release'), saved['hash'], internal_sha, public_sha, stamp, actor['id']))
                    db.execute('UPDATE projects SET state=\'released\',updated=? WHERE id=?', (stamp, project))
                    self.event(db, actor, 'release_frozen', {'id': release_id, 'revision': requested, 'internal_sha': internal_sha, 'public_sha': public_sha}, project)
                    result = dict(db.execute('SELECT * FROM releases WHERE id=?', (release_id,)).fetchone())
                committed = True
                return result
            finally:
                if not committed:
                    shutil.rmtree(directory, ignore_errors=True)

    def release_file(self, actor, release_id, kind):
        require(kind in ('implementation', 'publication-copy'), 'Choose a release download')
        with self.db() as db:
            row = db.execute('SELECT * FROM releases WHERE id=?', (release_id,)).fetchone()
            require(row, 'Release not found', 404)
            self.project_row(db, actor, row['project'])
            expected = row['internal_sha'] if kind == 'implementation' else row['public_sha']
        path = self.root / 'releases' / release_id / (kind + '.zip')
        require(path.is_file() and sha(path.read_bytes()) == expected, 'The release file is unavailable or changed', 500)
        return path, {'name': release_id + '-' + kind + '.zip', 'mime': 'application/zip', 'hash': expected}

    def record_adoption(self, actor, project, value):
        with self.db(True) as db:
            self.project_row(db, actor, project, ('author', 'reviewer'))
            release = db.execute('SELECT * FROM releases WHERE id=? AND project=?', (value.get('release_id'), project)).fetchone()
            require(release, 'Choose the original frozen release', 404)
            saved = self.revision(db, project, release['revision'])
            selected = next((t for t in saved['document']['templates'] if t['key'] == value.get('template')), None)
            require(selected, 'Choose a template in the frozen release')
            template = self.library_record(db, 'template', selected['key'], selected['revision'])['payload']
            record = {k: value.get(k) for k in ('kind', 'platform', 'environment', 'native_project', 'module', 'native_id', 'operator', 'decision',
                                               'note', 'field_map', 'clause_map', 'attachment_map', 'role_map', 'evidence_file')}
            require(record['kind'] in ('native_configuration', 'internal_exercise'), 'Identify native configuration or internal exercise')
            require(record['decision'] in ('recorded', 'accepted', 'changes_requested'), 'Choose an adoption decision')
            for key in ('platform', 'environment', 'native_project', 'module', 'native_id', 'operator', 'note'):
                text(record[key], 'the ' + key.replace('_', ' '), 50000 if key == 'note' else 2000)
            expected = {'field_map': set(BASE_FIELDS) | set(template['required_fields']),
                'clause_map': set(template['approved_clause_keys']),
                'attachment_map': {a['id'] for a in saved['document']['attachments']
                    if not a.get('templates') or selected['key'] in a['templates']},
                'role_map': {stage['id'] for stage in saved['document']['workflow']}}
            for key, required in expected.items():
                mapping = record[key]
                require(isinstance(mapping, dict) and set(mapping) == required, 'Record every original ' + key.replace('_', ' ') + ' entry', detail={'expected': sorted(required)})
                for entry in mapping.values():
                    text(entry, 'the actual native mapping or explicit retained handling', 2000)
            if record['evidence_file']:
                require(db.execute('SELECT 1 FROM files WHERE id=? AND project=?', (record['evidence_file'], project)).fetchone(), 'Choose a retained project evidence file')
            if record['decision'] == 'accepted':
                self.project_row(db, actor, project, ('reviewer',))
                require(record['evidence_file'], 'Retain the original native review/export used for acceptance')
            adoption_id = ident()
            db.execute('INSERT INTO adoptions VALUES(?,?,?,?,?,?)', (adoption_id, release['id'], selected['key'], canonical(record), actor['id'], now()))
            self.event(db, actor, 'native_handover_recorded', {'id': adoption_id, 'release': release['id'], 'template': selected['key'],
                'kind': record['kind'], 'decision': record['decision']}, project)
        return self.project(actor, project)

    def accepted_handover(self, actor, release_id):
        with self.db() as db:
            release = db.execute('SELECT * FROM releases WHERE id=?', (release_id,)).fetchone()
            require(release, 'Release not found', 404)
            self.project_row(db, actor, release['project'], ('author', 'reviewer'))
            saved = self.revision(db, release['project'], release['revision'])
            records, evidence = [], {}
            for selected in saved['document']['templates']:
                row = db.execute('SELECT * FROM adoptions WHERE release_id=? AND template=? ORDER BY created DESC,id DESC LIMIT 1',
                                 (release_id, selected['key'])).fetchone()
                require(row and json.loads(row['record'])['decision'] == 'accepted', 'Complete the selected template handovers first: ' + selected['key'], 409)
                record = dict(row) | {'record': json.loads(row['record'])}
                records.append(record)
                f = db.execute('SELECT * FROM files WHERE id=?', (record['record']['evidence_file'],)).fetchone()
                require(f, 'Retained acceptance evidence is unavailable', 500)
                evidence[f['id']] = dict(f)
        temporary = tempfile.TemporaryDirectory(prefix='handover-', dir=self.root / 'temporary')
        try:
            root = Path(temporary.name)
            package = root / 'package'
            package.mkdir(mode=0o700)
            source, _ = self.release_file(actor, release_id, 'implementation')
            shutil.copyfile(source, package / 'original-implementation.zip')
            self.write_json(package / 'accepted-handover.json', {'schema': 'tjl.template-handover.v1', 'release': dict(release),
                'kind': 'native_configuration' if all(r['record']['kind'] == 'native_configuration' for r in records) else 'includes_internal_exercise',
                'templates': records})
            for file_id, f in evidence.items():
                path = self.root / 'blobs' / f['hash']
                require(sha(path.read_bytes()) == f['hash'], 'Acceptance evidence hash changed', 500)
                (package / 'evidence').mkdir(exist_ok=True)
                shutil.copyfile(path, package / 'evidence' / (file_id + '-' + f['name']))
            output = root / 'accepted-handover.zip'
            self.zip_directory(package, output)
            return output, temporary
        except BaseException:
            temporary.cleanup()
            raise

    def export_workspace(self, actor):
        require(actor['role'] == 'admin', 'Administrator access is required', 403)
        temporary = tempfile.TemporaryDirectory(prefix='workspace-export-', dir=self.root / 'temporary')
        try:
            root = Path(temporary.name)
            data = root / 'workspace'
            data.mkdir(mode=0o700)
            with self.db() as db:
                target = sqlite3.connect(data / 'workspace.sqlite3')
                try:
                    db.backup(target)
                    # Portable business history carries names and attribution,
                    # but never reusable credentials or browser sessions.
                    target.execute('DELETE FROM sessions')
                    target.execute('DELETE FROM login_attempts')
                    target.execute("UPDATE users SET salt='',password_hash='',active=0")
                    target.commit()
                finally:
                    target.close()
                blobs = {r['hash'] for r in db.execute('SELECT DISTINCT hash FROM files')}
                releases = [dict(r) for r in db.execute('SELECT * FROM releases')]
            (data / 'blobs').mkdir()
            for digest in blobs:
                path = self.root / 'blobs' / digest
                require(sha(path.read_bytes()) == digest, 'Retained source content changed', 500)
                shutil.copyfile(path, data / 'blobs' / digest)
            for release in releases:
                destination = data / 'releases' / release['id']
                destination.mkdir(parents=True)
                for name, digest in (('implementation', release['internal_sha']), ('publication-copy', release['public_sha'])):
                    path = self.root / 'releases' / release['id'] / (name + '.zip')
                    require(sha(path.read_bytes()) == digest, 'Retained release content changed', 500)
                    shutil.copyfile(path, destination / path.name)
            (data / 'RESTORE.txt').write_text('Private business records. Run python3 -m workspace --data <new-directory> restore --archive <this.zip>.\n'
                'All browser sessions and reusable passwords are removed. Existing operator names remain for attribution; an administrator resets access explicitly.\n')
            output = root / 'workspace-transfer.zip'
            self.zip_directory(data, output)
            return output, temporary
        except BaseException:
            temporary.cleanup()
            raise

    def reset_access(self, name, password):
        text(password, 'a password of at least16 characters', 2000)
        require(len(password) >= 16, 'Use at least16 characters')
        salt = secrets.token_hex(16)
        encoded = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1).hex()
        with self.db(True) as db:
            row = db.execute('SELECT id FROM users WHERE name=?', (name,)).fetchone()
            require(row, 'Operator name not found', 404)
            db.execute('UPDATE users SET salt=?,password_hash=?,active=1 WHERE id=?', (salt, encoded, row['id']))
            db.execute('DELETE FROM sessions WHERE user_id=?', (row['id'],))
            db.execute('DELETE FROM login_attempts WHERE name=?', (name,))
            self.event(db, {'id': row['id']}, 'local_access_reset', {})

    def update_user(self, actor, user_id, value):
        require(actor['role'] == 'admin', 'Administrator access is required', 403)
        require(value.get('role') in ROLES and isinstance(value.get('active'), bool), 'Choose the operator role and access state')
        with self.db(True) as db:
            row = db.execute('SELECT * FROM users WHERE id=?', (user_id,)).fetchone()
            require(row, 'Operator not found', 404)
            if row['role'] == 'admin' and row['active'] and (value['role'] != 'admin' or not value['active']):
                require(db.execute("SELECT COUNT(*) FROM users WHERE role='admin' AND active=1").fetchone()[0] > 1,
                        'Keep an active administrator for workspace access', 409)
            db.execute('UPDATE users SET role=?,active=? WHERE id=?', (value['role'], int(value['active']), user_id))
            db.execute('DELETE FROM sessions WHERE user_id=?', (user_id,))
            self.event(db, actor, 'operator_access_changed', {'user': user_id, **value})
        return {'updated': user_id}

    @staticmethod
    def restore(archive_path, destination):
        destination = Path(destination).resolve()
        require(not destination.exists(), 'Restore to a new directory so existing work is preserved', 409)
        destination.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='.workspace-restore-', dir=destination.parent) as temporary:
            root = Path(temporary) / 'workspace'
            root.mkdir(mode=0o700)
            with zipfile.ZipFile(archive_path) as archive:
                names = archive.namelist()
                require(len(names) == len(set(names)) and 'MANIFEST.json' in names, 'Use a complete workspace transfer')
                manifest = json.loads(archive.read('MANIFEST.json'))
                require(manifest.get('schema') == 'tjl.template-delivery-manifest.v1' and set(names) == set(manifest['files']) | {'MANIFEST.json'}, 'The transfer manifest does not match')
                for name, expected in manifest['files'].items():
                    relative = Path(name)
                    require(not relative.is_absolute() and '..' not in relative.parts and '\\' not in name, 'Invalid transfer path')
                    require(name in ('workspace.sqlite3', 'RESTORE.txt') or name.startswith(('blobs/', 'releases/')), 'Unexpected workspace transfer content')
                    info = archive.getinfo(name)
                    require(info.file_size == expected['bytes'] and info.file_size <= 1024 * 1024 * 1024, 'Transfer file size differs')
                    target = root / relative
                    target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                    digest = hashlib.sha256()
                    with archive.open(name) as src, target.open('xb') as dst:
                        os.chmod(target, 0o600)
                        for chunk in iter(lambda: src.read(65536), b''):
                            dst.write(chunk)
                            digest.update(chunk)
                    require(digest.hexdigest() == expected['sha256'], 'Transfer file hash differs: ' + name)
            db = sqlite3.connect(root / 'workspace.sqlite3')
            try:
                require(db.execute('PRAGMA quick_check').fetchone()[0] == 'ok', 'The retained workspace database is damaged')
                require(not db.execute('PRAGMA foreign_key_check').fetchall(), 'The retained workspace has broken references')
                db.execute('DELETE FROM sessions')
                db.execute('DELETE FROM login_attempts')
                db.execute("UPDATE users SET active=0,salt='',password_hash=''")
                db.commit()
            finally:
                db.close()
            os.rename(root, destination)
        return {'restored': str(destination), 'access': 'Reset an original administrator with reset-access before sign-in.'}
