"""Compile original Regional Observation Atlas sampling support and Monitoring sources.

All calculations are source-row joins, calendar set operations and unchanged GIS
coordinates. Run with --atlas and --output. Costs/dates for a future campaign are
never inferred from historic observations; use receive_atlas_calendar.py with the
existing campaign's explicit configuration for native planning.
"""
from __future__ import annotations
import argparse
from collections import Counter, defaultdict
from copy import deepcopy
import csv
import hashlib
import html
import json
from pathlib import Path
import shutil
import statistics
from typing import Any

VERSION = '1.1.0'
PROJECT = 'b9d5d257-c6bb-4f07-b975-8e8c63705db3'
SOURCE_ID = 'regional-atlas-calendar-support-20261013'
TITLE = 'Upper Savannah: sampling calendar and monitoring priorities'
SEASONS = {'DJF': [12,1,2], 'MAM':[3,4,5], 'JJA':[6,7,8], 'SON':[9,10,11]}
MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
INPUTS = [
 'data/summary.json', 'data/source-register.json', 'data/watershed-coverage.csv',
 'data/station-coverage.csv', 'data/observation-watershed-membership.csv',
 'original/original_intervals/record-intervals.csv',
 'original/native_planning_units/geodata.gpkg',
 'original/native_stations/stations.geojson',
 'original/original_analysis_summary/analysis-summary.json',
 'original/original_annual_coverage/annual-sampling-coverage.csv',
 'original/original_calendar_comparisons/calendar-support-comparisons.csv',
]

def sha(path: Path) -> str:
    with path.open('rb') as f:
        return hashlib.file_digest(f,'sha256').hexdigest()

def write_json(path: Path, obj: Any) -> None:
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps(obj,ensure_ascii=False,sort_keys=True,indent=2,allow_nan=False)+'\n',encoding='utf-8')

def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding='utf-8'))

def read_csv(path: Path) -> list[dict]:
    with path.open(encoding='utf-8-sig',newline='') as f:
        return list(csv.DictReader(f))

def write_csv(path: Path, rows: list[dict], fields: list[str] | None = None) -> None:
    path.parent.mkdir(parents=True,exist_ok=True)
    keys=fields or (list(rows[0]) if rows else [])
    with path.open('w',encoding='utf-8',newline='') as f:
        writer=csv.DictWriter(f,keys,extrasaction='ignore',lineterminator='\n');writer.writeheader()
        for row in rows:
            values={}
            for k in keys:
                value=row.get(k)
                if isinstance(value,(dict,list)):value=json.dumps(value,ensure_ascii=False,separators=(',',':'))
                if isinstance(value,str) and value.lstrip().startswith(('=','+','-','@')):value="'"+value
                values[k]='' if value is None else value
            writer.writerow(values)

def longest_missing(indices: set[int], start: int, end: int) -> int:
    best=run=0
    for i in range(start,end+1):
        run=0 if i in indices else run+1;best=max(best,run)
    return best

def qualified_rows(atlas: Path) -> tuple[list[dict],list[dict]]:
    intervals=read_csv(atlas/'original/original_intervals/record-intervals.csv')
    membership=read_csv(atlas/'data/observation-watershed-membership.csv')
    member={}
    for row in membership:
        key=(row['source_file'],int(row['source_row']))
        if key in member:raise ValueError(f'Duplicate atlas membership source row: {key}')
        member[key]=row
    selected=[];excluded=[];seen=set()
    for original in intervals:
        key=(original['source_file'],int(original['source_row']))
        if key in seen:raise ValueError(f'Duplicate original source row: {key}')
        seen.add(key);match=member.get(key)
        if match is None:
            excluded.append({'reason':'outside_original_routine_membership','original':original});continue
        for col in ['station_id','activity_id','date','method_context','method']:
            if original[col]!=match[col]:raise ValueError(f'Original row/membership mismatch: {key}, {col}')
        if original['activity_type']!='Sample-Routine':raise ValueError(f'Non-routine member: {key}')
        row={**original,'huc12':match['huc12'],'source_row':int(original['source_row']),
             'year':int(original['year']),'month':int(original['month']),
             'method_key':original['method_context']+':'+original['method']}
        for key2 in ['lower','upper','result_value','limit_value']:
            row[key2]=float(row[key2]) if row[key2] else None
        # The original endpoints remain endpoints, including unbounded upper intervals.
        selected.append(row)
    if set(member)-seen:raise ValueError('Atlas membership references original rows not in the retained intervals')
    return selected,excluded

