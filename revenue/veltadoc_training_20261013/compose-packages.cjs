'use strict';
// Complete original Veltadoc selections, received through the pinned fulfillment core.
const core=require('./tools/revenue_owner_console_20261010/lead_fulfillment_core.cjs');
const Hash=require('./host/connected_sha256.cjs');
const Zip=require('./host/connected_zip.cjs');
const Gzip=require('./host/connected_gzip.cjs');
const timestamp='2026-10-13T00:00:00Z';
function gzip(bytes){
 const deflated=Gzip.deflateRawBytes(bytes,{huffman:'auto'}).data;
 const result=new Uint8Array(10+deflated.length+8);
 result.set([31,139,8,0,0,0,0,0,0,255]);result.set(deflated,10);
 const view=new DataView(result.buffer);view.setUint32(result.length-8,Zip.crc32(bytes),true);view.setUint32(result.length-4,bytes.length>>>0,true);
 return result;
}
function compose(record){
 if(record.pack.id!=='VELTADOC-TRAINING-LEADS-379A-20261013')throw Error('Use the complete original Veltadoc case.');
 const received=core.applyLeadFulfillment({}, {operation_id:record.pack.id+':complete-view-receive',kind:'working-record-receive',input:{bundle:record},expected_root_sha256:core.hash(core.validateRoot({}))}).ledger;
 if(core.hash(core.leadFulfillmentExport(received,{packId:record.pack.id,format:'working-record'}).value)!==core.hash(record))throw Error('The original complete working record changed during receiving.');
 if(record.leads.length!==6||record.editions.length!==2||record.customer_packages.length!==2)throw Error('Retain all six original providers and both editions.');
 const packages=[],archives=[];
 for(const selection of record.customer_packages){
  const edition=record.editions.find(x=>x.id===selection.edition_id);
  if(!edition||edition.sha256!==selection.edition_sha256||record.withdrawals.some(x=>x.edition_id===edition.id))throw Error('The selected original edition is unavailable.');
  const kind=edition.kind==='sample'?'sample':edition.kind==='paid'?'paid':null;if(!kind)throw Error('Original edition kind differs.');
  const entries=[],files=[];
  for(const ref of selection.files){
   const file=record.customer_files.find(x=>x.id===ref.id);
   if(!file||file.revision!==ref.revision||file.sha256!==ref.sha256)throw Error('The original customer-file selection differs.');
   const d=file.document,bytes=Zip.fromBase64(d.content_base64),identity=Hash.sha256Bytes(bytes);
   if(identity.bytes!==d.bytes||identity.sha256!==d.sha256)throw Error('The original customer-file body differs: '+d.name);
   entries.push({name:d.name,data:bytes,mode:0o644});files.push({name:d.name,bytes:d.bytes,sha256:d.sha256});
  }
  const archive=Zip.packStoredZip(entries,{timestamp}),opened=Zip.readStoredZip(archive);
  if(opened.length!==entries.length)throw Error('The complete archive selection differs.');
  for(let i=0;i<entries.length;i++){
   const original=entries[i],member=opened.find(x=>x.name===original.name);
   if(!member||member.bytes!==original.data.length||Hash.sha256Bytes(member.data).sha256!==Hash.sha256Bytes(original.data).sha256)throw Error('The reopened original archive member differs.');
  }
  const item={package_id:selection.id,edition_id:edition.id,title:selection.title,name:'Veltadoc-'+kind+'-profiles.zip',quantity:kind==='sample'?1:5,...Hash.sha256Bytes(archive),files,payload:Zip.base64(archive)};
  packages.push(item);archives.push({name:item.name,data:archive,...Hash.sha256Bytes(archive)});
 }
 const decoded=Zip.utf8(JSON.stringify({packages})),compressed=gzip(decoded);
 const restored=Gzip.gunzipBytes(compressed,{expected_bytes:decoded.length,max_output_bytes:Math.max(1,decoded.length)}).data;
 if(Hash.sha256Bytes(restored).sha256!==Hash.sha256Bytes(decoded).sha256)throw Error('The complete document envelope did not reopen.');
 return {input:{schema:'commons.veltadoc-complete-package-viewer.v1',working_record_sha256:record.sha256,writer:{timestamp,component:'host/connected_zip.cjs',method:'STORE'},envelope:{encoding:'gzip+base64',...Hash.sha256Bytes(decoded),payload:Zip.base64(compressed)}},archives};
}
module.exports={compose};
