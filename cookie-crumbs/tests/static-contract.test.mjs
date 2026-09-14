import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');

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

test('on-chain write uses the canonical Memo program', () => {
  assert.match(app, /MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr/);
  assert.match(app, /TransactionInstruction/);
});

test('UI makes the signing boundary explicit and avoids key custody', () => {
  assert.match(html, /Exact memo preview/);
  assert.match(html, /Nothing is sent until|only after showing/i);
  assert.match(html, /seed phrase, private key/i);
  assert.doesNotMatch(app, /localStorage\.setItem\([^)]*(seed|private|secret)/i);
});


test('remote executable is exact-version and subresource-integrity bound', () => {
  const remoteScripts = [...html.matchAll(/<script\b[^>]*\bsrc=["']https:\/\/[^"']+["'][^>]*>/gi)].map((match) => match[0]);
  assert.equal(remoteScripts.length, 1);
  assert.match(remoteScripts[0], /@solana\/web3\.js@1\.98\.4\/lib\/index\.iife\.min\.js/);
  assert.ok(remoteScripts[0].includes('integrity="sha384-I45YF+S0YGWIolUyTksLk9TNtTqaDgZg8e6T1OoBoJvvFmphqYNIPZw3Kl0TkZNN"'));
  assert.ok(remoteScripts[0].includes('crossorigin="anonymous"'));
});

test('recent receipt attribution requires exact connected signer proof', () => {
  assert.match(app, /parsedTransactionSignedBy\(tx, walletAddress\)/);
  assert.match(app, /if \(!parsedTransactionSignedBy\(tx, walletAddress\)\) return null/);
});
