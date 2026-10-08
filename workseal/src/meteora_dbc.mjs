import { createHash } from 'node:crypto';

export const METEORA_DBC_PROGRAM_ID = 'dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN';
export const WRAPPED_SOL_MINT = 'So11111111111111111111111111111111111111112';
export const METEORA_SDK_PACKAGE = '@meteora-ag/dynamic-bonding-curve-sdk@1.5.11';

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const BASE58_MAP = new Map([...BASE58].map((character, index) => [character, BigInt(index)]));
const HEX_256 = /^[0-9a-f]{64}$/;
const ALLOWED_INPUT_KEYS = new Set([
  'name',
  'symbol',
  'description',
  'website',
  'creator',
  'feeClaimer',
  'leftoverReceiver',
  'quoteMint',
  'initialMarketCap',
  'migrationMarketCap',
  'totalTokenSupply',
]);

export class WorkSealMeteoraError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'WorkSealMeteoraError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new WorkSealMeteoraError(code, message);
}

function canonicalize(value, path = '$') {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) fail('BAD_NUMBER', `${path} must be a safe integer`);
    return value;
  }
  if (Array.isArray(value)) return value.map((entry, index) => canonicalize(entry, `${path}[${index}]`));
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] === undefined) fail('UNDEFINED_FIELD', `${path}.${key} is undefined`);
      out[key] = canonicalize(value[key], `${path}.${key}`);
    }
    return out;
  }
  fail('BAD_VALUE', `${path} contains an unsupported value`);
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function sha256Hex(value) {
  const bytes = typeof value === 'string' ? value : canonicalJson(value);
  return createHash('sha256').update(bytes).digest('hex');
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function nonEmptyString(value, name, maxLength) {
  if (typeof value !== 'string' || value.trim() !== value || value.length === 0 || value.length > maxLength) {
    fail('BAD_STRING', `${name} must be a non-empty trimmed string of at most ${maxLength} characters`);
  }
  return value;
}

function digest(value, name) {
  if (typeof value !== 'string' || !HEX_256.test(value)) fail('BAD_DIGEST', `${name} must be a lowercase sha256 hex digest`);
  return value;
}

function positiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) fail('BAD_INTEGER', `${name} must be a positive safe integer`);
  return value;
}

function decodeBase58(value) {
  let zeroes = 0;
  while (zeroes < value.length && value[zeroes] === '1') zeroes += 1;
  let number = 0n;
  for (const character of value) {
    const digit = BASE58_MAP.get(character);
    if (digit === undefined) fail('BAD_PUBKEY', 'Solana address contains a non-base58 character');
    number = number * 58n + digit;
  }
  const bytes = [];
  while (number > 0n) {
    bytes.push(Number(number % 256n));
    number /= 256n;
  }
  return Buffer.concat([Buffer.alloc(zeroes), Buffer.from(bytes.reverse())]);
}

function pubkey(value, name) {
  nonEmptyString(value, name, 64);
  if (decodeBase58(value).length !== 32) fail('BAD_PUBKEY', `${name} must decode to exactly 32 bytes`);
  return value;
}

function httpsUrl(value, name) {
  nonEmptyString(value, name, 500);
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail('BAD_URL', `${name} must be an absolute HTTPS URL`);
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) fail('BAD_URL', `${name} must be an HTTPS URL without embedded credentials`);
  return parsed.toString();
}

function assertVerifiedWorkSeal(verified) {
  if (!verified || typeof verified !== 'object' || Array.isArray(verified)) fail('BAD_VERIFICATION', 'verifiedWorkSeal must be the result of verifyBrowserBundle');
  if (verified.verdict !== 'PASS') fail('WORKSEAL_NOT_ACCEPTED', 'WorkSeal verification must have verdict PASS');
  if (verified.writePerformed !== false || verified.externalAuthorityGranted !== false) {
    fail('UNSAFE_VERIFICATION', 'verification must be read-only and grant no external authority');
  }
  return {
    taskDigest: digest(verified.taskDigest, 'verifiedWorkSeal.taskDigest'),
    resultDigest: digest(verified.resultDigest, 'verifiedWorkSeal.resultDigest'),
    evidenceDigest: digest(verified.evidenceDigest, 'verifiedWorkSeal.evidenceDigest'),
    acceptanceDigest: digest(verified.acceptanceDigest, 'verifiedWorkSeal.acceptanceDigest'),
    settlementIntentDigest: digest(verified.settlementIntentDigest, 'verifiedWorkSeal.settlementIntentDigest'),
  };
}

function normalizeInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('BAD_INPUT', 'input must be an object');
  const extras = Object.keys(input).filter((key) => !ALLOWED_INPUT_KEYS.has(key));
  if (extras.length) fail('UNKNOWN_FIELD', `input has unknown field(s): ${extras.sort().join(', ')}`);

  const symbol = nonEmptyString(input.symbol, 'input.symbol', 10);
  if (!/^[A-Z][A-Z0-9]{1,9}$/.test(symbol)) fail('BAD_SYMBOL', 'input.symbol must be 2-10 uppercase alphanumeric characters');
  const initialMarketCap = positiveInteger(input.initialMarketCap ?? 20, 'input.initialMarketCap');
  const migrationMarketCap = positiveInteger(input.migrationMarketCap ?? 600, 'input.migrationMarketCap');
  if (migrationMarketCap <= initialMarketCap) fail('BAD_CURVE', 'migrationMarketCap must be greater than initialMarketCap');

  return {
    name: nonEmptyString(input.name, 'input.name', 32),
    symbol,
    description: nonEmptyString(input.description, 'input.description', 500),
    website: httpsUrl(input.website, 'input.website'),
    creator: pubkey(input.creator, 'input.creator'),
    feeClaimer: pubkey(input.feeClaimer, 'input.feeClaimer'),
    leftoverReceiver: pubkey(input.leftoverReceiver, 'input.leftoverReceiver'),
    quoteMint: pubkey(input.quoteMint ?? WRAPPED_SOL_MINT, 'input.quoteMint'),
    initialMarketCap,
    migrationMarketCap,
    totalTokenSupply: positiveInteger(input.totalTokenSupply ?? 1_000_000_000, 'input.totalTokenSupply'),
  };
}

/**
 * Convert a verified WorkSeal acceptance into a deterministic, devnet-only Meteora
 * Invent configuration packet. The packet is intentionally unsigned and never
 * opens an RPC connection; a human operator must review the official Studio dry
 * run before any config or pool transaction is signed.
 */
export function buildMeteoraDbcLaunchPlan(verifiedWorkSeal, rawInput) {
  const binding = assertVerifiedWorkSeal(verifiedWorkSeal);
  const input = normalizeInput(rawInput);
  const workSealTag = `WorkSeal accepted result ${binding.resultDigest.slice(0, 12)}; acceptance ${binding.acceptanceDigest.slice(0, 12)}.`;

  const body = {
    schema: 'workseal-meteora-dbc-launch-plan/v1',
    provider: {
      name: 'Meteora Dynamic Bonding Curve',
      programId: METEORA_DBC_PROGRAM_ID,
      sdkPackage: METEORA_SDK_PACKAGE,
      studioSource: 'https://github.com/MeteoraAg/meteora-invent',
      generatedFromTemplateGitBlob: '72c3f5dd638fc3c8d21b15c5ddfde3c68f84a8f9',
    },
    workSealBinding: binding,
    studioConfig: {
      rpcUrl: 'https://api.devnet.solana.com',
      dryRun: true,
      keypairFilePath: 'OWNER_MUST_SET_LOCAL_KEYPAIR_PATH',
      computeUnitPriceMicroLamports: 100_000,
      quoteMint: input.quoteMint,
      dbcConfig: {
        buildCurveMode: 1,
        initialMarketCap: input.initialMarketCap,
        migrationMarketCap: input.migrationMarketCap,
        token: {
          totalTokenSupply: input.totalTokenSupply,
          tokenBaseDecimal: 6,
          tokenQuoteDecimal: 9,
          tokenType: 0,
          tokenAuthorityOption: 1,
          leftover: 0,
        },
        fee: {
          baseFeeParams: {
            baseFeeMode: 0,
            feeSchedulerParam: { startingFeeBps: 100, endingFeeBps: 100, numberOfPeriod: 0, totalDuration: 0 },
          },
          dynamicFeeEnabled: true,
          collectFeeMode: 0,
          creatorTradingFeePercentage: 50,
          poolCreationFee: 0,
          enableFirstSwapWithMinFee: false,
        },
        migration: {
          migrationOption: 1,
          migrationFeeOption: 3,
          migrationFee: { feePercentage: 0, creatorFeePercentage: 0 },
        },
        liquidityDistribution: {
          partnerLiquidityPercentage: 45,
          creatorLiquidityPercentage: 45,
          partnerPermanentLockedLiquidityPercentage: 5,
          creatorPermanentLockedLiquidityPercentage: 5,
        },
        lockedVesting: {
          totalLockedVestingAmount: 0,
          numberOfVestingPeriod: 0,
          cliffUnlockAmount: 0,
          totalVestingDuration: 0,
          cliffDurationFromMigrationTime: 0,
        },
        activationType: 1,
        leftoverReceiver: input.leftoverReceiver,
        feeClaimer: input.feeClaimer,
      },
      dbcPool: {
        creator: input.creator,
        name: input.name,
        symbol: input.symbol,
        metadata: {
          description: `${input.description}\n\n${workSealTag}`,
          website: input.website,
        },
      },
    },
    execution: {
      commandSequence: ['pnpm studio dbc-create-config', 'pnpm studio dbc-create-pool --config <CONFIG_KEY>'],
      network: 'devnet',
      dryRunRequiredFirst: true,
      readyForExecution: false,
      writePerformed: false,
      unsigned: true,
      ownerConfirmationRequired: true,
      requiredHumanGates: [
        'Confirm the current Colosseum product and Superteam side-track are eligible.',
        'Disclose all pre-existing WorkSeal development in the Colosseum submission.',
        'Set a local keypair path outside source control and inspect the official Meteora Invent dry run.',
        'Approve any devnet transaction separately; mainnet is outside this plan.',
      ],
    },
    externalState: {
      colosseumRegistration: 'NOT_ASSERTED',
      colosseumSubmission: 'NOT_ASSERTED',
      superteamSubmission: 'NOT_ASSERTED',
      award: 'NOT_ASSERTED',
      payment: 'NOT_ASSERTED',
    },
  };

  return deepFreeze({ ...body, planDigest: sha256Hex(body) });
}
