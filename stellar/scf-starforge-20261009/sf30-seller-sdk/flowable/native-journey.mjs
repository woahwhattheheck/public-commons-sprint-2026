// MIT. Complete original Flowable deployment, human work, migration and cold receiving journey.
import {createHash,randomUUID} from 'node:crypto';
import {createReadStream,constants} from 'node:fs';
import {readFile,open,mkdir,rename,unlink,lstat,realpath,readdir} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {startFlowableWorkspaceServer} from './workspace/server.mjs';
import {FlowableWorkspaceHttpClient} from './workspace/http-client.mjs';
import {normalizeFlowableConnection} from './native.mjs';
import {runFlowableDmnNativeJourney} from './dmn-native-journey.mjs';
import {runFlowableCmmnNativeJourney} from './cmmn-native-journey.mjs';
import {operationLease} from '../../distribution/runtime-workspace/storage.mjs';

const SCHEMA='stellar-forge.flowable-native-journey.v1';
const SCOPE='complete-native-process-history-and-cold-receiving';
const sha=value=>createHash('sha256').update(value).digest('hex');
const need=(value,message)=>{if(!value)throw Object.assign(new Error(message),{code:'FLOWABLE_NATIVE_JOURNEY_MISMATCH'});};
const reference=record=>({kind:record.kind,id:record.id,revision:record.revision,sha256:record.sha256,state:record.value.state});
async function privateDirectory(path){
  await mkdir(path,{recursive:true,mode:0o700});const info=await lstat(path);
  need(info.isDirectory()&&!info.isSymbolicLink()&&await realpath(path)===path&&!(info.mode&0o077),
    'Use an owned private receiving directory.');return path;
}
async function atomicJSON(path,value){
  const temporary=path+'.pending-'+randomUUID(),handle=await open(temporary,
    constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  try{await handle.writeFile(JSON.stringify(value,null,2)+'\n');await handle.sync();}finally{await handle.close();}
  try{await rename(temporary,path);const parent=await open(dirname(path),constants.O_RDONLY|constants.O_DIRECTORY);
    try{await parent.sync();}finally{await parent.close();}}
  finally{await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
async function hashFile(path){
  let bytes=0;const hash=createHash('sha256');
  for await(const chunk of createReadStream(path)){bytes+=chunk.length;hash.update(chunk);}
  return{path,bytes,sha256:hash.digest('hex')};
}
async function privateJSON(path){
  const info=await lstat(path);
  need(info.isFile()&&!info.isSymbolicLink()&&!(info.mode&0o077)&&info.size<=8*1024*1024,
    'Use the original private native journey configuration.');
  const bytes=await readFile(path);return{value:JSON.parse(bytes),bytes};
}
export async function runFlowableNativeJourney(configPath,outputDirectory,{fetch=globalThis.fetch,signal}={}){
  const {value:config,bytes:configBytes}=await privateJSON(resolve(configPath));
  need(config.schema===SCHEMA&&typeof config.operation==='string'&&config.operation.length>=8,
    'Use a complete named native Flowable configuration.');
  need(config.installedVersion==='8.0.0'&&/^[a-f0-9]{40}$/.test(config.sourceRevision),
    'Retain the original engine and installed source revision.');
  need(typeof config.adminUserId==='string'&&typeof config.reviewerUserId==='string',
    'Use the actual native administrator and reviewer identities.');
  const connection=normalizeFlowableConnection(config.connection),dmnConnection=normalizeFlowableConnection(config.dmnConnection),
    cmmnConnection=normalizeFlowableConnection(config.cmmnConnection),root=resolve(outputDirectory);
  need(new Set([connection.id,dmnConnection.id,cmmnConnection.id]).size===3,
    'Keep the original process, DMN and CMMN REST services as separate declared native connections.');
  await privateDirectory(root);await privateDirectory(join(root,'downloads'));await privateDirectory(join(root,'screenshots'));
  const lease=await operationLease(join(root,'operation.lock'));
  let sender,receiver,browser,terminalError,state,persistTail=Promise.resolve();
  const statePath=join(root,'journey.json'),inputSha256=sha(configBytes);
  try{
    try{state=JSON.parse(await readFile(statePath,'utf8'));
      need(state.schema===SCHEMA&&state.operation===config.operation&&state.inputSha256===inputSha256,
        'Resume this native journey with its original exact configuration.');
    }catch(error){if(error.code!=='ENOENT')throw error;
      state={schema:SCHEMA,scope:SCOPE,operation:config.operation,inputSha256,configuration:config,
        startedAt:new Date().toISOString(),steps:{},inputs:{},nativeRequests:[],reviews:{},lostResponse:null};
    }
    const persist=()=>{
      const snapshot=JSON.parse(JSON.stringify(state));
      persistTail=persistTail.then(()=>atomicJSON(statePath,snapshot));return persistTail;
    };
    const requestId=label=>{
      const value=sha(config.operation+'\n'+label).slice(0,32);
      return value.slice(0,8)+'-'+value.slice(8,12)+'-'+value.slice(12,16)+'-'+value.slice(16,20)+'-'+value.slice(20);
    };
    const freeze=async(label,value)=>{
      if(Object.hasOwn(state.inputs,label))return state.inputs[label];
      state.inputs[label]=value;await persist();return value;
    };
    async function step(name,fn){
      signal?.throwIfAborted();
      if(state.steps[name])return state.steps[name].value;
      state.currentPhase=name;await persist();process.stdout.write(JSON.stringify({phase:name,state:'RUNNING'})+'\n');
      const value=await fn();
      state.steps[name]={completedAt:new Date().toISOString(),value};await persist();
      process.stdout.write(JSON.stringify({phase:name,state:'COMPLETE'})+'\n');return value;
    }
    const lossBusinessKey=config.operation+'-grant';
    let armLoss=false;
    const nativeFetch=async(input,options={})=>{
      const url=new URL(String(input)),body=options.body==null?Buffer.alloc(0):
        typeof options.body==='string'?Buffer.from(options.body):Buffer.from(options.body);
      const item={method:options.method??'GET',origin:url.origin,path:url.pathname,query:url.search,
        bodyBytes:body.length,bodySha256:sha(body),startedAt:new Date().toISOString()};
      state.nativeRequests.push(item);await persist();
      const response=await fetch(input,options);item.status=response.status;item.completedAt=new Date().toISOString();await persist();
      if(armLoss&&!state.lostResponse&&item.method==='POST'&&url.pathname.endsWith('/runtime/process-instances')&&
        body.toString('utf8').includes(lossBusinessKey)){
        const bytes=Buffer.from(await response.arrayBuffer());
        need(response.ok&&response.status===201,'The original Flowable engine must accept the actual selected process start.');
        state.lostResponse={request:item,actualResponse:{status:response.status,bodyBytes:bytes.length,
          bodySha256:sha(bytes),bodyBase64:bytes.toString('base64')},receivedAt:new Date().toISOString()};
        await persist();armLoss=false;
        let part=0;
        const stream=new ReadableStream({pull(controller){
          if(part++===0&&bytes.length){controller.enqueue(bytes.subarray(0,Math.min(16,bytes.length)));return;}
          controller.error(Object.assign(new Error('Original process-start reply interrupted after retained first bytes.'),
            {code:'FLOWABLE_RECEIVING_REPLY_LOST'}));
        }});
        return new Response(stream,{status:response.status,statusText:response.statusText,headers:response.headers});
      }
      return response;
    };
    async function openHost(name){
      const host=await startFlowableWorkspaceServer({directory:join(root,name),connections:name==='sender'?[connection,dmnConnection,cmmnConnection]:[],
        environment:process.env,fetch:nativeFetch,signal,timeoutMs:config.nativeTimeoutMs??120000,
        maximumResponseBytes:config.maximumResponseBytes??64*1024*1024});
      const client=new FlowableWorkspaceHttpClient({url:host.url,workspaceId:host.workspaceId,signal});
      await client.ready();return{host,client};
    }
    async function closeHost(value){
      if(!value)return;await value.client.close();await value.host.close();
    }
    const call=(method,args={})=>sender.client.action(method,args,{signal});
    const current=record=>call('getRecord',{kind:record.kind,id:record.id});
    async function source(reference){return(await call('readSource',{reference})).value;}
    async function retainReview(record){
      const key=record.id+'@'+record.revision;
      if(state.reviews[key])return state.reviews[key];
      const review=await call('readReview',{kind:record.kind,id:record.id,revision:record.revision});
      const reviewPath=join(root,'downloads',key+'-review.json');await atomicJSON(reviewPath,review);
      const originals=[];
      for(const item of review.originals){
        const output=join(root,'downloads','source-'+item.reference.sha256+'.bin');
        const saved=await sender.client.downloadSource(item.reference,output,{signal});
        need(saved.sha256===item.reference.sha256&&saved.bytes===item.reference.bytes,
          'The original native review source changed during downloading.');
        originals.push({role:item.role,...saved});
      }
      const result={record:reference(record),review:await hashFile(reviewPath),originals};
      state.reviews[key]=result;await persist();return result;
    }
    async function prepare(label,kind,selection,connectionId=state.connectionRecordId){
      const method='prepare'+kind[0].toUpperCase()+kind.slice(1);
      const input=await freeze(label+':prepare',{requestId:requestId(label+':prepare'),connectionId,
        label:config.operation+' '+label,selection});
      const prepared=await call(method,input);
      need(prepared.value.phase==='PREPARED'||prepared.value.dispatchedAt,
        label+' native preparation did not complete: '+JSON.stringify(prepared.value.failure??prepared.value.summary));
      const first=await freeze(label+':original-prepared',reference(prepared));
      const original=prepared.value.dispatchedAt?first:reference(prepared);
      await retainReview(await call('getRecord',{kind,id:original.id,revision:original.revision}));
      return{record:prepared,original};
    }
    async function dispatch(label,kind,prepared){
      if(prepared.record.value.dispatchedAt){
        const input=Object.values(state.inputs).find(value=>value?.requestId===prepared.record.value.dispatchRequestId&&
          value.id===prepared.record.id);
        need(input,'Retain the original saved native dispatch input for '+label);
        const record=await current(prepared.record);await retainReview(record);return{record,input};
      }
      const previous=state.inputs[label+':dispatch'];
      const dispatchLabel=previous&&previous.expectedRevision!==prepared.original.revision?
        label+':dispatch:review:'+prepared.original.revision:label+':dispatch';
      const input=await freeze(dispatchLabel,{requestId:requestId(dispatchLabel),id:prepared.record.id,
        expectedRevision:prepared.original.revision,planSha256:prepared.record.value.planSha256});
      const record=await call('dispatch'+kind[0].toUpperCase()+kind.slice(1),input);
      need(!['STALE','PREPARE_FAILED','INVALID'].includes(record.value.state),
        label+' native dispatch rejected its prepared source: '+JSON.stringify(record.value.failure??record.value.summary));
      await retainReview(await current(record));return{record,input};
    }
    async function operation(label,kind,selection,connectionId=state.connectionRecordId){
      const prepared=await prepare(label,kind,selection,connectionId),dispatched=await dispatch(label,kind,prepared);
      if(dispatched.record.value.dispatchedAt&&['UNKNOWN','DISPATCHED','READBACK'].includes(dispatched.record.value.state)){
        const recoveryLabel=label+':reconcile:'+dispatched.record.revision;
        dispatched.record=await call('reconcileOperation',await freeze(recoveryLabel,
          {requestId:requestId(recoveryLabel),kind,id:dispatched.record.id}));
        await retainReview(await current(dispatched.record));
      }
      need(['CONFIRMED','ACCEPTED','OBSERVED'].includes(dispatched.record.value.state),
        label+' original native outcome is '+dispatched.record.value.state);
      return current(dispatched.record);
    }
    async function capture(label){
      const record=await call('capturePortfolio',await freeze(label+':capture',{
        requestId:requestId(label+':capture'),connectionId:state.connectionRecordId,label:config.operation+' '+label}));
      need(record.value.state==='CAPTURED','Complete original Flowable portfolio capture required: '+JSON.stringify(record.value.failure));
      return reference(record);
    }
    async function collection(portfolio,name){
      let offset=0,items=[];
      do{
        const value=await call('readPortfolio',{id:portfolio.id,revision:portfolio.revision,collection:name,offset,limit:17});
        need(value.complete===true,'The original '+name+' collection is incomplete.');
        items.push(...value.items);offset=value.nextOffset;
      }while(offset!==null);
      return items;
    }
    async function taskAt(processId,activityId,label){
      const portfolio=await capture(label),tasks=await collection(portfolio,'tasks');
      const selected=tasks.filter(task=>task.processInstanceId===processId&&task.taskDefinitionKey===activityId);
      need(selected.length===1,'Select exactly one original '+activityId+' task for process '+processId);
      return selected[0];
    }
    async function runTask(label,taskId,action,fields={}){
      return operation(label,'task',{action,taskId,bodyText:JSON.stringify({action,...fields})});
    }
    sender=await openHost('sender');
    const view=await call('view'),target=view.connections.find(item=>item.connection.id===connection.id);
    need(target&&target.credentialAvailable,'The original native Flowable credentials must be available to the engine transport.');
    state.connectionRecordId=target.id;state.sourceWorkspaceId=view.workspaceId;
    const dmnTarget=view.connections.find(item=>item.connection.id===dmnConnection.id);
    need(dmnTarget&&dmnTarget.credentialAvailable,'Use the original native DMN service and its actual host credentials.');
    state.dmnConnectionRecordId=dmnTarget.id;
    const cmmnTarget=view.connections.find(item=>item.connection.id===cmmnConnection.id);
    need(cmmnTarget&&cmmnTarget.credentialAvailable,'Use the original native CMMN service and its actual host credentials.');
    state.cmmnConnectionRecordId=cmmnTarget.id;await persist();
    const catalog=JSON.parse(await readFile(new URL('./examples/process-catalog.json',import.meta.url),'utf8'));
    need(catalog.families.length===3&&catalog.resources.length===6,'Use the complete original three-family process catalog.');
    const initial=await step('original-engine-and-empty-portfolio',async()=>{
      const portfolio=await capture('original engine');
      return{installedVersion:config.installedVersion,connection,workspaceId:view.workspaceId,portfolio};
    });
    const v1=await step('three-original-bpmn-release-families',async()=>{
      const definitions={};
      for(const family of catalog.families){
        const item=catalog.resources.find(item=>item.key===family.key&&item.version===1);
        const bytes=await readFile(new URL('./examples/'+item.filename,import.meta.url));
        const record=await operation(family.key+' deploy v1','release',{action:'deploy',
          deploymentName:config.operation+' '+family.name+' v1',deploymentKey:family.key,
          resource:{filename:item.filename,contentType:'application/xml',contentBase64:bytes.toString('base64')}});
        const after=await source(record.value.after),selected=after.definitions.filter(value=>value.key===family.key);
        need(selected.length===1&&selected[0].version===1,'The original first native definition version differs.');
        definitions[family.key]={...selected[0],release:reference(record)};
      }
      const portfolio=await capture('all original definitions');
      const resources=[];
      for(const family of catalog.families){
        const definition=await call('readDefinition',{portfolioId:portfolio.id,revision:portfolio.revision,
          definitionId:definitions[family.key].id});
        need(definition.resources.length>0,'The original deployed BPMN source must be retained.');
        for(const resource of definition.resources){
          if(resource.originalResource){
            resources.push(await sender.client.downloadSource(resource.originalResource,
              join(root,'downloads',family.key+'-'+resource.sha256+'-'+resource.filename),{signal}));
          }
        }
      }
      return{definitions,portfolio,resources};
    });
    const started=await step('native-business-cases-and-interrupted-start-recovery',async()=>{
      const cases={};
      for(const [index,family]of catalog.families.entries()){
        const businessKey=config.operation+'-'+['grant','customer','vendor'][index];
        const bodyText='{"processDefinitionId":'+JSON.stringify(v1.definitions[family.key].id)+
          ',"businessKey":'+JSON.stringify(businessKey)+',"name":'+JSON.stringify(family.name+' native receiving case')+
          ',"variables":[{"name":"caseNumber","type":"long","value":9223372036854775806},'+
          '{"name":"customer","type":"string","value":"Native receiving example"},{"name":"amount","type":"double","value":1248.75}]}';
        const label=family.key+' start v1',prepared=await prepare(label,'process',{action:'start',bodyText});
        if(index===0&&!state.lostResponse)armLoss=true;
        const dispatched=await dispatch(label,'process',prepared);let record=dispatched.record;
        if(index===0){
          need(state.lostResponse,'The original native process-start response must have been retained before interruption.');
          const startedCount=state.nativeRequests.filter(item=>item.method==='POST'&&item.path.endsWith('/runtime/process-instances')&&
            item.bodySha256===sha(bodyText)).length;
          await closeHost(sender);sender=null;sender=await openHost('sender');
          const same=await call('dispatchProcess',dispatched.input);
          const repeatedCount=state.nativeRequests.filter(item=>item.method==='POST'&&item.path.endsWith('/runtime/process-instances')&&
            item.bodySha256===sha(bodyText)).length;
          need(startedCount===1&&repeatedCount===1,'The original saved process start must be issued once across cold reopen.');
          record=await call('reconcileOperation',await freeze(label+':readback',{requestId:requestId(label+':readback'),
            kind:'process',id:same.id}));
          need(['CONFIRMED','OBSERVED','ACCEPTED'].includes(record.value.state),
            'The original started process must be recovered from current native engine state.');
          await retainReview(await current(record));
        }else need(['CONFIRMED','ACCEPTED'].includes(record.value.state),'The native process start must be accepted.');
        const portfolio=await capture(family.key+' started'),processes=await collection(portfolio,'processes');
        const selected=processes.filter(item=>item.businessKey===businessKey);
        need(selected.length===1,'Exactly one original native process must exist for the selected business key.');
        cases[family.key]={id:selected[0].id,businessKey,definitionId:selected[0].processDefinitionId,start:reference(record)};
      }
      return{cases,lostResponse:state.lostResponse};
    });
    await step('native-human-task-claim-unclaim-delegate-resolve',async()=>{
      const results=[];
      for(const [index,family]of catalog.families.entries()){
        const task=await taskAt(started.cases[family.key].id,'intake',family.key+' intake');
        results.push(reference(await runTask(family.key+' claim intake',task.id,'claim',{assignee:config.adminUserId})));
        if(index===1){
          results.push(reference(await runTask(family.key+' unclaim intake',task.id,'claim',{assignee:null})));
          results.push(reference(await runTask(family.key+' reclaim intake',task.id,'claim',{assignee:config.adminUserId})));
          results.push(reference(await runTask(family.key+' delegate intake',task.id,'delegate',{assignee:config.reviewerUserId})));
          const delegated=await taskAt(started.cases[family.key].id,'intake',family.key+' delegated intake');
          need(delegated.assignee===config.reviewerUserId&&String(delegated.delegationState).toLowerCase()==='pending',
            'The original delegated task must belong to the native reviewer.');
          results.push(reference(await runTask(family.key+' resolve intake',task.id,'resolve',
            {variables:[{name:'intakeReviewed',type:'boolean',value:true}]})));
          const resolved=await taskAt(started.cases[family.key].id,'intake',family.key+' resolved intake');
          need(resolved.assignee===config.adminUserId,'Resolution returns the original task to its owner.');
        }
        results.push(reference(await runTask(family.key+' complete intake',task.id,'complete',
          {variables:[{name:'intakeComplete',type:'boolean',value:true}]})));
        const review=await taskAt(started.cases[family.key].id,'review',family.key+' native review work');
        need(review.processInstanceId===started.cases[family.key].id,'Native intake must advance its original process to review.');
      }
      return{actions:results};
    });
    const v2=await step('three-second-native-process-releases',async()=>{
      const definitions={};
      for(const family of catalog.families){
        const item=catalog.resources.find(item=>item.key===family.key&&item.version===2),
          bytes=await readFile(new URL('./examples/'+item.filename,import.meta.url));
        const record=await operation(family.key+' deploy v2','release',{action:'deploy',
          deploymentName:config.operation+' '+family.name+' v2',deploymentKey:family.key,
          resource:{filename:item.filename,contentType:'application/xml',contentBase64:bytes.toString('base64')}});
        const after=await source(record.value.after),selected=after.definitions.filter(item=>item.key===family.key&&item.version===2);
        need(selected.length===1,'The original second native definition version differs.');
        definitions[family.key]={...selected[0],release:reference(record)};
      }return{definitions};
    });
    await step('two-native-validated-running-process-migrations',async()=>{
      const migrations=[];
      for(const key of ['sf_grant_review','sf_vendor_approval']){
        const bodyText=JSON.stringify({toProcessDefinitionId:v2.definitions[key].id,
          activityMappings:[{fromActivityId:'review',toActivityId:'review'}]});
        const record=await operation(key+' migrate review','migration',{action:'migrate',
          processInstanceId:started.cases[key].id,bodyText});
        const review=await call('readReview',{kind:'migration',id:record.id,revision:record.revision});
        need(review.validation?.ok&&Array.isArray(review.validation.json?.validationMessages)&&
          review.validation.json.validationMessages.length===0,'The original Flowable migration validator must accept the complete document.');
        const after=await source(record.value.after),native=after.processes.find(item=>item.id===started.cases[key].id);
        need(native?.processDefinitionId===v2.definitions[key].id,'The running process must use the actual target native definition.');
        migrations.push({processId:native.id,targetDefinition:native.processDefinitionId,operation:reference(record),bodyText});
      }
      const untouched=await capture('original version remains active'),processes=await collection(untouched,'processes');
      need(processes.find(item=>item.id===started.cases.sf_customer_onboarding.id)?.processDefinitionId===
        v1.definitions.sf_customer_onboarding.id,'The third running process must retain its selected first version.');
      return{migrations,unchangedProcess:started.cases.sf_customer_onboarding};
    });
    await step('native-final-work-and-versioned-completion',async()=>{
      const actions=[];
      for(const family of catalog.families){
        const selected=started.cases[family.key],review=await taskAt(selected.id,'review',family.key+' current review');
        actions.push(reference(await runTask(family.key+' claim review',review.id,'claim',{assignee:config.adminUserId})));
        actions.push(reference(await runTask(family.key+' complete review',review.id,'complete',
          {variables:[{name:'decision',type:'string',value:'approved'}]})));
        if(family.key==='sf_grant_review'){
          const final=await taskAt(selected.id,'finalize',family.key+' target version final work');
          actions.push(reference(await runTask(family.key+' complete final work',final.id,'complete',
            {variables:[{name:'awardReady',type:'boolean',value:true}]})));
        }
      }
      const portfolio=await capture('completed and current native work'),history=await collection(portfolio,'historicProcesses');
      for(const key of ['sf_grant_review','sf_customer_onboarding']){
        need(history.find(item=>item.id===started.cases[key].id)?.endTime,'The original process history must contain completed work.');
      }
      const task=await taskAt(started.cases.sf_vendor_approval.id,'finalize','vendor UI final task');
      return{actions,portfolio,vendorFinalTask:task};
    });
    const browserResult=await step('industrial-operator-browser-and-native-final-task',async()=>{
      need(config.playwrightModule&&config.chromiumExecutable,'Use the original installed Playwright and Chromium runtime.');
      const {chromium}=await import(pathToFileURL(resolve(config.playwrightModule)).href);
      browser=await chromium.launch({headless:true,executablePath:resolve(config.chromiumExecutable),args:['--no-sandbox']});
      const context=await browser.newContext({viewport:{width:1440,height:1000},deviceScaleFactor:1});
      const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(String(error)));
      await page.goto(sender.host.url,{waitUntil:'networkidle'});await page.locator('#busy').waitFor({state:'hidden'});
      need((await page.locator('#notice').getAttribute('data-level'))!=='error','The native browser workspace must open without an error.');
      const screenshots=[];
      for(const section of ['overview','definitions','migrations']){
        await page.locator('[data-page="'+section+'"]').click();
        const path=join(root,'screenshots',section+'.png');await page.screenshot({path,fullPage:true});screenshots.push(await hashFile(path));
      }
      const finalTask=state.steps['native-final-work-and-versioned-completion'].value.vendorFinalTask;
      await page.locator('[data-page="tasks"]').click();
      await page.locator('#task-form [name="taskId"]').fill(finalTask.id);
      await page.locator('#task-form [name="action"]').selectOption('complete');
      await page.locator('#task-form [name="label"]').fill(config.operation+' vendor browser completion');
      await page.locator('#task-form [name="bodyText"]').fill('{"action":"complete","variables":[{"name":"vendorReady","type":"boolean","value":true}]}');
      // Recover an already submitted browser action from its original saved records after native interruption.
      const existing=(await call('listRecords',{kind:'task',limit:500})).items
        .find(item=>item.label===config.operation+' vendor browser completion');
      if(existing){
        const old=await call('getRecord',{kind:'task',id:existing.id});
        if(old.value.dispatchedAt&&old.value.state==='UNKNOWN'){
          await call('reconcileOperation',await freeze('vendor-browser:reconcile',{
            requestId:requestId('vendor-browser:reconcile'),kind:'task',id:old.id}));
        }
        const buttons=page.locator('#task-records tbody tr').filter({hasText:config.operation+' vendor browser completion'}).getByRole('button',{name:'Review'});
        await buttons.first().click();await page.locator('#busy').waitFor({state:'hidden'});
      }else{
        await page.locator('#task-form button[type="submit"]').click();
        await page.locator('#busy').waitFor({state:'hidden'});
      }
      const execute=page.locator('#detail-content').getByRole('button',{name:'Execute task action',exact:true});
      if(await execute.count()){await execute.click();await page.locator('#busy').waitFor({state:'hidden'});}
      need((await page.locator('#notice').getAttribute('data-level'))!=='error','The actual browser task action must complete.');
      const path=join(root,'screenshots','native-task-completion.png');
      await page.screenshot({path,fullPage:true});screenshots.push(await hashFile(path));
      const version=browser.version();await context.close();await browser.close();browser=null;
      need(errors.length===0,'The complete operator browser produced a script error: '+errors.join('\n'));
      const portfolio=await capture('all completed native processes'),history=await collection(portfolio,'historicProcesses'),
        tasks=await collection(portfolio,'tasks');
      need(history.find(item=>item.id===started.cases.sf_vendor_approval.id)?.endTime,
        'The browser must complete the original migrated vendor process.');
      need(!tasks.some(item=>Object.values(started.cases).some(value=>value.id===item.processInstanceId)),
        'All three original native process cases must complete their human work.');
      return{browserVersion:version,screenshots,portfolio,completedProcessIds:Object.values(started.cases).map(item=>item.id)};
    });
    const decisions=await runFlowableDmnNativeJourney({configuration:config,directory:root,
      connectionId:state.dmnConnectionRecordId,call,source,operation,prepare,dispatch,retainReview,
      step,freeze,requestId,client:sender.client,browserUrl:sender.host.url,signal});
    const cases=await runFlowableCmmnNativeJourney({configuration:config,directory:root,
      connectionId:state.cmmnConnectionRecordId,call,source,operation,prepare,dispatch,retainReview,
      step,freeze,requestId,client:sender.client,browserUrl:sender.host.url,signal});
    need(cases?.state==='PASSED'&&cases.continuation?.connectionId===state.cmmnConnectionRecordId&&
      typeof cases.continuation.caseInstanceId==='string'&&typeof cases.continuation.taskId==='string',
      'Complete all original CMMN families and retain the exact active native task for installed customer continuation.');
    const complete=await step('complete-native-process-history-export-and-cold-receiving',async()=>{
      const finalPortfolio=await capture('complete original process history'),variables=await collection(finalPortfolio,'historicVariables');
      need(variables.some(item=>item.variable?.name==='caseNumber'||item.name==='caseNumber'),
        'The original full native variable history must be captured.');
      const portfolioRecord=await call('getRecord',{kind:'portfolio',id:finalPortfolio.id,revision:finalPortfolio.revision});
      const inventory=await source(portfolioRecord.value.inventory);
      let originalLong=false;
      for(const page of inventory.collections.historicVariables.pages??[]){
        const exchange=page.bodyRef?await source(page.bodyRef):page;
        if(String(exchange.bodyText??'').includes('9223372036854775806'))originalLong=true;
      }
      for(const item of inventory.collections.historicVariables.exchanges??[]){
        const exchange=item.bodyRef?await source(item.bodyRef):item;
        if(String(exchange.bodyText??'').includes('9223372036854775806'))originalLong=true;
      }
      need(originalLong,'The original native long value must remain exact in retained engine response bytes.');
      const first=await call('exportWorkspace',await freeze('first-complete-export',{
        requestId:requestId('first-complete-export'),label:config.operation+' complete native process history'}));
      const firstDownload=await sender.client.downloadDelivery(first.id,join(root,'downloads','flowable-first-complete.ndjson'),{signal});
      await closeHost(sender);sender=null;sender=await openHost('sender');
      const originalAgain=await sender.client.downloadDelivery(first.id,join(root,'downloads','flowable-first-complete-reopened.ndjson'),{signal});
      need(firstDownload.sha256===originalAgain.sha256&&firstDownload.bytes===originalAgain.bytes,
        'A cold reopened complete export must preserve every original byte.');
      receiver=await openHost('receiver');
      const inspection=await receiver.client.inspectFile(firstDownload.path,await freeze('first-receiving-inspect',{
        requestId:requestId('first-receiving-inspect'),label:'Original Flowable complete receiving'}));
      const adoption=await receiver.client.action('adoptDelivery',await freeze('first-receiving-adopt',{
        requestId:requestId('first-receiving-adopt'),id:inspection.id,expectedRevision:inspection.revision,
        manifestSha256:inspection.value.manifestSha256}));
      need(adoption.value.state==='ADOPTED','The complete native history must be adopted by the original receiving workspace.');
      await closeHost(receiver);receiver=null;receiver=await openHost('receiver');
      for(const kind of ['connection','portfolio','release','process','task','migration','decisionPortfolio','decisionRelease','decisionEvaluation',
        'casePortfolio','caseRelease','caseInstance','casePlanItem','caseTask']){
        let offset=0,total=0;
        do{
          const original=await call('listRecords',{kind,offset,limit:37});
          for(const record of original.items){
            const received=await receiver.client.action('getRecord',{kind,id:record.id,revision:record.revision});
            need(received.sha256===record.sha256,'Cold receiving changed a complete saved original '+kind+' revision.');
          }
          total+=original.items.length;offset=original.nextOffset;
        }while(offset!==null);
        need(total>0,'The complete workspace must retain '+kind+' history.');
      }
      const secondCapture=await capture('post-reopen complete native portfolio');
      const second=await call('exportWorkspace',await freeze('second-complete-export',{
        requestId:requestId('second-complete-export'),label:config.operation+' later complete native process history'}));
      const laterDownload=await sender.client.downloadDelivery(second.id,join(root,'downloads','flowable-second-complete.ndjson'),{signal});
      const laterInspection=await receiver.client.inspectFile(laterDownload.path,await freeze('later-receiving-inspect',{
        requestId:requestId('later-receiving-inspect'),label:'Later original Flowable complete receiving'}));
      const laterReceiving=await receiver.client.action('adoptDelivery',await freeze('later-receiving-adopt',{
        requestId:requestId('later-receiving-adopt'),id:laterInspection.id,expectedRevision:laterInspection.revision,
        manifestSha256:laterInspection.value.manifestSha256}));
      need(laterReceiving.value.state==='ADOPTED','The second complete original workspace edition must be received.');
      await closeHost(receiver);receiver=null;receiver=await openHost('receiver');
      const receivedCapture=await receiver.client.action('getRecord',{kind:'portfolio',id:secondCapture.id,revision:secondCapture.revision});
      need(receivedCapture.sha256===secondCapture.sha256,'The later complete receiving must survive cold reopen.');
      return{first:reference(first),firstDownload,originalAgain,firstReceiving:reference(adoption),
        second:reference(second),laterDownload,laterReceiving:reference(laterReceiving),secondCapture,
        receiverWorkspaceId:receiver.host.workspaceId,originalLongExact:originalLong};
    });
    await closeHost(sender);sender=null;await closeHost(receiver);receiver=null;
    const installed=await step('installed-product-cli-client-applications-and-mcp-receiving',async()=>{
      const {runInstalledFlowableJourney}=await import('../../../../products/flowable-merchant/native-installed-journey.mjs');
      return runInstalledFlowableJourney({directory:join(root,'installed-product'),configuration:config,
        sourceWorkspaceDirectory:join(root,'sender'),sourceDelivery:{...complete.laterDownload,record:complete.second,
          receiving:complete.laterReceiving},reviewerUserId:config.reviewerUserId,caseContinuation:cases.continuation,signal});
    });
    need(installed?.state==='PASSED'&&installed.completeWorkspace?.delivery?.kind==='delivery'&&
      installed.completeWorkspace?.receiving?.kind==='receiving'&&installed.completeWorkspace?.file?.bytes>0,
      'The actual installed client, CLI, Applications and MCP receiving must complete with its final whole workspace.');
    const installedWorkspace=await hashFile(installed.completeWorkspace.file.path);
    need(installedWorkspace.bytes===installed.completeWorkspace.file.bytes&&
      installedWorkspace.sha256===installed.completeWorkspace.file.sha256,
      'The final installed customer workspace bytes must match their original receiving receipt.');
    if(browser){await browser.close();browser=null;}
    await persistTail;
    state.state='PASSED';state.completedAt??=new Date().toISOString();state.currentPhase=null;
    state.result={installedVersion:config.installedVersion,sourceRevision:config.sourceRevision,
      processFamilies:3,releaseVersions:6,completedProcesses:browserResult.completedProcessIds,
      nativeMutations:state.nativeRequests.filter(item=>['POST','PUT','DELETE'].includes(item.method)&&
        !item.path.endsWith('/validate-migration')).length,workspace:installedWorkspace,
      commissionedWorkspace:complete.laterDownload,browser:browserResult,decisions,cases,installed};await persist();
    return{schema:SCHEMA,state:state.state,scope:SCOPE,operation:config.operation,
      sourceRevision:config.sourceRevision,result:state.result,stateFile:await hashFile(statePath)};
  }catch(error){
    terminalError=error;
    if(state){
      state.state='INTERRUPTED';state.failure={code:error.code??'FLOWABLE_NATIVE_JOURNEY_FAILED',
        message:error.message,at:new Date().toISOString()};
      await atomicJSON(statePath,state).catch(()=>{});
    }
    throw error;
  }finally{
    const failures=[];
    for(const value of [sender,receiver])if(value){
      try{await value.client.close();await value.host.close();}catch(error){failures.push(error);}
    }
    if(browser)try{await browser.close();}catch(error){failures.push(error);}
    try{await persistTail;}catch(error){failures.push(error);}
    await lease.close();
    if(!terminalError&&failures.length)throw failures[0];
  }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [configPath,directory]=process.argv.slice(2);
  runFlowableNativeJourney(configPath,directory).then(result=>process.stdout.write(JSON.stringify(result)+'\n'))
    .catch(error=>{process.stderr.write(JSON.stringify({error:error.code??'FLOWABLE_NATIVE_JOURNEY_FAILED',message:error.message})+'\n');process.exitCode=1;});
}
