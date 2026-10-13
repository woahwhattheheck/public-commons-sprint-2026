#!/usr/bin/env node
/** Rebuild the retained 29-gauge analysis without new provider requests. */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {buildFlowSeasonality} from "./flow_seasonality.mjs";
import {flowSeasonalityProducts,PREFIX} from "./products.mjs";
const args=process.argv.slice(2);
if(args.includes("--help")){console.log("Usage: node observations/flow_seasonality_20261013/rebuild.mjs --app-root PATH");process.exit(0);}
let app=process.cwd();
for(let i=0;i<args.length;i++){if(args[i]!=="--app-root"||!args[i+1])throw Error("Use --app-root PATH");app=args[++i];}
app=fs.realpathSync(app);
const safe=name=>{
 if(typeof name!=="string"||name.includes("\\")||name.includes("\0")||name.startsWith("/")||name.split("/").some(p=>!p||p==="."||p===".."))throw Error("Choose an application-relative source member");
 const actual=path.resolve(app,...name.split("/"));
 if(!actual.startsWith(app+path.sep))throw Error("Source member leaves the selected application");
 return actual;
};
const sha=body=>crypto.createHash("sha256").update(body).digest("hex");
const describe=(name,body)=>({path:name,bytes:Buffer.byteLength(body,"utf8"),sha256:sha(Buffer.from(body,"utf8"))});
const read=name=>fs.readFileSync(safe(name));
const checked=record=>{
 const body=read(record.path);
 if(body.length!==record.bytes||sha(body)!==record.sha256)throw Error("Original source identity differs: "+record.path);
 return body;
};
const inputText=read(PREFIX+"/inputs.json").toString("utf8"),inputs=JSON.parse(inputText);
if(inputs.schema!=="upstate.observed-flow-seasonality-inputs/v1")throw Error("Select the retained seasonality input schema");
const original=checked(inputs.snapshot).toString("utf8");
for(const member of inputs.source_members)checked(member);
const result=buildFlowSeasonality(JSON.parse(original));
const staticFiles={
 [PREFIX+"/inputs.json"]:inputText,
 [inputs.snapshot.path]:original
};
for(const name of ["flow_seasonality.mjs","products.mjs","rebuild.mjs"])staticFiles[PREFIX+"/"+name]=read(PREFIX+"/"+name).toString("utf8");
const outputs=flowSeasonalityProducts(result,inputs,staticFiles,describe);
for(const [name,body]of Object.entries(outputs)){
 const destination=safe(name);fs.mkdirSync(path.dirname(destination),{recursive:true});
 const temporary=path.join(path.dirname(destination),".write-"+path.basename(destination)+"-"+process.pid);
 try{fs.writeFileSync(temporary,body,"utf8");fs.renameSync(temporary,destination);}
 finally{if(fs.existsSync(temporary))fs.unlinkSync(temporary);}
}
console.log(JSON.stringify({schema:"upstate.observed-flow-seasonality-rebuild/v1",summary:result.summary,
 verified_original_source_members:inputs.source_members.length,files:Object.entries(outputs).map(([name,body])=>describe(name,body)),
 report_manifest:"observed_flow_seasonality.sources.json"},null,2));
