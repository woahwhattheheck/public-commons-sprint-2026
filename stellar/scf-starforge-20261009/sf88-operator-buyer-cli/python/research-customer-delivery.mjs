// MIT. Full Python customer delivery through the original Research operators.
import {resolve,join} from 'node:path';
import {exists,digest,parseJson} from '../node/store.mjs';
import {readResearchHostFile} from '../research-dossiers/workspace-files.mjs';
import {customerFields,customerJson,customerUpdateInput,customerHash,requireCustomerUpdate as need,
  CUSTOMER_UPDATE_LIMIT} from '../research-dossiers/customer-updates/contracts.mjs';
import {customerUpdateDigest,customerUpdateSame} from '../research-dossiers/customer-updates/context.mjs';
import {withCustomerOperation,readCustomerJson,retainCustomerBytes,copyCustomerFile,inspectCustomerHandover}
  from '../research-dossiers/customer-updates/files.mjs';
import {submitCustomerUpdate,createCustomerHandover,receiveCustomerHandover,retainCustomerExport,readCustomerOperation}
  from '../research-dossiers/customer-updates/operator.mjs';
import {runResearchCustomerDelivery} from '../research-dossiers/customer-updates/receiving.mjs';

const MODE='RESEARCH_WORKSPACE_BRIDGE',SCHEMA='sf88-research-customer-python-response/v1';
export const CUSTOMER_PYTHON_RESPONSE_LIMIT=96*1024*1024+65536;
const allowed=Object.freeze({
  'customer-updates':['dossierId','options'],
  'customer-update-record':['dossierId','input'],
  'customer-update-preview':['dossierId','input'],
  'customer-update-work':['dossierId','input'],
  'customer-update-plan':['input'],
  'customer-update-input':['request'],
  'customer-update-submit':['directory','dossierId','input','inputFile','inputSha256','inputBytes'],
  'customer-update-replay':['directory','dossierId','request'],
  'customer-update-export':['directory','dossierId','deliveryId','workId','revision','format','expectedSha256'],
  'customer-handover-create':['directory','dossierId','deliveryId','revision','sourceWorkspace'],
  'customer-handover-inspect':['directory','manifestSha256'],
  'customer-handover-receive':['directory','dossierId','sourceDirectory','manifestSha256','sourceActor'],
  'customer-operation-inspect':['directory'],
  'customer-delivery-programme':['directory','dossierId','caseDefinition','receiver'],
});
const ownedOperations=new Set(['customer-update-submit','customer-update-export',
  'customer-handover-create','customer-handover-receive','customer-delivery-programme']);
