import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const chain = await readFile(new URL('../chain.mjs', import.meta.url), 'utf8');
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');

test('is hard-bound to the Cookie Chain community RPC and explorer', () => {
  assert.match(app, /https:\/\/rpc\.cookiescan\.io/);
  assert.match(app, /https:\/\/cookiescan\.io/);
  assert.match(chain, /getGenesisHash/);
  assert.match(chain, /getSignaturesForAddress/);
});

test('Nightly integration includes connection, network switch and transaction signing', () => {
  assert.match(app, /window\.nightly\?\.solana/);
  assert.match(app, /standard:connect/);
  assert.match(app, /changeNetwork/);
  assert.match(app, /solana:signTransaction/);
  assert.match(app, /sendRawTransaction/);
  assert.match(app, /confirmTransaction/);
});

test('on-chain write uses the canonical Memo program through checked-in transaction code', () => {
  assert.match(chain, /MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr/);
  assert.match(app, /buildUnsignedMemoTransaction/);
  assert.doesNotMatch(app, /window\.solanaWeb3/);
});

test('history attribution is gated on exact signer proof', () => {
  assert.match(app, /transactionHasSigner\(tx, state\.publicKey\)/);
  assert.match(app, /signer-authenticated/);
});

test('browser page executes only checked-in module code', () => {
  const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/gi)].map((match) => match[1]);
  assert.deepEqual(scripts, ['./app.js']);
  assert.doesNotMatch(html, /https?:\/\/[^"' ]+\.js/i);
  assert.doesNotMatch(html, /jsdelivr|unpkg|@solana\/web3/i);
});

test('UI makes the signing boundary explicit and avoids key custody', () => {
  assert.match(html, /Exact memo preview/);
  assert.match(html, /only after showing|Nothing is sent until/i);
  assert.match(html, /seed phrase, private key/i);
  assert.doesNotMatch(app, /localStorage\.setItem\([^)]*(seed|private|secret)/i);
});
