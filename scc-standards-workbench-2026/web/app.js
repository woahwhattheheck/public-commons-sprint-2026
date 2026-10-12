const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const clone=v=>structuredClone(v),pretty=v=>JSON.stringify(v,null,2),same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const label=s=>String(s).replaceAll("_"," ").replace(/\b[a-z]/g,c=>c.toUpperCase());
const short=(v,n=120)=>String(v??"").length>n?String(v).slice(0,n)+"…":String(v??"");
const uid=()=>crypto.randomUUID();
const isoDate=()=>new Date().toISOString().slice(0,10);
const fullDate=()=>new Date().toISOString();
const badge=s=>'<span class="badge">'+esc(label(s??"not recorded"))+'</span>';
const money=s=>new Intl.NumberFormat("en-CA",{style:"currency",currency:"CAD"}).format(Number(s??0));
const titleOf=r=>r?.title_en||r?.title||r?.label||r?.name||r?.number||r?.identifier||r?.id||"";
let catalog=null,project=null,projects=[],section="overview",subsection={},clauseId=null,editor=null,noticeTimer=null,renderEpoch=0,listOffset=0,listCache=null;
const GROUPS=[
 ["Project",[["overview","Overview"],["scope","Scope & references"],["sources","Original sources"]]],
 ["Standard",[["draft","Draft & languages"],["review","Review comments"],["ballots","Ballots & decisions"],["publication","Publication & maintenance"]]],
 ["Delivery",[["delivery","Phases & reports"],["finance","Costs & invoices"],["procedure","People & procedures"],["history","Development history"]]]
];
const COLLECTIONS_BY_SECTION={
 scope:["scope","references"],sources:["sources"],draft:["clauses","editions","cases","language_reviews"],
 review:["comments","consultations"],ballots:["ballots","votes","ballot_closures","technical_decisions","procedural_reviews"],
 publication:["publications","maintenance","uptake"],delivery:["tasks","deliverables","communications","delivery_registers","phase_reports","report_responses","ola_events","changes"],
 finance:["funding","costs","invoices","invoice_responses","payments"],procedure:["people","memberships","procedures","disclosures"]};
const COLLECTION_TITLES={scope:"Scope",sources:"Original sources",references:"Related standards",clauses:"Paired clauses",editions:"Frozen editions",cases:"Worked cases",
 language_reviews:"Language reviews",comments:"Comment dispositions",consultations:"Consultations",ballots:"Edition-bound ballots",votes:"Recorded votes",
 ballot_closures:"Ballot decisions",technical_decisions:"Peer / workshop / community decisions",procedural_reviews:"Independent procedural reviews",publications:"Publication records",maintenance:"Maintenance",
 uptake:"Recorded use",tasks:"Delivery tasks",deliverables:"SCC deliverables",phase_reports:"Frozen phase reports",report_responses:"SCC report responses",
 communications:"SCC communications",delivery_registers:"Scope & invoice registers",ola_events:"Official-language services",changes:"Schedule & contract changes",funding:"Funding agreement",costs:"Costs",invoices:"Prepared invoices",
 invoice_responses:"Invoice responses",payments:"Collected payments",people:"People",memberships:"Committee membership",procedures:"Procedural profiles",disclosures:"Disclosures & complaints"};
const REFS={procedure_id:"procedures",source_procedure_id:"procedures",edition_id:"editions",resolution_edition_id:"editions",comparison_edition_id:"editions",
 publication_id:"publications",closure_id:"ballot_closures",reviewer_id:"people",person_id:"people",author_id:"people",ballot_id:"ballots",
 report_id:"phase_reports",response_id:"report_responses",invoice_id:"invoices",clause_id:"clauses",consultation_id:"consultations",
 comment_id:"comments",source_id:"sources",procedural_review_id:"procedural_reviews"};
const LIST_REFS={consultation_ids:"consultations",source_ids:"sources",evidence_ids:"sources",substantiation_ids:"sources",acceptance_source_ids:"sources",authority_source_ids:"sources",
 agreement_source_ids:"sources",appointment_source_ids:"sources",exception_source_ids:"sources",sponsor_endorsement_source_ids:"sources",
 materials_en_source_ids:"sources",materials_fr_source_ids:"sources",contributor_ids:"people",participant_ids:"people",membership_ids:"memberships",
 dependencies:"tasks",case_ids:"cases",scope_deliverable_ids:"deliverables",content_source_ids:"sources",submission_source_ids:"sources",response_source_ids:"sources",calendar_source_ids:"sources"};
const LONG_FIELDS=new Set(["body","body_en","body_fr","purpose","purpose_fr","preface_en","preface_fr","rationale","summary","instruction","description",
 "national_international_relationship","negative_resolution","exception_rationale","calendar_basis","notes","audience","audience_fr","exclusions","exclusions_fr","services_provided","interpretation_source"]);
