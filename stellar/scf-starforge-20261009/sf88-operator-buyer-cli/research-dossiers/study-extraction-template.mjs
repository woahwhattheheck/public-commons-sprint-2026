// MIT. Complete template continuation on the already operated Research dossier.
import {isAbsolute,resolve,join,relative,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {ResearchWorkspaceClient} from './workspace-client.mjs';
import {runTemplateExchangeContinuation} from './template-exchange/native/continuation.mjs';
import {runTemplateExchangeBrowser} from './template-exchange/native/browser.mjs';
import {extractionDigest} from './study-extraction.mjs';
import {readResearchHostFile} from './workspace-files.mjs';
import {privateDirectory,readJson,writeBytes,jsonBytes,digest,need} from '../node/store.mjs';
import {lstat} from 'node:fs/promises';

const SCHEMA='sf88-study-extraction-template-programme/v1',MAX_FILE=256*1024*1024;
const same=(a,b)=>extractionDigest(a)===extractionDigest(b);
async function maybe(file){
  try{const info=await lstat(file);need(info.isFile()&&!info.isSymbolicLink(),'STUDY_TEMPLATE_FILE_INVALID');
    return await readJson(file,MAX_FILE);}
  catch(error){if(error.code==='ENOENT')return null;throw error;}
}
async function immutable(file,value){
  const body=jsonBytes(value),prior=await maybe(file);
  if(prior){need(same(prior,value),'STUDY_TEMPLATE_RETAINED_RECORD_CHANGED');return;}
  try{await writeBytes(file,body,{exclusive:true});}
  catch(error){if(error.code!=='EEXIST')throw error;need(same(await maybe(file),value),'STUDY_TEMPLATE_RETAINED_RECORD_CHANGED');}
}
function localFile(root,value){
  need(typeof value==='string'&&isAbsolute(value),'STUDY_TEMPLATE_ABSOLUTE_FILE_REQUIRED');
  const file=resolve(value),part=relative(root,file);
  need(part&&!isAbsolute(part)&&!part.split(sep).some(v=>!v||v==='.'||v==='..')&&
    !part.split(sep).some(v=>/^(?:.*connection.*\.json|workspace|fresh-receiving-workspace|.*browser-profile)$/.test(v)),
    'STUDY_TEMPLATE_DELIVERY_FILE_REQUIRED');
  return file;
}
async function fileIdentity(root,descriptor){
  const path=typeof descriptor==='string'?descriptor:descriptor.file??descriptor.path;
  const file=localFile(root,path),body=await readResearchHostFile(file,MAX_FILE);
  const result={file,bytes:body.length,sha256:digest(body)};
  if(typeof descriptor==='object')need((descriptor.bytes===undefined||descriptor.bytes===result.bytes)&&
    (descriptor.sha256===undefined||descriptor.sha256===result.sha256),'STUDY_TEMPLATE_FILE_CHANGED');
  return result;
}
function selectedUrl(value,dossierId){
  const original=new URL(value);
  need(['http:','https:'].includes(original.protocol)&&!original.username&&!original.password,
    'STUDY_TEMPLATE_ORIGINAL_HOST_REQUIRED');
  const token=new URLSearchParams(original.hash.slice(1)).get('token');
  need(/^[a-f0-9]{64}$/.test(token??''),'STUDY_TEMPLATE_ORIGINAL_SESSION_REQUIRED');
  const url=new URL('/template-exchange.html',original);
  url.searchParams.set('dossierId',dossierId);url.hash=new URLSearchParams({token}).toString();
  return {url,token,publicUrl:url.origin+url.pathname+url.search};
}
export async function runStudyExtractionTemplate({
  store,url,expectedWorkspaceId,dossierId,revision,tableId,publicationId,
  sourceCase,runDirectory,playwrightModule,chromiumExecutable,signal,
  authoring,openReceivingStore
}){
  signal?.throwIfAborted();
  need(store&&store.templateExchange&&typeof store.getMetadata==='function'&&
    typeof openReceivingStore==='function','STUDY_TEMPLATE_ORIGINAL_STORE_REQUIRED');
  for(const path of [runDirectory,playwrightModule,chromiumExecutable])
    need(typeof path==='string'&&isAbsolute(path)&&resolve(path)===path,'STUDY_TEMPLATE_ABSOLUTE_RUNTIME_REQUIRED');
  need(typeof expectedWorkspaceId==='string'&&expectedWorkspaceId.length>0,'STUDY_TEMPLATE_ORIGINAL_WORKSPACE_REQUIRED');
  const directory=await privateDirectory(runDirectory),connection=selectedUrl(url,dossierId);
  const binding={schema:SCHEMA,dossierId,workspaceId:expectedWorkspaceId,originalRevision:revision,
    tableId,publicationId,sourceCaseSha256:sourceCase.sha256};
  await immutable(join(directory,'selection.json'),binding);
  const completed=await maybe(join(directory,'programme-result.json'));
  if(completed){
    need(completed.state==='COMPLETE'&&same(completed.binding,binding),'STUDY_TEMPLATE_PROGRAMME_CHANGED');
    await store.getMetadata(dossierId,{revision:completed.revision});
    for(const item of completed.files)await fileIdentity(directory,item);
    return completed;
  }
  const native=await runTemplateExchangeContinuation({store,dossierId,revision,tableId,publicationId,
    sourceCase,runDirectory:directory,signal,authoring,openReceivingStore,
    emit:event=>process.stdout.write(JSON.stringify({programme:SCHEMA,...event})+'\n')});
  signal?.throwIfAborted();
  need(native.schema==='sf88-template-native-result/v1'&&native.stage==='complete'&&
    native.dossierId===dossierId&&native.originalRevision===revision&&
    native.tableId===tableId&&native.publicationId===publicationId&&
    native.sourceCaseSha256===sourceCase.sha256&&native.sourceRows===14&&
    Number.isSafeInteger(native.revision)&&native.revision>revision,
    'STUDY_TEMPLATE_COMPLETE_NATIVE_RESULT_REQUIRED');
  const fetcher=(input,options={})=>globalThis.fetch(input,{...options,
    ...(signal?{signal:options.signal?AbortSignal.any([signal,options.signal]):signal}:{})});
  const client=new ResearchWorkspaceClient({url},{fetch:fetcher,timeoutMs:120000});
  let browser,context,page,contextClosing,browserClosing;
  async function closeBrowser(){
    if(context&&!contextClosing)contextClosing=context.close();
    if(browser&&!browserClosing)browserClosing=browser.close();
    const results=await Promise.allSettled([contextClosing,browserClosing]);
    const failure=results.find(value=>value.status==='rejected');
    if(failure&&!signal?.aborted)throw failure.reason;
  }
  const abort=()=>{void closeBrowser().catch(()=>{});};
  signal?.addEventListener('abort',abort,{once:true});
  let browserResult;
  try{
    signal?.throwIfAborted();
    const status=await client.status(),metadata=await client.metadata(dossierId);
    need(status.workspaceId===expectedWorkspaceId&&metadata.id===dossierId&&metadata.revision===native.revision,
      'STUDY_TEMPLATE_EXISTING_HOST_SELECTION_CHANGED');
    const saved=await maybe(join(directory,'browser-complete.json'));
    if(saved){
      need(saved.dossierId===dossierId&&saved.revision===native.revision&&same(saved.selection,native.selection),
        'STUDY_TEMPLATE_BROWSER_SELECTION_CHANGED');
      for(const item of [saved.sourceDownload,...saved.screenshots])await fileIdentity(directory,item);
      browserResult=saved;
    }else{
      const playwright=await import(pathToFileURL(playwrightModule).href);
      const chromium=playwright.chromium??playwright.default?.chromium;
      need(chromium&&typeof chromium.launch==='function','STUDY_TEMPLATE_PLAYWRIGHT_REQUIRED');
      browser=await chromium.launch({executablePath:chromiumExecutable,headless:true,
        args:['--no-sandbox','--disable-dev-shm-usage']});
      signal?.throwIfAborted();
      context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
      signal?.throwIfAborted();page=await context.newPage();page.setDefaultTimeout(180000);
      browserResult=await runTemplateExchangeBrowser({page,templateUrl:connection.url.toString(),
        dossierId,revision:native.revision,selection:native.selection,runDirectory:directory,signal});
      signal?.throwIfAborted();
      need(browserResult.schema==='sf88-template-browser-result/v1'&&browserResult.dossierId===dossierId&&
        browserResult.revision===native.revision&&same(browserResult.selection,native.selection),
        'STUDY_TEMPLATE_BROWSER_RESULT_CHANGED');
      need(browserResult.url===connection.publicUrl&&!JSON.stringify(browserResult).includes(connection.token),
        'STUDY_TEMPLATE_BROWSER_PUBLIC_RECORD_REQUIRED');
      browserResult={...browserResult,
        sourceDownload:await fileIdentity(directory,browserResult.sourceDownload),
        screenshots:await Promise.all(browserResult.screenshots.map(item=>fileIdentity(directory,item)))};
      await immutable(join(directory,'browser-complete.json'),browserResult);
    }
    need((await client.metadata(dossierId)).revision===native.revision,'STUDY_TEMPLATE_BROWSER_CHANGED_DOSSIER');
  }finally{
    signal?.removeEventListener('abort',abort);
    const closed=await Promise.allSettled([closeBrowser(),client.close()]);
    const failure=closed.find(value=>value.status==='rejected');
    if(failure&&!signal?.aborted)throw failure.reason;
  }
  const files=new Map();
  for(const descriptor of [...native.files,native.archive,browserResult.sourceDownload,...browserResult.screenshots,
    join(directory,'selection.json'),join(directory,'template-exchange','original-selection.json'),
    join(directory,'template-exchange','original-source-case.json'),
    join(directory,'template-exchange','original-publication.json'),
    join(directory,'template-exchange','result.json'),join(directory,'browser-complete.json')]){
    signal?.throwIfAborted();const item=await fileIdentity(directory,descriptor),previous=files.get(item.file);
    need(!previous||same(previous,item),'STUDY_TEMPLATE_ARTIFACT_CHANGED');files.set(item.file,item);
  }
  const result={schema:SCHEMA,state:'COMPLETE',binding,dossierId,workspaceId:expectedWorkspaceId,
    originalRevision:revision,revision:native.revision,tableId,publicationId,
    sourceCaseSha256:native.sourceCaseSha256,publicationSha256:native.publicationSha256,
    selection:structuredClone(native.selection),sourceRows:native.sourceRows,mappedFields:native.mappedFields,
    clientComparison:structuredClone(native.clientComparison),retainedOperations:native.retainedOperations,
    retainedBlobs:native.retainedBlobs,checks:structuredClone(native.checks),
    browser:{revision:browserResult.revision,url:connection.publicUrl,selection:structuredClone(browserResult.selection),
      sourceDownload:browserResult.sourceDownload,screenshots:browserResult.screenshots,
      viewport:browserResult.viewport,pageErrors:browserResult.pageErrors},
    files:[...files.values()],completedAt:new Date().toISOString()};
  need(!JSON.stringify(result).includes(connection.token),'STUDY_TEMPLATE_PUBLIC_RESULT_REQUIRED');
  await immutable(join(directory,'programme-result.json'),result);return result;
}
