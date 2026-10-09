const el = id => document.getElementById(id);
const notice = el("notice"), result = el("result"), cards = el("cards");
let lastPlan = null;
let includedIds = new Set();
function message(text) { notice.textContent = text; notice.hidden = !text; }
function add(parent, tag, text, cls = "") {
  const node = document.createElement(tag); node.textContent = text;
  if (cls) node.className = cls; parent.append(node); return node;
}
// Human selections are a subset of the actual returned places, never new provider results.
// Immutable Qloo IDs and original rankings survive selection and exported evidence.
function selectedEvidence() {
  if (!lastPlan) return null;
  const stops = lastPlan.stops.filter(stop => includedIds.has(stop.qloo_entity_id));
  return {
    ...lastPlan,
    stops,
    selection: {
      type: "human-curated-subset-of-returned-stops",
      original_stop_count: lastPlan.stops.length,
      included_qloo_entity_ids: stops.map(stop => stop.qloo_entity_id),
      excluded_qloo_entity_ids: lastPlan.stops.filter(stop => !includedIds.has(stop.qloo_entity_id))
        .map(stop => stop.qloo_entity_id),
      source_ranks_preserved: true,
      note: "Only the user-selected original suggestions are exported; no additional Qloo lookup, venue verification, or inferred ranking occurred.",
    },
  };
}

function syncSummary() {
  const count = includedIds.size;
  const total = lastPlan?.stops.length ?? 0;
  el("shortlist-summary").textContent = total === 0
    ? "No source-backed places returned. Try another film or locality."
    : count + " of " + total + " source suggestions included. Exclusions are your choices, not Qloo judgments.";
  el("reset-shortlist").disabled = total === 0 || count === total;
  el("export").disabled = count === 0;
}

function renderStops() {
  cards.replaceChildren();
  if (!lastPlan) return;
  if (!lastPlan.stops.length) add(cards, "p", "No verified Qloo results for this query.");
  for (const stop of lastPlan.stops) {
    const card = add(cards, "article", "", "card");
    const label = add(card, "span", "", "small");
    const status = add(card, "p", "", "small");
    add(card, "h3", stop.name);
    if (stop.description) add(card, "p", stop.description);
    if (stop.address) add(card, "p", stop.address);
    add(card, "p", stop.reasoning);
    stop.tags.forEach(tag => add(card, "span", tag, "tag"));
    add(card, "p", "Qloo entity: " + stop.qloo_entity_id, "small");
    const toggle = add(card, "button", "", "secondary");
    toggle.type = "button";
    const renderSelection = () => {
      const included = includedIds.has(stop.qloo_entity_id);
      card.dataset.included = String(included);
      label.textContent = "Original Qloo rank #" + stop.qloo_rank;
      status.textContent = included ? "Included in your shortlist" : "Excluded by you; source record retained";
      toggle.textContent = included ? "Skip this place" : "Restore this place";
      toggle.setAttribute("aria-pressed", String(!included));
      toggle.setAttribute("aria-label", toggle.textContent + ": " + stop.name);
    };
    toggle.addEventListener("click", () => {
      if (includedIds.has(stop.qloo_entity_id)) includedIds.delete(stop.qloo_entity_id);
      else includedIds.add(stop.qloo_entity_id);
      renderSelection();
      syncSummary();
    });
    renderSelection();
  }
  syncSummary();
}

el("planner").addEventListener("submit", async event => {
  event.preventDefault(); message(""); result.hidden = true;
  lastPlan = null; includedIds.clear();
  const button = el("submit"); button.disabled = true; button.textContent = "Asking Qloo…";
  try {
    const response = await fetch("/api/plan", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ movie: el("movie").value, locality: el("locality").value, mood: el("mood").value })
    });
    const plan = await response.json();
    if (!response.ok) throw new Error(plan.error || "Upstream service unavailable");
    // Do not export a malformed upstream result as a user-curated source record.
    if (!Array.isArray(plan.stops) || plan.stops.some(stop =>
        typeof stop.qloo_entity_id !== "string" || !stop.qloo_entity_id ||
        typeof stop.name !== "string" || !Array.isArray(stop.tags))) {
      throw new Error("Provider response missing place evidence");
    }
    lastPlan = plan;
    includedIds = new Set(plan.stops.map(stop => stop.qloo_entity_id));
    el("title").textContent = plan.resolved_movie + " · " + plan.locality;
    el("label").textContent = (plan.mode === "live" ? "LIVE QLOO" : "SYNTHETIC EXAMPLES, NOT REAL PLACES") +
      " · " + plan.stops.length + " thematic stops · " + plan.mood;
    renderStops();
    el("evidence").textContent = plan.evidence + " " + plan.limitations.join(". ") + ".";
    result.hidden = false;
    if (plan.mode !== "live") message("SYNTHETIC DEMO: fictional source records only. Set QLOO_API_KEY on the server for real Qloo lookups.");
  } catch (error) { message("Unable to create trail: " + error.message); }
  finally { button.disabled = false; button.textContent = "Explore CineTrail →"; }
});
el("reset-shortlist").addEventListener("click", () => {
  if (!lastPlan) return;
  includedIds = new Set(lastPlan.stops.map(stop => stop.qloo_entity_id));
  renderStops();
});

el("export").addEventListener("click", () => {
  const chosen = selectedEvidence();
  if (!chosen || !chosen.stops.length) return;
  const blob = new Blob([JSON.stringify(chosen, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = "cinetrail-selected-evidence.json"; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
fetch("/api/status").then(r => r.json()).then(x => {
  el("mode").textContent = x.mode === "live" ? "Qloo live" : "Synthetic demo";
}).catch(() => { el("mode").textContent = "Offline status"; });
