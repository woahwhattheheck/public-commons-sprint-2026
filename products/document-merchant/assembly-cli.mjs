#!/usr/bin/env node
// MIT. Complete ordered PDF assembly on the original customer, source and native paid batch.
import {dirname,resolve} from 'node:path';
import {realpathSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {absolute,ownedDirectory,ownedBytes,writeExact,encoded,parse,plain,digest}
  from '../../stellar/scf-starforge-20261009/sf101-merchant-receiver/api-application/workspace/configuration.mjs';
import {acquireStateLease} from '../../stellar/scf-starforge-20261009/merchant-fleet-gateway/state-lease.mjs';
import {startJobCustomerWorkspace}
  from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/job-workspace/server.mjs';
import {documentError} from './contracts.mjs';
import {openDocumentBatchCustomer,saveDocumentBatchReport,receiveDocumentBatchCollection} from './batch.mjs';
import {inspectDocumentMerchant} from './setup.mjs';
import {
  documentAssemblyTemplate,stageDocumentPdfAssemblyFiles,stageDocumentPdfAssemblyFromBatch,
  readDocumentPdfAssembly,receiveDocumentPdfAssembly,prepareDocumentPdfAssemblyBatch,
  readDocumentPdfAssemblyBatch,inspectDocumentPdfAssembly,runDocumentPdfAssembly,
  exportDocumentPdfAssembly
} from './assembly.mjs';

const HELP=[
  'Document merchant — ordered PDF assembly','',
  '  document-merchant assemble template [--merchant-directory DIR] [--out FILE]',
  '  document-merchant assemble stage --workspace-options FILE --directory DIR --request FILE --files FILE',
  '  document-merchant assemble from-batch --workspace-options FILE --directory DIR --request FILE',
  '       --batch-directory DIR --batch-sha256 SHA --items FILE',
  '  document-merchant assemble source --directory DIR [--sha256 SHA]',
  '  document-merchant assemble receive-source --source FILE --directory DIR --sha256 SHA',
  '  document-merchant assemble prepare --workspace-options FILE --directory DIR --sha256 SHA [--intake-key-env NAME]',
  '  document-merchant assemble show --workspace-options FILE --directory DIR --sha256 SHA',
  '  document-merchant assemble review --workspace-options FILE --directory DIR --sha256 SHA --out DIR',
  '  document-merchant assemble run --workspace-options FILE --directory DIR --sha256 SHA --approve-plan SHA',
  '       [--intake-key-env NAME] [--deadline-ms N] [--poll-ms N]',
  '  document-merchant assemble receive --workspace-options FILE --directory DIR --sha256 SHA',
  '       [--deadline-ms N] [--poll-ms N]',
  '  document-merchant assemble export --workspace-options FILE --directory DIR --sha256 SHA --out DIR',
  '       [--max-bytes N]',
  '  document-merchant assemble open --workspace-options FILE --directory DIR --sha256 SHA [--port N]',
  '  document-merchant assemble receive-collection --archive FILE --destination DIR --library-state DIR',
  '       --sha256 SHA [--max-bytes N]','',
  '--files selects a complete JSON array of {id,path,filename?,sha256?,bytes?,reference?}.',
  '--items selects an ordered JSON array of original batch document IDs.',
  'Select the actual PDFMint-backed merchant exposing assemblePdfs. Every paid volume uses its native price.',
  'One unchanged original PDF is received without a merge request or charge.',
  'All input bytes, ordered volumes, native jobs and complete source remain in the selected original directories.',
  'run requires the exact saved native plan before opening the customer. Exit 2 retains unfinished original jobs.',
  'receive resumes existing jobs without creating a new paid request. Ctrl-C drains the original owner.'
].join('\n')+'\n';
const HASH=/^[a-f0-9]{64}$/;
function need(value,code,message){if(!value)throw documentError(code,message??code);}
function flags(args,allowed){
  const out=new Map();
  need(args.length%2===0,'DOCUMENT_ASSEMBLY_OPTION_REQUIRED');
  for(let i=0;i<args.length;i+=2){
    const key=args[i],value=args[i+1];
    need(allowed.includes(key)&&!out.has(key)&&typeof value==='string'&&value.length>0&&!value.startsWith('--'),
      'DOCUMENT_ASSEMBLY_OPTION_INVALID');out.set(key,value);
  }
  return out;
}
function required(values,key){need(values.has(key),'DOCUMENT_ASSEMBLY_OPTION_REQUIRED','Supply '+key+'.');return values.get(key);}
function hash(values,key){const value=required(values,key);need(HASH.test(value),'DOCUMENT_ASSEMBLY_SELECTION_REQUIRED');return value;}
function number(values,key,fallback,min=0,max=Number.MAX_SAFE_INTEGER){
  if(!values.has(key))return fallback;
  const value=values.get(key),parsed=Number(value);
  need(/^(?:0|[1-9][0-9]*)$/.test(value)&&Number.isSafeInteger(parsed)&&parsed>=min&&parsed<=max,
    'DOCUMENT_ASSEMBLY_NUMBER_INVALID');return parsed;
}
async function json(path,max=4194304,privateMode=false){
  return parse(await ownedBytes(absolute(path),max,{privateMode}));
}
async function save(path,value){
  path=absolute(path);await ownedDirectory(dirname(path),{create:true});
  const lease=await acquireStateLease(dirname(path));
  try{const bytes=encoded(value);lease.assertHeld();await writeExact(path,bytes);
    return {path,bytes:bytes.length,sha256:digest(bytes)};
  }finally{await lease.close();}
}
function accessKey(values){
  if(!values.has('--intake-key-env'))return null;
  const name=values.get('--intake-key-env');
  need(/^[A-Z][A-Z0-9_]{2,63}$/.test(name),'DOCUMENT_ASSEMBLY_KEY_ENVIRONMENT_INVALID');
  const value=process.env[name];
  need(typeof value==='string'&&value.length>0,'DOCUMENT_ASSEMBLY_INTAKE_KEY_REQUIRED');return value;
}
function sourceSummary(source){return {directory:source.directory,sourceSha256:source.sha256,sourceBytes:source.bytes,
  request:source.plan.request,origin:source.plan.origin,counts:source.plan.counts,
  sourceFile:source.directory+'/assembly-plan.json',
  volumes:source.plan.volumes.map(({id,index,kind,filename,fileIds,source})=>({id,index,kind,filename,fileIds,
    sourceBytes:source.bytes,sourceSha256:source.sha256}))};}
function viewSummary(view){
  return {id:view.id,directory:view.directory,sourceSha256:view.sourceSha256,counts:view.counts,
    complete:view.complete,request:view.request,origin:view.origin,
    native:view.native?{planSha256:view.native.planSha256,planBytes:view.native.planBytes,
      directory:view.native.directory,totals:view.native.totals}:null,
    volumes:view.volumes.map(({id,index,kind,filename,fileIds,state,received,native})=>({
      id,index,kind,filename,fileIds,state,received,requestId:native?.requestId??null}))};
}
export async function runDocumentAssemblyCommand(argv=process.argv.slice(2),{
  print=value=>process.stdout.write(typeof value==='string'?value:JSON.stringify(value,null,2)+'\n'),
  progress=value=>process.stderr.write(JSON.stringify(value)+'\n'),setExitCode=value=>{process.exitCode=value;}
}={}){
  if(!argv.length||['help','--help','-h'].includes(argv[0]))return print(HELP);
  const [command,...args]=argv,common=['--workspace-options','--directory','--sha256'];
  const accepted={
    template:['--merchant-directory','--out'],stage:['--workspace-options','--directory','--request','--files'],
    'from-batch':['--workspace-options','--directory','--request','--batch-directory','--batch-sha256','--items'],
    source:['--directory','--sha256'],'receive-source':['--source','--directory','--sha256'],
    prepare:[...common,'--intake-key-env'],show:common,review:[...common,'--out'],
    run:[...common,'--approve-plan','--intake-key-env','--deadline-ms','--poll-ms'],
    receive:[...common,'--deadline-ms','--poll-ms'],export:[...common,'--out','--max-bytes'],
    open:[...common,'--port'],
    'receive-collection':['--archive','--destination','--library-state','--sha256','--max-bytes']
  };
  need(Object.hasOwn(accepted,command),'DOCUMENT_ASSEMBLY_COMMAND_INVALID');
  const values=flags(args,accepted[command]),emit=value=>print(JSON.stringify(value,null,2)+'\n');
  // Reject absent or malformed approval before opening the customer or any native controller.
  const approved=command==='run'?hash(values,'--approve-plan'):null;
  const controller=new AbortController(),stop=()=>controller.abort(documentError('DOCUMENT_ASSEMBLY_CANCELLED'));
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  let workspace,host;
  try{
    if(command==='template'){
      const request=documentAssemblyTemplate();
      if(values.has('--merchant-directory')){
        const installed=await inspectDocumentMerchant(absolute(values.get('--merchant-directory')));
        const customer=await json(installed.customerSetup);
        need(installed.provider.provider==='pdfmint'&&customer.functions.some(value=>value.format==='pdf-set'),
          'DOCUMENT_ASSEMBLY_MERCHANT_REQUIRED','Select an installed merchant with assemblePdfs.');
        request.merchantOrigin=customer.publicOrigin;
      }
      return emit(values.has('--out')?await save(values.get('--out'),request):request);
    }
    if(command==='receive-collection')return emit(await receiveDocumentBatchCollection({
      archive:absolute(required(values,'--archive')),destination:absolute(required(values,'--destination')),
      libraryState:absolute(required(values,'--library-state')),expectedSha256:hash(values,'--sha256'),
      signal:controller.signal,maxBytes:number(values,'--max-bytes',undefined)
    }));
    const directory=absolute(required(values,'--directory'));
    if(command==='source')return emit(sourceSummary(await readDocumentPdfAssembly(directory,{
      expectedSha256:values.has('--sha256')?hash(values,'--sha256'):undefined,signal:controller.signal})));
    if(command==='receive-source')return emit(sourceSummary(await receiveDocumentPdfAssembly({
      source:absolute(required(values,'--source')),directory,expectedSha256:hash(values,'--sha256'),
      signal:controller.signal})));
    const selectedSha=['stage','from-batch'].includes(command)?undefined:hash(values,'--sha256');
    // The retained source can be fully checked without admitting a payment owner.
    if(selectedSha)await readDocumentPdfAssembly(directory,{expectedSha256:selectedSha,signal:controller.signal});
    const options=await json(required(values,'--workspace-options'),65536,true);
    need(plain(options)&&typeof options.directory==='string','DOCUMENT_ASSEMBLY_CUSTOMER_OPTIONS_REQUIRED');
    workspace=await openDocumentBatchCustomer(options);
    const original={workspace,directory,signal:controller.signal,expectedSha256:selectedSha};
    if(command==='stage'||command==='from-batch'){
      const request=await json(required(values,'--request'));
      const result=command==='stage'?await stageDocumentPdfAssemblyFiles({...original,request,
        files:await json(required(values,'--files'))}):await stageDocumentPdfAssemblyFromBatch({...original,request,
        batchDirectory:absolute(required(values,'--batch-directory')),batchPlanSha256:hash(values,'--batch-sha256'),
        itemIds:await json(required(values,'--items'))});
      return emit(sourceSummary(result));
    }
    if(command==='prepare'){
      const value=await prepareDocumentPdfAssemblyBatch({...original,intakeAccessToken:accessKey(values),onProgress:progress});
      return emit({...sourceSummary(value.source),native:value.batch?{
        directory:value.batch.plan.directory,planSha256:value.batch.sha256,planBytes:value.batch.bytes,
        totals:value.batch.plan.totals,unitMeaning:value.batch.plan.unitMeaning}:null});
    }
    if(command==='show')return emit(viewSummary(await inspectDocumentPdfAssembly(original)));
    if(command==='review'){
      const view=await inspectDocumentPdfAssembly(original),selected=await readDocumentPdfAssemblyBatch(original);
      const out=absolute(required(values,'--out'));
      const full=await save(out+'/assembly-review.json',view);
      const report=selected.batch?await saveDocumentBatchReport({snapshot:view.native.snapshot,
        plan:selected.batch.plan,directory:out+'/native'}):null;
      return emit({review:full,native:report,summary:viewSummary(view)});
    }
    if(command==='run'||command==='receive'){
      if(command==='run'){
        const selected=await readDocumentPdfAssemblyBatch(original);
        need(selected.batch&&selected.batch.sha256===approved,'DOCUMENT_ASSEMBLY_PLAN_APPROVAL_REQUIRED',
          'Review and approve the exact original native price plan before starting its paid volumes.');
      }
      const view=await runDocumentPdfAssembly({...original,approvedPlanSha256:approved,receiveOnly:command==='receive',
        intakeAccessToken:command==='run'?accessKey(values):null,deadlineMs:number(values,'--deadline-ms',300000,1000,3600000),
        pollMs:number(values,'--poll-ms',1500,250,30000),onProgress:progress});
      emit(viewSummary(view));if(!view.complete)setExitCode(2);return;
    }
    if(command==='export')return emit(await exportDocumentPdfAssembly({...original,
      destination:absolute(required(values,'--out')),maxBytes:number(values,'--max-bytes',undefined)}));
    if(command==='open'){
      const view=await inspectDocumentPdfAssembly(original);
      host=await startJobCustomerWorkspace({model:workspace,port:number(values,'--port',0,0,65535),
        browserApproval:true,landing:'checkout'});
      emit({assembly:view.id,sourceSha256:view.sourceSha256,nativePlanSha256:view.native?.planSha256??null,
        url:host.entryUrl,collectionsUrl:host.collectionsUrl,privateLaunch:host.privateLaunch});
      await new Promise(resolve=>{
        if(controller.signal.aborted)return resolve();
        controller.signal.addEventListener('abort',resolve,{once:true});host.server.once('close',resolve);
      });
    }
  }finally{
    process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);
    try{await host?.close();}finally{await workspace?.close();}
  }
}
function direct(){
  try{return Boolean(process.argv[1])&&realpathSync(resolve(process.argv[1]))===realpathSync(fileURLToPath(import.meta.url));}
  catch{return false;}
}
if(direct())runDocumentAssemblyCommand().catch(error=>{
  process.stderr.write((error?.code?error.code+': ':'')+(error?.message??String(error))+'\n');process.exitCode=1;
});
