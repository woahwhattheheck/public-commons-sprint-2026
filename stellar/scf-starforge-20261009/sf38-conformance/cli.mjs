#!/usr/bin/env node
// MIT. Strictly READ-ONLY SF38 audit CLI. Never POST /verify or /settle.
import { readFile } from 'node:fs/promises';
import { auditCapture, probeSupported, checkHorizonInclusion, SOURCE } from './conformance.mjs';
async function main(args){
  const [op,...rest]=args;
  if(op==='pins') return SOURCE;
  if(op==='audit') {
    if(rest.length!==1)throw Error('Usage: cli.mjs audit OBSERVATIONS.json');
    const file=JSON.parse(await readFile(rest[0],'utf8'));
    return auditCapture(file);
  }
  if(op==='supported') {
    if(rest.length!==1)throw Error('Usage: cli.mjs supported https://facilitator-host (GET only)');
    return probeSupported(rest[0]);
  }
  if(op==='horizon') {
    if(rest.length!==2)throw Error('Usage: cli.mjs horizon stellar:testnet|stellar:pubnet LOWERCASE_SHA256 (GET only)');
    return checkHorizonInclusion({network:rest[0],transaction:rest[1]});
  }
  throw Error('Usage: cli.mjs pins | audit OBSERVATIONS.json | supported HTTPS_URL | horizon NETWORK TXHASH');
}
main(process.argv.slice(2)).then(x=>process.stdout.write(JSON.stringify(x,null,2)+'\n')).catch(e=>{
  console.error('SF38 '+e.message);process.exitCode=1;
});