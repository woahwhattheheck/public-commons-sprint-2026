// MIT. Existing commerce workspace presentation for original retained streams.
const label = value => String(value ?? '—').replaceAll('_', ' ').toLowerCase().replace(/^./, c => c.toUpperCase());
const bytes = value => Number.isSafeInteger(value) ? value.toLocaleString() + ' bytes' : '—';
const time = value => value ? new Date(value).toLocaleTimeString() : '—';

export function createStreamPanel({host, request, action}) {
  host.innerHTML = `
    <div class="stream-heading"><h3>Streamed response</h3><span data-stream="phase" class="badge"></span></div>
    <p data-stream="note" class="help"></p>
    <div class="stream-progress"><strong data-stream="bytes"></strong><span data-stream="records" class="muted"></span></div>
    <meter data-stream="meter" min="0" max="1" value="0" aria-label="Captured bytes against the configured byte limit"></meter>
    <p data-stream="progress-note" class="help"></p>
    <div class="action-row"><button data-stream="interrupt" type="button">Interrupt this buyer</button></div>
    <details><summary>Reviewed capture settings</summary><dl data-stream="settings" class="facts compact"></dl></details>
    <h3>Original payment</h3><dl data-stream="payment" class="facts compact"></dl>
    <div data-stream="partial-choice" class="stream-partial" hidden><label><input data-stream="partial" type="checkbox"> Open the complete records retained from this interrupted capture</label></div>
    <form data-stream="search" class="stream-search"><label>Find in saved records<input data-stream="query" type="search" maxlength="256" placeholder="Event, ID or content"></label><button data-stream="read" type="submit">Open saved records</button></form>
    <div class="action-row"><button data-stream="answer" type="button" hidden>Read answer and citations</button><button data-stream="partial-download" type="button" hidden>Download retained partial bytes</button></div>
    <p data-stream="message" class="help" role="status" aria-live="polite"></p>
    <div data-stream="record-area" hidden><div class="stream-heading"><strong data-stream="page-summary"></strong><div class="action-row"><button data-stream="previous" type="button">Previous</button><button data-stream="next" type="button">Next</button></div></div><div data-stream="rows" class="stream-records"></div></div>
    <section data-stream="answer-area" hidden aria-label="Saved research answer"><h3>Research answer</h3><dl data-stream="answer-facts" class="facts compact"></dl><pre data-stream="answer-text" tabindex="0"></pre><h3>Sources</h3><ol data-stream="citations" class="stream-citations"></ol></section>
  `;
  const find = name => host.querySelector(`[data-stream="${name}"]`);
  const set = (name, value) => { find(name).textContent = value ?? '—'; };
  const facts = (name, rows) => {
    find(name).replaceChildren(...rows.filter(([, value]) => value !== undefined && value !== null).flatMap(([key, value]) => {
      const dt = document.createElement('dt'), dd = document.createElement('dd');
      dt.textContent = key; dd.textContent = String(value); return [dt, dd];
    }));
  };
  let view = null, identity = null, epoch = 0, reader = null, busy = false, pending = false, page = null;
  const reset = () => {
    epoch++; reader?.abort(); reader = null; busy = false; page = null;
    view = null; pending = true; host.hidden = true;
    find('record-area').hidden = true; find('answer-area').hidden = true;
    find('rows').replaceChildren(); find('citations').replaceChildren();
    find('partial').checked = false; set('message', ''); updateControls();
  };
  function updateControls() {
    const stream = view?.stream, partial = stream?.phase === 'PARTIAL';
    const ready = Boolean(stream?.canReadRecords) && (!partial || find('partial').checked) && !busy && !pending;
    find('read').disabled = !ready; find('query').disabled = !ready;
    find('answer').disabled = !ready || !stream?.canReadAnswer;
    find('partial-download').disabled = !ready || !stream?.canDownloadPartial;
    find('partial').disabled = busy || pending;
    find('previous').disabled = !ready || !page || page.offset === 0;
    find('next').disabled = !ready || !page || page.nextOffset === null;
    find('interrupt').hidden = !view?.controls?.canInterrupt;
    find('interrupt').disabled = pending || !view?.controls?.canInterrupt;
  }
  function render(next, options = {}) {
    const nextIdentity = next.operation?.intentId + ':' + (next.stream?.sha256 ?? '');
    if (identity !== nextIdentity) { identity = nextIdentity; reset(); find('query').value = ''; }
    view = next; pending = options.pending === true;
    const stream = next.stream;
    host.hidden = !stream;
    if (!stream) { updateControls(); return; }
    const settings = stream.configuration, capture = settings.responseFile;
    set('phase', label(stream.phase));
    const notes = {
      PREPARED:'The selected format, output location and time limits are part of this reviewed purchase.',
      AWAITING_RESPONSE:'The original buyer is running. Its payment approval appears in the workspace terminal.',
      CAPTURING:'The original buyer is writing the merchant response. The byte count follows its active capture.',
      COMPLETE:'The complete response is retained. Open its records or download the original saved file above.',
      PARTIAL:'The interrupted capture is retained with its original payment record. Open its complete records or download the retained bytes.',
      FAILED:'The original response capture failed. Its recorded cause appears with the purchase outcome.',
      NO_CAPTURE:'The original attempt returned without a saved stream. Inspect its retained purchase outcome.',
      RECOVERY_REQUIRED:'Reopen the original recorded result with Recover recorded result above.',
      CANCELLED:'This queued request was cancelled and remains in the original inbox.',
    };
    set('note', notes[stream.phase] ?? label(stream.phase));
    set('bytes', bytes(stream.bytes));
    set('records', stream.records === null ? 'Record count appears when capture finishes' : `${stream.records.toLocaleString()} complete records`);
    find('meter').max = capture.maxBytes; find('meter').value = Math.min(stream.bytes ?? 0, capture.maxBytes);
    set('progress-note', `Capture limit: ${bytes(capture.maxBytes)}${stream.lastWriteAt ? ' · Last write ' + time(stream.lastWriteAt) : ''}${stream.error ? ' · ' + label(stream.error) : ''}`);
    facts('settings', [['Format', stream.format.toUpperCase()], ['Payment flow', label(settings.paymentFlow)],
      ['HTTP deadline', settings.requestTimeoutMs + ' ms'], ['Capture deadline', capture.timeoutMs + ' ms'],
      ['Response destination', capture.destination], ['Record byte limit', capture.stream.maxRecordBytes],
      ['Record count limit', capture.stream.maxRecords], ['Retained SHA-256', stream.sha256],
      ['Complete record boundary', stream.lastCompleteByte === null ? null : bytes(stream.lastCompleteByte)]]);
    const payment = stream.payment, receipt = payment.receipt;
    facts('payment', [['Native buyer outcome', payment.buyerStatus ?? (stream.phase === 'PREPARED' ? 'Prepared' : 'Awaiting retained result')],
      ['Merchant payment report', payment.settlement ? label(payment.settlement) : undefined],
      ['Merchant settlement receipt', typeof receipt?.success === 'boolean' ? receipt.success ? 'Received' : 'Rejected' : 'Not returned'],
      ['Transaction', receipt?.transaction], ['Network', receipt?.network],
      ['Original reservation', payment.reservation?.outcome], ['Reserved atomic units', payment.reservation?.reserved_atomic_units ?? payment.reservation?.reservedAtomicUnits],
      ['Original transfer observation', payment.transfer ? label(payment.transfer.status) : undefined],
      ['Observed ledger', payment.transfer?.ledger], ['Payment observation', payment.observedAt ? time(payment.observedAt) : undefined],
      ['Observation detail', payment.evidenceError]]);
    find('partial-choice').hidden = stream.phase !== 'PARTIAL';
    find('partial-download').hidden = !stream.canDownloadPartial;
    find('answer').hidden = !stream.canReadAnswer;
    set('read', stream.phase === 'PARTIAL' ? 'Open captured records' : 'Open saved records');
    updateControls();
  }
  function path(endpoint, fields = {}) {
    const query = new URLSearchParams({intent:view.operation.intentId, ...fields});
    if (view.stream.phase === 'PARTIAL' && find('partial').checked) query.set('partial', '1');
    return endpoint + '?' + query;
  }
  async function read(kind, fields = {}) {
    if (busy || pending || !view?.stream?.canReadRecords) return;
    if (view.stream.phase === 'PARTIAL' && !find('partial').checked) return;
    const current = epoch, intent = view.operation.intentId;
    busy = true; reader = new AbortController(); updateControls(); set('message', 'Reading the original retained response…');
    try {
      const raw = kind === 'file';
      const result = await request(path('/api/stream-' + kind, fields), {raw, signal:reader.signal});
      if (current !== epoch || view?.operation?.intentId !== intent) return;
      if (kind === 'records') {
        page = result;
        set('page-summary', result.rows.length ? `${result.offset + 1}–${result.offset + result.rows.length} of ${result.matches.toLocaleString()} matching records` : 'No matching records');
        find('rows').replaceChildren(...result.rows.map(row => {
          const details = document.createElement('details'), summary = document.createElement('summary'), pre = document.createElement('pre');
          summary.textContent = `Record ${row.ordinal}${row.event ? ' · ' + row.event : ''}${row.id ? ' · ID ' + row.id : ''}`;
          pre.textContent = row.text; pre.tabIndex = 0; details.append(summary, pre);
          if (row.truncated) { const hint = document.createElement('p'); hint.className = 'help'; hint.textContent = `Preview shows 8,192 of ${row.characters.toLocaleString()} characters. The original file retains the complete record.`; details.append(hint); }
          return details;
        }));
        find('record-area').hidden = false;
        set('message', `${result.totalRecords.toLocaleString()} original records read and verified${result.partial ? ' from the completed partial prefix' : ''}.`);
      } else if (kind === 'answer') {
        set('answer-text', result.answer);
        facts('answer-facts', [['Original intent', result.intentId], ['Captured records', result.records],
          ['Capture complete', result.captureComplete ? 'Yes' : 'Interrupted'], ['Provider done marker', result.providerDoneMarkerSeen ? 'Received' : 'Not present'],
          ['Sources', result.citationCount], ['Answer characters', result.answerCharacters]]);
        find('citations').replaceChildren(...result.citations.map(source => {
          const li = document.createElement('li'), title = String(source.title ?? source.id ?? 'Source');
          let url;
          try { const parsed = new URL(source.url); if (['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password) url = parsed.href; } catch {}
          const heading = document.createElement(url ? 'a' : 'span'); heading.textContent = title;
          if (url) { heading.href = url; heading.target = '_blank'; heading.rel = 'noopener noreferrer'; }
          li.append(heading);
          const details = document.createElement('details'), summary = document.createElement('summary'), pre = document.createElement('pre');
          summary.textContent = 'Source details'; pre.textContent = JSON.stringify(source, null, 2); details.append(summary, pre); li.append(details);
          return li;
        }));
        find('answer-area').hidden = false;
        set('message', result.answerTruncated || result.citationsTruncated ? 'This view shows the first 262,144 answer characters and 200 sources. The retained file and Node customer reader provide the full result.' : 'Answer and citations reopened from this original purchase.');
      } else {
        const blob = await result.blob();
        if (current !== epoch) return;
        const url = URL.createObjectURL(blob), anchor = document.createElement('a');
        anchor.href = url; anchor.download = view.stream.configuration.responseFile.destination.split(/[\\/]/).pop() + '.partial';
        document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        set('message', 'Retained partial bytes downloaded. Their recorded digest is in Reviewed capture settings.');
      }
    } catch (error) {
      if (current === epoch && error.name !== 'AbortError') set('message', error.message);
    } finally {
      if (current === epoch) { busy = false; reader = null; updateControls(); }
    }
  }
  find('search').addEventListener('submit', event => { event.preventDefault(); void read('records', {offset:'0', query:find('query').value}); });
  find('previous').addEventListener('click', () => { if (page) void read('records', {offset:String(Math.max(0, page.offset - page.limit)), query:page.query}); });
  find('next').addEventListener('click', () => { if (page && page.nextOffset !== null) void read('records', {offset:String(page.nextOffset), query:page.query}); });
  find('partial').addEventListener('change', updateControls);
  find('answer').addEventListener('click', () => { void read('answer'); });
  find('partial-download').addEventListener('click', () => { void read('file'); });
  find('interrupt').addEventListener('click', () => { if (view?.controls?.canInterrupt && !pending) void action('interrupt'); });
  return Object.freeze({render, reset});
}
