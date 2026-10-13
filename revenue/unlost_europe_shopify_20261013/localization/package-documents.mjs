import Core from '../runtime/tools/revenue_owner_console_20261010/lead_fulfillment_core.cjs';
import Sha from '../runtime/host/connected_sha256.cjs';
import Zip from '../runtime/host/connected_zip.cjs';
import Gzip from '../runtime/host/connected_gzip.cjs';
import {renderCustomerDocumentViewer} from './customer-document-viewer.mjs';

export function buildPackageDocuments(working) {
 const packId=working?.pack?.id;
 if(packId!=='UNLOST-EUROPE-SHOPIFY-LEADPACK-20261013')throw Error('Use the complete original Unlost working record');
 const at='2026-10-13T12:00:00.000Z';
 const received=Core.applyLeadFulfillment({},{
  operation_id:packId+':complete-document-receive-01',kind:'working-record-receive',
  expected_root_sha256:Core.hash(Core.validateRoot({})),input:{bundle:working}
 },at);
 if(JSON.stringify(Core.leadFulfillmentExport(received.ledger,{packId,format:'working-record'}).value)!==JSON.stringify(working))throw Error('The complete original customer record changed on receiving');
 const outputs={},archives=[],panels=[],records=[];
 for(const kind of ['sample','paid']) {
  const selected=Core.leadCustomerPackageSelection(received.ledger,packId+':'+kind+'-localization-package-02',packId);
  const entries=selected.files.map(file=>{
   const d=file.document,data=Zip.fromBase64(d.content_base64);
   if(data.length!==d.bytes||Sha.sha256Bytes(data).sha256!==d.sha256)throw Error('Original customer member differs: '+d.name);
   return{name:d.name,data,mode:0o644};
  });
  const data=Zip.packStoredZip(entries,{timestamp:at}),reopened=Zip.readStoredZip(data);
  if(reopened.length!==selected.files.length)throw Error('The complete original member selection changed');
  for(const member of reopened) {
   const original=selected.files.find(f=>f.document.name===member.name)?.document;
   if(!original||member.bytes!==original.bytes||Sha.sha256Bytes(member.data).sha256!==original.sha256)throw Error('Reopened original member differs: '+member.name);
  }
  const archive={name:'Unlost-localization-'+kind+'.zip',title:selected.packet.title,quantity:selected.edition.leads.length,
   bytes:data.length,sha256:Sha.sha256Bytes(data).sha256,payload:Zip.base64(data),
   files:selected.files.map(f=>({name:f.document.name,bytes:f.document.bytes,sha256:f.document.sha256}))};
  const raw=JSON.stringify({customer:'Unlost',packages:[archive]}),input=Zip.utf8(raw);
  const deflated=Gzip.deflateRawBytes(input,{huffman:'auto'}).data,gzip=new Uint8Array(deflated.length+18);
  gzip.set([31,139,8,0,0,0,0,0,0,255]);gzip.set(deflated,10);
  const trailer=new DataView(gzip.buffer);trailer.setUint32(gzip.length-8,Zip.crc32(input),true);trailer.setUint32(gzip.length-4,input.length,true);
  if(Zip.utf8Text(Gzip.gunzipBytes(gzip,{expected_bytes:input.length,max_output_bytes:input.length}).data)!==raw)throw Error('The complete document envelope did not reopen');
  const envelope={payload:Zip.base64(gzip),bytes:input.length,sha256:Sha.sha256Bytes(input).sha256};
  const html=renderCustomerDocumentViewer({customer:archive.title,rootId:'unlost-'+kind+'-complete-customer-packages',envelope});
  const identity=Sha.sha256Utf8(html);if(identity.bytes>256*1024)throw Error('Keep each complete edition within the existing Page limit');
  const panelName='Unlost-complete-'+kind+'-documents.html';
  outputs[archive.name]=data;outputs[panelName]=html;
  archives.push({edition:kind,name:archive.name,package_id:selected.packet.id,bytes:data.length,sha256:archive.sha256,members:reopened.length,all_member_bytes_equal:true});
  panels.push({edition:kind,name:panelName,...identity});
  records.push({edition:kind,packet:selected.packet,files:archive.files});
 }
 const receipt={schema:'unlost.complete-customer-documents.v1',prepared_at:at,pack_id:packId,working_record_sha256:working.sha256,
  complete_record_received_equal:true,archives,panels,selections:records,
  source:{zip:'public-commons-sprint-2026@0546dccef76d47fac69abb17e0ddad213eaf5e23:host/connected_zip.cjs',
   gzip:'public-commons-sprint-2026@0546dccef76d47fac69abb17e0ddad213eaf5e23:host/connected_gzip.cjs',
   viewer:'commons@0bde290df8daab241a024fa42b46bb90ebbc1c9b:tools/revenue_owner_console_20261010/lead_pack_sources/seven_original_customer_packages_6a62_20261013/customer-package-panel.mjs'},
  interactive_workspace:'Use each original direct app.html for the editable workspace. The complete-document viewer previews included files with scripts disabled and downloads their exact original bytes.'};
 outputs['complete-document-receipt.json']=JSON.stringify(receipt,null,2)+'\n';
 return{outputs,receipt};
}
