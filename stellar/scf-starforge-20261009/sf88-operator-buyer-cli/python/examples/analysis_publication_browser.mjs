#!/usr/bin/env node
/** Original saved Analysis export -> Data Package -> merchant/workbench receiving.
 * Called only by analysis_publication_native.py with its immutable configuration.
 */
import { promises as fs, createWriteStream } from 'node:fs';
import { constants as FS } from 'node:fs';
import { join, dirname, resolve, isAbsolute, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { tmpdir } from 'node:os';
import { startPublicationMerchant } from './analysis_publication_merchant.mjs';
import { runAnalysisPublicationMcpJourney } from './analysis_publication_mcp.mjs';

const SCHEMA = 'stellar-forge.analysis-dataset-publication-native.v1';
const HERE = dirname(fileURLToPath(import.meta.url));
const ID = /^[a-f0-9]{32}$/, SHA = /^[a-f0-9]{64}$/;
const need = (value, message) => { if (!value) throw new Error(message); };
const digest = value => createHash('sha256').update(value).digest('hex');
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' :
  value && typeof value === 'object' ? '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}' : JSON.stringify(value);
const same = (a, b) => canonical(a) === canonical(b);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function regular(path, limit = 64 * 1024 * 1024) {
  const handle = await fs.open(path, FS.O_RDONLY | FS.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    need(before.isFile() && before.size <= limit, 'A bounded original regular file is required: ' + path);
    const bytes = await handle.readFile(), after = await handle.stat();
    need(before.dev === after.dev && before.ino === after.ino && before.size === after.size &&
      before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs && bytes.length === before.size,
      'Original file changed during read');
    return bytes;
  } finally { await handle.close(); }
}
async function present(path) { try { await fs.lstat(path); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } }
async function record(path) {
  const handle = await fs.open(path, FS.O_RDONLY | FS.O_NOFOLLOW);
  try {
    const before = await handle.stat(); need(before.isFile(), 'Original file must be regular');
    const hash = createHash('sha256'); let bytes = 0;
    for await (const block of handle.createReadStream({ autoClose: false })) { hash.update(block); bytes += block.length; }
    const after = await handle.stat();
    need(before.dev === after.dev && before.ino === after.ino && before.size === after.size &&
      before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs && bytes === before.size,
      'Original file changed during verification');
    return { path: resolve(path), bytes, sha256: hash.digest('hex') };
  } finally { await handle.close(); }
}
async function directory(path) {
  await fs.mkdir(path, { recursive: true, mode: 0o700 });
  const s = await fs.lstat(path);
  need(s.isDirectory() && !s.isSymbolicLink() && !(s.mode & 0o077) &&
    (!process.getuid || s.uid === process.getuid()), 'Use an original caller-owned private directory');
  return path;
}
async function syncDirectory(path) { const h = await fs.open(path, FS.O_RDONLY); try { await h.sync(); } finally { await h.close(); } }
async function write(path, bytes, { immutable = false } = {}) {
  bytes = Buffer.from(bytes);
  if (immutable && await present(path)) {
    need((await regular(path, bytes.length + 1)).equals(bytes), 'Original immutable file changed: ' + path);
    return;
  }
  const pending = path + '.pending';
  await fs.unlink(pending).catch(e => { if (e.code !== 'ENOENT') throw e; });
  const h = await fs.open(pending, 'wx', 0o600);
  try { await h.writeFile(bytes); await h.sync(); } finally { await h.close(); }
  await fs.rename(pending, path);
  await syncDirectory(dirname(path));
}
async function verifyArtifacts(value, root) {
  if (Array.isArray(value)) { for (const item of value) await verifyArtifacts(item, root); return; }
  if (!value || typeof value !== 'object') return;
  if (typeof value.path === 'string' && isAbsolute(value.path) && value.path.startsWith(root + sep) &&
      Number.isSafeInteger(value.bytes) && SHA.test(value.sha256 ?? '')) {
    const actual = await record(value.path);
    need(actual.bytes === value.bytes && actual.sha256 === value.sha256, 'Retained receiving file changed: ' + value.path);
  }
  for (const item of Object.values(value)) await verifyArtifacts(item, root);
}
async function waitFor(fn, description, timeout = 90_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const value = await fn(); if (value) return value; await delay(100); }
  throw new Error('Original continuation is still waiting for ' + description);
}
async function stopChild(child, signal = 'SIGINT') {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill(signal);
  await Promise.race([new Promise(r => child.once('exit', r)), delay(20_000)]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL'); await new Promise(r => child.once('exit', r));
  }
}


