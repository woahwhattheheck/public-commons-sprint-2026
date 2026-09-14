import { canonicalJson, sha256Hex } from './canonical.mjs';
import { assertGitHubActionsExpected, normalizeGitHubActionsEvidence } from './github_evidence_contract.mjs';

export function githubActionsEvidenceDigest(evidence) {
  return sha256Hex(normalizeGitHubActionsEvidence(evidence));
}

export function verifyGitHubActionsEvidence(evidence, expected) {
  const normalized = assertGitHubActionsExpected(evidence, expected);
  return {
    schema: 'workseal-evidence-verification/v1',
    verdict: 'PASS',
    evidenceDigest: sha256Hex(normalized),
    normalizedDigest: sha256Hex(canonicalJson(normalized)),
    repository: normalized.repository,
    workflowPath: normalized.workflowPath,
    headSha: normalized.headSha,
    runId: normalized.runId,
    attempt: normalized.attempt,
    writePerformed: false,
    externalAuthorityGranted: false,
  };
}

export function asWorkSealEvidence(evidence, expected, id = 'github-actions') {
  const verified = verifyGitHubActionsEvidence(evidence, expected);
  return { id, digest: verified.evidenceDigest };
}
