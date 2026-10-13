#!/usr/bin/env python3
"""Prepare readable native report editions from completed Chemistry runs.

Use a private application copy. The exact known predecessor is required; newer
producer changes are preserved. This command never schedules a numerical run.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import sys

PREDECESSOR='8622c6bbb7c7ff5198f39c78a7710008d920899b02abf9dbafec5d5549cc4c71'
MODES=('calibration','sensitivity','uncertainty','monitoring')


def refresh_manifest(app: Path) -> None:
    """Keep the maintained component inventory aligned with this presentation."""
    path = app / 'integration/reach_chemistry/COMPOUND_SOURCE.json'
    manifest = json.loads(path.read_text())
    renderer = app / 'model/reach_chemistry/reporting.py'
    raw = renderer.read_bytes()
    current = hashlib.sha256(raw).hexdigest()
    rows = [row for row in manifest['files']
            if row['path'] == 'model/reach_chemistry/reporting.py']
    if len(rows) != 1 or rows[0]['sha256'] not in (PREDECESSOR, current):
        raise ValueError('Maintained reporting inventory differs; preserve that source edition')
    rows[0].update(bytes=len(raw), sha256=current)
    manifest['scientific_report_edition'] = 'reach-chemistry-scientific-report/4'
    manifest['presentation_upgrade'] = {
        'operation_id': 'ECO-NATIVE-MONITOR-CHEM-RIVER13-20261013',
        'predecessor_sha256': PREDECESSOR,
        'renderer_sha256': current,
        'scope': 'Readable screen tables and complete repeated-key print tables',
    }
    content = json.dumps(manifest, ensure_ascii=False, indent=2) + '\n'
    if path.read_text() != content:
        path.write_text(content)


def install(app: Path) -> None:
    source=app/'model/reach_chemistry/reporting.py'
    helper=Path(__file__).with_name('presentation_tables.py')
    text=source.read_text()
    marker='# BEGIN readable table renderer\n'
    body=helper.read_text().split('TABLE_CSS = ',1)[1]
    body=('TABLE_CSS = '+body).replace('_escape(', '_table_escape(').replace('_markup(', '_table_markup(')
    embedded=marker+body+'\n# END readable table renderer\n'
    if marker in text:
        if embedded not in text:
            raise ValueError('Installed table renderer differs; preserve and compose that edition')
        refresh_manifest(app)
        return
    if hashlib.sha256(source.read_bytes()).hexdigest()!=PREDECESSOR:
        raise ValueError('Report renderer is a different source edition; no file was replaced')
    before=text.index('def _table(rows, fields, caption):')
    after=text.index('\n\ndef _items(',before)
    text=text[:before]+('def _table(rows, fields, caption):\n'
                       '    return render_table(rows, fields, caption)\n')+text[after:]
    text=text.replace('from .inference import observation_key',
                      'from .inference import observation_key\nfrom collections.abc import Mapping, Sequence\n\n'+embedded)
    text=text.replace('reach-chemistry-scientific-report/3','reach-chemistry-scientific-report/4')
    text=text.replace('            "</style></head><body><main><header>',
                      '            + TABLE_CSS + "</style></head><body><main><header>')
    source.write_text(text)
    refresh_manifest(app)


def main() -> None:
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--application',type=Path,required=True)
    parser.add_argument('--workspace',type=Path,required=True)
    parser.add_argument('--course',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args();app=args.application.resolve(strict=True)
    install(app);sys.path.insert(0,str(app))
    from model.common import atomic_json,held,file_digest,read_json
    from model.workspace import Workspace
    from model.chemistry import Chemistry
    from model import chemistry_reports,chemistry_report_source
    ws=Workspace(args.workspace.resolve(strict=True),create=False)
    course=read_json(args.course);out=args.output.resolve();out.mkdir(parents=True,exist_ok=True)
    if out.is_relative_to(ws.root) or out.is_relative_to(app):
        raise ValueError('Keep report output outside the application and Workspace')
    result={'schema':'upstate.chemistry-readable-native-reports/v1','course_inputs':course['inputs'],
            'renderer_sha256':file_digest(app/'model/reach_chemistry/reporting.py'),
            'table_renderer_sha256':file_digest(Path(__file__).with_name('presentation_tables.py')),
            'analyses':course['analyses'],'reports':{},'sources':{},
            'editable_export':course['editable_export'],'numerical_comparison':course['numerical_comparison']}
    service=Chemistry(ws)
    with held(out/'.reports.lock',blocking=False):
        for name in MODES:
            run_id=course['analyses'][name]['run_id'];run=service.get_run(run_id)
            if run['state']!='complete':raise ValueError('Select an already completed native analysis')
            report=chemistry_reports.prepare(ws,run_id)
            result['reports'][name]=report
            result['sources'][name]=chemistry_report_source.prepare(ws,report['id'])
            atomic_json(out/'reports.json',result)
            print(name,report['id'],flush=True)
    result['state']='complete';atomic_json(out/'reports.json',result)
    print('Completed four new native presentation editions; original runs reused.',flush=True)

if __name__=='__main__':main()
