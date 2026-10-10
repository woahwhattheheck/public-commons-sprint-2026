// MIT. Only standalone export-schema and graph control-path regressions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auditWorkflow, auditFile } from '../audit.mjs';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const node = (name, type, parameters = {}) => ({ name, type, parameters, typeVersion: 1, position: [0, 0] });
const route = target => ({ node: target, type: 'main', index: 0 });
const valid = () => ({
  name: 'Local offline acceptance fixture (no credentials)', active: true,
  settings: { errorWorkflow: 'separate-error-handler' },
  nodes: [node('Webhook', 'n8n-nodes-base.webhook', { responseMode: 'responseNode' }),
    node('Respond', 'n8n-nodes-base.respondToWebhook')],
  connections: { Webhook: { main: [[route('Respond')]] } }
});

test('valid native-shaped n8n export has wired response path', () => {
  const report = auditWorkflow(valid());
  assert.equal(report.summary.blockers, 0);
  assert.equal(report.analyzed.mainEdges, 1);
  assert.equal(report.clientReady, 'NOT_ESTABLISHED');
});

test('real connection loss to response node blocks client demo', () => {
  const exported = valid(); exported.connections.Webhook.main = [[]];
  const report = auditWorkflow(exported);
  assert.ok(report.findings.some(f => f.code === 'WEBHOOK_RESPONSE_NODE_UNREACHABLE'));
  assert.equal(report.summary.blockers, 1);
});

test('broken and duplicate node-name references are blockers', () => {
  const exported = valid(); exported.nodes.push(node('Respond', 'n8n-nodes-base.httpRequest'));
  exported.connections.Webhook.main[0].push(route('Missing'));
  const report = auditWorkflow(exported);
  assert.deepEqual(report.findings.filter(f => f.severity === 'blocker').map(f => f.code), ['DUPLICATE_NODE_NAME','DANGLING_CONNECTION']);
});

test('side-effect retry and continueOnFail are flagged without claiming live QA', () => {
  const exported = valid();
  exported.nodes.push({...node('Call customer','n8n-nodes-base.twilio'), retryOnFail:true, continueOnFail:true});
  exported.connections.Respond = {main: [[route('Call customer')]]};
  const report = auditWorkflow(exported);
  assert.deepEqual(report.findings.filter(f => f.nodeType==='n8n-nodes-base.twilio').map(f=>f.code),
    ['SIDE_EFFECT_RETRY_DUPLICATION','CONTINUE_ON_FAILURE']);
  assert.equal(report.runtimeQualification,'NOT_TESTED');
});

test('output omits workflow name, node name, credentials and webhook path; exact input hash', async () => {
  const exported = valid();
  exported.name = 'private customer';
  exported.nodes[0].name='sensitive-phone-555';
  exported.nodes[0].parameters.path='private-signature-123';
  exported.nodes[0].credentials={ vapiApi: { id: 'private-key-abc' } };
  exported.connections={'sensitive-phone-555': {main: [[route('Respond')]]}};
  const root = await mkdtemp(join(tmpdir(), 'n8n-audit-'));
  try {
    const path = join(root, 'sample.json'); await writeFile(path, JSON.stringify(exported));
    const report = await auditFile(path); const serialized = JSON.stringify(report);
    for (const secret of ['private customer','sensitive-phone','private-signature','private-key-abc']) {
      assert.equal(serialized.includes(secret), false);
    }
    assert.match(report.sourceSha256, /^[a-f0-9]{64}$/);
  } finally { await rm(root,{recursive:true,force:true}); }
});

test('rejects invalid graph export shape', () => {
  assert.throws(() => auditWorkflow({nodes:[],connections:[]}), /Expected one exported/);
});
