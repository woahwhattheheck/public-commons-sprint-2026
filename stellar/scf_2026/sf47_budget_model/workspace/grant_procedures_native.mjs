// MIT. Native Grant Operations procedures use the original client, source writer and case ZIP.
import {open, mkdir, realpath, link, unlink, rename, readdir, lstat} from 'node:fs/promises';
import {constants} from 'node:fs';
import {resolve,dirname,join,isAbsolute,basename} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {
  GRANT_PROCEDURE_SCHEMA,GRANT_PROCEDURE_MAX_BYTES,GrantProcedureError,
  procedureJSON,procedureCanonical,procedureSha256,packProcedureText,
  inspectGrantProcedure,prepareGrantProcedure,verifyGrantProcedure,makeProcedureTable,makeProcedureEdition,grantProcedureFiles,
} from './grant_procedures.mjs';

const MAX_BUNDLE=32*1024*1024,MAX_RECORD=48*1024*1024;
const need=(ok,code,message)=>{if(!ok)throw new GrantProcedureError(code,message);};
const same=(a,b)=>procedureCanonical(a)===procedureCanonical(b);
const hash=b=>createHash('sha256').update(b).digest('hex');
const jsonBytes=x=>Buffer.from(procedureJSON(x));
const identifier=x=>{need(typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(x),'PROCEDURE_REQUEST','Use one explicit original request ID.');return x;};
const caseId=x=>{need(/^operation-[a-f0-9]{32}$/.test(x||''),'PROCEDURE_CASE','Select the original native case.');return x;};
const plainPath=x=>{need(typeof x==='string'&&isAbsolute(x)&&!x.includes('\0'),'PROCEDURE_PATH','Use an absolute ordinary path.');return resolve(x);};
const utf8=bytes=>new TextDecoder('utf-8',{fatal:true}).decode(bytes);
const failure=e=>({code:e.code||null,message:String(e.message||e),status:e.status??null,
  definite:e.definite??null,uncertain:e.uncertain??null,requestId:e.requestId??null,source:e.source??null,recovery:e.recovery??null});
