#!/usr/bin/env node
// MIT — Python operates the original SF88 library, worker and review writers.
import {randomUUID} from 'node:crypto';
import {openLibrary} from '../resource-library/library.mjs';
import {readSnapshot, requireValue, digest} from '../resource-library/files.mjs';

const SCHEMA='stellar-forge.sf88.python-review.v1';
const MAX_FRAME=8*1024*1024, CHUNK=1024*1024;
let reportDescriptor,verifyHandover,available=[];
let library=null, closing=false, input=Buffer.alloc(0), output=Promise.resolve();
const active=new Map(), transfers=new Map();
const ACTIONS=[
  'library.status','library.scan','library.search','library.resource','library.preview','library.select',
  'annotation.save','annotation.history','collections.list','collections.show','collections.history','collections.save',
  'comparisons.begin','comparisons.run','comparisons.inspect','comparisons.list','comparisons.select',
  'comparisons.resume','comparisons.cancel','comparisons.wait','comparisons.changes','comparisons.decide',
  'comparisons.history','comparisons.import','returns.stage','returns.list','returns.inspect','returns.targets',
  'returns.choose','returns.apply','returns.decisions','returns.choices','handover.verify',
  'transfer.open','transfer.read','transfer.close','close'
];
function object(x){return x!==null&&typeof x==='object'&&!Array.isArray(x);}
function errorRecord(e){return {code:/^[A-Z0-9_]{1,120}$/.test(e?.code??'')?e.code:'REVIEW_NATIVE_FAILED',
  status:Number.isInteger(e?.status)?e.status:500};}
