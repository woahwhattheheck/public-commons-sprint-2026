#!/usr/bin/env python3
"""Build a complete offline watershed review desk from the retained original sources.

Usage: python build.py --report-zip REPORT.zip --geography-zip GEOGRAPHY.zip --output DIR
Python dependencies: shapely, pyproj. The preference analysis uses Node.js with no packages.
"""
from __future__ import annotations
import argparse, csv, gzip, hashlib, io, json, math, shutil, subprocess, sys, zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from pyproj import Transformer
from shapely.geometry import Polygon, mapping
from shapely.ops import transform
from shapely.geometry.polygon import orient

SCHEMA = 'upstate.watershed-review-dataset/v1'
HERE = Path(__file__).resolve().parent
TEXT_FIELDS = {'huc12','name','states'}
EXPECTED_COUNTS = {'rows':217,'groups':1736,'points':197}

def sha(body: bytes) -> str:
    return hashlib.sha256(body).hexdigest()

def read_csv(body: bytes) -> list[dict[str,str]]:
    return list(csv.DictReader(io.StringIO(body.decode('utf-8-sig'))))

def unique_path(z: zipfile.ZipFile, suffix: str) -> str:
    matches = [n for n in z.namelist() if n.endswith(suffix)]
    if len(matches) != 1:
        raise ValueError(f'Expected one original {suffix}; found {len(matches)}')
    return matches[0]

def numeric_rows(rows: list[dict[str,str]]) -> list[dict[str,Any]]:
    output=[]
    for row in rows:
        r={}
        for k,v in row.items():
            if k in TEXT_FIELDS or k=='group':r[k]=v
            elif v.startswith('['):r[k]=json.loads(v)
            else:
                number=float(v)
                if not math.isfinite(number):raise ValueError(f'Nonfinite source {k}')
                r[k]=int(number) if k.endswith('_count') or k.endswith('_cells') else number
        output.append(r)
    return output

def save_json(path:Path,value:Any) -> None:
    path.write_text(json.dumps(value,ensure_ascii=False,separators=(',',':'),allow_nan=False)+'\n',encoding='utf-8')

