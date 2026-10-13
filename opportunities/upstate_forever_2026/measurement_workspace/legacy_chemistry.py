"""Source-bound observations for the original reach_chemistry inference engine.

No source normalization, solver, native Workspace or annual-load writer is
replaced. Species/fraction, spatial, temporal, weighting and cohort choices
are explicit and retained with the complete input population.
"""
from __future__ import annotations
from copy import deepcopy
from datetime import datetime, timezone
from hashlib import sha256
from html import escape
import argparse
import json
import importlib
import math
import os
from pathlib import Path
import shutil
import tempfile

SCHEMA = 'upper-savannah-chemistry-binding/1'
PLAN = 'upper-savannah-chemistry-plan/1'

def engine_modules():
    """Use the installed native model namespace, or the original standalone SDK."""
    try:
        model=importlib.import_module('model.reach_chemistry.model')
        inference=importlib.import_module('model.reach_chemistry.inference')
    except ModuleNotFoundError as error:
        if error.name not in {'model','model.reach_chemistry','model.reach_chemistry.model'}:
            raise
        model=importlib.import_module('reach_chemistry.model')
        inference=importlib.import_module('reach_chemistry.inference')
    return model,inference

def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True,
                      separators=(',', ':'), allow_nan=False).encode('utf-8')

def digest(value):
    return sha256(canonical(value)).hexdigest()

def text(value, label):
    if not isinstance(value, str) or not value.strip():
        raise ValueError(label + ' must be an explicit nonempty string')
    return value

def finite(value, label, *, positive=False):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(label + ' must be finite')
    if value < 0 or positive and value == 0:
        raise ValueError(label + ' must be ' + ('positive' if positive else 'nonnegative'))
    return value

def utc(value, label):
    value=text(value,label)
    try: result=datetime.fromisoformat(value.replace('Z','+00:00'))
    except ValueError as error: raise ValueError(label+' must be an ISO instant') from error
    if result.tzinfo is None: raise ValueError(label+' requires an explicit timezone offset')
    return result.astimezone(timezone.utc)

def population(packet):
    if packet.get('format') != 'upper-savannah-calibration-input' or packet.get('version') != 1:
        raise ValueError('Use the original upper-savannah-calibration-input version 1 export')
    records={}
    for kind in ('accepted','excluded'):
        rows=packet.get(kind)
        if not isinstance(rows,list): raise ValueError(kind+' must contain the complete original array')
        for row in rows:
            identity=text(row.get('id'),'original observation id')
            if identity in records: raise ValueError('Duplicate original measurement id: '+identity)
            records[identity]=(kind,row)
        if packet.get('counts',{}).get(kind) != len(rows):
            raise ValueError('Original population count differs: '+kind)
    return records

def draft_plan(packet, project):
    """Return source-pinned choices without inventing sigma, time or cohort roles."""
    model,_=engine_modules()
    native=model.Project(project)
    records=population(packet)
    return {'schema':PLAN,'packet_sha256':digest(packet),'project_sha256':native.fingerprint,
            'reviewer':'','rationale':'','origin_utc':'','parameters':[], 'loss':'linear',
            'species_bindings':{},'reach_bindings':{},'selections':[],
            'available_species':[{'id':i,'basis':s['basis']} for i,s in native.species.items()],
            'available_reaches':list(native.reaches),
            'source_population':[{'id':i,'source_state':kind,'parameter':r.get('parameter'),
                'basis':r.get('basis'),'fraction':r.get('fraction'),'native_id':r.get('reachId'),
                'station_id':r.get('stationId'),'date':r.get('sampledDate'),
                'instant':r.get('sampledAt'),'censor':r.get('censor'),
                'reasons':r.get('reasons',[])} for i,(kind,r) in records.items()]}

