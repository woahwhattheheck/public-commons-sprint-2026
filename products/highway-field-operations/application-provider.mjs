// MIT. Applications lifecycle for the unchanged Highway field operations owner.
import {join,resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {APPLICATION_PROVIDER_SCHEMA,observeApplicationStartup} from '../../stellar/scf-starforge-20261009/distribution/runtime-workspace/application-provider.mjs';
import {inspectMerchantRuntime} from '../../stellar/scf-starforge-20261009/sf46-release/runtime-package.mjs';
import {PREFIX,STARTUP_SCHEMA,UUID,HASH,absolute,need,localUrl,canonical} from './contract.mjs';
import {inspectBinding,verifyAnnouncement} from './binding.mjs';
function flags(request){
 need(request.command==='highway-field-operations'&&request.args?.[0]==='serve','APPLICATION_REQUEST');
 const values={};for(let i=1;i<request.args.length;i+=2){
  const k=request.args[i],v=request.args[i+1];need(typeof k==='string'&&typeof v==='string'&&!Object.hasOwn(values,k),'APPLICATION_REQUEST');values[k]=v;
 }
 for(const k of ['--workspace','--python','--node','--source-directory','--connection-file','--receiving-directory','--expected-binding-sha256','--application-request-id','--port'])need(Object.hasOwn(values,k),'APPLICATION_REQUEST');
 need(HASH.test(values['--expected-binding-sha256'])&&UUID.test(values['--application-request-id']),'APPLICATION_REQUEST');return values;
}
export async function prepareHighwayField(settings,{inputPath,selectedExecutable,runtimeDirectory}){
 const runtime=await inspectMerchantRuntime(absolute(runtimeDirectory),{load:false,source:false});
 const helper=await import(pathToFileURL(join(runtime.sourceRoot,PREFIX,'binding.mjs')).href);
 const python=await selectedExecutable(settings.pythonExecutable??'/usr/bin/python3');
 const node=await selectedExecutable(settings.nodeExecutable??process.execPath);
 const selected=await helper.inspectBinding({workspaceDirectory:settings.workspaceDirectory,
  sourceDirectory:join(runtime.sourceRoot,PREFIX,'app'),pythonExecutable:python.executable,nodeExecutable:node.executable,pairedWorkspaceDirectory:settings.pairedWorkspaceDirectory,pairedWorkspaceId:settings.pairedWorkspaceId,
  connectionFile:settings.connectionFile,receivingDirectory:settings.receivingDirectory});
 const b=selected.binding,port=settings.port??0;need(Number.isSafeInteger(port)&&port>=0&&port<=65535,'PORT');
 const inputs=[await inputPath(b.workspaceDirectory,'directory',false,true),...python.inputs,...node.inputs];
 if(b.paired)inputs.push(await inputPath(b.paired.directory,'directory',false,true));
 for(const item of [...b.sourceFiles,b.creation])inputs.push(await inputPath(item.path,'file'));
 inputs.push(await inputPath(b.receivingDirectory,'directory',true,true));
 // A connection file changes at every legitimate start; its private parent binds.
 // Its previous process is reconciled under the managed host's original lock.
 inputs.push(await inputPath(dirname(b.connectionFile),'directory',false,true));
 const unique=new Map();for(const value of inputs){
  const old=unique.get(value.path);need(!old||canonical(old)===canonical(value),'INPUT_CHANGED');unique.set(value.path,value);
 }
 return {args:['serve','--workspace',b.workspaceDirectory,'--python',b.python.executable,'--node',b.node.executable,...(b.paired?['--paired-workspace',b.paired.directory,'--paired-workspace-id',b.paired.workspaceId]:[]),'--source-directory',b.sourceDirectory,
  '--connection-file',b.connectionFile,'--receiving-directory',b.receivingDirectory,'--expected-binding-sha256',selected.bindingSha256,'--port',String(port)],
  inputs:[...unique.values()],createDirectories:[]};
}
export async function highwayFieldStartup(request,text){
 let announcement;try{announcement=JSON.parse(text);}catch{return null;}
 if(announcement?.schema!==STARTUP_SCHEMA)return null;
 const v=flags(request),expected={workspaceDirectory:absolute(v['--workspace']),connectionFile:absolute(v['--connection-file']),
  bindingSha256:v['--expected-binding-sha256'],applicationRequestId:v['--application-request-id']};
 const selected=await inspectBinding({workspaceDirectory:expected.workspaceDirectory,sourceDirectory:absolute(v['--source-directory']),
  pythonExecutable:absolute(v['--python']),nodeExecutable:absolute(v['--node']),pairedWorkspaceDirectory:v['--paired-workspace'],pairedWorkspaceId:v['--paired-workspace-id'],connectionFile:expected.connectionFile,receivingDirectory:absolute(v['--receiving-directory'])});
 need(selected.bindingSha256===expected.bindingSha256,'BINDING_CHANGED');
 const {saved,state}=await verifyAnnouncement(expected.connectionFile,announcement,expected),url=localUrl(saved.url);
 need(/^(0|[1-9][0-9]*)$/.test(v['--port'])&&(v['--port']==='0'||url.port===v['--port']),'PORT_CHANGED');
 // Applications retains its private opening URL. Public identity contains no token.
 return {url:saved.url,workspaceId:saved.workspaceId,connectionFile:saved.connectionFile,
  original:{instanceId:saved.instanceId,applicationRequestId:saved.applicationRequestId,workspaceId:saved.workspaceId,
   workspaceDirectory:saved.workspaceDirectory,sourceSha256:saved.sourceSha256,bindingSha256:saved.bindingSha256,
   process:saved.process,revision:state.revision,sha256:state.sha256}};
}
export default {
 schema:APPLICATION_PROVIDER_SCHEMA,id:'highway-field-operations',order:1185,appendPort:false,
 catalog({common}){return [{id:'highway-field-operations',command:'highway-field-operations',title:'Highway field operations',terminal:false,
  requiredSource:PREFIX+'managed.mjs',description:'Operate captured Highway assets, collection forms, inspections, supervisor decisions and dispatch; reconcile approved proposals through the original paired engine and receive complete editable workspaces.',
  fields:[
   {name:'workspaceDirectory',label:'Original Highway field workspace',type:'path',required:true,description:'Existing original or received Highway SQLite workspace.'},
   {name:'pythonExecutable',label:'Python 3.11 or later',type:'path',required:false,description:'Selected existing interpreter; defaults to /usr/bin/python3.'},
   {name:'nodeExecutable',label:'Node executable',type:'path',required:false,description:'Existing Node used by the original local SF30/SF100 producer; defaults to this runtime Node.'},
   {name:'pairedWorkspaceDirectory',label:'Original paired workspace',type:'path',required:false,description:'Existing private warehouse.duckdb directory. Select with its original warehouse ID and DuckDB 1.5.6.'},
   {name:'pairedWorkspaceId',label:'Original paired warehouse ID',type:'text',required:false,description:'Exact 32-character hexadecimal ID returned by the original paired workspace.'},
   {name:'connectionFile',label:'Private connection file',type:'path',required:false,description:'Authenticated SDK and agent attachment to this same service.'},
   {name:'receivingDirectory',label:'Independent receiving folder',type:'path',required:false,description:'Separate private folder for received branches.'},...common]}];},
 prepare:(_type,settings,context)=>prepareHighwayField(settings,context),
 resourceKey:(_type,settings,{hash})=>hash({family:'highway-field-operations',directory:resolve(settings.workspaceDirectory)}),
 runArguments({command,args,requestId}){need(command==='highway-field-operations'&&args[0]==='serve'&&UUID.test(requestId)&&!args.includes('--application-request-id'),'APPLICATION_REQUEST');return [...args,'--application-request-id',requestId];},
 matchRequest:request=>!request.pythonCommand&&request.command==='highway-field-operations'&&request.args?.[0]==='serve',
 async verifyLaunch(request){const v=flags(request),selected=await inspectBinding({workspaceDirectory:v['--workspace'],sourceDirectory:v['--source-directory'],pythonExecutable:v['--python'],nodeExecutable:v['--node'],pairedWorkspaceDirectory:v['--paired-workspace'],pairedWorkspaceId:v['--paired-workspace-id'],connectionFile:v['--connection-file'],receivingDirectory:v['--receiving-directory']});need(selected.bindingSha256===v['--expected-binding-sha256'],'BINDING_CHANGED');},
 createObserver(request,directory){return observeApplicationStartup(request,directory,text=>text.startsWith('{')?()=>highwayFieldStartup(request,text):null);}
};
