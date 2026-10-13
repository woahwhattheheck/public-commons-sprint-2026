'use strict';
const {sha256Utf8}=require('./host/connected_sha256.cjs');
function base64(text){
 const bytes=[];for(const char of text){const n=char.codePointAt(0);if(n<128)bytes.push(n);else if(n<2048)bytes.push(192|(n>>6),128|(n&63));else if(n<65536)bytes.push(224|(n>>12),128|((n>>6)&63),128|(n&63));else bytes.push(240|(n>>18),128|((n>>12)&63),128|((n>>6)&63),128|(n&63));}
 const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';let out='';
 for(let i=0;i<bytes.length;i+=3){const a=bytes[i],b=bytes[i+1],c=bytes[i+2],w=(a<<16)|((b||0)<<8)|(c||0);out+=alphabet[w>>>18]+alphabet[(w>>>12)&63]+(b===undefined?'=':alphabet[(w>>>6)&63])+(c===undefined?'=':alphabet[w&63]);}return out;
}
function prepare(core,renderers,input){
 let ledger={};const requests=[],results=[];
 const act=(kind,data)=>{const request={operation_id:input.id+':'+kind+':'+requests.length,kind,input:data,expected_root_sha256:core.hash(core.validateRoot(ledger))};const result=core.applyLeadFulfillment(ledger,request,input.prepared_at);ledger=result.ledger;requests.push(request);results.push({operation_id:result.operation_id,kind,changed:result.changed,...(result.file_revisions?{file_revisions:result.file_revisions}:{})});return result;};
 act('pack-save',{id:input.id,customer:input.customer,brief:input.brief,operator_note:input.operator_note});
 act('leads-save',{pack_id:input.id,leads:input.records.map(r=>({id:input.id+':'+r.slug,document:r}))});
 const selected={sample:input.records.filter(r=>r.role==='sample'),paid:input.records.filter(r=>r.role==='paid')};
 if(selected.sample.length!==1||selected.paid.length!==5)throw Error('Expected one sample and five paid agencies');
 const editionIds={},packageIds={},editions={},files={};const savedFiles=[];
 const instructions='Start with the HTML agency profiles and editable CSV. Each source link supports the published business contact or existing local SEO service. Suggested openings and product comparisons are research judgments. Confirm the agency’s current tool, an approved client, keyword, geography and reporting cadence. Keep existing reporting during a like-for-like comparison. Five additional profiles cost US$20 total, with one correction or replacement within seven days for an existing customer, duplicate, dead published contact or clear mismatch.';
 files['customer/README.txt']=instructions+'\n';
 const addFile=(name,content,kind,type,title,leadIds)=>{const identity=sha256Utf8(content);const id=input.id+':file:'+kind; savedFiles.push({id,document:{name,title,description:title+' with original public source links and the selected complete agency profiles.',type,lead_ids:leadIds,source_url:'',content_base64:base64(content),bytes:identity.bytes,sha256:identity.sha256}});return id;};
 const sharedFile=addFile('instructions/README.txt',files['customer/README.txt'],'instructions','text/plain','Customer instructions',[]);
 const fileIds={};
 for(const kind of ['sample','paid']){
  editionIds[kind]=input.id+':'+kind+'-01';const leadIds=selected[kind].map(r=>input.id+':'+r.slug);
  act('edition-prepare',{id:editionIds[kind],pack_id:input.id,kind,lead_ids:leadIds});
  const edition=core.leadFulfillmentExport(ledger,{packId:input.id,editionId:editionIds[kind],format:'json'}).value;editions[kind]=edition;
  const bodies={json:JSON.stringify(edition,null,2)+'\n',html:renderers.renderHTML(edition,input.records),csv:renderers.renderCSV(edition,input.records)};
  fileIds[kind]=[sharedFile];
  for(const [ext,body]of Object.entries(bodies)){files['customer/'+kind+'.'+ext]=body;fileIds[kind].push(addFile('profiles/'+kind+'.'+ext,body,kind+'-'+ext,{json:'application/json',html:'text/html',csv:'text/csv'}[ext],kind==='sample'?'Free agency example — '+ext.toUpperCase():'Five agency profiles — '+ext.toUpperCase(),leadIds));}
 }
 const saved=act('customer-files-save',{pack_id:input.id,files:savedFiles});
 for(const kind of ['sample','paid']){
  packageIds[kind]=input.id+':'+kind+'-files-01';
  act('customer-package-prepare',{pack_id:input.id,id:packageIds[kind],edition_id:editionIds[kind],title:kind==='sample'?'MapRank — free agency example':'MapRank — five agency profiles',instructions,files:saved.file_revisions.filter(f=>fileIds[kind].includes(f.id))});
 }
 const working=core.leadFulfillmentExport(ledger,{packId:input.id,format:'working-record'}).value;
 const receive={operation_id:input.id+':independent-receive',kind:'working-record-receive',input:{bundle:working},expected_root_sha256:core.hash(core.validateRoot({}))};
 const received=core.applyLeadFulfillment({},receive,input.prepared_at);
 const reopened=core.leadFulfillmentExport(received.ledger,{packId:input.id,format:'working-record'}).value;
 if(JSON.stringify(reopened)!==JSON.stringify(working))throw Error('Complete customer record did not reopen exactly');
 for(const kind of ['sample','paid']){
  const left=core.leadCustomerPackageSelection(ledger,packageIds[kind],input.id),right=core.leadCustomerPackageSelection(received.ledger,packageIds[kind],input.id);
  if(JSON.stringify(left)!==JSON.stringify(right))throw Error('Complete customer package did not reopen exactly');
 }
 files['working-record.json']=JSON.stringify(working,null,2)+'\n';
 return {ledger,working,editions,editionIds,packageIds,requests,results,files,receiving:{request:receive,result:received.received,equal:true}};
}
module.exports={prepare};
