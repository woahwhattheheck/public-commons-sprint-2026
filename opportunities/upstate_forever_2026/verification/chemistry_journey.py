"""Operate both original components together using REACT12's authored recovery case.

The CSV is explicitly an authored software reference population, not field data.
No solver or either component's data writer is substituted.
"""
from pathlib import Path
import argparse
import csv
import io
import json
import os
import subprocess
import sys
import tempfile
from datetime import datetime,timedelta,timezone
from copy import deepcopy

p=argparse.ArgumentParser();p.add_argument('--measurements',type=Path,required=True);p.add_argument('--chemistry',type=Path,required=True);p.add_argument('--output',type=Path,required=True)
a=p.parse_args();a.output.mkdir(parents=True,exist_ok=True)
sys.path.insert(0,str(a.chemistry));sys.path.insert(0,str(a.measurements))
# Load just this additive consumer into the actual original measurement package.
import importlib.util
spec=importlib.util.spec_from_file_location('measurement_binding',Path(__file__).parents[1]/'measurement_workspace/chemistry.py')
b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)
from reach_chemistry.model import Project
from reach_chemistry.inference import fit_observations
project=json.loads((a.chemistry/'examples/network.json').read_text())
original=json.loads((a.chemistry/'examples/calibration-request.json').read_text())
ref=[x for x in original['observations'] if x['species']=='nitrate_n']
by_original={x['id']:x for x in ref}
origin=datetime(2026,1,1,tzinfo=timezone.utc)
fields=['Location_Identifier','Organization_Identifier','Result_Identifier','Activity_Identifier','Activity_StartDate','Activity_StartTime','Activity_StartTimeZone','Result_Characteristic','Result_Measure','Result_MeasureUnit','Result_SampleFraction','Result_Status','Activity_MediaName','Activity_Type','Result_Qualifier','Result_Comment']
rows=[]
for o in ref:
 time=origin+timedelta(days=o['day'])
 rows.append(dict(zip(fields,['RECOVERY-'+o['reach'],'AUTHORED-RECOVERY',o['id'],'ACT-'+o['id'],time.date().isoformat(),'00:00','UTC','Nitrate',str(o['mg_l']),'mg/L as N','Dissolved','Accepted','Water','Sample-Routine','',o['provenance']['reference']])))
base=rows[0]
extras=[('LEFT',{'Result_Measure':'<100'}),('RIGHT',{'Result_Measure':'>0.1'}),
 ('BASIS',{'Result_MeasureUnit':'mg/L as NO3'}),('NO-INSTANT',{'Activity_StartTime':'','Activity_StartTimeZone':''}),
 ('QUALIFIED',{'Result_Qualifier':'J'}),('OUTSIDE',{'Activity_StartDate':'2026-02-01'}),('FRACTION',{'Result_SampleFraction':'Total'})]
for identity,changes in extras:rows.append({**base,'Result_Identifier':identity,'Activity_Identifier':'ACT-'+identity,**changes})
s=io.StringIO(newline='');w=csv.DictWriter(s,fieldnames=fields);w.writeheader();w.writerows(rows)
(a.output/'authored-recovery.csv').write_text(s.getvalue(),encoding='utf-8',newline='')
js='''import fs from 'node:fs';import {pathToFileURL} from 'node:url';
const [root,out]=process.argv.slice(2);
const {MeasurementWorkspace}=await import(pathToFileURL(root+'/measurement_workspace/engine/workspace.mjs'));
const {calibrationExport}=await import(pathToFileURL(root+'/measurement_workspace/engine/calibration.mjs'));
const w=new MeasurementWorkspace(out+'/original-measurements');
const input={kind:'wqp',label:'AUTHORED REACT12 reference replay — not field data',text:fs.readFileSync(out+'/authored-recovery.csv','utf8')};
w.import(input);
const reaches=['tributary_a','tributary_b','confluence','reservoir'];
for(const r of reaches)if(w.summary().stations.some(s=>s.id==='RECOVERY-'+r))w.mapping('RECOVERY-'+r,{reachId:r,reviewer:'ASTRA-OBS12',reason:'Exact original authored recovery reach'},reaches);
fs.writeFileSync(out+'/measurements.json',JSON.stringify(calibrationExport(w),null,2));
const receiver=new MeasurementWorkspace(out+'/received-measurements');receiver.receive(w.portable());
const re=calibrationExport(receiver);fs.writeFileSync(out+'/received-measurements.json',JSON.stringify(re,null,2));
receiver.close();w.close();'''
(a.output/'operate.mjs').write_text(js)
subprocess.run(['node',str(a.output/'operate.mjs'),str(a.measurements.resolve()),str(a.output.resolve())],check=True)
packet=json.loads((a.output/'measurements.json').read_text())
plan=b.draft_plan(packet,project)
plan.update(reviewer='ASTRA-OBS12',rationale='Explicitly replay the original published recovery reference through the complete source receiver and actual chemistry solver.',origin_utc=origin.isoformat(),parameters=original['parameters'])
plan['species_bindings']={'nitrate_n':{'parameter':'nitrate','basis':'N','fractions':['Dissolved'],'rationale':'Original recovery nitrate-N reference, encoded as dissolved nitrate mg/L as N.'}}
plan['reach_bindings']={r:{'reach':r,'rationale':'Exact original authored reference reach identifier.'} for r in Project(project).reaches}
for row in packet['accepted']+packet['excluded']:
 old=by_original.get(row['sourceResultId'])
 plan['selections'].append({'measurement_id':row['id'],'species':'nitrate_n','sigma_mg_l':.03,
 'uncertainty_reference':'Same explicit 0.03 mg/L recovery-reference weight as original REACT12 example.',
 'role':old['role'] if old else 'holdout','time':{'mode':'source-instant'}})
