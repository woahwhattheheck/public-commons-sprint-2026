'use strict';
function base64(text){
 const bytes=[];for(const char of text){const n=char.codePointAt(0);if(n<128)bytes.push(n);else if(n<2048)bytes.push(192|(n>>6),128|(n&63));else if(n<65536)bytes.push(224|(n>>12),128|((n>>6)&63),128|(n&63));else bytes.push(240|(n>>18),128|((n>>12)&63),128|((n>>6)&63),128|(n&63));}
 const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';let out='';
 for(let i=0;i<bytes.length;i+=3){const a=bytes[i],b=bytes[i+1],c=bytes[i+2],w=(a<<16)|((b||0)<<8)|(c||0);out+=alphabet[w>>>18]+alphabet[(w>>>12)&63]+(b===undefined?'=':alphabet[(w>>>6)&63])+(c===undefined?'=':alphabet[w&63]);}return out;
}

function composeCustomerPackages(core,sha,original,customerFiles,preparedAt){
  const packId=original.pack.id;
  if(packId!=='UNLOST-EUROPE-SHOPIFY-LEADPACK-20261013')throw Error('Use the complete original Unlost record');
  let ledger={};const requests=[],results=[];
  const act=(kind,input)=>{const request={operation_id:packId+':customer-packages-v1:'+requests.length+':'+kind,kind,input,expected_root_sha256:core.hash(core.validateRoot(ledger))};const result=core.applyLeadFulfillment(ledger,request,preparedAt);ledger=result.ledger;requests.push(request);results.push({operation_id:result.operation_id,kind,changed:result.changed,...(result.file_revisions?{file_revisions:result.file_revisions}:{})});return result;};
  const preserve=working=>{for(const key of Object.keys(original).filter(key=>key!=='sha256'))if(JSON.stringify(working[key])!==JSON.stringify(original[key]))throw Error('Original record changed: '+key);};
  act('working-record-receive',{bundle:original});
  preserve(core.leadFulfillmentExport(ledger,{packId,format:'working-record'}).value);
  const instructions=customerFiles['customer/README.txt'];
  if(typeof instructions!=='string'||!instructions.trim())throw Error('Supply the complete customer instructions');
  const fileInputs=[],scopes={},packageIds={};
  function add(path,idSuffix,title,type,leadIds){
    const content=customerFiles[path];if(typeof content!=='string')throw Error('Missing full customer file '+path);
    const identity=sha.sha256Utf8(content),id=packId+':file:'+idSuffix;
    fileInputs.push({id,document:{name:path.slice('customer/'.length),title,description:title+' for the original European Shopify merchant edition.',type,lead_ids:leadIds,source_url:'',content_base64:base64(content),bytes:identity.bytes,sha256:identity.sha256}});return id;
  }
  const shared=add('customer/README.txt','instructions','Customer instructions','text/plain',[]);
  for(const kind of ['sample','paid']){
    const edition=original.editions.find(value=>value.id===packId+':'+kind+'-01'&&value.kind===kind);
    if(!edition||edition.leads.length!==(kind==='sample'?1:5))throw Error('Missing original '+kind+' merchant edition');
    const leadIds=edition.leads.map(value=>value.id);
    const actual=JSON.parse(customerFiles['customer/'+kind+'.json']);
    const expected=core.leadFulfillmentExport(ledger,{packId,editionId:edition.id,format:'json'}).value;
    // Original documents retain their brief title; the later engine gives a
    // newly rendered free export a generic title. All original data must match.
    expected.title=edition.brief.brief.title;
    if(JSON.stringify(actual)!==JSON.stringify(expected))throw Error('Customer JSON differs from the original '+kind+' edition');
    scopes[kind]={editionId:edition.id,ids:[shared]};
    for(const [ext,type]of Object.entries({html:'text/html',csv:'text/csv',json:'application/json'}))scopes[kind].ids.push(add('customer/'+kind+'.'+ext,kind+'-'+ext,(kind==='sample'?'Free merchant example':'Five merchant profiles')+' — '+ext.toUpperCase(),type,leadIds));
  }
  const saved=act('customer-files-save',{pack_id:packId,files:fileInputs});
  for(const kind of ['sample','paid']){
    packageIds[kind]=packId+':'+kind+'-customer-package-01';
    const selected=saved.file_revisions.filter(value=>scopes[kind].ids.includes(value.id));
    if(selected.length!==4)throw Error('Each original edition needs its complete four-file package');
    act('customer-package-prepare',{pack_id:packId,id:packageIds[kind],edition_id:scopes[kind].editionId,title:kind==='sample'?'Unlost — free merchant example':'Unlost — five merchant profiles',instructions,files:selected});
  }
  const working=core.leadFulfillmentExport(ledger,{packId,format:'working-record'}).value;preserve(working);
  const receive={operation_id:packId+':customer-packages-v1:independent-receive',kind:'working-record-receive',expected_root_sha256:core.hash(core.validateRoot({})),input:{bundle:working}};
  const received=core.applyLeadFulfillment({},receive,preparedAt);
  const reopened=core.leadFulfillmentExport(received.ledger,{packId,format:'working-record'}).value;
  if(JSON.stringify(reopened)!==JSON.stringify(working))throw Error('The complete customer record did not reopen exactly');
  const packages={};
  for(const kind of ['sample','paid']){
    const selection=core.leadCustomerPackageSelection(ledger,packageIds[kind],packId);
    if(JSON.stringify(selection)!==JSON.stringify(core.leadCustomerPackageSelection(received.ledger,packageIds[kind],packId)))throw Error('The complete '+kind+' package did not reopen exactly');
    packages[kind]=selection;
  }
  return{working,requests,results,packageIds,packages,receiving:{request:receive,received:received.received,equal:true},preserved_fields:Object.keys(original).filter(key=>key!=='sha256'),file_identities:fileInputs.map(value=>({id:value.id,name:value.document.name,bytes:value.document.bytes,sha256:value.document.sha256}))};
}
module.exports={composeCustomerPackages};
