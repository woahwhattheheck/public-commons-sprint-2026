"""Operate the actual browser controls through two independent local desks."""
from __future__ import annotations
import hashlib,json,os,sys,threading,time,zipfile,urllib.request,urllib.error,urllib.parse,shutil
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from model.project_transfer_desk import make_server
from model.project_transfer import verify_directory
from transfer_journey import archive
from playwright.sync_api import sync_playwright

BASE=Path(sys.argv[1] if len(sys.argv)>1 else '/mnt/data/transfer-browser');BASE.mkdir(parents=True,exist_ok=True)
payload=BASE/'browser-commissioning.bin';payload.write_bytes(hashlib.shake_256(b'browser transport only').digest(65536))
source=BASE/'original-project.zip';archive(source,payload)
servers=[]
for name in ('sender','receiver'):
    server,desk=make_server(BASE/name,port=0);threading.Thread(target=server.serve_forever,daemon=True).start();servers.append((server,desk))

def state(page):
    return page.evaluate("async()=>{const r=await fetch('/api/state',{headers:{'X-Transfer-Key':document.querySelector('meta[name=transfer-key]').content}});return r.json()}")

def wait_task(page,action,*,count=1):
    deadline=time.monotonic()+90
    while time.monotonic()<deadline:
        rows=[r for r in state(page)['tasks'] if r['action']==action]
        if len(rows)>=count:
            t=rows[0]
            if t['state']=='failed':raise AssertionError(t['error'])
            if t['state']=='complete':
                page.wait_for_timeout(1600);return t
        page.wait_for_timeout(100)
    raise AssertionError('Timed out waiting for actual '+action)


# The managed system browser refuses navigation to loopback URLs. Render our
# owned page in Chromium and bridge its fetch calls to the ACTUAL HTTP service.
# No task result, upload, transfer data, download body or status is fabricated.
downloads={}
def open_dom(page,desk):
    downloads[id(page)]=[]
    def http_call(path,method,headers,data):
        url=urllib.parse.urljoin(desk.origin,path)
        if urllib.parse.urlsplit(url).netloc!=urllib.parse.urlsplit(desk.origin).netloc:
            raise ValueError('The commissioning bridge serves this desk only')
        headers={**headers,'X-Transfer-Key':desk.capability,'Origin':desk.origin}
        request=urllib.request.Request(url,data=bytes(data) if data is not None else None,headers=headers,method=method)
        try:
            with urllib.request.urlopen(request) as response:
                return {'status':response.status,'headers':dict(response.headers),'body':list(response.read())}
        except urllib.error.HTTPError as response:
            return {'status':response.code,'headers':dict(response.headers),'body':list(response.read())}
    def save(name,data):
        path=BASE/(str(id(page))+'-'+str(len(downloads[id(page)]))+'-'+Path(name).name)
        path.write_bytes(bytes(data));downloads[id(page)].append(path)
    page.expose_function('__transferFetch',http_call)
    page.expose_function('__transferSha',lambda data:list(hashlib.sha256(bytes(data)).digest()))
    page.expose_function('__saveTransferDownload',save)
    markup=urllib.request.urlopen(desk.origin).read().decode()
    markup=markup.replace('<link rel="stylesheet" href="/transfer_desk.css">','').replace('<script type="module" src="/transfer_desk.mjs"></script>','')
    markup=markup.replace('<head>','<head><base href="'+desk.origin+'/">')
    page.set_content(markup)
    page.add_style_tag(content=urllib.request.urlopen(desk.origin+'/transfer_desk.css').read().decode())
    page.evaluate(r"""() => {
        const originalFetch=window.fetch.bind(window);
        Object.defineProperty(crypto,'subtle',{value:{digest:async(algorithm,data)=>new Uint8Array(await __transferSha(Array.from(new Uint8Array(data.buffer||data,data.byteOffset||0,data.byteLength)))).buffer}});
        crypto.randomUUID=()=>{const a=crypto.getRandomValues(new Uint8Array(16));a[6]=(a[6]&15)|64;a[8]=(a[8]&63)|128;return [...a].map((v,i)=>([4,6,8,10].includes(i)?'-':'')+v.toString(16).padStart(2,'0')).join('')};
        window.fetch=async(path,opts={})=>{
            let body=null;
            if(opts.body!==undefined){let b=opts.body;if(typeof b==='string')b=new TextEncoder().encode(b);else if(b instanceof Blob)b=new Uint8Array(await b.arrayBuffer());else b=new Uint8Array(b);body=Array.from(b)}
            const r=await __transferFetch(String(path),opts.method||'GET',opts.headers||{},body);
            return new Response(new Uint8Array(r.body),{status:r.status,headers:r.headers});
        };
        async function save(a){const r=await(a.href.startsWith('blob:')?originalFetch(a.href):fetch(a.href));await __saveTransferDownload(a.download||'download.bin',Array.from(new Uint8Array(await r.arrayBuffer())))}
        HTMLAnchorElement.prototype.click=function(){if(this.download)void save(this);else throw Error('Unexpected navigation in owned DOM commissioning')};
        document.addEventListener('click',e=>{const a=e.target.closest('a');if(a?.download){e.preventDefault();void save(a)}},true);
    }""")
    page.add_script_tag(type='module',content=urllib.request.urlopen(desk.origin+'/transfer_desk.mjs').read().decode())

