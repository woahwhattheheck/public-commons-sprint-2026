const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const clone=v=>structuredClone(v),label=s=>String(s??"").replaceAll("_"," "),uid=()=>crypto.randomUUID();
const all=(root,s)=>[...root.querySelectorAll(s)],one=(root,s)=>root.querySelector(s);
const sessions=new Map();
let context=null,viewState=null,epoch=0,dialogState=null;
function table(head,rows){return'<div class="table-wrap"><table><thead><tr>'+head.map(v=>"<th>"+esc(v)+"</th>").join("")+"</tr></thead><tbody>"+rows.map(row=>"<tr>"+row.map(v=>"<td>"+v+"</td>").join("")+"</tr>").join("")+"</tbody></table></div>";}
function button(action,title,attrs="",primary=false){return'<button data-review="'+action+'" '+attrs+' class="'+(primary?"primary":"")+'">'+esc(title)+"</button>";}
function options(rows,value,title=r=>r.title||r.label||r.id,empty="Select a record"){return'<option value="">'+esc(empty)+"</option>"+rows.map(r=>'<option value="'+esc(r.id)+'" '+(r.id===value?"selected":"")+">"+esc(title(r))+"</option>").join("");}
function endpoint(){return"/api/projects/"+encodeURIComponent(context.project.id);}
function state(){return viewState;}
function explain(error){return error.message||String(error);}
function selection(collection,id){return context.project[collection]?.find(r=>r.id===id);}
function historyName(id,collection){const r=selection(collection,id);return r?.title||r?.label||id||"—";}
function downloadLink(audience,id){
 const key=audience==="consultation"?"packet_id":"response_id";
 return endpoint()+"/export?audience="+audience+"&"+key+"="+encodeURIComponent(id);
}
export async function mountConsultation(ctx){
 context=ctx;
 if(!sessions.has(ctx.project.id))sessions.set(ctx.project.id,{tab:"packets",responseId:null,commentId:null,page:0,detail:null,detailRevision:null,preview:null});
 viewState=sessions.get(ctx.project.id);
 const e=++epoch;
 const data=ctx.project.review||await ctx.api(endpoint()+"/review/status");
 if(e!==epoch||!ctx.isCurrent())return;
 viewState.status=data;
 render();
 if(viewState.tab==="responses"&&viewState.responseId)await showResponse(viewState.responseId);
}
function root(){return document.querySelector("#main");}
function render(){
 const p=context.project,s=viewState.status;
 let content='<section class="review-receiving"><div class="heading"><div><p class="eyebrow">'+esc(p.title)+" · r"+p.revision+'</p><h1>Consultation receiving</h1><p>Freeze the bilingual material, receive original reviewer files, apply explicit amendments and return edition-bound dispositions.</p></div><div class="review-toolbar">'+button("new-consultation","Set up consultation")+button("packet","Prepare reviewer packet","",true)+"</div></div>";
 content+='<div class="review-summary"><div><strong>'+s.packets.length+'</strong><small>Frozen reviewer packets</small></div><div><strong>'+s.responses.length+'</strong><small>Distinct returned responses</small></div><div><strong>'+s.responses.reduce((n,r)=>n+r.comment_count,0)+'</strong><small>Retained comments</small></div><div><strong>'+s.responses.reduce((n,r)=>n+r.dispositions.open+r.dispositions.deferred,0)+'</strong><small>Open or deferred</small></div></div>';
 content+='<div class="review-switch" role="tablist"><button data-review="tab" data-tab="packets" aria-selected="'+(state().tab==="packets")+'">Reviewer packets</button><button data-review="tab" data-tab="responses" aria-selected="'+(state().tab==="responses")+'">Returned comments</button><button data-review="tab" data-tab="revisions" aria-selected="'+(state().tab==="revisions")+'">Amendments & dispositions</button></div>';
 if(state().tab==="packets")content+=packetsView();
 else if(state().tab==="responses")content+=responsesView();
 else content+=revisionsView();
 content+="</section>";root().innerHTML=content;
 root().onclick=event=>{const el=event.target.closest("[data-review]");if(el){event.preventDefault();event.stopPropagation();dispatch(el).catch(e=>context.notify(explain(e)));}};
}
function packetsView(){
 const rows=state().status.packets;
 let content='<div class="review-note">Preparing a packet records the selected content and return instructions. The existing communications register records any actual invitation or SCC link dispatch separately.</div>';
 content+=rows.length?table(["Packet / consultation","Frozen edition","Receiving","Actions"],rows.map(r=>[
 '<strong>'+esc(r.title)+'</strong><br><small>'+esc(historyName(r.consultation_id,"consultations"))+"</small>",
 esc(historyName(r.edition_id,"editions"))+"<br><code>"+esc(r.packet_sha256)+"</code>"+(r.consultation_changed_since_packet?"<p>The current consultation differs from this retained packet.</p>":""),
 r.response_count+" returns · "+r.comment_count+" comments<br>"+r.unresolved_count+" open / deferred"+(r.actual_closed?"<br>Consultation recorded closed":""),
 '<div class="review-row-actions"><a class="button" href="'+downloadLink("consultation",r.id)+'">Download reviewer ZIP</a>'+button("receive","Receive response",'data-id="'+esc(r.id)+'"')+button("record","Inspect packet",'data-collection="review_packets" data-id="'+esc(r.id)+'"')+"</div>"
 ])):'<div class="empty"><p>Select a frozen edition and a consultation before preparing the first bilingual reviewer packet.</p>'+button("freeze-edition","Freeze current edition")+button("new-consultation","Create consultation")+"</div>";
 return content;
}
function responsesView(){
 const list=state().status.responses;
 let content='<div class="review-toolbar">'+button("receive","Receive original response","",true)+button("refresh","Refresh saved state")+"</div>";
 if(!list.length)return content+'<div class="empty"><p>Open a reviewer ZIP, write comments in its offline page, and return the exported JSON through the packet’s stated route. Receive that original file here.</p></div>';
 content+=table(["Declared reviewer","Received / source","Comments","Actions"],list.slice(state().page*25,state().page*25+25).map(r=>[
 '<strong>'+esc(r.reviewer.name||"Unattributed")+'</strong><br>'+esc(r.reviewer.organization)+'<br><small>Reviewer-declared identity'+(r.authored_example?" · authored exercise":"")+"</small>",
 esc(r.received_at)+'<br><code>'+esc(r.source_sha256)+"</code>"+(r.supersedes_id?"<br>Corrects "+esc(r.supersedes_id):""),
 r.comment_count+" total<br>"+r.dispositions.open+" open · "+r.dispositions.accepted+" accepted · "+r.dispositions.rejected+" rejected · "+r.dispositions.deferred+" deferred"+(r.earlier_open_comments.length?"<p>"+r.earlier_open_comments.length+" earlier comments still need disposition.</p>":""),
 '<div class="review-row-actions">'+button("response","Review comments",'data-id="'+esc(r.id)+'"',true)+(r.unchanged_decisions_available?button("carry","Adopt "+r.unchanged_decisions_available+" unchanged decisions",'data-id="'+esc(r.id)+'"'):"")+'<a class="button" href="'+downloadLink("review_response",r.id)+'">Export reply package</a>'+button("source","Original returned file",'data-id="'+esc(r.source_id)+'"')+"</div>"
 ]));
 if(list.length>25)content+='<div class="review-toolbar">'+button("page","Previous",'data-delta="-1" '+(state().page?"":"disabled"))+'<span>Page '+(state().page+1)+" / "+Math.ceil(list.length/25)+"</span>"+button("page","Next",'data-delta="1" '+((state().page+1)*25>=list.length?"disabled":""))+"</div>";
 content+='<div id="review-response-detail"></div>';
 return content;
}
function revisionsView(){
 const resolutions=state().status.resolutions;
 let content='<div class="review-toolbar">'+button("freeze-edition","Freeze successor edition")+button("publication","Open publication workflow")+"</div><p>Applying wording changes the working clause and retains its before/after snapshot. Freeze that resulting draft, then link the comment disposition to the exact successor clause.</p>";
 content+=resolutions.length?table(["Comment / decision","Resolution edition","Selected reply audience","Snapshot"],resolutions.map(r=>[
 esc(r.comment_id)+"<br>"+esc(label(r.disposition)),esc(historyName(r.resolution_edition_id,"editions")),
 esc(label(r.response_visibility))+(r.current?"":"<p>Current comment differs from this retained decision.</p>"),
 button("record","Inspect disposition",'data-collection="review_resolutions" data-id="'+esc(r.id)+'"')
 ])):'<div class="empty">No dedicated disposition snapshots have been recorded. Existing comment records remain in Review comments.</div>';
 return content;
}
async function showResponse(id){
 const e=++epoch;state().responseId=id;
 let detail=state().detail;
 if(!detail||detail.id!==id||state().detailRevision!==context.project.revision)detail=await context.api(endpoint()+"/review/responses/"+encodeURIComponent(id));
 if(e!==epoch||!context.isCurrent()||state().tab!=="responses")return;
 state().detail=detail;state().detailRevision=context.project.revision;
 if(!detail.comments.some(r=>r.comment.id===state().commentId))state().commentId=detail.comments[0]?.comment.id;
 renderDetail();
}
function renderDetail(){
 const holder=document.querySelector("#review-response-detail");if(!holder||!state().detail)return;
 const d=state().detail,row=d.comments.find(r=>r.comment.id===state().commentId);
 let content='<h2>Original returned response</h2><p class="review-identity">'+esc(d.response.response.reviewer.name||"Unattributed")+" · "+esc(d.response.response.reviewer.organization)+"<br>"+esc(d.response.response.reviewer.email)+"</p>";
 if(d.response.receipt_note)content+='<p class="review-note">'+esc(d.response.receipt_note)+"</p>";
 content+='<div class="review-comment-layout"><aside class="review-comment-list">'+d.comments.map(r=>'<button data-review="comment" data-id="'+esc(r.comment.id)+'" class="'+(r.comment.id===state().commentId?"selected":"")+'">'+esc(r.reviewed_clause?.number||"General")+" · "+esc(r.entry.body.slice(0,95))+'<small>'+esc(r.comment.disposition)+" · "+esc(r.entry.language)+"</small></button>").join("")+'</aside><article>';
 if(row){
 const c=row.comment,old=row.reviewed_clause,now=row.current_clause;
 content+='<section class="review-pane"><div class="review-toolbar"><h3>'+esc(old?old.number+" · "+old.title_en:"Whole-document comment")+'</h3>'+button("amend","Apply / adapt proposed wording",'data-id="'+esc(c.id)+'"')+button("resolve","Record disposition",'data-id="'+esc(c.id)+'"',true)+'</div><div class="review-clause">'+esc(row.entry.body)+'</div><p class="review-identity">Original entry '+esc(row.entry.id)+" · "+esc(c.source_locator)+'</p><div class="review-pair"><div><h4>Proposed English wording</h4><div class="review-clause">'+esc(row.entry.proposed_text_en||"No replacement text supplied.")+'</div></div><div lang="fr"><h4>Texte français proposé</h4><div class="review-clause">'+esc(row.entry.proposed_text_fr||"Aucun texte de remplacement fourni.")+"</div></div></div></section>";
 content+='<section class="review-pane"><h3>Recorded disposition</h3><p><strong>'+esc(label(c.disposition))+'</strong></p><p class="review-clause">'+esc(c.rationale||"No rationale recorded.")+"</p>"+(c.resolution_edition_id?"<p>Resolution: "+esc(historyName(c.resolution_edition_id,"editions"))+" · "+esc(c.resolution_clause_id)+"</p>":"")+"</section>";
 content+='<details class="review-pane"><summary>Reviewed edition and current working clause</summary><div class="review-pair"><div><h4>Reviewed English</h4><div class="review-clause">'+esc(old?.body_en||"General comment")+'</div></div><div><h4>Current English</h4><div class="review-clause">'+esc(now?.body_en||"No current clause selected")+'</div></div><div lang="fr"><h4>Français examiné</h4><div class="review-clause">'+esc(old?.body_fr||"")+'</div></div><div lang="fr"><h4>Français actuel</h4><div class="review-clause">'+esc(now?.body_fr||"")+"</div></div></div></details>";
 if(row.amendments.length)content+=table(["Applied amendment","Rationale","Exact resulting clause"],row.amendments.map(a=>[button("record",a.id,'data-collection="review_amendments" data-id="'+esc(a.id)+'"'),esc(a.rationale),'<code>'+esc(a.after_sha256)+"</code>"]));
 }
 holder.innerHTML=content+"</article></div>";
}
async function dispatch(el){
 const action=el.dataset.review;
 if(action==="tab"){state().tab=el.dataset.tab;render();if(state().tab==="responses"&&state().responseId)await showResponse(state().responseId);}
 else if(action==="packet")await packetDialog();
 else if(action==="receive")await receiveDialog(el.dataset.id);
 else if(action==="new-consultation")context.newRecord("consultations");
 else if(action==="freeze-edition")context.workflow("edition.freeze");
 else if(action==="publication")context.openSection("publication");
 else if(action==="refresh")await context.refresh();
 else if(action==="record")await context.openRecord(el.dataset.collection,el.dataset.id);
 else if(action==="source")await context.openSource(el.dataset.id);
 else if(action==="response"){state().responseId=el.dataset.id;await showResponse(el.dataset.id);}
 else if(action==="comment"){state().commentId=el.dataset.id;renderDetail();}
 else if(action==="amend")await amendmentDialog(el.dataset.id);
 else if(action==="resolve")await resolutionDialog(el.dataset.id);
 else if(action==="carry")await carryDialog(el.dataset.id);
 else if(action==="page"){state().page+=Number(el.dataset.delta);render();if(state().responseId)await showResponse(state().responseId);}
}
function makeDialog(title,body,submitLabel="Save"){
 let d=document.querySelector("#consultation-dialog");
 if(!d){d=document.createElement("dialog");d.id="consultation-dialog";d.className="review-dialog";document.body.append(d);}
 d.innerHTML='<form><header><h2>'+esc(title)+'</h2><button type="button" data-close aria-label="Close">×</button></header><div id="review-form-body">'+body+'</div><p id="review-error" role="alert"></p><div class="review-rebase" hidden><p>Saved project changes are available. Your form input remains here.</p><button type="button" data-rebase>Review current saved context</button><div data-rebase-detail></div></div><footer><small id="review-form-revision">Project r'+context.project.revision+'</small><div><button type="button" data-close>Cancel</button><button type="button" id="review-retry" hidden>Retry original pending save</button><button type="submit" class="primary" id="review-submit">'+esc(submitLabel)+'</button></div></footer></form>';
 dialogState={projectId:context.project.id,endpoint:endpoint(),revision:context.project.revision,pending:null,dialog:d,rebase:null,submit:null,receivedPreview:null};
 all(d,"[data-close]").forEach(b=>b.onclick=()=>{if(!dialogState?.pending)d.close();else one(d,"#review-error").textContent="A save has an uncertain response. Retry the same pending request before closing this editor.";});
 one(d,"[data-rebase]").onclick=async()=>{try{await dialogState.rebase?.();}catch(e){one(d,"#review-error").textContent=explain(e);}};
 one(d,"form").onsubmit=async e=>{e.preventDefault();try{await dialogState.submit?.();}catch(x){one(d,"#review-error").textContent=explain(x);}};
 d.oncancel=e=>{if(dialogState?.pending){e.preventDefault();one(d,"#review-error").textContent="The original save has an uncertain response. Use Retry original pending save to recover its result.";}};
 one(d,"#review-retry").onclick=async()=>{const pending=dialogState?.pending;if(!pending)return;try{await perform(pending.operation,pending.payload);}catch(e){one(d,"#review-error").textContent=explain(e);}};
 d.showModal();return d;
}
function setField(d,name,value){const el=one(d,'[name="'+name+'"]');if(el)el.value=value??"";}
function val(d,name){return one(d,'[name="'+name+'"]')?.value??"";}
function formLabel(text,input){return"<label>"+esc(text)+input+"</label>";}
function input(name,value="",attrs=""){return'<input name="'+name+'" value="'+esc(value)+'" '+attrs+">";}
function area(name,value="",attrs=""){return'<textarea name="'+name+'" '+attrs+">"+esc(value)+"</textarea>";}
function select(name,rows,value="",caption="Select",title){return'<select name="'+name+'">'+options(rows,value,title,caption)+"</select>";}
function waiting(d,on){one(d,"#review-submit").disabled=on;one(d,"#review-retry").disabled=on;all(d,"[data-close]").forEach(b=>b.disabled=on);}
async function perform(operation,payload){
 const ds=dialogState,d=ds.dialog;
 const candidate={operation,payload,expected_revision:ds.revision,request_id:uid(),actor:"Local operator"};
 if(ds.pending&&JSON.stringify({operation,payload})!==JSON.stringify({operation:ds.pending.operation,payload:ds.pending.payload}))throw Error("The previous save has an uncertain response. Retry its exact input before editing another command.");
 const attempt=ds.pending||candidate;ds.pending=attempt;waiting(d,true);one(d,"#review-error").textContent="";
 try{
  const result=await context.api(ds.endpoint+"/operations",{method:"POST",body:JSON.stringify(attempt)});
  ds.pending=null;
  if(result.response_id){state().responseId=result.response_id;state().tab="responses";}
  state().detail=null;state().detailRevision=null;
  try{await context.refresh();}catch(refreshError){context.notify("Saved at project r"+result.revision+". Refresh the view to load its current state: "+explain(refreshError));}
  d.close();context.notify(result.duplicate_of?"Original duplicate retained; existing comments preserved.":"Saved in the original project history.");
  return result;
 }catch(e){
  if([400,401,403,404,409,413,422].includes(e.status)){ds.pending=null;}
  one(d,"#review-retry").hidden=!ds.pending;
  if(e.status===409){one(d,".review-rebase").hidden=false;one(d,"#review-error").textContent=explain(e)+" Your fields have been preserved.";}
  else one(d,"#review-error").textContent=explain(e)+(ds.pending?" Retry original pending save to recover the same request identity.":"");
  throw e;
 }finally{waiting(d,false);}
}
async function refreshedContext(){
 const ds=dialogState;if(ds.pending)throw Error("Recover the original pending save before rebasing another action.");
 const p=await context.api(ds.endpoint);
 ds.revision=p.revision;ds.pending=null;one(ds.dialog,"#review-form-revision").textContent="Project r"+p.revision+" · current saved context reviewed";
 one(ds.dialog,".review-rebase").hidden=true;
 return p;
}
async function packetDialog(){
 const consultations=context.project.consultations||[];
 if(!consultations.length){context.newRecord("consultations");return;}
 const d=makeDialog("Prepare a bilingual reviewer packet",
 formLabel("Consultation",select("consultation_id",consultations,"","Select the exact consultation"))+
 '<div id="review-packet-context" class="review-readonly"></div>'+
 formLabel("Packet title",input("title","","maxlength=500"))+
 '<div class="review-form-grid">'+formLabel("English review instructions",area("instructions_en","","maxlength=16000"))+formLabel("Instructions de consultation en français",area("instructions_fr","","maxlength=16000"))+
 formLabel("English return route",area("reply_route_en","","maxlength=2000"))+formLabel("Mode de retour en français",area("reply_route_fr","","maxlength=2000"))+'</div><p><small>The packet contains only the frozen public edition and the explicit instructions above. It is prepared locally; dispatch is recorded separately.</small></p>',
 "Freeze reviewer packet");
 let currentRows=consultations;
 const display=()=>{const c=currentRows.find(r=>r.id===val(d,"consultation_id"));one(d,"#review-packet-context").textContent=c?JSON.stringify({title:c.title,edition:historyName(c.edition_id,"editions"),kind:c.kind,opens:c.opens,closes:c.closes,actual_closed:c.actual_closed},null,2):"Select a consultation.";if(c&&!val(d,"title"))setField(d,"title",c.title);};
 one(d,"[name=consultation_id]").onchange=display;display();
 dialogState.rebase=async()=>{const p=await refreshedContext();currentRows=p.consultations;display();one(d,"#review-error").textContent="Current consultation shown above. Your instructions are retained; review them before saving.";};
 dialogState.submit=()=>perform("review.packet",Object.fromEntries(["consultation_id","title","instructions_en","instructions_fr","reply_route_en","reply_route_fr"].map(k=>[k,val(d,k)])));
}
function bytesBase64(buffer){let text="";const bytes=new Uint8Array(buffer);for(let i=0;i<bytes.length;i+=32768)text+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(text);}
async function receiveDialog(packetId){
 const packets=state().status.packets;
 if(!packets.length){await packetDialog();return;}
 const d=makeDialog("Receive an original reviewer response",
 formLabel("Frozen reviewer packet",select("packet_id",packets,packetId||"","Select the original packet"))+
 formLabel("Returned JSON file",'<input name="return_file" type="file" accept=".json,application/json" required>')+
 '<button type="button" id="review-preview">Inspect original return</button><section id="review-preview-result"></section>'+
 '<div id="review-predecessor" hidden></div>'+formLabel("Receipt / correction note",area("receipt_note","","maxlength=8000")),
 "Retain original and import comments");
 const ds=dialogState;let original=null;
 one(d,"[name=return_file]").onchange=async e=>{const file=e.target.files[0];original=null;ds.receivedPreview=null;one(d,"#review-preview-result").innerHTML="";if(!file)return;
  if(file.size>8*1024*1024){one(d,"#review-error").textContent="The returned review exceeds 8 MiB.";return;}
  original={filename:file.name,content_base64:bytesBase64(await file.arrayBuffer())};};
 one(d,"[name=packet_id]").onchange=()=>{ds.receivedPreview=null;one(d,"#review-preview-result").innerHTML="";};
 async function preview(){
  if(ds.pending)throw Error("Recover the original pending save before inspecting a new return.");
  if(!original)throw Error("Choose the actual returned JSON file.");
  const data=await context.api(ds.endpoint+"/review/preview",{method:"POST",body:JSON.stringify({packet_id:val(d,"packet_id"),...original})});
  ds.receivedPreview=data;ds.revision=data.revision;ds.pending=null;
  one(d,"#review-form-revision").textContent="Inspected at project r"+data.revision;
  one(d,"#review-preview-result").innerHTML='<p class="review-hash">Original bytes: '+data.bytes+" · "+esc(data.source_sha256)+'</p><p>Declared reviewer: <strong>'+esc(data.response.reviewer.name||"Unattributed")+'</strong> · '+esc(data.response.reviewer.organization)+'</p><p>'+data.comments.length+' comments'+(data.duplicate_of?" · exact content already retained as "+esc(data.duplicate_of):"")+"</p>"+data.warnings.map(w=>'<p class="review-alert">'+esc(w)+"</p>").join("")+'<div class="review-preview-table">'+table(["Entry / clause","Returned text","Current draft"],data.comments.map(r=>[esc(r.entry.id)+"<br>"+esc(r.entry.clause_id||"General"),esc(r.entry.body.slice(0,600)),esc(label(r.draft_status))]))+"</div>";
  const previous=one(d,"#review-predecessor");previous.hidden=!data.previous_response_id||!!data.duplicate_of;
  previous.innerHTML=data.previous_response_id?'<label class="review-check"><input type="checkbox" name="supersedes" value="'+esc(data.previous_response_id)+'">This is a corrected return for '+esc(data.previous_response_id)+'. Preserve its earlier comments and dispositions.</label>'+table(["Entry","Difference"],data.differences.map(r=>[esc(r.entry_id),esc(r.kind)])):"";
  one(d,".review-rebase").hidden=true;one(d,"#review-error").textContent="";
 }
 one(d,"#review-preview").onclick=()=>preview().catch(e=>one(d,"#review-error").textContent=explain(e));
 ds.rebase=preview;
 ds.submit=async()=>{
  if(!ds.receivedPreview)await preview();
  const data=ds.receivedPreview;
  if(data.previous_response_id&&!data.duplicate_of&&!one(d,"[name=supersedes]")?.checked)throw Error("Select the actual predecessor of this corrected return.");
  await perform("review.receive",{packet_id:val(d,"packet_id"),...original,supersedes_id:one(d,"[name=supersedes]")?.checked?data.previous_response_id:"",receipt_note:val(d,"receipt_note")});
 };
}
async function commentRow(commentId){
 const detail=state().detail;
 const row=detail?.comments.find(r=>r.comment.id===commentId);if(!row)throw Error("Open the retained response and choose its comment first.");
 return row;
}
async function amendmentDialog(commentId){
 const row=await commentRow(commentId),clauses=context.project.clauses;
 const d=makeDialog("Apply an explicit clause amendment",
 '<p>The selected fields replace the complete current clause body in that language. Adapt the proposed wording before applying it.</p>'+
 formLabel("Working clause",select("clause_id",clauses,row.current_clause?.id||"","Select the target working clause",c=>c.number+" · "+c.title_en))+
 '<div id="review-current-clause"></div><div class="review-form-grid">'+
 '<div><label class="review-check"><input type="checkbox" name="use_en">Replace the English body</label>'+area("body_en",row.entry.proposed_text_en,"maxlength=120000")+'</div>'+
 '<div lang="fr"><label class="review-check"><input type="checkbox" name="use_fr">Remplacer le corps du texte français</label>'+area("body_fr",row.entry.proposed_text_fr,"maxlength=120000")+'</div></div>'+
 formLabel("Reason for this selected amendment",area("rationale","","required maxlength=16000")),
 "Apply to working draft");
 const ds=dialogState;let selected=null;
 async function loadClause(){
  const id=val(d,"clause_id");if(!id){selected=null;one(d,"#review-current-clause").textContent="Select the working clause.";return;}
  selected=await context.api(ds.endpoint+"/review/clauses/"+encodeURIComponent(id));
  one(d,"#review-current-clause").innerHTML='<div class="review-compare"><div><h3>Current English</h3><div class="review-readonly">'+esc(selected.clause.body_en)+'</div></div><div lang="fr"><h3>Français actuel</h3><div class="review-readonly">'+esc(selected.clause.body_fr)+'</div></div></div><p class="review-hash">'+esc(selected.sha256)+"</p>";
 }
 one(d,"[name=clause_id]").onchange=()=>loadClause().catch(e=>one(d,"#review-error").textContent=explain(e));
 await loadClause();
 ds.rebase=async()=>{await refreshedContext();await loadClause();one(d,"#review-error").textContent="Current clause text is shown above. Your selected replacement text remains unchanged; review both before applying.";};
 ds.submit=()=>{
  if(!selected||selected.clause.id!==val(d,"clause_id"))throw Error("Read the actual target clause first.");
  const changes={};if(one(d,"[name=use_en]").checked)changes.body_en=val(d,"body_en");if(one(d,"[name=use_fr]").checked)changes.body_fr=val(d,"body_fr");
  return perform("review.amend",{comment_id:commentId,clause_id:selected.clause.id,expected_clause_sha256:selected.sha256,changes,rationale:val(d,"rationale")});
 };
}
async function resolutionDialog(commentId){
 const row=await commentRow(commentId),c=row.comment;
 const current=row.resolutions.filter(r=>r.current).at(-1);
 const d=makeDialog("Record an edition-bound disposition",
 '<div class="review-readonly">'+esc(row.entry.body)+'</div><div class="review-form-grid">'+
 formLabel("Disposition",'<select name="disposition">'+["open","accepted","rejected","deferred"].map(v=>'<option value="'+v+'" '+(v===c.disposition?"selected":"")+">"+esc(label(v))+"</option>").join("")+"</select>")+
 formLabel("Resolution edition",select("resolution_edition_id",context.project.editions,c.resolution_edition_id,"No frozen resolution edition selected"))+'</div>'+
 formLabel("Disposition rationale",area("rationale",c.rationale,"maxlength=16000"))+
 '<div id="review-resolution-target"></div><div id="review-resolution-amendments"></div>'+
 formLabel("Response appendix audience",'<select name="response_visibility"><option value="recipient_only">Selected respondent only</option><option value="public">Include this comment in the selected public edition appendix</option></select>')+
 formLabel("Basis for explicit public inclusion",area("publication_basis",current?.publication_basis||"","maxlength=8000"))+
 '<p><small>Recipient replies contain only this respondent’s comments and selected dispositions. Public edition appendices include only entries explicitly selected here; contact details and original return files are excluded.</small></p>',
 "Record disposition");
 const ds=dialogState;let edition=null;
 setField(d,"response_visibility",current?.response_visibility||"recipient_only");
 async function loadEdition(){
  const id=val(d,"resolution_edition_id");
  if(!id){edition=null;one(d,"#review-resolution-target").innerHTML="";one(d,"#review-resolution-amendments").innerHTML="";return;}
  edition=await context.api(ds.endpoint+"/records/editions/"+encodeURIComponent(id));
  const proposed=c.resolution_clause_id||row.current_clause?.id||"";
  one(d,"#review-resolution-target").innerHTML=formLabel("Exact frozen resolution clause",select("resolution_clause_id",edition.snapshot.clauses,proposed,"No individual clause",r=>r.number+" · "+r.title_en))+'<div id="review-resolution-text"></div>';
  one(d,"[name=resolution_clause_id]").onchange=showTarget;showTarget();
 }
 function showTarget(){
  const target=edition?.snapshot.clauses.find(r=>r.id===val(d,"resolution_clause_id"));
  one(d,"#review-resolution-text").innerHTML=target?'<div class="review-compare"><div><h3>Frozen English</h3><div class="review-readonly">'+esc(target.body_en)+'</div></div><div lang="fr"><h3>Français figé</h3><div class="review-readonly">'+esc(target.body_fr)+"</div></div></div>":"";
  const matches=row.amendments.filter(a=>target&&a.clause_id===target.id&&["title_en","body_en","table_en","title_fr","body_fr","table_fr"].every(f=>JSON.stringify(a.snapshot.after[f])===JSON.stringify(target[f])));
  one(d,"#review-resolution-amendments").innerHTML=matches.length?"<h3>Applied wording present in this edition</h3>"+matches.map(a=>'<label class="review-check"><input type="checkbox" name="amendment_id" value="'+esc(a.id)+'">'+esc(a.rationale)+" <small>"+esc(a.id)+"</small></label>").join(""):"<p><small>No selected applied amendment exactly matches this frozen clause. A rationale and an explicit edition can still record another resolution.</small></p>";
 }
 one(d,"[name=resolution_edition_id]").onchange=()=>loadEdition().catch(e=>one(d,"#review-error").textContent=explain(e));await loadEdition();
 ds.rebase=async()=>{
  await refreshedContext();const latest=await context.api(ds.endpoint+"/records/comments/"+encodeURIComponent(commentId));
  one(d,"#review-error").textContent="Current saved disposition: "+latest.disposition+"\n"+latest.rationale+"\nYour rationale and selection remain in the form; review both before recording the next decision.";
  await loadEdition();
 };
 ds.submit=()=>perform("review.resolve",{comment_id:commentId,disposition:val(d,"disposition"),rationale:val(d,"rationale"),
  resolution_edition_id:val(d,"resolution_edition_id"),resolution_clause_id:val(d,"resolution_clause_id"),
  amendment_ids:all(d,'[name="amendment_id"]:checked').map(e=>e.value),response_visibility:val(d,"response_visibility"),publication_basis:val(d,"publication_basis")});
}


