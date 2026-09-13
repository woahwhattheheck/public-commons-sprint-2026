import { isSha256Hex, sha256Hex } from './canonical.mjs';

const VERSION = 'agent-revenue-rail/release-evidence/v1';
const SHA40 = /^[0-9a-f]{40}$/;
const HEDERA_NETWORK = 'hedera:testnet';
const HBAR_ASSET = '0.0.0';
const PLACEHOLDER_PATTERNS = [/replace[-_ ]?me/i, /example\.invalid/i, /demo[-_ ]?user/i, /live[-_ ]?testnet[-_ ]?hash/i, /placeholder/i];
const TOKEN_PREFIXES = [['s','k'].join(''), ['r','k'].join('')];
const AUTH_SCHEME = ['Bea','rer'].join('');
const SENSITIVE_LABELS = ['api_key','api-key','apikey','secret','private_key','private-key','privatekey','access_token','access-token','accesstoken'];

function looksSecretShaped(value) {
  const lower = value.toLowerCase();
  if (lower.includes('-----begin ') && lower.includes(['private',' key-----'].join(''))) return true;
  for (const prefix of TOKEN_PREFIXES) {
    const tokenPattern = new RegExp(`\\b${prefix}-[A-Za-z0-9_-]{12,}\\b`);
    if (tokenPattern.test(value)) return true;
  }
  const authPattern = new RegExp(`\\b${AUTH_SCHEME}\\s+[A-Za-z0-9._~+/=-]{12,}`, 'i');
  if (authPattern.test(value)) return true;
  const normalized = lower.replace(/\s+/g, '');
  for (const label of SENSITIVE_LABELS) {
    if (normalized.includes(`${label}=`) || normalized.includes(`${label}:`)) return true;
  }
  return false;
}

function exact(value, required, optional = [], label = 'object') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  const allowed = new Set([...required, ...optional]);
  for (const key of required) if (!(key in value)) throw new TypeError(`${label}.${key} is required`);
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new TypeError(`${label}.${key} is unknown`);
}

function instant(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) throw new TypeError(`${label} must be canonical UTC milliseconds`);
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || new Date(ms).toISOString() !== value) throw new TypeError(`${label} is invalid`);
  return ms;
}

function httpsUrl(value, label) {
  if (typeof value !== 'string') throw new TypeError(`${label} must be a string`);
  let url;
  try { url = new URL(value); } catch { throw new TypeError(`${label} must be an absolute URL`); }
  if (url.protocol !== 'https:') throw new TypeError(`${label} must use https`);
  if (url.username || url.password) throw new TypeError(`${label} must not include credentials`);
  return url.toString();
}

function containsPlaceholder(value) {
  if (typeof value === 'string') return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(value));
  if (Array.isArray(value)) return value.some(containsPlaceholder);
  if (value && typeof value === 'object') return Object.values(value).some(containsPlaceholder);
  return false;
}

function noSecrets(value, path = 'evidence') {
  if (typeof value === 'string') {
    if (looksSecretShaped(value)) throw new TypeError(`${path} contains secret-shaped material`);
    return;
  }
  if (Array.isArray(value)) return value.forEach((entry, i) => noSecrets(entry, `${path}[${i}]`));
  if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) noSecrets(child, `${path}.${key}`);
}

