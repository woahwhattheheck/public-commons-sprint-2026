const el = id => document.getElementById(id);
const notice = el("notice"), result = el("result"), cards = el("cards");
let lastPlan;
function message(text) { notice.textContent = text; notice.hidden = !text; }
function add(parent, tag, text, cls = "") {
  const node = document.createElement(tag); node.textContent = text;
  if (cls) node.className = cls; parent.append(node); return node;
}
el("planner").addEventListener("submit", async event => {
  event.preventDefault(); message(""); result.hidden = true;
  const button = el("submit"); button.disabled = true; button.textContent = "Asking Qloo…";
  try {
    const response = await fetch("/api/plan", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ movie: el("movie").value, locality: el("locality").value, mood: el("mood").value })
    });
    const plan = await response.json();
    if (!response.ok) throw new Error(plan.error || "Upstream service unavailable");
    lastPlan = plan;
    el("title").textContent = plan.resolved_movie + " · " + plan.locality;
    el("label").textContent = (plan.mode === "live" ? "LIVE QLOO" : "SYNTHETIC EXAMPLES, NOT REAL PLACES") +
      " · " + plan.stops.length + " thematic stops · " + plan.mood;
    cards.replaceChildren();
    if (!plan.stops.length) add(cards, "p", "No verified Qloo results for this query.");
    plan.stops.forEach(stop => {
      const card = add(cards, "article", "", "card");
      add(card, "span", "Qloo rank #" + stop.qloo_rank, "small");
      add(card, "h3", stop.name);
      if (stop.description) add(card, "p", stop.description);
      if (stop.address) add(card, "p", stop.address);
      add(card, "p", stop.reasoning);
      stop.tags.forEach(tag => add(card, "span", tag, "tag"));
      add(card, "p", "Qloo entity: " + stop.qloo_entity_id, "small");
    });
    el("evidence").textContent = plan.evidence + " " + plan.limitations.join(". ") + ".";
    result.hidden = false;
    if (plan.mode !== "live") message("SYNTHETIC DEMO: fictional source records only. Set QLOO_API_KEY on the server for real Qloo lookups.");
  } catch (error) { message("Unable to create trail: " + error.message); }
  finally { button.disabled = false; button.textContent = "Explore CineTrail →"; }
});
el("export").addEventListener("click", () => {
  if (!lastPlan) return;
  const blob = new Blob([JSON.stringify(lastPlan, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = "cinetrail-evidence.json"; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
fetch("/api/status").then(r => r.json()).then(x => {
  el("mode").textContent = x.mode === "live" ? "Qloo live" : "Synthetic demo";
}).catch(() => { el("mode").textContent = "Offline status"; });
