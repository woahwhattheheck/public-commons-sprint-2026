/* Local operator annotations for one immutable OrchardCue report. */
(() => {
  'use strict';
  const el = id => document.getElementById(id);
  const LABELS = {unreviewed:'Unreviewed', fruit_like:'Visually fruit-like',
    not_fruit_like:'Not visually fruit-like', uncertain:'Uncertain'};
  const PAGE_SIZE = 25;
  let source, report, rows, reviewer = '', page = 1, busy = false, storageAvailable = true;
  const node = (tag, text, className) => {
    const result = document.createElement(tag);
    if (text !== undefined) result.textContent = text;
    if (className) result.className = className;
    return result;
  };
  const showError = message => {
    el('reviewError').textContent = message || '';
    el('reviewError').hidden = !message;
  };
  try {
    source = JSON.parse(el('reviewSource').textContent);
    report = source.report;
    if (!/^[a-f0-9]{64}$/.test(source.report_sha256) || report.schema !== 'orchardcue-review/1' ||
        !Array.isArray(report.red_candidates) || report.candidate_count !== report.red_candidates.length)
      throw Error('This page does not contain a supported source report.');
  } catch (failure) {
    showError(failure.message || 'The source report could not be read.');
    el('reviewExport').disabled = true; el('reviewImport').disabled = true;
    return;
  }
  const storageKey = 'orchardcue-labels/v1/' + source.report_sha256;
  rows = report.red_candidates.map((_, index) => ({candidate_id:index + 1, label:'unreviewed', note:''}));
  function annotation() {
    return {schema:'orchardcue-operator-review/1', report_sha256:source.report_sha256,
      input_sha256:report.input_sha256, engine:report.engine, reviewer, candidates:rows.map(row => ({...row}))};
  }
  function validateAnnotation(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        value.schema !== 'orchardcue-operator-review/1' ||
        value.report_sha256 !== source.report_sha256 || value.input_sha256 !== report.input_sha256 ||
        value.engine !== report.engine)
      throw Error('This label file belongs to a different report or uses an unsupported format.');
    if (typeof value.reviewer !== 'string' || value.reviewer.length > 120 ||
        !Array.isArray(value.candidates) || value.candidates.length !== rows.length)
      throw Error('The label file must include each source candidate exactly once and a bounded reviewer name.');
    const accepted = new Map();
    for (const row of value.candidates) {
      if (!row || typeof row !== 'object' || Array.isArray(row) ||
          !Number.isInteger(row.candidate_id) || row.candidate_id < 1 || row.candidate_id > rows.length ||
          accepted.has(row.candidate_id) || !Object.hasOwn(LABELS, row.label) ||
          typeof row.note !== 'string' || row.note.length > 500)
        throw Error('A candidate label is missing, duplicated or invalid. No current labels were replaced.');
      accepted.set(row.candidate_id, {candidate_id:row.candidate_id, label:row.label, note:row.note});
    }
    return {reviewer:value.reviewer, candidates:[...accepted.values()].sort((a,b) => a.candidate_id - b.candidate_id)};
  }
  function save(message) {
    try { localStorage.setItem(storageKey, JSON.stringify(annotation())); }
    catch { storageAvailable = false; }
    el('reviewStatus').textContent = (message ? message + ' ' : '') + (storageAvailable
      ? 'Labels are saved in this browser for this exact report. Download JSON to keep a portable copy.'
      : 'Labels are kept in this open page only. Download JSON before closing it.');
    renderSummary();
  }
  function renderSummary() {
    const counts = Object.fromEntries(Object.keys(LABELS).map(label => [label,0]));
    for (const row of rows) counts[row.label]++;
    el('reviewSummary').textContent = `${rows.length - counts.unreviewed} of ${rows.length} candidates reviewed · ` +
      `${counts.fruit_like} fruit-like · ${counts.not_fruit_like} not fruit-like · ${counts.uncertain} uncertain · ${counts.unreviewed} unreviewed. These are operator labels.`;
  }
  function filteredRows() {
    const filter = el('reviewFilter').value;
    return rows.filter(row => filter === 'all' || (filter === 'reviewed'
      ? row.label !== 'unreviewed' : row.label === filter));
  }
  function candidateCrop(candidate, id) {
    const [width, height] = report.image_dimensions_px;
    const [x,y,w,h] = candidate.bbox;
    const left = Math.max(0, x - w * .15), top = Math.max(0, y - h * .15);
    const right = Math.min(width, x + w * 1.15), bottom = Math.min(height, y + h * 1.15);
    const namespace = 'http://www.w3.org/2000/svg';
    const crop = document.createElementNS(namespace, 'svg');
    crop.setAttribute('class', 'candidate-crop');
    crop.setAttribute('viewBox', `${left} ${top} ${right-left} ${bottom-top}`);
    crop.setAttribute('role', 'img'); crop.setAttribute('aria-labelledby', 'crop-title-' + id);
    const title = document.createElementNS(namespace, 'title'); title.id = 'crop-title-' + id;
    title.textContent = 'Candidate ' + id + ': source bounding-box view of the unchanged annotated capture';
    const image = document.createElementNS(namespace, 'image');
    image.setAttribute('href', 'overlay.png'); image.setAttribute('width', width); image.setAttribute('height', height);
    crop.append(title, image); return crop;
  }
  function renderCards(focusId) {
    const selected = filteredRows(), pages = Math.max(1, Math.ceil(selected.length/PAGE_SIZE));
    page = Math.min(page, pages);
    const visible = selected.slice((page-1)*PAGE_SIZE, page*PAGE_SIZE);
    const list = el('candidateList'); list.replaceChildren();
    el('reviewPage').textContent = selected.length
      ? `Page ${page} of ${pages} · ${(page-1)*PAGE_SIZE+1}–${Math.min(page*PAGE_SIZE,selected.length)} of ${selected.length} matching candidates`
      : 'No matching candidates';
    el('reviewPrevious').disabled = busy || page === 1;
    el('reviewNext').disabled = busy || page === pages;
    if (!visible.length) {
      list.append(node('p', rows.length ? 'No candidates match this label filter.'
        : 'The source report contains no red candidates. Labels cannot describe missed objects; retain the source review or retake guidance.', 'empty-state'));
      return;
    }
    for (const row of visible) {
      const candidate = report.red_candidates[row.candidate_id-1];
      const card = node('article', undefined, 'candidate-card'); card.dataset.label = row.label;
      card.append(node('h3', 'Candidate ' + row.candidate_id, 'candidate-heading'), candidateCrop(candidate,row.candidate_id));
      const geometry = node('p', `Center: ${candidate.center_px.join(', ')} px · Box: ${candidate.bbox.join(', ')} px · Equivalent diameter: ${candidate.diameter_equivalent_px} px. ` +
        (Number.isFinite(candidate.approx_diameter_mm) ? `Source approximate diameter: ${candidate.approx_diameter_mm} mm; coplanar marker assumption applies.` : 'No dimensional estimate in the source.'), 'candidate-geometry');
      card.append(geometry);
      const fields = node('div', undefined, 'candidate-fields');
      const label = node('label', 'Your visual label'); label.htmlFor = 'candidate-label-' + row.candidate_id;
      const select = document.createElement('select'); select.id = label.htmlFor; select.dataset.reviewEdit = '';
      for (const [value, text] of Object.entries(LABELS)) select.add(new Option(text, value));
      select.value = row.label; select.disabled = busy;
      select.addEventListener('change', () => {
        row.label = select.value; showError(); save();
        const remaining = filteredRows();
        const focus = remaining.find(item => item.candidate_id >= row.candidate_id)?.candidate_id ?? remaining.at(-1)?.candidate_id;
        renderCards(focus);
      });
      const noteLabel = node('label', 'Candidate note (optional)'); noteLabel.htmlFor = 'candidate-note-' + row.candidate_id;
      const note = document.createElement('textarea'); note.id = noteLabel.htmlFor;
      note.maxLength = 500; note.rows = 3; note.value = row.note; note.disabled = busy; note.dataset.reviewEdit = '';
      note.addEventListener('input', () => { row.note = note.value; showError(); save(); });
      label.append(select);noteLabel.append(note);
      fields.append(label,noteLabel);card.append(fields);list.append(card);
    }
    if (focusId) (el('candidate-label-' + focusId) || list.querySelector('select'))?.focus({preventScroll:true});
  }
  function syncControls() {
    el('reviewImport').disabled = busy; el('reviewExport').disabled = busy;
    el('reviewReviewer').disabled = busy; el('reviewFilter').disabled = busy;
    for (const field of document.querySelectorAll('[data-review-edit]')) field.disabled = busy;
    el('reviewPrevious').disabled = busy || page === 1;
    el('reviewNext').disabled = busy || page >= Math.max(1,Math.ceil(filteredRows().length/PAGE_SIZE));
  }
  el('reviewReviewer').addEventListener('input', () => { reviewer = el('reviewReviewer').value; showError(); save(); });
  el('reviewFilter').addEventListener('change', () => { page = 1; renderCards(); });
  el('reviewPrevious').addEventListener('click', () => { if (!busy && page > 1) { page--;renderCards(); } });
  el('reviewNext').addEventListener('click', () => { if (!busy && page < Math.ceil(filteredRows().length/PAGE_SIZE)) { page++;renderCards(); } });
  el('reviewExport').addEventListener('click', () => {
    if (busy) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(annotation(),null,2)+'\n'], {type:'application/json'}));
    const link = node('a');link.href = url;
    link.download = 'orchardcue-labels-' + source.report_sha256.slice(0,16) + '.json';
    document.body.append(link);link.click();link.remove();setTimeout(() => URL.revokeObjectURL(url),1000);
    el('reviewStatus').textContent = 'Label JSON prepared for download. Keep it with this report and overlay; it does not change the detector output.';
  });
  el('reviewImport').addEventListener('change', async () => {
    const file = el('reviewImport').files[0]; if (!file || busy) return;
    busy = true; syncControls(); showError();
    el('reviewStatus').textContent = 'Reading label JSON for this exact report…';
    try {
      if (file.size > 2*1024*1024) throw Error('Label JSON exceeds the 2 MiB limit.');
      const candidate = validateAnnotation(JSON.parse(await file.text()));
      rows = candidate.candidates; reviewer = candidate.reviewer; el('reviewReviewer').value = reviewer;
      page = 1; save('Matching labels imported.'); renderCards();
    } catch (failure) {
      showError(failure.message || 'Label JSON could not be read.');
      el('reviewStatus').textContent = 'Import was not applied. Your current labels are unchanged.';
    } finally { busy = false;el('reviewImport').value = '';syncControls(); }
  });
  try {
    const retained = localStorage.getItem(storageKey);
    if (retained) {
      if (retained.length > 2*1024*1024) throw Error('Stored labels exceed the size limit.');
      const saved = validateAnnotation(JSON.parse(retained)); rows = saved.candidates; reviewer = saved.reviewer;
      el('reviewStatus').textContent = 'Restored this browser’s labels for the exact source report. Download JSON to keep a portable copy.';
    } else el('reviewStatus').textContent = 'Every candidate starts unreviewed. Labels are separate from the original detector report.';
  } catch {
    storageAvailable = false;
    el('reviewStatus').textContent = 'Saved browser labels could not be restored. No labels were inferred; import a matching download or begin your review.';
  }
  el('reviewReviewer').value = reviewer;
  renderSummary();renderCards();syncControls();
})();
