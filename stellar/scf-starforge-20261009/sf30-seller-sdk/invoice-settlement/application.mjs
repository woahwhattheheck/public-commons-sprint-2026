// MIT. Original Applications lifecycle for the complete invoice settlement operator.
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {inspectMerchantRuntime} from '../../sf46-release/runtime-package.mjs';
import {absolute,plain,need} from '../../distribution/runtime-workspace/storage.mjs';

const SOURCE='stellar/scf-starforge-20261009/sf30-seller-sdk/invoice-settlement';
const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
export const INVOICE_SETTLEMENT_READY_SCHEMA='stellar-forge.invoice-settlement-workspace-startup.v1';
const privateSettings=[['connectionsFile','--connections-file'],['profileFile','--profile-file']];
const field=(name,label,type='path',required=false,description='')=>({name,label,type,required,description});
const originalFiles=[
  'cli.mjs','server.mjs','operator.mjs','workspace.mjs','common.mjs','receiving.mjs',
  'native.mjs','events.mjs','lossless-json.mjs','reconciliation.mjs','archive.mjs','runtime.mjs',
  'browser-assets.json','source-files.json','source/elementpay-listener.json','source/elementpay-contracts.json','source/elementflow-contracts.json',
  'web/index.html','web/app.mjs','web/styles.css'
];

function loopback(value='127.0.0.1'){
  need(value==='127.0.0.1'||value==='::1','APPLICATION_INVOICE_SETTLEMENT_HOST_INVALID',
    'Select 127.0.0.1 or ::1 for the local invoice settlement workspace.');
  return value;
}
export function invoiceSettlementApplication(common=[]){
  return {
    id:'stellar-invoice-settlement',
    command:'stellar-invoice-settlement',
    title:'Invoice settlement',
    terminal:false,
    requiredSource:SOURCE+'/cli.mjs',
    description:'Operate invoice programmes, original API and EVM observations, authenticated webhook receipts, listener delivery recovery, settlement reconciliation, reports and complete receiving.',
    fields:[
      field('workspaceDirectory','Private invoice workspace','path',true,
        'Create or reopen the complete invoice workspace, including its programmes, source observations, webhook receipts, delivery attempts, reports and receiving history.'),
      field('connectionsFile','Private source connections','path',false,
        'An alias-to-connection JSON file outside the workspace. It selects original source endpoints, host-private credentials and retained ethers runtime directories.'),
      field('profileFile','Programme profile','path',false,
        'Optional JSON describing the operator and programme. Existing saved profile revisions remain in the workspace.'),
      field('host','Local listen address','text',false,
        'Use 127.0.0.1 (default) or ::1. The application publishes its actual local port when it starts.'),
      ...common
    ]
  };
}

export async function prepareInvoiceSettlementApplication(settings,{inputPath,runtimeDirectory}={}){
  need(plain(settings)&&typeof inputPath==='function','APPLICATION_INVOICE_SETTLEMENT_INPUT_READER_REQUIRED');
  const directory=absolute(settings.workspaceDirectory),selected=await inputPath(directory,'directory',true,true);
  const inputs=[selected],createDirectories=selected.exists?[]:[directory];
  const runtime=await inspectMerchantRuntime(absolute(runtimeDirectory),{load:false});
  const sourceDirectory=join(runtime.sourceRoot,SOURCE);
  for(const filename of originalFiles)inputs.push(await inputPath(join(sourceDirectory,filename),'file'));
  const native=await import(pathToFileURL(join(sourceDirectory,'workspace.mjs')).href);
  const operator=await import(pathToFileURL(join(sourceDirectory,'operator.mjs')).href);
  need(typeof native.inspectInvoiceWorkspace==='function'&&typeof operator.loadInvoiceSettlementConfiguration==='function',
    'APPLICATION_INVOICE_SETTLEMENT_SOURCE_REQUIRED','Select the complete original invoice settlement runtime.');
  const identity=selected.exists?await native.inspectInvoiceWorkspace({directory,allowMissing:true}):null;
  const host=loopback(settings.host===undefined||settings.host===''?'127.0.0.1':settings.host);
  const args=['serve','--workspace',directory,'--startup-format','json','--host',host];
  if(identity!==null){
    need(plain(identity)&&UUID.test(identity.workspaceId??'')&&Number.isSafeInteger(identity.revision)&&identity.revision>=0,
      'APPLICATION_INVOICE_SETTLEMENT_WORKSPACE_ID_REQUIRED');
    args.push('--expected-workspace-id',identity.workspaceId);
  }
  const configuration={workspaceDirectory:directory};
  for(const [setting,flag]of privateSettings){
    if(settings[setting]===undefined||settings[setting]==='')continue;
    const descriptor=await inputPath(absolute(settings[setting]),'file',false,true);
    inputs.push(descriptor);args.push(flag,descriptor.path);configuration[setting]=descriptor.path;
  }
  // The CLI owns connection aliases, profile semantics and private credential placement.
  // Only the original input descriptors and argument paths enter Applications state.
  await operator.loadInvoiceSettlementConfiguration(configuration);
  return {args,inputs,createDirectories:[...new Set(createDirectories)]};
}

