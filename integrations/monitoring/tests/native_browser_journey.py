"""Native monitoring browser transport through a current-contract HTTP fixture.

Actual shipped component, host transport, service, Fiona and optimizer execute.
Only bootstrap/module loading and fetch are bridged because this environment's
Chromium policy prevents local navigation. The cumulative product is separate.
"""
from __future__ import annotations
import hashlib, json, mimetypes, tempfile, threading, urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright
from native_contract_support import install, NativeWorkspace, NativeOperator
adapter=install()
from test_native_contract import retain_native
from model.monitoring_actions import invoke
from contract_support import configuration
ROOT=Path(__file__).resolve().parents[1]
WEB=ROOT/'src/opportunities/upstate_forever_2026/operator/web'

def main():
    with tempfile.TemporaryDirectory() as temporary:
        base=Path(temporary);source=base/'source';source.mkdir();ws=NativeWorkspace(base/'workspace',create=True)
        edition=retain_native(ws,source)
        network=invoke(ws,'network.import',{'domain_collection_id':edition['id'],'domain_source_id':'DOMAIN','station_source_id':'STATIONS','stratum_field':'stratum','priority_field':'priority','station_outlet_field':'at_outlet'})
        plan=invoke(ws,'design',{'network_id':network['id'],'configuration':configuration(),'title':'Native queued design'})
        operator=NativeOperator(ws,base/'operator');errors=[];drop_create_response={'remaining':True}
        class Handler(BaseHTTPRequestHandler):
            def log_message(self,*args):pass
            def answer(self,status,value,media='application/json'):
                raw=value if isinstance(value,bytes) else json.dumps(value).encode()
                self.send_response(status);self.send_header('Content-Type',media);self.send_header('Content-Length',str(len(raw)));self.end_headers();self.wfile.write(raw)
            def do_GET(self):
                try:
                    parsed=urlparse(self.path);q={k:v[0] for k,v in parse_qs(parsed.query).items()}
                    if parsed.path=='/api/monitoring':return self.answer(200,adapter.read(operator,q['workspace'],q['action'],json.loads(q['payload'])))
                    if parsed.path=='/api/task':return self.answer(200,operator.task_view(q['id']))
                    if parsed.path.startswith('/api/file/'):
                        record=operator.downloads[parsed.path.rsplit('/',1)[1]];return self.answer(200,Path(record['path']).read_bytes(),'application/zip')
                    return self.answer(404,{'error':{'message':'No test route'}})
                except Exception as exc:return self.answer(422,{'error':{'message':str(exc)}})
            def do_POST(self):
                request=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                task=operator.submit(request)
                if request['action']=='monitoring.campaign.create' and drop_create_response['remaining']:
                    drop_create_response['remaining']=False
                    return self.answer(502,{'error':{'message':'Authored lost-response transport interruption'}})
                self.answer(202,task)
        server=ThreadingHTTPServer(('127.0.0.1',0),Handler);threading.Thread(target=server.serve_forever,daemon=True).start()
        origin=f'http://127.0.0.1:{server.server_port}'
        try:
            with sync_playwright() as p:
                browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
                page=browser.new_page(viewport={'width':1440,'height':1100});page.on('pageerror',lambda e:errors.append(str(e)))
                def bridge(path,options):
                    data=json.dumps(options['body']).encode() if 'body' in options else None
                    request=urllib.request.Request(origin+path,data=data,method=options.get('method','GET'),headers={'Content-Type':'application/json'})
                    with urllib.request.urlopen(request) as response:return json.loads(response.read())
                page.expose_function('__nativeApi',bridge)
                page.expose_function('__nativeDigest',lambda values:list(hashlib.sha256(bytes(values)).digest()))
                page.set_content(f'<html><head><base href="{origin}/"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><main id="content"></main></body></html>')
                page.add_script_tag(content='''
                globalThis.__ecoMonitoringNativeHost=true;
                if(!crypto.randomUUID)crypto.randomUUID=()=>Array.from(crypto.getRandomValues(new Uint8Array(16))).map(v=>v.toString(16).padStart(2,'0')).join('');
                if(!crypto.subtle)Object.defineProperty(crypto,'subtle',{value:{digest:async(_,raw)=>new Uint8Array(await __nativeDigest([...new Uint8Array(raw)])).buffer}});
                ''')
                # Use exactly the delivered component; external style bytes are
                # attached locally rather than requesting a policy-blocked origin.
                page.add_script_tag(content=(WEB/'monitoring-component.mjs').read_text())
                host=(WEB/'monitoring.mjs').read_text().replace("return componentReady ||= import('./monitoring-component.mjs');","return componentReady ||= Promise.resolve();")
                host=host.replace('export function attachMonitoring','function attachMonitoring')+'\nglobalThis.attachMonitoring=attachMonitoring;'
                page.add_script_tag(content=host)
                assert not errors, errors
                page.evaluate('''key=>{globalThis.nativeState={workspace_key:key};globalThis.monitor=attachMonitoring({getState:()=>nativeState,api:(p,o={})=>__nativeApi(p,o),showTask:()=>{}});return monitor.mount(document.querySelector('#content'));}''',operator.primary)
                page.locator('#plans option').filter(has_text='Native queued design').wait_for(state='attached')
                page.evaluate('''css=>{const root=document.querySelector('eco-monitoring').shadowRoot;root.querySelector('link').remove();const style=document.createElement('style');style.textContent=css;root.append(style);}''',(WEB/'monitoring.css').read_text())
                page.get_by_text('Import retained source geometry',exact=True).click()
                selfield=page.locator('#domain-collection');selfield.select_option(edition['id'])
                selfield.dispatch_event('change');assert page.locator('#domain-entries option').count()==2
                page.locator('#plans').select_option(plan['id']);page.locator('#sites tbody tr').nth(6).wait_for()
                page.get_by_role('button',name='Create campaign from this design').click()
                page.wait_for_function("document.querySelector('eco-monitoring').shadowRoot.getElementById('status').dataset.error==='true'")
                page.get_by_role('button',name='Create campaign from this design').click();page.locator('#bindings select').first.wait_for()
                assert len(invoke(ws,'campaign.list',{}))==1
                for select in page.locator('#bindings select').all():select.select_option(index=1)
                page.get_by_role('button',name='Save source-station bindings').click()
                page.wait_for_function("document.querySelector('eco-monitoring').shadowRoot.getElementById('campaign-detail').textContent.includes('revision 2')")
                page.get_by_text('Record a field event',exact=True).click();page.locator('#sample-id').fill('NATIVE-BROWSER-01');page.locator('#occurred').fill('2026-11-02T09:00:00-05:00')
                page.get_by_role('button',name='Append field event').click()
                page.wait_for_function("document.querySelector('eco-monitoring').shadowRoot.getElementById('campaign-detail').textContent.includes('revision 3')")
                page.get_by_text('Reports and complete editable handover',exact=True).click();page.get_by_role('button',name='Field package',exact=True).click();page.locator('#downloads a').wait_for()
                href=page.locator('#downloads a').first.get_attribute('href');assert '/api/file/' in href
                with urllib.request.urlopen(href) as response:(ROOT/'evidence/native-browser-field-package.zip').write_bytes(response.read())
                page.locator('#title').fill('Unsaved draft survives original view switching')
                page.evaluate("async()=>{monitor.detach();await monitor.mount(document.querySelector('#content'));}")
                assert page.locator('#title').input_value()=='Unsaved draft survives original view switching'
                page.evaluate("async()=>{nativeState.tasks=[{id:'fixture-source-completed',action:'source.import',state:'complete'}];await monitor.update();}")
                assert page.locator('#title').input_value()=='Unsaved draft survives original view switching'
                assert page.locator('#domain-collection').input_value()==edition['id']
                assert page.locator('#map path').count()==24
                page.get_by_text('Record a field event',exact=True).click()
                page.screenshot(path=str(ROOT/'evidence/native-monitoring-desktop.png'),full_page=True)
                page.set_viewport_size({'width':412,'height':915});page.screenshot(path=str(ROOT/'evidence/native-monitoring-mobile.png'),full_page=True)
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
                campaign_id=page.locator('#campaigns').input_value()
                page.evaluate('''async()=>{monitor.detach();monitor=attachMonitoring({getState:()=>nativeState,api:(p,o={})=>__nativeApi(p,o),showTask:()=>{}});await monitor.mount(document.querySelector('#content'));}''')
                page.locator('#campaigns option').filter(has_text='revision 3').wait_for(state='attached');page.locator('#campaigns').select_option(campaign_id)
                page.locator('#calendar tbody tr').first.wait_for();assert 'collected' in page.locator('#calendar tbody tr').first.inner_text()
                assert not errors,errors
                browser.close()
            output={'scope':'Current-contract source/queue fixture with shipped native browser transport and real monitoring service; explicit local API/bootstrap bridge',
                    'source_edition':edition['id'],'source_polygons':24,'field_revision':3,'queued_writes':operator.calls,'file_ticket_download':True,'lost_response_create_replayed_once':True,'draft_preserved_across_mount_and_source_refresh':True,'reopen':True,'page_errors':errors,'passed':True}
            (ROOT/'evidence/native-browser.json').write_text(json.dumps(output,indent=2));print(json.dumps(output,indent=2))
        finally:server.shutdown();server.server_close();operator.close()

if __name__=='__main__':main()
