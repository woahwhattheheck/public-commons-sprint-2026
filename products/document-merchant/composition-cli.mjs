#!/usr/bin/env node
// MIT. Complete dataset/template composition over the original document batch customer.
import {dirname,resolve,join} from 'node:path';
import {realpathSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {
  absolute,ownedDirectory,ownedBytes,writeExact,encoded,parse,digest,plain
} from '../../stellar/scf-starforge-20261009/sf101-merchant-receiver/api-application/workspace/configuration.mjs';
import {acquireStateLease} from '../../stellar/scf-starforge-20261009/merchant-fleet-gateway/state-lease.mjs';
import {startJobCustomerWorkspace} from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/job-workspace/server.mjs';
import {inspectDocumentMerchant} from './setup.mjs';
import {documentError,defaultDocumentSettings} from './contracts.mjs';
import {documentCorrectionDraft,composeDocumentCorrection,stageDocumentCorrection} from './corrections.mjs';
import {
  documentCompositionTemplate,reviewDocumentComposition,prepareDocumentComposition,
  readDocumentComposition,receiveDocumentComposition,prepareDocumentCompositionBatch,
  readDocumentCompositionBatch,exportDocumentComposition
} from './composition.mjs';
import {
  openDocumentBatchCustomer,inspectDocumentBatch,runDocumentBatch,receiveDocumentBatch,
  saveDocumentBatchReport,receiveDocumentBatchCollection
} from './batch.mjs';

const HASH=/^[a-f0-9]{64}$/;
function need(condition,code,message){if(!condition)throw documentError(code,message??code);}
const HELP=[
  'Document composition: CSV or JSON records and templates to original paid document jobs','',
  'document-merchant compose COMMAND [OPTIONS]','',
  'serve --workspace-options FILE [--provider PROVIDER --merchant-origin HTTPS_ORIGIN --port PORT]',
  'inspect-service --workspace-options FILE [--provider PROVIDER --merchant-origin HTTPS_ORIGIN --out NEW_FILE]',
  'template --provider mintpdf|snaplab|pdfmint [--out NEW_FILE]',
  'template --merchant-directory EXISTING_MERCHANT [--out NEW_FILE]',
  'review --request FILE --source-root DIR',
  'stage --directory SOURCE_DIR [--request FILE --source-root DIR]',
  'source --directory SOURCE_DIR [--sha256 SAVED_SOURCE_SHA]',
  'correction-draft --directory ORIGINAL_SOURCE_DIR --sha256 ORIGINAL_SOURCE_SHA --selection FILE --out NEW_DRAFT',
  'review-correction --parent-directory ORIGINAL_SOURCE_DIR --draft FILE [--out NEW_COMPLETE_PLAN]',
  'correct --parent-directory ORIGINAL_SOURCE_DIR --draft FILE --directory NEW_SOURCE_DIR',
  'prepare --directory SOURCE_DIR --workspace-options FILE [--request FILE --source-root DIR]',
  'show --directory SOURCE_DIR --workspace-options FILE',
  'review-batch --directory SOURCE_DIR --workspace-options FILE --out NEW_REPORT_DIR',
  'run --directory SOURCE_DIR --workspace-options FILE --approve-plan SAVED_BATCH_SHA',
  'receive --directory SOURCE_DIR --workspace-options FILE',
  'open --directory SOURCE_DIR --workspace-options FILE [--port PORT]',
  'export --directory SOURCE_DIR --workspace-options FILE --out NEW_EXPORT_DIR',
  'receive-source --source COMPLETE_PLAN_JSON --directory DESTINATION --sha256 SOURCE_SHA',
  'receive-collection --archive FILE --destination DIR --library-state DIR --sha256 ARCHIVE_SHA','',
  'serve/inspect-service: --source-root DIR --intake-key-env NAME --deadline-ms N --poll-ms N are optional.',
  'serve: --expected-selection SHA reuses a reviewed service selection; Applications also supplies --managed-source.',
  'prepare/run: --intake-key-env NAME selects the original intake credential from the environment.',
  'run/receive: --deadline-ms 1000..3600000 and --poll-ms 250..30000 select each original receiving wait.',
  'run/receive: --out NEW_REPORT_DIR saves the complete original results, CSV and readable report.',
  'export/receive-collection: --max-bytes N selects the original complete Collection allowance.',
  'stage/prepare without --request reopen complete retained source; --source-root accompanies --request.',
  'The composition directory retains source; its batch/ child retains the original native batch.',
  'Run requires the exact batch.planSha256 returned by prepare or show.',
  'Source summaries include all counts and full artifact paths; complete data and HTML stay in the source plan.',
  'Use review-batch or the original customer application for every request, checkout and output file.',
  'Exit 2 from run/receive means original documents still need continuation; Ctrl-C drains the customer.',
  'The operating guide is products/document-merchant/COMPOSITION.md.'
].join('\n')+'\n';

const SERVICE=['--workspace-options','--source-root','--provider','--merchant-origin',
  '--intake-key-env','--deadline-ms','--poll-ms','--port'];
const CUSTOMER=['--directory','--workspace-options'];
const ACCEPTED=Object.freeze({
  serve:[...SERVICE,'--managed-source','--expected-selection'],
  'inspect-service':[...SERVICE,'--out'],
  template:['--provider','--merchant-directory','--out'],
  review:['--request','--source-root'],
  stage:['--directory','--request','--source-root'],
  source:['--directory','--sha256'],
  'correction-draft':['--directory','--sha256','--selection','--out'],
  'review-correction':['--parent-directory','--draft','--out'],
  correct:['--parent-directory','--draft','--directory'],
  prepare:[...CUSTOMER,'--request','--source-root','--intake-key-env'],
  show:CUSTOMER,
  'review-batch':[...CUSTOMER,'--out'],
  run:[...CUSTOMER,'--approve-plan','--intake-key-env','--deadline-ms','--poll-ms','--out'],
  receive:[...CUSTOMER,'--deadline-ms','--poll-ms','--out'],
  open:[...CUSTOMER,'--port'],
  export:[...CUSTOMER,'--out','--max-bytes'],
  'receive-source':['--source','--directory','--sha256'],
  'receive-collection':['--archive','--destination','--library-state','--sha256','--max-bytes']
});

function options(args,allowed){
  need(args.length%2===0,'DOCUMENT_COMPOSITION_OPTION_VALUE_REQUIRED');
  const result=new Map();
  for(let index=0;index<args.length;index+=2){
    const flag=args[index],value=args[index+1];
    need(allowed.includes(flag)&&!result.has(flag)&&typeof value==='string'&&value.length>0&&
      !value.startsWith('--'),'DOCUMENT_COMPOSITION_OPTION_INVALID',
      'Choose each named option once and supply its complete value.');
    result.set(flag,value);
  }
  return result;
}
function required(flags,name){
  need(flags.has(name),'DOCUMENT_COMPOSITION_OPTION_REQUIRED','Supply '+name+'.');
  return flags.get(name);
}
function number(flags,name,fallback,minimum=1,maximum=Number.MAX_SAFE_INTEGER){
  if(!flags.has(name))return fallback;
  const text=flags.get(name);
  need(/^(?:0|[1-9][0-9]*)$/.test(text),'DOCUMENT_COMPOSITION_NUMBER_REQUIRED',name+' needs a whole number.');
  const result=Number(text);
  need(Number.isSafeInteger(result)&&result>=minimum&&result<=maximum,
    'DOCUMENT_COMPOSITION_NUMBER_INVALID',name+' is outside the supported range.');
  return result;
}
function exactSha(flags,name){
  const value=required(flags,name);
  need(HASH.test(value),'DOCUMENT_COMPOSITION_SHA256_REQUIRED','Use the complete SHA256 returned for '+name+'.');
  return value;
}
async function requestInput(flags){
  need(flags.has('--request')===flags.has('--source-root'),'DOCUMENT_COMPOSITION_INPUT_PAIR_REQUIRED',
    'Supply both --request and --source-root, or reopen the retained source with --directory.');
  if(!flags.has('--request'))return {};
  const file=absolute(flags.get('--request'));
  const request=parse(await ownedBytes(file,4194304,{privateMode:false}));
  return {request,sourceRoot:absolute(flags.get('--source-root'))};
}
async function workspaceOptions(file){
  const value=parse(await ownedBytes(absolute(file),65536));
  need(plain(value)&&typeof value.directory==='string','DOCUMENT_COMPOSITION_CUSTOMER_OPTIONS_REQUIRED',
    'Select the existing private document customer options JSON.');
  absolute(value.directory);
  return value;
}
function accessKey(flags){
  if(!flags.has('--intake-key-env'))return undefined;
  const name=flags.get('--intake-key-env');
  need(/^[A-Z][A-Z0-9_]{2,63}$/.test(name),'DOCUMENT_COMPOSITION_KEY_ENVIRONMENT_INVALID');
  const value=process.env[name];
  need(typeof value==='string'&&value.length>0,'DOCUMENT_COMPOSITION_INTAKE_KEY_REQUIRED',
    'The selected intake environment variable needs its original value.');
  return value;
}
async function saveJson(file,value){
  file=absolute(file);
  const directory=dirname(file);
  await ownedDirectory(directory,{create:true});
  const lease=await acquireStateLease(directory),bytes=encoded(value);
  try{
    lease.assertHeld();await writeExact(file,bytes);
    return {path:file,bytes:bytes.length,sha256:digest(bytes)};
  }finally{await lease.close();}
}
function serviceOptions(flags){
  return {
    workspaceOptionsFile:absolute(required(flags,'--workspace-options')),
    sourceRoot:flags.has('--source-root')?absolute(flags.get('--source-root')):null,
    provider:flags.get('--provider')??'mintpdf',merchantOrigin:flags.get('--merchant-origin')??null,
    intakeKeyEnvironment:flags.get('--intake-key-env')??null,
    deadlineMs:number(flags,'--deadline-ms',300000,1000,3600000),
    pollMs:number(flags,'--poll-ms',1500,250,30000),port:number(flags,'--port',0,0,65535)
  };
}
function serviceSummary(selection){
  return {
    schema:'stellar-forge.document-composition-service-review.v1',selectionSha256:selection.selectionSha256,
    sourceDirectory:selection.sourceDirectory,customer:selection.customer,sourceRoot:selection.sourceRoot,
    options:selection.options,configurationFiles:selection.configurationFiles,
    implementation:{sourceFiles:selection.sourceFiles.length,nativeFiles:selection.nativeFiles.length,
      bytes:[...selection.sourceFiles,...selection.nativeFiles].reduce((total,file)=>total+file.bytes,0)}
  };
}
function sourceSummary(received){
  const plan=received.plan;
  return {
    schema:'stellar-forge.document-composition-summary.v1',id:received.id??plan.request.id,
    name:plan.request.name,provider:plan.request.provider,merchantOrigin:plan.request.merchantOrigin,
    directory:received.directory,planPath:received.planPath,sha256:received.sha256,bytes:received.bytes,
    batchDirectory:received.batchDirectory??join(received.directory,'batch'),
    batchInputPath:received.batchInputPath,previewPath:received.previewPath,counts:received.counts,
    ...(plan.request.correction?{correction:plan.request.correction}:{}),
    dataset:plan.files.filter(file=>file.role==='dataset').map(({content,...file})=>file),
    templates:plan.request.templates.map(template=>({
      id:template.id,format:template.format,
      documents:plan.documents.filter(document=>document.templateId===template.id).length
    }))
  };
}
function reviewSummary(plan){
  const raw=encoded(plan);
  return {
    schema:'stellar-forge.document-composition-review.v1',id:plan.request.id,name:plan.request.name,
    provider:plan.request.provider,merchantOrigin:plan.request.merchantOrigin,
    sourcePlan:{bytes:raw.length,sha256:digest(raw)},counts:plan.counts,
    sources:plan.files.filter(file=>['dataset','configuration','template'].includes(file.role))
      .map(({content,...file})=>file),
    templates:plan.request.templates.map(template=>({
      id:template.id,format:template.format,
      documents:plan.documents.filter(document=>document.templateId===template.id).length
    }))
  };
}
function batchSummary(saved){
  const plan=saved.plan;
  return {
    directory:plan.directory,planSha256:saved.sha256,planBytes:saved.bytes,id:plan.id,name:plan.name,
    workspaceDirectory:plan.workspaceDirectory,merchantOrigin:plan.input.merchantOrigin,
    provider:plan.input.provider,documents:plan.items.length,totals:plan.totals,unitMeaning:plan.unitMeaning
  };
}
function errorValue(value){
  if(value===null||value===undefined)return null;
  if(typeof value==='string')return value;
  if(typeof value.code==='string')return value.code;
  if(typeof value.message==='string')return value.message;
  return String(value);
}
function snapshotSummary(snapshot){
  return {
    schema:snapshot.schema,observedAt:snapshot.observedAt,documents:snapshot.documents,
    receivedDocuments:snapshot.receivedDocuments,counts:snapshot.counts,
    parentTasks:snapshot.parentTasks.length,
    completeDocumentSets:snapshot.parentTasks.filter(task=>task.completeDocumentSet).length,
    errors:snapshot.rows.filter(row=>row.error!==null&&row.error!==undefined).map(row=>({
      id:row.id,taskReference:row.taskReference,requestId:row.requestId,
      checkoutId:row.checkoutId,jobEntryId:row.jobEntryId,state:row.state,error:errorValue(row.error)
    })),
    ...(snapshot.operation?{operation:{
      kind:snapshot.operation.kind,
      attemptedDocuments:snapshot.operation.outcomes.length,
      admission:snapshot.operation.admission??null,
      remainingUnvisited:snapshot.operation.remainingUnvisited??null
    }}:{})
  };
}

/** Keep complete source artifacts on disk and every payment/file action on its original customer. */
export async function runDocumentCompositionCommand(argv=process.argv.slice(2),{
  print=value=>process.stdout.write(typeof value==='string'?value:JSON.stringify(value,null,2)+'\n'),
  progress=value=>process.stderr.write(JSON.stringify(value)+'\n'),
  setExitCode=value=>{process.exitCode=value;}
}={}){
  if(!argv.length||argv.length===1&&['--help','-h','help'].includes(argv[0]))return print(HELP);
  const [command,...tail]=argv;
  need(Object.hasOwn(ACCEPTED,command),'DOCUMENT_COMPOSITION_COMMAND_INVALID');
  const flags=options(tail,ACCEPTED[command]);
  if(command==='run')exactSha(flags,'--approve-plan');
  if(['receive-source','receive-collection'].includes(command))exactSha(flags,'--sha256');
  if(command==='source'&&flags.has('--sha256'))exactSha(flags,'--sha256');
  const deadlineMs=number(flags,'--deadline-ms',300000,1000,3600000);
  const pollMs=number(flags,'--poll-ms',1500,250,30000);
  const maxBytes=number(flags,'--max-bytes',undefined);
  const port=number(flags,'--port',0,0,65535);
  const controller=new AbortController();
  const stop=()=>controller.abort(Object.assign(new Error('Document composition interrupted.'),{
    code:'DOCUMENT_COMPOSITION_CANCELLED'}));
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  const emit=value=>{print(JSON.stringify(value,null,2)+'\n');return value;};
  let workspace,host,service;
  try{
    if(command==='serve'||command==='inspect-service'){
      const selectedOptions=serviceOptions(flags);
      need(!flags.has('--managed-source')||flags.has('--expected-selection'),
        'DOCUMENT_COMPOSITION_MANAGED_SELECTION_REQUIRED');
      if(flags.has('--expected-selection'))exactSha(flags,'--expected-selection');
      const sourceDirectory=flags.has('--managed-source')?absolute(flags.get('--managed-source')):null;
      const original=sourceDirectory
        ?await import(pathToFileURL(join(sourceDirectory,'composition-service.mjs')).href)
        :await import('./composition-service.mjs');
      need(original.DOCUMENT_COMPOSITION_SERVICE_SELECTION_SCHEMA===
        'stellar-forge.document-composition-service-selection.v1'&&
        typeof original.openDocumentCompositionService==='function'&&
        typeof original.readDocumentCompositionServiceSelection==='function'&&
        typeof original.assertDocumentCompositionServiceSelection==='function',
        'DOCUMENT_COMPOSITION_SERVICE_SOURCE_REQUIRED');
      if(command==='inspect-service'){
        const selection=original.assertDocumentCompositionServiceSelection(
          await original.readDocumentCompositionServiceSelection(selectedOptions));
        const saved=flags.has('--out')?await saveJson(flags.get('--out'),selection):null;
        return emit({...serviceSummary(selection),...(saved?{selectionFile:saved}:{})});
      }
      service=await original.openDocumentCompositionService(selectedOptions,{
        signal:controller.signal,expectedSelection:flags.get('--expected-selection'),
        launchSourceDirectory:dirname(fileURLToPath(import.meta.url))
      });
      // The original Applications line observer receives one complete bound startup announcement.
      print(JSON.stringify(service.announcement)+'\n');
      await service.closed;
      return service.announcement;
    }
    if(command==='template'){
      need(flags.has('--provider')!==flags.has('--merchant-directory'),
        'DOCUMENT_COMPOSITION_TEMPLATE_SELECTION_REQUIRED',
        'Choose --provider or the existing --merchant-directory.');
      let value;
      if(flags.has('--merchant-directory')){
        const installed=await inspectDocumentMerchant(absolute(flags.get('--merchant-directory')));
        const customer=parse(await ownedBytes(installed.customerSetup,1048576));
        value=documentCompositionTemplate(installed.provider.provider);
        value.merchantOrigin=customer.publicOrigin;
        value.templates=value.templates.filter(template=>customer.functions.some(fn=>fn.format===template.format));
        if(value.templates.length===0&&customer.functions.some(fn=>fn.format==='markdown')){
          const example=join(dirname(fileURLToPath(import.meta.url)),'examples','composition','report-documents.json');
          value=parse(await ownedBytes(example,65536,{privateMode:false}));
          value.provider=installed.provider.provider;value.merchantOrigin=customer.publicOrigin;
          value.templates=value.templates.filter(template=>template.format==='markdown').map(template=>({
            ...template,settings:defaultDocumentSettings(installed.provider.provider)
          }));
        }
        need(value.templates.length>0,'DOCUMENT_COMPOSITION_MERCHANT_FORMAT_REQUIRED');
      }else value=documentCompositionTemplate(required(flags,'--provider'));
      return emit(flags.has('--out')?await saveJson(flags.get('--out'),value):value);
    }
    if(command==='correction-draft'){
      const source=await readDocumentComposition(absolute(required(flags,'--directory')),{
        requireFiles:false,expectedSha256:exactSha(flags,'--sha256'),signal:controller.signal});
      const selected=parse(await ownedBytes(absolute(required(flags,'--selection')),1048576,{privateMode:false}));
      need(plain(selected)&&Object.keys(selected).every(key=>['id','name','mode','reason','documentIds'].includes(key)),
        'DOCUMENT_CORRECTION_SELECTION_REQUIRED');
      const draft=documentCorrectionDraft({source,...selected});
      const saved=await saveJson(required(flags,'--out'),draft);
      return emit({schema:draft.schema,id:draft.id,parent:draft.parent,documents:draft.documentIds.length,draft:saved});
    }
    if(command==='review-correction'||command==='correct'){
      const sourceDirectory=absolute(required(flags,'--parent-directory'));
      const draft=parse(await ownedBytes(absolute(required(flags,'--draft')),32*1048576,{privateMode:false}));
      if(command==='correct')return emit(sourceSummary(await stageDocumentCorrection({
        sourceDirectory,directory:absolute(required(flags,'--directory')),draft,signal:controller.signal})));
      const source=await readDocumentComposition(sourceDirectory,{
        requireFiles:false,expectedSha256:draft?.parent?.sourceSha256,signal:controller.signal});
      const plan=composeDocumentCorrection({source,draft});
      const saved=flags.has('--out')?await saveJson(flags.get('--out'),plan):null;
      return emit({...reviewSummary(plan),correction:plan.request.correction,...(saved?{completeSource:saved}:{})});
    }
    if(command==='review'){
      required(flags,'--request');required(flags,'--source-root');
      const input=await requestInput(flags);
      return emit(reviewSummary(await reviewDocumentComposition({...input,signal:controller.signal})));
    }
    if(command==='receive-source'){
      return emit(sourceSummary(await receiveDocumentComposition({
        source:absolute(required(flags,'--source')),directory:absolute(required(flags,'--directory')),
        expectedSha256:flags.get('--sha256'),signal:controller.signal
      })));
    }
    if(command==='receive-collection'){
      return emit(await receiveDocumentBatchCollection({
        archive:absolute(required(flags,'--archive')),destination:absolute(required(flags,'--destination')),
        libraryState:absolute(required(flags,'--library-state')),expectedSha256:flags.get('--sha256'),
        signal:controller.signal,maxBytes
      }));
    }
    const directory=absolute(required(flags,'--directory'));
    if(command==='source')return emit(sourceSummary(await readDocumentComposition(directory,{
      requireFiles:true,expectedSha256:flags.get('--sha256'),signal:controller.signal
    })));
    if(command==='stage'){
      const input=await requestInput(flags);
      return emit(sourceSummary(await prepareDocumentComposition({
        ...input,directory,signal:controller.signal,onProgress:progress
      })));
    }
    let input;
    if(command==='prepare')input=await requestInput(flags);
    const originalOptions=await workspaceOptions(required(flags,'--workspace-options'));
    controller.signal.throwIfAborted();
    workspace=await openDocumentBatchCustomer(originalOptions);
    if(command==='prepare'){
      const prepared=await prepareDocumentCompositionBatch({
        ...input,workspace,directory,intakeAccessToken:accessKey(flags)??null,
        signal:controller.signal,onProgress:progress
      });
      return emit({
        schema:'stellar-forge.document-composition-prepared.v1',
        composition:prepared.composition,batch:batchSummary(prepared.batch)
      });
    }
    const saved=await readDocumentCompositionBatch({directory,workspace,signal:controller.signal});
    const basis={composition:sourceSummary(saved.composition),batch:batchSummary(saved.batch)};
    if(command==='show'||command==='review-batch'){
      const snapshot=await inspectDocumentBatch({workspace,plan:saved.batch.plan,signal:controller.signal});
      const report=command==='review-batch'?await saveDocumentBatchReport({
        snapshot,plan:saved.batch.plan,directory:absolute(required(flags,'--out'))
      }):null;
      return emit({...basis,status:snapshotSummary(snapshot),...(report?{report}:{})});
    }
    if(command==='run'||command==='receive'){
      const common={workspace,plan:saved.batch.plan,signal:controller.signal,deadlineMs,pollMs,onProgress:progress};
      const snapshot=command==='run'?await runDocumentBatch({
        ...common,planSha256:saved.batch.sha256,approvedPlanSha256:flags.get('--approve-plan'),
        intakeAccessToken:accessKey(flags)
      }):await receiveDocumentBatch(common);
      const report=flags.has('--out')?await saveDocumentBatchReport({
        snapshot,plan:saved.batch.plan,directory:absolute(flags.get('--out'))
      }):null;
      const result=emit({...basis,status:snapshotSummary(snapshot),...(report?{report}:{})});
      if(snapshot.receivedDocuments<snapshot.documents)setExitCode(2);
      return result;
    }
    if(command==='export')return emit(await exportDocumentComposition({
      workspace,directory,destination:absolute(required(flags,'--out')),signal:controller.signal,maxBytes
    }));
    if(command==='open'){
      host=await startJobCustomerWorkspace({model:workspace,port,browserApproval:true,landing:'checkout'});
      const result=emit({...basis,url:host.entryUrl,collectionsUrl:host.collectionsUrl,
        privateLaunch:host.privateLaunch,workspaceDirectory:workspace.directory});
      await new Promise(done=>{
        if(controller.signal.aborted)return done();
        controller.signal.addEventListener('abort',done,{once:true});
        host.server.once('close',done);
      });
      return result;
    }
    need(false,'DOCUMENT_COMPOSITION_COMMAND_INVALID');
  }catch(error){
    if(controller.signal.aborted&&(error===controller.signal.reason||error?.name==='AbortError')){
      setExitCode(130);
      return emit({schema:'stellar-forge.document-composition-interrupted.v1',state:'INTERRUPTED',
        directory:flags.get('--directory')??null,error:'DOCUMENT_COMPOSITION_CANCELLED'});
    }
    throw error;
  }finally{
    process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);
    try{await service?.close();}finally{
      try{await host?.close();}finally{await workspace?.close();}
    }
  }
}
function directEntry(){
  if(!process.argv[1])return false;
  try{return realpathSync(resolve(process.argv[1]))===realpathSync(fileURLToPath(import.meta.url));}
  catch{return false;}
}
if(directEntry()){
  runDocumentCompositionCommand().catch(error=>{
    process.stderr.write((error?.code?error.code+': ':'')+(error?.message??String(error))+'\n');
    process.exitCode=1;
  });
}
