/* Retained Bologna delivery authoring. All writes use the original workspace action API. */
(() => {
  "use strict";
  const $ = (selector, root = document) => root.querySelector(selector);
  const all = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const biValue = value => ({en:value?.en || "",it:value?.it || ""});
  const view = {scenario:null,street:null,source:null,milestone:null,interview:null,meeting:null};
  const criteria = [["traffic","Traffic"],["emissions","Emissions"],["publicSpace","Public space"],["operatorAcceptance","Operator acceptance"],["marketReadiness","Market readiness"]];
  const ratingOptions = [["UNASSESSED","Unassessed"],["FAVOURABLE","Favourable"],["MIXED","Mixed"],["ADVERSE","Adverse"],["NOT_APPLICABLE","Not applicable"]];
  let context = null;
  const createId=kind=>kind+"-"+(globalThis.crypto?.randomUUID?.() || Date.now().toString(36)+"-"+Math.random().toString(36).slice(2));
  const newIds={milestone:createId("milestone"),interview:createId("interview"),meeting:createId("meeting")};
  const editing={surveyPlan:null,documents:{},template:null};
  const openPanels=new Set(["survey-plan","learning","template"]);
  const originalSourceIds=new Set(["rfp-sga3-mccc-029","bologna-loading-bays-2022","tram-bologna-notice-2026-09-24"]);
  const data = state => state.delivery || {sources:[],method:{tools:[]},assessments:[],citySelection:{scenarioIds:[]},streets:[],milestones:[],governance:{},interviews:[],surveyPlan:{questions:[]},meetings:[],documents:{learning:{pages:[]},factsheet:{pages:[]},cesf:{answers:[]}}};
  const head = (number,title,description) => '<div class="section-head"><div><p class="eyebrow">' + esc(number) + '</p><h2>' + esc(title) + '</h2><p>' + esc(description) + '</p></div></div>';
  const empty = text => '<p class="empty-state">' + esc(text) + '</p>';
  const hidden = (name,value) => '<input type="hidden" name="' + esc(name) + '" value="' + esc(value) + '">';
  const input = (name,label,value="",attrs="") => '<div class="field"><label>' + esc(label) + '<input name="' + esc(name) + '" value="' + esc(value) + '" ' + attrs + '></label></div>';
  const area = (name,label,value="",attrs="") => '<div class="field"><label>' + esc(label) + '<textarea name="' + esc(name) + '" ' + attrs + '>' + esc(value) + '</textarea></label></div>';
  const select = (name,label,values,value,attrs="") => '<div class="field"><label>' + esc(label) + '<select name="' + esc(name) + '" ' + attrs + '>' + values.map(item => {const pair = Array.isArray(item)?item:[item,String(item).replaceAll("_"," ")];return '<option value="' + esc(pair[0]) + '"' + (String(pair[0])===String(value)?' selected':'') + '>' + esc(pair[1]) + '</option>';}).join("") + '</select></label></div>';
  const pair = (name,label,value,attrs="") => {const v=biValue(value);return '<div class="full"><h4>' + esc(label) + '</h4><div class="two-lang">' + area(name+".en","English",v.en,attrs) + area(name+".it","Italiano",v.it,attrs) + '</div></div>';};
  const formStart = (key,action) => '<form data-form-key="' + esc(key) + '" data-delivery-action="' + esc(action) + '">';
  const formEnd = (label,key,extra="") => '<div class="form-actions"><button class="action" type="submit">' + esc(label) + '</button><button class="quiet" type="button" data-discard-form="' + esc(key) + '">Restore saved fields</button>' + extra + '</div></form>';
  const review = (value={}) => '<div class="form-grid subsection">' + input("reviewer","Reviewer",value.reviewer || "","maxlength=160") + select("status","Review status",["DRAFT","REVIEWED"],value.status || "DRAFT") + '</div>';
  function sourcePick(state,selected=[],name="sourceIds",label="Source references") {
    const sources=data(state).sources || [];
    return '<fieldset class="source-selection"><legend>' + esc(label) + '</legend>' + (sources.length ? sources.map(source => '<label class="check-label"><input type="checkbox" name="' + esc(name) + '" value="' + esc(source.id) + '"' + (selected.includes(source.id)?' checked':'') + '><span>' + esc(source.title) + ' <span class="help">· ' + esc(source.id) + '</span></span></label>').join("") : '<p class="help">Add source references in Evidence review to connect this record to retained material.</p>') + '</fieldset>';
  }
  function scenarioName(state,id) {
    const original = (state.scenarios || []).find(s=>s.id===id);
    return original?.name?.en || id;
  }
  function scenarioPick(state,selected=[],name="scenarioIds") {
    const scenarios=data(state).assessments || [];
    return '<fieldset class="source-selection"><legend>Linked scenarios</legend>' + scenarios.map(s => '<label class="check-label"><input type="checkbox" name="' + name + '" value="' + esc(s.id) + '"' + (selected.includes(s.id)?' checked':'') + '><span>' + esc(scenarioName(state,s.id)) + '</span></label>').join("") + '</fieldset>';
  }
  function streetPick(state,selected=[],name="streetKeys") {
    return '<fieldset class="source-selection"><legend>Relevant streets</legend>' + Object.entries(state.baseline.streets).map(([key,s])=>'<label class="check-label"><input type="checkbox" name="' + name + '" value="' + esc(key) + '"' + (selected.includes(key)?' checked':'') + '><span>' + esc(s.it) + '</span></label>').join("") + '</fieldset>';
  }
  function renderSources(state) {
    const d=data(state), existing=(d.sources || []).find(s=>s.id===view.source), s=existing || {};
    return '<section class="card subsection"><div class="card-heading"><h3>Delivery source register</h3><span class="badge">' + (d.sources || []).length + ' sources</span></div><p class="help">Register the municipal records, interview material, best-practice studies and methodological sources used in delivery records.</p>' +
      ((d.sources || []).length ? '<div class="table-wrap subsection"><table><thead><tr><th>Source</th><th>Observation / locator</th><th>Reference</th><th></th></tr></thead><tbody>' + d.sources.map(r=>'<tr><td><strong>' + esc(r.title) + '</strong><br><span class="source-chip">' + esc(r.id) + '</span></td><td>' + esc(r.observedAt || "Date not recorded") + '<br>' + esc(r.locator) + '</td><td class="small">' + esc(r.url) + '</td><td>' + (originalSourceIds.has(r.id)?'<span class="help">Retained original</span>':'<button type="button" class="secondary" data-edit-source="' + esc(r.id) + '">Edit</button>') + '</td></tr>').join("") + '</tbody></table></div>' : "") +
      '<h4 class="subsection">' + (existing?"Edit source":"Add source") + '</h4>' + formStart("delivery-source-"+(s.id || "new"),"deliverySource") + '<div class="form-grid">' + input("id","Source ID",s.id || "","required maxlength=100 "+(existing?"readonly":"")) + input("title","Source title",s.title || "","required maxlength=300") + input("url","Original source URL",s.url || "","type=url maxlength=2000") + input("locator","Page, section or record locator",s.locator || "","maxlength=500") + input("observedAt","Source date",s.observedAt || "","type=date") + input("license","License / permitted use",s.license || "","maxlength=300") + '<div class="full">' + area("note","Source interpretation",s.note || "","maxlength=4000") + '</div></div>' + formEnd("Save source","delivery-source-"+(s.id || "new"),existing?'<button class="secondary" type="button" data-edit-source="">Add another source</button>':"") + '</section>';
  }
  function method(state) {
    const m=data(state).method || {}, toolDefinitions=[["urbane-radar","URBANE Impact Assessment Radar"],["cert-cityqore","CERT Cityqore digital twin"]];
    const tools=toolDefinitions.map(([id,title]) => {
      const t=(m.tools || []).find(x=>x.id===id)||{};
      return '<section class="card"><h3>' + title + '</h3><p class="help">Record compatibility, practical value and the municipal operating guidance for this assignment.</p><div class="form-grid subsection">' +
        select(id+".decision","Method decision",[["UNASSESSED","Not yet assessed"],["USE","Use"],["USE_WITH_LIMITS","Use with recorded limits"],["NOT_SUITABLE","Not suitable for this assessment"],["NOT_AVAILABLE","Not currently available"]],t.decision || "UNASSESSED") + '<div></div>' +
        pair(id+".dataCompatibility","Data compatibility",t.dataCompatibility,"maxlength=4000") + pair(id+".addedValue","Value for the selected analysis",t.addedValue,"maxlength=4000") + pair(id+".operatingGuidance","Municipal operating guidance",t.operatingGuidance,"maxlength=4000") + '</div></section>';
    }).join("");
    return head("03 · D1", "Method and existing tools", "Record the inception assessment of the existing municipal tools, then retain the analytical method agreed with the City.") +
      formStart("delivery-method","deliveryMethod") + tools + '<section class="card"><h3>Agreed analytical approach</h3><div class="form-grid">' + pair("agreedMethod","Approach and limits",m.agreedMethod,"maxlength=8000") + '<div class="full">' + area("cityAgreement","Municipal agreement / meeting reference",m.cityAgreement || "","maxlength=4000") + '</div></div>' + sourcePick(state,m.sourceIds || []) + review(m) + '</section>' + formEnd("Save method assessment","delivery-method");
  }
  function scenarios(state) {
    const d=data(state), records=d.assessments || [];
    if(!records.length) return head("04 · D2","Scenario assessment","Compare the retained logistics scenarios.")+empty("The saved workspace has no delivery scenario records.");
    if(!records.some(s=>s.id===view.scenario)) view.scenario=records[0].id;
    const s=records.find(s=>s.id===view.scenario), key="delivery-scenario-"+s.id, selection=d.citySelection || {};
    const matrix='<div class="table-wrap"><table><thead><tr><th>Scenario</th>' + criteria.map(([,label])=>'<th>'+label+'</th>').join("") + '<th>Review</th></tr></thead><tbody>' + records.map(r=>'<tr><td>'+esc(scenarioName(state,r.id))+'</td>' + criteria.map(([id])=>'<td>'+esc((r.criteria?.[id]?.rating || "UNASSESSED").replaceAll("_"," "))+'</td>').join("") + '<td>'+esc(r.status || "DRAFT")+'</td></tr>').join("") + '</tbody></table></div>';
    const criterionFields=criteria.map(([id,label])=>{
      const c=s.criteria?.[id] || {};
      return '<section class="criterion-block"><div class="form-grid">' + select("criteria."+id+".rating",label,ratingOptions,c.rating || "UNASSESSED") + '<div></div>' + pair("criteria."+id+".note","Assessment reasoning and evidence",c.note,"maxlength=4000") + '</div></section>';
    }).join("");
    return head("04 · D2","Scenario assessment","Use the five procurement criteria, retain the definition and evidence for each scenario, and record the municipality’s selection.") + matrix +
      '<div class="street-tabs subsection">' + records.map(r=>'<button type="button" data-edit-scenario="'+esc(r.id)+'" class="'+(r.id===s.id?"active":"")+'">'+esc(scenarioName(state,r.id))+'</button>').join("") + '</div>' +
      formStart(key,"deliveryScenario") + hidden("id",s.id) + '<section class="card"><div class="card-heading"><h3>'+esc(scenarioName(state,s.id))+'</h3><span class="badge">'+esc(s.status || "DRAFT")+'</span></div><div class="form-grid">' +
      pair("definition","Scenario definition",s.definition,"maxlength=4000") + pair("deliveryOrganisation","Delivery organisation",s.deliveryOrganisation,"maxlength=4000") + pair("vehicleTypes","Vehicle types",s.vehicleTypes,"maxlength=4000") + pair("infrastructure","Infrastructure concepts",s.infrastructure,"maxlength=4000") + pair("innovation","Applicable innovations",s.innovation,"maxlength=4000") + pair("bestPractice","Comparable European practice",s.bestPractice,"maxlength=4000") + '</div></section><section class="card"><h3>Qualitative assessment</h3>' + criterionFields + sourcePick(state,s.sourceIds || []) + review(s) + '</section>' + formEnd("Save scenario assessment",key) +
      '<section class="card subsection"><h3>Municipal scenario selection</h3><p class="help">Retain the selected scenario set and its municipal decision record. Proposed choices remain visibly proposed.</p>' + formStart("delivery-selection","deliverySelection") + scenarioPick(state,selection.scenarioIds || []) + '<div class="form-grid">' + select("status","Selection status",[["PROPOSED","Proposed"],["RECORDED","Municipal decision recorded"]],selection.status || "PROPOSED") + input("decidedAt","Decision date",selection.decidedAt || "","type=date") + input("recordedBy","Recorded by",selection.recordedBy || "","maxlength=160") + '<div></div><div class="full">' + area("record","Municipal decision / minutes reference",selection.record || "","maxlength=4000") + '</div></div>' + formEnd("Save municipal selection","delivery-selection") + '</section>';
  }
  function streets(state) {
    const d=data(state), streets=d.streets || [], original=state.baseline.streets;
    if(!streets.length) return head("05 · D3","Street frameworks","Record the four priority-street implementation frameworks.")+empty("The saved delivery contains no street records.");
    if(!streets.some(s=>s.streetKey===view.street)) view.street=streets[0].streetKey;
    const s=streets.find(s=>s.streetKey===view.street), key="delivery-street-"+s.streetKey, city=s.cityValidation || {};
    const fields=[["accessRules","Access rules"],["timeWindows","Loading and unloading time windows"],["vehicleCriteria","Vehicle-based criteria"],["deliverySpaces","Dedicated delivery spaces"],["hubLockerConcepts","Micro-hub / locker / delivery-area concepts"],["tramPedestrianIntegration","Tram and pedestrian integration"]];
    return head("05 · D3","Street implementation frameworks","Connect each street’s operating measures and spatial concepts to the selected scenarios, sources and municipal validation.") +
      '<div class="table-wrap"><table><thead><tr><th>Street</th><th>Source points / spaces</th><th>Linked scenarios</th><th>Review</th><th>Municipal validation</th></tr></thead><tbody>' + streets.map(r=>'<tr><td>'+esc(original[r.streetKey]?.it || r.streetKey)+'</td><td>'+esc((original[r.streetKey]?.points || 0)+" / "+(original[r.streetKey]?.spaces || 0))+'</td><td>'+esc((r.scenarioIds || []).map(id=>scenarioName(state,id)).join("; "))+'</td><td>'+esc(r.status || "DRAFT")+'</td><td>'+esc(r.cityValidation?.record ? r.cityValidation.date || "Record retained" : "Awaiting record")+'</td></tr>').join("") + '</tbody></table></div><div class="street-tabs subsection">' + streets.map(r=>'<button type="button" data-edit-street="'+esc(r.streetKey)+'" class="'+(r.streetKey===s.streetKey?"active":"")+'">'+esc(original[r.streetKey]?.it || r.streetKey)+'</button>').join("") + '</div>' +
      originalStreetPanel(state,s.streetKey) + formStart(key,"deliveryStreet") + hidden("streetKey",s.streetKey) + '<section class="card"><h3>'+esc(original[s.streetKey]?.it || s.streetKey)+'</h3>' + scenarioPick(state,s.scenarioIds || []) + '<div class="form-grid">' + fields.map(([name,label])=>pair(name,label,s[name],"maxlength=6000")).join("") + '</div>' + sourcePick(state,s.sourceIds || []) + review(s) + '</section><section class="card"><h3>Municipal validation</h3><div class="form-grid">' + input("cityValidation.date","Validation date",city.date || "","type=date") + input("cityValidation.recordedBy","Recorded by",city.recordedBy || "","maxlength=160") + '<div class="full">' + area("cityValidation.record","Validation record / requested revisions",city.record || "","maxlength=4000") + '</div></div></section>' + formEnd("Save street framework",key);
  }

  function roadmap(state) {
    const d=data(state), existing=(d.milestones || []).find(m=>m.id===view.milestone), m=existing || {}, g=d.governance || {}, key="delivery-milestone-"+(m.id || "new");
    const milestones=(d.milestones || []).slice().sort((a,b)=>a.year-b.year);
    const list=milestones.length ? '<article class="card">' + milestones.map(r=>'<div class="timeline-item"><div class="timeline-label">'+esc(r.year)+'<br><span class="help">'+esc(r.scope==="WIDER_ZTL"?"Wider ZTL":"Pilot streets")+'</span></div><div><h4>'+esc(r.title?.en || r.title?.it)+'</h4><p class="text-block">'+esc(r.measure?.en || r.measure?.it)+'</p><span class="help">'+esc(r.owner || "Owner to be recorded")+' · '+esc(r.status || "DRAFT")+'</span></div><button type="button" class="secondary" data-edit-milestone="'+esc(r.id)+'">Edit milestone</button></div>').join("") + '</article>' : empty("Add the staged measures that take the pilot streets into the wider ZTL by 2030.");
    const governanceFields=[["replicationMethod","Replication method"],["enforcement","Enforcement responsibilities"],["roles","Governance and roles"],["sumpAlignment","2027 SUMP alignment"],["parkingAlignment","Parking Plan alignment"],["tramAlignment","Tram construction alignment"],["evChargingAlignment","Charging-plan alignment"],["monitoring","Monitoring and review"]];
    return head("06 · D3","2030 transition and governance","Retain the phased measures, temporary derogations, conceptual incentives and responsibilities for extending the pilot framework.") + list + originalRoadmapPanel(state) +
      '<article class="card subsection"><div class="card-heading"><h3>'+(existing?"Edit milestone":"Add transition milestone")+'</h3>'+(existing?'<button class="secondary" type="button" data-edit-milestone="">Add another</button>':"")+'</div>' + formStart(key,"deliveryMilestone") + hidden("id",m.id || newIds.milestone) + '<div class="form-grid">' + select("year","Milestone year",[2026,2027,2028,2029,2030],m.year || 2026) + select("scope","Geographic scope",[["PRIORITY_STREETS","Priority streets"],["WIDER_ZTL","Wider ZTL"]],m.scope || "PRIORITY_STREETS") +
      pair("title","Milestone title",m.title,"maxlength=300") + pair("measure","Measure and intended sequencing",m.measure,"maxlength=6000") + pair("derogationCriteria","Temporary derogation criteria",m.derogationCriteria,"maxlength=4000") + pair("incentiveConcept","Conceptual incentive mechanisms",m.incentiveConcept,"maxlength=4000") + input("owner","Responsible organisation / role",m.owner || "","maxlength=300") + '<div></div></div>' + scenarioPick(state,m.scenarioIds || []) + sourcePick(state,m.sourceIds || []) + review(m) + formEnd("Save transition milestone",key) + '</article>' +
      '<article class="card subsection"><h3>Replication and governance</h3><p class="help">Record the roles, dependencies and review arrangements for the original four-street framework and its wider application.</p>' + formStart("delivery-governance","deliveryGovernance") + '<div class="form-grid subsection">' + governanceFields.map(([name,label])=>pair(name,label,g[name],"maxlength=6000")).join("") + '</div>' + sourcePick(state,g.sourceIds || []) + review(g) + formEnd("Save governance framework","delivery-governance") + '</article>';
  }
  function questionRow(question,index) {
    const q=question || {}, id=q.id || "question-"+index;
    return '<article class="question-row card" data-question-id="'+esc(id)+'"><div class="card-heading"><h4>Question '+(index+1)+'</h4><button type="button" class="quiet" data-remove-question>Remove question</button></div>' + hidden("q."+id+".id",id) + '<div class="form-grid">' + area("q."+id+".prompt","Italian question",q.prompt || "","required maxlength=1000") + select("q."+id+".type","Answer format",[["text","Free text"],["single","Single choice"],["integer","Whole number"]],q.type || "text") + '<div class="full">' + area("q."+id+".options","Options for single choice · one per line",(q.options || []).join("\n"),"maxlength=4000") + '</div></div></article>';
  }
  function renderEngagement(state) {
    const d=data(state), plan=editing.surveyPlan || d.surveyPlan || {}, questions=plan.questions || [], interview=(d.interviews || []).find(i=>i.id===view.interview) || {}, meeting=(d.meetings || []).find(m=>m.id===view.meeting) || {};
    const iKey="delivery-interview-"+(interview.id || "new"), mKey="delivery-meeting-"+(meeting.id || "new");
    const interviewList=(d.interviews || []).length ? '<div class="table-wrap subsection"><table><thead><tr><th>Interview / source</th><th>Finding</th><th>Reviewer</th><th></th></tr></thead><tbody>' + d.interviews.map(i=>'<tr><td>'+esc(i.title)+'</td><td>'+esc(i.finding?.en || i.finding?.it)+'</td><td>'+esc(i.reviewer)+'</td><td><button type="button" class="secondary" data-edit-interview="'+esc(i.id)+'">Edit</button></td></tr>').join("") + '</tbody></table></div>' : '<p class="help">No municipality-supplied interview findings are recorded yet.</p>';
    const interviewForm=formStart(iKey,"deliveryInterview")+hidden("id",interview.id || newIds.interview)+'<div class="form-grid">' + input("title","Interview / source title",interview.title || "","required maxlength=300") + input("reviewer","Reviewer",interview.reviewer || "","maxlength=160") + pair("finding","Findings from the supplied notes",interview.finding,"maxlength=6000") + pair("implication","Implications for the assessment",interview.implication,"maxlength=6000") + '</div>' + streetPick(state,interview.streetKeys || []) + scenarioPick(state,interview.scenarioIds || []) + sourcePick(state,interview.sourceIds || []) + formEnd("Save interview analysis",iKey,interview.id?'<button type="button" class="secondary" data-edit-interview="">Add another interview</button>':"");
    const meetingList=(d.meetings || []).length ? '<div class="table-wrap subsection"><table><thead><tr><th>Italian presentation</th><th>Audience</th><th>Municipal record</th><th></th></tr></thead><tbody>' + d.meetings.map(m=>'<tr><td>'+esc(m.title)+'</td><td>'+esc(m.audience)+'</td><td>'+esc(m.cityReference)+'</td><td><button type="button" class="secondary" data-edit-meeting="'+esc(m.id)+'">Edit</button></td></tr>').join("") + '</tbody></table></div>' : '<p class="help">No public-meeting material is retained yet.</p>';
    const meetingForm=(!meeting.id && (d.meetings || []).length >=2) ? '<p class="notice subsection">Both presentation sets are retained. Select an existing set to revise it.</p>' :
      formStart(mKey,"deliveryMeeting")+hidden("id",meeting.id || newIds.meeting)+'<div class="form-grid">' + input("title","Titolo della presentazione",meeting.title || "","required maxlength=300") + input("audience","Pubblico destinatario",meeting.audience || "","maxlength=500") + '<div class="full">' + area("body","Contenuti per la presentazione · italiano",meeting.body || "","required maxlength=20000 class=large") + '</div><div class="full">' + area("cityReference","Riferimento comunale / incontro",meeting.cityReference || "","maxlength=2000") + '</div></div>' + sourcePick(state,meeting.sourceIds || []) + formEnd("Save Italian presentation",mKey,meeting.id && d.meetings.length<2?'<button type="button" class="secondary" data-edit-meeting="">Prepare second presentation</button>':"");
    return '<article class="card"><details data-panel-key="survey-plan" open><summary>Italian survey plan and instrument</summary><p class="help">The municipality coordinates the engagement. Retain one Italian instrument, its distribution plan and the one reminder round.</p>' + formStart("delivery-survey-plan","deliverySurveyPlan") +
      '<div class="form-grid">' + input("audience","Audience / stakeholder groups",plan.audience || "","maxlength=1000") + input("municipalCoordinator","Municipal coordinator",plan.municipalCoordinator || "","maxlength=300") + '<div class="full">' + area("distributionPlan","Distribution plan",plan.distributionPlan || "","maxlength=4000") + '</div>' + area("reminderPlan","One coordinated reminder round",plan.reminderPlan || "","maxlength=4000") + input("reminderRecordedAt","Actual coordinated reminder date",plan.reminderRecordedAt || "","type=date"+(data(state).surveyPlan?.reminderRecordedAt?" readonly":"")) + '<div class="full">' + area("municipalityReference","Municipal agreement / instruction",plan.municipalityReference || "","maxlength=4000") + '</div></div><h4 class="subsection">Survey questions · italiano</h4><div id="survey-questions">' + questions.map(questionRow).join("") + '</div><button class="secondary" type="button" id="add-survey-question">Add a question</button>' + formEnd("Save survey plan and instrument","delivery-survey-plan") + '</details></article>' +
      '<article class="card"><details data-panel-key="interviews"><summary>Municipal interview analysis · '+(d.interviews || []).length+' retained</summary>' + interviewList + '<h4 class="subsection">'+(interview.id?"Edit supplied interview analysis":"Add supplied interview analysis")+'</h4>' + interviewForm + '</details></article>' +
      '<article class="card"><details data-panel-key="meetings"><summary>Italian public-meeting material · '+(d.meetings || []).length+' of 2 sets</summary><p class="help">Prepare clear material for the municipality’s non-technical audience, linked to the retained scenario results and street measures.</p>' + meetingList + '<h4 class="subsection">'+(meeting.id?"Edit presentation set":"Prepare a presentation set")+'</h4>' + meetingForm + '</details></article>';
  }
  function pageRow(state,page,index,kind) {
    const p=page || {};
    return '<article class="card document-page" data-page-index="'+index+'"><div class="card-heading"><h4>Page '+(index+1)+'</h4><button type="button" class="quiet" data-remove-page>Remove page</button></div>' + input("page."+index+".title","Page heading · English",p.title || "","required maxlength=200") + area("page."+index+".body","Page content · English",p.body || "","required maxlength=4800 class=large") + '<p class="help">Up to 4,800 characters on this authored page. Review physical pagination in the downloaded document’s print preview.</p>' + sourcePick(state,p.sourceIds || [],"page."+index+".sourceIds","Sources cited on this page") + '</article>';
  }
  function documentEditor(state,kind,title,max,note) {
    const doc=editing.documents[kind] || data(state).documents?.[kind] || {pages:[]}, pages=doc.pages || [], key="delivery-document-"+kind;
    return '<article class="card"><details data-panel-key="'+kind+'" '+(kind==="learning"?"open":"")+'><summary>'+esc(title)+' · '+pages.length+' / '+max+' pages</summary><p class="help">'+esc(note)+'</p>' +
      formStart(key,"deliveryDocument")+hidden("kind",kind)+ '<div class="document-pages" data-document-kind="'+kind+'" data-max-pages="'+max+'">' + pages.map((p,i)=>pageRow(state,p,i,kind)).join("") + '</div><button type="button" class="secondary" data-add-page="'+kind+'"'+(pages.length>=max?" disabled":"")+'>Add authored page</button>' + review(doc) + formEnd("Save "+(kind==="learning"?"learning note":"factsheet"),key) + '</details></article>';
  }
  function templateSection(section,index) {
    const s=section || {}, id=s.id || "section-"+index;
    return '<div class="template-section card" data-template-section="'+esc(id)+'"><div class="form-grid">'+input("section."+index+".id","Template section ID",id,"required maxlength=160")+input("section."+index+".title","Original section heading",s.title || "","required maxlength=400")+'</div><div class="form-actions"><button type="button" class="quiet" data-remove-template-section>Remove section mapping</button></div></div>';
  }
  function learning(state) {
    const d=data(state), cesf=d.documents?.cesf || {}, template=editing.template || cesf.template || {}, sections=template.sections || [];
    const templateForm=formStart("delivery-template","deliveryTemplate") + '<div class="form-grid">' + input("title","Original template title",template.title || "","required maxlength=300") + input("url","Original template URL",template.url || "","type=url maxlength=2000") + input("receivedAt","Received date",template.receivedAt || "","required type=date") + '<div class="field"><label>Read a UTF-8 template file<input type="file" id="template-file" accept=".txt,.md,.text,.json,.csv,text/plain,text/markdown"></label></div><div class="full">' + area("content","Original supplied template text",template.content || "","required maxlength=150000 class=large") + '</div></div><p class="help">Retain the supplied template text and map its original headings below. The workspace records the content digest.</p><h4 class="subsection">Template section mapping</h4><div id="template-sections">' + sections.map(templateSection).join("") + '</div><button class="secondary" type="button" id="add-template-section">Add original section</button>' + formEnd(template.title?"Retain updated template":"Retain supplied template","delivery-template");
    const answers=sections.length ? formStart("delivery-cesf","deliveryCesf") + sections.map((section,index)=>{
      const answer=(cesf.answers || []).find(a=>a.sectionId===section.id) || {};
      return '<section class="card cesf-answer" data-section-id="'+esc(section.id)+'"><h4>'+esc(section.title)+'</h4>'+area("answer."+index+".body","English response",answer.body || "","maxlength=20000 class=large")+sourcePick(state,answer.sourceIds || [],"answer."+index+".sourceIds")+'</section>';
    }).join("") + review(cesf) + formEnd("Save section-bound CESF responses","delivery-cesf") : empty("Retain the supplied CESF template and its section mapping to begin the final report.");
    return head("08 · D4 / D5","Learning and final reports","Author the transferability note and replication factsheet, then complete the original supplied CESF template in the same assessment.") +
      documentEditor(state,"learning","English learning and transferability note",10,"The deliverable allows a maximum of 8–10 pages. Record methodological steps, critical decisions, lessons, transferable elements and the local adaptation each requires.") +
      documentEditor(state,"factsheet","English replication factsheet",2,"Prepare one or two pages summarising the pilot, assessment approach, outputs and replication potential.") +
      '<article class="card"><details data-panel-key="template" '+(!template.title?"open":"")+'><summary>Original CESF template'+(template.title?" · "+esc(template.title):"")+'</summary>' + (template.sha256 || template.contentSha256 ? '<p class="help code-wrap">Retained text SHA-256 <code>'+esc(template.sha256 || template.contentSha256)+'</code></p>':"") + templateForm + '</details></article>' +
      '<article class="card"><h3>CESF final delivery report</h3>' + answers + '</article>';
  }
  function renderReadiness(state) {
    const readiness=data(state).readiness;
    if(!readiness || !Array.isArray(readiness.checks)) return "";
    return '<article class="card"><div class="card-heading"><h3>Delivery coverage</h3><span class="badge">'+esc(readiness.complete)+' / '+esc(readiness.total)+' present</span></div><p class="help">Coverage reflects the content retained in this edition. You can export a working draft at any point.</p><div class="table-wrap subsection"><table><thead><tr><th>Deliverable</th><th>Content</th><th>Coverage</th><th>Detail</th></tr></thead><tbody>' + readiness.checks.map(c=>'<tr><td>'+esc(c.deliverable)+'</td><td>'+esc(c.label)+'</td><td>'+esc(c.complete?"Present":"To complete")+'</td><td>'+esc(c.detail)+'</td></tr>').join("") + '</tbody></table></div></article>';
  }

  function originalStreetPanel(state,streetKey) {
    const plan=(state.streetPlans || []).find(p=>p.streetKey===streetKey || p.street===streetKey || p.id===streetKey);
    if(!plan) return "";
    const labels={accessWindows:"Access windows",vehicleCriteria:"Vehicle criteria",loadingSpaces:"Loading spaces",hubLockerConcepts:"Hub and locker concepts",replicationGovernance:"Replication and governance"};
    return '<article class="card subsection"><details><summary>Original retained street plan · '+esc(plan.status || "Saved")+'</summary><p class="help">Original reviewer: '+esc(plan.reviewer || "Not recorded")+'</p><div class="table-wrap"><table><thead><tr><th>Field</th><th>Saved content</th><th>Source</th></tr></thead><tbody>' + Object.entries(plan.fields || {}).map(([name,entry])=>'<tr><td>'+esc(labels[name] || name)+'</td><td class="text-block">'+esc(entry?.value)+'</td><td class="small">'+esc(entry?.source)+'</td></tr>').join("") + '</tbody></table></div></details></article>';
  }
  function originalRoadmapPanel(state) {
    const rows=state.roadmap?.milestones || [];
    if(!rows.length) return "";
    return '<article class="card subsection"><details><summary>Original retained roadmap · '+rows.length+' milestones</summary><div class="table-wrap"><table><thead><tr><th>Year</th><th>Milestone</th><th>Derogation criteria</th><th>Owner / source</th></tr></thead><tbody>' + rows.map(r=>'<tr><td>'+esc(r.year)+'</td><td class="text-block">'+esc(r.milestone)+'</td><td class="text-block">'+esc(r.derogationCriteria)+'</td><td>'+esc(r.owner)+'<br><span class="help">'+esc(r.source)+'</span></td></tr>').join("") + '</tbody></table></div></details></article>';
  }
  const v = (form,name) => $('[name="'+name+'"]',form)?.value || "";
  const pairFrom = (form,name) => ({en:v(form,name+".en"),it:v(form,name+".it")});
  const picks = (form,name) => all('input[name="'+name+'"]:checked',form).map(c=>c.value);
  const simple = (form,names) => Object.fromEntries(names.map(name=>[name,v(form,name)]));
  const reviews = form => ({reviewer:v(form,"reviewer"),status:v(form,"status") || "DRAFT",sourceIds:picks(form,"sourceIds")});
  const selectedScenarios = form => picks(form,"scenarioIds");
  function surveyValue(form) {
    const value=simple(form,["audience","municipalCoordinator","distributionPlan","reminderPlan","reminderRecordedAt","municipalityReference"]);
    value.questions=all("[data-question-id]",form).map(row=>{
      const id=row.dataset.questionId, type=v(row,"q."+id+".type");
      return {id,prompt:v(row,"q."+id+".prompt"),type,options:type==="single"?v(row,"q."+id+".options").split(/\r?\n/).map(s=>s.trim()).filter(Boolean):[]};
    });
    return value;
  }
  function documentValue(form) {
    const pages=all(".document-page",form).map(row=>{
      const i=row.dataset.pageIndex;
      return {title:v(row,"page."+i+".title"),body:v(row,"page."+i+".body"),sourceIds:picks(row,"page."+i+".sourceIds")};
    });
    return {pages,reviewer:v(form,"reviewer"),status:v(form,"status") || "DRAFT"};
  }
  function templateValue(form) {
    const value=simple(form,["title","url","receivedAt","content"]);
    value.sections=all(".template-section",form).map(row=>{
      const idField=$('input[name$=".id"]',row), titleField=$('input[name$=".title"]',row);
      return {id:idField?.value || "",title:titleField?.value || ""};
    });
    return value;
  }
  function request(form) {
    const action=form.dataset.deliveryAction;
    let value={};
    if(action==="deliverySource") value=simple(form,["id","title","url","locator","observedAt","license","note"]);
    else if(action==="deliveryMethod") value={
      tools:["urbane-radar","cert-cityqore"].map(id=>({id,decision:v(form,id+".decision"),dataCompatibility:pairFrom(form,id+".dataCompatibility"),addedValue:pairFrom(form,id+".addedValue"),operatingGuidance:pairFrom(form,id+".operatingGuidance")})),
      agreedMethod:pairFrom(form,"agreedMethod"),cityAgreement:v(form,"cityAgreement"),...reviews(form)
    };
    else if(action==="deliveryScenario") {
      value={id:v(form,"id"),...Object.fromEntries(["definition","deliveryOrganisation","vehicleTypes","infrastructure","innovation","bestPractice"].map(name=>[name,pairFrom(form,name)])),criteria:Object.fromEntries(criteria.map(([id])=>[id,{rating:v(form,"criteria."+id+".rating"),note:pairFrom(form,"criteria."+id+".note")}])) ,...reviews(form)};
    } else if(action==="deliverySelection") value={scenarioIds:selectedScenarios(form),...simple(form,["record","decidedAt","recordedBy","status"])};
    else if(action==="deliveryStreet") value={
      streetKey:v(form,"streetKey"),scenarioIds:selectedScenarios(form),
      ...Object.fromEntries(["accessRules","timeWindows","vehicleCriteria","deliverySpaces","hubLockerConcepts","tramPedestrianIntegration"].map(name=>[name,pairFrom(form,name)])),
      cityValidation:{record:v(form,"cityValidation.record"),date:v(form,"cityValidation.date"),recordedBy:v(form,"cityValidation.recordedBy")},...reviews(form)
    };
    else if(action==="deliveryMilestone") value={
      id:v(form,"id"),year:Number(v(form,"year")),scope:v(form,"scope"),scenarioIds:selectedScenarios(form),
      ...Object.fromEntries(["title","measure","derogationCriteria","incentiveConcept"].map(name=>[name,pairFrom(form,name)])),owner:v(form,"owner"),...reviews(form)
    };
    else if(action==="deliveryGovernance") value={...Object.fromEntries(["replicationMethod","enforcement","roles","sumpAlignment","parkingAlignment","tramAlignment","evChargingAlignment","monitoring"].map(name=>[name,pairFrom(form,name)])),...reviews(form)};
    else if(action==="deliveryInterview") value={...simple(form,["id","title","reviewer"]),streetKeys:picks(form,"streetKeys"),scenarioIds:selectedScenarios(form),finding:pairFrom(form,"finding"),implication:pairFrom(form,"implication"),sourceIds:picks(form,"sourceIds")};
    else if(action==="deliverySurveyPlan") value=surveyValue(form);
    else if(action==="deliveryMeeting") value={...simple(form,["id","title","audience","body","cityReference"]),sourceIds:picks(form,"sourceIds")};
    else if(action==="deliveryDocument") return {action,kind:v(form,"kind"),value:documentValue(form)};
    else if(action==="deliveryTemplate") value=templateValue(form);
    else if(action==="deliveryCesf") value={
      answers:all(".cesf-answer",form).map((row,index)=>({sectionId:row.dataset.sectionId,body:v(row,"answer."+index+".body"),sourceIds:picks(row,"answer."+index+".sourceIds")})),
      reviewer:v(form,"reviewer"),status:v(form,"status") || "DRAFT"
    };
    else throw new Error("This editor has no workspace action.");
    if("id" in value && !value.id) delete value.id;
    return {action,value};
  }
  function cacheStructure(form) {
    if(!form) return;
    const action=form.dataset.deliveryAction;
    if(action==="deliverySurveyPlan") editing.surveyPlan=surveyValue(form);
    else if(action==="deliveryDocument") editing.documents[v(form,"kind")]=documentValue(form);
    else if(action==="deliveryTemplate") editing.template=templateValue(form);
  }
  function clearStructure(formKey) {
    if(formKey==="delivery-survey-plan") editing.surveyPlan=null;
    else if(formKey==="delivery-document-learning") delete editing.documents.learning;
    else if(formKey==="delivery-document-factsheet") delete editing.documents.factsheet;
    else if(formKey==="delivery-template") editing.template=null;
  }
  function rerenderStructure(form) {
    cacheStructure(form);
    context.clearFormDraft(form.dataset.formKey);
    context.render();
  }
  function bind(tab,ctx) {
    context=ctx;
    all("[data-edit-source]").forEach(button=>button.addEventListener("click",()=>{view.source=button.dataset.editSource || null;ctx.render();}));
    all("[data-edit-scenario]").forEach(button=>button.addEventListener("click",()=>{view.scenario=button.dataset.editScenario;ctx.render();}));
    all("[data-edit-street]").forEach(button=>button.addEventListener("click",()=>{view.street=button.dataset.editStreet;ctx.render();}));
    all("[data-edit-milestone]").forEach(button=>button.addEventListener("click",()=>{view.milestone=button.dataset.editMilestone || null;if(!view.milestone)newIds.milestone=createId("milestone");ctx.render();}));
    all("[data-edit-interview]").forEach(button=>button.addEventListener("click",()=>{view.interview=button.dataset.editInterview || null;if(!view.interview)newIds.interview=createId("interview");openPanels.add("interviews");ctx.render();}));
    all("[data-edit-meeting]").forEach(button=>button.addEventListener("click",()=>{view.meeting=button.dataset.editMeeting || null;if(!view.meeting)newIds.meeting=createId("meeting");openPanels.add("meetings");ctx.render();}));
    all("details[data-panel-key]").forEach(details=>details.open=openPanels.has(details.dataset.panelKey));
    all("[data-delivery-action]").forEach(form=>form.addEventListener("submit",async event=>{
      event.preventDefault();
      if(!form.reportValidity()) return;
      try {
        cacheStructure(form);
        const payload=request(form), key=form.dataset.formKey;
        const saved=await ctx.act(payload,{formKey:key,successMessage:saveMessages[payload.action] || "Delivery record saved."});
        if(saved) {
          if(payload.action==="deliveryMilestone")view.milestone=payload.value.id;
          if(payload.action==="deliveryInterview")view.interview=payload.value.id;
          if(payload.action==="deliveryMeeting")view.meeting=payload.value.id;
          if(payload.action==="deliverySource")view.source=payload.value.id;
          clearStructure(key);
          context.render();
        }
      } catch(error) {ctx.message(error.message,"error");}
    }));
    $("#add-survey-question")?.addEventListener("click",event=>{
      const form=event.target.closest("form"), rows=all("[data-question-id]",form);
      if(rows.length>=40) return ctx.message("The Italian instrument supports up to 40 questions.","warning");
      cacheStructure(form);
      editing.surveyPlan.questions.push({id:"q-"+Date.now().toString(36)+"-"+Math.random().toString(36).slice(2,7),prompt:"",type:"text",options:[]});
      ctx.clearFormDraft(form.dataset.formKey);ctx.render();
    });
    all("[data-remove-question]").forEach(button=>button.addEventListener("click",()=>{
      const form=button.closest("form");button.closest("[data-question-id]").remove();rerenderStructure(form);
    }));
    all("[data-add-page]").forEach(button=>button.addEventListener("click",()=>{
      const form=button.closest("form"), kind=button.dataset.addPage, maximum=kind==="learning"?10:2;
      cacheStructure(form);
      if(editing.documents[kind].pages.length>=maximum) return ctx.message("This document already has its maximum number of authored pages.","warning");
      editing.documents[kind].pages.push({title:"",body:"",sourceIds:[]});
      ctx.clearFormDraft(form.dataset.formKey);openPanels.add(kind);ctx.render();
    }));
    all("[data-remove-page]").forEach(button=>button.addEventListener("click",()=>{
      const form=button.closest("form");button.closest(".document-page").remove();rerenderStructure(form);
    }));
    $("#add-template-section")?.addEventListener("click",event=>{
      const form=event.target.closest("form");cacheStructure(form);
      if(editing.template.sections.length>=100) return ctx.message("The retained template supports up to 100 mapped sections.","warning");
      editing.template.sections.push({id:"section-"+Date.now().toString(36),title:""});
      ctx.clearFormDraft(form.dataset.formKey);openPanels.add("template");ctx.render();
    });
    all("[data-remove-template-section]").forEach(button=>button.addEventListener("click",()=>{
      const form=button.closest("form");button.closest(".template-section").remove();rerenderStructure(form);
    }));
    $("#template-file")?.addEventListener("change",async event=>{
      const file=event.target.files?.[0];if(!file) return;
      if(file.size>300000) return ctx.message("Choose a UTF-8 template text file up to 300,000 bytes.","warning");
      try {
        const content=await file.text(), form=event.target.closest("form");
        $('[name="content"]',form).value=content;
        if(!v(form,"title")) $('[name="title"]',form).value=file.name;
        cacheStructure(form);
        ctx.message("Template text loaded. Map the original section headings and save the supplied template.");
      } catch(error) {ctx.message("The template file could not be read: "+error.message,"error");}
    });
  }
  const saveMessages={
    deliverySource:"Source reference retained.",deliveryMethod:"Method assessment saved.",deliveryScenario:"Scenario definition and five-criterion review saved.",
    deliverySelection:"Municipal scenario selection saved.",deliveryStreet:"Street implementation framework saved.",deliveryMilestone:"Transition milestone saved.",
    deliveryGovernance:"Replication and governance framework saved.",deliveryInterview:"Municipal interview analysis saved.",deliverySurveyPlan:"Italian survey plan and instrument saved.",
    deliveryMeeting:"Italian meeting material saved.",deliveryDocument:"Authored document pages saved.",deliveryTemplate:"Original CESF template retained.",deliveryCesf:"CESF section responses saved."
  };
  document.addEventListener("input",event=>cacheStructure(event.target.closest?.("[data-delivery-action]")));
  document.addEventListener("change",event=>cacheStructure(event.target.closest?.("[data-delivery-action]")));
  document.addEventListener("toggle",event=>{if(event.target.matches?.("details[data-panel-key]")) {if(event.target.open)openPanels.add(event.target.dataset.panelKey);else openPanels.delete(event.target.dataset.panelKey);}},true);
  document.addEventListener("click",event=>{const button=event.target.closest?.("[data-discard-form]");if(button)clearStructure(button.dataset.discardForm);});
  function render(tab,state) {
    const views={method,scenarios,streets,roadmap,learning};
    return views[tab]?views[tab](state):empty("Choose a workspace section.");
  }
  window.BolognaDelivery={render,bind,renderSources,renderEngagement,renderReadiness};
})();
