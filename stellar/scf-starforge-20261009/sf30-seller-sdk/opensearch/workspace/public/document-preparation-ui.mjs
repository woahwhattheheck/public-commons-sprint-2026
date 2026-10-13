// MIT. Document-source preparation inside the existing Material catalogs workspace.
import {
  openDocumentWorkingRecord, applyDocumentDecision, resetDocumentDecision,
  prepareDocument, documentPreparationFiles,
} from '/document-preparation.mjs';

export function createDocumentPreparationController({ container, host, notice, attempt, usePrepared }) {
  const $ = id => container.querySelector('#' + id);
  let record = null, prepared = null, selected = '', filter = '', offset = 0;
  let opening = false, generation = 0, formDirty = false, unsaved = false;
  const urls = [];
  const pageSize = 30;
  container.innerHTML = [
    '<h3>Prepare a supplier document</h3>',
    '<p class="help">Open retained document observations or a saved preparation record. Review original product cells, prices, quantities and compatibility before creating a catalog edition.</p>',
    '<label>Document observations or complete working record<input id="doc-open" type="file" accept=".json,application/json"></label>',
    '<p id="doc-status" class="summary" role="status">Choose the retained JSON source or a saved working record.</p>',
    '<div id="doc-work" hidden>',
    '<p id="doc-source" class="help"></p>',
    '<div class="actions"><button id="doc-save" type="button">Save complete working record</button><button id="doc-stage" type="button" class="primary">Use prepared source and mapping</button></div>',
    '<p class="help">The prepared source contains the complete observations, decisions and history. Use the existing Save catalog mapping, Retain source file and Build edition controls to continue.</p>',
    '<label>Find a source product<input id="doc-filter" type="search" placeholder="Exact supplier SKU or product text"></label>',
    '<div class="table-wrap"><table><thead><tr><th>Supplier SKU</th><th>Product</th><th>Units and conversion</th><th>Selected price</th><th>Disposition</th></tr></thead><tbody id="doc-products"></tbody></table></div>',
    '<div class="actions"><button id="doc-prev" type="button">Previous products</button><span id="doc-page" class="help"></span><button id="doc-next" type="button">Next products</button></div>',
    '<section id="doc-editor" hidden><h4 id="doc-selected"></h4>',
    '<form id="doc-form"><label class="cat-check"><input id="doc-include" type="checkbox"> Include this product in the prepared catalog</label>',
    '<label>Selected title<input id="doc-title" maxlength="2000"></label><label>Selected description<textarea id="doc-description" rows="3" maxlength="12000"></textarea></label>',
    '<div class="two-column"><label>Base quantity unit<input id="doc-unit" maxlength="100" placeholder="each"></label><label>Sales quantity unit<input id="doc-salesUnit" maxlength="100" placeholder="pack"></label></div>',
    '<div class="two-column"><label>Sales-to-base numerator<input id="doc-numerator" inputmode="decimal" maxlength="100"></label><label>Sales-to-base denominator<input id="doc-denominator" inputmode="decimal" maxlength="100"></label></div>',
    '<p class="help">Keep the published quantity basis or record an explicit operator decision. Clearing all four fields leaves units unresolved; labels alone do not create a conversion.</p>',
    '<div class="two-column"><label>Selected price, original decimal text<input id="doc-priceAmount" inputmode="decimal" maxlength="100"></label><label>Currency<input id="doc-currency" maxlength="20"></label></div>',
    '<label>Price basis<input id="doc-priceBasis" maxlength="2000"></label><label>Supporting source URL<input id="doc-sourceUrl" type="url" maxlength="4000"></label>',
    '<label>Reason for this decision<textarea id="doc-note" rows="3" maxlength="4000"></textarea></label>',
    '<div class="actions"><button id="doc-apply" type="submit">Apply product decision</button><button id="doc-reset" type="button">Restore source proposal</button></div></form>',
    '<details><summary>Complete original product cells and observations</summary><pre id="doc-original"></pre></details>',
    '<details><summary>Original compatibility relationships</summary><pre id="doc-compatibility"></pre></details></section>',
    '<details><summary>Source review notes</summary><div id="doc-review"></div></details>',
    '<h4>Complete preparation files</h4><div id="doc-downloads" class="actions"></div>',
    '</div>',
  ].join('');
  const el = (tag, text) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = String(text); return node; };
  function cleanUrls() { for (const url of urls.splice(0)) URL.revokeObjectURL(url); }
  function fileUrl(file) { const url = URL.createObjectURL(new Blob([file.content], { type: file.type })); urls.push(url); return url; }
  function download(file) {
    const url = URL.createObjectURL(new Blob([file.content], { type: file.type }));
    const a = el('a'); a.href = url; a.download = file.name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  function currentProduct() { return prepared?.products.find(p => p.supplier_sku === selected); }
  function mayReplaceForm() { return !formDirty || window.confirm('Discard the unapplied product fields? Applied decisions remain in the working record.'); }
  function renderEditor() {
    const product = currentProduct(); $('doc-editor').hidden = !product;
    if (!product || formDirty) return;
    $('doc-selected').textContent = product.supplier_sku + ' · original supplier identifier';
    $('doc-include').checked = product.selected.include;
    for (const key of ['title', 'description', 'unit', 'salesUnit', 'numerator', 'denominator', 'priceAmount', 'currency', 'priceBasis', 'note', 'sourceUrl'])
      $('doc-' + key).value = product.selected[key] ?? '';
    $('doc-original').textContent = JSON.stringify(product.source, null, 2);
    $('doc-compatibility').textContent = JSON.stringify(product.compatibility, null, 2);
  }
  function matchingProducts() {
    const q = filter.trim().toLowerCase();
    return prepared?.products.filter(p => !q || [p.supplier_sku, p.selected.title, p.selected.description].join(' ').toLowerCase().includes(q)) ?? [];
  }
  function renderProducts() {
    const products = matchingProducts(); offset = Math.min(offset, Math.max(0, Math.ceil(products.length / pageSize) - 1) * pageSize);
    const body = $('doc-products'); body.replaceChildren();
    for (const product of products.slice(offset, offset + pageSize)) {
      const row = el('tr'), first = el('td'), button = el('button', product.supplier_sku);
      button.type = 'button'; button.dataset.documentSku = product.supplier_sku; first.append(button); row.append(first);
      row.setAttribute('aria-selected', String(selected === product.supplier_sku));
      const s = product.selected;
      row.append(el('td', s.title), el('td', s.unit ? s.salesUnit + ' → ' + s.unit + (s.numerator ? ' · ' + s.numerator + '/' + s.denominator : '') : 'Review units'),
        el('td', s.priceAmount ? s.priceAmount + ' ' + s.currency + ' · ' + s.priceBasis : 'Unpriced'), el('td', s.include ? 'Include' : 'Exclude'));
      body.append(row);
    }
    if (!products.length) { const row = el('tr'), cell = el('td', 'No matching source products.'); cell.colSpan = 5; row.append(cell); body.append(row); }
    $('doc-page').textContent = products.length ? (offset + 1) + '–' + Math.min(offset + pageSize, products.length) + ' of ' + products.length : '0 products';
  }
  function renderDownloads() {
    cleanUrls(); const target = $('doc-downloads'); target.replaceChildren();
    for (const file of documentPreparationFiles(record)) {
      const link = el('a', file.name); link.href = fileUrl(file); link.download = file.name;
      if (file.name === 'Working_Record.json') link.addEventListener('click', () => { unsaved = false; });
      target.append(link);
    }
  }
  function render() {
    $('doc-work').hidden = !record; if (!record) return buttons();
    prepared = prepareDocument(record); const s = prepared.summary, doc = record.source.source_document;
    $('doc-status').textContent = s.sourceProducts + ' source products · ' + s.includedProducts + ' included · ' + s.excludedProducts + ' excluded · ' + s.productsWithConversions + ' quantity conversions · revision ' + s.revision;
    $('doc-source').replaceChildren(el('span', [doc.title || doc.name || doc.id, doc.publisher].filter(Boolean).join(' · ') + ' '));
    if (/^https?:\/\//i.test(doc.url || '')) { const a = el('a', 'Original document'); a.href = doc.url; a.target = '_blank'; a.rel = 'noreferrer'; $('doc-source').append(a); }
    const review = $('doc-review'); review.replaceChildren();
    for (const item of prepared.review) review.append(el('p', [item.scope, item.id, item.note].filter(Boolean).join(' · ')));
    if (!prepared.review.length) review.append(el('p', 'No additional source review notes.'));
    renderProducts(); renderEditor(); renderDownloads(); buttons();
  }
  function buttons() {
    const busy = opening || host.busy || Boolean(host.pending);
    for (const item of container.querySelectorAll('button,input,select,textarea')) item.disabled = busy;
    $('doc-stage').disabled = busy || !record || formDirty;
    $('doc-save').disabled = busy || !record || formDirty;
    $('doc-prev').disabled = busy || offset === 0;
    $('doc-next').disabled = busy || offset + pageSize >= matchingProducts().length;
    $('doc-apply').disabled = busy || !selected || !formDirty;
    $('doc-reset').disabled = busy || !selected || !record?.decisions?.[selected];
  }
  $('doc-open').addEventListener('change', event => attempt(async () => {
    const file = event.target.files?.[0]; if (!file) return;
    if ((unsaved || formDirty) && !window.confirm('Open another document? Save the current complete working record first to keep these preparation decisions.')) { event.target.value = ''; return; }
    if (file.size > 16000000) throw new Error('Choose a document preparation JSON file smaller than 16 MB.');
    const selectedGeneration = ++generation; opening = true; buttons();
    try {
      const raw = await file.text(); if (selectedGeneration !== generation) return;
      const next = openDocumentWorkingRecord(JSON.parse(raw));
      record = next; selected = ''; offset = 0; filter = ''; $('doc-filter').value = ''; formDirty = false; unsaved = false;
      render(); notice('Opened the complete supplier document with its original observations and preparation decisions.');
    } finally { if (selectedGeneration === generation) { opening = false; event.target.value = ''; buttons(); } }
  }));
  $('doc-filter').addEventListener('input', () => { filter = $('doc-filter').value; offset = 0; renderProducts(); buttons(); });
  $('doc-prev').addEventListener('click', () => { offset = Math.max(0, offset - pageSize); renderProducts(); buttons(); });
  $('doc-next').addEventListener('click', () => { offset += pageSize; renderProducts(); buttons(); });
  $('doc-products').addEventListener('click', event => {
    const button = event.target.closest('[data-document-sku]'); if (!button || !mayReplaceForm()) return;
    selected = button.dataset.documentSku; formDirty = false; renderProducts(); renderEditor(); buttons();
  });
  $('doc-form').addEventListener('input', () => { formDirty = true; buttons(); });
  $('doc-form').addEventListener('submit', event => { event.preventDefault(); attempt(() => {
    if (!record || !selected || opening || host.busy || host.pending) throw new Error('Finish the current workspace operation before applying a product decision.');
    const patch = { include: $('doc-include').checked };
    for (const key of ['title', 'description', 'unit', 'salesUnit', 'numerator', 'denominator', 'priceAmount', 'currency', 'priceBasis', 'note', 'sourceUrl'])
      patch[key] = $('doc-' + key).value;
    record = applyDocumentDecision(record, selected, patch); formDirty = false; unsaved = true; render();
    notice('Product decision applied. Save the complete working record or stage this reviewed source for the existing catalog.');
  }); });
  $('doc-reset').addEventListener('click', () => attempt(() => {
    if (!record || !selected || !mayReplaceForm()) return;
    record = resetDocumentDecision(record, selected); formDirty = false; unsaved = true; render();
    notice('The original product proposal is restored; the decision history remains in the working record.');
  }));
  $('doc-save').addEventListener('click', () => attempt(() => {
    if (formDirty) throw new Error('Apply or restore the product fields before saving.');
    download(documentPreparationFiles(record).find(file => file.name === 'Working_Record.json')); unsaved = false;
    notice('Complete supplier document working record saved.');
  }));
  $('doc-stage').addEventListener('click', () => attempt(async () => {
    if (formDirty) throw new Error('Apply the product fields before preparing the source.');
    const result = prepareDocument(record), file = documentPreparationFiles(record).find(value => value.name === 'Prepared_Catalogue.json');
    const doc = record.source.source_document;
    const applied = await usePrepared(new File([file.content], file.name, { type: file.type, lastModified: 0 }), result.mapping,
      { url: doc.url || '', publisher: doc.publisher || '', revision: String(record.revision), kind: 'prepared-supplier-document',
        note: 'Complete original document observations, selected quantities, prices, compatibility and preparation history are retained in this source.' });
    if (applied !== false) {
      download(file); unsaved = false;
      notice('Prepared source and mapping are selected. Keep the downloaded Prepared_Catalogue.json for an exact upload retry. Save the catalog mapping, retain this source file and build the edition through the existing controls.');
    }
  }));
  buttons();
  return { buttons, hasUnsaved: () => unsaved || formDirty };
}
