"""One complete numerical/recovery/receiving journey, plus an optional capacity run.

All arrays are authored numerical fixtures. This checks raster computation and
native-record interoperability; it is not a regional InVEST model execution.
Run from the original application root with PYTHONPATH=. python checks/paired_ensemble_journey.py --out DIR.
"""
from __future__ import annotations
import argparse
import copy
import json
import math
from pathlib import Path
import resource
import shutil
import time
import uuid
import numpy as np
import rasterio
from rasterio.transform import from_origin
from model.paired_ensemble.ensemble_rasters import analyze, quantile_name, UNITS
from model.paired_ensemble.ensemble_store import atomic, digest, fingerprint, read, verify
from model.paired_ensemble.ensemble_report import export_reports
from model.paired_ensemble.ensemble_portable import export_project, receive_project
from model.paired_ensemble.ensemble_cli import CompletedWorkspace
from model.paired_ensemble.ensemble_workspace import EnsembleWorkspace


def fixture(root, n, edge):
    root.mkdir(parents=True)
    profile = {'driver': 'GTiff', 'width': edge, 'height': edge-3, 'count': 1,
               'dtype': 'float64', 'crs': 'EPSG:5070', 'transform': from_origin(400000, 1700000, 30, 30),
               'nodata': -9999., 'compress': 'deflate', 'predictor': 3}
    yy, xx = np.indices((edge-3, edge))
    reporting = np.ones(xx.shape, dtype=bool)
    reporting[0, :] = False
    reporting[:, 0] = False
    def write(name, values):
        path = root / name
        with rasterio.open(path, 'w', **profile) as dst:
            dst.write(np.where(np.isfinite(values), values, -9999), 1)
        return str(path)
    mask = write('reporting-mask.tif', reporting.astype(float))
    spec = {'schema': 'upstate.ensemble-input/v1', 'title': 'Authored ensemble numerical journey',
            'purpose': 'Exercise exact quantitative behavior, disk recovery and complete portable receiving',
            'input_description': 'Authored arithmetic arrays; no regional watershed interpretation',
            'input_kind': 'authored numerical fixture', 'reporting_mask': mask,
            'members': [], 'pollutants': list(UNITS), 'quantiles': [0, .1, .5, .9, 1],
            'support': 'all_pairs', 'planned_member_count': n+2,
            'improvement_thresholds': {p: .15 for p in UNITS}}
    truths = {p: [] for p in UNITS}
    for i in range(n):
        member = {'id': 'profile-' + str(i), 'rasters': {}}
        for j, pollutant in enumerate(UNITS):
            baseline = (12 + j*3 + i*.1 + xx*.003 + yy*.002).astype(float)
            effect = (i-(n-1)/2) * .11 + np.sin(xx/11)*.3 + np.cos(yy/7)*.2 + j*.09
            alternative = baseline-effect
            # Different missing supports, an all-member missing pixel, exact
            # zero baselines and retained negative original values.
            baseline[2, 2] = np.nan
            if i % 3 == 0:
                alternative[3:5, 4+i%(edge-5)] = np.nan
            if j == 1:
                alternative[6, 7] = np.nan
            baseline[8, 8] = 0
            alternative[8, 8] = -effect[8, 8]
            baseline[9, 9] = -1
            alternative[9, 9] = -1-effect[9, 9]
            b = write(f'{i}-{pollutant}-baseline.tif', baseline)
            a = write(f'{i}-{pollutant}-alternative.tif', alternative)
            member['rasters'][pollutant] = {'units': UNITS[pollutant], 'baseline': b, 'alternative': a}
            valid = reporting & np.isfinite(baseline) & np.isfinite(alternative)
            truths[pollutant].append({'baseline': baseline, 'alternative': alternative,
                                     'effect': np.where(valid, baseline-alternative, np.nan), 'valid': valid})
        spec['members'].append(member)
    return spec, reporting, truths


