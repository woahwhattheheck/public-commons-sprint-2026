#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const {packStoredZip}=require('./host/connected_zip.cjs');
function zip(members){return Buffer.from(packStoredZip(members.map(m=>({name:m.name,data:new Uint8Array(m.bytes),mode:0o644})),{timestamp:'2026-10-13T00:00:00Z'}));}
function main(){
 const args=process.argv.slice(2);if(args.length!==1)throw Error('Usage: node build.cjs NEW_OUTPUT_DIRECTORY');
 const out=path.resolve(args[0]);if(fs.existsSync(out))throw Error('Choose a new output directory; previous deliveries are preserved.');
 const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'source-manifest.json'),'utf8'));
 for(const f of manifest.files){if(path.isAbsolute(f.path)||f.path.split('/').includes('..'))throw Error('Invalid source path.');const b=fs.readFileSync(path.join(__dirname,f.path));if(b.length!==f.bytes||hash(b)!==f.sha256)throw Error('Complete source differs: '+f.path);}
 const core=require('./tools/revenue_owner_console_20261010/lead_fulfillment_core.cjs');
 const sha=require('./host/connected_sha256.cjs');
 const input=JSON.parse(fs.readFileSync(path.join(__dirname,'research-input.json'),'utf8'));
 const operated=require('./compose.cjs').compose(core,sha,input);
 const expected=JSON.parse(fs.readFileSync(path.join(__dirname,'working-record.json'),'utf8'));
 if(core.hash(expected)!==core.hash(operated.working_record))throw Error('Whole original working record differs from the operated source.');
 const staging=fs.mkdtempSync(path.join(path.dirname(out),'.billedok-delivery-'));
 const write=(name,body)=>{const file=path.join(staging,name);fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});fs.writeFileSync(file,body,{flag:'wx',mode:0o600});};
 const identities=[];
 for(const item of operated.customer_files){const bytes=Buffer.from(item.content,'utf8');if(bytes.length!==item.bytes||hash(bytes)!==item.sha256)throw Error('Customer file differs.');write(item.path,bytes);}
 for(const item of operated.packages){
  const kind=item.selection.edition.kind==='sample'?'sample':'paid';
  const seen=new Set(),members=item.selection.files.map(f=>{const d=f.document;if(path.basename(d.name)!==d.name||seen.has(d.name))throw Error('Customer archive member name differs.');seen.add(d.name);const bytes=Buffer.from(d.content_base64,'base64');if(bytes.length!==d.bytes||hash(bytes)!==d.sha256)throw Error('Customer archive member differs.');return {name:d.name,bytes};});
  const archive=zip(members),name='BilledOK-'+kind+'-profiles.zip';write(name,archive);
  identities.push({name,bytes:archive.length,sha256:hash(archive),files:members.map(m=>({name:m.name,bytes:m.bytes.length,sha256:hash(m.bytes)}))});
 }
 write('working-record.json',JSON.stringify(operated.working_record,null,2)+'\n');
 write('ledger.json',JSON.stringify(operated.ledger,null,2)+'\n');
 write('fulfillment-operations.json',JSON.stringify(operated.operations,null,2)+'\n');
 write('build-result.json',JSON.stringify({validation:operated.validation,packages:identities},null,2)+'\n');
 fs.mkdirSync(out,{mode:0o700}); // Exclusive claim of the final directory before moving owned members.
 for(const name of fs.readdirSync(staging))fs.renameSync(path.join(staging,name),path.join(out,name));
 fs.rmdirSync(staging);
 process.stdout.write(JSON.stringify({output:out,...operated.validation,packages:identities.map(({files,...p})=>p)})+'\n');
}
if(require.main===module){try{main();}catch(error){process.stderr.write(error.stack+'\n');process.exitCode=1;}}
module.exports={zip};
