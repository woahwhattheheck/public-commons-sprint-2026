import {csv,input,escape as E,returnedDfids,assess} from "./core.mjs";
import {mountSourceReader} from "./source-reader.mjs";
let sourceReader=null;
const $=s=>document.querySelector(s);const noteDrafts=new Map();let config=null,current=null,source=null,mapping=[],tab="overview",sourceRead=0,caseRead=0,catalogRead=0,busy=false;
const status=message=>{$("#status").textContent=message;};
async function api(path,body){const r=await fetch(path,{method:body===undefined?"GET":"POST",headers:body===undefined?{}:{"Content-Type":"application/json","X-Desk-Token":config.token},body:body===undefined?undefined:JSON.stringify(body)});const j=await r.json();if(!r.ok)throw new Error(j.error||"Desk request failed");return j;}
function json(x){return "<pre>"+E(JSON.stringify(x,null,2))+"</pre>";}
function download(name,text,type="application/json"){const u=URL.createObjectURL(new Blob([text],{type})),a=document.createElement("a");a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);}
function mappingState(){return [...document.querySelectorAll("[data-map]")].map(row=>({source:row.dataset.map,target:row.querySelector("input").value,type:row.querySelector("select").value}));}
function prepare(){if(!source)return;try{if(source.format==="csv")mapping=mappingState();const p=input(source,mapping);$("#source-state").textContent=p.items.length+" original rows ready. Review the selected field names and conversions before saving.";$("#create").disabled=false;}catch(e){$("#source-state").textContent=e.message;$("#create").disabled=true;}}
$("#source").onchange=async e=>{
 const file=e.target.files[0],ticket=++sourceRead;source=null;mapping=[];$("#mapping").innerHTML="";$("#create").disabled=true;
 if(!file){$("#source-state").textContent="Choose the original file.";return;}
 $("#source-state").textContent="Reading "+file.name+"…";
 try{
  if(file.size>16*1024*1024)throw new Error("Original file exceeds the 16 MiB desk input limit");
  const data=await file.arrayBuffer();if(ticket!==sourceRead||$("#source").files[0]!==file)return;
  const text=new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(data),format=file.name.toLowerCase().endsWith(".csv")?"csv":"json";
  source={name:file.name,text,format};
  if(!$("#title").value)$("#title").value=file.name;
  if(format==="csv"){
   const parsed=csv(text);mapping=parsed.headers.map(h=>({source:h,target:h,type:"string"}));
   $("#mapping").innerHTML='<p class="muted">Blank target omits a field from the submitted item while the original source remains retained.</p><div class="scroll" tabindex="0" aria-label="CSV field mapping"><table><thead><tr><th>Source</th><th>Gateway field</th><th>Conversion</th></tr></thead><tbody>'+mapping.map(m=>'<tr data-map="'+E(m.source)+'"><td>'+E(m.source)+'</td><td><input aria-label="Target for '+E(m.source)+'" value="'+E(m.target)+'"></td><td><select aria-label="Conversion for '+E(m.source)+'">'+["string","number","boolean","json","null-empty"].map(t=>'<option>'+t+'</option>').join("")+'</select></td></tr>').join("")+'</tbody></table></div>';
  }
  prepare();
 }catch(error){if(ticket===sourceRead){$("#source-state").textContent=error.message;source=null;}}
};
$("#mapping").oninput=prepare;$("#mapping").onchange=prepare;
$("#create").onclick=async()=>{
 if(busy||!source)return;prepare();if($("#create").disabled)return;
 const ticket=++caseRead,fileIntent=sourceRead;const selected={source:{...source},mapping:structuredClone(mapping),title:$("#title").value};busy=true;$("#create").disabled=true;status("Saving exact source and selected item bytes…");
 try{const c=await api("/api/cases",selected);if(ticket===caseRead&&fileIntent===sourceRead){current=c;tab="overview";render();status("Source batch saved. Inspect the selected items, then preview with the configured partner key.");}await catalogue();}
 catch(e){status(e.message);}finally{busy=false;prepare();}
};
async function catalogue(){const ticket=++catalogRead;const list=await api("/api/cases");if(ticket!==catalogRead)return;$("#cases").innerHTML=list.map(c=>'<button data-case="'+c.id+'" aria-current="'+(current?.id===c.id)+'"><strong>'+E(c.title)+'</strong><br>'+E(c.state)+' · '+c.rows+' rows<br><span class="muted">'+E(c.source)+'</span></button>').join("")||'<p class="muted">No saved batches.</p>';}
$("#refresh").onclick=async()=>{try{await catalogue();if(current)await openCase(current.id);}catch(e){status(e.message);}};
$("#cases").onclick=e=>{const b=e.target.closest("[data-case]");if(b)openCase(b.dataset.case);};
async function openCase(id){const ticket=++caseRead;status("Reading saved source and receiving history…");try{const c=await api("/api/cases/"+id);if(ticket!==caseRead)return;current=c;tab="overview";render();await catalogue();status("");}catch(e){if(ticket===caseRead)status(e.message);}}
$("#receive").onchange=async e=>{
 const file=e.target.files[0];if(!file)return;const ticket=++caseRead;status("Reading complete case package…");
 try{
  if(file.size>80*1024*1024)throw new Error("Package exceeds the 80 MiB receiving limit");
  const text=await file.text();if(ticket!==caseRead||$("#receive").files[0]!==file)return;
  const c=await api("/api/import",JSON.parse(text));if(ticket!==caseRead)return;current=c;tab="overview";render();await catalogue();status("Complete case received with its original history.");
 }catch(e){if(ticket===caseRead)status(e.message);}finally{if(ticket===caseRead)$("#receive").value="";}
};
function summary(c){const last=[...c.events].reverse().find(e=>e.assessment);return last?.assessment;}
function render(){
 sourceReader?.destroy();sourceReader=null;
 if(!current)return;const c=current,draft=noteDrafts.get(c.id)||{note:"",recovered:"",recoveryNote:""},s=summary(c),last=c.events.at(-1),committed=c.events.some(e=>["commit","reconcile"].includes(e.kind));
 $("#detail").innerHTML='<h1>'+E(c.title)+'</h1><p><span class="badge">'+E(c.state)+'</span> Original source '+E(c.source.name)+'</p><div class="metrics"><div><strong>'+c.items.length+'</strong>Source items</div><div><strong>'+returnedDfids(c).length+'</strong>Returned DFIDs</div><div><strong>'+c.events.length+'</strong>Retained operations</div><div><strong>'+c.verifications.length+'</strong>Public report reads</div></div><div class="identity">Source SHA256 '+c.source.sha256+'<br>Selected payload SHA256 '+c.payload.sha256+'<br>Case '+c.id+'</div><div class="actions"><button data-action="preview" '+(busy||committed||!config.key_configured?"disabled":"")+'>Preview exact batch</button><button class="primary" data-action="commit" '+(busy||c.state!=="preview-ready"||!config.key_configured?"disabled":"")+'>Commit reviewed batch</button><button data-action="verify" '+(busy||!returnedDfids(c).length?"disabled":"")+'>Read returned DFIDs</button><button data-action="export">Download complete case</button><button data-action="offline">Download offline recipient</button><button data-action="report">Open report</button><button data-action="rows">Download source row table</button><button data-action="source">Download original file</button><button data-action="payload">Download selected request</button></div><p class="muted">Gateway '+E(c.identity.gateway)+' · SDK '+E(c.identity.sdk.name+"@"+c.identity.sdk.version)+'. The API key selects its partner circuit. The network label does not change the gateway or select its anchoring network.</p><div class="tabs" role="tablist">'+[["overview","Gateway review"],["source","Source & selected items"],["history","Request history"],["verification","Public verification"],["notes","Notes & recovery"]].map(([id,label])=>'<button role="tab" aria-selected="'+(id===tab)+'" data-tab="'+id+'">'+label+'</button>').join("")+'</div><div id="panel"></div>';
 const panel=$("#panel");
 if(tab==="overview"){
  panel.innerHTML='<h2>Review this exact source edition</h2><p>'+E(s?.review||"Run the gateway preview to read its original row validation and routing.")+'</p>'+(s?.summary?json(s.summary):"")+(s?.errors?.length?'<h3>Gateway errors and unresolved rows</h3>'+json(s.errors):"")+(last?.wire?'<details><summary>Complete latest gateway response</summary><pre>'+E(last.wire.text)+'</pre></details>':"")+'<p class="notice">An ingestion response can create, enrich, or leave rows unresolved. The complete returned body is retained. Returned DFIDs are listed independently; row associations come only from the original gateway response.</p>';
 }else if(tab==="source"){
  panel.innerHTML='<h2>Original source and exact selected items</h2><p>'+c.source.bytes+' original UTF-8 bytes. Search and page through every retained row, with original row numbers and selected types.</p><div id="source-reader"></div>';
  sourceReader=mountSourceReader($("#source-reader"),c,{key:c.id,download});
 }else if(tab==="history"){
  panel.innerHTML='<h2>Original operation history</h2>'+c.events.map(e=>'<details open><summary>'+E(e.kind)+" · "+E(e.status)+" · "+E(e.started_at)+'</summary><p>'+E(e.provenance||"Original SDK request")+ (e.recovered_from_retained_wire?" · continued from the original returned wire body":"")+'</p>'+ (e.error?json(e.error):"")+(e.wire?'<p>HTTP '+e.wire.status+' · '+e.wire.bytes+' bytes · <span class="identity">'+e.wire.sha256+'</span></p><pre>'+E(e.wire.text)+'</pre>':"")+'</details>').join("");
 }else if(tab==="verification"){
  panel.innerHTML='<h2>Returned DFIDs</h2><p>Each read uses the original SDK public gateway aggregator. It retains the raw report. The SDK timestamp and commitment fields are best-effort extraction, separate from independent Stellar/IPFS verification.</p>'+json(returnedDfids(c))+c.verifications.map(v=>'<details><summary>'+E(v.dfid)+' · '+E(v.read_at)+'</summary>'+(v.error?json(v.error):"")+(v.wire?'<pre>'+E(v.wire.text)+'</pre>':json(v.result))+'</details>').join("");
 }else{
  panel.innerHTML='<h2>Operating notes</h2>'+json(c.notes)+'<label>New note<textarea id="note">'+E(draft.note)+'</textarea></label><button data-action="note">Save note</button>';
  if(c.state==="commit-unknown")panel.innerHTML+='<h2>Continue an interrupted ingestion</h2><p>The original request may have reached the gateway. Retain that operation and recover its original response from the partner workspace or receiving log. This action records that returned body and its provenance; it sends no new ingestion request.</p><label>Recovered original gateway response JSON<textarea id="recovered">'+E(draft.recovered)+'</textarea></label><label>Where the response was recovered<textarea id="recovery-note">'+E(draft.recoveryNote)+'</textarea></label><button data-action="reconcile">Receive recovered response</button>';
 }
}
$("#detail").oninput=e=>{if(!current)return;const key=({note:"note",recovered:"recovered","recovery-note":"recoveryNote"})[e.target.id];if(key){const d=noteDrafts.get(current.id)||{note:"",recovered:"",recoveryNote:""};d[key]=e.target.value;noteDrafts.set(current.id,d);}};
$("#detail").onclick=async e=>{
 const b=e.target.closest("button");if(!b||!current)return;
 if(b.dataset.tab){tab=b.dataset.tab;render();return;}
 const action=b.dataset.action,c=current;if(!action)return;let acquired=false;
 try{
  if(action==="export"){const pkg=await api("/api/cases/"+c.id+"/export");download(c.id+"-complete-case.json",JSON.stringify(pkg,null,2)+"\n");return;}
  if(action==="offline"){const r=await fetch("/api/cases/"+c.id+"/offline");if(!r.ok)throw new Error("Could not build the complete offline recipient");download(c.id+"-recipient.html",await r.text(),"text/html");return;}
  if(action==="report"){window.open("/api/cases/"+c.id+"/report","_blank","noopener");return;}
  if(action==="rows"){const r=await fetch("/api/cases/"+c.id+"/rows");if(!r.ok)throw new Error("Could not read the original row table");download(c.id+"-rows.csv",await r.text(),"text/csv");return;}
  if(action==="source"){download(c.source.name,c.source.text,c.source.format==="csv"?"text/csv":"application/json");return;}
  if(action==="payload"){download(c.id+"-request.json",c.payload.text);return;}
  if(busy)return;
  if(action==="commit"&&!confirm("Commit "+c.items.length+" selected items to "+c.identity.gateway+" using the currently configured partner key?\n\nOriginal: "+c.source.name+"\nPayload SHA256: "+c.payload.sha256+"\n\nThe gateway can create or enrich real items. The exact response will be retained."))return;
  const data={revision:c.revision};
  if(action==="note")data.note=$("#note").value;
  if(action==="reconcile"){data.text=$("#recovered").value;data.note=$("#recovery-note").value;}
  busy=true;acquired=true;render();status("Running "+action+" for "+c.title+"…");
  const updated=await api("/api/cases/"+c.id+"/"+action,data);
  const draft=noteDrafts.get(c.id);if(action==="note"&&draft?.note===data.note)draft.note="";if(action==="reconcile"&&draft?.recovered===data.text&&draft?.recoveryNote===data.note){draft.recovered="";draft.recoveryNote="";}
  if(current?.id===c.id){current=updated;render();status(action+" completed. Original response and source history are retained.");}
  await catalogue();
 }catch(error){status(error.message);}finally{if(acquired){busy=false;if(current)render();}}
};
try{config=await api("/api/config");$("#connection").textContent=config.gateway+" · "+(config.key_configured?"Partner key configured in this process":"Local preparation and receiving available; configure a partner key for preview/ingestion");await catalogue();}catch(error){status(error.message);}
