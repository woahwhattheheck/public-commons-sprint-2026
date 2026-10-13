// SPDX-License-Identifier: MIT
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {inspectMerchantRuntime} from '../../stellar/scf-starforge-20261009/sf46-release/runtime-package.mjs';
import {APPLICATION_PROVIDER_SCHEMA,applicationPrivateUrl,observeApplicationStartup} from '../../stellar/scf-starforge-20261009/distribution/runtime-workspace/application-provider.mjs';
import {privateDirectory,regular} from '../../stellar/scf-starforge-20261009/distribution/runtime-workspace/storage.mjs';
import {hashJSON,sha256,requireValue} from './contract.mjs';
import {createGraviteeWorkspaceClient} from './client.mjs';
const PRODUCT='products/gravitee-merchant/';
function requested(request){
 requireValue(!request.pythonCommand&&!request.terminal&&request.command==='gravitee-workspace'&&request.args?.[0]==='serve','GRAVITEE_APPLICATION_REQUEST_CHANGED');
 const values=new Map();for(let i=1;i<request.args.length;i++){const key=request.args[i],value=request.args[++i];requireValue(['--directory','--port'].includes(key)&&typeof value==='string'&&!values.has(key),'GRAVITEE_APPLICATION_ARGUMENT_INVALID');values.set(key,value);}
 const port=Number(values.get('--port')??0);requireValue(Number.isSafeInteger(port)&&port>=0&&port<=65535,'GRAVITEE_APPLICATION_PORT_INVALID');
 return{directory:values.get('--directory'),port};
}
export async function prepareGraviteeApplication(settings,context){
 const runtime=await inspectMerchantRuntime(context.runtimeDirectory,{load:false}),directory=await privateDirectory(settings.workspaceDirectory);
 const identity=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await regular(join(directory,'workspace.json'))));
 requireValue(identity.schema==='gravitee.commissioning.v1','GRAVITEE_APPLICATION_WORKSPACE_INVALID');
 const folder=await context.inputPath(directory,'directory',false,true),identityInput=await context.inputPath(join(directory,'workspace.json'),'file');
 const sourceFile=join(runtime.sourceRoot,PRODUCT+'source-files.json'),manifest=JSON.parse(await readFile(sourceFile,'utf8')),inputs=[folder,identityInput];
 for(const path of manifest.files)inputs.push({...await context.inputPath(join(runtime.sourceRoot,path),'file'),role:'Gravitee application source: '+path});
 return{args:['serve','--directory',directory],inputs,createDirectories:[],resourceKey:hashJSON({kind:'gravitee-workspace',workspaceId:identity.workspaceId,directory,dev:String(folder.dev),ino:String(folder.ino)}),
  applicationReview:{schema:'stellar-forge.application-review-content.v1',title:'Gravitee commissioning',summary:'Open the original source, API migration, native request and complete operating handover workspace.',
   sections:[{title:'Operating workspace',rows:[{label:'Workspace',value:identity.workspaceId},{label:'Private source and history',value:directory},{label:'Native provider',value:'Management API v2 / v4 HTTP proxy APIs'},{label:'Receiving',value:'Complete editable source, retained records and original provider responses'}]}]}};
}
export async function graviteeStartup(request,line){
 let value;try{value=JSON.parse(line);}catch{return null;}
 if(value?.schema!=='gravitee.native-session.v1')return null;
 const selected=requested(request),raw=applicationPrivateUrl(value.url);requireValue(raw&&value.directory===selected.directory,'GRAVITEE_STARTUP_CHANGED');
 const url=new URL(raw);requireValue(url.hostname==='127.0.0.1'&&url.pathname==='/'&&!url.search&&/^[a-f0-9]{64}$/.test(url.hash.slice(1))&&Number(url.port)===value.port&&(selected.port===0||selected.port===value.port),'GRAVITEE_STARTUP_URL_CHANGED');
 await privateDirectory(value.directory);const identity=JSON.parse((await regular(join(value.directory,'workspace.json'))).toString('utf8'));
 requireValue(identity.workspaceId===value.workspaceId,'GRAVITEE_STARTUP_WORKSPACE_CHANGED');
 const client=createGraviteeWorkspaceClient({url:raw,workspaceId:value.workspaceId}),current=await client.action('view',{}, {signal:AbortSignal.timeout(10000)});
 requireValue(current.workspaceId===identity.workspaceId&&current.directory===value.directory,'GRAVITEE_NATIVE_WORKSPACE_CHANGED');
 const source=await readFile(new URL('./web/index.html',import.meta.url)),response=await fetch(url.origin+'/',{redirect:'error',signal:AbortSignal.timeout(10000)});
 requireValue(response.status===200,'GRAVITEE_APPLICATION_NOT_READY');const page=Buffer.from(await response.arrayBuffer());requireValue(page.length===source.length&&sha256(page)===sha256(source),'GRAVITEE_APPLICATION_SOURCE_CHANGED');
 return{url:raw,workspaceId:value.workspaceId,original:{schema:value.schema,directory:value.directory,workspaceId:value.workspaceId,htmlSha256:sha256(source)},links:[]};
}
export default{
 schema:APPLICATION_PROVIDER_SCHEMA,id:'gravitee-workspace',order:620,
 catalog({common,field}){return[{id:'gravitee-workspace',command:'gravitee-workspace',title:'Gravitee commissioning',terminal:false,requiredSource:PRODUCT+'cli.mjs',
  description:'Operate the complete native API source, mapping, commissioning, provider-response and customer handover workspace.',
  fields:[field('workspaceDirectory','Private workspace directory','path',true,'Select a directory initialized by gravitee-workspace init.'),...common]}];},
 validateSettings(type,settings){requireValue(settings.port===undefined||Number.isSafeInteger(settings.port)&&settings.port>=0&&settings.port<=65535,'GRAVITEE_APPLICATION_PORT_INVALID');},
 prepare(type,settings,context){return prepareGraviteeApplication(settings,context);},
 matchRequest(request){return !request.pythonCommand&&request.command==='gravitee-workspace'&&request.args?.[0]==='serve';},
 createObserver(request,directory){return observeApplicationStartup(request,directory,line=>line.startsWith('{')?()=>graviteeStartup(request,line):null);}
};