def summarize_group(rows: list[dict], start_year: int, end_year: int) -> dict:
    months={(r['year'],r['month']) for r in rows}
    indices={(y-start_year)*12+m-1 for y,m in months}
    total=(end_year-start_year+1)*12
    activities={(r['station_id'],r['activity_id']) for r in rows}
    active_span=(max(indices)-min(indices)+1) if indices else 0
    return {'routine_records':len(rows),'distinct_activities':len(activities),
        'observed_months':len(months),'reference_months':total,
        'calendar_support_fraction':len(months)/total,
        'absent_months_in_reference':total-len(months),
        'months_ever_observed':sorted({m for _,m in months}),
        'years_observed':sorted({y for y,_ in months}),
        'seasons_observed':[s for s,ms in SEASONS.items() if any(r['month'] in ms for r in rows)],
        'first_observed_date':min((r['date'] for r in rows),default=None),
        'last_observed_date':max((r['date'] for r in rows),default=None),
        'first_last_span_months':active_span,
        'absent_months_between_first_last':active_span-len(months),
        'longest_absent_run_between_first_last':longest_missing(indices,min(indices),max(indices)) if indices else 0,
        'method_keys':sorted({r['method_key'] for r in rows}),
        'status_counts':dict(sorted(Counter(r['status'] for r in rows).items())),
        'monthly_activity_counts':[len({(r['station_id'],r['activity_id']) for r in rows if r['month']==m}) for m in range(1,13)],
        'year_activity_counts':{str(y):len({(r['station_id'],r['activity_id']) for r in rows if r['year']==y}) for y in range(start_year,end_year+1)}}

