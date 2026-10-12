#!/usr/bin/env node
// Operate the installed RenewalGuard server and retain a complete original case.
// Use an explicitly selected sandbox test subscription for a configured run.
import { readFile, mkdir, open, link, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const hash=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
async function readJson(path){try{return JSON.parse(await readFile(path,'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function save(path,value){
  const bytes=Buffer.from(JSON.stringify(value,null,2)+'\n');await mkdir(dirname(path),{recursive:true});
  const previous=await readJson(path);
  if(previous!==null){if(hash(previous)!==hash(value))throw new Error('Existing retained output differs: '+path);return;}
  const temporary=path+'.'+randomUUID()+'.part';let file;
  try{
    file=await open(temporary,'wx',0o600);await file.writeFile(bytes);await file.sync();await file.close();file=null;
    await link(temporary,path);
    const directory=await open(dirname(path),'r');try{await directory.sync();}finally{await directory.close();}
  }finally{if(file)await file.close().catch(()=>{});await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
export async function runMerchantJourney({base='http://127.0.0.1:8787',mode='demo',subscription,
  operation='renewalguard-merchant-case-e9b2-20261012',output,owner='Renewal operations',reviewer='Receiving operator',
  onProgress=entry=>process.stdout.write(JSON.stringify(entry)+'\n')}={}){
  if(!output)throw new Error('An original retained output directory is required');
  const origin=new URL(base);
  if(origin.protocol!=='http:'||!['localhost','127.0.0.1'].includes(origin.hostname)||!origin.port||
    origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash)
    throw new Error('Use the original loopback RenewalGuard HTTP server and port');
  if(!['demo','sandbox'].includes(mode))throw new Error('Mode must be demo or sandbox');
  if(mode==='demo')subscription=subscription||'I-DEMOSUSPEND1';
  if(!/^I-[A-Z0-9]{6,40}$/.test(subscription||''))throw new Error('Select an exact authorized sandbox test subscription with --subscription');
  if(!/^[a-z0-9][a-z0-9-]{7,60}$/.test(operation))throw new Error('Use a stable lowercase operation ID of 8–61 characters');
  output=resolve(output);await mkdir(output,{recursive:true});
  const api=async(path,params={},body=null)=>{
    const response=await fetch(origin.origin+path+(body?'':'?'+new URLSearchParams({mode,...params})),{
      method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:undefined,
      body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(120000)});
    const data=await response.json();
    if(!response.ok){const error=new Error(data.error||'Original server request failed');error.code=data.code;error.details=data.details;throw error;}
    return data;
  };
  const workspace=await api('/api/workspace');
  const original={schema:'renewalguard-operator-intake-v1',operation,mode,subscription,scope:workspace.scope,owner,reviewer};
  await save(join(output,'original-operation.json'),original);
  const completed=await readJson(join(output,'result.json'));
  if(completed){onProgress({state:'retained_complete',operation,case_id:completed.case_id,output});return completed;}
  const receipts={};
  async function step(label,action,input){
    const requestId='rg-'+hash(operation+':'+label).slice(0,56);
    const path=join(output,'requests',label+'.json');
    let record=await readJson(path);
    if(!record){
      const value={mode,request_id:requestId,action,input:await input()};
      record={...value,input_sha256:hash(value)};await save(path,record);
    }
    const {input_sha256,...body}=record;
    if(input_sha256!==hash(body)||body.mode!==mode||body.action!==action||body.request_id!==requestId)
      throw new Error('Original request input changed: '+label);
    const status=await api('/api/operation',{request_id:requestId});
    const result=status.found?await api('/api/resume',{}, {mode,request_id:requestId}):
      await api('/api/command',{},body);
    if(result.state!=='done')throw new Error('Original command is not complete: '+requestId);
    await save(join(output,'receipts',label+'.json'),result);
    receipts[label]={request_id:requestId,result:result.result};
    onProgress({step:label,state:result.result?.state,request_id:requestId});
    return result.result;
  }
  const portfolio=await step('portfolio','refresh_portfolio',async()=>({}));
  const sourcePortfolio=(await api('/api/workspace')).portfolio;
  if(sourcePortfolio.sha!==portfolio.document_sha){
    // The request retains its original list even if another operator refreshed
    // the workspace. The explicit selected subscription is captured directly.
    onProgress({state:'newer_portfolio_visible',original_portfolio_sha:portfolio.document_sha});
  }
  const captured=await step('capture','capture',async()=>({subscription_id:subscription}));
  const caseId=captured.case_id;
  const current=()=>api('/api/case',{case_id:caseId});
  let view=await current();
  const originalCase=await readJson(join(output,'initial-case.json'));
  if(!originalCase)await save(join(output,'initial-case.json'),{stage:view.case.stage,case_id:caseId,revision:view.revision});
  if((originalCase||{stage:view.case.stage}).stage==='resolved'){
    await step('reopen-existing','reopen',async()=>{const v=await current();return{case_id:caseId,expected_revision:v.revision,
      reason:'Continue the original sandbox renewal receiving operation '+operation};});
  }
  await step('assigned-plan','save_plan',async()=>{
    const v=await current(),old=v.plan?.work;
    return{case_id:caseId,expected_revision:v.revision,work:{
      title:old?.title||'Renewal case · '+subscription,owner,due_date:old?.due_date||new Date(Date.now()+86400000).toISOString().slice(0,10),
      priority:v.source.facts.tier==='HIGH'?'high':'normal',work_status:'in_progress',
      next_action:'Review the original subscription status and prepare its renewal support handover.',
      notes:old?.notes||'Original subscription snapshot retained for '+operation,customer_note:old?.customer_note||'',
      outcome:'',resolution_summary:'',
    }};
  });
  async function obtainNote(label){
    let attempt=0,result;
    do {
      result=await step(label+(attempt?'-source-'+attempt:''),'ai_note',async()=>{const v=await current();return{case_id:caseId,expected_revision:v.revision};});
      attempt++;
    }while(result.state==='source_changed');
    const v=await current(),ref=v.case.notes.find(item=>item.id===result.note_id);
    if(!ref)throw new Error('The original prepared note is missing from the case');
    return (await api('/api/document',{case_id:caseId,sha:ref.sha})).document;
  }
  let preparedNote=await obtainNote('support-note');
  let resolved,cycle=0;
  for(;;){
    const label=cycle?'source-'+cycle:'original';
    if(cycle)preparedNote=await obtainNote('support-note-'+label);
    await step('ready-plan-'+label,'save_plan',async()=>{
      const v=await current(),work={...v.plan.work,work_status:'ready',customer_note:preparedNote.proposal.text,
        outcome:['CANCELLED','EXPIRED'].includes(v.source.facts.status)?'subscription_ended':'monitoring',
        next_action:'Retain the reviewed renewal handover and track the next support follow-up.',
        resolution_summary:'Reviewed '+v.source.facts.status+' subscription facts and the saved support plan; follow-up is assigned to '+owner+'.'};
      return{case_id:caseId,expected_revision:v.revision,work};
    });
    const reviewed=await step('review-'+label,'review',async()=>{
      const v=await current();return{case_id:caseId,expected_revision:v.revision,plan_id:v.plan.id,reviewer,
        summary:'Reviewed saved plan edition '+v.plan.number+' against the current '+v.source.facts.status+' subscription snapshot.'};
    });
    if(reviewed.state==='source_changed'){cycle++;continue;}
    resolved=await step('resolve-'+label,'resolve',async()=>{const v=await current();return{case_id:caseId,
      expected_revision:v.revision,review_id:reviewed.review_id};});
    if(resolved.state==='source_changed'){cycle++;continue;}
    break;
  }
  if(resolved.state!=='case_resolved')throw new Error('Expected an original saved case resolution');
  const handover=await api('/api/export',{case_id:caseId,revision:String(resolved.revision)});
  const {sha256,...payload}=handover;
  if(hash(payload)!==sha256)throw new Error('Complete handover checksum differs');
  for(const item of handover.documents)if(hash(item.document)!==item.sha)throw new Error('Original handover document checksum differs');
  await save(join(output,'resolved-case-handover.json'),handover);
  await save(join(output,'original-support-note.json'),preparedNote);
  const reopened=await step('reopen-resolved','reopen',async()=>{const v=await current();return{case_id:caseId,expected_revision:v.revision,
    reason:'Retain the completed resolution and reopen its assigned follow-up under '+operation};});
  const finalView=await current();
  if(finalView.case.stage!=='open'||!finalView.case.resolutions.some(x=>x.id===resolved.resolution_id))
    throw new Error('The original resolution was not preserved when the case reopened');
  await save(join(output,'reopened-case.json'),finalView);
  const result={schema:'renewalguard-operator-journey-v1',operation,scope:workspace.scope,case_id:caseId,subscription_id:subscription,
    source_provider:finalView.source.provider,ai_generated:!!preparedNote.proposal.available,note_kind:preparedNote.proposal.kind,
    resolution_id:resolved.resolution_id,resolved_revision:resolved.revision,final_revision:reopened.revision,final_stage:finalView.case.stage,
    plan_editions:finalView.case.plans.length,source_snapshots:finalView.case.sources.length,review_editions:finalView.case.reviews.length,
    handover_sha256:sha256,original_documents:handover.documents.length,source_cycles:cycle,
    requests:receipts,output};
  await save(join(output,'result.json'),result);onProgress({state:'complete',...result});return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const options={};let help=false;
  const names=new Set(['base','mode','subscription','operation','output','owner','reviewer']);
  const args=process.argv.slice(2);
  for(let i=0;i<args.length;i+=2){
    if(args[i]==='--help'){help=true;break;}
    const key=args[i]?.replace(/^--/,'');
    if(!args[i]?.startsWith('--')||!names.has(key)||!args[i+1]||Object.hasOwn(options,key))throw new Error('Unknown or repeated option: '+args[i]);
    options[key]=args[i+1];
  }
  if(help)process.stdout.write('node examples/merchant-journey.mjs --base http://127.0.0.1:8787 --mode demo --operation ORIGINAL_OPERATION_ID --output RETAINED_DIRECTORY\nFor sandbox, add --subscription ORIGINAL_TEST_SUBSCRIPTION_ID. Optional --owner and --reviewer name the receiving operators.\n');
  else runMerchantJourney(options).catch(error=>{process.stderr.write(JSON.stringify({error:error.message,code:error.code||null})+'\n');process.exitCode=1;});
}
