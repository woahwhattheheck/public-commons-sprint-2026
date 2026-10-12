// MIT. Retained native tariff assumptions for the original merchant quotation.
import {inspectTariffPortfolio} from '../../sf97-merchant-revenue-ops/tariffs/workspace.mjs';
import {createTariffReview} from '../../sf97-merchant-revenue-ops/tariffs/model.mjs';
import {inspectCommercialPricingSource,reviewCommercialUsage,canonical,sha256,jsonBytes,commercialError} from '../commercial-pricing.mjs';
import {MAX_MATERIAL_BYTES,commissioningFileBytes} from '../commissioning.mjs';

export const COMMERCIAL_TARIFF_SOURCE_SCHEMA='stellar-forge.merchant-commercial-tariff-source.v1';
export const COMMERCIAL_TARIFF_MATERIAL_KIND='commercial-tariff-source';
const HASH=/^[a-f0-9]{64}$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const FILES=['tariff-portfolio.json','saved-pricing-manifest.json'];
const copy=value=>JSON.parse(JSON.stringify(value));
const plain=value=>value&&typeof value==='object'&&!Array.isArray(value);
const fail=(code,message,status=422)=>{throw commercialError(code,message,status);};
function exact(value,keys,label){
  if(!plain(value)||Object.keys(value).some(key=>!keys.includes(key)))
    fail('COMMERCIAL_TARIFF_SOURCE_INVALID','Keep the complete original '+label+'.');
}
function same(left,right,code='COMMERCIAL_TARIFF_SOURCE_CHANGED'){
  if(canonical(left)!==canonical(right))fail(code,'The selected tariff differs from its original pricing source.',409);
}
function file(name,body){
  const bytes=Buffer.from(body),text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  if(!Buffer.from(text).equals(bytes))fail('COMMERCIAL_TARIFF_ENCODING','Keep the original UTF-8 tariff files.');
  return {name,bytes:bytes.length,sha256:sha256(bytes),text};
}
function identity(value){
  return sha256(canonical({schema:value.schema,pricingSourceId:value.pricingSourceId,
    receivingSourceSha256:value.receivingSourceSha256,selectionRequestId:value.selectionRequestId,
    tariffPlanId:value.tariffPlanId,comparisonId:value.comparisonId,
    files:value.files.map(({name,bytes,sha256})=>({name,bytes,sha256}))}));
}
/** Read one completed native selection. The original pricing and tariff writers stay authoritative. */
export async function captureCommercialTariffSource({tariffs,model,pricingSource,receivingSourceSha256,selectionRequestId}={}){
  if(!tariffs?.bundle||!tariffs?.inspectPortfolio||!model?.download||!UUID.test(selectionRequestId??'')||
      !HASH.test(receivingSourceSha256??''))
    fail('COMMERCIAL_TARIFF_READER_REQUIRED','Open the original tariff and pricing workspace and choose its saved selection UUID.');
  const pricing=inspectCommercialPricingSource(pricingSource);
  const portfolio=await tariffs.bundle({selectionRequestId});
  const checked=await tariffs.inspectPortfolio(portfolio);
  if(checked.plans.length!==1||checked.selections.length!==1)
    fail('COMMERCIAL_TARIFF_SELECTION_REQUIRED','Receive the exact original selected tariff comparison.');
  const selection=checked.selections[0];
  if(selection.id!==selectionRequestId||selection.result?.status!=='TARIFF_SELECTION_SAVED')
    fail('COMMERCIAL_TARIFF_SELECTION_INCOMPLETE','Finish or reopen the original tariff scenario and pricing save before receiving its quotation basis.',409);
  const record=checked.plans[0];
  const pricingManifest=await model.download(selection.result.pricing.version,'manifest.json');
  const value={schema:COMMERCIAL_TARIFF_SOURCE_SCHEMA,pricingSourceId:pricing.id,receivingSourceSha256,
    selectionRequestId,tariffPlanId:record.planId,comparisonId:selection.intent.selection.comparisonId,
    files:[file(FILES[0],jsonBytes(portfolio)),file(FILES[1],pricingManifest)]};
  value.id=identity(value);
  if(jsonBytes(value).length>MAX_MATERIAL_BYTES)
    fail('COMMERCIAL_TARIFF_MATERIAL_LIMIT','This selected native tariff source exceeds the original implementation material limit.');
  await inspectCommercialTariffSource(value,{pricingSource});
  return value;
}
/** Reuse the original portfolio preflight with the exact retained pricing files; no workspace is opened or written. */
export async function inspectCommercialTariffSource(value,{pricingSource}={}){
  exact(value,['schema','id','pricingSourceId','receivingSourceSha256','selectionRequestId','tariffPlanId','comparisonId','files'],'tariff source');
  if(value.schema!==COMMERCIAL_TARIFF_SOURCE_SCHEMA||!HASH.test(value.id??'')||
      !HASH.test(value.pricingSourceId??'')||!HASH.test(value.receivingSourceSha256??'')||
      !UUID.test(value.selectionRequestId??'')||!UUID.test(value.tariffPlanId??'')||
      !HASH.test(value.comparisonId??'')||!Array.isArray(value.files)||value.files.length!==FILES.length)
    fail('COMMERCIAL_TARIFF_SOURCE_INVALID','Receive the complete selected tariff source and its original pricing files.');
  const pricing=inspectCommercialPricingSource(pricingSource);
  if(pricing.id!==value.pricingSourceId)fail('COMMERCIAL_TARIFF_PRICING_CHANGED','Reopen the pricing source selected by this tariff.');
  const files=new Map();
  for(const row of value.files){
    exact(row,['name','bytes','sha256','text'],'tariff file descriptor');
    if(!FILES.includes(row.name)||files.has(row.name)||typeof row.text!=='string'||
        !Number.isSafeInteger(row.bytes)||row.bytes<1||row.bytes>MAX_MATERIAL_BYTES||!HASH.test(row.sha256??''))
      fail('COMMERCIAL_TARIFF_FILE_INVALID','Keep both complete original tariff files.');
    const bytes=Buffer.from(row.text);
    if(bytes.length!==row.bytes||sha256(bytes)!==row.sha256)
      fail('COMMERCIAL_TARIFF_FILE_CHANGED','A retained tariff file differs from its original bytes.');
    files.set(row.name,{...row,value:JSON.parse(row.text)});
  }
  if(identity(value)!==value.id)fail('COMMERCIAL_TARIFF_SOURCE_CHANGED','The complete tariff source identity changed.',409);
  const portfolio=files.get(FILES[0]).value;
  if(!Array.isArray(portfolio.plans)||portfolio.plans.length!==1||
      !Array.isArray(portfolio.selections)||portfolio.selections.length!==1)
    fail('COMMERCIAL_TARIFF_SELECTION_REQUIRED','Keep one complete original tariff plan and its selected native request.');
  const record=portfolio.plans[0],selection=portfolio.selections[0],intent=selection.intent;
  if(record.planId!==value.tariffPlanId||selection.id!==value.selectionRequestId||
      intent?.selection?.planId!==value.tariffPlanId||intent.selection.comparisonId!==value.comparisonId||
      selection.result?.status!=='TARIFF_SELECTION_SAVED'||
      intent.scenarioRequest?.requestId!==pricing.planId||
      intent.scenarioRequest?.selectedScenarioId!==pricing.scenarioId||record.version!==pricing.version)
    fail('COMMERCIAL_TARIFF_SELECTION_CHANGED','Keep the exact tariff comparison, scenario and completed pricing operation together.',409);
  const originalManifest=pricing.source.files.find(row=>row.name==='manifest.json');
  const savedManifest=files.get(FILES[1]);
  if(savedManifest.value.schema!=='stellar-forge.merchant-pricing-version.v1')
    fail('COMMERCIAL_TARIFF_PRICING_CHANGED','Keep the original completed pricing manifest.');
  const manifestValue=JSON.parse(originalManifest.text);
  const manifests=new Map([[pricing.version,Buffer.from(originalManifest.text)]]);
  if(manifests.has(savedManifest.value.version))
    same(sha256(manifests.get(savedManifest.value.version)),savedManifest.sha256);
  manifests.set(savedManifest.value.version,Buffer.from(savedManifest.text));
  const sourceValue={version:pricing.version,label:manifestValue.label,savedAt:manifestValue.savedAt,
    seller:pricing.seller,observation:pricing.observation,terms:pricing.terms,provenance:pricing.provenance};
  await inspectTariffPortfolio(portfolio,{
    pricingSource:async version=>{
      if(version!==pricing.version)fail('COMMERCIAL_TARIFF_PRICING_CHANGED','The tariff portfolio requests a different original source version.');
      return sourceValue;
    },
    scenarioPlan:async planId=>{
      if(planId!==pricing.planId)fail('COMMERCIAL_TARIFF_PLAN_CHANGED','The tariff portfolio requests a different original scenario.');
      return pricing.plan;
    },
    pricingManifest:async version=>{
      const bytes=manifests.get(version);
      if(!bytes)fail('COMMERCIAL_TARIFF_PRICING_CHANGED','A complete original pricing manifest is missing.');
      return bytes;
    },
  });
  const comparison=record.review.comparisons.find(row=>row.id===value.comparisonId);
  const tariff=record.review.tariffs.find(row=>row.id===comparison.tariffId);
  if(!tariff)fail('COMMERCIAL_TARIFF_SOURCE_CHANGED','The selected comparison is missing its original tariff.');
  return {id:value.id,pricingSourceId:value.pricingSourceId,receivingSourceSha256:value.receivingSourceSha256,
    tariffPlanId:record.planId,planLabel:record.label,comparisonId:comparison.id,
    selectionRequestId:selection.id,selectedAt:intent.createdAt,
    scenarioPlanId:pricing.planId,scenarioId:pricing.scenarioId,sourceVersion:pricing.version,
    pricingVersion:selection.result.pricing.version,routeId:comparison.routeId,
    tariffId:tariff.id,tariffLabel:tariff.label,mode:tariff.mode,tiers:copy(tariff.tiers),
    selectedQuantity:comparison.quantity,tariffGrossUsd:comparison.quote.totalUsd,
    uniformUnitUsd:comparison.quote.chosenUniformQuoteUsd,uniformGrossUsd:comparison.quote.uniformGrossUsd,
    roundingDeltaUsd:comparison.quote.roundingDeltaUsd,
    files:value.files.map(({name,bytes,sha256})=>({name,bytes,sha256})),
    comparison:copy(comparison),source:value,portfolio,pricing};
}
export function commercialTariffSummary(value){
  const {source,portfolio,pricing,comparison,...summary}=value;
  return {...summary,comparison:copy(comparison)};
}
/** A later volume uses the original calculator while the saved uniform quote remains explicit. */
export function reviewCommercialTariffUsage(selected,monthlyRequests){
  if(!selected?.source||!selected?.portfolio||!selected?.pricing||
      typeof monthlyRequests!=='string'||!/^(0|[1-9]\d*)$/.test(monthlyRequests)||
      !Number.isSafeInteger(Number(monthlyRequests)))
    fail('COMMERCIAL_TARIFF_VOLUME_INVALID','Enter the explicit whole monthly request quantity.');
  const record=selected.portfolio.plans[0];
  const tariff=record.inputs.tariffs.find(row=>row.id===selected.tariffId);
  const pricing=selected.pricing;
  const review=createTariffReview({seller:pricing.seller,observation:pricing.observation,terms:pricing.terms,
    tariffs:[tariff],volumes:[monthlyRequests],provenance:pricing.provenance});
  const original=reviewCommercialUsage(pricing.source,pricing.rows.map(row=>({
    routeId:row.routeId,monthlyRequests:row.routeId===selected.routeId?monthlyRequests:row.monthlyRequests})));
  const quoted=original.lines.find(row=>row.routeId===selected.routeId);
  return {schema:'stellar-forge.merchant-commercial-tariff-usage-review.v1',tariffSourceId:selected.id,
    pricingSourceId:pricing.id,monthlyRequests,selectedQuantity:selected.selectedQuantity,
    changedQuantity:monthlyRequests!==selected.selectedQuantity,savedUniformQuote:copy(quoted),
    selectedComparison:copy(selected.comparison),review,comparison:copy(review.comparisons[0])};
}
export function renderCommercialTariffBasis(selected,{monthlyRequests=selected.selectedQuantity}={}){
  const review=reviewCommercialTariffUsage(selected,monthlyRequests),comparison=review.comparison;
  return {sourceId:selected.id,label:selected.planLabel,tariffLabel:selected.tariffLabel,mode:selected.mode,
    selectedQuantity:selected.selectedQuantity,quotedQuantity:monthlyRequests,
    uniformUnitUsd:selected.uniformUnitUsd,originalTariffGrossUsd:selected.tariffGrossUsd,
    originalRoundingDeltaUsd:selected.roundingDeltaUsd,
    tariffGrossAtQuotedQuantityUsd:comparison.quote.totalUsd,
    derivedUnitAtQuotedQuantityUsd:comparison.quote.chosenUniformQuoteUsd,
    changedQuantity:review.changedQuantity,
    text:'The uniform route rate of USD '+selected.uniformUnitUsd+' per request derives from '+
      selected.tariffLabel+' at '+selected.selectedQuantity+' requests. The original '+selected.mode+
      ' schedule totals USD '+selected.tariffGrossUsd+' at that quantity; upward unit rounding contributes USD '+
      selected.roundingDeltaUsd+'. This quotation uses '+monthlyRequests+' requests at the saved uniform rate.'};
}

