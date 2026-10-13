#!/usr/bin/env python3
"""Build an original-source monitoring coverage report for the Eco workbench.

Consumes saved native station membership, not a new point/polygon or model solve.
Run with the maintained application on PYTHONPATH. No external requests are made.
"""
from __future__ import annotations
import argparse
from collections import Counter, defaultdict
import csv
from datetime import date
from decimal import Decimal, InvalidOperation
import hashlib
import json
from pathlib import Path
import sys
import shutil

VERSION = 'upstate.utility-monitoring-coverage/v1'
TITLE = 'Upper Savannah: utility monitoring coverage, 2021-2025'
SOURCE_ID = 'utility-monitoring-coverage-2021-2025'
DATE = 'ActivityStartDate'
STATION = 'MonitoringLocationIdentifier'
METHOD = 'ResultAnalyticalMethod/MethodIdentifier'
METHOD_CONTEXT = 'ResultAnalyticalMethod/MethodIdentifierContext'
UNIT = 'ResultMeasure/MeasureUnitCode'
DETECTION = 'ResultDetectionConditionText'
VALUE = 'ResultMeasureValue'


def read_json(path: Path):
    return json.loads(path.read_text(encoding='utf-8'))


def write_json(path: Path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False)+'\n', encoding='utf-8')


def ident(path: Path, root: Path):
    payload = path.read_bytes()
    return {'path':path.relative_to(root).as_posix(), 'bytes':len(payload),
            'sha256':hashlib.sha256(payload).hexdigest()}


def checked(root: Path, descriptor):
    path = (root/descriptor['path']).resolve(strict=True)
    if not path.is_relative_to(root.resolve()):
        raise ValueError('Input leaves the selected source package')
    actual = ident(path, root)
    if any(actual[k] != descriptor[k] for k in ('bytes','sha256')):
        raise ValueError('Retained input changed: '+descriptor['path'])
    return path


def csv_rows(path: Path):
    with path.open(encoding='utf-8-sig', newline='') as stream:
        return list(csv.DictReader(stream))


def write_csv(path: Path, rows, fields=None):
    fields = fields or (list(rows[0]) if rows else [])
    if not fields:
        raise ValueError('An empty export still needs its defined columns')
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('w',encoding='utf-8',newline='') as stream:
        writer=csv.DictWriter(stream,fieldnames=fields,lineterminator='\n')
        writer.writeheader(); writer.writerows(rows)


def numeric(value: str):
    try:
        return bool(value.strip()) and Decimal(value).is_finite()
    except (InvalidOperation, ValueError):
        return False


def row_key(row):
    return (row['source_file'], row['source_row'])


def month_values(start: date, end: date):
    return [f'{year:04d}-{month:02d}' for year in range(start.year,end.year+1)
            for month in range(1,13) if start.strftime('%Y-%m') <= f'{year:04d}-{month:02d}' <= end.strftime('%Y-%m')]


def count_support(rows):
    return {'records':len(rows), 'stations':len({r[STATION] for r in rows}),
        'station_days':len({(r[STATION],r[DATE]) for r in rows}),
        'activities':len({(r['OrganizationIdentifier'],r['ActivityIdentifier']) for r in rows}),
        'blank_units':sum(not r[UNIT].strip() for r in rows),
        'nonnumeric_or_blank_value':sum(not numeric(r[VALUE]) for r in rows),
        'explicit_detection_condition':sum(bool(r[DETECTION]) for r in rows),
        'unqualified_numeric_with_unit':sum(numeric(r[VALUE]) and bool(r[UNIT].strip())
              and not r[DETECTION] and not r['MeasureQualifierCode'] for r in rows)}


