"""Planner/transport contract journey. Fixtures do not simulate InVEST science.

Uses actual retained files, immutable native IDs, durable run state, and injected
original-Workspace-shaped writers. Native numerical execution is counted, not
simulated. The production modules do not import this fixture.
"""
from pathlib import Path
import contextlib, copy, hashlib, importlib.util, json, os, shutil, sys, tempfile, threading, time, types, zipfile
import fcntl
ROOT=Path(__file__).resolve().parents[1]/'opportunities/upstate_forever_2026'
PACKAGE=types.ModuleType('model');PACKAGE.__path__=[str(ROOT/'model')];sys.modules['model']=PACKAGE
C=types.ModuleType('model.common')
def canonical(v):return (json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=False,allow_nan=False)).encode()
def digest(v):return hashlib.sha256(canonical(v)).hexdigest()
def identifier(v):
    if not isinstance(v,str) or len(v)!=64 or any(x not in '0123456789abcdef' for x in v):raise ValueError('Invalid native ID')
    return v
def read_json(p):return json.loads(Path(p).read_bytes())
def atomic_json(p,v,immutable=False):
    p=Path(p);p.parent.mkdir(parents=True,exist_ok=True);raw=canonical(v)
    if immutable and p.exists():
        if p.read_bytes()!=raw:raise ValueError('Immutable edit')
        return
    q=p.with_name('.'+p.name+'.tmp');q.write_bytes(raw);q.replace(p)
def now():return str(time.time_ns())
@contextlib.contextmanager
def held(p):
    p=Path(p);p.parent.mkdir(parents=True,exist_ok=True)
    with p.open('a') as f:
        try:fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:raise RuntimeError('Already active')
        try:yield
        finally:fcntl.flock(f,fcntl.LOCK_UN)
def verify_file(root,r):
    path=(root/r['path']).resolve();path.relative_to(root.resolve())
    if path.stat().st_size!=r['bytes'] or hashlib.sha256(path.read_bytes()).hexdigest()!=r['sha256']:raise ValueError('Retained original changed')
    return path
def json_bytes(raw):
    def pairs(ps):
        out={}
        for k,v in ps:
            if k in out:raise ValueError('Duplicate JSON key')
            out[k]=v
        return out
    return json.loads(raw,object_pairs_hook=pairs,parse_constant=lambda v:(_ for _ in()).throw(ValueError('Nonfinite JSON')))
for name in ('canonical','identifier','read_json','atomic_json','now','held','verify_file','json_bytes'):setattr(C,name,globals()[name])
sys.modules['model.common']=C
from model.source_refresh import SourceRefresh

