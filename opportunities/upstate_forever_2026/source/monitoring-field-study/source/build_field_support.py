#!/usr/bin/env python3
"""Join saved Monitoring plans to retained assessment and observation editions.

This adds field-planning context without executing an optimizer, interpreting
compliance, or assigning a sampling location on behalf of the scientific lead.
"""
from __future__ import annotations
import argparse
from collections import Counter, defaultdict
import csv
from hashlib import sha256
import io
import json
from pathlib import Path
import shutil
import sys

MICROBIAL='b795ec76a4a2b67b21415baedaf0bc0629eb8acb323bb9ff5b16659e40cd9dc7'
COORDINATES='5c1835b235f6508c282efe64684da5aaffbfadb18803939020732ef0af118e64'
ASSESSMENT='38fa4b5e4900865f671f5c1e0ab4807cc92aea4ff83e9fe128521b67684e43cb'
FRONTIER='2c1c770ffb1b00c85995a58ad93823407a628052b7b2b01d58aeced5387d12e5'
SCHEMA='upstate.monitoring-field-support/v1'


def canonical(value):
    return json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':'),allow_nan=False).encode()


def write_json(path, value):
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps(value,ensure_ascii=False,indent=2,allow_nan=False)+'\n',encoding='utf-8')


def write_csv(path, rows, fields=None):
    if fields is None:fields=list(rows[0]) if rows else []
    path.parent.mkdir(parents=True,exist_ok=True)
    with path.open('w',encoding='utf-8',newline='') as stream:
        writer=csv.DictWriter(stream,fieldnames=fields)
        writer.writeheader();writer.writerows(rows)


