#!/usr/bin/env node
/* SPDX-License-Identifier: MIT */
"use strict";
const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto");
const C=require("./workspace.cjs"),Compose=require("./compose.cjs"),Example=require("./example.cjs");
const names=["../cmdb_qa.mjs","../cmdb_qa.test.mjs","vendor/connected_sha256.cjs","vendor/zip-original.js","original-adapter.cjs","workspace.cjs","index.template.html","style.css","app.js","compose.cjs","example.cjs","build.cjs","cli.cjs","native-receiving.cjs","browser-receiving.cjs","OPERATOR.md","README.md","SOURCE_PROVENANCE.md","WORKSHARE.md"];
const sha=data=>crypto.createHash("sha256").update(data).digest("hex");
function build(out){
 const files=Object.fromEntries(names.map(name=>[name,fs.readFileSync(path.resolve(__dirname,name),"utf8")]));
 if(sha(files["../cmdb_qa.mjs"])!=="f4eb477a76903ed8aaf72f0fb05e70db4b66729fe6914c925183726edd6164f3")throw Error("The original comparator differs.");
 const operated=Example.operate(),packet=C.pack(operated.workspace);
 const artifacts={"Open_CMDB_Workspace.html":Compose.build(files),"Worked_Hardware_Acceptance.html":Compose.build(files,packet),"OPERATOR.md":files["OPERATOR.md"],
  "worked-example/workspace.json":JSON.stringify(packet,null,2)+"\n","worked-example/receiving.json":JSON.stringify(operated.receiving,null,2)+"\n",
  "worked-example/acceptance-report.html":C.report(operated.workspace,operated.finalRun),"worked-example/exceptions.csv":C.exceptionsCsv(operated.workspace,operated.finalRun),
  "worked-example/audit.json":JSON.stringify(operated.workspace.runs.at(-1).audit,null,2)+"\n"};
 for(const [name,text]of Object.entries(operated.files))artifacts["worked-example/"+name]=text;
 for(const [name,text]of Object.entries(files))artifacts[name.startsWith("../")?"cmdb-qa/"+name.slice(3):"cmdb-qa/acceptance-workspace/"+name]=text;
 artifacts["RELEASE.json"]=JSON.stringify({schema:"cmdb-acceptance-release/1",originalComparatorSha256:sha(files["../cmdb_qa.mjs"]),workedCase:operated.receiving,
  files:Object.entries(artifacts).map(([name,text])=>({path:name,bytes:Buffer.byteLength(text),sha256:sha(text)}))},null,2)+"\n";
 fs.mkdirSync(out,{recursive:true});
 for(const [name,text]of Object.entries(artifacts)){const dest=path.join(out,name);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,text,{mode:0o600});}
 return {directory:path.resolve(out),files:Object.keys(artifacts).length,releaseSha256:sha(artifacts["RELEASE.json"]),workedCase:operated.receiving};
}
if(require.main===module){try{const args=process.argv.slice(2);if(args.length!==2||args[0]!=="--out")throw Error("Usage: node build.cjs --out DIRECTORY");console.log(JSON.stringify(build(path.resolve(args[1])),null,2));}catch(error){console.error(error.message);process.exitCode=1;}}
module.exports={build,names};