def exact_check(result, reporting, truths):
    directory = Path(result['directory'])
    selected = result['selection']
    joint = reporting.copy()
    for values in truths.values():
        for row in values:
            joint &= row['valid']
    checked = 0
    for p, values in truths.items():
        cube = np.stack([row['effect'] for row in values])
        counts = np.isfinite(cube).sum(axis=0)
        common = reporting & (counts == len(values))
        if selected['support'] == 'all_pairs_all_pollutants':
            common &= joint
        support = reporting & ((counts > 0) if selected['support'] == 'available_pairs' else common)
        for name in ['valid_pairs', 'improved_pairs', 'common_support', 'mean_reduction', 'fraction_improved',
                     'minimum_reduction', 'maximum_reduction'] + [quantile_name(q) for q in selected['quantiles']]:
            with rasterio.open(directory / result['artifacts'][p+'--'+name]['path']) as ds:
                actual = ds.read(1, masked=True)
                assert ds.crs.to_epsg() == 5070
                assert ds.transform == from_origin(400000, 1700000, 30, 30)
            if name in ('valid_pairs', 'improved_pairs', 'common_support'):
                expected = counts if name == 'valid_pairs' else (cube > .15).sum(axis=0) if name == 'improved_pairs' else common
                use = reporting
            else:
                use = support
                samples = cube[:, support]
                if name == 'mean_reduction':
                    expected_values = np.nanmean(samples, axis=0)
                elif name == 'fraction_improved':
                    expected_values = (samples > .15).sum(axis=0)/np.isfinite(samples).sum(axis=0)
                else:
                    q = 0 if name == 'minimum_reduction' else 1 if name == 'maximum_reduction' else next(q for q in selected['quantiles'] if quantile_name(q)==name)
                    expected_values = np.nanquantile(samples, q, axis=0, method='linear')
                expected = np.full(reporting.shape, np.nan)
                expected[use] = expected_values
            assert np.array_equal(~np.ma.getmaskarray(actual), use), (p, name, 'mask')
            np.testing.assert_allclose(actual.data[use], expected[use], rtol=1e-12, atol=1e-12)
            checked += int(use.sum())
        summary = result['summary'][p]
        assert summary['common_cells'] == int(common.sum())
        totals=[]
        for actual, original in zip(summary['members'], values):
            for key, array in [('baseline_total_common_support', original['baseline']),
                               ('alternative_total_common_support', original['alternative']),
                               ('reduction_total_common_support', original['effect'])]:
                np.testing.assert_allclose(actual[key], array[common].sum(), rtol=1e-12, atol=1e-9)
            totals.append(original['effect'][common].sum())
        for row in summary['basin_reduction_distribution_common_support']['quantiles']:
            np.testing.assert_allclose(row['value'], np.quantile(totals,row['q']), rtol=1e-12,atol=1e-9)
    return checked


