/* SPDX-License-Identifier: MIT */
import {createRequire} from "node:module";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
import {compactInlinePayload} from "../../../host/connected_inline_payload.mjs";
const require=createRequire(import.meta.url);
const Compose=require("./acceptance-workspace/compose.cjs");
/** Keep the complete original application, source and working record in one Page-sized view. */
export function buildReviewPage(files,working,{gzipSource,zipSource}={}){
 const original=Compose.build(files,working);
 const anchor="globalThis.CmdbHash=";
 if(original.split(anchor).length<2)throw Error("Original application bootstrap is missing.");
 const prefix="const CmdbPageZip=(()=>{const module={exports:{}};const exports=module.exports;\n"+zipSource+"\nreturn module.exports;})();\n";
 const script=original.indexOf("<script>");if(script<0)throw Error("Original application script is missing.");
 const prepared=original.slice(0,script+8)+prefix.replace(/<\/script/gi,"<\\/script")+original.slice(script+8);
 const compact=compactInlinePayload(prepared,{dataId:"source-bundle",zipGlobal:"CmdbPageZip",bootstrapBefore:anchor,codecGlobal:"CmdbPageInflate",gzipSource,maxBytes:33554432});
 const style=compact.match(/<style>([\s\S]*?)<\/style>/),body=compact.match(/<body>([\s\S]*?)<\/body>/);
 if(!style||!body)throw Error("Original application body or styles are missing.");
 return "<style>"+style[1]+"</style>\n"+body[1];
}
export function buildReviewPages(output){
 const here=path.dirname(fileURLToPath(import.meta.url)),source=path.join(here,"acceptance-workspace");
 const {names}=require("./acceptance-workspace/build.cjs"),Example=require("./acceptance-workspace/example.cjs"),C=require("./acceptance-workspace/workspace.cjs");
 const files=Object.fromEntries(names.map(name=>[name,fs.readFileSync(path.resolve(source,name),"utf8")]));
 const helpers={gzipSource:fs.readFileSync(new URL("../../../host/connected_gzip.cjs",import.meta.url),"utf8"),zipSource:fs.readFileSync(new URL("../../../host/connected_zip.cjs",import.meta.url),"utf8")};
 const views={"cmdb-blank-review.html":buildReviewPage(files,null,helpers),"cmdb-worked-review.html":buildReviewPage(files,C.pack(Example.operate().workspace),helpers)};
 for(const [name,html]of Object.entries(views))if(Buffer.byteLength(html)>256*1024)throw Error("The complete review view exceeds the Page limit: "+name);
 fs.mkdirSync(output,{recursive:false,mode:0o700});
 for(const [name,html]of Object.entries(views))fs.writeFileSync(path.join(output,name),html,{mode:0o600});
 return {directory:path.resolve(output),files:Object.entries(views).map(([name,html])=>({name,bytes:Buffer.byteLength(html)}))};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 try{const args=process.argv.slice(2);if(args.length!==2||args[0]!=="--out")throw Error("Usage: node review-page.mjs --out NEW_DIRECTORY");console.log(JSON.stringify(buildReviewPages(args[1]),null,2));}catch(error){console.error(error.message);process.exitCode=1;}
}
