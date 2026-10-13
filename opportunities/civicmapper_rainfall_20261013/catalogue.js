/* Gauge Catalogue Review — retained publisher source comparison, TokenJunkie Labs. */
(function(root){
"use strict";
function utf8Encode(s){const out=[];for(const c of s){let n=c.codePointAt(0);if(n>=0xd800&&n<=0xdfff)n=0xfffd;if(n<128)out.push(n);else if(n<2048)out.push(192|(n>>6),128|(n&63));else if(n<65536)out.push(224|(n>>12),128|((n>>6)&63),128|(n&63));else out.push(240|(n>>18),128|((n>>12)&63),128|((n>>6)&63),128|(n&63));}return Uint8Array.from(out);}
function sha256(bytes){const K=[],H=[];for(let n=2;K.length<64;n++){let prime=true;for(let d=2;d*d<=n;d++)if(n%d===0){prime=false;break;}if(prime){if(H.length<8)H.push(Math.floor((Math.sqrt(n)%1)*4294967296)>>>0);K.push(Math.floor((Math.cbrt(n)%1)*4294967296)>>>0);}}const size=Math.ceil((bytes.length+9)/64)*64,data=new Uint8Array(size);data.set(bytes);data[bytes.length]=128;let len=bytes.length*8;for(let i=0;i<8;i++){data[size-1-i]=len%256;len=Math.floor(len/256);}const rot=(x,n)=>(x>>>n)|(x<<(32-n)),W=new Uint32Array(64);for(let off=0;off<size;off+=64){for(let i=0;i<16;i++)W[i]=(data[off+i*4]<<24)|(data[off+i*4+1]<<16)|(data[off+i*4+2]<<8)|data[off+i*4+3];for(let i=16;i<64;i++){const a=W[i-15],b=W[i-2],s0=rot(a,7)^rot(a,18)^(a>>>3),s1=rot(b,17)^rot(b,19)^(b>>>10);W[i]=(W[i-16]+s0+W[i-7]+s1)>>>0;}let [a,b,c,d,e,f,g,h]=H;for(let i=0;i<64;i++){const s1=rot(e,6)^rot(e,11)^rot(e,25),ch=(e&f)^(~e&g),t1=(h+s1+ch+K[i]+W[i])>>>0,s0=rot(a,2)^rot(a,13)^rot(a,22),maj=(a&b)^(a&c)^(b&c),t2=(s0+maj)>>>0;h=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0;}[a,b,c,d,e,f,g,h].forEach((x,i)=>H[i]=(H[i]+x)>>>0);}return H.map(x=>x.toString(16).padStart(8,"0")).join("");}

const VERSION="1.0.0", own=(v,k)=>Object.prototype.hasOwnProperty.call(v,k);
const clone=v=>JSON.parse(JSON.stringify(v));
const fail=m=>{throw Error(m);};
const text=v=>v===null||v===undefined?"":String(v);
const natural=(a,b)=>String(a).localeCompare(String(b),"en",{numeric:true});
const escaped=v=>text(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function canonical(value){
 if(value===null||typeof value!=="object")return JSON.stringify(value);
 if(Array.isArray(value))return "["+value.map(canonical).join(",")+"]";
 return "{"+Object.keys(value).sort().map(k=>JSON.stringify(k)+":"+canonical(value[k])).join(",")+"}";
}
const sha256Text=value=>sha256(utf8Encode(value));
const fingerprint=value=>sha256Text(canonical(value));
const pairKey=r=>r.ext_id===null?null:JSON.stringify([r.web_id,r.ext_id]);
function id(value,label){
 if(value===null||value===undefined||value==="")return null;
 if(typeof value!=="string"&&!(typeof value==="number"&&Number.isSafeInteger(value)))fail(label+" must be text or a safe integer.");
 const out=String(value);
 if(!out.trim()||out!==out.trim()||/[\u0000-\u001f\u007f]/.test(out))fail(label+" contains unsupported whitespace or control characters.");
 return out;
}
function sourceValue(value){
 if(value?.schema==="gauge-catalogue-normalized/v1")return normalize(value.source.content,value.source);
 if(value&&typeof value.content==="string")return normalize(value.content,value);
 fail("Select a retained catalogue source descriptor.");
}
function normalize(rawText, identity={}){
 if(typeof rawText!=="string")fail("Retain the original UTF-8 catalogue text.");
 if(!identity||typeof identity!=="object"||Array.isArray(identity))fail("Catalogue identity must be an object.");
 if(identity.content!==undefined&&identity.content!==rawText)fail("The original catalogue text differs from its descriptor.");
 const bytes=utf8Encode(rawText).length, hash=sha256Text(rawText);
 if(identity.sha256!==undefined&&identity.sha256!==hash)fail("The retained catalogue SHA-256 differs.");
 if(identity.bytes!==undefined&&identity.bytes!==bytes)fail("The retained catalogue byte length differs.");
 let collection;try{collection=JSON.parse(rawText);}catch(e){fail("Catalogue content must be a valid GeoJSON FeatureCollection.");}
 if(!collection||collection.type!=="FeatureCollection"||!Array.isArray(collection.features))fail("Catalogue content must contain a GeoJSON FeatureCollection.");
 const crs=collection.crs?.properties?.name;
 if(collection.crs&&(!crs||!/(?:CRS84|EPSG(?::|::|\/0\/)4326)$/i.test(crs)))fail("Coordinate comparisons require longitude/latitude WGS84 GeoJSON.");
 let format=identity.format;
 if(!format||format==="auto"){
  if(collection.features.length&&collection.features.every(f=>f?.properties&&own(f.properties,"web_id")))format="publisher";
  else if(collection.features.length&&collection.features.every(f=>f?.properties&&!own(f.properties,"web_id")&&own(f.properties,"id")&&own(f,"id")))format="legacy-static";
  else fail("Choose the explicit publisher or legacy-static schema for this catalogue.");
 }
 if(!["publisher","legacy-static"].includes(format))fail("Catalogue format must be publisher or legacy-static.");
 for(const name of ["label","url","retrieved_at","git_commit","git_blob"]){
  if(identity[name]!==undefined&&identity[name]!==null&&typeof identity[name]!=="string")fail("Source "+name+" must be text.");
 }
 if(identity.retrieved_at&&(!/(?:Z|[+-]\d\d:\d\d)$/.test(identity.retrieved_at)||!Number.isFinite(Date.parse(identity.retrieved_at))))fail("Source retrieval time needs an ISO timestamp with a UTC offset.");
 for(const name of ["git_commit","git_blob"])if(identity[name]&&!/^[0-9a-f]{40}$/.test(identity[name]))fail("Source "+name+" must be its original 40-character Git identity.");
 const source={label:identity.label||"Gauge catalogue",url:identity.url||null,retrieved_at:identity.retrieved_at||null,
  git_commit:identity.git_commit||null,git_blob:identity.git_blob||null,format,bytes,sha256:hash,content:rawText};
 const issues=[],records=collection.features.map((feature,index)=>{
  if(!feature||feature.type!=="Feature"||!feature.properties||typeof feature.properties!=="object"||Array.isArray(feature.properties))fail("Catalogue feature "+index+" needs its original properties object.");
  const p=feature.properties,web=id(format==="publisher"?p.web_id:feature.id,"Query ID"),ext=id(format==="publisher"?p.ext_id:p.id,"External ID");
  const active=typeof p.active==="boolean"?p.active:null;
  const record_id=sha256Text(hash+"\n"+index),flags=[];
  if(web===null){flags.push("missing_web_id");issues.push({type:"missing_web_id",record_id,message:"Original record has no query ID; it remains in the catalogue."});}
  if(ext===null){flags.push("missing_ext_id");issues.push({type:"missing_ext_id",record_id,message:"Original record has no external ID; composite correspondence is unresolved."});}
  if(own(p,"active")&&active===null){flags.push("unrecognized_active_flag");issues.push({type:"unrecognized_active_flag",record_id,message:"Activation status is unknown because the original value is not boolean."});}
  let coordinates=null;
  const xy=feature.geometry?.coordinates;
  if(feature.geometry?.type==="Point"&&Array.isArray(xy)&&xy.length>=2&&xy.slice(0,2).every(v=>typeof v==="number"&&Number.isFinite(v))&&Math.abs(xy[0])<=180&&Math.abs(xy[1])<=90)coordinates=xy.slice(0,2);
  else {flags.push("unavailable_coordinates");issues.push({type:"unavailable_coordinates",record_id,message:"A valid WGS84 point is required to calculate coordinate separation."});}
  return {record_id,index,web_id:web,ext_id:ext,feature_id:own(feature,"id")?clone(feature.id):null,
   name:text(p.name),active,status:active===true?"active":active===false?"inactive":"unknown",
   active_present:own(p,"active"),coordinates,flags,feature:clone(feature),feature_sha256:fingerprint(feature)};
 });
 return {schema:"gauge-catalogue-normalized/v1",version:VERSION,source,format,records,issues,
  counts:{records:records.length,active:records.filter(r=>r.active===true).length,inactive:records.filter(r=>r.active===false).length,
   unknown:records.filter(r=>r.active===null).length,query_ids:new Set(records.filter(r=>r.web_id!==null).map(r=>r.web_id)).size,without_web_id:records.filter(r=>r.web_id===null).length},
  identity_method:{query_id:format==="publisher"?"properties.web_id":"feature.id (legacy static schema)",
   external_id:format==="publisher"?"properties.ext_id":"properties.id (legacy static schema)",
   record_id:"SHA-256 of source SHA-256 + newline + zero-based original feature index",
   feature_sha256:"SHA-256 of canonical parsed feature JSON with sorted object keys, encoded as UTF-8"}};
}
function groups(records,field){
 const map=new Map();for(const r of records){const key=typeof field==="function"?field(r):r[field];if(key===null)continue;if(!map.has(key))map.set(key,[]);map.get(key).push(r);}return map;
}
function separation(a,b){
 if(!a?.coordinates||!b?.coordinates)return null;
 const [x1,y1]=a.coordinates,[x2,y2]=b.coordinates,rad=Math.PI/180,dy=(y2-y1)*rad,dx=(x2-x1)*rad;
 const h=Math.sin(dy/2)**2+Math.cos(y1*rad)*Math.cos(y2*rad)*Math.sin(dx/2)**2;
 return {before:[x1,y1],after:[x2,y2],longitude_delta_degrees:x2-x1,latitude_delta_degrees:y2-y1,
  distance_m:6371008.8*2*Math.atan2(Math.sqrt(Math.max(0,Math.min(1,h))),Math.sqrt(Math.max(0,1-h))),
  method:"Spherical great-circle separation; mean Earth radius 6371008.8 m",interpretation:"Difference between catalogue coordinates; a physical relocation is not established."};
}
function differences(a,b,path=""){
 if(canonical(a)===canonical(b))return [];
 const object=v=>v!==null&&typeof v==="object"&&!Array.isArray(v);
 if(object(a)&&object(b)){
  return [...new Set([...Object.keys(a),...Object.keys(b)])].sort().flatMap(key=>{
   const p=path+"/"+key.replace(/~/g,"~0").replace(/\//g,"~1"),ap=own(a,key),bp=own(b,key);
   if(!ap||!bp)return [{path:p,before_present:ap,after_present:bp,before:ap?a[key]:null,after:bp?b[key]:null}];
   return differences(a[key],b[key],p);
  });
 }
 return [{path:path||"/",before_present:true,after_present:true,before:a,after:b}];
}
function semantic(r){
 const p=r.feature.properties;
 return {name:p.name??null,address:p.address??null,nws_des:p.nws_des??null,ant_elev:p.ant_elev??null,elev_ft:p.elev_ft??null,
  geometry:r.feature.geometry??null};
}
function identityIssues(catalogue,which){
 const result=[];
 for(const [type,field] of [["duplicate_web_id","web_id"],["reused_ext_id","ext_id"],["duplicate_pair",pairKey]]){
  for(const [value,records] of groups(catalogue.records,field)){
   if(records.length<2)continue;
   const separations=[];for(let i=0;i<records.length;i++)for(let j=i+1;j<records.length;j++)separations.push({before_record_id:records[i].record_id,after_record_id:records[j].record_id,...separation(records[i],records[j])});
   result.push({type,source:which,value,records:clone(records),separations,
    message:type==="reused_ext_id"?"External ID occurs in multiple records; it is not a unique site key.":type==="duplicate_web_id"?"Query ID occurs in multiple original records; retain every candidate.":"Multiple records share this query/external pair; individual correspondence is unresolved."});
  }
 }
 return result;
}
function compare(left,right){
 const before=sourceValue(left),after=sourceValue(right),bg=groups(before.records,pairKey),ag=groups(after.records,pairKey),changes=[];
 const add=(status,key,bs,as)=>{
  const one=bs.length===1&&as.length===1&&bs[0].web_id!==null&&as[0].web_id!==null,b=one?bs[0]:null,a=one?as[0]:null;
  if(status==="matched"&&!one)status="ambiguous";
  const fields=one?differences(semantic(b),semantic(a)).map(d=>({field:d.path.slice(1),before:d.before,after:d.after})):[];
  if(one&&b.active!==null&&a.active!==null&&b.active!==a.active)fields.push({field:"active",before:b.active,after:a.active});
  const status_observation=one?{before:b.status,after:a.status,transition:b.active===null?"prior_status_unknown":a.active===null?"current_status_unknown":b.active===a.active?"unchanged":"changed"}:{before:null,after:null,transition:"unpaired"};
  const notes=[];
  if(status_observation.transition==="prior_status_unknown")notes.push("Prior activation status is absent or unknown; no activation/deactivation date or transition is established.");
  if(status==="ambiguous")notes.push("Retain all candidate records; no individual cross-edition match is assigned.");
  if((bs[0]||as[0]).web_id===null)notes.push("This retained record has no API query ID and is not selectable for a query.");
  const row={id:fingerprint({before:before.source.sha256,after:after.source.sha256,key,b:bs.map(r=>r.record_id),a:as.map(r=>r.record_id)}),
   status:one?(fields.length?"changed":"unchanged"):status,web_id:(bs[0]||as[0]).web_id,ext_id:(bs[0]||as[0]).ext_id,
   before:clone(bs),after:clone(as),fields,raw_changes:one?differences(b.feature,a.feature):[],coordinates:one?separation(b,a):null,status_observation,notes};
  changes.push(row);
 };
 for(const key of [...new Set([...bg.keys(),...ag.keys()])].sort(natural)){
  const bs=bg.get(key)||[],as=ag.get(key)||[];
  add(bs.length&&as.length?(bs.length===1&&as.length===1?"matched":"ambiguous"):bs.length?"removed":"added",key,bs,as);
 }
 // Records lacking either composite-key part remain explicit source members.
 for(const [which,records] of [["before",before.records],["after",after.records]])for(const r of records){
  if(pairKey(r)!==null)continue;
  const other=which==="before"?after:before;
  const row={id:fingerprint({source:which,record:r.record_id,before:before.source.sha256,after:after.source.sha256}),
   status:"ambiguous",web_id:r.web_id,ext_id:r.ext_id,before:which==="before"?[clone(r)]:[],after:which==="after"?[clone(r)]:[],
   fields:[],raw_changes:[],coordinates:null,status_observation:{before:which==="before"?r.status:null,after:which==="after"?r.status:null,transition:"unpaired"},
   notes:["The record lacks a query/external composite key; cross-edition presence is unresolved. Original source member is retained."],unkeyed_source:which,
   counterpart_candidates:clone(other.records.filter(x=>r.ext_id!==null&&x.ext_id===r.ext_id))};
  changes.push(row);
 }
 const bq=groups(before.records,"web_id"),aq=groups(after.records,"web_id"),identity_issues=[...identityIssues(before,"before"),...identityIssues(after,"after")];
 const queries=[...new Set([...bq.keys(),...aq.keys()])].sort(natural).map(web_id=>{
  const bs=bq.get(web_id)||[],as=aq.get(web_id)||[],active=as.filter(r=>r.active===true),rows=changes.filter(r=>r.web_id===web_id),flags=[];
  if(bs.length>1||as.length>1)flags.push("multiple_query_records");
  if(active.length===0)flags.push("no_current_active_record");else if(active.length>1)flags.push("multiple_current_active_records");
  if(rows.some(r=>r.status==="changed"))flags.push("record_changes");
  if(rows.some(r=>r.status==="ambiguous"))flags.push("ambiguous_correspondence");
  if(rows.some(r=>r.status_observation.transition==="prior_status_unknown"))flags.push("prior_status_unknown");
  if(identity_issues.some(g=>g.type==="reused_ext_id"&&g.records.some(r=>r.web_id===web_id)))flags.push("external_id_not_unique");
  return {web_id,status:!bs.length?"added":!as.length?"removed":"retained",before:clone(bs),after:clone(as),
   changes:rows.map(r=>r.id),active_record_id:active.length===1?active[0].record_id:null,active_count:active.length,flags};
 });
 return {schema:"gauge-catalogue-comparison/v1",version:VERSION,before,after,queries,changes,identity_issues,
  summary:{before:before.counts,after:after.counts,added_queries:queries.filter(q=>q.status==="added").length,
   removed_queries:queries.filter(q=>q.status==="removed").length,retained_queries:queries.filter(q=>q.status==="retained").length,
   added_records:changes.filter(r=>r.status==="added").reduce((n,r)=>n+r.after.length,0),
   removed_records:changes.filter(r=>r.status==="removed").reduce((n,r)=>n+r.before.length,0),
   metadata_changed_pairs:changes.filter(r=>r.fields.some(f=>!f.field.startsWith("geometry")&&f.field!=="active")).length,
   coordinate_changed_pairs:changes.filter(r=>r.coordinates&&r.coordinates.distance_m>0).length,
   max_matched_coordinate_separation_m:Math.max(0,...changes.filter(r=>r.coordinates).map(r=>r.coordinates.distance_m)),
   known_status_changes:changes.filter(r=>r.status_observation.transition==="changed").length,
   changed_pairs:changes.filter(r=>r.status==="changed").length,unchanged_pairs:changes.filter(r=>r.status==="unchanged").length,
   ambiguous_pairs:changes.filter(r=>r.status==="ambiguous").length,
   unknown_prior_status_pairs:changes.filter(r=>r.status_observation.transition==="prior_status_unknown").length,
   duplicate_query_groups:identity_issues.filter(g=>g.source==="after"&&g.type==="duplicate_web_id").length,
   reused_external_id_groups:identity_issues.filter(g=>g.source==="after"&&g.type==="reused_ext_id").length},
  interpretation:{comparison:"Query IDs group records. Only unique (query ID, external ID) pairs establish an individual catalogue correspondence.",
   changed_pairs:"Parsed common attributes and exact geometry values differ, or an explicitly known activation flag changes. Raw schema/feature-ID differences remain separately listed.",
   added_records:"Source records whose query/external group is absent from the earlier source, including explicit unqueryable entries; this does not establish a newly installed station.",
   unkeyed_records:"Records without a complete composite key remain explicit and unmatched.",
   historical_identity:"Neither a current active flag nor these two catalogues establishes instrument assignment or availability for an earlier rainfall window.",
   coordinate_distance:"Spherical separation of published WGS84 point coordinates, not survey precision or proof of relocation."}};
}
function selection(value,webIds){
 const after=value?.schema==="gauge-catalogue-comparison/v1"?sourceValue(value.after):
  value?.schema==="gauge-catalogue-project/v1"?sourceValue(value.after):sourceValue(value);
 if(!Array.isArray(webIds)||!webIds.length||webIds.some(v=>typeof v!=="string"||id(v,"Query ID")===null)||new Set(webIds).size!==webIds.length)fail("Choose distinct nonempty query IDs.");
 const ordered=[...webIds].sort(natural),records=[],alternatives=[];
 for(const web of ordered){const all=after.records.filter(r=>r.web_id===web),active=all.filter(r=>r.active===true);
  if(active.length!==1)fail("Query "+web+" needs exactly one active record in this retained current catalogue.");
  records.push(clone(active[0]));alternatives.push(...all.filter(r=>r.record_id!==active[0].record_id).map(clone));
 }
 return {schema:"gauge-catalogue-selection/v1",version:VERSION,source:clone(after.source),web_ids:ordered,records,alternatives,
  historical_identity:"not_resolved_by_catalogue",meaning:"Current active query records at the retained catalogue observation; historical rainfall assignments require separate publisher evidence."};
}
function validateSelection(value){
 if(!value||value.schema!=="gauge-catalogue-selection/v1")fail("Select an original gauge-catalogue-selection/v1 manifest.");
 const expected=selection(value.source,value.web_ids);
 if(canonical(value)!==canonical(expected))fail("Selected catalogue records differ from their retained original source.");
 return expected;
}
function project({before,after,notes="",selected_web_ids=[]}){
 if(typeof notes!=="string")fail("Catalogue reviewer notes must be text.");
 const b=sourceValue(before),a=sourceValue(after);
 if(!Array.isArray(selected_web_ids))fail("Selected query IDs must be an array.");
 if(selected_web_ids.length)selected_web_ids=selection(a,selected_web_ids).web_ids;
 return {schema:"gauge-catalogue-project/v1",version:VERSION,before:clone(b.source),after:clone(a.source),notes,selected_web_ids:[...selected_web_ids]};
}
function reopen(value){
 if(!value||value.schema!=="gauge-catalogue-project/v1")fail("Choose a gauge-catalogue-project/v1 file.");
 const retained=project(value),before=sourceValue(retained.before),after=sourceValue(retained.after);
 return {before,after,comparison:compare(before,after),notes:retained.notes,selected_web_ids:retained.selected_web_ids,project:retained};
}
function csv(rows){
 if(!rows.length)return "";const keys=Object.keys(rows[0]);
 const cell=value=>{let s=value===null||value===undefined?"":typeof value==="object"?JSON.stringify(value):String(value);if(typeof value!=="number"&&/^[=+\-@\t\r]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};
 return [keys.map(cell).join(","),...rows.map(r=>keys.map(k=>cell(r[k])).join(","))].join("\r\n")+"\r\n";
}
function recordRows(value){
 const c=value?.schema==="gauge-catalogue-comparison/v1"?value:reopen(value).comparison;
 return [["before",c.before],["after",c.after]].flatMap(([edition,catalogue])=>catalogue.records.map(r=>({
  edition,source_sha256:catalogue.source.sha256,record_id:r.record_id,index:r.index,web_id:r.web_id,ext_id:r.ext_id,feature_id:r.feature_id,name:r.name,status:r.status,
  longitude:r.coordinates?.[0]??null,latitude:r.coordinates?.[1]??null,feature_sha256:r.feature_sha256,original_feature:r.feature})));
}

function report(value,{notes="",title="Gauge catalogue source comparison",selected_web_ids=[]}={}){
 if(typeof notes!=="string"||typeof title!=="string")fail("Report title and notes must be text.");
 const c=value?.schema==="gauge-catalogue-comparison/v1"?compare(value.before,value.after):reopen(value).comparison;
 const e=escaped,number=(n,d=3)=>Number.isFinite(n)?n.toLocaleString("en-US",{maximumFractionDigits:d}):"—";
 const show=v=>v===null||v===undefined?"—":typeof v==="object"?JSON.stringify(v):String(v);
 const table=(heads,rows)=>'<div class="table-wrap"><table><thead><tr>'+heads.map(h=>'<th scope="col">'+e(h)+'</th>').join("")+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(cell=>'<td>'+cell+'</td>').join("")+'</tr>').join("")+'</tbody></table></div>';
 const ref=r=>e(r.name||"(unnamed)")+'<small>Query '+e(r.web_id??"unavailable")+' · external '+e(r.ext_id??"unavailable")+' · feature '+e(show(r.feature_id))+' · '+e(r.status)+'</small>';
 const safeLink=url=>url&&/^https:\/\//i.test(url)?'<a href="'+e(url)+'" rel="noopener noreferrer">'+e(url)+'</a>':e(url||"Not recorded");
 const sources=[["Earlier",c.before],["Later",c.after]].map(([label,s])=>'<section class="source"><h3>'+label+' source: '+e(s.source.label)+'</h3><p>'+safeLink(s.source.url)+'</p><dl><dt>Schema adapter</dt><dd>'+e(s.format)+'</dd><dt>Observation / retrieval</dt><dd>'+e(s.source.retrieved_at||"Not recorded in this source identity")+'</dd><dt>Original bytes</dt><dd>'+e(s.source.bytes)+'</dd><dt>SHA-256</dt><dd class="mono">'+e(s.source.sha256)+'</dd>'+(s.source.git_commit?'<dt>Git commit</dt><dd class="mono">'+e(s.source.git_commit)+'</dd>':"")+(s.source.git_blob?'<dt>Git blob</dt><dd class="mono">'+e(s.source.git_blob)+'</dd>':"")+'</dl></section>').join("");
 const summary=table(["Catalogue","Records","Distinct query IDs","Active","Inactive","Unknown status","No query ID"],[["Earlier",c.before],["Later",c.after]].map(([label,s])=>[e(label),e(s.counts.records),e(s.counts.query_ids),e(s.counts.active),e(s.counts.inactive),e(s.counts.unknown),e(s.counts.without_web_id)]));
 const queries=table(["Query ID","Earlier records","Later records","Selection / differences"],c.queries.map(q=>[e(q.web_id),q.before.map(ref).join("<hr>")||"—",q.after.map(ref).join("<hr>")||"—",
  e(q.status)+'<small>'+e(q.active_count===1?"One current active record":q.active_count===0?"No current active record":q.active_count+" current active records")+'</small>'+q.flags.map(f=>'<small>'+e(f.replace(/_/g," "))+'</small>').join("")]));
 const issueGroups=c.identity_issues.filter(g=>g.source==="after");
 const identity=issueGroups.length?issueGroups.map(g=>'<article><h3>'+e(g.type.replace(/_/g," "))+' '+e(g.value)+'</h3><p>'+e(g.message)+'</p>'+table(["Query","External","Feature","Status","Name","Longitude / latitude"],g.records.map(r=>[e(r.web_id??"—"),e(r.ext_id??"—"),e(show(r.feature_id)),e(r.status),e(r.name),e(show(r.coordinates))]))+
  (g.separations.length?'<p class="small">'+g.separations.map(s=>{const a=g.records.find(r=>r.record_id===s.before_record_id),b=g.records.find(r=>r.record_id===s.after_record_id);return 'Query '+e(a?.web_id??"unavailable")+' / '+e(b?.web_id??"unavailable")+': '+number(s.distance_m,3)+' m coordinate separation';}).join("; ")+'.</p>':"")+'</article>').join(""):'<p>No repeated query IDs or external IDs occur in the later source.</p>';
 const changes=table(["Query / external","Correspondence","Attribute / geometry differences","Coordinate separation","Activation evidence","Original detail"],c.changes.map(r=>{
  const details={before:r.before.map(x=>x.feature),after:r.after.map(x=>x.feature),raw_changes:r.raw_changes,notes:r.notes};
  return [e((r.web_id??"No query ID")+" / "+(r.ext_id??"No external ID")),e(r.status),
   r.fields.map(f=>'<div><strong>'+e(f.field)+'</strong><small>'+e(show(f.before))+' → '+e(show(f.after))+'</small></div>').join("")||"—",
   r.coordinates?number(r.coordinates.distance_m,6)+" m":"—",
   e((r.status_observation.before??"unpaired")+" → "+(r.status_observation.after??"unpaired"))+'<small>'+e(r.status_observation.transition.replace(/_/g," "))+'</small>',
   '<details><summary>Original records and fields</summary><pre>'+e(JSON.stringify(details,null,2))+'</pre></details>'];
 }));
 const recordTable=table(["Edition / index","Query","External","Feature","Name","Status","Longitude / latitude","Full original feature"],recordRows(c).map(r=>[
  e(r.edition+" / "+r.index),e(r.web_id??"—"),e(r.ext_id??"—"),e(show(r.feature_id)),e(r.name),e(r.status),e(r.longitude===null?"—":r.longitude+", "+r.latitude),
  '<details><summary>Original feature</summary><p class="mono">Parsed feature SHA-256: '+e(r.feature_sha256)+'</p><pre>'+e(JSON.stringify(r.original_feature,null,2))+'</pre></details>']));
 const retainedProject=project({before:c.before,after:c.after,notes,selected_web_ids});
 const chosen=retainedProject.selected_web_ids.length?selection(c,retainedProject.selected_web_ids):null;
 const selectedSection=chosen?'<h2>Selected current query records</h2><p>Query IDs '+e(chosen.web_ids.join(", "))+' are bound to the later source and its explicit current active records. Instrument assignment for a historical rainfall window is not resolved by this catalogue.</p>'+table(["Query","External","Feature","Name","Status"],chosen.records.map(r=>[e(r.web_id),e(r.ext_id),e(show(r.feature_id)),e(r.name),e(r.status)]))+'<p>'+chosen.alternatives.length+' other same-query records remain in the selection manifest and full catalogue.</p>':"";
 const payload=JSON.stringify({project:retainedProject,comparison:c,selection:chosen,csv:csv(recordRows(c))}).replace(/</g,"\\u003c").replace(/\u2028/g,"\\u2028").replace(/\u2029/g,"\\u2029");
 return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+e(title)+'</title><style>'+
 '*{box-sizing:border-box}body{margin:0;background:#fff;color:#24282d;font:15px/1.5 system-ui,sans-serif}main{max-width:1320px;margin:0 auto;padding:32px 24px 48px}h1{font-size:29px;line-height:1.2;margin:0 0 12px}h2{font-size:21px;margin:32px 0 12px}h3{font-size:17px}p{max-width:94ch}a{color:#253847;overflow-wrap:anywhere}button{font:inherit;border:1px solid #a4abb2;border-radius:3px;background:#f3f4f5;color:#20252a;padding:9px 12px;cursor:pointer}nav{display:flex;gap:8px;flex-wrap:wrap;margin:20px 0}.summary{padding:14px 18px;background:#f3f4f5;border:1px solid #d4d8dc}.table-wrap{overflow-x:auto;border:1px solid #d4d8dc;margin:12px 0 18px}table{border-collapse:collapse;width:100%;font-size:13px}th,td{padding:10px 12px;text-align:left;vertical-align:top;border-bottom:1px solid #dfe2e5}th{background:#eef0f2;font-weight:600}td{min-width:78px;max-width:420px;overflow-wrap:anywhere}small,.small{display:block;color:#525b65;font-size:12px}hr{border:0;border-top:1px solid #e1e4e7;margin:8px 0}details summary{cursor:pointer}pre{font:12px/1.4 ui-monospace,monospace;white-space:pre-wrap;overflow-wrap:anywhere;max-height:360px;overflow:auto;margin:10px 0}.mono{font:12px/1.5 ui-monospace,monospace;overflow-wrap:anywhere}.sources{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,360px),1fr));gap:18px}.source{border:1px solid #d4d8dc;padding:16px}.source h3{margin-top:0}dl{margin:0}dt{font-size:12px;font-weight:600;margin-top:8px}dd{margin:0;overflow-wrap:anywhere}article{margin:18px 0}footer{border-top:1px solid #d4d8dc;margin-top:28px;padding-top:14px;color:#525b65}.notes{white-space:pre-wrap;overflow-wrap:anywhere}@media(max-width:600px){main{padding:22px 14px}h1{font-size:25px}th,td{padding:8px}}@media print{main{max-width:none;padding:0}nav{display:none}.table-wrap{overflow:visible}table{font-size:9px}th,td{padding:5px;min-width:0}pre{max-height:none}h2,h3{break-after:avoid}tr{break-inside:avoid}.sources{display:block}.source{margin-bottom:12px}}</style></head><body><main>'+
 '<h1>'+e(title)+'</h1><p>Compare original gauge metadata, keep current API query identities explicit, and retain every source record for source maintenance.</p>'+
 '<div class="summary"><strong>'+c.summary.retained_queries+' retained query IDs; '+c.summary.added_queries+' added; '+c.summary.removed_queries+' removed.</strong><p>'+c.summary.added_records+' added catalogue records, '+c.summary.removed_records+' removed, '+c.summary.changed_pairs+' changed matched pairs and '+c.summary.unchanged_pairs+' unchanged matched pairs. Added catalogue records do not establish newly installed stations.</p><p>'+c.summary.coordinate_changed_pairs+' matched pairs have coordinate differences (largest '+number(c.summary.max_matched_coordinate_separation_m,6)+' m); '+c.summary.metadata_changed_pairs+' differ in common descriptive attributes. '+c.summary.known_status_changes+' transitions have explicitly known status in both sources.</p><p>Activation is unknown in '+c.before.counts.unknown+' earlier records. The later source has '+c.after.counts.active+' active and '+c.after.counts.inactive+' inactive records. Catalogue status does not establish instrument assignment or observation availability for an earlier rainfall window.</p></div>'+
 '<nav aria-label="Retained exports"><button data-export="project">Save catalogue project</button><button data-export="comparison">Download comparison JSON</button><button data-export="csv">Download all-record CSV</button><button data-export="before">Earlier original GeoJSON</button><button data-export="after">Later original GeoJSON</button>'+(chosen?'<button data-export="selection">Current query selection</button>':"")+'</nav>'+selectedSection+
 '<h2>Catalogue coverage</h2>'+summary+'<h2>Repeated identifiers</h2><p>Several records can share a query ID or external ID. An external-ID match alone is not a station remapping. The current active record is selected only when exactly one record for that query explicitly has active=true.</p>'+identity+
 '<h2>Query-by-query review</h2>'+queries+
 '<h2>Matched record differences and unmatched records</h2><p>Correspondence uses query ID plus external ID. Feature IDs are retained as source attributes. Coordinate distances use a spherical great-circle calculation (Earth radius 6,371,008.8 m); they quantify differences between published coordinates, not survey accuracy or proof of relocation. Every exact parsed field difference remains in the original detail.</p>'+changes+
 '<h2>All original records</h2><p>All '+(c.before.counts.records+c.after.counts.records)+' records are retained, including records without an API query ID. Feature hashes describe canonical parsed feature JSON; source hashes below bind the exact original UTF-8 text.</p>'+recordTable+
 (notes?'<h2>Reviewer notes</h2><div class="notes">'+e(notes)+'</div>':"")+
 '<h2>Original source identities</h2><div class="sources">'+sources+'</div><footer>Gauge Catalogue Review '+VERSION+'. This comparison describes retained catalogue metadata. No rainfall amount, historical instrument assignment, or dated activation event is inferred.</footer></main>'+
 '<script type="application/json" id="catalogue-export-data">'+payload+'</script><script>(function(){const d=JSON.parse(document.getElementById("catalogue-export-data").textContent);for(const b of document.querySelectorAll("[data-export]"))b.onclick=()=>{const k=b.dataset.export;let s,t,n;if(k==="csv"){s=d.csv;t="text/csv";n="catalogue-records.csv";}else if(k==="before"||k==="after"){s=d.project[k].content;t="application/geo+json";n="catalogue-"+k+".geojson";}else{s=JSON.stringify(d[k],null,2)+"\\n";t="application/json";n="catalogue-"+k+".json";}const u=URL.createObjectURL(new Blob([s],{type:t})),a=document.createElement("a");a.href=u;a.download=n;a.click();setTimeout(()=>URL.revokeObjectURL(u),10000);};})();</script></body></html>';
}

root.GaugeCatalogue={VERSION,normalize,compare,project,reopen,selection,validateSelection,report,recordRows,csv,escaped,canonical,sha256Text};
})(typeof globalThis!=="undefined"?globalThis:this);
