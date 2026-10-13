// MIT. Commission the original live Monitoring Application through Runtime configuration history.
import { constants } from 'node:fs';
import { open, lstat, realpath } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { MonitoringClient } from './client.mjs';
import { openRuntimeWorkspace } from '../../stellar/scf-starforge-20261009/distribution/runtime-workspace/model.mjs';
import { canonical, digest, json, need, plain, absolute, recordId, operationId,
  privateDirectory, regular, readJSON, saveJSON, operationLease } from '../../stellar/scf-starforge-20261009/distribution/runtime-workspace/storage.mjs';
import { readSourceMonitoringConfiguration, validateSourceMonitoringConfiguration } from './merchant.mjs';
import { readMerchantConfig } from '../../stellar-forge/mcp-merchant-operator/config.mjs';

export const CUSTOMER_SETUP_SCHEMA = 'stellar-forge.source-monitoring-customer-setup.v1';
export const CUSTOMER_PLAN_SCHEMA = 'stellar-forge.source-monitoring-customer-plan.v1';
const CONFIG_SCHEMA = 'stellar-forge.source-monitoring-workspaces.v1';
const HASH = /^[a-f0-9]{64}$/;
const MAX = 20000;
const hash = value => digest(json(canonical(value)));
const freeze = value => JSON.parse(JSON.stringify(value));
const equal = (a,b) => hash(a) === hash(b);
const uuid = value => {
  const h=hash(value); return h.slice(0,8)+'-'+h.slice(8,12)+'-4'+h.slice(13,16)+'-a'+h.slice(17,20)+'-'+h.slice(20,32);
};
function name(value) {
  need(typeof value==='string' && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(value), 'MONITORING_SETUP_ALIAS');
  return value;
}
function filename(value) {
  need(typeof value==='string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.json$/.test(value), 'MONITORING_SETUP_FILENAME');
  return value;
}
async function privateFile(path, maximum=MAX) {
  absolute(path); await privateDirectory(dirname(path));
  const before=await lstat(path);
  need(before.isFile()&&!before.isSymbolicLink()&&before.size<=maximum,'MONITORING_SETUP_PRIVATE_FILE');
  const h=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try {
    const st=await h.stat(), named=await lstat(path);
    need(before.dev===st.dev&&before.ino===st.ino&&before.size===st.size&&before.mtimeMs===st.mtimeMs&&before.ctimeMs===st.ctimeMs,
      'MONITORING_SETUP_FILE_CHANGED');
    need(st.isFile() && st.nlink===1 && !(st.mode&0o077) &&
      (process.getuid===undefined || st.uid===process.getuid()) && st.dev===named.dev && st.ino===named.ino &&
      st.size<=maximum, 'MONITORING_SETUP_PRIVATE_FILE');
    const raw=await h.readFile(), after=await h.stat();
    need(raw.length===st.size && st.size===after.size && st.mtimeMs===after.mtimeMs && st.ctimeMs===after.ctimeMs,
      'MONITORING_SETUP_FILE_CHANGED');
    return raw;
  } finally { await h.close(); }
}
function selectionValue(input) {
  const s=freeze(input);
  need(plain(s) && s.schema===CUSTOMER_SETUP_SCHEMA, 'MONITORING_SETUP_SELECTION');
  const keys=['schema','operationId','workspaceDirectory','workspaceId','applicationId','applicationRevision','runId',
    'homeId','alias','storageDirectory','sourceConfigPath','merchantConfigPath','expectedSourceSha256','expectedMerchantSha256','files','label','timeoutMs'];
  need(Object.keys(s).every(k=>keys.includes(k)), 'MONITORING_SETUP_FIELDS');
  operationId(s.operationId); operationId(s.workspaceId); recordId(s.applicationId); operationId(s.runId); recordId(s.homeId);
  absolute(s.workspaceDirectory); absolute(s.storageDirectory); name(s.alias);
  filename(s.sourceConfigPath); filename(s.merchantConfigPath);
  need(s.sourceConfigPath!==s.merchantConfigPath && typeof s.applicationRevision==='string' && s.applicationRevision.length>0,
    'MONITORING_SETUP_SELECTION');
  need((s.expectedSourceSha256===null || HASH.test(s.expectedSourceSha256)) && HASH.test(s.expectedMerchantSha256),
    'MONITORING_SETUP_CONFIG_REVIEW');
  need(s.label===undefined || typeof s.label==='string' && s.label.length>0 && s.label.length<=240, 'MONITORING_SETUP_LABEL');
  need(s.timeoutMs===undefined || Number.isInteger(s.timeoutMs) && s.timeoutMs>=1 && s.timeoutMs<=2147483647,
    'MONITORING_SETUP_TIMEOUT');
  need(s.files===undefined || plain(s.files), 'MONITORING_SETUP_FILES');
  return s;
}
async function context(model,s) {
  const state=await model.state({operationDetail:'summary'});
  need(state.directory===s.workspaceDirectory && state.workspaceId===s.workspaceId,'MONITORING_SETUP_RUNTIME_CHANGED');
  return state;
}
async function selectedApplication(model,s) {
  await context(model,s);
  const state=await model.applicationsState({historyLimit:1});
  const app=state.applications.find(a=>a.id===s.applicationId);
  need(app && app.kind==='opensanctions' && app.revision===s.applicationRevision &&
    app.phase==='RUNNING' && app.home?.id===s.homeId && app.homeId===s.homeId &&
    app.current?.id===s.runId && app.current.active===true && !app.current.stop &&
    app.current.command==='source-monitoring' && app.current.url?.operationId===s.runId,
  'MONITORING_SETUP_APPLICATION_CHANGED','Select the current running original Monitoring Application and its exact saved revision.');
  need(app.current.url.schema==='stellar-forge.application-url.v1' &&
    app.current.url.command==='source-monitoring' && plain(app.current.url.original),
    'MONITORING_SETUP_CONNECTION_CHANGED');
  const original=app.current.url.original;
  const connectionFile=original.connectionFile ?? join(s.workspaceDirectory,'operations',s.runId,'application-url.json');
  absolute(connectionFile);
  const raw=await privateFile(connectionFile,65536);
  const client=new MonitoringClient({connectionFile,expectedWorkspace:app.settings.workspaceDirectory,
    expectedBindingSha256:original.bindingSha256,...(s.timeoutMs===undefined?{}:{timeoutMs:s.timeoutMs})});
  let identity;
  try { identity=await client.inspect(); } finally { await client.close(); }
  for(const key of ['schema','domainSchema','workspace','bindingSha256','nativeBindingSha256','sourceRoot','python','pid'])
    need(equal(identity[key],original[key]),'MONITORING_SETUP_LIVE_IDENTITY_CHANGED');
  need(identity.workspace===app.settings.workspaceDirectory,'MONITORING_SETUP_WORKSPACE_CHANGED');
  return {applicationId:app.id,applicationRevision:app.revision,runId:s.runId,homeId:s.homeId,
    homeDirectory:app.home.directory,release:app.release,connectionFile,connectionSha256:digest(raw),identity};
}
function parsedConfig(value,expected,label) {
  need(value.sha256===expected && (!value.exists || value.bytes<=MAX), 'MONITORING_SETUP_CONFIG_CHANGED',label+' changed; review its current full bytes.');
  if(!value.exists) return null;
  let parsed;try{parsed=JSON.parse(value.content);}catch{need(false,'MONITORING_SETUP_CONFIG_JSON');}
  need(plain(parsed),'MONITORING_SETUP_CONFIG_JSON'); return parsed;
}
function configRequest(s,role,content) {
  const path=role==='source'?s.sourceConfigPath:s.merchantConfigPath;
  need(Buffer.byteLength(content)<=MAX,'MONITORING_SETUP_CONFIG_CAPACITY','Runtime configuration history accepts complete files up to 20,000 bytes.');
  return {requestId:uuid([s.operationId,role]),operation:'managed-config-save',homeId:s.homeId,path,content,
    expectedSha256:role==='source'?s.expectedSourceSha256:s.expectedMerchantSha256};
}
/** Read the actual selected running Application. This function neither starts nor stops it. */
export async function prepareSourceMonitoringCustomer({model,selection}) {
  const s=selectionValue(selection), application=await selectedApplication(model,s);
  await privateDirectory(s.storageDirectory);
  const configs=await Promise.all([
    model.managedConfig({homeId:s.homeId,path:s.sourceConfigPath}),
    model.managedConfig({homeId:s.homeId,path:s.merchantConfigPath}),
  ]);
  for(const value of configs) if(value.exists) {
    const raw=await privateFile(join(application.homeDirectory,'config',value.path));
    need(digest(raw)===value.sha256,'MONITORING_SETUP_CONFIG_CHANGED');
  }
  const previous=parsedConfig(configs[0],s.expectedSourceSha256,'Source Monitoring configuration');
  const merchant=parsedConfig(configs[1],s.expectedMerchantSha256,'Merchant configuration');
  need(merchant,'MONITORING_SETUP_MERCHANT_REQUIRED','Select an existing complete merchant configuration; its other provider declarations are preserved.');
  const source=previous ?? {schema:CONFIG_SCHEMA,workspaces:{},files:{},storageDirectory:s.storageDirectory};
  need(source.schema===CONFIG_SCHEMA && plain(source.workspaces) && (source.storageDirectory!==undefined) &&
    (source.files===undefined || plain(source.files)), 'MONITORING_SETUP_SOURCE_CONFIG');
  await readMerchantConfig(join(application.homeDirectory,'config',s.merchantConfigPath));
  source.workspaces[s.alias]={...(s.label?{label:s.label}:{}),connectionFile:application.connectionFile,
    expectedWorkspace:application.identity.workspace,expectedBindingSha256:application.identity.bindingSha256,
    ...(s.timeoutMs===undefined?{}:{timeoutMs:s.timeoutMs})};
  if(s.files!==undefined) source.files={...(source.files??{}),...s.files};
  need(Object.keys(source.workspaces).length<=32 && Object.keys(source.files??{}).length<=1000,'MONITORING_SETUP_CONFIG_CAPACITY');
  // Retain existing relative references in their original file/directory. Only
  // this one host declaration is changed; no provider is removed or rebased.
  const sourceFile=join(application.homeDirectory,'config',s.sourceConfigPath);
  const merchantFile=join(application.homeDirectory,'config',s.merchantConfigPath);
  const normalized=validateSourceMonitoringConfiguration(source,{baseDirectory:dirname(sourceFile)});
  need(normalized.storageDirectory===s.storageDirectory,'MONITORING_SETUP_STORAGE_CHANGED');
  await privateDirectory(normalized.storageDirectory);
  merchant.sourceMonitoringConnection=sourceFile;
  const plan={schema:CUSTOMER_PLAN_SCHEMA,selection:s,application,sourceFile,merchantFile,
    before:configs.map(({content,...value})=>value),
    requests:[configRequest(s,'source',json(source)),configRequest(s,'merchant',json(merchant))]};
  return {...plan,sha256:hash(plan)};
}
function checkedPlan(input) {
  const p=freeze(input),{sha256,...body}=p;
  need(p.schema===CUSTOMER_PLAN_SCHEMA && HASH.test(sha256) && hash(body)===sha256,'MONITORING_SETUP_PLAN_CHANGED');
  const s=selectionValue(p.selection);
  need(p.requests?.length===2 && p.sourceFile===join(p.application.homeDirectory,'config',s.sourceConfigPath) &&
    p.merchantFile===join(p.application.homeDirectory,'config',s.merchantConfigPath),'MONITORING_SETUP_PLAN_CHANGED');
  p.requests.forEach((r,i)=>need(equal(r,configRequest(s,i===0?'source':'merchant',r.content)),'MONITORING_SETUP_PLAN_CHANGED'));
  const source=validateSourceMonitoringConfiguration(JSON.parse(p.requests[0].content),{baseDirectory:dirname(p.sourceFile)});
  const chosen=source.workspaces[s.alias];
  need(source.storageDirectory===s.storageDirectory && chosen?.connectionFile===p.application.connectionFile &&
    chosen.expectedWorkspace===p.application.identity.workspace &&
    chosen.expectedBindingSha256===p.application.identity.bindingSha256 &&
    JSON.parse(p.requests[1].content).sourceMonitoringConnection===p.sourceFile,'MONITORING_SETUP_PLAN_CHANGED');
  return p;
}
async function retained(model,plan,request) {
  try {
    const h=await model.managedConfigurationHistory({homeId:request.homeId,path:request.path,operationId:request.requestId});
    const b=h.intent.binding;
    need(b.operation===request.operation && b.homeId===request.homeId &&
      b.homeDirectory===plan.application.homeDirectory && b.path===request.path &&
      b.expectedSha256===request.expectedSha256 && b.targetSha256===digest(request.content) &&
      h.intent.after.content===request.content && !b.remove,
      'MONITORING_SETUP_REQUEST_REUSED');
    return h;
  } catch(error) { if(error.code==='ENOENT') return null; throw error; }
}
async function currentConfig(model,plan,request) {
  const v=await model.managedConfig({homeId:request.homeId,path:request.path});
  return {...v,content:undefined,matchesPrepared:v.sha256===digest(request.content)};
}
export async function inspectSourceMonitoringCustomer({model,plan}) {
  const p=checkedPlan(plan);await context(model,p.selection);
  const stages=[];
  for(const request of p.requests) {
    const history=await retained(model,p,request);
    let operation=null;
    try{operation=await model.operationStatus({operationId:request.requestId});}
    catch(error){if(error.code!=='ENOENT')throw error;}
    const descriptor=v=>({exists:v.exists,bytes:v.bytes,sha256:v.sha256});
    stages.push({role:stages.length?'merchant':'source',operationId:request.requestId,
      history:history?{intentSha256:history.intentSha256,operationId:request.requestId,path:request.path,
        before:descriptor(history.intent.before),after:descriptor(history.intent.after),result:history.result}:null,
      operation:operation?{operationId:request.requestId,phase:operation.phase,workerActive:operation.workerActive,
        observation:operation.observation??null,error:operation.error??null}:null,
      current:await currentConfig(model,p,request)});
  }
  return {schema:CUSTOMER_SETUP_SCHEMA,operationId:p.selection.operationId,planSha256:p.sha256,
    phase:stages.every(v=>v.history?.result)?'COMPLETE':'PENDING',stages,
    sourceFile:p.sourceFile,merchantFile:p.merchantFile,workspaceAlias:p.selection.alias,
    currentConfigurationMatches:stages.every(v=>v.current.matchesPrepared)};
}
/** Advance one original configuration operation. Reentry never reselects a run or new UUID. */
export async function advanceSourceMonitoringCustomer({model,plan,recover=false}) {
  const p=checkedPlan(plan); need(typeof recover==='boolean','MONITORING_SETUP_RECOVER_BOOLEAN');
  let status=await inspectSourceMonitoringCustomer({model,plan:p});
  if(status.phase==='COMPLETE') return status; // Historical success does not overwrite later configuration.
  const application=await selectedApplication(model,p.selection);
  need(equal(application,p.application),'MONITORING_SETUP_APPLICATION_CHANGED');
  for(let i=0;i<p.requests.length;i++) {
    const r=p.requests[i],stage=status.stages[i];
    if(stage.history?.result) {
      need(stage.current.matchesPrepared,'MONITORING_SETUP_CONFIG_CHANGED',
        'A completed earlier configuration was edited. Preserve that edit and prepare a new reviewed setup.');
      continue;
    }
    if(i===1) {
      const config=await readSourceMonitoringConfiguration(p.sourceFile);
      need(plain(config.workspaces) && config.workspaces[p.selection.alias]?.expectedWorkspace===p.application.identity.workspace &&
        config.workspaces[p.selection.alias]?.expectedBindingSha256===p.application.identity.bindingSha256,
        'MONITORING_SETUP_SOURCE_SELECTION_CHANGED');
    }
    // begin is itself first-request idempotent; an existing interrupted worker
    // is resumed only by the caller's explicit recover selection.
    const started=await model.begin(r);
    if(recover && stage.operation && stage.operation.workerActive===false && ['FAILED','INTERRUPTED','QUEUED'].includes(stage.operation.phase))
      await model.recoverManagedOperation(r.requestId);
    status=await inspectSourceMonitoringCustomer({model,plan:p});
    return {...status,started};
  }
  return status;
}
/** Verify the current published declaration using the actual host configuration reader. */
export async function verifySourceMonitoringCustomer({model,plan}) {
  const p=checkedPlan(plan),status=await inspectSourceMonitoringCustomer({model,plan:p});
  need(status.phase==='COMPLETE' && status.currentConfigurationMatches,'MONITORING_SETUP_NOT_CURRENT');
  const application=await selectedApplication(model,p.selection);
  need(equal(application,p.application),'MONITORING_SETUP_APPLICATION_CHANGED');
  const configuration=await readSourceMonitoringConfiguration(p.sourceFile);
  const merchant=await readMerchantConfig(p.merchantFile);
  need(equal(merchant.sourceMonitoring,configuration),'MONITORING_SETUP_HOST_REFERENCE_CHANGED');
  return {schema:CUSTOMER_SETUP_SCHEMA,operationId:p.selection.operationId,planSha256:p.sha256,phase:'VERIFIED',
    sourceFile:p.sourceFile,merchantFile:p.merchantFile,workspaceAlias:p.selection.alias,
    identity:p.application.identity,applicationId:p.selection.applicationId,runId:p.selection.runId,
    configurationOperations:p.requests.map(r=>r.requestId)};
}
async function loadPrivateJSON(path,maximum=1024*1024) {
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await privateFile(absolute(path),maximum)));
}
export async function customerSetupMain(argv=process.argv.slice(2)) {
  if(!argv.length||argv.includes('--help')) {
    process.stdout.write('Source Monitoring customer setup (existing running Applications only)\n'+
      'prepare --runtime-workspace DIR --selection JSON --out PRIVATE_PLAN\n'+
      'advance|status|verify --runtime-workspace DIR --plan PRIVATE_PLAN [--recover]\n'+
      'Configuration writes use the original Runtime worker, UUID, CAS and complete history. Repeat advance until complete.\n');
    return 0;
  }
  const {values:v,positionals:p}=parseArgs({args:argv,allowPositionals:true,strict:true,options:{
    'runtime-workspace':{type:'string'},selection:{type:'string'},out:{type:'string'},plan:{type:'string'},recover:{type:'boolean',default:false}}});
  need(p.length===1&&['prepare','advance','status','verify'].includes(p[0])&&v['runtime-workspace'],'MONITORING_SETUP_CLI');
  const directory=absolute(v['runtime-workspace']);
  const model=await openRuntimeWorkspace({directory});
  try {
    let result;
    if(p[0]==='prepare') {
      need(v.selection&&v.out&&!v.plan&&!v.recover,'MONITORING_SETUP_CLI');
      const selection=selectionValue(await loadPrivateJSON(absolute(v.selection)));
      need(selection.workspaceDirectory===directory,'MONITORING_SETUP_RUNTIME_CHANGED');
      const out=absolute(v.out);await privateDirectory(dirname(out));
      const lock=await operationLease(out+'.lock');
      try {
        const existing=await readJSON(out,true);
        if(existing) {
          const prior=checkedPlan(existing);
          need(equal(prior.selection,selection),'MONITORING_SETUP_PLAN_CHANGED');
          result={path:out,sha256:prior.sha256,reused:true};
        } else {
          const plan=await prepareSourceMonitoringCustomer({model,selection});
          await saveJSON(out,plan);result={path:out,sha256:plan.sha256,reused:false};
        }
      } finally {await lock.close();}
    } else {
      need(v.plan&&!v.selection&&!v.out&&(p[0]==='advance'||!v.recover),'MONITORING_SETUP_CLI');
      const plan=await loadPrivateJSON(absolute(v.plan));
      result=await ({advance:advanceSourceMonitoringCustomer,status:inspectSourceMonitoringCustomer,
        verify:verifySourceMonitoringCustomer}[p[0]])({model,plan,recover:v.recover});
    }
    process.stdout.write(json(result));return 0;
  } finally {await model.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  customerSetupMain().then(code=>process.exitCode=code).catch(error=>{
    process.stderr.write(json({error:error.code??error.name,message:error.message}));process.exitCode=1;
  });
