#!/usr/bin/env node
/* SPDX-License-Identifier: MIT */
"use strict";
const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto"),os=require("node:os");
const {spawnSync}=require("node:child_process");
const C=require("./workspace.cjs"),Example=require("./example.cjs");
const cli=path.join(__dirname,"cli.cjs"),original=path.resolve(__dirname,"../cmdb_qa.mjs");
const canonical=C.canonical,sha=x=>crypto.createHash("sha256").update(x).digest("hex"),json=x=>JSON.stringify(x,null,2)+"\n";
function ensure(v,message){if(!v)throw Error(message);}
function write(file,content){
 if(fs.existsSync(file)){ensure(fs.lstatSync(file).isFile()&&!fs.lstatSync(file).isSymbolicLink(),"Existing receiving input is not a regular file: "+file);ensure(fs.readFileSync(file).equals(Buffer.from(content)),"Existing receiving input differs: "+file);return;}
 fs.writeFileSync(file,content,{flag:"wx",mode:0o600});
}
function main(out,{resumeOriginal=false}={}){
 out=path.resolve(out);
 const commands=path.join(out,"commands");
 if(resumeOriginal){
  ensure(fs.lstatSync(out).isDirectory()&&!fs.lstatSync(out).isSymbolicLink(),"Receiving directory is not a regular directory.");
  const names=fs.readdirSync(commands).sort();
  ensure(canonical(names)===canonical(Array.from({length:13},(_,i)=>String(i+1).padStart(3,"0")+".json")),"Resume requires the thirteen original operation receipts and no later receiving receipt.");
  ensure(!fs.existsSync(path.join(out,"received.workspace.json"))&&!fs.existsSync(path.join(out,"COMPLETE_RECEIVING.json")),"The independent receiving has already advanced; preserve its current state.");
 }else{fs.mkdirSync(out,{recursive:false,mode:0o700});fs.mkdirSync(commands,{mode:0o700});}
 const observed=[],run=(args,expected=0)=>{
  if(resumeOriginal&&observed.length<13){
   const row=JSON.parse(fs.readFileSync(path.join(commands,String(observed.length+1).padStart(3,"0")+".json"),"utf8"));
   ensure(canonical(row.args)===canonical(args)&&row.exitCode===expected&&!row.error,"Retained original command receipt differs.");observed.push(row);
   return expected===0?JSON.parse(row.stdout):JSON.parse(row.stderr);
  }
  const result=spawnSync(process.execPath,[cli,...args],{encoding:"utf8",timeout:120000,maxBuffer:32*1024*1024});
  const row={args,exitCode:result.status,stdout:result.stdout||"",stderr:result.stderr||"",error:result.error?.message||null};observed.push(row);
  write(path.join(commands,String(observed.length).padStart(3,"0")+".json"),json(row));
  if(result.status!==expected)throw Error("Original CLI returned "+result.status+" for "+args[0]+": "+row.stderr+" "+row.error);
  return expected===0?JSON.parse(row.stdout):JSON.parse(row.stderr);
 };
 const worked=Example.operate(),initial={id:worked.workspace.id,label:worked.workspace.label,customer:worked.workspace.customer,tableClass:worked.workspace.tableClass,owner:worked.workspace.owner,at:worked.workspace.createdAt};
 const settings=path.join(out,"settings.json");write(settings,json(initial));
 const file=path.join(out,"operated.workspace.json");run(["init","--workspace",file,"--settings",settings]);
 for(const [name,text]of Object.entries(worked.files))write(path.join(out,name),text);
 for(const [i,step]of worked.steps.entries()){
  const command=JSON.parse(JSON.stringify(step.command)),request=path.join(out,"operation-"+String(i+1).padStart(2,"0")+".json");
  if(command.action==="import"){
   const originalText=command.payload.text,source=path.join(out,command.payload.filename);delete command.payload.text;write(request,json(command));
   ensure(fs.readFileSync(source,"utf8")===originalText,"Original CSV selection differs.");
   run(["import","--workspace",file,"--command",request,"--csv",source]);
  }else{write(request,json(command));run(["apply","--workspace",file,"--command",request]);}
 }
 const operated=C.receive(fs.readFileSync(file,"utf8"));
 ensure(canonical(operated)===canonical(worked.workspace),"The CLI changed the complete authored case.");
 const show=run(["show","--workspace",file,"--run",worked.finalRun]);
 ensure(show.revision===11&&show.selected.receivingStatus==="ACCEPTED","The original final receiving differs.");
 const rawBefore=fs.readFileSync(file);
 const stale={requestId:"receiving-stale-write",expectedRevision:0,actor:"Example delivery lead",at:"2026-10-13T09:12:00.000Z",action:"settings",payload:{...initial,label:"Stale workspace edit"}};
 const staleFile=path.join(out,"stale-operation.json");write(staleFile,json(stale));const staleReturn=run(["apply","--workspace",file,"--command",staleFile],2);
 ensure(/changed in another window/.test(staleReturn.message)&&fs.readFileSync(file).equals(rawBefore),"Stale request changed the original state.");
 const first=path.join(out,"replay-original.json");write(first,json(worked.steps[0].command));const replay=run(["apply","--workspace",file,"--command",first]);
 ensure(replay.replayed&&replay.revision===11&&fs.readFileSync(file).equals(rawBefore),"Replay replaced later work.");
 const firstExport=run(["export","--workspace",file,"--run",worked.firstRun,"--out",path.join(out,"first-comparison")]);
 const finalExport=run(["export","--workspace",file,"--run",worked.finalRun,"--out",path.join(out,"final-comparison")]);
 const parity=[];
 for(const [id,selection]of [[worked.firstRun,firstExport],[worked.finalRun,finalExport]]){
  const target=path.join(out,"original-comparator-"+parity.length);
  const mapping=operated.mappings.find(x=>x.id===operated.runs.find(r=>r.id===id).mappingId);
  const result=spawnSync(process.execPath,[original,"--source",path.join(selection.directory,"mapped-source.csv"),"--target",path.join(selection.directory,"mapped-target.csv"),"--out",target,"--fields",mapping.fields.map(x=>x.name).join(",")],{encoding:"utf8",timeout:120000,maxBuffer:32*1024*1024});
  ensure(result.status===1,"Original comparison CLI did not retain its actual findings.");
  const originalAudit=JSON.parse(fs.readFileSync(path.join(target,"audit.json"),"utf8")),savedAudit=operated.runs.find(x=>x.id===id).audit;
  ensure(canonical(originalAudit)===canonical(savedAudit),"Original comparator and complete application differ.");
  parity.push({runId:id,exitCode:result.status,summary:originalAudit.summary,stdout:result.stdout,auditSha256:sha(fs.readFileSync(path.join(target,"audit.json")))});
 }
 const receivedPath=path.join(out,"received.workspace.json");
 run(["receive","--workspace",receivedPath,"--package",path.join(finalExport.directory,"workspace.package.json")]);
 ensure(canonical(C.receive(fs.readFileSync(receivedPath,"utf8")))===canonical(operated),"Independent full receiving differs.");
 const receivedExport=run(["export","--workspace",receivedPath,"--run",worked.finalRun,"--out",path.join(out,"independent-received")]);
 for(const entry of finalExport.files)ensure(fs.readFileSync(path.join(finalExport.directory,entry.path)).equals(fs.readFileSync(path.join(receivedExport.directory,entry.path))),"Received export differs: "+entry.path);
 const selected=C.reviewRows(operated,worked.finalRun)[0],reviewFile=path.join(out,"revised-review.json");
 const changed={requestId:"receiving-review-revision",expectedRevision:11,actor:"Example receiving lead",at:"2026-10-13T09:12:00.000Z",action:"review",payload:{runId:worked.finalRun,findingIds:[selected.id],status:"accepted_change",owner:selected.review.owner,note:selected.review.note+" Confirmed during receiving.",evidence:selected.review.evidence}};
 write(reviewFile,json(changed));run(["apply","--workspace",receivedPath,"--command",reviewFile]);
 const changedShow=run(["show","--workspace",receivedPath,"--run",worked.finalRun]);
 ensure(changedShow.selected.decision.current===false&&changedShow.selected.receivingStatus==="REVIEW_REQUIRED","Changed review reused the earlier acceptance.");
 const changedExport=run(["export","--workspace",receivedPath,"--run",worked.finalRun,"--out",path.join(out,"review-updated")]);
 const reaffirm=path.join(out,"reaffirm-acceptance.json");write(reaffirm,json({requestId:"receiving-reaffirm-acceptance",expectedRevision:12,actor:"Example receiving lead",at:"2026-10-13T09:13:00.000Z",action:"accept",payload:{runId:worked.finalRun,status:"ACCEPTED",signoffBy:"Example receiving lead",authority:"Authored receiving continuation EX-44",note:"Receiving review is confirmed against the retained original exports and current decisions."}}));
 run(["apply","--workspace",receivedPath,"--command",reaffirm]);
 const finalShow=run(["show","--workspace",receivedPath,"--run",worked.finalRun]);
 ensure(finalShow.revision===13&&finalShow.selected.decision.current&&finalShow.selected.receivingStatus==="ACCEPTED","Current receiving decision did not advance.");
 const continuedExport=run(["export","--workspace",receivedPath,"--run",worked.finalRun,"--out",path.join(out,"continued-receiving")]);
 const lockPath=receivedPath+".lock",lockBody={schema:"cmdb-workspace-writer/1",host:os.hostname(),pid:process.pid,token:crypto.randomUUID(),createdAt:new Date().toISOString()};
 write(lockPath,json(lockBody));let conflict;
 try{conflict=run(["apply","--workspace",receivedPath,"--command",reaffirm],2);ensure(conflict.error==="WRITER_BUSY","A second writer entered the same workspace.");}
 finally{ensure(JSON.parse(fs.readFileSync(lockPath,"utf8")).token===lockBody.token,"The original writer reservation changed.");fs.unlinkSync(lockPath);}
 const complete={schema:"cmdb-native-complete-receiving/1",status:"PASS",completedAt:new Date().toISOString(),originalCase:{...worked.receiving,workspaceSha256:C.pack(operated).sha256},
  commandInvocations:observed.length,originalComparatorParity:parity,originalCsvsPreserved:4,comparisonsPreserved:2,staleRequestPreservedOriginal:true,originalReplayPreservedLaterRevision:true,independentReceivingEqual:true,allReceivedExportFilesEqual:true,changedReviewRequiresNewAcceptance:true,writerReservationRespected:true,
  receivingContinuation:{revision:finalShow.revision,acceptances:C.receive(fs.readFileSync(receivedPath,"utf8")).acceptances.length,status:finalShow.selected.receivingStatus,sha256:finalShow.sha256},
  deliveries:[firstExport,finalExport,receivedExport,changedExport,continuedExport],originalComparator:{path:original,sha256:sha(fs.readFileSync(original))}};
 complete.resumedFromOriginal=resumeOriginal;
 write(path.join(out,"COMPLETE_RECEIVING.json"),json(complete));process.stdout.write(json({status:"PASS",directory:out,originalRevision:11,continuedRevision:13,commands:observed.length,comparisons:parity.map(x=>x.summary),result:path.join(out,"COMPLETE_RECEIVING.json")}));
 return complete;
}
module.exports={main};
if(require.main===module){try{if(process.argv.length!==3&&!(process.argv.length===4&&process.argv[2]==="--resume-original"))throw Error("Usage: node native-receiving.cjs NEW_OUTPUT_DIRECTORY | --resume-original EXISTING_OUTPUT_DIRECTORY");main(process.argv.at(-1),{resumeOriginal:process.argv[2]==="--resume-original"});}catch(e){process.stderr.write(json({error:"RECEIVING_FAILED",message:e.message,stack:e.stack}));process.exitCode=2;}}
