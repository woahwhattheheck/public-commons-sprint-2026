"use strict";
const $ = id => document.getElementById(id);
let snapshot = null;
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
function paint(s) {
  snapshot = s;
  $("mode").textContent = [
    s.mode === "fixture" ? "LABELLED FIXTURE MODE" : "SANDBOX-ONLY",
    s.ai_ready ? "AI MODEL CONFIGURED" : "MODEL NOT CONFIGURED",
    s.paypal_ready ? "PAYPAL SANDBOX CONNECTED" : "SANDBOX CREDENTIALS NOT CONFIGURED"
  ].join(" · ");
  const p = $("proposal");
  p.replaceChildren();
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
  try { paint(await api(path, data)); }
  catch (e) { error(e.message); }
}
$("planform").addEventListener("submit", event => {
  event.preventDefault();
  run("/api/plan", {prompt: $("prompt").value, budget: $("budget").value});
});
$("orderform").addEventListener("submit", event => {
  event.preventDefault();
  if ($("consent").checked) run("/api/order", {approved: true});
});
$("captureform").addEventListener("submit", event => {
  event.preventDefault();
  if ($("finalconsent").checked) run("/api/capture", {confirmed: true});
});
$("reset").addEventListener("click", () => run("/api/reset", {}));
run("/api/state");
