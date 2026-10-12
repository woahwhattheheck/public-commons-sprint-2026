// MIT. Retained Cryptoworth receiving in the original accounting workspace.
import {constants} from 'node:fs';
import {lstat,mkdir,open,rename,unlink} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {renderCsv,renderHtml,validateHandoff,validateRevision,importReturn} from '../accountant/engine.mjs';
import {
  CRYPTOWORTH_PROFILE_SCHEMA,CRYPTOWORTH_SOURCE_SCHEMA,CRYPTOWORTH_PLAN_SCHEMA,CRYPTOWORTH_CAPTURE_SCHEMA,
  CRYPTOWORTH_DOCS,CRYPTOWORTH_DATE_FORMATS,CRYPTOWORTH_REQUIRED_ROLES,
  cwCheck as check,cwHash as hash,cwCanonical as canonical,cwJson as json,cwId as id,cwText as text,cwInstant as instant,
  cwDecode as decode,cwUtf8 as utf8,cwSeal as seal,cwVerify as verify,cwObject as object,
  inspectCryptoworthTemplate,createCryptoworthProfile,validateCryptoworthProfile,buildCryptoworthSource,
  createCryptoworthPlan,validateCryptoworthPlan,cryptoworthImportCsv,cryptoworthSourceCsv,
  compareCryptoworthCapture,validateCryptoworthCapture,cryptoworthComparisonCsv,normalizeCryptoworthReturn,cryptoworthAccountantCsv,cryptoworthReviewHtml,
} from '../accountant/cryptoworth.mjs';
export const CRYPTOWORTH_PACKET_BYTES=128*1024*1024;
export const CRYPTOWORTH_REQUEST_BYTES=Math.ceil(CRYPTOWORTH_PACKET_BYTES*4/3)+1000000;
const PACKET_SCHEMA='stellar-forge.cryptoworth-receiving-packet.v1';
const copy=value=>structuredClone(value),now=()=>new Date().toISOString(),digest=value=>hash(canonical(value));
const profileRecords=workspace=>workspace.state.cryptoworthProfiles??[],planRecords=workspace=>workspace.state.cryptoworthPlans??[],rollbackRecords=workspace=>workspace.state.cryptoworthRollbacks??[];
const FILE_MAX=128*1024*1024,commonNames=['original-report.json','original-manifest.json','input-manifest.json','period-close.json','review-notes.json','adjustments.json','adjustments.csv','adjustments.html'];
const fileType=name=>({json:'application/json; charset=utf-8',csv:'text/csv; charset=utf-8',html:'text/html; charset=utf-8'})[name.split('.').at(-1)]??'application/octet-stream';
const unitKey=native=>canonical([native.entityId,native.connectionId,native.id]);
function safeName(value){check(typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,239}$/.test(value),'INVALID_CRYPTOWORTH_FILE','Choose a retained file name.');return value;}
function page(items,query={}){
  const offset=Number(query.offset??0),limit=Number(query.limit??50);
  check(Number.isSafeInteger(offset)&&offset>=0&&Number.isSafeInteger(limit)&&limit>=1&&limit<=200,'INVALID_CRYPTOWORTH_PAGE','Choose a nonnegative offset and 1–200 rows.');
  if(query.status)items=items.filter(r=>r.status===query.status);
  if(query.search){const search=String(query.search).toLowerCase().slice(0,500);items=items.filter(r=>JSON.stringify(r).toLowerCase().includes(search));}
  return {items:copy(items.slice(offset,offset+limit)),totalRows:items.length,offset,limit};
}
function withoutRows(value){const {rows,...rest}=value;return copy(rest);}
function normalizedFile(value,{max}={}){const decoded=decode(value,{max});return {name:decoded.name,dataBase64:decoded.bytes.toString('base64')};}
function requirePreview(value,result){
  check(typeof value.previewSha256==='string'&&value.previewSha256===result.previewSha256,'CRYPTOWORTH_PREVIEW_CHANGED','Refresh and review this exact saved request before continuing.',409);
}
async function privateDir(path){
  try{await mkdir(path,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}
  const info=await lstat(path);check(info.isDirectory()&&!info.isSymbolicLink()&&!(info.mode&0o077),'PRIVATE_CRYPTOWORTH_DIRECTORY','Use the original private Cryptoworth workspace directory.',409);
}
async function syncDir(path){const handle=await open(path,'r');try{await handle.sync();}finally{await handle.close();}}
async function readExact(directory,file,max=FILE_MAX){
  check(file&&typeof file.sha256==='string'&&Number.isSafeInteger(file.bytes),'CRYPTOWORTH_FILE_BINDING_REQUIRED','The retained file needs its original byte/hash binding.',409);safeName(file.name);
  const handle=await open(join(directory,file.name),constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0));
  try{const info=await handle.stat();check(info.isFile()&&info.size===file.bytes&&info.size<=max,'CRYPTOWORTH_FILE_CHANGED','The retained file size or type changed.',409);
    const bytes=await handle.readFile();check(bytes.length===file.bytes&&hash(bytes)===file.sha256,'CRYPTOWORTH_FILE_CHANGED','The retained original file changed.',409);return bytes;
  }finally{await handle.close();}
}
async function writeExact(directory,name,bytes){
  safeName(name);bytes=Buffer.from(bytes);check(bytes.length<=FILE_MAX,'CRYPTOWORTH_FILE_SIZE','This complete source file exceeds the supported original file size.');
  const description={name,bytes:bytes.length,sha256:hash(bytes)};
  try{await readExact(directory,description);return description;}catch(error){if(error.code!=='ENOENT')throw error;}
  const pending=join(directory,'.pending-'+randomUUID()),handle=await open(pending,'wx',0o600);
  try{await handle.writeFile(bytes);await handle.sync();await handle.close();await rename(pending,join(directory,name));}
  finally{await handle.close().catch(()=>{});await unlink(pending).catch(error=>{if(error.code!=='ENOENT')throw error;});}
  return description;
}
/** Same-UUID retries complete exact saved files after a process interruption. */
async function persist(directory,contents,binding){
  await privateDir(directory);
  const files=[await writeExact(directory,'operation.json',json({schema:'stellar-forge.cryptoworth-retained-write.v1',...binding}))];
  for(const [name,bytes]of Object.entries(contents))files.push(await writeExact(directory,name,bytes));
  const manifest=await writeExact(directory,'files.json',json({schema:'stellar-forge.cryptoworth-files.v1',files}));files.push(manifest);
  await syncDir(directory);return files;
}
function shallowRecord(record){
  const {files,captures,returns,...rest}=record;
  return {...copy(rest),fileCount:files?.length??0,captureCount:captures?.length??0,returnCount:returns?.length??0};
}
export class CryptoworthWorkspace{
  constructor(workspace,accountant){this.workspace=workspace;this.accountant=accountant;this.pendingMutation=Promise.resolve();}
  // The original workspace owns the lease and commits. This admission chain keeps
  // a receiving-unit rollback behind an in-flight original accountant apply.
  mutate(fn){const pending=this.pendingMutation.then(fn);this.pendingMutation=pending.catch(()=>{});return pending;}
  get workspaceId(){return digest({schema:this.workspace.state.schema,createdAt:this.workspace.state.createdAt,directory:resolve(this.workspace.directory)});}
  root(){return join(this.workspace.directory,'cryptoworth');}
  profileDirectory(profileId){return join(this.root(),'profiles',id(profileId));}
  planDirectory(planId){return join(this.root(),'plans',id(planId));}
  async roots(){
    await privateDir(this.root());for(const name of ['profiles','plans','rollbacks'])await privateDir(join(this.root(),name));
  }
  profileRow(profileId){const row=profileRecords(this.workspace).find(r=>r.id===id(profileId));check(row,'CRYPTOWORTH_PROFILE_NOT_FOUND','Choose a retained template mapping.',404);return row;}
  planRow(planId){const row=planRecords(this.workspace).find(r=>r.id===id(planId));check(row,'CRYPTOWORTH_PLAN_NOT_FOUND','Choose a retained Cryptoworth plan.',404);return row;}
  captureRow(planId,captureId){const row=(this.planRow(planId).captures??[]).find(r=>r.id===id(captureId));check(row,'CRYPTOWORTH_CAPTURE_NOT_FOUND','Choose a retained native receiving capture.',404);return row;}
  async readProfile(profileId){
    const record=this.profileRow(profileId),profile=JSON.parse(utf8(await readExact(this.profileDirectory(profileId),record.files.find(f=>f.name==='profile.json'))));validateCryptoworthProfile(profile);return profile;
  }
  async readPlan(planId){
    const record=this.planRow(planId),plan=JSON.parse(utf8(await readExact(this.planDirectory(planId),record.files.find(f=>f.name==='plan.json'))));validateCryptoworthPlan(plan);return plan;
  }
  async readCapture(planId,captureId){
    const record=this.captureRow(planId,captureId),plan=await this.readPlan(planId),capture=JSON.parse(utf8(await readExact(join(this.planDirectory(planId),'captures',captureId),record.files.find(f=>f.name==='capture.json'))));
    validateCryptoworthCapture(capture,plan);return capture;
  }
  view(){
    return {revision:this.workspace.state.revision,workspaceId:this.workspaceId,
      profiles:profileRecords(this.workspace).map(shallowRecord),plans:planRecords(this.workspace).map(shallowRecord),
      handoffs:(this.workspace.state.accountantHandoffs??[]).map(r=>({id:r.id,name:r.name,createdAt:r.createdAt,source:copy(r.source??null),summary:copy(r.summary??null),
        latestRevisionId:r.revisions?.at(-1)?.id??null,revisions:(r.revisions??[]).map(v=>({id:v.id,name:v.name,createdAt:v.createdAt,summary:copy(v.summary)}))})),
      docs:CRYPTOWORTH_DOCS,dateFormats:CRYPTOWORTH_DATE_FORMATS,requiredRoles:CRYPTOWORTH_REQUIRED_ROLES};
  }
  async profileDetail(profileId){const record=this.profileRow(profileId);return {revision:this.workspace.state.revision,record:copy(record),profile:await this.readProfile(profileId),files:copy(record.files)};}
  async previewProfile(value){return this.workspace.serial(async()=>({...createCryptoworthProfile(value),workspaceRevision:this.workspace.state.revision}));}
  async createProfile(value){return this.mutate(()=>this.workspace.serial(async()=>{
    const result=createCryptoworthProfile(value),{request,profile}=result,requestSha256=digest(request),prior=profileRecords(this.workspace).find(r=>r.id===request.id);
    if(prior){check(prior.requestSha256===requestSha256&&prior.previewSha256===value.previewSha256,'CRYPTOWORTH_PROFILE_REQUEST_CHANGED','This saved profile UUID belongs to another request.',409);return {record:copy(prior),profile:await this.readProfile(prior.id),duplicate:true,revision:this.workspace.state.revision};}
    this.workspace.expected(value.revision);requirePreview(value,result);if(request.previousProfileId)this.profileRow(request.previousProfileId);
    check(profileRecords(this.workspace).length<1000,'CRYPTOWORTH_PROFILE_LIMIT','The original workspace retains 1,000 mapping profiles.');
    await this.roots();const files=await persist(this.profileDirectory(request.id),{'profile.json':json(profile),'template.csv':Buffer.from(request.file.dataBase64,'base64')},
      {id:request.id,requestSha256,previewSha256:result.previewSha256});
    const record={id:profile.id,name:profile.name,actor:profile.actor,createdAt:profile.createdAt,previousProfileId:profile.previousProfileId,target:profile.target,
      templateSha256:profile.template.sha256,integrity:profile.integrity,requestSha256,previewSha256:result.previewSha256,files};
    this.workspace.state.cryptoworthProfiles??=[];this.workspace.state.cryptoworthProfiles.push(record);await syncDir(join(this.root(),'profiles'));
    await this.workspace.commit('cryptoworth_profile_saved',request.actor,{profileId:profile.id,templateSha256:profile.template.sha256});
    return {record:copy(record),profile,duplicate:false,revision:this.workspace.state.revision};
  }));}
  async loadSource(value){
    const handoffId=id(value.handoffId),revisionId=value.accountantRevisionId==='initial'?'initial':id(value.accountantRevisionId);
    const record=this.accountant.row(handoffId),handoff=await this.accountant.readHandoff(handoffId),revision=await this.accountant.readRevision(record,handoff,revisionId);
    const contents={'handoff.json':(await this.accountant.file(handoffId,'handoff.json',{revisionId:'initial'})).bytes,
      'accountant.csv':renderCsv(handoff,revision),'accountant-review.html':renderHtml(handoff,revision)};
    if(revision)contents['accountant-return.json']=(await this.accountant.file(handoffId,'return.json',{revisionId:revision.id})).bytes;
    for(const name of commonNames)if(record.files.some(file=>file.name===name))contents[name]=(await this.accountant.file(handoffId,name,{revisionId:'initial'})).bytes;
    check(contents['original-report.json']&&contents['input-manifest.json'],'CRYPTOWORTH_SOURCE_FILES_REQUIRED','Retain the original accountant report and native input manifest.',409);
    if(handoff.source.adjustments)check(['adjustments.json','adjustments.csv','adjustments.html'].every(name=>contents[name]),'CRYPTOWORTH_ADJUSTMENT_FILES_REQUIRED','Retain all three selected adjustment companions.',409);
    const manifest=JSON.parse(utf8(contents['input-manifest.json']));
    check(hash(contents['input-manifest.json'])===handoff.source.inputManifestSha256&&Array.isArray(manifest.files),'CRYPTOWORTH_INPUT_MANIFEST_CHANGED','Use the original native input manifest frozen by the handoff.',409);
    const needed=new Set(handoff.rows.filter(r=>r.original.transfer==='OFFICIAL_TRANSFER_MATCHED').map(r=>r.original.transferEvidenceDigest));
    const proofs=[],runRoot=this.workspace.runPath(handoff.source.runId);
    for(const sha256 of needed){
      const original=manifest.files.find(f=>f.sha256===sha256&&typeof f.path==='string'&&f.path.endsWith('.json'));if(!original)continue;
      check(original.path.startsWith('sources/')&&!original.path.includes('..')&&!original.path.includes('\\')&&!original.path.includes('\0')&&resolve(runRoot,original.path).startsWith(runRoot+'/sources/'),
        'CRYPTOWORTH_PROOF_PATH_CHANGED','Use an original retained native proof path.',409);
      const path=resolve(runRoot,original.path),slash=path.lastIndexOf('/');let bytes;
      try{bytes=await readExact(path.slice(0,slash),{name:path.slice(slash+1),sha256:original.sha256,bytes:original.bytes},200000);}catch(error){if(error.code==='ENOENT')continue;throw error;}
      const name='proof-'+sha256+'.json';contents[name]=bytes;proofs.push({sha256,name,data:JSON.parse(utf8(bytes))});
    }
    if(contents['adjustments.json'])for(const item of JSON.parse(utf8(contents['adjustments.json'])).events??[])for(const adjustment of item.adjustments??[])
      if(adjustment.kind==='REFUND'&&adjustment.status==='VERIFIED')contents['refund-'+adjustment.id+'.json']=json(adjustment.verification.proof);
    const files=Object.entries(contents).map(([name,bytes])=>({name,sha256:hash(bytes),bytes:bytes.length}));
    const source=buildCryptoworthSource({handoff,revision,reportBytes:contents['original-report.json'],adjustmentsBytes:contents['adjustments.json'],
      periodCloseBytes:contents['period-close.json'],proofs,files});
    contents['source.json']=json(source);return {source,contents,handoff,revision};
  }
  async source(value){return this.workspace.serial(async()=>{
    const {source}=await this.loadSource(value);return {source:withoutRows(source),summary:source.summary,assetKeys:source.assetKeys,...page(source.rows,value)};
  });}
  async coverage(target,neededIds=null){
    const rolled=new Set(rollbackRecords(this.workspace).map(r=>unitKey(r.nativeImport))),observations=[];
    for(const record of planRecords(this.workspace)){
      if(record.target.entityId!==target.entityId||record.target.merchantAccount!==target.merchantAccount)continue;
      for(const capture of record.captures??[])if(!rolled.has(unitKey(capture.nativeImport)))observations.push({record,capture});
    }
    observations.sort((a,b)=>a.capture.nativeImport.receivedAt.localeCompare(b.capture.nativeImport.receivedAt)||a.capture.createdAt.localeCompare(b.capture.createdAt)||a.capture.id.localeCompare(b.capture.id));
    const states=new Map();
    for(const {record,capture:meta}of observations){
      const capture=await this.readCapture(record.id,meta.id),groups=new Map();
      for(const row of capture.rows)if(row.movementId&&(!neededIds||neededIds.has(row.movementId))){const rows=groups.get(row.movementId)??[];rows.push(row);groups.set(row.movementId,rows);}
      for(const [movementId,rows]of groups)states.set(unitKey(capture.nativeImport)+'\n'+movementId,{movementId,matched:rows.every(row=>row.status==='MATCHED'),
        amountAtomic:rows[0].amountAtomic,planId:record.id,captureId:capture.id,nativeImportId:capture.nativeImport.id,entityId:capture.nativeImport.entityId,
        connectionId:capture.nativeImport.connectionId,receivedAt:capture.nativeImport.receivedAt});
    }
    const found=new Map();for(const value of states.values())if(value.matched){const values=found.get(value.movementId)??[];values.push(value);found.set(value.movementId,values);}
    return [...found.values()].map(values=>({...values.at(-1),nativeImports:values.map(v=>({planId:v.planId,captureId:v.captureId,nativeImportId:v.nativeImportId,connectionId:v.connectionId,receivedAt:v.receivedAt}))}))
      .sort((a,b)=>a.movementId.localeCompare(b.movementId));
  }
  async planPreview(value){
    const profile=await this.readProfile(value.profileId),selected=await this.loadSource(value);
    if(value.previousPlanId){const previous=this.planRow(value.previousPlanId);check(previous.target.entityId===profile.target.entityId&&previous.target.merchantAccount===profile.target.merchantAccount,'CRYPTOWORTH_PREVIOUS_PLAN_TARGET','Select a previous period for the same receiving entity and merchant account.');}
    const amounts=new Map(selected.source.rows.map(r=>[r.movementId,r.amountAtomic])),coverage=(await this.coverage(profile.target,new Set(amounts.keys()))).filter(r=>amounts.get(r.movementId)===r.amountAtomic);
    return {...createCryptoworthPlan(value,{profile,source:selected.source,coverage}),profile,selected,coverage};
  }
  async previewPlan(value,query={}){return this.workspace.serial(async()=>{
    const {request,previewSha256,plan}=await this.planPreview(value);return {request,previewSha256,workspaceRevision:this.workspace.state.revision,plan:withoutRows(plan),...page(plan.rows,query)};
  });}
  async createPlan(value){return this.mutate(()=>this.workspace.serial(async()=>{
    const prior=planRecords(this.workspace).find(r=>r.id===value.id);
    if(prior){
      const {revision,previewSha256,...request}=value;
      check(prior.requestSha256===digest(request)&&prior.previewSha256===previewSha256,'CRYPTOWORTH_PLAN_REQUEST_CHANGED','This plan UUID belongs to another reviewed request.',409);
      return {record:copy(prior),plan:withoutRows(await this.readPlan(prior.id)),duplicate:true,revision:this.workspace.state.revision};
    }
    this.workspace.expected(value.revision);const result=await this.planPreview(value),{request,plan,selected}=result;requirePreview(value,result);
    check(planRecords(this.workspace).length<500,'CRYPTOWORTH_PLAN_LIMIT','The original workspace retains 500 receiving plans.');
    await this.roots();const directory=this.planDirectory(plan.id),contents={...selected.contents,'plan.json':json(plan),'source-index.csv':cryptoworthSourceCsv(plan),'review.html':cryptoworthReviewHtml(plan)};
    if(plan.canExport)contents['import.csv']=cryptoworthImportCsv(plan);
    for(const evidence of request.dateEvidence)contents['date-'+evidence.movementId+'.bin']=Buffer.from(evidence.file.dataBase64,'base64');
    const requestSha256=digest(request),files=await persist(directory,contents,{id:plan.id,requestSha256,previewSha256:result.previewSha256});
    for(const name of ['captures','returns','rollbacks'])await privateDir(join(directory,name));
    const record={id:plan.id,name:plan.name,actor:plan.actor,createdAt:plan.createdAt,profileId:plan.profileId,handoffId:plan.handoffId,
      accountantRevisionId:plan.accountantRevisionId,previousPlanId:plan.previousPlanId,target:plan.target,source:plan.source,summary:plan.summary,canExport:plan.canExport,
      integrity:plan.integrity,requestSha256,previewSha256:result.previewSha256,files,captures:[],returns:[]};
    this.workspace.state.cryptoworthPlans??=[];this.workspace.state.cryptoworthPlans.push(record);await syncDir(join(this.root(),'plans'));
    await this.workspace.commit('cryptoworth_plan_saved',request.actor,{planId:plan.id,handoffId:plan.handoffId,profileId:plan.profileId,summary:plan.summary});
    return {record:copy(record),plan:withoutRows(plan),duplicate:false,revision:this.workspace.state.revision};
  }));}
  async detail(planId){
    const record=this.planRow(planId),plan=await this.readPlan(planId),canReturn=(this.workspace.state.accountantHandoffs??[]).some(r=>r.id===plan.handoffId);
    return {revision:this.workspace.state.revision,record:copy(record),plan:withoutRows(plan),files:copy(record.files),captures:copy(record.captures),returns:copy(record.returns),
      rollbacks:copy(rollbackRecords(this.workspace).filter(r=>r.planId===planId||record.captures.some(c=>unitKey(c.nativeImport)===unitKey(r.nativeImport)))),canReturn};
  }
  async rows(planId,query){return page((await this.readPlan(planId)).rows,query);}

