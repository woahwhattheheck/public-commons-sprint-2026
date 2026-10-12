// MIT. Receive customers through the maintained SHA-pinned downloader and archive encoder.
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createRetainedDownload } from '../retained-download.mjs';
import { identifier } from '../host-files.mjs';
import { CLIENT_EXPORT_MANIFEST, MAX_CLIENT_EXPORT_FILE_BYTES, parseSellerClientManifest } from '../../../stellar/scf-starforge-20261009/sf30-seller-sdk/developer/client-export.mjs';
import { canonical, digest, fail } from './store.mjs';

const validId=value=>typeof value==='string'&&/^[a-z0-9][a-z0-9_-]{0,63}$/.test(value);
const validSha=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const errorView=error=>({code:error.code??'CUSTOMER_RECEIVING_ERROR',message:error.message??String(error)});
export function customerAccess(selection){
  const prefix=selection.family==='grant-reviewer'?'merchant_grant_reviewer':
    selection.family==='core'?'merchant_client_export':selection.family==='opensearch'?'merchant_opensearch_deployment':null;
  if(!prefix)throw fail('CONSOLE_CUSTOMER_SELECTION','Choose an original supported customer family.',400);
  return {name:prefix+'_manifest',args:{exportId:selection.exportId,...(selection.workspace?{workspace:selection.workspace}:{})}};
}
async function customerFamily(selection){
  if(selection.family==='grant-reviewer')return (await import('./customer-reviewer.mjs')).reviewerCustomerFamily;
  return null;
}
export function createConsoleCustomers({operator,store,definitions,releaseStore,getHost,authorize}) {
  const active=new Map(),archiveReaders=new Map(),archiveCalls=new Set(),archiveCloses=new Map(),archiveResponses=new Set();
  let closing=false,closed,closeAttempts=0;
  function closeArchive(id,reader) {
    let entry=archiveCloses.get(id);
    if(entry)return entry.promise;
    entry={state:'CLOSING',promise:null};archiveCloses.set(id,entry);
    entry.promise=reader.then(value=>value.close()).then(()=>{
      entry.state='CLOSED';if(archiveReaders.get(id)===reader)archiveReaders.delete(id);
    },error=>{entry.state='FAILED';throw error;});
    entry.promise.catch(()=>{});return entry.promise;
  }
  function originalArchive(record) {
    let pending=archiveReaders.get(record.id);
    if(!pending){
      pending=(async()=>{
        const {createReleaseClientConsole}=await import('../../../stellar/scf-starforge-20261009/sf82-seller-pilot/release-client.mjs');
        return createReleaseClientConsole(releaseStore,{directory:join(store.directory,'customers',record.id),getManaged:()=>null});
      })();
      archiveReaders.set(record.id,pending);
      pending.catch(()=>{if(archiveReaders.get(record.id)===pending)archiveReaders.delete(record.id);});
    }
    return pending;
  }
  async function identity(input) {
    const family=await customerFamily(input);
    if(family)return family.normalize(input);
    if(!['core','opensearch'].includes(input.family)||!validId(input.exportId)||!validSha(input.expectedManifestSha256))
      throw fail('CONSOLE_CUSTOMER_SELECTION','Select the original family, export ID and manifest SHA-256.',400);
    if(input.family==='opensearch'&&!validId(input.workspace))
      throw fail('CONSOLE_CUSTOMER_WORKSPACE','Select the original OpenSearch workspace alias.',400);
    return {profileId:input.profileId,family:input.family,...(input.family==='opensearch'?{workspace:input.workspace}:{}),
      exportId:input.exportId,expectedManifestSha256:input.expectedManifestSha256,
      hostFingerprint:input.expectedHostFingerprint};
  }
  const directory=value=>join(store.directory,'customers',value.id,value.identity.exportId);
  const toolPrefix=selection=>customerAccess(selection).name.slice(0,-'_manifest'.length);
  const view=value=>({...value,active:active.has(value.id),
    localFiles:value.workspaceId===store.id&&value.state==='COMPLETE'});
  async function transfer(selection,request) {
    const prefix=toolPrefix(selection);
    if(!definitions.has(prefix+'_manifest')||!definitions.has(prefix+'_file'))
      throw fail('CONSOLE_CUSTOMER_UNAVAILABLE','This host does not advertise the original customer reader.',400);
    const family=await customerFamily(selection);
    if(family)return family.createTransfer({operator,authorize},selection,request);
    return createRetainedDownload({
      manifestName:CLIENT_EXPORT_MANIFEST,parseManifest:parseSellerClientManifest,maximumBytes:MAX_CLIENT_EXPORT_FILE_BYTES,
      stateSchema:'stellar-forge.merchant-client-download.v1',resultSchema:'stellar-forge.merchant-client-download-result.v1',
      toolPrefix:prefix,errorPrefix:'CLIENT',clientName:'starforge-merchant-console',
      connect:async()=>({endpoint:'urn:stellar-forge:merchant-host:'+selection.hostFingerprint+':'+selection.family+(selection.workspace?':'+selection.workspace:''),call:async(name,args)=>{
        const values=selection.family==='opensearch'?{workspace:selection.workspace,...args}:args;
        const context=await authorize(request,name,values);
        return operator.call(name,values,context?{authorization:context}:undefined);
      }})
    });
  }
  async function start(input,request) {
    if(closing)throw fail('CONSOLE_CLOSING','The original operator is closing.',503);
    identifier(input.exportId,'Customer export ID');
    const selection=await identity(input),profile=store.profile(selection.profileId),host=getHost();
    if(profile.hostFingerprint!==host.configurationFingerprint||selection.hostFingerprint!==host.configurationFingerprint)
      throw fail('CONSOLE_HOST_CHANGED','Bind this profile to the displayed original host before receiving customer files.');
    const prefix=toolPrefix(selection),args={exportId:selection.exportId,...(selection.workspace?{workspace:selection.workspace}:{})};
    await authorize(request,prefix+'_manifest',args);
    if(closing)throw fail('CONSOLE_CLOSING','The original operator is closing.',503);
    const identitySha256=digest(canonical(selection)),id=identitySha256.slice(0,48);
    let record;
    try { record=store.delivery(id); } catch(error){if(error.code!=='CONSOLE_CUSTOMER_NOT_FOUND')throw error;}
    if(active.has(id))return view(record);
    const driver=await transfer(selection,request),format=await customerFamily(selection)??{manifestName:CLIENT_EXPORT_MANIFEST,parseManifest:parseSellerClientManifest};
    if(closing)throw fail('CONSOLE_CLOSING','The original operator is closing.',503);
    // Loading a family may yield. Rejoin the original owner before reserving its files.
    if(active.has(id))return view(store.delivery(id));
    try{record=store.delivery(id);}catch(error){if(error.code!=='CONSOLE_CUSTOMER_NOT_FOUND')throw error;}
    record=store.saveDelivery({...record,id,profileId:selection.profileId,workspaceId:store.id,identity:selection,identitySha256,
      state:'DOWNLOADING',startedAt:record?.startedAt??new Date().toISOString(),updatedAt:new Date().toISOString(),error:null});
    const controller=new AbortController();
    const task=(async()=>{
      try{
        const parent=join(store.directory,'customers',id);
        await mkdir(parent,{recursive:true,mode:0o700});
        const result=await driver.download({url:'http://127.0.0.1:'+request.socket.localPort,
          exportId:selection.exportId,directory:directory(record),expectedManifestSha256:selection.expectedManifestSha256,
          chunkSize:65536,signal:controller.signal,onProgress:progress=>{
            record=store.saveDelivery({...record,progress,updatedAt:new Date().toISOString()});
          }});
        const bytes=await driver.bytesAt(join(directory(record),format.manifestName),65000);
        if(digest(bytes)!==selection.expectedManifestSha256)throw fail('CONSOLE_CUSTOMER_CHANGED','The received manifest changed.');
        const manifest=format.parseManifest(bytes,selection.exportId);
        const files=[...manifest.files,{name:format.manifestName,bytes:bytes.length,sha256:digest(bytes)}];
        const {directory:privateDirectory,...summary}=result;
        const complete={...record,state:'COMPLETE',completedAt:new Date().toISOString(),updatedAt:new Date().toISOString(),
          files,result:summary,manifest,progress:null,error:null};
        format.validateRecord?.(complete);
        record=store.saveDelivery(complete);
      }catch(error){
        record=store.saveDelivery({...record,state:controller.signal.aborted?'PAUSED':'FAILED',updatedAt:new Date().toISOString(),error:errorView(error)});
      }finally{active.delete(id);}
      return record;
    })();
    active.set(id,{controller,task});task.catch(()=>{});
    return view(record);
  }
  async function requireRead(record,request) {
    const selection=record.identity,prefix=toolPrefix(selection);
    await authorize(request,prefix+'_manifest',{exportId:selection.exportId,...(selection.workspace?{workspace:selection.workspace}:{})});
    if(record.workspaceId!==store.id||record.state!=='COMPLETE')
      throw fail('CONSOLE_CUSTOMER_RECEIVE','Resume the original reviewed customer export to receive its local files.');
  }
  async function readCustomerFile(id,name,request){
    const record=store.delivery(id);await requireRead(record,request);
    const file=record.files.find(value=>value.name===name);
    if(!file)throw fail('CONSOLE_CUSTOMER_FILE','Select a file from the original customer manifest.',404);
    const driver=await transfer(record.identity,request),path=join(directory(record),file.name);
    await driver.verifiedFile(path,file);
    const bytes=await driver.bytesAt(path,file.bytes);
    if(digest(bytes)!==file.sha256)throw fail('CONSOLE_CUSTOMER_CHANGED','The original customer file changed.');
    return {file,bytes};
  }
  async function sendOriginalFile(record,file,request,response){
    const value=await readCustomerFile(record.id,file.name,request);
    if(closing)throw fail('CONSOLE_CLOSING','The original customer owner is closing.',503);
    archiveResponses.add(response);
    try{
      await new Promise((resolve,reject)=>{
        const cleanup=()=>{response.off('finish',finish);response.off('close',finish);response.off('error',error);};
        const finish=()=>{cleanup();resolve();},error=value=>{cleanup();reject(value);};
        response.once('finish',finish);response.once('close',finish);response.once('error',error);
        try{
          response.writeHead(200,{'content-type':file.contentType??'application/octet-stream',
            'content-length':value.bytes.length,'cache-control':'no-store','x-content-type-options':'nosniff',
            'content-disposition':'attachment; filename="'+file.name.replace(/[^A-Za-z0-9_.-]/g,'_')+'"',
            'x-content-sha256':file.sha256});
          response.end(value.bytes);
        }catch(reason){cleanup();reject(reason);}
      });
    }finally{archiveResponses.delete(response);}
  }
  return {
    view,start,
    async files(id,request){const record=store.delivery(id);await requireRead(record,request);return record.files;},
    file:readCustomerFile,
    async archive(id,request,response){
      if(closing)throw fail('CONSOLE_CLOSING','The original customer owner is closing.',503);
      const record=store.delivery(id);await requireRead(record,request);
      if(closing)throw fail('CONSOLE_CLOSING','The original customer owner is closing.',503);
      const family=await customerFamily(record.identity);
      if(closing)throw fail('CONSOLE_CLOSING','The original customer owner is closing.',503);
      if(family){
        const file=family.archiveFile(record);
        if(!file)throw fail('CONSOLE_CUSTOMER_ARCHIVE','Choose a complete original file from this export.',409);
        const task=sendOriginalFile(record,file,request,response);archiveCalls.add(task);
        try{await task;}finally{archiveCalls.delete(task);}
        return;
      }
      const owner=originalArchive(record);
      const task=(async()=>{
        const original=await owner;
        if(closing)throw fail('CONSOLE_CLOSING','The original customer owner is closing.',503);
        await original.sendDownload(request,response,{exportId:record.identity.exportId,
          expectedManifestSha256:record.identity.expectedManifestSha256});
      })();
      archiveCalls.add(task);
      try{await task;}finally{archiveCalls.delete(task);}
    },
    pause(id){const pending=active.get(id);if(pending)pending.controller.abort(fail('CONSOLE_DOWNLOAD_PAUSED','Receiving paused at the original durable checkpoint.'));return view(store.delivery(id));},
    get summary(){return {activeDownloads:active.size,activeArchives:archiveCalls.size,originalArchiveOwners:archiveReaders.size,
      failedArchiveCloses:[...archiveCloses.values()].filter(value=>value.state==='FAILED').length};},
    beginClose(){
      closing=true;
      for(const response of archiveResponses)response.destroy(fail('CONSOLE_CLOSING','The original complete file remains retained; reopen its download.'));
      for(const value of active.values())value.controller.abort(fail('CONSOLE_DOWNLOAD_PAUSED','The host is closing; the original customer checkpoint is retained.'));
      for(const [id,reader] of archiveReaders)closeArchive(id,reader);
    },
    close(){
      if(!closed){
        if(closeAttempts++)for(const [id,entry] of archiveCloses)if(entry.state==='FAILED')archiveCloses.delete(id);
        this.beginClose();
        closed=(async()=>{
          await Promise.allSettled([...active.values()].map(value=>value.task).concat([...archiveCalls]));
          const results=await Promise.allSettled([...archiveCloses.values()].map(value=>value.promise));
          const errors=results.filter(value=>value.status==='rejected').map(value=>value.reason);
          if(errors.length)throw Object.assign(new AggregateError(errors,'Original customer archive shutdown is incomplete; retry this owner.'),{code:'CONSOLE_CUSTOMER_CLOSE_INCOMPLETE'});
        })().catch(error=>{closed=undefined;throw error;});
      }
      return closed;
    }
  };
}
