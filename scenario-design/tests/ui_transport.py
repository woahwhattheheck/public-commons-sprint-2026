"""Offline browser-test transport. Application DOM/JS is unchanged; HTTP goes via Python.

This is component/integration testing, not a direct browser-network reachability test.
It leaves Chromium's managed network policy untouched.
"""
import base64
import json
import re
import urllib.request
import urllib.error
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
BASE='http://127.0.0.1:8848'

def install(page):
    def request(doc):
        body=base64.b64decode(doc['body']) if doc.get('body') is not None else None
        req=urllib.request.Request(BASE+doc['path'],data=body,method=doc['method'],headers=doc['headers'])
        try: response=urllib.request.urlopen(req,timeout=30)
        except urllib.error.HTTPError as e: response=e
        with response:
            if response.status >= 400:
                data=response.read(); print('HTTP ERROR',response.status,data.decode()[:1200],flush=True)
                return {'status':response.status,'headers':dict(response.headers),'body':base64.b64encode(data).decode()}
            return {'status':response.status,'headers':dict(response.headers),'body':base64.b64encode(response.read()).decode()}
    page.expose_function('__eco_http_test_transport',request)
    html=(ROOT/'web/index.html').read_text()
    html=re.sub(r'<link[^>]+href="/style.css"[^>]*>','',html)
    html=re.sub(r'<script[^>]+src="/app.js"[^>]*></script>','',html)
    page.set_content(html)
    page.add_style_tag(content=(ROOT/'web/style.css').read_text())
    page.add_script_tag(content='''
      window.fetch=async(path,options={})=>{
        const b=options.body===undefined?null:typeof options.body==='string'?new TextEncoder().encode(options.body):new Uint8Array(options.body);
        let raw='';if(b)for(let i=0;i<b.length;i++)raw+=String.fromCharCode(b[i]);
        const r=await window.__eco_http_test_transport({path,method:options.method||'GET',headers:options.headers||{},body:b===null?null:btoa(raw)});
        const bytes=Uint8Array.from(atob(r.body),x=>x.charCodeAt(0));
        return new Response(bytes,{status:r.status,headers:r.headers});
      };
      // Supply ordinary test-page storage in the opaque about:blank test document.
      const testStorage=new Map();
      Object.defineProperty(window,'localStorage',{value:{getItem:k=>testStorage.get(k)||null,setItem:(k,v)=>testStorage.set(k,String(v)),removeItem:k=>testStorage.delete(k)}});
      if(!crypto.randomUUID)crypto.randomUUID=()=> '10000000-1000-4000-8000-100000000000'.replace(/[018]/g,c=>(c ^ crypto.getRandomValues(new Uint8Array(1))[0]&15>>c/4).toString(16));
    ''')
    page.add_script_tag(content=(ROOT/'web/app.js').read_text())
    page.wait_for_timeout(150)
