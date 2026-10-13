// MIT. Run the original reviewer receiving course through the customer-agent provider.
import {join,resolve,dirname} from 'node:path';
import {lstat,readFile,mkdir} from 'node:fs/promises';
import {parseArgs} from 'node:util';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {openRuntimeWorkspace} from '../../../stellar/scf-starforge-20261009/distribution/runtime-workspace/model.mjs';
import {operationLease,privateDirectory,saveJSON,readJSON,regular,need,absolute,canonical,json,digest}
 from '../../../stellar/scf-starforge-20261009/distribution/runtime-workspace/storage.mjs';
import {verifySourceMonitoringCustomer} from '../customer-setup.mjs';
import {AgentMonitoringClient} from '../agent-client.mjs';
import {readSourceMonitoringConfiguration} from '../merchant.mjs';
import {writeReply} from '../client.mjs';
import {receiveReviewerExchange} from './reviewer-exchange.mjs';

function finishOwnedCleanup(primary, cleanup, message) {
 if(primary){if(cleanup.length)primary.cleanupErrors=[...(Array.isArray(primary.cleanupErrors)?primary.cleanupErrors:[]),...cleanup];throw primary;}
 if(cleanup.length===1)throw cleanup[0];
 if(cleanup.length>1)throw new AggregateError(cleanup,message);
}

