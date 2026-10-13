#!/usr/bin/env python3
"""Compile explicit design controls into maintained ECO v5 Scenario documents.

The original model.scenarios.scenario_from_dict and Workspace.put_scenario remain
its writers. This adapter does not implement ecological response or run models.
"""
from __future__ import annotations
import argparse
import copy
import importlib
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path
from typing import Any
if __package__:
    from .engine import DesignError, digest, encode, realize, validate_project, receive_bundle, export_bundle
else:
    from engine import DesignError, digest, encode, realize, validate_project, receive_bundle, export_bundle

BRIDGE_SCHEMA = 'eco.scenario-design.native-plan/v1'

def _require(value: Any, message: str) -> None:
    if not value: raise DesignError(message)

def _identity(feature: dict, selector: str) -> Any:
    value=feature.get('id') if selector=='id' else (feature.get('properties') or {}).get('field_id')
    _require(isinstance(value,(str,int)) and not isinstance(value,bool),
             f'Each selected field needs its original {selector}; numeric IDs must be integers')
    _require(not isinstance(value,str) or value.strip(), 'Empty field identifier')
    return value

def compile_plan(project: dict, alternative_id: str, factor_map: dict[str,str], *,
                 selector: str='field_id', layer: str='fields', scenario_id: str|None=None,
                 materialized_inputs: bool=False) -> dict:
    """Compile every explicit numeric edit; never silently drop unbound controls.

materialized_inputs=False: register against the exact original field dataset.
materialized_inputs=True: emit factor actions for a separately received geometry
edition. Geometry operations are expressed in its GeoJSON, not invented actions.
"""
    validate_project(project)
    _require(selector in ('id','field_id'),'Selector must be id or field_id')
    _require(isinstance(layer,str) and layer.strip(),'Source layer name required')
    _require(isinstance(factor_map,dict) and all(isinstance(k,str) and isinstance(v,str) and v.strip() for k,v in factor_map.items()),'Explicit property-to-factor map required')
    _require(len(set(factor_map.values()))==len(factor_map),'Two properties cannot bind to the same native factor')
    alternative=next((a for a in project['alternatives'] if a['id']==alternative_id),None)
    _require(alternative is not None,'Unknown alternative')
    params={p['id']:p for p in project['parameters']}
    original={k:f for k,f in zip(project['baseline']['feature_keys'],project['baseline']['collection']['features'])}
    added={item['key']:item['feature'] for item in alternative.get('additions',[])}
    fields={**original,**added}
    geometry_changes=[]
    for key,edit in alternative.get('edits',{}).items():
        if edit.get('excluded'): geometry_changes.append({'field_key':key,'operation':'exclude'})
        if 'geometry' in edit and edit['geometry']!=fields[key]['geometry']:
            geometry_changes.append({'field_key':key,'operation':'geometry'})
    geometry_changes += [{'field_key':key,'operation':'add'} for key in added]
    _require(materialized_inputs or not geometry_changes,
             'This alternative changes the field dataset. Receive a materialized input edition with --materialized-inputs; its original workspace is retained.')
    # Detect ambiguous selectors over the entire effective population, not just edited fields.
    identities={};seen=set()
    for key,feature in fields.items():
        if alternative.get('edits',{}).get(key,{}).get('excluded'):continue
        value=_identity(feature,selector)
        marker=encode(value)
        _require(marker not in seen,f'Duplicate native {selector}: {value!r}')
        seen.add(marker);identities[key]=value
    groups={}
    for key,edit in alternative.get('edits',{}).items():
        if edit.get('excluded'):continue
        for pid,value in edit.get('values',{}).items():
            prop=params[pid]['property']
            _require(prop in factor_map,f'Bind source property {prop!r} to its maintained native factor')
            factor=factor_map[prop]
            group=(factor,encode(value))
            entry=groups.setdefault(group,{'factor':factor,'value':value,'ids':[]})
            entry['ids'].append(identities[key])
    actions=[{'kind':'set_factor','layer':layer,'selector':{selector:item['ids']},
              'params':{'factor':item['factor'],'value':item['value']}} for item in groups.values()]
    fingerprint=digest({'project_id':project['id'],'alternative':alternative,'parameters':project['parameters'],
                        'map':factor_map,'selector':selector,'layer':layer,'materialized':materialized_inputs})
    sid=scenario_id or 'design_'+fingerprint[:24]
    _require(isinstance(sid,str) and 0<len(sid)<=200,'Scenario id required (max 200 characters)')
    metadata={'design_project_id':project['id'],'design_alternative_id':alternative_id,
              'design_fingerprint':fingerprint,'source_collection_sha256':digest(project['baseline']['collection']),
              'input_geometry_edition':materialized_inputs,'geometry_changes':geometry_changes,
              'factor_bindings':copy.deepcopy(factor_map),'field_selector':selector,
              'design_notes':{k:e['note'] for k,e in alternative.get('edits',{}).items() if e.get('note')}}
    scenario={'id':sid,'name':alternative['title'],'description':alternative.get('description',''),
              'actions':actions,'metadata':metadata}
    return {'schema':BRIDGE_SCHEMA,'scenario':scenario,'layer':layer,'selector':selector,
            'source_collection_sha256':digest(project['baseline']['collection']),
            'effective_collection_sha256':digest(realize(project,alternative_id)),
            'materialized_inputs':materialized_inputs,'geometry_changes':geometry_changes,
            'factor_action_count':len(actions),'selected_field_count':len(identities)}

