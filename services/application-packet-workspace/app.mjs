import * as Engine from './engine.mjs';
import * as Portable from './portable.mjs';
import {sha256Utf8,sha256Bytes} from './sha256.mjs';

const $=id=>document.getElementById(id);
const boot=JSON.parse($('application-boot').textContent);
const copy=value=>JSON.parse(JSON.stringify(value));
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const uid=prefix=>prefix+'-'+crypto.randomUUID();
const stamp=()=>new Date().toISOString();
const S={db:null,copyId:null,workspace:null,state:null,section:'workspace',caseId:null,instanceId:null,busy:false,drafts:{},draftQueue:Promise.resolve(),actor:'',conflict:null,storageError:null};
let tabId;try{tabId=sessionStorage.getItem('application-packet-tab');if(!tabId){tabId=uid('tab');sessionStorage.setItem('application-packet-tab',tabId);}S.actor=sessionStorage.getItem('application-packet-actor')||'';}catch{tabId=uid('tab');}
async function claimTabIdentity(){
  const fresh=()=>{tabId=uid('tab');try{sessionStorage.setItem('application-packet-tab',tabId);}catch{}};
  if(!navigator.locks?.request){fresh();return;}
  await new Promise(resolve=>{
    navigator.locks.request('application-packet-tab-'+tabId,{ifAvailable:true},lock=>{
      if(!lock){fresh();resolve();return;}
      resolve();return new Promise(()=>{});
    }).catch(()=>{fresh();resolve();});
  });
}
const channel=typeof BroadcastChannel==='function'?new BroadcastChannel('application-packet-workspace'):null;
function el(tag,props={},...children){const node=document.createElement(tag);for(const [k,v]of Object.entries(props)){if(k==='class')node.className=v;else if(k==='text')node.textContent=v;else if(k==='on')for(const [name,fn]of Object.entries(v))node.addEventListener(name,fn);else if(k==='dataset')Object.assign(node.dataset,v);else if(k in node&&k!=='form')node[k]=v;else node.setAttribute(k,v);}for(const child of children.flat(Infinity))if(child!==null&&child!==undefined)node.append(child instanceof Node?child:document.createTextNode(String(child)));return node;}
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
function fileChoices(name,selected=[]){return S.state.files.length?el('div',{},S.state.files.map(f=>check(name+':'+f.id,f.filename+' ['+f.id+']',selected.includes(f.id)))):paragraph('Retain the original files in Files & sources first.','callout');}
function chosen(data,prefix){return Object.keys(data).filter(k=>k.startsWith(prefix+':')&&data[k]===true).map(k=>k.slice(prefix.length+1));}
function plainValues(form){const fields={};for(const n of form.elements)if(n.name&&n.type!=='file'&&!['submit','button'].includes(n.type))fields[n.name]=n.type==='checkbox'?n.checked:n.value;return fields;}
function hydrate(form,fields){for(const n of form.elements)if(n.name&&own(fields,n.name)&&n.type!=='file'){if(n.type==='checkbox')n.checked=fields[n.name]===true;else{if(n.tagName==='SELECT'&&!Array.from(n.options).some(o=>o.value===String(fields[n.name])))n.append(el('option',{value:fields[n.name]},'Retained value: '+fields[n.name]));n.value=fields[n.name];}}}
function request(tx,store,key){return new Promise((resolve,reject)=>{const r=tx.objectStore(store).get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
function transaction(stores,fn){return new Promise((resolve,reject)=>{const tx=S.db.transaction(stores,'readwrite');let result;tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error||Error('The local save failed.'));tx.onabort=()=>reject(tx.error||Error('The local save was aborted.'));try{fn(tx,value=>{result=value;});}catch(e){tx.abort();reject(e);}});}
async function openDB(){return new Promise((resolve,reject)=>{const r=indexedDB.open('application-packet-workspace-v1',1);r.onupgradeneeded=()=>{for(const name of ['copies','drafts','branches'])r.result.createObjectStore(name,{keyPath:'key'});};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.onblocked=()=>reject(Error('Close the older workspace tab to open the local database.'));});}
async function all(store){return new Promise((resolve,reject)=>{const tx=S.db.transaction(store),r=tx.objectStore(store).getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
function draftKey(name){return S.copyId+'|'+tabId+'|'+name;}
function retainDraft(name,row){S.drafts[name]=row;const key=draftKey(name),copyId=S.copyId;S.draftQueue=S.draftQueue.then(()=>transaction(['drafts'],tx=>tx.objectStore('drafts').put({key,copyId,tabId,name,...copy(row)}))).catch(e=>{S.storageError=e; say('The unfinished text remains visible, but browser storage failed. Download working HTML or recovery JSON now. '+e.message,true);});return S.draftQueue;}
function captureDraft(form,name){const old=S.drafts[name];const row={fields:plainValues(form),baseHead:old?.baseHead||Portable.head(S.workspace),baseRevision:old?.baseRevision??S.workspace.journal.length,token:uid('draft'),updatedAt:stamp()};retainDraft(name,row);return row;}
function form(name,title,fields,prepare,options={}){
  const form=el('form',{dataset:{action:name},noValidate:true});const box=el('fieldset',{},el('h3',{},title),fields);const saved=S.drafts[name];const flag=el('p',{class:'muted'});
  const updateFlag=()=>{const d=S.drafts[name];flag.textContent=d?'Unfinished values retained from revision '+d.baseRevision+(d.baseHead!==Portable.head(S.workspace)?'. Review these values against the current edition, then explicitly use them below.':'.'):'';};
  const adopt=button('Use these values for the current revision',async()=>{const row={fields:plainValues(form),baseHead:Portable.head(S.workspace),baseRevision:S.workspace.journal.length,token:uid('draft'),updatedAt:stamp()};await retainDraft(name,row);updateFlag();});
  adopt.hidden=!saved||saved.baseHead===Portable.head(S.workspace);
  box.append(flag,adopt,el('div',{class:'actions'},el('button',{type:'submit',class:'primary'},options.label||'Save'),button('Discard this unfinished form',async()=>{await S.draftQueue;await transaction(['drafts'],tx=>tx.objectStore('drafts').delete(draftKey(name)));delete S.drafts[name];render();})));
  form.append(box);if(saved)hydrate(form,saved.fields);updateFlag();
  form.addEventListener('input',()=>{captureDraft(form,name);updateFlag();});
  form.addEventListener('change',()=>{captureDraft(form,name);updateFlag();});
  form.addEventListener('submit',event=>{event.preventDefault();if(S.busy)return;
    const raw=plainValues(form),picked={};for(const n of form.elements)if(n.type==='file'&&n.name)picked[n.name]=Array.from(n.files);
    const draft=captureDraft(form,name),original=copy(S.workspace),originalKey=S.copyId;
    act(async()=>{if(!S.actor.trim())throw Error('Enter the actual operator name at the top before saving decisions.');
      if(draft.baseHead!==Portable.head(original))throw Error('This recovered form began on an earlier revision. Review it and use the explicit current-revision button before saving.');
      const actions=await prepare(copy(raw),picked);if(!Array.isArray(actions)||!actions.length)throw Error('Supply the complete operation.');
      let next=original;for(const item of actions)next=Engine.apply(next,item.action,item.input,{operationId:uid('op'),expectedRevision:next.journal.length,actor:S.actor.trim(),at:stamp()}).workspace;
      await commit(originalKey,original,next,name,draft.token);say('Saved '+actions.length+' operation'+(actions.length===1?'':'s')+' at revision '+next.journal.length+'.');render();
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
  S.workspace=next;S.state=Engine.inspect(next);if(S.drafts[name]?.token===token)delete S.drafts[name];channel?.postMessage({copyId:key,head:Portable.head(next)});S.storageError=null;
}
async function saveCopy(record,label,preferredKey=null){Engine.inspect(record.workspace);const key=preferredKey||uid('copy');await transaction(['copies','drafts'],tx=>{tx.objectStore('copies').add({key,workspace:copy(record.workspace),updatedAt:stamp(),title:record.workspace.title,label});for(const [name,row]of Object.entries(record.drafts||{}))tx.objectStore('drafts').put({key:key+'|'+tabId+'|'+name,copyId:key,tabId,name,...copy(row)});});return key;}
async function useCopy(key){await S.draftQueue;const tx=S.db.transaction('copies'),row=await request(tx,'copies',key);if(!row)throw Error('Choose an existing saved local copy.');S.copyId=key;S.workspace=row.workspace;S.state=Engine.inspect(row.workspace);S.drafts={};for(const d of await all('drafts'))if(d.copyId===key&&d.tabId===tabId){const {key:k,copyId,tabId:t,name,...body}=d;S.drafts[name]=body;}S.conflict=null;S.instanceId=null;S.caseId=S.state.cases.find(c=>c.id===S.caseId)?.id||S.state.cases[0]?.id||null;try{sessionStorage.setItem('application-packet-current',key);}catch{}render();}
async function restoreEmbeddedDrafts(drafts){
  for(const [name,row]of Object.entries(drafts||{})){
    const key=draftKey(name),copyId=S.copyId,importedTab='embedded-'+sha256Utf8(Portable.json(row)).sha256;
    const result=await transaction(['drafts'],(tx,done)=>{
      const r=tx.objectStore('drafts').get(key);
      r.onsuccess=()=>{
        if(!r.result){tx.objectStore('drafts').add({key,copyId,tabId,name,...copy(row)});done({row});}
        else if(Engine.canonical(r.result.fields)!==Engine.canonical(row.fields)||r.result.baseHead!==row.baseHead){
          tx.objectStore('drafts').put({key:copyId+'|'+importedTab+'|'+name,copyId,tabId:importedTab,name,...copy(row)});
          done({retainedSeparate:true});
        }else done({});
      };
    });
    if(result.row)S.drafts[name]=copy(row);
    if(result.retainedSeparate)say('A different local draft already exists. The embedded unfinished values remain separately recoverable under History & recovery.');
  }
}
async function currentRecord(){await S.draftQueue;return Portable.recovery(copy(S.workspace),copy(S.drafts),{section:S.section,caseId:S.caseId,instanceId:S.instanceId},S.copyId);}
function showConflict(){const node=$('conflicts');node.replaceChildren();if(!S.conflict)return;const c=S.conflict;node.append(el('h2',{},'Two complete versions are retained'),paragraph(c.reason),el('div',{class:'actions'},
  button('Download both versions and draft values',()=>download('Workspace_Conflict.json',Portable.json(c),'application/json')),
  button('Continue my version as a new copy',async()=>{const k=await saveCopy(Portable.recovery(c.candidate,c.drafts),'Recovered conflict branch');await useCopy(k);}),
  button('Open the saved version',async()=>{await useCopy(c.copyId);})));
}
function go(section){S.section=section;render();}
function caseNow(){return S.state.cases.find(c=>c.id===S.caseId)||null;}
function requireCase(){const c=caseNow();if(!c)return paragraph('Create or select a case in Cases & subjects first.','callout');return null;}
function casePicker(){return select('caseSelection','Current case',S.state.cases.map(c=>[c.id,c.title+' ['+c.id+']']),S.caseId||'');}
function addCasePicker(container){if(!S.state.cases.length)return;const field=casePicker();field.querySelector('select').addEventListener('change',e=>act(async()=>{S.caseId=e.target.value;S.instanceId=null;render();}));container.append(field);}
function render(){
  $('identity').replaceChildren();$('navigation').replaceChildren();$('main').replaceChildren();
  if(!S.workspace){renderWelcome();buttons();return;}
  S.state=Engine.inspect(S.workspace);
  $('identity').dataset.copyId=S.copyId;
  const actor=textInput('actor','Actual operator',S.actor,{id:'operator-name'});actor.querySelector('input').addEventListener('input',e=>{S.actor=e.target.value;try{sessionStorage.setItem('application-packet-actor',S.actor);}catch{}});
  $('identity').append(paragraph(S.workspace.title),el('strong',{id:'workspace-revision'},'Revision '+S.workspace.journal.length),actor);
  for(const [id,label]of [['workspace','Workspace & delivery'],['sources','Files & sources'],['requirements','Requirement editions'],['cases','Cases & subjects'],['scope','Scope & form instances'],['forms','Forms & evidence'],['corrections','Corrections'],['handover','Review & handover'],['native','Native import & returns'],['history','History & recovery']]){
    $('navigation').append(button(label,()=>go(id),{'aria-current':S.section===id?'page':'false',dataset:{section:id}}));
  }
  if(!['workspace','sources','requirements','history'].includes(S.section))addCasePicker($('main'));
  ({workspace:renderWorkspace,sources:renderSources,requirements:renderRequirements,cases:renderCases,scope:renderScope,forms:renderForms,corrections:renderCorrections,handover:renderHandover,native:renderNative,history:renderHistory}[S.section]||renderWorkspace)();
  showConflict();buttons();
}
function openChooser(label,callback,accept='.json'){const input=el('input',{type:'file',accept});input.addEventListener('change',()=>{const file=input.files[0];if(file)act(async()=>{await callback(file);input.value='';});});return el('label',{class:'field'},el('span',{},label),input);}
async function openIncoming(file){if(file.size>192*1024*1024)throw Error('The recovery file may be at most 192 MiB.');const record=Portable.parseRecovery(await file.text());const matches=(await all('copies')).filter(r=>r.workspace.id===record.workspace.id);const identical=matches.find(r=>Portable.head(r.workspace)===Portable.head(record.workspace));if(identical&&Object.keys(record.drafts).length===0){await useCopy(identical.key);say('Opened the identical saved workspace.');return;}const key=await saveCopy(record,'Imported '+file.name);await useCopy(key);S.section=record.selection.section||'workspace';S.caseId=record.selection.caseId||S.caseId;S.instanceId=record.selection.instanceId||null;render();say(matches.length?'Opened a separate local copy; every other saved edition remains available.':'Opened the complete workspace and unfinished values.');}
function renderWelcome(){
  $('identity').append(paragraph('No local workspace selected.'));
  const title=textInput('title','Workspace title','Application packet');
  const start=el('form',{},title,el('button',{type:'submit',class:'primary'},'Create workspace'));start.addEventListener('submit',e=>{e.preventDefault();const value=title.querySelector('input').value;act(async()=>{const ws=Engine.createWorkspace({id:uid('workspace'),title:value,createdAt:stamp()});await useCopy(await saveCopy(Portable.recovery(ws),'Created locally'));});});
  $('main').append(card('Create or reopen a complete packet',paragraph('Start empty, then retain the original sources and select their actual requirements. There are no embedded prospects or application facts.'),start,openChooser('Open complete workspace or recovery JSON',openIncoming)));
  if(S.db)actListCopies().catch(e=>say(e.message,true));
}
async function actListCopies(){const host=el('div');$('main').append(host);const rows=await all('copies');const node=card('Saved local copies',rows.length?table(['Title','Revision','Updated','Open'],rows.map(r=>[r.title,String(r.workspace.journal.length),r.updatedAt,button('Open',()=>useCopy(r.key))])):paragraph('No local copies yet.'));host.append(node);buttons();}
function renderWorkspace(){
  const s=S.state;
  $('main').append(card('Complete working packet',paragraph(s.title),table(['Cases','Original files','Source editions','Requirement editions','Saved operations'],[[s.cases.length,s.files.length,s.sources.length,s.editions.length,s.revision]]),
    paragraph('Working HTML and recovery JSON include unfinished values from this tab. The complete ZIP includes those working files, the review, all original bytes, current and historical native exports, and the whole application source.'),
    el('div',{class:'actions'},
      button('Download working HTML',async()=>download('Application_Packet_Workspace.html',Portable.workingHTML(boot.source,await currentRecord()),'text/html'),{id:'top-working-html',class:'primary'}),
      button('Download recovery JSON',async()=>download('Working_Recovery.json',Portable.json(await currentRecord()),'application/json'),{id:'top-json'}),
      button('Download complete ZIP',async()=>download('Application_Packet_Complete.zip',Portable.zipBytes(Portable.completeFiles(boot.source,await currentRecord())),'application/zip'),{id:'top-zip'}),
      button('Download raw unfinished values',()=>download('Unfinished_Values.json',Portable.json({workspaceId:S.workspace.id,head:Portable.head(S.workspace),drafts:S.drafts}),'application/json')),
      button('Download saved journal JSON',()=>download('workspace.json',Engine.exportWorkspace(S.workspace),'application/json')),
      button('Download full application source ZIP',()=>download('Application_Packet_Source.zip',Portable.zipBytes(Object.entries(boot.source).map(([path,content])=>({path,content}))),'application/zip'))),
    openChooser('Open another saved workspace or recovery JSON',openIncoming),
    button('Create another empty workspace',async()=>{S.workspace=null;S.copyId=null;S.state=null;S.drafts={};render();})));
  $('main').append(card('Cases',s.cases.length?table(['Case','Source edition','Progress','Open'],s.cases.map(c=>[c.title,c.editionId,badge(c.assessment.status),button('Open case',()=>{S.caseId=c.id;go('forms');},{dataset:{caseId:c.id}})])):paragraph('Retain sources and define requirements, then create the first case.')));
  actListCopies().catch(e=>say(e.message,true));
}
function renderSources(){
  const upload=form('addFile','Retain complete original files',[
    textArea('purpose','Purpose of these original files',''),
    el('label',{class:'field'},el('span',{},'Choose files (each at most 32 MiB)'),el('input',{type:'file',name:'files',multiple:true})),
    paragraph('The file bytes are retained only after Save. A browser reload cannot restore a file chooser; select the original file again if this form is unfinished.','muted')
  ],async(d,p)=>{if(!p.files?.length)throw Error('Select the complete original files.');const result=[];for(const file of p.files){if(file.size>Engine.LIMITS.fileBytes)throw Error(file.name+' exceeds 32 MiB.');const bytes=new Uint8Array(await file.arrayBuffer());result.push({action:'addFile',input:{id:uid('file'),filename:file.name,mimeType:file.type||'application/octet-stream',purpose:d.purpose,base64:Engine.base64Encode(bytes)}});}return result;},{label:'Retain original bytes'});
  $('main').append(card('Files & source editions',upload));
  $('main').append(card('Retained files',S.state.files.length?table(['Original filename','Purpose','Bytes / SHA-256','Download'],S.state.files.map(f=>[f.filename,paragraph(f.purpose),f.bytes+'\n'+f.sha256,button('Download original',()=>download(f.filename,Engine.base64Decode(f.base64),f.mimeType),{dataset:{fileId:f.id}})])):paragraph('No original files retained.')));
  $('main').append(card('Describe a retained source',form('addSource','Add a source edition',[
    textInput('title','Source title'),textInput('publisher','Issuing publisher or authority'),textInput('url','Original URL or location'),textInput('issued','Displayed edition / date (blank if unstated)'),textInput('retrieved','Actual retrieval date and source note'),textArea('note','Edition context and changes'),
    select('supersedes','Earlier source superseded',[['','None'],...S.state.sources.map(s=>[s.id,s.title])]),el('h4',{},'Original source files'),fileChoices('sourceFiles')
  ],d=>[{action:'addSource',input:{id:uid('source'),title:d.title,publisher:d.publisher,url:d.url,issued:d.issued,retrieved:d.retrieved,note:d.note,fileIds:chosen(d,'sourceFiles'),...(d.supersedes?{supersedes:d.supersedes}:{})}}])));
  $('main').append(card('Original source history',S.state.sources.map(s=>summary(s.title+' — '+(s.issued||'edition not stated'),[paragraph(s.publisher+'\n'+s.url+'\n'+s.retrieved+'\n'+s.note),jsonDetails('Complete retained source',s)]))));
}
function requirementExample(){return[{id:'requirement-1',label:'Exact issued requirement label',sourceId:S.state.sources[0]?.id||'SELECT_RETAINED_SOURCE_ID',locator:'Page / section',instructions:'Complete issued instructions',applicabilityNote:'State who the issued requirement applies to',instanceMode:'single',evidenceRequired:true,fields:[{id:'reference',label:'Original application reference',type:'text',required:true}]}];}
function renderRequirements(){
  $('main').append(card('Source-bound requirement editions',paragraph('Use the actual instructions and fields from the retained originals. An edition is immutable. Later editions retain stable requirement and field IDs so a case can adopt them without losing history. Advanced JSON is the complete typed contract; the case forms below use normal controls.'),
    form('addEdition','Define a complete requirement edition',[
      textInput('title','Edition title'),textInput('facilityType','Actual facility / entity type'),textInput('applicationType','Actual transaction / application type'),textArea('note','Selection and interpretation note'),
      el('h4',{},'Source editions'),S.state.sources.map(s=>check('source:'+s.id,s.title)),
      textArea('requirements','Complete requirements JSON',Portable.json(requirementExample()),{class:'code',spellcheck:false}),
      paragraph('Field types: text, date, integer, decimal, boolean, choice. All form values remain strings; choice fields include exact options. Instance mode is single or per_subject. Include every selected requirement and its source locator.','muted')
    ],d=>[{action:'addEdition',input:{id:uid('edition'),title:d.title,facilityType:d.facilityType,applicationType:d.applicationType,note:d.note,sourceIds:chosen(d,'source'),requirements:JSON.parse(d.requirements)}}])));
  $('main').append(card('Saved editions',S.state.editions.map(e=>summary(e.title+' ['+e.id+']',[
    paragraph(e.facilityType+' / '+e.applicationType+'\n'+e.note),
    table(['Requirement','Source / locator','Instances','Fields'],e.requirements.map(r=>[r.label,r.sourceId+'\n'+r.locator,r.instanceMode,r.fields.map(f=>f.label+' ('+f.type+(f.required?', required':'')+')').join('\n')])),
    button('Download exact edition JSON',()=>download(e.id+'.json',Portable.json(e),'application/json')),jsonDetails('Full original requirement contract',e)
  ]))));
}
function renderCases(){
  $('main').append(card('Create a case',form('createCase','New case',[
    textInput('title','Case title'),textInput('reference','Original application reference'),textArea('details','Facility, entity and transaction facts'),
    select('editionId','Matching requirement edition',S.state.editions.map(e=>[e.id,e.title+' / '+e.facilityType+' / '+e.applicationType]))
  ],d=>{const ed=S.state.editions.find(e=>e.id===d.editionId);if(!ed)throw Error('Create a requirement edition first.');return[{action:'createCase',input:{id:uid('case'),title:d.title,reference:d.reference,details:d.details,editionId:ed.id,facilityType:ed.facilityType,applicationType:ed.applicationType}}];})));
  const c=caseNow();if(!c)return;
  $('main').append(card('Current case facts',form('updateCase:'+c.id,'Update case facts',[
    textInput('title','Case title',c.title),textInput('reference','Original reference',c.reference),textArea('details','Complete facts',c.details),textArea('reason','Reason for this change')
  ],d=>[{action:'updateCase',input:{caseId:c.id,...d}}]),
    form('adoptEdition:'+c.id,'Adopt a later matching requirement edition',[
      select('editionId','Requirement edition',S.state.editions.filter(e=>e.facilityType===c.facilityType&&e.applicationType===c.applicationType).map(e=>[e.id,e.title]),c.editionId),textArea('reason','Edition adoption reason')
    ],d=>[{action:'adoptEdition',input:{caseId:c.id,...d}}])));
  $('main').append(card('People and entities in this case',
    paragraph('Use a distinct stable record for each actual person or entity, including people with the same display name. Adding a subject requires a fresh full scope review.'),
    form('addSubject:'+c.id,'Add person or entity',[
      textInput('label','Display name / entity label'),textInput('role','Actual role'),textInput('reference','Original person / entity reference')
    ],d=>[{action:'addSubject',input:{id:uid('subject'),caseId:c.id,...d}}]),
    table(['Label','Role','Original reference','Stable ID'],S.state.subjects.filter(s=>s.caseId===c.id).map(s=>[s.label,s.role,s.reference,s.id]))));
}
function renderScope(){
  const error=requireCase();if(error){$('main').append(error);return;}const c=caseNow(),ed=S.state.editions.find(e=>e.id===c.editionId),subjects=S.state.subjects.filter(s=>s.caseId===c.id),old=c.assessment.scope?.requirements||[];
  const fields=ed.requirements.map(r=>{const previous=old.find(x=>x.requirementId===r.id);return el('div',{class:'form-item'},el('h4',{},r.label),paragraph(r.instructions),paragraph('Source '+r.sourceId+' · '+r.locator),
    r.instanceMode==='per_subject'?subjects.map(s=>check('subject:'+r.id+':'+s.id,s.label+' / '+s.role+' ['+s.id+']',previous?.subjectIds.includes(s.id))):paragraph('One case-level instance. Its applicability is recorded on its form.'),
    textArea('reason:'+r.id,'Scope explanation, including any selection of no subjects',previous?.reason||''));});
  $('main').append(card('Explicit full requirement scope',paragraph('Decide the full selected population for every requirement before creating the required form instances. An empty person selection requires an explanation.'),form('setScope:'+c.id,'Review every requirement',[
    fields,textArea('note','Full scope review note')
  ],d=>[{action:'setScope',input:{id:uid('scope'),caseId:c.id,basis:c.assessment.scopeBasis,note:d.note,requirements:ed.requirements.map(r=>({requirementId:r.id,subjectIds:r.instanceMode==='single'?[]:subjects.filter(s=>d['subject:'+r.id+':'+s.id]===true).map(s=>s.id),reason:d['reason:'+r.id]}))}}])));
  const scope=c.assessment.scope;const pending=[];
  if(scope&&c.assessment.scopeCurrent!==false)for(const row of scope.requirements){const r=ed.requirements.find(x=>x.id===row.requirementId);for(const subjectId of r.instanceMode==='single'?[null]:row.subjectIds)if(!S.state.instances.some(i=>i.caseId===c.id&&i.requirementId===r.id&&i.subjectId===subjectId))pending.push({id:uid('instance'),caseId:c.id,requirementId:r.id,subjectId});}
  $('main').append(card('Create the selected form instances',
    paragraph(pending.length+' selected requirement / subject combinations have no form yet.'),
    pending.length?form('addInstances:'+c.id,'Create all missing selected instances',[
      table(['Requirement','Subject'],pending.map(i=>[ed.requirements.find(r=>r.id===i.requirementId).label,subjects.find(s=>s.id===i.subjectId)?.label||'Case-level']))
    ],()=>pending.map(input=>({action:'addInstance',input})),{label:'Create all selected instances'}):paragraph('No missing selected instances.'),
    c.assessment.missing.map(x=>paragraph(x.message,'callout')),
    jsonDetails('Exact current scope and selection basis',scope||{scopeBasis:c.assessment.scopeBasis})));
}
function renderForms(){
  const error=requireCase();if(error){$('main').append(error);return;}const c=caseNow(),assessment=c.assessment;
  if(!assessment.instances.length){$('main').append(card('Forms & evidence',paragraph('Review the full scope and create its selected instances first.'),button('Open scope',()=>go('scope'))));return;}
  const list=el('div',{class:'stack'},assessment.instances.map(i=>button(i.label+' · '+(S.state.subjects.find(s=>s.id===i.subjectId)?.label||'case-level')+' · '+i.status+(i.inScope?'':' · outside current scope'),()=>{S.instanceId=i.id;render();},{dataset:{instanceId:i.id}})));
  const i=assessment.instances.find(x=>x.id===S.instanceId)||assessment.instances[0];S.instanceId=i.id;
  const r=S.state.editions.find(e=>e.id===c.editionId).requirements.find(r=>r.id===i.requirementId);
  const fields=r.fields.map(f=>{const value=own(i.values,f.id)?i.values[f.id]:'';let control;
    if(f.type==='choice')control=select('value:'+f.id,f.label,[['','Choose / blank'],...f.options],value);
    else if(f.type==='boolean')control=select('value:'+f.id,f.label,[['','Choose / blank'],['true','True'],['false','False']],value);
    else if(f.type==='text')control=textArea('value:'+f.id,f.label,value);
    else control=textInput('value:'+f.id,f.label,value,{type:'text',placeholder:f.type==='date'?'YYYY-MM-DD':'',inputMode:['integer','decimal'].includes(f.type)?'decimal':'text'});
    return el('div',{class:'form-item'},check('present:'+f.id,'Record '+f.label+' ('+f.type+(f.required?', required':'')+')',own(i.values,f.id)),control);
  });
  const main=el('div',{},el('h2',{},i.label),paragraph(r.instructions),paragraph('Source '+r.sourceId+' · '+r.locator),badge(i.status),
    paragraph(i.inScope?'Included in the current full scope.':'Retained historical instance outside the current scope.','muted'),
    ...i.issues.map(x=>paragraph(x.message,'callout')),
    form('setInstance:'+i.id,'Complete form and evidence',[
      select('applicability','Applicability',[['pending','Pending decision'],['applies','Applies'],['not_applicable','Not applicable']],i.applicability),
      textArea('reason','Applicability / amendment reason',i.reason),fields,el('h4',{},'Original form / evidence files'),fileChoices('evidence',i.evidenceIds)
    ],d=>{const values={};for(const f of r.fields)if(d['present:'+f.id]===true)values[f.id]=d['value:'+f.id];return[{action:'setInstance',input:{instanceId:i.id,applicability:d.applicability,reason:d.reason,values,evidenceIds:chosen(d,'evidence')}}];}),
    form('reviewInstance:'+i.id,'Review this exact saved form',[
      paragraph('The review binds the saved values, original evidence, case facts and source edition. Save any edited form values before reviewing.','muted'),
      select('outcome','Review outcome',[['accepted','Accepted'],['needs_correction','Needs correction']]),textArea('note','Review explanation')
    ],d=>[{action:'reviewInstance',input:{id:uid('review'),instanceId:i.id,basis:i.basis,...d}}]),
    jsonDetails('All original reviews for this instance',S.state.reviews.filter(x=>x.instanceId===i.id)));
  $('main').append(el('div',{class:'split'},el('section',{},el('h2',{},'Instances'),list),el('section',{},main)));
}
function renderCorrections(){
  const error=requireCase();if(error){$('main').append(error);return;}const c=caseNow(),instances=c.assessment.instances;
  $('main').append(card('Open a correction round',paragraph('Record each issued item against its exact existing form. Retain the original request and literal deadline; an unspecified deadline should say so.'),
    form('openRound:'+c.id,'Complete issued correction request',[
      textInput('reference','Original request reference'),textInput('deadline','Issued deadline and timezone / explicitly unspecified'),textArea('note','Round context'),el('h4',{},'Original request files'),fileChoices('requestFiles'),
      instances.map(i=>el('div',{class:'form-item'},check('include:'+i.id,'Include '+i.label+' ['+i.id+']'),textArea('request:'+i.id,'Complete requested correction'),select('field:'+i.id,'Specific field (optional)',[['','Whole instance'],...S.state.editions.find(e=>e.id===c.editionId).requirements.find(r=>r.id===i.requirementId).fields.map(f=>[f.id,f.label])])),
      summary('Advanced original item identities / multiple items per form',textArea('exactItems','Optional complete items JSON, overriding the selections above','',{class:'code',spellcheck:false})))
    ],d=>[{action:'openRound',input:{id:uid('round'),caseId:c.id,basis:c.assessment.basis,reference:d.reference,deadline:d.deadline,note:d.note,requestFileIds:chosen(d,'requestFiles'),items:d.exactItems.trim()?JSON.parse(d.exactItems):instances.filter(i=>d['include:'+i.id]).map(i=>({id:uid('item'),instanceId:i.id,request:d['request:'+i.id],...(d['field:'+i.id]?{fieldId:d['field:'+i.id]}:{})}))}}])));
  for(const round of c.assessment.rounds){const container=card('Correction '+round.reference,paragraph('Deadline: '+round.deadline+'\n'+round.note));
    for(const item of round.items){const instance=instances.find(i=>i.id===item.instanceId),latest=item.responses.at(-1);
      container.append(el('div',{class:'form-item'},el('h3',{},item.id),paragraph(item.request),badge(item.status),button('Open affected form',()=>{S.instanceId=item.instanceId;go('forms');}),
        form('respond:'+round.id+':'+item.id,'Respond using the current saved form',[
          textArea('message','Complete response'),el('h4',{},'Original response files'),fileChoices('responseFiles')
        ],d=>[{action:'respond',input:{id:uid('response'),roundId:round.id,itemId:item.id,basis:instance.basis,message:d.message,fileIds:chosen(d,'responseFiles')}}]),
        latest?form('decideResponse:'+latest.id,'Review the latest response',[
          paragraph(latest.message),select('outcome','Response decision',[['accepted','Accepted'],['needs_correction','Needs correction']]),textArea('note','Decision explanation')
        ],d=>[{action:'decideResponse',input:{id:uid('decision'),responseId:latest.id,basis:latest.basis,...d}}]):null,
        jsonDetails('Complete request, responses and current decision',item)));
    }$('main').append(container);
  }
}
function renderHandover(){
  const error=requireCase();if(error){$('main').append(error);return;}const c=caseNow(),a=c.assessment;
  $('main').append(card('Review & accepted handover',badge(a.status),paragraph('Handoff acceptance is the named operator’s decision over this complete retained case. Preserve the authority’s actual determination in its original correspondence.'),
    table(['Instance','Current scope','Form review','Outstanding'],a.instances.map(i=>[i.label,i.inScope?'Selected':'Historical',i.status,i.issues.map(x=>x.message).join('\n')])),
    a.missing.map(x=>paragraph(x.message,'callout')),
    form('acceptCase:'+c.id,'Accept the complete current handover',[
      textArea('note','Acceptance scope and explanation'),paragraph(a.reviewComplete?'All current forms and correction items satisfy the saved review contract.':'Complete current scope, form reviews and correction decisions before accepting.','muted')
    ],d=>[{action:'acceptCase',input:{id:uid('acceptance'),caseId:c.id,basis:a.basis,note:d.note}}]),
    jsonDetails('Complete acceptance history',S.state.acceptances.filter(x=>x.caseId===c.id)),
    button('Download complete review and original attachments ZIP',async()=>download('Application_Packet_Review.zip',Portable.zipBytes(Portable.completeFiles(boot.source,await currentRecord())),'application/zip'))));
}
function nativeContractExample(){return[{name:'actual_table',columns:['actual_key','actual_value'],required:['actual_key'],keys:['actual_key'],types:{actual_key:{type:'text'},actual_value:{type:'text'}},references:[]}];}
function renderNative(){
  const error=requireCase();if(error){$('main').append(error);return;}const c=caseNow(),contracts=S.state.nativeContracts.filter(x=>x.caseId===c.id);
  $('main').append(card('Actual native contract',paragraph('Retain the actual target schema or import template, then declare its exact tables, columns, stable keys, types and relationships. No destination is contacted by this offline workspace.'),
    form('addNativeContract:'+c.id,'Add an original native import contract',[
      textInput('title','Contract title'),el('h4',{},'Actual target schema / template files'),fileChoices('contractFiles'),textArea('tables','Exact native tables JSON',Portable.json(nativeContractExample()),{class:'code',spellcheck:false}),textArea('lookups','Actual supplied lookup tables JSON (optional)','[]',{class:'code',spellcheck:false}),textArea('note','Contract interpretation and source note')
    ],d=>[{action:'addNativeContract',input:{id:uid('contract'),caseId:c.id,title:d.title,fileIds:chosen(d,'contractFiles'),tables:JSON.parse(d.tables),lookups:JSON.parse(d.lookups),note:d.note}}])));
  for(const contract of contracts){const example=contract.tables.map(t=>({table:t.name,expectedRows:0,rows:[]}));
    $('main').append(card('Map '+contract.title,
      jsonDetails('Original target contract',contract),
      form('mapNative:'+contract.id,'Save complete mapping and explicit instance coverage',[
        c.assessment.instances.filter(i=>i.inScope).map(i=>el('div',{class:'form-item'},el('h4',{},i.label+' ['+i.id+']'),select('scope:'+i.id,'Native inclusion decision',[['include','Include'],['exclude','Exclude']]),textArea('reason:'+i.id,'Mapping scope explanation'))),
        textArea('tables','All native tables and exact row bindings JSON',Portable.json(example),{class:'code',spellcheck:false}),
        paragraph('Each row has instanceId and columns. Bindings: {kind:"field",fieldId:"..."}, {kind:"literal",value:"..."}, or case_id, instance_id, subject_id, evidence_ids. Keep expectedRows explicit, including zero. Match every declared target table.','muted'),
        textArea('note','Complete mapping explanation')
      ],d=>[{action:'mapNative',input:{id:uid('mapping'),contractId:contract.id,basis:c.assessment.basis,scope:c.assessment.instances.filter(i=>i.inScope).map(i=>({instanceId:i.id,decision:d['scope:'+i.id],reason:d['reason:'+i.id]})),tables:JSON.parse(d.tables),note:d.note}}])));
  }
  for(const m of S.state.nativeMappings.filter(x=>x.caseId===c.id)){let result;try{result=Engine.nativeExport(S.workspace,m.id);}catch(e){$('main').append(card('Mapping '+m.id,paragraph(e.message,'callout'),jsonDetails('Retained mapping',m)));continue;}
    const container=card('Native mapping '+m.id,paragraph(result.ready?'Current accepted case and target rows are ready for the operator’s native import.':'Review the assessment before using this retained export.'),jsonDetails('Complete export assessment',{...result,files:result.files.map(f=>({path:f.path,...sha256Utf8(f.content)}))}),
      table(['File','Bytes','Download'],result.files.map(f=>[f.path,sha256Utf8(f.content).bytes,button('Download exact native CSV',()=>download(Portable.nativeFilename(f.path),f.content,f.mimeType))])),
      paragraph('Native CSV follows the supplied schema exactly. Inspect spreadsheet import settings before opening values beginning with formula characters; the exported bytes are not rewritten.','muted'));
    container.append(form('recordNativeReturn:'+m.id,'Record the actual native result',[
      textInput('reference','Original target run / result reference'),select('outcome','Overall observed outcome',[['accepted','Accepted'],['partial','Partial'],['rejected','Rejected']]),textArea('note','Actual result and reconciliation note'),el('h4',{},'Original native result files'),fileChoices('returnFiles'),
      textArea('records','Complete returned row observations JSON','[]',{class:'code',spellcheck:false}),
      paragraph('Each returned row identifies instanceId, actual table, targetId, outcome and message. Include its exact rowId from the export assessment when an instance has several rows in one table. Preserve exact original target values and attach the physical returned file.','muted')
    ],d=>[{action:'recordNativeReturn',input:{id:uid('native-return'),mappingId:m.id,exportSha256:result.exportSha256,fileIds:chosen(d,'returnFiles'),reference:d.reference,outcome:d.outcome,note:d.note,records:JSON.parse(d.records)}}]));
    container.append(jsonDetails('Retained native return history',(S.state.nativeReturns||[]).filter(r=>r.mappingId===m.id)));$('main').append(container);
  }
}
function renderHistory(){
  const host=el('div');$('main').append(host);const originalKey=S.copyId,originalWorkspace=copy(S.workspace);
  host.append(card('Complete original operation history',
    paragraph('Every saved operation retains its original actor, timestamp, input, prior hash and immutable result hash. Later corrections remain additional operations.'),
    table(['Revision','Action','Actor / time','Original input'],S.workspace.journal.map(e=>[e.sequence,e.action,e.actor+'\n'+e.at,jsonDetails(e.id,e)]))));
  host.append(card('Unfinished forms in this tab',Object.keys(S.drafts).length?Object.entries(S.drafts).map(([name,row])=>jsonDetails(name+' / revision '+row.baseRevision,row)):paragraph('No unfinished values in this tab.')));
  all('drafts').then(rows=>{
    const others=rows.filter(r=>r.copyId===originalKey&&r.tabId!==tabId);
    if(others.length){
      const content=card('Other tabs’ retained unfinished values',paragraph('These copies remain separate. Download them before recovering a closed tab’s writing.'),
        button('Download all retained tab drafts',()=>download('Other_Tab_Drafts.json',Portable.json(others),'application/json')));
      for(const row of others)content.append(summary(row.name+' / '+row.updatedAt,[
        jsonDetails('Original draft',row),
        button('Recover as a separate local copy',async()=>{
          const drafts={[row.name]:{fields:row.fields,baseHead:row.baseHead,baseRevision:row.baseRevision,token:uid('draft'),updatedAt:row.updatedAt}};
          await useCopy(await saveCopy(Portable.recovery(originalWorkspace,drafts),'Recovered other-tab draft'));
        })
      ]));
      host.append(content);
    }buttons();
  }).catch(e=>say(e.message,true));
  all('branches').then(rows=>{
    const selected=rows.filter(x=>x.copyId===originalKey);
    if(selected.length){
      const content=card('Retained conflicting branches');
      for(const c of selected)content.append(summary(c.createdAt,[
        paragraph(c.reason),
        button('Download whole conflict',()=>download(c.key+'.json',Portable.json(c),'application/json')),
        button('Continue candidate as separate copy',async()=>{await useCopy(await saveCopy(Portable.recovery(c.candidate,c.drafts),'Recovered conflict'));})
      ]));
      host.append(content);
    }buttons();
  }).catch(e=>say(e.message,true));
}
channel?.addEventListener('message',event=>{if(event.data.copyId===S.copyId&&event.data.head!==Portable.head(S.workspace))say('Another tab saved this local copy. Your visible values remain unchanged; the next save will preserve both versions if needed.');});
window.addEventListener('beforeunload',event=>{if(S.busy||Object.keys(S.drafts).length){event.preventDefault();event.returnValue='';}});
(async()=>{S.busy=true;buttons();try{
  await claimTabIdentity();S.db=await openDB();
  const embedded=boot.record?Portable.parseRecovery(Portable.json(boot.record)):null;
  if(embedded){
    const rows=await all('copies'),retained=rows.find(r=>r.key===boot.copyId);
    if(retained){
      const comparison=Engine.compareWorkspaces(retained.workspace,embedded.workspace);
      if(['identical','incoming_ancestor'].includes(comparison.relationship)){
        await useCopy(retained.key);await restoreEmbeddedDrafts(embedded.drafts);
        if(comparison.relationship==='incoming_ancestor')say('Reopened the newer saved local workspace. The older embedded edition remains in this original HTML file.');
      }else{
        await useCopy(await saveCopy(embedded,'Independent working HTML edition'));
        say('The embedded edition differs from its saved local copy. Both complete versions are retained independently.');
      }
    }else await useCopy(await saveCopy(embedded,'Opened working HTML',boot.copyId));
    S.section=embedded.selection.section||'workspace';S.caseId=embedded.selection.caseId||S.caseId;S.instanceId=embedded.selection.instanceId||null;
  }else{let key;try{key=sessionStorage.getItem('application-packet-current');}catch{}if(key&&(await all('copies')).some(x=>x.key===key))await useCopy(key);}
  render();
}catch(e){say('Browser storage could not open. Keep this original working file. '+e.message,true);$('main').append(card('Storage is unavailable',paragraph('Open this file in a browser with local storage enabled. Your embedded original workspace remains downloadable.'),boot.record?button('Download embedded recovery JSON',()=>download('Working_Recovery.json',Portable.json(boot.record),'application/json')):null));}
finally{S.busy=false;buttons();}})();