def native_receiving(root, spec):
    """Original record shapes, with explicitly authored arithmetic source data."""
    root.mkdir()
    atomic(root/'workspace.json', {'schema':'upstate.scientific-workbench/v1','id':str(uuid.uuid4()),'title':'Authored native-record interoperability fixture'})
    grid = {'width': 1, 'height': 1, 'fixture': 'Record identity; raster header remains the physical grid authority'}
    grid_spec = {'title':'Authored arithmetic input grid'}
    grid_id = digest({'spec':grid_spec,'grid':grid})
    folder=root/'grids'/grid_id;folder.mkdir(parents=True)
    shutil.copyfile(spec['reporting_mask'],folder/'reporting-mask.tif')
    atomic(folder/'grid.json',{'id':grid_id,'state':'complete','spec':grid_spec,'grid':grid,
           'files':{'reporting_mask':{'path':'reporting-mask.tif',**fingerprint(folder/'reporting-mask.tif')}}})
    scenarios=[]
    for title in ['Arithmetic baseline','Arithmetic alternative']:
        value={'schema':'upstate.scenarios/v1','title':title,'edits':[]}
        key=digest(value);atomic(root/'scenarios'/(key+'.json'),value);scenarios.append(key)
    pairs=[]
    for index, member in enumerate(spec['members']):
        profile={'schema':'upstate.profiles/v1','title':'Authored parameter '+str(index),
                 'ndr':{'fixture_member':index},'sdr':{},'references':['Authored numerical fixture'],
                 'scientific_status':'Record-format exercise, not an InVEST execution'}
        profile_id=digest(profile);atomic(root/'profiles'/(profile_id+'.json'),profile)
        runs=[]
        for side, scenario in zip(('baseline','alternative'),scenarios):
            selection={'schema':'upstate.run-selection/v1','grid_id':grid_id,'profile_id':profile_id,'scenario_id':scenario,'invest_version':'3.20.0'}
            key=digest(selection);folder=root/'runs'/key;folder.mkdir(parents=True);artifacts={}
            for p, paths in member['rasters'].items():
                out=folder/(p+'.tif');shutil.copyfile(paths[side],out)
                artifacts[p]={'path':out.name,'units':UNITS[p],**fingerprint(out)}
            atomic(folder/'run.json',{'id':key,'selection':selection,'state':'complete','artifacts':artifacts})
            runs.append(key)
        pairs.append({'profile_id':profile_id,'baseline_run_id':runs[0],'alternative_run_id':runs[1],'scenario_id':scenarios[1]})
    selection={'title':'Native-record receiving arithmetic exercise','purpose':'Check completed run identity binding without invoking a second model',
               'input_description':spec['input_description'],'pairs':pairs,'pollutants':spec['pollutants'],
               'quantiles':[.1,.5,.9],'support':'all_pairs','memory_mb':64,'tile_size':32}
    app=EnsembleWorkspace(CompletedWorkspace(root))
    completed=app.build(selection)
    assert completed['state']=='complete'
    assert app.bind({**selection,'pairs':list(reversed(pairs))})==app.bind(selection)
    invalid=copy.deepcopy(selection);invalid['pairs'].append(pairs[0])
    try:app.bind(invalid)
    except ValueError:pass
    else:raise AssertionError('Duplicate native profile accepted')
    invalid=copy.deepcopy(selection);invalid['pairs'][0]['profile_id']='0'*64
    try:app.bind(invalid)
    except ValueError:pass
    else:raise AssertionError('Changed native profile accepted')
    atomic(root/'native-ensemble-selection.json',selection)
    return completed


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--out',required=True);p.add_argument('--members',type=int,default=7);p.add_argument('--edge',type=int,default=67);p.add_argument('--capacity',action='store_true');args=p.parse_args()
    root=Path(args.out).absolute();root.mkdir(parents=True,exist_ok=False)
    start=time.monotonic();spec,reporting,truths=fixture(root/'inputs',args.members,args.edge)
    atomic(root/'input.json',spec)
    count=0;events=[]
    def progress(row):events.append(row)
    # Interruption occurs after actual durable tiles, followed by a new call.
    result=analyze(spec,root/'results',tile_size=32,memory_mb=64,on_progress=progress,
                   should_cancel=lambda:sum(e['phase']=='tiles' for e in events)>=2)
    assert result['state']=='paused'
    retained=next((Path(result['directory'])/'tiles').glob('*.tif'));before=retained.stat().st_mtime_ns
    result=analyze(spec,root/'results',tile_size=32,memory_mb=64,on_progress=progress)
    assert retained.stat().st_mtime_ns==before
    assert any(e.get('reused_tile') for e in events)
    count+=exact_check(result,reporting,truths)
    if not args.capacity:
        # Available-pair and joint-pollutant support are independent operating selections.
        for support in ('available_pairs','all_pairs_all_pollutants'):
            value=analyze({**spec,'support':support},root/'results',tile_size=41,memory_mb=64)
            count+=exact_check(value,reporting,truths)
        # Rebuild one missing final result without altering verified native inputs.
        artifact=next(iter(result['artifacts'].values()))
        (Path(result['directory'])/artifact['path']).unlink()
        result=analyze(spec,root/'results',tile_size=32,memory_mb=64)
        verify(result['directory'],artifact)
        broken=copy.deepcopy(spec);broken['members'][0]['rasters']['nitrogen_export']['units']='kg/ha/year'
        try:analyze(broken,root/'wrong-units')
        except ValueError:pass
        else:raise AssertionError('Areal-rate raster accepted as pixel mass')
        native=native_receiving(root/'native-records',spec)
        native_id=native['id']
    else:native_id=None
    export_reports(result['directory'])
    exported=export_project(result['directory'],root/'complete-results.zip')
    received=receive_project(root/'complete-results.zip',root/'received')
    rerender=export_reports(received['directory'])
    exported_again=export_project(received['directory'],root/'reopened-results.zip')
    assert exported_again['ensemble_id']==exported['ensemble_id']
    for artifact in result['artifacts'].values():verify(received['directory'],artifact)
    summary={'schema':'upstate.ensemble-operating-journey/v1','fixture':'Authored numerical arrays; not regional native output',
             'members':args.members,'width':args.edge,'height':args.edge-3,'pollutants':3,
             'checked_scalar_values':count,'analysis_id':result['id'],'native_record_analysis_id':native_id,
             'elapsed_seconds':time.monotonic()-start,'max_rss_kib':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
             'quantitative_rasters':len(result['artifacts']),'portable_members':exported['members'],
             'portable_bytes':exported['bytes'],'received_report':received['entrypoint'],'reports':len(rerender['files'])}
    atomic(root/'journey.json',summary);print(json.dumps(summary,indent=2))


if __name__=='__main__':main()