function notify(message){$("#notice").textContent=message;$("#notice").classList.add("visible");clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>$("#notice").classList.remove("visible"),6500);}
async function api(path,options={}){
 const res=await fetch(path,{...options,headers:{"Content-Type":"application/json",...(options.headers||{})}});
 let data;try{data=await res.json();}catch{throw Error("The application response could not be read.");}
 if(!res.ok){const e=Error(data.error||"Operation failed.");e.status=res.status;e.data=data;throw e;}return data;
}
const endpoint=()=>"/api/projects/"+encodeURIComponent(project.id);
async function loadAll(id=project?.id){
 projects=await api("/api/projects");const picker=$("#project-picker");
 picker.innerHTML='<option value="">Choose a project</option>'+projects.map(p=>'<option value="'+esc(p.id)+'">'+esc(p.title)+'</option>').join("");
 if(id&&projects.some(p=>p.id===id)){project=await api("/api/projects/"+encodeURIComponent(id));picker.value=id;localStorage.setItem("standards-project",id);}
 else{project=null;picker.value="";}
 listCache=null;await render();
}
function projectHeading(title,description,actions=""){
 return '<div class="heading"><div><p class="eyebrow">'+esc(project.title)+' · r'+project.revision+'</p><h1>'+esc(title)+'</h1><p>'+esc(description)+'</p>'+
 (project.mode!=="working"?'<span class="truth-label">'+esc(project.mode==="authored_example"?"Authored workflow example — fictional people, decisions and financial records":"Public source example — authored proposed clauses, no standards-body approval")+'</span>':"")+
 '</div><div class="toolbar">'+actions+'</div></div>';
}
function nav(){
 $("#nav").innerHTML=GROUPS.map(([group,items])=>'<span class="nav-group">'+esc(group)+'</span>'+items.map(([key,name])=>'<button data-section="'+key+'" class="'+(section===key?"active":"")+'" aria-current="'+(section===key?"page":"false")+'">'+esc(name)+'</button>').join("")).join("");
}
function stats(items){return '<div class="stats">'+items.map(([value,name])=>'<div class="stat"><strong>'+esc(value)+'</strong><span>'+esc(name)+'</span></div>').join("")+'</div>';}
function panel(title,body){return '<section class="panel"><h2>'+esc(title)+'</h2>'+body+'</section>';}
function empty(message,button=""){return '<div class="empty"><p>'+esc(message)+'</p>'+button+'</div>';}
function actionButton(action,text,extra="",primary=false){return '<button data-action="'+esc(action)+'" '+extra+' class="'+(primary?"primary":"")+'">'+esc(text)+'</button>';}
function refName(collection,id){return titleOf(project?.[collection]?.find(r=>r.id===id))||id||"—";}
function textValue(v){return typeof v==="object"?pretty(v):String(v??"");}
function table(headers,rows){return '<div class="table-wrap"><table><thead><tr>'+headers.map(h=>'<th>'+esc(h)+'</th>').join("")+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+r.map(c=>'<td>'+c+'</td>').join("")+'</tr>').join("")+'</tbody></table></div>';}
function currentCollection(){const allowed=COLLECTIONS_BY_SECTION[section]||[];return allowed.includes(subsection[section])?subsection[section]:allowed[0];}
function subtabs(collections,current){return '<div class="subtabs">'+collections.map(c=>'<button data-collection="'+c+'" class="'+(c===current?"active":"")+'">'+esc(COLLECTION_TITLES[c])+' <small>'+esc(project.collection_counts[c]??0)+'</small></button>').join("")+'</div>';}
async function render(){
 nav();if(!project){$("#main").innerHTML=empty("Create a standards project or open the original Canadian source example.",actionButton("public-demo","Open source example")+actionButton("new-project","Create project"));return;}
 const epoch=++renderEpoch;
 if(section==="overview")return renderOverview();
 if(section==="history")return renderHistory(epoch);
 if(section==="draft"&&currentCollection()==="clauses")return renderDraft();
 if(section==="sources")return renderSources();
 const collection=currentCollection();let rows=project[collection]||[];
 if(listOffset||project.collection_counts[collection]>200){
  if(!listCache||listCache.collection!==collection||listCache.offset!==listOffset||listCache.revision!==project.revision){
   const page=await api(endpoint()+"/records/"+collection+"?offset="+listOffset+"&limit=100");
   if(epoch!==renderEpoch)return;listCache=page;
  }
  rows=listCache.rows;
 }
 renderCollection(collection,rows);
}
function renderOverview(){
 const a=project.analysis,reviewed=a.languages.filter(r=>r.review_status==="reviewed").length;
 const balance=a.live_interest_balance;
 let html=projectHeading("Standards drafting & delivery","Original sources, paired clauses, recorded committee decisions and the four SCC delivery phases.",
 actionButton("workflow","Freeze edition",'data-operation="edition.freeze"')+actionButton("export","Export documents","",true));
 html+=stats([[a.counts.clauses,"Working clauses"],[a.counts.editions,"Retained editions"],[reviewed+"/"+a.languages.length,"Paired clauses reviewed"],[money(a.collected_cad),project.mode==="authored_example"?"Authored example receipts":"Actual collected payments"]]);
 html+='<div class="grid">'+panel("Working scope",a.scope?'<h3>'+esc(a.scope.title_en)+'</h3><p>'+esc(a.scope.purpose)+'</p><div class="meta-line">'+badge(a.scope.deliverable_type)+badge(a.funding_status)+'</div>'+actionButton("edit","Edit scope",'data-collection="scope" data-id="'+esc(a.scope.id)+'"'):empty("Set the proposed standard’s scope and the source-bound procedure.",actionButton("new-record","Set scope",'data-collection="scope"')))+
 panel("Next delivery work",'<p class="compact">Next progress report: <strong>'+esc(a.next_progress_report_due||"No previous submitted phase report")+'</strong></p>'+(a.reporting_schedule?.planning_due_before_first_phase_report?'<p class="compact">Planning date before the first phase report: '+esc(a.reporting_schedule.planning_due_before_first_phase_report)+'</p>':'')+
 '<ul class="list-plain">'+project.tasks.filter(t=>!["delivered","cancelled"].includes(t.status)).slice(0,5).map(t=>'<li><strong>'+esc(t.title)+'</strong><br>Phase '+esc(t.phase)+' · '+esc(t.due||"Date not set")+' · '+esc(t.owner||"Owner not set")+'</li>').join("")+'</ul>'+actionButton("section","Open phases",'data-target="delivery"'))+'</div>';
 html+=panel("Source and procedural attention",a.findings.length?'<ul class="list-plain">'+a.findings.slice(0,10).map(f=>'<li><strong>'+esc(label(f.code))+'</strong><br>'+esc(f.message)+(f.record_id?' '+actionButton("edit","Open",'data-collection="'+esc(f.collection)+'" data-id="'+esc(f.record_id)+'"'):"")+'</li>').join("")+'</ul>':"<p>No current record gaps are reported. Authority decisions and receipt evidence remain the operator’s records.</p>");
 html+='<div class="grid">'+panel("Current committee composition",table(["Interest","Eligible voters"],Object.entries(balance.categories).map(([k,v])=>[esc(k),esc(v)]))+
 '<p class="compact">Current composition: '+esc(balance.eligible)+' eligible. '+esc(balance.balanced?"Recorded categories satisfy the DGSI balance formula.":"DGSI category balance is not currently established.")+' A frozen ballot retains its own roster and applicable profile.</p>')+
 panel("Retained work",'<p>Edits create an atomic project revision. Frozen editions, ballots, reports and financial receipts keep the exact content they concern. Later source edits remain visible without changing historical votes.</p><p>Complete private continuation ZIPs include original bytes and development history. Selected edition packages include only the chosen public text and explicitly selected source originals.</p>'+actionButton("section","View development history",'data-target="history"'))+'</div>';
 $("#main").innerHTML=html;
}
function renderDraft(){
 const clauses=[...project.clauses].sort((a,b)=>a.number.localeCompare(b.number,undefined,{numeric:true}));
 if(!clauses.some(c=>c.id===clauseId))clauseId=clauses[0]?.id;
 const clause=clauses.find(c=>c.id===clauseId);
 let html=projectHeading("Draft & paired languages","Edit the actual clause text, retain stable numbering and compare the English and French work at each edition.",
 actionButton("new-record","Add clause",'data-collection="clauses"')+actionButton("workflow","Freeze edition",'data-operation="edition.freeze"',true));
 html+=subtabs(COLLECTIONS_BY_SECTION.draft,"clauses");
 if(!clause){$("#main").innerHTML=html+empty("Add the first paired clause or open the Canadian source example.");return;}
 const lang=project.analysis.languages.find(l=>l.clause_id===clause.id);
 html+='<div class="clause-layout"><aside class="outline" aria-label="Clause outline">'+clauses.map(c=>'<button data-clause="'+esc(c.id)+'" class="'+(c.id===clauseId?"selected":"")+'">'+esc(c.number)+' · '+esc(c.title_en)+'</button>').join("")+'</aside><article class="clause-card">';
 html+='<div class="toolbar"><span class="eyebrow">Clause '+esc(clause.number)+' · '+esc(clause.kind)+'</span><div class="right">'+actionButton("edit","Edit paired text",'data-collection="clauses" data-id="'+esc(clause.id)+'"')+' '+actionButton("workflow","Record language review",'data-operation="language.record" data-clause-id="'+esc(clause.id)+'"')+'</div></div>';
 html+='<div class="pair"><div><p class="eyebrow">English</p><h2>'+esc(clause.title_en)+'</h2><div class="prose">'+esc(clause.body_en)+'</div>'+clauseTable(clause.table_en)+'</div><div lang="fr"><p class="eyebrow">Français</p><h2>'+esc(clause.title_fr||"Titre à renseigner")+'</h2><div class="prose">'+esc(clause.body_fr||"Texte français non renseigné.")+'</div>'+clauseTable(clause.table_fr)+'</div></div>';
 html+='<div class="meta-line">'+badge(lang?.review_status)+(lang?.french_present?"":badge("French text incomplete"))+'</div><dl class="definition"><dt>Stable clause identity</dt><dd>'+esc(clause.id)+'</dd><dt>Linked sources</dt><dd>'+clause.source_ids.map(id=>'<button class="details-button" data-action="source" data-id="'+esc(id)+'">'+esc(refName("sources",id))+'</button>').join("; ")+'</dd></dl>';
 if(clause.case_ids.length)html+='<h3>Worked source cases</h3>'+clause.case_ids.map(id=>actionButton("case","Open "+refName("cases",id),'data-id="'+esc(id)+'"')).join(" ");
 if(clause.notes)html+='<details><summary>Working notes</summary><p class="compact">'+esc(clause.notes)+'</p></details>';
 html+='</article></div>';$("#main").innerHTML=html;
}
function clauseTable(rows){
 if(!rows?.length)return"";
 return '<div class="table-wrap"><table><tbody>'+rows.map((r,i)=>'<tr>'+r.map(c=>i?'<td>'+esc(c)+'</td>':'<th>'+esc(c)+'</th>').join("")+'</tr>').join("")+'</tbody></table></div>';
}
const COLS={
 scope:["title_en","deliverable_type","procedure_id"],references:["identifier","title","relationship","stage"],
 sources:["title","publisher","version","representation"],editions:["label","frozen_at","sha256"],
 cases:["title","authored","source_ids"],language_reviews:["clause_id","reviewer_id","decision","recorded_at"],
 comments:["body","edition_id","disposition","author_label"],consultations:["title","edition_id","opens","closes"],
 ballots:["title","edition_id","opens","closes"],votes:["ballot_id","person_id","choice","justification"],
 ballot_closures:["ballot_id","recorded_decision","authority","recorded_at"],technical_decisions:["edition_id","method","decision","authority"],procedural_reviews:["closure_id","reviewer_id","decision","recorded_at"],
 publications:["version","edition_id","status","maintenance_due"],maintenance:["title","kind","due","status"],uptake:["publication_id","measure","count","period_end"],
 tasks:["title","phase","owner","due","status"],deliverables:["title","phase","kind","status"],
 phase_reports:["title","phase","through","submitted_at"],report_responses:["report_id","decision","date","authority"],
 ola_events:["title","date","kind","unresolved_requests"],changes:["title","kind","decision","new_due"],
 funding:["title","status","base_cad","ola_cad"],costs:["title","phase","basis","category","net_cad"],
 invoices:["number","phase","net_cad","hst_cad","total_cad"],invoice_responses:["invoice_id","status","date"],
 payments:["invoice_id","kind","amount_cad","date"],people:["name","organization","development_roles"],
 memberships:["person_id","role","interest","voting","status"],procedures:["title","edition","applies_to","profile_status"],
 communications:["title","kind","phase","submitted_to_scc_on","planned_publication","scc_response"],
 delivery_registers:["title","scope_confirmed","final_invoice_register_confirmed","recorded_at"],
 disclosures:["title","kind","person_id"]
};
const FREEZE_OP={editions:"edition.freeze",language_reviews:"language.record",ballots:"ballot.open",ballot_closures:"ballot.close",
 technical_decisions:"decision.record",procedural_reviews:"procedure.review",phase_reports:"phase.freeze",report_responses:"phase.response",invoices:"invoice.prepare",
 invoice_responses:"invoice.response",payments:"payment.record",delivery_registers:"delivery.register"};
