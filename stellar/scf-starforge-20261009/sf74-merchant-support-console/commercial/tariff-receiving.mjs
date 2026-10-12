// MIT. Complete selected tariff custody through the original case and pricing-backup engines.
import {mkdir,lstat,realpath} from 'node:fs/promises';
import {resolve,isAbsolute,join} from 'node:path';
import {openCaseStore,retainCaseArtifact} from '../case-store.mjs';
import {parseWorkspace} from '../workspace-file.mjs';
import {operateCaseCommissioning} from '../case-commissioning.mjs';
import {MAX_MATERIAL_BYTES,encodeCommissioningBytes,commissioningFileBytes} from '../commissioning.mjs';
import {commercialContext} from '../commercial-quote.mjs';
import {commercialWorkspaceId} from '../case-commercial.mjs';
import {canonical,sha256,jsonBytes,commercialError} from '../commercial-pricing.mjs';
import {readPrivateFile} from '../../sf93-seller-support-bundle/incident-store.mjs';
import {captureCommercialReceivingSource,inspectCommercialReceivingSource,attachCommercialReceivingSource,
  restoreCommercialPricingWorkspace} from './receiving.mjs';
import {captureCommercialTariffSource,inspectCommercialTariffSource,commercialTariffSummary,
  readCommercialTariffSources,inspectCommercialTariffAttachment,reviewCommercialTariffUsage,
  COMMERCIAL_TARIFF_MATERIAL_KIND,COMMERCIAL_TARIFF_ATTACHMENT_SCHEMA} from './tariff-source.mjs';

