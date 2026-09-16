import { D, G } from './runtime-helpers.mjs';

export function releaseManifest() {
  return {
    version: 'agent-revenue-rail/release-evidence/v2', sourceHead: G('d'),
    repoUrl: 'https://github.com/woahwhattheheck/agent-revenue-rail', repoEvidenceDigest: D('1'),
    deployUrl: 'https://rail.example.test', deployEvidenceDigest: D('2'), offerDigest: D('3'),
    bazantic: { accountHandle: 'tjlabs', recipeId: 'recipe-123', recipeEvidenceDigest: D('4'), capturedAt: '2026-09-15T20:50:00.000Z' },
    graph: { providerAgentId: '8453:123', network: 'base', liveQueryEvidenceDigest: D('5'), capturedAt: '2026-09-15T20:51:00.000Z' },
    hedera: { network: 'hedera:testnet', asset: '0.0.0', txHash: '0.0.4242@1789505500.123456789', settlementEvidenceDigest: D('6'), capturedAt: '2026-09-15T20:52:00.000Z' },
    ab: { baselineCaptureDigest: D('7'), recipeCaptureDigest: D('8'), verificationDigest: D('9'), meaningfulImprovement: true, capturedAt: '2026-09-15T20:53:00.000Z' },
    videoUrl: 'https://www.youtube.com/watch?v=abcdefghijk', videoEvidenceDigest: D('e'),
  };
}