class FixtureWorkspace:
    def __init__(self, root, create=False):
        self.root=Path(root);self.root.mkdir(parents=True,exist_ok=True)
        if create:atomic_json(self.root/'workspace.json',{'id':'contract-workspace','title':'Source refresh contract journey'})
        self.project=read_json(self.root/'workspace.json');self.executed=[];self.fail_next=False;self.prepared=[]
    def _save(self,kind,payload):
        value={k:v for k,v in payload.items() if k not in ('id','schema')};value['schema']='upstate.'+kind+'/v1';key=digest(value)
        atomic_json(self.root/kind/(key+'.json'),value,immutable=True);return {**value,'id':key}
    def _get(self,kind,key):
        value=read_json(self.root/kind/(identifier(key)+'.json'))
        if digest(value)!=key:raise ValueError('Native selection changed')
        return {**value,'id':key}
    def _list(self,kind):return [self._get(kind,p.stem) for p in sorted((self.root/kind).glob('*.json'))]
    def sources(self):return self._list('sources')
    def retain(self,body,filename):
        raw=body.encode();h=hashlib.sha256(raw).hexdigest();path=self.root/'objects'/h;path.parent.mkdir(exist_ok=True);path.write_bytes(raw)
        return {'object':str(path.relative_to(self.root)),'sha256':h,'bytes':len(raw),'filename':filename,'view_path':filename}
    def collection(self, entries):return self._save('sources',{'title':'Fixture edition','entries':entries,'original_manifest':self.retain(json.dumps(entries),'sources.json'),'captured_at':now()})
    def save_profile(self,value):self.prepared.append('profiles');return self._save('profiles',value)
    def save_scenario(self,value):self.prepared.append('scenarios');return self._save('scenarios',value)
    def prepare_grid(self,spec):
        value={'spec':spec,'grid':{'width':2,'height':2,'cellsize':30}};key=digest(value)
        out={**value,'id':key,'state':'complete'};atomic_json(self.root/'grids'/key/'grid.json',out);self.prepared.append('grids');return out
    def get_grid(self,key):
        value=read_json(self.root/'grids'/identifier(key)/'grid.json')
        if digest({k:value[k] for k in ('spec','grid')})!=key:raise ValueError('Native grid changed')
        return value
    def prepare_run(self,s):
        value={k:s[k] for k in ('grid_id','profile_id','scenario_id')};value.update(schema='upstate.run-selection/v1',invest_version='fixture-contract')
        self.get_grid(value['grid_id']);self._get('profiles',value['profile_id']);self._get('scenarios',value['scenario_id']);key=digest(value)
        path=self.root/'runs'/key/'run.json'
        if not path.exists():atomic_json(path,{'id':key,'selection':value,'state':'prepared','attempts':[]})
        self.prepared.append('runs');return self.inspect_run(key)
    def inspect_run(self,key):
        value=read_json(self.root/'runs'/identifier(key)/'run.json')
        if digest(value['selection'])!=key:raise ValueError('Native run changed')
        return value
    def run(self,key):
        value=self.inspect_run(key);self.executed.append(key);value['attempts'].append(now())
        if self.fail_next:
            self.fail_next=False;value['state']='failed';atomic_json(self.root/'runs'/key/'run.json',value);raise RuntimeError('Fixture injected stage interruption')
        value['state']='complete';atomic_json(self.root/'runs'/key/'run.json',value);return value
    def backup(self,output,include_intermediates=False):
        with zipfile.ZipFile(output,'w',zipfile.ZIP_DEFLATED) as z:
            for p in self.root.rglob('*'):
                if p.is_file() and not p.name.endswith('.lock'):z.write(p,p.relative_to(self.root))
        return {'path':str(output),'include_intermediates':include_intermediates}

W=types.ModuleType('model.workspace');W.Workspace=FixtureWorkspace;sys.modules['model.workspace']=W
from model.source_refresh_cli import main as cli
S=importlib.util.spec_from_file_location('refresh_http',ROOT/'operator/source_refresh.py');HTTP=importlib.util.module_from_spec(S);sys.modules[S.name]=HTTP;S.loader.exec_module(HTTP)

def seed(root):
    ws=FixtureWorkspace(root,True)
    names=['dem','nlcd','rain','r','k','area','domain','bio','mask','note']
    entries=[{'id':n,'title':n,'kind':'table' if n in ('bio','note') else 'raster','role':n,'units':'fixture','body':ws.retain(n,n+'.dat'),'companions':[]} for n in names]
    a=ws.collection(entries)
    grid=ws.prepare_grid({'source_collection_id':a['id'],'input_sources':dict(zip(['DEM','NLCD','PRECIPITATION','R_FACTOR','K_FACTOR'],names[:5])), 'reporting_area':{'source_id':'area'},'model_domain':{'source_id':'domain'},'buffer_m':300})
    profile=ws.save_profile({'source_collection_id':a['id'],'biophysical_source_id':'bio','title':'Fixture profile','ndr':{},'sdr':{}})
    baseline=ws.save_scenario({'source_collection_id':a['id'],'kind':'baseline','patches':[]})
    alternate=ws.save_scenario({'source_collection_id':a['id'],'kind':'landcover','patches':[{'mask_source_id':'mask','to_code':41}]})
    runs=[ws.prepare_run({'grid_id':grid['id'],'profile_id':profile['id'],'scenario_id':s['id']}) for s in (baseline,alternate)]
    for run in runs:ws.run(run['id'])
    ws.prepared.clear();ws.executed.clear()
    return ws,a,entries,grid,profile,baseline,alternate,runs

