// MIT. Documents/Pipelines compose the original Research attachment and exporter.
import {exact,failure} from './host-files.mjs';
import {RESEARCH_DOCUMENT_EXPORTS} from './catalog/research-documents.mjs';
export {researchDocumentTools} from './catalog/research-documents.mjs';

export const RESEARCH_DOCUMENT_PREFIXES=Object.freeze(['merchant_research_documents_','merchant_research_pipelines_']);
const selected=(input,keys)=>Object.fromEntries(keys.filter(key=>input[key]!==undefined).map(key=>[key,input[key]]));
function documentSelection(input,{receiving=false}={}){
  if(receiving){
    if(input.purchaseId===undefined||input.editionId!==undefined)
      throw failure('INVALID_PARAMS','Select the original saved document purchase to receive.');
  }else if((input.purchaseId!==undefined)===(input.editionId!==undefined))
    throw failure('INVALID_PARAMS','Select exactly one original document purchase or retained edition.');
  return selected(input,['purchaseId','editionId']);
}
function pipelineSelection(input,{receiving=false}={}){
  if(input.editionId!==undefined){
    if(receiving||input.operationId!==undefined||input.outputId!==undefined)
      throw failure('INVALID_PARAMS','Select one retained edition, or one original operation/output pair.');
  }else if(input.operationId===undefined||input.outputId===undefined)
    throw failure('INVALID_PARAMS','Select the original operation and its retained output.');
  return selected(input,['operationId','outputId','editionId']);
}
function facades(client){
  if(!client||typeof client.documents!=='function'||typeof client.pipelines!=='function')
    throw failure('RESEARCH_DOCUMENT_CLIENT_REQUIRED','Use the original Research client with Documents and Pipelines.');
  return {documents:client.documents(),pipelines:client.pipelines()};
}
const elementFields=['expectedEditionSha256','offset','limit','page','type','query'];
const actionFields={
  submit:['requestId','expectedRevision','expectedPlanSha256'],
  refresh:['requestId','expectedRevision'],
  cancel:['requestId','expectedRevision','reason'],
  reconcile:['requestId','expectedRevision','expectedPlanSha256','providerJobId','reason'],
  retain:['requestId','expectedRevision','fileId','nodeId'],
};

/** Invoked within the original merchant attachment's pending request scope. */
export async function callResearchDocuments(client,name,args,{source}={}){
  const {documents,pipelines}=facades(client),id=args.dossierId;
  switch(name){
    case 'merchant_research_documents_list':return documents.list(id,selected(args,['after','limit']));
    case 'merchant_research_documents_review':return documents.review(id,documentSelection(args));
    case 'merchant_research_documents_elements':return documents.elements(id,
      {selection:documentSelection(args),...selected(args,elementFields)});
    case 'merchant_research_documents_receive':return documents.receive(id,
      {selection:documentSelection(args,{receiving:true}),...selected(args,
        ['expectedEditionSha256','questionId','label','expectedRevision'])});
    case 'merchant_research_pipelines_list':return pipelines.list(id,selected(args,['after','limit']));
    case 'merchant_research_pipelines_operation':return pipelines.operation(id,args.operationId);
    case 'merchant_research_pipelines_prepare':{
      if(typeof source!=='function'||!Array.isArray(args.inputSources)||args.inputSources.length<1)
        throw failure('RESEARCH_SOURCE_REQUIRED','Select the configured original pipeline-input sources.');
      const files=args.inputSources.map(name=>{
        const original=source(name,['pipeline-input']);
        return selected(original,['file','sha256','filename','contentType']);
      });
      return pipelines.prepareFiles(id,{...selected(args,
        ['requestId','profileId','questionId','label','expectedRevision']),files});
    }
    case 'merchant_research_pipelines_provider_jobs':return pipelines.providerJobs(id,args.operationId,
      selected(args,['workflowId','status']));
    case 'merchant_research_pipelines_review':return pipelines.review(id,pipelineSelection(args));
    case 'merchant_research_pipelines_elements':return pipelines.elements(id,
      {selection:pipelineSelection(args),...selected(args,elementFields)});
    case 'merchant_research_pipelines_receive':return pipelines.receive(id,
      {selection:pipelineSelection(args,{receiving:true}),...selected(args,
        ['requestId','expectedEditionSha256','questionId','label','expectedRevision'])});
    default:{
      const action=name.slice('merchant_research_pipelines_'.length);
      if(!Object.hasOwn(actionFields,action)||name!=='merchant_research_pipelines_'+action)
        throw failure('TOOL_NOT_FOUND','Choose an original Documents or Pipelines operation.');
      return pipelines[action==='retain'?'retainOutput':action](id,args.operationId,selected(args,actionFields[action]));
    }
  }
}

/** Uses the existing Research download, export ledger and complete chunk reader. */
export async function exportResearchDocuments(client,args,{file,download=work=>work()}={}){
  const {documents,pipelines}=facades(client),spec=RESEARCH_DOCUMENT_EXPORTS[args.kind];
  if(!spec)throw failure('INVALID_PARAMS','Select an original document or pipeline export.');
  const common=['workspace','dossierId','kind','expectedSha256'],id=args.dossierId;
  const options={file,...selected(args,['expectedSha256'])};
  let result,selection;
  if(spec.documentFile){
    exact(args,[...common,'purchaseId','editionId','expectedEditionSha256'],
      ['workspace','dossierId','kind','expectedEditionSha256']);
    const original=documentSelection(args);
    result=await download(()=>documents.download(id,{...options,selection:original,kind:spec.documentFile,
      expectedEditionSha256:args.expectedEditionSha256}));
    selection={dossierId:id,...original,expectedEditionSha256:args.expectedEditionSha256};
  }else if(spec.pipelinePart){
    const field=spec.pipelinePart==='input'?'inputId':'outputId';
    exact(args,[...common,'operationId',field],['workspace','dossierId','kind','operationId',field]);
    result=await download(()=>pipelines[spec.pipelinePart==='input'?'downloadInput':'downloadOutput'](
      id,args.operationId,args[field],options));
    selection={dossierId:id,operationId:args.operationId,[field]:args[field]};
  }else{
    exact(args,[...common,'operationId','outputId','editionId','expectedEditionSha256'],
      ['workspace','dossierId','kind','expectedEditionSha256']);
    const original=pipelineSelection(args);
    result=await download(()=>pipelines.downloadReceived(id,{...options,selection:original,kind:spec.pipelineFile,
      expectedEditionSha256:args.expectedEditionSha256}));
    selection={dossierId:id,...original,expectedEditionSha256:args.expectedEditionSha256};
  }
  return {result,selection};
}
