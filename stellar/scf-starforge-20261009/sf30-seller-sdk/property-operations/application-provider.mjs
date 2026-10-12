// MIT. Source-owned Applications provider for the original Property Operations owner.
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {APPLICATION_PROVIDER_SCHEMA,observeApplicationStartup} from '../../distribution/runtime-workspace/application-provider.mjs';
import {inspectMerchantRuntime} from '../../sf46-release/runtime-package.mjs';
import {PROPERTY_SOURCE_PREFIX,PROPERTY_STARTUP_SCHEMA,propertyApplicationNeed as need,propertyAbsolute,
  inspectPropertyApplicationBinding,inspectRetainedPropertyConnection,verifyPropertyApplicationAnnouncement} from './managed-binding.mjs';
const HASH=/^[a-f0-9]{64}$/,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
function selected(request,flag) {
  need(Array.isArray(request.args),'PROPERTY_APPLICATION_STARTUP_CHANGED');
  const indices=request.args.flatMap((v,i)=>v===flag?[i]:[]);
  need(indices.length===1&&typeof request.args[indices[0]+1]==='string','PROPERTY_APPLICATION_STARTUP_CHANGED');
  return request.args[indices[0]+1];
}
export async function preparePropertyApplication(settings,{inputPath,selectedExecutable,runtimeDirectory}) {
  const directory=propertyAbsolute(settings.workspaceDirectory);
  const connectionFile=settings.connectionFile?propertyAbsolute(settings.connectionFile):join(directory,'property-connection.json');
  const propertyHostFile=settings.propertyHostFile?propertyAbsolute(settings.propertyHostFile):null;
  const runtime=await inspectMerchantRuntime(runtimeDirectory,{load:false});
  // Import the selected installed helper, preserving its same complete source declaration after adoption.
  const helper=join(runtime.sourceRoot,PROPERTY_SOURCE_PREFIX+'managed-binding.mjs');
  const selectedModule=await import(pathToFileURL(helper).href);
  need(typeof selectedModule.inspectPropertyApplicationBinding==='function','PROPERTY_APPLICATION_SOURCE_INCOMPLETE');
  const {binding,inputs}=await selectedModule.inspectPropertyApplicationBinding({directory,sourceRoot:runtime.sourceRoot,
    connectionFile,propertyHostFile,inputPath});
  const retained=await selectedModule.inspectRetainedPropertyConnection(connectionFile,binding);
  if(retained){
    const observed=await inputPath(connectionFile,'file',false,true);
    need(observed.bytes===retained.bytes&&(!observed.sha256||observed.sha256===retained.sha256),'PROPERTY_APPLICATION_CONNECTION_CHANGED');
    inputs.push({...observed,sha256:retained.sha256});
  }
  const node=await selectedExecutable(process.execPath);
  need(await import('node:fs/promises').then(fs=>fs.realpath(node.executable))===binding.node.executable,
    'PROPERTY_APPLICATION_NODE_CHANGED');
  inputs.push(...node.inputs);
  const port=settings.port??0;
  need(Number.isSafeInteger(port)&&port>=0&&port<=65535,'PROPERTY_APPLICATION_PORT');
  const args=['serve','--directory',binding.directory,'--connection-file',connectionFile,
    '--expected-created-at',binding.createdAt,'--expected-binding-sha256',binding.bindingSha256,'--port',String(port)];
  if(propertyHostFile)args.push('--property-host',propertyHostFile);
  const unique=new Map();
  for(const input of inputs){
    const old=unique.get(input.path);
    need(!old||JSON.stringify(old)===JSON.stringify(input),'PROPERTY_APPLICATION_INPUT_CONFLICT');
    unique.set(input.path,input);
  }
  return {args,inputs:[...unique.values()],createDirectories:[],binding};
}
export async function propertyApplicationStartup(request,text) {
  if(request.command!=='property-application'||request.args?.[0]!=='serve'||typeof text!=='string'||
    text.length>16384||!text.startsWith('{'))return null;
  let value;try{value=JSON.parse(text);}catch{return null;}
  if(value?.schema!==PROPERTY_STARTUP_SCHEMA)return null;
  const directory=propertyAbsolute(selected(request,'--directory')),
    connectionFile=propertyAbsolute(selected(request,'--connection-file')),
    createdAt=selected(request,'--expected-created-at'),
    expected=selected(request,'--expected-binding-sha256'),
    requestId=selected(request,'--application-request-id'),
    port=selected(request,'--port');
  need(HASH.test(expected)&&UUID.test(requestId)&&value.directory===directory&&value.connectionFile===connectionFile&&
    value.createdAt===createdAt&&value.bindingSha256===expected&&value.applicationRequestId===requestId,
    'PROPERTY_APPLICATION_STARTUP_CHANGED');
  let url;try{url=new URL(value.url);}catch{need(false,'PROPERTY_APPLICATION_STARTUP_CHANGED');}
  need(/^(0|[1-9][0-9]{0,4})$/.test(port)&&Number(port)<=65535&&url.protocol==='http:'&&url.hostname==='127.0.0.1'&&
    url.pathname==='/'&&!url.search&&!url.username&&!url.password&&url.port&&
    (port==='0'||Number(url.port)===Number(port)),'PROPERTY_APPLICATION_STARTUP_CHANGED');
  const verified=await verifyPropertyApplicationAnnouncement(connectionFile,value);
  return {url:value.url,workspaceId:createdAt,connectionFile,
    original:{...value,observedPropertyId:verified.native.property.id,observedPropertyRevision:verified.native.property.revision}};
}
export default {
  schema:APPLICATION_PROVIDER_SCHEMA,id:'property-operations',order:1150,appendPort:false,
  catalog({common}){
    return [{id:'property-operations',command:'property-application',title:'Property Operations',terminal:false,
      requiredSource:PROPERTY_SOURCE_PREFIX+'managed-launch.mjs',
      description:'Review retained property records, inspection/report editions and explicit links, then receive complete publisher and customer files.',
      fields:[
        {name:'workspaceDirectory',label:'Original property workspace',type:'path',required:true,
          description:'Choose the existing Socrata and Property Operations workspace.'},
        {name:'connectionFile',label:'Private connection file',type:'path',required:false,
          description:'The SDK and agent reconnect through this file after the original application restarts.'},
        {name:'propertyHostFile',label:'Original vendor host settings',type:'path',required:false,
          description:'Optional existing private configuration for authorized vendor requests. The default keeps vendor requests disabled.'},
        ...common]}];
  },
  async prepare(_type,settings,context) {
    const {args,inputs,createDirectories}=await preparePropertyApplication(settings,context);
    return {args,inputs,createDirectories};
  },
  resourceKey(_type,settings,{hash}){return hash({family:'socrata-property',directory:resolve(settings.workspaceDirectory)});},
  checkRuntime(){need(Number(process.versions.node.split('.')[0])>=24,'PROPERTY_APPLICATION_NODE_REQUIRED','Use Node 24 or later for the original SQLite workspace.');},
  runArguments({command,args,requestId}){
    need(command==='property-application'&&args[0]==='serve'&&UUID.test(requestId)&&!args.includes('--application-request-id'),
      'PROPERTY_APPLICATION_REQUEST_CHANGED');
    return [...args,'--application-request-id',requestId];
  },
  matchRequest(request){return !request.pythonCommand&&request.command==='property-application'&&request.args?.[0]==='serve';},
  createObserver(request,directory){
    return observeApplicationStartup(request,directory,text=>{
      if(!text.startsWith('{'))return null;
      return ()=>propertyApplicationStartup(request,text);
    });
  }
};
