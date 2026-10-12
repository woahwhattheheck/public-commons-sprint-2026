// Cross-match projection of the original event engine and saved-match archive.
import {createHash} from 'node:crypto';
import {derive, makeSnapshot, WINDOW_SECONDS} from './engine.mjs';
import {parseCount, parseView} from './live_sessions.mjs';
import {MATCH_PACKAGE_FORMAT} from './match_archive.mjs';

export const COACH_BUNDLE_FORMAT = 'counterpress.coach-review.v1';
export const MAX_COACH_MATCHES = 4;
const fail = message => Object.assign(new Error(message), {status: 400});
const half = second => second < 2700 ? 'first' : 'second';
const inPeriod = (second, period) => period === 'all' || half(second) === period;
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

// Classification and window boundaries always come from derive(). This reducer
// only groups its completed records by the original loss event's half.
function groupedStats(windows) {
  const attempted = windows.filter(item => item.status !== 'not_attempted');
  const successes = attempted.filter(item => item.status === 'success');
  const resolved = attempted.filter(item => item.status === 'success' || item.status === 'expired');
  return {
    lossWindows: windows.length,
    counterpressAttempts: attempted.length,
    successes: successes.length,
    resolvedCounterpressAttempts: resolved.length,
    interruptedAttempts: attempted.filter(item => item.status === 'interrupted').length,
    successRatePct: resolved.length ? Math.round(100 * successes.length / resolved.length) : null,
    successRateBasis: 'resolved_counterpress_attempts',
    meanRecoverySeconds: successes.length
      ? Math.round(10 * successes.reduce((sum, item) => sum + item.secondsToRecover, 0) / successes.length) / 10
      : null,
  };
}

function projectMatch({archive, match}, selection, view, period) {
  const count = parseCount(selection.count ?? archive.review.cursor, match.events.length);
  const events = match.events.slice(0, count);
  const native = makeSnapshot(events, view);
  const finished = derive(events).filter(item => item.team === view.team);
  const windows = finished.filter(item => inPeriod(item.fromSecond, period));
  const stats = period === 'all' ? native.stats : groupedStats(windows);
  const index = new Map(events.map((event, i) => [event.id, {event, count: i + 1}]));
  const overlays = new Map(native.overlays.map(item => [item.id, item]));
  const observedLosses = events.filter(event => event.team === view.team &&
    event.type === 'loss' && inPeriod(event.second, period)).length;
  const moments = windows.filter(item => item.status !== 'not_attempted').map(item => {
    const closureId = item.status === 'expired' ? null : item.evidenceIds.at(-1);
    const closeAt = closureId ? index.get(closureId).count
      : events.findIndex(event => event.second > item.toSecond) + 1;
    const evidence = item.evidenceIds.map(id => {
      const source = index.get(id);
      return {...source.event, count: source.count};
    });
    return {
      ...item, lossCount: index.get(item.id).count, count: closeAt, eventId: events[closeAt - 1].id,
      text: overlays.get(item.id).text, evidence,
      watermark: item.status === 'expired' ? {...events[closeAt - 1], count: closeAt} : null,
      nextObserved: closeAt < events.length ? {...events[closeAt], count: closeAt + 1} : null,
    };
  });
  const contextEvents = events.filter(event => event.team === view.team && inPeriod(event.second, period));
  return {
    id: archive.id, revision: archive.revision, title: archive.title,
    scenario: match.scenario, seed: match.seed, sourceSha256: digest(match),
    count, total: match.events.length, observedThroughSecond: events.at(-1)?.second ?? null,
    period, stats, expiredAttempts: windows.filter(item => item.status === 'expired').length,
    unattemptedWindows: windows.filter(item => item.status === 'not_attempted').length,
    unsettledLossWindows: observedLosses - windows.length,
    eventCounts: Object.fromEntries(['loss', 'pressure', 'regain', 'pass', 'shot'].map(type =>
      [type, contextEvents.filter(event => event.type === type).length])),
    moments, archive,
    insights: (archive.review.insights || []).filter(record => record.source.count <= count &&
      record.source.team === view.team && record.source.audience === view.audience && record.source.locale === view.locale &&
      moments.some(moment => moment.id === record.source.momentId)),
  };
}

export async function createCoachComparison(store, input, libraryKey) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail('Comparison object required');
  const view = parseView(input.view ?? {});
  const period = input.period ?? 'all';
  if (!['all', 'first', 'second'].includes(period)) throw fail('Choose a match half');
  if (!Array.isArray(input.matches) || input.matches.length < 2 || input.matches.length > MAX_COACH_MATCHES)
    throw fail('Choose two to four saved matches');
  if (input.matches.some(item => !item || typeof item !== 'object' || typeof item.id !== 'string') ||
      new Set(input.matches.map(item => item.id)).size !== input.matches.length)
    throw fail('Choose distinct saved match IDs');
  const documents = [];
  for (const selected of input.matches) {
    // Use the original archive's validated read, permissions and exact event array.
    documents.push(await store.open(selected.id, libraryKey));
  }
  const matches = documents.map((document, i) => projectMatch(document, input.matches[i], view, period));
  const baseline = matches[0];
  for (const match of matches) {
    match.delta = Object.fromEntries(Object.keys(baseline.stats).filter(key =>
      key !== 'successRateBasis').map(key => [key,
        match.stats[key] === null || baseline.stats[key] === null ? null
          : Math.round((match.stats[key] - baseline.stats[key]) * 10) / 10]));
  }
  const result = {
    format: 'counterpress.coach-comparison.v1', generatedAt: new Date().toISOString(),
    view, period, windowSeconds: WINDOW_SECONDS, matches,
    selection: matches.map(({id, count, revision, sourceSha256}) => ({id, count, revision, sourceSha256})),
  };
  if (input.export === true) {
    result.bundle = {
      format: COACH_BUNDLE_FORMAT,
      title: typeof input.title === 'string' ? input.title.trim().slice(0, 100) : '',
      generatedAt: result.generatedAt, view, period,
      matches: documents.map(({match, archive}, i) => ({
        originalId: archive.id, revision: archive.revision, sourceSha256: matches[i].sourceSha256,
        count: matches[i].count,
        package: {format: MATCH_PACKAGE_FORMAT, match, review: archive.review},
      })),
    };
  }
  return result;
}
