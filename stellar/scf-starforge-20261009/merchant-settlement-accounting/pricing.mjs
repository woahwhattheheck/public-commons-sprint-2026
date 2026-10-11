// MIT. Original saved SF97 pricing report -> original merchant accounting terms.
import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import {lstat,mkdir,open} from 'node:fs/promises';
import {isAbsolute,join,resolve} from 'node:path';
import {compileTerms} from './reconcile.mjs';

export const PRICING_IMPORT_SCHEMA='stellar-forge.merchant-pricing-import.v1';
export const MAX_PRICING_REPORT_BYTES=64*1024*1024;
export const MAX_ACCOUNTING_TERMS_BYTES=200_000;
const REPORT_SCHEMA='stellar-forge.merchant-revenue-ops.v1';
const TERMS_SCHEMA='stellar-forge.merchant-accounting-terms.v1';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=value=>JSON.stringify(value,null,2)+'\n';
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const hex64=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const basis=value=>typeof value==='string'&&/^[A-Za-z0-9 _.:/-]{3,100}$/.test(value);
const date=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
const own=(value,key)=>Object.hasOwn(value,key);

export class PricingImportError extends Error {
  constructor(code,message,details={}){super(message);this.code=code;this.details=details;}
}
function check(ok,code,message,details){
  if(!ok)throw new PricingImportError(code,message,details);
}
function originalReport(report){
  check(object(report)&&report.schema===REPORT_SCHEMA&&Array.isArray(report.routes)&&
    report.routes.length>0&&object(report.overview)&&object(report.sourceSha256),
    'ORIGINAL_PRICING_REPORT_REQUIRED','Choose the original saved SF97 report/report.json, not its merchant terms file.');
  check(typeof report.merchantName==='string'&&report.merchantName.length>0&&
    report.merchantName.length<=160&&date(report.generatedAt)&&
    date(report.observedFrom)&&date(report.observedUntil),
    'INVALID_PRICING_REPORT','The original report is missing its merchant or observation identity.');
  for(const key of ['seller','terms','snapshot'])
    check(hex64(report.sourceSha256[key]),'MISSING_PRICING_SOURCE_HASH','The original report must retain its '+key+' source hash.');
  const kind=report.observationKind??'SESSION';
  check(['SESSION','DURABLE_HISTORY'].includes(kind),'INVALID_OBSERVATION_KIND','Unsupported pricing observation kind.');
  if(kind==='DURABLE_HISTORY'){
    check(hex64(report.sourceSha256.history)&&report.sourceSha256.history===report.sourceSha256.snapshot&&
      object(report.usageHistory)&&object(report.usageHistory.range),
      'INVALID_HISTORY_SOURCE','The retained-period report must preserve its original history identity and range.');
  }
  check(report.overview.routeCount===report.routes.length,'INVALID_PRICING_REPORT','The report route count differs from its original rows.');
  return kind;
}

/**
 * Preserve source ordering and map every quoted alternative through compileTerms.
 * The reference is an explicit short accounting label; full original price bases
 * remain in pricingProvenance. No exchange rate or cost allocation is calculated.
 */
