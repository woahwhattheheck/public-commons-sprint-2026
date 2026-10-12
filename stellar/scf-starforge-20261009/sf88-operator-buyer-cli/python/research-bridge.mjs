// MIT. Python calls the original Research SDK through the existing Node runtime.
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readResearchHostFile} from '../research-dossiers/workspace-files.mjs';
import {ResearchWorkspaceClient} from '../research-dossiers/workspace-client.mjs';
import {need,object,parseJson} from '../node/store.mjs';
import {createResearchDocumentSource} from './research-document-source.mjs';
import {citationReviewInput,citationDigest} from '../research-dossiers/citation-updates.mjs';
import {exportCitationFile,receiveCitationFile} from './research-citation-delivery.mjs';
import {readResearchExtraction,reviewResearchExtraction} from '../research-dossiers/research-extraction-transport.mjs';
import {eligibilityConsumerInput,readEligibility,submitEligibility,exportEligibility} from '../research-dossiers/eligibility-consumer.mjs';
import {exportEligibilityDeliveryFile,receiveEligibilityFile} from './research-eligibility-delivery.mjs';

const MODE='RESEARCH_WORKSPACE_BRIDGE',SCHEMA='stellar-forge.research-python-call.v1';
const safeCode=value=>typeof value==='string'&&/^[A-Z0-9_]{1,120}$/.test(value)?value:'RESEARCH_NATIVE_CALL_FAILED';
function errorRecord(error){
  const record={error:safeCode(error?.code)};
  for(const key of ['status','outcomeUnknown','method','route','recovery','requestId','operationId',
    'destinationPublished','file','sourceCleanupFailed','clientWarnings','openAlexImport'])
    if(error?.[key]!==undefined)record[key]=error[key];
  return record;
}
async function dispatch(client,action,input,signal){
  const {dossierId,operationId,selection,options={},body={}}=input;
  const requestOptions={...options,signal};
  switch(action){
    case 'status':return client.status(requestOptions);
    case 'dossiers':return client.list(options);
    case 'metadata':return client.metadata(dossierId,options);
    case 'section':return client.section(dossierId,options);
    case 'create-dossier':return client.createDossier(body);
    case 'update-dossier':return client.updateDossier(dossierId,body);
    case 'add-question':return client.addQuestion(dossierId,body);
    case 'update-question':return client.updateQuestion(dossierId,input.questionId,body);
    case 'add-finding':return client.addFinding(dossierId,body);
    case 'update-finding':return client.updateFinding(dossierId,input.findingId,body);
    case 'select-evidence':return client.selectEvidence(dossierId,body);
    case 'update-selection':return client.updateSelection(dossierId,body);
    case 'compare':return client.compare(dossierId,options);
    case 'eligibility':return readEligibility(client,dossierId,options);
    case 'eligibility-review':return submitEligibility(client,dossierId,body);
    case 'eligibility-export':return exportEligibility(client,dossierId,requestOptions);
    case 'eligibility-delivery-export':return exportEligibilityDeliveryFile(client,input);
    case 'citation-updates':return client.citationUpdates(dossierId,options);
    case 'citation-review':return client.reviewCitationUpdate(dossierId,body);
    case 'citation-export':return exportCitationFile(client,input);
    case 'extraction':return readResearchExtraction(client,dossierId,options,{signal});
    case 'extraction-source-values':return readResearchExtraction(client,dossierId,options,{sourceValues:true,signal});
    case 'extraction-publications':return readResearchExtraction(client,dossierId,options,{publication:true,signal});
    case 'extraction-review':return reviewResearchExtraction(client,dossierId,body,{signal});
    case 'extraction-publication-review':return reviewResearchExtraction(client,dossierId,body,{publication:true,signal});
    case 'extraction-export':return client.exportExtraction(dossierId,requestOptions);
    case 'extraction-publication-export':return client.exportExtractionPublication(dossierId,requestOptions);
    case 'export-dossier':return client.exportDossier(dossierId,requestOptions);
    case 'export-edition':return client.exportRetainedEdition(dossierId,input.editionId,requestOptions);
    case 'export-comparison':return client.exportComparison(dossierId,requestOptions);
    case 'reopen-dossier':return client.reopenFile(input.file,requestOptions);
    case 'receive-research-file':return client.receiveResearchFile(dossierId,body);
    case 'documents-list':return client.documents().list(dossierId,requestOptions);
    case 'documents-review':return client.documents().review(dossierId,selection,requestOptions);
    case 'documents-elements':return client.documents().elements(dossierId,body,requestOptions);
    case 'documents-receive':return client.documents().receive(dossierId,body,requestOptions);
    case 'documents-download':return client.documents().download(dossierId,{...body,...requestOptions});
    case 'pipelines-list':return client.pipelines().list(dossierId,requestOptions);
    case 'pipelines-operation':return client.pipelines().operation(dossierId,operationId,requestOptions);
    case 'pipelines-prepare':return client.pipelines().prepareFiles(dossierId,body,requestOptions);
    case 'pipelines-submit':return client.pipelines().submit(dossierId,operationId,body,requestOptions);
    case 'pipelines-refresh':return client.pipelines().refresh(dossierId,operationId,body,requestOptions);
    case 'pipelines-cancel':return client.pipelines().cancel(dossierId,operationId,body,requestOptions);
    case 'pipelines-provider-jobs':return client.pipelines().providerJobs(dossierId,operationId,body,requestOptions);
    case 'pipelines-reconcile':return client.pipelines().reconcile(dossierId,operationId,body,requestOptions);
    case 'pipelines-retain':return client.pipelines().retainOutput(dossierId,operationId,body,requestOptions);
    case 'pipelines-review':return client.pipelines().review(dossierId,selection,requestOptions);
    case 'pipelines-elements':return client.pipelines().elements(dossierId,body,requestOptions);
    case 'pipelines-receive':return client.pipelines().receive(dossierId,body,requestOptions);
    case 'pipelines-download-input':return client.pipelines().downloadInput(dossierId,operationId,input.inputId,requestOptions);
    case 'pipelines-download-output':return client.pipelines().downloadOutput(dossierId,operationId,input.outputId,requestOptions);
    case 'pipelines-download':return client.pipelines().downloadReceived(dossierId,{...body,...requestOptions});
    default:need(false,'RESEARCH_PYTHON_ACTION_INVALID');
  }
}
export async function runResearchCall(request,{signal}={}){
  need(object(request)&&request.schema===SCHEMA&&typeof request.action==='string'&&object(request.input),
    'RESEARCH_PYTHON_REQUEST_INVALID');
  if(request.action==='eligibility-input')
    return {mode:MODE,ok:true,workspaceId:null,result:eligibilityConsumerInput(request.input.request)};
  if(request.action==='eligibility-receive')
    return {mode:MODE,ok:true,workspaceId:null,result:await receiveEligibilityFile(request.input)};
  if(request.action==='citation-review-input'){
    need(Buffer.byteLength(JSON.stringify(request.input.request))<=16*1024*1024,'CITATION_REVIEW_INPUT_TOO_LARGE');
    const value=citationReviewInput(request.input.request);
    return {mode:MODE,ok:true,workspaceId:null,result:{request:value,sha256:citationDigest(value)}};
  }
  if(request.action==='citation-receive')
    return {mode:MODE,ok:true,workspaceId:null,result:await receiveCitationFile(request.input)};
  if(request.action==='analysis-source'){
    return {mode:MODE,ok:true,workspaceId:null,
      result:await createResearchDocumentSource(request.input)};
  }
  need(typeof request.connectionFile==='string','RESEARCH_CONNECTION_FILE_REQUIRED');
  need(request.expectedWorkspaceId===undefined||/^research_[a-f0-9]{64}$/.test(request.expectedWorkspaceId),
    'RESEARCH_WORKSPACE_ID_INVALID');
  const client=new ResearchWorkspaceClient({connectionFile:resolve(request.connectionFile),
    ...(request.expectedWorkspaceId?{expectedWorkspaceId:request.expectedWorkspaceId}:{})},
    {timeoutMs:request.timeoutMs??120000});
  let result;
  try{
    // Bind the original server/workspace before any selected write. Connection
    // credentials remain in its original private file and never enter results.
    const status=await client.status({signal});
    result={mode:MODE,ok:true,workspaceId:status.workspaceId,
      result:request.action==='status'?status:await dispatch(client,request.action,request.input,signal)};
  }catch(error){
    result={mode:MODE,ok:false,workspaceId:client.workspaceId,...errorRecord(error)};
  }finally{
    try{await client.close();}
    catch(error){
      if(result)result.sourceCleanupFailed=safeCode(error?.code);
      else throw error;
    }
  }
  return result;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  let result,controller=new AbortController();
  const cancel=()=>controller.abort();
  process.once('SIGTERM',cancel);process.once('SIGINT',cancel);
  try{
    need(process.argv.length===4&&process.argv[2]==='--request','RESEARCH_PYTHON_REQUEST_FILE_REQUIRED');
    const request=parseJson(await readResearchHostFile(resolve(process.argv[3]),32*1024*1024,{privateFile:true}));
    result=await runResearchCall(request,{signal:controller.signal});
  }catch(error){result={mode:MODE,ok:false,...errorRecord(error)};}
  finally{process.removeListener('SIGTERM',cancel);process.removeListener('SIGINT',cancel);}
  process.stdout.write(JSON.stringify(result)+'\n');
  if(!result.ok){process.stderr.write(JSON.stringify({error:result.error})+'\n');process.exitCode=1;}
}