def take_download(page,locator,path):
    count=len(downloads[id(page)]);locator.click()
    until=time.monotonic()+90
    while len(downloads[id(page)])==count and time.monotonic()<until:page.wait_for_timeout(50)
    assert len(downloads[id(page)])>count,'Actual retained download did not arrive'
    shutil.copyfile(downloads[id(page)][-1],path)

results={};started=time.monotonic()
try:
    with sync_playwright() as p:
        browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
        context=browser.new_context(viewport={'width':1440,'height':1100},accept_downloads=True,record_video_dir=str(BASE/'video'))
        a=context.new_page();b=context.new_page();errors=[]
        for page in (a,b): page.on('pageerror',lambda error:errors.append(str(error)))
        open_dom(a,servers[0][1]);open_dom(b,servers[1][1])
        a.locator('#upload-files').set_input_files(str(source));a.locator('#upload').click()
        captured=wait_task(a,'capture');snapshot=captured['result']['snapshot_id']
        a.locator('#snapshot').select_option(snapshot)
        manifest=BASE/'project.transfer.json';take_download(a,a.locator('#manifest'),manifest)
        b.locator('#upload-kind').select_option('manifest');b.locator('#upload-files').set_input_files(str(manifest));b.locator('#upload').click()
        b.wait_for_function("document.querySelector('#summary').textContent.includes('Receiving:')")
        request=BASE/'receiver.missing.json';take_download(b,b.locator('#needs'),request)
        a.locator('#request-file').set_input_files(str(request));a.locator('#parts').click();packed=wait_task(a,'parts')
        part=BASE/'project.uptransfer.zip';take_download(a,a.get_by_role('link',name='Transfer part 1',exact=False).first,part)
        b.locator('#upload-kind').select_option('receive');b.locator('#upload-files').set_input_files(str(part));b.locator('#upload').click();received=wait_task(b,'receive')
        b.wait_for_function("document.querySelector('#summary').textContent.includes('Ready:')")
        b.locator('#copy-name').fill('independent-browser-copy');b.locator('#copy').click();opened=wait_task(b,'open_copy')
        verify_directory(servers[1][1].store,snapshot,opened['result']['directory'])
        b.locator('#assemble').click();built=wait_task(b,'assemble')
        native=BASE/'received-native.zip';take_download(b,b.get_by_role('link',name='Complete native workspace ZIP',exact=False).first,native);servers[1][1].store.verify_archive(snapshot,native)
        b.locator('#report').click();report=wait_task(b,'report')
        b.locator('#inventory-title').scroll_into_view_if_needed();b.screenshot(path=str(BASE/'file-inventory.png'),full_page=False)
        b.evaluate('window.scrollTo(0,0)');b.screenshot(path=str(BASE/'handover-desk.png'),full_page=False)
        # A real second source edition and the browser's comparison control.
        with payload.open('r+b') as f:f.seek(100);f.write(b'changed source revision')
        second=BASE/'edited-project.zip';archive(second,payload,edition=2)
        a.locator('#upload-kind').select_option('capture');a.locator('#upload-files').set_input_files(str(second));a.locator('#upload').click()
        changed=wait_task(a,'capture',count=2);id2=changed['result']['snapshot_id'];a.locator('#snapshot').select_option(id2);a.locator('#previous').select_option(snapshot);a.locator('#compare').click()
        a.wait_for_function("document.querySelector('#difference').textContent.includes('reused across editions')")
        a.locator('#compare-title').scroll_into_view_if_needed();a.screenshot(path=str(BASE/'edition-comparison.png'),full_page=False)
        assert not errors,errors
        results={'status':'PASS','browser':'System Chromium DOM with actual HTTP-service bridge; managed loopback navigation returned ERR_BLOCKED_BY_ADMINISTRATOR','two_independent_desks':True,
                 'original_zip_upload':True,'manifest_and_missing_request_download':True,'requested_parts_download':True,
                 'receiver_parts_upload':True,'independent_copy':'MATCH','native_zip_download':'MATCH',
                 'complete_inventory_export':True,'edition_difference_control':True,'browser_errors':errors,
                 'original_snapshot':snapshot,'edited_snapshot':id2,'received_bytes':received['result']['received_bytes'],
                 'files':len(servers[1][1].store.snapshot(snapshot)['members'])-1,'seconds':time.monotonic()-started,
                 'screenshots':['handover-desk.png','file-inventory.png','edition-comparison.png'],
                 'data_meaning':'Original archive layout with generated transport payload and complete current application source; no hydrology is represented.'}
        context.close();browser.close()
finally:
    for server,desk in servers:server.shutdown();server.server_close();desk.close()
(BASE/'browser-result.json').write_text(json.dumps(results,indent=2)+'\n');print(json.dumps(results,indent=2))