export function createAccountingTermsFromPricingReport(report,{accountingReference,reportSha256=null}={}){
  const kind=originalReport(report);
  if(accountingReference!==undefined)
    check(basis(accountingReference),'INVALID_ACCOUNTING_REFERENCE','Use an accounting reference of 3–100 letters, numbers, spaces, or _ . : / -.');
  check(reportSha256===null||hex64(reportSha256),'INVALID_REPORT_HASH','The original report hash must be a SHA-256 hexadecimal digest.');
  const routes=[],sourceRoutes=[],seenRoutes=new Set();
  for(const [routeIndex,route] of report.routes.entries()){
    check(object(route)&&typeof route.routeId==='string'&&typeof route.method==='string'&&
      typeof route.path==='string'&&typeof route.priceBasis==='string'&&
      route.priceBasis.length>=4&&route.priceBasis.length<=300,
      'INVALID_PRICING_ROUTE','The original pricing route is incomplete.',{routeIndex});
    const identity=route.routeId+'\n'+route.method;
    check(!seenRoutes.has(identity),'DUPLICATE_PRICING_ROUTE','The original report repeats a route and method.',{routeId:route.routeId,method:route.method});
    seenRoutes.add(identity);
    const priceBasis=accountingReference??route.priceBasis;
    check(basis(priceBasis),'ACCOUNTING_REFERENCE_REQUIRED',
      'The original price basis for '+route.routeId+' needs a short accounting reference. Supply --reference; its full original text will be retained.',
      {routeId:route.routeId,priceBasis:route.priceBasis});
    const options=own(route,'paymentOptions')?route.paymentOptions:object(route.payment)?[route.payment]:null;
    check(Array.isArray(options)&&options.length>0,'MISSING_PAYMENT_OPTIONS',
      'The original report must retain every payment option for '+route.routeId+'.',{routeId:route.routeId});
    for(const [optionIndex,option] of options.entries()){
      const details={routeId:route.routeId,method:route.method,optionIndex};
      check(object(option)&&option.scheme==='exact','UNSUPPORTED_PAYMENT_OPTION',
        'Only the original exact Stellar payment options can be imported.',details);
      const term={routeId:route.routeId,method:route.method,network:option.network,
        asset:option.asset,payTo:option.payTo,amountAtomic:option.atomicAmount,
        priceBasis,unitPriceUsd:route.quoteUsd,unitCostUsd:route.variablePerFulfilledUsd};
      try{compileTerms({schema:TERMS_SCHEMA,routes:[term]});}
      catch(error){throw new PricingImportError('UNSUPPORTED_PAYMENT_OPTION',
        'Accounting cannot import '+route.routeId+' option '+(optionIndex+1)+': '+error.message,
        {...details,reason:error.message});}
      routes.push(term);
      check(routes.length<=200,'TOO_MANY_ACCOUNTING_OPTIONS',
        'The original accounting engine accepts at most 200 payment options. No options were dropped.');
    }
    sourceRoutes.push({reportRouteIndex:routeIndex,routeId:route.routeId,method:route.method,path:route.path,
      paymentOptionCount:options.length,priceBasis:route.priceBasis,
      quoteUsd:route.quoteUsd,variablePerFulfilledUsd:route.variablePerFulfilledUsd,
      perChallengeUsd:route.perChallengeUsd,paidTargetMonth:route.paidTargetMonth,
      plannedMonthlyTargetGrossUsd:route.plannedMonthlyTargetGrossUsd,
      plannedMonthlyTargetVariableCostUsd:route.plannedMonthlyTargetVariableCostUsd,
      plannedMonthlyTargetContributionBeforeFixedUsd:route.plannedMonthlyTargetContributionBeforeFixedUsd});
  }
  if(own(report.overview,'paymentOptionCount'))
    check(report.overview.paymentOptionCount===routes.length,'INVALID_PRICING_OPTION_COUNT',
      'The report payment-option count differs from its retained options.');
  const terms={schema:TERMS_SCHEMA,routes,pricingProvenance:{
    schema:PRICING_IMPORT_SCHEMA,reportSchema:report.schema,reportSha256,
    merchantName:report.merchantName,generatedAt:report.generatedAt,
    observationKind:kind,originalSellerMode:report.originalSellerMode??'UNKNOWN',
    observedFrom:report.observedFrom,observedUntil:report.observedUntil,
    sessionId:report.sessionId??null,sessionIds:structuredClone(report.sessionIds??(report.sessionId?[report.sessionId]:[])),
    sourceSha256:structuredClone(report.sourceSha256),
    range:kind==='DURABLE_HISTORY'?structuredClone(report.usageHistory.range):null,
    accountingReference:accountingReference??null,
    overview:structuredClone(report.overview),routes:sourceRoutes,
    allocation:{unitQuote:'ORIGINAL_ROUTE_QUOTE',unitVariableCost:'ORIGINAL_PER_FULFILLED_COST',
      monthlyFixedCostsAllocated:false,challengeCostsAllocated:false,monthlyTargetsBecomeSettlements:false}
  }};
  try{compileTerms(terms);}
  catch(error){throw new PricingImportError('INCOMPATIBLE_ACCOUNTING_TERMS',
    'The complete pricing selection cannot be imported: '+error.message,{reason:error.message});}
  check(Buffer.byteLength(json(terms))<=MAX_ACCOUNTING_TERMS_BYTES,'ACCOUNTING_TERMS_TOO_LARGE',
    'The complete terms and retained pricing context exceed the original accounting input limit of 200 KB.');
  return terms;
}

