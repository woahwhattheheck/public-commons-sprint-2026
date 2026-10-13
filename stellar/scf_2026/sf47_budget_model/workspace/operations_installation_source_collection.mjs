// Complete original-file collection authoring, review and native request continuation.
// Native file.add remains the sole writer; all original bytes live in the host working copy.
export const COLLECTION_SCHEMA='stellar-forge.installation-source-collection.v1';
const MAX_FILE=8*1024*1024,MAX_INPUTS=64*1024*1024,MAX_REVISIONS=10000;
const FILENAME=/^[A-Za-z0-9][A-Za-z0-9_.-]{0,199}$/;
const MEDIA_TYPE=/^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/;
const RESERVED=new Set(['SOURCE_SELECTION.json','Supplier_Workshare_Commissioning.json',
  'Supplier_Complete_Receiving_Packets.json','SUPPLIER_RECEIVING.json','SOURCE_PREPARATION.json',
  'source-preparation.lock','INSTALLATION_SOURCE_DESK_PREPARATION.json']);
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const copy=value=>structuredClone(value);
const canonical=value=>JSON.stringify(sort(value));
function sort(value){return Array.isArray(value)?value.map(sort):record(value)?
  Object.fromEntries(Object.keys(value).sort().map(key=>[key,sort(value[key])])):value;}
function need(value,message){if(!value)throw new Error(message);}
const metadataKeys=['filename','mediaType','sourceUrl','observedAt'];
const meta=row=>Object.fromEntries(metadataKeys.map(key=>[key,row[key]]));
const identity=file=>({id:file.id,filename:file.filename,bytes:file.bytes,sha256:file.sha256,
  mediaType:file.mediaType,sourceUrl:file.sourceUrl,observedAt:file.observedAt});
const requestGetter=requests=>typeof requests==='function'?requests:requests instanceof Map?
  id=>requests.get(id):id=>(requests||[]).find(value=>value.body?.requestId===id);
export function collectionData(row){return {...meta(row),bytes:row.original.bytes,
  sha256:row.original.sha256,contentBase64:row.original.contentBase64};}
