import * as Engine from './engine.mjs';
import * as Portable from './portable.mjs';
import {sha256Utf8,sha256Bytes} from './sha256.mjs';

const $=id=>document.getElementById(id);
const boot=JSON.parse($('tourism-boot').textContent);
const copy=value=>JSON.parse(JSON.stringify(value));
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const uid=prefix=>prefix+'-'+crypto.randomUUID();
const stamp=()=>new Date().toISOString();
const literalValues=new WeakMap();
const S={db:null,copyId:null,workspace:null,state:null,section:'workspace',registryId:null,sourceIds:[],sourceId:null,rowId:null,page:0,planId:null,returnedId:null,templateId:null,busy:false,drafts:{},draftQueue:Promise.resolve(),actor:'',conflict:null,storageError:null};
let tabId;try{tabId=sessionStorage.getItem('tourism-series-tab');if(!tabId){tabId=uid('tab');sessionStorage.setItem('tourism-series-tab',tabId);}S.actor=sessionStorage.getItem('tourism-series-actor')||'';}catch{tabId=uid('tab');}
async function claimTabIdentity(){
  const fresh=()=>{tabId=uid('tab');try{sessionStorage.setItem('tourism-series-tab',tabId);}catch{}};
  if(!navigator.locks?.request){fresh();return;}
  await new Promise(resolve=>{
    navigator.locks.request('tourism-series-tab-'+tabId,{ifAvailable:true},lock=>{
      if(!lock){fresh();resolve();return;}
      resolve();return new Promise(()=>{});
    }).catch(()=>{fresh();resolve();});
  });
}
const channel=typeof BroadcastChannel==='function'?new BroadcastChannel('tourism-series-workspace'):null;
function el(tag,props={},...children){const node=document.createElement(tag);for(const [k,v]of Object.entries(props)){if(k==='class')node.className=v;else if(k==='text')node.textContent=v;else if(k==='on')for(const [name,fn]of Object.entries(v))node.addEventListener(name,fn);else if(k==='dataset')Object.assign(node.dataset,v);else if(k in node&&k!=='form'){node[k]=v;if(k==='value'&&['input','textarea'].includes(tag))literalValues.set(node,String(v));}else node.setAttribute(k,v);}for(const child of children.flat(Infinity))if(child!==null&&child!==undefined)node.append(child instanceof Node?child:document.createTextNode(String(child)));return node;}
function say(message,error=false){$('notice').textContent=message;$('notice').dataset.error=String(error);}
function buttons(){document.querySelectorAll('button,input,select,textarea').forEach(n=>{if(S.busy){if(!n.hasAttribute('data-was-disabled'))n.dataset.wasDisabled=n.disabled?'1':'0';n.disabled=true;}else if(n.hasAttribute('data-was-disabled')){n.disabled=n.dataset.wasDisabled==='1';delete n.dataset.wasDisabled;}});}
async function act(fn){if(S.busy)return;S.busy=true;buttons();try{await fn();}catch(e){say((e.code?e.code+': ':'')+e.message,true);}finally{S.busy=false;buttons();}}
function button(label,fn,props={}){return el('button',{type:'button',...props,on:{click:()=>act(fn)}},label);}
function download(name,content,type='application/octet-stream'){const url=URL.createObjectURL(new Blob([content],{type}));const a=el('a',{href:url,download:name});document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}
function summary(title,content){return el('details',{},el('summary',{},title),el('div',{},content));}
function jsonDetails(title,value){return summary(title,el('pre',{},Portable.json(value)));}
function table(heads,rows){return el('div',{class:'table'},el('table',{},el('thead',{},el('tr',{},heads.map(h=>el('th',{},h)))),el('tbody',{},rows.map(row=>el('tr',{},row.map(v=>el('td',{},v)))))));}
function card(title,...children){return el('section',{},el('h2',{},title),children);}
function badge(text){return el('span',{class:'status'},text.replaceAll('_',' '));}
function paragraph(text,cls=''){return el('p',{class:cls},text);}
function textInput(name,label,value='',props={}){return el('label',{class:'field'},el('span',{},label),el('input',{name,value,...props}));}
function textArea(name,label,value='',props={}){return el('label',{class:'field'},el('span',{},label),el('textarea',{name,value,...props}));}
function select(name,label,options,value=''){const n=el('select',{name},options.map(o=>el('option',{value:Array.isArray(o)?o[0]:o},Array.isArray(o)?o[1]:o)));if(value!==''&&!Array.from(n.options).some(o=>o.value===String(value)))n.append(el('option',{value},'Retained value: '+value));n.value=value;return el('label',{class:'field'},el('span',{},label),n);}
function check(name,label,checked=false){return el('label',{class:'check'},el('input',{name,type:'checkbox',checked}),el('span',{},label));}
function chosen(data,prefix){return Object.keys(data).filter(k=>k.startsWith(prefix+':')&&data[k]===true).map(k=>k.slice(prefix.length+1));}
function plainValues(form){const fields={};for(const n of form.elements)if(n.name&&n.type!=='file'&&!['submit','button'].includes(n.type))fields[n.name]=n.type==='checkbox'?n.checked:literalValues.has(n)?literalValues.get(n):n.value;return fields;}
function editedValue(event){const n=event.target;if(n&&['INPUT','TEXTAREA'].includes(n.tagName)&&n.type!=='file'&&n.type!=='checkbox')literalValues.set(n,n.value);}
function hydrate(form,fields){for(const n of form.elements)if(n.name&&own(fields,n.name)&&n.type!=='file'){if(n.type==='checkbox')n.checked=fields[n.name]===true;else{if(n.tagName==='SELECT'&&!Array.from(n.options).some(o=>o.value===String(fields[n.name])))n.append(el('option',{value:fields[n.name]},'Retained value: '+fields[n.name]));n.value=fields[n.name];if(['INPUT','TEXTAREA'].includes(n.tagName))literalValues.set(n,String(fields[n.name]));}}}
function request(tx,store,key){return new Promise((resolve,reject)=>{const r=tx.objectStore(store).get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
function transaction(stores,fn){return new Promise((resolve,reject)=>{const tx=S.db.transaction(stores,'readwrite');let result;tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error||Error('The local save failed.'));tx.onabort=()=>reject(tx.error||Error('The local save was aborted.'));try{fn(tx,value=>{result=value;});}catch(e){tx.abort();reject(e);}});}
async function openDB(){return new Promise((resolve,reject)=>{const r=indexedDB.open('tourism-series-workspace-v1',1);r.onupgradeneeded=()=>{for(const name of ['copies','drafts','branches'])r.result.createObjectStore(name,{keyPath:'key'});};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.onblocked=()=>reject(Error('Close the older workspace tab to open the local database.'));});}
async function all(store){return new Promise((resolve,reject)=>{const tx=S.db.transaction(store),r=tx.objectStore(store).getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
function draftKey(name){return S.copyId+'|'+tabId+'|'+name;}
function retainDraft(name,row){S.drafts[name]=row;const key=draftKey(name),copyId=S.copyId;S.draftQueue=S.draftQueue.then(()=>transaction(['drafts'],tx=>tx.objectStore('drafts').put({key,copyId,tabId,name,...copy(row)}))).then(()=>{S.storageError=null;}).catch(e=>{S.storageError=e; say('The unfinished text remains visible, but browser storage failed. Download working HTML or recovery JSON now. '+e.message,true);});return S.draftQueue;}
function captureDraft(form,name){const old=S.drafts[name];const row={fields:plainValues(form),baseHead:old?.baseHead||Portable.head(S.workspace),baseRevision:old?.baseRevision??S.workspace.revision,token:uid('draft'),updatedAt:stamp()};retainDraft(name,row);return row;}
function form(name,title,fields,prepare,options={}){
  const form=el('form',{dataset:{action:name},noValidate:true});const box=el('fieldset');const saved=S.drafts[name];const flag=el('p',{class:'muted'});
  box.append(el('h3',{},title),fields);
  const updateFlag=()=>{const d=S.drafts[name];flag.textContent=d?'Unfinished values retained from revision '+d.baseRevision+(d.baseHead!==Portable.head(S.workspace)?'. Review these values against the current edition, then explicitly use them below.':'.'):'';};
  const adopt=button('Use these values for the current revision',async()=>{const row={fields:plainValues(form),baseHead:Portable.head(S.workspace),baseRevision:S.workspace.revision,token:uid('draft'),updatedAt:stamp()};await retainDraft(name,row);updateFlag();});
  adopt.hidden=!saved||saved.baseHead===Portable.head(S.workspace);
  box.append(flag,adopt,el('div',{class:'actions'},el('button',{type:'submit',class:'primary'},options.label||'Save'),button('Discard this unfinished form',async()=>{await S.draftQueue;await transaction(['drafts'],tx=>tx.objectStore('drafts').delete(draftKey(name)));delete S.drafts[name];render();})));
  form.append(box);if(saved)hydrate(form,saved.fields);updateFlag();
  form.addEventListener('input',event=>{editedValue(event);captureDraft(form,name);updateFlag();});
  form.addEventListener('change',event=>{editedValue(event);captureDraft(form,name);updateFlag();});
  form.addEventListener('submit',event=>{event.preventDefault();if(S.busy)return;
    const raw=plainValues(form),picked={};for(const n of form.elements)if(n.type==='file'&&n.name)picked[n.name]=Array.from(n.files);
    const draft=captureDraft(form,name),original=copy(S.workspace),originalKey=S.copyId;
    act(async()=>{if(!S.actor.trim())throw Error('Enter the actual operator name at the top before saving decisions.');
      if(draft.baseHead!==Portable.head(original))throw Error('This recovered form began on an earlier revision. Review it and use the explicit current-revision button before saving.');
      const actions=await prepare(copy(raw),picked);if(!Array.isArray(actions)||!actions.length)throw Error('Supply the complete operation.');
      let next=original;for(const item of actions){if(typeof Engine[item.action]!=='function')throw Error('Use an original maintained action.');next=Engine[item.action](next,{...item.input,operationId:uid('op'),expectedRevision:next.revision,at:stamp()}).workspace;}
      await commit(originalKey,original,next,name,draft.token);say('Saved '+actions.length+' operation'+(actions.length===1?'':'s')+' at revision '+next.revision+'.');render();
    });
  });return form;
}
async function commit(key,original,next,name,token){
  await S.draftQueue;if(S.storageError)throw S.storageError;
  const expected=Portable.head(original),entry={key,workspace:next,updatedAt:stamp(),title:next.title};
  const result=await transaction(['copies','drafts','branches'],(tx,done)=>{
    const r=tx.objectStore('copies').get(key);r.onsuccess=()=>{const current=r.result;
      if(!current||Portable.head(current.workspace)!==expected){
        const branch={key:uid('branch'),copyId:key,createdAt:stamp(),base:original,candidate:next,current:current?.workspace||null,drafts:copy(S.drafts),reason:'A different tab saved this local copy first.'};
        tx.objectStore('branches').put(branch);done({conflict:branch});return;
      }
      tx.objectStore('copies').put(entry);const d=tx.objectStore('drafts').get(draftKey(name));d.onsuccess=()=>{if(d.result?.token===token)tx.objectStore('drafts').delete(draftKey(name));};done({saved:true});
    };
  });
  if(result.conflict){S.conflict=result.conflict;showConflict();throw Error('Another tab saved first. Both complete branches and your unfinished values are retained below. Choose which local copy to continue.');}
  S.workspace=next;S.state=Engine.validateWorkspace(next);if(S.drafts[name]?.token===token)delete S.drafts[name];channel?.postMessage({copyId:key,head:Portable.head(next)});S.storageError=null;
}
async function saveCopy(record,label,preferredKey=null){Engine.validateWorkspace(record.workspace);const key=preferredKey||uid('copy');await transaction(['copies','drafts'],tx=>{tx.objectStore('copies').add({key,workspace:copy(record.workspace),updatedAt:stamp(),title:record.workspace.title,label});for(const [name,row]of Object.entries(record.drafts||{}))tx.objectStore('drafts').put({key:key+'|'+tabId+'|'+name,copyId:key,tabId,name,...copy(row)});});return key;}
async function useCopy(key){await S.draftQueue;const tx=S.db.transaction('copies'),row=await request(tx,'copies',key);if(!row)throw Error('Choose an existing saved local copy.');S.copyId=key;S.workspace=row.workspace;S.state=Engine.validateWorkspace(row.workspace);S.drafts={};for(const d of await all('drafts'))if(d.copyId===key&&d.tabId===tabId){const {key:k,copyId,tabId:t,name,...body}=d;S.drafts[name]=body;}S.conflict=null;normalizeSelection();try{sessionStorage.setItem('tourism-series-current',key);}catch{}render();}
async function restoreEmbeddedDrafts(drafts){
  for(const [name,row]of Object.entries(drafts||{})){
    const key=draftKey(name),copyId=S.copyId,importedTab='embedded-'+sha256Utf8(Portable.json(row)).sha256;
    const result=await transaction(['drafts'],(tx,done)=>{
      const r=tx.objectStore('drafts').get(key);
      r.onsuccess=()=>{
        if(!r.result){tx.objectStore('drafts').add({key,copyId,tabId,name,...copy(row)});done({row});}
        else if(JSON.stringify(r.result.fields)!==JSON.stringify(row.fields)||r.result.baseHead!==row.baseHead){
          tx.objectStore('drafts').put({key:copyId+'|'+importedTab+'|'+name,copyId,tabId:importedTab,name,...copy(row)});
          done({retainedSeparate:true});
        }else done({});
      };
    });
    if(result.row)S.drafts[name]=copy(row);
    if(result.retainedSeparate)say('A different local draft already exists. The embedded unfinished values remain separately recoverable under History & recovery.');
  }
}
async function currentRecord(){await S.draftQueue;return Portable.recovery(copy(S.workspace),copy(S.drafts),selectedContext(),S.copyId);}
function showConflict(){const node=$('conflicts');node.replaceChildren();if(!S.conflict)return;const c=S.conflict;node.append(el('h2',{},'Two complete versions are retained'),paragraph(c.reason),el('div',{class:'actions'},
  button('Download both versions and draft values',()=>download('Workspace_Conflict.json',Portable.json(c),'application/json')),
  button('Continue my version as a new copy',async()=>{const k=await saveCopy(Portable.recovery(c.candidate,c.drafts),'Recovered conflict branch');await useCopy(k);}),
  button('Open the saved version',async()=>{await useCopy(c.copyId);})));
}

function applySelection(value){for(const key of ['section','registryId','sourceIds','sourceId','rowId','page','planId','returnedId','templateId'])if(own(value,key))S[key]=copy(value[key]);}
function selectedContext(){return{section:S.section,registryId:S.registryId,sourceIds:S.sourceIds,sourceId:S.sourceId,rowId:S.rowId,page:S.page,planId:S.planId,returnedId:S.returnedId,templateId:S.templateId};}
function normalizeSelection(){const w=S.workspace;S.state=w;S.registryId=w.registries.find(r=>r.id===S.registryId)?.id||w.registries.at(-1)?.id||null;S.sourceId=w.sources.find(r=>r.id===S.sourceId)?.id||w.sources.find(r=>r.role==='source')?.id||null;S.sourceIds=S.sourceIds.filter(id=>w.sources.some(s=>s.id===id&&s.role==='source'));S.planId=w.targetPlans.find(r=>r.id===S.planId)?.id||w.targetPlans.at(-1)?.id||null;S.returnedId=w.sources.find(r=>r.id===S.returnedId&&r.role==='target')?.id||w.sources.find(r=>r.role==='target')?.id||null;}
function go(section){S.section=section;render();}
function registry(){return S.workspace.registries.find(r=>r.id===S.registryId);}
function projection(){return Engine.project(S.workspace,{registryId:S.registryId,sourceIds:S.sourceIds});}
function source(){return S.workspace.sources.find(s=>s.id===S.sourceId);}
function listenSelection(field,fn){field.querySelector('select').addEventListener('change',e=>act(()=>{fn(e.target.value);render();}));return field;}
function issueList(issues){return issues?.length?el('ul',{class:'issues'},issues.map(i=>el('li',{},el('strong',{},i.code||i.severity||'Finding'),' — '+i.message+(i.rowId?' ['+i.rowId+']':'')))):paragraph('No findings for this selection.');}
function sourceContext(){const w=S.workspace;const fields=el('div',{class:'inline-controls'},listenSelection(select('registrySelection','Registry edition',w.registries.map(r=>[r.id,r.id]),S.registryId),v=>{S.registryId=v;S.page=0;}));const sources=el('div',{},w.sources.filter(s=>s.role==='source').map(s=>{const n=check('context:'+s.id,s.filename+' ['+s.id+']',S.sourceIds.includes(s.id));n.querySelector('input').addEventListener('change',e=>act(()=>{if(e.target.checked)S.sourceIds.push(s.id);else S.sourceIds=S.sourceIds.filter(x=>x!==s.id);S.page=0;render();}));return n;}));return card('Current source selection',fields,summary('Select complete source series',sources),paragraph('Every saved analysis and target plan freezes this registry, source selection, mapping and correction history. Changing this view does not rewrite a saved report.','muted'));}
function readyContext(){if(!S.registryId||!S.sourceIds.length){$('main').append(card('Select original series first',paragraph('Retain the source files and CSV, define a registry, and save the actual column mapping.')));return false;}return true;}
function render(){
 $('identity').replaceChildren();$('navigation').replaceChildren();$('main').replaceChildren();
 if(!S.workspace){renderWelcome();buttons();return;}normalizeSelection();
 $('identity').dataset.copyId=S.copyId;const actor=textInput('actor','Actual operator',S.actor,{id:'operator-name'});actor.querySelector('input').addEventListener('input',e=>{S.actor=e.target.value;try{sessionStorage.setItem('tourism-series-actor',S.actor);}catch{}});
 $('identity').append(paragraph(S.workspace.title),el('strong',{id:'workspace-revision'},'Revision '+S.workspace.revision),actor);
 for(const [id,label]of [['workspace','Workspace & delivery'],['sources','Original files & CSV'],['registry','Registry editions'],['mapping','Column mapping'],['observations','Observations & corrections'],['analyses','Qualified calculations'],['reports','Frozen reports'],['target','Target CSV & returns'],['history','History & recovery']])$('navigation').append(button(label,()=>go(id),{'aria-current':S.section===id?'page':'false',dataset:{section:id}}));
 if(['mapping','observations','analyses','target'].includes(S.section))$('main').append(sourceContext());
 ({workspace:renderWorkspace,sources:renderSources,registry:renderRegistry,mapping:renderMapping,observations:renderObservations,analyses:renderAnalyses,reports:renderReports,target:renderTarget,history:renderHistory}[S.section]||renderWorkspace)();
 showConflict();buttons();
}
function openChooser(label,callback,accept='.json'){const input=el('input',{type:'file',accept});input.addEventListener('change',()=>{const file=input.files[0];if(file)act(async()=>{await callback(file);input.value='';});});return el('label',{class:'field'},el('span',{},label),input);}
async function openIncoming(file){if(file.size>128*1024*1024)throw Error('Open a complete recovery file within 128 MiB.');const record=Portable.parseRecovery(await file.text());const matches=(await all('copies')).filter(r=>r.workspace.id===record.workspace.id);const identical=matches.find(r=>Portable.head(r.workspace)===Portable.head(record.workspace));if(identical&&!Object.keys(record.drafts).length){await useCopy(identical.key);say('Opened the identical saved workspace.');return;}await useCopy(await saveCopy(record,'Imported '+file.name));applySelection(record.selection);normalizeSelection();render();say(matches.length?'Opened a separate local copy. Every existing saved edition remains available.':'Opened the whole workspace and unfinished values.');}
function renderWelcome(){
 $('identity').append(paragraph('No local workspace selected.'));
 const title=textInput('title','Workspace title','Tourism source review');const start=el('form',{id:'create-workspace'},title,el('button',{type:'submit',class:'primary'},'Create workspace'));
 start.addEventListener('submit',e=>{e.preventDefault();const value=title.querySelector('input').value;act(async()=>{await useCopy(await saveCopy(Portable.recovery(Engine.createWorkspace({id:uid('workspace'),title:value,createdAt:stamp()})),'Created locally'));});});
 $('main').append(card('Create or reopen a complete source workspace',paragraph('Keep the original observations, source editions and dimensions together. Build comparisons only from explicit compatible populations, units, periods and methods.'),start,openChooser('Open complete workspace or recovery JSON',openIncoming)));
 if(S.db)listCopies().catch(e=>say(e.message,true));
}
async function listCopies(){const host=el('div');$('main').append(host);const rows=await all('copies');host.append(card('Saved local copies',rows.length?table(['Title','Revision','Updated','Open'],rows.map(r=>[r.title,r.workspace.revision,r.updatedAt,button('Open',()=>useCopy(r.key))])):paragraph('No saved local copies.')));buttons();}
function renderWorkspace(){
 const w=S.workspace;
 $('main').append(card('Complete working source and delivery',table(['Original files','CSV sources','Registries','Analyses','Reports','Saved operations'],[[w.files.length,w.sources.length,w.registries.length,w.analyses.length,w.reports.length,w.revision]]),
 paragraph('Working HTML and recovery JSON retain this tab’s unfinished values. The complete ZIP contains all original bytes, source and target CSVs, attributed corrections, frozen reports, returns, the working application and complete application source.'),
 el('div',{class:'actions'},
 button('Download working HTML',async()=>download('Tourism_Series_Workspace.html',Portable.workingHTML(boot.source,await currentRecord()),'text/html'),{id:'top-working-html',class:'primary'}),
 button('Download recovery JSON',async()=>download('Working_Recovery.json',Portable.json(await currentRecord()),'application/json'),{id:'top-json'}),
 button('Download complete ZIP',async()=>download('Tourism_Series_Complete.zip',Portable.zipBytes(Portable.completeFiles(boot.source,await currentRecord())),'application/zip'),{id:'top-zip'}),
 button('Download saved workspace JSON',()=>download('workspace.json',Engine.exportWorkspace(w),'application/json'),{id:'top-workspace'}),
 button('Download raw unfinished values',()=>download('Unfinished_Values.json',Portable.json({workspaceId:w.id,head:Portable.head(w),drafts:S.drafts}),'application/json')),
 button('Download full application source',()=>download('Tourism_Series_Source.zip',Portable.zipBytes(Object.entries(boot.source).map(([path,content])=>({path:Portable.sourcePath(path),content}))),'application/zip'))),
 openChooser('Open another complete workspace or recovery JSON',openIncoming),
 button('Create another empty workspace',()=>{S.workspace=null;S.copyId=null;S.drafts={};render();})));
 $('main').append(card('How this record works',el('ol',{},['Retain original files and the complete CSV series, with source provenance.','Save a source registry covering actual geography, metrics, methods and declared relationships.','Map exact CSV columns or explicit literal constants, then inspect every source finding.','Select ordered observations and a permitted calculation. Preserve an observed discrepancy as a result.','Freeze complete reports, prepare an actual supplied target template and compare the real returned file.','Download the complete ZIP and reopen the working HTML or JSON independently.'].map(x=>el('li',{},x)))));
 listCopies().catch(e=>say(e.message,true));
}
function renderSources(){
 const w=S.workspace;
 $('main').append(card('Retain complete original source files',form('importFile','Original evidence and actual target templates',[
 textInput('id','Stable file ID',uid('file')),textInput('source_url','Original URL or source location'),textInput('publisher','Publisher'),
 textInput('published_at','Displayed publication date / edition (blank if unstated)'),textInput('retrieved_at','Actual retrieval timestamp',stamp()),select('representation','Representation',['original','authored_transcription','extracted_text'],'original'),textArea('note','Source and edition context'),
 el('label',{class:'field'},el('span',{},'Complete file, at most 32 MiB'),el('input',{type:'file',name:'file'})),
 paragraph('A file chooser cannot be recovered after reload. The complete bytes are retained after Save.','muted')
 ],async(d,p)=>{const file=p.file?.[0];if(!file)throw Error('Choose the complete source file.');if(file.size>Engine.metadata().limits.supportingBytes)throw Error('The original file exceeds 32 MiB.');return[{action:'importFile',input:{...d,filename:file.name,mime_type:file.type?.split(';')[0]||'application/octet-stream',content_base64:Portable.base64Encode(new Uint8Array(await file.arrayBuffer()))}}];},{label:'Retain original bytes'})));
 $('main').append(card('Retained original files',w.files.length?table(['Filename / stable ID','Representation / source','Bytes / SHA-256','Original'],w.files.map(f=>[f.filename+'\n'+f.id,f.representation+'\n'+f.publisher+'\n'+f.source_url,f.bytes+'\n'+f.sha256,button('Download original',()=>download(f.filename,Portable.base64Decode(f.content_base64),f.mime_type),{dataset:{fileId:f.id}})])):paragraph('No original evidence retained.')));
 $('main').append(card('Import complete observation or returned CSV',form('importCsv','Retain an original CSV',[
 textInput('id','Stable CSV source ID',uid('series')),select('role','File role',[['source','Original observation series'],['target','Actual returned target CSV']],'source'),
 el('label',{class:'field'},el('span',{},'Original UTF-8 comma-separated file'),el('input',{type:'file',name:'file',accept:'.csv,text/csv'})),paragraph('Headers, duplicate names, ragged records and literal cells remain unchanged. Canonical field mappings are a separate saved operation.','muted')
 ],async(d,p)=>{const file=p.file?.[0];if(!file)throw Error('Choose the complete CSV.');if(file.size>Engine.metadata().limits.csvBytes)throw Error('The CSV exceeds 32 MiB.');const bytes=new Uint8Array(await file.arrayBuffer()),text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);if(sha256Utf8(text).sha256!==sha256Bytes(bytes).sha256)throw Error('Use an exact UTF-8 CSV without conversion.');return[{action:'importCsv',input:{id:d.id,role:d.role,filename:file.name,text}}];},{label:'Retain complete CSV'})));
 $('main').append(card('CSV editions',w.sources.map(s=>summary(s.filename+' ['+s.id+'] — '+s.role,[
 paragraph(s.rows.length+' original rows; '+s.headers.length+' columns; '+s.bytes+' bytes.\nSHA-256 '+s.sha256),
 table(['Column position','Original header'],s.headers.map((h,i)=>[i,h])),
 button('Download exact original CSV',()=>download(s.filename,s.text,'text/csv')),
 button('Inspect / map this CSV',()=>{S.sourceId=s.id;go(s.role==='source'?'mapping':'target');}),
 jsonDetails('All source corrections',w.corrections.filter(c=>c.sourceId===s.id))
 ]))));
}
function registryExample(){const f=S.workspace.files[0]?.id||'ACTUAL_SOURCE_FILE_ID';return{id:uid('registry'),source_file_ids:[f],geographies:[{id:'actual-geography',name:'Replace with the actual source geography',scheme:'Actual boundary scheme',level:'Actual level',parent_id:null,source_file_id:f,source_locator:'Exact page / section',boundary_note:'Original boundary and overlap limitations'}],partitions:[],metrics:[{id:'actual-metric',name:'Exact metric',unit:'Exact original unit',currency:'',additive_dimensions:[],population:'Actual measured population',price_basis:'Actual price basis / not monetary',ratio_denominator_metric_ids:[],note:'Original definition and limitations'}],methods:[{id:'actual-method',name:'Exact method name',version:'Actual edition / explicitly unknown',source_file_id:f,source_locator:'Exact page / section',note:'Original method limitations'}],comparability:[],ratio_pairs:[],reconciliations:[]};}
function renderRegistry(){
 const w=S.workspace;
 const editor=textArea('registry','Complete source registry JSON',Portable.json(registryExample()),{class:'code',spellcheck:false});
 const frm=form('saveRegistry','Save an immutable registry edition',[
 paragraph('Select actual source facts. A new registry ID creates a successor edition. Old mappings, calculations and reports remain bound to their original registry.'),
 openChooser('Load a complete registry JSON into this unfinished form',async file=>{if(file.size>32*1024*1024)throw Error('Choose a registry within 32 MiB.');const value=JSON.parse(await file.text());editor.querySelector('textarea').value=Portable.json(value);editor.querySelector('textarea').dispatchEvent(new Event('input',{bubbles:true}));}),
 editor,
 paragraph('Source files must already be retained under the registry’s exact IDs. Declare geography partitions, metric additivity, method-comparability decisions, allowed ratio pairs and component reconciliations explicitly. Empty value is distinct from zero.','muted')
 ],d=>[{action:'saveRegistry',input:{registry:JSON.parse(d.registry)}}]);
 $('main').append(card('Registry authority',frm));
 for(const r of w.registries)$('main').append(card('Registry '+r.id,
 button('Use this registry',()=>{S.registryId=r.id;go('mapping');}),
 table(['Geography','Scheme / level','Parent','Source / boundary'],r.geographies.map(g=>[g.name+' ['+g.id+']',g.scheme+' / '+g.level,g.parent_id===null?'Explicit root':g.parent_id,g.source_file_id+' / '+g.source_locator+'\n'+g.boundary_note])),
 table(['Metric','Unit / currency','Population / price basis','Permitted addition'],r.metrics.map(m=>[m.name+' ['+m.id+']',m.unit+' / '+m.currency,m.population+'\n'+m.price_basis,m.additive_dimensions.join(', ')||'None declared'])),
 table(['Method','Version','Source / limitations'],r.methods.map(m=>[m.name+' ['+m.id+']',m.version,m.source_file_id+' / '+m.source_locator+'\n'+m.note])),
 jsonDetails('Complete partitions, reviewed comparability and ratio / reconciliation declarations',r),
 button('Download exact registry JSON',()=>download(r.id+'.json',Portable.json(r),'application/json'))));
}
function renderMapping(){
 const w=S.workspace,s=source();$('main').append(listenSelection(select('sourceSelection','CSV to map',w.sources.filter(s=>s.role==='source').map(s=>[s.id,s.filename+' ['+s.id+']']),S.sourceId),v=>{S.sourceId=v;}));
 if(!s||s.role!=='source'||!S.registryId){$('main').append(paragraph('Select an observation CSV and registry edition first.','callout'));return;}
 const current=w.mappings[s.id], fields=Engine.FIELDS.map(name=>{const mode=own(current?.columns||{},name)?'column':own(current?.constants||{},name)?'constant':'unmapped';return el('div',{class:'form-item'},el('h4',{},name),el('div',{class:'inline-controls'},select('mode:'+name,'Selection',[['unmapped','Unmapped — retain finding'],['column','Exact source column'],['constant','Explicit literal constant']],mode),select('column:'+name,'Original column',s.headers.map((h,i)=>[String(i),i+': '+(h||'(empty header)')]),String(current?.columns?.[name]??'')),textInput('constant:'+name,'Literal constant (blank remains blank)',current?.constants?.[name]??'')));});
 $('main').append(card('Map '+s.filename,form('saveMapping:'+s.id+':'+S.registryId,'Actual source column mapping',fields,d=>{const columns={},constants={};for(const name of Engine.FIELDS){if(d['mode:'+name]==='column'){if(d['column:'+name]==='')throw Error('Select the exact source column for '+name+'.');columns[name]=Number(d['column:'+name]);}else if(d['mode:'+name]==='constant')constants[name]=d['constant:'+name];}return[{action:'saveMapping',input:{sourceId:s.id,registryId:S.registryId,columns,constants}}];})));
 $('main').append(card('Retained mapping editions',jsonDetails('Complete mapping history',w.mappingHistory.filter(m=>m.sourceId===s.id))));
}
function describeRow(row){const v=row.values;return row.rowId+' · '+v.geography_id+' · '+v.metric_id+' · '+v.period_start+' → '+v.period_end+' · '+(row.normalized_value??v.status)+' '+v.unit;}
function currentCells(s,row){const cells=row.cells.slice();for(const c of S.workspace.corrections)if(c.sourceId===s.id&&c.rowId===row.id)cells[c.column]=c.value;return cells;}
function renderObservations(){
 if(!readyContext())return;const p=projection();
 $('main').append(card('Selected population',table(['Projected rows','Valid rows','Findings','Qualification'],[[p.rows.length,p.rows.filter(r=>r.valid).length,p.issues.length,p.ready?'Ready':'Resolve source findings']]),issueList(p.issues),jsonDetails('Original column coverage and source basis',{basis_sha256:p.basis_sha256,coverage:p.coverage})));
 const count=p.rows.length,perPage=50,start=Math.min(S.page*perPage,Math.max(0,Math.floor((count-1)/perPage)*perPage));S.page=Math.floor(start/perPage);
 $('main').append(card('Every retained observation',el('div',{class:'actions'},button('Previous 50',()=>{S.page=Math.max(0,S.page-1);render();},{disabled:S.page===0}),paragraph((count?start+1:0)+'–'+Math.min(start+perPage,count)+' of '+count),button('Next 50',()=>{S.page++;render();},{disabled:start+perPage>=count})),
 table(['Source row','Geography / period','Metric / population','Original / normalized','Source / status','Inspect'],p.rows.slice(start,start+perPage).map(r=>[r.rowId,r.values.geography_id+'\n'+r.values.period_start+' → '+r.values.period_end,r.values.metric_id+'\n'+r.values.population,r.values.original_display+'\n'+r.values.value+' × '+r.values.multiplier+' = '+(r.normalized_value??'No numeric observation'),r.values.source_id+' / '+r.values.source_locator+'\n'+r.values.status,button('Inspect row',()=>{S.rowId=r.rowId;render();},{dataset:{rowId:r.rowId}})]))));
 const r=p.rows.find(x=>x.rowId===S.rowId);if(!r)return;
 const s=S.workspace.sources.find(x=>x.id===r.sourceId),original=s.rows.find(x=>x.id===r.rowId),cells=currentCells(s,original);
 $('main').append(card('Original row '+r.rowId,table(['Position / original header','Original literal cell','Current attributed value'],s.headers.map((h,i)=>[i+': '+h,original.cells[i]??'(absent)',cells[i]??'(absent)'])),
 jsonDetails('Exact projected dimensions and raw typed source selection',r),
 form('saveCorrection:'+r.rowId,'Record an attributed cell correction',[
 select('column','Original cell position',s.headers.map((h,i)=>[String(i),i+': '+h])),textArea('value','Exact replacement string (empty is empty)'),textArea('reason','Correction reason and original supporting locator')
 ],d=>[{action:'saveCorrection',input:{sourceId:s.id,rowId:r.rowId,column:Number(d.column),value:d.value,actor:S.actor.trim(),reason:d.reason}}]),
 jsonDetails('Full original correction history',S.workspace.corrections.filter(c=>c.sourceId===s.id&&c.rowId===r.rowId))));
}

function rowPicker(name,rows){
 const root=el('div',{class:'row-picker'}),area=textArea(name,'Ordered source row IDs, one per line',''),list=el('ol'),search=textInput('','Find an observation',''),choice=el('select',{'aria-label':'Observation to add'});const input=area.querySelector('textarea');
 const ids=()=>input.value.split(/\r?\n/).filter(x=>x!=='');
 const refresh=()=>{list.replaceChildren();for(const [index,id]of ids().entries()){const r=rows.find(r=>r.rowId===id);list.append(el('li',{},paragraph(r?describeRow(r):'Retained row outside this view: '+id),el('div',{class:'actions'},button('Move up',()=>change(index,-1),{disabled:index===0}),button('Move down',()=>change(index,1),{disabled:index===ids().length-1}),button('Remove row',()=>{const a=ids();a.splice(index,1);set(a);}))))}};
 const set=a=>{input.value=a.join('\n');input.dispatchEvent(new Event('input',{bubbles:true}));};
 const change=(i,d)=>{const a=ids();[a[i],a[i+d]]=[a[i+d],a[i]];set(a);};
 const options=()=>{const term=search.querySelector('input').value.toLowerCase();const matches=rows.filter(r=>describeRow(r).toLowerCase().includes(term));choice.replaceChildren(...matches.slice(0,100).map(r=>el('option',{value:r.rowId},describeRow(r))));count.textContent=matches.length+' matching observations; showing the first '+Math.min(100,matches.length)+'. Refine the search to select any original row.';};
 const count=paragraph('','muted');search.querySelector('input').addEventListener('input',options);input.addEventListener('input',refresh);
 root.append(search,choice,count,button('Add selected observation',()=>{if(!choice.value)throw Error('Select an original observation.');const a=ids();if(a.includes(choice.value))throw Error('That original row is already selected.');a.push(choice.value);set(a);}),area,list);
 root.refresh=refresh;options();queueMicrotask(refresh);return root;
}
function analysisRequest(data){return{registryId:S.registryId,sourceIds:S.sourceIds.slice(),kind:data.kind,rowIds:data.rowIds.split(/\r?\n/).filter(x=>x!==''),...(data.dimension?{dimension:data.dimension}:{}),...(data.partitionId?{partitionId:data.partitionId}:{}),...(data.ratioPairId?{ratioPairId:data.ratioPairId}:{}),...(data.reconciliationId?{reconciliationId:data.reconciliationId}:{}),...(data.tolerance!==''?{tolerance:data.tolerance}:{})};}
function resultView(result){
 const r=result.result,v=r?.rational?.display??r?.value??'No defined numeric result';
 return el('div',{},paragraph(String(v)+' '+(r?.unit||''),'metric'),badge(result.qualified?'Source dimensions qualified':'Qualification unresolved'),issueList(result.issues),
 table(['Row','Geography / half-open period','Metric / population','Source value / normalized','Method / price basis','Original source locator'],(result.operands||[]).map(o=>[o.rowId,o.values.geography_id+'\n'+o.values.period_start+' → '+o.values.period_end,o.values.metric_id+'\n'+o.values.population,o.values.original_display+'\n'+o.values.value+' × '+o.values.multiplier+' = '+(o.normalized_value??'No numeric value'),o.values.method_id+'\n'+o.values.price_basis,o.values.source_id+' / '+o.values.source_locator])),
 jsonDetails('Complete exact result, declared relationships and source basis',result));
}
function renderAnalyses(){
 if(!readyContext())return;const p=projection(),r=registry(),preview=el('section',{id:'analysis-preview'},el('h2',{},'Calculation preview'),paragraph('Preview the selected operands and source findings before saving.'));
 const fields=[textInput('id','Stable analysis ID',uid('analysis')),textInput('title','Analysis title'),
 select('kind','Calculation',[['sum','Sum one declared additive dimension'],['difference','Difference: second minus first'],['percentage_change','Percentage change: first to second'],['ratio','Declared ratio: numerator then denominator'],['reconcile','Reconcile: total then declared components']],'sum'),
 paragraph('Order is part of the calculation. Reconciliation preserves the published total and reports components minus total. A tolerance is an explicit review choice, not a confidence interval.','muted'),
 rowPicker('rowIds',p.rows),select('dimension','Additive dimension for a sum',[['','Not a sum'],['geography','Geography'],['period','Period']],'geography'),
 select('partitionId','Declared geography partition',[['','No partition selected'],...r.partitions.map(x=>[x.id,x.id+' / '+x.note])]),
 select('ratioPairId','Declared ratio pair',[['','Not selected'],...(r.ratio_pairs||[]).map(x=>[x.id,x.id+' / '+x.numerator_metric_id+' ÷ '+x.denominator_metric_id])]),
 select('reconciliationId','Declared component relationship',[['','Not selected'],...(r.reconciliations||[]).map(x=>[x.id,x.id+' / '+x.total_metric_id])]),
 textInput('tolerance','Exact nonnegative reconciliation tolerance','0'),textArea('note','Interpretation, qualifications and observed limitations')];
 const frm=form('saveAnalysis:'+S.registryId,'Freeze one complete calculation',fields,d=>[{action:'saveAnalysis',input:{id:d.id,title:d.title,actor:S.actor.trim(),note:d.note,analysis:analysisRequest(d)}}]);
 frm.querySelector('fieldset').append(button('Preview exact calculation',()=>{const d=plainValues(frm),result=Engine.runAnalysis(S.workspace,analysisRequest(d));preview.replaceChildren(el('h2',{},'Calculation preview'),resultView(result));},{id:'analysis-preview-button'}));
 $('main').append(card('Qualified calculations',paragraph('Geography overlaps, duplicate observations, period gaps, incompatible methods and missing values remain visible. A saved result keeps its original operands even after later corrections.'),issueList(p.issues),frm),preview);
 for(const a of S.workspace.analyses)$('main').append(card(a.title+' ['+a.id+']',paragraph('Revision '+a.revision+' · '+a.actor+' · '+a.at+'\n'+a.note),resultView(a.result),button('Download frozen analysis JSON',()=>download(a.id+'.json',Portable.json(a),'application/json'))));
}
function reportFrame(html,title){return el('iframe',{class:'report',title,sandbox:'allow-same-origin allow-modals',srcdoc:html});}
function renderReports(){
 const w=S.workspace;
 $('main').append(card('Freeze a reproducible report',form('saveReport','Complete selected report',[
 textInput('id','Stable report ID',uid('report')),textInput('title','Report title'),textArea('note','Report interpretation and limitations'),
 w.analyses.length?w.analyses.map(a=>check('analysis:'+a.id,a.title+' ['+a.id+'] · revision '+a.revision)):paragraph('Save source-qualified calculations first.','callout')
 ],d=>[{action:'saveReport',input:{id:d.id,title:d.title,actor:S.actor.trim(),note:d.note,analysisIds:chosen(d,'analysis')}}])));
 const current=Engine.renderReport(w);$('main').append(card('Complete current record',paragraph('This report contains all original rows, attributed corrections, analysis history and source context. Use the complete ZIP for usable adjacent original-file links.'),
 button('Download complete readable report',()=>download('Complete_Report.html',current,'text/html')),
 button('Print complete current report',()=>printHTML(current)),reportFrame(current,'Complete source and series report')));
 for(const r of w.reports){const html=Engine.renderReport(w,r.id);$('main').append(card(r.title+' ['+r.id+']',paragraph('Frozen analysis edition '+r.revision+' · '+r.actor+' · '+r.at+'\n'+r.note),
 table(['Saved analysis','Original revision','Source qualification'],r.analyses.map(a=>[a.title,a.revision,a.result.qualified?'Qualified':'Unresolved findings retained'])),
 el('div',{class:'actions'},button('Download frozen readable report',()=>download(r.id+'.html',html,'text/html')),button('Download exact report selection',()=>download(r.id+'.json',Portable.json(r),'application/json')),button('Print this frozen report',()=>printHTML(html))),
 summary('Open the full readable report',reportFrame(html,r.title))));}
}
function printHTML(html){const frame=reportFrame(html,'Print complete report');frame.style.position='fixed';frame.style.left='-10000px';document.body.append(frame);frame.addEventListener('load',()=>{frame.contentWindow.focus();frame.contentWindow.print();setTimeout(()=>frame.remove(),60000);},{once:true});}
function fileText(file){return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(Portable.base64Decode(file.content_base64));}
function safeName(id,suffix){return 'edition-'+encodeURIComponent(id).replaceAll('%','_').slice(0,65)+'-'+sha256Utf8(id).sha256.slice(0,20)+suffix;}
function renderTarget(){
 const w=S.workspace,p=readyContext()?projection():null;
 const selector=listenSelection(select('templateSelection','Retained actual target CSV template',[['','Choose an original file'],...w.files.map(f=>[f.id,f.filename+' ['+f.id+']'])],S.templateId||''),v=>{S.templateId=v||null;});
 $('main').append(card('Actual target import contract',paragraph('Choose the original UTF-8 CSV header template supplied for the intended target. Every column receives an explicit source field or literal constant. This tool prepares and compares files; the actual platform operation is recorded by its returned CSV.'),selector));
 const template=w.files.find(f=>f.id===S.templateId);
 if(template&&p){try{const csv=Engine.parseCsv(fileText(template)),fields=csv.headers.map((header,i)=>el('div',{class:'form-item'},el('h4',{},'Column '+i+': '+(header||'(empty header)')),
 select('kind:'+i,'Column disposition',[['field','Canonical observation field'],['constant','Literal constant']],'field'),
 select('field:'+i,'Source field',[...Engine.FIELDS,'normalized_value','rowId']),textArea('constant:'+i,'Exact literal constant'),check('key:'+i,'Part of the actual target identity key')));
 $('main').append(card('Prepare the complete target CSV',form('prepareTarget:'+template.id+':'+S.registryId,'Frozen original template mapping',[
 textInput('id','Stable target plan ID',uid('target')),rowPicker('rowIds',p.rows),fields,textArea('note','Actual target contract, key choice and source-selection note')
 ],d=>[{action:'prepareTarget',input:{id:d.id,registryId:S.registryId,sourceIds:S.sourceIds.slice(),rowIds:d.rowIds.split(/\r?\n/).filter(Boolean),templateFileId:template.id,columns:csv.headers.map((_,i)=>d['kind:'+i]==='constant'?{column:i,constant:d['constant:'+i]}:{column:i,field:d['field:'+i]}),keyColumns:csv.headers.map((_,i)=>i).filter(i=>d['key:'+i]===true),actor:S.actor.trim(),note:d.note}}])));
 }catch(e){$('main').append(paragraph('This original cannot be used as a target template: '+e.message,'callout'));}}
 $('main').append(card('Frozen prepared target editions',w.targetPlans.map(plan=>summary(plan.id+' · '+plan.rows.length+' rows · revision '+plan.revision,[
 paragraph(plan.note+'\nSHA-256 '+plan.sha256),table(['Source row',...plan.headers.map((h,i)=>i+': '+h)],plan.rows.map(r=>[r.rowId,...r.cells])),
 button('Download exact prepared CSV',()=>download(safeName(plan.id,'.csv'),plan.csv,'text/csv'),{dataset:{targetPlan:plan.id}}),
 button('Select for actual returned-row comparison',()=>{S.planId=plan.id;render();}),jsonDetails('Complete original mapping and frozen source basis',plan)
 ]))));
 const plan=w.targetPlans.find(x=>x.id===S.planId),returned=w.sources.find(x=>x.id===S.returnedId&&x.role==='target');
 $('main').append(card('Compare an actual returned file',
 paragraph('Import the real returned CSV with role “Actual returned target CSV” in Original files & CSV. Then map every prepared column to its exact returned header position. Native extra columns and all returned records remain retained.'),
 listenSelection(select('planSelection','Original prepared plan',w.targetPlans.map(x=>[x.id,x.id]),S.planId||''),v=>{S.planId=v;}),
 listenSelection(select('returnedSelection','Actual returned CSV',w.sources.filter(x=>x.role==='target').map(x=>[x.id,x.filename+' ['+x.id+']']),S.returnedId||''),v=>{S.returnedId=v;})));
 if(plan&&returned)$('main').append(card('Record complete returned-row comparison',form('recordTargetReturn:'+plan.id+':'+returned.id,'Actual target return',[
 textInput('id','Stable return ID',uid('return')),
 ...plan.headers.map((h,i)=>select('column:'+i,'Prepared column '+i+': '+h,returned.headers.map((name,j)=>[String(j),j+': '+name]),'')),
 textArea('note','Actual target operation reference and receiving note')
 ],d=>[{action:'recordTargetReturn',input:{id:d.id,planId:plan.id,sourceId:returned.id,columns:plan.headers.map((_,i)=>{if(d['column:'+i]==='')throw Error('Select the actual returned column for '+plan.headers[i]+'.');return{preparedColumn:i,returnedColumn:Number(d['column:'+i])};}),actor:S.actor.trim(),note:d.note}}])));
 for(const r of w.targetReturns)$('main').append(card('Retained target return '+r.id,paragraph('Original plan '+r.planId+' · actual returned source '+r.sourceId),badge(r.ready?'Returned rows reconciled':'Returned-row findings retained'),
 table(['Matched','Missing','Unexpected','Duplicate keys','Different values'],[[r.matched?.length??r.matched??0,r.missing?.length??0,r.unexpected?.length??0,r.duplicates?.length??0,r.differences?.length??0]]),
 jsonDetails('Every original returned row, native extra field and comparison',r),
 button('Download full retained return JSON',()=>download(safeName(r.id,'.json'),Portable.json(r),'application/json'))));
}
function renderHistory(){
 const host=el('div'),key=S.copyId,workspace=copy(S.workspace);$('main').append(host);
 host.append(card('Original operation history',paragraph('Each completed request retains its original revision, input, request digest and result. The physical file/CSV bodies remain in their original source records.'),
 table(['Revision','Kind','Time','Original request / result'],workspace.operations.map(o=>[o.revision,o.kind,o.at,jsonDetails(o.id,o)]))),
 card('Unfinished forms in this tab',Object.keys(S.drafts).length?Object.entries(S.drafts).map(([name,row])=>jsonDetails(name+' / revision '+row.baseRevision,row)):paragraph('No unfinished values in this tab.')));
 all('drafts').then(rows=>{if(S.copyId!==key||S.section!=='history')return;const others=rows.filter(r=>r.copyId===key&&r.tabId!==tabId);if(others.length)host.append(card('Other tabs’ retained unfinished values',button('Download all retained tab drafts',()=>download('Other_Tab_Drafts.json',Portable.json(others),'application/json')),others.map(row=>summary(row.name+' / '+row.updatedAt,[jsonDetails('Original draft',row),button('Recover as a separate local copy',async()=>{await useCopy(await saveCopy(Portable.recovery(workspace,{[row.name]:{fields:row.fields,baseHead:row.baseHead,baseRevision:row.baseRevision,token:uid('draft'),updatedAt:row.updatedAt}}),'Recovered other-tab draft'));})]))));buttons();}).catch(e=>say(e.message,true));
 all('branches').then(rows=>{if(S.copyId!==key||S.section!=='history')return;const selected=rows.filter(r=>r.copyId===key);if(selected.length)host.append(card('Retained complete conflicting branches',selected.map(c=>summary(c.createdAt,[paragraph(c.reason),button('Download complete conflict',()=>download(c.key+'.json',Portable.json(c),'application/json')),button('Continue candidate as a separate copy',async()=>useCopy(await saveCopy(Portable.recovery(c.candidate,c.drafts),'Recovered conflict')))]))));buttons();}).catch(e=>say(e.message,true));
}
channel?.addEventListener('message',event=>{if(S.workspace&&event.data.copyId===S.copyId&&event.data.head!==Portable.head(S.workspace))say('Another tab saved this local copy. Your visible values remain unchanged. The next save will preserve both complete versions if necessary.');});
window.addEventListener('beforeunload',event=>{if(S.busy||Object.keys(S.drafts).length){event.preventDefault();event.returnValue='';}});
(async()=>{S.busy=true;buttons();try{
 await claimTabIdentity();S.db=await openDB();const embedded=boot.record?Portable.parseRecovery(Portable.json(boot.record)):null;
 if(embedded){const rows=await all('copies'),retained=rows.find(r=>r.key===boot.copyId);if(retained){const relationship=Portable.compare(retained.workspace,embedded.workspace);if(['identical','incoming_ancestor'].includes(relationship)){await useCopy(retained.key);await restoreEmbeddedDrafts(embedded.drafts);if(relationship==='incoming_ancestor')say('Reopened the newer saved local workspace. The older embedded edition remains in this original working HTML.');}else{await useCopy(await saveCopy(embedded,'Independent working HTML edition'));say('The embedded edition differs from the saved local copy. Both whole versions are retained independently.');}}else await useCopy(await saveCopy(embedded,'Opened working HTML',boot.copyId));applySelection(embedded.selection);normalizeSelection();
 }else{let key;try{key=sessionStorage.getItem('tourism-series-current');}catch{}if(key&&(await all('copies')).some(r=>r.key===key))await useCopy(key);}render();
 }catch(e){say('Browser storage could not open. Keep this original working file. '+e.message,true);$('main').append(card('Storage is unavailable',paragraph('Open this file in a browser with local storage enabled. The embedded complete workspace remains downloadable.'),boot.record?button('Download embedded recovery JSON',()=>download('Working_Recovery.json',Portable.json(boot.record),'application/json')):null));}finally{S.busy=false;buttons();}})();
