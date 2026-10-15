(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.OrderDesk=factory();})(typeof globalThis!=='undefined'?globalThis:this,function OrderDeskCore(){
"use strict";
const SCHEMA="tjl-order-review-workspace.v1", TYPES=["orders","requests"], STATES=["proposed","approved","observed","closed","rejected"];
const fail=(ok,msg)=>{if(!ok)throw Error(msg);},copy=x=>JSON.parse(JSON.stringify(x)),str=x=>typeof x==="string",stable=x=>x===null?"null":Array.isArray(x)?"["+x.map(stable).join(",")+"]":typeof x==="object"?"{"+Object.keys(x).sort().map(k=>JSON.stringify(k)+":"+stable(x[k])).join(",")+"}":JSON.stringify(x);
const text=(v,label,max=20000)=>{fail(str(v)&&v.length<=max,label+" must be text within "+max+" characters.");return v;};
const nonempty=(v,label,max=500)=>{text(v,label,max);fail(v.trim().length>0,label+" is required.");return v;};
const ident=(v,label)=>{fail(str(v)&&/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$/.test(v),label+" has an invalid identity.");return v;};
const stamp=(v,label)=>{fail(str(v)&&/^\d{4}-\d{2}-\d{2}T/.test(v)&&Number.isFinite(Date.parse(v)),label+" needs an explicit ISO date and time.");return v;};
const sha=v=>{fail(str(v)&&/^[a-f0-9]{64}$/.test(v),"A complete SHA-256 is required.");return v;};
const finiteCell=x=>x===null||typeof x==="boolean"||str(x)||(typeof x==="number"&&Number.isFinite(x));
function csv(raw,delimiter=","){
 fail([",","\t",";"].includes(delimiter),"Choose comma, tab or semicolon.");
 const rows=[];let row=[],cell="",quoted=false,closed=false,started=false;
 for(let i=0;i<raw.length;i++){
  const ch=raw[i];
  if(quoted){if(ch==='"'){if(raw[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else cell+=ch;continue;}
  if(ch===delimiter){row.push(cell);cell="";closed=false;started=false;continue;}
  if(ch==="\n"||ch==="\r"){if(ch==="\r"&&raw[i+1]==="\n")i++;row.push(cell);if(row.some(x=>x!==""))rows.push(row);row=[];cell="";closed=false;started=false;continue;}
  if(ch==='"'){fail(!started&&!closed,"Unexpected quote in CSV field.");quoted=true;started=true;continue;}
  fail(!closed,"Characters follow a closing CSV quote.");cell+=ch;started=true;
 }
 fail(!quoted,"The CSV ends inside a quoted field.");
 if(cell!==""||row.length||closed){row.push(cell);if(row.some(x=>x!==""))rows.push(row);}
 return rows;
}

function parseJSON(raw){
 let p=0,depth=0;const ws=()=>{while(p<raw.length&&/[ \t\r\n]/.test(raw[p]))p++;};
 function string(){const start=p++;let closed=false;while(p<raw.length){const ch=raw[p++];if(ch==="\\"){p++;continue;}if(ch==='"'){closed=true;break;}}fail(closed,"An original JSON string is incomplete.");return JSON.parse(raw.slice(start,p));}
 function read(){ws();fail(++depth<=128,"JSON nesting is too deep.");let v;const ch=raw[p];
  if(ch==='"')v=string();
  else if(ch==="{"){p++;v=Object.create(null);const names=new Set();ws();if(raw[p]==="}")p++;else for(;;){ws();fail(raw[p]==='"',"JSON object keys must be quoted.");const k=string();fail(!names.has(k),"Duplicate JSON key: "+k);names.add(k);ws();fail(raw[p++]===":","A JSON key needs a colon.");v[k]=read();ws();const end=raw[p++];if(end==="}")break;fail(end===",","JSON object is incomplete.");}}
  else if(ch==="["){p++;v=[];ws();if(raw[p]==="]")p++;else for(;;){v.push(read());ws();const end=raw[p++];if(end==="]")break;fail(end===",","JSON array is incomplete.");}}
  else if(raw.slice(p,p+4)==="true"){p+=4;v=true;}
  else if(raw.slice(p,p+5)==="false"){p+=5;v=false;}
  else if(raw.slice(p,p+4)==="null"){p+=4;v=null;}
  else{const m=raw.slice(p).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);fail(m,"Unexpected JSON value.");const token=m[0];fail(/^-?(?:0|[1-9]\d*)$/.test(token)&&token!=="-0"&&Number.isSafeInteger(Number(token)),"Quote decimal/exponent values, negative zero and long numeric identifiers as JSON strings to preserve their exact original value.");v=Number(token);p+=token.length;}
  depth--;return v;
 }
 const result=read();ws();fail(p===raw.length,"Unexpected trailing JSON content.");return result;
}
function checkedWriting(value){
 fail(value&&typeof value==="object"&&!Array.isArray(value),"Retain complete unfinished writing.");
 fail(value.forms&&typeof value.forms==="object"&&!Array.isArray(value.forms)&&Object.keys(value.forms).length<=300,"Too many unfinished forms.");
 for(const[k,f]of Object.entries(value.forms)){text(k,"Form identity",500);fail(f&&typeof f==="object"&&!Array.isArray(f)&&Object.keys(f).length<=100,"Invalid unfinished form.");for(const[id,v]of Object.entries(f)){text(id,"Field identity",300);text(v,"Unfinished field",100000);}}
 fail(value.view&&typeof value.view==="object"&&!Array.isArray(value.view),"Retain selected workspace view.");
 for(const[k,v]of Object.entries(value.view)){text(k,"View field",100);fail(str(v)||Number.isSafeInteger(v),"A view value must be text or an exact integer.");}
 if(value.pending_source){const f=value.pending_source;nonempty(f.filename,"Pending original filename",500);sha(f.sha256);fail(Number.isSafeInteger(f.bytes)&&f.bytes>=0&&f.bytes<=24*1024*1024&&str(f.base64)&&f.base64.length<=33554432&&/^[A-Za-z0-9+/]*={0,2}$/.test(f.base64),"Retain the whole pending original within24MiB.");}
 return value;
}

function parse(raw,format="csv",delimiter=","){
 text(raw,"Original source",24*1024*1024);fail(raw.length>0,"The source is empty.");
 const body=raw.charCodeAt(0)===0xfeff?raw.slice(1):raw;let rows,columns;
 if(format==="json"){
  const value=parseJSON(body);fail(Array.isArray(value)&&value.length>0,"JSON must be a nonempty array of flat row objects.");
  rows=value;columns=[];const seen=new Set();
  for(const r of rows){fail(r&&typeof r==="object"&&!Array.isArray(r),"Each JSON row must be an object.");for(const [k,v]of Object.entries(r)){nonempty(k,"Column",300);fail(finiteCell(v),"Nested JSON cells are not supported; retain a flat export.");if(!seen.has(k)){seen.add(k);columns.push(k);}}}
 }else{
  fail(format==="csv","Choose CSV or JSON.");const table=csv(body,delimiter);fail(table.length>=2,"Retain a header and at least one data row.");
  columns=table[0];fail(columns.every(k=>str(k)&&k.trim()),"Every CSV column needs a name.");
  fail(new Set(columns).size===columns.length,"CSV headers must be unique, including case and spaces.");
  rows=table.slice(1).map((r,i)=>{fail(r.length===columns.length,"CSV row "+(i+2)+" has "+r.length+" cells; expected "+columns.length+".");const o=Object.create(null);columns.forEach((k,j)=>{o[k]=r[j];});return o;});
 }
 fail(rows.length<=50000&&columns.length<=200,"Use at most 50,000 rows and 200 columns per original file.");
 fail(columns.length>0,"At least one column is required.");return{columns,rows};
}
function create({id,name,at}){return{schema:SCHEMA,id:ident(id,"Workspace"),name:nonempty(name,"Workspace name",200),created_at:stamp(at,"Creation time"),revision:0,origin:null,sources:[],mappings:[],bindings:[],reviews:[],events:[],writing:{forms:{},view:{},pending_source:null}};}
function source(s,id){const x=s.sources.find(x=>x.id===id);fail(x,"The original source is missing: "+id);return x;}
function row(s,ref){fail(ref&&str(ref.source_id)&&Number.isInteger(ref.row)&&ref.row>=0,"An exact source row is required.");const src=source(s,ref.source_id);fail(ref.row<src.rows.length,"Source row is outside the original file.");return{source:src,data:src.rows[ref.row],ref:{source_id:ref.source_id,row:ref.row}};}
function mapping(s,id){return s.mappings.find(x=>x.source_id===id)||null;}
function value(data,field){return field&&Object.prototype.hasOwnProperty.call(data,field)?data[field]:null;}
function key(s,ref){
 const r=row(s,ref),m=mapping(s,ref.source_id);if(!m)return null;
 const order=value(r.data,m.order_column),line=m.grain==="line"?value(r.data,m.line_column):"";
 if(order===null||String(order).trim()===""||(m.grain==="line"&&(line===null||String(line).trim()==="")))return null;
 return stable({company:m.company,grain:m.grain,order:String(order),line:String(line)});
}
function keyLabel(s,ref){const k=key(s,ref);if(!k)return"Unmapped / missing key";const x=JSON.parse(k);return x.company+" · order "+x.order+(x.grain==="line"?" · line "+x.line:"");}
function index(s,sourceId){const src=source(s,sourceId),entries=new Map(),unkeyed=[];src.rows.forEach((_,i)=>{const ref={source_id:sourceId,row:i},k=key(s,ref);if(k===null)unkeyed.push(ref);else{if(!entries.has(k))entries.set(k,[]);entries.get(k).push(ref);}});return{entries,unkeyed};}
function compare(s,beforeId,afterId){
 const a=source(s,beforeId),b=source(s,afterId);fail(a.kind==="orders"&&b.kind==="orders"&&a.id!==b.id,"Choose two different original order snapshots.");
 const ma=mapping(s,a.id),mb=mapping(s,b.id);fail(ma&&mb,"Map both snapshots first.");
 fail(ma.company===mb.company&&ma.grain===mb.grain,"Both snapshots must use the same company scope and order/line grain.");
 const aa=index(s,a.id),bb=index(s,b.id),keys=new Set([...aa.entries.keys(),...bb.entries.keys()]),results=[];
 const fields=new Set([...Object.keys(ma.fields),...Object.keys(mb.fields)]);fail(fields.size>0,"Map at least one comparison field in the order snapshots.");
 for(const k of keys){
  const left=aa.entries.get(k)||[],right=bb.entries.get(k)||[];
  if(left.length>1||right.length>1){results.push({key:k,status:"ambiguous",before:left,after:right,changes:[]});continue;}
  if(!left.length||!right.length){results.push({key:k,status:left.length?"missing_from_later":"new_in_later",before:left,after:right,changes:[]});continue;}
  const la=row(s,left[0]).data,rb=row(s,right[0]).data,changes=[];
  for(const f of fields){const presentBefore=Object.prototype.hasOwnProperty.call(ma.fields,f),presentAfter=Object.prototype.hasOwnProperty.call(mb.fields,f);const av=presentBefore?value(la,ma.fields[f]):null,bv=presentAfter?value(rb,mb.fields[f]):null;if(!presentBefore||!presentAfter||stable(av)!==stable(bv))changes.push({field:f,before:av,after:bv,before_mapped:presentBefore,after_mapped:presentAfter});}
  results.push({key:k,status:changes.length?"changed":"unchanged",before:left,after:right,changes});
 }
 return{before_id:a.id,after_id:b.id,results,unkeyed_before:aa.unkeyed,unkeyed_after:bb.unkeyed,
  counts:results.reduce((o,r)=>(o[r.status]=(o[r.status]||0)+1,o),{})};
}
function suggestions(s,requestSourceId,orderSourceId){
 fail(source(s,requestSourceId).kind==="requests"&&source(s,orderSourceId).kind==="orders","Select customer requests and an order snapshot.");
 const req=source(s,requestSourceId),ix=index(s,orderSourceId);
 return req.rows.map((_,i)=>{const ref={source_id:requestSourceId,row:i},k=key(s,ref),matches=k===null?[]:(ix.entries.get(k)||[]);return{request:ref,candidates:matches,state:k===null?"unmapped":matches.length===1?"unique_exact_key":matches.length>1?"ambiguous":"no_exact_key"};});
}
function currentReview(s,id){const r=s.reviews.find(x=>x.id===id);fail(r,"The review is missing.");return r;}
function appendReview(s,a,at){
 const review=currentReview(s,a.review_id),prior=review.versions[review.versions.length-1];
 fail(a.expected_version===prior.version,"This review changed. Reopen the current version before recording a decision.");
 nonempty(a.actor,"Recorded reviewer",300);nonempty(a.reason,"Decision reason",6000);fail(STATES.includes(a.status),"Choose a review status.");text(a.proposal,"Proposed disposition",12000);text(a.observed_result,"Observed result",12000);
 const changed=a.proposal!==prior.proposal;
 if(changed)fail(a.status==="proposed","A changed disposition starts a new proposed version.");
 if(a.status==="approved")fail(["proposed","approved"].includes(prior.status)&&a.proposal.trim(),"Approve a complete proposed disposition.");
 if(a.status==="observed")fail(["approved","observed"].includes(prior.status)&&a.observed_result.trim(),"Record an observed result after an approved disposition.");
 if(a.status==="closed")fail(["observed","closed","rejected"].includes(prior.status),"Close a reviewed observed result or rejection.");
 if(a.status==="rejected")fail(a.reason.trim(),"A rejection needs its reason.");
 const refs=copy(a.evidence_refs||[]);refs.forEach(r=>row(s,r));
 if(a.status==="observed")fail(refs.length>0,"Bind at least one original record for the observed result.");
 const version={version:prior.version+1,at,actor:a.actor,status:a.status,proposal:a.proposal,reason:a.reason,observed_result:a.observed_result,evidence_refs:refs};
 review.versions.push(version);return review.id;
}
function apply(input,action,{id,at}){
 validate(input,false);ident(id,"Event");stamp(at,"Event time");fail(!input.events.some(e=>e.id===id),"This event has already been recorded.");
 const s=copy(input),a=copy(action);let result;
 if(a.type==="edit_writing"){s.writing=copy(checkedWriting(a.writing));result=s.id;
 }else if(a.type==="add_source"){
  ident(a.id,"Source");fail(!s.sources.some(x=>x.id===a.id),"This source identity already exists.");fail(TYPES.includes(a.kind),"Choose orders or requests.");nonempty(a.filename,"Original filename",500);nonempty(a.system,"Source system",200);stamp(a.captured_at,"Export/receipt time");text(a.effective_at||"","Source period",200);sha(a.sha256);
  const parsed=parse(a.original_text,a.format,a.delimiter);
  s.sources.push({id:a.id,kind:a.kind,filename:a.filename,system:a.system,captured_at:a.captured_at,effective_at:a.effective_at||"",format:a.format,delimiter:a.delimiter||",",sha256:a.sha256,original_text:a.original_text,columns:parsed.columns,rows:parsed.rows});result=a.id;
 }else if(a.type==="map_source"){
  const src=source(s,a.source_id);nonempty(a.company,"Company scope",300);fail(["order","line"].includes(a.grain),"Choose order or line grain.");
  fail(src.columns.includes(a.order_column),"Choose an original order-ID column.");if(a.grain==="line")fail(src.columns.includes(a.line_column),"Choose an original line-ID column.");
  fail(a.fields&&typeof a.fields==="object"&&!Array.isArray(a.fields),"Retain the complete field mapping.");
  for(const[k,v]of Object.entries(a.fields)){nonempty(k,"Comparison field",200);fail(src.columns.includes(v),"Mapped column is absent: "+v);}
  fail(!s.bindings.some(b=>b.request.source_id===a.source_id||b.targets.some(r=>r.source_id===a.source_id))&&!s.reviews.some(r=>r.source_refs.some(x=>x.source_id===a.source_id)||r.versions.some(v=>v.evidence_refs.some(x=>x.source_id===a.source_id))),"This mapping is already used in a review. Import another source identity to revise the mapping while preserving the original decision context.");
  const m={source_id:a.source_id,company:a.company,grain:a.grain,order_column:a.order_column,line_column:a.grain==="line"?a.line_column:"",fields:a.fields};
  const i=s.mappings.findIndex(x=>x.source_id===a.source_id);if(i<0)s.mappings.push(m);else s.mappings[i]=m;result=a.source_id;
 }else if(a.type==="bind_request"){
  ident(a.id,"Binding");fail(!s.bindings.some(x=>x.id===a.id),"Binding identity already exists.");const rq=row(s,a.request);fail(rq.source.kind==="requests","Bind an original customer-request row.");
  nonempty(a.actor,"Recorded reviewer",300);nonempty(a.reason,"Binding reason",6000);fail(Array.isArray(a.targets)&&a.targets.length>0,"Choose one or more original order rows.");
  a.targets.forEach(ref=>fail(row(s,ref).source.kind==="orders","Targets must be original order rows."));
  fail(new Set(a.targets.map(stable)).size===a.targets.length,"An order row is repeated.");
  fail(!s.bindings.some(x=>stable(x.request)===stable(a.request)),"This request already has a retained binding. Import a new request snapshot to amend it.");
  const b={id:a.id,request:a.request,targets:a.targets,actor:a.actor,reason:a.reason,at};
  s.bindings.push(b);result=a.id;
 }else if(a.type==="create_review"){
  ident(a.id,"Review");fail(!s.reviews.some(x=>x.id===a.id),"Review identity already exists.");nonempty(a.title,"Review title",300);nonempty(a.actor,"Recorded reviewer",300);nonempty(a.proposal,"Proposed disposition",12000);nonempty(a.reason,"Review reason",6000);fail(Array.isArray(a.source_refs)&&a.source_refs.length>0,"Bind the original records being reviewed.");a.source_refs.forEach(r=>row(s,r));
  const bindingIds=a.binding_ids||[];bindingIds.forEach(i=>fail(s.bindings.some(b=>b.id===i),"A selected request binding is absent."));
  s.reviews.push({id:a.id,title:a.title,source_refs:a.source_refs,binding_ids:bindingIds,versions:[{version:1,at,actor:a.actor,status:"proposed",proposal:a.proposal,reason:a.reason,observed_result:"",evidence_refs:[]}]});result=a.id;
 }else if(a.type==="record_decision"){result=appendReview(s,a,at);
 }else if(a.type==="rename"){s.name=nonempty(a.name,"Workspace name",200);result=s.id;
 }else throw Error("Unknown workspace operation.");
 let retainedAction=a;
 if(a.type==="add_source"){retainedAction={...a};delete retainedAction.original_text;retainedAction.original_retained_at={source_id:a.id,sha256:a.sha256};}
 if(a.type==="edit_writing"){const w=s.writing;retainedAction={type:a.type,retained_current_writing:true,form_keys:Object.keys(w.forms||{}),view:copy(w.view||{}),pending_source:w.pending_source?{filename:w.pending_source.filename,bytes:w.pending_source.bytes,sha256:w.pending_source.sha256}:null};}
 s.revision++;s.events.push({id,at,revision:s.revision,type:a.type,result,action:retainedAction});validate(s,false);return s;
}
function validate(s,deep=true){
 fail(s&&s.schema===SCHEMA,"Choose a complete supported order-review workspace.");ident(s.id,"Workspace");nonempty(s.name,"Workspace name",200);stamp(s.created_at,"Creation time");fail(Number.isInteger(s.revision)&&s.revision>=0,"Workspace revision is invalid.");
 if(s.writing)checkedWriting(s.writing);
 for(const k of ["sources","mappings","bindings","reviews","events"])fail(Array.isArray(s[k]),"Missing "+k+".");
 fail(s.events.length===s.revision&&s.events.every((e,i)=>e.revision===i+1),"The complete operation history must be consecutive.");
 for(const k of ["sources","bindings","reviews","events"])fail(new Set(s[k].map(x=>x.id)).size===s[k].length,"Duplicate "+k+" identity.");
 fail(new Set(s.mappings.map(x=>x.source_id)).size===s.mappings.length,"Duplicate source mapping.");
 for(const src of s.sources){ident(src.id,"Source");sha(src.sha256);fail(TYPES.includes(src.kind),"Unknown source role.");if(deep){const p=parse(src.original_text,src.format,src.delimiter);fail(stable(p.rows)===stable(src.rows)&&stable(p.columns)===stable(src.columns),"A parsed table differs from its complete original file: "+src.filename);}}
 for(const m of s.mappings){const src=source(s,m.source_id);nonempty(m.company,"Company scope");fail(["order","line"].includes(m.grain)&&src.columns.includes(m.order_column)&&(m.grain!=="line"||src.columns.includes(m.line_column)),"A source key mapping is incomplete.");fail(m.fields&&Object.values(m.fields).every(x=>src.columns.includes(x)),"A comparison field mapping is incomplete.");}
 for(const b of s.bindings){row(s,b.request);fail(b.targets.length>0,"Binding targets are missing.");b.targets.forEach(r=>row(s,r));}
 for(const r of s.reviews){fail(r.source_refs.length&&r.versions.length,"A review must retain its source and versions.");r.source_refs.forEach(x=>row(s,x));r.binding_ids.forEach(i=>fail(s.bindings.some(b=>b.id===i),"A review binding is missing."));r.versions.forEach((v,i)=>{fail(v.version===i+1&&STATES.includes(v.status),"A review version is incomplete.");v.evidence_refs.forEach(x=>row(s,x));});}
 return true;
}
function branch(s,{id,name,at}){validate(s);const n=copy(s);n.origin={workspace_id:s.id,revision:s.revision,prior_origin:s.origin||null,opened_at:stamp(at,"Branch time")};n.id=ident(id,"New workspace");n.name=nonempty(name||s.name,"Workspace name",200);return n;}
function csvCell(v){let t=v==null?"":typeof v==="object"?stable(v):String(v);if(/^[=+\-@\t\r]/.test(t))t="'"+t;return'"'+t.replace(/"/g,'""')+'"';}
function decisionsCSV(s){validate(s,false);const rows=[["review_id","title","version","status","reviewer","recorded_at","proposal","reason","observed_result","source_refs","evidence_refs"]];for(const r of s.reviews)for(const v of r.versions)rows.push([r.id,r.title,v.version,v.status,v.actor,v.at,v.proposal,v.reason,v.observed_result,stable(r.source_refs),stable(v.evidence_refs)]);return rows.map(r=>r.map(csvCell).join(",")).join("\r\n")+"\r\n";}
return{SCHEMA,TYPES,STATES,copy,stable,parseJSON,checkedWriting,parse,create,source,row,mapping,key,keyLabel,index,compare,suggestions,currentReview,apply,validate,branch,decisionsCSV};
});
