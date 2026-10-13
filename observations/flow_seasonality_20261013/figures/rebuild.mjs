#!/usr/bin/env node
/** Rebuild exact original seasonal figures, native report recipe and source manifest. */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import vm from "node:vm";
import {seasonalFigureProducts,PREFIX} from "./products.mjs";
const args=process.argv.slice(2);
if(args.includes("--help")){console.log("Usage: node observations/flow_seasonality_20261013/figures/rebuild.mjs --app-root PATH");process.exit(0);}
let app=process.cwd();
for(let i=0;i<args.length;i++){if(args[i]!=="--app-root"||!args[i+1])throw Error("Use --app-root PATH");app=args[++i];}
app=fs.realpathSync(app);
const safe=name=>{
 if(typeof name!=="string"||name.includes("\\")||name.includes("\0")||name.startsWith("/")||name.split("/").some(p=>!p||p==="."||p===".."))throw Error("Select an original application-relative source member");
 const actual=path.resolve(app,...name.split("/"));
 if(!actual.startsWith(app+path.sep))throw Error("Original source member leaves the application");
 return actual;
};
const sha=body=>crypto.createHash("sha256").update(body).digest("hex");
const describe=(name,body)=>({path:name,bytes:Buffer.byteLength(body,"utf8"),sha256:sha(Buffer.from(body,"utf8"))});
const read=name=>fs.readFileSync(safe(name));
const inputText=read(PREFIX+"/inputs.json").toString("utf8"),inputs=JSON.parse(inputText);
if(inputs.schema!=="upstate.seasonal-figure-inputs/v1")throw Error("Choose the original seasonal figure source edition");
const original=new Map();
for(const record of inputs.original_members){
 const body=read(record.path);
 if(body.length!==record.bytes||sha(body)!==record.sha256)throw Error("Original source identity differs: "+record.path);
 if(original.has(record.path))throw Error("Original figure source paths must be unique");
 original.set(record.path,body);
}
const modules=new Map();
function requireVendor(name){
 if(modules.has(name))return modules.get(name);
 const record=inputs.vendor.find(r=>r.module===name);
 if(!record||!original.has(record.path))throw Error("Original figure dependency was not retained: "+name);
 const module={exports:{}};modules.set(name,module.exports);
 vm.runInNewContext(original.get(record.path).toString("utf8"),{module,exports:module.exports,require:requireVendor},{filename:record.path,timeout:5000});
 modules.set(name,module.exports);return module.exports;
}
const d3={...requireVendor("d3-path"),...requireVendor("d3-array"),...requireVendor("d3-shape")};
const data=JSON.parse(original.get(inputs.data_path).toString("utf8")),originalFigureSpec=JSON.parse(original.get(inputs.original_figure_spec).toString("utf8"));
const staticFiles={[PREFIX+"/inputs.json"]:inputText};
for(const name of["figure_source.mjs","render_svg.mjs","products.mjs","rebuild.mjs","README.md"])staticFiles[PREFIX+"/"+name]=read(PREFIX+"/"+name).toString("utf8");
const files=seasonalFigureProducts({data,originalFigureSpec,inputs,staticFiles,d3,describe});
for(const [name,body]of Object.entries(files)){
 const destination=safe(name);fs.mkdirSync(path.dirname(destination),{recursive:true});
 const temporary=path.join(path.dirname(destination),".write-"+path.basename(destination)+"-"+process.pid);
 try{fs.writeFileSync(temporary,body,"utf8");fs.renameSync(temporary,destination);}
 finally{if(fs.existsSync(temporary))fs.unlinkSync(temporary);}
}
console.log(JSON.stringify({schema:"upstate.seasonal-figure-rebuild/v1",verified_original_members:original.size,figures:4,files:Object.entries(files).map(([name,body])=>describe(name,body)),native_manifest:"observed_seasonal_figures.sources.json"},null,2));
