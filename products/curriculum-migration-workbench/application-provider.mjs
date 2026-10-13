// MIT. Supported Runtime Applications entry for the original Curriculum operating model.
import {join,dirname,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {APPLICATION_PROVIDER_SCHEMA,observeApplicationStartup} from '../../stellar/scf-starforge-20261009/distribution/runtime-workspace/application-provider.mjs';
import {inspectMerchantRuntime} from '../../stellar/scf-starforge-20261009/sf46-release/runtime-package.mjs';
import {PREFIX,STARTUP_SCHEMA,HASH,UUID,absolute,need,canonical,localUrl} from './contract.mjs';
import {inspectBinding,verifyAnnouncement} from './binding.mjs';
function flags(request){
 need(request.command==='curriculum-migration-workbench'&&request.args?.[0]==='serve','APPLICATION_REQUEST');
 const result={};for(let i=1;i<request.args.length;i+=2){const k=request.args[i],v=request.args[i+1];need(typeof k==='string'&&typeof v==='string'&&!Object.hasOwn(result,k),'APPLICATION_REQUEST');result[k]=v;}
 const allowed=['--workspace','--source-directory','--connection-file','--expected-binding-sha256','--application-request-id','--port'];
 need(Object.keys(result).length===allowed.length&&allowed.every(k=>Object.hasOwn(result,k))&&HASH.test(result['--expected-binding-sha256'])&&UUID.test(result['--application-request-id']),'APPLICATION_REQUEST');return result;
}
export async function prepareCurriculumMigration(settings,{inputPath,selectedExecutable,runtimeDirectory}){
 const runtime=await inspectMerchantRuntime(absolute(runtimeDirectory),{load:false,source:false});
 const helper=await import(pathToFileURL(join(runtime.sourceRoot,PREFIX,'binding.mjs')).href);
 const selected=await helper.inspectBinding({workspaceDirectory:settings.workspaceDirectory,sourceDirectory:join(runtime.sourceRoot,PREFIX,'app'),connectionFile:settings.connectionFile});
 const b=selected.binding,port=settings.port??0;need(Number.isSafeInteger(port)&&port>=0&&port<=65535,'PORT');
 const node=await selectedExecutable(b.node.executable),inputs=[await inputPath(b.workspaceDirectory,'directory',false,true),...node.inputs];
 for(const f of [...b.sourceFiles,b.creation])inputs.push(await inputPath(f.path,'file'));
 inputs.push(await inputPath(dirname(b.connectionFile),'directory',false,true));
 const unique=new Map();for(const item of inputs){const prior=unique.get(item.path);need(!prior||canonical(prior)===canonical(item),'INPUT_CHANGED');unique.set(item.path,item);}
 return{args:['serve','--workspace',b.workspaceDirectory,'--source-directory',b.sourceDirectory,'--connection-file',b.connectionFile,'--expected-binding-sha256',selected.bindingSha256,'--port',String(port)],inputs:[...unique.values()],createDirectories:[]};
}
export async function curriculumMigrationStartup(request,text){
 let value;try{value=JSON.parse(text);}catch{return null;}if(value?.schema!==STARTUP_SCHEMA)return null;
 const args=flags(request),expected={workspaceDirectory:absolute(args['--workspace']),connectionFile:absolute(args['--connection-file']),applicationRequestId:args['--application-request-id'],bindingSha256:args['--expected-binding-sha256']};
 const selected=await inspectBinding({workspaceDirectory:expected.workspaceDirectory,sourceDirectory:absolute(args['--source-directory']),connectionFile:expected.connectionFile});need(selected.bindingSha256===expected.bindingSha256,'BINDING_CHANGED');
 const {saved,state}=await verifyAnnouncement(expected.connectionFile,value,expected),url=localUrl(saved.url);
 need(/^(0|[1-9][0-9]*)$/.test(args['--port'])&&(args['--port']==='0'||url.port===args['--port']),'PORT_CHANGED');
 return{url:saved.url,workspaceId:saved.storeId,connectionFile:saved.connectionFile,original:{storeId:saved.storeId,workspaceDirectory:saved.workspaceDirectory,instanceId:saved.instanceId,applicationRequestId:saved.applicationRequestId,sourceSha256:saved.sourceSha256,bindingSha256:saved.bindingSha256,process:saved.process,defaultBranchId:state.defaultBranchId}};
}
export default{
 schema:APPLICATION_PROVIDER_SCHEMA,id:'curriculum-migration-workbench',order:1200,appendPort:false,
 catalog({common}){return[{id:'curriculum-migration-workbench',command:'curriculum-migration-workbench',title:'Curriculum Migration Workbench',terminal:false,requiredSource:PREFIX+'managed.mjs',
 description:'Operate original API comparisons, full curriculum occurrence plans, engineering decisions, generated API SDK and complete receiving through independently retained branches.',
 fields:[{name:'workspaceDirectory',label:'Curriculum migration store',type:'path',required:true,description:'Existing private managed store created from the issued baseline or a complete original workspace.'},{name:'connectionFile',label:'Private connection file',type:'path',required:false,description:'Authenticated client/agent attachment to this same managed owner.'},...common]}];},
 prepare:(_type,settings,context)=>prepareCurriculumMigration(settings,context),
 resourceKey:(_type,settings,{hash})=>hash({family:'curriculum-migration-workbench',directory:resolve(settings.workspaceDirectory)}),
 runArguments({command,args,requestId}){need(command==='curriculum-migration-workbench'&&args[0]==='serve'&&UUID.test(requestId)&&!args.includes('--application-request-id'),'APPLICATION_REQUEST');return[...args,'--application-request-id',requestId];},
 matchRequest:request=>!request.pythonCommand&&request.command==='curriculum-migration-workbench'&&request.args?.[0]==='serve',
 async verifyLaunch(request){const args=flags(request),selected=await inspectBinding({workspaceDirectory:args['--workspace'],sourceDirectory:args['--source-directory'],connectionFile:args['--connection-file']});need(selected.bindingSha256===args['--expected-binding-sha256'],'BINDING_CHANGED');},
 createObserver(request,directory){return observeApplicationStartup(request,directory,text=>text.startsWith('{')?()=>curriculumMigrationStartup(request,text):null);}
};
