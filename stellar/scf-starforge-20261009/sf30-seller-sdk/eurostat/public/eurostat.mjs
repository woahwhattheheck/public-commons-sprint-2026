// MIT. Industrial Eurostat source console beside the original publisher workflow.
const el=(tag,text,props={})=>Object.assign(document.createElement(tag),{...(text===undefined?{}:{textContent:text}),...props});
const root=el('section',undefined,{className:'panel eurostat-panel'});document.querySelector('main').prepend(root);
const title=el('h2','Eurostat economic editions'),note=el('p','Select an original source, review its dimensions and reuse terms, then publish its complete retained rows.');
root.append(title,note);
const status=el('p','Loading saved source…',{className:'eurostat-status',role:'status'});root.append(status);
let saved,selectedId=null,capture=null,offset=0,lastTemplate=null,busy=false;
const api=async(path,data)=>{
  const response=await fetch('/api/eurostat/'+path,data===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});
  const value=await response.json();if(!response.ok)throw Error((value.error??'REQUEST_FAILED')+': '+(value.message??''));return value;
};
const action=fn=>async event=>{event?.preventDefault();if(busy)return;busy=true;status.textContent='Working on the saved project…';
  try{await fn();}catch(e){status.textContent=e.message;}finally{busy=false;}};
const field=(label,input)=>{const wrapper=el('label',label);wrapper.append(input);return wrapper;};
const input=(value='',props={})=>el('input',undefined,{value,...props});
const button=(label,handler)=>{const b=el('button',label,{type:'button'});b.addEventListener('click',action(handler));return b;};
const form=(summary)=>{const d=el('details'),s=el('summary',summary),f=el('form');d.append(s,f);root.append(d);return f;};
const acquisition=form('Acquire an official Eurostat source');
const url=input('https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/une_rt_m?lang=EN&freq=M&age=TOTAL&age=Y_LT25&unit=PC_ACT&s_adj=SA&sex=T&sex=M&sex=F&geo=DE&geo=ES&geo=FR&geo=IT&sinceTimePeriod=2024-01&untilTimePeriod=2025-12',{required:true,type:'url'});
const operation=input('',{required:true,placeholder:'eurostat-unemployment-20261012'});
const continuing=input('',{type:'checkbox'});
acquisition.append(field('Direct Statistics API URL',url),field('Acquisition operation ID',operation),field('Continue this same retained acquisition',continuing),
  el('p','Each action performs one public GET. An asynchronous response is retained; use the same operation ID and continuation after Eurostat prepares it.'));
const acquireButton=el('button','Acquire and retain source',{type:'submit'});acquisition.append(acquireButton);
acquisition.addEventListener('submit',action(async()=>{const r=await api('acquire',{id:operation.value,sourceUrl:url.value,continueExisting:continuing.checked});
  status.textContent='Acquisition '+r.state;await refresh(false);}));
const importing=form('Import a complete original response or source handover');
const file=input('',{type:'file',accept:'.json,application/json'}),sourceUrl=input(url.value,{type:'url'}),retrieved=input(new Date().toISOString());
importing.append(field('Original JSON response or exported source handover',file),field('Original source URL',sourceUrl),field('Actual retrieval timestamp',retrieved),
  el('p','The saved file retains the complete input text. The source URL and retrieval time describe its actual acquisition.'));
const importButton=el('button','Import source',{type:'submit'});importing.append(importButton);
importing.addEventListener('submit',action(async()=>{if(!file.files[0])throw Error('Choose the complete source file.');if(file.files[0].size>50331648)throw Error('Browser import maximum: 48 MiB. Use the installed CLI for a larger source handover.');
  const responseText=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(await file.files[0].arrayBuffer());let wrapper;try{wrapper=JSON.parse(responseText);}catch{}
  if(wrapper?.schema==='stellar-forge.eurostat-source-handover.v1')await api('handover',wrapper);
  else await api('import',{responseText,sourceUrl:sourceUrl.value,retrievedAt:retrieved.value,transport:{kind:'operator-retained-original',httpStatus:null}});
  await refresh();}));
