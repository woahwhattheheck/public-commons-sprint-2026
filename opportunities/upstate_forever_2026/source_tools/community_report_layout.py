#!/usr/bin/env python3
"""Compose readable Community report tables without replacing scientific code."""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import tempfile

TAG = 'community-readable-tables-v3'
PRIOR_TAGS = ('community-readable-tables-v1', 'community-readable-tables-v2')
REPLACEMENTS = (
    ('body{margin:0}', 'body{margin:0;overflow-wrap:anywhere}'),
    ('.table-wrap{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:13px}',
     '.table-wrap{overflow-x:auto;max-width:100%;overscroll-behavior-x:contain}'
     'table{border-collapse:collapse;width:100%;min-width:760px;font-size:13px}'),
    ('th,td{text-align:left;vertical-align:top;padding:10px;border:1px solid #bbb;overflow-wrap:anywhere}',
     'th,td{text-align:left;vertical-align:top;padding:10px;border:1px solid #bbb;'
     'min-width:112px;overflow-wrap:break-word}'),
    ('@media print{main{max-width:none;padding:0}',
     '@media print{table{min-width:0}th,td{min-width:0}main{max-width:none;padding:0}'),
    ('th{background:#eee}', 'th{background:#eee}.interventions th:first-child,.interventions td:first-child{min-width:40px}'
     '.interventions th:nth-child(2),.interventions td:nth-child(2){min-width:220px}'
     '.interventions th:last-child,.interventions td:last-child{min-width:440px}'),

)


def apply(application: Path) -> dict:
    application = application.resolve(strict=True)
    path = application / 'model/community_reports.py'
    original = path.read_bytes()
    source = original.decode('utf-8')
    if TAG in source:
        return {'state': 'already-applied', 'sha256': hashlib.sha256(original).hexdigest()}
    if PRIOR_TAGS[0] in source:
        old = '@media print{table{min-width:0}main{max-width:none;padding:0}'
        if source.count(old) != 1:
            raise ValueError('The prior print presentation needs a direct source join')
        source = source.replace(old, REPLACEMENTS[3][1], 1)
    for before, after in REPLACEMENTS:
        if source.count(after) == 1 and before not in source:
            continue
        if source.count(before) != 1 or after in source:
            raise ValueError('The current report presentation differs at ' + before)
        source = source.replace(before, after, 1)
    table_before = r'"<div class=\"table-wrap\"><table><thead><tr>"'
    table_after = (r'"<div class=\"table-wrap\"><table"' + " + "
                   + r"(' class=\"interventions\"' if 'Intervention' in headings else '')"
                   + " + " + r'"><thead><tr>"')
    if source.count(table_before) != 1:
        raise ValueError('The table renderer needs a direct source join')
    source = source.replace(table_before, table_after, 1)
    anchor = '"title": title, "format_version": FORMAT_VERSION}' 
    prior = next(('\"title\": title, \"format_version\": FORMAT_VERSION, \"layout_revision\": \"' + t + '\"}' for t in PRIOR_TAGS if t in source), '')
    changed = '"title": title, "format_version": FORMAT_VERSION, "layout_revision": "' + TAG + '"}'
    if source.count(anchor) == 1 and not prior:
        source = source.replace(anchor, changed, 1)
    elif prior and source.count(prior) == 1 and anchor not in source:
        source = source.replace(prior, changed, 1)
    else:
        raise ValueError('The current report identity needs a direct source join')
    pending = source.encode('utf-8')
    saved = application / '.community-layout-original'
    saved.mkdir(exist_ok=True)
    checksum = hashlib.sha256(original).hexdigest()
    backup = saved / (checksum + '.py')
    if backup.exists() and backup.read_bytes() != original:
        raise ValueError('The retained original report source differs')
    if not backup.exists():
        with backup.open('xb') as out:
            out.write(original)
    with tempfile.NamedTemporaryFile(dir=path.parent, prefix='.community-layout-', delete=False) as out:
        tmp = Path(out.name)
        out.write(pending)
        out.flush()
        os.fsync(out.fileno())
    try:
        if path.read_bytes() != original:
            raise ValueError('The maintained report source changed during composition')
        os.replace(tmp, path)
    finally:
        tmp.unlink(missing_ok=True)
    return {'state': 'applied', 'before_sha256': checksum,
            'after_sha256': hashlib.sha256(pending).hexdigest(), 'layout_revision': TAG}


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--application', required=True, type=Path)
    args = p.parse_args()
    try:
        print(json.dumps(apply(args.application), indent=2))
    except (OSError, ValueError) as error:
        p.exit(1, str(error) + '\n')
