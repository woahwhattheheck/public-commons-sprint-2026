#!/usr/bin/env node
"use strict";
const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto");
function args(argv){const a={};for(let i=0;i<argv.length;i++){if(!["--source","--output-dir"].includes(argv[i])||!argv[i+1]||a[argv[i]])throw Error("Use --source application-source.json --output-dir NEW_DIRECTORY");a[argv[i]]=argv[++i];}if(!a["--source"]||!a["--output-dir"])throw Error("Use --source application-source.json --output-dir NEW_DIRECTORY");return a;}
function rebuild(argv){
 const a=args(argv),input=path.resolve(a["--source"]),out=path.resolve(a["--output-dir"]);if(fs.existsSync(out))throw Error("Choose a new receiving directory.");if(!fs.statSync(path.dirname(out)).isDirectory())throw Error("The output parent must already exist.");
 const raw=fs.readFileSync(input,"utf8");if(Buffer.byteLength(raw)>8*1024*1024)throw Error("Application source exceeds 8 MiB.");const source=JSON.parse(raw);
 if(source.schema!=="jsonsupport.report-application-source.v1"||!Array.isArray(source.files)||source.files.length<7)throw Error("Open the complete original application source.");
 const names=new Set();for(const f of source.files){if(typeof f.path!=="string"||f.path.includes("\\")||f.path.includes(":")||f.path.split("/").some(x=>x===".."||x==="."||x==="")||path.isAbsolute(f.path)||names.has(f.path)||typeof f.content!=="string")throw Error("Invalid or duplicate source path.");names.add(f.path);const b=Buffer.from(f.content,"utf8");if(b.length!==f.bytes||crypto.createHash("sha256").update(b).digest("hex")!==f.sha256)throw Error("Complete source differs: "+f.path);}
 for(const required of ["desk/report-core.cjs","desk/report-view.cjs","runtime/host/connected_sha256.cjs","desk/README.txt","initial-working.json","conversion-adapter.mjs","CONVERSION-ADAPTER.md","conversion-return-contract.json"])if(!names.has(required))throw Error("Complete application source is missing "+required);
 if(names.has("application-source.json")||names.has("app.html"))throw Error("Reserved output names appear in the source.");
 fs.mkdirSync(out,{mode:0o700});for(const f of source.files){const target=path.join(out,f.path);fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});fs.writeFileSync(target,f.content,{flag:"wx",mode:0o600});}fs.writeFileSync(path.join(out,"application-source.json"),raw,{flag:"wx",mode:0o600});
 const read=p=>fs.readFileSync(path.join(out,p),"utf8"),api=require(path.join(out,"desk/report-core.cjs")),view=require(path.join(out,"desk/report-view.cjs")),sha=require(path.join(out,"runtime/host/connected_sha256.cjs"));
 const workspace=api.receiveWorking(read("initial-working.json")),html=view.reportHtml({workspace,coreSource:read("desk/report-core.cjs"),shaSource:read("runtime/host/connected_sha256.cjs"),sourceFiles:source.files,guide:read("desk/README.txt")});
 fs.writeFileSync(path.join(out,"app.html"),html,{flag:"wx",mode:0o600});return{output:out,app:path.join(out,"app.html"),files:source.files.length,...sha.sha256Utf8(html)};
}
if(require.main===module){try{process.stdout.write(JSON.stringify(rebuild(process.argv.slice(2)))+"\n");}catch(e){process.stderr.write(e.message+"\n");process.exitCode=1;}}
module.exports={rebuild};
