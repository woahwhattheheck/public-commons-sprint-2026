// MIT — SF-43. REAL canonical Stellar x402 testnet-paid API exemplar.
// Requires an operator's existing testnet identity, local consent, and official SDK.
// Never transmits signing key except as locally consumed by the official SDK.
import { createInterface } from 'node:readline/promises';
import { stdin,stdout } from 'node:process';
import { decodeX402Header,parseExactTestnetTerms,checkStellarTestnetTransaction,createOfficialEventDecoder } from './verify.mjs';

const RESOURCE='https://stellar.org/x402-demo/api/protected/testnet';
const RPC='https://soroban-testnet.stellar.org';

async function main() {
  const max=process.env.SF43_MAX_ATOMIC;
  if(!max || !/^[1-9][0-9]*$/.test(max))
    throw new Error('Set SF43_MAX_ATOMIC to your explicitly approved upper bound in TESTNET USDC atomic units (verify decimals from actual contract)');
  if(!process.env.STELLAR_SECRET) throw new Error('Provide a locally available funded TESTNET-only STELLAR_SECRET to the executing process; do not put it in code or Slack');
  const challenged=await fetch(RESOURCE,{method:'GET',redirect:'error'});
  if(challenged.status!==402)throw new Error('Expected authentic official endpoint HTTP 402; received '+challenged.status);
  const paymentRequired=decodeX402Header(challenged.headers.get('payment-required'),'PAYMENT-REQUIRED');
  if(paymentRequired.resource?.url !== RESOURCE)throw new Error('Resource identity drift');
  const quoted=parseExactTestnetTerms(paymentRequired,max);
  const approval={resource:RESOURCE,method:'GET',network:quoted.network,
    scheme:quoted.scheme,assetContract:quoted.asset,recipient:quoted.payTo,
    amountAtomic:quoted.amount,maxApprovedAtomic:max};
  stdout.write(JSON.stringify({step:'REAL_402_OBSERVED',approval},null,2)+'\n');
  if(!stdin.isTTY)throw new Error('Operator TTY required. Automated approval intentionally disabled.');
  const reader=createInterface({input:stdin,output:stdout});
  let response;
  try {response=await reader.question('Approve ONE TESTNET USDC payment with these exact terms? Type PAY TESTNET: ');}
  finally {reader.close();}
  if(response !== 'PAY TESTNET') throw new Error('Explicit operator decline: no payment sent');

  const {createEd25519Signer}=await import('@x402/stellar');
  const {ExactStellarScheme}=await import('@x402/stellar/exact/client');
  const {wrapFetchWithPaymentFromConfig,decodePaymentResponseHeader}=await import('@x402/fetch');
  const signer=createEd25519Signer(process.env.STELLAR_SECRET,'stellar:testnet');
  const paidFetch=wrapFetchWithPaymentFromConfig(fetch,{
    schemes:[{network:'stellar:*',client:new ExactStellarScheme(signer)}]
  });
  // The official SDK performs the canonical actual x402 v2 402 -> signer -> retry;
  // this code does NOT synthesize PAYMENT-SIGNATURE or settlement receipts.
  const result=await paidFetch(RESOURCE,{redirect:'error'});
  const receiptHeader=result.headers.get('payment-response');
  const receipt=receiptHeader?decodePaymentResponseHeader(receiptHeader):null;
  stdout.write(JSON.stringify({step:'REAL_PAID_HTTP_RESULT',httpStatus:result.status,
    providerReceipt:receipt,body:(await result.text()).slice(0,2048)},null,2)+'\n');
  let decoder;
  try {decoder=await createOfficialEventDecoder();}
  catch (error) {stdout.write(JSON.stringify({notice:'Stellar SDK event decoder unavailable',detail:error.message})+'\n');}
  const check=await checkStellarTestnetTransaction({receipt,expected:quoted,
    rpcEndpoint:RPC,decodeContractEvent:decoder});
  stdout.write(JSON.stringify({step:'INDEPENDENT_TESTNET_RPC_CHECK',...check},null,2)+'\n');
  if(check.status!=='TOKEN_TRANSFER_MATCHED_TESTNET') process.exitCode=2;
}
main().catch(error=>{console.error('SF43 testnet acceptance: '+error.message);process.exitCode=1;});