function send(frame){
  let raw=Buffer.from(JSON.stringify({schema:SCHEMA,...frame})+'\n');
  if(raw.length>MAX_FRAME)raw=Buffer.from(JSON.stringify({schema:SCHEMA,id:frame.id,ok:false,
    error:{code:'REVIEW_RESPONSE_TOO_LARGE',status:413}})+'\n');
  output=output.then(()=>new Promise((resolve,reject)=>process.stdout.write(raw,error=>error?reject(error):resolve())));
  return output;
}
async function readPacket(parameters){
  requireValue(typeof parameters.path==='string','HANDOVER_PATH_REQUIRED');
  const bytes=await readSnapshot(parameters.path,128*1024*1024);
  if(parameters.sha256!==undefined)requireValue(digest(bytes)===parameters.sha256,'HANDOVER_FILE_DIGEST_MISMATCH',409);
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
  catch{requireValue(false,'HANDOVER_JSON_INVALID');}
}
async function releaseTransfer(id){
  const entry=transfers.get(id);if(!entry)return {closed:true};
  transfers.delete(id);await entry.descriptor.dispose();return {closed:true};
}
async function dispatch(action,p,signal){
  if(action==='open'){
    requireValue(!library&&!closing,'REVIEW_ALREADY_OPEN',409);
    const [major,minor]=process.versions.node.split('.').map(Number);
    requireValue(major>22||(major===22&&minor>=16),'REVIEW_NODE_22_16_REQUIRED');
    library=await openLibrary(p);
    // The existing source library remains usable while its optional edition
    // product is composed. Never install or synthesize a comparison engine.
    if(library.comparisons){
      ({reportDescriptor}=await import('../resource-library/comparison-transfer.mjs'));
      ({verifyHandover}=await import('../resource-library/comparison-report.mjs'));
    }
    available=ACTIONS.filter(action=>action.startsWith('returns.')?Boolean(library.comparisons?.returns):
      action.startsWith('comparisons.')||action==='handover.verify'?Boolean(library.comparisons):true);
    return {schema:SCHEMA,node:process.versions.node,actions:available,
      features:{resources:true,comparisons:Boolean(library.comparisons),returns:Boolean(library.comparisons?.returns)},library:library.status()};
  }
  requireValue(library&&!closing,'REVIEW_NOT_OPEN',409);
  requireValue(available.includes(action),'REVIEW_CAPABILITY_UNAVAILABLE',409);
  const c=library.comparisons,r=c?.returns,{id,options={},input:body={}}=p;
  switch(action){
    case 'library.status':return library.status();
    case 'library.scan':return library.scan({signal});
    case 'library.search':return library.search(p);
    case 'library.resource':return library.resource(id);
    case 'library.preview':return library.preview(id,{signal});
    case 'library.select':return library.select(id);
    case 'annotation.save':return library.saveAnnotation(id,body);
    case 'annotation.history':return library.revisions(id);
    case 'collections.list':return library.collections.list(p);
    case 'collections.show':return library.collections.show(id,p.revision);
    case 'collections.history':return library.collections.history(id,options);
    case 'collections.save':return library.collections.save(p);
    case 'comparisons.begin':return c.begin(p);
    case 'comparisons.run':{const started=c.begin(p);return c.wait(started.id,{signal});}
    case 'comparisons.inspect':return c.inspect(id);
    case 'comparisons.list':return c.list(p);
    case 'comparisons.select':return c.select(id);
    case 'comparisons.resume':{const result=c.resume(id,options);return p.wait?c.wait(id,{signal}):result;}
    case 'comparisons.cancel':return c.cancel(id);
    case 'comparisons.wait':return c.wait(id,{signal});
    case 'comparisons.changes':return c.changes(id,options);
    case 'comparisons.decide':return c.decide(id,body);
    case 'comparisons.history':return c.history(id,options);
    case 'comparisons.import':return c.importHandover(await readPacket(p),{operationId:p.operationId});
    case 'returns.stage':return r.stage(await readPacket(p),{operationId:p.operationId});
    case 'returns.list':return r.list(p);
    case 'returns.inspect':return r.inspect(id);
    case 'returns.targets':return r.targets(id,options);
    case 'returns.choose':return r.choose(id,body);
    case 'returns.apply':return r.apply(id,body);
    case 'returns.decisions':return r.decisionHistory(id,options);
    case 'returns.choices':return r.choiceHistory(id,options);
    case 'handover.verify':{
      const packet=verifyHandover(await readPacket(p));
      return {schema:packet.schema,handoverSha256:packet.handoverSha256,comparisonId:packet.comparison.id,
        resultSha256:packet.comparison.resultSha256,changes:packet.changes.length,decisions:packet.decisions.length};
    }
    case 'transfer.open':{
      requireValue(transfers.size<8,'REVIEW_TRANSFER_CAPACITY',409);
      requireValue(['resource','comparison','return','library-review'].includes(p.kind),'REVIEW_TRANSFER_KIND_INVALID');
      let descriptor;
      if(p.kind==='resource')descriptor=await library.download(id,{signal});
      else {
        requireValue(typeof reportDescriptor==='function','REVIEW_COMPARISON_RUNTIME_REQUIRED',409);
        const report=p.kind==='return'?r.handover(id,{format:p.format??'json'}):
          p.kind==='library-review'?{filename:'resource-review.json',mime:'application/json',
            chunks:(async function*(){yield JSON.stringify(library.exportReview(),null,2)+'\n';})()}:undefined;
        descriptor=await reportDescriptor(library,id??'resource-review',{format:p.format??'json',signal,report});
      }
      const token=randomUUID(),metadata={token,kind:p.kind,id:id??null,format:p.format??'json',
        bytes:descriptor.bytes,sha256:descriptor.sha256,name:descriptor.resource.name};
      transfers.set(token,{descriptor,metadata});return metadata;
    }
    case 'transfer.read':{
      const entry=transfers.get(p.token);requireValue(entry,'REVIEW_TRANSFER_NOT_FOUND',404);
      requireValue(Number.isSafeInteger(p.offset)&&p.offset>=0&&p.offset<=entry.metadata.bytes,'REVIEW_TRANSFER_OFFSET_INVALID');
      const length=p.length??CHUNK;requireValue(Number.isSafeInteger(length)&&length>=1&&length<=CHUNK,'REVIEW_TRANSFER_LENGTH_INVALID');
      const wanted=Math.min(length,entry.metadata.bytes-p.offset),bytes=Buffer.alloc(wanted);let got=0;
      while(got<wanted){signal.throwIfAborted();const part=await entry.descriptor.file.read(bytes,got,wanted-got,p.offset+got);
        requireValue(part.bytesRead>0,'REVIEW_TRANSFER_UNEXPECTED_EOF',409);got+=part.bytesRead;}
      return {token:p.token,offset:p.offset,bytes:got,sha256:digest(bytes),data:bytes.toString('base64'),
        totalBytes:entry.metadata.bytes,nextOffset:p.offset+got===entry.metadata.bytes?null:p.offset+got};
    }
    case 'transfer.close':return releaseTransfer(p.token);
    case 'close':{
      closing=true;for(const controller of active.values())controller.abort();
      for(const token of [...transfers.keys()])await releaseTransfer(token);
      await library.close();return {closed:true};
    }
    default:requireValue(false,'REVIEW_ACTION_INVALID');
  }
}
async function shutdown(){
  if(!closing){closing=true;for(const controller of active.values())controller.abort();
    for(const token of [...transfers.keys()])await releaseTransfer(token).catch(()=>{});
    if(library)await library.close().catch(()=>{});}
  await output.catch(()=>{});
}
async function receive(frame){
  if(object(frame)&&typeof frame.cancel==='string'){active.get(frame.cancel)?.abort();return;}
  let id=object(frame)?frame.id:null;
  try{
    requireValue(object(frame)&&frame.schema===SCHEMA&&typeof id==='string'&&id.length<=100&&
      typeof frame.action==='string'&&object(frame.parameters??{}),'REVIEW_PROTOCOL_INVALID');
    requireValue(!active.has(id)&&active.size<32,'REVIEW_REQUEST_BUSY',409);
    const controller=new AbortController();active.set(id,controller);
    try {const result=await dispatch(frame.action,frame.parameters??{},controller.signal);await send({id,ok:true,result});}
    finally{active.delete(id);}
    if(frame.action==='close'){process.stdin.pause();await output;process.exitCode=0;}
  }catch(error){await send({id,ok:false,error:errorRecord(error)});}
}
process.stdin.on('data',part=>{
  input=Buffer.concat([input,part]);let end;
  while((end=input.indexOf(10))>=0){const line=input.subarray(0,end);input=input.subarray(end+1);
    if(line.length>MAX_FRAME){void send({id:null,ok:false,error:{code:'REVIEW_REQUEST_TOO_LARGE',status:413}});void shutdown();process.stdin.destroy();return;}
    try{void receive(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(line))).catch(()=>shutdown());}
    catch{void send({id:null,ok:false,error:{code:'REVIEW_PROTOCOL_INVALID',status:400}});}
  }
  if(input.length>MAX_FRAME){void shutdown();process.stdin.destroy();}
});
process.stdin.on('end',()=>void shutdown());process.stdin.on('error',()=>void shutdown());
process.stdout.on('error',()=>void shutdown());
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{process.stdin.destroy();void shutdown();});
