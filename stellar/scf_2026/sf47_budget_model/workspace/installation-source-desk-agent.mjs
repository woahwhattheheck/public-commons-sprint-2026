// MIT. Original Installation Source Desk routes and immutable native request operations.
import {createHash} from 'node:crypto';

export const INSTALLATION_SOURCE_SCHEMA = 'stellar-forge.installation-source-desk.v1';
export const INSTALLATION_SOURCE_OPERATION_SCHEMA = 'stellar-forge.installation-source-desk-operation.v1';
export const INSTALLATION_SOURCE_MAX_FILE_BYTES = 8 * 1024 * 1024;
// Native preparation members total at most 192 MiB; the complete ZIP also carries
// its original manifest and compression framing. Admission uses the exact descriptor.
export const INSTALLATION_SOURCE_MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;
// Complete exact-text receipts include original state plus its canonical JSON.
export const INSTALLATION_SOURCE_MAX_JSON_BYTES = 256 * 1024 * 1024;
export const INSTALLATION_SOURCE_ACTIONS = Object.freeze([
  'create','file.add','file.remove','selection.save','prepare','native.receive','attach',
  'commissioning.attach','commissioning.archive.receive','edition.apply','mapping.apply',
]);
export const INSTALLATION_SOURCE_READS = Object.freeze([
  'profiles','list','detail','request','file-inspect','file','preparation','archive-describe',
  'archive','output','commissioning-inspect','commissioning-preview','archive-inspect','edition-compare','edition-preview','mapping-compare','mapping-preview','mapping-compare-wire','mapping-preview-wire','mapping-draft-wire',
]);
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&
  (Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
const fail=(message,code='GRANT_INSTALLATION_SOURCE_INPUT')=>Object.assign(new Error(message),{code});
const need=(ok,message,code)=>{if(!ok)throw fail(message,code);};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const utf8=value=>Buffer.from(value,'utf8');
const shapes={
  caseId:/^operation-[a-f0-9]{32}$/,draftId:/^source-desk-[a-f0-9]{32}$/,
  fileId:/^input-[a-f0-9]{64}$/,preparationId:/^preparation-[a-f0-9]{64}$/,
  requestId:/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/,sha256:/^[a-f0-9]{64}$/,
  filename:/^[A-Za-z0-9][A-Za-z0-9_.-]{0,199}$/,
};
const identity=(value,kind)=>{need(typeof value==='string'&&shapes[kind].test(value),'Keep the exact original '+kind+'.');return value;};
const whole=(value,label,minimum=0,maximum=10000)=>{
  need(Number.isSafeInteger(value)&&value>=minimum&&value<=maximum,'Keep the original whole '+label+'.');return value;
};
const text=(value,label,maximum,required=false)=>{
  need(typeof value==='string'&&value.length<=maximum&&!value.includes('\0')&&
    (!required||value.trim().length>0),'Keep the complete '+label+'.');return value;
};
const exact=(value,allowed,required=allowed)=>{
  need(plain(value)&&Object.keys(value).every(k=>allowed.includes(k))&&required.every(k=>Object.hasOwn(value,k)),
    'Use only the complete declared original fields: '+required.join(', ')+'.');return value;
};
const codePointCompare=(a,b)=>{
  const aa=Array.from(a),bb=Array.from(b);
  for(let i=0;i<Math.min(aa.length,bb.length);i++){
    const d=aa[i].codePointAt(0)-bb[i].codePointAt(0);if(d)return d;
  }
  return aa.length-bb.length;
};
// Native model.canonical uses Unicode code-point key order, exact integer counts
// and decimal strings. Reject values that JSON would silently omit or round.
function originalJSON(value,seen=new Set()){
  if(value===null||typeof value==='boolean')return value;
  if(typeof value==='string'){
    need(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value),
      'Use complete Unicode source text without unpaired surrogates.');return value;
  }
  if(typeof value==='number'){
    need(Number.isSafeInteger(value),'Keep original decimals as text and whole counts within their exact integer range.');
    return Object.is(value,-0)?0:value;
  }
  need(Array.isArray(value)||plain(value),'Retain original JSON arrays, objects, text, booleans and whole counts.');
  need(!seen.has(value),'Keep complete acyclic original JSON.');
  seen.add(value);let result;
  if(Array.isArray(value)){
    need(Object.keys(value).length===value.length&&Array.from({length:value.length},(_,index)=>Object.hasOwn(value,index)).every(Boolean),
      'Keep complete original arrays without missing elements or additional named fields.');
    result=value.map(item=>originalJSON(item,seen));
  }else{
    result=Object.create(null);
    for(const key of Object.keys(value).sort(codePointCompare)){
      originalJSON(key);result[key]=originalJSON(value[key],seen);
    }
  }
  seen.delete(value);return result;
}
export const installationSourceCanonical=value=>{
  const original=originalJSON(value);
  // Integer-looking object keys are reordered by ordinary JSON.stringify.
  const write=v=>Array.isArray(v)?'['+v.map(write).join(',')+']':plain(v)?
    '{'+Object.keys(v).sort(codePointCompare).map(k=>JSON.stringify(k)+':'+write(v[k])).join(',')+'}':JSON.stringify(v);
  return write(original);
};
const copy=value=>JSON.parse(installationSourceCanonical(value));
const digest=value=>hash(utf8(installationSourceCanonical(value)));
function ids(input){
  identity(input.caseId,'caseId');identity(input.draftId,'draftId');
  return '/api/operations/'+input.caseId+'/installation-sources/'+input.draftId;
}
function envelope(body){
  exact(body,['requestId','expectedRevision','actor','note','action','data'],
    ['requestId','expectedRevision','actor','action','data']);
  identity(body.requestId,'requestId');whole(body.expectedRevision,'draft revision');
  text(body.actor,'recording operator',300,true);
  if(body.note!==undefined)text(body.note,'preparation note',12000);
  need(INSTALLATION_SOURCE_ACTIONS.includes(body.action),'Choose an original Source Desk action.');
  need(plain(body.data),'Retain the complete native action data.');
  if(body.action==='file.add'){
    exact(body.data,['filename','mediaType','sourceUrl','observedAt','bytes','sha256','contentBase64']);
    identity(body.data.filename,'filename');identity(body.data.sha256,'sha256');
    whole(body.data.bytes,'original byte count',1,INSTALLATION_SOURCE_MAX_FILE_BYTES);
    need(typeof body.data.contentBase64==='string'&&
      body.data.contentBase64.length<=Math.ceil(INSTALLATION_SOURCE_MAX_FILE_BYTES/3)*4,
      'Keep the complete original file within 8 MiB.');
    const bytes=Buffer.from(body.data.contentBase64,'base64');
    need(bytes.toString('base64')===body.data.contentBase64&&bytes.length===body.data.bytes&&hash(bytes)===body.data.sha256,
      'The original upload bytes differ from their complete size or SHA256.','GRANT_INSTALLATION_SOURCE_CHANGED');
  }
  return body;
}
export function installationSourceRequestSha256(caseId,draftId,body){
  ids({caseId,draftId});envelope(body);
  return digest({schema:INSTALLATION_SOURCE_SCHEMA,caseId,draftId,body});
}
export function prepareInstallationSourceCommand(caseId,draftId,body,options={}){
  exact(options,['review','workspaceDirectory'],[]);
  body=copy(envelope(body));ids({caseId,draftId});
  const operation={schema:INSTALLATION_SOURCE_OPERATION_SCHEMA,caseId,draftId,request:body,
    requestSha256:installationSourceRequestSha256(caseId,draftId,body)};
  if(options.workspaceDirectory!==undefined){
    text(options.workspaceDirectory,'original workspace directory',4096,true);
    need(options.workspaceDirectory.startsWith('/'),'Keep the canonical original workspace directory.');
    operation.workspaceDirectory=options.workspaceDirectory;
  }
  if(options.review!==undefined)operation.review=copy(options.review);
  operation.operationSha256=digest(operation);
  return validateInstallationSourceOperation(operation);
}
export function validateInstallationSourceOperation(value,expected={}){
  exact(expected,['caseId','draftId','workspaceDirectory'],[]);
  const operation=copy(value);
  exact(operation,['schema','caseId','draftId','request','requestSha256','workspaceDirectory','review','operationSha256'],
    ['schema','caseId','draftId','request','requestSha256','operationSha256']);
  const seal=identity(operation.operationSha256,'sha256');delete operation.operationSha256;
  need(operation.schema===INSTALLATION_SOURCE_OPERATION_SCHEMA&&digest(operation)===seal,
    'The complete prepared original operation differs from its saved identity.','GRANT_INSTALLATION_SOURCE_CHANGED');
  operation.operationSha256=seal;
  ids(operation);envelope(operation.request);
  need(installationSourceRequestSha256(operation.caseId,operation.draftId,operation.request)===operation.requestSha256,
    'The prepared command differs from the original native request digest.','GRANT_INSTALLATION_SOURCE_CHANGED');
  for(const key of ['caseId','draftId','workspaceDirectory'])if(expected[key]!==undefined&&operation[key]!==undefined)
    need(expected[key]===operation[key],'The prepared operation belongs to another original '+key+'.','GRANT_INSTALLATION_SOURCE_CHANGED');
  if(operation.review!==undefined){
    const review=operation.review, schemas={
      'commissioning.archive.receive':'stellar-forge.installation-commissioning-archive.v1',
      'commissioning.attach':'stellar-forge.installation-commissioning-receiving.v1',
    };
    const expectedSchema=schemas[operation.request.action];
    need(expectedSchema&&plain(review)&&review.schema===expectedSchema,
      'Keep the original reviewed action and corresponding native preview schema.','GRANT_INSTALLATION_SOURCE_CHANGED');
    const original={...review},reviewSha=identity(review.previewSha256,'sha256');delete original.previewSha256;
    need(digest(original)===reviewSha&&review.caseId===operation.caseId&&review.draftId===operation.draftId&&
      review.draftRevision===operation.request.expectedRevision&&plain(review.selection)&&
      installationSourceCanonical(operation.request.data)===installationSourceCanonical({
        ...review.selection,expectedPreviewSha256:reviewSha}),
      'Keep the complete reviewed selection bound to this exact original request.','GRANT_INSTALLATION_SOURCE_CHANGED');
    if(operation.request.action==='commissioning.archive.receive')
      need(review.ready===true,'Keep the original archive conflict and capacity review ready before receiving.');
  }
  return operation;
}
export function prepareInstallationSourceUpload(caseId,draftId,bytes,metadata,context){
  need(Buffer.isBuffer(bytes)||bytes instanceof Uint8Array,'Use the complete original upload bytes.');
  const retained=Buffer.from(bytes);
  whole(retained.length,'original file size',1,INSTALLATION_SOURCE_MAX_FILE_BYTES);
  exact(metadata,['filename','mediaType','sourceUrl','observedAt','expectedSha256'],
    ['filename','mediaType','sourceUrl','observedAt']);
  identity(metadata.filename,'filename');text(metadata.mediaType,'original MIME type',200,true);
  text(metadata.sourceUrl,'original provenance URL',12000,true);text(metadata.observedAt,'original observation time',300,true);
  const sha256=hash(retained);
  if(metadata.expectedSha256!==undefined)need(identity(metadata.expectedSha256,'sha256')===sha256,
    'The complete upload differs from the reviewed source.','GRANT_INSTALLATION_SOURCE_CHANGED');
  exact(context,['expectedRevision','requestId','actor','note'],
    ['expectedRevision','requestId','actor']);
  const {expectedSha256,...nativeMetadata}=metadata;
  return prepareInstallationSourceCommand(caseId,draftId,{...context,action:'file.add',data:{
    ...nativeMetadata,bytes:retained.length,sha256,contentBase64:retained.toString('base64')}});
}
export function prepareInstallationSourceReview(review,context){
  review=copy(review);exact(context,['requestId','actor','note'],['requestId','actor']);
  const actions={
    'stellar-forge.installation-commissioning-archive.v1':'commissioning.archive.receive',
    'stellar-forge.installation-commissioning-receiving.v1':'commissioning.attach',
  };
  const action=actions[review.schema];
  need(action&&plain(review.selection),'Use the complete original commissioning preview and its normalized selection.');
  const seal=identity(review.previewSha256,'sha256'),original={...review};delete original.previewSha256;
  need(digest(original)===seal,'The saved native preview differs from its complete original fields.',
    'GRANT_INSTALLATION_SOURCE_CHANGED');
  if(action==='commissioning.archive.receive')need(review.ready===true,'Resolve the original archive conflicts and capacity findings before receiving.');
  if(action==='commissioning.attach')need(typeof context.note==='string'&&context.note.trim(),
    'Record the existing Installation save reason before preparing attachment.');
  return prepareInstallationSourceCommand(review.caseId,review.draftId,{
    ...context,expectedRevision:whole(review.draftRevision,'reviewed draft revision'),
    action,data:{...review.selection,expectedPreviewSha256:seal}},{review});
}
function query(route,value,allowed){
  const pairs=[];
  for(const key of allowed)if(value[key]!==undefined){
    if(key==='revision')whole(value[key],'source edition',1);
    if(key==='expectedSha256')identity(value[key],'sha256');
    pairs.push(encodeURIComponent(key)+'='+encodeURIComponent(String(value[key])));
  }
  return route+(pairs.length?'?'+pairs.join('&'):'');
}
export function planInstallationSourceOperation(action,input={}){
  // Freeze all caller data synchronously, before service admission or transport.
  input=copy(input);need(plain(input),'Use the complete original Source Desk selection.');
  if(action==='execute'||action==='reconcile'){
    exact(input,['operation']);return {action,operation:validateInstallationSourceOperation(input.operation)};
  }
  let route,options={mutation:false};
  if(action==='profiles'){exact(input,[]);route='/api/operations/installation-source-profiles';}
  else if(action==='list'){exact(input,['caseId']);identity(input.caseId,'caseId');route='/api/operations/'+input.caseId+'/installation-sources';}
  else{
    route=ids(input);
    const selection=['caseId','draftId'];
    if(action==='detail'){exact(input,[...selection,'revision'],selection);route=query(route,input,['revision']);}
    else if(action==='request'){
      exact(input,[...selection,'requestId']);route+='/requests/'+identity(input.requestId,'requestId');
      options.maxResponseBytes=INSTALLATION_SOURCE_MAX_JSON_BYTES;
    }else if(action==='command'){
      exact(input,[...selection,'body']);envelope(input.body);
      options={body:input.body,originalRequestId:input.body.requestId,mutation:true,maxResponseBytes:INSTALLATION_SOURCE_MAX_JSON_BYTES};
    }else if(action==='file-inspect'){
      exact(input,[...selection,'fileId','revision','phaseIdAmendment'],[...selection,'fileId']);
      route+='/files/'+identity(input.fileId,'fileId')+'/inspect';
      if(input.phaseIdAmendment!==undefined){
        whole(input.revision,'source edition',1);need(plain(input.phaseIdAmendment),'Retain the complete original phase amendment.');
        options.body={revision:input.revision,phaseIdAmendment:input.phaseIdAmendment};
      }else route=query(route,input,['revision']);
    }else if(action==='file'){
      exact(input,[...selection,'fileId','revision','expectedSha256'],[...selection,'fileId','expectedSha256']);
      route=query(route+'/files/'+identity(input.fileId,'fileId'),input,['revision','expectedSha256']);
    }else if(['preparation','archive-describe','archive','output'].includes(action)){
      const required=[...selection,'preparationId'];
      if(action==='archive'||action==='output')required.push('expectedSha256');
      if(action==='output')required.push('filename');
      exact(input,required);
      route+='/preparations/'+identity(input.preparationId,'preparationId');
      if(action==='archive-describe')route+='/archive?describe=1';
      if(action==='archive'){
        route=query(route+'/archive',input,['expectedSha256']);
        options.maxResponseBytes=INSTALLATION_SOURCE_MAX_ARCHIVE_BYTES;
      }
      if(action==='output')route=query(route+'/outputs/'+identity(input.filename,'filename'),input,['expectedSha256']);
    }else if(['mapping-compare','mapping-preview','mapping-compare-wire','mapping-preview-wire','mapping-draft-wire'].includes(action)){
      exact(input,[...selection,'body']);need(plain(input.body),'Keep the complete selected mapping request.');
      route+='/mappings/'+action.slice('mapping-'.length);options.body=input.body;
      if(action.endsWith('-wire'))options.maxResponseBytes=INSTALLATION_SOURCE_MAX_JSON_BYTES;
    }else if(['edition-compare','edition-preview'].includes(action)){
      exact(input,[...selection,'body']);need(plain(input.body),'Keep the complete selected edition request.');
      route+='/editions/'+(action==='edition-compare'?'compare':'preview');options.body=input.body;
    }else if(['commissioning-inspect','commissioning-preview','archive-inspect'].includes(action)){
      exact(input,[...selection,'body']);need(plain(input.body),'Retain the complete original preview input.');
      const names={'commissioning-inspect':'inspect','commissioning-preview':'preview','archive-inspect':'archive-inspect'};
      route+='/commissioning/'+names[action];options.body=input.body;
    }else throw fail('Choose a declared original Source Desk operation.');
  }
  return {action,input,route,options};
}
function checkReceipt(receipt,operation){
  need(plain(receipt)&&receipt.schema===INSTALLATION_SOURCE_SCHEMA&&
    receipt.requestId===operation.request.requestId&&receipt.requestSha256===operation.requestSha256&&
    receipt.draft?.caseId===operation.caseId&&receipt.draft?.id===operation.draftId,
    'The original receipt belongs to a different complete source request.','GRANT_INSTALLATION_SOURCE_CHANGED');
  return receipt;
}
export async function performInstallationSourceOperation(plan,send){
  if(!['execute','reconcile'].includes(plan.action)){
    let options=plan.options, expectedBytes;
    if(plan.action==='archive'){
      const description=await send(plan.route.replace(/\?expectedSha256=[a-f0-9]{64}$/, '?describe=1'),{mutation:false});
      const file=description.value;
      need(file?.preparationId===plan.input.preparationId&&file.sha256===plan.input.expectedSha256&&
        Number.isSafeInteger(file.bytes)&&file.bytes>0&&file.bytes<=INSTALLATION_SOURCE_MAX_ARCHIVE_BYTES,
        'The complete native archive descriptor differs from the reviewed preparation.',
        'GRANT_INSTALLATION_SOURCE_CHANGED');
      expectedBytes=file.bytes;options={...options,maxResponseBytes:file.bytes};
    }
    const response=await send(plan.route,options);
    if(expectedBytes!==undefined)need(response.bytes.length===expectedBytes,
      'The complete native archive length differs from its original descriptor.','GRANT_INSTALLATION_SOURCE_CHANGED');
    if(['file','archive','output'].includes(plan.action))
      need(response.sha256===plan.input.expectedSha256,'The complete native download differs from its reviewed SHA256.',
        'GRANT_INSTALLATION_SOURCE_CHANGED');
    return response;
  }
  const operation=plan.operation,base=ids(operation),lookup=await send(
    base+'/requests/'+operation.request.requestId,{mutation:false,maxResponseBytes:INSTALLATION_SOURCE_MAX_JSON_BYTES});
  need(lookup.value?.schema===INSTALLATION_SOURCE_SCHEMA&&lookup.value.requestId===operation.request.requestId&&
    ['RECORDED','NOT_RECORDED'].includes(lookup.value.state),'Read the complete original Source Desk request result.');
  if(lookup.value.state==='RECORDED'){
    checkReceipt(lookup.value.result,operation);
    return {state:'RECORDED',operation,response:lookup,receipt:lookup.value.result,replayed:true};
  }
  if(plan.action==='reconcile')return {state:'NOT_RECORDED',operation,response:lookup,receipt:null,replayed:false};
  const response=await send(base,{body:operation.request,originalRequestId:operation.request.requestId,mutation:true,maxResponseBytes:INSTALLATION_SOURCE_MAX_JSON_BYTES});
  return {state:'RECORDED',operation,response,receipt:checkReceipt(response.value,operation),replayed:false};
}

