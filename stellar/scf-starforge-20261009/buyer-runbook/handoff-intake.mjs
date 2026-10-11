// MIT. Receiving workflow for the original private operation and operator.
import {constants} from 'node:fs';
import {mkdir,open,realpath,lstat,readdir,link,unlink} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {basename,dirname,isAbsolute,join,resolve} from 'node:path';
import {InputError,operator as nativeOperator,buyerTransport} from '../sf88-operator-buyer-cli/config.mjs';
import {initializeWorkspace,openWorkspace} from '../sf88-operator-buyer-cli/workspace.mjs';
import {loadOperationTicket} from '../sf88-operator-buyer-cli/operation-ticket.mjs';
import {validateNativeSignerConfiguration} from '../sf88-operator-buyer-cli/native-signer.mjs';
import {MAX_REQUEST_BODY_BYTES} from '../sf88-operator-buyer-cli/request-body.mjs';
import {OPERATION_HANDOFF_MAX_BYTES,inspectOperationHandoff,importOperationHandoff,
  readOperationHandoffBody} from '../sf88-operator-buyer-cli/operation-handoff.mjs';
import {acquireRunbookMetadataLease} from './runbook.mjs';

const SCHEMA='stellar-forge.buyer-request-intake.v1';
const PRESET='stellar-forge.buyer-runbook-operator.v1';
const ID=/^request-[a-f0-9]{64}$/;
const MAX_ATOMIC=9223372036854775807n;
const PROOF_FIELDS=['schema','id','handoffSha256','acceptIndex','acceptedTerms','bodySha256','requestHeaders',
  'operationKey','requestHash','operationTicketSha256','settingsSha256','operator','totalAtomic','dailyAtomic'];
const hash=raw=>createHash('sha256').update(raw).digest('hex');
const encode=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const check=(ok,code,status=422)=>{if(!ok)throw Object.assign(new InputError(code),{status});};
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const fields=(value,allowed,required=allowed)=>check(object(value)&&
  Object.keys(value).every(key=>allowed.includes(key))&&required.every(key=>Object.hasOwn(value,key)),
  'REQUEST_INTAKE_FIELDS_INVALID');
const codeOf=error=>/^[A-Z0-9_]{1,120}$/.test(error?.code??'')?error.code:'REQUEST_INTAKE_FAILED';
const amount=value=>{check(typeof value==='string'&&/^[1-9][0-9]{0,18}$/.test(value)&&
  BigInt(value)<=MAX_ATOMIC,'REQUEST_BUDGET_INVALID');return value;};
const canonical=value=>{check(typeof value==='string'&&isAbsolute(value)&&resolve(value)===value&&
  !value.includes('\0'),'REQUEST_CANONICAL_PATH_REQUIRED');return value;};

async function privateDirectory(path,create=false) {
  canonical(path);
  if(create){check(await realpath(dirname(path))===dirname(path),'REQUEST_PARENT_CHANGED');
    await mkdir(path,{mode:0o700}).catch(error=>{if(error.code!=='EEXIST')throw error;});}
  const info=await lstat(path);
  check(info.isDirectory()&&!info.isSymbolicLink()&&await realpath(path)===path&&
    (info.mode&0o077)===0&&(typeof process.getuid!=='function'||info.uid===process.getuid()),
    'REQUEST_PRIVATE_DIRECTORY_REQUIRED');
}
async function bytes(path,limit=65536) {
  check(await realpath(path)===path,'REQUEST_FILE_PATH_CHANGED');
  const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try {
    const info=await file.stat();
    check(info.isFile()&&(info.mode&0o077)===0&&info.size<=limit&&
      (typeof process.getuid!=='function'||info.uid===process.getuid()),'REQUEST_PRIVATE_FILE_REQUIRED');
    const raw=Buffer.alloc(limit+1);let length=0;
    while(length<raw.length){const {bytesRead}=await file.read(raw,length,raw.length-length,length);
      if(!bytesRead)break;length+=bytesRead;}
    check(length<=limit,'REQUEST_FILE_TOO_LARGE');return raw.subarray(0,length);
  } finally {await file.close();}
}
async function json(path){try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await bytes(path)));}
  catch(error){if(error instanceof SyntaxError||error instanceof TypeError)throw new InputError('REQUEST_JSON_INVALID');throw error;}}
