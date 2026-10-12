// Optional paid insight via the Microsoft Agent Framework worker.
// Paid execution ONLY inside the Python worker, which calls the operator's
// existing guarded budget runner (run_paid_api.py, original $200 pool) via
// CP_OPUS_* argv config. No provider SDK, HTTP client, key or path enters
// this process or the frontend. Runs only on the explicit button press;
// never on load/play/seek/locale change.
import {spawn as nodeSpawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {statSync} from 'node:fs';
import {isAbsolute} from 'node:path';
import {TEAMS} from './engine.mjs';
import {validateDraftGrounding} from './draft_evidence_guard.mjs';
import {createFoundryAdmission} from './foundry_quota.mjs';
import {buildFacts, parseFinal} from './opus_commentary.mjs';
import {opusConfig} from './opus_commentary.mjs';

export const AGENT_PROMPT_VERSION = 'cp-agent-insight-v1';
const JOB_RE = /^[a-z0-9-]+$/;
const JOURNAL_MAX = 200;
const WORKER_STDOUT_MAX = 65536;

function isFile(p) { try { return statSync(p).isFile(); } catch { return false; } }

// Operator config: an absolute path to the python worker file plus the same
// guarded-runner resolution the single-turn route already uses. No config,
// no mode — the route stays 503 and the UI button stays disabled.
export function opusAgentConfig(env = process.env) {
  const worker = env.CP_OPUS_AGENT_WORKER || '';
  if (!isAbsolute(worker) || !worker.endsWith('.py') || !isFile(worker)) return null;
  const runner = opusConfig(env);
  if (!runner) return null;
  return {worker, python: runner.python, runner};
}
export const opusAgentConfigured = (env = process.env) => !!opusAgentConfig(env);

export function workflowIdFor({sessionId, count, team, audience, locale}) {
  const h = createHash('sha256')
    .update(JSON.stringify([String(sessionId), count, team, audience, locale, AGENT_PROMPT_VERSION]))
    .digest('hex');
  const id = 'cpaf-' + h.slice(0, 40);
  if (!JOB_RE.test(id)) throw new TypeError('Invalid workflow id');
  return id;
}

// Strict envelope validation of the worker's stdout. Anything else is
// treated as unavailable — never a fabricated success.
export function parseWorkerOutput(raw) {
  let s = String(raw || '').trim();
  if (s.length > WORKER_STDOUT_MAX) return null;
  const nl = s.indexOf('\n');
  if (nl !== -1) s = s.slice(0, nl);          // worker emits exactly one line
  let o;
  try { o = JSON.parse(s); } catch { return null; }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  if (!['ready', 'held', 'unavailable'].includes(o.status)) return null;
  const toolCalls = Array.isArray(o.tool_calls) ? o.tool_calls : [];
  const cleanCalls = toolCalls.filter(c =>
    c && typeof c === 'object' && typeof c.call_id === 'string' &&
    typeof c.name === 'string' && ['get_match_state', 'get_latest_moment'].includes(c.name)
  ).slice(0, 4).map(c => ({call_id: String(c.call_id).slice(0, 48), name: c.name, jobId: c.job_id}));
  const out = {status: o.status, toolCalls: cleanCalls,
    turns: Array.isArray(o.turns) ? o.turns.length : 0,
    sdkVersion: typeof (o.sdk || {}).imported_version === 'string' ? o.sdk.imported_version : null,
    heldReason: typeof o.held_reason === 'string' ? o.held_reason.slice(0, 80) : null,
    workflowId: typeof o.workflow_id === 'string' ? o.workflow_id : null,
    promptVersion: o.prompt_version, model: o.model, context: o.context,
    toolInvocations: o.tool_invocations,
    providerTurns: Array.isArray(o.turns) ? o.turns.slice(0, 3).map(turn => ({
      turn: turn.turn, jobId: turn.job_id, requestId: turn.request_id,
      receiptState: turn.receipt_state, decision: turn.decision, promptSha256: turn.prompt_sha256,
    })) : []};
  if (o.status === 'ready') {
    const final = parseFinal(JSON.stringify({caption: o.caption, insight: o.insight}));
    if (!final) return null;                       // fail closed, same guard as before
    if (!cleanCalls.length || cleanCalls.length !== toolCalls.length) return null;           // no real tool call, no ready claim
    out.caption = final.caption; out.insight = final.insight;
  }
  return out;
}

// Match the original Python worker's context-derived identity. The bridge and
// worker retain their distinct original operation IDs.
function matchesOriginalWorker(result, payload) {
  const expected = payload.context;
  const keys = Object.keys(expected).sort();
  if (!result.context || keys.some(key => result.context[key] !== expected[key])) return false;
  const canonical = Object.fromEntries(keys.map(key => [key, expected[key]]));
  const workflow = 'cpaf-' + createHash('sha256').update(JSON.stringify(canonical)).digest('hex').slice(0, 40);
  return result.workflowId === workflow && result.promptVersion === AGENT_PROMPT_VERSION &&
    result.model === 'claude-opus-5-5' && result.sdkVersion === '1.21.0' &&
    result.toolCalls.length > 0 && result.toolCalls.length <= 2 &&
    result.toolCalls.every(call => Number.isInteger(result.toolInvocations?.[call.name]) &&
      result.toolInvocations[call.name] > 0) &&
    result.providerTurns.length > 0 && result.providerTurns.length <= 3 &&
    result.turns === result.providerTurns.length && result.providerTurns.at(-1).decision === 'final' &&
    result.providerTurns.every((turn, index) => turn.turn === index + 1 &&
      typeof turn.jobId === 'string' && /^cpaf-[0-9a-f]{40}$/.test(turn.jobId) &&
      typeof turn.requestId === 'string' && turn.requestId.length > 0 && turn.requestId.length <= 160 &&
      turn.receiptState === 'RESPONDED' && typeof turn.decision === 'string' &&
      typeof turn.promptSha256 === 'string' && /^[0-9a-f]{64}$/.test(turn.promptSha256) &&
      turn.jobId === 'cpaf-' + createHash('sha256').update(workflow + ':' + turn.turn + ':' + turn.promptSha256).digest('hex').slice(0, 40)) &&
    result.toolCalls.every(call => result.providerTurns.some(turn =>
      turn.jobId === call.jobId && turn.decision === 'tool:' + call.name &&
      call.call_id === 'call_' + createHash('sha256').update(workflow + ':call:' + turn.turn + ':' + call.name).digest('hex').slice(0, 32)));
}

// Canonical quantities the AI lane may cite: overlay text/metrics (checked
// by the guard itself) plus numbers that are already displayed product data -
// seconds of the cited evidence events, the recorded prefix count and the
// shown match stats. Anything else still fails as unobserved.
function canonicalQuantities(overlay, snapshot, events, count) {
  const ids = new Set((overlay.evidenceIds || []).map(String));
  const out = [count];
  for (const e of events) if (ids.has(e.id) && Number.isFinite(e.second)) out.push(e.second);
  const walk = (v) => {
    if (Number.isFinite(v)) { out.push(v); return; }
    if (v && typeof v === 'object') for (const x of Object.values(v)) walk(x);
  };
  walk(snapshot.stats);
  return out;
}

function grounded(caption, insight, overlay, canonical, guard = validateDraftGrounding) {
  if (!guard(caption, overlay, canonical)?.ok) return false;
  // parseFinal already enforces 1–4 sentences and 700 total characters.
  // Apply the same factual checks to that full insight; a valid sentence
  // need not fit the separate 135-character caption limit.
  // Paragraph whitespace is normalized only for checking; original text is retained.
  return guard(insight.replace(/\s+/g, ' ').trim(), overlay, canonical, 700)?.ok === true;
}


export function buildAgentPayload({sessionId, count, snapshot, events}) {
  if (!Number.isInteger(count) || count < 1 || !Array.isArray(events) || events.length !== count ||
      !snapshot || !Array.isArray(snapshot.overlays)) throw new TypeError('Original observed insight input required');
  const overlay = snapshot.overlays.at(-1);
  if (!overlay) throw new TypeError('An original counterpress moment is required');
  const {team, audience, locale} = snapshot;
  if (!TEAMS.includes(team) || !['casual', 'analyst'].includes(audience) ||
      !['en', 'es'].includes(locale)) throw new TypeError('Unsupported insight view');
  const facts = buildFacts({count, snapshot, events});
  return {
    version: AGENT_PROMPT_VERSION,
    context: {sessionId: String(sessionId), count, team, audience, locale,
      frameSecond: snapshot.elapsedSeconds, momentId: overlay.id},
    facts: {match: {dataset: facts.dataset, recordedEventCount: facts.recordedEventCount,
                    elapsedSeconds: facts.elapsedSeconds, focusTeam: facts.focusTeam,
                    rivalTeam: facts.rivalTeam, counterpressRule: facts.counterpressRule,
                    focusStats: facts.focusStats, recentEvents: facts.recentEvents,
                    fieldPrecision: facts.fieldPrecision, goalsRecorded: facts.goalsRecorded},
            latestMoment: facts.latestMoment},
  };
}

// The live worker and the local completed-result receiver share this exact
// original-context and completed-turn admission. This function never launches.
export function admitCompletedAgentInsight(input, raw, {guard = validateDraftGrounding} = {}) {
  const payload = buildAgentPayload(input), parsed = parseWorkerOutput(raw);
  const {sessionId, count, snapshot, events} = input, overlay = snapshot.overlays.at(-1);
  if (!parsed || parsed.status !== 'ready' || !matchesOriginalWorker(parsed, payload) ||
      !grounded(parsed.caption, parsed.insight, overlay,
        canonicalQuantities(overlay, snapshot, events, count), guard)) return null;
  return {
    state: 'ready', operation: workflowIdFor(payload.context), sessionId: String(sessionId),
    recordedCount: count, frameSecond: snapshot.elapsedSeconds, momentId: overlay.id,
    promptVersion: AGENT_PROMPT_VERSION, team: snapshot.team, audience: snapshot.audience, locale: snapshot.locale,
    engine: 'agent-framework-core==1.21.0', caption: parsed.caption, text: parsed.insight,
    provider: 'Anthropic Claude via Microsoft Agent Framework tool loop (optional AI insight)',
    model: parsed.model, sdk: parsed.sdkVersion, workflowId: parsed.workflowId,
    toolCalls: parsed.toolCalls, turns: parsed.turns, providerTurns: parsed.providerTurns,
  };
}

export function createOpusAgentInsight({env = process.env, spawn = nodeSpawn,
  guard = validateDraftGrounding,
  admission = createFoundryAdmission({maxPerHour: 8, maxInFlight: 1})} = {}) {
  const journal = new Map();

  function view(entry) {
    return entry.state === 'ready' ? {...entry.completed} : {state: entry.state, ...entry.meta};
  }

  function trim() {
    if (journal.size <= JOURNAL_MAX) return;
    for (const [k, v] of journal) { if (v.state !== 'pending') { journal.delete(k); if (journal.size <= JOURNAL_MAX) return; } }
  }

  async function launch(c, workflowId, payload, entry, ticket, input) {
    try {
      const child = spawn(c.python, [c.worker], {
        shell: false, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env});
      let out = '';
      child.stdout?.on('data', d => { if (out.length < WORKER_STDOUT_MAX) out += String(d).slice(0, WORKER_STDOUT_MAX - out.length); });
      child.stderr?.on('data', () => {});           // never echoed to visitors or logs
      child.stdin?.end(JSON.stringify(payload));
      await new Promise(done => { child.once('error', done); child.once('close', done); });
      // No timeout kill: the worker's own paid children are never killed and
      // retried; a still-running workflow stays 'pending' in the journal.
      const completed = admitCompletedAgentInsight(input, out, {guard});
      if (completed) Object.assign(entry, {state: 'ready', completed});
      else {
        entry.state = 'unavailable';
        const parsed = parseWorkerOutput(out);
        if (parsed?.heldReason) entry.meta.heldReason = parsed.heldReason;
      }
    } catch {
      entry.state = 'unavailable';
    } finally {
      ticket.release();
    }
  }

  return {
    configured: () => !!opusAgentConfig(env),
    async request({sessionId, count, snapshot, events}) {
      const c = opusAgentConfig(env);
      if (!c) return {state: 'unavailable'};
      if (!Number.isInteger(count) || count < 0 || !Array.isArray(events) || !snapshot || !Array.isArray(snapshot.overlays)) throw new TypeError('Invalid insight input');
      const overlay = snapshot.overlays.at(-1);
      if (!overlay) return {state: 'no_moment'};
      const {team, audience, locale} = snapshot;
      if (!TEAMS.includes(team) || !['casual', 'analyst'].includes(audience) || !['en', 'es'].includes(locale)) throw new TypeError('Unsupported view');
      const workflowId = workflowIdFor({sessionId, count, team, audience, locale});
      const known = journal.get(workflowId);
      if (known) return view(known);
      const payload = buildAgentPayload({sessionId, count, snapshot, events});
      const entry = {state: 'pending', overlay,
        canonical: canonicalQuantities(overlay, snapshot, events, count),
        meta: {operation: workflowId,
        sessionId: String(sessionId), recordedCount: count,
        frameSecond: snapshot.elapsedSeconds, momentId: overlay.id,
        promptVersion: AGENT_PROMPT_VERSION, team, audience, locale,
        engine: 'agent-framework-core==1.21.0'}};
      journal.set(workflowId, entry);
      trim();
      const ticket = admission.reserve();
      if (!ticket.ok) { journal.delete(workflowId); return {state: 'busy', retryAfterSeconds: ticket.retryAfterSeconds}; }
      launch(c, workflowId, payload, entry, ticket, {sessionId, count, snapshot, events}).catch(() => {});
      return view(entry);
    },
  };
}
