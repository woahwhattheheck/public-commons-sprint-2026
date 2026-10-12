#!/usr/bin/env node
// MIT. Operate the same original Research listener from a local command.
import {parseArgs} from 'node:util';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ResearchWorkspaceClient,researchSummary} from './workspace-client.mjs';
import {readResearchHostFile} from './workspace-files.mjs';
import {DOCUMENT_COMMANDS,main as documentMain} from './document-workspace-cli.mjs';
import {parseJson,need,safeCode} from '../node/store.mjs';

const usage=String.raw`Research workspace client

  research-client COMMAND --connection-file /private/application-url.json --directory /original/dossier-store [OPTIONS]
  research-dossiers remote COMMAND --connection-file /private/application-url.json --directory /original/dossier-store [OPTIONS]

Read the existing workspace:
  status
  list [--offset N --limit N --snapshot SHA256]
  metadata --id DOSSIER [--revision N]
  source --id DOSSIER --edition EDITION --key ORIGINAL_KEY [--revision N]
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

Review and receive an original source bundle:
  bundle-preview --id DOSSIER --question QUESTION --file BUNDLE.json [--sha256 SHA256]
  import-bundle --id DOSSIER --question QUESTION --file BUNDLE.json --revision N [--sha256 SHA256]

Preview returns the exact bundle hash, current revision, source terms and findings.
Import binds those original bytes to that question in one saved revision.
Repeat the same file and question after a lost reply to recover the saved result.

Receive a completed original Object Buyer file:
  object-inputs --id DOSSIER [--after-session NAME --snapshot SHA256 --limit N]
  object-reviews --id DOSSIER [--after-review ID --limit N]
  object-review --id DOSSIER --input REVIEW_REQUEST.json
  object-prepare --id DOSSIER --input PREPARE_REQUEST.json
  pipeline-list --id DOSSIER [--after-operation ID --limit N]
  pipeline-review --id DOSSIER --operation ID

Review captures the exact saved delivery; it does not acquire, assemble or pay.
Preparation binds that review to an original managed processing operation.
Submit, monitor and receive that same operation in the existing Pipelines pane
or with the documents-* and pipelines-* commands below.

Operate original Documents and the complete managed Pipeline lifecycle:
  documents-help
  documents-list|documents-review|documents-elements|documents-receive|documents-download
  pipelines-list|pipelines-operation|pipelines-prepare|pipelines-submit|pipelines-refresh
  pipelines-cancel|pipelines-provider-jobs|pipelines-reconcile|pipelines-retain
  pipelines-review|pipelines-elements|pipelines-receive|pipelines-input|pipelines-output|pipelines-download

Run documents-help for exact JSON fields, original revisions and complete file downloads.

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
  export-edition --id DOSSIER --edition ID --out NEW_FILE [--revision N --sha256 SHA256]
  export-source --id DOSSIER --edition ID --key ORIGINAL_KEY --part content|record --out NEW_FILE [--revision N --sha256 SHA256]
  export-source-file --id DOSSIER --edition ID --key ORIGINAL_KEY --name ORIGINAL_NAME --sha256 SHA256 --out NEW_FILE [--revision N]
  export-compare --id DOSSIER --before N --after N --out NEW_FILE
  reopen --source-file PORTABLE_JSON_OR_GZIP --sha256 SHA256

Mutation JSON uses the original fields, including expectedRevision. Crossref
preparation keeps requestId, questionId and the reviewed expectedRevision;
receive keeps expectedRevision, expectedPlanSha256 and expectedEditionSha256.
Page zero returns the revision or snapshot required by subsequent pages.
Source and comparison pages contain compact previews and complete descriptive metadata.
Use a citation's editionId/key to inspect one original occurrence; a file also
keeps its original member name and SHA256. Downloads preserve the selected
revision and never overwrite an existing destination. Content/record exports
are declared text/JSON representations; export-edition keeps the original response bytes.
A lost write reply is reconciled through that same dossier/operation.
The private startup file is reread on every call. Closing this client leaves
the original Applications listener and saved acquisitions with their owner.
`;

