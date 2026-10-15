import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import * as codec from "../operator/codec.mjs";
import {buildPlanningDesk} from "../operator/build.mjs";
import {runCapacityTransport} from "../commissioning/capacity-transport.mjs";
import {ownedDirectory,writeMember} from "./io.mjs";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),".."),raw=fs.readFileSync(path.join(root,"source-manifest.json"),"utf8"),manifest=JSON.parse(raw),files={"source-manifest.json":raw};
if(manifest.schema!=="tjlabs.planning-source-manifest.v1")throw Error("Current complete production manifest required");
for(const f of manifest.files){if(!f.path||f.path.startsWith("/")||f.path.includes("\\")||f.path.split("/").some(x=>!x||x==="."||x===".."))throw Error("Unsafe source path");let p=root;for(const part of f.path.split("/")){p=path.join(p,part);if(fs.lstatSync(p).isSymbolicLink())throw Error("Source symlink rejected");}const b=fs.readFileSync(p);if(b.length!==f.bytes||codec.sha256Bytes(b)!==f.sha256)throw Error("Complete source differs: "+f.path);files[f.path]=codec.utf8Decode(b);}
if(!process.argv[2]||!process.argv[3])throw Error("Usage: node native/receive-capacity-transport.mjs EXISTING_WORKSPACE.json NEW_DIRECTORY");
const st=fs.lstatSync(process.argv[2]);if(!st.isFile()||st.isSymbolicLink()||st.size>128*1024*1024)throw Error("Bounded regular workspace file required");const original=fs.readFileSync(process.argv[2]),workspaceText=codec.utf8Decode(original);if(codec.toBase64(codec.utf8Encode(workspaceText))!==codec.toBase64(original))throw Error("Exact UTF-8 workspace required");
const summary=runCapacityTransport({files:Object.freeze(files),codec,build:buildPlanningDesk,workspaceText,progress:x=>process.stderr.write(JSON.stringify(x)+"\n")}),identity=codec.sha256Bytes(codec.utf8Encode(JSON.stringify(summary))),out=ownedDirectory(process.argv[3],identity);writeMember(out,"Capacity_Transport.json",JSON.stringify({...summary,runtime:"Node.js "+process.version+"; exact production source"} ,null,2)+"\n");console.log(JSON.stringify({directory:out,identity,summary}));
