#!/usr/bin/env node
// MIT. Operate the same original Research listener from a local command.
import {parseArgs} from 'node:util';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ResearchWorkspaceClient,researchSummary} from './workspace-client.mjs';
import {readResearchHostFile} from './workspace-files.mjs';
import {parseJson,need,safeCode} from '../node/store.mjs';

const usage=String.raw`Research workspace client

  research-client COMMAND --connection-file /private/application-url.json --directory /original/dossier-store [OPTIONS]
  research-dossiers remote COMMAND --connection-file /private/application-url.json --directory /original/dossier-store [OPTIONS]

Read the existing workspace:
  status
  list [--offset N --limit N --snapshot SHA256]
  metadata --id DOSSIER [--revision N]
  section --id DOSSIER --section questions|editions|selections|findings|sources|revisions
          [--revision N --offset N --limit N --question ID --query TEXT --selected true|false]
  compare --id DOSSIER --before N --after N [--section overview|added|removed|changed|questions|editions|availability|findings-added|findings-removed|findings-changed --offset N --limit N]

Write an original reviewed request from JSON:
  create --input REQUEST.json
  update|question-add|evidence|selection|finding-add --id DOSSIER --input REQUEST.json
  question-update --id DOSSIER --question QUESTION --input REQUEST.json
  finding-update --id DOSSIER --finding FINDING --input REQUEST.json
  receive --id DOSSIER --input REQUEST.json --source-file RESPONSE.json --sha256 SHA256
  reference --id DOSSIER --input REQUEST.json --source-file REFERENCE.json --sha256 SHA256
  openalex-editions
  receive-openalex --id DOSSIER --input REQUEST.json

Receive a completed original Object Buyer file:
  object-inputs --id DOSSIER [--after-session NAME --snapshot SHA256 --limit N]
  object-reviews --id DOSSIER [--after-review ID --limit N]
  object-review --id DOSSIER --input REVIEW_REQUEST.json
  object-prepare --id DOSSIER --input PREPARE_REQUEST.json
  pipeline-list --id DOSSIER [--after-operation ID --limit N]
  pipeline-review --id DOSSIER --operation ID

Review captures the exact saved delivery; it does not acquire, assemble or pay.
Preparation binds that review to an original managed processing operation.
Submit, monitor and receive that same operation in the existing Pipelines pane.

Operate the saved original Crossref acquisition:
  crossref-prepare --id DOSSIER --input PLAN_REQUEST.json
  crossref-list --id DOSSIER [--after-operation ID --limit N]
  crossref-review --id DOSSIER --operation ID [--section overview|dois|records|added|removed|changed|warnings --offset N --limit N]
  crossref-start --id DOSSIER --operation ID --plan-sha256 SHA256
  crossref-stop --id DOSSIER --operation ID
  crossref-receive --id DOSSIER --operation ID --input REVIEWED_RECEIVE.json

Retain and reopen complete original files:
  export --id DOSSIER --format json|json.gz|md|html --out NEW_FILE
  export-crossref --id DOSSIER --operation ID --out NEW_FILE
  export-edition --id DOSSIER --edition ID --out NEW_FILE
  export-compare --id DOSSIER --before N --after N --out NEW_FILE
  reopen --source-file PORTABLE_JSON_OR_GZIP --sha256 SHA256

Mutation JSON uses the original fields, including expectedRevision. Crossref
preparation keeps requestId, questionId and the reviewed expectedRevision;
receive keeps expectedRevision, expectedPlanSha256 and expectedEditionSha256.
Page zero returns the revision or snapshot required by subsequent pages.
A lost write reply is reconciled through that same dossier/operation.
The private startup file is reread on every call. Closing this client leaves
the original Applications listener and saved acquisitions with their owner.
`;

