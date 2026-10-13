// MIT. Reviewed original HSDS row corrections in the existing private Directory operator.
const WORKING='stellar-forge.directory-corrections-working.v1';
const SHA=/^[0-9a-f]{64}$/;
const KINDS=['correctionPlans','correctionPreviews','corrections'];
const encode=encodeURIComponent,clone=value=>JSON.parse(JSON.stringify(value));
const bytes=value=>new TextEncoder().encode(typeof value==='string'?value:JSON.stringify(value)).length;
const short=value=>typeof value==='string'?value.slice(0,12):'';
function need(value,message){if(!value)throw new Error(message);}
function object(value){return !!value&&typeof value==='object'&&!Array.isArray(value);}
function element(tag,attributes={},children=[]){
 const node=document.createElement(tag);
 for(const [key,value]of Object.entries(attributes)){
  if(value===undefined||value===null)continue;
  if(key==='text')node.textContent=String(value);
  else if(key==='class')node.className=value;
  else if(key==='disabled'||key==='checked')node[key]=Boolean(value);
  else node.setAttribute(key,String(value));
 }
 for(const child of [].concat(children))if(child!==undefined&&child!==null)node.append(child instanceof Node?child:document.createTextNode(String(child)));
 return node;
}
function shown(value){return value===undefined?'Not supplied':value===null?'null':typeof value==='string'?value:JSON.stringify(value,null,2);}
function downloadJSON(value,name){
 const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)+'\n'],{type:'application/json'}));
 const a=element('a',{href:url,download:name});a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function validateEdit(edit){
 need(object(edit),'Keep one complete original edit object.');
 const common=['sourceId','recordId','rowSha256','resourceSha256','memberSha256','action','reason'];
 for(const key of common.slice(0,5))need(typeof edit[key]==='string'&&SHA.test(edit[key]),'Keep the exact original '+key+'.');
 need(typeof edit.reason==='string'&&edit.reason.trim()&&edit.reason.length<=65536,'Describe the reason for each edit.');
 const fields={'json-set':['pointer','valueJson'],'json-remove':['pointer'],'csv-cell':['column','value'],'csv-row':['cells']}[edit.action];
 need(fields,'Choose a declared correction action.');
 need(Object.keys(edit).length===common.length+fields.length&&Object.keys(edit).every(k=>common.includes(k)||fields.includes(k)),'Keep exactly the fields for the selected edit.');
 if(edit.action.startsWith('json-')){
  need(typeof edit.pointer==='string'&&edit.pointer.length<=16384&&(edit.pointer===''||edit.pointer.startsWith('/'))&&!/~(?![01])/.test(edit.pointer),'Use a relative RFC6901 pointer, with exact ~0 and ~1 escapes.');
  if(edit.action==='json-remove')need(edit.pointer!=='','Remove a named field or array entry; retain the selected complete row.');
  else{need(typeof edit.valueJson==='string'&&bytes(edit.valueJson)<=16777216,'Supply the complete JSON value within16MiB.');JSON.parse(edit.valueJson);}
 }else if(edit.action==='csv-cell'){
  need(Number.isInteger(edit.column)&&edit.column>=0&&edit.column<=65535,'Select the zero-based physical CSV column.');
  need(typeof edit.value==='string'&&bytes(edit.value)<=16777216,'Keep the complete exact CSV cell text.');
 }else need(Array.isArray(edit.cells)&&edit.cells.length>0&&edit.cells.length<=65536&&edit.cells.every(x=>typeof x==='string'&&bytes(x)<=16777216),'Keep a complete nonempty ordered array of string cells.');
 return edit;
}
function validateWorking(value,workspaceId){
 need(object(value)&&value.schema===WORKING&&value.workspaceId===workspaceId,'Choose the complete working correction for this original workspace.');
 for(const key of ['editionId','label','actor','note','sourceId','rowQuery','rowTable'])
  need(typeof value[key]==='string','The working correction is missing '+key+'.');
 need(value.editionId===''||SHA.test(value.editionId),'Keep the exact original edition identity.');
 need(value.sourceId===''||SHA.test(value.sourceId),'Keep the exact original source identity.');
 need(value.predecessorId===null||typeof value.predecessorId==='string'&&SHA.test(value.predecessorId),'Keep the exact previous accepted correction or null.');
 need(Array.isArray(value.edits)&&value.edits.length<=10000,'Keep the complete ordered edit list.');
 value.edits.forEach(validateEdit);
 need(value.openKind===null||KINDS.includes(value.openKind),'Keep the original correction collection.');
 need(value.openId===null||typeof value.openId==='string'&&SHA.test(value.openId),'Keep the exact original correction record.');
 if(value.pending!==null){
  need(object(value.pending)&&['prepare','preview','apply','export'].includes(value.pending.action)&&object(value.pending.body),
   'Keep the complete original pending request.');
 }
 if(value.editor!==null){
  need(object(value.editor)&&object(value.editor.ref)&&['json-set','json-remove','csv-cell','csv-row'].includes(value.editor.action),'Keep the selected original editing row.');
  for(const key of ['pointer','valueJson','column','value','cellsText','reason'])need(typeof value.editor[key]==='string','Keep unfinished editor text for '+key+'.');
  for(const key of ['sourceId','recordId','rowSha256','resourceSha256','memberSha256'])need(SHA.test(value.editor.ref[key]||''),'Keep the selected original row '+key+'.');
  need(value.editor.position===null||Number.isInteger(value.editor.position)&&value.editor.position>=0&&value.editor.position<value.edits.length,'Keep the original ordered edit position.');
 }
 need((value.openKind===null)===(value.openId===null),'Keep both the saved collection and record, or neither.');
 need(value.editionId!==''||(!value.edits.length&&!value.editor),'Keep the original edition for every working edit.');
 need(bytes(value)<=33554432,'The complete working correction exceeds32MiB.');
 return value;
}
export function mountDirectoryCorrections({root,api,download,getState,notify=()=>{}}){
 need(root&&typeof api==='function'&&typeof download==='function'&&typeof getState==='function','Use the original Directory operator binding.');
 const S={workspaceId:null,busy:false,disposed:false,dirty:false,message:'',error:'',storageError:'',
  editionId:'',basisEditionId:'',edition:null,label:'',actor:'',note:'',predecessorId:null,edits:[],sourceId:'',rowQuery:'',rowTable:'',
  rowOffset:0,rowPage:null,editor:null,originalRow:null,editOffset:0,libraryKind:'correctionPlans',libraryQuery:'',
  libraryOffset:0,libraryPage:null,openKind:null,openId:null,record:null,changePage:null,changeOffset:0,
  pending:null,lastResponse:null,catalogue:null,view:'edit'};
 let generation=0;
 function current(mine=generation){
  if(S.disposed||mine!==generation){const error=new Error('This correction view is closed; reopen its retained working request.');error.name='AbortError';throw error;}
 }
 async function observed(work){const mine=generation;current(mine);const value=await work();current(mine);return value;}
 const originalApi=api,originalDownload=download;
 api=(...args)=>observed(()=>originalApi(...args));
 download=(...args)=>observed(()=>originalDownload(...args));
 const key=()=> 'directory.corrections.working.'+S.workspaceId;
 const path=(...parts)=>'/api/directory/'+parts.map(encode).join('/');
 const section=element('section',{class:'dcw','data-directory-corrections-ready':'false'});
 root.replaceChildren(section);
 function working(){
  return {schema:WORKING,workspaceId:S.workspaceId,editionId:S.editionId,label:S.label,actor:S.actor,note:S.note,
   predecessorId:S.predecessorId,edits:clone(S.edits),sourceId:S.sourceId,rowQuery:S.rowQuery,rowTable:S.rowTable,
   editor:S.editor?clone(S.editor):null,openKind:S.openKind,openId:S.openId,pending:S.pending?clone(S.pending):null,
   lastResponse:S.lastResponse?clone(S.lastResponse):null};
 }
 function persist(){
  if(S.disposed||!S.workspaceId)return;
  try{sessionStorage.setItem(key(),JSON.stringify(working()));S.storageError='';}
  catch{S.storageError='The browser could not retain this complete working copy. Download working JSON before leaving.';}
 }
 function changed(){if(S.disposed)return;S.dirty=true;persist();}
 function freeze(){section.querySelectorAll('input,textarea,select,button').forEach(n=>{if(S.busy)n.disabled=true;});}
 async function task(work){
  if(S.busy||S.disposed)return;
  S.busy=true;S.error='';freeze();const mine=generation;
  try{await work();if(mine!==generation||S.disposed)return;}
  catch(error){if(mine===generation&&!S.disposed){S.error=error?.message||String(error);notify(S.error);}}
  finally{if(mine===generation&&!S.disposed){S.busy=false;persist();render();}}
 }
 function button(label,work,attributes={}){
  const node=element('button',{type:'button',...attributes},label);
  node.addEventListener('click',()=>task(work));return node;
 }
 function field(label,value,set,{textarea=false,readonly=false,test,placeholder='',rows=4}={}){
  const control=element(textarea?'textarea':'input',{'data-testid':test,placeholder,...(textarea?{rows}:{type:'text'})});
  control.value=value??'';control.readOnly=readonly;
  control.addEventListener('input',()=>{if(S.busy||S.disposed||readonly)return;set(control.value);changed();});
  return element('label',{class:'dcw-field'},[element('span',{},label),control]);
 }
 function select(label,value,options,set,test){
  const control=element('select',{'data-testid':test});
  for(const [id,text]of options)control.append(element('option',{value:id},text));
  control.value=value;
  control.addEventListener('change',()=>{if(S.busy||S.disposed)return;set(control.value);changed();render();});
  return element('label',{class:'dcw-field'},[element('span',{},label),control]);
 }
 function details(label,value,open=false){
  return element('details',{class:'dcw-detail',...(open?{open:''}:{})},[element('summary',{},label),
   element('pre',{tabindex:'0'},typeof value==='string'?value:JSON.stringify(value,null,2))]);
 }
 function summaryRows(values){
  return element('dl',{class:'dcw-summary'},Object.entries(values).flatMap(([label,value])=>[
   element('dt',{},label),element('dd',{},shown(value))]));
 }
 function pager(page,read){
  if(!page)return element('div');
  return element('div',{class:'dcw-pager'},[
   element('span',{},'Rows '+(page.total?Math.min(page.offset+1,page.total):0)+'–'+Math.min(page.offset+page.rows.length,page.total)+' of '+page.total),
   button('Previous',()=>read(Math.max(0,page.offset-page.limit)),{disabled:page.offset===0}),
   button('Next',()=>read(page.nextOffset),{disabled:page.nextOffset===null})]);
 }
 function table(columns,rows){
  return element('div',{class:'dcw-table-wrap'},element('table',{},[
   element('thead',{},element('tr',{},columns.map(c=>element('th',{scope:'col'},c.label)))),
   element('tbody',{},rows.map(row=>element('tr',{},columns.map(c=>element('td',{},c.cell(row))))))]));
 }
 async function page(url,identity){
  const value=await api(url);
  need(object(value)&&Array.isArray(value.rows)&&Number.isInteger(value.total)&&Number.isInteger(value.offset)&&Number.isInteger(value.limit),
   'The original complete page shape changed.');
  need(value.nextOffset===null||value.nextOffset===value.offset+value.rows.length,'Keep the original contiguous next page.');
  if(identity)identity(value);
  return value;
 }
 async function loadEdition(id){
  need(SHA.test(id),'Select the exact original edition.');
  const value=await api(path('editions',id));
  need(value.id===id&&Array.isArray(value.sourceIds),'The original edition identity changed.');
  need(!(S.edits.length||S.editor)||S.basisEditionId===id,'Keep the original edit basis. Start a new working correction before changing editions.');
  S.editionId=id;S.basisEditionId=id;S.edition=value;
  if(!value.sourceIds.includes(S.sourceId))S.sourceId='';
  S.rowOffset=0;S.rowPage=null;
 }
 async function readRows(offset=0){
  need(S.editionId,'Choose a frozen source edition first.');
  const query=new URLSearchParams({offset:String(offset),limit:'25',query:S.rowQuery});
  if(S.rowTable)query.set('table',S.rowTable);
  S.rowPage=await page(path('editions',S.editionId,'rows')+'?'+query);
  S.rowOffset=offset;
 }
 function replaceEditor(){return !S.editor||confirm('Discard the unfinished row editor and open the selected original row? Save or add the current edit first to keep it.');}
 async function chooseRow(row){
  if(!replaceEditor())return;
  need(S.editionId&&S.edition,'Choose its retained source edition.');
  const full=await api(path('editions',S.editionId,'rows',row.sourceId,row.recordId));
  const source=await api(path('sources',row.sourceId));
  need(source.id===row.sourceId&&full.protocol==='hsds','This workbench edits original HSDS rows; other source families remain retained in the edition.');
  const ref={};for(const key of ['sourceId','recordId','rowSha256','resourceSha256','memberSha256']){
   need(SHA.test(full[key]||''),'The original row is missing '+key+'.');ref[key]=full[key];
  }
  S.originalRow=full;S.sourceId=full.sourceId;
  const csv=Array.isArray(full.cells);
  S.editor={ref,position:null,action:csv?'csv-cell':'json-set',pointer:'',valueJson:typeof full.json==='string'?full.json:'',
   column:'0',value:csv?full.cells[0]??'':'',cellsText:csv?JSON.stringify(full.cells,null,2):'[]',reason:''};
  S.view='edit';changed();
 }
 function editFromEditor(){
  const e=S.editor;need(e,'Choose an original row.');
  const edit={...clone(e.ref),action:e.action,reason:e.reason};
  if(e.action==='json-set')Object.assign(edit,{pointer:e.pointer,valueJson:e.valueJson});
  else if(e.action==='json-remove')edit.pointer=e.pointer;
  else if(e.action==='csv-cell'){need(/^(0|[1-9][0-9]*)$/.test(e.column),'Use the original zero-based physical column number.');Object.assign(edit,{column:Number(e.column),value:e.value});}
  else edit.cells=JSON.parse(e.cellsText);
  return validateEdit(edit);
 }
 async function editExisting(index){
  if(!replaceEditor())return;
  const edit=S.edits[index];need(edit,'Select an existing ordered edit.');
  const full=await api(path('editions',S.editionId,'rows',edit.sourceId,edit.recordId));
  for(const name of ['rowSha256','resourceSha256','memberSha256'])need(full[name]===edit[name],'The original editing basis changed.');
  S.originalRow=full;
  const ref=Object.fromEntries(['sourceId','recordId','rowSha256','resourceSha256','memberSha256'].map(k=>[k,edit[k]]));
  S.editor={ref,position:index,action:edit.action,pointer:edit.pointer??'',valueJson:edit.valueJson??'',
   column:String(edit.column??0),value:edit.value??'',cellsText:JSON.stringify(edit.cells??full.cells??[],null,2),reason:edit.reason};
  S.view='edit';changed();
 }
 function prepareBody(){
  need(S.editionId===S.basisEditionId&&S.edition?.id===S.editionId,'Open and retain the exact original editing edition.');
  need(SHA.test(S.editionId)&&S.label.trim()&&S.actor.trim(),'Choose the original edition and enter the correction label and actor.');
  need(S.edits.length>0&&S.edits.length<=10000,'Keep one to10,000 reviewed ordered edits.');
  const value={label:S.label,editionId:S.editionId,actor:S.actor,note:S.note,predecessorId:S.predecessorId,edits:clone(S.edits)};
  value.edits.forEach(validateEdit);need(bytes(value)<=33554432,'The complete accepted input exceeds32MiB.');
  return value;
 }
 async function perform(action,body){
  if(S.pending)need(JSON.stringify(S.pending)===JSON.stringify({action,body}),'Resolve the original pending request before another mutation.');
  else{S.pending={action,body:clone(body)};persist();}
  const result=await api(path('corrections',action),{method:'POST',body});
  need(object(result)&&SHA.test(result.id||''),'The native correction returned no immutable record identity.');
  S.lastResponse={action,body:clone(body),recordId:result.id};S.pending=null;persist();
  const kind=action==='prepare'?'correctionPlans':action==='preview'?'correctionPreviews':action==='apply'?'corrections':'exports';
  if(kind==='exports'){
   S.message='Complete correction packet is retained. Download its original full bytes.';
   await download(path('exports',result.id,'file'));
  }else{
   await openRecord(kind,result.id);
   S.message=action==='prepare'?'Saved the complete original edit request.':action==='preview'?'The complete derived candidate is ready for review.':'Accepted the exact reviewed candidate edition.';
  }
  if(action==='prepare')S.dirty=false;persist();return result;
 }
 async function openRecord(kind,id){
  need(KINDS.includes(kind)&&SHA.test(id),'Select an original correction record.');
  const record=await api(path(kind,id));need(record.id===id,'The original saved correction identity differs.');
  S.openKind=kind;S.openId=id;S.record=record;S.changePage=null;S.changeOffset=0;S.view='review';
  await readChanges(0);
 }
 async function readChanges(offset=0){
  need(S.openKind&&S.openId,'Open the original correction record.');
  S.changePage=await page(path(S.openKind,S.openId,'rows')+'?offset='+offset+'&limit=25',
   p=>need(p.kind===S.openKind&&p.recordId===S.openId,'The original correction page identity changed.'));
  S.changeOffset=offset;
 }
 async function readLibrary(offset=0){
  S.libraryPage=await page(path(S.libraryKind)+'?offset='+offset+'&limit=25&query='+encode(S.libraryQuery));
  S.libraryOffset=offset;
 }
 async function planInput(record=S.record,kind=S.openKind){
  const planId=kind==='correctionPlans'?record.id:record.planId;
  need(SHA.test(planId||''),'The native record must retain its original correction plan.');
  const value=await api(path('correctionPlans',planId,'files','input'));
  need(object(value)&&SHA.test(value.editionId||'')&&Array.isArray(value.edits),'The original complete plan input is missing.');
  return {planId,value};
 }
 async function loadPlanDraft(){
  const {planId,value}=await planInput();
  need(!S.pending,'Reconcile the exact pending request before replacing the working correction.');
  if(S.dirty&&!confirm('Replace the current working correction with this complete saved plan?'))return;
  const edition=await api(path('editions',value.editionId));need(edition.id===value.editionId,'The selected original edition differs.');
  Object.assign(S,{editionId:value.editionId,basisEditionId:value.editionId,edition});
  Object.assign(S,{label:value.label,actor:value.actor,note:value.note??'',predecessorId:value.predecessorId??null,
   edits:clone(value.edits),editor:null,originalRow:null,editOffset:0,view:'edit'});
  changed();S.message='Opened the complete original plan as a new working copy with its original edition and predecessor. Saved originals remain unchanged.';
 }
 async function startAcceptedSuccessor(){
  need(S.openKind==='corrections'&&S.record?.stage==='accepted','Choose an accepted original correction.');
  need(!S.pending,'Resolve the original pending request before selecting another edition.');
  if(S.dirty&&!confirm('Keep the current working JSON before starting a successor from this accepted edition. Continue?'))return;
  const previous=S.record,edition=await api(path('editions',previous.editionId));
  need(edition.id===previous.editionId,'The accepted edition identity changed.');
  Object.assign(S,{editionId:edition.id,basisEditionId:edition.id,edition,label:(previous.label||'Correction')+' — successor',
   predecessorId:previous.id,edits:[],note:'',sourceId:'',rowQuery:'',rowTable:'',rowOffset:0,rowPage:null,
   editor:null,originalRow:null,editOffset:0,view:'edit'});
  changed();await readRows(0);
  S.message='Choose exact rows from the accepted edition. This new correction retains its accepted predecessor.';
 }
 async function restoreWorking(value){
  validateWorking(value,S.workspaceId); // Validate before any selected state is replaced.
  let edition=null,record=null,row=null;
  if(value.editionId){edition=await api(path('editions',value.editionId));need(edition.id===value.editionId,'The working edition differs.');}
  if(value.openKind&&value.openId){record=await api(path(value.openKind,value.openId));need(record.id===value.openId,'The saved correction differs.');}
  if(value.editor){
   need(value.editionId,'Keep the selected original edition with its editor.');
   row=await api(path('editions',value.editionId,'rows',value.editor.ref.sourceId,value.editor.ref.recordId));
   for(const key of ['rowSha256','resourceSha256','memberSha256'])need(row[key]===value.editor.ref[key],'The original working row '+key+' changed.');
  }
  for(const key of ['editionId','label','actor','note','predecessorId','edits','sourceId','rowQuery','rowTable','editor','openKind','openId','pending','lastResponse'])S[key]=clone(value[key]??null);
  S.edition=edition;S.basisEditionId=value.editionId;S.record=record;S.originalRow=row;S.rowPage=null;S.changePage=null;S.dirty=true;S.view='edit';persist();
  S.message='Reopened the complete working correction, original row bindings, unfinished values and pending request.';
 }
 function renderSources(){
  const editionBox=element('div',{class:'dcw-panel'},[
   element('h2',{},'Original source edition'),
   field('Exact frozen edition ID',S.editionId,v=>{S.editionId=v;S.edition=null;S.rowPage=null;},{test:'dcw-edition',readonly:!!S.edits.length||!!S.editor}),
   button('Open edition',async()=>{if((S.edits.length||S.editor)&&S.basisEditionId!==S.editionId)throw new Error('Keep the selected edit basis; open a new working correction to change editions.');await loadEdition(S.editionId);await readRows(0);},{'data-testid':'dcw-open-edition'}),
   S.edition?summaryRows({Label:S.edition.label,Edition:S.edition.id,'Original sources':S.edition.sourceIds.length,Scope:S.edition.scope}):element('p',{},'Choose an existing frozen source edition. All other edition sources remain retained.'),
   button('Choose from saved editions',async()=>{S.libraryKind='editions';S.libraryQuery='';S.view='editions';S.libraryPage=await page(path('editions')+'?offset=0&limit=25');})
  ]);
  if(S.edition){
   const browse=element('div',{class:'dcw-panel'},[element('h2',{},'Original rows'),
    element('div',{class:'dcw-grid'},[
     field('Table (optional)',S.rowTable,v=>S.rowTable=v,{test:'dcw-table'}),
     field('Original row search',S.rowQuery,v=>S.rowQuery=v,{test:'dcw-query'})]),
    button('Read original rows',()=>readRows(0),{'data-testid':'dcw-read-rows'})]);
   if(S.rowPage)browse.append(table([
    {label:'Original table',cell:r=>r.table},{label:'Native ID',cell:r=>shown(r.nativeId)},
    {label:'Original location',cell:r=>r.memberName+' '+(r.pointer??'')},
    {label:'Row',cell:r=>button('Edit original row',()=>chooseRow(r),{'data-testid':'dcw-row-'+r.recordId})}
   ],S.rowPage.rows),pager(S.rowPage,readRows));
   editionBox.append(browse);
  }
  return editionBox;
 }
 function renderEditor(){
  if(!S.editor)return element('div',{class:'dcw-panel'},[element('h2',{},'Selected original row'),element('p',{},'Read an original row, then author an explicit JSON field or CSV cell correction.')]);
  const e=S.editor,row=S.originalRow,csv=Array.isArray(row?.cells),box=element('div',{class:'dcw-panel'},[
   element('h2',{},e.position===null?'Add an ordered edit':'Edit ordered item '+(e.position+1)),
   summaryRows({Source:e.ref.sourceId,Record:e.ref.recordId,Member:row?.memberName,Pointer:row?.pointer,Table:row?.table}),
   select('Edit action',e.action,csv?[['csv-cell','Replace one physical CSV cell'],['csv-row','Replace the complete ordered CSV cells']]:[['json-set','Set an exact JSON value'],['json-remove','Remove a named JSON field or array entry']],
    v=>e.action=v,'dcw-action')]);
  if(e.action.startsWith('json-')){
   box.append(field('Relative RFC6901 pointer',e.pointer,v=>e.pointer=v,{test:'dcw-pointer',placeholder:'/description (empty selects the complete row)'}));
   if(e.action==='json-set')box.append(field('Complete authored JSON value',e.valueJson,v=>e.valueJson=v,{textarea:true,rows:10,test:'dcw-value-json'}),
    element('p',{class:'dcw-help'},'Keep the exact JSON text. Numeric lexemes are sent unchanged; a string value includes its JSON quotes.'),
    button('Copy original complete row',async()=>{need(typeof row?.json==='string','The original complete JSON is unavailable.');e.valueJson=row.json;e.pointer='';changed();}));
  }else{
   const cells=row?.cells??[],headers=row?.headers??[];
   box.append(details('Complete original physical headers and cells',headers.map((header,index)=>({column:index,header,present:index<cells.length,value:cells[index]})).concat(cells.slice(headers.length).map((value,i)=>({column:headers.length+i,header:null,present:true,value})))));
   if(e.action==='csv-cell')box.append(field('Zero-based physical column',e.column,v=>e.column=v,{test:'dcw-column'}),
    field('Exact authored cell text',e.value,v=>e.value=v,{textarea:true,rows:6,test:'dcw-cell'}),
    button('Copy original selected cell',async()=>{need(/^(0|[1-9][0-9]*)$/.test(e.column),'Choose a physical column.');const i=Number(e.column);need(i<cells.length,'The original row has no cell at that position.');e.value=cells[i];changed();}));
   else box.append(field('Complete ordered string-cell array',e.cellsText,v=>e.cellsText=v,{textarea:true,rows:10,test:'dcw-cells'}),
    element('p',{class:'dcw-help'},'Every cell is an exact string. This explicit full-row replacement can repair ragged or extra-cell rows without renaming headers.'),
    button('Copy complete original cells',async()=>{e.cellsText=JSON.stringify(cells,null,2);changed();}));
  }
  box.append(field('Reason for this edit',e.reason,v=>e.reason=v,{textarea:true,test:'dcw-reason'}),
   button(e.position===null?'Add reviewed edit':'Update ordered edit',async()=>{const edit=editFromEditor();if(e.position===null){need(S.edits.length<10000,'Keep at most10,000 edits.');S.edits.push(edit);}else S.edits[e.position]=edit;S.editor=null;S.originalRow=null;changed();},{'data-testid':'dcw-add-edit'}),
   button('Close row editor',async()=>{if(!confirm('Discard the unfinished row editor? Add or update its edit first to keep it.'))return;S.editor=null;S.originalRow=null;changed();}),
   row?details('Complete original JSON row',row.json??row):element('div'),
   button('Download complete original row',()=>download(path('sources',e.ref.sourceId,'rows',e.ref.recordId,'file'))));
  return box;
 }
 function moveEdit(from,to){
  [S.edits[from],S.edits[to]]=[S.edits[to],S.edits[from]];
  if(S.editor?.position===from)S.editor.position=to;
  else if(S.editor?.position===to)S.editor.position=from;
  changed();
 }
 function removeEdit(index){
  if(S.editor?.position===index){
   if(!confirm('Remove this ordered edit and discard its unfinished row editor?'))return;
   S.editor=null;S.originalRow=null;
  }else if(S.editor?.position!==null&&S.editor?.position>index)S.editor.position--;
  S.edits.splice(index,1);changed();
 }
 function renderEdits(){
  const list=S.edits.slice(S.editOffset,S.editOffset+25).map((edit,i)=>({edit,index:S.editOffset+i}));
  const box=element('div',{class:'dcw-panel'},[
   element('h2',{},'Ordered correction request'),
   element('div',{class:'dcw-grid'},[
    field('Correction label',S.label,v=>S.label=v,{test:'dcw-label'}),
    field('Actor',S.actor,v=>S.actor=v,{test:'dcw-actor'})]),
   field('Review note',S.note,v=>S.note=v,{textarea:true,test:'dcw-note'}),
   summaryRows({'Original edition':S.editionId,'Previous accepted correction':S.predecessorId,'Ordered edits':S.edits.length}),
   table([{label:'Order',cell:r=>r.index+1},{label:'Original row',cell:r=>short(r.edit.sourceId)+' / '+short(r.edit.recordId)},
    {label:'Edit',cell:r=>r.edit.action+' '+(r.edit.pointer??r.edit.column??'complete cells')},{label:'Reason',cell:r=>r.edit.reason},
    {label:'Review',cell:r=>element('div',{class:'dcw-actions'},[
     button('Edit',()=>editExisting(r.index),{'data-testid':'dcw-edit-'+r.index}),
     button('Up',async()=>moveEdit(r.index,r.index-1),{disabled:r.index===0}),
     button('Down',async()=>moveEdit(r.index,r.index+1),{disabled:r.index===S.edits.length-1}),
     button('Remove',async()=>removeEdit(r.index))])}],list),
   pager({total:S.edits.length,offset:S.editOffset,limit:25,rows:list,nextOffset:S.editOffset+list.length<S.edits.length?S.editOffset+list.length:null},
    async offset=>{S.editOffset=offset;}),
   button('Save complete correction plan',()=>perform('prepare',prepareBody()),{'data-testid':'dcw-prepare',disabled:!!S.pending||!!S.editor}),
   element('p',{class:'dcw-help'},'Finish the row editor first. Saving retains the exact ordered input; preview creates a separate candidate for explicit acceptance.')]);
  return box;
 }
 function renderReview(){
  const r=S.record;if(!r)return element('div',{class:'dcw-panel'},'Choose a saved correction plan, preview or accepted correction.');
  const box=element('div',{class:'dcw-panel','data-testid':'dcw-review','data-correction-record-id':r.id,'data-correction-kind':S.openKind},[element('h2',{},S.openKind==='correctionPlans'?'Saved correction plan':S.openKind==='correctionPreviews'?'Candidate edition review':'Accepted correction'),
   summaryRows({Record:r.id,Label:r.label,'Original edition':r.beforeEditionId??r.editionId,Plan:S.openKind==='correctionPlans'?r.id:r.planId,Preview:S.openKind==='correctionPreviews'?r.id:r.previewId,'Candidate edition':S.openKind==='correctionPlans'?null:r.candidateEditionId??r.editionId,Actor:r.actor}),
   r.summary?details('Complete native summary',r.summary,true):element('div'),
   element('div',{class:'dcw-grid'},[field('Accepting or exporting actor',S.actor,v=>S.actor=v,{test:'dcw-review-actor'}),field('Acceptance or export note',S.note,v=>S.note=v,{textarea:true,test:'dcw-review-note'})]),
   element('div',{class:'dcw-actions'},[
    button('Open complete plan as working copy',loadPlanDraft,{'data-testid':'dcw-plan-draft'}),
    ...(S.openKind==='correctionPlans'?[button('Build complete candidate preview',()=>perform('preview',{planId:r.id}),{'data-testid':'dcw-preview',disabled:!!S.pending})]:[]),
    ...(S.openKind==='correctionPreviews'?[button('Accept this exact candidate',async()=>{need(S.actor.trim(),'Enter the accepting actor in the working correction.');const original=await planInput();await perform('apply',{previewId:r.id,expectedEditionId:original.value.editionId,actor:S.actor,note:S.note});},{'data-testid':'dcw-apply',disabled:!!S.pending})]:[]),
    ...(S.openKind==='corrections'?[button('Start successor from accepted edition',startAcceptedSuccessor,{'data-testid':'dcw-accepted-successor',disabled:!!S.pending}),button('Download complete correction packet',()=>perform('export',{correctionId:r.id,actor:S.actor||r.actor,label:r.label||'Complete correction packet',note:S.note}),{'data-testid':'dcw-export',disabled:!!S.pending})]:[])
   ])]);
  if(S.changePage)box.append(element('h3',{},'Every retained edit and change'),
   table([{label:'Order',cell:x=>x.ordinal??''},{label:'Original row',cell:x=>short(x.originalRow?.recordId??x.edit?.recordId??x.recordId)},
    {label:'Action',cell:x=>x.edit?.action??x.action??''},{label:'Before',cell:x=>x.before?x.before.present?shown(x.before.valueJson):'Absent':'Original edit input'},
    {label:'After',cell:x=>x.after?x.after.present?shown(x.after.valueJson):'Absent':''},
    {label:'Complete change',cell:x=>details('Read original context',x)}],S.changePage.rows),
   pager(S.changePage,readChanges));
  const kinds=S.openKind==='correctionPlans'?['input']:['changes','review'];
  box.append(element('h3',{},'Complete retained files'),element('div',{class:'dcw-actions'},kinds.map(fileKind=>
   button('Download '+fileKind,()=>download(path(S.openKind,S.openId,'files',fileKind)),{'data-testid':'dcw-file-'+fileKind}))),
   details('Complete saved native record',r));
  return box;
 }
 function renderLibrary(editions=false){
  const box=element('div',{class:'dcw-panel'},[element('h2',{},editions?'Choose an original source edition':'Complete correction history')]);
  if(!editions)box.append(select('Original collection',S.libraryKind,KINDS.map(k=>[k,k]),v=>{S.libraryKind=v;S.libraryPage=null;},'dcw-library-kind'));
  box.append(field('Search complete saved records',S.libraryQuery,v=>S.libraryQuery=v,{test:'dcw-library-query'}),
   button('Read saved records',async()=>{if(editions)S.libraryPage=await page(path('editions')+'?offset=0&limit=25&query='+encode(S.libraryQuery));else await readLibrary(0);},{'data-testid':'dcw-library-read'}));
  if(S.libraryPage)box.append(table([{label:'Saved label',cell:r=>r.label??r.id},{label:'Original identity',cell:r=>r.id},
   {label:'Created',cell:r=>r.createdAt??''},{label:'Open',cell:r=>button(editions?'Choose edition':'Open full record',async()=>{
    if(editions){need(!S.edits.length||S.editionId===r.id,'Keep the existing edit basis. Download this draft and start a new working correction to choose another edition.');await loadEdition(r.id);S.view='edit';changed();await readRows(0);}
    else await openRecord(S.libraryKind,r.id);},{'data-testid':'dcw-record-'+r.id})}],S.libraryPage.rows),
   pager(S.libraryPage,async offset=>{if(editions)S.libraryPage=await page(path('editions')+'?offset='+offset+'&limit=25&query='+encode(S.libraryQuery));else await readLibrary(offset);}));
  return box;
 }
 function render(){
  if(S.disposed)return;
  const workingFile=element('input',{type:'file',accept:'.json,application/json','data-testid':'dcw-working-file','aria-label':'Open complete working correction'});
  workingFile.addEventListener('change',()=>task(async()=>{const file=workingFile.files?.[0];if(!file)return;need(file.size<=33554432,'Choose a complete working file within32MiB.');const value=JSON.parse(await observed(()=>file.text()));validateWorking(value,S.workspaceId);need(!S.pending,'Reconcile the exact pending request before importing another working copy.');if(S.dirty&&!confirm('Replace this working correction with the selected complete file?'))return;await restoreWorking(value);}));
  const status=S.error?element('p',{class:'dcw-status',role:'alert'},'Error: '+S.error):
   S.message?element('p',{class:'dcw-status',role:'status'},S.message):element('span');
  const header=element('header',{class:'dcw-header'},[
   element('div',{},[element('p',{class:'dcw-eyebrow'},'HUMAN SERVICES DIRECTORY'),element('h1',{},'Source corrections'),
    element('p',{},'Review exact original HSDS rows and accept a separate derived edition. Original source bytes and other editions remain available.')]),
   element('div',{class:'dcw-actions'},[
    button('Working correction',async()=>S.view='edit',{'data-testid':'dcw-edit-view'}),
    button('Saved history',async()=>{S.view='history';if(!KINDS.includes(S.libraryKind))S.libraryKind='correctionPlans';await readLibrary(0);},{'data-testid':'dcw-history'}),
    button('Save working JSON',async()=>{persist();downloadJSON(working(),'Directory_Correction_Working.json');},{'data-testid':'dcw-working-download'}),
    element('label',{class:'dcw-file-label'},['Open working JSON',workingFile]),
    button('New working correction',async()=>{need(!S.pending,'Resolve or retain the exact pending request first.');if(S.dirty&&!confirm('Start a new working correction? Download the current complete draft first.'))return;
     Object.assign(S,{editionId:'',basisEditionId:'',edition:null,label:'',note:'',predecessorId:null,edits:[],sourceId:'',rowQuery:'',rowTable:'',rowPage:null,editor:null,originalRow:null,openKind:null,openId:null,record:null,changePage:null,editOffset:0,view:'edit',dirty:false});persist();})
   ])]);
  const pending=S.pending?element('section',{class:'dcw-panel'},[
   element('h2',{},'Original request awaiting its result'),
   element('p',{},'Keep this exact request after an interrupted response. Read saved history or retry its original complete input.'),
   details('Complete original pending request',S.pending),
   button('Retry original request',()=>perform(S.pending.action,clone(S.pending.body)),{'data-testid':'dcw-retry'})]):element('span');
  section.replaceChildren(header,status,S.storageError?element('p',{class:'dcw-status',role:'alert'},S.storageError):element('span'),pending);
  if(S.view==='history'||S.view==='editions')section.append(renderLibrary(S.view==='editions'));
  else if(S.view==='review')section.append(renderReview());
  else section.append(renderSources(),element('div',{class:'dcw-editor-grid'},[renderEditor(),renderEdits()]));
  section.setAttribute('data-directory-corrections-ready','true');freeze();
 }
 const beforeUnload=event=>{persist();if(S.dirty||S.pending){event.preventDefault();event.returnValue='';}};
 window.addEventListener('beforeunload',beforeUnload);
 return {
  async open(){
   const state=await observed(()=>getState());need(state?.directory?.workspaceId||state?.workspaceId,'Open the original Directory workspace.');
   S.workspaceId=state.directory?.workspaceId||state.workspaceId;S.actor=state.operatingActor||S.actor;S.catalogue=await api('/api/directory/catalogue');
   need(S.catalogue.inputSchemas?.correction_prepare,'Install the complete original correction catalogue.');
   let saved=null;try{saved=sessionStorage.getItem(key());}catch{S.storageError='Browser storage is unavailable. Download working JSON before leaving.';}
   if(saved){try{await restoreWorking(JSON.parse(saved));}catch(error){S.error='The retained working copy needs review: '+error.message;}}
   render();return S.workspaceId;
  },
  dispose(){persist();S.disposed=true;generation++;window.removeEventListener('beforeunload',beforeUnload);},
  busy:()=>S.busy,
  dirty:()=>S.dirty||!!S.pending
 };
}
