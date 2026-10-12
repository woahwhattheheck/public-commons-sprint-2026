// MIT. Continue one completed original managed customer through data editions and portable receiving.
import { open, link, unlink, rename } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { runCustomerRuntime } from '../../examples/customer-runtime.mjs';
import { openRubyRuntime } from '../../model.mjs';
import { openRubyCustomerWorkspace } from '../../customer/model.mjs';
import { serveRubyCustomerWorkspace } from '../../customer/server.mjs';
import { inspectRubyCustomerLaunch, rubyCustomerWorkspaceStartup } from '../../customer/launch.mjs';
import { absolute, directory, need, id, sha, json, digest, hashObject, once, readJSON,
  regular, exists, fingerprint, syncParent, inventory, operationLease } from '../../files.mjs';

const SCHEMA='stellar-forge.ruby-application-editions-customer.v1';
const INPUT='stellar-forge.ruby-application-editions-customer-selection.v1';
const PHASES=['receive-original','stage','commit','verify','export','receive-revised','recipient-http','recipient-stop','recipient-verify'];
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
async function fileCopy(core,key,name,target){
  const file=await core.openFile({operationId:key,name});let pending;
  try{
    if(await exists(target)){const old=await fingerprint(target,{privateOnly:true});
      need(old.bytes===file.bytes&&old.sha256===file.sha256,'RUBY_EDITION_JOURNEY_FILE_CHANGED');
      return {name:target.split('/').at(-1),bytes:file.bytes,sha256:file.sha256};}
    pending=target+'.pending-'+randomUUID();const output=await open(pending,'wx',0o600);
    try{for await(const chunk of file.handle.createReadStream({start:0,autoClose:false})){
      let at=0;while(at<chunk.length){const wrote=await output.write(chunk,at,chunk.length-at);need(wrote.bytesWritten>0,'RUBY_EDITION_WRITE_FAILED');at+=wrote.bytesWritten;}}
      await output.sync();}finally{await output.close();}
    try{await link(pending,target);}catch(error){if(error.code!=='EEXIST')throw error;
      const old=await fingerprint(target,{privateOnly:true});need(old.bytes===file.bytes&&old.sha256===file.sha256,'RUBY_EDITION_JOURNEY_FILE_CHANGED');}
    await syncParent(target);return {name:target.split('/').at(-1),bytes:file.bytes,sha256:file.sha256};
  }finally{await file.handle.close();if(pending)await unlink(pending).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
async function completeSnapshot(directoryPath,files){
  const actual=await inventory(directoryPath,{exclude:['.ruby.lock'],privateOnly:true});
  need(hashObject(actual)===hashObject(files),'RUBY_EDITION_RECEIVED_APPLICATION_CHANGED');
}
export async function runApplicationEditions({managedDirectory,editionId='received-source-edition',source}={}){
  const originalRoot=await directory(absolute(managedDirectory));id(editionId);
  need(await exists(join(originalRoot,'runtime-customer-result.json')),'RUBY_EDITION_ORIGINAL_CUSTOMER_REQUIRED');
  // The original completed branch verifies its archived source and receipt without creating another provider run.
  const original=await runCustomerRuntime({directory:originalRoot,selectionFile:join(originalRoot,'selection.json')});
  need(original.state==='COMPLETE','RUBY_EDITION_ORIGINAL_CUSTOMER_REQUIRED');
  const originalSelection=await readJSON(join(originalRoot,'selection.json'));
  const root=await directory(join(originalRoot,'application-editions'),true),lease=await operationLease(join(root,'journey.lock'));
  let core=null,recipient=null,service=null,interrupted=false,active=null;
  const working=join(root,'working'),parked=join(root,'working-unavailable'),receiving=join(root,'recipient');
  const interrupt=()=>{interrupted=true;};process.on('SIGINT',interrupt);process.on('SIGTERM',interrupt);
  async function restore(){
    if(await exists(parked)){need(!await exists(working),'RUBY_EDITION_PRODUCER_CHANGED');await rename(parked,working);await syncParent(working);}
  }
  try{
    if(source!==undefined)need(source&&['native','baserow'].includes(source.format)&&
      Object.keys(source).every(key=>['format','directory','expectedManifestSha256'].includes(key))&&
      absolute(source.directory)&&sha(source.expectedManifestSha256),'RUBY_EDITION_JOURNEY_SOURCE');
    const input={schema:INPUT,originalManagedDirectory:originalRoot,originalResultSha256:original.sha256,
      originalArchive:original.archive,editionId,source:source??{kind:'original-completed-application-packet'},
      ruby:originalSelection.ruby,bundlerVersion:originalSelection.bundlerVersion,port:originalSelection.recipientPort};
    const selected={...input,sha256:hashObject(input)};
    await once(join(root,'selection.json'),json(selected));await directory(join(root,'phases'),true);
    let operations=await readJSON(join(root,'operations.json'),true);
    if(!operations){operations={selectionSha256:selected.sha256,reviewId:randomUUID(),
      keys:Object.fromEntries(PHASES.map(name=>[name,randomUUID()]))};
      await once(join(root,'operations.json'),json(operations));operations=await readJSON(join(root,'operations.json'));}
    need(operations.selectionSha256===selected.sha256&&UUID.test(operations.reviewId)&&
      PHASES.every(name=>UUID.test(operations.keys[name])),'RUBY_EDITION_JOURNEY_OPERATIONS_CHANGED');
    const keys=operations.keys,phasePath=name=>join(root,'phases',name+'.json');
    const completed=await readJSON(join(root,'application-editions-result.json'),true);
    if(completed){
      await restore();const {sha256,...body}=completed;
      need(completed.schema===SCHEMA&&completed.selectionSha256===selected.sha256&&hashObject(body)===sha256,'RUBY_EDITION_JOURNEY_RESULT_CHANGED');
      for(const file of completed.files){const value=await fingerprint(join(root,file.name),{privateOnly:true});
        need(value.bytes===file.bytes&&value.sha256===file.sha256,'RUBY_EDITION_JOURNEY_FILE_CHANGED');}
      recipient=await openRubyRuntime({directory:receiving});
      const app=await recipient.application({id:completed.recipient.applicationId});
      need(app.selectionSha256===completed.recipient.applicationSelectionSha256,'RUBY_EDITION_RECEIVING_CHANGED');
      await completeSnapshot(app.directory,completed.recipient.files);
      const value=await recipient.applicationEdition({id:app.id,editionId});
      need(value.selectionSha256===completed.edition.selectionSha256&&
        hashObject(value.latestCommitted.receipt)===hashObject(completed.edition.receipt),'RUBY_EDITION_RECEIPT_CHANGED');
      return completed;
    }
    async function retain(name,value){await once(phasePath(name),json(value));return value;}
    async function wait(host,key,{url=false}={}){
      active={host,key};let offset=0;
      try{
        while(true){
          if(interrupted){await host.cancel({operationId:key});throw Object.assign(new Error('The original edition operation was interrupted.'),{code:'RUBY_EDITION_JOURNEY_INTERRUPTED'});}
          const op=await host.operation({operationId:key}),log=await host.log({operationId:key,offset});
          offset=log.nextOffset;if(log.text)process.stderr.write(log.text);
          if(url&&op.active&&op.url)return op;
          if(!op.active&&['SUCCEEDED','FAILED','CANCELLED','INTERRUPTED'].includes(op.phase)){
            need(!url&&op.phase==='SUCCEEDED','RUBY_EDITION_NATIVE_FAILED','Original operation '+key+' ended '+op.phase+'. Read its retained complete log.');return op;}
          await new Promise(done=>setTimeout(done,400));
        }
      }finally{active=null;}
    }
    async function complete(name,host,begin){
      const old=await readJSON(phasePath(name),true);
      if(old){const op=await host.operation({operationId:keys[name]});
        need(op.result?.state==='COMPLETE'&&hashObject(op.result)===hashObject(old.result),'RUBY_EDITION_OPERATION_CHANGED');return old;}
      let op=await begin();
      need(op.id===keys[name],'RUBY_EDITION_OPERATION_CHANGED');
      if(!op.active&&['FAILED','INTERRUPTED','CANCELLED'].includes(op.phase))op=await host.resume({operationId:op.id});
      op=await wait(host,op.id);return retain(name,{operationId:op.id,result:op.result});
    }
    const actor='Original managed customer commissioning';
    let app,stage,commit,verified,exported,archive,previewSource;
    if(await exists(parked)){
      need(!await exists(working),'RUBY_EDITION_PRODUCER_CHANGED');
      stage=await readJSON(phasePath('stage'));commit=await readJSON(phasePath('commit'));
      verified=await readJSON(phasePath('verify'));exported=await readJSON(phasePath('export'));
      previewSource=await readJSON(join(root,'source-preview.json'));app=await readJSON(join(root,'working-application.json'));
      const originalFile=exported.result.files.find(file=>file.name==='ruby-runtime.tar');
      const retained=await fingerprint(join(root,'revised-runtime.tar'),{privateOnly:true});
      need(originalFile&&retained.bytes===originalFile.bytes&&retained.sha256===originalFile.sha256,'RUBY_EDITION_ARCHIVE_CHANGED');
      archive={name:'revised-runtime.tar',bytes:retained.bytes,sha256:retained.sha256};
    }else{
      core=await openRubyCustomerWorkspace({directory:working,create:true});
      const first=await complete('receive-original',core,()=>core.receive({id:'edition-working',title:'Original application data editions',
        ruby:input.ruby,bundlerVersion:input.bundlerVersion,archive:join(originalRoot,original.archive.name),
        expectedSha256:original.archive.sha256,operationId:keys['receive-original']}));
      app=await core.application({id:first.result.application.id});
      await once(join(root,'working-application.json'),json(app));
      const marker=await readJSON(join(app.directory,'managed-application.json'));
      const format=source?.format??marker.format;
      const sourceDirectory=source?.directory??join(app.directory,format==='baserow'?'customer':'dataset');
      const previewInput={format,directory:sourceDirectory,...(source?{expectedManifestSha256:source.expectedManifestSha256}:{})};
      previewSource=await core.previewApplicationEditionSource(previewInput);
      await once(join(root,'source-preview.json'),json(previewSource));
      const launch=await inspectRubyCustomerLaunch({directory:working});
      service=await serveRubyCustomerWorkspace({workspace:core,port:0});
      const startup=await rubyCustomerWorkspaceStartup({launch,workspace:core,service});
      const session=await fetch(service.origin+'/api/session',{method:'POST',redirect:'error',
        headers:{Origin:service.origin,'x-ruby-runtime-token':service.token,'content-type':'application/json'},
        body:'{}',signal:AbortSignal.timeout(15000)});
      need(session.status===200,'RUBY_EDITION_DESK_SESSION');
      const cookie=session.headers.get('set-cookie')?.split(';')[0];need(cookie,'RUBY_EDITION_DESK_SESSION');
      async function http(path,body){
        const response=await fetch(service.origin+path,{method:body===undefined?'GET':'POST',redirect:'error',
          headers:{Origin:service.origin,Cookie:cookie,...(body===undefined?{}:{'content-type':'application/json'})},
          ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(60000)});
        const raw=Buffer.from(await response.arrayBuffer());
        need(response.status===200,'RUBY_EDITION_DESK_HTTP',path+' '+response.status+' '+raw.toString('utf8').slice(0,1000));
        return JSON.parse(raw.toString('utf8'));
      }
      const selectedSource=await http('/api/editions/source',previewInput);
      need(hashObject(selectedSource)===hashObject(previewSource),'RUBY_EDITION_SOURCE_PREVIEW_CHANGED');
      const stageRequest={id:app.id,editionId,title:'Received original source edition',format,
        directory:sourceDirectory,expectedManifestSha256:previewSource.manifest.sha256,
        reviewId:operations.reviewId,operationId:keys.stage,actor};
      await once(join(root,'stage-request.json'),json(stageRequest));
      stage=await complete('stage',core,()=>http('/api/editions/stage',stageRequest));
      const staged=await http('/api/edition?'+new URLSearchParams({id:app.id,editionId}));
      const review=staged.reviews.find(value=>value.id===operations.reviewId);
      need(review?.review?.summary?.preview_sha256,'RUBY_EDITION_PREVIEW_REQUIRED');
      const commitRequest={id:app.id,editionId,reviewId:operations.reviewId,
        expectedPreviewSha256:review.review.summary.preview_sha256,operationId:keys.commit,actor};
      await once(join(root,'commit-request.json'),json(commitRequest));
      commit=await complete('commit',core,()=>http('/api/editions/commit',commitRequest));
      const current=await http('/api/edition?'+new URLSearchParams({id:app.id,editionId}));
      const committed=current.reviews.find(value=>value.id===operations.reviewId);
      need(committed?.committed?.receipt?.preview_sha256===commitRequest.expectedPreviewSha256,'RUBY_EDITION_COMMIT_CHANGED');
      const list=await http('/api/editions?'+new URLSearchParams({id:app.id,offset:0,limit:100}));
      need(list.editions.some(value=>value.editionId===editionId&&value.latestCommitted),'RUBY_EDITION_DESK_CATALOG');
      await once(join(root,'committed-edition.json'),json(current));
      // Receive the complete original preview and receipt through the actual private file route.
      for(const file of [...committed.review.files,committed.committed.file]){
        const path='/api/edition/file?'+new URLSearchParams({id:app.id,editionId,reviewId:operations.reviewId,name:file.name});
        const response=await fetch(service.origin+path,{headers:{Origin:service.origin,Cookie:cookie},redirect:'error'});
        need(response.status===200&&response.headers.get('x-content-sha256')===file.sha256&&
          Number(response.headers.get('content-length'))===file.bytes,'RUBY_EDITION_FILE_HEADER_CHANGED');
        const destination=join(root,'received-'+file.name),pending=destination+'.pending-'+randomUUID();
        const output=await open(pending,'wx',0o600);
        try{
          for await(const bytes of response.body){let at=0;while(at<bytes.length){
            const write=await output.write(bytes,at,bytes.length-at);need(write.bytesWritten>0,'RUBY_EDITION_WRITE_FAILED');at+=write.bytesWritten;}}
          await output.sync();
        }finally{await output.close();}
        try{
          const check=await fingerprint(pending,{privateOnly:true});need(check.bytes===file.bytes&&check.sha256===file.sha256,'RUBY_EDITION_COMPLETE_FILE_CHANGED');
          try{await link(pending,destination);}catch(error){if(error.code!=='EEXIST')throw error;
            const old=await fingerprint(destination,{privateOnly:true});need(old.bytes===file.bytes&&old.sha256===file.sha256,'RUBY_EDITION_COMPLETE_FILE_CHANGED');}
          await syncParent(destination);
        }finally{await unlink(pending);}
      }
      verified=await complete('verify',core,()=>core.start({id:app.environmentId,applicationId:app.id,
        operationId:keys.verify,action:'verify'}));
      exported=await complete('export',core,()=>core.start({id:app.environmentId,applicationId:app.id,
        operationId:keys.export,action:'export'}));
      archive=await fileCopy(core,keys.export,'ruby-runtime.tar',join(root,'revised-runtime.tar'));
      await service.close();service=null;core=null;
      await rename(working,parked);await syncParent(parked);
    }
    recipient=await openRubyRuntime({directory:receiving,create:true});
    const received=await complete('receive-revised',recipient,()=>recipient.receive({id:'edition-recipient',title:'Received revised application',
      ruby:input.ruby,bundlerVersion:input.bundlerVersion,archive:join(root,archive.name),
      expectedSha256:archive.sha256,operationId:keys['receive-revised']}));
    const recipientId=received.result.application.id;
    let httpResult=await readJSON(phasePath('recipient-http'),true);
    if(!httpResult){
      let launchSelection=await readJSON(join(root,'recipient-launch.json'),true);
      if(!launchSelection){launchSelection={applicationId:recipientId,port:input.port,operations:[keys['recipient-http']]};
        await once(join(root,'recipient-launch.json'),json(launchSelection));}
      need(launchSelection.applicationId===recipientId&&launchSelection.port===input.port,'RUBY_EDITION_LAUNCH_CHANGED');
      let key=launchSelection.operations.at(-1),op=await recipient.launchApplication({id:recipientId,operationId:key,port:input.port});
      if(!op.active&&op.phase==='SUCCEEDED'){
        key=randomUUID();launchSelection={...launchSelection,operations:[...launchSelection.operations,key]};
        const {saveJSON}=await import('../../files.mjs');await saveJSON(join(root,'recipient-launch.json'),launchSelection,true);
        op=await recipient.launchApplication({id:recipientId,operationId:key,port:input.port});
      }else if(!op.active&&['FAILED','INTERRUPTED','CANCELLED'].includes(op.phase))op=await recipient.resume({operationId:key});
      op=await wait(recipient,key,{url:true});
      const url=new URL(op.url),token=new URLSearchParams(url.hash.slice(1)).get('token');sha(token);
      need(url.protocol==='http:'&&url.hostname==='127.0.0.1'&&Number(url.port||80)===input.port,'RUBY_EDITION_LAUNCH_CHANGED');
      const session=await fetch(url.origin+'/managed-ruby/session',{method:'POST',headers:{Origin:url.origin,'X-Ruby-Application':token},
        redirect:'error',signal:AbortSignal.timeout(15000)});
      need(session.status===204,'RUBY_EDITION_APPLICATION_SESSION');
      const cookie=session.headers.get('set-cookie')?.split(';')[0];need(cookie,'RUBY_EDITION_APPLICATION_SESSION');
      const page=await fetch(url.origin+'/dataset_imports/'+operations.reviewId,{headers:{Cookie:cookie},redirect:'error',signal:AbortSignal.timeout(30000)});
      const raw=Buffer.from(await page.arrayBuffer());need(page.status===200&&raw.length>0,'RUBY_EDITION_APPLICATION_HTTP');
      httpResult=await retain('recipient-http',{operationId:key,applicationId:recipientId,status:page.status,bytes:raw.length,sha256:digest(raw)});
    }
    if(!await readJSON(phasePath('recipient-stop'),true)){
      await recipient.cancel({operationId:httpResult.operationId});const stopped=await wait(recipient,httpResult.operationId);
      await retain('recipient-stop',{operationId:httpResult.operationId,phase:stopped.phase,active:stopped.active});
    }
    const recipientVerified=await complete('recipient-verify',recipient,()=>recipient.start({id:'edition-recipient',applicationId:recipientId,
      operationId:keys['recipient-verify'],action:'verify'}));
    const originalObservation=verified.result.result.application,receivedObservation=recipientVerified.result.result.application;
    need(hashObject(originalObservation)===hashObject(receivedObservation),'RUBY_EDITION_RECEIVED_TARGETS_OR_HISTORY_CHANGED');
    const recipientApp=await recipient.application({id:recipientId});
    const receivedEdition=await recipient.applicationEdition({id:recipientId,editionId});
    const receipt=commit.result.result.detail.committed.receipt;
    need(receivedEdition.selectionSha256===commit.result.result.selection.sha256&&
      hashObject(receivedEdition.latestCommitted.receipt)===hashObject(receipt),'RUBY_EDITION_RECEIVED_COMMIT_CHANGED');
    await recipient.close();recipient=null;
    // Reopen only the relocated runtime, while the complete revised producer is still parked.
    recipient=await openRubyRuntime({directory:receiving});
    const reopened=await recipient.application({id:recipientId});
    need(reopened.selectionSha256===recipientApp.selectionSha256&&!reopened.current?.active,'RUBY_EDITION_RECEIVED_APPLICATION_CHANGED');
    const appFiles=await inventory(reopened.directory,{exclude:['.ruby.lock'],privateOnly:true});
    const files=[];
    for(const name of ['selection.json','operations.json','source-preview.json','stage-request.json','commit-request.json',
      'committed-edition.json','revised-runtime.tar',...commit.result.result.files.map(file=>'received-'+file.name)]){
      const originalFile=await fingerprint(join(root,name),{privateOnly:true});files.push({name,...originalFile});}
    const body={schema:SCHEMA,state:'COMPLETE',selectionSha256:selected.sha256,originalManagedResultSha256:original.sha256,
      originalSource:previewSource,observedChanges:commit.result.result.detail.review.summary.counts,
      edition:{id:editionId,reviewId:operations.reviewId,selectionSha256:receivedEdition.selectionSha256,receipt},
      originalApplicationVerification:originalObservation,receivedApplicationVerification:receivedObservation,
      archive,operations,recipient:{applicationId:recipientId,applicationSelectionSha256:reopened.selectionSha256,
        directory:'recipient',files:appFiles},nativeHttp:httpResult,files,
      producerUnavailableDuringReceiving:true,recipientReopened:true};
    const result={...body,sha256:hashObject(body)};
    await once(join(root,'application-editions-result.json'),json(result));return result;
  }finally{
    if(active)await active.host.cancel({operationId:active.key}).catch(()=>{});
    try{
      if(service){await service.close();service=null;core=null;}
      if(core)await core.close();
      if(!recipient&&await exists(parked)&&await exists(join(receiving,'ruby-runtime.json')))recipient=await openRubyRuntime({directory:receiving});
      if(recipient){
        const launch=await readJSON(join(root,'recipient-launch.json'),true),retainedOperations=await readJSON(join(root,'operations.json'),true);
        const originalKeys=new Set([...Object.values(retainedOperations?.keys??{}),...(launch?.operations??[])]);
        for(const key of originalKeys){
          const op=await recipient.operation({operationId:key}).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
          if(!op||!op.active&&op.phase!=='QUEUED')continue;await recipient.cancel({operationId:key});
          const deadline=Date.now()+30000;while((await recipient.operation({operationId:key})).active){
            need(Date.now()<deadline,'RUBY_EDITION_STOP_PENDING','The original recipient process is draining; keep its revised producer parked.');
            await new Promise(done=>setTimeout(done,250));}
        }
        await recipient.close();
      }
      await restore();
    }finally{process.off('SIGINT',interrupt);process.off('SIGTERM',interrupt);await lease.close();}
  }
}
export async function main(argv=process.argv.slice(2)){
  const allowed=new Set(['--managed-directory','--edition-id','--format','--source-directory','--manifest-sha256']),args={};
  for(let index=0;index<argv.length;index+=2){
    const key=argv[index],value=argv[index+1];need(allowed.has(key)&&value!==undefined&&!Object.hasOwn(args,key),'RUBY_EDITION_JOURNEY_ARGUMENT');
    args[key]=value;
  }
  const provided=['--format','--source-directory','--manifest-sha256'].filter(key=>Object.hasOwn(args,key));
  need(provided.length===0||provided.length===3,'RUBY_EDITION_JOURNEY_SOURCE');
  need(args['--managed-directory'],'RUBY_EDITION_JOURNEY_ARGUMENT','Select the original completed managed directory.');
  return runApplicationEditions({managedDirectory:resolve(args['--managed-directory']),editionId:args['--edition-id']??'received-source-edition',
    ...(provided.length?{source:{format:args['--format'],directory:resolve(args['--source-directory']),expectedManifestSha256:args['--manifest-sha256']}}:{})});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().then(value=>process.stdout.write(JSON.stringify(value,null,2)+'\n')).catch(error=>{
    process.stderr.write(JSON.stringify({error:{code:error.code??'RUBY_EDITION_JOURNEY_FAILED',message:error.message}})+'\n');process.exitCode=1;});