function digest(value, label) { if (!isSha256Hex(value)) throw new TypeError(`${label} must be sha256 hex`); }
function nonempty(value, label) { if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${label} is required`); }

export function evaluateReleaseEvidence(input, { asOf } = {}) {
  exact(input, ['version','sourceHead','repoUrl','deployUrl','offerDigest','bazantic','graph','hedera','ab','videoUrl'], [], 'releaseEvidence');
  if (input.version !== VERSION) throw new TypeError(`releaseEvidence.version must be ${VERSION}`);
  noSecrets(input);
  const nowMs = instant(asOf, 'asOf');
  if (!SHA40.test(input.sourceHead)) throw new TypeError('releaseEvidence.sourceHead must be a 40-char lowercase git SHA');
  httpsUrl(input.repoUrl, 'releaseEvidence.repoUrl');
  httpsUrl(input.deployUrl, 'releaseEvidence.deployUrl');
  httpsUrl(input.videoUrl, 'releaseEvidence.videoUrl');
  digest(input.offerDigest, 'releaseEvidence.offerDigest');

  exact(input.bazantic, ['accountHandle','recipeId','recipeEvidenceDigest','capturedAt'], [], 'releaseEvidence.bazantic');
  nonempty(input.bazantic.accountHandle, 'releaseEvidence.bazantic.accountHandle');
  nonempty(input.bazantic.recipeId, 'releaseEvidence.bazantic.recipeId');
  digest(input.bazantic.recipeEvidenceDigest, 'releaseEvidence.bazantic.recipeEvidenceDigest');

  exact(input.graph, ['providerAgentId','network','liveQueryEvidenceDigest','capturedAt'], [], 'releaseEvidence.graph');
  nonempty(input.graph.providerAgentId, 'releaseEvidence.graph.providerAgentId');
  nonempty(input.graph.network, 'releaseEvidence.graph.network');
  digest(input.graph.liveQueryEvidenceDigest, 'releaseEvidence.graph.liveQueryEvidenceDigest');

  exact(input.hedera, ['network','asset','txHash','settlementEvidenceDigest','capturedAt'], [], 'releaseEvidence.hedera');
  if (input.hedera.network !== HEDERA_NETWORK) throw new TypeError(`releaseEvidence.hedera.network must be ${HEDERA_NETWORK}`);
  if (input.hedera.asset !== HBAR_ASSET) throw new TypeError(`releaseEvidence.hedera.asset must be ${HBAR_ASSET}`);
  nonempty(input.hedera.txHash, 'releaseEvidence.hedera.txHash');
  digest(input.hedera.settlementEvidenceDigest, 'releaseEvidence.hedera.settlementEvidenceDigest');

  exact(input.ab, ['baselineCaptureDigest','recipeCaptureDigest','verificationDigest','meaningfulImprovement','capturedAt'], [], 'releaseEvidence.ab');
  digest(input.ab.baselineCaptureDigest, 'releaseEvidence.ab.baselineCaptureDigest');
  digest(input.ab.recipeCaptureDigest, 'releaseEvidence.ab.recipeCaptureDigest');
  digest(input.ab.verificationDigest, 'releaseEvidence.ab.verificationDigest');
  if (typeof input.ab.meaningfulImprovement !== 'boolean') throw new TypeError('releaseEvidence.ab.meaningfulImprovement must be boolean');

  const timestamps = [
    ['bazantic', input.bazantic.capturedAt],
    ['graph', input.graph.capturedAt],
    ['hedera', input.hedera.capturedAt],
    ['ab', input.ab.capturedAt],
  ];
  for (const [label, value] of timestamps) if (instant(value, `releaseEvidence.${label}.capturedAt`) > nowMs) throw new TypeError(`releaseEvidence.${label}.capturedAt is from the future`);

  const holds = [];
  if (containsPlaceholder(input)) holds.push('PLACEHOLDER_EVIDENCE_PRESENT');
  if (!input.repoUrl.startsWith('https://github.com/')) holds.push('PUBLIC_GITHUB_REPO_REQUIRED');
  if (!input.ab.meaningfulImprovement) holds.push('BAZANTIC_AB_IMPROVEMENT_NOT_DEMONSTRATED');
  if (input.graph.network === HEDERA_NETWORK) holds.push('GRAPH_PROVIDER_NETWORK_MUST_BE_DEPLOYED_SUBGRAPH_NETWORK');

  const evidenceCore = { ...input, submissionAuthority: false, prizeEligibilityAuthority: false, paymentAuthority: false };
  const evidenceDigest = sha256Hex(evidenceCore);
  return {
    version: 'agent-revenue-rail/release-gate-result/v1',
    state: holds.length === 0 ? 'READY_FOR_HUMAN_SUBMISSION_REVIEW' : 'HOLD',
    holds,
    evidenceDigest,
    submissionAuthority: false,
    prizeEligibilityAuthority: false,
    paymentAuthority: false,
  };
}

export const RELEASE_EVIDENCE_VERSION = VERSION;
