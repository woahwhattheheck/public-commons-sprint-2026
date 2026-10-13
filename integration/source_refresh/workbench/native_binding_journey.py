"""Actual HTTP against the concrete native-binding contract, plus installer composition."""
from journey import ROOT, seed, SourceRefresh
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from concurrent.futures import ThreadPoolExecutor
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from urllib.parse import urlsplit,parse_qs
import copy, hashlib, hmac, importlib.util, json, sys, tempfile, threading, time, zipfile
sys.path.insert(0,str(ROOT/'operator'))
from source_refresh_native import install

class Fault(Exception):
 def __init__(self,code,message,status=422):super().__init__(message);self.code=code;self.status=status
class Original:
 def __init__(self,workspaces,root):
  self.workspaces=workspaces;self.primary=next(iter(workspaces));self.root=root;self.capability='fixture-native-session';self.tasks={};self.pool=ThreadPoolExecutor(max_workers=1)
 def ws(self,key):
  if key not in self.workspaces:raise Fault('WORKSPACE_MISSING','Select an available workspace.',404)
  return self.workspaces[key]
 def _invoke(self,task):
  if task['action']=='workspace.backup':return self.ws(task['workspace']).backup(self.root/(task['id']+'.zip'),include_intermediates=True)
  return {'delegated':True}
 def submit(self,workspace,action,payload,operation_id):
  key=hashlib.sha256((workspace+operation_id).encode()).hexdigest()
  if key in self.tasks:return self.tasks[key]
  self.ws(workspace);task={'id':key,'workspace':workspace,'action':action,'payload':payload,'operation_id':operation_id,'state':'queued'};self.tasks[key]=task
  def work():
   task['state']='running'
   try:task['result']=self._invoke(task);task['state']='complete'
   except Exception as e:task.update(state='failed',error={'message':str(e)})
  self.pool.submit(work);return task
class Handler(BaseHTTPRequestHandler):
 def log_message(self,*a):pass
 @property
 def app(self):return self.server.operator
 def check_host(self):
  if self.headers.get('Host')!=urlsplit(self.app.origin).netloc:raise Fault('HOST_INVALID','Open original operator.',403)
  if self.headers.get('Origin') and self.headers['Origin']!=self.app.origin:raise Fault('ORIGIN_INVALID','Use original origin.',403)
 def authorized(self):
  self.check_host()
  if not hmac.compare_digest(self.headers.get('Authorization',''),'Bearer '+self.app.capability):raise Fault('OPERATOR_TOKEN','Open current operator startup URL.',401)
 def send_json(self,status,value):
  raw=json.dumps(value).encode();self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(raw)));self.end_headers();self.wfile.write(raw)
 def fail(self,e):return self.send_json(getattr(e,'status',422),{'error':{'code':getattr(e,'code','INPUT_INVALID'),'message':str(e)}})
 def do_GET(self):
  try:
   self.authorized();q=parse_qs(urlsplit(self.path).query)
   if urlsplit(self.path).path=='/api/task':return self.send_json(200,self.app.tasks[q['id'][0]])
   return self.send_json(200,{'original_route':True})
  except Exception as e:self.fail(e)

def journey():
 with tempfile.TemporaryDirectory() as d:
  root=Path(d);a=seed(root/'a')[0];b,old,entries,*_=seed(root/'b');changed=copy.deepcopy(entries);changed[7]['body']=b.retain('updated native-bound table','bio.dat');new=b.collection(changed)
  app=Original({'a'*64:a,'b'*64:b},root)
  namespace={'Operator':Original,'Handler':Handler,'ACTIONS':{'workspace.backup'}}
  selected=install(namespace);assert install(namespace) is selected and 'source-refresh.apply' in namespace['ACTIONS']
  http=ThreadingHTTPServer(('127.0.0.1',0),selected);http.operator=app;app.origin='http://127.0.0.1:'+str(http.server_address[1]);thread=threading.Thread(target=http.serve_forever,daemon=True);thread.start()
  def request(path,value=None,auth=True,origin=None):
   headers={'Authorization':'Bearer '+app.capability} if auth else {}
   if value is not None:headers['Content-Type']='application/json'
   if origin:headers['Origin']=origin
   req=Request(app.origin+path,data=None if value is None else json.dumps(value).encode(),headers=headers)
   try:
    with urlopen(req,timeout=5) as f:return f.status,f.read()
   except HTTPError as e:return e.code,e.read()
  def job(task):
   for _ in range(300):
    if task['state'] not in ('queued','running'):return task
    time.sleep(.01)
   raise AssertionError('Original queue did not finish')
  try:
   assert request('/source-refresh',auth=False)[0]==200
   code,raw=request('/source-refresh/api/catalog',auth=False);assert code==401 and json.loads(raw)['error']['code']=='OPERATOR_TOKEN'
   assert json.loads(request('/api/state')[1])['original_route']
   assert request('/source-refresh/api/catalog?workspace='+'c'*64)[0]==404
   scope={'workspace':'b'*64,'from_collection_id':old['id'],'to_collection_id':new['id']}
   assert request('/source-refresh/api/plan',scope,origin='https://wrong.invalid')[0]==403
   code,raw=request('/source-refresh/api/plan',scope);assert code==201;plan=json.loads(raw)
   payload={'workspace':'b'*64,'plan_id':plan['id'],'execute_runs':True,'operation_id':'retained-operation-0001'}
   code,raw=request('/source-refresh/api/apply',payload);assert code==202;task=json.loads(raw);done=job(app.tasks[task['id']]);assert done['state']=='complete',done
   assert len(b.executed)==2 and not a.executed
   same=json.loads(request('/source-refresh/api/apply',payload)[1]);assert same['id']==task['id'] and len(b.executed)==2
   code,raw=request('/source-refresh/api/export',{'workspace':'b'*64,'plan_id':plan['id'],'operation_id':'retained-backup-0001'});assert code==202
   task=job(app.tasks[json.loads(raw)['id']]);assert task['action']=='workspace.backup' and task['state']=='complete',task
   with zipfile.ZipFile(task['result']['path']) as z:assert any(n.endswith('state.sqlite3') for n in z.namelist())
   spec=importlib.util.spec_from_file_location('refresh_installer',ROOT/'install_source_refresh.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
   target=root/'application';(target/'operator/web').mkdir(parents=True)
   (target/'operator/server.py').write_text('SIBLING_EXTENSION = 73\ndef main():\n    pass\n\nif __name__ == "__main__":\n    main()\n')
   (target/'operator/web/index.html').write_text('<head></head><nav>\n    <button data-view="sources">Original sources</button>\n</nav>')
   preview=module.install(target,ROOT,dry_run=True);assert len(preview['changed'])==12
   module.install(target,ROOT);assert module.install(target,ROOT)['changed']==[]
   assert 'SIBLING_EXTENSION = 73' in (target/'operator/server.py').read_text()
   return {'journey':'Concrete native binding and source-preserving installer','authorization_status':401,'workspace_isolation':True,'original_route_preserved':True,'retained_operation_retry':True,'original_backup_with_sqlite':True,'repeat_install_changes':0}
  finally:http.shutdown();http.server_close();app.pool.shutdown(wait=True)
if __name__=='__main__':print(json.dumps(journey(),indent=2))
