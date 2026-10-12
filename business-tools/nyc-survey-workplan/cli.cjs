#!/usr/bin/env node
"use strict";
const fs=require("node:fs/promises"),path=require("node:path"),http=require("node:http"),crypto=require("node:crypto");
const C=require("./core.cjs"),B=require("./bundle.cjs");
const applicationNames=["index.html","style.css","rules.js","core.cjs","bundle.cjs","app.js","cli.cjs","README.md","SOURCE_NOTES.md"];
function args(argv){
  const [command="help",...tokens]=argv,result={command};
  for(let i=0;i<tokens.length;i++){const token=tokens[i];if(!token.startsWith("--"))throw Error("Unexpected argument: "+token);const name=token.slice(2);if(!name||Object.prototype.hasOwnProperty.call(result,name))throw Error("Duplicate or invalid option: "+token);if(name==="force")result[name]=true;else{if(i+1>=tokens.length||tokens[i+1].startsWith("--"))throw Error("Missing value for "+token);result[name]=tokens[++i];}}
  const options={help:[],init:["out","id","title","at","force"],inspect:["workplan"],export:["workplan","out","force"],verify:["bundle"],receive:["bundle","out"],serve:["host","port","workplan"]};
  if(!options[command])throw Error("Unknown command: "+command);
  for(const key of Object.keys(result))if(key!=="command"&&!options[command].includes(key))throw Error("Unknown "+command+" option: --"+key);
  return result;
}
function required(a,name){if(!a[name])throw Error("--"+name+" is required.");return a[name];}
function print(value){process.stdout.write(JSON.stringify(value,null,2)+"\n");}
async function exists(file){try{await fs.lstat(file);return true;}catch(e){if(e.code==="ENOENT")return false;throw e;}}
async function readPlan(file){const stat=await fs.stat(file);if(stat.size>16*1024*1024)throw Error("Workplan JSON exceeds 16 MiB.");return C.validateWorkplan(JSON.parse(await fs.readFile(file,"utf8")));}
async function application(){const entries=await Promise.all(applicationNames.map(async name=>[name,await fs.readFile(path.join(__dirname,name),"utf8")]));return Object.fromEntries(entries);}
async function syncDirectory(directory){const handle=await fs.open(directory,"r");try{await handle.sync();}finally{await handle.close();}}
async function durableMkdir(directory){
  const target=path.resolve(directory),first=await fs.mkdir(target,{recursive:true});
  if(first){const stop=path.dirname(path.resolve(first));for(let current=target;;current=path.dirname(current)){await syncDirectory(current);if(current===stop||current===path.dirname(current))break;}}
}
async function syncedFile(file,data){const handle=await fs.open(file,"wx",0o600);try{await handle.writeFile(data);await handle.sync();}finally{await handle.close();}}
async function atomicFile(file,data,force=false){
  const target=path.resolve(file);await durableMkdir(path.dirname(target));
  if(!force&&await exists(target))throw Error("Output already exists; choose another path or pass --force.");
  const temporary=target+".tmp-"+crypto.randomUUID();try{await syncedFile(temporary,data);if(force)await fs.rename(temporary,target);else{await fs.link(temporary,target);await fs.unlink(temporary);}await syncDirectory(path.dirname(target));}catch(e){await fs.unlink(temporary).catch(()=>{});throw e;}
  return target;
}
async function verified(input){
  const data=Buffer.isBuffer(input)?input:await fs.readFile(input);if(data.length>64*1024*1024)throw Error("Bundle exceeds 64 MiB.");
  const result=await B.verify(data),texts=B.texts(result.entries),calculation=C.verifyExports(result.workplan,texts);
  for(const name of applicationNames)if(!result.entries["application/"+name])throw Error("Complete application member is missing: "+name);
  if(!result.entries["standalone.html"])throw Error("Standalone application is missing.");
  const trusted=await application(),expectedNames=new Set(["bundle-manifest.json","standalone.html",...Object.keys(C.exportsFor(calculation.workplan)),...applicationNames.map(name=>"application/"+name)]);
  for(const name of Object.keys(result.entries))if(!expectedNames.has(name))throw Error("Unexpected complete-project member: "+name);
  for(const name of applicationNames)if(texts["application/"+name]!==trusted[name])throw Error("Application source differs from this trusted receiver: "+name+". Use the matching reviewed application edition, or import workplan.json into the current application.");
  if(texts["standalone.html"]!==B.standalone(trusted,calculation.workplan))throw Error("Standalone application differs from the verified workplan and trusted source.");
  return{...result,texts,workplan:calculation.workplan,bundle_sha256:await B.hash(data),bundle_bytes:data.length};
}
function receipt(result){return{schema:"nyc-survey-workplan-receiving/v1",workplan_id:result.workplan.workplan_id,revision:result.workplan.revision,rules_version:result.workplan.rules_version,bundle_bytes:result.bundle_bytes,bundle_sha256:result.bundle_sha256,verified_members:Object.keys(result.entries).length,recomputed_exports:Object.keys(C.exportsFor(result.workplan)).length};}
async function receive(a){
  const result=await verified(required(a,"bundle")),destination=path.resolve(required(a,"out"));
  if(await exists(destination))throw Error("Receiving directory already exists. Choose a new directory to preserve its contents.");
  await durableMkdir(path.dirname(destination));
  const staging=await fs.mkdtemp(path.join(path.dirname(destination),".nyc-workplan-receive-")),directories=new Set([staging]);
  try{
    for(const [name,value]of Object.entries(result.entries)){const target=path.join(staging,...name.split("/"));await fs.mkdir(path.dirname(target),{recursive:true});directories.add(path.dirname(target));await syncedFile(target,value);}
    const record={...receipt(result),received_at:new Date().toISOString(),source_bundle:path.resolve(a.bundle)};
    await syncedFile(path.join(staging,"receiving.json"),JSON.stringify(record,null,2)+"\n");
    for(const directory of [...directories].sort((a,b)=>b.length-a.length))await syncDirectory(directory);
    if(await exists(destination))throw Error("Receiving directory appeared during preparation. Existing contents were preserved.");
    await fs.rename(staging,destination);await syncDirectory(path.dirname(destination));
    print({...record,directory:destination,continue_command:"node "+path.join(destination,"application","cli.cjs")+" serve --workplan "+path.join(destination,"workplan.json")});
  }catch(e){await fs.rm(staging,{recursive:true,force:true});throw e;}
}
async function serve(a){
  const host=a.host||"127.0.0.1";if(!["127.0.0.1","localhost","::1"].includes(host))throw Error("The local workplan server binds only to loopback.");
  const portText=a.port===undefined?"8768":a.port;if(!/^\d+$/.test(portText)||Number(portText)>65535)throw Error("--port must be 0–65535.");
  const source=await application(),plan=a.workplan?await readPlan(a.workplan):null;
  const index=plan?B.standalone(source,plan):source["index.html"];
  const mime={".html":"text/html; charset=utf-8",".css":"text/css; charset=utf-8",".js":"text/javascript; charset=utf-8",".cjs":"text/javascript; charset=utf-8",".md":"text/plain; charset=utf-8"};
  const server=http.createServer((req,res)=>{
    try{
      if(!["GET","HEAD"].includes(req.method)){res.writeHead(405,{"Allow":"GET, HEAD"});res.end();return;}
      const url=new URL(req.url,"http://localhost"),name=decodeURIComponent(url.pathname).replace(/^\//,"")||"index.html";
      if(name==="favicon.ico"){res.writeHead(204);res.end();return;}
      if(name!=="index.html"&&!applicationNames.includes(name)){res.writeHead(404);res.end("Not found\n");return;}
      const content=name==="index.html"?index:source[name],data=Buffer.from(content,"utf8");
      res.writeHead(200,{"Content-Type":mime[path.extname(name)]||"text/plain; charset=utf-8","Content-Length":data.length,"Cache-Control":"no-store","X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer"});
      res.end(req.method==="HEAD"?undefined:data);
    }catch(e){res.writeHead(400);res.end("Invalid request\n");}
  });
  await new Promise((resolve,reject)=>{server.once("error",reject);server.listen(Number(portText),host,resolve);});
  const address=server.address(),displayHost=address.address.includes(":")?"["+address.address+"]":address.address;
  print({server:"NYC Survey Workplan",url:"http://"+displayHost+":"+address.port+"/",workplan_id:plan?plan.workplan_id:null,revision:plan?plan.revision:null,source_files:applicationNames.length});
  function close(){server.close(()=>process.exit(0));setTimeout(()=>process.exit(1),5000).unref();}
  process.once("SIGINT",close);process.once("SIGTERM",close);
}
async function main(){
  const a=args(process.argv.slice(2));
  if(a.command==="help"){process.stdout.write(
    "NYC Survey Workplan\n\n"+
    "node cli.cjs init --out workplan.json [--id ID] [--title TITLE] [--at ISO_UTC]\n"+
    "node cli.cjs inspect --workplan workplan.json\n"+
    "node cli.cjs export --workplan workplan.json --out workplan.zip\n"+
    "node cli.cjs verify --bundle workplan.zip\n"+
    "node cli.cjs receive --bundle workplan.zip --out received\n"+
    "node cli.cjs serve [--workplan workplan.json] [--port 8768]\n\n"+
    "init and export preserve existing outputs unless --force is explicit.\n"+
    "receive always requires a new output directory. Export/reopen retain identity and revision.\n");return;}
  if(a.command==="init"){
    const plan=C.newWorkplan({id:a.id||"workplan-"+crypto.randomUUID(),title:a.title||"NYC survey workplan",at:a.at||new Date().toISOString()});
    const file=await atomicFile(required(a,"out"),JSON.stringify(plan,null,2)+"\n",a.force);
    print({file,workplan_id:plan.workplan_id,revision:plan.revision,rate_inputs:0,schedule_items:C.rules.catalog.length});return;
  }
  if(a.command==="inspect"){print(C.inspect(await readPlan(required(a,"workplan"))));return;}
  if(a.command==="export"){
    const plan=await readPlan(required(a,"workplan")),sources=await application(),result=await B.create(plan,C.exportsFor(plan),sources);
    const checked=await verified(Buffer.from(result.bytes)),output=await atomicFile(required(a,"out"),Buffer.from(result.bytes),a.force);
    print({...receipt(checked),file:output});return;
  }
  if(a.command==="verify"){print(receipt(await verified(required(a,"bundle"))));return;}
  if(a.command==="receive"){await receive(a);return;}
  if(a.command==="serve"){await serve(a);return;}
}
main().catch(error=>{process.stderr.write(JSON.stringify({error:error.message})+"\n");process.exitCode=1;});