const offline=new Set(['customer-update-input','customer-handover-inspect','customer-operation-inspect']);
const clone=value=>structuredClone(value);
const safeCode=value=>typeof value==='string'&&/^[A-Z0-9_]{1,120}$/.test(value)?value:'RESEARCH_CUSTOMER_CALL_FAILED';
export const isResearchCustomerCall=action=>Object.hasOwn(allowed,action);
function stopped(signal){
  if(signal?.aborted)throw Object.assign(new Error('RESEARCH_CUSTOMER_CALL_CANCELLED'),{
    code:'RESEARCH_CUSTOMER_CALL_CANCELLED',outcomeUnknown:false});
}
function errorRecord(error){
  const result={error:safeCode(error?.code)};
  for(const key of ['status','outcomeUnknown','method','route','recovery','requestId','operationId',
    'destinationPublished','file','sourceCleanupFailed','clientWarnings'])
    if(error?.[key]!==undefined)result[key]=error[key];
  return result;
}
function compact(value){
  const bytes=Buffer.from(JSON.stringify(value)+'\n');
  need(bytes.length<=CUSTOMER_PYTHON_RESPONSE_LIMIT,'RESEARCH_CUSTOMER_RESPONSE_TOO_LARGE');
  return bytes;
}
function descriptor(file,body){
  return {schema:'sf88-research-customer-python-file/v1',callSha256:body.callSha256,
    workspaceId:body.workspaceId,file:{file:file.path,bytes:file.bytes,sha256:file.sha256,
      contentType:'application/json; charset=utf-8'}};
}
function lazyOriginal(openClient,signal){
  let client=null,opening=null,status=null,epmc=null;
  const get=()=>{
    stopped(signal);
    if(!opening){
      need(typeof openClient==='function','CUSTOMER_UPDATE_ORIGINAL_CLIENT_REQUIRED');
      client=openClient();
      need(client&&typeof client.status==='function'&&typeof client.customerUpdates==='function',
        'CUSTOMER_UPDATE_ORIGINAL_CLIENT_REQUIRED');
      opening=client.status({signal}).then(value=>{status=value;return client;});
    }
    return opening;
  };
  const customers={};
  for(const name of ['list','record','preview','review','work']){
    customers[name]=async(id,input)=>{const original=await get();
      return original.customerUpdates()[name](id,input,{signal});};
  }
  customers.europePmcPlan=async input=>(await get()).customerUpdates().europePmcPlan(input,{signal});
  customers.export=async(id,input)=>(await get()).customerUpdates().export(id,{...input,signal});
  const source={};
  for(const name of ['list','exportWorkspace','downloadWorkspace','restoreFile']){
    source[name]=async input=>{
      const original=await get();epmc??=original.europePmc();
      // Original SDK owns selection headers and restore/upload publication. The
      // bridge's original fetch combines the accepted call signal for all methods.
      return epmc[name](input);
    };
  }
  return {
    facade:{
      status:async()=>{await get();return clone(status);},
      metadata:async(id,input)=>(await get()).metadata(id,input),
      customerUpdates:()=>customers,europePmc:()=>source,
      reopenFile:async(file,input)=>(await get()).reopenFile(file,{...input,signal}),
    },
    get workspaceId(){return client?.workspaceId??status?.workspaceId??null;},
    async close(){if(client)await client.close();},
  };
}
async function selectedInputFile(input,{completed=false,sourceRoot}={}){
  if(input.inputFile===undefined)return;
  need(typeof input.inputFile==='string'&&input.inputFile.length>0,'CUSTOMER_UPDATE_INPUT_FILE_REQUIRED');
  customerHash(input.inputSha256);
  need(Number.isSafeInteger(input.inputBytes)&&input.inputBytes>0&&input.inputBytes<=CUSTOMER_UPDATE_LIMIT,
    'CUSTOMER_UPDATE_INPUT_FILE_SIZE_INVALID');
  const retained=join(sourceRoot,'source-request.json'),present=await exists(resolve(input.inputFile));
  if(present){
    const body=await readResearchHostFile(resolve(input.inputFile),CUSTOMER_UPDATE_LIMIT,{sha256:input.inputSha256});
    need(body.length===input.inputBytes,'CUSTOMER_UPDATE_INPUT_FILE_CHANGED');
  }else need(completed||await exists(retained),'CUSTOMER_UPDATE_INPUT_FILE_REQUIRED');
  const file=await copyCustomerFile(input.inputFile,retained,{sha256:input.inputSha256,
    bytes:input.inputBytes,maximum:CUSTOMER_UPDATE_LIMIT});
  return file.path;
}
function operationInput(input){
  const {inputSha256,inputBytes,...value}=input;return value;
}
async function execute(action,input,client,{completed=false,sourceRoot,receiver}={}){
  switch(action){
    case 'customer-updates':return client.customerUpdates().list(input.dossierId,input.options??{});
    case 'customer-update-record':return client.customerUpdates().record(input.dossierId,input.input);
    case 'customer-update-preview':return client.customerUpdates().preview(input.dossierId,input.input);
    case 'customer-update-work':return client.customerUpdates().work(input.dossierId,input.input);
    case 'customer-update-plan':return client.customerUpdates().europePmcPlan(input.input);
    case 'customer-update-input':{
      const request=customerUpdateInput(input.request);
      return {request,sha256:customerUpdateDigest(request)};
    }
    case 'customer-update-submit':{
      const inputFile=await selectedInputFile(input,{completed,sourceRoot});
      return submitCustomerUpdate({client,...operationInput(input),...(inputFile?{inputFile}:{})});
    }
    case 'customer-update-replay':return client.customerUpdates().review(input.dossierId,customerUpdateInput(input.request));
    case 'customer-update-export':return retainCustomerExport({client,...input});
    case 'customer-handover-create':return createCustomerHandover({client,...input});
    case 'customer-handover-inspect':return inspectCustomerHandover(input.directory,{manifestSha256:input.manifestSha256});
    case 'customer-handover-receive':{
      const {dossierId,...selected}=input;
      need(typeof dossierId==='string'&&/^d_[a-f0-9-]{36}$/.test(dossierId),'DOSSIER_ID_INVALID');
      const retained=join(resolve(input.directory),'input','handover.json'),
        source=await exists(retained)?retained:join(resolve(input.sourceDirectory),'handover.json');
      const manifest=await readCustomerJson(source,64*1024*1024);
      need(manifest.sha256===input.manifestSha256&&manifest.value.selection?.dossierId===dossierId,
        'CUSTOMER_UPDATE_RECEIVING_DOSSIER_CHANGED');
      return receiveCustomerHandover({client,...selected});
    }
    case 'customer-operation-inspect':return readCustomerOperation(input.directory);
    case 'customer-delivery-programme':{
      need(input.caseDefinition?.dossierId===input.dossierId,'CUSTOMER_UPDATE_CASE_DOSSIER_CHANGED');
      if(completed){
        const selected=(await readCustomerJson(join(resolve(input.directory),'case.json'))).value,
          saved=(await readCustomerJson(join(resolve(input.directory),'result.json'))).value;
        need(customerUpdateSame(selected,input.caseDefinition)&&saved.caseSha256===customerUpdateDigest(selected),
          'CUSTOMER_UPDATE_NATIVE_CASE_CHANGED');
        need(saved.source?.workspaceId===client.workspaceId&&saved.receiver?.workspaceId===input.receiver.workspaceId,
          'CUSTOMER_UPDATE_CASE_WORKSPACE_CHANGED');
        const updated=await inspectCustomerHandover(join(resolve(input.directory),'delivery')),
          corrected=await inspectCustomerHandover(join(resolve(input.directory),'correction-delivery'));
        need(updated.manifestSha256===saved.delivery?.manifestSha256&&
          corrected.manifestSha256===saved.correctionDelivery?.manifestSha256,'CUSTOMER_UPDATE_HANDOVER_MANIFEST_CHANGED');
        return saved;
      }
      return runResearchCustomerDelivery({sender:client,receiver,directory:input.directory,caseDefinition:input.caseDefinition});
    }
    default:need(false,'RESEARCH_PYTHON_ACTION_INVALID');
  }
}
function resultWorkspace(action,value,original){
  if(offline.has(action))return null;
  return original.workspaceId??value?.workspaceId??value?.selection?.workspaceId??value?.source?.workspaceId??null;
}
export async function runResearchCustomerCall(request,{signal,openClient}={}){
  need(isResearchCustomerCall(request.action),'RESEARCH_PYTHON_ACTION_INVALID');
  customerFields(request.input,[...allowed[request.action],'responseDirectory'],'RESEARCH_CUSTOMER_INPUT_FIELDS_INVALID');
  need(typeof request.input.responseDirectory==='string'&&request.input.responseDirectory.length>0,
    'RESEARCH_CUSTOMER_RESPONSE_DIRECTORY_REQUIRED');
  need(request.expectedWorkspaceId===undefined||/^research_[a-f0-9]{64}$/.test(request.expectedWorkspaceId),
    'RESEARCH_WORKSPACE_ID_INVALID');
  const {responseDirectory,...raw}=request.input,input=customerJson(raw);
  need(Buffer.byteLength(JSON.stringify(input))<=32*1024*1024,'RESEARCH_CUSTOMER_INPUT_TOO_LARGE');
  if(input.directory!==undefined){
    need(typeof input.directory==='string'&&input.directory.length>0,'CUSTOMER_UPDATE_DIRECTORY_REQUIRED');
    need(resolve(input.directory)!==resolve(responseDirectory),'RESEARCH_CUSTOMER_RESPONSE_DIRECTORY_COLLISION');
  }
  const call={action:request.action,input,expectedWorkspaceId:request.expectedWorkspaceId??null},
    callSha256=customerUpdateDigest(call),original=lazyOriginal(openClient,signal);
  let receiving=null;
  if(call.action==='customer-delivery-programme'){
    customerFields(input.receiver,['connectionFile','workspaceId'],'RESEARCH_CUSTOMER_RECEIVER_INVALID');
    need(typeof input.receiver.connectionFile==='string'&&
      /^research_[a-f0-9]{64}$/.test(input.receiver.workspaceId),'RESEARCH_CUSTOMER_RECEIVER_REQUIRED');
    receiving=lazyOriginal(()=>openClient({connectionFile:input.receiver.connectionFile,
      expectedWorkspaceId:input.receiver.workspaceId}),signal);
  }
  let response,dispatched=false;
  try{
    response=await withCustomerOperation(responseDirectory,async root=>{
      const replyPath=join(root,'response.json');
      const requestBody=compact({schema:'sf88-research-customer-python-call/v1',call,callSha256});
      await retainCustomerBytes(root,'request.json',requestBody);
      if(await exists(replyPath)){
        const saved=await readCustomerJson(replyPath,CUSTOMER_PYTHON_RESPONSE_LIMIT);
        need(saved.value.schema===SCHEMA&&saved.value.callSha256===callSha256&&
          customerUpdateSame(saved.value.call,call),'RESEARCH_CUSTOMER_RESPONSE_CHANGED');
        if(ownedOperations.has(call.action)){
          // Reopen the original complete operation and selected full files.
          // A completed result never falls through to a new remote mutation.
          await execute(call.action,input,call.action==='customer-delivery-programme'?{workspaceId:saved.value.workspaceId}:null,
            {completed:true,sourceRoot:root});
        }
        const file=await retainCustomerBytes(root,'response.json',saved.body);
        return {mode:MODE,ok:true,workspaceId:saved.value.workspaceId,result:descriptor(file,saved.value)};
      }
      stopped(signal);
      dispatched=true;
      const value=await execute(call.action,input,original.facade,{sourceRoot:root,receiver:receiving?.facade}),
        workspaceId=resultWorkspace(call.action,value,original);
      need(offline.has(call.action)||typeof workspaceId==='string'&&/^research_[a-f0-9]{64}$/.test(workspaceId),
        'RESEARCH_CUSTOMER_WORKSPACE_REQUIRED');
      need(!workspaceId||!call.expectedWorkspaceId||workspaceId===call.expectedWorkspaceId,'RESEARCH_WORKSPACE_CHANGED');
      if(call.action==='customer-delivery-programme')need(value.receiver?.workspaceId===input.receiver.workspaceId,
        'CUSTOMER_UPDATE_CASE_WORKSPACE_CHANGED');
      const body={schema:SCHEMA,call,callSha256,workspaceId,result:value};
      const file=await retainCustomerBytes(root,'response.json',compact(body));
      return {mode:MODE,ok:true,workspaceId,result:descriptor(file,body)};
    });
  }catch(error){
    response={mode:MODE,ok:false,workspaceId:original.workspaceId,...errorRecord(error)};
    if(dispatched&&(ownedOperations.has(call.action)||call.action==='customer-update-replay')&&
      error?.code==='RESEARCH_CUSTOMER_CALL_CANCELLED')
      response.outcomeUnknown=true;
  }finally{
    const closed=await Promise.allSettled([original.close(),...(receiving?[receiving.close()]:[])]);
    const failed=closed.find(item=>item.status==='rejected');
    if(failed){
      if(response)response.sourceCleanupFailed=safeCode(failed.reason?.code);
      else throw failed.reason;
    }
  }
  return response;
}
