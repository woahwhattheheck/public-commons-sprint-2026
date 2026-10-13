const PARAMETERS = {
  total_phosphorus: "Total phosphorus", total_nitrogen: "Total nitrogen",
  total_chlorophyll_a: "Total chlorophyll-a", microcystins: "Microcystins",
  dissolved_oxygen: "Dissolved oxygen", ph: "pH", water_temperature: "Water temperature",
  specific_conductivity: "Specific conductivity", turbidity: "Turbidity"
};
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const label = value => PARAMETERS[value] || String(value ?? "").replaceAll("_", " ");
const arr = value => Array.isArray(value) ? value : [];
const canonical = value => {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") return "{" + Object.keys(value).sort().map(k => JSON.stringify(k) + ":" + canonical(value[k])).join(",") + "}";
  return JSON.stringify(value);
};
function tasksFrom(state) {
  const value = state?.tasks;
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.items)) return value.items;
  return value && typeof value === "object" ? Object.values(value).filter(v => v && typeof v === "object" && v.id) : [];
}
function cell(row, field) {
  if (field === "value" && "source_value_token" in row) return row.source_value_token;
  if (field === "depth" && "source_depth_token" in row) return row.source_depth_token;
  if (field === "parameter") return label(row.parameter);
  if (field === "month") return MONTHS[Number(row.month) - 1] || row.month;
  if (field === "sd") return row.sd_published_token || row.raw_cells?.sd || row.sd;
  if (field === "minimum" && row.minimum_qualifier === "below_detection_limit") return "< " + row.minimum_detection_limit;
  return row.raw_cells?.[field] ?? row[field];
}
function safeURL(value) {
  if (typeof value !== "string") return "";
  if (value.startsWith("/api/file/")) return value;
  try { const url = new URL(value); return url.protocol === "https:" ? url.href : ""; } catch { return ""; }
}
function link(url, title) {
  const safe = safeURL(url);
  return safe ? '<a href="' + esc(safe) + '" target="_blank" rel="noopener noreferrer">' + esc(title) + "</a>" : esc(title);
}