const selectionBar=el('div',undefined,{className:'eurostat-actions'}),select=el('select'),refreshButton=button('Refresh source',()=>refresh());
selectionBar.append(field('Retained edition',select),refreshButton);root.append(selectionBar);
select.addEventListener('change',action(()=>showCapture(select.value)));
const summary=el('p'),dimensions=el('div',undefined,{className:'eurostat-dimensions'}),table=el('div',undefined,{className:'table-wrap'});
const pagination=el('div',undefined,{className:'eurostat-actions'});root.append(summary,dimensions);
const sourceLink=el('a','Download complete original response',{download:'eurostat-original-response.json'});root.append(sourceLink);
root.append(button('Preview selected cells',async()=>{offset=0;await preview();}),table,pagination);
const metadata=el('details'),metadataText=el('pre');metadata.append(el('summary','Original publisher metadata and retrieval record'),metadataText);root.append(metadata);
const review=form('Review reuse and save a source selection');
const queryName=input('unemployment',{required:true,pattern:'[a-z][a-z0-9_-]{0,63}'}),reviewer=input('',{required:true,maxLength:128});
const reviewNote=el('textarea',undefined,{required:true,rows:3}),rights=el('textarea',undefined,{required:true,rows:4});
rights.value='Eurostat statistical data reuse policy, checked for this selected ESTAT unemployment dataset. Selected DE, ES, FR and IT are EU countries; this selection is outside the listed trade exceptions. Retain source acknowledgement and the adaptation notice.';
const attribution=el('textarea',undefined,{required:true,rows:3}),use=el('select');
use.append(el('option','Commercial',{value:'commercial'}),el('option','Noncommercial',{value:'noncommercial'}));
const includeMissing=input('',{type:'checkbox',checked:true});
review.append(field('Saved query name',queryName),field('Reviewer',reviewer),field('Review note',reviewNote),field('Use',use),
  field('Source-specific reuse basis',rights),field('Attribution',attribution),field('Keep missing cells with their original state',includeMissing),
  el('p','Check the actual publisher, geographies and dataset-specific conditions. Every source edition retains this review.'));
