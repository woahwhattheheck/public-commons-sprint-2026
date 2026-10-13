#!/usr/bin/env node
"use strict";
const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto");
const core=require("./runtime/tools/revenue_owner_console_20261010/lead_fulfillment_core.cjs"),sha=require("./runtime/host/connected_sha256.cjs"),zip=require("./runtime/host/connected_zip.cjs");
const api=require("./desk/report-core.cjs"),view=require("./desk/report-view.cjs"),{operateReportDesk}=require("./desk/operate-example.cjs"),{composeReportDelivery}=require("./desk/compose.cjs"),{assembleReportDelivery}=require("./desk/assemble.cjs");
function build(output){
 const out=path.resolve(output),root=__dirname;if(fs.existsSync(out))throw Error("Choose a new complete output directory.");
 const read=p=>fs.readFileSync(path.join(root,p),"utf8"),manifest=JSON.parse(read("source-manifest.json"));
 const sourceFiles=manifest.files.map(f=>{const content=read(f.path),actual=sha.sha256Utf8(content);if(actual.bytes!==f.bytes||actual.sha256!==f.sha256)throw Error("Original source differs: "+f.path);return{...f,content};});
 const result=assembleReportDelivery({core,sha,zip,api,view,operate:operateReportDesk,compose:composeReportDelivery,original:JSON.parse(read("source/original-working-record.json")),seeds:JSON.parse(read("source/edition-seeds.json")),sourceFiles,at:"2026-10-13T14:45:00.000Z"});
 fs.mkdirSync(out,{mode:0o700});const write=(name,content)=>{const target=path.join(out,name);fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});fs.writeFileSync(target,content,{flag:"wx",mode:0o600});};
 for(const[name,content]of Object.entries(result.customerFiles))write("customer/"+name,content);
 write("working-record.json",JSON.stringify(result.working,null,2)+"\n");
 const archiveIdentities={};for(const[k,a]of Object.entries(result.archives)){const data=Buffer.from(a.data);write("JSON-Support-report-"+k+".zip",data);archiveIdentities[k]={bytes:data.length,sha256:crypto.createHash("sha256").update(data).digest("hex"),files:a.files};write("worked-examples/"+k+".json",JSON.stringify(result.examples[k],null,2)+"\n");}
 const receipt={schema:"jsonsupport.report-desk-delivery.v1",original_pack:result.working.pack.id,working_record_sha256:result.working.sha256,companies:result.working.leads.length,editions:result.working.editions.length,customer_files:result.working.customer_files.length,customer_packages:result.working.customer_packages.length,original_values_preserved:result.originalValuesPreserved,received_equal:result.receivedEqual,apps:result.apps,archives:archiveIdentities,package_ids:result.packageIds,worked_operations:Object.fromEntries(Object.entries(result.examples).map(([k,v])=>[k,v.events.length]))};
 write("delivery.json",JSON.stringify(receipt,null,2)+"\n");return{output:out,...receipt};
}
if(require.main===module){try{process.stdout.write(JSON.stringify(build(process.argv[2]||path.join(__dirname,"built")),null,2)+"\n");}catch(e){process.stderr.write(e.stack+"\n");process.exitCode=1;}}
module.exports={build};