  async capturePreview(planId,value){
    const plan=await this.readPlan(planId),profile=await this.readProfile(plan.profileId);
    return compareCryptoworthCapture(value,{plan,profile});
  }
  async previewCapture(planId,value,query={}){return this.workspace.serial(async()=>{
    const {request,previewSha256,capture}=await this.capturePreview(planId,value);
    return {request,previewSha256,workspaceRevision:this.workspace.state.revision,comparison:withoutRows(capture),...page(capture.rows,query)};
  });}
  async createCapture(planId,value){return this.mutate(()=>this.workspace.serial(async()=>{
    const result=await this.capturePreview(planId,value),{request,capture}=result,record=this.planRow(planId),requestSha256=digest(request);
    const prior=(record.captures??[]).find(r=>r.id===request.id);
    if(prior){check(prior.requestSha256===requestSha256&&prior.previewSha256===value.previewSha256,'CRYPTOWORTH_CAPTURE_REQUEST_CHANGED','This capture UUID belongs to another native file or reviewed layout.',409);
      return {record:copy(prior),comparison:withoutRows(await this.readCapture(planId,prior.id)),duplicate:true,revision:this.workspace.state.revision};}
    this.workspace.expected(value.revision);requirePreview(value,result);
    check((record.captures??[]).length<2000,'CRYPTOWORTH_CAPTURE_LIMIT','This receiving plan retains 2,000 native captures.');
    const directory=join(this.planDirectory(planId),'captures',request.id);
    const files=await persist(directory,{'capture.json':json(capture),'received.csv':Buffer.from(request.file.dataBase64,'base64'),
      'comparison.csv':cryptoworthComparisonCsv(capture),'review.html':cryptoworthReviewHtml(await this.readPlan(planId),capture)},
      {id:request.id,requestSha256,previewSha256:result.previewSha256});
    const saved={id:capture.id,name:capture.name,actor:capture.actor,createdAt:capture.createdAt,purpose:capture.purpose,nativeImport:capture.nativeImport,
      sourceFile:capture.sourceFile,summary:capture.summary,integrity:capture.integrity,requestSha256,previewSha256:result.previewSha256,files};
    record.captures??=[];record.captures.push(saved);await syncDir(join(this.planDirectory(planId),'captures'));
    await this.workspace.commit('cryptoworth_native_capture_saved',request.actor,{planId,captureId:capture.id,nativeImport:capture.nativeImport,summary:capture.summary});
    return {record:copy(saved),comparison:withoutRows(capture),duplicate:false,revision:this.workspace.state.revision};
  }));}
  async captureDetail(planId,captureId){
    const record=this.captureRow(planId,captureId),capture=await this.readCapture(planId,captureId);
    return {revision:this.workspace.state.revision,record:copy(record),comparison:withoutRows(capture),files:this.downloads(planId,record.files,{captureId}),
      rollbacks:copy(rollbackRecords(this.workspace).filter(r=>unitKey(r.nativeImport)===unitKey(capture.nativeImport)))};
  }
  async captureRows(planId,captureId,query){return page((await this.readCapture(planId,captureId)).rows,query);}
  returnRow(planId,returnId){
    const result=(this.planRow(planId).returns??[]).find(r=>r.id===id(returnId));
    check(result,'CRYPTOWORTH_RETURN_NOT_FOUND','Choose a retained accountant return.',404);return result;
  }
  isRolled(nativeImport){return rollbackRecords(this.workspace).some(r=>unitKey(r.nativeImport)===unitKey(nativeImport));}
  async returnPreview(planId,value){
    const request=normalizeCryptoworthReturn(value),plan=await this.readPlan(planId),capture=await this.readCapture(planId,request.captureId);
    check(!this.isRolled(capture.nativeImport),'CRYPTOWORTH_IMPORT_ROLLED_BACK','The selected native import unit has a recorded rollback. Capture the active replacement before returning its accounting status.',409);
    const nativeRecord=this.accountant.row(plan.handoffId),handoff=await this.accountant.readHandoff(plan.handoffId),parent=await this.accountant.readRevision(nativeRecord,handoff);
    check(request.expectedParentId===(parent?.id??null),'STALE_ACCOUNTANT_RETURN','Reload the current original accountant revision and review this return again.',409);
    const amounts=new Map(plan.rows.map(row=>[row.movementId,row.amountAtomic]));
    const coverage=(await this.coverage(plan.target,new Set(amounts.keys()))).filter(row=>amounts.get(row.movementId)===row.amountAtomic);
    const result=cryptoworthAccountantCsv({plan,capture,handoff,parent,request,coverage});
    const nativeRequest={id:request.id,name:request.name,actor:request.actor,createdAt:request.createdAt,expectedParentId:request.expectedParentId,csvBase64:result.bytes.toString('base64')};
    const accountantPreview=await this.accountant.preview(plan.handoffId,nativeRequest);
    nativeRequest.previewSha256=accountantPreview.revision.integrity.sha256;
    const binding={request,planSha256:plan.integrity.sha256,captureSha256:capture.integrity.sha256,
      accountantPreviewSha256:nativeRequest.previewSha256,coverageSha256:digest(coverage),eligibleRowIds:result.eligibleRowIds};
    return {request,previewSha256:digest(binding),workspaceRevision:this.workspace.state.revision,summary:result.summary,
      accountantPreview:{revision:accountantPreview.revision,expectedParentId:accountantPreview.expectedParentId},nativeRequest,binding,
      bytes:result.bytes,handoffId:plan.handoffId,parent,coverage};
  }
  async previewReturn(planId,value){return this.workspace.serial(async()=>{
    const {request,previewSha256,workspaceRevision,summary,accountantPreview}=await this.returnPreview(planId,value);
    return {request,previewSha256,workspaceRevision,summary,accountantPreview};
  });}
  async returnDetail(planId,returnId){
    const record=this.returnRow(planId,returnId);
    return {revision:this.workspace.state.revision,record:copy(record),
      files:[...this.downloads(planId,record.stageFiles??[],{returnId,scope:'stage'}),...this.downloads(planId,record.files??[],{returnId,scope:'completed'})]};
  }
  async saveReturn(planId,value){return this.mutate(async()=>{
    // Keep the exact original accountant request in the same workspace before
    // entering its own serial apply. Its native UUID makes the second commit
    // recoverable after either state publication is interrupted.
    const prepared=await this.workspace.serial(async()=>{
      const request=normalizeCryptoworthReturn(value),requestSha256=digest(request),record=this.planRow(planId);
      let saved=(record.returns??[]).find(row=>row.id===request.id);
      if(saved){
        check(saved.requestSha256===requestSha256&&saved.previewSha256===value.previewSha256,'CRYPTOWORTH_RETURN_REQUEST_CHANGED','This accountant return UUID belongs to another reviewed request.',409);
        if(saved.status==='COMMITTED')return {done:true,saved:copy(saved)};
      }
      const nativeRecord=this.accountant.row(record.handoffId),original=nativeRecord.revisions.find(row=>row.id===request.id);
      let nativeRequest;
      if(saved){
        const directory=join(this.planDirectory(planId),'returns',saved.id,'stage');
        nativeRequest=JSON.parse(utf8(await readExact(directory,saved.stageFiles.find(f=>f.name==='accountant-request.json'))));
        const retained=JSON.parse(utf8(await readExact(directory,saved.stageFiles.find(f=>f.name==='request.json'))));
        check(digest(retained)===requestSha256,'CRYPTOWORTH_RETURN_REQUEST_CHANGED','The original saved accountant request changed.',409);
        if(!original){
          if(saved.status==='SUPERSEDED')return {done:true,saved:copy(saved)};
          const supersede=async(code,message)=>{
            saved.status='SUPERSEDED';saved.superseded={at:now(),actor:request.actor,code,message,currentParentId:nativeRecord.revisions.at(-1)?.id??null,originalReturnAbsent:true};
            await this.workspace.commit('cryptoworth_accountant_return_superseded',request.actor,{planId,returnId:saved.id,...saved.superseded});
            return {done:true,saved:copy(saved)};
          };
          let fresh;
          try{fresh=await this.returnPreview(planId,request);}
          catch(error){
            if(['STALE_ACCOUNTANT_RETURN','CRYPTOWORTH_IMPORT_ROLLED_BACK','CRYPTOWORTH_ACCOUNTANT_MATCH_REQUIRED'].includes(error.code))return supersede(error.code,error.message);
            throw error;
          }
          if(fresh.previewSha256!==saved.previewSha256||canonical(fresh.nativeRequest)!==canonical(nativeRequest))
            return supersede('CRYPTOWORTH_RETURN_SOURCE_CHANGED','The active native receiving coverage changed after this exact request was prepared.');
        }
      }else{
        this.workspace.expected(value.revision);check(!original,'CRYPTOWORTH_RETURN_ID_IN_USE','Choose a fresh return UUID; this ID already belongs to an original accountant return.',409);
        const result=await this.returnPreview(planId,request);requirePreview(value,result);nativeRequest=result.nativeRequest;
        check((record.returns??[]).length<2000,'CRYPTOWORTH_RETURN_LIMIT','This receiving plan retains 2,000 accountant returns.');
        const directory=join(this.planDirectory(planId),'returns',request.id);await privateDir(directory);
        const stageFiles=await persist(join(directory,'stage'),{'request.json':json(request),'binding.json':json(result.binding),
          'accountant-request.json':json(nativeRequest),'matched-return.csv':result.bytes,'coverage.json':json(result.coverage),
          'accountant-preview.json':json(result.accountantPreview.revision),...(result.parent?{'accountant-parent.json':json(result.parent)}:{})},
          {id:request.id,requestSha256,previewSha256:result.previewSha256});
        saved={id:request.id,name:request.name,actor:request.actor,createdAt:request.createdAt,captureId:request.captureId,handoffId:record.handoffId,
          status:'PREPARED',requestSha256,previewSha256:result.previewSha256,accountantPreviewSha256:nativeRequest.previewSha256,
          parentRevisionId:request.expectedParentId,summary:result.summary,stageFiles,files:[]};
        record.returns??=[];record.returns.push(saved);await syncDir(directory);await syncDir(join(this.planDirectory(planId),'returns'));
        await this.workspace.commit('cryptoworth_accountant_return_prepared',request.actor,{planId,captureId:request.captureId,returnId:request.id});
      }
      return {done:false,saved:copy(saved),nativeRequest:{...nativeRequest,revision:this.workspace.state.revision}};
    });
    if(prepared.done)return {record:prepared.saved,savedReturn:prepared.saved,duplicate:true,superseded:prepared.saved.status==='SUPERSEDED',revision:this.workspace.state.revision};
    // apply() itself acquires the existing workspace queue; nesting that call
    // inside workspace.serial would deadlock its native owner.
    const applied=await this.accountant.apply(prepared.saved.handoffId,prepared.nativeRequest);
    return this.workspace.serial(async()=>{
      const saved=this.returnRow(planId,prepared.saved.id);
      if(saved.status==='COMMITTED')return {record:copy(saved),savedReturn:copy(saved),duplicate:true,revision:this.workspace.state.revision};
      const handoff=await this.accountant.readHandoff(saved.handoffId),nativeRecord=this.accountant.row(saved.handoffId);
      const nativeSaved=nativeRecord.revisions.find(row=>row.id===saved.id);
      check(nativeSaved&&nativeSaved.integrity.sha256===saved.accountantPreviewSha256,'CRYPTOWORTH_ACCOUNTANT_RETURN_CHANGED','Recover the exact original accountant return saved for this request.',409);
      const returned=await this.accountant.readRevision(nativeRecord,handoff,saved.id);validateRevision(handoff,returned);
      const contents={};for(const file of nativeSaved.files)contents[file.name]=(await this.accountant.file(saved.handoffId,file.name,{revisionId:saved.id})).bytes;
      const directory=join(this.planDirectory(planId),'returns',saved.id,'completed');
      const files=await persist(directory,contents,{id:saved.id,requestSha256:saved.requestSha256,accountantReturnSha256:returned.integrity.sha256});
      saved.status='COMMITTED';saved.files=files;saved.integrity=copy(returned.integrity);saved.accountantReturnId=saved.id;saved.completedAt=now();
      await syncDir(join(this.planDirectory(planId),'returns',saved.id));
      await this.workspace.commit('cryptoworth_accountant_return_joined',saved.actor,{planId,captureId:saved.captureId,returnId:saved.id,handoffId:saved.handoffId,accountantReturnSha256:returned.integrity.sha256});
      return {record:copy(saved),savedReturn:copy(saved),duplicate:Boolean(applied.duplicate),revision:this.workspace.state.revision};
    });
  });}
  async rollback(planId,value){return this.mutate(()=>this.workspace.serial(async()=>{
    const request={id:id(value.id??randomUUID()),captureId:id(value.captureId),nativeImportId:text(value.nativeImportId,'actual native import ID',240),
      completedAt:instant(value.completedAt,'actual native rollback completion'),actor:text(value.actor,'operator',1000),reason:text(value.reason,'rollback reason',4000),
      reference:text(value.reference,'actual rollback reference',2000)};
    const capture=await this.readCapture(planId,request.captureId);check(request.nativeImportId===capture.nativeImport.id,'CRYPTOWORTH_ROLLBACK_UNIT_CHANGED','Select the exact native import unit shown in the retained capture.',409);
    const requestSha256=digest({planId,request}),prior=rollbackRecords(this.workspace).find(row=>row.id===request.id);
    if(prior){check(prior.requestSha256===requestSha256,'CRYPTOWORTH_ROLLBACK_REQUEST_CHANGED','This rollback UUID belongs to another completed import-unit rollback.',409);return {record:copy(prior),duplicate:true,revision:this.workspace.state.revision};}
    this.workspace.expected(value.revision);
    const existing=rollbackRecords(this.workspace).find(row=>unitKey(row.nativeImport)===unitKey(capture.nativeImport));
    check(!existing,'CRYPTOWORTH_ROLLBACK_ALREADY_RECORDED','This complete native import unit already has a retained rollback.',409,{rollbackId:existing?.id});
    check(request.completedAt>=capture.nativeImport.receivedAt,'CRYPTOWORTH_ROLLBACK_TIME','The recorded rollback must follow the native import receipt.');
    const document=seal({schema:'stellar-forge.cryptoworth-native-rollback.v1',...request,planId,nativeImport:copy(capture.nativeImport),
      captureSha256:capture.integrity.sha256,docs:[CRYPTOWORTH_DOCS.find(value=>value.url?.includes('roll-back'))??CRYPTOWORTH_DOCS]});
    await this.roots();const files=await persist(join(this.root(),'rollbacks',request.id),{'rollback.json':json(document)},{id:request.id,requestSha256});
    const saved={...copy(document),requestSha256,files};this.workspace.state.cryptoworthRollbacks??=[];this.workspace.state.cryptoworthRollbacks.push(saved);
    await syncDir(join(this.root(),'rollbacks'));await this.workspace.commit('cryptoworth_native_import_rollback_recorded',request.actor,{rollbackId:saved.id,planId,nativeImport:document.nativeImport});
    return {record:copy(saved),duplicate:false,revision:this.workspace.state.revision};
  }));}
  downloads(planId,files,query={}){
    const suffix=new URLSearchParams(Object.entries(query).filter(([,v])=>v!==undefined&&v!==null)).toString();
    return files.map(file=>({...copy(file),downloadUrl:'/api/cryptoworth/plans/'+encodeURIComponent(planId)+'/download/'+encodeURIComponent(file.name)+(suffix?'?'+suffix:'')}));
  }
  async profileFile(profileId,name){
    const record=this.profileRow(profileId),file=record.files.find(f=>f.name===safeName(name));check(file,'CRYPTOWORTH_FILE_NOT_FOUND','Choose a retained mapping file.',404);
    return {bytes:await readExact(this.profileDirectory(profileId),file),name:file.name,type:fileType(file.name)};
  }
  async file(planId,name,{captureId,returnId,rollbackId,scope}={}){
    let directory=this.planDirectory(planId),files=this.planRow(planId).files;
    check([captureId,returnId,rollbackId].filter(Boolean).length<=1,'INVALID_CRYPTOWORTH_DOWNLOAD','Select one original file scope.');
    if(captureId){files=this.captureRow(planId,captureId).files;directory=join(directory,'captures',id(captureId));}
    if(returnId){const returned=this.returnRow(planId,returnId);check(['stage','completed'].includes(scope??'completed'),'INVALID_CRYPTOWORTH_DOWNLOAD','Select the prepared or completed original return files.');
      files=(scope==='stage'?returned.stageFiles:returned.files)??[];directory=join(directory,'returns',id(returnId),scope??'completed');}
    if(rollbackId){
      const record=rollbackRecords(this.workspace).find(row=>row.id===id(rollbackId));check(record,'CRYPTOWORTH_ROLLBACK_NOT_FOUND','Choose a retained native import rollback.',404);
      const plan=this.planRow(planId);check(record.planId===planId||plan.captures.some(c=>unitKey(c.nativeImport)===unitKey(record.nativeImport)),'CRYPTOWORTH_ROLLBACK_SOURCE_CHANGED','This rollback belongs to another native import unit.',409);
      files=record.files;directory=join(this.root(),'rollbacks',record.id);
    }
    const file=files.find(f=>f.name===safeName(name));check(file,'CRYPTOWORTH_FILE_NOT_FOUND','Choose a retained Cryptoworth source or receiving file.',404);
    return {bytes:await readExact(directory,file),name:file.name,type:fileType(file.name)};
  }

