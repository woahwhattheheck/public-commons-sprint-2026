"""Install explicit spatial export beside the original paired report exporter.
Copyright 2026 TokenJunkieLabs. Run from the complete contribution source tree.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import tempfile

FILES = ('source_tools/paired_spatial_review.py', 'source_tools/paired_spatial_review.html',
         'source_tools/install_paired_spatial_review.py', 'docs/PAIRED_SPATIAL_REVIEW.md',
         'integration/component_fragments/paired-spatial-review.json')


def sha(body):return hashlib.sha256(body).hexdigest()


def write(path, body, expected=None):
    path.parent.mkdir(parents=True,exist_ok=True)
    if path.is_symlink():raise ValueError('Preserving symbolic link: '+str(path))
    before=path.read_bytes() if path.exists() else None
    if before==body:return 'unchanged'
    if before!=expected:raise ValueError('Source changed or differs: '+str(path))
    fd,name=tempfile.mkstemp(prefix='.spatial-install-',dir=path.parent)
    try:
        with os.fdopen(fd,'wb') as f:f.write(body);f.flush();os.fsync(f.fileno())
        if (path.read_bytes() if path.exists() else None)!=before:
            raise ValueError('Concurrent source edit: '+str(path))
        if expected is None:os.link(name,path)
        else:os.replace(name,path)
    finally:Path(name).unlink(missing_ok=True)
    return 'installed'


def install(application,source):
    app=Path(application).resolve(strict=True); source=Path(source).resolve(strict=True)
    report=app/'model/paired_ensemble/ensemble_report.py'
    native = report.read_text()
    if 'def export_reports(' not in native or "atomic(directory / 'reports.json', report)" not in native:
        raise ValueError('The maintained native paired report producer is required')
    # Preflight every leaf before making any source change.
    leaves=[]
    for name in FILES:
        body=(source/name).read_bytes();target=app/name
        if target.exists() and target.read_bytes()!=body:
            raise ValueError('Preserving a divergent existing contribution: '+name)
        leaves.append((name,body))
    operations=[]
    for name,body in leaves:
        operations.append({'path':name,'sha256':sha(body),'status':write(app/name,body)})
    return {'schema':'upstate.paired-spatial-installation/v1','application':str(app),'files':operations}


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--application',required=True)
    p.add_argument('--source',default=str(Path(__file__).resolve().parent.parent));a=p.parse_args()
    try:print(json.dumps(install(a.application,a.source),indent=2));return 0
    except (OSError,ValueError) as exc:print(str(exc));return 2

if __name__=='__main__':raise SystemExit(main())
