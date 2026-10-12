(() => {
  "use strict";
  const cfg = window.CSKTEngagement;
  const app = document.getElementById("cskt-eng-app");
  const status = document.getElementById("cskt-eng-status");
  if (!cfg || !app) return;
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const human = value => String(value ?? "").replaceAll("_", " ");
  const uuid = () => crypto.randomUUID();
  const option = (value, title, selected) => '<option value="' + esc(value) + '"' + (String(selected) === String(value) ? " selected" : "") + ">" + esc(title) + "</option>";
  const choices = (values, selected) => values.map(value => option(value, human(value), selected)).join("");
  const date = value => value ? new Date(value).toLocaleString() : "—";
  const utcInput = value => value ? new Date(value).toISOString().slice(0, 16) : "";
  const iso = value => value ? new Date(value + ":00Z").toISOString() : "";
  const state = {
    tab: "forms", forms: [], operator: null, staff: [], parents: [], form: null,
    entries: [], entry: null, entryAfter: 0, entryPrevious: [], entryNext: null,
    entryFilters: { formId: "", state: "", search: "" },
    mail: [], selectedMail: null, mailAfter: 0, mailPrevious: [], mailNext: null,
    mailFilters: { formId: "", state: "", search: "" },
    exportIds: new Set(), transfer: null, mappings: {}, preview: null, receiving: null,
    replaceChanged: false, pending: [], drafts: {}, rendered: null, parentCatalog: {}
  };
  const pendingKey = "cskt-eng-pending-staff:" + cfg.actorId;
  const draftsKey = "cskt-eng-working-drafts:" + cfg.actorId;
  try { state.pending = JSON.parse(sessionStorage.getItem(pendingKey) || "[]"); } catch {}
  try { state.drafts = JSON.parse(sessionStorage.getItem(draftsKey) || "{}"); } catch {}
  const retainPending = () => {
    try { sessionStorage.setItem(pendingKey, JSON.stringify(state.pending)); } catch {}
  };
  const draftFields = {
    form: ["title","mode","state","parentId","opensAt","closesAt","instructions","privacyText","consentText","publicationLabel","notifyEmail","successMessage","capacity","maxParty","autoAttach"],
    entry: ["review-state","assignedTo","staffNotes","public-text","public-name","confirmation-note","reply-subject","reply-message"],
    mail: ["mail-subject","mail-message","mail-outcome","mail-note"]
  };
  function control(name) {
    return document.getElementById("cskt-eng-" + name) || document.querySelector('#cskt-eng-form-editor [name="' + name + '"]');
  }
  function controlValue(node) { return node.type === "checkbox" ? node.checked : node.value; }
  function retainDrafts() {
    try { sessionStorage.setItem(draftsKey, JSON.stringify(state.drafts)); } catch {}
  }
  function activeDraftRecord() {
    if (state.tab === "forms" && state.form && state.operator?.capabilities.publish) return ["form", state.form.data];
    if (state.tab === "entries" && state.entry) return ["entry", state.entry.data];
    if (state.tab === "mail" && state.selectedMail) return ["mail", state.selectedMail.data];
    return null;
  }
  function captureWorkingDrafts() {
    const rendered = state.rendered;
    if (!rendered) return;
    const draft = state.drafts[rendered.key] || { baseRevision: rendered.revision, values: {}, originals: {}, title: rendered.title, seed: rendered.seed };
    for (const [name, original] of Object.entries(rendered.baseline)) {
      const node = control(name);
      if (!node || node.readOnly || node.disabled) continue;
      const current = controlValue(node);
      if (current === original) {
        delete draft.values[name]; delete draft.originals[name];
      } else {
        if (!Object.hasOwn(draft.originals, name)) draft.originals[name] = original;
        draft.values[name] = current;
      }
    }
    if (Object.keys(draft.values).length) { draft.updatedAt = new Date().toISOString(); state.drafts[rendered.key] = draft; }
    else delete state.drafts[rendered.key];
    retainDrafts();
  }
  function restoreWorkingDrafts() {
    const selected = activeDraftRecord();
    if (!selected) { state.rendered = null; return; }
    const [kind, record] = selected, key = kind + ":" + record.id, baseline = {};
    for (const name of draftFields[kind]) {
      const node = control(name);
      if (node && !node.readOnly && !node.disabled) baseline[name] = controlValue(node);
    }
    state.rendered = { key, revision: record.revision, baseline, title: record.title || record.subject || formTitle(record.formId), seed: kind === "form" && record.revision === 0 ? structuredClone(record) : null };
    const draft = state.drafts[key];
    if (!draft) return;
    let changed = false;
    for (const [name, value] of Object.entries(draft.values)) {
      const node = control(name);
      if (!node || node.readOnly || node.disabled) continue;
      if (Object.hasOwn(draft.originals, name) && baseline[name] !== draft.originals[name] && baseline[name] !== value) changed = true;
      if (node.type === "checkbox") node.checked = value === true;
      else node.value = value;
    }
    if (changed) {
      const note = document.createElement("p");
      note.className = "cskt-eng-notice";
      note.textContent = "This record has newer saved values. Your working edits are retained below; review them against the current record before saving.";
      app.prepend(note);
    }
  }
  function acknowledgeDraft(key, submitted) {
    captureWorkingDrafts();
    const draft = state.drafts[key];
    for (const [name, value] of Object.entries(submitted)) {
      const current = state.rendered?.key === key ? control(name) : null;
      const present = current ? controlValue(current) : draft?.values[name];
      if (String(present) !== String(value)) continue;
      if (draft) { delete draft.values[name]; delete draft.originals[name]; }
      if (state.rendered?.key === key && Object.hasOwn(state.rendered.baseline, name)) state.rendered.baseline[name] = present;
    }
    if (draft && !Object.keys(draft.values).length) delete state.drafts[key];
    retainDrafts();
  }
  function workingDraftsView() {
    const records = Object.entries(state.drafts);
    if (!records.length) return "";
    return panel("Working edits", "<p>Your unsaved edits stay with each original record in this browser session.</p>" +
      table(["Record", "Edited", "Continue"], records.map(([key, draft]) => "<tr><td>" + esc(draft.title) + "</td><td>" +
        esc(date(draft.updatedAt)) + "</td><td>" + action("open-draft", "Open working edits", key) + " " + action("discard-draft", "Discard working edits", key) + "</td></tr>")));
  }
  const notice = message => { status.textContent = message; };
  async function api(path, body) {
    const [route, query = ""] = path.split("?", 2);
    const url = new URL(cfg.baseUrl);
    url.searchParams.set("rest_route", "/" + cfg.namespace + route);
    for (const [key, value] of new URLSearchParams(query)) url.searchParams.set(key, value);
    const response = await fetch(url, {
      method: body === undefined ? "GET" : "POST", credentials: "same-origin", cache: "no-store",
      headers: { Accept: "application/json", "X-WP-Nonce": cfg.nonce, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    let result;
    try { result = await response.json(); }
    catch { throw new Error("The native response was interrupted. Resume the retained action to read its existing result."); }
    if (!response.ok) {
      const error = new Error(result.message || "WordPress rejected this operation.");
      error.status = response.status; error.code = result.code; throw error;
    }
    return result;
  }
  async function mutate(path, body, title) {
    const request = { ...body, operationId: body.operationId || uuid() };
    const pending = { path, body: request, title, at: new Date().toISOString() };
    state.pending.push(pending); retainPending();
    try {
      const result = await api(path, request);
      state.pending = state.pending.filter(item => item.body.operationId !== request.operationId);
      retainPending();
      return result;
    } catch (error) {
      if ([400, 401, 403, 404, 409, 413, 422, 429].includes(error.status)) {
        state.pending = state.pending.filter(item => item.body.operationId !== request.operationId);
        retainPending();
      }
      throw error;
    }
  }
  function download(name, body, type = "application/json;charset=utf-8") {
    const blob = new Blob([body], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  function field(name, title, value, type = "text", extra = "") {
    const id = "cskt-eng-" + name;
    return '<div><label for="' + id + '">' + esc(title) + '</label><input id="' + id + '" name="' + name + '" type="' + type + '" value="' + esc(value) + '" ' + extra + "></div>";
  }
  function area(name, title, value, rows = 5, extra = "") {
    const id = "cskt-eng-" + name;
    return '<div><label for="' + id + '">' + esc(title) + '</label><textarea id="' + id + '" name="' + name + '" rows="' + rows + '" ' + extra + ">" + esc(value) + "</textarea></div>";
  }
  function select(name, title, html) {
    const id = "cskt-eng-" + name;
    return '<div><label for="' + id + '">' + esc(title) + '</label><select id="' + id + '" name="' + name + '">' + html + "</select></div>";
  }
  const action = (name, title, id = "", css = "") => '<button type="button" data-action="' + name + '" data-id="' + esc(id) + '"' + (css ? ' class="' + css + '"' : "") + ">" + esc(title) + "</button>";
  const panel = (title, body) => '<section class="cskt-eng-panel"><h2>' + esc(title) + "</h2>" + body + "</section>";
  const table = (headers, rows) => '<div class="cskt-eng-table-wrap"><table><thead><tr>' + headers.map(value => "<th>" + esc(value) + "</th>").join("") + "</tr></thead><tbody>" + (rows.join("") || '<tr><td colspan="' + headers.length + '">No matching records.</td></tr>') + "</tbody></table></div>";
  const formOptions = selected => option("", "All forms", selected) + state.forms.map(row => option(row.data.id, row.data.title, selected)).join("");
  const formTitle = id => state.forms.find(row => row.data.id === id)?.data.title || id;
  function history(record) {
    const rows = [...record.history].reverse().map(item => "<tr><td>" + esc(item.revision) + "</td><td>" + esc(date(item.at)) + "</td><td>" + esc(human(item.action)) + "</td><td>" + esc(item.actor === 0 ? "Public participant" : state.staff.find(s => s.id === item.actor)?.name || "Staff " + item.actor) + "</td></tr>");
    return "<details><summary>Record history</summary>" + table(["Revision", "Time", "Action", "Actor"], rows) + "</details>";
  }
  function tabs() {
    const names = [["forms", "Forms"], ["entries", "Submissions"], ["mail", "Correspondence"], ["receiving", "Export and receiving"]];
    return '<nav class="cskt-eng-tabs" aria-label="Engagement workspace">' + names.filter(([key]) => key !== "receiving" || state.operator?.capabilities.admin).map(([key, title]) =>
      '<button type="button" data-action="tab" data-id="' + key + '"' + (state.tab === key ? ' aria-current="page"' : "") + ">" + title + "</button>").join("") + "</nav>";
  }
  function pendingView() {
    if (!state.pending.length) return "";
    return panel("Retained actions", "<p>Resume the exact request after an interrupted response.</p>" + table(["Action", "Started", "Continue"], state.pending.map((item, index) =>
      "<tr><td>" + esc(item.title) + "</td><td>" + esc(date(item.at)) + "</td><td>" + action("resume", "Resume", index) + "</td></tr>")));
  }
  function formsView() {
    const rows = state.forms.map(row => {
      const form = row.data;
      return "<tr><td>" + action("open-form", form.title, form.id, "cskt-eng-link-button") + "</td><td>" + esc(human(form.mode)) + "</td><td><a href=\"" + esc(form.parent.url) + "\" target=\"_blank\" rel=\"noopener\">" + esc(form.parent.title) + "</a></td><td>" + esc(form.state) + "</td><td>" +
        (form.mode === "rsvp" ? esc(form.occupied) + " / " + (form.capacity ? esc(form.capacity) : "unlimited") : "—") + "</td><td>" + action("form-submissions", "Open submissions", form.id) + "</td></tr>";
    });
    const controls = '<div class="cskt-eng-actions">' + (state.operator?.capabilities.publish ? action("new-form", "Create form", "", "cskt-primary") : "") + action("refresh", "Refresh workspace") + "</div>";
    return controls + table(["Form", "Type", "Associated content", "State", "Confirmed people", "Submissions"], rows) + (state.form ? formEditor() : "");
  }
  function formEditor() {
    const form = state.form.data;
    if (!state.operator.capabilities.publish) {
      return panel("Form: " + form.title,
        "<p>" + esc(human(form.mode)) + " · " + esc(form.state) + " · revision " + esc(form.revision) + "</p>" +
        '<p class="cskt-eng-prose">' + esc(form.instructions) + '</p><h3>Use of submitted information</h3><p class="cskt-eng-prose">' + esc(form.privacyText) +
        '</p><h3>Required consent</h3><p class="cskt-eng-prose">' + esc(form.consentText) + "</p>" +
        '<div class="cskt-eng-actions">' + action("form-submissions", "Open submissions", form.id) + action("close-form", "Close form") + "</div>" + history(form));
    }
    const existingParent = state.drafts['form:' + form.id]?.values.parentId || form.parent?.postId;
    const parents = [...state.parents];
    if (existingParent && !parents.some(parent => String(parent.id) === String(existingParent))) {
      parents.unshift(state.parentCatalog[existingParent] || { id: existingParent, title: form.parent.title || "Resource " + existingParent, state: "selected" });
    }
    const parentOptions = option("", "Choose associated content", existingParent) + parents.map(parent => option(parent.id, parent.title + " (" + parent.state + ")", existingParent)).join("");
    return panel(form.revision ? "Edit form: " + form.title : "Create form",
      '<form id="cskt-eng-form-editor"><div class="cskt-eng-grid">' +
      field("title", "Form title", form.title, "text", 'required maxlength="300"') +
      select("mode", "Type", choices(["contact", "comment", "newsletter", "rsvp"], form.mode)) +
      select("parentId", "Associated content", parentOptions) +
      '<div><label for="cskt-eng-parent-search">Find content</label><div class="cskt-eng-actions"><input id="cskt-eng-parent-search" name="parentSearch" type="text" value="">' + action("search-parents", "Search") + "</div></div>" +
      select("state", "Opening state", choices(["draft", "open", "closed"], form.state)) +
      '<div><label class="cskt-eng-check"><input type="checkbox" name="autoAttach"' + (form.autoAttach ? " checked" : "") + ">Show this form below its associated content</label><p class=\"cskt-eng-muted\">The existing project or notice remains the source of this form’s context.</p></div>" +
      field("opensAt", "Opens (UTC, optional)", utcInput(form.opensAt), "datetime-local") +
      field("closesAt", "Closes (UTC, optional)", utcInput(form.closesAt), "datetime-local") +
      field("capacity", "Event capacity (0 for unlimited)", form.capacity, "number", 'min="0" max="1000000"') +
      field("maxParty", "Maximum people per registration", form.maxParty, "number", 'min="1" max="100"') +
      '<div class="cskt-eng-span"><p class="cskt-eng-muted">Increasing capacity or reopening an event promotes waiting parties in their original order. Existing confirmed registrations remain retained when capacity is reduced.</p></div>' +
      '<div class="cskt-eng-span">' + area("instructions", "Instructions", form.instructions, 5, 'maxlength="12000"') + "</div>" +
      '<div class="cskt-eng-span">' + area("privacyText", "How submitted information is used", form.privacyText, 5, 'maxlength="8000"') + "</div>" +
      '<div class="cskt-eng-span">' + area("consentText", "Consent statement shown beside the required checkbox", form.consentText, 3, 'maxlength="4000"') + "</div>" +
      '<div class="cskt-eng-span">' + area("publicationLabel", "Separate public-comment permission", form.publicationLabel, 3, 'maxlength="2000"') + "</div>" +
      field("notifyEmail", "Staff notification email (optional)", form.notifyEmail, "email", 'maxlength="254"') +
      field("successMessage", "Message on the private receipt", form.successMessage, "text", 'required maxlength="2000"') +
      '</div><div class="cskt-eng-actions"><button type="submit" class="cskt-primary">Save form</button>' + action("close-form", "Close editor") +
      (form.revision ? '<a class="button" href="' + esc(form.parent.url) + '" target="_blank" rel="noopener">Open associated page</a>' : "") + "</div></form>" +
      '<details><summary>Place this form elsewhere in WordPress</summary><p>Use a Shortcode block with:</p><pre>[cskt_engagement id="' + esc(form.id) + '"]</pre></details>' +
      (form.history?.length ? history(form) : ""));
  }
  function filterView(kind, filters) {
    const states = kind === "entries" ? ["new", "in_review", "resolved", "archived", "spam"] : ["draft", "pending", "sending", "accepted", "failed", "cancelled"];
    return '<form id="cskt-eng-' + kind + '-filter"><div class="cskt-eng-grid">' + select(kind + "-formId", "Form", formOptions(filters.formId)) +
      select(kind + "-state", "State", option("", "All states", filters.state) + choices(states, filters.state)) +
      field(kind + "-search", "Search", filters.search) +
      '<div class="cskt-eng-actions"><button type="submit">Apply filters</button></div></div></form>';
  }
  function pagination(kind, previous, next) {
    return '<div class="cskt-eng-actions">' + (previous.length ? action(kind + "-previous", "Previous page") : "") +
      (next !== null ? action(kind + "-next", "Next page") : "") + "</div>";
  }
  function entryView() {
    const rows = state.entries.map(row => {
      const e = row.data;
      return '<tr' + (state.entry?.data.id === e.id ? ' class="cskt-eng-selected"' : "") + "><td>" + action("open-entry", e.submission.name || e.submission.email, e.id, "cskt-eng-link-button") +
        "</td><td>" + esc(formTitle(e.formId)) + "</td><td>" + esc(date(e.createdAt)) + "</td><td>" + esc(human(e.state)) + "</td><td>" + esc(human(e.subscription || e.rsvp?.state || e.publicComment?.state)) + "</td></tr>";
    });
    return filterView("entries", state.entryFilters) + table(["Participant", "Form", "Submitted", "Review", "Participation"], rows) +
      pagination("entries", state.entryPrevious, state.entryNext) + (state.entry ? entryEditor() : "");
  }
  function entryEditor() {
    const e = state.entry.data, form = state.forms.find(row => row.data.id === e.formId)?.data;
    const submission = e.submission;
    const details = '<dl><dt>Form</dt><dd>' + esc(formTitle(e.formId)) + "</dd><dt>Associated content</dt><dd><a href=\"" + esc(form?.parent.url || e.parent.url) + "\" target=\"_blank\" rel=\"noopener\">" + esc(form?.parent.title || e.parent.title) +
      "</a></dd><dt>Submitted</dt><dd>" + esc(date(e.createdAt)) + "</dd><dt>Name</dt><dd>" + esc(submission.name || "—") + "</dd><dt>Email</dt><dd>" + esc(submission.email) +
      "</dd><dt>Subject</dt><dd>" + esc(submission.subject || "—") + "</dd></dl><h3>Original submission</h3><p class=\"cskt-eng-prose\">" + esc(submission.message || "—") + "</p>" +
      '<details><summary>Consent and source edition</summary><p class="cskt-eng-prose">' + esc(e.formSnapshot.privacyText) + '</p><p class="cskt-eng-prose">' + esc(e.formSnapshot.consentText) +
      "</p><p>Form revision " + esc(e.formRevision) + "; submitted " + esc(date(e.createdAt)) + ".</p>" +
      (e.mode === "comment" ? "<p>Public comment permission: " + (e.publicationPermissionWithdrawnAt ? "Withdrawn " + date(e.publicationPermissionWithdrawnAt) + " (original permission retained)" : submission.publicationConsent ? "Granted" : "Not granted") + "</p>" : "") + "</details>";
    const staffOptions = option(0, "Unassigned", e.assignedTo) + state.staff.map(person => option(person.id, person.name, e.assignedTo)).join("");
    const review = '<form id="cskt-eng-review"><div class="cskt-eng-grid">' +
      select("review-state", "Review state", choices(["new", "in_review", "resolved", "archived", "spam"], e.state)) +
      select("assignedTo", "Assigned staff member", staffOptions) +
      '<div class="cskt-eng-span">' + area("staffNotes", "Staff notes", e.staffNotes, 5, 'maxlength="20000"') + "</div></div>" +
      '<p class="cskt-eng-muted">Archiving or marking spam withdraws public comments, newsletter participation and event reservations for this submission.</p>' +
      '<div class="cskt-eng-actions"><button type="submit" class="cskt-primary">Save review</button>' + action("entry-mail", "Open correspondence", e.id) + "</div></form>";
    let workflow = "";
    if (e.mode === "comment") {
      workflow = panel("Reviewed public comment", '<p>Publication: ' + esc(human(e.publicComment.state)) + "</p>" +
        area("public-text", "Text to publish", e.publicComment.text || submission.message, 7, 'maxlength="20000"') +
        field("public-name", "Public display name", e.publicComment.displayName || submission.displayName, "text", 'maxlength="200"') +
        '<div class="cskt-eng-actions">' +
        (state.operator.capabilities.publish && submission.publicationConsent && !e.publicationPermissionWithdrawnAt ? action("publish-comment", "Publish reviewed comment", "", "cskt-primary") : "") +
        (e.publicComment.state === "published" ? action("withdraw-comment", "Withdraw publication") : "") + "</div>");
    } else if (e.mode === "newsletter") {
      workflow = panel("Newsletter participation", "<p>State: <strong>" + esc(human(e.subscription)) + "</strong></p><p>Email confirmed: " + esc(date(e.verification?.confirmedAt)) + "</p>" +
        '<div class="cskt-eng-actions">' + (e.subscription === "pending_confirmation" && !e.verification?.revokedAt ? action("resend-confirmation", "Send new confirmation link") : "") +
        action("csv-subscribers", "Export confirmed subscribers", e.formId) + "</div>");
    } else if (e.mode === "rsvp") {
      const active = ["pending_confirmation", "waitlisted"].includes(e.rsvp.state);
      workflow = panel("Event registration", "<dl><dt>State</dt><dd>" + esc(human(e.rsvp.state)) + "</dd><dt>People</dt><dd>" + esc(e.rsvp.partySize) +
        "</dd><dt>Confirmed</dt><dd>" + esc(date(e.rsvp.confirmedAt)) + "</dd><dt>Attended</dt><dd>" + esc(date(e.rsvp.attendedAt)) + "</dd></dl>" +
        (active ? area("confirmation-note", "Basis for a staff confirmation", "", 3, 'maxlength="4000"') : "") +
        '<div class="cskt-eng-actions">' +
        (active ? action("confirm-registration", "Confirm registration") : "") +
        (e.rsvp.state === "confirmed" ? action("check-in", "Check in") : "") +
        (e.rsvp.state !== "cancelled" ? action("cancel-registration", "Cancel registration") : "") +
        (e.rsvp.state === "pending_confirmation" ? action("resend-confirmation", "Send new confirmation link") : "") +
        action("csv-attendance", "Export attendance", e.formId) + "</div>");
    }
    const reply = panel("Staff response", '<p>Recipient: ' + esc(submission.email) + "</p>" +
      field("reply-subject", "Subject", e.responseDraft?.subject || "Re: " + (submission.subject || formTitle(e.formId)), "text", 'maxlength="500"') +
      area("reply-message", "Message", e.responseDraft?.message || "", 8, 'maxlength="40000"') +
      '<div class="cskt-eng-actions">' + action("prepare-reply", "Prepare response", "", "cskt-primary") + "</div>");
    return panel("Submission review", details + review + history(e)) + workflow + reply;
  }
  function mailView() {
    const rows = state.mail.map(row => {
      const mail = row.data;
      return "<tr><td>" + action("open-mail", mail.subject, mail.id, "cskt-eng-link-button") + "</td><td>" + esc(mail.to) + "</td><td>" + esc(human(mail.kind)) +
        "</td><td>" + esc(human(mail.state)) + (mail.dispatchDisabled ? " · received history" : "") + "</td><td>" + esc(date(mail.updatedAt)) + "</td></tr>";
    });
    return filterView("mail", state.mailFilters) + table(["Subject", "Recipient", "Purpose", "State", "Updated"], rows) +
      pagination("mail", state.mailPrevious, state.mailNext) + (state.selectedMail ? mailEditor() : "");
  }
  function mailEditor() {
    const mail = state.selectedMail.data;
    const editable = mail.kind === "staff_reply" && ["draft", "failed"].includes(mail.state) && !mail.dispatchDisabled;
    const attemptRows = mail.attempts.map(item => "<tr><td>" + esc(date(item.startedAt)) + "</td><td>" + esc(date(item.completedAt)) + "</td><td>" + esc(human(item.outcome)) + "</td><td>" + esc(item.reconciliation?.note || "") + "</td></tr>");
    return panel("Correspondence", "<dl><dt>Recipient</dt><dd>" + esc(mail.to) + "</dd><dt>Form</dt><dd>" + esc(formTitle(mail.formId)) +
      "</dd><dt>State</dt><dd>" + esc(human(mail.state)) + "</dd><dt>Transport</dt><dd>WordPress mail</dd></dl>" +
      (mail.dispatchDisabled ? '<p class="cskt-eng-notice">This message is retained from the received source. A new staff response uses this site’s configured transport.</p>' : "") +
      field("mail-subject", "Subject", mail.subject, "text", 'maxlength="500"' + (editable ? "" : " readonly")) +
      area("mail-message", "Message", mail.message, 12, 'maxlength="40000"' + (editable ? "" : " readonly")) +
      '<div class="cskt-eng-actions">' + (editable ? action("save-mail", "Save draft") : "") +
      (!mail.dispatchDisabled && ["draft", "pending", "failed"].includes(mail.state) ? action("send-mail", "Send saved message", "", "cskt-primary") : "") +
      (!["sending", "accepted", "cancelled"].includes(mail.state) ? action("cancel-mail", "Cancel message") : "") +
      (mail.kind === "staff_reply" ? action("copy-mail", "Prepare another response") : action("mail-entry", "Open submission", mail.entryId)) + "</div>" +
      (mail.state === "sending" && state.operator.capabilities.admin ?
        panel("Reconcile the transport attempt", "<p>Use the installed mail transport’s result for this same sending attempt.</p>" +
          select("mail-outcome", "Observed outcome", choices(["accepted", "failed"], "accepted")) +
          area("mail-note", "Transport observation", "", 4, 'maxlength="4000"') +
          '<div class="cskt-eng-actions">' + action("reconcile-mail", "Save observed outcome") + "</div>") : "") +
      (mail.attempts.length ? table(["Started", "Completed", "Outcome", "Staff observation"], attemptRows) : "") + history(mail));
  }
  function receivingView() {
    const exportRows = state.forms.map(row => "<tr><td><input type=\"checkbox\" data-export-form=\"" + esc(row.data.id) + "\" aria-label=\"Select " + esc(row.data.title) + "\"" +
      (state.exportIds.has(row.data.id) ? " checked" : "") + "></td><td>" + esc(row.data.title) + "</td><td>" + esc(human(row.data.mode)) + "</td><td>" +
      action("csv-submissions", "Submissions CSV", row.data.id) +
      (row.data.mode === "newsletter" ? " " + action("csv-subscribers", "Subscriber CSV", row.data.id) : "") +
      (row.data.mode === "rsvp" ? " " + action("csv-attendance", "Attendance CSV", row.data.id) : "") +
      (row.data.mode === "comment" ? " " + action("csv-public_comments", "Published comments CSV", row.data.id) : "") + "</td></tr>");
    let receive = '<p>Choose the complete engagement transfer. It carries selected forms, submissions, consent, reservations and correspondence.</p>' +
      '<label for="cskt-eng-transfer-file">Workspace JSON file</label><input id="cskt-eng-transfer-file" type="file" accept=".json,application/json">';
    if (state.transfer) {
      const workspace = state.transfer.workspace;
      const parentItems = Object.values(Object.fromEntries(workspace.forms.map(form => [form.parent.postId, form.parent])));
      receive += "<p>Source: " + esc(workspace.origin) + " · " + workspace.forms.length + " forms · " + workspace.entries.length + " submissions · " + workspace.mail.length + " messages.</p>" +
        '<h3>Associated content on this WordPress site</h3><p>Each original project or notice maps to its selected native resource here.</p>' +
        '<div class="cskt-eng-actions"><input id="cskt-eng-receive-parent-search" type="text" aria-label="Find destination content">' + action("receive-search-parents", "Find content") + "</div>";
      receive += table(["Original resource", "Destination resource"], parentItems.map(parent =>
        "<tr><td>" + esc(parent.title) + '</td><td><select data-parent-map="' + esc(parent.postId) + '">' + option("", "Choose destination", state.mappings[parent.postId]) +
        state.parents.map(item => option(item.id, item.title + " (" + item.state + ")", state.mappings[parent.postId])).join("") + "</select></td></tr>"));
      receive += '<label class="cskt-eng-check"><input id="cskt-eng-replace-changed" type="checkbox"' + (state.replaceChanged ? " checked" : "") + ">Replace changed selected records after reviewing the preview</label>" +
        '<div class="cskt-eng-actions">' + action("receive-preview", "Preview receiving", "", "cskt-primary") + "</div>";
    }
    if (state.preview) {
      receive += "<h3>Receiving preview</h3>" + table(["Record", "Type", "Decision", "Source revision", "Current revision"], state.preview.changes.map(item =>
        "<tr><td>" + esc(item.id) + "</td><td>" + esc(item.kind) + "</td><td>" + esc(item.action) + "</td><td>" + esc(item.sourceRevision) + "</td><td>" + esc(item.currentRevision ?? "—") + "</td></tr>")) +
        '<div class="cskt-eng-actions">' + (state.preview.counts.conflict === 0 ? action("receive-apply", "Apply reviewed receiving", "", "cskt-primary") : "<p>Review the changed selected records before applying.</p>") + "</div>";
    }
    if (state.receiving) {
      receive += "<h3>Received workspace</h3><p>" + esc(date(state.receiving.receivedAt)) + " · " + state.receiving.records.length + " complete native records.</p>" +
        '<div class="cskt-eng-actions">' + action("download-receiving", "Download receiving result") + action("refresh", "Reopen workspace") + "</div>";
    }
    return panel("Export complete forms", '<p>The complete JSON includes private submissions, receipt links, consent and staff correspondence. Store it with the project’s administrative backups.</p>' +
      table(["Select", "Form", "Type", "Operating CSV"], exportRows) +
      '<div class="cskt-eng-actions">' + action("export", "Download complete selected forms", "", "cskt-primary") + "</div>") + panel("Receive a workspace", receive);
  }
  function render() {
    captureWorkingDrafts();
    const body = state.tab === "forms" ? formsView() : state.tab === "entries" ? entryView() : state.tab === "mail" ? mailView() : receivingView();
    app.innerHTML = tabs() + pendingView() + workingDraftsView() + body;
    restoreWorkingDrafts();
  }
  async function refresh() {
    state.operator = await api("/inspect");
    state.forms = state.operator.forms;
    if (!state.staff.length) state.staff = (await api("/staff")).items;
    if (state.form?.data.revision) state.form = await api("/forms/" + state.form.data.id);
    if (state.entry) state.entry = await api("/entries/" + state.entry.data.id);
    if (state.selectedMail) state.selectedMail = await api("/mail/" + state.selectedMail.data.id);
    render();
  }
  async function parents(search = "") {
    state.parents = (await api("/parents?search=" + encodeURIComponent(search))).items;
    for (const parent of state.parents) state.parentCatalog[parent.id] = parent;
  }
  async function loadEntries(reset = false) {
    if (reset) { state.entryAfter = 0; state.entryPrevious = []; }
    const query = new URLSearchParams({ ...state.entryFilters, after: String(state.entryAfter) });
    const page = await api("/entries?" + query);
    state.entries = page.items; state.entryNext = page.next;
  }
  async function loadMail(reset = false) {
    if (reset) { state.mailAfter = 0; state.mailPrevious = []; }
    const query = new URLSearchParams({ ...state.mailFilters, after: String(state.mailAfter) });
    const page = await api("/mail?" + query);
    state.mail = page.items; state.mailNext = page.next;
  }
  const value = name => document.getElementById("cskt-eng-" + name)?.value ?? "";
  async function entryAction(name, extra = {}) {
    const entry = state.entry.data;
    const result = await mutate("/entries/" + entry.id + "/decide", {
      action: name, expectedRevision: entry.revision, ...extra
    }, human(name) + ": " + formTitle(entry.formId));
    const acknowledged = name === "review" ? { "review-state": extra.state, assignedTo: extra.assignedTo, staffNotes: extra.staffNotes } :
      name === "publish_comment" ? { "public-text": extra.text, "public-name": extra.displayName } :
      name === "prepare_reply" ? { "reply-subject": extra.subject, "reply-message": extra.message } :
      name === "confirm_registration" ? { "confirmation-note": extra.note } : {};
    acknowledgeDraft("entry:" + entry.id, acknowledged);
    state.entry = result.record;
    await loadEntries(); await refresh();
    notice("Saved " + human(name) + " at revision " + result.record.data.revision + ".");
    return result;
  }
  async function mailAction(name, extra = {}) {
    const mail = state.selectedMail.data;
    const result = await mutate("/mail/" + mail.id + "/decide", { action: name, expectedRevision: mail.revision, ...extra }, human(name) + ": " + mail.subject);
    acknowledgeDraft("mail:" + mail.id, name === "save_draft" ? { "mail-subject": extra.subject, "mail-message": extra.message } :
      name === "reconcile" ? { "mail-outcome": extra.outcome, "mail-note": extra.note } : {});
    state.selectedMail = result.record;
    await loadMail(); render();
    notice("Correspondence saved.");
    return result;
  }
  function captureForm() {
    const element = document.getElementById("cskt-eng-form-editor");
    const data = new FormData(element);
    const old = state.form.data;
    return { ...old, title: data.get("title"), mode: data.get("mode"), state: data.get("state"),
      parent: { ...old.parent, postId: Number(data.get("parentId")) },
      opensAt: iso(String(data.get("opensAt") || "")), closesAt: iso(String(data.get("closesAt") || "")),
      instructions: data.get("instructions"), privacyText: data.get("privacyText"), consentText: data.get("consentText"),
      publicationLabel: data.get("publicationLabel"), notifyEmail: data.get("notifyEmail"),
      successMessage: data.get("successMessage"), capacity: Number(data.get("capacity")),
      maxParty: Number(data.get("maxParty")), autoAttach: data.get("autoAttach") === "on" };
  }
  const handlers = {
    async "open-draft"(key) {
      const [kind, id] = key.split(":");
      if (kind === "form") { const draft = state.drafts[key]; state.form = draft?.seed ? { data: structuredClone(draft.seed) } : await api("/forms/" + id); state.tab = "forms"; await parents(); }
      if (kind === "entry") { state.entry = await api("/entries/" + id); state.tab = "entries"; await loadEntries(true); }
      if (kind === "mail") { state.selectedMail = await api("/mail/" + id); state.tab = "mail"; await loadMail(true); }
      render();
    },
    "discard-draft"(key) {
      captureWorkingDrafts(); delete state.drafts[key];
      if (state.rendered?.key === key) state.rendered = null;
      retainDrafts(); render(); notice("Working edits discarded; current saved values are shown.");
    },
    async tab(id) {
      state.tab = id; notice("");
      if (id === "entries") await loadEntries(true);
      if (id === "mail") await loadMail(true);
      if (id === "receiving" && !state.parents.length) await parents();
      render();
    },
    async refresh() { await refresh(); if (state.tab === "entries") await loadEntries(); if (state.tab === "mail") await loadMail(); render(); notice("Native workspace reopened."); },
    async "new-form"() {
      await parents();
      state.form = { data: {
        id: uuid(), revision: 0, title: "", mode: "contact", state: "draft", parent: { postId: "", title: "" },
        opensAt: "", closesAt: "", capacity: 0, maxParty: 1, autoAttach: true,
        instructions: "", privacyText: "", consentText: "", notifyEmail: "",
        successMessage: "Your submission has been recorded.",
        publicationLabel: "You may publish the reviewed text of my comment and my chosen display name.", history: []
      } };
      render(); document.getElementById("cskt-eng-title").focus();
    },
    async "open-form"(id) { state.form = await api("/forms/" + id); if (state.operator.capabilities.publish) await parents(); render(); },
    "close-form"() { state.form = null; render(); },
    async "search-parents"() { captureWorkingDrafts(); await parents(value("parent-search")); render(); },
    async "form-submissions"(id) { state.tab = "entries"; state.entryFilters.formId = id; state.entry = null; await loadEntries(true); render(); },
    async "open-entry"(id) { state.entry = await api("/entries/" + id); render(); document.querySelector("#cskt-eng-review")?.scrollIntoView({ block: "start" }); },
    async "entries-next"() { state.entryPrevious.push(state.entryAfter); state.entryAfter = state.entryNext; await loadEntries(); render(); },
    async "entries-previous"() { state.entryAfter = state.entryPrevious.pop() || 0; await loadEntries(); render(); },
    async "publish-comment"() { await entryAction("publish_comment", { text: value("public-text"), displayName: value("public-name") }); },
    async "withdraw-comment"() { await entryAction("withdraw_comment"); },
    async "resend-confirmation"() { await entryAction("resend_confirmation"); },
    async "confirm-registration"() { await entryAction("confirm_registration", { note: value("confirmation-note") }); },
    async "cancel-registration"() { await entryAction("cancel_registration"); },
    async "check-in"() { await entryAction("check_in"); },
    async "prepare-reply"() {
      const result = await entryAction("prepare_reply", { subject: value("reply-subject"), message: value("reply-message") });
      state.selectedMail = await api("/mail/" + result.mail.id);
      state.tab = "mail"; state.mailFilters.search = result.mail.entryId; await loadMail(true); render();
      notice("Response prepared. Review the saved message before sending.");
    },
    async "entry-mail"(id) { state.tab = "mail"; state.mailFilters.search = id; state.mailFilters.formId = ""; state.selectedMail = null; await loadMail(true); render(); },
    async "open-mail"(id) { state.selectedMail = await api("/mail/" + id); render(); },
    async "mail-next"() { state.mailPrevious.push(state.mailAfter); state.mailAfter = state.mailNext; await loadMail(); render(); },
    async "mail-previous"() { state.mailAfter = state.mailPrevious.pop() || 0; await loadMail(); render(); },
    async "mail-entry"(id) { state.entry = await api("/entries/" + id); state.tab = "entries"; state.entryFilters.formId = state.entry.data.formId; await loadEntries(true); render(); },
    async "save-mail"() { await mailAction("save_draft", { subject: value("mail-subject"), message: value("mail-message") }); },
    async "send-mail"() {
      const current = state.selectedMail.data;
      if (current.kind === "staff_reply" && !current.dispatchDisabled && ["draft", "failed"].includes(current.state) &&
          (current.subject !== value("mail-subject") || current.message !== value("mail-message"))) {
        await mailAction("save_draft", { subject: value("mail-subject"), message: value("mail-message") });
      }
      const mail = state.selectedMail.data;
      const result = await mutate("/mail/" + mail.id + "/send", { expectedRevision: mail.revision }, "Send: " + mail.subject);
      state.selectedMail = result.record;
      await loadMail(); render(); notice("WordPress mail result: " + human(result.record.data.state) + ".");
    },
    async "cancel-mail"() { await mailAction("cancel"); },
    async "copy-mail"() {
      const result = await mailAction("new_copy");
      state.selectedMail = await api("/mail/" + result.copy.id); await loadMail(); render();
    },
    async "reconcile-mail"() { await mailAction("reconcile", { outcome: value("mail-outcome"), note: value("mail-note") }); },
    async export() {
      if (!state.exportIds.size) throw new Error("Select complete forms to export.");
      const result = await api("/export", { formIds: [...state.exportIds] });
      download("CSKT_Engagement_Workspace_" + new Date().toISOString().slice(0, 10) + ".json", JSON.stringify(result, null, 2) + "\n");
      notice("Exported " + result.counts.forms + " forms, " + result.counts.entries + " submissions and " + result.counts.mail + " messages.");
    },
    async "receive-search-parents"() { await parents(value("receive-parent-search")); state.preview = null; render(); },
    async "receive-preview"() {
      if (!state.transfer) throw new Error("Choose the complete workspace JSON first.");
      const mappings = {};
      for (const [source, target] of Object.entries(state.mappings)) if (target !== "") mappings[source] = Number(target);
      state.preview = await api("/receive/preview", { transfer: state.transfer, parentMappings: mappings, replaceChanged: state.replaceChanged });
      state.receiving = null; render();
      notice("The complete source and current destination records are ready for review.");
    },
    async "receive-apply"() {
      const preview = state.preview;
      const result = await mutate("/receive/apply", { previewId: preview.id, sha256: preview.sha256 }, "Receive selected engagement forms");
      state.receiving = result.result; state.preview = null;
      await refresh(); notice("Received " + result.result.records.length + " complete native records.");
    },
    "download-receiving"() { download("CSKT_Engagement_Receiving_" + state.receiving.operationId + ".json", JSON.stringify(state.receiving, null, 2) + "\n"); },
    async resume(id) {
      const pending = state.pending[Number(id)];
      if (!pending) return;
      const result = await api(pending.path, pending.body);
      state.pending = state.pending.filter(item => item.body.operationId !== pending.body.operationId); retainPending();
      await refresh(); notice("Retained action reopened: " + pending.title + ".");
      if (result.record?.data.schema === "cskt.engagement.entry.v1") { state.entry = result.record; state.tab = "entries"; await loadEntries(true); }
      if (result.record?.data.schema === "cskt.engagement.mail.v1") { state.selectedMail = result.record; state.tab = "mail"; await loadMail(true); }
      const createdMail = result.copy || result.mail;
      if (createdMail?.id) {
        state.selectedMail = await api("/mail/" + createdMail.id);
        state.tab = "mail"; state.mailFilters.search = createdMail.entryId;
        state.mailFilters.formId = ""; state.mailFilters.state = ""; await loadMail(true);
      }
      if (result.result?.schema === "cskt.engagement.received.v1") { state.receiving = result.result; state.tab = "receiving"; }
      render();
    }
  };
  app.addEventListener("click", async event => {
    const target = event.target.closest("[data-action]");
    if (!target) return;
    const name = target.dataset.action, id = target.dataset.id || "";
    captureWorkingDrafts();
    target.disabled = true;
    try {
      if (name.startsWith("csv-")) {
        const result = await api("/export-csv", { formId: id, kind: name.slice(4) });
        download(result.filename, result.content, result.mimeType);
        notice("Downloaded " + result.rows + " rows.");
      } else if (handlers[name]) await handlers[name](id);
    } catch (error) { notice(error.message + (state.pending.length ? " The exact action is retained; use Refresh workspace to reopen it." : "")); }
    finally { target.disabled = false; }
  });
  app.addEventListener("submit", async event => {
    event.preventDefault();
    const element = event.target;
    try {
      if (element.id === "cskt-eng-form-editor") {
        if (!element.reportValidity()) return;
        const values = captureForm();
        const acknowledged = Object.fromEntries(draftFields.form.map(name => [name, control(name)]).filter(([, node]) => node).map(([name, node]) => [name, controlValue(node)]));
        const result = await mutate("/forms", {
          id: values.id, expectedRevision: state.form.data.revision,
          form: { ...values, parentId: values.parent.postId }
        }, "Save form: " + values.title);
        acknowledgeDraft("form:" + values.id, acknowledged);
        if (state.drafts["form:" + values.id]) delete state.drafts["form:" + values.id].seed;
        retainDrafts();
        state.form = result.record; await refresh(); notice("Form saved at revision " + result.record.data.revision + ".");
      } else if (element.id === "cskt-eng-review") {
        await entryAction("review", { state: value("review-state"), assignedTo: Number(value("assignedTo")), staffNotes: value("staffNotes") });
      } else if (element.id === "cskt-eng-entries-filter") {
        state.entryFilters = { formId: value("entries-formId"), state: value("entries-state"), search: value("entries-search") };
        await loadEntries(true); render();
      } else if (element.id === "cskt-eng-mail-filter") {
        state.mailFilters = { formId: value("mail-formId"), state: value("mail-state"), search: value("mail-search") };
        await loadMail(true); render();
      }
    } catch (error) { notice(error.message); }
  });
  app.addEventListener("input", captureWorkingDrafts);
  window.addEventListener("beforeunload", captureWorkingDrafts);
  app.addEventListener("change", async event => {
    captureWorkingDrafts();
    const target = event.target;
    if (target.dataset.exportForm) {
      if (target.checked) state.exportIds.add(target.dataset.exportForm);
      else state.exportIds.delete(target.dataset.exportForm);
    }
    if (target.dataset.parentMap) { state.mappings[target.dataset.parentMap] = target.value; state.preview = null; render(); }
    if (target.id === "cskt-eng-replace-changed") { state.replaceChanged = target.checked; state.preview = null; render(); }
    if (target.id === "cskt-eng-transfer-file") {
      try {
        const file = target.files[0];
        if (!file) return;
        if (file.size > 33 * 1024 * 1024) throw new Error("Select a complete engagement transfer of at most 33 MiB.");
        const transfer = JSON.parse(await file.text());
        if (transfer.schema !== "cskt.engagement.transfer.v1" || !Array.isArray(transfer.workspace?.forms)) throw new Error("Choose a complete engagement transfer JSON.");
        state.transfer = transfer; state.preview = null; state.receiving = null; state.mappings = {};
        if (!state.parents.length) await parents();
        const same = new URL(transfer.workspace.origin).href.replace(/\/$/, "") === new URL(cfg.baseUrl).href.replace(/\/$/, "");
        for (const form of transfer.workspace.forms) state.mappings[form.parent.postId] = same ? form.parent.postId : "";
        render();
      } catch (error) { notice(error.message); }
    }
  });
  refresh().then(async () => {
    const match = location.hash.match(/^#entry=([a-f0-9-]{36})$/);
    if (match) {
      state.entry = await api("/entries/" + match[1]); state.tab = "entries";
      state.entryFilters.formId = state.entry.data.formId; await loadEntries(true); render();
    }
  }).catch(error => notice(error.message));
})();
