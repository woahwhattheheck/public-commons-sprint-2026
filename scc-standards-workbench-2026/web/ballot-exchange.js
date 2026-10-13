const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const canonical=v=>v===null?"null":Array.isArray(v)?"["+v.map(canonical).join(",")+"]":typeof v==="object"?"{"+Object.keys(v).sort().map(k=>JSON.stringify(k)+":"+canonical(v[k])).join(",")+"}":JSON.stringify(v);
const clone=v=>structuredClone(v),$=s=>document.querySelector(s);
let context=null,session=null,status=null,epoch=0,dbPromise=null,saveQueue=Promise.resolve();
const sessions=new Map(),working=new WeakSet(),loadingUploads=new WeakSet(),uploadGenerations=new WeakMap();
const active=(ctx,s,token)=>context===ctx&&session===s&&epoch===token&&ctx.isCurrent();
function database(){if(!dbPromise)dbPromise=new Promise((resolve,reject)=>{const r=indexedDB.open("standards-member-ballot-operator",1);r.onupgradeneeded=()=>r.result.createObjectStore("projects");r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});return dbPromise;}
async function saved(id){const db=await database();return new Promise((resolve,reject)=>{const tx=db.transaction("projects","readonly"),r=tx.objectStore("projects").get(id);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
function persist(s=session,ctx=context){const id=ctx.project.id,value=clone(s);saveQueue=saveQueue.catch(()=>{}).then(async()=>{const db=await database();await new Promise((resolve,reject)=>{const tx=db.transaction("projects","readwrite");tx.objectStore("projects").put(value,id);tx.oncomplete=resolve;tx.onabort=tx.onerror=()=>reject(tx.error||Error("The original request could not be retained in browser storage."));});});return saveQueue;}
function endpoint(){return "/api/projects/"+encodeURIComponent(context.project.id);}
function currentBallot(){return status?.ballots.find(r=>r.ballot.id===session.ballotId);}
function currentMember(){return currentBallot()?.members.find(r=>r.member.person_id===session.memberId);}
function allReturns(){return currentMember()?.returns||[];}
function selectedReturn(){return allReturns().find(r=>r.id===session.returnId);}
function options(rows,value,label){return'<option value="">Choose a record</option>'+rows.map(r=>'<option value="'+esc(r.id)+'" '+(r.id===value?"selected":"")+'>'+esc(label(r))+"</option>").join("");}
function table(headers,rows){return'<div class="table-wrap"><table><thead><tr>'+headers.map(v=>'<th scope="col">'+esc(v)+"</th>").join("")+"</tr></thead><tbody>"+rows.map(row=>"<tr>"+row.map((v,i)=>'<td data-label="'+esc(headers[i])+'">'+v+"</td>").join("")+"</tr>").join("")+"</tbody></table></div>";}
function pair(name,label,value="",area=false){return'<label>'+esc(label)+(area?'<textarea name="'+name+'">'+esc(value)+"</textarea>":'<input name="'+name+'" value="'+esc(value)+'">')+"</label>";}
function detail(label,data){return"<details><summary>"+esc(label)+'</summary><pre class="ballot-data">'+esc(JSON.stringify(data,null,2))+"</pre></details>";}
function href(audience,field,value){return endpoint()+"/export?audience="+audience+"&"+field+"="+encodeURIComponent(value);}
function notice(message,error=false){const el=$("#ballot-message");if(el){el.textContent=message;el.className=error?"ballot-error":"ballot-message";}else context.notify(message);}
function selectionDefaults(){
 if(!status.ballots.some(r=>r.ballot.id===session.ballotId))session.ballotId=status.ballots[0]?.ballot.id||"";
 const members=currentBallot()?.members||[];
 if(!members.some(r=>r.member.person_id===session.memberId))session.memberId=members[0]?.member.person_id||"";
 const packets=currentMember()?.packets||[];
 if(!packets.some(r=>r.id===session.packetId))session.packetId=packets.at(-1)?.id||"";
 if(!allReturns().some(r=>r.id===session.returnId))session.returnId=allReturns().at(-1)?.id||"";
}
export async function mountBallotExchange(ctx){
 const token=++epoch;context=ctx;
 $("#main").innerHTML='<section class="ballot-exchange"><h1>Member ballot receiving</h1><p role="status">Opening the complete ballot and retained requests…</p></section>';
 try{const [s,data]=await Promise.all([saved(ctx.project.id),ctx.api("/api/projects/"+encodeURIComponent(ctx.project.id)+"/ballot-exchange/status")]);
 if(token!==epoch||!ctx.isCurrent())return;
 session=sessions.get(ctx.project.id)||s||{ballotId:"",memberId:"",packetId:"",returnId:"",packetDraft:{},receiptNote:"",verificationNote:"",upload:null,preview:null,pending:null};
 sessions.set(ctx.project.id,session);status=data;selectionDefaults();render();await persist(session,ctx);
 }catch(e){if(token===epoch&&ctx.isCurrent())$("#main").innerHTML='<section class="ballot-exchange"><h1>Member ballot receiving</h1><p role="alert">'+esc(e.message)+'</p><p>Enable this browser’s local database, then reopen the desk. An operation is sent only after its complete request is retained.</p></section>';}
}
function render(){
 if(!context.isCurrent())return;
 const row=currentBallot(),m=currentMember(),r=selectedReturn(),p=session.pending,closed=!!row?.closed;
 const disabled=working.has(session)||loadingUploads.has(session)||!!p?"disabled":"";
 let html='<section id="ballot-exchange" class="ballot-exchange"><div class="heading"><div><p class="eyebrow">'+esc(context.project.title)+" · Project r"+status.revision+'</p><h1>Member ballot receiving</h1><p>Prepare each member’s bilingual packet, retain original and corrected returns, then explicitly adopt the verified response into the existing vote.</p></div><button type="button" data-ballot="decisions">Ballots & decisions</button></div>';
 if(p)html+='<section class="ballot-pending"><h2>Retained operation</h2><p>'+esc(p.failure?.message||"The complete original request remains available. Recover its result before changing another operation.")+'</p><p>'+esc(p.body.operation)+" · "+esc(p.body.request_id)+'</p><button type="button" id="ballot-retry" data-ballot="retry">Recover original request</button>'+(p.failure?'<button type="button" data-ballot="reconcile">Review current revision after rejected request</button>':"")+detail("Original request",p.body)+"</section>";
 html+='<p id="ballot-message" role="status" aria-live="polite"></p><div class="ballot-selectors"><label>Frozen ballot<select id="ballot-select" '+disabled+">"+options(status.ballots.map(r=>r.ballot),session.ballotId,r=>r.title)+"</select></label><label>Eligible member<select id=\"member-select\" "+disabled+">"+options((row?.members||[]).map(x=>({...x.member,id:x.member.person_id})),session.memberId,r=>r.person_name+" · "+r.organization)+"</select></label></div>";
 if(!row){html+='<section class="ballot-card"><h2>Open an edition-bound ballot</h2><p>First freeze the bilingual edition and select its original procedure and eligible roster in Ballots & decisions.</p><button type="button" data-ballot="new-ballot">Open ballot</button></section></section>';$("#main").innerHTML=html;wire();return;}
 html+='<div class="ballot-summary"><div><strong>'+row.members.length+'</strong><span>Eligible members</span></div><div><strong>'+row.members.filter(x=>x.current_vote).length+'</strong><span>Recorded votes</span></div><div><strong>'+row.members.reduce((n,x)=>n+x.returns.length,0)+'</strong><span>Retained returns</span></div><div><strong>'+(closed?"Closed":"Open")+'</strong><span>'+esc(row.ballot.opens)+" — "+esc(row.ballot.closes)+"</span></div></div>";
 if(m){const d=session.packetDraft||{},ret=allReturns();
 html+='<section class="ballot-card"><h2>1. Member packet</h2><p>'+esc(m.member.person_name)+" · "+esc(m.member.organization)+' · '+esc(m.member.interest)+'</p><form id="ballot-packet-form"><fieldset '+(disabled||closed?"disabled":"")+"><div class=\"ballot-grid\">"+pair("title","Packet title",d.title||row.ballot.title+" — "+m.member.person_name)+pair("reply_route_en","Return route · English",d.reply_route_en||"")+"</div><div class=\"ballot-grid\">"+pair("instructions_en","Instructions · English",d.instructions_en||"",true)+pair("instructions_fr","Instructions · French",d.instructions_fr||"",true)+"</div>"+pair("reply_route_fr","Return route · French",d.reply_route_fr||"")+'<button type="submit" class="primary" id="prepare-member-packet">Freeze member packet</button></fieldset></form><label>Retained packet<select id="packet-select" '+disabled+">"+options(m.packets,session.packetId,x=>x.title+" · "+x.prepared_at)+"</select></label>"+(session.packetId?'<a class="button" id="download-member-packet" href="'+href("ballot_member","packet_id",session.packetId)+'">Download complete member packet ZIP</a>':"<p>No packet has been frozen for this member.</p>")+"</section>";
 html+='<section class="ballot-card"><h2>2. Original or corrected return</h2><p>Select the member’s actual JSON file. Receipt preserves its original bytes and correction chain. It does not change the recorded vote.</p><form id="ballot-intake-form"><fieldset '+disabled+'><label>Returned member JSON<input id="ballot-return-file" type="file" accept=".json,application/json"></label>'+(session.upload?'<p class="ballot-file">'+esc(session.upload.filename)+" · "+session.upload.bytes+" bytes retained in this browser</p>":"")+pair("receipt_note","Intake note",session.receiptNote||"",true)+'<div class="ballot-actions"><button type="button" id="preview-return" data-ballot="preview" '+(!session.packetId||!session.upload?"disabled":"")+'>Inspect original return</button><button type="submit" class="primary" id="retain-return" '+(!session.preview?"disabled":"")+">Retain original file</button></div></fieldset></form>";
 if(session.preview){const v=session.preview;html+=table(["Returned declaration","Current vote"],[['<strong>'+esc(v.response.declared_name)+" · "+esc(v.response.choice)+"</strong><p class=\"ballot-prose\">"+esc(v.response.justification)+"</p><p>"+esc(v.response.cast_at)+" · r"+v.response.response_revision+"</p>",v.current_vote?'<strong>'+esc(v.current_vote.choice)+'</strong><p class="ballot-prose">'+esc(v.current_vote.justification)+"</p><p>"+esc(v.current_vote.id)+" · r"+v.current_vote.revision+"</p>":"No recorded vote"]]);html+="<p>"+esc(v.identity_note)+"</p>"+v.observations.map(x=>"<p>"+esc(x)+"</p>").join("")+detail("Original file and correction binding",{source_sha256:v.source_sha256,response_sha256:v.response_sha256,supersedes_id:v.supersedes_id,duplicate_of:v.duplicate_of,preview_revision:v.revision});}
 html+="</section>";
 html+='<section class="ballot-card"><h2>3. Verify and adopt</h2><label>Retained member return<select id="return-select" '+disabled+">"+options(ret,session.returnId,x=>"Revision "+x.response.response_revision+" · "+x.response.choice+" · "+x.received_at)+"</select></label>";
 if(r){const superseded=ret.some(x=>x.supersedes_id===r.id),adopted=m.adoptions.find(a=>a.return_id===r.id);
 html+=table(["Member declaration","Recorded vote"],[['<strong>'+esc(r.response.choice)+'</strong><p class="ballot-prose">'+esc(r.response.justification)+"</p><p>"+esc(r.response.cast_at)+"</p>",m.current_vote?'<strong>'+esc(m.current_vote.choice)+'</strong><p class="ballot-prose">'+esc(m.current_vote.justification)+"</p><p>"+esc(m.current_vote.id)+" · r"+m.current_vote.revision+"</p>":"No recorded vote"]]);
 html+='<p>Record how the original sender and this correction were verified. Adoption preserves the existing vote ID, retains previous content in history, and clears the previous response’s resolution and notification fields for review.</p>';
 html+='<form id="ballot-adopt-form"><fieldset '+(disabled||closed||superseded||adopted?"disabled":"")+">"+pair("verification_note","Sender and correction verification",session.verificationNote||"",true)+'<button id="ballot-adopt" type="submit" class="primary">Adopt verified member response</button></fieldset></form>';
 if(closed)html+="<p>This ballot is closed. The received file remains evidence; its original vote and authority closure are preserved.</p>";
 if(superseded)html+="<p>A corrected return supersedes this edition. Select the latest retained revision.</p>";
 if(adopted)html+="<p>Adopted as "+esc(adopted.vote_id)+" at "+esc(adopted.recorded_at)+".</p>"+detail("Recorded adoption, including previous vote",adopted);
 html+=detail("Complete retained return",r);}
 else html+="<p>Retain the member’s original return before adopting a vote.</p>";
 html+="</section>";}
 html+='<section class="ballot-card"><h2>4. Decision and publication</h2><p>The original calculation below applies the selected frozen procedure. Record the actual authority decision and independent review in the existing ballot workflow.</p>'+detail("Current original-engine calculation",row.calculation)+'<div class="ballot-actions"><button type="button" data-ballot="close" '+(closed?"disabled":"")+'>Record authority decision</button><button type="button" data-ballot="procedure">Record procedural review</button><button type="button" data-ballot="publication">Publication workspace</button><a class="button" id="download-ballot-decision" href="'+href("ballot_decision","ballot_id",row.ballot.id)+'">Private decision handover ZIP</a><a class="button" id="download-ballot-workspace" href="'+endpoint()+'/export?audience=private_restore">Complete editable workspace ZIP</a></div><p class="muted">The private handover includes member identities and original returned files. Use the publication workspace to select a public bilingual edition.</p></section></section>';
 $("#main").innerHTML=html;wire();
}
function keepForm(form,target){for(const el of form.elements){if(el.name)target[el.name]=el.value;}}
function wire(){
 const owner=context,state=session,token=epoch;
 const renderCurrent=()=>{if(active(owner,state,token))render();};
 const root=$("#ballot-exchange");root.onclick=async e=>{if(!active(owner,state,token))return;if(!active(owner,state,token))return;const b=e.target.closest("[data-ballot]");if(!b)return;e.preventDefault();try{await act(b.dataset.ballot);}catch(error){if(active(owner,state,token))notice(error.message,true);}};
 $("#ballot-select")?.addEventListener("change",async e=>{if(!active(owner,state,token))return;session.ballotId=e.target.value;session.memberId="";session.packetId="";session.returnId="";session.preview=null;session.upload=null;selectionDefaults();await persist(state,owner);renderCurrent();});
 $("#member-select")?.addEventListener("change",async e=>{if(!active(owner,state,token))return;session.memberId=e.target.value;session.packetId="";session.returnId="";session.preview=null;session.upload=null;session.packetDraft={};session.verificationNote="";selectionDefaults();await persist(state,owner);renderCurrent();});
 $("#packet-select")?.addEventListener("change",async e=>{if(!active(owner,state,token))return;session.packetId=e.target.value;session.preview=null;await persist(state,owner);renderCurrent();});
 $("#return-select")?.addEventListener("change",async e=>{if(!active(owner,state,token))return;session.returnId=e.target.value;session.verificationNote="";await persist(state,owner);renderCurrent();});
 $("#ballot-packet-form")?.addEventListener("input",()=>{keepForm($("#ballot-packet-form"),session.packetDraft);persist(state,owner).catch(e=>{if(active(owner,state,token))notice(e.message,true);});});
 $("#ballot-packet-form")?.addEventListener("submit",async e=>{if(!active(owner,state,token))return;e.preventDefault();try{const d={};keepForm(e.target,d);await perform("ballot.packet",{ballot_id:session.ballotId,person_id:session.memberId,...d},status.revision);}catch(error){if(active(owner,state,token))notice(error.message,true);}});
 $("#ballot-return-file")?.addEventListener("change",async e=>{
 if(!active(owner,state,token))return;let generation,errorMessage="";
 try{
 const file=e.target.files[0];if(!file)return;if(!file.size||file.size>2*1024*1024)throw Error("Choose the complete original JSON, up to 2 MiB.");
 const packet=state.packetId,person=state.memberId;generation=(uploadGenerations.get(state)||0)+1;uploadGenerations.set(state,generation);
 state.upload=null;state.preview=null;loadingUploads.add(state);renderCurrent();
 const a=new Uint8Array(await file.arrayBuffer());
 if(!active(owner,state,token)||state.packetId!==packet||state.memberId!==person||uploadGenerations.get(state)!==generation)return;
 let binary="";for(let i=0;i<a.length;i+=32768)binary+=String.fromCharCode(...a.subarray(i,i+32768));
 state.upload={filename:file.name,content_base64:btoa(binary),bytes:file.size};await persist(state,owner);
 }catch(error){errorMessage=error.message||String(error);}
 finally{if(generation===uploadGenerations.get(state)){loadingUploads.delete(state);renderCurrent();}if(errorMessage&&active(owner,state,token))notice(errorMessage,true);}
 });
 $("#ballot-intake-form")?.addEventListener("input",e=>{if(e.target.name==="receipt_note"){session.receiptNote=e.target.value;persist(state,owner).catch(error=>{if(active(owner,state,token))notice(error.message,true);});}});
 $("#ballot-intake-form")?.addEventListener("submit",async e=>{if(!active(owner,state,token))return;e.preventDefault();try{if(!session.preview)throw Error("Inspect this exact original file first.");await perform("ballot.receive",{packet_id:session.packetId,filename:session.upload.filename,content_base64:session.upload.content_base64,receipt_note:session.receiptNote},session.preview.revision);}catch(error){if(active(owner,state,token))notice(error.message,true);}});
 $("#ballot-adopt-form")?.addEventListener("input",e=>{if(e.target.name==="verification_note"){session.verificationNote=e.target.value;persist(state,owner).catch(error=>{if(active(owner,state,token))notice(error.message,true);});}});
 $("#ballot-adopt-form")?.addEventListener("submit",async e=>{if(!active(owner,state,token))return;e.preventDefault();try{if(!session.verificationNote.trim())throw Error("Record the original sender and correction verification.");await perform("ballot.adopt",{return_id:session.returnId,expected_vote_sha256:currentMember().current_vote_sha256,verification_note:session.verificationNote},status.revision);}catch(error){if(active(owner,state,token))notice(error.message,true);}});
}
async function reload(){
 const ctx=context,s=session,token=epoch;
 const data=await ctx.api("/api/projects/"+encodeURIComponent(ctx.project.id)+"/ballot-exchange/status");
 if(!active(ctx,s,token))return;status=data;selectionDefaults();await persist(s,ctx);if(active(ctx,s,token))render();
}
async function perform(operation,payload,revision){
 const ctx=context,s=session,token=epoch;
 if(working.has(s)||loadingUploads.has(s))throw Error("The current original operation or file read is still in progress.");
 if(s.pending)throw Error("Recover the retained original request before starting another operation.");
 const body={operation,payload:clone(payload),expected_revision:revision,request_id:crypto.randomUUID(),actor:"Local ballot operator"};
 s.pending={body,endpoint:"/api/projects/"+encodeURIComponent(ctx.project.id)+"/operations",started_at:new Date().toISOString(),failure:null};
 try{await persist(s,ctx);}catch(error){if(active(ctx,s,token)){render();notice("The complete request has not been sent because browser storage could not retain it.",true);}throw error;}return dispatch(ctx,s,token);
}
async function dispatch(ctx=context,s=session,token=epoch){
 if(working.has(s))return;const pending=clone(s.pending);if(!pending)return;
 working.add(s);if(active(ctx,s,token))render();
 try{
 await persist(s,ctx);
 const result=await ctx.api(pending.endpoint,{method:"POST",body:JSON.stringify(pending.body)});
 if(result.packet_id)s.packetId=result.packet_id;if(result.return_id)s.returnId=result.return_id;
 s.pending=null;s.preview=null;if(pending.body.operation==="ballot.receive")s.upload=null;
 try{await persist(s,ctx);}catch(error){s.pending=pending;throw error;}working.delete(s);
 if(active(ctx,s,token)){await ctx.refresh();if(context.project.id===ctx.project.id&&context.isCurrent())notice(result.replayed?"Recovered the original saved operation.":"Complete operation saved.");}
 return result;
 }catch(error){
 if(s.pending&&canonical(s.pending.body)===canonical(pending.body)&&[400,401,403,404,409,413,422].includes(error.status)){s.pending.failure={status:error.status,message:error.message};await persist(s,ctx);}
 working.delete(s);if(active(ctx,s,token)){render();notice(error.message+" The complete input and original request remain retained.",true);}throw error;
 }finally{working.delete(s);}
}
async function act(action){
 if(action==="decisions")return context.openSection("ballots");
 if(action==="new-ballot")return context.workflow("ballot.open");
 if(action==="publication")return context.openSection("publication");
 if(action==="close")return context.workflow("ballot.close",{ballot_id:session.ballotId});
 if(action==="procedure")return context.workflow("procedure.review",{closure_id:currentBallot()?.closures.at(-1)?.id||""});
 if(action==="retry")return dispatch();
 if(action==="reconcile"){if(!session.pending?.failure)throw Error("Recover the original result first.");session.pending=null;session.preview=null;await persist();await reload();notice("Current revision is displayed. Your fields and complete original file remain available; inspect them before a new operation.");return;}
 if(action==="preview"){
 if(working.has(session)||loadingUploads.has(session)||session.pending)throw Error("Recover the current request or file read first.");if(!session.upload||!session.packetId)throw Error("Select a frozen member packet and its actual returned JSON.");
 const ctx=context,s=session,token=epoch,packet=s.packetId,upload=s.upload;
 working.add(s);render();try{
 const response=await ctx.api("/api/projects/"+encodeURIComponent(ctx.project.id)+"/ballot-exchange/preview",{method:"POST",body:JSON.stringify({packet_id:packet,filename:upload.filename,content_base64:upload.content_base64})});
 if(!active(ctx,s,token)||s.packetId!==packet||s.upload!==upload)return;
 s.preview=response;await persist(s,ctx);if(active(ctx,s,token))notice("Complete original inspected at project r"+response.revision+".");
 }finally{working.delete(s);if(active(ctx,s,token))render();}
 }
}
