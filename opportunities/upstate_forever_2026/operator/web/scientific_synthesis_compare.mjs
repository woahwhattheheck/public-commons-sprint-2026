import {COMPARISON_BYTES,createComparisonPackage,openComparisonPackage,comparisonText} from './scientific_synthesis_compare_core.mjs';
import {comparisonBody,buildComparisonReport} from './scientific_synthesis_compare_report.mjs';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const copy=v=>JSON.parse(JSON.stringify(v));
function download(name,text,type){const u=URL.createObjectURL(new Blob([text],{type})),a=document.createElement('a');a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),60000);}
export function attachSynthesisComparison(host){
 let panel=null,workspace=null,projectId=null,editions=[],active=false,serial=0,busy=false,error='',opened=null,beforeId='',afterId='';
 const valid=(ws,n)=>active&&workspace===ws&&host.getWorkspace()===ws&&serial===n;
 const available=id=>editions.some(r=>r.collection_id===id);
 function ensure(container){
  if(!panel){panel=document.createElement('section');panel.className='synthesis-comparison';panel.setAttribute('aria-label','Compare authored scientific editions');
   panel.addEventListener('click',e=>{const b=e.target.closest('[data-synthesis-compare-action]');if(!b||!panel.contains(b))return;e.preventDefault();e.stopPropagation();action(b.dataset.synthesisCompareAction).catch(reason=>{error=reason.message;render();});});
   panel.addEventListener('change',e=>{if(e.target.matches('[data-synthesis-compare-open]')){const file=e.target.files?.[0];e.target.value='';if(file)openFile(file);return;}if(busy)return;if(e.target.dataset.synthesisCompareSide==='before')beforeId=e.target.value;if(e.target.dataset.synthesisCompareSide==='after')afterId=e.target.value;});
  }
  if(panel.parentNode!==container)container.append(panel);panel.hidden=false;
  if(!document.querySelector('link[data-synthesis-comparison-style]')){const l=document.createElement('link');l.rel='stylesheet';l.href='/web/scientific_synthesis_compare.css';l.dataset.synthesisComparisonStyle='';document.head.append(l);}
 }
 function options(selected){
  return '<option value="">Choose a saved authored edition</option>'+
   (selected&&!available(selected)?'<option selected value="'+esc(selected)+'">Received edition · '+esc(selected)+'</option>':'')+
   editions.map(r=>'<option value="'+esc(r.collection_id)+'"'+(r.collection_id===selected?' selected':'')+'>'+esc(r.title)+' · revision '+esc(r.revision)+' · '+esc(r.series_id)+'</option>').join('');
 }
 function render(){
  if(!panel)return;
  panel.innerHTML='<h4>Compare authored editions</h4><p>Read both complete versions and their exact evidence changes. This view does not change your authored draft, references, pending request or scientific results.</p>'+
   '<div class="compare-controls"><label>Before<select data-synthesis-compare-side="before"'+(busy?' disabled':'')+'>'+options(beforeId)+'</select></label><label>After<select data-synthesis-compare-side="after"'+(busy?' disabled':'')+'>'+options(afterId)+'</select></label>'+
   '<button type="button" data-synthesis-compare-action="compare"'+(busy||!projectId?' disabled':'')+'>Compare selected editions</button>'+
   '<label>Open complete comparison JSON or HTML<input data-synthesis-compare-open type="file" accept=".json,.html,application/json,text/html"'+(busy?' disabled':'')+'></label></div>'+
   '<p class="compare-status" role="status">'+esc(error||(busy?'Reading the complete selected edition sources…':''))+'</p>'+
   '<p class="compare-note">Complete comparison files support 64 MiB of UTF-8 source. Opening a file is read-only; original Workspace validation remains authoritative. Full binary companions travel in the original source ZIPs.</p>'+
   (opened?'<div class="compare-controls"><button type="button" data-synthesis-compare-action="html"'+(busy?' disabled':'')+'>Download readable comparison HTML</button><button type="button" data-synthesis-compare-action="json"'+(busy?' disabled':'')+'>Download complete comparison JSON</button>'+
    '<button type="button" data-synthesis-compare-action="before-zip"'+(busy||!available(opened.before.collection_id)||!host.archiveEdition?' disabled':'')+'>Download before original source ZIP</button>'+
    '<button type="button" data-synthesis-compare-action="after-zip"'+(busy||!available(opened.after.collection_id)||!host.archiveEdition?' disabled':'')+'>Download after original source ZIP</button></div>'+
    '<p>Displayed complete sources: '+esc(opened.before.collection_id)+' → '+esc(opened.after.collection_id)+'. Downloads use these displayed editions.</p><div data-synthesis-comparison-result>'+comparisonBody(opened.package)+'</div>':'<p>No comparison opened. Choose two saved chapters or open a complete previously downloaded file.</p>');
 }
 async function run(work){
  if(busy)return;const ws=workspace,n=++serial;busy=true;error='';render();
  try{await work(ws,n);}catch(reason){if(valid(ws,n))error=reason.message||String(reason);}
  finally{if(valid(ws,n)){busy=false;render();}}
 }
 async function openFile(file){
  return run(async(ws,n)=>{
   if(file.size>COMPARISON_BYTES)throw Error('The complete comparison file exceeds 64 MiB.');
   const text=await file.text();if(!valid(ws,n))return;
   let value;
   if(/^\s*</.test(text)){
    const doc=new DOMParser().parseFromString(text,'text/html'),rows=doc.querySelectorAll('script#scientific-synthesis-comparison-data[type="application/json"]');
    if(rows.length!==1)throw Error('Choose the complete authored comparison HTML with its original embedded source.');
    value=JSON.parse(rows[0].textContent);
   }else value=JSON.parse(text);
   const result=await openComparisonPackage(value);if(!valid(ws,n))return;
   opened=result;beforeId=result.before.collection_id;afterId=result.after.collection_id;
  });
 }
 async function action(name){
  if(name==='json'){if(opened)download('scientific-synthesis-comparison.json',comparisonText(opened.package),'application/json');return;}
  return run(async(ws,n)=>{
   if(name==='compare'){
    if(!projectId||!available(beforeId)||!available(afterId))throw Error('Choose two actual saved authored editions in this Workspace.');
    const a=beforeId,b=afterId;
    const values=await Promise.all([host.readEdition(a),host.readEdition(b)]);if(!valid(ws,n))return;
    values.forEach((v,i)=>{if(v.workspace_key!==ws||v.collection_id!==[a,b][i]||v.project_id!==projectId)throw Error('The returned original authored edition belongs to another selection or Workspace.');});
    const pkg=await createComparisonPackage({before:values[0],after:values[1]});if(!valid(ws,n))return;
    const result=await openComparisonPackage(pkg);if(!valid(ws,n))return;opened=result;
   }else if(name==='html'){
    if(!opened)throw Error('Open a complete comparison first.');
    const html=await buildComparisonReport(opened.package);if(!valid(ws,n))return;
    download('scientific-synthesis-comparison.html',html,'text/html');
   }else if(name==='before-zip'||name==='after-zip'){
    const edition=opened?.[name==='before-zip'?'before':'after'];if(!edition||!available(edition.collection_id)||!host.archiveEdition)throw Error('Open the original registered source edition in this Workspace.');
    const result=await host.archiveEdition(edition.collection_id);if(!valid(ws,n))return;
    if(result.workspace_key!==ws||result.collection_id!==edition.collection_id||!result.source_ids?.includes(edition.source_id))throw Error('The complete source archive is bound to another edition.');
    const ticket=result.download;if(typeof ticket?.url!=='string'||typeof ticket.sha256!=='string'||!Number.isSafeInteger(ticket.bytes))throw Error('The original complete source download ticket is absent.');
    const url=new URL(ticket.url,location.href);if(url.origin!==location.origin)throw Error('The original source ticket is not on the active operator.');
    url.searchParams.set('download','1');const a=document.createElement('a');a.href=url.href;a.download=ticket.filename||'original-synthesis-source.zip';a.click();
    error='Original source ZIP ready: '+ticket.bytes+' bytes · SHA-256 '+ticket.sha256;
   }
  });
 }
 function mount(container,selection){
  const ws=selection.workspace,changed=workspace!==ws;
  if(changed){serial++;workspace=ws;projectId=null;opened=null;beforeId='';afterId='';busy=false;error='';}
  active=true;projectId=selection.projectId;editions=copy(selection.editions||[]);ensure(container);
  if(!beforeId&&!afterId&&editions.length>1){afterId=editions.at(-1).collection_id;beforeId=editions.at(-2).collection_id;}
  render();
 }
 function detach(){active=false;serial++;busy=false;if(panel)panel.hidden=true;}
 function reset(){detach();panel?.remove();panel=null;workspace=null;projectId=null;opened=null;editions=[];beforeId='';afterId='';}
 return {mount,detach,reset,selection:()=>({workspace,project_id:projectId,before:beforeId,after:afterId}),current:()=>opened?copy(opened.package):null};
}
