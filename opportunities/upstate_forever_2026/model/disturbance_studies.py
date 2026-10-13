"""Future land-cover disturbance/protection courses using the original Workspace.

The module prepares retained binary masks and ordinary native run selections.
Execution belongs to the original operator's run.start actions. No model engine,
worker, queue or parameter table is replaced.
"""
from __future__ import annotations
import argparse
import copy
import csv
import io
import json
import math
from pathlib import Path
import shutil
import zipfile

from .common import atomic_json, canonical, describe_file, digest, file_digest, held, identifier, now, read_json, verify_file

VERSION = '1.0.0'
ROOT = 'disturbance-studies'
POLICIES = ('unrestricted', 'retain_buffer', 'relocate_outside_buffer')
QUANTITIES = {'nitrogen_export': 'kg/year', 'phosphorus_export': 'kg/year', 'sediment_export': 'tonnes/year'}
GUIDES = {name: 'https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/' + name + '.html' for name in ('ndr','sdr')}


def location(ws, key):
    return ws.root / ROOT / identifier(key)


def get(ws, key):
    value = read_json(location(ws, key) / 'study.json')
    if digest(value['spec']) != identifier(key):
        raise ValueError('The retained disturbance selection has changed')
    return value


def catalogue(ws):
    studies = []
    for path in sorted((ws.root / ROOT).glob('*/study.json')):
        value = get(ws, path.parent.name)
        ids = sorted({row['run_id'] for row in value['cases']})
        states = {key: ws.inspect_run(key)['state'] for key in ids}
        studies.append({**value, 'run_states': states,
                        'completed_runs': sum(state == 'complete' for state in states.values()),
                        'unique_runs': len(ids)})
    runs = []
    for path in sorted((ws.root / 'runs').glob('*/run.json')):
        run = ws.inspect_run(path.parent.name)
        scenario = ws._get('scenarios', run['selection']['scenario_id'])
        if run['state'] == 'complete' and scenario['kind'] == 'baseline':
            profile = ws._get('profiles', run['selection']['profile_id'])
            runs.append({'id': run['id'], 'title': profile['title'], 'selection': run['selection']})
    return {'version': VERSION, 'studies': studies, 'baselines': runs}