function fieldCell(name,value){
 if(REFS[name])return esc(refName(REFS[name],value));
 if(name.endsWith("_cad"))return '<span class="money">'+esc(money(value))+'</span>';
 if(typeof value==="boolean")return esc(value?"Yes":"No");
 if(Array.isArray(value))return esc(value.map(v=>LIST_REFS[name]?refName(LIST_REFS[name],v):v).join(", ")||"—");
 if(["status","disposition","decision","recorded_decision","basis","profile_status","representation"].includes(name))return badge(value);
 return esc(short(value,190)||"—");
}
function renderCollection(collection,rows){
 const descriptions={scope:"Define the proposed scope and the actual relationship to existing standards. Existing programme entries remain distinct from new proposals.",
 draft:"Frozen editions retain their own text and source versions. Later working changes never rewrite a previous edition.",
 review:"Comments stay linked to the exact clause and edition reviewed. Carrying a comment forward is an explicit action.",
 ballots:"Select the actual procedural profile and eligible roster. Raw votes, calculated criteria and authority decisions remain separate.",
 publication:"Prepare matched language documents, record real release metadata, and retain maintenance and uptake evidence.",
 delivery:"Plan and retain the four SCC delivery phases, report versions, actual responses and official-language services.",
 finance:"CAD amounts exclude HST until an invoice records it separately. Estimated costs, accepted reports, invoices and cleared payments are distinct.",
 procedure:"Use real participants, source-bound profiles, recorded appointments and disclosures. Authored example people are labeled."};
 const newButton=FREEZE_OP[collection]?actionButton("workflow","Add "+label(collection.replace(/s$/,"")),'data-operation="'+FREEZE_OP[collection]+'"',true):
 actionButton("new-record","Add "+label(collection.replace(/s$/,"")),'data-collection="'+collection+'"',true);
 let html=projectHeading(COLLECTION_TITLES[collection],descriptions[section]||"",newButton);
 if(section==="delivery")html+=phaseCards();
 if(section==="finance")html+=stats([[money(project.analysis.collected_cad),project.mode==="authored_example"?"Authored example receipts":"Collected payments"],
 [project.analysis.funding_status,"Funding status"],[project.invoices.length,"Prepared invoices"],[project.report_responses.filter(r=>r.decision==="accepted").length,"Accepted report records"]]);
 html+=subtabs(COLLECTIONS_BY_SECTION[section],collection);
 html+='<div class="toolbar"><input id="record-filter" placeholder="Filter these records" aria-label="Filter records"><span class="muted compact">'+esc(project.collection_counts[collection])+' retained records</span></div>';
 const cols=COLS[collection]||["title","id"];
 const tableRows=rows.map(r=>{
  const cells=cols.map((key,i)=>'<div class="'+(!i?"cell-title":"")+'">'+fieldCell(key,r[key])+'</div>');
  let actions=actionButton("edit",catalog.immutable.includes(collection)?"View":"Edit",'data-collection="'+collection+'" data-id="'+esc(r.id)+'"');
  if(collection==="editions")actions+=actionButton("compare","Compare",'data-id="'+esc(r.id)+'"')+actionButton("export","Documents",'data-edition-id="'+esc(r.id)+'"');
  if(collection==="ballots")actions+=actionButton("ballot","Calculation",'data-id="'+esc(r.id)+'"')+(project.ballot_closures.some(c=>c.ballot_id===r.id)?"":actionButton("workflow","Close",'data-operation="ballot.close" data-ballot-id="'+esc(r.id)+'"'));
  if(collection==="comments")actions+=actionButton("workflow","Carry forward",'data-operation="comment.carry" data-comment-id="'+esc(r.id)+'"');
  if(collection==="cases")actions+=actionButton("case","Source rows",'data-id="'+esc(r.id)+'"');
  cells.push(actions);return cells;
 });
 html+=rows.length?table([...cols.map(label),"Actions"],tableRows):empty("No records in this collection.");
 const total=project.collection_counts[collection],shown=rows.length;
 html+='<div class="pagination"><span>'+esc(total?listOffset+1:0)+'–'+esc(listOffset+shown)+' of '+esc(total)+'</span><div>'+
 '<button data-action="prev-page" '+(listOffset?"":"disabled")+'>Previous</button> <button data-action="next-page" '+(listOffset+shown<total?"":"disabled")+'>Next</button></div></div>';
 if(collection==="communications")html+=communicationPanel();
 if(collection==="delivery_registers")html+=completionPanel();
 if(collection==="invoices"&&project.analysis.invoices.length)html+=panel("Collection state",table(["Invoice","Status","Invoice total","Collected","Remaining"],project.analysis.invoices.map(r=>[esc(r.number),badge(r.status),esc(money(r.total_cad)),esc(money(r.collected_cad)),esc(money(r.remaining_cad))])));
 $("#main").innerHTML=html;
 $("#record-filter")?.addEventListener("input",e=>{const q=e.target.value.toLocaleLowerCase();$$("main table tbody tr").forEach(tr=>tr.hidden=!tr.textContent.toLocaleLowerCase().includes(q));});
}
function communicationPanel(){
 const rows=project.analysis.communication_reviews||[];
 return panel("Recorded review and launch timing",rows.length?table(["Communication","SCC submission","Review interval","Actual response"],rows.map(r=>[
 esc(r.title),esc(r.submitted_on||"Not recorded")+"<div class=\"row-note\">"+esc(r.submission_evidence_recorded?"Source retained":"Submission evidence missing")+"</div>",
 r.review_link_dispatch?esc(label(r.review_link_dispatch.timing))+"<div class=\"row-note\">Launch: "+esc(r.review_link_dispatch.launch_on||"Not set")+"</div>":
 r.mandatory_notice_exception_supported?"Supported mandatory-notice exception":
 esc(r.provisional_review_ready_on||"Set submission date")+"<div class=\"row-note\">"+esc(r.calendar_status==="selected_calendar"?"15 business days under selected calendar":"Weekday estimate; select an actual calendar basis")+"</div>",
 badge(r.scc_response)
 ])):"<p>Record the actual SCC submission and the selected business-day calendar. Mandatory accredited-process notices retain their own supported exception. Public-review link dispatches are recorded against the actual launch date.</p>");
}
function completionPanel(){
 const c=project.analysis.completion||{};
 return panel("Scope and final invoice closure",stats([[c.scope_binding_current?"Current":"Needs record","Confirmed scope"],
 [(c.not_completed_deliverable_ids||[]).length,"Scope deliverables awaiting completion"],
 [c.final_invoice_register_confirmed&&c.invoice_register_current?"Current":"Needs record","Final invoice register"],
 [(c.unsubmitted_invoice_ids||[]).length,"Invoices awaiting recorded submission"]])+
 "<p>"+esc(c.recorded_closeout_conditions_met?"The recorded scope deliverables and final invoice submissions satisfy the local closeout calculation.":"Closeout follows the confirmed scope deliverables and all invoice submissions. A calendar finish date does not complete the project.")+"</p>");
}
function phaseCards(){
 return '<div class="phase-cards">'+project.analysis.phases.map(p=>'<div class="phase-card"><p class="eyebrow">Phase '+esc(p.phase)+'</p><h3>'+esc(p.title)+'</h3><div class="big">'+esc(p.agreed_base_cad===null?"—":money(p.agreed_base_cad))+'</div><small>Agreed base amount</small><p class="compact">Actual base: '+esc(money(p.costs_cad.actual.base))+'<br>Actual OLA: '+esc(money(p.costs_cad.actual.ola))+'<br>'+esc(p.delivered_tasks)+' / '+esc(p.tasks)+' tasks delivered<br>'+esc(p.cash_release_conditions?.conditions_recorded?'Received-deliverable and accepted-report basis recorded':'Cash basis: received deliverables + accepted phase report')+'</p>'+actionButton("workflow","Prepare report",'data-operation="phase.freeze" data-phase="'+p.phase+'"')+'</div>').join("")+'</div>';
}
function renderSources(){
 let html=projectHeading("Original sources","Retain exact files and explicit source versions. Inspect CSV, JSON, XLSX, Word paragraphs and tables, or text before adopting mapped records.",actionButton("upload","Add original file","",true)+actionButton("new-record","Add reference link",'data-collection="sources"'));
 html+=stats([[project.sources.length,"Source records"],[project.files.length,"Retained original files"],[project.files.reduce((n,f)=>n+f.bytes,0).toLocaleString(),"Original bytes"],[project.imports.length,"Saved import mappings"]]);
 html+=table(["Source","Representation & permission","Original identity","Actions"],project.sources.map(s=>{
  const f=project.files.find(r=>r.id===s.source_file_id);
  return ['<strong>'+esc(s.title)+'</strong><div class="row-note">'+esc(s.publisher)+' · '+esc(s.version)+'</div>',badge(s.representation)+'<div class="row-note">Citation: '+esc(s.citation_visibility)+' · Original redistribution: '+(s.public_redistribution?"enabled":"not enabled")+'</div>',
   f?'<span class="compact">'+esc(f.filename)+'<br>'+esc(f.bytes.toLocaleString())+' bytes<br>'+esc(f.sha256.slice(0,24))+'…</span>':'<span class="muted">Reference metadata only</span>',
   actionButton("edit","Edit metadata",'data-collection="sources" data-id="'+esc(s.id)+'"')+(f? actionButton("source","Inspect / map",'data-id="'+esc(s.id)+'"')+' <a href="'+endpoint()+'/files/'+encodeURIComponent(f.id)+'" download>Original</a>':"")];
 }));
 html+=panel("Source-bound imports",project.imports.length?'<ul class="list-plain">'+project.imports.slice(-10).map(i=>'<li><strong>'+esc(refName("sources",i.source_id))+'</strong><br>'+esc(i.record_ids.length)+' records · '+esc(i.specification.collection)+' · '+esc(i.at)+'</li>').join("")+'</ul>':'<p>Choose an original and inspect its actual source cells. A saved mapping records the file hash, table, original row and imported identity. Repeated unchanged imports are reused; local edits are preserved.</p>');
 $("#main").innerHTML=html;
}
async function renderHistory(epoch){
 $("#main").innerHTML=projectHeading("Development history","Perpetual development records include exact before/after changes and a hash-linked operation history.")+empty("Loading retained revisions…");
 const page=await api(endpoint()+"/history?offset="+listOffset+"&limit=100");if(epoch!==renderEpoch)return;
 $("#main").innerHTML=projectHeading("Development history","Every accepted operation is atomic. Corrections remain in history; the workspace does not hold certification records.")+
 table(["Revision","When / operator","Operation","Identity","Details"],page.rows.map(e=>[esc(e.revision),esc(e.at)+'<div class="row-note">'+esc(e.actor)+'</div>',esc(e.operation),'<span class="compact">'+esc(e.sha256.slice(0,18))+'…</span>',actionButton("history-item","View changes",'data-index="'+e.revision+'"')]))+
 '<div class="pagination"><span>'+esc(page.total)+' revisions</span><div>'+actionButton("prev-page","Previous",listOffset?"":"disabled")+" "+actionButton("next-page","Next",listOffset+page.rows.length<page.total?"":"disabled")+'</div></div>';
 listCache={history:page.rows};
}

