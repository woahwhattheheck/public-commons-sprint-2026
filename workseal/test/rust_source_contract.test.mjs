import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Rust custody source contains the chain-side critical invariants', async()=>{
  const source=await readFile(new URL('../onchain/program/src/lib.rs',import.meta.url),'utf8');
  for(const needle of [
    'Pubkey::find_program_address',
    'system_instruction::create_account',
    'system_instruction::transfer',
    'transfer_checked',
    'checked_add(1)',
    'verified_ed25519_predecessor',
    'WORKSEAL_ACCEPT_V1',
    'Clock::get()?.unix_timestamp',
    'Phase::Settled',
    'Phase::Cancelled',
    'worker_token',
    'buyer_token',
  ]) assert.ok(source.includes(needle),`missing invariant marker ${needle}`);
  assert.equal(/Custom\(10[0-9]\)/.test(source),false,'no deliberate custody stub may remain');
});
