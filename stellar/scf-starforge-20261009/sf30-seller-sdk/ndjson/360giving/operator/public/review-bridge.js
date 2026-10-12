"use strict";
(async () => {
  const query = new URLSearchParams(location.search), editionId = query.get("edition");
  const fragment = location.hash.slice(1);
  const fragmentToken = /^[A-Za-z0-9_-]{43}$/.test(fragment) ? fragment : "";
  let token = fragmentToken;
  try {
    if (fragmentToken) sessionStorage.setItem("sf360-console-token", fragmentToken);
    else token = sessionStorage.getItem("sf360-console-token") || "";
  } catch {}
  if (fragmentToken) history.replaceState(null, "", location.pathname + location.search);
  const feedback = message => { document.getElementById("action-state").textContent = message; };
  async function api(path, options = {}) {
    const response = await fetch(path, {
      ...options, headers: { Authorization: "Bearer " + token, ...(options.headers || {}) }
    });
    const result = await response.json();
    if (!response.ok) throw Error(result.error || "The saved publisher operation could not be opened.");
    return result;
  }
  function remember(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  }
  try {
    if (!editionId) throw Error("Open the review from its saved publisher workspace.");
    const selected = new URLSearchParams({ edition: editionId });
    if (query.get("decision")) selected.set("decision", query.get("decision"));
    const content = await api("/api/review?" + selected);
    document.getElementById("publisher-data").textContent = JSON.stringify(content);
    await new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "/review.js"; script.onload = resolve;
      script.onerror = () => reject(Error("The installed publisher editor could not be opened."));
      document.body.append(script);
    });
    const back = document.createElement("a");
    back.href = "/?" + new URLSearchParams({ dataset: content.edition.dataset, edition: editionId }) + "#" + token;
    back.textContent = "Return to publisher workspace";
    document.querySelector("header").prepend(back);
    const pendingKey = "sf360-review-pending:" + content.workspaceId + ":" + editionId;
    let pending = null;
    try { pending = JSON.parse(localStorage.getItem(pendingKey) || "null"); } catch {}
    if (pending && pending.edition !== editionId) pending = null;
    const save = document.createElement("button");
    save.type = "button"; save.textContent = pending ? "Resume pending save" : "Save review to workspace";
    document.getElementById("download").before(save);
    save.addEventListener("click", async () => {
      save.disabled = true;
      try {
        if (!pending) {
          decisions.changes = readChanges();
          decisions.reviewer = byId("reviewer").value.trim();
          if (!decisions.reviewer) throw Error("Enter the reviewing operator.");
          decisions.reviewedAt = new Date().toISOString();
          pending = { id: "decisions-" + crypto.randomUUID(), edition: editionId,
            raw: JSON.stringify(decisions, null, 2) + "\n", object: null };
          remember(pendingKey, pending); persist();
        }
        feedback("Saving original review " + pending.id + "…");
        if (!pending.object) {
          const result = await api("/api/upload", {
            method: "POST", headers: { "Content-Type": "application/octet-stream" },
            body: new Blob([pending.raw], { type: "application/json" })
          });
          pending.object = result.id; remember(pendingKey, pending);
        }
        const request = { id: pending.id, action: "decisions",
          input: { edition: editionId, object: pending.object } };
        const requestKey = "sf360-request:" + content.workspaceId + ":" + request.id;
        remember(requestKey, request);
        await api("/api/requests", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request) });
        for (;;) {
          const record = await api("/api/request?id=" + encodeURIComponent(request.id));
          if (record.status === "complete") {
            feedback("Review saved to the workspace: " + record.result.id + ". Return to the workspace to create its candidate or complete handoff.");
            try { localStorage.removeItem(pendingKey); localStorage.removeItem(requestKey); } catch {}
            pending = null; save.textContent = "Save review to workspace"; break;
          }
          if (record.status === "interrupted") throw Error(record.error?.message || "Reopen the original saved review request.");
          feedback("Saving review · " + record.status + " · " + request.id);
          await new Promise(resolve => setTimeout(resolve, 700));
        }
      } catch (error) {
        feedback(error.message);
        save.textContent = pending ? "Resume pending save" : "Save review to workspace";
      } finally { save.disabled = false; }
    });
    feedback(pending ? "A previous save is retained. Resume pending save to reopen that exact review request." :
      "Save review to workspace retains the exact decision file for candidate creation and complete handoff.");
  } catch (error) {
    feedback(error.message);
  }
})();
