#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import "./core.js";
const R=globalThis.RainfallReview;
const [command,...words]=process.argv.slice(2);
const args={};for(let i=0;i<words.length;i+=2){if(!words[i].startsWith("--")||!words[i+1])throw Error("Use --option value pairs.");args[words[i].slice(2)]=words[i+1];}
const json=file=>fs.readFile(file,"utf8").then(JSON.parse);
async function save(file,value){await fs.mkdir(path.dirname(path.resolve(file)),{recursive:true});const tmp=file+".tmp";await fs.writeFile(tmp,JSON.stringify(value,null,2)+"\n");await fs.rename(tmp,file);}
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const root="https://atlas.3riverswetweather.org/rainfall/";
function sameOrigin(url){const parsed=new URL(url,root);if(parsed.origin!==new URL(root).origin || parsed.protocol!=="https:")throw Error("A job URL must remain on the configured API origin.");return parsed.href;}
async function get(url,init={}) {
 const u=new URL(url);if(u.protocol!=="https:")throw Error("HTTPS is required for downloads.");
 const response=await fetch(u,{...init,redirect:"error",signal:AbortSignal.timeout(60000)});
 if(!response.ok){const e=Error("HTTP "+response.status+" from "+u.origin);e.retryAfter=Number(response.headers.get("Retry-After"))||null;throw e;}
 return response.text();
}
async function capture(){
 if(!args.out)throw Error("capture needs --out.");
 if(args.units && args.units!=="inches")throw Error("The configured 3RWW API returns inches; --units must be inches.");
 let task;
 const taskPath=args.out+".job.json";
 if(args.resume==="yes"){task=await json(taskPath);if(task.schema!=="rainfall-capture-job/v1")throw Error("Unknown capture job.");}
 else{
  const sensors=String(args.sensors||"").split(",").map(x=>x.trim()).filter(Boolean);
  const interval=Number(args.interval||15),product=args.product||"historic15",sensor=args.sensor||"gauge";
  const metadata={label:args.label||product+" "+args.start,product,sensor_type:sensor,sensors,start:args.start,end:args.end,interval_minutes:interval,units:"inches",timestamp_label:args["timestamp-label"]||"end",retrieved_at:new Date().toISOString(),source_url:root+"v2/"+sensor+"/"+product+"/"};
  R.metadata(metadata);
  if(product==="historic5"&&interval!==5)throw Error("historic5 requires a 5 minute interval.");
  if(interval===5&&product!=="historic5")throw Error("Use historic5 for five-minute data.");
  const request={start_dt:metadata.start,end_dt:metadata.end,f:"sensor_columnar",rollup:interval===60?"Hourly":interval+"-minute",delivery:"artifact",[sensor==="gauge"?"gauges":"pixels"]:sensors.join(",")};
  task={schema:"rainfall-capture-job/v1",metadata,request,url:metadata.source_url,submitted:false,created_at:new Date().toISOString()};
  try{await fs.access(taskPath);throw Error("An existing job file is present. Resume it or select a new output path.");}catch(e){if(e.code!=="ENOENT")throw e;}
  await save(taskPath,task);
 }
 if(task.metadata?.units!=="inches")throw Error("The retained job must record the configured API units as inches.");
 const started=Date.now(),maxMs=Number(args["max-minutes"]||15)*60000;
 if(!Number.isFinite(maxMs)||maxMs<60000)throw Error("max-minutes must be at least one.");
 while(Date.now()-started<maxMs){
  let text;
  try{text=await get(sameOrigin(task.url),{method:"POST",headers:{"Content-Type":"application/json"},...(task.submitted?{}:{body:JSON.stringify(task.request)})});}
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
  if(envelope.meta?.artifactUrl){
   try{text=await get(envelope.meta.artifactUrl);}
   catch(e){
    const refreshed=JSON.parse(await get(sameOrigin(task.url),{method:"POST"}));
    const inlineUrl=refreshed.meta?.inlineUrl||envelope.meta?.inlineUrl;
    if(refreshed.meta?.artifactUrl){try{text=await get(refreshed.meta.artifactUrl);}catch(e){if(!inlineUrl)throw e;text=await get(sameOrigin(inlineUrl));}}
    else if(inlineUrl)text=await get(sameOrigin(inlineUrl));
    else throw e;
   }
  }
  const metadata={...task.metadata,retrieved_at:new Date().toISOString()};
  const result={schema:"rainfall-release/v1",metadata,raw_text:text,raw_sha256:R.sha256Text(text),request:task.request};
  await save(args.out,result);
  let reviewed;try{reviewed=R.release(result);}catch(e){throw Error(e.message+" Original provider response was saved in "+args.out+" for correction and continued review.");}
  task.completed_at=metadata.retrieved_at;task.output=args.out;task.raw_sha256=result.raw_sha256;delete task.last_error;await save(taskPath,task);
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
