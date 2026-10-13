/** Complete offline workbook desk in the existing supplier comparison shell. */
import {canonicalJSON,sha256,reopenWorkspace,serializeWorkspace} from './supplier-report.mjs';
import {
  RETURN_SCHEMA,createReviewWorkbookModel,reviewWorkbookReturn,
  applyWorkbookReturn,recoverWorkbookReturn,createWorkbookDelivery,receiveWorkbookDelivery,
  workbookBase64,workbookBytes,workbookFileIdentity
} from './review-workbook.mjs';
const IO='conapi.supplier-review-workbook-io.v1',DB='conapi-supplier-workbooks-v1';
const MAX_XLSX=64*1024*1024,MAX_PACKET=256*1024*1024;
const safeName=value=>String(value||'supplier').replace(/[^a-zA-Z0-9._-]+/g,'-').replace(/^[.-]+/,'').slice(0,100)||'supplier';
function problem(code,message){return Object.assign(new Error(message),{code});}
function node(tag,text,attributes={}){
  const element=document.createElement(tag);if(text!==undefined)element.textContent=text;
  for(const [key,value]of Object.entries(attributes)){
    if(key==='class')element.className=value;else if(key==='type')element.type=value;else element.setAttribute(key,String(value));
  }
  return element;
}
function button(text,action){const b=node('button',text,{type:'button'});b.addEventListener('click',action);return b;}
function field(label,control){const holder=node('label',undefined,{class:'swb-field'});holder.append(node('span',label),control);return holder;}
function download(name,content,mime){
  const blob=content instanceof Blob?content:new Blob([content],{type:mime||'application/json;charset=utf-8'});
  const url=URL.createObjectURL(blob),a=node('a');a.href=url;const suffix=String(name).match(/\.[a-z0-9]{1,10}$/i)?.[0]||'';a.download=safeName(suffix?String(name).slice(0,-suffix.length):name)+suffix;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),3000);
}
function show(value){return value===null?'null':typeof value==='string'?value:canonicalJSON(value);}
function summaryDecision(value){
  if(!value)return 'No saved decision';
  const details={action:value.action,reason:value.reason};
  for(const key of ['reviewer','revision','side','rowNumber','values'])if(value[key]!==undefined)details[key]=value[key];
  return canonicalJSON(details);
}
function openDatabase(){
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open(DB,1);
    request.onupgradeneeded=()=>{
      const db=request.result;db.createObjectStore('selections',{keyPath:'comparisonId'});db.createObjectStore('operations',{keyPath:'id'});
      db.createObjectStore('operation-index',{keyPath:'id'}).createIndex('comparisonId','comparisonId');
    };
    request.onsuccess=()=>{request.result.onversionchange=()=>request.result.close();resolve(request.result);};
    request.onerror=()=>reject(request.error);request.onblocked=()=>reject(problem('WORKBOOK_STORAGE_BUSY','Close the older workbook tab so the original browser record can open.'));
  });
}
async function stored(db,store,key){
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(store,'readonly'),request=tx.objectStore(store).get(key);let value;
    request.onsuccess=()=>{value=request.result;};tx.oncomplete=()=>resolve(value);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
  });
}
async function saveSelection(db,value){
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('selections','readwrite');tx.objectStore('selections').put(value);
    tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
  });
}
async function saveOperation(db,value){
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(['operations','operation-index'],'readwrite');tx.objectStore('operations').put(value);
    tx.objectStore('operation-index').put({id:value.id,comparisonId:value.operation.receipt.comparisonId,
      workbookId:value.operation.receipt.workbookId,state:value.state,at:value.operation.receipt.at,
      beforeRevision:value.operation.receipt.beforeRevision,afterRevision:value.operation.receipt.afterRevision,
      items:value.operation.receipt.appliedItems.length,filename:value.filename});
    tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
  });
}
async function operationIndex(db,comparisonId){
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('operation-index','readonly'),store=tx.objectStore('operation-index');
    const request=comparisonId?store.index('comparisonId').getAll(comparisonId):store.getAll();let rows=[];
    request.onsuccess=()=>{rows=request.result;};tx.oncomplete=()=>resolve(rows.sort((a,b)=>b.at.localeCompare(a.at)));
    tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
  });
}
async function request(path,body){
  const response=await fetch('/api/workbook/'+path,{method:'POST',headers:{'content-type':'application/json','x-conapi-workbook':'1'},body:JSON.stringify(body),cache:'no-store'});
  let result;try{result=await response.json();}catch{throw problem('WORKBOOK_RESPONSE_INCOMPLETE','The conversion response was incomplete. Keep this file and retry its conversion.');}
  if(!response.ok){
    if(result?.schema===IO&&result.status===response.status&&result.error&&typeof result.error.code==='string'&&typeof result.error.message==='string')
      throw problem(result.error.code,result.error.message);
    throw problem('WORKBOOK_RESPONSE_INCOMPLETE','The conversion did not return its complete original error envelope. Keep this file and retry.');
  }
  return result;
}
const CSS='.swb{border:1px solid #aaa;background:#fff;margin:18px 0;padding:18px;color:#202020}.swb h2{font-size:19px;margin:0 0 8px}.swb h3{font-size:16px;margin:16px 0 8px}.swb p{margin:8px 0;max-width:105ch}.swb .swb-muted{color:#555}.swb .swb-tools{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:12px 0}.swb button,.swb input,.swb select{font:inherit;border:1px solid #888;border-radius:2px;padding:7px 9px;background:#fff;color:#202020;min-height:36px}.swb button{cursor:pointer}.swb button:hover{background:#eee}.swb button:disabled,.swb input:disabled,.swb select:disabled{opacity:.55;cursor:default}.swb .swb-primary{background:#292929;color:#fff}.swb .swb-primary:hover{background:#111}.swb .swb-field{display:flex;flex-direction:column;gap:4px;font-weight:500;min-width:150px}.swb .swb-upload{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.swb input[type=file]{max-width:340px}.swb .swb-status{white-space:pre-wrap;overflow-wrap:anywhere;border-left:3px solid #555;padding:8px 12px;background:#f4f4f4}.swb .swb-status:empty{display:none}.swb .swb-table{overflow:auto;max-height:720px}.swb table{width:100%;border-collapse:collapse;font-size:12px}.swb th,.swb td{border:1px solid #bbb;padding:8px;vertical-align:top;text-align:left;min-width:120px;max-width:360px;overflow-wrap:anywhere}.swb th{background:#e7e7e7;position:sticky;top:0}.swb pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.45 ui-monospace,monospace;margin:0;max-width:400px}.swb details{border:1px solid #bbb;padding:10px;margin:8px 0}.swb summary{cursor:pointer;font-weight:550}.swb .swb-history{display:grid;gap:8px}.swb .swb-history-row{padding:10px;border:1px solid #bbb;display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap}.swb .swb-history-row p{margin:0}.swb button:focus-visible,.swb input:focus-visible,.swb select:focus-visible{outline:2px solid #222;outline-offset:2px}.swb .swb-code{font-family:ui-monospace,monospace;font-size:12px;overflow-wrap:anywhere}.swb [hidden]{display:none!important}@media(max-width:760px){.swb{padding:12px}.swb input[type=file]{max-width:100%}.swb .swb-field{width:100%}.swb .swb-tools{align-items:stretch}.swb .swb-tools button{flex:1}.swb .swb-table{max-height:580px}}';
export function mountWorkbookReview(root,{getReport,onChange,onBusy=()=>{},onError=()=>{},mayReplace=()=>true}={}){
  if(!root||typeof getReport!=='function'||typeof onChange!=='function')throw Error('The original supplier workspace callbacks are required.');
  let current=getReport(),selection=null,preview=null,history=[],busy=false,externalBusy=false,alive=true,epoch=0,page=0,filter='all',query='',lastAttempt=null,dbPromise,historyLimit=30;
  const database=()=>dbPromise||(dbPromise=openDatabase().catch(error=>{dbPromise=null;throw error;}));
  root.classList.add('swb');
  const style=node('style',CSS),title=node('h2','Offline workbook review');
  const introduction=node('p','Export this comparison as an editable Excel workbook. Bring the reviewed file back to compare its decisions with the current workspace, then apply through the original supplier review.');
  const source=node('p','Open a supplier comparison to export a workbook.',{class:'swb-muted swb-code'});
  const notice=node('div','',{class:'swb-status',role:'status','aria-live':'polite'});
  const exportButton=button('Download review workbook',()=>run(exportWorkbook));
  const upload=node('input',undefined,{type:'file',accept:'.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','aria-label':'Return reviewed workbook'});
  const receive=node('input',undefined,{type:'file',accept:'.json,application/json','aria-label':'Open complete workbook delivery'});
  const tools=node('div',undefined,{class:'swb-tools'});
  tools.append(exportButton,field('Return reviewed XLSX',upload),field('Receive complete delivery JSON',receive));
  const selected=node('section'),selectedInfo=node('p','',{class:'swb-code'}),selectedHint=node('p','',{class:'swb-muted'});
  const reviewButton=button('Review returned decisions',()=>run(reviewReturn));
  const openBasisButton=button('Open original workbook basis',()=>run(openBasis));
  const originalDownload=button('Download retained XLSX',()=>run(async()=>{
    if(!selection)throw Error('Select a returned workbook.');download(selection.filename,workbookBytes(selection.contentBase64),'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  }));
  const compareTools=node('div',undefined,{class:'swb-tools'});compareTools.append(reviewButton,openBasisButton,originalDownload);
  selected.append(node('h3','Returned workbook'),selectedInfo,selectedHint,compareTools);
  const reviewSection=node('section'),reviewInfo=node('p'),reviewNote=node('p','',{class:'swb-muted'});
  const filterSelect=node('select',undefined,{'aria-label':'Decision filter'});
  for(const [value,label]of [['all','All returned decisions'],['conflict','Changed since export'],['ready','Ready to apply'],['already_current','Already current']]){
    const option=node('option',label);option.value=value;filterSelect.append(option);
  }
  const search=node('input',undefined,{type:'search',placeholder:'Find key, action or reason','aria-label':'Find returned decision'});
  const pagination=node('span','',{class:'swb-muted'}),previous=button('Previous',()=>{page=Math.max(0,page-1);renderRows();}),next=button('Next',()=>{page++;renderRows();});
  const rowTools=node('div',undefined,{class:'swb-tools'});rowTools.append(filterSelect,search,previous,pagination,next);
  const tableWrap=node('div',undefined,{class:'swb-table'}),table=node('table'),thead=node('thead'),tbody=node('tbody'),tr=node('tr');
  for(const label of ['Key / change','At workbook export','Current saved decision','Returned decision','Resolution'])tr.append(node('th',label,{scope:'col'}));
  thead.append(tr);table.append(thead,tbody);tableWrap.append(table);
  const finalizeInput=node('input',undefined,{type:'checkbox'}),finalizeLabel=node('label',undefined,{class:'swb-upload'});
  finalizeLabel.append(finalizeInput,node('span','Require complete finalized output'));
  const applyButton=button('Apply reviewed return',()=>run(applyReturn));applyButton.classList.add('swb-primary');
  const downloadPreview=button('Download exact review JSON',()=>{if(preview)download('Supplier_Workbook_Review.json',canonicalJSON(preview)+'\n');});
  const applyTools=node('div',undefined,{class:'swb-tools'});applyTools.append(finalizeLabel,applyButton,downloadPreview);
  reviewSection.append(node('h3','Review against the current workspace'),reviewInfo,reviewNote,rowTools,tableWrap,applyTools);
  const historySection=node('section'),historyList=node('div','',{class:'swb-history'});
  const refreshHistory=button('Refresh saved workbook operations',()=>run(loadHistory));
  historySection.append(node('h3','Saved returns and recovery'),refreshHistory,historyList);
  const guidance=node('details');guidance.append(node('summary','Workbook and receiving instructions'),
    node('p','Enter your reviewer name in Review B8. Choose one of the five original decisions and a reason. For replace, edit every canonical field in Corrections. Text values remain text; null and a blank string are different. Source values and the hidden Basis sheet retain the complete original editions.'),
    node('p','Sorting and filtering are supported. Keep every original row identity. Long text uses ordered parts. After upload, overlapping saved decisions require an explicit current/returned choice. The review below shows the complete decision inputs.'),
    node('p','Applying first saves the exact operation and result in this browser, then adopts the original workspace. Download the complete delivery JSON to carry the returned XLSX, original workspace, review, request/result and native exports to another machine.'),
    node('p','Spreadsheet conversion uses the installed Analysis Python environment on this original local server. Set CONAPI_WORKBOOK_PYTHON when that environment has a separate executable. Source CSVs, workspaces and decision history continue using the original supplier engine.'));
  root.replaceChildren(style,title,introduction,source,tools,notice,selected,reviewSection,historySection,guidance);

  function say(message){notice.textContent=message;}
  function selectedComparison(){if(!selection)return null;try{return JSON.parse(selection.parsed.basisText).comparisonId;}catch{return null;}}
  function filtered(){
    if(!preview)return [];
    const lower=query.trim().toLowerCase();
    return preview.rows.filter(row=>(filter==='all'||row.status===filter)&&(!lower||canonicalJSON({
      key:row.key,action:row.action,reason:row.returnedDecision.reason,itemId:row.itemId
    }).toLowerCase().includes(lower)));
  }
  function controls(){
    const locked=busy||externalBusy;
    for(const element of root.querySelectorAll('button,input,select'))element.disabled=locked;
    exportButton.disabled=locked||!current;reviewButton.disabled=locked||!selection||!current||selectedComparison()!==current.comparisonId;
    openBasisButton.disabled=locked||!selection;originalDownload.disabled=locked||!selection;
    applyButton.disabled=locked||!preview||!preview.canApply||!current;downloadPreview.disabled=locked||!preview;
    finalizeInput.disabled=locked||!preview?.canFinalize;previous.disabled=locked||page===0;
    next.disabled=locked||(page+1)*25>=filtered().length;
  }
  function render(){
    source.textContent=current?current.requestId+' · '+current.comparisonId+' · current revision '+current.revision:'Open a supplier comparison, a returned workbook basis, or a complete delivery.';
    selected.hidden=!selection;reviewSection.hidden=!preview;
    if(selection){
      selectedInfo.textContent=selection.filename+' · '+selection.parsed.file.bytes.toLocaleString()+' bytes · '+selection.parsed.file.sha256;
      const basis=JSON.parse(selection.parsed.basisText);
      selectedHint.textContent='Workbook '+selection.parsed.workbookId+' · exported revision '+basis.revision+
        ' · reviewer '+(selection.parsed.reviewer||'(enter in Review B8)')+
        (basis.comparisonId!==current?.comparisonId?' · open its original comparison to review this return.':'');
    }
    if(preview){
      const counts=preview.summary;
      reviewInfo.textContent=counts.returned+' returned decisions · '+counts.apply+' selected to apply · '+counts.alreadyCurrent+
        ' already current · '+counts.keptCurrent+' current decisions retained · '+preview.unresolved+' unresolved overlaps.';
      reviewNote.textContent='Original revision '+preview.sourceRevision+' → current revision '+preview.currentRevision+
        '. Native projected review: '+counts.projected.pending+' pending / '+counts.projected.blocking+' output conflicts.'+
        (preview.note?' Return note: '+preview.note:'');
      if(!preview.canFinalize)finalizeInput.checked=false;
    }
    renderRows();renderHistory();controls();
  }
  function renderRows(){
    const rows=filtered(),pages=Math.max(1,Math.ceil(rows.length/25));page=Math.min(page,pages-1);
    pagination.textContent=rows.length+' items · page '+(page+1)+' of '+pages;tbody.replaceChildren();
    for(const row of rows.slice(page*25,page*25+25)){
      const tr=node('tr'),key=node('td');
      key.append(node('strong',show(row.key)),node('p',row.change),node('small',row.itemId,{class:'swb-code'}));tr.append(key);
      for(const value of [row.baseDecision,row.currentDecision,row.returnedDecision]){
        const cell=node('td');cell.append(node('pre',summaryDecision(value)));tr.append(cell);
      }
      const last=node('td');
      if(row.status==='conflict'){
        const select=node('select',undefined,{'aria-label':'Resolve '+show(row.key)});
        for(const [value,label]of [['','Choose a resolution'],['keep_current','Keep current decision'],['use_returned','Use returned decision']]){
          const option=node('option',label);option.value=value;select.append(option);
        }
        select.value=selection.resolutions[row.itemId]||'';
        select.addEventListener('change',()=>run(async()=>{
          const value=select.value;if(value)selection.resolutions[row.itemId]=value;else delete selection.resolutions[row.itemId];
          await reviewReturn();
        }));last.append(select);
      }else last.append(node('p',row.status==='already_current'?'Already current; no duplicate decision':'Apply returned decision'));
      tr.append(last);tbody.append(tr);
    }
    controls();
  }
  function renderHistory(){
    historyList.replaceChildren();
    if(!history.length)historyList.append(node('p','No saved workbook operation for this comparison.',{class:'swb-muted'}));
    for(const row of history.slice(0,historyLimit)){
      const entry=node('div',undefined,{class:'swb-history-row'}),description=node('div'),actions=node('div',undefined,{class:'swb-tools'});
      description.append(node('p',row.id+' · '+row.state),node('p','Revision '+row.beforeRevision+' → '+row.afterRevision+' · '+row.items+' decisions · '+row.at,{class:'swb-code'}));
      actions.append(button('Download complete delivery',()=>run(()=>downloadOperation(row.id))),button('Open saved result',()=>run(()=>openResult(row.id))));
      if(row.state==='PREPARED'||row.state==='RECEIVING')actions.append(button('Resume original adoption',()=>run(()=>resume(row.id))),button('Keep attempt and review return again',()=>run(()=>reviewAgain(row.id))));
      entry.append(description,actions);historyList.append(entry);
    }
    if(history.length>historyLimit)historyList.append(button('Show 30 older operations',()=>{historyLimit+=30;renderHistory();controls();}));
    if(lastAttempt&&!history.some(row=>row.id===lastAttempt.id)){
      const entry=node('div',undefined,{class:'swb-history-row'});
      entry.append(node('p','The complete prepared result is still in memory; browser storage has not confirmed it.'),
        button('Download prepared delivery',()=>run(async()=>{const packet=await createWorkbookDelivery(lastAttempt.operation,lastAttempt.contentBase64);download(safeName(lastAttempt.id)+'.workbook-delivery.json',canonicalJSON(packet)+'\n');})),
        button('Retry saving and adopting original result',()=>run(async()=>{await saveOperation(await database(),lastAttempt);await adopt(lastAttempt);})));
      historyList.prepend(entry);
    }
  }
  async function run(action){
    if(busy||externalBusy||!alive)return;epoch++;busy=true;onBusy(true);controls();
    try{await action();}catch(error){say((error.code?error.code+': ':'')+error.message);onError(error);}
    finally{busy=false;onBusy(false);if(alive)render();}
  }
  async function loadHistory(){
    const selectedId=current?.comparisonId,attempt=++epoch,rows=await operationIndex(await database(),selectedId);
    if(alive&&attempt===epoch&&current?.comparisonId===selectedId){history=rows;renderHistory();}
  }
  async function exportWorkbook(){
    const report=getReport();if(!report)throw Error('Open the original supplier comparison.');
    const workspace=serializeWorkspace(report),model=createReviewWorkbookModel(report);
    say('Creating the complete source-bound review workbook…');
    const result=await request('write',{workspace});
    if(result?.schema!==IO||result.action!=='write'||result.workbookId!==model.workbookId||result.basisSha256!==model.basisSha256||result.workspaceSha256!==model.workspaceSha256)
      throw problem('WORKBOOK_RESPONSE_CHANGED','The workbook response selected another original source.');
    const file=workbookBytes(result.file?.contentBase64),identity=await workbookFileIdentity(file);
    if(identity.bytes!==result.file.bytes||identity.sha256!==result.file.sha256)throw problem('WORKBOOK_FILE_CHANGED','The returned workbook bytes differ from their native receipt.');
    download(safeName(report.requestId)+'-r'+report.revision+'.review.xlsx',file,result.file.contentType);
    say('Complete workbook downloaded: '+model.items.length+' review items, '+model.sourceRows.length+' source-value parts, revision '+report.revision+'.');
  }
  async function uploadReturn(file){
    if(file.size>MAX_XLSX||!file.size)throw problem('WORKBOOK_SIZE','Choose a nonempty XLSX within 64 MiB.');
    const data=new Uint8Array(await file.arrayBuffer()),identity=await workbookFileIdentity(data),contentBase64=workbookBase64(data);
    say('Reading the complete returned workbook and original source basis…');
    const parsed=await request('read',{contentBase64,sha256:identity.sha256});
    if(parsed?.schema!==RETURN_SCHEMA||parsed.file?.sha256!==identity.sha256||parsed.file.bytes!==identity.bytes)throw problem('WORKBOOK_FILE_CHANGED','The returned parse selected another original XLSX.');
    const basis=JSON.parse(parsed.basisText),original=reopenWorkspace(basis.workspace),model=createReviewWorkbookModel(original);
    if(model.basisSha256!==parsed.basisSha256||model.workbookId!==parsed.workbookId||model.basisText!==parsed.basisText)throw problem('WORKBOOK_BASIS_CHANGED','The returned source basis differs from the original engine.');
    const next={comparisonId:original.comparisonId,filename:file.name,contentBase64,parsed,resolutions:{},savedAt:new Date().toISOString()};
    await saveSelection(await database(),next);selection=next;preview=null;page=0;
    say('Returned XLSX and complete original basis saved. Review its decisions against the current workspace.');
    if(current?.comparisonId===original.comparisonId)await reviewReturn();
  }
  async function reviewReturn(){
    preview=null;controls();
    if(!selection)throw Error('Choose a returned workbook.');
    const actual=getReport();if(!actual)throw Error('Open the original comparison first.');
    const next=reviewWorkbookReturn(actual,selection.parsed,{resolutions:selection.resolutions});
    const saved={...selection,preview:next,savedAt:new Date().toISOString()};await saveSelection(await database(),saved);
    current=getReport();if(!current||sha256(serializeWorkspace(current))!==next.currentWorkspaceSha256)throw problem('WORKBOOK_REVIEW_CHANGED','The original workspace changed while this review was being saved. Review again.');
    selection=saved;preview=next;
    say(next.unresolved?'Resolve '+next.unresolved+' decisions that changed after workbook export.':'The complete return is reviewed against current revision '+next.currentRevision+'.');
  }
  async function openBasis(){
    if(!selection)throw Error('Choose a returned workbook.');if(!await mayReplace())return;
    const original=reopenWorkspace(JSON.parse(selection.parsed.basisText).workspace);
    await onChange(original);current=getReport();preview=null;say('Opened the exact original workbook basis. Its complete source and history remain unchanged.');await loadHistory();
  }
  async function applyReturn(){
    if(!selection||!preview)throw Error('Review the returned workbook first.');
    const actual=getReport();if(!actual)throw Error('Open the original comparison.');
    const pending=(await operationIndex(await database(),actual.comparisonId)).find(row=>row.state==='PREPARED'||row.state==='RECEIVING');
    if(pending)throw problem('WORKBOOK_ORIGINAL_PENDING','Resume saved operation '+pending.id+' or keep that attempt and review again before starting another adoption.');
    const operation=applyWorkbookReturn(actual,selection.parsed,preview,{operationId:'workbook-return-'+crypto.randomUUID(),finalizeOutput:finalizeInput.checked});
    const entry={id:operation.operationId,state:'PREPARED',filename:selection.filename,contentBase64:selection.contentBase64,operation};lastAttempt=entry;
    await saveOperation(await database(),entry);await adopt(entry);
  }
  async function adopt(entry){
    const actual=getReport();if(!actual)throw Error('Open the original supplier comparison before resuming adoption.');
    const recovered=recoverWorkbookReturn(actual,entry.operation);
    await onChange(recovered.report);current=getReport();
    if(!current||current.comparisonId!==entry.operation.receipt.comparisonId||recoverWorkbookReturn(current,entry.operation).status!=='ALREADY_APPLIED')
      throw problem('WORKBOOK_ADOPTION_UNCONFIRMED','The original shell has not confirmed this saved result. Resume the same operation.');
    await saveOperation(await database(),{...entry,state:'ADOPTED',adoptedAt:new Date().toISOString()});lastAttempt=null;preview=null;
    say('Original supplier workspace updated to revision '+current.revision+'. Save the workspace and download its complete workbook delivery.');await loadHistory();
  }
  async function getOperation(id){
    const saved=lastAttempt?.id===id?lastAttempt:await stored(await database(),'operations',id);
    if(!saved)throw problem('WORKBOOK_OPERATION_MISSING','The complete original operation is not in this browser. Receive its delivery packet.');
    return saved;
  }
  async function resume(id){
    const saved=await getOperation(id);
    if(saved.state==='RECEIVING'&&(!current||current.comparisonId!==saved.operation.receipt.comparisonId)){
      if(!await mayReplace())return;await onChange(reopenWorkspace(saved.operation.afterWorkspace));current=getReport();
    }
    await adopt(saved);
  }
  async function downloadOperation(id){
    const saved=await getOperation(id),packet=await createWorkbookDelivery(saved.operation,saved.contentBase64);
    download(safeName(id)+'.workbook-delivery.json',canonicalJSON(packet)+'\n');
    say('Complete workbook delivery downloaded with the original returned file, request, review, workspace and native exports.');
  }
  async function openResult(id){
    const saved=await getOperation(id);if(!await mayReplace())return;
    await onChange(reopenWorkspace(saved.operation.afterWorkspace));current=getReport();preview=null;
    say('Opened the exact retained result at revision '+current.revision+'. Later saved work remains in its original workspace file.');await loadHistory();
  }
  async function reviewAgain(id){
    const saved=await getOperation(id),actual=getReport();
    if(!actual||actual.comparisonId!==saved.operation.receipt.comparisonId)throw Error('Open this operation’s current original comparison before reviewing again.');
    const next={comparisonId:actual.comparisonId,filename:saved.filename,contentBase64:saved.contentBase64,parsed:saved.operation.input,resolutions:{},savedAt:new Date().toISOString()};
    await saveOperation(await database(),{...saved,state:'KEPT_FOR_REVIEW',keptAt:new Date().toISOString()});await saveSelection(await database(),next);
    selection=next;preview=null;lastAttempt=null;await reviewReturn();await loadHistory();
  }
  async function receiveDelivery(file){
    if(!file.size||file.size>MAX_PACKET)throw problem('WORKBOOK_SIZE','Choose a complete delivery JSON within 256 MiB.');
    const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(await file.arrayBuffer()),packet=JSON.parse(text),received=await receiveWorkbookDelivery(packet,{
      readWorkbook:async contentBase64=>{
        const identity=await workbookFileIdentity(workbookBytes(contentBase64));
        return request('read',{contentBase64,sha256:identity.sha256});
      }
    });
    const actual=getReport();
    const target=actual?.comparisonId===received.report.comparisonId?recoverWorkbookReturn(actual,received.operation).report:received.report;
    if(!await mayReplace())return;
    const id=received.operation.operationId,db=await database(),existing=await stored(db,'operations',id);
    if(existing&&canonicalJSON(existing.operation)!==canonicalJSON(received.operation))throw problem('WORKBOOK_OPERATION_CHANGED','That original operation ID already names a different retained request.');
    const entry=existing||{id,state:'RECEIVING',filename:'returned.xlsx',contentBase64:received.contentBase64,operation:received.operation};
    lastAttempt=entry;await saveOperation(db,entry);await onChange(target);current=getReport();await adopt(entry);
    say('Complete original workbook delivery received and reopened at revision '+current.revision+'.');
  }
  upload.addEventListener('change',()=>{const file=upload.files?.[0];upload.value='';if(file)run(()=>uploadReturn(file));});
  receive.addEventListener('change',()=>{const file=receive.files?.[0];receive.value='';if(file)run(()=>receiveDelivery(file));});
  filterSelect.addEventListener('change',()=>{filter=filterSelect.value;page=0;renderRows();});
  search.addEventListener('input',()=>{query=search.value;page=0;renderRows();});
  async function restoreForReport(){
    const id=current?.comparisonId,attempt=++epoch;
    try{
      const db=await database(),[saved,rows]=await Promise.all([id?stored(db,'selections',id):Promise.resolve(null),operationIndex(db,id)]);
      if(!alive||attempt!==epoch||current?.comparisonId!==id)return;
      if(saved)selection=saved;else if(selection&&selectedComparison()!==id)selection=null;
      preview=null;history=rows;render();
    }catch(error){if(alive&&attempt===epoch){say('Browser workbook storage: '+error.message);onError(error);}}
  }
  render();void restoreForReport();
  return {
    setExternalBusy(value){externalBusy=!!value;controls();},
    setReport(report){const prior=current?.comparisonId;current=report;preview=null;page=0;if(prior!==report?.comparisonId)historyLimit=30;if(!busy&&prior!==report?.comparisonId)void restoreForReport();render();},
    destroy(){alive=false;epoch++;if(busy)onBusy(false);dbPromise?.then(db=>db.close()).catch(()=>{});root.replaceChildren();}
  };
}
