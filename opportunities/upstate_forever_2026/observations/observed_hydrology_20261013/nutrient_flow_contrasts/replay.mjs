import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {fileURLToPath} from "node:url";
import {compute} from "./compute.mjs";
const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(process.argv[2]||path.join(here,".."));
const destination=path.resolve(process.argv[3]||here);
const receipt=JSON.parse(fs.readFileSync(path.join(here,"inputs.json"),"utf8"));
const files={};
for(const input of receipt.inputs){
 const body=fs.readFileSync(path.join(root,input.path));
 if(body.length!==input.bytes||crypto.createHash("sha256").update(body).digest("hex")!==input.sha256)throw Error("Original input differs: "+input.path);
 files[input.path]=body.toString("utf8");
}
const result=compute(files);fs.mkdirSync(destination,{recursive:true});
const hashes={};
for(const [name,content] of Object.entries(result.files)){
 const body=Buffer.from(content);const target=path.join(destination,name);
 if(fs.existsSync(target)&&!fs.readFileSync(target).equals(body))throw Error("Existing calculated edition differs: "+name);
 if(!fs.existsSync(target))fs.writeFileSync(target,body,{flag:"wx"});
 hashes[name]={bytes:body.length,sha256:crypto.createHash("sha256").update(body).digest("hex")};
}
console.log(JSON.stringify({schema:"upstate.nutrient-flow-replay/v1",source_root:root,output:destination,outputs:hashes},null,2));
