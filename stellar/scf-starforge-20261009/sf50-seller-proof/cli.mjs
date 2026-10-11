#!/usr/bin/env node
// MIT. Explicit, non-settling CLI for x402 seller origin+quote proof.
import {readFile} from 'node:fs/promises';
import {createChallenge,signProof,verifyPinnedProof,verifyOriginProof} from './proof.mjs';
function usage(){throw new Error('Usage: node cli.mjs nonce | sign --entry payment.json --key private.pem --nonce BASE64URL [--accept-index N] | verify --entry payment.json --proof proof.json --pubkey public.pem --nonce BASE64URL [--accept-index N] | verify-origin --entry payment.json --nonce BASE64URL');}
const COMMAND_FIELDS = {
  sign: ['entry', 'key', 'nonce'],
  verify: ['entry', 'proof', 'pubkey', 'nonce'],
  'verify-origin': ['entry', 'nonce']
};
function argsOf(cmd, argv) {
  if (!Object.hasOwn(COMMAND_FIELDS, cmd)) usage();
  const required = COMMAND_FIELDS[cmd];
  const allowed = new Set([...required, ...(cmd === 'verify-origin' ? [] : ['accept-index'])]);
  const args = Object.create(null);
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    if (!flag?.startsWith('--') || !allowed.has(flag.slice(2))) {
      throw new Error(`Unknown option for ${cmd}: ${flag}`);
    }
    const name = flag.slice(2);
    if (Object.hasOwn(args, name)) throw new Error(`Duplicate option: ${flag}`);
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
    args[name] = value;
  }
  for (const name of required) if (!Object.hasOwn(args, name)) throw new Error(`Missing required option: --${name}`);
  return args;
}
function acceptIndex(raw = '0') {
  if (raw.length > 16 || !/^(0|[1-9][0-9]*)$/.test(raw) || !Number.isSafeInteger(Number(raw))) {
    throw new Error('--accept-index must be a canonical nonnegative safe integer');
  }
  return Number(raw);
}
const content=async path=>await readFile(path,'utf8');
try {
  const cmd=process.argv[2];
  if(cmd==='nonce'&&process.argv.length===3){console.log(createChallenge());process.exit(0);}
  const args=argsOf(cmd,process.argv.slice(3));
  const selectedAccept=acceptIndex(args['accept-index']);
  const entry=JSON.parse(await content(args.entry));
  if (!Array.isArray(entry?.accepts) || selectedAccept >= entry.accepts.length) {
    throw new Error('--accept-index does not select an existing accepts option');
  }
  if(cmd==='sign'){console.log(JSON.stringify(signProof(entry,{nonce:args.nonce,selectedAccept,privateKeyPem:await content(args.key)}),null,2));}
  else if(cmd==='verify'){console.log(JSON.stringify(verifyPinnedProof(entry,JSON.parse(await content(args.proof)),{nonce:args.nonce,selectedAccept,pinnedPublicKey:await content(args.pubkey)}),null,2));}
  else if(cmd==='verify-origin'){console.log(JSON.stringify(await verifyOriginProof(entry,{nonce:args.nonce}),null,2));}
  else usage();
} catch(e) {console.error(`Seller proof: ${e.message}`);process.exitCode=1;}
