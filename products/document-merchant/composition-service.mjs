// MIT. Document production on the original private Jobs customer and host.
import {realpath,lstat} from 'node:fs/promises';
import {dirname,join,relative,isAbsolute,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {canonical,digest,plain} from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/jobs/config.mjs';
import {readServiceFile} from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/jobs/managed/selection.mjs';
import {absolute} from '../../stellar/scf-starforge-20261009/sf101-merchant-receiver/api-application/workspace/configuration.mjs';
import {startJobCustomerWorkspace} from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/job-workspace/server.mjs';
import {readJobWorkspaceLaunch,jobWorkspaceLaunchPath} from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/job-workspace/launch.mjs';
import {documentProvider,documentError} from './contracts.mjs';
import {openDocumentBatchCustomer} from './batch.mjs';
import {openDocumentCompositionWorkspace} from './composition-workspace.mjs';
import {documentCompositionExtension} from './composition-server.mjs';

export const DOCUMENT_COMPOSITION_SERVICE_SELECTION_SCHEMA='stellar-forge.document-composition-service-selection.v1';
export const DOCUMENT_COMPOSITION_SERVICE_LAUNCH_SCHEMA='stellar-forge.document-composition-service-launch.v1';
export const DOCUMENT_COMPOSITION_SERVICE_SOURCE='products/document-merchant';
const ROOT=dirname(fileURLToPath(import.meta.url));
const REPOSITORY=join(ROOT,'../..');
const CUSTOMER=join(REPOSITORY,'stellar/scf-starforge-20261009/sf88-operator-buyer-cli');
const HASH=/^[a-f0-9]{64}$/;
const FIELDS=new Set(['workspaceOptionsFile','sourceRoot','provider','merchantOrigin','intakeKeyEnvironment',
  'deadlineMs','pollMs','port']);
export const DOCUMENT_COMPOSITION_SERVICE_SOURCE_FILES=Object.freeze([
  'agent.mjs','agent-schema.mjs','agent-client.mjs','agent-cli.mjs',
  'assembly.mjs','assembly-archive.mjs','assembly-cli.mjs','examples/ordered-pdfs.json','cli.mjs','composition-cli.mjs','composition-service.mjs','composition-application-provider.mjs',
  'composition-workspace.mjs','composition-server.mjs','composition.mjs','batch.mjs','contracts.mjs',
  'composition-browser-assets.json','composition-public/index.html','composition-public/app.mjs',
  'composition-public/style.css','examples/composition/orders.json','examples/composition/order-documents.json',
  'examples/composition/invoice.html','examples/composition/greeting.html','examples/composition/order-lines.csv',
  'examples/composition/grouped-order-documents.json','examples/composition/reports.csv',
  'examples/composition/report.md','examples/composition/report-documents.json'
]);
function need(value,code,message){if(!value)throw documentError(code,message??code);}
function inside(path,root){const part=relative(root,path);return part!==''&&part!=='..'&&!part.startsWith('..'+sep)&&!isAbsolute(part);}
function integer(value,min,max,code){need(Number.isSafeInteger(value)&&value>=min&&value<=max,code);return value;}
function json(bytes){
  let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
  catch{need(false,'DOCUMENT_COMPOSITION_SERVICE_JSON_REQUIRED','Select complete UTF-8 customer options JSON.');}
  need(plain(value),'DOCUMENT_COMPOSITION_SERVICE_JSON_REQUIRED');return value;
}
function expectedHash(value){need(HASH.test(value??''),'DOCUMENT_COMPOSITION_SERVICE_SELECTION_CHANGED');return value;}
function origin(value){
  if(value===null)return null;
  let url;try{url=new URL(value);}catch{need(false,'DOCUMENT_COMPOSITION_MERCHANT_REQUIRED');}
  need(url.protocol==='https:'&&url.origin===value&&!url.username&&!url.password,
    'DOCUMENT_COMPOSITION_MERCHANT_REQUIRED','Select the exact public HTTPS merchant origin.');return value;
}
async function privateDirectory(path,{missing=false}={}){
  path=absolute(path);
  try{
    const info=await lstat(path);
    need(info.isDirectory()&&!info.isSymbolicLink()&&!(info.mode&0o077)&&
      (!process.getuid||info.uid===process.getuid())&&await realpath(path)===path,
      'DOCUMENT_COMPOSITION_PRIVATE_CUSTOMER_REQUIRED');
  }catch(error){
    if(error.code!=='ENOENT'||!missing)throw error;
    await privateDirectory(dirname(path));
  }
  return path;
}
export function normalizeDocumentCompositionServiceOptions(value={}){
  need(plain(value)&&Object.keys(value).every(key=>FIELDS.has(key)),'DOCUMENT_COMPOSITION_SERVICE_OPTIONS_REQUIRED');
  const provider=value.provider??'mintpdf';documentProvider(provider);
  const environment=value.intakeKeyEnvironment??null;
  need(environment===null||typeof environment==='string'&&/^[A-Z][A-Z0-9_]{2,63}$/.test(environment),
    'DOCUMENT_COMPOSITION_KEY_ENVIRONMENT_INVALID');
  return {
    workspaceOptionsFile:absolute(value.workspaceOptionsFile),
    sourceRoot:value.sourceRoot===undefined||value.sourceRoot===null?null:absolute(value.sourceRoot),
    provider,merchantOrigin:origin(value.merchantOrigin??null),intakeKeyEnvironment:environment,
    deadlineMs:integer(value.deadlineMs??300000,1000,3600000,'DOCUMENT_COMPOSITION_DEADLINE_INVALID'),
    pollMs:integer(value.pollMs??1500,250,30000,'DOCUMENT_COMPOSITION_POLL_INVALID'),
    port:integer(value.port??0,0,65535,'DOCUMENT_COMPOSITION_PORT_INVALID')
  };
}

/** Bind complete reachable local modules plus the source-selected browser and example files. */
async function selectedSourceFiles(){
  need(await realpath(ROOT)===ROOT&&await realpath(REPOSITORY)===REPOSITORY,
    'DOCUMENT_COMPOSITION_SERVICE_SOURCE_CHANGED');
  const pending=DOCUMENT_COMPOSITION_SERVICE_SOURCE_FILES.map(name=>join(ROOT,name)),seen=new Set(),files=[];
  let bytes=0;
  while(pending.length){
    const path=pending.pop();if(seen.has(path))continue;
    need(inside(path,REPOSITORY),'DOCUMENT_COMPOSITION_SERVICE_SOURCE_CHANGED');seen.add(path);
    need(seen.size<=1024,'DOCUMENT_COMPOSITION_SERVICE_SOURCE_LIMIT');
    const current=await readServiceFile(path,4194304);bytes+=current.pin.bytes;
    need(bytes<=67108864,'DOCUMENT_COMPOSITION_SERVICE_SOURCE_LIMIT');files.push(current.pin);
    if(!/\.(?:mjs|cjs|js)$/.test(path))continue;
    const text=current.bytes.toString('utf8'),imports=[];
    for(const match of text.matchAll(/^\s*(?:import|export)\s+(?:[^'";]*?\s+from\s+)?['"](\.\.?\/[^'"\r\n]+)['"]/gm))
      imports.push(match[1]);
    for(const match of text.matchAll(/\bimport\s*\(\s*['"](\.\.?\/[^'"\r\n]+)['"]\s*\)/g))
      imports.push(match[1]);
    for(const name of imports){
      need(!name.includes('?')&&!name.includes('#'),'DOCUMENT_COMPOSITION_SERVICE_SOURCE_CHANGED');
      pending.push(join(dirname(path),name));
    }
  }
  return files.sort((a,b)=>a.path.localeCompare(b.path));
}

/** Check the actual installed entry and every pinned local implementation it imports. */
export async function assertDocumentCompositionServiceSource(launchSourceDirectory=ROOT){
  launchSourceDirectory=absolute(launchSourceDirectory);
  need(await realpath(launchSourceDirectory)===launchSourceDirectory,'DOCUMENT_COMPOSITION_SERVICE_SOURCE_CHANGED');
  const launchRepository=join(launchSourceDirectory,'../..');
  need(await realpath(launchRepository)===launchRepository,'DOCUMENT_COMPOSITION_SERVICE_SOURCE_CHANGED');
  const files=await selectedSourceFiles();
  for(const file of files){
    const launched=await readServiceFile(join(launchRepository,relative(REPOSITORY,file.path)),4194304);
    need(launched.pin.bytes===file.bytes&&launched.pin.sha256===file.sha256,
      'DOCUMENT_COMPOSITION_SERVICE_SOURCE_CHANGED','Review the current installed document production source.');
  }
  return {sourceDirectory:ROOT,launchSourceDirectory,files};
}

async function customerSelection(options){
  const original=await readServiceFile(options.workspaceOptionsFile,65536,{privateFile:true});
  const value=json(original.bytes),directory=absolute(value.directory);
  await privateDirectory(directory,{missing:true});
  const checkout=value.checkout??{};
  need(plain(checkout)&&Boolean(checkout.operatorWorkspace)!==Boolean(checkout.operatorProfile),
    'DOCUMENT_COMPOSITION_CUSTOMER_OPERATOR_REQUIRED',
    'Use the original customer options with one checkout.operatorWorkspace or checkout.operatorProfile.');
  const runtimeDirectory=absolute(checkout.runtimeDirectory??CUSTOMER);
  need(await realpath(runtimeDirectory)===runtimeDirectory,'DOCUMENT_COMPOSITION_CUSTOMER_RUNTIME_CHANGED');
  const configurationFiles=[original.pin];
  let operatorSelection;
  if(checkout.operatorWorkspace){
    const selected=await privateDirectory(checkout.operatorWorkspace);
    for(const name of ['workspace.json','operator.json'])
      configurationFiles.push((await readServiceFile(join(selected,name),1048576)).pin);
    operatorSelection={kind:'workspace',directory:selected,runtimeDirectory};
  }else{
    const profile=await readServiceFile(absolute(checkout.operatorProfile),1048576,{privateFile:true});
    configurationFiles.push(profile.pin);
    operatorSelection={kind:'profile',path:profile.pin.path,runtimeDirectory};
  }
  const nativeFiles=[];
  for(const name of ['cli.mjs','node/client.mjs','job-workspace/cli.mjs','job-workspace/launch.mjs',
    'job-workspace/server.mjs','job-workspace/checkout/controller.mjs','job-workspace/intake/controller.mjs'])
    nativeFiles.push((await readServiceFile(join(runtimeDirectory,name),4194304)).pin);
  const sourceRoot=options.sourceRoot??join(directory,'artifacts','document-compositions');
  return {value,customer:{directory,runtimeDirectory,operatorSelection},sourceRoot,configurationFiles,nativeFiles};
}

/** Read only: mutable customer catalogs, requests and source editions are not launch settings. */
export async function readDocumentCompositionServiceSelection(rawOptions={}){
  const options=normalizeDocumentCompositionServiceOptions(rawOptions);
  const selected=await customerSelection(options);
  const value={
    schema:DOCUMENT_COMPOSITION_SERVICE_SELECTION_SCHEMA,sourceDirectory:ROOT,
    options,customer:selected.customer,sourceRoot:selected.sourceRoot,
    sourceFiles:await selectedSourceFiles(),nativeFiles:selected.nativeFiles,
    configurationFiles:selected.configurationFiles
  };
  return {...value,selectionSha256:digest(canonical(value))};
}
export function assertDocumentCompositionServiceSelection(value,expectedSha256){
  need(plain(value)&&value.schema===DOCUMENT_COMPOSITION_SERVICE_SELECTION_SCHEMA&&
    HASH.test(value.selectionSha256??'')&&
    (expectedSha256===undefined||expectedHash(expectedSha256)===value.selectionSha256),
    'DOCUMENT_COMPOSITION_SERVICE_SELECTION_CHANGED','Review the current document production selection.');
  const {selectionSha256,...selected}=value;
  need(digest(canonical(selected))===selectionSha256,'DOCUMENT_COMPOSITION_SERVICE_SELECTION_CHANGED');
  return value;
}
function same(left,right){return canonical(left)===canonical(right);}
function serviceAnnouncement(selection,launch){
  const current=new URL(launch.url);
  return {
    schema:DOCUMENT_COMPOSITION_SERVICE_LAUNCH_SCHEMA,state:'LISTENING',
    selectionSha256:selection.selectionSha256,directory:launch.directory,
    runtimeDirectory:launch.runtimeDirectory,operatorSelection:launch.operatorSelection,
    pid:launch.pid,instanceId:launch.instanceId,privateLaunch:launch.privateLaunch,
    sourceRoot:selection.sourceRoot,documentUrl:current.origin+'/documents/'+current.hash,
    agentUrl:current.origin+'/api/document-composition/mcp',
    customerUrl:launch.entryUrl,checkoutUrl:launch.checkoutUrl,jobsUrl:launch.url,
    collectionsUrl:launch.collectionsUrl,libraryUrl:launch.libraryUrl,resolutionUrl:launch.resolutionUrl
  };
}

/** Open one original customer owner; the existing host owns extension admission and drain. */
export async function openDocumentCompositionService(rawOptions={},{
  environment=process.env,signal,expectedSelection,launchSourceDirectory=ROOT
}={}){
  signal?.throwIfAborted();
  await assertDocumentCompositionServiceSource(launchSourceDirectory);
  const selected=assertDocumentCompositionServiceSelection(
    await readDocumentCompositionServiceSelection(rawOptions),expectedSelection);
  const fresh=await customerSelection(selected.options);
  need(same(fresh.customer,selected.customer)&&same(fresh.configurationFiles,selected.configurationFiles)&&
    same(fresh.nativeFiles,selected.nativeFiles),'DOCUMENT_COMPOSITION_SERVICE_SELECTION_CHANGED');
  const name=selected.options.intakeKeyEnvironment;
  const intakeAccessToken=name===null?null:environment[name];
  need(intakeAccessToken===null||typeof intakeAccessToken==='string'&&intakeAccessToken.length>0&&
    intakeAccessToken.length<=16384,'DOCUMENT_COMPOSITION_INTAKE_KEY_REQUIRED');
  let workspace,controller,host,closePromise,resolveClosed,rejectClosed;
  const closed=new Promise((resolve,reject)=>{resolveClosed=resolve;rejectClosed=reject;});
  // A caller may await close() directly; keep the returned lifetime promise handled in that case.
  closed.catch(()=>{});
  const onAbort=()=>{close().catch(()=>{});};
  const onHostClose=()=>{close().catch(()=>{});};
  function close(){
    if(closePromise)return closePromise;
    signal?.removeEventListener('abort',onAbort);
    closePromise=(async()=>{
      const failures=[];
      try{await host?.close();}catch(error){failures.push(error);}
      try{await controller?.close();}catch(error){failures.push(error);}
      try{await workspace?.close();}catch(error){failures.push(error);}
      host?.server.removeListener('close',onHostClose);
      if(failures.length)throw new AggregateError(failures,'DOCUMENT_COMPOSITION_SERVICE_CLOSE_FAILED');
    })();
    closePromise.then(resolveClosed,rejectClosed);return closePromise;
  }
  try{
    signal?.throwIfAborted();
    workspace=await openDocumentBatchCustomer(fresh.value);
    signal?.throwIfAborted();
    const actual=workspace.checkout.status();
    need(workspace.directory===selected.customer.directory&&
      actual.runtimeDirectory===selected.customer.runtimeDirectory&&
      same(actual.selection,selected.customer.operatorSelection),'DOCUMENT_COMPOSITION_CUSTOMER_SELECTION_CHANGED');
    controller=await openDocumentCompositionWorkspace({
      workspace,sourceRoot:selected.sourceRoot,provider:selected.options.provider,
      merchantOrigin:selected.options.merchantOrigin,intakeAccessToken,
      deadlineMs:selected.options.deadlineMs,pollMs:selected.options.pollMs
    });
    const extension=await documentCompositionExtension(controller);
    signal?.throwIfAborted();
    host=await startJobCustomerWorkspace({
      model:workspace,port:selected.options.port,browserApproval:true,landing:'request',extensions:[extension]
    });
    signal?.throwIfAborted();
    const announcement=serviceAnnouncement(selected,host.launch);
    host.server.once('close',onHostClose);
    signal?.addEventListener('abort',onAbort,{once:true});
    // Abort cannot be lost between the last asynchronous open and lifetime registration.
    if(signal?.aborted){await close();signal.throwIfAborted();}
    return Object.freeze({workspace,controller,host,selection:selected,announcement,
      documentUrl:announcement.documentUrl,launch:host.launch,privateLaunch:host.privateLaunch,closed,close});
  }catch(error){
    try{await close();}catch(closeError){
      throw new AggregateError([error,closeError],'DOCUMENT_COMPOSITION_SERVICE_START_FAILED',{cause:error});
    }
    throw error;
  }
}

/** Receive the original customer's current private launch, with this exact source/settings selection. */
export async function readDocumentCompositionServiceLaunch({
  options,expectedSelection,expected={}
}={}){
  const selected=assertDocumentCompositionServiceSelection(
    await readDocumentCompositionServiceSelection(options),expectedSelection);
  const operator=selected.customer.operatorSelection;
  const launch=await readJobWorkspaceLaunch({
    directory:selected.customer.directory,runtimeDirectory:selected.customer.runtimeDirectory,
    ...(operator.kind==='workspace'?{operatorWorkspace:operator.directory}:{operatorProfile:operator.path}),
    pid:expected.pid,approvalMode:'browser',landing:'request'
  });
  need(launch.privateLaunch===jobWorkspaceLaunchPath(selected.customer.directory)&&
    (expected.instanceId===undefined||launch.instanceId===expected.instanceId)&&
    same(launch.operatorSelection,operator),'DOCUMENT_COMPOSITION_SERVICE_STARTUP_CHANGED');
  const announcement=serviceAnnouncement(selected,launch);
  need(selected.options.port===0||Number(new URL(announcement.documentUrl).port||80)===selected.options.port,
    'DOCUMENT_COMPOSITION_PORT_CHANGED');
  if(expected.documentUrl!==undefined)need(expected.documentUrl===announcement.documentUrl,
    'DOCUMENT_COMPOSITION_SERVICE_STARTUP_CHANGED');
  return {selection:selected,launch,announcement,documentUrl:announcement.documentUrl};
}
