// MIT. Wherobots in the original source-owned Applications registry.
import path from "node:path";
import {pathToFileURL} from "node:url";
import {createHash} from "node:crypto";
import {inspectMerchantRuntime} from "../../sf46-release/runtime-package.mjs";
import {APPLICATION_PROVIDER_SCHEMA,applicationField,observeApplicationStartup}
  from "../../distribution/runtime-workspace/application-provider.mjs";

const PRODUCT="stellar/scf-starforge-20261009/sf30-seller-sdk/wherobots/";
const STARTUP="stellar-forge.wherobots-application-startup.v1";
const COMMAND="wherobots-app";
const sha=value=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
function need(value,message){if(!value)throw Object.assign(new Error(message),{code:"APPLICATION_WHEROBOTS_CHANGED"});}
function option(request,name,optional=false){
  const positions=request.args.flatMap((value,index)=>value===name?[index]:[]);
  if(optional&&!positions.length)return undefined;
  need(positions.length===1&&typeof request.args[positions[0]+1]==="string"&&
    !request.args[positions[0]+1].startsWith("--"),"The original application arguments changed.");
  return request.args[positions[0]+1];
}
export default {
  schema:APPLICATION_PROVIDER_SCHEMA,id:"wherobots",order:1060,
  catalog({common}){
    return [{id:"wherobots-workspace",command:COMMAND,title:"Wherobots spatial workspace",terminal:false,
      requiredSource:PRODUCT+"application-launcher.mjs",
      description:"Open an existing spatial workspace to review native jobs, read complete output editions, compare refreshes and receive customer handovers.",
      fields:[
        applicationField("connectionFile","Workspace connection","path",true,
          "Select the existing private Wherobots connection JSON."),
        applicationField("workspaceAlias","Workspace alias","text",true,
          "Use the name declared in that connection. Its original workspace ID stays pinned."),
        applicationField("python","Python runtime","path",false,
          "Use an absolute installed Python executable. Leave blank when the connection already declares one."),
        ...common,
      ]}];
  },
  async prepare(_type,settings,{inputPath,selectedExecutable,runtimeDirectory}={}){
    need(typeof inputPath==="function"&&typeof selectedExecutable==="function","Use the original Applications input reader.");
    const runtime=await inspectMerchantRuntime(path.resolve(runtimeDirectory),{load:false});
    const native=await import(pathToFileURL(path.join(runtime.sourceRoot,PRODUCT+"application-launcher.mjs")).href);
    const selection=await native.prepareWherobotsApplication({
      connection:settings.connectionFile,workspace:settings.workspaceAlias,python:settings.python,sourceRoot:runtime.sourceRoot});
    const inputs=[],seen=new Set();
    const add=value=>{const key=value.kind+":"+value.path;if(!seen.has(key)){inputs.push(value);seen.add(key);}};
    for(const file of selection.binding.configurationFiles){
      const value=await inputPath(file.path,"file");
      need(value.bytes===file.bytes&&(value.sha256===undefined||value.sha256===file.sha256),
        "Review the current private connection and selected Python runtime.");add(value);
    }
    const executable=await selectedExecutable(selection.binding.python);
    for(const value of executable.inputs)add(value);
    add(await inputPath(selection.binding.directory,"directory",false,true));
    for(const directory of selection.binding.pythonPath)add(await inputPath(directory,"directory"));
    for(const file of selection.source.files){
      const value=await inputPath(path.join(selection.source.root,file.name),"file");
      need(value.bytes===file.bytes&&value.sha256===file.sha256,"Review the current original Wherobots source.");add(value);
    }
    return {args:["serve","--connection",selection.binding.connectionFile,"--workspace",selection.binding.workspace,
      "--python",selection.binding.python,"--managed-selection",JSON.stringify(selection)],
      inputs,createDirectories:[],
      resourceKey:sha({directory:selection.binding.directory,family:"wherobots-browser"})};
  },
  matchRequest(request){
    return !request.pythonCommand&&request.command===COMMAND&&request.args?.[0]==="serve";
  },
  createObserver(request,directory,context){
    return observeApplicationStartup(request,directory,text=>{
      if(!text.startsWith('{"schema":"'+STARTUP+'",'))return null;
      return async()=>{
        const value=JSON.parse(text),selection=JSON.parse(option(request,"--managed-selection"));
        need(selection.binding.connectionFile===path.resolve(option(request,"--connection"))&&
          selection.binding.workspace===option(request,"--workspace")&&
          selection.binding.python===option(request,"--python"),"The original reviewed workspace arguments changed.");
        const root=path.join(path.resolve(request.releaseDirectory),"source");
        const native=await import(pathToFileURL(path.join(root,PRODUCT+"application-launcher.mjs")).href);
        const rawPort=option(request,"--port",true)??"0";
        need(/^(0|[1-9]\d*)$/.test(rawPort),"The selected local port changed.");
        return native.verifyWherobotsApplicationStartup(value,{
          selection,launchSourceRoot:root,port:Number(rawPort),...(context?.pid?{pid:context.pid}:{})});
      };
    });
  },
};