def status(row):
    condition=row['ResultDetectionConditionText']
    states={'Present Above Quantification Limit':'above_limit',
            'Present Below Quantification Limit':'below_limit',
            'Not Detected':'not_detected','Not Reported':'not_reported'}
    if condition in states:return states[condition]
    if condition:return 'other_condition'
    if row['ResultMeasureValue'].strip():return 'measured'
    return 'missing'


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--application',required=True,type=Path)
    parser.add_argument('--workspace',required=True,type=Path)
    parser.add_argument('--budget-study',required=True,type=Path)
    parser.add_argument('--output',required=True,type=Path)
    args=parser.parse_args()
    app=args.application.resolve(strict=True);sys.path.insert(0,str(app))
    from model.workspace import Workspace
    from model.monitoring_workspace import MonitoringWorkspace
    from shapely.geometry import Point,shape
    from shapely.ops import transform
    from pyproj import Transformer
    from pyproj.exceptions import ProjError
    ws=Workspace(args.workspace.resolve(strict=True),create=False)
    out=args.output.resolve()
    if out.is_relative_to(ws.root) or out.is_relative_to(app):
        raise ValueError('Use a separate field-support output directory')
    if out.exists() and any(out.iterdir()):
        raise ValueError('Choose an empty output directory to preserve prior deliveries')
    out.mkdir(parents=True,exist_ok=True)
    service=MonitoringWorkspace(ws);frontier=service.get('frontiers',FRONTIER)
    network=service.get('networks',frontier['network_id']);service.verify_sources(network)
    plans=[service.get('plans',key) for key in frontier['plan_ids']]
    assert len(plans)==3 and all(p['network_id']==network['id'] and p['status']=='optimal' for p in plans)
    records={key:ws._get('sources',key) for key in (MICROBIAL,COORDINATES,ASSESSMENT)}
    inventory={}
    def retain(collection,entry_id):
        record=records[collection]
        entries=[e for e in record['entries'] if e['id']==entry_id]
        if len(entries)!=1:raise ValueError('Missing original entry '+entry_id)
        entry=entries[0];base=Path('original')/collection/entry_id
        for body in [entry['body'],*entry['companions']]:
            name=body.get('view_path',body['filename']);relative=base/name
            if Path(name).is_absolute() or '..' in Path(name).parts:raise ValueError('Invalid source path')
            path=out/relative;path.parent.mkdir(parents=True,exist_ok=True)
            data=(ws.root/body['object']).read_bytes()
            if len(data)!=body['bytes'] or sha256(data).hexdigest()!=body['sha256']:
                raise ValueError('Retained source changed: '+str(relative))
            if path.exists() and path.read_bytes()!=data:raise ValueError('Conflicting source path')
            path.write_bytes(data)
            inventory[relative.as_posix()]={'bytes':len(data),'sha256':body['sha256']}
        write_json(out/'original'/collection/'source-collection.json',record)
        return out/base/entry['body'].get('view_path',entry['body']['filename'])
    for binding in network['source_bindings'].values():
        if binding:
            collection=binding['source_collection_id']
            if collection not in records:records[collection]=ws._get('sources',collection)
            retain(collection,binding['source_id'])
    table_path=retain(MICROBIAL,'utility-ecoli-observations')
    observations=list(csv.DictReader(io.StringIO(table_path.read_text())))
    if len(observations)!=730:raise ValueError('Use the complete retained 730-record source')
    # Preserve the corrected native coordinate strings and separate datums, not
    # the earlier approximate map points from the exploratory source report.
    coordinate_paths=[retain(COORDINATES,key) for key in
                      ('utility-ecoli-native-wgs84','utility-ecoli-native-nad83')]
    retain(ASSESSMENT,'scdes-listed-stations-wgs84-2026')
    geometry={key:shape(node['geometry']) for key,node in network['nodes'].items()}
    projected=Transformer.from_crs('EPSG:4326','EPSG:26917',always_xy=True)
    geometry_m={key:transform(projected.transform,g) for key,g in geometry.items()}
    by_station=defaultdict(list)
    for index,row in enumerate(observations):
        if row['CharacteristicName']!='Escherichia coli':raise ValueError('Unexpected retained characteristic')
        by_station[row['MonitoringLocationIdentifier']].append(index)
    microbial_stations=[];seen=set()
    for path in coordinate_paths:
        payload=json.loads(path.read_text());crs=payload['crs']['properties']['name']
        converter=Transformer.from_crs(crs,'EPSG:4326',always_xy=True)
        for feature in payload['features']:
            properties=feature['properties'];key=properties['MonitoringLocationIdentifier']
            if key in seen:raise ValueError('Original station repeated across native coordinate families')
            seen.add(key);original=feature['geometry']['coordinates']
            lon,lat=converter.transform(*original);point=Point(lon,lat)
            try:used_transform=converter.get_last_used_operation()
            except ProjError:used_transform=converter
            matches=sorted(key for key,g in geometry.items() if g.covers(point))
            huc=matches[0] if len(matches)==1 else None
            distance=geometry_m[huc].boundary.distance(Point(*projected.transform(lon,lat))) if huc else None
            # Exact matching is separate from source HUC assignment and from
            # any uncertainty implied by coordinate datum or collection method.
            microbial_stations.append({
                'id':key,'name':properties['MonitoringLocationName'],
                'utility_id':properties['utility_id'],'huc12':huc,'matched_huc12s':matches,
                'placement':'unique-intersection' if huc else ('boundary-or-overlap' if matches else 'outside-retained-network'),
                'original_coordinate_crs':crs,'original_coordinates':original,
                'longitude':lon,'latitude':lat,'coordinate_transform':used_transform.description,
                'transform_accuracy_m':used_transform.accuracy if used_transform.accuracy>=0 else None,
                'distance_to_catchment_boundary_m':distance,
                'coordinate_source_collection_id':COORDINATES,
                'coordinate_source_id':path.parent.name,
                'properties':properties,'observation_indices':by_station[key],
                'observation_counts':dict(Counter(status(observations[i]) for i in by_station[key]))})
    if seen!=set(by_station):raise ValueError('Station/observation identity coverage differs')
    # Use the native network's already retained station assignment, separately
    # from draft listed_huc12 and full original assessment/coordinate metadata.
    assessment=[]
    for station in network['stations']:
        properties=station['source_properties']
        assessment.append({**station,'name':properties.get('assessment_description',station['id']),
            'full_station_id':properties.get('monitoring_location_id') or station['id'],
            'huc12':station['huc_id'],'causes':properties.get('listed_causes',''),
            'assessment_edition':properties.get('assessment_edition',''),
            'latitude':station['geometry']['coordinates'][1],
            'longitude':station['geometry']['coordinates'][0]})
    profiles=[];flat=[];all_calendar=[]
    month_counts=Counter(row['ActivityStartDate'][5:7] for row in observations)
    for plan in plans:
        selected=set(plan['selected_ids'])
        ms=[s for s in microbial_stations if s['huc12'] in selected]
        indices=sorted(i for s in ms for i in s['observation_indices'])
        ass=[s for s in assessment if s['huc12'] in selected]
        visits=plan['calendar']['visits'];by_huc=[]
        for key in plan['selected_ids']:
            stations=[s for s in ms if s['huc12']==key];a=[s for s in ass if s['huc12']==key]
            rows=[observations[i] for s in stations for i in s['observation_indices']]
            summary={'huc12':key,'name':network['nodes'][key]['source_properties'].get('name',key),
                'area_km2':network['nodes'][key]['area_km2'],
                'assessment_station_ids':[s['id'] for s in a],
                'assessment_causes':dict(Counter(c.strip() for s in a for c in s['causes'].split('|') if c.strip())),
                'observation_station_ids':[s['id'] for s in stations],
                'historical_results':len(rows),'result_conditions':dict(Counter(status(r) for r in rows)),
                'historical_first_date':min((r['ActivityStartDate'] for r in rows),default=None),
                'historical_last_date':max((r['ActivityStartDate'] for r in rows),default=None),
                'historical_calendar_months':dict(sorted(Counter(r['ActivityStartDate'][5:7] for r in rows).items())),
                'original_planned_visits':[v for v in visits if v['site_id']==key]}
            by_huc.append(summary)
            flat.append({'plan_id':plan['id'],'budget_usd':plan['configuration']['budget'],
                'huc12':key,'name':summary['name'],'assessment_sites':len(a),
                'original_causes':' | '.join(sorted(summary['assessment_causes'])),
                'observation_stations':len(stations),'historical_results':len(rows),
                'quantified':summary['result_conditions'].get('measured',0),
                'above_limit':summary['result_conditions'].get('above_limit',0),
                'below_limit':summary['result_conditions'].get('below_limit',0),
                'not_detected':summary['result_conditions'].get('not_detected',0),
                'first_date':summary['historical_first_date'],'last_date':summary['historical_last_date'],
                'planned_visits':len(summary['original_planned_visits'])})
        counts=Counter(status(observations[i]) for i in indices)
        profiles.append({'plan_id':plan['id'],'budget_usd':plan['configuration']['budget'],
            'selected_ids':plan['selected_ids'],'assessment_station_ids':[s['id'] for s in ass],
            'observation_station_ids':[s['id'] for s in ms],'observation_indices':indices,
            'historical_results':len(indices),'result_conditions':dict(counts),'search_areas':by_huc,
            'original_calendar':plan['calendar'],'original_cost':plan['cost'],
            'areas_with_retained_observations':sum(bool(s['historical_results']) for s in by_huc),
            'areas_with_assessment_sites':sum(bool(s['assessment_station_ids']) for s in by_huc)})
        for v in visits:all_calendar.append({'plan_id':plan['id'],'budget_usd':plan['configuration']['budget'],**v})
    periods=[r['ActivityStartDate'] for r in observations]
    data={'schema':SCHEMA,'project_id':ws.project['id'],'frontier_id':frontier['id'],
        'network_id':network['id'],'network_source_bindings':network['source_bindings'],'original_plan_ids':frontier['plan_ids'],
        'source_collections':{k:{'id':k,'title':v['title'],'sha256':sha256(canonical(v)).hexdigest()} for k,v in records.items()},
        'network_sha256':sha256(canonical(network)).hexdigest(),
        'plans_sha256':{p['id']:sha256(canonical(p)).hexdigest() for p in plans},
        'observation_period':{'first':min(periods),'last':max(periods)},
        'result_conditions':dict(Counter(status(r) for r in observations)),
        'monthly_results':dict(sorted(month_counts.items())),
        'observation_fields':list(observations[0]),'observations':observations,
        'microbial_stations':microbial_stations,'assessment_stations':assessment,
        'plans':profiles,'source_files':inventory,
        'interpretation':[
            'Budget selections maximize their original area objective; this join describes retained station and measurement support rather than changing that objective.',
            'E. coli rows retain 2021–2025 sampling dates and original methods, units, censoring, activity types, source filenames and row ordinals. Winter 2026–2027 calendar visits are separate planned work.',
            'A zero count means the selected retained utility observation edition has no matching records in that search area, not that no environmental monitoring has occurred there.',
            'Assessment causes remain explicitly labeled 2026 draft. Native coordinate assignment, publisher-listed HUC12 and utility source membership are separate recorded fields.',
            'WGS84 and NAD83 coordinate families retain their original strings and datums. A unique polygon intersection supplies the planning join; all transform metadata and boundary distances remain inspectable.',
            'An existing observation or assessment station is a candidate field location. The reviewer explicitly selects its original source edition; access, suitability and future sampling arrangements remain project decisions.',
            'Censored measurements remain reported limits or missing values. Method families and field replicates are never silently pooled as routine numeric concentrations.',
        ]}
    data['id']=sha256(canonical(data)).hexdigest()
    write_json(out/'field-support.json',data)
    write_csv(out/'budget-field-support.csv',flat)
    write_csv(out/'original-plan-calendars.csv',all_calendar)
    for p in profiles:
        write_csv(out/('budget-'+str(int(float(p['budget_usd'])))+'-original-results.csv'),
                  [observations[i] for i in p['observation_indices']],data['observation_fields'])
    write_json(out/'native/frontier.json',frontier);write_json(out/'native/network.json',network)
    for plan in plans:write_json(out/'native/plans'/(plan['id']+'.json'),plan)
    shutil.copy2(args.budget_study/'catchments.svg',out/'catchments.svg')
    write_json(out/'source-selection.json',{'project_id':ws.project['id'],'frontier_id':FRONTIER,
        'source_collections':list(records),'field_support_id':data['id']})
    summary={'state':'complete','field_support_id':data['id'],'workspace':str(ws.root),'output':str(out),
        'original_observations':len(observations),'original_observation_stations':len(microbial_stations),
        'assessment_stations':len(assessment),'unique_placements':sum(s['placement']=='unique-intersection' for s in microbial_stations),
        'plans':[{k:p[k] for k in ('budget_usd','historical_results','areas_with_retained_observations','areas_with_assessment_sites','result_conditions')} for p in profiles]}
    write_json(out/'build-result.json',summary)
    print(json.dumps(summary,indent=2))

if __name__=='__main__':main()
