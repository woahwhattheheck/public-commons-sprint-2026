#!/usr/bin/env python3
"""Receive the saved three-budget frontier into a native, offline budget study.

The no-observed-context record layout follows monitoring_frontier_comparison.py
at fa7a77aecef81f13765a0c1024aef68dd323cb15. Original MonitoringWorkspace reads,
source verification, money conversion and Workspace persistence are reused.
This headless path does not require newer HTTP/export-streaming UI modules.
"""
from __future__ import annotations
import argparse
import csv
import html
import json
from pathlib import Path
import sys

FRONTIER='2c1c770ffb1b00c85995a58ad93823407a628052b7b2b01d58aeced5387d12e5'
TITLE='Regional 217-catchment monitoring budget choices'
INTERPRETATION=[
 'Each row reopens an original completed frontier plan; solver status and diagnostics remain unchanged.',
 'Coverage uses the retained source objective and units. Total coverage includes the original existing-station baseline; new covered weight excludes it.',
 'Costs retain integer cents, currency, overhead and the original existing-station cost scope.',
 'Catchment area and coverage refer to the retained model network; a separate reporting-boundary intersection requires its own original geography.',
 'Each budget was optimized independently. Added and removed search areas show the exact selected-set change from the chosen baseline.',
 'A selected catchment is a field search area. Original station coordinates and campaign bindings determine any actual field location.',
 'Observed support is attached only through a context for that exact saved plan. Source-period, station mapping, flow scope and retained campaign revision remain explicit.',
 'Original calendar dates remain unchanged. Historical sampling and daily flow are not shifted onto future field visits.'
]


def prepare(ws):
    from model.monitoring_workspace import MonitoringWorkspace
    from model.monitoring_campaign import money_cents,dollars
    from model.monitoring_common import digest,ContractError
    service=MonitoringWorkspace(ws);frontier=service.get('frontiers',FRONTIER)
    ids=frontier['plan_ids']
    if len(ids)!=len(set(ids)) or not ids or frontier['budgets_completed']!=len(ids):
        raise ContractError('Original frontier requires its complete ordered plan inventory')
    network=service.get('networks',frontier['network_id']);service.verify_sources(network)
    plans=[service.get('plans',identity) for identity in ids];budgets=set();configuration=None
    for plan in plans:
        budget=money_cents(plan['configuration']['budget'],'Original plan budget')
        options={k:v for k,v in plan['configuration'].items() if k!='budget'}
        if (plan['network_id']!=network['id'] or plan.get('frontier_job_id')!=frontier.get('job_id')
            or plan.get('frontier_budget_cents')!=budget or budget in budgets
            or (configuration is not None and options!=configuration)
            or plan.get('weight_basis')!=network['weight_basis']
            or plan.get('source_bindings')!=network['source_bindings']):
            raise ContractError('Original frontier plan identity, source or configuration differs')
        if plan.get('status') in {'optimal','feasible'} and plan['cost']['budget_cents']!=budget:
            raise ContractError('Original plan cost uses another budget')
        budgets.add(budget);configuration=options
    baseline=plans[0];baseline_ready=baseline['status'] in {'optimal','feasible'};rows=[]
    for plan in plans:
        available=plan['status'] in {'optimal','feasible'};cost=plan.get('cost') if available else None
        coverage=plan.get('coverage') if available else None
        selected=set(plan['selected_ids']);covered=set(plan.get('covered_ids',[]))
        visits=plan.get('calendar',{}).get('visits',[]) if available else []
        row={'plan_id':plan['id'],'title':plan.get('title',plan['id']),
             'status':plan['status'],'available':available,'is_baseline':plan['id']==baseline['id'],
             'budget_cents':plan['frontier_budget_cents'],'budget_display':dollars(plan['frontier_budget_cents']),
             'currency':plan['configuration'].get('currency','USD'),'cost':cost,'coverage':coverage,
             'selected_sites':len(selected) if available else None,'selected_ids':plan['selected_ids'],
             'covered_ids':plan.get('covered_ids') if available else None,
             'baseline_covered_ids':plan.get('baseline_covered_ids',[]),
             'new_covered_weight':coverage['covered_weight']-coverage['baseline_weight'] if coverage is not None else None,
             'weight_basis':plan['weight_basis'],'coverage_mode':plan['coverage_mode'],
             'coverage_meaning':plan['coverage_meaning'],
             'max_sites':plan['configuration'].get('max_sites',len(network['nodes'])),
             'calendar_site_capacity':plan['calendar_site_capacity'],'solver':plan.get('solver'),
             'diagnostics':plan.get('diagnostics',[]),'warnings':plan.get('warnings',[]),
             'calendar':{'visits':len(visits),'first_date':min((v['date'] for v in visits),default=None),
                         'last_date':max((v['date'] for v in visits),default=None)} if available else None,
             'delta':{'total_cost_cents':cost['total_cents']-baseline['cost']['total_cents'],
                      'covered_weight':coverage['covered_weight']-baseline['coverage']['covered_weight'],
                      'selected_sites':len(selected)-len(baseline['selected_ids']),
                      'added_search_area_ids':sorted(selected-set(baseline['selected_ids'])),
                      'removed_search_area_ids':sorted(set(baseline['selected_ids'])-selected),
                      'retained_search_area_ids':sorted(selected.intersection(baseline['selected_ids'])),
                      'added_covered_ids':sorted(covered-set(baseline['covered_ids'])),
                      'removed_covered_ids':sorted(set(baseline['covered_ids'])-covered)} if available and baseline_ready else None,
             'observed':None,'same_observed_source_as_baseline':False}
        rows.append(row)
    record={'schema':'upstate.monitoring_frontier_comparisons/v1',
            'recipe':'upstate.monitoring-frontier-comparison/1','title':TITLE,'project_id':ws.project['id'],
            'selection':{'frontier_id':FRONTIER,'baseline_plan_id':baseline['id'],'context_ids':[]},
            'frontier_id':FRONTIER,'frontier_digest':digest(frontier),'network_id':network['id'],
            'network_digest':digest(network),'network_title':network.get('title',network['id']),
            'source_bindings':network['source_bindings'],'baseline_plan_id':baseline['id'],
            'plan_ids':[p['id'] for p in plans],'plan_digests':{p['id']:digest(p) for p in plans},
            'context_digests':{},'configuration_without_budget':{k:v for k,v in plans[0]['configuration'].items() if k!='budget'},
            'weight_basis':network['weight_basis'],'rows':rows,'interpretation':INTERPRETATION}
    return ws._save('monitoring_frontier_comparisons',record),frontier,network,plans


