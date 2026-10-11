// Original seller client generation, reviewed legacy adoption and retained delivery.
const $ = selector => document.querySelector(selector);
const node = (tag, text) => { const result = document.createElement(tag); if (text !== undefined) result.textContent = text; return result; };
const validId = value => /^[a-z0-9][a-z0-9_-]{0,63}$/.test(value);
const size = bytes => new Intl.NumberFormat().format(bytes) + ' bytes';
const sha256 = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
  .map(value => value.toString(16).padStart(2, '0')).join('');
function field(list, label, value) {
  if (value !== undefined && value !== null) list.append(node('dt', label), node('dd', String(value)));
}
function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob), link = node('a');
  link.href = url; link.download = filename; link.hidden = true; document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function bindClientControls({ request, getSnapshot, isBusy, setBusy }) {
  let listing, reviewed, after, nextAfter, downloading, sequence = 0;
  const message = (text = '', error = false) => {
    $('#client-notice').textContent = text; $('#client-notice').classList.toggle('error', error);
  };
  const exportId = () => $('#client-export-id').value.trim();
  function buttons(blocked = isBusy()) {
    const valid = validId(exportId()), complete = reviewed?.state === 'COMPLETE';
    $('#client-refresh').disabled = blocked;
    $('#client-export-id').disabled = blocked;
    $('#client-generate').disabled = blocked || !valid || !getSnapshot()?.console.managesRunningSeller;
    $('#client-inspect').disabled = blocked || !valid;
    $('#client-first').disabled = blocked || after === undefined;
    $('#client-next').disabled = blocked || !nextAfter;
    $('#client-adopt').disabled = blocked || reviewed?.state !== 'LEGACY_FILES_RETAINED';
    $('#client-adopt').hidden = reviewed?.state !== 'LEGACY_FILES_RETAINED';
    $('#client-package').disabled = blocked || !complete || Boolean(downloading);
    $('#client-download-stop').disabled = !downloading;
    $('#client-download-stop').hidden = !downloading;
    for (const button of document.querySelectorAll('[data-client-export]')) button.disabled = blocked;
    for (const button of document.querySelectorAll('[data-client-file]')) button.disabled = blocked || !complete || Boolean(downloading);
  }
  function owner() {
    const current = listing?.ownedSeller;
    $('#client-owner').textContent = current
      ? 'This console owns ' + current.releaseId + ' · ' + current.mode + '. New clients retain this running release and instance.'
      : 'Start a seller in this console to generate a new client. Existing retained clients remain available below.';
  }
  async function refresh() {
    listing = await request('/api/clients' + (after ? '?after=' + encodeURIComponent(after) : ''));
    nextAfter = listing.nextAfter; owner();
    const body = $('#client-list'); body.replaceChildren();
    for (const entry of listing.entries) {
      const row = node('tr'), identity = node('td'), origin = node('td'), completion = node('td'), files = node('td'), action = node('td');
      identity.append(node('strong', entry.exportId));
      if (entry.provenance?.releaseId) identity.append(node('div', 'Release ' + entry.provenance.releaseId));
      origin.append(node('div', entry.origin ?? 'Inspect retained source'), node('div', entry.mode ?? ''));
      completion.append(node('div', entry.state === 'COMPLETION_RETAINED' ? 'Completion receipt retained'
        : entry.state === 'LEGACY_OR_INCOMPLETE' ? 'Review retained files' : 'Needs attention'));
      if (entry.completedAt) completion.append(node('div', new Date(entry.completedAt).toLocaleString()));
      if (entry.error) completion.append(node('div', entry.error));
      files.textContent = entry.bytes === undefined ? 'Inspect files' : entry.files + ' payloads · ' + size(entry.bytes);
      const button = node('button', 'Inspect'); button.dataset.clientExport = entry.exportId;
      button.addEventListener('click', () => inspect(entry.exportId)); action.append(button);
      row.append(identity, origin, completion, files, action); body.append(row);
    }
    if (!listing.entries.length) { const row = node('tr'), cell = node('td', after ? 'No more retained customer exports.' : 'No customer clients have been retained in this directory.'); cell.colSpan = 5; row.append(cell); body.append(row); }
    buttons();
  }
  function renderOffers(snapshot) {
    const container = $('#client-offers'); container.replaceChildren();
    for (const operation of snapshot?.operations ?? []) {
      const section = node('section'); section.className = 'client-operation';
      section.append(node('h4', operation.method + ' ' + operation.path + ' · ' + operation.id));
      const wrapper = node('div'); wrapper.className = 'table-scroll'; const table = node('table'), head = node('thead'), row = node('tr'), body = node('tbody');
      for (const heading of ['Option', 'Atomic amount', 'Network / asset', 'Recipient', 'Scheme / timeout / metadata']) row.append(node('th', heading));
      head.append(row); table.append(head, body); wrapper.append(table);
      operation.offer.accepts.forEach((option, index) => {
        const row = node('tr'), rail = node('td'), details = node('td');
        rail.append(node('div', option.network), node('code', option.asset));
        details.append(node('div', option.scheme + ' · ' + option.maxTimeoutSeconds + ' seconds'));
        if (option.extra) details.append(node('pre', JSON.stringify(option.extra, null, 2)));
        row.append(node('td', String(index)), node('td', option.amount), rail, node('td', option.payTo), details); body.append(row);
      });
      const original = node('details'); original.append(node('summary', 'Original request and payment metadata'), node('pre', JSON.stringify(operation, null, 2)));
      section.append(wrapper, original); container.append(section);
    }
  }
  function renderReview(value) {
    reviewed = value; $('#client-review').hidden = !value;
    if (!value) { buttons(); return; }
    $('#client-review-title').textContent = value.exportId + ' · ' + value.state.replaceAll('_', ' ');
    const identity = $('#client-identity'); identity.replaceChildren();
    field(identity, 'Saved seller origin', value.origin); field(identity, 'Saved runtime mode', value.mode);
    field(identity, 'Original OpenAPI SHA-256', value.sourceSha256); field(identity, 'Complete files SHA-256', value.filesSha256);
    field(identity, 'Completion receipt SHA-256', value.manifestFile?.sha256);
    field(identity, 'Completion recorded', value.manifest?.completedAt); field(identity, 'Completion kind', value.manifest?.completion);
    field(identity, 'Original release', value.manifest?.provenance?.releaseId);
    field(identity, 'Release digest', value.manifest?.provenance?.releaseDigest);
    field(identity, 'Original instance', value.manifest?.provenance?.instanceId);
    $('#client-review-description').textContent = value.state === 'COMPLETE'
      ? 'All five original payloads match the saved completion receipt. The download retains these exact files and receipt. Saved runtime mode describes the export; the original buyer still reviews current offers and authorizes any purchase.'
      : value.state === 'LEGACY_FILES_RETAINED'
        ? 'All five original files are retained and the client names this exact OpenAPI source. Review every option, then adopt these bytes to record their completion today. Their original payloads stay unchanged.'
        : value.state === 'INCOMPLETE'
          ? 'This interrupted handover is missing: ' + value.missingFiles.join(', ') + '. Keep its retained files for recovery. Use a new export ID for a fresh generation.'
          : 'This export ID has no retained customer directory.';
    renderOffers(value.snapshot);
    const body = $('#client-files'); body.replaceChildren();
    for (const file of [...(value.files ?? []), ...(value.manifestFile ? [value.manifestFile] : [])]) {
      const row = node('tr'), hash = node('td'), action = node('td'); hash.append(node('code', file.sha256));
      const button = node('button', 'Download file'); button.dataset.clientFile = file.name;
      button.addEventListener('click', () => download(file)); action.append(button);
      row.append(node('td', file.name), node('td', size(file.bytes)), hash, action); body.append(row);
    }
    buttons();
  }
  async function inspect(id = exportId()) {
    if (isBusy() || !validId(id)) return;
    $('#client-export-id').value = id; const current = ++sequence;
    renderReview(null); setBusy(true); message('Inspecting the original retained files…');
    try {
      const result = await request('/api/clients/inspect?exportId=' + encodeURIComponent(id));
      if (current === sequence) { renderReview(result); message(); }
    } catch (error) { if (current === sequence) message(error.message, true); }
    finally { setBusy(false); }
  }
  async function generate() {
    if (isBusy() || !validId(exportId())) return;
    const id = exportId(), instanceId = getSnapshot()?.console.instanceId; if (!instanceId) return;
    setBusy(true); message('Generating the original customer SDK from the running seller…');
    try {
      renderReview(await request('/api/clients/generate', { id, instanceId })); await refresh();
      message('Customer client completed. Review its exact saved terms and download the handover.');
    } catch (error) { message(error.message + ' Use Inspect retained client to recover a completed or interrupted request.', true); }
    finally { setBusy(false); }
  }
  async function adopt() {
    if (isBusy() || reviewed?.state !== 'LEGACY_FILES_RETAINED') return;
    const original = reviewed; setBusy(true); message('Retaining the reviewed original file identities…');
    try {
      renderReview(await request('/api/clients/adopt', { exportId: original.exportId, expectedFilesSha256: original.filesSha256 }));
      await refresh(); message('Completion receipt retained. The five original customer files are unchanged.');
    } catch (error) { renderReview(null); message(error.message, true); }
    finally { setBusy(false); }
  }
  async function download(file) {
    if (isBusy() || downloading || reviewed?.state !== 'COMPLETE') return;
    const original = reviewed, controller = new AbortController(); downloading = controller; buttons();
    const filename = file?.name ?? original.exportId + '-client.tar.gz';
    const query = new URLSearchParams({ exportId: original.exportId, expectedManifestSha256: original.manifestFile.sha256,
      ...(file ? { file: file.name, expectedSha256: file.sha256 } : {}) });
    $('#client-download-progress').textContent = 'Downloading ' + filename + '…';
    try {
      const response = await request('/api/clients/download?' + query, undefined, { raw: true, signal: controller.signal });
      if (response.headers.get('x-client-manifest-sha256') !== original.manifestFile.sha256)
        throw new Error('The download does not match the reviewed completion receipt.');
      const parts = [], reader = response.body.getReader(); let received = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read(); if (done) break;
          received += value.length;
          if (received > 136 * 1024 * 1024) { controller.abort(); throw new Error('The customer download exceeds its supported size.'); }
          parts.push(value); $('#client-download-progress').textContent = 'Downloading ' + filename + ' · ' + size(received);
        }
      } finally { reader.releaseLock(); }
      const blob = new Blob(parts, { type: response.headers.get('content-type') ?? 'application/octet-stream' });
      if (file && (received !== file.bytes || await sha256(await blob.arrayBuffer()) !== file.sha256))
        throw new Error('The received original file differs from its reviewed SHA-256.');
      saveBlob(blob, filename);
      $('#client-download-progress').textContent = 'Saved ' + filename + ' · ' + size(received) + '. Original completion ' + original.manifestFile.sha256 + '.';
    } catch (error) {
      $('#client-download-progress').textContent = controller.signal.aborted
        ? 'Download stopped. The retained customer export remains available for another download.' : error.message;
    } finally { downloading = null; buttons(); }
  }
  $('#client-export-id').addEventListener('input', () => { sequence++; renderReview(null); message(); });
  $('#client-inspect').addEventListener('click', () => inspect()); $('#client-generate').addEventListener('click', generate);
  $('#client-adopt').addEventListener('click', adopt); $('#client-package').addEventListener('click', () => download());
  $('#client-download-stop').addEventListener('click', () => downloading?.abort());
  const page = async next => {
    if (isBusy()) return; after = next; setBusy(true);
    try { await refresh(); message(); } catch (error) { message(error.message, true); } finally { setBusy(false); }
  };
  $('#client-refresh').addEventListener('click', () => page(after));
  $('#client-first').addEventListener('click', () => page(undefined)); $('#client-next').addEventListener('click', () => page(nextAfter));
  return { refresh, buttons };
}
