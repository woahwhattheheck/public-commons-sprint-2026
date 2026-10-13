#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import vm from "node:vm";
import {fileURLToPath} from "node:url";
import {parseCsv,writeCsv,prepareFigureData,buildScientificFigures,buildFigureSpecification} from "./figure_core.mjs";

const here=path.dirname(fileURLToPath(import.meta.url));
const studyRoot=path.resolve(process.argv[2]||path.join(here,".."));
const output=path.resolve(process.argv[3]||here);
const sourceCatalog=JSON.parse(fs.readFileSync(path.join(here,"figure-sources.json"),"utf8"));
const sha=body=>crypto.createHash("sha256").update(body).digest("hex");
for(const source of sourceCatalog.inputs){
 const body=fs.readFileSync(path.join(studyRoot,source.study_relative_path));
 if(body.length!==source.bytes||sha(body)!==source.sha256)throw Error("Source identity mismatch: "+source.study_relative_path);
}
const modules=new Map();
function requireVendor(name){
 if(modules.has(name))return modules.get(name);
 const source=sourceCatalog.vendor.find(x=>x.module===name);
 if(!source)throw Error("Unretained dependency: "+name);
 const body=fs.readFileSync(path.join(here,source.path));
 if(body.length!==source.bytes||sha(body)!==source.sha256)throw Error("Vendor identity mismatch: "+name);
 const module={exports:{}};
 vm.runInNewContext(body.toString("utf8"),{module,exports:module.exports,require:requireVendor},{filename:source.path,timeout:5000});
 modules.set(name,module.exports);return module.exports;
}
const d3={...requireVendor("d3-path"),...requireVendor("d3-array"),...requireVendor("d3-shape")};
const selected=parseCsv(fs.readFileSync(path.join(studyRoot,"wqp/derived/selected_chlorophyll.csv"),"utf8"));
const flow=parseCsv(fs.readFileSync(path.join(studyRoot,"wqp/study_flow_dates.csv"),"utf8"));
const points=prepareFigureData(selected,flow);
const identities=sourceCatalog.inputs.map(({path,sha256,bytes})=>({path,sha256,bytes}));
const rendered=buildScientificFigures(points,flow,d3,identities);
const spec=buildFigureSpecification(points,flow,rendered.distribution_statistics,identities);
const asciiJson=value=>JSON.stringify(value,null,2).replace(/[\u007f-\uffff]/g,c=>"\\u"+c.charCodeAt(0).toString(16).padStart(4,"0"))+"\n";
const outputs={...rendered.svg,"plot-data.csv":writeCsv(points),"distribution-statistics.csv":writeCsv(rendered.distribution_statistics),"figure-spec.json":asciiJson(spec)};
fs.mkdirSync(output,{recursive:true});
for(const [filename,text]of Object.entries(outputs)){
 const body=Buffer.from(text,"utf8"),expected=sourceCatalog.outputs.find(x=>x.path===filename);
 if(!expected||body.length!==expected.bytes||sha(body)!==expected.sha256)throw Error("Source-native rebuild differs: "+filename);
 fs.writeFileSync(path.join(output,filename),body);
}
process.stdout.write(JSON.stringify({figures:Object.keys(rendered.svg),chlorophyll_points:points.length,flow_dates:flow.length,output,files:Object.entries(outputs).map(([filename,text])=>({path:filename,bytes:Buffer.byteLength(text),sha256:sha(text)}))},null,2)+"\n");
