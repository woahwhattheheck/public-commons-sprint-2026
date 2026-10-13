function utf8Encode(s){const out=[];for(const c of s){const n=c.codePointAt(0);if(n<128)out.push(n);else if(n<2048)out.push(192|(n>>6),128|(n&63));else if(n<65536)out.push(224|(n>>12),128|((n>>6)&63),128|(n&63));else out.push(240|(n>>18),128|((n>>12)&63),128|((n>>6)&63),128|(n&63));}return Uint8Array.from(out);}
function sha256(bytes){const K=[],H=[];for(let n=2;K.length<64;n++){let prime=true;for(let d=2;d*d<=n;d++)if(n%d===0){prime=false;break;}if(prime){if(H.length<8)H.push(Math.floor((Math.sqrt(n)%1)*4294967296)>>>0);K.push(Math.floor((Math.cbrt(n)%1)*4294967296)>>>0);}}const size=Math.ceil((bytes.length+9)/64)*64,data=new Uint8Array(size);data.set(bytes);data[bytes.length]=128;let len=bytes.length*8;for(let i=0;i<8;i++){data[size-1-i]=len%256;len=Math.floor(len/256);}const rot=(x,n)=>(x>>>n)|(x<<(32-n)),W=new Uint32Array(64);for(let off=0;off<size;off+=64){for(let i=0;i<16;i++)W[i]=(data[off+i*4]<<24)|(data[off+i*4+1]<<16)|(data[off+i*4+2]<<8)|data[off+i*4+3];for(let i=16;i<64;i++){const a=W[i-15],b=W[i-2],s0=rot(a,7)^rot(a,18)^(a>>>3),s1=rot(b,17)^rot(b,19)^(b>>>10);W[i]=(W[i-16]+s0+W[i-7]+s1)>>>0;}let [a,b,c,d,e,f,g,h]=H;for(let i=0;i<64;i++){const s1=rot(e,6)^rot(e,11)^rot(e,25),ch=(e&f)^(~e&g),t1=(h+s1+ch+K[i]+W[i])>>>0,s0=rot(a,2)^rot(a,13)^rot(a,22),maj=(a&b)^(a&c)^(b&c),t2=(s0+maj)>>>0;h=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0;}[a,b,c,d,e,f,g,h].forEach((x,i)=>H[i]=(H[i]+x)>>>0);}return H.map(x=>x.toString(16).padStart(8,"0")).join("");}
/* Rainfall Release Review — original implementation, 2026 TokenJunkie Labs. */
(function (root) {
"use strict";
const VERSION = "1.0.0";
const own = (x,k) => Object.prototype.hasOwnProperty.call(x,k);
const fail = message => { throw new Error(message); };
const natural = (a,b) => String(a).localeCompare(String(b), "en", {numeric:true});
const round = n => Number(n.toFixed(8));
const escaped = value => String(value ?? "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const SOURCES = {"R":"Calibrated radar","G":"Gauge","G-1":"Estimated from one gauge","G-2":"Estimated from two gauges","G-3":"Estimated from three gauges","G-0":"No available gauge or calibrated radar","N/D":"No observation"};
const NO_DATA = new Set(["G-0","N/D"]);
function instant(value, label) {
  if (typeof value!=="string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) fail(label+" must be an ISO timestamp with Z or an explicit UTC offset.");
  if(Number(value.slice(11,13))>23 || Number(value.slice(14,16))>59) fail(label+" has an invalid time.");
  const ms=Date.parse(value);
  if (!Number.isFinite(ms)) fail(label+" is not a valid timestamp.");
  const datePart=value.slice(0,10), parts=datePart.split("-").map(Number);
  if (parts[1]<1 || parts[1]>12 || parts[2]<1 || parts[2]>new Date(Date.UTC(parts[0],parts[1],0)).getUTCDate()) fail(label+" is not a valid calendar date.");
  return ms;
}
function metadata(m) {
  if (!m || typeof m!=="object") fail("Release metadata is required.");
  for (const key of ["label","product","sensor_type","start","end","retrieved_at","source_url","units","timestamp_label"]) if (typeof m[key]!=="string" || !m[key].trim()) fail("Release metadata needs "+key+".");
  if (!["gauge","pixel"].includes(m.sensor_type)) fail("Sensor type must be gauge or pixel.");
  if (!["realtime","historic","historic15","historic5"].includes(m.product)) fail("Unknown rainfall product.");
  if (!["inches","mm"].includes(m.units)) fail("Units must be inches or mm.");
  if (!["end","start","range"].includes(m.timestamp_label)) fail("Timestamp label must be end, start, or range.");
  if (![5,15,60].includes(m.interval_minutes)) fail("Choose a supported 5, 15, or 60 minute interval.");
  const start=instant(m.start,"Window start"), end=instant(m.end,"Window end"), step=m.interval_minutes*60000;
  instant(m.retrieved_at,"Retrieval time");
  if (m.sensors?.length * ((end-start)/step) > 1000000) fail("Use separate review windows for more than one million sensor intervals.");
  if (!(end>start) || (end-start)%step!==0) fail("The window must contain a whole positive number of intervals.");
  if ((end-start)/step>105408) fail("Choose a window of at most 105,408 intervals for this reviewer.");
  if (!Array.isArray(m.sensors) || !m.sensors.length || m.sensors.length>250 || m.sensors.some(x=>typeof x!=="string" || !x.trim())) fail("List 1–250 sensor IDs as strings.");
  if (new Set(m.sensors).size!==m.sensors.length) fail("Sensor IDs must be unique.");
  if (!/^https:\/\//i.test(m.source_url)) fail("Use an HTTPS source URL.");
  return {...m,sensors:[...m.sensors].sort(natural),start_ms:start,end_ms:end,step_ms:step,expected:(end-start)/step};
}
function pointTime(raw,m) {
  if (m.timestamp_label==="range") {
    if (typeof raw!=="string" || raw.split("/").length!==2) fail("Expected an explicit start/end timestamp range.");
    const [a,b]=raw.split("/").map(x=>x.trim()), start=instant(a,"Observation start"), end=instant(b,"Observation end");
    if (end-start!==m.step_ms) fail("An observation range differs from the selected interval.");
    return end;
  }
  const ms=instant(raw,"Observation time");
  return ms+(m.timestamp_label==="start"?m.step_ms:0);
}
function points(response) {
  if (!response || response.status!=="finished" || !Array.isArray(response.data)) fail("Import a finished API result with a data array. A queued job receipt is not a rainfall result.");
  const result=[];
  for (const group of response.data) {
    if (!group || typeof group!=="object") fail("Invalid sensor group.");
    if (Array.isArray(group.data)) {
      for (const p of group.data) result.push({...p,id:p.id??group.id});
    } else if (group.data && typeof group.data==="object") {
      const keys=Object.keys(group.data), n=keys.length && Array.isArray(group.data[keys[0]])?group.data[keys[0]].length:0;
      if (!keys.length || keys.some(k=>!Array.isArray(group.data[k]) || group.data[k].length!==n)) fail("Columnar data arrays must have equal lengths.");
      for(let i=0;i<n;i++){const p={id:group.id};for(const k of keys)p[k]=group.data[k][i];result.push(p);}
    } else if (own(group,"ts")) result.push(group);
    else fail("Unknown rainfall sensor shape.");
  }
  return result;
}
function release(capture) {
  if (!capture || capture.schema!=="rainfall-release/v1" || typeof capture.raw_text!=="string") fail("Choose a rainfall-release/v1 capture containing the original raw_text.");
  const m=metadata(capture.metadata);
  const fingerprint=sha256(utf8Encode(capture.raw_text));
  if (capture.raw_sha256 && capture.raw_sha256!==fingerprint) fail("The saved raw response hash does not match its content.");
  let response;try{response=JSON.parse(capture.raw_text);}catch(e){fail("The raw rainfall response is not valid JSON.");}
  const grouped=new Map(m.sensors.map(id=>[id,new Map()]));
  const warnings=new Set(), outside=[], duplicateRows=[];
  for (const p of points(response)) {
    if (p.id===null || p.id===undefined || String(p.id)==="") fail("An observation has no sensor ID.");
    const id=String(p.id);if(!grouped.has(id)) fail("Unexpected sensor "+id+"; update the capture selection.");
    const t=pointTime(p.ts,m);
    if (t<=m.start_ms || t>m.end_ms) {outside.push({id,ts:p.ts});continue;}
    if((t-m.start_ms)%m.step_ms!==0) fail("An observation does not align with the requested interval: "+id+" "+p.ts);
    const raw=own(p,"val")?p.val:p.rainfall;
    if(raw===undefined) fail("An observation is missing both val and rainfall.");
    const src=p.src===undefined||p.src===null?"":String(p.src).trim();
    let value=null,status="missing";
    if(NO_DATA.has(src)) status="source-unavailable";
    else if(raw===null || raw==="") status="missing";
    else if(typeof raw!=="number" || !Number.isFinite(raw) || raw<0) status="invalid";
    else {value=m.units==="mm"?raw/25.4:raw;status="valid";}
    if(src && !own(SOURCES,src) && src!=="-") warnings.add("Unrecognized source code: "+src);
    if(NO_DATA.has(src)&&typeof raw==="number"&&raw>0) warnings.add("A source-unavailable code accompanies a positive value; it remains excluded.");
    const point={id,time:t,timestamp:new Date(t).toISOString(),raw_timestamp:p.ts,raw_value:raw,value_in:value,source:src,status};
    const prev=grouped.get(id).get(t);
    if(prev) {
      if(prev.raw_value!==point.raw_value || prev.source!==point.source || prev.status!==point.status) fail("Conflicting duplicate at "+id+" "+point.timestamp+".");
      duplicateRows.push({id,timestamp:point.timestamp});continue;
    }
    grouped.get(id).set(t,point);
  }
  const summaries=[];
  for(const [id,series] of grouped) {
    let valid=0,sum=0,missing=0,invalid=0,sourceUnavailable=0,peak=null;
    const sourceCounts={};
    for(const p of series.values()) {
      sourceCounts[p.source||"unspecified"]=(sourceCounts[p.source||"unspecified"]||0)+1;
      if(p.status==="valid"){valid++;sum+=p.value_in;if(!peak||p.value_in>peak.value_in)peak=p;}
      else if(p.status==="invalid")invalid++;
      else if(p.status==="source-unavailable")sourceUnavailable++;
      else missing++;
    }
    summaries.push({id,expected:m.expected,returned:series.size,valid,absent:m.expected-series.size,missing,invalid,source_unavailable:sourceUnavailable,coverage_percent:round(valid/m.expected*100),observed_total_in:valid?round(sum):null,complete:valid===m.expected,peak,source_counts:sourceCounts});
  }
  if(outside.length)warnings.add(outside.length+" out-of-window rows retained in the capture and excluded from review.");
  if(duplicateRows.length)warnings.add(duplicateRows.length+" identical duplicate rows counted once.");
  return {schema:"rainfall-normalized/v1",metadata:m,fingerprint,grouped,summaries,warnings:[...warnings],outside,duplicateRows,capture:{schema:capture.schema,metadata:capture.metadata,raw_text:capture.raw_text,raw_sha256:fingerprint}};
}
function compare(before,after) {
  const a=before.metadata,b=after.metadata;
  for(const key of ["sensor_type","interval_minutes","start_ms","end_ms"]) if(a[key]!==b[key])fail("Comparison needs the same "+key.replaceAll("_"," ")+".");
  if(JSON.stringify(a.sensors)!==JSON.stringify(b.sensors))fail("Comparison needs the same selected sensors.");
  const rows=[],summary=[],sourceTransitions={};
  for(const id of a.sensors) {
    const left=before.grouped.get(id),right=after.grouped.get(id);
    const totals={id,expected:a.expected,matched_valid:0,value_changed:0,source_changed:0,recovered:0,lost:0,both_unavailable:0,before_matched_in:0,after_matched_in:0};
    for(let t=a.start_ms+a.step_ms;t<=a.end_ms;t+=a.step_ms) {
      const p=left.get(t),q=right.get(t),pv=p?.status==="valid",qv=q?.status==="valid";
      let state;
      if(pv&&qv){totals.matched_valid++;totals.before_matched_in+=p.value_in;totals.after_matched_in+=q.value_in;state=Math.abs(q.value_in-p.value_in)>1e-9?"changed":"unchanged";if(state==="changed")totals.value_changed++;}
      else if(qv){state="recovered";totals.recovered++;}
      else if(pv){state="lost";totals.lost++;}
      else {state="unavailable";totals.both_unavailable++;}
      const sourceChanged=Boolean(p&&q&&p.source!==q.source);
      if(sourceChanged){totals.source_changed++;const key=(p.source||"unspecified")+" → "+(q.source||"unspecified");sourceTransitions[key]=(sourceTransitions[key]||0)+1;}
      rows.push({id,timestamp:new Date(t).toISOString(),before_in:pv?p.value_in:null,after_in:qv?q.value_in:null,delta_in:pv&&qv?round(q.value_in-p.value_in):null,before_status:p?.status??"absent",after_status:q?.status??"absent",before_source:p?.source??"",after_source:q?.source??"",state,source_changed:sourceChanged});
    }
    totals.before_matched_in=totals.matched_valid?round(totals.before_matched_in):null;
    totals.after_matched_in=totals.matched_valid?round(totals.after_matched_in):null;
    totals.matched_delta_in=totals.matched_valid?round(totals.after_matched_in-totals.before_matched_in):null;
    totals.matched_delta_percent=totals.before_matched_in?round(totals.matched_delta_in/totals.before_matched_in*100):null;
    summary.push(totals);
  }
  return {before,after,rows,summary,sourceTransitions};
}
function csv(rows) {
  if(!rows.length)return "";
  const keys=Object.keys(rows[0]),cell=x=>{let v=x===null||x===undefined?"":typeof x==="object"?JSON.stringify(x):String(x);if(/^[=+@-]/.test(v)&&typeof x!=="number")v="'"+v;return '"'+v.replaceAll('"','""')+'"';};
  return [keys.map(cell).join(","),...rows.map(r=>keys.map(k=>cell(r[k])).join(","))].join("\r\n")+"\r\n";
}
function project(releases,notes="") {
  return {schema:"rainfall-review-project/v1",version:VERSION,notes:String(notes),releases:releases.map(x=>x.capture)};
}
function reopen(value) {
  if(value?.schema!=="rainfall-review-project/v1" || !Array.isArray(value.releases) || !value.releases.length || value.releases.length>2)fail("Choose a review project containing one or two rainfall releases.");
  const releases=value.releases.map(release);
  return {releases,notes:String(value.notes??""),comparison:releases.length===2?compare(...releases):null};
}
function report(releases,notes="") {
  const comparison=releases.length===2?compare(...releases):null;
  const table=(headers,rows)=>'<div class="table"><table><thead><tr>'+headers.map(x=>"<th>"+escaped(x)+"</th>").join("")+'</tr></thead><tbody>'+rows.map(row=>"<tr>"+row.map(x=>"<td>"+escaped(x===null?"—":x)+"</td>").join("")+"</tr>").join("")+"</tbody></table></div>";
  const cards=releases.map(r=>"<section><h2>"+escaped(r.metadata.label)+"</h2><p>"+escaped(r.metadata.product+" · "+r.metadata.sensor_type+" · "+r.metadata.interval_minutes+" minutes")+"<br>"+escaped(r.metadata.start+" to "+r.metadata.end)+"</p>"+table(["Sensor","Valid / expected","Coverage %","Absent","Missing","Invalid","Unavailable source","Observed inches"],r.summaries.map(s=>[s.id,s.valid+" / "+s.expected,s.coverage_percent,s.absent,s.missing,s.invalid,s.source_unavailable,s.observed_total_in]))+r.warnings.map(x=>"<p>"+escaped(x)+"</p>").join("")+'<p class="source">Source: '+escaped(r.metadata.source_url)+"<br>Retrieved: "+escaped(r.metadata.retrieved_at)+"<br>SHA-256: "+escaped(r.fingerprint)+"</p></section>").join("");
  const change=comparison?"<section><h2>Release comparison</h2><p>Deltas use only intervals with a valid observation in both releases. Recovered and lost intervals are counted separately.</p>"+table(["Sensor","Matched intervals","Changed","Recovered","Lost","Source changed","Matched delta (in)"],comparison.summary.map(s=>[s.id,s.matched_valid,s.value_changed,s.recovered,s.lost,s.source_changed,s.matched_delta_in]))+"</section>":"";
  return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Rainfall release review</title><style>body{font:15px/1.55 system-ui,sans-serif;color:#202327;max-width:1120px;margin:40px auto;padding:0 24px}h1{font-size:28px}h2{font-size:20px;margin-top:32px}table{border-collapse:collapse;width:100%;font-size:13px}th,td{padding:10px 9px;text-align:left;border-bottom:1px solid #d5d7d9;vertical-align:top}th{background:#f0f1f2}.table{overflow:auto}.source{font-size:12px;overflow-wrap:anywhere;color:#52575d}section{break-inside:avoid}pre{white-space:pre-wrap;font:inherit}@media print{body{margin:0;max-width:none;padding:0}table{font-size:10px}th,td{padding:6px 4px}}</style><h1>Rainfall release review</h1><p>Rainfall accumulation and release changes for the selected sensors and time window.</p><p>Observed totals sum available valid intervals. Coverage below 100% means the total is incomplete. Missing observations remain missing; no rainfall is estimated.</p>'+cards+change+(notes?"<section><h2>Reviewer notes</h2><pre>"+escaped(notes)+"</pre></section>":"")+'<footer><p class="source">Prepared with Rainfall Release Review '+VERSION+'. Source data stays in its original capture. This report uses interval end times normalized to UTC and rainfall expressed in inches.</p></footer></html>';
}
const api={VERSION,SOURCES,instant,metadata,release,compare,csv,project,reopen,report,escaped,sha256Text:s=>sha256(utf8Encode(s))};
root.RainfallReview=api;
})(typeof globalThis!=="undefined"?globalThis:this);
