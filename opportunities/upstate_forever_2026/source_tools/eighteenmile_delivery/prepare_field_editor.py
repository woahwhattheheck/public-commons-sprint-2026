#!/usr/bin/env python3
"""Package a retained plan inside its existing offline implementation editor.

The editor and all record calculations remain the original application source.
The bootstrap uses its normal JSON-import method, preserving existing drafts.
"""
from __future__ import annotations
import argparse, hashlib, html, json
from pathlib import Path

BOOTSTRAP = r'''
(async function openPreparedPlan(){
  'use strict';
  const encoded=document.getElementById('prepared-plan').textContent;
  const original=JSON.parse(encoded);
  const status=document.getElementById('prepared-status');
  const button=document.getElementById('prepared-original');
  const workbench=window.implementationWorkbench;
  const root=document.getElementById('implementation-root');
  function makeTablesReachable(){
    for(const region of root.querySelectorAll('.iw-table-wrap')){
      region.tabIndex=0;region.setAttribute('role','region');
      region.setAttribute('aria-label','Original field table: scroll horizontally to read all columns');
    }
  }
  new MutationObserver(makeTablesReachable).observe(root,{childList:true,subtree:true});
  makeTablesReachable();
  if(!workbench || typeof workbench.change!=='function' || typeof workbench.openPlan!=='function'){
    status.textContent='The original field editor could not open. Keep this file and use Open JSON in the complete received application.';
    button.disabled=true;return;
  }
  async function importOriginal(){
    button.disabled=true;
    try {
      const input=document.querySelector('[data-impl-file]');
      if(!input)throw new Error('The original JSON-import control is unavailable.');
      const transfer=new DataTransfer();
      transfer.items.add(new File([encoded],original.id+'.json',{type:'application/json'}));
      input.files=transfer.files;
      await workbench.change({target:input});
      if(workbench.plan?.id!==original.id || workbench.plan?.revision!==original.revision)
        throw new Error('The original retained plan did not open.');
      status.textContent='Original saved revision '+original.revision+' loaded with '+original.observations.length+' observations. Export JSON to retain your edits.';
    }catch(error){status.textContent=error.message;}
    finally{button.disabled=false;}
  }
  button.addEventListener('click',importOriginal);
  for(const jump of document.querySelectorAll('[data-prepared-tab]'))jump.addEventListener('click',()=>{
    const native=document.querySelector('[data-impl="tab"][data-tab="'+jump.dataset.preparedTab+'"]');
    if(!native)return;
    native.click();
    requestAnimationFrame(()=>{
      const section=jump.dataset.preparedSection;
      const region=section==='results'?document.querySelector('[aria-label="Original field and laboratory results"]'):
        section==='visits'?[...document.querySelectorAll('.iw-body h3')].find(h=>h.textContent==='Field visits'):
        document.querySelector('.iw-body');
      region?.scrollIntoView({block:'start'});
      for(const item of document.querySelectorAll('[data-prepared-tab]'))item.setAttribute('aria-current',String(item===jump));
    });
  });
  try {
    const saved=workbench.offlineCopies?.[original.id];
    if(saved){
      await workbench.openPlan(original.id);
      status.textContent='Continued the existing browser copy. Its current edits are retained. Export JSON to keep a portable copy.';
    }else await importOriginal();
  }catch(error){status.textContent=error.message;}
})();
'''