const SOURCE='stellar-forge.merchant-commercial-tariff-receiving.v1';
const REQUEST='stellar-forge.merchant-commercial-tariff-capture.v1';
const SOURCE_NAME='tariff-receiving.json',TARIFF_NAME='tariff-source.json',REQUEST_NAME='capture-input.json';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const HASH=/^[a-f0-9]{64}$/;
const fail=(code,message,status=422)=>{throw commercialError(code,message,status);};
const copy=value=>JSON.parse(JSON.stringify(value));
function same(a,b,code='COMMERCIAL_TARIFF_SOURCE_CHANGED'){
  if(canonical(a)!==canonical(b))fail(code,'The original selected tariff source or request changed.',409);
}
function uuid(value,label){if(!UUID.test(value??''))fail('COMMERCIAL_TARIFF_REQUEST','Keep the original '+label+' UUID.');return value;}
function hash(value,label){if(!HASH.test(value??''))fail('COMMERCIAL_TARIFF_REQUEST','Keep the exact '+label+' SHA-256.');return value;}
function absolute(value,label){
  if(typeof value!=='string'||!isAbsolute(value)||resolve(value)!==value||value==='/'||value.includes('\0'))
    fail('COMMERCIAL_TARIFF_PATH','Use an absolute private '+label+' path.');
  return value;
}
async function directory(value,{create=false}={}){
  const path=absolute(value,'directory');
  if(create)await mkdir(path,{mode:0o700}).catch(error=>{if(error.code!=='EEXIST')throw error;});
  const stat=await lstat(path);
  if(!stat.isDirectory()||(stat.mode&0o077)||await realpath(path)!==path)
    fail('COMMERCIAL_TARIFF_PATH','Use the original private directory without symbolic links.');
  return path;
}
async function optional(path,limit=MAX_MATERIAL_BYTES){
  try{return await readPrivateFile(path,limit);}catch(error){if(error.code==='ENOENT')return null;throw error;}
}
function decoded(bytes){return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
function pin(name,bytes){return {name,bytes:bytes.length,sha256:sha256(bytes)};}
function requestSelection(request,selectionRequestId,backupRequestId){
  if(request.schema!==REQUEST||request.selectionRequestId!==selectionRequestId||request.backupRequestId!==backupRequestId)
    fail('COMMERCIAL_TARIFF_REQUEST_CHANGED','Reopen this exact original tariff capture and backup request.',409);
}
export async function inspectCommercialTariffReceivingSource({directory:location,expectedSourceSha256}={}){
  const root=await directory(location),bytes=await readPrivateFile(join(root,SOURCE_NAME),1024*1024);
  if(expectedSourceSha256!==undefined&&sha256(bytes)!==hash(expectedSourceSha256,'receiving source'))
    fail('COMMERCIAL_TARIFF_SOURCE_CHANGED','The selected complete tariff receiving source changed.',409);
  const source=decoded(bytes);
  if(source.schema!==SOURCE||!source.request||!Array.isArray(source.files)||source.files.length!==2)
    fail('COMMERCIAL_TARIFF_SOURCE_INVALID','Keep the complete original tariff receiving manifest.');
  uuid(source.request.selectionRequestId,'selection request');uuid(source.request.backupRequestId,'backup request');
  requestSelection(source.request,source.request.selectionRequestId,source.request.backupRequestId);
  const originalRequest=await readPrivateFile(join(root,REQUEST_NAME),1024*1024);
  same(decoded(originalRequest),source.request);
  const tariffBytes=await readPrivateFile(join(root,TARIFF_NAME),MAX_MATERIAL_BYTES);
  same(source.files,[pin(REQUEST_NAME,originalRequest),pin(TARIFF_NAME,tariffBytes)]);
  const pricing=await inspectCommercialReceivingSource({directory:join(root,'pricing'),
    expectedSourceSha256:source.pricingReceivingSourceSha256,includeBackupManifest:true});
  if(pricing.source.request.backupRequestId!==source.request.backupRequestId)
    fail('COMMERCIAL_TARIFF_BACKUP_CHANGED','Keep the original backup selected with this tariff.');
  const tariffSource=decoded(tariffBytes);
  const inspected=await inspectCommercialTariffSource(tariffSource,{pricingSource:pricing.pricingSource});
  same({selectionRequestId:inspected.selectionRequestId,tariffPlanId:inspected.tariffPlanId,
    comparisonId:inspected.comparisonId,planId:inspected.scenarioPlanId,scenarioId:inspected.scenarioId},
    {selectionRequestId:source.request.selectionRequestId,tariffPlanId:source.request.tariffPlanId,
      comparisonId:source.request.comparisonId,planId:source.request.planId,scenarioId:source.request.scenarioId});
  // The selected native pricing result is a later version than its scenario source.
  // Bind its complete original version into this same inspected backup before attachment.
  const pricingManifestFile=tariffSource.files.find(row=>row.name==='saved-pricing-manifest.json');
  const savedManifest=JSON.parse(pricingManifestFile.text);
  const backupFiles=new Map(pricing.backupManifest.files.map(row=>[row.name,row]));
  for(const [name,pin] of Object.entries({...savedManifest.files,'manifest.json':pricingManifestFile})){
    const member=backupFiles.get('versions/'+savedManifest.version+'/'+name);
    if(!member||member.bytes!==pin.bytes||member.sha256!==pin.sha256)
      fail('COMMERCIAL_TARIFF_BACKUP_CHANGED','The complete backup omits original selected pricing member '+name+'.',409);
  }
  if(tariffSource.receivingSourceSha256!==pricing.sourceSha256)
    fail('COMMERCIAL_TARIFF_BACKUP_CHANGED','This tariff source belongs to a different complete pricing backup.');
  return {schema:SOURCE,state:'RECEIVED_SOURCE',directory:root,source,sourceSha256:sha256(bytes),
    tariffSource,tariffFile:pin(TARIFF_NAME,tariffBytes),tariff:inspected,pricing};
}
/** An existing capture reopens from its retained files after the authoring paths have moved. */
export async function captureCommercialTariffReceivingSource({model,planning,tariffs,selectionRequestId,
  backupRequestId,directory:location}={}){
  uuid(selectionRequestId,'native pricing selection');uuid(backupRequestId,'backup request');
  const root=await directory(location,{create:true});
  const retained=await optional(join(root,SOURCE_NAME),1024*1024);
  if(retained){
    const value=decoded(retained);requestSelection(value.request,selectionRequestId,backupRequestId);
    return {...await inspectCommercialTariffReceivingSource({directory:root}),replayed:true};
  }
  if(!model||!planning||!tariffs?.bundle||!tariffs?.inspectPortfolio)
    fail('COMMERCIAL_TARIFF_WORKSPACE_REQUIRED','Open the original pricing and tariff workspace for this first capture.');
  const portfolio=await tariffs.bundle({selectionRequestId}),checked=await tariffs.inspectPortfolio(portfolio);
  if(checked.plans.length!==1||checked.selections.length!==1||
      checked.selections[0].id!==selectionRequestId||checked.selections[0].result?.status!=='TARIFF_SELECTION_SAVED')
    fail('COMMERCIAL_TARIFF_SELECTION_INCOMPLETE','Reopen the original completed scenario and pricing selection.',409);
  const selection=checked.selections[0],native=selection.intent;
  const request={schema:REQUEST,selectionRequestId,backupRequestId,
    tariffPlanId:native.selection.planId,comparisonId:native.selection.comparisonId,
    planId:native.scenarioRequest.requestId,scenarioId:native.scenarioRequest.selectedScenarioId};
  await retainCaseArtifact(join(root,REQUEST_NAME),jsonBytes(request));
  const pricing=await captureCommercialReceivingSource({model,planning,planId:request.planId,
    scenarioId:request.scenarioId,backupRequestId,directory:join(root,'pricing')});
  const tariffSource=await captureCommercialTariffSource({tariffs,model,pricingSource:pricing.pricingSource,
    receivingSourceSha256:pricing.sourceSha256,selectionRequestId});
  const tariffBytes=jsonBytes(tariffSource);
  await retainCaseArtifact(join(root,TARIFF_NAME),tariffBytes);
  const source={schema:SOURCE,request,pricingReceivingSourceSha256:pricing.sourceSha256,
    files:[pin(REQUEST_NAME,jsonBytes(request)),pin(TARIFF_NAME,tariffBytes)]};
  await retainCaseArtifact(join(root,SOURCE_NAME),jsonBytes(source));
  return {...await inspectCommercialTariffReceivingSource({directory:root}),replayed:false};
}
async function context({store,casesDirectory,id,revision}){
  uuid(id,'case');if(revision!==undefined)hash(revision,'case revision');
  const cases=await directory(casesDirectory),original=store??await openCaseStore(cases);
  const record=await original.read(id,revision),workspace=await parseWorkspace(record.workspaceText);
  const commercial=await commercialContext(workspace,{caseId:id,workspaceId:commercialWorkspaceId(cases),revision:record.revision});
  const tariffSources=commercial.tariffSources??await readCommercialTariffSources(commercial.state,commercial.pricingSources);
  return {store:original,cases,record,commercial,tariffSources};
}
export async function attachCommercialTariffReceivingSource({store,casesDirectory,id,expectedRevision,
  pricingRequestId,backupAttachmentRequestId,tariffAttachmentRequestId,actor,bindingReason,
  directory:location,expectedSourceSha256}={}){
  const requests=[uuid(pricingRequestId,'case pricing request'),uuid(backupAttachmentRequestId,'backup attachment'),
    uuid(tariffAttachmentRequestId,'tariff attachment')];
  if(new Set(requests).size!==requests.length)fail('COMMERCIAL_TARIFF_REQUEST','Use three distinct original case request UUIDs.');
  hash(expectedRevision,'reviewed case revision');hash(expectedSourceSha256,'reviewed tariff receiving source');
  if(typeof actor!=='string'||!actor.trim()||actor.length>200||
      typeof bindingReason!=='string'||!bindingReason.trim()||bindingReason.length>4000)
    fail('COMMERCIAL_TARIFF_REQUEST','Record the operator and the actual matching merchant/source reason.');
  const received=await inspectCommercialTariffReceivingSource({directory:location,expectedSourceSha256});
  const priced=await attachCommercialReceivingSource({store,casesDirectory,id,expectedRevision,
    pricingRequestId,attachmentRequestId:backupAttachmentRequestId,actor,bindingReason,
    directory:received.pricing.directory,expectedSourceSha256:received.pricing.sourceSha256});
  const current=await context({store,casesDirectory,id});
  const source=received.tariffSource;
  const binding={schema:COMMERCIAL_TARIFF_ATTACHMENT_SCHEMA,sourceId:source.id,
    pricingSourceId:source.pricingSourceId,receivingSourceSha256:source.receivingSourceSha256,
    selectionRequestId:source.selectionRequestId,pricingRequestId,backupAttachmentRequestId,
    tariffAttachmentRequestId,bindingReason};
  const retained=current.commercial.state.materials.find(row=>row.id==='commercial-tariff:'+tariffAttachmentRequestId);
  if(retained)same(inspectCommercialTariffAttachment(retained,source),binding,'COMMERCIAL_TARIFF_REQUEST_CHANGED');
  const bytes=jsonBytes(source);
  same(pin(TARIFF_NAME,bytes),received.tariffFile);
  const command={type:'add_material',requestId:tariffAttachmentRequestId,
    expectedRevision:current.commercial.state.revision,actor,recordedAt:received.tariff.selectedAt,payload:{
      id:'commercial-tariff:'+tariffAttachmentRequestId,name:'tariff-source-'+source.selectionRequestId+'.json',
      mediaType:'application/json',data:encodeCommissioningBytes(bytes),kind:COMMERCIAL_TARIFF_MATERIAL_KIND,
      description:canonical(binding),taskIds:[],editionId:retained?.editionId??current.commercial.state.activeEditionId,
      reference:'urn:stellar-forge:commercial-pricing:'+source.pricingSourceId}};
  const attached=await operateCaseCommissioning(current.store,{id,expectedRevision:current.record.revision,command});
  const reopened=await context({store:current.store,casesDirectory,id});
  const selected=reopened.tariffSources.find(row=>row.material.id==='commercial-tariff:'+tariffAttachmentRequestId);
  if(!selected)fail('COMMERCIAL_TARIFF_ATTACHMENT_CHANGED','Reopen this original tariff attachment after its case save.',409);
  same(selected.binding,binding);
  return {schema:COMMERCIAL_TARIFF_ATTACHMENT_SCHEMA,state:'ATTACHED',case:{id,revision:reopened.record.revision},
    tariffSourceId:selected.id,pricingSourceId:selected.pricingSourceId,sourceSha256:received.sourceSha256,
    materialId:selected.material.id,archiveSha256:selected.backup.sha256,
    pricingRequestId,backupAttachmentRequestId,tariffAttachmentRequestId,
    pricingReplayed:priced.pricingReplayed,backupReplayed:priced.attachmentReplayed,
    tariffReplayed:attached.replayed===true,tariff:commercialTariffSummary(selected)};
}
function choose(selected,sourceId,quoteId,quoteSha256){
  let quote=null;
  if(quoteId!==undefined){
    uuid(quoteId,'quote');hash(quoteSha256,'quote');
    quote=selected.commercial.quotes.find(row=>row.id===quoteId);
    if(!quote||quote.sha256!==quoteSha256)fail('COMMERCIAL_TARIFF_QUOTE_CHANGED','Reopen the exact original quote.',409);
    const quoted=quote.sourceBindings.tariff;
    if(!quoted?.id)fail('COMMERCIAL_TARIFF_QUOTE_REQUIRED','Select a quotation that retains its tariff basis.');
    if(sourceId!==undefined&&sourceId!==quoted.id)fail('COMMERCIAL_TARIFF_QUOTE_CHANGED','This quote selected a different tariff source.',409);
    sourceId=quoted.id;
  }else if(quoteSha256!==undefined)fail('COMMERCIAL_TARIFF_QUOTE_REQUIRED','Keep the original quote UUID and SHA together.');
  hash(sourceId,'tariff source');
  const tariff=selected.tariffSources.find(row=>row.id===sourceId);
  if(!tariff)fail('COMMERCIAL_TARIFF_SOURCE_MISSING','The selected original tariff source is missing from this case.',404);
  if(quote&&quote.sourceBindings.pricing?.id!==tariff.pricingSourceId)
    fail('COMMERCIAL_TARIFF_PRICING_CHANGED','The quote and tariff have different original pricing sources.');
  return {tariff,quote};
}
export async function inspectCommercialCaseTariff({store,casesDirectory,id,revision,sourceId,quoteId,quoteSha256,
  monthlyRequests}={}){
  const selected=await context({store,casesDirectory,id,revision});
  const found=choose(selected,sourceId,quoteId,quoteSha256);
  return {schema:'stellar-forge.merchant-commercial-tariff-case.v1',state:'REVIEWED',
    case:{id,revision:selected.record.revision},tariff:commercialTariffSummary(found.tariff),
    quote:found.quote?{id:found.quote.id,sha256:found.quote.sha256,originCaseId:found.quote.originCaseId}:null,
    ...(monthlyRequests!==undefined?{volumeReview:reviewCommercialTariffUsage(found.tariff,monthlyRequests)}:{})};
}
export async function downloadCommercialCaseTariff({store,casesDirectory,id,revision,sourceId,kind='SOURCE'}={}){
  const selected=await context({store,casesDirectory,id,revision}),{tariff}=choose(selected,sourceId);
  let bytes,name;
  if(kind==='SOURCE'){
    bytes=Buffer.from(commissioningFileBytes(selected.commercial.state,tariff.material.sha256));
    name='merchant-tariff-source-'+tariff.selectionRequestId+'.json';
  }else if(kind==='PORTFOLIO'){
    const file=tariff.source.files.find(row=>row.name==='tariff-portfolio.json');
    bytes=Buffer.from(file.text);same(pin(file.name,bytes),{name:file.name,bytes:file.bytes,sha256:file.sha256});
    name='merchant-tariff-portfolio-'+tariff.selectionRequestId+'.json';
  }else fail('COMMERCIAL_TARIFF_FILE_REQUIRED','Choose the complete SOURCE or original PORTFOLIO file.');
  return {case:{id,revision:selected.record.revision},tariffSourceId:tariff.id,
    descriptor:{filename:name,bytes:bytes.length,sha256:sha256(bytes),mediaType:'application/json'},body:bytes};
}
/** Restore the original full pricing backup first, then receive its exact native tariff portfolio. */
export async function restoreCommercialCaseTariff({store,casesDirectory,id,revision,sourceId,quoteId,quoteSha256,
  archive,directory:location}={}){
  const selected=await context({store,casesDirectory,id,revision}),{tariff,quote}=choose(selected,sourceId,quoteId,quoteSha256);
  if(!quote)fail('COMMERCIAL_TARIFF_QUOTE_REQUIRED','Select the saved quotation and its exact tariff basis before restoring.');
  const restored=await restoreCommercialPricingWorkspace({store:selected.store,casesDirectory,id,revision:selected.record.revision,
    quoteId,quoteSha256,archiveSha256:tariff.backup.sha256,archive,directory:location});
  const {openWorkspace}=await import('../../sf97-merchant-revenue-ops/workspace/model.mjs');
  const {openTariffWorkspace}=await import('../../sf97-merchant-revenue-ops/tariffs/workspace.mjs');
  const model=await openWorkspace(restored.source),tariffs=await openTariffWorkspace({model,directory:restored.source.directory});
  const received=await tariffs.receive(tariff.portfolio);
  const reopened=await tariffs.bundle({selectionRequestId:tariff.selectionRequestId});
  same(reopened,tariff.portfolio,'COMMERCIAL_TARIFF_RESTORED_SOURCE_CHANGED');
  await tariffs.inspectPortfolio(reopened);
  return {schema:'stellar-forge.merchant-commercial-tariff-restored.v1',state:'COMPLETE',
    case:{id,revision:selected.record.revision},quoteId,quoteSha256,tariffSourceId:tariff.id,
    selectionRequestId:tariff.selectionRequestId,tariffPlanId:tariff.tariffPlanId,
    comparisonId:tariff.comparisonId,pricing:restored,portfolio:received,source:restored.source};
}