function option(request,name,optional=false){
  need(Array.isArray(request.args),'APPLICATION_INVOICE_SETTLEMENT_STARTUP_CHANGED');
  const positions=request.args.flatMap((value,index)=>value===name?[index]:[]);
  if(optional&&positions.length===0)return undefined;
  need(positions.length===1&&typeof request.args[positions[0]+1]==='string'&&
    request.args[positions[0]+1]&&!request.args[positions[0]+1].startsWith('--'),
    'APPLICATION_INVOICE_SETTLEMENT_STARTUP_CHANGED');
  return request.args[positions[0]+1];
}

export async function invoiceSettlementStartup(request,text){
  if(request.command!=='stellar-invoice-settlement'||request.pythonCommand||request.args?.[0]!=='serve'||
    typeof text!=='string'||text.length>16384)return null;
  let value;try{value=JSON.parse(text);}catch{return null;}
  if(!plain(value)||value.schema!==INVOICE_SETTLEMENT_READY_SCHEMA||value.status!=='INVOICE_SETTLEMENT_READY')return null;
  need(option(request,'--startup-format')==='json','APPLICATION_INVOICE_SETTLEMENT_STARTUP_CHANGED');
  const directory=absolute(option(request,'--workspace'));
  const sourceDirectory=join(absolute(request.releaseDirectory),'source',SOURCE);
  const expectedId=option(request,'--expected-workspace-id',true);
  const host=loopback(option(request,'--host',true)??'127.0.0.1');
  const requestedPort=option(request,'--port',true)??'0';
  need(/^(?:0|[1-9][0-9]{0,4})$/.test(requestedPort)&&Number(requestedPort)<=65535,
    'APPLICATION_INVOICE_SETTLEMENT_STARTUP_CHANGED');
  need(value.workspaceDirectory===directory&&value.sourceDirectory===sourceDirectory&&
    UUID.test(value.workspaceId??'')&&(expectedId===undefined||expectedId===value.workspaceId)&&
    Number.isSafeInteger(value.revision)&&value.revision>=0&&Number.isSafeInteger(value.pid)&&value.pid>0&&
    value.host===host&&Number.isSafeInteger(value.port)&&value.port>=1&&value.port<=65535&&
    (Number(requestedPort)===0||Number(requestedPort)===value.port),'APPLICATION_INVOICE_SETTLEMENT_STARTUP_CHANGED');
  const selectedPrivate={};
  for(const [setting,flag]of privateSettings){
    const argument=option(request,flag,true),path=argument===undefined?null:absolute(argument);
    need((value[setting]??null)===path,'APPLICATION_INVOICE_SETTLEMENT_STARTUP_CHANGED');
    selectedPrivate[setting]=path;
  }
  let url;try{url=new URL(value.url);}catch{need(false,'APPLICATION_INVOICE_SETTLEMENT_STARTUP_CHANGED');}
  need(url.protocol==='http:'&&url.hostname===(host==='::1'?'[::1]':'127.0.0.1')&&
    !url.username&&!url.password&&!url.search&&url.pathname==='/'&&
    /^#token=[A-Za-z0-9_-]{43}$/.test(url.hash)&&Number(url.port||80)===value.port,
    'APPLICATION_INVOICE_SETTLEMENT_STARTUP_CHANGED');
  const native=await import(pathToFileURL(join(sourceDirectory,'workspace.mjs')).href);
  need(typeof native.inspectInvoiceWorkspace==='function','APPLICATION_INVOICE_SETTLEMENT_SOURCE_REQUIRED');
  const identity=await native.inspectInvoiceWorkspace({directory});
  need(plain(identity)&&identity.workspaceId===value.workspaceId&&
    Number.isSafeInteger(identity.revision)&&identity.revision>=value.revision,
    'APPLICATION_INVOICE_SETTLEMENT_STARTUP_CHANGED');
  return {url:url.href,workspaceId:identity.workspaceId,original:{
    schema:INVOICE_SETTLEMENT_READY_SCHEMA,workspaceDirectory:directory,workspaceId:identity.workspaceId,
    revision:value.revision,...selectedPrivate,sourceDirectory,host,port:value.port,pid:value.pid
  }};
}
