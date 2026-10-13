"""Single complete ORIGINAL-EXPERIMENT SOFTWARE INTAKE exercise.

Run the adjacent exercise.py first; this consumes its deliberately labeled
software carriers. It does not run or impersonate native InVEST science.
"""
from __future__ import annotations
from pathlib import Path
import copy
import sys
import time
from eco_scenario_lab.experiment_intake import adopt
from eco_scenario_lab.engine import run_workspace, verify_plan
from eco_scenario_lab.results import build_comparison
from eco_scenario_lab.store import (ScenarioError, atomic_json, read_json, file_hash,
                                   dataset_hash, export_workspace, receive_workspace)

source = Path(sys.argv[1]).resolve() / 'workspace'
root = Path(sys.argv[2]).resolve()
root.mkdir(parents=True, exist_ok=False)
t0 = time.monotonic()
plan = read_json(source/'plan.json')
state = read_json(source/'state.json')
records = {}
experiment = 'authored-intake-software-exercise'
selection = {'schema':1,'project_id':'software-intake','setup_id':'edition-1','currency':'USD',
             'inspection':'original-inspection.json','models':plan['models'],
             'scenarios':[{'id':s['id'],'cost_cents':s['cost_cents']} for s in plan['scenarios']],
             'cases':plan['cases'],'runs':[],
             'engine_identity':'SOFTWARE-FIXTURE-NOT-INVEST'}
for job in state['jobs'].values():
    key='original-'+job['case_id']+'-'+job['scenario_id']
    record=records.setdefault(key, {'job_key':key,'case_label':key,'status':'complete','result':{'models':{}}})
    run_root=source/job['attempts'][-1]['workspace']
    native=run_root/'native'
    args=read_json(run_root/'relative-args.json')
    for k,v in list(args.items()):
        if k.endswith('_path') and v not in (None,''):
            args[k]=str(source/v)
    (native/'.original-run-metadata').write_text('Retained original hidden file\n')
    record['result']['models'][job['model']]={'version':'3.20.0','model_type':job['model'],
        'invest_args':args,'workspace':str(native),
        'engine_identity':'SOFTWARE-FIXTURE-NOT-INVEST',
        'source_input_digests':{k:dataset_hash(Path(v)) for k,v in args.items() if k.endswith('_path')},
        'runtime':{'purpose':'authored software intake fixture'},'module_sha256':'fixture-no-native-module'}
    selection['runs'].append({'job_key':key,'case_id':job['case_id'],
        'scenario_id':job['scenario_id'],'model':job['model'],
        'native_pointer':'/result/models/'+job['model']})
inspection={'experiment_key':experiment,'workspace':str(source),
    'plan':{'experiment_key':experiment,'basecase_key':'original-baseline',
            'native_engine':'invest/3.20.0','jobs':[{'case_label':k,'args':{'engine':'invest/3.20.0'}} for k in records]},
    'receipt':{'experiment_key':experiment,'submitted':{k:k for k in records}},'runs':list(records.values())}
atomic_json(root/'original-inspection.json',inspection)
atomic_json(root/'selection.json',selection)
original_files={p.relative_to(source).as_posix():file_hash(p) for p in source.rglob('*') if p.is_file()}
received=root/'adopted'
result=adopt(root/'selection.json',received)
assert result['adopted_jobs']==24 and result['paired_records']==80 and not result['incomplete']
verify_plan(received)
comparison=build_comparison(received)
assert len({r['original_scenario_job'] for r in comparison['rows']})==8
assert all(r['execution_engine']=='SOFTWARE-FIXTURE-NOT-INVEST' for r in comparison['rows'])
retained_state=read_json(received/'state.json')
hidden_paths={j['native_storage']['path']+'/.original-run-metadata' for j in retained_state['jobs'].values()}
assert all((received/p).read_text()=='Retained original hidden file\n' for p in hidden_paths)
# Original output directories and input files remain byte-identical.
assert original_files=={p.relative_to(source).as_posix():file_hash(p) for p in source.rglob('*') if p.is_file()}
export=export_workspace(received,root/'adopted.zip')
receive=receive_workspace(root/'adopted.zip',root/'independent')
assert build_comparison(root/'independent')==comparison
assert all((root/'independent'/p).read_text()=='Retained original hidden file\n' for p in hidden_paths)
try:
    run_workspace(received)
except ScenarioError as exc:
    assert 'original experiment queue' in str(exc)
else:
    raise AssertionError('Adoption must never relaunch native jobs')
# An upstream unfinished run cannot masquerade as completed.
bad=copy.deepcopy(inspection);bad['runs'][0]['status']='running'
atomic_json(root/'unfinished.json',bad)
bad_selection={**selection,'inspection':'unfinished.json'}
atomic_json(root/'unfinished-selection.json',bad_selection)
try:
    adopt(root/'unfinished-selection.json',root/'unfinished-receiver')
except ScenarioError as exc:
    assert 'running' in str(exc)
else:
    raise AssertionError('Unfinished original run accepted')
assert not (root/'unfinished-receiver').exists()
# A mismatched scientific parameter is not silently paired with the baseline.
bad=copy.deepcopy(inspection)
bad['runs'][1]['result']['models']['ndr']['invest_args']['k_param']=99
atomic_json(root/'mismatched.json',bad)
atomic_json(root/'mismatched-selection.json',{**selection,'inspection':'mismatched.json'})
try:
    adopt(root/'mismatched-selection.json',root/'mismatched-receiver')
except ScenarioError as exc:
    assert 'inconsistent unchanged inputs' in str(exc)
else:
    raise AssertionError('Mismatched scientific parameter accepted')
assert not (root/'mismatched-receiver').exists()
# Partial genuine receiving remains inspectable and is explicitly incomplete.
partial={**selection,'runs':selection['runs'][:-1]}
atomic_json(root/'partial-selection.json',partial)
partial_result=adopt(root/'partial-selection.json',root/'partial')
assert partial_result['incomplete'] and partial_result['adopted_jobs']==23
summary={'kind':'original-experiment-software-intake','native_invest_executed':False,
         'original_parent_jobs':len(records),'native_result_selections':24,
         'matched_metric_rows':80,'portable_files':export['files'],
         'original_sender_unchanged':True,'original_job_keys_retained':True,
         'hidden_native_files_retained':len(hidden_paths),'hidden_native_result_selections':24,'duplicate_execution_prevented':True,
         'elapsed_seconds':round(time.monotonic()-t0,3)}
atomic_json(root/'intake-summary.json',summary)
print(__import__('json').dumps(summary,indent=2))
