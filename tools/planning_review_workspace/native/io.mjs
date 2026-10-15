import fs from "node:fs";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {runtime} from "./runtime.mjs";
export function writeExact(filename,value){
 const bytes=typeof value==="string"?Buffer.from(value,"utf8"):Buffer.from(value),dir=path.dirname(filename);
 const same=()=>{const st=fs.lstatSync(filename);if(!st.isFile()||st.isSymbolicLink())throw Error("Existing destination is not a regular file: "+filename);if(!fs.readFileSync(filename).equals(bytes))throw Error("Existing destination differs: "+filename);};
 if(fs.existsSync(filename)){same();return;}
 const temp=path.join(dir,"."+path.basename(filename)+".pending-"+randomUUID());let fd;
 try{fd=fs.openSync(temp,"wx",0o600);fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;try{fs.linkSync(temp,filename);}catch(e){if(e.code!=="EEXIST")throw e;same();}if(process.platform!=="win32"){const d=fs.openSync(dir,"r");try{fs.fsyncSync(d);}finally{fs.closeSync(d);}}}
 finally{if(fd!==undefined)fs.closeSync(fd);if(fs.existsSync(temp))fs.unlinkSync(temp);}
 same();
}
export function ownedDirectory(destination,identity){
 const root=path.resolve(destination),marker=".hardware-receiving-owner.json",text=JSON.stringify({schema:"tjlabs.hardware-receiving-owner.v1",identity})+"\n";
 try{fs.mkdirSync(root);}catch(e){if(e.code!=="EEXIST")throw e;}
 const st=fs.lstatSync(root);if(!st.isDirectory()||st.isSymbolicLink())throw Error("Destination must be a real directory");
 const m=path.join(root,marker);
 if(!fs.existsSync(m)){const allowedPrefix="."+marker+".pending-";const entries=fs.readdirSync(root),expected=Buffer.from(text,"utf8");for(const x of entries){if(!x.startsWith(allowedPrefix)||!/^[-0-9a-f]{36}$/.test(x.slice(allowedPrefix.length)))throw Error("Unowned occupied destination; choose an empty directory");const f=path.join(root,x),st=fs.lstatSync(f);if(!st.isFile()||st.isSymbolicLink())throw Error("Unsafe abandoned ownership stage");const b=fs.readFileSync(f);if(b.length>expected.length||!b.equals(expected.subarray(0,b.length)))throw Error("Unrelated ownership stage");}}
 writeExact(m,text);return root;
}
export function writeMember(root,name,value){
 if(!name||path.isAbsolute(name)||name.split(/[\\/]/).some(x=>!x||x==="."||x===".."))throw Error("Unsafe output member");
 const parts=name.split("/");let parent=root;
 for(const part of parts.slice(0,-1)){parent=path.join(parent,part);try{fs.mkdirSync(parent);}catch(e){if(e.code!=="EEXIST")throw e;}const st=fs.lstatSync(parent);if(!st.isDirectory()||st.isSymbolicLink())throw Error("Unsafe member directory");}
 const file=path.join(root,...parts);writeExact(file,value);const bytes=fs.readFileSync(file);return {path:name,bytes:bytes.length,sha256:runtime.sha256(bytes)};
}
