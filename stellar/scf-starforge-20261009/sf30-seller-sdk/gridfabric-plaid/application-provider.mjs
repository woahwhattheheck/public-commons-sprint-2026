// MIT. Applications provider for the original GridFabric Plaid owner.
import {join,dirname,resolve} from 'node:path';
import {realpath} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {APPLICATION_PROVIDER_SCHEMA,observeApplicationStartup} from '../../distribution/runtime-workspace/application-provider.mjs';
import {inspectMerchantRuntime} from '../../sf46-release/runtime-package.mjs';
import {GRIDFABRIC_SOURCE_PREFIX,GRIDFABRIC_STARTUP_SCHEMA,GRIDFABRIC_HASH,GRIDFABRIC_UUID,
  gridFabricNeed as need,gridFabricAbsolute,gridFabricHash,requireGridFabricNode,
  verifyGridFabricApplicationAnnouncement} from './managed-binding.mjs';

function argumentsValue(request,flag) {
  need(Array.isArray(request.args),'GRIDFABRIC_APPLICATION_STARTUP_CHANGED');
  const indices=request.args.flatMap((value,index)=>value===flag?[index]:[]);
  need(indices.length===1&&typeof request.args[indices[0]+1]==='string','GRIDFABRIC_APPLICATION_STARTUP_CHANGED');
  return request.args[indices[0]+1];
}
export function gridFabricApplicationResourceKeys(settings) {
  const directory=resolve(settings.workspaceDirectory),connectionFile=resolve(settings.connectionFile??join(directory,'gridfabric-connection.txt'));
  const readyFile=resolve(settings.readyFile??join(dirname(connectionFile),'gridfabric-application-ready.json'));
  return [gridFabricHash({family:'gridfabric-native',directory}),
    gridFabricHash({family:'gridfabric-managed-file',path:connectionFile}),
    gridFabricHash({family:'gridfabric-managed-file',path:readyFile})];
}
export async function prepareGridFabricApplication(settings,{inputPath,selectedExecutable,runtimeDirectory}) {
  requireGridFabricNode();
  const directory=gridFabricAbsolute(settings.workspaceDirectory);
  const connectionFile=gridFabricAbsolute(settings.connectionFile??join(directory,'gridfabric-connection.txt'));
  const readyFile=gridFabricAbsolute(settings.readyFile??join(dirname(connectionFile),'gridfabric-application-ready.json'));
  const runtime=await inspectMerchantRuntime(runtimeDirectory,{load:false});
  const helper=await import(pathToFileURL(join(runtime.sourceRoot,GRIDFABRIC_SOURCE_PREFIX+'managed-binding.mjs')).href);
  need(typeof helper.inspectGridFabricApplicationBinding==='function'&&typeof helper.inspectRetainedGridFabricStartup==='function',
    'GRIDFABRIC_APPLICATION_SOURCE_INCOMPLETE');
  const selected=await helper.inspectGridFabricApplicationBinding({directory,sourceRoot:runtime.sourceRoot,
    connectionFile,readyFile,inputPath});
  const {binding}=selected,inputs=[...selected.inputs];
  const previous=await helper.inspectRetainedGridFabricStartup(binding);
  if(previous)for(const [path,original]of [[readyFile,previous.ready],[connectionFile,previous.connection]]) {
    if(!original)continue;
    const observed=await inputPath(path,'file',false,true);
    need(observed.bytes===original.bytes&&(!observed.sha256||observed.sha256===original.sha256),
      'GRIDFABRIC_APPLICATION_CONNECTION_CHANGED');
    inputs.push({...observed,sha256:original.sha256});
  }
  const node=await selectedExecutable(process.execPath);
  need(await realpath(node.executable)===binding.node.executable,'GRIDFABRIC_APPLICATION_NODE_CHANGED');
  inputs.push(...node.inputs);
  const port=settings.port??0;
  need(Number.isSafeInteger(port)&&port>=0&&port<=65535,'GRIDFABRIC_APPLICATION_PORT');
  const args=['serve','--workspace',directory,'--connection-file',connectionFile,'--ready-file',readyFile,
    '--expected-workspace-id',binding.workspaceId,'--expected-binding-sha256',binding.bindingSha256,'--port',String(port)];
  const unique=new Map();
  for(const input of inputs) {
    const previous=unique.get(input.path);
    need(!previous||JSON.stringify(previous)===JSON.stringify(input),'GRIDFABRIC_APPLICATION_INPUT_CONFLICT');
    unique.set(input.path,input);
  }
  const resourceKeys=gridFabricApplicationResourceKeys(settings);
  return {args,inputs:[...unique.values()],createDirectories:[],resourceKey:resourceKeys[0],resourceKeys,binding};
}
export async function gridFabricApplicationStartup(request,text) {
  if(request.command!=='gridfabric-application'||request.args?.[0]!=='serve'||typeof text!=='string'||
    text.length>32768||!text.startsWith('{'))return null;
  let value;try{value=JSON.parse(text);}catch{return null;}
  if(value?.schema!==GRIDFABRIC_STARTUP_SCHEMA)return null;
  const directory=gridFabricAbsolute(argumentsValue(request,'--workspace')),
    connectionFile=gridFabricAbsolute(argumentsValue(request,'--connection-file')),
    readyFile=gridFabricAbsolute(argumentsValue(request,'--ready-file')),
    workspaceId=argumentsValue(request,'--expected-workspace-id'),
    expectedBinding=argumentsValue(request,'--expected-binding-sha256'),
    requestId=argumentsValue(request,'--application-request-id'),
    selectedPort=argumentsValue(request,'--port');
  need(GRIDFABRIC_UUID.test(workspaceId)&&GRIDFABRIC_UUID.test(requestId)&&GRIDFABRIC_HASH.test(expectedBinding)&&
    value.status==='READY'&&value.directory===directory&&value.connectionFile===connectionFile&&value.readyFile===readyFile&&
    value.workspaceId===workspaceId&&value.bindingSha256===expectedBinding&&value.applicationRequestId===requestId,
    'GRIDFABRIC_APPLICATION_STARTUP_CHANGED');
  let url;try{url=new URL(value.url);}catch{need(false,'GRIDFABRIC_APPLICATION_STARTUP_CHANGED');}
  need(/^(0|[1-9][0-9]{0,4})$/.test(selectedPort)&&Number(selectedPort)<=65535&&
    (selectedPort==='0'||Number(url.port)===Number(selectedPort)),'GRIDFABRIC_APPLICATION_STARTUP_CHANGED');
  const verified=await verifyGridFabricApplicationAnnouncement(readyFile,value);
  return {url:value.url,workspaceId:value.workspaceId,connectionFile,
    original:{...value,observedRevision:verified.state.revision,observedNativeSource:verified.native.source_sha256}};
}
export default {
  schema:APPLICATION_PROVIDER_SCHEMA,id:'gridfabric-plaid',order:1160,appendPort:false,
  catalog({common}) {
    return [{id:'gridfabric-plaid',command:'gridfabric-application',title:'GridFabric Plaid',terminal:false,
      requiredSource:GRIDFABRIC_SOURCE_PREFIX+'managed-launch.mjs',
      description:'Operate retained Plaid report sources, mappings, callbacks and reviewed management or device outcomes.',
      fields:[
        {name:'workspaceDirectory',label:'Original GridFabric workspace',type:'path',required:true,
          description:'Choose the existing initialized or completely restored native workspace.'},
        {name:'connectionFile',label:'Private native connection file',type:'path',required:false,
          description:'The existing SDK and agents read the original private loopback URL here.'},
        {name:'readyFile',label:'Managed readiness file',type:'path',required:false,
          description:'Retains this application’s exact workspace, source and original connection identity.'},
        ...common]}];
  },
  async prepare(_type,settings,context) {
    const {binding,...prepared}=await prepareGridFabricApplication(settings,context);return prepared;
  },
  resourceKey(_type,settings){return gridFabricApplicationResourceKeys(settings)[0];},
  checkRuntime(){requireGridFabricNode();},
  runArguments({command,args,requestId}) {
    need(command==='gridfabric-application'&&args[0]==='serve'&&GRIDFABRIC_UUID.test(requestId)&&
      !args.includes('--application-request-id'),'GRIDFABRIC_APPLICATION_REQUEST_CHANGED');
    return [...args,'--application-request-id',requestId];
  },
  matchRequest(request){return !request.pythonCommand&&request.command==='gridfabric-application'&&request.args?.[0]==='serve';},
  createObserver(request,directory) {
    return observeApplicationStartup(request,directory,text=>{
      if(!text.startsWith('{'))return null;return ()=>gridFabricApplicationStartup(request,text);
    },{lineLimit:32768});
  }
};
