#!/usr/bin/env node
// MIT. Explicit, non-settling CLI for x402 seller origin+quote proof.
import {readFile} from 'node:fs/promises';
import {createChallenge,signProof,verifyPinnedProof,verifyOriginProof} from './proof.mjs';
function usage(){throw new Error('Usage: node cli.mjs nonce | sign --entry payment.json --key private.pem --nonce BASE64URL | verify --entry payment.json --proof proof.json --pubkey public.pem --nonce BASE64URL | verify-origin --entry payment.json --nonce BASE64URL');}
function argsOf(argv){const o={};for(let i=0;i<argv.length;i+=2){if(!argv[i]?.startsWith('--')||!argv[i+1])usage();o[argv[i].slice(2)]=argv[i+1];}return o;}
const content=async path=>await readFile(path,'utf8');
try {
  const cmd=process.argv[2];
  if(cmd==='nonce'&&process.argv.length===3){console.log(createChallenge());process.exit(0);}
  const args=argsOf(process.argv.slice(3));
  if(!args.entry||!args.nonce)usage();
  const entry=JSON.parse(await content(args.entry));
  if(cmd==='sign'&&args.key){console.log(JSON.stringify(signProof(entry,{nonce:args.nonce,privateKeyPem:await content(args.key)}),null,2));}
  else if(cmd==='verify'&&args.proof&&args.pubkey){console.log(JSON.stringify(verifyPinnedProof(entry,JSON.parse(await content(args.proof)),{nonce:args.nonce,pinnedPublicKey:await content(args.pubkey)}),null,2));}
  else if(cmd==='verify-origin'){console.log(JSON.stringify(await verifyOriginProof(entry,{nonce:args.nonce}),null,2));}
  else usage();
} catch(e) {console.error(`Seller proof: ${e.message}`);process.exitCode=1;}
