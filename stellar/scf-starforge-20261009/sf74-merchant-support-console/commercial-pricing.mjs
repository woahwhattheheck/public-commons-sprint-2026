// MIT. Exact selected SF97 source receiving for the original SF74 case.
import {createHash} from 'node:crypto';
import {createScenarioReview} from '../sf97-merchant-revenue-ops/planning/scenarios.mjs';

export const PRICING_SOURCE_SCHEMA='stellar-forge.merchant-commercial-pricing-source.v1';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const HASH=/^[a-f0-9]{64}$/;
export const canonical=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
export const sha256=value=>createHash('sha256').update(value).digest('hex');
export const jsonBytes=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
export const commercialError=(code,message,status=422)=>Object.assign(new Error(message),{code,status});
const fail=(code,message)=>{throw commercialError(code,message);};
const copy=value=>JSON.parse(JSON.stringify(value));
const plain=value=>value&&typeof value==='object'&&!Array.isArray(value);
function originalFile(name,body) {
  const bytes=Buffer.from(body),text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  if(!Buffer.from(text).equals(bytes))fail('PRICING_SOURCE_ENCODING','Keep the original UTF-8 pricing files.');
  return {name,bytes:bytes.length,sha256:sha256(bytes),text};
}
function withoutGeneratedAt(review){const value=copy(review);delete value.generatedAt;return value;}
function sourceIdentity(value) {
  return sha256(canonical({schema:value.schema,planId:value.planId,scenarioId:value.scenarioId,
    version:value.version,files:value.files.map(({name,bytes,sha256})=>({name,bytes,sha256}))}));
}
/** This uses the original configured model and planning reader, with no capture or save. */
export async function captureCommercialPricingSource({model,planning,planId,scenarioId}={}) {
  if(!model?.download||!planning?.load||!planning?.download||!UUID.test(planId??''))
    fail('PRICING_READER_REQUIRED','Use the original saved pricing workspace and plan.');
  const plan=await planning.load(planId);
  const manifestBytes=await model.download(plan.version,'manifest.json');
  const manifest=JSON.parse(Buffer.from(manifestBytes).toString('utf8'));
  const sourceFile=manifest.sourceFile??'snapshot.json';
  if(!['snapshot.json','history.json'].includes(sourceFile))fail('PRICING_OBSERVATION_CHANGED','Use the original saved observation member.');
  const selected=scenarioId??plan.selectedScenarioId??'baseline';
  const files=[originalFile('plan.json',await planning.download(planId,'plan.json')),
    originalFile('manifest.json',manifestBytes)];
  for(const name of ['seller.json','terms.json',sourceFile])files.push(originalFile(name,await model.download(plan.version,name)));
  const value={schema:PRICING_SOURCE_SCHEMA,planId,scenarioId:selected,version:plan.version,files};
  value.id=sourceIdentity(value);
  inspectCommercialPricingSource(value);
  return value;
}
/** Verify complete retained inputs and reproduce the original saved scenario review. */
export function inspectCommercialPricingSource(value) {
  if(!plain(value)||Object.keys(value).some(k=>!['schema','id','planId','scenarioId','version','files'].includes(k))||
      value.schema!==PRICING_SOURCE_SCHEMA||!HASH.test(value.id??'')||!UUID.test(value.planId??'')||
      !UUID.test(value.version??'')||typeof value.scenarioId!=='string'||!Array.isArray(value.files)||value.files.length!==5)
    fail('PRICING_SOURCE_INVALID','Receive the complete selected source from the original pricing workspace.');
  const files=new Map();
  for(const row of value.files) {
    if(!plain(row)||Object.keys(row).some(k=>!['name','bytes','sha256','text'].includes(k))||
        typeof row.name!=='string'||files.has(row.name)||!Number.isSafeInteger(row.bytes)||row.bytes<1||
        !HASH.test(row.sha256??'')||typeof row.text!=='string')
      fail('PRICING_FILE_INVALID','The original pricing file descriptor is incomplete.');
    const bytes=Buffer.from(row.text);
    if(bytes.length!==row.bytes||sha256(bytes)!==row.sha256)fail('PRICING_FILE_CHANGED','An original pricing file differs from its retained bytes.');
    files.set(row.name,{...row,value:JSON.parse(row.text)});
  }
  if(sourceIdentity(value)!==value.id)fail('PRICING_SOURCE_CHANGED','The selected source identity changed.');
  const plan=files.get('plan.json')?.value,manifest=files.get('manifest.json')?.value;
  if(plan?.schema!=='stellar-forge.merchant-scenario-plan.v1'||plan.planId!==value.planId||plan.version!==value.version||
      manifest?.schema!=='stellar-forge.merchant-pricing-version.v1'||manifest.version!==value.version)
    fail('PRICING_SOURCE_BINDING','Use the original plan and its saved pricing version together.');
  const sourceFile=manifest.sourceFile??'snapshot.json';
  const expected=['plan.json','manifest.json','seller.json','terms.json',sourceFile];
  if(!['snapshot.json','history.json'].includes(sourceFile)||expected.some(n=>!files.has(n)))
    fail('PRICING_SOURCE_FILES','Keep the original seller, terms and observation with the saved plan.');
  for(const name of ['seller.json','terms.json',sourceFile]) {
    const row=files.get(name),descriptor=manifest.files?.[name];
    if(!descriptor||descriptor.bytes!==row.bytes||descriptor.sha256!==row.sha256)
      fail('PRICING_MANIFEST_CHANGED','A source file differs from the original saved pricing manifest.');
  }
  const seller=files.get('seller.json').value,terms=files.get('terms.json').value,observation=files.get(sourceFile).value;
  const provenance={seller:files.get('seller.json').sha256,terms:files.get('terms.json').sha256,
    snapshot:files.get(sourceFile).sha256,...(sourceFile==='history.json'?{history:files.get(sourceFile).sha256}:{})};
  if(manifest.sellerSha256!==provenance.seller||manifest.snapshotSha256!==provenance.snapshot||
      canonical(plan.source)!==canonical(provenance))
    fail('PRICING_PROVENANCE_CHANGED','The original plan points at different pricing source bytes.');
  const review=createScenarioReview({seller,observation,terms,scenarios:plan.inputs?.scenarios,
    provenance,includeReports:false});
  if(canonical(withoutGeneratedAt(review))!==canonical(withoutGeneratedAt(plan.review)))
    fail('PRICING_REVIEW_CHANGED','The retained comparison does not match its original source-native review.');
  const request={version:plan.version,scenarios:plan.inputs.scenarios,label:plan.label,
    selectedScenarioId:plan.selectedScenarioId??null,reviewSha256:review.reviewSha256};
  if(sha256(canonical(request))!==plan.requestSha256)fail('PRICING_PLAN_REQUEST_CHANGED','The original scenario save request changed.');
  const selected=value.scenarioId==='baseline'?review.baseline:review.scenarios.find(r=>r.id===value.scenarioId);
  if(!selected)fail('PRICING_SCENARIO_NOT_FOUND','Choose a scenario retained in this original plan.');
  return {id:value.id,planId:value.planId,scenarioId:value.scenarioId,version:value.version,
    title:plan.label+' / '+selected.label,planLabel:plan.label,scenarioLabel:selected.label,sha256:value.id,reviewSha256:review.reviewSha256,
    summary:'Saved SF97 pricing scenario. Monthly volumes in the quotation are explicit assumptions.',
    rows:selected.metrics.routes.map(row=>({id:row.routeId,routeId:row.routeId,
      title:row.method+' '+row.path,unitUsd:row.quoteUsd,monthlyRequests:String(row.paidTargetMonth)})),
    seller,observation,terms,provenance,plan,selected,source:value};
}
/** Route totals stay in SF97; this adapter supplies only the quoted monthly volume. */
export function reviewCommercialUsage(source,routes) {
  const original=inspectCommercialPricingSource(source),selected=original.selected;
  if(!Array.isArray(routes)||routes.length!==selected.metrics.routes.length)
    fail('QUOTED_ROUTES_REQUIRED','Enter one explicit monthly request volume for every selected pricing route.');
  const expected=new Set(selected.metrics.routes.map(r=>r.routeId)),patch={};
  for(const row of routes) {
    if(!plain(row)||Object.keys(row).some(k=>!['routeId','monthlyRequests'].includes(k))||
        !expected.has(row.routeId)||Object.hasOwn(patch,row.routeId)||typeof row.monthlyRequests!=='string'||
        !/^(0|[1-9]\d*)$/.test(row.monthlyRequests)||!Number.isSafeInteger(Number(row.monthlyRequests)))
      fail('QUOTED_VOLUME_INVALID','Keep route identities and nonnegative whole monthly request volumes.');
    patch[row.routeId]={monthlyPaidTarget:Number(row.monthlyRequests)};
  }
  const selectedTerms=selected.terms;
  const provenance={...original.provenance,terms:sha256(jsonBytes(selectedTerms)),
    planningSourceTerms:original.provenance.terms,planId:original.planId,scenarioId:original.scenarioId};
  const review=createScenarioReview({seller:original.seller,observation:original.observation,
    terms:selectedTerms,scenarios:[{id:'customer-quote-volume',label:'Quoted monthly usage',routes:patch}],
    provenance,includeReports:false});
  const row=review.scenarios[0];
  return {review,metrics:row.metrics,terms:row.terms,
    lines:row.metrics.routes.map(r=>({id:r.routeId,routeId:r.routeId,title:r.method+' '+r.path,
      kind:'ROUTE_USAGE',quantity:String(r.paidTargetMonth),unitUsd:r.quoteUsd,amountUsd:r.plannedGrossUsd,
      sourcePlanId:original.planId,sourceScenarioId:original.scenarioId})),
    grossUsd:row.metrics.grossUsd};
}
