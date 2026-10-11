// Optional AI match insight for Counterpress Compass.
// Paid execution ONLY through the operator's reviewed budget runner (run_paid_api.py),
// configured by CP_OPUS_BUDGET_RUNNER. No direct provider HTTP, no keys, no replay.
// Runs only when a viewer presses the explicit button; never on load/play/seek/locale change.
import {spawn as nodeSpawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {statSync} from 'node:fs';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {basename, dirname, isAbsolute, join, resolve} from 'node:path';
import {TEAMS} from './engine.mjs';
import {validateDraftGrounding} from './draft_evidence_guard.mjs';
import {createFoundryAdmission} from './foundry_quota.mjs';

export const PROMPT_VERSION = 'cp-opus-insight-v1';
export const MODEL = 'claude-opus-5-5';
export const EFFORT = 'low';
export const MAX_OUTPUT_TOKENS = 4096;
const JOB_RE = /^[a-z0-9-]+$/;
const JOURNAL_MAX = 500;

function isFile(p) { try { return statSync(p).isFile(); } catch { return false; } }

// Output locations are derived exactly as the runner derives them:
// ROOT = Path(runner).resolve().parents[2]; OUT = ROOT/work/api-jobs/<job>.
export function opusConfig(env = process.env) {
  const runner = env.CP_OPUS_BUDGET_RUNNER || '';
  if (!isAbsolute(runner) || basename(runner) !== 'run_paid_api.py' || !isFile(runner)) return null;
  const python = env.CP_OPUS_PYTHON || 'python';
  if (env.CP_OPUS_PYTHON && (!isAbsolute(python) || !isFile(python))) return null;
  return {runner, python, jobsRoot: resolve(dirname(runner), '..', '..', 'work', 'api-jobs')};
}
export const opusConfigured = (env = process.env) => !!opusConfig(env);

// Only owned, derived, public synthetic facts; never user text, file contents or paths.
export function buildFacts({count, snapshot, events}) {
  const latest = snapshot.overlays.at(-1);
  return {
    dataset: 'SYNTHETIC MATCH: invented teams, invented player labels, invented events. Not a real match.',
    recordedEventCount: count,
    elapsedSeconds: snapshot.elapsedSeconds,
    focusTeam: snapshot.team,
    rivalTeam: TEAMS.find(x => x !== snapshot.team),
    counterpressRule: 'same-team loss, then pressure action and regain within 8 seconds',
    focusStats: snapshot.stats,
    latestMoment: {id: latest.id, status: latest.status, metrics: latest.metrics,
      evidenceIds: latest.evidenceIds, deterministicCaption: latest.text},
    recentEvents: events.slice(-30).map(e => ({id: e.id, second: e.second, team: e.team, type: e.type, zone: e.zone, player: e.player})),
    fieldPrecision: 'zone is a pitch third only; no coordinates exist',
    goalsRecorded: false,
  };
}

export function buildPrompt(facts, audience, locale) {
  const lang = locale === 'es' ? 'Spanish' : 'English';
  const reader = audience === 'analyst' ? 'a tactics-minded analyst' : 'a casual fan';
  return [
    'Football viewing product copy. Write a short viewing insight for ' + reader + ' in ' + lang + '.',
    'Use ONLY the recorded synthetic events in FACTS (everything up to recordedEventCount). Teams, players and events are invented; do not imply a real match, real people or a real competition.',
    'Explain why the latest detected counterpress moment matters for the flow of this match, grounded only in the recorded events.',
    'Do not predict or mention future events. Do not mention goals or a score. Do not state exact player positions, distances, speeds or any number that is not present in FACTS.',
    'Reply with JSON only, no markdown: {"caption": "at most 120 characters", "insight": "2-3 sentences"}.',
    'FACTS JSON:',
    JSON.stringify(facts),
  ].join('\n');
}

export function parseFinal(raw) {
  let s = String(raw).trim();
  if (s.startsWith('```')) s = s.replace(/^```(?:json)?\s*/, '').replace(/```$/, '').trim();
  let o;
  try { o = JSON.parse(s); } catch { return null; }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  const caption = typeof o.caption === 'string' ? o.caption.trim() : '';
  const insight = typeof o.insight === 'string' ? o.insight.trim() : '';
  if (!caption || caption.length > 135 || !insight || insight.length > 700) return null;
  if (/[<>]/.test(caption + insight)) return null;
  const sentences = insight.split(/[.!?](?:\s|$)/).filter(x => x.trim()).length;
  if (sentences < 1 || sentences > 4) return null;
  return {caption, insight};
}

export function jobIdFor({sessionId, count, team, audience, locale, prompt}) {
  const promptHash = createHash('sha256').update(prompt).digest('hex');
  const h = createHash('sha256')
    .update(JSON.stringify([String(sessionId), count, team, audience, locale, PROMPT_VERSION, promptHash]))
    .digest('hex');
  const id = 'cp-opus-' + h.slice(0, 40);
  if (!JOB_RE.test(id)) throw new TypeError('Invalid job id');
  return id;
}

export function createOpusCommentary({env = process.env, spawn = nodeSpawn, guard = validateDraftGrounding,
  admission = createFoundryAdmission({maxPerHour: 8, maxInFlight: 1}), tmpRoot = tmpdir()} = {}) {
  // In-process journal: one entry per operation; never re-dispatched while known.
  const journal = new Map();

  // The shared draft guard bounds one short line (<=135 chars). The caption is
  // checked whole; the multi-sentence insight is checked per sentence, so a
  // normal 2-3 sentence answer faces the same quantitative bar instead of
  // always failing the length clause. A sentence over the bound fails closed.
  function grounded(caption, insight, overlay) {
    if (!guard(caption, overlay)?.ok) return false;
    const parts = insight.split(/(?<=[.!?])\s+/).filter(s => s.trim());
    return parts.length > 0 && parts.every(s => guard(s, overlay)?.ok);
  }

  // Reads only the runner's own artifacts; never writes or overwrites them.
  async function fromDisk(c, jobId, overlay) {
    const dir = join(c.jobsRoot, jobId);
    let receipt;
    try { receipt = JSON.parse(await readFile(join(dir, 'receipt.json'), 'utf8')); }
    catch (e) { return e && e.code === 'ENOENT' ? null : {state: 'unavailable'}; }
    // DISPATCHING (no live child), EFFECT_UNKNOWN, max_tokens, refusal, unsaved artifact: held.
    if (!receipt || receipt.state !== 'RESPONDED' || receipt.stop_reason !== 'end_turn' || receipt.artifact_saved !== true) return {state: 'unavailable'};
    let parsed = null;
    try { parsed = parseFinal(await readFile(join(dir, 'response.txt'), 'utf8')); } catch {}
    if (!parsed) return {state: 'unavailable'};
    try {
      // Conservative quantitative guard; reduces, does not eliminate, unsupported claims.
      if (!grounded(parsed.caption, parsed.insight, overlay)) return {state: 'unavailable'};
    } catch { return {state: 'unavailable'}; }
    return {state: 'ready', ...parsed,
      actualModel: typeof receipt.actual_model === 'string' ? receipt.actual_model.slice(0, 64) : MODEL};
  }

  async function launch(c, jobId, prompt, entry, ticket) {
    let dir = null;
    try {
      dir = await mkdtemp(join(tmpRoot, 'cp-opus-'));
      const promptPath = join(dir, 'prompt.txt');
      await writeFile(promptPath, prompt, {flag: 'wx', mode: 0o600});
      await new Promise(done => {
        let child;
        try {
          child = spawn(c.python, [c.runner, jobId, '--prompt', promptPath, '--model', MODEL,
            '--max-tokens', String(MAX_OUTPUT_TOKENS), '--effort', EFFORT],
            {shell: false, cwd: dirname(c.runner), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true});
        } catch { done(); return; }
        // Drain and discard: receipt/stdout are never echoed to visitors or logs.
        child.stdout?.on('data', () => {});
        child.stderr?.on('data', () => {});
        child.once('error', () => done());
        child.once('close', () => done());
        // No timeout kill: a running paid child is never killed and retried.
      });
      Object.assign(entry, (await fromDisk(c, jobId, entry.overlay)) || {state: 'unavailable'});
    } catch {
      entry.state = 'unavailable';
    } finally {
      ticket.release();
      if (dir) rm(dir, {recursive: true, force: true}).catch(() => {});
    }
  }

  function view(entry) {
    const out = {state: entry.state, ...entry.meta};
    if (entry.state === 'ready') Object.assign(out, {caption: entry.caption, text: entry.insight,
      provider: 'Anthropic Claude (optional AI insight)', model: entry.actualModel});
    return out;
  }

  function trim() {
    if (journal.size <= JOURNAL_MAX) return;
    for (const [k, v] of journal) { if (v.state !== 'pending') { journal.delete(k); if (journal.size <= JOURNAL_MAX) return; } }
  }

  return {
    configured: () => !!opusConfig(env),
    async request({sessionId, count, snapshot, events}) {
      const c = opusConfig(env);
      if (!c) return {state: 'unavailable'};
      if (!Number.isInteger(count) || count < 0 || !Array.isArray(events) || !snapshot || !Array.isArray(snapshot.overlays)) throw new TypeError('Invalid insight input');
      const overlay = snapshot.overlays.at(-1);
      if (!overlay) return {state: 'no_moment'};
      const {team, audience, locale} = snapshot;
      if (!TEAMS.includes(team) || !['casual', 'analyst'].includes(audience) || !['en', 'es'].includes(locale)) throw new TypeError('Unsupported view');
      const prompt = buildPrompt(buildFacts({count, snapshot, events}), audience, locale);
      const jobId = jobIdFor({sessionId, count, team, audience, locale, prompt});
      const known = journal.get(jobId);
      if (known) return view(known);
      const entry = {state: 'pending', overlay, meta: {operation: jobId, sessionId: String(sessionId),
        recordedCount: count, frameSecond: snapshot.elapsedSeconds, momentId: overlay.id,
        promptVersion: PROMPT_VERSION, team, audience, locale}};
      journal.set(jobId, entry);
      trim();
      const disk = await fromDisk(c, jobId, overlay);
      if (disk) { Object.assign(entry, disk); return view(entry); }
      const ticket = admission.reserve();
      if (!ticket.ok) { journal.delete(jobId); return {state: 'busy', retryAfterSeconds: ticket.retryAfterSeconds}; }
      launch(c, jobId, prompt, entry, ticket).catch(() => {});
      return view(entry);
    },
  };
}