function referenceOptions(collection,value=""){
 const rows=project?.[collection]||[];
 return '<option value="">Choose…</option>'+rows.map(r=>'<option value="'+esc(r.id)+'" '+(r.id===value?"selected":"")+'>'+esc(short(titleOf(r),95))+'</option>').join("")+
 (value&&!rows.some(r=>r.id===value)?'<option selected value="'+esc(value)+'">'+esc(value)+'</option>':"");
}
function choicesControl(name,collection,values=[]){
 return '<div class="choices" data-list-field="'+esc(name)+'">'+(project?.[collection]||[]).map(r=>{
  const caption=collection==="memberships"?refName("people",r.person_id)+" · "+r.interest+" · "+r.role:titleOf(r);
  return '<label><input type="checkbox" value="'+esc(r.id)+'" '+(values?.includes(r.id)?"checked":"")+'>'+esc(caption)+'</label>';
 }).join("")+'</div>';
}
function editableTable(name,rows){
 return '<div data-table-editor="'+esc(name)+'"><div class="table-wrap"><table><tbody>'+rows.map((r,i)=>'<tr data-edit-row="'+i+'">'+r.map((c,j)=>'<td><textarea data-cell="'+i+':'+j+'" rows="2">'+esc(c)+'</textarea></td>').join("")+'<td class="actions"><button type="button" data-action="table-remove-row" data-table="'+esc(name)+'" data-row="'+i+'">Remove row</button></td></tr>').join("")+'</tbody></table></div><div class="toolbar">'+
 '<button type="button" data-action="table-add-row" data-table="'+esc(name)+'">Add row</button><button type="button" data-action="table-add-column" data-table="'+esc(name)+'">Add column</button></div><small>Each cell preserves its own text, including line breaks. First row is rendered as the table header.</small></div>';
}
function fieldControl(name,spec,value){
 let inner="",kind=spec.kind,caption=name==="acceptance_source_ids"?"Receipt / acceptance sources":name==="summary"&&editor?.operation==="phase.freeze"?"Progress, risks and report narrative":label(name),full=LONG_FIELDS.has(name)||kind==="json"||kind==="list"||["table_en","table_fr"].includes(name);
 if(name==="id"||name==="revision")return"";
 if(kind==="boolean")return '<label class="field check"><input type="checkbox" data-field="'+esc(name)+'" '+(value?"checked":"")+'><span>'+esc(caption)+'</span></label>';
 if(["table_en","table_fr"].includes(name))inner=editableTable(name,value||[]);
 else if(name==="phase_amounts"){
  inner='<div class="amount-grid">'+["1","2","3","4"].map(p=>'<label><small>Phase '+p+' CAD</small><input inputmode="decimal" data-phase-amount="'+p+'" value="'+esc(value?.[p]??"0.00")+'"></label>').join("")+'</div>';
 }else if(["affirmative_fraction","negative_fraction_max"].includes(name)){
  inner='<label class="compact"><input type="checkbox" data-ratio-enabled="'+esc(name)+'" '+(value?"checked":"")+'> Apply this ratio</label><div class="fractions"><input type="number" min="0" data-ratio-numerator="'+esc(name)+'" value="'+esc(value?.numerator??0)+'" aria-label="Numerator"><span>/</span><input type="number" min="1" data-ratio-denominator="'+esc(name)+'" value="'+esc(value?.denominator??1)+'" aria-label="Denominator"></div>';
 }else if(kind==="reference"||REFS[name]&&kind==="text"){
  inner='<select data-field="'+esc(name)+'" '+(spec.required?"required":"")+'>'+referenceOptions(spec.collection||REFS[name],value)+'</select>';
 }else if(kind==="enum"){
  inner='<select data-field="'+esc(name)+'">'+spec.values.map(v=>'<option value="'+esc(v)+'" '+(v===value?"selected":"")+'>'+esc(label(v))+'</option>').join("")+'</select>';
 }else if(kind==="list"&&LIST_REFS[name]){
  inner=choicesControl(name,LIST_REFS[name],value||[]);
 }else if(kind==="list"){
  inner='<textarea data-field="'+esc(name)+'" rows="3" placeholder="One value per line">'+esc((value||[]).join("\n"))+'</textarea><small>One value per line'+(name==="roadmap_issues"?" · eligible call issue numbers":"")+'.</small>';
 }else if(kind==="json"){
  inner='<textarea class="code" data-field="'+esc(name)+'" spellcheck="false">'+esc(pretty(value))+'</textarea><small>Preserve the structured source or record as JSON.</small>';
 }else if(LONG_FIELDS.has(name)){
  inner='<textarea data-field="'+esc(name)+'" class="'+(["body_en","body_fr"].includes(name)?"long":"")+'" '+(spec.required?"required":"")+'>'+esc(value??"")+'</textarea>';
 }else{
  const type=kind==="date"?"date":kind==="integer"?"number":"text";
  inner='<input type="'+type+'" data-field="'+esc(name)+'" value="'+esc(value??"")+'" '+(spec.required?"required":"")+' '+(["money","signed_money","decimal"].includes(kind)?'inputmode="decimal"':"")+'>';
 }
 return '<label class="field '+(full?"full":"")+'"><span>'+esc(caption)+(spec.required?" *":"")+'</span>'+inner+'</label>';
}
function readTable(name){
 const holder=$('[data-table-editor="'+CSS.escape(name)+'"]');if(!holder)return[];
 return [...holder.querySelectorAll("tr[data-edit-row]")].map(tr=>[...tr.querySelectorAll("textarea[data-cell]")].map(i=>i.value));
}
function readField(name,spec){
 if(["table_en","table_fr"].includes(name))return readTable(name);
 if(name==="phase_amounts")return Object.fromEntries(["1","2","3","4"].map(p=>[p,$('[data-phase-amount="'+p+'"]').value]));
 if(["affirmative_fraction","negative_fraction_max"].includes(name)){
  if(!$('[data-ratio-enabled="'+name+'"]').checked)return null;
  return {numerator:Number($('[data-ratio-numerator="'+name+'"]').value),denominator:Number($('[data-ratio-denominator="'+name+'"]').value)};
 }
 if(spec.kind==="list"&&LIST_REFS[name])return [...$('[data-list-field="'+CSS.escape(name)+'"]').querySelectorAll("input:checked")].map(i=>i.value);
 const input=$('[data-field="'+CSS.escape(name)+'"]');if(!input)return clone(spec.default);
 const value=input.value;
 if(spec.kind==="boolean")return input.checked;
 if(spec.kind==="date")return value||null;
 if(spec.kind==="integer")return value===""&&spec.default===null?null:Number(value);
 if(spec.kind==="decimal"&&value===""&&spec.default===null)return null;
 if(spec.kind==="json")return JSON.parse(value);
 if(spec.kind==="list")return value.split("\n").map(s=>s.trim()).filter(Boolean).map(s=>name==="roadmap_issues"?Number(s):s);
 return value;
}
function workflowSpec(operation,template){
 const spec={};
 for(const [name,value]of Object.entries(template)){
  let kind=Array.isArray(value)?"list":value&&typeof value==="object"?"json":typeof value==="boolean"?"boolean":"text";
  if(REFS[name])kind="reference";
  if(["opens","closes","date","issued","through"].includes(name))kind="date";
  if(name.endsWith("_cad"))kind="money";
  spec[name]={kind,default:clone(value),required:false,...(REFS[name]?{collection:REFS[name]}:{})};
  if(name==="membership_ids")spec[name]={kind:"list",default:project.memberships.filter(r=>r.status==="active").map(r=>r.id)};
  if(name==="decision")spec[name]={kind:"enum",default:value,values:operation==="language.record"?["reviewed","changes_required"]:operation==="procedure.review"?["confirmed","changes_required"]:operation==="decision.record"?["adopted","returned_for_revision","rejected","recorded_only"]:["accepted","changes_requested","rejected"]};
  if(name==="recorded_decision")spec[name]={kind:"enum",default:value,values:["recorded_only","adopted","returned_for_revision","rejected"]};
  if(name==="method")spec[name]={kind:"enum",default:value,values:operation==="decision.record"?["peer_review","workshop_agreement","community_moderation","other_recorded_method"]:["letter_ballot","recorded_meeting","online_poll"]};
  if(name==="status")spec[name]={kind:"enum",default:value,values:["submitted","accepted","queried","void"]};
  if(name==="kind")spec[name]={kind:"enum",default:value,values:["receipt","refund"]};
  if(name==="phase")spec[name]={kind:"enum",default:value,values:["1","2","3","4"]};
  if(name==="allocations")spec[name]={kind:"allocation",default:[]};
 }
 return spec;
}
function fillEditorFields(){
 const fields=Object.entries(editor.spec).filter(([name])=>!editor.hidden?.includes(name));
 $("#editor-fields").innerHTML='<div class="form-grid">'+fields.map(([name,spec])=>{
  if(spec.kind==="allocation")return '<div class="field full"><span>Accepted-report cost allocations</span><div id="invoice-allocations"><p class="muted compact">Select an accepted report to see its substantiated actual costs.</p></div></div>';
  return fieldControl(name,spec,editor.values[name]??spec.default);
 }).join("")+'</div>';
 if(editor.operation==="invoice.prepare"){
  $('[data-field="report_id"]').addEventListener("change",loadInvoiceAllocations);
  if(editor.values.report_id)loadInvoiceAllocations().catch(e=>{$("#editor-error").textContent=e.message;});
 }
}
function openDialog(){
 $("#editor-context").textContent=project?project.title+" · "+(editor.collection?COLLECTION_TITLES[editor.collection]:"Recorded workflow"):"Workspace";
 $("#editor-title").textContent=editor.title;
 $("#editor-revision").textContent=project?"Editing project revision "+editor.baseRevision:"";
 $("#editor-save").textContent=editor.operation==="record.save"?"Save changes":"Record";
 $("#editor-save").disabled=false;$("#editor-error").textContent="";$("#editor-conflict").hidden=true;
 fillEditorFields();$("#editor").showModal();
 $("#editor-fields input, #editor-fields textarea, #editor-fields select")?.focus();
}
async function editRecord(collection,id){
 const r=await api(endpoint()+"/records/"+collection+"/"+encodeURIComponent(id));
 if(catalog.immutable.includes(collection))return viewRecord(collection,r);
 editor={operation:"record.save",collection,title:"Edit "+label(collection.replace(/s$/,"")),values:clone(r),baseRecord:clone(r),
         baseRevision:project.revision,spec:catalog.collections[collection],requestId:uid(),hidden:collection==="sources"?["source_file_id","sha256"]:[]};
 openDialog();
}
function newRecord(collection){
 if(["scope","funding"].includes(collection)&&project[collection].length)return editRecord(collection,project[collection][0].id);
 if(FREEZE_OP[collection])return workflow(FREEZE_OP[collection]);
 editor={operation:"record.save",collection,title:"Add "+label(collection.replace(/s$/,"")),values:Object.fromEntries(Object.entries(catalog.collections[collection]).map(([k,s])=>[k,clone(s.default)])),
         baseRecord:null,baseRevision:project.revision,spec:catalog.collections[collection],requestId:uid(),hidden:collection==="sources"?["source_file_id","sha256"]:[]};
 if(project.mode==="authored_example"&&collection==="people")editor.values.authored_example=true;
 if(collection==="sources")editor.values.representation="reference_link";
 openDialog();
}
function workflow(operation,defaults={}){
 const template=clone(catalog.workflow_templates[operation]);if(!template)throw Error("Unknown workflow operation.");
 Object.assign(template,defaults);
 if("date"in template&&!template.date)template.date=isoDate();
 if("issued"in template&&!template.issued)template.issued=isoDate();
 if("through"in template&&!template.through)template.through=isoDate();
 editor={operation,title:label(operation.replaceAll("."," ")),values:template,baseRecord:null,baseRevision:project.revision,
         spec:workflowSpec(operation,template),requestId:uid(),hidden:[]};
 if("membership_ids"in template&&!template.membership_ids)editor.values.membership_ids=clone(editor.spec.membership_ids.default);
 openDialog();
}
function editorPayload(){
 const values=clone(editor.values);
 for(const [name,spec] of Object.entries(editor.spec)){
  if(editor.hidden?.includes(name))continue;
  if(spec.kind==="allocation"){
   values[name]=[...$("#invoice-allocations").querySelectorAll("input[data-cost-id]")].filter(i=>i.value!==""&&Number(i.value)>0).map(i=>({cost_id:i.dataset.costId,net_cad:i.value}));continue;
  }
  values[name]=readField(name,spec);
 }
 if(editor.operation==="record.save"){delete values.revision;return{collection:editor.collection,record:values};}
 return values;
}
async function loadInvoiceAllocations(){
 const reportId=$('[data-field="report_id"]').value,holder=$("#invoice-allocations");if(!reportId){holder.innerHTML="<p>Select an accepted report.</p>";return;}
 const report=await api(endpoint()+"/records/phase_reports/"+encodeURIComponent(reportId));
 if(!$("#editor").open||editor?.operation!=="invoice.prepare"||$('[data-field="report_id"]').value!==reportId)return;
 const response=project.report_responses.filter(r=>r.report_id===reportId).sort((a,b)=>(a.date||"").localeCompare(b.date||"")).at(-1);
 const costs=report.input_snapshot.costs.filter(c=>c.basis==="actual"&&c.substantiation_ids.length);
 const used={};for(const inv of project.invoices){
  if(project.analysis.invoices.find(r=>r.invoice_id===inv.id)?.status==="void")continue;
  for(const a of inv.allocations)used[a.cost_id]=(used[a.cost_id]||0)+Number(a.net_cad);
 }
 holder.innerHTML=(response?.decision!=="accepted"?'<p class="warning">This report does not have an actual accepted response. Record that response before preparing its invoice.</p>':"")+
 costs.map(c=>'<label class="allocation-row"><span><strong>'+esc(c.title)+'</strong><small>'+esc(c.category)+' · accepted report '+esc(money(c.net_cad))+' · previously allocated '+esc(money(used[c.id]||0))+'</small></span><input inputmode="decimal" data-cost-id="'+esc(c.id)+'" value="'+esc(editor.values.allocations?.find(a=>a.cost_id===c.id)?.net_cad||"")+'" placeholder="CAD allocation"></label>').join("")+
 (!costs.length?'<p class="muted">No substantiated actual cost is included in this report snapshot.</p>':"");
}
async function saveEditor(event){
 event.preventDefault();if(!editor)return;
 let payload;try{payload=editorPayload();}catch(e){$("#editor-error").textContent="Check structured fields: "+e.message;return;}
 const attempt=editor.pendingAttempt||{operation:editor.operation,payload,expected_revision:editor.baseRevision,request_id:editor.requestId,actor:"Local operator"};
 if(editor.pendingAttempt&&!same(editor.pendingAttempt.payload,payload)){$("#editor-error").textContent="The prior request has an uncertain response. Retry its original input or inspect development history before changing it.";return;}
 $("#editor-save").disabled=true;$("#editor-error").textContent="";
 try{
  const result=await api(endpoint()+"/operations",{method:"POST",body:JSON.stringify(attempt)});
  await loadAll(project.id);$("#editor").close();editor=null;notify("Recorded revision "+result.revision+".");
 }catch(e){
  if(e.status===409){
   editor.pendingAttempt=null;await presentConflict(payload,e);
  }else{
   $("#editor-error").textContent=e.message;
   if(!e.status){editor.pendingAttempt=attempt;$("#editor-error").textContent+=" The exact request identity is retained; Retry records that same operation.";}
  }
 }finally{if($("#editor-save"))$("#editor-save").disabled=false;}
}
async function presentConflict(payload,error){
 const old=clone(editor.baseRecord),fresh=await api(endpoint());
 if(editor.operation!=="record.save"||!old){
  $("#editor-error").textContent=error.message+" Current revision is "+fresh.revision+". Reopen this workflow after reviewing the changed records.";
  return;
 }
 const current=await api(endpoint()+"/records/"+editor.collection+"/"+encodeURIComponent(old.id));
 const desired=payload.record,changes=Object.keys(editor.spec).filter(k=>!same(old[k],desired[k]));
 const conflicts=changes.filter(k=>!same(old[k],current[k])&&!same(current[k],desired[k]));
 editor.conflict={current,desired,changes,conflicts,fresh};
 const box=$("#editor-conflict");box.hidden=false;
 box.innerHTML='<h3>Another edit was saved</h3><p>Your input is still present. Nonconflicting field edits can be reapplied. For fields changed in both versions, select only the values you intend to replace.</p>'+
 table(["Field","Current saved value","Your value","Use yours"],changes.map(k=>[esc(label(k)),esc(short(textValue(current[k]),350)),esc(short(textValue(desired[k]),350)),
 conflicts.includes(k)?'<input type="checkbox" data-conflict-field="'+esc(k)+'" aria-label="Use my '+esc(label(k))+'">':'<span class="muted">No overlap</span>']))+
 '<button type="button" data-action="reconcile">Apply this field selection to the current revision</button>';
}
async function reconcile(){
 const c=editor.conflict;if(!c)return;const merged=clone(c.current);
 for(const k of c.changes)if(!c.conflicts.includes(k)||$('[data-conflict-field="'+CSS.escape(k)+'"]')?.checked)merged[k]=clone(c.desired[k]);
 editor.values=merged;editor.baseRecord=clone(c.current);editor.baseRevision=c.fresh.revision;editor.requestId=uid();editor.conflict=null;editor.pendingAttempt=null;
 project=c.fresh;fillEditorFields();$("#editor-conflict").hidden=true;$("#editor-revision").textContent="Reviewed against project revision "+project.revision;
 $("#editor-error").textContent="The selected fields are ready. Review them and save.";
}
function viewRecord(collection,r){
 let body='<dl class="definition">'+Object.entries(r).filter(([k,v])=>!["snapshot","input_snapshot","profile","roster","calculation","independence_snapshot"].includes(k)).map(([k,v])=>'<dt>'+esc(label(k))+'</dt><dd>'+esc(typeof v==="object"?pretty(v):v)+'</dd>').join("")+'</dl>';
 for(const key of ["calculation","profile","roster","snapshot","input_snapshot","independence_snapshot"])if(r[key])body+='<details><summary>'+esc(label(key))+'</summary><pre>'+esc(pretty(r[key]))+'</pre></details>';
 if(collection==="editions")body=actionButton("export","Build this edition’s documents",'data-edition-id="'+esc(r.id)+'"',true)+" "+actionButton("compare","Compare with current draft",'data-id="'+esc(r.id)+'"')+body;
 showViewer(COLLECTION_TITLES[collection]+" · "+titleOf(r),body);
}
function showViewer(title,body){$("#viewer-title").textContent=title;$("#viewer-content").innerHTML=body;if(!$("#viewer").open)$("#viewer").showModal();}
async function showCase(id){
 const c=await api(endpoint()+"/records/cases/"+encodeURIComponent(id));
 let body='<h3>'+esc(c.title)+'</h3>'+(c.title_fr?'<p lang="fr">'+esc(c.title_fr)+'</p>':"")+
 '<div class="warning">Source cells are original evidence. Review questions and expected observations are authored interpretations.</div>'+
 '<h3>Review questions</h3><ol>'+c.review_questions.map(q=>'<li>'+esc(q)+'</li>').join("")+'</ol><h3>Expected observations</h3><ul>'+c.expected_observations.map(q=>'<li>'+esc(q)+'</li>').join("")+'</ul>';
 for(const row of c.source_rows||[]){
  body+='<h3>'+esc(row.language||"")+" · "+esc(refName("sources",row.source_id))+' · source record '+esc(row.csv_record??row.row_index??"")+'</h3>';
  if(row.cells)body+=table(["Original column","Original text"],row.cells.map(cell=>[esc(cell.name??cell.column),esc(cell.value)]));
  else body+='<pre>'+esc(pretty(row))+'</pre>';
 }
 showViewer("Worked source case",body);
}
async function showBallot(id){
 const b=project.analysis.ballots.find(b=>b.id===id);
 let body=stats([[b.eligible,"Eligible voters"],[b.raw.yes,"Raw affirmative"],[b.raw.no,"Raw negative"],[b.raw.abstain,"Raw abstentions"]])+
 '<p>Nonresponse: '+esc(b.nonresponse)+' · Raw blank: '+esc(b.raw.blank)+' · '+badge(b.calculated_status)+'</p>'+
 table(["Criterion","Recorded arithmetic / basis","Result"],b.criteria.map(c=>[esc(label(c.code)),
 esc(c.denominator!==undefined?String(c.numerator)+" / "+String(c.denominator)+(c.fraction?" against "+c.fraction.numerator+"/"+c.fraction.denominator:""):c.reason||"")+
 (c.alternatives?'<pre>'+esc(pretty(c.alternatives))+'</pre>':""),badge(c.satisfied===null?"source interpretation not recorded":c.satisfied?"satisfied":"not satisfied")]))+
 '<h3>Recorded authority decision</h3><p>'+esc(b.recorded_decision||"No authority decision is recorded.")+'</p>'+
 (b.records_changed_since_closure?'<p class="warning">Working comment/review records have changed since this immutable closure. The original recorded calculation remains retained.</p>':"")+
 '<p class="compact">The displayed arithmetic is a calculation of the selected procedural profile. It does not approve or publish the standard.</p>';
 if(b.excluded.length)body+=panel("Votes excluded by the selected source profile",table(["Vote","Reason"],b.excluded.map(x=>[esc(x.vote_id),esc(label(x.reason))])));
 showViewer("Ballot calculation · "+b.title,body);
}
async function compareEdition(id){
 const comparison=await api(endpoint()+"/editions/"+encodeURIComponent(id)+"/compare");
 let body='<p>Comparison of the selected frozen edition with the current working draft. Original edition text remains unchanged.</p><div class="meta-line">'+
 ["scope_changed","references_changed","source_versions_changed","cases_changed","language_reviews_changed"].map(k=>badge(label(k)+": "+(comparison[k]?"yes":"no"))).join(" ")+'</div>';
 body+=comparison.clauses.length?comparison.clauses.map(c=>'<section class="panel"><h3>'+esc(c.before?.number||c.after?.number||"")+' · '+esc(c.before?.title_en||c.after?.title_en||c.clause_id)+'</h3>'+badge(c.kind)+
 (c.fields?'<p class="compact">Changed fields: '+esc(c.fields.map(label).join(", "))+'</p>':"")+'<div class="grid"><div><p class="eyebrow">Frozen</p><pre>'+esc(pretty(c.before||null))+'</pre></div><div><p class="eyebrow">Current</p><pre>'+esc(pretty(c.after||null))+'</pre></div></div></section>').join(""):empty("No clause text or structure changed.");
 showViewer("Edition comparison",body);
}

