import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const programUrl = new URL('../onchain/programs/workseal_escrow/src/lib.rs', import.meta.url);
const cargoUrl = new URL('../onchain/programs/workseal_escrow/Cargo.toml', import.meta.url);

async function source() { return readFile(programUrl, 'utf8'); }

test('Anchor source pins escrow PDA to buyer worker task and mint plus a PDA token vault', async () => {
  const rust = await source();
  assert.match(rust, /seeds = \[b"workseal", buyer\.key\(\)\.as_ref\(\), worker\.key\(\)\.as_ref\(\), args\.task_digest\.as_ref\(\), mint\.key\(\)\.as_ref\(\)\]/);
  assert.match(rust, /seeds = \[b"vault", escrow\.key\(\)\.as_ref\(\)\]/);
  assert.match(rust, /token::authority = escrow/);
  assert.match(rust, /token::mint = mint/);
  assert.match(rust, /token::token_program = token_program/);
  assert.match(rust, /escrow\.buyer_token = ctx\.accounts\.buyer_token\.key\(\)/);
  assert.match(rust, /escrow\.worker_token = ctx\.accounts\.worker_token\.key\(\)/);
  assert.match(rust, /address = escrow\.buyer_token @ WorkSealEscrowError::TokenAccountMismatch/);
  assert.match(rust, /address = escrow\.worker_token @ WorkSealEscrowError::TokenAccountMismatch/);
});

test('Anchor source enforces signer separation and exact acceptance binding', async () => {
  const rust = await source();
  assert.match(rust, /address = escrow\.worker @ WorkSealEscrowError::WorkerMismatch/);
  assert.match(rust, /address = escrow\.verifier @ WorkSealEscrowError::VerifierMismatch/);
  assert.match(rust, /args\.task_digest == escrow\.task_digest/);
  assert.match(rust, /args\.result_digest == escrow\.result_digest/);
  assert.match(rust, /args\.generation, escrow\.generation/);
  assert.match(rust, /args\.receipt_authority_fingerprint == escrow\.receipt_authority_fingerprint/);
  assert.match(rust, /ctx\.accounts\.verifier\.key\(\) != ctx\.accounts\.buyer\.key\(\)/);
  assert.match(rust, /args\.acceptance_digest != \[0; 32\]/);
});

test('Anchor release and refund move only pinned SPL mint under escrow PDA signature', async () => {
  const rust = await source();
  const transfers = rust.match(/token_interface::transfer_checked/g) ?? [];
  assert.equal(transfers.length, 3, 'fund, release, and refund each use transfer_checked');
  assert.match(rust, /CpiContext::new_with_signer/);
  assert.match(rust, /token::authority = worker/);
  assert.match(rust, /token::authority = buyer/);
  assert.match(rust, /require_eq!\(ctx\.accounts\.escrow\.phase, PHASE_ACCEPTED/);
  assert.match(rust, /now > ctx\.accounts\.escrow\.deadline_unix/);
  assert.doesNotMatch(rust, /system_instruction::transfer/);
});

test('dispute freezes pre-acceptance escrow and requires buyer or worker', async () => {
  const rust = await source();
  assert.match(rust, /escrow\.phase == PHASE_FUNDED \|\| ctx\.accounts\.escrow\.phase == PHASE_COMMITTED/);
  assert.match(rust, /actor == ctx\.accounts\.escrow\.buyer \|\| actor == ctx\.accounts\.escrow\.worker/);
  assert.match(rust, /ctx\.accounts\.escrow\.phase = PHASE_DISPUTED/);
});

test('program source pins current Anchor crates and IDL build features', async () => {
  const cargo = await readFile(cargoUrl, 'utf8');
  assert.match(cargo, /anchor-lang = "1\.1\.1"/);
  assert.match(cargo, /anchor-spl = "1\.1\.1"/);
  assert.match(cargo, /anchor-lang\/idl-build/);
  assert.match(cargo, /anchor-spl\/idl-build/);
});
