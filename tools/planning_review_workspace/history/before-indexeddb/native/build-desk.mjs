import {readFile,mkdir,writeFile,lstat} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import path from "node:path";
import * as codec from "../operator/codec.mjs";
import {buildPlanningDesk} from "../operator/build.mjs";
import {createPlanningAPI} from "../planning/core.mjs";
import {createSessionAPI} from "../operator/session.mjs";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const manifest=JSON.parse(await readFile(path.join(root,"source-manifest.json"),"utf8"));
if(manifest.schema!=="tjlabs.planning-source-manifest.v1")throw Error("Production source manifest required");
const files={"source-manifest.json":JSON.stringify(manifest,null,2)+"\n"};
for(const e of manifest.files){const p=typeof e==="string"?e:e.path;if(!p||p.startsWith("/")||p.includes("\\")||p.split("/").some(x=>x==="."||x===".."||!x))throw Error("Unsafe source path");const b=await readFile(path.join(root,p));if(b.length!==e.bytes||codec.sha256Bytes(b)!==e.sha256)throw Error("Source identity changed: "+p);files[p]=codec.utf8Decode(b);}
let boot=null;if(process.argv[3]){const inputPath=path.resolve(process.argv[3]),stat=await lstat(inputPath);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>129*1024*1024)throw Error("Expected bounded complete working file");const b=await readFile(inputPath),raw=codec.utf8Decode(b);if(codec.toBase64(codec.utf8Encode(raw))!==codec.toBase64(b))throw Error("Working file is not exact UTF-8");const api=createPlanningAPI({encode:codec.utf8Encode,decode:codec.utf8Decode,sha256:x=>codec.sha256Bytes(typeof x==="string"?codec.utf8Encode(x):x),toBase64:codec.toBase64,fromBase64:codec.fromBase64}),S=createSessionAPI(api,{encode:codec.utf8Encode,sha256:x=>codec.sha256Bytes(codec.utf8Encode(x))});boot=S.pack(S.receive(raw));}
if(!process.argv[2])throw Error("Usage: node native/build-desk.mjs NEW_OUTPUT.html [COMPLETE_WORKING.json]");
const out=path.resolve(process.argv[2]),built=buildPlanningDesk(Object.freeze(files),codec,boot);
await mkdir(path.dirname(out),{recursive:true});await writeFile(out,built.html,{flag:"wx"});
console.log(JSON.stringify({path:out,bytes:codec.utf8Encode(built.html).length,sha256:codec.sha256Bytes(codec.utf8Encode(built.html)),sourceBytes:built.sourceBytes,sourceSha256:built.sourceSha256,defaultWorkspace:boot?"exact received working session":"blank",externalRuntimeDependencies:0}));
