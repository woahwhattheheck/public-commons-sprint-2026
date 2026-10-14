#!/usr/bin/env node
// Labelled authored source exercise. It never contacts a provider or writes a contract.
import * as fs from "node:fs/promises";
import path from "node:path";
import { strict as assert } from "node:assert";
import { Address, StrKey, nativeToScVal, xdr } from "@stellar/stellar-sdk";
import { openStore, sourceIdentity } from "./store.mjs";
import { directory, lease, writeExact, readJSON, fileDescriptor } from "./files.mjs";
import { SOURCE_COMMIT, ROLES, canonical, parseJSON, digest, inspectArchive, deriveHistory, investorStatement, statementCSV, reportCSV, instanceKeys } from "../../app-lib/servicing/model.mjs";

const args=process.argv.slice(2);
assert.equal(args.length,2,"Use --directory ABS_NEW_EXERCISE_DIRECTORY");assert.equal(args[0],"--directory");assert(path.isAbsolute(args[1]));
const root=args[1],kind="AUTHOR_SUPPLIED_SOFTWARE_EXERCISE",operationId="strata-native-software-exercise-v1";
const contracts=Object.fromEntries(ROLES.map((role,i)=>[role,StrKey.encodeContract(Buffer.alloc(32,i+1))]));
const account=StrKey.encodeEd25519PublicKey(Buffer.alloc(32,30)),custodian=StrKey.encodeEd25519PublicKey(Buffer.alloc(32,31));
const binding={network:{id:"authored-local-example",passphrase:"Strata servicing authored exercise; no live network",rpcUrl:"http://127.0.0.1:1/never-contacted"},contracts,startLedger:101,sourceCommit:SOURCE_COMMIT};
const str=(n,type="i128")=>nativeToScVal(BigInt(n),{type});
const sym=s=>xdr.ScVal.scvSymbol(s);
const data=fields=>xdr.ScVal.scvMap(Object.keys(fields).sort().map(k=>new xdr.ScMapEntry({key:sym(k),val:fields[k]})));
const addr=s=>Address.fromString(s).toScVal();
function event(ledger,name,topic,fields,role="async_vault"){
 return {id:((BigInt(ledger)<<32n)+4096n).toString().padStart(19,"0")+"-0000000000",ledger,ledgerClosedAt:"2026-10-13T00:00:"+String(ledger-100).padStart(2,"0")+"Z",contractId:contracts[role],type:"contract",txHash:ledger.toString(16).padStart(64,"0"),topic:[sym(name),topic].map(s=>s.toXDR("base64")),value:data(fields).toXDR("base64")};
}
const events=[
 event(101,"deposit_requested",addr(account),{epoch:str(1,"u64"),amount:str("9007199254740993")}),
 event(102,"deposit_cancelled",addr(account),{epoch:str(1,"u64"),amount:str("9007199254740993")}),
 event(103,"deposit_requested",addr(account),{epoch:str(1,"u64"),amount:str(11)}),
 event(104,"redeem_requested",addr(account),{epoch:str(1,"u64"),shares:str(3)}),
 event(105,"nav_attested",addr(custodian),{nav_per_share:str("2000000000000000000"),expires_at:str(1792000000,"u64")},"nav_oracle"),
 event(106,"epoch_closed",str(1,"u64"),{total_deposited:str(11),total_shares_redeeming:str(3)}),
 event(107,"epoch_fulfilled",str(1,"u64"),{share_price:str("2000000000000000000"),total_deposited:str(11)}),
 event(108,"deposit_claimed",addr(account),{epoch:str(1,"u64"),amount:str(11),shares:str(5)}),
 event(109,"redeem_claimed",addr(account),{epoch:str(1,"u64"),shares:str(3),assets:str(6)}),
 event(110,"deployed",addr(custodian),{assets:str(50),net_deployed:str(50)}),
 event(111,"funded",addr(account),{assets:str(70),net_deployed:str(-20)}),
 event(112,"wind_down_claimed",addr(account),{surrendered:str(2),assets:str(4)}),
 event(113,"deposit_requested",addr(account),{epoch:str(2,"u64"),amount:xdr.ScVal.scvString("10")})
];
function entries(net,ledger){
 return instanceKeys(binding).map((key,i)=>{
  const k=xdr.LedgerKey.fromXDR(key,"base64").contractData();
  const storage=i===0?[new xdr.ScMapEntry({key:xdr.ScVal.scvVec([sym("NetDeployed")]),val:str(net)})]:[];
  const instance=new xdr.ScContractInstance({executable:xdr.ContractExecutable.contractExecutableWasm(Buffer.alloc(32,i+40)),storage});
  const val=xdr.ScVal.scvContractInstance(instance);
  const body=xdr.LedgerEntryData.contractData(new xdr.ContractDataEntry({ext:new xdr.ExtensionPoint(0),contract:k.contract(),key:k.key(),durability:k.durability(),val}));
  return {key,xdr:body.toXDR("base64"),lastModifiedLedgerSeq:ledger,liveUntilLedgerSeq:10000};
 });
}
async function main(){
 const source=await sourceIdentity();await directory(root);const owner=await lease(root,"strata-authored-exercise");let store;
 const output=name=>path.join(root,name),save=(name,value)=>writeExact(output(name),Buffer.from(canonical(value)+"\n"));
 try{
  await save("INPUT.json",{kind,operationId,binding,source});
  const completed=await readJSON(output("COMPLETE.json"),true);
  if(completed){assert.equal(completed.kind,kind);for(const d of completed.artifacts){const actual=await fileDescriptor(output(d.path),d.path);assert.equal(actual.sha256,d.sha256);assert.equal(actual.bytes,d.bytes);}await inspectArchive(await fs.readFile(output("returned.json"),"utf8"));console.log(canonical(completed));return;}
  let reads=0,snapshots=0;
  async function fetchImpl(url,options){
   assert.equal(url,binding.network.rpcUrl);assert.equal(options.method,"POST");
   const request=parseJSON(options.body);let result,error;
   if(request.method==="getNetwork")result={passphrase:binding.network.passphrase,protocolVersion:23};
   else if(request.method==="getHealth")result={status:"healthy",oldestLedger:101,latestLedger:120,ledgerRetentionWindow:20};
   else if(request.method==="getLedgerEntries"){const closing=request.id&&snapshots++>0;result={latestLedger:closing?120:100,entries:entries(closing?-20:0,closing?120:100)};}
   else if(request.method==="getEvents"){
    reads++;
    // The very first original page fails. It remains in the source journal, then the same capture resumes.
    if(reads===1)error={code:-32000,message:"Authored temporary original read failure"};
    else result={events,latestLedger:120,oldestLedger:101,cursor:events.at(-1).id};
   }else throw new Error("No other RPC is permitted in the authored exercise.");
   return new Response(canonical({jsonrpc:"2.0",id:request.id,...(error?{error}:{result})}),{status:200,headers:{"content-type":"application/json","x-source-kind":kind}});
  }
  store=await openStore(output("producer"),{identity:source});await store.initialize(binding,operationId+":initialize");
  await store.snapshot(operationId+":opening","Authored opening state",{fetchImpl});
  // A prior interrupted exercise may already have completed this request; its original response is adopted.
  let capture=await store.collect(operationId+":capture",{toLedger:120,maxPages:1},{fetchImpl});
  if(capture.status!=="COMPLETE"){assert.equal(capture.status,"INCOMPLETE");capture=await store.collect(operationId+":capture",{toLedger:120,maxPages:1},{fetchImpl});}
  assert.equal(capture.status,"COMPLETE");
  const calls=reads;assert.equal(canonical(await store.collect(operationId+":capture",{toLedger:120,maxPages:2},{fetchImpl})),canonical(capture));assert.equal(reads,calls);
  // On a resumed run the retained opening snapshot does not call the fixture again.
  snapshots=Math.max(snapshots,1);
  await store.snapshot(operationId+":closing","Authored closing state",{fetchImpl});
  const archive=await store.archive(),report=deriveHistory(archive),statement=investorStatement(report,{controller:account});
  assert.equal(report.requests.length,3);assert.equal(report.requests[0].status,"CANCELLED");assert.equal(report.requests[1].status,"CLAIMED");assert.equal(report.requests[2].status,"CLAIMED");
  assert.notEqual(report.requests[0].id,report.requests[1].id);assert.equal(report.requests[0].amount,"9007199254740993");
  assert.equal(statement.totals.depositRequested,"9007199254741004");assert.equal(statement.totals.depositRefunded,"9007199254740993");assert.equal(statement.totals.sharesClaimed,"5");
  assert.equal(statement.totals.sharesRequestedForRedemption,"3");assert.equal(statement.totals.redemptionAssetsPaid,"6");assert.equal(statement.totals.windDownAssetsPaid,"4");assert.equal(statement.totals.windDownSharesSurrendered,"2");
  assert.equal(report.reconciliations.length,1);assert.equal(report.reconciliations[0].status,"MATCH");assert.equal(report.reconciliations[0].closingNetDeployed,"-20");
  assert.equal(report.valuations[0].price,"2000000000000000000");assert.equal(report.events.length,events.length);
  assert(report.events.find(e=>e.ledger===113).decodeError?.includes("XDR type"));
  await store.export(output("producer.json"));await store.close();store=null;
  await save("report.json",report);await save("statement.json",statement);
  await writeExact(output("statement.csv"),Buffer.from(statementCSV(statement)));await writeExact(output("events.csv"),Buffer.from(reportCSV(report)));
  const raw=await fs.readFile(output("producer.json"),"utf8");
  const changed=parseJSON(raw);changed.sources[0].responseText+=" ";await assert.rejects(inspectArchive(canonical(changed)),/seal|bytes|identity/);
  store=await openStore(output("recipient"),{identity:source});await store.receive(raw,operationId+":receive");
  await store.note(operationId+":recipient-note","Authored independent recipient continuation; no original business data.");
  await store.export(output("returned.json"));await store.close();store=null;
  const returned=await inspectArchive(await fs.readFile(output("returned.json"),"utf8"));
  assert.deepEqual(returned.sources,archive.sources);assert.deepEqual(returned.batches,archive.batches);assert(returned.notes.some(n=>n.id===operationId+":recipient-note"));
  const erased=parseJSON(canonical(returned));erased.journal.commands=erased.journal.commands.filter(c=>c.method!=="initialize");delete erased.sha256;
  const erasedRaw=canonical({...erased,sha256:await digest(canonical(erased))});
  await assert.rejects(inspectArchive(erasedRaw),/lost an original command/);
  store=await openStore(output("recipient"),{identity:source});
  const restored=await store.collect(operationId+":capture",{toLedger:120},{fetchImpl:()=>{throw new Error("Completed original capture must not reread.");}});
  assert.equal(restored.status,"COMPLETE");await store.close();store=null;
  store=await openStore(output("gap"),{identity:source});await store.initialize({...binding,startLedger:1},operationId+":gap-init");
  const gap=await store.collect(operationId+":gap",{toLedger:100},{fetchImpl});assert.equal(gap.status,"GAP");
  const gapArchive=await store.archive(),gapReport=deriveHistory(gapArchive);assert.equal(gapReport.coverage[0].status,"GAP");assert.equal(gapReport.events.length,0);
  assert(investorStatement(gapReport,{controller:account}).warnings.some(s=>s.includes("not fully covered")));
  await store.export(output("gap.json"));await store.close();store=null;
  const continuityEvents=[
    event(101,"deposit_requested",addr(account),{epoch:str(1,"u64"),amount:str(10)}),
    event(130,"deposit_claimed",addr(account),{epoch:str(1,"u64"),amount:str(20),shares:str(10)})
  ];
  let oldest=101;
  const selectedFetch=(eventRows)=>async(url,options)=>{
    assert.equal(url,binding.network.rpcUrl);const q=parseJSON(options.body);let result;
    if(q.method==="getNetwork")result={passphrase:binding.network.passphrase};
    else if(q.method==="getHealth")result={oldestLedger:oldest,latestLedger:140};
    else if(q.method==="getEvents"){const rows=eventRows.filter(e=>e.ledger>=q.params.startLedger&&e.ledger<q.params.endLedger);result={oldestLedger:oldest,latestLedger:140,events:rows,cursor:rows.at(-1)?.id??"0000000601295425536-0000000000"};}
    else throw new Error("Unexpected authored continuity read.");
    return new Response(canonical({jsonrpc:"2.0",id:q.id,result}),{status:200,headers:{"content-type":"application/json","x-source-kind":kind}});
  };
  store=await openStore(output("continuity"),{identity:source});await store.initialize(binding,operationId+":continuity-init");
  await store.collect(operationId+":before-gap",{toLedger:101},{fetchImpl:selectedFetch(continuityEvents)});
  oldest=130;await store.collect(operationId+":missing",{toLedger:129},{fetchImpl:selectedFetch(continuityEvents)});
  await store.collect(operationId+":after-gap",{toLedger:130},{fetchImpl:selectedFetch(continuityEvents)});
  const discontinuous=deriveHistory(await store.archive());
  assert.equal(discontinuous.requests.length,2);assert.equal(discontinuous.requests[0].amount,"10");assert.equal(discontinuous.requests[0].status,"INCOMPLETE");assert.equal(discontinuous.requests[1].amount,"20");assert.equal(discontinuous.requests[1].missingStart,true);
  await store.export(output("continuity.json"));await store.close();store=null;
  oldest=101;
  store=await openStore(output("pricing"),{identity:source});await store.initialize(binding,operationId+":pricing-init");
  await store.collect(operationId+":priced",{toLedger:107},{fetchImpl:selectedFetch(events)});
  const priced=deriveHistory(await store.archive()),pricingStatement=investorStatement(priced,{controller:account,fromLedger:107,toLedger:107});
  assert(pricingStatement.requests.some(r=>r.side==="deposit"&&r.status==="PRICED"&&r.lastLedger===107));
  await store.export(output("pricing.json"));await store.close();store=null;
  store=await openStore(output("partial-producer"),{identity:source});await store.initialize(binding,operationId+":partial-init");
  const failureFetch=async(url,options)=>{
    const q=parseJSON(options.body);
    if(q.method!=="getEvents")return selectedFetch(events)(url,options);
    return new Response(canonical({jsonrpc:"2.0",id:q.id,error:{code:-32000,message:"Authored source pause before first accepted page"}}),{status:200,headers:{"content-type":"application/json"}});
  };
  const retainedPartial=await readJSON(output("partial-original.json"),true);
  if(retainedPartial){
    const original=await inspectArchive(canonical(retainedPartial)),current=await store.archive();
    assert.equal(original.id,current.id);assert.deepEqual(original.binding,current.binding);
    const currentSources=new Map(current.sources.map(s=>[s.id,s]));for(const s of original.sources)assert.deepEqual(currentSources.get(s.id),s);
    const originalCapture=original.journal.captures.find(c=>c.id===operationId+":partial-capture"),currentCapture=current.journal.captures.find(c=>c.id===operationId+":partial-capture");
    assert.equal(originalCapture?.status,"INCOMPLETE");assert(currentCapture);
    for(const k of ["id","requestedToLedger","initialFromLedger","fromLedger","toLedger","startedAt","networkSourceId","healthSourceId"])assert.deepEqual(currentCapture[k],originalCapture[k]);
    for(const k of ["sourceIds","failedSourceIds"])assert.deepEqual(currentCapture[k].slice(0,originalCapture[k].length),originalCapture[k]);
    const currentCommands=new Map(current.journal.commands.map(c=>[c.id,c]));for(const c of original.journal.commands)if(c.status==="COMPLETE")assert.deepEqual(currentCommands.get(c.id),c);
  }else{
    assert.equal((await store.collect(operationId+":partial-capture",{toLedger:120,maxPages:1},{fetchImpl:failureFetch})).status,"INCOMPLETE");
    await store.export(output("partial-original.json"));
  }
  await store.close();store=null;
  store=await openStore(output("partial-recipient"),{identity:source});await store.receive(await fs.readFile(output("partial-original.json"),"utf8"),operationId+":partial-receive");
  assert.equal((await store.collect(operationId+":partial-capture",{toLedger:120},{fetchImpl:selectedFetch(events)})).status,"COMPLETE");
  await store.export(output("partial-continued.json"));await store.close();store=null;
  const continued=await inspectArchive(await fs.readFile(output("partial-continued.json"),"utf8"));
  assert.equal(continued.batches[0].status,"COMPLETE");assert.equal(deriveHistory(continued).requests.length,3);
  const names=["INPUT.json","producer.json","report.json","statement.json","statement.csv","events.csv","returned.json","gap.json","continuity.json","pricing.json","partial-original.json","partial-continued.json"],artifacts=[];
  for(const name of names)artifacts.push(await fileDescriptor(output(name),name));
  const result={schema:"strata.servicing-exercise.v1",kind,operationId,source,artifacts,assertions:["original failure retained and resumed","completed request adopts without RPC","cancelled request and new episode remain separate","integer above 2^53 stays exact","individual claims separate from epoch aggregate","signed treasury movement matches original snapshots","returned archive preserves original full source","cold recipient replays original request","expired source produces explicit gap","archive mutation rejected","original XDR type drift excluded from financial totals","missing interval cannot join different request episodes","pricing advances observed episode range","resealed child cannot erase an accepted original command","received unfinished capture continues with original intent and retained page evidence"],providerCalls:0,contractWrites:0};
  await save("COMPLETE.json",result);console.log(canonical(result));
 }finally{if(store)await store.close();await owner.release();}
}
main().catch(e=>{console.error(e.stack||e.message);process.exitCode=1;});