def compile_binding(packet, project, plan):
    model,inference=engine_modules()
    native=model.Project(project); records=population(packet)
    if plan.get('schema') != PLAN: raise ValueError('Use a '+PLAN+' plan')
    if plan.get('packet_sha256') != digest(packet): raise ValueError('The plan belongs to another original measured export')
    if plan.get('project_sha256') != native.fingerprint: raise ValueError('The plan belongs to another original chemistry project')
    reviewer=text(plan.get('reviewer'),'reviewer');rationale=text(plan.get('rationale'),'binding rationale')
    if not isinstance(plan.get('selections'),list): raise ValueError('selections must be an explicit list')
    selections={}
    for row in plan['selections']:
        identity=text(row.get('measurement_id'),'selection.measurement_id')
        if identity not in records: raise ValueError('Selection references an absent original measurement: '+identity)
        if identity in selections: raise ValueError('Selection repeats an original measurement: '+identity)
        selections[identity]=row
    parameters=deepcopy(plan.get('parameters'))
    inference.Parameters.parse(native,parameters)
    if plan.get('loss','linear') not in {'linear','soft_l1','huber'}: raise ValueError('Unknown original calibration loss')
    observations=[];excluded=[]
    for identity,(source_state,row) in records.items():
        choice=selections.get(identity)
        if choice is None:
            excluded.append({'measurement':deepcopy(row),'reasons':['not-selected-for-this-model'], 'source_state':source_state})
            continue
        issues=[]
        reasons=list(row.get('reasons',[]))
        # Left censoring is natively supported by the original hinge residual.
        # Every unrelated source-quality or mapping exclusion remains in force.
        censor_reasons={'censored-result', 'missing-numeric-result'} if row.get('censor')=='left' and row.get('upper') is not None else set()
        issues.extend(r for r in reasons if r not in censor_reasons)
        if row.get('unit') != 'mg/L': issues.append('chemistry-requires-mg/L')
        role=choice.get('role')
        if role not in {'fit','holdout'}: raise ValueError('Explicit fit/holdout role required for '+identity)
        sigma=finite(choice.get('sigma_mg_l'),'sigma_mg_l for '+identity,positive=True)
        text(choice.get('uncertainty_reference'),'uncertainty_reference for '+identity)
        species=text(choice.get('species'),'species for '+identity)
        native.specie(species)
        binding=plan.get('species_bindings',{}).get(species)
        if not isinstance(binding,dict): raise ValueError('Species binding missing for '+species)
        text(binding.get('rationale'),'species binding rationale')
        if row.get('parameter') != binding.get('parameter'): issues.append('observand-does-not-match-species-selection')
        if row.get('basis') != binding.get('basis') or row.get('basis') != native.species[species]['basis']:
            issues.append('conserved-basis-mismatch')
        if not isinstance(binding.get('fractions'),list) or row.get('fraction') not in binding['fractions']:
            issues.append('sample-fraction-mismatch')
        spatial=plan.get('reach_bindings',{}).get(row.get('reachId'))
        if not isinstance(spatial,dict): raise ValueError('Explicit native-id → model-reach binding missing for '+identity)
        reach=text(spatial.get('reach'),'model reach');native.reach(reach)
        text(spatial.get('rationale'),'spatial binding rationale')
        timing=choice.get('time',{'mode':'source-instant'})
        if timing.get('mode') == 'source-instant':
            if row.get('timePrecision') != 'instant' or not row.get('sampledAt'):
                issues.append('sampling-instant-unspecified');day=None
            else: day=(utc(row['sampledAt'],'source instant')-utc(plan.get('origin_utc'),'model origin')).total_seconds()/86400
        elif timing.get('mode') == 'explicit-model-day':
            day=finite(timing.get('day'),'explicit model day')
            text(timing.get('rationale'),'time-assignment rationale')
        else: raise ValueError('Unsupported model-time selection for '+identity)
        if day is not None and (day < 0 or day > native.end_day): issues.append('outside-original-model-duration')
        censor=row.get('censor')
        if censor == 'none':
            value=row.get('value');qualifier='equal'
            if value is None: issues.append('missing-point-measurement')
            else: finite(value,'measured mg/L')
        elif censor == 'left' and row.get('upper') is not None:
            value=finite(row['upper'],'original upper censor bound');qualifier='below'
            if row.get('lower') is not None: issues.append('interval-censoring-not-supported-by-original-solver')
        else:
            value=None;qualifier=None;issues.append('censoring-not-supported-by-original-solver')
        if not row.get('sourceReferences'): issues.append('missing-original-source-reference')
        if issues:
            excluded.append({'measurement':deepcopy(row),'selection':deepcopy(choice),
                             'source_state':source_state,'reasons':sorted(set(issues))})
            continue
        observations.append({'id':identity,'reach':reach,'species':species,'day':day,
            'mg_l':value,'qualifier':qualifier,'sigma_mg_l':sigma,'role':role,
            'provenance':{'kind':'source-bound-measurement',
                'reference':'measurement-export:'+plan['packet_sha256']+'#'+identity,
                'measurement':deepcopy(row),'measurement_selection':deepcopy(choice),
                'species_binding':deepcopy(binding),'reach_binding':deepcopy(spatial),
                'reviewer':reviewer,'rationale':rationale,'source_state':source_state}})
    if observations: inference.observation_rows(native,observations,fitting=True)
    fit_count=sum(r['role']=='fit' for r in observations)
    request={'mode':'calibrate','parameters':parameters,'observations':observations,
             'loss':plan.get('loss','linear')}
    if 'max_evaluations' in plan:
        maximum=plan['max_evaluations']
        if isinstance(maximum,bool) or not isinstance(maximum,int) or maximum<1:
            raise ValueError('max_evaluations must be a positive integer')
        request['max_evaluations']=maximum
    result={'schema':SCHEMA,'packet_sha256':digest(packet),'project_sha256':native.fingerprint,
            'plan_sha256':digest(plan),'source_export':deepcopy(packet),
            'project':deepcopy(project),'plan':deepcopy(plan),'request':request,
            'excluded':excluded,'counts':{'source':len(records),'selected':len(selections),
              'included':len(observations),'fit':fit_count,'holdout':len(observations)-fit_count,'excluded':len(excluded)},
            'runnable':bool(observations) and fit_count>=len(parameters),
            'rules':{'replicates':'all selected records retained independently',
              'left_censoring':'original upper-bound hinge residual; no point substitution',
              'other_censoring':'retained in excluded population',
              'species':'explicit analyst mapping, conserved basis and source fraction checked',
              'time':'source instant relative to explicit origin or recorded model-day choice',
              'sigma':'explicit positive weighting with uncertainty reference',
              'cohorts':'per-record fit or holdout; no automatic split',
              'native_annual_loads':'no conversion or writer invocation'}}
    result['binding_sha256']=digest(result)
    return result

