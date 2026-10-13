#!/usr/bin/env python3
"""Install the complete additive report comparison component into the original app."""
from __future__ import annotations
import argparse, hashlib, json, os, tempfile
from pathlib import Path

MEMBERS=(
 'model/report_changes.py', 'model/report_changes_review.py',
 'model/scientific_report_review.py', 'operator/report_changes.py',
 'operator/web/report_changes.mjs', 'operator/web/report_changes.css',
 'operator/extensions/report-changes.json', 'docs/SCIENTIFIC_REPORT_CHANGES.md',
 'integration/component_fragments/scientific-report-changes.json',
 'install_report_changes.py',
)

def install(application):
    source=Path(__file__).resolve().parent
    target=Path(application).resolve(strict=True)
    for name in ('operator/source_report_editions.py','operator/extension_registry.py','model/common.py',
                 'model/workspace.py','model/reviews.py','model/scientific_report_editions.py'):
        if not (target/name).is_file():raise ValueError('The original application is missing '+name)
    for name in ('operator/web/app.mjs','operator/web/reviews.mjs'):
        path=target/name
        if not path.is_file() or 'prepareReportComparisonReview' not in path.read_text(encoding='utf-8'):
            raise ValueError('Install the current complete original application before this component; '
                             'the report comparison review host port is missing from '+name)
    pending=[]
    for name in MEMBERS:
        original=source/name
        if original.is_symlink() or not original.is_file():raise ValueError('The complete component is missing '+name)
        output=target/name
        if any(parent.is_symlink() for parent in (output,*output.parents) if parent!=target):raise ValueError('A component destination contains a symbolic link: '+name)
        body=original.read_bytes()
        if output.exists():
            if output.read_bytes()!=body:raise ValueError('Existing component member differs; reconcile it before installation: '+name)
        else:pending.append((output,body))
    for output,body in pending:
        output.parent.mkdir(parents=True,exist_ok=True)
        fd,name=tempfile.mkstemp(prefix='.report-changes-install-',dir=output.parent)
        temporary=Path(name)
        try:
            with os.fdopen(fd,'wb') as stream:stream.write(body);stream.flush();os.fsync(stream.fileno())
            try:os.link(temporary,output)
            except FileExistsError:
                if output.read_bytes()!=body:raise ValueError('A concurrent component installation differs: '+str(output))
        finally:temporary.unlink(missing_ok=True)
    return {'component':'scientific-report-changes','version':'1.2.0','installed_files':len(pending),'complete_files':len(MEMBERS),'restart':'Restart the original operator to discover Report changes.'}

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--application',required=True,type=Path)
    try:print(json.dumps(install(parser.parse_args().application)))
    except (ValueError,OSError) as error:parser.exit(2,str(error)+'\n')
