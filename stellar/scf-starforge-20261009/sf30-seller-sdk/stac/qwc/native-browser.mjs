// SPDX-License-Identifier: MIT
/** Operate the original publication and receiving consoles in an existing Chromium. */
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, readFile, lstat, mkdir, link, unlink } from 'node:fs/promises';
import { resolve, dirname, isAbsolute, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const SCHEMA = 'starforge.stac-qwc-publication-browser-input.v1';
const RESULT = 'starforge.stac-qwc-publication-browser-result.v1';
const need = (value, code, message) => { if (!value) throw Object.assign(new Error(message), { code }); };
const digest = value => createHash('sha256').update(value).digest('hex');
const encoded = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
let firstSignal = null, browser = null, closing = null, outputError = null;
const lifetime = new AbortController();
const interrupted = () => {
  if (firstSignal) throw Object.assign(new Error('The original browser receiving was cancelled.'), { code:'CANCELLED' });
  if (outputError) throw outputError;
  lifetime.signal.throwIfAborted();
};
function requestClose() { closing ??= closeBrowser().finally(() => { closing = null; }); }
function outputFailed(error) {
  outputError ??= Object.assign(new Error('The original browser output failed: ' + String(error.message)),
    {code:error.code??'OUTPUT_FAILED',cause:error});
  if(!lifetime.signal.aborted)lifetime.abort(outputError);
  requestClose();
}
function diagnostic(value) {
  if(outputError || process.stderr.destroyed)return;
  try{process.stderr.write(value,error=>{if(error)outputFailed(error);});}catch(error){outputFailed(error);}
}
process.stdout.on('error',outputFailed);process.stderr.on('error',outputFailed);
async function closeBrowser() {
  while (browser?.isConnected()) {
    try { await browser.close(); }
    catch (error) {
      if (!browser.isConnected()) break;
      diagnostic('Waiting for the same original browser to close: ' + String(error.message).slice(0,500) + '\n');
      await delay(1000);
    }
  }
}
function onSignal(name) {
  firstSignal ??= name;
  if(!lifetime.signal.aborted)lifetime.abort(Object.assign(new Error('The original browser receiving was cancelled.'),{code:'CANCELLED'}));
  requestClose();
}
const onInt = () => onSignal('SIGINT'), onTerm = () => onSignal('SIGTERM');
process.on('SIGINT', onInt); process.on('SIGTERM', onTerm);

async function identity(path, expected) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await file.stat({ bigint:true });
    need(before.isFile(), 'ORIGINAL_FILE', 'Use the retained ordinary file.');
    const hash = createHash('sha256'); let bytes = 0;
    for await (const block of file.createReadStream({autoClose:false})) { interrupted(); hash.update(block); bytes += block.length; }
    const after = await file.stat({ bigint:true });
    need(before.dev === after.dev && before.ino === after.ino && before.size === after.size &&
      before.mtimeNs === after.mtimeNs && BigInt(bytes) === before.size, 'FILE_CHANGED', 'The original file changed while receiving.');
    const result = { path:resolve(path), bytes, sha256:hash.digest('hex') };
    need(!expected || result.bytes === expected.bytes && result.sha256 === expected.sha256,
      'FILE_IDENTITY', 'The retained file differs from the original transfer.');
    return result;
  } finally { await file.close(); }
}
async function ordinary(path) {
  const info = await lstat(path);
  need(info.isFile() && !info.isSymbolicLink(), 'ORIGINAL_FILE', 'Choose the original ordinary file.');
  return info;
}
async function syncDirectory(path) { const fd = await open(path,'r'); try { await fd.sync(); } finally { await fd.close(); } }
async function retain(path, value) {
  const body = encoded(value); await mkdir(dirname(path),{recursive:true,mode:0o700});
  try { await ordinary(path); need((await readFile(path)).equals(body),'RETAINED_INPUT_CHANGED','Continue the original browser input.'); await syncDirectory(dirname(path)); return; }
  catch(error) { if(error.code !== 'ENOENT') throw error; }
  const temporary = path + '.pending-' + process.pid + '-' + cryptoId();
  let fd;
  try {
    fd = await open(temporary,'wx',0o600); await fd.writeFile(body); await fd.sync(); await fd.close(); fd = null;
    try { await link(temporary,path); } catch(error) {
      if(error.code !== 'EEXIST') throw error;
      await ordinary(path); need((await readFile(path)).equals(body),'RETAINED_INPUT_CHANGED','Continue the original browser input.');
    }
    await syncDirectory(dirname(path));
  } finally { if(fd) await fd.close(); await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;}); }
}
function cryptoId() { return createHash('sha256').update(String(process.hrtime.bigint()) + Math.random()).digest('hex').slice(0,20); }
async function exists(path) { try { await ordinary(path); return true; } catch(error) { if(error.code==='ENOENT')return false; throw error; } }
function owned(out,path) {
  const tail = relative(out,resolve(path));
  need(tail && tail !== '..' && !tail.startsWith('../') && !isAbsolute(tail),'ARTIFACT_PATH','Keep the browser artifact in its original directory.');
  return resolve(path);
}
async function currentConnection(input) {
  const info = await ordinary(input.connectionFile);
  need((info.mode & 0o077)===0 && info.uid===process.getuid(),'PRIVATE_CONNECTION','Open the private original console connection.');
  const url = new URL((await readFile(input.connectionFile,'utf8')).trim());
  need(url.protocol==='http:' && url.hostname==='127.0.0.1' && url.pathname==='/' &&
    !url.username && !url.password && !url.search && /^[A-Za-z0-9_-]{43}$/.test(url.hash.slice(1)),
    'LOCAL_CONSOLE','Use the original selected loopback console.');
  return {url,token:url.hash.slice(1)};
}
async function main() {
  need(process.argv.length===4 && process.argv[2]==='--input','BROWSER_INPUT','Select the complete original browser input.');
  const inputPath=resolve(process.argv[3]); await ordinary(inputPath);
  const input=JSON.parse(await readFile(inputPath,'utf8'));
  need(input.schema===SCHEMA && ['publisher','received'].includes(input.mode),'BROWSER_INPUT','Use the original complete publication browser input.');
  const out=resolve(input.output); await mkdir(out,{recursive:true,mode:0o700});
  const rootInfo=await lstat(out); need(rootInfo.isDirectory() && !rootInfo.isSymbolicLink() && (rootInfo.mode&0o077)===0,
    'PRIVATE_BROWSER_OUTPUT','Keep the original browser outputs private.');
  await retain(resolve(out,'input.json'),input);
  const resultPath=resolve(out,'result.json');
  if(await exists(resultPath)) {
    const prior=JSON.parse(await readFile(resultPath,'utf8'));
    need(prior.schema===RESULT && prior.operationId===input.operationId && prior.inputSha256===digest(encoded(input)),
      'BROWSER_RESULT_CHANGED','Continue the original completed browser receiving.');
    for(const file of prior.artifacts) await identity(owned(out,file.path),file);
    return prior;
  }
  const {url,token}=await currentConnection(input);
  const auth={Authorization:'Bearer '+token};
  const request=async(path,body) => {
    interrupted();
    const requestLifetime=new AbortController();
    const forward=()=>requestLifetime.abort(lifetime.signal.reason);
    lifetime.signal.addEventListener('abort',forward,{once:true});
    if(lifetime.signal.aborted)forward();
    const timer=setTimeout(()=>requestLifetime.abort(Object.assign(
      new Error('The original loopback request exceeded its selected allowance.'),{code:'CONSOLE_REQUEST_TIMEOUT'})),
      Math.min(input.timeoutSeconds*1000,30000));
    try {
      const response=await fetch(url.origin+path,{method:body===undefined?'GET':'POST',redirect:'error',
        signal:requestLifetime.signal,
        headers:{...auth,...(body===undefined?{}:{'Content-Type':'application/json'})},
        body:body===undefined?undefined:JSON.stringify(body)});
      need(response.status>=200 && response.status<300,'CONSOLE_HTTP','The original console request returned '+response.status+'.');
      const value=await response.json();
      need(!value.error,value.error?.code??'CONSOLE_ERROR',value.error?.message??'The original console operation failed.');
      interrupted();
      return value;
    } finally {clearTimeout(timer);lifetime.signal.removeEventListener('abort',forward);}
  };
  const launch=await request('/api/launch');
  need(launch.schema==='starforge.stac-qwc-launch.v1' && launch.status==='QWC_OPERATOR_READY' &&
    launch.mode===input.mode && launch.workspace===input.workspace && launch.workspaceId===input.workspaceId &&
    launch.bindingSha256===input.bindingSha256,'CONSOLE_IDENTITY','The browser connection selects a different original workspace.');
  const {chromium}=await import(pathToFileURL(input.browser.playwrightModule).href);
  interrupted();
  browser=await chromium.launch({executablePath:input.browser.chrome,headless:true,
    args:['--no-sandbox','--disable-dev-shm-usage','--disable-background-networking']});
  if(firstSignal || lifetime.signal.aborted || outputError) { await closeBrowser(); interrupted(); }
  const context=await browser.newContext({viewport:{width:1280,height:900},acceptDownloads:true});
  await context.route('**/*',route=>{
    try { const target=new URL(route.request().url()); return target.origin===url.origin?route.continue():route.abort(); }
    catch { return route.abort(); }
  });
  const page=await context.newPage(),errors=[],artifacts=[],stages={};
  page.on('pageerror',error=>errors.push(String(error.message)));
  page.setDefaultTimeout(Math.min(input.timeoutSeconds*1000,120000));
  page.setDefaultNavigationTimeout(Math.min(input.timeoutSeconds*1000,120000));
  await page.goto(url.href,{waitUntil:'networkidle'});
  await page.locator('#workspace-title').filter({hasText:input.workspace}).waitFor();
  async function job(action,click) {
    interrupted();
    const observed=page.waitForResponse(response=>{
      const candidate=new URL(response.url());
      return candidate.origin===url.origin && candidate.pathname==='/api/actions/'+action &&
        response.request().method()==='POST';
    });
    await click();
    const response=await observed,value=await response.json();
    need(response.ok() && !value.error,value.error?.code??'NATIVE_JOB',value.error?.message??'The original native job failed to start.');
    const until=Date.now()+input.timeoutSeconds*1000;
    let current=value;
    while(['STARTING','RUNNING'].includes(current.phase)) {
      interrupted(); need(Date.now()<until,'NATIVE_JOB_TIMEOUT','The original native job remains active beyond its selected browser allowance.');
      await delay(700,undefined,{signal:lifetime.signal}); current=await request('/api/job?id='+encodeURIComponent(current.id));
    }
    need(current.phase==='COMPLETED','NATIVE_JOB_RESULT',JSON.stringify(current.error??{phase:current.phase}));
    return current;
  }
  async function saveShot(name) {
    interrupted();
    const filename=owned(out,resolve(out,name));
    await page.screenshot({path:filename,fullPage:true});
    artifacts.push(await identity(filename));
  }
  async function transfer(downloadButton,filename,expected) {
    const destination=owned(out,resolve(out,filename)),pending=destination+'.pending';
    if(await exists(destination)) return identity(destination,expected);
    if(await exists(pending)) {
      let complete=false;
      try { await identity(pending,expected); complete=true; }
      catch(error) { if(error.code!=='FILE_IDENTITY')throw error; }
      if(complete) {
        const fd=await open(pending,'r+');try{await fd.sync();}finally{await fd.close();}
        try{await link(pending,destination);}catch(error){if(error.code!=='EEXIST')throw error;}
        await identity(destination,expected);await syncDirectory(out);await unlink(pending);return identity(destination,expected);
      }
      await unlink(pending);
    }
    let download;
    try {
      const pendingDownload=page.waitForEvent('download'); await downloadButton.click();download=await pendingDownload;
      await download.saveAs(pending);
      need(await download.failure()===null,'ORIGINAL_DOWNLOAD','The complete original download did not finish.');
      await identity(pending,expected);
      const fd=await open(pending,'r+');try{await fd.sync();}finally{await fd.close();}
      try{await link(pending,destination);}catch(error){if(error.code!=='EEXIST')throw error;}
      await identity(destination,expected);await syncDirectory(out);
      return identity(destination,expected);
    } finally {
      if(download)await download.delete();
      await unlink(pending).catch(error=>{if(error.code!=='ENOENT')throw error;});
    }
  }
  if(input.mode==='publisher') {
    need(Array.isArray(input.editions) && input.editions.length===2,'TWO_EDITIONS','Select both original publication editions.');
    for(const edition of input.editions) {
      await page.locator('#edition-list button').filter({hasText:edition.requestId}).click();
      await page.locator('#edition-identity').filter({hasText:edition.publicationId}).waitFor();
      const actual=(await request('/api/operation?requestId='+encodeURIComponent(edition.requestId))).operations[0];
      need(actual.publicationSha256===edition.publicationSha256 &&
        actual.publication.qgis.projectId===edition.projectId,'PUBLICATION_IDENTITY','The original displayed publication differs.');
      need(await page.locator('#edition-layers tbody tr').count()===actual.publication.theme.layers.length,
        'NATIVE_LAYERS','The browser must show every selected native layer.');
      await page.locator('#file-details').evaluate(node=>{node.open=true;});
      await page.locator('#publication-files tbody tr').first().waitFor();
      stages[edition.requestId]={publicationId:edition.publicationId,publicationSha256:edition.publicationSha256,
        phase:actual.operation.phase,layers:actual.publication.theme.layers.length};
    }
    const chosen=input.editions[1];
    need(stages[chosen.requestId].phase==='ROLLED_BACK','RESTORED_EDITION','The full native journey restores the first edition before final handover.');
    const verified=await job('verify',()=>page.locator('#verify-edition').click());
    stages.verify=verified.result;
    await page.locator('#export-id').fill(input.exportId);
    const exported=await job('export',()=>page.locator('#export-form button[type=submit]').click());
    await page.locator('#download-export').waitFor({state:'visible'});
    need(exported.result.publicationId===chosen.publicationId,'EXPORT_IDENTITY','The native export belongs to a different publication.');
    await retain(resolve(out,'export-input.json'),{exportId:input.exportId,requestId:chosen.requestId,
      publicationSha256:chosen.publicationSha256,exported:exported.result});
    const archive=await transfer(page.locator('#download-export'),'QWC_Refreshed_Publication.zip',exported.result);
    artifacts.push(archive);stages.export=exported.result;stages.archive=archive;
    await page.locator('#show-host').click();
    await page.locator('#host-panel').waitFor({state:'visible'});await saveShot('publisher-host.png');
    await page.locator('#show-receive').click();
    await page.locator('#receive-file').setInputFiles(archive.path);
    await page.locator('#receive-sha').fill(archive.sha256);
    await page.locator('#receiver-id').fill(input.receiverId);
    await page.locator('#receive-python').fill(input.qgisPython);
    const received=await job('receive',()=>page.locator('#receive-form button[type=submit]').click());
    await page.locator('#received-panel').waitFor({state:'visible'});
    const actual=await request('/api/received?receiverId='+encodeURIComponent(input.receiverId));
    need(actual.receipt.publicationId===chosen.publicationId && actual.receipt.archiveSha256===archive.sha256,
      'RECEIVING_IDENTITY','The browser receiver must preserve the original archive and publication.');
    stages.receive=received.result;stages.receivedDirectory=actual.directory;
    await page.locator('#reopen-python').fill(input.qgisPython);
    const reopened=await job('reopen',()=>page.locator('#reopen-received').click());
    need(reopened.result.publicationSha256===chosen.publicationSha256,'REOPEN_IDENTITY','The native QGIS reader reopened a different edition.');
    stages.reopen=reopened.result;
    await page.locator('#reopen-result').filter({hasText:chosen.publicationId}).waitFor();
    await saveShot('publisher-received-project.png');
  } else {
    await page.locator('#receiving-list button').filter({hasText:'Open original received edition'}).click();
    await page.locator('#received-summary').filter({hasText:input.publicationId}).waitFor();
    const actual=await request('/api/received?receiverId=original');
    need(actual.publicationSha256===input.publicationSha256 && actual.receipt.archiveSha256===input.archiveSha256,
      'RECEIVED_IDENTITY','The independently opened console must preserve the complete original receiving.');
    const verified=await job('verify-received',()=>page.locator('#verify-received').click());
    stages.verify=verified.result;
    await page.locator('#reopen-python').fill(input.qgisPython);
    const reopened=await job('reopen',()=>page.locator('#reopen-received').click());
    need(reopened.result.publicationSha256===input.publicationSha256,'REOPEN_IDENTITY','The received native project differs.');
    stages.reopen=reopened.result;
    await page.locator('#reopen-result').filter({hasText:input.publicationId}).waitFor();
    await saveShot('received-console.png');
  }
  await page.setViewportSize({width:390,height:844});
  await page.locator('#received-panel').waitFor({state:'visible'});
  need(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),
    'NARROW_RECEIVING_LAYOUT','The receiving operator must fit its selected narrow viewport.');
  await saveShot('received-narrow.png');
  await page.reload({waitUntil:'networkidle'});
  await page.locator('#workspace-title').filter({hasText:input.workspace}).waitFor();
  need(!errors.length,'BROWSER_RUNTIME_ERROR',errors.join('\n').slice(0,2000));
  await closeBrowser(); browser=null;
  interrupted();
  const result={schema:RESULT,status:'COMPLETED',operationId:input.operationId,mode:input.mode,
    inputSha256:digest(encoded(input)),workspace:input.workspace,workspaceId:input.workspaceId,
    bindingSha256:input.bindingSha256,stages,artifacts,completedAt:new Date().toISOString()};
  await retain(resultPath,result);
  return result;
}
try {
  const result=await main();
  interrupted();
  await new Promise((accept,reject)=>{
    try{process.stdout.write(JSON.stringify({schema:result.schema,status:result.status,
      operationId:result.operationId,mode:result.mode,artifacts:result.artifacts.length})+'\n',
      error=>error?reject(error):accept());}catch(error){reject(error);}
  });
  interrupted();
} catch(error) {
  diagnostic(JSON.stringify({error:{code:outputError?.code??error.code??error.name,
    message:outputError?.message??error.message}})+'\n');
  process.exitCode=firstSignal==='SIGINT'?130:firstSignal==='SIGTERM'?143:1;
} finally {
  await closeBrowser();if(closing)await closing;
  process.removeListener('SIGINT',onInt);process.removeListener('SIGTERM',onTerm);
  if(firstSignal)process.exitCode=firstSignal==='SIGINT'?130:143;
  else if(outputError)process.exitCode=1;
  // Stream error listeners remain for the remaining process lifetime, including
  // delayed pipe-close errors after the native browser has fully drained.
}
