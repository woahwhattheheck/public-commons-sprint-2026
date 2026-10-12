const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const clone=v=>structuredClone(v),uid=()=>crypto.randomUUID();
const all=(root,s)=>[...root.querySelectorAll(s)],one=(root,s)=>root.querySelector(s);
const sessions=new Map(),PAGE_SIZE=25;
let context=null,viewState=null,epoch=0,dialogState=null;
function label(value){
 const names={open:"Open",accepted:"Accepted",rejected:"Rejected",deferred:"Deferred",recipient_only:"Selected respondent",public:"Public edition appendix",en:"English",fr:"French",bilingual:"English and French",both:"English and French"};
 const text=String(value??"");
 return names[text]||text.replaceAll("_"," ").replace(/^./,c=>c.toUpperCase());
}
function table(head,rows){
 return '<div class="table-wrap"><table><thead><tr>'+head.map(v=>'<th scope="col">'+esc(v)+'</th>').join("")+'</tr></thead><tbody>'+
  rows.map(row=>'<tr>'+row.map((v,i)=>'<td data-label="'+esc(head[i])+'">'+v+'</td>').join("")+'</tr>').join("")+'</tbody></table></div>';
}
function button(action,title,attrs="",primary=false){
 return '<button type="button" data-review="'+action+'" '+attrs+' class="'+(primary?"primary":"")+'">'+esc(title)+'</button>';
}
function options(rows,value,title=r=>r.title||r.label||r.id,empty="Select a record"){
 return '<option value="">'+esc(empty)+'</option>'+rows.map(r=>'<option value="'+esc(r.id)+'" '+(r.id===value?"selected":"")+'>'+esc(title(r))+'</option>').join("");
}
function endpoint(){return "/api/projects/"+encodeURIComponent(context.project.id);}
function state(){return viewState;}
function explain(error){return error.message||String(error);}
function selection(collection,id){return context.project[collection]?.find(r=>r.id===id);}
function historyName(id,collection){const r=selection(collection,id);return r?.title||r?.label||id||"—";}
function downloadLink(audience,id){
 const key=audience==="consultation"?"packet_id":"response_id";
 return endpoint()+"/export?audience="+audience+"&"+key+"="+encodeURIComponent(id);
}
function count(value){return Number.isFinite(value)?value:0;}
function openCount(row){return count(row.dispositions?.open)+count(row.dispositions?.deferred);}
function attention(row){return ["open","deferred"].includes(row.comment.disposition);}
function badge(value){return '<span class="review-badge">'+esc(label(value))+'</span>';}
function date(value){
 if(!value)return "Not recorded";
 const parsed=new Date(value);
 if(!Number.isFinite(parsed.getTime()))return esc(value);
 return '<time datetime="'+esc(value)+'">'+esc(new Intl.DateTimeFormat(undefined,{dateStyle:"medium",timeStyle:"short",timeZone:"UTC"}).format(parsed))+' UTC</time>';
}
function metadata(title,values){
 const entries=values.filter(([,value])=>value!==undefined&&value!==null&&value!=="");
 if(!entries.length)return "";
 return '<details class="review-metadata"><summary>'+esc(title)+'</summary><dl>'+entries.map(([key,value])=>'<dt>'+esc(key)+'</dt><dd><code>'+esc(value)+'</code></dd>').join("")+'</dl></details>';
}
function textMatch(query,values){
 const normalized=value=>String(value??"").normalize("NFKD").replace(/\p{Mark}/gu,"").toLocaleLowerCase();
 const text=normalized(values.join(" "));
 return normalized(query).trim().split(/\s+/).filter(Boolean).every(word=>text.includes(word));
}
function windowed(rows,key){
 const pages=Math.max(1,Math.ceil(rows.length/PAGE_SIZE));
 state()[key]=Math.min(Math.max(0,state()[key]||0),pages-1);
 const start=state()[key]*PAGE_SIZE;
 return {rows:rows.slice(start,start+PAGE_SIZE),page:state()[key],pages,total:rows.length,start,end:Math.min(start+PAGE_SIZE,rows.length)};
}
function pager(page,list,noun){
 return '<div class="review-pagination"><span role="status">'+(page.total?(page.start+1)+'–'+page.end:'0')+' of '+page.total+' '+esc(noun)+'</span><div>'+
  button("page","Previous",'data-list="'+list+'" data-delta="-1" '+(page.page?"":"disabled"))+
  '<span class="review-page-number">Page '+(page.page+1)+' of '+page.pages+'</span>'+
  button("page","Next",'data-list="'+list+'" data-delta="1" '+(page.page+1<page.pages?"":"disabled"))+'</div></div>';
}
function empty(message,actions=""){return '<div class="review-empty"><p>'+esc(message)+'</p>'+actions+'</div>';}
function responseSummary(id){return state().status.responses.find(r=>r.id===id);}
function responseName(id){const r=responseSummary(id);return r?.reviewer?.name||"Returned response";}
function responseLink(id,title){
 return responseSummary(id)?button("related-response",title||responseName(id),'data-id="'+esc(id)+'"'):metadata("Earlier response record",[["Response",id]]);
}
function filteredResponses(){
 const s=state();
 return s.status.responses.filter(r=>textMatch(s.responseQuery,[r.reviewer?.name,r.reviewer?.organization,r.reviewer?.email,r.id,r.source_sha256])&&
  (s.responseStatus==="all"||s.responseStatus==="attention"&&openCount(r)>0||s.responseStatus==="resolved"&&r.comment_count>0&&openCount(r)===0||s.responseStatus==="corrections"&&r.supersedes_id))
  .slice().sort((a,b)=>s.responseSort==="reviewer"?String(a.reviewer?.name||"").localeCompare(String(b.reviewer?.name||""))||a.id.localeCompare(b.id):
   (s.responseSort==="oldest"?1:-1)*(String(a.received_at||"").localeCompare(String(b.received_at||""))||a.id.localeCompare(b.id)));
}
function filteredComments(){
 const s=state();
 return (s.detail?.comments||[]).filter(r=>textMatch(s.commentQuery,[r.entry.body,r.entry.proposed_text_en,r.entry.proposed_text_fr,r.reviewed_clause?.number,r.reviewed_clause?.title_en,r.reviewed_clause?.title_fr,r.comment.rationale,r.comment.id,r.entry.id])&&
  (s.commentStatus==="all"||s.commentStatus==="attention"&&attention(r)||s.commentStatus===r.comment.disposition)&&
  (s.commentLanguage==="all"||s.commentLanguage===r.entry.language));
}
function resetCommentFilters(){Object.assign(state(),{commentQuery:"",commentStatus:"all",commentLanguage:"all",commentPage:0});}
function nextOpenComment(){
 const rows=state().detail?.comments||[],index=rows.findIndex(r=>r.comment.id===state().commentId);
 return [...rows.slice(index+1),...rows.slice(0,index)].find(attention);
}
function filterSelect(name,caption,choices,value){
 return '<label>'+esc(caption)+'<select name="'+name+'">'+choices.map(([key,title])=>'<option value="'+esc(key)+'" '+(value===key?"selected":"")+'>'+esc(title)+'</option>').join("")+'</select></label>';
}
function workflowPath(){
 const s=state().status,open=s.responses.reduce((n,r)=>n+openCount(r),0);
 const steps=[
  {title:"Prepare packet",note:s.packets.length+" saved",action:"navigate",attrs:'data-tab="packets"'},
  {title:"Receive return",note:s.responses.length+" received",action:"navigate-receive",attrs:""},
  {title:"Review comments",note:open+" need decisions",action:"navigate",attrs:'data-tab="responses"'},
  {title:"Freeze successor",note:"Retain changed wording",action:"navigate-freeze",attrs:""},
  {title:"Return decisions",note:"Open reply packages",action:"replies",attrs:""}
 ];
 return '<nav class="review-workflow" aria-label="Consultation workflow"><ol>'+steps.map((step,i)=>'<li><span class="review-step-number">'+(i+1)+'</span><div>'+button(step.action,step.title,step.attrs)+'<small>'+esc(step.note)+'</small></div></li>').join("")+'</ol></nav>';
}
export async function mountConsultation(ctx){
 context=ctx;
 if(!sessions.has(ctx.project.id))sessions.set(ctx.project.id,{tab:"packets",responseId:null,commentId:null,page:0,detail:null,detailRevision:null,preview:null});
 viewState=sessions.get(ctx.project.id);
 const defaults={packetQuery:"",packetPage:0,responseQuery:"",responseStatus:"all",responseSort:"newest",commentQuery:"",commentStatus:"all",commentLanguage:"all",commentPage:0,resolutionQuery:"",resolutionState:"all",resolutionPage:0};
 for(const [key,value]of Object.entries(defaults))if(viewState[key]===undefined)viewState[key]=value;
 const e=++epoch,data=ctx.project.review||await ctx.api(endpoint()+"/review/status");
 if(e!==epoch||!ctx.isCurrent())return;
 viewState.status=data;
 render();
 if(viewState.tab==="responses"&&viewState.responseId)await showResponse(viewState.responseId);
}
function root(){return document.querySelector("#main");}
function render(){
 const p=context.project,s=viewState.status;
 let content='<section class="review-receiving"><div class="heading"><div><p class="eyebrow">'+esc(p.title)+' · Revision '+p.revision+'</p><h1>Consultation receiving</h1><p>Prepare bilingual review material, work through returned comments, and send decisions tied to a saved edition.</p></div><div class="review-toolbar">'+button("new-consultation","Set up consultation")+button("packet","Prepare reviewer packet","",true)+'</div></div>';
 content+=workflowPath();
 content+='<div class="review-summary"><div><strong>'+s.packets.length+'</strong><small>Reviewer packets</small></div><div><strong>'+s.responses.length+'</strong><small>Returned responses</small></div><div><strong>'+s.responses.reduce((n,r)=>n+count(r.comment_count),0)+'</strong><small>Comments received</small></div><div><strong>'+s.responses.reduce((n,r)=>n+openCount(r),0)+'</strong><small>Open or deferred</small></div></div>';
 content+='<div class="review-switch" role="tablist" aria-label="Consultation records">'+[["packets","Reviewer packets"],["responses","Returned comments"],["revisions","Amendments & dispositions"]].map(([key,title])=>'<button type="button" role="tab" id="review-tab-'+key+'" aria-controls="review-panel-'+key+'" data-review="tab" data-tab="'+key+'" aria-selected="'+(state().tab===key)+'" tabindex="'+(state().tab===key?"0":"-1")+'">'+title+'</button>').join("")+'</div>';
 content+='<section id="review-panel-'+state().tab+'" role="tabpanel" aria-labelledby="review-tab-'+state().tab+'">'+(state().tab==="packets"?packetsView():state().tab==="responses"?responsesView():revisionsView())+'</section></section>';
 const host=root();host.innerHTML=content;
 host.onclick=event=>{const el=event.target.closest("[data-review]");if(el){event.preventDefault();event.stopPropagation();dispatch(el).catch(e=>context.notify(explain(e)));}};
 host.onkeydown=event=>{
  const tab=event.target.closest('[role="tab"]');
  if(!tab||!["ArrowLeft","ArrowRight","Home","End"].includes(event.key))return;
  event.preventDefault();
  const tabs=all(host,'[role="tab"]'),index=tabs.indexOf(tab);
  const next=event.key==="Home"?0:event.key==="End"?tabs.length-1:(index+(event.key==="ArrowRight"?1:-1)+tabs.length)%tabs.length;
  const selected=tabs[next].dataset.tab;
  dispatch(tabs[next]).then(()=>root().querySelector('[role="tab"][data-tab="'+selected+'"]')?.focus()).catch(e=>context.notify(explain(e)));
 };
 host.onsubmit=event=>{
  const form=event.target.closest("[data-review-filter]");if(!form)return;
  event.preventDefault();
  const data=new FormData(form),kind=form.dataset.reviewFilter;
  if(kind==="responses"){
   Object.assign(state(),{responseQuery:String(data.get("query")||""),responseStatus:String(data.get("status")||"all"),responseSort:String(data.get("sort")||"newest"),page:0});
   if(state().responseId&&!filteredResponses().some(r=>r.id===state().responseId)){state().responseId=null;state().detail=null;state().detailRevision=null;}
  }else if(kind==="comments"){
   Object.assign(state(),{commentQuery:String(data.get("query")||""),commentStatus:String(data.get("status")||"all"),commentLanguage:String(data.get("language")||"all"),commentPage:0});
   state().commentId=filteredComments()[0]?.comment.id||null;
  }else if(kind==="packets")Object.assign(state(),{packetQuery:String(data.get("query")||""),packetPage:0});
  else Object.assign(state(),{resolutionQuery:String(data.get("query")||""),resolutionState:String(data.get("status")||"all"),resolutionPage:0});
  if(kind==="comments")renderDetail();else render();
  root().querySelector('[data-review-filter="'+kind+'"] input[name="query"]')?.focus({preventScroll:true});
 };
 if(state().tab==="responses"&&state().detail?.id===state().responseId)renderDetail();
}
function packetsView(){
 const allRows=state().status.packets;
 let content='<div class="review-section-heading"><div><h2>Reviewer packets</h2><p>Choose the saved consultation and edition, then download its bilingual ZIP or receive a returned JSON file.</p></div></div>';
 if(!allRows.length)return content+empty("Create a consultation and freeze its edition to prepare the first reviewer packet.",button("freeze-edition","Freeze current edition")+button("new-consultation","Create consultation"));
 content+='<form class="review-filters" data-review-filter="packets"><label class="review-search">Find a packet<input type="search" name="query" value="'+esc(state().packetQuery)+'" placeholder="Packet, consultation or edition"></label><button type="submit">Apply</button>'+button("clear-filters","Clear",'data-list="packets"')+'</form>';
 const page=windowed(allRows.filter(r=>textMatch(state().packetQuery,[r.title,historyName(r.consultation_id,"consultations"),historyName(r.edition_id,"editions"),r.id])),"packetPage");
 content+=page.total?table(["Packet / consultation","Saved edition","Receiving","Actions"],page.rows.map(r=>[
  '<strong>'+esc(r.title)+'</strong><small>'+esc(historyName(r.consultation_id,"consultations"))+'</small>'+metadata("Packet details",[["Packet",r.id],["SHA-256",r.packet_sha256]]),
  esc(historyName(r.edition_id,"editions"))+(r.consultation_changed_since_packet?'<p class="review-inline-note">Consultation details have changed since this packet was saved.</p>':""),
  '<strong>'+r.response_count+' responses · '+r.comment_count+' comments</strong><small>'+r.unresolved_count+' open or deferred</small>'+(r.actual_closed?badge("Consultation closed"):""),
  '<div class="review-row-actions"><a class="button" href="'+downloadLink("consultation",r.id)+'">Download reviewer ZIP</a>'+button("receive","Receive response",'data-id="'+esc(r.id)+'"')+button("record","Inspect packet",'data-collection="review_packets" data-id="'+esc(r.id)+'"')+'</div>'
 ])):empty("No packets match this search.",button("clear-filters","Show all packets",'data-list="packets"'));
 content+=pager(page,"packets","packets");
 content+='<details class="review-metadata"><summary>Invitation and dispatch records</summary><p>Use the communications register to record an actual invitation or SCC link dispatch for the prepared packet.</p></details>';
 return content;
}
function responsesView(){
 const list=state().status.responses;
 let content='<div class="review-section-heading"><div><h2>Returned comments</h2><p>Choose a response, work through its comments, and reopen earlier or corrected returns when needed.</p></div><div class="review-toolbar">'+button("receive","Receive response","",true)+button("refresh","Refresh saved state")+'</div></div>';
 if(!list.length)return content+empty("Receive the JSON exported from the reviewer’s offline page. Its comments and the returned file will appear here.");
 content+='<form class="review-filters" data-review-filter="responses"><label class="review-search">Find a response<input type="search" name="query" value="'+esc(state().responseQuery)+'" placeholder="Reviewer, organization or email"></label>'+
  filterSelect("status","Show",[["all","All responses"],["attention","Needs a decision"],["resolved","All comments decided"],["corrections","Corrected returns"]],state().responseStatus)+
  filterSelect("sort","Order",[["newest","Latest received"],["oldest","Earliest received"],["reviewer","Reviewer name"]],state().responseSort)+'<button type="submit">Apply</button>'+button("clear-filters","Clear",'data-list="responses"')+'</form>';
 const page=windowed(filteredResponses(),"page");
 content+='<div class="review-response-index">'+(page.total?table(["Reviewer","Received","Comments","Actions"],page.rows.map(r=>[
  '<strong>'+esc(r.reviewer.name||"Unattributed")+'</strong><small>'+esc(r.reviewer.organization)+'</small><small>Reviewer-declared identity'+(r.authored_example?" · authored exercise":"")+'</small>',
  date(r.received_at)+(r.supersedes_id?'<div class="review-related">'+responseLink(r.supersedes_id,"Open earlier return")+'</div>':"")+metadata("Receiving details",[["Response",r.id],["Original file SHA-256",r.source_sha256]]),
  '<strong>'+r.comment_count+' total · '+openCount(r)+' need decisions</strong><small>'+count(r.dispositions.accepted)+' accepted · '+count(r.dispositions.rejected)+' rejected · '+count(r.dispositions.deferred)+' deferred</small>'+(r.earlier_open_comments.length?'<p class="review-inline-note">'+r.earlier_open_comments.length+' earlier comments still need a decision.</p>':""),
  '<div class="review-row-actions">'+button("response",state().responseId===r.id?"Response open below":"Review comments",'data-id="'+esc(r.id)+'" aria-pressed="'+(state().responseId===r.id)+'"',true)+(r.unchanged_decisions_available?button("carry","Adopt "+r.unchanged_decisions_available+" unchanged decisions",'data-id="'+esc(r.id)+'"'):"")+'<a class="button" href="'+downloadLink("review_response",r.id)+'">Export reply package</a>'+button("source","View returned file",'data-id="'+esc(r.source_id)+'"')+'</div>'
 ])):empty("No responses match these filters.",button("clear-filters","Show all responses",'data-list="responses"')))+pager(page,"responses","responses")+'</div>';
 content+='<div id="review-response-detail">'+(state().responseId?'<p class="review-loading" role="status">Opening the saved response…</p>':empty("Select Review comments on a response to open its comment queue."))+'</div>';
 return content;
}
function revisionsView(){
 const allRows=state().status.resolutions;
 let content='<div class="review-section-heading"><div><h2>Amendments and dispositions</h2><p>Apply wording to the working draft, freeze the successor edition, then record each decision against the exact saved clause.</p></div></div>';
 content+='<div class="review-next-actions"><section><h3>Retain the resulting wording</h3><p>Freeze the working draft after applying selected amendments. Choose that edition when recording the disposition.</p>'+button("freeze-edition","Freeze successor edition")+'</section><section><h3>Prepare replies and publication</h3><p>Open a returned response to export its reply package, or continue the selected edition through publication.</p><div class="review-row-actions">'+button("replies","Open reply packages")+button("publication","Open publication workflow")+'</div></section></div>';
 if(!allRows.length)return content+empty("No edition-linked dispositions have been recorded yet. Open a returned comment to record its decision.",button("navigate","Review returned comments",'data-tab="responses"'));
 content+='<form class="review-filters" data-review-filter="resolutions"><label class="review-search">Find a decision<input type="search" name="query" value="'+esc(state().resolutionQuery)+'" placeholder="Decision, edition or comment record"></label>'+
  filterSelect("status","Snapshot",[["all","All retained decisions"],["current","Current decisions"],["earlier","Earlier decisions"]],state().resolutionState)+'<button type="submit">Apply</button>'+button("clear-filters","Clear",'data-list="resolutions"')+'</form>';
 const rows=allRows.filter(r=>textMatch(state().resolutionQuery,[label(r.disposition),historyName(r.resolution_edition_id,"editions"),r.comment_id,r.id])&&
  (state().resolutionState==="all"||state().resolutionState==="current"&&r.current||state().resolutionState==="earlier"&&!r.current));
 const page=windowed(rows,"resolutionPage");
 content+=page.total?table(["Decision","Resolution edition","Reply audience","Review"],page.rows.map(r=>[
  '<strong>'+esc(label(r.disposition))+'</strong><small>'+(r.current?"Current comment decision":"Retained earlier decision")+'</small>'+metadata("Decision details",[["Disposition",r.id],["Comment",r.comment_id]]),
  esc(historyName(r.resolution_edition_id,"editions")),
  esc(label(r.response_visibility))+(r.current?"":'<p class="review-inline-note">The current comment differs from this saved decision.</p>'),
  '<div class="review-row-actions">'+button("record","Open comment",'data-collection="comments" data-id="'+esc(r.comment_id)+'"')+button("record","Inspect disposition",'data-collection="review_resolutions" data-id="'+esc(r.id)+'"')+'</div>'
 ])):empty("No decisions match these filters.",button("clear-filters","Show all decisions",'data-list="resolutions"'));
 return content+pager(page,"resolutions","decisions");
}
async function showResponse(id){
 const selectingAnother=state().responseId!==id;
 if(selectingAnother){resetCommentFilters();state().commentId=null;state().detail=null;state().detailRevision=null;}
 const e=++epoch;state().responseId=id;
 render();
 let detail=state().detail;
 if(!detail||detail.id!==id||state().detailRevision!==context.project.revision)detail=await context.api(endpoint()+"/review/responses/"+encodeURIComponent(id));
 if(e!==epoch||!context.isCurrent()||state().tab!=="responses")return;
 state().detail=detail;state().detailRevision=context.project.revision;
 if(!detail.comments.some(r=>r.comment.id===state().commentId))state().commentId=detail.comments[0]?.comment.id;
 renderDetail();
 if(selectingAnother)document.querySelector("#review-response-detail")?.scrollIntoView({block:"start"});
}
function renderDetail(){
 const holder=document.querySelector("#review-response-detail");if(!holder||!state().detail)return;
 const d=state().detail,summary=responseSummary(d.id),reviewer=d.response.response.reviewer;
 const rows=filteredComments();
 if(rows.length&&!rows.some(r=>r.comment.id===state().commentId)){state().commentId=rows[0].comment.id;state().commentPage=0;}
 const page=windowed(rows,"commentPage"),row=rows.find(r=>r.comment.id===state().commentId),index=rows.indexOf(row);
 const later=state().status.responses.filter(r=>r.supersedes_id===d.id),languages=[...new Set(d.comments.map(r=>r.entry.language))].sort();
 let content='<section class="review-response"><div class="review-section-heading"><div><p class="eyebrow">Selected response</p><h2>'+esc(reviewer.name||"Unattributed reviewer")+'</h2><p>'+esc(reviewer.organization)+(summary?' · '+date(summary.received_at):"")+'</p></div><div class="review-toolbar">'+button("reply","Export reply package",'data-id="'+esc(d.id)+'"')+button("close-response","Close response")+'</div></div>';
 if(summary?.supersedes_id||later.length)content+='<div class="review-related"><strong>Related returns</strong>'+(summary?.supersedes_id?responseLink(summary.supersedes_id,"Open earlier return"):"")+later.map(r=>responseLink(r.id,"Open corrected return · "+responseName(r.id))).join("")+'</div>';
 if(summary?.earlier_open_comments.length)content+='<p class="review-note">'+summary.earlier_open_comments.length+' comments in earlier returns still need their own decision. Open the earlier return to work through them.</p>';
 if(summary?.unchanged_decisions_available)content+='<div class="review-note">'+summary.unchanged_decisions_available+' entries retain exactly unchanged earlier decisions. '+button("carry-preview","Review decisions to adopt",'data-id="'+esc(d.id)+'"')+'</div>';
 if(d.response.receipt_note)content+='<div class="review-note"><strong>Receipt note</strong><p>'+esc(d.response.receipt_note)+'</p></div>';
 content+=metadata("Contact and returned file details",[["Declared email",reviewer.email],["Response",d.id],["Original file SHA-256",summary?.source_sha256]]);
 content+='<div class="review-comment-layout"><aside class="review-comment-sidebar" aria-label="Comment queue"><h3>Comments <span class="review-muted">'+d.comments.length+'</span></h3>'+
  '<form class="review-filters review-comment-filters" data-review-filter="comments"><label>Find a comment<input type="search" name="query" value="'+esc(state().commentQuery)+'" placeholder="Text, clause or wording"></label>'+
  filterSelect("status","Decision",[["all","All comments"],["attention","Open or deferred"],["open","Open"],["accepted","Accepted"],["rejected","Rejected"],["deferred","Deferred"]],state().commentStatus)+
  filterSelect("language","Language",[["all","All languages"],...languages.map(value=>[value,label(value)])],state().commentLanguage)+'<div class="review-row-actions"><button type="submit">Apply</button>'+button("clear-filters","Clear",'data-list="comments"')+'</div></form>'+
  '<div class="review-comment-list">'+(page.total?page.rows.map(r=>'<button type="button" data-review="comment" data-id="'+esc(r.comment.id)+'" aria-pressed="'+(r.comment.id===state().commentId)+'" class="'+(r.comment.id===state().commentId?"selected":"")+'"><strong>'+esc(r.reviewed_clause?.number?"Clause "+r.reviewed_clause.number:"Whole document")+'</strong><span>'+esc(r.entry.body.slice(0,120))+(r.entry.body.length>120?"…":"")+'</span><small>'+esc(label(r.comment.disposition))+' · '+esc(label(r.entry.language))+'</small></button>').join(""):empty("No comments match these filters.",button("clear-filters","Show all comments",'data-list="comments"')))+'</div>'+pager(page,"comments","comments")+'</aside><article class="review-comment-detail">';
 if(row){
  const c=row.comment,old=row.reviewed_clause,now=row.current_clause,next=nextOpenComment();
  content+='<div class="review-comment-navigation"><span>Comment '+(index+1)+' of '+rows.length+' shown</span><div class="review-row-actions">'+button("comment-queue","Comment queue")+button("comment-step","Previous",'data-delta="-1" '+(index>0?"":"disabled"))+button("comment-step","Next",'data-delta="1" '+(index<rows.length-1?"":"disabled"))+button("next-open","Next needing decision",next?"":"disabled")+'</div></div>';
  content+='<section class="review-pane"><div class="review-comment-heading"><div><p class="eyebrow">'+esc(label(row.entry.language))+' comment</p><h3 id="review-comment-heading" tabindex="-1">'+esc(old?old.number+" · "+old.title_en:"Whole-document comment")+'</h3></div>'+badge(c.disposition)+'</div><div class="review-clause review-comment-body">'+esc(row.entry.body)+'</div>';
  content+='<div class="review-row-actions review-main-actions">'+button("amend","Apply / adapt proposed wording",'data-id="'+esc(c.id)+'"')+button("resolve","Record disposition",'data-id="'+esc(c.id)+'"',true)+'</div>';
  content+='<div class="review-pair"><section><h4>Proposed English wording</h4><div class="review-clause">'+esc(row.entry.proposed_text_en||"No replacement text supplied.")+'</div></section><section lang="fr"><h4>Texte français proposé</h4><div class="review-clause">'+esc(row.entry.proposed_text_fr||"Aucun texte de remplacement fourni.")+'</div></section></div>';
  content+=metadata("Comment source details",[["Comment",c.id],["Returned entry",row.entry.id],["Source locator",c.source_locator]])+'</section>';
  content+='<section class="review-pane"><div class="review-section-heading"><div><h3>Recorded disposition</h3>'+badge(c.disposition)+'</div>'+button("resolve-existing","Review / update decision",'data-id="'+esc(c.id)+'"')+'</div><p class="review-clause">'+esc(c.rationale||"Record a rationale when deciding this comment.")+'</p>';
  if(c.resolution_edition_id)content+='<p><strong>Resolution edition:</strong> '+esc(historyName(c.resolution_edition_id,"editions"))+'</p>'+metadata("Resolution reference",[["Frozen clause",c.resolution_clause_id]]);
  if(row.amendments.length&&!c.resolution_edition_id)content+='<div class="review-next-step"><p>Wording has been applied to the working draft. Freeze the successor edition, then select its clause when recording this disposition.</p>'+button("freeze-edition","Freeze successor edition")+'</div>';
  else if(c.resolution_edition_id)content+='<div class="review-row-actions">'+button("reply","Export this response’s reply",'data-id="'+esc(d.id)+'"')+button("navigate","Review saved dispositions",'data-tab="revisions"')+'</div>';
  content+='</section>';
  content+='<details class="review-pane"><summary>Compare the reviewed edition with the current working clause</summary><div class="review-pair"><section><h4>Reviewed English</h4><div class="review-clause">'+esc(old?.body_en||"Whole-document comment")+'</div></section><section><h4>Current English</h4><div class="review-clause">'+esc(now?.body_en||"No current clause selected")+'</div></section><section lang="fr"><h4>Français examiné</h4><div class="review-clause">'+esc(old?.body_fr||"")+'</div></section><section lang="fr"><h4>Français actuel</h4><div class="review-clause">'+esc(now?.body_fr||"")+'</div></section></div></details>';
  if(row.amendments.length)content+='<section class="review-pane"><h3>Applied wording history</h3>'+table(["Amendment","Rationale","Saved resulting clause"],row.amendments.map((a,i)=>[
   button("record","Inspect amendment "+(i+1),'data-collection="review_amendments" data-id="'+esc(a.id)+'"'),esc(a.rationale),metadata("Clause identity",[["Amendment",a.id],["SHA-256",a.after_sha256]])
  ]))+'</section>';
 }else content+=empty("Select a comment from the queue.");
 holder.innerHTML=content+'</article></div></section>';
}
function focusComment(){const heading=root().querySelector("#review-comment-heading");heading?.focus({preventScroll:true});if(window.matchMedia("(max-width:650px)").matches)heading?.scrollIntoView({block:"start"});}
async function dispatch(el){
 if(el.disabled)return;
 const action=el.dataset.review;
 if(action==="tab"||action==="navigate"){state().tab=el.dataset.tab;render();if(state().tab==="responses"&&state().responseId)await showResponse(state().responseId);}
 else if(action==="packet")await packetDialog();
 else if(action==="receive"||action==="navigate-receive")await receiveDialog(el.dataset.id);
 else if(action==="new-consultation")context.newRecord("consultations");
 else if(action==="freeze-edition"||action==="navigate-freeze")context.workflow("edition.freeze");
 else if(action==="publication")context.openSection("publication");
 else if(action==="refresh")await context.refresh();
 else if(action==="record")await context.openRecord(el.dataset.collection,el.dataset.id);
 else if(action==="source")await context.openSource(el.dataset.id);
 else if(action==="response"||action==="related-response"){state().tab="responses";await showResponse(el.dataset.id);}
 else if(action==="comment"){state().commentId=el.dataset.id;renderDetail();focusComment();}
 else if(action==="comment-queue"){root().querySelector(".review-comment-sidebar")?.scrollIntoView({block:"start"});root().querySelector('[data-review-filter="comments"] input[name="query"]')?.focus({preventScroll:true});}
 else if(action==="close-response"){state().responseId=null;state().detail=null;state().detailRevision=null;state().commentId=null;render();}
 else if(action==="reply")window.location.assign(downloadLink("review_response",el.dataset.id));
 else if(action==="replies"){state().tab="responses";state().responseQuery="";state().responseStatus="all";state().page=0;render();}
 else if(action==="amend")await amendmentDialog(el.dataset.id);
 else if(action==="resolve"||action==="resolve-existing")await resolutionDialog(el.dataset.id);
 else if(action==="carry"||action==="carry-preview")await carryDialog(el.dataset.id);
 else if(action==="comment-step"){
  const rows=filteredComments(),index=rows.findIndex(r=>r.comment.id===state().commentId),next=rows[index+Number(el.dataset.delta)];
  if(next){state().commentId=next.comment.id;state().commentPage=Math.floor(rows.indexOf(next)/PAGE_SIZE);renderDetail();focusComment();}
 }else if(action==="next-open"){
  const next=nextOpenComment();
  if(next){resetCommentFilters();state().commentStatus="attention";state().commentId=next.comment.id;state().commentPage=Math.floor(filteredComments().findIndex(r=>r.comment.id===next.comment.id)/PAGE_SIZE);renderDetail();focusComment();}
 }else if(action==="clear-filters"){
  const list=el.dataset.list;
  if(list==="comments"){resetCommentFilters();state().commentPage=Math.max(0,Math.floor(filteredComments().findIndex(r=>r.comment.id===state().commentId)/PAGE_SIZE));renderDetail();}
  else{if(list==="responses")Object.assign(state(),{responseQuery:"",responseStatus:"all",responseSort:"newest",page:0});else if(list==="packets")Object.assign(state(),{packetQuery:"",packetPage:0});else Object.assign(state(),{resolutionQuery:"",resolutionState:"all",resolutionPage:0});render();}
 }else if(action==="page"){
  const list=el.dataset.list||"responses",key={responses:"page",comments:"commentPage",packets:"packetPage",resolutions:"resolutionPage"}[list];
  if(!key)return;
  state()[key]=Math.max(0,state()[key]+Number(el.dataset.delta));
  if(list==="comments"){state().commentId=filteredComments()[state().commentPage*PAGE_SIZE]?.comment.id||state().commentId;renderDetail();}else render();
 }
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
