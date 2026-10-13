#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import {randomUUID,createHash} from "node:crypto";
import "./core.js";
const R=globalThis.RainfallReview;
const [command,...words]=process.argv.slice(2);
const args={};for(let i=0;i<words.length;i+=2){if(!words[i].startsWith("--")||!words[i+1])throw Error("Use --option value pairs.");args[words[i].slice(2)]=words[i+1];}
const json=file=>fs.readFile(file,"utf8").then(JSON.parse);
const canonical=value=>JSON.stringify(value&&typeof value==="object"?(Array.isArray(value)?value.map(x=>JSON.parse(canonical(x))):Object.fromEntries(Object.keys(value).sort().map(k=>[k,JSON.parse(canonical(value[k]))]))):value);
async function save(file,value,{immutable=false}={}){
 file=path.resolve(file);await fs.mkdir(path.dirname(file),{recursive:true});
 const raw=Buffer.from(JSON.stringify(value,null,2)+"\n"),tmp=file+".writing-"+randomUUID();let handle,created=false;
 try{
  handle=await fs.open(tmp,"wx",0o600);created=true;await handle.writeFile(raw);await handle.sync();await handle.close();handle=null;
  if(immutable){try{await fs.link(tmp,file);}catch(e){if(e.code!=="EEXIST")throw e;const retained=await fs.readFile(file);if(!retained.equals(raw))throw Error("The original completed output already exists with different bytes: "+file);}}
  else await fs.rename(tmp,file);
 }finally{if(handle)await handle.close();if(created)await fs.rm(tmp,{force:true});}
}
async function exists(file){try{await fs.access(file);return true;}catch(e){if(e.code==="ENOENT")return false;throw e;}}
const exactBytes=body=>({bytes:body.length,sha256:createHash("sha256").update(body).digest("hex")});
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const root="https://atlas.3riverswetweather.org/rainfall/";
function sameOrigin(url){const parsed=new URL(url,root);if(parsed.origin!==new URL(root).origin || parsed.protocol!=="https:")throw Error("A job URL must remain on the configured API origin.");return parsed.href;}
async function get(url,init={},retain=null) {
 const u=new URL(url);if(u.protocol!=="https:")throw Error("HTTPS is required for downloads.");
 const exchange={sequence:null,requested_at:new Date().toISOString(),request:{url:u.href,method:init.method||"GET",headers:init.headers||{},body:init.body??null}};
 let response,raw;
 try{
  response=await fetch(u,{...init,redirect:"error",signal:AbortSignal.timeout(60000)});
  raw=Buffer.from(await response.arrayBuffer());
  const names=["content-type","content-length","content-encoding","date","etag","last-modified","retry-after","cache-control","location","x-request-id"];
  exchange.response={url:response.url,status:response.status,status_text:response.statusText,headers:Object.fromEntries(names.filter(k=>response.headers.has(k)).map(k=>[k,response.headers.get(k)])),received_at:new Date().toISOString(),body_representation:"fetch-decoded-response-bytes",...exactBytes(raw),body_base64:raw.toString("base64")};
 }catch(e){
  exchange.error={name:e.name,message:e.message,observed_at:new Date().toISOString()};
  if(response)exchange.response={url:response.url,status:response.status,status_text:response.statusText,body_complete:false};
  if(retain)await retain(exchange);
  throw e;
 }
 if(retain)await retain(exchange);
 if(!response.ok){const e=Error("HTTP "+response.status+" from "+u.origin);e.retryAfter=Number(response.headers.get("Retry-After"))||null;throw e;}
 return new TextDecoder("utf-8",{fatal:true}).decode(raw);
}
function requestFor(metadata){
 return {start_dt:metadata.start,end_dt:metadata.end,f:"sensor_columnar",rollup:metadata.interval_minutes===60?"Hourly":metadata.interval_minutes+"-minute",delivery:"artifact",[metadata.sensor_type==="gauge"?"gauges":"pixels"]:metadata.sensors.join(",")};
}
function verifyOriginalTask(task){
 if(task.schema!=="rainfall-capture-job/v1")throw Error("Unknown capture job.");
 R.metadata(task.metadata);
 if(task.metadata.units!=="inches")throw Error("The retained job must record the configured API units as inches.");
 const endpoint=root+"v2/"+task.metadata.sensor_type+"/"+task.metadata.product+"/";
 if(task.metadata.source_url!==endpoint||canonical(task.request)!==canonical(requestFor(task.metadata)))throw Error("The saved original capture selection and request disagree.");
 sameOrigin(task.url);
}
function recoveredJobResponse(task){
 const exchanges=task.exchanges||[];
 if(!Array.isArray(exchanges))throw Error("The retained acquisition history is invalid.");
 let expectedUrl=task.metadata.source_url,submitted=false,finished=null,artifact=null;
 const sourceUrls=new Set();
 const firstPost=exchanges.find(x=>x?.request?.method==="POST");
 if(firstPost&&firstPost.request.url!==expectedUrl){
  if(!task.submitted||firstPost.request.url!==task.url)throw Error("The retained continuation differs from the original job.");
  expectedUrl=task.url;submitted=true;
 }
 for(let i=0;i<exchanges.length;i++){
  const exchange=exchanges[i];
  if(exchange?.sequence!==i+1)throw Error("The retained acquisition sequence differs.");
  const response=exchange.response;let raw=null;
  if(response?.body_base64!==undefined){
   raw=Buffer.from(response.body_base64,"base64");const actual=exactBytes(raw);
   if(actual.bytes!==response.bytes||actual.sha256!==response.sha256)throw Error("A retained response body differs from its original identity.");
  }
  const successful=response&&response.status>=200&&response.status<300&&raw!==null;
  if(exchange.request?.method==="GET"){
   if(successful&&finished!==null&&sourceUrls.has(exchange.request.url))artifact=new TextDecoder("utf-8",{fatal:true}).decode(raw);
   continue;
  }
  if(exchange.request?.method!=="POST")continue;
  if(exchange.request.url!==expectedUrl)throw Error("The retained POST differs from the current original continuation.");
  const body=exchange.request.body;
  if(submitted?body!==null&&body!==undefined:typeof body!=="string"||canonical(JSON.parse(body))!==canonical(task.request))throw Error("The retained POST selection differs.");
  if(!successful)continue;
  const text=new TextDecoder("utf-8",{fatal:true}).decode(raw);
  let envelope;try{envelope=JSON.parse(text);}catch{continue;}
  if(envelope.meta?.jobUrl){expectedUrl=sameOrigin(envelope.meta.jobUrl);submitted=true;}
  if(envelope.status==="finished"){finished=text;artifact=null;}
  else if(["queued","started"].includes(envelope.status)){
   if(!submitted)throw Error("The retained queued job has no continuation URL. Preserve its original receipt before continuing.");
   finished=null;artifact=null;sourceUrls.clear();
  }
  if(finished!==null){
   if(envelope.meta?.artifactUrl){const url=new URL(envelope.meta.artifactUrl);if(url.protocol!=="https:")throw Error("The retained artifact URL must use HTTPS.");sourceUrls.add(url.href);}
   if(envelope.meta?.inlineUrl)sourceUrls.add(sameOrigin(envelope.meta.inlineUrl));
  }
 }
 if(submitted){task.url=expectedUrl;task.submitted=true;}
 return {envelope:finished,artifact};
}
async function completedCapture(task,taskPath,output){
 if(!await exists(output)){
  if(task.completed_at)throw Error("The completed original capture is missing: "+output+". Restore that saved source before continuing.");
  return false;
 }
 const retained=await json(output);const reviewed=R.release(retained);
 const original={...task.metadata},actual={...retained.metadata};delete original.retrieved_at;delete actual.retrieved_at;
 if(canonical(original)!==canonical(actual)||canonical(task.request)!==canonical(retained.request)||task.raw_sha256&&task.raw_sha256!==reviewed.fingerprint)throw Error("The existing output belongs to a different original capture. Preserve it and use the matching source.");
 task.completed_at=task.completed_at||retained.metadata.retrieved_at;task.output=path.resolve(output);task.raw_sha256=reviewed.fingerprint;delete task.last_error;await save(taskPath,task);
 process.stdout.write(JSON.stringify({capture:output,sha256:reviewed.fingerprint,reopened:true,sensors:reviewed.summaries,warnings:reviewed.warnings},null,2)+"\n");return true;
}

