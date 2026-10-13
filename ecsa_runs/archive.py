"""Complete portable workspace export and create-only verified receiving."""
from __future__ import annotations
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import tempfile
import uuid
import zipfile
from .store import RunStore, check_sha


def _references(store: RunStore, db: Path) -> set[str]:
    con = sqlite3.connect(db)
    try:
        jobs = con.execute('SELECT spec_sha,result_sha FROM jobs').fetchall()
        retained = con.execute("SELECT value FROM settings WHERE key LIKE 'retention:%'").fetchall()
        project = con.execute("SELECT value FROM settings WHERE key='project_sha'").fetchone()
    finally: con.close()
    refs = set()
    for (descriptor_sha,) in retained:
        refs.add(descriptor_sha)
        descriptor = store.read(descriptor_sha)
        for field in ('retained_result_sha256','retained_input_sha256','retained_artifacts_sha256'):
            refs.add(descriptor[field])
        refs.update(f['sha256'] for f in store.read(descriptor['retained_input_sha256'])['files'])
        if 'retained_native_tree_sha256' in descriptor:
            refs.add(descriptor['retained_native_tree_sha256'])
            refs.update(f['sha256'] for f in store.read(descriptor['retained_native_tree_sha256'])['files'])
        for artifact in store.read(descriptor['retained_artifacts_sha256']):
            refs.update(f['sha256'] for f in artifact['files'])
    for spec_sha, result_sha in jobs:
        refs.add(spec_sha)
        if result_sha:
            refs.add(result_sha)
            result = store.read(result_sha)
            for artifact in result.get('_ecsa_execution', {}).get('result_artifacts', []):
                refs.update(f['sha256'] for f in artifact['files'])
        spec = store.read(spec_sha)
        refs.add(spec['snapshot_sha'])
        snapshot = store.read(spec['snapshot_sha'])
        refs.update(f['sha256'] for f in snapshot['files'])
        refs.update(f['sha256'] for f in spec.get('file_bindings', []))
    if project:
        refs.add(project[0])
        meta = store.read(project[0])
        if meta.get('provider_snapshot'):
            refs.add(meta['provider_snapshot'])
            refs.update(f['sha256'] for f in store.read(meta['provider_snapshot'])['files'])
    return refs


def export_workspace(store: RunStore, output: str | Path) -> dict:
    """SQLite online backup establishes one consistent edition while jobs continue."""
    output = Path(output).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    if output.exists(): raise FileExistsError(output)
    with tempfile.TemporaryDirectory(dir=output.parent) as tmp:
        tmp = Path(tmp)
        db = tmp / 'runs.sqlite3'
        with store.connection() as con:
            copy = sqlite3.connect(db)
            try: con.backup(copy)
            finally: copy.close()
        refs = _references(store, db)
        manifest = {'format': 'ecsa-workspace-v1', 'files': []}
        zip_path = tmp / 'workspace.ecsar'
        with zipfile.ZipFile(zip_path, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6, allowZip64=True) as z:
            for name, path in [('runs.sqlite3', db)] + [('blobs/'+sha, store.blob_path(sha)) for sha in sorted(refs)]:
                h, size = hashlib.sha256(), 0
                with path.open('rb') as src, z.open(name, 'w', force_zip64=True) as dst:
                    while chunk := src.read(1024*1024): dst.write(chunk); h.update(chunk); size += len(chunk)
                sha = h.hexdigest()
                if name.startswith('blobs/') and name[6:] != sha: raise ValueError(f'Corrupt source blob {name}')
                manifest['files'].append({'path': name, 'sha256': sha, 'bytes': size})
            # Complete per-attempt logs are optional mutable diagnostics, not inputs.
            for path in sorted((store.root/'logs').glob('*.log')):
                raw = path.read_bytes()
                name = 'logs/' + path.name
                z.writestr(name, raw)
                manifest['files'].append({'path': name, 'sha256': hashlib.sha256(raw).hexdigest(), 'bytes': len(raw)})
            z.writestr('MANIFEST.json', json.dumps(manifest, indent=2, sort_keys=True))
        # link is create-only and atomic on the output filesystem, unlike replace.
        os.link(zip_path, output)
    return manifest


