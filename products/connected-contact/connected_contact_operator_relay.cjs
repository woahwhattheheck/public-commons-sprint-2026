'use strict';
// Foreground, source-selected relay. Load this module in the existing connected
// orchestration. Never install a listener or create another coordinator.
const STATE_SCHEMA='commons.connected-contact-tool-relay/v1';
const ACTIVE=new Set();
function need(ok,message){if(!ok)throw Object.assign(new Error(message),{code:'CONTACT_RELAY_SELECTION'});}
function plain(x){return x!==null&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;}
const B64='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function base64(bytes){
 let out='';for(let i=0;i<bytes.length;i+=3){const a=bytes[i],b=bytes[i+1],c=bytes[i+2];out+=B64[a>>2]+B64[((a&3)<<4)|((b??0)>>4)]+(i+1<bytes.length?B64[((b&15)<<2)|((c??0)>>6)]:'=')+(i+2<bytes.length?B64[c&63]:'=');}return out;
}
function unbase64(text){
 need(typeof text==='string'&&/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text),'Complete canonical base64 is required.');
 const n=text.length/4*3-(text.endsWith('==')?2:text.endsWith('=')?1:0),out=new Uint8Array(n);let k=0;
 for(let i=0;i<text.length;i+=4){const a=B64.indexOf(text[i]),b=B64.indexOf(text[i+1]),c=B64.indexOf(text[i+2]),d=B64.indexOf(text[i+3]);if(k<n)out[k++]=(a<<2)|(b>>4);if(k<n)out[k++]=((b&15)<<4)|(Math.max(c,0)>>2);if(k<n)out[k++]=((Math.max(c,0)&3)<<6)|Math.max(d,0);}
 need(base64(out)===text,'Noncanonical base64 is not accepted.');return out;
}
function decodeUtf8(bytes){
 // Incoming requests are capped at 16 KiB; reject malformed UTF-8, never repair.
 let out='';for(let i=0;i<bytes.length;){let c=bytes[i++],n,min;
  if(c<128){out+=String.fromCharCode(c);continue;}
  if(c>=194&&c<=223){n=1;min=128;c&=31;}else if(c>=224&&c<=239){n=2;min=2048;c&=15;}else if(c>=240&&c<=244){n=3;min=65536;c&=7;}else throw Error('Malformed original UTF-8 request.');
  need(i+n<=bytes.length,'Truncated original UTF-8 request.');for(let j=0;j<n;j++){const b=bytes[i++];need((b&192)===128,'Malformed original UTF-8 continuation.');c=(c<<6)|(b&63);}
  need(c>=min&&c<=1114111&&(c<55296||c>57343),'Invalid original Unicode scalar.');
  out+=c<65536?String.fromCharCode(c):String.fromCharCode(55296+((c-65536)>>10),56320+((c-65536)&1023));
 }return out;
}
function utf8Chunk(text,start,limit){
 const out=new Uint8Array(limit);let n=0,i=start;
 while(i<text.length){
  const begin=i;let c=text.charCodeAt(i++);
  if(c>=55296&&c<=56319){const d=text.charCodeAt(i);if(d>=56320&&d<=57343){c=65536+((c-55296)<<10)+d-56320;i++;}else c=65533;}
  else if(c>=56320&&c<=57343)c=65533;
  const count=c<128?1:c<2048?2:c<65536?3:4;
  if(n+count>limit){i=begin;break;}
  if(count===1)out[n++]=c;else if(count===2){out[n++]=192|(c>>6);out[n++]=128|(c&63);}
  else if(count===3){out[n++]=224|(c>>12);out[n++]=128|((c>>6)&63);out[n++]=128|(c&63);}
  else{out[n++]=240|(c>>18);out[n++]=128|((c>>12)&63);out[n++]=128|((c>>6)&63);out[n++]=128|(c&63);}
 }return {bytes:out.subarray(0,n),nextOffset:i};
}
function quote(value){return "'"+value.replace(/'/g,"'\\''")+"'";}
function errorRecord(error){
 const row={name:typeof error?.name==='string'?error.name:'Error',message:typeof error?.message==='string'?error.message:String(error)};
 for(const key of Object.getOwnPropertyNames(error&&typeof error==='object'?error:{})){
  if(['__proto__','constructor','prototype'].includes(key))continue;
  try{const value=error[key];if(value===null||['string','number','boolean'].includes(typeof value)||Array.isArray(value)||plain(value))row[key]=value;}catch{}
 }
 return row;
}
function summary(state){
 return {schema:STATE_SCHEMA,operation_id:state.operation_id,session_id:state.session_id,
  phase:state.phase,native_session_id:state.native_session_id??null,exit_code:state.exit_code??null,
  calls:state.calls.length,received:state.calls.filter(x=>x.phase==='RECEIVED').length,
  configuration_sha256:state.configuration_sha256,provider_write_invocations:state.calls.filter(x=>/^mcp__codex_apps__gmail_send_(email|draft)$/.test(x.binding)).length,
  journal_directory:state.journal_directory,application_result:state.application_result?{...state.application_result.value,sha256:state.application_result.sha256}:null,reason:state.reason||null};
}
async function runConnectedContactOperator(options){
 const {bridge,tools,configurationText,configurationPath,sha256Utf8,sha256Bytes,loadState,saveState,stateKey,resume=false}=options||{};
 need(bridge&&typeof bridge.validateConfiguration==='function'&&typeof bridge.validateRead==='function','Load the exact reviewed companion bridge module.');
 need(typeof configurationText==='string'&&typeof configurationPath==='string'&&configurationPath.startsWith('/')&&!/[\x00-\x1f\x7f]/.test(configurationPath),'Select the original complete private bridge configuration and its on-machine path.');
 need(typeof sha256Utf8==='function'&&typeof sha256Bytes==='function'&&typeof loadState==='function'&&typeof saveState==='function'&&typeof stateKey==='string'&&stateKey.length>0,'Supply the maintained exact SHA helpers and private retained orchestration state.');
 const config=JSON.parse(configurationText),cliArgs=bridge.validateConfiguration(config);
 const operational=config.mode==='continue-original';
 let selection=null;
 if(operational){
  need(typeof options.selectionText==='string','Retain the complete exact original private continuation selection.');
  const selectedPin=config.pins.find(row=>row.path===cliArgs['--selection']),measured=sha256Utf8(options.selectionText);
  need(selectedPin&&measured.bytes===selectedPin.bytes&&measured.sha256===selectedPin.sha256,'The foreground selection differs from the pinned native input.');
  selection=JSON.parse(options.selectionText);bridge.validateContinuation(selection,config);
  need(typeof options.reviewRelationship==='function','Supply the existing original owner relationship callback.');
 }
 const identity=sha256Utf8(configurationText);need(identity&&/^[a-f0-9]{64}$/.test(identity.sha256)&&identity.bytes<=1024*1024,'Configuration bytes are invalid.');
 const lock=identity.sha256;need(!ACTIVE.has(lock),'This exact foreground relay is already running in this orchestration.');ACTIVE.add(lock);
 let state;
 const persist=async()=>{await saveState(stateKey,state);};
 const fail=async message=>{state.phase='UNRESOLVED';state.reason=message;await persist();return summary(state);};
 async function sealReturn(call){
  const envelope=call.native_return;
  need(plain(envelope)&&envelope.schema===bridge.SCHEMA&&envelope.session_id===config.session_id&&envelope.call_id===call.call_id&&['returned','threw'].includes(envelope.kind),'The retained full native return belongs to another original call.');
  need(envelope.kind==='returned'?Object.prototype.hasOwnProperty.call(envelope,'value'):plain(envelope.error)&&typeof envelope.error.message==='string','The retained actual outcome is incomplete.');
  const responseText=JSON.stringify(envelope);
  need(typeof responseText==='string'&&(call.responseText===null||call.responseText===responseText),'The retained full response serialization changed.');
  call.responseText=responseText;await persist();
  const identityResponse=sha256Utf8(responseText);
  need(identityResponse.bytes<=bridge.MAX_RESPONSE,'The complete native return exceeds the receiving bound; preserve it for original-owner reconciliation.');
  call.response_sha256=identityResponse.sha256;call.response_bytes=identityResponse.bytes;
  call.phase='RETURNED';call.tx={stage:'start',index:0,offset:0,bytes:0,awaiting:null};
  delete call.native_return;await persist();
 }

 try{
  state=await loadState(stateKey);
  if(state){
   need(state.schema===STATE_SCHEMA&&state.configuration_sha256===identity.sha256&&state.configurationText===configurationText&&state.configurationPath===configurationPath&&state.operation_id===config.operation_id&&state.session_id===config.session_id&&(!operational||state.selectionText===options.selectionText),'Never replace the original retained relay selection.');
   if(state.phase==='COMPLETE'||state.phase==='FAILED')return summary(state);
   need(resume===true,'Select explicit same-session continuation for this retained foreground operation.');
   if(!state.native_session_id)return await fail('The original native admission has no returned session. Reconcile that original entry; no second launch is permitted.');
   if(state.calls.some(x=>x.phase==='DISPATCHING'))return await fail('An original provider invocation has no retained full return. Reconcile the original result; never redispatch it automatically.');
   for(const call of state.calls)if(call.phase==='PROVIDER_RETURNED')await sealReturn(call);
  }else{
   need(!resume,'There is no retained original foreground operation to continue.');
   state={schema:STATE_SCHEMA,configurationText,configurationPath,configuration_sha256:identity.sha256,operation_id:config.operation_id,session_id:config.session_id,
    journal_directory:config.journal_directory+'/'+config.session_id,selectionText:operational?options.selectionText:null,phase:'SELECTED',native_session_id:null,
    calls:[],frames:[],native_returns:[],pending_output:'',hello:null,completion:null,exit_code:null,reason:null};
   await persist();
  }
  const transport=options.transport||{
   launch:args=>tools.exec_command(args),
   poll:args=>tools.write_stdin(args),
   write:args=>tools.write_stdin(args)
  };
  need(transport&&['launch','poll','write'].every(k=>typeof transport[k]==='function'),'Use the actual maintained native transport, not a provider emulator.');
  // Resolve only fixed source-defined names. Never execute a name from a frame
  // without both independent name and argument checks.
  const dispatch={
   mcp__codex_apps__github_get_repo:a=>tools.mcp__codex_apps__github_get_repo(a),
   mcp__codex_apps__github_fetch:a=>tools.mcp__codex_apps__github_fetch(a),
   mcp__codex_apps__github_fetch_commit:a=>tools.mcp__codex_apps__github_fetch_commit(a),
   mcp__codex_apps__github_fetch_file:a=>tools.mcp__codex_apps__github_fetch_file(a),
   mcp__codex_apps__github_fetch_blob:a=>tools.mcp__codex_apps__github_fetch_blob(a),
   mcp__codex_apps__github_compare_commits:a=>tools.mcp__codex_apps__github_compare_commits(a),
   mcp__codex_apps__github_get_user_login:a=>tools.mcp__codex_apps__github_get_user_login(a),
   mcp__codex_apps__gmail_get_profile:a=>tools.mcp__codex_apps__gmail_get_profile(a),
   mcp__codex_apps__gmail_search_email_ids:a=>tools.mcp__codex_apps__gmail_search_email_ids(a),
   mcp__codex_apps__gmail_read_email:a=>tools.mcp__codex_apps__gmail_read_email(a),
   mcp__codex_apps__gmail_batch_read_email:a=>tools.mcp__codex_apps__gmail_batch_read_email(a),
   mcp__codex_apps__gmail_list_drafts:a=>tools.mcp__codex_apps__gmail_list_drafts(a),
   mcp__codex_apps__gmail_send_email:a=>tools.mcp__codex_apps__gmail_send_email(a),
   mcp__codex_apps__gmail_send_draft:a=>tools.mcp__codex_apps__gmail_send_draft(a),
   [bridge.RELATIONSHIP_BINDING]:a=>options.reviewRelationship({selection:JSON.parse(options.selectionText),spec:JSON.parse(JSON.stringify(a.spec))})
  };
  async function acceptNative(result,operation,args,write_id=null){
   need(plain(result)&&typeof result.output==='string','Native transport did not return complete original output.');
   state.native_returns.push({operation,args,write_id,result});
   if(result.session_id!==undefined&&result.session_id!==null){
    need(Number.isSafeInteger(result.session_id)&&result.session_id>0,'Native session identity is invalid.');
    need(state.native_session_id===null||state.native_session_id===result.session_id,'The native return names a different original session.');
    state.native_session_id=result.session_id;
   }
   if(result.exit_code!==undefined&&result.exit_code!==null){need(Number.isInteger(result.exit_code),'Native exit status is invalid.');state.exit_code=result.exit_code;}
   state.idle_polls=result.output.length?0:(state.idle_polls||0)+1;
   state.pending_output+=result.output;
   const lines=state.pending_output.split('\n');state.pending_output=lines.pop();
   for(const line of lines){
    if(!line.startsWith(bridge.PREFIX)){
     // The maintained CLI owns this unframed application result. It is never
     // interpreted as a request to invoke a connected tool.
     if(line.startsWith('{')){
      let application;try{application=JSON.parse(line);}catch{}
      if(application?.status==='COMPLETE'&&application.action===config.argv[0]){
       need((operational?application.result_saved===true&&application.operation_key===selection.operation_key&&application.coordinator_id===selection.coordinator_id:application.request_saved===true)&&typeof application.coordinator_id==='string','The original CLI result is incomplete.');
       const observed={raw:line,value:application,...sha256Utf8(line)};
       need(!state.application_result||state.application_result.raw===line,'Original CLI completion changed.');
       state.application_result=observed;
      }
     }
     continue;
    }
    const frame=JSON.parse(line.slice(bridge.PREFIX.length));
    need(plain(frame)&&frame.schema===bridge.SCHEMA&&frame.session_id===config.session_id,'Output frame names a different original operation.');
    state.frames.push(frame);
   }
   await persist();
  }
  async function callTransport(kind,args,marker=null){
   if(marker){need(marker.stage==='PREPARED'&&marker.frameText===args.chars&&marker.id===sha256Utf8(args.chars).sha256,'The original prepared input frame changed.');marker.stage='DISPATCHING';}
   state.native_pending={kind,args,write_id:marker?.id||null};await persist();
   let result;
   try{result=await transport[kind](args);}
   catch(error){
    state.native_uncertain={kind,args,write_id:marker?.id||null,error:errorRecord(error)};state.native_pending=null;
    state.phase='UNRESOLVED';state.reason='The original native '+kind+' return is uncertain; continue only this retained session and await its original acknowledgment.';await persist();return false;
   }
   if(marker)marker.stage='RETURNED';
   state.native_pending=null;state.native_uncertain=null;await acceptNative(result,kind,args,marker?.id||null);return true;
  }
  if(state.phase==='SELECTED'){
   const command='env COMMONS_CONTACT_BRIDGE_CONFIG='+quote(configurationPath)+' '+quote(config.node_executable)+' '+quote(config.source_directory+'/connected_contact_operator.cjs')+' '+config.argv.map(quote).join(' ');
   state.phase='LAUNCHING';await persist();
   if(!await callTransport('launch',{cmd:command,workdir:config.source_directory,shell:'/bin/bash',login:false,tty:false,yield_time_ms:1000,max_output_tokens:24000}))return summary(state);
   state.phase='RUNNING';await persist();
  }else{
   // A suspended write may already have arrived. Polling the exact session is
   // the only automatic continuation; neither stdin bytes nor calls are replayed.
   state.phase='RUNNING';state.reason=null;state.idle_polls=0;await persist();
  }
  async function handleFrame(frame){
   if(frame.kind==='hello'){
    if(state.hello){need(JSON.stringify(frame)===JSON.stringify(state.hello),'Original process handshake changed on continuation.');return;}
    need(frame.operation_id===config.operation_id&&frame.configuration_sha256===identity.sha256&&frame.source_directory===config.source_directory&&Number.isInteger(frame.pid)&&frame.pid>0&&typeof frame.host==='string','The actual original process/configuration handshake changed.');
    state.hello=frame;await persist();return;
   }
   need(state.hello,'No exact original process handshake was retained.');
   
   if(frame.kind==='call-start'){
    need(operational&&Number.isSafeInteger(frame.bytes)&&frame.bytes>bridge.MAX_REQUEST&&frame.bytes<=bridge.MAX_OPERATION_REQUEST&&frame.call_id===frame.sha256&&/^[a-f0-9]{64}$/.test(frame.sha256),'Select a complete bounded original request transfer.');
    const existing=state.calls.find(row=>row.call_id===frame.call_id);
    if(existing){need(sha256Utf8(existing.requestText).bytes===frame.bytes,'The repeated original large request changed.');return;}
    need(!state.calls.some(x=>x.phase!=='RECEIVED'),'Finish the previous exact native return before another request.');
    if(state.request_transfer){need(JSON.stringify(state.request_transfer.frame)===JSON.stringify(frame),'Another original request transfer is unresolved.');return;}
    state.request_transfer={frame,chunks:[],bytes:0,index:0,awaiting:null};await persist();return;
   }
   if(frame.kind==='call-chunk'){
    const transfer=state.request_transfer;
    need(transfer&&frame.call_id===transfer.frame.call_id&&Number.isSafeInteger(frame.index)&&frame.index>=0,'The original request chunk has no selected transfer.');
    if(frame.index<transfer.index){need(transfer.chunks[frame.index]===frame.base64,'A repeated original request chunk changed.');return;}
    need(frame.index===transfer.index&&transfer.awaiting&&transfer.awaiting.index===frame.index,'Receive each requested original chunk in order.');
    const bytes=unbase64(frame.base64);
    need(bytes.length>0&&bytes.length<=8192&&transfer.bytes+bytes.length<=transfer.frame.bytes,'The original request chunk length changed.');
    transfer.chunks.push(frame.base64);transfer.bytes+=bytes.length;transfer.index++;transfer.awaiting=null;await persist();return;
   }
   if(frame.kind==='call-end'){
    const transfer=state.request_transfer;
    need(transfer&&frame.call_id===transfer.frame.call_id&&frame.chunks===transfer.index&&transfer.bytes===transfer.frame.bytes&&transfer.awaiting&&transfer.awaiting.index===transfer.index,'The complete original request is not retained.');
    const bytes=new Uint8Array(transfer.bytes);let offset=0;
    for(const part of transfer.chunks){const chunk=unbase64(part);bytes.set(chunk,offset);offset+=chunk.length;}
    const measured=sha256Bytes(bytes);
    need((typeof measured==='string'?measured:measured.sha256)===transfer.frame.sha256,'The complete original message or attachment bytes changed.');
    // Turn the retained frame into the ordinary exact-call path BEFORE any
    // provider dispatch. A resumed relay receives the same complete request.
    Object.assign(frame,{kind:'call',bytes:transfer.frame.bytes,sha256:transfer.frame.sha256,base64:base64(bytes)});
    delete frame.chunks;state.request_transfer=null;await persist();
    return handleFrame(frame);
   }

   if(frame.kind==='call'){
    const retained=state.calls.find(x=>x.call_id===frame.call_id);
    if(retained){need(frame.sha256===retained.call_id&&sha256Utf8(retained.requestText).bytes===frame.bytes&&base64(unbase64(frame.base64))===frame.base64&&decodeUtf8(unbase64(frame.base64))===retained.requestText,'A repeated original request frame changed.');return;}
    need(!state.calls.some(x=>x.phase!=='RECEIVED')&&Number.isSafeInteger(frame.bytes)&&frame.bytes>0&&frame.bytes<=(operational?bridge.MAX_OPERATION_REQUEST:bridge.MAX_REQUEST)&&frame.call_id===frame.sha256,'Unexpected concurrent or oversized source frame.');
    const bytes=unbase64(frame.base64);need(bytes.length===frame.bytes,'Original request byte count changed.');
    const digest=sha256Bytes(bytes);need((typeof digest==='string'?digest:digest.sha256)===frame.sha256,'Original request hash changed.');
    const requestText=decodeUtf8(bytes),request=JSON.parse(requestText);
    need(Object.keys(request).length===6&&['schema','operation_id','session_id','sequence','binding','args'].every(k=>Object.prototype.hasOwnProperty.call(request,k))&&request.schema===bridge.SCHEMA&&request.operation_id===config.operation_id&&request.session_id===config.session_id&&request.sequence===state.calls.length+1&&request.sequence<=config.max_calls,'Original provider request identity changed.');
    bridge.validateCall(request.binding,request.args,config,selection);
    need(Object.prototype.hasOwnProperty.call(dispatch,request.binding)&&(request.binding===bridge.RELATIONSHIP_BINDING?operational&&typeof options.reviewRelationship==='function':typeof tools?.[request.binding]==='function'),'The exact allowed original read binding is not exposed.');
    if(bridge.SEND_NAMES.includes(request.binding))need(!state.calls.some(x=>bridge.SEND_NAMES.includes(x.binding)),'The same foreground operation already dispatched its one original native send.');
    const call={call_id:frame.call_id,sequence:request.sequence,binding:request.binding,requestText,phase:'DISPATCHING',responseText:null,response_sha256:null,response_bytes:null,tx:null};
    state.calls.push(call);await persist();
    let envelope;
    try{
     const value=await dispatch[request.binding](request.args);
     envelope={schema:bridge.SCHEMA,session_id:config.session_id,call_id:call.call_id,kind:'returned',value};
    }catch(error){
     envelope={schema:bridge.SCHEMA,session_id:config.session_id,call_id:call.call_id,kind:'threw',error:errorRecord(error)};
    }
    // Retain the entire native CallToolResult (content, structuredContent,
    // isError and metadata) before returning any byte to the selected process.
    call.native_return=envelope;call.phase='PROVIDER_RETURNED';await persist();
    await sealReturn(call);return;
   }
   if(frame.kind==='response-progress'||frame.kind==='received'){
    const call=state.calls[state.calls.length-1],tx=call?.tx,waiting=tx?.awaiting;
    if(call?.call_id===frame.call_id&&call.phase==='RECEIVED'&&frame.kind==='received'){need(frame.response_sha256===call.response_sha256,'Original acknowledgment changed.');return;}
    if(call?.call_id===frame.call_id&&call.phase==='RETURNED'&&!waiting&&frame.kind==='response-progress'){need(frame.next_index===tx.index&&frame.bytes===tx.bytes,'Original progress acknowledgment changed.');return;}
    need(call&&call.phase==='RETURNED'&&call.call_id===frame.call_id&&waiting,'There is no original response write awaiting this acknowledgment.');
    if(frame.kind==='received'){
     need(waiting.kind==='end'&&frame.response_sha256===call.response_sha256,'Original complete return acknowledgment changed.');
     tx.awaiting=null;tx.stage='done';call.phase='RECEIVED';
    }else{
     need(['start','chunk'].includes(waiting.kind)&&frame.next_index===waiting.next_index&&frame.bytes===waiting.bytes,'Original response progress does not match its exact pending frame.');
     tx.index=waiting.next_index;tx.bytes=waiting.bytes;tx.offset=waiting.nextOffset;
     tx.awaiting=null;tx.stage=tx.bytes===call.response_bytes?'end':'chunk';
    }
    await persist();return;
   }
   if(frame.kind==='complete'){
    if(state.completion){need(JSON.stringify(frame)===JSON.stringify(state.completion),'Original completion changed.');return;}
    need(frame.operation_id===config.operation_id&&frame.calls===state.calls.length&&frame.provider_write_invocations===state.calls.filter(x=>bridge.SEND_NAMES.includes(x.binding)).length&&state.calls.every(x=>x.phase==='RECEIVED'),'Original preparation completion is incomplete.');
    state.completion=frame;await persist();return;
   }
   throw Error('Unknown bridge protocol frame.');
  }
  while(true){
   if((state.idle_polls||0)>=12)return await fail('The exact original session produced no further frame in twelve foreground polls. Preserve it for explicit reconciliation; no launch, provider replay or byte resend occurred.');
   while(state.frames.length){const frame=state.frames[0];await handleFrame(frame);state.frames.shift();await persist();}
   if(state.exit_code!==null){
    need(!state.pending_output.startsWith(bridge.PREFIX),'The final native protocol frame was truncated.');
    if(state.exit_code===0&&state.completion&&state.completion.exit_code===0&&state.application_result&&state.calls.every(x=>x.phase==='RECEIVED')){state.phase='COMPLETE';state.reason=null;}
    else{state.phase='FAILED';state.reason='Original native process ended without successful complete preparation; preserve all original journals and do not launch again automatically.';}
    await persist();return summary(state);
   }
   if(state.application_result&&!state.completion){
    need(state.native_session_id&&state.calls.every(x=>x.phase==='RECEIVED'),'Complete all original responses before closing the owned bridge input.');
    if(!state.finish_pending){
     const frame={schema:bridge.SCHEMA,kind:'finish',session_id:config.session_id,operation_id:config.operation_id,application:state.application_result.value};
     const frameText=bridge.PREFIX+JSON.stringify(frame)+'\n';
     state.finish_pending={stage:'PREPARED',frameText,id:sha256Utf8(frameText).sha256};await persist();
    }
    if(state.finish_pending.stage==='PREPARED'){
     if(!await callTransport('write',{session_id:state.native_session_id,chars:state.finish_pending.frameText,yield_time_ms:1000,max_output_tokens:24000},state.finish_pending))return summary(state);
     continue;
    }
   }
   
   if(state.request_transfer){
    const transfer=state.request_transfer;
    if(!transfer.awaiting){
     const frame={schema:bridge.SCHEMA,kind:'request-next',session_id:config.session_id,call_id:transfer.frame.call_id,index:transfer.index};
     const frameText=bridge.PREFIX+JSON.stringify(frame)+'\n';
     transfer.awaiting={index:transfer.index,stage:'PREPARED',frameText,id:sha256Utf8(frameText).sha256};await persist();
    }
    if(transfer.awaiting.stage==='PREPARED'){
     need(state.native_session_id,'Keep the original native session for complete request transfer.');
     if(!await callTransport('write',{session_id:state.native_session_id,chars:transfer.awaiting.frameText,yield_time_ms:1000,max_output_tokens:24000},transfer.awaiting))return summary(state);
     continue;
    }
   }

   const call=state.calls[state.calls.length-1];
   if(call?.phase==='RETURNED'&&!call.tx.awaiting){
    const tx=call.tx;let frame,waiting;
    if(tx.stage==='start'){
     frame={schema:bridge.SCHEMA,kind:'response-start',session_id:config.session_id,call_id:call.call_id,bytes:call.response_bytes,sha256:call.response_sha256};
     waiting={kind:'start',next_index:0,bytes:0,nextOffset:0};
    }else if(tx.stage==='chunk'){
     const chunk=utf8Chunk(call.responseText,tx.offset,bridge.CHUNK);need(chunk.bytes.length>0,'The complete response chunk is missing.');
     frame={schema:bridge.SCHEMA,kind:'response-chunk',session_id:config.session_id,call_id:call.call_id,index:tx.index,base64:base64(chunk.bytes)};
     waiting={kind:'chunk',next_index:tx.index+1,bytes:tx.bytes+chunk.bytes.length,nextOffset:chunk.nextOffset};
    }else{
     need(tx.stage==='end'&&tx.bytes===call.response_bytes,'Complete original response transmission is not available.');
     frame={schema:bridge.SCHEMA,kind:'response-end',session_id:config.session_id,call_id:call.call_id};waiting={kind:'end'};
    }
    need(state.native_session_id,'The original process has no returned native session.');
    const frameText=bridge.PREFIX+JSON.stringify(frame)+'\n';
    tx.awaiting={...waiting,stage:'PREPARED',frameText,id:sha256Utf8(frameText).sha256};await persist();
    continue;
   }else if(call?.phase==='RETURNED'&&call.tx.awaiting?.stage==='PREPARED'){
    if(!await callTransport('write',{session_id:state.native_session_id,chars:call.tx.awaiting.frameText,yield_time_ms:1000,max_output_tokens:24000},call.tx.awaiting))return summary(state);
   }else{
    need(state.native_session_id,'The original process has no returned native session.');
    if(!await callTransport('poll',{session_id:state.native_session_id,chars:'',yield_time_ms:5000,max_output_tokens:24000}))return summary(state);
   }
   if(typeof options.onProgress==='function')await options.onProgress(summary(state));
  }
 }catch(error){
  if(state){state.phase='UNRESOLVED';state.reason=error.message;state.relay_error=errorRecord(error);await persist();return summary(state);}throw error;
 }finally{ACTIVE.delete(lock);}
}
module.exports={STATE_SCHEMA,runConnectedContactOperator,base64,unbase64,decodeUtf8,utf8Chunk};
