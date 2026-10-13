// MIT. Human Services Directory in the maintained installed Applications lifecycle.
import {join} from 'node:path';
import {
  APPLICATION_PROVIDER_SCHEMA,applicationPreparation,observeApplicationStartup
} from '../../distribution/runtime-workspace/application-provider.mjs';
import {absolute,privateDirectory,plain,need,digest} from '../../distribution/runtime-workspace/storage.mjs';
import {inspectGravityApplicationWorkspace} from '../fhir_referral/application.mjs';

const SOURCE='stellar/scf-starforge-20261009/sf30-seller-sdk/fhir_directory';
const COMMAND='human-services-directory';
const STARTUP='stellar-forge.human-services-directory-startup.v1';
const WORKSPACE='stellar-forge.eltss-workspace.v1';
const DIRECTORY='stellar-forge.human-services-directory.v1';
const OPERATOR='stellar-forge.human-services-directory-operator-connection.v1';
const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;

export async function inspectHumanServicesDirectoryApplicationWorkspace(directory,expectedId=null){
  const original=await inspectGravityApplicationWorkspace(directory,expectedId);
  await privateDirectory(join(original.directory,'directory'));
  return original;
}
function selection(request){
  need(!request.pythonCommand&&request.command===COMMAND&&request.args?.[0]==='serve',
    'APPLICATION_DIRECTORY_REQUEST_CHANGED');
  const args=request.args.slice(1),options=new Map();
  const allowed=new Set(['--workspace','--expected-workspace-id','--credentials-file','--port']);
  need(args.length%2===0,'APPLICATION_DIRECTORY_REQUEST_CHANGED');
  for(let index=0;index<args.length;index+=2){
    need(allowed.has(args[index])&&!options.has(args[index])&&typeof args[index+1]==='string',
      'APPLICATION_DIRECTORY_REQUEST_CHANGED');
    options.set(args[index],args[index+1]);
  }
  need(UUID.test(options.get('--expected-workspace-id')??'')&&
    /^(0|[1-9]\d*)$/.test(options.get('--port')??'')&&Number(options.get('--port'))<=65535,
    'APPLICATION_DIRECTORY_REQUEST_CHANGED');
  return {directory:absolute(options.get('--workspace')),workspaceId:options.get('--expected-workspace-id'),
    port:Number(options.get('--port')),
    ...(options.has('--credentials-file')?{credentialsFile:absolute(options.get('--credentials-file'))}:{})};
}
async function liveJSON(url,route){
  const response=await fetch(new URL(route,url),{
    redirect:'error',headers:{Authorization:'Bearer '+url.hash.slice(1)},
    signal:AbortSignal.timeout(10000)
  });
  need(response.status===200&&/^application\/json(?:;|$)/i.test(response.headers.get('content-type')??''),
    'APPLICATION_DIRECTORY_LISTENER_UNAVAILABLE','The directory operator did not return its saved workspace.');
  const maximum=16*1024*1024,declared=response.headers.get('content-length');
  need(declared===null||/^\d+$/.test(declared)&&Number(declared)<=maximum,
    'APPLICATION_DIRECTORY_LISTENER_UNAVAILABLE');
  const chunks=[];let length=0;
  for await(const chunk of response.body){
    length+=chunk.length;need(length<=maximum,'APPLICATION_DIRECTORY_LISTENER_UNAVAILABLE');chunks.push(chunk);
  }
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}
  catch{need(false,'APPLICATION_DIRECTORY_LISTENER_UNAVAILABLE','The directory state could not be read.');}
}
export async function humanServicesDirectoryApplicationStartup(request,value){
  if(!plain(value)||value.schema!==STARTUP)return null;
  const selected=selection(request);
  const original=await inspectHumanServicesDirectoryApplicationWorkspace(selected.directory,selected.workspaceId);
  need(value.workspace===original.directory&&value.workspaceId===original.workspaceId&&
    UUID.test(value.instanceId??'')&&value.connectionFile===join(original.directory,'directory','operator-connection.json'),
    'APPLICATION_DIRECTORY_STARTUP_CHANGED','The operator opened a different directory workspace.');
  let url;try{url=new URL(value.url);}catch{need(false,'APPLICATION_DIRECTORY_STARTUP_CHANGED');}
  const port=Number(url.port||80);
  need(url.protocol==='http:'&&url.hostname==='127.0.0.1'&&!url.username&&!url.password&&!url.search&&
    url.pathname==='/'&&/^#[A-Za-z0-9_-]{43}$/.test(url.hash)&&port>=1&&port<=65535&&
    (!selected.port||selected.port===port),'APPLICATION_DIRECTORY_STARTUP_CHANGED');
  const operator=await liveJSON(url,'/api/operator');
  need(operator?.schema===OPERATOR&&operator.active===true&&operator.workspace===original.directory&&
    operator.workspaceId===original.workspaceId&&operator.instanceId===value.instanceId&&
    operator.url===url.href.split('#',1)[0],
    'APPLICATION_DIRECTORY_STARTUP_CHANGED','The directory operator differs from its startup record.');
  const state=await liveJSON(url,'/api/state');
  need(state?.schema===WORKSPACE&&state.workspaceId===original.workspaceId&&
    state.directory?.schema===DIRECTORY&&state.directory.workspaceId===original.workspaceId,
    'APPLICATION_DIRECTORY_STARTUP_CHANGED','The directory listener differs from the selected saved workspace.');
  return {url:url.href,workspaceId:original.workspaceId,
    original:{schema:STARTUP,directory:original.directory,workspaceId:original.workspaceId,
      markerSha256:original.marker.sha256,identitySha256:original.identity.sha256}};
}
export default {
  schema:APPLICATION_PROVIDER_SCHEMA,id:COMMAND,order:435,
  catalog({common,field}){
    return [{id:COMMAND,command:COMMAND,title:'Human Services Directory',terminal:false,
      requiredSource:SOURCE+'/application.mjs',
      description:'Assess directory standards, review service/referral decisions, edit complete operating procedures and reopen original histories and handovers.',
      fields:[
        field('workspaceDirectory','Directory workspace','path',true,
          'Select the private directory created or received with human-services-directory.'),
        field('credentialsFile','Authentication profiles','path',false,
          'Optional existing FHIR authentication profile file.'),
        ...common
      ]}];
  },
  async prepare(type,settings,context){
    const original=await inspectHumanServicesDirectoryApplicationWorkspace(settings.workspaceDirectory);
    const {args,inputs,createDirectories,path,option}=applicationPreparation(settings,context.inputPath);
    await path('workspaceDirectory','directory',false,true);
    for(const file of [original.marker,original.identity]){
      const input=await context.inputPath(file.path,'file');
      need(input.sha256===file.sha256,'APPLICATION_DIRECTORY_WORKSPACE_CHANGED');inputs.push(input);
    }
    if(settings.credentialsFile)await path('credentialsFile','file');
    args.push('serve','--workspace',original.directory,'--expected-workspace-id',original.workspaceId);
    option('--credentials-file',settings.credentialsFile);
    return {args,inputs,createDirectories,
      resourceKey:digest(JSON.stringify({family:COMMAND,directory:original.directory,workspaceId:original.workspaceId}))};
  },
  matchRequest(request){return !request.pythonCommand&&request.command===COMMAND&&request.args?.[0]==='serve';},
  async verifyLaunch(request){
    const selected=selection(request);
    await inspectHumanServicesDirectoryApplicationWorkspace(selected.directory,selected.workspaceId);
  },
  createObserver(request,directory){
    return observeApplicationStartup(request,directory,text=>{
      if(!text.startsWith('{'))return null;
      let value;try{value=JSON.parse(text);}catch{return null;}
      return value?.schema===STARTUP?()=>humanServicesDirectoryApplicationStartup(request,value):null;
    });
  }
};
