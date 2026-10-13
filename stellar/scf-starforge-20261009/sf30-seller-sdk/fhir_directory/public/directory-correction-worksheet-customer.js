/* MIT. Complete offline Directory correction worksheet; original source is read-only. */
(() => {
'use strict';
const WORKING='stellar-forge.directory-correction-worksheet-working.v1';
const RETURN='stellar-forge.directory-correction-worksheet-return.v1';
const SHA=/^[0-9a-f]{64}$/,MAX_RETURN=33554432,MAX_VALUE=16777216;
const root=document.getElementById('worksheet-editor'),clone=v=>JSON.parse(JSON.stringify(v));
const size=v=>new TextEncoder().encode(typeof v==='string'?v:JSON.stringify(v)).length;
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
function need(v,m){if(!v)throw new Error(m);}

function completeObject(text){
 const value=JSON.parse(text);need(object(value),'Keep a complete JSON object.');
 let at=0;
 const ws=()=>{while(/\s/.test(text[at]||'')&&at<text.length)at++;};
 const string=()=>{const start=at++;while(at<text.length){const ch=text[at++];if(ch==='\\')at++;else if(ch==='"')return JSON.parse(text.slice(start,at));}throw new Error('Incomplete JSON string.');};
 const scan=()=>{
  ws();const ch=text[at];
  if(ch==='{'){
   at++;ws();const keys=new Set();if(text[at]==='}'){at++;return;}
   while(true){ws();const key=string();need(!keys.has(key),'Duplicate JSON object key: '+key);keys.add(key);ws();at++;scan();ws();if(text[at++]==='}')return;}
  }else if(ch==='['){
   at++;ws();if(text[at]===']'){at++;return;}while(true){scan();ws();if(text[at++]===']')return;}
  }else if(ch==='"')string();
  else{const m=/^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/.exec(text.slice(at));need(m,'Keep complete JSON values.');at+=m[0].length;}
 };
 scan();ws();need(at===text.length,'Keep one complete JSON object.');return value;
}

function node(tag,props={},children=[]){
 const e=document.createElement(tag);
 for(const[k,v]of Object.entries(props)){if(v===null||v===undefined)continue;if(k==='text')e.textContent=v;else if(k==='class')e.className=v;else if(k==='disabled')e.disabled=!!v;else e.setAttribute(k,String(v));}
 for(const c of [].concat(children))if(c!==undefined&&c!==null)e.append(c instanceof Node?c:document.createTextNode(String(c)));
 return e;
}
function details(label,value){return node('details',{},[node('summary',{},label),node('pre',{},typeof value==='string'?value:JSON.stringify(value,null,2))]);}
const serialized=value=>JSON.stringify(value,null,2)+'\n';
function saveFile(value,name){
 const content=serialized(value),maximum=value.schema===RETURN?MAX_RETURN:67108864;
 need(size(content)<=maximum,'The complete downloaded file exceeds its declared byte limit.');
 const url=URL.createObjectURL(new Blob([content],{type:'application/json'}));
 const link=node('a',{href:url,download:name});document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
let W,byKey;
try{
 W=JSON.parse(document.getElementById('original-worksheet').textContent);
 need(object(W)&&W.schema==='stellar-forge.directory-correction-worksheet.v1','The complete original worksheet is unavailable.');
 need(typeof W.workspaceId==='string'&&SHA.test(W.worksheetId)&&SHA.test(W.editionId),'The original worksheet identity is incomplete.');
 need(Array.isArray(W.rows)&&W.rows.length>0&&W.rows.length<=10000,'Keep every selected original worksheet row.');
 byKey=new Map();
 for(const row of W.rows){
  need(object(row)&&SHA.test(row.rowKey)&&!byKey.has(row.rowKey)&&object(row.ref),'The original worksheet row identity is invalid or repeated.');
  for(const k of ['sourceId','recordId','rowSha256','resourceSha256','memberSha256'])need(SHA.test(row.ref[k]||''),'Keep the original row '+k+'.');
  need(['json','csv'].includes(row.representation),'The original row representation is unsupported.');
  if(row.representation==='json')need(typeof row.valueJson==='string'&&object(completeObject(row.valueJson)),'Keep the original complete lexical JSON object.');
  else need(Array.isArray(row.cells)&&row.cells.every(v=>typeof v==='string')&&Array.isArray(row.headers)&&row.headers.every(v=>typeof v==='string'),'Keep original physical CSV headers and cells.');
  byKey.set(row.rowKey,row);
 }
}catch(error){root.replaceChildren(node('h1',{},'Worksheet could not be opened'),node('p',{class:'notice',role:'alert'},error.message));return;}
const S={candidates:new Map(),returnedBy:'',returnedAt:new Date().toISOString(),note:'',query:'',offset:0,view:'all',editor:null,editorDirty:false,cellOffset:0,busy:false,dirty:false,error:'',message:'',storageError:''};
const storageKey='directory.correction.worksheet.'+W.workspaceId+'.'+W.worksheetId;
function identity(value){need(value.workspaceId===W.workspaceId&&value.worksheetId===W.worksheetId&&value.editionId===W.editionId,'Choose a file for this exact original worksheet and edition.');}
function validateCandidate(c){
 need(object(c)&&SHA.test(c.rowKey||'')&&byKey.has(c.rowKey),'A proposed row must name one exact original worksheet row.');
 const row=byKey.get(c.rowKey);need(c.representation===row.representation,'Keep the original row representation.');
 need(typeof c.reason==='string'&&c.reason.trim()&&c.reason.length<=65536,'Give a reason for each proposed row.');
 const keys=['rowKey','representation','reason',row.representation==='json'?'valueJson':'cells'];
 need(Object.keys(c).length===keys.length&&Object.keys(c).every(k=>keys.includes(k)),'Keep the complete declared candidate fields only.');
 if(c.representation==='json'){
  need(typeof c.valueJson==='string'&&size(c.valueJson)<=MAX_VALUE,'Keep the complete candidate JSON text within16MiB.');
  need(object(completeObject(c.valueJson)),'The candidate must remain a complete JSON object. Values and number spelling are returned exactly as entered.');
 }else{need(Array.isArray(c.cells)&&c.cells.length>0&&c.cells.length<=65536&&c.cells.every(v=>typeof v==='string'),'Keep one to65,536 complete string cells.');need(size(c.cells)+1<=MAX_VALUE,'Keep the complete encoded proposed CSV row within16MiB.');}
 return c;
}
function candidateList(values){
 need(Array.isArray(values)&&values.length<=10000,'Keep the complete candidate row list.');
 const seen=new Set();for(const c of values){validateCandidate(c);need(!seen.has(c.rowKey),'Each original row can be proposed once.');seen.add(c.rowKey);}return values;
}
function validateReturn(value){
 need(object(value)&&value.schema===RETURN,'Choose a complete returned worksheet JSON.');
 identity(value);
 const allowed=['schema','workspaceId','worksheetId','editionId','returnedBy','returnedAt','note','candidates'];
 need(Object.keys(value).every(k=>allowed.includes(k)),'Keep the declared complete returned file fields only.');
 need(typeof value.returnedBy==='string'&&value.returnedBy.trim()&&value.returnedBy.length<=240,'Enter who is returning this worksheet.');
 need(typeof value.returnedAt==='string'&&value.returnedAt.trim()&&value.returnedAt.length<=96,'Keep the stated return date.');
 need(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value.returnedAt)&&Number.isFinite(Date.parse(value.returnedAt)),'State the complete return timestamp with its timezone, for example 2026-10-13T12:00:00Z.');
 need(value.note===undefined||typeof value.note==='string'&&value.note.length<=65536,'Keep the complete return note.');
 candidateList(value.candidates);need(size(serialized(value))<=MAX_RETURN,'The complete returned file exceeds32MiB.');return value;
}
function returnValue(){
 return {schema:RETURN,workspaceId:W.workspaceId,worksheetId:W.worksheetId,editionId:W.editionId,returnedBy:S.returnedBy,returnedAt:S.returnedAt,note:S.note,candidates:[...S.candidates.values()].map(clone)};
}
function working(){
 return {schema:WORKING,workspaceId:W.workspaceId,worksheetId:W.worksheetId,editionId:W.editionId,returnedBy:S.returnedBy,returnedAt:S.returnedAt,note:S.note,candidates:[...S.candidates.values()].map(clone),query:S.query,view:S.view,editor:S.editor?clone(S.editor):null,editorDirty:S.editorDirty,cellOffset:S.cellOffset};
}
function validateWorking(v){
 need(object(v)&&v.schema===WORKING,'Choose the complete saved working worksheet.');identity(v);
 for(const k of ['returnedBy','returnedAt','note','query'])need(typeof v[k]==='string','Keep the working '+k+'.');
 need(v.returnedBy.length<=240&&v.returnedAt.length<=96&&v.note.length<=65536,'Keep complete working identity fields within their declared limits.');
 need(['all','proposed'].includes(v.view),'Keep the original working view.');
 candidateList(v.candidates);
 need(typeof v.editorDirty==='boolean'&&Number.isInteger(v.cellOffset)&&v.cellOffset>=0,'Keep the unfinished editor state.');
 if(v.editor!==null){
  need(object(v.editor)&&byKey.has(v.editor.rowKey)&&typeof v.editor.cellsDraft==='boolean','Keep the exact selected editing row and complete cell-array draft state.');
  for(const k of ['valueJson','cellsText','reason'])need(typeof v.editor[k]==='string','Keep unfinished '+k+' text.');
 }
 need(size(serialized(v))<=67108864,'The complete working file exceeds64MiB.');return v;
}
function persist(){try{sessionStorage.setItem(storageKey,JSON.stringify(working()));S.storageError='';}catch{S.storageError='Browser storage could not retain this complete working copy. Download working JSON before leaving.';}}
function changed(){S.dirty=true;persist();}
function freeze(){root.querySelectorAll('button,input,textarea,select').forEach(e=>{if(S.busy)e.disabled=true;});}
async function task(fn){if(S.busy)return;S.busy=true;S.error='';freeze();try{await fn();}catch(e){S.error=e.message||String(e);}finally{S.busy=false;persist();render();}}
function button(label,fn,props={}){const b=node('button',{type:'button',...props},label);b.addEventListener('click',()=>task(fn));return b;}
function field(label,value,set,{textarea=false,test,cls='',rows=4}={}){
 const e=node(textarea?'textarea':'input',{'data-testid':test,...(textarea?{rows}:{type:'text'}),class:cls});e.value=value;
 e.addEventListener('input',()=>{if(S.busy)return;set(e.value);changed();});
 return node('label',{class:'field'},[node('span',{},label),e]);
}
function meta(values){return node('dl',{class:'meta'},Object.entries(values).flatMap(([k,v])=>[node('dt',{},k),node('dd',{},v===null||v===undefined?'Not supplied':String(v))]));}
function table(columns,rows){return node('div',{class:'table'},node('table',{},[node('thead',{},node('tr',{},columns.map(c=>node('th',{scope:'col'},c.label)))),node('tbody',{},rows.map(r=>node('tr',{},columns.map(c=>node('td',{},c.cell(r))))))]));}
function openRow(key){
 const row=byKey.get(key);need(row,'Choose an original selected row.');
 if(S.editorDirty&&!confirm('Discard unfinished row text and open this row? Add the proposal first to keep it.'))return;
 const candidate=S.candidates.get(key);
 S.editor={rowKey:key,valueJson:row.representation==='json'?(candidate?.valueJson??row.valueJson):'',cellsText:JSON.stringify(candidate?.cells??row.cells??[],null,2),cellsDraft:false,reason:candidate?.reason??''};
 S.editorDirty=false;S.cellOffset=0;changed();
}
function fromEditor(){
 const e=S.editor;need(e,'Choose a row first.');const row=byKey.get(e.rowKey);
 return validateCandidate({rowKey:e.rowKey,representation:row.representation,...(row.representation==='json'?{valueJson:e.valueJson}:{cells:JSON.parse(e.cellsText)}),reason:e.reason});
}
function restore(v){
 if(v.schema===RETURN){validateReturn(v);Object.assign(S,{returnedBy:v.returnedBy,returnedAt:v.returnedAt,note:v.note??'',candidates:new Map(v.candidates.map(c=>[c.rowKey,clone(c)])),editor:null,editorDirty:false,query:'',view:'proposed',offset:0,cellOffset:0});}
 else{validateWorking(v);Object.assign(S,{returnedBy:v.returnedBy,returnedAt:v.returnedAt,note:v.note,candidates:new Map(v.candidates.map(c=>[c.rowKey,clone(c)])),editor:v.editor?clone(v.editor):null,editorDirty:v.editorDirty,query:v.query,view:v.view,offset:0,cellOffset:v.cellOffset});}
 changed();S.message='The complete working values were reopened against the exact original worksheet.';
}
function pageRows(){
 const q=S.query.toLowerCase();
 return W.rows.filter(r=>(S.view==='all'||S.candidates.has(r.rowKey))&&(!q||[r.table,r.memberName,r.pointer,r.nativeId,r.rowKey,r.ref.recordId].some(v=>v!==undefined&&v!==null&&String(v).toLowerCase().includes(q))));
}
function renderRows(){
 const all=pageRows();if(S.offset>=all.length)S.offset=Math.max(0,Math.floor((all.length-1)/25)*25);const rows=all.slice(S.offset,S.offset+25);
 const box=node('section',{class:'panel'},[node('h2',{},'Selected original rows'),
  field('Find original table, ID or source location',S.query,v=>{S.query=v;S.offset=0;},{test:'worksheet-query'}),
  node('div',{class:'actions'},[button('Read matching rows',()=>{}),button(S.view==='all'?'Show proposed rows':'Show all original rows',()=>{S.view=S.view==='all'?'proposed':'all';S.offset=0;changed();})]),
  node('p',{class:'help'},'Unselected or omitted rows are not proposed for change. This editor never writes to the directory provider.'),
  table([{label:'Original row',cell:r=>node('div',{},[node('strong',{},r.table||r.representation),node('div',{},r.nativeId===null||r.nativeId===undefined?'No stated native ID':String(r.nativeId)),node('div',{class:'help'},r.memberName+' '+(r.pointer||''))])},
   {label:'Proposal',cell:r=>node('span',{class:'status'},S.candidates.has(r.rowKey)?'Proposed':'Original')},
   {label:'Open',cell:r=>button('Review row',()=>openRow(r.rowKey),{'data-testid':'worksheet-row-'+r.rowKey})}],rows),
  node('div',{class:'pager'},[node('span',{},(all.length?S.offset+1:0)+'–'+(S.offset+rows.length)+' of '+all.length),
   node('div',{class:'actions'},[button('Previous',()=>S.offset=Math.max(0,S.offset-25),{disabled:S.offset===0}),button('Next',()=>S.offset+=25,{disabled:S.offset+rows.length>=all.length})])])]);
 return box;
}
function renderEditor(){
 if(!S.editor)return node('section',{class:'panel'},[node('h2',{},'Row proposal'),node('p',{},'Open an original row to prepare a complete proposed value and its reason.')]);
 const e=S.editor,row=byKey.get(e.rowKey),box=node('section',{class:'panel','data-testid':'worksheet-editor-row','data-row-key':e.rowKey},[
  node('h2',{},'Complete '+(row.representation==='csv'?'CSV row':'JSON object')+' proposal'),
  meta({Table:row.table,Member:row.memberName,Pointer:row.pointer,'Original row':row.ref.recordId,'Worksheet row':row.rowKey}),
  node('p',{class:'help'},'The original row remains unchanged. The receiving operator will compare every proposed field and make an explicit decision.')]);
 if(row.representation==='json'){
  box.append(field('Complete proposed JSON object — exact text',e.valueJson,v=>{e.valueJson=v;S.editorDirty=true;},{textarea:true,test:'worksheet-json',cls:'json-editor'}),
   node('p',{class:'help'},'Keep quotes, number spelling, nulls and field absence as intended. Validation reads this text without replacing it. Arrays are compared as complete values.'),
   button('Validate complete JSON',()=>{const value=completeObject(e.valueJson);need(object(value),'Keep a complete JSON object.');need(size(e.valueJson)<=MAX_VALUE,'Keep the candidate within16MiB.');S.message='The complete object parses. Its original typed comparison happens during receiving.';}),
   details('Original complete lexical JSON',row.valueJson));
 }else{
  let cells=null;try{const value=JSON.parse(e.cellsText);if(Array.isArray(value)&&value.every(v=>typeof v==='string'))cells=value;}catch{}
  if(cells){
   const visible=cells.slice(S.cellOffset,S.cellOffset+25).map((value,i)=>({value,index:S.cellOffset+i}));
   box.append(table([{label:'Position / header',cell:c=>node('div',{},[node('strong',{},String(c.index)),node('div',{},c.index<row.headers.length?row.headers[c.index]===''?'Blank original header':row.headers[c.index]:'No original header')])},
    {label:'Original',cell:c=>node('div',{class:'readonly'},c.index<row.cells.length?row.cells[c.index]:'[physically absent]')},
    {label:'Proposed exact string',cell:c=>{const t=node('textarea',{class:'cell-editor','data-testid':'worksheet-cell-'+c.index,'aria-label':'Proposed physical cell '+c.index});t.value=c.value;t.disabled=!!e.cellsDraft;t.addEventListener('input',()=>{if(S.busy||e.cellsDraft)return;const values=JSON.parse(e.cellsText);need(c.index<values.length,'Apply the complete changed cell array before editing its grid.');values[c.index]=t.value;e.cellsText=JSON.stringify(values,null,2);const full=root.querySelector('[data-testid="worksheet-cells"]');if(full)full.value=e.cellsText;S.editorDirty=true;changed();});return t;}}],visible),
    node('div',{class:'pager'},[node('span',{},'Physical cells '+(cells.length?S.cellOffset:0)+'–'+Math.max(0,S.cellOffset+visible.length-1)+' of '+cells.length),node('div',{class:'actions'},[button('Previous cells',()=>S.cellOffset=Math.max(0,S.cellOffset-25),{disabled:S.cellOffset===0}),button('Next cells',()=>S.cellOffset+=25,{disabled:S.cellOffset+visible.length>=cells.length})])]));
  }
  box.append(details('Original ordered headers',row.headers),details('Original complete physical cells',row.cells),
   field('Complete proposed string-cell array',e.cellsText,v=>{e.cellsText=v;e.cellsDraft=true;root.querySelectorAll('[data-testid^="worksheet-cell-"]').forEach(t=>t.disabled=true);S.editorDirty=true;},{textarea:true,test:'worksheet-cells',rows:8}),
   button('Use complete cell array in grid',()=>{const cells=JSON.parse(e.cellsText);need(Array.isArray(cells)&&cells.length>0&&cells.every(v=>typeof v==='string'),'Use a nonempty array of exact string cells.');e.cellsDraft=false;S.cellOffset=0;}),
   node('p',{class:'help'},'Equal-length proposals are compared by physical column. Changing the number of cells is one complete-row decision; an empty string remains a present cell.'));
 }
 box.append(field('Reason for this complete row proposal',e.reason,v=>{e.reason=v;S.editorDirty=true;},{textarea:true,test:'worksheet-reason'}),
  node('div',{class:'actions'},[
   button('Retain complete row proposal',()=>{const c=fromEditor();S.candidates.set(c.rowKey,clone(c));S.editorDirty=false;changed();S.message='The complete row proposal is retained for return.';},{'data-testid':'worksheet-retain'}),
   button('Remove this proposal',()=>{if(!confirm('Remove the proposal for this original row and discard unfinished editor text?'))return;S.candidates.delete(e.rowKey);S.editor=null;S.editorDirty=false;changed();},{disabled:!S.candidates.has(e.rowKey)}),
   button('Close row editor',()=>{if(S.editorDirty&&!confirm('Discard unfinished row text? Retain the proposal first to keep it.'))return;S.editor=null;S.editorDirty=false;changed();})]),
  details('Exact original row identity and custody',row.ref));
 return box;
}
function render(){
 const file=node('input',{type:'file',accept:'.json,application/json','data-testid':'worksheet-open-file'});
 file.addEventListener('change',()=>task(async()=>{const selected=file.files?.[0];if(!selected)return;need(selected.size<=67108864,'Choose a complete working/return JSON within64MiB.');const v=JSON.parse(await selected.text());if(v.schema===RETURN)validateReturn(v);else validateWorking(v);if(S.dirty&&!confirm('Replace the current working copy with this complete file? Download your current working JSON first to keep it.'))return;restore(v);}));
 const header=node('header',{class:'header'},[node('div',{},[node('p',{class:'eyebrow'},'HUMAN SERVICES DIRECTORY · CUSTOMER WORKSHEET'),node('h1',{},W.label||'Directory correction worksheet'),node('p',{},'Review selected original rows, retain complete proposed values and return a file for explicit operator review.')]),
  node('div',{class:'actions'},[button('Save complete working JSON',()=>{persist();saveFile(working(),'Directory_Correction_Worksheet_Working.json');},{'data-testid':'worksheet-save-working'}),node('label',{class:'file-label'},['Reopen working or returned JSON',file])])]);
 const identityPanel=node('section',{class:'panel'},[node('h2',{},'Return details'),meta({Worksheet:W.worksheetId,'Original edition':W.editionId,'Original workspace':W.workspaceId,'Selected original rows':W.rows.length,'Proposed rows':S.candidates.size}),
  node('div',{class:'fields'},[field('Returned by',S.returnedBy,v=>S.returnedBy=v,{test:'worksheet-returned-by'}),field('Stated return date/time',S.returnedAt,v=>S.returnedAt=v,{test:'worksheet-returned-at'})]),
  field('Complete return note',S.note,v=>S.note=v,{textarea:true,test:'worksheet-note'}),
  button('Download complete returned worksheet',()=>{need(!S.editorDirty,'Retain or discard unfinished row text before returning.');const value=validateReturn(returnValue());saveFile(value,'Directory_Correction_Worksheet_Return.json');S.message='The complete returned file has been prepared for download. Deliver it through the existing agreed channel; this page sends nothing.';},{'data-testid':'worksheet-return'}),
  node('p',{class:'help'},'A returned file records proposals, not accepted corrections. The receiving operator must review every typed or field-presence change. Original files and editions are retained.'),
  details('Original complete worksheet metadata',{schema:W.schema,workspaceId:W.workspaceId,worksheetId:W.worksheetId,editionId:W.editionId,label:W.label,actor:W.actor,note:W.note})]);
 root.replaceChildren(header,...(S.error?[node('p',{class:'notice',role:'alert'},'Error: '+S.error)]:S.message?[node('p',{class:'notice',role:'status'},S.message)]:[]),...(S.storageError?[node('p',{class:'notice',role:'alert'},S.storageError)]:[]),identityPanel,node('div',{class:'layout'},[renderRows(),renderEditor()]));
 root.setAttribute('data-worksheet-ready','true');freeze();
}
try{const text=sessionStorage.getItem(storageKey);if(text){const value=JSON.parse(text);validateWorking(value);restore(value);S.message='Reopened this worksheet’s complete retained working copy.';}}catch(error){S.storageError='The previous browser working copy could not be reopened: '+error.message+'. Use your complete downloaded working JSON.';}
window.addEventListener('beforeunload',event=>{persist();if(S.dirty||S.editorDirty){event.preventDefault();event.returnValue='';}});
render();
})();
