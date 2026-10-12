#!/usr/bin/env node
// MIT. Complete Service adjustment operation through its original local owner.
import {mkdir,lstat} from 'node:fs/promises';
import {resolve,join,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {createHash} from 'node:crypto';
import {readPrivateFile} from '../sf93-seller-support-bundle/incident-store.mjs';
import {retainCaseArtifact} from './case-store.mjs';
import {MAX_COMMISSIONING_BYTES} from './commissioning.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'
  ?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const decode=bytes=>new TextDecoder('utf-8',{fatal:true}).decode(bytes);
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const HASH=/^[a-f0-9]{64}$/;
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const fileName=value=>typeof value==='string'&&/^[A-Za-z0-9_.-]{1,240}$/.test(value)&&value!=='.'&&value!=='..';
function exact(value,fields,required=[]){
  if(!plain(value)||Object.keys(value).some(key=>!fields.includes(key))||required.some(key=>!Object.hasOwn(value,key)))
    throw new TypeError('Use the complete original Service CLI request.');
}
function localOrigin(value){
  const u=new URL(value);
  if(u.protocol!=='http:'||u.hostname!=='127.0.0.1'||u.username||u.password||u.search||u.hash||u.pathname!=='/')
    throw new TypeError('Use the original Support URL http://127.0.0.1:PORT/.');
  return u.origin;
}
async function privateDirectory(path){
  if(typeof path!=='string'||!isAbsolute(path))throw new TypeError('Select an absolute private output directory.');
  path=resolve(path);await mkdir(path,{recursive:true,mode:0o700});const stat=await lstat(path);
  if(!stat.isDirectory()||stat.isSymbolicLink()||process.platform!=='win32'&&(stat.mode&0o077))
    throw new TypeError('Select a real private output directory with mode 0700.');
  return path;
}
async function optionalJson(path){
  try{return JSON.parse(decode(await readPrivateFile(path,MAX_COMMISSIONING_BYTES*3)));}
  catch(error){if(error.code==='ENOENT')return null;throw error;}
}
async function response(origin,path,body){
  return fetch(origin+path,{method:body===undefined?'GET':'POST',redirect:'error',
    headers:{origin,accept:'application/json',...(body===undefined?{}:{'content-type':'application/json'})},
    ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(180000)});
}
async function requestJson(origin,path,body){
  const res=await response(origin,path,body),value=await res.json();
  if(!res.ok)throw Object.assign(new Error(value.detail??value.error??'The original local operation did not complete.'),{code:value.error,status:res.status,currentRevision:value.currentRevision});
  return value;
}
async function fetchOriginalFile(origin,path,body){
  const res=await response(origin,path,body);
  if(!res.ok){const problem=await res.json();throw Object.assign(new Error(problem.detail??problem.error),{code:problem.error,status:res.status});}
  const bytes=Buffer.from(await res.arrayBuffer()),digest=res.headers.get('x-content-sha256');
  const name=/filename="([A-Za-z0-9_.-]+)"/.exec(res.headers.get('content-disposition')??'')?.[1];
  if(!fileName(name)||!HASH.test(digest??'')||sha(bytes)!==digest)throw new Error('The complete original file differs from its advertised identity.');
  return {name,type:res.headers.get('content-type')??'application/octet-stream',body:bytes,bytes:bytes.length,sha256:digest};
}
function apiRoute(method,args){
  if(['sources','buyerSources'].includes(method)){exact(args,[],[]);return {path:'/api/adjustments/sources',body:undefined};}
  if(method==='accounting'||method==='buyerWorkspace'){
    const {action,...body}=args;if(typeof action!=='string'||!/^[a-z]+$/.test(action))throw new TypeError('Select the original workspace operation.');
    return {path:'/api/adjustments/'+(method==='accounting'?'accounting':'buyer')+'/'+action,body};
  }
  if(!UUID.test(args.id??''))throw new TypeError('Select the original saved case UUID.');
  const {id,...body}=args,base='/api/cases/'+id+'/adjustments';
  const read=method==='read'||method==='buyerRead';
  if(read)return {path:base+(method==='buyerRead'?'/buyer':'')+'?'+new URLSearchParams(Object.fromEntries(Object.entries(body).map(([key,value])=>[key,String(value)]))),body:undefined};
  const action={preview:'preview',prepareIntent:'intent',retain:'material',execute:'execute',download:'download',
    inspectBuyer:'buyer-inspect',prepareBuyerIntent:'buyer-intent',retainBuyer:'buyer-material',executeBuyer:'buyer-execute',downloadBuyer:'buyer-download',
    previewBuyerAccountantReturn:'buyer-accountant-preview'}[method];
  if(!action)throw new TypeError('Select an original Service adjustment CLI method.');
  return {path:base+'/'+action,body};
}
const DELIVERY='stellar-forge.service-adjustment-delivery.v1',INTENT='stellar-forge.service-adjustment-delivery-request.v1';
async function completeDelivery(origin,args,out){
  exact(args,['id','revision','proposalId'],['id','proposalId']);
  if(!UUID.test(args.id??'')||!UUID.test(args.proposalId??'')||args.revision!==undefined&&!HASH.test(args.revision))
    throw new TypeError('Select the original case, proposal and optional saved revision.');
  out=await privateDirectory(out);
  const intentPath=join(out,'service-adjustment-delivery-request.json'),completePath=join(out,'service-adjustment-delivery.json');
  let intent=await optionalJson(intentPath),complete=await optionalJson(completePath);
  if(intent&&(!plain(intent)||intent.schema!==INTENT||!same(intent.input,args)||sha(json(intent.input))!==intent.inputSha256))
    throw new Error('This output directory retains a different original delivery request.');
  if(complete&&!intent)throw new Error('The original completion exists without its retained delivery request.');
  const base='/api/cases/'+args.id+'/adjustments';
  if(!intent){
    const view=await requestJson(origin,base+(args.revision?'?revision='+args.revision:''));
    const proposal=view.proposals.find(row=>row.id===args.proposalId);
    if(!proposal)throw new Error('The selected proposal is absent from this original case.');
    const revision=view.case.revision,buyer=await requestJson(origin,base+'/buyer?revision='+revision);
    const selection={id:args.id,revision,proposalId:proposal.id,proposalSha256:proposal.sha256};
    const plans=[];
    for(const kind of ['handover','customer-html','service-report','case','workspace'])
      plans.push({path:base+'/download',body:{revision,proposalId:proposal.id,proposalSha256:proposal.sha256,kind},prefix:''});
    for(const capture of view.outcomes.filter(row=>row.action==='capture'&&row.proposalId===proposal.id)){
      for(const kind of ['native-json','native-csv','native-html','buyer-source'])
        plans.push({path:base+'/download',body:{revision,proposalId:proposal.id,proposalSha256:proposal.sha256,outcomeId:capture.id,kind},prefix:capture.id+'-'});
    }
    for(const outcome of buyer.outcomes.filter(row=>row.capture?.proposalId===proposal.id)){
      for(const file of outcome.files??outcome.result?.files??[])
        plans.push({path:base+'/buyer-download',body:{revision,outcomeId:outcome.id,name:file.name},prefix:outcome.id+'-'});
    }
    intent={schema:INTENT,input:copy(args),inputSha256:sha(json(args)),selection,createdAt:new Date().toISOString(),files:plans};
    await retainCaseArtifact(intentPath,json(intent));
  }
  const copyIntent=structuredClone(intent);
  if(!Array.isArray(intent.files)||!HASH.test(intent.selection?.revision??'')||intent.selection.id!==args.id||
      intent.selection.proposalId!==args.proposalId||!HASH.test(intent.selection.proposalSha256??''))
    throw new Error('The retained original delivery selection is invalid.');
  const files=[];
  for(const plan of intent.files){
    if(!plain(plan)||!['/download','/buyer-download'].some(suffix=>plan.path===base+suffix)||!plain(plan.body)||
        plan.body.revision!==intent.selection.revision||typeof plan.prefix!=='string'||plan.prefix&&!UUID.test(plan.prefix.slice(0,-1)))
      throw new Error('The original delivery file plan is invalid.');
    const file=await fetchOriginalFile(origin,plan.path,plan.body),name=plan.prefix+file.name;
    if(!fileName(name)||files.some(row=>row.name===name))throw new Error('The original delivery filenames collide.');
    await retainCaseArtifact(join(out,name),file.body);
    files.push({name,originalName:file.name,type:file.type,bytes:file.bytes,sha256:file.sha256,request:plan});
  }
  if(!same(intent,copyIntent))throw new Error('The retained delivery request changed during receiving.');
  const manifest={schema:DELIVERY,requestSha256:sha(json(intent)),selection:intent.selection,createdAt:intent.createdAt,files};
  if(complete&&!same(complete,manifest))throw new Error('The original delivery completion differs from its selected files.');
  const reused=Boolean(complete);
  await retainCaseArtifact(completePath,json(manifest));complete=manifest;
  return {...complete,state:'COMPLETE',directory:out,reused};
}
const copy=value=>structuredClone(value);
export async function serviceAdjustmentCli({url,requestFile,out=null}={}){
  const origin=localOrigin(url);
  if(typeof requestFile!=='string'||!isAbsolute(requestFile))throw new TypeError('Select an absolute private UTF-8 request file.');
  const source=await readPrivateFile(resolve(requestFile),MAX_COMMISSIONING_BYTES*3),request=JSON.parse(decode(source));
  exact(request,['method','args'],['method','args']);if(!plain(request.args))throw new TypeError('Supply the original method arguments.');
  if(request.method==='delivery'){
    if(!out)throw new TypeError('Complete delivery requires --out with an original private output directory.');
    return completeDelivery(origin,request.args,out);
  }
  const {path,body}=apiRoute(request.method,request.args);
  if(request.method==='download'||request.method==='downloadBuyer'){
    if(!out)throw new TypeError('Original file receiving requires --out.');
    const directory=await privateDirectory(out),file=await fetchOriginalFile(origin,path,body);
    await retainCaseArtifact(join(directory,file.name),file.body);
    const manifest={schema:'stellar-forge.service-adjustment-file-receiving.v1',requestSha256:sha(source),request,
      file:{name:file.name,type:file.type,bytes:file.bytes,sha256:file.sha256}};
    await retainCaseArtifact(join(directory,'service-adjustment-file.json'),json(manifest));
    return {...manifest,state:'COMPLETE',directory};
  }
  let directory,retained;
  if(out){
    directory=await privateDirectory(out);const original=join(directory,'service-adjustment-operation.json');
    retained={schema:'stellar-forge.service-adjustment-cli-operation.v1',requestSha256:sha(source),request};
    await retainCaseArtifact(original,json(retained));
    const completed=await optionalJson(join(directory,'service-adjustment-result.json'));
    if(completed){if(completed.requestSha256!==retained.requestSha256)throw new Error('This directory belongs to another original operation.');return {...completed,reused:true,directory};}
  }
  const result=await requestJson(origin,path,body);
  const selected=request.method==='sources'?result.accounting:request.method==='buyerSources'?result.buyer:result;
  if(directory){
    const completed={schema:'stellar-forge.service-adjustment-cli-result.v1',requestSha256:retained.requestSha256,result:selected};
    await retainCaseArtifact(join(directory,'service-adjustment-result.json'),json(completed));
    return {state:'COMPLETE',directory,requestSha256:retained.requestSha256,file:'service-adjustment-result.json',
      ...(selected.case?{case:selected.case}:{}),...(selected.material?{material:{id:selected.material.id,schema:selected.material.schema,sha256:selected.material.sha256}}:{})};
  }
  return selected;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const {values}=parseArgs({options:{url:{type:'string'},'request-file':{type:'string'},out:{type:'string'},help:{type:'boolean'}},strict:true});
    if(values.help)process.stdout.write('node service-adjustments-cli.mjs --url http://127.0.0.1:PORT/ --request-file ABS [--out ABS]\n'+
      'Private request: {"method":"read|preview|prepareIntent|retain|execute|buyerRead|inspectBuyer|prepareBuyerIntent|retainBuyer|executeBuyer|delivery", "args":{...}}\n'+
      'The original Support server owns accounting and buyer workspaces. --out retains complete operation results or all selected delivery files.\n');
    else process.stdout.write(JSON.stringify(await serviceAdjustmentCli({url:values.url,requestFile:values['request-file'],out:values.out}),null,2)+'\n');
  }catch(error){process.stderr.write(JSON.stringify({error:error.code??'SERVICE_ADJUSTMENT_CLI_FAILED',detail:error.message})+'\n');process.exitCode=1;}
}
