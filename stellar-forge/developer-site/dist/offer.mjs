export const exampleOffer = {
  x402Version: 2,
  resource: { url: 'https://seller.example/dataset', description: 'Illustrative dataset endpoint', mimeType: 'application/json' },
  accepts: [{ scheme: 'exact', network: 'stellar:testnet', amount: '10000', asset: 'NONPAYABLE_DEMO_ASSET', payTo: 'INVALID_DEMO_RECIPIENT_NOT_A_WALLET', maxTimeoutSeconds: 60 }]
};

export function parseOffer(input) {
  if (typeof input !== 'string' || !input.trim()) throw new Error('Paste a PAYMENT-REQUIRED header or an x402 JSON response.');
  if (new TextEncoder().encode(input).length > 131072) throw new Error('This inspector accepts up to 128 KiB of text.');
  let raw = input.trim().replace(/^payment-required\s*:\s*/i, '').trim();
  let encoding = 'JSON';
  if (!raw.startsWith('{')) {
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(raw) || raw.length % 4 === 1) throw new Error('Use a single Base64 header value or a JSON object.');
    try {
      raw = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(raw), c => c.charCodeAt(0)));
      encoding = 'Base64 → JSON';
    } catch { throw new Error('The header could not be decoded as Base64 UTF-8 JSON.'); }
  }
  let offer;
  try { offer = JSON.parse(raw); } catch { throw new Error('The decoded text is not valid JSON. Check that the complete header or body was copied.'); }
  if (!offer || Array.isArray(offer) || typeof offer !== 'object') throw new Error('Expected an x402 PaymentRequired JSON object.');
  if (!Array.isArray(offer.accepts) || offer.accepts.length === 0) throw new Error('No payment choices found. The response must contain a nonempty accepts array.');
  if (offer.accepts.length > 100) throw new Error('This inspector displays at most 100 payment choices.');
  if (offer.accepts.some(o => !o || Array.isArray(o) || typeof o !== 'object')) throw new Error('Each accepts entry must be a payment-choice object.');
  const warnings = [];
  if (offer.x402Version !== 2) warnings.push('This is not explicitly an x402 v2 envelope.');
  if (!offer.resource || typeof offer.resource.url !== 'string') warnings.push('The response does not declare a resource URL.');
  else {
    try {
      const url = new URL(offer.resource.url);
      if (url.protocol !== 'https:') warnings.push('The advertised resource does not use HTTPS.');
      if (url.username || url.password) warnings.push('The advertised URL contains credentials. Do not follow or share it.');
    } catch { warnings.push('The advertised resource URL is not a valid absolute URL.'); }
  }
  offer.accepts.forEach((choice, i) => {
    const label = `Option ${i + 1}: `;
    for (const key of ['scheme', 'network', 'asset', 'payTo']) {
      if (typeof choice[key] !== 'string' || !choice[key]) warnings.push(label + `missing a text ${key} value.`);
    }
    if (choice.scheme !== 'exact') warnings.push(label + 'the Stellar Forge seller path described here uses the exact scheme.');
    if (typeof choice.network === 'string' && !choice.network.startsWith('stellar:')) warnings.push(label + 'the advertised network is not a Stellar network.');
    if (typeof choice.amount !== 'string' || !/^[1-9][0-9]*$/.test(choice.amount)) warnings.push(label + 'amount must be a positive integer string in atomic units.');
    else if (choice.amount.length > 39 || BigInt(choice.amount) > 170141183460469231731687303715884105727n) warnings.push(label + 'amount exceeds the Stellar seller compiler’s signed i128 range.');
    if (!Number.isInteger(choice.maxTimeoutSeconds) || choice.maxTimeoutSeconds <= 0) warnings.push(label + 'maxTimeoutSeconds must be a positive integer.');
    if (['asset', 'payTo'].some(k => typeof choice[k] === 'string' && /DEMO|REPLACE_|INVALID_|ACTUAL_/i.test(choice[k]))) warnings.push(label + 'contains illustrative, nonpayable asset or recipient markers.');
  });
  return { offer, encoding, warnings };
}

export function headerValue(offer) {
  const bytes = new TextEncoder().encode(JSON.stringify(offer));
  return btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(''));
}

export function shown(value) {
  if (value === undefined || value === null) return 'Not declared';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
