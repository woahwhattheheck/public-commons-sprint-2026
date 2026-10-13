"""Receive the calendar study in the existing scientific Workspace and Monitoring.

Use the original application, existing Workspace, complete package and a dedicated
operation directory. Optional --request is exported by the offline review. A
supplied original configuration is used unchanged for a native design. Optional
--create-campaign creates a new stable-ID campaign from the feasible design.
"""
from __future__ import annotations
import argparse
from copy import deepcopy
import hashlib
import importlib
import json
from pathlib import Path
import sys

PRIORITIES={'calendar_gap_priority_ha','calendar_source_water_ha','calendar_no_observation_priority_ha'}


def file_sha(path):
    with Path(path).open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()


def checked_member(root,item):
    path=(root/item['path']).resolve(strict=True)
    if not path.is_relative_to(root) or not path.is_file():raise ValueError('Package member leaves selected source')
    if file_sha(path)!=item['sha256'] or path.stat().st_size!=item['bytes']:raise ValueError('Package member changed: '+item['path'])
    return path


def receive(application,workspace,package,output,request=None,create_campaign=False):
    app=Path(application).resolve(strict=True);root=Path(package).resolve(strict=True)
    wsroot=Path(workspace).resolve(strict=True);out=Path(output).resolve()
    if out==wsroot or out.is_relative_to(wsroot) or out==root or out.is_relative_to(root):
        raise ValueError('Use an operation directory outside the Workspace and retained package')
    manifest=json.loads((root/'manifest.json').read_text())
    if manifest['schema']!='upstate.atlas-calendar-delivery/v1':raise ValueError('Choose a complete calendar package')
    project=json.loads((wsroot/'workspace.json').read_text())
    if project['id']!=manifest['project_id']:raise ValueError('Receive this source in its original scientific project')
    for item in manifest['files']:checked_member(root,item)
    sys.path.insert(0,str(app))
    from model.workspace import Workspace
    from model.common import atomic_json,read_json,digest,held,now
    from model.monitoring_workspace import MonitoringWorkspace
    from model.monitoring_network import build_network
    from model.monitoring_design import solve_design
    original_inputs=read_json(root/'data/input-manifest.json')['files']
    expected=[{'original_path':f['original_path'],'sha256':f['sha256']} for f in original_inputs]
    request=deepcopy(request or {'schema':'upstate.atlas-calendar-review/v1','project_id':project['id'],
        'source_inputs':expected,'source_selection':{'start_year':manifest['summary']['start_year'],
        'end_year':manifest['summary']['end_year'],'method_keys':manifest['summary']['selected_method_keys']},
        'priority_field':'calendar_gap_priority_ha','configuration':None,'reviewed_huc12s':[],'notes':''})
    if request.get('schema')!='upstate.atlas-calendar-review/v1' or request.get('project_id')!=project['id']:
        raise ValueError('Choose the original project review')
    if request.get('source_inputs')!=expected:raise ValueError('Review and original source hashes differ')
    if request.get('priority_field') not in PRIORITIES:raise ValueError('Choose a declared calendar priority')
    identity={'request':request,'package_sha256':file_sha(root/'manifest.json'),
        'source_sha256':file_sha(Path(__file__)),'application':str(app),'workspace':str(wsroot),
        'create_campaign':bool(create_campaign)}
    out.mkdir(parents=True,exist_ok=True)
    with held(out/'.calendar-receiving.lock',blocking=False):
        receipt_path=out/'receiving.json'
        receipt=read_json(receipt_path) if receipt_path.exists() else {'identity':identity,'created_at':now(),'steps':{}}
        if receipt['identity']!=identity:raise ValueError('This operation directory has a different source or selection')
        atomic_json(receipt_path,receipt)
        def save_step(key,value):
            receipt['steps'][key]=value;atomic_json(receipt_path,receipt)
        ws=Workspace(wsroot);service=MonitoringWorkspace(ws,export_root=out/'native-exports')
        selected=request['source_selection'];base=manifest['summary']
        methods=selected.get('method_keys') or base['selected_method_keys']
        if (selected['start_year'],selected['end_year'],methods or base['selected_method_keys']) == (
            base['start_year'],base['end_year'],base['selected_method_keys']):
            edition=root
        else:
            # Recompile directly from the unchanged retained atlas inputs with the reviewed window.
            compiler_path=root/'source'/'atlas_calendar.py'
            spec=importlib.util.spec_from_file_location('_original_atlas_calendar',compiler_path)
            compiler=importlib.util.module_from_spec(spec);spec.loader.exec_module(compiler)
            edition=out/'selected-source'
            if not (edition/'manifest.json').exists():
                if edition.exists():
                    import shutil
                    shutil.rmtree(edition)
                compiler.prepare(root/'inputs',edition,selected['start_year'],selected['end_year'],methods)
            for item in read_json(edition/'manifest.json')['files']:checked_member(edition,item)
        if 'sources' not in receipt['steps']:
            vector=ws.import_sources(edition/'calendar-monitoring.sources.json')
            report=ws.import_sources(edition/'calendar-report.sources.json')
            save_step('sources',{'vectors':vector['id'],'report':report['id'],'edition':str(edition)})
        sources=receipt['steps']['sources']
        # Reopen original retained source bodies, not an independently reconstructed collection.
        for source_id in ('regional-calendar-monitoring-domain','regional-calendar-monitoring-stations'):
            ws.source_file(sources['vectors'],source_id)
        report_choice={'source_collection_id':sources['report'],'source_id':'regional-atlas-calendar-support-20261013'}
        ws.source_file(report_choice['source_collection_id'],report_choice['source_id'])
        if 'network_id' not in receipt['steps']:
            opts=read_json(edition/'network-options.json')
            opts['priority_field']=request['priority_field']
            domain_id=opts.pop('domain_source_id');station_id=opts.pop('station_source_id')
            domain,domain_binding=service._source(domain_id,sources['vectors'])
            stations,station_binding=service._source(station_id,sources['vectors'])
            native=build_network(domain,stations,source_bindings={'domain':domain_binding,'stations':station_binding},**opts)
            native['created_at']=receipt['created_at']
            saved=service.save('networks',native)
            save_step('network_id',saved['id'])
        network=service.get('networks',receipt['steps']['network_id']);service.verify_sources(network)
        atomic_json(out/'native-network.json',network)
        configuration=request.get('configuration')
        if configuration is not None:
            if not isinstance(configuration,dict) or 'calendar' not in configuration or 'budget' not in configuration:
                raise ValueError('Original configuration must include a calendar and budget')
            if 'plan_id' not in receipt['steps']:
                candidate=out/'native-design-candidate.json'
                if candidate.exists():value=read_json(candidate)
                else:
                    value=solve_design(network,deepcopy(configuration))
                    value['title']='Regional source-calendar monitoring design'
                    atomic_json(candidate,value,immutable=True)
                if value['configuration']!=configuration:raise ValueError('Original planning configuration differs')
                plan=service.save('plans',value);save_step('plan_id',plan['id'])
            plan=service.get('plans',receipt['steps']['plan_id'])
            if plan['configuration']!=configuration:raise ValueError('Saved planning configuration differs')
            atomic_json(out/'native-plan.json',plan)
            if create_campaign:
                if plan['status'] not in ('optimal','feasible'):raise ValueError('Original configuration has no feasible campaign design')
                campaign=service.create_campaign(plan_id=plan['id'],title='Regional calendar-priority campaign',
                    operation_id='atlas-calendar-'+digest(identity))
                save_step('campaign_id',campaign['campaign_id']);save_step('campaign_revision_id',campaign['id'])
                atomic_json(out/'native-campaign.json',campaign)
        elif create_campaign:raise ValueError('Campaign creation requires the original explicit planning configuration')
        if 'scientific_report' not in receipt['steps']:
            from model import observed_context,scientific_report
            selected_sources={'observed_context_sources':[report_choice], 'source_roles':{'OBSERVED_CONTEXT':report_choice}}
            selected_sources['observed_context_binding']=observed_context.bind(ws,selected_sources)
            report_dir=out/'native-report';report_dir.mkdir(exist_ok=True)
            collected=observed_context.collect(ws,selected_sources,report_dir,{})
            unused,entry=ws.source_file(report_choice['source_collection_id'],report_choice['source_id'])
            source_records=[{'id':'OBSERVED_CONTEXT',**report_choice,'title':entry['title'],
                'uri':entry['uri'],'vintage':entry['vintage'],'body_sha256':entry['body']['sha256']}]
            scientific_report.report_pdf(report_dir/'report.pdf',entry['title'],collected['sections'],contact={},source_records=source_records)
            scientific_report.write_companions(report_dir,entry['title'],collected['sections'],contact={},source_records=source_records,
                binding=selected_sources['observed_context_binding'])
            atomic_json(report_dir/'selection.json',selected_sources)
            save_step('scientific_report',{'source':report_choice,'path':str(report_dir),
                'pdf_sha256':file_sha(report_dir/'report.pdf'),'section_count':len(collected['sections'])})
        atomic_json(out/'review.json',request)
        receipt['summary']={'complete':True,'project_id':project['id'],'catchments':network['summary']['catchments'],
            'source_stations':network['summary']['stations'],'assigned_stations':network['summary']['assigned_stations'],
            'priority_field':request['priority_field'],'configuration_retained':configuration is not None}
        atomic_json(receipt_path,receipt)
        return receipt


def main():
    p=argparse.ArgumentParser(description=__doc__)
    for name in ['application-root','workspace','package','output']:p.add_argument('--'+name,type=Path,required=True)
    p.add_argument('--request',type=Path);p.add_argument('--create-campaign',action='store_true');a=p.parse_args()
    request=json.loads(a.request.read_text()) if a.request else None
    print(json.dumps(receive(a.application_root,a.workspace,a.package,a.output,request,a.create_campaign),indent=2))
if __name__=='__main__':main()
