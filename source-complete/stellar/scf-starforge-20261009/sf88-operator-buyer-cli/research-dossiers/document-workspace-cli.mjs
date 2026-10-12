#!/usr/bin/env node
// MIT. Full Documents and Pipelines operations through the original Research client.
import {parseArgs} from 'node:util';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ResearchWorkspaceClient,researchSummary} from './workspace-client.mjs';
import {readResearchHostFile} from './workspace-files.mjs';
import {parseJson,need,object,safeCode} from '../node/store.mjs';

const commandOptions=Object.freeze({
  'documents-list':['after','limit'],
  'documents-review':['input'],'documents-elements':['input'],
  'documents-receive':['input'],'documents-download':['input','out','sha256'],
  'pipelines-list':['after','limit'],'pipelines-operation':['operation'],
  'pipelines-prepare':['input'],
  'pipelines-submit':['operation','input'],'pipelines-refresh':['operation','input'],
  'pipelines-cancel':['operation','input'],'pipelines-reconcile':['operation','input'],
  'pipelines-retain':['operation','input'],'pipelines-provider-jobs':['operation','input'],
  'pipelines-review':['input'],'pipelines-elements':['input'],'pipelines-receive':['input'],
  'pipelines-input':['operation','file-id','out','sha256'],
  'pipelines-output':['operation','file-id','out','sha256'],
  'pipelines-download':['input','out','sha256'],
});
export const DOCUMENT_COMMANDS=Object.freeze(['documents-help',...Object.keys(commandOptions)]);

const usage="Research Documents and Pipelines\n\n  research-client COMMAND --connection-file /private/application-url.json --directory /original/dossier-store --id DOSSIER [OPTIONS]\n  research-dossiers remote COMMAND --connection-file /private/application-url.json --directory /original/dossier-store --id DOSSIER [OPTIONS]\n\nDocuments from completed original purchases or received editions:\n  documents-list [--after PURCHASE_ID --limit N]\n  documents-review --input SELECTION.json\n  documents-elements --input FILTER.json\n  documents-receive --input RECEIVING.json\n  documents-download --input DOWNLOAD.json --out NEW_FILE [--sha256 SHA256]\n\nSelection: {\"purchaseId\":\"u_...\"} or {\"editionId\":\"e_...\"}.\nFILTER: {\"selection\":SELECTION,\"expectedEditionSha256\":\"...\",\"offset\":0,\"limit\":30,\n         \"page\":\"\",\"type\":\"\",\"query\":\"\"}\nRECEIVING: {\"selection\":{\"purchaseId\":\"u_...\"},\"expectedEditionSha256\":\"...\",\n            \"questionId\":\"q_...\",\"label\":\"Original document\",\"expectedRevision\":N}\nDOWNLOAD: {\"selection\":SELECTION,\"expectedEditionSha256\":\"...\",\n           \"kind\":\"document|response|edition\"}\n\nPrepare and operate an original managed pipeline:\n  pipelines-list [--after OPERATION_ID --limit N]\n  pipelines-operation --operation OPERATION_ID\n  pipelines-prepare --input PREPARATION.json\n  pipelines-submit|pipelines-refresh|pipelines-cancel|pipelines-reconcile|pipelines-retain\n      --operation OPERATION_ID --input ACTION.json\n  pipelines-provider-jobs --operation OPERATION_ID [--input FILTER.json]\n\nPREPARATION:\n  {\"requestId\":\"original-request\",\"profileId\":\"configured-profile\",\"questionId\":\"q_...\",\n   \"label\":\"Original processing\",\"expectedRevision\":N,\n   \"files\":[{\"file\":\"source.pdf\",\"sha256\":\"...\",\n             \"filename\":\"source.pdf\",\"contentType\":\"application/pdf\"}]}\nRelative source paths are resolved against PREPARATION.json. All source files are\nverified before upload. The existing source limits and workspace upload cap apply.\n\nACTION uses the original OPERATION revision, including revision zero:\n  submit:    {\"requestId\":\"submit-1\",\"expectedRevision\":N,\"expectedPlanSha256\":\"...\"}\n  refresh:   {\"requestId\":\"observe-1\",\"expectedRevision\":N}\n  cancel:    {\"requestId\":\"cancel-1\",\"expectedRevision\":N,\"reason\":\"Operator decision\"}\n  reconcile: {\"requestId\":\"reconcile-1\",\"expectedRevision\":N,\"expectedPlanSha256\":\"...\",\n              \"providerJobId\":\"original-provider-job\",\"reason\":\"Matched original job\"}\n  retain:    {\"requestId\":\"retain-1\",\"expectedRevision\":N,\"fileId\":\"provider-file\",\"nodeId\":\"provider-node\"}\nProvider-job FILTER may contain workflowId and status.\n\nReview, receive and download original pipeline results:\n  pipelines-review --input SELECTION.json\n  pipelines-elements --input FILTER.json\n  pipelines-receive --input RECEIVING.json\n  pipelines-input|pipelines-output --operation OPERATION_ID --file-id ORIGINAL_FILE_ID\n      --out NEW_FILE [--sha256 SHA256]\n  pipelines-download --input DOWNLOAD.json --out NEW_FILE [--sha256 SHA256]\n\nPipeline SELECTION: {\"operationId\":\"up_...\",\"outputId\":\"out_...\"} or {\"editionId\":\"e_...\"}.\nFILTER has the same fields as the Documents filter.\nRECEIVING: {\"selection\":{\"operationId\":\"up_...\",\"outputId\":\"out_...\"},\n            \"requestId\":\"receive-1\",\"expectedEditionSha256\":\"...\",\"questionId\":\"q_...\",\n            \"label\":\"Received output\",\"expectedRevision\":N}\nDOWNLOAD: {\"selection\":SELECTION,\"expectedEditionSha256\":\"...\",\"kind\":\"output|edition\"}.\n\nPreparation and receiving use the DOSSIER revision. Submit/refresh/cancel/\nreconcile/retain use the saved OPERATION revision. Retention returns the out_...\nID used for review and receiving. A lost write reply stays with that original\nrequest and operation; read it before another action. Downloads write complete\noriginal bytes to a new file and return their size and digest on stdout.\n\nConnection files are private host files and are reread by the existing client.\n--timeout-ms N selects the existing client timeout. The full operating guide is\nRESEARCH_DOCUMENTS.md beside workspace-client.mjs.\n";