def run_contracts():
    out=[];start=time.perf_counter()
    with tempfile.TemporaryDirectory() as d:
        root=Path(d);ws,a,entries,grid,profile,baseline,alt,runs=seed(root/'original');r=SourceRefresh(ws)
        old_files={str(p.relative_to(ws.root)):p.read_bytes() for folder in ['sources','grids','profiles','scenarios','runs'] for p in (ws.root/folder).rglob('*') if p.is_file()}
        # Bio-only replacement reuses grid and both landcover scenarios; derives one shared profile and two runs.
        bentries=copy.deepcopy(entries);bentries[7]['body']=ws.retain('new coefficients','bio.dat');b=ws.collection(bentries)
        plan=r.plan(a['id'],b['id']);actions={n['key']:n['action'] for n in plan['nodes']}
        assert sum(x=='derive' for x in actions.values())==3 and sum(x=='reuse' for x in actions.values())==3
        assert r.apply(plan['id'],execute_runs=False).state['status']=='prepared' and not ws.executed
        ws.fail_next=True
        try:r.apply(plan['id'])
        except RuntimeError:pass
        else:raise AssertionError('Failed native stage was ignored')
        state=SourceRefresh(FixtureWorkspace(ws.root)).state(plan['id']);assert state['status']=='failed'
        recovered=FixtureWorkspace(ws.root);rr=SourceRefresh(recovered);done=rr.apply(plan['id']).state
        assert done['status']=='complete' and len(recovered.executed)==2
        rr.apply(plan['id']);assert len(recovered.executed)==2
        assert all((ws.root/p).read_bytes()==raw for p,raw in old_files.items())
        out.append('bio-only dependency derivation, failure, reopen, resume, repeat, originals unchanged')
        # Provenance and unrelated updates never invoke native preparation or execution.
        e=copy.deepcopy(entries);e[0]['title']='New descriptive title';e[-1]['body']=ws.retain('updated unrelated note','note.dat');c=ws.collection(e)
        ws.executed.clear();ws.prepared.clear();p=r.plan(a['id'],c['id']);assert all(n['action']=='reuse' for n in p['nodes']);r.apply(p['id']);assert not ws.executed and not ws.prepared
        out.append('metadata-only and unrelated-content changes preserve every original ID')
        e=copy.deepcopy(entries);e[0]['companions']=[ws.retain('projection v2','dem.prj')];c=ws.collection(e);p=r.plan(a['id'],c['id']);assert next(n for n in p['nodes'] if n['kind']=='grids')['action']=='derive'
        e=copy.deepcopy(entries);e[4]['units']='new interpretation';c=ws.collection(e);p=r.plan(a['id'],c['id']);assert next(n for n in p['nodes'] if n['kind']=='grids')['action']=='derive'
        out.append('native sidecar paths and scientific interpretation trigger correct grid dependents')
        e=[copy.deepcopy(x) for x in entries if x['id']!='mask'];e.append({**copy.deepcopy(entries[8]),'id':'replacement-mask','body':ws.retain('new mask','mask.dat')});c=ws.collection(e)
        p=r.plan(a['id'],c['id']);assert any(n['action']=='missing' for n in p['nodes'])
        try:r.apply(p['id'])
        except ValueError:pass
        else:raise AssertionError('Missing source allowed')
        p=r.plan(a['id'],c['id'],mapping={'mask':'replacement-mask'});result=r.apply(p['id']);changed=[s for k,s in result.state['steps'].items() if k.startswith('scenarios/') and s['action']=='derive'];assert len(changed)==1
        assert ws._get('scenarios',changed[0]['new_id'])['patches'][0]['mask_source_id']=='replacement-mask'
        out.append('missing-source repair and explicit renamed-mask binding')
        p=r.plan(a['id'],b['id'],title='Cancelled');result=r.apply(p['id'],cancelled=lambda:True);assert result.state['status']=='cancelled';assert r.apply(p['id']).state['status']=='complete'
        out.append('cancellation is durable and resumes the same plan')
        key=p['id'];path=r._state_path(key);state=r.state(key);first=next(k for k in state['steps'] if k.startswith('profiles/'));state['steps'][first]['new_id']='0'*64
        import sqlite3
        with sqlite3.connect(path) as db:db.execute('UPDATE steps SET body=? WHERE key=?',(json.dumps(state['steps'][first]),first))
        try:r.apply(key)
        except ValueError:pass
        else:raise AssertionError('Altered checkpoint ID accepted')
        out.append('changed checkpoint is rejected rather than adopting a wrong result')
        # Complete original backup includes the refresh and all referenced retained files.
        p=r.plan(a['id'],b['id'],title='Portable');r.apply(p['id']);archive=root/'portable.zip';r.export(p['id'],archive)
        received=root/'received'
        with zipfile.ZipFile(archive) as z:z.extractall(received)
        received_ws=FixtureWorkspace(received);rp=SourceRefresh(received_ws);assert rp.apply(p['id']).state['status']=='complete' and not received_ws.executed
        report=rp.report(p['id']);assert p['id'] in report['html'];assert len(report['csv'].splitlines())==len(p['nodes'])+1
        out.append('complete fixture workspace export, independent reopen, report and repeat reuse')
        # Fresh source-only project has a valid empty dependency plan.
        empty=FixtureWorkspace(root/'empty',True);aa=empty.collection(entries=[]);bb=empty.collection(entries=[]);ep=SourceRefresh(empty).plan(aa['id'],bb['id']);assert ep['nodes']==[];assert SourceRefresh(empty).apply(ep['id']).state['status']=='complete'
        # CLI both option positions; exact stdout/stderr tested as native structured I/O.
        import io
        for argv in (['--workspace',str(ws.root),'status',p['id']],['status',p['id'],'--workspace',str(ws.root)]):
            with contextlib.redirect_stdout(io.StringIO()) as stdout:assert cli(argv)==0
            assert json.loads(stdout.getvalue())['plan_id']==p['id']
        out.append('source-only edition and before/after-command workspace argument support')
        # Actual HTTP adapter with the same host and fallback route, queue and auth callbacks.
        from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
        from urllib.request import urlopen,Request
        from urllib.error import HTTPError
        class Base(BaseHTTPRequestHandler):
            def do_GET(self):self.send_response(200);self.end_headers();self.wfile.write(b'original route')
            def log_message(self,*a):pass
        jobs=[]
        def submit(kind,payload,fn):jobs.append(fn);return {'id':'original-job-1','kind':kind}
        H=HTTP.extend_handler(Base,lambda h:ws,submit_for_handler=lambda h:submit,authorize_for_handler=lambda h,w:h.headers.get('X-Deny')!='yes')
        server=ThreadingHTTPServer(('127.0.0.1',0),H);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start();url='http://127.0.0.1:'+str(server.server_port)
        assert urlopen(url+'/').read()==b'original route'
        assert b'<h1>Source refresh</h1>' in urlopen(url+'/source-refresh').read()
        assert b'__SOURCE_REFRESH_BASE__' not in urlopen(url+'/source-refresh/').read()
        assert json.load(urlopen(url+'/source-refresh/api/catalog'))['workspace']['id']==ws.project['id']
        request=Request(url+'/source-refresh/api/apply',canonical({'plan_id':p['id'],'execute_runs':False}),headers={'Content-Type':'application/json'},method='POST')
        response=urlopen(request);assert response.status==202 and json.load(response)['id']=='original-job-1' and len(jobs)==1
        jobs[0]()
        for headers in ({'Origin':'https://elsewhere.invalid'}, {'Sec-Fetch-Site':'cross-site'},{'X-Deny':'yes'}):
            req=Request(url+'/source-refresh/api/apply',canonical({'plan_id':p['id']}),headers={'Content-Type':'application/json',**headers},method='POST')
            try:urlopen(req)
            except HTTPError as e:assert e.code==403
            else:raise AssertionError('Original access or origin guard bypass')
        server.shutdown();server.server_close();thread.join()
        out.append('real HTTP fallback, assets, queued execution, original access policy and cross-origin rejection')
    return {'scope':'Planner, CLI and real HTTP integration against retained-file contract fixtures; scientific engine invocation is an injected probe.', 'journeys':out,'count':len(out),'seconds':round(time.perf_counter()-start,3)}

if __name__=='__main__':print(json.dumps(run_contracts(),indent=2))
