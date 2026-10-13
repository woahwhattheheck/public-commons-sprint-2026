// MIT. One resumable original-source capture, committed into the native workspace.
import { randomUUID } from 'node:crypto';
import { failure, revision, selection, timestamp, sha256 } from './core.mjs';
export const OFFICIAL_FEEDS = {
  'open-tenders': 'https://canadabuys.canada.ca/opendata/pub/openTenderNotice-ouvertAvisAppelOffres.csv',
  'new-tenders': 'https://canadabuys.canada.ca/opendata/pub/newTenderNotice-nouvelAvisAppelOffres.csv',
  'complete-tenders': 'https://canadabuys.canada.ca/opendata/pub/tenderNoticeComplete-avisAppelOffresComplet.csv',
  'awards': 'https://canadabuys.canada.ca/opendata/pub/awardNoticeComplete-avisAttributionComplet.csv',
  'supply-arrangements': 'https://sosa.canadabuys.canada.ca/cds/opendata/tpsgc-pwgsc_ocama-sosa.csv'
};
const hosts = new Set(['canadabuys.canada.ca', 'sosa.canadabuys.canada.ca', 'donnees-data.tpsgc-pwgsc.gc.ca']);
function officialURL(value) {
  let url;
  try { url = new URL(value); } catch { throw failure('CAPTURE_URL_INVALID', 'Select an official CanadaBuys CSV URL'); }
  if (url.protocol !== 'https:' || !hosts.has(url.hostname) || url.username || url.password || url.hash || url.port ||
      !url.pathname.toLowerCase().endsWith('.csv'))
    throw failure('CAPTURE_URL_REJECTED', 'Capture an official HTTPS CanadaBuys CSV resource');
  return url.href;
}
const active = new WeakMap();
export async function captureCanadaBuys(workspace, spec = {}, { fetch: fetcher = globalThis.fetch, signal, timeoutMs = 180000, maxBytes = 256 * 1024 * 1024 } = {}) {
  if (typeof fetcher !== 'function') throw failure('FETCH_REQUIRED', 'This runtime needs a fetch implementation');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 1800000 || !Number.isSafeInteger(maxBytes) || maxBytes < 1)
    throw failure('CAPTURE_OPTIONS_INVALID', 'Select a positive capture capacity and a timeout between one second and thirty minutes');
  let current, prior;
  if (spec.captureId) {
    prior = workspace.getCapture(spec.captureId);
    revision(spec.expectedRevision, workspace.metadata().revision);
    if (prior.status === 'complete') return { capture: prior, workspace: workspace.metadata(), alreadyComplete: true };
    if (prior.status === 'downloading' && Date.parse(prior.leaseUntil || '') > Date.now())
      throw failure('CAPTURE_ACTIVE', 'The original capture is still running', 409, { captureId: prior.id, leaseUntil: prior.leaseUntil });
    if (prior.canResume === false && prior.status !== 'downloading') throw failure('CAPTURE_NOT_RESUMABLE', 'Inspect the saved source error before starting a different capture', 409, { captureId: prior.id });
    if (prior.retryAt && Date.parse(prior.retryAt) > Date.now()) throw failure('CAPTURE_COOLDOWN', 'The source requested a later retry', 429, { captureId: prior.id, retryAt: prior.retryAt });
    current = { ...prior, stream: selection(prior.stream), url: officialURL(prior.url), attempts: prior.attempts + 1 };
  } else {
    const stream = selection(spec.stream), url = officialURL(spec.url || OFFICIAL_FEEDS[stream]);
    current = { id: 'capture-' + randomUUID(), stream, url, label: spec.label || stream,
      createdAt: new Date().toISOString(), attempts: 1 };
  }
  const executing = active.get(workspace) || new Set(); active.set(workspace, executing);
  if (executing.has(current.id)) throw failure('CAPTURE_ACTIVE', 'The original capture is still running', 409, { captureId: current.id });
  executing.add(current.id);
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(failure('CAPTURE_TIMEOUT', 'Capture deadline elapsed', 408)), timeoutMs);
  const abort = () => controller.abort(signal.reason || failure('CAPTURE_INTERRUPTED', 'Capture was interrupted', 499));
  if (signal) { if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true }); }
  let bytes, responseMeta, started = false;
  try {
    const start = workspace.saveCapture({ ...current, status: 'downloading', canResume: false, error: null,
      leaseUntil: new Date(Date.now() + timeoutMs + 5000).toISOString() }, spec.expectedRevision, prior ? prior.revision : null);
    current = start.capture; started = true;
    let url = current.url, response;
    for (let redirects = 0; redirects <= 5; redirects++) {
      response = await fetcher(url, { method: 'GET', redirect: 'manual', signal: controller.signal,
        headers: { Accept: 'text/csv,application/octet-stream;q=0.9,*/*;q=0.1' } });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      if (redirects === 5) throw failure('CAPTURE_REDIRECT_LIMIT', 'Official source redirected too many times', 502);
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location) throw failure('CAPTURE_REDIRECT_INVALID', 'Source redirect omitted its destination', 502);
      url = officialURL(new URL(location, url).href);
    }
    responseMeta = { status: response.status, finalURL: url, retrievedAt: timestamp(),
      etag: response.headers.get('etag'), lastModified: response.headers.get('last-modified'),
      contentType: response.headers.get('content-type'), contentLength: response.headers.get('content-length') };
    if (!response.ok) {
      await response.body?.cancel();
      const error = failure('CAPTURE_HTTP', 'Official source returned HTTP ' + response.status, response.status === 429 ? 429 : 502, responseMeta);
      const retry = response.headers.get('retry-after');
      if (retry) { error.retryAfter = retry; const retryTime = /^\d+$/.test(retry) ? Date.now() + Number(retry) * 1000 : Date.parse(retry); if (Number.isFinite(retryTime)) error.retryAt = new Date(retryTime).toISOString(); }
      throw error;
    }
    if (Number(response.headers.get('content-length')) > maxBytes) { await response.body?.cancel(); throw failure('SOURCE_CAPACITY', 'Official source exceeds the selected capture capacity', 413, responseMeta); }
    if (!response.body) throw failure('CAPTURE_BODY_MISSING', 'Official source returned no body', 502);
    const chunks = []; let size = 0;
    for await (const chunk of response.body) {
      const value = Buffer.from(chunk); size += value.length;
      if (size > maxBytes) { controller.abort(); throw failure('SOURCE_CAPACITY', 'Official source exceeds the selected capture capacity', 413, responseMeta); }
      chunks.push(value);
    }
    bytes = Buffer.concat(chunks, size);
    const expectedLength = response.headers.get('content-length');
    if (expectedLength && !response.headers.get('content-encoding') && /^\d+$/.test(expectedLength) && Number(expectedLength) !== size)
      throw failure('INCOMPLETE_SOURCE', 'Official response ended before its complete body arrived', 502, { expectedBytes: Number(expectedLength), actualBytes: size });
    const result = workspace.completeCapture(current.id, current.revision, bytes, {
      stream: current.stream, url: current.url, label: current.label, retrievedAt: responseMeta.retrievedAt, response: responseMeta
    }, { response: responseMeta });
    return { ...result, counts: workspace.view().counts };
  } catch (error) {
    if (started && current?.revision) {
      const terminal = { ...current, status: 'interrupted', canResume: !['INVALID_UTF8', 'INVALID_CSV', 'INCOMPLETE_CSV', 'CSV_COLUMN_COUNT', 'CSV_HEADER_REQUIRED', 'TENDER_COLUMNS_REQUIRED', 'AWARD_COLUMNS_REQUIRED', 'ARRANGEMENT_COLUMNS_REQUIRED'].includes(error.code) && ![401,403].includes(responseMeta?.status), response: responseMeta || null,
        retryAt: error.retryAt || null,
        error: { code: error.code || 'CAPTURE_ERROR', message: error.message, retryAfter: error.retryAfter || null },
        ...(bytes ? { rawBase64: bytes.toString('base64'), bytes: bytes.length, sha256: sha256(bytes) } : {}) };
      try {
        const saved = workspace.saveCapture(terminal, null, current.revision);
        error.details = { ...(error.details || {}), captureId: current.id, capture: { ...saved.capture, rawText: undefined, rawBase64: undefined } };
      } catch (saveError) {
        error.details = { ...(error.details || {}), captureId: current.id, persistenceError: { code: saveError.code, message: saveError.message } };
      }
    }
    throw error;
  } finally {
    clearTimeout(timer); if (signal) signal.removeEventListener('abort', abort); executing.delete(current.id);
  }
}