def compute(root: Path):
    original=read_json(root/'input-manifest.json')
    for descriptor in original['source_files']:
        checked(root,descriptor)
    station_study=read_json(root/'inputs/station-study.json')
    network=read_json(root/'inputs/receptor-network.json')
    measurements=csv_rows(root/'inputs/observations.csv')
    links=station_study['observation_links']
    if len(measurements)!=len(links):
        raise ValueError('Original observation and native-link counts differ')
    indexed={row_key(r):r for r in measurements}
    if len(indexed)!=len(measurements):
        raise ValueError('Source file/row identities are not unique')
    link_index={row_key(r['original']):r for r in links}
    if set(indexed)!=set(link_index):
        raise ValueError('Native observation links select another original row cohort')
    for key,row in indexed.items():
        if any(link_index[key]['original'].get(k)!=v for k,v in row.items()):
            raise ValueError('Native observation content differs from the original CSV')
    stations={s['station_id']:s for s in station_study['stations']}
    labels={s['station_id']:s.get('label',s['station_id']) for s in station_study['selection']['sites']}
    watersheds=csv_rows(root/'inputs/watershed-network.csv')
    huc_index={r['huc12']:r for r in watersheds}
    receptors={r['utility_id']:r for r in network['areas']}
    receptor_hucs={u:set(r['huc12s']) for u,r in receptors.items()}
    memberships=csv_rows(root/'inputs/receptor-memberships.csv')
    declared=station_study['selection']['microbial_context']['period']
    start,end=date.fromisoformat(declared['start']),date.fromisoformat(declared['end'])
    months=month_values(start,end)
    by_station=defaultdict(list); by_huc=defaultdict(list); by_utility=defaultdict(list)
    extended=[]; provenance=Counter(); covered_hucs=set()
    for r in measurements:
        if not start<=date.fromisoformat(r[DATE])<=end:
            raise ValueError('Observation date lies outside the retained study window')
        link=link_index[row_key(r)]; station=link['station_id']
        if station not in stations:
            raise ValueError('Native link has no retained station')
        hucs=sorted({x['watershed_id'] for x in link['watersheds']})
        if any(h not in huc_index for h in hucs):
            raise ValueError('Native station watershed is absent from the original network')
        utilities=sorted(u for u,hs in receptor_hucs.items() if set(hucs)&hs)
        provenance[(r['utility_id'],';'.join(utilities))]+=1
        by_station[station].append(r)
        for h in hucs: by_huc[h].append(r);covered_hucs.add(h)
        for u in utilities: by_utility[u].append(r)
        extended.append({**r,'coverage_station_id':station,'coverage_huc12s':';'.join(hucs),
            'coverage_receptors':';'.join(utilities),'coverage_location_status':link['location_status'],
            'coverage_watershed_status':link['watershed_status'],
            'coverage_native_link_row':link['row_number']})
    station_rows=[]; monthly=[]; method_rows=[]; yearly=[]; gap_rows=[]
    for station,s in sorted(stations.items()):
        rows=by_station[station];dates=sorted({date.fromisoformat(r[DATE]) for r in rows})
        hucs=sorted({h['watershed_id'] for h in s['watersheds']})
        us=sorted(u for u,hs in receptor_hucs.items() if hs&set(hucs))
        active_months={r[DATE][:7] for r in rows}
        station_rows.append({'station_id':station,'station_name':labels.get(station,station),
            'receptors':';'.join(us),'huc12s':';'.join(hucs),'native_status':s['status'],
            **count_support(rows),'first_sample':dates[0].isoformat() if dates else '',
            'last_sample':dates[-1].isoformat() if dates else '',
            'sampled_months':len(active_months),'window_months':len(months),
            'months_without_retained_sample':len(months)-len(active_months),
            'largest_between_sample_gap_days':max(((b-a).days for a,b in zip(dates,dates[1:])),default=''),
            'end_of_window_gap_days':(end-dates[-1]).days if dates else '',
            'methods':';'.join(sorted({r[METHOD_CONTEXT]+':'+r[METHOD] for r in rows})),
            'raw_units':';'.join(sorted({r[UNIT] or '[blank]' for r in rows}))})
        for month in months:
            rr=[r for r in rows if r[DATE].startswith(month)]
            monthly.append({'station_id':station,'receptors':';'.join(us),'month':month,**count_support(rr)})
    coverage=[]
    for u,receptor in receptors.items():
        hs=receptor_hucs[u]; rr=by_utility[u];covered=hs&covered_hucs
        ss=[s for s in station_rows if u in s['receptors'].split(';')]
        coverage.append({'utility_id':u,'receptor_id':receptor['id'],'upstream_huc12_count':len(hs),
          'huc12_with_retained_sample':len(covered),'huc12_without_retained_sample':len(hs-covered),
          'huc12_sampled_fraction':len(covered)/len(hs),**count_support(rr),
          'observed_station_months':sum(s['sampled_months'] for s in ss),
          'selected_station_months':len(ss)*len(months),
          'first_sample':min((r[DATE] for r in rr),default=''),'last_sample':max((r[DATE] for r in rr),default='')})
        for year in range(start.year,end.year+1):
            group=[r for r in rr if r[DATE].startswith(str(year))]
            yearly.append({'utility_id':u,'year':year,**count_support(group)})
        grouped=defaultdict(list)
        for r in rr:grouped[(r[METHOD_CONTEXT],r[METHOD],r[UNIT],r[DETECTION])].append(r)
        for (context,method,unit,detection),group in sorted(grouped.items()):
            method_rows.append({'utility_id':u,'method_context':context,'method':method,
                'raw_unit':unit,'detection_condition':detection,**count_support(group)})
        for m in memberships:
            if m['receptor_id']==receptor['id'] and m['huc12'] not in covered:
                gap_rows.append({'utility_id':u,**m,'review_status':'No retained E. coli sample in this selected 2021-2025 cohort',
                  'planning_use':'Review source acquisition and geographic representation before locating a new station'})
    watershed_rows=[]
    for h,row in sorted(huc_index.items()):
        rr=by_huc[h];us=sorted(u for u,hs in receptor_hucs.items() if h in hs)
        watershed_rows.append({**row,'selected_receptors':';'.join(us),**count_support(rr),
            'retained_sample_present':bool(rr),
            'first_sample':min((r[DATE] for r in rr),default=''),
            'last_sample':max((r[DATE] for r in rr),default='')})
    result={'schema':VERSION,'title':TITLE,'project_id':original['project_id'],
        'period':declared,'station_study_id':original['station_study_id'],
        'receptor_network_id':original['receptor_network_id'],'input_archive_sha256':original['archive_sha256'],
        'summary':count_support(measurements),'network_huc12_count':len(huc_index),
        'network_huc12_with_retained_sample':len(covered_hucs),'coverage':coverage,
        'source_utility_vs_geographic_membership':[{'source_utility':u,'geographic_receptors':g,'records':n}
              for (u,g),n in sorted(provenance.items())],
        'method_detection_rows':method_rows,'yearly_rows':yearly,
        'geographic_gap_rows':gap_rows,'station_rows':station_rows,
        'interpretation':{
          'coverage':'Counts refer only to the retained selected cohort, not the complete existence or absence of monitoring.',
          'geographic':'Use the saved native point/polygon memberships and original receptor upstream HUC12 sets. Overlap memberships remain separate.',
          'temporal':'Calendar months in the declared 2021-2025 window; zero means no retained selected record. Station-month coverage is not watershed area coverage.',
          'measurement':'Original methods, units, numeric strings and detection conditions stay separate. No concentration or detection-limit substitution, pooling, regulatory threshold or annual-load inference.',
          'calendar':'No contemporary recency conclusion beyond the declared December 31, 2025 study end.',
          'planning':'Gap rows are a source-acquisition and representation review list, not risk rankings or approved new sampling locations.'}}
    exports={'observation-lineage.csv':extended,'station-coverage.csv':station_rows,
        'station-month-coverage.csv':monthly,'watershed-coverage.csv':watershed_rows,
        'utility-year-coverage.csv':yearly,'method-detection-support.csv':method_rows,
        'receptor-coverage.csv':coverage,'geographic-review-queue.csv':gap_rows}
    for name,rows in exports.items():write_csv(root/'tables'/name,rows)
    write_json(root/'coverage.json',result)
    return result


