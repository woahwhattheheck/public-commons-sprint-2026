(function () {
  "use strict";
  const C = window.SurveyRelease, $ = id => document.getElementById(id);
  const escape = value => String(value == null ? "" : value).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const safeLink = value => /^https?:\/\//i.test(String(value)) ? String(value) : "#";
  let savedCase = null, model = null, visible = [], page = 0, selected = null, comparison = null, pendingSave = 0;
  let saveRevision = 0, unsaved = false, storageKey = "active", saveQueue = Promise.resolve();
  const pageSize = 80;
  function notice(message, error) { $("notice").textContent = message; $("notice").classList.toggle("error", !!error); }
  async function busy(message, fn) { notice(message); await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 20))); try { await fn(); } catch (error) { notice(error.message || String(error), true); } }
  function download(name, content, type) {
    const blob = content instanceof Blob ? content : new Blob([content], {type:type || "application/json"});
    const url = URL.createObjectURL(blob), link = document.createElement("a");
    link.href = url; link.download = name; document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  function db() { return new Promise((resolve, reject) => { const request = indexedDB.open("survey-release-workbench", 1); request.onupgradeneeded = () => request.result.createObjectStore("workspace"); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); }
  async function storeLocal(snapshot, revision, key) {
    const database = await db();
    try {
      await new Promise((resolve,reject) => {
        const tx = database.transaction("workspace", "readwrite");
        tx.objectStore("workspace").put(snapshot, key);
        tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error("Browser storage was not saved."));
      });
      if (revision === saveRevision) {
        unsaved = false;
        $("save-status").textContent = "Saved in this browser";
      }
    } finally { database.close(); }
  }
  function scheduleSave() {
    clearTimeout(pendingSave);
    const revision = ++saveRevision, key = storageKey;
    // Source files and existing events are immutable; retain this exact review revision.
    const snapshot = Object.assign({}, savedCase, {review_events:savedCase.review_events.slice()});
    unsaved = true;
    $("save-status").textContent = "Saving…";
    pendingSave = setTimeout(() => {
      pendingSave = 0;
      // Serial writes prevent a slower older revision from replacing a newer one.
      saveQueue = saveQueue.catch(() => {}).then(() => storeLocal(snapshot, revision, key)).catch(() => {
        if (revision === saveRevision) {
          unsaved = true;
          $("save-status").textContent = "Use Save case to retain changes";
        }
      });
    }, 350);
  }
  async function restoreLocal(key) {
    const database = await db();
    try { return await new Promise((resolve,reject) => { const tx = database.transaction("workspace","readonly"), request = tx.objectStore("workspace").get(key || "active"); request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error); }); } finally { database.close(); }
  }
  function isContinuation(base, candidate) {
    return candidate.case_id === base.case_id &&
      candidate.review_events.length >= base.review_events.length &&
      base.review_events.every((event,index) => event.event_id === candidate.review_events[index].event_id);
  }
  function optionList(id, rows, first, selectedValue) {
    const select = $(id), existing = selectedValue === undefined ? select.value : selectedValue;
    select.innerHTML = '<option value="">' + escape(first) + '</option>' + rows.map(([value,label]) => '<option value="'+escape(value)+'">'+escape(label)+'</option>').join("");
    if ([...select.options].some(o => o.value === String(existing))) select.value = String(existing);
  }
  function loadFilters(defaults) {
    optionList("indicator", [...model.indicators.values()].map(i=>[i.IndicatorID,i.IndicatorName]), "All indicators", defaults ? "18" : "");
    optionList("geotype", [...new Set(model.rows.map(r=>r.geo_type))].sort().map(v=>[v,v]), "All geography types", defaults ? "Citywide" : "");
    updateMeasures(defaults ? "31" : ""); updateGeographies();
    const periods = [...new Set(model.rows.map(r=>r.period_id))].map(id=>model.periods.get(String(id))).sort((a,b)=>b.start_period-a.start_period || b.TimePeriodID-a.TimePeriodID);
    optionList("period", periods.map(p=>[p.TimePeriodID,p.TimePeriod]), "All periods", "");
    $("flag").value=""; $("review-filter").value=""; $("search").value="";
  }
  function updateMeasures(value) {
    const iid=$("indicator").value;
    const measures = [...model.measures.entries()].filter(([key])=>!iid || String(JSON.parse(key)[0])===iid).map(([,m])=>[m.MeasureID,m.MeasureName]);
    optionList("measure",measures,"All measures",value);
  }
  function updateGeographies() {
    const type=$("geotype").value, used=new Map();
    for(const r of model.rows) { if(type && type!==r.geo_type)continue; const d=C.describe(model,r); const key=String(r.geo_id); const name=(d.geography?d.geography.name:r.geo_type+" / "+r.geo_id); if(!used.has(key))used.set(key,name); }
    optionList("geography",[...used].sort((a,b)=>a[1].localeCompare(b[1])),"All geographies","");
    $("geography").disabled=!type;
  }
  function filters() {
    const result={};
    for(const [id,key] of [["indicator","indicator_ids"],["measure","measure_ids"],["geotype","geo_types"],["geography","geo_ids"],["period","period_ids"]])if($(id).value)result[key]=[$(id).value];
    if($("flag").value)result.flag=$("flag").value;
    if($("review-filter").value)result.review=$("review-filter").value;
    if($("search").value.trim())result.search=$("search").value.trim();
    return result;
  }
  function renderOverview() {
    const s=C.summary(model,savedCase);
    $("case-title").textContent=savedCase.manifest.title;
    $("case-subtitle").textContent=s.indicators+" indicators · "+s.measures+" separate measures · source snapshot "+savedCase.manifest.snapshot_at.slice(0,10);
    const metrics=[[s.observations,"Observations"],[s.flags.suppressed||0,"Suppressed"],[s.flags["source-caution"]||0,"Source cautions"],[s.reviewed_observations,"Reviewed"]];
    $("metrics").innerHTML=metrics.map(([n,label])=>'<div class="metric"><strong>'+n.toLocaleString()+'</strong><span>'+escape(label)+'</span></div>').join("");
  }
  function refresh(resetPage) {
    if(resetPage)page=0;
    visible=C.selectedRows(model,savedCase,filters());
    page=Math.min(page,Math.max(0,Math.ceil(visible.length/pageSize)-1));
    const review=C.reviewState(savedCase), start=page*pageSize, chunk=visible.slice(start,start+pageSize);
    $("table-count").textContent=visible.length.toLocaleString()+" matching observations";
    $("rows").innerHTML=chunk.map(r=>{
      const d=C.describe(model,r), decision=review.get(r.id), badges=[];
      if(r.suppressed)badges.push('<span class="badge">Suppressed</span>');
      else if(r.source_note)badges.push('<span class="badge">Source caution</span>');
      if(r.flags.includes("geography-label-unresolved"))badges.push('<span class="badge">Original ID</span>');
      if(decision)badges.push('<span class="badge '+(decision.disposition==="exclude"?"excluded":"")+'">'+escape(decision.disposition==="exclude"?"Excluded":decision.action==="annotate"?"Annotated":"Included")+'</span>');
      return '<tr><td>'+escape(d.measure.MeasureName)+'<span class="minor">'+escape(d.measure.MeasurementType)+'</span></td><td>'+escape(d.geography?d.geography.name:r.geo_type+" / "+r.geo_id)+'<span class="minor">'+escape(r.geo_type+" · "+r.geo_id)+'</span></td><td>'+escape(d.period.TimePeriod)+'</td><td class="numeric">'+escape(r.display_value||"—")+'</td><td>'+escape(r.published_ci||"—")+'</td><td>'+badges.join("")+(decision&&decision.note?'<span class="minor">'+escape(decision.note.slice(0,100))+'</span>':"")+'</td><td><button class="row-review" data-row="'+escape(r.id)+'">Review</button></td></tr>';
    }).join("") || '<tr><td colspan="7">No observations match these filters.</td></tr>';
    $("page-label").textContent=visible.length ? (start+1)+"–"+Math.min(start+pageSize,visible.length)+" of "+visible.length.toLocaleString() : "0 observations";
    $("previous").disabled=page===0; $("next").disabled=start+pageSize>=visible.length;
    renderOverview();
  }
  function activate(next, restored, key) {
    const nextModel=C.buildModel(next,true); C.validateReview(next,nextModel);
    if(savedCase && unsaved && !window.confirm("The current case has changes that have not been saved in this browser. Cancel to keep this case and use Save case, or OK to discard those unsaved changes and open the selected case.")){
      notice("Current case kept. Use Save case to retain a portable copy before switching.");
      return false;
    }
    clearTimeout(pendingSave); pendingSave=0; saveRevision++; unsaved=false; storageKey=key || "active";
    savedCase=next; model=nextModel;
    $("workspace").hidden=false; $("overview").hidden=false; $("empty").hidden=true;
    for(const id of ["save-case","export"])$(id).disabled=false;
    loadFilters(true); refresh(true);
    $("save-status").textContent=restored?"Restored from this browser":"";
    if(!restored)scheduleSave();
    const s=C.summary(model,savedCase);
    notice("Opened "+s.observations.toLocaleString()+" original observations. Source values and notes are retained.");
  }
  function openDetail(id) {
    selected=model.rowMap.get(id);const d=C.describe(model,selected),state=C.reviewState(savedCase).get(id);
    $("detail-title").textContent=d.measure.MeasureName;
    $("detail-subtitle").textContent=(d.geography?d.geography.name:selected.geo_type+" / "+selected.geo_id)+" · "+d.period.TimePeriod;
    $("observation-facts").innerHTML=[["Published value",selected.display_value||"—"],["Confidence interval",selected.published_ci||"Not published"],["Methodology era",selected.era]].map(([label,value])=>'<div class="fact"><span>'+escape(label)+'</span><strong>'+escape(value)+'</strong></div>').join("");
    $("source-note").textContent=selected.source_note||"No caution note is attached to this source observation.";
    $("calculation").textContent=d.measure.how_calculated;
    $("definition-source").textContent=d.measure.Sources+" · "+selected.geo_type+" / "+selected.geo_id+" · Source row "+selected.source_index;
    $("review-action").value=state?state.action:"annotate"; $("review-note").value=state?state.note:""; $("review-result").textContent="";
    $("source-record").textContent=JSON.stringify({path:selected.source_path,source_index:selected.source_index,MeasureID:selected.measure_id,GeoType:selected.geo_type,GeoID:selected.geo_id,TimePeriodID:selected.period_id,Value:selected.raw_value,DisplayValue:selected.display_value,CI:selected.source_ci,Note:selected.source_note},null,2);
    $("review-history").textContent=JSON.stringify(savedCase.review_events.filter(e=>e.row_id===selected.id),null,2);
    const group=model.groups.get(JSON.stringify([selected.indicator_id,selected.measure_id,selected.geo_type,selected.geo_id]))||[];
    const candidates=group.filter(r=>r.id!==selected.id);
    $("comparison-period").innerHTML='<option value="">Select a period</option>'+candidates.map(r=>'<option value="'+escape(r.id)+'">'+escape(model.periods.get(String(r.period_id)).TimePeriod)+'</option>').join("");
    const eligible=candidates.filter(r=>C.compareRows(model,r,selected).comparable);
    if(eligible.length)$("comparison-period").value=eligible[eligible.length-1].id;
    renderPeriodComparison();$("detail").showModal();
  }
  function renderPeriodComparison() {
    const other=model.rowMap.get($("comparison-period").value);
    if(!other){$("comparison-result").textContent="Select another period in this same series.";return;}
    const result=C.compareRows(model,other,selected);
    $("comparison-result").textContent=result.comparable ? result.left_period+" → "+result.right_period+": "+(result.difference>0?"+":"")+result.difference+" ("+result.unit+"). "+result.note : result.reasons.join(" ");
  }
  function exportScope(){return $("export-scope").value==="filtered"?filters():{};}
  function exportSummary(){const rows=C.selectedRows(model,savedCase,exportScope()),review=C.reviewState(savedCase),n=rows.filter(r=>review.get(r.id)?.disposition==="exclude").length;$("export-summary").textContent=(rows.length-n).toLocaleString()+" observations in publication · "+n.toLocaleString()+" exclusions retained in handoff";}
  async function exportDelivery(kind) {
    await busy("Preparing the selected edition…",async()=>{
      $("export-result").textContent="Preparing…";
      const edition=C.release(savedCase,model,exportScope());
      if(kind==="csv")download(edition.edition_id+".csv",edition.csv,"text/csv;charset=utf-8");
      else if(kind==="json")download(edition.edition_id+".json",edition.json);
      else if(kind==="codebook")download(edition.edition_id+"-codebook.csv",edition.codebook,"text/csv;charset=utf-8");
      else {
        const files=[{name:"release.csv",content:edition.csv},{name:"release.json",content:edition.json},{name:"codebook.csv",content:edition.codebook},{name:"edition.json",content:C.canonical(edition.manifest)+"\n"},{name:"source-case.json",content:C.canonical(savedCase)+"\n"},{name:"review-history.json",content:C.canonical(savedCase.review_events)+"\n"}];
        download(edition.edition_id+".zip",C.zipFiles(files),"application/zip");
      }
      $("export-result").textContent="Prepared "+edition.edition_id+" · "+edition.manifest.rows.toLocaleString()+" published observations.";
      notice("Delivery prepared. The complete case and review history can be reopened.");
    });
  }
  $("load-snapshot").onclick=()=>busy("Opening the bundled original NYC source files…",async()=>{
    const r=await fetch("data/source-manifest.json");if(!r.ok)throw Error("Cannot load bundled sources. Start the local server with node cli.cjs serve, or open a saved case.");
    const manifest=await r.json(),texts={},queue=manifest.files.slice();
    await Promise.all(Array.from({length:4},async()=>{while(queue.length){const f=queue.shift(),response=await fetch("data/"+f.path);if(!response.ok)throw Error("Cannot read "+f.path);texts[f.path]=await response.text();}}));
    activate(C.makeCase(manifest,texts));
  });
  $("open-case").onclick=()=>$("case-file").click();
  $("case-file").onchange=()=>{const f=$("case-file").files[0];if(f)busy("Opening and verifying the saved case…",async()=>activate(C.openCase(await f.text())));$("case-file").value="";};
  $("save-case").onclick=()=>{download(savedCase.case_id+".json",C.canonical(savedCase)+"\n");notice("Complete source case prepared for download.");};
  $("indicator").onchange=()=>{updateMeasures("");refresh(true);};
  $("geotype").onchange=()=>{updateGeographies();refresh(true);};
  for(const id of ["measure","geography","period","flag","review-filter"])$(id).onchange=()=>refresh(true);
  let searchTimer; $("search").oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>refresh(true),120);};
  $("reset-filters").onclick=()=>{loadFilters(false);refresh(true);};
  $("previous").onclick=()=>{page--;refresh(false);};$("next").onclick=()=>{page++;refresh(false);};
  $("rows").onclick=event=>{const b=event.target.closest("button[data-row]");if(b)openDetail(b.dataset.row);};
  $("comparison-period").onchange=renderPeriodComparison;
  $("save-review").onclick=()=>{try{C.recordReview(savedCase,model,selected.id,$("review-action").value,$("review-note").value);$("review-result").textContent="Review saved. The original observation is unchanged.";$("review-history").textContent=JSON.stringify(savedCase.review_events.filter(e=>e.row_id===selected.id),null,2);scheduleSave();refresh(false);notice("Review updated and retained in the current case.");}catch(error){$("review-result").textContent=error.message;}};
  $("sources").onclick=()=>{
    $("source-description").textContent=savedCase.manifest.description+" Snapshot "+savedCase.manifest.snapshot_at+".";
    $("method-sources").innerHTML=(savedCase.manifest.methodology_sources||[]).map(s=>'<div class="method-source"><a href="'+escape(safeLink(s.url))+'" target="_blank" rel="noreferrer">'+escape(s.title)+'</a><p>'+escape(s.applies)+'</p></div>').join("");
    $("source-files").innerHTML=savedCase.manifest.files.map(f=>'<tr><td>'+ (f.url?'<a href="'+escape(safeLink(f.url))+'" target="_blank" rel="noreferrer">'+escape(f.upstream_path||f.path)+'</a>':escape(f.path))+'</td><td class="numeric">'+f.bytes.toLocaleString()+'</td><td class="hash">'+escape(f.sha256)+'</td></tr>').join("");
    $("source-dialog").showModal();
  };
  $("export").onclick=()=>{$("export-result").textContent="";exportSummary();$("export-dialog").showModal();};
  $("export-scope").onchange=exportSummary;
  $("download-delivery").onclick=()=>exportDelivery("zip");$("download-csv").onclick=()=>exportDelivery("csv");$("download-json").onclick=()=>exportDelivery("json");$("download-codebook").onclick=()=>exportDelivery("codebook");
  $("compare-case").onclick=()=>$("compare-file").click();
  $("compare-file").onchange=()=>{const file=$("compare-file").files[0];if(file)busy("Comparing saved source editions and reviews…",async()=>{
    const other=C.openCase(await file.text());comparison=C.compareCases(savedCase,other);
    const c=comparison.counts;$("compare-summary").textContent=c.added+" added · "+c.removed+" removed · "+c.changed+" changed observations. The current case remains open.";
    $("compare-rows").innerHTML=comparison.changes.slice(0,150).map(r=>'<tr><td>'+escape(r.row_id)+'</td><td>'+escape(r.kind)+'</td><td>'+escape((r.fields||[]).join(", "))+'</td></tr>').join("")||'<tr><td colspan="3">No source or review differences.</td></tr>';
    $("compare-dialog").showModal();notice("Case comparison complete.");
  });$("compare-file").value="";};
  $("download-comparison").onclick=()=>download("case-comparison.json",C.canonical(comparison)+"\n");
  window.addEventListener("beforeunload",event=>{if(unsaved){event.preventDefault();event.returnValue="";}});
  busy("Opening workspace…",async()=>{
    const embedded=$("embedded-case");
    if(embedded){
      const base=C.openCase(embedded.textContent), tail=base.review_events.at(-1)?.event_id || base.case_id;
      const key="embedded:"+base.case_id+":"+tail;
      for(const candidateKey of [key,"active"]){
        try{
          const previous=await restoreLocal(candidateKey);
          if(previous){
            const candidate=C.openCase(previous);
            if(isContinuation(base,candidate)){
              activate(candidate,true,key);
              if(candidateKey!==key)scheduleSave();
              return;
            }
          }
        }catch(_){}
      }
      activate(base,false,key);
      return;
    }
    try{const previous=await restoreLocal();if(previous){activate(C.openCase(previous),true);return;}}catch(_){}
    notice("Open the bundled NYC source or a saved case to begin.");
  });
})();
