#!/usr/bin/env node
// MIT. The original PostGIS customer's complete GeoServer receiving continuation.
import { resolve, dirname, join, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { Writable } from 'node:stream';
import { setTimeout as pause } from 'node:timers/promises';
import { createHash } from 'node:crypto';
import { acquireStateLease } from '../../../../merchant-fleet-gateway/state-lease.mjs';
import { identity, atomicJson } from '../../../postgres/publisher/files.mjs';
import { claimDirectory, member, readJSON, writeJSONOnce, writeOnce, fileRecord, syncDirectory } from '../files.mjs';
import { durableDirectory } from '../../../wfs/source.mjs';
import { readGeoServerConfiguration } from './adapter.mjs';
import { startGeoServerConsole } from './server.mjs';
import { runGeoServerCli } from './cli.mjs';
import { inspectGeoServerReceiving } from './handover.mjs';
import { verifyFile, retainCopy, walkFiles } from './journal.mjs';
import { need, keys, text, absolute, operationId, hash, nativeBytes, parseExactJSON } from './contract.mjs';

const INPUT='starforge.geoserver-native-handoff.v1';
const RESULT='starforge.geoserver-native-result.v1';
const PHASE='starforge.geoserver-native-phase.v1';
const COMPLETED=new Set(['PUBLISHED','RECEIVED','EXPORTED','ROLLED_BACK']);
const receivedStates=new Set(['RECEIVED','EXPORTED']);
function separate(left,right) {
  need(left!==right&&!left.startsWith(right+'/')&&!right.startsWith(left+'/'),
    'GEOSERVER_NATIVE_SEPARATE_DIRECTORIES');
}
function validate(input) {
  keys(input,['schema','operationId','parentOperationId','sourceHead','directory','workspaceDirectory',
    'profileFile','readerFile','expectedProfileSha256','expectedReaderSha256','request','cycle','browser'],'native handoff');
  need(input.schema===INPUT,'GEOSERVER_NATIVE_HANDOFF_REQUIRED');
  operationId(input.operationId);text(input.parentOperationId,'original parent operation',512);
  need(/^[a-f0-9]{40}$/.test(input.sourceHead??''),'GEOSERVER_NATIVE_SOURCE_HEAD');
  for(const name of ['directory','workspaceDirectory','profileFile','readerFile'])absolute(input[name]);
  separate(input.directory,input.workspaceDirectory);
  for(const name of ['profileFile','readerFile'])separate(input.directory,input[name]);
  hash(input.expectedProfileSha256);hash(input.expectedReaderSha256);
  const request=input.request;
  keys(request,['operationId','kind','receivingDirectory','manifestSha256','expectedPublication','layers'],'original publication request');
  operationId(request.operationId);absolute(request.receivingDirectory);hash(request.manifestSha256);
  separate(input.directory,request.receivingDirectory);separate(input.workspaceDirectory,request.receivingDirectory);
  need(['publish','refresh'].includes(request.kind),'GEOSERVER_NATIVE_PUBLICATION_KIND');
  need(Object.hasOwn(request,'expectedPublication'),'GEOSERVER_NATIVE_EXPECTED_PUBLICATION_REQUIRED');
  if(request.expectedPublication!==null)operationId(request.expectedPublication);
  need(Array.isArray(request.layers)&&request.layers.length>0,'GEOSERVER_NATIVE_LAYERS_REQUIRED');
  const ids=[request.operationId];
  if(input.cycle!==undefined) {
    keys(input.cycle,['rollbackOperationId','refreshOperationId'],'original service cycle');
    ids.push(operationId(input.cycle.rollbackOperationId),operationId(input.cycle.refreshOperationId));
  }
  need(new Set(ids).size===ids.length,'GEOSERVER_NATIVE_DISTINCT_OPERATION_IDS');
  if(input.browser!==undefined) {
    keys(input.browser,['playwrightModule','chromiumExecutable'],'equipped browser');
    text(input.browser.playwrightModule,'original Playwright module',4096);
    absolute(input.browser.chromiumExecutable);
    if(input.browser.playwrightModule.startsWith('file:')) {
      const url=new URL(input.browser.playwrightModule);
      need(url.protocol==='file:'&&!url.host&&!url.search&&!url.hash,'GEOSERVER_NATIVE_BROWSER_MODULE');
      absolute(fileURLToPath(url));
    } else absolute(input.browser.playwrightModule);
  }
  return input;
}
function statusOf(observed,id) {
  need(observed?.state?.id===id&&observed.request?.operationId===id&&observed.review?.operationId===id,
    'GEOSERVER_NATIVE_ORIGINAL_OPERATION_CHANGED');
  hash(observed.state.requestSha256);hash(observed.state.reviewSha256);
  need(identity(observed.request)===observed.state.requestSha256&&
    identity(observed.review)===observed.state.reviewSha256,'GEOSERVER_NATIVE_REVIEW_CHANGED');
  return observed.state;
}
function failureView(error) {
  return {code:error?.code??error?.name??'GEOSERVER_NATIVE_FAILED',message:String(error?.message??error)};
}
async function optional(path,signal) {
  try{return await readJSON(path,{signal});}catch(error){if(error.code==='ENOENT')return null;throw error;}
}

/**
 * Invoke from the original database journey after its accepted receipt is current.
 * All service writes use the original publisher behind one loopback console.
 */
export async function runGeoServerNativeReceiving(input,{environment=process.env,signal:parentSignal,
  progress=()=>{},processSignals=false,stdout=process.stdout,stderr=process.stderr}={}) {
  input=parseExactJSON(new TextDecoder('utf-8',{fatal:true}).decode(nativeBytes(validate(input))));
  const lifetime=new AbortController(),signal=lifetime.signal,requestSha256=identity(input);
  const owners={server:null,browser:null},draining=new Map(),recovery=new Set();
  let lease=null,root=null,primary=null,closeIssue=null,signalNumber=0,candidate=null,result=null;
  let configuration=null;
  const emit=async value=>{await progress({operationId:input.operationId,...value});};
  const stop=reason=>{
    if(!signal.aborted)lifetime.abort(reason??new Error('GeoServer native receiving cancelled.'));
    // Closing the same browser interrupts an outstanding navigation/download.
    if(owners.browser)void drain('browser');
  };
  const onInt=()=>{signalNumber||=2;stop(Object.assign(new Error('GeoServer native receiving interrupted.'),{code:'GEOSERVER_CANCELLED'}));};
  const onTerm=()=>{signalNumber||=15;stop(Object.assign(new Error('GeoServer native receiving terminated.'),{code:'GEOSERVER_CANCELLED'}));};
  const onParent=()=>stop(parentSignal.reason);
  const onOutput=error=>{primary??=error;stop(error);};
  if(processSignals){process.on('SIGINT',onInt);process.on('SIGTERM',onTerm);}
  parentSignal?.addEventListener('abort',onParent,{once:true});
  if(parentSignal?.aborted)onParent();
  stdout.on('error',onOutput);if(stderr!==stdout)stderr.on('error',onOutput);
  async function drain(name) {
    const owner=owners[name];if(!owner)return;
    if(draining.has(owner))return draining.get(owner);
    const task=(async()=>{
      for(;;) {
        try{await owner.close();if(owners[name]===owner)owners[name]=null;return;}
        catch(error){closeIssue??=error;await pause(250);}
      }
    })();
    draining.set(owner,task);await task;draining.delete(owner);
  }
  async function drainRecovery() {
    for(const close of recovery) {
      for(;;){try{await close();break;}catch(error){closeIssue??=error;await pause(250);}}
      recovery.delete(close);
    }
  }
  function assertHeld(){need(lease,'GEOSERVER_NATIVE_OUTPUT_OWNER');lease.assertHeld();signal.throwIfAborted();}
  async function retain(path,value) {
    assertHeld();const target=member(root,path);
    await writeJSONOnce(target,value);
    // Complete publication even when a previous create returned before parent sync.
    await syncDirectory(dirname(target));
    return fileRecord(target,path,{signal});
  }
  async function phase(name,work,verify) {
    assertHeld();const path=member(root,'phases/'+name+'.json');
    let stored=await optional(path,signal);
    if(stored) {
      need(stored.schema===PHASE&&stored.operationId===input.operationId&&stored.phase===name&&
        stored.requestSha256===requestSha256,'GEOSERVER_NATIVE_PHASE_CHANGED');
      if(verify)await verify(stored.result);
      await emit({phase:name,state:'retained'});return stored.result;
    }
    await emit({phase:name,state:'running'});
    const value=await work();assertHeld();
    stored={schema:PHASE,operationId:input.operationId,phase:name,requestSha256,result:value};
    await retain('phases/'+name+'.json',stored);
    await emit({phase:name,state:'complete'});return value;
  }
  function host() {
    return {directory:input.workspaceDirectory,profileFile:input.profileFile,readerFile:input.readerFile,
      expectedProfileSha256:input.expectedProfileSha256,expectedReaderSha256:input.expectedReaderSha256,
      environment,signal};
  }
  async function openConsole() {
    assertHeld();need(!owners.server,'GEOSERVER_NATIVE_ORIGINAL_WRITER_RUNNING');
    try{owners.server=await startGeoServerConsole({...host(),port:0});}
    catch(error){if(typeof error.close==='function')recovery.add(error.close);throw error;}
    const server=owners.server;
    void server.finished.catch(error=>{primary??=error;stop(error);});
    need(server.workspace===input.workspaceDirectory,'GEOSERVER_NATIVE_WORKSPACE_CHANGED');
    const observed={schema:server.schema,workspace:server.workspace,instanceId:server.instanceId,
      origin:server.origin,profile:server.profile};
    await retain('opens/'+server.instanceId+'.json',observed);
    return observed;
  }
  async function cli(argv,{attached=true,profileFile=input.profileFile,readerFile=input.readerFile,
    workspace=input.workspaceDirectory}={}) {
    assertHeld();
    const chunks=[];let size=0;
    const sink=new Writable({write(chunk,encoding,callback) {
      size+=chunk.length;
      if(size>128*1024*1024){callback(new Error('Native CLI result exceeds its receiving allowance.'));return;}
      chunks.push(Buffer.from(chunk));callback();
    }});
    let returned,issue;
    try {
      const options=attached?['--connection',owners.server.connectionFile]:
        ['--workspace',workspace,'--profile',profileFile,'--reader',readerFile,
          '--profile-sha256',input.expectedProfileSha256,'--reader-sha256',input.expectedReaderSha256];
      returned=await runGeoServerCli([...argv,...options],{environment,signal,processSignals:false,
        stdout:sink,stderr:sink});
      const raw=Buffer.concat(chunks);
      need(raw.length>0,'GEOSERVER_NATIVE_CLI_RESULT_REQUIRED');
      const observed=parseExactJSON(new TextDecoder('utf-8',{fatal:true}).decode(raw));
      need(returned.exitCode===0,'GEOSERVER_NATIVE_CLI_EXIT');
      return observed;
    }catch(error){issue=error;throw error;}
    finally{
      sink.destroy();
      if(issue&&typeof issue.close==='function')recovery.add(issue.close);
    }
  }
  async function standalone(argv) {
    assertHeld();const chunks=[],sink=new Writable({write(chunk,encoding,callback){chunks.push(Buffer.from(chunk));callback();}});
    try{
      const observed=await runGeoServerCli(argv,{environment,signal,processSignals:false,stdout:sink,stderr:sink});
      need(observed.exitCode===0,'GEOSERVER_NATIVE_CLI_EXIT');
      return parseExactJSON(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
    }finally{sink.destroy();}
  }
  async function verifyExport(retained) {
    assertHeld();need(retained?.directory===member(root,'exports/'+retained.name)&&
      retained.archive?.path===member(root,'archives/'+retained.name+'.zip'),'GEOSERVER_NATIVE_EXPORT_PATH_CHANGED');
    const inspected=await inspectGeoServerReceiving(retained.directory,{expectedManifestSha256:retained.manifestSha256,signal});
    need(inspected.operation.id===retained.operationId&&inspected.manifest.postgisManifestSha256===input.request.manifestSha256,
      'GEOSERVER_NATIVE_EXPORT_ORIGINAL_CHANGED');
    const archive=await verifyFile(retained.archive.path,{maximum:retained.archive.bytes,signal});
    need(archive.bytes===retained.archive.bytes&&archive.sha256===retained.archive.sha256,
      'GEOSERVER_NATIVE_ARCHIVE_CHANGED');
    return inspected;
  }
  async function publication(name,request,{rollback=false}={}) {
    return phase(name,async()=>{
      const requestPath='requests/'+name+'.json';await retain(requestPath,request);
      let selected=await cli([rollback?'rollback-prepare':'prepare','--request',member(root,requestPath)]);
      let state=statusOf(selected,request.operationId);
      await retain('reviews/'+name+'.json',{operationId:state.id,requestSha256:state.requestSha256,
        reviewSha256:state.reviewSha256,review:selected.review});
      if(!COMPLETED.has(state.state)) {
        if(state.state!=='PREPARED') {
          selected=await cli(['reconcile','--operation',state.id]);state=statusOf(selected,state.id);
          need(!(state.reconciliation?.conflicts?.length),'GEOSERVER_NATIVE_RECONCILIATION_CONFLICT');
        }
        selected=await cli(['apply','--operation',state.id,'--review-sha256',state.reviewSha256]);
        state=statusOf(selected,state.id);
      }
      need(rollback?state.state==='ROLLED_BACK':COMPLETED.has(state.state)&&state.state!=='ROLLED_BACK',
        'GEOSERVER_NATIVE_PUBLICATION_INCOMPLETE');
      if(!rollback&&!receivedStates.has(state.state)) {
        selected=await cli(['receive','--operation',state.id]);state=statusOf(selected,state.id);
      }
      need(rollback||state.receiving?.operationId===state.id,'GEOSERVER_NATIVE_RECEIVING_REQUIRED');
      const directory=member(root,'exports/'+name),archiveFile=member(root,'archives/'+name+'.zip');
      await durableDirectory(dirname(archiveFile));
      selected=await cli(['export','--operation',state.id,'--out',directory,'--archive',archiveFile]);
      state=statusOf(selected,state.id);
      const exported=state.exports?.find(entry=>entry.directory===directory);
      need(exported?.archive?.path===archiveFile,'GEOSERVER_NATIVE_EXPORTED_ORIGINAL_REQUIRED');
      const summary={name,operationId:state.id,requestSha256:state.requestSha256,
        reviewSha256:state.reviewSha256,state:state.state,directory,manifestSha256:exported.manifestSha256,
        archive:exported.archive,ownedSteps:state.steps.filter(step=>['APPLIED','CREATED'].includes(step.state)).map(step=>step.id)};
      const full=await verifyExport(summary);
      const operationFile=await retain('operations/'+name+'.json',selected);
      return {...summary,operationFile,projectId:full.manifest.projectId,postgis:full.postgis,native:full.native};
    },verifyExport);
  }
  async function browserReceiving(final) {
    if(!input.browser)return null;
    return phase('browser',async()=>{
      const module=input.browser.playwrightModule.startsWith('file:')?input.browser.playwrightModule:
        pathToFileURL(input.browser.playwrightModule).href;
      const playwright=await import(module);signal.throwIfAborted();
      owners.browser=await playwright.chromium.launch({headless:true,executablePath:input.browser.chromiumExecutable,
        args:['--disable-dev-shm-usage']});
      if(signal.aborted)stop(signal.reason);
      const browser=owners.browser;
      try {
        const page=await browser.newPage({viewport:{width:1440,height:1000},acceptDownloads:true}),errors=[];
        page.setDefaultTimeout(120000);page.setDefaultNavigationTimeout(300000);
        page.on('pageerror',error=>errors.push(error.message));
        await page.goto(owners.server.url,{waitUntil:'networkidle'});
        await page.waitForFunction(id=>[...document.querySelectorAll('#operations > button')]
          .some(button=>button.firstChild?.textContent===id),final.operationId);
        const operationIndex=await page.locator('#operations > button').evaluateAll((buttons,id)=>
          buttons.findIndex(button=>button.firstChild?.textContent===id),final.operationId);
        need(operationIndex>=0,'GEOSERVER_NATIVE_BROWSER_OPERATION_CHANGED');
        await page.locator('#operations > button').nth(operationIndex).click();
        await page.locator('#operation-state').filter({hasText:final.state}).waitFor();
        const review=page.locator('#review details').filter({has:page.locator('summary').filter({hasText:'Complete retained native review'})});
        await review.locator('summary').click();
        need((await review.innerText()).includes(final.reviewSha256)||
          (await review.innerText()).includes(final.operationId),'GEOSERVER_NATIVE_BROWSER_REVIEW_CHANGED');
        const history=page.locator('#review details').filter({has:page.locator('summary').filter({hasText:'Operation history and observed effects'})});
        await history.locator('summary').click();
        need((await history.innerText()).includes(final.state),'GEOSERVER_NATIVE_BROWSER_HISTORY_CHANGED');
        const readerDetails=page.locator('#receiving details.native-reader');
        for(let i=0;i<await readerDetails.count();i++)await readerDetails.nth(i).locator('summary').first().click();
        const maps=page.getByRole('button',{name:'View native WMS image',exact:true});
        const mapCount=await maps.count(),expectedMaps=final.native.filter(layer=>layer.mapSha256).length;
        need(mapCount===expectedMaps,'GEOSERVER_NATIVE_BROWSER_MAP_COVERAGE');
        for(let i=0;i<mapCount;i++) {
          await maps.first().click();
          await page.waitForFunction(expected=>document.querySelectorAll('#receiving img').length===expected,i+1);
        }
        if(mapCount)await page.waitForFunction(expected=>{
          const images=[...document.querySelectorAll('#receiving img')];
          return images.length===expected&&images.every(image=>image.complete&&image.naturalWidth>0&&image.naturalHeight>0);
        },mapCount);
        const image=member(root,'browser/operator.png');
        if(!await optional(member(root,'browser/image.json'),signal)) {
          const prior=await verifyFile(image,{maximum:128*1024*1024,signal}).catch(error=>{
            if(error.code==='ENOENT')return null;throw error;
          });
          if(!prior) {
            const bytes=await page.screenshot({fullPage:true});
            assertHeld();await writeOnce(image,bytes);await syncDirectory(dirname(image));
          }
          const imageFile=await fileRecord(image,'browser/operator.png',{signal});
          await retain('browser/image.json',{operationId:final.operationId,reviewSha256:final.reviewSha256,file:imageFile});
        }
        const imageRecord=await readJSON(member(root,'browser/image.json'),{signal});
        need(imageRecord.operationId===final.operationId&&imageRecord.reviewSha256===final.reviewSha256,
          'GEOSERVER_NATIVE_BROWSER_IMAGE_CHANGED');
        const retainedImage=await verifyFile(member(root,imageRecord.file.path),{maximum:imageRecord.file.bytes,signal});
        need(retainedImage.bytes===imageRecord.file.bytes&&retainedImage.sha256===imageRecord.file.sha256,
          'GEOSERVER_NATIVE_BROWSER_IMAGE_CHANGED');
        const target=member(root,'browser/operator.zip');
        let downloaded=await verifyFile(target,{maximum:final.archive.bytes,signal}).catch(error=>{
          if(error.code==='ENOENT')return null;throw error;
        });
        if(!downloaded) {
          const row=page.locator('#exports .export-row').filter({hasText:final.manifestSha256});
          const [download]=await Promise.all([page.waitForEvent('download'),
            row.getByRole('button',{name:'Download ZIP',exact:true}).click()]);
          need(!await download.failure(),'GEOSERVER_NATIVE_BROWSER_DOWNLOAD_FAILED');
          const path=await download.path();need(path,'GEOSERVER_NATIVE_BROWSER_DOWNLOAD_PATH');
          await retainCopy(path,target,final.archive,{signal});
          downloaded=await verifyFile(target,{maximum:final.archive.bytes,signal});
        }
        need(downloaded.bytes===final.archive.bytes&&downloaded.sha256===final.archive.sha256,
          'GEOSERVER_NATIVE_BROWSER_DOWNLOAD_CHANGED');
        need(errors.length===0,'GEOSERVER_NATIVE_BROWSER_ERROR',errors.join('\n'));
        return {browser:await browser.version(),operationId:final.operationId,reviewSha256:final.reviewSha256,
          maps:mapCount,screenshot:imageRecord.file,
          download:{path:'browser/operator.zip',...downloaded}};
      }finally{await drain('browser');}
    },async saved=>{
      need(saved.operationId===final.operationId&&saved.reviewSha256===final.reviewSha256,
        'GEOSERVER_NATIVE_BROWSER_RESULT_CHANGED');
      for(const file of [saved.screenshot,saved.download]) {
        const observed=await verifyFile(member(root,file.path),{maximum:file.bytes,signal});
        need(observed.bytes===file.bytes&&observed.sha256===file.sha256,'GEOSERVER_NATIVE_BROWSER_FILE_CHANGED');
      }
    });
  }
  async function verifyComplete(saved) {
    need(saved?.schema===RESULT&&saved.state==='complete'&&saved.operationId===input.operationId&&
      saved.requestSha256===requestSha256&&saved.parentOperationId===input.parentOperationId&&
      identity(saved.nativeBinding)===identity(configuration.nativeBinding),'GEOSERVER_NATIVE_COMPLETION_CHANGED');
    for(const file of saved.files) {
      const observed=await verifyFile(member(root,file.path),{maximum:file.bytes,signal});
      need(observed.bytes===file.bytes&&observed.sha256===file.sha256,'GEOSERVER_NATIVE_COMPLETED_FILE_CHANGED');
    }
    for(const exported of saved.exports)await verifyExport(exported);
    return saved;
  }
  try {
    signal.throwIfAborted();
    root=await claimDirectory(input.directory,input);
    lease=await acquireStateLease(root);assertHeld();
    configuration=await readGeoServerConfiguration({...host()});
    const saved=await optional(member(root,'geoserver-native-result.json'),signal);
    if(saved)result=await verifyComplete(saved);
    else {
      await retain('configuration.json',{nativeBinding:configuration.nativeBinding,
        profileFile:configuration.profileFile,readerFile:configuration.readerFile,sourceHead:input.sourceHead});
      const initialOpen=await openConsole();
      await phase('source-and-target',async()=>{
        const source=await cli(['source','--directory',input.request.receivingDirectory,
          '--manifest-sha256',input.request.manifestSha256]);
        need(source.manifestSha256===input.request.manifestSha256,'GEOSERVER_NATIVE_RECEIPT_CHANGED');
        return {source,target:await cli(['target'])};
      });
      const original=await publication('publication',input.request);
      const exports=[original];let final=original,cycle=null;
      if(input.cycle) {
        if(original.ownedSteps.length) {
          const rollback={operationId:input.cycle.rollbackOperationId,publicationId:original.operationId,
            receivingDirectory:input.request.receivingDirectory,manifestSha256:input.request.manifestSha256,
            expectedPublication:original.operationId};
          cycle=await publication('rollback',rollback,{rollback:true});exports.push(cycle);
        }else cycle={state:'NO_OWNED_CHANGES',operationId:input.cycle.rollbackOperationId,ownedSteps:[]};
        const refresh={...input.request,operationId:input.cycle.refreshOperationId,kind:'refresh',
          expectedPublication:cycle.state==='ROLLED_BACK'?cycle.operationId:original.operationId};
        final=await publication('refresh',refresh);exports.push(final);
      }
      const publicationHead=await cli(['inspect']);
      need(publicationHead.publication?.operationId===final.operationId&&
        publicationHead.publication.manifestSha256===input.request.manifestSha256,
        'GEOSERVER_NATIVE_CURRENT_PUBLICATION_CHANGED');
      const reopen=await phase('close-and-reopen',async()=>{
        const before=await cli(['inspect','--operation',final.operationId]);
        statusOf(before,final.operationId);
        await drain('server');signal.throwIfAborted();
        const afterOpen=await openConsole(),after=await cli(['inspect','--operation',final.operationId]);
        const current=statusOf(after,final.operationId);
        need(afterOpen.instanceId!==initialOpen.instanceId&&afterOpen.workspace===initialOpen.workspace&&
          current.requestSha256===final.requestSha256&&current.reviewSha256===final.reviewSha256&&
          current.state===final.state,'GEOSERVER_NATIVE_REOPEN_CHANGED');
        await retain('reopened-operation.json',after);
        return {originalInstance:initialOpen.instanceId,reopenedInstance:afterOpen.instanceId,
          workspace:afterOpen.workspace,operationId:final.operationId,state:current.state,
          requestSha256:current.requestSha256,reviewSha256:current.reviewSha256};
      });
      const browser=await browserReceiving(final);
      await drain('server');signal.throwIfAborted();
      const adoptions=[];
      for(const exported of exports)adoptions.push(await phase('adopt-'+exported.name,async()=>{
        await verifyExport(exported);
        const directory=member(root,'adopted/'+exported.name);
        const adopted=await standalone(['adopt','--directory',exported.directory,'--out',directory,
          '--manifest-sha256',exported.manifestSha256]);
        need(adopted.directory===directory&&adopted.manifestSha256===exported.manifestSha256&&
          adopted.operation.id===exported.operationId,'GEOSERVER_NATIVE_ADOPTION_CHANGED');
        const observed=await cli(['inspect','--operation',exported.operationId],
          {attached:false,workspace:directory,profileFile:adopted.profileFile,readerFile:adopted.readerFile});
        const state=statusOf(observed,exported.operationId);
        need(state.requestSha256===exported.requestSha256&&state.reviewSha256===exported.reviewSha256,
          'GEOSERVER_NATIVE_ADOPTED_ORIGINAL_CHANGED');
        await retain('adoptions/'+exported.name+'.json',observed);
        return {directory,operationId:state.id,requestSha256:state.requestSha256,
          reviewSha256:state.reviewSha256,manifestSha256:adopted.manifestSha256};
      },async saved=>{
        await verifyExport(exported);
        const directory=member(root,'adopted/'+exported.name);
        need(saved.directory===directory&&saved.operationId===exported.operationId&&
          saved.manifestSha256===exported.manifestSha256,'GEOSERVER_NATIVE_ADOPTION_CHANGED');
        const adopted=await standalone(['adopt','--directory',exported.directory,'--out',directory,
          '--manifest-sha256',exported.manifestSha256]);
        const current=await cli(['inspect','--operation',exported.operationId],
          {attached:false,workspace:directory,profileFile:adopted.profileFile,readerFile:adopted.readerFile});
        const state=statusOf(current,exported.operationId);
        need(state.requestSha256===saved.requestSha256&&state.reviewSha256===saved.reviewSha256,
          'GEOSERVER_NATIVE_ADOPTED_ORIGINAL_CHANGED');
      }));
      assertHeld();
      const files=await walkFiles(root,{signal,skip:path=>basename(path)==='lease.lock'||
        path==='geoserver-native-result.json'||path==='failure.json'||
        /\.receiving-[a-f0-9]{64}-[a-f0-9-]{36}$/.test(path)});
      candidate={schema:RESULT,state:'complete',operationId:input.operationId,parentOperationId:input.parentOperationId,
        requestSha256,sourceHead:input.sourceHead,nativeBinding:configuration.nativeBinding,
        projectId:final.projectId,postgis:final.postgis,finalPublication:final.operationId,
        exports,reopen,browser,cycle,adoptions,files};
    }
  } catch(error) {
    primary??=error;if(typeof error.close==='function')recovery.add(error.close);
    stop(error);
  } finally {
    await drain('browser');await drain('server');await drainRecovery();
    primary??=signal.aborted?signal.reason:null;primary??=closeIssue;
    try {
      if(!primary&&candidate) {
        assertHeld();await writeJSONOnce(member(root,'geoserver-native-result.json'),candidate);
        await syncDirectory(root);result=candidate;
      }else if(primary&&root&&lease) {
        lease.assertHeld();
        await atomicJson(root,'failure.json',{schema:'starforge.geoserver-native-failure.v1',
          operationId:input.operationId,requestSha256,error:failureView(primary),
          ...(closeIssue?{cleanupError:failureView(closeIssue)}:{})});
      }
    }catch(error){primary??=error;}
    if(lease) {
      // The original Linux descriptor is released once, including a close diagnostic.
      try{await lease.close();}catch(error){primary??=error;}
      lease=null;
    }
    if(processSignals){process.removeListener('SIGINT',onInt);process.removeListener('SIGTERM',onTerm);}
    parentSignal?.removeEventListener('abort',onParent);stdout.removeListener('error',onOutput);
    if(stderr!==stdout)stderr.removeListener('error',onOutput);
  }
  if(primary){if(signalNumber)primary.exitCode=128+signalNumber;throw primary;}
  return result;
}
async function output(stream,value) {
  await new Promise((resolve,reject)=>{
    const error=issue=>{stream.removeListener('error',error);reject(issue);};
    stream.once('error',error);
    try{stream.write(value,issue=>{stream.removeListener('error',error);issue?reject(issue):resolve();});}
    catch(issue){stream.removeListener('error',error);reject(issue);}
  });
}
export async function main(argv=process.argv.slice(2)) {
  try {
    need(argv.length===1,'GEOSERVER_NATIVE_HANDOFF_FILE_REQUIRED');
    const path=absolute(resolve(argv[0])),before=await verifyFile(path,{maximum:2*1024*1024});
    const raw=await readFile(path);
    need(raw.length===before.bytes,'GEOSERVER_NATIVE_HANDOFF_FILE_CHANGED');
    need(createHash('sha256').update(raw).digest('hex')===before.sha256,'GEOSERVER_NATIVE_HANDOFF_FILE_CHANGED');
    const input=parseExactJSON(new TextDecoder('utf-8',{fatal:true}).decode(raw));
    const result=await runGeoServerNativeReceiving(input,{processSignals:true,
      progress:value=>process.stderr.write(nativeBytes(value))});
    await output(process.stdout,nativeBytes(result));return result;
  }catch(error){
    try{await output(process.stderr,nativeBytes({error:failureView(error),exitCode:error.exitCode??2}));}catch{}
    process.exitCode=error.exitCode??2;return {error,exitCode:process.exitCode};
  }
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)await main();
