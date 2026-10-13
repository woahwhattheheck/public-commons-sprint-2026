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


# Admit only the published, reviewed 1.0.0 -> receiving-race template upgrade.
# Every other source mismatch remains protected by the original installer.
UPGRADES = {
    'source_tools/paired_spatial_review.html': (
        'e9f13ed71ef17b295dbc573ca5e7b4e4624ee891676faa76c8431b8647ead7ff',
        '7af6853aa0f99a97823c6d75fa86006a72ca665a7c56f522131483ab9acc3037',
    ),
}


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
        previous=target.read_bytes() if target.exists() else None
        if previous is not None and previous!=body:
            admitted=UPGRADES.get(name)==(sha(previous),sha(body))
            if name=='source_tools/install_paired_spatial_review.py':
                admitted=(sha(previous)=='699d8af00558759453551595a85a8eb69a4a65c2791f2ff1c594641c3b1e9ac6'
                          and body==Path(__file__).resolve(strict=True).read_bytes())
            if not admitted:
                raise ValueError('Preserving a divergent existing contribution: '+name)
        leaves.append((name,body,previous))
    operations=[]
    for name,body,previous in leaves:
        operations.append({'path':name,'sha256':sha(body),'status':write(app/name,body,expected=previous)})
    return {'schema':'upstate.paired-spatial-installation/v1','application':str(app),'files':operations}


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--application',required=True)
    p.add_argument('--source',default=str(Path(__file__).resolve().parent.parent));a=p.parse_args()
    try:print(json.dumps(install(a.application,a.source),indent=2));return 0
    except (OSError,ValueError) as exc:print(str(exc));return 2

if __name__=='__main__':raise SystemExit(main())
