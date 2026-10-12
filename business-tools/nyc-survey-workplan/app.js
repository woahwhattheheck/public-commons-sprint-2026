(function(){
"use strict";
const C=window.NycSurveyPlan,B=window.NycSurveyBundle,R=C.rules;
const $=id=>document.getElementById(id),esc=x=>String(x==null?"":x).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const keyPrefix="nyc-survey-workplan-v1:",assetNames=["index.html","style.css","rules.js","core.cjs","bundle.cjs","app.js","cli.cjs","README.md","SOURCE_NOTES.md"];
let p,active="rates",dirty=false,saveTimer=null,lastSavedRevision=null,busy=false;
function now(){return new Date().toISOString();}
function id(){return"workplan-"+crypto.randomUUID();}
function notify(message,error=false){$("notice").textContent=message;$("notice").classList.toggle("error",error);}
function dollars(value){if(value===null||value===undefined)return"Incomplete";const parts=String(value).split(".");return"$"+parts[0].replace(/\B(?=(\d{3})+(?!\d))/g,",")+"."+(parts[1]||"").padEnd(2,"0");}
function saveState(){ $("save-state").textContent=dirty?"Changes are not yet saved in this browser.":"Saved in this browser · revision "+p.revision;$("footer-revision").textContent="Workplan revision "+p.revision; }
function persist(){clearTimeout(saveTimer);saveTimer=null;try{localStorage.setItem(keyPrefix+p.workplan_id,JSON.stringify(p));localStorage.setItem(keyPrefix+"last",p.workplan_id);dirty=false;lastSavedRevision=p.revision;}catch(err){dirty=true;notify("Browser storage is unavailable. Save the workplan JSON to keep these changes.",true);}saveState();}
function changed(mutator){const next=C.validateWorkplan(p);mutator(next);p=C.touch(next,now());dirty=true;saveState();refreshDerived();clearTimeout(saveTimer);saveTimer=setTimeout(persist,250);}
function initial(){
  const embedded=$("initial-workplan");let base=null;if(embedded){base=C.validateWorkplan(JSON.parse(embedded.textContent));}
  try{
    const existing=base?localStorage.getItem(keyPrefix+base.workplan_id):localStorage.getItem(keyPrefix+(localStorage.getItem(keyPrefix+"last")||""));
    if(existing){const candidate=C.validateWorkplan(JSON.parse(existing));if(!base||(candidate.workplan_id===base.workplan_id&&candidate.created_at===base.created_at&&candidate.revision>=base.revision))base=candidate;}
  }catch(err){notify("Saved browser data could not be reopened. The included workplan is still available.",true);}
  p=base||C.newWorkplan({id:id(),at:now()});render();persist();notify("Workplan ready. Rate inputs stay in this browser and your downloaded files.");
}
function summary(r){
  $("summary").innerHTML=[
    ["Schedule rates",r.rates.complete+" / 36",r.rates.ready?"All ceiling rates entered":"Unknown rates remain blank"],
    ["Official scenario",r.scenario.total===null?"Incomplete":dollars(r.scenario.total),r.scenario.total===null?"Known subtotal "+dollars(r.scenario.subtotal):"19 original calculation rows"],
    ["Assignment",r.assignment.total===null?"Draft":dollars(r.assignment.total),r.assignment.rows.length+" service rows"],
    ["Preparation",r.preparation.items.filter(x=>["reviewed","not_applicable"].includes(x.status)).length+" / "+r.preparation.items.length,"Material reviewed or marked not applicable"]
  ].map(([label,value,note])=>'<article><span>'+esc(label)+'</span><strong>'+esc(value)+'</strong><span>'+esc(note)+'</span></article>').join("");
}
function renderRates(){
  const names={1:"Implementation and setup",2:"Variable fielding",3:"Data analysis and reporting",4:"Ad hoc hourly roles"};
  $("rate-groups").innerHTML=[1,2,3,4].map(part=>'<h3 class="part-heading">Part '+part+' · '+names[part]+'</h3><div class="table-wrap"><table><thead><tr><th>Item</th><th>Unit</th><th>Ceiling USD</th><th>Rate source / note</th><th>RFP</th></tr></thead><tbody>'+
    R.catalog.filter(r=>r.part===part).map(r=>'<tr><td><strong>'+r.item+'. '+esc(r.label)+'</strong>'+(r.note?'<div class="rate-note">'+esc(r.note)+'</div>':'')+'<div class="row-error" id="rate-error-'+r.id+'"></div></td><td>'+esc(r.unit.replace(/_/g," "))+'</td><td class="rate-input"><input inputmode="decimal" aria-label="'+esc(r.label)+' ceiling in USD" data-rate="'+r.id+'" value="'+esc(p.rates[r.id].value)+'" placeholder="Not entered"></td><td class="ref-input"><input data-rate-source="'+r.id+'" aria-label="'+esc(r.label)+' source reference" value="'+esc(p.rates[r.id].source)+'" placeholder="Prime input or quotation reference"></td><td><a class="source-link" href="'+R.sources[0].url+'#page='+r.pdf_page+'" target="_blank" rel="noopener">PDF p. '+r.pdf_page+'</a></td></tr>').join("")+'</tbody></table></div>').join("");
}
function renderScenario(r){
  $("scenario-spec").textContent="Original scenario: 30 questions; 2,000 words; English and Spanish; 15,000 people targeted or approached; 3,300 target completions. Digital: 10,000 invitations and 20,000 reminders. CATI: 2,500 records × 3 attempts. The CAPI approach denominator is not specified.";
  const names={1:"Setup and programming",2:"Fieldwork and deployment",3:"Data and reporting"};
  $("scenario-rows").innerHTML=r.scenario.rows.map(row=>'<tr><td><span class="phase-label">'+names[row.phase]+'</span>'+esc(row.label)+'</td><td class="numeric">'+esc(Number(row.quantity).toLocaleString("en-US"))+'</td><td>'+esc(row.unit)+'</td><td class="numeric">'+esc(row.rate||"—")+'</td><td class="numeric">'+esc(row.total===null?"Not priced":dollars(row.total))+'</td><td><a class="source-link" href="'+R.sources[0].url+'#page='+row.pdf_page+'" target="_blank" rel="noopener">PDF p. '+row.pdf_page+'</a></td></tr>').join("");
  $("scenario-footer").innerHTML='<tr><td colspan="4">'+(r.scenario.complete?"Official scenario total":"Known subtotal — incomplete scenario")+'</td><td class="numeric">'+esc(dollars(r.scenario.complete?r.scenario.total:r.scenario.subtotal))+'</td><td></td></tr>';
  $("rounding-note").textContent=R.calculation_policy.line_total_rounding;
  $("official-price").textContent=r.scenario.complete?dollars(r.scenario.total):"Complete the missing rate inputs.";
  const e=r.evaluation;
  $("evaluation-result").innerHTML='<p>Technical: <strong>'+esc(e.technical===null?"Not entered":e.technical+" / 90")+'</strong> · threshold 63 / 90</p><p>Price: <strong>'+esc(e.price===null?"Not calculated":e.price.toFixed(6)+" / 10")+'</strong></p><p class="small">'+esc(e.price_reason)+'</p>'+(e.total!==null?'<p>Total planning score: <strong>'+e.total.toFixed(6)+' / 100</strong></p>':'')+e.errors.map(x=>'<p class="row-error">'+esc(x)+'</p>').join("");
  const portal=r.preparation.portal;
  $("portal-result").textContent=portal.recorded?(portal.matches?"Both recorded prices match the official scenario total.":"Recorded portal values do not yet both match the complete total."):"No portal prices have been recorded.";
}
function serviceRow(line,index){
  const options=[1,2,3,4].map(part=>'<optgroup label="Part '+part+'">'+R.catalog.filter(r=>r.part===part).map(r=>'<option value="'+r.id+'"'+(r.id===line.rate_id?' selected':'')+'>'+r.item+' · '+esc(r.label)+' ('+esc(r.unit)+')</option>').join("")+'</optgroup>').join("");
  return'<div class="assignment-row" data-row="'+esc(line.id)+'"><div class="row-top"><h4>Service '+(index+1)+'</h4><button data-remove-line="'+esc(line.id)+'">Remove row</button></div><div class="line-fields"><label>Schedule item<select data-line-field="rate_id">'+options+'</select></label><label>Quantity<input inputmode="decimal" data-line-field="quantity" value="'+esc(line.quantity)+'"></label><label>Assignment unit rate (USD)<input inputmode="decimal" data-line-field="unit_rate" value="'+esc(line.unit_rate)+'" placeholder="Use schedule ceiling"></label></div><div class="line-extra"><label>Deliverable or distinct ad hoc scope<input data-line-field="scope" value="'+esc(line.scope)+'"></label><label>Translation language<input data-line-field="language" value="'+esc(line.language)+'" placeholder="When translating"></label><label>Translation order reference<input data-line-field="order_ref" value="'+esc(line.order_ref)+'" placeholder="When translating"></label></div><div class="line-options"><label><input type="checkbox" data-line-field="translation_minimum"'+(line.translation_minimum?" checked":"")+'>Apply the permitted 1,000-word order minimum</label><label><input type="checkbox" data-line-field="covered_by_deliverable"'+(line.covered_by_deliverable?" checked":"")+'>This labor is already included in a project deliverable</label></div><div class="line-total" data-line-total></div><div class="row-error" data-line-errors></div></div>';
}
function expenseRow(e,index){
  const options=[["participant_incentive","Participant incentive"],["sampling_frame","Sampling frame"],["other","Other project expense"],["travel","Travel"],["postage","Postage"],["messenger","Messenger"]];
  return'<div class="expense-row" data-expense="'+esc(e.id)+'"><div class="row-top"><h4>Expense '+(index+1)+'</h4><button data-remove-expense="'+esc(e.id)+'">Remove expense</button></div><div class="line-fields"><label>Category<select data-expense-field="kind">'+options.map(([v,t])=>'<option value="'+v+'"'+(e.kind===v?' selected':'')+'>'+t+'</option>').join("")+'</select></label><label>At-cost amount (USD)<input inputmode="decimal" data-expense-field="amount" value="'+esc(e.amount)+'"></label><label>Description<input data-expense-field="description" value="'+esc(e.description)+'"></label></div><div class="field-grid"><label>Written approval reference<input data-expense-field="approval_reference" value="'+esc(e.approval_reference)+'"></label><label>Original receipt reference<input data-expense-field="receipt_reference" value="'+esc(e.receipt_reference)+'"></label></div><label><input type="checkbox" data-expense-field="at_cost"'+(e.at_cost?" checked":"")+'>Amount is at cost with no markup</label><div class="row-error" data-expense-errors></div><div class="small muted" data-expense-status></div></div>';
}
function renderAssignment(){for(const el of document.querySelectorAll("[data-assignment-meta]")){const value=p.assignment[el.dataset.assignmentMeta];el.value=el.type==="datetime-local"?value.slice(0,16):value;}
  $("assignment-lines").innerHTML=p.assignment.lines.length?p.assignment.lines.map(serviceRow).join(""):'<div class="empty-state">Add service rows or bring in the complete official scenario scope.</div>';
  $("expense-lines").innerHTML=p.assignment.expenses.length?p.assignment.expenses.map(expenseRow).join(""):'<div class="empty-state">No reimbursable expenses proposed.</div>';
}
function renderPreparation(){
  $("preparation-items").innerHTML=[["documents",R.documents],["questionnaires",R.questionnaires]].map(([kind,defs])=>'<h3>'+(kind==="documents"?"Six required documents":"Questionnaire and related preparation")+'</h3>'+defs.map(d=>{
    const v=p[kind][d.id],states=kind==="questionnaires"&&d.id==="subcontractors"?["not_started","prepared","reviewed","not_applicable"]:["not_started","prepared","reviewed"];
    return'<div class="preparation-row" data-preparation-kind="'+kind+'" data-preparation-id="'+d.id+'"><h4>'+esc(d.label)+(d.pdf_page?' <a class="source-link" href="'+R.sources[0].url+'#page='+d.pdf_page+'" target="_blank" rel="noopener">PDF p. '+d.pdf_page+'</a>':'')+'</h4><div class="preparation-fields"><label>Status<select data-preparation-field="status">'+states.map(s=>'<option value="'+s+'"'+(v.status===s?' selected':'')+'>'+s.replace(/_/g," ")+'</option>').join("")+'</select></label><label>Material reference<input data-preparation-field="reference" value="'+esc(v.reference)+'"></label></div><label>Notes<textarea rows="2" data-preparation-field="notes">'+esc(v.notes)+'</textarea></label></div>';
  }).join("")).join("");
}
function renderSources(){
  $("source-register").innerHTML=R.sources.map(s=>'<p><a href="'+esc(s.url)+'" target="_blank" rel="noopener">'+esc(s.label)+'</a>'+(s.pages?' · '+s.pages+' pages':'')+'</p>').join("");
  $("source-rules").innerHTML=R.source_notes.map(s=>'<li>'+esc(s)+'</li>').join("");
  const eastern=value=>new Intl.DateTimeFormat("en-US",{dateStyle:"medium",timeStyle:"short",timeZone:"America/New_York"}).format(new Date(value))+" Eastern · "+value.replace("T"," ").replace("Z"," UTC");
  $("source-dates").innerHTML=[["Proposal due",eastern(R.dates.proposal_due)],["Questions due",R.dates.questions_due_date],["Conference RSVP",eastern(R.dates.conference_rsvp_due)],["Optional conference",eastern(R.dates.conference)],["Anticipated term",R.dates.anticipated_start+" through "+R.dates.anticipated_end]].map(([a,b])=>"<dt>"+esc(a)+"</dt><dd>"+esc(b)+"</dd>").join("");
}
function refreshDerived(){
  const r=C.inspect(p);summary(r);
  for(const rate of r.rates.entries){const el=$("rate-error-"+rate.id);if(el)el.textContent=rate.error||"";}
  renderScenario(r);
  for(const row of r.assignment.rows){const el=[...document.querySelectorAll("[data-row]")].find(x=>x.dataset.row===row.id);if(el){el.querySelector("[data-line-total]").textContent=row.total===null?"Incomplete row":dollars(row.total)+(row.bill_quantity!==row.quantity&&row.rate_id==="translation"?" · billed quantity "+Number(row.bill_quantity):"");el.querySelector("[data-line-errors]").textContent=row.errors.join(" ");}}
  for(const row of r.assignment.expense_rows){const el=[...document.querySelectorAll("[data-expense]")].find(x=>x.dataset.expense===row.id);if(el){el.querySelector("[data-expense-errors]").textContent=row.errors.join(" ");el.querySelector("[data-expense-status]").textContent=row.errors.length?"":row.invoice_ready?"Written approval and original receipt references recorded.":"Proposed expense; approval and receipt references remain to be recorded.";}}
  $("assignment-result").innerHTML="<p>Services: <strong>"+esc(dollars(r.assignment.service_subtotal))+"</strong> · Proposed reimbursables: <strong>"+esc(dollars(r.assignment.proposed_expenses))+"</strong></p><p>"+(r.assignment.complete?"Proposed assignment total: <strong>"+esc(dollars(r.assignment.total))+"</strong>":"Assignment is incomplete; known subtotal "+esc(dollars(r.assignment.known_subtotal)))+"</p>"+r.assignment.errors.map(x=>'<p class="row-error">'+esc(x.message)+'</p>').join("");
  $("preparation-result").innerHTML=r.preparation.complete?"<strong>Preparation items reviewed. Check current addenda and the original forms before submission.</strong>":"<strong>"+r.preparation.issues.length+" preparation items remain.</strong>"+r.preparation.issues.map(x=>"<p class='small'>"+esc(x.message)+"</p>").join("");
}
function render(){
  $("workplan-title").value=p.title;$("workplan-proposer").value=p.proposer;$("workplan-id").textContent=p.workplan_id;
  $("score-fields").innerHTML=R.evaluation.categories.map(s=>'<label>'+esc(s.label)+' (0–'+s.maximum+')<input inputmode="decimal" data-score="'+s.id+'" value="'+esc(p.evaluation[s.id])+'"></label>').join("");
  $("lowest-price").value=p.evaluation.lowest_qualifying_price;$("portal-d1").value=p.portal.d1;$("portal-item").value=p.portal.item_total;$("portal-receipt").value=p.portal.receipt_reference;$("workplan-notes").value=p.notes;
  renderRates();renderAssignment();renderPreparation();renderSources();refreshDerived();saveState();selectTab(active);
}
function selectTab(name){active=name;for(const tab of document.querySelectorAll("[data-tab]"))tab.setAttribute("aria-selected",String(tab.dataset.tab===name));for(const el of document.querySelectorAll(".panel"))el.hidden=el.id!=="tab-"+name;}
function freshLine(rateId="plan",quantity="1",official=false){return{id:"line-"+crypto.randomUUID(),rate_id:rateId,quantity,unit_rate:"",scope:"",language:official&&rateId==="translation"?"Spanish":"",order_ref:official&&rateId==="translation"?"official-scenario-spanish":"",translation_minimum:false,covered_by_deliverable:false};}
function download(name,content,mime="text/plain;charset=utf-8"){const url=URL.createObjectURL(new Blob([content],{type:mime})),a=document.createElement("a");a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}
async function sources(){const embedded=$("application-sources");if(embedded)return JSON.parse(embedded.textContent);if(location.protocol==="file:")throw Error("Open standalone.html from the complete bundle, or run the local server to export the full application.");const entries=await Promise.all(assetNames.map(async name=>{const res=await fetch(new URL(name,location.href),{cache:"no-store"});if(!res.ok)throw Error("Application file unavailable: "+name);return[name,await res.text()];}));return Object.fromEntries(entries);}
async function exportBundle(){if(busy)return;busy=true;$("export-workplan").disabled=true;try{persist();notify("Building the complete workplan bundle…");const frozen=C.validateWorkplan(p),source=await sources(),result=await B.create(frozen,C.exportsFor(frozen),source),verified=await B.verify(result.bytes);C.verifyExports(verified.workplan,B.texts(verified.entries));download(frozen.workplan_id+"-r"+frozen.revision+".zip",result.bytes,"application/zip");notify("Complete bundle downloaded: same workplan, calculations, standalone copy and full application.");}catch(err){notify(err.message,true);}finally{busy=false;$("export-workplan").disabled=false;}}
async function openFile(file){
  if(!file)return;if(busy){notify("Finish the current file operation before opening another workplan.",true);return;}
  if(file.size>64*1024*1024)throw Error("This workplan file exceeds 64 MiB.");if(dirty&&!confirm("Some changes are not saved in this browser. Open a different workplan?"))return;
  const originalId=p.workplan_id,originalRevision=p.revision,controls=[...document.querySelectorAll("button,input,select,textarea")].map(el=>[el,el.disabled]);
  busy=true;for(const [el]of controls)el.disabled=true;notify("Opening and verifying the selected workplan…");
  try{
    let opened;if(file.name.toLowerCase().endsWith(".zip")){const received=await B.verify(new Uint8Array(await file.arrayBuffer()));opened=C.verifyExports(received.workplan,B.texts(received.entries)).workplan;}else opened=JSON.parse(await file.text());
    const next=C.validateWorkplan(opened);
    if(p.workplan_id!==originalId||p.revision!==originalRevision)throw Error("The current workplan changed during import. Its changes were preserved; open the file again.");
    p=next;dirty=true;render();persist();notify("Opened "+p.workplan_id+" at revision "+p.revision+".");
  }finally{busy=false;for(const [el,disabled]of controls)if(el.isConnected)el.disabled=disabled;}
}
document.addEventListener("input",event=>{
  const el=event.target;if(!el.matches("input,textarea"))return;
  try{
    if(el.dataset.rate)changed(p=>p.rates[el.dataset.rate].value=el.value);
    else if(el.dataset.rateSource)changed(p=>p.rates[el.dataset.rateSource].source=el.value);
    else if(el.dataset.lineField&&el.type!=="checkbox"){const row=el.closest("[data-row]");changed(p=>p.assignment.lines.find(x=>x.id===row.dataset.row)[el.dataset.lineField]=el.value);}
    else if(el.dataset.expenseField&&el.type!=="checkbox"){const row=el.closest("[data-expense]");changed(p=>p.assignment.expenses.find(x=>x.id===row.dataset.expense)[el.dataset.expenseField]=el.value);}
    else if(el.dataset.preparationField){const row=el.closest("[data-preparation-id]");changed(p=>p[row.dataset.preparationKind][row.dataset.preparationId][el.dataset.preparationField]=el.value);}
    else if(el.dataset.assignmentMeta&&el.type!=="datetime-local")changed(p=>p.assignment[el.dataset.assignmentMeta]=el.value);
    else if(el.dataset.score)changed(p=>p.evaluation[el.dataset.score]=el.value);
    else if(el.id==="workplan-title")changed(p=>p.title=el.value);
    else if(el.id==="workplan-proposer")changed(p=>p.proposer=el.value);
    else if(el.id==="lowest-price")changed(p=>p.evaluation.lowest_qualifying_price=el.value);
    else if(el.id==="portal-d1")changed(p=>p.portal.d1=el.value);
    else if(el.id==="portal-item")changed(p=>p.portal.item_total=el.value);
    else if(el.id==="portal-receipt")changed(p=>p.portal.receipt_reference=el.value);
    else if(el.id==="workplan-notes")changed(p=>p.notes=el.value);
  }catch(err){notify(err.message,true);}
});
document.addEventListener("change",event=>{
  const el=event.target;try{
    if(el.dataset.lineField&&(el.tagName==="SELECT"||el.type==="checkbox")){const row=el.closest("[data-row]");changed(p=>p.assignment.lines.find(x=>x.id===row.dataset.row)[el.dataset.lineField]=el.type==="checkbox"?el.checked:el.value);}
    else if(el.dataset.expenseField&&(el.tagName==="SELECT"||el.type==="checkbox")){const row=el.closest("[data-expense]");changed(p=>p.assignment.expenses.find(x=>x.id===row.dataset.expense)[el.dataset.expenseField]=el.type==="checkbox"?el.checked:el.value);}
    else if(el.dataset.preparationField&&el.tagName==="SELECT"){const row=el.closest("[data-preparation-id]");changed(p=>p[row.dataset.preparationKind][row.dataset.preparationId][el.dataset.preparationField]=el.value);}
    else if(el.dataset.assignmentMeta&&el.type==="datetime-local")changed(p=>p.assignment.agency_due_at=el.value?new Date(el.value+"Z").toISOString():"");
  }catch(err){notify(err.message,true);}
});
document.addEventListener("click",event=>{
  const button=event.target.closest("button");if(!button)return;try{
    if(button.dataset.tab)selectTab(button.dataset.tab);
    else if(button.dataset.download){persist();const files=C.exportsFor(p);download(button.dataset.download,files[button.dataset.download],"text/csv;charset=utf-8");notify("Downloaded "+button.dataset.download+".");}
    else if(button.dataset.removeLine){changed(p=>p.assignment.lines=p.assignment.lines.filter(x=>x.id!==button.dataset.removeLine));renderAssignment();refreshDerived();}
    else if(button.dataset.removeExpense){changed(p=>p.assignment.expenses=p.assignment.expenses.filter(x=>x.id!==button.dataset.removeExpense));renderAssignment();refreshDerived();}
  }catch(err){notify(err.message,true);}
});
$("new-workplan").addEventListener("click",()=>{if(dirty&&!confirm("Some changes are not saved in this browser. Start another workplan?"))return;p=C.newWorkplan({id:id(),at:now()});dirty=true;render();persist();notify("New workplan created. All proposed rates are blank.");});
$("open-workplan").addEventListener("click",()=>$("open-file").click());
$("open-file").addEventListener("change",async event=>{try{await openFile(event.target.files[0]);}catch(err){notify(err.message,true);}finally{event.target.value="";}});
$("save-workplan").addEventListener("click",()=>{persist();download(p.workplan_id+"-r"+p.revision+".json",JSON.stringify(C.validateWorkplan(p),null,2)+"\n","application/json");notify("Workplan JSON downloaded. It keeps the same identity, rates and preparation references.");});
$("export-workplan").addEventListener("click",exportBundle);
$("add-line").addEventListener("click",()=>{changed(p=>p.assignment.lines.push(freshLine()));renderAssignment();refreshDerived();});
$("use-official-scope").addEventListener("click",()=>{if(p.assignment.lines.length&&!confirm("Add all 19 official scenario rows to the existing assignment?"))return;changed(p=>p.assignment.lines.push(...R.scenario.map(r=>freshLine(r.rate_id,r.quantity,true))));renderAssignment();refreshDerived();});
$("add-expense").addEventListener("click",()=>{changed(p=>p.assignment.expenses.push({id:"expense-"+crypto.randomUUID(),kind:"participant_incentive",description:"",amount:"",approval_reference:"",receipt_reference:"",at_cost:false}));renderAssignment();refreshDerived();});
window.addEventListener("beforeunload",event=>{if(dirty){event.preventDefault();event.returnValue="";}});
try{initial();}catch(err){notify("Could not open this workplan: "+err.message,true);}
})();