def build_analysis(atlas: Path, start_year: int, end_year: int, method_keys: list[str] | None = None) -> dict:
    if not 1900<=start_year<=end_year<=2200:raise ValueError('Select an ordered calendar-year window')
    original_summary=read_json(atlas/'data/summary.json')
    if original_summary['project_id']!=PROJECT:raise ValueError('Choose the original regional-atlas project')
    all_rows,excluded=qualified_rows(atlas)
    known_methods={r['method_key'] for r in all_rows}
    if method_keys is not None and (not method_keys or set(method_keys)-known_methods):raise ValueError('Select known original analytical methods')
    rows=[r for r in all_rows if start_year<=r['year']<=end_year and (method_keys is None or r['method_key'] in method_keys)]
    watersheds=read_csv(atlas/'data/watershed-coverage.csv')
    station_source=read_csv(atlas/'data/station-coverage.csv')
    station_ids={r['station_id'] for r in station_source};huc_ids={r['huc12'] for r in watersheds}
    if len(station_ids)!=len(station_source) or len(huc_ids)!=len(watersheds):raise ValueError('Duplicate geography identifiers')
    if any(r['station_id'] not in station_ids or r['huc12'] not in huc_ids for r in rows):raise ValueError('Observation missing from original geographic cohort')
    by_station=defaultdict(list);by_huc=defaultdict(list)
    for r in rows:by_station[r['station_id']].append(r);by_huc[r['huc12']].append(r)
    stations=[]
    for s in station_source:
        group=by_station[s['station_id']]
        if any(r['huc12']!=s['huc12'] for r in group):raise ValueError('Original station/HUC membership differs')
        stations.append({'station_id':s['station_id'],'huc12':s['huc12'],
            'longitude_wgs84':float(s['longitude_wgs84']),'latitude_wgs84':float(s['latitude_wgs84']),
            **summarize_group(group,start_year,end_year)})
    hucs=[]
    for h in watersheds:
        group=by_huc[h['huc12']];summ=summarize_group(group,start_year,end_year)
        sw=float(h['source_water_union_ha'])
        hucs.append({'huc12':h['huc12'],'name':h['name'],'source_water_union_ha':sw,
            'native_area_ha':float(h['native_area_ha']),
            'station_ids':sorted(s['station_id'] for s in station_source if s['huc12']==h['huc12']),
            **summ,
            'historical_gap_priority_ha':sw*(1-summ['calendar_support_fraction']),
            'no_observation_priority_ha':sw if not group else 0.0,
            'planning_stratum':'source-water-no-cohort-observations' if sw and not group else
                'source-water-with-cohort-observations' if sw else 'other-retained-domain'})
    station_month=[];huc_month=[];station_month_method=[]
    for key,group,out in [('station_id',stations,station_month),('huc12',hucs,huc_month)]:
        lookup=defaultdict(list)
        for r in rows:lookup[(r[key],r['year'],r['month'])].append(r)
        for item in group:
            for y in range(start_year,end_year+1):
                for m in range(1,13):
                    selected=lookup[(item[key],y,m)]
                    out.append({key:item[key],'year':y,'month':m,'routine_records':len(selected),
                        'distinct_activities':len({(r['station_id'],r['activity_id']) for r in selected}),
                        'has_selected_observation':bool(selected),'method_keys':sorted({r['method_key'] for r in selected})})
    methods=sorted({r['method_key'] for r in all_rows})
    smm=defaultdict(list)
    for r in rows:smm[(r['station_id'],r['year'],r['month'],r['method_key'])].append(r)
    for s in stations:
        for y in range(start_year,end_year+1):
            for m in range(1,13):
                for method in methods:
                    selected=smm[(s['station_id'],y,m,method)]
                    station_month_method.append({'station_id':s['station_id'],'huc12':s['huc12'],
                        'year':y,'month':m,'method_key':method,'routine_records':len(selected),
                        'distinct_activities':len({r['activity_id'] for r in selected})})
    annual=[]
    for y in range(start_year,end_year+1):
        r=[x for x in rows if x['year']==y]
        annual.append({'year':y,'routine_records':len(r),'stations':len({x['station_id'] for x in r}),
            'huc12s':len({x['huc12'] for x in r}),
            'observed_station_months':len({(x['station_id'],x['month']) for x in r}),
            'observed_huc_months':len({(x['huc12'],x['month']) for x in r}),
            'source_water_huc12s':len({x['huc12'] for x in r}&{h['huc12'] for h in hucs if h['source_water_union_ha']>0}),
            'method_counts':dict(sorted(Counter(x['method_key'] for x in r).items()))})
    comparisons=[]
    for s in stations:
        rs=by_station[s['station_id']]
        for method in methods:
            for y1 in range(start_year,end_year):
                for y2 in range(y1+1,end_year+1):
                    a=[r for r in rs if r['method_key']==method and r['year']==y1]
                    b=[r for r in rs if r['method_key']==method and r['year']==y2]
                    if not a or not b:continue
                    months1={r['month'] for r in a};months2={r['month'] for r in b};shared=months1&months2
                    comparisons.append({'station_id':s['station_id'],'huc12':s['huc12'],'method_key':method,
                        'year_a':y1,'year_b':y2,'months_a':sorted(months1),'months_b':sorted(months2),
                        'common_months':sorted(shared),'common_month_count':len(shared),
                        'records_a_in_common_months':sum(r['month'] in shared for r in a),
                        'records_b_in_common_months':sum(r['month'] in shared for r in b),
                        'same_calendar_month_set':months1==months2})
    observed_hucs=[h for h in hucs if h['routine_records']]
    sw_hucs=[h for h in hucs if h['source_water_union_ha']>0]
    gaps=[h for h in sw_hucs if not h['routine_records']]
    summary={'project_id':PROJECT,'version':VERSION,'start_year':start_year,'end_year':end_year,
        'selected_method_keys':sorted(method_keys) if method_keys else sorted(known_methods),
        'original_rows':len(all_rows)+len(excluded),'original_routine_rows':len(all_rows),
        'selected_routine_rows':len(rows),'excluded_nonroutine_rows':len(excluded),
        'selected_distinct_activities':len({(r['station_id'],r['activity_id']) for r in rows}),
        'huc12_count':len(hucs),'station_count':len(stations),'observed_huc12s':len(observed_hucs),
        'selected_station_months':sum(s['observed_months'] for s in stations),
        'reference_station_months':len(stations)*(end_year-start_year+1)*12,
        'selected_huc_months':sum(h['observed_months'] for h in hucs),
        'reference_huc_months':len(hucs)*(end_year-start_year+1)*12,
        'source_water_huc12s':len(sw_hucs),'source_water_huc12s_without_selected_rows':len(gaps),
        'source_water_gap_ha':sum(h['source_water_union_ha'] for h in gaps),
        'source_water_total_ha':sum(h['source_water_union_ha'] for h in sw_hucs),
        'source_water_temporal_gap_weight_ha':sum(h['historical_gap_priority_ha'] for h in sw_hucs),
        'method_counts':dict(sorted(Counter(r['method_key'] for r in rows).items())),
        'result_status_counts':dict(sorted(Counter(r['status'] for r in rows).items())),
        'station_year_method_pairs':len(comparisons),
        'station_year_method_pairs_same_calendar_set':sum(c['same_calendar_month_set'] for c in comparisons),
        'stations_with_all_12_months_ever':sum(len(s['months_ever_observed'])==12 for s in stations),
        'source_input_summary':original_summary}
    return {'schema':'upstate.atlas-calendar-support/v1','title':TITLE,'summary':summary,
        'stations':stations,'watersheds':hucs,'annual':annual,'station_month':station_month,
        'huc_month':huc_month,'station_month_method':station_month_method,'comparisons':comparisons,
        'observations':rows,'excluded_records':excluded,'methods':methods,
        'interpretation':[
            'Calendar support counts presence of at least one selected routine activity in a month. It is not a compliance or monitoring-programme completion rate.',
            'The reference is the explicitly selected full calendar window. First-to-last-observation span is descriptive and does not establish when a station operated.',
            'All original methods and censoring intervals remain separate. No pooled concentration, imputed non-detect, pollutant load or trend is calculated.',
            'Historical gap priority = original source-water hectares multiplied by the fraction of reference months without selected observations in that HUC. It is an editable planning objective, not environmental risk.',
            'Whole HUC geometry and original ToHUC links are retained. Candidate catchments are search areas; original stations remain their actual source coordinates.',
            'Common calendar months control only one source of unequal support. They do not establish equivalent weather, flow, sampling design or analytical methods beyond the exact retained method identity.'
        ]}

