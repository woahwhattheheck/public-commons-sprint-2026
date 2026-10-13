const previous=load("aviary-lean-v6-controller")||load("aviary-newhost-v4-controller");
const journal={schema:"commons.aviary.native-controller.v1",operation:"AVIARY-COMPLETE-DELIVERY-6BA15-20261012",originalNativeSession:86320,originalCheckpointSha256:"c9980b4c9a7297512f221db8e23419eae983e53ba934e8e87bd82074271f1d1f",inputSha256:load("aviary-lean-v6-transport").decodedSha256,transportSha256:load("aviary-lean-v6-transport").wireSha256,sourceSha256:"ad828d5fd25c6db0488935580f8c41f52ee7b26cb16cb172ef870f1422152439",priorAdmission:previous?{startedAt:previous.startedAt,endedAt:previous.endedAt,error:previous.controllerError,session:previous.session??null}:null,calls:[],events:[],startedAt:new Date().toISOString()};
const need=(value,message)=>{if(!value)throw Error(message);};
const wire=load("aviary-lean-v6-envelope-text"),command=load("aviary-lean-v6-command");
const hash=new Function(load("sha256-utf8-code")+";return sha256utf8;")();
need(hash(wire)===journal.transportSha256,"The original complete input changed");
const hashBinarySource=load("sha256-utf8-code").replace("function sha256utf8(text)","function sha256binary(text)").replace("const utf8=unescape(encodeURIComponent(text)), n=utf8.length;","const utf8=text, n=utf8.length;");
const hashBinary=new Function(hashBinarySource+";return sha256binary;")();
const base64Decode=source=>{const alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/",clean=source;need(clean.length%4===0&&/^[A-Za-z0-9+/]*={0,2}$/.test(clean),"Invalid image base64");let bits=0,count=0,out="";for(const ch of clean){if(ch==="=")break;const v=alphabet.indexOf(ch);need(v>=0,"Invalid base64 digit");bits=(bits<<6)|v;count+=6;if(count>=8){count-=8;out+=String.fromCharCode((bits>>>count)&255);}}return out;};
let session=null,buffer="",ended=false,ready=null,paused=null;const saves=[];const preparedSaves=[];
const chunks=new Map();
const transferUrls=load("aviary-lean-v6-envelope").runtimeArchives.flatMap(x=>x.transfer?.download_url?[x.transfer.download_url]:[]);
const safeOutput=value=>transferUrls.reduce((s,url)=>s.split(url).join("[original signed transfer URL]"),String(value)).replace(/https?:\/\/[^\s"<>]+/g,url=>url.split("?")[0].split("#")[0]+(url.includes("?")?"?[private query]":""));
const publicValue=value=>{if(Array.isArray(value))return value.map(publicValue);if(value&&typeof value==="object"){const out={};for(const[k,v]of Object.entries(value))out[k]=/^(upload_url|download_url|required_headers|authorization|cookie)$/i.test(k)?"[private prepared transfer]":publicValue(v);return out;}return typeof value==="string"?safeOutput(value):value;};
const stable=value=>value&&typeof value==="object"?Array.isArray(value)?value.map(stable):Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])])):value;
const equal=(a,b)=>JSON.stringify(stable(a))===JSON.stringify(stable(b));
function resultArray(result,key){const structured=result?.structuredContent;if(structured!=null){need(Array.isArray(structured[key]),"Canonical Library structured result lacks "+key);return structured[key];}for(const item of result?.content||[]){try{const value=JSON.parse(item.text);if(Array.isArray(value?.[key]))return value[key];}catch{}}throw Error("The canonical Library result lacks "+key);}
async function servicePrepared(request){
 need(request.connector==="connector_openai_library"&&["prepare_uploads","finalize_uploads"].includes(request.tool),"Unexpected prepared Library action");
 need(typeof request.name==="string"&&request.source?.path?.startsWith("/dev/aviary-complete-final-6ba15/")&&request.source.path.split("/").pop()===request.name&&Number.isInteger(request.source.bytes)&&request.source.bytes>0&&/^[a-f0-9]{64}$/.test(request.source.sha256)&&/^[a-f0-9]{64}$/.test(request.requestSha256),"Invalid original prepared source identity");
 const rows=request.arguments?.uploads;
 need(Array.isArray(rows)&&rows.length===1&&Object.keys(request.arguments).length===1,"Prepared Library call changed its ordered source count");
 const sourceRoot=request.source.path.slice(0,request.source.path.lastIndexOf("/"));
 need(["/dev/aviary-complete-final-6ba15/checkpoints","/dev/aviary-complete-final-6ba15/deliverables"].includes(sourceRoot),"Prepared source left the original artifact roots");
 const sourceKey="aviary-prepared-source-"+request.name;
 const retainedSource=load(sourceKey);need(!retainedSource||equal(retainedSource,request.source),"Retained prepared source changed");store(sourceKey,request.source);
 if(request.tool==="prepare_uploads"){
  need(rows[0].file_name===request.name&&rows[0].file_size_bytes===request.source.bytes&&rows[0].purpose==="create_library_file"&&rows[0].workspace_path===undefined,"Prepared create source differs");
 }else{
  const prepared=load(sourceKey+"-prepared");
  need(Array.isArray(prepared)&&equal(prepared,rows),"Finalization changed the exact original prepared objects");
 }
 const key="aviary-prepared-call-"+request.requestSha256;
 const bound={operation:journal.operation,source:request.source,connector:request.connector,tool:request.tool,arguments:request.arguments};
 const before=load(key+"-request");need(!before||equal(before,bound),"An existing prepared call has another request");
 let result=load(key+"-result");
 if(result===undefined){
  need(!request.recoverOnly&&!before,"Original prepared response is uncertain; reconcile this exact request before dispatch");
  store(key+"-request",bound);
  store(key+"-started",{startedAt:new Date().toISOString(),tool:request.tool,source:request.source});
  try{
   result=await (request.tool==="prepare_uploads"?tools.mcp__codex_apps__library_prepare_uploads(request.arguments):tools.mcp__codex_apps__library_finalize_uploads(request.arguments));
   store(key+"-result",result);store(key+"-completed",{completedAt:new Date().toISOString(),isError:result?.isError===true});
  }catch(error){store(key+"-error",{at:new Date().toISOString(),error:String(error)});throw error;}
 }else{need(before&&equal(before,bound),"Retained prepared response lacks its original request");}
 if(result?.isError!==true){
  const returned=resultArray(result,request.tool==="prepare_uploads"?"uploads":"results");
  need(returned.length===1,"Canonical prepared result count differs");
  if(request.tool==="prepare_uploads"){
   need(returned[0].file_name===request.name&&returned[0].purpose==="create_library_file"&&returned[0].upload_url&&!returned[0].workspace_path,"The original private preparation has another transfer identity");
   store(sourceKey+"-prepared",returned);
  }
 }
 text({event:"ORIGINAL_PREPARED_LIBRARY_RESPONSE",tool:request.tool,name:request.name,requestSha256:request.requestSha256,isError:result?.isError===true});
 accept(await tools.write_stdin({session_id:session,chars:JSON.stringify({action:"library-prepared-tool-result",requestSha256:request.requestSha256,tool:request.tool,result})+"\n",yield_time_ms:1000,max_output_tokens:9000}),"original-prepared-save-response");
}
function retain(){store("aviary-lean-v6-controller",journal);if(session!==null)store("aviary-lean-v6-session",session);}
function accept(result,kind){
 journal.calls.push({kind,at:new Date().toISOString(),session_id:result.session_id??null,exit_code:result.exit_code??null,wall_time_seconds:result.wall_time_seconds??null,outputBytes:unescape(encodeURIComponent(result.output||"")).length,outputSha256:hash(result.output||"")});
 if(result.session_id!==undefined){session=result.session_id;journal.session=session;}
 buffer+=result.output||"";
 let at;while((at=buffer.indexOf("\n"))>=0){const line=buffer.slice(0,at).replace(/\r/g,"");buffer=buffer.slice(at+1);if(!line.trim())continue;
  let value;try{value=JSON.parse(line);}catch{if(!line.includes("base64"))text(safeOutput(line));continue;}
  if(value.event==="QA_IMAGE_CHUNK"){chunks.set(value.name+":"+value.offset,value);journal.events.push({event:value.event,name:value.name,offset:value.offset,chunkBytes:value.chunkBytes,bytes:value.bytes,sha256:value.sha256,complete:value.complete});}
  else if(value.event==="LIBRARY_PREPARED_TOOL_REQUEST"){preparedSaves.push(value);const shown={event:value.event,name:value.name,source:value.source,tool:value.tool,requestSha256:value.requestSha256,recoverOnly:value.recoverOnly};journal.events.push(shown);text(shown);}
  else {const safe=publicValue(value);journal.events.push(safe);text(safe);}
  if(value.event==="AVIARY_CONTINUATION_PAUSED"||value.event==="ORIGINAL_COMMAND_FAILED")paused=value;
  if(value.event==="LIBRARY_SAVE_REQUEST")saves.push(value);
  if(value.event==="READY_FOR_VISUAL_REVIEW"){ready=value;store("aviary-newhost-official-save-qa-ready",value);}
 }
 if(result.exit_code!==undefined){ended=true;journal.exitCode=result.exit_code;}
 retain();
}
try{
 accept(await tools.exec_command({cmd:command,workdir:"/",shell:"/bin/bash",login:false,tty:true,yield_time_ms:1000,max_output_tokens:5000}),"admission");
 need(session!==null&&!ended,"No original native process admitted");
 text({event:"ORIGINAL_NATIVE_SESSION",session});
 while(!journal.events.some(e=>e.event==="AVIARY_INPUT_READY")){accept(await tools.write_stdin({session_id:session,chars:"",yield_time_ms:1000,max_output_tokens:5000}),"bootstrap-poll");need(!ended,"Native bootstrap exited before input");await yield_control();}
 accept(await tools.write_stdin({session_id:session,chars:wire,yield_time_ms:1000,max_output_tokens:9000}),"single-full-input");
 while(!ended&&!ready&&!paused){
  if(preparedSaves.length){await servicePrepared(preparedSaves.shift());}
  else if(saves.length){
   const request=saves.shift();
   need(request.arguments?.file===request.staged.path&&request.source.bytes===request.staged.bytes&&request.source.sha256===request.staged.sha256,"Official save staging binding differs");
   const key="aviary-newhost-official-save-result-"+request.requestSha256;
   need(load(key)===undefined,"Original official save already has a retained response; reconcile it before any second dispatch");
   store(key+"-request",request);
   const result=await tools.mcp__codex_apps__library_create_library_file(request.arguments);
   store(key,result);
   text({event:"OFFICIAL_LIBRARY_TOOL_RESPONSE",name:request.name,requestSha256:request.requestSha256,result});
   accept(await tools.write_stdin({session_id:session,chars:JSON.stringify({action:"official-library-save-result",requestSha256:request.requestSha256,result})+"\n",yield_time_ms:1000,max_output_tokens:9000}),"original-official-save-response");
  }else{await yield_control();accept(await tools.write_stdin({session_id:session,chars:"",yield_time_ms:1000,max_output_tokens:9000}),"native-poll");}
 }
 if(ready&&!ended){
  need(Array.isArray(ready.screenshots)&&ready.screenshots.length===4,"The original four-image set is absent");
  for(const selected of ready.screenshots){
   const name=selected.path.split("/").pop();need(name&&Number.isInteger(selected.bytes)&&selected.bytes>0&&/^[a-f0-9]{64}$/.test(selected.sha256),"Invalid screenshot descriptor");
   let offset=0,joined="";
   while(offset<selected.bytes){
    const request={action:"read-qa-image",name,offset,length:Math.min(12288,selected.bytes-offset)};
    accept(await tools.write_stdin({session_id:session,chars:JSON.stringify(request)+"\n",yield_time_ms:1000,max_output_tokens:9000}),"original-image-chunk");
    const deadline=Date.now()+60000,key=name+":"+offset;
    while(!chunks.has(key)){need(!ended&&Date.now()<deadline,"Original image chunk did not return");await yield_control();accept(await tools.write_stdin({session_id:session,chars:"",yield_time_ms:1000,max_output_tokens:9000}),"image-chunk-poll");}
    const chunk=chunks.get(key);chunks.delete(key);
    need(chunk.name===name&&chunk.offset===offset&&chunk.bytes===selected.bytes&&chunk.sha256===selected.sha256&&chunk.chunkBytes===request.length&&chunk.complete===(offset+request.length===selected.bytes),"Original image chunk binding changed");
    const decoded=base64Decode(chunk.base64);need(decoded.length===chunk.chunkBytes,"Image chunk byte count changed");
    joined+=chunk.base64;offset+=chunk.chunkBytes;
   }
   const raw=base64Decode(joined);need(raw.length===selected.bytes&&hashBinary(raw)===selected.sha256&&raw.slice(0,8)==="\x89PNG\r\n\x1a\n","Original PNG bytes/hash changed");
   store("aviary-newhost-official-save-qa-image-"+name,{...selected,name,base64:joined,verified:true});
   text({event:"ORIGINAL_QA_IMAGE_READY",name,bytes:selected.bytes,sha256:selected.sha256});
   image({image_url:"data:image/png;base64,"+joined,detail:"original"});
   await yield_control();
  }
  journal.awaitingVisualReview=true;retain();text({event:"AWAITING_ACTUAL_VISUAL_DECISION",session,screenshots:ready.screenshots.map(({path,bytes,sha256})=>({name:path.split("/").pop(),path,bytes,sha256})),requestedInput:ready.requestedInput});
  const decisionKey="aviary-original-visual-decision-"+journal.inputSha256;
  store(decisionKey+"-requested",{session,inputSha256:journal.inputSha256,screenshots:ready.screenshots,requestedInput:ready.requestedInput});
  while(load(decisionKey)===undefined&&!ended){await new Promise(resolve=>setTimeout(resolve,1000));await yield_control();}
  const decision=load(decisionKey);
  need(!ended&&decision&&decision.inputSha256===journal.inputSha256&&decision.session===session,"Actual visual decision belongs to another native run");
  need(decision.reviewed===true&&decision.command?.action==="complete-visual-review","The four actual images require their completed review");
  journal.awaitingVisualReview=false;retain();
  accept(await tools.write_stdin({session_id:session,chars:JSON.stringify(decision.command)+"\n",yield_time_ms:1000,max_output_tokens:9000}),"original-completed-visual-review");
  while(!ended){
   if(preparedSaves.length){await servicePrepared(preparedSaves.shift());}
   else {await yield_control();accept(await tools.write_stdin({session_id:session,chars:"",yield_time_ms:1000,max_output_tokens:9000}),"original-final-delivery");}
  }
  journal.endedAt=new Date().toISOString();retain();
  text({event:"NATIVE_CONTROLLER_CLOSED",session,exitCode:journal.exitCode,events:journal.events.length});
 }else if(paused&&!ended){journal.pausedAt=new Date().toISOString();journal.nativePaused=true;retain();text({event:"NATIVE_CONTROLLER_PAUSED",session,error:paused.error,message:safeOutput(paused.message)});}else{journal.endedAt=new Date().toISOString();retain();text({event:"NATIVE_CONTROLLER_CLOSED",session,exitCode:journal.exitCode,events:journal.events.length});}
}catch(error){journal.controllerError=safeOutput(error);journal.endedAt=new Date().toISOString();retain();text({event:"NATIVE_CONTROLLER_ERROR",session,error:safeOutput(error)});}