const commandOptions=Object.freeze({
  status:[],list:['offset','limit','snapshot'],metadata:['id','revision'],
  section:['id','section','revision','offset','limit','question','query','selected'],
  create:['input'],update:['id','input'],'question-add':['id','input'],
  'question-update':['id','question','input'],evidence:['id','input'],selection:['id','input'],
  'finding-add':['id','input'],'finding-update':['id','finding','input'],
  compare:['id','before','after','section','offset','limit'],
  receive:['id','input','source-file','sha256'],reference:['id','input','source-file','sha256'],
  'openalex-editions':[],'receive-openalex':['id','input'],
  'object-inputs':['id','after-session','snapshot','limit'],
  'object-reviews':['id','after-review','limit'],'object-review':['id','input'],'object-prepare':['id','input'],
  'pipeline-list':['id','after-operation','limit'],'pipeline-review':['id','operation'],
  'crossref-prepare':['id','input'],'crossref-list':['id','after-operation','limit'],
  'crossref-review':['id','operation','section','offset','limit'],
  'crossref-start':['id','operation','plan-sha256'],'crossref-stop':['id','operation'],
  'crossref-receive':['id','operation','input'],
  export:['id','format','out'],'export-crossref':['id','operation','out'],
  'export-edition':['id','edition','out'],'export-compare':['id','before','after','out'],
  reopen:['source-file','sha256'],
});
const compact=value=>value?.dossier?{...value,dossier:researchSummary(value.dossier)}:value;
const selected=value=>Object.fromEntries(Object.entries(value).filter(([,item])=>item!==undefined));
export async function main(argv=process.argv.slice(2),{output=process.stdout}={}){
  const [command,...args]=argv;
  if(!command||['help','--help','-h'].includes(command)){output.write(usage);return;}
  need(Object.hasOwn(commandOptions,command),'COMMAND_UNKNOWN');
  const fields=['connection-file','directory','timeout-ms',...commandOptions[command]];
  const {values,tokens}=parseArgs({args,options:Object.fromEntries(fields.map(key=>[key,{type:'string'}])),strict:true,tokens:true});
  const seen=new Set();
  for(const token of tokens)if(token.kind==='option'){need(!seen.has(token.name),'ARGUMENT_REPEATED');seen.add(token.name);}
  need(values['connection-file']&&values.directory,'RESEARCH_CONNECTION_AND_DIRECTORY_REQUIRED');
  const number=name=>{
    if(values[name]===undefined)return undefined;
    need(/^(0|[1-9][0-9]{0,8})$/.test(values[name]),'INTEGER_ARGUMENT_REQUIRED');return Number(values[name]);
  };
  const required=name=>{need(typeof values[name]==='string'&&values[name].length>0,'ARGUMENT_REQUIRED');return values[name];};
  const digest=name=>{const value=required(name);need(/^[a-f0-9]{64}$/.test(value),'RESEARCH_SHA256_REQUIRED');return value;};
  const input=async()=>parseJson(await readResearchHostFile(resolve(required('input')),2*1024*1024));
  const client=new ResearchWorkspaceClient({connectionFile:resolve(values['connection-file']),directory:resolve(values.directory)},
    values['timeout-ms']===undefined?{}:{timeoutMs:number('timeout-ms')});
  try{
    const status=await client.status();let result;
    const page=selected({offset:number('offset'),limit:number('limit')});
    switch(command){
      case 'status':result=status;break;
      case 'list':result=await client.list({...page,...selected({snapshot:values.snapshot})});break;
      case 'metadata':result=await client.metadata(required('id'),selected({revision:number('revision')}));break;
      case 'section':{
        need(values.selected===undefined||['true','false'].includes(values.selected),'SELECTION_REQUIRED');
        result=await client.section(required('id'),{...page,...selected({section:required('section'),revision:number('revision'),
          questionId:values.question,query:values.query,selected:values.selected===undefined?undefined:values.selected==='true'})});break;
      }
      case 'create':result=researchSummary(await client.createDossier(await input()));break;
      case 'update':result=researchSummary(await client.updateDossier(required('id'),await input()));break;
      case 'question-add':result=await client.addQuestion(required('id'),await input());break;
      case 'question-update':result=await client.updateQuestion(required('id'),required('question'),await input());break;
      case 'evidence':result=await client.selectEvidence(required('id'),await input());break;
      case 'selection':result=await client.updateSelection(required('id'),await input());break;
      case 'finding-add':result=await client.addFinding(required('id'),await input());break;
      case 'finding-update':result=await client.updateFinding(required('id'),required('finding'),await input());break;
      case 'compare':result=await client.compare(required('id'),{before:number('before'),after:number('after'),
        ...page,...selected({section:values.section})});break;
      case 'receive':result=await client.receiveResearchFile(required('id'),{...await input(),
        file:resolve(required('source-file')),sha256:digest('sha256')});break;
      case 'reference':{
        const reference=parseJson(await readResearchHostFile(resolve(required('source-file')),1024*1024,{sha256:digest('sha256')}));
        result=await client.receiveReference(required('id'),{...await input(),reference});break;
      }
      case 'openalex-editions':result=await client.openAlexEditions();break;
      case 'receive-openalex':result=await client.receiveOpenAlex(required('id'),await input());break;
      case 'object-inputs':result=await client.objectInputs(required('id'),selected({
        after:values['after-session'],snapshot:values.snapshot,limit:number('limit')}));break;
      case 'object-reviews':result=await client.objectReviews(required('id'),selected({
        after:values['after-review'],limit:number('limit')}));break;
      case 'object-review':result=await client.reviewObjectInput(required('id'),await input());break;
      case 'object-prepare':result=await client.prepareObjectPipeline(required('id'),await input());break;
      case 'pipeline-list':result=await client.pipelineOperations(required('id'),selected({
        after:values['after-operation'],limit:number('limit')}));break;
      case 'pipeline-review':result=await client.pipelineOperation(required('id'),required('operation'));break;
      case 'crossref-prepare':result=await client.prepareCrossref(required('id'),await input());break;
      case 'crossref-list':result=await client.crossrefOperations(required('id'),selected({after:values['after-operation'],limit:number('limit')}));break;
      case 'crossref-review':result=await client.reviewCrossref(required('id'),required('operation'),
        {...page,...selected({section:values.section})});break;
      case 'crossref-start':result=await client.startCrossref(required('id'),required('operation'),{expectedPlanSha256:digest('plan-sha256')});break;
      case 'crossref-stop':result=await client.stopCrossref(required('id'),required('operation'));break;
      case 'crossref-receive':result=await client.receiveCrossref(required('id'),required('operation'),await input());break;
      case 'export':result=await client.exportDossier(required('id'),{format:values.format??'json.gz',file:resolve(required('out'))});break;
      case 'export-crossref':result=await client.exportCrossrefEdition(required('id'),required('operation'),{file:resolve(required('out'))});break;
      case 'export-edition':result=await client.exportRetainedEdition(required('id'),required('edition'),{file:resolve(required('out'))});break;
      case 'export-compare':result=await client.exportComparison(required('id'),{before:number('before'),after:number('after'),file:resolve(required('out'))});break;
      case 'reopen':result=await client.reopenFile(resolve(required('source-file')),{expectedSha256:digest('sha256')});break;
    }
    const value=compact(result);output.write(JSON.stringify(value,null,2)+'\n');return value;
  }finally{await client.close();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  main().catch(error=>{
    process.stderr.write(JSON.stringify({error:safeCode(error.code,'RESEARCH_COMMAND_FAILED'),
      ...(Number.isInteger(error.status)?{status:error.status}:{}),
      ...(error.outcomeUnknown?{outcomeUnknown:true,recovery:'Read the original dossier revision or the same saved Crossref operation before another write.'}:{})})+'\n');
    process.exitCode=1;
  });
}
