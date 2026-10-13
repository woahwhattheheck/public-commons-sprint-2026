/* Partner Batch Desk — original source and gateway-response workflow. MIT. */
export const SCHEMA = "tjlabs.defarm.partner-batch/1";
export const SDK_PIN = {name:"@defarm/sdk", version:"0.2.1", repository:"https://github.com/defarm-repo/defarm-sdk-ts", commit:"e9b66dcb1e6e66011677be8af522f4e31ca9ed74"};
export function clone(x) { return JSON.parse(JSON.stringify(x)); }
export function bytes(s) { return unescape(encodeURIComponent(s)).length; }
export function object(x) { return !!x && typeof x==="object" && !Array.isArray(x); }
export function need(condition,message) { if(!condition) throw new Error(message); }
export function jsonValue(x,path="$") {
  if(typeof x==="number") need(Number.isFinite(x)&&(!Number.isInteger(x)||Number.isSafeInteger(x)),path+": retain unsafe integers as quoted strings");
  if(Array.isArray(x)) x.forEach((v,i)=>jsonValue(v,path+"["+i+"]"));
  else if(object(x)) for(const [k,v] of Object.entries(x)) jsonValue(v,path+"."+k);
  return x;
}
export function csv(text) {
  const source=text.charCodeAt(0)===0xfeff?text.slice(1):text;
  const rows=[]; let row=[],cell="",quoted=false,closed=false,atStart=true;
  for(let i=0;i<source.length;i++){
    const c=source[i];
    if(quoted){if(c==='"'){if(source[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else cell+=c;continue;}
    if(c==='"'){need(atStart&&!closed,"CSV quote must begin a field");quoted=true;atStart=false;continue;}
    if(c==="," || c==="\r" || c==="\n"){
      row.push(cell);cell="";closed=false;atStart=true;
      if(c!==","){rows.push(row);row=[];if(c==="\r"&&source[i+1]==="\n")i++;}
    }else{need(!closed,"Unexpected text after CSV closing quote");cell+=c;atStart=false;}
  }
  need(!quoted,"CSV has an unterminated quoted field");
  if(row.length||cell!==""||closed||source.endsWith(",")) {row.push(cell);rows.push(row);}
  need(rows.length>=2,"CSV needs a header and at least one data row");
  const headers=rows.shift();need(headers.every(h=>h.length>0),"CSV headers must be nonempty");
  need(new Set(headers).size===headers.length,"CSV headers must be unique; source is retained unchanged");
  rows.forEach((r,i)=>need(r.length===headers.length,"CSV row "+(i+2)+" has "+r.length+" fields; expected "+headers.length));
  return {headers,rows};
}
export function convert(value,type,label){
  if(type==="string") return value;
  if(type==="number"){need(value.trim()!==""&&/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(value),label+": expected explicit finite number");return jsonValue(Number(value),label);}
  if(type==="boolean"){need(value==="true"||value==="false",label+": boolean must be literal true or false");return value==="true";}
  if(type==="json"){return jsonValue(JSON.parse(value),label);}
  if(type==="null-empty"){return value===""?null:value;}
  throw new Error(label+": unsupported conversion "+type);
}
export function input(source,mapping=[]){
  need(object(source)&&typeof source.text==="string"&&typeof source.name==="string","Choose an original UTF-8 file");
  need(source.name.length>0&&source.name.length<=240,"Source name must have 1–240 characters");
  need(bytes(source.text)<=16*1024*1024,"Original file exceeds the 16 MiB desk input limit");
  if(source.format==="json"){
    const items=jsonValue(JSON.parse(source.text.replace(/^\uFEFF/,"")));
    need(Array.isArray(items)&&items.length>0&&items.every(object),"JSON source must be a nonempty array of item objects");
    need(mapping.length===0,"JSON item sources preserve their original fields and types");
    return {items,rows:items.map((item,i)=>({row:i+1,item})),headers:null};
  }
  need(source.format==="csv","Choose CSV or JSON");
  const table=csv(source.text);need(Array.isArray(mapping)&&mapping.length>0,"Define a CSV mapping");
  const selected=mapping.filter(m=>m.target!=="");
  need(selected.length>0,"Map at least one field");
  need(selected.every(m=>object(m)&&table.headers.includes(m.source)&&typeof m.target==="string"&&m.target.length>0),"Mapping refers to an unknown column or empty field");
  need(new Set(selected.map(m=>m.target)).size===selected.length,"Mapped target fields must be unique");
  const items=table.rows.map((row,i)=>{
    const item=Object.create(null);
    selected.forEach(m=>{item[m.target]=convert(row[table.headers.indexOf(m.source)],m.type,"Row "+(i+2)+" / "+m.source);});
    return item;
  });
  return {items,headers:table.headers,rows:table.rows.map((cells,i)=>({row:i+2,cells,item:items[i]}))};
}
export function newCase({source,mapping=[],title,gateway,network="testnet"},hash,at){
  const url=new URL(gateway);need(url.protocol==="https:","Gateway must be an HTTPS origin");
  need(!url.username&&!url.password&&url.pathname==="/"&&!url.search&&!url.hash,"Gateway must be a plain HTTPS origin");
  need(["testnet","public"].includes(network),"Choose the intended verification network label");
  const parsed=input(source,mapping),payload=JSON.stringify({items:parsed.items});
  const original={name:source.name,format:source.format,text:source.text,bytes:bytes(source.text),sha256:hash(source.text)};
  const identity={source:{name:original.name,format:original.format,bytes:original.bytes,sha256:original.sha256},mapping:clone(mapping),payload_sha256:hash(payload),gateway:url.origin,network,sdk:SDK_PIN};
  const id=hash(JSON.stringify(identity));
  return {schema:SCHEMA,id,revision:0,title:String(title||source.name).slice(0,200),created_at:at,identity,source:original,mapping:clone(mapping),items:parsed.items,source_rows:parsed.rows,payload:{text:payload,bytes:bytes(payload),sha256:hash(payload)},state:"draft",events:[],verifications:[],notes:[]};
}
export function assertCase(c,hash){
  need(object(c)&&c.schema===SCHEMA,"Unsupported case schema");
  const rebuilt=newCase({source:c.source,mapping:c.mapping,title:c.title,gateway:c.identity?.gateway,network:c.identity?.network},hash,c.created_at);
  for(const key of ["id","identity","source","mapping","items","source_rows","payload"])need(JSON.stringify(c[key])===JSON.stringify(rebuilt[key]),"Case source mismatch: "+key);
  need(Number.isSafeInteger(c.revision)&&c.revision>=0&&Array.isArray(c.events)&&Array.isArray(c.verifications)&&Array.isArray(c.notes),"Malformed case state");
  const states=["draft","preview-running","preview-ready","preview-needs-review","preview-failed","commit-running","commit-returned","commit-unknown"];
  need(states.includes(c.state),"Unknown case state");
  for(const e of c.events){need(object(e)&&typeof e.id==="string"&&["preview","commit","reconcile"].includes(e.kind),"Invalid operation history");if(e.wire){need(typeof e.wire.text==="string"&&hash(e.wire.text)===e.wire.sha256&&bytes(e.wire.text)===e.wire.bytes,"Gateway response bytes changed");}}
  for(const v of c.verifications)if(v.wire)need(hash(v.wire.text)===v.wire.sha256&&bytes(v.wire.text)===v.wire.bytes,"Verification response bytes changed");
  return c;
}
export function collectErrors(value,path="$",out=[]){
  if(Array.isArray(value))value.forEach((v,i)=>collectErrors(v,path+"["+i+"]",out));
  else if(object(value))for(const[k,v]of Object.entries(value)){
    if(/^errors?$/i.test(k)&&((Array.isArray(v)&&v.length>0)||(typeof v==="string"&&v.length>0)||object(v)))out.push({path:path+"."+k,value:clone(v)});
    else collectErrors(v,path+"."+k,out);
  }
  return out;
}
export function assess(result){
  const raw=result?.response,errors=collectErrors(raw),summary=object(raw?.summary)?raw.summary:null;
  const unresolved=summary?.unresolved_rows;
  const counts=["total_rows","processed_rows","unresolved_rows","routes","items","created_circuits","impacted_circuits","items_created","items_enriched"];
  const recognized=object(raw)&&Array.isArray(raw.items)&&Array.isArray(raw.errors)&&Array.isArray(raw.routes)&&object(raw.summary)&&typeof summary.status==="string"&&summary.status.length>0&&counts.every(k=>Number.isSafeInteger(summary[k])&&summary[k]>=0);
  const states=summary?String(summary.status??""):"";
  const concern=errors.length>0||(typeof unresolved==="number"&&unresolved>0)||/fail|error|reject|partial/i.test(states);
  return {recognized,errors,summary,dfids:Array.isArray(result?.dfids)?[...new Set(result.dfids.filter(x=>typeof x==="string"))]:[],review:concern?"Gateway reported unresolved rows or errors":recognized?"Read the original summary and routing before committing":"Response shape is unrecognized; read the complete gateway body",can_commit:recognized&&!concern&&result?.preview===true};
}
export function begin(c,kind,hash,at,revision){
  need(c.revision===revision,"This case changed; refresh before acting");
  need(kind==="preview"||kind==="commit","Unknown operation");
  if(kind==="preview")need(!c.events.some(e=>e.kind==="commit"||e.kind==="reconcile"),"This batch has a commit history; retain it and create a separately reviewed source edition");
  else{
    need(c.state==="preview-ready","Preview the exact selected item bytes before committing");
    need(!c.events.some(e=>e.kind==="commit"||e.kind==="reconcile"),"A commit already exists for these exact bytes");
    const preview=[...c.events].reverse().find(e=>e.kind==="preview");
    need(preview?.assessment?.can_commit&&preview.payload_sha256===c.payload.sha256,"Preview does not admit these exact item bytes");
  }
  const next=clone(c),id=hash(c.id+":"+c.revision+":"+kind+":"+at);
  next.events.push({id,kind,started_at:at,status:"running",payload_sha256:c.payload.sha256});
  next.state=kind+"-running";next.revision++;return next;
}
export function finish(c,eventId,{result,error,wire},hash,at){
  const next=clone(c),e=next.events.find(x=>x.id===eventId);need(e&&e.status==="running","Operation is no longer running");
  e.finished_at=at;e.status=error?"error":"returned";
  if(wire)e.wire={...clone(wire),bytes:bytes(wire.text),sha256:hash(wire.text)};
  if(error)e.error=clone(error);
  if(result!==undefined){e.result=clone(result);e.assessment=assess(result);}
  if(e.kind==="commit")next.state=error?"commit-unknown":"commit-returned";
  else next.state=error?"preview-failed":e.assessment?.can_commit?"preview-ready":"preview-needs-review";
  next.revision++;return next;
}
export function collectDfids(obj,out=[]){
  if(Array.isArray(obj))for(const v of obj)collectDfids(v,out);
  else if(obj&&typeof obj==="object")for(const[k,v]of Object.entries(obj)){
    if(k.toLowerCase()==="dfid"&&typeof v==="string"&&v.startsWith("DFID")){if(!out.includes(v))out.push(v);}
    else collectDfids(v,out);
  }
  return out;
}
export function interrupted(c,at,hash){
  if(!["commit-running","preview-running"].includes(c.state))return c;
  const next=clone(c),e=[...next.events].reverse().find(x=>x.status==="running");
  if(e?.wire&&hash&&e.wire.status>=200&&e.wire.status<300){let raw;try{raw=e.wire.text?JSON.parse(e.wire.text):undefined;}catch{}const result={dfids:collectDfids(raw),preview:e.kind==="preview",response:raw};const recovered=finish(c,e.id,{result,wire:e.wire},hash,at);recovered.events.find(x=>x.id===e.id).recovered_from_retained_wire=true;return recovered;}
  if(e){e.status="interrupted";e.finished_at=at;e.error={message:"The receiver stopped before a final response was retained"};}
  next.state=c.state==="commit-running"?"commit-unknown":"preview-failed";next.revision++;return next;
}
export function reconcile(c,{text,note},hash,at,revision){
  need(c.revision===revision&&c.state==="commit-unknown","Select the current interrupted commit");
  need(typeof note==="string"&&note.trim().length>=8,"Describe where the original gateway response was recovered");
  const raw=jsonValue(JSON.parse(text));need(object(raw),"Recovered response must be an object");
  const result={response:raw,preview:false,dfids:[]};
  function visit(x){if(Array.isArray(x))x.forEach(visit);else if(object(x))for(const[k,v]of Object.entries(x)){if(k.toLowerCase()==="dfid"&&typeof v==="string"&&v.startsWith("DFID"))result.dfids.push(v);else visit(v);}}visit(raw);
  const next=clone(c);next.events.push({id:hash(c.id+":reconcile:"+at),kind:"reconcile",status:"returned",started_at:at,finished_at:at,payload_sha256:c.payload.sha256,provenance:"operator-recovered-response",note:note.trim(),wire:{text,bytes:bytes(text),sha256:hash(text)},result,assessment:assess(result)});
  next.state="commit-returned";next.revision++;return next;
}
export function returnedDfids(c){
  return [...new Set(c.events.filter(e=>e.kind==="commit"||e.kind==="reconcile").flatMap(e=>e.assessment?.dfids||[]))];
}
export function exportCase(c,hash,at){
  assertCase(c,hash);const body=JSON.stringify(c,null,2)+"\n";
  return {schema:"tjlabs.defarm.case-package/1",exported_at:at,case_sha256:hash(body),case_bytes:bytes(body),case_text:body};
}
export function importCase(pkg,hash){
  need(object(pkg)&&pkg.schema==="tjlabs.defarm.case-package/1"&&typeof pkg.case_text==="string","Choose a complete case package");
  need(hash(pkg.case_text)===pkg.case_sha256&&bytes(pkg.case_text)===pkg.case_bytes,"Case package has changed bytes");
  return assertCase(JSON.parse(pkg.case_text),hash);
}
export function escape(x){return String(x??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
export function csvOutput(rows){return rows.map(r=>r.map(x=>'"'+String(x??"").replace(/"/g,'""')+'"').join(",")).join("\r\n")+"\r\n";}
export function report(c){
 const last=[...c.events].reverse().find(e=>e.result),summary=last?.assessment?.summary;
 return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>'+escape(c.title)+'</title><style>body{font:15px/1.5 system-ui;max-width:1100px;margin:32px auto;padding:0 20px;color:#202225}h1{font-size:27px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #bbb;padding:8px;text-align:left;vertical-align:top}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f1f2f3;padding:16px}.scroll{overflow:auto}small{overflow-wrap:anywhere}@media print{pre{font-size:9px}tr{break-inside:avoid}}</style><h1>'+escape(c.title)+'</h1><p>Partner batch · '+escape(c.state)+' · '+c.items.length+' source items</p><p>Gateway: '+escape(c.identity.gateway)+'; requested network label: '+escape(c.identity.network)+'. The gateway determines its actual anchoring network; this SDK label does not select a different gateway.</p><small>Case '+c.id+'<br>Original '+escape(c.source.name)+' · '+c.source.bytes+' bytes · SHA256 '+c.source.sha256+'<br>Selected payload SHA256 '+c.payload.sha256+'</small><h2>Gateway summary</h2><pre>'+escape(JSON.stringify(summary??{message:"No recognized original gateway summary is retained"},null,2))+'</pre><h2>Original results and operations</h2>'+c.events.map(e=>'<section><h3>'+escape(e.kind)+' · '+escape(e.status)+'</h3><p>'+escape(e.started_at)+' — '+escape(e.finished_at||"pending")+'</p><p>'+escape(e.provenance||"Original SDK operation")+' '+escape(e.note||"")+'</p><pre>'+escape(e.wire?.text||JSON.stringify(e.error||{},null,2))+'</pre></section>').join("")+'<h2>Public verification reads</h2><p>These are original gateway aggregator reads. The retained raw report is authoritative; SDK timestamp/commitment fields are best-effort extractions.</p>'+c.verifications.map(v=>'<h3>'+escape(v.dfid)+'</h3><pre>'+escape(v.wire?.text||JSON.stringify(v.error||v.result,null,2))+'</pre>').join("")+'<h2>Original source rows and selected items</h2><div class="scroll" tabindex="0" aria-label="Original source rows"><table><thead><tr><th>Source row</th><th>Retained cells / original item</th><th>Selected gateway item</th></tr></thead><tbody>'+c.source_rows.map(r=>'<tr><td>'+r.row+'</td><td><pre>'+escape(JSON.stringify(r.cells??r.item,null,2))+'</pre></td><td><pre>'+escape(JSON.stringify(r.item,null,2))+'</pre></td></tr>').join("")+'</tbody></table></div><h2>Operating notes</h2><pre>'+escape(JSON.stringify(c.notes,null,2))+'</pre></html>';
}
