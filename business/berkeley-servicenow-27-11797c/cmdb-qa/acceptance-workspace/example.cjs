/* SPDX-License-Identifier: MIT */
(function(root,factory){if(typeof module==="object"&&module.exports)module.exports=factory(require("./workspace.cjs"));else root.CmdbExample=factory(root.CmdbWorkspace);})(typeof globalThis!=="undefined"?globalThis:this,function(C){
 "use strict";
 const source='sys_id,name,sys_class_name,assigned_to,install_status,serial_number,location\r\nA-100,Finance laptop,cmdb_ci_computer,IT Operations,Installed,DEMO-100,Main office\r\nA-200,Reception desktop,cmdb_ci_computer,Service Desk,Installed,DEMO-200,Main office\r\nA-300,Network switch,cmdb_ci_netgear,Network Team,Installed,DEMO-300,Server room\r\nA-400,Training laptop,cmdb_ci_computer,Learning Team,Installed,DEMO-400,Training room\r\nA-500,Warehouse printer,cmdb_ci_printer,Facilities,Installed,DEMO-500,Warehouse\r\nA-600,Spare laptop,cmdb_ci_computer,IT Operations,In stock,DEMO-600,Store room\r\n';
 const targetHeader="asset_id,display_name,asset_class,owner_group,state,serial,site\r\n";
 const targetRows=[
  "A-100,Finance laptop,cmdb_ci_computer,Unassigned,Installed,DEMO-100,Main office",
  "A-200,Reception desktop,cmdb_ci_computer,Service Desk,Installed,DEMO-200,Annex",
  "A-300,Network switch,cmdb_ci_netgear,Network Team,Installed,DEMO-300,Server room",
  "A-500,Warehouse printer,cmdb_ci_printer,Facilities,Installed,DEMO-500,Warehouse",
  "A-600,Spare laptop,cmdb_ci_computer,IT Operations,In stock,DEMO-600,Store room",
  "A-700,New meeting-room screen,cmdb_ci_hardware,Facilities,Installed,DEMO-700,Annex"
 ];
 const target=targetHeader+targetRows.join("\r\n")+"\r\n";
 const invalid=targetHeader+[...targetRows,targetRows[0]].join("\r\n")+"\r\n";
 const correction=targetHeader+[targetRows[0].replace(",Unassigned,",",IT Operations,"),targetRows[1],targetRows[2],"A-400,Training laptop,cmdb_ci_computer,Learning Team,Installed,DEMO-400,Training room",targetRows[3],targetRows[4],targetRows[5]].join("\r\n")+"\r\n";
 const mapping={label:"Original hardware export mapping",key:{name:"sys_id",source:"sys_id",target:"asset_id"},fields:[
  ["name","display_name"],["sys_class_name","asset_class"],["assigned_to","owner_group"],["install_status","state"],["serial_number","serial"],["location","site"]
 ].map(([name,target])=>({name,source:name,target}))};
 function operate(){
  let w=C.create({id:"cmdb-authored-hardware-example",label:"Hardware migration acceptance",customer:"Example service team",tableClass:"Authored hardware asset example",owner:"Example delivery lead",at:"2026-10-13T09:00:00.000Z"}),step=0;
  const steps=[],run=(action,payload,actor="Example delivery lead")=>{
   step++;const command={requestId:"example-"+String(step).padStart(3,"0"),expectedRevision:w.revision,actor,at:new Date(Date.parse("2026-10-13T09:00:00.000Z")+step*60000).toISOString(),action,payload};
   const result=C.transition(w,command);w=result.workspace;steps.push({command,result:result.result});return result.result;
  };
  const sourceId=run("import",{side:"source",label:"Original baseline",filename:"baseline.csv",text:source,note:"Authored example source; all asset and team names are fictional."}).id;
  const badId=run("import",{side:"target",label:"Received duplicate-key target",filename:"target-with-duplicate.csv",text:invalid,note:"Retain the issued example file and return its duplicate key for correction."}).id;
  const mappingId=run("mapping",mapping).id;
  const intake=C.preview(w,sourceId,badId,mapping);
  if(intake.target.problems.length!==1||intake.target.problems[0].kind!=="Duplicate stable key")throw Error("Original duplicate row was not retained and identified.");
  const targetId=run("import",{side:"target",label:"First valid target",filename:"target-first.csv",text:target,parentId:badId,note:"Removed the duplicated original row; other changes require review."}).id;
  const firstRun=run("compare",{sourceId,targetId,mappingId,label:"First migration comparison"}).id;
  const first=C.reviewRows(w,firstRun);
  if(first.length!==4||w.runs[0].audit.summary.critical!==2)throw Error("The original comparison differs.");
  const corrective=first.filter(x=>x.record_key==="A-100"||x.record_key==="A-400");
  run("review",{runId:firstRun,findingIds:corrective.map(x=>x.id),status:"correction_required",owner:"Example migration engineer",due:"2026-10-15",note:"Restore the retained owning team and the omitted training laptop.",evidence:"Example migration worklist 12"});
  const intended=first.filter(x=>!corrective.some(y=>y.id===x.id));
  run("review",{runId:firstRun,findingIds:intended.map(x=>x.id),status:"accepted_change",owner:"Example service owner",note:"The approved move and new asset are intentional changes.",evidence:"Authored change approval EX-42"});
  run("accept",{runId:firstRun,status:"REVIEW_REQUIRED",signoffBy:"Example receiving lead",authority:"Example acceptance plan EX-10",note:"Retain the first comparison; correct the two unresolved asset differences."},"Example receiving lead");
  const correctedId=run("import",{side:"target",label:"Corrected target",filename:"target-corrected.csv",text:correction,parentId:targetId,note:"Restored original owner and missing asset; approved changes remain."}).id;
  const finalRun=run("compare",{sourceId,targetId:correctedId,mappingId,label:"Corrected migration comparison",previousRunId:firstRun,carryAccepted:true}).id;
  if(C.reviewRows(w,finalRun).length!==2||C.reviewRows(w,finalRun).some(x=>x.status!=="accepted_change"))throw Error("Only the two identical accepted findings should carry.");
  run("accept",{runId:finalRun,status:"ACCEPTED",signoffBy:"Example receiving lead",authority:"Authored receiving decision EX-43",note:"The corrected target retains the original asset ownership and complete inventory. The approved relocation and new asset are accepted."},"Example receiving lead");
  const packed=C.pack(w),received=C.receive(JSON.stringify(packed));
  if(C.canonical(received)!==C.canonical(w))throw Error("Complete receiving changed the original workspace.");
  const replay=C.transition(received,steps[0].command);
  if(!replay.replayed||replay.workspace.revision!==w.revision)throw Error("Original receipt replay replaced later work.");
  return {workspace:received,steps,intake,firstRun,finalRun,receiving:{status:"PASS",sourceRows:6,targetRows:7,retainedExports:4,comparisons:2,operations:w.revision,
   initialFindings:4,initialCritical:2,currentFindings:2,currentCritical:0,carriedAccepted:2,priorFindingsAbsent:C.lineage(w,finalRun).absent.length,
   originalReplayPreservedLaterRevision:true,workspaceSha256:packed.sha256},files:{"baseline.csv":source,"target-with-duplicate.csv":invalid,"target-first.csv":target,"target-corrected.csv":correction}};
 }
 return {operate,mapping,source,target,invalid,correction};
});
