const esc = value => String(value ?? "").replace(/[&<>"']/g, c =>
  ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const copy = value => value == null ? value : JSON.parse(JSON.stringify(value));

/** Scientific-source continuation of an immutable original study review. */
export function createPublishedReviewReports(host, bridge) {
  let root = null, events = null, generation = 0;
  const retained = new Map(), requests = new Set();
  function context() { return bridge.context(); }
  function key(c) { return c?.workspace && c?.review?.id ? c.workspace + "/" + c.review.id : ""; }
  function state(c) {
    const id = key(c);
    if (!retained.has(id)) retained.set(id, {items:null, selected:"", loading:false, loadSerial:0, working:false, message:"", error:false});
    return retained.get(id);
  }
  function mark(c = context()) {
    return {workspace:c.workspace, reviewId:c.review?.id, view:c.view, edit:c.edit, generation};
  }
  function valid(m, unchanged = false) {
    const c = context();
    return Boolean(root) && m.generation === generation && c.workspace === m.workspace &&
      host.getWorkspace() === m.workspace && c.view === m.view && c.review?.id === m.reviewId &&
      (!unchanged || (c.edit === m.edit && !c.changed));
  }
  async function api(path, payload, m) {
    const controller = new AbortController(); requests.add(controller);
    try { return await host.api(path, {method:"POST",body:{workspace:m.workspace,...payload},signal:controller.signal}); }
    finally { requests.delete(controller); }
  }
  function selected(c) {
    const s = state(c);
    return (s.items || []).find(item => item.id === s.selected);
  }
  function message(m, text, error = false) {
    if (!valid(m)) return;
    Object.assign(state(context()), {message:text, error}); draw();
  }
  function draw() {
    if (!root) return;
    const c = context();
    if (!c.review || !c.workspace) {
      root.innerHTML = '<h3>Scientific report</h3><p class="ps-help">Save an original study review to add its selected observations and source context to a scientific report.</p>';
      return;
    }
    const s = state(c), product = selected(c), disabled = c.busy || s.working || c.changed;
    root.innerHTML = '<h3>Scientific report</h3>' +
      '<p class="ps-help">Prepare this saved review as a source for the ordered scientific-report composer. It carries the selected original observations, review notes, sampling support and complete source companions.</p>' +
      (c.changed ? '<p class="ps-review-notice">Save the current review changes before preparing or opening its scientific source.</p>' : "") +
      '<div class="ps-actions"><button type="button" data-psr-action="prepare"' + (disabled ? " disabled" : "") +
      '>Prepare saved review source</button><button type="button" data-psr-action="refresh"' +
      (s.loading || s.working ? " disabled" : "") + '>Refresh prepared sources</button></div>' +
      (s.loading ? '<p role="status">Reading retained review sources…</p>' : "") +
      ((s.items || []).length ? '<label>Prepared source edition<select data-psr-source' + (s.working ? " disabled" : "") + '>' +
        s.items.map(item => '<option value="' + esc(item.id) + '"' + (item.id === s.selected ? " selected" : "") + '>' +
          esc((item.title || c.review.content.title) + " · " + (item.created_at || item.id.slice(0,12))) + '</option>').join("") +
        '</select></label>' : (!s.loading ? '<p class="ps-help">No scientific source has been prepared for this saved review.</p>' : "")) +
      (product ? '<p>Original saved review: <code>' + esc(c.review.id) + '</code><br>Prepared source: <code>' +
        esc(product.id) + '</code></p><div class="ps-actions"><button type="button" data-psr-action="open"' +
        (disabled || typeof host.openScientificReport !== "function" ? " disabled" : "") +
        '>Open scientific composer</button></div>' : "") +
      (typeof host.openScientificReport !== "function" ? '<p class="ps-help">The retained source remains available in Sources. Install the current scientific-report composer to open it directly here.</p>' : "") +
      '<p class="ps-status" data-psr-status role="status" aria-live="polite" data-error="' + String(s.error) + '">' + esc(s.message) + '</p>';
  }
  async function load(force = false) {
    const c = context(); if (!root || !key(c)) return;
    const s = state(c); if (s.loading || (!force && s.items !== null)) return;
    const m = mark(c), serial = ++s.loadSerial;
    const active = () => valid(m) && s.loadSerial === serial;
    s.loading = true; draw();
    try {
      const value = await api("/api/published-studies/review-sources", {review_id:m.reviewId}, m);
      if (!active()) return;
      if (value.review_id !== m.reviewId || !Array.isArray(value.sources))
        throw Error("The prepared-source catalogue belongs to another saved review.");
      s.items = copy(value.sources);
      if (!s.items.some(item => item.id === s.selected)) s.selected = s.items[0]?.id || "";
      s.error = false;
    } catch (error) {
      if (active() && error?.name !== "AbortError") {
        s.items ??= []; s.message = error.message || String(error); s.error = true;
      }
    } finally { if (s.loadSerial === serial) s.loading = false; if (active()) draw(); }
  }
  async function prepare() {
    const c = context(), s = state(c);
    if (!c.review || c.changed || c.busy || s.working) return;
    const m = mark(c); s.working = true; s.message = "Binding the saved original review…"; s.error = false; draw();
    try {
      const preview = await api("/api/published-studies/review-source-preview", {review_id:m.reviewId}, m);
      if (!valid(m, true)) return;
      if (!preview.id || preview.review_id !== m.reviewId) throw Error("The source preview belongs to another saved review.");
      const task = await bridge.queue("published-study.review.prepare-source", {review_id:m.reviewId, expected_preview_id:preview.id});
      if (!task) throw Error("Source preparation was not accepted. Read the study task message and retry.");
      if (!valid(m, true)) return;
      s.message = "The source preparation is retained in its ordinary queued task.";
    } catch (error) { if (valid(m) && error?.name !== "AbortError") {s.message=error.message||String(error);s.error=true;} }
    finally { s.working = false; if (valid(m)) draw(); }
  }
  async function open() {
    const c = context(), s = state(c), product = selected(c);
    if (!product || c.changed || c.busy || s.working || typeof host.openScientificReport !== "function") return;
    const m = mark(c), productId = product.id;
    s.working = true; s.error = false; s.message = "Opening the exact retained scientific source…"; draw();
    try {
      const actual = await api("/api/published-studies/review-source", {id:productId}, m);
      if (!valid(m,true) || state(context()).selected !== productId) return;
      if (actual.id !== productId || actual.review_id !== m.reviewId ||
          !actual.source_choice?.source_collection_id || !actual.source_choice?.source_id)
        throw Error("The retained scientific source no longer matches the selected saved review.");
      await host.refresh({force:true});
      if (!valid(m,true) || state(context()).selected !== productId) return;
      await host.openScientificReport({workspace_key:m.workspace,sources:[copy(actual.source_choice)],title:actual.title});
    } catch (error) {
      if (valid(m) && error?.name !== "AbortError") {s.message=error.message||String(error);s.error=true;draw();}
    } finally { s.working=false; if (valid(m)) draw(); }
  }
  function completed(task, entry) {
    if (entry.action !== "published-study.review.prepare-source") return false;
    const result = task.result, reviewId = result?.review_id;
    if (reviewId) {
      const id = entry.workspace + "/" + reviewId, s = retained.get(id);
      if (s) {++s.loadSerial;s.loading=false;s.items=null;s.selected=result.id || "";s.message="The saved review's scientific source is prepared.";s.error=false;}
    }
    const c = context();
    if (root && c.workspace === entry.workspace && host.getWorkspace() === entry.workspace && c.review?.id === reviewId)
      void load(true);
    return true;
  }
  function render(target) {
    if (root !== target) {
      detach(); root = target;
      if (!root) return;
      events = new AbortController();
      root.addEventListener("click", event => {
        const button=event.target.closest("[data-psr-action]"); if(!button||!root.contains(button))return;
        event.preventDefault();
        const action=button.dataset.psrAction;
        if(action==="prepare")void prepare();
        if(action==="open")void open();
        if(action==="refresh")void load(true);
      },{signal:events.signal});
      root.addEventListener("change", event => {
        if(!event.target.matches("[data-psr-source]"))return;
        state(context()).selected=event.target.value;draw();
      },{signal:events.signal});
    }
    draw(); void load();
  }
  function detach() {
    ++generation; events?.abort(); events=null;
    for(const request of requests)request.abort();requests.clear();
    for(const s of retained.values()){++s.loadSerial;s.loading=false;s.working=false;}
    root=null;
  }
  return {render,completed,detach};
}
