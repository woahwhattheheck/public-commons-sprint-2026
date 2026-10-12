// MIT. Original Applications lifecycle for the complete Stellar client operator.
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {inspectMerchantRuntime} from '../../sf46-release/runtime-package.mjs';
import {absolute,plain,need,regular} from '../../distribution/runtime-workspace/storage.mjs';

const SOURCE='stellar/scf-starforge-20261009/sf30-seller-sdk/stellar-indexer';
const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
export const STELLAR_INDEXER_READY_SCHEMA='stellar-forge.stellar-indexer-workspace-startup.v1';
const field=(name,label,type='path',required=false,description='')=>({name,label,type,required,description});
const privateSettings=[
  ['connectionsFile','--connections-file'],
  ['eventConnectionFile','--event-connection-file'],
  ['eventConnectionsFile','--event-connections-file'],
  ['eventPublicationsFile','--event-publications-file']
];
export function stellarIndexerApplication(common){
  return {
    id:'stellar-client-indexer',
    command:'stellar-indexer-workspace',
    title:'Stellar client workspace',
    terminal:false,
    requiredSource:SOURCE+'/server.mjs',
    description:'Operate original Indexer queries, resumable client captures, edition comparison and native event watches with complete source and customer receiving.',
    fields:[
      field('workspaceDirectory','Private client workspace','path',true,
        'Reopen the original client directory. Native Indexer source lives under indexer; original event services live under events.'),
      field('installationDirectory','Existing SDK installation project','path',false,
        'Optional installed SDK project selected before runtime retention. A separate project can supply the SDK for this client application.'),
      field('connectionsFile','Private Indexer connections','path',false,
        'Alias-to-connection JSON using network, consumerToken or consumerTokenEnv, and optional apiUrl. Leave empty for retained source review.'),
      field('eventWorkspaceDirectory','Existing event workspace','path',false,
        'Optional original event directory; otherwise the client directory selects its events subdirectory.'),
      field('eventConnectionFile','Default private Stellar RPC connection','path',false,
        'The original rpcUrl, network and optional private header configuration.'),
      field('eventConnectionsFile','Named private Stellar RPC connections','path',false,
        'Aliases select primary and archival RPC sources for the original watch engine.'),
      field('eventPublicationsFile','Private publication destinations','path',false,
        'An alias map to original publication directories and optional feed/source settings.'),
      ...common
    ]
  };
}
export async function prepareStellarIndexerApplication(settings,{inputPath,runtimeDirectory}={}){
  need(plain(settings)&&typeof inputPath==='function','APPLICATION_STELLAR_INDEXER_INPUT_READER_REQUIRED');
  const directory=absolute(settings.workspaceDirectory),selected=await inputPath(directory,'directory',true,true);
  const inputs=[selected],createDirectories=selected.exists?[]:[directory];
  const runtime=await inspectMerchantRuntime(absolute(runtimeDirectory),{load:false}),sourceDirectory=join(runtime.sourceRoot,SOURCE);
  for(const name of ['server.mjs','operator.mjs','cli.mjs','engine.mjs','sdk-native.mjs','common.mjs','receiving.mjs','runtime.mjs','browser-assets.json'])
    inputs.push(await inputPath(join(sourceDirectory,name),'file'));
  const native=await import(pathToFileURL(join(sourceDirectory,'engine.mjs')).href);
  need(typeof native.inspectStellarIndexerWorkspace==='function','APPLICATION_STELLAR_INDEXER_SOURCE_REQUIRED',
    'Choose the complete original Stellar client runtime.');
  const identity=selected.exists?await native.inspectStellarIndexerWorkspace({directory:join(directory,'indexer'),allowMissing:true}):null;
  const args=['--workspace',directory,'--startup-format','json'];
  if(identity?.exists){
    need(UUID.test(identity.workspaceId??''),'APPLICATION_STELLAR_INDEXER_WORKSPACE_ID_REQUIRED');
    args.push('--expected-workspace-id',identity.workspaceId);
  }
  if(settings.eventWorkspaceDirectory){
    const eventDirectory=absolute(settings.eventWorkspaceDirectory),eventInput=await inputPath(eventDirectory,'directory',true,true);
    inputs.push(eventInput);if(!eventInput.exists)createDirectories.push(eventDirectory);
    args.push('--event-workspace',eventDirectory);
  }
  if(settings.installationDirectory){
    const installation=await inputPath(absolute(settings.installationDirectory),'directory',false,true);
    inputs.push(installation);args.push('--installation-directory',installation.path);
  }
  for(const [setting,flag]of privateSettings){
    if(!settings[setting])continue;
    const selected=await inputPath(absolute(settings[setting]),'file',false,true),bytes=await regular(selected.path,2*1024*1024);
    let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
    catch{need(false,'APPLICATION_STELLAR_INDEXER_PRIVATE_JSON_REQUIRED');}
    need(plain(value),'APPLICATION_STELLAR_INDEXER_PRIVATE_JSON_REQUIRED');
    inputs.push(selected);args.push(flag,selected.path);
  }
  return {args,inputs,createDirectories:[...new Set(createDirectories)]};
}
function option(request,name,optional=false){
  need(Array.isArray(request.args),'APPLICATION_STELLAR_INDEXER_STARTUP_CHANGED');
  const positions=request.args.flatMap((value,index)=>value===name?[index]:[]);
  if(optional&&positions.length===0)return undefined;
  need(positions.length===1&&typeof request.args[positions[0]+1]==='string'&&!request.args[positions[0]+1].startsWith('--'),
    'APPLICATION_STELLAR_INDEXER_STARTUP_CHANGED');
  return request.args[positions[0]+1];
}
export async function stellarIndexerStartup(request,text){
  if(request.command!=='stellar-indexer-workspace'||!request.args?.includes('--workspace')||
    typeof text!=='string'||text.length>16384||!text.startsWith('{"schema":"'+STELLAR_INDEXER_READY_SCHEMA+'",'))return null;
  let value;try{value=JSON.parse(text);}catch{return null;}
  if(!plain(value)||value.schema!==STELLAR_INDEXER_READY_SCHEMA||value.status!=='STELLAR_INDEXER_READY')return null;
  need(option(request,'--startup-format')==='json','APPLICATION_STELLAR_INDEXER_STARTUP_CHANGED');
  const directory=absolute(option(request,'--workspace')),indexerDirectory=join(directory,'indexer');
  const eventOption=option(request,'--event-workspace',true),eventDirectory=eventOption?absolute(eventOption):join(directory,'events');
  const sourceDirectory=join(absolute(request.releaseDirectory),'source',SOURCE),expectedId=option(request,'--expected-workspace-id',true);
  need(value.directory===directory&&value.indexerDirectory===indexerDirectory&&value.eventDirectory===eventDirectory&&
    value.sourceDirectory===sourceDirectory&&UUID.test(value.workspaceId??'')&&
    (expectedId===undefined||expectedId===value.workspaceId)&&Number.isSafeInteger(value.pid)&&value.pid>0,
    'APPLICATION_STELLAR_INDEXER_STARTUP_CHANGED');
  const installationOption=option(request,'--installation-directory',true),installationDirectory=installationOption?absolute(installationOption):null;
  need((value.installationDirectory??null)===installationDirectory,'APPLICATION_STELLAR_INDEXER_STARTUP_CHANGED');
  const selectedPrivate={installationDirectory};
  for(const [setting,flag]of privateSettings){
    const argument=option(request,flag,true),path=argument?absolute(argument):null;
    need((value[setting]??null)===path,'APPLICATION_STELLAR_INDEXER_STARTUP_CHANGED');selectedPrivate[setting]=path;
  }
  const native=await import(pathToFileURL(join(sourceDirectory,'engine.mjs')).href);
  const identity=await native.inspectStellarIndexerWorkspace({directory:indexerDirectory});
  need(identity.exists&&identity.workspaceId===value.workspaceId,'APPLICATION_STELLAR_INDEXER_STARTUP_CHANGED');
  const port=Number(option(request,'--port',true)??0);let url;
  try{url=new URL(value.url);}catch{need(false,'APPLICATION_STELLAR_INDEXER_STARTUP_CHANGED');}
  need(url.protocol==='http:'&&url.hostname==='127.0.0.1'&&!url.username&&!url.password&&!url.search&&url.pathname==='/'&&
    /^#token=[A-Za-z0-9_-]{43}$/.test(url.hash)&&Number.isInteger(port)&&port>=0&&port<=65535&&
    Number(url.port||80)>=1&&Number(url.port||80)<=65535&&(port===0||Number(url.port||80)===port),
    'APPLICATION_STELLAR_INDEXER_STARTUP_CHANGED');
  return {url:url.href,original:{schema:STELLAR_INDEXER_READY_SCHEMA,directory,indexerDirectory,eventDirectory,
    workspaceId:identity.workspaceId,...selectedPrivate,sourceDirectory,pid:value.pid}};
}
