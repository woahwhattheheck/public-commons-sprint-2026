// MIT. Explicit three-way review of returned worksheets against a selected current edition.
const KINDS=['correctionWorksheetReconciliations','correctionWorksheetReconciliationReviews'];
const SHA=/^[0-9a-f]{64}$/,WORKING='stellar-forge.directory-worksheet-reconciliation-working.v1';
const refKeys=['sourceId','recordId','rowSha256','resourceSha256','memberSha256'];
const clone=x=>JSON.parse(JSON.stringify(x)),enc=encodeURIComponent;
function need(v,m){if(!v)throw new Error(m);}
function object(x){return x!==null&&typeof x==='object'&&!Array.isArray(x);}
function refOf(row){const r={};for(const k of refKeys){need(SHA.test(row?.[k]||''),'Keep the exact '+k+'.');r[k]=row[k];}return r;}
function el(tag,attrs={},children=[]){const n=document.createElement(tag);for(const[k,v]of Object.entries(attrs)){
 if(v===null||v===undefined)continue;if(k==='text')n.textContent=String(v);else if(k==='class')n.className=v;
 else if(['disabled','checked','readOnly'].includes(k))n[k]=!!v;else n.setAttribute(k,String(v));}
 for(const x of [].concat(children))if(x!==null&&x!==undefined)n.append(x instanceof Node?x:document.createTextNode(String(x)));return n;}
const pretty=x=>JSON.stringify(x,null,2),equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function saveJSON(x,name){const text=pretty(x)+'\n';need(new TextEncoder().encode(text).length<=67108864,'Complete working copy exceeds64MiB.');
 const u=URL.createObjectURL(new Blob([text],{type:'application/json'})),a=el('a',{href:u,download:name});a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);}
