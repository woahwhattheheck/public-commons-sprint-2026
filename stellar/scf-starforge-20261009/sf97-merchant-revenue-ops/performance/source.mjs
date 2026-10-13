// MIT. Complete frozen Pricing, tariff, cost and service sources for recorded performance.
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {analyze} from '../analyze.mjs';
import {inspectTariffPortfolio} from '../tariffs/workspace.mjs';
import {openPlanningWorkspace} from '../planning/workspace.mjs';
import {normalizeBook,costReport} from '../economics/engine.mjs';
import {readPrivate} from '../economics/common.mjs';
import {createPerformanceReview,normalizePerformanceInputs} from './model.mjs';

export const PERFORMANCE_SOURCE_SCHEMA='stellar-forge.merchant-tariff-performance-source.v1';
export const SERVICE_SOURCE_SCHEMA='stellar-forge.merchant-performance-service-source.v1';
export const PERFORMANCE_MAX_BYTES=48*1024*1024;
export const PERFORMANCE_RECORD_SCHEMA='stellar-forge.merchant-tariff-performance-record.v1';
const HASH=/^[a-f0-9]{64}$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const plain=value=>value&&typeof value==='object'&&!Array.isArray(value);
const own=(value,key)=>Object.hasOwn(value,key);
export const canonical=value=>JSON.stringify(value,(_,item)=>plain(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
export const sha256=value=>createHash('sha256').update(value).digest('hex');
export const fingerprint=value=>sha256(canonical(value));
export const encode=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
export const performanceError=(code,message,status=422)=>Object.assign(new Error(message),{code,status});
const fail=(code,message,status=422)=>{throw performanceError(code,message,status);};
const copy=value=>structuredClone(value);
function exact(value,keys,label){
  if(!plain(value)||Object.keys(value).some(key=>!keys.includes(key)))
    fail('PERFORMANCE_SOURCE_INVALID','Keep the complete original '+label+'.');
}
function same(a,b,label){
  if(canonical(a)!==canonical(b))fail('PERFORMANCE_SOURCE_CHANGED',label+' differs from its retained original.',409);
}
function uuid(value,label){
  if(!UUID.test(value??''))fail('PERFORMANCE_ID_INVALID','Choose the original '+label+' UUID.');
  return value;
}
function hash(value,label){
  if(!HASH.test(value??''))fail('PERFORMANCE_HASH_INVALID','Keep the exact '+label+' SHA-256.');
  return value;
}
export function performanceLabel(value,label='Review name'){
  if(typeof value!=='string'||!value.trim()||value.length>100||/[\u0000-\u001f\u007f]/.test(value))
    fail('PERFORMANCE_LABEL_INVALID',label+' must contain 1–100 printable characters.');
  return value.trim();
}
function filename(value){
  if(typeof value!=='string'||value.length>300||value.includes('\\')||/[\u0000-\u001f\u007f]/.test(value)||
      value.split('/').some(part=>!part||part==='.'||part==='..'))
    fail('PERFORMANCE_FILE_NAME_INVALID','Keep the original relative source filename.');
  return value;
}
function json(bytes,label){
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
  catch{fail('PERFORMANCE_SOURCE_JSON_INVALID',label+' must retain complete original UTF-8 JSON bytes.');}
}
export function sourceFile(name,raw){
  filename(name);const bytes=Buffer.from(raw);
  if(bytes.length>PERFORMANCE_MAX_BYTES)fail('PERFORMANCE_SOURCE_LIMIT','The original source exceeds the complete 48 MiB material limit.',413);
  let text;try{text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);}catch{}
  return {name,bytes:bytes.length,sha256:sha256(bytes),...(text===undefined?{base64:bytes.toString('base64')}:{text})};
}
export function sourceFileBytes(row){
  exact(row,['name','bytes','sha256','text','base64'],'file descriptor');filename(row.name);hash(row.sha256,'file');
  if(!Number.isSafeInteger(row.bytes)||row.bytes<0||row.bytes>PERFORMANCE_MAX_BYTES||own(row,'text')===own(row,'base64'))
    fail('PERFORMANCE_FILE_INVALID','Keep each complete source file and its original byte count.');
  let bytes;
  if(own(row,'text')){
    if(typeof row.text!=='string')fail('PERFORMANCE_FILE_INVALID','Original text bytes are missing.');
    bytes=Buffer.from(row.text);
    if(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes)!==row.text)
      fail('PERFORMANCE_FILE_ENCODING','The original UTF-8 source changed encoding.');
  }else{
    if(typeof row.base64!=='string'||row.base64.length%4||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(row.base64))
      fail('PERFORMANCE_FILE_ENCODING','Keep canonical complete binary source bytes.');
    bytes=Buffer.from(row.base64,'base64');
  }
  if(bytes.length!==row.bytes||sha256(bytes)!==row.sha256)
    fail('PERFORMANCE_FILE_CHANGED','The retained source file '+row.name+' differs from its complete bytes.',409);
  return bytes;
}
function fileMap(rows,label){
  if(!Array.isArray(rows)||rows.length>20000)fail('PERFORMANCE_FILE_INDEX_INVALID','Keep the complete '+label+' file index.');
  const files=new Map();
  for(const row of rows){
    if(files.has(row.name))fail('PERFORMANCE_FILE_INDEX_INVALID','The original file index repeats '+row.name+'.');
    files.set(row.name,{file:row,bytes:sourceFileBytes(row)});
  }
  return files;
}
function required(files,name){
  const value=files.get(name);if(!value)fail('PERFORMANCE_SOURCE_MISSING','The complete source omits '+name+'.');
  return value;
}
function originalManifest(files,expectedSchema,label){
  const original=required(files,'manifest.json'),manifest=json(original.bytes,label);
  if(manifest.schema!==expectedSchema||!plain(manifest.files))fail('PERFORMANCE_SOURCE_INVALID','Keep the original '+label+'.');
  const expected=[...Object.keys(manifest.files),'manifest.json'].sort();
  same([...files.keys()].sort(),expected,'Complete '+label+' file list');
  for(const [name,pin]of Object.entries(manifest.files)){
    const {file}=required(files,name);same({bytes:file.bytes,sha256:file.sha256},pin,'Original '+name+' descriptor');
  }
  return {manifest,revision:original.file.sha256,manifestBytes:original.bytes};
}
function stableReport(value){const result=copy(value);delete result.generatedAt;return result;}
function nativeContext(files,pricing){
  const name='report/native-settlement/native-ops.json';
  if(!files.has(name))return null;
  const row=files.get(name),value=json(row.bytes,'Original native reconciliation');
  if(value.schema!=='stellar-forge.sf97-native-merchant-reconciliation.v1'||
      !Array.isArray(value.routes)||!Array.isArray(value.options)||!Array.isArray(value.events)||!plain(value.totals)||
      !Number.isFinite(Date.parse(value.generatedAt))||value.sourceSha256?.sf97Report!==pricing.reportFile.sha256)
    fail('PERFORMANCE_NATIVE_SOURCE_CHANGED','Retain the original native report bound to this exact saved Pricing report.',409);
  same([value.sessionId,value.sellerMode,value.observedFrom,value.observedUntil],
    [pricing.report.sessionId,pricing.report.originalSellerMode,pricing.report.observedFrom,pricing.report.observedUntil],
    'Native observation identity');
  if(pricing.report.observationKind==='DURABLE_HISTORY')
    same([value.observationKind,value.sessionIds,value.usageSummary?.range],
      ['DURABLE_HISTORY',pricing.report.sessionIds,pricing.report.usageHistory.range],'Native retained period');
  const options=new Set();
  for(const option of value.options){
    hash(option.optionId,'native payment option');
    if(options.has(option.optionId))fail('PERFORMANCE_NATIVE_SOURCE_CHANGED','An original native payment option is repeated.',409);
    options.add(option.optionId);
    const key=[option.routeId,option.method,option.network,option.assetDigest,option.amountAtomic,option.recipientDigest].join('\n');
    if(sha256('stellar-forge.merchant-option.v1\n'+key)!==option.optionId)
      fail('PERFORMANCE_NATIVE_SOURCE_CHANGED','A native option differs from its original complete payment identity.',409);
    const route=pricing.report.routes.find(item=>item.routeId===option.routeId&&item.method===option.method);
    const payment=route?.paymentOptions?.[option.optionIndex-1];
    if(!payment||payment.network!==option.network||payment.atomicAmount!==option.amountAtomic||
        sha256(payment.asset)!==option.assetDigest||sha256(payment.payTo)!==option.recipientDigest)
      fail('PERFORMANCE_NATIVE_SOURCE_CHANGED','The native option differs from the original selected seller terms.',409);
    for(const field of ['nativeAtomicAmount','inboxAcceptedAtomicAmount','pendingAtomicAmount','exhaustedAtomicAmount'])
      if(typeof option[field]!=='string'||!/^(0|[1-9]\d*)$/.test(option[field]))
        fail('PERFORMANCE_NATIVE_SOURCE_CHANGED','Keep the original exact native atomic totals.',409);
    if(BigInt(option.inboxAcceptedAtomicAmount)+BigInt(option.pendingAtomicAmount)+BigInt(option.exhaustedAtomicAmount)!==BigInt(option.nativeAtomicAmount))
      fail('PERFORMANCE_NATIVE_SOURCE_CHANGED','The original native atomic amounts do not conserve their delivery populations.',409);
  }
  const events=new Set();
  for(const event of value.events){
    hash(event.eventId,'native event');
    if(events.has(event.eventId))fail('PERFORMANCE_NATIVE_SOURCE_CHANGED','The frozen native report repeats an original event.',409);
    events.add(event.eventId);
    if(event.optionId!==null&&!options.has(event.optionId))fail('PERFORMANCE_NATIVE_SOURCE_CHANGED','A frozen event names a missing original payment option.',409);
  }
  for(const row of value.routes){
    const original=pricing.report.routes.find(route=>route.routeId===row.routeId&&route.method===row.method);
    if(!original||String(row.http2xx)!==original.actual2xx||String(row.http402)!==original.actual402)
      fail('PERFORMANCE_NATIVE_SOURCE_CHANGED','Native route counters differ from their saved original HTTP source.',409);
  }
  return {file:row.file,value};
}
export function inspectPricingVersion(raw){
  exact(raw,['version','files'],'saved Pricing source');uuid(raw.version,'Pricing version');
  const files=fileMap(raw.files,'Pricing'),{manifest,revision}=originalManifest(files,'stellar-forge.merchant-pricing-version.v1','Pricing manifest');
  if(manifest.version!==raw.version)fail('PERFORMANCE_SOURCE_CHANGED','The saved Pricing version identity changed.',409);
  const sellerFile=required(files,'seller.json'),termsFile=required(files,'terms.json');
  const observationName=manifest.sourceFile??'snapshot.json',observationFile=required(files,observationName);
  const reportFile=required(files,'report/report.json'),report=json(reportFile.bytes,'Original Pricing report');
  const seller=json(sellerFile.bytes,'Original seller'),terms=json(termsFile.bytes,'Original merchant terms');
  const observation=json(observationFile.bytes,'Original observation');
  const provenance={seller:sellerFile.file.sha256,terms:termsFile.file.sha256,snapshot:observationFile.file.sha256,
    ...(observationName==='history.json'?{history:observationFile.file.sha256}:{})};
  same(report.sourceSha256,provenance,'Original Pricing report provenance');
  same([manifest.sellerSha256,manifest.snapshotSha256],[provenance.seller,provenance.snapshot],'Original Pricing source identities');
  const recomputed=analyze(seller,observation,terms,provenance);
  same(stableReport(report),stableReport(recomputed),'Complete original Pricing report');
  const result={version:raw.version,revision,label:manifest.label,savedAt:manifest.savedAt,manifest,
    seller,terms,observation,provenance,report,reportFile:reportFile.file,files};
  result.native=nativeContext(files,result);
  return result;
}
export async function capturePricingVersion(model,version){
  uuid(version,'Pricing version');
  const manifestBytes=await model.download(version,'manifest.json'),manifest=json(manifestBytes,'Original Pricing manifest');
  if(!plain(manifest.files)||manifest.version!==version)fail('PERFORMANCE_SOURCE_INVALID','Choose the original saved Pricing manifest.');
  const declared=Object.values(manifest.files).reduce((sum,pin)=>sum+pin.bytes,manifestBytes.length);
  if(!Number.isSafeInteger(declared)||declared>PERFORMANCE_MAX_BYTES)
    fail('PERFORMANCE_SOURCE_LIMIT','This complete saved review exceeds 48 MiB; choose an original review of the required route and period.',413);
  const files=[sourceFile('manifest.json',manifestBytes)];
  for(const name of Object.keys(manifest.files).sort())files.push(sourceFile(name,await model.download(version,name)));
  const value={version,files};inspectPricingVersion(value);return value;
}
async function captureCostEdition(economics,edition){
  uuid(edition,'Cost edition');
  const manifestBytes=await economics.download(edition,'manifest.json'),manifest=json(manifestBytes,'Original cost manifest');
  if(manifest.edition!==edition||!plain(manifest.files))fail('PERFORMANCE_COST_SOURCE_CHANGED','Choose the complete saved cost edition.',409);
  const files=[sourceFile('manifest.json',manifestBytes)];
  for(const name of Object.keys(manifest.files).sort())files.push(sourceFile(name,await economics.download(edition,name)));
  const binding=json(files.find(row=>row.name==='binding.json')?sourceFileBytes(files.find(row=>row.name==='binding.json')):Buffer.alloc(0),'Original cost binding');
  const originals=[];
  for(const pin of binding.sources){
    const original=await economics.sourceDownload(pin.sourceId);
    const receipt=await readPrivate(join(economics.root,'sources','records',pin.sourceId,'source.json'),PERFORMANCE_MAX_BYTES);
    if(sha256(receipt)!==original.source.receiptSha256)
      fail('PERFORMANCE_COST_SOURCE_CHANGED','The original retained supplier receipt changed during capture.',409);
    originals.push({sourceId:pin.sourceId,files:[sourceFile('source.json',receipt),sourceFile('original',original.bytes)]});
  }
  return {edition,files,originals};
}
function inspectCostEdition(raw,pricing){
  if(raw===null)return null;
  exact(raw,['edition','files','originals'],'cost source');uuid(raw.edition,'Cost edition');
  const files=fileMap(raw.files,'cost edition'),{manifest,revision}=originalManifest(files,'stellar-forge.merchant-cost-edition.v1','cost manifest');
  if(manifest.edition!==raw.edition||!Array.isArray(raw.originals))
    fail('PERFORMANCE_COST_SOURCE_CHANGED','Keep the original cost edition and every referenced supplier source.',409);
  const input=json(required(files,'input.json').bytes,'Original cost input'),reportFile=required(files,'report.json');
  const report=json(reportFile.bytes,'Original cost report'),binding=json(required(files,'binding.json').bytes,'Original cost binding');
  const index=json(required(files,'source-index.json').bytes,'Original cost source index');
  if(binding.schema!=='stellar-forge.merchant-cost-binding.v1'||binding.sellerSha256!==pricing.manifest.sellerSha256||
      binding.reason!==input.reason||input.pricingVersion!==pricing.version||binding.pricingVersion!==pricing.version||binding.pricingRevision!==pricing.revision||
      binding.pricingReportSha256!==pricing.reportFile.sha256)
    fail('PERFORMANCE_COST_SOURCE_CHANGED','The saved cost edition must retain this exact Pricing usage source.',409);
  same(required(files,'original-pricing-report.json').file.sha256,pricing.reportFile.sha256,'Cost original Pricing bytes');
  const sources=new Map();
  for(const rawSource of raw.originals){
    exact(rawSource,['sourceId','files'],'supplier original');uuid(rawSource.sourceId,'Supplier source');
    if(sources.has(rawSource.sourceId))fail('PERFORMANCE_COST_SOURCE_CHANGED','A supplier source is repeated.',409);
    const originalFiles=fileMap(rawSource.files,'supplier');
    same([...originalFiles.keys()].sort(),['original','source.json'],'Complete supplier source files');
    const sourceRow=required(originalFiles,'source.json'),source=json(sourceRow.bytes,'Original supplier receipt');
    const original=required(originalFiles,'original');
    if(source.sourceId!==rawSource.sourceId||source.schema!=='stellar-forge.merchant-cost-source.v1')
      fail('PERFORMANCE_COST_SOURCE_CHANGED','Keep the original supplier receipt and its source ID.',409);
    same([source.bytes,source.sha256],[original.file.bytes,original.file.sha256],'Supplier original bytes');
    sources.set(rawSource.sourceId,{...source,receiptSha256:sourceRow.file.sha256});
  }
  if(!Array.isArray(index)||index.length!==sources.size||!Array.isArray(binding.sources)||binding.sources.length!==sources.size)
    fail('PERFORMANCE_COST_SOURCE_CHANGED','The complete supplier source index changed.',409);
  for(const row of index)same(row,sources.get(row.sourceId),'Supplier source index');
  for(const row of binding.sources){
    const source=sources.get(row.sourceId);
    if(!source)fail('PERFORMANCE_COST_SOURCE_CHANGED','A bound supplier original is missing.',409);
    same(row,{sourceId:source.sourceId,sha256:source.sha256,receiptSha256:source.receiptSha256,bytes:source.bytes},'Cost supplier binding');
  }
  const book=normalizeBook(input,pricing.report,sources),computed=costReport(book,pricing.report,sources);
  same(book,input,'Saved native cost input');same(computed,report,'Saved native cost report');
  return {edition:raw.edition,revision,pricingVersion:pricing.version,input,report,binding,reportFile:reportFile.file,files};
}
async function compiledService(files){
  const {normalizeUsage}=await import('../../merchant-settlement-accounting/customer-statements/core.mjs');
  const {compileServicePeriod}=await import('../../merchant-settlement-accounting/customer-statements/period-usage.mjs');
  const openingFile=required(files,'opening.json'),closingFile=required(files,'closing.json');
  const opening=normalizeUsage(json(openingFile.bytes,'Original opening API-pass export'));
  const closing=normalizeUsage(json(closingFile.bytes,'Original closing API-pass export'));
  const period=compileServicePeriod({opening,closing,
    openingSource:{id:openingFile.file.sha256,sha256:openingFile.file.sha256},
    closingSource:{id:closingFile.file.sha256,sha256:closingFile.file.sha256}});
  const order=closing.orders[0],entitlement=Object.fromEntries(['orderRef','eventId','routeId','method','network','amountAtomic',
    'assetDigest','recipientDigest','entitledAt','planId','planRevision','planSha256','manifestSha256','unitsPurchased'].map(key=>[key,order[key]??null]));
  return {period,entitlement};
}
export async function createServicePeriodSource({label,opening,closing}={}){
  label=performanceLabel(label,'Service source name');
  for(const [key,row]of Object.entries({opening,closing})){
    exact(row,['name','text'],key+' source');
    if(typeof row.name!=='string'||!row.name.trim()||row.name.length>300||typeof row.text!=='string')
      fail('PERFORMANCE_SERVICE_FILE_REQUIRED','Keep the full original '+key+' filename and UTF-8 content.');
  }
  const files=[sourceFile('opening.json',Buffer.from(opening.text)),sourceFile('closing.json',Buffer.from(closing.text))];
  const {period,entitlement}=await compiledService(fileMap(files,'service'));
  const value={schema:SERVICE_SOURCE_SCHEMA,label,originalNames:{opening:opening.name,closing:closing.name},files,period,entitlement};
  const source={...value,id:fingerprint(value)};
  if(encode(source).length>PERFORMANCE_MAX_BYTES)fail('PERFORMANCE_SOURCE_LIMIT','The complete original service pair exceeds 48 MiB.',413);
  return source;
}
export async function inspectServicePeriodSource(raw){
  exact(raw,['schema','id','label','originalNames','files','period','entitlement'],'service-period source');
  if(raw.schema!==SERVICE_SOURCE_SCHEMA||raw.label!==performanceLabel(raw.label)||!HASH.test(raw.id??'')||encode(raw).length>PERFORMANCE_MAX_BYTES)
    fail('PERFORMANCE_SERVICE_SOURCE_INVALID','Use the complete original service-period source.');
  exact(raw.originalNames,['opening','closing'],'original service filenames');
  for(const key of ['opening','closing']){const name=raw.originalNames[key];if(typeof name!=='string'||!name.trim()||name.length>300)
    fail('PERFORMANCE_SERVICE_SOURCE_INVALID','Retain the original service filenames.');}
  const {id,...value}=raw;same(fingerprint(value),id,'Complete service source identity');
  const files=fileMap(raw.files,'service');same([...files.keys()].sort(),['closing.json','opening.json'],'Complete service source files');
  const computed=await compiledService(files);
  same(computed.period,raw.period,'Original service-period calculation');same(computed.entitlement,raw.entitlement,'Original purchased entitlement');
  return {...copy(raw),files:raw.files.map(({text,base64,...row})=>row),source:copy(raw)};
}
export async function capturePerformanceOriginals({model,tariffs,directory,inputs:raw,serviceSource=null}={}){
  const inputs=normalizePerformanceInputs(raw);
  if(!model?.download||!model?.planningSource||!tariffs?.bundle||!tariffs?.inspectPortfolio)
    fail('PERFORMANCE_WORKSPACE_REQUIRED','Open the existing merchant Pricing and tariff workspaces.');
  const tariffPortfolio=await tariffs.bundle({selectionRequestId:inputs.selectionRequestId});
  const checked=await tariffs.inspectPortfolio(tariffPortfolio);
  if(checked.plans.length!==1||checked.selections.length!==1||checked.selections[0].id!==inputs.selectionRequestId||
      checked.selections[0].result?.status!=='TARIFF_SELECTION_SAVED')
    fail('PERFORMANCE_SAVED_SELECTION_REQUIRED','Choose one completed original native tariff selection.');
  const selected=checked.selections[0],versions=[...new Set([checked.plans[0].version,selected.result.pricing.version,inputs.usageVersion])];
  const pricing=[];for(const version of versions)pricing.push(await capturePricingVersion(model,version));
  const planning=await openPlanningWorkspace({model,directory});
  const scenarioPlans=[await planning.load(selected.intent.request.planRequestId)];
  const costEdition=inputs.costEdition===null?null:await captureCostEdition(model.economics,inputs.costEdition);
  if(inputs.servicePeriodSourceId!==null){
    if(!serviceSource||serviceSource.id!==inputs.servicePeriodSourceId)
      fail('PERFORMANCE_SERVICE_SOURCE_REQUIRED','Choose a complete retained service source.');
    await inspectServicePeriodSource(serviceSource);
  }else if(serviceSource!==null)fail('PERFORMANCE_SERVICE_SOURCE_UNUSED','The selected quantity basis does not use this service source.');
  const originals={pricing,tariffPortfolio,scenarioPlans,costEdition,servicePeriod:serviceSource};
  if(encode(originals).length>PERFORMANCE_MAX_BYTES)
    fail('PERFORMANCE_SOURCE_LIMIT','The complete selected sources exceed 48 MiB; choose the original review for the required route and period.',413);
  return originals;
}
async function inspectOriginals(raw,inputs){
  exact(raw,['pricing','tariffPortfolio','scenarioPlans','costEdition','servicePeriod'],'performance originals');
  if(!Array.isArray(raw.pricing)||raw.pricing.length<1||raw.pricing.length>3||!Array.isArray(raw.scenarioPlans)||raw.scenarioPlans.length!==1)
    fail('PERFORMANCE_ORIGINALS_INVALID','Keep every original selected Pricing version and scenario.');
  const pricing=new Map();
  for(const value of raw.pricing){
    const checked=inspectPricingVersion(value);
    if(pricing.has(checked.version))fail('PERFORMANCE_ORIGINALS_INVALID','A Pricing source version is repeated.');
    pricing.set(checked.version,checked);
  }
  const plans=new Map();
  for(const plan of raw.scenarioPlans){
    uuid(plan.planId,'Scenario plan');
    if(plans.has(plan.planId))fail('PERFORMANCE_ORIGINALS_INVALID','A scenario plan is repeated.');
    plans.set(plan.planId,plan);
  }
  const original=version=>{
    const value=pricing.get(version);if(!value)fail('PERFORMANCE_ORIGINALS_INVALID','A referenced original Pricing version is missing.');
    return value;
  };
  const portfolio=await inspectTariffPortfolio(raw.tariffPortfolio,{
    pricingSource:async version=>original(version),
    scenarioPlan:async planId=>{
      const plan=plans.get(planId);if(!plan)fail('PERFORMANCE_ORIGINALS_INVALID','The complete native scenario is missing.');
      return plan;
    },
    pricingManifest:async version=>required(original(version).files,'manifest.json').bytes});
  if(portfolio.plans.length!==1||portfolio.selections.length!==1||portfolio.selections[0].id!==inputs.selectionRequestId||
      portfolio.selections[0].result?.status!=='TARIFF_SELECTION_SAVED')
    fail('PERFORMANCE_SAVED_SELECTION_REQUIRED','Retain one complete completed original tariff selection.');
  const record=portfolio.plans[0],selection=portfolio.selections[0],comparison=record.review.comparisons.find(row=>row.id===selection.intent.selection.comparisonId);
  const selected={record,selection,comparison,pricing:original(selection.result.pricing.version)};
  same([...pricing.keys()].sort(),[...new Set([record.version,selected.pricing.version,inputs.usageVersion])].sort(),'Complete selected Pricing source set');
  same([...plans.keys()],[selection.intent.request.planRequestId],'Complete native scenario set');
  const usage=original(inputs.usageVersion),cost=inspectCostEdition(raw.costEdition,usage);
  const servicePeriod=raw.servicePeriod===null?null:await inspectServicePeriodSource(raw.servicePeriod);
  same(inputs.servicePeriodSourceId,servicePeriod?.id??null,'Selected service-period source');
  const review=createPerformanceReview({inputs,selected,usage,cost,servicePeriod,originalsSha256:fingerprint(raw)});
  return {selected,usage,cost,servicePeriod,review};
}
export async function preparePerformanceReview({inputs:raw,originals}={}){
  const inputs=normalizePerformanceInputs(raw),context=await inspectOriginals(originals,inputs);
  return {inputs,review:context.review};
}
function completeFileIndex(originals){
  const rows=[];
  const add=(prefix,files)=>{for(const {text,base64,...file}of files)rows.push({...file,name:prefix+file.name});};
  for(const source of originals.pricing)add('pricing/'+source.version+'/',source.files);
  rows.push(sourceFile('tariff-portfolio.json',encode(originals.tariffPortfolio)));
  for(const plan of originals.scenarioPlans)rows.push(sourceFile('scenario-plans/'+plan.planId+'.json',encode(plan)));
  if(originals.costEdition){
    add('cost/'+originals.costEdition.edition+'/',originals.costEdition.files);
    for(const source of originals.costEdition.originals)add('supplier-originals/'+source.sourceId+'/',source.files);
  }
  if(originals.servicePeriod)add('service/'+originals.servicePeriod.id+'/',originals.servicePeriod.files);
  return rows.map(({text,base64,...file})=>file);
}
export async function createPerformanceSource({requestId,label,inputs,performanceSha256,originals,savedAt}={}){
  uuid(requestId,'Performance request');label=performanceLabel(label);hash(performanceSha256,'Reviewed performance');
  if(typeof savedAt!=='string'||!Number.isFinite(Date.parse(savedAt))||new Date(savedAt).toISOString()!==savedAt)
    fail('PERFORMANCE_SAVE_TIME_REQUIRED','Retain the original save timestamp.');
  const prepared=await preparePerformanceReview({inputs,originals});
  if(prepared.review.performanceSha256!==performanceSha256)
    fail('PERFORMANCE_REVIEW_CHANGED','The complete source differs from the reviewed performance calculation.',409);
  const request={requestId,label,performanceSha256,inputs:prepared.inputs};
  const record={schema:PERFORMANCE_RECORD_SCHEMA,performanceId:requestId,requestId,requestSha256:fingerprint(request),
    label,savedAt,inputs:prepared.inputs,review:prepared.review};
  const value={schema:PERFORMANCE_SOURCE_SCHEMA,record,originals:copy(originals)};
  const source={...value,id:fingerprint(value)};
  if(encode(source).length>PERFORMANCE_MAX_BYTES)
    fail('PERFORMANCE_SOURCE_LIMIT','The complete saved performance exceeds the original 48 MiB material limit.',413);
  return source;
}
/** Read-only full original-source preflight, also used by Commercial after independent receiving. */
export async function inspectPerformanceSource(raw){
  exact(raw,['schema','id','record','originals'],'saved performance source');
  if(raw.schema!==PERFORMANCE_SOURCE_SCHEMA||!HASH.test(raw.id??'')||encode(raw).length>PERFORMANCE_MAX_BYTES)
    fail('PERFORMANCE_SOURCE_INVALID','Receive the complete original saved performance source.');
  const {id,...value}=raw;same(id,fingerprint(value),'Complete performance source identity');
  const record=raw.record;
  exact(record,['schema','performanceId','requestId','requestSha256','label','savedAt','inputs','review'],'saved performance record');
  uuid(record.performanceId,'Performance');uuid(record.requestId,'Performance request');
  if(record.schema!==PERFORMANCE_RECORD_SCHEMA||record.performanceId!==record.requestId||
      record.label!==performanceLabel(record.label)||typeof record.savedAt!=='string'||
      !Number.isFinite(Date.parse(record.savedAt))||new Date(record.savedAt).toISOString()!==record.savedAt)
    fail('PERFORMANCE_RECORD_INVALID','Keep the original immutable performance record and request.');
  const prepared=await preparePerformanceReview({inputs:record.inputs,originals:raw.originals});
  same(prepared.inputs,record.inputs,'Normalized performance inputs');same(prepared.review,record.review,'Complete performance review');
  const request={requestId:record.requestId,label:record.label,performanceSha256:record.review.performanceSha256,inputs:record.inputs};
  same(record.requestSha256,fingerprint(request),'Original performance request');
  return {id,record:copy(record),review:copy(record.review),files:completeFileIndex(raw.originals)};
}
