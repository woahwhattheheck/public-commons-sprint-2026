"""Build a complete, independently editable margin desk from saved native editions.

The producer reads the original scenario_decisions and Economic editions.  It
never invokes a model, invents prices, pools units, or adds alternative benefits.
"""
from __future__ import annotations
import argparse
import base64
import csv
import hashlib
import json
import math
from pathlib import Path
import shutil
import sys
import tempfile

SCHEMA = 'upstate.scenario-margin/v1'
METRICS = {'nitrogen_export': ('nitrogen', 'Nitrogen', 'kg/year'),
           'phosphorus_export': ('phosphorus', 'Phosphorus', 'kg/year'),
           'sediment_export': ('sediment', 'Sediment', 't/year')}


def digest(body: bytes) -> str:
    return hashlib.sha256(body).hexdigest()


def read(path: Path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def write(path: Path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False, allow_nan=False)+'\n', encoding='utf-8')


def require(ok, message):
    if not ok:
        raise ValueError(message)


def inside(root: Path, relative: str) -> Path:
    path = root / relative
    require(path.resolve().is_relative_to(root.resolve()) and not path.is_symlink(),
            'Expected an ordinary retained member: '+relative)
    return path


def build(application: Path, workspace: Path, selection: dict, output: Path) -> dict:
    import numpy as np
    import rasterio
    from rasterio.features import geometry_mask
    application, workspace = application.resolve(), workspace.resolve()
    sys.path.insert(0, str(application))
    from model import scenario_decisions as native
    from model.workspace import Workspace
    from model import decision_analysis as economic
    ws = Workspace(workspace)
    require(selection.get('schema') == 'upstate.scenario-margin-selection/v1', 'Select the original margin input schema.')
    keys = ('baseline_scenario_id', 'treatment_scenario_id', 'control_scenario_id')
    scenarios = [selection[k] for k in keys]
    require(len(set(scenarios)) == 3, 'Choose three distinct original scenarios explicitly.')
    editions = selection['edition_ids']
    require(editions and len(editions) == len(set(editions)), 'Select distinct saved Economic editions.')
    require(selection.get('title') and selection.get('classification'), 'Provide the original case title and classification.')
    require(not output.exists(), 'Choose a new output directory; earlier editions are immutable.')
    stage = Path(tempfile.mkdtemp(prefix='scenario-margin-', dir=output.parent))
    files = {}

    def retain(path: Path, name: str, label: str | None = None):
        body = path.read_bytes()
        item = {'name': name, 'label': label or name, 'bytes': len(body), 'sha256': digest(body),
                'body': base64.b64encode(body).decode('ascii')}
        if name in files:
            require(files[name]['sha256'] == item['sha256'], 'A retained filename changed: '+name)
            return name
        files[name] = item
        target = inside(stage, name); target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(body)
        return name

    try:
        profiles, grid_id, project_id, zone_id = [], None, None, None
        for edition_id in editions:
            ed = inside(workspace, 'economic-editions/'+edition_id)
            metadata, report, original_selection = read(ed/'edition.json'), read(ed/'report.json'), read(ed/'selection.json')
            require(metadata['id'] == edition_id and report['schema'] == 'upstate.decision-report/v1', 'Saved edition identity or schema changed.')
            profile = report['scope']['reference_profile_id']
            require(not any(p['id'] == profile for p in profiles), 'Each profile must have one selected original edition.')
            current_grid = report['scope']['grid_id']; current_project = report['project']['id']
            current_zone = report['scope']['reporting_unit']['id']
            if grid_id is None:
                grid_id, project_id, zone_id = current_grid, current_project, current_zone
            require((grid_id, project_id, zone_id) == (current_grid, current_project, current_zone),
                    'Profiles must retain the same original project, grid and reporting zone.')
            record_ids = [report['baseline']['run_id']] + [r['run_id'] for r in report['alternatives']]
            runs = [read(inside(workspace, 'runs/'+key+'/run.json')) for key in record_ids]
            by_scenario = {r['selection']['scenario_id']: r for r in runs}
            require(len(by_scenario) == len(runs) and set(by_scenario) == set(scenarios),
                    'Each cohort must contain exactly the explicit original baseline, treatment and control.')
            require(by_scenario[scenarios[0]]['id'] == record_ids[0], 'The selected native baseline differs.')
            require(all(r['state'] == 'complete' and r['selection']['profile_id'] == profile and
                        r['selection']['grid_id'] == grid_id for r in runs), 'A native run is incomplete or belongs to another cohort.')
            ordered = [by_scenario[s] for s in scenarios]
            alt_by_id = {r['run_id']: r for r in report['alternatives']}
            treatment, control = [alt_by_id[r['id']] for r in ordered[1:]]
            source_id = metadata.get('producer_report_id') or report['physical_source']['producer_report_id']
            source_dir = inside(workspace, 'scenario-decisions/'+source_id)
            inspected = economic.inspect_scenario_report(source_dir/'decision.json')
            native_report = read(source_dir/'report.json')
            require(inspected['source']['sha256'] == report['physical_source']['source']['sha256'],
                    'The selected Economic edition does not retain the current original native report.')
            zones, crs = native._geometry_zones(ws, ws.get_grid(grid_id), native_report['selection'].get('zones', []))
            zone = next(z for z in zones if z['id'] == zone_id)
            pdata = {'id': profile, 'title': read(inside(workspace,'profiles/'+profile+'.json'))['title'],
                     'profile': read(inside(workspace, 'profiles/'+profile+'.json')),
                     'edition_id': edition_id, 'producer_report_id': source_id,
                     'report_sha256': inspected['source']['sha256'],
                     'report': report, 'selection': original_selection,
                     'run_ids': [r['id'] for r in ordered], 'metrics': {}, 'downloads': []}
            for name in ('edition.json','report.json','selection.json','physical-input.json','decision-package.zip','index.html'):
                pdata['downloads'].append(retain(ed/name, 'economic/'+edition_id+'/'+name,
                                                 pdata['title']+' — original '+name))
            for name in ('decision.json','report.json'):
                pdata['downloads'].append(retain(source_dir/name,'native/'+source_id+'/'+name))
            pdata['downloads'].append(retain(inside(workspace,'profiles/'+profile+'.json'),'profiles/'+profile+'.json'))
            for run in ordered:
                pdata['downloads'].append(retain(inside(workspace,'runs/'+run['id']+'/run.json'),'runs/'+run['id']+'/run.json'))
            for metric, (pollutant, label, units) in METRICS.items():
                t, c = treatment['outputs'][metric], control['outputs'][metric]
                require(t['units'] == c['units'] == units, 'Use original annual mass units, separately for each pollutant.')
                require(t['support']['status'] == c['support']['status'] == 'paired' and
                        t['support']['id'] == c['support']['id'] and t['baseline'] == c['baseline'],
                        'The two alternatives do not share one native cohort support.')
                values, masks, descriptors, transform, shape = [], [], [], None, None
                for run in ordered:
                    path, descriptor = native._stage_path(ws, run, native.OUTPUTS[pollutant], 'output')
                    native_name='rasters/'+run['id']+'/'+path.name
                    pdata['downloads'].append(retain(path, native_name, run['id'][:12]+' — original '+pollutant+' GeoTIFF'))
                    with rasterio.open(path) as ds:
                        require(ds.count == 1, 'The original export must have one band.')
                        if transform is None:
                            transform, shape, raster_crs = ds.transform, (ds.height,ds.width),ds.crs
                        require(ds.transform == transform and (ds.height, ds.width) == shape and ds.crs == raster_crs,
                                'The native rasters are not on one original grid.')
                        masked = ds.read(1, masked=True)
                        raw = np.ma.getdata(masked).astype('<f8')
                        mask = (~np.ma.getmaskarray(masked)) & np.isfinite(raw)
                        require(not np.any(raw[mask] < 0), 'An original native export rate is negative.')
                        values.append(raw);masks.append(mask)
                        descriptors.append({'name':native_name,'sha256':descriptor['sha256'],'bytes':descriptor['bytes']})
                inside_zone = geometry_mask([zone['geometry'].__geo_interface__],shape,transform,invert=True,all_touched=False)
                mask=np.logical_and.reduce(masks)&inside_zone
                area=abs(transform.a*transform.e-transform.b*transform.d)/10000
                require(int(mask.sum())==t['support']['valid_cells'], 'Map and original native summary supports differ.')
                sums=[float(np.sum(a[mask],dtype='float64'))*area for a in values]
                reference=[t['baseline'],t['alternative'],c['alternative']]
                require(all(math.isclose(a,b,rel_tol=1e-11,abs_tol=1e-9) for a,b in zip(sums,reference)),
                        'The retained full-resolution maps differ from their original native mass summary.')
                layers=[]
                for array in (values[0],values[1],values[2],values[0]-values[1],values[0]-values[2]):
                    array=np.where(mask,array*area,0).astype('<f8')
                    layers.append(base64.b64encode(array.tobytes()).decode('ascii'))
                a,b=t['reduction'],c['reduction']
                ratio=a/b if a>0 and b>0 else None
                pdata['metrics'][metric]={'label':label,'units':units,'baseline':t['baseline'],
                    'treatment':t['alternative'],'control':c['alternative'],'treatment_reduction':a,'control_reduction':b,
                    'cost_ratio_ceiling':ratio,'extra_cost_percent':100*(ratio-1) if ratio is not None else None,
                    'support':t['support'],'maps':{'width':shape[1],'height':shape[0],'transform':list(transform)[:6],
                    'crs':raster_crs.to_string(),'pixel_area_ha':area,'encoding':'little-endian-float64',
                    'units_per_pixel':units,'valid':base64.b64encode(mask.astype('uint8').tobytes()).decode('ascii'),
                    'layers':layers,'originals':descriptors}}
            profiles.append(pdata)
        for scenario in scenarios:
            retain(inside(workspace,'scenarios/'+scenario+'.json'),'scenarios/'+scenario+'.json')
        for name in ('grid.json','reporting_area.gpkg','model_domain.gpkg','nlcd.tif','reporting_mask.tif'):
            retain(inside(workspace,'grids/'+grid_id+'/'+name),'grid/'+name)
        plans=[]
        for plan_path in selection.get('implementation_plan_files',[]):
            source=inside(workspace,plan_path);plan=read(source)
            retained=retain(source,'implementation/'+plan['id']+'.json',plan['title']+' — editable native plan')
            plans.append({'id':plan['id'],'title':plan['title'],'revision':plan['revision'],'file':retained})
        software=Path(__file__).resolve().parent
        for path in software.iterdir():
            if path.suffix in ('.py','.mjs','.css','.md'):
                retain(path,'producer/'+path.name)
        for name in ('CURRENT_OWNER_DIRECTION.md','model/decision_analysis.py','model/scenario_decisions.py'):
            source=application/name
            if source.is_file():retain(source,'original-source/'+name)
        data={'schema':SCHEMA,'title':selection['title'],'classification':selection['classification'],
              'selection':selection,'project_id':project_id,'grid_id':grid_id,'zone_id':zone_id,
              'scenarios':dict(zip(('baseline','treatment','control'),scenarios)),
              'profiles':profiles,'plans':plans,'files':list(files.values()),
              'method':'Compare annualized whole-scenario expenditure divided by native annual avoided mass within each original cohort. The treatment/control cost ceiling is treatment avoided mass divided by control avoided mass when both are positive. Profiles remain separate conditional cases, not probability samples.',
              'map_method':'Full native export cells; annual per-hectare rates multiplied once by projected pixel area, then masked to the original polygon-centre and common-valid cohort support. Display cells keep the original native grid; no interpolation or resampling.'}
        source_ids=sorted((k,v['sha256']) for k,v in files.items())
        data['source_id']=digest(json.dumps({'selection':selection,'files':source_ids},sort_keys=True,separators=(',',':')).encode())
        css=(software/'desk.css').read_text();script=(software/'desk.mjs').read_text()
        payload=json.dumps(data,ensure_ascii=False,separators=(',',':'),allow_nan=False).replace('<','\\u003c')
        html='<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Scenario decision margins</title><style>'+css+'</style></head><body><main id="app"></main><script id="study" type="application/json">'+payload+'</script><script id="saved" type="application/json">null</script><script>'+script.replace('</script','<\\/script')+'</script></body></html>'
        (stage/'Scenario_Decision_Margins.html').write_text(html,encoding='utf-8')
        write(stage/'study.json',data);write(stage/'selection.json',selection)
        rows=[]
        for p in profiles:
            for metric,m in p['metrics'].items():
                rows.append({'profile_id':p['id'],'profile_title':p['title'],'metric':metric,
                    **{k:m[k] for k in ('units','baseline','treatment','control','treatment_reduction','control_reduction','cost_ratio_ceiling','extra_cost_percent')},
                    'common_cells':m['support']['valid_cells'],'common_area_ha':m['support']['area_ha'],
                    'support_id':m['support']['id'],'edition_id':p['edition_id'],'producer_report_id':p['producer_report_id']})
        with (stage/'all-profile-margins.csv').open('w',newline='') as handle:
            writer=csv.DictWriter(handle,fieldnames=list(rows[0]));writer.writeheader();writer.writerows(rows)
        write(stage/'all-profile-margins.json',rows)
        manifest={'schema':SCHEMA,'source_id':data['source_id'],'project_id':project_id,'files':[]}
        for path in sorted(stage.rglob('*')):
            if path.is_file():manifest['files'].append({'path':path.relative_to(stage).as_posix(),'bytes':path.stat().st_size,'sha256':digest(path.read_bytes())})
        write(stage/'manifest.json',manifest)
        stage.rename(output)
        return {'directory':str(output),'source_id':data['source_id'],'profiles':len(profiles),'native_runs':3*len(profiles),'native_rasters':9*len(profiles),'retained_files':len(files),'manifest_files':len(manifest['files'])}
    except BaseException:
        shutil.rmtree(stage,ignore_errors=True)
        raise


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--application',type=Path,required=True);parser.add_argument('--workspace',type=Path,required=True)
    parser.add_argument('--selection',type=Path,required=True);parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args();args.output.parent.mkdir(parents=True,exist_ok=True)
    print(json.dumps(build(args.application,args.workspace,read(args.selection),args.output),indent=2))

if __name__=='__main__': main()
