/* Paired retained Archive publications. Read-only; no native calculation or target operation. */
export const SCHEMA="portfolio.archive-comparison.v1";
export const TABLES=["projects","measure_totals","timephased_totals","timephased_series","timephased_periods"];
const own=(x,k)=>Object.prototype.hasOwnProperty.call(x,k);
function need(ok,message){if(!ok)throw new Error(message);}
const object=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const clone=x=>JSON.parse(JSON.stringify(x));
const sortKeys=(a,b)=>{const x=Array.from(a,c=>c.codePointAt(0)),y=Array.from(b,c=>c.codePointAt(0));for(let i=0;i<Math.min(x.length,y.length);i++)if(x[i]!==y[i])return x[i]-y[i];return x.length-y.length;};
export function stable(value){
 if(value===null||typeof value!=="object")return JSON.stringify(value);
 if(Array.isArray(value))return "["+value.map(stable).join(",")+"]";
 return "{"+Object.keys(value).sort(sortKeys).map(k=>JSON.stringify(k)+":"+stable(value[k])).join(",")+"}";
}
function ascii(value){return stable(value).replace(/[\u007f-\uffff]/g,c=>"\\u"+c.charCodeAt(0).toString(16).padStart(4,"0"));}
export async function sha256(text){const bytes=new TextEncoder().encode(text);return [...new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))].map(x=>x.toString(16).padStart(2,"0")).join("");}
const sha=x=>typeof x==="string"&&/^[0-9a-f]{64}$/.test(x);
function decimal(text){
 need(typeof text==="string"&&text.length<=24000,"Retain a finite original decimal string.");
 const m=/^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/.exec(text);
 need(m,"Retain a finite original decimal string.");
 const fraction=m[3]??m[4]??"",digits=(m[2]||"0")+fraction,exponent=Number(m[5]||"0")-fraction.length;
 need(Number.isSafeInteger(exponent)&&Math.abs(exponent)<=24000,"Original decimal exponent is outside the reporting range.");
 return{n:BigInt((m[1]==="-"?"-":"")+digits),e:exponent};
}
export function subtractDecimal(right,left){
 const a=decimal(right),b=decimal(left),e=Math.min(a.e,b.e),n=a.n*10n**BigInt(a.e-e)-b.n*10n**BigInt(b.e-e);
 if(n===0n)return"0";const sign=n<0n?"-":"",s=(n<0n?-n:n).toString();
 if(e>=0)return sign+s+"0".repeat(e);
 const padded=s.padStart(1-e,"0"),point=padded.length+e;
 return(sign+padded.slice(0,point)+"."+padded.slice(point)).replace(/0+$/,"").replace(/\.$/,"");
}
function rows(snapshot,table){const t=snapshot.tables[table];return t?t.rows.map(r=>Object.fromEntries(t.columns.map((c,i)=>[c,r[i]]))):[];}
function unique(items,key,label){const m=new Map();for(const item of items){const k=key(item);need(!m.has(k),"Ambiguous "+label+"; retain and resolve the original publication before comparing.");m.set(k,item);}return m;}
async function validateSnapshot(s,hash){
 need(object(s)&&s.schema==="portfolio.archive-comparison-source.v1","Select a complete original publication capture.");
 const p=s.publication,d=s.definition,r=s.review;
 need(object(p)&&p.schema==="portfolio.archive-publication.v1"&&sha(p.id)&&sha(p.cohort_id)&&sha(p.definition_sha256)&&sha(p.review_sha256),"Retain the exact publication identity.");
 need(object(d)&&object(r)&&r.schema==="portfolio.archive-review.v1"&&sha(own(p,"source_cohort_id")?p.source_cohort_id:p.cohort_id)&&r.cohort_id===(own(p,"source_cohort_id")?p.source_cohort_id:p.cohort_id)&&r.definition_sha256===p.definition_sha256,"Publication and original review bindings differ.");
 need(object(s.original_objects),"Retain the exact original definition and review object bytes.");
 for(const [name,value,expected] of [["definition",d,p.definition_sha256],["review",r,p.review_sha256]]){
  const text=s.original_objects[name+"_text"];
  need(typeof text==="string"&&await hash(text)===expected,"The original "+name+" bytes differ from their retained object identity.");
  need(stable(JSON.parse(text))===stable(value),"The parsed "+name+" differs from its exact original bytes.");
 }
 need(stable(d.members)===stable(r.members)&&stable(d.profile)===stable(r.profile),"Retain the reviewed member and profile selection.");
 need(object(p.dataset)&&stable(p.dataset.columns)===stable(r.columns)&&stable(p.dataset.tables)===stable(r.tables)&&stable(p.dataset.table_sha256)===stable(r.table_sha256),"Publication reporting dataset differs from its exact original review.");
 need(p.approval?.review_sha256===p.review_sha256&&sha(p.archive?.sha256)&&Number.isSafeInteger(p.archive?.bytes),"Retain the original approval and complete source archive.");
 need(object(s.tables)&&Object.keys(s.tables).every(k=>TABLES.includes(k)),"Use the declared original comparison tables.");
 const members=unique(d.members,x=>x.project_key,"project key");
 for(const m of d.members)need(typeof m.project_key==="string"&&m.project_key&&sha(m.edition_id),"Retain each exact project edition.");
 for(const table of TABLES){
  const expected=p.dataset.columns[table],t=s.tables[table];
  if(!expected){need(!t,"An unselected original table cannot be introduced.");continue;}
  need(object(t)&&stable(t.columns)===stable(expected)&&Array.isArray(t.rows)&&t.rows.length===p.dataset.tables[table],"The complete "+table+" table is required.");
  need(new Set(t.columns).size===t.columns.length,"Retain distinct original table columns.");
  const lines=[ascii(t.columns)+"\n"];
  for(const row of t.rows){
   need(Array.isArray(row)&&row.length===t.columns.length&&row.every(x=>x===null||typeof x==="string"),"Preserve original text/null table cells.");
   const item=Object.fromEntries(t.columns.map((c,i)=>[c,row[i]])),member=members.get(item.project_key);
   need(member&&member.edition_id===item.edition_id,"Reporting row belongs to another selected project edition.");
   lines.push(ascii(row)+"\n");
  }
  need(await hash(lines.join(""))===p.dataset.table_sha256[table],"The complete "+table+" rows differ from the retained publication.");
 }
 need(s.tables.projects&&s.tables.measure_totals,"The publication must include its project and scalar reporting tables.");
 const projects=unique(rows(s,"projects"),x=>x.project_key,"project reporting key");
 need(projects.size===members.size&&[...members.keys()].every(k=>projects.has(k)),"Retain every original project reporting row.");
 return s;
}
function selectedPairs(left,right,pairs){
 need(Array.isArray(pairs),"Explicitly confirm original business-project correspondences.");
 const lm=new Map(left.definition.members.map(x=>[x.project_key,x])),rm=new Map(right.definition.members.map(x=>[x.project_key,x]));
 const ls=new Set(),rs=new Set();
 for(const p of pairs){need(object(p)&&Object.keys(p).length===2&&typeof p.left==="string"&&typeof p.right==="string"&&lm.has(p.left)&&rm.has(p.right)&&!ls.has(p.left)&&!rs.has(p.right),"Select each retained business project at most once on each side.");ls.add(p.left);rs.add(p.right);}
 return{pairs:clone(pairs),unmatched_left:[...lm.keys()].filter(k=>!ls.has(k)),unmatched_right:[...rm.keys()].filter(k=>!rs.has(k))};
}
function reason(left,right,type,ls,rs){
 if(!left)return"only_right";if(!right)return"only_left";
 const dimensions=type==="scalar"?["field","kind","grain","native_data_type","definition_sha256","currency","units","elapsed"]:
 ["field","kind","grain","native_data_type","definition_sha256","currency","units","elapsed","start_text","finish_text","material_resource_entity_id","material_label"];
 const different=dimensions.filter(k=>left[k]!==right[k]);
 if(type==="period"){
  const a=ls.get(left.series_id),b=rs.get(right.series_id);
  if(!a||!b)return"missing_native_series";
  for(const k of ["method","calendar_basis","boundary_semantics","requested_units"])if(a[k]!==b[k])different.push(k);
 }
 if(different.length)return"incompatible:"+different.join(",");
 if(!left.definition_sha256||!right.definition_sha256)return"missing_native_definition";
 if(left.kind==="money"&&!/^[A-Z]{3}$/.test(left.currency||""))return"unknown_currency";
 if(left.total_text===null||right.total_text===null)return"unavailable_total";
 return left.completeness==="complete"&&right.completeness==="complete"?"comparable":"partial_subtotals";
}
function compareTable(left,right,selection,table,type){
 const ll=new Map(),rr=new Map(),out=[];
 for(const [source,target] of [[left,ll],[right,rr]])for(const row of rows(source,table)){if(!target.has(row.project_key))target.set(row.project_key,[]);target.get(row.project_key).push(row);}
 const ls=unique(rows(left,"timephased_series"),x=>x.series_id,"left native series"),rs=unique(rows(right,"timephased_series"),x=>x.series_id,"right native series");
 const key=x=>stable(type==="scalar"?[x.metric,x.currency,x.units,x.elapsed]:[x.series,x.period_key,x.currency,x.units,x.elapsed,x.material_resource_entity_id,x.material_label]);
 function collect(lkey,rkey){
  const lm=unique(ll.get(lkey)||[],key,"left "+table+" group"),rm=unique(rr.get(rkey)||[],key,"right "+table+" group");
  for(const k of [...new Set([...lm.keys(),...rm.keys()])].sort()){
   const a=lm.get(k)||null,b=rm.get(k)||null,status=reason(a,b,type,ls,rs);
   out.push({type,left_project:lkey,right_project:rkey,measure:(a||b)[type==="scalar"?"metric":"series"],period_key:type==="period"?(a||b).period_key:null,
    status,delta_text:status==="comparable"||status==="partial_subtotals"?subtractDecimal(b.total_text,a.total_text):null,left:a,right:b});
  }
 }
 for(const p of selection.pairs)collect(p.left,p.right);
 for(const k of selection.unmatched_left)collect(k,null);
 for(const k of selection.unmatched_right)collect(null,k);
 return out;
}
export async function comparePublications(left,right,pairs,{hash=sha256}={}){
 await validateSnapshot(left,hash);await validateSnapshot(right,hash);
 const selection=selectedPairs(left,right,pairs);
 const value={schema:SCHEMA,selection,left:clone(left),right:clone(right),
  scalar:compareTable(left,right,selection,"measure_totals","scalar"),
  periods:compareTable(left,right,selection,"timephased_totals","period")};
 return{id:await hash(stable(value)),...value};
}
export async function reopenComparison(value,options={}){
 need(object(value)&&value.schema===SCHEMA&&sha(value.id),"Open the complete saved publication comparison.");
 const result=await comparePublications(value.left,value.right,value.selection?.pairs,options);
 need(stable(result)===stable(value),"The reopened comparison differs from its complete retained inputs.");
 return result;
}
export async function loadPublication(api,cohortId,publicationId,{isCurrent=()=>true,progress=()=>{}}={}){
 need(sha(cohortId)&&sha(publicationId),"Select actual original cohort and publication IDs.");
 const check=()=>need(isCurrent(),"Comparison selection changed; read the selected pair again.");
 const cohort=await api("/api/cohorts/"+cohortId);check();
 const matches=cohort.publications.filter(x=>x.id===publicationId);need(matches.length===1,"The selected publication is not retained in this cohort.");
 const publication=matches[0];
 const originals=await Promise.all([api("/api/objects/"+publication.definition_sha256+"?representation=source"),api("/api/objects/"+publication.review_sha256+"?representation=source")]);check();
 const original_objects={};
 for(const [i,name] of ["definition","review"].entries()){
  const raw=originals[i],expected=publication[name+"_sha256"];
  need(object(raw)&&raw.schema==="portfolio.original-json-source.v1"&&raw.sha256===expected&&typeof raw.text==="string","Retain the original "+name+" object bytes.");
  original_objects[name+"_text"]=raw.text;
 }
 const definition=JSON.parse(original_objects.definition_text),review=JSON.parse(original_objects.review_text);
 const tables={};
 for(const table of TABLES){
  const columns=publication.dataset.columns[table];if(!columns)continue;
  const expected=publication.dataset.tables[table],all=[];let offset=0;
  do{
   check();progress({table,rows:offset,total:expected});
   const query=new URLSearchParams({cohort_id:cohortId,publication_id:publicationId,table,offset:String(offset),limit:"250"});
   const page=await api("/api/archive-table?"+query);check();
   need(page.table===table&&page.offset===offset&&page.unfiltered_rows===expected&&stable(page.columns)===stable(columns),"Original reporting page identity changed.");
   need(Array.isArray(page.rows)&&page.rows.length<=250&&offset+page.rows.length<=expected,"Invalid original reporting page.");
   all.push(...page.rows);
   const next=offset+page.rows.length;
   need(page.next_offset===null?next===expected:page.next_offset===next&&next>offset&&next<expected,"Reporting pagination is incomplete.");
   offset=next;if(page.next_offset===null)break;
  }while(true);
  tables[table]={columns:clone(columns),rows:all};
 }
 check();return{schema:"portfolio.archive-comparison-source.v1",publication,definition,review,original_objects,tables};
}
const esc=x=>String(x??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const label=x=>String(x||"").replace(/_/g," ");
const cell=x=>x===null||x===undefined?"Unavailable":String(x);
function describe(row){return row.status==="comparable"?"Comparable totals":row.status==="partial_subtotals"?"Partial subtotal change":row.status.startsWith("incompatible:")?"Different "+row.status.slice(13).split(",").map(label).join(", "):label(row.status);}
export function comparisonCSV(value){
 const headers=["type","left_project","right_project","measure","period_key","status","delta_text","left_total","right_total","left_currency","right_currency","left_units","right_units","left_elapsed","right_elapsed","left_start","left_finish","right_start","right_finish","left_completeness","right_completeness","left_original_row_json","right_original_row_json"];
 const quote=x=>'"'+String(x??"").replace(/"/g,'""')+'"';
 const lines=[headers.map(quote).join(",")];
 for(const r of [...value.scalar,...value.periods]){
  const a=r.left||{},b=r.right||{};
  const values=[r.type,r.left_project,r.right_project,r.measure,r.period_key,r.status,r.delta_text,a.total_text,b.total_text,a.currency,b.currency,a.units,b.units,a.elapsed,b.elapsed,a.start_text,a.finish_text,b.start_text,b.finish_text,a.completeness,b.completeness,r.left===null?"null":stable(r.left),r.right===null?"null":stable(r.right)];
  lines.push(values.map(quote).join(","));
 }return"\uFEFF"+lines.join("\r\n")+"\r\n";
}
export function comparisonHTML(value){
 const table=(title,items)=>'<h2>'+esc(title)+'</h2><div class="scroll"><table><thead><tr>'+["Project · left / right","Measure / period","Left","Right","Change: right − left","Basis / coverage"].map(x=>"<th>"+esc(x)+"</th>").join("")+'</tr></thead><tbody>'+items.map(r=>{
  const a=r.left||{},b=r.right||{},unit=[a.currency||b.currency,a.units||b.units,a.elapsed?"elapsed: "+a.elapsed:"",a.material_label||b.material_label].filter(Boolean).join(" · ");
  return"<tr><td>"+esc((r.left_project||"—")+" / "+(r.right_project||"—"))+"</td><td>"+esc(r.measure)+(r.period_key?"<br>"+esc(r.period_key)+"<br>"+esc(a.start_text||b.start_text)+" → "+esc(a.finish_text||b.finish_text):"")+"</td><td>"+esc(cell(a.total_text))+"</td><td>"+esc(cell(b.total_text))+"</td><td>"+esc(cell(r.delta_text))+"</td><td>"+esc(describe(r))+"<br>"+esc(unit)+"<br>"+esc(a.completeness||"absent")+" / "+esc(b.completeness||"absent")+"</td></tr>";
 }).join("")+'</tbody></table></div>';
 return'<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Portfolio publication comparison</title><style>body{font:16px/1.5 system-ui,sans-serif;color:#1b1b1b;background:#fff;max-width:1200px;margin:auto;padding:24px}h1{font-size:1.7rem}h2{font-size:1.2rem;margin-top:2rem}table{border-collapse:collapse;width:100%;font-size:.85rem}th,td{border:1px solid #aaa;text-align:left;padding:8px;vertical-align:top;overflow-wrap:anywhere}th{background:#eee}td:nth-child(3),td:nth-child(4),td:nth-child(5){font-variant-numeric:tabular-nums}pre{white-space:pre-wrap;overflow-wrap:anywhere}.scroll{overflow:auto}details{margin-top:1rem}h2{break-after:avoid}tr{break-inside:avoid}@media print{body{padding:0}.scroll{overflow:visible}table{font-size:8pt}}</style><h1>Portfolio publication comparison</h1><p>'+esc(value.left.definition.name)+" → "+esc(value.right.definition.name)+'</p><p>Changes use retained reporting totals. Project correspondence is explicitly selected; currencies, units and native definitions remain separate. Partial subtotals retain their original missing or unsupported coverage.</p><dl><dt>Left publication</dt><dd>'+esc(value.left.publication.id)+'</dd><dt>Right publication</dt><dd>'+esc(value.right.publication.id)+'</dd><dt>Comparison</dt><dd>'+esc(value.id)+'</dd></dl>'+table("Project measures",value.scalar)+table("Native period totals",value.periods)+'<h2>Original source and reopening</h2><p>Keep the complete comparison JSON with both original portfolio ZIPs. The JSON reopens this retained comparison; each original ZIP reopens its full project and reporting source through the existing Archive receive workflow.</p><p>Left ZIP: '+esc(value.left.publication.archive.filename)+' · '+esc(value.left.publication.archive.sha256)+'<br>Right ZIP: '+esc(value.right.publication.archive.filename)+' · '+esc(value.right.publication.archive.sha256)+'</p><details><summary>Complete original definitions, review findings, support and comparison rows</summary><pre>'+esc(JSON.stringify(value,null,2))+'</pre></details></html>';
}
