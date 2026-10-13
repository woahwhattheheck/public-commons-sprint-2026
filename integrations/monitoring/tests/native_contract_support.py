"""Current native storage/operator contract fixture, not the cumulative product.

Matches the retrieved source-edition and ID-free immutable JSON contracts at
Workspace blob 4785867, common dc48652, operator 8434eba9. Product modules and
Fiona/SciPy are the actual shipped implementations; provider/model jobs are not
substituted by this fixture or claimed as executed.
"""
import contextlib, hashlib, importlib.util, json, os, shutil, sys, tempfile, threading, time, types, uuid, zipfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from contract_support import canonical_bytes, digest, atomic_json, load_json, file_sha256, utc_now

@contextlib.contextmanager
def held(path, *, blocking=True):
    import fcntl
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    with path.open('a+b') as f:
        fcntl.flock(f.fileno(),fcntl.LOCK_EX | (0 if blocking else fcntl.LOCK_NB))
        yield

class NativeWorkspace:
    def __init__(self, root, *, create=False, title='Current-contract fixture'):
        self.root=Path(root).resolve()
        if create:
            self.root.mkdir(parents=True,exist_ok=True)
            atomic_json(self.root/'workspace.json',{'schema':'upstate.scientific-workbench/v1','id':str(uuid.uuid4()),'title':title})
        self.project=load_json(self.root/'workspace.json')
    def _save(self,kind,payload):
        value={key:item for key,item in dict(payload).items() if key not in ('id','schema')}
        value['schema']='upstate.'+kind+'/v1';key=digest(value);path=self.root/kind/(key+'.json')
        if path.exists():assert load_json(path)==value
        else:atomic_json(path,value)
        return {**value,'id':key}
    def _get(self,kind,key):
        if len(key)!=64 or any(c not in '0123456789abcdef' for c in key):raise ValueError('Native record ID')
        value=load_json(self.root/kind/(key+'.json'));assert digest(value)==key
        return {**value,'id':key}
    def _list(self,kind):return [self._get(kind,p.stem) for p in sorted((self.root/kind).glob('*.json'))]
    def sources(self):return self._list('sources')
    def import_sources(self,manifest):
        manifest=Path(manifest);value=load_json(manifest);entries=[]
        assert value['schema']=='upstate.sources/v1'
        def retain(path,view_path):
            raw=path.read_bytes();sha=hashlib.sha256(raw).hexdigest();target=self.root/'objects'/sha
            target.parent.mkdir(exist_ok=True);target.write_bytes(raw)
            return {'sha256':sha,'bytes':len(raw),'object':'objects/'+sha,'filename':path.name,'view_path':view_path}
        for row in value['entries']:
            row=dict(row);name=row.pop('path');companions=row.pop('companions',[])
            entries.append({**row,'body':retain(manifest.parent/name,name),
                'companions':[retain(manifest.parent/r['path'],r['path']) for r in companions]})
        return self._save('sources',{'title':value['title'],'entries':entries})
    def source_file(self,collection_id,source_id):
        entry=next(e for e in self._get('sources',collection_id)['entries'] if e['id']==source_id)
        view=self.root/'source-views'/collection_id/digest(source_id)
        for b in [entry['body'],*entry['companions']]:
            source=self.root/b['object'];assert source.stat().st_size==b['bytes'] and file_sha256(source)==b['sha256']
            target=view/b['view_path'];target.parent.mkdir(parents=True,exist_ok=True)
            if not target.exists():shutil.copyfile(source,target)
            assert file_sha256(target)==b['sha256']
        return view/entry['body']['view_path'],entry
    def backup(self,destination,*,include_intermediates=True):
        # Test custody/export placement, not the real application's archive parser.
        with zipfile.ZipFile(destination,'w') as archive:
            for p in sorted(self.root.rglob('*')):
                if p.is_file() and 'source-views' not in p.parts and not p.name.endswith('.lock'):
                    archive.write(p,'workspace/'+p.relative_to(self.root).as_posix())
        return {'path':str(destination),'bytes':destination.stat().st_size,'sha256':file_sha256(destination),'fixture':True}


def install():
    root=Path(__file__).resolve().parents[1]/'src/opportunities/upstate_forever_2026'
    package=types.ModuleType('model');package.__path__=[str(root/'model')];sys.modules['model']=package
    common=types.ModuleType('model.common')
    # Exactly current names; deliberately omit all legacy aliases/ContractError.
    for name,fn in {'canonical':canonical_bytes,'digest':digest,'atomic_json':atomic_json,'file_digest':file_sha256,'read_json':load_json,'now':utc_now,'held':held}.items():setattr(common,name,fn)
    sys.modules['model.common']=common
    wsmod=types.ModuleType('model.workspace');wsmod.Workspace=NativeWorkspace;sys.modules['model.workspace']=wsmod
    spec=importlib.util.spec_from_file_location('monitoring_native',root/'operator/monitoring_native.py')
    module=importlib.util.module_from_spec(spec);sys.modules[spec.name]=module;spec.loader.exec_module(module)
    return module


class NativeOperator:
    """HTTP-test queue fixture with original public task/ticket contracts."""
    def __init__(self,workspace,state):
        self.workspace=workspace;self.primary=digest({'directory':str(workspace.root)})
        self.root=Path(state);self.root.mkdir(parents=True,exist_ok=True)
        self.tasks={};self.downloads={};self.pool=ThreadPoolExecutor(max_workers=1)
        self.adapter=sys.modules['monitoring_native'];self.calls=0
    def ws(self,key):
        if key!=self.primary:raise ValueError('Unknown workspace')
        return self.workspace
    def submit(self,request):
        assert request['action'] in self.adapter.ACTIONS
        key=digest({'workspace':request['workspace'],'operation_id':request['operation_id']})
        if key in self.tasks:return self.tasks[key]
        task={'id':key,**request,'state':'queued'};self.tasks[key]=task
        def perform():
            task['state']='running'
            try:task['result']=self.adapter.perform(self,task);task['state']='complete'
            except Exception as error:task['error']={'message':str(error)};task['state']='failed'
        self.calls+=1;self.pool.submit(perform)
        return task
    def task_view(self,key):return self.adapter.decorate_task(self,self.tasks[key])
    def _ticket(self,workspace,path,metadata,title):
        key=digest({'workspace':workspace,'sha256':metadata['sha256'],'path':str(path)})
        result={'id':key,'title':title,'path':str(path),'bytes':metadata['bytes'],'sha256':metadata['sha256']}
        self.downloads[key]=result;return result
    def close(self):self.pool.shutdown()
