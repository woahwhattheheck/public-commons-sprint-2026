"""Terrain input preparation through the original extension registry and task queue."""
from __future__ import annotations
from copy import deepcopy
import json
from source_tools import terrain_conditioning as terrain
from source_tools import terrain_conditioning_response as response
from model.common import identifier,verify_file,read_json
from model import terrain_conditioning_report_source as report_source


def perform(operator,task):
    ws=operator.ws(task['workspace']);p=task['payload'];a=task['action']
    if a=='terrain.conditioning.report-source.prepare':
        selection=p.get('selection');preview=report_source.preview(ws,selection)
        if p.get('expected_id')!=preview['id']:raise ValueError('Original terrain report sources changed; preview these choices again')
        task['terrain_report_source_id']=preview['id']
        return report_source.prepare(ws,selection)
    if a=='terrain.conditioning.compare':return response.compare(ws,identifier(p.get('case_id')),identifier(p.get('baseline_run_id')))
    if a=='terrain.conditioning.save':return terrain.save_case(ws,p)
    if a=='terrain.conditioning.run':return terrain.execute(ws,identifier(p.get('case_id')))
    if a=='terrain.conditioning.grid':return terrain.native_grid(ws,identifier(p.get('case_id')),p.get('variant'),identifier(p.get('grid_id')))
    if a=='terrain.conditioning.native.prepare':return terrain.native_run(ws,identifier(p.get('case_id')),p.get('variant'),identifier(p.get('run_id')))
    raise ValueError('Choose an original terrain preparation action')


def snapshot(workspace):
    return {'cases':terrain.catalog(workspace),'bindings':workspace._list('terrain-conditioning-bindings'),'responses':workspace._list(response.KIND),**report_source.catalog(workspace)}


def read(operator,workspace_key,payload):
    if not isinstance(payload,dict):raise ValueError('Select a retained terrain case')
    ws=operator.ws(workspace_key);action=payload.get('action','catalog')
    if action=='catalog':return {'workspace_key':workspace_key,'sources':ws.sources(),**snapshot(ws)}
    if action in {'get','response','report-source'}:
        if action=='report-source':r=report_source.inspect(ws,identifier(payload.get('id')))
        elif action=='response':r=response.inspect(ws,identifier(payload.get('id')))
        else:r=terrain.inspect(ws,identifier(payload.get('id')),verify=True)
        r['_downloads']=[operator._ticket(workspace_key,verify_file(ws.root,f),f,' / '.join(f['path'].split('/')[-2:])) for f in r.get('files',[])]
        if action=='response':r['report_sources']=[row for row in report_source.catalog(ws)['report_sources'] if row['response_id']==r['id']]
        p=ws.root/terrain.RUNS/r['id']/'progress.json'
        if p.exists():r['progress']=read_json(p)
        r['workspace_key']=workspace_key;return r
    raise ValueError('Choose the original terrain catalogue, case, native response or scientific source')


def preview_report_source(operator,workspace_key,payload):
    ws=operator.ws(workspace_key)
    return {**report_source.preview(ws,payload.get('selection')),'workspace_key':workspace_key}


def decorate_task(operator,task):
    if not task.get('action','').startswith('terrain.conditioning.') or task.get('state')!='complete':return task
    t=deepcopy(task);r=t.get('result') or {};ws=operator.ws(task['workspace'])
    t.setdefault('_downloads',[]).extend(operator._ticket(task['workspace'],verify_file(ws.root,f),f,f['path'].split('/')[-1]) for f in r.get('files',[]))
    return t


def verify_workspace(workspace):
    for case in workspace._list(terrain.KIND):terrain.inspect(workspace,case['id'],verify=True)
    for result in workspace._list(response.KIND):response.inspect(workspace,result['id'])
    for result in workspace._list(report_source.KIND):report_source.inspect(workspace,result['id'])
    return {'terrain_conditioning_cases':len(workspace._list(terrain.KIND)),
            'terrain_report_sources':len(workspace._list(report_source.KIND))}
