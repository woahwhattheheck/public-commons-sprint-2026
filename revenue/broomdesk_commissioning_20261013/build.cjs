#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {compose}=require('./compose.cjs'),{operate}=require('./receiving.cjs'),Pilot=require('./commissioning-core.cjs');
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
function build(out){
 const dest=path.resolve(out);if(fs.existsSync(dest))throw Error('Choose a new output directory.');
 const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'source-manifest.json'),'utf8')),files={};
 for(const f of manifest.files){if(path.isAbsolute(f.path)||f.path.split('/').includes('..'))throw Error('Invalid source path');const b=fs.readFileSync(path.join(__dirname,f.path));if(b.length!==f.bytes||digest(b)!==f.sha256)throw Error('Source identity differs: '+f.path);files[f.path]=b.toString('utf8');}
 const original=JSON.parse(files['original-working-record.json']),result=compose(original,files);
 const stage=dest+'.staging-'+crypto.randomUUID();fs.mkdirSync(stage,{mode:0o700});
 const write=(name,value)=>{const p=path.join(stage,name);fs.mkdirSync(path.dirname(p),{recursive:true,mode:0o700});fs.writeFileSync(p,value,{flag:'wx',mode:0o600});};
 try{
  write('working-record.json',JSON.stringify(result.working_record,null,2)+'\n');
  write('operations.json',JSON.stringify(result.operations,null,2)+'\n');
  for(const a of JSON.parse(files['original-archives.json']).archives)write('original-reviewed/'+a.name,Buffer.from(a.content_base64,'base64'));
  for(const f of result.customer_files)write(f.path,f.content);
  for(const a of result.archives)write(a.name,Buffer.from(a.data));
  const receipt={schema:'broomdesk.commissioning-build.v1',validation:result.validation,working_record_sha256:result.working_record.sha256,packages:result.archives.map(({data,...p})=>p)};
  write('build-result.json',JSON.stringify(receipt,null,2)+'\n');
  const receiving=operate(Pilot,JSON.parse(files['authored-receiving.json']));write('source-receiving.json',JSON.stringify(receiving,null,2)+'\n');
  if(fs.existsSync(dest))throw Error('Destination appeared during build; retain the complete staging directory.');
  fs.renameSync(stage,dest);return receipt;
 }catch(e){e.message+='; complete or partial staging is retained at '+stage;throw e;}
}
module.exports={build};
if(require.main===module){try{if(process.argv.length!==3)throw Error('Usage: node build.cjs NEW_DELIVERY_DIRECTORY');console.log(JSON.stringify(build(process.argv[2])));}catch(e){console.error(e.stack);process.exitCode=1;}}
