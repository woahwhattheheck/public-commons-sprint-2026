#!/usr/bin/env python3
"""Import and render the complete same-day study through the retained native app."""
from __future__ import annotations
import argparse
import hashlib
import json
import sys
from pathlib import Path

def digest(path: Path) -> str:
    h=hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda:stream.read(1024*1024),b''):h.update(chunk)
    return h.hexdigest()

def receive(application: Path, workspace: Path, package: Path, output: Path) -> dict:
    application=application.resolve(strict=True);workspace=workspace.resolve(strict=True)
    package=package.resolve(strict=True);output=output.resolve()
    if any(output==p or output.is_relative_to(p) for p in (application,workspace,package)):
        raise ValueError('Choose a fresh native output outside application, Workspace and source package')
    if output.exists() and any(output.iterdir()):
        raise ValueError('Preserve the existing output and choose a fresh report directory')
    manifest=json.loads((package/'manifest.json').read_text(encoding='utf-8'))
    for entry in manifest['files']:
        p=(package/entry['path']).resolve(strict=True)
        if not p.is_relative_to(package) or not p.is_file() or p.stat().st_size!=entry['bytes'] or digest(p)!=entry['sha256']:
            raise ValueError('Delivered source member differs: '+entry['path'])
    # Loaded only after validating the complete delivered source and caller paths.
    sys.path.insert(0,str(application))
    from model.workspace import Workspace
    from model import observed_context, scientific_report
    from model.common import atomic_json
    ws=Workspace(workspace)
    if ws.project['id']!=manifest['project_id']:
        raise ValueError('Workspace is not the original source project')
    collection=ws.import_sources(package/'same-day-report.sources.json')
    choice={'source_collection_id':collection['id'],'source_id':'regional-same-day-sampling-20261013'}
    selection={'observed_context_sources':[choice],'source_roles':{'OBSERVED_CONTEXT':choice}}
    selection['observed_context_binding']=observed_context.bind(ws,selection)
    output.mkdir(parents=True,exist_ok=True)
    atomic_json(output/'selection.json',selection)
    collected=observed_context.collect(ws,selection,output,{})
    _,entry=ws.source_file(choice['source_collection_id'],choice['source_id'])
    records=[{'id':'OBSERVED_CONTEXT',**choice,'title':entry['title'],'uri':entry['uri'],'vintage':entry['vintage'],'body_sha256':entry['body']['sha256']}]
    scientific_report.report_pdf(output/'report.pdf',entry['title'],collected['sections'],contact={},source_records=records)
    scientific_report.write_companions(output,entry['title'],collected['sections'],contact={},source_records=records,binding=selection['observed_context_binding'])
    # Reopen from the current source store rather than trusting the import return alone.
    reopened=Workspace(workspace)
    body,again=reopened.source_file(choice['source_collection_id'],choice['source_id'])
    if again['body']['sha256']!=entry['body']['sha256']:
        raise ValueError('Reopened native source identity differs')
    result={'schema':'upstate.same-day-native-report/v1','project_id':ws.project['id'],'source':choice,
        'source_fingerprint':manifest['summary']['source_fingerprint'],'source_body_sha256':again['body']['sha256'],
        'native_report_pdf_sha256':digest(output/'report.pdf'),
        'files':[{'path':p.relative_to(output).as_posix(),'bytes':p.stat().st_size,'sha256':digest(p)} for p in sorted(output.rglob('*')) if p.is_file()]}
    atomic_json(output/'result.json',result)
    return result

def main() -> None:
    p=argparse.ArgumentParser(description=__doc__)
    for name in ('application','workspace','package','output'):p.add_argument('--'+name,type=Path,required=True)
    args=p.parse_args()
    try:print(json.dumps(receive(**vars(args)),indent=2))
    except (OSError,ValueError,KeyError,ImportError) as e:p.exit(2,str(e)+'\n')

if __name__=='__main__':main()
