// MIT. Complete customer commissioning over the original managed Ruby operations.
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openRubyRuntime } from '../model.mjs';
import { absolute, need, plain, directory, exists, readJSON, regular, json, digest, hashObject,
  id, label, sha, operationId, operationLease, once, openSnapshot, member, now } from '../files.mjs';
import { sourceKind, intent, fieldKeys, checkoutRef, selectedQuery, prepareSource, previewSource,
  previewExisting, originalInput, originalArguments, originalEntry, applicationDirectory,
  matchesOriginalArguments, readResult, outputDirectory, separated, executable, sourceDirectory, equal } from './source.mjs';

export const CUSTOMER_SCHEMA='stellar-forge.ruby-customer-selection.v1';
export const WORKSPACE_SCHEMA='stellar-forge.ruby-customer-workspace.v1';
const REQUEST_SCHEMA='stellar-forge.ruby-customer-request.v1';
const SELECT_KEYS=['id','title','requestId','environmentId','kind','sourceDirectory','expectedSourceSha256',
  'outputDirectory','checkout','python','node','datasetId','sourceKey','keys','customerKey','sourceRef','query',
  'applicationId','operationId','registrationId'];
const ADOPT_KEYS=['id','title','requestId','environmentId','outputDirectory','expectedInputSha256',
  'applicationId','operationId','registrationId'];
const TERMINAL=new Set(['FAILED','CANCELLED','INTERRUPTED']);

function object(value,allowed) {
  need(plain(value) && Object.keys(value).every(key=>allowed.includes(key)), 'RUBY_CUSTOMER_INPUT');
}
function common(value) {
  const result={id:id(value.id),title:label(value.title),requestId:operationId(value.requestId),
    environmentId:id(value.environmentId),outputDirectory:absolute(value.outputDirectory)};
  for(const key of ['applicationId','operationId','registrationId'])
    if(value[key]!==undefined)result[key]=key==='applicationId'?id(value[key]):operationId(value[key]);
  return result;
}
function normalizedSelect(input) {
  object(input,SELECT_KEYS);
  const base=common(input),kind=sourceKind(input.kind);
  const selected={kind,sourceDirectory:absolute(input.sourceDirectory),expectedSourceSha256:sha(input.expectedSourceSha256),
    outputDirectory:base.outputDirectory,checkout:absolute(input.checkout),python:absolute(input.python),node:absolute(input.node)};
  if(kind==='native') {
    need(['customerKey','sourceRef','query'].every(key=>input[key]===undefined),'RUBY_CUSTOMER_SOURCE_OPTIONS');
    Object.assign(selected,{sourceKey:intent(input.sourceKey),datasetId:intent(input.datasetId),keys:fieldKeys(input.keys??[])});
  } else {
    need(input.sourceKey===undefined && input.keys===undefined,'RUBY_CUSTOMER_SOURCE_OPTIONS');
    Object.assign(selected,{customerKey:intent(input.customerKey),datasetId:intent(input.datasetId),
      sourceRef:checkoutRef(input.sourceRef),query:selectedQuery(input.query)});
  }
  return {...base,mode:'select',selected};
}
function normalizedAdopt(input) {
  object(input,ADOPT_KEYS);
  return {...common(input),mode:'adopt',expectedInputSha256:sha(input.expectedInputSha256)};
}
async function exclusive(path,fn) {
  const lease=await operationLease(path);
  try{return await fn();}finally{await lease.close();}
}
function validPage(value,fallback,max) {
  value ??=fallback;
  need(Number.isSafeInteger(value) && value>=0 && value<=max,'RUBY_CUSTOMER_PAGE');
  return value;
}
function checkedRequest(value) {
  need(value?.schema===REQUEST_SCHEMA && plain(value.request) &&
    value.requestSha256===hashObject(value.request),'RUBY_CUSTOMER_REQUEST_CHANGED',undefined,409);
  return value;
}