def make_vectors(atlas: Path, result: dict, out: Path) -> dict:
    import fiona
    from pyproj import Transformer
    from shapely.geometry import shape, mapping
    from shapely.ops import transform
    by_id={h['huc12']:h for h in result['watersheds']}
    features=[]
    with fiona.open(atlas/'original/native_planning_units/geodata.gpkg',layer='planning_units') as src:
        transformer=Transformer.from_crs(src.crs,'EPSG:4326',always_xy=True)
        for f in src:
            p=dict(f['properties']);attrs=json.loads(p['source_attributes']);key=attrs['huc12'];h=by_id[key]
            if key!=p['unit_id']:raise ValueError('Original unit ID differs from source HUC12')
            geom=transform(transformer.transform,shape(f['geometry']))
            properties={**attrs,'calendar_original_unit_properties':p,
                'calendar_source_water_ha':h['source_water_union_ha'],
                'calendar_gap_priority_ha':h['historical_gap_priority_ha'],
                'calendar_no_observation_priority_ha':h['no_observation_priority_ha'],
                'calendar_observed_months':h['observed_months'],
                'calendar_reference_months':h['reference_months'],
                'calendar_support_fraction':h['calendar_support_fraction'],
                'calendar_stratum':h['planning_stratum']}
            features.append({'type':'Feature','properties':properties,'geometry':mapping(geom)})
    if {f['properties']['huc12'] for f in features}!=set(by_id):raise ValueError('Full original HUC geography differs')
    features.sort(key=lambda f:f['properties']['huc12'])
    domain={'type':'FeatureCollection','name':'original-domain-with-calendar-priorities','features':features}
    stations=read_json(atlas/'original/native_stations/stations.geojson')
    stats={s['station_id']:s for s in result['stations']}
    for f in stations['features']:
        p=f['properties'];s=stats[p['station_id']]
        p['calendar_huc12']=s['huc12'];p['calendar_observed_months']=s['observed_months']
        p['calendar_reference_months']=s['reference_months']
        p['calendar_source_water_ha']=by_id[s['huc12']]['source_water_union_ha']
    write_json(out/'gis/calendar-domain.geojson',domain)
    write_json(out/'gis/calendar-stations.geojson',stations)
    # Original projected polygon coordinates are reused for GIS delivery.
    gpkg=out/'gis/calendar-support.gpkg'
    if gpkg.exists():gpkg.unlink()
    schema={'geometry':'MultiPolygon','properties':{'huc12':'str:12','name':'str:120','tohuc':'str:12',
        'sw_ha':'float','observed_months':'int','reference_months':'int','gap_priority_ha':'float','records':'int','stratum':'str:50'}}
    with fiona.open(atlas/'original/native_planning_units/geodata.gpkg',layer='planning_units') as src:
        with fiona.open(gpkg,'w',driver='GPKG',layer='calendar_watersheds',crs=src.crs,schema=schema) as dst:
            for f in src:
                attrs=json.loads(f['properties']['source_attributes']);h=by_id[attrs['huc12']]
                dst.write({'type':'Feature','geometry':f['geometry'],'properties':{'huc12':h['huc12'],'name':h['name'],
                    'tohuc':attrs.get('tohuc'),'sw_ha':h['source_water_union_ha'],
                    'observed_months':h['observed_months'],'reference_months':h['reference_months'],
                    'gap_priority_ha':h['historical_gap_priority_ha'],'records':h['routine_records'],'stratum':h['planning_stratum']}})
    schema2={'geometry':'Point','properties':{'station_id':'str:100','huc12':'str:12','observed_months':'int','reference_months':'int','records':'int','method_keys':'str'}}
    with fiona.open(gpkg,'w',driver='GPKG',layer='original_stations',crs='EPSG:4326',schema=schema2) as dst:
        for f in stations['features']:
            s=stats[f['properties']['station_id']]
            dst.write({'type':'Feature','geometry':f['geometry'],'properties':{'station_id':s['station_id'],'huc12':s['huc12'],
                'observed_months':s['observed_months'],'reference_months':s['reference_months'],
                'records':s['routine_records'],'method_keys':','.join(s['method_keys'])}})
    return {'domain':domain,'stations':stations}

