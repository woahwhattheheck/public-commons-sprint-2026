// SPDX-License-Identifier: MIT
// VendorMix: taste-grounded, constraint-aware festival vendor shortlist.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseCategoryCap, rankLineup } from './lineup.mjs';
import { boundedQlooResponseBytes } from './response-bound.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '127.0.0.1';
const API_BASE = process.env.QLOO_API_BASE || 'https://hackathon.api.qloo.com';
const ALLOWED_BASES = new Set(['https://hackathon.api.qloo.com', 'https://api.qloo.com', 'https://staging.api.qloo.com']);
const DEMO = JSON.parse(await readFile(join(ROOT, 'demo-fixture.json'), 'utf8'));

function validate(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid plan request');
  const location = String(input.location ?? '').trim();
  const seeds = Array.isArray(input.seeds) ? input.seeds : [];
  const slots = Number(input.slots);
  const mode = input.mode;
  const source = input.source;
  const exclusions = Array.isArray(input.exclusions) ? input.exclusions : [];
  if (!location || location.length > 90 || /[\x00-\x1f]/.test(location)) throw new Error('Provide a location (up to 90 characters)');
  if (!seeds.length || seeds.length > 5 || seeds.some(s => typeof s !== 'string' || !s.trim() || s.length > 70)) {
    throw new Error('Provide 1–5 example places or brands');
  }
  if (!Number.isInteger(slots) || slots < 2 || slots > 10) throw new Error('Vendor slots must be 2–10');
  if (!['balanced', 'taste', 'discovery'].includes(mode)) throw new Error('Invalid planning strategy');
  if (!['demo', 'qloo'].includes(source)) throw new Error('Select demo or live Qloo');
  if (exclusions.length > 15 || exclusions.some(s => typeof s !== 'string' || s.length > 80)) {
    throw new Error('Too many exclusions');
  }
  return { location, seeds: seeds.map(s => s.trim()), slots, mode, source, categoryCap: parseCategoryCap(input.categoryCap, slots), exclusions: exclusions.map(s => s.trim().toLowerCase()).filter(Boolean) };
}

function categoryFrom(entity) {
  const tags = entity.properties?.tags;
  if (!Array.isArray(tags)) return 'Unclassified';
  const candidates = tags.map(t => typeof t === 'string' ? t : (t?.name ?? t?.id ?? ''));
  // Category is displayed as an observed tag, not as a confirmed service or dietary claim.
  const label = candidates.find(t => typeof t === 'string' && t.length > 1 && t.length < 55);
  return label ? label.replace(/^urn:tag:/, '').replaceAll(':', ' / ') : 'Unclassified';
}

function providerCandidates(payload) {
  if (payload?.success === false || !Array.isArray(payload?.results?.entities)) {
    throw new Error('Qloo response did not include a usable list of places');
  }
  const candidates = [];
  for (const [index, e] of payload.results.entities.entries()) {
    const name = e?.name ?? e?.properties?.name;
    if (typeof name !== 'string' || !name.trim()) continue;
    const raw = e?.query?.affinity;
    const hasAffinity = typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 && raw <= 100;
    // Qloo's surfaced API affinity is 0–100; if missing, preserve ordinal result position.
    const affinity = hasAffinity ? (raw > 1 ? raw / 100 : raw) : Math.max(0, 1 - index / Math.max(payload.results.entities.length, 1));
    candidates.push({ id: String(e?.entity_id ?? e?.id ?? `position-${index}`), name: name.trim(), category: categoryFrom(e), signal: affinity,
      signalKind: hasAffinity ? 'provider-affinity' : 'result-order-proxy', ordinal: index + 1,
      evidence: hasAffinity ? `Qloo affinity ${raw} (normalized for lineup scoring)` : `Qloo result position ${index + 1}; no numeric affinity surfaced` });
  }
  if (!candidates.length) throw new Error('Qloo returned no named places for this request');
  return candidates;
}

async function fetchQloo(input) {
  const token = process.env.QLOO_API_KEY;
  if (!token) throw new Error('QLOO_API_KEY is not configured; select the labelled synthetic demo');
  if (!ALLOWED_BASES.has(API_BASE)) throw new Error('QLOO_API_BASE is not an allowed Qloo origin');
  const body = {
    'filter.type': 'urn:entity:place',
    'filter.location.query': input.location,
    'signal.interests.entities.query': input.seeds.map(name => ({ name })),
    'feature.explainability': true,
    'sort_by': 'affinity',
    take: 35
  };
  let response;
  try {
    response = await fetch(`${API_BASE}/v2/insights`, {
      method: 'POST', signal: AbortSignal.timeout(12000),
      headers: { 'x-api-key': token, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body)
    });
  } catch { throw new Error('Qloo connection timed out or failed; no synthetic results substituted'); }
  if (!response.ok) throw new Error(`Qloo returned HTTP ${response.status}; no synthetic results substituted`);
  const bytes = await boundedQlooResponseBytes(response);
  let parsed;
  try { parsed = JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new Error('Qloo returned invalid JSON'); }
  return providerCandidates(parsed);
}

export async function buildPlan(inputRaw) {
  const input = validate(inputRaw);
  const candidates = input.source === 'demo'
    ? DEMO.map((c, ordinal) => ({ ...c, ordinal: ordinal + 1, signalKind: 'synthetic-fixture', evidence: 'Explicitly synthetic fixture score; not a Qloo observation' }))
    : await fetchQloo(input);
  const ranked = rankLineup(candidates, input);
  return { ...ranked, source: input.source === 'demo' ? 'SYNTHETIC DEMONSTRATION — NO LIVE QLOO DATA' : 'LIVE QLOO API OBSERVATION',
    location: input.location, seeds: input.seeds, generatedAt: new Date().toISOString(),
    nextSteps: ['Contact each candidate to verify availability, fees and capacity', 'Check dietary/accessibility and local event rules with the vendor', 'Confirm contracts independently before booking'] };
}

async function readBody(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 8192) throw new Error('Request too large');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new Error('Invalid JSON request'); }
}

const mime = { '/': 'text/html; charset=utf-8', '/index.html': 'text/html; charset=utf-8' };
const server = http.createServer(async (request, response) => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'");
  if (request.method === 'GET' && request.url === '/api/health') {
    response.writeHead(200, { 'content-type': 'application/json' });
    return response.end(JSON.stringify({ ready: true, liveConfigured: Boolean(process.env.QLOO_API_KEY) }));
  }
  if (request.method === 'GET' && mime[request.url]) {
    response.writeHead(200, { 'content-type': mime[request.url], 'cache-control': 'no-store' });
    return response.end(await readFile(join(ROOT, 'index.html')));
  }
  if (request.method === 'POST' && request.url === '/api/plan') {
    try {
      const body = await readBody(request);
      const result = await buildPlan(body);
      response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      return response.end(JSON.stringify(result));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Plan error';
      const code = message.startsWith('Qloo returned HTTP 429') ? 429 : 400;
      response.writeHead(code, { 'content-type': 'application/json' });
      return response.end(JSON.stringify({ error: message }));
    }
  }
  response.writeHead(404, { 'content-type': 'text/plain' });
  return response.end('Not found');
});
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  server.listen(PORT, HOST, () => console.log(`VendorMix at http://${HOST}:${PORT}`));
}