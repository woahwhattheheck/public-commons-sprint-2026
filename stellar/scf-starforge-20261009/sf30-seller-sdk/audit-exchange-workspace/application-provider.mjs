import {readFile} from "node:fs/promises";
import {join,resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {inspectMerchantRuntime} from "../../sf46-release/runtime-package.mjs";
import {APPLICATION_PROVIDER_SCHEMA,observeApplicationStartup,applicationPrivateUrl} from "../../distribution/runtime-workspace/application-provider.mjs";
import {readAuditState} from "./native.mjs";
import {sha256,canonical} from "./util.mjs";
const ROOT="stellar/scf-starforge-20261009/sf30-seller-sdk/audit-exchange-workspace/",STARTUP="commons.audit-exchange.startup.v1";
const need=(ok,message)=>{if(!ok)throw new Error(message);};
function arg(request,name,optional=false){
 const positions=request.args.flatMap((v,i)=>v===name?[i]:[]);
 if(!positions.length&&optional)return undefined;
 need(positions.length===1&&typeof request.args[positions[0]+1]==="string","The original saved audit command selection differs.");return request.args[positions[0]+1];
}
export async function prepareAuditApplication(settings,{inputPath,runtimeDirectory}){
 const selected=await inputPath(settings.workspaceDirectory,"directory",false,true);
 const runtime=await inspectMerchantRuntime(resolve(runtimeDirectory),{load:false,source:false});
 const module=await import(pathToFileURL(join(runtime.sourceRoot,ROOT+"native.mjs")).href);
 const state=await module.readAuditState(selected.path),inputs=[selected];
 const source=JSON.parse(await readFile(join(runtime.sourceRoot,ROOT+"SOURCE_FILES.json"),"utf8"));
 for(const name of source.files)inputs.push(await inputPath(join(runtime.sourceRoot,ROOT,name),"file"));
 return {args:["serve","--directory",selected.path,"--host","127.0.0.1","--workspace-id",state.workspaceId],
   inputs,createDirectories:[],resourceKey:sha256(Buffer.from(canonical({family:"audit-exchange",directory:selected.path,workspaceId:state.workspaceId})))};
}
export async function auditStartup(request,line){
 if(request.command!=="audit-exchange"||request.args?.[0]!=="serve"||typeof line!=="string"||line.length>16384)return null;
 let ready;try{ready=JSON.parse(line);}catch{return null;}if(ready.schema!==STARTUP)return null;
 const directory=resolve(arg(request,"--directory")),workspaceId=arg(request,"--workspace-id"),port=arg(request,"--port",true)??"8769";
 need(/^(0|[1-9]\d*)$/.test(port)&&Number(port)<=65535,"The saved original audit port differs.");
 const candidate=applicationPrivateUrl(ready.url);need(candidate,"The original application did not announce its local address.");
 const url=new URL(candidate);
 need(url.hostname==="127.0.0.1"&&url.pathname==="/"&&!url.search&&!url.hash&&(port==="0"||Number(port)===Number(url.port)),"The original listener differs from its saved selection.");
 const state=await readAuditState(directory,workspaceId);
 need(ready.workspaceId===workspaceId&&ready.directory===directory&&ready.workspaceCreatedAt===state.createdAt&&/^[a-f0-9-]{36}$/.test(ready.instanceId??""),"The saved original workspace identity differs.");
 const response=await fetch(new URL("/api/identity",url),{headers:{"X-Audit-Workspace-Id":workspaceId},redirect:"error",signal:AbortSignal.timeout(5000)});
 need(response.ok,"The original application identity did not respond.");const live=await response.json();
 need(live.schema===STARTUP&&live.instanceId===ready.instanceId&&live.workspaceId===workspaceId&&live.directory===directory&&live.url===ready.url&&live.workspaceCreatedAt===state.createdAt,"The running audit application differs from its selected original project.");
 return {url:url.href,workspaceId,original:live};
}
export default{
 schema:APPLICATION_PROVIDER_SCHEMA,id:"audit-exchange",order:396,
 catalog({common,field}){return[{id:"audit-exchange",command:"audit-exchange",title:"Audit Exchange",terminal:false,requiredSource:ROOT+"cli.mjs",
 description:"Review native building audits, original energy streams and official validation; run native energy models and hand over complete editable projects.",
 fields:[field("workspaceDirectory","Audit project","path",true,"Select the initialized or received audit workspace."),...common]}];},
 prepare(type,settings,context){return prepareAuditApplication(settings,context);},
 matchRequest(request){return !request.pythonCommand&&request.command==="audit-exchange"&&request.args?.[0]==="serve";},
 createObserver(request,directory){return observeApplicationStartup(request,directory,line=>line.includes('"schema":"'+STARTUP+'"')?()=>auditStartup(request,line):null);}
};
