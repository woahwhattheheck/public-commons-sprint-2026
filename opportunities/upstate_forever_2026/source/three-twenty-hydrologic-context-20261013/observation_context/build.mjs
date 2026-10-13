#!/usr/bin/env node
import {readFile,writeFile,mkdir,realpath,rename,stat} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {createHash} from "node:crypto";
import {analyzeObservationNetwork} from "./analysis.mjs";
import {makeObservationInput,parseObservationCSV} from "./inputs.mjs";
import {renderObservationNetworkSection,observationNetworkStyles} from "./report_section.mjs";
import {observationNetworkOutputs} from "./outputs.mjs";
const args=process.argv.slice(2),options={};
for(let i=0;i<args.length;i++){if(!["--application","--output","--inputs"].includes(args[i])||!args[i+1])throw Error("Use --application APP --output NEWDIR [--inputs INPUTS_JSON]");options[args[i].slice(2)]=args[++i];}
if(!options.application||!options.output)throw Error("--application and --output are required");
const application=await realpath(options.application);
const within=(root,value)=>{const p=path.relative(root,value);return p===""||(!p.startsWith(".."+path.sep)&&p!==".."&&!path.isAbsolute(p));};
const inputPath=options.inputs?path.resolve(options.inputs):fileURLToPath(new URL("./observation-inputs.json",import.meta.url));
const descriptor=JSON.parse(await readFile(inputPath,"utf8")),files=[];
const hash=s=>createHash("sha256").update(s,"utf8").digest("hex");
for(const d of descriptor.files){
 if(typeof d.path!=="string"||path.isAbsolute(d.path)||d.path.split("/").some(x=>!x||x==="."||x==="..")||d.path.includes("\\")||d.path.includes("\0"))throw Error("Invalid application source path");
 const absolute=await realpath(path.join(application,d.path));if(!within(application,absolute))throw Error("Source escaped application root");
 const bytes=await readFile(absolute);if(bytes.length!==d.bytes||createHash("sha256").update(bytes).digest("hex")!==d.sha256)throw Error("Source differs: "+d.path);
 const content=new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(bytes);files.push({...d,content});
}
const input=makeObservationInput(files,descriptor),body=analyzeObservationNetwork(input,parseObservationCSV,hash,s=>Buffer.byteLength(s,"utf8"));
const network=JSON.parse(files.find(f=>f.path===descriptor.network.path).content);
const output=observationNetworkOutputs(body,network,renderObservationNetworkSection,observationNetworkStyles);
const destination=path.resolve(options.output);await mkdir(destination,{recursive:true});
const exactDestination=await realpath(destination);
const pending=[];
for(const [name,content]of Object.entries(output)){
 const target=path.join(exactDestination,name);
 try{const info=await stat(target);if(!info.isFile()||(await readFile(target,"utf8"))!==content)throw Error("Refusing differing output "+target);}
 catch(error){if(error.code!=="ENOENT")throw error;pending.push({target,content});}
}
for(const [i,item]of pending.entries()){
 const temporary=item.target+".tmp-"+process.pid+"-"+i;
 await writeFile(temporary,item.content,{encoding:"utf8",flag:"wx"});await rename(temporary,item.target);
}
console.log(JSON.stringify({schema:"upstate.network-observation-build/v1",application,output:exactDestination,counts:body.counts,
 files:Object.entries(output).map(([name,content])=>({path:name,bytes:Buffer.byteLength(content,"utf8"),sha256:hash(content)}))},null,2));