/** Freeze a reviewed successor through the same immutable native command file. */
export function prepareInstallationSourceEdition(plan,context){
  plan=copy(plan);exact(context,['requestId','actor','note'],['requestId','actor']);
  need(plan.schema==='stellar-forge.installation-source-edition-plan.v1'&&plain(plan.target),
    'Keep the complete source edition preview.');
  const original={...plan},seal=identity(plan.sha256,'sha256');delete original.sha256;
  need(digest(original)===seal,'The complete source edition plan changed.','GRANT_INSTALLATION_SOURCE_CHANGED');
  return prepareInstallationSourceCommand(plan.caseId,plan.target.draftId,{
    ...context,expectedRevision:whole(plan.target.revision,'selected target revision',1),
    action:'edition.apply',data:{plan}});
}

/** Freeze the complete native reconciliation; original command replay owns apply. */
export function prepareInstallationSourceMapping(plan,context){
  plan=copy(plan);exact(context,['requestId','actor','note'],['requestId','actor']);
  need(plan.schema==='stellar-forge.installation-mapping-plan.v1'&&plain(plan.target),
    'Keep the complete native mapping reconciliation preview.');
  const original={...plan},seal=identity(plan.sha256,'sha256');delete original.sha256;
  need(digest(original)===seal,'The complete mapping plan changed.','GRANT_INSTALLATION_SOURCE_CHANGED');
  return prepareInstallationSourceCommand(plan.caseId,plan.target.draftId,{
    ...context,expectedRevision:whole(plan.target.revision,'selected target revision',1),
    action:'mapping.apply',data:{plan}});
}

/** The native wire text preserves original large integers and float lexemes. */
export function prepareInstallationSourceMappingWire(wire,context){
  need(plain(wire)&&wire.schema==='stellar-forge.installation-mapping-wire.v1'&&
    typeof wire.canonicalJSON==='string','Keep the complete native mapping wire response.');
  const planJSON=wire.canonicalJSON;
  need(utf8(planJSON).length<=12*1024*1024&&hash(utf8(planJSON))===identity(wire.sha256,'sha256'),
    'The complete native mapping text changed.','GRANT_INSTALLATION_SOURCE_CHANGED');
  const plan=JSON.parse(planJSON);
  need(plain(plan)&&plan.schema==='stellar-forge.installation-mapping-plan.v1'&&plain(plan.target),
    'Select the exact native mapping preview text.');
  exact(context,['requestId','actor','note'],['requestId','actor']);
  // Only safe identity fields are projected. Native verify_plan reproduces every
  // original number, field, file and seal from the unchanged planJSON at apply.
  return prepareInstallationSourceCommand(plan.caseId,plan.target.draftId,{
    ...context,expectedRevision:whole(plan.target.revision,'selected target revision',1),
    action:'mapping.apply',data:{planJSON}});
}
