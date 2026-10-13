'use strict';
function prepare(core,renderers,input){
 let ledger={};const requests=[];const results=[];
 const act=(kind,data)=>{const request={operation_id:input.id+':'+kind+':'+requests.length,kind,input:data,expected_root_sha256:core.hash(core.validateRoot(ledger))};const result=core.applyLeadFulfillment(ledger,request,input.prepared_at);ledger=result.ledger;requests.push(request);results.push({operation_id:result.operation_id,changed:result.changed,kind});return result;};
 act('pack-save',{id:input.id,customer:input.customer,brief:input.brief,operator_note:input.operator_note});
 act('leads-save',{pack_id:input.id,leads:input.records.map(r=>({id:input.id+':'+r.slug,document:r}))});
 const sample=input.records.filter(r=>r.role==='sample');const paid=input.records.filter(r=>r.role==='paid');
 if(sample.length!==1||paid.length!==5)throw Error('Expected one sample and five paid merchants');
 const editionIds={sample:input.id+':sample-01',paid:input.id+':paid-01'};
 for(const kind of ['sample','paid'])act('edition-prepare',{id:editionIds[kind],pack_id:input.id,kind,lead_ids:(kind==='sample'?sample:paid).map(r=>input.id+':'+r.slug)});
 const working=core.leadFulfillmentExport(ledger,{packId:input.id,format:'working-record'}).value;
 const receive={operation_id:input.id+':independent-receive',kind:'working-record-receive',input:{bundle:working},expected_root_sha256:core.hash(core.validateRoot({}))};
 const received=core.applyLeadFulfillment({},receive,input.prepared_at);
 const reopened=core.leadFulfillmentExport(received.ledger,{packId:input.id,format:'working-record'}).value;
 if(JSON.stringify(reopened)!==JSON.stringify(working))throw Error('Complete customer record did not reopen exactly');
 const files={'working-record.json':JSON.stringify(working,null,2)+'\n'};
 const editions={};
 for(const kind of ['sample','paid']){
  const e=core.leadFulfillmentExport(ledger,{packId:input.id,editionId:editionIds[kind],format:'json'}).value;editions[kind]=e;
  files['customer/'+kind+'.json']=JSON.stringify(e,null,2)+'\n';
  files['customer/'+kind+'.html']=renderers.renderHTML(e,input.records);
  files['customer/'+kind+'.csv']=renderers.renderCSV(e,input.records);
 }
 return {ledger,working,editions,editionIds,requests,results,files,receiving:{request:receive,result:{pack_id:received.pack_id,received:received.received},equal:JSON.stringify(reopened)===JSON.stringify(working)}};
}
module.exports={prepare};
