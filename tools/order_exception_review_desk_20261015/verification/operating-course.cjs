"use strict";
const C=require("../order-review-core.cjs");
const crypto=require("node:crypto");
const run=function runOrderDeskCourse(C,sha){
 const at="2026-10-15T05:30:00.000Z";let counter=0,s=C.create({id:"authored-course",name:"Authored order-review operating course",at});const checks=[];
 const apply=a=>{s=C.apply(s,a,{id:"event-"+(++counter),at});};
 const assert=(ok,label)=>{if(!ok)throw Error(label);checks.push(label);};
 const refused=(fn,label)=>{let yes=false;try{fn();}catch(e){yes=true;}assert(yes,label);};
 const originals={
 before:'\ufeffCompany,Order,Line,Quantity,Unit,Promise,Status,Note\r\nNorth,100,1,10,EA,2026-10-20,Open,"Original, approved order"\r\nNorth,200,1,5,EA,2026-10-21,Open,Unchanged\r\nNorth,300,1,2,EA,2026-10-22,Open,Missing later\r\nNorth,500,1,1,EA,2026-10-22,Open,First duplicate\r\nNorth,500,1,2,EA,2026-10-22,Open,Second duplicate\r\n',
 after:'Company,Order,Line,Quantity,Unit,Promise,Status,Note\nNorth,100,1,12,EA,2026-10-23,Open,Customer change\nNorth,200,1,5,EA,2026-10-21,Open,Unchanged\nNorth,400,1,3,EA,2026-10-24,Open,New order\nNorth,500,1,1,EA,2026-10-22,Open,Needs resolution\n',
 requests:JSON.stringify([{order:"100",line:"1",message:"Please increase to12 and confirm delivery.",message_id:"mail-a"},{order:"500",line:"1",message:"Which line is correct?",message_id:"mail-b"},{order:"00100",line:"1",message:"Keep leading zeros.",message_id:"mail-c"}]),
 foreign:JSON.stringify([{order:"100",line:"1",message:"Different company.",message_id:"mail-other"}])
 };
 for(const id of Object.keys(originals))apply({type:"add_source",id,filename:id+(id==="before"||id==="after"?".csv":".json"),kind:id==="before"||id==="after"?"orders":"requests",system:id==="before"||id==="after"?"Authored ERP export":"Authored mailbox export",captured_at:at,effective_at:"Authored scenario only",format:id==="before"||id==="after"?"csv":"json",delimiter:",",original_text:originals[id],sha256:sha(originals[id])});
 for(const id of ["before","after"])apply({type:"map_source",source_id:id,company:"North",grain:"line",order_column:"Order",line_column:"Line",fields:{quantity:"Quantity",unit:"Unit",promised_date:"Promise",status:"Status"}});
 for(const id of ["requests","foreign"])apply({type:"map_source",source_id:id,company:id==="foreign"?"South":"North",grain:"line",order_column:"order",line_column:"line",fields:{}});
 const comparison=C.compare(s,"before","after");
 assert(comparison.counts.changed===1&&comparison.counts.unchanged===1&&comparison.counts.missing_from_later===1&&comparison.counts.new_in_later===1&&comparison.counts.ambiguous===1,"Whole snapshot comparison distinguishes change, unchanged, missing, new and duplicate identities");
 const changed=comparison.results.find(x=>x.status==="changed");
 assert(changed.changes.length===2&&changed.changes.some(x=>x.field==="quantity")&&changed.changes.some(x=>x.field==="promised_date"),"Only declared quantity and promise differences appear");
 const suggested=C.suggestions(s,"requests","before");
 assert(suggested[0].state==="unique_exact_key"&&suggested[1].state==="ambiguous"&&suggested[2].state==="no_exact_key","Request proposals preserve ambiguity and leading-zero identifiers");
 assert(C.suggestions(s,"foreign","after")[0].state==="no_exact_key","Company boundaries prevent an unrelated exact order number joining");
 apply({type:"bind_request",id:"binding-1",request:{source_id:"requests",row:0},targets:[{source_id:"before",row:0},{source_id:"after",row:0}],actor:"Authored operator",reason:"Reviewed original message and both order records."});
 apply({type:"create_review",id:"review-1",title:"Review quantity and date change",actor:"Authored operator",proposal:"Confirm12EA and2026-10-23 in the operating system after approval.",reason:"Customer requested a quantity and delivery change.",source_refs:[{source_id:"requests",row:0},{source_id:"before",row:0},{source_id:"after",row:0}],binding_ids:["binding-1"]});
 refused(()=>C.apply(s,{type:"record_decision",review_id:"review-1",expected_version:1,status:"closed",actor:"Reviewer",proposal:s.reviews[0].versions[0].proposal,reason:"Attempted premature closure",observed_result:"",evidence_refs:[]},{id:"invalid-close",at}),"Closure cannot skip approval and observed-result review");
 let proposal=s.reviews[0].versions[0].proposal;
 apply({type:"record_decision",review_id:"review-1",expected_version:1,status:"approved",actor:"Authored approver",proposal,reason:"Reviewed customer authorization and revised supply date.",observed_result:"",evidence_refs:[]});
 apply({type:"record_decision",review_id:"review-1",expected_version:2,status:"observed",actor:"Authored operator",proposal,reason:"Compared the supplied later order record.",observed_result:"Later export contains12EA and2026-10-23.",evidence_refs:[{source_id:"after",row:0}]});
 apply({type:"record_decision",review_id:"review-1",expected_version:3,status:"closed",actor:"Authored reviewer",proposal,reason:"Reviewed the later original record and customer request.",observed_result:"Later export contains12EA and2026-10-23.",evidence_refs:[{source_id:"after",row:0}]});
 refused(()=>C.apply(s,{type:"record_decision",review_id:"review-1",expected_version:2,status:"approved",actor:"Old tab",proposal,reason:"Outdated edit",observed_result:"",evidence_refs:[]},{id:"stale",at}),"An older review version cannot replace the current decision");
 refused(()=>C.apply(s,{type:"map_source",source_id:"after",company:"Other",grain:"order",order_column:"Order",line_column:"",fields:{}},{id:"changed-mapping",at}),"A source mapping used by a decision remains fixed");
 apply({type:"record_decision",review_id:"review-1",expected_version:4,status:"proposed",actor:"Authored operator",proposal:"Assess a later requested amendment separately.",reason:"New change requires its own approval.",observed_result:"",evidence_refs:[]});
 assert(s.reviews[0].versions.length===5&&s.reviews[0].versions[3].status==="closed"&&s.reviews[0].versions[4].status==="proposed","A new proposal retains the entire prior approved, observed and closed history");
 C.validate(s);const envelope={schema:"tjl-order-review-portable.v1",sha256:sha(C.stable(s)),workspace:s},raw=JSON.stringify(envelope,null,2)+"\n",reopened=JSON.parse(raw);
 C.validate(reopened.workspace);assert(sha(C.stable(reopened.workspace))===envelope.sha256&&reopened.workspace.sources.every(x=>x.original_text===originals[x.id]&&sha(x.original_text)===x.sha256),"Complete portable export/reopen retains original BOM, line endings, message content and all hashes");
 const branch=C.branch(reopened.workspace,{id:"continued-course",name:"Continued authored course",at});
 assert(branch.origin.workspace_id===s.id&&C.stable(branch.reviews)===C.stable(s.reviews),"A recipient continuation retains all prior decisions without replacing the original workspace");
 const csv=C.decisionsCSV(s);assert(C.parse(csv,"csv",",").rows.length===5,"Decision-history CSV reopens all five versions");
 assert(C.parse('a;b\n"x;y";"line1\nline2"\n',"csv",";").rows[0].b==="line1\nline2","Declared delimiter and quoted multiline original fields are retained");
 refused(()=>C.parse('Order,Order\n1,2\n'),"Duplicate source headers are rejected");
 return{schema:"tjl-order-review-execution.v1",environment:"Production core executed in V8 with explicit SHA-256 codec; authored operating records",checks,workspace_revision:s.revision,source_count:s.sources.length,source_rows:s.sources.reduce((n,x)=>n+x.rows.length,0),bindings:s.bindings.length,review_versions:s.reviews[0].versions.length,complete_workspace_sha256:envelope.sha256,portable_bytes:raw.length,comparison_counts:comparison.counts,portable:raw};
};
const result=run(C,s=>crypto.createHash("sha256").update(s,"utf8").digest("hex"));
delete result.portable;
process.stdout.write(JSON.stringify(result,null,2)+"\n");
