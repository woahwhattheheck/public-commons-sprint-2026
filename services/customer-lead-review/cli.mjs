#!/usr/bin/env node
/**
 * Build one portable review with the original package, archive and review modules.
 * Copyright 2026 TokenJunkieLabs. Licensed under Apache-2.0; see LICENSE.
 */
import {readFile,open,mkdtemp,writeFile,link,rm} from 'node:fs/promises';
import {dirname,resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {renderPortableLeadPackages} from './tools/revenue_owner_console_20261010/lead_customer_package_portable.mjs';
import archiveModule from './tools/revenue_owner_console_20261010/lead_customer_archive_core.cjs';
import reviewModule from './tools/revenue_owner_console_20261010/lead_customer_review.cjs';
import hashes from './host/connected_sha256.cjs';
import Zip from './host/connected_zip.cjs';

const archive=archiveModule.createLeadCustomerArchive(hashes);
const review=reviewModule.createLeadCustomerReview(hashes);
const MAX_INPUT=128*1024*1024,MAX_ARCHIVE=64*1024*1024;
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const need=(condition,message)=>{if(!condition)throw new Error(message);};
const string=(value,name,limit=1000)=>{
 need(typeof value==='string'&&value.length>0&&value.length<=limit&&!/[\u0000-\u001f\u007f]/.test(value),'Use complete '+name+'.');
 hashes.utf8ByteLength(value);return value;
};
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const integer=(value,min,max,name)=>{need(Number.isSafeInteger(value)&&value>=min&&value<=max,'Use a valid '+name+'.');return value;};

export function prepareSelectedPreview(input,packageId) {
 need(plain(input)&&input.version==='commons.customer-package-preview.v1','Open a complete commons.customer-package-preview.v1 JSON document.');
 string(input.customer,'customer name');string(input.customer_key,'customer key',160);
 need(Array.isArray(input.packages)&&input.packages.length>0,'Retain the original package inventory.');
 const matches=input.packages.filter(row=>plain(row)&&row.id===packageId);
 need(matches.length===1,'Select exactly one original package with --package ID.');
 const p=matches[0];string(p.title,'package title');
 need(typeof p.instructions==='string'&&p.instructions.length<=100000,'Keep the complete opening instructions.');
 string(p.prepared_at,'package preparation time',40);
 need(Number.isFinite(Date.parse(p.prepared_at)),'Keep the original package preparation time.');
 need(plain(p.archive)&&p.archive.type==='application/zip','Keep the complete original ZIP descriptor.');
 const name=string(p.archive.name,'ZIP filename',255);
 need(!/[\\/:]/.test(name)&&!['.','..'].includes(name)&&/\.zip$/i.test(name),'Use the original ZIP basename.');
 integer(p.archive.bytes,22,MAX_ARCHIVE,'archive byte count');
 need(digest(p.archive.sha256)&&typeof p.archive.base64==='string','Keep the original archive SHA-256 and base64 bytes.');
 const bytes=Zip.fromBase64(p.archive.base64),identity=hashes.sha256Bytes(bytes);
 need(identity.bytes===p.archive.bytes&&identity.sha256===p.archive.sha256,'The complete selected archive differs from its retained identity.');
 const members=archive.readLeadCustomerArchive(bytes,{maxBytes:MAX_ARCHIVE,maxFiles:1000});
 need(Array.isArray(p.files)&&p.files.length===members.length,'Keep every original member in the selected package inventory.');
 const names=new Set(),byName=new Map(members.map(row=>[row.name,row]));
 for(const item of p.files) {
  need(plain(item)&&typeof item.name==='string'&&!names.has(item.name),'Keep distinct original package members.');
  names.add(item.name);string(item.title,'member title');string(item.type,'member media type',200);
  const member=byName.get(item.name);
  need(member&&member.bytes===item.bytes&&member.sha256===item.sha256,'The retained member differs from the original ZIP: '+item.name);
 }
 const leadFile=byName.get('leads.json');
 need(leadFile&&leadFile.bytes<=512*1024,'A recipient review needs the original leads.json within 512 KiB.');
 let document;try{document=JSON.parse(Zip.utf8Text(leadFile.content));}catch{throw new Error('Open the complete original leads.json customer projection.');}
 const source=review.source({edition_id:p.edition_id,package_id:p.id,package_sha256:p.package_sha256,document});
 for(const field of ['quantity','delivery_type','currency','price_minor'])need(p[field]===source.document[field],'The package '+field+' differs from its original public lead selection.');
 const directory='selected/members',archivePath='selected/'+name;
 const mapped=p.files.map(item=>({...item,path:directory+'/'+item.name}));
 const prepared={
  version:'commons.complete-customer-directory.v1',
  customers:[{key:input.customer_key,name:input.customer,packages:[{
   package_id:p.id,package_sha256:p.package_sha256,edition_id:p.edition_id,title:p.title,
   delivery_type:p.delivery_type,quantity:p.quantity,currency:p.currency,price_minor:p.price_minor,
   prepared_at:p.prepared_at,instructions:p.instructions,directory,
   archive_path:archivePath,archive_bytes:p.archive.bytes,archive_sha256:p.archive.sha256,
   members:mapped.map(item=>({path:item.path,bytes:item.bytes,sha256:item.sha256})),
   files:mapped.map(item=>({path:item.path,title:item.title,type:item.type}))
  }]}],
  files:[{path:archivePath,content:bytes,...identity},...mapped.map(item=>({
   path:item.path,content:byName.get(item.name).content,bytes:item.bytes,sha256:item.sha256
  }))]
 };
 return {prepared,customerKey:input.customer_key,source,package:p};
}

function options(argv,allowed,required) {
 const result={};
 for(let i=0;i<argv.length;i++) {
  const key=argv[i];need(allowed.includes(key)&&result[key]===undefined,'Unknown or repeated option: '+key);
  need(i+1<argv.length&&!argv[i+1].startsWith('--'),'Supply a value after '+key+'.');
  result[key]=argv[++i];
 }
 for(const key of required)need(result[key]!==undefined,'Supply '+key+'.');
 return result;
}
async function readJSON(filename,maximum=MAX_INPUT) {
 const handle=await open(filename,'r');let data;
 try {
  const stat=await handle.stat();need(stat.isFile()&&stat.size<=maximum,'Open a complete regular JSON file within '+maximum+' bytes.');
  data=await handle.readFile();need(data.byteLength<=maximum,'The JSON file grew beyond the allowed input size.');
 }finally{await handle.close();}
 const text=new TextDecoder('utf-8',{fatal:true}).decode(data);
 try{return {value:JSON.parse(text.replace(/^\uFEFF/,'')),text};}catch{throw new Error('Open complete UTF-8 JSON: '+filename);}
}
async function writeNew(filename,content) {
 const output=resolve(filename),temporary=await mkdtemp(join(dirname(output),'.lead-review-'));
 try {
  const staged=join(temporary,'complete-output');await writeFile(staged,content,{encoding:'utf8',flag:'wx',mode:0o600});
  // link is atomic and never replaces an existing destination or symbolic link.
  await link(staged,output);
 }finally{await rm(temporary,{recursive:true,force:true});}
 return output;
}
async function sources() {
 const paths={
  zipSource:'host/connected_zip.cjs',gzipSource:'host/connected_gzip.cjs',
  hashSource:'host/connected_sha256.cjs',archiveSource:'tools/revenue_owner_console_20261010/lead_customer_archive_core.cjs'
 };
 return Object.fromEntries(await Promise.all(Object.entries(paths).map(async([key,path])=>[key,await readFile(new URL(path,import.meta.url),'utf8')])));
}
export function examplePreview() {
 const lead=label=>({
  organization:label,company_url:'https://example.invalid/',person:'Example programme team',
  business_need:'Illustrative workflow information for learning the recipient review controls.',
  source_url:'https://example.invalid/source',original_request_date:'',last_buyer_update:'',
  source_checked_at:'2026-01-01',signal_type:'Illustrative example',deadline:'',
  contact_route:'No real contact',contact_instructions:'Example only; do not contact.',
  geography:'Example region',published_budget:'',why_it_fits:'Demonstrates a complete public prospect projection.',
  opening_message:'Illustrative note only.',source_status:'Illustrative',status_note:'Fictional example, not a researched prospect.'
 });
 const packages=[['example-sample','sample',[lead('Example Studio A')],0],['example-paid','paid',[lead('Example Studio B'),lead('Example Studio C')],2000]].map(([id,type,leads,price])=>{
  const document={version:'dealscout.lead-pack.v1',title:'Illustrative '+type+' selection',customer:'Example recipient',
   prepared_at:'2026-01-01T00:00:00.000Z',delivery_type:type,criteria:'Demonstrate original review, draft and return files.',
   geography:'Example region',skills:[],quantity:leads.length,currency:'USD',price_minor:price,leads};
  const descriptor={id,edition_id:id+'-edition',document},package_sha256=hashes.sha256Utf8(JSON.stringify(descriptor)).sha256;
  const entries=[
   {name:'lead-pack.html',content:'<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Illustrative selection</title><style>body{font:16px system-ui;margin:24px;background:#fff;color:#202020;line-height:1.5}a{color:#222}</style><h1>Illustrative '+type+' selection</h1><p>Fictional input for learning the original review controls. '+leads.length+' example prospects.</p><p><a href="leads.json">Open complete structured selection</a></p></html>'},
   {name:'leads.json',content:JSON.stringify(document,null,2)+'\n'}
  ];
  const zip=archive.leadCustomerFileArchive(entries),identity=hashes.sha256Bytes(zip);
  return {id,package_sha256,edition_id:id+'-edition',title:document.title,delivery_type:type,quantity:leads.length,
   currency:'USD',price_minor:price,prepared_at:document.prepared_at,instructions:'Fictional example. Save a review edition, download its return and keep the editable HTML.',
   archive:{name:id+'.zip',type:'application/zip',...identity,base64:Zip.base64(zip)},
   files:entries.map(row=>({name:row.name,title:row.name,type:row.name.endsWith('.html')?'text/html':'application/json',...hashes.sha256Utf8(row.content)}))
  };
 });
 return {version:'commons.customer-package-preview.v1',customer:'Example recipient',customer_key:'example-recipient',packages};
}
const HELP='Customer lead review\n\n'+
 'node cli.mjs build --input PREVIEW.json --package ID --out REVIEW.html [--max-html-bytes N]\n'+
 'node cli.mjs inspect --input PREVIEW.json\n'+
 'node cli.mjs check-return --input RETURN.json [--preview PREVIEW.json --package ID]\n'+
 'node cli.mjs example --out example-preview.json\n\n'+
 'Build selects exactly one original package and validates its public projection and every ZIP member.\n'+
 'Default HTML limit is 262144 bytes. Existing output files are preserved; choose a new output filename.\n'+
 'The output directory must already exist. No installation, network or account credentials are required.\n';

export async function main(argv=process.argv.slice(2),emit=value=>process.stdout.write(value)) {
 if(!argv.length||argv.length===1&&['--help','help'].includes(argv[0])){emit(HELP);return;}
 const [command,...rest]=argv;
 if(command==='inspect') {
  const args=options(rest,['--input'],['--input']),{value}=await readJSON(args['--input']);
  need(plain(value)&&value.version==='commons.customer-package-preview.v1'&&Array.isArray(value.packages),'Open the original customer package preview.');
  emit(JSON.stringify({customer:value.customer,customer_key:value.customer_key,packages:value.packages.map(p=>({id:p.id,title:p.title,delivery_type:p.delivery_type,quantity:p.quantity,archive:p.archive?.name}))},null,2)+'\n');return;
 }
 if(command==='example') {
  const args=options(rest,['--out'],['--out']),content=JSON.stringify(examplePreview(),null,2)+'\n';
  const output=await writeNew(args['--out'],content);emit(JSON.stringify({output,...hashes.sha256Utf8(content),kind:'fictional-example'})+'\n');return;
 }
 if(command==='check-return') {
  const args=options(rest,['--input','--preview','--package'],['--input']),{text}=await readJSON(args['--input'],review.MAX_BYTES),returned=review.readReturn(text);
  need(Boolean(args['--preview'])===Boolean(args['--package']),'Supply --preview and --package together to bind an original selection.');
  if(args['--preview']) {
   const {value}=await readJSON(args['--preview']),selected=prepareSelectedPreview(value,args['--package']);
   need(selected.source.sha256===returned.source.sha256,'The returned review belongs to a different original public package selection.');
  }
  emit(JSON.stringify({version:returned.version,source_sha256:returned.source.sha256,edition_id:returned.source.edition_id,package_id:returned.source.package_id,
   review_id:returned.review.id,revision:returned.review.history.at(-1).revision,observations:returned.review.history.at(-1).items.length,...hashes.sha256Utf8(text)})+'\n');return;
 }
 need(command==='build','Choose build, inspect, check-return or example; use --help for arguments.');
 const args=options(rest,['--input','--package','--out','--max-html-bytes'],['--input','--package','--out']);
 const {value}=await readJSON(args['--input']),selected=prepareSelectedPreview(value,args['--package']);
 const maxHtmlBytes=args['--max-html-bytes']===undefined?262144:Number(args['--max-html-bytes']);
 integer(maxHtmlBytes,1024,32*1024*1024,'HTML byte limit');
 const rendered=renderPortableLeadPackages(selected.prepared,{customerKey:selected.customerKey,...await sources(),maxHtmlBytes});
 need(rendered.package_count===1&&rendered.packages[0].id===args['--package'],'The renderer returned a different selected package.');
 const output=await writeNew(args['--out'],rendered.content);
 emit(JSON.stringify({output,bytes:rendered.bytes,sha256:rendered.sha256,package_count:rendered.package_count,packages:rendered.packages,source_sha256:selected.source.sha256})+'\n');
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url) {
 main().catch(error=>{process.stderr.write('Customer review: '+error.message+'\n');process.exitCode=1;});
}