function boundRequest(row,request,draftId){
  need(record(request)&&request.draftId===draftId&&request.body?.action==='file.add'&&
    record(request.body.data),'Keep every original collection request in its source draft.');
  const data=request.body.data;
  need(data.bytes===row.original.bytes&&data.sha256===row.original.sha256&&
    data.contentBase64===row.original.contentBase64,
    'A collection request must retain the complete original file it received.');
  if(request.receipt){
    const receipt=request.receipt,file=receipt.result?.file;
    need(receipt.requestId===request.body.requestId&&receipt.requestSha256===request.requestSha256&&
      receipt.draft?.id===draftId&&record(file)&&file.bytes===data.bytes&&file.sha256===data.sha256&&
      file.filename===data.filename&&receipt.draft.files?.some(value=>canonical(value)===canonical(file)),
      'Keep the full recorded collection file and its original native receipt together.');
  }
  return request;
}
export function validateCollection(value,{hash,checkedFile,draftId,requests}){
  if(value===null||value===undefined)return null;
  need(record(value)&&value.schema===COLLECTION_SCHEMA&&ID.test(value.id)&&
    value.draftId===draftId&&typeof value.title==='string'&&typeof value.createdAt==='string'&&
    record(value.defaults)&&typeof value.defaults.sourceUrl==='string'&&typeof value.defaults.observedAt==='string'&&
    Array.isArray(value.rows)&&value.rows.length<=MAX_REVISIONS&&
    (value.selectedId===null||typeof value.selectedId==='string')&&typeof value.pauseRequested==='boolean',
    'Keep the complete original collection and its source-draft identity.');
  const ids=new Set(),usedRequests=new Set(),get=requestGetter(requests);let bytes=0;
  for(const row of value.rows){
    need(record(row)&&ID.test(row.id)&&!ids.has(row.id)&&typeof row.included==='boolean'&&
      metadataKeys.every(key=>typeof row[key]==='string')&&Array.isArray(row.requests)&&
      row.requests.every(id=>typeof id==='string'&&ID.test(id)),
      'Keep each original collection row, complete receiving fields and request history.');
    ids.add(row.id);checkedFile(row.original);need(row.original,'Keep every complete original collection file.');
    bytes+=row.original.bytes;
    for(const id of row.requests){
      need(!usedRequests.has(id),'An original request belongs to exactly one collection row.');
      usedRequests.add(id);const request=get(id);
      need(request?.body?.requestId===id,'The complete working copy is missing an original collection request.');
      boundRequest(row,request,draftId);
    }
    const last=row.requests.length?get(row.requests.at(-1)):null;
    if(last&&(last.receipt||last.state!=='REJECTED')){
      need(row.included&&canonical(meta(row))===canonical(meta(last.body.data)),
        'Retain the unchanged receiving fields for the original prepared or recorded collection request.');
    }
    if(row.link!==null&&row.link!==undefined){
      need(record(row.link)&&record(row.link.file)&&Number.isSafeInteger(row.link.revision)&&row.link.revision>0&&
        row.link.file.filename===row.filename&&row.link.file.bytes===row.original.bytes&&
        row.link.file.sha256===row.original.sha256&&typeof row.link.acceptedAt==='string'&&row.included&&(!last||!last.receipt&&last.state==='REJECTED'),
        'Keep the explicit choice of an identical current source file and its original provenance.');
    }
  }
  need(bytes<=MAX_INPUTS,'Keep the complete staged original collection within 64 MiB.');
  need(value.selectedId===null||ids.has(value.selectedId),'Select a retained original collection row.');
  if(value.review!==null&&value.review!==undefined){
    need(record(value.review)&&typeof value.review.signature==='string'&&/^[a-f0-9]{64}$/.test(value.review.signature)&&
      Number.isSafeInteger(value.review.revision)&&typeof value.review.at==='string',
      'Keep the complete saved collection review identity.');
  }
  // Request hashes are verified by the host before this binding check. Retained raw fields stay raw.
  need(typeof hash==='function','Use the original installed source hash helper.');
  return value;
}
function metadataProblems(row){
  const errors=[];
  if(!FILENAME.test(row.filename)||RESERVED.has(row.filename))errors.push('Choose a native receiving filename; generated package filenames are reserved.');
  if(!MEDIA_TYPE.test(row.mediaType))errors.push('Enter an ordinary type/subtype media type.');
  const url=row.sourceUrl.trim();
  if(row.sourceUrl.length>4000||row.sourceUrl.includes('\0'))errors.push('Keep the source URL within 4,000 characters.');
  else if(url){try{const parsed=new URL(url);if(!['http:','https:'].includes(parsed.protocol)||!parsed.hostname||parsed.username||parsed.password)
    throw new Error();}catch{errors.push('Use an HTTP(S) source URL without embedded credentials, or leave it empty.');}}
  // The original Python writer validates ISO 8601 and retains its supplied timezone text.
  if(!/^\d{4}-\d\d-\d\d[Tt ]\d\d:\d\d(?::\d\d(?:\.\d+)?)?(?:[Zz]|[+-]\d\d(?::?\d\d)?)$/.test(row.observedAt)||
    !Number.isFinite(Date.parse(row.observedAt)))errors.push('Enter the original observation as an ISO timestamp with timezone.');
  return errors;
}
export function reviewCollection(value,draft,requests,{hash}){
  need(value?.schema===COLLECTION_SCHEMA&&draft?.id===value.draftId&&Array.isArray(draft.files)&&
    Number.isSafeInteger(draft.revision),'Open this collection in its original current source draft.');
  const get=requestGetter(requests),names=new Map();
  for(const row of value.rows)if(row.included&&!row.link){
    const last=row.requests.length?get(row.requests.at(-1)):null;
    if(!last?.receipt){const group=names.get(row.filename)||[];group.push(row.id);names.set(row.filename,group);}
  }
  const rows=value.rows.map(row=>{
    const original=row.requests.length?boundRequest(row,get(row.requests.at(-1)),draft.id):null;
    const sameName=draft.files.find(file=>file.filename===row.filename);
    const sameBytes=draft.files.filter(file=>file.sha256===row.original.sha256&&file.bytes===row.original.bytes);
    const errors=[];let status='READY',file=null;
    if(original?.receipt){
      file=original.receipt.result.file;
      status=draft.files.some(value=>canonical(identity(value))===canonical(identity(file)))?'RECORDED':'REMOVED';
      if(status==='REMOVED')errors.push('This recorded original was removed or changed in a later source edition. Its receipt remains available; start a new collection to receive a new edition.');
    }else if(original&&original.state!=='REJECTED'){
      status='RECOVER';errors.push('Recover this exact original request before sending another file.');
    }else if(row.link){
      file=row.link.file;
      status=draft.files.some(value=>canonical(identity(value))===canonical(identity(file)))?'LINKED':'STALE_LINK';
      if(status==='STALE_LINK')errors.push('The explicitly selected identical source is absent from the current edition. Clear the previous selection and review the original file again.');
    }else if(!row.included)status='EXCLUDED';
    else{
      errors.push(...metadataProblems(row));
      if((names.get(row.filename)||[]).length>1)errors.push('Two selected originals use this receiving filename. Rename or exclude one while retaining both original files.');
      if(sameName){
        status=sameName.sha256===row.original.sha256&&sameName.bytes===row.original.bytes?'IDENTICAL':'COLLISION';
        errors.push(status==='IDENTICAL'?'Review and explicitly use the already-retained identical file, or choose a different receiving filename.':
          'A different original already uses this receiving filename. Choose another name or use the existing native file-removal workflow.');
      }
      if(errors.length&&status==='READY')status='INVALID';
    }
    return {id:row.id,status,errors,file:file?identity(file):null,
      sameName:sameName?identity(sameName):null,sameBytes:sameBytes.map(identity),
      requestId:original?.body.requestId??null,requestState:original?.state??null,
      originalName:row.original.name,filename:row.filename,bytes:row.original.bytes};
  });
  const currentBytes=draft.files.reduce((n,file)=>n+file.bytes,0);
  const addedBytes=rows.filter(row=>row.status==='READY'||row.status==='RECOVER').reduce((n,row)=>n+row.bytes,0);
  const incoming=rows.filter(row=>row.status==='READY'||row.status==='RECOVER').length;
  const problems=[];
  if(currentBytes+addedBytes>MAX_INPUTS)problems.push('The resulting selected source files exceed the native 64 MiB limit. Exclude staged rows or remove earlier selected files explicitly.');
  if(draft.revision+incoming>MAX_REVISIONS)problems.push('This collection would exceed the native 10,000-revision history limit.');
  const signature=hash(canonical({collectionId:value.id,draftId:draft.id,revision:draft.revision,
    files:draft.files.map(identity),rows:value.rows.map(row=>({id:row.id,included:row.included,...meta(row),
      original:{bytes:row.original.bytes,sha256:row.original.sha256},link:row.link??null,
      requests:row.requests.map(id=>{const r=get(id);return {id,sha:r.requestSha256,state:r.state,receipt:r.receipt??null};})}))}));
  return {signature,revision:draft.revision,currentBytes,addedBytes,totalBytes:currentBytes+addedBytes,
    rows,problems,ready:rows.filter(row=>row.status==='READY').length,
    recorded:rows.filter(row=>['RECORDED','LINKED'].includes(row.status)).length,
    excluded:rows.filter(row=>row.status==='EXCLUDED').length,
    blocked:problems.length>0||rows.some(row=>!['READY','RECORDED','LINKED','EXCLUDED'].includes(row.status))};
}

