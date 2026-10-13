"""Read the original Eco registry; never create a parallel job/model writer."""
from __future__ import annotations
import sqlite3
from contextlib import contextmanager
from pathlib import Path, PurePosixPath
from typing import Any
from .common import IntelligenceError, loads, public_metadata, digest, file_digest

TABLES = {'dataset': 'datasets', 'job': 'jobs', 'aoi': 'aois', 'ensemble': 'ensembles'}

class Repository:
    def __init__(self, db_path: Path, data_root: Path):
        self.db_path, self.data_root = Path(db_path).resolve(), Path(data_root).resolve()

    @contextmanager
    def db(self):
        if not self.db_path.is_file():
            raise IntelligenceError('Original Eco registry is not initialized.', 503)
        db = sqlite3.connect(self.db_path.as_uri() + '?mode=ro', uri=True, timeout=30)
        db.row_factory = sqlite3.Row
        try:
            yield db
        finally:
            db.close()

    @staticmethod
    def decode(row: dict) -> dict:
        return {k[:-5] if k.endswith('_json') else k:
                loads(v, {}) if k.endswith('_json') else v for k, v in row.items()}

    def row(self, tenant: str, kind: str, object_id: str) -> dict:
        if kind not in TABLES:
            raise IntelligenceError('Unknown registered object kind.')
        with self.db() as db:
            try:
                row = db.execute(f'SELECT * FROM {TABLES[kind]} WHERE tenant_id=? AND id=?', (tenant, object_id)).fetchone()
            except sqlite3.OperationalError as exc:
                raise IntelligenceError(f'Original registry does not expose {kind} records.', 503) from exc
        if row is None:
            raise IntelligenceError('Registered object not found for tenant.', 404)
        return self.decode(dict(row))

    def inventory(self, tenant: str) -> dict:
        result: dict[str, Any] = {'tenant_id': tenant, 'counts': {}}
        with self.db() as db:
            existing = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            for kind, table in TABLES.items():
                rows = [] if table not in existing else db.execute(
                    f'SELECT * FROM {table} WHERE tenant_id=? ORDER BY created_at DESC, id', (tenant,)).fetchall()
                result[table] = [public_metadata(self.decode(dict(r))) for r in rows]
                result['counts'][table] = len(rows)
        return result

    def path(self, tenant: str, ref: dict) -> tuple[Path, dict]:
        kind = ref.get('kind')
        if kind == 'dataset':
            row = self.row(tenant, kind, str(ref.get('id', '')))
            path = Path(row['path']).expanduser()
            if not path.is_absolute():
                path = self.data_root / path
            path = path.resolve()
            metadata = row.get('metadata') or {}
        elif kind == 'artifact':
            row = self.row(tenant, 'job', str(ref.get('id', '')))
            if not row.get('output_dir'):
                raise IntelligenceError('Job has no output directory yet.', 409)
            root = Path(row['output_dir'])
            if not root.is_absolute():
                root = self.data_root / root
            root = root.resolve()
            member = PurePosixPath(str(ref.get('member', '')))
            if member.is_absolute() or not member.parts or '..' in member.parts or '\\' in str(member):
                raise IntelligenceError('Artifact member must be a relative file name.')
            path = (root / str(member)).resolve()
            if not path.is_relative_to(root):
                raise IntelligenceError('Artifact is outside the registered job output.', 403)
            metadata = {'job_id': row['id'], 'model': row.get('model'), 'status': row.get('status')}
        else:
            raise IntelligenceError('A dataset ID or a registered job artifact is required.')
        if not path.is_file():
            raise IntelligenceError('Registered file is not present on this runtime.', 404)
        return path, public_metadata(metadata)

    def source(self, tenant: str, ref: dict) -> tuple[Path, dict]:
        path, metadata = self.path(tenant, ref)
        stat = path.stat()
        source = {'ref': ref, 'name': path.name, 'bytes': stat.st_size,
                  'sha256': file_digest(path), 'metadata': metadata}
        # GDAL/Fiona may consume registered companion metadata or masks.
        companions=[]
        candidates=[Path(str(path)+suffix) for suffix in ('.aux.xml','.msk','-wal')]
        if path.suffix.lower()=='.shp':
            candidates += [path.with_suffix(suffix) for suffix in ('.shx','.dbf','.prj','.cpg','.qix')]
        for companion in sorted(set(candidates)):
            if companion.is_file():
                companions.append({'name':companion.name,'bytes':companion.stat().st_size,'sha256':file_digest(companion)})
        source['companions']=companions
        return path, source

    def assert_unchanged(self, tenant: str, source: dict) -> None:
        _, current = self.source(tenant, source['ref'])
        if current['sha256'] != source['sha256'] or current['metadata'] != source['metadata'] or current.get('companions',[]) != source.get('companions',[]):
            raise IntelligenceError('Source changed during analysis. Refresh the investigation.', 409)

    def artifacts(self, tenant: str, job_id: str) -> dict:
        row = self.row(tenant, 'job', job_id)
        files = []
        if row.get('output_dir'):
            root = Path(row['output_dir'])
            if not root.is_absolute():
                root = self.data_root / root
            root = root.resolve()
            if root.is_dir():
                for path in sorted(root.rglob('*')):
                    if path.is_file() and path.resolve().is_relative_to(root):
                        files.append({'kind': 'artifact', 'id': job_id, 'member': path.relative_to(root).as_posix(),
                                      'bytes': path.stat().st_size})
        return {'job': public_metadata(row), 'files': files,
                'record_sha256': digest(public_metadata(row))}
