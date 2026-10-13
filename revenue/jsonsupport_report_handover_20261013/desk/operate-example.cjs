"use strict";
function operateReportDesk(api,initial) {
 let state=api.receiveWorking(api.exportWorking(initial),initial.seed_sha256);
 const events=[],lead=state.seed.leads[0],lead_id=lead.id;
 const at=i=>"2026-10-13T14:"+String(40+Math.floor(i/60)).padStart(2,"0")+":"+String(i%60).padStart(2,"0")+".000Z";
 function act(kind,input){const request={id:"authored-report-operation-"+(events.length+1),expected_revision:state.revision,lead_id,kind,input};const result=api.apply(state,request,at(events.length));state=result.root;events.push({request,result_revision:state.revision});return request;}
 const original=api.proposalOf(state.projects[lead_id]);
 const proposal=api.clone(original);
 Object.assign(proposal.config,{report_name:"Agency source handover — preparation example",client:"TJL-authored preparation",source_system:"Original public agency profile",existing_process:"Not measured; this is an authored working example.",operator:"Preparation operator",recipient:"",route:"api",cadence:"Not agreed",data_notes:"Only the original published business profile is used. No client data or vendor request was sent.",delivery_notes:"Prepared request and local CSV; actual remote conversion remains unrecorded."});
 const document={records:[{agency:{name:lead.document.organization,domain:lead.document.company_domain},contact:lead.document.contact_url,reference:"00017",source:lead.document.source_url,checked:lead.document.checked_at,metadata:{kind:"public company research"}}]};
 proposal.source={format:"json",text:JSON.stringify(document,null,2),records_pointer:"/records"};
 proposal.columns=[{name:"Agency",pointer:"/agency/name",type:"text",required:true},{name:"Domain",pointer:"/agency/domain",type:"text",required:true},{name:"Reference",pointer:"/reference",type:"text",required:true},{name:"Checked",pointer:"/checked",type:"date",required:true},{name:"Context",pointer:"/metadata",type:"json",required:true}];
 const first=act("save",proposal),compiled=api.compile(state.projects[lead_id]);
 if(!compiled.ready||compiled.rows[0].Reference!=="00017")throw Error("Public-profile request must preserve text identifiers.");
 const body=api.requestBody(state.projects[lead_id]),csv=api.previewCsv(state.projects[lead_id]);
 act("handover",{title:"Original public-profile preparation"});
 const bad=api.clone(proposal);bad.columns[2].type="number";act("save",bad);
 if(api.compile(state.projects[lead_id]).ready)throw Error("The leading-zero reference must not silently become a number.");
 const next=api.clone(proposal);next.source.format="jsonl";next.source.records_pointer="";next.source.text=JSON.stringify(document.records[0])+"\n"+JSON.stringify({...document.records[0],reference:"00018"});
 act("save",next);
 if(api.compile(state.projects[lead_id]).rows.length!==2)throw Error("Both JSONL records must be retained.");
 const localComparison=api.compareReturned(state.projects[lead_id],api.requestBody(state.projects[lead_id]));
 if(!localComparison.equal)throw Error("The local round-trip comparison differs.");
 const changed=JSON.parse(api.requestBody(state.projects[lead_id]));changed.data[1].Reference="18";
 if(api.compareReturned(state.projects[lead_id],JSON.stringify(changed)).equal)throw Error("A changed returned identifier was missed.");
 act("record-run",{status:"needs-work",output_name:"local-prepared-records.csv",output_rows:2,minutes:null,notes:"Actual application preparation only: public research was mapped and exported locally. No remote JSON Support conversion was invoked; obtain an actual returned workbook before accepting that step.",returned_json:""});
 act("handover",{title:"Two-row JSONL preparation"});
 let stale=false;try{api.apply(state,{id:"stale-desk-write",expected_revision:0,lead_id,kind:"save",input:proposal},at(30));}catch(error){stale=/changed/.test(error.message);}if(!stale)throw Error("Stale working revision was accepted.");
 const exported=api.exportWorking(state),received=api.receiveWorking(exported,initial.seed_sha256);
 if(api.exportWorking(received)!==exported)throw Error("The full working file changed when reopened.");
 const replay=api.apply(received,first,at(31));if(!replay.replayed||api.exportWorking(replay.root)!==exported)throw Error("Original replay changed later work.");
 if(received.projects[lead_id].handovers[0].rows[0].Reference!=="00017")throw Error("Earlier handover changed.");
 return {schema:"jsonsupport.report-desk-operated-example.v1",description:"The actual complete desk engine operating authored preparation data from its original public agency profile. Remote conversion is not part of this operation.",events,working:received,prepared_request:body,preview_csv:csv,local_comparison:localComparison,stale_write_refused:stale,working_reopened_equal:true,original_request_replayed_equal:true,handovers:received.projects[lead_id].handovers.length};
}
module.exports={operateReportDesk};