async function capture(){
 if(!args.out)throw Error("capture needs --out.");
 if(args.units && args.units!=="inches")throw Error("The configured 3RWW API returns inches; --units must be inches.");
 let task,recovered=null,recoveredArtifact=null;
 const taskPath=args.out+".job.json";
 if(args.resume==="yes"){task=await json(taskPath);verifyOriginalTask(task);const prior=recoveredJobResponse(task);recovered=prior.envelope;recoveredArtifact=prior.artifact;if(await completedCapture(task,taskPath,args.out))return;}
 else{
  const sensors=String(args.sensors||"").split(",").map(x=>x.trim()).filter(Boolean);
  const interval=Number(args.interval||15),product=args.product||"historic15",sensor=args.sensor||"gauge";
  const metadata={label:args.label||product+" "+args.start,product,sensor_type:sensor,sensors,start:args.start,end:args.end,interval_minutes:interval,units:"inches",timestamp_label:args["timestamp-label"]||"end",retrieved_at:new Date().toISOString(),source_url:root+"v2/"+sensor+"/"+product+"/"};
  R.metadata(metadata);
  if(product==="historic5"&&interval!==5)throw Error("historic5 requires a 5 minute interval.");
  if(interval===5&&product!=="historic5")throw Error("Use historic5 for five-minute data.");
  const request=requestFor(metadata);
  task={schema:"rainfall-capture-job/v1",metadata,request,url:metadata.source_url,submitted:false,created_at:new Date().toISOString(),exchanges:[]};
  try{await fs.access(taskPath);throw Error("An existing job file is present. Resume it or select a new output path.");}catch(e){if(e.code!=="ENOENT")throw e;}
  if(await exists(args.out))throw Error("An existing output is present. Reopen its matching job or select a new output path.");
  await save(taskPath,task,{immutable:true});
 }
 const retain=async exchange=>{task.exchanges??=[];exchange.sequence=task.exchanges.length+1;task.exchanges.push(exchange);task.updated_at=new Date().toISOString();await save(taskPath,task);};
 const started=Date.now(),maxMs=Number(args["max-minutes"]||15)*60000;
 if(!Number.isFinite(maxMs)||maxMs<60000)throw Error("max-minutes must be at least one.");
 while(Date.now()-started<maxMs){
  let text;
  try{if(recovered!==null){text=recovered;recovered=null;}else text=await get(sameOrigin(task.url),{method:"POST",headers:{"Content-Type":"application/json"},...(task.submitted?{}:{body:JSON.stringify(task.request)})},retain);}
  catch(e){task.last_error=e.message;task.updated_at=new Date().toISOString();await save(taskPath,task);throw Error(e.message+"; capture state saved. Resume with --resume yes.");}
  const envelope=JSON.parse(text);
  task.last_status=envelope.status;task.updated_at=new Date().toISOString();
  if(envelope.meta?.jobUrl){task.url=sameOrigin(envelope.meta.jobUrl);task.submitted=true;}
  await save(taskPath,task);
  if(["queued","started"].includes(envelope.status)){
   if(!task.submitted)throw Error("The queued job has no continuation URL. Saved the response status.");
   process.stderr.write("Rainfall job "+envelope.status+"\n");await wait(2000);continue;
  }
  if(envelope.status!=="finished")throw Error("Rainfall job returned "+String(envelope.status)+".");
  if(recoveredArtifact!==null){text=recoveredArtifact;recoveredArtifact=null;}
  else if(envelope.meta?.artifactUrl){
   try{text=await get(envelope.meta.artifactUrl,{},retain);}
   catch(e){
    if(!task.submitted){
     if(!envelope.meta?.inlineUrl)throw Error(e.message+"; the provider supplied no job continuation. The original finished response is retained.");
     text=await get(sameOrigin(envelope.meta.inlineUrl),{},retain);
    }else{
     const refreshed=JSON.parse(await get(sameOrigin(task.url),{method:"POST"},retain));
     if(refreshed.meta?.artifactUrl){try{text=await get(refreshed.meta.artifactUrl,{},retain);}catch(e){const inline=refreshed.meta?.inlineUrl||envelope.meta?.inlineUrl;if(!inline)throw e;text=await get(sameOrigin(inline),{},retain);}}
     else if(refreshed.meta?.inlineUrl||envelope.meta?.inlineUrl)text=await get(sameOrigin(refreshed.meta?.inlineUrl||envelope.meta?.inlineUrl),{},retain);
     else throw e;
    }
   }
  }
  const completedAt=new Date().toISOString(),rawSha=R.sha256Text(text);
  const originalResponse=task.exchanges?.slice().reverse().find(x=>x.response?.sha256===rawSha&&x.response.status>=200&&x.response.status<300);
  const metadata={...task.metadata,retrieved_at:originalResponse?.response?.received_at||completedAt};
  const result={schema:"rainfall-release/v1",metadata,raw_text:text,raw_sha256:rawSha,request:task.request,acquisition:{schema:"rainfall-acquisition/v1",created_at:task.created_at,completed_at:completedAt,exchanges:task.exchanges||[]}};
  await save(args.out,result,{immutable:true});
  let reviewed;try{reviewed=R.release(result);}catch(e){throw Error(e.message+" Original provider response was saved in "+args.out+" for correction and continued review.");}
  task.completed_at=completedAt;task.output=args.out;task.raw_sha256=result.raw_sha256;delete task.last_error;await save(taskPath,task);
  process.stdout.write(JSON.stringify({capture:args.out,sha256:result.raw_sha256,sensors:reviewed.summaries,warnings:reviewed.warnings},null,2)+"\n");return;
 }
 throw Error("Job continues on the provider. Resume the saved job with capture --out "+args.out+" --resume yes.");
}
async function review(){
 if(!args.before||!args.out)throw Error("review needs --before capture.json --out directory; optionally --after capture.json.");
 const releases=[R.release(await json(args.before))];
 if(args.after)releases.push(R.release(await json(args.after)));
 const comparison=releases.length===2?R.compare(...releases):null;
 const notes=args.notes?await fs.readFile(args.notes,"utf8"):"";
 await fs.mkdir(args.out,{recursive:true});
 await save(path.join(args.out,"review-project.json"),R.project(releases,notes));
 await fs.writeFile(path.join(args.out,"report.html"),R.report(releases,notes));
 await save(path.join(args.out,"summary.json"),{version:R.VERSION,releases:releases.map(x=>({metadata:x.metadata,fingerprint:x.fingerprint,summaries:x.summaries,warnings:x.warnings})),comparison:comparison?{summary:comparison.summary,source_transitions:comparison.sourceTransitions}:null});
 if(comparison)await fs.writeFile(path.join(args.out,"interval-comparison.csv"),R.csv(comparison.rows));
 for(let i=0;i<releases.length;i++){
  await fs.writeFile(path.join(args.out,"release-"+(i+1)+"-coverage.csv"),R.csv(releases[i].summaries));
  await fs.writeFile(path.join(args.out,"release-"+(i+1)+"-intervals.csv"),R.csv(R.intervalRows(releases[i])));
 }
 process.stdout.write("Created review project, HTML report, summaries and CSV exports in "+args.out+"\n");
}
try {
 if(command==="capture")await capture();
 else if(command==="review")await review();
 else if(command==="bounds")process.stdout.write(await get(root+"v2/latest-observations/?format=json")+"\n");
 else if(command==="sensors")process.stdout.write(await get(root+"gauges/")+"\n");
 else throw Error("Commands: bounds | sensors | capture --start ISO --end ISO --sensors 1,2 --out release.json | review --before release.json --after newer.json --out review");
}catch(e){process.stderr.write(e.message+"\n");process.exitCode=1;}