def make_map(network):
    from pyproj import Transformer
    from shapely.geometry import shape
    from shapely.ops import transform
    project=Transformer.from_crs('EPSG:4326','EPSG:3857',always_xy=True).transform
    shapes={k:transform(project,shape(n['geometry'])) for k,n in network['nodes'].items()}
    left=min(g.bounds[0] for g in shapes.values());bottom=min(g.bounds[1] for g in shapes.values())
    right=max(g.bounds[2] for g in shapes.values());top=max(g.bounds[3] for g in shapes.values())
    scale=min(840/(right-left),660/(top-bottom));mx=(900-(right-left)*scale)/2;my=(720-(top-bottom)*scale)/2
    def xy(x,y):return mx+(x-left)*scale,my+(top-y)*scale
    def ring(coords):
        points=[]
        for x,y,*_ in coords:
            a,b=xy(x,y);point=f'{a:.1f},{b:.1f}'
            if not points or point!=points[-1]:points.append(point)
        return 'M'+'L'.join(points)+'Z'
    paths=[]
    for key,geom in shapes.items():
        polygons=[geom] if geom.geom_type=='Polygon' else list(geom.geoms)
        path=''.join(ring(p.exterior.coords)+''.join(ring(h.coords) for h in p.interiors) for p in polygons)
        node=network['nodes'][key];name=node['source_properties'].get('name',key)
        paths.append('<path class="catchment" data-huc="'+key+'" d="'+path+'"><title>'+html.escape(key+' / '+name)+'</title></path>')
    for station in network['stations']:
        x,y=xy(*project(*station['geometry']['coordinates']))
        paths.append(f'<circle class="station" cx="{x:.2f}" cy="{y:.2f}" r="2.3"><title>'+html.escape(station['id'])+'</title></circle>')
    return '<svg viewBox="0 0 900 720" role="img" aria-label="Original Upper Savannah catchments and selected budget search areas">'+''.join(paths)+'</svg>'


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--application',type=Path,required=True)
    p.add_argument('--workspace',type=Path,required=True);p.add_argument('--output',type=Path,required=True)
    args=p.parse_args();app=args.application.resolve(strict=True);sys.path.insert(0,str(app))
    from model.workspace import Workspace
    from model.common import atomic_json
    from model.monitoring_sources import export_source
    ws=Workspace(args.workspace.resolve(strict=True),create=False);out=args.output.resolve()
    if out.is_relative_to(ws.root) or out.is_relative_to(app):raise ValueError('Keep output outside the Workspace and application')
    out.mkdir(parents=True,exist_ok=True);record,frontier,network,plans=prepare(ws)
    for name,value in [('comparison.json',record),('selection.json',{**record['selection'],'title':record['title']}),
                       ('native/frontier.json',frontier),('native/network.json',network)]:atomic_json(out/name,value,immutable=True)
    summary=[];catalog=[]
    for row,plan in zip(record['rows'],plans):
        atomic_json(out/'native/plans'/(plan['id']+'.json'),plan,immutable=True)
        summary.append({'budget_usd':row['budget_display'],'status':row['status'],'selected_search_areas':row['selected_sites'],
                        'covered_area_km2':row['coverage']['covered_weight'],'domain_fraction':row['coverage']['fraction'],
                        'planned_visits':row['calendar']['visits'],'plan_id':plan['id']})
        visits=plan['calendar']['visits']
        with (out/(row['budget_display']+'-calendar.csv')).open('w',newline='') as f:
            w=csv.DictWriter(f,fieldnames=list(visits[0]));w.writeheader();w.writerows(visits)
        for huc in row['selected_ids']:
            node=network['nodes'][huc]
            catalog.append({'budget_usd':row['budget_display'],'huc12':huc,'name':node['source_properties'].get('name'),
                            'area_km2':node['area_km2'],'plan_id':plan['id']})
    for name,rows in [('comparison.csv',summary),('selected-search-areas.csv',catalog)]:
        with (out/name).open('w',newline='') as f:
            w=csv.DictWriter(f,fieldnames=list(rows[0]));w.writeheader();w.writerows(rows)
    for label,binding in network['source_bindings'].items():
        if binding:
            for name,body in export_source(ws,label,binding).items():
                dest=out/name;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(body)
    (out/'catchments.svg').write_text(make_map(network))
    atomic_json(out/'view-data.json',{'comparison':record,'plans':plans,
                'nodes':{k:{'id':k,'area_km2':v['area_km2'],'name':v['source_properties'].get('name',k)} for k,v in network['nodes'].items()},
                'network_summary':network['summary']},immutable=True)
    print(json.dumps({'comparison_id':record['id'],'output':str(out),'budgets':summary},indent=2))

if __name__=='__main__':main()
