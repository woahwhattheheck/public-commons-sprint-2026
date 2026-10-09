// SPDX-License-Identifier: MIT
// Offline evidence audit for Swap.io comparison bounty. Does not fetch prices/trade or post.
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const MAX_BYTES = 80_000;
const MAX_SCREENSHOT_BYTES = 8_000_000;
const MIN_MINT_LEN = 32;
const MAX_MINT_LEN = 44;
const sponsor = 'swap.io';
const die = message => { throw new Error(message); };
const exactKeys = (value, required, optional = []) => {
  if (typeof value !== 'object' || !value || Array.isArray(value)) die('Expected a JSON object');
  for (const k of required) if (!(k in value)) die(`Missing ${k}`);
  for (const k of Object.keys(value)) if (![...required, ...optional].includes(k)) die(`Unexpected field: ${k}`);
};
const requireText = (value, label, max = 160) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\x00-\x1f]/.test(value)) die(`Invalid ${label}`);
  return value.trim();
};
const atoms = (v, name) => {
  if (typeof v !== 'string' || !/^[1-9][0-9]{0,28}$/.test(v)) die(`${name} must be positive decimal integer base units, not floats`);
  return BigInt(v);
};
const formatAtoms = (v, decimals) => {
  const sign = v < 0n ? '-' : '';
  const n = v < 0n ? -v : v;
  const units = 10n ** BigInt(decimals);
  const integer = n / units;
  const fraction = (n % units).toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${sign}${integer}${fraction ? `.${fraction}` : ''}`;
};
const basisPoints = (numerator, denominator) => {
  if (denominator <= 0n) die('Cannot compare against a zero baseline');
  const hundredthBps = numerator * 1_000_000n / denominator;
  const sign = hundredthBps < 0n ? '-' : '+';
  const magnitude = hundredthBps < 0n ? -hundredthBps : hundredthBps;
  return `${sign}${magnitude / 100n}.${(magnitude % 100n).toString().padStart(2, '0')}`;
};
const timestamp = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value)) die('Timestamp requires explicit UTC Z ISO8601 seconds');
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 19) !== value.slice(0, 19)) die('Timestamp is not valid Gregorian UTC date');
  return ms;
};
const decimal = (value, name) => {
  if (!Number.isInteger(value) || value < 0 || value > 12) die(`${name} must be an integer from 0 through 12`);
  return value;
};
const filepath = (base, relative) => {
  const name = requireText(relative, 'screenshot path', 230);
  if (name.startsWith('/') || name.includes('\\') || name.includes('\0')) die('Screenshot must be a relative path');
  const target = resolve(base, name);
  if (!target.startsWith(base + sep)) die('Screenshot path escapes evidence directory');
  return target;
};
const screenshot = async (root, name) => {
  const absolute = filepath(root, name);
  const data = await readFile(absolute);
  if (data.byteLength < 8 || data.byteLength > MAX_SCREENSHOT_BYTES) die(`Invalid screenshot file length: ${name}`);
  const isPng = data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  const isJpg = data[0] === 255 && data[1] === 216 && data[2] === 255;
  if (!isPng && !isJpg) die(`Screenshot must contain PNG or JPEG bytes: ${name}`);
  return { sha256: createHash('sha256').update(data).digest('hex'), format: isPng ? 'PNG' : 'JPEG', bytes: data.length };
};
const cleanVenue = v => requireText(v, 'venue', 70);
const normalize = v => v.trim().toLowerCase().replace(/\s+/g, '');
const sourceLabel = synthetic => synthetic ? '**SYNTHETIC FIXTURE — NOT ELIGIBLE COMPETITION EVIDENCE**' : '**USER-SUPPLIED SCREENSHOT CAPTURE — VISUAL CLAIMS NOT INDEPENDENTLY VERIFIED**';

export async function auditFile(file, { syntheticPreview = false, windowSeconds = 90 } = {}) {
  if (!Number.isInteger(windowSeconds) || windowSeconds < 1 || windowSeconds > 180) die('Window must be 1..180 seconds');
  const bytes = await readFile(file);
  if (bytes.length > MAX_BYTES) die('Evidence JSON exceeds 80 KiB');
  const raw = JSON.parse(bytes.toString('utf8'));
  exactKeys(raw, ['synthetic', 'cases'], ['notes']);
  if (typeof raw.synthetic !== 'boolean') die('synthetic must be true/false');
  if (raw.synthetic && !syntheticPreview) die('Synthetic samples are forbidden as live evidence; run --synthetic-preview for fixture only');
  if (!Array.isArray(raw.cases) || raw.cases.length === 0 || raw.cases.length > 20) die('Provide 1..20 cases');
  const root = resolve(dirname(file));
  const IDs = new Set();
  const screenshotNames = new Set();
  const summaries = [];
  for (const test of raw.cases) {
    exactKeys(test, ['id', 'inputMint', 'outputMint', 'inputSymbol', 'outputSymbol', 'inputDecimals', 'outputDecimals', 'inputAtoms', 'slippageBps', 'observations']);
    const id = requireText(test.id, 'case id', 60);
    if (!/^[A-Za-z0-9_-]+$/.test(id) || IDs.has(id)) die('Case ID must be unique ASCII identifier');
    IDs.add(id);
    const mint = v => {
      const m = requireText(v, 'mint', 44);
      if (m.length < MIN_MINT_LEN || m.length > MAX_MINT_LEN || !/^[1-9A-HJ-NP-Za-km-z]+$/.test(m)) die('Mint must be Solana base58 address');
      return m;
    };
    const inputMint = mint(test.inputMint), outputMint = mint(test.outputMint);
    if (inputMint === outputMint) die('Input and output mints must differ');
    const inputSymbol = requireText(test.inputSymbol, 'input symbol', 12), outputSymbol = requireText(test.outputSymbol, 'output symbol', 12);
    const inputDecimals = decimal(test.inputDecimals, 'inputDecimals');
    const outputDecimals = decimal(test.outputDecimals, 'outputDecimals');
    const inputAmount = atoms(test.inputAtoms, 'inputAtoms');
    if (!Number.isInteger(test.slippageBps) || test.slippageBps < 1 || test.slippageBps > 500) die('Use common slippageBps in [1,500]');
    if (!Array.isArray(test.observations) || test.observations.length < 3 || test.observations.length > 7) die('Case requires Swap.io + at least two other venues');
    const ven = new Set();
    const checked = [];
    for (const row of test.observations) {
      exactKeys(row, ['venue', 'capturedAt', 'quotedOutputAtoms', 'screenshot', 'route', 'quoteKind'], ['feeNote']);
      const venue = cleanVenue(row.venue), norm = normalize(venue);
      if (ven.has(norm)) die(`Duplicate venue in ${id}: ${venue}`);
      ven.add(norm);
      const capturedAt = timestamp(row.capturedAt);
      const output = atoms(row.quotedOutputAtoms, 'quotedOutputAtoms');
      const image = requireText(row.screenshot, 'screenshot', 230);
      if (screenshotNames.has(image)) die('Each observation requires its own screenshot');
      screenshotNames.add(image);
      const screenshotMeta = await screenshot(root, image);
      const route = requireText(row.route, 'route', 260);
      if (!['executable', 'indicative'].includes(row.quoteKind)) die('quoteKind must be executable or indicative');
      const feeNote = typeof row.feeNote === 'string' ? row.feeNote.trim() : 'Fees not independently established';
      if (feeNote.length > 220 || /[\x00-\x1f]/.test(feeNote)) die('Invalid fee note');
      checked.push({ venue, norm, capturedAt, iso:row.capturedAt, output, route, quoteKind:row.quoteKind, feeNote,
        screenshot:image, ...screenshotMeta });
    }
    if (!ven.has(sponsor)) die('Every case needs a Swap.io screenshot');
    const times = checked.map(v => v.capturedAt);
    const spreadMs = Math.max(...times) - Math.min(...times);
    if (spreadMs > windowSeconds * 1000) die(`Case ${id} violates ${windowSeconds}-second comparison window (${spreadMs}ms)`);
    const own = checked.find(v => v.norm === sponsor);
    const baseline = checked.filter(v => v.norm !== sponsor);
    const rows = checked.map(v => ({
      ...v, humanOutput:formatAtoms(v.output,outputDecimals),
      vsSwap: v.norm === sponsor ? 'reference' : basisPoints(own.output-v.output,v.output),
      deltaAtoms: v.norm === sponsor ? '0' : String(own.output-v.output)
    }));
    const low = baseline.reduce((a,b) => a.output > b.output ? b : a);
    const high = baseline.reduce((a,b) => a.output < b.output ? b : a);
    summaries.push({id,inputMint,outputMint,inputSymbol,outputSymbol,inputDecimals,outputDecimals,inputAtoms:inputAmount.toString(),slippageBps:test.slippageBps,
      inputHuman:formatAtoms(inputAmount,inputDecimals),spreadSeconds:(spreadMs/1000).toFixed(1),rows,
      bestAlternative:high.venue,worstAlternative:low.venue,
      bestAlternativeBps:basisPoints(own.output-high.output,high.output)});
  }
  const lines = [
    '# Swap.io comparative quote evidence audit', '',
    sourceLabel(raw.synthetic), '',
    `- Evidence file SHA-256: \`${createHash('sha256').update(bytes).digest('hex')}\``,
    `- Window guard: at most ${windowSeconds} seconds between observed quotes in each case`,
    `- ${summaries.length} comparable same-mint / same-size / same-slippage capture sets; one source screenshot per observation`,
    '- The source numbers below are operator transcriptions from image files, **not OCR-verified**; screenshot hashes prove file identity only.',
    '- Quotes are indicative pre-trade observations, not guaranteed execution prices, earned savings, or proof of a completed swap.',
    '- **Entry remains unverified:** original X post, Swap.io referral link, one actual wallet swap, tags, and Superteam submission must be verified separately.',
    '- **Fee caveat:** current official Swap.io homepage and swaps documentation disagree over platform-fee incidence. Check live quote detail and label all disclosed network/priority/LP/platform fees before comparing net amounts.',
    '',
    '## Reproducible cases', ''
  ];
  for (const item of summaries) {
    lines.push(`### ${item.id}: ${item.inputHuman} ${item.inputSymbol} → ${item.outputSymbol}`, '',
      `Input mint \`${item.inputMint}\`, output mint \`${item.outputMint}\`; decimals ${item.inputDecimals}/${item.outputDecimals}; slippage ${item.slippageBps}bps; window spread ${item.spreadSeconds}s.`, '',
      '| Venue | Quoted output | Swap.io versus venue (bps) | UTC time | Quote type | Image SHA-256 |', '|---|---:|---:|---|---|---|');
    for (const v of item.rows) {
      lines.push(`| ${v.venue.replaceAll('|','\\|')} | ${v.humanOutput} ${item.outputSymbol} | ${v.vsSwap} | ${v.iso} | ${v.quoteKind} | \`${v.sha256.slice(0,16)}…\` |`);
    }
    lines.push('',`Closest competitor by output: **${item.bestAlternative}**; the normalized observed output difference relative to this competitor is **${item.bestAlternativeBps} bps** (positive means higher Swap.io quoted output, negative means lower).`,`\nScreenshots and routed-venue disclosures:`,'');
    for(const v of item.rows){lines.push(`- **${v.venue}**: \`${v.screenshot}\` (${v.format}, ${v.bytes} bytes, SHA256 \`${v.sha256}\`); observed route: ${v.route}; fee note: ${v.feeNote}`);}
    lines.push('');
  }
  lines.push('## Original editorial / participation checklist','',
    '- [ ] Compare at least two token pairs and two sizes each, preserving losing as well as winning observations',
    '- [ ] Independently inspect every saved screenshot for exact pair, amount, output, timestamp, route and fee semantics',
    '- [ ] Confirm comparable swap directions, outputs and equivalent gas/priority costs; quote does not prove execution',
    '- [ ] Execute one genuine authorized Swap.io trade on the entrant wallet; independently verify transaction and sponsor account recognition',
    '- [ ] Obtain entrant-owned referral link; do not self-refer',
    '- [ ] Write ORIGINAL human-authored 5+ tweet thread or long post using screenshots and this source ledger; tag @swapdotio and @Superteam',
    '- [ ] Publish from eligible original X account and submit actual URL to Superteam by October 14, 2026',
    '- [ ] Save sponsor entry acknowledgment and any later sponsor selection/payment receipt separately',
    '', '## First-party sources','',
    '- Sponsor rules: https://superteam.fun/earn/listing/write-a-thread-or-long-post-price-comparison/',
    '- Product overview: https://swap.io/',
    '- Official homepage fee wording: https://docs.swap.io/welcome.md',
    '- Official swaps fees wording: https://docs.swap.io/swapping/swaps.md',
    '');
  return { report:lines.join('\n'), synthetic:raw.synthetic, cases:summaries.length, observations:summaries.reduce((s,i)=>s+i.rows.length,0), blockedExternal:true };
}

async function main(argv) {
  const input = argv[2];
  if (!input || argv.includes('--help')) {
    console.log('node audit.mjs CAPTURE.json --output REPORT.md [--window-seconds 90] [--synthetic-preview]');
    return;
  }
  const idx = argv.indexOf('--output');
  if(idx < 0 || !argv[idx+1]) die('Pass --output report.md');
  const widx = argv.indexOf('--window-seconds');
  const windowSeconds = widx<0?90:Number(argv[widx+1]);
  const result = await auditFile(resolve(input), { syntheticPreview:argv.includes('--synthetic-preview'),windowSeconds });
  await writeFile(resolve(argv[idx+1]), result.report, {flag:'wx',mode:0o600});
  console.log(JSON.stringify({status:result.synthetic?'SYNTHETIC_PREVIEW_NOT_ENTRY':'EVIDENCE_CAPTURED_ENTRY_UNVERIFIED',cases:result.cases,observations:result.observations,entrySubmitted:false,paymentReceived:false}));
}
if(process.argv[1] && fileURLToPath(import.meta.url)===resolve(process.argv[1])) {
  main(process.argv).catch(e=>{ console.error('BLOCKED:',e.message);process.exitCode=2; });
}