def geometry_inputs(project:dict, alternative_id:str) -> dict:
    """Materialize geometry/inclusion only; native set_factor applies numeric edits."""
    p=copy.deepcopy(project)
    alternative=next(a for a in p['alternatives'] if a['id']==alternative_id)
    for edit in alternative.get('edits',{}).values():edit.pop('values',None)
    return realize(p,alternative_id)

def _native(eco_source:Path):
    source=eco_source.resolve()
    _require((source/'model/workspace.py').is_file() and (source/'model/scenarios.py').is_file(),
             'Select the maintained ECO Python source root containing model/workspace.py and model/scenarios.py')
    prior=sys.modules.get('model')
    if prior and getattr(prior,'__file__',None):
        _require(Path(prior.__file__).resolve().is_relative_to(source),'A different model package is already imported; launch this CLI in a fresh process')
    sys.path.insert(0,str(source))
    try:
        wm=importlib.import_module('model.workspace');sm=importlib.import_module('model.scenarios')
        _require(Path(wm.__file__).resolve().is_relative_to(source),'Loaded Workspace is not from the requested ECO source')
        return wm.Workspace,sm.scenario_from_dict
    finally:sys.path.pop(0)

def _field_path(workspace:Any, layer:str) -> Path:
    desc=workspace.manifest.get('datasets',{}).get(layer)
    _require(isinstance(desc,dict) and isinstance(desc.get('path'),str),'Native field dataset must declare its existing GeoJSON path')
    _require(desc.get('format','geojson').lower() in ('geojson','json'),'Native field layer must be GeoJSON')
    path=(workspace.root/desc['path']).resolve()
    _require(path.is_relative_to(workspace.root.resolve()),'Field dataset path must stay inside the selected workspace')
    return path

def _verify_source(workspace:Any, project:dict, layer:str) -> Path:
    path=_field_path(workspace,layer)
    actual=json.loads(path.read_text(encoding='utf-8'))
    _require(digest(actual)==digest(project['baseline']['collection']),
             'Import the exact native workspace field dataset before registration; the source editions differ')
    return path

def _register(workspace:Any, convert:Any, plan:dict) -> str:
    scenario=plan['scenario'];sid=scenario['id'];existing=workspace.scenarios.get(sid)
    if existing:
        prior=next((s for s in workspace.manifest.get('scenarios',[]) if s.get('id')==sid),None)
        _require(prior is not None and digest(prior)==digest(scenario),'Scenario id already belongs to different content; use a new scenario id')
        return 'already-present'
    workspace.put_scenario(convert(copy.deepcopy(scenario)))
    return 'created'

def register_original(project:dict, plan:dict, eco_source:Path, workspace_path:Path) -> dict:
    """Explicit registration through the original writer, with source identity checked."""
    _require(not plan['materialized_inputs'],'Use a separate materialized input edition for geometry changes')
    Workspace,convert=_native(eco_source)
    workspace=Workspace.open(workspace_path)
    _verify_source(workspace,project,plan['layer'])
    before_params=copy.deepcopy(workspace.manifest.get('parameters'))
    result=_register(workspace,convert,plan)
    reopened=Workspace.open(workspace_path)
    _require(reopened.manifest.get('parameters')==before_params,'Native parameters changed unexpectedly')
    _require(plan['scenario']['id'] in reopened.scenarios,'Native writer did not retain the scenario')
    return {'status':result,'workspace':str(workspace_path.resolve()),'scenario_id':plan['scenario']['id'],
            'dataset_id':reopened.manifest.get('dataset_id'),'parameters_preserved':True}