  async packet(planId){return this.workspace.serial(async()=>{
    const plans=new Map(),profiles=new Map(),rollbacks=new Map(),queue=[id(planId)],entries=[],seenPaths=new Set();let total=0;
    const append=async(prefix,directory,files)=>{
      for(const descriptor of files){
        const path=prefix+'/'+safeName(descriptor.name);check(!seenPaths.has(path),'CRYPTOWORTH_PACKET_PATH_CONFLICT','An original packet file path repeats.',409);seenPaths.add(path);
        total+=descriptor.bytes;check(total<=CRYPTOWORTH_PACKET_BYTES,'CRYPTOWORTH_PACKET_SIZE','The complete included-source packet exceeds 128 MiB. Select a smaller original receiving period.');
        const bytes=await readExact(directory,descriptor);entries.push({path,bytes:bytes.length,sha256:descriptor.sha256,dataBase64:bytes.toString('base64')});
      }
    };
    const includeProfile=async profileId=>{
      if(profiles.has(profileId))return;
      const record=this.profileRow(profileId),profile=await this.readProfile(profileId);profiles.set(profileId,copy(record));
      await append('profiles/'+profileId,this.profileDirectory(profileId),record.files);
      if(profile.previousProfileId)await includeProfile(profile.previousProfileId);
    };
    const addCoverage=coverage=>{for(const item of coverage??[]){if(item?.planId)queue.push(item.planId);for(const source of item?.nativeImports??[])queue.push(source.planId);}};
    while(queue.length){
      const current=id(queue.shift());if(plans.has(current))continue;
      const record=this.planRow(current),plan=await this.readPlan(current);plans.set(current,copy(record));await includeProfile(plan.profileId);
      await append('plans/'+current,this.planDirectory(current),record.files);
      if(plan.previousPlanId)queue.push(plan.previousPlanId);
      addCoverage(plan.rows.map(row=>row.coverage).filter(Boolean));
      for(const capture of record.captures??[])await append('plans/'+current+'/captures/'+capture.id,join(this.planDirectory(current),'captures',capture.id),capture.files);
      for(const returned of record.returns??[]){
        const directory=join(this.planDirectory(current),'returns',returned.id);
        await append('plans/'+current+'/returns/'+returned.id+'/stage',join(directory,'stage'),returned.stageFiles??[]);
        if(returned.files?.length)await append('plans/'+current+'/returns/'+returned.id+'/completed',join(directory,'completed'),returned.files);
        const coverageFile=returned.stageFiles?.find(file=>file.name==='coverage.json');
        if(coverageFile)addCoverage(JSON.parse(utf8(await readExact(join(directory,'stage'),coverageFile))));
      }
      for(const rollback of rollbackRecords(this.workspace))if(rollback.planId===current||(record.captures??[]).some(c=>unitKey(c.nativeImport)===unitKey(rollback.nativeImport))){
        if(!rollbacks.has(rollback.id)){rollbacks.set(rollback.id,copy(rollback));await append('rollbacks/'+rollback.id,join(this.root(),'rollbacks',rollback.id),rollback.files);queue.push(rollback.planId);}
      }
    }
    const primary=this.planRow(planId),document=seal({schema:PACKET_SCHEMA,planId,profileId:primary.profileId,
      profiles:[...profiles.values()].sort((a,b)=>a.id.localeCompare(b.id)),plans:[...plans.values()].sort((a,b)=>a.id.localeCompare(b.id)),
      rollbacks:[...rollbacks.values()].sort((a,b)=>a.id.localeCompare(b.id)),files:entries.sort((a,b)=>a.path.localeCompare(b.path))});
    const bytes=json(document);check(bytes.length<=CRYPTOWORTH_PACKET_BYTES,'CRYPTOWORTH_PACKET_SIZE','The complete encoded source packet exceeds 128 MiB. Select a smaller original receiving period.');
    return {bytes,name:'cryptoworth-'+planId+'-receiving.json',type:'application/json; charset=utf-8'};
  });}
  packetSummary(checked){
    const {packet,plans}=checked,main=plans.get(packet.planId),existing=planRecords(this.workspace).find(row=>row.id===packet.planId);
    return {schema:PACKET_SCHEMA,planId:packet.planId,profileId:packet.profileId,sha256:checked.file.sha256,packetSha256:packet.integrity.sha256,
      name:checked.file.name,bytes:checked.file.bytes,profile:withoutRows(checked.profiles.get(packet.profileId)),plan:withoutRows(main),
      summary:{profiles:packet.profiles.length,plans:packet.plans.length,dependencies:packet.plans.length-1,
        captures:packet.plans.reduce((sum,p)=>sum+p.captures.length,0),returns:packet.plans.reduce((sum,p)=>sum+p.returns.length,0),
        rollbacks:packet.rollbacks.length,files:packet.files.length,sourceRows:main.rows.length},
      existing:{planId:existing?.id??null,received:Boolean(existing?.receivedPackets?.some(row=>row.sha256===checked.file.sha256))}};
  }
  async inspectPacket(value){const checked=validatePacket(value.file);return this.packetSummary(checked);}
  async receivePacket(value){return this.mutate(()=>this.workspace.serial(async()=>{
    const checked=validatePacket(value.file),{packet,files}=checked,actor=text(value.actor,'receiving operator',1000),name=text(value.name??checked.file.name,'packet name',240);
    const changes={profiles:0,plans:0,captures:0,returns:0,rollbacks:0},primaryExisting=planRecords(this.workspace).find(row=>row.id===packet.planId);
    if(!primaryExisting?.receivedPackets?.some(row=>row.sha256===checked.file.sha256))this.workspace.expected(value.revision);
    // Compare every immutable identity before touching the retained directories.
    for(const incoming of packet.profiles){
      const existing=profileRecords(this.workspace).find(row=>row.id===incoming.id);
      if(existing)compareRetained(existing,incoming,['integrity','requestSha256','previewSha256','files'],'profile');
    }
    for(const incoming of packet.plans){
      const existing=planRecords(this.workspace).find(row=>row.id===incoming.id);if(!existing)continue;
      compareRetained(existing,incoming,['integrity','requestSha256','previewSha256','files'],'plan');
      for(const captured of incoming.captures){const prior=existing.captures.find(row=>row.id===captured.id);if(prior)compareRetained(prior,captured,['integrity','requestSha256','previewSha256','files'],'capture');}
      for(const returned of incoming.returns){
        const prior=existing.returns.find(row=>row.id===returned.id);if(prior){
          compareRetained(prior,returned,['requestSha256','previewSha256','accountantPreviewSha256','stageFiles'],'return');
          if(prior.status==='COMMITTED'&&returned.status==='COMMITTED')compareRetained(prior,returned,['integrity','files'],'completed return');
        }
      }
    }
    for(const incoming of packet.rollbacks){
      const prior=rollbackRecords(this.workspace).find(row=>row.id===incoming.id);
      if(prior)compareRetained(prior,incoming,['integrity','requestSha256','files'],'rollback');
      check(!rollbackRecords(this.workspace).some(row=>row.id!==incoming.id&&unitKey(row.nativeImport)===unitKey(incoming.nativeImport)),
        'CRYPTOWORTH_ROLLBACK_UNIT_CONFLICT','This native import unit already has a different retained rollback identity.',409);
    }
    check(new Set([...profileRecords(this.workspace),...packet.profiles].map(row=>row.id)).size<=1000&&new Set([...planRecords(this.workspace),...packet.plans].map(row=>row.id)).size<=500,
      'CRYPTOWORTH_PACKET_HISTORY_LIMIT','This packet exceeds the original workspace receiving history limits.');
    await this.roots();
    // All paths below were derived from validated native record/file metadata.
    // Pending atomic writes can be completed with the same packet after failure.
    const writeScope=async(prefix,directory,descriptors)=>{
      await privateDir(directory);for(const descriptor of descriptors)await writeExact(directory,descriptor.name,files.get(prefix+'/'+descriptor.name));
      await syncDir(directory);
    };
    for(const record of packet.profiles)await writeScope('profiles/'+record.id,this.profileDirectory(record.id),record.files);
    for(const record of packet.plans){
      const directory=this.planDirectory(record.id);await writeScope('plans/'+record.id,directory,record.files);
      for(const name of ['captures','returns','rollbacks'])await privateDir(join(directory,name));
      for(const capture of record.captures)await writeScope('plans/'+record.id+'/captures/'+capture.id,join(directory,'captures',capture.id),capture.files);
      for(const returned of record.returns){
        const location=join(directory,'returns',returned.id);await privateDir(location);
        await writeScope('plans/'+record.id+'/returns/'+returned.id+'/stage',join(location,'stage'),returned.stageFiles);
        if(returned.files.length)await writeScope('plans/'+record.id+'/returns/'+returned.id+'/completed',join(location,'completed'),returned.files);
        await syncDir(location);
      }
      await syncDir(join(directory,'captures'));await syncDir(join(directory,'returns'));await syncDir(directory);
    }
    for(const record of packet.rollbacks)await writeScope('rollbacks/'+record.id,join(this.root(),'rollbacks',record.id),record.files);
    this.workspace.state.cryptoworthProfiles??=[];this.workspace.state.cryptoworthPlans??=[];this.workspace.state.cryptoworthRollbacks??=[];
    for(const incoming of packet.profiles)if(!profileRecords(this.workspace).some(row=>row.id===incoming.id)){this.workspace.state.cryptoworthProfiles.push(copy(incoming));changes.profiles++;}
    for(const incoming of packet.plans){
      let existing=planRecords(this.workspace).find(row=>row.id===incoming.id);
      if(!existing){existing={...copy(incoming),captures:[],returns:[],receivedPackets:[]};this.workspace.state.cryptoworthPlans.push(existing);changes.plans++;}
      for(const captured of incoming.captures)if(!existing.captures.some(row=>row.id===captured.id)){existing.captures.push(copy(captured));changes.captures++;}
      for(const returned of incoming.returns){
        const index=existing.returns.findIndex(row=>row.id===returned.id);
        if(index<0){existing.returns.push(copy(returned));changes.returns++;}
        else if(existing.returns[index].status!=='COMMITTED'&&(returned.status==='COMMITTED'||existing.returns[index].status==='PREPARED'&&returned.status==='SUPERSEDED')){existing.returns[index]=copy(returned);changes.returns++;}
      }
      check(existing.captures.length<=2000&&existing.returns.length<=2000,'CRYPTOWORTH_PACKET_HISTORY_LIMIT','The merged plan exceeds its 2,000 capture/return limit.');
    }
    for(const incoming of packet.rollbacks)if(!rollbackRecords(this.workspace).some(row=>row.id===incoming.id)){this.workspace.state.cryptoworthRollbacks.push(copy(incoming));changes.rollbacks++;}
    const primary=this.planRow(packet.planId),already=Boolean(primaryExisting?.receivedPackets?.some(row=>row.sha256===checked.file.sha256));
    primary.receivedPackets??=[];
    if(!already)primary.receivedPackets.push({sha256:checked.file.sha256,packetSha256:packet.integrity.sha256,name,actor,receivedAt:now()});
    for(const directory of ['profiles','plans','rollbacks'])await syncDir(join(this.root(),directory));
    if(!already||Object.values(changes).some(Boolean))await this.workspace.commit('cryptoworth_receiving_packet_saved',actor,{planId:packet.planId,profileId:packet.profileId,
      packetSha256:packet.integrity.sha256,fileSha256:checked.file.sha256,changes});
    return {record:copy(primary),planId:packet.planId,profileId:packet.profileId,sha256:checked.file.sha256,packetSha256:packet.integrity.sha256,changes,duplicate:already,
      revision:this.workspace.state.revision,summary:this.packetSummary(checked).summary};
  }));}
}
function compareRetained(existing,incoming,keys,kind){
  check(keys.every(key=>canonical(existing[key])===canonical(incoming[key])),'CRYPTOWORTH_PACKET_ID_CONFLICT','The packet '+kind+' UUID belongs to a different retained source.',409,{id:existing.id});
}

