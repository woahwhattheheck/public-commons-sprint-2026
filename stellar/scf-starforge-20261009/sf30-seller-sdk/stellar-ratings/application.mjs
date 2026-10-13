// MIT. Original Applications lifecycle for the complete Stellar ratings operator.
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {inspectMerchantRuntime} from '../../sf46-release/runtime-package.mjs';
import {absolute,plain,need} from '../../distribution/runtime-workspace/storage.mjs';

const SOURCE='stellar/scf-starforge-20261009/sf30-seller-sdk/stellar-ratings';
const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
export const STELLAR_RATINGS_READY_SCHEMA='stellar-forge.stellar-ratings-workspace-startup.v1';
const privateSettings=[['connectionsFile','--connections-file'],['profileFile','--profile-file']];
const field=(name,label,type='path',required=false,description='')=>({name,label,type,required,description});
const originalFiles=[
  "cli.mjs",
  "server.mjs",
  "operator.mjs",
  "workspace.mjs",
  "common.mjs",
  "worker.mjs",
  "receiving.mjs",
  "native.mjs",
  "stellar.mjs",
  "stellar.mjs",
  "lossless-json.mjs",
  "reconciliation.mjs",
  "archive.mjs",
  "runtime.mjs",
  "browser-assets.json",
  "source-files.json",
  "source/stellar-sdk-registry.json",
  "source/contracts.json",
  "source/stellar-expert-openapi.json",
  "source/stellar-native-source.json",
  "web/index.html",
  "web/app.mjs",
  "web/styles.css"
];

function loopback(value='127.0.0.1'){
  need(value==='127.0.0.1'||value==='::1','APPLICATION_STELLAR_RATINGS_HOST_INVALID',
    'Select 127.0.0.1 or ::1 for the local Stellar ratings workspace.');
  return value;
}
export function stellarRatingsApplication(common=[]){
  return {
    id:'stellar-ratings',
    command:'stellar-ratings',
    title:'Stellar ratings',
    terminal:false,
    requiredSource:SOURCE+'/cli.mjs',
    description:'Operate versioned Stellar asset registries, original wallet and daily activity sources, saved methodology, complete result editions, reports and independent receiving.',
    fields:[
      field('workspaceDirectory','Private Stellar ratings workspace','path',true,
        'Create or reopen versioned asset registries and wallet policies, complete source captures, wallet and daily activity editions, collection progress, private lookup counts, reports and receiving history.'),
      field('connectionsFile','Private source connections','path',false,
        'An alias-to-connection JSON file outside the workspace. It selects original source endpoints, host-private credentials and retained original Stellar SDK runtime directories.'),
      field('profileFile','Workspace profile','path',false,
        'Optional JSON describing the operator and workspace. Existing saved profile revisions remain in the workspace.'),
      field('runtimeDirectory','Retained original Stellar runtime','path',false,
        'Select a complete retained Stellar SDK 17.2.1 runtime. Its original manifest is pinned before launch.'),
      field('installationDirectory','Original installed packages','path',false,
        'Optional existing project containing the original Stellar SDK 17.2.1 package and dependencies. Use runtime-install first for a fresh project.'),
      field('expectedManifestSha256','Expected runtime manifest SHA256','text',false,
        'Optional exact hash for the selected retained runtime; its complete manifest is checked before launch.'),
      field('collectDaily','Daily collection at startup','text',false,
        'Use on to enable collection of closed UTC days at startup; off uses the saved workspace setting.'),
      field('host','Local listen address','text',false,
        'Use 127.0.0.1 (default) or ::1. The application publishes its actual local port when it starts.'),
      ...(common.some(item=>item.name==='port')?[]:[field('port','Local port','port',false,
        'Use 8777 (default) to keep the same browser recovery origin. Use 0 for an explicitly selected available port.')]),
      ...common.map(item=>item.name==='port'?{...item,description:
        'Use 8777 (default) to keep the same browser recovery origin. Use 0 for an explicitly selected available port.'}:item)
    ]
  };
}

