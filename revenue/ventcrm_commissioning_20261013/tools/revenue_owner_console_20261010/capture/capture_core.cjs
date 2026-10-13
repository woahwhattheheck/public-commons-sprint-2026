'use strict';
// Original capture workflow for the URLShot lead trial. Node 20+, no dependencies.
const LIMITS = {
  viewport_width:[200,3840], viewport_height:[200,4320],
  device_scale_factor:[0.5,3], delay_ms:[0,10000], timeout_ms:[1000,30000],
  quality:[1,100], cache_ttl:[0,86400]
};
const BOOLS = new Set(["full_page","block_cookie_banners","dark_mode"]);
const WAIT_UNTIL = new Set(["auto","load","domcontentloaded","networkidle0","networkidle2"]);
function planJobs(input) {
  if (input.schema_version !== 1 || !Array.isArray(input.jobs) || !input.jobs.length)
    throw new Error("Expected schema_version 1 and a nonempty jobs array.");
  const ids = new Set();
  return input.jobs.map(job => {
    if (!/^[a-z0-9][a-z0-9_-]{0,79}$/.test(job.id) || ids.has(job.id))
      throw new Error("Job IDs must be unique lowercase letters, numbers, underscores or hyphens.");
    ids.add(job.id);
    if (typeof job.url !== "string" || !/^https?:\/\/[a-zA-Z0-9.-]+(?::[0-9]+)?(?:[/?#][^\s]*)?$/.test(job.url))
      throw new Error(job.id + ": use a public HTTP(S) URL without embedded credentials.");
    const o = {format:"webp",quality:85,viewport_width:1440,viewport_height:1000,
      device_scale_factor:1,full_page:true,delay_ms:1000,timeout_ms:15000,
      block_cookie_banners:true,...job.options};
    if (!["png","jpeg","webp"].includes(o.format)) throw new Error(job.id + ": unsupported format.");
    if (o.format === "png") delete o.quality;
    for (const [key,value] of Object.entries(o)) {
      if (key === "format") continue;
      if (key === "selector") {
        if (typeof value !== "string" || !value.trim() || o.full_page)
          throw new Error(job.id + ": selector requires nonempty text and full_page=false.");
      } else if (key === "wait_until") {
        if (typeof value !== "string" || !WAIT_UNTIL.has(value))
          throw new Error(job.id + ": wait_until must be auto, load, domcontentloaded, networkidle0 or networkidle2.");
      } else if (BOOLS.has(key)) {
        if (typeof value !== "boolean") throw new Error(job.id + ": " + key + " must be boolean.");
      } else if (LIMITS[key]) {
        const [lo,hi] = LIMITS[key];
        if (typeof value !== "number" || !Number.isFinite(value) || value < lo || value > hi ||
            (key !== "device_scale_factor" && !Number.isInteger(value)))
          throw new Error(job.id + ": " + key + " is outside the documented range.");
      } else throw new Error(job.id + ": unsupported option " + key);
    }
    const options = Object.fromEntries(Object.keys(o).sort().map(k=>[k,o[k]]));
    const signature = JSON.stringify({url:job.url,options});
    const query = Object.entries({url:job.url,...options})
      .map(([k,v])=>encodeURIComponent(k)+"="+encodeURIComponent(String(v))).join("&");
    return {id:job.id,account_id:job.account_id||job.id,url:job.url,options,signature,
      request_url:"https://api.urlshot.io/v1/screenshot?"+query};
  });
}
function isImage(bytes, format) {
  if (!bytes || bytes.length < 12) return false;
  if (format === "png") return [137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v);
  if (format === "jpeg") return bytes[0]===255 && bytes[1]===216 && bytes[2]===255;
  return bytes[0]===82 && bytes[1]===73 && bytes[2]===70 && bytes[3]===70 &&
    bytes[8]===87 && bytes[9]===69 && bytes[10]===66 && bytes[11]===80;
}
function retryAt(value, now) {
  if (value == null || String(value).trim() === "") return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    const at=now + Math.max(1,seconds)*1000;
    return Number.isFinite(at) && at <= 8640000000000000 ? new Date(at).toISOString() : null;
  }
  const date = Date.parse(String(value));
  return Number.isFinite(date) ? new Date(Math.max(now+1000,date)).toISOString() : null;
}
function responseDecision(status, error, headers, now) {
  if ([401,402,403].includes(status) ||
      (status===429 && error?.code==="monthly_limit_exceeded"))
    return {status:"account_required"};
  const retryable = (status===429 &&
    ["concurrency_limit_exceeded","rate_limit_exceeded"].includes(error?.code)) ||
    (status===503 && error?.code==="service_unavailable");
  const until = retryable ? retryAt(headers?.["retry-after"],now) : null;
  return until ? {status:"waiting",until} : {status:"failed"};
}
const SAFE_HEADERS = ["x-request-id","x-urlshot-cache","x-urlshot-credits-used",
  "x-urlshot-renderer","x-ratelimit-limit","x-ratelimit-remaining","retry-after"];
async function captureJobs(jobs, state, io, retryFailed=false) {
  state.schema_version=1; state.jobs ||= {}; state.attempts ||= [];
  // Recover manifests saved by the earlier HTTP-status-only retry policy.
  let recovered=false;
  for (const row of Object.values(state.jobs)) {
    if (row.status!=="waiting") continue;
    const attempt=state.attempts.findLast(a=>a.id===row.id);
    const decision=responseDecision(row.http_status ?? attempt?.http_status,
      row.error,row.headers,io.now());
    if (decision.status!=="waiting") { row.status=decision.status; recovered=true; }
  }
  if (recovered) {
    if (!Object.values(state.jobs).some(row=>row.status==="waiting"))
      delete state.retry_after_until;
    await io.persist(state);
  }
  const accountJob=jobs.find(job=>state.jobs[job.id]?.signature===job.signature &&
    state.jobs[job.id]?.status==="account_required");
  if (accountJob && !retryFailed)
    return {state,reason:"account_response",job:accountJob.id};
  if (state.retry_after_until && Date.parse(state.retry_after_until)>io.now()) {
    return {state,reason:"cooldown",until:state.retry_after_until};
  }
  delete state.retry_after_until;
  for (const job of jobs) {
    let old=state.jobs[job.id];
    if (old?.signature === job.signature && old.status === "complete" && await io.hasImage(old)) continue;
    if (old?.signature === job.signature && ["failed","uncertain","in_flight"].includes(old.status) && !retryFailed) {
      if (old.status === "in_flight") { old.status="uncertain"; await io.persist(state); }
      continue;
    }
    const started=new Date(io.now()).toISOString();
    const row={id:job.id,account_id:job.account_id,url:job.url,options:job.options,
      signature:job.signature,status:"in_flight",started_at:started};
    state.jobs[job.id]=row;
    await io.persist(state);
    let response;
    try { response=await io.request(job); }
    catch (error) {
      row.status="uncertain"; row.error={code:"transport_error",message:String(error.message||error)};
      state.attempts.push({id:job.id,at:started,status:"uncertain",error:row.error});
      await io.persist(state);
      return {state,reason:"transport_error",job:job.id};
    }
    const headers={};
    for (const key of SAFE_HEADERS) if (response.headers?.[key] != null) headers[key]=response.headers[key];
    row.headers=headers; row.http_status=response.status;
    const attempt={id:job.id,at:started,http_status:response.status,headers};
    state.attempts.push(attempt);
    if (response.status===200 && isImage(response.bytes,job.options.format)) {
      const stamp=new Date(io.now()).toISOString().replace(/[:.]/g,"-");
      const file=job.id+"-"+stamp+"."+job.options.format;
      try {
        const saved=await io.writeImage(file,response.bytes);
        Object.assign(row,saved,{file,status:"complete",completed_at:new Date(io.now()).toISOString()});
      } catch(error) {
        row.status="uncertain"; row.error={code:"save_failed",message:String(error.message||error)};
        await io.persist(state);
        return {state,reason:"save_failed",job:job.id};
      }
    } else {
      row.error=response.error || {code:"unexpected_response",message:"HTTP "+response.status+" or invalid image bytes"};
      const decision=responseDecision(response.status,row.error,headers,io.now());
      row.status=decision.status;
      if (decision.until) state.retry_after_until=decision.until;
    }
    await io.persist(state);
    if (row.status==="waiting") return {state,reason:"cooldown",until:state.retry_after_until};
    if (row.status==="account_required") return {state,reason:"account_response",job:job.id};
  }
  const incomplete=jobs.filter(job=>state.jobs[job.id]?.signature!==job.signature ||
    state.jobs[job.id]?.status!=="complete").map(j=>j.id);
  return {state,reason:incomplete.length?"attention_required":"complete",incomplete};
}
function esc(s) {return String(s ?? "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function reviewHtml(state) {
  const rows=Object.values(state.jobs || {});
  const credits=(state.attempts || []).reduce((n,a)=>n+Number(a.headers?.["x-urlshot-credits-used"]||0),0);
  return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Capture review</title><style>body{font:16px/1.5 system-ui;margin:24px auto;padding:0 20px;max-width:1200px;color:#202020;background:#fff}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr));gap:24px}article{border-top:1px solid #bbb;padding-top:12px;min-width:0}a{color:inherit;overflow-wrap:anywhere}img{width:100%;height:auto;max-height:640px;object-fit:contain;object-position:top;background:#eee}pre{white-space:pre-wrap;overflow-wrap:anywhere}small{color:#505050}</style><h1>Capture review</h1><p>'+rows.filter(r=>r.status==="complete").length+' complete / '+rows.length+' recorded. Observed credits used: '+credits+'.</p><main>'+rows.map(r=>'<article><h2>'+esc(r.id)+'</h2><p>'+esc(r.status)+' · <a href="'+esc(r.url)+'">Source page</a></p><small>'+esc(r.completed_at||r.started_at)+'</small>'+(r.status==="complete"?'<p><a href="'+esc(r.file)+'"><img src="'+esc(r.file)+'" alt="'+esc(r.id)+' capture"></a></p>':'')+'<pre>'+esc(JSON.stringify({options:r.options,request_id:r.headers?.["x-request-id"],error:r.error},null,2))+'</pre></article>').join("")+'</main></html>';
}

module.exports={planJobs,captureJobs,reviewHtml};
