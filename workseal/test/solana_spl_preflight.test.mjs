import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { preflightSolanaSplTokenAccounts, SolanaSplPreflightError } from '../src/solana_spl_preflight.mjs';

const tokenProgram = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const mint = 'So11111111111111111111111111111111111111112';
const payer = '11111111111111111111111111111111';
const payee = tokenProgram;
const source = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
const destination = 'dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN';
const digest = 'a'.repeat(64);
const plan = {
  schema: 'workseal-solana-spl-plan/v1', unsigned: true, writePerformed: false,
  onchainEscrowEnforced: false, cluster: 'devnet', settlementDigest: digest,
  currency: `SPL_TOKEN:${mint}`, mint, decimals: 6, amountAtomic: '201', authority: 'OPERATOR_CHECKS',
  tokenAccountPreflight: { tokenProgram, mint, decimals: 6, owner: payer, destinationOwner: payee,
    sourceTokenAccount: source, destinationTokenAccount: destination },
  instructions: [{kind:'memo',utf8:`WORKSEAL:v1:${digest}`},{kind:'transferChecked',programId:tokenProgram,
    mint,owner:payer,sourceTokenAccount:source,destinationTokenAccount:destination,amountAtomic:'201',decimals:6}],
};
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