def table(headers,rows,widths=None,caption=None):
    return {'kind':'table','columns':headers,'rows':[[v if isinstance(v,dict) else str(v) for v in row] for row in rows],
            'widths':widths,'caption':caption}


def sections_for(result):
    cover=result['coverage']; missing=result['geographic_gap_rows'];stat=result['summary']
    gaps='; '.join(f"{r['utility_id']}: {r['huc12_without_retained_sample']} of {r['upstream_huc12_count']} upstream HUC12 units" for r in cover)
    collapsed=defaultdict(Counter)
    for row in result['method_detection_rows']:
        key=(row['utility_id'],row['method'],row['raw_unit'] or '[blank]')
        for k in ('records','explicit_detection_condition','nonnumeric_or_blank_value'):collapsed[key][k]+=row[k]
    return [
      ['Decision brief',[
        f"The saved regional project links {stat['records']} original E. coli records to {stat['stations']} stations. These are sampled concentrations and detection conditions for January 2021 through December 2025.",
        f"The retained cohort has geographic representation gaps: {gaps} contain no selected E. coli sample. Review the complete HUC12 queue before choosing targeted source acquisition or field expansion.",
        f"{stat['explicit_detection_condition']} records carry an explicit detection condition; {stat['blank_units']} have a blank reported unit. Keep these original qualifiers visible in every comparison rather than treating them as interchangeable numeric concentrations.",
        'The original utility labels agree with the saved native receptor membership for every retained record. Receptor coverage is calculated from the saved original upstream watershed sets, not from the label alone.',
        'Existing station geography, receptor definitions and sampled values remain unchanged. This report adds the full coverage and review tables to the same workbench source family.']],
      ['Geographic and temporal support',[
        table(['Utility','Upstream HUC12s','Sampled HUC12s','Stations','Records','Station-months'],
          [[r['utility_id'],r['upstream_huc12_count'],r['huc12_with_retained_sample'],r['stations'],r['records'],
            str(r['observed_station_months'])+' / '+str(r['selected_station_months'])] for r in cover],
          [0.7,1,1,0.7,0.7,1.2], 'Sampled HUC12 count is geographic representation, not representative area or continuous surveillance. Station-months use the full 60-month window for each retained station.'),
        table(['Utility','Year','Records','Stations','Station-days','Detection condition'],
          [[r['utility_id'],r['year'],r['records'],r['stations'],r['station_days'],r['explicit_detection_condition']] for r in result['yearly_rows']],
          [0.8,0.6,0.7,0.7,0.9,1.3]),
        'A station may have several records on the same day; station-days and original activities are separate fields in the complete exports. Zero cells in the calendar mark missing selected observations, not a measured zero concentration.']],
      ['Methods and original result conditions',[
        table(['Utility','Method','Original unit','Records','Detection condition','Blank/non-numeric value'],
           [[*k,v['records'],v['explicit_detection_condition'],v['nonnumeric_or_blank_value']] for k,v in sorted(collapsed.items())],
           [0.7,0.7,1,0.7,1.1,1.2]),
        table(['Original detection condition','Records'],
          [[label,sum(r['records'] for r in result['method_detection_rows'] if (r['detection_condition'] or '[not supplied]')==label)]
           for label in sorted({r['detection_condition'] or '[not supplied]' for r in result['method_detection_rows']})], [3,1]),
        'The detailed table further separates method context, raw unit and each detection condition. Original numeric strings, reporting-limit fields and source-row identities remain in observation-lineage.csv.']],
      ['Geographic review queue',[
        'These whole HUC12 units are in the retained utility upstream selections but have no sample in the selected E. coli cohort. Confirm additional available source records and existing stations first; scientific staff retain field-location and method choices.',
        table(['Utility','HUC12','Original watershed name','Anchor'],
            [[r['utility_id'],r['huc12'],r['name'],r['is_anchor']] for r in missing], [0.7,1.3,2.8,0.6]),
        'All 217 original watershed rows are available in watershed-coverage.csv. The queue above selects utility-focus units only and is sorted by original identifier, not a pollution or investment score.']],
      ['Use in the existing workbench',[
        'Import sources.json through Original sources. Select Utility monitoring coverage in Scientific Reports to compose these sections with the current regional or model report. The same original source bodies, native station-study identity and receptor-network identity travel with the source.',
        'For monitoring design, use geographic-review-queue.csv with the existing network and fieldwork planning controls. Use station-month-coverage.csv to inspect seasonal representation and station-coverage.csv to inspect original sampling gaps. The current fieldwork owner selects any new location, target frequency and laboratory contract.',
        'Use the retained named methods for within-method analysis. Resolve missing-unit and nonnumeric records from their original source before deriving any concentration statistic.',
        {'kind':'links','items':[{'title':name.replace('-',' ').replace('.csv','').capitalize(),'path':'tables/'+name} for name in
          ('receptor-coverage.csv','utility-year-coverage.csv','station-coverage.csv','station-month-coverage.csv','watershed-coverage.csv','geographic-review-queue.csv','method-detection-support.csv','observation-lineage.csv')]}]],
      ['Scope and reproduction', list(result['interpretation'].values())+[
        'Rebuild with the supplied Python source against input-manifest.json. The programme reads only the retained files. Complete native source import, bound report composition and independent receiving use the maintained workbench APIs.',
        'Original project: '+result['project_id']+'. Native station study: '+result['station_study_id']+'. Receptor network: '+result['receptor_network_id']+'.']]
    ]


