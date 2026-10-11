/* Original workspace shell, with additive retained-delivery screens. */
(() => {
  "use strict";
  let state = null;
  let active = "baseline";
  let busy = false;
  const drafts = new Map();
  const $ = (selector, root = document) => root.querySelector(selector);
  const all = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const head = (number, title, description) => '<div class="section-head"><div><p class="eyebrow">' + esc(number) + '</p><h2>' + esc(title) + '</h2><p>' + esc(description) + '</p></div></div>';
  const metric = (label, value, note) => '<article class="card"><div class="muted small">' + esc(label) + '</div><div class="metric">' + esc(value) + '</div><div class="help">' + esc(note) + '</div></article>';
  const field = (label, id, value = "", type = "text", attrs = "") => '<div class="field"><label for="' + id + '">' + esc(label) + '</label>' + (type === "textarea" ? '<textarea id="' + id + '" name="' + id + '" ' + attrs + '>' + esc(value) + '</textarea>' : '<input id="' + id + '" name="' + id + '" type="' + type + '" value="' + esc(value) + '" ' + attrs + '>') + '</div>';
  const options = (values, selected) => values.map(value => '<option value="' + esc(value) + '"' + (value === selected ? ' selected' : '') + '>' + esc(value.replaceAll("_", " ")) + '</option>').join("");
  const message = (text, type = "", buttons = []) => {
    const target = $("#message");
    target.className = "message " + type;
    target.innerHTML = '<span>' + esc(text) + '</span><div class="section-actions">' + buttons.map((b, i) => '<button type="button" data-message-button="' + i + '">' + esc(b.label) + '</button>').join("") + '</div>';
    target.hidden = !text;
    buttons.forEach((b, i) => $('[data-message-button="' + i + '"]', target).addEventListener("click", b.action));
  };
  function controlKey(control) {
    const form = control.closest("[data-form-key]");
    if (!form || !control.name || control.type === "file") return null;
    return form.dataset.formKey + "|" + control.name + ((control.type === "checkbox" || control.type === "radio") ? "|" + control.value : "");
  }
  function capture(control) {
    const key = controlKey(control);
    if (key) drafts.set(key, {value:control.value, checked:control.checked, selected:control.multiple ? all("option", control).filter(o => o.selected).map(o => o.value) : null});
  }
  function restoreDrafts() {
    all("input,textarea,select", $("#content")).forEach(control => {
      const saved = drafts.get(controlKey(control));
      if (!saved) return;
      if (control.type === "checkbox" || control.type === "radio") control.checked = saved.checked;
      else if (control.multiple) all("option", control).forEach(o => o.selected = saved.selected.includes(o.value));
      else control.value = saved.value;
    });
  }
  function clearFormDraft(formKey) {
    if (!formKey) return;
    for (const key of drafts.keys()) if (key.startsWith(formKey + "|")) drafts.delete(key);
  }
  async function responseJson(response) {
    let body;
    try { body = await response.json(); } catch (_) { throw new Error("The workspace returned an unreadable response. Your entered work is still open."); }
    if (!response.ok) {
      const error = new Error(body.message || body.error || "The workspace could not complete this request.");
      error.status = response.status;
      throw error;
    }
    return body;
  }
  async function load({quiet = false} = {}) {
    const next = await responseJson(await fetch("/api/state", {cache:"no-store"}));
    if (!next || !Number.isInteger(next.revision) || !next.baseline) throw new Error("The saved workspace response is incomplete.");
    state = next;
    render();
    if (!quiet) message("Saved assessment refreshed. Entered drafts remain available in their sections.");
    return next;
  }
  async function act(payload, {formKey, successMessage = "Saved to the assessment."} = {}) {
    if (busy || !state) return false;
    busy = true;
    all('#content button[type="submit"]').forEach(button => button.disabled = true);
    try {
      const body = await responseJson(await fetch("/api/action", {method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({expectedRevision:state.revision, ...payload})}));
      if (!body.state) throw new Error("The workspace did not return its saved state.");
      state = body.state;
      clearFormDraft(formKey);
      render();
      message(successMessage + " Revision " + state.revision + ".");
      return true;
    } catch (error) {
      if (error.status === 409) {
        try { await load({quiet:true}); } catch (_) {}
        message("Saved work changed. Your draft is preserved; review it against the current revision and save again.", "warning");
      } else message(error.message, "error");
      return false;
    } finally {
      busy = false;
      all('#content button[type="submit"]').forEach(button => button.disabled = false);
    }
  }
  function baseMap(rows) {
    const valid = rows.filter(row => Number.isFinite(row.lon) && Number.isFinite(row.lat));
    if (!valid.length) return '<p class="empty-state">No coordinates are present in the retained point selection.</p>';
    const lons = valid.map(r => r.lon), lats = valid.map(r => r.lat);
    const west = Math.min(...lons), east = Math.max(...lons), south = Math.min(...lats), north = Math.max(...lats);
    const aspect = Math.cos((south + north) / 2 * Math.PI / 180);
    const spanX = Math.max((east - west) * aspect, .00001), spanY = Math.max(north - south, .00001);
    const scale = Math.min(540 / spanX, 280 / spanY);
    const left = (620 - spanX * scale) / 2, top = (350 - spanY * scale) / 2;
    const tones = ["#252525","#777777","#b8b8b8","#ffffff"];
    const keys = Object.keys(state.baseline.streets);
    const circles = valid.map(row => {
      const x = left + (row.lon - west) * aspect * scale, y = top + (north - row.lat) * scale;
      return '<g><circle cx="' + x.toFixed(2) + '" cy="' + y.toFixed(2) + '" r="5.5" fill="' + tones[keys.indexOf(row.streetKey) % tones.length] + '" stroke="#222" stroke-width="1.2"><title>' + esc(row.street.it + " " + row.civic + " · " + row.spaces + " recorded spaces") + '</title></circle></g>';
    }).join("");
    return '<svg role="img" aria-label="Geographic positions of the retained priority-street loading points" viewBox="0 0 620 350"><path d="M28 50V20M22 29L28 20L34 29" fill="none" stroke="#333"/><text x="23" y="65" font-size="11">N</text>' + circles + '<text x="16" y="334" font-size="10" fill="#666">WGS84 · retained point positions · 30 June 2022</text></svg><div class="map-legend">' + keys.map((key, i) => '<span><b style="background:' + tones[i] + '"></b>' + esc(state.baseline.streets[key].it) + '</span>').join("") + '</div>';
  }
  function baseline() {
    const rows = Object.values(state.baseline.streets).map(x => '<tr><td>' + esc(x.it) + '</td><td class="table-numeric">' + x.points + '</td><td class="table-numeric">' + x.spaces + '</td></tr>').join("");
    return head("01 · D1", "Source baseline", "Review the retained municipal loading-bay observations and the four priority streets before recording analysis.") +
      '<div class="grid-three">' + metric("Municipal point records", state.source.records, "Source processed 30 June 2022") + metric("Recorded delivery spaces", state.source.recordedSpaces, "All-city sum in the original snapshot") + metric("Priority-street points", state.baseline.observations.length, "Four streets · " + state.baseline.observations.reduce((total, row) => total + Number(row.spaces || 0), 0) + " recorded spaces") + '</div>' +
      '<div class="grid-two wide-left subsection"><article class="card map-panel"><div class="card-heading"><h3>Retained point locations</h3><span class="badge">June 2022</span></div>' + baseMap(state.baseline.observations) + '</article><article class="card"><h3>Street totals</h3><div class="table-wrap"><table><thead><tr><th>Street</th><th>Points</th><th>Spaces</th></tr></thead><tbody>' + rows + '</tbody></table></div><p class="field-note">The source date travels with every figure and export. Use the evidence review to join subsequent municipal observations.</p><dl class="compact-dl"><dt>License</dt><dd>' + esc(state.source.license) + '</dd><dt>Processed</dt><dd>' + esc(state.source.processedAt) + '</dd><dt>Source digest</dt><dd><code>' + esc(state.source.compressedSha256) + '</code></dd></dl></article></div>' +
      '<section class="card subsection"><div class="card-heading"><h3>Original priority-street records</h3><label class="field"><span class="help">Filter street</span><select id="baseline-filter"><option value="">All four streets</option>' + Object.entries(state.baseline.streets).map(([key,v])=>'<option value="' + esc(key) + '">' + esc(v.it) + '</option>').join("") + '</select></label></div><div class="table-wrap"><table><thead><tr><th>Street / civic</th><th>Source row</th><th>Spaces</th><th>Category</th><th>Layout</th><th>Coordinates</th></tr></thead><tbody id="baseline-records">' + baselineRows("") + '</tbody></table></div></section>';
  }
  function baselineRows(street) {
    return state.baseline.observations.filter(row => !street || row.streetKey === street).map(row => '<tr><td>' + esc(row.street.it + " " + row.civic) + '</td><td>' + row.sourceRow + '</td><td class="table-numeric">' + row.spaces + '</td><td>' + esc(row.category) + '</td><td>' + esc(row.layout) + '</td><td class="small">' + esc(row.lat) + ', ' + esc(row.lon) + '</td></tr>').join("");
  }
  function decisions() {
    return head("02 · EVIDENCE", "Evidence review", "Retain dated observations, record their reviewed relationship, and give assumptions an accountable owner.") +
      state.decisions.map((d, i) => '<article class="card"><p class="eyebrow">Dated observation review</p><h3>' + esc(d.subject) + '</h3><div class="grid-two">' + state.datedObservations.filter(o => d.observationIds.includes(o.id)).map(o => '<div class="field-note"><strong>' + esc(o.observedAt + " · " + o.street + " " + o.civic) + '</strong><p>' + esc(o.description) + '</p><span class="source-chip">' + esc(o.sourceId) + '</span></div>').join("") + '</div><form data-form-key="decision-' + esc(d.id) + '" data-decision="' + esc(d.id) + '"><div class="form-grid"><div class="field"><label for="relationship-' + i + '">Reviewed relationship</label><select name="relationship" id="relationship-' + i + '">' + options(["UNREVIEWED","SEPARATE","SAME_LOCATION","RELATED","SUPERSEDED"], d.relationship) + '</select></div>' + field("Reviewer", "decision-reviewer-" + i, d.reviewer || "", "text", "required maxlength=160") + '<div class="full">' + field("Evidence-linked decision", "decision-note-" + i, d.note, "textarea", "required") + '</div></div><div class="form-actions"><button class="action" type="submit"' + (i===0 ? ' id="save-decision"' : '') + '>Save reviewed decision</button><span class="status">' + esc(d.relationship.replaceAll("_"," ")) + '</span></div></form></article>').join("") +
      '<article class="card"><h3>Record an assumption</h3><form data-form-key="assumption" id="assumption-form"><div class="form-grid">' + field("Title", "a-title", "", "text", "required maxlength=240") + field("Owner", "a-owner", "", "text", "required maxlength=160") + '<div class="full">' + field("Statement", "a-statement", "", "textarea", "required") + '</div><div class="full">' + field("Source URL or retained source ID", "a-source", "", "text", "required maxlength=1000") + '</div></div><div class="form-actions"><button class="action" type="submit" id="add-assumption">Save assumption</button></div></form></article>' +
      '<section class="subsection"><h3>Retained assumptions</h3>' + (state.assumptions.length ? state.assumptions.map(a => '<article class="card"><div class="card-heading"><h3>' + esc(a.title) + '</h3><span class="badge">' + esc(a.status) + '</span></div><p class="text-block">' + esc(a.statement) + '</p><p class="help">' + esc(a.source) + ' · ' + esc(a.owner) + '</p></article>').join("") : '<p class="empty-state">Add the analytical assumptions used in your assessment.</p>') + '</section>' + (window.BolognaDelivery ? window.BolognaDelivery.renderSources(state) : "");
  }
  function survey() {
    const survey = state.survey, cohort = survey.campaign?.targetCohort || "current";
    const completed = survey.responses.filter(r => r.consent === true && r.included !== false && r.complete !== false && (r.cohortId || "current") === cohort).length;
    return head("07 · D1 / D3", "Stakeholder input", "Review the collection plan, retain source responses and connect qualitative findings to the assessment.") +
      (window.BolognaDelivery ? window.BolognaDelivery.renderEngagement(state) : "") +
      '<div class="grid-two subsection"><article class="card"><p class="eyebrow">Included completed responses</p><div class="metric">' + completed + '</div><p>Target ' + survey.targetMin + '–' + survey.targetMax + ' · cohort ' + esc(cohort) + '</p><p class="help">' + survey.responses.length + ' retained responses across all cohorts. Incomplete and excluded responses remain available for review.</p></article><article class="card"><h3>Consultation workspaces</h3><p>Version the questionnaire, import and correct exact source files, code responses and retain bilingual analysis.</p><div class="form-actions"><a class="action" href="/survey">Open survey analyst</a><a class="secondary" href="/interviews">Interviews and validation</a></div><p class="help">Both workspaces use this assessment and its existing publication and backup.</p></article></div>' +
      '<section class="subsection"><h3>Response inventory</h3>' + (survey.responses.length ? '<div class="table-wrap"><table><thead><tr><th>ID</th><th>Cohort</th><th>Status</th><th>Role</th><th>Deliveries / week</th></tr></thead><tbody>' + survey.responses.map(r => '<tr><td>' + esc(r.respondentId) + '</td><td>' + esc(r.cohortId || "current") + '</td><td>' + (r.included === false ? 'Excluded' : r.complete === false ? 'Incomplete' : 'Included complete') + '</td><td>' + esc(r.role) + '</td><td class="table-numeric">' + esc(r.deliveriesPerWeek ?? '—') + '</td></tr>').join("") + '</tbody></table></div>' : '<p class="empty-state">The assessment currently has no supplied survey responses.</p>') + '</section>';
  }
  function publication() {
    const formats = [["zip","Complete delivery package","All current delivery outputs and their retained source references."],["report","Bilingual assessment","Baseline, evidence, scenario assessment and stakeholder summary."],["framework","Street framework and roadmap","Four-street implementation tables, milestones and governance."],["learning","Learning note","Authored English learning and transferability pages."],["factsheet","Replication factsheet","Authored English one- or two-page summary."],["cesf","CESF report","Retained template and section-bound answers."]];
    const cards = formats.map(([format,title,description]) => '<article class="export-card"><h3>' + title + '</h3><p class="help">' + description + '</p><a class="secondary" href="/api/export?format=' + format + '">Download current ' + (format === "zip" ? "ZIP" : "document") + '</a></article>').join("");
    return head("09 · DELIVERY", "Export and publication", "Download the current working assessment or retain an immutable publication with its exact content and revision.") +
      (window.BolognaDelivery ? window.BolognaDelivery.renderReadiness(state) : "") +
      '<div class="export-grid">' + cards + '</div><article class="card subsection"><h3>Freeze an assessment publication</h3><p class="help">A publication retains the assessment exactly as saved, including delivery records, source references and authored document pages.</p><form data-form-key="publication" id="publication-form"><div class="inline-controls">' + field("Publication name", "publication-name", "", "text", "required maxlength=200 placeholder='Assessment review 1'") + '<button class="action" id="publish" type="submit">Freeze current revision</button></div></form></article><section class="subsection"><h3>Retained publications</h3>' +
      (state.publications.length ? state.publications.slice().reverse().map(p => '<article class="card"><div class="card-heading"><h3>' + esc(p.name) + '</h3><span class="badge">Revision ' + p.workspaceRevision + '</span></div><p class="help">' + esc(p.createdAt) + '</p><p class="help code-wrap"><code>' + esc(p.reportSha256) + '</code></p><div class="form-actions">' + formats.map(([format,label]) => '<a class="secondary" href="/api/export?format=' + format + '&amp;publication=' + encodeURIComponent(p.id) + '">' + esc(format === "zip" ? "Complete ZIP" : label) + '</a>').join("") + '</div></article>').join("") : '<p class="empty-state">Freeze a publication when you want to retain an exact assessment edition.</p>') + '</section>';
  }
  function render() {
    if (!state) return;
    $("#revision").textContent = "REV " + state.revision;
    $("#content").setAttribute("aria-busy", "false");
    all("#tabs button").forEach(button => {
      const selected = button.dataset.tab === active;
      button.classList.toggle("active", selected);
      if (selected) button.setAttribute("aria-current","page"); else button.removeAttribute("aria-current");
    });
    const views = {baseline, decisions, survey, publication};
    $("#content").innerHTML = views[active] ? views[active]() : window.BolognaDelivery.render(active, state);
    restoreDrafts();
    bind();
    if (window.BolognaDelivery) window.BolognaDelivery.bind(active, {state, act, load, render, message, clearFormDraft});
  }
  function bind() {
    $("#baseline-filter")?.addEventListener("change", e => $("#baseline-records").innerHTML = baselineRows(e.target.value));
    all("[data-decision]").forEach((form, i) => form.addEventListener("submit", event => {
      event.preventDefault();
      act({action:"reviewDecision", id:form.dataset.decision, relationship:$('[name="relationship"]', form).value, note:$("#decision-note-" + i).value, reviewer:$("#decision-reviewer-" + i).value}, {formKey:form.dataset.formKey, successMessage:"Evidence relationship saved."});
    }));
    $("#assumption-form")?.addEventListener("submit", event => {event.preventDefault(); act({action:"addAssumption",title:$("#a-title").value,statement:$("#a-statement").value,source:$("#a-source").value,owner:$("#a-owner").value}, {formKey:"assumption",successMessage:"Assumption saved."});});
    $("#publication-form")?.addEventListener("submit", event => {event.preventDefault();act({action:"publish",name:$("#publication-name").value},{formKey:"publication",successMessage:"Exact assessment publication retained."});});
  }
  all("#tabs button").forEach(button => button.addEventListener("click", () => {
    active = button.dataset.tab;
    history.replaceState(null,"","#" + active);
    render();
    window.scrollTo({top:0,behavior:"instant"});
  }));
  document.addEventListener("input", event => capture(event.target));
  document.addEventListener("change", event => capture(event.target));
  document.addEventListener("click", event => {
    const button = event.target.closest("[data-discard-form]");
    if (!button) return;
    clearFormDraft(button.dataset.discardForm);
    render();
    message("The entered draft was replaced with its saved version.");
  });
  $("#reload").addEventListener("click", () => load().catch(error => message(error.message,"error")));
  const requested = location.hash.slice(1);
  if (all("#tabs button").some(button => button.dataset.tab === requested)) active = requested;
  window.BolognaWorkspace = {load, act, getState:() => state, message};
  load({quiet:true}).catch(error => {
    $("#content").setAttribute("aria-busy","false");
    $("#content").innerHTML = '<div class="empty-state"><h2>Assessment could not be opened</h2><p>' + esc(error.message) + '</p><p>Use “Refresh saved work” to reconnect to this workspace.</p></div>';
    message(error.message,"error");
  });
})();
