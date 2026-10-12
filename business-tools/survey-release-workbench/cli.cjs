#!/usr/bin/env node
"use strict";
const fs=require("node:fs"),path=require("node:path"),http=require("node:http"),zlib=require("node:zlib"),crypto=require("node:crypto");
const C=require("./core.cjs"),ROOT=__dirname;
function arg(name,fallback){const n=process.argv.indexOf("--"+name);if(n<0)return fallback;if(n+1>=process.argv.length||process.argv[n+1].startsWith("--"))throw Error("Missing --"+name+" value");return process.argv[n+1];}
function readText(filename){return fs.readFileSync(filename,"utf8");}
function readJSON(filename){return JSON.parse(readText(filename));}
function readBundledWorkspace(){
 const dir=path.resolve(arg("data",path.join(ROOT,"data"))),manifest=readJSON(path.join(dir,"source-manifest.json")),texts={};
 for(const f of manifest.files){if(!C.safePath(f.path))throw Error("Invalid source path");texts[f.path]=readText(path.join(dir,f.path));}
 return C.makeWorkspace(manifest,texts,manifest.snapshot_at);
}
function inputWorkspace(){const filename=arg("case",null);return filename?C.openWorkspace(readText(path.resolve(filename))):readBundledWorkspace();}
function inputCase(){return inputWorkspace().savedCase;}
function standalone(savedCase){
 const embed=value=>value.replace(/</g,"\\u003c").replace(/\u2028/g,"\\u2028").replace(/\u2029/g,"\\u2029");
 let html=readText(path.join(ROOT,"index.html"));
 html=html.replace('<link rel="stylesheet" href="style.css">',"<style>"+readText(path.join(ROOT,"style.css"))+"</style>");
 html=html.replace('<script src="core.cjs"></script>',"<script>"+readText(path.join(ROOT,"core.cjs")).replace(/<\/script/gi,"<\\/script")+"</script>");
 html=html.replace('<script src="app.js"></script>','<script id="embedded-case" type="application/json">'+embed(C.canonical(savedCase))+"</script><script>"+readText(path.join(ROOT,"app.js")).replace(/<\/script/gi,"<\\/script")+"</script>");
 // A standalone edition opens its embedded sources and any saved compatible review continuation.
 return html;
}
function sha(bytes){return crypto.createHash("sha256").update(bytes).digest("hex");}
function ensureFile(filename,bytes){
 if(fs.existsSync(filename)){
  const current=fs.readFileSync(filename);if(current.length!==bytes.length||sha(current)!==sha(bytes))throw Error("Existing delivery differs; retain it and choose a different output directory: "+filename);
  const parent=fs.openSync(path.dirname(filename),"r");try{fs.fsyncSync(parent);}finally{fs.closeSync(parent);}
  return "reused";
 }
 const partial=filename+"."+process.pid+"."+crypto.randomBytes(6).toString("hex")+".part";
 const fd=fs.openSync(partial,"wx");
 let completed=false;
 try{
  let offset=0;while(offset<bytes.length){const n=fs.writeSync(fd,bytes,offset,bytes.length-offset);if(!n)throw Error("Short output write");offset+=n;}
  fs.fsyncSync(fd);completed=true;
 }finally{fs.closeSync(fd);if(!completed)fs.unlinkSync(partial);}
 let state="created";
 try{fs.linkSync(partial,filename);}catch(error){
  if(error.code!=="EEXIST")throw error;
  const current=fs.readFileSync(filename);if(current.length!==bytes.length||sha(current)!==sha(bytes))throw Error("A concurrent delivery differs; original output retained.");
  state="reused";
 }finally{fs.unlinkSync(partial);}
 const parent=fs.openSync(path.dirname(filename),"r");try{fs.fsyncSync(parent);}finally{fs.closeSync(parent);}
 return state;

}
function publish(){
 const workspace=inputWorkspace(),savedCase=workspace.savedCase,filterFile=arg("filters",null),filters=filterFile?readJSON(path.resolve(filterFile)):{};
 const result=C.release(savedCase,workspace.model,filters),summary=C.summary(workspace.model,savedCase);
 const editionId=result.edition_id,manifest=result.manifest,outputRoot=path.resolve(arg("out",path.join(ROOT,"output")));
 // Packaging needs the exact text files, not another retained publication/model graph.
 delete result.publication;workspace.model=null;
 fs.mkdirSync(outputRoot,{recursive:true});
 const entry=(name,read)=>({name,get content(){return read();}});
 const take=key=>{const text=result[key];delete result[key];return text;};
 const entries=[
  entry("release.csv",()=>take("csv")),entry("release.json",()=>take("json")),entry("codebook.csv",()=>take("codebook")),
  entry("edition.json",()=>C.canonical(manifest)+"\n"),entry("source-case.json",()=>C.canonical(savedCase)+"\n"),
  entry("review-history.json",()=>C.canonical(savedCase.review_events)+"\n"),entry("workbench.html",()=>standalone(savedCase))
 ];
 for(const filename of ["core.cjs","cli.cjs","index.html","app.js","style.css","README.md","SOURCE_NOTES.md"]){
  const location=path.join(ROOT,filename);if(fs.existsSync(location))entries.push(entry("application/"+filename,()=>readText(location)));
 }
 entries.push(entry("application/data/source-manifest.json",()=>C.canonical(savedCase.manifest)+"\n"));
 for(const f of savedCase.manifest.files)entries.push(entry("application/data/"+f.path,()=>savedCase.source_texts[f.path]));
 const archive=C.zipFiles(entries,raw=>zlib.deflateRawSync(raw,{level:6}));
 const zipped=Buffer.from(archive.buffer,archive.byteOffset,archive.byteLength);
 const zipPath=path.join(outputRoot,editionId+".zip"),state=ensureFile(zipPath,zipped);
 const outcome={schema:"survey-delivery-result/v1",edition_id:editionId,case_id:savedCase.case_id,output:zipPath,state,
  bytes:zipped.length,sha256:sha(zipped),members:entries.length,summary,release:manifest};
 process.stdout.write(JSON.stringify(outcome,null,2)+"\n");
}
function serve(){
 const manifest=readJSON(path.join(ROOT,"data/source-manifest.json")),allowed=new Set(["/","/index.html","/core.cjs","/app.js","/style.css","/data/source-manifest.json",...manifest.files.map(f=>"/data/"+f.path)]);
 const types={".html":"text/html; charset=utf-8",".css":"text/css; charset=utf-8",".js":"text/javascript; charset=utf-8",".cjs":"text/javascript; charset=utf-8",".json":"application/json; charset=utf-8",".md":"text/plain; charset=utf-8",".sas":"text/plain; charset=utf-8"};
 const server=http.createServer((request,response)=>{
  let pathname;try{pathname=decodeURIComponent(new URL(request.url,"http://localhost").pathname);}catch(_){response.writeHead(400);response.end("Invalid path");return;}
  if(!["GET","HEAD"].includes(request.method)||!allowed.has(pathname)){response.writeHead(404);response.end("Not found");return;}
  const filename=path.join(ROOT,pathname==="/"?"index.html":pathname.slice(1));
  fs.stat(filename,(error,stat)=>{
   if(error||!stat.isFile()){response.writeHead(404);response.end("Not found");return;}
   response.writeHead(200,{"Content-Type":types[path.extname(filename)]||"text/plain; charset=utf-8","Content-Length":stat.size,"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"});
   if(request.method==="HEAD")response.end();else{const stream=fs.createReadStream(filename);stream.on("error",()=>response.destroy());stream.pipe(response);}
  });
 });
 const port=Number(arg("port","8786"));if(!Number.isInteger(port)||port<0||port>65535)throw Error("Invalid local port");
 server.listen(port,"127.0.0.1",()=>process.stdout.write(JSON.stringify({url:"http://127.0.0.1:"+server.address().port,source_commit:manifest.commit})+"\n"));
 for(const signal of ["SIGINT","SIGTERM"])process.on(signal,()=>server.close(()=>process.exit(0)));
}
function inspect(){
 const {savedCase:c,model:m}=inputWorkspace();
 process.stdout.write(JSON.stringify({case_id:c.case_id,source_commit:c.manifest.commit,summary:C.summary(m,c)},null,2)+"\n");
}
function main(){
 const command=process.argv[2]||"help";
 if(command==="prepare"||command==="export")return publish();
 if(command==="inspect")return inspect();
 if(command==="serve")return serve();
 if(command==="standalone"){const c=inputCase(),target=path.resolve(arg("out",path.join(ROOT,"workbench.html")));fs.mkdirSync(path.dirname(target),{recursive:true});const content=Buffer.from(standalone(c));const state=ensureFile(target,content);process.stdout.write(JSON.stringify({output:target,bytes:content.length,sha256:sha(content),state})+"\n");return;}
 if(command==="compare"){const left=arg("left",null),right=arg("right",null);if(!left||!right)throw Error("compare needs --left and --right saved cases");const result=C.compareCases(C.openCase(readText(path.resolve(left))),C.openCase(readText(path.resolve(right))));process.stdout.write(JSON.stringify(result,null,2)+"\n");return;}
 if(command!=="help")throw Error("Unknown command: "+command);
 process.stdout.write("Survey Release Workbench\n\n  node cli.cjs serve [--port 8786]\n  node cli.cjs inspect [--case saved.json | --data data]\n  node cli.cjs prepare [--data data] --out output\n  node cli.cjs export --case saved.json [--filters filters.json] --out output\n  node cli.cjs standalone [--case saved.json] --out workbench.html\n  node cli.cjs compare --left prior.json --right current.json\n\nNo network, installation or paid service is used to prepare a release.\n");
}
try{main();}catch(error){process.stderr.write(error.message+"\n");process.exitCode=1;}
