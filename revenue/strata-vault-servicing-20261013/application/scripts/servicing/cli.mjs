#!/usr/bin/env node
import * as fs from "node:fs/promises";
import path from "node:path";
import { openStore } from "./store.mjs";
import { writeExact } from "./files.mjs";
import { canonical, parseJSON, inspectArchive, deriveHistory, investorStatement, statementCSV, reportCSV } from "../../app-lib/servicing/model.mjs";

function options(argv){const out={};for(let i=0;i<argv.length;i+=2){const k=argv[i];if(!k?.startsWith("--")||argv[i+1]===undefined||Object.hasOwn(out,k.slice(2)))throw new Error("Use each --option value exactly once.");out[k.slice(2)]=argv[i+1];}return out;}
function required(o,k){if(!o[k])throw new Error("Required --"+k);return o[k];}
function exact(o,keys){for(const k of Object.keys(o))if(!keys.includes(k))throw new Error("Unknown option --"+k);}
function number(v){if(v===undefined)return undefined;if(!/^(0|[1-9][0-9]*)$/.test(v)||!Number.isSafeInteger(Number(v)))throw new Error("Use exact nonnegative whole ledger/page values.");return Number(v);}
async function read(file){const st=await fs.lstat(file);if(!st.isFile()||st.isSymbolicLink()||st.size>134217728)throw new Error("Select an ordinary complete source file up to 128 MiB.");return fs.readFile(file,"utf8");}
async function publish(file,value){if(!path.isAbsolute(file))throw new Error("Select an absolute output path.");await writeExact(file,Buffer.from(value));}
async function main(){
 const [command,...args]=process.argv.slice(2),o=options(args);let store;
 const abort=new AbortController();const stop=()=>abort.abort(new Error("Original servicing operation interrupted."));process.once("SIGINT",stop);process.once("SIGTERM",stop);
 try{
  if(command==="inspect"||command==="statement"||command==="report"){
   exact(o,command==="statement"?["archive","controller","from-ledger","to-ledger","format","out"]:command==="report"?["archive","view","format","out"]:["archive"]);
   const archive=await inspectArchive(await read(required(o,"archive"))),report=deriveHistory(archive);
   if(command==="inspect"){console.log(canonical({archiveId:archive.id,archiveSha256:archive.sha256,binding:archive.binding,events:report.events.length,requests:report.requests.length,coverage:report.coverage,warnings:report.warnings}));return;}
   const format=o.format??"json";if(!["json","csv"].includes(format))throw new Error("Select json or csv.");
   const value=command==="statement"?investorStatement(report,{controller:required(o,"controller"),...(o["from-ledger"]?{fromLedger:number(o["from-ledger"])}:{}),...(o["to-ledger"]?{toLedger:number(o["to-ledger"])}:{})}):report;
   await publish(required(o,"out"),format==="json"?canonical(value)+"\n":command==="statement"?statementCSV(value):reportCSV(value,o.view??"activity"));
   console.log(canonical({path:o.out,archiveSha256:archive.sha256}));return;
  }
  const allowed={init:["directory","binding","request-id"],collect:["directory","request-id","to-ledger","max-pages"],snapshot:["directory","request-id","label"],note:["directory","request-id","file"],export:["directory","out"],receive:["directory","archive","request-id"],status:["directory"]};
  if(!allowed[command])throw new Error("Commands: init, collect, snapshot, note, export, receive, status, inspect, statement, report. See docs/SERVICING.md.");
  exact(o,allowed[command]);store=await openStore(required(o,"directory"));let result;
  if(command==="init")result=await store.initialize(parseJSON(await read(required(o,"binding"))),required(o,"request-id"));
  if(command==="collect")result=await store.collect(required(o,"request-id"),{toLedger:number(o["to-ledger"])??null,maxPages:number(o["max-pages"])??100},{signal:abort.signal});
  if(command==="snapshot")result=await store.snapshot(required(o,"request-id"),o.label??"",{signal:abort.signal});
  if(command==="note")result=await store.note(required(o,"request-id"),await read(required(o,"file")));
  if(command==="export")result=await store.export(required(o,"out"));
  if(command==="receive")result=await store.receive(await read(required(o,"archive")),required(o,"request-id"));
  if(command==="status")result={workspace:store.config(),captures:store.list("captures"),sources:store.list("sources").map(s=>({id:s.id,method:s.request.method,bytes:s.bytes})),attempts:store.list("attempts")};
  console.log(canonical(result));
 } finally {if(store)await store.close();process.removeListener("SIGINT",stop);process.removeListener("SIGTERM",stop);}
}
main().catch(error=>{console.error(String(error.message));process.exitCode=1;});