export function preparePricingReportImport(originalBytes,{accountingReference}={}){
  check(typeof originalBytes==='string'||originalBytes instanceof Uint8Array,
    'ORIGINAL_REPORT_BYTES_REQUIRED','Provide the original saved report bytes or UTF-8 JSON text.');
  const reportBytes=Buffer.from(originalBytes);
  check(reportBytes.length>0&&reportBytes.length<=MAX_PRICING_REPORT_BYTES,'PRICING_REPORT_TOO_LARGE',
    'Choose an original saved pricing report up to 64 MiB.');
  let report;
  try{report=JSON.parse(reportBytes.toString('utf8'));}
  catch{throw new PricingImportError('INVALID_REPORT_JSON','The selected pricing report is not valid JSON.');}
  const reportSha256=hash(reportBytes);
  const terms=createAccountingTermsFromPricingReport(report,{accountingReference,reportSha256});
  const termsBytes=Buffer.from(json(terms)),termsSha256=hash(termsBytes);
  return {terms,reportBytes,termsBytes,reportSha256,termsSha256,summary:{
    merchantName:report.merchantName,observationKind:terms.pricingProvenance.observationKind,
    observedFrom:report.observedFrom,observedUntil:report.observedUntil,
    sourceSha256:structuredClone(report.sourceSha256),range:structuredClone(terms.pricingProvenance.range),
    routes:report.routes.length,paymentOptions:terms.routes.length,
    unknownUnitCostOptions:terms.routes.filter(term=>term.unitCostUsd===null).length,
    accountingReference:accountingReference??null,reportBytes:reportBytes.length,termsBytes:termsBytes.length
  }};
}

function absolute(path,label){
  check(typeof path==='string'&&isAbsolute(path)&&resolve(path)===path&&path!=='/',
    'ABSOLUTE_NORMALIZED_PATH_REQUIRED','Use an absolute normalized '+label+' path.');
}
async function readReport(path){
  absolute(path,'report');
  const handle=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
  try{
    const info=await handle.stat();
    check(info.isFile()&&info.size>0&&info.size<=MAX_PRICING_REPORT_BYTES,'INVALID_REPORT_FILE',
      'The pricing report must be a nonempty regular file up to 64 MiB.');
    const bytes=Buffer.alloc(info.size);let offset=0;
    while(offset<bytes.length){
      const result=await handle.read(bytes,offset,bytes.length-offset,offset);
      check(result.bytesRead>0,'REPORT_CHANGED','The saved report was truncated while being read.');
      offset+=result.bytesRead;
    }
    const after=await handle.stat();
    check(after.size===info.size&&after.mtimeMs===info.mtimeMs,'REPORT_CHANGED',
      'The saved report changed while being read. Choose its completed immutable version.');
    return bytes;
  }finally{await handle.close();}
}
async function writeNew(path,bytes){
  const handle=await open(path,'wx',0o600);
  try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}
}

export async function writePricingReportImport({reportFile,outputDirectory,accountingReference}){
  absolute(outputDirectory,'new output directory');
  absolute(reportFile,'report');
  check(reportFile!==outputDirectory&&!reportFile.startsWith(outputDirectory+'/'),'OVERLAPPING_IMPORT_PATHS',
    'Keep the original saved report outside the new import directory.');
  const prepared=preparePricingReportImport(await readReport(reportFile),{accountingReference});
  // Validate everything before creating output. Existing directories and files
  // are never replaced; an interrupted partial directory is retained for review.
  await mkdir(outputDirectory,{mode:0o700});
  const directory=await lstat(outputDirectory);
  check(directory.isDirectory()&&!directory.isSymbolicLink()&&!(directory.mode&0o077),
    'PRIVATE_OUTPUT_REQUIRED','The new import directory must have private mode 0700.');
  await writeNew(join(outputDirectory,'pricing-report.json'),prepared.reportBytes);
  await writeNew(join(outputDirectory,'accounting-terms.json'),prepared.termsBytes);
  const manifest={schema:PRICING_IMPORT_SCHEMA,summary:prepared.summary,
    outputs:[
      {name:'pricing-report.json',bytes:prepared.reportBytes.length,sha256:prepared.reportSha256},
      {name:'accounting-terms.json',bytes:prepared.termsBytes.length,sha256:prepared.termsSha256}
    ]};
  const manifestBytes=Buffer.from(json(manifest));
  await writeNew(join(outputDirectory,'manifest.json'),manifestBytes);
  const handle=await open(outputDirectory,'r');
  try{await handle.sync();}finally{await handle.close();}
  return {schema:PRICING_IMPORT_SCHEMA,output:outputDirectory,
    termsFile:join(outputDirectory,'accounting-terms.json'),
    reportSha256:prepared.reportSha256,termsSha256:prepared.termsSha256,
    manifestSha256:hash(manifestBytes),...prepared.summary};
}