/** Recompute imported plans/comparisons from their included original bytes.
 * A valid packet can be reopened without the sender's path, cache or workspace.
 */
function validatePacket(input){
  const decoded=decode(input,{max:CRYPTOWORTH_PACKET_BYTES});let packet;
  try{packet=JSON.parse(utf8(decoded.bytes));}catch(error){check(false,'INVALID_CRYPTOWORTH_PACKET','Provide the complete UTF-8 receiving packet JSON.',400,{cause:error.message});}
  verify(packet,PACKET_SCHEMA);id(packet.planId);id(packet.profileId);
  for(const [key,max]of [['profiles',1000],['plans',500],['rollbacks',10000],['files',50000]])
    check(Array.isArray(packet[key])&&packet[key].length<=max,'INVALID_CRYPTOWORTH_PACKET','The complete packet '+key+' list exceeds its original bound.');
  const files=new Map(),expectedPaths=new Set(),profiles=new Map(),plans=new Map(),sources=new Map(),captures=new Map();let total=0;
  for(const entry of packet.files){
    check(object(entry)&&typeof entry.path==='string'&&entry.path.length<=1200&&!files.has(entry.path)&&Number.isSafeInteger(entry.bytes)&&entry.bytes>=0&&/^[a-f0-9]{64}$/.test(entry.sha256),
      'INVALID_CRYPTOWORTH_PACKET_FILE','Each original packet file needs a unique path and exact byte/hash binding.');
    const file=decode({name:'source',dataBase64:entry.dataBase64},{max:CRYPTOWORTH_PACKET_BYTES});
    check(file.bytes.length===entry.bytes&&hash(file.bytes)===entry.sha256,'CRYPTOWORTH_PACKET_FILE_CHANGED','An included original file changed.',409,{path:entry.path});
    total+=entry.bytes;check(total<=CRYPTOWORTH_PACKET_BYTES,'CRYPTOWORTH_PACKET_SIZE','The complete decoded source exceeds 128 MiB.');files.set(entry.path,file.bytes);
  }
  const bytes=(prefix,name)=>{
    const value=files.get(prefix+'/'+safeName(name));check(value,'CRYPTOWORTH_PACKET_FILE_MISSING','Include the complete original source file.',409,{path:prefix+'/'+name});return value;
  };
  const document=(prefix,name)=>{
    let result;try{result=JSON.parse(utf8(bytes(prefix,name)));}catch(error){check(false,'INVALID_CRYPTOWORTH_PACKET_JSON','An included original JSON document could not be read.',400,{path:prefix+'/'+name,cause:error.message});}
    return result;
  };
  const scope=(prefix,descriptors)=>{
    check(Array.isArray(descriptors)&&descriptors.length>0&&descriptors.length<=10000,'INVALID_CRYPTOWORTH_PACKET_FILES','Retain the complete native file manifest.');
    const names=new Set();
    for(const descriptor of descriptors){
      safeName(descriptor.name);check(!names.has(descriptor.name),'DUPLICATE_CRYPTOWORTH_PACKET_FILE','An original file manifest repeats a name.');names.add(descriptor.name);
      const content=bytes(prefix,descriptor.name);check(descriptor.bytes===content.length&&descriptor.sha256===hash(content),'CRYPTOWORTH_PACKET_FILE_CHANGED','The packet file differs from its original retained manifest.',409,{path:prefix+'/'+descriptor.name});
      const path=prefix+'/'+descriptor.name;check(!expectedPaths.has(path),'DUPLICATE_CRYPTOWORTH_PACKET_SCOPE','A packet source scope repeats.');expectedPaths.add(path);
    }
    check(names.has('operation.json')&&names.has('files.json'),'CRYPTOWORTH_PACKET_WRITE_MISSING','Retain the original operation and file manifest.');
    const manifest=document(prefix,'files.json');check(manifest.schema==='stellar-forge.cryptoworth-files.v1'&&canonical(manifest.files)===canonical(descriptors.filter(file=>file.name!=='files.json')),
      'CRYPTOWORTH_PACKET_MANIFEST_CHANGED','The original complete file manifest changed.',409);
  };
  const operation=(prefix,binding)=>{
    const value=document(prefix,'operation.json');
    check(value.schema==='stellar-forge.cryptoworth-retained-write.v1'&&Object.entries(binding).every(([key,v])=>canonical(value[key])===canonical(v)),
      'CRYPTOWORTH_PACKET_OPERATION_CHANGED','Use the exact original saved operation binding.',409);
  };
  const recordMatches=(record,value,keys)=>{
    check(keys.every(key=>canonical(record[key])===canonical(value[key])),'CRYPTOWORTH_PACKET_RECORD_CHANGED','The saved source metadata differs from its original document.',409,{id:record.id});
  };
  for(const record of packet.profiles){
    id(record.id);check(!profiles.has(record.id),'DUPLICATE_CRYPTOWORTH_PROFILE','The packet repeats a mapping UUID.');
    const prefix='profiles/'+record.id;scope(prefix,record.files);
    const profile=document(prefix,'profile.json');validateCryptoworthProfile(profile);
    const rebuilt=createCryptoworthProfile({...profile,file:{name:profile.template.name,dataBase64:bytes(prefix,'template.csv').toString('base64')},delimiter:profile.template.delimiter});
    check(rebuilt.profile.integrity.sha256===profile.integrity.sha256,'CRYPTOWORTH_PACKET_PROFILE_CHANGED','Rebuild this mapping from its actual native template.',409);
    recordMatches(record,profile,['id','name','actor','createdAt','previousProfileId','target','integrity']);
    check(record.templateSha256===profile.template.sha256&&record.requestSha256===digest(rebuilt.request)&&record.previewSha256===profile.integrity.sha256,'CRYPTOWORTH_PACKET_PROFILE_CHANGED','The saved template request changed.',409);
    operation(prefix,{id:profile.id,requestSha256:record.requestSha256,previewSha256:record.previewSha256});profiles.set(profile.id,profile);
  }
  for(const profile of profiles.values())if(profile.previousProfileId)check(profiles.has(profile.previousProfileId),'CRYPTOWORTH_PACKET_PROFILE_PREDECESSOR','Include the original prior mapping edition.',409);
  for(const record of packet.plans){
    id(record.id);check(!plans.has(record.id),'DUPLICATE_CRYPTOWORTH_PLAN','The packet repeats a plan UUID.');
    const prefix='plans/'+record.id;scope(prefix,record.files);
    check(Array.isArray(record.captures)&&record.captures.length<=2000&&Array.isArray(record.returns)&&record.returns.length<=2000,'INVALID_CRYPTOWORTH_PACKET_HISTORY','Use the complete native capture/return lists.');
    const plan=document(prefix,'plan.json'),source=document(prefix,'source.json'),handoff=document(prefix,'handoff.json'),revision=source.accountantRevisionId==='initial'?null:document(prefix,'accountant-return.json');
    validateCryptoworthPlan(plan);verify(source,CRYPTOWORTH_SOURCE_SCHEMA);validateHandoff(handoff);if(revision)validateRevision(handoff,revision);
    const profile=profiles.get(plan.profileId);check(profile,'CRYPTOWORTH_PACKET_PROFILE_MISSING','Include the exact profile used by this plan.',409);
    for(const [name,key]of [['original-report.json','reportSha256'],['original-manifest.json','manifestSha256'],['input-manifest.json','inputManifestSha256']])
      check(hash(bytes(prefix,name))===handoff.source[key],'CRYPTOWORTH_PACKET_SOURCE_CHANGED','An original accountant source companion changed.',409,{name});
    check(Array.isArray(source.files),'CRYPTOWORTH_PACKET_SOURCE_FILES','Retain the selected source file manifest.');
    for(const file of source.files){const content=bytes(prefix,file.name);check(content.length===file.bytes&&hash(content)===file.sha256,'CRYPTOWORTH_PACKET_SOURCE_CHANGED','A frozen source companion changed.',409,{name:file.name});}
    const proofs=source.files.filter(file=>/^proof-[a-f0-9]{64}\.json$/.test(file.name)).map(file=>({sha256:file.name.slice(6,-5),name:file.name,data:document(prefix,file.name)}));
    const rebuilt=buildCryptoworthSource({handoff,revision,reportBytes:bytes(prefix,'original-report.json'),
      adjustmentsBytes:files.get(prefix+'/adjustments.json'),periodCloseBytes:files.get(prefix+'/period-close.json'),proofs,files:source.files});
    check(rebuilt.integrity.sha256===source.integrity.sha256&&source.integrity.sha256===plan.sourceSha256,'CRYPTOWORTH_PACKET_SOURCE_CHANGED','The included original source no longer produces this frozen plan.',409);
    const coverageById=new Map();
    for(const row of plan.rows)if(row.coverage){
      const prior=coverageById.get(row.movementId);check(!prior||canonical(prior)===canonical(row.coverage),'CRYPTOWORTH_PACKET_COVERAGE_CHANGED','Repeated source occurrences disagree about native coverage.',409);
      coverageById.set(row.movementId,row.coverage);
    }
    const coverage=[...coverageById.values()].sort((a,b)=>a.movementId.localeCompare(b.movementId));
    const request={id:plan.id,name:plan.name,actor:plan.actor,createdAt:plan.createdAt,profileId:plan.profileId,handoffId:plan.handoffId,
      accountantRevisionId:plan.accountantRevisionId,previousPlanId:plan.previousPlanId,decisions:plan.decisions,
      dateEvidence:plan.dateEvidence.map(item=>({movementId:item.movementId,transferAt:item.transferAt,note:item.note,
        file:{name:item.name,dataBase64:bytes(prefix,'date-'+item.movementId+'.bin').toString('base64')}}))};
    const recomputed=createCryptoworthPlan(request,{profile,source,coverage});
    check(recomputed.plan.integrity.sha256===plan.integrity.sha256&&record.requestSha256===digest(recomputed.request)&&record.previewSha256===plan.integrity.sha256,
      'CRYPTOWORTH_PACKET_PLAN_CHANGED','The included template, decisions and native date files do not produce this saved plan.',409);
    recordMatches(record,plan,['id','name','actor','createdAt','profileId','handoffId','accountantRevisionId','previousPlanId','target','source','summary','canExport','integrity']);
    check(bytes(prefix,'source-index.csv').equals(cryptoworthSourceCsv(plan))&&bytes(prefix,'review.html').equals(cryptoworthReviewHtml(plan)),'CRYPTOWORTH_PACKET_REVIEW_CHANGED','The retained source index or readable review changed.',409);
    if(plan.canExport)check(bytes(prefix,'import.csv').equals(cryptoworthImportCsv(plan)),'CRYPTOWORTH_PACKET_IMPORT_CHANGED','The original native input CSV no longer matches the selected rows.',409);
    operation(prefix,{id:plan.id,requestSha256:record.requestSha256,previewSha256:record.previewSha256});
    plans.set(plan.id,plan);sources.set(plan.id,{source,handoff,revision,coverage,prefix,record});
  }
  check(plans.has(packet.planId)&&profiles.has(packet.profileId)&&plans.get(packet.planId).profileId===packet.profileId,'CRYPTOWORTH_PACKET_PRIMARY','Select the complete primary receiving plan.');
  for(const plan of plans.values())if(plan.previousPlanId)check(plans.has(plan.previousPlanId),'CRYPTOWORTH_PACKET_PREVIOUS_PERIOD','Include the original prior-period plan.',409);
  for(const record of packet.plans){
    const plan=plans.get(record.id),profile=profiles.get(plan.profileId);
    for(const metadata of record.captures){
      id(metadata.id);const key=record.id+'/'+metadata.id;check(!captures.has(key),'DUPLICATE_CRYPTOWORTH_CAPTURE','The packet repeats a native capture UUID.');
      const prefix='plans/'+record.id+'/captures/'+metadata.id;scope(prefix,metadata.files);
      const capture=document(prefix,'capture.json');validateCryptoworthCapture(capture,plan);
      const result=compareCryptoworthCapture({...capture,file:{name:capture.sourceFile.name,dataBase64:bytes(prefix,'received.csv').toString('base64')}},{plan,profile});
      check(result.capture.integrity.sha256===capture.integrity.sha256&&metadata.requestSha256===digest(result.request)&&metadata.previewSha256===capture.integrity.sha256,
        'CRYPTOWORTH_PACKET_CAPTURE_CHANGED','The original native file and selected layout no longer produce this comparison.',409);
      recordMatches(metadata,capture,['id','name','actor','createdAt','purpose','nativeImport','sourceFile','summary','integrity']);
      check(bytes(prefix,'comparison.csv').equals(cryptoworthComparisonCsv(capture))&&bytes(prefix,'review.html').equals(cryptoworthReviewHtml(plan,capture)),'CRYPTOWORTH_PACKET_COMPARISON_CHANGED','The readable native comparison changed.',409);
      operation(prefix,{id:capture.id,requestSha256:metadata.requestSha256,previewSha256:metadata.previewSha256});captures.set(key,capture);
    }
  }
  const verifyCoverage=(coverage,target)=>{
    const movements=new Set();
    for(const item of coverage){
      check(object(item)&&!movements.has(item.movementId)&&Array.isArray(item.nativeImports)&&item.nativeImports.length>0,'CRYPTOWORTH_PACKET_COVERAGE_CHANGED','Retain the original native receiving coverage.',409);movements.add(item.movementId);
      const resolveCoverage=reference=>{
        const plan=plans.get(reference.planId),capture=captures.get(reference.planId+'/'+reference.captureId);
        check(plan&&capture&&plan.target.entityId===target.entityId&&plan.target.merchantAccount===target.merchantAccount,'CRYPTOWORTH_PACKET_COVERAGE_SOURCE','Include the original matching receiving plan and capture.',409);
        const rows=capture.rows.filter(row=>row.movementId===item.movementId);
        check(rows.length>0&&rows.every(row=>row.status==='MATCHED'&&row.amountAtomic===item.amountAtomic),'CRYPTOWORTH_PACKET_COVERAGE_MATCH','Prior native coverage must retain its complete exact source match.',409);
        return {movementId:item.movementId,matched:true,amountAtomic:rows[0].amountAtomic,planId:plan.id,captureId:capture.id,
          nativeImportId:capture.nativeImport.id,entityId:capture.nativeImport.entityId,connectionId:capture.nativeImport.connectionId,receivedAt:capture.nativeImport.receivedAt};
      };
      const primary=resolveCoverage(item),nativeImports=item.nativeImports.map(reference=>{
        const source=resolveCoverage(reference);const expected={planId:source.planId,captureId:source.captureId,nativeImportId:source.nativeImportId,connectionId:source.connectionId,receivedAt:source.receivedAt};
        check(canonical(expected)===canonical(reference),'CRYPTOWORTH_PACKET_COVERAGE_SOURCE','The exact prior native import-unit reference changed.',409);return expected;
      });
      check(nativeImports.some(reference=>reference.planId===primary.planId&&reference.captureId===primary.captureId)&&canonical({...primary,nativeImports})===canonical(item),
        'CRYPTOWORTH_PACKET_COVERAGE_CHANGED','The retained prior receiving source identity changed.',409);
    }
  };
  for(const plan of plans.values())verifyCoverage(sources.get(plan.id).coverage,plan.target);
  for(const record of packet.plans){
    const plan=plans.get(record.id),{handoff,prefix:planPrefix}=sources.get(record.id),seen=new Set();
    for(const returned of record.returns){
      id(returned.id);check(!seen.has(returned.id)&&['PREPARED','SUPERSEDED','COMMITTED'].includes(returned.status),'INVALID_CRYPTOWORTH_PACKET_RETURN','Use each retained original return UUID once.');seen.add(returned.id);
      const stage='plans/'+record.id+'/returns/'+returned.id+'/stage';scope(stage,returned.stageFiles);check(Array.isArray(returned.files),'INVALID_CRYPTOWORTH_PACKET_RETURN','Retain the complete original returned file list.');
      const request=normalizeCryptoworthReturn(document(stage,'request.json')),native=document(stage,'accountant-request.json'),binding=document(stage,'binding.json'),coverage=document(stage,'coverage.json');
      check(Array.isArray(coverage),'CRYPTOWORTH_PACKET_RETURN_COVERAGE','Retain the original accountant return coverage.');verifyCoverage(coverage,plan.target);
      const parent=files.has(stage+'/accountant-parent.json')?document(stage,'accountant-parent.json'):null;if(parent)validateRevision(handoff,parent);
      const capture=captures.get(record.id+'/'+request.captureId);check(capture,'CRYPTOWORTH_PACKET_RETURN_CAPTURE','Include the exact native capture used by this accountant return.',409);
      const csv=cryptoworthAccountantCsv({plan,capture,handoff,parent,request,coverage});
      const preview=importReturn({handoff,csvBytes:csv.bytes,actor:request.actor,name:request.name,parentRevision:parent,createdAt:request.createdAt,id:request.id});
      const expectedNative={id:request.id,name:request.name,actor:request.actor,createdAt:request.createdAt,expectedParentId:request.expectedParentId,csvBase64:csv.bytes.toString('base64'),previewSha256:preview.integrity.sha256};
      const expectedBinding={request,planSha256:plan.integrity.sha256,captureSha256:capture.integrity.sha256,accountantPreviewSha256:preview.integrity.sha256,
        coverageSha256:digest(coverage),eligibleRowIds:csv.eligibleRowIds};
      check(canonical(native)===canonical(expectedNative)&&canonical(binding)===canonical(expectedBinding)&&bytes(stage,'matched-return.csv').equals(csv.bytes)
        &&document(stage,'accountant-preview.json').integrity.sha256===preview.integrity.sha256,'CRYPTOWORTH_PACKET_RETURN_CHANGED','The retained native accountant preview changed.',409);
      check(returned.id===request.id&&returned.handoffId===plan.handoffId&&returned.captureId===request.captureId&&returned.parentRevisionId===(parent?.id??null)
        &&returned.requestSha256===digest(request)&&returned.previewSha256===digest(binding)&&returned.accountantPreviewSha256===preview.integrity.sha256,
        'CRYPTOWORTH_PACKET_RETURN_CHANGED','The saved original accountant request identity changed.',409);
      operation(stage,{id:returned.id,requestSha256:returned.requestSha256,previewSha256:returned.previewSha256});
      if(returned.status==='COMMITTED'){
        const completed='plans/'+record.id+'/returns/'+returned.id+'/completed';scope(completed,returned.files);
        const actual=document(completed,'return.json');validateRevision(handoff,actual);
        check(actual.integrity.sha256===preview.integrity.sha256&&returned.integrity?.sha256===preview.integrity.sha256&&returned.accountantReturnId===returned.id,
          'CRYPTOWORTH_PACKET_ACCOUNTANT_RETURN_CHANGED','The included original accountant return differs from its saved preview.',409);
        check(bytes(completed,'returned.csv').equals(csv.bytes)&&bytes(completed,'accountant.csv').equals(renderCsv(handoff,actual))&&bytes(completed,'review.html').equals(renderHtml(handoff,actual))
          &&bytes(completed,'handoff.json').equals(bytes(planPrefix,'handoff.json')),'CRYPTOWORTH_PACKET_ACCOUNTANT_FILES_CHANGED','The returned original accountant packet changed.',409);
        for(const name of commonNames)if(files.has(planPrefix+'/'+name))check(bytes(completed,name).equals(bytes(planPrefix,name)),'CRYPTOWORTH_PACKET_ACCOUNTANT_SOURCE_CHANGED','Preserve every original selected source and adjustment companion in the returned packet.',409,{name});
        operation(completed,{id:returned.id,requestSha256:returned.requestSha256,accountantReturnSha256:actual.integrity.sha256});
      }else {
        check(returned.files.length===0,'CRYPTOWORTH_PACKET_RETURN_STATE','An unapplied return cannot claim completed original files.');
        if(returned.status==='SUPERSEDED')check(returned.superseded?.originalReturnAbsent===true&&typeof returned.superseded.code==='string'&&typeof returned.superseded.at==='string','CRYPTOWORTH_PACKET_RETURN_STATE','Retain the original superseded request outcome.');
      }
    }
  }
  const rolledIds=new Set(),rolledUnits=new Set();
  for(const record of packet.rollbacks){
    id(record.id);check(!rolledIds.has(record.id),'DUPLICATE_CRYPTOWORTH_ROLLBACK','The packet repeats a rollback UUID.');rolledIds.add(record.id);
    const prefix='rollbacks/'+record.id;scope(prefix,record.files);const documentValue=document(prefix,'rollback.json');verify(documentValue,'stellar-forge.cryptoworth-native-rollback.v1');
    const capture=captures.get(documentValue.planId+'/'+documentValue.captureId);check(capture&&capture.integrity.sha256===documentValue.captureSha256&&canonical(capture.nativeImport)===canonical(documentValue.nativeImport),
      'CRYPTOWORTH_PACKET_ROLLBACK_SOURCE','Include the exact native import unit and capture rolled back.',409);
    const request={id:documentValue.id,captureId:documentValue.captureId,nativeImportId:text(documentValue.nativeImportId,'native import ID',240),
      completedAt:instant(documentValue.completedAt,'completed rollback'),actor:text(documentValue.actor,'operator',1000),reason:text(documentValue.reason,'rollback reason',4000),reference:text(documentValue.reference,'rollback reference',2000)};
    check(request.nativeImportId===capture.nativeImport.id&&request.completedAt>=capture.nativeImport.receivedAt&&!rolledUnits.has(unitKey(capture.nativeImport)),
      'CRYPTOWORTH_PACKET_ROLLBACK_UNIT','Retain one completed rollback per original native import unit.',409);rolledUnits.add(unitKey(capture.nativeImport));
    const {files:metadataFiles,requestSha256,...retained}=record;check(canonical(retained)===canonical(documentValue)&&requestSha256===digest({planId:documentValue.planId,request}),
      'CRYPTOWORTH_PACKET_ROLLBACK_CHANGED','The original rollback record changed.',409);operation(prefix,{id:record.id,requestSha256});
  }
  check(expectedPaths.size===files.size,'CRYPTOWORTH_PACKET_EXTRA_FILES','Every included original file must belong to its exact retained source scope.');
  return {packet,files,profiles,plans,sources,captures,file:{name:decoded.name,bytes:decoded.bytes.length,sha256:hash(decoded.bytes)}};
}
export async function handleCryptoworthRequest(controller,{method,path,query={},value}){
  const parts=path.split('/').filter(Boolean);if(parts[0]!=='api'||parts[1]!=='cryptoworth')return null;
  for(let i=2;i<parts.length;i++){try{parts[i]=decodeURIComponent(parts[i]);}catch{check(false,'INVALID_CRYPTOWORTH_PATH','Choose an original workspace route.');}}
  if(method==='POST'){
    check(object(value),'INVALID_CRYPTOWORTH_REQUEST','Provide the original reviewed request.');
    if(Object.hasOwn(value,'workspaceId'))check(value.workspaceId===controller.workspaceId,'CRYPTOWORTH_WORKSPACE_CHANGED','This local address now belongs to a different accounting workspace. Reopen its saved drafts before continuing.',409);
    const {workspaceId,...request}=value;value=request;
  }
  if(parts.length===2&&method==='GET')return {value:controller.view()};
  if(parts.length===3&&parts[2]==='source'&&method==='GET')return {value:await controller.source(query)};
  if(parts.length===4&&parts[2]==='templates'&&parts[3]==='inspect'&&method==='POST')return {value:inspectCryptoworthTemplate(value.file,{delimiter:value.delimiter})};
  if(parts[2]==='profiles'){
    if(parts.length===3&&method==='POST')return {value:await controller.createProfile(value)};
    if(parts.length===4&&parts[3]==='preview'&&method==='POST')return {value:await controller.previewProfile(value)};
    if(parts.length===4&&method==='GET')return {value:await controller.profileDetail(parts[3])};
    if(parts.length===6&&parts[4]==='download'&&method==='GET')return {file:await controller.profileFile(parts[3],parts[5])};
  }
  if(parts[2]==='plans'){
    if(parts.length===3&&method==='POST')return {value:await controller.createPlan(value)};
    if(parts.length===4&&parts[3]==='preview'&&method==='POST')return {value:await controller.previewPlan(value,query)};
    const planId=parts[3];
    if(planId&&parts.length===4&&method==='GET')return {value:await controller.detail(planId)};
    if(planId&&parts.length===5){
      if(parts[4]==='rows'&&method==='GET')return {value:await controller.rows(planId,query)};
      if(parts[4]==='captures'&&method==='POST')return {value:await controller.createCapture(planId,value)};
      if(parts[4]==='returns'&&method==='POST')return {value:await controller.saveReturn(planId,value)};
      if(parts[4]==='rollbacks'&&method==='POST')return {value:await controller.rollback(planId,value)};
      if(parts[4]==='packet'&&method==='GET')return {file:await controller.packet(planId)};
    }
    if(planId&&parts.length===6){
      if(parts[4]==='download'&&method==='GET')return {file:await controller.file(planId,parts[5],query)};
      if(parts[4]==='captures'&&parts[5]==='preview'&&method==='POST')return {value:await controller.previewCapture(planId,value,query)};
      if(parts[4]==='returns'&&parts[5]==='preview'&&method==='POST')return {value:await controller.previewReturn(planId,value)};
      if(parts[4]==='captures'&&method==='GET')return {value:await controller.captureDetail(planId,parts[5])};
      if(parts[4]==='returns'&&method==='GET')return {value:await controller.returnDetail(planId,parts[5])};
    }
    if(planId&&parts.length===7&&parts[4]==='captures'&&parts[6]==='rows'&&method==='GET')return {value:await controller.captureRows(planId,parts[5],query)};
  }
  if(parts.length===4&&parts[2]==='packets'&&method==='POST'){
    if(parts[3]==='inspect')return {value:await controller.inspectPacket(value)};
    if(parts[3]==='receive')return {value:await controller.receivePacket(value)};
  }
  check(false,'NOT_FOUND','This Cryptoworth receiving operation was not found.',404);
}
