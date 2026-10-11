"use strict";
const $ = id => document.getElementById(id);
let snapshot = null;
let newestRequest = 0;
function error(message) { $("error").textContent = message || ""; }
function node(tag, text, className) {
  const x = document.createElement(tag);
  if (text !== undefined) x.textContent = text;
  if (className) x.className = className;
  return x;
}
async function api(path, data) {
  error("");
  const options = data === undefined ? {} : {
    method: "POST",
    headers: {"Content-Type": "application/json", "X-CSRF": snapshot.csrf},
    body: JSON.stringify(data)
  };
  const response = await fetch(path, options);
  let body;
  try { body = await response.json(); }
  catch (_) { throw new Error("Unexpected local server response."); }
  if (!response.ok) throw new Error(body.error || "Operation failed.");
  return body;
}
function renderCatalogue(s) {
  const target = $("catalogue");
  target.replaceChildren();
  if (!s.plan) {
    target.textContent = "Plan a goal to compare the server-priced options against your selected budget.";
    return;
  }
  const budget = Number(s.plan.budget_usd);
  const items = Array.isArray(s.catalogue) ? s.catalogue.filter(item =>
    item && typeof item.sku === "string" && typeof item.name === "string" &&
    typeof item.why === "string" && typeof item.price === "string" &&
    /^\d{1,4}\.\d{2}$/.test(item.price)
  ).sort((a, b) => Number(a.price) - Number(b.price) || a.sku.localeCompare(b.sku)) : [];
  if (!Number.isFinite(budget) || !items.length) {
    target.textContent = "Catalogue comparison unavailable; review the exact item and price above.";
    return;
  }
  for (const item of items) {
    const selected = item.sku === s.plan.sku;
    const affordable = Number(item.price) <= budget;
    const row = node("div", undefined, selected ? "catalogue-item is-recommended" : "catalogue-item");
    row.setAttribute("role", "listitem");
    const details = node("div", undefined, "catalogue-item-copy");
    details.append(
      node("strong", item.name),
      node("small", item.why, "catalogue-item-explanation"),
      node("span", selected ? "Agent's proposed item" :
        affordable ? "Within this plan's budget" : "Above this plan's budget", "catalogue-item-status")
    );
    row.append(details, node("strong", "$" + item.price + " USD", "catalogue-item-price"));
    target.append(row);
  }
}

function paint(s) {
  if (!s || typeof s.generation !== "string" || !s.generation ||
      !Number.isSafeInteger(s.revision) || s.revision < 0) {
    error("Invalid checkout state; refresh this page.");
    return;
  }
  // A late response must not repaint a newer server-confirmed checkout phase.
  // Generation distinguishes sessions after a local server restart.
  if (snapshot && snapshot.generation === s.generation &&
      s.revision < snapshot.revision) return;
  snapshot = s;
  $("mode").textContent = [
    s.mode === "fixture" ? "LABELLED FIXTURE MODE" : "SANDBOX-ONLY",
    s.ai_ready ? "AI MODEL CONFIGURED" : "MODEL NOT CONFIGURED",
    s.paypal_ready ? "PAYPAL SANDBOX CONNECTED" : "SANDBOX CREDENTIALS NOT CONFIGURED"
  ].join(" · ");
  const p = $("proposal");
  p.replaceChildren();
  renderCatalogue(s);
  $("orderform").hidden = true;
  $("captureform").hidden = true;
  $("approval").hidden = true;
  $("result").textContent = "No order created.";
  if (s.plan) {
    p.append(node("h3", s.plan.name));
    p.append(node("div", "$" + s.plan.usd + " USD", "price"));
    p.append(node("p", s.plan.reason));
    p.append(node("small", "Recommendation engine: " + s.plan.method + " · Budget $" + s.plan.budget_usd));
  } else p.textContent = "Complete step 01 to see the bounded shopping proposal.";
  if (s.phase === "planned") $("orderform").hidden = false;
  if (s.phase === "approval_pending") {
    const href = s.approval_url || "";
    const safe = href.startsWith("/api/return?token=") || /^https:\/\/(?:[\w-]+\.)*sandbox\.paypal\.com\//.test(href);
    if (safe) {
      $("approval").href = href;
      $("approval").textContent = s.mode === "fixture" && !s.paypal_ready
        ? "Simulate payer approval (clearly labelled fixture) ↗"
        : "Review and approve in PayPal SANDBOX ↗";
      $("approval").hidden = false;
    }
    $("result").textContent = "Order " + (s.order_id || "") + " awaiting buyer approval. Nothing captured.";
  }
  if (s.phase === "payer_returned") {
    $("captureform").hidden = false;
    $("result").textContent = "Payer returned. Order not captured. One more human decision required.";
  }
  if (s.phase === "completed") $("result").textContent = "PAYPAL SANDBOX CAPTURE COMPLETED (no live funds).";
  if (s.phase === "fixture_completed") $("result").textContent = "FIXTURE ONLY — simulated approval and capture; NO PayPal payment.";
  if (s.phase === "cancelled") $("result").textContent = "Cancelled. No capture performed.";
  $("planbtn").disabled = ["approval_pending", "payer_returned"].includes(s.phase);
  $("consent").checked = false;
  $("finalconsent").checked = false;
  const events = $("events");
  events.replaceChildren();
  for (const e of s.audit) {
    const item = node("li");
    item.append(node("strong", e.step + ". " + e.event));
    item.append(node("span", e.detail));
    events.append(item);
  }
}
async function run(path, data) {
  const request = ++newestRequest;
  try { paint(await api(path, data)); }
  catch (e) { if (request === newestRequest) error(e.message); }
}
$("planform").addEventListener("submit", event => {
  event.preventDefault();
  run("/api/plan", {prompt: $("prompt").value, budget: $("budget").value});
});
$("orderform").addEventListener("submit", event => {
  event.preventDefault();
  if ($("consent").checked && snapshot && snapshot.plan) run("/api/order", {approved: true, generation: snapshot.generation, revision: snapshot.revision, sku: snapshot.plan.sku, usd: snapshot.plan.usd});
});
$("captureform").addEventListener("submit", event => {
  event.preventDefault();
  if ($("finalconsent").checked && snapshot && snapshot.order_id) run("/api/capture", {confirmed: true, generation: snapshot.generation, revision: snapshot.revision, order_id: snapshot.order_id});
});
$("reset").addEventListener("click", () => {
  if (snapshot) run("/api/reset", {generation: snapshot.generation, revision: snapshot.revision});
});
run("/api/state");
