/* Conservation working files. Browser-local drafts, never native execution.
 * TokenJunkieLabs. Original JSON values are preserved, including unfinished forms.
 */
export const WORKING_SCHEMA = "upstate.conservation-working-file/v1";
export const WORKING_DATABASE = "upstate-conservation-working";
export const WORKING_LIMITS = Object.freeze({maxFileBytes:32*1024*1024,maxNamedEditions:256,maxDepth:128,maxNodes:2000000,maxAncestry:4096});
const HASH=/^[a-f0-9]{64}$/;
const own=(v,k)=>Object.prototype.hasOwnProperty.call(v,k);
const plain=v=>v!==null&&typeof v==="object"&&!Array.isArray(v)&&(Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null);
export class ConservationWorkingError extends Error {
  constructor(code,message,details={},candidate=null){super(message);this.name="ConservationWorkingError";this.code=code;this.details=details;if(candidate)this.candidate=candidate;}
}
function fail(code,message,details){throw new ConservationWorkingError(code,message,details);}
function need(ok,message,code="INVALID_FILE"){if(!ok)fail(code,message);}
function text(value,label,max=8192){need(typeof value==="string"&&value.trim().length>0&&value.length<=max,label+" must be nonempty text of at most "+max+" characters.");return value;}
function revision(value){need(Number.isSafeInteger(value)&&value>=1,"The working revision must be a positive safe integer.");return value;}
function canonical(value){
  if(value===null||typeof value!=="object")return JSON.stringify(value);
  if(Array.isArray(value))return "["+value.map(canonical).join(",")+"]";
  return "{"+Object.keys(value).sort().map(k=>JSON.stringify(k)+":"+canonical(value[k])).join(",")+"}";
}
function jsonCopy(value,limits){
  let nodes=0;const seen=new Set();
  function visit(v,depth){
    need(++nodes<=limits.maxNodes&&depth<=limits.maxDepth,"The working file exceeds the JSON structure limit.","LIMIT");
    if(v===null||typeof v==="string"||typeof v==="boolean")return;
    if(typeof v==="number"){need(Number.isFinite(v)&&(!Number.isInteger(v)||Number.isSafeInteger(v))&&!Object.is(v,-0),"Working values must use finite, safely represented JSON numbers; preserve unfinished or exact numeric text as strings.");return;}
    need(typeof v==="object"&&(Array.isArray(v)||plain(v)),"Working values must be ordinary JSON values; functions, undefined, dates and class instances are not retained.");
    need(!seen.has(v),"Working values cannot contain circular references.");seen.add(v);
    if(Array.isArray(v)){
      need(Object.keys(v).length===v.length,"Working arrays must be dense and have no extra properties.");
      for(let i=0;i<v.length;i++){const d=Object.getOwnPropertyDescriptor(v,String(i));need(d&&own(d,"value"),"Working values cannot use getters.");visit(d.value,depth+1);}
    }else{
      need(Object.getOwnPropertySymbols(v).length===0,"Working values cannot use symbol properties.");
      for(const k of Object.keys(v)){const d=Object.getOwnPropertyDescriptor(v,k);need(d&&own(d,"value"),"Working values cannot use getters.");visit(d.value,depth+1);}
    }seen.delete(v);
  }visit(value,0);return JSON.parse(JSON.stringify(value));
}
function fields(value,required,optional=[],label="record"){
  need(plain(value),"The "+label+" must be a JSON object.");
  need(required.every(k=>own(value,k))&&Object.keys(value).every(k=>required.includes(k)||optional.includes(k)),"The "+label+" has missing or unsupported fields.");
}
function iso(value){need(typeof value==="string"&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value,"Retain an exact UTC ISO timestamp.");return value;}
const alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function base64(bytes){let out="";for(let i=0;i<bytes.length;i+=3){const a=bytes[i],b=bytes[i+1],c=bytes[i+2];out+=alphabet[a>>2]+alphabet[((a&3)<<4)|((b??0)>>4)]+(b===undefined?"=":alphabet[((b&15)<<2)|((c??0)>>6)])+(c===undefined?"=":alphabet[c&63]);}return out;}
function unbase64(s,limit){
  need(typeof s==="string"&&s.length<=4*Math.ceil(limit/3)&&s.length%4===0&&/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(s),"An original source has invalid or oversized Base64.","INVALID_SOURCE");
  const size=s.length/4*3-(s.endsWith("==")?2:s.endsWith("=")?1:0),out=new Uint8Array(size);let j=0;
  for(let i=0;i<s.length;i+=4){const a=alphabet.indexOf(s[i]),b=alphabet.indexOf(s[i+1]),c=s[i+2]==="="?0:alphabet.indexOf(s[i+2]),d=s[i+3]==="="?0:alphabet.indexOf(s[i+3]);out[j++]=(a<<2)|(b>>4);if(j<size)out[j++]=((b&15)<<4)|(c>>2);if(j<size)out[j++]=((c&3)<<6)|d;}
  need(base64(out)===s,"Retain canonical, complete Base64 original bytes.","INVALID_SOURCE");return out;
}
function publicError(error,candidate=null){
  if(error instanceof ConservationWorkingError){if(candidate&&!error.candidate)error.candidate=candidate;return error;}
  const quota=error?.name==="QuotaExceededError",e=new ConservationWorkingError(quota?"QUOTA":"STORAGE",quota?"Browser storage is full. Existing work is unchanged; download the retained candidate or save it elsewhere.":"The browser could not commit this working file. Existing work is unchanged; keep or download the retained candidate.",{cause:error?.name||"Error",message:error?.message||String(error)},candidate);e.cause=error;return e;
}
export function createConservationWorkingTools(options={}){
  const crypto=options.crypto??globalThis.crypto,now=options.now??(()=>new Date().toISOString());
  const limits={...WORKING_LIMITS,...Object.fromEntries(Object.entries(options).filter(([k])=>own(WORKING_LIMITS,k)))};
  for(const [k,v] of Object.entries(limits))need(Number.isSafeInteger(v)&&v>0,"Working capacity "+k+" must be a positive safe integer.","CONFIGURATION");
  const encoder=new TextEncoder(),decoder=new TextDecoder("utf-8",{fatal:true,ignoreBOM:true});
  function bytesOf(value){
    let out;if(typeof value==="string")out=encoder.encode(value);else if(value instanceof Uint8Array)out=new Uint8Array(value);else if(value instanceof ArrayBuffer)out=new Uint8Array(value.slice(0));else fail("INVALID_FILE","Supply a UTF-8 string, Uint8Array or ArrayBuffer.");
    need(out.byteLength<=limits.maxFileBytes,"The working file exceeds the "+limits.maxFileBytes+" byte limit.","LIMIT");return out;
  }
  async function hash(bytes){need(crypto?.subtle?.digest,"SHA-256 is unavailable. Use a secure browser context.","UNAVAILABLE");const value=await crypto.subtle.digest("SHA-256",bytes);return Array.from(new Uint8Array(value),n=>n.toString(16).padStart(2,"0")).join("");}
  const hashJSON=value=>hash(encoder.encode(canonical(value)));
  function uuid(){need(crypto?.getRandomValues,"Secure browser identity generation is unavailable.","UNAVAILABLE");if(crypto.randomUUID)return "cw-"+crypto.randomUUID();const b=crypto.getRandomValues(new Uint8Array(16));b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;const h=Array.from(b,n=>n.toString(16).padStart(2,"0")).join("");return "cw-"+h.slice(0,8)+"-"+h.slice(8,12)+"-"+h.slice(12,16)+"-"+h.slice(16,20)+"-"+h.slice(20);}
  function payloadCopy(value,projectId=null){const v=jsonCopy(value,limits);need(plain(v)&&plain(v.project),"Retain the working payload and its original project object.");text(v.project.id,"Original project ID",2048);if(projectId!==null)need(v.project.id===projectId,"The draft belongs to a different original project.","PROJECT_MISMATCH");if(own(v,"workspace_key"))need(v.workspace_key===null||typeof v.workspace_key==="string","workspace_key is informational local text or null.");return v;}
  function stamp(){return iso(now());}
  function bare(file){const {sha256,...body}=file;return body;}
  async function seal(file){file.sha256=await hashJSON(bare(file));need(encoder.encode(JSON.stringify(file)).byteLength<=limits.maxFileBytes,"The complete working file exceeds the byte limit, including named editions and original sources.","LIMIT");return file;}
  function labelRecord(value){fields(value,["filename","mediaType"],[],"source label");text(value.filename,"Original filename");text(value.mediaType,"Original media type");}
  function ancestryRecord(value){
    fields(value,["id","projectId","revision","sha256","relation"],["importSha256","importBytes","filename"],"original ancestry");
    text(value.id,"Original working ID");text(value.projectId,"Original project ID",2048);revision(value.revision);need(HASH.test(value.sha256),"Retain the original working seal.");
    need(["fork","import"].includes(value.relation),"Retain an explicit fork or import relationship.");
    if(value.relation==="import"){need(HASH.test(value.importSha256)&&Number.isSafeInteger(value.importBytes)&&value.importBytes>=0,"Retain the original import byte identity.");text(value.filename,"Imported filename");}
  }
  function flatten(rows){const seen=new Set(),result=[];for(const r of rows){ancestryRecord(r);const key=canonical(r);if(!seen.has(key)){seen.add(key);result.push(r);}}need(result.length<=limits.maxAncestry,"The flat original ancestry exceeds the configured limit.","LIMIT");return result;}
  async function validateFile(input){
    const f=jsonCopy(input,limits);fields(f,["schema","id","projectId","name","revision","previousSha256","createdAt","updatedAt","active","editions","ancestry","originals","sha256"],[],"working file");
    need(f.schema===WORKING_SCHEMA,"Choose a supported Conservation working file.");text(f.id,"Working ID");text(f.projectId,"Original project ID",2048);text(f.name,"Working file name");revision(f.revision);iso(f.createdAt);iso(f.updatedAt);
    need(f.revision===1?f.previousSha256===null:HASH.test(f.previousSha256),"Retain the immediate previous working-file seal.");need(f.updatedAt>=f.createdAt,"The working file timestamp precedes its creation.");need(HASH.test(f.sha256),"Retain the complete working-file SHA-256.");
    fields(f.active,["payload","sha256"],[],"active draft");payloadCopy(f.active.payload,f.projectId);need(HASH.test(f.active.sha256)&&await hashJSON(f.active.payload)===f.active.sha256,"The active draft differs from its retained hash.","INTEGRITY");
    need(Array.isArray(f.editions)&&f.editions.length<=limits.maxNamedEditions,"Too many named working editions.","LIMIT");const ids=new Set();
    for(const e of f.editions){fields(e,["id","label","createdAt","payload","sha256"],[],"named edition");text(e.id,"Edition ID");text(e.label,"Edition label");iso(e.createdAt);need(!ids.has(e.id),"Named editions repeat an identity.");ids.add(e.id);payloadCopy(e.payload,f.projectId);need(HASH.test(e.sha256)&&await hashJSON(e.payload)===e.sha256,"A named edition differs from its retained hash.","INTEGRITY");}
    need(Array.isArray(f.ancestry),"Retain a flat ancestry array.");need(flatten(f.ancestry).length===f.ancestry.length,"The original ancestry repeats a receipt.");
    need(Array.isArray(f.originals),"Retain a flat original-source array.");const originals=new Set();
    for(const o of f.originals){fields(o,["sha256","bytes","labels","base64"],[],"original source");need(HASH.test(o.sha256)&&Number.isSafeInteger(o.bytes)&&o.bytes>=0&&!originals.has(o.sha256),"Retain one identity for each original source.");originals.add(o.sha256);need(Array.isArray(o.labels)&&o.labels.length>0,"Retain original source labels.");o.labels.forEach(labelRecord);const bytes=unbase64(o.base64,limits.maxFileBytes);need(bytes.length===o.bytes&&await hash(bytes)===o.sha256,"An original source differs from its retained bytes.","INTEGRITY");}
    need(await hashJSON(bare(f))===f.sha256,"The complete working file differs from its retained SHA-256.","INTEGRITY");need(encoder.encode(JSON.stringify(f)).length<=limits.maxFileBytes,"The complete working file exceeds the byte limit.","LIMIT");return f;
  }
  async function sources(inputs,existing=[]){
    const map=new Map(existing.map(x=>[x.sha256,jsonCopy(x,limits)]));
    for(const raw of inputs){const b=raw.bytes,labels=raw.labels,id=await hash(b),prior=map.get(id);
      if(prior){need(prior.bytes===b.length&&prior.base64===base64(b),"An original-source hash names different bytes.","INTEGRITY");for(const label of labels)if(!prior.labels.some(x=>canonical(x)===canonical(label)))prior.labels.push(label);}
      else map.set(id,{sha256:id,bytes:b.length,labels,base64:base64(b)});
    }return [...map.values()];
  }
  function admittedSources(inputs=[]){need(Array.isArray(inputs),"Original sources must be an array.");return inputs.map(o=>{need(plain(o),"An original source needs bytes and a label.");const label={filename:o.filename,mediaType:o.mediaType??"application/octet-stream"};labelRecord(label);return{bytes:bytesOf(o.bytes),labels:[label]};});}
  async function makeFile({payload,name,existingFile=null,originals=[]}){
    const p=payloadCopy(payload),old=existingFile===null?null:jsonCopy(existingFile,limits),originalBytes=admittedSources(originals),n=name===undefined?undefined:text(name,"Working file name");
    const f=old?await validateFile(old):{schema:WORKING_SCHEMA,id:uuid(),projectId:p.project.id,name:n??"Conservation working file",revision:0,previousSha256:null,createdAt:stamp(),updatedAt:null,active:null,editions:[],ancestry:[],originals:[]};
    need(f.projectId===p.project.id,"Save this draft only in its original project.","PROJECT_MISMATCH");need(f.revision<Number.MAX_SAFE_INTEGER,"The working revision is exhausted.","LIMIT");
    f.previousSha256=f.revision===0?null:f.sha256;f.revision++;if(n!==undefined)f.name=n;f.updatedAt=stamp();need(f.updatedAt>=f.createdAt,"The local clock precedes this working file. Correct it before saving.","CLOCK");
    f.active={payload:p,sha256:await hashJSON(p)};f.originals=await sources(originalBytes,f.originals);return seal(f);
  }
  async function encodeFile(value){
    const f=await validateFile(value),bytes=encoder.encode(JSON.stringify(f));need(bytes.length<=limits.maxFileBytes,"The export exceeds the working byte limit.","LIMIT");
    const filename=(f.name.replace(/[\\/:*?"<>|\u0000-\u001f]/g,"_").slice(0,140)||"conservation-working")+".conservation-working.json";
    return {file:f,bytes,sha256:await hash(bytes),filename,mediaType:"application/json"};
  }
  async function inspectFile(value){
    const bytes=bytesOf(value);let parsed;try{parsed=JSON.parse(decoder.decode(bytes));}catch(e){fail("INVALID_FILE","Choose a complete UTF-8 JSON Conservation working file.",{cause:e.message});}
    const file=await validateFile(parsed);return {file,sha256:await hash(bytes),bytes:bytes.length};
  }
  async function makeImport({bytes,expectedProjectId,name,filename="imported.conservation-working.json"}){
    const raw=bytesOf(bytes),projectId=text(expectedProjectId,"Expected original project ID",2048),n=name===undefined?undefined:text(name,"Working file name");text(filename,"Imported filename");
    const inspected=await inspectFile(raw),parent=inspected.file;need(parent.projectId===projectId,"The imported file belongs to another original project. Open that project explicitly.","PROJECT_MISMATCH");
    const f=jsonCopy(parent,limits);f.id=uuid();f.revision=1;f.previousSha256=null;f.createdAt=stamp();f.updatedAt=f.createdAt;if(n!==undefined)f.name=n;
    f.ancestry=flatten([...f.ancestry,{id:parent.id,projectId:parent.projectId,revision:parent.revision,sha256:parent.sha256,relation:"import",importSha256:inspected.sha256,importBytes:raw.length,filename}]);
    return {file:await seal(f),originalImport:{sha256:inspected.sha256,bytes:raw.length,base64:base64(raw)}};
  }
  async function forkFile({existingFile,payload,name}){
    const old=jsonCopy(existingFile,limits),p=payload===undefined?undefined:payloadCopy(payload),n=name===undefined?undefined:text(name,"Working file name"),parent=await validateFile(old);
    const f=jsonCopy(parent,limits);f.id=uuid();f.revision=1;f.previousSha256=null;f.createdAt=stamp();f.updatedAt=f.createdAt;f.name=n??parent.name+" (copy)";
    if(p!==undefined){payloadCopy(p,parent.projectId);f.active={payload:p,sha256:await hashJSON(p)};}
    f.ancestry=flatten([...f.ancestry,{id:parent.id,projectId:parent.projectId,revision:parent.revision,sha256:parent.sha256,relation:"fork"}]);return seal(f);
  }
  async function editionFile({existingFile,label,payload}){
    const old=jsonCopy(existingFile,limits),p=payload===undefined?undefined:payloadCopy(payload),l=text(label,"Named edition label"),f=await makeFile({existingFile:old,payload:p??old.active.payload});
    need(f.editions.length<limits.maxNamedEditions,"The named-edition limit is reached. Export the complete file and start a new working file; existing editions remain intact.","LIMIT");
    f.editions.push({id:uuid(),label:l,createdAt:f.updatedAt,payload:jsonCopy(f.active.payload,limits),sha256:f.active.sha256});return seal(f);
  }
  async function restoreFile({existingFile,editionId}){const f=await validateFile(existingFile),e=f.editions.find(x=>x.id===editionId);need(e,"Choose an existing named edition.","NOT_FOUND");return makeFile({existingFile:f,payload:e.payload});}
  return Object.freeze({limits,makeFile,encodeFile,inspectFile,makeImport,forkFile,editionFile,restoreFile,validateFile,hash,bytesOf});
}
let defaultTools;
const defaults=()=>defaultTools??(defaultTools=createConservationWorkingTools());
export const makeFile=args=>defaults().makeFile(args);
export const encodeFile=file=>defaults().encodeFile(file);
export const inspectFile=bytes=>defaults().inspectFile(bytes);
export const forkFile=args=>defaults().forkFile(args);
export const makeImport=args=>defaults().makeImport(args);

export async function openConservationWorkingStore(options={}){
  const factory=options.indexedDB??globalThis.indexedDB;
  need(factory?.open,"IndexedDB is unavailable. Keep the complete local draft and download a working file.","UNAVAILABLE");
  const tools=createConservationWorkingTools(options),dbName=options.databaseName??WORKING_DATABASE; text(dbName,"Working database name");
  const db=await new Promise((resolve,reject)=>{
    let settled=false;const request=factory.open(dbName,1);
    request.onupgradeneeded=()=>{const database=request.result;
      for(const name of ["files","heads"]){const s=database.createObjectStore(name,{keyPath:["projectId","id"]});s.createIndex("project","projectId",{unique:false});}
      database.createObjectStore("objects",{keyPath:"sha256"});database.createObjectStore("imports",{keyPath:"sha256"});
    };
    request.onerror=()=>{if(!settled){settled=true;reject(publicError(request.error));}};
    request.onblocked=()=>{if(!settled){settled=true;reject(new ConservationWorkingError("BLOCKED","Another tab is blocking working-storage startup. Close its old connection and retry; retain your current draft."));}};
    request.onsuccess=()=>{if(settled){request.result.close();return;}settled=true;resolve(request.result);};
  });
  let closed=false;db.onversionchange=()=>{closed=true;db.close();options.onVersionChange?.();};
  function check(){need(!closed,"Working storage is closed. Reopen it while retaining your current draft.","CLOSED");}
  const key=(projectId,id)=>[text(projectId,"Original project ID",2048),text(id,"Working file ID")];
  function transact(names,mode,body,candidate=null){
    return new Promise((resolve,reject)=>{
      let tx,out,error;
      try{check();tx=db.transaction(names,mode);}catch(e){reject(publicError(e,candidate));return;}
      const abort=e=>{if(!error)error=e;try{tx.abort();}catch{}};
      tx.oncomplete=()=>resolve(out);tx.onabort=()=>reject(publicError(error??tx.error??new Error("Transaction aborted"),candidate));
      tx.onerror=()=>{if(!error)error=tx.error;};
      try{body(tx,value=>{out=value;},abort);}catch(e){abort(e);}
    });
  }
  function request(req,success,abort){req.onsuccess=()=>{try{success(req.result);}catch(e){abort(e);}};req.onerror=()=>abort(req.error);}
  function summary(f){return {id:f.id,projectId:f.projectId,name:f.name,revision:f.revision,createdAt:f.createdAt,updatedAt:f.updatedAt,sha256:f.sha256,editionCount:f.editions.length,originalCount:f.originals.length,workspace_key:f.active.payload.workspace_key??null};}
  async function read(projectId,id){
    const k=key(projectId,id);
    const f=await transact(["files","objects"],"readonly",(tx,done,abort)=>{
      request(tx.objectStore("files").get(k),row=>{
        need(row,"This working file is not present in this browser project.","NOT_FOUND");need(row.projectId===projectId&&row.id===id,"The stored working identity is inconsistent.","INTEGRITY");
        const file=row;let remaining=file.originals.length;
        if(!remaining){done(file);return;}
        for(const o of file.originals)request(tx.objectStore("objects").get(o.sha256),obj=>{
          need(obj&&obj.sha256===o.sha256&&obj.bytes===o.bytes,"An original working-file source object is missing.","INTEGRITY");o.base64=obj.base64;if(--remaining===0)done(file);
        },abort);
      },abort);
    });return tools.validateFile(f);
  }
  async function commit(input,expectedRevision,{originalImport=null}={}){
    // All cloning, hashes and byte validation complete before the IDB transaction.
    const f=await tools.validateFile(input),expected=expectedRevision;
    need(expected===null||(Number.isSafeInteger(expected)&&expected>=1),"Supply the original revision for compare-and-swap.","REVISION");
    need(expected===null?f.revision===1:f.revision===expected+1,"A saved candidate must advance exactly one original revision.","REVISION");
    const row=JSON.parse(JSON.stringify(f)),objects=row.originals.map(o=>({sha256:o.sha256,bytes:o.bytes,base64:o.base64}));
    row.originals.forEach(o=>delete o.base64);
    let imported=null;if(originalImport){imported=JSON.parse(JSON.stringify(originalImport));const raw=unbase64(imported.base64,tools.limits.maxFileBytes);need(raw.length===imported.bytes&&await tools.hash(raw)===imported.sha256,"The imported original bytes changed.","INTEGRITY");}
    return transact(["files","heads","objects","imports"],"readwrite",(tx,done,abort)=>{
      request(tx.objectStore("files").get([f.projectId,f.id]),current=>{
        if(expected===null?Boolean(current):!current||current.revision!==expected){
          const e=new ConservationWorkingError("CONFLICT","Another tab changed this working file. Your complete candidate is retained; reload explicitly or save it as a new independent file.",{id:f.id,projectId:f.projectId,expectedRevision:expected,currentRevision:current?.revision??null,currentSha256:current?.sha256??null},f);throw e;
        }
        if(current){
          need(f.previousSha256===current.sha256&&f.createdAt===current.createdAt,"The candidate no longer follows the exact retained working file.","CONFLICT");
          need(current.editions.every((e,i)=>canonical(e)===canonical(f.editions[i])),"Named editions are immutable; fork or restore explicitly.","IMMUTABLE");
          need(current.ancestry.every((e,i)=>canonical(e)===canonical(f.ancestry[i])),"Retain the original flat ancestry unchanged.","IMMUTABLE");
          for(const original of current.originals){const next=f.originals.find(o=>o.sha256===original.sha256);need(next&&next.bytes===original.bytes&&original.labels.every(label=>next.labels.some(x=>canonical(x)===canonical(label))),"Retain every original source and label.","IMMUTABLE");}
        }
        const retain=(storeName,obj)=>request(tx.objectStore(storeName).get(obj.sha256),existing=>{
          if(existing)need(existing.bytes===obj.bytes&&existing.base64===obj.base64,"An original byte identity conflicts with stored content.","INTEGRITY");
          else tx.objectStore(storeName).add(obj);
        },abort);
        objects.forEach(o=>retain("objects",o));if(imported)retain("imports",imported);
        tx.objectStore("files").put(row);tx.objectStore("heads").put(summary(f));done(f);
      },abort);
    },f);
  }
  function admission(args){return jsonCopy(args,tools.limits);}
  async function create(args){const f=await tools.makeFile(args);return commit(f,null);}
  async function save(args){const a=admission(args),old=await read(a.projectId,a.fileId);
    if(old.revision!==a.expectedRevision){const candidate=await tools.makeFile({payload:a.payload,name:a.name,existingFile:a.existingFile??old});throw new ConservationWorkingError("CONFLICT","The selected file has changed. Your local draft is preserved as a downloadable candidate; reload or fork explicitly.",{expectedRevision:a.expectedRevision,currentRevision:old.revision},candidate);}
    const f=await tools.makeFile({payload:a.payload,name:a.name,existingFile:old});return commit(f,a.expectedRevision);
  }
  async function saveEdition(args){const a=admission(args),old=await read(a.projectId,a.fileId),f=await tools.editionFile({existingFile:old,label:a.label,...(own(a,"payload")?{payload:a.payload}:{})});
    if(old.revision!==a.expectedRevision)throw new ConservationWorkingError("CONFLICT","The named edition was not saved because another tab changed this file. Retain or export the complete candidate.",{expectedRevision:a.expectedRevision,currentRevision:old.revision},f);
    return commit(f,a.expectedRevision);
  }
  async function restoreEdition(args){const a=admission(args),old=await read(a.projectId,a.fileId),f=await tools.restoreFile({existingFile:old,editionId:a.editionId});
    if(old.revision!==a.expectedRevision)throw new ConservationWorkingError("CONFLICT","The edition was not restored because another tab changed this file. Keep the current local draft.",{expectedRevision:a.expectedRevision,currentRevision:old.revision},f);
    return commit(f,a.expectedRevision);
  }
  async function fork(args){const a=admission(args),old=a.existingFile??await read(a.projectId,a.fileId);need(old.projectId===a.projectId,"Fork only the selected original project.","PROJECT_MISMATCH");const f=await tools.forkFile({existingFile:old,...(own(a,"payload")?{payload:a.payload}:{}),...(own(a,"name")?{name:a.name}:{})});return commit(f,null);}
  async function importFile(args){const {file,originalImport}=await tools.makeImport(args);return commit(file,null,{originalImport});}
  async function exportFile(projectId,id){return tools.encodeFile(await read(projectId,id));}
  async function list(projectId){text(projectId,"Original project ID",2048);const rows=await transact(["heads"],"readonly",(tx,done,abort)=>{
    const out=[];request(tx.objectStore("heads").index("project").openCursor(projectId),cursor=>{if(!cursor){done(out);return;}out.push(cursor.value);cursor.continue();},abort);
  });return rows.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)||a.id.localeCompare(b.id));}
  async function recover(projectId){
    // Explicit recovery validates each original file independently; one damaged
    // file does not hide the rest. It never restores a scientific/native action.
    const rows=await list(projectId),files=[],issues=[];
    for(const row of rows){try{files.push(await read(projectId,row.id));}catch(e){issues.push({id:row.id,code:e.code??"INVALID_FILE",message:e.message});}}
    return {projectId,files,issues};
  }
  async function readImportedBytes(sha256){need(HASH.test(sha256),"Choose an exact retained import hash.");const obj=await transact(["imports"],"readonly",(tx,done,abort)=>request(tx.objectStore("imports").get(sha256),done,abort));need(obj,"The exact original import bytes are not retained in this browser.","NOT_FOUND");const bytes=unbase64(obj.base64,tools.limits.maxFileBytes);need(bytes.length===obj.bytes&&await tools.hash(bytes)===sha256,"The retained original import bytes changed.","INTEGRITY");return bytes;}
  return Object.freeze({list,read,create,save,saveEdition,restoreEdition,fork,importFile,exportFile,recover,readImportedBytes,commitCandidate:commit,...tools,close(){closed=true;db.close();}});
}