const selected=value=>Object.fromEntries(Object.entries(value).filter(([,item])=>item!==undefined));
const compact=value=>value?.dossier?{...value,dossier:researchSummary(value.dossier)}:value;
export async function main(argv=process.argv.slice(2),{output=process.stdout}={}){
  const [command,...args]=argv;
  if(command==='documents-help'||!command){output.write(usage);return;}
  need(Object.hasOwn(commandOptions,command),'COMMAND_UNKNOWN');
  const names=['connection-file','directory','timeout-ms','id',...commandOptions[command]];
  const {values,tokens}=parseArgs({args,options:Object.fromEntries(names.map(name=>[name,{type:'string'}])),
    strict:true,allowPositionals:false,tokens:true});
  const seen=new Set();
  for(const token of tokens)if(token.kind==='option'){
    need(!seen.has(token.name),'ARGUMENT_REPEATED');seen.add(token.name);
  }
  const required=name=>{need(typeof values[name]==='string'&&values[name].length>0,'ARGUMENT_REQUIRED');return values[name];};
  const number=name=>{
    if(values[name]===undefined)return undefined;
    need(/^(0|[1-9][0-9]{0,8})$/.test(values[name]),'INTEGER_ARGUMENT_REQUIRED');return Number(values[name]);
  };
  const digest=()=>{
    if(values.sha256===undefined)return undefined;
    need(/^[a-f0-9]{64}$/.test(values.sha256),'RESEARCH_SHA256_REQUIRED');return values.sha256;
  };
  const input=async()=>{
    const value=parseJson(await readResearchHostFile(resolve(required('input')),2*1024*1024));
    need(object(value),'REQUEST_OBJECT_REQUIRED');return value;
  };
  const id=required('id');
  const client=new ResearchWorkspaceClient({connectionFile:resolve(required('connection-file')),directory:resolve(required('directory'))},
    values['timeout-ms']===undefined?{}:{timeoutMs:number('timeout-ms')});
  try{
    await client.status();
    const documents=client.documents(),pipelines=client.pipelines();
    const page=selected({after:values.after,limit:number('limit')});
    const outputFile=()=>({file:resolve(required('out')),...selected({expectedSha256:digest()})});
    let result;
    switch(command){
      case 'documents-list':result=await documents.list(id,page);break;
      case 'documents-review':result=await documents.review(id,await input());break;
      case 'documents-elements':result=await documents.elements(id,await input());break;
      case 'documents-receive':result=await documents.receive(id,await input());break;
      case 'documents-download':{
        const request=await input();
        need(Object.keys(request).every(key=>['selection','expectedEditionSha256','kind'].includes(key)),
          'UNSTRUCTURED_DOWNLOAD_SELECTION_INVALID');
        result=await documents.download(id,{...request,...outputFile()});break;
      }
      case 'pipelines-list':result=await pipelines.list(id,page);break;
      case 'pipelines-operation':result=await pipelines.operation(id,required('operation'));break;
      case 'pipelines-prepare':{
        const request=await input();
        need(Array.isArray(request.files),'PIPELINE_INPUT_SELECTION_REQUIRED');
        const root=dirname(resolve(required('input')));
        request.files=request.files.map(item=>{
          need(object(item)&&typeof item.file==='string'&&item.file.length>0,'RESEARCH_ORIGINAL_FILE_REQUIRED');
          return {...item,file:resolve(root,item.file)};
        });
        result=await pipelines.prepareFiles(id,request);break;
      }
      case 'pipelines-submit':result=await pipelines.submit(id,required('operation'),await input());break;
      case 'pipelines-refresh':result=await pipelines.refresh(id,required('operation'),await input());break;
      case 'pipelines-cancel':result=await pipelines.cancel(id,required('operation'),await input());break;
      case 'pipelines-reconcile':result=await pipelines.reconcile(id,required('operation'),await input());break;
      case 'pipelines-retain':result=await pipelines.retainOutput(id,required('operation'),await input());break;
      case 'pipelines-provider-jobs':result=await pipelines.providerJobs(id,required('operation'),values.input?await input():{});break;
      case 'pipelines-review':result=await pipelines.review(id,await input());break;
      case 'pipelines-elements':result=await pipelines.elements(id,await input());break;
      case 'pipelines-receive':result=await pipelines.receive(id,await input());break;
      case 'pipelines-input':result=await pipelines.downloadInput(id,required('operation'),required('file-id'),outputFile());break;
      case 'pipelines-output':result=await pipelines.downloadOutput(id,required('operation'),required('file-id'),outputFile());break;
      case 'pipelines-download':{
        const request=await input();
        need(Object.keys(request).every(key=>['selection','expectedEditionSha256','kind'].includes(key)),
          'PIPELINE_DOWNLOAD_SELECTION_INVALID');
        result=await pipelines.downloadReceived(id,{...request,...outputFile()});break;
      }
    }
    result=compact(result);output.write(JSON.stringify(result,null,2)+'\n');return result;
  }finally{await client.close();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  main().catch(error=>{
    process.stderr.write(JSON.stringify({error:safeCode(error.code,'RESEARCH_DOCUMENT_COMMAND_FAILED'),
      ...(Number.isInteger(error.status)?{status:error.status}:{}),
      ...(error.destinationPublished?{destinationPublished:true,file:error.file}:{}),
      ...(error.sourceCleanupFailed?{sourceCleanupFailed:true}:{}),
      ...(error.outcomeUnknown?{outcomeUnknown:true,requestId:error.requestId,operationId:error.operationId,
        recovery:error.recovery??'Read the original saved request and operation before another action.'}:{})})+'\n');
    process.exitCode=1;
  });
}