async function optional(path){try{return await json(path);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function sync(path){const f=await open(path,'r');try{await f.sync();}finally{await f.close();}}
async function publish(path,value,{same=false,raw=false}={}) {
  const data=raw?value:encode(value),temporary=path+'.'+randomUUID()+'.tmp';
  const file=await open(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  try {
    await file.writeFile(data);await file.sync();await file.close();
    try{await link(temporary,path);}
    catch(error){if(error.code!=='EEXIST'||!same)throw error;
      check((await bytes(path,data.length)).equals(data),'REQUEST_RETAINED_INPUT_CHANGED',409);}
    await sync(dirname(path));
  } finally {await file.close().catch(()=>{});await unlink(temporary).catch(()=>{});}
}

/** Read the ORIGINAL host-owned operator preset for receiving applications. */
export async function readBuyerOperatorPreset(settingsFile, {directory} = {}) {
  canonical(directory);
  check(settingsFile!==null,'REQUEST_OPERATOR_PRESET_REQUIRED');
  const raw=await bytes(canonical(settingsFile),16384);let value;
  try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}
  catch{throw new InputError('REQUEST_OPERATOR_PRESET_INVALID');}
  const required=['schema','actor','service','payer','python','maxTotalAtomic','maxDailyAtomic'];
  fields(value,[...required,'secretEnv','signerProvider','rpc','httpsProxyEnv'],required);
  check(value.schema===PRESET,'REQUEST_OPERATOR_PRESET_INVALID');
  nativeOperator({actor:value.actor,service:value.service,python:value.python,
    policy:join(directory,'policy.json'),ledger:join(directory,'reservations.sqlite')});
  check(/^G[A-Z2-7]{55}$/.test(value.payer??''),'REQUEST_OPERATOR_PAYER_INVALID');
  check(BigInt(amount(value.maxDailyAtomic))<=BigInt(amount(value.maxTotalAtomic)),'REQUEST_OPERATOR_BUDGET_INVALID');
  check(value.signerProvider===undefined||value.secretEnv===undefined,'REQUEST_ONE_SIGNER_SOURCE_REQUIRED');
  if(value.signerProvider!==undefined)canonical(value.signerProvider);
  for(const name of ['secretEnv','httpsProxyEnv'])if(value[name]!==undefined)
    check(/^[A-Z][A-Z0-9_]{0,127}$/.test(value[name])&&!value[name].startsWith('SF36_'),'REQUEST_ENVIRONMENT_NAME_INVALID');
  if(value.rpc!==undefined)check(typeof value.rpc==='string'&&value.rpc.length<=2048,'REQUEST_RPC_INVALID');
  return {value,sha256:hash(raw),view:{actor:value.actor,service:value.service,payer:value.payer,
    maxTotalAtomic:value.maxTotalAtomic,maxDailyAtomic:value.maxDailyAtomic,
    signerSource:value.signerProvider===undefined?'ENVIRONMENT':'TRUSTED_SEP43_PROVIDER',
    walletKeyEnvironment:value.signerProvider===undefined?value.secretEnv??'STELLAR_SECRET':null}};
}

/** The preset is declared by the local launcher, never by a received packet. */
export async function openHandoffIntake({directory,configsDirectory,operatorSettings}) {
  await privateDirectory(directory,true);await privateDirectory(configsDirectory);
  await privateDirectory(join(directory,'intents'),true);
  if(operatorSettings!==undefined)canonical(operatorSettings);
  let saved=await optional(join(directory,'intake.json'));
  if(!saved){saved={schema:SCHEMA,directory,configsDirectory,operatorSettings:operatorSettings??null};
    try{await publish(join(directory,'intake.json'),saved);}
    catch(error){if(error.code!=='EEXIST')throw error;saved=await json(join(directory,'intake.json'));}}
  check(saved.schema===SCHEMA&&saved.directory===directory&&saved.configsDirectory===configsDirectory,
    'REQUEST_INTAKE_IDENTITY_CHANGED');
  if(operatorSettings!==undefined&&saved.operatorSettings===null){
    // A declared preset can be attached to an older workspace without replacing
    // its immutable directory/configuration identity.
    await publish(join(directory,'operator-settings.json'),{path:operatorSettings},{same:true});
  }
  const declared=await optional(join(directory,'operator-settings.json'));
  const settingsFile=saved.operatorSettings??declared?.path??null;
  check(operatorSettings===undefined||operatorSettings===settingsFile,'REQUEST_OPERATOR_PRESET_PATH_CHANGED');
  const root=id=>{check(typeof id==='string'&&ID.test(id),'REQUEST_ID_INVALID');return join(directory,id);};
  const source=id=>join(root(id),'request.handoff');
  const configuration=id=>'received-'+id.slice(8)+'.json';
  async function lease(action){const release=await acquireRunbookMetadataLease(directory);
    try{return await action();}finally{await release();}}
  const preset = () => readBuyerOperatorPreset(settingsFile, {directory});
  async function record(id){const value=await json(join(root(id),'request.json'));
    check(value.schema===SCHEMA&&value.id===id&&value.handoffSha256===id.slice(8),'REQUEST_RECORD_CHANGED');return value;}
  async function verifiedSource(id){const item=await record(id),raw=await bytes(source(id),OPERATION_HANDOFF_MAX_BYTES);
    check(hash(raw)===item.handoffSha256,'REQUEST_SOURCE_CHANGED',409);return item;}
  async function reviews(id) {
    const names=(await readdir(join(root(id),'reviews'))).filter(name=>/^r[1-9][0-9]*\.json$/.test(name));
    const ordered=names.sort((a,b)=>Number(b.slice(1,-5))-Number(a.slice(1,-5)));
    return ordered.length?reviewRecord(id,Number(ordered[0].slice(1,-5))):null;
  }
  async function reviewRecord(id,revision) {
    check(Number.isSafeInteger(revision)&&revision>0&&revision<=10000,'REQUEST_REVIEW_CHANGED',409);
    const result=await json(join(root(id),'reviews','r'+revision+'.json'));
    fields(result,[...PROOF_FIELDS,'reviewSha256','revision','reviewedAt']);
    const proof=Object.fromEntries(PROOF_FIELDS.map(key=>[key,result[key]]));
    check(result.schema===SCHEMA&&result.id===id&&result.revision===revision&&
      result.handoffSha256===id.slice(8)&&result.reviewSha256===hash(encode(proof)),
      'REQUEST_REVIEW_CHANGED',409);
    return result;
  }
  function attemptRecord(id,generation,value) {
    check(Number.isSafeInteger(generation)&&generation>0&&generation<=10000&&value.schema===SCHEMA&&value.id===id&&
      value.generation===generation&&value.inputDirectory===join(root(id),'input-'+generation)&&
      value.operatorDirectory===join(root(id),'operator-'+generation)&&/^[a-f0-9]{64}$/.test(value.reviewSha256),
      'REQUEST_ATTEMPT_BINDING_CHANGED',409);
    return value;
  }
  async function ready(id) {
    const result=await optional(join(root(id),'ready.json'));
    if(result){
      check(result.schema===SCHEMA&&result.id===id&&result.configPath===join(configsDirectory,configuration(id))&&
        result.configName===configuration(id)&&/^[a-f0-9]{64}$/.test(result.configSha256),
        'REQUEST_READY_BINDING_CHANGED');
      const review=await reviewRecord(id,result.reviewRevision);
      const attempt=attemptRecord(id,result.generation,await json(join(root(id),'attempts','a'+result.generation+'.json')));
      check(attempt.reviewSha256===review.reviewSha256&&result.reviewSha256===review.reviewSha256&&
        result.operatorDirectory===attempt.operatorDirectory,'REQUEST_READY_BINDING_CHANGED',409);
    }
    return result;
  }
  async function get(id) {
    const item=await verifiedSource(id);
    const view=await inspectOperationHandoff({file:source(id),directory:join(root(id),'review-input'),requireCurrent:false});
    const [review,prepared]=await Promise.all([reviews(id),ready(id)]);
    return {...item,view,review,prepared,expired:view.operationTicket.expiresAt<=Date.now()};
  }
  async function receive(input) {
    fields(input,['filename','base64']);
    check(typeof input.filename==='string'&&input.filename.length>=1&&input.filename.length<=180&&
      !/[\x00-\x1f\x7f]/.test(input.filename),'REQUEST_FILENAME_INVALID');
    check(typeof input.base64==='string'&&input.base64.length<=4*Math.ceil(OPERATION_HANDOFF_MAX_BYTES/3),
      'REQUEST_FILE_TOO_LARGE',413);
    const raw=Buffer.from(input.base64,'base64');
    check(raw.length>0&&raw.length<=OPERATION_HANDOFF_MAX_BYTES&&raw.toString('base64')===input.base64,
      'REQUEST_FILE_ENCODING_INVALID');
    const id='request-'+hash(raw),path=root(id);
    await privateDirectory(path,true);await privateDirectory(join(path,'reviews'),true);
    await privateDirectory(join(path,'attempts'),true);
    await publish(source(id),raw,{same:true,raw:true});
    const existing=await optional(join(path,'request.json'));
    if(existing)return get(id);
    const view=await inspectOperationHandoff({file:source(id),directory:join(path,'review-input')});
    await publish(join(path,'request.json'),{schema:SCHEMA,id,filename:basename(input.filename),createdAt:new Date().toISOString(),
      handoffSha256:hash(raw),summary:{intentId:view.intentId,url:view.sellerUrl,bodyBytes:view.bodyBytes,
        bodySha256:view.bodySha256,expiresAt:view.operationTicket.expiresAt}});
    return get(id);
  }
  async function review(input) {
    fields(input,['id','acceptIndex','totalAtomic','dailyAtomic']);
    const item=await verifiedSource(input.id),operator=await preset();
    check(!await ready(input.id),'REQUEST_ALREADY_PREPARED',409);
    check(Number.isSafeInteger(input.acceptIndex)&&input.acceptIndex>=0,'EXPLICIT_SELECTION_INDEX_REQUIRED');
    const view=await inspectOperationHandoff({file:source(input.id),directory:join(root(input.id),'review-input'),
      acceptIndex:input.acceptIndex});
    const total=amount(input.totalAtomic),daily=amount(input.dailyAtomic),single=BigInt(view.acceptedTerms.maxAtomic);
    check(single<=BigInt(daily)&&BigInt(daily)<=BigInt(total)&&BigInt(total)<=BigInt(operator.value.maxTotalAtomic)&&
      BigInt(daily)<=BigInt(operator.value.maxDailyAtomic),'REQUEST_BUDGET_OUTSIDE_OPERATOR_LIMITS');
    const proof={schema:SCHEMA,id:input.id,handoffSha256:item.handoffSha256,acceptIndex:input.acceptIndex,
      acceptedTerms:view.acceptedTerms,bodySha256:view.bodySha256,requestHeaders:view.requestHeaders,
      operationKey:view.operationTicket.operationKey,requestHash:view.operationTicket.requestHash,
      operationTicketSha256:view.operationTicket.sha256,
      settingsSha256:operator.sha256,operator:operator.view,totalAtomic:total,dailyAtomic:daily};
    const old=await reviews(input.id),result={...proof,reviewSha256:hash(encode(proof)),
      revision:(old?.revision??0)+1,reviewedAt:new Date().toISOString()};
    check(result.revision<=10000,'REQUEST_REVIEW_LIMIT');
    await publish(join(root(input.id),'reviews','r'+result.revision+'.json'),result);
    return {...await get(input.id),review:result};
  }
  async function verifyOperator(attempt,review,settings) {
    const result=await openWorkspace(['--dir',attempt.operatorDirectory]);
    const cfg=result.config,op=cfg.operation,manifest=result.manifest;
    const item=await record(review.id);
    const sourceView=await inspectOperationHandoff({file:source(review.id),directory:attempt.inputDirectory,acceptIndex:review.acceptIndex});
    const bodyPresent=sourceView.bodyPresent;
    check(op.method==='POST'&&op.url===item.summary.url&&JSON.stringify(op.expect)===JSON.stringify(review.acceptedTerms)&&
      op.intentId===item.summary.intentId&&
      JSON.stringify(op.headers)===JSON.stringify(review.requestHeaders)&&cfg.trustedPayer===settings.payer&&
      cfg.operator.actor===settings.actor&&cfg.operator.service===settings.service&&cfg.operator.python===settings.python&&
      op.bodyFile===(bodyPresent?join(attempt.inputDirectory,'request.body'):undefined)&&op.ticketFile===join(attempt.operatorDirectory,'operation-ticket.json'),
      'REQUEST_OPERATOR_BINDING_CHANGED',409);
    check(manifest.signer.secretEnv===(settings.signerProvider===undefined?settings.secretEnv??'STELLAR_SECRET':undefined)&&
      manifest.signer.signerProvider===settings.signerProvider,'REQUEST_SIGNER_BINDING_CHANGED',409);
    const expectedPins=validateNativeSignerConfiguration({...review.acceptedTerms,expectedPayer:settings.payer,rpcUrl:settings.rpc});
    check(manifest.signer.rpcUrl===expectedPins.rpcUrl&&manifest.signer.maxAtomic===review.acceptedTerms.maxAtomic,
      'REQUEST_SIGNER_BINDING_CHANGED',409);
    const expectedTransport=buyerTransport({operation:op,...(settings.httpsProxyEnv===undefined?{}:
      {buyerTransport:{mode:'explicit-connect',origin:new URL(op.url).origin,proxyEnv:settings.httpsProxyEnv}})});
    check(JSON.stringify(buyerTransport(cfg))===JSON.stringify(expectedTransport),'REQUEST_TRANSPORT_BINDING_CHANGED',409);
    const ticket=await loadOperationTicket(op,{requireCurrent:true});
    check(ticket.sha256===review.operationTicketSha256&&ticket.operationKey===review.operationKey&&
      ticket.requestHash===review.requestHash,'REQUEST_TICKET_CHANGED',409);
    check(hash(bodyPresent?await bytes(op.bodyFile,MAX_REQUEST_BODY_BYTES):new Uint8Array())===review.bodySha256,'REQUEST_BODY_CHANGED',409);
    const policy=await json(cfg.operator.policy);
    check(policy.assets?.length===1&&policy.assets[0].max_single===review.acceptedTerms.maxAtomic&&
      policy.assets[0].max_total===review.totalAtomic&&policy.assets[0].max_per_utc_day===review.dailyAtomic,
      'REQUEST_OPERATOR_BUDGET_CHANGED',409);
    return result;
  }
  async function finish(attempt,review,settings) {
    const native=await verifyOperator(attempt,review,settings),raw=await bytes(native.configPath);
    const destination=join(configsDirectory,configuration(review.id));
    await publish(destination,raw,{same:true,raw:true});
    const value={schema:SCHEMA,id:review.id,reviewSha256:review.reviewSha256,configPath:destination,
      configName:configuration(review.id),configSha256:hash(raw),operatorDirectory:attempt.operatorDirectory,
      generation:attempt.generation,reviewRevision:review.revision,intentId:native.config.operation.intentId,createdAt:new Date().toISOString()};
    const old=await ready(review.id);
    if(old){check(old.configSha256===value.configSha256&&old.operatorDirectory===value.operatorDirectory,
      'REQUEST_READY_BINDING_CHANGED',409);return old;}
    await publish(join(root(review.id),'ready.json'),value);return value;
  }
  async function provision(input) {
    fields(input,['id','reviewSha256']);
    const item=await verifiedSource(input.id),existing=await ready(input.id);
    if(existing){check(existing.reviewSha256===input.reviewSha256,'REQUEST_ALREADY_PREPARED',409);return existing;}
    const selected=await reviews(input.id),operator=await preset();
    check(selected&&selected.reviewSha256===input.reviewSha256,'REQUEST_REVIEW_CHANGED',409);
    check(selected.settingsSha256===operator.sha256,'REQUEST_OPERATOR_SETTINGS_CHANGED',409);
    const current=await inspectOperationHandoff({file:source(input.id),directory:join(root(input.id),'review-input'),acceptIndex:selected.acceptIndex});
    check(JSON.stringify(selected.acceptedTerms)===JSON.stringify(current.acceptedTerms)&&
      selected.bodySha256===current.bodySha256&&selected.operationTicketSha256===current.operationTicket.sha256&&
      JSON.stringify(selected.requestHeaders)===JSON.stringify(current.requestHeaders)&&
      JSON.stringify(selected.operator)===JSON.stringify(operator.view),'REQUEST_REVIEW_CHANGED',409);
    const intentPath=join(directory,'intents',hash(item.summary.intentId)+'.json');
    await publish(intentPath,{id:input.id,intentId:item.summary.intentId},{same:true});
    const attemptsDirectory=join(root(input.id),'attempts');
    const names=(await readdir(attemptsDirectory)).filter(name=>/^a[1-9][0-9]*\.json$/.test(name))
      .sort((a,b)=>Number(b.slice(1,-5))-Number(a.slice(1,-5)));
    for(const name of names) {
      const previous=attemptRecord(input.id,Number(name.slice(1,-5)),await json(join(attemptsDirectory,name)));
      if(previous.reviewSha256!==selected.reviewSha256)continue;
      const manifest=await optional(join(previous.operatorDirectory,'workspace.json'));
      if(manifest)return finish(previous,selected,operator.value);
    }
    const generation=names.length?Number(names[0].slice(1,-5))+1:1;
    check(Number.isSafeInteger(generation)&&generation<=10000,'REQUEST_ATTEMPT_LIMIT');
    const attempt={schema:SCHEMA,id:input.id,generation,reviewSha256:selected.reviewSha256,
      inputDirectory:join(root(input.id),'input-'+generation),operatorDirectory:join(root(input.id),'operator-'+generation)};
    await publish(join(attemptsDirectory,'a'+generation+'.json'),attempt);
    await importOperationHandoff({file:source(input.id),directory:attempt.inputDirectory,acceptIndex:selected.acceptIndex});
    const value=operator.value,args=['--config',join(attempt.inputDirectory,'review.json'),'--dir',attempt.operatorDirectory,
      '--actor',value.actor,'--service',value.service,'--payer',value.payer,'--python',value.python,
      '--total-atomic',selected.totalAtomic,'--daily-atomic',selected.dailyAtomic];
    for(const [key,flag]of [['secretEnv','--secret-env'],['signerProvider','--signer-provider'],['rpc','--rpc'],['httpsProxyEnv','--https-proxy-env']])
      if(value[key]!==undefined)args.push(flag,value[key]);
    await initializeWorkspace(args);
    return finish(attempt,selected,value);
  }
  async function state() {
    const requests=[],errors=[];let operator=null,presetError=null;
    if(settingsFile!==null){try{operator=(await preset()).view;}catch(error){presetError=codeOf(error);}}
    for(const id of (await readdir(directory)).filter(name=>ID.test(name))){
      try{const item=await record(id);requests.push({...item,prepared:await ready(id)});}
      catch(error){errors.push({id,code:codeOf(error)});}
    }
    requests.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
    return {requests,errors,operator,presetError,settingsFile,maxHandoffBytes:OPERATION_HANDOFF_MAX_BYTES};
  }
  async function environmentForOperation(op) {
    const path=op.sourceConfig?.path;
    if(typeof path!=='string'||dirname(path)!==configsDirectory||!/^received-[a-f0-9]{64}\.json$/.test(basename(path)))return process.env;
    const id='request-'+basename(path).slice(9,-5),saved=await ready(id);
    check(saved&&saved.configPath===path&&saved.configSha256===op.sourceConfig.sha256&&
      hash(await bytes(path))===saved.configSha256,'REQUEST_OPERATOR_SETUP_CHANGED',409);
    const native=await openWorkspace(['--dir',saved.operatorDirectory],{accounting:true});
    check(hash(await bytes(native.configPath))===saved.configSha256,'REQUEST_OPERATOR_SETUP_CHANGED',409);
    return {...process.env,...native.operatorEnvironment};
  }
  async function attachment(id,kind) {
    await verifiedSource(id);check(['body','handoff'].includes(kind),'REQUEST_ATTACHMENT_INVALID');
    const raw=kind==='body'?await readOperationHandoffBody({file:source(id)}):await bytes(source(id),OPERATION_HANDOFF_MAX_BYTES);
    check(raw!==null,'REQUEST_BODY_ABSENT',404);
    return {bytes:raw,name:kind==='body'?'request.body':'merchant-operation.handoff.json'};
  }
  return {state,get,attachment,environmentForOperation,
    receive:input=>lease(()=>receive(input)),review:input=>lease(()=>review(input)),provision:input=>lease(()=>provision(input))};
}
