// MIT. Industrial operator for original RIS documents in the existing Research workspace.
import {createRisDraftStore,assertRisReceipt} from './ris-drafts.js';
const sessions=new Map(),PAGE=30,RAW_LIMIT=8*1024*1024,MAX_FILES=32;
const clone=value=>structuredClone(value),uuid=()=>crypto.randomUUID(),now=()=>new Date().toISOString();
const node=(tag,text,className)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=String(text);if(className)n.className=className;return n;};
const option=(value,label)=>{const n=node('option',label);n.value=value;return n;};
const button=(label,action,className='secondary')=>{const n=node('button',label,className);n.type='button';n.addEventListener('click',action);return n;};
const field=(label,control)=>{const n=node('label',undefined,'ris-field');n.append(node('span',label),control);return n;};
const code=value=>value?.code??value?.message??'RIS_OPERATION_FAILED';
const hash=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(value=>value.toString(16).padStart(2,'0')).join('');
function base64(bytes){let s='';for(let i=0;i<bytes.length;i+=32768)s+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(s);}
const nativeBytes=value=>{const raw=atob(value),out=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)out[i]=raw.charCodeAt(i);return out;};
const download=(bytes,filename,type='application/json')=>{
  const url=URL.createObjectURL(new Blob([bytes],{type})),a=node('a');a.href=url;a.download=filename;
  document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
};
const identity=row=>row.requestId;
const pretty=value=>JSON.stringify(value,null,2);
const errorText=error=>{
  const messages={
    REVISION_CONFLICT:'The dossier changed before this import was saved. Your complete review and original request remain available.',
    RIS_REVIEW_INCOMPLETE:'Resolve the listed source and duplicate decisions before receiving.',
    RIS_REQUEST_INPUT_CHANGED:'This request ID already belongs to a different saved review. Open its original receipt.',
    RIS_DRAFT_CHANGED_IN_ANOTHER_WINDOW:'Another window saved this draft. Your full local version is still retained here; download it or create a separate draft.',
    RIS_BROWSER_DRAFT_NOT_SAVED:'The complete draft has not reached browser storage. Keep this window open and download the recovery file.',
  };return messages[code(error)]??String(code(error)).replaceAll('_',' ');
};
function sourceInput(source){
  return {label:source.label,preparedAt:source.preparedAt,sourceReference:source.sourceReference,
    sourceTerms:source.sourceTerms,documents:source.documents.map(({id,...row})=>row)};
}
function draftFor(context,view,{source,previous=null}={}){
  const requestId='ris-'+uuid(),questionId=previous?.questionId??view.questions[0]?.id??'';
  return {schema:'sf88-research-ris-browser-draft-v1',workspaceId:context.workspaceId,dossierId:view.id,
    requestId,editId:uuid(),createdAt:now(),updatedAt:now(),baseRevision:view.revision,
    sourceInput:source?sourceInput(source):{label:'',preparedAt:now(),sourceReference:'',sourceTerms:'',documents:[]},
    source:null,provenanceText:source?source.documents.map(row=>pretty(row.declaration.provenance)):[],
    review:{requestId,questionId,actor:'',reviewedAt:now(),records:[],duplicates:[],
      acknowledgedDiagnostics:[],previous:previous?{editionId:previous.editionId,sha256:previous.edition.sha256,priorSelection:'keep'}:null}};
}
export function createRisSourcesPanel({root,tab,api,task,notify,getDossier,getWorkspace,isBusy,onReceived}){
  root.classList.add('ris-workbench');let session=null,visible=false,closed=false;
  const header=node('div',undefined,'ris-heading'),heading=node('div'),tools=node('div',undefined,'ris-actions');
  heading.append(node('p','RETAINED SOURCE OPERATIONS','eyebrow'),node('h2','RIS sources'),
    node('p','Receive original bibliographic files, resolve conflicting fields and duplicate records, and keep the complete source behind every decision.','muted'));
  const newButton=button('New RIS import',()=>run(newDraft),'primary'),refreshButton=button('Refresh saved work',()=>run(refresh));
  tools.append(newButton,refreshButton);header.append(heading,tools);
  const nav=node('div',undefined,'ris-mode-tabs'),status=node('p','', 'ris-status'),storage=node('p','','ris-storage');
  const body=node('div',undefined,'ris-body');root.replaceChildren(header,nav,status,storage,body);
  const base=(suffix='')=>'/api/dossiers/'+encodeURIComponent(session.dossierId)+'/ris-sources'+suffix;
  const request=(suffix,options={})=>api(base(suffix),{sourceProjection:'full',workspaceId:session.workspaceId,...options});
  async function run(action){
    return task(async()=>{if(closed)return;try{await action();}catch(error){setStatus(errorText(error),'error');throw error;}finally{updateBusy();}});
  }
  function setStatus(message,kind='info'){status.textContent=message;status.dataset.kind=kind;}
  function branch(draft){
    const key=draft.requestId;
    if(!session.branches.has(key))session.branches.set(key,{snapshot:clone(draft),unsaved:null,error:null,lastStoredEditId:null,queue:Promise.resolve()});
    return session.branches.get(key);
  }
  function paintStorage(){
    if(!session){storage.textContent='';return;}
    const unsaved=[...session.branches.values()].filter(row=>row.unsaved);
    const errors=unsaved.filter(row=>row.error);
    storage.textContent=errors.length?'Browser storage has not acknowledged '+errors.length+' complete draft(s). Keep this page open; recovery downloads remain available.':
      unsaved.length?'Saving complete draft…':'Complete edits are saved in this browser.';
    storage.dataset.kind=errors.length?'error':'info';
  }
  function persist(){
    const owner=session,draft=clone(owner.draft),entry=branch(draft);
    entry.snapshot=draft;entry.unsaved=draft;entry.error=null;paintStorage();
    // Retain the newest complete edit synchronously. At most one older snapshot
    // is in an IndexedDB transaction; keystrokes do not queue full source copies.
    if(!entry.writing){
      entry.writing=true;
      entry.queue=Promise.resolve().then(async()=>{
        while(entry.unsaved){
          const saving=entry.unsaved;
          try{
            await owner.store.putDraft(saving,{expectedEditId:entry.lastStoredEditId});
            entry.lastStoredEditId=saving.editId;
            if(entry.unsaved?.editId===saving.editId)entry.unsaved=null;
            entry.error=null;
          }catch(error){entry.error=error;break;}
          if(session===owner)paintStorage();
        }
      }).finally(()=>{entry.writing=false;if(session===owner)paintStorage();});
    }
    return entry.queue;
  }
  function invalidProvenance(draft=session?.draft){
    return (draft?.provenanceText??[]).some(value=>{
      if(typeof value!=='string')return true;
      try{JSON.parse(value);return false;}catch{return true;}
    });
  }
  function touch(update,{sourceChanged=false}={}){
    if(!session?.draft||session.pending){setStatus('Recover the existing pending request before editing its review.','error');return;}
    const draft=session.draft;
    if(sourceChanged&&draft.source){
      if(draft.previousSourceReview){
        draft.previousSourceReviews??=[];draft.previousSourceReviews.push(draft.previousSourceReview);
      }
      draft.previousSourceReview={sourceInput:clone(draft.sourceInput),source:clone(draft.source),
        review:clone(draft.review),provenanceText:clone(draft.provenanceText??[]),
        reviewedEditId:draft.editId,retainedAt:now()};
    }
    update(draft);draft.editId=uuid();draft.updatedAt=now();
    // Keep the full previous choices. The next native preview reuses only exact
    // unchanged record/group identities and retains unmatched review branches.
    if(sourceChanged)draft.source=null;
    session.previewEditId=null;persist();paintPlan();updateBusy();
  }
  async function flush(){
    if(!session?.draft)return;
    const entry=branch(session.draft);await entry.queue;
    if(entry.unsaved)throw Object.assign(new Error('RIS_BROWSER_DRAFT_NOT_SAVED'),{code:'RIS_BROWSER_DRAFT_NOT_SAVED'});
  }
  async function loadSummaries(owner=session){
    try{
      const [drafts,pending]=await Promise.all([owner.store.listDrafts(),owner.store.listPending()]);
      owner.draftSummaries=drafts;owner.pendingSummaries=pending;owner.storageError=null;
    }catch(error){owner.storageError=error;owner.draftSummaries??=[];owner.pendingSummaries??=[];}
    const rows=new Map((owner.draftSummaries??[]).map(row=>[identity(row),row]));
    for(const[requestId,entry]of owner.branches)if(entry.unsaved)rows.set(requestId,{requestId,editId:entry.snapshot.editId,
      label:entry.snapshot.sourceInput.label||'RIS review',updatedAt:entry.snapshot.updatedAt,localOnly:true});
    owner.draftSummaries=[...rows.values()];
  }
  async function refresh(){
    if(!session)return;
    const owner=session,result=await request('?limit=100');
    owner.editions=result.items;owner.moreEditions=result.nextOffset;owner.currentRevision=result.dossier.revision;
    await loadSummaries(owner);owner.loaded=true;if(session===owner)render();
  }
  async function newDraft(){
    if(!getDossier()?.questions?.length){setStatus('Create a dossier question before importing RIS sources.','error');return;}
    if(session.draft)await persist();
    session.draft=draftFor(session,getDossier());session.pending=null;session.preview=null;session.previewEditId=null;
    session.mode='draft';session.page=0;branch(session.draft);await persist();await loadSummaries();render();
  }
  async function openDraft(requestId){
    const owner=session,local=owner.branches.get(requestId)?.unsaved;
    const draft=local??await owner.store.readDraft(requestId);
    if(!draft)throw Object.assign(new Error('RIS_DRAFT_NOT_FOUND'),{code:'RIS_DRAFT_NOT_FOUND'});
    if(session!==owner)return;
    session.draft=clone(draft);const entry=branch(draft);
    if(!local)entry.lastStoredEditId=draft.editId;
    session.pending=await owner.store.readPending(requestId);session.preview=null;session.previewEditId=null;
    session.mode='draft';session.page=0;render();
    if(session.pending?.state==='COMPLETE')await accepted({dossier:{id:owner.dossierId},receipt:session.pending.receipt},false);
    else if(session.draft.source&&!session.pending)await preview();
  }
  async function openPending(requestId){
    const pending=await session.store.readPending(requestId);if(!pending)return;
    session.pending=pending;session.mode='draft';session.preview=null;
    const draft=session.branches.get(requestId)?.unsaved??await session.store.readDraft(requestId);
    session.draft=draft?clone(draft):null;render();
    if(pending.state==='COMPLETE'){session.receipt=pending.receipt;render();}
  }
  function paintPlan(){
    const el=root.querySelector('[data-ris-plan]');
    if(el)el.textContent=session?.pending?'An original receiving request is retained for recovery.':
      session?.previewEditId===session?.draft?.editId?
      (session.preview.complete?'Ready for the original receiving revision.':session.preview.counts.unresolvedIssues+' review issue(s) remain.'):
      'Refresh the review after editing to obtain the exact receiving plan.';
  }
  async function preview(){
    const draft=session.draft;if(!draft)return;
    if(invalidProvenance(draft))throw Object.assign(new Error('RIS_PROVENANCE_JSON_INVALID'),{code:'RIS_PROVENANCE_JSON_INVALID'});
    await flush();const owner=session,editId=draft.editId,chosen=clone(draft.review);
    const page={offset:session.page*PAGE,limit:PAGE};
    // Derive the current original record/group identities first. This keeps old
    // decisions available without assigning them to a changed source or DOI.
    let result=draft.source?
      await request('/preview',{method:'POST',body:{source:draft.source,review:{...chosen,duplicates:[]},...page}}):
      await request('/prepare',{method:'POST',body:{source:draft.sourceInput,
        review:{...chosen,records:[],duplicates:[],acknowledgedDiagnostics:[]},...page}});
    if(!draft.source){
      const old=new Map((draft.unmatchedRecordReviews??[]).map(row=>[row.recordId,row]));
      for(const row of chosen.records)old.set(row.recordId,row);
      const records=result.review.records.map(row=>clone(old.get(row.recordId)??row));
      const allowed=new Set(result.diagnostics.map(row=>row.id));
      const acknowledgedDiagnostics=chosen.acknowledgedDiagnostics.filter(id=>allowed.has(id));
      if(pretty(records)!==pretty(result.review.records)||acknowledgedDiagnostics.length){
        result=await request('/preview',{method:'POST',body:{source:result.source,
          review:{...result.review,records,acknowledgedDiagnostics,duplicates:[]},...page}});
      }
    }
    const candidates=new Map((draft.unmatchedDuplicateReviews??[]).map(row=>[row.groupId,row]));
    for(const row of chosen.duplicates)candidates.set(row.groupId,row);
    const groupIds=new Set(result.groups.map(row=>row.id)),duplicates=[...candidates.values()].filter(row=>groupIds.has(row.groupId));
    const unmatched=[...candidates.values()].filter(row=>!groupIds.has(row.groupId));
    if(duplicates.length)result=await request('/preview',{method:'POST',body:{source:result.source,
      review:{...result.review,duplicates},...page}});
    if(session!==owner||session.draft?.editId!==editId)return;
    const currentIds=new Set(result.review.records.map(row=>row.recordId));
    const priorRecords=new Map((draft.unmatchedRecordReviews??[]).filter(row=>!currentIds.has(row.recordId)).map(row=>[row.recordId,row]));
    for(const row of chosen.records)if(!currentIds.has(row.recordId))priorRecords.set(row.recordId,clone(row));
    session.draft.source=result.source;session.draft.review=result.review;
    session.draft.unmatchedDuplicateReviews=clone(unmatched);
    session.draft.unmatchedRecordReviews=[...priorRecords.values()];
    session.draft.editId=uuid();session.draft.updatedAt=now();session.preview=result;
    session.previewEditId=session.draft.editId;session.currentRevision=result.dossier.revision;
    await persist();render();
    if(unmatched.length||priorRecords.size)setStatus('The current review is ready to inspect. Earlier decisions whose original identities changed remain in the complete draft.','warning');
    if(result.receipt)await accepted(result);
  }

  async function accepted(result,saveReceipt=true){
    const owner=session,pending=owner.pending,receipt=result.receipt;
    const body=pending?.body??(owner.draft&&owner.previewEditId===owner.draft.editId?{
      source:owner.draft.source,review:owner.draft.review,expectedPlanSha256:owner.preview.planSha256,
      expectedRevision:owner.draft.baseRevision}:null);
    await assertRisReceipt(result,{workspaceId:owner.workspaceId,dossierId:owner.dossierId,
      requestId:pending?.requestId??owner.draft?.requestId,body});
    if(pending&&saveReceipt)await owner.store.completePending(pending.requestId,result);
    owner.receipt=clone(receipt);owner.pending=null;owner.pendingError=null;owner.rebaseProof=null;
    if(pending){
      await owner.store.removeDraft(pending.requestId,pending.draftEditId);
      const entry=owner.branches.get(pending.requestId);
      if(entry?.snapshot.editId===pending.draftEditId)owner.branches.delete(pending.requestId);
      if(owner.draft?.editId===pending.draftEditId)owner.draft=null;
    }
    setStatus('RIS edition saved in original dossier revision '+receipt.revision+'. The same request can recover this receipt.');
    const view=await api('/api/dossiers/'+encodeURIComponent(owner.dossierId),
      {sourceProjection:'inspection',workspaceId:owner.workspaceId});
    await onReceived(view);if(session===owner){await refresh();owner.mode='editions';render();}
  }
  async function reconcilePending(){
    const pending=session.pending;if(!pending)return;
    try{
      const result=await request('?requestId='+encodeURIComponent(pending.requestId));
      await accepted(result);
    }catch(error){
      if(code(error)!=='RIS_REQUEST_NOT_FOUND')throw error;
      session.rebaseProof={requestId:pending.requestId,error:'RIS_REQUEST_NOT_FOUND',observedAt:now()};
      setStatus('No saved receipt exists for this original request. Its complete payload remains retained for retry.','warning');render();
    }
  }
  async function sendPending(){
    if(!session.pending)return;
    session.sending=true;updateBusy();
    try{
      const saved=await session.store.readPending(session.pending.requestId);
      if(saved?.state==='COMPLETE'){
        await accepted({dossier:{id:session.dossierId},receipt:saved.receipt},false);return;
      }
      if(!saved)throw Object.assign(new Error('RIS_PENDING_REQUEST_NOT_FOUND'),{code:'RIS_PENDING_REQUEST_NOT_FOUND'});
      session.pending=saved;
      const result=await request('/receive',{method:'POST',body:saved.body});
      await accepted(result);
    }catch(error){
      session.pendingError=code(error);setStatus(errorText(error),'error');
      if(code(error)==='REVISION_CONFLICT')await reconcilePending();
      throw error;
    }finally{session.sending=false;render();updateBusy();}
  }
  async function receive(){
    const draft=session.draft;
    if(!draft||session.previewEditId!==draft.editId||!session.preview?.complete)
      throw Object.assign(new Error('RIS_REVIEW_INCOMPLETE'),{code:'RIS_REVIEW_INCOMPLETE'});
    await flush();
    const payload={workspaceId:session.workspaceId,dossierId:session.dossierId,requestId:draft.requestId,
      draftEditId:draft.editId,createdAt:now(),label:draft.sourceInput.label,
      body:{source:clone(draft.source),review:clone(draft.review),
        expectedPlanSha256:session.preview.planSha256,expectedRevision:draft.baseRevision}};
    session.pending=await session.store.putPending(payload);render();await sendPending();
  }
  async function reviewCurrent(){
    const owner=session;
    const current=await api('/api/dossiers/'+encodeURIComponent(owner.dossierId)+'?projection=metadata',
      {sourceProjection:'full',workspaceId:owner.workspaceId});
    const baseRevision=owner.pending?.body.expectedRevision??owner.draft?.baseRevision;
    const before=await api('/api/dossiers/'+encodeURIComponent(owner.dossierId)+'?projection=metadata&revision='+baseRevision,
      {sourceProjection:'full',workspaceId:owner.workspaceId});
    if(session!==owner)return;
    if(session.pending){
      if(session.pendingError!=='REVISION_CONFLICT')throw Object.assign(new Error('RIS_ORIGINAL_REQUEST_RECONCILIATION_REQUIRED'),{code:'RIS_ORIGINAL_REQUEST_RECONCILIATION_REQUIRED'});
      await reconcilePending();if(!session.pending)return;
      session.rebaseProof={...session.rebaseProof,dossierRevision:current.revision};
    }
    session.currentReview={before,current};render();
  }
  async function acceptCurrent(){
    const reviewed=session.currentReview;if(!reviewed)return;
    if(session.pending){
      session.pending=await session.store.rebasePending(session.pending.requestId,{
        expectedRevision:session.pending.body.expectedRevision,revision:reviewed.current.revision,proof:session.rebaseProof});
      session.currentReview=null;session.pendingError=null;render();
      setStatus('The same retained request now selects revision '+reviewed.current.revision+'. Retry it when ready.');return;
    }
    touch(draft=>{draft.baseRevision=reviewed.current.revision;});
    session.currentReview=null;await preview();
  }
  async function addFiles(files){
    if(!session.draft)return;
    if(files.length+session.draft.sourceInput.documents.length>MAX_FILES)
      throw Object.assign(new Error('RIS_DOCUMENT_COUNT_INVALID'),{code:'RIS_DOCUMENT_COUNT_INVALID'});
    let total=session.draft.sourceInput.documents.reduce((sum,row)=>sum+row.bytes,0);const added=[];
    for(const file of files){
      total+=file.size;if(file.size>RAW_LIMIT||total>RAW_LIMIT)throw Object.assign(new Error('RIS_DOCUMENT_TOTAL_TOO_LARGE'),{code:'RIS_DOCUMENT_TOTAL_TOO_LARGE'});
      const bytes=new Uint8Array(await file.arrayBuffer());
      added.push({filename:file.name,encoding:'utf-8',bytes:bytes.length,sha256:await hash(bytes),bodyBase64:base64(bytes),
        declaration:{database:'',query:'',exportedAt:null,retrievedAt:null,url:'',sourceReference:'',
          sourceTerms:session.draft.sourceInput.sourceTerms,notes:'',provenance:{}}});
    }
    touch(draft=>{draft.provenanceText??=draft.sourceInput.documents.map(row=>pretty(row.declaration.provenance));
      draft.sourceInput.documents.push(...added);draft.provenanceText.push(...added.map(row=>pretty(row.declaration.provenance)));},{sourceChanged:true});render();
  }
  async function downloadExport(receipt,format,{documentId,recordId}={}){
    const query=new URLSearchParams({editionId:receipt.editionId,revision:String(session.currentRevision??receipt.revision),format});
    if(documentId)query.set('documentId',documentId);if(recordId)query.set('recordId',recordId);
    const response=await request('/export?'+query,{download:true}),bytes=new Uint8Array(await response.arrayBuffer());
    const expected=response.headers.get('x-content-sha256');
    if(!expected||await hash(bytes)!==expected)throw Object.assign(new Error('RIS_EXPORTED_FILE_CHANGED'),{code:'RIS_EXPORTED_FILE_CHANGED'});
    const filename=response.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1]??'research-ris-export';
    download(bytes,filename,response.headers.get('content-type')??'application/octet-stream');
    setStatus('Downloaded '+filename+' · '+bytes.length+' bytes · SHA256 '+expected);
  }
  async function dossierReport(receipt,selectedRevision,format){
    const owner=session;
    const response=await api('/api/dossiers/'+encodeURIComponent(owner.dossierId)+'/export?format='+format+'&revision='+selectedRevision,
      {download:true,workspaceId:owner.workspaceId});
    if(response.headers.get('x-research-dossier-revision')!==String(selectedRevision))
      throw Object.assign(new Error('RIS_EXPORTED_REVISION_CHANGED'),{code:'RIS_EXPORTED_REVISION_CHANGED'});
    const bytes=new Uint8Array(await response.arrayBuffer()),sha256=await hash(bytes);
    const filename='Research_Dossier_r'+selectedRevision+'.'+format;
    download(bytes,filename,response.headers.get('content-type')??'application/octet-stream');
    setStatus('Downloaded original dossier r'+selectedRevision+' · '+bytes.length+' bytes · SHA256 '+sha256);
  }
  async function downloadComparison(format){
    const comparison=session.comparison;if(!comparison)return;
    const query=new URLSearchParams({before:comparison.before.editionId,after:comparison.after.editionId,
      revision:String(comparison.dossier.revision),format});
    const response=await request('/compare/export?'+query,{download:true}),bytes=new Uint8Array(await response.arrayBuffer());
    const expected=response.headers.get('x-content-sha256');
    if(!expected||await hash(bytes)!==expected||
      response.headers.get('x-research-dossier-revision')!==String(comparison.dossier.revision))
      throw Object.assign(new Error('RIS_EXPORTED_FILE_CHANGED'),{code:'RIS_EXPORTED_FILE_CHANGED'});
    const filename=response.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1]??'RIS_Comparison.'+format;
    download(bytes,filename,response.headers.get('content-type')??'application/octet-stream');
    setStatus('Downloaded complete comparison · '+bytes.length+' bytes · SHA256 '+expected);
  }
  async function openEdition(receipt){
    session.mode='editions';session.selectedEdition=receipt;session.editionPage=0;
    await editionPage();render();
  }
  async function editionPage(){
    const row=session.selectedEdition;
    session.editionView=await request('?editionId='+encodeURIComponent(row.editionId)+'&offset='+(session.editionPage*PAGE)+'&limit='+PAGE);
  }
  async function reuseEdition(receipt){
    const response=await request('/export?editionId='+encodeURIComponent(receipt.editionId)+'&format=source',{download:true});
    const bytes=new Uint8Array(await response.arrayBuffer());
    if(await hash(bytes)!==receipt.source.sha256)throw Object.assign(new Error('RIS_SOURCE_CHANGED'),{code:'RIS_SOURCE_CHANGED'});
    const source=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    if(session.draft)await persist();
    session.draft=draftFor(session,getDossier(),{source,previous:receipt});
    session.draft.sourceInput.label+=' — next review';session.draft.sourceInput.preparedAt=now();
    session.pending=null;session.preview=null;session.previewEditId=null;session.mode='draft';session.page=0;
    await persist();render();
    setStatus('A new draft uses these retained original files. Their original source dates and provenance are unchanged; replace or add files for an actual update.');
  }
  async function openRecovery(file){
    // Recovery contains the complete accumulated source-review history. Do not
    // impose the smaller pending-request body limit on these original bytes.
    const owner=session,draft=JSON.parse(await file.text());if(session!==owner)return;
    if(draft?.schema!=='sf88-research-ris-browser-draft-v1'||draft.workspaceId!==session.workspaceId||
      draft.dossierId!==session.dossierId||draft.review?.requestId!==draft.requestId||
      !Array.isArray(draft.sourceInput?.documents)||!Array.isArray(draft.review.records)||
      !Array.isArray(draft.review.duplicates)||!Array.isArray(draft.review.acknowledgedDiagnostics)||
      typeof draft.sourceInput.label!=='string'||typeof draft.sourceInput.sourceTerms!=='string'||
      typeof draft.review.actor!=='string'||!Number.isSafeInteger(draft.baseRevision)||
      (draft.provenanceText!==undefined&&(!Array.isArray(draft.provenanceText)||
        draft.provenanceText.some(value=>typeof value!=='string'))))
      throw Object.assign(new Error('RIS_DRAFT_BINDING_CHANGED'),{code:'RIS_DRAFT_BINDING_CHANGED'});
    // Reading a recovery file never overwrites a different saved or unacknowledged
    // draft. The operator first sees both complete branches.
    const local=session.branches.get(draft.requestId);
    await local?.queue;
    const stored=await session.store.readDraft(draft.requestId);
    const prior=local?.unsaved??stored;
    session.recoveryCandidate={draft:clone(draft),prior:clone(prior),expectedEditId:stored?.editId??null};
    session.mode='draft';render();
  }
  async function useRecovery(){
    const selected=session.recoveryCandidate;if(!selected)return;
    const owner=session,pending=await owner.store.readPending(selected.draft.requestId);
    const entry=branch(selected.draft);
    if(entry.unsaved&&pretty(entry.unsaved)!==pretty(selected.prior))
      throw Object.assign(new Error('RIS_DRAFT_CHANGED_IN_ANOTHER_WINDOW'),{code:'RIS_DRAFT_CHANGED_IN_ANOTHER_WINDOW'});
    entry.lastStoredEditId=selected.expectedEditId;
    owner.draft=clone(selected.draft);owner.draft.editId=uuid();owner.draft.updatedAt=now();
    owner.preview=null;owner.previewEditId=null;owner.pending=pending;
    owner.mode='draft';owner.recoveryCandidate=null;
    await persist();await loadSummaries(owner);render();await flush();
    if(pending)setStatus('The original receiving request remains selected. Reconcile its saved receipt before editing this recovered draft.','warning');
  }
  function input(value,change,{multiline=false,type='text',rows=3}={}){
    const control=node(multiline?'textarea':'input');if(!multiline)control.type=type;else control.rows=rows;
    control.value=value??'';control.dataset.risEdit='true';
    control.addEventListener('input',()=>change(control.value,control));return control;
  }
  function selector(value,choices,change){
    const control=node('select');control.dataset.risEdit='true';control.append(...choices.map(([v,label])=>option(v,label)));
    control.value=value??'';control.addEventListener('change',()=>change(control.value));return control;
  }
  function disclosure(title,value,{open=false}={}){
    const details=node('details',undefined,'ris-inspection');details.open=open;details.append(node('summary',title),node('pre',typeof value==='string'?value:pretty(value)));
    return details;
  }
  function render(){
    if(!session){body.replaceChildren(node('p','Open a saved dossier to review original RIS files.'));nav.replaceChildren();return;}
    nav.replaceChildren(...[['draft','Prepare and review'],['editions','Saved editions'],['comparison','Compare editions']].map(([mode,label])=>{
      const control=button(label,()=>{session.mode=mode;render();},session.mode===mode?'active':'');control.setAttribute('aria-pressed',String(session.mode===mode));return control;
    }));
    body.replaceChildren();
    if(session.currentReview){
      const panel=node('section',undefined,'ris-conflict');
      panel.append(node('h3','Review the changed dossier before continuing'),
        node('p','Original base revision '+session.currentReview.before.revision+' → current revision '+session.currentReview.current.revision+
          '. Your original file bytes and complete review are retained. Check any earlier-edition selections that this import will deselect.'),
        disclosure('Original dossier metadata and selections',session.currentReview.before),
        disclosure('Current dossier metadata and selections',session.currentReview.current),
        button('Use reviewed revision '+session.currentReview.current.revision,()=>run(acceptCurrent),'primary'),
        button('Keep current draft base',()=>{session.currentReview=null;render();}));
      body.append(panel);
    }
    if(session.recoveryCandidate){
      const recovery=session.recoveryCandidate,panel=node('section',undefined,'ris-conflict');
      panel.append(node('h3','Review the complete recovery file'),
        node('p','This file keeps its original request ID. A saved or pending receiving request will be reconciled under that same identity.'),
        disclosure('Current saved or unacknowledged draft',recovery.prior??'No prior draft'),
        disclosure('Complete incoming recovery draft',recovery.draft),
        button('Use this reviewed recovery draft',()=>run(useRecovery),'primary'),
        button('Download incoming recovery',()=>download(pretty(recovery.draft)+'\n',recovery.draft.requestId+'.recovery.json')),
        button('Keep current draft',()=>{session.recoveryCandidate=null;render();}));
      body.append(panel);
    }
    if(session.mode==='draft')renderDraft();
    if(session.mode==='editions')renderEditions();
    if(session.mode==='comparison')renderComparison();
    paintStorage();updateBusy();
  }
  function renderDraft(){
    const shelf=node('section',undefined,'ris-shelf');
    const draftChoices=session.draftSummaries??[],pendingChoices=session.pendingSummaries??[];
    if(draftChoices.length){
      shelf.append(node('h3','Saved drafts'));
      for(const row of draftChoices)shelf.append(button((row.localOnly?'Unsaved recovery · ':'')+(row.label||'RIS review'),
        ()=>run(()=>openDraft(row.requestId))));
    }
    if(pendingChoices.length){
      shelf.append(node('h3','Receiving requests'));
      for(const row of pendingChoices)shelf.append(button((row.phase==='COMPLETE'?'Received · ':'Pending · ')+(row.label||row.requestId),
        ()=>run(()=>openPending(row.requestId))));
    }
    const recovery=node('input');recovery.type='file';recovery.accept='.json,application/json';
    recovery.addEventListener('change',()=>{const file=recovery.files[0];if(file)run(()=>openRecovery(file));});
    shelf.append(field('Open a complete saved draft for this dossier',recovery));body.append(shelf);
    if(session.pending){
      const panel=node('section',undefined,'ris-pending'),pending=session.pending;
      panel.append(node('h3',pending.state==='COMPLETE'?'Original request received':'Original receiving request retained'),
        node('p',pending.requestId+' · expected dossier revision '+pending.body.expectedRevision),
        disclosure('Exact retained source and review request',pending.body),
        button('Download original request',()=>download(pretty(pending)+'\n',pending.requestId+'.request.json')),
        button('Check saved receipt',()=>run(reconcilePending),'primary'));
      if(pending.state!=='COMPLETE')panel.append(button('Retry this same request',()=>run(sendPending)));
      if(session.pendingError==='REVISION_CONFLICT'&&session.rebaseProof)
        panel.append(button('Review current dossier revision',()=>run(reviewCurrent)));
      body.append(panel);
    }
    const draft=session.draft;
    if(!draft){body.append(node('p','Start a new RIS import or open a saved draft. Original files stay available in every received edition.','muted'));return;}
    if(session.pending){
      body.append(button('Download complete draft',()=>download(pretty(draft)+'\n',draft.requestId+'.draft.json')),
        node('p','The pending request is immutable. Complete its recovery before editing or copying this review.','muted'));return;
    }
    const tools=node('div',undefined,'ris-actions');
    tools.append(button('Download complete draft',()=>download(pretty(session.draft)+'\n',draft.requestId+'.draft.json')),
      button('Retry saving draft',()=>run(async()=>{await persist();await flush();setStatus('Complete draft is saved.');})),
      button('Keep a separate draft',()=>run(async()=>{
        const current=clone(session.draft);current.requestId='ris-'+uuid();current.review.requestId=current.requestId;
        current.editId=uuid();current.createdAt=now();current.updatedAt=now();
        session.draft=current;session.pending=null;session.preview=null;session.previewEditId=null;await persist();await loadSummaries();render();
      })),
      button('Discard this draft',()=>run(async()=>{
        if(!confirm('Discard this complete draft? Original received editions are preserved.'))return;
        await session.store.removeDraft(draft.requestId,draft.editId);
        session.branches.delete(draft.requestId);session.draft=null;session.preview=null;await loadSummaries();render();
      })));
    body.append(tools);
    const form=node('section',undefined,'ris-form-grid');
    form.append(field('Edition label',input(draft.sourceInput.label,value=>touch(row=>row.sourceInput.label=value,{sourceChanged:true}))),
      field('Dossier question',selector(draft.review.questionId,getDossier().questions.map(q=>[q.id,q.text]),value=>touch(row=>{
        row.review.questionId=value;row.review.previous=null;
      }))),
      field('Reviewer',input(draft.review.actor,value=>touch(row=>row.review.actor=value))),
      field('Complete source reference',input(draft.sourceInput.sourceReference,value=>touch(row=>row.sourceInput.sourceReference=value,{sourceChanged:true}))),
      field('Source terms and permitted use',input(draft.sourceInput.sourceTerms,value=>touch(row=>row.sourceInput.sourceTerms=value,{sourceChanged:true}),{multiline:true})));
    const prior=session.editions.filter(row=>row.questionId===draft.review.questionId);
    form.append(field('Earlier RIS edition for this question',selector(draft.review.previous?.editionId??'',
      [['','First / independent edition'],...prior.map(row=>[row.editionId,row.label+' · r'+row.revision])],value=>{
        touch(row=>{const selected=prior.find(item=>item.editionId===value);
          row.review.previous=selected?{editionId:selected.editionId,sha256:selected.edition.sha256,priorSelection:'keep'}:null;});render();
      })));
    if(draft.review.previous)form.append(field('Earlier edition evidence selections',selector(draft.review.previous.priorSelection,
      [['keep','Keep current selections'],['deselect','Deselect the earlier edition in this same revision']],value=>touch(row=>row.review.previous.priorSelection=value))));
    body.append(form);
    const files=node('section',undefined,'ris-documents');files.append(node('h3','Original RIS files'),
      node('p','Up to 32 original files and 8 MiB total. Declare the actual database, query, encoding, source times and rights. An unexposed source time stays blank.','muted'));
    const picker=node('input');picker.type='file';picker.multiple=true;picker.accept='.ris,text/plain,application/x-research-info-systems';picker.dataset.risEdit='true';
    picker.addEventListener('change',()=>{const selected=[...picker.files];run(()=>addFiles(selected));});files.append(picker);
    draft.sourceInput.documents.forEach((document,index)=>files.append(documentForm(document,index)));
    body.append(files);
    const actions=node('div',undefined,'ris-review-actions'),plan=node('p');plan.dataset.risPlan='true';
    const prepare=button(draft.source?'Refresh review':'Prepare original files',()=>run(preview),'primary');prepare.dataset.risPrepare='true';
    const receiveButton=button('Receive in one dossier revision',()=>run(receive),'primary');receiveButton.dataset.risReceive='true';
    actions.append(plan,prepare,receiveButton,button('Review current dossier revision',()=>run(reviewCurrent)));
    body.append(actions);
    if(session.preview)renderPreview();paintPlan();
  }

  function documentForm(document,index){
    const panel=node('details',undefined,'ris-document');panel.open=session.openDocuments?.has(index)??true;
    panel.addEventListener('toggle',()=>{session.openDocuments??=new Set();panel.open?session.openDocuments.add(index):session.openDocuments.delete(index);});
    panel.append(node('summary',document.filename+' · '+document.bytes+' bytes'));
    const meta=node('p',document.sha256,'ris-hash'),grid=node('div',undefined,'ris-form-grid');
    const edit=(key,value)=>touch(row=>row.sourceInput.documents[index].declaration[key]=value,{sourceChanged:true});
    grid.append(field('Filename',input(document.filename,value=>touch(row=>row.sourceInput.documents[index].filename=value,{sourceChanged:true}))),
      field('Declared encoding',selector(document.encoding,[['utf-8','UTF-8'],['windows-1252','Windows-1252'],
        ['utf-16le','UTF-16 little endian'],['utf-16be','UTF-16 big endian']],value=>touch(row=>row.sourceInput.documents[index].encoding=value,{sourceChanged:true}))),
      field('Original database / exporter',input(document.declaration.database,value=>edit('database',value))),
      field('Exact query or selected source identifiers',input(document.declaration.query,value=>edit('query',value),{multiline:true})),
      field('Original export time, if known (ISO date/time)',input(document.declaration.exportedAt,value=>edit('exportedAt',value||null))),
      field('Actual retrieval time, if known (ISO date/time)',input(document.declaration.retrievedAt,value=>edit('retrievedAt',value||null))),
      field('Original source URL',input(document.declaration.url,value=>edit('url',value))),
      field('Original source reference',input(document.declaration.sourceReference,value=>edit('sourceReference',value))),
      field('This file’s source terms',input(document.declaration.sourceTerms,value=>edit('sourceTerms',value),{multiline:true})),
      field('Source notes',input(document.declaration.notes,value=>edit('notes',value),{multiline:true})));
    const provenanceValue=session.draft.provenanceText?.[index]??pretty(document.declaration.provenance);
    const provenance=input(provenanceValue,(value,control)=>{
      let parsed,valid=true;try{parsed=JSON.parse(value);}catch{valid=false;}
      control.setCustomValidity(valid?'':'Keep complete valid JSON for the original provenance.');
      touch(draft=>{
        draft.provenanceText??=draft.sourceInput.documents.map(row=>pretty(row.declaration.provenance));
        draft.provenanceText[index]=value;
        if(valid)draft.sourceInput.documents[index].declaration.provenance=parsed;
      },{sourceChanged:valid});
    },{multiline:true,rows:5});
    try{JSON.parse(provenanceValue);}catch{provenance.setCustomValidity('Keep complete valid JSON for the original provenance.');}
    grid.append(field('Full original provenance JSON',provenance));
    panel.append(meta,grid,button('Download these original bytes',()=>download(nativeBytes(document.bodyBase64),document.filename,'application/octet-stream')),
      button('Remove file from this draft',()=>{touch(row=>{
        row.sourceInput.documents.splice(index,1);if(row.provenanceText)row.provenanceText.splice(index,1);
      },{sourceChanged:true});render();}));
    return panel;
  }
  async function inspectRecord(recordId,{received=false}={}){
    if(!received&&!session.draft.source){setStatus('Refresh the source review before inspecting a record whose declaration changed.','warning');return;}
    const result=received?await request('?editionId='+encodeURIComponent(session.selectedEdition.editionId)+'&recordId='+encodeURIComponent(recordId)):
      await request('/preview',{method:'POST',body:{source:session.draft.source,review:session.draft.review,recordId}});
    session.recordDetail={record:result.record,received};render();
  }
  function renderRecord(row,{received=false}={}){
    const article=node('article',undefined,'ris-record');
    const title=node('div',undefined,'ris-record-heading');
    title.append(node('h4',row.metadata.title),node('span',row.complete?'Complete record':'Malformed record',row.complete?'ris-badge':'ris-badge warning'));
    article.append(title,node('p',[row.filename,'record '+row.ordinal,row.metadata.doi||'No selected DOI',row.metadata.year||'No selected year'].join(' · '),'muted'),
      node('p','Original SHA256 '+row.sha256,'ris-hash'));
    if(received){
      article.append(node('p','Imported: '+(row.choice.selected?'selected':'not selected')+' · '+row.choice.classification+
        '; current dossier: '+(row.currentSelection?.selected?'selected':'not selected')+' · '+(row.currentSelection?.classification??'unreviewed')),
        disclosure('Saved import decision and original metadata',{choice:row.choice,metadata:row.metadata,currentSelection:row.currentSelection}));
    }else{
      const choice=session.draft.review.records.find(value=>value.recordId===row.recordId)??row.choice;
      const edit=update=>touch(draft=>{
        const index=draft.review.records.findIndex(value=>value.recordId===row.recordId);
        if(index<0)draft.review.records.push({...clone(choice),...update});else Object.assign(draft.review.records[index],update);
      });
      const selected=node('input');selected.type='checkbox';selected.checked=choice.selected;selected.dataset.risEdit='true';
      selected.addEventListener('change',()=>edit({selected:selected.checked}));
      const grid=node('div',undefined,'ris-record-fields');
      grid.append(field('Select this original occurrence',selected),
        field('Evidence classification',selector(choice.classification,[['unreviewed','Unreviewed'],['supports','Supports'],['contradicts','Contradicts'],['background','Background']],value=>edit({classification:value}))),
        field('Full review note',input(choice.note,value=>edit({note:value}),{multiline:true})));
      for(const name of ['title','doi','year']){
        const values=row.candidates[name],key=name+'TagIndex';
        grid.append(field('Use original '+name+' field',selector(choice[key]===null?'':String(choice[key]),
          [['','No field selected'],...values.map(value=>[String(value.tagIndex),value.tag+' #'+(value.tagIndex+1)+' · '+value.value])],
          value=>edit({[key]:value===''?null:Number(value)}))));
      }
      if(row.ambiguities.length){
        const check=node('input');check.type='checkbox';check.checked=choice.interpretationReviewed;check.dataset.risEdit='true';
        check.addEventListener('change',()=>edit({interpretationReviewed:check.checked}));
        grid.append(field('I reviewed these conflicting native fields: '+row.ambiguities.join(', '),check),
          field('Reason for the selected interpretation',input(choice.interpretationReason,value=>edit({interpretationReason:value}),{multiline:true})));
      }
      article.append(grid);
    }
    article.append(button('Inspect complete original record',()=>run(()=>inspectRecord(row.recordId,{received}))));
    if(received)article.append(button('Download original record bytes',()=>run(()=>downloadExport(session.selectedEdition,'record',{recordId:row.recordId}))));
    return article;
  }
  function renderRecordDetail(){
    if(!session.recordDetail)return;
    const panel=node('section',undefined,'ris-detail'),record=session.recordDetail.record;
    panel.append(node('h3','Original record · '+record.filename+' #'+record.ordinal),
      node('p','Byte range ['+record.start+', '+record.end+') · '+record.encoding+' · '+record.sha256,'ris-hash'),
      disclosure('Exact decoded original record text',record.rawText,{open:true}),
      disclosure('Ordered fields, continuation lines and byte spans',record.fields),
      disclosure('Native framing diagnostics',record.diagnostics),
      button('Close original record',()=>{session.recordDetail=null;render();}));
    body.append(panel);
  }
  function pagination(total,offset,change,label){
    const n=node('div',undefined,'ris-pagination'),previous=button('Previous '+label,()=>run(()=>change(offset-1))),
      next=button('Next '+label,()=>run(()=>change(offset+1)));
    previous.disabled=offset<=0;previous.dataset.risFixedDisabled=String(previous.disabled);
    next.disabled=(offset+1)*PAGE>=total;next.dataset.risFixedDisabled=String(next.disabled);
    n.append(previous,node('span','Page '+(offset+1)+' · '+total+' '+label),next);return n;
  }
  function renderPreview(){
    const preview=session.preview,draft=session.draft;
    const overview=node('section',undefined,'ris-preview-summary');
    overview.append(node('h3','Review the retained source'),
      node('p',preview.counts.documents+' files · '+preview.counts.records+' records · '+preview.counts.selected+
        ' selected · '+preview.counts.duplicateGroups+' duplicate groups · '+preview.counts.unresolvedIssues+' unresolved issues'),
      node('p','Prepared source SHA256 '+preview.source.sha256,'ris-hash'));
    if(draft.previousSourceReview){
      const history=[...(draft.previousSourceReviews??[]),draft.previousSourceReview];
      overview.append(disclosure('Previous source reviews retained in this draft',history.map(row=>({
        source:row.source,review:row.review,retainedAt:row.retainedAt}))),
        button('Download previous complete source reviews',()=>download(pretty(history)+'\n',draft.requestId+'.previous-reviews.json')));
    }
    if(draft.unmatchedRecordReviews?.length||draft.unmatchedDuplicateReviews?.length)
      overview.append(disclosure('Earlier decisions whose original record or group identity changed',{
        records:draft.unmatchedRecordReviews??[],duplicateGroups:draft.unmatchedDuplicateReviews??[]},{open:true}));
    if(preview.issues.length)overview.append(disclosure('Complete current review issues',preview.issues,{open:true}));
    body.append(overview);
    if(preview.diagnostics.length){
      const panel=node('section',undefined,'ris-diagnostics');panel.append(node('h3','Source framing observations'));
      for(const diagnostic of preview.diagnostics){
        const item=node('div',undefined,'ris-diagnostic'),check=node('input');
        check.type='checkbox';check.checked=draft.review.acknowledgedDiagnostics.includes(diagnostic.id);check.dataset.risEdit='true';
        check.addEventListener('change',()=>touch(row=>{
          const set=new Set(row.review.acknowledgedDiagnostics);check.checked?set.add(diagnostic.id):set.delete(diagnostic.id);
          row.review.acknowledgedDiagnostics=[...set];
        }));
        item.append(field(diagnostic.code+' · line '+diagnostic.line+' · '+diagnostic.severity,check));
        panel.append(item);
      }
      body.append(panel);
    }
    if(preview.groups.length){
      const panel=node('section',undefined,'ris-duplicates');session.groupPage??=0;
      panel.append(node('h3','Explicit duplicate decisions'));
      for(const group of preview.groups.slice(session.groupPage*PAGE,(session.groupPage+1)*PAGE)){
        const row=draft.review.duplicates.find(value=>value.groupId===group.id)??{groupId:group.id,decision:'',reason:''};
        const edit=update=>touch(draft=>{
          const index=draft.review.duplicates.findIndex(value=>value.groupId===group.id);
          if(index<0)draft.review.duplicates.push({...clone(row),...update});else Object.assign(draft.review.duplicates[index],update);
        });
        const item=node('article',undefined,'ris-duplicate');
        item.append(node('h4',group.basis==='native-doi'?'Same explicit DOI':'Matching title, year and authors'),
          node('p',group.note),disclosure('Original record identities',group.recordIds),
          field('Decision',selector(row.decision,[['','Choose a decision'],['keep-all','Keep all occurrences selected'],
            ['choose','Select some occurrences'],['defer','Leave this group unselected']],value=>edit({decision:value}))),
          field('Reason',input(row.reason,value=>edit({reason:value}),{multiline:true})));
        panel.append(item);
      }
      panel.append(pagination(preview.groups.length,session.groupPage,async page=>{session.groupPage=page;render();},'groups'));body.append(panel);
    }
    const records=node('section',undefined,'ris-records');records.append(node('h3','Original record decisions'));
    for(const row of preview.records??[])records.append(renderRecord(row));
    records.append(pagination(preview.counts.records,session.page,async page=>{session.page=page;await previewPage();},'records'));
    body.append(records);renderRecordDetail();
  }
  async function previewPage(){await preview();}
  function receiptActions(receipt){
    const actions=node('div',undefined,'ris-actions');
    for(const [format,label]of [['edition','Original reviewed edition'],['source','Original source declaration'],
      ['selected-ris','Selected RIS · derived UTF-8'],['csv','Review CSV'],['html','Full review HTML'],['md','Full review Markdown']])
      actions.append(button(label,()=>run(()=>downloadExport(receipt,format))));
    actions.append(button('Continue from retained files',()=>run(()=>reuseEdition(receipt)),'primary'));
    for(const selected of [...new Set([receipt.originalRevision,receipt.revision,session.currentRevision])].filter(Number.isInteger))
      for(const format of ['html','md','json.gz'])actions.append(button('Dossier r'+selected+' · '+format,()=>run(()=>dossierReport(receipt,selected,format))));
    return actions;
  }
  function renderEditions(){
    const list=node('section',undefined,'ris-edition-list');list.append(node('h3','Original RIS editions'));
    if(!session.editions.length)list.append(node('p','No reviewed RIS edition has been received in this dossier.','muted'));
    for(const row of session.editions){
      const item=node('article',undefined,'ris-edition');
      item.append(node('h4',row.label),node('p','Revision '+row.revision+' · '+row.documents+' original files · '+row.records+' records · '+row.createdAt),
        node('p',row.requestId,'ris-hash'),button('Open source and review',()=>run(()=>openEdition(row)),'primary'));
      list.append(item);
    }
    if(session.moreEditions!==null&&session.moreEditions!==undefined)list.append(button('Load more editions',()=>run(async()=>{
      const result=await request('?offset='+session.moreEditions+'&limit=100');session.editions.push(...result.items);session.moreEditions=result.nextOffset;render();
    })));
    body.append(list);
    const receipt=session.selectedEdition??session.receipt;
    if(receipt){
      const panel=node('section',undefined,'ris-saved');
      panel.append(node('h3',receipt.label),disclosure('Original receiving receipt',receipt),receiptActions(receipt));
      if(session.editionView?.receipt.editionId===receipt.editionId){
        for(const document of session.editionView.documents??[]){
          const card=node('article',undefined,'ris-document');
          card.append(node('h4',document.filename),node('p',document.bytes+' original bytes · '+document.sha256,'ris-hash'),
            disclosure('Actual source / query declaration',document.declaration),
            button('Download original RIS file',()=>run(()=>downloadExport(receipt,'document',{documentId:document.id}))));
          panel.append(card);
        }
        for(const row of session.editionView.records??[])panel.append(renderRecord(row,{received:true}));
        panel.append(pagination(session.editionView.counts.records,session.editionPage,
          async page=>{session.editionPage=page;await editionPage();render();},'records'));
      }
      body.append(panel);renderRecordDetail();
    }
  }
  function renderComparison(){
    const panel=node('section',undefined,'ris-comparison');
    session.compare??={before:session.editions.at(-2)?.editionId??'',after:session.editions.at(-1)?.editionId??'',section:'changed',offset:0};
    const selected=session.compare,options=[['','Choose an edition'],...session.editions.map(row=>[row.editionId,row.label+' · r'+row.revision])];
    panel.append(node('h3','Compare original source editions'),
      node('p','Native record fields, source declarations, occurrence counts and saved import decisions remain separate. An absent record does not establish a retraction.','muted'),
      field('Earlier edition',selector(selected.before,options,value=>{selected.before=value;selected.offset=0;session.comparison=null;})),
      field('Later edition',selector(selected.after,options,value=>{selected.after=value;selected.offset=0;session.comparison=null;})),
      field('Difference section',selector(selected.section,[['changed','Changed'],['added','Added'],['absent','Absent'],['unchanged','Unchanged']],
        value=>{selected.section=value;selected.offset=0;session.comparison=null;})),
      button('Compare retained editions',()=>run(compare),'primary'));
    if(session.comparison){
      const result=session.comparison;
      panel.append(node('p',Object.entries(result.counts).map(([key,value])=>value+' '+key).join(' · ')));
      const downloads=node('div',undefined,'ris-actions');
      for(const format of ['json','html','md'])downloads.append(button('Complete comparison · '+format,()=>run(()=>downloadComparison(format))));
      panel.append(downloads);
      for(const item of result.items)panel.append(disclosure(item.identity,item,{open:result.items.length<=3}));
      panel.append(pagination(result.counts[result.section],selected.offset/PAGE,async page=>{selected.offset=page*PAGE;await compare();},'records'));
    }
    body.append(panel);
  }
  async function compare(){
    const query=new URLSearchParams({...session.compare,limit:PAGE});
    session.comparison=await request('/compare?'+query);render();
  }
  function setDossier(view){
    const workspace=getWorkspace();
    if(!view||!workspace?.workspaceId){session=null;render();return;}
    const scope=workspace.workspaceId+'\u0000'+view.id;
    if(session?.scope===scope){session.currentRevision=view.revision;paintPlan();updateBusy();return;}
    if(!sessions.has(scope))sessions.set(scope,{scope,workspaceId:workspace.workspaceId,dossierId:view.id,
      store:createRisDraftStore(workspace.workspaceId,view.id),branches:new Map(),mode:'draft',draft:null,pending:null,
      preview:null,previewEditId:null,currentRevision:view.revision,editions:[],draftSummaries:[],pendingSummaries:[],
      page:0,editionPage:0,groupPage:0,loaded:false,loading:false});
    session=sessions.get(scope);render();ensureLoaded();
  }
  function ensureLoaded(){
    if(!visible||!session||session.loaded||session.loading||isBusy()||closed)return;
    const owner=session;owner.loading=true;
    Promise.resolve().then(()=>{if(session===owner)return refresh();}).catch(error=>{if(session===owner)setStatus(errorText(error),'error');})
      .finally(()=>{owner.loading=false;if(session===owner)updateBusy();});
  }
  function updateBusy(){
    const busy=Boolean(isBusy()||session?.sending);
    for(const control of root.querySelectorAll('button,input,select,textarea')){
      let disabled=busy||control.dataset.risFixedDisabled==='true';
      if(control.dataset.risEdit&&session?.pending)disabled=true;
      if(control.dataset.risReceive)disabled=disabled||!session?.draft||session.pending||
        !session.preview?.complete||session.previewEditId!==session.draft?.editId||invalidProvenance();
      if(control.dataset.risPrepare){
        const draft=session?.draft;
        disabled=disabled||!draft||session.pending||!draft.sourceInput.documents.length||!draft.sourceInput.label.trim()||
          !draft.sourceInput.sourceTerms.trim()||!draft.review.actor.trim()||!draft.review.questionId||invalidProvenance()||
          draft.sourceInput.documents.some(row=>!row.declaration.database.trim()||!row.declaration.sourceTerms.trim());
      }
      control.disabled=Boolean(disabled);
    }
    newButton.disabled=busy||!session||Boolean(session.pending);
    refreshButton.disabled=busy||!session;paintStorage();ensureLoaded();
  }
  return Object.freeze({setDossier,show(value){visible=value;if(value)ensureLoaded();},updateBusy,
    hasUnsaved(){return [...sessions.values()].some(row=>row.sending||[...row.branches.values()].some(value=>value.unsaved));},
    close(){closed=true;}});
}
