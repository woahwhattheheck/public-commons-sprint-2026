#!/usr/bin/env node
// One read-only original-network course. No contract transaction or deployment.
import * as fs from "node:fs/promises";
import path from "node:path";
import { openStore, sourceIdentity } from "./store.mjs";
import { directory, lease, writeExact, readJSON, fileDescriptor } from "./files.mjs";
import { canonical, parseJSON, inspectArchive, deriveHistory, investorStatement, statementCSV, reportCSV } from "../../app-lib/servicing/model.mjs";

const need=(v,m)=>{if(!v)throw new Error(m);};
const argv=process.argv.slice(2),o={};for(let i=0;i<argv.length;i+=2){need(argv[i]?.startsWith("--")&&argv[i+1]&&!Object.hasOwn(o,argv[i].slice(2)),"Use each original option once.");o[argv[i].slice(2)]=argv[i+1];}
async function main(){
 for(const k of Object.keys(o))need(["directory","binding","operation-id","to-ledger","controller"].includes(k),"Unknown option "+k);
 need(path.isAbsolute(o.directory||"")&&path.isAbsolute(o.binding||"")&&/^[A-Za-z0-9._:-]{1,160}$/.test(o["operation-id"]||""),"Supply absolute directory/binding and stable operation-id.");
 const toLedger=o["to-ledger"]===undefined?null:Number(o["to-ledger"]);need(toLedger===null||Number.isSafeInteger(toLedger)&&toLedger>0,"Use an exact ending ledger.");
 const source=await sourceIdentity(),binding=parseJSON(await fs.readFile(o.binding,"utf8")),root=o.directory,operationId=o["operation-id"];
 await directory(root);const owner=await lease(root,"strata-original-receiving"),abort=new AbortController(),stop=()=>abort.abort(new Error("Original receiving interrupted."));
 process.once("SIGINT",stop);process.once("SIGTERM",stop);
 let workspace;
 const input={schema:"strata.servicing-receiving.v1",operationId,binding,toLedger,controller:o.controller??null,source};
 const file=name=>path.join(root,name),artifact=async name=>fileDescriptor(file(name),name);
 async function frozen(name,value){await writeExact(file(name),Buffer.from(canonical(value)+"\n"));return artifact(name);}
 async function completionBasis(value){
  need(value.schema==="strata.servicing-received.v1"&&value.operationId===operationId&&canonical(value.input)===canonical(input),"Original completion selection changed.");
  for(const d of value.artifacts){const actual=await artifact(d.path);need(actual.bytes===d.bytes&&actual.sha256===d.sha256,"Retained course artifact changed: "+d.path);}
  const original=await inspectArchive(await fs.readFile(file("producer-history.json"),"utf8")),returned=await inspectArchive(await fs.readFile(file("returned-history.json"),"utf8"));
  need(original.sha256===value.producerSha256&&returned.sha256===value.returnedSha256,"Original archive identities differ.");
  need(["COMPLETE","GAP"].includes(value.captureStatus)&&original.journal.captures.find(c=>c.id===operationId+":capture")?.status===value.captureStatus&&canonical(value.coverage)===canonical(deriveHistory(original).coverage),"Course completion differs from original source coverage.");
  const current=new Map(returned.sources.map(s=>[s.id,canonical(s)]));for(const s of original.sources)need(current.get(s.id)===canonical(s),"Customer continuation lost original source.");
  need(returned.notes.some(n=>n.id===operationId+":customer-note"),"Original customer continuation missing.");
  const cold=await inspectArchive(await fs.readFile(file("cold-return-history.json"),"utf8")),proof=await readJSON(file("cold-return.json"));
  need(proof.originalReturnedSha256===returned.sha256&&proof.archiveSha256===cold.sha256&&canonical(proof.sourceIds)===canonical(cold.sources.map(s=>s.id))&&canonical(proof.notes)===canonical(cold.notes),"Cold return receipt differs from its full original archive.");
  need(cold.id===returned.id&&canonical(cold.binding)===canonical(returned.binding)&&canonical(cold.sources)===canonical(returned.sources)&&canonical(cold.batches)===canonical(returned.batches)&&canonical(cold.snapshots)===canonical(returned.snapshots)&&canonical(cold.notes)===canonical(returned.notes),"Cold receiving changed original data.");
  for(const kind of ["commands","attempts"]){const map=new Map(cold.journal[kind].map(x=>[kind==="commands"?x.id:x.request.id,canonical(x)]));for(const row of returned.journal[kind])need(map.get(kind==="commands"?row.id:row.request.id)===canonical(row),"Cold receiving lost original journal history.");}
  return value;
 }
 try{
  await frozen("input.json",input);
  const completed=await readJSON(file("COMPLETE.json"),true);
  if(completed){console.log(canonical(await completionBasis(completed)));return;}
  workspace=await openStore(file("producer"),{identity:source});
  await workspace.initialize(binding,operationId+":initialize");
  const before=await workspace.snapshot(operationId+":opening","Original course opening state",{signal:abort.signal});
  await frozen("opening-snapshot.json",before);
  const captured=await workspace.collect(operationId+":capture",{toLedger,maxPages:10000},{signal:abort.signal});
  await frozen("capture-selection.json",{id:captured.id,initialFromLedger:captured.initialFromLedger,toLedger:captured.toLedger,requestedToLedger:captured.requestedToLedger});
  if(captured.status==="INCOMPLETE")throw new Error("The same original capture remains "+captured.status+"; preserve its partial pages and resume that operation.");
  const after=await workspace.snapshot(operationId+":closing","Original course closing state",{signal:abort.signal});
  await frozen("closing-snapshot.json",after);
  await workspace.export(file("producer-history.json"));await workspace.close();workspace=null;
  const producerRaw=await fs.readFile(file("producer-history.json"),"utf8"),producer=await inspectArchive(producerRaw),report=deriveHistory(producer);
  await frozen("producer-report.json",report);await writeExact(file("producer-events.csv"),Buffer.from(reportCSV(report)));
  if(o.controller){const statement=investorStatement(report,{controller:o.controller});await frozen("investor-statement.json",statement);await writeExact(file("investor-statement.csv"),Buffer.from(statementCSV(statement)));}
  workspace=await openStore(file("customer"),{identity:source});await workspace.receive(producerRaw,operationId+":receive");
  await workspace.note(operationId+":customer-note","Original read-only history received and reopened; on-chain writers were not invoked.");
  await workspace.export(file("returned-history.json"));await workspace.close();workspace=null;
  const returnedRaw=await fs.readFile(file("returned-history.json"),"utf8"),returned=await inspectArchive(returnedRaw);
  workspace=await openStore(file("cold-return"),{identity:source});await workspace.receive(returnedRaw,operationId+":cold-receive");
  const reopened=await workspace.archive();await workspace.export(file("cold-return-history.json"));need(reopened.sources.length===returned.sources.length&&reopened.notes.some(n=>n.id===operationId+":customer-note"),"Cold return lost original continuation.");
  await frozen("cold-return.json",{archiveSha256:reopened.sha256,originalReturnedSha256:returned.sha256,sourceIds:reopened.sources.map(s=>s.id),notes:reopened.notes});
  await workspace.close();workspace=null;
  const names=["input.json","opening-snapshot.json","capture-selection.json","closing-snapshot.json","producer-history.json","producer-report.json","producer-events.csv","returned-history.json","cold-return-history.json","cold-return.json",...(o.controller?["investor-statement.json","investor-statement.csv"]:[])],artifacts=[];
  for(const name of names)artifacts.push(await artifact(name));
  const complete={schema:"strata.servicing-received.v1",operationId,input,producerSha256:producer.sha256,returnedSha256:returned.sha256,captureStatus:captured.status,coverage:report.coverage,artifacts};
  await completionBasis(complete);await frozen("COMPLETE.json",complete);console.log(canonical(complete));
 }finally{if(workspace)await workspace.close();await owner.release();process.removeListener("SIGINT",stop);process.removeListener("SIGTERM",stop);}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