export async function prepareStellarRatingsApplication(settings,{inputPath,runtimeDirectory}={}){
  need(plain(settings)&&typeof inputPath==='function','APPLICATION_STELLAR_RATINGS_INPUT_READER_REQUIRED');
  const directory=absolute(settings.workspaceDirectory),selected=await inputPath(directory,'directory',true,true);
  const inputs=[selected],createDirectories=selected.exists?[]:[directory];
  const runtime=await inspectMerchantRuntime(absolute(runtimeDirectory),{load:false});
  const sourceDirectory=join(runtime.sourceRoot,SOURCE);
  for(const filename of originalFiles)inputs.push(await inputPath(join(sourceDirectory,filename),'file'));
  const native=await import(pathToFileURL(join(sourceDirectory,'workspace.mjs')).href);
  const operator=await import(pathToFileURL(join(sourceDirectory,'operator.mjs')).href);
  need(typeof native.inspectStellarRatingsWorkspace==='function'&&typeof operator.loadStellarRatingsConfiguration==='function',
    'APPLICATION_STELLAR_RATINGS_SOURCE_REQUIRED','Select the complete original Stellar ratings runtime.');
  const identity=selected.exists?await native.inspectStellarRatingsWorkspace({directory,allowMissing:true}):null;
  const host=loopback(settings.host===undefined||settings.host===''?'127.0.0.1':settings.host);
  const selectedPort=settings.port===undefined||settings.port===''?8777:Number(settings.port);
  need(Number.isSafeInteger(selectedPort)&&selectedPort>=0&&selectedPort<=65535,
    'APPLICATION_STELLAR_RATINGS_PORT_INVALID','Select a local port from 0 to 65535.');
  const args=['serve','--workspace',directory,'--startup-format','json','--host',host,'--port',String(selectedPort)];
  if(identity!==null){
    need(plain(identity)&&UUID.test(identity.workspaceId??'')&&Number.isSafeInteger(identity.revision)&&identity.revision>=0,
      'APPLICATION_STELLAR_RATINGS_WORKSPACE_ID_REQUIRED');
    args.push('--expected-workspace-id',identity.workspaceId);
  }

  const originalRuntime=await import(pathToFileURL(join(sourceDirectory,'runtime.mjs')).href);
  if(settings.expectedManifestSha256!==undefined&&settings.expectedManifestSha256!=='')
    need(/^[a-f0-9]{64}$/.test(settings.expectedManifestSha256)&&settings.runtimeDirectory,
      'APPLICATION_STELLAR_RATINGS_RUNTIME_HASH_INVALID','Select a retained runtime and its exact lowercase SHA256 manifest hash.');
  if(settings.runtimeDirectory!==undefined&&settings.runtimeDirectory!==''){
    const selectedRuntime=await inputPath(absolute(settings.runtimeDirectory),'directory',false,true);
    inputs.push(selectedRuntime);
    inputs.push(await inputPath(join(selectedRuntime.path,'manifest.json'),'file',false,true));
    need(typeof originalRuntime.readRatingsRuntimeManifest==='function','APPLICATION_STELLAR_RATINGS_SOURCE_REQUIRED');
    const manifest=await originalRuntime.readRatingsRuntimeManifest({directory:selectedRuntime.path,
      ...(settings.expectedManifestSha256?{expectedManifestSha256:settings.expectedManifestSha256}:{})});
    need(/^[a-f0-9]{64}$/.test(manifest.manifestSha256)&&manifest.manifest?.stellar?.version==='17.2.1',
      'APPLICATION_STELLAR_RATINGS_RUNTIME_REQUIRED','Select the complete original Stellar SDK 17.2.1 runtime.');
    args.push('--runtime-directory',selectedRuntime.path,'--expected-manifest-sha256',manifest.manifestSha256);
  }
  if(settings.installationDirectory!==undefined&&settings.installationDirectory!==''){
    const originalInstallation=await inputPath(absolute(settings.installationDirectory),'directory',false,true);
    inputs.push(originalInstallation);args.push('--installation-directory',originalInstallation.path);
  }
  const collectDaily=settings.collectDaily??false;
  need([true,false,'on','off','true','false',''].includes(collectDaily),
    'APPLICATION_STELLAR_RATINGS_DAILY_INVALID','Use on or off for the daily collection service.');
  if([true,'on','true'].includes(collectDaily))args.push('--collect-daily');

  const configuration={workspaceDirectory:directory};
  for(const [setting,flag]of privateSettings){
    if(settings[setting]===undefined||settings[setting]==='')continue;
    const descriptor=await inputPath(absolute(settings[setting]),'file',false,true);
    inputs.push(descriptor);args.push(flag,descriptor.path);configuration[setting]=descriptor.path;
  }
  // The CLI owns connection aliases, profile semantics and private credential placement.
  // Only the original input descriptors and argument paths enter Applications state.
  await operator.loadStellarRatingsConfiguration(configuration);
  return {args,inputs,createDirectories:[...new Set(createDirectories)]};
}

function option(request,name,optional=false){
  need(Array.isArray(request.args),'APPLICATION_STELLAR_RATINGS_STARTUP_CHANGED');
  const positions=request.args.flatMap((value,index)=>value===name?[index]:[]);
  if(optional&&positions.length===0)return undefined;
  need(positions.length===1&&typeof request.args[positions[0]+1]==='string'&&
    request.args[positions[0]+1]&&!request.args[positions[0]+1].startsWith('--'),
    'APPLICATION_STELLAR_RATINGS_STARTUP_CHANGED');
  return request.args[positions[0]+1];
}

