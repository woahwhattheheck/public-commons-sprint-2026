import test from 'node:test';
import assert from 'node:assert/strict';
import { isLocalBrowserRequest } from '../src/local-boundary.mjs';

test('legitimate local browser and CLI accesses are admitted', () => {
  assert.equal(isLocalBrowserRequest({host:'127.0.0.1:8787',origin:'http://127.0.0.1:8787','sec-fetch-site':'same-origin'}),true);
  assert.equal(isLocalBrowserRequest({host:'localhost:8787','sec-fetch-site':'none'}),true);
  assert.equal(isLocalBrowserRequest({host:'127.0.0.1:8787'}),true);
});

test('rebinding and cross-origin browser traffic are denied', () => {
  for (const headers of [
    {host:'evil.example:8787'},
    {host:'127.0.0.1:8787',origin:'https://evil.example'},
    {host:'127.0.0.1:8787',origin:'http://localhost:8787'},
    {host:'127.0.0.1:8787','sec-fetch-site':'cross-site'},
    {host:'127.0.0.1:8787','sec-fetch-site':'same-site'},
    {host:'127.0.0.1:8787',origin:'null'},
    {host:'127.0.0.1:8787','sec-fetch-site':'cross-site',origin:'http://127.0.0.1:8787'},
    {host:'127.0.0.1:99999'},
    {host:'127.0.0.1:0'},
    {host:'localhost.evil.com:8787'},
    {host:'127.0.0.1:8787@evil.example:8787'},
    {host:'localhost'},
    {}, null,
  ]) assert.equal(isLocalBrowserRequest(headers),false,JSON.stringify(headers));
});
