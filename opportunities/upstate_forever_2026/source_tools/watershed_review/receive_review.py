#!/usr/bin/env python3
"""Receive an exact review delivery and optional saved queue into an existing Workspace.

Retains the entire desk as an original source collection. A selected saved review
can become editable native candidates and planned review tasks, with no invented
field coordinates, observations, commitments or task durations. Repeated intake
reuses the source identity and the original saved plan rather than overwriting it.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path


def dump(path:Path,value:dict)->None:
    path.write_text(json.dumps(value,ensure_ascii=False,sort_keys=True,indent=2,allow_nan=False)+'\n',encoding='utf-8')

def sha(path:Path)->str:
    h=hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda:f.read(1024*1024),b''):h.update(block)
    return h.hexdigest()

def intake(args)->dict:
    app=args.application.resolve(strict=True);delivery=args.delivery.resolve(strict=True)
    sys.path.insert(0,str(app))
    from model.workspace import Workspace
    from model.implementation import ImplementationStore,make_plan,validate_plan
    from model.common import digest
    ws=Workspace(args.workspace.resolve(strict=True));store=ImplementationStore(ws)
    original_project=dict(ws.project)
    original_plans={p['id']:p['revision'] for p in store.list_plans()}
    expected_revisions=dict(original_plans)
    data=json.loads((delivery/'data/dataset.json').read_text())
    selected=None
    if args.review_project:
        project=args.review_project.resolve(strict=True)
        code="""import fs from 'node:fs';import{pathToFileURL}from'node:url';