async function main(argv) {
  need(argv.length === 4 && argv[0] === '--configuration' && argv[2] === '--phase' &&
    ['prepare','publish','restore'].includes(argv[3]), 'Use the original configuration and receiving phase.');
  const phase = argv[3], configPath = resolve(argv[1]), configRaw = await regular(configPath, 1024 * 1024);
  const c = JSON.parse(configRaw), configurationSha = digest(configRaw);
  need(c.schema === SCHEMA && ID.test(c.workspace_id) && ID.test(c.query_export_id) &&
    SHA.test(c.export_manifest_sha256) && isAbsolute(c.directory) &&
    isAbsolute(c.analysis_directory) && isAbsolute(c.checkout), 'The original receiving configuration is invalid.');
  const root = await directory(c.directory), output = await directory(join(root, 'output'));
  need(configPath === join(root, 'browser-' + phase + '-configuration.json'), 'The original configuration path changed.');
  const resultPath = join(root, 'browser-' + phase + '-result.json');
  if (await present(resultPath)) {
    const saved = JSON.parse(await regular(resultPath));
    need(saved.schema === SCHEMA && saved.phase === phase && saved.operation_id === c.operation_id &&
      saved.workspace_id === c.workspace_id && saved.configuration_sha256 === configurationSha,
      'The completed browser result has a different original configuration.');
    await verifyArtifacts(saved, root);
    console.log(JSON.stringify({ status:'COMPLETE', phase, reused:true, result:resultPath })); return;
  }
  const journalPath = join(root, 'browser-' + phase + '-journal.json');
  let journal = await present(journalPath) ? JSON.parse(await regular(journalPath)) : {
    schema:SCHEMA, phase, operation_id:c.operation_id, workspace_id:c.workspace_id,
    configuration_sha256:configurationSha, requests:{}, files:{}, screenshots:{}, steps:{},
    browser_journal:null, created_at:new Date().toISOString(),
  };
  need(journal.schema === SCHEMA && journal.phase === phase && journal.operation_id === c.operation_id &&
    journal.workspace_id === c.workspace_id && journal.configuration_sha256 === configurationSha,
    'The original browser journal changed.');
  let writes = Promise.resolve();
  function checkpoint() { const body=json(journal); writes=writes.then(()=>write(journalPath,body)); return writes; }
  await checkpoint();
  let host, merchant, context, privateRuntime, childOutput, page, primaryError, currentAction;
  const browserErrors=[], key='stellar-forge.analysis-publication-browser.v1:'+c.workspace_id;
  const terminal = value => value && value.status !== 'RUNNING';

  async function api(path) {
    const response=await fetch(host.origin+path,{headers:{'X-Analysis-Capability':host.capability},
      redirect:'error',signal:AbortSignal.timeout(30000)});
    const value=await response.json();
    if(!response.ok)throw Object.assign(new Error(value.error||'Original Analysis read failed.'),{code:value.error,status:response.status});
    return value;
  }
  async function captureBrowser() {
    const raw=await page.evaluate(key=>localStorage.getItem(key),key);
    if(raw){const value=JSON.parse(raw);need(value.workspace_id===c.workspace_id,'Browser workspace changed.');
      journal.browser_journal=value;await checkpoint();}
  }
  async function seedBrowser() {
    const prior=c.browser_journal;
    let saved=journal.browser_journal||prior||{schema:'stellar-forge.analysis-publication-browser.v1',
      workspace_id:c.workspace_id,requests:[],selected:{query_export_id:c.query_export_id,recipe_id:null,package_id:c.package_id||null,connection:null}};
    saved=structuredClone(saved);
    need(saved.schema==='stellar-forge.analysis-publication-browser.v1'&&saved.workspace_id===c.workspace_id&&Array.isArray(saved.requests),'Original browser request history changed.');
    for(const v of Object.values(journal.requests)){
      const old=saved.requests.find(x=>x.id===v.body.id);
      need(!old||old.kind===v.kind&&same(old.body,v.body),'Captured request differs from original browser history.');
      if(!old)saved.requests.push({id:v.body.id,kind:v.kind,body:v.body,state:'PENDING',created_at:journal.created_at});
    }
    if(c.package_id)saved.selected={...saved.selected,package_id:c.package_id};
    journal.browser_journal=saved;await checkpoint();
    await context.addInitScript(({key,saved})=>{
      if(location.protocol==='http:'&&!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify(saved));
    },{key,saved});
  }
  async function captureFile(map,key,finalPath,produce) {
    const old=journal[map][key];
    if(old?.state==='COMPLETE'){const actual=await record(old.path);need(actual.bytes===old.bytes&&actual.sha256===old.sha256,'Retained file changed.');return actual;}
    const pending=finalPath+'.captured';let captured=old;
    if(captured){need(captured.state==='CAPTURED'&&captured.path===finalPath&&captured.pending===pending,'Retained capture identity changed.');
      const actual=await record(await present(finalPath)?finalPath:pending);
      need(actual.bytes===captured.bytes&&actual.sha256===captured.sha256,'Original captured bytes changed.');}
    else{
      await fs.unlink(pending).catch(e=>{if(e.code!=='ENOENT')throw e;});
      await produce(pending);
      const actual=await record(pending);captured={state:'CAPTURED',path:finalPath,pending,bytes:actual.bytes,sha256:actual.sha256};
      journal[map][key]=captured;await checkpoint();
    }
    if(await present(finalPath)){const actual=await record(finalPath);need(actual.bytes===captured.bytes&&actual.sha256===captured.sha256,'Final retained bytes changed.');
      await fs.unlink(pending).catch(e=>{if(e.code!=='ENOENT')throw e;});}
    else await fs.rename(pending,finalPath);
    await syncDirectory(dirname(finalPath));
    journal[map][key]={state:'COMPLETE',path:finalPath,bytes:captured.bytes,sha256:captured.sha256};await checkpoint();
    return record(finalPath);
  }
  async function screenshot(name,width) {
    await page.setViewportSize({width,height:width<500?844:1000});
    await page.evaluate(()=>document.fonts.ready);
    const geometry=await page.evaluate(()=>({width:innerWidth,scroll:Math.max(document.documentElement.scrollWidth,document.body.scrollWidth)}));
    need(geometry.scroll<=geometry.width+1,'The actual publication page overflows its viewport.');
    return captureFile('screenshots',name,join(output,'dataset-'+phase+'-'+name+'.png'),async pending=>{
      await page.screenshot({path:pending,type:'png',fullPage:true});await fs.chmod(pending,0o600);
    });
  }
  async function download(index,item,source=false) {
    const section=page.locator(source?'#native-downloads':'#package-files');
    const card=section.locator('.download').filter({has:page.getByText(item.name,{exact:true})});
    need(await card.count()===1,'The original file is not uniquely displayed: '+item.name);
    const name=(source?'source-':'package-')+item.name.replaceAll('/','__');
    return captureFile('files',name,join(output,phase+'-'+name),async pending=>{
      const event=page.waitForEvent('download');await card.getByRole('button',{name:'Download original file',exact:true}).click();
      const value=await event;need(await value.failure()===null,'Original browser download failed.');
      await value.saveAs(pending);await fs.chmod(pending,0o600);
      const actual=await record(pending);need(actual.bytes===item.bytes&&actual.sha256===item.sha256,'Downloaded original member changed.');
    });
  }
  function requestCard(entry) {
    return page.locator('#request-history article').filter({hasText:entry.body.id});
  }
  async function waitLocal(entry) {
    return waitFor(async()=>{
      let value;try{value=await api('/api/jobs/'+entry.body.id);}catch(error){if(error.code==='ANALYSIS_JOB_NOT_FOUND'||error.status===404)return false;throw error;}
      need(value.id===entry.body.id&&value.kind===entry.kind&&
        same(value.kind==='dataset-source'?value.request.original_request:value.request,entry.body),'Original Analysis request changed.');
      return terminal(value)?value:false;
    },'original '+entry.kind+' completion',300000);
  }
  async function readEntry(entry) {
    const card=requestCard(entry);need(await card.count()===1,'The saved original request is not displayed.');
    await card.getByRole('button',{name:'Read saved request',exact:true}).click();
    await waitFor(async()=>{
      const raw=await page.evaluate(key=>localStorage.getItem(key),key);if(!raw)return false;
      const v=JSON.parse(raw).requests.find(v=>v.id===entry.body.id);
      return v&&!['PENDING','UNKNOWN','RUNNING'].includes(v.state)?v:false;
    },'the retained request observation',300000);
    await captureBrowser();
  }
  async function continueEntry(entry) {
    currentAction=Object.keys(journal.requests).find(k=>journal.requests[k].body.id===entry.body.id);
    try{await requestCard(entry).getByRole('button',{name:'Continue exact request',exact:true}).click();}
    finally{currentAction=null;}
  }
  async function sourceRead(action,args={}) {
    await waitFor(async()=>!await page.locator('#run-native').isDisabled(),'the original action controls',300000);
    await page.locator('#native-read-action').selectOption(action);
    await page.locator('#native-read-args').fill(JSON.stringify(args));
    const response=page.waitForResponse(r=>{
      if(r.request().method()!=='POST'||new URL(r.url()).pathname!=='/api/publication/source-read')return false;
      const b=r.request().postDataJSON();return b.action===action&&same(b.args,args);
    });
    await page.locator('#native-read-form button[type="submit"]').click();
    const answer=await response,value=await answer.json();
    need(answer.ok()&&value.mode==='ANALYSIS_PUBLICATION_BRIDGE'&&value.ok===true&&
      value.workspace_id===c.workspace_id&&value.action===action,'The original source read failed: '+JSON.stringify(value));
    await waitFor(async()=>!await page.locator('#run-native').isDisabled(),'the native read render');
    journal.steps.last_native_read={action,args,result:value};await checkpoint();await captureBrowser();return value.result;
  }
  async function performSource(name,action,makeArgs,{recover=false}={}) {
    let entry=journal.requests[name],previous=!!entry;
    if(!entry){
      const args=await makeArgs();
      await waitFor(async()=>!await page.locator('#run-native').isDisabled(),'the source action controls',300000);
      await page.locator('#native-action').selectOption(action);
      for(const [key,value] of Object.entries(args)){
        const input=page.locator('#native-field-'+key);await input.waitFor();
        if(typeof value==='boolean')await input.selectOption(String(value));
        else await input.fill(typeof value==='object'?JSON.stringify(value):String(value));
      }
      currentAction=name;
      try{await page.locator('#run-native').click();await waitFor(()=>journal.requests[name],'the original request capture');}
      finally{currentAction=null;}
      entry=journal.requests[name];
    }else{
      need(entry.kind==='dataset-source'&&entry.body.action===action&&entry.body.package_id===c.package_id&&
        entry.body.index_sha256===c.package_index_sha256,'Original source request binding changed.');
      let job;try{job=await api('/api/jobs/'+entry.body.id);}catch(error){if(error.code!=='ANALYSIS_JOB_NOT_FOUND'&&error.status!==404)throw error;}
      if(!job)await continueEntry(entry);
    }
    let job=await waitLocal(entry);
    if(job.status!=='COMPLETE'&&(previous||recover)){
      need(['FAILED','INTERRUPTED','CANCELLED'].includes(job.status),'Original source outcome is not resumable.');
      journal.steps[name+'_interrupted']={id:job.id,status:job.status,error:job.error,progress:job.progress};await checkpoint();
      if(action==='publisher-publish'){
        const loss=await merchant.publicationLoss();
        if(loss){journal.steps.publisher_reply_loss=loss;await checkpoint();}
      }
      await continueEntry(entry);job=await waitLocal(entry);
    }
    need(job.status==='COMPLETE','Original source action needs review: '+action+' '+JSON.stringify(job.error));
    await readEntry(entry);
    const reply=job.result?.native;
    need(reply?.mode==='ANALYSIS_PUBLICATION_BRIDGE'&&reply.ok===true&&reply.id===job.id&&
      reply.native_request_id===job.request.native_request_id&&reply.action===action,'Original bridge receipt changed.');
    journal.steps[name]={id:job.id,native_request_id:job.request.native_request_id,result:reply.result};
    await checkpoint();return{job,reply,result:reply.result};
  }
  async function workbenchOperation(value) {
    const id=value.job.request.native_request_id;
    let result=value.result.operation??value.result;
    if(result.id!==id||result.state!=='COMPLETE')
      result=await waitFor(async()=>{
        const observed=await sourceRead('request',{requestId:id});
        need(observed.id===id,'Native workbench request changed.');
        if(observed.state==='INTERRUPTED'){
          need(typeof observed.updatedAt==='string','Original interruption timestamp is missing.');
          const observationKey=digest(json({id,updatedAt:observed.updatedAt,stage:observed.stage,error:observed.error}));
          journal.steps['native-interruption-'+observationKey]=observed;await checkpoint();
          const resumed=await performSource('resume-'+id+'-'+observationKey.slice(0,16),'resume',async()=>({requestId:id}),{recover:true});
          const retained=resumed.result.operation??resumed.result;
          need(retained.id===id,'The original native resume selected a different request.');
          return retained.state==='COMPLETE'?retained:false;
        }
        if(['FAILED','CANCELLED'].includes(observed.state))
          throw new Error('The original workbench request requires review: '+id+' '+observed.state);
        return observed.state==='COMPLETE'?observed:false;
      },'the original workbench operation',300000);
    need(result.id===id&&result.state==='COMPLETE','Original workbench operation is not complete.');
    return result;
  }
  async function openPackage(id) {
    const card=page.locator('#package-list article').filter({hasText:id});need(await card.count()===1,'Original package is not listed.');
    await card.getByRole('button',{name:'Open',exact:true}).click();
    await waitFor(async()=>(await page.locator('#package-summary').textContent()).includes(id),'the original package display');
    const value=await api('/api/publication/jobs/'+id+'/package');
    need(value.index.job_id===id&&value.index.workspace_id===c.workspace_id,'Original package selection changed.');
    return value;
  }

  try {
    let connectionFile=null;
    if(phase==='publish'){
      merchant=await startPublicationMerchant({directory:join(root,'merchant'),operationId:c.operation_id,
        package:c.merchant_package,python:c.python});
      connectionFile=merchant.connectionFile;
      need(merchant.analysis_workspace_id===c.workspace_id&&merchant.package_job_id===c.package_id,
        'The original merchant belongs to a different Analysis package.');
      journal.steps.merchant={workspace_id:merchant.workspace_id,endpoint:merchant.endpoint,
        package_job_id:merchant.package_job_id,index_sha256:merchant.index_sha256,bootstrap:merchant.bootstrap};
      await checkpoint();
    }
    childOutput=createWriteStream(join(root,'analysis-'+phase+'.log'),{flags:'a',mode:0o600});
    const args=['-B','-m','stellar_forge_buyer.analysis_workspace','--database',c.analysis_directory];
    if(phase!=='restore')args.push('--checkout',c.checkout,'--node',c.node);
    if(connectionFile)args.push('--publication-connections',connectionFile);
    args.push('serve','--port','0');
    const ownerFd=Number(process.env.ANALYSIS_DATASET_OWNER_FD);
    need(Number.isInteger(ownerFd)&&ownerFd>=3,'The original programme lock must remain inherited.');
    const child=spawn(c.python,args,{cwd:c.checkout,env:{...process.env,PYTHONPATH:resolve(HERE,'..'),PYTHONDONTWRITEBYTECODE:'1'},
      stdio:['ignore','pipe','pipe',ownerFd]});
    host={child};
    child.stdout.pipe(childOutput,{end:false});child.stderr.pipe(childOutput,{end:false});
    let spawnError;child.once('error',error=>{spawnError=error;});
    const launch=await waitFor(async()=>{
      if(spawnError)throw spawnError;
      need(child.exitCode===null&&child.signalCode===null,'The original Analysis host ended before READY.');
      try{const v=JSON.parse(await regular(join(c.analysis_directory,'analysis-launch.json'),65536));
        if(v.pid!==child.pid)return false;need(v.workspace_id===c.workspace_id,'Analysis host identity changed.');return v;
      }catch(error){if(error.code==='ENOENT')return false;throw error;}
    },'the original Analysis host');
    const address=new URL(launch.url);need(address.protocol==='http:'&&address.hostname==='127.0.0.1'&&address.hash.length>1,'Original host URL changed.');
    host.origin=address.origin;host.capability=address.hash.slice(1);
    const configuration=await api('/api/publication/configuration');
    need(configuration.workspace_id===c.workspace_id&&(phase!=='restore'||configuration.connections.length===0),'Original offline configuration changed.');
    const tempRoot=await fs.realpath(c.temporary_root||tmpdir());privateRuntime=await fs.mkdtemp(join(tempRoot,'analysis-dataset-native-'));
    await fs.chmod(privateRuntime,0o700);
    const {chromium}=await import(pathToFileURL(c.playwright).href);
    context=await chromium.launchPersistentContext(join(privateRuntime,'browser'),{
      executablePath:c.chromium,headless:true,viewport:{width:1440,height:1000},acceptDownloads:true,
      args:['--no-sandbox','--disable-dev-shm-usage'],env:{...process.env,TMPDIR:privateRuntime},
    });
    await seedBrowser();page=context.pages()[0]||await context.newPage();
    page.on('pageerror',error=>browserErrors.push(error.message));
    await context.route(host.origin+'/api/**',async route=>{
      if(route.request().method()!=='POST')return route.continue();
      const path=new URL(route.request().url()).pathname;
      const kind=path==='/api/publication/recipes'?'recipe':path==='/api/start/dataset-package'?'dataset-package':
        path==='/api/start/dataset-source'?'dataset-source':null;
      if(!kind)return route.continue();
      try{
        const body=route.request().postDataJSON();
        let name=currentAction||Object.keys(journal.requests).find(k=>journal.requests[k].body.id===body.id);
        need(name&&ID.test(body.id),'No retained original browser action owns this request.');
        if(journal.requests[name])need(journal.requests[name].kind===kind&&same(journal.requests[name].body,body),'Original browser request was changed.');
        else journal.requests[name]={kind,body};
        await checkpoint();
        const response=await route.fetch();
        if(kind==='dataset-package'&&!journal.steps.package_reply_loss&&response.ok()){
          const raw=await response.body(),reply=JSON.parse(raw);
          need(reply.id===body.id&&reply.kind===kind,'Original accepted package reply changed.');
          const path=join(root,'package-accepted-response.json');await write(path,raw,{immutable:true});
          journal.steps.package_reply_loss={state:'ORIGINAL_ACCEPTED_REPLY_RETAINED_BEFORE_DISCARD',request_id:body.id,...await record(path)};
          await checkpoint();await route.abort('failed');return;
        }
        await route.fulfill({response});
      }catch(error){journal.route_error=error.message;try{await checkpoint();}finally{await route.abort('failed').catch(()=>{});}}
    });
    await page.goto(host.origin+'/publication#'+host.capability,{waitUntil:'domcontentloaded'});
    await waitFor(async()=>(await page.locator('#workspace-id').textContent()).includes(c.workspace_id),'the original publication workspace');
    await captureBrowser();
    // Reconcile accepted history on reload before starting any new original action.
    for(const entry of [...journal.browser_journal.requests]){
      if(['PENDING','UNKNOWN','RUNNING'].includes(entry.state)){
        let existing;try{existing=entry.kind==='recipe'?await api('/api/publication/recipes/'+entry.id):await api('/api/jobs/'+entry.id);}
        catch(error){if(error.code!=='ANALYSIS_JOB_NOT_FOUND'&&error.status!==404&&!String(error.code).includes('RECIPE_NOT_FOUND'))throw error;}
        if(existing){if(entry.kind!=='recipe'&&existing.status==='RUNNING')await waitLocal(entry);await readEntry(entry);}
      }
    }
    let packageView;
    if(phase==='prepare'){
      const exportCard=page.locator('#export-list article').filter({hasText:c.query_export_id});
      need(await exportCard.count()===1,'The selected original completed export is not listed.');
      await exportCard.getByRole('button',{name:'Open',exact:true}).click();
      await page.locator('#source-review').waitFor({state:'visible'});
      need((await page.locator('#source-facts').textContent()).includes(c.export_manifest_sha256),'Original export manifest changed.');
      let recipe=journal.requests.recipe;
      if(!recipe){
        await page.locator('#recipe-name').fill('RetainedDocumentEvents');
        await page.locator('#package-name').fill('retained-document-events');
        await page.locator('#resource-name').fill('document_events');
        await page.locator('#package-title').fill('Retained document events');
        await page.locator('#package-description').fill('Selected columns from the original completed Analysis query export.');
        await page.locator('#source-rights').fill('Private receiving demonstration using the existing retained Analysis source. No new public redistribution license is asserted.');
        await page.locator('#primary-key').fill('event_index');
        for(const [name,representation] of [['event_index','integer'],['domain','text'],['title','text'],['bot','boolean01']]){
          const row=page.locator('#field-editor .field-row').filter({has:page.getByRole('checkbox',{name:'Publish '+name,exact:true})});
          await row.getByRole('checkbox').check();await row.locator('select').selectOption(representation);
        }
        currentAction='recipe';
        try{await page.locator('#save-recipe').click();await waitFor(()=>journal.requests.recipe,'the original recipe request');}
        finally{currentAction=null;}
        recipe=journal.requests.recipe;
      }else await continueEntry(recipe);
      const savedRecipe=await waitFor(async()=>{try{return await api('/api/publication/recipes/'+recipe.body.id);}catch(error){if(error.status===404||String(error.code).includes('RECIPE_NOT_FOUND'))return false;throw error;}},'the saved original recipe');
      need(same(savedRecipe.recipe,recipe.body.recipe)&&savedRecipe.recipe.manifest_sha256===c.export_manifest_sha256,'The retained recipe changed.');
      await readEntry(recipe);
      let entry=journal.requests.package;
      if(!entry){
        await waitFor(async()=>!await page.locator('#build-package').isDisabled(),'the reviewed package control');
        currentAction='package';try{await page.locator('#build-package').click();await waitFor(()=>journal.requests.package,'the original package request');}finally{currentAction=null;}
        entry=journal.requests.package;
      }else{
        let job;try{job=await api('/api/jobs/'+entry.body.id);}catch(error){if(error.code!=='ANALYSIS_JOB_NOT_FOUND'&&error.status!==404)throw error;}
        if(!job||['INTERRUPTED','FAILED','CANCELLED'].includes(job.status))await continueEntry(entry);
      }
      const completed=await waitLocal(entry);need(completed.status==='COMPLETE','The original package did not complete.');
      await readEntry(entry);packageView=await api('/api/publication/jobs/'+entry.body.id+'/package');
      need(packageView.index.source.query_export_id===c.query_export_id&&packageView.index.source.row_count===c.expected_rows&&
        packageView.index.source.manifest_sha256===c.export_manifest_sha256&&packageView.native_projection_conflicts.length===0,
        'The prepared full export or selected representation changed.');
      journal.steps.recipe={id:savedRecipe.id,recipe_sha256:savedRecipe.recipe_sha256,revision:savedRecipe.revision};
      journal.steps.package={id:entry.body.id,index_sha256:packageView.index.index_sha256};
      await checkpoint();
    }else packageView=await openPackage(c.package_id);

    if(phase==='publish'){
      await page.locator('#connection').selectOption('receiving');
      await performSource('open','open',async()=>({}));
      const version=async()=>{const value=await sourceRead('status');need(Number.isSafeInteger(value.native?.version),'Native workbench version is missing.');return value.native.version;};
      const captured=await workbenchOperation(await performSource('intake','intake',async()=>({expectedVersion:await version(),label:'Original retained Analysis Data Package'})));
      const captureId=captured.result.captureId;need(typeof captureId==='string','Native capture identity is absent.');
      const edition=await workbenchOperation(await performSource('edition','edition',async()=>({expectedVersion:await version(),captureId,label:'Selected document event fields'})));
      const editionId=edition.result.editionId,sourceHash=edition.result.sourceHash;need(SHA.test(sourceHash),'Native source hash is absent.');
      const review=await workbenchOperation(await performSource('review-edition','review-edition',async()=>({
        expectedVersion:await version(),editionId,reviewer:'Native receiving operator',note:'Reviewed the exact retained package, explicit field representations, complete row count and original source binding.'})));
      const reviewId=review.result.reviewId;need(review.result.ready===true,'The original source review has unresolved issues.');
      const current=await sourceRead('current');
      await workbenchOperation(await performSource('select','select',async()=>({expectedVersion:await version(),editionId,reviewId,expectedSourceHash:current.sourceHash})));
      const planInput=await sourceRead('plan-input',{editionId,query:'PublishedData'});
      need(planInput.plan.sourceHash===sourceHash,'Original plan input changed.');
      const planned=await workbenchOperation(await performSource('plan','plan',async()=>({expectedVersion:await version(),editionId,reviewId,plan:planInput.plan})));
      const planRequestId=planned.id;
      const extraction=await performSource('extract','publisher-extract',async()=>({planRequestId}));
      const runId=extraction.result.run.id;need(runId===extraction.job.request.native_request_id,'Original extraction request identity changed.');
      let inspected=await waitFor(async()=>{
        const value=await sourceRead('publisher-inspect',{planRequestId,runId});
        need(value.run.id===runId,'The original publisher run changed.');
        if(['FAILED','CANCELLED','INTERRUPTED'].includes(value.run.state)){
          if(value.run.data.candidate){
            const recovered=await performSource('recover-extraction-'+runId,'publisher-recover',async()=>({planRequestId,runId}),{recover:true});
            need(recovered.result.id===runId&&recovered.result.data.candidate,'Original completed candidate recovery changed.');
            return await sourceRead('publisher-inspect',{planRequestId,runId});
          }
          throw new Error('Original extraction requires review before another native action: '+runId+' '+value.run.state);
        }
        return value.run.data.candidate?value:false;
      },'the actual retained publisher candidate',300000);
      need(inspected.run.data.candidate.dataset.rowCount===c.expected_rows,'The native extracted row count changed.');
      const candidateDigest=inspected.run.data.candidate.candidateDigest;
      const reviewed=await performSource('publisher-review','publisher-review',async()=>({
        planRequestId,runId,candidateDigest,reviewer:'Native receiving operator',
        note:'Reviewed the native extracted candidate, exact source hash, full three-row result and empty original target.',
        initialize:true}));
      const publisherReviewId=reviewed.result.data.review.id;
      need(reviewed.result.id===runId&&reviewed.result.data.review.candidateDigest===candidateDigest,'Original candidate review changed.');
      await merchant.armPublisherLoss(runId,publisherReviewId);
      const published=await performSource('publish','publisher-publish',async()=>({planRequestId,runId,reviewId:publisherReviewId}),{recover:true});
      need(published.result.id===runId&&published.result.state==='PUBLISHED'&&
        published.result.data.review.id===publisherReviewId,'The original publisher receipt is not complete.');
      const loss=await merchant.publicationLoss();
      if(loss)journal.steps.publisher_reply_loss=loss;
      else journal.steps.publisher_reply_loss={state:'ORIGINAL_PUBLISHED_RUN_REOPENED_WITHOUT_A_DISCARD_RECEIPT',run_id:runId,review_id:publisherReviewId};
      const target=await sourceRead('publisher-target');
      const targetRead=target.connected&&target.versions?{observation:target,versions:target.versions}:await merchant.targetSnapshot();
      need(targetRead.versions.current===published.result.data.publication.snapshot&&
        targetRead.versions.versions.some(v=>v.snapshot===published.result.data.publication.snapshot&&v.csvHash===inspected.run.data.candidate.csvHash),
        'The actual original target differs from the published candidate.');
      journal.steps.target={snapshot:targetRead.versions.current,revision:targetRead.versions.revision,
        original_observation:target,verified_versions:targetRead.versions,publication:published.result.data.publication};
      const exported=await workbenchOperation(await performSource('export','export',async()=>({
        expectedVersion:await version(),editionId,reviewId,label:'Complete original retained source handover'})));
      const exportRequestId=exported.id;need(exported.result.sourceHash===sourceHash,'Original source export hash changed.');
      const downloaded=await performSource('download','download-export',async()=>({requestId:exportRequestId,expected_source_hash:sourceHash}));
      const sourceIndex=downloaded.job.result.source_files;need(sourceIndex.job_id===downloaded.job.id,'Native source download identity changed.');
      const sourceFiles={};for(const item of sourceIndex.files)sourceFiles[item.name]=await download(sourceIndex,item,true);
      journal.steps.source={capture_id:captureId,edition_id:editionId,review_id:reviewId,source_sha256:sourceHash,
        plan_request_id:planRequestId,plan_id:planned.result.planId,plan_digest:planned.result.planDigest,
        run_id:runId,candidate_digest:candidateDigest,publisher_review_id:publisherReviewId,
        publication_job_id:published.job.id,export_request_id:exportRequestId,download_job_id:downloaded.job.id,
        index_sha256:sourceIndex.index_sha256,files:sourceFiles,publication:published.result.data.publication};
      await checkpoint();
    }else if(phase==='restore'){
      const saved=await api('/api/jobs/'+c.source_download_job_id);
      need(saved.status==='COMPLETE'&&saved.kind==='dataset-source'&&saved.result.source_files.index_sha256===c.source_index_sha256,
        'Restored original source download record changed.');
      const card=page.locator('#source-history article').filter({hasText:c.source_download_job_id});
      need(await card.count()===1,'Restored native source history is not listed.');
      await card.getByRole('button',{name:'Open',exact:true}).click();
      const expected=saved.result.source_files;
      // Source-local restore has no merchant configuration. The original exact
      // files stay available through the native authenticated file route.
      const sourceFiles={};
      for(const item of expected.files){
        sourceFiles[item.name]=await captureFile('files','source-'+item.name,join(output,'restore-source-'+item.name.replaceAll('/','__')),async pending=>{
          const response=await fetch(host.origin+'/api/publication/source-jobs/'+saved.id+'/file?name='+encodeURIComponent(item.name)+'&sha256='+item.sha256,
            {headers:{'X-Analysis-Capability':host.capability},redirect:'error',signal:AbortSignal.timeout(30000)});
          need(response.ok&&response.headers.get('x-content-sha256')===item.sha256,'Restored original download failed.');
          const raw=Buffer.from(await response.arrayBuffer());need(raw.length===item.bytes&&digest(raw)===item.sha256,'Restored source bytes changed.');
          await write(pending,raw);
        });
      }
      journal.steps.source_local_files=sourceFiles;await checkpoint();await openPackage(c.package_id);
    }
    const files={};for(const item of packageView.index.files)files[item.name]=await download(packageView.index,item,false);
    const screenshots={desktop:await screenshot('desktop',1440),mobile:await screenshot('mobile',390)};
    await captureBrowser();need(browserErrors.length===0,'Unhandled browser errors: '+browserErrors.join('; '));
    if(journal.route_error)throw new Error('Original request capture failed: '+journal.route_error);
    let mcp=null;
    if(phase!=='prepare'){
      await context.close();context=null;
      mcp=await runAnalysisPublicationMcpJourney({directory:root,checkout:c.checkout,analysisDirectory:c.analysis_directory,
        operationId:c.operation_id,phase,workspaceId:c.workspace_id,packageId:c.package_id,
        packageIndexSha256:packageView.index.index_sha256,
        sourceJobId:phase==='publish'?journal.steps.source.download_job_id:c.source_download_job_id,
        sourceIndexSha256:phase==='publish'?journal.steps.source.index_sha256:c.source_index_sha256,
        packageRequest:phase==='publish'?c.package_request:c.package_request,
        sourceRequest:phase==='publish'?journal.requests.download.body:c.source_download_request,
        originalPackage:files['publication.zip']});
      journal.steps.mcp=mcp;await checkpoint();
    }
    const result={schema:SCHEMA,phase,status:'COMPLETE',operation_id:c.operation_id,workspace_id:c.workspace_id,
      configuration_sha256:configurationSha,query_export_id:c.query_export_id,export_manifest_sha256:c.export_manifest_sha256,
      package_id:packageView.index.job_id,package_index_sha256:packageView.index.index_sha256,
      package_view:packageView,files,screenshots,steps:journal.steps,requests:journal.requests,
      browser_journal:journal.browser_journal,browser_errors:browserErrors,completed_at:new Date().toISOString()};
    await verifyArtifacts(result,root);await write(resultPath,json(result),{immutable:true});
    journal.completed_at=result.completed_at;delete journal.interruption;await checkpoint();
    console.log(JSON.stringify({status:'COMPLETE',phase,result:resultPath,...await record(resultPath)}));
  }catch(error){
    primaryError=error;await writes.catch(()=>{});journal.interruption={at:new Date().toISOString(),message:error.message};
    try{await write(journalPath,json(journal));}catch{}
    throw error;
  }finally{
    const failures=[];
    try{await writes;}catch(error){failures.push(error);}
    try{if(context)await context.close();}catch(error){failures.push(error);}
    try{if(host?.child)await stopChild(host.child);}catch(error){failures.push(error);}
    try{if(merchant)await merchant.close();}catch(error){failures.push(error);}
    if(childOutput)try{await new Promise(resolve=>childOutput.end(resolve));}catch(error){failures.push(error);}
    if(privateRuntime)try{await fs.rm(privateRuntime,{recursive:true});}catch(error){failures.push(error);}
    if(!primaryError&&failures.length)throw failures[0];
  }
}
await main(process.argv.slice(2));