def report_sections(result: dict) -> list:
    s=result['summary'];sw=sorted((h for h in result['watersheds'] if h['source_water_union_ha']>0),key=lambda h:-h['historical_gap_priority_ha'])
    table=lambda columns,rows:{'kind':'table','columns':columns,'rows':rows,**({'widths':[5.2]+[1]*12} if len(columns)==13 else {})}
    sections = [
      ['Regional source calendar',[
        f"{s['selected_routine_rows']} retained routine activities at {s['station_count']} stations occupy {s['selected_station_months']} of {s['reference_station_months']} station-month cells in the {s['start_year']}-{s['end_year']} reference window. All {s['huc12_count']} original catchments remain in the source; {s['observed_huc12s']} have selected activities.",
        'The denominator is an explicit historical calendar, not a contracted sampling schedule. Missing cells identify absent rows in this selected cohort.',
        table(['Year','Activities','Stations','HUC12s','Station-month cells'],[[r['year'],r['routine_records'],r['stations'],r['huc12s'],r['observed_station_months']] for r in result['annual']])]],
      ['Source-water planning context',[
        f"{s['source_water_huc12s_without_selected_rows']} of {s['source_water_huc12s']} source-water HUC12s have no selected routine activities in this window. Their original source-water intersections total {s['source_water_gap_ha']:,.2f} ha.",
        'Historical gap weight = original source-water hectares × absent-reference-month fraction. This ranks planning attention under that declared objective; it does not estimate pollutant risk or monitoring feasibility.',
        table(['HUC12','Source-water ha','Observed / reference months','Activities','Gap weight (ha-equivalent)'],[
          [h['huc12'],round(h['source_water_union_ha'],2),f"{h['observed_months']} / {h['reference_months']}",h['routine_records'],round(h['historical_gap_priority_ha'],2)] for h in sw])]],
      ['Analytical and calendar comparability',[
        table(['Exact method identity','Routine activities'],[[k,v] for k,v in s['method_counts'].items()]),
        table(['Original result status','Routine activities'],[[k,v] for k,v in s['result_status_counts'].items()]),
        f"{s['station_year_method_pairs_same_calendar_set']} of {s['station_year_method_pairs']} retained same-station, same-method year pairs have the same set of sampled calendar months. The complete pairwise table identifies shared months and source-row counts.",
        'Original censoring limits, non-detect intervals and unbounded upper intervals are retained verbatim in the observation export. No replacement value or concentration trend is calculated.']],
      ['Continue the existing Monitoring campaign',[
        'Import calendar-monitoring.sources.json into the existing scientific Workspace. Its two vector entries preserve the complete original HUC graph and all original source-station coordinates, with added calendar-priority properties.',
        'Use the existing configuration to choose the declared objective: source-water area, no-cohort-observation source-water area, or historical calendar-gap weight. The bridge keeps original cost, budget, date, crew, required-site and exclusion choices unchanged.',
        'Existing stations count as baseline future monitoring only when the operator explicitly selects them in the retained configuration. Historical presence alone is not an ongoing funded campaign.',
        'Selected catchments without a retained station remain site-search areas. The field workflow binds actual source stations before collecting samples.']],
      ['Source and interpretation',result['interpretation']+[
        'Input source: ECO-CLOUD-0730 Regional Observation Atlas, 13 October 2026. The package retains each input byte and source-row identifier. Original publisher references are in inputs/data/source-register.json and station selected_source_ref metadata.',
        'Regenerate with atlas_calendar.py using the complete original atlas. Reopening this pack uses local files; source rows, source geometry, generated tables, editable selections and the native importer are included.']]
    ]
    months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    from collections import Counter
    counts=Counter((r['station_id'],r['month']) for r in result['observations'])
    matrix=['Original station and calendar-month support',[
        f"Distinct retained routine activities by calendar month across {s['start_year']}-{s['end_year']}. Zero cells are retained. This matrix pools counts across years, while the interactive calendar and full CSV tables preserve each year separately.",
        table(['Original station',*months],[[station['station_id'],*[counts[(station['station_id'],m)] for m in range(1,13)]] for station in result['stations']]),
        'Method-filtered editions rebuild this table from the selected exact methods. Activity counts do not describe concentration magnitude or a contracted schedule.']]
    return [sections[0],sections[2],sections[1],matrix,sections[3],sections[4]]


