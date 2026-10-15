#!/usr/bin/env node
import path from "node:path";
import {fileURLToPath} from "node:url";
import {runtime} from "./runtime.mjs";
import {ownedDirectory,writeMember} from "./io.mjs";
import {readBytes,readText,completeSource} from "./source.mjs";
import {createPlanningAPI} from "../planning/core.mjs";
import {buildExample} from "../planning/example.mjs";
import {receivingCourse,capacityCourse} from "../planning/course.mjs";
import {reportMarkdown,reportHTML,comparisonMarkdown,comparisonHTML,reconciliationCSV} from "../planning/report.mjs";
const api=createPlanningAPI(runtime),argv=process.argv.slice(2),command=argv.shift(),args={};
for(let i=0;i<argv.length;i+=2){if(!argv[i].startsWith("--")||argv[i+1]===undefined||args[argv[i].slice(2)]!==undefined)throw Error("Arguments must be unique --name value pairs");args[argv[i].slice(2)]=argv[i+1];}
const allowed=new Set(["workspace","input","file","name","type","source-id","format","array-pointer","out","at","operation","parent","prepared-by","note","reviewer","decision","left","right","title","proposal","comparison-sha","discipline","reason","jobs"]);
for(const k of Object.keys(args))if(!allowed.has(k))throw Error("Unknown argument --"+k);
const required=k=>{if(!args[k])throw Error("Required --"+k);return args[k];};
const source=completeSource(path.resolve(path.dirname(fileURLToPath(import.meta.url)),".."));
let w=args.workspace?api.importWorkspace(readText(args.workspace,128*1024*1024)):null,input=args.input?api.parseJSON(readText(args.input,8*1024*1024)):null,result=null,report=null,comparison=null;
const meta=()=>({operationId:required("operation"),expectedRoot:w.rootSha256,at:required("at")});
if(command==="blank"){w=api.createWorkspace({title:args.title||"Planning review workspace",createdAt:required("at")});input=api.blankInput();}
else if(command==="demo"){const d=buildExample(runtime);w=d.workspace;result={receivedEditionId:d.receivedEditionId,correctedEditionId:d.correctedEditionId,proposalId:d.proposalId};comparison=api.compare(w,d.receivedEditionId,d.correctedEditionId);input=d.input;}
else if(command==="course"){const r=receivingCourse(runtime);w=r.workspace;result={...r,workspace:undefined,authoredWorkspace:undefined};}
else if(command==="capacity"){const r=capacityCourse(runtime,args.jobs?Number(args.jobs):250,0,p=>process.stderr.write(JSON.stringify(p)+"\n"));w=r.workspace;result={...r,workspace:undefined};}
else if(command==="source"){if(!w)throw Error("--workspace required");const b=readBytes(required("file"),20*1024*1024),r=api.addSource(w,{name:args.name||path.basename(args.file),mediaType:args.type||"application/octet-stream",content_base64:runtime.toBase64(b)},meta());w=r.workspace;result={sourceId:r.sourceId};}
else if(command==="inspect"){if(!w)throw Error("--workspace required");result=api.inspectSource(w,required("source-id"),{format:args.format||"csv",arrayPointer:args["array-pointer"]||""});}
else if(command==="analyse"){if(!w||!input)throw Error("--workspace and --input required");report=api.analyse(input,w);}
else if(command==="freeze"){if(!w||!input)throw Error("--workspace and --input required");const r=api.saveEdition(w,{name:required("name"),input,parentEditionId:args.parent||null,preparedBy:args["prepared-by"]||"",note:args.note||""},meta());w=r.workspace;report=r.report;result={editionId:r.editionId};}
else if(command==="compare"){if(!w)throw Error("--workspace required");comparison=api.compare(w,required("left"),required("right"));result=comparison;}
else if(command==="propose"){if(!w)throw Error("--workspace required");const r=api.propose(w,{name:required("name"),baseEditionId:required("left"),candidateEditionId:required("right"),preparedBy:required("prepared-by"),reason:required("reason")},meta());w=r.workspace;result={proposalId:r.proposalId,proposal:r.proposal};comparison=r.proposal.comparison;}
else if(command==="review"){if(!w)throw Error("--workspace required");w=api.review(w,{proposalId:required("proposal"),comparisonSha256:required("comparison-sha"),discipline:required("discipline"),decision:required("decision"),reviewer:required("reviewer"),note:required("note")},meta());result=api.proposalStatus(w,args.proposal);}
else if(command==="handoff"){if(!w)throw Error("--workspace required");result=api.handoff(w,required("proposal"));}
else if(command==="receive"){if(!w)throw Error("--workspace required");}
else throw Error("Commands: blank, demo, source, inspect, analyse, freeze, compare, propose, review, handoff, receive, course, capacity");
const exported=api.exportWorkspace(w),sourceText=JSON.stringify(source)+"\n";
const identity=runtime.sha256(api.canonical({command,args:Object.fromEntries(Object.entries(args).filter(([k])=>k!=="out")),workspaceSha256:exported.sha256,inputSha256:input?runtime.sha256(api.canonical(input)):null,sourceSha256:runtime.sha256(sourceText)}));
const root=ownedDirectory(required("out"),identity),written=[],emit=(name,content)=>written.push(writeMember(root,name,content));
emit("Planning_Run_Workspace.json",exported.content);emit("Planning_Complete_Source.json",sourceText);
if(input)emit("Selected_Input.json",JSON.stringify(input,null,2)+"\n");
if(result)emit("Result.json",JSON.stringify(result)+"\n");
function reports(prefix,r){emit(prefix+"Report.json",JSON.stringify(r)+"\n");emit(prefix+"Report.md",reportMarkdown(r));emit(prefix+"Report.html",reportHTML(r));emit(prefix+"Reconciliation.csv",reconciliationCSV(r));}
if(report)reports("preview/",report);
if(comparison){emit("Comparison.json",JSON.stringify(comparison)+"\n");emit("Comparison.md",comparisonMarkdown(comparison));emit("Comparison.html",comparisonHTML(comparison));}
for(let i=0;i<w.sources.length;i++){const s=api.readSource(w,w.sources[i].id),safe=s.name.replace(/[^A-Za-z0-9._-]/g,"_").slice(0,120)||"original";emit("originals/"+String(i+1).padStart(4,"0")+"_"+safe,runtime.fromBase64(s.content_base64));}
for(const e of w.editions){emit("editions/"+e.id+"/Input.json",JSON.stringify(e.input,null,2)+"\n");reports("editions/"+e.id+"/",e.report);}
for(const p of w.proposals){emit("proposals/"+p.id+"/Proposal.json",JSON.stringify(p)+"\n");emit("proposals/"+p.id+"/Status.json",JSON.stringify(api.proposalStatus(w,p.id))+"\n");emit("proposals/"+p.id+"/Comparison.md",comparisonMarkdown(p.comparison));emit("proposals/"+p.id+"/Comparison.html",comparisonHTML(p.comparison));}
const fresh=api.importWorkspace(readText(path.join(root,"Planning_Run_Workspace.json"),128*1024*1024));if(fresh.rootSha256!==w.rootSha256)throw Error("Materialized working record did not independently reopen");
for(const f of written){const b=readBytes(path.join(root,f.path),256*1024*1024);if(b.length!==f.bytes||runtime.sha256(b)!==f.sha256)throw Error("Materialized member differs: "+f.path);}
writeMember(root,"COMPLETE.json",JSON.stringify({schema:"tjlabs.planning-native-receiving.v1",engine:api.engine,command,identity,workspaceSha256:exported.sha256,rootSha256:w.rootSha256,files:written},null,2)+"\n");
process.stdout.write(JSON.stringify({directory:root,files:written.length,workspaceSha256:exported.sha256,rootSha256:w.rootSha256,complete:"COMPLETE.json"})+"\n");
