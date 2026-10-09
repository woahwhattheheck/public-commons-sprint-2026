/** Offline difference between two separately captured WorkSeal manifests. Never authorizes settlement. */
import { artifactManifestDigest, normalizeArtifactManifest } from './artifact_manifest.mjs';

export const ARTIFACT_DELTA_SCHEMA = 'workseal-artifact-delta/v1';

function fileIdentity(file) {
  return { bytes: file.bytes, sha256: file.sha256 };
}

/**
 * This compares DECLARATIONS, not the underlying bytes. The operator must acquire
 * the observed manifest from immutable verifier-controlled files independently.
 * A MATCH here cannot replace verifyArtifactDelivery or a signed acceptance.
 */
export function compareArtifactManifests(expectedInput, observedInput) {
  const expected = normalizeArtifactManifest(expectedInput);
  const observed = normalizeArtifactManifest(observedInput);
  const expectedByPath = new Map(expected.files.map(file => [file.path, file]));
  const observedByPath = new Map(observed.files.map(file => [file.path, file]));
  const paths = [...new Set([...expectedByPath.keys(), ...observedByPath.keys()])].sort();
  const changes = [];
  const totals = { matched: 0, changed: 0, missing: 0, unexpected: 0 };
  for (const path of paths) {
    const oldFile = expectedByPath.get(path);
    const newFile = observedByPath.get(path);
    if (!oldFile) {
      changes.push({ path, kind: 'UNEXPECTED', observed: fileIdentity(newFile) });
      totals.unexpected += 1;
    } else if (!newFile) {
      changes.push({ path, kind: 'MISSING', expected: fileIdentity(oldFile) });
      totals.missing += 1;
    } else if (oldFile.sha256 !== newFile.sha256 || oldFile.bytes !== newFile.bytes) {
      changes.push({ path, kind: 'CHANGED', expected: fileIdentity(oldFile), observed: fileIdentity(newFile) });
      totals.changed += 1;
    } else {
      totals.matched += 1;
    }
  }
  const same = changes.length === 0;
  return {
    schema: ARTIFACT_DELTA_SCHEMA,
    comparison: same ? 'SAME_DECLARATION' : 'DIFFERENT_DECLARATION',
    expected: {
      manifestSha256: artifactManifestDigest(expected),
      files: expected.files.length,
      totalBytes: expected.files.reduce((sum, f) => sum + f.bytes, 0),
    },
    observed: {
      manifestSha256: artifactManifestDigest(observed),
      files: observed.files.length,
      totalBytes: observed.files.reduce((sum, f) => sum + f.bytes, 0),
    },
    totals,
    changes,
    authority: {
      observedBytesIndependentlyVerified: false,
      acceptanceEvaluated: false,
      settlementAuthorized: false,
      writePerformed: false,
    },
  };
}

export function artifactDeltaMarkdown(delta) {
  if (!delta || delta.schema !== ARTIFACT_DELTA_SCHEMA ||
      !Array.isArray(delta.changes) || !delta.totals || !delta.authority) {
    throw new TypeError('Expected a WorkSeal artifact delta result');
  }
  const lines = [
    '# WorkSeal artifact declaration comparison',
    '',
    '**Comparison:** ' + delta.comparison,
    '**Expected manifest SHA-256:** `' + delta.expected.manifestSha256 + '`',
    '**Observed manifest SHA-256:** `' + delta.observed.manifestSha256 + '`',
    '**Matched / changed / missing / unexpected:** ' +
      [delta.totals.matched, delta.totals.changed, delta.totals.missing, delta.totals.unexpected].join(' / '),
    '',
    '| File | Difference | Expected bytes | Observed bytes | Expected SHA-256 | Observed SHA-256 |',
    '| --- | --- | ---: | ---: | --- | --- |',
  ];
  for (const item of delta.changes) {
    lines.push([
      '`' + item.path + '`', item.kind, item.expected?.bytes ?? '—', item.observed?.bytes ?? '—',
      item.expected?.sha256 ? '`' + item.expected.sha256 + '`' : '—',
      item.observed?.sha256 ? '`' + item.observed.sha256 + '`' : '—',
    ].join(' | ').replace(/^/, '| ').concat(' |'));
  }
  if (delta.changes.length === 0) lines.push('| (none) | — | — | — | — | — |');
  lines.push(
    '',
    '> Evidence boundary: this compares two manifest declarations only. The observed',
    '> manifest must be independently captured from immutable verifier-controlled bytes.',
    '> Even SAME_DECLARATION is not a WorkSeal acceptance, chain settlement, or payment.',
  );
  return lines.join('\n') + '\n';
}
