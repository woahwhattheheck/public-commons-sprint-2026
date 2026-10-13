/**
 * Continue the original Datasette receiving operation with connected Library tools.
 * Run in functions using actual {tools,load,store,notify}; retain private state.
 * Native grants serialize provider dispatch. The original receiver owns all products.
 */
const OPERATION="SCF-DATASETTE-SOURCE-EDITIONS-07476-20261012";
const PROTOCOL="commons.datasette.connected-library.v1";
const ACTIONS=Object.freeze({
 prepare_materialize:"mcp__codex_apps__library_prepare_materialize",
 prepare_uploads:"mcp__codex_apps__library_prepare_uploads",
 finalize_uploads:"mcp__codex_apps__library_finalize_uploads",
});
const originalRoot="/dev/datasette-publisher-a49aa-fq7r4j79";
const quote=value=>"'"+String(value).replace(/'/g,"'\\''")+"'";
const MAX_MESSAGE=16*1024*1024;
function sha256(a){
 const K=[0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
 const h=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
 const size=Math.ceil((a.length+9)/64)*64,b=new Uint8Array(size);b.set(a);b[a.length]=128;const bitlen=BigInt(a.length)*8n;for(let j=0;j<8;j++)b[size-1-j]=Number((bitlen>>BigInt(j*8))&255n);
 const rr=(x,n)=>(x>>>n)|(x<<(32-n));const w=new Int32Array(64);
 for(let off=0;off<size;off+=64){
  for(let i=0;i<16;i++)w[i]=(b[off+4*i]<<24)|(b[off+4*i+1]<<16)|(b[off+4*i+2]<<8)|b[off+4*i+3];
  for(let i=16;i<64;i++){const x=w[i-15],y=w[i-2];w[i]=(w[i-16]+(rr(x,7)^rr(x,18)^(x>>>3))+w[i-7]+(rr(y,17)^rr(y,19)^(y>>>10)))|0;}
  let [A,B,C,D,E,F,G,H]=h;
  for(let i=0;i<64;i++){const s1=rr(E,6)^rr(E,11)^rr(E,25),ch=(E&F)^(~E&G),t1=(H+s1+ch+K[i]+w[i])|0,s0=rr(A,2)^rr(A,13)^rr(A,22),maj=(A&B)^(A&C)^(B&C),t2=(s0+maj)|0;H=G;G=F;F=E;E=(D+t1)|0;D=C;C=B;B=A;A=(t1+t2)|0;}
  [A,B,C,D,E,F,G,H].forEach((v,i)=>h[i]=(h[i]+v)|0);
 }
 return h.map(v=>(v>>>0).toString(16).padStart(8,"0")).join("");
}
function utf8(s){const a=[];for(const ch of s){const c=ch.codePointAt(0);if(c<128)a.push(c);else if(c<2048)a.push(192|(c>>6),128|(c&63));else if(c<65536)a.push(224|(c>>12),128|((c>>6)&63),128|(c&63));else a.push(240|(c>>18),128|((c>>12)&63),128|((c>>6)&63),128|(c&63));}return Uint8Array.from(a);}

function decode64(text) {
  if (typeof text !== "string" || text.length % 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text))
    throw Error("Invalid native frame base64.");
  const abc="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const out=new Uint8Array(text.length/4*3-(text.endsWith("==")?2:text.endsWith("=")?1:0));
  let p=0;
  for(let i=0;i<text.length;i+=4) {
    const n=(abc.indexOf(text[i])<<18)|(abc.indexOf(text[i+1])<<12)|((text[i+2]==="="?0:abc.indexOf(text[i+2]))<<6)|(text[i+3]==="="?0:abc.indexOf(text[i+3]));
    if(p<out.length)out[p++]=n>>>16;
    if(p<out.length)out[p++]=(n>>>8)&255;
    if(p<out.length)out[p++]=n&255;
  }
  return out;
}
function decodeUtf8(bytes) {
  let out="";
  for(let i=0;i<bytes.length;) {
    const a=bytes[i++]; let c,n,min;
    if(a<128){out+=String.fromCharCode(a);continue;}
    if(a>=194&&a<=223){c=a&31;n=1;min=128;}
    else if(a>=224&&a<=239){c=a&15;n=2;min=2048;}
    else if(a>=240&&a<=244){c=a&7;n=3;min=65536;}
    else throw Error("Invalid UTF-8 source frame.");
    for(let j=0;j<n;j++){const b=bytes[i++];if(b===undefined||(b&192)!==128)throw Error("Incomplete UTF-8 source frame.");c=(c<<6)|(b&63);}
    if(c<min||c>1114111||(c>=55296&&c<=57343))throw Error("Invalid UTF-8 scalar.");
    out+=String.fromCodePoint(c);
  }
  return out;
}
function sameValue(a,b) {
  if(a===b)return true;
  if(!a||!b||typeof a!=="object"||typeof b!=="object"||Array.isArray(a)!==Array.isArray(b))return false;
  const ak=Object.keys(a).sort(),bk=Object.keys(b).sort();
  return ak.length===bk.length&&ak.every((k,i)=>k===bk[i]&&sameValue(a[k],b[k]));
}
function newConsumerId() {
  return "consumer-"+Date.now().toString(36)+"-"+Array.from({length:5},()=>Math.random().toString(36).slice(2)).join("-");
}

function retain(c,key,s){c.store(key,s);}
function providerKey(key,id){return key+":provider:"+id;}
function receipt(c,key,id){return c.load(providerKey(key,id));}
function saveReceipt(c,key,id,r) {
 const prior=receipt(c,key,id);
 if(prior?.result && !sameValue(prior.result,r.result))
   throw Error("An actual original provider result cannot be replaced.");
 c.store(providerKey(key,id),r);
}
function summary(s) {
 return {operation:OPERATION,state:s.phase,sessionId:s.sessionId,invocationId:s.invocationId,
  transportDirectory:s.transportDirectory,receiverPid:s.receiverPid,receiverExit:s.receiverExit,
  lastNativeStage:s.lastNativeStage,followingComplete:Boolean(s.followingComplete),
  libraryRequests:Object.values(s.requests).map(r=>({requestId:r.frame.request_id,
   action:r.frame.action,state:r.phase,isError:r.result?.isError===true,
   compatibilityError:r.nativeAccepted?.compatibility_error||undefined})),
  wireFrames:s.wireOrder.length,wireErrors:s.wireErrors.length,detached:s.detached||false,
  controls:Object.entries(s.commands).map(([commandId,x])=>({commandId,phase:x.phase}))};
}
function logical(c,key,s,f) {
 if(f.protocol!==PROTOCOL||f.operation!==OPERATION||f.invocation_id!==s.invocationId)
   throw Error("The logical frame belongs to another original invocation.");
 s.frames.push(f);
 if(f.type==="admitted") {
  s.phase="RUNNING";s.receiverPid=f.receiver_pid;s.transportDirectory=f.transport_directory;
  s.nativeAdmission=f;
  c.notify({operation:OPERATION,state:"NATIVE_ADMITTED",receiverPid:f.receiver_pid,
   directory:f.transport_directory,sourceSha256:f.receiver_source_sha256});
 } else if(f.type==="tool_request") {
  if(f.connector_id!=="connector_openai_library"||!ACTIONS[f.action]||
    typeof f.request_id!=="string"||!f.arguments||typeof f.arguments!=="object"||Array.isArray(f.arguments))
    throw Error("Unexpected connected Library request.");
  const prior=s.requests[f.request_id];
  if(prior) {if(!sameValue(prior.frame,f))throw Error("The original Library request changed.");}
  else {s.requests[f.request_id]={frame:f,phase:"PENDING",grants:[]};s.queue.push(f.request_id);}
 } else if(f.type==="tool_grant") {
  const row=s.requests[f.request_id];
  if(!row)throw Error("A native grant has no retained original request.");
  row.grants.push(f);row.lastGrant=f;
 } else if(f.type==="tool_result_accepted") {
  const row=s.requests[f.request_id];
  if(!row)throw Error("An accepted result has no original request.");
  row.nativeAccepted=f;row.phase="RETURNED_TO_NATIVE";
 } else if(f.type==="receiver_input_accepted") {
  const cmd=s.commands[f.command_id];
  if(!cmd)throw Error("Accepted original control is missing.");
  cmd.receipt=f;cmd.phase=f.phase;
 } else if(f.type==="transport_attached") {
  if(f.receiver_pid!==s.receiverPid)throw Error("Attached receiver identity changed.");
  s.detached=false;s.attachment=f;
  s.phase=s.receiverReady?(s.followingComplete?"AWAITING_RECIPIENT_INSPECTION":"PRESERVED_FOR_CONTINUATION"):"RUNNING";
 } else if(f.type==="native_output") {
  const channel=f.channel==="stderr"?"stderr":"stdout";
  s.nativeBuffers[channel]=(s.nativeBuffers[channel]||"")+(f.text||"");
  let nl;
  while((nl=s.nativeBuffers[channel].indexOf("\n"))>=0) {
   const line=s.nativeBuffers[channel].slice(0,nl);
   s.nativeBuffers[channel]=s.nativeBuffers[channel].slice(nl+1);
   let event;try{event=JSON.parse(line);}catch{}
   if(!event?.stage)continue;
   s.lastNativeStage=event.stage;
   if(event.stage==="datasette_after_installed_source_returned"&&event.state==="COMPLETE")s.followingComplete=true;
   if(event.stage==="datasette_after_installed_source_error"||event.stage==="datasette_continuation_source_error")s.followingComplete=false;
   if(event.stage==="datasette_saved_receiver_ready"){
    s.phase=s.followingComplete?"AWAITING_RECIPIENT_INSPECTION":"PRESERVED_FOR_CONTINUATION";
    s.receiverReady=true;
   }
   if(s.notifiedStage!==event.stage){
    s.notifiedStage=event.stage;
    c.notify({operation:OPERATION,stage:event.stage,phase:event.phase??event.programme??event.state});
   }
  }
 } else if(f.type==="receiver_exit") {
  s.receiverExit=f;s.phase=f.returncode===0?"NATIVE_EXITED":"PRESERVED_FOR_CONTINUATION";
 } else if(f.type==="input_error"||f.type==="transport_error") {
  s.phase="CONTROL_INPUT_FAILED";s.controlError=f;
 } else if(f.type==="detached"||f.type==="transport_detached") {
  s.detached=f;s.phase="NATIVE_TRANSPORT_DETACHED";
 }
 retain(c,key,s);
}
function receiveChunk(c,key,s,f) {
 if(f.protocol!==PROTOCOL||f.operation!==OPERATION||f.type!=="chunk")throw Error("Unexpected native wire protocol.");
 if(!s.invocationId)s.invocationId=f.invocation_id;
 if(s.invocationId!==f.invocation_id)throw Error("Original native invocation changed.");
 if(!Number.isSafeInteger(f.sequence)||f.sequence<0||typeof f.message_id!=="string"||
    !Number.isSafeInteger(f.index)||!Number.isSafeInteger(f.count)||f.index<0||f.index>=f.count||
    !Number.isSafeInteger(f.message_bytes)||f.message_bytes<1||f.message_bytes>MAX_MESSAGE||
    f.count<1||f.count>Math.ceil(MAX_MESSAGE/1024)||!Number.isSafeInteger(f.bytes)||f.bytes<1||f.bytes>1024)
    throw Error("Invalid native bounded frame.");
 const raw=decode64(f.base64);
 if(raw.length!==f.bytes||sha256(raw)!==f.sha256)throw Error("Native frame bytes differ.");
 const seq=String(f.sequence), prior=s.wire[seq];
 if(prior&&!sameValue(prior,f))throw Error("An original native sequence changed.");
 if(!prior){
  s.wire[seq]=f;s.wireOrder.push(seq);
  let m=s.messages[f.message_id];
  if(!m)m=s.messages[f.message_id]={count:f.count,bytes:f.message_bytes,sha256:f.message_sha256,parts:{}};
  if(m.count!==f.count||m.bytes!==f.message_bytes||m.sha256!==f.message_sha256)throw Error("Native message metadata changed.");
  if(m.parts[f.index]!==undefined&&m.parts[f.index]!==f.base64)throw Error("Native message chunk changed.");
  m.parts[f.index]=f.base64;
  if(Object.keys(m.parts).length===m.count&&!m.complete){
   const chunks=Array.from({length:m.count},(_,i)=>decode64(m.parts[i]));
   const whole=new Uint8Array(chunks.reduce((n,x)=>n+x.length,0));let offset=0;
   for(const chunk of chunks){whole.set(chunk,offset);offset+=chunk.length;}
   if(whole.length!==m.bytes||sha256(whole)!==m.sha256)throw Error("Complete native message differs.");
   const message=JSON.parse(decodeUtf8(whole));
   m.complete=true;logical(c,key,s,message);
  }
 }
 // Save the complete chunk before ACK: replay cannot lose a request after truncation.
 s.ackQueue.push({sequence:f.sequence,sha256:f.sha256});
 s.needResend=false;retain(c,key,s);
}
function consume(c,key,s,result) {
 if(result.session_id!==undefined){
  if(s.sessionId!==undefined&&s.sessionId!==result.session_id)throw Error("Original session changed.");
  s.sessionId=result.session_id;
 }
 const output=result.output||"";s.rawChunks.push(output);s.buffer+=output;
 let nl;
 while((nl=s.buffer.indexOf("\n"))>=0){
  const line=s.buffer.slice(0,nl).replace(/\r$/,"");s.buffer=s.buffer.slice(nl+1);
  if(!line.trim())continue;
  let f;try{f=JSON.parse(line);}catch{
   s.wireErrors.push({at:new Date().toISOString(),kind:"INCOMPLETE_OR_TRUNCATED_OUTPUT",line});
   s.needResend=Boolean(s.invocationId||s.sourceSent);continue;
  }
  if(f.stage==="datasette_connected_source_ready"){
   if(s.sourceReady&&!sameValue(s.nativeBootstrap,f))throw Error("Native bootstrap changed.");
   s.sourceReady=true;s.nativeBootstrap=f;continue;
  }
  try{receiveChunk(c,key,s,f);}catch(error){
   s.wireErrors.push({at:new Date().toISOString(),kind:"WIRE_VALIDATION",error:String(error)});
   s.needResend=Boolean(s.invocationId||s.sourceSent);
   if(/changed|differs|another|Unexpected/.test(String(error)))throw error;
  }
 }
 if(/truncat(?:ed|ion)/i.test(output)&&(!s.ackQueue.length||s.buffer)){
  s.needResend=Boolean(s.invocationId||s.sourceSent);
 }
 if(s.buffer&&s.sourceSent)s.needResend=true;
 if(result.exit_code!==undefined){
  s.processExit=result.exit_code;s.closed=true;
  if(!s.receiverExit)s.phase="NATIVE_RETURNED_BEFORE_RECEIVER_RESULT";
 }
 retain(c,key,s);
}
function frame(s,type,fields={}){return{protocol:PROTOCOL,operation:OPERATION,invocation_id:s.invocationId,type,...fields};}
async function sendRaw(c,key,s,value) {
 if(s.sessionId===undefined||s.closed)throw Error("Original native session is not open.");
 const r=await c.tools.write_stdin({session_id:s.sessionId,chars:JSON.stringify(value)+"\n",yield_time_ms:1000,max_output_tokens:6000});
 consume(c,key,s,r);
}
async function flushWire(c,key,s) {
 // One native chunk is outstanding. ACK can release precisely the next chunk.
 let count=0;
 while(!s.closed&&(s.ackQueue.length||s.needResend)){
  if(++count>20000)throw Error("Unexpected native output without a receiving boundary.");
  if(s.ackQueue.length){
   const ack=s.ackQueue.shift();retain(c,key,s);
   try{await sendRaw(c,key,s,frame(s,"ack",ack));}
   catch(error){s.ackQueue.unshift(ack);retain(c,key,s);throw error;}
  } else {
   s.needResend=false;s.buffer="";retain(c,key,s);
   await sendRaw(c,key,s,frame(s,"resend"));
  }
 }
}
async function sendControl(c,key,s,type,fields={}) {
 await flushWire(c,key,s);
 await sendRaw(c,key,s,frame(s,type,fields));
 await flushWire(c,key,s);
}
async function pollNative(c,key,s) {
 await flushWire(c,key,s);
 if(s.closed)return;
 const r=await c.tools.write_stdin({session_id:s.sessionId,chars:"",yield_time_ms:10000,max_output_tokens:6000});
 consume(c,key,s,r);await flushWire(c,key,s);
}
async function resolveRequests(c,key,s,consumerId) {
 while(s.queue.length&&!s.closed){
  const id=s.queue[0],row=s.requests[id],f=row.frame;
  let actual=receipt(c,key,id);
  if(row.nativeAccepted){
   row.phase="RETURNED_TO_NATIVE";s.queue.shift();retain(c,key,s);continue;
  }
  if(actual?.phase==="CALLING"||actual?.phase==="RESULT_UNKNOWN"){
   row.phase=actual.phase;s.phase="LIBRARY_RESULT_RECONCILIATION";retain(c,key,s);return false;
  }
  if(actual?.result){
   row.result=actual.result;row.phase="RESULT_RETAINED";
   const grant=actual.grant;
   if(!grant?.grant_token||!grant.consumer_id)throw Error("The retained result lacks its original native grant.");
   await sendControl(c,key,s,"tool_result",{request_id:id,consumer_id:grant.consumer_id,
    grant_token:grant.grant_token,arguments_sha256:f.arguments_sha256,result:actual.result});
   row.phase=row.nativeAccepted?"RETURNED_TO_NATIVE":"RESPONSE_UNCERTAIN";retain(c,key,s);
   if(!row.nativeAccepted)return false;
   continue;
  }
  const name=ACTIONS[f.action],tool=c.tools[name];
  if(typeof tool!=="function"){s.phase="SUPPORTED_TOOL_NOT_EXPOSED";retain(c,key,s);throw Error("Missing supported "+name+".");}
  // A unique consumer is native-arbitrated; stale functions snapshots cannot grant themselves dispatch.
  row.phase="CLAIMING";retain(c,key,s);
  await sendControl(c,key,s,"tool_claim",{request_id:id,consumer_id:consumerId});
  let grant=row.grants.findLast(g=>g.consumer_id===consumerId);
  for(let n=0;!grant&&!s.closed&&n<6;n++){
   await pollNative(c,key,s);grant=row.grants.findLast(g=>g.consumer_id===consumerId);
  }
  actual=receipt(c,key,id);
  if(actual)continue;
  if(!grant||!grant.granted||!grant.dispatch_allowed||!grant.grant_token){
   row.phase="NATIVE_GRANT_RECONCILIATION";s.phase="LIBRARY_RESULT_RECONCILIATION";retain(c,key,s);return false;
  }
  actual={phase:"CALLING",requestId:id,action:f.action,argumentsSha256:f.arguments_sha256,
   grant,startedAt:new Date().toISOString()};
  saveReceipt(c,key,id,actual);row.phase="CALLING";retain(c,key,s);
  try{
   const result=await tool(f.arguments);
   if(!result||typeof result!=="object")throw Error("Supported Library action returned no complete result.");
   actual={...actual,phase:"RESULT_RETAINED",returnedAt:new Date().toISOString(),result};
   saveReceipt(c,key,id,actual);row.result=result;row.phase="RESULT_RETAINED";retain(c,key,s);
  }catch(error){
   actual={...actual,phase:"RESULT_UNKNOWN",error:String(error),failedAt:new Date().toISOString()};
   saveReceipt(c,key,id,actual);row.phase="RESULT_UNKNOWN";s.phase="LIBRARY_RESULT_RECONCILIATION";retain(c,key,s);
   throw error;
  }
 }
 return true;
}
/** Start exactly once under one durable key, after the existing owner is reconciled. */
export async function startConnectedOriginal(c,{key,selection,sourceBootstrap}) {
 if(c.load(key))throw Error("Resume the retained original invocation; do not admit it twice.");
 if(selection.operation!==OPERATION||!selection.connected_source?.content||!selection.receiver?.content||
    typeof sourceBootstrap!=="string")throw Error("Supply the complete reviewed original receiving input.");
 for(const name of Object.values(ACTIONS))if(typeof c.tools[name]!=="function")throw Error("Missing supported "+name+".");
 const s={operation:OPERATION,phase:"ADMISSION_PENDING",selection,sourceBootstrap,
  queue:[],requests:{},frames:[],rawChunks:[],buffer:"",nativeBuffers:{},wire:{},wireOrder:[],
  messages:{},commands:{},ackQueue:[],wireErrors:[],sourceReady:false,sourceSent:false,invocationId:null,closed:false};
 retain(c,key,s);
 try{
  const r=await c.tools.exec_command({cmd:"python3 -u -B -c "+quote(sourceBootstrap),
   workdir:selection.transport_parent||"/mnt/data",tty:true,login:false,yield_time_ms:1000,max_output_tokens:6000});
  consume(c,key,s,r);
 }catch(error){
  s.admissionError=String(error);s.phase=/before CreateProcess|environment_offline|failed to query exec-server capabilities/.test(String(error))
   ?"PREPROCESS_FAILED":"ADMISSION_RECONCILIATION";retain(c,key,s);throw error;
 }
 return resumeConnectedOriginal(c,{key});
}
export async function resumeConnectedOriginal(c,{key,control,controlId,reconciledResults,maxPolls=60}) {
 const s=c.load(key);
 if(!s||s.operation!==OPERATION)throw Error("Original receiving state is missing.");
 if(s.closed)return summary(s);
 if(s.sessionId===undefined)throw Error("Original admission has no returned session; reconcile that request.");
 const consumerId=newConsumerId();
 s.consumers??=[];s.consumers.push({consumerId,at:new Date().toISOString()});retain(c,key,s);
 if(reconciledResults){
  for(const[id,result]of Object.entries(reconciledResults)){
   const row=s.requests[id],actual=receipt(c,key,id);
   if(!row||!actual||!["CALLING","RESULT_UNKNOWN"].includes(actual.phase)||!result||typeof result!=="object")
    throw Error("Supply the complete actual retained result for the original native grant.");
   saveReceipt(c,key,id,{...actual,phase:"RESULT_RETAINED",reconciledAt:new Date().toISOString(),result});
   row.result=result;row.phase="RESULT_RETAINED";
  }
  retain(c,key,s);
 }
 async function sendSource(){
  if(!s.sourceReady||s.sourceSent)return;
  s.sourceSent=true;s.phase="SOURCE_INPUT_UNCERTAIN";retain(c,key,s);
  const r=await c.tools.write_stdin({session_id:s.sessionId,chars:JSON.stringify(s.selection)+"\n",
   yield_time_ms:1000,max_output_tokens:6000});
  consume(c,key,s,r);await flushWire(c,key,s);
 }
 await sendSource();await flushWire(c,key,s);
 if(control){
  if(!s.invocationId||control.operation!==OPERATION||control.root!==originalRoot)
   throw Error("Use the original controller operation/root.");
  if(!await resolveRequests(c,key,s,consumerId))return summary(s);
  if(typeof controlId!=="string"||!controlId)throw Error("Select and retain one original command ID before delivery.");
  const prior=s.commands[controlId];
  if(prior&&!sameValue(prior.value,control))throw Error("An original command cannot change.");
  if(!prior)s.commands[controlId]={value:control,phase:"INPUT_UNCERTAIN"};
  if(prior?.phase==="UNKNOWN")throw Error("Reconcile the original controller result before another control write.");
  s.receiverReady=false;retain(c,key,s);
  await sendControl(c,key,s,"receiver_input",{command_id:controlId,value:control});
 }
 for(let poll=0;poll<maxPolls&&!s.closed;poll++){
  if(!await resolveRequests(c,key,s,consumerId))return summary(s);
  if((s.receiverReady&&s.phase!=="REATTACH_ADMISSION_PENDING")||s.phase==="CONTROL_INPUT_FAILED"||s.phase==="NATIVE_TRANSPORT_DETACHED")break;
  await pollNative(c,key,s);await sendSource();
 }
 await resolveRequests(c,key,s,consumerId);return summary(s);
}

/** Reconnect only after the former tool connection's actual outcome is known.
 * This launches a private control client; the original native receiver is reused.
 */
export async function reattachConnectedOriginal(c,{key,previousSessionObservation}) {
 const s=c.load(key),a=s?.nativeAdmission;
 if(!s||s.operation!==OPERATION||!a?.control_file||!a?.transport_source_file||!a?.receiver_pid||!s.invocationId)
   throw Error("The actual admitted original receiver/control identity is required.");
 if(s.receiverExit&&s.closed)return summary(s);
 if(!previousSessionObservation||!["SESSION_ENDED","TRANSPORT_DISCONNECTED"].includes(previousSessionObservation.state)||
   typeof previousSessionObservation.detail!=="string"||!previousSessionObservation.detail||
   typeof previousSessionObservation.observedAt!=="string"||!Number.isFinite(Date.parse(previousSessionObservation.observedAt)))
   throw Error("Retain the actual previous connection outcome before reconnecting the same receiver.");
 if(s.phase==="REATTACH_ADMISSION_PENDING"||s.phase==="REATTACH_ADMISSION_RECONCILIATION")
   throw Error("Reconcile the pending original control-client admission.");
 const python=a.transport_python||"python3";
 const expected=s.selection.connected_source.sha256;
 if(!/^[a-f0-9]{64}$/.test(expected)||!a.transport_source_file.startsWith("/")||!a.control_file.startsWith("/"))
   throw Error("The retained complete source and private absolute paths are required.");
 const loader="import hashlib,pathlib,sys\n"+
  "p=pathlib.Path("+JSON.stringify(a.transport_source_file)+")\n"+
  "raw=p.read_bytes()\n"+
  "if hashlib.sha256(raw).hexdigest()!="+JSON.stringify(expected)+": raise RuntimeError('Original transport source changed')\n"+
  "sys.argv=[str(p),'--attach-control',"+JSON.stringify(a.control_file)+",'--expected-invocation',"+
   JSON.stringify(s.invocationId)+",'--expected-receiver-pid',"+JSON.stringify(String(s.receiverPid))+"]\n"+
  "exec(compile(raw,str(p),'exec'),{'__name__':'__main__','__file__':str(p)})\n";
 s.connectionHistory??=[];s.connectionHistory.push({sessionId:s.sessionId,observation:previousSessionObservation,
  processExit:s.processExit,at:new Date().toISOString()});
 s.sessionId=undefined;s.closed=false;s.phase="REATTACH_ADMISSION_PENDING";s.detached=true;
 // The old original output fragment belongs to the ended connection. Full validated
 // chunks/messages stay retained; any outstanding chunk will be replayed by native.
 if(s.buffer)s.wireErrors.push({kind:"DETACHED_PARTIAL_OUTPUT",line:s.buffer});
 s.buffer="";retain(c,key,s);
 try{
  const r=await c.tools.exec_command({cmd:quote(python)+" -u -B -c "+quote(loader),
   workdir:s.transportDirectory,tty:true,login:false,yield_time_ms:1000,max_output_tokens:6000});
  consume(c,key,s,r);
 }catch(error){
  s.reattachError=String(error);s.phase=/before CreateProcess|environment_offline|failed to query exec-server capabilities/.test(String(error))
   ?"REATTACH_PREPROCESS_FAILED":"REATTACH_ADMISSION_RECONCILIATION";retain(c,key,s);throw error;
 }
 return resumeConnectedOriginal(c,{key});
}
