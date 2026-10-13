#!/usr/bin/env node
// MIT. Whole original Installation -> private economics -> case receiving course.
import {parseArgs} from 'node:util';
import {join,resolve,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {privateDirectory} from '../../sf88-operator-buyer-cli/node/store.mjs';
import {readPrivateFile} from '../../sf93-seller-support-bundle/incident-store.mjs';
import {openCaseStore,retainCaseArtifact} from '../case-store.mjs';
import {openCaseCommercial,commercialWorkspaceId} from '../case-commercial.mjs';
import {canonical,jsonBytes,sha256} from '../commercial-pricing.mjs';
import {commercialEconomicsCli} from './economics-cli.mjs';
import {prepareEffortEconomics,reopenEffortEconomics} from './effort-economics.mjs';
import {inspectEconomicsCase} from './economics-receiving.mjs';

export const EFFORT_RECEIVING_SCHEMA='stellar-forge.merchant-effort-economics-receiving.v1';
const decode=raw=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
const same=(a,b)=>{if(canonical(a)!==canonical(b))throw new Error('The original receiving selection or result changed.');};
function absolute(v){if(typeof v!=='string'||!isAbsolute(v)||resolve(v)!==v||v==='/')throw new Error('Use absolute private paths.');return v;}
async function read(path){return decode(await readPrivateFile(path,64*1024*1024));}
async function optional(path){try{return await read(path);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function keep(path,value){await retainCaseArtifact(path,jsonBytes(value));return value;}
function argv(action,values){return [action,...Object.entries(values).flatMap(([name,value])=>value===undefined?[]:['--'+name,String(value)])];}
async function cold(input,output,{signal,environment}={}){
  const child=spawn(process.execPath,[fileURLToPath(import.meta.url),'--cold-read',input],
    {env:environment??process.env,stdio:['ignore','pipe','pipe']});
  const chunks=[],errors=[];let bytes=0,err=0,failure=null,closed=false,force;
  const stop=error=>{failure??=error;if(!closed){child.kill('SIGTERM');force??=setTimeout(()=>{if(!closed)child.kill('SIGKILL');},5000);}};
  const cancel=()=>stop(signal.reason??new Error('Cancelled.'));
  signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();
  const timer=setTimeout(()=>stop(new Error('Cold receiving exceeded five minutes.')),300000);
  const result=await new Promise((resolvePromise,reject)=>{
    child.stdout.on('data',b=>{bytes+=b.length;if(bytes>64*1024*1024)stop(new Error('Cold result exceeds bound.'));else chunks.push(b);});
    child.stderr.on('data',b=>{err+=b.length;if(err<65536)errors.push(b);});
    child.on('error',e=>{failure??=e;});
    child.on('close',code=>{
      closed=true;clearTimeout(timer);clearTimeout(force);signal?.removeEventListener('abort',cancel);
      if(failure)return reject(failure);
      if(code!==0)return reject(new Error('Original cold receiving failed: '+Buffer.concat(errors).toString('utf8')));
      try{resolvePromise(decode(Buffer.concat(chunks)));}catch(e){reject(e);}
    });
  });
  await keep(output,result);return result;
}
/** The caller explicitly selects an existing case/quote/assessment and an actual
 * saved commercial Installation ZIP. Example cases belong in a separate workspace.
 * This operated course DOES explicitly save one new private assessment. */
export async function receiveEffortEconomics(input,{out,environment=process.env,signal}={}){
  if(input?.schema!==EFFORT_RECEIVING_SCHEMA)throw new Error('Use the complete selected receiving input.');
  absolute(out);absolute(input.casesDirectory);absolute(input.receivedCasesDirectory);absolute(input.receivedSourceDirectory);
  if(input.casesDirectory===input.receivedCasesDirectory)throw new Error('Choose an independent receiving case store.');
  if(typeof input.actor!=='string'||!input.actor||typeof input.requestId!=='string'||!input.requestId)
    throw new Error('Retain one original request ID and actor.');
  await privateDirectory(out);await keep(join(out,'receiving-input.json'),input);
  const cli=(action,values)=>commercialEconomicsCli(argv(action,values),{environment,signal});
  const model=openCaseCommercial({store:await openCaseStore(input.casesDirectory),workspaceId:commercialWorkspaceId(input.casesDirectory)});
  const requestPath=join(out,'save-request.json');
  let request=await optional(requestPath),prepared;
  if(!request){
    prepared=await prepareEffortEconomics({...input,id:input.caseId,directory:join(out,'effort-handoff'),environment,signal});
    request={caseId:input.caseId,caseRevision:input.revision,requestId:input.requestId,actor:input.actor,
      input:prepared.input,inputSha256:sha256(jsonBytes(prepared.input)),reviewSha256:prepared.preview.review.reviewSha256,
      handoffManifestSha256:prepared.manifest.sha256};
    // Persist the complete original invoking request before the original writer.
    await keep(requestPath,request);
  }else{
    same({caseId:request.caseId,caseRevision:request.caseRevision,requestId:request.requestId,actor:request.actor},
      {caseId:input.caseId,caseRevision:input.revision,requestId:input.requestId,actor:input.actor});
    prepared=await reopenEffortEconomics({casesDirectory:input.casesDirectory,directory:join(out,'effort-handoff'),
      manifestSha256:request.handoffManifestSha256,python:input.python,environment,signal});
    same(request.input,prepared.input);
    if(request.inputSha256!==sha256(jsonBytes(prepared.input))||request.reviewSha256!==prepared.preview.review.reviewSha256)
      throw new Error('The original saved request no longer matches the complete source handoff.');
  }
  if(signal?.aborted)throw signal.reason??new Error('Cancelled before the original economics save.');
  const saved=await model.saveEconomics({id:input.caseId,expectedRevision:input.revision,
    requestId:input.requestId,actor:input.actor,input:request.input,reviewSha256:request.reviewSha256});
  const view=await model.read({id:input.caseId});
  const assessment=view.economics.assessments.find(row=>row.id===saved.assessmentId);
  if(!assessment||assessment.quoteId!==input.quoteId||assessment.quoteSha256!==input.quoteSha256)
    throw new Error('The original save returned another private assessment.');
  same(assessment.review.input,request.input);
  const selectionPath=join(out,'case-export-selection.json');
  let selected=await optional(selectionPath);
  if(!selected)selected=await keep(selectionPath,{caseId:input.caseId,revision:view.case.revision,
    quoteId:input.quoteId,quoteSha256:input.quoteSha256,assessmentId:assessment.id,assessmentSha256:assessment.sha256});
  same({caseId:selected.caseId,quoteId:selected.quoteId,quoteSha256:selected.quoteSha256,
    assessmentId:selected.assessmentId,assessmentSha256:selected.assessmentSha256},
    {caseId:input.caseId,quoteId:input.quoteId,quoteSha256:input.quoteSha256,
      assessmentId:assessment.id,assessmentSha256:assessment.sha256});
  const common={'cases-dir':input.casesDirectory,case:input.caseId,revision:selected.revision,
    quote:selected.quoteId,'quote-sha':selected.quoteSha256,assessment:selected.assessmentId,'assessment-sha':selected.assessmentSha256};
  const exported=await cli('export',{...common,out:join(out,'merchant-package'),'export-id':input.exportId,
    'source-dir':input.sourceDirectory,'generated-at':input.generatedAt,python:input.python});
  const receivedArgs={from:join(out,'merchant-package'),sha256:exported.casePackage.manifestSha256,
    out:join(out,'merchant-receiving'),'cases-dir':input.receivedCasesDirectory,'source-dir':input.receivedSourceDirectory,
    'request-id':input.receiveRequestId,actor:input.receivingActor,quote:selected.quoteId,'quote-sha':selected.quoteSha256,
    assessment:selected.assessmentId,'assessment-sha':selected.assessmentSha256,python:input.python};
  const received=await cli('receive',receivedArgs),repeated=await cli('receive',receivedArgs);
  same(received.receiving.case,repeated.receiving.case);same(received.review.assessment,repeated.review.assessment);
  same(received.review.assessment.review.input,request.input);
  // Transfer every original effort handoff member as well as the native merchant
  // case. The case alone contains the assessment, not an invented source pointer.
  const handoffManifest=await read(join(out,'effort-handoff','effort-economics.json'));
  const recipientHandoff=join(out,'merchant-receiving','effort-handoff');await privateDirectory(recipientHandoff);
  for(const file of handoffManifest.files){
    const bytes=await readPrivateFile(join(out,'effort-handoff',file.name),file.bytes);
    if(bytes.length!==file.bytes||sha256(bytes)!==file.sha256)throw new Error('An original handoff member changed.');
    await retainCaseArtifact(join(recipientHandoff,file.name),bytes);
  }
  for(const name of ['effort-economics.json']){
    const bytes=await readPrivateFile(join(out,'effort-handoff',name),64*1024*1024);
    await retainCaseArtifact(join(recipientHandoff,name),bytes);
  }
  const coldInput={handoff:{casesDirectory:join(out,'merchant-package','original-case-store'),directory:recipientHandoff,
      manifestSha256:request.handoffManifestSha256,python:input.python},
    receiving:{casesDirectory:input.receivedCasesDirectory,id:received.receiving.case.id,
      revision:received.receiving.case.importedRevision,quoteId:input.quoteId,quoteSha256:input.quoteSha256,
      assessmentId:assessment.id,assessmentSha256:assessment.sha256}};
  await keep(join(out,'cold-input.json'),coldInput);
  const reopened=await cold(join(out,'cold-input.json'),join(out,'cold-result.json'),{signal,environment});
  same(reopened.receiving.assessment,received.review.assessment);
  const result={schema:EFFORT_RECEIVING_SCHEMA,state:'COMPLETE',operationId:input.operationId,
    originalInstallation:prepared.native.selection,originalCase:prepared.native.originalCase,
    handoff:{directory:join(out,'effort-handoff'),sha256:request.handoffManifestSha256},
    originalPlanningAssessment:{id:input.assessmentId,sha256:input.assessmentSha256},
    savedAssessment:{id:assessment.id,sha256:assessment.sha256,requestId:input.requestId},
    merchantPackage:{directory:join(out,'merchant-package'),sha256:exported.casePackage.manifestSha256},
    received:{id:received.receiving.case.id,revision:received.receiving.case.importedRevision},
    independentColdReceiving:true,repeatedReceivingSameCase:true,
    visualInspection:'CONTINUE_ORIGINAL_OPERATOR_COURSE_AND_VIEW_RENDERED_OUTPUTS'};
  await keep(join(out,'result.json'),result);return result;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const controller=new AbortController();
  const cancel=()=>controller.abort(new Error('Receiving cancelled by the original operator.'));
  process.once('SIGINT',cancel);process.once('SIGTERM',cancel);
  try{
    const {values:v}=parseArgs({options:{input:{type:'string'},'input-sha':{type:'string'},out:{type:'string'},'cold-read':{type:'string'}}});
    if(v['cold-read']){
      const input=await read(absolute(v['cold-read']));
      const handoff=await reopenEffortEconomics({...input.handoff,signal:controller.signal}),receiving=await inspectEconomicsCase(input.receiving);
      process.stdout.write(jsonBytes({handoff,receiving}));
    }else{
      const raw=await readPrivateFile(absolute(v.input),64*1024*1024);
      if(sha256(raw)!==v['input-sha'])throw new Error('Use the exact reviewed receiving input SHA-256.');
      process.stdout.write(jsonBytes(await receiveEffortEconomics(decode(raw),{out:absolute(v.out),signal:controller.signal})));
    }
  }catch(error){process.stderr.write(JSON.stringify({error:error.code??'EFFORT_RECEIVING_FAILED',message:error.message})+'\n');process.exitCode=1;}
  finally{process.removeListener('SIGINT',cancel);process.removeListener('SIGTERM',cancel);}
}
