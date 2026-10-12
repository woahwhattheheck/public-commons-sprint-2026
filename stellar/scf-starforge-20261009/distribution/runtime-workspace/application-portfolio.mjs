// MIT. One managed portfolio application retains the complete original workspace selection.
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {absolute,need,plain,digest,json,canonical} from './storage.mjs';
import {runbookWireHash} from '../../../../stellar-forge/mcp-merchant-operator/accounting-runbooks-contract.mjs';
const resourceHash=value=>digest(json(canonical(value)));
const ROOT='stellar/scf-starforge-20261009/merchant-settlement-accounting/workspace/';
const STARTUP='stellar-forge.accounting-workspace-startup.v1';
const BINDING='stellar-forge.accounting-portfolio-binding.v1';
const WORKSPACE_BINDING='stellar-forge.accounting-workspace-binding.v1';
const SHA=/^[a-f0-9]{64}$/,ALIAS=/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const field=(name,label,type='path',required=false,description='')=>({name,label,type,required,description});
export function portfolioApplication(common){
  return {id:'client-portfolio',command:'merchant-accounting-workspace',title:'Client portfolio',terminal:false,requiredSource:ROOT+'portfolio-connections.mjs',
    description:'Commission client close procedures, plan named capacity, retain lead-to-backup handovers and reopen each original client desk inside the same portfolio host.',
    fields:[field('configPath','Original accounting host configuration','path',true,
      'Select the existing JSON configuration containing the coordinator and its separately initialized accounting.workspaces.'),
      field('coordinatorAlias','Coordinator workspace alias','text',true,
        'Select the existing workspace whose portfolioClients maps client aliases to their original workspaces.'),...common]};
}
export function checkedPortfolioBinding(binding,{configPath,coordinatorAlias,sha256}={}){
  need(plain(binding)&&binding.schema===BINDING&&binding.configPath===absolute(binding.configPath)&&
    SHA.test(binding.configSha256??'')&&ALIAS.test(binding.coordinatorAlias??'')&&SHA.test(binding.sha256??'')&&
    Array.isArray(binding.clients)&&binding.clients.length<=15,'APPLICATION_PORTFOLIO_BINDING_CHANGED','Use the complete original portfolio configuration binding.');
  const {sha256:actual,...value}=binding;
  need(runbookWireHash(value)===actual&&(sha256===undefined||sha256===actual)&&
    (configPath===undefined||binding.configPath===absolute(configPath))&&
    (coordinatorAlias===undefined||binding.coordinatorAlias===coordinatorAlias),
    'APPLICATION_PORTFOLIO_BINDING_CHANGED','The configured coordinator or original client selection differs from its reviewed digest.');
  const rows=[binding.coordinator,...binding.clients];
  need(rows.every(row=>plain(row)&&row.schema===WORKSPACE_BINDING&&
    ALIAS.test(row.alias??'')&&ALIAS.test(row.workspaceAlias??'')&&row.directory===absolute(row.directory)&&
    SHA.test(row.workspaceId??'')&&SHA.test(row.sourcesSha256??'')&&plain(row.sources))&&
    binding.coordinator.alias===binding.coordinatorAlias&&binding.coordinator.workspaceAlias===binding.coordinatorAlias&&
    new Set(rows.map(row=>row.directory)).size===rows.length&&new Set(rows.map(row=>row.workspaceId)).size===rows.length&&
    new Set(binding.clients.map(row=>row.alias)).size===binding.clients.length,
    'APPLICATION_PORTFOLIO_BINDING_CHANGED','Keep distinct original coordinator and client workspace identities.');
  return binding;
}
export async function preparePortfolioApplication(settings,inputPath,runtimeDirectory){
  need(ALIAS.test(settings.coordinatorAlias??''),'APPLICATION_PORTFOLIO_ALIAS_INVALID','Choose the coordinator alias in the original host configuration.');
  const config=await inputPath(settings.configPath,'file');
  const {inspectMerchantRuntime}=await import('../../sf46-release/runtime-package.mjs');
  const selected=await inspectMerchantRuntime(runtimeDirectory,{load:false}),module=join(selected.sourceRoot,ROOT+'portfolio-connections.mjs');
  const inputs=[config,await inputPath(module,'file'),await inputPath(join(selected.sourceRoot,ROOT+'server.mjs'),'file')];
  const original=await import(pathToFileURL(module).href);
  need(typeof original.inspectPortfolioConfiguration==='function','APPLICATION_PORTFOLIO_BINDING_UNAVAILABLE',
    'Choose an installed runtime containing the original portfolio configuration inspector.');
  const binding=checkedPortfolioBinding(await original.inspectPortfolioConfiguration(settings.configPath,settings.coordinatorAlias),
    {configPath:settings.configPath,coordinatorAlias:settings.coordinatorAlias});
  const paths=new Set(inputs.map(row=>row.path));
  const add=async(path,type='directory',missing=false,privateOnly=false)=>{
    if(path&&!paths.has(path)){inputs.push(await inputPath(path,type,missing,privateOnly));paths.add(path);}
  };
  for(const row of [binding.coordinator,...binding.clients]){
    await add(row.directory,'directory',false,true);
    for(const name of ['outboxDir','proofDir','recoveredDir'])await add(row.sources[name],'directory',false,true);
    for(const name of ['termsFile','buyerSourceFile'])await add(row.sources[name],'file');
    if(row.recovery)for(const name of ['stateRoot','backupRoot'])await add(row.recovery[name],'directory',true,true);
  }
  const resourceKeys=[binding.coordinator,...binding.clients].map(row=>resourceHash({family:'merchant-accounting',directory:row.directory})).sort();
  return {args:['--workspace',binding.coordinator.directory,
      '--expected-workspace-id',binding.coordinator.workspaceId,'--expected-sources-sha256',binding.coordinator.sourcesSha256,
      '--portfolio-config',binding.configPath,'--portfolio-workspace',binding.coordinatorAlias,
      '--expected-portfolio-sha256',binding.sha256,'--desk','client-portfolio'],
    inputs,createDirectories:[],binding,
    resourceKey:resourceHash({family:'merchant-accounting',directory:binding.coordinator.directory}),resourceKeys};
}
function selected(request,name){
  const positions=request.args.flatMap((value,index)=>value===name?[index]:[]);
  need(positions.length===1&&typeof request.args[positions[0]+1]==='string','APPLICATION_PORTFOLIO_STARTUP_CHANGED');
  return request.args[positions[0]+1];
}
export function portfolioStartup(request,text){
  if(request.command!=='merchant-accounting-workspace'||!Array.isArray(request.args)||typeof text!=='string'||text.length>128*1024||!text.startsWith('{'))return null;
  let value;try{value=JSON.parse(text);}catch{return null;}
  if(!plain(value)||value.schema!==STARTUP||value.status!=='ACCOUNTING_WORKSPACE_READY')return null;
  const directory=absolute(selected(request,'--workspace')),workspaceId=selected(request,'--expected-workspace-id'),
    sourcesSha256=selected(request,'--expected-sources-sha256'),desk=selected(request,'--desk'),port=selected(request,'--port');
  const binding=checkedPortfolioBinding(value.portfolioBinding,{
    configPath:selected(request,'--portfolio-config'),coordinatorAlias:selected(request,'--portfolio-workspace'),sha256:selected(request,'--expected-portfolio-sha256')});
  need(SHA.test(workspaceId)&&SHA.test(sourcesSha256)&&desk==='client-portfolio'&&/^(0|[1-9]\d*)$/.test(port)&&Number(port)<=65535&&
    binding.coordinator.directory===directory&&binding.coordinator.workspaceId===workspaceId&&binding.coordinator.sourcesSha256===sourcesSha256&&
    value.directory===directory&&value.workspaceId===workspaceId&&value.sourcesSha256===sourcesSha256&&Number.isSafeInteger(value.revision)&&value.revision>=1,
    'APPLICATION_PORTFOLIO_STARTUP_CHANGED','The original startup must name the reviewed complete portfolio and original coordinator.');
  let url;try{url=new URL(value.operatorUrl);}catch{need(false,'APPLICATION_PORTFOLIO_STARTUP_CHANGED');}
  const actualPort=Number(url.port||80);
  need(url.protocol==='http:'&&url.hostname==='127.0.0.1'&&actualPort>=1&&actualPort<=65535&&(port==='0'||Number(port)===actualPort)&&
    !url.username&&!url.password&&!url.search&&!url.hash&&url.pathname==='/portfolio.html','APPLICATION_PORTFOLIO_STARTUP_CHANGED');
  return {url:url.href,workspaceId,original:{schema:STARTUP,directory,workspaceId,sourcesSha256,revision:value.revision,portfolioBinding:binding}};
}
