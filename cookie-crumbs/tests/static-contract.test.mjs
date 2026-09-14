import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const build = await readFile(new URL('../build.mjs', import.meta.url), 'utf8');

test('is hard-bound to the Cookie Chain community RPC and explorer', () => {
  assert.match(app, /https:\/\/rpc\.cookiescan\.io/);
  assert.match(app, /https:\/\/wss\.cookiescan\.io/);
  assert.match(app, /https:\/\/cookiescan\.io/);
});

test('Nightly integration includes connection, network switch and transaction signing', () => {
  assert.match(app, /window\.nightly\?\.solana/);
  assert.match(app, /standard:connect/);
  assert.match(app, /changeNetwork/);
  assert.match(app, /solana:signTransaction/);
  assert.match(app, /sendRawTransaction/);
  assert.match(app, /confirmTransaction/);
});

test('history attribution requires explicit connected-wallet signer authority', () => {
  assert.match(app, /from '\.\/provenance\.mjs'/);
  assert.match(app, /transactionSignedBy\(tx, expectedSigner\)/);
  assert.match(app, /fetchReceipt\(signatureInfo, state\.publicKey\)/);
});

test('on-chain write uses the canonical Memo program', () => {
  assert.match(app, /MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr/);
  assert.match(app, /TransactionInstruction/);
});

test('wallet-connected page executes only repository-served scripts', () => {
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /script-src 'self'/);
  assert.match(html, /src="\.\/vendor\/solana-web3\.iife\.min\.js"/);
  assert.match(html, /type="module" src="\.\/app\.js"/);
  assert.doesNotMatch(html, /<script[^>]+src="https?:\/\//i);
  assert.doesNotMatch(html, /cdn\.jsdelivr\.net|unpkg\.com/i);
});

test('static build hash-binds the exact Solana package before extracting its browser bundle', () => {
  assert.match(build, /@solana\/web3\.js@1\.98\.4/);
  assert.match(build, /beff657e7be352c462abfffe8f9a417578a0d0841db730340516776d710fe0a688c85d4271ac9d5aa832cd081f64c348b16356986f80507c0fcb8007383ea0a7/);
  assert.match(build, /--ignore-scripts/);
  assert.match(build, /tarball digest mismatch/);
  assert.match(build, /package\/lib\/index\.iife\.min\.js/);
});

test('UI makes the signing boundary explicit and avoids key custody', () => {
  assert.match(html, /Exact memo preview/);
  assert.match(html, /Nothing is sent until|only after showing/i);
  assert.match(html, /seed phrase, private key/i);
  assert.doesNotMatch(app, /localStorage\.setItem\([^)]*(seed|private|secret)/i);
});
