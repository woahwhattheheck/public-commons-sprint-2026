"use strict";
const $ = id => document.getElementById(id);
const state = {config:null, source:null, child:null, image:null, busy:false, epoch:0};
const edges = ["left", "top", "right", "bottom"];
const canvas = $("canvas"), ctx = canvas.getContext("2d");
let pointer = null;
function status(message, error=false) { $("status").textContent=message; $("status").classList.toggle("error",error); }
function rectangle() { return Object.fromEntries(edges.map(key=>[key,Number($(key).value)])); }
function validRect() {
  if (!state.source) return false;
  const p=state.source.trace.perception,r=rectangle();
  return edges.every(key=>$(key).value!=="" && Number.isInteger(r[key])) && r.left>=0 && r.top>=0 &&
    r.right<=p.width && r.bottom<=p.height && r.right-r.left>=p.policy.min_width && r.bottom-r.top>=p.policy.min_height;
}
function controls() {
  for (const id of ["demo","kind","upload","priors",...edges,"reason","confirm"]) $(id).disabled=state.busy || !state.config;
  $("crop").disabled=state.busy || !validRect() || !$("confirm").checked || !$("reason").value.trim() ||
    state.source.trace.decision.action!=="REQUEST_HUMAN_CROP";
  $("export").disabled=state.busy || !state.child;
}
function draw() {
  ctx.clearRect(0,0,canvas.width,canvas.height);
  if (!state.image || !state.source) return;
  ctx.drawImage(state.image,0,0,canvas.width,canvas.height);
  const r=rectangle(),p=state.source.trace.perception,sx=canvas.width/p.width,sy=canvas.height/p.height;
  ctx.save();ctx.strokeStyle="#e9b13b";ctx.fillStyle="rgba(233,177,59,0.12)";ctx.lineWidth=4;
  ctx.strokeRect(r.left*sx,r.top*sy,(r.right-r.left)*sx,(r.bottom-r.top)*sy);
  ctx.fillRect(r.left*sx,r.top*sy,(r.right-r.left)*sx,(r.bottom-r.top)*sy);ctx.restore();
  $("selection").textContent=`Selection: ${r.right-r.left} × ${r.bottom-r.top} original pixels. ${validRect()?"Rectangle is within image bounds.":"Enter ordered edges and meet the original policy's minimum dimensions."}`;
}
function measurements() {
  const p=state.source?.trace.perception,q=state.child?.trace.perception;
  const fields=[["Document candidates","document_candidate_count",1],["Text lines","text_line_count",1],
    ["Blur variance","laplacian_variance_milli",1000],["Contrast","contrast_milli",1000],
    ["Glare %","glare_ppm",10000],["Edge density %","edge_ppm",10000]];
  $("metrics").replaceChildren(...fields.map(([label,key,scale])=>{
    const row=document.createElement("tr");
    for (const value of [label,p?(p[key]/scale).toFixed(scale===1?0:2):"—",q?(q[key]/scale).toFixed(scale===1?0:2):"—"]) {
      const cell=document.createElement("td");cell.textContent=value;row.append(cell);
    }return row;
  }));
  $("receipts").textContent=JSON.stringify({source_trace:state.source?.trace.receipt_sha256 || null,
    original_sha256:p?.source_sha256 || null,prior_count:state.source?.prior_count || 0,
    crop:state.child?.receipt || null},null,2);
}
function invalidate() {
  state.child=null;$("result").hidden=true;$("result-empty").hidden=false;$("result-badge").textContent="No current crop";
  $("child-action").textContent="Human review remains required";$("confirm").checked=false;
  draw();measurements();controls();
}
async function api(path,data,asBlob=false) {
  const response=await fetch(path,{method:"POST",headers:{"Content-Type":"application/json","X-Workspace-Token":state.config.token},body:JSON.stringify(data)});
  if (!response.ok) { const message=await response.json(); throw new Error(message.error || "Request failed"); }
  return asBlob?response.blob():response.json();
}
async function operation(fn) {
  if(state.busy || !state.config) return;
  state.busy=true;controls();status("Running the canonical vision pipeline locally…");
  try { await fn(); } catch(error) { status(error.message,true); }
  finally { state.busy=false;controls(); }
}
async function load(path,data) {
  const epoch=++state.epoch;state.source=null;state.image=null;invalidate();draw();
  $("empty").hidden=false;$("empty").textContent="Loading source…";
  $("source-label").textContent="No current source";$("source-action").textContent="Waiting for evidence";
  $("context").textContent="Loading local evidence. No current crop or duplicate context is active.";
  const source=await api(path,data);if(epoch!==state.epoch)return;
  const image=new Image();image.src="data:image/png;base64,"+source.preview_png_b64;await image.decode();
  if(epoch!==state.epoch)return;
  state.source=source;state.image=image;canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
  $("empty").hidden=true;$("source-label").textContent=source.synthetic?"SYNTHETIC EXAMPLE":"LOCAL INPUT";
  $("source-action").textContent=source.trace.decision.action;
  $("context").textContent=`${source.trace.perception.width} × ${source.trace.perception.height} pixels · ${source.prior_count} prior fingerprints supplied. ${source.prior_count?"Only this supplied context is considered.":"No historical duplicate index is loaded."}`;
  for(const [key,value] of Object.entries({left:0,top:0,right:source.trace.perception.width,bottom:source.trace.perception.height}))$(key).value=value;
  $("reason").value="";invalidate();
  status(source.trace.decision.action==="REQUEST_HUMAN_CROP"?"Human crop requested. Drag a rectangle around one complete document, explain the selection, then re-evaluate.":`Current route: ${source.trace.decision.action}. Crop is unavailable for this route; keep its review or recapture requirement.`);
}
$("demo").addEventListener("click",()=>operation(()=>load("/api/demo",{kind:$("kind").value})));
$("upload").addEventListener("change",()=>operation(async()=>{
  const file=$("upload").files[0];if(!file)return;
  if(file.size>state.config.max_image_bytes)throw new Error("Image exceeds the 20 MiB limit.");
  let priors="[]";const priorFile=$("priors").files[0];
  if(priorFile){if(priorFile.size>256*1024)throw new Error("Prior JSON exceeds 256 KiB.");priors=await priorFile.text();}
  const buffer=new Uint8Array(await file.arrayBuffer());let binary="";
  for(let i=0;i<buffer.length;i+=32768)binary+=String.fromCharCode(...buffer.subarray(i,i+32768));
  await load("/api/case",{image_b64:btoa(binary),evidence_id:"LOCAL-IMAGE",prior_fingerprints_json:priors});
}));
$("priors").addEventListener("change",()=>status("Prior context is applied when an image is loaded. Load or reload the image to apply this file."));
for(const key of edges)$(key).addEventListener("input",invalidate);
$("reason").addEventListener("input",invalidate);
$("confirm").addEventListener("change",controls);
function position(event){const box=canvas.getBoundingClientRect(),p=state.source.trace.perception;return{x:Math.max(0,Math.min(p.width,(event.clientX-box.left)/box.width*p.width)),y:Math.max(0,Math.min(p.height,(event.clientY-box.top)/box.height*p.height))};}
canvas.addEventListener("pointerdown",event=>{
  if(state.busy || !state.source || state.source.trace.decision.action!=="REQUEST_HUMAN_CROP")return;
  pointer={id:event.pointerId,start:position(event)};canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener("pointermove",event=>{
  if(!pointer || pointer.id!==event.pointerId || state.busy)return;
  const a=pointer.start,b=position(event),r={left:Math.floor(Math.min(a.x,b.x)),top:Math.floor(Math.min(a.y,b.y)),right:Math.ceil(Math.max(a.x,b.x)),bottom:Math.ceil(Math.max(a.y,b.y))};
  for(const key of edges)$(key).value=r[key];invalidate();
});
for(const eventName of ["pointerup","pointercancel"])canvas.addEventListener(eventName,event=>{if(pointer?.id===event.pointerId)pointer=null;});
$("crop").addEventListener("click",()=>operation(async()=>{
  const result=await api("/api/crop",{case_id:state.source.case_id,rectangle:rectangle(),human_confirmed:$("confirm").checked,note:$("reason").value});
  if(result.case_id!==state.source.case_id)throw new Error("Source changed; load it again.");
  state.child=result;$("crop-preview").src="data:image/png;base64,"+result.preview_png_b64;
  $("result").hidden=false;$("result-empty").hidden=true;$("result-badge").textContent="RE-EVALUATED";
  $("result-title").textContent=result.trace.decision.action.replaceAll("_"," ");
  $("result-reasons").textContent=result.trace.decision.reasons.join(" · ");$("child-action").textContent=result.trace.decision.action;
  measurements();status(`Crop evaluated: ${result.trace.decision.action}. Original evidence retained; human review is still required.`);
}));
$("export").addEventListener("click",()=>operation(async()=>{
  const blob=await api("/api/export",{case_id:state.source.case_id,receipt_sha256:state.child.receipt.receipt_sha256},true);
  const url=URL.createObjectURL(blob),link=document.createElement("a");link.href=url;link.download="visualledger-crop-evidence.zip";link.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
  status("Evidence ZIP exported after replay: original image, crop, both traces, exact prior context and provenance. Treat the archive as confidential.");
}));
async function start(){try{const response=await fetch("/api/config");if(!response.ok)throw new Error("Local workspace connection failed.");state.config=await response.json();
  $("runtime").textContent=`OpenCV ${state.config.opencv_version} · ${state.config.competition_opencv5_runtime?"5+ RUNTIME":"DEVELOPMENT COMPATIBILITY"}`;
  $("runtime").classList.toggle("dev",!state.config.competition_opencv5_runtime);controls();measurements();
}catch(error){status(error.message,true);}}
controls();start();