let intakeState=null;
async function base64File(file){
 const data=new Uint8Array(await file.arrayBuffer());let binary="";
 for(let i=0;i<data.length;i+=24576)binary+=String.fromCharCode(...data.subarray(i,i+24576));
 return btoa(binary);
}
function uploadDialog(){
 showViewer("Retain an original source",'<form id="upload-form"><div class="form-grid"><label class="field"><span>Original file</span><input id="upload-file" type="file" required></label>'+
 '<label class="field"><span>Source title</span><input id="upload-title"></label><label class="field"><span>Publisher</span><input id="upload-publisher"></label>'+
 '<label class="field"><span>Original URL</span><input id="upload-url" type="url"></label><label class="field"><span>Version / source period</span><input id="upload-version"></label>'+
 '<label class="field"><span>Language</span><select id="upload-language"><option>unspecified</option><option>en</option><option>fr</option><option>bilingual</option><option>other</option></select></label>'+
 '<label class="field"><span>License or usage terms</span><input id="upload-license"></label><label class="field check"><input id="upload-public-citation" type="checkbox"><span>This source metadata may be cited publicly</span></label>'+
 '<label class="field check"><input id="upload-redistribution" type="checkbox"><span>Original bytes may be redistributed in a selected publication package</span></label></div>'+
 '<p class="compact">The exact original bytes remain unchanged. A revised source is added as a distinct source identity. One file may be up to32MiB.</p><p id="upload-error" role="alert"></p><button type="submit" class="primary">Retain original</button></form>');
 $("#upload-form").addEventListener("submit",async e=>{
  e.preventDefault();const file=$("#upload-file").files[0];if(!file)return;
  if(file.size>32*1024*1024){$("#upload-error").textContent="Choose an original of at most32MiB.";return;}
  const button=e.submitter;button.disabled=true;
  try{
   const result=await api(endpoint()+"/operations",{method:"POST",body:JSON.stringify({operation:"source.add",expected_revision:project.revision,request_id:uid(),actor:"Local operator",
    payload:{filename:file.name,content_base64:await base64File(file),metadata:{title:$("#upload-title").value||file.name,publisher:$("#upload-publisher").value,url:$("#upload-url").value,
      version:$("#upload-version").value,language:$("#upload-language").value,license:$("#upload-license").value,representation:"original_bytes",
      citation_visibility:$("#upload-public-citation").checked?"public":"internal",public_redistribution:$("#upload-redistribution").checked}}})});
   await loadAll(project.id);$("#viewer").close();notify("Original retained without alteration.");
   const sourceId=result.record_ids[0];if(sourceId)await sourceDialog(sourceId);
  }catch(err){$("#upload-error").textContent=err.message;}finally{button.disabled=false;}
 });
}
async function sourceDialog(id){
 const s=await api(endpoint()+"/records/sources/"+encodeURIComponent(id)),f=project.files.find(r=>r.id===s.source_file_id);
 if(!f)return viewRecord("sources",s);
 const suffix=f.filename.split(".").at(-1).toLowerCase(),format=["csv","tsv"].includes(suffix)?"csv":["json","geojson"].includes(suffix)?"json":["xlsx","xlsm"].includes(suffix)?"xlsx":suffix==="docx"?"docx":"text";
 intakeState={sourceId:id,source:s,file:f,format,parsed:null,spec:null,revision:project.revision};
 showViewer("Inspect original · "+s.title,'<p class="compact">'+esc(f.filename)+' · '+esc(f.bytes.toLocaleString())+' bytes · SHA-256 '+esc(f.sha256)+'</p>'+
 '<div class="grid"><label class="field"><span>Format</span><select id="intake-format">'+["csv","json","xlsx","docx","text"].map(v=>'<option '+(v===format?"selected":"")+'>'+v+'</option>').join("")+'</select></label>'+
 '<label class="field"><span>Text encoding</span><select id="intake-encoding">'+["utf-8-sig","utf-8","cp1252","utf-16","latin-1"].map(v=>'<option '+(v===(id.startsWith("statcan-interim-")?"cp1252":"utf-8-sig")?"selected":"")+'>'+v+'</option>').join("")+'</select></label>'+
 '<label class="field"><span>CSV delimiter</span><input id="intake-delimiter" value="," maxlength="1"></label><label class="field"><span>Header row or rows (1-based)</span><input id="intake-headers" value="1"><small>Use a comma-separated pair for a merged multirow Excel header; leave blank for generated column names.</small></label>'+
 '<label class="field"><span>JSON record selector</span><input id="intake-pointer" placeholder="/records"><small>Empty selects a root array. Use an exact JSON Pointer for a nested array.</small></label>'+
 '<label class="field"><span>Excel sheet name</span><input id="intake-sheet" placeholder="All source sheets"></label>'+
 '<label class="field"><span>Excel first data row</span><input id="intake-start" type="number" min="1"></label><label class="field"><span>Excel last data row</span><input id="intake-end" type="number" min="1"></label></div>'+
 '<div class="toolbar"><button data-action="inspect-source" class="primary">Inspect actual records</button><a href="'+endpoint()+"/files/"+encodeURIComponent(f.id)+'" download>Download unchanged original</a></div>'+
 '<p id="intake-error" role="alert"></p><div id="intake-preview"></div><div id="intake-mapping"></div>');
}
function parsingOptions(){
 const format=$("#intake-format").value,encoding=$("#intake-encoding").value,headers=$("#intake-headers").value.trim();
 if(format==="docx")return{};
 if(format==="text")return{encoding};
 const opts={format};
 if(["csv","json"].includes(format))opts.encoding=encoding;
 if(format==="csv"){opts.delimiter=$("#intake-delimiter").value;opts.header_row=headers?Number(headers):null;}
 if(format==="json")opts.records_path=$("#intake-pointer").value;
 if(format==="xlsx"){
  if($("#intake-sheet").value)opts.sheet=$("#intake-sheet").value;
  if(headers.includes(","))opts.header_rows=headers.split(",").map(x=>Number(x.trim()));
  else opts.header_row=headers?Number(headers):null;
  if($("#intake-start").value)opts.data_start_row=Number($("#intake-start").value);
  if($("#intake-end").value)opts.data_end_row=Number($("#intake-end").value);
 }
 return opts;
}
async function inspectSource(){
 $("#intake-error").textContent="";const button=$('[data-action="inspect-source"]');button.disabled=true;
 try{
  const spec={source_id:intakeState.sourceId,parse_options:parsingOptions()};
  const result=await api(endpoint()+"/intake/preview",{method:"POST",body:JSON.stringify({specification:spec,limit:50})});
  intakeState.parsed=result.parsed;intakeState.parseOptions=spec.parse_options;intakeState.revision=result.revision;intakeState.spec=null;
  const p=result.parsed;
  $("#intake-preview").innerHTML=(p.warnings?.length?'<div class="warning">'+p.warnings.map(w=>esc(w.message)).join("<br>")+'</div>':"")+
   '<label class="field"><span>Exact source table</span><select id="intake-table">'+p.tables.map(t=>'<option value="'+esc(t.id)+'">'+esc(t.name)+' · '+esc(t.total_rows??t.rows.length)+' rows</option>').join("")+'</select></label><div id="source-table-preview"></div>';
  if(p.tables.length){renderSourceTable();$("#intake-table").addEventListener("change",()=>{renderSourceTable();renderMappingFields();});renderMappingChooser();}
  else $("#intake-mapping").innerHTML="";
 }catch(e){$("#intake-error").textContent=e.message;}finally{button.disabled=false;}
}
function selectedSourceTable(){return intakeState.parsed.tables.find(t=>t.id===$("#intake-table")?.value);}
function renderSourceTable(){
 const t=selectedSourceTable();if(!t)return;
 $("#source-table-preview").innerHTML='<p class="compact">Showing '+t.rows.length+' of '+(t.total_rows??t.rows.length)+' actual selected rows. Cell values preserve original text and nulls.</p><div class="source-preview">'+
 table(["Table row",...t.columns.map(c=>c.name)],t.rows.map((r,i)=>[esc((t.offset||0)+i+1),...t.columns.map(c=>r[c.key]===null?'<span class="muted">null</span>':esc(r[c.key]))]))+'</div>';
}
function renderMappingChooser(){
 const allowed=Object.keys(catalog.collections).filter(c=>!catalog.immutable.includes(c)&&c!=="sources");
 $("#intake-mapping").innerHTML='<section class="import-section"><h3>Adopt selected records</h3><p class="compact">Map actual columns to the working record fields. Constants are explicit operator input. Preview all selected rows before adoption; an unresolved row prevents a partial import.</p>'+
 '<div class="grid"><label class="field"><span>Target collection</span><select id="import-collection">'+allowed.map(c=>'<option value="'+c+'" '+(c==="comments"?"selected":"")+'>'+esc(COLLECTION_TITLES[c])+'</option>').join("")+'</select></label>'+
 '<label class="field"><span>Rows to adopt (1-based table rows)</span><input id="import-rows" placeholder="All rows, or e.g. 1, 3, 5"><small>These are table row numbers, not a guessed source identifier.</small></label></div>'+
 '<div id="field-mapping"></div><label class="field"><span>Stable source identity</span><select id="identity-column"><option value="">Original row identity</option>'+selectedSourceTable().columns.map(c=>'<option value="'+esc(c.key)+'">'+esc(c.name)+'</option>').join("")+'</select></label>'+
 '<div class="toolbar"><button data-action="preview-import">Preview mapped records</button><button data-action="adopt-import" class="primary" disabled>Adopt this exact mapping</button></div><p id="import-error" role="alert"></p><div id="mapped-records"></div></section>';
 $("#import-collection").addEventListener("change",renderMappingFields);renderMappingFields();
}
function renderMappingFields(){
 const collection=$("#import-collection")?.value,t=selectedSourceTable();if(!collection||!t)return;
 const fields=catalog.collections[collection];
 const hide=new Set(["source_ids","notes","source_id","source_comment_id","source_locator","carried_from_id","source_file_id","sha256"]);
 $("#field-mapping").innerHTML=Object.entries(fields).filter(([k])=>!hide.has(k)).map(([name,s])=>{
  const constant=s.kind==="reference"?'<select data-constant="'+esc(name)+'">'+referenceOptions(s.collection)+"</select>":
   s.kind==="enum"?'<select data-constant="'+esc(name)+'"><option value="">Use default</option>'+s.values.map(v=>'<option>'+esc(v)+'</option>').join("")+'</select>':
   '<input data-constant="'+esc(name)+'" placeholder="'+esc(s.kind==="list"||s.kind==="json"?"Explicit JSON constant":"Explicit constant or default")+'">';
  return '<div class="field-map"><label>'+esc(label(name))+(s.required?" *":"")+'</label><select data-map-field="'+esc(name)+'"><option value="">No source column</option>'+t.columns.map(c=>'<option value="'+esc(c.key)+'">'+esc(c.name)+' ['+esc(c.key)+']</option>').join("")+'</select>'+constant+'</div>';
 }).join("");
 const identity=$("#identity-column");if(identity)identity.innerHTML='<option value="">Original row identity</option>'+t.columns.map(c=>'<option value="'+esc(c.key)+'">'+esc(c.name)+'</option>').join("");
 intakeState.spec=null;
}
function importSpecification(){
 const collection=$("#import-collection").value,fields=catalog.collections[collection],mapping={},constants={};
 for(const input of $$("[data-map-field]"))if(input.value)mapping[input.dataset.mapField]=input.value;
 for(const input of $$("[data-constant]")){
  const name=input.dataset.constant,val=input.value;if(!val)continue;
  if(mapping[name])throw Error("Use a source column or constant for "+label(name)+", not both.");
  const kind=fields[name].kind;
  constants[name]=["json","list","boolean","integer"].includes(kind)?JSON.parse(val):val;
 }
 const rowText=$("#import-rows").value.trim();
 return {source_id:intakeState.sourceId,parse_options:intakeState.parseOptions,collection,table_id:$("#intake-table").value,field_map:mapping,constants,
         identity_column:$("#identity-column").value||undefined,row_indices:rowText?rowText.split(",").map(s=>Number(s.trim())-1):null};
}
async function previewImport(){
 $("#import-error").textContent="";try{
  const spec=importSpecification(),result=await api(endpoint()+"/intake/preview",{method:"POST",body:JSON.stringify({specification:spec,limit:30})});
  const mapped=result.parsed.mapped;intakeState.spec=spec;intakeState.revision=result.revision;
  $("#mapped-records").innerHTML='<p>'+esc(mapped.total_selected)+' selected records · '+esc(mapped.error_count)+' unresolved rows.</p>'+
   (mapped.errors.length?'<pre>'+esc(pretty(mapped.errors))+'</pre>':"")+mapped.rows.map(r=>'<details><summary>'+esc(titleOf(r.record))+' · '+esc(r.existing?"existing identity":"new identity")+'</summary><pre>'+esc(pretty(r.record))+'</pre></details>').join("");
  $('[data-action="adopt-import"]').disabled=!!mapped.error_count||!mapped.rows.length;
 }catch(e){$("#import-error").textContent=e.message;}
}
async function adoptImport(){
 if(!intakeState.spec)return;
 if(!same(importSpecification(),intakeState.spec)){$("#import-error").textContent="Mapping fields changed. Preview the exact updated mapping before adoption.";return;}
 const button=$('[data-action="adopt-import"]');button.disabled=true;
 try{
  const result=await api(endpoint()+"/operations",{method:"POST",body:JSON.stringify({operation:"records.import",payload:{specification:intakeState.spec},expected_revision:intakeState.revision,request_id:uid(),actor:"Local operator"})});
  await loadAll(project.id);$("#viewer").close();notify("Adopted "+result.record_ids.length+" new records; original bytes and row identities retained.");
 }catch(e){$("#import-error").textContent=e.message;button.disabled=false;}
}
function exportDialog(editionId=""){
 const editions=project.editions;
 showViewer("Export & publish documents",'<p>Select the handover you need. A complete private archive restores all originals and development history. Edition documents contain the chosen public text; management workpapers carry private delivery records.</p>'+
 '<form id="export-form"><label class="field"><span>Package</span><select id="export-audience"><option value="edition">Selected bilingual edition — DOCX / PDF / HTML</option><option value="management">Management and four-phase workpapers</option><option value="private_restore">Complete private continuation archive</option></select></label>'+
 '<div class="grid"><label class="field"><span>Frozen edition</span><select id="export-edition">'+referenceOptions("editions",editionId||editions.at(-1)?.id||"")+'</select></label>'+
 '<label class="field"><span>Compare against another edition</span><select id="export-comparison">'+referenceOptions("editions","")+'</select></label>'+
 '<label class="field"><span>Recorded publication metadata (optional)</span><select id="export-publication">'+referenceOptions("publications","")+'</select></label></div>'+
 '<h3>Original files to include in this selected handover</h3><p class="compact">Originals are included only when selected. A public edition also requires the source’s explicit public citation and redistribution settings. Complete private archives always include all originals.</p>'+
 '<div class="choices" id="export-sources">'+project.sources.filter(s=>s.source_file_id).map(s=>'<label><input type="checkbox" value="'+esc(s.id)+'">'+esc(s.title)+' <small>'+esc(s.public_redistribution?"original redistribution enabled":"internal original")+'</small></label>').join("")+'</div>'+
 '<p id="export-error" role="alert"></p><button type="submit" class="primary">Build and download package</button></form>');
 if(!editions.length)$("#export-audience").value="private_restore";
 $("#export-form").addEventListener("submit",async e=>{
  e.preventDefault();const button=e.submitter;button.disabled=true;
  try{
   const q=new URLSearchParams({audience:$("#export-audience").value});
   for(const [key,id]of [["edition_id","export-edition"],["comparison_edition_id","export-comparison"],["publication_id","export-publication"]])if($("#"+id).value)q.set(key,$("#"+id).value);
   q.set("include_source_ids",[...$("#export-sources").querySelectorAll("input:checked")].map(i=>i.value).join(","));
   const res=await fetch(endpoint()+"/export?"+q);
   if(!res.ok){const data=await res.json();throw Error(data.error||"Document export failed.");}
   const blob=await res.blob(),url=URL.createObjectURL(blob),link=document.createElement("a");
   link.href=url;link.download=res.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1]||"standards-handover.zip";link.click();setTimeout(()=>URL.revokeObjectURL(url),2000);
   notify("Downloaded "+blob.size.toLocaleString()+" bytes from project revision "+project.revision+".");$("#viewer").close();
  }catch(err){$("#export-error").textContent=err.message;}finally{button.disabled=false;}
 });
}
async function createProject(){
 const title=prompt("Project title");if(!title?.trim())return;
 const result=await api("/api/projects",{method:"POST",body:JSON.stringify({title,actor:"Local operator"})});section="scope";subsection.scope="scope";await loadAll(result.id);newRecord("scope");
}
async function seedExample(kind){
 notify("Opening the retained "+(kind==="authored"?"authored workflow":"Canadian source")+" example…");
 const result=await api("/api/demo",{method:"POST",body:JSON.stringify({kind})});section="overview";await loadAll(result.id);
}
async function renameProject(){
 if(!project)return;const title=prompt("Project title",project.title);if(!title||title===project.title)return;
 await api(endpoint()+"/operations",{method:"POST",body:JSON.stringify({operation:"project.rename",payload:{title},expected_revision:project.revision,request_id:uid(),actor:"Local operator"})});await loadAll(project.id);
}
function tableEditAction(action,button){
 const name=button.dataset.table,holder=$('[data-table-editor="'+CSS.escape(name)+'"]');let rows=readTable(name);
 if(action==="table-add-row")rows.push(Array(Math.max(2,...rows.map(r=>r.length))).fill(""));
 if(action==="table-add-column"){if(!rows.length)rows=[["",""],["",""]];else rows=rows.map(r=>[...r,""]);}
 if(action==="table-remove-row")rows.splice(Number(button.dataset.row),1);
 const wrapper=document.createElement("div");wrapper.innerHTML=editableTable(name,rows);holder.replaceWith(wrapper.firstElementChild);
}
async function dispatch(button){
 const action=button.dataset.action;
 if(button.dataset.section){section=button.dataset.section;listOffset=0;listCache=null;return render();}
 if(button.dataset.collection&&!action){subsection[section]=button.dataset.collection;listOffset=0;listCache=null;return render();}
 if(button.dataset.clause){clauseId=button.dataset.clause;return renderDraft();}
 if(!action)return;
 $("#workspace-menu").hidden=true;$("#more-menu").setAttribute("aria-expanded","false");
 if(action==="new-project")return createProject();
 if(action==="public-demo")return seedExample("public");
 if(action==="authored-demo")return seedExample("authored");
 if(action==="rename")return renameProject();
 if(action==="section"){section=button.dataset.target;listOffset=0;return render();}
 if(action==="edit")return editRecord(button.dataset.collection,button.dataset.id);
 if(action==="new-record")return newRecord(button.dataset.collection||currentCollection());
 if(action==="workflow"){
  const defaults={};
  for(const [dataKey,field]of [["clauseId","clause_id"],["ballotId","ballot_id"],["commentId","comment_id"],["phase","phase"]])if(button.dataset[dataKey])defaults[field]=button.dataset[dataKey];
  return workflow(button.dataset.operation,defaults);
 }
 if(action==="close-editor"){$("#editor").close();editor=null;return;}
 if(action==="close-viewer"){$("#viewer").close();return;}
 if(action==="reconcile")return reconcile();
 if(action==="case")return showCase(button.dataset.id);
 if(action==="ballot")return showBallot(button.dataset.id);
 if(action==="compare")return compareEdition(button.dataset.id);
 if(action==="upload")return uploadDialog();
 if(action==="source")return sourceDialog(button.dataset.id);
 if(action==="inspect-source")return inspectSource();
 if(action==="preview-import")return previewImport();
 if(action==="adopt-import")return adoptImport();
 if(action==="export")return exportDialog(button.dataset.editionId||"");
 if(action==="restore"){$("#restore-file").click();return;}
 if(action.startsWith("table-"))return tableEditAction(action,button);
 if(action==="history-item"){const record=listCache?.history?.find(r=>r.revision===Number(button.dataset.index));return showViewer("Retained revision "+button.dataset.index,'<pre>'+esc(pretty(record))+'</pre>');}
 if(action==="prev-page"){listOffset=Math.max(0,listOffset-100);listCache=null;return render();}
 if(action==="next-page"){listOffset+=100;listCache=null;return render();}
}
document.addEventListener("click",e=>{
 const button=e.target.closest("button[data-action],button[data-section],button[data-collection],button[data-clause]");
 if(button){e.preventDefault();dispatch(button).catch(error=>notify(error.message));}
});
$("#editor-form").addEventListener("submit",saveEditor);
$("#project-picker").addEventListener("change",e=>{section="overview";listOffset=0;loadAll(e.target.value).catch(err=>notify(err.message));});
$("#new-project").addEventListener("click",()=>createProject().catch(err=>notify(err.message)));
$("#more-menu").addEventListener("click",()=>{const menu=$("#workspace-menu");menu.hidden=!menu.hidden;$("#more-menu").setAttribute("aria-expanded",String(!menu.hidden));});
$("#restore-file").addEventListener("change",async e=>{
 const file=e.target.files[0];if(!file)return;
 try{notify("Restoring exact originals and development records…");const result=await api("/api/restore",{method:"POST",body:JSON.stringify({content_base64:await base64File(file)})});section="overview";await loadAll(result.id);notify("Opened restored project revision "+result.revision+".");}
 catch(err){notify(err.message);}finally{e.target.value="";}
});
$("#editor").addEventListener("cancel",()=>{editor=null;});
async function boot(){catalog=await api("/api/catalog");await loadAll(localStorage.getItem("standards-project"));nav();}
boot().catch(error=>{$("#main").innerHTML=empty("The local application could not open: "+error.message);});
