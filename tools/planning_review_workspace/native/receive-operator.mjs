import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import * as codec from "../operator/codec.mjs";
import {buildPlanningDesk} from "../operator/build.mjs";
import {runOperatorCourse} from "../commissioning/operator-course.mjs";
import {ownedDirectory,writeMember} from "./io.mjs";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),".."),raw=fs.readFileSync(path.join(root,"source-manifest.json"),"utf8"),manifest=JSON.parse(raw),files={"source-manifest.json":raw};
if(manifest.schema!=="tjlabs.planning-source-manifest.v1")throw Error("Current complete production manifest required");
for(const f of manifest.files){if(!f.path||f.path.startsWith("/")||f.path.includes("\\")||f.path.split("/").some(x=>!x||x==="."||x===".."))throw Error("Unsafe source path");let p=root;for(const part of f.path.split("/")){p=path.join(p,part);if(fs.lstatSync(p).isSymbolicLink())throw Error("Source symlink rejected");}const b=fs.readFileSync(p);if(b.length!==f.bytes||codec.sha256Bytes(b)!==f.sha256)throw Error("Complete source differs: "+f.path);files[f.path]=codec.utf8Decode(b);}
const started=Date.now(),result=await runOperatorCourse({files:Object.freeze(files),codec,build:buildPlanningDesk}),summary={...result,working:undefined,elapsedMs:Date.now()-started,runtime:"Node.js "+process.version+"; explicit in-memory DOM/storage/download adapters"},identity=codec.sha256Bytes(codec.utf8Encode(JSON.stringify(summary))),out=ownedDirectory(process.argv[2]||(()=>{throw Error("Usage: node native/receive-operator.mjs NEW_DIRECTORY");})(),identity);
writeMember(out,"Operator_Receiving.json",JSON.stringify(summary,null,2)+"\n");
writeMember(out,"Authored_Receiving_Working.json",result.working);
console.log(JSON.stringify({directory:out,identity,summary}));
