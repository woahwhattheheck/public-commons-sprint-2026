#!/usr/bin/env node
// MIT. One retained Potomac operation: original source, paired science, browser and MCP receiving.
import assert from 'node:assert/strict';
import { constants } from 'node:fs';
import { open, readFile, lstat } from 'node:fs/promises';
import { resolve, dirname, join, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { privateDirectory, readPrivateJson, atomicJson, withPrivateLock } from '../../routescan/quota.mjs';
import { writeBytes } from '../../../sf88-operator-buyer-cli/node/store.mjs';
import { openWaterQualityProject } from '../project.mjs';
import { openWatersHash, openWatersCanonical } from '../openwaters.mjs';
import { normalizeReviewSheetDocument } from '../review-sheet/model.mjs';
import { previewReviewSheet, saveReviewSheet, readReviewSheet } from '../review-sheet/workflow.mjs';
import { CONCENTRATION_RECEIVING_SCHEMA } from '../review-sheet/concentrations-receiving.mjs';
import { verifyStandardizedReview, readStandardizedReview, exportStandardizedReview } from './workflow.mjs';
import { normalizeStandardizedOptions } from './model.mjs';

export const SCIENTIFIC_RECEIVING_SCHEMA='starforge.wqx-scientific-receiving.v1';
export const SCIENTIFIC_FORMATS=Object.freeze(['json','observations','observations-tsv','groups','changes','report','bundle']);
const HERE=dirname(fileURLToPath(import.meta.url));
const json=value=>JSON.stringify(value,null,2)+'\n';
const hash=value=>createHash('sha256').update(value).digest('hex');
const equal=(a,b,message)=>assert.equal(openWatersCanonical(a),openWatersCanonical(b),message);
const gc=()=>globalThis.gc?.();
const transport={request:async()=>{throw new Error('This receiving operation uses the complete retained original capture.');}};
export async function scientificFile(path,maximum=128*1024*1024) {
  const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try {
    const before=await handle.stat({bigint:true});
    assert(before.isFile()&&before.nlink===1n&&!(Number(before.mode)&0o077)&&before.size<=BigInt(maximum),'Select a complete private original file.');
    const digest=createHash('sha256');let bytes=0;
    for await(const chunk of handle.createReadStream({autoClose:false})){bytes+=chunk.length;digest.update(chunk);}
    const after=await handle.stat({bigint:true}),named=await lstat(path,{bigint:true});
    for(const key of ['dev','ino','size','mtimeNs','ctimeNs'])assert.equal(after[key],before[key],'A retained original file changed.');
    assert(!named.isSymbolicLink()&&named.dev===before.dev&&named.ino===before.ino);
    return {file:path,bytes,sha256:digest.digest('hex')};
  } finally {await handle.close();}
}
export async function scientificJson(path,maximum=128*1024*1024) {
  try{return await readPrivateJson(path,maximum);}catch(error){if(error.code==='ENOENT')return null;throw error;}
}
export async function scientificRetain(path,value) {
  const bytes=Buffer.isBuffer(value)?value:Buffer.from(typeof value==='string'?value:json(value));
  await privateDirectory(dirname(path));
  try{await writeBytes(path,bytes,{exclusive:true});}
  catch(error){if(error.code!=='EEXIST')throw error;const old=await scientificFile(path);assert.equal(old.bytes,bytes.length);assert.equal(old.sha256,hash(bytes),'Retain the exact same original operation member.');}
  return scientificFile(path);
}
export async function scientificChild(path,args,heap=768) {
  await new Promise((yes,no)=>{
    const child=spawn(process.execPath,['--expose-gc','--max-old-space-size='+heap,path,...args],{stdio:'inherit',env:process.env});
    child.once('error',no);child.once('exit',(code,signal)=>code===0?yes():no(new Error('The original scientific phase ended: '+(signal??code))));
  });
}
export async function scientificSelection(configFile,expectedConfigSha256) {
  assert(/^[a-f0-9]{64}$/.test(expectedConfigSha256??''),'Bind the exact scientific receiving configuration.');
  const input=await scientificFile(resolve(configFile),1024*1024);assert.equal(input.sha256,expectedConfigSha256);
  const config=await scientificJson(input.file);
  assert.equal(config.schema,SCIENTIFIC_RECEIVING_SCHEMA);
  assert(Object.keys(config).every(key=>['schema','operationId','directory','sourceConfigurationFile','sourceConfigurationSha256'].includes(key)));
  assert(/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(config.operationId??''));
  for(const key of ['directory','sourceConfigurationFile'])assert(typeof config[key]==='string'&&isAbsolute(config[key])&&resolve(config[key])===config[key]&&config[key]!=='/');
  const originalFile=await scientificFile(config.sourceConfigurationFile,2*1024*1024);
  assert.equal(originalFile.sha256,config.sourceConfigurationSha256);
  const original=await scientificJson(originalFile.file);assert.equal(original.schema,CONCENTRATION_RECEIVING_SCHEMA);
  assert.equal(config.operationId,original.operationId+'-SCIENCE','Extend the same original receiving operation.');
  assert.equal(config.directory,join(original.directory,'scientific-receiving'));
  assert.equal(original.sourceResults,1035);assert.equal(original.originalLimits,1112);assert.equal(original.selectedResults,749);
  const root=await privateDirectory(config.directory);
  for(const name of ['cli','exports','browser','mcp'])await privateDirectory(join(root,name));
  const request={schema:SCIENTIFIC_RECEIVING_SCHEMA,configuration:config,configurationSha256:input.sha256,
    sourceConfigurationSha256:originalFile.sha256,sourceOperationId:original.operationId,
    sourcePlanSha256:original.sourcePlanSha256,reviewSha256:original.reviewSha256,captureSha256:original.captureSha256};
  const requestSha256=openWatersHash(request);
  await scientificRetain(join(root,'operation.json'),{...request,requestSha256});
  const ids={
    decision:original.reviewId+'-scientific',baselineDecision:original.reviewId+'-source-units',
    baselinePlan:original.sourcePlanId+'-source-units',baseline:'potomac-q1-original-science',
    current:'potomac-q1-reporting-science',period:'potomac-march-january-science',
    browser:'potomac-browser-reporting-science',mcp:'potomac-mcp-reporting-science'
  };
  for(const id of Object.values(ids))assert(id.length<=96);
  return {config,configFile:input.file,expectedConfigSha256,original,root,requestSha256,ids,
    author:join(original.directory,'project'),receiver:join(root,'received-project')};
}
export async function scientificReceipt(value,phase) {
  const record=await scientificJson(join(value.root,phase+'-result.json'));
  if(!record)return null;
  assert.equal(record.requestSha256,value.requestSha256);
  assert.equal(record.status,'COMPLETE');
  for(const file of record.files??[]){const actual=await scientificFile(file.file);assert.equal(actual.sha256,file.sha256);assert.equal(actual.bytes,file.bytes);}
  return record;
}
export async function completeScientificPhase(value,phase,details,files=[]) {
  const result={schema:SCIENTIFIC_RECEIVING_SCHEMA,operationId:value.config.operationId,requestSha256:value.requestSha256,
    phase,status:'COMPLETE',completedAt:new Date().toISOString(),...details,files};
  await scientificRetain(join(value.root,phase+'-result.json'),result);return result;
}
export function checkScientificCohort(record,{period=false,comparison=true}={}) {
  record=verifyStandardizedReview(record);
  const analysis=record.analysis,inventory=analysis.inventory;
  assert.equal(analysis.source.captureSha256,'cbb29504ab01598cddb21bde33c918ca92075aad7f53fdac4fb07581371d29d7');
  assert.equal(inventory.sourcePlanResults,1035);
  assert.equal(analysis.observations.length,period?418:1035);
  const native=analysis.original.inventory,reviewed=analysis.reviewed.inventory;
  for(const key of ['sourceRows','selectedRows','censored','qualified','estimated','arithmeticRows','excludedRows'])
    assert.equal(reviewed[key],native[key],'Reporting units retain original scientific inclusion: '+key);
  assert.equal(native.censored,period?207:452);assert.equal(native.qualified,period?62:146);
  assert.equal(native.estimated,period?5:10);assert.equal(native.arithmeticRows,period?140:413);
  assert.equal(inventory.convertedResults,period?311:749);
  assert.equal(inventory.convertedReportedLimits,period?480:1089);
  const blanks=analysis.observations.filter(row=>row.reporting.conversion&&row.value===''&&row.unit==='');
  assert.equal(blanks.length,period?207:451);
  assert(blanks.every(row=>row.reporting.value===''&&row.reporting.unit===''),'Blank non-detect values and unspecified units stay blank.');
  if(!period) {
    const silica=analysis.observations.find(row=>row.id==='wqx-record-e7dcd103f470f706bc66c0589322d6de9cc4925e950981da060ab9c41c2bfbb4');
    assert(silica);assert.equal(silica.value,'4.65');assert.equal(silica.unit,'mg/L');
    assert.equal(silica.reporting.value,'4650');assert.equal(silica.reporting.unit,'ug/L');
    assert.equal(silica.limits[0].value,'0.06');assert.equal(silica.reporting.limits[0].value,'60');
    assert.equal(analysis.observations.reduce((sum,row)=>sum+row.limits.length,0),1112);
    const optical=analysis.observations.find(row=>row.id==='wqx-record-11d4710939ec7646c8fe39b90e5e9589924e15cef1824024e388b1d0111498af');
    assert.equal(optical.reporting.conversion,null);equal(optical.reporting.limits,optical.limits);
    assert(optical.reviewReasons.some(row=>row.action==='keep'&&row.reason.includes('NTRU')));
  }
  if(period) {
    assert.equal(analysis.original.baseline.inventory.selectedRows,140);
    assert.equal(analysis.reviewed.baseline.inventory.arithmeticRows,68);
    assert.equal(analysis.reviewed.comparison.filter(row=>row.currentMean&&row.baselineMean).length,64);
  } else if(comparison) {
    assert(record.previous);assert.equal(record.previous.analysis.observations.length,1035);
    const counts=record.comparison.counts;
    assert.equal(counts.sourceChanged,0);assert.equal(counts.added,0);assert.equal(counts.removed,0);
    assert.equal(counts.choiceChanged,750);assert.equal(counts.choiceBindingChanged,749);assert.equal(counts.representationChanged,694);
  }
  return {reviewId:record.reviewId,reviewSha256:record.reviewSha256,analysisSha256:analysis.analysisSha256,
    inventory,originalInventory:native,reportingInventory:reviewed,comparison:record.comparison?.counts??null};
}
async function sourcePhase(value) {
  const prior=await scientificReceipt(value,'source');if(prior)return prior;
  await scientificChild(resolve(HERE,'../review-sheet/concentrations-receiving.mjs'),
    ['--config',value.config.sourceConfigurationFile,'--phase','source'],value.original.nodeHeapMiB??768);
  const source=await scientificJson(join(value.original.directory,'source-ready.json'));
  assert.equal(source.status,'SOURCE_PREPARED');
  assert.equal(source.requestSha256,openWatersHash({schema:CONCENTRATION_RECEIVING_SCHEMA,
    configuration:{...value.original,nodeHeapMiB:value.original.nodeHeapMiB??768}}));
  for(const key of ['sourcePlanSha256','reviewSha256','captureSha256'])assert.equal(source[key],value.original[key]);
  const project=await openWaterQualityProject(value.author,{transport});
  const identities={};
  try {
    const original=normalizeReviewSheetDocument(await scientificJson(join(value.original.directory,'cli','draft-0.json')));
    const document=normalizeReviewSheetDocument(await scientificJson(join(value.original.directory,'cli','decisions.json')));
    assert.equal(openWatersHash(document),source.documentSha256);
    for(const [name,selected,newPlanId,reviewId] of [
      ['baseline',original,value.ids.baselinePlan,value.ids.baselineDecision],
      ['current',document,value.original.newPlanId,value.ids.decision]
    ]) {
      const preview=await previewReviewSheet({project,document:selected,newPlanId});
      if(name==='current'){assert.equal(preview.previewSha256,source.previewSha256);assert.equal(preview.newPlanSha256,source.newPlanSha256);}
      const saved=await saveReviewSheet({project,document:selected,newPlanId,reviewId,expectedPreviewSha256:preview.previewSha256});
      assert.equal(saved.status,'COMPLETE');
      identities[name]={reviewId,reviewSha256:saved.reviewSha256,documentSha256:saved.documentSha256,
        newPlanId:saved.newPlanId,newPlanSha256:saved.newPlanSha256};
      gc();
    }
  } finally {await project.close();}
  return completeScientificPhase(value,'source',{sourceRequestSha256:source.requestSha256,decisions:identities});
}
async function retainedCli(value,args,output) {
  async function retainedResponse(path) {
    try{return await scientificJson(path);}
    catch(error) {
      if(!(error instanceof SyntaxError)&&error.code!=='ERR_ENCODING_INVALID_ENCODED_DATA')throw error;
      const original=await scientificFile(path);
      await scientificRetain(path+'.interrupted.json',{schema:SCIENTIFIC_RECEIVING_SCHEMA,
        requestSha256:value.requestSha256,arguments:args,original,
        status:'INTERRUPTED_RESPONSE',message:'The original CLI response is incomplete; retain its exact bytes and reopen the same requested operation.'});
      return {error:'INTERRUPTED_RESPONSE'};
    }
  }
  let destination=output,old=await retainedResponse(destination);
  if(old?.error) {
    destination=output+'.recovered.json';old=await retainedResponse(destination);
    assert(!old?.error,'The same recovery output contains an earlier failure; use the retained original review to inspect it.');
  }
  if(!old)await scientificChild(resolve(HERE,'../cli.mjs'),['scientific',...args,'--out',destination],value.original.nodeHeapMiB??768);
  const result=await scientificJson(destination);assert(result&&!result.error,'The original CLI did not retain its complete response.');
  return {value:result,file:await scientificFile(destination)};
}
async function saveCli(value,request,label) {
  const requestFile=join(value.root,'cli',label+'-request.json');await scientificRetain(requestFile,request);
  let preview=await retainedCli(value,['preview','--project',value.author,'--request',requestFile],join(value.root,'cli',label+'-preview.json'));
  const expectedPreviewSha256=preview.value.previewSha256;preview.value=null;gc();
  const saved=await retainedCli(value,['save','--project',value.author,'--preview',preview.file.file],join(value.root,'cli',label+'-saved.json'));
  assert.equal(saved.value.previewSha256,expectedPreviewSha256);equal(saved.value.request,requestOfSaved(request,saved.value));
  return saved;
}
function requestOfSaved(request,saved) {
  for(const [key,value] of Object.entries(request))equal(saved.request[key],key==='options'?normalizeStandardizedOptions(value):value,'The original CLI saved a different '+key+'.');
  return saved.request;
}
async function nativePhase(value) {
  const prior=await scientificReceipt(value,'native');if(prior)return prior;
  const source=await scientificReceipt(value,'source');assert(source);
  const files=[],baseRequest={reviewId:value.ids.baseline,decisionReviewId:source.decisions.baseline.reviewId,
    expectedDecisionReviewSha256:source.decisions.baseline.reviewSha256,title:'Potomac Q1 2025 — original scientific units',
    note:'Complete original source representation for an explicit reporting-unit comparison.',options:{}};
  let baseline=await saveCli(value,baseRequest,'baseline');
  const baselineIdentity={reviewId:baseline.value.reviewId,reviewSha256:baseline.value.reviewSha256};
  assert.equal(baseline.value.analysis.inventory.convertedResults,0);
  files.push(baseline.file);baseline=null;gc();
  const request={reviewId:value.ids.current,decisionReviewId:source.decisions.current.reviewId,
    expectedDecisionReviewSha256:source.decisions.current.reviewSha256,title:'Potomac Q1 2025 — original and reporting units',
    note:'Every original result and reported limit remains attached to the reviewed reporting representation.',
    options:{},previousReviewId:baselineIdentity.reviewId,expectedPreviousReviewSha256:baselineIdentity.reviewSha256};
  let saved=await saveCli(value,request,'quarter');
  const quarter=checkScientificCohort(saved.value);files.push(saved.file);saved=null;gc();
  const periodRequest={...request,reviewId:value.ids.period,title:'Potomac March against January 2025 — reporting units',
    options:{window:{start:'2025-03-01',end:'2025-03-31'},baselineWindow:{start:'2025-01-01',end:'2025-01-31'}},
    previousReviewId:null,expectedPreviousReviewSha256:null};
  let period=await saveCli(value,periodRequest,'period');
  const reportingWindow=checkScientificCohort(period.value,{period:true,comparison:false});files.push(period.file);period=null;gc();
  const project=await openWaterQualityProject(value.author,{transport}),exports={};
  try {
    for(const format of SCIENTIFIC_FORMATS) {
      let output=await exportStandardizedReview({project,reviewId:value.ids.current,format});
      exports[format]=await scientificRetain(join(value.root,'exports',output.filename),output.bytes);
      files.push(exports[format]);output=null;gc();
    }
  } finally {await project.close();}
  assert(exports.bundle.bytes<=128*1024*1024,'The complete two-edition bundle uses the original declared file transport.');
  let received=await retainedCli(value,['receive','--project',value.receiver,'--bundle',exports.bundle.file],join(value.root,'cli','received.json'));
  assert.equal(received.value.reviewSha256,quarter.reviewSha256);checkScientificCohort(received.value);files.push(received.file);received=null;gc();
  const target=await openWaterQualityProject(value.receiver,{transport}),receivingExports={};
  try {
    const reopened=await readStandardizedReview({project:target,reviewId:value.ids.current});assert.equal(reopened.reviewSha256,quarter.reviewSha256);
    for(const format of SCIENTIFIC_FORMATS) {
      let output=await exportStandardizedReview({project:target,reviewId:value.ids.current,format});
      assert.equal(hash(output.bytes),exports[format].sha256,'Independent receiving changed '+format+'.');
      assert.equal(output.bytes.length,exports[format].bytes);
      receivingExports[format]={bytes:output.bytes.length,sha256:hash(output.bytes)};output=null;gc();
    }
  } finally {await target.close();}
  return completeScientificPhase(value,'native',{quarter,reportingWindow,baseline:baselineIdentity,exports,receivingExports},files);
}
export async function main(argv=process.argv.slice(2)) {
  const {values}=parseArgs({args:argv,options:{config:{type:'string'},'expected-config-sha256':{type:'string'},
    phase:{type:'string',default:'all'},help:{type:'boolean'}}});
  if(values.help||!values.config){process.stdout.write('node --expose-gc standardized-analysis/receiving.mjs --config SCIENCE.json --expected-config-sha256 SHA [--phase source|native|browser|mcp|all]\n');return;}
  const value=await scientificSelection(resolve(values.config),values['expected-config-sha256']);
  if(values.phase==='all') {
    for(const phase of ['source','native','browser','mcp'])
      await scientificChild(fileURLToPath(import.meta.url),['--config',value.configFile,'--expected-config-sha256',value.expectedConfigSha256,'--phase',phase],value.original.nodeHeapMiB??768);
    const phases={};
    for(const phase of ['source','native','browser','mcp'])phases[phase]=await scientificReceipt(value,phase);
    assert(Object.values(phases).every(Boolean));
    const result=await completeScientificPhase(value,'receiving',{phases});
    process.stdout.write(json({status:result.status,operationId:result.operationId,result:join(value.root,'receiving-result.json')}));return result;
  }
  const run=values.phase==='source'?sourcePhase:values.phase==='native'?nativePhase:
    values.phase==='browser'?(await import('./browser-receiving.mjs')).receiveScientificBrowser:
    values.phase==='mcp'?(await import('../../../../../stellar-forge/mcp-merchant-operator/wqx-scientific-receiving.mjs')).receiveScientificMcp:null;
  assert(run,'Choose an original scientific receiving phase.');
  const result=await withPrivateLock(value.root,'scientific-receiving.lock',()=>run(value));
  process.stdout.write(json({status:result.status,phase:result.phase,operationId:result.operationId}));
  return result;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(error=>{process.stderr.write(json({error:error.code??'WQX_SCIENTIFIC_RECEIVING_FAILED',message:error.message}));process.exitCode=1;});
