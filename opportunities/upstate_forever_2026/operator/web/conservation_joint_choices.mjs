/** Complete retained preference × native-case comparison in the existing operator. */
const h = value => String(value ?? "").replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const n = value => typeof value === "number" && Number.isFinite(value)
  ? new Intl.NumberFormat(undefined, {maximumSignificantDigits: 8}).format(value) : "Unavailable";
const table = (caption, headers, rows) => '<div class="cons-table-wrap" tabindex="0" role="region" aria-label="' + h(caption) +
  '"><table class="cons-table"><caption>' + h(caption) + '</caption><thead><tr>' +
  headers.map(x => '<th scope="col">' + h(x) + '</th>').join("") + '</tr></thead><tbody>' +
  rows.map(row => '<tr>' + row.map(value => '<td>' + value + '</td>').join("") + '</tr>').join("") +
  '</tbody></table></div>';
// The existing operator renders one selected Conservation analysis. Retain only
// that existing object; large per-cell candidate tables are built when opened
// and released when closed, rather than multiplying initial hidden DOM.
let current = null;
export function renderJointChoices(analysis) {
  const joint = analysis?.joint_comparison;
  current = joint ? analysis : null;
  if (!joint) return "";
  const labels = new Map((analysis.candidates || []).map(row => [row.feature_id, row.label || row.feature_id]));
  const names = ids => ids.length ? ids.map(id => h(labels.get(id) || id) + ' <small>[' + h(id) + ']</small>').join("; ") : "None";
  const cases = new Map(joint.cells.map(cell => [cell.id, cell.case + " / " + cell.preference]));
  const weights = value => Object.entries(value).map(([key, amount]) => h(key) + ": " + n(amount)).join("; ");
  let out = '<section class="cons-subsection" aria-label="Joint preference and native case comparison"><h3>Preferences across every retained case</h3>' +
    '<p>' + h(joint.interpretation) + '</p><p>' + n(joint.case_count) + ' cases × ' + n(joint.preference_count) +
    ' preferences = ' + n(joint.cell_count) + ' evaluated combinations. ' + n(joint.new_solver_calls) +
    ' previously uncomputed combinations used the maintained solver.</p>' +
    '<p>Weights and case multiplicity do not assign likelihood. Original criterion scales, support exclusions and resource limits apply to every combination.</p>';
  out += table("Every included combination",
    ["Retained case", "Preference and normalized weights", "Eligible units", "Selected original units", "Solver objective", "Solver status / upper bound", "Best known feasible score"],
    joint.cells.map(cell => [
      h(cell.case), h(cell.preference) + '<br>' + weights(cell.weights), n(cell.eligible_count),
      names(cell.selected_ids), n(cell.optimization.objective_score),
      h(cell.optimization.status || "Unavailable") + '<br>Upper: ' + n(cell.optimization.upper_bound),
      n(cell.best_known_feasible_score) + (cell.cross_portfolio_improves_incumbent ? '<br>Another retained portfolio improves the original incumbent.' : "")
    ]));
  out += '<h4>Retained portfolios across the complete grid</h4><p>' + h(joint.regret) +
    '</p><p>The original selected portfolio stays selected. These are the distinct portfolios found in the declared cells; this comparison does not search every possible robust portfolio.</p>';
  out += table("Full-grid support and objective loss bounds",
    ["Portfolio / original units", "Supported combinations", "Maximum loss lower bound", "Maximum loss upper bound"],
    joint.portfolios.map(portfolio => [
      h(portfolio.id) + (portfolio.id === joint.selected_portfolio_id ? ' · original selection' : '') + '<br>' + names(portfolio.selected_ids),
      n(portfolio.eligible_cells) + " / " + n(portfolio.cell_count),
      n(portfolio.maximum_regret_lower_bound), n(portfolio.maximum_regret_upper_bound)
    ]));
  for (const portfolio of joint.portfolios) {
    out += '<details data-conservation-joint-detail="portfolio" data-joint-analysis="' + h(analysis.id) +
      '" data-joint-id="' + h(portfolio.id) + '"><summary>' + h(portfolio.id) +
      ': every case and preference</summary><div data-joint-body></div></details>';
  }
  out += '<details><summary>Every candidate: selection, eligibility and rank across the included combinations</summary>' +
    table("Original candidate comparison counts", ["Original unit", "Selected combinations", "Eligible combinations", "Rank range"],
      joint.candidate_summary.map(row => [
        names([row.feature_id]), n(row.selected_cells) + " / " + n(row.cell_count),
        n(row.eligible_cells) + " / " + n(row.cell_count),
        row.minimum_rank == null ? "Unavailable" : n(row.minimum_rank) + "–" + n(row.maximum_rank)
      ])) + '</details>';
  out += '<details><summary>Every combination: full candidate scores, contributions and exclusions</summary>';
  for (const cell of joint.cells) {
    out += '<details data-conservation-joint-detail="cell" data-joint-analysis="' + h(analysis.id) +
      '" data-joint-id="' + h(cell.id) + '"><summary>' + h(cases.get(cell.id)) +
      '</summary><div data-joint-body></div></details>';
  }
  out += '</details><p>' + h(joint.physical_scope) +
    '</p><p>Save this analysis to retain the three complete joint CSVs with its original JSON and readable report. Existing saved-analysis downloads and scientific-report companions reopen those exact files.</p></section>';
  return out;
}