export const COMMERCIAL_TARIFF_ATTACHMENT_SCHEMA='stellar-forge.merchant-commercial-tariff-attachment.v1';
export function inspectCommercialTariffAttachment(material,source){
  if(material.kind!==COMMERCIAL_TARIFF_MATERIAL_KIND)return null;
  const binding=JSON.parse(material.description);
  exact(binding,['schema','sourceId','pricingSourceId','receivingSourceSha256','selectionRequestId',
    'pricingRequestId','backupAttachmentRequestId','tariffAttachmentRequestId','bindingReason'],'tariff attachment');
  if(binding.schema!==COMMERCIAL_TARIFF_ATTACHMENT_SCHEMA||
      material.id!=='commercial-tariff:'+binding.tariffAttachmentRequestId||
      material.reference!=='urn:stellar-forge:commercial-pricing:'+binding.pricingSourceId||
      !UUID.test(binding.pricingRequestId??'')||!UUID.test(binding.backupAttachmentRequestId??'')||
      !UUID.test(binding.tariffAttachmentRequestId??'')||typeof binding.bindingReason!=='string'||
      !binding.bindingReason.trim()||binding.bindingReason.length>4000||
      [binding.pricingRequestId,binding.backupAttachmentRequestId,binding.tariffAttachmentRequestId].some(
        (id,index,all)=>all.indexOf(id)!==index))
    fail('COMMERCIAL_TARIFF_ATTACHMENT_CHANGED','The retained tariff material differs from its original attachment request.');
  same({sourceId:binding.sourceId,pricingSourceId:binding.pricingSourceId,
    receivingSourceSha256:binding.receivingSourceSha256,selectionRequestId:binding.selectionRequestId},
    {sourceId:source.id,pricingSourceId:source.pricingSourceId,
      receivingSourceSha256:source.receivingSourceSha256,selectionRequestId:source.selectionRequestId});
  return binding;
}
/** Complete original materials remain in the case; this selects their current, immutable tariff basis. */
export async function readCommercialTariffSources(state,pricingSources){
  const result=[];
  for(const material of state.materials.filter(row=>row.kind===COMMERCIAL_TARIFF_MATERIAL_KIND)){
    const bytes=Buffer.from(commissioningFileBytes(state,material.sha256));
    if(bytes.length>MAX_MATERIAL_BYTES||sha256(bytes)!==material.sha256)
      fail('COMMERCIAL_TARIFF_FILE_CHANGED','The original tariff material bytes changed.');
    const source=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    const pricing=pricingSources.find(row=>row.id===source.pricingSourceId);
    if(!pricing)fail('COMMERCIAL_TARIFF_PRICING_CHANGED','Receive the tariff material with its original case pricing source.');
    const inspected=await inspectCommercialTariffSource(source,{pricingSource:pricing.source});
    const binding=inspectCommercialTariffAttachment(material,source);
    const backup=state.materials.find(row=>row.id==='commercial-backup:'+binding.backupAttachmentRequestId);
    const backupBinding=backup?.kind==='commercial-pricing-workspace-backup'?JSON.parse(backup.description):null;
    if(!backupBinding||backupBinding.sourceSha256!==source.receivingSourceSha256||
        backupBinding.pricing?.sourceId!==source.pricingSourceId||
        backupBinding.pricingRequestId!==binding.pricingRequestId||
        backupBinding.attachmentRequestId!==binding.backupAttachmentRequestId)
      fail('COMMERCIAL_TARIFF_BACKUP_CHANGED','Keep this tariff selection with its original complete pricing backup.');
    result.push({...inspected,binding,material:{id:material.id,sha256:material.sha256,bytes:bytes.length},
      backup:{materialId:backup.id,sha256:backup.sha256,bytes:backupBinding.backup.bytes}});
  }
  result.sort((a,b)=>a.material.id<b.material.id?-1:a.material.id>b.material.id?1:0);
  return result;
}
