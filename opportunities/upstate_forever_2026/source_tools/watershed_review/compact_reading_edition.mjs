#!/usr/bin/env node
/** Compact the complete native reading edition while retaining its questions and downloads. */
import fs from "node:fs/promises";
import {createHash} from "node:crypto";
import {embedPortableDownloads,tableNames} from "./portable.mjs";
const [input,output]=process.argv.slice(2);
if(!input||!output||process.argv.length!==4)throw Error("Usage: node compact_reading_edition.mjs NATIVE_READING_EDITION NEW_COMPACT_HTML");
const original=await fs.readFile(input);
const html=original.toString("utf8");
if(!Buffer.from(html,"utf8").equals(original))throw Error("Reading edition must be complete UTF-8");
const expected=[...tableNames,"Upper_Savannah_Review_Project.json"];
const files={};const downloads=[];
const stripped=html.replace(/href="data:(text\/csv|application\/json);charset=utf-8;base64,([A-Za-z0-9+/=]+)" download="([^"]+)"/g,(whole,mime,encoded,name)=>{
 if(!expected.includes(name)||Object.hasOwn(files,name))throw Error("Unexpected or repeated embedded download: "+name);
 const body=Buffer.from(encoded,"base64"),text=body.toString("utf8");
 if(body.toString("base64")!==encoded||!Buffer.from(text,"utf8").equals(body))throw Error("Invalid original download encoding: "+name);
 files[name]=text;downloads.push({path:name,bytes:body.length,sha256:createHash("sha256").update(body).digest("hex")});
 return 'href="'+name+'" download="'+name+'"';
});
if(downloads.length!==expected.length)throw Error("Expected all six original embedded downloads");
const project=JSON.parse(files["Upper_Savannah_Review_Project.json"]);
const analysis=JSON.parse(files["analysis.json"]);
if(project.schema!=="upstate.watershed-review/v1"||project.source_edition!==analysis.source_edition)throw Error("Project and analysis source editions differ");
const result=embedPortableDownloads(stripped,files);
await fs.writeFile(output,result,{encoding:"utf8",flag:"wx"});
process.stdout.write(JSON.stringify({output,bytes:Buffer.byteLength(result),sha256:createHash("sha256").update(result).digest("hex"),original_sha256:createHash("sha256").update(original).digest("hex"),downloads},null,2)+"\n");