def make_figures(root:Path, result):
    from model.scientific_figures import panel_drawing
    from reportlab.graphics import renderSVG
    figures=[]; choices=[]
    for u in sorted(r['utility_id'] for r in result['coverage']):
        rows=[r for r in result['yearly_rows'] if r['utility_id']==u]
        maximum=max(r['records'] for r in rows);top=((maximum+19)//20)*20
        panel={'title':u+' retained E. coli result records','x':{'domain':[2020.7,2025.3],'label':'Calendar year','ticks':[{'value':r['year'],'label':str(r['year'])} for r in rows]},
            'y':{'domain':[0,top],'label':'Records','ticks':[{'value':v,'label':str(v)} for v in range(0,top+1,20)]},
            'series':[{'label':'Original retained records','geometry':'scatter','points':[{'x':r['year'],'y':r['records']} for r in rows]}]}
        fig={'id':u.lower()+'-annual-counts','title':u+' annual sampling support',
           'caption':'Original record counts by sampling year, including original detection conditions. These points describe retained sampling effort rather than a concentration trend.','panels':[panel]}
        name='figures/'+u.lower()+'-annual-records.svg';p=root/name;p.parent.mkdir(exist_ok=True)
        renderSVG.drawToFile(panel_drawing(panel,720),str(p))
        figures.append(fig);choices.append({'id':fig['id'],'path':name})
    write_json(root/'figure-spec.json',{'schema':'upstate.scientific-figure-spec/v1','figures':figures})
    return figures, choices



def compact_report_links(sections):
    """Keep each downloadable table and its path in one page-safe report row."""
    result = []
    for heading, blocks in sections:
        copied = []
        for block in blocks:
            if isinstance(block,dict) and block.get('kind') == 'links':
                copied.append(table(['Dataset','Retained file'],
                    [[{'kind':'link','label':item['title'],'href':item['path']}, item['path']]
                     for item in block['items']], [2,3]))
            else:
                copied.append(block)
        result.append([heading,copied])
    return result


def stage_workspace(root:Path, workspace:Path, station_study:str, receptor_network:str,
                    archive_sha256:str|None=None):
    """Stage exact original source bodies from one selected saved native study."""
    for value in (station_study,receptor_network):
        if len(value)!=64 or any(c not in '0123456789abcdef' for c in value):
            raise ValueError('Select the complete saved study and network identifiers')
    if (root/'input-manifest.json').exists():
        existing=read_json(root/'input-manifest.json')
        if existing['station_study_id']!=station_study or existing['receptor_network_id']!=receptor_network:
            raise ValueError('Package contains a different selected study; use a separate destination')
        return
    if (root/'inputs').exists() and any((root/'inputs').iterdir()):
        raise ValueError('Preserve the existing incomplete input directory before staging a new package')
    analysis=workspace/'station-geography'/station_study/'analysis.json'
    network=workspace/'receptor-networks'/receptor_network/'result.json'
    a=read_json(analysis); n=read_json(network)
    if a['build_id']!=station_study or n['id']!=receptor_network:
        raise ValueError('Native study identity differs from its selected directory')
    if a['selection']['microbial_context']['period'] != {'start':'2021-01-01','end':'2025-12-31'}:
        raise ValueError('This report edition selects the original 2021-2025 utility E. coli cohort')
    inputs=root/'inputs'; inputs.mkdir(parents=True,exist_ok=True)
    for src,name in [(analysis,'station-study.json'),(network,'receptor-network.json'),
        (network.parent/'network.csv','watershed-network.csv'),
        (network.parent/'memberships.csv','receptor-memberships.csv'),
        (network.parent/'source-domain.esri.json.gz','model-domain.esri.json.gz')]:
        shutil.copyfile(src,inputs/name)
    sources=[];seen=set()
    for e in a['sources']:
        key=(e['collection_id'],e['source_id'])
        if key in seen:continue
        seen.add(key)
        for f in [e['body']]+e.get('companions',[]):
            src=(workspace/f['object']).resolve(strict=True)
            if not src.is_relative_to(workspace.resolve()):
                raise ValueError('Original source leaves the selected workspace')
            payload=src.read_bytes()
            if len(payload)!=f['bytes'] or hashlib.sha256(payload).hexdigest()!=f['sha256']:
                raise ValueError('Original source differs: '+f['filename'])
            dst=inputs/'objects'/f['sha256'];dst.parent.mkdir(exist_ok=True)
            if not dst.exists():dst.write_bytes(payload)
        sources.append(e)
    write_json(inputs/'original-source-catalog.json',sources)
    observation=next(e for e in sources if e['source_id']=='utility-ecoli-observations')
    shutil.copyfile(inputs/'objects'/observation['source_sha256'],inputs/'observations.csv')
    root.joinpath('source').mkdir(exist_ok=True)
    shutil.copyfile(Path(__file__),root/'source/utility_monitoring_coverage.py') if Path(__file__).resolve()!=root.joinpath('source/utility_monitoring_coverage.py').resolve() else None
    write_json(root/'input-manifest.json',{'schema':'upstate.utility-monitoring-inputs/v1',
       'project_id':a['project_id'],'station_study_id':station_study,'receptor_network_id':receptor_network,
       'archive_sha256':archive_sha256,'source_files':[ident(p,root) for p in sorted(inputs.rglob('*')) if p.is_file()]})


def build(root:Path):
    result=compute(root)
    sections=sections_for(result)
    figures,choices=make_figures(root,result)
    catalog=read_json(root/'inputs/original-source-catalog.json')
    sources=[{'id':e['source_id'],'source_id':e['source_id'],'title':e['title'],'uri':e['uri'],
              'vintage':'Original source retained in the regional project, October 13, 2026',
              'sha256':e['source_sha256']} for e in catalog]
    source_files=[p for p in sorted(root.rglob('*')) if p.is_file() and
                  (p.parts[len(root.parts)] in ('inputs','tables','source','figures') or p.name in ('coverage.json','input-manifest.json','figure-spec.json','OPERATING.md'))]
    recipe={'schema':'upstate.observed-report/v1','title':TITLE,'edition':VERSION,'sections':sections,
      'inputs':[ident(p,root) for p in source_files], 'figures':choices,'figure_spec':'figure-spec.json',
      'source_links':['inputs/original-source-catalog.json','input-manifest.json','coverage.json','source/utility_monitoring_coverage.py'],
      'coverage_binding':{k:result[k] for k in ('project_id','station_study_id','receptor_network_id','input_archive_sha256')}}
    write_json(root/'observed-report.json',recipe)
    doc=ident(root/'observed-report.json',root)
    manifest={'schema':'upstate.sources/v1','title':TITLE,'vintage':'2021-2025 observations; coverage built October 13, 2026',
        'entries':[{'id':SOURCE_ID,'kind':'document','role':'OBSERVED_CONTEXT','title':TITLE,
            **doc,'uri':'urn:sha256:'+doc['sha256'],'vintage':'2021-2025 original samples',
            'metadata':{'scientific_scope':'observed_monitoring_coverage','producer':VERSION,
                        'project_id':result['project_id'],'station_study_id':result['station_study_id']},
            'companions':[ident(p,root) for p in source_files]}]}
    write_json(root/'sources.json',manifest)
    from model.scientific_report import write_companions,report_pdf
    rich=compact_report_links(sections)
    blocks=[]
    for fig,choice in zip(figures,choices):
        desc=ident(root/choice['path'],root)
        blocks.append({'kind':'figure',**desc,'title':fig['title'],'caption':fig['caption'],'alt':fig['caption'],'spec':fig})
    rich.insert(2,['Retained sampling effort',blocks])
    contact={'organization':'TokenJunkie Labs'}
    write_companions(root,TITLE,rich,contact=contact,source_records=sources,binding=recipe['coverage_binding'])
    # The shared renderer's general model subtitle does not describe a source-only study.
    html=root/'report.html'
    html.write_text(html.read_text().replace('Scientific model results, scenario changes and retained source editions.',
         'Observed monitoring coverage, retained sampling methods and original source editions.'),encoding='utf-8')
    report_pdf(root/'Utility_Monitoring_Coverage.pdf',TITLE,rich,contact=contact,source_records=sources)
    write_json(root/'delivery-manifest.json',{'schema':'upstate.utility-monitoring-delivery/v1','files':[
        ident(p,root) for p in sorted(root.rglob('*')) if p.is_file() and p.name!='delivery-manifest.json']})
    return {'schema':VERSION,'output':str(root),'summary':result['summary'],'coverage':result['coverage'],
            'review_queue_rows':len(result['geographic_gap_rows']),
            'source_manifest':ident(root/'sources.json',root)}


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--package',type=Path,required=True)
    p.add_argument('--workspace',type=Path)
    p.add_argument('--station-study')
    p.add_argument('--receptor-network')
    p.add_argument('--input-archive-sha256')
    args=p.parse_args()
    try:
        if args.workspace:
            if not args.station_study or not args.receptor_network:
                raise ValueError('Workspace staging requires the saved station-study and receptor-network IDs')
            stage_workspace(args.package.resolve(),args.workspace.resolve(),args.station_study,args.receptor_network,args.input_archive_sha256)
        print(json.dumps(build(args.package.resolve()),indent=2))
    except (ValueError,OSError,KeyError,ImportError) as error:
        print(json.dumps({'state':'error','error':str(error),'type':type(error).__name__}),file=sys.stderr)
        return 2
    return 0

if __name__=='__main__':
    raise SystemExit(main())