const commandOptions=Object.freeze({
  status:[],list:['offset','limit','snapshot'],metadata:['id','revision'],
  source:['id','edition','key','revision'],
  section:['id','section','revision','offset','limit','question','query','selected'],
  create:['input'],update:['id','input'],'question-add':['id','input'],
  'question-update':['id','question','input'],evidence:['id','input'],selection:['id','input'],
  'finding-add':['id','input'],'finding-update':['id','finding','input'],
  compare:['id','before','after','section','offset','limit'],
  receive:['id','input','source-file','sha256'],reference:['id','input','source-file','sha256'],
  'openalex-editions':[],'receive-openalex':['id','input'],
  'bundle-preview':['id','question','file','sha256'],
  'import-bundle':['id','question','file','sha256','revision'],
  'object-inputs':['id','after-session','snapshot','limit'],
  'object-reviews':['id','after-review','limit'],'object-review':['id','input'],'object-prepare':['id','input'],
  'pipeline-list':['id','after-operation','limit'],'pipeline-review':['id','operation'],
  'crossref-prepare':['id','input'],'crossref-list':['id','after-operation','limit'],
  'crossref-review':['id','operation','section','offset','limit'],
  'crossref-start':['id','operation','plan-sha256'],'crossref-stop':['id','operation'],
  'crossref-receive':['id','operation','input'],
  export:['id','format','out','sha256'],'export-crossref':['id','operation','out','sha256'],
  'export-edition':['id','edition','out','revision','sha256'],'export-compare':['id','before','after','out','sha256'],
  'export-source':['id','edition','key','part','out','revision','sha256'],
  'export-source-file':['id','edition','key','name','out','revision','sha256'],
  reopen:['source-file','sha256'],
});
const compact=value=>value?.dossier?{...value,dossier:researchSummary(value.dossier)}:value;
const selected=value=>Object.fromEntries(Object.entries(value).filter(([,item])=>item!==undefined));
export async function main(argv=process.argv.slice(2),{output=process.stdout}={}){
  if(DOCUMENT_COMMANDS.includes(argv[0]))return documentMain(argv,{output});
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
    const exportOptions=()=>({file:resolve(required('out')),
      ...selected({expectedSha256:values.sha256===undefined?undefined:digest('sha256')})});
    switch(command){
      case 'status':result=status;break;
      case 'list':result=await client.list({...page,...selected({snapshot:values.snapshot})});break;
      case 'metadata':result=await client.metadata(required('id'),selected({revision:number('revision')}));break;
      case 'source':result=await client.source(required('id'),{editionId:required('edition'),key:required('key'),
        ...selected({revision:number('revision')})});break;
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
      case 'bundle-preview':{
        result=await client.previewSourceBundleFile(required('id'),{
          questionId:required('question'),file:resolve(required('file')),
          ...selected({sha256:values.sha256===undefined?undefined:digest('sha256')})});break;
      }
      case 'import-bundle':{
        required('revision');const expectedRevision=number('revision');
        need(expectedRevision>=1,'INTEGER_ARGUMENT_REQUIRED');
        const sha256=values.sha256===undefined?undefined:digest('sha256');
        result=await client.receiveSourceBundleFile(required('id'),{
          questionId:required('question'),file:resolve(required('file')),expectedRevision,
          ...selected({sha256,expectedBundleSha256:sha256})});break;
      }
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
      case 'export':result=await client.exportDossier(required('id'),{format:values.format??'json.gz',...exportOptions()});break;
      case 'export-crossref':result=await client.exportCrossrefEdition(required('id'),required('operation'),exportOptions());break;
      case 'export-edition':result=await client.exportRetainedEdition(required('id'),required('edition'),{
        ...exportOptions(),...selected({revision:number('revision')})});break;
      case 'export-compare':result=await client.exportComparison(required('id'),{before:number('before'),after:number('after'),...exportOptions()});break;
      case 'export-source':result=await client.exportSource(required('id'),{editionId:required('edition'),key:required('key'),
        part:values.part??'content',...selected({revision:number('revision')}),...exportOptions()});break;
      case 'export-source-file':result=await client.exportSourceFile(required('id'),{editionId:required('edition'),key:required('key'),
        name:required('name'),...selected({revision:number('revision')}),...exportOptions(),expectedSha256:digest('sha256')});break;
      case 'reopen':result=await client.reopenFile(resolve(required('source-file')),{expectedSha256:digest('sha256')});break;
    }
    const value=compact(result);output.write(JSON.stringify(value,null,2)+'\n');return value;
  }finally{await client.close();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  main().catch(error=>{
    process.stderr.write(JSON.stringify({error:safeCode(error.code,'RESEARCH_COMMAND_FAILED'),
      ...(Number.isInteger(error.status)?{status:error.status}:{}),
      ...(error.destinationPublished?{destinationPublished:true,file:error.file}:{}),
      ...(error.sourceCleanupFailed?{sourceCleanupFailed:true}:{}),
      ...(error.outcomeUnknown?{outcomeUnknown:true,requestId:error.requestId,operationId:error.operationId,
        recovery:error.recovery??'Read the original dossier revision or the same saved source operation before another write.'}:{})})+'\n');
    process.exitCode=1;
  });
}
