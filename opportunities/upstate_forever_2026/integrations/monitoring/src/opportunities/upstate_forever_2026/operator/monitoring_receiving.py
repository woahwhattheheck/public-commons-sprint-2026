#!/usr/bin/env python3
"""Run the delivered monitoring workflow in an actual original Workspace.

Selection file must name retained native sources and explicit planning costs.
Uses original backup/restore for a separately editable receiving project.
"""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import sys
APPLICATION=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(APPLICATION))
from model.workspace import Workspace
from model import portable
from model.common import atomic_json, digest, read_json
from model.monitoring_workspace import MonitoringWorkspace


def receive(workspace_path, selection_path, output):
    selection=read_json(selection_path)
    if not isinstance(selection,dict) or not {'network','configuration'} <= selection.keys():
        raise ValueError('Selection needs network source choices and an explicit configuration')
    workspace=Workspace(workspace_path)
    service=MonitoringWorkspace(workspace,export_root=output/'exports')
    output.mkdir(parents=True,exist_ok=True)
    receipt_path=output/'receiving.json'
    identity=digest({'project':workspace.project,'workspace':str(workspace.root),'selection':selection})
    state=read_json(receipt_path) if receipt_path.exists() else {'request':identity,'selection':selection}
    if state['request']!=identity:raise ValueError('Receiving directory belongs to a different original selection')
    def saved(name,value):state[name]=value;atomic_json(receipt_path,state);return value
    network=service.get('networks',state['network_id']) if 'network_id' in state else service.import_network(**selection['network'])
    saved('network_id',network['id'])
    service.verify_sources(network)
    plan=service.get('plans',state['plan_id']) if 'plan_id' in state else service.design(network_id=network['id'],configuration=selection['configuration'],title=selection.get('title','Monitoring campaign'))
    saved('plan_id',plan['id'])
    if plan['status'] not in {'optimal','feasible'}:
        saved('design_outcome',plan);return state
    if 'campaign_id' not in state:
        revision=service.create_campaign(plan_id=plan['id'],title=selection.get('title','Monitoring campaign'),operation_id='receiving-'+identity)
        saved('campaign_id',revision['campaign_id'])
    campaign=service.campaign(state['campaign_id'])
    if 'field_package' not in state:saved('field_package',service.export(campaign_id=state['campaign_id']))
    if 'workspace_archive' not in state:saved('workspace_archive',service.export(campaign_id=state['campaign_id'],format='workspace'))
    archive=state['workspace_archive']['path']
    # Verify original archive content on every continuation, then retain the one
    # actual receiving directory rather than overwriting an independently edited copy.
    portable.inspect_archive(archive,verify=True)
    if 'received' not in state:
        destination=output/'received'
        if destination.exists():
            # Death after native restore publication: recover only matching bytes.
            manifest=portable.inspect_archive(archive,verify=True)
            from model.common import file_digest
            for name,body in manifest['members'].items():
                path=destination/name
                if not path.is_file() or path.stat().st_size!=body['bytes'] or file_digest(path)!=body['sha256']:
                    raise ValueError('Unrecorded receiving directory differs from the native archive')
            result={'workspace':str(destination/'workspace'),'application':str(destination/'application')}
        else:result=portable.restore(archive,destination)
        saved('received',result)
    recipient=MonitoringWorkspace(Workspace(state['received']['workspace']))
    reopened=recipient.campaign(state['campaign_id'])
    if 'independent_revision' not in state:
        request=state.get('independent_request') or {
            'campaign_id':state['campaign_id'],'expected_revision_id':reopened['revision']['id'],
            'operation_id':'recipient-'+identity,'title':selection.get('title','Monitoring campaign')+' — receiving copy'}
        saved('independent_request',request)
        revision=recipient.revise_campaign(**request)
        saved('independent_revision',revision['id'])
    if service.campaign(state['campaign_id'])['revision']['id'] != campaign['revision']['id']:
        raise ValueError('Sender changed during independent receiving')
    saved('summary',{'source_catchments':len(network['nodes']),'source_stations':len(network['stations']),
          'selected_ids':plan['selected_ids'],'scheduled_visits':len(plan['calendar']['visits']),
          'campaign_cost':plan['cost'],'original_source_bindings':network['source_bindings'],
          'original_project':workspace.project,'complete':True})
    return state


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--workspace',type=Path,required=True)
    p.add_argument('--selection',type=Path,required=True)
    p.add_argument('--output',type=Path,required=True)
    a=p.parse_args()
    try:print(json.dumps(receive(a.workspace,a.selection,a.output.resolve()),indent=2))
    except (OSError,ValueError,KeyError) as e:p.exit(2,'Monitoring receiving: '+str(e)+'\n')
if __name__=='__main__':main()