def read_binding(value):
    """Recompile the complete original inputs; no received request is trusted alone."""
    if value.get('schema')!=SCHEMA: raise ValueError('Unsupported chemistry binding')
    rebuilt=compile_binding(value['source_export'],value['project'],value['plan'])
    if canonical(value)!=canonical(rebuilt): raise ValueError('Received binding differs from its complete original inputs')
    return rebuilt

def retained_request(binding):
    """Original execute() accepts additive request metadata and preserves it in outputs."""
    binding=read_binding(binding)
    if not binding['runnable']:
        raise ValueError('The selection has fewer usable fit observations than parameters; inspect the complete exclusion report')
    return {**deepcopy(binding['request']), 'measurement_binding':deepcopy(binding)}

def native_payload(binding, chemistry, case_id):
    """Prepare the original Chemistry.run / chemistry.run queue payload.

    get_case() verifies the native retained source editions and project itself.
    The unchanged original queue/run remains responsible for executing it.
    """
    binding=read_binding(binding)
    case=chemistry.get_case(case_id)
    if case['project_sha256'] != binding['project_sha256']:
        raise ValueError('The selected native case is not the source-bound chemistry project')
    return {'case_id':case['id'],'request':retained_request(binding)}

def html_report(binding):
    c=binding['counts']
    rows=''.join('<tr><td title="'+escape(o['id'],quote=True)+'">'+escape(o['provenance']['measurement'].get('sourceResultId') or o['id'])+'</td>'+''.join('<td>'+escape(str(o[k]))+'</td>' for k in ('reach','species','day','role','qualifier','mg_l','sigma_mg_l'))+'</tr>' for o in binding['request']['observations'])
    skipped=''.join('<tr><td title="'+escape(x['measurement']['id'],quote=True)+'">'+escape(x['measurement'].get('sourceResultId') or x['measurement']['id'])+'</td><td>'+escape('; '.join(reason.replace('-', ' ') for reason in x['reasons']))+'</td></tr>' for x in binding['excluded'])
    return ('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
      '<title>Measured chemistry binding</title><style>body{font:15px system-ui;margin:32px;max-width:1400px;color:#222;background:#fff}'
      'table{border-collapse:collapse;width:100%;font-size:13px}th,td{border:1px solid #aaa;padding:8px;text-align:left;overflow-wrap:anywhere}'
      'th{background:#eee}.table{overflow:auto}code{overflow-wrap:anywhere}h1{font-size:26px}@media print{body{margin:10mm}table{font-size:9px}}</style>'
      '<h1>Measured chemistry binding</h1><p>'+escape(f"{c['source']} source records · {c['included']} included · {c['fit']} fit · {c['holdout']} holdout · {c['excluded']} excluded")+'</p><p>Project '+escape(binding['project']['title'])+'</p>'
      '<p><code>'+binding['binding_sha256']+'</code></p><p>The upper bound of a nondetect is a bound, not a measured concentration. '
      'Fit and holdout roles, time assignments and weights are retained in binding.json.</p>'
      '<h2>Included observations</h2><div class="table"><table><thead><tr>'+''.join('<th>'+x+'</th>' for x in ('Measurement','Reach','Species','Model day','Role','Qualifier','mg/L or bound','Sigma mg/L'))+
      '</tr></thead><tbody>'+rows+'</tbody></table></div><h2>Excluded observations</h2><div class="table"><table><thead><tr><th>Measurement</th><th>Reasons</th></tr></thead><tbody>'+skipped+'</tbody></table></div></html>')

