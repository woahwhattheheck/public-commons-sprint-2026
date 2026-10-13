"""Reach chemistry in the ORIGINAL Upper Savannah Workspace.

This adapter uses the existing immutable object writer and source intake. It
never replaces the NDR/SDR engines, global operator, project registry or queue.
"""
from __future__ import annotations
from copy import deepcopy
import contextlib
from hashlib import sha256
import json
from pathlib import Path, PurePosixPath
import shutil
import tempfile
import zipfile

from .common import (atomic_json, canonical, digest, file_digest, held, identifier,
                     now, read_json, relative_file, verify_file, describe_file)
from .reach_chemistry.model import Project, ModelError
from .reach_chemistry.service import execute
from .reach_chemistry.solver import Cancelled
from .reach_chemistry.io import write_outputs

ENGINE_VERSION = '0.1.0'
ACTIONS = {'chemistry.case.save', 'chemistry.case.get', 'chemistry.catalog',
           'chemistry.run', 'chemistry.run.get', 'chemistry.result.page',
           'chemistry.case.from-source', 'chemistry.export', 'chemistry.receive',
           'chemistry.report.prepare', 'chemistry.report.get', 'chemistry.report.list'}

class Chemistry:
    def __init__(self, workspace):
        self.ws = workspace
        self.root = workspace.root / 'chemistry-runs'

    def source_refs(self, selected):
        if not isinstance(selected, list):
            raise ModelError('source_refs must list retained Workspace source selections')
        refs, seen = [], set()
        for selection in selected:
            collection, source = selection['source_collection_id'], selection['source_id']
            key = (collection, source)
            if key in seen: continue
            seen.add(key)
            retained = self.ws._get('sources', identifier(collection))
            entry = next((item for item in retained['entries'] if item['id'] == source), None)
            if entry is None:
                raise ModelError('Choose a source retained in the selected original edition')
            records = [retained['original_manifest'], entry['body'], *entry.get('companions', [])]
            for record in records:
                verify_file(self.ws.root, {**record, 'path':record['object']})
            refs.append({'source_collection_id':collection,'source_id':source,
                         'sha256':entry['body']['sha256'], 'bytes':entry['body']['bytes'],
                         'title':entry['title'],'uri':entry['uri'],'vintage':entry['vintage']})
        return refs

    def save_case(self, value):
        project = Project(value['project'])
        if not isinstance(value.get('reason'),str) or not value['reason'].strip():
            raise ModelError('Explain the chemical scenario or scientific edit')
        sources = self.source_refs(value.get('source_refs', []))
        body = {'title':project.title,'project':project.raw,'project_sha256':project.fingerprint,
                'source_refs':sources,'reason':value['reason'],'engine_version':ENGINE_VERSION}
        if value.get('parent_id'):
            parent = self.get_case(value['parent_id'])
            body['parent_id'] = parent['id']
        if value.get('received_from'):
            body['received_from'] = deepcopy(value['received_from'])
        return self.ws._save('chemistry-cases',body)

    def from_source(self, value):
        path, entry = self.ws.source_file(value['source_collection_id'],value['source_id'])
        project = read_json(path)
        return self.save_case({'project':project,'source_refs':[value],
            'reason':value.get('reason','Imported the retained original chemistry project.')})

    def get_case(self, key):
        case = self.ws._get('chemistry-cases',identifier(key))
        project = Project(case['project'])
        if project.fingerprint != case['project_sha256']:
            raise ModelError('Saved chemistry project identity changed')
        if self.source_refs(case['source_refs']) != case['source_refs']:
            raise ModelError('A selected original source edition changed')
        return case

    def get_run(self, key):
        key = identifier(key)
        state = read_json(self.root/key/'run.json')
        if state['id'] != key or digest(state['selection']) != key:
            raise ModelError('Saved chemistry analysis selection changed')
        return state

    def catalog(self):
        cases = self.ws._list('chemistry-cases')
        runs = [self.get_run(p.parent.name) for p in sorted(self.root.glob('*/run.json'))] if self.root.exists() else []
        return {'cases':[{k:c[k] for k in ('id','title','reason','project_sha256')} for c in cases],
                'runs':[{k:r.get(k) for k in ('id','title','case_id','mode','state','progress','ended_at')} for r in runs]}

    def _verified_artifacts(self, key, state):
        directory = self.root/key
        for item in state.get('artifacts',[]): verify_file(directory,item)
        return directory

    def run(self, value, *, progress_hook=None):
        case = self.get_case(value['case_id'])
        request = deepcopy(value.get('request',{}))
        selection = {'case_id':case['id'],'project_sha256':case['project_sha256'],
                     'request':request,'engine_version':ENGINE_VERSION}
        key = digest(selection)
        directory = self.root/key
        directory.mkdir(parents=True,exist_ok=True)
        with held(directory/'.run.lock',blocking=False):
            state_file = directory/'run.json'
            if state_file.exists():
                state = self.get_run(key)
                if state['state'] == 'complete':
                    self._verified_artifacts(key,state)
                    return state
            else:
                state = {'schema':'upstate.chemistry-run/v1','id':key,'title':case['title'],
                         'case_id':case['id'],'mode':request.get('mode','simulate'),
                         'selection':selection,'created_at':now(),'state':'prepared','attempts':[]}
            state.update(state='running',started_at=now())
            state.pop('error',None)
            # Resume is an explicit user operation. A prior cancellation does not
            # keep cancelling all later attempts of the same immutable request.
            (directory/'cancel.json').unlink(missing_ok=True)
            attempt = {'started_at':state['started_at'],'number':len(state['attempts'])+1}
            state['attempts'].append(attempt)
            atomic_json(state_file,state)
            resume = None
            if state.get('checkpoint') and state['mode']=='simulate':
                checkpoint_file=verify_file(directory,state['checkpoint'])
                resume=read_json(checkpoint_file)
            def progress(event):
                state['progress']=event
                atomic_json(state_file,state)
                if progress_hook is not None: progress_hook({'run_id':key, **event})
            def checkpoint(record):
                path=directory/'checkpoints'/(digest(record)+'.json')
                atomic_json(path,record,immutable=True)
                state['checkpoint']=describe_file(directory,path)
                atomic_json(state_file,state)
            try:
                result=execute(case['project'],request,
                    cancelled=lambda:(directory/'cancel.json').exists(),
                    progress=progress,checkpoint=checkpoint,resume=resume)
                write_outputs(directory/'artifacts',case['project'],result,request)
                state['artifacts']=[describe_file(directory,p) for p in sorted((directory/'artifacts').iterdir()) if p.is_file()]
                if result.get('calibrated_project'):
                    fitted=self.save_case({'project':result['calibrated_project'],
                        'reason':'Parameter fit using retained observations in chemistry analysis '+key,
                        'source_refs':case['source_refs'],'parent_id':case['id']})
                    state['calibrated_case_id']=fitted['id']
                state.update(state='complete',ended_at=now())
                attempt.update(state='complete',ended_at=state['ended_at'])
            except BaseException as error:
                state.update(state='cancelled' if isinstance(error,Cancelled) else 'failed',
                             error={'type':type(error).__name__,'message':str(error)},ended_at=now())
                attempt.update(state=state['state'],ended_at=state['ended_at'],error=state['error'])
                atomic_json(state_file,state)
                raise
            atomic_json(state_file,state)
            return state

    def request_cancel(self,key):
        state=self.get_run(key)
        if state['state']=='running':
            atomic_json(self.root/identifier(key)/'cancel.json',{'requested_at':now()})
        return {'run_id':key,'state':state['state'],'cancellation_requested':state['state']=='running'}

    def result_page(self,value):
        key=identifier(value['run_id']); state=self.get_run(key)
        if state['state']!='complete': raise ModelError('Finish or resume the selected chemistry run')
        directory=self._verified_artifacts(key,state)
        result=read_json(directory/'artifacts/result.json')
        # Explicit collections, not arbitrary paths or arbitrary attribute reads.
        field=value.get('field') or 'final'
        allowed={'final','samples','budgets','reactions','boundary_export_by_state',
                 'observations','scores','parameters','rows','selected','summaries','sources'}
        if field not in allowed: raise ModelError('Choose a documented chemistry result collection')
        source=result.get('baseline',result)
        rows=result.get(field,source.get(field,[]))
        if not isinstance(rows,list): raise ModelError('The selected result is not a row collection')
        offset=value.get('offset',0); limit=value.get('limit',200)
        if type(offset)!=int or offset<0 or type(limit)!=int or not 1<=limit<=1000:
            raise ModelError('Use a nonnegative row offset and a page size from 1 to 1000')
        end=min(len(rows),offset+limit)
        return {'run_id':key,'field':field,'total':len(rows),'offset':offset,'rows':rows[offset:end],
                'next_offset':end if end<len(rows) else None}

    def artifact(self,key,name):
        state=self.get_run(key)
        if state['state']!='complete': raise ModelError('The analysis has not completed')
        expected=next((x for x in state['artifacts'] if x['path']=='artifacts/'+name),None)
        if expected is None: raise ModelError('Choose an original exported artifact')
        return verify_file(self.root/key,expected)

    def export(self, value):
        case=self.get_case(value['case_id'])
        run_ids=list(dict.fromkeys(value.get('run_ids',[])))
        selected=[]
        for rid in run_ids:
            run=self.get_run(rid)
            if run['case_id']!=case['id'] or run['state']!='complete':
                raise ModelError('Export only completed runs of the selected original case')
            self._verified_artifacts(rid,run); selected.append(run)
        selection={'case_id':case['id'],'run_ids':run_ids,'engine_version':ENGINE_VERSION}
        key=digest(selection); directory=self.ws.root/'chemistry-exports'/key
        directory.mkdir(parents=True,exist_ok=True)
        archive=directory/'editable-chemistry.zip'
        with held(directory/'.export.lock',blocking=False):
            receipt=directory/'export.json'
            if receipt.exists():
                existing=read_json(receipt)
                verify_file(self.ws.root,existing['artifact'])
                return existing
            with tempfile.TemporaryDirectory(dir=directory,prefix='.export-') as tmp:
                root=Path(tmp); atomic_json(root/'case.json',case)
                sources=[]; entries=[]
                for i,ref in enumerate(case['source_refs']):
                    original_path,entry=self.ws.source_file(ref['source_collection_id'],ref['source_id'])
                    body=deepcopy(entry); companions=body.pop('companions',[]); main=body.pop('body')
                    prefix='sources/'+str(i)+'/'
                    main_name=main.get('view_path',main['filename'])
                    target=root/prefix/main_name; target.parent.mkdir(parents=True,exist_ok=True)
                    shutil.copyfile(original_path,target)
                    body.update(id='source-'+str(i),path=prefix+main_name,sha256=main['sha256'],companions=[])
                    for companion in companions:
                        name=companion.get('view_path',companion['filename'])
                        original=relative_file(self.ws.root,companion['object'])
                        cp=root/prefix/name; cp.parent.mkdir(parents=True,exist_ok=True); shutil.copyfile(original,cp)
                        body['companions'].append({'path':prefix+name,'sha256':companion['sha256']})
                    entries.append(body)
                    sources.append({'original':ref,'incoming_id':body['id']})
                    coll=self.ws._get('sources',ref['source_collection_id'])
                    manifest=coll.get('original_manifest')
                    if manifest:
                        target=root/'original-source-manifests'/(ref['source_collection_id']+'.json')
                        target.parent.mkdir(exist_ok=True)
                        shutil.copyfile(relative_file(self.ws.root,manifest['object']),target)
                atomic_json(root/'sources.json',{'schema':'upstate.sources/v1','title':'Retained chemistry source files',
                            'entries':entries,'notes':['Original source identities and original manifests are retained in this transfer.']})
                for run in selected:
                    for artifact in run['artifacts']:
                        src=verify_file(self.root/run['id'],artifact)
                        dst=root/'runs'/run['id']/artifact['path']; dst.parent.mkdir(parents=True,exist_ok=True)
                        shutil.copyfile(src,dst)
                    atomic_json(root/'runs'/run['id']/'run.json',run)
                files={p.relative_to(root).as_posix():{'bytes':p.stat().st_size,'sha256':file_digest(p)}
                       for p in sorted(root.rglob('*')) if p.is_file()}
                atomic_json(root/'manifest.json',{'schema':'upstate.chemistry-transfer/v1','selection':selection,
                            'source_map':sources,'files':files})
                pending=directory/'.pending.zip'
                with zipfile.ZipFile(pending,'w',compression=zipfile.ZIP_DEFLATED) as z:
                    for p in sorted(root.rglob('*')):
                        if p.is_file(): z.write(p,p.relative_to(root).as_posix())
                pending.replace(archive)
            result={'id':key,'case_id':case['id'],'artifact':describe_file(self.ws.root,archive),
                    'run_ids':run_ids,'source_count':len(case['source_refs'])}
            atomic_json(receipt,result,immutable=True)
            return result

    def receive(self,path):
        path=Path(path).resolve(strict=True)
        archive_sha=file_digest(path)
        destination=self.ws.root/'chemistry-received'/archive_sha
        destination.mkdir(parents=True,exist_ok=True)
        receipt=destination/'receiving.json'
        with held(destination/'.receive.lock',blocking=False):
            if receipt.exists():
                result=read_json(receipt); self.get_case(result['case_id']); return result
            with zipfile.ZipFile(path) as z:
                names=z.namelist()
                if len(names)!=len(set(names)): raise ModelError('Archive repeats a file name')
                for info in z.infolist():
                    name=info.filename; member=PurePosixPath(name)
                    if name in ('.receive.lock','receiving.json'): raise ModelError('Archive uses a reserved receiving-control name')
                    if member.is_absolute() or '..' in member.parts or str(member)!=name or '\\' in name or '\0' in name:
                        raise ModelError('Archive has an unsafe member name')
                    if info.is_dir() or info.flag_bits & 1 or ((info.external_attr>>16)&0o170000) not in (0,0o100000):
                        raise ModelError('Archive members must be ordinary unencrypted files')
                manifest=json.loads(z.read('manifest.json'))
                if manifest.get('schema')!='upstate.chemistry-transfer/v1': raise ModelError('Select a chemistry transfer')
                if set(names)!=set(manifest['files'])|{'manifest.json'}: raise ModelError('Archive file inventory differs')
                for name,expected in manifest['files'].items():
                    target=destination/name
                    if target.is_symlink() or not target.parent.resolve().is_relative_to(destination.resolve()):
                        raise ModelError('Receiving target leaves the selected project')
                    target.parent.mkdir(parents=True,exist_ok=True)
                    with z.open(name) as source, tempfile.NamedTemporaryFile(dir=target.parent,delete=False) as out:
                        pending=Path(out.name)
                        try:
                            shutil.copyfileobj(source,out,1024*1024); out.flush()
                        except BaseException:
                            pending.unlink(missing_ok=True); raise
                    try:
                        if pending.stat().st_size!=expected['bytes'] or file_digest(pending)!=expected['sha256']:
                            raise ModelError('Received member hash differs: '+name)
                        pending.replace(target)
                    finally: pending.unlink(missing_ok=True)
            case=read_json(destination/'case.json'); refs=[]
            if manifest['source_map']:
                collection=self.ws.import_sources(destination/'sources.json')
                refs=[{'source_collection_id':collection['id'],'source_id':m['incoming_id']} for m in manifest['source_map']]
            incoming=self.save_case({'project':case['project'],'reason':case['reason'],'source_refs':refs,
                'received_from':{'archive_sha256':archive_sha,'case_id':case['id'],
                                 'original_source_refs':case['source_refs']}})
            adopted=[]
            for old_id in manifest['selection']['run_ids']:
                identifier(old_id)
                original=read_json(destination/'runs'/old_id/'run.json')
                if (original['id']!=old_id or digest(original['selection'])!=old_id
                        or original['case_id']!=case['id'] or original['state']!='complete'
                        or original['selection']['project_sha256']!=case['project_sha256']):
                    raise ModelError('Incoming run does not belong to the received case')
                selection=deepcopy(original['selection']); selection['case_id']=incoming['id']
                new_id=digest(selection); run_dir=self.root/new_id; run_dir.mkdir(parents=True,exist_ok=True)
                with held(run_dir/'.run.lock',blocking=False):
                    if (run_dir/'run.json').exists():
                        active=self.get_run(new_id)
                        if active['state']!='complete':
                            raise ModelError('An unfinished local run already has this selection')
                        self._verified_artifacts(new_id,active)
                    else:
                        for item in original['artifacts']:
                            source=verify_file(destination/'runs'/old_id,item)
                            target=run_dir/item['path']
                            if target.is_symlink() or not target.parent.resolve().is_relative_to(run_dir.resolve()):
                                raise ModelError('Incoming artifact target leaves its run')
                            target.parent.mkdir(parents=True,exist_ok=True)
                            shutil.copyfile(source,target)
                        active={**original,'id':new_id,'case_id':incoming['id'],'selection':selection,
                                'received_from':{'archive_sha256':archive_sha,'run_id':old_id}}
                        active.pop('checkpoint',None)
                        active.pop('calibrated_case_id',None)
                        result_file=read_json(run_dir/'artifacts/result.json')
                        if result_file.get('calibrated_project'):
                            child=self.save_case({'project':result_file['calibrated_project'],
                                'source_refs':refs,'parent_id':incoming['id'],
                                'reason':'Received fitted parameter edition from '+old_id})
                            active['calibrated_case_id']=child['id']
                        atomic_json(run_dir/'run.json',active)
                adopted.append({'original_run_id':old_id,'run_id':new_id})
            result={'schema':'upstate.chemistry-receiving/v1','case_id':incoming['id'],
                    'original_case_id':case['id'],'archive_sha256':archive_sha,
                    'retained_run_ids':manifest['selection']['run_ids'], 'adopted_runs':adopted,
                    'retained_files':len(manifest['files']),
                    'directory':str(destination.relative_to(self.ws.root))}
            atomic_json(receipt,result,immutable=True)
            return result


def invoke(workspace,action,value, *, progress_hook=None):
    service=Chemistry(workspace)
    if action=='chemistry.case.save': return service.save_case(value)
    if action=='chemistry.case.from-source': return service.from_source(value)
    if action=='chemistry.case.get': return service.get_case(value['case_id'])
    if action=='chemistry.catalog': return service.catalog()
    if action in {'chemistry.report.prepare', 'chemistry.report.get', 'chemistry.report.list'}:
        from . import chemistry_reports
        if action == 'chemistry.report.prepare': return chemistry_reports.prepare(workspace, value['run_id'])
        if action == 'chemistry.report.get': return chemistry_reports.inspect(workspace, value['report_id'])
        return {'reports': chemistry_reports.catalog(workspace, value.get('run_id'))}
    if action=='chemistry.run': return service.run(value,progress_hook=progress_hook)
    if action=='chemistry.run.get': return service.get_run(value['run_id'])
    if action=='chemistry.result.page': return service.result_page(value)
    if action=='chemistry.export': return service.export(value)
    if action=='chemistry.receive':
        # A source selection uses the same retained original source intake.
        path,entry=workspace.source_file(value['source_collection_id'],value['source_id'])
        return service.receive(path)
    raise ModelError('Unknown chemistry action: '+action)
