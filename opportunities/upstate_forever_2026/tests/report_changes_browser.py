"""Actual Chromium + maintained JS/provider through explicit original-operator ports.

The ports implement the published original task/edition interfaces for a software
exercise. They do not replace a cumulative application installation test.
"""
from __future__ import annotations
import argparse, importlib.util, json, mimetypes, shutil, socket, sys, threading, time, types, uuid
import urllib.request, urllib.error
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlsplit
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from model import report_changes as rc


def browser_course(course, output):
    from playwright.sync_api import sync_playwright
    output.mkdir(parents=True,exist_ok=False)
    source=Path(__file__).resolve().parents[1]
    workspace=output/'workspace';workspace.mkdir()
    for side in ('left','right'):
        original=rc.edition(course/'received'/side)
        shutil.copytree(original['directory'],workspace/'scientific-report-editions'/original['record']['id'])
    empty=output/'empty';empty.mkdir()
    class Fault(ValueError):
        def __init__(self,code,message,status=400):super().__init__(message);self.status=status
    class EditionPort:
        def __init__(self,operator,fault):self.operator=operator
        def saved(self,key):
            return [rc.edition(p.parent)['record'] for p in (self.operator.ws(key).root/'scientific-report-editions').glob('*/edition.json')]
        def _inspect(self,ws,key):
            value=rc.edition(ws.root/'scientific-report-editions'/key,project_id=ws.project['id'])
            return value['record'],value['directory'],value['operation']
    common=types.ModuleType('model.common');common.held=rc._lock;common.identifier=rc._identifier
    editions=types.ModuleType('source_report_editions');editions.ScientificReportEditions=EditionPort
    reports=types.ModuleType('source_reports');reports.document_policy=lambda body:None
    sys.modules.update({'model.common':common,'source_report_editions':editions,'source_reports':reports})
    spec=importlib.util.spec_from_file_location('report_changes_operator_under_test',source/'operator/report_changes.py')
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    class OperatorPort:
        def ws(self,key):
            if key not in ('course','empty'):raise Fault('workspace','Unknown workspace',404)
            return types.SimpleNamespace(root=workspace if key=='course' else empty,project={'id':'software-exercise-project'})
        def _ticket(self,key,path,item,label):
            relative=Path(path).relative_to(self.ws(key).root).as_posix()
            return {'url':'/download/'+key+'/'+relative, 'bytes':item['bytes'],'sha256':item['sha256'],'label':label}
    provider=module.ReportChanges(OperatorPort(),Fault)
    tasks={};requests=[];drop={'once':True}
    host_html='''<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Report changes software course</title><link rel="stylesheet" href="/web/report_changes.css"><body><div id="root"></div><script type="module">
import {attachReportChanges} from '/web/report_changes.mjs';
let state={workspace_key:'course',tasks:[]};let desk;
const host={getState:()=>state,endpoint:(path,args={})=>path+'?'+new URLSearchParams({workspace:state.workspace_key,...args}),
api:async(url,options={})=>{const r=await fetch(url,{method:options.method||'GET',headers:{'Content-Type':'application/json'},...(options.body?{body:JSON.stringify(options.body)}:{})});const value=await r.json();if(!r.ok){const e=Error(value.error);e.status=r.status;throw e;}return value;},
refresh:async()=>{state=await host.api(host.endpoint('/api/state'));desk.update(state);}};
desk=attachReportChanges(host);desk.mount(document.querySelector('#root'));
window.switchWorkspace=key=>{desk.detach();state={workspace_key:key,tasks:[]};desk=attachReportChanges(host);desk.mount(document.querySelector('#root'));};
</script></html>'''
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*args):pass
        def send(self,body,status=200,mime='application/json'):
            body=body if isinstance(body,bytes) else json.dumps(body).encode()
            self.send_response(status);self.send_header('Content-Type',mime);self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
        def do_GET(self):self.handle_request(False)
        def do_POST(self):self.handle_request(True)
        def handle_request(self,post):
            try:
                u=urlsplit(self.path);path=unquote(u.path);q={k:v[-1] for k,v in parse_qs(u.query).items()};ws=q.pop('workspace','course')
                payload=json.loads(self.rfile.read(int(self.headers.get('Content-Length','0')))) if post else q
                if path=='/':return self.send(host_html.encode(),mime='text/html')
                if path.startswith('/web/'):
                    file=source/'operator/web'/path.removeprefix('/web/')
                    return self.send(file.read_bytes(),mime='text/javascript' if file.suffix=='.mjs' else 'text/css')
                if path=='/api/state':return self.send({'workspace_key':ws,'tasks':list(tasks.values())})
                if path=='/api/task':return self.send(provider.decorate_task(next(t for t in tasks.values() if t['id']==payload['id'])))
                if path=='/api/actions':
                    requests.append(payload.copy());op=payload['operation_id']
                    if op not in tasks:
                        task={'id':str(uuid.uuid4()),**payload,'state':'running'};tasks[op]=task
                        try:task['result']=provider.invoke(task);task['state']='complete'
                        except Exception as e:task['state']='failed';task['error']={'message':str(e)}
                    if drop['once']:
                        drop['once']=False;self.connection.shutdown(socket.SHUT_RDWR);self.connection.close();return
                    return self.send({'task':provider.decorate_task(tasks[op])})
                if path.startswith('/api/report-changes/'):
                    return self.send(provider.read(ws,path.rsplit('/',1)[1],payload))
                if path.startswith('/api/file/report-changes/'):
                    selected,key,name=path.removeprefix('/api/file/report-changes/').split('/',2)
                    _,_=provider.member(selected,key,name)
                    file=workspace/rc.KIND/key/name
                    return self.send(file.read_bytes(),mime=mimetypes.guess_type(str(file))[0] or 'application/octet-stream')
                if path.startswith('/download/'):
                    selected,name=path.removeprefix('/download/').split('/',1)
                    file=rc._path(provider.operator.ws(selected).root,name)
                    return self.send(file.read_bytes(),mime=mimetypes.guess_type(str(file))[0] or 'application/octet-stream')
                raise Fault('notfound','Not found',404)
            except Exception as e:
                try:self.send({'error':str(e)},getattr(e,'status',400))
                except (BrokenPipeError,ConnectionResetError):pass
    http=ThreadingHTTPServer(('127.0.0.1',0),Handler)
    server=threading.Thread(target=http.serve_forever,daemon=True);server.start()
    url='http://127.0.0.1:'+str(http.server_port)
    began=time.perf_counter();errors=[]
    try:
        with sync_playwright() as p:
            browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
            page=browser.new_page(viewport={'width':1280,'height':1000},device_scale_factor=1)
            page.on('pageerror',lambda e:errors.append(str(e)))
            # Browser network navigation is policy-disabled in this runner. The
            # actual HTTP service remains exercised through Python's loopback
            # transport; only the test host's network and storage ports differ.
            def transport(path, options=None):
                options=options or {}
                request=urllib.request.Request(url+path,data=json.dumps(options['body']).encode() if 'body' in options else None,
                    headers={'Content-Type':'application/json'},method=options.get('method','GET'))
                try:
                    with urllib.request.urlopen(request) as response:return {'status':response.status,'value':json.loads(response.read())}
                except urllib.error.HTTPError as e:return {'status':e.code,'value':json.loads(e.read())}
            page.expose_function('nativeHTTP',transport)
            page.set_content('<main id="root"></main>')
            page.add_style_tag(content=(source/'operator/web/report_changes.css').read_text())
            page.evaluate("""() => {const values=new Map();Object.defineProperty(window,'sessionStorage',{value:{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,String(v)),removeItem:k=>values.delete(k)}});} """)
            page.add_script_tag(content=(source/'operator/web/report_changes.mjs').read_text().replace('export function attachReportChanges','function attachReportChanges')+'\nwindow.attachReportChanges=attachReportChanges;')
            script=host_html.split('<script type="module">')[1].split('</script>')[0]
            script=script.replace("import {attachReportChanges} from '/web/report_changes.mjs';",'const {attachReportChanges}=window;')
            old="const r=await fetch(url,{method:options.method||'GET',headers:{'Content-Type':'application/json'},...(options.body?{body:JSON.stringify(options.body)}:{})});const value=await r.json();if(!r.ok){const e=Error(value.error);e.status=r.status;throw e;}return value;"
            new="const r=await nativeHTTP(url,options);const value=r.value;if(r.status>=400){const e=Error(value.error);e.status=r.status;throw e;}return value;"
            assert old in script
            script=script.replace(old,new)+"\nwindow.remount=()=>{desk.detach();desk=attachReportChanges(host);desk.mount(document.querySelector('#root'));};"
            page.add_script_tag(content="(()=>{"+script+"})();")
            page.locator('[data-report-change-field="left"] option').nth(1).wait_for(state='attached')
            left=next(x for x in provider.catalog('course')['editions'] if x['title'].startswith('Earlier'))['id']
            right=next(x for x in provider.catalog('course')['editions'] if x['title'].startswith('Later'))['id']
            page.select_option('[data-report-change-field="left"]',left)
            page.select_option('[data-report-change-field="right"]',right)
            page.get_by_role('button',name='Review reports and matching').click()
            page.get_by_text('Station results · table 1',exact=True).wait_for()
            field=page.locator('fieldset').filter(has=page.locator('legend',has_text='Station results'))
            field.get_by_label('Station ID',exact=True).check()
            assert page.get_by_role('button',name='Prepare complete comparison').is_disabled()
            page.get_by_role('button',name='Review reports and matching').click()
            page.wait_for_function("!document.querySelector('[data-report-change-action=prepare]').disabled")
            page.get_by_role('button',name='Prepare complete comparison').click()
            try:page.get_by_role('button',name='Recover original request').wait_for(timeout=15000)
            except Exception:
                print('BROWSER COURSE STATE',page.inner_text('body'),errors,requests,tasks)
                raise
            page.evaluate('remount()')
            page.get_by_role('button',name='Recover original request').click()
            page.locator('.rc-detail h3').wait_for(timeout=30000)
            assert len(tasks)==1 and len(requests)==2
            assert requests[0]['operation_id']==requests[1]['operation_id']
            page.select_option('[data-report-change-field="filter_category"]','row')
            page.select_option('[data-report-change-field="filter_status"]','changed')
            page.wait_for_function("document.querySelector('.rc-detail tbody tr td strong')?.textContent==='changed'")
            page.locator('.rc-detail h3').scroll_into_view_if_needed();page.screenshot(path=str(output/'desktop.png'),full_page=False)
            page.get_by_role('button',name='Next changes',exact=True).click()
            page.get_by_role('button',name='Previous changes',exact=True).click()
            page.get_by_role('button',name='Prepare full comparison ZIP').click()
            link=page.get_by_role('link',name='Download both originals and comparison')
            link.wait_for(timeout=30000)
            with urllib.request.urlopen(url+link.get_attribute('href')) as response:data=response.read()
            (output/'browser-comparison.zip').write_bytes(data)
            bundle=rc.inspect_archive(output/'browser-comparison.zip')
            expected=next(iter(tasks.values()))['result']['comparison_id']
            assert bundle['comparison_id']==expected
            page.set_viewport_size({'width':390,'height':844});page.screenshot(path=str(output/'mobile.png'),full_page=False)
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth+1')
            # Cold browser reopening of the complete offline presentation.
            offline=browser.new_page(viewport={'width':1280,'height':900})
            offline.set_content((workspace/rc.KIND/expected/'index.html').read_text())
            offline.add_style_tag(content=(workspace/rc.KIND/expected/'comparison.css').read_text())
            assert 'recorded changes' in offline.inner_text('body')
            offline.screenshot(path=str(output/'offline.png'),full_page=False)
            page.evaluate("switchWorkspace('empty')")
            page.wait_for_function("document.querySelector('[data-report-change-field=left]').options.length===1")
            assert page.locator('.rc-detail').count()==0
            assert not errors,errors
            browser.close()
    finally:http.shutdown();server.join()
    result={'case':'Chromium DOM + Python HTTP transport; actual provider/client on explicit native operator and storage ports','unique_tasks':len(tasks),'submitted_requests':len(requests),'lost_response_replayed_once':requests[0]['operation_id']==requests[1]['operation_id'],'downloaded_bundle':bundle['comparison_id'],'javascript_errors':errors,'seconds':round(time.perf_counter()-began,3),'checks':['saved-edition-selection','explicit-keys','preview-invalidation','lost-response-session-record-remount-recovery','original-task-reuse','row-filters','forward-back-pages','whole-bundle-download','offline-html-rendering','desktop-and-mobile','workspace-change']}
    rc._write_json(output/'browser-journey.json',result);print(json.dumps(result,indent=2))

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('course',type=Path);parser.add_argument('output',type=Path)
    args=parser.parse_args();browser_course(args.course,args.output)
