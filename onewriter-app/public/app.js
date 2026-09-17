const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const TOKEN_KEY = "onewriter.session.token";
let state = null;
let sessionToken = sessionStorage.getItem(TOKEN_KEY) || "";

function text(value) {
  return value === null || value === undefined ? "—" : String(value);
}
function short(value, n = 12) {
  const s = text(value);
  return s.length <= n ? s : `${s.slice(0, n)}…`;
}
function esc(value) {
  return text(value).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}
function formObject(form) {
  return Object.fromEntries(new FormData(form).entries());
}
function eventPayload(form) {
  const value = formObject(form);
  value.provider_receipt = value.provider_receipt.trim() || null;
  value.human_evidence_id = value.human_evidence_id.trim() || null;
  return value;
}
function claimPayload(form) {
  const value = formObject(form);
  value.lease_seconds = Number(value.lease_seconds);
  return value;
}
function authHeaders() {
  if (!sessionToken) throw new Error("authenticated session token required");
  return { Authorization: `Bearer ${sessionToken}` };
}
async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    credentials: "omit",
    headers: { "content-type": "application/json", ...authHeaders(), ...(options.headers || {}) },
  });
  const body = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
  if (!response.ok) {
    const error = new Error(body.error || `HTTP ${response.status}`);
    error.body = body;
    error.status = response.status;
    throw error;
  }
  return body;
}
function setSessionStatus(principal = null) {
  const status = $("#session-status");
  if (!sessionToken) {
    status.textContent = "Not authenticated";
    return;
  }
  if (!principal) {
    status.textContent = "Token loaded; state not verified";
    return;
  }
  status.textContent = `${principal.subject} · ${principal.roles.join(", ")}`;
}
async function refresh() {
  state = await api("/api/state", { method: "GET" });
  setSessionStatus(state.principal);
  $("#server-time").textContent = `server ${new Date(state.server_time_utc).toLocaleString()}`;
  renderLanes();
  renderReceipts();
  renderImpact();
}
function stateClass(value) {
  return `state-${String(value || "unknown").toLowerCase().replaceAll("_", "-")}`;
}
function renderLanes() {
  const host = $("#lane-list");
  if (!state?.lanes?.length) {
    host.innerHTML = '<div class="empty">No writer lanes yet.</div>';
    return;
  }
  host.innerHTML = state.lanes.map((lane) => {
    const lease = lane.lease_until ? new Date(lane.lease_until).toLocaleString() : "—";
    return `<article class="lane-card">
      <div class="card-row"><span class="badge ${stateClass(lane.state)}">${esc(lane.state)}</span><span class="mono subtle">${esc(short(lane.collision_key, 16))}</span></div>
      <h3>${esc(lane.org)}</h3><p>${esc(lane.domain)} · ${esc(lane.purpose)} · ${esc(lane.opportunity)}</p>
      <dl><dt>Holder</dt><dd>${esc(lane.holder)}</dd><dt>Selected route</dt><dd>${esc(lane.leased_route)}</dd><dt>Lease until</dt><dd>${esc(lease)}</dd><dt>Version</dt><dd>${esc(lane.version)}</dd></dl>
      ${lane.effective_refence_pending ? '<p class="callout warning">One-shot human lease expired; effective prior fence shown. Next admissible mutation will persist the refence and receipt atomically.</p>' : ""}
    </article>`;
  }).join("");
}
function renderReceipts() {
  const body = $("#receipt-table");
  const events = state?.events || [];
  body.innerHTML = events.length ? events.map((row) => `<tr>
    <td>${esc(row.seq)}</td><td class="mono">${esc(row.event_id)}</td><td>${esc(row.kind)}</td><td>${esc(row.actor)}</td><td>${esc(row.decision)}</td><td><span class="badge ${stateClass(row.new_state)}">${esc(row.new_state)}</span></td><td>${esc(row.event_route)}</td><td class="mono" title="${esc(row.receipt_sha256)}">${esc(short(row.receipt_sha256, 14))}</td>
  </tr>`).join("") : '<tr><td colspan="8" class="empty">No receipts yet.</td></tr>';
}
function renderImpact() {
  const host = $("#impact-grid");
  const metrics = state?.impact || {};
  const labels = {
    claim_attempts: "Claim attempts",
    claims_granted: "Claims granted",
    collisions_prevented: "Collisions prevented",
    duplicate_touches_prevented: "Duplicate touches blocked",
    stale_lanes_recovered: "Stale lanes recovered",
    sent_hard_fences: "Sent hard fences",
    dead_routes_recorded: "Dead routes",
    human_reopens: "Human reopens",
    holds_recorded: "Holds",
  };
  host.innerHTML = Object.entries(labels).map(([key, label]) => `<article class="metric"><span>${esc(label)}</span><strong>${esc(metrics[key] ?? 0)}</strong></article>`).join("");
}
function showResult(selector, value, error = false) {
  const target = $(selector);
  target.classList.toggle("error", error);
  target.textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

$$('.tabs button').forEach((button) => button.addEventListener('click', () => {
  $$('.tabs button').forEach((b) => b.classList.toggle('active', b === button));
  $$('.panel').forEach((panel) => panel.classList.toggle('active', panel.id === button.dataset.tab));
}));

$("#session-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const token = $("#session-token").value;
  sessionToken = token;
  sessionStorage.setItem(TOKEN_KEY, token);
  $("#session-token").value = "";
  setSessionStatus();
  try {
    await refresh();
  } catch (error) {
    sessionToken = "";
    sessionStorage.removeItem(TOKEN_KEY);
    setSessionStatus();
    $("#server-time").textContent = error.body?.error || error.message;
  }
});

$("#disconnect").addEventListener("click", () => {
  sessionToken = "";
  sessionStorage.removeItem(TOKEN_KEY);
  state = null;
  setSessionStatus();
  $("#server-time").textContent = "authenticated state required";
  $("#lane-list").innerHTML = '<div class="empty">Authenticate to view operational state.</div>';
  $("#receipt-table").innerHTML = '<tr><td colspan="8" class="empty">Authenticate to view receipts.</td></tr>';
  $("#impact-grid").innerHTML = "";
});

$("#claim-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  showResult("#claim-result", "Requesting authenticated atomic lease…");
  try {
    const result = await api("/api/claim", { method: "POST", body: JSON.stringify(claimPayload(event.currentTarget)) });
    showResult("#claim-result", result);
    await refresh();
  } catch (error) {
    showResult("#claim-result", error.body || error.message, true);
    if (sessionToken) await refresh().catch(() => {});
  }
});

$("#event-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  showResult("#event-result", "Recording authenticated evidence-bound transition…");
  try {
    const result = await api("/api/event", { method: "POST", body: JSON.stringify(eventPayload(event.currentTarget)) });
    showResult("#event-result", result);
    await refresh();
  } catch (error) {
    showResult("#event-result", error.body || error.message, true);
    if (sessionToken) await refresh().catch(() => {});
  }
});

for (const id of ["#refresh-lanes", "#refresh-receipts", "#refresh-impact"]) {
  $(id).addEventListener("click", () => refresh().catch((error) => console.error(error)));
}

setSessionStatus();
if (sessionToken) {
  refresh().catch(() => {
    sessionToken = "";
    sessionStorage.removeItem(TOKEN_KEY);
    setSessionStatus();
    $("#server-time").textContent = "authentication required";
  });
}
