// MIT. Explicit inspection of the original frozen inbox input.
const byId = id => document.getElementById(id);
const size = value => new Intl.NumberFormat().format(value) + ' bytes';
const fingerprint = operation => operation ? [operation.intentId, operation.configSha256,
  operation.bodySha256, operation.bodyBytes].join(':') : '';
function facts(target, entries) {
  target.replaceChildren();
  for (const [name, value] of entries) {
    const term = document.createElement('dt'), detail = document.createElement('dd');
    term.textContent = name; detail.textContent = value ?? '—'; target.append(term, detail);
  }
}
export function createRequestView({ request, notice }) {
  let selected = null, controls = {}, identity = '', generation = 0, reading = false, downloading = false;
  const inspect = byId('request-inspect'), download = byId('request-download');
  function buttons() {
    inspect.disabled = reading || !controls.canInspectRequest;
    download.disabled = downloading || !controls.canDownloadRequest;
    download.hidden = !selected?.bodyPresent;
    inspect.textContent = reading ? 'Inspecting input…' : 'Inspect retained request';
    download.textContent = downloading ? 'Reading saved bytes…' : 'Download request body';
  }
  function render(operation, nextControls) {
    selected = operation; controls = nextControls;
    const current = fingerprint(operation);
    if (current !== identity) {
      identity = current; generation++; reading = false; downloading = false;
      byId('request-input-view').hidden = true;
      byId('request-input-files').replaceChildren();
      byId('request-input-fields').textContent = '';
    }
    byId('retained-request').hidden = !operation;
    byId('retained-request-note').textContent = operation?.bodyPresent
      ? 'Inspect the fields and files saved with this operation, or download its exact request body.'
      : 'This operation has no request body. Its URL, headers and payment choice remain available for review.';
    buttons();
  }
  inspect.addEventListener('click', async () => {
    if (!selected || reading || !controls.canInspectRequest) return;
    const expected = { ...selected }, current = generation;
    reading = true; buttons();
    try {
      const input = await request('/api/request-input?intent=' + encodeURIComponent(expected.intentId));
      if (current !== generation) return;
      if (input.configSha256 !== expected.configSha256 || input.bodySha256 !== expected.bodySha256 ||
          input.bodyBytes !== expected.bodyBytes) throw new Error('The retained input changed. Refresh this operation.');
      facts(byId('request-input-facts'), [
        ['Body', input.bodyPresent ? size(input.bodyBytes) : 'Absent'],
        ['Content type', input.contentType], ['SHA-256', input.bodySha256],
      ]);
      const files = byId('request-input-files'); files.replaceChildren();
      for (const file of input.files) {
        const card = document.createElement('section'), heading = document.createElement('h4'), details = document.createElement('dl');
        card.className = 'request-file'; heading.textContent = file.filename;
        details.className = 'facts compact';
        facts(details, [['Field', file.field], ['Content type', file.contentType], ['Size', size(file.bytes)], ['SHA-256', file.sha256]]);
        card.append(heading, details); files.append(card);
      }
      const fields = byId('request-input-fields'); fields.hidden = !input.fieldsText;
      fields.textContent = input.fieldsText;
      byId('request-input-truncated').hidden = !input.fieldsTruncated;
      byId('request-input-view').hidden = false;
    } catch (error) { if (current === generation) notice(error.message, true); }
    finally { if (current === generation) { reading = false; buttons(); } }
  });
  download.addEventListener('click', async () => {
    if (!selected || downloading || !controls.canDownloadRequest) return;
    const expected = { ...selected }, current = generation;
    downloading = true; buttons();
    try {
      const response = await request('/api/request-body?intent=' + encodeURIComponent(expected.intentId), { raw: true });
      if (response.headers.get('x-request-body-sha256') !== expected.bodySha256 ||
          response.headers.get('x-request-config-sha256') !== expected.configSha256)
        throw new Error('The retained input changed. Refresh this operation.');
      const bytes = await response.arrayBuffer();
      if (current !== generation) return;
      if (bytes.byteLength !== expected.bodyBytes) throw new Error('The retained input was not completely downloaded.');
      const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
        .map(value => value.toString(16).padStart(2, '0')).join('');
      if (current !== generation) return;
      if (digest !== expected.bodySha256) throw new Error('The downloaded input does not match this operation.');
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
      const link = document.createElement('a'); link.href = url; link.download = 'request-body.bin';
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      notice('The exact retained request body has been downloaded.');
    } catch (error) { if (current === generation) notice(error.message, true); }
    finally { if (current === generation) { downloading = false; buttons(); } }
  });
  return { render };
}
