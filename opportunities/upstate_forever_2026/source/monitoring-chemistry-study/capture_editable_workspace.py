#!/usr/bin/env python3
"""Capture and receive this completed native study without scheduling analyses."""
from pathlib import Path
import argparse, json, sys


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--application',type=Path,required=True)
    p.add_argument('--workspace',type=Path,required=True)
    p.add_argument('--reports',type=Path,required=True)
    p.add_argument('--comparison',type=Path,required=True)
    p.add_argument('--archive',type=Path,required=True)
    p.add_argument('--receive-into',type=Path,required=True)
    p.add_argument('--output',type=Path,required=True)
    a=p.parse_args();app=a.application.resolve(strict=True);sys.path.insert(0,str(app))
    from model.common import atomic_json,read_json,file_digest
    from model.workspace import Workspace
    from model.chemistry import Chemistry
    from model.monitoring_workspace import MonitoringWorkspace
    from model import chemistry_reports,chemistry_report_source,portable
    reports=read_json(a.reports);comparison=read_json(a.comparison)
    ws=Workspace(a.workspace.resolve(strict=True),create=False)
    a.output.parent.mkdir(parents=True,exist_ok=True)
    state=read_json(a.output) if a.output.exists() else {'schema':'upstate.completed-study-receiving/v1','steps':{}}
    intent={'application':str(app),'workspace':str(ws.root),'archive':str(a.archive.resolve()),
            'receive_into':str(a.receive_into.resolve()),'reports_sha256':file_digest(a.reports),
            'comparison_sha256':file_digest(a.comparison),'renderer_sha256':file_digest(app/'model/reach_chemistry/reporting.py')}
    if state.get('intent',intent)!=intent:raise ValueError('Resume with the original receiving paths and saved study')
    state['intent']=intent;atomic_json(a.output,state)
    if 'backup' not in state['steps']:
        print('Capturing original complete scientific Workspace and application.',flush=True)
        result=portable.backup(ws,a.archive)
        state['steps']['backup']=result;atomic_json(a.output,state)
        print('Native archive published.',flush=True)
    if 'restore' not in state['steps']:
        print('Receiving the native archive into a new independent directory.',flush=True)
        result=portable.restore(a.archive,a.receive_into)
        state['steps']['restore']=result;atomic_json(a.output,state)
        print('Native archive received: '+result['identity'],flush=True)
    received=Workspace(a.receive_into/'workspace',create=False);chem=Chemistry(received)
    reopened={'project_id':received.project['id'],'analyses':{},'reports':{},'sources':{}}
    for mode in ('calibration','sensitivity','uncertainty','monitoring'):
        run=chem.get_run(reports['analyses'][mode]['run_id'])
        if run['state']!='complete':raise ValueError('Received analysis is not complete')
        r=chemistry_reports.inspect(received,reports['reports'][mode]['id'])
        s=chemistry_report_source.inspect(received,reports['sources'][mode]['id'])
        reopened['analyses'][mode]=run['id'];reopened['reports'][mode]=r['id'];reopened['sources'][mode]=s['id']
    monitor=MonitoringWorkspace(received)
    frontier=monitor.get('frontiers',comparison['frontier_id'])
    reopened['frontier_id']=frontier['id'];reopened['plan_ids']=frontier['plan_ids']
    reopened_comparison=received._get('monitoring_frontier_comparisons',comparison['id'])
    if reopened_comparison!=comparison:raise ValueError('Received budget comparison differs')
    reopened['comparison_id']=reopened_comparison['id']
    state['steps']['reopened']=reopened;state['state']='complete';atomic_json(a.output,state)
    print('Complete: four native analyses, four reports, four sources and original three-budget frontier reopened.',flush=True)

if __name__=='__main__':main()
