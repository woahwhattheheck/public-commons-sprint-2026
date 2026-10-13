'use strict';
function base64(text){
 const bytes=[];for(const char of text){const n=char.codePointAt(0);if(n<128)bytes.push(n);else if(n<2048)bytes.push(192|(n>>6),128|(n&63));else if(n<65536)bytes.push(224|(n>>12),128|((n>>6)&63),128|(n&63));else bytes.push(240|(n>>18),128|((n>>12)&63),128|((n>>6)&63),128|(n&63));}
 const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';let out='';
 for(let i=0;i<bytes.length;i+=3){const a=bytes[i],b=bytes[i+1],c=bytes[i+2],w=(a<<16)|((b||0)<<8)|(c||0);out+=alphabet[w>>>18]+alphabet[(w>>>12)&63]+(b===undefined?'=':alphabet[(w>>>6)&63])+(c===undefined?'=':alphabet[w&63]);}return out;
}

function composeLocalizationDelivery(core,sha,original,customerFiles,at){
 const packId=original.pack.id,ledgerStart={};let ledger=ledgerStart;
 const requests=[],results=[];
 const act=(kind,input)=>{const request={operation_id:packId+':localization-recovery-v2:'+String(requests.length+1)+':'+kind,kind,input,expected_root_sha256:core.hash(core.validateRoot(ledger))};const result=core.applyLeadFulfillment(ledger,request,at);ledger=result.ledger;requests.push(request);results.push({operation_id:result.operation_id,kind,changed:result.changed,...(result.file_revisions?{file_revisions:result.file_revisions}:{})});return result;};
 act('working-record-receive',{bundle:original});
 const receivedOriginal=core.leadFulfillmentExport(ledger,{packId,format:'working-record'}).value;
 if(JSON.stringify(receivedOriginal)!==JSON.stringify(original))throw Error('Receive the exact complete original customer record');
 const inputs=[],scopes={},packageIds={};
 function add(path,suffix,type,ids){
  const content=customerFiles[path];if(typeof content!=='string')throw Error('Missing whole customer file '+path);
  const identity=sha.sha256Utf8(content),id=packId+':localization-recovery-file:'+suffix;
  inputs.push({id,document:{name:path.slice('customer/'.length),title:path.split('/').pop(),description:'Complete merchant-localization working application and original scoped source.',type,lead_ids:ids,source_url:'',content_base64:base64(content),bytes:identity.bytes,sha256:identity.sha256}});return id;
 }
 const shared=add('customer/localization-README.txt','guide','text/plain',[]);
 for(const kind of['sample','paid']){
  const originalPackage=original.customer_packages.find(x=>x.id===packId+':'+kind+'-customer-package-01');if(!originalPackage)throw Error('Original complete package is missing');
  const edition=original.editions.find(e=>e.id===originalPackage.edition_id),ids=edition.leads.map(x=>x.id);
  const previousPackage=original.customer_packages.find(x=>x.id===packId+':'+kind+'-localization-package-02');if(!previousPackage)throw Error('Retain the complete preceding editable package and its history');
  scopes[kind]={originalPackage,previousPackage,edition,ids:[shared]};
  for(const[name,type]of[['app.html','text/html'],['application-source.json','application/json'],['working.json','application/json']]){
   scopes[kind].ids.push(add('customer/localization-'+kind+'/'+name,kind+'-'+name.replace(/\./g,'-'),type,ids));
  }
 }
 const saved=act('customer-files-save',{pack_id:packId,files:inputs});
 for(const kind of['sample','paid']){
  const scope=scopes[kind],added=saved.file_revisions.filter(x=>scope.ids.includes(x.id));
  if(added.length!==4)throw Error('The whole application/working/source/guide selection is required');
  packageIds[kind]=packId+':'+kind+'-localization-package-03';
  act('customer-package-prepare',{pack_id:packId,id:packageIds[kind],edition_id:scope.edition.id,title:kind==='sample'?'Unlost — free merchant and localization desk':'Unlost — five merchants and localization desk',instructions:customerFiles['customer/localization-README.txt'],files:[...scope.originalPackage.files,...added],supersedes:scope.previousPackage.id,reason:'Adds explicit unfinished-work recovery while retaining the complete preceding application, customer documents and working history.'});
 }
 const working=core.leadFulfillmentExport(ledger,{packId,format:'working-record'}).value;
 for(const key of Object.keys(original).filter(k=>!['sha256','customer_files','customer_packages'].includes(k)))if(JSON.stringify(working[key])!==JSON.stringify(original[key]))throw Error('Original '+key+' changed');
 for(const key of['customer_files','customer_packages'])for(const row of original[key])if(JSON.stringify(working[key].find(x=>x.id===row.id))!==JSON.stringify(row))throw Error('Original customer selection changed: '+row.id);
 const receiveRequest={operation_id:packId+':localization-recovery-v2:independent-receive',kind:'working-record-receive',expected_root_sha256:core.hash(core.validateRoot({})),input:{bundle:working}};
 const received=core.applyLeadFulfillment({},receiveRequest,at);
 const reopened=core.leadFulfillmentExport(received.ledger,{packId,format:'working-record'}).value;
 if(JSON.stringify(reopened)!==JSON.stringify(working))throw Error('The complete customer successor did not reopen exactly');
 const packages={};for(const kind of['sample','paid']){packages[kind]=core.leadCustomerPackageSelection(ledger,packageIds[kind],packId);if(JSON.stringify(packages[kind])!==JSON.stringify(core.leadCustomerPackageSelection(received.ledger,packageIds[kind],packId)))throw Error('The complete customer package differs after receiving');}
 return{working,requests,results,packages,packageIds,receivedEqual:true,originalValuesPreserved:true,fileIdentities:inputs.map(x=>({id:x.id,name:x.document.name,bytes:x.document.bytes,sha256:x.document.sha256}))};
}
module.exports={composeLocalizationDelivery};