def receive_workspace(source: str | Path, destination: str | Path, max_bytes: int = 64*1024**3) -> RunStore:
    """Verify every byte and schema before creating the destination; never overwrite."""
    destination = Path(destination).resolve()
    if destination.exists(): raise FileExistsError(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=destination.parent) as tmp:
        tmp = Path(tmp)
        with zipfile.ZipFile(source) as z:
            names = z.namelist()
            if len(names) != len(set(names)): raise ValueError('Duplicate archive members')
            info = z.getinfo('MANIFEST.json')
            if info.file_size > 64*1024**2: raise ValueError('Manifest too large')
            manifest = json.loads(z.read('MANIFEST.json'))
            if manifest.get('format') != 'ecsa-workspace-v1': raise ValueError('Unsupported archive')
            files = manifest['files']
            if len(files) != len({f['path'] for f in files}): raise ValueError('Duplicate manifest entries')
            if set(names) != {'MANIFEST.json'} | {f['path'] for f in files}: raise ValueError('Archive/manifest mismatch')
            if sum(f['bytes'] for f in files) > max_bytes: raise ValueError('Archive exceeds receiving byte limit')
            for item in files:
                name = item['path']
                # Only the three documented namespaces can be written.
                valid = name == 'runs.sqlite3' or (name.startswith('blobs/') and len(name) == 70) or (
                    name.startswith('logs/') and name.count('/') == 1 and name.endswith('.log'))
                if not valid or '..' in name or '\\' in name: raise ValueError(f'Unsafe archive path {name}')
                if name.startswith('blobs/'): check_sha(name[6:])
                if item['bytes'] < 0 or z.getinfo(name).file_size != item['bytes']: raise ValueError('Length mismatch')
                target = tmp / name
                target.parent.mkdir(parents=True, exist_ok=True)
                h, size = hashlib.sha256(), 0
                with z.open(name) as src, target.open('xb') as dst:
                    while chunk := src.read(1024*1024): dst.write(chunk); h.update(chunk); size += len(chunk)
                if size != item['bytes'] or h.hexdigest() != item['sha256']: raise ValueError(f'Hash mismatch: {name}')
                if name.startswith('blobs/') and item['sha256'] != name[6:]: raise ValueError('Invalid content address')
        # Validate the database before RunStore has any opportunity to execute schema.
        con = sqlite3.connect(tmp/'runs.sqlite3')
        try:
            objects = list(con.execute("SELECT type,name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'"))
            if any(t not in ('table','index') for t,n in objects): raise ValueError('Unexpected executable database objects')
            if con.execute('PRAGMA integrity_check').fetchone()[0] != 'ok': raise ValueError('Invalid SQLite backup')
            schema = con.execute("SELECT value FROM settings WHERE key='schema'").fetchone()
            if not schema or schema[0] != '1': raise ValueError('Unsupported workspace schema')
        finally: con.close()
        restored = RunStore(tmp)
        refs = _references(restored, restored.db)
        for sha in refs: restored.verify_blob(sha)
        # The imported branch owns new leases, never the sender's still-running work.
        with restored.transaction() as con:
            rows = con.execute("SELECT id,state FROM jobs WHERE state IN ('running','cancelling')").fetchall()
            for row in rows:
                state = 'cancelled' if row['state'] == 'cancelling' else 'queued'
                con.execute("UPDATE jobs SET state=?,lease_token=NULL,lease_owner=NULL,lease_until=NULL,max_attempts=max(max_attempts,attempt+1) WHERE id=?", (state,row['id']))
                restored._event(con, row['id'], 'received_for_resume', {'state': state})
            con.execute("INSERT INTO settings VALUES('received_branch_id',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (uuid.uuid4().hex,))
        with restored.connection() as con: con.execute('PRAGMA wal_checkpoint(TRUNCATE)')
        # Reserve destination atomically, then place known regular files inside it.
        destination.mkdir(exist_ok=False)
        try:
            for entry in tmp.iterdir(): shutil.move(str(entry), destination / entry.name)
        except BaseException:
            shutil.rmtree(destination)
            raise
    return RunStore(destination)