export async function readProcedureFile(path,maximum=MAX_RECORD) {
  path=plainPath(path);
  need(await realpath(dirname(path))===dirname(path),'PROCEDURE_PATH','Use an ordinary source parent.');
  const fd=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
    const before=await fd.stat();need(before.isFile()&&before.size<=maximum,'PROCEDURE_FILE','Use a complete regular file within its bound.');
    const raw=await fd.readFile(),after=await fd.stat();
    need(before.ino===after.ino&&before.dev===after.dev&&before.size===after.size&&before.mtimeMs===after.mtimeMs&&before.ctimeMs===after.ctimeMs&&raw.length===before.size,
      'PROCEDURE_FILE_CHANGED','The held original file changed during reading.');return raw;
  }finally{await fd.close();}
}
async function exists(path){try{await lstat(path);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
async function jsonIf(path){return await exists(path)?JSON.parse(utf8(await readProcedureFile(path))):null;}
async function syncDirectory(path){const fd=await open(path,constants.O_RDONLY);try{await fd.sync();}finally{await fd.close();}}
export async function procedureDirectory(path,{create=false}={}) {
  path=plainPath(path);
  need(await realpath(dirname(path))===dirname(path),'PROCEDURE_PATH','Select an existing ordinary private parent.');
  if(create)await mkdir(path,{mode:0o700}).catch(e=>{if(e.code!=='EEXIST')throw e;});
  const st=await lstat(path);
  need(st.isDirectory()&&!st.isSymbolicLink()&&await realpath(path)===path&&(st.mode&0o077)===0&&
    (process.getuid===undefined||st.uid===process.getuid()),'PROCEDURE_DIRECTORY','Use an owned private ordinary directory.');
  return path;
}
/** A failed temporary write stays private and never becomes a complete receipt. */
export async function retainProcedureFile(path,bytes) {
  path=plainPath(path);bytes=Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes);
  need(await realpath(dirname(path))===dirname(path),'PROCEDURE_PATH','The receiving parent must remain ordinary.');
  if(await exists(path)){
    need((await readProcedureFile(path,Math.max(MAX_RECORD,bytes.length))).equals(bytes),'PROCEDURE_FILE_CONFLICT','A retained file already has different complete bytes: '+basename(path));
    return {path,bytes:bytes.length,sha256:hash(bytes),reused:true};
  }
  const tmp=join(dirname(path),'.'+basename(path)+'.pending-'+randomUUID());
  const fd=await open(tmp,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);
  try{await fd.writeFile(bytes);await fd.sync();}finally{await fd.close();}
  try{await link(tmp,path);}catch(e){if(e.code!=='EEXIST')throw e;
    need((await readProcedureFile(path,Math.max(MAX_RECORD,bytes.length))).equals(bytes),'PROCEDURE_FILE_CONFLICT','A concurrent publication has different bytes.');}
  await syncDirectory(dirname(path));await unlink(tmp);
  need((await readProcedureFile(path,Math.max(MAX_RECORD,bytes.length))).equals(bytes),'PROCEDURE_FILE_CHANGED','Published bytes differ after readback.');
  return {path,bytes:bytes.length,sha256:hash(bytes),reused:false};
}
const retainJSON=(directory,name,value)=>retainProcedureFile(join(directory,name),jsonBytes(value));
function nativeResponse(response) {
  need(response&&Buffer.isBuffer(response.bytes)&&response.sha256===hash(response.bytes)&&Number.isInteger(response.status),
    'PROCEDURE_NATIVE_RESPONSE','Retain the complete actual native return.');
  return {status:response.status,mediaType:response.mediaType,sha256:response.sha256,filename:response.filename??null,
    source:response.source,value:response.value??null,bytes:response.bytes.length,dataBase64:response.bytes.toString('base64')};
}
function returnedValue(record) {
  const r=record.response,b=Buffer.from(r.dataBase64,'base64');
  need(b.length===r.bytes&&hash(b)===r.sha256,'PROCEDURE_RETURN_CHANGED','The retained native response differs.');
  need(same(JSON.parse(utf8(b)),r.value),'PROCEDURE_RETURN_CHANGED','Retained parsed response differs from its original bytes.');
  return r.value;
}
function reader(client,current){
  return {current,readSource:async id=>(await client.download('source',{caseId:current.program.id,sourceId:id})).bytes,
    readEdition:async(kind,ref)=>(await client.read(kind,{caseId:current.program.id,
      ...(kind==='installation'?{installationId:ref.id}:{comparisonId:ref.id}),revision:ref.revision})).value};
}
export async function prepareGrantProcedureNative(client,{
  caseId:caseIdentifier,operatingPlanText,selectedRevision,actor,note='',editionId,createdAt,
  sourceIds=[],tables=[],editions=[],stepLinks=[],parentSourceId=null,
}={}) {
  caseId(caseIdentifier);
  const caseReturn=await client.read('case',{caseId:caseIdentifier}),current=caseReturn.value,sourceTables=[],nativeEditions=[];
  let parent=null,parentProcedure=null;
  if(parentSourceId){
    const metadata=current.sources.find(x=>x.id===parentSourceId);need(metadata,'PROCEDURE_HISTORY','Select a preceding procedure in this case.');
    const response=await client.download('source',{caseId:caseIdentifier,sourceId:parentSourceId});
    parent={metadata,original:await packProcedureText(utf8(response.bytes))};
    parentProcedure=await inspectGrantProcedure(parent.original.text);
  }
  for(const item of tables){
    if(item.origin==='preceding-procedure'){
      need(parentProcedure,'PROCEDURE_HISTORY','Select the original preceding procedure before retaining one of its tables.');
      const retained=parentProcedure.document.sourceTables.find(x=>x.key===item.key);
      need(retained,'PROCEDURE_TABLE','Select an exact retained table key from that preceding procedure.');
      sourceTables.push(JSON.parse(JSON.stringify(retained)));
    }else if(item.origin==='case-plan'){
      need(current.plan.planning?.sourceTables,'PROCEDURE_TABLE','The pinned plan has no retained Source Tables project.');
      sourceTables.push(await makeProcedureTable({key:item.key,origin:item.origin,originalText:procedureJSON(current.plan.planning.sourceTables),nativePlanText:procedureJSON(current.plan)}));
    }else if(item.origin==='case-source'){
      const meta=current.sources.find(x=>x.id===item.sourceId);need(meta,'PROCEDURE_SOURCE','Select a source retained by this case.');
      const response=await client.download('source',{caseId:caseIdentifier,sourceId:meta.id});
      sourceTables.push(await makeProcedureTable({key:item.key,origin:item.origin,metadata:meta,originalText:utf8(response.bytes)}));
    }else {
      need(item.origin==='local-original'&&typeof item.originalText==='string','PROCEDURE_TABLE','Supply the complete selected local table JSON.');
      sourceTables.push(await makeProcedureTable({key:item.key,origin:item.origin,originalText:item.originalText}));
    }
  }
  for(const item of editions){
    need(['installation','task-outcome'].includes(item.kind),'PROCEDURE_EDITION','Select the original native edition kind.');
    const response=await client.read(item.kind,{caseId:caseIdentifier,revision:item.revision,
      ...(item.kind==='installation'?{installationId:item.id}:{comparisonId:item.id})});
    nativeEditions.push(await makeProcedureEdition(item.kind,utf8(response.bytes)));
  }
  const prepared=await prepareGrantProcedure({current,operatingPlanText,selectedRevision,actor,note,sourceIds,
    sourceTables,editions:nativeEditions,stepLinks,parent,...(editionId?{editionId}:{}),...(createdAt?{createdAt}:{})});
  const verification=await verifyGrantProcedure(prepared.document,reader(client,current));
  const after=await client.read('case',{caseId:caseIdentifier});
  need(after.value.program.version===current.program.version,'PROCEDURE_CASE_CHANGED','The native case changed during selection. Keep the plan and explicitly prepare against its new version.');
  return {...prepared,verification,caseReturn:nativeResponse(caseReturn),afterReturn:nativeResponse(after)};
}
export async function reopenGrantProcedureNative(client,{caseId:caseIdentifier,sourceId}={}) {
  const caseReturn=await client.read('case',{caseId:caseId(caseIdentifier)}),current=caseReturn.value;
  const metadata=current.sources.find(x=>x.id===sourceId);need(metadata,'PROCEDURE_SOURCE','The original procedure source is absent from this case.');
  const response=await client.download('source',{caseId:caseIdentifier,sourceId});
  const raw=utf8(response.bytes),inspected=await inspectGrantProcedure(raw);
  const verification=await verifyGrantProcedure(raw,{...reader(client,current),sourceId});
  return {current,metadata,raw,...inspected,verification,caseReturn:nativeResponse(caseReturn),sourceReturn:nativeResponse(response)};
}
/** Original requests are idempotent in the native case transaction table. */
async function mutate({directory,intent,resume,dispatch,emit=()=>{}}){
  await procedureDirectory(directory,{create:true});
  await retainJSON(directory,'intent.json',intent);
  const returned=await jsonIf(join(directory,'returned.json'));
  if(returned){need(same(returned.intent,intent),'PROCEDURE_REQUEST_CONFLICT','The saved response belongs to another original request.');return {value:returnedValue(returned),record:returned,reused:true};}
  const rejection=await jsonIf(join(directory,'rejected.json'));
  if(rejection)throw new GrantProcedureError('PROCEDURE_NATIVE_REJECTED','The original request was definitively rejected. Preserve this operation and prepare a new reviewed input.',{original:rejection});
  const dispatched=await jsonIf(join(directory,'dispatch.json'));
  need(!dispatched||resume===true,'PROCEDURE_RESUME_REQUIRED','Resume the exact retained original request. Do not allocate a replacement ID.');
  await retainJSON(directory,'dispatch.json',{schema:GRANT_PROCEDURE_SCHEMA+'.dispatch',intent});
  let response;
  try{response=await dispatch();}
  catch(e){
    const actual={schema:GRANT_PROCEDURE_SCHEMA+'.failure',intent,error:failure(e)};
    emit({event:'PROCEDURE_NATIVE_FAILURE',...actual});
    await retainJSON(directory,'failure-'+randomUUID()+'.json',actual);
    if(e.definite===true&&e.uncertain!==true)await retainJSON(directory,'rejected.json',actual);
    throw e;
  }
  const record={schema:GRANT_PROCEDURE_SCHEMA+'.return',intent,response:nativeResponse(response)};
  // Forward the actual positive return before a fallible disk operation.
  emit({event:'PROCEDURE_NATIVE_RETURN',...record});
  await retainJSON(directory,'returned.json',record);
  return {value:returnedValue(record),record,reused:false};
}
export async function saveGrantProcedureNative(client,{prepared,requestId,operationDirectory,workspaceDirectory,resume=false},{emit}={}) {
  const raw=typeof prepared==='string'?prepared:prepared.raw,inspected=await inspectGrantProcedure(raw),d=inspected.document;
  identifier(requestId);workspaceDirectory=plainPath(workspaceDirectory);operationDirectory=plainPath(operationDirectory);
  const filename='grant-procedure-'+d.editionId+'.json',bytes=Buffer.from(raw);
  const body={expectedVersion:d.case.version,requestId,actor:d.actor,note:d.note,filename,kind:'other',
    mediaType:'application/json',sourceUrl:'',observedAt:d.createdAt};
  const intent={schema:GRANT_PROCEDURE_SCHEMA+'.save',workspaceDirectory,caseId:d.case.id,requestId,body,
    procedure:{editionId:d.editionId,bytes:bytes.length,sha256:hash(bytes)}};
  await procedureDirectory(operationDirectory,{create:true});
  await retainProcedureFile(join(operationDirectory,'grant-procedure.json'),bytes);
  // Preflight only before this original request was dispatched; native replay can
  // legitimately return a completed transaction after the case has advanced.
  if(!await exists(join(operationDirectory,'dispatch.json'))){
    const current=(await client.read('case',{caseId:d.case.id})).value;
    need(current.program.version===d.case.version,'PROCEDURE_CASE_CHANGED','The reviewed case version changed before saving.');
    await verifyGrantProcedure(raw,reader(client,current));
  }
  const result=await mutate({directory:operationDirectory,intent,resume,emit,dispatch:()=>client.attach(d.case.id,bytes,body)});
  need(result.value.id===d.case.id&&result.value.action==='source.add'&&result.value.kind==='source'&&
    result.value.version===d.case.version+1&&/^source-[a-f0-9]{32}$/.test(result.value.recordId||''),
    'PROCEDURE_NATIVE_MISMATCH','The actual native return does not match the selected source write.');
  const reopened=await reopenGrantProcedureNative(client,{caseId:d.case.id,sourceId:result.value.recordId});
  need(reopened.raw===raw&&reopened.metadata.filename===filename,'PROCEDURE_SOURCE_CHANGED','The saved native source differs from the complete reviewed procedure.');
  const complete={schema:GRANT_PROCEDURE_SCHEMA+'.saved',intent,source:reopened.metadata,native:result.value};
  await retainJSON(operationDirectory,'COMPLETE.json',complete);
  return {complete,verification:reopened.verification,reused:result.reused};
}
async function validateDelivery(directory){
  directory=await procedureDirectory(directory);
  const manifestRaw=await readProcedureFile(join(directory,'DELIVERY.json'));const manifest=JSON.parse(utf8(manifestRaw));
  need(manifestRaw.equals(jsonBytes(manifest)),'PROCEDURE_DELIVERY_CHANGED','The complete delivery manifest must retain its original canonical bytes.');
  need(manifest?.schema===GRANT_PROCEDURE_SCHEMA+'.delivery'&&Array.isArray(manifest.members)&&manifest.members.length<=100,
    'PROCEDURE_DELIVERY','Open the complete published procedure delivery directory.');
  const allowed=new Set(['DELIVERY.json']),seen=new Set();
  for(const m of manifest.members){
    need(typeof m.name==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,239}$/.test(m.name)&&!seen.has(m.name)&&
      Number.isSafeInteger(m.bytes)&&m.bytes>=0&&/^[a-f0-9]{64}$/.test(m.sha256),'PROCEDURE_DELIVERY','The delivery member inventory is invalid.');
    seen.add(m.name);allowed.add(m.name);
    const raw=await readProcedureFile(join(directory,m.name),MAX_RECORD);
    need(raw.length===m.bytes&&hash(raw)===m.sha256,'PROCEDURE_DELIVERY_CHANGED','The complete delivery member differs: '+m.name);
  }
  for(const file of await readdir(directory))need(allowed.has(file),'PROCEDURE_DELIVERY_CHANGED','An undeclared file was added to the frozen delivery.');
  for(const name of ['case.zip','grant-procedure.json','operating-plan.json','MANIFEST.json','case-before.json','case-after.json','native-export.json'])
    need(seen.has(name),'PROCEDURE_DELIVERY','The full original case and procedure file set are required.');
  need(seen.has('receiving-inspection.json'),'PROCEDURE_DELIVERY','Retain the actual original source verification.');
  const before=JSON.parse(utf8(await readProcedureFile(join(directory,'case-before.json'))));
  const after=JSON.parse(utf8(await readProcedureFile(join(directory,'case-after.json'))));
  const record=JSON.parse(utf8(await readProcedureFile(join(directory,'native-export.json'))));
  const zip=await readProcedureFile(join(directory,'case.zip'),MAX_BUNDLE);
  need(before.program.id===manifest.caseId&&after.program.id===manifest.caseId&&
    before.program.version===manifest.caseVersion&&after.program.version===manifest.caseVersion&&
    record.bytes===zip.length&&record.sha256===hash(zip)&&record.status===200,
    'PROCEDURE_DELIVERY_CHANGED','The native export and reviewed case versions differ.');
  const raw=utf8(await readProcedureFile(join(directory,'grant-procedure.json'),GRANT_PROCEDURE_MAX_BYTES));
  const inspected=await inspectGrantProcedure(raw);
  need(inspected.document.editionId===manifest.editionId&&
    inspected.plan.id===manifest.operatingPlanId&&inspected.document.selectedRevision===manifest.selectedRevision&&
    before.sources.some(x=>x.id===manifest.sourceId&&x.sha256===hash(Buffer.from(raw))&&x.bytes===Buffer.byteLength(raw))&&
    after.sources.some(x=>x.id===manifest.sourceId&&x.sha256===hash(Buffer.from(raw))),
    'PROCEDURE_DELIVERY_CHANGED','The original procedure source is not bound to this complete case export.');
  const planned=await grantProcedureFiles(raw,JSON.parse(utf8(await readProcedureFile(join(directory,'receiving-inspection.json')))));
  for(const [name,text] of Object.entries(planned))need((await readProcedureFile(join(directory,name))).equals(Buffer.from(text)),
    'PROCEDURE_DELIVERY_CHANGED','The frozen readable file differs from its selected original procedure: '+name);
  return {directory,manifest,zip,raw,inspected};
}
export async function inspectGrantProcedureDelivery(directory){const {manifest,inspected}=await validateDelivery(directory);return {manifest,summary:inspected.summary};}
export async function exportGrantProcedureNative(client,{caseId:caseIdentifier,sourceId,expectedVersion,directory}={}) {
  caseId(caseIdentifier);directory=plainPath(directory);
  need(Number.isSafeInteger(expectedVersion)&&expectedVersion>0,'PROCEDURE_CASE','Select the reviewed case version for this export.');
  if(await exists(directory)){
    const saved=await validateDelivery(directory);
    need(saved.manifest.caseId===caseIdentifier&&saved.manifest.sourceId===sourceId&&saved.manifest.caseVersion===expectedVersion,
      'PROCEDURE_DELIVERY_CONFLICT','This published directory belongs to another case selection.');
    return {manifest:saved.manifest,directory,reused:true};
  }
  need(await realpath(dirname(directory))===dirname(directory),'PROCEDURE_PATH','Select an ordinary receiving parent.');
  for(const name of (await readdir(dirname(directory))).filter(x=>x.startsWith('.'+basename(directory)+'.pending-')).sort()){
    const oldStage=join(dirname(directory),name);
    if(!await exists(join(oldStage,'DELIVERY.json')))continue;
    const saved=await validateDelivery(oldStage);
    if(saved.manifest.caseId!==caseIdentifier||saved.manifest.caseVersion!==expectedVersion||saved.manifest.sourceId!==sourceId)continue;
    try{await rename(oldStage,directory);}catch(e){if(!['EEXIST','ENOTEMPTY'].includes(e.code))throw e;}
    await syncDirectory(dirname(directory));const actual=await validateDelivery(directory);
    need(actual.manifest.caseId===caseIdentifier&&actual.manifest.caseVersion===expectedVersion&&actual.manifest.sourceId===sourceId,
      'PROCEDURE_DELIVERY_CONFLICT','The completed publication has another original selection.');
    return {manifest:actual.manifest,directory,reused:true};
  }
  // Every stage has a distinct retained identity. A failed read-only capture is
  // preserved; only the complete validated directory becomes the delivery.
  const stage=join(dirname(directory),'.'+basename(directory)+'.pending-'+randomUUID());
  await procedureDirectory(stage,{create:true});
  const selected=await reopenGrantProcedureNative(client,{caseId:caseIdentifier,sourceId});
  need(selected.current.program.version===expectedVersion,'PROCEDURE_CASE_CHANGED','Review the current case before exporting.');
  const before=selected.current;
  const response=await client.download('case',{caseId:caseIdentifier});
  need(Buffer.isBuffer(response.bytes)&&response.bytes.length<=MAX_BUNDLE&&response.sha256===hash(response.bytes),
    'PROCEDURE_NATIVE_RESPONSE','Keep the complete original case ZIP.');
  await retainProcedureFile(join(stage,'case.zip'),response.bytes);
  const after=(await client.read('case',{caseId:caseIdentifier})).value;
  need(after.program.version===expectedVersion&&after.program.id===caseIdentifier,
    'PROCEDURE_CASE_CHANGED','The case changed during the export. The complete captured ZIP is preserved in its pending directory; select a new reviewed export.');
  const files=await grantProcedureFiles(selected.raw,selected.verification);
  files['case-before.json']=procedureJSON(before);files['case-after.json']=procedureJSON(after);
  files['native-export.json']=procedureJSON({status:response.status,mediaType:response.mediaType,bytes:response.bytes.length,
    sha256:response.sha256,filename:response.filename,source:response.source});
  for(const [name,text] of Object.entries(files))await retainProcedureFile(join(stage,name),Buffer.from(text));
  const members=[{name:'case.zip',bytes:response.bytes.length,sha256:response.sha256}];
  for(const [name,text] of Object.entries(files)){const raw=Buffer.from(text);members.push({name,bytes:raw.length,sha256:hash(raw)});}
  const manifest={schema:GRANT_PROCEDURE_SCHEMA+'.delivery',caseId:caseIdentifier,caseVersion:expectedVersion,sourceId,
    editionId:selected.document.editionId,operatingPlanId:selected.plan.id,selectedRevision:selected.document.selectedRevision,members};
  await retainJSON(stage,'DELIVERY.json',manifest);await validateDelivery(stage);
  try{await rename(stage,directory);}
  catch(e){if(!['EEXIST','ENOTEMPTY'].includes(e.code))throw e;
    const existing=await validateDelivery(directory);need(existing.manifest.caseId===caseIdentifier&&existing.manifest.caseVersion===expectedVersion&&
      existing.manifest.sourceId===sourceId,'PROCEDURE_DELIVERY_CONFLICT','Concurrent delivery has another original selection.');
    return {manifest:existing.manifest,directory,reused:true,preservedStage:stage};}
  await syncDirectory(dirname(directory));
  const saved=await validateDelivery(directory);return {manifest:saved.manifest,directory,reused:false};
}
export async function receiveGrantProcedureNative(client,{
  directory,operationDirectory,workspaceDirectory,requestId,name,actor,resume=false,
}={},{emit}={}) {
  const delivered=await validateDelivery(directory);identifier(requestId);
  need(typeof name==='string'&&name.trim()&&name.length<=300&&typeof actor==='string'&&actor.trim()&&actor.length<=300,
    'PROCEDURE_RECEIVING','Name the receiving case and operator.');
  const intent={schema:GRANT_PROCEDURE_SCHEMA+'.receive',workspaceDirectory:plainPath(workspaceDirectory),requestId,
    input:{caseId:delivered.manifest.caseId,sourceId:delivered.manifest.sourceId,editionId:delivered.manifest.editionId,
      archiveBytes:delivered.zip.length,archiveSha256:hash(delivered.zip),manifestSha256:hash(jsonBytes(delivered.manifest))},
    body:{requestId,name,actor}};
  const returned=await mutate({directory:operationDirectory,intent,resume,emit,
    dispatch:()=>client.importBundle('case',delivered.zip,intent.body)});
  caseId(returned.value.id);
  need(returned.value.action==='import'&&returned.value.version===delivered.manifest.caseVersion,
    'PROCEDURE_NATIVE_MISMATCH','The original importer did not return this complete case edition.');
  const reopened=await reopenGrantProcedureNative(client,{caseId:returned.value.id,sourceId:delivered.manifest.sourceId});
  need(reopened.raw===delivered.raw&&reopened.current.program.origin?.programId===delivered.manifest.caseId&&
    reopened.current.program.origin.archiveSha256===intent.input.archiveSha256,
    'PROCEDURE_RECEIVING_CHANGED','The receiving case does not retain the original archive and procedure.');
  const complete={schema:GRANT_PROCEDURE_SCHEMA+'.received',intent,native:returned.value,source:reopened.metadata};
  await retainJSON(operationDirectory,'COMPLETE.json',complete);
  // The independently reopened report is returned fresh; it is not substituted
  // into the immutable publication made by the sending case.
  return {complete,verification:reopened.verification,current:reopened.current,reused:returned.reused};
}
