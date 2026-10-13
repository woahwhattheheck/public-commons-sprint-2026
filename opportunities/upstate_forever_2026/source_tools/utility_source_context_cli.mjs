#!/usr/bin/env node
/** Receive the existing original utility topology and regional context together. */
import {readFileSync,mkdirSync,writeFileSync,renameSync} from "node:fs";
import {createHash} from "node:crypto";
import {fileURLToPath} from "node:url";
import {resolve,dirname} from "node:path";
import {buildUtilitySourceContext,utilityContextCsv,utilityContextHtml,utilityContextExplorer,PRESENTATION_VERSION} from "./utility_source_context.mjs";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const argv=process.argv.slice(2);
if(argv.includes("--help")){
  process.stdout.write("node source_tools/utility_source_context_cli.mjs [--inputs source/utility-source-context/20261013/inputs.json] [--out EXISTING_WORKSPACE/utility-source-context]\n");
  process.exit(0);
}
const options={};
for(let i=0;i<argv.length;i+=2){
  if(!["--inputs","--out"].includes(argv[i])||!argv[i+1])throw Error("Use --inputs PATH and --out PATH");
  if(options[argv[i]])throw Error("Duplicate option "+argv[i]);
  options[argv[i]]=argv[i+1];
}
const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
const inputPath=resolve(root,options["--inputs"]||"source/utility-source-context/20261013/inputs.json");
const selected=JSON.parse(readFileSync(inputPath,"utf8"));
if(selected.schema!=="upstate.utility-source-context-inputs/v1")throw Error("Unexpected source selection schema");
const inputs={},identities={};
for(const name of ["topology","context","coverage","network"]){
  const entry=selected.sources[name],path=resolve(root,entry.path),bytes=readFileSync(path);
  if(bytes.length!==entry.bytes||sha(bytes)!==entry.sha256)throw Error("Original source identity changed: "+name);
  inputs[name]=JSON.parse(bytes.toString("utf8"));identities[name]={...entry};
}
const result=buildUtilitySourceContext({...inputs,identities});
// The optional offline navigation member must contain this exact topology edition.
const explorerPath=resolve(root,"source/utility-source-context/20261013/source-explorer.html");
let sourceExplorer=null,sourceExplorerStatus="unavailable";
try {
  const body=readFileSync(explorerPath,"utf8");
  const match=body.match(/<script type="application\/json" id="source-bank">([\s\S]*?)<\/script>/);
  const bank=match?JSON.parse(match[1]):null;
  const matched=bank && ["topology","network"].every(name=>{
    const entry=identities[name],original=bank.files?.[entry.path];
    return typeof original==="string" && Buffer.byteLength(original,"utf8")===entry.bytes && sha(Buffer.from(original,"utf8"))===entry.sha256;
  });
  if(matched){sourceExplorer=body;sourceExplorerStatus="same_original_topology";}
  else sourceExplorerStatus="different_original_topology";
} catch(error) {
  if(error.code!=="ENOENT")throw error;
}
const bodies={
  "utility-source-context.json":JSON.stringify(result,null,2)+"\n",
  "utility-state-context.csv":utilityContextCsv(result),
  "utility-source-context.html":utilityContextHtml(result),
  "explorer.html":utilityContextExplorer(result,{sourceExplorerHref:sourceExplorer?"./source-explorer.html":null}),
  ...(sourceExplorer?{"source-explorer.html":sourceExplorer}:{})
};
const output=resolve(options["--out"]||resolve(root,"outputs/utility-source-context"));
mkdirSync(output,{recursive:true});
const files={};
for(const [name,body]of Object.entries(bodies)){
  const target=resolve(output,name),temporary=target+".tmp-"+process.pid;
  writeFileSync(temporary,body,"utf8");renameSync(temporary,target);
  const bytes=readFileSync(target);files[name]={path:target,bytes:bytes.length,sha256:sha(bytes)};
}
process.stdout.write(JSON.stringify({schema:"upstate.utility-source-context-receiving/v1",
  operation_id:result.operation_id,presentation_version:PRESENTATION_VERSION,source_explorer_status:sourceExplorerStatus,input_manifest:inputPath,output_directory:output,
  utilities:result.utilities.map(area=>({id:area.id,summary:area.summary})),files},null,2)+"\n");