def build(report_zip:Path, geography_zip:Path, out:Path) -> None:
    out.mkdir(parents=True,exist_ok=False)
    (out/'source').mkdir();(out/'original').mkdir();(out/'analysis').mkdir();(out/'data').mkdir()
    report_bytes=report_zip.read_bytes();geo_bytes=geography_zip.read_bytes()
    inputs={'report':{'name':report_zip.name,'bytes':len(report_bytes),'sha256':sha(report_bytes)},'geography':{'name':geography_zip.name,'bytes':len(geo_bytes),'sha256':sha(geo_bytes)}}
    edition=sha((inputs['report']['sha256']+':'+inputs['geography']['sha256']).encode())
    with zipfile.ZipFile(io.BytesIO(report_bytes)) as zr:
        prefix=unique_path(zr,'observations/landcover_observation_profiles_20261013/watershed-profiles.csv').split('observations/')[0]
        profile=prefix+'observations/landcover_observation_profiles_20261013/'
        rows=numeric_rows(read_csv(zr.read(profile+'watershed-profiles.csv')))
        groups=numeric_rows(read_csv(zr.read(profile+'landcover-groups.csv')))
        points=read_csv(zr.read(profile+'original-location-context.csv'))
        utilities=json.loads(zr.read(profile+'report/utility-context.json'))
        links=read_csv(zr.read(prefix+'outputs/watershed-connectivity-20261013/watershed-connectivity-217.csv'))
        input_manifest=json.loads(zr.read(profile+'input-manifest.json'))
        source_members={name:zr.read(profile+name) for name in ['watershed-profiles.csv','landcover-groups.csv','original-location-context.csv','input-manifest.json','README.md','report/utility-context.json','report/utility-scope-summary.csv','report/domain-group-balances.csv']}
    for k,items in [('rows',rows),('groups',groups),('points',points)]:
        if len(items)!=EXPECTED_COUNTS[k]:raise ValueError(f'Original edition has unexpected {k} count: {len(items)}')
    ids=[r['huc12'] for r in rows]
    if len(set(ids))!=217 or any(len(x)!=12 or not x.isdigit() for x in ids):raise ValueError('HUC12 identifiers must be unique 12-character strings')
    if len({x['huc12'] for x in links})!=217:raise ValueError('Connectivity does not cover the same full edition')
    scopes={'all':{'label':'Whole retained domain · 217','ids':ids,'kind':'retained_model_domain'}}
    for u in utilities['utilities']:
        for key,kind,label in [('focus','selected','focus'),('upstream','contributing_union','upstream union')]:
            selected=u[kind]['huc12s']
            if len(set(selected))!=len(selected) or not set(selected)<=set(ids):raise ValueError('Utility union is not a unique subset of the domain')
            scopes[u['utility_id'].lower()+'-'+key]={'label':f"{u['utility_id']} {label} · {len(selected)}",'ids':selected,'kind':'whole_huc12_'+label.replace(' ','_'),'reference':u['reference']}
    union=sorted(set(h for u in utilities['utilities'] for h in u['contributing_union']['huc12s']))
    scopes['utility-union']={'label':f'Both upstream unions · {len(union)}','ids':union,'kind':'deduplicated_whole_huc12_upstream_union'}
    with zipfile.ZipFile(io.BytesIO(geo_bytes)) as zg:
        selections=json.loads(zg.read(unique_path(zg,'source-selections.json')))
        domain=[s for s in selections['selections'] if s.get('role')=='MODEL_DOMAIN']
        if len(domain)!=1:raise ValueError('Expected one original domain source')
        domain=domain[0]
        compressed=zg.read('workspace/'+domain['object'])
        if len(compressed)!=domain['body_bytes'] or sha(compressed)!=domain['body_sha256']:raise ValueError('Original geometry source identity mismatch')
        raw=gzip.decompress(compressed) if domain['member'].endswith('.gz') else compressed
        if sha(raw)!=domain['decoded_sha256']:raise ValueError('Decoded geometry identity mismatch')
        esri=json.loads(raw)
    if esri['spatialReference'].get('latestWkid',esri['spatialReference'].get('wkid'))!=3857:raise ValueError('Expected the retained native Web Mercator geometry')
    project=Transformer.from_crs(3857,4326,always_xy=True).transform
    polygons={};feature_by_id={}
    for f in esri['features']:
        h=f['attributes']['huc12'];rings=f['geometry']['rings']
        # The original edition consists of one closed ring per watershed.
        # Do not silently reinterpret a future multipart or holed source edition.
        if len(rings)!=1 or rings[0][0]!=rings[0][-1]:raise ValueError(f'Unexpected original ring structure for {h}')
        poly=Polygon(rings[0])
        if not poly.is_valid or poly.is_empty:raise ValueError(f'Invalid original geometry for {h}')
        polygons[h]=poly
        feature_by_id[h]={'type':'Feature','properties':f['attributes'],'geometry':mapping(orient(transform(project,poly),sign=1))}
    if set(polygons)!=set(ids):raise ValueError('Geographic HUC12 set differs from profile set')
    xmin=min(p.bounds[0] for p in polygons.values());ymin=min(p.bounds[1] for p in polygons.values());xmax=max(p.bounds[2] for p in polygons.values());ymax=max(p.bounds[3] for p in polygons.values())
    scale=min(820/(xmax-xmin),600/(ymax-ymin));left=(900-(xmax-xmin)*scale)/2;top=(650-(ymax-ymin)*scale)/2
    display=[]
    for h in ids:
        simple=polygons[h].simplify(60,preserve_topology=True)
        xy=[(left+(x-xmin)*scale,top+(ymax-y)*scale) for x,y in simple.exterior.coords]
        d='M'+'L'.join(f'{x:.2f},{y:.2f}' for x,y in xy)+'Z'
        display.append({'id':h,'path':d,'source_vertex_count':len(polygons[h].exterior.coords),'display_vertex_count':len(xy)})
    collection={'type':'FeatureCollection','name':'Original Upper Savannah 217-HUC domain','source_edition':edition,'coordinate_operation':'EPSG:3857 to EPSG:4326 using pyproj always_xy; all original vertices retained; source IDs and attributes unchanged.','features':[feature_by_id[h] for h in ids]}
    dataset={'schema':SCHEMA,'edition':edition,'inputs':inputs,'source_collection':domain['source_collection_id'],'source_decoded_sha256':domain['decoded_sha256'],'classification_years':[2023,2025],'assessment_edition':utilities['assessment_edition'],'rows':rows,'groups':groups,'points':points,'connectivity':{r['huc12']:r for r in links},'utilities':utilities,'scopes':scopes,'display':display,'geojson':collection}
    save_json(out/'data/dataset.json',dataset);save_json(out/'data/original-watersheds.geojson',collection);save_json(out/'data/original-source-input-manifest.json',input_manifest)
    for n,b in source_members.items():
        path=out/'data'/n;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(b)
    shutil.copyfile(report_zip,out/'original'/report_zip.name);shutil.copyfile(geography_zip,out/'original'/geography_zip.name)
    for n in ['build.py','review_core.mjs','compute.mjs','desk.html']:
        shutil.copyfile(HERE/n,out/'source'/n)
    # Include complete source bodies, not just an instruction or a patch.
    source_bank={'schema':'upstate.complete-source-bank/v1','source_edition':edition,'files':{n:(HERE/n).read_text() for n in ['build.py','review_core.mjs','compute.mjs','desk.html']}}
    save_json(out/'Complete_Source.json',source_bank)
    core=(HERE/'review_core.mjs').read_text().replace('export const ','const ').replace('export function ','function ')
    body=json.dumps(dataset,ensure_ascii=False,separators=(',',':'),allow_nan=False).replace('<','\\u003c').replace('\u2028','\\u2028').replace('\u2029','\\u2029')
    html=(HERE/'desk.html').read_text().replace('@@DATA@@',body).replace('@@CORE@@',core)
    (out/'Upper_Savannah_Watershed_Review.html').write_text(html,encoding='utf-8')
    subprocess.run(['node',str(HERE/'compute.mjs'),str(out/'data/dataset.json'),str(out/'analysis')],check=True)
    readme=f'''# Upper Savannah watershed review desk\n\nOpen **Upper_Savannah_Watershed_Review.html** in a current desktop or mobile browser. It is a complete offline desk; no installation, account or server is needed.\n\n## Use the actual workflow\n\nSelect the domain or a utility's focus/upstream union. Set absolute or area-normalized criteria and preference weights. Inspect the map and original records. Add a reviewer question, choose a disposition and queue the watershed. The desk attempts browser-local autosave as you type and reports when local storage is unavailable. Save the review JSON, reopen it in a fresh browser session, and export the current view or complete queue. GeoJSON retains every original vertex after the declared CRS transformation, with counterclockwise exterior winding.\n\nThe initial equal-weight lens is editable. Rankings are transparent analyst preferences over classified land-cover differences, not native pollutant simulations or a recommendation of treatment efficacy. All 66 weight choices are enumerated; their frequencies are not probabilities. A tie at the top-K boundary includes all tied members. Empty monitoring inventories do not establish absence of monitoring. The 2026 assessment remains a draft edition.\n\n## Full data and source\n\nThe data folder retains all 217 profiles, 1,736 class-group balances, 197 original point/coordinate-variant records, original utility context, full-resolution GeoJSON and the complete joined dataset. The original folder carries both unchanged input ZIPs. Their published report and source records remain independently available. This desk adds review decisions and a reproducible preference-comparison workflow.\n\nAnalysis includes twelve completed scope/basis combinations, each with the complete 66-choice sensitivity results and explicit selection. The combined upstream union is deduplicated. No modeled production run was repeated. Review CSVs retain HUC12 as a string in source; select Text when opening that column in a spreadsheet.\n\n## Rebuild\n\nRequired: Python with shapely and pyproj; Node.js. No Node packages are required. From this delivery directory:\n\n```sh\npython source/build.py \\\n  --report-zip original/{report_zip.name} \\\n  --geography-zip original/{geography_zip.name} \\\n  --output /absolute/new-output-directory\n```\n\nThe destination must not exist. The producer validates the retained edition and materializes complete source and data. Re-running `node source/compute.mjs data/dataset.json /absolute/analysis-directory` recalculates the preference grids without any scientific solver or online service.\n\n## Source identity\n\nEdition: `{edition}`\n\nReport ZIP: {len(report_bytes)} bytes; SHA-256 `{inputs['report']['sha256']}`.\n\nGeography ZIP: {len(geo_bytes)} bytes; SHA-256 `{inputs['geography']['sha256']}`.\n\nOriginal domain source collection: `{domain['source_collection_id']}`.\n\nDomain decoded ESRI JSON: `{domain['decoded_sha256']}`.\n\nOperation: ECO-CLOUD-REVIEW13. Current owner direction 2026-10-13.3. Internal delivery to the original Ecosystem Sciences workstream.\n'''
    (out/'START_HERE.md').write_text(readme,encoding='utf-8')
    manifest={'schema':'upstate.watershed-review-delivery/v1','source_edition':edition,'created_at':datetime.now(timezone.utc).isoformat(),'source_inputs':inputs,'counts':EXPECTED_COUNTS,'complete_weight_choices':66,'scope_basis_analyses':12,'original_geometry_vertices':sum(len(p.exterior.coords) for p in polygons.values()),'display_geometry_vertices':sum(x['display_vertex_count'] for x in display),'files':[]}
    for p in sorted(out.rglob('*')):
        if p.is_file():
            b=p.read_bytes();manifest['files'].append({'path':p.relative_to(out).as_posix(),'bytes':len(b),'sha256':sha(b)})
    save_json(out/'MANIFEST.json',manifest)
    print(json.dumps({'output':str(out),'source_edition':edition,'source_counts':EXPECTED_COUNTS,'files':len(manifest['files']),'display_vertices':manifest['display_geometry_vertices'],'original_vertices':manifest['original_geometry_vertices']},indent=2))

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--report-zip',type=Path,required=True);parser.add_argument('--geography-zip',type=Path,required=True);parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    try:build(args.report_zip.resolve(),args.geography_zip.resolve(),args.output.resolve())
    except (ValueError,OSError,KeyError,subprocess.CalledProcessError) as exc:
        print(f'Build stopped: {exc}',file=sys.stderr);raise SystemExit(1)
