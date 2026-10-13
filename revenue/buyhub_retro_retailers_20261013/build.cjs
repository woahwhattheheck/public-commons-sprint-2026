#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),{prepare}=require('./prepare.cjs'),Zip=require('./runtime/host/connected_zip.cjs');
function build(out){
 const target=path.resolve(out),source=path.resolve(__dirname);
 if(target===source||target.startsWith(source+path.sep)||source.startsWith(target+path.sep))throw Error('Select a new output outside the original source directory.');
 const input=JSON.parse(fs.readFileSync(path.join(__dirname,'research.json'),'utf8')),at=JSON.parse(fs.readFileSync(path.join(__dirname,'preparation-input.json'),'utf8')).prepared_at;
 const result=prepare(input,at);
 const expected=JSON.parse(fs.readFileSync(path.join(__dirname,'working-record.json'),'utf8'));
 if(JSON.stringify(result.working)!==JSON.stringify(expected))throw Error('Rebuilt complete working record differs from its original.');
 fs.mkdirSync(target,{mode:0o700});
 for(const [name,body]of Object.entries(result.files)){const file=path.join(target,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,body,{flag:'wx'});}
 for(const [kind,archive]of Object.entries(result.archives))fs.writeFileSync(path.join(target,'BuyHub-'+kind+'-profiles.zip'),Zip.fromBase64(archive.payload_base64),{flag:'wx'});
 const receipt={pack_id:input.pack_id,working_sha256:result.working.sha256,companies:result.working.leads.length,editions:result.working.editions.length,archives:Object.fromEntries(Object.entries(result.archives).map(([kind,a])=>[kind,{bytes:a.bytes,sha256:a.sha256,members:a.members,reopened_equal:a.reopened_equal}]))};
 fs.writeFileSync(path.join(target,'build-receipt.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});return receipt;
}
if(require.main===module){try{if(process.argv.length!==3)throw Error('Usage: node build.cjs NEW_OUTPUT_DIRECTORY');console.log(JSON.stringify(build(process.argv[2])));}catch(e){console.error(e.stack);process.exitCode=1;}}
module.exports={build};
