#!/usr/bin/env python3
"""Run the original compound Chemistry science independently of report UI installation.

The derived-input definition is retained from the maintained original receiving
course at commit 5a8c02a05f2c45c758d361c44c624479bfa157b4. All calculations,
immutable native run IDs, reports, and editable transfers use the original APIs.
"""
from __future__ import annotations
import argparse
from copy import deepcopy
import json
from pathlib import Path
import sys

CASE='ddd984b567d881798f214530ebf0aef4601ab0744df7af7831bcb17e4e302abb'
CALIBRATION='6742a178dfe5c7dc69ea3c7b9cebfb1477bb3074db98f1c8990c5686569bc58d'
ENSEMBLE='2296638a0531acf18d172955d3da5e7845dc71ccaf76189b36b0217565c40a5a'
MONITORING='9e2e96abc6dcdbb799c00a106e50fb93c98298ea8c44fccd2282e12ac202a044'
SOURCE_COURSE='5a8c02a05f2c45c758d361c44c624479bfa157b4'
MODE_ORDER=('calibration','sensitivity','uncertainty','monitoring')


def compound_inputs(project, original, calibration_run_id):
    """The original 18-position, two-operator receiving-course definition."""
    by_location={}
    for index,row in enumerate(original['observations']):
        if row.get('species') in ('ammonium_n','nitrate_n'):
            key=(row['reach'],row['day'])
            if row['species'] in by_location.setdefault(key,{}):
                raise ValueError('Original paired reference repeats a species')
            by_location[key][row['species']]=(index,row)
    if len(by_location)!=18 or not all(set(v)=={'ammonium_n','nitrate_n'} for v in by_location.values()):
        raise ValueError('The complete 18 original paired reference positions are required')
    if not all(project.species[sid]['basis']=='N' for sid in ('ammonium_n','nitrate_n')):
        raise ValueError('The original elemental nitrogen basis is required')
    definitions=[('Ammonium and nitrate nitrogen',[('ammonium_n',1.0),('nitrate_n',1.0)]),
                 ('Weighted nitrogen operator check',[('ammonium_n',0.5),('nitrate_n',1.5)])]
    rows,mapping=[],[]
    for position,((reach,day),available) in enumerate(sorted(by_location.items())):
        for variant,(label,weights) in enumerate(definitions):
            originals=[available[sid][1] for sid,weight in weights]
            expected=sum(weight*available[sid][1]['mg_l'] for sid,weight in weights)
            sigma=sum(weight*available[sid][1]['sigma_mg_l'] for sid,weight in weights)
            row={'id':'compound-'+str(position+1)+'-'+str(variant+1),'reach':reach,'day':day,
                 'measurement':label,'basis':'N',
                 'components':[{'species':sid,'weight':weight} for sid,weight in weights],
                 'role':'holdout' if any(x.get('role')=='holdout' for x in originals) else 'fit',
                 'sigma_mg_l':sigma,
                 'provenance':{'kind':'constructed-reference',
                    'reference':'Weighted combination of retained authored calibration run '+calibration_run_id
                               +'; input records '+', '.join(x['id'] for x in originals),
                    'original_record_ids':[x['id'] for x in originals],
                    'error_scale_policy':'Sum of original absolute weighted scales for this authored exercise'}}
            if (position+variant)%3==0:
                margin=sigma*0.2
                row.update(qualifier='interval',lower_mg_l=max(0.0,expected-margin),upper_mg_l=expected+margin,
                           lower_closed=position%2==0,upper_closed=variant==0)
                row['provenance']['interval_policy']='Original weighted reference plus/minus 0.2 supplied weighted error scales'
            else:
                row.update(qualifier='equal',mg_l=expected)
            rows.append(row)
            mapping.append({'id':row['id'],'reference_mg_l':expected,
                            'indices':[[available[sid][0],weight] for sid,weight in weights]})
    return rows,mapping


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--application',type=Path,required=True)
    parser.add_argument('--workspace',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args();app=args.application.resolve(strict=True);sys.path.insert(0,str(app))
    import numpy as np
    from model.common import atomic_json,digest,file_digest,read_json,held,verify_file
    from model.workspace import Workspace
    from model.chemistry import Chemistry,ENGINE_VERSION
    from model import chemistry_reports,chemistry_report_source
    from model.reach_chemistry.model import Project
    from model.reach_chemistry.inference import Parameters,tangent_predictions
    ws=Workspace(args.workspace.resolve(strict=True));out=args.output.resolve()
    if out.is_relative_to(ws.root) or out.is_relative_to(app):
        raise ValueError('Keep receiving output outside application and Workspace')
    out.mkdir(parents=True,exist_ok=True);service=Chemistry(ws);case=service.get_case(CASE)
    if case['project'].get('provenance',{}).get('kind')!='constructed-reference':
        raise ValueError('Select the original authored numerical-method case')
    originals={}
    for name,rid in [('calibration',CALIBRATION),('uncertainty',ENSEMBLE),('monitoring',MONITORING)]:
        run=service.get_run(rid)
        if run['case_id']!=CASE or run['state']!='complete':raise ValueError('Original native run is not complete')
        path=service._verified_artifacts(rid,run)/'artifacts';request=read_json(path/'request.json')
        if request!=run['selection']['request']:raise ValueError('Original request identity differs')
        originals[name]={'run':run,'request':request,'result':read_json(path/'result.json')}
    calibration=originals['calibration']['request'];ensemble=originals['uncertainty']['request'];monitoring=originals['monitoring']['request']
    if ensemble['draws']!=512 or not ensemble['parameters']==calibration['parameters']==monitoring['parameters'] or ensemble['observations']!=calibration['observations']:
        raise ValueError('Use the exact original paired calibration and ensemble')
    inputs={'schema':'upstate.chemistry-native-course/v1','operation_id':'ECO-NATIVE-MONITOR-CHEM-RIVER13-20261013',
            'project_id':ws.project['id'],'case_id':CASE,'engine_version':ENGINE_VERSION,
            'source_course_commit':SOURCE_COURSE,'original_run_ids':[CALIBRATION,ENSEMBLE,MONITORING],
            'original_records':{name:digest(value['run']) for name,value in originals.items()},
            'implementation':{name:file_digest(app/name) for name in [
                'model/chemistry.py','model/chemistry_reports.py','model/chemistry_report_source.py',
                'model/reach_chemistry/inference.py','model/reach_chemistry/model.py',
                'model/reach_chemistry/solver.py','model/reach_chemistry/service.py',
                'model/reach_chemistry/io.py','model/reach_chemistry/reporting.py']}}
    state_path=out/'native-course.json'
    state=read_json(state_path) if state_path.exists() else {'inputs':inputs,'analyses':{},'reports':{},'sources':{}}
    if state['inputs']!=inputs:raise ValueError('Resume with the same source edition and original inputs')
    def save():atomic_json(state_path,state)
    with held(out/'.course.lock',blocking=False):
        atomic_json(out/'original-case.json',case,immutable=True)
        project=Project(case['project']);observations,mapping=compound_inputs(project,calibration,CALIBRATION)
        atomic_json(out/'derived-observations.json',{'observations':observations,'mapping':mapping},immutable=True)
        pars=Parameters.parse(project,calibration['parameters'])
        endpoint={'id':'endpoint-included','reach':'reservoir','day':0,
          'measurement':'Initial ammonium and nitrate nitrogen','basis':'N',
          'components':[{'species':'ammonium_n','weight':1.0},{'species':'nitrate_n','weight':1.0}],
          'role':'holdout','qualifier':'interval','sigma_mg_l':0.03,'lower_closed':True,'upper_closed':False,
          'provenance':{'kind':'constructed-reference','reference':'Retained original reservoir initial inventory at model day 0'}}
        initial,_=tangent_predictions(pars,pars.values,[endpoint])
        endpoint.update(lower_mg_l=float(initial[0]),upper_mg_l=float(initial[0])+0.03)
        excluded={**deepcopy(endpoint),'id':'endpoint-excluded','lower_closed':False}
        requests={'calibration':{**deepcopy(calibration),'observations':observations+[endpoint,excluded]},
            'sensitivity':{'mode':'sensitivity','parameters':deepcopy(calibration['parameters']),'observations':observations},
            'uncertainty':{**deepcopy(ensemble),'observations':observations},
            'monitoring':{**deepcopy(monitoring),'observations':observations}}
        results={}
        for name in MODE_ORDER:
            request=requests[name]
            atomic_json(out/'requests'/(name+'.json'),request,immutable=True)
            expected=digest({'case_id':CASE,'project_sha256':case['project_sha256'],'request':request,'engine_version':ENGINE_VERSION})
            state['active']={'stage':'analysis','mode':name,'run_id':expected};save();print('RUN',name,expected,flush=True)
            run=(service.get_run(expected) if state['analyses'].get(name,{}).get('run_id')==expected
                 else service.run({'case_id':CASE,'request':request}))
            if run['id']!=expected or run['state']!='complete':raise ValueError('Native computation did not complete')
            results[name]=read_json(service.root/run['id']/'artifacts/result.json')
            state['analyses'][name]={'run_id':run['id'],'state':run['state'],'artifacts':run['artifacts']};save();print('COMPLETE',name,flush=True)
        fit=results['calibration'];oldfit=originals['calibration']['result']
        errors={'fitted_parameter_max_abs':float(np.max(np.abs(np.array([v['fitted'] for v in fit['parameters']])-np.array([v['fitted'] for v in oldfit['parameters']]))))}
        if not fit['converged']:raise ValueError('Compound fit did not converge')
        original_draws=np.asarray(originals['uncertainty']['result']['parameter_draws']);current_draws=np.asarray(results['uncertainty']['parameter_draws'])
        if not np.array_equal(original_draws,current_draws):raise ValueError('Native ensemble did not reuse exact original draws')
        prediction=np.asarray(originals['uncertainty']['result']['prediction_draws_mg_l'])
        weighted=np.column_stack([sum(weight*prediction[:,index] for index,weight in row['indices']) for row in mapping])
        actual=np.asarray(results['uncertainty']['prediction_draws_mg_l'])
        if not np.allclose(weighted,actual,rtol=2e-9,atol=2e-10):raise ValueError('Native weighted ensemble disagrees with original component outputs')
        errors.update(weighted_ensemble_max_abs=float(np.max(np.abs(weighted-actual))),draws=len(current_draws))
        state['numerical_comparison']=errors;save()
        for name in MODE_ORDER:
            record=state['analyses'][name]
            state['active']={'stage':'report','mode':name};save()
            report=chemistry_reports.prepare(ws,record['run_id']);state['reports'][name]=report;save();print('REPORT',name,report['id'],flush=True)
        export=service.export({'case_id':CASE,'run_ids':[state['analyses'][name]['run_id'] for name in MODE_ORDER]})
        state['editable_export']=export;save()
        received_ws=Workspace(out/'editable-received-workspace',create=True,title='Received compound Chemistry study')
        state['editable_receive']=Chemistry(received_ws).receive(verify_file(ws.root,export['artifact']));save()
        print('EDITABLE_REOPENED',state['editable_receive']['case_id'],flush=True)
        state['active']={'stage':'scientific-source'};save()
        for name in MODE_ORDER:
            record=state['analyses'][name]
            try:
                source=chemistry_report_source.prepare(ws,state['reports'][name]['id'])
                state['sources'][name]=source;save();print('SOURCE',name,source['id'],flush=True)
            except (ImportError,AttributeError,ValueError,KeyError,FileNotFoundError,TypeError) as exc:
                state['source_exception']={'mode':name,'type':type(exc).__name__,'message':str(exc)};save();raise
        state.pop('source_exception',None);state['active']=None;state['state']='complete';save()
        print(json.dumps({'state':state['state'],'output':str(out),'analyses':len(state['analyses']),'reports':len(state['reports']),'sources':len(state['sources'])}),flush=True)

if __name__=='__main__':main()
