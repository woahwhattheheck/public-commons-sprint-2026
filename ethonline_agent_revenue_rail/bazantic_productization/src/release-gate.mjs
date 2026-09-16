import { sha256Hex } from './canonical.mjs';
import { HEDERA_NETWORK, RELEASE_EVIDENCE_VERSION } from './release-constants.mjs';
import { validateReleaseManifest } from './release-manifest.mjs';
import { containsPlaceholder } from './release-safety.mjs';

/** Manifest-only source carrier: no truthful READY path without provider APIs. */
export function evaluateReleaseEvidence(input) {
  if (arguments.length !== 1) throw new TypeError('self-authored release authority is not accepted; provider-integrated host verification is required');
  validateReleaseManifest(input);
  const holds = ['INDEPENDENT_PROVIDER_READBACK_REQUIRED'];
  if (containsPlaceholder(input)) holds.push('PLACEHOLDER_EVIDENCE_PRESENT');
  if (!input.repoUrl.startsWith('https://github.com/')) holds.push('PUBLIC_GITHUB_REPO_REQUIRED');
  if (!input.ab.meaningfulImprovement) holds.push('BAZANTIC_AB_IMPROVEMENT_NOT_DEMONSTRATED');
  if (input.graph.network === HEDERA_NETWORK) holds.push('GRAPH_PROVIDER_NETWORK_MUST_BE_DEPLOYED_SUBGRAPH_NETWORK');
  const evidenceCore = {
    ...input,
    authorityBindingDigest: null,
    submissionAuthority: false,
    prizeEligibilityAuthority: false,
    paymentAuthority: false,
  };
  return {
    version: 'agent-revenue-rail/release-gate-result/v2',
    state: 'HOLD',
    holds: [...new Set(holds)].sort(),
    authorityBindingDigest: null,
    evidenceDigest: sha256Hex(evidenceCore),
    submissionAuthority: false,
    prizeEligibilityAuthority: false,
    paymentAuthority: false,
  };
}

export { RELEASE_EVIDENCE_VERSION };
