import { isGitSha } from './canonical.mjs';
import { exact, normalizeHttpsUrl, parseInstant, sha } from './recipe-authority.mjs';
import { HBAR_ASSET, HEDERA_NETWORK, RELEASE_EVIDENCE_VERSION } from './release-constants.mjs';
import { noSecrets } from './release-safety.mjs';

function nonempty(value, label) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${label} is required`);
}

export function validateReleaseManifest(input) {
  exact(input, [
    'version', 'sourceHead', 'repoUrl', 'repoEvidenceDigest', 'deployUrl', 'deployEvidenceDigest',
    'offerDigest', 'bazantic', 'graph', 'hedera', 'ab', 'videoUrl', 'videoEvidenceDigest',
  ], [], 'releaseEvidence');
  if (input.version !== RELEASE_EVIDENCE_VERSION) throw new TypeError(`releaseEvidence.version must be ${RELEASE_EVIDENCE_VERSION}`);
  noSecrets(input);
  if (!isGitSha(input.sourceHead)) throw new TypeError('releaseEvidence.sourceHead must be a 40-char lowercase git SHA');
  normalizeHttpsUrl(input.repoUrl, 'releaseEvidence.repoUrl');
  normalizeHttpsUrl(input.deployUrl, 'releaseEvidence.deployUrl');
  normalizeHttpsUrl(input.videoUrl, 'releaseEvidence.videoUrl');
  for (const [key, value] of Object.entries({ repoEvidenceDigest: input.repoEvidenceDigest, deployEvidenceDigest: input.deployEvidenceDigest, offerDigest: input.offerDigest, videoEvidenceDigest: input.videoEvidenceDigest })) sha(value, `releaseEvidence.${key}`);

  exact(input.bazantic, ['accountHandle', 'recipeId', 'recipeEvidenceDigest', 'capturedAt'], [], 'releaseEvidence.bazantic');
  nonempty(input.bazantic.accountHandle, 'releaseEvidence.bazantic.accountHandle');
  nonempty(input.bazantic.recipeId, 'releaseEvidence.bazantic.recipeId');
  sha(input.bazantic.recipeEvidenceDigest, 'releaseEvidence.bazantic.recipeEvidenceDigest');
  parseInstant(input.bazantic.capturedAt, 'releaseEvidence.bazantic.capturedAt');

  exact(input.graph, ['providerAgentId', 'network', 'liveQueryEvidenceDigest', 'capturedAt'], [], 'releaseEvidence.graph');
  nonempty(input.graph.providerAgentId, 'releaseEvidence.graph.providerAgentId');
  nonempty(input.graph.network, 'releaseEvidence.graph.network');
  sha(input.graph.liveQueryEvidenceDigest, 'releaseEvidence.graph.liveQueryEvidenceDigest');
  parseInstant(input.graph.capturedAt, 'releaseEvidence.graph.capturedAt');

  exact(input.hedera, ['network', 'asset', 'txHash', 'settlementEvidenceDigest', 'capturedAt'], [], 'releaseEvidence.hedera');
  if (input.hedera.network !== HEDERA_NETWORK) throw new TypeError(`releaseEvidence.hedera.network must be ${HEDERA_NETWORK}`);
  if (input.hedera.asset !== HBAR_ASSET) throw new TypeError(`releaseEvidence.hedera.asset must be ${HBAR_ASSET}`);
  nonempty(input.hedera.txHash, 'releaseEvidence.hedera.txHash');
  sha(input.hedera.settlementEvidenceDigest, 'releaseEvidence.hedera.settlementEvidenceDigest');
  parseInstant(input.hedera.capturedAt, 'releaseEvidence.hedera.capturedAt');

  exact(input.ab, ['baselineCaptureDigest', 'recipeCaptureDigest', 'verificationDigest', 'meaningfulImprovement', 'capturedAt'], [], 'releaseEvidence.ab');
  for (const [key, value] of Object.entries({ baselineCaptureDigest: input.ab.baselineCaptureDigest, recipeCaptureDigest: input.ab.recipeCaptureDigest, verificationDigest: input.ab.verificationDigest })) sha(value, `releaseEvidence.ab.${key}`);
  if (typeof input.ab.meaningfulImprovement !== 'boolean') throw new TypeError('releaseEvidence.ab.meaningfulImprovement must be boolean');
  parseInstant(input.ab.capturedAt, 'releaseEvidence.ab.capturedAt');
}