export function createPublishedStudiesDesk(host) {
  let node = null, workspace = null, events = null, catalog = null, complete = null, selected = null;
  let request = 0, catalogRequest = 0, viewGeneration = 0, busy = false, taskStamp = "", tab = "seasonal";
  let selection = {site_ids: [], parameters: [], strata: [], year: null, months: []};
  const requests = new Set(), operationIds = new Map(), pending = new Map();


  const copy = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const emptySelection = () => ({site_ids:[], parameters:[], strata:[], year:null, months:[]});
  const tableIds = new Set(["seasonal","continuous","observed","wqp","flow","figures","ranges","stations","sources"]);
  const drafts = new Map();
  let editGeneration = 0, savedReview = null, reviewChoice = "", reviewTitle = "", reviewNotes = "";
  let loadedStudy = null, loadedSelection = null, reviewLoading = false, reviewRequest = 0, interpretationMatches = true;
  let catalogPreference = null;

  let geographicInput = null, geographicPreview = null, geographicChoice = "";
  let geographicLoading = false, geographicRequest = 0, geographicPrevious = null;

  function geographicCandidate() {
    return arr(geographicPreview?.candidates).find(row => row.study_id + "|" + row.version_id === geographicChoice);
  }
  function renderGeographic() {
    const target = find("[data-ps-geographic]"); if (!target) return;
    target.hidden = !geographicInput;
    if (!geographicInput) { target.innerHTML = ""; return; }
    const candidate = geographicCandidate(), source = geographicPreview?.source;
    target.innerHTML = '<h2>Stations from saved geography</h2><p>' +
      esc(source?.geography_title || "Checking the retained geographic selection") + '</p>' +
      '<p class="ps-help">Match exact station identifiers to a retained study edition. Geographic assessment filters select stations; original observation dates, parameters and result qualifiers remain those of the chosen study.</p>' +
      (source ? '<p>' + source.site_ids.length + ' requested stations · geography <code>' + esc(source.geography_id) + '</code></p>' : "") +
      (geographicLoading ? '<p role="status">Reading original station and study sources…</p>' : "") +
      (arr(geographicPreview?.candidates).length ? '<label>Study edition containing these stations<select data-ps-geographic-study' + (geographicLoading ? " disabled" : "") + '>' +
        geographicPreview.candidates.map(row => '<option value="' + esc(row.study_id + "|" + row.version_id) + '"' +
          (row.study_id + "|" + row.version_id === geographicChoice ? " selected" : "") + '>' +
          esc(row.title + " · " + row.matched_count + "/" + row.requested_count + " stations · " + row.version_id.slice(-8)) + '</option>').join("") + '</select></label>' : "") +
      (candidate ? '<p><strong>' + candidate.matched_count + ' of ' + candidate.requested_count + ' requested stations occur in this edition.</strong> ' +
        candidate.observed_row_count + ' retained observation rows; ' + candidate.original_result_row_count + ' original result rows for these stations. These are separate source views and are not added together.</p>' +
        '<p>' + (candidate.sampling_start ? 'Observed sampling dates: ' + esc(candidate.sampling_start) + ' through ' + esc(candidate.sampling_end) + '.' :
          'This edition has no dated original observation rows for the matched stations; its published source tables remain available.') + '</p>' +
        '<details><summary>Matched original stations (' + candidate.matched_count + ')</summary><p>' + esc(candidate.matched_site_ids.join(", ")) + '</p></details>' +
        (candidate.missing_site_ids.length ? '<details open><summary>Requested stations absent from this study (' + candidate.missing_site_ids.length +
          ')</summary><p>' + esc(candidate.missing_site_ids.join(", ")) + '</p></details>' : "") : "") +
      (geographicPreview && !geographicPreview.candidates.length ? '<p>No retained study contains these exact station identifiers. Import the relevant original study above, then refresh this preview.</p>' : "") +
      (arr(geographicPreview?.unavailable).length ? '<details><summary>Study sources needing attention (' + geographicPreview.unavailable.length + ')</summary><ul>' +
        geographicPreview.unavailable.map(row => '<li>' + esc((row.title || row.study_id) + " · " + row.version_id + ": " + row.message) + '</li>').join("") + '</ul></details>' : "") +
      '<div class="ps-actions"><button type="button" data-ps-action="geographic-apply"' + (!candidate || geographicLoading || busy ? " disabled" : "") +
        '>Open ' + (candidate ? candidate.matched_count : "") + ' matched stations</button>' +
      '<button type="button" data-ps-action="geographic-refresh"' + (geographicLoading ? " disabled" : "") + '>Refresh station preview</button>' +
      (geographicPrevious ? '<button type="button" data-ps-action="geographic-previous"' + (geographicLoading ? " disabled" : "") + '>Restore previous study draft</button>' : "") +
      '<button type="button" data-ps-action="geographic-close">Close cohort preview</button></div>' +
      '<p class="ps-help">Opening the matched cohort prepares a review draft with the original geography identity and source hash. Save review retains its exact study edition, station filters and notes; Export saved review ZIP carries that observation review and its original study sources.</p>';
  }
  async function openForStations(value) {
    if (!node || !value || value.workspace_key !== workspace || host.getWorkspace() !== workspace)
      throw new Error("Open the original Workspace before selecting these geographic stations.");
    if (!Array.isArray(value.site_ids) || !value.site_ids.length)
      throw new Error("Choose at least one original station in Station geography.");
    const incoming = copy({geography_id:value.geography_id, site_ids:value.site_ids, view:value.view || {}});
    const opening = ++geographicRequest, expectedWorkspace = workspace, expectedView = viewGeneration;
    const expectedEdit = ++editGeneration;
    ++request; ++reviewRequest; ++catalogRequest; catalogPreference = null; reviewLoading = false;
    const active = () => Boolean(node) && workspace === expectedWorkspace && host.getWorkspace() === expectedWorkspace &&
      viewGeneration === expectedView && geographicRequest === opening && editGeneration === expectedEdit;
    geographicInput = incoming; geographicLoading = true; geographicPreview = null; geographicChoice = "";
    renderGeographic(); remember();
    try {
      const [preview, freshCatalog] = await Promise.all([
        api("/api/published-studies/geographic-preview", incoming),
        api("/api/published-studies/catalog", {})
      ]);
      if (!active()) return;
      geographicPreview = preview; catalog = freshCatalog;
      const first = arr(preview.candidates)[0];
      geographicChoice = first ? first.study_id + "|" + first.version_id : "";
      renderCatalog(); renderGeographic(); remember();
      if (!complete || loadedStudy !== selected) await loadStudy();
    } catch (error) { if (active()) showError(error); }
    finally {
      if (node && workspace === expectedWorkspace && viewGeneration === expectedView && geographicRequest === opening) {
        geographicLoading = false; renderGeographic(); remember();
      }
    }
  }
  async function applyGeographic() {
    const candidate = geographicCandidate();
    if (!candidate || !geographicInput || geographicLoading || busy) return;
    const incoming = copy(geographicInput), opening = ++geographicRequest;
    const expectedWorkspace = workspace, expectedView = viewGeneration, expectedEdit = ++editGeneration;
    ++request; ++reviewRequest; ++catalogRequest; catalogPreference = null; reviewLoading = false;
    const active = () => Boolean(node) && workspace === expectedWorkspace && host.getWorkspace() === expectedWorkspace &&
      viewGeneration === expectedView && geographicRequest === opening && editGeneration === expectedEdit;
    geographicLoading = true; renderGeographic();
    try {
      const value = await api("/api/published-studies/geographic-selection", {...incoming,
        study_id:candidate.study_id, version_id:candidate.version_id,
        expected_source_manifest_sha256:candidate.source_manifest_sha256});
      if (!active()) return;
      const key = value.candidate.study_id + "|" + value.candidate.version_id;
      if (!arr(catalog?.studies).some(row => row.study_id + "|" + row.version_id === key))
        throw new Error("Refresh the station preview to reopen the exact retained study edition.");
      geographicPrevious = copy({selected, selection, tab, savedReview, reviewChoice, reviewTitle, reviewNotes, interpretationMatches});
      selected = key; selection = copy(value.context.selection); tab = value.review.table;
      savedReview = null; reviewChoice = ""; reviewTitle = value.review.title; reviewNotes = value.review.notes; interpretationMatches = true;
      complete = value.study; loadedStudy = selected; loadedSelection = canonical(currentPayload());
      renderCatalog(); renderSummary(); renderTables(value.context); renderReview(); remember();
      find("[data-ps-detail]").hidden = true;
      status("Original station cohort opened. Refine sampling filters or save this named review.");
    } catch (error) { if (active()) showError(error); }
    finally {
      if (node && workspace === expectedWorkspace && viewGeneration === expectedView && geographicRequest === opening) {
        geographicLoading = false; renderGeographic(); remember();
      }
    }
  }
  async function restoreGeographicDraft() {
    if (!geographicPrevious || geographicLoading) return;
    const previous = geographicPrevious; geographicPrevious = null;
    ++geographicRequest; ++editGeneration; ++reviewRequest; ++catalogRequest; catalogPreference = null;
    selected = previous.selected; selection = copy(previous.selection); tab = previous.tab;
    savedReview = copy(previous.savedReview); reviewChoice = previous.reviewChoice;
    reviewTitle = previous.reviewTitle; reviewNotes = previous.reviewNotes; interpretationMatches = previous.interpretationMatches;
    renderCatalog(); renderGeographic(); remember(); await loadStudy();
  }

  function remember() {
    if (!node || !workspace) return;
    drafts.set(workspace, copy({selected, selection, tab, savedReview, reviewChoice, reviewTitle, reviewNotes, interpretationMatches,
      geographicInput, geographicPreview, geographicChoice, geographicPrevious}));
  }
  function edited() { ++editGeneration; remember(); renderReview(); }
  function sameSource(review = savedReview) {
    const binding = review?.content?.binding, record = activeRecord();
    return Boolean(binding && record && binding.study_id === record.study_id && binding.version_id === record.version_id);
  }
  function reviewValue() {
    return {title:reviewTitle.trim(), notes:reviewNotes, table:tab, selection:copy(selection)};
  }
  function reviewChanged() {
    if (!savedReview || !sameSource()) return true;
    const value = savedReview.content;
    return canonical(reviewValue()) !== canonical({title:value.title, notes:value.notes || "", table:value.table, selection:value.selection});
  }
  function selectionReady() {
    return Boolean(selected && complete && loadedStudy === selected &&
      loadedSelection === canonical(currentPayload()));
  }
  function selectValues(control, values) {
    const selectedValues = new Set(values.map(String));
    for (const option of control.options) option.selected = selectedValues.has(option.value);
  }
  function renderReview() {
    if (!node) return;
    const control = find("[data-ps-review]");
    const reviews = arr(catalog?.reviews);
    control.innerHTML = '<option value="">Choose a saved review</option>' + reviews.map(item =>
      '<option value="' + esc(item.id) + '">' + esc(item.title + " · " + item.study_id + " · " + item.version_id.slice(-8) +
        (item.saved_at ? " · " + item.saved_at : "")) + '</option>').join("");
    if (!reviews.some(item => item.id === reviewChoice)) reviewChoice = savedReview?.id || "";
    control.value = reviewChoice;
    find('[data-ps-action="open-review"]').disabled = !reviewChoice || reviewLoading;
    const title = find('[name="review_title"]'), notes = find('[name="review_notes"]');
    if (title.value !== reviewTitle) title.value = reviewTitle;
    if (notes.value !== reviewNotes) notes.value = reviewNotes;
    const ready = selectionReady() && !busy && !reviewLoading;
    find('[data-ps-action="report"]').disabled = !ready;
    find('[data-ps-action="export"]').disabled = !complete || loadedStudy !== selected || busy || reviewLoading;
    for (const button of node.querySelectorAll('[data-ps-action="save-review"],[data-ps-action="save-new-review"]')) button.disabled = !ready;
    find('[data-ps-action="export-review"]').disabled = !savedReview || busy;
    const binding = savedReview?.content?.binding;
    find("[data-ps-review-identity]").innerHTML = savedReview
      ? '<p><strong>' + (reviewChanged() ? "Draft changes to saved review" : "Saved review") + '</strong> · ' +
        esc(savedReview.saved_at || "") + '</p><dl class="ps-review-binding"><dt>Review</dt><dd>' + esc(savedReview.id) +
        '</dd><dt>Study edition</dt><dd>' + esc(binding.study_id) + " / " + esc(binding.version_id) +
        '</dd>' + (savedReview.content.parent_review_id ? '<dt>Previous review</dt><dd>' + esc(savedReview.content.parent_review_id) + '</dd>' : "") +
        '</dl><p class="ps-help">Save review creates a new immutable revision. Export saved review uses the selected saved revision, including its original study and report files.</p>'
      : '<p class="ps-help">Save the exact study edition, station and parameter selections, table, and notes together. Saved reviews remain in this workspace and can be reopened or exported as a complete ZIP.</p>';
    if (savedReview) find("[data-ps-review-identity]").innerHTML +=
      (interpretationMatches ? "" : '<p class="ps-review-notice" role="status">The original source edition and saved filters are retained. Current interpretation differs from the saved coverage or temporal-support snapshot.</p>') +
      '<details><summary>Saved coverage and temporal support</summary><pre class="ps-review-snapshot">' +
      esc(JSON.stringify({coverage:savedReview.content.coverage, temporal_support:savedReview.content.temporal_support}, null, 2)) + '</pre></details>';
    const parameterText = selection.parameters.length ? selection.parameters.map(label).join(", ") : "All parameters";
    const strataText = selection.strata.length ? selection.strata.join(", ") : "All strata";
    const monthsText = selection.months.length ? selection.months.map(month => MONTHS[Number(month)-1] || month).join(", ") : "All months";
    find("[data-ps-review-selection]").textContent = activeRecord()
      ? (selection.site_ids.length ? selection.site_ids.join(", ") : "All stations") + " · " + parameterText +
        " · " + strataText + " · " + (selection.year || "All years") + " · " + monthsText + " · Table: " + label(tab)
      : "Choose a retained study to create a review.";
    for (const rootControl of node.querySelectorAll('form[data-ps-review-import] select[name="root_id"]')) {
      const prior = rootControl.value;
      rootControl.innerHTML = arr(catalog?.source_roots).map(root => '<option value="' + esc(root.id) + '">' + esc(root.label) + '</option>').join("");
      if (arr(catalog?.source_roots).some(root => root.id === prior)) rootControl.value = prior;
    }
  }
  async function openReview(reviewId) {
    if (!reviewId || !node) return;
    const id = ++request, opening = ++reviewRequest, expectedWorkspace = workspace, expectedView = viewGeneration;
    const expectedEdit = ++editGeneration;
    const active = () => Boolean(node) && workspace === expectedWorkspace && host.getWorkspace() === expectedWorkspace &&
      viewGeneration === expectedView && request === id && editGeneration === expectedEdit;
    reviewLoading = true; renderReview(); status("Opening saved study review…");
    try {
      const result = await api("/api/published-studies/review", {review_id:reviewId});
      if (!active()) return;
      const review = result.review, content = review?.content, binding = content?.binding;
      if (!binding?.study_id || !binding?.version_id || !tableIds.has(content.table)) throw new Error("Saved review has an unsupported source binding or table.");
      const study = await api("/api/published-studies/study", {study_id:binding.study_id, version_id:binding.version_id});
      if (!active()) return;
      if (!arr(catalog?.studies).some(item => item.study_id === binding.study_id && item.version_id === binding.version_id)) {
        throw new Error("The saved review's exact source edition is unavailable in the study catalogue. Refresh the catalogue and reopen the review.");
      }
      selected = binding.study_id + "|" + binding.version_id;
      interpretationMatches = result.interpretation_matches_snapshot !== false;
      selection = copy(content.selection); tab = content.table;
      reviewTitle = content.title; reviewNotes = content.notes || ""; savedReview = copy(review); reviewChoice = review.id;
      complete = study; loadedStudy = selected; loadedSelection = canonical(currentPayload());
      renderCatalog(); renderSummary(); renderTables(result.context); renderReview(); remember();
      status("Saved review opened with its exact study edition and selection.");
    } catch (error) { if (active()) showError(error); }
    finally {
      if (node && workspace === expectedWorkspace && viewGeneration === expectedView && opening === reviewRequest) {
        reviewLoading = false; renderReview();
      }
    }
  }
  function saveReview(asNew = false) {
    if (!selectionReady() || busy || reviewLoading) { status("Wait for the selected source tables to finish loading.", true); return; }
    if (!reviewTitle.trim() || reviewTitle.trim().length > 200 || reviewNotes.length > 12000) {
      status("Enter a review title of 1–200 characters and notes of at most 12,000 characters.", true); return;
    }
    const payload = {...currentPayload(), ...reviewValue()};
    if (!asNew && sameSource()) payload.parent_review_id = savedReview.id;
    queue("published-study.review.save", payload);
  }
  function newReview() {
    savedReview = null; reviewChoice = ""; reviewTitle = activeRecord()?.title || ""; reviewNotes = "";
    edited(); status("New review draft uses the current source edition and filters.");
  }

  function find(selector) { return node?.querySelector(selector); }
  function status(message, error = false) {
    const target = find("[data-ps-status]");
    if (target) { target.textContent = message; target.dataset.error = String(error); }
  }
  async function api(path, body) {
    const controller = new AbortController(); requests.add(controller);
    try { return await host.api(path, {method: "POST", body: {workspace, ...body}, signal: controller.signal}); }
    finally { requests.delete(controller); }
  }
  function showError(error) {
    if (error?.name !== "AbortError") { status(error?.message || String(error), true); host.toast(error?.message || "Study request failed"); }
  }
  function activeRecord() {
    return arr(catalog?.studies).find(row => selected === row.study_id + "|" + row.version_id);
  }
  function currentPayload() {
    const record = activeRecord();
    return record ? {study_id: record.study_id, version_id: record.version_id, selection} : null;
  }

  function frame() {
    node.classList.add("published-studies-desk");
    node.innerHTML =
      '<header class="ps-header"><div><p class="ps-eyebrow">Field observations</p><h1>Published studies</h1>' +
      '<p>Inspect source tables by station, depth and parameter, then retain a complete study or export a selected report.</p></div>' +
      '<button type="button" data-ps-action="refresh">Refresh studies</button></header>' +
      '<p class="ps-status" data-ps-status role="status" aria-live="polite"></p>' +
      '<section class="ps-intake" aria-label="Study intake"><div data-ps-builtins></div>' +
      '<details><summary>Import another source or reopen a study</summary><form data-ps-import>' +
      '<div class="ps-form-grid"><label>Source folder<select name="root_id" required></select></label>' +
      '<label class="ps-wide">Source file or study directory<input name="relative_path" placeholder="studies/eighteenmile-2023.json" required></label>' +
      '<label>Original report file<input name="report_path" placeholder="Optional PDF in the same folder"></label>' +
      '<label>Table 7 image<input name="image_path" placeholder="Optional PNG in the same folder"></label></div>' +
      '<label class="ps-check"><input type="checkbox" name="include_installed_context" checked>Include installed study reports and analyses</label>' +
      '<p class="ps-help">Accepts the original study JSON, its complete Canvas Markdown, a complete study ZIP, or a directory of published tables. Paths start inside the selected source folder.</p>' +
      '<button type="submit">Import study</button></form></details></section>' +
      '<section class="ps-reviews" data-ps-geographic hidden aria-label="Geographic station selection"></section>' +
      '<section class="ps-study-control"><label>Retained study<select data-ps-study aria-label="Retained study"></select></label>' +
      '<div class="ps-actions"><button type="button" data-ps-action="report" disabled>Export selected report</button>' +
      '<button type="button" data-ps-action="export" disabled>Export complete study</button></div></section>' +

      '<section class="ps-reviews" aria-label="Saved study reviews"><h2>Study reviews</h2>' +
      '<div class="ps-review-open"><label>Saved review<select data-ps-review><option value="">Choose a saved review</option></select></label>' +
      '<button type="button" data-ps-action="open-review" disabled>Open review</button>' +
      '<button type="button" data-ps-action="new-review">New review</button></div>' +
      '<div data-ps-review-identity></div><p class="ps-help ps-review-selection" data-ps-review-selection></p>' +
      '<form data-ps-review-editor><label>Review title<input name="review_title" maxlength="200" required autocomplete="off"></label>' +
      '<label>Review notes<textarea name="review_notes" rows="4" maxlength="12000"></textarea></label>' +
      '<div class="ps-actions"><button type="submit" data-ps-action="save-review" disabled>Save review</button>' +
      '<button type="button" data-ps-action="save-new-review" disabled>Save as new review</button>' +
      '<button type="button" data-ps-action="export-review" disabled>Export saved review ZIP</button></div></form>' +
      '<details><summary>Import a complete review ZIP</summary><form data-ps-review-import><div class="ps-form-grid">' +
      '<label>Source folder<select name="root_id" required></select></label><label>Review ZIP path<input name="relative_path" required placeholder="reviews/study-review.zip"></label></div>' +
      '<p class="ps-help">Import restores the saved review and its exact original study edition from a previously exported review ZIP.</p>' +
      '<button type="submit">Import review</button></form></details></section>' +
      '<div data-ps-summary></div>' +
      '<form class="ps-filters" data-ps-filters hidden><fieldset><legend>Stations</legend><div data-ps-sites></div></fieldset>' +
      '<div class="ps-filter-grid"><label>Parameter<select name="parameter" multiple size="4" aria-describedby="ps-filter-help">' +
      Object.entries(PARAMETERS).map(([key, value]) => '<option value="' + key + '">' + esc(value) + "</option>").join("") +
      '</select><button type="button" class="ps-link-button" data-ps-clear-filter="parameter">All parameters</button></label><label>Depth stratum<select name="stratum" multiple size="3" aria-describedby="ps-filter-help"><option value="surface">Surface</option><option value="mid">Mid-water</option><option value="bottom">Bottom</option></select><button type="button" class="ps-link-button" data-ps-clear-filter="stratum">All strata</button></label>' +
      '<label><span data-ps-year-label>Continuous year</span><select name="year"><option value="">All years</option></select></label>' +
      '<label><span data-ps-month-label>Continuous month</span><select name="month" multiple size="4" aria-describedby="ps-filter-help">' +
      MONTHS.map((month, index) => '<option value="' + (index + 1) + '">' + month + "</option>").join("") +
      '</select><button type="button" class="ps-link-button" data-ps-clear-filter="month">All months</button></label></div><p class="ps-help" id="ps-filter-help">Select one or more values with Ctrl or Command. No selected parameter, stratum or month means all values. Use the All buttons to clear a filter.</p><p class="ps-help" data-ps-calendar-help>Month and year select continuous summaries. Seasonal tables retain their full published sampling campaign. Surface field ranges and continuous sensors retain their reported depths.</p></form>' +
      '<nav class="ps-tabs" aria-label="Study tables">' +
      [["seasonal","Seasonal"],["continuous","Continuous"],["observed","Report comparison"],["wqp","WQP source context"],["flow","Upstream flow"],["figures","Scientific figures"],["ranges","Field ranges"],["stations","Stations"],["sources","Sources and methods"]]
        .map(([id, title]) => '<button type="button" data-ps-tab="' + id + '" aria-pressed="' + (id === tab) + '">' + title + "</button>").join("") +
      '</nav><div data-ps-tables></div><aside class="ps-row-detail" data-ps-detail hidden aria-label="Original row details"></aside>';
  }

  function renderCatalog() {
    if (!node) return;
    const studies = arr(catalog?.studies);
    const control = find("[data-ps-study]");
    control.innerHTML = studies.length
      ? studies.map(row => '<option value="' + esc(row.study_id + "|" + row.version_id) + '">' + esc(row.title + " · " + row.version_id.slice(-8)) + "</option>").join("")
      : '<option value="">Import a study to begin</option>';
    if (!studies.some(row => row.study_id + "|" + row.version_id === selected)) selected = studies[0] ? studies[0].study_id + "|" + studies[0].version_id : null;
    control.value = selected || "";
    const rootControl = find('form[data-ps-import] select[name="root_id"]');
    const priorRoot = rootControl.value;
    rootControl.innerHTML = arr(catalog?.source_roots).map(root => '<option value="' + esc(root.id) + '">' + esc(root.label) + "</option>").join("");
    if (arr(catalog?.source_roots).some(root => root.id === priorRoot)) rootControl.value = priorRoot;
    find("[data-ps-builtins]").innerHTML = arr(catalog?.builtin_studies).map(study =>
      '<div class="ps-builtin"><div><strong>' + esc(study.title) + '</strong><p class="ps-help">' +
      esc(study.publication) + " · " + esc(study.counts.stations) + " stations · " +
      (study.counts.original_result_rows != null
        ? esc(study.counts.original_result_rows) + " original result rows · " +
          esc(study.counts.original_activity_count) + " activities"
        : esc(study.counts.seasonal_summary_rows) + " seasonal summaries") + "</p></div>" +
      '<button type="button" data-ps-builtin="' + esc(study.id) + '">Import installed study</button></div>'
    ).join("");
    for (const button of node.querySelectorAll('[data-ps-action="report"],[data-ps-action="export"]')) button.disabled = !selected || busy || !complete || loadedStudy !== selected;
    renderReview();
  }

  function renderSummary() {
    const target = find("[data-ps-summary]");
    if (!complete) {
      target.innerHTML = '<div class="ps-empty"><h2>Study context follows its sources</h2><p>Import the installed Eighteenmile study or select a retained study source to inspect the original tables.</p></div>';
      find("[data-ps-filters]").hidden = true; find("[data-ps-tables]").innerHTML = ""; return;
    }
    const {study, record} = complete, counts = record.counts || {}, grab = study.grab_sampling || {}, continuous = study.continuous || {};
    const sourceCohort = study.observation_calendar_filters === true;
    target.innerHTML = '<section class="ps-summary"><h2>' + esc(study.title) + '</h2><p>' +
      esc(study.issuing_body) + (sourceCohort ? " · Original source records" : " · Technical report " + esc(study.technical_report)) + " · " + esc(study.publication) +
      '</p><dl class="ps-counts">' +
      [["Stations",counts.stations],["Seasonal rows",counts.seasonal],["Monthly DO",counts.monthly_do],["Monthly pH",counts.monthly_ph],["Field range rows",counts.surface_ranges],["Observed result rows",counts.observed_activities || 0],["WQP result rows",counts.original_result_rows || 0],["WQP activities",counts.original_activity_count || 0],["Flow dates",counts.flow_dates || 0]]
        .map(([key,value]) => "<div><dt>" + esc(key) + "</dt><dd>" + esc(value) + "</dd></div>").join("") +
      '</dl><div class="ps-support">' + (sourceCohort
        ? '<p><strong>Observed sampling:</strong> ' + esc(grab.start) + " through " + esc(grab.end) +
          '.</p><p>' + esc(study.observation_scope) + '</p>'
        : '<p><strong>Grab sampling:</strong> ' + esc(grab.start) + " through " + esc(grab.end) +
          "; surface " + esc(grab.surface_depth_m) + " m; " + esc(grab.visits_per_site) + " planned visits per site.</p>" +
          '<p><strong>Continuous sensors:</strong> ' + esc(arr(continuous.stations).join(", ")) + "; " +
          esc(continuous.interval_minutes) + " minute interval at approximately " + esc(continuous.approximate_depth_m) +
          " m. Monthly sample counts are days.</p>") + "</div>" + reportLinks(complete) + "</section>";
    find("[data-ps-year-label]").textContent = sourceCohort ? "Sampling year" : "Continuous year";
    find("[data-ps-month-label]").textContent = sourceCohort ? "Sampling month" : "Continuous month";
    find("[data-ps-calendar-help]").textContent = sourceCohort
      ? "Year and month select original sampling dates. Fractions, analytical methods, result types and original units remain separate series."
      : "Month and year select continuous summaries. Seasonal tables retain their full published sampling campaign. Surface field ranges and continuous sensors retain their reported depths.";
    find('select[name="stratum"]').closest("label").hidden = sourceCohort && !selection.strata.length;
    for (const button of node.querySelectorAll("[data-ps-tab]")) {
      const id = button.dataset.psTab;
      button.hidden = sourceCohort && ["seasonal", "continuous", "flow", "figures", "ranges"].includes(id);
      if (id === "observed") button.textContent = sourceCohort ? "Observed series" : "Report comparison";
    }
    if (sourceCohort && ["seasonal", "continuous", "flow", "figures", "ranges"].includes(tab) && !savedReview) tab = "observed";
    // A saved table remains visible even when a source study normally hides that tab.
    for (const button of node.querySelectorAll("[data-ps-tab]")) if (button.dataset.psTab === tab) button.hidden = false;
    const availableSites = [...new Set([...arr(complete.available_stations || complete.tables.stations).map(row => row.site_id), ...selection.site_ids])];
    find("[data-ps-sites]").innerHTML = availableSites.map(id => '<label class="ps-check"><input type="checkbox" name="site" value="' +
      esc(id) + '"' + (!selection.site_ids.length || selection.site_ids.includes(id) ? " checked" : "") + ">" + esc(id) + "</label>").join("");
    const years = [...new Set(sourceCohort ? arr(complete.observation_rows).map(row => Number(row.date.slice(0,4))) : [...arr(complete.tables.monthly_do),...arr(complete.tables.monthly_ph)].map(row => row.year))].sort();
    if (selection.year != null && !years.includes(selection.year)) { years.push(selection.year); years.sort(); }
    const yearControl = find('form[data-ps-filters] select[name="year"]');
    yearControl.innerHTML = '<option value="">All years</option>' + years.map(year => '<option value="' + year + '">' + year + "</option>").join("");
    yearControl.value = selection.year || "";
    const parameterControl = find('form[data-ps-filters] select[name="parameter"]');
    const parameterOptions = [...new Set([...(sourceCohort ? [] : Object.keys(PARAMETERS)), ...arr(complete.original_measurements).map(row => row.parameter)])].sort((a,b) => label(a).localeCompare(label(b)));
    for (const value of selection.parameters) if (!parameterOptions.includes(value)) parameterOptions.push(value);
    parameterControl.innerHTML = parameterOptions.map(value => '<option value="' + esc(value) + '">' + esc(label(value)) + "</option>").join("");
    selectValues(parameterControl, selection.parameters);
    const stratumControl = find('form[data-ps-filters] select[name="stratum"]');
    stratumControl.innerHTML = [...new Set(["surface","mid","bottom",...selection.strata])].map(value => '<option value="' + esc(value) + '">' + esc(label(value)) + "</option>").join("");
    selectValues(stratumControl, selection.strata);
    selectValues(find('form[data-ps-filters] select[name="month"]'), selection.months);
    find("[data-ps-filters]").hidden = false;
  }

  function reportLinks(value) {
    const reports = arr(value?.retained_reports);
    if (!reports.length) return "";
    return '<section class="ps-methods"><h3>Original studies and scientific analyses</h3><p>Open each retained report to inspect its stated observation cohort, sampling dates, figures and source files. Full-study analyses keep their original scope when the tables below are filtered.</p><ul class="ps-source-list">' +
      reports.map(report => "<li>" + link(report.url, report.title ? "Open " + report.title : "Open " + report.path.split("/").pop()) +
        " · " + link(report.download?.url + "?download=1", "Download original HTML") +
        '<span class="ps-help">' + Number(report.bytes).toLocaleString() + " bytes</span></li>").join("") +
      "</ul><p>Export the complete study to keep the report and all original companion files together for offline use.</p></section>";
  }


  function sourcePage(row) {
    if (row.source_observation || row.source_file?.startsWith("wqp") || row.source_file?.startsWith("cohort_reconciliation")) {
      const source = arr(complete?.source_artifacts).find(item => item.path === row.source_file);
      let result = link(source?.download?.url, "Retained CSV · row " + row.source_csv_row);
      if (row.original_source_path) {
        const raw = arr(complete?.source_artifacts).find(item => item.path === row.original_source_path);
        result += "<br>" + link(raw?.download?.url, "Original response · CSV row " + (Number(row.original_source_record_index) + 2));
      }
      return result;
    }
    const pdf = arr(complete?.source_artifacts).find(item => item.path.toLowerCase().endsWith(".pdf"));
    const url = pdf?.download?.url || row.source_url || row.report_url || complete?.study?.original_url;
    const page = row.source_pdf_page || row.report_pdf_page;
    return link(page && url ? url.split("#")[0] + "#page=" + page : url, "Table " + (row.source_table || row.report_table || "—") + " · PDF " + (page || "—"));
  }

  function table(title, rows, columns, source = true) {
    if (!rows.length) return '<section class="ps-table-section"><h2>' + esc(title) + '</h2><p class="ps-empty-row">No rows match this selection.</p></section>';
    return '<section class="ps-table-section"><h2>' + esc(title) + ' <span class="ps-help">(' + rows.length + ')</span></h2><div class="ps-table-scroll"><table><thead><tr>' +
      columns.map(([,title]) => "<th>" + esc(title) + "</th>").join("") +
      (source ? "<th>Source</th>" : "") + "<th>Original row</th></tr></thead><tbody>" +
      rows.map(row => "<tr>" + columns.map(([field]) => "<td>" + esc(cell(row,field)) + "</td>").join("") +
        (source ? "<td>" + sourcePage(row) + "</td>" : "") +
        '<td><button type="button" class="ps-link-button" data-ps-row="' + esc(row.record_id || "") + '">Details</button></td></tr>').join("") +
      "</tbody></table></div></section>";
  }
  function renderTables(context) {
    if (!node || !context) return;
    for (const button of node.querySelectorAll("[data-ps-tab]")) button.setAttribute("aria-pressed", String(button.dataset.psTab === tab));
    const tables = context.tables;
    let output = "";
    if (tab === "seasonal") {
      output = table("Seasonal concentration summaries", arr(tables.seasonal), [
        ["site_id","Station"],["stratum","Stratum"],["depth_min_m","From m"],["depth_max_m","To m"],
        ["parameter","Parameter"],["units","Unit"],["mean","Mean"],["sd","SD"],
        ["minimum","Min"],["maximum","Max"],["n","n as printed"]
      ]);
      const methods = [...new Set(arr(tables.seasonal).flatMap(row => [row.censor_substitution,row.parameter_formula]).filter(Boolean))];
      output += '<section class="ps-methods"><h3>Published statistical treatment</h3><p>Mean and standard deviation describe the original seasonal samples. Depth intervals follow each site and stratum.</p>' +
        methods.map(method => "<p>" + esc(method) + "</p>").join("") + "</section>";
    } else if (tab === "continuous") {
      const columns = [["site_id","Station"],["year","Year"],["month","Month"],["units","Unit"],["avg_daily_minimum","Avg daily min"],["avg_daily_maximum","Avg daily max"],["published_avg_daily_range","Published avg daily range"],["n_days","Days"]];
      output = table("Monthly dissolved oxygen", arr(tables.monthly_do), columns) +
        table("Monthly pH", arr(tables.monthly_ph), [...columns,["days_with_max_above_8_5","Days max > 8.5"]]);
    } else if (tab === "observed") {
      const observed = context.observations || {}, series = arr(observed.series).map(row => ({
        ...row, record_id: row.published?.record_id,
        observed_mean: row.mean == null ? "" : Number(row.mean).toFixed(6),
        observed_sd: row.sample_sd == null ? "" : Number(row.sample_sd).toFixed(6),
        reported_depths: arr(row.depths_as_reported).join("; "),
      }));
      output = '<section class="ps-methods"><h2>Original activities and published summaries</h2><p>' +
        esc(observed.temporal_support || "Import the current installed study to retain its original activity sources.") +
        '</p><p>Activity values, original sample counts and printed report statistics remain visible together. Quantified-only statistics use the original recorded numbers. Censored rows retain blank values and their own detection limits.</p></section>';
      const illustrated = arr(complete?.source_artifacts).find(item => item.path === "wqp_20261013/lake-observations-report.html");
      if (illustrated) output += '<p>' + link(illustrated.preview_url || illustrated.download?.url, "Original activity figures and complete chlorophyll cohort report") + '</p>';
      const paired = arr(complete?.source_artifacts).find(item => item.path === "paired_analysis/paired-observations-report.html");
      if (paired) output += '<p>' + link(paired.preview_url || paired.download?.url, "Original matched-activity and paired-station analysis") +
        ' · The report export includes its linked tables and complete original source files.</p>';
      const microcystinReport = arr(complete?.source_artifacts).find(item => item.path === "microcystin_reconciliation/report-reconciliation.html");
      if (microcystinReport) output += '<p>' + link(microcystinReport.preview_url || microcystinReport.download?.url, "Table 8 candidate cohort and original microcystin reconciliation") +
        ' · Retains 73 selected records, 12 excluded campaign records, original reporting limits and the source selection inference.</p>';
      output += table("Observed series and report rows", series, [
        ["site_id","Station"],["parameter","Parameter"],["unit","Unit"],["project_id","Source project"],["activity_type","Activity type"],["sample_fraction","Fraction"],["method_authority","Method authority"],["method_id","Method"],["method_specification_name","Method specification"],["result_value_type","Result type"],["sample_support","Sample support"],["record_count","Original rows"],
        ["activity_count","Activities"],["numeric_count","Quantified"],["censored_count","Censored"],
        ["published_n","Printed n"],["observed_mean","Quantified mean"],["observed_sd","Quantified sample SD"],
        ["published_mean","Printed mean"],["published_sd","Printed SD"],["reported_depths","Original depth"]
      ]);
      output += series.map(row => '<p class="ps-help"><strong>' + esc(row.site_id) + " / " + esc(label(row.parameter)) +
        ":</strong> " + esc(row.basis) + "</p>").join("");
      const supported = series.filter(row => row.observation_support).map(row => {
        const support = row.observation_support;
        const endpoint = value => value == null ? "" : Number(value).toPrecision(6);
        return {...row, ...support, mean_interval: support.complete_interval_support
          ? "[" + endpoint(support.mean_lower) + ", " + endpoint(support.mean_upper) + (support.mean_upper_inclusive ? "]" : ")")
          : "Unavailable",
          limits: arr(support.reporting_limits).map(item => item.value + " " + item.unit).join("; ")};
      });
      if (supported.length) {
        output += table("Original concentration support", supported, [
          ["site_id","Station"],["parameter","Parameter"],["project_id","Project"],["activity_type","Activity type"],
          ["sample_fraction","Fraction"],["method_id","Method"],["result_value_type","Result type"],
          ["record_count","Original rows"],["quantified_count","Quantified"],["below_limit_count","Below limit"],
          ["unresolved_count","Unresolved"],["mean_interval","All-row mean interval"],["unit","Unit"],
          ["limits","Original reporting limits"]
        ],false);
        output += '<p class="ps-help">Each interval uses every selected row in its original station, parameter, project and activity-type series. A below-limit value contributes [0, its original limit), conditional on nonnegative concentration. The upper endpoint is excluded when a row is censored. These are arithmetic bounds; the source values and printed report cohort stay intact. Complete endpoints and source selectors are included in the context export.</p>';
      }
      const calendars = series.map(row => ({
        ...row, missing_dates: arr(row.missing_chlorophyll_dates).join("; "),
        extra_dates: arr(row.additional_dates).join("; "), methods: arr(row.original_methods).join("; "),
      }));
      output += table("Original observation calendars", calendars, [
        ["site_id","Station"],["parameter","Parameter"],["period_start","First date"],["period_end","Last date"],
        ["missing_dates","Dates absent from chlorophyll visits"],["extra_dates","Additional dates"],["methods","Source methods"]
      ],false);
      output += table("Original activity chronology", arr(observed.rows), [
        ["site_id","Station"],["date","Date"],["local_time","Local time"],["source_timezone","Source zone"],
        ["project_id","Source project"],["activity_type","Activity type"],["parameter_original","Original parameter"],["sample_fraction","Fraction"],["method_id","Method"],["result_value_type","Result type"],["value","Value"],["unit","Unit"],
        ["detection_condition","Detection"],["detection_limit","Limit"],["detection_limit_unit","Limit unit"],
        ["depth","Depth"],["depth_unit","Depth unit"],["activity_id","Activity identifier"],["original_result_identifier","Original result identifier"],
        ["result_comment","Original result comment"],["activity_comment","Original activity comment"],["laboratory_comment","Original laboratory comment"]
      ]);
      const cohort = context.cohort_reconciliation;
      if (cohort) {
        output += '<section class="ps-methods"><h3>Original chlorophyll cohort selection</h3><p>' + esc(cohort.cohort_basis) +
          '</p><p>The same-date activity assignment is an inference from the publisher-displayed local clocks, routine-project records and reproduced summaries. Original EST and EDT labels remain unchanged.</p><ul>' +
          arr(cohort.exclusion_evidence).filter(row => selection.site_ids.includes(row.site_id)).map(row => "<li>" +
            esc(row.site_id) + " · " + esc(row.date) + ": retained " + esc(row.retained_original_record?.activity_id) +
            "; separate routine " + esc(row.excluded_original_record?.activity_id) + ". " + esc(row.timezone_interpretation) + "</li>").join("") + "</ul></section>";
      }
      const ambiguity = context.observation_reconciliation?.additional_station_cohorts;
      if (!context.cohort_reconciliation && ambiguity && arr(ambiguity.scope).some(site => selection.site_ids.includes(site))) {
        output += '<section class="ps-methods"><h3>Additional station activity cohorts</h3><p>' + esc(ambiguity.selection) +
          '</p><ul>' + arr(ambiguity.same_campaign_date_ambiguities).filter(row => selection.site_ids.includes(row.station_id)).map(row =>
            "<li>" + esc(row.station_id) + " · " + esc(row.date) + " · " + esc(arr(row.chlorophyll_values_ug_l).join(", ")) +
            " ug/L · source times " + esc(arr(row.source_times).join(", ")) + " " + esc(row.source_timezone) + "</li>").join("") + "</ul></section>";
      }
    } else if (tab === "wqp") {
      const dated = context.dated_context || {};
      output = '<section class="ps-methods"><h2>Original WQP source context</h2><p>' + esc(complete.study.observation_calendar_filters === true ? 'Browse original agency result records by station, characteristic and sampling calendar. Fractions, methods, calculated result labels, detection limits and all original source cells are preserved. Complete unfiltered agency responses remain in the study export.' : 'Browse the complete acquired source year with original projects, fractions, depths, units, limits and activity identifiers. The report comparison uses its separately identified chlorophyll cohort. Station and parameter filters select these source rows.') + '</p></section>';
      output += table("Source coverage", arr(dated.coverage), [
        ["site_id","Station"],["project_id","Project"],["characteristic","Original characteristic"],
        ["sample_fraction","Fraction"],["reported_unit","Unit"],["record_count","Rows"],
        ["numeric_reported_count","Numeric reported"],["quantified_count","Quantified"],["censored_below_count","Censored below"],["censored_above_count","Censored above"]
      ]);
      output += table("Retained original results", arr(dated.rows), [
        ["site_id","Station"],["date","Date"],["local_time","Local time"],["source_timezone","Source zone"],
        ["project_id","Project"],["activity_type","Activity type"],["parameter_original","Original characteristic"],["sample_fraction","Fraction"],
        ["value","Value"],["unit","Unit"],["detection_condition","Detection"],["detection_limit","Limit"],
        ["detection_limit_unit","Limit unit"],["detection_limit_type","Limit type"],["censor_direction","Censor direction"],["depth","Depth"],["depth_unit","Depth unit"],
        ["method_authority","Method authority"],["method_id","Method"],["method_specification_name","Method specification"],["result_value_type","Result type"],["cohort_selection","Cohort selection"],["activity_id","Activity identifier"],["original_result_identifier","Original result identifier"],
        ["result_comment","Original result comment"],["activity_comment","Original activity comment"],["laboratory_comment","Original laboratory comment"]
      ]);
      const empty = arr(dated.summary?.empty_source_stations).filter(id => selection.site_ids.includes(id));
      if (empty.length) output += '<p class="ps-help">The exact organization/station/year query returned a header-only original response for ' + esc(empty.join(", ")) + '. Its original response is retained with the source collection.</p>';
      output += '<details class="ps-source-notes"><summary>Source selection methods</summary>' +
        arr(dated.summary?.method_notes).map(value => "<p>" + esc(value) + "</p>").join("") + "</details>";
    } else if (tab === "flow") {
      const dated = context.dated_context || {}, methods = dated.flow_methods?.method || {};
      output = '<section class="ps-methods"><h2>Observed upstream discharge on sample dates</h2><p>' +
        esc(methods.statistic || "Retained daily mean discharge") + ". " + esc(methods.date_join || "Original reporting calendar date") +
        '.</p><p>Antecedent windows contain the previous three or seven reporting dates and exclude the sampling date. Discharge remains in ft³/s; each original qualifier and response record index is available in row details.</p></section>';
      output += table("Upstream daily and antecedent flow", arr(dated.flow_rows), [
        ["sampling_date","Sampling date"],["gauge_id","Gauge"],["same_date_mean_cfs","Daily mean ft³/s"],
        ["same_date_qualifiers","Qualifier"],["annual_flow_percentile_midrank","Annual percentile"],
        ["prior_3d_mean_cfs","Prior 3-day mean ft³/s"],["prior_7d_mean_cfs","Prior 7-day mean ft³/s"],
        ["prior_7d_maximum_daily_cfs","Prior 7-day maximum ft³/s"],["prior_7d_maximum_dates","Maximum date"],
        ["prior_7d_valid_days","Valid days"],["prior_7d_expected_days","Expected days"],
        ["annual_p95_daily_cfs","Annual p95 ft³/s"],["annual_reference_valid_days","Annual valid days"]
      ]);
      output += '<p class="ps-help">Selected activity dates outside this retained flow-date table: ' +
        esc(arr(dated.dates_without_flow_context).join(", ") || "none") + ".</p>";
    } else if (tab === "figures") {
      const originals = [
        ["figures/chlorophyll_time_series.svg","Chlorophyll at the five original stations"],
        ["figures/chlorophyll_distributions.svg","All selected chlorophyll observations and distributions"],
        ["figures/sampling_flow_context.svg","Observed upstream flow on the original laboratory dates"],
        ["figures/chlorophyll_antecedent_context.svg","Chlorophyll and preceding upstream flow"],
      ];
      const assets = arr(complete?.source_artifacts);
      output = '<section class="ps-methods"><h2>Original scientific figures</h2><p>These retained figures show the complete original 75-observation chlorophyll cohort and 16 laboratory dates. They retain their full source scope when the study tables are filtered. Original axis scales, activity identities and units are preserved.</p><p>The report package includes these original SVGs, numerical plot data, source inputs and their offline reconstruction code.</p></section>';
      let count = 0;
      for (const [name,title] of originals) {
        const item = assets.find(asset => asset.path === name);
        if (!item) continue;
        count++;
        output += '<section class="ps-visual"><h3>' + esc(title) + '</h3><p>' + link(item.download?.url,"Download original SVG") +
          '</p><img loading="lazy" src="' + esc(item.download?.url || "") + '" alt="' + esc(title) + '"></section>';
      }
      if (!count) output += '<p class="ps-help">Import the complete current study source to retain its scientific figure component.</p>';
      output += '<ul class="ps-source-list">' + assets.filter(item => [
        "figures/plot-data.csv","figures/distribution-statistics.csv","figures/figure-spec.json","figures/README.md"
      ].includes(item.path)).map(item => '<li>' + link(item.download?.url,item.path) + '</li>').join("") + '</ul>';
    } else if (tab === "ranges") {
      const rows = arr(context.surface_parameter_ranges).map(row => ({...row, record_id: arr(tables.surface_ranges).find(raw => raw.site_id === row.site_id)?.record_id}));
      output = table("Surface field ranges", rows, [
        ["site_id","Station"],["parameter","Parameter"],["units","Unit"],["minimum","Min"],["maximum","Max"],["depth_m","Depth m"],["period_start","Start"],["period_end","End"],["general_event_count","Typical events"]
      ]);
    } else if (tab === "stations") {
      output = table("Station coordinates and native datums", arr(tables.stations), [
        ["site_id","Station"],["description","Description"],["latitude","Latitude"],["longitude","Longitude"],["datum","Datum"],["epsg","EPSG"],["monitoring_location_id","Monitoring location"]
      ]) + table("Permits identified by the published report", arr(tables.permits), [
        ["npdes_permit_id","Permit"],["report_facility_name","Reported facility"],["edition","Edition"]
      ]);
    } else {
      output = '<section class="ps-methods"><h2>Original report and retained files</h2><p>' +
        link(complete.study.original_url,"Publisher report") + '</p><ul class="ps-source-list">' +
        arr(context.source_artifacts).map(item => "<li>" + link(item.preview_url || item.download?.url,item.path) +
          (item.preview_url ? " · " + link(item.download?.url + "?download=1", "Original HTML") : "") + '<span class="ps-help">' +
          Number(item.bytes).toLocaleString() + " bytes</span></li>").join("") + "</ul></section>";
      const composed = arr(complete?.record?.origin?.installed_context);
      if (composed.length) output += '<section class="ps-methods"><h2>Included study context</h2><p>This source version retains the imported edition with these installed original report and analysis manifests.</p><ul>' +
        composed.map(item => '<li>' + esc(item.manifest) + ' · ' + Number(item.native_entry_count).toLocaleString() + ' source entries</li>').join("") + '</ul></section>';
      for (const visual of arr(context.visual_context)) {
        const reading = visual.visual_reading || {};
        output += '<section class="ps-visual"><h2>Table 7 original page reading</h2><p>' + esc(reading.result) +
          "</p><p>Printed page " + esc(reading.printed_page) + " · PDF viewer page " + esc(reading.pdf_viewer_page) + "</p>";
        const image = arr(context.source_artifacts).find(item => /table-?7.*\.png$/i.test(item.path));
        if (image?.download?.url) output += '<img loading="lazy" src="' + esc(image.download.url) + '" alt="Table 7 from the original publisher report">';
        const discrepancy = visual.source_discrepancy || {};
        output += '<p>The five printed table counts total ' + esc(discrepancy.table_n_sum) +
          ". The methods section reports " + esc(discrepancy.methods_reported_chlorophyll_samples) +
          " chlorophyll samples. Each statement is retained with its original page.</p>" +
          (visual.numeric_consistency ? "<p>" + esc(visual.numeric_consistency.interpretation) + "</p>" : "") + "</section>";
      }
    }
    const notes = arr(context.source_notes);
    if (notes.length) output += '<details class="ps-source-notes"><summary>Source notes (' + notes.length + ')</summary>' +
      notes.map(note => '<article><h3>' + esc(label(note.code)) + "</h3><p>" +
        esc(note.context || JSON.stringify(note)) + "</p>" +
        (note.source_pdf_page ? "<p>" + sourcePage(note) + "</p>" : "") + "</article>").join("") + "</details>";
    find("[data-ps-tables]").innerHTML = output;
  }


  async function loadSelection() {
    const payload = currentPayload(); if (!payload || !node || loadedStudy !== selected) return;
    const id = ++request, expectedWorkspace = workspace, expectedView = viewGeneration;
    const active = () => id === request && Boolean(node) && workspace === expectedWorkspace &&
      host.getWorkspace() === expectedWorkspace && viewGeneration === expectedView;
    loadedSelection = null; renderReview(); status("Loading published table selection…");
    find("[data-ps-tables]").innerHTML = '<p class="ps-empty-row">Loading the selected source tables…</p>';
    try {
      const result = await api("/api/published-studies/context", payload);
      if (!active()) return;
      loadedSelection = canonical(payload); renderTables(result); renderReview(); remember(); status("Published source tables loaded.");
    } catch (error) { if (active()) showError(error); }
  }
  async function loadStudy() {
    const record = activeRecord(), id = ++request, expectedWorkspace = workspace, expectedView = viewGeneration;
    const key = selected;
    const active = () => id === request && Boolean(node) && workspace === expectedWorkspace &&
      host.getWorkspace() === expectedWorkspace && viewGeneration === expectedView && selected === key;
    complete = null; loadedStudy = null; loadedSelection = null; renderSummary(); renderReview();
    if (!record) return;
    status("Opening retained study…");
    try {
      const result = await api("/api/published-studies/study", {study_id: record.study_id, version_id: record.version_id});
      if (!active()) return;
      complete = result; loadedStudy = key;
      if (!reviewTitle && !savedReview) reviewTitle = record.title;
      renderSummary(); renderReview(); await loadSelection();
    } catch (error) { if (active()) showError(error); }
  }
  async function refreshCatalog(prefer = null) {
    if (prefer) catalogPreference = {result:prefer, workspace, view:viewGeneration, edit:editGeneration};
    if (catalogPreference && (catalogPreference.workspace !== workspace || catalogPreference.view !== viewGeneration ||
        catalogPreference.edit !== editGeneration)) catalogPreference = null;
    const preferred = catalogPreference;
    const id = ++catalogRequest, expectedWorkspace = workspace, expectedView = viewGeneration, expectedEdit = editGeneration;
    const active = () => id === catalogRequest && Boolean(node) && workspace === expectedWorkspace &&
      host.getWorkspace() === expectedWorkspace && viewGeneration === expectedView;
    try {
      const result = await api("/api/published-studies/catalog", {});
      if (!active()) return;
      const previous = selected, acceptPreference = expectedEdit === editGeneration;
      prefer = acceptPreference ? preferred?.result || null : null;
      if (catalogPreference === preferred) catalogPreference = null;
      catalog = result;
      if (acceptPreference && prefer?.study_id && prefer?.version_id) selected = prefer.study_id + "|" + prefer.version_id;
      renderCatalog();
      if (acceptPreference && prefer?.review?.id) {
        await openReview(prefer.review.id);
      } else if (selected !== previous || !complete || (prefer && acceptPreference)) {
        await loadStudy();
      }
      if (active()) { renderReview(); remember(); }
    } catch (error) { if (active()) showError(error); }
  }

  function taskCanSelect(entry) {
    return Boolean(node) && workspace === entry.workspace && host.getWorkspace() === entry.workspace &&
      viewGeneration === entry.view && editGeneration === entry.edit;
  }
  async function finishTasks(completions) {
    let relevant = false, preferred = null;
    for (const {task,entry} of completions) {
      pending.delete(task.id); operationIds.delete(entry.key);
      if (!node || workspace !== entry.workspace || host.getWorkspace() !== entry.workspace) continue;
      relevant = true;
      if (taskCanSelect(entry) && !["published-study.export","published-study.report","published-study.review.export"].includes(entry.action)) preferred = task.result;
    }
    if (!relevant) return;
    status("Study task completed. " + (preferred ? "" : "Saved results are available in the catalogue and task."));
    await refreshCatalog(preferred);
  }
  async function finishTask(task, entry) { return finishTasks([{task,entry}]); }
  async function queue(action, payload) {
    if (busy) return;
    const expectedWorkspace = workspace, expectedView = viewGeneration;
    const active = () => Boolean(node) && workspace === expectedWorkspace &&
      viewGeneration === expectedView && host.getWorkspace() === expectedWorkspace;
    const key = canonical({workspace,action,payload});
    if (!operationIds.has(key)) operationIds.set(key, "published-study-" + crypto.randomUUID());
    if (!["published-study.export","published-study.report","published-study.review.export"].includes(action)) ++editGeneration;
    const entry = {action,key,workspace:expectedWorkspace,view:expectedView,edit:editGeneration};
    busy = true; renderCatalog(); renderReview(); status("Queueing study task…");
    try {
      const task = await host.api("/api/actions", {method:"POST",body:{workspace:expectedWorkspace,action,payload:copy(payload),operation_id:operationIds.get(key)}});
      pending.set(task.id,entry); taskStamp = "";
      if (!active()) return;
      if (task.state === "complete" || task.state === "completed") {
        await finishTask(task, entry);
        if (!active()) return;
      }
      await host.refresh({force:true});
      if (!active()) return;
      host.showTask(task.id);
      status("Study task " + task.id + " is " + task.state + ".");
      update(host.getState());
    } catch (error) { if (active()) showError(error); }
    finally { if (active()) { busy = false; renderCatalog(); renderReview(); } }
  }
  function detail(id) {
    const rows = [...Object.values(complete?.tables || {}).flat(), ...arr(complete?.observation_rows), ...arr(complete?.original_measurements), ...arr(complete?.wqp_coverage), ...arr(complete?.flow_rows)];
    const row = rows.find(item => item.record_id === id);
    if (!row) return;
    const target = find("[data-ps-detail]");
    target.innerHTML = '<div class="ps-detail-head"><h2>Original row</h2><button type="button" data-ps-action="close-detail">Close</button></div>' +
      '<p>' + esc(row.source_file) + " · CSV row " + esc(row.source_csv_row) + " · " + sourcePage(row) +
      '</p><dl class="ps-raw-cells">' + Object.entries(row.raw_cells || {}).map(([key,value]) =>
        "<dt>" + esc(key) + "</dt><dd>" + esc(value === "" ? "(blank)" : value) + "</dd>").join("") + "</dl>";
    for (const [role, reference] of Object.entries(row.metadata_source_records || {})) {
      const source = arr(complete?.source_artifacts).find(item => item.path === reference.source_file);
      const title = role === "activity" ? "Original activity metadata" : "Original reporting-limit metadata";
      target.innerHTML += "<h3>" + esc(title) + "</h3><p>" +
        link(source?.download?.url, reference.source_file + " · CSV row " + reference.source_csv_row) +
        "</p><p>Joined by " + esc(reference.join_key) + " = " + esc(reference.join_value) + "</p>" +
        '<dl class="ps-raw-cells">' + Object.entries(reference.raw_cells || {}).map(([key, value]) =>
          "<dt>" + esc(key) + "</dt><dd>" + esc(value === "" ? "(blank)" : value) + "</dd>").join("") + "</dl>";
    }
    target.hidden = false; target.scrollIntoView({block:"nearest",behavior:"smooth"});
  }

  function filters() {
    const form = find("[data-ps-filters]"), data = new FormData(form), sites = data.getAll("site");
    if (!sites.length) {
      for (const input of form.querySelectorAll('input[name="site"]')) input.checked = !selection.site_ids.length || selection.site_ids.includes(input.value);
      status("Select at least one station. The previous station selection has been restored.",true); return;
    }
    selection = {site_ids:sites, parameters:data.getAll("parameter").filter(Boolean),
      strata:data.getAll("stratum").filter(Boolean), year:data.get("year") ? Number(data.get("year")) : null,
      months:data.getAll("month").filter(Boolean).map(Number)};
    edited(); loadSelection();
  }
  function click(event) {
    const button = event.target.closest("button"); if (!button || !node.contains(button)) return;
    if (button.dataset.psBuiltin) queue("published-study.import",{builtin_id:button.dataset.psBuiltin});
    if (button.dataset.psTab) { tab = button.dataset.psTab; edited(); loadSelection(); }
    if (button.dataset.psRow) detail(button.dataset.psRow);
    if (button.dataset.psClearFilter) {
      const control = find('form[data-ps-filters] select[name="' + button.dataset.psClearFilter + '"]');
      selectValues(control, []); filters();
    }
    const action = button.dataset.psAction;
    if (action === "refresh") refreshCatalog();
    if (action === "geographic-refresh" && geographicInput) openForStations({workspace_key:workspace, ...geographicInput});
    if (action === "geographic-apply") applyGeographic();
    if (action === "geographic-previous") restoreGeographicDraft();
    if (action === "geographic-close") { ++geographicRequest; geographicInput = null; geographicPreview = null; geographicLoading = false; renderGeographic(); remember(); }
    if (action === "close-detail") find("[data-ps-detail]").hidden = true;
    if (action === "report" && currentPayload()) queue("published-study.report",currentPayload());
    if (action === "export" && currentPayload()) {
      const {study_id,version_id} = currentPayload(); queue("published-study.export",{study_id,version_id});
    }
    if (action === "open-review") openReview(reviewChoice);
    if (action === "new-review") newReview();
    if (action === "save-new-review") saveReview(true);
    if (action === "export-review" && savedReview) queue("published-study.review.export",{review_id:savedReview.id});
  }
  function submit(event) {
    if (event.target.matches("[data-ps-filters]")) { event.preventDefault(); return; }
    if (event.target.matches("[data-ps-review-editor]")) { event.preventDefault(); saveReview(); return; }
    if (event.target.matches("[data-ps-review-import]")) {
      event.preventDefault();
      const data = new FormData(event.target);
      queue("published-study.review.import", {source:{root_id:data.get("root_id"),relative_path:String(data.get("relative_path") || "").trim()}});
      return;
    }
    if (!event.target.matches("[data-ps-import]")) return;
    event.preventDefault();
    const data = new FormData(event.target), root_id = data.get("root_id");
    const payload = {source:{root_id,relative_path:String(data.get("relative_path") || "").trim()},evidence:[],include_installed_context:data.has("include_installed_context")};
    for (const [field,filename] of [["report_path","2023LakeProgramFinalReport.pdf"],["image_path","table7-page21.png"]]) {
      const relative_path = String(data.get(field) || "").trim();
      if (relative_path) payload.evidence.push({filename,source:{root_id,relative_path}});
    }
    queue("published-study.import",payload);
  }

  function update(state = host.getState()) {
    if (!node || host.getWorkspace() !== workspace) return;
    const relevant = tasksFrom(state).filter(task => String(task.action || "").startsWith("published-study."));
    const stamp = relevant.map(task => task.id + ":" + task.state).sort().join("|");
    if (stamp === taskStamp) return; taskStamp = stamp;
    const completed = [];
    for (const task of relevant) {
      const entry = pending.get(task.id);
      if (!entry || entry.workspace !== workspace) continue;
      if (task.state === "complete" || task.state === "completed") {
        completed.push({task,entry});
      } else if (["failed","interrupted","cancelled"].includes(task.state)) {
        pending.delete(task.id); status(task.error?.message || ("Study task " + task.state + ". Open the task to resume."),true);
      }
    }
    // Each completion retains its accepted operation and source-selection generation.
    // Do not let an older queued operation select over a later edit or opened review.
    if (completed.length) {
      const expectedWorkspace = workspace, expectedView = viewGeneration;
      finishTasks(completed).catch(error => {
        if (node && workspace === expectedWorkspace && host.getWorkspace() === expectedWorkspace && viewGeneration === expectedView) showError(error);
      });
    }
  }
  function mount(target, state = host.getState()) {
    detach();
    node = target; workspace = host.getWorkspace(); events = new AbortController();
    if (!workspace) { node.textContent = "Choose a workspace to inspect published studies."; return; }
    busy = false; reviewLoading = false; taskStamp = ""; catalog = null; complete = null; loadedStudy = null; loadedSelection = null;
    const draft = drafts.get(workspace);
    selected = draft?.selected || null; selection = copy(draft?.selection || emptySelection()); tab = draft?.tab || "seasonal";
    savedReview = copy(draft?.savedReview || null); reviewChoice = draft?.reviewChoice || "";
    reviewTitle = draft?.reviewTitle || ""; reviewNotes = draft?.reviewNotes || ""; interpretationMatches = draft?.interpretationMatches !== false;
    geographicInput = copy(draft?.geographicInput || null); geographicPreview = copy(draft?.geographicPreview || null);
    geographicChoice = draft?.geographicChoice || ""; geographicPrevious = copy(draft?.geographicPrevious || null); geographicLoading = false;
    ++editGeneration;
    frame(); renderGeographic();
    node.addEventListener("click",click,{signal:events.signal});
    node.addEventListener("submit",submit,{signal:events.signal});
    node.addEventListener("input",event => {
      if (event.target.name === "review_title") { reviewTitle = event.target.value; edited(); }
      if (event.target.name === "review_notes") { reviewNotes = event.target.value; edited(); }
    },{signal:events.signal});
    node.addEventListener("change",event => {
      if (event.target.matches("[data-ps-study]")) {
        selected = event.target.value; selection = emptySelection(); savedReview = null; reviewChoice = "";
        reviewTitle = activeRecord()?.title || ""; reviewNotes = "";
        find("[data-ps-detail]").hidden = true; edited(); loadStudy();
      } else if (event.target.matches("[data-ps-geographic-study]")) {
        geographicChoice = event.target.value; ++geographicRequest; geographicLoading = false; edited(); renderGeographic();
      } else if (event.target.matches("[data-ps-review]")) {
        reviewChoice = event.target.value; edited();
      } else if (event.target.closest("[data-ps-filters]")) filters();
    },{signal:events.signal});
    renderReview(); update(state); refreshCatalog();
  }
  function detach() {
    remember();
    events?.abort(); for (const controller of requests) controller.abort(); requests.clear();
    ++request; ++catalogRequest; ++viewGeneration; ++reviewRequest; ++geographicRequest; catalogPreference = null;
    if (node) node.classList.remove("published-studies-desk");
    node = null; events = null;
  }
  return {mount,update,detach,openForStations};
}
