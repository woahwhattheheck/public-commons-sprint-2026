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
import sys

if __package__ in (None, ''):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from model import portable_fs as _fs

FILES = ('source_tools/paired_spatial_review.py', 'source_tools/paired_spatial_review.html',
         'source_tools/install_paired_spatial_review.py', 'docs/PAIRED_SPATIAL_REVIEW.md',
         'integration/component_fragments/paired-spatial-review.json',
         'model/portable_fs.py', 'model/windows_fs.py')


def sha(body):return hashlib.sha256(body).hexdigest()


# Exact original template and native-receiving source transitions only.
# Every other source mismatch remains protected by the original installer.
UPGRADES = {
    'source_tools/paired_spatial_review.py': ('9b552680f61c287d7c45d2047c3b7a1823365c209d9b3df4e4ad46c8ec282faa', '5ebce0960cbd348b1f2718073573cd31cffd7f079b7cbd8b8b6ce4674b179da1'),
    'docs/PAIRED_SPATIAL_REVIEW.md': ('0042e9200e4b797727ade07263ca3ac26e86b53bcefc4865ba5b9615202dce30', 'b4d721682c406e93a149bd023ae0a8108b255849cbf5a781e3a55f9d90af7d0f'),
    'integration/component_fragments/paired-spatial-review.json': ('94184547708d2f11c68cf5ec927747b4bde4f03dd3c0e93b5cc82c30e8784ee4', '393718c9ca49d6db0a7e405f0ee467d1a87541834be97648cc82b6d70c721d27'),
    'model/windows_fs.py': ('7bf6bf9095f4bc1823099d79b8bdad835f2808d8d407b0d165c6771d77422880', '7c3438102054836ac207b3555741287f24d058c457f1d4ca732cfe500d85e032'),
    'source_tools/paired_spatial_review.html': (
        'e9f13ed71ef17b295dbc573ca5e7b4e4624ee891676faa76c8431b8647ead7ff',
        '7af6853aa0f99a97823c6d75fa86006a72ca665a7c56f522131483ab9acc3037',
    ),
}


def write(path, body, expected=None):
    path = _fs.native_path(path)
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
        if expected is None:_fs.publish_file(_fs.native_path(name),path)
        else:_fs.replace(_fs.native_path(name),path)
        _fs.sync_directory(path.parent)
    finally:_fs.native_path(name).unlink(missing_ok=True)
    return 'installed'


def install(application,source):
    app=_fs.native_path(application).resolve(strict=True); source=_fs.native_path(source).resolve(strict=True)
    report=app/'model/paired_ensemble/ensemble_report.py'
    native = report.read_text(encoding='utf-8')
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
                admitted=(sha(previous) in {'699d8af00558759453551595a85a8eb69a4a65c2791f2ff1c594641c3b1e9ac6',
                                           '50c90493a5bb8cf77e60b20829d4a1159c4a1bfb50337121e14ec1db1ae7ac91'}
                          and body==_fs.native_path(__file__).resolve(strict=True).read_bytes())
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
