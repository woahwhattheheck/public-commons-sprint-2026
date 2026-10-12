// Convert an original completed worker result into the normal match handover.
// This is an operator file receiver; it has no provider transport or server.
import {createHash, randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import {mkdir, open, link, unlink} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {makeSnapshot} from './engine.mjs';
import {createSessionStore, parseCount, parseView} from './live_sessions.mjs';
import {parseScenario, parseSeed} from './scenarios.mjs';
import {buildAgentPayload, admitCompletedAgentInsight} from './opus_agent_bridge.mjs';
import {captureCompletedInsight} from './retained_insight.mjs';
import {createMatchPackage, MAX_PACKAGE_BYTES} from './match_archive.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const fail = message => Object.assign(new Error(message), {code: 'AGENT_RECEIVING_FAILED'});
async function readOriginal(path, maximum) {
  const file = await open(resolve(path), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > maximum) throw fail('Choose a complete original file within its declared size');
    const bytes = await file.readFile();
    if (bytes.length !== info.size) throw fail('The original file changed during receiving');
    return {bytes, value: JSON.parse(bytes.toString('utf8'))};
  } finally { await file.close(); }
}

function options(argv) {
  const allowed = new Set(['input','result','output','scenario','seed','match','title']);
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.slice(2), value = argv[i + 1];
    if (!argv[i]?.startsWith('--') || !allowed.has(key) || out[key] !== undefined || !value ||
        value.startsWith('--')) throw fail('Use --input FILE --result FILE --output FILE with --match FILE or --scenario NAME --seed NUMBER');
    out[key] = value;
  }
  if (!out.input || !out.result || !out.output || (!out.match && (!out.scenario || !out.seed)) ||
      (out.match && (out.scenario || out.seed))) throw fail('Choose the original match file or its exact scenario and seed');
  return out;
}

export async function receiveCompletedAgentInsight(args) {
  const opts = options(args), destination = resolve(opts.output);
  if ([opts.input, opts.result, opts.match].filter(Boolean).map(path => resolve(path)).includes(destination))
    throw fail('The handover output must have its own path');
  const originalInput = await readOriginal(opts.input, 262144);
  const originalResult = await readOriginal(opts.result, 65536);
  const payload = originalInput.value, context = payload.context;
  if (!context || typeof context.sessionId !== 'string' || !context.sessionId)
    throw fail('The original worker input must retain its session identity');

  let match;
  if (opts.match) {
    const saved = await readOriginal(opts.match, MAX_PACKAGE_BYTES);
    match = createMatchPackage(saved.value.match || saved.value).match;
  } else {
    const scenario = parseScenario(opts.scenario), seed = parseSeed(opts.seed), store = createSessionStore();
    const session = store.create(scenario, seed);
    match = createMatchPackage(store.get(session.id)).match;
  }
  const count = parseCount(context.count, match.events.length), events = match.events.slice(0, count);
  const snapshot = makeSnapshot(events, parseView(context));
  const input = {sessionId: context.sessionId, count, snapshot, events, match};
  if (!isDeepStrictEqual(payload, buildAgentPayload(input)))
    throw fail('The original worker input differs from this exact match prefix and view');
  const ready = admitCompletedAgentInsight(input, originalResult.bytes.toString('utf8'));
  if (!ready) throw fail('The original worker result has not completed the selected context and display contract');

  let previous;
  try { previous = await readOriginal(destination, MAX_PACKAGE_BYTES); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const capturedAt = previous?.value?.review?.insights?.[0]?.capturedAt || new Date().toISOString();
  const record = captureCompletedInsight(input, ready, context.sessionId, capturedAt);
  const pkg = createMatchPackage(match, {title: opts.title || 'Counterpress · saved tool insight',
    cursor: count, view: parseView(context), selectedMomentId: snapshot.overlays.at(-1).id,
    bookmarks: [{eventId: events.at(-1).id, count, label: ready.caption.slice(0, 100), note: ''}],
    insights: [record]});
  const bytes = Buffer.from(JSON.stringify(pkg, null, 2) + '\n');
  if (bytes.length > MAX_PACKAGE_BYTES) throw fail('The complete match exceeds the original package limit');
  let state = 'RECEIVED';
  if (previous) {
    if (!isDeepStrictEqual(previous.value, pkg)) throw fail('The existing output belongs to a different original result');
    state = 'REOPENED';
  } else {
    await mkdir(dirname(destination), {recursive: true, mode: 0o700});
    const temporary = destination + '.' + randomUUID() + '.tmp';
    let handle;
    try {
      handle = await open(temporary, 'wx', 0o600);
      await handle.writeFile(bytes); await handle.sync(); await handle.close(); handle = null;
      await link(temporary, destination);
      const directory = await open(dirname(destination), constants.O_RDONLY);
      try { await directory.sync(); } finally { await directory.close(); }
    } finally {
      if (handle) await handle.close();
      await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
  }
  return {state, output: destination, bytes: previous?.bytes.length || bytes.length,
    sha256: sha(previous?.bytes || bytes), inputSha256: sha(originalInput.bytes), resultSha256: sha(originalResult.bytes),
    originalSessionId: context.sessionId, workflowId: ready.workflowId, operation: ready.operation,
    count, frameSecond: snapshot.elapsedSeconds, momentId: record.source.momentId,
    scenario: match.scenario, seed: match.seed, totalEvents: match.events.length,
    sdk: ready.sdk, toolCalls: ready.toolCalls, providerTurns: ready.providerTurns, insightId: record.id};
}

const direct = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (direct) {
  receiveCompletedAgentInsight(process.argv.slice(2)).then(result => {
    process.stdout.write(JSON.stringify(result) + '\n');
  }).catch(error => {
    process.stderr.write(JSON.stringify({state: 'RECEIVING_INCOMPLETE', code: error.code || 'SOURCE_ERROR',
      message: error.message}) + '\n');
    process.exitCode = 1;
  });
}
