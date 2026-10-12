// MIT. Retained operator presentation over the original SF96/SF88 lifecycle.
import { constants } from 'node:fs';
import { mkdir, readdir, lstat, open, rm, chmod } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { observe, prepare, show, review, execute, diagnose, recover, cancel, finalize, renderReport } from '../operator.mjs';
import { derive, verify as verifyHandoff } from '../handoff.mjs';
import { inspectBytes } from '../../sf84-mpp-market-intake/inspect.mjs';
import { run as importOriginalHeaders } from '../../sf85-live-402-capture/import-headers.mjs';
import { parseArgs as captureOptions } from '../../sf85-live-402-capture/capture.mjs';
import { createRecovery, inspectRecovery, restoreRecovery, inspectRestoreOperation, retireInterruptedRestore } from './archive.mjs';
import { hashBytes, encodeJSON, absolutePath, privateDirectory, privateInfo, readPrivate, readJSON,
  writeNew, replaceJSON, requireValue as need, fail, nativeErrorCode, withPilotLock,
  inspectPilotLock, releaseStoppedPilotLock } from '../operator-lock.mjs';

const SCHEMA='scf.sf96.provider-desk.v1';
const ID=/^[a-f0-9]{32}$/;
const HASH=/^[a-f0-9]{64}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const INTENT=/^[A-Za-z0-9._:-]{1,128}$/;
const now=()=>new Date().toISOString();
const shell=value=>"'"+String(value).replace(/'/g,"'\\''")+"'";
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const nativeCli=fileURLToPath(new URL('../operator-cli.mjs',import.meta.url));
const deskCli=fileURLToPath(new URL('./cli.mjs',import.meta.url));
const within=(parent,child)=>child===parent||child.startsWith(parent+sep);
const digest=value=>hashBytes(encodeJSON(value));
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
function bounded(value,max,code='DESK_TEXT_INVALID',required=false) {
  need(typeof value==='string'&&value.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)&&
    (!required||value.trim().length>0),code);
  return value.trim();
}
function exactFields(value,keys) {
  need(plain(value)&&Object.keys(value).every(key=>keys.includes(key)),'DESK_FIELDS_INVALID');
}
function decode(value,limit) {
  need(typeof value==='string'&&value.length>0&&value.length<=Math.ceil(limit/3)*4&&
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value),'DESK_BASE64_INVALID');
  const bytes=Buffer.from(value,'base64');
  need(bytes.length>0&&bytes.length<=limit&&bytes.toString('base64')===value,'DESK_INTAKE_SIZE_INVALID');
  return bytes;
}
async function optionalJSON(path,limit) {
  try{return await readJSON(path,limit);}catch(error){if(error.code==='ENOENT')return null;throw error;}
}
async function newDirectory(path) {
  try{await mkdir(path,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}
  return privateDirectory(path);
}
export function validateProfiles(value) {
  exactFields(value,['schema','profiles']);
  need(value.schema==='scf.sf96.host-profiles.v1'&&Array.isArray(value.profiles)&&value.profiles.length<=32,'DESK_PROFILE_INVALID');
  const ids=new Set(),allowed=['id','label','actor','service','payer','python','secretEnv','signerProvider','rpc',
    'httpsProxy','httpsProxyEnv','sandboxEgressRange','totalAtomic','dailyAtomic','maxResponseBytes','responseTimeoutMs'];
  return value.profiles.map(profile=>{
    exactFields(profile,allowed);
    need(typeof profile.id==='string'&&/^[A-Za-z0-9._-]{1,64}$/.test(profile.id)&&!ids.has(profile.id),'DESK_PROFILE_ID_INVALID');
    ids.add(profile.id);
    bounded(profile.label,160,'DESK_PROFILE_LABEL_REQUIRED',true);
    bounded(profile.actor,128,'DESK_PROFILE_ACTOR_REQUIRED',true);
    bounded(profile.service,128,'DESK_PROFILE_SERVICE_REQUIRED',true);
    need(/^G[A-Z2-7]{55}$/.test(profile.payer),'DESK_PROFILE_PAYER_REQUIRED');
    absolutePath(profile.python);
    need(!(profile.secretEnv&&profile.signerProvider)&&!(profile.httpsProxy&&profile.httpsProxyEnv),'DESK_PROFILE_ONE_REFERENCE_REQUIRED');
    if(profile.signerProvider)absolutePath(profile.signerProvider);
    for(const field of ['secretEnv','httpsProxyEnv'])
      if(profile[field]!==undefined)need(/^[A-Z][A-Z0-9_]{0,127}$/.test(profile[field]),'DESK_PROFILE_ENV_NAME_INVALID');
    for(const field of ['totalAtomic','dailyAtomic'])
      if(profile[field]!==undefined)need(typeof profile[field]==='string'&&/^[1-9][0-9]{0,38}$/.test(profile[field]),'DESK_PROFILE_AMOUNT_INVALID');
    for(const field of ['maxResponseBytes','responseTimeoutMs'])
      if(profile[field]!==undefined)need(Number.isSafeInteger(profile[field])&&profile[field]>0,'DESK_PROFILE_LIMIT_INVALID');
    if(profile.sandboxEgressRange!==undefined)need(profile.sandboxEgressRange==='198.18.0.0/15','DESK_PROFILE_EGRESS_INVALID');
    return Object.freeze({...profile});
  });
}
function profileView(profile) {
  return {id:profile.id,label:profile.label,actor:profile.actor,service:profile.service,payer:profile.payer,
    python:profile.python,signer:profile.signerProvider?'TRUSTED_HOST_PROVIDER':'HOST_ENVIRONMENT',
    walletEnvironmentName:profile.signerProvider?null:profile.secretEnv??'STELLAR_SECRET',
    rpc:profile.rpc??'Original selected-network catalog default',
    proxy:profile.httpsProxyEnv?'Named host environment: '+profile.httpsProxyEnv:profile.httpsProxy?'Configured host CONNECT proxy':'Direct',
    totalAtomic:profile.totalAtomic??null,dailyAtomic:profile.dailyAtomic??null,
    maxResponseBytes:profile.maxResponseBytes??67108864,responseTimeoutMs:profile.responseTimeoutMs??30000};
}
function command(argv) {return argv.map(shell).join(' ');}
function contextDefault(native) {
  return {schema:SCHEMA,revision:0,label:native.intentId,provider:'',criteria:'',notes:[],reviews:[],review:null,
    createdAt:native.buyer.createdAt,updatedAt:native.buyer.createdAt};
}
async function readContext(directory,native) {
  const context=await optionalJSON(join(directory,'desk-context.json'),2*1024*1024);
  if(!context)return contextDefault(native);
  need(context.schema===SCHEMA&&Number.isSafeInteger(context.revision)&&context.revision>=0&&Array.isArray(context.notes),
    'DESK_CONTEXT_INVALID');
  return context;
}
function nativeOutcome(native) {
  const job=native.buyer,summary=job.outcome??{},recovered=job.recovery??{};
  const report=recovered.report??recovered.originalOutcomeReport??summary.originalOutcomeReport;
  const item=report?.outcomes?.find(value=>value.intentId===native.intentId)??null;
  return {queue:job.state,buyer:summary.status??recovered.observationStatus??null,
    httpStatus:summary.httpStatus??null,sellerSettlement:summary.sellerReportedSettlement??null,
    classification:item?.status??null,independentlyVerifiedTransfer:item?.independentlyVerifiedTransfer??null,
    responseFile:summary.responseFile??recovered.deliveryFile??null,
    accounting:job.finalization?.result??null,accountingAt:job.finalization?.completedAt??null,
    reservation:summary.operatorReservation??recovered.operatorReservation??null,
    errors:[job.lastError,summary.error,summary.evidenceError,summary.responseCleanupError].filter(Boolean)};
}
export async function openProviderDesk({stateDirectory,profilesPath=null,environment=process.env}={}) {
  const root=absolutePath(stateDirectory); await newDirectory(root);
  const paths=Object.fromEntries(['cases','references','intakes','exports','uploads','activity'].map(name=>[name,join(root,name)]));
  for(const path of Object.values(paths))await newDirectory(path);
  const profiles=profilesPath?validateProfiles(await readJSON(absolutePath(profilesPath),65536)):[];
  const profileMap=new Map(profiles.map(profile=>[profile.id,profile]));
  const active=new Map(),controllers=new Set(); let closing=false;
  const indexLease=join(root,'desk-index');
  const referencePath=id=>{need(ID.test(id),'DESK_CASE_ID_INVALID');return join(paths.references,id+'.json');};
  const intakePath=id=>{need(UUID.test(id),'DESK_INTAKE_ID_INVALID');return join(paths.intakes,id);};
  const activityPath=id=>{need(UUID.test(id),'DESK_ACTION_ID_INVALID');return join(paths.activity,id+'.json');};
  function requireOpen(){need(!closing,'DESK_CLOSING',409);}
  async function reference(id) {
    const record=await readJSON(referencePath(id),65536);
    need(record.schema===SCHEMA&&record.id===id&&record.id===hashBytes(record.directory).slice(0,32),'DESK_CASE_REFERENCE_INVALID');
    return record;
  }
  async function register(directory) {
    const id=hashBytes(directory).slice(0,32),path=referencePath(id);
    const existing=await optionalJSON(path,65536);
    if(existing)need(existing.directory===directory,'DESK_CASE_REFERENCE_INVALID');
    else await writeNew(path,encodeJSON({schema:SCHEMA,id,directory,attachedAt:now()}));
    return id;
  }
  async function nativeCase(id) {
    const ref=await reference(id),native=await show(ref.directory),context=await readContext(ref.directory,native);
    return {id,directory:ref.directory,native,context,revision:digest({native,context})};
  }
  async function activities(id,limit=40) {
    const result=[];
    for(const entry of await readdir(paths.activity,{withFileTypes:true})) {
      if(!entry.isFile()||!UUID.test(entry.name.replace(/\.json$/,'')))continue;
      const item=await readJSON(join(paths.activity,entry.name),4*1024*1024);
      if(item.caseId===id)result.push({...item,
        phase:item.phase==='RUNNING'&&!active.has(item.id)?'INTERRUPTED_OR_UNKNOWN':item.phase,
        active:active.has(item.id)});
    }
    return result.sort((a,b)=>b.startedAt.localeCompare(a.startedAt)).slice(0,limit);
  }
  async function getCase(id) {
    const value=await nativeCase(id),lock=await inspectPilotLock(value.directory);
    const activeRecord=[...active.values()].find(item=>item.caseId===id);
    const outcome=nativeOutcome(value.native), file=outcome.responseFile;
    return {...value,nativeFingerprint:digest(value.native),lock,observedAt:now(),outcomes:outcome,activities:await activities(id),exports:await listExports(id),
      commands:Object.fromEntries(Object.entries(value.native.commands).map(([key,argv])=>[key,{argv,text:command(argv)}])),
      controls:{review:!activeRecord,execute:!activeRecord&&Boolean(value.native.commands.execute),diagnose:!activeRecord,recover:!activeRecord&&Boolean(value.native.commands.recover),
        cancel:!activeRecord&&Boolean(value.native.commands.cancel),finalize:!activeRecord&&Boolean(value.native.commands.finalize),
        backup:!activeRecord&&!lock,downloadResponse:file?.status==='SAVED',
        clearLock:!activeRecord&&lock?.state==='STOPPED'},
      recovery:{directory:value.directory,mode:'ORIGINAL_ABSOLUTE_DIRECTORY_ONLY',
        command:command([process.execPath,deskCli,'restore','--archive','/ABSOLUTE/COMPLETE.sf96case','--expect-directory',value.directory])}};
  }
  async function requireRevision(id,expected) {
    const value=await nativeCase(id);
    need(typeof expected==='string'&&expected===value.revision,'DESK_CASE_CHANGED_REFRESH',409);
    return value;
  }
  async function listCases({query='',state='all',page=0}={}) {
    bounded(query,300);need(Number.isSafeInteger(page)&&page>=0&&page<=100000,'DESK_PAGE_INVALID');
    const refs=new Map();
    for(const entry of await readdir(paths.references,{withFileTypes:true})) {
      if(entry.isFile()&&/^[a-f0-9]{32}\.json$/.test(entry.name)) {
        const id=entry.name.slice(0,-5); refs.set(id,await reference(id));
      }
    }
    // A native preparation completed before reference publication remains discoverable.
    for(const entry of await readdir(paths.cases,{withFileTypes:true})) {
      if(!entry.isDirectory()||!UUID.test(entry.name))continue;
      const directory=join(paths.cases,entry.name),id=hashBytes(directory).slice(0,32);
      if(!refs.has(id)) {
        try{await show(directory);await register(directory);refs.set(id,{id,directory});}catch{}
      }
    }
    const rows=[];
    for(const {id,directory}of refs.values()) {
      try {
        const value=await nativeCase(id),outcome=nativeOutcome(value.native);
        rows.push({id,directory,label:value.context.label,provider:value.context.provider,intentId:value.native.intentId,
          resource:value.native.source.originalResourceUrl,network:value.native.source.network,amountAtomic:value.native.source.quotedAtomic,
          state:value.native.buyer.state,classification:outcome.classification,buyerStatus:outcome.buyer,
          fileStatus:outcome.responseFile?.status??null,accounting:outcome.accounting?.outcome??null,
          createdAt:value.native.buyer.createdAt,updatedAt:value.context.updatedAt,review:value.context.review?.decision??null,revision:value.revision});
      } catch(error){rows.push({id,directory,label:directory.split(sep).pop(),state:'REVIEW_REQUIRED',error:nativeErrorCode(error)});}
    }
    const q=query.toLowerCase(),filtered=rows.filter(row=>(state==='all'||row.state===state)&&
      (!q||[row.label,row.provider,row.intentId,row.resource,row.network,row.directory].some(value=>String(value??'').toLowerCase().includes(q))));
    filtered.sort((a,b)=>(b.createdAt??'').localeCompare(a.createdAt??'')||a.id.localeCompare(b.id));
    return {cases:filtered.slice(page*30,page*30+30),total:filtered.length,page,pageSize:30,
      counts:Object.fromEntries([...new Set(rows.map(row=>row.state))].map(value=>[value,rows.filter(row=>row.state===value).length]))};
  }
  async function inspectIntake(id) {
    const directory=intakePath(id),record=await readJSON(join(directory,'intake.json'),65536);
    let bytes=null,report=null,source=null,headers=null,error=null;
    try {
      bytes=await readPrivate(join(directory,'capture.json'),262144);
      report=inspectBytes(bytes);source=JSON.parse(bytes);
      try{headers=await readPrivate(join(directory,'response.headers'),65536);}catch(e){if(e.code!=='ENOENT')throw e;}
      if(record.captureSha256)need(record.captureSha256===hashBytes(bytes),'DESK_INTAKE_SOURCE_CHANGED');
      if(record.headerSha256)need(headers&&record.headerSha256===hashBytes(headers),'DESK_INTAKE_HEADERS_CHANGED');
    } catch(e) {error=nativeErrorCode(e);}
    const options=(report?.x402?.offer?.options??[]).map(offer=>{
      let admission=null;
      try{derive(bytes,{index:offer.index,intentId:'source-review',maxAtomic:offer.amount,originalHeaders:headers??undefined});}
      catch(e){admission=nativeErrorCode(e);}
      return {...offer,eligible:admission===null,admissionError:admission};
    });
    return {...record,status:record.status==='CAPTURING'&&!active.has(id)?'INTERRUPTED_OR_UNKNOWN':record.status,
      error:error??record.error??null,report:report?{...report,x402:{...report.x402,offer:report.x402.offer?{...report.x402.offer,options}:null}}:null,
      provenance:source?{kind:source.captureSource??'original-sf85-https-capture',
        collectedAtUtc:source.collectedAtUtc,importedAtUtc:source.importedAtUtc??null,
        method:source.method,requestMethodSource:source.requestMethodSource??'original-request',
        url:source.url,status:source.status,sourceHeaderSha256:source.sourceHeaderSha256??null,
        sourceHeaderBytes:source.sourceHeaderBytes??null}:null,
      captureSha256:bytes?hashBytes(bytes):record.captureSha256??null,hasHeaders:Boolean(headers)};
  }
  async function listIntakes() {
    const result=[];
    for(const entry of await readdir(paths.intakes,{withFileTypes:true}))
      if(entry.isDirectory()&&UUID.test(entry.name))result.push(await inspectIntake(entry.name));
    return result.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,200);
  }
  async function retainIntake(value) {
    requireOpen();
    exactFields(value,['id','kind','label','captureBase64','headersBase64','url','allowOrigin','method','timeoutMs','profileId','directory']);
    need(UUID.test(value.id)&&['capture','headers','observe','handoff'].includes(value.kind),'DESK_INTAKE_INVALID');
    const label=bounded(value.label??'',160),directory=intakePath(value.id);
    const requestIdentity=digest({...value,captureBase64:value.captureBase64?hashBytes(decode(value.captureBase64,262144)):null,
      headersBase64:value.headersBase64?hashBytes(decode(value.headersBase64,65536)):null});
    return withPilotLock(indexLease,'INTAKE',async()=>{
      const existing=await optionalJSON(join(directory,'intake.json'),65536);
      if(existing){need(existing.requestIdentity===requestIdentity,'DESK_INTAKE_ID_REUSED',409);return inspectIntake(value.id);}
      await mkdir(directory,{mode:0o700});
      let record={schema:SCHEMA,id:value.id,kind:value.kind,label,createdAt:now(),requestIdentity,
        status:value.kind==='observe'?'CAPTURING':'RETAINING'};
      await writeNew(join(directory,'intake.json'),encodeJSON(record));
      const activity={id:value.id,kind:'observe',startedAt:record.createdAt};active.set(value.id,activity);
      try {
        if(value.kind==='handoff') {
          const original=absolutePath(value.directory);
          await verifyHandoff(original);
          const retained=join(directory,'handoff');await mkdir(retained,{mode:0o700});
          for(const name of ['manifest.json','original-capture.json','selection.json','buyer-review.json','review.txt'])
            await writeNew(join(retained,name),await readPrivate(join(original,name),name==='original-capture.json'?262144:65536));
          try{await writeNew(join(retained,'original-response.headers'),await readPrivate(join(original,'original-response.headers'),65536));}
          catch(error){if(error.code!=='ENOENT')throw error;}
          const verified=await verifyHandoff(retained),selection=await readJSON(join(retained,'selection.json'),65536);
          await writeNew(join(directory,'capture.json'),await readPrivate(join(retained,'original-capture.json'),262144));
          try{await writeNew(join(directory,'response.headers'),await readPrivate(join(retained,'original-response.headers'),65536));}
          catch(error){if(error.code!=='ENOENT')throw error;}
          record={...record,sourceHandoff:{intentId:verified.intentId,maxAtomic:verified.maxAtomic,
            offerIndex:selection.offerIndex,selectedOfferSha256:verified.selectedOfferSha256}};
        } else if(value.kind==='capture') {
          const bytes=decode(value.captureBase64,262144);inspectBytes(bytes);
          await writeNew(join(directory,'capture.json'),bytes);
          if(value.headersBase64)await writeNew(join(directory,'response.headers'),decode(value.headersBase64,65536));
        } else {
          need(['GET','HEAD'].includes(value.method),'DESK_METHOD_INVALID');
          const args=['--url',value.url,'--allow-origin',value.allowOrigin,'--method',value.method,
            '--out',join(directory,'capture.json')];
          if(value.timeoutMs!==undefined)args.push('--timeout-ms',String(value.timeoutMs));
          if(value.kind==='headers') {
            need(!value.captureBase64,'DESK_HEADERS_ONLY_REQUIRED');
            await writeNew(join(directory,'response.headers'),decode(value.headersBase64,65536));
            importOriginalHeaders([...args,'--headers-file',join(directory,'response.headers')]);
          } else {
            need(!value.captureBase64&&!value.headersBase64,'DESK_OBSERVE_FIELDS_INVALID');
            const profile=value.profileId?profileMap.get(value.profileId):null;
            need(!value.profileId||profile,'DESK_HOST_PROFILE_NOT_FOUND');
            if(profile?.sandboxEgressRange)args.push('--sandbox-egress-range',profile.sandboxEgressRange);
            if(profile?.httpsProxy)args.push('--https-proxy',profile.httpsProxy);
            if(profile?.httpsProxyEnv) {
              need(typeof environment[profile.httpsProxyEnv]==='string'&&environment[profile.httpsProxyEnv],
                'DESK_NAMED_PROXY_UNAVAILABLE');
              args.push('--https-proxy',environment[profile.httpsProxyEnv]);
            }
            captureOptions(args); await observe(args);
          }
        }
        const capture=await readPrivate(join(directory,'capture.json'),262144);
        let headers=null;try{headers=await readPrivate(join(directory,'response.headers'),65536);}catch(e){if(e.code!=='ENOENT')throw e;}
        record={...record,status:'RETAINED',finishedAt:now(),captureSha256:hashBytes(capture),
          headerSha256:headers?hashBytes(headers):null};
        await replaceJSON(join(directory,'intake.json'),record);
      } catch(error) {
        record={...record,status:'FAILED',finishedAt:now(),error:nativeErrorCode(error)};
        await replaceJSON(join(directory,'intake.json'),record);
      } finally {active.delete(value.id);}
      return inspectIntake(value.id);
    });
  }
  async function prepareCase(value) {
    requireOpen();exactFields(value,['id','intakeId','profileId','offerIndex','intentId','maxAtomic','label','provider','criteria']);
    need(UUID.test(value.id)&&INTENT.test(value.intentId)&&Number.isSafeInteger(value.offerIndex)&&value.offerIndex>=0,
      'DESK_PREPARATION_INVALID');
    bounded(value.label??'',160);bounded(value.provider??'',160);bounded(value.criteria??'',4000);
    const profile=profileMap.get(value.profileId);need(profile,'DESK_HOST_PROFILE_NOT_FOUND');
    const directory=join(paths.cases,value.id),id=hashBytes(directory).slice(0,32);
    return withPilotLock(indexLease,'PREPARE_CASE',async()=>{
      const existing=await optionalJSON(referencePath(id),65536);
      if(existing) {
        const native=await show(directory);
        const context=await readContext(directory,native);
        need(native.intentId===value.intentId&&context.preparationIdentity===digest({value,profile}),'DESK_PREPARATION_ID_REUSED',409);
        return getCase(id);
      }
      await listCases({page:0});
      // Check every reference, not only the visible page, before making a new ledger.
      for(const entry of await readdir(paths.references,{withFileTypes:true})) {
        if(!entry.isFile()||!/^[a-f0-9]{32}\.json$/.test(entry.name))continue;
        const other=await reference(entry.name.slice(0,-5));
        let native;try{native=await show(other.directory);}catch{continue;}
        if(native.intentId===value.intentId)
          throw Object.assign(new Error('DESK_INTENT_ALREADY_ATTACHED'),{code:'DESK_INTENT_ALREADY_ATTACHED',status:409,caseId:other.id});
      }
      const intake=await inspectIntake(value.intakeId);
      need(intake.status==='RETAINED'&&!intake.error,'DESK_INTAKE_NOT_READY',409);
      const capture=join(intakePath(value.intakeId),'capture.json');
      if(intake.sourceHandoff)need(value.intentId===intake.sourceHandoff.intentId&&
        value.maxAtomic===intake.sourceHandoff.maxAtomic&&value.offerIndex===intake.sourceHandoff.offerIndex,
        'DESK_RETAINED_HANDOFF_TERMS_CHANGED');
      const sourceArgs=intake.sourceHandoff?['--handoff',join(intakePath(value.intakeId),'handoff')]:
        ['--capture',capture,'--offer-index',String(value.offerIndex),'--intent-id',value.intentId,'--max-atomic',value.maxAtomic];
      const args=[...sourceArgs,'--dir',directory,'--actor',profile.actor,'--service',profile.service,
        '--payer',profile.payer,'--python',profile.python];
      if(intake.hasHeaders&&!intake.sourceHandoff)args.push('--headers-file',join(intakePath(value.intakeId),'response.headers'));
      for(const [field,flag]of Object.entries({secretEnv:'--secret-env',signerProvider:'--signer-provider',rpc:'--rpc',
        httpsProxy:'--https-proxy',httpsProxyEnv:'--https-proxy-env',totalAtomic:'--total-atomic',dailyAtomic:'--daily-atomic',
        maxResponseBytes:'--max-response-bytes',responseTimeoutMs:'--response-timeout-ms'}))
        if(profile[field]!==undefined)args.push(flag,String(profile[field]));
      const native=await prepare(args,{environment});
      await withPilotLock(directory,'DESK_CONTEXT',async()=>{
        await writeNew(join(directory,'desk-context.json'),encodeJSON({...contextDefault(native),revision:1,
          label:value.label?.trim()||native.intentId,provider:value.provider?.trim()||'',
          criteria:value.criteria?.trim()||'',profileId:profile.id,intakeId:value.intakeId,preparationIdentity:digest({value,profile}),updatedAt:now()}));
      });
      await register(directory);
      return getCase(id);
    });
  }
  async function attachCase(value) {
    requireOpen();exactFields(value,['directory']);
    const directory=absolutePath(value.directory);await show(directory);
    return withPilotLock(indexLease,'ATTACH',async()=>getCase(await register(directory)));
  }
  async function updateContext(id,value) {
    requireOpen();exactFields(value,['expectedRevision','operator','label','provider','criteria','note','review']);
    const operator=bounded(value.operator,160,'DESK_OPERATOR_REQUIRED',true),ref=await reference(id);
    return withPilotLock(ref.directory,'DESK_CONTEXT',async()=>{
      const current=await requireRevision(id,value.expectedRevision),context={...current.context};
      if(value.label!==undefined)context.label=bounded(value.label,160,'DESK_LABEL_REQUIRED',true);
      if(value.provider!==undefined)context.provider=bounded(value.provider,160);
      if(value.criteria!==undefined)context.criteria=bounded(value.criteria,4000);
      if(value.note!==undefined) {
        const text=bounded(value.note,4000,'DESK_NOTE_REQUIRED',true);
        need(context.notes.length<2000,'DESK_NOTE_LIMIT');context.notes=[...context.notes,{id:randomUUID(),operator,at:now(),text}];
      }
      if(value.review!==undefined) {
        exactFields(value.review,['decision','note']);
        need(['useful','needs-work','unreviewed'].includes(value.review.decision),'DESK_REVIEW_INVALID');
        context.review={decision:value.review.decision,note:bounded(value.review.note??'',4000),operator,at:now(),
          nativeRevision:digest(current.native),scope:'LOCAL_OPERATOR_ATTESTATION'};
        need((context.reviews??[]).length<2000,'DESK_REVIEW_HISTORY_LIMIT');
        context.reviews=[...(context.reviews??[]),context.review];
      }
      context.revision++;context.updatedAt=now();
      need(encodeJSON(context).length<=2*1024*1024,'DESK_CONTEXT_SIZE_LIMIT');
      await replaceJSON(join(ref.directory,'desk-context.json'),context);
      return getCase(id);
    });
  }
  async function runAction(id,value) {
    requireOpen();exactFields(value,['id','action','expectedRevision']);
    need(UUID.test(value.id)&&['diagnose','review','execute','recover','cancel','finalize'].includes(value.action),'DESK_ACTION_INVALID');
    const requestIdentity=digest({caseId:id,...value}),file=activityPath(value.id),existing=await optionalJSON(file,4*1024*1024);
    if(existing){need(existing.requestIdentity===requestIdentity,'DESK_ACTION_ID_REUSED',409);return existing;}
    const before=await requireRevision(id,value.expectedRevision);
    need(![...active.values()].some(item=>item.caseId===id),'DESK_CASE_ACTION_ACTIVE',409);
    if(value.action!=='diagnose')need(Boolean(before.native.commands[value.action]),'DESK_NATIVE_ACTION_UNAVAILABLE',409);
    const record={schema:SCHEMA,id:value.id,caseId:id,action:value.action,startedAt:now(),phase:'RUNNING',requestIdentity};
    await writeNew(file,encodeJSON(record));
    const controller=new AbortController();controllers.add(controller);
    const item={...record,controller};active.set(value.id,item);
    item.promise=(async()=>{
      try {
        let result;
        if(value.action==='diagnose')result=await diagnose(before.directory,{environment});
        else if(value.action==='review')result=await review(before.directory,{environment,signal:controller.signal});
        else if(value.action==='execute')result=await execute(before.directory,{environment,signal:controller.signal});
        else if(value.action==='finalize')result=await finalize(before.directory,{environment,signal:controller.signal});
        else result=await (value.action==='recover'?recover:cancel)(before.directory);
        const exit=result?.originalCommand?.exitCode??result?.exitCode;
        await replaceJSON(file,{...record,phase:typeof exit==='number'&&exit!==0?'FAILED':'COMPLETE',finishedAt:now(),result,
          ...(typeof exit==='number'&&exit!==0?{error:'ORIGINAL_COMMAND_FAILED',exitCode:exit}:{})});
      } catch(error) {
        await replaceJSON(file,{...record,phase:'FAILED',finishedAt:now(),error:nativeErrorCode(error)});
      } finally {active.delete(value.id);controllers.delete(controller);}
    })();
    item.promise.catch(()=>{});return record;
  }
  async function stopAction(id,actionId) {
    requireOpen();const record=await readJSON(activityPath(actionId),4*1024*1024);
    need(record.caseId===id,'DESK_ACTION_NOT_FOUND',404);
    const item=active.get(actionId);need(item&&['review','execute','finalize'].includes(record.action),'DESK_STOP_UNAVAILABLE',409);
    // The original finalizer owns cancellation cleanup. No action is resubmitted.
    item.controller.abort('SIGTERM');
    return {requested:true,id:actionId};
  }
  async function clearStoppedLock(id,value) {
    requireOpen();exactFields(value,['expectedRevision','lockSha256','operator']);
    bounded(value.operator,160,'DESK_OPERATOR_REQUIRED',true);
    const current=await requireRevision(id,value.expectedRevision);
    const result=await releaseStoppedPilotLock(current.directory,value.lockSha256,{
      originalAttempt:current.native.buyer.state==='RUNNING_OR_INTERRUPTED'?current.native.buyer.attempt:null});
    return {...result,case:await getCase(id)};
  }
  async function exportReport(id,expectedRevision) {
    const ref=await reference(id);
    return withPilotLock(ref.directory,'DESK_REPORT',async()=>{
      const current=await requireRevision(id,expectedRevision),original=await renderReport(current.directory);
      const context=current.context;
      const notes=context.notes.map(note=>'<li><strong>'+escape(note.operator)+'</strong> · '+escape(note.at)+
        '<p>'+escape(note.text).replace(/\n/g,'<br>')+'</p></li>').join('');
      const introduction='<section class="section"><h2>'+escape(context.label)+'</h2><p>'+escape(context.provider)+'</p>'+
        '<h3>Useful-output criteria</h3><p>'+escape(context.criteria||'Not entered')+'</p>'+
        '<h3>Local operator review</h3><p>'+escape(context.review?context.review.decision+' · '+context.review.operator+' · '+context.review.at:'Not recorded')+
        '</p><p>'+escape(context.review?.note??'')+'</p><p>A local attestation records the named operator’s statement; it does not assert customer acceptance.</p>'+
        '<h3>Private operating notes</h3><ol>'+notes+'</ol><h3>Complete recovery</h3>'+
        '<p>This readable handover contains no accounting keys and does not restore a case. The encrypted complete-case archive retains the original ledger, evidence, output and native configuration. Restore to the original absolute path on the recovery host with the original source and provider references available.</p>'+
        '<pre>'+escape(command([process.execPath,deskCli,'restore','--archive','/ABSOLUTE/COMPLETE.sf96case','--expect-directory',current.directory]))+
        '</pre><p>Prepared source: '+escape(current.native.source.captureSha256)+'</p></section>';
      const html=original.html.replace('</header>','</header>\n'+introduction);
      const name='provider-handoff-'+id+'-'+randomUUID()+'.html',path=join(paths.exports,name);
      await writeNew(path,Buffer.from(html));
      return saveExport({caseId:id,kind:'report',path,name,bytes:Buffer.byteLength(html),sha256:hashBytes(Buffer.from(html)),type:'text/html; charset=utf-8'});
    });
  }
  async function openCaseDownload(id,kind,expectedRevision) {
    const current=await requireRevision(id,expectedRevision);
    let path,name,type='application/octet-stream',expected;
    if(kind==='capture'){path=join(current.directory,'handoff','original-capture.json');name=current.native.intentId+'-capture.json';type='application/json';expected=current.native.source.captureSha256;}
    else if(kind==='headers') {need(current.native.source.sourceHeaderSha256,'DESK_HEADERS_NOT_RECORDED',404);
      path=join(current.directory,'handoff','original-response.headers');name=current.native.intentId+'-response.headers';type='text/plain';expected=current.native.source.sourceHeaderSha256;}
    else if(kind==='response') {
      const file=current.native.buyer.outcome?.responseFile;
      need(file?.status==='SAVED'&&HASH.test(file.sha256)&&Number.isSafeInteger(file.bytes),'DESK_ORIGINAL_COMPLETE_RESPONSE_REQUIRED',409);
      path=file.path??file.destination;
      need(path===current.native.buyer.responseDestination&&path===join(current.directory,'delivery','response.bin'),
        'DESK_ORIGINAL_RESPONSE_PATH_MISMATCH');
      name=current.native.intentId+'-response.bin';type='application/octet-stream';expected=file.sha256;
    } else fail('DESK_DOWNLOAD_KIND_INVALID');
    const handle=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
    try {
      const info=await handle.stat();
      need(info.isFile()&&info.nlink===1&&privateInfo(info)&&info.size<=512*1024*1024,'DESK_DOWNLOAD_FILE_INVALID');
      const hash=createHash('sha256');let bytes=0;
      for await(const chunk of handle.createReadStream({start:0,autoClose:false})){hash.update(chunk);bytes+=chunk.length;}
      need(hash.digest('hex')===expected&&bytes===info.size,'DESK_RETAINED_FILE_CHANGED',409);
      if(kind==='response')need(bytes===current.native.buyer.outcome.responseFile.bytes,'DESK_RETAINED_FILE_CHANGED',409);
      return {handle,path,name,type,bytes,sha256:expected};
    } catch(error){await handle.close();throw error;}
  }
  async function backup(id,value) {
    requireOpen();exactFields(value,['expectedRevision','passphrase','id']);
    need(UUID.test(value.id),'DESK_ACTION_ID_INVALID');
    const current=await requireRevision(id,value.expectedRevision);
    need(![...active.values()].some(item=>item.caseId===id),'DESK_CASE_ACTION_ACTIVE',409);
    const name='provider-case-'+id+'-'+value.id+'.sf96case',path=join(paths.exports,name);
    const existing=await optionalJSON(path+'.json',262144);
    if(existing)return existing;
    let info;try{info=await lstat(path);}catch(error){if(error.code!=='ENOENT')throw error;}
    let saved;
    if(info) {
      // Ciphertext may have committed before its presentation index. Authenticate
      // that exact original case before completing only the missing sidecar.
      const original=await inspectRecovery(path,value.passphrase),manifest=original.manifest;
      need(manifest.originalDirectory===current.directory&&manifest.intentId===current.native.intentId&&
        manifest.captureSha256===current.native.source.captureSha256&&
        manifest.queueConfigSha256===current.native.buyer.configSha256,'DESK_BACKUP_CASE_MISMATCH');
      const h=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
      try{
        const stat=await h.stat();need(stat.isFile()&&stat.nlink===1&&privateInfo(stat),'DESK_EXPORT_CHANGED',409);
        const hash=createHash('sha256');let count=0;
        for await(const bytes of h.createReadStream({start:0,autoClose:false})){hash.update(bytes);count+=bytes.length;}
        saved={path,name,manifest,bytes:count,sha256:hash.digest('hex'),recoveredIndex:true};
      }finally{await h.close();}
    } else saved=await createRecovery(current.directory,path,value.passphrase);
    return saveExport({...saved,caseId:id,kind:'backup',type:'application/octet-stream'});
  }

  async function saveExport(value) {
    const record={schema:SCHEMA,id:value.name,createdAt:now(),...value};
    await writeNew(value.path+'.json',encodeJSON(record));
    return record;
  }
  async function listExports(caseId) {
    const records=[];
    for(const entry of await readdir(paths.exports,{withFileTypes:true})) {
      if(!entry.isFile()||!entry.name.endsWith('.json'))continue;
      const value=await readJSON(join(paths.exports,entry.name),262144);
      if(value.schema===SCHEMA&&value.caseId===caseId)
        records.push({id:value.id,name:value.name,kind:value.kind,bytes:value.bytes,sha256:value.sha256,createdAt:value.createdAt});
    }
    for(const entry of await readdir(paths.exports,{withFileTypes:true})) {
      if(!entry.isFile()||!entry.name.startsWith('provider-case-'+caseId+'-')||!entry.name.endsWith('.sf96case')||
        records.some(record=>record.id===entry.name))continue;
      const info=await lstat(join(paths.exports,entry.name));
      if(privateInfo(info)&&info.nlink===1)records.push({id:entry.name,name:entry.name,kind:'backup',
        status:'UNINDEXED_CIPHERTEXT',bytes:info.size,sha256:null,createdAt:info.mtime.toISOString()});
    }
    return records.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,30);
  }
  async function openArtifact(id) {
    need(typeof id==='string'&&/^provider-(?:case|handoff)-[a-f0-9]{32}-[a-f0-9-]{36}\.(?:sf96case|html)$/.test(id),
      'DESK_EXPORT_ID_INVALID');
    const record=await readJSON(join(paths.exports,id+'.json'),262144);
    need(record.id===id&&record.path===join(paths.exports,id)&&HASH.test(record.sha256),'DESK_EXPORT_RECORD_INVALID');
    const handle=await open(record.path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
    try {
      const info=await handle.stat();
      need(info.isFile()&&info.nlink===1&&privateInfo(info)&&info.size===record.bytes,'DESK_EXPORT_CHANGED',409);
      const hash=createHash('sha256');
      for await(const bytes of handle.createReadStream({start:0,autoClose:false}))hash.update(bytes);
      need(hash.digest('hex')===record.sha256,'DESK_EXPORT_CHANGED',409);
      return {...record,handle};
    } catch(error){await handle.close();throw error;}
  }

  async function registerUpload(filename,bytes) {
    const id=filename.split(sep).pop();
    need(UUID.test(id)&&Number.isSafeInteger(bytes)&&bytes>0,'DESK_UPLOAD_INVALID');
    await writeNew(join(paths.uploads,id+'.json'),encodeJSON({schema:SCHEMA,id,bytes,createdAt:now()}));
    return {id,bytes};
  }
  async function uploadTarget() {
    requireOpen();const id=randomUUID();return {id,path:join(paths.uploads,id)};
  }
  async function uploads() {
    const result=[];
    for(const entry of await readdir(paths.uploads,{withFileTypes:true}))
      if(entry.isFile()&&UUID.test(entry.name.replace(/\.json$/,''))&&entry.name.endsWith('.json'))
        result.push(await readJSON(join(paths.uploads,entry.name),65536));
    return result.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  }
  async function inspectUpload(value) {
    exactFields(value,['id','passphrase']);need(UUID.test(value.id),'DESK_UPLOAD_INVALID');
    await readJSON(join(paths.uploads,value.id+'.json'),65536);
    const result=await inspectRecovery(join(paths.uploads,value.id),value.passphrase);
    return {id:value.id,manifest:result.manifest,files:result.entries.length,
      command:command([process.execPath,deskCli,'restore','--archive',join(paths.uploads,value.id),
        '--expect-directory',result.manifest.originalDirectory]),
      localRestoreAllowed:within(paths.cases,result.manifest.originalDirectory),
      interruption:await inspectRestoreOperation(result.manifest.originalDirectory)};
  }
  async function restoreUpload(value) {
    requireOpen();exactFields(value,['id','passphrase','expectedDirectory']);need(UUID.test(value.id),'DESK_UPLOAD_INVALID');
    await readJSON(join(paths.uploads,value.id+'.json'),65536);
    const restored=await restoreRecovery(join(paths.uploads,value.id),value.passphrase,{
      expectedDirectory:value.expectedDirectory,allowedRoot:paths.cases});
    const id=await withPilotLock(indexLease,'REGISTER_RESTORE',()=>register(restored.directory));
    // Retain the ciphertext as the operator's recovery point; no duplicate upload is needed on a retry.
    return {case:await getCase(id),restored:{directory:restored.directory,files:restored.files,totalBytes:restored.totalBytes}};
  }
  async function retireRestore(value) {
    requireOpen();exactFields(value,['directory','intentSha256']);
    const directory=absolutePath(value.directory);
    need(within(paths.cases,directory)&&directory!==paths.cases,'RECOVERY_USE_TRUSTED_TERMINAL_FOR_EXTERNAL_PATH');
    return retireInterruptedRestore(directory,value.intentSha256);
  }
  async function status() {
    return {schema:SCHEMA,version:'1.0.0',stateDirectory:root,profiles:profiles.map(profileView),
      profileSource:profilesPath??null,limits:{captureBytes:262144,headerBytes:65536,recoveryBytes:528482304},
      active:[...active.values()].map(({promise,controller,...item})=>item),source:{operatorCli:nativeCli,deskCli},
      recovery:'ORIGINAL_ABSOLUTE_DIRECTORY_ONLY',execution:'ORIGINAL_TRUSTED_TERMINAL'};
  }
  async function close() {
    closing=true;for(const controller of controllers)controller.abort('SIGTERM');
    await Promise.allSettled([...active.values()].map(item=>item.promise).filter(Boolean));
  }
  return Object.freeze({root,paths,status,listCases,getCase,attachCase,listIntakes,inspectIntake,retainIntake,
    prepareCase,updateContext,runAction,stopAction,clearStoppedLock,exportReport,openCaseDownload,backup,
    uploadTarget,registerUpload,uploads,inspectUpload,restoreUpload,retireRestore,listExports,openArtifact,close});
}
