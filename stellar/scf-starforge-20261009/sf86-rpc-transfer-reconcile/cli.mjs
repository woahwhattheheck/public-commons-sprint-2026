#!/usr/bin/env node
// MIT. Direct, read-only RPC reconciliation using original SF43 official SDK decoder.
import { readFile } from 'node:fs/promises';
import { createOfficialEventDecoder } from '../sf43-agent-commerce/verify.mjs';
import { reconcileRpc, ReconciliationError } from './verify.mjs';

function argsOf(argv) {
  const known = new Set(['--sf81-result','--sf82-evidence','--payer','--rpc-endpoint','--max-event-pages']);
  const parsed={};
  for(let i=0;i<argv.length;i+=2) {
    if(!known.has(argv[i]) || !argv[i+1] || parsed[argv[i]] !== undefined)
      throw new ReconciliationError('INVALID_CLI_ARGUMENTS');
    parsed[argv[i]]=argv[i+1];
  }
  if(Boolean(parsed['--sf81-result']) === Boolean(parsed['--sf82-evidence']))
    throw new ReconciliationError('EXACTLY_ONE_SF81_RECORD_OR_SF82_EVIDENCE_REQUIRED');
  if(!parsed['--payer'])
    throw new ReconciliationError('SF81_RECORD_AND_TRUSTED_PAYER_REQUIRED');
  return parsed;
}

export function originalRecordFromEvidence(envelope) {
  if(envelope?.schema !== 'scf82.checkout-evidence.v1')
    throw new ReconciliationError('SF82_EVIDENCE_SCHEMA_INVALID');
  if(envelope.reconciliation?.status !== 'AVAILABLE' || !envelope.reconciliation.record)
    throw new ReconciliationError('SF82_ORIGINAL_RECONCILIATION_RECORD_UNAVAILABLE');
  const record=envelope.reconciliation.record;
  const observation=envelope.observation, buyer=observation?.buyer;
  const reservation=envelope.operatorReservation;
  if(record.operatorReservation?.request_sha256 !== undefined &&
    record.operatorReservation.request_sha256 !== reservation?.requestSha256)
    throw new ReconciliationError('SF82_ORIGINAL_REQUEST_DIGEST_MISMATCH');
  // Identify the same saved operation without deriving missing approval fields.
  // The unchanged verifier still checks the complete original record and payer.
  if(record.intentId !== envelope.intentId || record.intentId !== observation?.intentId ||
    buyer?.attempts !== 2 ||
    !['scheme','network','asset','payTo','amount'].every(key =>
      record.requirement?.[key] !== undefined && record.requirement[key] === buyer?.requirement?.[key]) ||
    !['network','transaction','success'].every(key =>
      record.receipt?.[key] !== undefined && record.receipt[key] === buyer?.receipt?.[key]) ||
    ![['outcome','outcome'],['request_id','requestId'],['network','network'],
      ['reserved_atomic_units','reservedAtomicUnits']].every(([key,savedKey]) =>
      record.operatorReservation?.[key] !== undefined && record.operatorReservation[key] === reservation?.[savedKey]))
    throw new ReconciliationError('SF82_RECONCILIATION_RECORD_MISMATCH');
  return record;
}

export async function main(argv=process.argv.slice(2)) {
  try {
    const args=argsOf(argv);
    const path=args['--sf81-result'] ?? args['--sf82-evidence'];
    const kind=args['--sf82-evidence'] ? 'SF82_EVIDENCE' : 'SF81_RECORD';
    let raw;
    try { raw=await readFile(path); } catch { throw new ReconciliationError(kind+'_READ_FAILED'); }
    if(raw.length>4_000_000) throw new ReconciliationError(kind+'_TOO_LARGE');
    let record;
    try { record=JSON.parse(raw.toString('utf8')); }
    catch { throw new ReconciliationError(kind+'_INVALID_JSON'); }
    if(args['--sf82-evidence']) record=originalRecordFromEvidence(record);
    // SDK loads from the same actual @x402/stellar / SF43 host as the original product.
    // There is intentionally no fake decoder, credential, or fallback for production CLI.
    let decodeContractEvent;
    try { decodeContractEvent=await createOfficialEventDecoder(); }
    catch { throw new ReconciliationError('STELLAR_SDK_DECODER_UNAVAILABLE'); }
    const pages=args['--max-event-pages']===undefined?24:Number(args['--max-event-pages']);
    const result=await reconcileRpc({record,payer:args['--payer'],decodeContractEvent,
      rpcEndpoint:args['--rpc-endpoint'],maxEventPages:pages});
    console.log(JSON.stringify(result));
    return 0;
  } catch(e) {
    const code=e instanceof ReconciliationError?e.code:'RECONCILIATION_EXECUTION_FAILED';
    console.log(JSON.stringify({schema:'stellar-forge.sf86.rpc-reconciliation.v1',
      verdict:'NOT_RECONCILED',reason:code,reservation:'UNCHANGED_VERIFY_SEPARATELY'}));
    return 2;
  }
}
if(process.argv[1] && import.meta.url===new URL('file://'+process.argv[1]).href) process.exitCode=await main();