function openDetail(details) {
  if (!details?.matches?.("details[data-conservation-joint-detail]") || !details.isConnected) return;
  const body = details.querySelector(":scope > [data-joint-body]");
  if (!body) return;
  if (!details.open) { body.replaceChildren(); return; }
  const analysis = current;
  if (!analysis || String(analysis.id) !== details.dataset.jointAnalysis) return;
  const joint = analysis.joint_comparison;
  const labels = new Map((analysis.candidates || []).map(row => [row.feature_id, row.label || row.feature_id]));
  const names = ids => ids.length ? ids.map(id => h(labels.get(id) || id) + ' <small>[' + h(id) + ']</small>').join("; ") : "None";
  const cases = new Map(joint.cells.map(cell => [cell.id, cell.case + " / " + cell.preference]));
  if (details.dataset.conservationJointDetail === "portfolio") {
    const portfolio = joint.portfolios.find(row => row.id === details.dataset.jointId);
    if (!portfolio) return;
    body.innerHTML = '<p>Selected original units: ' + names(portfolio.selected_ids) + '</p><p>Found in: ' +
      portfolio.origin_cells.map(id => h(cases.get(id) || id)).join("; ") + '</p>' +
      table("Every cross-evaluation for " + portfolio.id, ["Case / preference", "Portfolio score", "Loss lower bound", "Loss upper bound", "Support"],
        portfolio.evaluations.map(value => [
          h(cases.get(value.cell_id) || value.cell_id), n(value.objective_score), n(value.regret_lower_bound), n(value.regret_upper_bound),
          value.eligible ? "Complete" : value.unavailable_units.map(unit => names([unit.feature_id]) + ": " + h(unit.reasons.join("; "))).join("<br>")
        ]));
  } else if (details.dataset.conservationJointDetail === "cell") {
    const cell = joint.cells.find(row => row.id === details.dataset.jointId);
    if (!cell) return;
    body.innerHTML = table("Eligible candidates — " + cases.get(cell.id), ["Original unit", "Rank", "Score", "Selected", "Weighted contributions"],
      cell.candidates.map(row => [names([row.feature_id]), n(row.rank), n(row.score), row.selected ? "Yes" : "No",
        Object.entries(row.contributions).map(([key, value]) => h(key) + ": " + n(value)).join("; ")])) +
      (cell.excluded.length
        ? table("Excluded candidates — " + cases.get(cell.id), ["Original unit", "Source / resource / support exclusion"],
            cell.excluded.map(row => [names([row.feature_id]), h(row.reasons.join("; "))]))
        : '<p>All original candidates have the required support and resource inputs in this combination.</p>');
  }
}
// ESM loads once in the original browser. Capture observes non-bubbling native
// details toggles, including keyboard use; scoped attributes exclude peer desks.
if (typeof document !== "undefined") document.addEventListener("toggle", event => openDetail(event.target), true);