def write_bundle(binding, output):
    binding=read_binding(binding);out=Path(output)
    files={'binding.json':canonical(binding)+b'\n','project.json':canonical(binding['project'])+b'\n',
           'calibration-request.json':canonical(retained_request(binding) if binding['runnable'] else {**binding['request'],'measurement_binding':binding})+b'\n','report.html':html_report(binding).encode()}
    manifest={'schema':'upper-savannah-chemistry-binding-files/1','binding_sha256':binding['binding_sha256'],
              'files':[{'path':n,'bytes':len(b),'sha256':sha256(b).hexdigest()} for n,b in files.items()]}
    files['manifest.json']=canonical(manifest)+b'\n'
    if out.exists():
        if any(not (out/n).is_file() or (out/n).read_bytes()!=data for n,data in files.items()):
            raise ValueError('Existing bundle differs; preserve it and use a new output directory')
        return {'output':str(out),'reopened':True,'runnable':binding['runnable'],**binding['counts']}
    out.parent.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='.measurement-binding-',dir=out.parent) as temporary:
        stage=Path(temporary)/'bundle';stage.mkdir()
        for name,body in files.items(): (stage/name).write_bytes(body)
        # Never replace an existing, even empty, receiving directory.
        out.mkdir()
        try:
            for name in files: os.link(stage/name,out/name)
        except BaseException:
            for name in files:
                p=out/name
                if p.exists() and p.read_bytes()==files[name]:p.unlink()
            try: out.rmdir()
            except OSError:pass
            raise
    return {'output':str(out),'reopened':False,'runnable':binding['runnable'],**binding['counts']}

def load(path):
    def invalid(x): raise ValueError('Nonfinite input JSON: '+x)
    return json.loads(Path(path).read_text('utf-8'),parse_constant=invalid)

def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    sub=parser.add_subparsers(dest='command',required=True)
    draft=sub.add_parser('plan');draft.add_argument('--measurements',required=True);draft.add_argument('--project',required=True);draft.add_argument('--output',required=True)
    build=sub.add_parser('build');build.add_argument('--measurements',required=True);build.add_argument('--project',required=True);build.add_argument('--plan',required=True);build.add_argument('--output',required=True)
    receive=sub.add_parser('receive');receive.add_argument('--binding',required=True);receive.add_argument('--output',required=True)
    args=parser.parse_args(argv)
    if args.command=='plan':
        value=draft_plan(load(args.measurements),load(args.project));out=Path(args.output)
        with out.open('xb') as f:f.write(canonical(value)+b'\n')
        print(json.dumps({'plan':str(out),'source_rows':len(value['source_population'])}));return
    value=read_binding(load(args.binding)) if args.command=='receive' else compile_binding(load(args.measurements),load(args.project),load(args.plan))
    print(json.dumps(write_bundle(value,args.output),indent=2))

if __name__=='__main__':main()
