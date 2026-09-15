import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../simulator/', import.meta.url);

async function text(name) {
  return readFile(new URL(name, root), 'utf8');
}

test('judge surface exposes decision, simulation-only, and live-status semantics', async () => {
  const html = await text('index.html');
  assert.match(html, /Simulation only/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /Skip to decision/);
  assert.match(html, /data-action="reset"/);
  assert.match(html, /Deterministic receipt/);
});

test('browser surface is self-contained and imports only local modules', async () => {
  const html = await text('index.html');
  const app = await text('app.mjs');
  assert.doesNotMatch(html, /<script[^>]+src=["']https?:/i);
  assert.doesNotMatch(html, /<link[^>]+href=["']https?:/i);
  assert.match(app, /from '\.\/state\.mjs'/);
  assert.doesNotMatch(app, /\bfetch\s*\(/);
  assert.doesNotMatch(app, /XMLHttpRequest|WebSocket|EventSource/);
});

test('rendered provider-controlled text is escaped before HTML insertion', async () => {
  const app = await text('app.mjs');
  assert.match(app, /function escapeHtml/);
  assert.match(app, /escapeHtml\(op\.title\)/);
  assert.match(app, /escapeHtml\(op\.summary\)/);
  assert.match(app, /escapeHtml\(item\.note\)/);
  assert.match(app, /escapeHtml\(row\.detail\)/);
});