const saveQueryButton=el('button','Save reviewed selection',{type:'submit'});review.append(saveQueryButton);
review.addEventListener('submit',action(async()=>{
  if(!capture)throw Error('Select a retained edition first.');
  const chosen=selection(),geo=capture.cube.dimensions.find(d=>d.id.toLowerCase()==='geo');
  const q={captureId:selectedId,selection:chosen,includeMissing:includeMissing.checked,review:{reviewer:reviewer.value,note:reviewNote.value,
    use:use.value,rightsBasis:rights.value,attribution:attribution.value,geographies:geo?chosen[geo.id]:[]}};
  await api('query',{name:queryName.value,query:q,expectedHash:saved.source.hash});await refresh(false);
  status.textContent='Source selection saved. Create its full extraction plan below.';
}));
const planBar=el('div',undefined,{className:'eurostat-actions'}),querySelect=el('select'),planTitle=input('Eurostat unemployment — reviewed edition');
planBar.append(field('Reviewed source query',querySelect),field('Publication plan name',planTitle),button('Create full extraction plan',async()=>{
  lastTemplate=await api('plan-template',{query:querySelect.value,title:planTitle.value,name:planTitle.value});
  const response=await fetch('/api/plans',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(lastTemplate)});
  const result=await response.json();if(!response.ok)throw Error(result.message??result.error);
  document.getElementById('refresh').click();status.textContent='Original publisher plan '+result.id+' saved. Select it below to extract, review and publish.';
}));root.append(planBar);
const comparisons=form('Compare original editions');
const before=el('select'),after=el('select'),comparison=el('pre');
comparisons.append(field('Before edition',before),field('After edition',after),button('Compare coordinates and source fields',async()=>{
  comparison.textContent=JSON.stringify(await api('compare?'+new URLSearchParams({before:before.value,after:after.value,offset:0,limit:1000})),null,2);
}),comparison);
root.append(button('Download economic briefing HTML',async()=>{
  if(!selectedId)throw Error('Select the original source first.');
  const q=new URLSearchParams({id:selectedId,format:'html'});
  if(querySelect.value&&saved.source.config.queries[querySelect.value]?.captureId===selectedId)q.set('query',querySelect.value);
  const response=await fetch('/api/eurostat/briefing?'+q);if(!response.ok)throw Error('Briefing source is unavailable.');
  const text=await response.text(),href=URL.createObjectURL(new Blob([text],{type:'text/html'})),a=el('a',undefined,{href,download:'briefing.html'});a.click();setTimeout(()=>URL.revokeObjectURL(href),1000);
  status.textContent='Complete source briefing downloaded.';
}));
root.append(button('Download complete source handover',async()=>{
  const content=JSON.stringify(await api('handover'),null,2)+'\n';download(content,'eurostat-source-handover.json');
  status.textContent='Complete original responses and reviewed selections exported.';
}));
const release=form('Prepare the published merchant edition');
const runId=input('',{placeholder:'Original published extraction UUID'}),output=input('',{placeholder:'/absolute/private/eurostat-release'}),
origin=input('',{placeholder:'https://existing-merchant.example'}),payment=el('textarea',undefined,{rows:6,placeholder:'Existing reviewed payment JSON'});
const releaseResult=el('pre');release.append(field('Published extraction',runId),field('New release package directory',output),
 field('Existing public merchant origin',origin),field('Original payment terms',payment),button('Prepare original SF82 release',async()=>{
  releaseResult.textContent=JSON.stringify(await api('release-prepare',{runId:runId.value,outputDirectory:output.value,
    origin:origin.value,payment:JSON.parse(payment.value)}),null,2);
}),el('p','The release carries the original source response, dimensions, selection, review, candidate, publication and seller binding.'),releaseResult);
function download(text,name){const href=URL.createObjectURL(new Blob([text],{type:'application/json'})),a=el('a',undefined,{href,download:name});a.click();setTimeout(()=>URL.revokeObjectURL(href),1000);}
function selection(){return Object.fromEntries([...dimensions.querySelectorAll('select')].filter(s=>s.options.length>0).map(s=>[s.dataset.dimension,[...s.selectedOptions].map(o=>o.value)]));}
async function showCapture(id){
  selectedId=id;const r=await api('capture?id='+encodeURIComponent(id));capture=r.capture;offset=0;dimensions.replaceChildren();
  const c=capture.cube;summary.textContent=c.label+' · '+c.state+' · '+c.numericCount+' values / '+c.cellCount+' declared cells · updated '+c.updated;
  for(const d of c.dimensions){const s=el('select',undefined,{multiple:true,size:Math.min(6,Math.max(2,d.categories.length))});s.dataset.dimension=d.id;
    for(const category of d.categories)s.append(el('option',category.code+' — '+category.label,{value:category.code,selected:true}));
    dimensions.append(field(d.id+' · '+d.label,s));}
  const countries=c.dimensions.find(d=>d.id.toLowerCase()==='geo')?.categories.map(x=>x.code)??[];
  if(c.datasetCode!=='UNE_RT_M'||c.source!=='ESTAT'||countries.some(code=>!['DE','ES','FR','IT'].includes(code)))rights.value='';
  sourceLink.href='/api/eurostat/response?id='+encodeURIComponent(id);metadataText.textContent=JSON.stringify(capture,null,2);
  attribution.value='Eurostat ('+c.datasetCode+'), '+c.label+'. '+capture.sourceUrl+'; accessed '+capture.retrievedAt+'.';
  await preview();
}
async function preview(){
  if(!capture)return;const r=await api('cells?'+new URLSearchParams({id:selectedId,selection:JSON.stringify(selection()),offset,limit:50,includeMissing:String(includeMissing.checked)}));
  table.replaceChildren();const t=el('table'),head=el('thead'),header=el('tr');
  const dims=capture.cube.id;for(const label of ['Cell',...dims,'Value','Value state','Status','Status state'])header.append(el('th',label));
  head.append(header);t.append(head);const body=el('tbody');
  for(const c of r.cells){const tr=el('tr');for(const v of [String(c.index),...dims.map(d=>c.dimensions[d]),c.value??'',c.valueState,c.status??'',c.statusState])tr.append(el('td',v));body.append(tr);}
  t.append(body);table.append(t);pagination.replaceChildren(el('span',r.total+' selected cells; page starts at '+r.offset));
  if(offset>0)pagination.append(button('Previous',async()=>{offset=Math.max(0,offset-50);await preview();}));
  if(r.next!==null)pagination.append(button('Next',async()=>{offset=r.next;await preview();}));
}
async function refresh(reset=true){
  saved=await api('status');const captures=Object.values(saved.source.captures);
  const old=selectedId;for(const target of [select,before,after]){target.replaceChildren();for(const c of captures)
    target.append(el('option',c.cube.label+' · '+c.retrievedAt+' · '+c.id.slice(0,10),{value:c.id}));}
  querySelect.replaceChildren();for(const name of Object.keys(saved.source.queries))querySelect.append(el('option',name,{value:name}));
  if(captures.length){selectedId=captures.some(c=>c.id===old)?old:captures.at(-1).id;select.value=selectedId;
    if(reset||!capture)await showCapture(selectedId);}
  status.textContent=captures.length+' retained original editions · '+Object.keys(saved.source.queries).length+' reviewed queries · '+saved.acquisitions.length+' acquisition operations';
}
document.querySelector('h1').textContent='Eurostat economic workspace';
document.querySelector('footer').textContent='Eurostat source editions · Original dataset publisher, version store, seller and buyer lifecycle';
const schedulePanel=document.getElementById('schedule-panel');
schedulePanel.querySelector('h2').textContent='Publish the reviewed retained source on a schedule';
schedulePanel.querySelector('p.muted').textContent='The original scheduler re-extracts the saved immutable source capture. Acquire and review a new original response, then save its new plan and publication policy to advance the economic edition.';
await action(()=>refresh())();
