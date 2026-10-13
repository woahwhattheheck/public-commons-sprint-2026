import fs from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {createHash} from "node:crypto";
import {buildTraceMetalStudy} from "./analysis_core.mjs";
import {defaultTraceSelection,normalizeTraceSelection,selectedTraceRows,prepareTraceReport,traceZip} from "./report_core.mjs";
import {renderTraceHtml} from "./explorer_template.mjs";
const here=path.dirname(fileURLToPath(import.meta.url));
const args=process.argv.slice(2);let output=path.join(here,"generated"),selectionPath=null;
for(let i=0;i<args.length;i++){if(args[i]==="--output"&&args[i+1])output=path.resolve(args[++i]);else if(args[i]==="--selection"&&args[i+1])selectionPath=path.resolve(args[++i]);else throw Error("Usage: node build.mjs [--output separate-directory] [--selection original-selection.json]");}
if(output===here)throw Error("Choose an output directory separate from the maintained builder.");
const sha=body=>createHash("sha256").update(body).digest("hex"),read=name=>fs.readFile(path.join(here,name),"utf8");
const input=JSON.parse(await read("inputs.json")),columns=input.columns,sourceFiles={};
async function original(name,descriptor){
 let body;
 try{body=await fs.readFile(path.join(here,name));}catch(error){if(error.code!=="ENOENT")throw error;body=await fs.readFile(path.join(here,"..",name));}
 if(body.length!==descriptor.bytes||sha(body)!==descriptor.sha256)throw Error("Original source differs: "+name);
 return body.toString("utf8");
}
for(const source of input.sources)sourceFiles[source.source_path]=await original(source.source_path,source);
sourceFiles[input.normalizer.path]=await original(input.normalizer.path,input.normalizer);
const normalizerUrl="data:text/javascript;base64,"+Buffer.from(sourceFiles[input.normalizer.path]).toString("base64");
const {buildWqpTables,parseCsv,writeCsv}=await import(normalizerUrl);
const captures=input.sources.map(source=>({...source,rows:parseCsv(sourceFiles[source.source_path])}));
for(const capture of captures)if(capture.rows.length!==capture.record_count)throw Error("Original response row count differs: "+capture.source_path);
const tables=buildWqpTables(captures),full=writeCsv(tables.measurements);
if(Buffer.byteLength(full)!==input.original_normalized.bytes||sha(full)!==input.original_normalized.sha256)throw Error("The maintained normalizer does not reproduce the original complete measurement CSV.");
const studyInput={source_capture:input.source_capture,normalizer_sha256:input.normalizer.sha256,sources:input.sources};
const study=buildTraceMetalStudy(tables,studyInput),identity=sha(JSON.stringify(studyInput));
let selection={...defaultTraceSelection};
if(selectionPath){const record=JSON.parse(await fs.readFile(selectionPath,"utf8"));if(record.schema!=="upstate.trace-metal-selection/v1"||record.edition!==study.edition||record.input_sha256!==identity)throw Error("Saved selection belongs to another original source edition.");selection=normalizeTraceSelection(study,record.selection);if(JSON.stringify(record.record_ids)!==JSON.stringify(selectedTraceRows(study,selection).map(r=>r.record_id)))throw Error("Saved selection original record identities differ.");}
const codeFiles=["analysis_core.mjs","report_core.mjs","explorer.mjs","explorer.css","explorer_template.mjs","build.mjs","hash.mjs","inputs.json","README.md"];
for(const name of codeFiles)sourceFiles[name]=await read(name);
const hashSource=sourceFiles["hash.mjs"].replace(/^export.*$/gm,"");
const html=renderTraceHtml(study,sourceFiles,columns,{selection,client:sourceFiles["explorer.mjs"],reportCore:sourceFiles["report_core.mjs"],hashSource,utf8Source:"",css:sourceFiles["explorer.css"]});
const product=prepareTraceReport(study,selection,sourceFiles,sha,columns,{html});
const outputs={...product.files,"study.json":JSON.stringify(study,null,2)+"\n","index.html":html};
await fs.mkdir(output,{recursive:true});
for(const [name,body] of Object.entries(outputs)){
 const target=path.join(output,name);await fs.mkdir(path.dirname(target),{recursive:true});
 try{const prior=await fs.readFile(target,"utf8");if(prior!==body)throw Error("Output already contains another source edition: "+name);}catch(error){if(error.code!=="ENOENT")throw error;await fs.writeFile(target,body,{flag:"wx"});}
}
const zip=traceZip(product.files),zipPath=path.join(output,"trace-metals-"+product.id.slice(0,12)+".zip");
try{const old=await fs.readFile(zipPath);if(sha(old)!==sha(zip))throw Error("Existing report package differs.");}catch(error){if(error.code!=="ENOENT")throw error;await fs.writeFile(zipPath,zip,{flag:"wx"});}
process.stdout.write(JSON.stringify({schema:"upstate.trace-metal-build/v1",id:product.id,output,source_manifest:path.join(output,"sources.json"),html:path.join(output,"index.html"),package:zipPath,package_bytes:zip.length,package_sha256:sha(zip),records:product.rows.length,activities:product.activities.length,source_input_sha256:identity,original_normalized_sha256:sha(full)},null,2)+"\n");
