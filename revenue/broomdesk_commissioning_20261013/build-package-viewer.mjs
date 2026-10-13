#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import Core from './tools/revenue_owner_console_20261010/lead_fulfillment_core.cjs';
import Zip from './host/connected_zip.cjs';
import {renderBroomDeskCommissioningPackageViewer} from './package-viewer.mjs';
const here=path.dirname(fileURLToPath(import.meta.url)),hash=b=>createHash('sha256').update(b).digest('hex');
export function receiveOriginalPackages(record,input){
 if(input.schema!=='commons.broomdesk-commissioning-complete-package-viewer.v1'||record.sha256!==input.working_record_sha256||!['sample','paid'].includes(input.kind))throw Error('The selected complete pilot programme differs.');
 const received=Core.applyLeadFulfillment({},{operation_id:record.pack.id+':pilot-view-receive:'+input.kind,kind:'working-record-receive',input:{bundle:record},expected_root_sha256:Core.hash(Core.validateRoot({}))}).ledger;
 if(Core.hash(Core.leadFulfillmentExport(received,{packId:record.pack.id,format:'working-record'}).value)!==Core.hash(record))throw Error('The complete working record did not reopen.');
 if(input.writer.timestamp!=='2026-10-13T16:00:00.000Z')throw Error('Original archive timestamp differs.');
 const decoded=gunzipSync(Buffer.from(input.envelope.payload,'base64'));if(decoded.length!==input.envelope.bytes||hash(decoded)!==input.envelope.sha256)throw Error('Full archive envelope differs.');
 const payload=JSON.parse(decoded);if(payload.packages.length!==1)throw Error('Select one complete edition panel.');
 return payload.packages.map(p=>{
  const selection=Core.leadCustomerPackageSelection(received,p.package_id,record.pack.id),edition=selection.edition;
  if(edition.kind!==input.kind||p.edition_id!==edition.id||p.quantity!==edition.leads.length||p.title!==selection.packet.title||p.name!=='BroomDesk-'+input.kind+'-complete-commissioning.zip'||p.files.length!==9)throw Error('Original customer selection differs.');
  const entries=selection.files.map(f=>{const d=f.document,data=Zip.fromBase64(d.content_base64),declared=p.files.find(x=>x.name===d.name);if(!declared||data.length!==d.bytes||hash(data)!==d.sha256||declared.bytes!==d.bytes||declared.sha256!==d.sha256)throw Error('Selected member differs.');return{name:d.name,data,mode:0o644};});
  const archive=Buffer.from(Zip.packStoredZip(entries,{timestamp:input.writer.timestamp}));if(archive.length!==p.bytes||hash(archive)!==p.sha256||!archive.equals(Buffer.from(p.payload,'base64')))throw Error('Complete archive differs.');
  const members=Zip.readStoredZip(archive);if(members.length!==entries.length)throw Error('Missing complete member.');
  for(const m of members){const f=p.files.find(x=>x.name===m.name);if(!f||m.bytes!==f.bytes||hash(m.data)!==f.sha256)throw Error('Reopened member differs.');}
  return {...p,payload:undefined,archive};
 });
}
export function buildPackageViews(delivery,out){
 const dest=path.resolve(out);if(fs.existsSync(dest))throw Error('Choose a new viewer output directory.');const built=JSON.parse(fs.readFileSync(path.join(delivery,'build-result.json'),'utf8')),record=JSON.parse(fs.readFileSync(path.join(delivery,'working-record.json'),'utf8'));
 if(!built.validation?.full_record_reopen_equal)throw Error('Build the whole original programme first.');
 const outputs=[],results=[];
 for(const kind of ['sample','paid']){
  const input=JSON.parse(fs.readFileSync(path.join(here,kind+'-package-viewer-input.json'),'utf8')),packages=receiveOriginalPackages(record,input),html=renderBroomDeskCommissioningPackageViewer(input),fragment=renderBroomDeskCommissioningPackageViewer(input,{fragment:true});
  const name='BroomDesk-'+kind+'-complete-commissioning-package.html';if(html!==fs.readFileSync(path.join(here,name),'utf8'))throw Error('Generated full viewer differs.');
  for(const p of packages){const actual=fs.readFileSync(path.join(delivery,p.name));if(!actual.equals(p.archive))throw Error('Built original archive differs.');outputs.push([p.name,p.archive]);}
  outputs.push([name,html],['BroomDesk-'+kind+'-review-fragment.html',fragment]);results.push({kind,html:{bytes:Buffer.byteLength(html),sha256:hash(html)},fragment:{bytes:Buffer.byteLength(fragment),sha256:hash(fragment)},packages:packages.map(({archive,...p})=>p)});
 }
 fs.mkdirSync(dest,{mode:0o700});for(const[name,body]of outputs)fs.writeFileSync(path.join(dest,name),body,{flag:'wx',mode:0o600});
 const result={schema:'broomdesk.commissioning-package-views.v1',working_record_sha256:record.sha256,views:results};fs.writeFileSync(path.join(dest,'package-view-result.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});return result;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){try{if(process.argv.length!==4)throw Error('Usage: node build-package-viewer.mjs BUILT_DELIVERY NEW_VIEW_DIRECTORY');console.log(JSON.stringify(buildPackageViews(path.resolve(process.argv[2]),process.argv[3])));}catch(e){console.error(e.stack);process.exitCode=1;}}
