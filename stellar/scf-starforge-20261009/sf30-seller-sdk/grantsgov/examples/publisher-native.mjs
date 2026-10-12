// MIT. Original Grants.gov source -> dataset versions -> SF82 -> SF88/SF100.
import { open, readFile, mkdir, rename, unlink, lstat } from 'node:fs/promises';
import { dirname, join, resolve, isAbsolute } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { openGrantsWorkspace } from '../workspace.mjs';
import { readCaptureExport } from '../capture.mjs';
import { DATASET_COLUMNS, ATTRIBUTION } from '../source.mjs';

const SCHEMA='stellar-forge.grantsgov-publisher-native.v1';
const hash=value=>createHash('sha256').update(value).digest('hex');
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const canonical=value=>JSON.stringify(Array.isArray(value)?value.map(value=>JSON.parse(canonical(value))):
  object(value)?Object.fromEntries(Object.keys(value).sort().map(key=>[key,JSON.parse(canonical(value[key]))])):value);
const same=(left,right)=>canonical(left)===canonical(right);
const formatted=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const clock=()=>new Date().toISOString();
const fail=(code,message=code)=>{throw Object.assign(new Error(message),{code});};
const requireValue=(condition,code,message)=>{if(!condition)fail(code,message);};
const absolute=(value,label)=>{requireValue(typeof value==='string'&&isAbsolute(value)&&resolve(value)===value&&value!='/',
  'NATIVE_ABSOLUTE_PATH',label+' must be a normalized absolute path.');return value;};