const{restoreProject}=await import(pathToFileURL(process.argv[1]));
const d=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const p=JSON.parse(fs.readFileSync(process.argv[3],'utf8'));
restoreProject(p,d);console.log(JSON.stringify(p));"""
        result=subprocess.run(['node','--input-type=module','-e',code,str(delivery/'source/review_core.mjs'),str(delivery/'data/dataset.json'),str(project)],check=True,capture_output=True,text=True)
        selected=json.loads(result.stdout)
        if not any(n['queued'] for n in selected['notes'].values()):raise ValueError('Saved project has no queued review records; receive the desk without --review-project instead.')
    out=args.output.resolve();out.mkdir(parents=True,exist_ok=False)
    # The delivery manifest is relative to the original delivery directory and
    # includes the complete application/data/source relationship as companions.
    names=sorted(p.relative_to(delivery).as_posix() for p in delivery.rglob('*') if p.is_file() and p.name!='native-sources.json')
    primary='Upper_Savannah_Watershed_Review.html'
    if primary not in names:raise ValueError('Complete original HTML body is absent')
    sources={'schema':'upstate.sources/v1','title':'Upper Savannah 217 watershed review desk and complete original context','captured_at':'2026-10-13','scope':{'source_edition':data['edition'],'reference_huc12_count':217,'classification_years':[2023,2025],'assessment_edition':'South Carolina 2026 draft'},'notes':['Analyst preferences over retained mapped classifications; source observations and existing native model quantities remain distinct.','All original table, geometry, implementation source, completed preference analyses and saved receiving examples remain retained.'],'entries':[{'id':'upper-savannah-watershed-review-desk-20261013','kind':'document','title':'Upper Savannah watershed review desk','uri':'urn:sha256:'+sha(delivery/primary),'vintage':'2023 and 2025 classification; retained 2026 draft context; 2026-10-13 review edition','path':primary,'sha256':sha(delivery/primary),'source_edition':data['edition'],'purpose':'Editable analyst review, questions and fieldwork preparation','companions':[{'path':n,'sha256':sha(delivery/n)} for n in names if n!=primary]}]}
    manifest=delivery/'native-sources.json'
    expected=json.dumps(sources,ensure_ascii=False,sort_keys=True,indent=2)+'\n'
    if manifest.exists() and manifest.read_text()!=expected:raise ValueError('A different native source intake manifest already exists in this delivery. Retain a new delivery edition instead of overwriting it.')
    if not manifest.exists():manifest.write_text(expected,encoding='utf-8')
    collection=ws.import_sources(manifest)
    source_id=sources['entries'][0]['id'];source_view,_=ws.source_file(collection['id'],source_id)
    result={'schema':'upstate.watershed-review-native-receiving/v1','project_id':ws.project['id'],'source_edition':data['edition'],'source_collection_id':collection['id'],'source_id':source_id,'source_view':str(source_view),'source_sha256':sha(source_view),'source_member_count':len(names),'original_plans':original_plans}
    if selected:
        project_sha=sha(project);plan_id='watershed-review-'+project_sha[:24]
        if args.as_of:as_of=args.as_of
        else:as_of=datetime.fromisoformat(selected['saved_at'].replace('Z','+00:00')).date().isoformat()
        datetime.strptime(as_of,'%Y-%m-%d')
        exists=next((p for p in store.list_plans() if p['id']==plan_id),None)
        if exists:
            plan=store.get(plan_id)
            if plan.get('watershed_review',{}).get('original_project_sha256')!=project_sha:raise ValueError('Native plan ID belongs to another original review')
            plan_action='reused_existing_preserving_edits'
        else:
            title=args.title or 'Upper Savannah saved watershed review queue'
            plan=make_plan(plan_id,title,as_of,description='Editable desktop-review and field-planning tasks from the selected saved review. Recorded notes are retained exactly; due dates, visits, costs, access and sampling designs remain unset until actually chosen.')
            source_link={'id':'retained-review-source','kind':'workspace_source_collection','label':'Original watershed review source edition','reference':'urn:upstate:source-collection:'+collection['id'],'source_id':source_id,'source_digest':collection['id']}
            plan['source_links']=[source_link]
            plan['watershed_review']={'schema':'upstate.native-review-link/v1','source_collection_id':collection['id'],'source_id':source_id,'original_project_sha256':project_sha,'source_edition':data['edition'],'settings':selected['settings'],'review_saved_at':selected['saved_at'],'interpretation':'Review preferences and recorded questions; no native modeled-benefit field is inferred from a preference score.'}
            rows={r['huc12']:r for r in data['rows']}
            for h,n in selected['notes'].items():
                if not n['queued']:continue
                row=rows[h];cid='huc-'+h
                plan['candidates'].append({'id':cid,'label':row['name']+' ('+h+')','area_ha':row['area_ha'],'source':{'source_link_id':source_link['id'],'source_id':source_id,'source_digest':collection['id'],'source_kind':'workspace_source_collection','original_huc12':h,'original_profile':row},'modeled_benefits':[],'review_disposition':n['status']})
                plan['tasks'].append({'id':'review-'+h,'title':n['question'] or 'Review original sources for '+row['name'],'candidate_id':cid,'phase':'field-planning' if n['status']=='Field follow-up' else 'desktop-review','assignee':n['reviewer'],'status':'planned','duration_days':None,'progress_pct':0,'depends_on':[],'evidence_refs':[source_link['id']],'notes':n['notes'],'original_huc12':h,'review_disposition':n['status'],'original_review_updated_at':n['updated_at']})
            plan=store.create(validate_plan(plan),actor='ECO-CLOUD-REVIEW13')
            plan_action='created_from_exact_saved_review'
        # Creating the plan and attaching the original are separate maintained
        # operations. Complete this attachment on retry as well; attach_file
        # reuses an identical retained file without changing the saved revision.
        if sha(project)!=project_sha:raise ValueError('Original saved review changed during intake')
        before_attachment=plan['revision']
        attached=store.attach_file(plan_id,project,expected_revision=before_attachment,actor='ECO-CLOUD-REVIEW13',label='Original saved watershed review project')
        plan=attached['plan']
        if sha(project)!=project_sha:raise ValueError('Original saved review changed during attachment')
        if exists and plan['revision']!=before_attachment:
            if plan['revision']!=before_attachment+1:raise ValueError('Unexpected original review attachment revision')
            plan_action='completed_original_attachment_preserving_edits'
            expected_revisions[plan_id]=plan['revision']
        report=store.report(plan_id,out/'native-plan-report',as_of=as_of)
        retained=store.retain_report(report['directory'])
        store.export_json(plan_id,out/'native-plan.json')
        result['plan']={'id':plan_id,'revision':plan['revision'],'action':plan_action,'task_count':len(plan['tasks']),'candidate_count':len(plan['candidates']),'report_id':retained['id'],'report_directory':report['directory'],'retained_report_directory':retained['directory'],'saved_project_sha256':project_sha}
    if ws.project!=original_project:raise ValueError('Original project identity changed during additive intake')
    for old_id,revision in expected_revisions.items():
        if store.get(old_id)['revision']!=revision:raise ValueError('An original pre-existing plan revision changed')
    dump(out/'native-receiving.json',result)
    return result

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    for name in ['application','workspace','delivery','output']:p.add_argument('--'+name,type=Path,required=True)
    p.add_argument('--review-project',type=Path);p.add_argument('--title');p.add_argument('--as-of')
    args=p.parse_args()
    try:print(json.dumps(intake(args),ensure_ascii=False,indent=2))
    except (ValueError,OSError,KeyError,subprocess.CalledProcessError) as exc:
        print('Review intake stopped: '+str(exc),file=sys.stderr)
        if isinstance(exc,subprocess.CalledProcessError) and exc.stderr:print(exc.stderr,file=sys.stderr)
        raise SystemExit(1)
