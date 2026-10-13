#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const {packStoredZip}=require('./host/connected_zip.cjs');
function zip(members){return Buffer.from(packStoredZip(members.map(m=>({name:m.name,data:new Uint8Array(m.bytes),mode:0o644})),{timestamp:'2026-10-13T00:00:00Z'}));}

function main(){
 const a=process.argv.slice(2);
 if(!((a.length===3&&a[0]==='--input')||(a.length===2&&a[0]==='--empty')))throw Error('Usage: node build.cjs --input COMPLETE_PRIVATE_INPUT.json NEW_OUTPUT_DIRECTORY | --empty NEW_OUTPUT_DIRECTORY');
 const out=path.resolve(a.at(-1));if(fs.existsSync(out))throw Error('Choose a new output directory; previous deliveries are preserved.');
 const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'source-manifest.json'),'utf8'));
 for(const f of manifest.files){if(path.isAbsolute(f.path)||f.path.split('/').some(p=>p==='..'||p===''))throw Error('Invalid source path.');const b=fs.readFileSync(path.join(__dirname,f.path));if(b.length!==f.bytes||hash(b)!==f.sha256)throw Error('Complete source differs: '+f.path);}
 const sha=require('./host/connected_sha256.cjs'),core=require('./tools/revenue_owner_console_20261010/lead_fulfillment_core.cjs');
 const commissioning=require('./commissioning-core.cjs').createEngine(s=>sha.sha256Utf8(s).sha256),render=require('./render.cjs').render;
 const assets={core_source:fs.readFileSync(path.join(__dirname,'commissioning-core.cjs'),'utf8'),sha_source:fs.readFileSync(path.join(__dirname,'host/connected_sha256.cjs'),'utf8'),app_source:fs.readFileSync(path.join(__dirname,'app.js'),'utf8'),styles:fs.readFileSync(path.join(__dirname,'styles.css'),'utf8')};
 const staging=fs.mkdtempSync(path.join(path.dirname(out),'.ventcrm-delivery-'));
 const write=(name,body)=>{const f=path.join(staging,name);fs.mkdirSync(path.dirname(f),{recursive:true,mode:0o700});fs.writeFileSync(f,body,{flag:'wx',mode:0o600});};
 let result,identities=[];
 if(a[0]==='--empty'){
  const seed={version:'ventcrm.commissioning-seed.v1',title:'VentCRM operator commissioning',operators:[],criteria:JSON.parse(fs.readFileSync(path.join(__dirname,'criteria.json'),'utf8'))};
  const guide_markdown=fs.readFileSync(path.join(__dirname,'START-HERE.md'),'utf8'),guide_html=fs.readFileSync(path.join(__dirname,'guide.html'),'utf8');
  const body=render({...assets,seed,guide_markdown,guide_html});write('commissioning.html',body);write('START-HERE.md',guide_markdown);
  result={empty_desk:true,bytes:Buffer.byteLength(body),sha256:hash(Buffer.from(body))};
 }else{
  const raw=fs.readFileSync(path.resolve(a[1]));if(raw.length>10000000)throw Error('Complete input exceeds the receiving limit.');
  const input=JSON.parse(raw.toString('utf8')),operated=require('./compose.cjs').compose(core,sha,commissioning,render,input,assets);
  write('complete-original-input.json',raw);
  for(const f of operated.customer_files){const b=Buffer.from(f.content,'utf8');if(b.length!==f.bytes||hash(b)!==f.sha256)throw Error('Customer bytes differ.');write(f.path,b);}
  for(const p of operated.packages){
   const seen=new Set(),members=p.selection.files.map(f=>{const d=f.document;if(path.basename(d.name)!==d.name||seen.has(d.name))throw Error('Duplicate or invalid customer member.');seen.add(d.name);const bytes=Buffer.from(d.content_base64,'base64');if(bytes.length!==d.bytes||hash(bytes)!==d.sha256)throw Error('Customer member differs.');return {name:d.name,bytes};});
   const archive=zip(members),name='VentCRM-'+p.selection.edition.kind+'-complete-programme.zip';write(name,archive);
   identities.push({name,bytes:archive.length,sha256:hash(archive),members:members.map(m=>({name:m.name,bytes:m.bytes.length,sha256:hash(m.bytes)}))});
  }
  for(const [name,value] of [['working-record.json',operated.working_record],['ledger.json',operated.ledger],['fulfillment-operations.json',operated.operations],['internal/operator-working.json',operated.internal_programme.working]])write(name,JSON.stringify(value,null,2)+'\n');
  write('internal/operator-commissioning.html',operated.internal_programme.html);
  result={validation:operated.validation,packages:identities};
 }
 write('build-result.json',JSON.stringify(result,null,2)+'\n');
 fs.mkdirSync(out,{mode:0o700});
 for(const name of fs.readdirSync(staging))fs.renameSync(path.join(staging,name),path.join(out,name));
 fs.rmdirSync(staging);process.stdout.write(JSON.stringify({output:out,...result})+'\n');
}
if(require.main===module){try{main();}catch(error){process.stderr.write(error.stack+'\n');process.exitCode=1;}}
module.exports={zip};
