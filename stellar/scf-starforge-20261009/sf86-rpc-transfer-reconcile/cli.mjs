#!/usr/bin/env node
// MIT. Direct, read-only RPC reconciliation using original SF43 official SDK decoder.
import { readFile } from 'node:fs/promises';
import { createOfficialEventDecoder } from '../sf43-agent-commerce/verify.mjs';
import { reconcileRpc, ReconciliationError, DEFAULT_RPC } from './verify.mjs';

function argsOf(argv) {
  const known = new Set(['--sf81-result','--payer','--rpc-endpoint','--max-event-pages']);
  const parsed={};
  for(let i=0;i<argv.length;i+=2) {
    if(!known.has(argv[i]) || !argv[i+1] || parsed[argv[i]] !== undefined)
      throw new ReconciliationError('INVALID_CLI_ARGUMENTS');
    parsed[argv[i]]=argv[i+1];
  }
  if(!parsed['--sf81-result'] || !parsed['--payer'])
    throw new ReconciliationError('SF81_RECORD_AND_TRUSTED_PAYER_REQUIRED');
  return parsed;
}

export async function main(argv=process.argv.slice(2)) {
  try {
    const args=argsOf(argv);
    const path=args['--sf81-result'];
    let stat,raw;
    try { raw=await readFile(path); } catch { throw new ReconciliationError('SF81_RECORD_READ_FAILED'); }
    if(raw.length>4_000_000) throw new ReconciliationError('SF81_RECORD_TOO_LARGE');
    let record;
    try { record=JSON.parse(raw.toString('utf8')); }
    catch { throw new ReconciliationError('SF81_RECORD_INVALID_JSON'); }
    // SDK loads from the same actual @x402/stellar / SF43 host as the original product.
    // There is intentionally no fake decoder, credential, or fallback for production CLI.
    let decodeContractEvent;
    try { decodeContractEvent=await createOfficialEventDecoder(); }
    catch { throw new ReconciliationError('STELLAR_SDK_DECODER_UNAVAILABLE'); }
    const pages=args['--max-event-pages']===undefined?24:Number(args['--max-event-pages']);
    const result=await reconcileRpc({record,payer:args['--payer'],decodeContractEvent,
      rpcEndpoint:args['--rpc-endpoint']??DEFAULT_RPC,maxEventPages:pages});
    console.log(JSON.stringify(result));
    return 0;
  } catch(e) {
    const code=e instanceof ReconciliationError?e.code:'RECONCILIATION_EXECUTION_FAILED';
    console.log(JSON.stringify({schema:'stellar-forge.sf86.rpc-reconciliation.v1',
      verdict:'NOT_RECONCILED',reason:code,reservation:'UNCHANGED_VERIFY_SEPARATELY'}));
    return 2;
  }
}
if(import.meta.url===new URL('file://'+process.argv[1]).href) process.exitCode=await main();
