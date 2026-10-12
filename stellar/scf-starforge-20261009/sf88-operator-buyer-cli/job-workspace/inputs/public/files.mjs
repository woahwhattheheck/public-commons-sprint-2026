// MIT. Original Request file selection, resume and resource-library intake.
const create = (tag, text, className) => {
  const element = document.createElement(tag); if (text !== undefined) element.textContent = text;
  if (className) element.className = className; return element;
};
const size = bytes => bytes < 1048576 ? (bytes / 1024).toFixed(1) + ' KiB' :
  bytes < 1073741824 ? (bytes / 1048576).toFixed(1) + ' MiB' : (bytes / 1073741824).toFixed(2) + ' GiB';
function hashFile(file, signal, onProgress) {
  return new Promise((resolve, reject) => {
    const worker = new Worker('/jobs/request/hash-worker.mjs', { type: 'module' });
    const stop = () => finish(signal.reason ?? new Error('JOB_INPUT_OPERATION_CANCELLED'));
    let finished = false;
    const finish = (error, value) => {
      if (finished) return; finished = true; worker.terminate(); signal.removeEventListener('abort', stop);
      error ? reject(error) : resolve(value);
    };
    worker.onmessage = event => {
      if (event.data?.type === 'progress') onProgress(event.data);
      else if (event.data?.type === 'complete') finish(null, event.data);
      else if (event.data?.type === 'error') finish(new Error(event.data.error));
    };
    worker.onerror = () => finish(new Error('JOB_INPUT_HASH_FAILED'));
    signal.addEventListener('abort', stop, { once: true });
    if (signal.aborted) stop(); else worker.postMessage({ file });
  });
}
export function createInputFilePanel({ element, api, getRequest, onChange, onBusy, onError }) {
  let busy = false, controller = null, progressNode = null, currentId = null, dialog = null, stopButton = null;
  const path = (id, action = '') => '/api/job-intake/requests/' + id + '/files' + (action ? '/' + action : '');
  const showProgress = (phase, value) => {
    if (progressNode) progressNode.textContent = phase + ' · ' + size(value.bytes) + ' of ' + size(value.totalBytes);
  };
  async function run(operation) {
    if (busy) return; busy = true; controller = new AbortController();
    if (stopButton) stopButton.hidden = false;
    onBusy(true);
    try { await operation(controller.signal); }
    catch (error) {
      onError(controller.signal.aborted ? Object.assign(new Error('JOB_INPUT_OPERATION_CANCELLED'),
        { code: 'JOB_INPUT_OPERATION_CANCELLED' }) : error);
    } finally {
      busy = false; controller = null; dialog?.remove(); dialog = null;
      try { await onChange(); } finally { onBusy(false); }
    }
  }
  async function chooseFile(slot, file, contentType, filename) {
    const original = getRequest();
    await run(async signal => {
      const identity = await hashFile(file, signal, value => showProgress('Hashing selected file', value));
      const row = await api('/api/job-intake/requests/' + original.id, { signal });
      const plan = { schema: 'stellar-forge.job-input-upload.v1', origin: row.merchant.origin,
        reference: row.reference, functionId: row.merchant.functionId, slot,
        file: { schema: 'stellar-forge.job-input-file.v1', filename: filename || file.name,
          contentType, bytes: identity.bytes, sha256: identity.sha256,
          policySha256: row.function.inputFiles.policySha256 },
        chunkBytes: identity.chunkBytes, chunks: identity.chunks };
      let status = (await api(path(row.id, 'begin'), { method: 'POST',
        body: { plan, expectedRevision: row.revision }, signal })).upload;
      for (const index of status.missing) {
        signal.throwIfAborted();
        const body = new Uint8Array(await file.slice(index * identity.chunkBytes,
          Math.min(file.size, (index + 1) * identity.chunkBytes)).arrayBuffer());
        status = (await api(path(row.id, status.id + '/chunks/' + index), {
          method: 'PUT', body, signal })).upload;
        showProgress('Saving original bytes', { bytes: status.receivedBytes, totalBytes: file.size });
      }
      showProgress('Verifying saved file', { bytes: file.size, totalBytes: file.size });
      await api(path(row.id, status.id + '/seal'), { method: 'POST', body: {}, signal });
    });
  }
  function chooseLibrary(slot, contentType, filename) {
    dialog?.remove(); dialog = create('dialog'); dialog.className = 'file-library-dialog';
    const header = create('div', undefined, 'section-heading'), close = create('button', 'Close');
    close.type = 'button'; close.onclick = () => { dialog.close(); dialog.remove(); dialog = null; };
    header.append(create('h3', 'Select a verified library file'), close);
    const form = create('form'), query = create('input'), submit = create('button', 'Search');
    query.type = 'search'; query.placeholder = 'Search retained files'; query.setAttribute('aria-label', 'Library search');
    submit.type = 'submit'; form.append(query, submit);
    const results = create('div'), pager = create('div', undefined, 'pager');
    const previous = create('button', 'Previous'), next = create('button', 'Next'), count = create('span');
    previous.type = next.type = 'button'; pager.append(previous, count, next);
    let offset = 0;
    async function load() {
      const data = await api('/api/job-intake/files/library?' + new URLSearchParams({
        q: query.value, offset: String(offset), limit: '20' }));
      results.replaceChildren();
      for (const item of data.items) {
        const button = create('button', undefined, 'library-file-choice'); button.type = 'button';
        button.append(create('strong', item.label || item.filename || item.id.slice(0, 16)),
          create('span', size(item.bytes) + ' · ' + (item.contentType ?? 'application/octet-stream'), 'small'),
          create('span', item.sha256, 'small mono break'));
        button.onclick = () => {
          const original = getRequest();
          dialog.close();
          void run(async signal => {
            showProgress('Receiving verified library file', { bytes: 0, totalBytes: item.bytes });
            const row = await api('/api/job-intake/requests/' + original.id, { signal });
            await api(path(row.id, 'library'), { method: 'POST', signal, body: {
              slot, resourceId: item.id, expectedRevision: row.revision, contentType,
              ...(filename ? { filename } : {}) } });
          });
        };
        results.append(button);
      }
      if (!data.items.length) results.append(create('p', 'No verified files match this search.', 'hint'));
      previous.disabled = offset === 0; next.disabled = offset + 20 >= data.total;
      count.textContent = data.total ? (offset + 1) + '–' + Math.min(offset + 20, data.total) + ' of ' + data.total : '0 files';
    }
    form.onsubmit = event => { event.preventDefault(); offset = 0; load().catch(onError); };
    previous.onclick = () => { offset = Math.max(0, offset - 20); load().catch(onError); };
    next.onclick = () => { offset += 20; load().catch(onError); };
    dialog.append(header, form, results, pager); document.body.append(dialog); dialog.showModal(); load().catch(onError);
  }
  function render(row) {
    if (busy) return;
    currentId = row?.id ?? null; element.replaceChildren(); element.hidden = !row?.inputFiles;
    if (!row?.inputFiles) return;
    const data = row.inputFiles;
    element.append(create('h3', 'Input files'),
      create('p', 'Saved files stay attached to this request. Prepare checkout uploads the verified originals to the merchant.', 'hint'));
    progressNode = create('p', '', 'file-progress');
    progressNode.setAttribute('aria-live', 'polite');
    const stop = create('button', 'Stop file operation'); stop.type = 'button';
    stopButton = stop; stop.hidden = !data.task;
    stop.className = 'file-stop'; stop.onclick = () => {
      controller?.abort(new Error('JOB_INPUT_OPERATION_CANCELLED'));
      void api('/api/job-intake/requests/' + currentId + '/stop', { method: 'POST', body: {} }).catch(onError);
    };
    const progressBar = create('div', undefined, 'file-operation'); progressBar.append(progressNode, stop);
    element.append(progressBar);
    for (const value of data.slots) {
      const section = create('section', undefined, 'input-file-slot');
      section.append(create('h4', value.slot + (value.rule.required ? ' · required' : ' · optional')),
        create('p', [value.rule.description, 'Up to ' + size(value.rule.maxBytes),
          value.rule.mediaTypes.join(', ')].filter(Boolean).join(' · '), 'hint'));
      if (value.file) {
        section.append(create('strong', value.file.filename), create('p',
          size(value.file.bytes) + ' · ' + value.file.contentType + ' · ' +
          (value.upload?.state === 'SEALED' ? 'Saved and verified' :
            value.upload ? size(value.upload.receivedBytes) + ' saved; reselect the same file to resume' :
              data.merchantReceived ? 'Merchant received this original; local copy released' :
                row.phase === 'WITHDRAWN' ? 'Local copy released' : 'Reselect the original file to save its bytes'),
          'small'), create('p', value.file.sha256, 'small mono break'));
      }
      if (data.editable) {
        const controls = create('div', undefined, 'input-file-controls');
        const typeLabel = create('label', 'Media type'), type = create('input');
        type.value = value.file?.contentType ?? value.rule.mediaTypes.find(item => !item.includes('*')) ?? 'application/octet-stream';
        type.spellcheck = false; typeLabel.append(type);
        const nameLabel = create('label', 'Filename (optional)'), name = create('input');
        name.value = value.file?.filename ?? ''; name.maxLength = 240; nameLabel.append(name);
        const fileLabel = create('label', value.file ? 'Reselect or replace file' : 'Select file'), picker = create('input');
        picker.type = 'file'; picker.accept = value.rule.mediaTypes.filter(item => item !== '*/*').join(',');
        picker.onchange = () => {
          if (!picker.files[0]) return;
          if (picker.files[0].size > value.rule.maxBytes) { onError(new Error('JOB_INPUT_FILE_NOT_ALLOWED')); return; }
          void chooseFile(value.slot, picker.files[0], type.value.trim().toLowerCase(), name.value.trim());
        };
        fileLabel.append(picker);
        const library = create('button', 'Select from resource library'); library.type = 'button';
        library.onclick = () => chooseLibrary(value.slot, type.value.trim().toLowerCase(), name.value.trim());
        controls.append(typeLabel, nameLabel, fileLabel, library);
        if (value.file) {
          const remove = create('button', 'Remove file'); remove.type = 'button';
          remove.onclick = () => void run(async signal => {
            const fresh = await api('/api/job-intake/requests/' + row.id, { signal });
            await api(path(row.id, 'remove'), { method: 'POST', signal,
              body: { slot: value.slot, expectedRevision: fresh.revision } });
          });
          controls.append(remove);
        }
        section.append(controls);
      }
      element.append(section);
    }
    if (data.cleanup.uploads) {
      const cleanup = create('button', 'Free ' + size(data.cleanup.bytes) + ' of unused local file storage');
      cleanup.type = 'button'; cleanup.disabled = Boolean(row.task && ['RUNNING', 'CANCELLING'].includes(row.task.state));
      cleanup.onclick = () => void run(async signal => {
        const fresh = await api('/api/job-intake/requests/' + row.id, { signal });
        await api(path(row.id, 'cleanup'), { method: 'POST', signal, body: { expectedRevision: fresh.revision } });
      });
      element.append(cleanup, create('p',
        data.merchantReceived ? 'The merchant retains the sealed originals. Your request, approval and file hashes remain available.' :
          'Cleanup removes replaced files and files from withdrawn requests.', 'hint'));
    }
    element.append(create('p', data.merchantReceived ? 'Verified originals were transferred to the merchant.' :
      data.ready ? 'All required files are saved and ready for checkout.' :
      'Save the required files before preparing checkout.', 'hint'),
      create('p', 'Private file storage: ' + size(data.capacity.reservedBytes) + ' of ' +
        size(data.capacity.maxBytes) + '. Maximum combined request files: ' + size(data.policy.maxTotalBytes) + '.', 'hint'));
  }
  return { render, get busy() { return busy; }, close() { controller?.abort(new Error('JOB_INPUT_OPERATION_CANCELLED')); dialog?.remove(); } };
}
