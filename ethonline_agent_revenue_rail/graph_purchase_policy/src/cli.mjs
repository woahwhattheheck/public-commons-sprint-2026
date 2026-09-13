#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { evaluatePurchase } from './policy.mjs';
import { fetchLiveAgentEvidence } from './live_graph.mjs';

function argsToMap(argv) {
  const [mode, ...rest] = argv;
  if (!['live', 'fixture'].includes(mode)) throw Object.assign(new Error('mode must be live or fixture'), { code: 'CLI_MODE' });
  const map = { mode };
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i];
    const value = rest[i + 1];
    if (!key?.startsWith('--') || value === undefined) throw Object.assign(new Error('arguments must be --key value pairs'), { code: 'CLI_ARGS' });
    map[key.slice(2)] = value;
  }
  return map;
}

async function readJson(path, code) {
  if (!path) throw Object.assign(new Error(`${code} required`), { code });
  const text = await readFile(path, 'utf8');
  try { return JSON.parse(text); } catch { throw Object.assign(new Error(`${code} invalid JSON`), { code }); }
}

async function main() {
  const args = argsToMap(process.argv.slice(2));
  const offer = await readJson(args.offer, 'CLI_OFFER');
  const policy = await readJson(args.policy, 'CLI_POLICY');
  const now = args.now ?? new Date().toISOString();
  let evidence;
  if (args.mode === 'fixture') {
    evidence = await readJson(args.evidence, 'CLI_EVIDENCE');
  } else {
    const envName = args['endpoint-env'] ?? 'GRAPH_ENDPOINT';
    const endpoint = process.env[envName];
    if (!endpoint) throw Object.assign(new Error(`missing endpoint environment variable ${envName}`), { code: 'CLI_ENDPOINT_ENV' });
    if (!args.agent) throw Object.assign(new Error('--agent required'), { code: 'CLI_AGENT' });
    evidence = await fetchLiveAgentEvidence({ endpoint, agentId: args.agent, capturedAt: now });
  }
  const receipt = evaluatePurchase({ offer, policy, evidence, now });
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
}

main().catch((error) => {
  const safe = { error: error?.code ?? 'CLI_FAILURE', message: String(error?.message ?? 'failure').slice(0, 240) };
  process.stderr.write(`${JSON.stringify(safe)}\n`);
  process.exitCode = 2;
});
