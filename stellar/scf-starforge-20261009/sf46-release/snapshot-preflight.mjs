// MIT. Additive, source-pinned SF46 release review. No payment, RPC or network side effects.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HISTORIC = new URL('./pins.json', import.meta.url);
const SNAPSHOT = new URL('./snapshots/20261010-a84c5619.json', import.meta.url);
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SHA = /^[a-f0-9]{40}$/;

/** Compare accepted pinned API contracts, never infer behavior from a hash. */
export function compareSourcePins(historical, snapshot) {
  if (historical?.schema !== 'stellar-forge.release-pins.v1' ||
      snapshot?.schema !== historical.schema ||
      !SHA.test(snapshot.baseline_commit ?? '') ||
      !Array.isArray(historical.sources) || !Array.isArray(snapshot.sources) ||
      historical.sources.length !== snapshot.sources.length || snapshot.sources.length < 8) {
    throw new TypeError('Incomplete or mismatched SF46 source snapshots');
  }
  const prior = new Map();
  for (const source of historical.sources) {
    if (!source?.id || prior.has(source.id)) throw new TypeError('Duplicate historical source ID');
    prior.set(source.id, source);
  }
  const observed = new Set();
  const changes = snapshot.sources.map(source => {
    const old = prior.get(source?.id);
    if (!old || observed.has(source.id) || source.path !== old.path ||
        !SHA.test(source.sha ?? '') || !SHA.test(old.sha ?? '') ||
        JSON.stringify(source.exports) !== JSON.stringify(old.exports)) {
      throw new TypeError('Source identity, path, API or SHA changed unexpectedly');
    }
    observed.add(source.id);
    return { id: source.id, path: source.path, oldGitBlob: old.sha,
      frozenGitBlob: source.sha, changed: source.sha !== old.sha };
  });
  return { frozenCommit: snapshot.baseline_commit, sourceCount: changes.length,
    changedCount: changes.filter(x => x.changed).length, changes };
}

/** Assess EXACT installed source under frozen commit, not the live network. */
export async function assessSnapshot({ root = ROOT } = {}) {
  const [historical, snapshot] = await Promise.all([HISTORIC, SNAPSHOT].map(async u => JSON.parse(await readFile(u, 'utf8'))));
  const delta = compareSourcePins(historical, snapshot);
  // Lazy load: the pure manifest comparison is independently inspectable.
  const { assessRelease } = await import('./preflight.mjs');
  const report = await assessRelease({ root: resolve(root), strictPins: true, manifestPath: SNAPSHOT });
  return { schema: 'stellar-forge.postmerge-release-snapshot.v1', snapshotCommit: delta.frozenCommit,
    installedSourceIsExactSnapshot: report.sources.every(x => x.status === 'PIN_MATCH'),
    delta, report };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const valid = args.length === 0 || (args.length === 2 && args[0] === '--root' && args[1] && !args[1].startsWith('-'));
  if (!valid) {
    process.stderr.write('Usage: node snapshot-preflight.mjs [--root <frozen-checkout-directory>]\n');
    process.exitCode = 2;
  } else {
    assessSnapshot({ root: args[1] ?? ROOT }).then(output => {
      process.stdout.write(JSON.stringify(output, null, 2) + '\n');
      if (output.report.failures.length || !output.installedSourceIsExactSnapshot) process.exitCode = 1;
    }).catch(error => {
      process.stderr.write(String(error?.stack ?? error) + '\n');
      process.exitCode = 1;
    });
  }
}
