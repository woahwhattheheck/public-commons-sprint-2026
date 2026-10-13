#!/usr/bin/env node
// MIT. Reusable internal example on the original Merchant case and receiving engines.
import {randomUUID} from 'node:crypto';
import {parseArgs} from 'node:util';
import {join,resolve,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {openCaseStore,retainCaseArtifact} from '../case-store.mjs';
import {serializeWorkspace} from '../workspace-file.mjs';
import {openCaseCommercial,commercialWorkspaceId} from '../case-commercial.mjs';
import {emptyCommercialDraft} from '../commercial-quote.mjs';
import {emptyCommercialEconomicsInput} from './economics.mjs';
import {receiveEconomicsJourney} from './economics-receiving-journey.mjs';
import {privateDirectory} from '../../sf88-operator-buyer-cli/node/store.mjs';
import {readPrivateFile} from '../../sf93-seller-support-bundle/incident-store.mjs';
import {canonical,jsonBytes,sha256} from '../commercial-pricing.mjs';
import {start} from '../server.mjs';

const SCHEMA='stellar-forge.merchant-economics-internal-example.v1';
const NAME='Internal example · implementation and monthly care';
const ACTOR='Internal example operator';
const SOURCE='Explicit planning assumption for the internal operator example.';
const same=(a,b)=>{if(canonical(a)!==canonical(b))throw new Error('Reopen this original example with its retained inputs.');};
const absolute=value=>{
  if(typeof value!=='string'||!isAbsolute(value)||resolve(value)!==value||value==='/')
    throw new Error('Use an absolute normalized private example directory.');
  return value;
};
async function optional(path){
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readPrivateFile(path,16*1024*1024)));}
  catch(error){if(error.code==='ENOENT')return null;throw error;}
}
async function retain(path,value){await retainCaseArtifact(path,jsonBytes(value));return value;}
function quotation(){
  const draft=emptyCommercialDraft();
  draft.title=NAME;draft.customer={name:'Internal operator example',contact:''};
  draft.implementation.lines=[{id:'example-implementation',taskId:null,title:'Illustrative implementation',hours:'60',rateUsd:'120'}];
  draft.service.lines=[{id:'example-monthly-care',commitmentId:null,title:'Illustrative monthly care',quantity:'1',unitUsd:'600'}];
  draft.terms={
    scope:'Internal operator walkthrough of a proposed implementation and monthly care service.',
    deliverables:'Saved quote, private delivery assumptions, complete staff handoff and independently reopened case.',
    exclusions:'All amounts, effort and capacity are editable example assumptions.',
    payment:'Illustrative fee: USD 7,200 implementation and USD 600 per full care month.',
    acceptance:'Use this isolated internal example to operate the quotation, economics and receiving controls.',
  };
  draft.notes=SOURCE;
  return draft;
}
function assumptions(quote,date,{revised=false}={}){
  const input=emptyCommercialEconomicsInput(quote,{asOfDate:date});
  input.implementation={hours:revised?'72':'60',cashHourlyCostUsd:null,valuationHourlyRateUsd:'95',
    costs:[{id:'example-referral',label:'Illustrative referral cost',amountUsd:'360',source:SOURCE}],
    costCoverage:'COMPLETE',note:SOURCE+' Cash labor cost is left unknown; contributor time is valued separately.'};
  input.care={hours:revised?'6':'5',cashHourlyCostUsd:null,valuationHourlyRateUsd:'95',costs:[],
    costCoverage:'COMPLETE',note:SOURCE+' The selected example assumes zero other care costs within this scope.'};
  input.careCapacity={availableHoursMonthly:'40',committedOtherHoursMonthly:'10',source:SOURCE};
  input.note=revised?'Second internal assessment: implementation 72 hours and care 6 hours per month.':
    'First internal assessment: implementation 60 hours and care 5 hours per month.';
  return input;
}
export async function prepareEconomicsExample({directory,port=18774}={}){
  directory=absolute(directory);
  if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Choose one retained loopback port from 1 through 65535.');
  await privateDirectory(directory);
  const intentPath=join(directory,'example-intent.json');
  let intent=await optional(intentPath);
  if(!intent){
    intent={schema:SCHEMA,directory,port,createdAt:new Date().toISOString(),caseId:randomUUID(),
      quoteRequestId:randomUUID(),cliRequestId:randomUUID(),receiveRequestId:randomUUID(),
      label:NAME,assumptionSource:SOURCE};
    await retain(intentPath,intent);
  }
  if(intent.schema!==SCHEMA)throw new Error('This directory belongs to another original operation.');
  same({directory,port,label:NAME,assumptionSource:SOURCE},
    {directory:intent.directory,port:intent.port,label:intent.label,assumptionSource:intent.assumptionSource});
  const casesDirectory=join(directory,'example-cases');
  const store=await openCaseStore(casesDirectory);
  const seedPath=join(directory,'seed.json');
  let seed=await optional(seedPath);
  if(!seed){
    seed={id:intent.caseId,expectedRevision:null,
      workspaceText:await serializeWorkspace({name:NAME,termsText:SOURCE},{now:intent.createdAt}),
      metadata:{merchant:'Internal operator example',owner:ACTOR,status:'new',followUpOn:'',
        nextAction:'Operate Private economics and the complete staff receiving workflow.',
        notes:SOURCE},supportText:null};
    await retain(seedPath,seed);
  }
  same(seed.id,intent.caseId);
  let current;
  try{current=await store.read(intent.caseId);}
  catch(error){
    if(!['ENOENT','CASE_NOT_FOUND'].includes(error.code))throw error;
    await store.save(seed);current=await store.read(intent.caseId);
  }
  const model=openCaseCommercial({store,workspaceId:commercialWorkspaceId(casesDirectory)});
  let view=await model.read({id:intent.caseId});
  const draft=quotation(),quotePath=join(directory,'quote-request.json');
  let request=await optional(quotePath);
  if(!request){
    const review=await model.preview({id:intent.caseId,scope:view.scope,expectedRevision:view.revision,draft});
    request={id:intent.caseId,scope:view.scope,expectedRevision:view.revision,draft,
      reviewSha256:review.review.reviewSha256,requestId:intent.quoteRequestId,actor:ACTOR};
    await retain(quotePath,request);
  }
  same(request.draft,draft);same(request.requestId,intent.quoteRequestId);
  const published=await model.publish(request);
  view=await model.read({id:intent.caseId});
  const quote=view.quotes.find(row=>row.id===intent.quoteRequestId);
  if(!quote||published.quote.sha256!==quote.sha256||canonical(quote.draft)!==canonical(draft))
    throw new Error('The complete original example quote did not reopen.');
  const preparedPath=join(directory,'prepared.json');
  let prepared=await optional(preparedPath);
  if(!prepared){
    prepared={schema:SCHEMA,directory,port,casesDirectory,caseId:intent.caseId,
      revision:view.revision,quoteId:quote.id,quoteSha256:quote.sha256,
      createdAt:intent.createdAt,cliRequestId:intent.cliRequestId,receiveRequestId:intent.receiveRequestId,
      cliInput:assumptions(quote,intent.createdAt.slice(0,10)),
      browserInput:assumptions(quote,intent.createdAt.slice(0,10),{revised:true})};
    await retain(preparedPath,prepared);
  }
  const {revision,...retainedSelection}=prepared;
  if(typeof revision!=='string'||!/^[a-f0-9]{64}$/.test(revision))
    throw new Error('The original prepared example must retain its exact historical case revision.');
  same(retainedSelection,{schema:SCHEMA,directory,port,casesDirectory,caseId:intent.caseId,
    quoteId:quote.id,quoteSha256:quote.sha256,createdAt:intent.createdAt,
    cliRequestId:intent.cliRequestId,receiveRequestId:intent.receiveRequestId,
    cliInput:assumptions(quote,intent.createdAt.slice(0,10)),
    browserInput:assumptions(quote,intent.createdAt.slice(0,10),{revised:true})});
  const original=await model.read({id:intent.caseId,revision});
  if(!original.quotes.some(row=>row.id===quote.id&&row.sha256===quote.sha256))
    throw new Error('The original prepared example revision and quotation must remain available.');
  const editablePath=join(directory,'editable-assumptions.json');
  try{await readPrivateFile(editablePath,16*1024*1024);}
  catch(error){if(error.code!=='ENOENT')throw error;await retain(editablePath,prepared.cliInput);}
  return prepared;
}
/** Own only this listener; the example case and original receiving journals survive exit. */
export async function openEconomicsExample(options){
  const prepared=await prepareEconomicsExample(options);
  const host=await start({casesDir:prepared.casesDirectory,port:prepared.port});
  return {prepared,url:host.url+'commercial?case='+prepared.caseId,close:host.close,
    async receive({playwright,chromium,python='python3',environment=process.env,signal}={}){
      absolute(playwright);absolute(chromium);
      const input={schema:'stellar-forge.merchant-economics-receiving-course.v1',
        operationId:'INTERNAL-QUOTE-ECONOMICS-'+prepared.caseId,casesDirectory:prepared.casesDirectory,
        caseId:prepared.caseId,revision:prepared.revision,quoteId:prepared.quoteId,quoteSha256:prepared.quoteSha256,
        cliInput:prepared.cliInput,browserInput:prepared.browserInput,cliRequestId:prepared.cliRequestId,
        actor:ACTOR,browserActor:ACTOR,origin:new URL(host.url).origin,playwright,chromium,
        sourceDirectory:join(prepared.casesDirectory,'source-bundles'),
        receivedCasesDirectory:join(prepared.directory,'received-cases'),
        receivedSourceDirectory:join(prepared.directory,'received-sources'),
        receiveRequestId:prepared.receiveRequestId,receivingActor:'Internal receiving operator',
        exportId:'internal-economics-'+prepared.caseId,onwardExportId:'internal-received-economics-'+prepared.caseId,python};
      await retain(join(prepared.directory,'receiving-input.json'),input);
      return receiveEconomicsJourney(input,{out:join(prepared.directory,'receiving-course'),environment,signal});
    }};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  let owner,wake;
  const controller=new AbortController();
  const stop=signal=>{
    if(controller.signal.aborted)return;
    process.exitCode=signal==='SIGINT'?130:143;
    controller.abort(new Error('The original example operator requested '+signal+'.'));
    wake?.();
  };
  const interrupt=()=>stop('SIGINT'),terminate=()=>stop('SIGTERM');
  process.once('SIGINT',interrupt);process.once('SIGTERM',terminate);
  try{
    const {values}=parseArgs({options:{out:{type:'string'},port:{type:'string'},playwright:{type:'string'},chromium:{type:'string'},python:{type:'string'},receive:{type:'boolean'},help:{type:'boolean'}}});
    if(values.help){
      process.stdout.write('node economics-example.mjs --out /ABS/private/example [--port 18774]\n'+
        '  --receive --playwright /ABS/installed/playwright/index.mjs --chromium /ABS/installed/chromium [--python python3]\n'+
        'Without --receive, the original application stays open for interactive use. The separate labelled case and its source files remain in --out.\n');
    }else{
      if(values.port!==undefined&&!/^[1-9]\d*$/.test(values.port))throw new Error('Use a whole loopback port.');
      if(!values.receive&&(values.playwright||values.chromium||values.python))
        throw new Error('Browser receiving options require --receive.');
      controller.signal.throwIfAborted();
      owner=await openEconomicsExample({directory:values.out,port:values.port===undefined?18774:Number(values.port)});
      controller.signal.throwIfAborted();
      process.stdout.write(JSON.stringify({schema:SCHEMA,state:'OPEN',url:owner.url,directory:owner.prepared.directory,
        caseId:owner.prepared.caseId,quoteId:owner.prepared.quoteId,quoteSha256:owner.prepared.quoteSha256,
        assumptions:join(owner.prepared.directory,'editable-assumptions.json')})+'\n');
      if(values.receive){
        const result=await owner.receive({playwright:values.playwright,chromium:values.chromium,python:values.python,signal:controller.signal});
        controller.signal.throwIfAborted();process.stdout.write(JSON.stringify(result)+'\n');
      }else await new Promise(done=>{wake=done;if(controller.signal.aborted)done();});
    }
  }catch(error){
    process.stderr.write(JSON.stringify({error:error.code||'ECONOMICS_EXAMPLE',message:String(error.message)})+'\n');
    if(!controller.signal.aborted)process.exitCode=1;
  }finally{
    process.removeListener('SIGINT',interrupt);process.removeListener('SIGTERM',terminate);
    if(owner)try{await owner.close();}catch(error){process.stderr.write(String(error.message)+'\n');if(!controller.signal.aborted)process.exitCode=1;}
  }
}
