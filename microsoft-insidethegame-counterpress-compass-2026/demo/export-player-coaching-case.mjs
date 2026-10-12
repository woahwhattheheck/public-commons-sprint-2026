// Generate complete player coaching packages and an offline brief from original match modules.
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {resolve, join} from 'node:path';
import {createHash} from 'node:crypto';
import {generateMatch} from '../src/scenarios.mjs';
import {buildPlayerRecap} from '../src/player_recap.mjs';
import {createMatchPackage} from '../src/match_archive.mjs';
import {createCoachComparison} from '../src/coach_review.mjs';
import {playerCoachingHtml} from '../src/player_coaching.mjs';

const pins = {
  'engine.mjs': 'a89906267ab13293f4579a160d92859a82f00cd9',
  'scenarios.mjs': '7ef40f70ab9f53d0d8b3c9689aba53c3061ce89c',
  'player_recap.mjs': '41e399878ee40e3b9e1ed35d344093570458543d'
};
const actualPins = {};
for (const [name, expected] of Object.entries(pins)) {
  const body = await readFile(new URL('../src/' + name, import.meta.url));
  actualPins[name] = createHash('sha1').update('blob ' + body.length + '\0').update(body).digest('hex');
  if (actualPins[name] !== expected) throw new Error('Use the recorded original source for ' + name);
}
const output = resolve(process.argv[2] || 'player-coaching-case');
await mkdir(output, {recursive: true});
const scenarios = ['high-press', 'low-block', 'end-to-end', 'late-siege'];
const players = ['H10', 'H6'];
const team = 'Harbor FC', seed = 2026;
const recaps = [], fixtures = [], cutoffs = [], documents = [];
const view = {team, audience: 'analyst', locale: 'en'};
for (const scenario of scenarios) {
  const events = generateMatch(scenario, seed);
  const saved = createMatchPackage({scenario, seed, events}, {
    title: scenario + ' / Harbor coaching / seed 2026',
    notes: 'Original seeded source case for player coaching.',
    cursor: events.length,
    view,
    recap: {player: 'H10', period: 'all', outcome: 'all', observedCount: events.length, selectedSequenceId: null}
  });
  // These IDs identify this generated source case. Import assigns native archive IDs.
  documents.push({archive: {id: 'source-case-' + scenario, title: saved.review.title,
    revision: 1, canEdit: true, review: saved.review}, match: saved.match});
  const filename = scenario + '-2026.match.json';
  const body = JSON.stringify(saved, null, 2) + '\n';
  await writeFile(join(output, filename), body);
  fixtures.push({scenario, seed, filename, eventCount: events.length,
    fileSha256: createHash('sha256').update(body).digest('hex'),
    lastEvent: events.at(-1), lastAction: events.findLast(event => event.type !== 'clock')});
  for (const player of players) for (const period of ['all', 'first', 'second']) {
    const recap = buildPlayerRecap(events, {team, player, period, locale: 'en'});
    recaps.push({scenario, player, period, selectedStats: recap.selectedStats,
      teamStats: recap.teamStats, coverage: recap.coverage, sequences: recap.sequences});
  }
  if (scenario === 'high-press') for (const count of [631, 632, 633, 634, 635, 636, 637])
    for (const player of players) {
      const recap = buildPlayerRecap(events.slice(0, count), {team, player, period: 'all', locale: 'en'});
      cutoffs.push({count, player, selectedStats: recap.selectedStats,
        sequence: recap.sequences.find(item => item.id === 'e632') || null});
    }
}
const pooled = players.map(player => {
  const selected = recaps.filter(item => item.player === player && item.period === 'all');
  const sum = name => selected.reduce((total, item) => total + item.selectedStats[name], 0);
  const successful = selected.flatMap(item => item.sequences.filter(sequence => sequence.status === 'success'));
  return {player, actions: Object.fromEntries(['loss', 'pressure', 'regain', 'pass', 'shot'].map(type =>
    [type, selected.reduce((total, item) => total + item.selectedStats.actions[type], 0)])),
    sequenceInvolvements: sum('sequenceInvolvements'), successes: sum('successes'),
    expiredAttempts: sum('expiredAttempts'), notAttemptedWindows: sum('notAttemptedWindows'),
    pressNumerator: sum('pressFrequencyNumerator'), pressDenominator: sum('pressFrequencyDenominator'),
    resolvedNumerator: sum('regainEfficiencyNumerator'), resolvedDenominator: sum('regainEfficiencyDenominator'),
    recoverySeconds: successful.reduce((total, sequence) => total + sequence.secondsToRecover, 0)};
});
const sourceCase = {
  async open(id) {
    const document = documents.find(item => item.archive.id === id);
    if (!document) throw new Error('Unknown original source-case match');
    return document;
  }
};
const review = await createCoachComparison(sourceCase, {
  matches: documents.map(({archive, match}) => ({id: archive.id, count: match.events.length})),
  view, period: 'all', focus: {player: 'H10', outcome: 'all'},
  title: 'H10 / Four-match coaching review / seed 2026', export: true
}, 'source-case');
const bundleFile = 'player-coaching-four-matches-2026.json';
const briefFile = 'player-coaching-four-matches-2026.html';
await writeFile(join(output, bundleFile), JSON.stringify(review.bundle, null, 2) + '\n');
await writeFile(join(output, briefFile), playerCoachingHtml(review.coaching, {title: review.bundle.title}));
// Reopen every portable match through the exact original archive normalizers.
for (const item of review.bundle.matches) {
  const reopened = createMatchPackage(item.package.match, item.package.review);
  if (JSON.stringify(reopened) !== JSON.stringify(item.package)) throw new Error('Portable match changed during reopen');
}
const observation = {operation: 'COUNTERPRESS-675D-PLAYER-COACHING-20261012',
  sourcePins: actualPins, team, seed, players, fixtures, recaps, pooled, cutoffs,
  portable: {bundleFile, briefFile, selectedPlayer: review.coaching.focus.player,
    matches: review.coaching.matches.length, playlist: review.coaching.playlist.length,
    selectedStats: review.coaching.totals.selected}};
await writeFile(join(output, 'native-observations.json'), JSON.stringify(observation, null, 2) + '\n');
process.stdout.write(JSON.stringify({output, bundleFile, briefFile, fixtures, pooled, cutoffObservations: cutoffs.length}, null, 2) + '\n');
