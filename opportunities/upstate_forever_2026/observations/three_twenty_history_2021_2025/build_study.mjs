#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";
import {fileURLToPath} from "node:url";
import {assemble,ROOT} from "./package_study.mjs";
const args=process.argv.slice(2);
function option(name){const at=args.indexOf(name);if(at<0||!args[at+1]||args[at+1].startsWith("--"))throw Error("Required "+name);return args[at+1];}
if(args.includes("--help")){console.log("node build_study.mjs --app-root APPLICATION --output NEW_APPLICATION_ROOT\nRebuild the complete retained historical study with unchanged original source bytes.");process.exit(0);}
for(let i=0;i<args.length;i+=2)if(!["--app-root","--output"].includes(args[i])||!args[i+1])throw Error("Unknown or incomplete argument: "+args[i]);
const application=fs.realpathSync(option("--app-root")),output=path.resolve(option("--output"));
function contained(root,relative){if(path.isAbsolute(relative)||relative.includes("\\")||relative.split("/").some(x=>!x||x==="."||x===".."))throw Error("Unsafe relative path: "+relative);const full=path.resolve(root,relative);if(!full.startsWith(root+path.sep))throw Error("Path outside root: "+relative);return full;}
function read(relative){const candidate=contained(application,relative),real=fs.realpathSync(candidate);if(!real.startsWith(application+path.sep))throw Error("Source symlink outside application: "+relative);return fs.readFileSync(real,"utf8");}
const identity=content=>({bytes:Buffer.byteLength(content,"utf8"),sha256:createHash("sha256").update(content,"utf8").digest("hex")});
const inputManifest=JSON.parse(read(ROOT+"/input-manifest.json"));
if(inputManifest.schema!=="upstate.original-input-manifest/v1")throw Error("Input manifest schema");
const authoredManifest=JSON.parse(read(ROOT+"/authored-inputs.json"));
if(authoredManifest.schema!=="commons.authored-source-inputs/v1")throw Error("Authored manifest schema");
const inputs=inputManifest.files.map(item=>({...item,content:read(item.path)}));
const authored=Object.fromEntries(authoredManifest.files.map(item=>[item.path,read(item.path)]));
const result=assemble(inputs,authored,authoredManifest,identity);
fs.mkdirSync(output,{recursive:true});
const outputReal=fs.realpathSync(output);
for(const[relative,content]of Object.entries(result.files)){
  const full=contained(outputReal,relative);
  let parent=path.dirname(full);
  while(!fs.existsSync(parent))parent=path.dirname(parent);
  if(fs.realpathSync(parent)!==outputReal&&!fs.realpathSync(parent).startsWith(outputReal+path.sep))throw Error("Output symlink outside directory: "+relative);
  if(fs.existsSync(full)){const real=fs.realpathSync(full);if(!real.startsWith(outputReal+path.sep)||fs.readFileSync(real,"utf8")!==content)throw Error("Refusing differing existing output: "+relative);}
}
for(const[relative,content]of Object.entries(result.files)){const full=contained(outputReal,relative);fs.mkdirSync(path.dirname(full),{recursive:true});if(!fs.existsSync(full))fs.writeFileSync(full,content,{encoding:"utf8",flag:"wx"});}
console.log(JSON.stringify({schema:"upstate.historical-study-build/v1",output:outputReal,files:Object.keys(result.files).length,selected_results:result.study.measurements.length,activities:result.study.activities.length,contrasts:result.study.contrasts.length,report:path.join(outputReal,ROOT,"historical-station-comparison.html")},null,2));
