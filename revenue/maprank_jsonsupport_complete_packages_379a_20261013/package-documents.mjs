import Core from './runtime/tools/revenue_owner_console_20261010/lead_fulfillment_core.cjs';
import Sha from './runtime/host/connected_sha256.cjs';
import Zip from './runtime/host/connected_zip.cjs';
import Gzip from './runtime/host/connected_gzip.cjs';
import {renderCustomerDocumentViewer} from './vendor/customer-document-viewer.mjs';
export const DEFINITIONS={
  "maprank": {
    "customer": "MapRank",
    "slug": "MapRank",
    "pack_id": "MAPRANK-LOCAL-SEO-AGENCY-PACK-20261013",
    "working_record_sha256": "86affa1e8b35f1418fb09c58a474c098d4864dfb7ce8714d05d192bb4899d434",
    "packages": [
      "MAPRANK-LOCAL-SEO-AGENCY-PACK-20261013:sample-files-01",
      "MAPRANK-LOCAL-SEO-AGENCY-PACK-20261013:paid-files-01"
    ]
  },
  "jsonsupport": {
    "customer": "JSON Support",
    "slug": "JSON-Support",
    "pack_id": "JSONSUPPORT-AUTOMATION-PARTNER-PACK-20261013",
    "working_record_sha256": "adc51bec88413309343b44be311d98fbedccf0109d117bdf5dadfdf0823a242b",
    "packages": [
      "JSONSUPPORT-AUTOMATION-PARTNER-PACK-20261013:sample-files-01",
      "JSONSUPPORT-AUTOMATION-PARTNER-PACK-20261013:paid-files-01"
    ]
  }
};
export function receiveOriginalPackages(key,working) {
 const selected=DEFINITIONS[key];if(!selected)throw Error('Select maprank or jsonsupport.');
 if(working?.pack?.id!==selected.pack_id||working.sha256!==selected.working_record_sha256)throw Error('Select the complete original customer edition.');
 const at='2026-10-13T13:42:00.000Z',packId=selected.pack_id;
 const received=Core.applyLeadFulfillment({},{operation_id:packId+':complete-original-documents-01',kind:'working-record-receive',expected_root_sha256:Core.hash(Core.validateRoot({})),input:{bundle:working}},at);
 if(JSON.stringify(Core.leadFulfillmentExport(received.ledger,{packId,format:'working-record'}).value)!==JSON.stringify(working))throw Error('The whole original record differs on receiving.');
 const packages=[];
 for(const [index,id]of selected.packages.entries()){
  const selection=Core.leadCustomerPackageSelection(received.ledger,id,packId);
  const entries=selection.files.map(f=>{const d=f.document,data=Zip.fromBase64(d.content_base64);if(data.length!==d.bytes||Sha.sha256Bytes(data).sha256!==d.sha256)throw Error('Original file differs: '+d.name);return{name:d.name,data,mode:0o644};});
  const archive=Zip.packStoredZip(entries,{timestamp:at}),members=Zip.readStoredZip(archive);
  if(members.length!==entries.length)throw Error('The selected member count differs.');
  for(const m of members){const d=selection.files.find(f=>f.document.name===m.name)?.document;if(!d||m.bytes!==d.bytes||Sha.sha256Bytes(m.data).sha256!==d.sha256)throw Error('Reopened original file differs: '+m.name);}
  packages.push({name:selected.slug+'-'+(index===0?'Free':'Paid')+'.zip',title:selection.packet.title,quantity:selection.edition.leads.length,package_id:id,bytes:archive.length,sha256:Sha.sha256Bytes(archive).sha256,archive,files:selection.files.map(f=>({name:f.document.name,bytes:f.document.bytes,sha256:f.document.sha256}))});
 }
 return packages;
}
export function buildCustomerDocuments(key,working){
 const selected=DEFINITIONS[key],packages=receiveOriginalPackages(key,working),outputs={};
 const payload={customer:selected.customer,packages:packages.map(({archive,...p})=>({...p,payload:Zip.base64(archive)}))};
 const raw=JSON.stringify(payload),input=Zip.utf8(raw),deflated=Gzip.deflateRawBytes(input,{huffman:'auto'}).data;
 const gzip=new Uint8Array(deflated.length+18);gzip.set([31,139,8,0,0,0,0,0,0,255]);gzip.set(deflated,10);
 const v=new DataView(gzip.buffer);v.setUint32(gzip.length-8,Zip.crc32(input),true);v.setUint32(gzip.length-4,input.length,true);
 if(Zip.utf8Text(Gzip.gunzipBytes(gzip,{expected_bytes:input.length,max_output_bytes:input.length}).data)!==raw)throw Error('The complete viewer payload differs on reopening.');
 const envelope={payload:Zip.base64(gzip),bytes:input.length,sha256:Sha.sha256Bytes(input).sha256};
 const html=renderCustomerDocumentViewer({customer:selected.customer+' — complete customer files',rootId:key+'-complete-customer-packages',envelope});
 const viewer={name:selected.slug+'-complete-packages.html',...Sha.sha256Utf8(html)};
 if(viewer.bytes>256*1024)throw Error('The whole customer viewer exceeds the Page boundary.');
 outputs[viewer.name]=html;for(const p of packages)outputs[p.name]=p.archive;
 const receipt={schema:'commons.two-original-customer-documents.v1',customer:selected.customer,pack_id:selected.pack_id,working_record_sha256:working.sha256,complete_original_record_received_equal:true,viewer,packages:packages.map(({archive,...p})=>p),all_original_members_reopened_equal:true};
 outputs[selected.slug+'-complete-package-receipt.json']=JSON.stringify(receipt,null,2)+'\n';
 return {outputs,receipt};
}