def prepare(ws, supplied):
    import numpy as np
    import rasterio
    from scipy.ndimage import distance_transform_edt

    spec = copy.deepcopy(supplied)
    if not isinstance(spec.get('title'), str) or not spec['title'].strip():
        raise ValueError('Name the disturbance study')
    if not isinstance(spec.get('reason'), str) or not spec['reason'].strip():
        raise ValueError('Describe the counterfactual and its scientific use')
    ids = spec.get('baseline_run_ids')
    if not isinstance(ids, list) or not ids or len(ids) != len(set(ids)):
        raise ValueError('Select distinct completed baseline runs')
    ids = [identifier(key) for key in ids]
    doses = spec.get('cell_counts')
    if not isinstance(doses, list) or not doses or any(type(x) is not int or x < 1 for x in doses):
        raise ValueError('Cell counts must be positive whole numbers')
    doses = sorted(set(doses))
    codes, targets = spec.get('from_codes'), spec.get('to_codes')
    if (not isinstance(codes, list) or not codes or not isinstance(targets, list) or not targets
            or any(type(x) is not int for x in codes + targets) or set(codes) & set(targets)):
        raise ValueError('Use distinct integer original and destination land-cover codes')
    width = spec.get('buffer_m')
    if type(width) not in (int,float) or not math.isfinite(width) or width < 0:
        raise ValueError('Buffer width must be a finite nonnegative distance in metres')
    # The user-selected first baseline owns mask geometry for all profile comparisons.
    spec.update(schema='upstate.disturbance-selection/v1', version=VERSION,
                baseline_run_ids=ids, cell_counts=doses, from_codes=sorted(set(codes)),
                to_codes=sorted(set(targets)), buffer_m=float(width),
                mask_method='Euclidean distance between original native stream-cell centres; ascending distance, row-major ties',
                policies=list(POLICIES))
    key = digest(spec)
    directory = location(ws, key)
    directory.mkdir(parents=True, exist_ok=True)
    with held(directory / '.prepare.lock', blocking=False):
        if (directory / 'study.json').exists():
            return get(ws, key)
        runs = [ws.inspect_run(key) for key in ids]
        first = runs[0]
        grid_id = first['selection']['grid_id']
        if any(r['state'] != 'complete' or r['selection']['grid_id'] != grid_id for r in runs):
            raise ValueError('Finish all selected baseline runs on the same retained grid')
        if len({r['selection']['profile_id'] for r in runs}) != len(runs):
            raise ValueError('Select one baseline for each parameter profile')
        for run in runs:
            original = ws._get('scenarios', run['selection']['scenario_id'])
            if original['kind'] != 'baseline':
                raise ValueError('Use original unmodified baseline land cover')
            profile = ws._get('profiles', run['selection']['profile_id'])
            if not set(targets).issubset(profile['table_summary']['lucodes']):
                raise ValueError('Every destination code needs a retained biophysical table row')
            if not set(QUANTITIES).issubset(run['artifacts']):
                raise ValueError('This coupled study requires completed NDR and SDR quantities')
        grid = ws.get_grid(grid_id)
        gd = ws.root / 'grids' / grid_id
        land = verify_file(gd, grid['files']['NLCD'])
        stream = verify_file(ws.root / 'runs' / first['id'], first['stages']['ndr']['files']['stream'])
        with rasterio.open(land) as ds:
            landcover = ds.read(1); profile = ds.profile.copy()
            valid = ds.read_masks(1) > 0
            transform, crs = ds.transform, ds.crs
        with rasterio.open(stream) as ds:
            if ds.shape != landcover.shape or ds.transform != transform or ds.crs != crs:
                raise ValueError('The original stream must use the exact land-cover grid')
            native_stream = (ds.read(1) == 1) & (ds.read_masks(1) > 0)
        if not crs or not crs.is_projected or crs.linear_units != 'metre' or transform.b or transform.d:
            raise ValueError('Distance selection requires an unrotated projected metre grid')
        if not np.any(native_stream):
            raise ValueError('The selected native stream raster contains no stream cells')
        distance = distance_transform_edt(~native_stream, sampling=(abs(transform.e), abs(transform.a)))
        eligible = valid & np.isin(landcover, codes) & ~native_stream
        flat = np.flatnonzero(eligible)
        order = flat[np.lexsort((flat, distance.ravel()[flat]))]
        outside = order[distance.ravel()[order] > width]
        if max(doses) > len(order) or max(doses) > len(outside):
            raise ValueError(f'Doses exceed available eligible cells: {len(order)} total, {len(outside)} outside the buffer')
        area = abs(transform.a * transform.e) / 10000
        source_dir = directory / 'source'; source_dir.mkdir(exist_ok=True)
        profile.update(count=1, dtype='uint8', nodata=255, compress='deflate')
        entries, masks = [], []
        for count in doses:
            chosen = order[:count]
            subsets = {'unrestricted': chosen,
                       'retain_buffer': chosen[distance.ravel()[chosen] > width],
                       'relocate_outside_buffer': outside[:count]}
            for policy, selected in subsets.items():
                name = f'{policy}_{count}'
                mask = np.zeros(landcover.shape, dtype='uint8'); mask[~valid] = 255
                mask.ravel()[selected] = 1
                target = source_dir / (name + '.tif')
                with rasterio.open(target,'w',**profile) as ds: ds.write(mask,1)
                transition = {str(code): int(np.count_nonzero(landcover.ravel()[selected] == code)) for code in codes}
                info = {'mask_id': name, 'policy': policy, 'requested_cells': count,
                        'converted_cells': int(len(selected)), 'converted_ha': float(len(selected)*area),
                        'foregone_cells': count - len(selected), 'foregone_ha': float((count-len(selected))*area),
                        'original_class_counts': transition,
                        'distance_min_m': float(distance.ravel()[selected].min()) if len(selected) else None,
                        'distance_max_m': float(distance.ravel()[selected].max()) if len(selected) else None,
                        'distance_mean_m': float(distance.ravel()[selected].mean()) if len(selected) else None,
                        'mask': describe_file(source_dir,target)}
                masks.append(info)
                entries.append({'id':name,'kind':'raster','path':target.name,
                    'title':f'{policy.replace("_"," ")} / {count} requested cells',
                    'uri':f'upstate.disturbance:{key}/{target.name}',
                    'vintage':'Explicit counterfactual selection, 2026-10-13', 'sha256':info['mask']['sha256']})
        geometry = {'grid_id':grid_id,'stream_run_id':first['id'],
                    'stream_file':first['stages']['ndr']['files']['stream'],
                    'source_landcover':grid['files']['NLCD'], 'eligible_cells':len(order),
                    'buffer_eligible_cells':int(np.count_nonzero(eligible & (distance <= width))),
                    'pixel_area_ha':area,'width':landcover.shape[1],'height':landcover.shape[0],
                    'crs':crs.to_string(), 'transform':list(transform)[:6],
                    'cell_boundary_rule':'Cell-centre distance; stream cells excluded from land conversion'}
        atomic_json(source_dir/'design.json',{'spec':spec,'geometry':geometry,'masks':masks})
        entries.append({'id':'DESIGN','kind':'document','path':'design.json','title':spec['title'],
                        'uri':f'upstate.disturbance:{key}/design.json','vintage':'Explicit counterfactual selection, 2026-10-13'})
        atomic_json(source_dir/'sources.json',{'schema':'upstate.sources/v1','title':spec['title'],
            'entries':entries,'scope':{'counterfactual':True,'reason':spec['reason'],'original_grid':grid_id},
            'notes':['Masks change only stated original land-cover codes. Source coefficients and forcing remain unchanged.',
                     'Retain-buffer means conversion foregone; relocate preserves requested conversion area outside the buffer.']})
        collection = ws.import_sources(source_dir/'sources.json')
        cases = []
        for target_code in spec['to_codes']:
            for mask in masks:
                scenario = None
                if mask['converted_cells']:
                    scenario = ws.save_scenario({'title':f'{spec["title"]} / to {target_code} / {mask["policy"]} / {mask["requested_cells"]} cells',
                        'kind':'landcover','reason':spec['reason'], 'source_collection_id':collection['id'],
                        'disturbance_study_id':key,
                        'patches':[{'mask_source_id':mask['mask_id'],'from_codes':spec['from_codes'],
                                    'to_code':target_code,'reason':spec['reason']}]})
                for baseline in runs:
                    selection = baseline['selection']
                    run = ws.prepare_run({**selection,'scenario_id':scenario['id']}) if scenario else baseline
                    cases.append({**mask,'to_code':target_code,'profile_id':selection['profile_id'],
                        'baseline_run_id':baseline['id'],'scenario_id':run['selection']['scenario_id'],
                        'run_id':run['id'],'baseline_reused':scenario is None})
        state = {'schema':'upstate.disturbance-study/v1','id':key,'spec':spec,'geometry':geometry,
                 'source_collection_id':collection['id'],'cases':cases,'state':'prepared','created_at':now(),
                 'original_baseline_records':{r['id']:file_digest(ws.root/'runs'/r['id']/'run.json') for r in runs}}
        atomic_json(directory/'study.json',state)
        return state