async function exists(path){try{await lstat(path);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}
async function syncDirectory(path){const f=await open(path,'r');try{await f.sync();}finally{await f.close();}}
async function atomicFile(path,data){await mkdir(dirname(path),{recursive:true,mode:0o700});
  const temp=path+'.'+randomUUID()+'.tmp';let owned=false;
  try{const f=await open(temp,'wx',0o600);owned=true;try{await f.writeFile(data);await f.sync();}finally{await f.close();}
    await rename(temp,path);owned=false;await syncDirectory(dirname(path));
  }finally{if(owned)await unlink(temp).catch(error=>{if(error.code!=='ENOENT')throw error;});}}
async function immutableFile(path,data){if(await exists(path)){requireValue((await readFile(path)).equals(data),'NATIVE_OUTPUT_CHANGED',path);return;}
  await atomicFile(path,data);}
async function readJSON(path){return JSON.parse((await readFile(path)).toString('utf8'));}
const descriptor=(path,data)=>({path,bytes:data.length,sha256:hash(data)});
const requestId=(operation,action)=>operation+':'+action;
function termsEqual(actual,expected){return ['scheme','network','asset','payTo','amount','maxTimeoutSeconds']
  .every(key=>String(actual?.[key])===String(expected?.[key]));}
function assertRows(actual,original,fields){
  requireValue(actual.length===original.length,'DELIVERY_ROW_COUNT');
  const byId=new Map(original.map(row=>[row.opportunity_id,row]));
  requireValue(byId.size===original.length,'SOURCE_IDENTITY_NOT_UNIQUE');
  const seen=new Set();
  for(const row of actual){const source=byId.get(row.opportunity_id);
    requireValue(source&&!seen.has(row.opportunity_id),'DELIVERY_IDENTITY_CHANGED');seen.add(row.opportunity_id);
    requireValue(same(Object.keys(row).sort(),[...fields].sort()),'DELIVERY_FIELDS_CHANGED');
    for(const field of fields){const value=source[field],expected=value===null||value===undefined||value===''?null:String(value);
      requireValue(row[field]===expected,'DELIVERY_SOURCE_VALUE_CHANGED',row.opportunity_id+' / '+field);}}
}

/** Runs only the saved native product. The optional transport hook connects the
 * advertised merchant origin to this original release; it never replaces the
 * original publisher, buyer executor, signer, Governor or settlement engine.
 *
 * Settings are public merchant/runtime inputs plus one host-owned existing
 * buyer-workspace path. Private payer material remains in that workspace.
 */
export async function runPublisherNative({
  directory,captureFile,settings,operationId,phase='receive',attachTransport,
  signal,onProgress=()=>{}
}={}){
  directory=absolute(directory,'Operation directory');captureFile=absolute(captureFile,'Original source packet');
  requireValue(typeof operationId==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,110}$/.test(operationId),'NATIVE_OPERATION_ID');
  requireValue(['prepare','publish','receive'].includes(phase),'NATIVE_PHASE');
  requireValue(object(settings)&&object(settings.merchant)&&object(settings.merchant.payment),'NATIVE_MERCHANT_SETTINGS');
  requireValue(typeof settings.intentId==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(settings.intentId),'NATIVE_BUYER_INTENT');
  requireValue(settings.merchant.payment.network==='stellar:testnet','NATIVE_TESTNET_REQUIRED');
  const origin=new URL(settings.merchant.origin);
  requireValue(origin.protocol==='https:'&&origin.origin===settings.merchant.origin&&
    !origin.username&&!origin.password,'NATIVE_MERCHANT_ORIGIN');
  const pageSize=settings.pageSize??100,maxPages=settings.maxPages??2,maximum=settings.maxTotalAtomic;
  requireValue(Number.isSafeInteger(pageSize)&&pageSize>=1&&pageSize<=1000&&
    Number.isSafeInteger(maxPages)&&maxPages>=1&&maxPages<=10000&&
    typeof maximum==='string'&&/^[1-9]\d{0,38}$/.test(maximum),'NATIVE_DELIVERY_LIMITS');
  const perPage=BigInt(settings.merchant.payment.amount);
  requireValue(perPage>0n&&BigInt(maximum)>=perPage,'NATIVE_PAYMENT_LIMIT');
  const buyer=settings.buyerWorkspace;
  if(phase==='receive')requireValue(object(buyer)&&typeof buyer.id==='string'&&
    absolute(buyer.directory,'Existing buyer workspace'),'NATIVE_BUYER_WORKSPACE');
  requireValue(attachTransport===undefined||typeof attachTransport==='function','NATIVE_TRANSPORT_HOOK');
  requireValue(signal===undefined||signal instanceof AbortSignal,'NATIVE_ABORT_SIGNAL');
  await mkdir(directory,{recursive:true,mode:0o700});
  const captureBytes=await readFile(captureFile),packet=JSON.parse(captureBytes.toString('utf8')),source=readCaptureExport(packet);
  requireValue(source.coverage.searchComplete&&source.coverage.detailsComplete&&
    source.opportunities.length>0,'NATIVE_COMPLETE_SOURCE_REQUIRED');
  const requiredPages=Math.ceil(source.opportunities.length/pageSize);
  requireValue(requiredPages<=maxPages&&BigInt(requiredPages)*perPage<=BigInt(maximum),'NATIVE_COHORT_EXCEEDS_LIMITS');
  const configDigest=hash(canonical({operationId,sourceSignature:source.sourceSignature,packetSha256:packet.sha256,settings}));
  const journalFile=join(directory,'native-operation.json'),outputDirectory=join(directory,'receiving');
  await mkdir(outputDirectory,{recursive:true,mode:0o700});
  let journal=await exists(journalFile)?await readJSON(journalFile):{
    schema:SCHEMA,operationId,createdAt:clock(),configurationSha256:configDigest,settings,
    source:{captureId:source.captureId,operationId:source.operationId,signature:source.sourceSignature,
      packetSha256:packet.sha256,fileSha256:hash(captureBytes),pages:source.pages.length,
      details:source.details.length,opportunities:source.opportunities.length,coverage:source.coverage},
    stages:{},exports:{},status:'PREPARING'};
  requireValue(journal.schema===SCHEMA&&journal.operationId===operationId&&
    journal.configurationSha256===configDigest,'NATIVE_ORIGINAL_OPERATION_CHANGED');
  const save=async()=>{journal.updatedAt=clock();await atomicFile(journalFile,formatted(journal));};
  const note=async(name,value)=>{journal.stages[name]={completedAt:clock(),value};await save();
    await onProgress({operationId,stage:name,value});return value;};
  const once=async(name,action)=>journal.stages[name]?.value??await note(name,await action());
  const checkSignal=()=>{if(signal?.aborted)throw signal.reason??Object.assign(new Error('Interrupted'),{code:'NATIVE_INTERRUPTED'});};
  let workspace,transport;
  const openModel=async()=>openGrantsWorkspace({directory:join(directory,'workspace'),
    buyerWorkspaces:buyer?[buyer]:[]});
  const act=async(action,input={})=>{checkSignal();return workspace.publisherAction(action,input);};
  async function exportNative(kind,id,name){
    const key=kind+':'+id;let entry=journal.exports[key];
    if(!entry){const saved=await workspace.publisherExport(kind,id);entry={...saved,outputName:name};journal.exports[key]=entry;await save();}
    const chunks=[];let offset=0;
    while(true){const part=await workspace.readExport(entry.id,{offset,limit:1024*1024});
      requireValue(part.offset===offset&&part.file.sha256===entry.sha256&&part.file.bytes===entry.bytes,'NATIVE_EXPORT_BINDING');
      const bytes=Buffer.from(part.data,'base64');requireValue(bytes.length===part.bytesRead,'NATIVE_EXPORT_CHUNK');
      chunks.push(bytes);if(part.nextOffset===null)break;requireValue(part.nextOffset===offset+bytes.length,'NATIVE_EXPORT_CURSOR');offset=part.nextOffset;}
    const bytes=Buffer.concat(chunks);requireValue(bytes.length===entry.bytes&&hash(bytes)===entry.sha256,'NATIVE_EXPORT_DIGEST');
    await immutableFile(join(outputDirectory,name),bytes);return descriptor(name,bytes);
  }
  async function ensureRunning(){
    let state=await workspace.publisherState(),releases=state.releases;
    requireValue(releases.state.active===journal.stages.release.value.id,'NATIVE_RELEASE_SELECTION_CHANGED');
    if(releases.runtime.state!=='RUNNING'){
      requireValue(['STOPPED','UNAVAILABLE'].includes(releases.runtime.state),'NATIVE_ORIGINAL_RELEASE_BUSY',releases.runtime.state);
      await act('publisher.release.start',{expectedGeneration:releases.state.generation});state=await workspace.publisherState();}
    requireValue(state.releases.runtime.state==='RUNNING','NATIVE_RELEASE_NOT_RUNNING');
    if(attachTransport){
      if(transport?.close)await transport.close();
      transport=await attachTransport({operationId,settings,listener:state.releases.runtime.observed.listener,
        release:state.releases,workspace});
    }
    return state;
  }
  try{
    await save();workspace=await openModel();
    const capture=await once('capture',()=>workspace.importOriginal({
      requestId:requestId(operationId,'import'),packet,name:'Original Grants.gov AI source'}));
    const name=settings.datasetName??'Grants.gov AI opportunities';
    const full=await once('fullEdition',()=>workspace.createEdition({
      requestId:requestId(operationId,'full-edition'),captureId:capture.id,name}));
    const fullOriginal=await workspace.edition(full.id);
    requireValue(fullOriginal.sourceSignature===source.sourceSignature&&fullOriginal.rows.length===source.opportunities.length,
      'NATIVE_SOURCE_EDITION_CHANGED');
    const selectedIds=source.opportunities.filter(row=>row.status==='posted'&&
      (row.agency_code==='NSF'||row.top_agency_code==='NSF')&&
      row.assistance_listing_numbers.split(/[;,|]\s*|\s+/).includes('47.041')).map(row=>row.opportunity_id);
    requireValue(selectedIds.length>0&&selectedIds.length<source.opportunities.length,'NATIVE_CURATED_SOURCE_SELECTION');
    const selection=await once('selectedEdition',()=>workspace.createEdition({
      requestId:requestId(operationId,'selected-edition'),sourceEditionId:full.id,opportunityIds:selectedIds,name}));
    const common={fields:DATASET_COLUMNS,defaultLimit:pageSize,maxLimit:pageSize,...settings.merchant};
    const baseline=await once('baselineMerchant',()=>workspace.merchant({
      requestId:requestId(operationId,'baseline-merchant'),editionId:full.id,...common}));
    const curated=await once('curatedMerchant',()=>workspace.merchant({
      requestId:requestId(operationId,'curated-merchant'),editionId:selection.id,...common}));
    requireValue(baseline.dataset.rowCount===source.opportunities.length&&curated.dataset.rowCount===selectedIds.length,
      'NATIVE_MERCHANT_ROW_COUNT');
    const basePrepared=(await act('publisher.prepare',{merchantId:baseline.id})).result;
    await note('baselineDraft',{id:basePrepared.draft.id,snapshot:basePrepared.draft.dataset.snapshot,
      packageDirectory:basePrepared.packageDirectory,initialized:basePrepared.initialized});
    const query=new URLSearchParams({fields:DATASET_COLUMNS.join(','),limit:String(pageSize)}).toString();
    const draftPreview=(await act('publisher.preview',{target:'draft:'+basePrepared.draft.id,query})).result;
    requireValue(draftPreview.status===200,'NATIVE_DRAFT_PREVIEW');
    await note('prepared',{fullRows:source.opportunities.length,selectedRows:selectedIds.length,
      baselineSnapshot:baseline.dataset.snapshot,curatedSnapshot:curated.dataset.snapshot,
      requiredPages,pageSize,maxTotalAtomic:maximum});
    if(phase==='prepare'){journal.status='PREPARED';await save();return journal;}
    const releaseId=settings.releaseId??operationId;
    const staged=(await act('publisher.release.stage',{draftId:basePrepared.draft.id,id:releaseId,
      label:name,runtime:settings.runtime??{port:0}})).result;
    await once('release',async()=>({id:releaseId,digest:staged.digest??null,dataset:staged.dataset}));
    let state=await workspace.publisherState();
    if(state.releases.state.active!==releaseId)
      await act('publisher.release.activate',{id:releaseId,expectedGeneration:state.releases.state.generation});
    await ensureRunning();
    const selectedPrepared=(await act('publisher.prepare',{merchantId:curated.id})).result;
    await note('selectedDraft',{id:selectedPrepared.draft.id,snapshot:selectedPrepared.draft.dataset.snapshot,
      packageDirectory:selectedPrepared.packageDirectory});
    state=await workspace.publisherState();
    if(state.target.versions.current!==curated.dataset.snapshot){
      requireValue(state.target.versions.current===baseline.dataset.snapshot,'NATIVE_PUBLICATION_CHANGED');
      await act('publisher.reviewDraft',{draftId:selectedPrepared.draft.id,
        expectedSnapshot:state.target.versions.current,expectedRevision:state.target.versions.revision});
      const published=(await act('publisher.publish',{draftId:selectedPrepared.draft.id,
        expectedSnapshot:state.target.versions.current,expectedRevision:state.target.versions.revision})).result;
      await note('publication',published);
    }
    state=await workspace.publisherState();
    requireValue(state.target.versions.current===curated.dataset.snapshot&&
      state.target.versions.versions.some(value=>value.snapshot===baseline.dataset.snapshot),'NATIVE_RETAINED_VERSION_REQUIRED');
    const pinned=(await act('publisher.preview',{target:baseline.dataset.snapshot,query})).result;
    requireValue(pinned.status===200,'NATIVE_PINNED_PREVIEW');
    await note('versionedRelease',{currentSnapshot:curated.dataset.snapshot,retainedSnapshot:baseline.dataset.snapshot,
      currentRows:selectedIds.length,retainedRows:source.opportunities.length,revision:state.target.versions.revision,
      runtime:state.releases.runtime.observed});
    if(phase==='publish'){journal.status='PUBLISHED';await save();return journal;}
    const review=(await act('publisher.buyer.review',{snapshot:baseline.dataset.snapshot,query})).result;
    requireValue(review.mode==='NATIVE_X402','NATIVE_PAYMENT_RUNTIME_REQUIRED');
    const acceptIndex=review.accepts.findIndex(value=>termsEqual(value,settings.merchant.payment));
    requireValue(acceptIndex>=0,'NATIVE_ADVERTISED_TERMS_CHANGED');
    await note('offer',{url:review.url,snapshot:review.snapshot,offerSha256:review.offerSha256,
      acceptIndex,terms:review.accepts[acceptIndex],mode:review.mode});
    const prepared=(await act('publisher.buyer.prepare',{review,intentId:settings.intentId,
      acceptIndex,offerSha256:review.offerSha256})).result;
    await note('buyer',{id:prepared.buyer.id,prepared:prepared.prepared});
    const initialized=(await act('publisher.buyer.session',{buyerId:prepared.buyer.id,workspaceId:buyer.id,
      maxPages,maxTotalAtomic:maximum,maxRows:source.opportunities.length,maxPageBytes:2*1024*1024})).result;
    await once('buyerSession',async()=>({id:initialized.id,binding:initialized.binding}));
    let report=initialized.report;
    if(!['READY','COMPLETE'].includes(report.status))
      report=(await act('publisher.buyer.recover',{id:initialized.id})).result;
    if(report.status==='READY')report=(await act('publisher.buyer.run',{id:initialized.id})).result;
    await note('acquisition',report);
    requireValue(report.status==='COMPLETE','NATIVE_RECEIVING_CONTINUATION',report.status);
    requireValue(report.snapshot===baseline.dataset.snapshot&&report.acquiredRows===source.opportunities.length&&
      report.completedPages===requiredPages,'NATIVE_ACQUISITION_COHORT_CHANGED');
    requireValue(report.pages.every(page=>page.nativeBuyerStatus==='DELIVERED_REPORTED_SETTLED'),
      'NATIVE_SETTLED_DELIVERY_REQUIRED');
    const accounting=(await act('publisher.buyer.account',{id:initialized.id})).result;
    await note('accounting',accounting);
    const delivered=(await act('publisher.buyer.export',{id:initialized.id})).result;
    const files=[];
    for(const[kind,file]of [['session-manifest','acquisition-manifest.json'],['session-csv','dataset.csv'],
      ['session-jsonl','dataset.jsonl'],['session-review','review.html'],['draft-review','publisher-draft.json']])
      files.push(await exportNative(kind,kind==='draft-review'?basePrepared.draft.id:initialized.id,file));
    const deliveryManifest=await readJSON(join(delivered.delivery,'manifest.json'));
    requireValue(deliveryManifest.dataset.snapshot===baseline.dataset.snapshot&&
      deliveryManifest.dataset.rows===source.opportunities.length,'NATIVE_DELIVERY_MANIFEST_CHANGED');
    await immutableFile(join(outputDirectory,'delivery-manifest.json'),formatted(deliveryManifest));
    const rows=(await readFile(join(outputDirectory,'dataset.jsonl'),'utf8')).split(/\r?\n/).filter(Boolean).map(JSON.parse);
    assertRows(rows,fullOriginal.rows,DATASET_COLUMNS);
    const editionFile=join(outputDirectory,'source-edition.json');
    if(!await exists(editionFile))await immutableFile(editionFile,formatted(await workspace.exportEdition(full.id)));
    const editionPacket=await readJSON(editionFile);
    const receiver=await openGrantsWorkspace({directory:join(directory,'customer-source-workspace')});
    try{
      await receiver.receiveEdition({requestId:requestId(operationId,'receive-source'),packet:editionPacket});
      const received=await receiver.edition(full.id);
      requireValue(received.sha256===fullOriginal.sha256&&same(received.rows,fullOriginal.rows),'NATIVE_RECEIVING_SOURCE_CHANGED');
      await note('sourceReceiving',{workspaceId:(await receiver.snapshot()).id,editionId:received.id,
        editionSha256:received.sha256,sourceSignature:received.sourceSignature,rows:received.rows.length});
    }finally{await receiver.close();}
    await note('delivery',{id:initialized.id,directory:delivered.delivery,manifest:deliveryManifest,files});
    const identities={workspaceId:(await workspace.snapshot()).id,buyerId:initialized.id,
      snapshots:state.target.versions.versions.map(item=>item.snapshot),pageIdentities:report.pages.map(page=>({
        intentId:page.intentId,evidenceSha256:page.evidenceSha256,responseSha256:page.sourceSha256??page.sha256??null}))};
    await workspace.close();workspace=null;
    if(transport?.close){await transport.close();transport=null;}
    workspace=await openModel();
    const reopened=await workspace.publisherState();
    requireValue((await workspace.snapshot()).id===identities.workspaceId&&
      reopened.target.versions.current===curated.dataset.snapshot&&
      reopened.target.versions.versions.some(item=>item.snapshot===baseline.dataset.snapshot),'NATIVE_REOPEN_VERSION_CHANGED');
    const recovered=(await act('publisher.buyer.recover',{id:initialized.id})).result;
    requireValue(recovered.status==='COMPLETE'&&recovered.sessionId===report.sessionId&&
      same(recovered.pages.map(page=>({intentId:page.intentId,evidenceSha256:page.evidenceSha256,
        responseSha256:page.sourceSha256??page.sha256??null})),identities.pageIdentities),'NATIVE_REOPEN_ACQUISITION_CHANGED');
    for(const file of files.filter(file=>['dataset.csv','dataset.jsonl','review.html'].includes(file.path))){
      const kind=file.path==='dataset.csv'?'session-csv':file.path==='dataset.jsonl'?'session-jsonl':'session-review';
      const resumed=await exportNative(kind,initialized.id,file.path);
      requireValue(same(resumed,file),'NATIVE_REOPEN_EXPORT_CHANGED');
    }
    await note('reopen',{...identities,currentSnapshot:reopened.target.versions.current,
      sessionId:recovered.sessionId,rows:recovered.acquiredRows,pages:recovered.completedPages,byteIdenticalDownloads:true});
    journal.status='COMPLETE';journal.completedAt=clock();journal.attribution=ATTRIBUTION;await save();
    return journal;
  }catch(error){
    journal.status='CONTINUATION_REQUIRED';journal.error={code:error.code??'NATIVE_OPERATION_FAILED',message:error.message,at:clock()};
    await save().catch(()=>{});throw Object.assign(error,{operationDirectory:directory,journalPath:journalFile});
  }finally{
    await workspace?.close().catch(()=>{});
    await transport?.close?.().catch(()=>{});
  }
}
const USAGE=[
  'Grants.gov native publishing and receiving',
  'node publisher-native.mjs prepare|publish|receive --directory ABS --capture ABS --settings ABS --operation ID',
  '',
  'Settings: {merchant:{origin,path,payment}, runtime:{port,facilitator,allowLocalFacilitator},',
  '  buyerWorkspace:{id,directory}, intentId, releaseId, datasetName, pageSize, maxPages, maxTotalAtomic}.',
  'Use the original configured testnet payer and its existing operator policy.',
  'Each invocation resumes the same source, release, buyer session and completed exports.'
].join('\n');
export async function main(args=process.argv.slice(2)){
  if(args.length===1&&args[0]==='--help'){console.log(USAGE);return;}
  const phase=args.shift(),options={};
  while(args.length){const key=args.shift(),value=args.shift();requireValue(
    ['--directory','--capture','--settings','--operation'].includes(key)&&value&&!options[key],'NATIVE_ARGUMENTS',USAGE);options[key]=value;}
  requireValue(Object.keys(options).length===4,'NATIVE_ARGUMENTS',USAGE);
  const result=await runPublisherNative({phase,directory:absolute(options['--directory'],'Operation directory'),
    captureFile:absolute(options['--capture'],'Capture file'),settings:await readJSON(absolute(options['--settings'],'Settings file')),
    operationId:options['--operation'],onProgress:({stage})=>process.stdout.write(JSON.stringify({stage,at:clock()})+'\n')});
  console.log(JSON.stringify({operationId:result.operationId,status:result.status,directory:options['--directory'],
    source:result.source,prepared:result.stages.prepared?.value,delivery:result.stages.delivery?.value,reopen:result.stages.reopen?.value},null,2));
  return result;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(error=>{process.stderr.write(JSON.stringify({code:error.code??'NATIVE_OPERATION_FAILED',message:error.message,
    operationDirectory:error.operationDirectory,journalPath:error.journalPath})+'\n');process.exitCode=1;});