def receive_materialized(project:dict, plan:dict, eco_source:Path, workspace_path:Path,
                         destination:Path) -> dict:
    """Create-only, complete workspace copy with a separately identified input edition.

Every original file is retained. The derived study replaces only its field data;
original field bytes and original manifest also remain in design-handover/.
No source workspace file is written. Native put_scenario writes the new scenario.
"""
    _require(plan['materialized_inputs'],'Create a materialized-input plan first')
    root=workspace_path.resolve();dest=destination.resolve()
    _require(not dest.exists(),'Destination already exists; choose a new receiving directory')
    _require(not dest.is_relative_to(root) and not root.is_relative_to(dest),'Receiving destination and original workspace must be independent directories')
    Workspace,convert=_native(eco_source);original=Workspace.open(root)
    fields=_verify_source(original,project,plan['layer']);relative=fields.relative_to(root)
    original_manifest=copy.deepcopy(original.manifest)
    # Portable copies must not silently retain dependencies outside the workspace.
    for name,desc in original_manifest.get('datasets',{}).items():
        if not isinstance(desc,dict) or not isinstance(desc.get('path'),str):continue
        path=(root/desc['path']).resolve()
        _require(path.is_relative_to(root) and path.exists(),f'Dataset {name}: copy external dependencies into the original workspace before portable receiving')
    for path in root.rglob('*'):
        _require(not path.is_symlink(),f'Portable receiving needs ordinary files, not symlink: {path.relative_to(root)}')
    source_digest=digest(original_manifest)
    dest.parent.mkdir(parents=True,exist_ok=True)
    stage=Path(tempfile.mkdtemp(prefix='.eco-design-receive-',dir=dest.parent))
    try:
        shutil.copytree(root,stage,dirs_exist_ok=True)
        _require(digest(json.loads((root/'workspace.json').read_text()))==source_digest,'Original manifest changed while receiving; repeat against the saved edition')
        manifest=copy.deepcopy(original_manifest)
        for desc in manifest.get('datasets',{}).values():
            if isinstance(desc,dict) and isinstance(desc.get('path'),str):
                desc['path']=str((root/desc['path']).resolve().relative_to(root))
        original_id=manifest.get('dataset_id')
        manifest['dataset_id']=str(original_id or 'workspace')+'-design-'+plan['scenario']['metadata']['design_fingerprint'][:12]
        manifest['scenarios']=[]
        manifest['design_source']={'dataset_id':original_id,'manifest_sha256':source_digest,
            'project_id':project['id'],'alternative_id':plan['scenario']['metadata']['design_alternative_id'],
            'original_manifest':'design-handover/original-workspace.json',
            'original_fields':'design-handover/original-fields.geojson'}
        handover=stage/'design-handover';handover.mkdir(exist_ok=False)
        (handover/'original-workspace.json').write_bytes(encode(original_manifest))
        shutil.copy2(fields,handover/'original-fields.geojson')
        (handover/'editable-design.zip').write_bytes(export_bundle(project))
        (handover/'native-plan.json').write_bytes(encode(plan))
        (stage/relative).write_bytes(encode(geometry_inputs(project,plan['scenario']['metadata']['design_alternative_id'])))
        (stage/'workspace.json').write_bytes(encode(manifest))
        received=Workspace.open(stage);_register(received,convert,plan)
        check=Workspace.open(stage)
        _require(check.manifest.get('parameters')==original_manifest.get('parameters'),'Native uncertainty/model parameters changed unexpectedly')
        _require(digest(json.loads((root/'workspace.json').read_text()))==source_digest,'Original workspace was edited during receiving; repeat from its current saved edition')
        # Create-only directory publication: another process cannot be overwritten.
        if os.name == 'nt':
            # Windows rename refuses an existing destination.
            os.rename(stage, dest)
        else:
            # Reserve the absent target, then publish the whole directory at once.
            # No partially moved set of workspace files is exposed.
            dest.mkdir()
            try: os.replace(stage, dest)
            except BaseException:
                dest.rmdir()
                raise
        final=Workspace.open(dest)
        return {'status':'received','workspace':str(dest),'scenario_id':plan['scenario']['id'],
                'dataset_id':final.manifest['dataset_id'],'source_dataset_id':original_id,
                'parameters_preserved':True,'editable_design':'design-handover/editable-design.zip'}
    finally:
        if stage.exists():shutil.rmtree(stage)

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('project',type=Path,help='Editable project.json or handover ZIP')
    parser.add_argument('--alternative',required=True)
    parser.add_argument('--factor-map',required=True,type=Path,help='JSON object mapping original property names to native factor names')
    parser.add_argument('--selector',choices=['id','field_id'],default='field_id')
    parser.add_argument('--layer',default='fields')
    parser.add_argument('--scenario-id')
    parser.add_argument('--materialized-inputs',action='store_true')
    parser.add_argument('--output',type=Path,help='Write complete native-plan JSON')
    parser.add_argument('--eco-source',type=Path)
    parser.add_argument('--native-workspace',type=Path)
    parser.add_argument('--register',action='store_true',help='Write a factor-only scenario through the original native Workspace writer')
    parser.add_argument('--receive-workspace',type=Path,help='Receive a new independent geometry input edition')
    args=parser.parse_args()
    try:
        project=receive_bundle(args.project.read_bytes()) if args.project.suffix.lower()=='.zip' else json.loads(args.project.read_text())
        plan=compile_plan(project,args.alternative,json.loads(args.factor_map.read_text()),selector=args.selector,
                          layer=args.layer,scenario_id=args.scenario_id,materialized_inputs=args.materialized_inputs)
        if args.output:args.output.write_bytes(encode(plan))
        if args.register or args.receive_workspace:
            _require(args.eco_source and args.native_workspace,'--eco-source and --native-workspace are required for native writing')
            _require(not(args.register and args.receive_workspace),'Select registration or receiving, not both')
            result=(register_original(project,plan,args.eco_source,args.native_workspace) if args.register else
                    receive_materialized(project,plan,args.eco_source,args.native_workspace,args.receive_workspace))
        else:result=plan
        print(json.dumps(result,indent=2,ensure_ascii=False))
    except (DesignError,OSError,ValueError,KeyError) as e:
        parser.exit(2,f'eco-design: {e}\n')

if __name__=='__main__':main()