def render_pdf(out: Path, result: dict) -> None:
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak
    from reportlab.lib import colors
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.enums import TA_LEFT
    from reportlab.lib.pagesizes import A4
    styles=getSampleStyleSheet()
    styles.add(ParagraphStyle(name='BodyClean',fontName='Helvetica',fontSize=9.5,leading=14,spaceAfter=8))
    styles.add(ParagraphStyle(name='TableClean',fontName='Helvetica',fontSize=7.6,leading=10.5))
    styles.add(ParagraphStyle(name='DenseTable',fontName='Helvetica',fontSize=6.4,leading=8.3))
    styles.add(ParagraphStyle(name='Kicker',fontName='Helvetica',fontSize=8,leading=11,spaceAfter=10,textColor=colors.HexColor('#555555')))
    styles['Title'].fontName='Helvetica-Bold';styles['Title'].fontSize=22;styles['Title'].leading=27
    styles['Heading1'].fontName='Helvetica-Bold';styles['Heading1'].fontSize=16;styles['Heading1'].leading=21
    doc=SimpleDocTemplate(str(out/'calendar-support.pdf'),pagesize=A4,leftMargin=42,rightMargin=42,topMargin=38,bottomMargin=38,
        title=TITLE,author='TokenJunkieLabs')
    story=[]
    for i,(heading,blocks) in enumerate(report_sections(result)):
        if i in (2,3,4):story.append(PageBreak())
        if i not in (1,5):story.append(Paragraph('ECOSYSTEM SCIENCES  /  REGIONAL SOURCE CALENDAR  /  13 OCTOBER 2026',styles['Kicker']))
        story.append(Paragraph(html.escape(TITLE if i==0 else heading),styles['Title'] if i==0 else styles['Heading1']))
        story.append(Spacer(1,12))
        for block in blocks:
            if isinstance(block,str):story.append(Paragraph(html.escape(block),styles['BodyClean']))
            else:
                dense=len(block['columns'])>8
                data=[[Paragraph(html.escape(str(v)),styles['DenseTable'] if dense else styles['TableClean']) for v in row] for row in [block['columns'],*block['rows']]]
                widths=[doc.width/len(block['columns'])]*len(block['columns'])
                if len(widths)==5:widths=[doc.width*x for x in (.25,.16,.23,.13,.23)]
                if dense:widths=[155]+[(doc.width-155)/12]*12
                t=Table(data,colWidths=widths,repeatRows=1,hAlign='LEFT')
                t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),colors.HexColor('#ededed')),
                    ('LINEBELOW',(0,0),(-1,0),.6,colors.HexColor('#555555')),
                    ('LINEBELOW',(0,1),(-1,-1),.25,colors.HexColor('#d7d7d7')),
                    ('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),2 if dense else 6),('RIGHTPADDING',(0,0),(-1,-1),2 if dense else 6),
                    ('TOPPADDING',(0,0),(-1,-1),3 if dense else 7),('BOTTOMPADDING',(0,0),(-1,-1),3 if dense else 7)]))
                story.extend([t,Spacer(1,12)])
    def footer(canvas,doc):
        canvas.saveState();canvas.setFont('Helvetica',8);canvas.setFillColor(colors.HexColor('#555555'))
        canvas.drawString(42,22,'TokenJunkieLabs | Original-source monitoring study')
        canvas.drawRightString(A4[0]-42,22,str(doc.page));canvas.restoreState()
    doc.build(story,onFirstPage=footer,onLaterPages=footer)

