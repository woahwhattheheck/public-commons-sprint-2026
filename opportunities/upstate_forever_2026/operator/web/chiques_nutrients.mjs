/** Chiques original-source desk inside the existing Measurements operator. */
const el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=String(text);return n;};
const clone=v=>JSON.parse(JSON.stringify(v));
const json=v=>JSON.stringify(v,null,2)+'\n';
const readText=async f=>new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(await f.arrayBuffer());
const encode=bytes=>{let s='';for(let i=0;i<bytes.length;i+=16384)s+=String.fromCharCode(...bytes.subarray(i,i+16384));return btoa(s);};
export function mountChiquesNutrients({api,onImported=()=>{},initialState=null,onStateChange=()=>{}}){
 const root=el('section');root.className='mw-panel mwch';
 let state=initialState?clone(initialState):{sourcePacket:null,attachments:[],preparation:null,preview:null,pending:null,collectionId:null,dirty:false};
 let dead=false,busy=false,generation=0,page=0,collections=[],notice='',error=false,selectedRow=null;
 const emit=()=>{if(!dead)onStateChange(clone(state));};
 const active=t=>!dead&&generation===t;
 const notify=(message,bad=false)=>{notice=message;error=bad;};
 const download=(name,content,type='application/json')=>{const url=URL.createObjectURL(new Blob([typeof content==='string'?content:json(content)],{type}));const a=el('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);};
 const sourceSelection=()=>{
  if(state.sourcePacket)return {sourcePacket:clone(state.sourcePacket),attachments:clone(state.attachments)};
  if(!state.preparation)throw Error('Open the complete original source or saved preparation before adding companions.');
  const originals=state.preparation.collection.files.filter(f=>f.path.startsWith('originals/'));
  return {sourcePacket:{schema:'commons.eco.original-source-transfer.v1',sourceItem:'65b170a2d34e36a39044c04d',files:originals.filter(f=>f.text!==undefined).map(f=>({path:f.path.slice(10),content:f.text,bytes:new TextEncoder().encode(f.text).length,sha256:f.sha256}))},
   attachments:originals.filter(f=>f.base64!==undefined).map(f=>({name:f.path.slice(10),base64:f.base64,sha256:f.sha256}))};
 };
 async function act(fn){
  if(dead||busy)return;busy=true;const token=generation;render();
  try{await fn(token);}catch(e){if(active(token))notify(e.message||String(e),true);}
  finally{if(active(token)){busy=false;emit();render();}}
 }
 async function catalogue(token){const v=await api('/chiques/catalogue');if(active(token))collections=v.collections;}
 function button(label,fn,disabled=false){const b=el('button',label);b.type='button';b.disabled=busy||disabled;b.onclick=()=>act(fn);return b;}
 function locked(){return !!state.pending;}
 function resetPrepared(){state.preparation=null;state.preview=null;state.collectionId=null;state.dirty=true;page=0;selectedRow=null;emit();}
 function fileInput(label,multiple,onRead,accept){
  const box=el('label',label),input=el('input');input.type='file';input.multiple=multiple;input.accept=accept;input.disabled=busy||locked();
  input.onchange=()=>act(async token=>{const files=[...input.files];if(!files.length)return;await onRead(files,token);});box.append(input);return box;
 }
 async function preview(token){
  if(!state.sourcePacket&&!state.preparation)throw Error('Open the retained original-source JSON or a complete saved preparation.');
  const value=await api('/chiques/preview','POST',state.preparation?{preparation:state.preparation}:{sourcePacket:state.sourcePacket,attachments:state.attachments});
  if(!active(token))return;
  state.preparation=value.preparation;state.preview=value.preview;state.collectionId=null;state.dirty=true;page=0;selectedRow=null;
  notify('Complete source inspection prepared. Nothing has been imported. Scientific source decisions remain in Measurements.');
 }
 async function receive(token){
  if(!state.preparation||!state.preview)throw Error('Inspect the complete source before receiving it.');
  const pending=state.pending||{expectedId:state.preview.id,sourceIdentity:state.preparation.sourceIdentity};
  if(pending.expectedId!==state.preview.id||pending.sourceIdentity!==state.preparation.sourceIdentity)throw Error('The original pending source selection differs.');
  state.pending=clone(pending);state.dirty=true;emit();
  notify('Receiving the selected complete source through the existing collection writer.');
  const value=await api('/chiques/receive','POST',{preparation:state.preparation,expectedId:pending.expectedId});
  if(!active(token))return;
  if(value.id!==pending.expectedId||!value.complete||value.preparation.sourceIdentity!==pending.sourceIdentity)throw Error('The original receiving result has a different identity.');
  state.collectionId=value.id;state.pending=null;state.dirty=false;state.preparation=value.preparation;
  await catalogue(token);if(!active(token))return;
  notify('Original collection received. Every source cell and original file is retained; no scientific include decision or model was created.');
  emit();await onImported();
 }
 function render(){
  if(dead)return;const style=el('style','.mwch{min-width:0}.mwch label{display:grid;gap:6px;max-width:100%;font-weight:600}.mwch input,.mwch select{min-width:0;max-width:100%;box-sizing:border-box}.mwch .mw-buttons{flex-wrap:wrap}.mwch pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:32rem;overflow:auto;background:#f3f3f3;border:1px solid #c8c8c8;padding:12px}.mwch table{width:100%;min-width:680px;border-collapse:collapse}.mwch th,.mwch td{padding:10px;border:1px solid #ccc;text-align:left;vertical-align:top}.mwch th{background:#eee}.mwch p[data-error=true]{border-left:4px solid #444;padding-left:12px}.mwch :focus-visible{outline:3px solid #555;outline-offset:2px}');root.replaceChildren(style,el('h2','Chiques nutrient calibration sources'),el('p','Inspect the original TN, nitrate-plus-nitrite and phosphorus calibration cells before receiving them into this Measurements workspace. Published ln/log10 columns remain attached source values.'));
  const status=el('p',notice||'Open the complete retained Chiques source JSON. Original correction workbook and model summaries can be selected as companion originals.');status.setAttribute('role','status');status.dataset.error=String(error);root.append(status);
  if(state.pending)root.append(el('p','The selected receive has an unconfirmed or interrupted outcome. Continue this same collection identity; the existing writer reuses exact imports. Download this complete working preparation before leaving.'));
  const controls=el('div');controls.className='mw-buttons';
  controls.append(
   fileInput('Original source transfer JSON',false,async(files,token)=>{
    if(state.dirty&&!window.confirm('Replace this unfinished source preparation? Download the complete working preparation first if it must be kept.'))return;
    const f=files[0];if(f.size>32*1024*1024)throw Error('The original JSON exceeds 32 MiB.');const parsed=JSON.parse(await readText(f));if(!active(token))return;
    state.sourcePacket=parsed;state.attachments=[];resetPrepared();notify('Original source selected. Inspect it to verify complete bytes and publisher identities.');
   },'.json,.txt,application/json,text/plain'),
   fileInput('Original correction workbook / model summaries',true,async(files,token)=>{
    let total=0;const selected=[];
    for(const f of files){total+=f.size;if(total>24*1024*1024)throw Error('Selected companion originals exceed 24 MiB.');const bytes=new Uint8Array(await f.arrayBuffer());if(!active(token))return;selected.push({name:f.name,bytes:bytes.length,base64:encode(bytes)});}
    const old=sourceSelection(),joined=new Map(old.attachments.map(f=>[f.name,f]));
    for(const f of selected){
     const text=old.sourcePacket.files.find(x=>x.path===f.name);
     if(text){const incoming=Uint8Array.from(atob(f.base64),c=>c.charCodeAt(0));if(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(incoming)!==text.content)throw Error('A retained original with this filename has different bytes: '+f.name);continue;}
     const prior=joined.get(f.name);if(prior&&prior.base64!==f.base64)throw Error('A retained companion with this filename has different bytes: '+f.name);joined.set(f.name,prior||f);
    }
    state.sourcePacket=old.sourcePacket;state.attachments=[...joined.values()];resetPrepared();notify('Complete companion originals joined with the retained source selection. No correction is applied; inspect the complete source.');
   },'.xlsx,.html,.htm'),
   fileInput('Reopen complete source preparation JSON',false,async(files,token)=>{
    if(state.dirty&&!window.confirm('Replace this unfinished source preparation? Download the complete working preparation first if it must be kept.'))return;
    const f=files[0];if(f.size>96*1024*1024)throw Error('Complete preparation exceeds 96 MiB.');const opened=JSON.parse(await readText(f));if(!active(token))return;
    const candidate=opened.schema==='upstate.chiques-nutrient-working/v1'?opened.preparation:opened;
    const value=await api('/chiques/preview','POST',candidate?{preparation:candidate}:{sourcePacket:opened.sourcePacket,attachments:opened.attachments||[]});if(!active(token))return;
    if(opened.pending&&(opened.pending.expectedId!==value.preview.id||opened.pending.sourceIdentity!==value.preparation.sourceIdentity))throw Error('Saved pending selection differs from the original source.');
    state={sourcePacket:null,attachments:[],preparation:value.preparation,preview:value.preview,pending:opened.pending||null,collectionId:null,dirty:true};
    page=0;selectedRow=null;notify('Complete source preparation reopened and checked by the original parser. Native work has not been repeated.');
   },'.json,.txt,application/json,text/plain')
  );root.append(controls);
  const buttons=el('div');buttons.className='mw-buttons';
  buttons.append(button('Inspect complete sources',preview,locked()||!state.sourcePacket&&!state.preparation),
   button(state.pending?'Continue original collection receiving':'Receive reviewed source collection',receive,!state.preparation||!state.preview||!!state.collectionId),
   button('Download complete working preparation',()=>{download('Chiques_Nutrient_Source_Preparation.json',{schema:'upstate.chiques-nutrient-working/v1',sourcePacket:state.sourcePacket,attachments:state.attachments,preparation:state.preparation,pending:state.pending});notify('Complete preparation prepared for download. Reopen the actual saved file to verify it.');},!state.preparation&&!state.sourcePacket),
   button('Refresh retained nutrient collections',catalogue));root.append(buttons);
  const retained=el('label','Retained original nutrient collection'),select=el('select');select.disabled=busy||locked();
  const blank=el('option','Select a retained collection');blank.value='';select.append(blank);
  for(const c of collections){const option=el('option',c.title+' · '+c.id.slice(0,12)+(c.complete?'':' · receiving incomplete'));option.value=c.id;select.append(option);}
  select.value=state.collectionId||'';
  select.onchange=()=>act(async token=>{
   if(!select.value)return;
   if(state.dirty&&!window.confirm('Open this retained collection? Download your current complete preparation first if it must be kept.'))return;
   const value=await api('/chiques/collections/'+encodeURIComponent(select.value));if(!active(token))return;
   const preview=await api('/chiques/preview','POST',{preparation:value.preparation});if(!active(token))return;
   state={sourcePacket:null,attachments:[],preparation:value.preparation,preview:preview.preview,pending:value.complete?null:{expectedId:value.id,sourceIdentity:value.preparation.sourceIdentity},collectionId:value.complete?value.id:null,dirty:!value.complete};page=0;selectedRow=null;
   notify(value.complete?'Retained exact original source and native record bindings reopened.':'Original interrupted collection selection reopened. Continue its exact receiving.');
  });retained.append(select);root.append(retained);
  if(!state.preparation)return;
  const r=state.preparation.report;
  root.append(el('p',r.metadata.support),el('p',r.metadata.time),el('p',r.metadata.fractions),el('p','Corrections workbook: '+r.corrections.status+'. Original model summaries not selected: '+r.assessment.missingPublisherFiles.filter(x=>x.endsWith('.html')).join(', ')));
  const details=el('details');details.append(el('summary','Full source identities, coverage and interpretation'),el('pre',json({sourceIdentity:r.sourceIdentity,reportSha256:r.sha256,files:r.files,publisherInventory:r.publisherInventory,metadata:r.metadata,assessment:r.assessment})));root.append(details);
  const products=el('div');products.className='mw-buttons';
  for(const [name,label,type] of [['nutrient-source-review.json','Download full source review JSON','application/json'],['nutrient-source-diagnostics.csv','Download all source diagnostics CSV','text/csv'],['nutrient-source-review.html','Download readable source review HTML','text/html']]){
   products.append(button(label,()=>{const f=state.preparation.collection.files.find(f=>f.path===name);download(name,f.text,type);notify('Complete source review prepared. For original-file links, use the full collection ZIP below.');}));
  }
  products.append(button('Publish and download full editable collection',async token=>{
   const id=state.collectionId;if(!id)throw Error('Receive this original collection first.');
   const edition=await api('/collections/'+id+'/publish','POST',{});if(!active(token)||state.collectionId!==id)return;
   const bundle=await api('/collections/'+id+'/editions/'+edition.id+'/bundle');if(!active(token)||state.collectionId!==id)return;
   const bytes=Uint8Array.from(atob(bundle.base64),c=>c.charCodeAt(0));if(bytes.length!==bundle.bytes)throw Error('Complete ZIP length differs');
   const actual=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');if(actual!==bundle.sha256)throw Error('Complete ZIP identity differs');if(!active(token)||state.collectionId!==id)return;
   const url=URL.createObjectURL(new Blob([bytes],{type:bundle.type})),a=el('a');a.href=url;a.download=bundle.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
   notify('Complete original collection, source reports and editable project prepared for download. Reopen the saved ZIP and receive its project/collection with the original commands.');
  },!state.collectionId));root.append(products);
  const all=r.tables.flatMap(t=>t.rows.map(row=>({...row,kind:t.kind}))),size=20,pages=Math.max(1,Math.ceil(all.length/size));page=Math.min(page,pages-1);
  const paging=el('div');paging.className='mw-buttons';
  paging.append(button('Previous original rows',()=>{page=Math.max(0,page-1);},page===0),el('span','Rows '+(page*size+1)+'–'+Math.min(all.length,(page+1)*size)+' of '+all.length),button('Next original rows',()=>{page=Math.min(pages-1,page+1);},page>=pages-1));root.append(paging);
  const table=el('table'),head=el('tr');for(const name of ['Original table / row','Sample / sensor UTC','Exact original values','Full source fields'])head.append(el('th',name));const thead=el('thead');thead.append(head);table.append(thead);const tbody=el('tbody');
  for(const row of all.slice(page*size,(page+1)*size)){
   const tr=el('tr');tr.append(el('td',row.kind.toUpperCase()+' / line'+row.line),el('td',row.sampleAt+'\n'+row.sensorAt));
   const value=el('td');for(const v of row.values)value.append(el('p',v.column+': '+(v.sourceValue===''?'[empty]':v.sourceValue)+' '+v.unit+' · '+v.clock+' · '+v.transformColumn+' '+v.status));tr.append(value);
   const cell=el('td');cell.append(button('Open full original row',()=>{selectedRow=row;}));tr.append(cell);tbody.append(tr);
  }table.append(tbody);const scroll=el('div');scroll.className='mw-scroll';scroll.style.overflow='auto';scroll.append(table);root.append(scroll);
  if(selectedRow){const full=el('details');full.open=true;full.append(el('summary','Complete original '+selectedRow.kind.toUpperCase()+' row '+selectedRow.line),el('pre',json(selectedRow)));root.append(full);}
 }
 function snapshot(){return clone(state);}
 const beforeUnload=e=>{if(state.dirty||state.pending||busy){e.preventDefault();e.returnValue='';}};
 window.addEventListener('beforeunload',beforeUnload);
 render();act(catalogue);
 return {element:root,snapshot,hasUnsaved:()=>state.dirty||!!state.pending||busy,prepareLeave:async()=>{if(busy)throw Error('Allow the selected nutrient source operation to finish before leaving.');emit();},
  destroy(){if(dead)return;onStateChange(snapshot());dead=true;generation++;window.removeEventListener('beforeunload',beforeUnload);root.remove();}};
}
