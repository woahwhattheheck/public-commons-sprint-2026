(() => {
  "use strict";
  const config = window.CSKTEngagementPublic;
  if (!config) return;
  const uuid = () => crypto.randomUUID();
  const label = value => String(value || "").replaceAll("_", " ");
  const text = (tag, value, className) => {
    const node = document.createElement(tag);
    node.textContent = value;
    if (className) node.className = className;
    return node;
  };
  const readSaved = key => {
    try { return JSON.parse(sessionStorage.getItem(key) || "null"); } catch { return null; }
  };
  const retain = (key, value) => {
    try {
      if (value === null) sessionStorage.removeItem(key);
      else sessionStorage.setItem(key, JSON.stringify(value));
    } catch { /* The current form retains its in-memory request when tab storage is unavailable. */ }
  };
  async function api(path, input) {
    const url = new URL(config.baseUrl);
    url.searchParams.set("rest_route", "/" + config.namespace + path);
    const response = await fetch(url, {
      method: input === undefined ? "GET" : "POST",
      credentials: "same-origin",
      headers: input === undefined ? { Accept: "application/json" } : { Accept: "application/json", "Content-Type": "application/json" },
      body: input === undefined ? undefined : JSON.stringify(input),
      cache: "no-store"
    });
    let result;
    try { result = await response.json(); }
    catch { throw new Error("The response was interrupted. Keep this form open and retry the same submission."); }
    if (!response.ok) {
      const error = new Error(result.message || "This request could not be completed.");
      error.code = result.code; error.status = response.status; throw error;
    }
    return result;
  }
  function button(labelText, action) {
    const node = text("button", labelText);
    node.type = "button";
    node.addEventListener("click", async () => {
      node.disabled = true;
      try { await action(); }
      catch (error) { message(error.message, node.closest(".cskt-eng-receipt")); }
      finally { node.disabled = false; }
    });
    return node;
  }
  function message(value, host) {
    if (!host) return;
    let status = host.querySelector(".cskt-eng-receipt-status");
    if (!status) {
      status = text("p", "", "cskt-eng-receipt-status");
      status.setAttribute("role", "status");
      status.setAttribute("aria-live", "polite");
      host.append(status);
    }
    status.textContent = value;
  }
  function receiptHost(anchor) {
    let host = document.querySelector("#cskt-eng-private-receipt");
    if (!host) {
      host = document.createElement("section");
      host.id = "cskt-eng-private-receipt";
      host.className = "cskt-eng cskt-eng-receipt";
      (anchor || document.querySelector("main") || document.body).append(host);
    }
    return host;
  }
  async function decide(receipt, action) {
    const key = "cskt-eng-operation:" + receipt.id + ":" + action;
    const input = readSaved(key) || { operationId: uuid(), receiptKey: receipt.receiptKey, action };
    retain(key, input);
    const result = await api("/public/entries/" + receipt.id + "/decide", input);
    retain(key, null);
    showReceipt(result.receipt);
  }
  function showReceipt(receipt, anchor) {
    const host = receiptHost(anchor);
    host.replaceChildren();
    const heading = text("h2", "Your private receipt");
    heading.tabIndex = -1;
    host.append(heading, text("h3", receipt.title), text("p", receipt.message));
    const details = document.createElement("dl");
    const pair = (key, value) => details.append(text("dt", key), text("dd", value));
    pair("Receipt", receipt.id);
    pair("Submitted", new Date(receipt.createdAt).toLocaleString());
    pair("Staff review", label(receipt.state));
    if (receipt.subscription) pair("Newsletter", label(receipt.subscription));
    if (receipt.rsvp) {
      pair("Registration", label(receipt.rsvp.state));
      pair("People", String(receipt.rsvp.partySize));
    }
    if (receipt.mode === "comment") pair("Public comment", label(receipt.publicCommentState));
    host.append(details);
    const link = new URL(config.receiptUrl || config.baseUrl);
    link.hash = "cskt-receipt=" + receipt.id + ":" + receipt.receiptKey;
    const linkLabel = text("label", "Keep this private link");
    linkLabel.htmlFor = "cskt-eng-receipt-link";
    const linkField = document.createElement("input");
    linkField.type = "text"; linkField.readOnly = true;
    linkField.id = "cskt-eng-receipt-link"; linkField.value = link.href;
    host.append(linkLabel, linkField);
    const controls = document.createElement("div");
    controls.className = "cskt-eng-actions";
    controls.append(button("Copy private link", async () => {
      if (navigator.clipboard) await navigator.clipboard.writeText(link.href);
      else { linkField.focus(); linkField.select(); document.execCommand("copy"); }
      message("Private link copied.", host);
    }));
    if (receipt.mode === "newsletter" && receipt.subscription !== "unsubscribed") {
      controls.append(button("Unsubscribe", () => decide(receipt, "unsubscribe")));
    }
    if (receipt.mode === "rsvp" && receipt.rsvp.state !== "cancelled") {
      controls.append(button("Cancel registration", () => decide(receipt, "cancel_registration")));
    }
    if (receipt.mode === "comment" && receipt.publicCommentState !== "withdrawn") {
      controls.append(button("Withdraw publication permission", () => decide(receipt, "withdraw_publication")));
    }
    if (receipt.subscription === "pending_confirmation" || receipt.rsvp?.state === "pending_confirmation") {
      controls.append(button("Request another confirmation email", () => decide(receipt, "resend_confirmation")));
    }
    controls.append(button("Refresh status", async () => {
      const result = await api("/public/entries/" + receipt.id + "/receipt", { receiptKey: receipt.receiptKey });
      showReceipt(result.receipt);
    }));
    host.append(controls);
    history.replaceState(null, "", link.href);
    heading.focus();
  }
  const pending = new Map();
  for (const form of document.querySelectorAll("form[data-cskt-engagement]")) {
    const formId = form.dataset.csktEngagement;
    const savedKey = "cskt-eng-submission:" + formId;
    const stored = readSaved(savedKey);
    if (stored?.input) {
      for (const [name, value] of Object.entries(stored.input)) {
        const field = form.elements.namedItem(name);
        if (!field || ["requestId", "formToken", "formRevision"].includes(name)) continue;
        if (field.type === "checkbox") field.checked = stored.requiresReview ? false : value === true;
        else field.value = value;
      }
      if (!stored.requiresReview) pending.set(formId, stored);
    }
    form.addEventListener("submit", async event => {
      event.preventDefault();
      const submit = form.querySelector('button[type="submit"]');
      const status = form.querySelector(".cskt-eng-form-status");
      submit.disabled = true;
      try {
        const data = new FormData(form);
        const fields = {
          name: String(data.get("name") || ""), email: String(data.get("email") || ""),
          subject: String(data.get("subject") || ""), message: String(data.get("message") || ""),
          displayName: String(data.get("displayName") || ""), partySize: Number(data.get("partySize") || 1),
          consent: data.get("consent") === "1", publicationConsent: data.get("publicationConsent") === "1",
          website: String(data.get("website") || "")
        };
        const signature = JSON.stringify(fields);
        let selected = pending.get(formId);
        if (!selected || selected.signature !== signature) {
          const edition = await api("/public/forms/" + formId);
          if (!edition.available) throw new Error("This form is now closed. Your entered information remains here.");
          if (edition.revision !== Number(data.get("formRevision"))) {
            throw new Error("The published form and its consent information changed. Save your entered text, reload this page, and review the current form.");
          }
          selected = {
            signature,
            input: { ...fields, requestId: uuid(), formRevision: edition.revision, formToken: edition.formToken }
          };
          pending.set(formId, selected);
          retain(savedKey, selected);
        }
        status.textContent = "Recording your submission…";
        const result = await api("/public/forms/" + formId + "/submit", selected.input);
        retain(savedKey, null); pending.delete(formId);
        form.hidden = true;
        showReceipt(result.receipt, form.parentElement);
      } catch (error) {
        if (["engagement_form_expired", "engagement_changed", "engagement_closed"].includes(error.code)) {
          const selected = pending.get(formId);
          if (selected) retain(savedKey, { ...selected, requiresReview: true });
          pending.delete(formId);
        }
        status.textContent = error.message;
        status.tabIndex = -1; status.focus();
      } finally { submit.disabled = false; }
    });
  }
  async function openPrivateLink() {
    const match = location.hash.match(/^#cskt-(receipt|confirm)=([a-f0-9-]{36}):([a-f0-9]{48,64})$/);
    if (!match) return;
    const [, kind, id, token] = match;
    const host = receiptHost();
    if (kind === "receipt") {
      host.replaceChildren(text("p", "Opening your private receipt…"));
      try {
        const result = await api("/public/entries/" + id + "/receipt", { receiptKey: token });
        showReceipt(result.receipt);
      } catch (error) { message(error.message, host); }
    } else {
      host.replaceChildren(text("h2", "Confirm your request"), text("p", "Choose Confirm to finish the request from your email."));
      host.append(button("Confirm", async () => {
        const result = await api("/public/entries/" + id + "/confirm", { token });
        showReceipt(result.receipt);
      }));
      host.scrollIntoView({ block: "start" });
    }
  }
  window.addEventListener("hashchange", openPrivateLink);
  openPrivateLink();
})();
