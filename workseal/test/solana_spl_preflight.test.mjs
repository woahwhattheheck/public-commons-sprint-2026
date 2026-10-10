import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { preflightSolanaSplTokenAccounts, SolanaSplPreflightError } from '../src/solana_spl_preflight.mjs';
import { makeSolanaSplSettlementPlan } from '../src/solana_spl.mjs';

const tokenProgram = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const mint = 'So11111111111111111111111111111111111111112';
const payer = '11111111111111111111111111111111';
const payee = tokenProgram;
const source = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
const destination = 'dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN';
const digest = 'a'.repeat(64);
const plan = makeSolanaSplSettlementPlan({
  schema: 'workseal-settlement-intent/v1',
  taskDigest: digest,
  resultDigest: 'b'.repeat(64),
  acceptanceDigest: 'c'.repeat(64),
  receiptAuthorityFingerprint: 'd'.repeat(64),
  eventHead: 'e'.repeat(64),
  generation: 1,
  currency: `SPL_TOKEN:${mint}`,
  amountAtomic: '201',
  payer, payee, funding: {},
}, { mint, sourceTokenAccount: source, destinationTokenAccount: destination, decimals: 6 });
const record = (type, info) => ({
  executable: false, owner: tokenProgram, data: { program: 'spl-token', parsed: { type, info } },
});
const accounts = [
  record('mint',{decimals:6}),
  record('account',{mint,owner:payer,state:'initialized',tokenAmount:{amount:'1000',decimals:6}}),
  record('account',{mint,owner:payee,state:'initialized',tokenAmount:{amount:'0',decimals:6}}),
];
const fixture = (value, onPayload) => async (url, init) => {
  assert.equal(url,'https://api.devnet.solana.com');
  assert.equal(init.method,'POST');
  const p=JSON.parse(init.body);
  assert.equal(p.method,'getMultipleAccounts');
  assert.deepEqual(p.params[0],[mint,source,destination]);
  assert.equal(p.params[1].commitment,'finalized');
  onPayload?.(p);
  return new Response(JSON.stringify({jsonrpc:'2.0',id:1,result:{context:{slot:1234},value}}));
};

test('SPL finalized read-only preflight accepts the bound accounts and rejects unsafe states', async () => {
  const good=await preflightSolanaSplTokenAccounts(plan,{fetchImpl:fixture(accounts)});
  assert.equal(good.status,'FINALIZED_RPC_ACCOUNT_MATCH');
  assert.equal(good.slot,1234);
  assert.equal(good.noTransactionCreated,true);
  const badPlan = async mutate => {
    const candidate = structuredClone(plan);
    mutate(candidate);
    await assert.rejects(preflightSolanaSplTokenAccounts(candidate, {
      fetchImpl: async () => { throw new Error('invalid plan reached the RPC transport'); },
    }), error => error instanceof SolanaSplPreflightError && error.code === 'INVALID_PLAN');
  };
  await badPlan(p => { p.instructions[0].programId = tokenProgram; });
  await badPlan(p => { p.instructions[1].dataHex = '0cca0000000000000006'; });
  await badPlan(p => { p.instructions[1].accounts[3].isSigner = false; });
  await badPlan(p => { [p.instructions[1].accounts[0], p.instructions[1].accounts[1]] =
    [p.instructions[1].accounts[1], p.instructions[1].accounts[0]]; });
  await badPlan(p => { p.instructions[1].accounts.push(p.instructions[1].accounts[0]); });
  await badPlan(p => { p.instructions[1].accounts[0].unrecognized = 'extra'; });
  const bad = async (field,values) => {
    await assert.rejects(preflightSolanaSplTokenAccounts(plan,{fetchImpl:fixture(values)}),
      err => err instanceof SolanaSplPreflightError && err.code===field);
  };
  await bad('TOKEN_OWNER_MISMATCH',[accounts[0],accounts[1],record('account',
    {...accounts[2].data.parsed.info,owner:payer})]);
  await bad('TOKEN_MINT_MISMATCH',[record('mint',{decimals:9}),accounts[1],accounts[2]]);
  await bad('UNAVAILABLE_TOKEN_ACCOUNT',[accounts[0],record('account',
    {...accounts[1].data.parsed.info,state:'frozen'}),accounts[2]]);
  await bad('INSUFFICIENT_TOKEN_BALANCE',[accounts[0],record('account',
    {...accounts[1].data.parsed.info,tokenAmount:{amount:'200',decimals:6}}),accounts[2]]);
  await bad('INVALID_TOKEN_ACCOUNT',[accounts[0],null,accounts[2]]);
  await assert.rejects(preflightSolanaSplTokenAccounts({...plan,cluster:'localnet'},
    {fetchImpl:fixture(accounts)}), e=>e.code==='UNSUPPORTED_CLUSTER');
  await assert.rejects(preflightSolanaSplTokenAccounts(plan,{fetchImpl:async()=>
    new Response('x'.repeat(256*1024+1))}),e=>e.code==='RPC_RESPONSE_TOO_LARGE');
});
