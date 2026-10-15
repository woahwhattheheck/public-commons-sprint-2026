"use strict";
const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto");
const C=require("../order-review-core.cjs");
const sha=s=>crypto.createHash("sha256").update(s).digest("hex");
const h=fs.readFileSync(path.join(__dirname,"../Order_Exception_Review_Desk.html"),"utf8");
const writing=h.slice(h.indexOf("function formKey()"),h.indexOf("const originalRender=render;"));
(async()=>{
 for(const raw of ['[{"order":9007199254740993}]','[{"order":"x","order":"y"}]','[{"qty":1.000000000000000001}]']){
  let caught=false;try{C.parse(raw,"json");}catch{caught=true;}if(!caught)throw Error("Lossy JSON accepted");
 }
 C.parse('[{"order":"9007199254740993","qty":"1.25"}]',"json");
 let saved=null,gate=null,release=null,writes=0,seq=0;
 const elements={},view={querySelectorAll:()=>Object.values(elements),contains:x=>Object.values(elements).includes(x)};
 const $=id=>id==="view"?view:elements[id]||null;
 const save=async(s,expected)=>{if((saved?saved.revision:0)!==expected)throw Error("Stale storage revision");writes++;if(gate)await gate;saved=C.copy(s);};
 const api=new Function("C","$","save","uuid","now","status","refreshList","setTimeout","clearTimeout","run","hashRaw",
 'let state=C.create({id:"draft-course",name:"Draft course",at:"2026-10-15T05:40:00Z"}),persisted=0,dirty=false,tab="sources",viewSource="source-before",selectedReview="",page=0,query="",busy=false,drafts=C.copy(state.writing),writingDirty=false,writingTimer=null,writingSaving=null;\n'+writing+
 '\nreturn{captureDraft,flushWriting,get:()=>({state:C.copy(state),drafts:C.copy(drafts),writingDirty,dirty,persisted}),switchTo:(t,s,r)=>{tab=t;viewSource=s;selectedReview=r;},pending:f=>{drafts.pending_source=f;writingDirty=true;}};'
 )(C,$,save,()=>"draft-event-"+(++seq),()=>"2026-10-15T05:40:00Z",()=>{},async()=>{},()=>1,()=>{},async f=>f(),async raw=>sha(raw));
 elements["map-fields"]={id:"map-fields",type:"textarea",value:"quantity=Qty\nunfinished = "};
 elements["map-company"]={id:"map-company",type:"text",value:"North "};
 elements["source-select"]={id:"source-select",type:"select-one",value:"source-other"};
 api.captureDraft();await api.flushWriting();
 if(saved.writing.forms["sources:source-before"]["map-fields"]!=="quantity=Qty\nunfinished = "||"source-select"in saved.writing.forms["sources:source-before"])throw Error("Raw mapping/view preservation failed");
 for(const k of Object.keys(elements))delete elements[k];api.switchTo("reviews","","review-a");
 elements["decision-proposal"]={id:"decision-proposal",type:"textarea",value:"Partial new disposition"};
 elements["decision-reason"]={id:"decision-reason",type:"textarea",value:"Not finished..."};
 gate=new Promise(r=>release=r);api.captureDraft();const flushing=api.flushWriting();await Promise.resolve();
 elements["decision-proposal"].value="Latest typing while save is in flight";api.captureDraft();release();gate=null;await flushing;
 if(saved.writing.forms["reviews:review-a"]["decision-proposal"]!=="Latest typing while save is in flight"||!saved.writing.forms["sources:source-before"])throw Error("In-flight writing lost");
 const pending=Buffer.from('Order,Line\n"invalid');api.pending({filename:"unfinished.csv",bytes:pending.length,base64:pending.toString("base64"),sha256:sha(pending)});await api.flushWriting();C.validate(saved);
 if(saved.writing.pending_source.base64!==pending.toString("base64"))throw Error("Pending original lost");
 const writingResult={environment:"Production unfinished-writing controller with explicit DOM/storage/timer adapters",strict_json:"duplicate keys and lossy numeric cells rejected",writes,revision:saved.revision,writing_sha256:sha(C.stable(saved.writing)),retained_forms:Object.keys(saved.writing.forms),pending_file:saved.writing.pending_source.filename};
 saved=null;writes=0;gate=new Promise(r=>release=r);
 const mutationStart=h.indexOf("async function mutate(action)"),mutationEnd=h.indexOf("\nasync function ",mutationStart+10);
 const mutation=h.slice(mutationStart,mutationEnd);
 const mutateAPI=new Function("C","$","save","uuid","now","status","refreshList","setTimeout","clearTimeout","run","hashRaw","render",
 'let state=C.create({id:"mutate-course",name:"Mutation course",at:"2026-10-15T05:40:00Z"}),persisted=0,dirty=false,tab="reviews",viewSource="",selectedReview="review-a",page=0,query="",busy=false,drafts=C.copy(state.writing),writingDirty=false,writingTimer=null,writingSaving=null;\n'+writing+'\n'+mutation+
 '\nreturn{captureDraft,flushWriting,mutate,get:()=>({state:C.copy(state),drafts:C.copy(drafts)})};'
 )(C,$,save,()=>"mutate-event-"+(++seq),()=>"2026-10-15T05:40:00Z",()=>{},async()=>{},()=>1,()=>{},async f=>f(),async raw=>sha(raw),()=>{});
 for(const k of Object.keys(elements))delete elements[k];
 const accepted=mutateAPI.mutate({type:"rename",name:"Accepted operation"});
 await Promise.resolve();await Promise.resolve();
 elements["decision-proposal"]={id:"decision-proposal",type:"textarea",value:"New typing during accepted-operation save"};
 mutateAPI.captureDraft();release();gate=null;await accepted;
 if(saved.writing.forms["reviews:review-a"]["decision-proposal"]!=="New typing during accepted-operation save")throw Error("Accepted operation cleared newer writing");
 process.stdout.write(JSON.stringify({writing:writingResult,mutation:{environment:"Actual mutate plus unfinished-writing controller with explicit DOM/storage/timer adapters",writes,revision:saved.revision,retained:saved.writing.forms["reviews:review-a"]}},null,2)+"\n");
})().catch(e=>{process.stderr.write(e.stack+"\n");process.exitCode=1;});
