import { sha256Hex } from './canonical.mjs';
import { atomicBigInt, normalizeAtomicInteger } from './atomic.mjs';

const TINYBAR_PER_HBAR = 100_000_000n;
const NETWORK = 'hedera:testnet';
const ASSET = '0.0.0';

function assertExactObject(value, required, optional = [], label = 'object') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  const allowed = new Set([...required, ...optional]);
  for (const key of required) if (!(key in value)) throw new TypeError(`${label}.${key} is required`);
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new TypeError(`${label}.${key} is unknown`);
}

export function formatHbarFromTinybar(amountTinybar) {
  const amount = atomicBigInt(amountTinybar, 'amountTinybar');
  const whole = amount / TINYBAR_PER_HBAR;
  const fraction = amount % TINYBAR_PER_HBAR;
  if (fraction === 0n) return whole.toString();
  return `${whole}.${fraction.toString().padStart(8, '0').replace(/0+$/, '')}`;
}

export function buildPublicOffer(input) {
  assertExactObject(input, ['serviceId', 'amountTinybar'], ['description'], 'offerInput');
  if (typeof input.serviceId !== 'string' || !/^[a-z0-9][a-z0-9._-]{2,79}$/.test(input.serviceId)) throw new TypeError('offerInput.serviceId is invalid');
  const amountTinybar = normalizeAtomicInteger(input.amountTinybar, 'offerInput.amountTinybar');
  if (input.description !== undefined && (typeof input.description !== 'string' || input.description.trim() === '')) throw new TypeError('offerInput.description must be non-empty when supplied');
  const core = {
    version: 'agent-revenue-rail/public-offer/v1',
    serviceId: input.serviceId,
    network: NETWORK,
    asset: ASSET,
    amountTinybar,
    amountHbar: formatHbarFromTinybar(amountTinybar),
    description: input.description ?? null,
    paymentAuthority: false,
    settlementAuthority: false,
  };
  return { ...core, offerDigest: sha256Hex(core) };
}

export const OFFER_CONSTANTS = Object.freeze({ TINYBAR_PER_HBAR: TINYBAR_PER_HBAR.toString(), NETWORK, ASSET });
