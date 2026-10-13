#!/usr/bin/env node
// Build the source comparison from retained catalogues; performs no network call.
import fs from "node:fs/promises";
import path from "node:path";
import {createHash,randomUUID} from "node:crypto";
import {fileURLToPath} from "node:url";
import "./catalogue.js";
import "./portable.js";
const C=globalThis.GaugeCatalogue,args={},words=process.argv.slice(2);
for(let i=0;i<words.length;i+=2){
 if(!words[i]?.startsWith("--")||!words[i+1])throw Error("Use --option value pairs.");
 const key=words[i].slice(2);if(Object.hasOwn(args,key))throw Error("Repeated option: "+key);args[key]=words[i+1];
}
const allowed=new Set(["before","after","before-format","after-format","before-identity","after-identity","project","notes","select","out"]);
for(const key of Object.keys(args))if(!allowed.has(key))throw Error("Unknown option: "+key);
const utf8=new TextDecoder("utf-8",{fatal:true,ignoreBOM:true});
const read=async file=>utf8.decode(await fs.readFile(file));
const hash=bytes=>createHash("sha256").update(bytes).digest("hex");
async function source(file,format,identityFile){
 const raw=await read(file),parsed=JSON.parse(raw),identity=identityFile?JSON.parse(await read(identityFile)):{};
 if(parsed?.schema==="commons.civicmapper-rainfall-original-source.v1"){
  const matches=parsed.sources.filter(s=>s.path==="gauges.json");
  if(matches.length!==1)throw Error("Publisher packet needs one complete original gauges.json source.");
  const row=matches[0],observed=parsed.observed_at?.replace(" UTC","Z").replace(" ","T");
  return C.normalize(row.content,{...row,label:"Publisher gauge catalogue",retrieved_at:observed,format:"publisher",...identity,...(format?{format}:{})});
 }
 if(parsed&&typeof parsed.content==="string")return C.normalize(parsed.content,{...parsed,...identity,...(format?{format}:{})});
 return C.normalize(raw,{label:path.basename(file),...identity,...(format?{format}:{})});
}
try{
 if(!args.out)throw Error("Use --out NEW_DIRECTORY and either --before FILE --after FILE or --project FILE.");
 if(args.project&&(args.before||args.after||args["before-identity"]||args["after-identity"]||args["before-format"]||args["after-format"]))throw Error("Choose a saved project or two original sources.");
 let project;
 if(args.project)project=C.reopen(JSON.parse(await read(args.project))).project;
 else{
  if(!args.before||!args.after)throw Error("Select both original catalogue sources.");
  const before=await source(args.before,args["before-format"],args["before-identity"]),after=await source(args.after,args["after-format"],args["after-identity"]);
  project=C.project({before,after});
 }
 if(args.notes)project.notes=await read(args.notes);
 if(args.select)project.selected_web_ids=args.select.split(",").map(x=>x.trim());
 const reopened=C.reopen(project),comparison=reopened.comparison;
 project=reopened.project;
 const files={
  "catalogue-project.json":JSON.stringify(project,null,2)+"\n",
  "catalogue-comparison.json":JSON.stringify(comparison,null,2)+"\n",
  "catalogue-report.html":C.report(comparison,{notes:project.notes,selected_web_ids:project.selected_web_ids}),
  "catalogue-records.csv":C.csv(C.recordRows(comparison)),
  "originals/before.geojson":project.before.content,
  "originals/after.geojson":project.after.content,
  "README.txt":"Open OPEN_FIRST.html in a browser, then the editable catalogue.html review or catalogue-report.html. The handover contains all original records and downloads for the saved project, comparison, CSV and both raw sources. Open and visually inspect the exact report at desktop and narrow widths, use its downloads and reopen catalogue-project.json before client presentation. Project/source hashes retain the actual inputs. Query selection describes the current observed catalogue, not historical instrument assignment.\n"
 };
 if(Buffer.byteLength(files["catalogue-project.json"],"utf8")>40*1024*1024)throw Error("The complete source project exceeds the reviewer’s 40 MB import limit. Choose a smaller source review.");
 if(project.selected_web_ids.length)files["catalogue-selection.json"]=JSON.stringify(C.selection(comparison,project.selected_web_ids),null,2)+"\n";
 const ownDir=path.dirname(fileURLToPath(import.meta.url));
 // Rebuilding includes these exact maintained files and the owner instructions.
 const sourceNames=["core.js","capture.mjs","index.html","README.md","SOURCES.md","AGENTS.md","portable.js","handover.mjs","receive_handover.mjs","HANDOVER.md","source/20261013/publisher-selection.json","catalogue.js","catalogue.html","catalogue_report.mjs","source/20261013/gauge-catalogue-project.json","THIRD_PARTY.md","licenses/3rww-rainfall-Apache-2.0.txt"];
 for(const name of sourceNames)files["source/"+name]=await read(path.join(ownDir,name));
 const editor=files["source/catalogue.html"],module=files["source/catalogue.js"];
 if(!editor.includes("<script>"+module+"</script>"))throw Error("The catalogue editor and editable module differ.");
 const payload=JSON.stringify(project).replace(/</g,"\\u003c").replace(/\u2028/g,"\\u2028").replace(/\u2029/g,"\\u2029");
 if(Buffer.byteLength(payload,"utf8")>40*1024*1024)throw Error("The embedded source project exceeds the reviewer’s 40 MB import limit.");
 const projectPattern=/(<script type="application\/json" id="prepared-catalogue">)[\s\S]*?(<\/script>)/;
 if(!projectPattern.test(editor))throw Error("The maintained catalogue editor's original-project seam is missing.");
 files["catalogue.html"]=editor.replace(projectPattern,(_,start,end)=>start+payload+end).replace('<a id="rainfall-link" href="index.html">','<a id="rainfall-link" href="source/index.html">');
 files["OPEN_FIRST.html"]='<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Gauge source review</title><style>*{box-sizing:border-box}body{font:16px/1.55 system-ui;color:#25292e;max-width:950px;margin:36px auto;padding:0 20px}h1{font-size:28px}h2{font-size:21px}nav{display:flex;flex-wrap:wrap;gap:10px}a{color:#303a45}nav a{padding:12px 16px;border:1px solid #a4abb2;border-radius:4px;text-decoration:none;background:#f4f5f6}li{margin:8px 0}code{overflow-wrap:anywhere}</style><h1>Gauge source review</h1><p>Compare the retained reference and publisher catalogues, inspect complete station records, and keep an editable source review.</p><nav><a href="catalogue.html">Open editable review</a><a href="catalogue-report.html">Open source report</a><a href="catalogue-project.json" download>Download saved review</a></nav><h2>Use and continue</h2><ol><li>Open the editable review. Filter records and open a query ID to inspect every retained source feature.</li><li>Select current active query IDs and add reviewer notes. Save the source review to continue those decisions later.</li><li>Export the current request selection, source report or complete source records CSV.</li><li>Reopen your saved review using Load saved source review.</li></ol><p>Current catalogue records describe identity at retrieval. The source has no validity dates establishing an instrument assignment for an earlier rainfall window.</p><h2>Originals and editable application</h2><p>The <a href="originals/before.geojson">reference GeoJSON</a> and <a href="originals/after.geojson">retrieved GeoJSON</a> retain complete original source text. <a href="catalogue-records.csv">The full record table</a> includes both catalogues. <a href="source/README.md">The application guide</a> covers source selection and rainfall capture; <a href="source/HANDOVER.md">the handover guide</a> covers rebuilding and receiving. Source code and attribution are included in the source folder. <a href="manifest.json">The manifest</a> identifies every file.</p><p>This package opens offline after extraction.</p></html>';

 const destination=path.resolve(args.out),staging=destination+".building-"+randomUUID();
 await fs.mkdir(path.dirname(destination),{recursive:true});await fs.mkdir(staging);
 try{
  const metadata={};
  for(const [name,value] of Object.entries(files)){
   const target=path.join(staging,name),bytes=Buffer.from(value,"utf8");await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,bytes,{flag:"wx"});
   const actual=await fs.readFile(target);if(actual.length!==bytes.length||hash(actual)!==hash(bytes))throw Error("Written source differs: "+name);
   metadata[name]={bytes:actual.length,sha256:hash(actual)};
  }
  const manifest={schema:"gauge-catalogue-delivery/v1",version:C.VERSION,created_at:new Date().toISOString(),
   sources:{before:project.before.sha256,after:project.after.sha256},summary:comparison.summary,files:metadata};
  await fs.writeFile(path.join(staging,"manifest.json"),JSON.stringify(manifest,null,2)+"\n",{flag:"wx"});
  const zip=RainfallHandover.zip([...Object.entries(files).map(([path,content])=>({path,content})),{path:"manifest.json",content:JSON.stringify(manifest,null,2)+"\n"}]);
  const archive={file:"gauge-catalogue-handover.zip",bytes:zip.length,sha256:hash(zip)};
  await fs.writeFile(path.join(staging,archive.file),zip,{flag:"wx"});
  await fs.writeFile(path.join(staging,"BUILD.json"),JSON.stringify({directory:destination,archive,sources:manifest.sources},null,2)+"\n",{flag:"wx"});

  await fs.mkdir(destination);
  for(const name of await fs.readdir(staging))await fs.rename(path.join(staging,name),path.join(destination,name));
  await fs.rmdir(staging);
  process.stdout.write(JSON.stringify({directory:destination,manifest,archive,selected_web_ids:project.selected_web_ids},null,2)+"\n");
 }catch(e){process.stderr.write("Prepared source remains at "+staging+" if present. Preserve partial output and choose a new destination for a retry.\n");throw e;}
}catch(e){process.stderr.write(e.stack||e.message);process.exitCode=1;}
