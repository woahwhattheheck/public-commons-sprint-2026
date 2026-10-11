#!/usr/bin/env node
// MIT. Local operator-owned file input only. Never invent seller policy from a listing.
import { readFile } from 'node:fs/promises';
import { DurableCatalogTransaction } from '../sf60-durable-catalog-transaction/journal.mjs';
import { admitPinnedSeller } from './admit.mjs';

const allowed = new Set(['entry','proofs','pin','authority','dir','seller','sequence','source-url','observed-at']);
const usage = () => { throw new Error(
  'Usage: node cli.mjs --entry ORIGINAL-v2.json --proofs proofs.json --pin OUT_OF_BAND_PUBLIC_KEY.pem --authority trusted-policy.json --dir PRIVATE_JOURNAL_DIR --seller SELLER_ID --sequence N --source-url ORIGINAL_SELLER_HTTPS_URL --observed-at ORIGINAL_ISO_TIME'
); };
function parse(argv) {
  const options = {};
  if (argv.length !== allowed.size * 2) usage();
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.slice(2), value = argv[i + 1];
    if (!argv[i]?.startsWith('--') || !allowed.has(key) || !value || Object.hasOwn(options,key))
      usage();
    options[key] = value;
  }
  return options;
}
async function main() {
  const args = parse(process.argv.slice(2));
  if (!/^[1-9][0-9]*$/.test(args.sequence) ||
      !Number.isSafeInteger(Number(args.sequence))) usage();
  const [sourceBytes, proofBytes, keyText, policyBytes] = await Promise.all([
    readFile(args.entry), readFile(args.proofs), readFile(args.pin, 'utf8'),
    readFile(args.authority, 'utf8')
  ]);
  if (!keyText.startsWith('-----BEGIN PUBLIC KEY-----'))
    throw new Error('INDEPENDENT_ED25519_PUBLIC_KEY_PEM_REQUIRED');
  const sourceProofs = JSON.parse(proofBytes.toString('utf8'));
  const policy = JSON.parse(policyBytes.toString('utf8'));
  if (!policy || Array.isArray(policy) || typeof policy !== 'object')
    throw new Error('TRUSTED_OPERATOR_POLICY_INVALID');
  const authority = { sellerId: policy.sellerId, signer: policy.signer };
  for (const name of ['allowedOrigins','allowedRecipients','allowedNetworks','allowedSchemes']) {
    if (!Array.isArray(policy[name]) || !policy[name].every(x => typeof x === 'string'))
      throw new Error('TRUSTED_OPERATOR_POLICY_INVALID_' + name);
    authority[name] = new Set(policy[name]);
  }
  const writer = await DurableCatalogTransaction.open(args.dir);
  try {
    const receipt = await admitPinnedSeller({
      journal: writer, sourceBytes, proofs: sourceProofs, pinnedPublicKey: keyText,
      authority, sellerId: args.seller, sequence: Number(args.sequence),
      sourceURL: args['source-url'], observedAt: args['observed-at']
    });
    process.stdout.write(JSON.stringify(receipt, null, 2) + '\n');
  } finally { await writer.close(); }
}
main().catch(error => { process.stderr.write('SF73: ' + String(error?.message ?? error) + '\n'); process.exitCode = 1; });
