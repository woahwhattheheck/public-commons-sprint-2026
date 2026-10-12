// MIT. Cryptoworth uses the original managed accounting workspace and lease.
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {absolute,need,plain,digest,json,canonical} from './storage.mjs';
const hash=value=>digest(json(canonical(value)));
const ROOT='stellar/scf-starforge-20261009/merchant-settlement-accounting/workspace/';
const STARTUP='stellar-forge.accounting-workspace-startup.v1',BINDING='stellar-forge.accounting-workspace-binding.v1',SHA=/^[a-f0-9]{64}$/;
const field=(name,label,type='path',required=false,description='')=>({name,label,type,required,description});
export function cryptoworthApplication(common){
  return {id:'cryptoworth',command:'merchant-accounting-workspace',title:'Cryptoworth accounting',terminal:false,requiredSource:ROOT+'binding.mjs',
    description:'Reopen the original merchant accounting workspace with customer template mappings, frozen sources, native import comparisons, accountant returns and receiving packets.',
    fields:[field('workspaceDirectory','Original accounting workspace','path',true,
      'Select the initialized private workspace. Its original sources, merchant receipts, frozen periods and receiving history remain in use.'),...common]};
}
export async function prepareCryptoworthApplication(settings,inputPath,runtimeDirectory,{desk='cryptoworth'}={}){
  need(['cryptoworth','runbooks'].includes(desk),'APPLICATION_ACCOUNTING_DESK_INVALID','Choose Cryptoworth or client runbooks.');
  const workspace=await inputPath(settings.workspaceDirectory,'directory',false,true);
  const {inspectMerchantRuntime}=await import('../../sf46-release/runtime-package.mjs');
  const selected=await inspectMerchantRuntime(runtimeDirectory,{load:false}),module=join(selected.sourceRoot,ROOT+'binding.mjs');
  const inputs=[workspace,await inputPath(module,'file'),await inputPath(join(selected.sourceRoot,ROOT+'server.mjs'),'file')];
  const original=await import(pathToFileURL(module).href);
  need(typeof original.inspectAccountingWorkspaceBinding==='function','APPLICATION_CRYPTOWORTH_BINDING_UNAVAILABLE',
    'Choose an installed runtime containing the original accounting workspace binding inspector.');
  const binding=await original.inspectAccountingWorkspaceBinding(settings.workspaceDirectory);
  need(plain(binding)&&binding.schema===BINDING&&binding.directory===absolute(settings.workspaceDirectory)&&SHA.test(binding.workspaceId??'')&&SHA.test(binding.sourcesSha256??''),
    'APPLICATION_CRYPTOWORTH_BINDING_CHANGED','Select the same original accounting workspace and source configuration.');
  for(const field of ['outboxDir','proofDir','recoveredDir'])if(binding.sources[field])inputs.push(await inputPath(binding.sources[field],'directory',false,true));
  inputs.push(await inputPath(binding.sources.termsFile,'file'));
  return {args:['--workspace',binding.directory,'--expected-workspace-id',binding.workspaceId,'--expected-sources-sha256',binding.sourcesSha256,'--desk',desk],
    inputs,binding,resourceKey:hash({family:'merchant-accounting',directory:binding.directory})};
}
function selected(request,name){
  const positions=request.args.flatMap((value,index)=>value===name?[index]:[]);
  need(positions.length===1&&typeof request.args[positions[0]+1]==='string','APPLICATION_CRYPTOWORTH_STARTUP_CHANGED');
  return request.args[positions[0]+1];
}
export function cryptoworthStartup(request,text,{desk:expectedDesk='cryptoworth'}={}){
  need(['cryptoworth','runbooks'].includes(expectedDesk),'APPLICATION_ACCOUNTING_DESK_INVALID');
  if(request.command!=='merchant-accounting-workspace'||!Array.isArray(request.args)||typeof text!=='string'||text.length>16384||!text.startsWith('{'))return null;
  let value;try{value=JSON.parse(text);}catch{return null;}
  if(!plain(value)||value.schema!==STARTUP||value.status!=='ACCOUNTING_WORKSPACE_READY')return null;
  const directory=absolute(selected(request,'--workspace')),workspaceId=selected(request,'--expected-workspace-id'),
    sourcesSha256=selected(request,'--expected-sources-sha256'),desk=selected(request,'--desk'),port=selected(request,'--port');
  need(SHA.test(workspaceId)&&SHA.test(sourcesSha256)&&desk===expectedDesk&&/^(0|[1-9]\d*)$/.test(port)&&Number(port)<=65535&&
    value.directory===directory&&value.workspaceId===workspaceId&&value.sourcesSha256===sourcesSha256&&Number.isSafeInteger(value.revision)&&value.revision>=1,
    'APPLICATION_CRYPTOWORTH_STARTUP_CHANGED','The original startup must name the reviewed accounting workspace and source configuration.');
  let url;try{url=new URL(value.operatorUrl);}catch{need(false,'APPLICATION_CRYPTOWORTH_STARTUP_CHANGED');}
  const actualPort=Number(url.port||80);
  need(url.protocol==='http:'&&url.hostname==='127.0.0.1'&&actualPort>=1&&actualPort<=65535&&(port==='0'||Number(port)===actualPort)&&
    !url.username&&!url.password&&!url.search&&!url.hash&&url.pathname==='/'+expectedDesk+'.html','APPLICATION_CRYPTOWORTH_STARTUP_CHANGED');
  return {url:url.href,original:{schema:STARTUP,directory,workspaceId,sourcesSha256,revision:value.revision}};
}