function validateWorking(v,workspaceId){
 need(object(v)&&v.schema===WORKING&&v.workspaceId===workspaceId,'Choose a complete reconciliation working copy for this workspace.');
 for(const k of ['returnId','currentEditionId','label','actor','note','query','table','reviewLabel','reviewNote'])
  need(typeof v[k]==='string','Keep the complete '+k+'.');
 need(v.predecessorId===null||SHA.test(v.predecessorId||''),'Keep the accepted predecessor or null.');
 if(v.openedReturnId===undefined)v.openedReturnId=SHA.test(v.returnId)?v.returnId:null;if(v.openedEditionId===undefined)v.openedEditionId=SHA.test(v.currentEditionId)?v.currentEditionId:null;
 for(const k of ['openedReturnId','openedEditionId'])need(v[k]===null||SHA.test(v[k]||''),'Keep the exact opened basis identity.');
 if(v.lastResponse===undefined)v.lastResponse=null;
 need(v.lastResponse===null||(object(v.lastResponse)&&['prepare','review','export'].includes(v.lastResponse.action)&&object(v.lastResponse.input)&&SHA.test(v.lastResponse.recordId||'')&&(KINDS.includes(v.lastResponse.kind)||v.lastResponse.kind==='exports')),'Keep the original accepted response identity.');
 need(object(v.bindings)&&object(v.choices)&&object(v.resolutions),'Keep complete bindings, decisions and row resolutions.');
 for(const[k,b]of Object.entries(v.bindings)){need(SHA.test(k)&&object(b)&&b.rowKey===k&&typeof b.reason==='string','Invalid original row binding.');refOf(b.original);if(b.current!==null)refOf(b.current);}
 for(const[k,c]of Object.entries(v.choices))need(SHA.test(k)&&object(c)&&['','accept-proposed','keep-current','resolve-row'].includes(c.decision)&&typeof c.reason==='string','Invalid saved change decision.');
 for(const[k,r]of Object.entries(v.resolutions))need(SHA.test(k)&&object(r)&&['json','csv'].includes(r.representation)&&typeof r.text==='string'&&typeof r.reason==='string','Keep the complete unfinished row editor.');
 need((v.openKind===null&&v.openId===null)||(KINDS.includes(v.openKind)&&SHA.test(v.openId||'')),'Keep one complete record selection.');
 if(v.pending!==null)need(object(v.pending)&&['prepare','review','export'].includes(v.pending.action)&&object(v.pending.input),'Keep the complete original pending request.');
 need(new TextEncoder().encode(pretty(v)+'\n').length<=67108864,'Complete working copy exceeds64MiB.');return v;
}
export function mountDirectoryWorksheetReconciliation({root,api,download,readCompleteFile,getState,notify=()=>{},openCorrection=()=>{}}){
 need(root&&api&&download&&readCompleteFile&&getState,'Use the original Directory operator and full-file transport.');
 const S={workspaceId:null,busy:false,disposed:false,dirty:false,error:'',message:'',storageError:'',
  returnId:'',returnRecord:null,worksheet:null,currentEditionId:'',edition:null,label:'',actor:'',note:'',predecessorId:null,
  bindings:{},query:'',table:'',matchingRow:null,currentPage:null,currentOffset:0,originalOffset:0,
  reviewLabel:'',reviewNote:'',choices:{},resolutions:{},openKind:null,openId:null,record:null,
  changePage:null,changeOffset:0,completeChanges:null,comparisonRows:null,pending:null,lastResponse:null,retainedRaw:null,
  view:'prepare',libraryKind:KINDS[0],libraryPage:null};
 let generation=0;
 function current(g=generation){if(S.disposed||g!==generation){const e=new Error('Three-way review closed; reopen its retained original request.');e.name='AbortError';throw e;}}
 async function observed(fn){const g=generation;current(g);const r=await fn();current(g);return r;}
 const oa=api,od=download,of=readCompleteFile;api=(...a)=>observed(()=>oa(...a));download=(...a)=>observed(()=>od(...a));readCompleteFile=(...a)=>observed(()=>of(...a));
 const path=(...p)=>'/api/directory/'+p.map(enc).join('/'),key=()=> 'directory.reconciliation.working.'+S.workspaceId;
 function working(){return {schema:WORKING,workspaceId:S.workspaceId,openedReturnId:S.returnRecord?.id||null,openedEditionId:S.edition?.id||null,...Object.fromEntries(['returnId','currentEditionId','label','actor','note','predecessorId','bindings','query','table','reviewLabel','reviewNote','choices','resolutions','openKind','openId','pending','lastResponse'].map(k=>[k,clone(S[k])]))};}
 function persist(){if(S.disposed||!S.workspaceId||S.retainedRaw!==null)return;try{sessionStorage.setItem(key(),JSON.stringify(working()));S.storageError='';}catch{S.storageError='Browser storage is full. Download the complete working copy before leaving.';}}
 function changed(){current();S.dirty=true;persist();}
 function writable(){need(S.retainedRaw===null,'Recover or explicitly replace the complete retained working copy first.');need(!S.pending,'Reconcile the exact pending request before changing this working copy.');}
 function freeze(){root.querySelectorAll('button,input,textarea,select').forEach(n=>n.disabled=true);}
 async function task(fn){if(S.busy||S.disposed)return;const g=generation;S.busy=true;S.error='';freeze();
  try{return await fn();}catch(e){if(!S.disposed&&g===generation&&e.name!=='AbortError'){S.error=e.message;notify(e.message,'error');}}
  finally{if(!S.disposed&&g===generation){S.busy=false;persist();render();}}}
 function button(text,fn,test,{write=false}={}){const b=el('button',{type:'button','data-testid':test,disabled:S.busy||(write&&(!!S.pending||S.retainedRaw!==null))},text);b.onclick=()=>task(async()=>{if(write)writable();return fn();});return b;}
 function field(label,value,set,{test,multiline=false,readonly=false}={}){
  const n=el(multiline?'textarea':'input',{'data-testid':test,value:multiline?undefined:value,rows:multiline?5:undefined,readOnly:readonly,disabled:S.busy||!!S.pending||S.retainedRaw!==null});
  if(multiline)n.value=value;n.oninput=()=>{if(S.busy||S.disposed||S.pending||S.retainedRaw!==null)return;set(n.value);changed();};return el('label',{class:'dws-field'},[el('span',{},label),n]);}
 function select(label,value,options,set,test){const n=el('select',{'data-testid':test,disabled:S.busy||!!S.pending});
  for(const[v,t]of options)n.append(el('option',{value:v},t));n.value=value;
  n.onchange=()=>{if(S.busy||S.disposed||S.pending||S.retainedRaw!==null)return;set(n.value);changed();render();};return el('label',{class:'dws-field'},[el('span',{},label),n]);}
 function panel(title,children=[]){return el('section',{class:'dws-panel'},[el('h2',{},title),...children]);}
 function details(label,value){return el('details',{},[el('summary',{},label),el('pre',{},typeof value==='string'?value:pretty(value))]);}
 function pager(p,load){if(!p)return el('div');return el('div',{class:'dws-actions'},[
  el('span',{},p.total+' rows · '+p.offset+'–'+(p.offset+p.rows.length)),
  ...(p.offset?[button('Previous',()=>load(Math.max(0,p.offset-p.limit)))]:[]),
  ...(p.nextOffset!==null?[button('Next',()=>load(p.nextOffset))]:[])]);}
 async function page(url,check=()=>{}){const p=await api(url);need(Array.isArray(p.rows)&&Number.isSafeInteger(p.total)&&p.total>=0&&Number.isSafeInteger(p.offset)&&p.offset>=0&&Number.isSafeInteger(p.limit)&&p.limit>=1&&p.limit<=250&&p.rows.length<=p.limit,'Invalid complete native page.');
  const end=p.offset+p.rows.length;need(end<=p.total&&(p.nextOffset===null?end===p.total:p.rows.length>0&&p.nextOffset===end&&end<p.total),'Native page omitted rows.');
  if(p.bytes!==undefined)need(Number.isSafeInteger(p.bytes)&&p.bytes>=0&&p.bytes<=p.byteBudget&&p.byteBudget===4194304,'Native page exceeds its complete-byte budget.');check(p);return p;}
 function assertDocument(d,id){need(d&&d.worksheetId===id&&Array.isArray(d.rows)&&d.rows.length<=10000,'Complete original worksheet document changed.');
  const seen=new Set();for(const r of d.rows){need(SHA.test(r.rowKey||'')&&!seen.has(r.rowKey)&&['json','csv'].includes(r.representation),'Original worksheet row identity is invalid.');seen.add(r.rowKey);refOf(r.ref);}}
 async function readReturn(id){need(SHA.test(id),'Select the exact returned worksheet.');const r=await api(path('correctionWorksheetReturns',id));need(r.id===id&&r.workspaceId===S.workspaceId,'Original return identity changed.');
  const d=await api(path('correctionWorksheets',r.worksheetId,'document'));assertDocument(d,r.worksheetId);need(d.workspaceId===S.workspaceId&&d.editionId===r.editionId,'The worksheet document differs from the returned original basis.');return {r,d};}
 async function openReturn(id,{restore=false}={}){writable();if(!restore&&S.dirty&&!confirm('Replace the current authoring draft? Its saved records remain available.'))return;
  const {r,d}=await readReturn(id);S.returnId=id;S.returnRecord=r;S.worksheet=d;S.originalOffset=0;S.matchingRow=null;S.view='prepare';
  if(!restore){S.bindings={};for(const row of d.rows)S.bindings[row.rowKey]={rowKey:row.rowKey,original:refOf(row.ref),current:null,reason:''};S.label='Three-way review: '+(d.label||id);S.predecessorId=null;changed();}}
 async function loadEdition(id){writable();need(SHA.test(id),'Select an exact current edition.');
  if(Object.values(S.bindings).some(b=>b.current)&&id!==S.edition?.id)throw new Error('Clear existing current-row matches before changing the current edition.');
  const r=await api(path('editions',id));need(r.id===id&&Array.isArray(r.sourceIds),'Current edition identity changed.');S.currentEditionId=id;S.edition=r;S.currentPage=null;changed();}
 async function loadCurrentRows(offset=0){need(S.edition?.id===S.currentEditionId,'Open the selected current edition.');
  const q=new URLSearchParams({offset:String(offset),limit:'25',query:S.query});if(S.table)q.set('table',S.table);S.currentPage=await page(path('editions',S.currentEditionId,'rows')+'?'+q);S.currentOffset=offset;}
 async function selectCurrent(row){writable();need(S.matchingRow&&S.edition?.id===S.currentEditionId,'Choose the original row to match and open the current edition.');
  const full=await api(path('editions',S.currentEditionId,'rows',row.sourceId,row.recordId));need(full.protocol==='hsds','Match a complete HSDS row, including a derived capture.');
  const binding=S.bindings[S.matchingRow];need(binding,'Keep the original worksheet row.');binding.current=refOf(full);changed();}
 function prepareInput(){need(S.returnRecord?.id===S.returnId&&S.worksheet&&S.edition?.id===S.currentEditionId,'Open the exact original return and current edition.');
  need(S.label.trim()&&S.actor.trim(),'Supply a review label and actor.');const bindings=S.worksheet.rows.map(r=>{const b=S.bindings[r.rowKey];need(b&&equal(b.original,refOf(r.ref))&&b.reason.trim(),'Give every original row an explicit match or unbound reason.');return clone(b);});
  need(Object.keys(S.bindings).length===bindings.length,'Keep exactly one binding for every worksheet row.');return {label:S.label,actor:S.actor,returnId:S.returnId,currentEditionId:S.currentEditionId,predecessorId:S.predecessorId,bindings,note:S.note};}
 async function openRecord(kind,id,{accepted=false}={}){need(KINDS.includes(kind)&&SHA.test(id),'Select a complete reconciliation record.');
  if(!accepted&&S.openId!==id&&(Object.keys(S.choices).length||Object.keys(S.resolutions).length)&&S.dirty&&!confirm('Replace these working decisions? Save the complete working copy to retain them.'))return null;
  const r=await api(path(kind,id));need(r.id===id&&r.workspaceId===S.workspaceId,'Reconciliation record identity changed.');
  if(S.openId!==id){S.choices={};S.resolutions={};S.reviewLabel='Review: '+(r.label||id);}
  S.openKind=kind;S.openId=id;S.record=r;S.changeOffset=0;S.changePage=null;S.completeChanges=null;S.comparisonRows=null;S.view='review';await readChanges(0);return r;}
 async function readChanges(offset=0){need(S.record,'Open a reconciliation record.');
  if(S.completeChanges){const rows=S.completeChanges.slice(offset,offset+25);S.changePage={kind:S.openKind,recordId:S.openId,rows,total:S.completeChanges.length,offset,limit:25,nextOffset:offset+rows.length<S.completeChanges.length?offset+rows.length:null};}
  else S.changePage=await page(path(S.openKind,S.openId,'rows')+'?offset='+offset+'&limit=25',p=>need(p.kind===S.openKind&&p.recordId===S.openId,'Native reconciliation page identity changed.'));S.changeOffset=offset;}
 async function jsonl(kind,id,fileKind,descriptor,total){const file=await readCompleteFile(path(kind,id,'files',fileKind),descriptor),text=await observed(()=>file.blob.text()),lines=text.split('\n');if(lines.at(-1)==='')lines.pop();
  need(lines.every(Boolean),'Complete JSONL contains an empty record.');const rows=lines.map(x=>JSON.parse(x));need(rows.length===total,'Complete retained file count changed.');return rows;}
 async function completeChanges(){if(S.completeChanges)return S.completeChanges;need(S.record,'Open the immutable reconciliation.');
  const fileKind=S.openKind===KINDS[0]?'comparison':'decisions',rows=await jsonl(S.openKind,S.openId,fileKind,S.record.files[fileKind],S.record.summary.changes),seen=new Set();
  for(const row of rows){need(SHA.test(row.changeId||'')&&!seen.has(row.changeId),'Complete comparison contains an invalid or duplicate change.');seen.add(row.changeId);}
  S.completeChanges=rows;return rows;}
 async function loadFull(){await completeChanges();await readChanges(0);S.message='Complete original comparison file received and verified. Every change is available.';}
 async function originalRows(){need(S.openKind===KINDS[0],'Open a prepared three-way review.');
  if(!S.comparisonRows)S.comparisonRows=await jsonl(S.openKind,S.openId,'rows',S.record.files.rows,S.record.summary.rows);return S.comparisonRows;}
 async function resolveRow(rowKey){writable();need(S.openKind===KINDS[0],'Open the prepared reconciliation.');
  const rows=await originalRows(),row=rows.find(x=>x.rowKey===rowKey);need(row?.current&&row.binding.current,'Unbound rows cannot replace current data.');
  const full=row.current,rep=row.current.representation;need(['json','csv'].includes(rep),'Keep the original row representation.');
  if(!S.resolutions[rowKey])S.resolutions[rowKey]={representation:rep,text:rep==='json'?full.valueJson:pretty(full.cells),reason:''};
  need(typeof S.resolutions[rowKey].text==='string','The current complete row does not have this representation.');
  const changes=await completeChanges();for(const c of changes.filter(x=>x.rowKey===rowKey)){S.choices[c.changeId]??={decision:'',reason:''};S.choices[c.changeId].decision='resolve-row';}changed();}
 function allowed(c){if(c.state==='unbound')return [['','Choose'],['keep-current','Keep current']];
  if(c.state==='structure-conflict')return [['','Choose'],['keep-current','Keep current'],['resolve-row','Resolve complete row']];
  return [['','Choose'],['accept-proposed',c.state==='already-applied'?'Accept proposal (already present)':'Accept proposal'],['keep-current','Keep current'],['resolve-row','Resolve complete row']];}
 async function reviewInput(){need(S.openKind===KINDS[0]&&S.record&&S.reviewLabel.trim()&&S.actor.trim(),'Open a prepared reconciliation and supply label and actor.');
  const changes=await completeChanges(),choices=changes.map(c=>{const x=S.choices[c.changeId];need(x&&allowed(c).some(([v])=>v===x.decision)&&x.decision&&x.reason.trim(),'Choose and explain every change.');return {changeId:c.changeId,decision:x.decision,reason:x.reason};});
  const grouped=new Map();for(const c of changes){if(!grouped.has(c.rowKey))grouped.set(c.rowKey,[]);grouped.get(c.rowKey).push(c);}
  const rowResolutions=[];for(const[rowKey,rows]of grouped){const selected=rows.filter(c=>S.choices[c.changeId].decision==='resolve-row');if(!selected.length)continue;
   need(selected.length===rows.length,'Resolve every change of a row together, or use only individual decisions.');const r=S.resolutions[rowKey];need(r&&r.reason.trim(),'Open the full current-row editor and explain its resolution.');
   if(r.representation==='json'){need(r.text.trim(),'Keep a complete lexical JSON object.');rowResolutions.push({rowKey,representation:'json',valueJson:r.text,reason:r.reason});}
   else{const cells=JSON.parse(r.text);need(Array.isArray(cells)&&cells.every(x=>typeof x==='string'),'CSV resolution requires every physical cell as text.');rowResolutions.push({rowKey,representation:'csv',cells,reason:r.reason});}}
  return {label:S.reviewLabel,actor:S.actor,reconciliationId:S.openId,choices,rowResolutions,note:S.reviewNote};}
 async function perform(action,input){const wanted={action,input:clone(input)};if(S.pending)need(equal(S.pending,wanted),'Reconcile the original pending request before another write.');else{S.pending=wanted;persist();}
  const r=await api(path('correction-worksheet-reconciliations',action),{method:'POST',body:input});need(object(r)&&SHA.test(r.id||''),'Native operation returned no immutable record.');
  S.lastResponse={...wanted,recordId:r.id,kind:action==='prepare'?KINDS[0]:action==='review'?KINDS[1]:'exports'};persist();S.pending=null;persist();
  if(action==='export'){await download(path('exports',r.id,'file'));S.message='Complete reconciliation packet retained.';}
  else{await openRecord(action==='prepare'?KINDS[0]:KINDS[1],r.id,{accepted:true});S.message=action==='review'?(r.planId?'Reviewed decisions prepared a correction plan on the selected current edition. Preview and acceptance remain separate.':'No edits selected. No correction plan was created.'):'Three-way comparison retained.';S.dirty=false;}
  return r;}
 function atom(title,v){let text;if(v===null)text='Unknown — current structure cannot be selected safely';else if(!v?.present)text='Absent';else text=v.valueJson??'(No lexical value)';
  return el('section',{class:'dwrc-value'},[el('h4',{},title),el('p',{},v===null?'Unknown':v.present?'Present · '+(v.type||'value'):'Absent'),el('pre',{},text)]);}
 function bindingView(row){const b=S.bindings[row.rowKey];return el('section',{class:'dwrc-row','data-row-key':row.rowKey},[
  el('h3',{},row.table+' · '+(row.nativeId??row.rowOrdinal??row.rowKey)),
  el('div',{class:'dwrc-binding'},[details('Original complete row',row),el('span',{},'→'),details(b.current?'Selected current row':'Explicitly unbound',b.current)]),
  field('Why this match, or why unbound',b.reason,v=>b.reason=v,{test:'dwrc-binding-reason-'+row.rowKey,multiline:true}),
  el('div',{class:'dws-actions'},[button('Match current row',async()=>{S.matchingRow=row.rowKey;S.view='prepare';await loadCurrentRows(0);},'dwrc-match-'+row.rowKey,{write:true}),
   button('Keep row unbound',()=>{b.current=null;changed();},'dwrc-unbound-'+row.rowKey,{write:true})])]);}
 function prepareView(){const p=[];p.push(panel('Original customer return',[
  field('Returned worksheet',S.returnId,v=>S.returnId=v,{test:'dwrc-return-id'}),button('Open returned worksheet',()=>openReturn(S.returnId),'dwrc-open-return',{write:true}),
  ...(S.returnRecord?[details('Original return',S.returnRecord)]:[])]));
  p.push(panel('Current edition',[
   field('Current edition',S.currentEditionId,v=>S.currentEditionId=v,{test:'dwrc-current-edition'}),
   button('Open current edition',()=>loadEdition(S.currentEditionId),'dwrc-open-edition',{write:true}),
   ...(S.edition?[details('Selected complete edition',S.edition)]:[]),
   button('Clear all current matches',()=>{if(!confirm('Clear every current-row match and its reason? Original worksheet rows remain selected.'))return;for(const b of Object.values(S.bindings)){b.current=null;b.reason='';}S.matchingRow=null;S.currentPage=null;changed();S.message='All original rows are retained and explicitly unbound; supply new match reasons before preparing.';},'dwrc-clear-matches',{write:true}),
   field('Label',S.label,v=>S.label=v,{test:'dwrc-label'}),field('Actor',S.actor,v=>S.actor=v,{test:'dwrc-actor'}),
   field('Accepted correction predecessor (optional)',S.predecessorId||'',v=>S.predecessorId=v||null,{test:'dwrc-predecessor'}),
   field('Note',S.note,v=>S.note=v,{test:'dwrc-note',multiline:true})]));
  if(S.worksheet){const rows=S.worksheet.rows.slice(S.originalOffset,S.originalOffset+25),pgr={rows,total:S.worksheet.rows.length,offset:S.originalOffset,limit:25,nextOffset:S.originalOffset+rows.length<S.worksheet.rows.length?S.originalOffset+rows.length:null};
   p.push(panel('Match every original row',[
    el('p',{},'Choose the exact current row or leave the row explicitly unbound with a reason. Every original worksheet row is retained, including rows omitted from the returned proposal.'),
    pager(pgr,n=>{S.originalOffset=n;}),...rows.map(bindingView),pager(pgr,n=>{S.originalOffset=n;})]));}
  if(S.matchingRow)p.push(panel('Choose current row',[
   el('p',{},'Matching original row '+S.matchingRow),
   field('Search',S.query,v=>S.query=v,{test:'dwrc-query'}),field('Table',S.table,v=>S.table=v,{test:'dwrc-table'}),
   button('Search current edition',()=>loadCurrentRows(0),'dwrc-search'),pager(S.currentPage,loadCurrentRows),
   ...(S.currentPage?.rows||[]).map(r=>el('section',{class:'dwrc-row'},[el('strong',{},r.table+' · '+(r.nativeId??r.rowOrdinal??r.recordId)),details('Exact current row reference',r),
    (()=>{const b=button('Select current row',()=>selectCurrent(r),'dwrc-select-'+r.recordId,{write:true});b.dataset.currentSourceId=r.sourceId;b.dataset.currentRecordId=r.recordId;return b;})()])),pager(S.currentPage,loadCurrentRows)]));
  p.push(panel('Prepare three-way review',[button('Prepare three-way review',()=>perform('prepare',prepareInput()),'dwrc-prepare',{write:true})]));return p;}
 function changeView(c){const saved=S.openKind===KINDS[1],choice=S.choices[c.changeId]??{decision:'',reason:''};if(!saved)S.choices[c.changeId]=choice;
  const nodes=[el('h3',{},c.originalChange?.table+' · '+(c.pointer??(c.column!==undefined?'Physical column '+c.column:'Complete row'))),
   el('p',{class:'dwrc-status'},c.state),...(c.blocker?[el('p',{},c.blocker)]:[]),
   el('div',{class:'dwrc-values'},[atom('Base',c.base),atom('Customer proposal',c.proposed),atom('Current',c.current)]),
   el('p',{},'Customer reason: '+c.customerReason),el('p',{},'Row match: '+c.bindingReason),details('Original references and interpretation',c)];
  if(saved)nodes.push(el('p',{},'Decision: '+c.decision),el('p',{},'Reviewer reason: '+c.reviewerReason),...(c.resolution?[details('Complete row resolution',c.resolution)]:[]));
  else nodes.push(el('div',{class:'dwrc-choice'},[select('Decision',choice.decision,allowed(c),v=>choice.decision=v,'dwrc-decision-'+c.changeId),
   field('Operator reason',choice.reason,v=>choice.reason=v,{test:'dwrc-reason-'+c.changeId,multiline:true})]),
   ...(c.currentRef?[button('Resolve complete current row',()=>resolveRow(c.rowKey),'dwrc-resolve-row-'+c.rowKey,{write:true})]:[]));
  return el('section',{class:'dwrc-row','data-change-id':c.changeId,'data-change-state':c.state},nodes);}
 function resolutionView(rowKey,r){return panel('Complete current-row resolution',[
  el('p',{},'Row '+rowKey+'. Every change of this row must use Resolve complete row. The full replacement targets the explicitly selected current row.'),
  field(r.representation==='json'?'Complete lexical JSON object':'Every physical CSV cell (JSON array of strings)',r.text,v=>r.text=v,{test:'dwrc-resolution-'+rowKey,multiline:true}),
  field('Why replace this complete row',r.reason,v=>r.reason=v,{test:'dwrc-resolution-reason-'+rowKey,multiline:true}),
  button('Remove row resolution',()=>{delete S.resolutions[rowKey];changed();},'dwrc-remove-resolution-'+rowKey,{write:true})]);}
 function reviewView(){if(!S.record)return [panel('Three-way review',[el('p',{},'Prepare a comparison or open one from History.')])];
  const r=S.record,nodes=[panel(S.openKind===KINDS[0]?'Base, customer proposal and current':'Saved reconciliation review',[
   el('h3',{},r.label),details('Complete immutable record',r),details('Counts',r.summary),
   el('div',{class:'dws-actions'},[
    button('Receive complete comparison file',loadFull,'dwrc-full-file'),
    ...Object.keys(r.files||{}).map(k=>button('Download '+k,()=>download(path(S.openKind,S.openId,'files',k)),'dwrc-download-'+k)),
    button('Export complete reconciliation',()=>perform('export',{reconciliationId:S.openKind===KINDS[0]?r.id:r.reconciliationId,reviewId:S.openKind===KINDS[1]?r.id:null,actor:S.actor,label:r.label,note:''}),'dwrc-export',{write:true})])])];
  if(S.openKind===KINDS[0])nodes.push(panel('Explicit decisions',[
   field('Review label',S.reviewLabel,v=>S.reviewLabel=v,{test:'dwrc-review-label'}),field('Actor',S.actor,v=>S.actor=v,{test:'dwrc-review-actor'}),
   field('Review note',S.reviewNote,v=>S.reviewNote=v,{test:'dwrc-review-note',multiline:true}),
   el('p',{},'Choose every change. Accept proposal applies against the selected current value; already-applied proposals create no edit. Structural conflicts require keeping current or an explicit complete-row replacement.')]));
  nodes.push(panel('Changes',[pager(S.changePage,readChanges),...(S.changePage?.rows||[]).map(changeView),pager(S.changePage,readChanges)]));
  if(S.openKind===KINDS[0]){nodes.push(...Object.entries(S.resolutions).map(([k,v])=>resolutionView(k,v)));
   nodes.push(panel('Save explicit review',[button('Prepare reviewed correction plan',async()=>perform('review',await reviewInput()),'dwrc-save-review',{write:true})]));}
  if(S.openKind===KINDS[1]&&r.planId)nodes.push(panel('Correction plan',[el('p',{},'The plan is based on the selected current edition. Open it for a separate preview and acceptance.'),
   button('Open correction plan',()=>observed(()=>openCorrection(r.planId)),'dwrc-open-plan')]));
  return nodes;}
 async function loadLibrary(offset=0){S.libraryPage=await page(path(S.libraryKind)+'?offset='+offset+'&limit=25');S.view='history';}
 function historyView(){return [panel('History',[
  select('Records',S.libraryKind,KINDS.map(k=>[k,k===KINDS[0]?'Prepared comparisons':'Saved reviews']),v=>{S.libraryKind=v;S.libraryPage=null;},'dwrc-history-kind'),
  button('Read history',()=>loadLibrary(0),'dwrc-read-history'),pager(S.libraryPage,loadLibrary),
  ...(S.libraryPage?.rows||[]).map(r=>el('section',{class:'dwrc-row'},[el('strong',{},r.label||r.id),details('Saved record',r),
   button('Open',()=>openRecord(S.libraryKind,r.id),'dwrc-open-'+r.id)])),pager(S.libraryPage,loadLibrary)])];}
 async function restoreWorking(v){validateWorking(v,S.workspaceId);if(S.pending)need(equal(v.pending,S.pending),'The original uncertain request must remain unchanged.');
  let source=null,edition=null,record=null;
  if(v.openedReturnId)source=await readReturn(v.openedReturnId);
  if(v.openedEditionId){edition=await api(path('editions',v.openedEditionId));need(edition.id===v.openedEditionId,'Current edition identity changed.');}
  if(source){const keys=new Set(source.d.rows.map(r=>r.rowKey));need(Object.keys(v.bindings).length===keys.size,'Working copy must bind every original row.');
   for(const row of source.d.rows)need(v.bindings[row.rowKey]&&equal(v.bindings[row.rowKey].original,refOf(row.ref)),'Working copy changed an original row reference.');}
  if(v.openId){record=await api(path(v.openKind,v.openId));need(record.id===v.openId&&record.workspaceId===S.workspaceId,'Saved comparison identity changed.');}
  let restoredPage=null,pageError='';if(record){try{restoredPage=await page(path(v.openKind,v.openId,'rows')+'?offset=0&limit=25',p=>need(p.kind===v.openKind&&p.recordId===v.openId,'Saved comparison page identity changed.'));}catch(e){if(e.name==='AbortError')throw e;pageError=e.message;}}
  for(const k of Object.keys(working()))if(!['schema','workspaceId','openedReturnId','openedEditionId'].includes(k))S[k]=clone(v[k]);
  S.returnRecord=source?.r||null;S.worksheet=source?.d||null;S.edition=edition;S.record=record;S.completeChanges=null;S.comparisonRows=null;S.currentPage=null;S.changePage=null;
  S.view=record?'review':'prepare';S.changePage=restoredPage;if(pageError)S.error=pageError+' Use the complete original file or retry the page.';S.dirty=true;S.retainedRaw=null;persist();}
 function render(){if(S.disposed)return;root.replaceChildren();root.className='dws dwrc-workbench';root.dataset.reconciliationReady='true';
  root.dataset.reconciliationRecordId=S.openId||'';root.dataset.reconciliationRecordKind=S.openKind||'';
  root.append(el('header',{},[el('h1',{},'Three-way review'),el('p',{},'Reconcile a returned worksheet with an explicitly selected current edition. Preserve the original proposal and choose each result.')]));
  if(S.error)root.append(el('p',{role:'alert',class:'dws-message'},S.error));if(S.message)root.append(el('p',{role:'status',class:'dws-message'},S.message));if(S.storageError)root.append(el('p',{role:'alert'},S.storageError));
  const upload=el('input',{type:'file',accept:'.json,application/json','data-testid':'dwrc-working-import',disabled:S.busy});upload.onchange=()=>task(async()=>{const file=upload.files?.[0];if(!file)return;need(file.size<=67108864,'Working copy exceeds64MiB.');const value=JSON.parse(await observed(()=>file.text()));validateWorking(value,S.workspaceId);if(S.dirty&&!confirm('Replace this working draft with the validated complete working copy?'))return;await restoreWorking(value);});
  root.append(el('nav',{class:'dws-actions'},[
   button('Match rows',()=>{S.view='prepare';},'dwrc-view-prepare'),button('Review',()=>{S.view='review';},'dwrc-view-review'),
   button('History',()=>loadLibrary(0),'dwrc-view-history'),
   button('Save working copy',()=>{persist();saveJSON(working(),'Directory_Three_Way_Review_Working.json');},'dwrc-save-working'),el('label',{},['Restore working copy',upload])]));
  if(S.retainedRaw!==null)root.append(panel('Retained working copy needs recovery',[
   el('p',{},'The complete saved text is preserved. Authoring remains paused until it can be reopened or explicitly replaced.'),
   button('Retry original working copy',()=>restoreWorking(JSON.parse(S.retainedRaw)),'dwrc-retry-working'),
   button('Download original working copy',()=>{const u=URL.createObjectURL(new Blob([S.retainedRaw],{type:'application/json'})),a=el('a',{href:u,download:'Directory_Three_Way_Review_Original_Working.json'});a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);},'dwrc-download-original-working')]));
  if(S.lastResponse)root.append(panel('Last accepted native response',[
   details('Exact accepted request and record',S.lastResponse),
   button('Reopen accepted response',()=>S.lastResponse.kind==='exports'?download(path('exports',S.lastResponse.recordId,'file')):openRecord(S.lastResponse.kind,S.lastResponse.recordId,{accepted:true}),'dwrc-reopen-accepted')]));
  if(S.pending)root.append(panel('Original request awaiting reconciliation',[el('p',{},'This exact request remains retained. Resume it before authoring another request.'),details('Pending request',S.pending),
   button('Resume exact pending request',()=>perform(S.pending.action,clone(S.pending.input)),'dwrc-resume-pending')]));
  root.append(...(S.view==='prepare'?prepareView():S.view==='history'?historyView():reviewView()));if(S.busy)freeze();}
 async function open(){const state=await observed(()=>getState());need(state?.directory?.workspaceId,'Open the original Directory workspace.');S.workspaceId=state.directory.workspaceId;S.actor=state.operatingActor||'';
  const saved=sessionStorage.getItem(key());if(saved){S.retainedRaw=saved;try{await restoreWorking(JSON.parse(saved));}catch(e){S.error='Retained working copy could not be reopened: '+e.message;}}
  render();}
 const unload=e=>{persist();if(S.dirty||S.pending||S.busy){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',unload);
 return {open:()=>task(open),openReturn:id=>task(()=>openReturn(id)),openRecord:(kind,id)=>task(()=>openRecord(kind,id)),
  busy:()=>S.busy,dirty:()=>S.dirty||!!S.pending,working:()=>clone(working()),dispose:()=>{persist();S.disposed=true;generation++;window.removeEventListener('beforeunload',unload);}};
}