async function carryDialog(responseId){
 const detail=await context.api(endpoint()+"/review/responses/"+encodeURIComponent(responseId));
 const initial=detail.decision_carry;
 if(!initial?.predecessor_id)throw Error("This response has no retained predecessor.");
 const d=makeDialog("Adopt decisions for unchanged returned entries",
 '<p>These are existing decisions on exactly unchanged entries from the selected predecessor. Each selected decision receives a new immutable record bound to this return. Changed entries remain independent. Public inclusion is not inherited.</p>'+
 '<div id="review-carry-identity" class="review-readonly"></div><div id="review-carry-entries"></div>'+
 formLabel("Reason for this explicit adoption",area("rationale","","required maxlength=16000")),
 "Adopt selected unchanged decisions");
 const ds=dialogState;let preview=initial;
 function show(selected=null){
  one(d,"#review-carry-identity").textContent="Current return: "+preview.response_id+"\n"+preview.response_sha256+"\nPredecessor: "+preview.predecessor_id+"\n"+preview.predecessor_sha256;
  const eligible=preview.entries.filter(r=>r.eligible),excluded=preview.entries.filter(r=>!r.eligible);
  one(d,"#review-carry-entries").innerHTML=(eligible.length?table(["Select / entry","Existing predecessor decision","Current entry"],eligible.map(r=>[
   '<label class="review-check"><input type="checkbox" name="entry_id" value="'+esc(r.entry_id)+'" '+(selected===null||selected.has(r.entry_id)?"checked":"")+'> '+esc(r.entry_id)+"</label>"+esc(r.clause_id||"General")+"<br>"+esc(r.body.slice(0,260)),
   "<strong>"+esc(r.predecessor_disposition)+"</strong><div class='review-clause'>"+esc(r.predecessor_rationale)+"</div><small>"+esc(r.predecessor_comment_id)+" · r"+r.predecessor_comment_revision+"</small>",
   esc(r.current_disposition)+"<br>"+esc(r.comment_id)
  ])):'<p>No unchanged entries currently have an eligible predecessor decision to adopt.</p>')+
  (excluded.length?'<details><summary>'+excluded.length+" entries require their own review or already contain work</summary>"+table(["Entry","Reason"],excluded.map(r=>[esc(r.entry_id),esc(r.reason)]))+"</details>":"");
 }
 show();
 ds.rebase=async()=>{
  const selected=new Set(all(d,'[name=entry_id]:checked').map(e=>e.value));
  await refreshedContext();preview=(await context.api(ds.endpoint+"/review/responses/"+encodeURIComponent(responseId))).decision_carry;
  show(selected);one(d,"#review-error").textContent="Current predecessor and decisions shown. Your rationale and still-eligible selections remain; review them before adopting.";
 };
 ds.submit=()=>perform("review.carry",{response_id:responseId,predecessor_id:preview.predecessor_id,
  entry_ids:all(d,'[name=entry_id]:checked').map(e=>e.value),rationale:val(d,"rationale")});
}
