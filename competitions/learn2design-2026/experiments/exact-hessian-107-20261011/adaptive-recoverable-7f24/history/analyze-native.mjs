#!/usr/bin/env node
// MIT — Read original native JSON; write complete reproducible analysis without executing physics.
import {readFile,mkdir,writeFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {fileURLToPath,pathToFileURL} from "node:url";
import {resolve,basename,dirname,join} from "node:path";
import {createHistoryAnalysis} from "./analysis.mjs";
import {historySvg} from "./plots.mjs";
import {makeHistoryReport} from "./report.mjs";

const sha256Utf8=text=>createHash("sha256").update(text,"utf8").digest("hex");
const identity=content=>({bytes:Buffer.byteLength(content,"utf8"),sha256:sha256Utf8(content)});
export function buildHistoryArtifacts({inputs,analysisSource,plotSource}) {
  if(!Array.isArray(inputs)||!inputs.length)throw Error("At least one complete original native JSON is required");
  const api=createHistoryAnalysis({sha256Utf8}), originals=[],analyses=[];
  for(const [index,input] of inputs.entries()){
    const id=identity(input.content);
    if(input.sha256&&input.sha256!==id.sha256)throw Error("Original source SHA differs: "+input.path);
    const value=JSON.parse(input.content),name=basename(input.path).replace(/[^a-zA-Z0-9._-]/g,"_")||"native.json";
    const original={path:"originals/"+String(index+1).padStart(3,"0")+"-"+name,...id,content:input.content};
    originals.push(original);
    analyses.push(api.analyzePanel(value,{path:original.path,sha256:original.sha256}));
  }
  const analysis={schema:"tjlabs.l2d.history-analysis/v1",origin:{inputs:originals.map(({content,...v})=>v)},cells:analyses.flatMap(a=>a.cells),unavailable:analyses.flatMap(a=>a.unavailable.map(v=>({...v,origin:a.origin}))),definitions:analyses[0].definitions,panel_contexts:analyses.map(a=>({origin:a.origin,context:a.retained_panel_context}))};
  const files=Object.fromEntries(originals.map(f=>[f.path,f.content]));
  files["native-history-analysis.json"]=JSON.stringify(analysis,null,2)+"\n";
  files["native-history-points.csv"]=api.csv(analysis);
  for(const [i,cell] of analysis.cells.entries())files["figures/"+String(i+1).padStart(3,"0")+"-T"+cell.topology_seed+"-"+String(cell.arm).replace(/[^a-zA-Z0-9._-]/g,"_")+".svg"]=historySvg(cell);
  files["native-history-complete.html"]=makeHistoryReport({analysis,originals,analysisSource,plotSource});
  files["ARTIFACTS.json"]=JSON.stringify({schema:"tjlabs.l2d.history-artifacts/v1",complete_cells:analysis.cells.length,unavailable_cells:analysis.unavailable.length,files:Object.entries(files).map(([path,content])=>({path,...identity(content)}))},null,2)+"\n";
  return {analysis,files};
}
export async function main(argv=process.argv.slice(2)) {
  const outIndex=argv.indexOf("--out");
  if(outIndex<0||!argv[outIndex+1])throw Error("Usage: node analyze-native.mjs --out NEW_DIRECTORY PANEL.json [CELL.json ...]");
  const out=resolve(argv[outIndex+1]),paths=argv.filter((_,i)=>i!==outIndex&&i!==outIndex+1);
  if(!paths.length||paths.some(p=>p.startsWith("--")))throw Error("Supply complete original native JSON paths");
  const inputs=[];
  for(const path of paths){const raw=await readFile(resolve(path));inputs.push({path,content:new TextDecoder("utf-8",{fatal:true}).decode(raw),sha256:createHash("sha256").update(raw).digest("hex")});}
  const here=dirname(fileURLToPath(import.meta.url)),analysisSource=await readFile(join(here,"analysis.mjs"),"utf8"),plotSource=await readFile(join(here,"plots.mjs"),"utf8");
  const result=buildHistoryArtifacts({inputs,analysisSource,plotSource});
  await mkdir(out,{recursive:false});
  for(const [path,content] of Object.entries(result.files)){const target=join(out,path);await mkdir(dirname(target),{recursive:true});await writeFile(target,content,{encoding:"utf8",flag:"wx"});}
  process.stdout.write(JSON.stringify({schema:"tjlabs.l2d.history-cli-result/v1",directory:out,complete_cells:result.analysis.cells.length,unavailable_cells:result.analysis.unavailable.length,files:Object.entries(result.files).map(([path,content])=>({path,...identity(content)}))},null,2)+"\n");
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{process.stderr.write(error.stack+"\n");process.exitCode=1;});
