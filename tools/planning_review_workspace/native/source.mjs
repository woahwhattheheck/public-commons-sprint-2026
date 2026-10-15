import fs from "node:fs";
import path from "node:path";
import {runtime} from "./runtime.mjs";
export function readBytes(filename,max=128*1024*1024){
 const f=path.resolve(filename),st=fs.lstatSync(f);
 if(!st.isFile()||st.isSymbolicLink()||st.size>max)throw Error("Expected bounded regular file: "+f);
 return new Uint8Array(fs.readFileSync(f));
}
export const readText=(filename,max)=>runtime.decode(readBytes(filename,max));
export function completeSource(root){
 const raw=readText(path.join(root,"source-manifest.json"),4*1024*1024),manifest=JSON.parse(raw),names=new Set(),files=[];
 if(manifest.schema!=="tjlabs.planning-source-manifest.v1"||!Array.isArray(manifest.files))throw Error("Maintained source manifest required");
 for(const f of manifest.files){
  if(typeof f.path!=="string"||path.isAbsolute(f.path)||f.path.includes("\\")||f.path.split("/").some(x=>!x||x==="."||x==="..")||names.has(f.path)||f.path==="source-manifest.json"||!["100644","100755"].includes(f.mode)||f.encoding!=="utf8")throw Error("Invalid manifest member");
  names.add(f.path);let p=root;for(const x of f.path.split("/")){p=path.join(p,x);if(fs.lstatSync(p).isSymbolicLink())throw Error("Source symlink rejected");}
  const b=readBytes(p,20*1024*1024);if(b.length!==f.bytes||runtime.sha256(b)!==f.sha256)throw Error("Changed maintained source: "+f.path);
  files.push({...f,content:runtime.decode(b)});
 }
 files.push({path:"source-manifest.json",mode:"100644",encoding:"utf8",bytes:runtime.encode(raw).length,sha256:runtime.sha256(raw),content:raw});
 return {schema:"tjlabs.planning-complete-source.v1",files};
}