export function createSourceCollectionDesk(bridge){
  const {state,draft,request:lookup,requireEdit,changed,persistNow,parkWorking,render,available,
    hash,base64,checkedFile,esc,pretty,header,table,empty,hint,btn,download}=bridge;
  let receiving=false,reading=false;
  const get=()=>state().collectionWork;
  const now=()=>new Date().toISOString();
  const uid=prefix=>prefix+crypto.randomUUID();
  const rowById=id=>get()?.rows.find(row=>row.id===id);
  const editable=row=>{const last=row.requests.length?lookup(row.requests.at(-1)):null;return !row.link&&(!last||!last.receipt&&last.state==='REJECTED');};
  const activeReview=()=>get()?reviewCollection(get(),draft(),lookup,{hash}):null;
  function currentCollection(){
    const value=get();need(value&&value.draftId===draft()?.id,'Open this collection in its original source preparation.');
    return value;
  }
  function mark(){const value=get();if(value)value.review=null;changed();}
  function newValue(){
    need(draft(),'Create or open the original source preparation first.');
    return {schema:COLLECTION_SCHEMA,id:uid('collection-'),draftId:draft().id,title:'Original source collection',
      createdAt:now(),defaults:{sourceUrl:state().upload?.sourceUrl||'',observedAt:now()},
      rows:[],selectedId:null,pauseRequested:false,review:null};
  }
  function formField(label,attribute,value,extra=''){
    return '<label><span>'+esc(label)+'</span><input data-source-edit '+attribute+' value="'+esc(value)+'" '+extra+'></label>';
  }
  async function readFiles(files){
    requireEdit();need(!receiving&&!reading,'Finish the current collection operation first.');
    if(!files?.length)return;
    const prior=get(),collection=prior||newValue();
    need(collection.draftId===draft()?.id,'Open the collection in its original source draft.');
    need(collection.rows.length+files.length<=MAX_REVISIONS,'Keep the collection within the native draft revision capacity.');
    let bytes=collection.rows.reduce((n,row)=>n+row.original.bytes,0);
    for(const file of files){need(Number.isSafeInteger(file.size)&&file.size>0&&file.size<=MAX_FILE,
      'Every selected original must contain 1 byte to 8 MiB. The prior collection remains retained.');bytes+=file.size;}
    need(bytes<=MAX_INPUTS,'Keep the whole staged collection within 64 MiB, including originals excluded from receiving.');
    reading=true;const additions=[];
    try{
      for(const file of files){
        const raw=new Uint8Array(await file.arrayBuffer());
        need(available()&&get()===prior&&draft()?.id===collection.draftId,'Reopen the original collection after the complete file read.');
        need(raw.length===file.size,'Keep the complete original selected file.');
        const original={name:file.name,type:file.type||'application/octet-stream',lastModified:file.lastModified||0,
          bytes:raw.length,sha256:hash(raw),contentBase64:base64(raw)};
        checkedFile(original);
        additions.push({id:uid('original-'),original,filename:file.name,mediaType:original.type,
          sourceUrl:collection.defaults.sourceUrl,observedAt:collection.defaults.observedAt,
          included:true,requests:[],link:null});
      }
      await parkWorking('Before adding complete original files to the collection');
      need(available()&&get()===prior&&draft()?.id===collection.draftId,'Keep the original collection selected while reading files.');
      state().collectionWork=collection;
      collection.rows.push(...additions);collection.selectedId=additions[0].id;collection.review=null;
      changed();await persistNow();
      state().notice='Retained '+additions.length+' complete originals. Review receiving names, provenance and the full collection before receiving.';
    }finally{reading=false;}
  }
  function edit(target){
    const kind=target.dataset.sourceCollectionField,rowId=target.dataset.sourceCollectionRow;
    if(kind===undefined)return false;
    requireEdit();need(!receiving&&!reading,'Finish the current collection operation before editing.');
    const value=currentCollection();
    if(rowId){
      const row=rowById(rowId);need(row&&editable(row),'Keep the receiving fields bound to their original request or current-file selection.');
      if(kind==='included')row.included=!!target.checked;
      else{need(metadataKeys.includes(kind),'Select a declared original-file receiving field.');row[kind]=target.value;}
    }else{
      if(kind==='title')value.title=target.value;
      else if(kind==='sourceUrl'||kind==='observedAt')value.defaults[kind]=target.value;
      else throw new Error('Select a declared collection field.');
    }
    mark();return true;
  }
  async function review(){
    requireEdit();currentCollection();await bridge.refreshCurrent();
    need(available(),'Reopen the complete collection to review its current draft.');
    const value=currentCollection(),result=activeReview();
    value.review={signature:result.signature,revision:result.revision,at:now()};
    changed();await persistNow();
    state().notice=result.blocked?'The whole collection is retained. Correct or explicitly reconcile the listed rows before receiving.':
      'Reviewed '+result.ready+' originals for receiving against source revision '+result.revision+'.';
    return result;
  }
  async function recoverExisting(){
    const value=currentCollection();
    const unresolved=value.rows.flatMap(row=>{
      const id=row.requests.at(-1),original=id?lookup(id):null;
      return original&&(original.receipt||original.state!=='REJECTED')&&(!original.receipt||bridge.pending()===id)?[{row,original}]:[];
    });
    const pendingId=bridge.pending();
    if(pendingId)need(unresolved.some(item=>item.original.body.requestId===pendingId),
      'Recover the current source request before continuing this collection.');
    // One request is prepared at a time, but imported older copies can retain several completed attempts.
    for(const {original} of unresolved){
      if(value.pauseRequested||!available())return;
      await bridge.recoverRequest(original);
      need(lookup(original.body.requestId)?.receipt,'Recover the complete original file receipt before advancing the collection.');
      await bridge.refreshCurrent();
    }
  }
  async function receive(){
    currentCollection();need(!receiving&&!reading,'This collection is already being received.');
    const first=get(),before=activeReview();
    const hasRecovery=before.rows.some(row=>row.status==='RECOVER'||row.requestId!==null&&row.requestId===bridge.pending());
    if(!hasRecovery){
      requireEdit();
      need(first.review?.signature===before.signature&&!before.blocked,
        'Review the complete current collection and correct all listed rows before receiving.');
    }else need(!bridge.readonly(),'Open the current editable source edition before recovering its collection.');
    receiving=true;first.pauseRequested=false;changed();
    try{
      await persistNow();
      await recoverExisting();
      if(first.pauseRequested||!available())return;
      await bridge.refreshCurrent();need(get()===first,'Keep the complete original collection selected.');
      let plan=activeReview();
      // A fresh head must still be the edition the operator reviewed, except for our exact recovered request.
      if(!hasRecovery)need(first.review?.signature===plan.signature,
        'The source draft changed after review. Review the whole current collection before receiving.');
      need(!plan.blocked,'Correct or reconcile the listed original files before receiving the remaining collection.');
      first.review={signature:plan.signature,revision:plan.revision,at:now()};changed();await persistNow();
      for(const row of first.rows){
        if(first.pauseRequested||!available())break;
        requireEdit();plan=activeReview();
        const result=plan.rows.find(value=>value.id===row.id);
        if(['RECORDED','LINKED','EXCLUDED'].includes(result.status))continue;
        need(result.status==='READY'&&!plan.blocked,
          'The current original collection needs reconciliation before another file can be received.');
        const data=collectionData(row);
        await bridge.issue('file.add',data,draft().revision,original=>{
          need(get()===first&&editable(row)&&canonical(data)===canonical(collectionData(row)),
            'Keep the exact reviewed original file selected while preparing its request.');
          boundRequest(row,original,first.draftId);row.requests.push(original.body.requestId);
          first.review=null;changed();
        });
        need(lookup(row.requests.at(-1))?.receipt,'Retain the complete original file receipt before advancing.');
        // The host retains the row/request link before POST and the receipt before returning.
        first.review={signature:activeReview().signature,revision:draft().revision,at:now()};
        changed();await persistNow();
      }
      if(available()){
        const final=activeReview(),remaining=final.rows.filter(row=>!['RECORDED','LINKED','EXCLUDED'].includes(row.status)).length;
        state().notice=first.pauseRequested?'Paused after the current original file. Every recorded receipt and remaining input is retained.':
          remaining?'The original collection is retained with '+remaining+' rows needing review.':
          'Received the complete selected collection: '+final.recorded+' original files recorded or explicitly reused.';
      }
    }finally{
      receiving=false;changed();await persistNow();if(available())render();
    }
  }
  function pause(){
    if(!receiving)return;get().pauseRequested=true;changed();
    state().notice='Pausing after the current original request has a retained result.';
  }
  function details(row,result){
    if(!row)return empty('Choose an original file in the inventory to review all receiving fields.');
    const locked=!editable(row),extra=locked?'readonly':'';
    const provenance=row.link?.file??(result?.status==='RECORDED'?result.file:null);
    return '<section class="source-desk-upload"><h4>'+esc(row.original.name)+'</h4>'+
      hint(row.original.bytes+' original bytes · SHA256 '+row.original.sha256)+
      '<div class="source-desk-fields">'+metadataKeys.map(key=>formField(
        {filename:'Receiving filename',mediaType:'Media type',sourceUrl:'Original source URL',observedAt:'Observed at, with timezone'}[key],
        'data-source-collection-field="'+key+'" data-source-collection-row="'+row.id+'"',row[key],extra)).join('')+'</div>'+
      (provenance?hint('Retained native provenance: '+provenance.sourceUrl+' · '+provenance.observedAt+' · '+provenance.mediaType):'')+
      (result?.errors.length?'<ul>'+result.errors.map(message=>'<li>'+esc(message)+'</li>').join('')+'</ul>':'')+
      (result?.sameBytes.length?hint('Identical bytes already retained as: '+result.sameBytes.map(file=>file.filename).join(', ')):'')+
      '<div class="source-desk-actions">'+btn('Download this original','collection-download-original','data-id="'+row.id+'"')+
      (result?.status==='IDENTICAL'?btn('Use the retained identical file','collection-use-existing','data-id="'+row.id+'"'):'')+
      (row.link?btn('Clear the existing-file choice','collection-unlink','data-id="'+row.id+'"'):'')+'</div>'+
      (row.requests.length?'<h4>Original receiving requests</h4>'+table(['Request','Recorded result'],row.requests.map(id=>{
        const original=lookup(id),file=original?.receipt?.result?.file;
        return ['<code>'+esc(id)+'</code><br>'+esc(original?.state||'Missing original'),
          file?esc(file.filename)+' · revision '+original.receipt.draft.revision:
          esc(original?.lastError?.message||'Original complete request retained')];})): '')+'</section>';
  }
  function view(){
    const value=get();
    const actions=btn('Start a separate collection','collection-new','',!!bridge.pending()||bridge.readonly());
    let output='<section class="source-desk-collection">'+header('Original file collection',
      'Review a complete set of originals, keep their receiving names and provenance, then resume each original native request in order.',actions);
    if(!value)return output+empty('Choose all original customer documents together. Every complete input stays in the working-copy download.')+
      '<label>Choose complete original files<input type="file" multiple data-source-collection-files data-source-edit></label></section>';
    const plan=activeReview(),reviewed=value.review?.signature===plan.signature;
    const hasRecovery=plan.rows.some(row=>row.status==='RECOVER'||row.requestId===bridge.pending()&&row.requestId!==null);
    const labels={READY:'Ready',RECORDED:'Recorded',LINKED:'Uses retained original',EXCLUDED:'Excluded',
      RECOVER:'Original request needs recovery',IDENTICAL:'Identical name and bytes',COLLISION:'Different original at this name',
      INVALID:'Correct receiving fields',REMOVED:'Recorded, later removed',STALE_LINK:'Earlier selection changed'};
    output+='<div class="source-desk-fields">'+formField('Collection name','data-source-collection-field="title"',value.title)+
      formField('Source URL for newly selected files','data-source-collection-field="sourceUrl"',value.defaults.sourceUrl)+
      formField('Observation time for newly selected files','data-source-collection-field="observedAt"',value.defaults.observedAt)+'</div>'+
      '<label>Add complete original files<input type="file" multiple data-source-collection-files data-source-edit></label>'+
      hint(value.rows.length+' retained originals · '+plan.currentBytes+' currently selected bytes + '+plan.addedBytes+
        ' incoming bytes = '+plan.totalBytes+' / '+MAX_INPUTS+' bytes. Historical blob capacity is checked by the original writer.')+
      '<div class="source-desk-actions">'+btn('Review current collection','collection-review','',!!bridge.pending()||bridge.readonly())+
      btn(hasRecovery?'Recover and receive remaining originals':'Receive reviewed collection',
        'collection-receive','',bridge.readonly()||(!hasRecovery&&(!reviewed||plan.blocked||!plan.ready)))+
      btn('Pause after current file','collection-pause','',!receiving)+
      btn('Download complete collection and working copy','collection-download')+
      btn('Download collection inventory','collection-inventory')+'</div>'+
      (plan.problems.length?'<ul>'+plan.problems.map(message=>'<li>'+esc(message)+'</li>').join('')+'</ul>':'')+
      (reviewed?hint('This review matches current source revision '+plan.revision+'.'):
        hint('Review the current complete inventory after receiving-field or native-source changes.'))+
      (value.rows.length?table(['Receive','Original / receiving filename','State','Review'],value.rows.map(row=>{
        const result=plan.rows.find(item=>item.id===row.id);
        return ['<input type="checkbox" aria-label="Receive '+esc(row.original.name)+'" data-source-edit data-source-collection-field="included" data-source-collection-row="'+row.id+'"'+
          (row.included?' checked':'')+(!editable(row)?' disabled data-source-fixed="true"':'')+'>',
          '<strong>'+esc(row.original.name)+'</strong><br>'+esc(row.filename)+' · '+row.original.bytes+' bytes',
          esc(labels[result.status])+(result.errors.length?'<br>'+esc(result.errors[0]):''),
          btn('Review original','collection-select','data-id="'+row.id+'"')];})):empty('Add the complete original files for this source preparation.'))+
      details(rowById(value.selectedId),plan.rows.find(row=>row.id===value.selectedId))+'</section>';
    return output;
  }
  async function action(action,target){
    if(action==='collection-download')return download(pretty(bridge.snapshot()),
      (draft()?.id||'source')+'-complete-collection-working.json');
    if(action==='collection-inventory'){
      const value=currentCollection(),plan=activeReview();
      return download(pretty({schema:COLLECTION_SCHEMA,kind:'collection-inventory',collectionId:value.id,
        title:value.title,draftId:value.draftId,currentRevision:draft().revision,review:plan,
        rows:value.rows.map(row=>({id:row.id,original:{...row.original,contentBase64:undefined},
          receiving:meta(row),included:row.included,link:row.link,requests:row.requests.map(id=>copy(lookup(id)))}))}),
        value.id+'-inventory.json');
    }
    if(action==='collection-download-original'){
      const row=rowById(target.dataset.id);need(row,'Select a complete retained original.');
      return download(checkedFile(row.original),row.original.name,row.original.type);
    }
    if(action==='collection-select'){need(rowById(target.dataset.id),'Select an original collection row.');
      get().selectedId=target.dataset.id;changed();return;}
    if(action==='collection-new'){
      requireEdit();need(!receiving&&!reading,'Finish the current collection operation.');
      await parkWorking('Before starting a separate complete original-file collection');
      need(available(),'Reopen the original source preparation.');state().collectionWork=newValue();changed();await persistNow();return;
    }
    if(action==='collection-review')return review();
    if(action==='collection-receive')return receive();
    if(action==='collection-pause')return pause();
    if(action==='collection-use-existing'){
      requireEdit();const value=currentCollection(),row=rowById(target.dataset.id);
      need(row&&editable(row),'Keep original request rows bound to their native result.');
      await bridge.refreshCurrent();need(available()&&get()===value,'Keep the complete collection selected.');
      const result=activeReview().rows.find(item=>item.id===row.id);
      need(result.status==='IDENTICAL'&&result.sameName,'Review the identical current original before reusing it.');
      if(!confirm('Use the existing '+result.sameName.filename+' with its already-recorded source URL, observation time and media type? The staged original and entered provenance remain in this working copy.'))return;
      row.link={file:copy(result.sameName),revision:draft().revision,acceptedAt:now()};row.included=true;mark();await persistNow();return;
    }
    if(action==='collection-unlink'){
      requireEdit();const row=rowById(target.dataset.id);need(row?.link,'Select the retained existing-file choice.');
      row.link=null;mark();await persistNow();return;
    }
    throw new Error('Choose a declared original collection action.');
  }
  return {render:view,edit,readFiles,action,pause,running:()=>receiving,
    collectionDirty:()=>!!get()?.rows.some(row=>!row.link&&(!row.requests.length||!lookup(row.requests.at(-1))?.receipt))};
}
