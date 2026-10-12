// MIT. One real customer: private bundle, original source program, live Rails,
// complete stopped application export, offline receiving and original row/history verification.
import { open, link, unlink, rename } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { openRubyRuntime } from '../model.mjs';
import { absolute, directory, once, saveJSON, readJSON, regular, need, sha, id, label,
  digest, hashObject, exists, fingerprint, syncParent } from '../files.mjs';

const SCHEMA='stellar-forge.ruby-runtime-customer.v1';
const SELECT='stellar-forge.ruby-runtime-customer-selection.v1';
const PHASES=['install','customer','register','source-http','source-stop','export','receive','recipient-http','recipient-stop','recipient-verify'];
function selection(value) {
  need(value?.schema===SELECT,'RUBY_CUSTOMER_SELECTION_REQUIRED');
  need(Object.keys(value).every(key=>['schema','ruby','bundlerVersion','title','environmentId',
    'applicationId','applicationDirectory','customer','sourcePort','recipientPort'].includes(key)),'RUBY_CUSTOMER_SELECTION_FIELD');
  absolute(value.ruby);absolute(value.applicationDirectory);id(value.environmentId);id(value.applicationId);label(value.title);
  need(typeof value.bundlerVersion==='string','RUBY_BUNDLER_VERSION_REQUIRED');
  for(const name of ['sourcePort','recipientPort'])need(Number.isInteger(value[name])&&value[name]>0&&value[name]<=65535,'RUBY_PORT_INVALID');
  if(value.customer!==undefined)need(value.customer && Object.keys(value.customer).every(key=>['entry','argv'].includes(key)) && ['native-dataset-lifecycle','baserow-customer-lifecycle'].includes(value.customer.entry)&&
    Array.isArray(value.customer.argv)&&value.customer.argv.every(item=>typeof item==='string'&&!item.includes('\0')),'RUBY_CUSTOMER_ARGUMENTS_INVALID');
  return value;
}
async function streamOutput(core,key,name,target) {
  const source=await core.openFile({operationId:key,name});
  let pending;
  try {
    if(await exists(target)) {
      const original=await fingerprint(target,{privateOnly:true});
      need(original.bytes===source.bytes&&original.sha256===source.sha256,'RUBY_CUSTOMER_OUTPUT_CHANGED');
      return {name:target.split('/').at(-1),bytes:source.bytes,sha256:source.sha256};
    }
    pending=target+'.pending-'+randomUUID();
    const output=await open(pending,'wx',0o600);
    try {
      for await(const bytes of source.handle.createReadStream({start:0,autoClose:false})) {
        let at=0;while(at<bytes.length){const written=await output.write(bytes,at,bytes.length-at);need(written.bytesWritten>0,'RUBY_WRITE_FAILED');at+=written.bytesWritten;}
      }
      await output.sync();
    } finally {await output.close();}
    await link(pending,target);await syncParent(target);
    return {name:target.split('/').at(-1),bytes:source.bytes,sha256:source.sha256};
  } finally {await source.handle.close();if(pending)await unlink(pending).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
export async function runCustomerRuntime({directory:root,selectionFile}={}) {
  root=await directory(absolute(root),true);
  const selectedRaw=await regular(absolute(selectionFile),1024*1024), selected=selection(JSON.parse(selectedRaw.toString('utf8')));
  await once(join(root,'selection.json'),selectedRaw);
  const producer=join(root,'producer'), parked=join(root,'producer-unavailable'), recipient=join(root,'recipient');
  async function restore() {
    if(await exists(parked)) {
      need(!await exists(producer),'RUBY_CUSTOMER_PRODUCER_CHANGED');
      await rename(parked,producer);await syncParent(producer);
    }
  }
  const completed=await readJSON(join(root,'runtime-customer-result.json'),true);
  if(completed) {
    await restore();
    const {sha256,...body}=completed;
    need(completed.schema===SCHEMA&&completed.selectionSha256===digest(selectedRaw)&&hashObject(body)===sha256,'RUBY_CUSTOMER_RESULT_CHANGED');
    const archive=await fingerprint(join(root,completed.archive.name),{privateOnly:true});
    need(archive.bytes===completed.archive.bytes&&archive.sha256===completed.archive.sha256,'RUBY_CUSTOMER_ARCHIVE_CHANGED');
    const core=await openRubyRuntime({directory:recipient});
    try {
      const current=await core.application({id:completed.receivedApplication.id});
      need(current.selectionSha256===completed.receivedApplication.selectionSha256,'RUBY_CUSTOMER_APPLICATION_CHANGED');
    }finally{await core.close();}
    return completed;
  }
  await directory(join(root,'phases'),true);
  let operations=await readJSON(join(root,'operations.json'),true);
  if(!operations){
    const keys=Object.fromEntries(['create',...PHASES].map(name=>[name,randomUUID()]));
    await once(join(root,'operations.json'),JSON.stringify({schema:SCHEMA,selectionSha256:digest(selectedRaw),keys},null,2)+'\n');
    operations=await readJSON(join(root,'operations.json'));
  }
  need(operations.schema===SCHEMA&&operations.selectionSha256===digest(selectedRaw),'RUBY_CUSTOMER_OPERATION_CHANGED');
  const keys=operations.keys;
  let sourceCore,receivingCore,active=null,interrupted=false;
  const interrupt=()=>{interrupted=true;};
  process.on('SIGINT',interrupt);process.on('SIGTERM',interrupt);
  const phasePath=name=>join(root,'phases',name+'.json');
  const record=async(name,value)=>{await once(phasePath(name),JSON.stringify(value,null,2)+'\n');return value;};
  async function wait(core,key,{ready=false}={}) {
    active={core,key};
    try {
      let offset=0;
      while(true) {
        if(interrupted){await core.cancel({operationId:key});throw Object.assign(new Error('Original customer operation stopped.'),{code:'RUBY_CUSTOMER_INTERRUPTED'});}
        const observed=await core.operation({operationId:key});
        const log=await core.log({operationId:key,offset});offset=log.nextOffset;
        if(log.text)process.stderr.write(log.text);
        if(ready&&observed.active&&observed.url)return observed;
        if(!observed.active&&['SUCCEEDED','FAILED','CANCELLED','INTERRUPTED'].includes(observed.phase)) {
          need(!ready&&observed.phase==='SUCCEEDED','RUBY_CUSTOMER_NATIVE_FAILED',
            'Original operation '+key+' ended '+observed.phase+'. Its complete log and request remain in the selected runtime.');
          return observed;
        }
        await new Promise(accept=>setTimeout(accept,300));
      }
    } finally {active=null;}
  }
  async function complete(name,core,begin) {
    const old=await readJSON(phasePath(name),true);
    if(old)return old;
    let observed=await begin();
    if(observed.id && !observed.active&&['FAILED','INTERRUPTED','CANCELLED'].includes(observed.phase))
      observed=await core.resume({operationId:keys[name]});
    const value=await wait(core,keys[name]);
    return record(name,value);
  }
  async function live(name,core,applicationId,port) {
    const old=await readJSON(phasePath(name),true);
    if(old)return old;
    const selectionPath=join(root,'phases',name+'-launch.json');
    let chosen=await readJSON(selectionPath,true);
    if(!chosen) {chosen={applicationId,port,operationIds:[keys[name]]};await saveJSON(selectionPath,chosen);}
    need(chosen.applicationId===applicationId&&chosen.port===port,'RUBY_CUSTOMER_LAUNCH_CHANGED');
    let key=chosen.operationIds.at(-1), observed=await core.launchApplication({id:applicationId,operationId:key,port});
    if(!observed.active&&observed.phase==='SUCCEEDED') {
      // A previous server was stopped before its HTTP observation was retained.
      // This explicit customer continuation starts another server, preserving both runs.
      key=randomUUID();chosen={...chosen,operationIds:[...chosen.operationIds,key]};
      await saveJSON(selectionPath,chosen,true);
      observed=await core.launchApplication({id:applicationId,operationId:key,port});
    }else if(!observed.active&&['FAILED','INTERRUPTED','CANCELLED'].includes(observed.phase))
      observed=await core.resume({operationId:key});
    observed=await wait(core,key,{ready:true});
    const url=new URL(observed.url), token=new URLSearchParams(url.hash.slice(1)).get('token');
    sha(token);need(url.hostname==='127.0.0.1'&&url.protocol==='http:'&&Number(url.port || 80)===port,'RUBY_CUSTOMER_URL_CHANGED');
    const opening=await fetch(url.origin+'/managed-ruby/start',{redirect:'error',signal:AbortSignal.timeout(15000)});
    need(opening.status===200,'RUBY_CUSTOMER_OPEN_FAILED');await opening.arrayBuffer();
    const session=await fetch(url.origin+'/managed-ruby/session',{method:'POST',redirect:'error',
      headers:{Origin:url.origin,'X-Ruby-Application':token},signal:AbortSignal.timeout(15000)});
    need(session.status===204,'RUBY_CUSTOMER_SESSION_FAILED');
    const cookie=session.headers.get('set-cookie')?.split(';')[0];need(cookie,'RUBY_CUSTOMER_SESSION_FAILED');
    const page=await fetch(url.origin+'/dataset_imports',{headers:{Cookie:cookie},redirect:'error',signal:AbortSignal.timeout(30000)});
    const bytes=Buffer.from(await page.arrayBuffer());
    need(page.status===200&&bytes.length>0,'RUBY_CUSTOMER_HTTP_FAILED');
    return record(name,{operationId:key,applicationId,port,status:page.status,bytes:bytes.length,sha256:digest(bytes)});
  }
  async function stopped(name,httpName,core) {
    const old=await readJSON(phasePath(name),true);if(old)return old;
    const http=await readJSON(phasePath(httpName));
    await core.cancel({operationId:http.operationId});
    const state=await wait(core,http.operationId);
    return record(name,{operationId:http.operationId,phase:state.phase,active:state.active});
  }
  try {
    let registered,sourceHttp,exported,archive;
    if(await exists(parked)) {
      // A process loss during receiving keeps the original producer unavailable.
      // Reuse its completed export and continue the same recipient operation.
      need(!await exists(producer),'RUBY_CUSTOMER_PRODUCER_CHANGED');
      registered=await readJSON(phasePath('register'));
      sourceHttp=await readJSON(phasePath('source-http'));
      exported=await readJSON(phasePath('export'));
      const original=exported.result?.files?.find(file=>file.name==='ruby-runtime.tar');
      const retained=await fingerprint(join(root,'ruby-runtime.tar'),{privateOnly:true});
      need(original&&original.bytes===retained.bytes&&original.sha256===retained.sha256,'RUBY_CUSTOMER_ARCHIVE_CHANGED');
      archive={name:'ruby-runtime.tar',bytes:retained.bytes,sha256:retained.sha256};
    } else {
    sourceCore=await openRubyRuntime({directory:producer,create:true});
    await sourceCore.create({id:selected.environmentId,title:selected.title,ruby:selected.ruby,
      bundlerVersion:selected.bundlerVersion,requestId:keys.create});
    await complete('install',sourceCore,()=>sourceCore.start({id:selected.environmentId,operationId:keys.install,action:'install'}));
    if(selected.customer)await complete('customer',sourceCore,()=>sourceCore.run({id:selected.environmentId,
      operationId:keys.customer,entry:selected.customer.entry,argv:selected.customer.argv}));
    registered=await complete('register',sourceCore,async()=>{
      await sourceCore.registerApplication({id:selected.applicationId,title:selected.title,
        environmentId:selected.environmentId,directory:selected.applicationDirectory,requestId:keys.register});
      return sourceCore.operation({operationId:keys.register});
    });
    sourceHttp=await live('source-http',sourceCore,selected.applicationId,selected.sourcePort);
    await stopped('source-stop','source-http',sourceCore);
    exported=await complete('export',sourceCore,()=>sourceCore.start({id:selected.environmentId,operationId:keys.export,
      action:'export',applicationId:selected.applicationId}));
    archive=await streamOutput(sourceCore,keys.export,'ruby-runtime.tar',join(root,'ruby-runtime.tar'));
    await sourceCore.close();sourceCore=null;
    await rename(producer,parked);await syncParent(parked);
    }
    receivingCore=await openRubyRuntime({directory:recipient,create:true});
    const received=await complete('receive',receivingCore,()=>receivingCore.receive({id:'received-customer',title:(selected.title+' received').slice(0,160),
      ruby:selected.ruby,bundlerVersion:selected.bundlerVersion,archive:join(root,archive.name),
      expectedSha256:archive.sha256,operationId:keys.receive}));
    const applicationId=received.result.application.id;
    const recipientHttp=await live('recipient-http',receivingCore,applicationId,selected.recipientPort);
    await stopped('recipient-stop','recipient-http',receivingCore);
    const verified=await complete('recipient-verify',receivingCore,()=>receivingCore.start({id:'received-customer',
      applicationId,operationId:keys['recipient-verify'],action:'verify'}));
    const receivedApplication=await receivingCore.application({id:applicationId});
    await receivingCore.close();receivingCore=null;
    // Reopen the actual independently installed recipient while producer is still unavailable.
    receivingCore=await openRubyRuntime({directory:recipient});
    const reopened=await receivingCore.application({id:applicationId});
    need(reopened.selectionSha256===receivedApplication.selectionSha256&&reopened.phase==='STOPPED',
      'RUBY_CUSTOMER_REOPEN_CHANGED');
    const body={schema:SCHEMA,state:'COMPLETE',selectionSha256:digest(selectedRaw),
      originalCustomer:selected.customer??null,operations:keys,archive,
      originalRegistration:registered.result,sourceHttp,recipientHttp,export:exported.result,
      received:received.result,verification:verified.result,receivedApplication:{
        id:applicationId,selectionSha256:receivedApplication.selectionSha256,directory:'recipient/applications/'+applicationId+'/workspace'},
      producerUnavailableDuringReceiving:true,recipientReopened:true};
    const result={...body,sha256:hashObject(body)};
    await once(join(root,'runtime-customer-result.json'),JSON.stringify(result,null,2)+'\n');
    return result;
  } finally {
    // An interrupted earlier process may still own a detached recipient worker.
    // Adopt its existing runtime before restoring the producer or releasing this journey.
    if(!receivingCore&&await exists(parked)&&await exists(join(recipient,'ruby-runtime.json')))
      receivingCore=await openRubyRuntime({directory:recipient});
    if(active)await active.core.cancel({operationId:active.key}).catch(()=>{});
    for(const [core,phase]of [[sourceCore,'source-http'],[receivingCore,'recipient-http']])if(core){
      const saved=await readJSON(phasePath(phase),true).catch(()=>null);
      const launching=await readJSON(join(root,'phases',phase+'-launch.json'),true).catch(()=>null);
      const owned=new Set([...Object.values(keys),...(launching?.operationIds??[]),...(saved?[saved.operationId]:[])]);
      for(const key of owned) {
        const state=await core.operation({operationId:key}).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
        if(!state || !state.active && state.phase!=='QUEUED')continue;
        await core.cancel({operationId:key});
        const deadline=Date.now()+30000;
        while((await core.operation({operationId:key})).active) {
          need(Date.now()<deadline,'RUBY_CUSTOMER_STOP_PENDING','The original runtime worker is draining; keep the selected producer parked until its lease closes.');
          await new Promise(accept=>setTimeout(accept,200));
        }
      }
      await core.close();
    }
    await restore();
    process.off('SIGINT',interrupt);process.off('SIGTERM',interrupt);
  }
}
export async function main(argv=process.argv.slice(2)) {
  need(argv.length===4&&argv[0]==='--directory'&&argv[2]==='--selection','RUBY_CUSTOMER_OPTIONS',
    'Use --directory NEW_PRIVATE_JOURNEY --selection ORIGINAL_CUSTOMER_SELECTION_JSON.');
  return runCustomerRuntime({directory:argv[1],selectionFile:argv[3]});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().then(result=>process.stdout.write(JSON.stringify(result,null,2)+'\n')).catch(error=>{
    process.stderr.write(JSON.stringify({error:{code:error.code??'RUBY_CUSTOMER_FAILED',message:error.message}})+'\n');process.exitCode=1;});