export async function stellarRatingsStartup(request,text){
  if(request.command!=='stellar-ratings'||request.pythonCommand||request.args?.[0]!=='serve'||
    typeof text!=='string'||text.length>16384)return null;
  let value;try{value=JSON.parse(text);}catch{return null;}
  if(!plain(value)||value.schema!==STELLAR_RATINGS_READY_SCHEMA||value.status!=='STELLAR_RATINGS_READY')return null;
  need(option(request,'--startup-format')==='json','APPLICATION_STELLAR_RATINGS_STARTUP_CHANGED');
  const directory=absolute(option(request,'--workspace'));
  const sourceDirectory=join(absolute(request.releaseDirectory),'source',SOURCE);
  const expectedId=option(request,'--expected-workspace-id',true);
  const host=loopback(option(request,'--host',true)??'127.0.0.1');
  const requestedPort=option(request,'--port',true)??'8777';
  need(/^(?:0|[1-9][0-9]{0,4})$/.test(requestedPort)&&Number(requestedPort)<=65535,
    'APPLICATION_STELLAR_RATINGS_STARTUP_CHANGED');
  need(value.workspaceDirectory===directory&&value.sourceDirectory===sourceDirectory&&
    UUID.test(value.workspaceId??'')&&(expectedId===undefined||expectedId===value.workspaceId)&&
    Number.isSafeInteger(value.revision)&&value.revision>=0&&Number.isSafeInteger(value.pid)&&value.pid>0&&
    value.host===host&&Number.isSafeInteger(value.port)&&value.port>=1&&value.port<=65535&&
    (Number(requestedPort)===0||Number(requestedPort)===value.port),'APPLICATION_STELLAR_RATINGS_STARTUP_CHANGED');
  const selectedPrivate={};
  for(const [setting,flag]of privateSettings){
    const argument=option(request,flag,true),path=argument===undefined?null:absolute(argument);
    need((value[setting]??null)===path,'APPLICATION_STELLAR_RATINGS_STARTUP_CHANGED');
    selectedPrivate[setting]=path;
  }

  const selectedRuntime=option(request,'--runtime-directory',true);
  const selectedInstallation=option(request,'--installation-directory',true);
  const selectedManifest=option(request,'--expected-manifest-sha256',true);
  const daily=request.args.filter(value=>value==='--collect-daily').length;
  need(daily<=1&&value.collectDaily===(daily===1)&&
    (value.runtimeDirectory??null)===(selectedRuntime===undefined?null:absolute(selectedRuntime))&&
    (value.installationDirectory??null)===(selectedInstallation===undefined?null:absolute(selectedInstallation))&&
    (value.expectedManifestSha256??null)===(selectedManifest??null),
    'APPLICATION_STELLAR_RATINGS_STARTUP_CHANGED');
  if(selectedManifest!==undefined)need(selectedRuntime!==undefined&&/^[a-f0-9]{64}$/.test(selectedManifest),
    'APPLICATION_STELLAR_RATINGS_STARTUP_CHANGED');
  if(selectedRuntime!==undefined){
    const originalRuntime=await import(pathToFileURL(join(sourceDirectory,'runtime.mjs')).href);
    const retained=await originalRuntime.readRatingsRuntimeManifest({directory:absolute(selectedRuntime),
      expectedManifestSha256:selectedManifest});
    need(retained.manifest?.stellar?.version==='17.2.1','APPLICATION_STELLAR_RATINGS_STARTUP_CHANGED');
  }
  Object.assign(selectedPrivate,{runtimeDirectory:selectedRuntime===undefined?null:absolute(selectedRuntime),
    installationDirectory:selectedInstallation===undefined?null:absolute(selectedInstallation),
    expectedManifestSha256:selectedManifest??null,collectDaily:daily===1});

  let url;try{url=new URL(value.url);}catch{need(false,'APPLICATION_STELLAR_RATINGS_STARTUP_CHANGED');}
  need(url.protocol==='http:'&&url.hostname===(host==='::1'?'[::1]':'127.0.0.1')&&
    !url.username&&!url.password&&!url.search&&url.pathname==='/'&&
    /^#token=[A-Za-z0-9_-]{43}$/.test(url.hash)&&Number(url.port||80)===value.port,
    'APPLICATION_STELLAR_RATINGS_STARTUP_CHANGED');
  const native=await import(pathToFileURL(join(sourceDirectory,'workspace.mjs')).href);
  need(typeof native.inspectStellarRatingsWorkspace==='function','APPLICATION_STELLAR_RATINGS_SOURCE_REQUIRED');
  const identity=await native.inspectStellarRatingsWorkspace({directory});
  need(plain(identity)&&identity.workspaceId===value.workspaceId&&
    Number.isSafeInteger(identity.revision)&&identity.revision>=value.revision,
    'APPLICATION_STELLAR_RATINGS_STARTUP_CHANGED');
  return {url:url.href,workspaceId:identity.workspaceId,original:{
    schema:STELLAR_RATINGS_READY_SCHEMA,workspaceDirectory:directory,workspaceId:identity.workspaceId,
    revision:value.revision,...selectedPrivate,sourceDirectory,host,port:value.port,pid:value.pid
  }};
}