def build(application: Path, plan_file: Path, output: Path) -> dict:
    application=application.resolve();plan_file=plan_file.resolve();output=output.resolve()
    raw=(application/'operator/web/implementation_workbench.html').read_bytes()
    plan_bytes=plan_file.read_bytes();plan=json.loads(plan_bytes.decode('utf-8-sig'))
    import sys
    sys.path.insert(0,str(application))
    from model.implementation_schema import validate_plan, document_digest
    validate_plan(plan)
    source=raw.decode('utf-8')
    if not source.rstrip().endswith('</body></html>') and not source.rstrip().endswith('</body>\n</html>') or 'window.implementationWorkbench = ' not in source:
        raise ValueError('Receive the complete original standalone implementation workbench first.')
    if output.exists():raise FileExistsError(output)
    output.mkdir(parents=True)
    payload=json.dumps(plan,ensure_ascii=False,separators=(',',':')).replace('<','\\u003c')
    heading=html.escape(plan['title'])
    banner='''<style>.prepared-header{margin:0 auto 12px;padding:16px 20px;max-width:1500px;border:1px solid #b9b9b9;background:#fff;color:#202020;font:14px/1.5 Arial,Helvetica,sans-serif}.prepared-header h1{font-size:20px;line-height:1.25;margin:0 0 8px}.prepared-header p{margin:8px 0}.prepared-header button{font:inherit;min-height:42px;background:#fff;color:#202020;border:1px solid #888;padding:8px 12px;cursor:pointer}.prepared-header button:focus-visible{outline:3px solid #555;outline-offset:2px}.prepared-header button:disabled{color:#555;background:#eee;cursor:wait}.prepared-header summary{cursor:pointer}.prepared-header code{overflow-wrap:anywhere;font-size:11px}.prepared-header details{margin-top:10px}@media(max-width:650px){.prepared-header{margin:0;border:0;border-bottom:1px solid #999;padding:16px 18px}}@media print{.prepared-header{display:none}}</style><header class="prepared-header"><h1>Prepared editable field plan</h1><p>'''+heading+'''</p><p id="prepared-status" role="status">Opening the original saved laboratory plan.</p><details><summary>Original edition and reopening</summary><p>This file contains the complete original field editor and the saved laboratory plan, including all source pointers and original observations. Browser edits remain separate from the native project until you import your exported JSON there. Existing browser copies are continued automatically.</p><p><button id="prepared-original" type="button">Open original saved edition</button></p><p>Native plan: <code>'''+html.escape(plan['id'])+'''</code><br>Revision: '''+str(plan['revision'])+'''<br>Original plan digest: <code>'''+document_digest(plan)+'''</code></p></details></header>'''
    navigation='<nav class="prepared-nav" aria-label="Prepared plan shortcuts"><button type="button" data-prepared-tab="field" data-prepared-section="results">Laboratory results</button><button type="button" data-prepared-tab="field" data-prepared-section="visits">Field visits</button><button type="button" data-prepared-tab="sites">Sites</button><button type="button" data-prepared-tab="handover">Handover</button></nav>'
    navigation_style='<style>.prepared-nav{position:sticky;top:0;z-index:5;display:grid;grid-template-columns:repeat(4,1fr);gap:6px;padding:8px 12px;border:1px solid #b9b9b9;background:#fff;color:#202020}.prepared-nav button{min-height:42px;background:#fff;color:#202020;border:1px solid #888;font:14px/1.3 Arial,sans-serif;padding:7px 10px;cursor:pointer}.prepared-nav button[aria-current=true]{background:#252525;color:#fff}.prepared-nav button:focus-visible{outline:3px solid #555;outline-offset:2px}.iw-body,.iw-body h3,.iw-body section{scroll-margin-top:85px}.iw-table-wrap table{min-width:850px}.iw-table-wrap td{min-width:100px}.iw-table-wrap:focus-visible{outline:3px solid #555;outline-offset:2px}@media(max-width:650px){.prepared-nav{gap:4px;padding:7px 6px}.prepared-nav button{font-size:12px;padding:6px 3px}}@media print{.prepared-nav{display:none}.iw-table-wrap table{min-width:0}.iw-table-wrap td{min-width:0}}</style>'
    source=source.replace('<body>','<body>'+banner+navigation_style+navigation,1)
    addon='<script id="prepared-plan" type="application/json">'+payload+'</script><script>'+BOOTSTRAP+'</script>'
    before,closing,after=source.rpartition('</body>')
    source=before+addon+closing+after
    title='<title>'+html.escape(plan['title'])+' | Prepared field editor</title>'
    import re
    source=re.sub(r'<title>.*?</title>',lambda _:title,source,count=1,flags=re.S)
    path=output/'Eighteenmile_Editable_Field_Plan.html';path.write_text(source,encoding='utf-8')
    (output/'original-plan.json').write_bytes(plan_bytes)
    (output/'prepare_field_editor.py').write_bytes(Path(__file__).read_bytes())
    result={'schema':'upstate.prepared-field-editor/v1','original_editor':{'path':'operator/web/implementation_workbench.html','bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()},'plan_id':plan['id'],'revision':plan['revision'],'plan_digest':document_digest(plan),'observations':len(plan['observations']),'visits':len(plan['visits']),'files':{p.name:{'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in output.iterdir() if p.is_file()}}
    (output/'prepared-editor.json').write_text(json.dumps(result,indent=2)+'\n')
    return result

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--application',type=Path,required=True)
    parser.add_argument('--plan',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    print(json.dumps(build(args.application,args.plan,args.output),indent=2))