export async function openRubyCustomerWorkspace({directory:root,create=false} = {}) {
  const core=await openRubyRuntime({directory:root,create});
  root=core.directory;
  let closed=false;
  const pending=new Set();
  const call=fn=>async(...args)=>{
    need(!closed,'RUBY_CUSTOMER_WORKSPACE_CLOSED',undefined,409);
    const task=Promise.resolve().then(()=>fn(...args));pending.add(task);
    try{return await task;}finally{pending.delete(task);}
  };
  const base=join(root,'customers'),records=join(base,'records');
  try {await directory(base,true);await directory(records,true);}
  catch(error){await core.close();throw error;}
  const recordPath=value=>join(records,id(value));
  async function selection(value) {
    const path=recordPath(value),record=await readJSON(join(path,'selection.json'));
    need(record?.schema===CUSTOMER_SCHEMA && record.id===value,'RUBY_CUSTOMER_SELECTION_CHANGED',undefined,409);
    const {sha256,...body}=record;
    need(hashObject(body)===sha256 && plain(record.selected) && record.applicationDirectory===applicationDirectory(record.selected),
      'RUBY_CUSTOMER_SELECTION_CHANGED',undefined,409);
    const request=checkedRequest(await readJSON(join(path,'request.json')));
    need(record.requestSha256===request.requestSha256 && request.request.id===value &&
      record.requestId===request.request.requestId,'RUBY_CUSTOMER_SELECTION_CHANGED',undefined,409);
    for(const item of record.files) {
      member(item.name);
      const bytes=await regular(join(path,item.name),Math.max(item.bytes,1));
      need(bytes.length===item.bytes && digest(bytes)===item.sha256,'RUBY_CUSTOMER_METADATA_CHANGED',undefined,409);
    }
    return record;
  }
  async function operation(key) {
    if(!await exists(join(root,'operations',operationId(key),'request.json')))return null;
    return core.operation({operationId:key});
  }
  async function nativeRequest(key) {
    const path=join(root,'operations',operationId(key),'request.json');
    if(!await exists(path))return null;
    const value=await readJSON(path),{sha256,...body}=value;
    need(value.schema==='stellar-forge.ruby-operation.v1' && value.id===key &&
      hashObject(body)===sha256,'RUBY_CUSTOMER_OPERATION_CHANGED',undefined,409);
    return value;
  }
  async function environment(value) {
    const state=await core.inspect(),found=state.environments.find(item=>item.id===value);
    need(found,'RUBY_CUSTOMER_ENVIRONMENT_REQUIRED','Select an existing managed Ruby environment.');
    return found;
  }
  async function existingOperation(selected,environmentId,requested) {
    const entry=originalEntry(selected);
    if(requested) {
      const old=await nativeRequest(requested);
      if(!old)return {id:requested,entry,argv:originalArguments(selected),adopted:false};
      need(old.environmentId===environmentId && old.action==='customer-command' &&
        old.parameters?.entry===entry && matchesOriginalArguments(entry,old.parameters.argv,selected,{allowReopen:true}),
        'RUBY_CUSTOMER_OPERATION_CHANGED','This operation belongs to different original customer inputs.',409);
      return {id:requested,entry,argv:old.parameters.argv,adopted:true};
    }
    const matches=[];
    for(const key of await readdir(join(root,'operations'))) {
      if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(key))continue;
      const old=await nativeRequest(key);
      if(old && old.environmentId===environmentId && old.action==='customer-command' &&
        old.parameters?.entry===entry && matchesOriginalArguments(entry,old.parameters.argv,selected))
        matches.push({id:key,entry,argv:old.parameters.argv,adopted:true});
    }
    need(matches.length<=1,'RUBY_CUSTOMER_OPERATION_SELECTION',
      'Select the existing original operation UUID: '+matches.map(item=>item.id).join(', '),409);
    return matches[0]??{id:randomUUID(),entry,argv:originalArguments(selected),adopted:false};
  }
  async function existingApplication(selected,env,request) {
    const expected=applicationDirectory(selected),state=await core.inspect();
    const matches=state.applications.filter(app=>app.environmentId===env.id && app.source?.originalDirectory===expected);
    let app;
    if(request.applicationId)app=state.applications.find(item=>item.id===request.applicationId);
    else {
      need(matches.length<=1,'RUBY_CUSTOMER_APPLICATION_SELECTION',
        'Select the registered original application ID: '+matches.map(item=>item.id).join(', '),409);
      app=matches[0];
    }
    if(app) {
      need(app.environmentId===env.id && app.source.originalDirectory===expected,
        'RUBY_CUSTOMER_APPLICATION_CHANGED',undefined,409);
      const saved=await readJSON(join(root,'applications',app.id,'application.json'));
      need(saved.environmentSelectionSha256===env.selectionSha256 &&
        (!request.registrationId || saved.requestId===request.registrationId),
        'RUBY_CUSTOMER_APPLICATION_CHANGED',undefined,409);
      return {id:app.id,title:app.title,registrationId:operationId(saved.requestId),adopted:true};
    }
    const appId=request.applicationId??request.id;
    need(!state.applications.some(item=>item.id===appId),'RUBY_CUSTOMER_APPLICATION_SELECTION',
      'Choose an unused application ID or select the existing original application.',409);
    const key=request.registrationId??randomUUID(),old=await nativeRequest(key);
    need(!old,'RUBY_CUSTOMER_REGISTRATION_OPERATION_USED','Select the registered original application ID.',409);
    return {id:appId,title:request.title,registrationId:key,adopted:false};
  }
  async function compatibleRuntime(record) {
    const current=await environment(record.environment.id);
    need(current.selectionSha256===record.environment.selectionSha256,
      'RUBY_CUSTOMER_ENVIRONMENT_CHANGED','Use the selected original private Ruby environment.',409);
    return current;
  }
  async function initial(request) {
    const path=recordPath(request.id);
    if(!await exists(join(path,'request.json')))return null;
    const old=checkedRequest(await readJSON(join(path,'request.json')));
    need(equal(old.request,request),'RUBY_CUSTOMER_REQUEST_CHANGED',
      'Continue this customer with the original selected inputs, or use a new customer ID.',409);
    if(await exists(join(path,'selection.json')))return customer({id:request.id});
    return null;
  }
  async function retain(request) {
    return exclusive(join(base,'admission.lock'),async()=>{
      const prior=await initial(request);if(prior)return prior;
      for(const other of await readdir(records)) {
        if(other===request.id || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(other))continue;
        const previous=await readJSON(join(recordPath(other),'request.json'),true);
        if(!previous)continue;
        const old=checkedRequest(previous).request;
        need(old.outputDirectory!==request.outputDirectory,'RUBY_CUSTOMER_OUTPUT_ALREADY_SELECTED',
          'Open customer '+other+' to continue this original output.',409);
      }
      await outputDirectory(request.outputDirectory);
      let selected,source,metadata,original=null;
      if(request.mode==='adopt') {
        original=await originalInput(request.outputDirectory);
        need(original.descriptor.sha256===request.expectedInputSha256,'RUBY_CUSTOMER_ORIGINAL_INPUT_CHANGED',undefined,409);
        selected=original.selected;
        const result=await readResult(selected,{optional:true});
        source={schema:'stellar-forge.ruby-customer-source.v1',kind:selected.kind,directory:selected.sourceDirectory,
          manifest:{name:selected.kind==='native'?'manifest.json':'native-result.json',sha256:selected.expectedSourceSha256},
          summary:result?{rows:result.rows,fields:result.fields,membership:result.original.membership,
            application:result.application}:null,originalInput:original.descriptor};
        metadata=[{name:'original-input.json',raw:original.raw,bytes:original.raw.length,sha256:original.descriptor.sha256}];
      } else {
        selected=request.selected;
        const prepared=await prepareSource({kind:selected.kind,directory:selected.sourceDirectory,
          expectedSha256:selected.expectedSourceSha256});
        source={...prepared.view};delete source.metadata;
        metadata=prepared.metadata.map(item=>({...item,name:'source/'+item.name}));
        separated(selected.sourceDirectory,selected.outputDirectory);
        separated(selected.checkout,selected.outputDirectory);
        await sourceDirectory(selected.checkout);
        await executable(selected.python);await executable(selected.node);
        if(selected.kind==='native') {
          const keys=selected.keys.length?selected.keys:source.summary.suggestedKeys;
          need(keys.length>0 && keys.every(key=>source.summary.fields.includes(key)),
            'RUBY_CUSTOMER_ORIGINAL_KEYS_REQUIRED','Choose the original stable key field(s), or retain a complete native primary key.');
        }
        if(await exists(join(selected.outputDirectory,'lifecycle-input.json'))) {
          original=await originalInput(selected.outputDirectory);
          need(equal(original.selected,selected),'RUBY_CUSTOMER_ORIGINAL_INPUT_CHANGED',
            'Open the existing customer output with its original lifecycle inputs.',409);
          metadata.push({name:'original-input.json',raw:original.raw,bytes:original.raw.length,sha256:original.descriptor.sha256});
        }
      }
      separated(root,selected.outputDirectory);
      const env=await environment(request.environmentId);
      const native=await existingOperation(selected,env.id,request.operationId);
      if(selected.kind==='baserow' && native.argv.includes('--expected-original-result-sha256')) {
        const source=await regular(join(env.directory,'client','baserow','customer','lifecycle.rb'),1048576);
        need(source.toString('utf8').includes('EXPECTED_SOURCE_OPTION = "--expected-original-result-sha256"'),
          'RUBY_CUSTOMER_SOURCE_PIN_CLIENT_REQUIRED',
          'Create a Ruby environment from the current customer source; this saved environment retains its original client.');
      }
      const app=await existingApplication(selected,env,request);
      need(native.id!==app.registrationId,'RUBY_CUSTOMER_OPERATION_IDS_DISTINCT');
      const path=await directory(recordPath(request.id),true);
      const requestRecord={schema:REQUEST_SCHEMA,request,requestSha256:hashObject(request)};
      await once(join(path,'request.json'),json(requestRecord));
      await directory(join(path,'source'),true);
      const files=[];
      for(const item of metadata) {
        const name=member(item.name);
        await once(join(path,name),item.raw);
        files.push({name,bytes:item.bytes,sha256:item.sha256});
      }
      const body={schema:CUSTOMER_SCHEMA,id:request.id,title:request.title,requestId:request.requestId,
        requestSha256:requestRecord.requestSha256,createdAt:now(),selected,source,
        environment:{id:env.id,selectionSha256:env.selectionSha256},
        customerOperation:native,application:{...app,directory:applicationDirectory(selected)},
        applicationDirectory:applicationDirectory(selected),files};
      await once(join(path,'selection.json'),json({...body,sha256:hashObject(body)}));
      return customer({id:request.id});
    });
  }
  async function selectCustomer(input) {return retain(normalizedSelect(input));}
  async function adoptCustomer(input) {return retain(normalizedAdopt(input));}
  async function customer({id:value} = {}) {
    const path=recordPath(value);
    if(!await exists(join(path,'selection.json'))) {
      const request=checkedRequest(await readJSON(join(path,'request.json')));
      return {schema:'stellar-forge.ruby-customer.v1',id:value,title:request.request.title,phase:'SELECTING',
        request:request.request,requestSha256:request.requestSha256,
        message:'Repeat the retained selection to finish source registration.'};
    }
    const record=await selection(value);
    const [native,registration]=await Promise.all([operation(record.customerOperation.id),operation(record.application.registrationId)]);
    let app=null;
    if(await exists(join(root,'applications',record.application.id,'application.json')))
      app=await core.application({id:record.application.id});
    const receipt=await readJSON(join(path,'commissioned.json'),true);
    if(receipt)need(receipt.selectionSha256===record.sha256 &&
      receipt.customerOperationId===record.customerOperation.id &&
      receipt.registrationId===record.application.registrationId,'RUBY_CUSTOMER_COMPLETION_CHANGED',undefined,409);
    let phase='SELECTED';
    if(native)phase=native.phase==='SUCCEEDED'&&!native.active?'CUSTOMER_COMPLETE':
      TERMINAL.has(native.phase)&&!native.active?'CUSTOMER_NEEDS_RESUME':'COMMISSIONING';
    if(native?.phase==='SUCCEEDED' && !native.active && registration)phase=registration.phase==='SUCCEEDED'&&!registration.active?(receipt?'READY':'FINALIZING'):
      TERMINAL.has(registration.phase)&&!registration.active?'REGISTRATION_NEEDS_RESUME':'REGISTERING';
    return {schema:'stellar-forge.ruby-customer.v1',id:record.id,title:record.title,phase,
      selectionSha256:record.sha256,requestId:record.requestId,createdAt:record.createdAt,
      source:record.source,selected:record.selected,environment:record.environment,
      customerOperation:native,customerOperationId:record.customerOperation.id,
      entry:record.customerOperation.entry,argv:record.customerOperation.argv,
      registrationOperation:registration,registrationId:record.application.registrationId,
      applicationId:record.application.id,applicationDirectory:record.applicationDirectory,application:app,
      result:receipt?.result??null,files:record.files};
  }
  async function customers({offset=0,limit=25} = {}) {
    offset=validPage(offset,0,Number.MAX_SAFE_INTEGER);limit=validPage(limit,25,100);
    need(limit>0,'RUBY_CUSTOMER_PAGE');
    const names=[];
    for(const name of (await readdir(records)).sort()) {
      if(/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(name) && await exists(join(recordPath(name),'request.json')))names.push(name);
    }
    const values=[];
    for(const name of names.slice(offset,offset+limit))values.push(await customer({id:name}));
    return {schema:'stellar-forge.ruby-customers.v1',offset,total:names.length,
      nextOffset:offset+values.length<names.length?offset+values.length:null,customers:values};
  }
  async function guard(input) {
    object(input,['id','expectedSelectionSha256','phase']);
    const record=await selection(id(input.id));
    need(record.sha256===sha(input.expectedSelectionSha256),'RUBY_CUSTOMER_SELECTION_CHANGED',undefined,409);
    await compatibleRuntime(record);
    return record;
  }
  async function advanceCustomer(input) {
    const record=await guard(input),value=record.id;
    return exclusive(join(recordPath(value),'advance.lock'),async()=>{
      let native=await operation(record.customerOperation.id);
      if(!native) {
        const completed=await readResult(record.selected,{optional:true});
        if(!completed) {
          await prepareSource({kind:record.selected.kind,directory:record.selected.sourceDirectory,
            expectedSha256:record.selected.expectedSourceSha256});
          await sourceDirectory(record.selected.checkout);
          await executable(record.selected.python);await executable(record.selected.node);
        }
        native=await core.run({id:record.environment.id,operationId:record.customerOperation.id,
          entry:record.customerOperation.entry,argv:record.customerOperation.argv});
      } else {
        const request=await nativeRequest(native.id);
        need(request.environmentId===record.environment.id && request.action==='customer-command' &&
          request.parameters?.entry===record.customerOperation.entry &&
          equal(request.parameters.argv,record.customerOperation.argv),'RUBY_CUSTOMER_OPERATION_CHANGED',undefined,409);
        if(native.phase==='QUEUED' && !native.active)
          native=await core.run({id:record.environment.id,operationId:record.customerOperation.id,
            entry:record.customerOperation.entry,argv:record.customerOperation.argv});
      }
      if(native.active || native.phase!=='SUCCEEDED')return customer({id:value});
      const result=await readResult(record.selected);
      const app=record.application;
      let registration=await operation(app.registrationId);
      if(!registration || registration.phase==='QUEUED' && !registration.active) {
        await core.registerApplication({id:app.id,title:app.title,environmentId:record.environment.id,
          directory:record.applicationDirectory,requestId:app.registrationId});
        registration=await operation(app.registrationId);
      }
      if(registration?.phase==='SUCCEEDED' && !registration.active) {
        const actual=await core.application({id:app.id});
        need(actual.environmentId===record.environment.id &&
          actual.source.originalDirectory===record.applicationDirectory &&
          actual.source.manifest.sha256===result.application.manifest.sha256,
          'RUBY_CUSTOMER_APPLICATION_CHANGED',undefined,409);
        const receipt={schema:'stellar-forge.ruby-customer-commissioned.v1',selectionSha256:record.sha256,
          customerOperationId:record.customerOperation.id,registrationId:app.registrationId,
          applicationId:app.id,applicationSelectionSha256:actual.selectionSha256,
          result:{file:result.file,input:result.input,rows:result.rows,fields:result.fields,
            application:result.application}};
        await once(join(recordPath(value),'commissioned.json'),json(receipt));
      }
      return customer({id:value});
    });
  }
  async function control(input,action) {
    const record=await guard(input);
    need(input.phase==='customer'||input.phase==='registration','RUBY_CUSTOMER_PHASE');
    const key=input.phase==='customer'?record.customerOperation.id:record.application.registrationId;
    need(await operation(key),'RUBY_CUSTOMER_OPERATION_NOT_STARTED');
    await core[action]({operationId:key});
    return customer({id:record.id});
  }
  async function openCustomerFile({id:value,name} = {}) {
    const record=await selection(id(value)),path=recordPath(value);
    member(name);
    let descriptor,source;
    if(name==='selection.json') {
      const raw=await regular(join(path,name),16*1024*1024);
      descriptor={name,bytes:raw.length,sha256:digest(raw)};source=join(path,name);
    } else if(name==='result.json') {
      const saved=await readJSON(join(path,'commissioned.json'));
      need(saved.selectionSha256===record.sha256,'RUBY_CUSTOMER_COMPLETION_CHANGED');
      const original=await readResult(record.selected);
      need(equal(saved.result.file,original.file),'RUBY_CUSTOMER_RESULT_CHANGED',undefined,409);
      descriptor={...original.file,name:'result.json'};source=join(record.selected.outputDirectory,original.file.name);
    } else {
      descriptor=record.files.find(item=>item.name===name);
      need(descriptor,'RUBY_CUSTOMER_FILE_UNKNOWN',undefined,404);source=join(path,descriptor.name);
    }
    const handle=await openSnapshot(source,descriptor,path);
    return {handle,bytes:descriptor.bytes,sha256:descriptor.sha256,name,
      type:'application/json'};
  }
  const result={directory:root,
    inspect:call(async()=>({...(await core.inspect()),schema:WORKSPACE_SCHEMA,customers:await customers()})),
    previewSource:call(previewSource),previewExisting:call(previewExisting),
    selectCustomer:call(selectCustomer),adoptCustomer:call(adoptCustomer),customer:call(customer),customers:call(customers),
    advanceCustomer:call(advanceCustomer),resumeCustomer:call(input=>control(input,'resume')),
    cancelCustomer:call(input=>control(input,'cancel')),openCustomerFile:call(openCustomerFile),
    async close(){closed=true;await Promise.allSettled([...pending]);await core.close();}};
  for(const [key,fn]of Object.entries(core))
    if(typeof fn==='function' && key!=='close' && key!=='inspect')result[key]=call((...args)=>fn(...args));
  return result;
}