const SCHEMA='stellar-forge.source-monitoring-agent-receiving.v1';
const hash=value=>digest(json(canonical(value)));
const same=(a,b)=>hash(a)===hash(b);
async function ensure(path){
 try{await mkdir(path,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;}
 await privateDirectory(path);
}
async function retainJSON(path,value){
 const prior=await readJSON(path,true);if(prior){need(same(prior,value),'MONITORING_AGENT_RECEIVING_CHANGED');return;}
 try{await saveJSON(path,value);}catch(e){if(e.code!=='EEXIST')throw e;need(same(await readJSON(path),value),'MONITORING_AGENT_RECEIVING_CHANGED');}
}
async function retainReply(path,reply,historical=false){
 const receiptPath=path+'.receipt.json',prior=await readJSON(receiptPath,true);
 const core=value=>historical?{readOnly:value.readOnly,event:value.event,comparison:value.comparison}:value;
 if(prior){
  const raw=await regular(path,128*1024*1024);
  need(raw.length===prior.bytes&&digest(raw)===prior.sha256&&same(core(JSON.parse(raw.toString('utf8'))),core(reply.json)),
   'MONITORING_AGENT_RECEIVING_OBSERVATION_CHANGED');
  return prior;
 }
 // If publication of the original response preceded its receipt, adopt only
 // equal original semantic content and retain its original bytes/hash.
 let retainedRaw;
 try{retainedRaw=await regular(path,128*1024*1024);}catch(e){if(e.code!=='ENOENT')throw e;}
 if(retainedRaw)need(same(core(JSON.parse(retainedRaw.toString('utf8'))),core(reply.json)),
  'MONITORING_AGENT_RECEIVING_OBSERVATION_CHANGED');
 else{await writeReply(path,reply);retainedRaw=reply.raw;}
 const receipt={path,bytes:retainedRaw.length,sha256:digest(retainedRaw),status:reply.status};
 await retainJSON(receiptPath,receipt);return receipt;
}
/**
 * The original equipped programme supplies model, service, Python and any
 * already-owned browser callback. This function never launches a console/browser.
 */
export async function receiveSourceMonitoringCustomer({
 model,plan,pythonCommand,output,selection,operateCopy=null,
}){
 plan=JSON.parse(JSON.stringify(plan));selection=JSON.parse(JSON.stringify(selection));
 absolute(output);absolute(pythonCommand);await ensure(output);
 const lease=await operationLease(join(output,'customer-agent.lock'));
 const clients=[];let primary;
 try{
  const verified=await verifySourceMonitoringCustomer({model,plan});
  need(selection?.schema==='stellar-forge.source-review-receiving.v1'&&selection.workspace===verified.identity.workspace,
   'MONITORING_AGENT_RECEIVING_SELECTION');
  const config=await readSourceMonitoringConfiguration(verified.sourceFile),alias=verified.workspaceAlias;
  const scope={workspace:alias,expectedWorkspace:verified.identity.workspace,expectedBindingSha256:verified.identity.bindingSha256};
  const selected={schema:SCHEMA,planSha256:plan.sha256,setupOperationId:plan.selection.operationId,
   workspace:scope,pythonCommand,output,selection};
  await retainJSON(join(output,'agent-receiving-selection.json'),selected);
  const configuration={schema:config.schema,storageDirectory:config.storageDirectory,workspaces:config.workspaces};
  // Input aliases may be deliberately extended after an unfinished returned copy
  // arrives. The selected service, branch and connection declarations cannot drift.
  await retainJSON(join(output,'agent-workspace-declarations.json'),configuration);
  const authorizeFile=async descriptor=>{
   let allowed=selection.returnFile;
   const browser=await readJSON(join(output,'reviewer-copy-operated.json'),true);
   if(browser)allowed=browser.returnFile;
   need(typeof allowed==='string'&&absolute(allowed)===descriptor.path,'MONITORING_AGENT_RECEIVING_FILE',
    'Only the exact returned file selected by this original course may become its receiving input.');
   const selectedFile={...descriptor,name:descriptor.path.split('/').pop(),
    media:descriptor.path.toLowerCase().endsWith('.html')?'text/html':'application/json',sourceUrl:''};
   await retainJSON(join(output,'agent-selected-return.json'),selectedFile);
   // This full private declaration makes the generated original's authority
   // reviewable; native tools still receive only alias, byte count and SHA.
   const receivingConfig={...config,files:{receiving_return:selectedFile}};
   const path=join(output,'agent-return-configuration.json');
   await retainJSON(path,receivingConfig);
   const checked=await readSourceMonitoringConfiguration(path);
   need(checked.files.receiving_return.path===descriptor.path&&checked.files.receiving_return.sha256===descriptor.sha256,
    'MONITORING_AGENT_RECEIVING_FILE');
   return checked.files.receiving_return;
  };
  const factory=async options=>{
   need(options.connectionFile===plan.application.connectionFile&&options.expectedWorkspace===scope.expectedWorkspace,
    'MONITORING_AGENT_RECEIVING_SELECTION');
   const client=new AgentMonitoringClient({configuration:config,scope,authorizeFile});clients.push(client);return client;
  };
  const previous=await readJSON(join(output,'reviewer-exchange-complete.json'),true);
  const original=await receiveReviewerExchange({connectionFile:plan.application.connectionFile,pythonCommand,output,selection,
   operateCopy,clientFactory:factory});
  if(original.state!=='COMPLETE')return {...original,agent:{schema:SCHEMA,setup:verified,
   continuation:'Continue the same receiving selection and directory. Original native request IDs and complete input/result files stay authoritative.'}};
  // Reopen all three original results through advertised tools. This also
  // exercises the agent when an earlier direct-client course was already complete.
  const check=new AgentMonitoringClient({configuration:config,scope});clients.push(check);
  const identity=await check.inspect();need(same(identity,verified.identity),'MONITORING_AGENT_RECEIVING_IDENTITY');
  const directory=join(output,'agent-confirmation');await ensure(directory);
  const confirmations=[];
  for(const [name,result]of Object.entries(original.originalResults)){
   const reply=await check.get('review-exchange-request',{requestId:result.requestId});
   const native=reply.json;
   need(native.committed===true&&native.requestId===result.requestId&&same(native.result??native.event?.result,result),
    'MONITORING_AGENT_RECEIVING_RESULT_CHANGED');
   confirmations.push(await retainReply(join(directory,name+'-original-request.json'),reply));
  }
  const comparison=await check.get('review-exchange-compare',{returnId:original.returnId,editionId:original.editionId,
   adoptionRequestId:original.adoptionRequestId});
  need(comparison.json.readOnly===true,'MONITORING_AGENT_RECEIVING_HISTORY');
  confirmations.push(await retainReply(join(directory,'original-adopted-comparison.json'),comparison,true));
  const files=[];
  for(const [role,expected,name]of [
   ['issued_json',original.issuedJson,'Original_Issued_Source.json'],
   ['issued_html',original.issuedHtml,'Original_Issued_Reviewer.html'],
   ['returned_file',original.returnedFile,'Original_Returned_File'+(original.returnedFile.path.toLowerCase().endsWith('.html')?'.html':'.json')],
  ]){
   const downloaded=await check.download('review-exchange',{id:role==='returned_file'?original.returnId:original.issueId,role,
    output:join(directory,name),expectedSha256:expected.sha256});
   files.push({path:downloaded.path,bytes:downloaded.bytes,sha256:downloaded.sha256});
  }
  await check.close();
  for(const client of clients)await client.close();
  const result={schema:SCHEMA,state:'COMPLETE',operationId:selection.operationId,setup:verified,
   transport:previous?'ORIGINAL_COMPLETED_COURSE_REOPENED_THROUGH_AGENT':'ORIGINAL_COURSE_THROUGH_AGENT',
   original,confirmations,files,ownedClientsClosed:true,
   visualAcceptance:'The producing owner must open and use the exact original and received product, view every retained screenshot, and open applicable source/evidence/returned files. Source or API completion is not rendered acceptance.'};
  const prior=await readJSON(join(output,'customer-agent-complete.json'),true);
  if(prior){
   // A completed direct course may later be reopened. Preserve its first final
   // record, and compare its actual original results/files, not a new transport label.
   need(same(prior.original,original)&&same(prior.files,files)&&same(prior.confirmations,confirmations),
    'MONITORING_AGENT_RECEIVING_COMPLETION_CHANGED');
   return prior;
  }
  await retainJSON(join(output,'customer-agent-complete.json'),result);return result;
 }catch(error){primary=error;throw error;}
 finally{
  const errors=[];
  for(const client of clients)try{await client.close();}catch(error){errors.push(error);}
  try{await lease.close();}catch(error){errors.push(error);}
  finishOwnedCleanup(primary,errors,'Original agent receiving cleanup remains unresolved.');
 }
}
export async function main(argv=process.argv.slice(2)){
 if(!argv.length||argv.includes('--help')){
  process.stdout.write('Complete original Source Monitoring reviewer receiving through customer-agent tools\n'+
   '--runtime-workspace DIR --plan PRIVATE_SETUP_PLAN --python ABS_PYTHON --output ORIGINAL_COURSE_OUTPUT --selection ORIGINAL_REVIEW_SELECTION\n'+
   'Borrow the original native service and receiver; no console or browser is launched. Awaiting real reviewer/supervisor work returns exit 2.\n');
  return 0;
 }
 const {values:v,positionals:p}=parseArgs({args:argv,allowPositionals:true,strict:true,options:Object.fromEntries(
  ['runtime-workspace','plan','python','output','selection'].map(k=>[k,{type:'string'}]))});
 need(!p.length&&Object.values(v).length===5,'MONITORING_AGENT_RECEIVING_CLI');
 for(const value of Object.values(v))absolute(value);
 const plan=await readJSON(v.plan),selection=JSON.parse((await regular(v.selection,24*1024*1024)).toString('utf8'));
 const model=await openRuntimeWorkspace({directory:v['runtime-workspace']});
 try{const result=await receiveSourceMonitoringCustomer({model,plan,pythonCommand:v.python,output:v.output,selection});
  process.stdout.write(json(result));return result.state==='COMPLETE'?0:2;
 }finally{await model.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
 main().then(code=>process.exitCode=code).catch(error=>{
  process.stderr.write(json({error:error.code??error.name,message:error.message}));process.exitCode=1;
 });