def report(ws, key):
    """Analyze completed original mass rasters on one joint valid support."""
    import numpy as np
    import rasterio
    from . import disturbance_report
    directory = location(ws,key)
    with held(directory/'.report.lock',blocking=False):
        state = get(ws,key)
        run_ids = sorted(set(state['spec']['baseline_run_ids']) | {x['run_id'] for x in state['cases']})
        runs = {key:ws.inspect_run(key) for key in run_ids}
        unfinished = [key for key,r in runs.items() if r['state'] != 'complete']
        if unfinished: raise ValueError(f'Finish {len(unfinished)} existing native runs before building the report')
        for key, checksum in state['original_baseline_records'].items():
            if file_digest(ws.root/'runs'/key/'run.json') != checksum:
                raise ValueError('An original baseline run record changed')
        joint = None
        paths = {}
        reference = None
        for rid, run in runs.items():
            for quantity in QUANTITIES:
                path = verify_file(ws.root/'runs'/rid,run['artifacts'][quantity]); paths[rid,quantity] = path
                with rasterio.open(path) as ds:
                    if reference is None: reference=(ds.shape,ds.transform,ds.crs)
                    if reference != (ds.shape,ds.transform,ds.crs): raise ValueError('Completed outputs use different grids')
                    a = ds.read(1); good=(ds.read_masks(1)>0)&np.isfinite(a)
                    joint=good if joint is None else joint&good
        if not np.any(joint): raise ValueError('The selected cases have no common valid support')
        output = directory/'report'; output.mkdir(exist_ok=True)
        source = directory/'source'
        outmaps=output/'maps';outmaps.mkdir(exist_ok=True)
        totals, maps, rows = {}, {}, []
        for (rid,quantity),path in paths.items():
            with rasterio.open(path) as ds:
                a=ds.read(1).astype('float64');p=ds.profile.copy()
            totals[rid,quantity] = float(np.sum(a[joint],dtype='float64'))
            # Keep exact original delivered mass rasters as direct downloads.
            name=f'{rid}-{quantity}.tif';shutil.copyfile(path,outmaps/name)
            maps[rid,quantity]=a
        profiles = {rid:ws._get('profiles',runs[rid]['selection']['profile_id']) for rid in state['spec']['baseline_run_ids']}
        for case in state['cases']:
            baseline,rid=case['baseline_run_id'],case['run_id']
            related=next(c for c in state['cases'] if c['profile_id']==case['profile_id'] and c['to_code']==case['to_code']
                         and c['requested_cells']==case['requested_cells'] and c['policy']=='unrestricted')
            for quantity,unit in QUANTITIES.items():
                base,total=totals[baseline,quantity],totals[rid,quantity]
                unprotected=totals[related['run_id'],quantity]
                difference=maps[rid,quantity]-maps[baseline,quantity]
                path=outmaps/f'{rid}-minus-{baseline}-{quantity}.tif'
                with rasterio.open(paths[rid,quantity]) as ds:p=ds.profile.copy()
                p.update(dtype='float64',nodata=-1.7976931348623157e308,compress='deflate')
                values=np.where(joint,difference,p['nodata'])
                with rasterio.open(path,'w',**p) as ds:
                    ds.write(values,1)
                    ds.update_tags(units=unit.replace('/year','/pixel/year'),direction='alternative minus baseline',baseline_run_id=baseline,alternative_run_id=rid,joint_support='all selected runs and quantities')
                rows.append({k:case[k] for k in ('to_code','policy','requested_cells','converted_cells','converted_ha','foregone_ha','profile_id','baseline_run_id','run_id')}|
                    {'profile_title':profiles[baseline]['title'],'profile_label':profiles[baseline]['ndr']['flow_dir_algorithm'].upper()+' / Lmax '+str(profiles[baseline]['sdr']['l_max'])+' / k '+str(profiles[baseline]['ndr']['k_param']),'quantity':quantity,'units':unit,'baseline':base,'alternative':total,
                     'change':total-base,'change_percent':100*(total-base)/base if base else None,
                     'avoided_vs_unrestricted':unprotected-total,'common_cells':int(joint.sum()),
                     'difference_file':'maps/'+path.name,'original_file':'maps/'+f'{rid}-{quantity}.tif'})
        with (output/'results.csv').open('w',newline='',encoding='utf-8') as f:
            writer=csv.DictWriter(f,fieldnames=list(rows[0]));writer.writeheader();writer.writerows(rows)
        for f in source.glob('*'):shutil.copyfile(f,output/f.name)
        report_value={'schema':'upstate.disturbance-report/v1','id':state['id'],'version':VERSION,'title':state['spec']['title'],
            'spec':state['spec'],'geometry':state['geometry'],'rows':rows,'cases':state['cases'],
            'project':ws.project,'run_count':len(runs),'case_count':len(state['cases']),'new_native_runs':len(set(run_ids)-set(state['spec']['baseline_run_ids'])),
            'joint_support':{'cells':int(joint.sum()),'area_ha':float(joint.sum()*state['geometry']['pixel_area_ha']),
                             'rule':'All quantities and all baseline/alternative runs intersected on finite, originally valid cells'},
            'method':{'change':'Alternative minus its profile-matched original baseline',
                      'avoided':'Unrestricted conversion minus the selected protection policy at the same requested dose',
                      'unit_basis':'Original Workspace delivered mass rasters; InVEST 3.20 native nutrient kg/ha/year and sediment tonnes/ha/year are each multiplied by cell hectares exactly once by the original exporter',
                      'buffer':'Cell-centre Euclidean distance to the original first baseline NDR stream; not surveyed bank or statutory buffer geometry',
                      'interpretation':'Explicit conditional land-cover scenario, not a forecast, calibration interval, intake concentration or causal field estimate',
                      'references':GUIDES},'created_at':now()}
        coefficient_sources = {}
        for baseline, profile in profiles.items():
            table, entry = ws.source_file(profile['source_collection_id'], profile['biophysical_source_id'])
            with table.open(encoding='utf-8-sig',newline='') as file:
                coefficients=list(csv.DictReader(file))
            coefficient_sources[profile['id']]={'sha256':entry['body']['sha256'], 'source_id':profile['biophysical_source_id'], 'rows':coefficients}
            shutil.copyfile(table,output/('biophysical-'+entry['body']['sha256']+'.csv'))
        report_value['coefficient_sources']=coefficient_sources
        report_value['original_profiles']={runs[rid]['selection']['profile_id']:profile for rid,profile in profiles.items()}
        atomic_json(output/'results.json',report_value)
        disturbance_report.write(output/'index.html',report_value,joint,maps,source)
        with zipfile.ZipFile(directory/'Disturbance_Protection_Review.zip','w',zipfile.ZIP_DEFLATED) as z:
            for f in sorted(output.rglob('*')):
                if f.is_file():z.write(f,f.relative_to(output))
        state.update(state='complete',completed_at=now(),files={
            'report':describe_file(ws.root,output/'index.html'),
            'table':describe_file(ws.root,output/'results.csv'),
            'results':describe_file(ws.root,output/'results.json'),
            'review_package':describe_file(ws.root,directory/'Disturbance_Protection_Review.zip')})
        atomic_json(directory/'study.json',state)
        return state


def main(argv=None):
    from .workspace import Workspace
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--workspace',required=True,type=Path)
    sub=parser.add_subparsers(dest='command',required=True)
    p=sub.add_parser('prepare');p.add_argument('spec',type=Path)
    p=sub.add_parser('report');p.add_argument('study_id')
    sub.add_parser('list')
    args=parser.parse_args(argv);ws=Workspace(args.workspace)
    value=prepare(ws,read_json(args.spec)) if args.command=='prepare' else report(ws,args.study_id) if args.command=='report' else catalogue(ws)
    print(json.dumps(value,ensure_ascii=False,allow_nan=False))

if __name__=='__main__':main()