result=b.compile_binding(packet,project,plan)
assert result['runnable']
assert result['counts']['source']==25 and result['counts']['included']==19,result['counts']
assert len(result['excluded'])==6
left=next(x for x in result['request']['observations'] if x['provenance']['measurement']['sourceResultId']=='LEFT')
assert left['qualifier']=='below' and left['mg_l']==100
assert left['provenance']['measurement']['value'] is None
report=fit_observations(project,result['request']['parameters'],result['request']['observations'])
values={x['id']:x['fitted'] for x in report['parameters']}
assert abs(values['nitrification_rate']-.23)<1e-7,values
assert abs(values['point_load']-12.3)<1e-6,values
assert report['converged'] and report['identifiability']['full_rank']
b.write_bundle(result,a.output/'binding')
assert b.write_bundle(result,a.output/'binding')['reopened']
b.write_bundle(b.read_binding(json.loads((a.output/'binding/binding.json').read_text())),a.output/'independent-binding')
changed=deepcopy(result);changed['request']['observations'][0]['mg_l']+=1
try:b.read_binding(changed);raise AssertionError('modified request accepted')
except ValueError:pass
changed_packet=deepcopy(packet);changed_packet['accepted'][0]['value']+=1
try:b.compile_binding(changed_packet,project,plan);raise AssertionError('stale plan accepted')
except ValueError:pass
# Explicitly assign the date-only record after preserving the original exclusion.
new_plan=deepcopy(plan)
missing=next(x for x in packet['accepted'] if x['sourceResultId']=='NO-INSTANT')
choice=next(x for x in new_plan['selections'] if x['measurement_id']==missing['id'])
choice['time']={'mode':'explicit-model-day','day':ref[0]['day'],'rationale':'Use the known original authored reference day; retain that source had date-only precision.'}
edited=b.compile_binding(packet,project,new_plan)
assert edited['counts']['included']==20 and b.read_binding(result)['counts']['included']==19
b.write_bundle(edited,a.output/'independently-edited-binding')
# Execute the original CLI/report/receiving producer without replacing any function.
env={**os.environ,'PYTHONPATH':str(a.chemistry.resolve())+os.pathsep+str(a.measurements.resolve())}
cmd=[sys.executable,'-m','reach_chemistry','run',str(a.output/'binding/project.json'),str(a.output/'binding/calibration-request.json'),'--output',str(a.output/'native-fit')]
subprocess.run(cmd,check=True,env=env)
subprocess.run(cmd,check=True,env=env)
summary={'source_records':25,'included':19,'excluded':6,'independent_edit_included':20,
 'fitted':values,'native_full_rank':report['identifiability']['full_rank'],
 'original_native_report':str(a.output/'native-fit/artifacts/report.html'),
 'original_native_archive':str(a.output/'native-fit/artifacts/results.zip'),
 'coverage':'Original measurement writer/receiver, source-bound consumer and original chemistry fit/CLI/report/reopen executed together.'}
(a.output/'journey.json').write_text(json.dumps(summary,indent=2));print(json.dumps(summary,indent=2))