def prepare(atlas: Path, output: Path, start_year: int=2021, end_year: int=2025, method_keys: list[str] | None = None) -> dict:
    atlas=atlas.resolve(strict=True);output=output.resolve()
    if output==atlas or output.is_relative_to(atlas):raise ValueError('Write a separate edition outside the retained atlas')
    if output.exists() and any(output.iterdir()):raise ValueError('Choose a new empty output directory; retain completed editions')
    output.mkdir(parents=True,exist_ok=True)
    result=build_analysis(atlas,start_year,end_year,method_keys)
    sources=[]
    for name in INPUTS:
        path=atlas/name;target=output/'inputs'/name;target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(path,target)
        sources.append({'path':'inputs/'+name,'original_path':name,'bytes':path.stat().st_size,'sha256':sha(path)})
    write_json(output/'data/analysis.json',result);write_json(output/'data/summary.json',result['summary'])
    for name,key in [('station-support','stations'),('watershed-support','watersheds'),('annual-support','annual'),
            ('station-month-support','station_month'),('huc-month-support','huc_month'),
            ('station-month-method-support','station_month_method'),('same-station-method-year-pairs','comparisons'),
            ('original-routine-observations','observations')]:
        write_csv(output/f'data/{name}.csv',result[key])
    write_json(output/'data/excluded-original-records.json',result['excluded_records'])
    write_json(output/'data/input-manifest.json',{'project_id':PROJECT,'files':sources})
    make_vectors(atlas,result,output)
    render_pdf(output,result)
    template=Path(__file__).with_name('calendar_view.html').read_text(encoding='utf-8')
    browser={k:v for k,v in result.items() if k not in ('station_month_method','station_month','huc_month')}
    browser['input_manifest']=sources
    payload=json.dumps(browser,ensure_ascii=False,separators=(',',':'),allow_nan=False).replace('<','\\u003c')
    (output/'index.html').write_text(template.replace('__DATA_PAYLOAD__',payload),encoding='utf-8')
    code=output/'source';code.mkdir()
    for name in ['atlas_calendar.py','calendar_view.html','receive_atlas_calendar.py','README.md']:
        src=Path(__file__).with_name(name)
        if src.is_file():shutil.copy2(src,code/name)
    companions=[]
    for path in sorted(output.rglob('*')):
        if path.is_file():companions.append({'path':path.relative_to(output).as_posix(),'bytes':path.stat().st_size,'sha256':sha(path)})
    recipe={'schema':'upstate.observed-report/v1','title':TITLE,'project_id':PROJECT,
        'sections':report_sections(result),'inputs':companions,
        'source_links':['index.html','calendar-support.pdf','data/station-support.csv','data/watershed-support.csv','gis/calendar-support.gpkg'],
        'basis':{'source_operation':'ECO-ATLAS-MONITOR','reference_years':[start_year,end_year],
                 'original_atlas':result['summary']['source_input_summary']}}
    write_json(output/'observed-report.json',recipe)
    record=lambda id,kind,path,title,metadata:{'id':id,'kind':kind,'title':title,'path':path,
        'sha256':sha(output/path),'vintage':'2026-10-13','uri':'urn:commons:project:'+PROJECT+':'+id,
        'metadata':metadata,'companions':[{'path':x['path'],'sha256':x['sha256']} for x in sources]}
    domain=record('regional-calendar-monitoring-domain','vector','gis/calendar-domain.geojson','Original domain with calendar priorities',
        {'project_id':PROJECT,'priority_meaning':'explicit historical sampling-support objective','original_huc12_count':217})
    station=record('regional-calendar-monitoring-stations','vector','gis/calendar-stations.geojson','Original stations with calendar support',{'project_id':PROJECT,'station_count':36})
    write_json(output/'calendar-monitoring.sources.json',{'schema':'upstate.sources/v1','title':TITLE,'captured_at':'2026-10-13','entries':[domain,station]})
    report=record(SOURCE_ID,'document','observed-report.json',TITLE,{'project_id':PROJECT,'report_schema':recipe['schema']})
    report['companions']=[{'path':x['path'],'sha256':x['sha256']} for x in companions]
    write_json(output/'calendar-report.sources.json',{'schema':'upstate.sources/v1','title':TITLE,'captured_at':'2026-10-13','entries':[report]})
    write_json(output/'network-options.json',{'domain_source_id':domain['id'],'station_source_id':station['id'],
        'id_field':'huc12','downstream_field':'tohuc','station_id_field':'station_id','station_huc_field':'calendar_huc12',
        'stratum_field':'calendar_stratum','priority_field':'calendar_gap_priority_ha','title':TITLE})
    write_json(output/'manifest.json',{'schema':'upstate.atlas-calendar-delivery/v1','version':VERSION,'project_id':PROJECT,
        'summary':result['summary'],'files':[{'path':p.relative_to(output).as_posix(),'bytes':p.stat().st_size,'sha256':sha(p)}
            for p in sorted(output.rglob('*')) if p.is_file()]})
    return result['summary']

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--atlas',type=Path,required=True)
    p.add_argument('--output',type=Path,required=True);p.add_argument('--start-year',type=int,default=2021)
    p.add_argument('--end-year',type=int,default=2025);p.add_argument('--method',action='append');args=p.parse_args()
    print(json.dumps(prepare(args.atlas,args.output,args.start_year,args.end_year,args.method),indent=2))
if __name__=='__main__':main()
