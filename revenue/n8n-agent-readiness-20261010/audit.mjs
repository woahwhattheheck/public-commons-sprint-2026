// MIT. Read-only n8n exported-workflow structural preflight; no external services.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const LIMIT_BYTES = 2 * 1024 * 1024;
const PLAIN = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const ref = index => `N${String(index + 1).padStart(3, '0')}`;
const TYPES = Object.freeze({
  WEBHOOK: 'n8n-nodes-base.webhook',
  WEBHOOK_REPLY: 'n8n-nodes-base.respondToWebhook',
  MANUAL: 'n8n-nodes-base.manualTrigger',
  HTTP: 'n8n-nodes-base.httpRequest',
});
const TRIGGER_SUFFIX = /(?:Trigger|\.webhook)$/i;
const SIDE_EFFECT_PATTERN = /(?:\.twilio|\.gmail|\.slack|\.microsoftTeams|\.telegram|\.sendgrid|\.shopify|\.httpRequest)$/i;

/** Report only stable array positions and public node types, never node parameters,
 * names, credential references, workflow IDs, URLs, phone numbers or webhook paths.
 */
export function auditWorkflow(workflow, { sourceSha256 = null } = {}) {
  if (!PLAIN(workflow) || !Array.isArray(workflow.nodes) || !PLAIN(workflow.connections)) {
    throw new TypeError('Expected one exported n8n workflow containing nodes[] and connections{}');
  }
  if (workflow.nodes.length > 10000) throw new RangeError('Too many workflow nodes');
  const nodes = workflow.nodes;
  const findings = [];
  const add = (severity, code, index = null, detail = '') => {
    findings.push({ severity, code, ...(index === null ? {} : { nodeRef: ref(index), nodeType: nodes[index]?.type ?? 'UNKNOWN' }), detail });
  };
  const lookup = new Map();
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (!PLAIN(node) || typeof node.name !== 'string' || !node.name.trim() || typeof node.type !== 'string' || !node.type) {
      throw new TypeError('Invalid exported node at ' + ref(i));
    }
    if (lookup.has(node.name)) add('blocker', 'DUPLICATE_NODE_NAME', i, 'Ambiguous n8n connection name');
    else lookup.set(node.name, i);
  }
  const edges = Array.from({ length: nodes.length }, () => new Set());
  for (const [name, outputTypes] of Object.entries(workflow.connections)) {
    const from = lookup.get(name);
    if (from === undefined) { add('blocker', 'UNKNOWN_CONNECTION_SOURCE', null, 'Connection source missing from nodes'); continue; }
    if (!PLAIN(outputTypes)) { add('blocker', 'INVALID_CONNECTION_SET', from, 'Connections must be grouped by output type'); continue; }
    for (const [kind, ports] of Object.entries(outputTypes)) {
      if (!Array.isArray(ports)) { add('blocker', 'INVALID_CONNECTION_PORTS', from, 'Port set is not an array'); continue; }
      for (const routes of ports) {
        if (routes === null) continue;
        if (!Array.isArray(routes)) { add('blocker', 'INVALID_CONNECTION_ROUTE', from, 'Connection route is not an array'); continue; }
        for (const route of routes) {
          const dest = PLAIN(route) && typeof route.node === 'string' ? lookup.get(route.node) : undefined;
          if (dest === undefined) add('blocker', 'DANGLING_CONNECTION', from, 'Connection targets a nonexistent node');
          else if (kind === 'main') edges[from].add(dest);
        }
      }
    }
  }
  const reachable = start => {
    const seen = new Set([start]);
    const stack = [start];
    while (stack.length) {
      const i = stack.pop();
      for (const j of edges[i]) if (!seen.has(j)) { seen.add(j); stack.push(j); }
    }
    return seen;
  };
  const triggers = nodes.map((node, i) => TRIGGER_SUFFIX.test(node.type) && !node.disabled ? i : -1).filter(i => i >= 0);
  if (!triggers.length) add('review', 'NO_ENABLED_TRIGGER', null, 'No enabled trigger recognized in this export');
  if (workflow.active !== true) add('review', 'INACTIVE_EXPORT', null, 'Workflow export is not explicitly active');
  if (triggers.some(i => nodes[i].type !== TYPES.MANUAL) && !workflow.settings?.errorWorkflow) {
    add('review', 'ERROR_WORKFLOW_NOT_CONFIGURED', null, 'Confirm production error handling and alerting');
  }
  const visited = new Set();
  for (const i of triggers) for (const j of reachable(i)) visited.add(j);
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (node.disabled) { add('review', 'DISABLED_NODE', i, 'Validate deliberate bypass and downstream behavior'); continue; }
    if (triggers.length && !visited.has(i)) add('review', 'UNREACHABLE_FROM_TRIGGER', i, 'Not reachable by a main-data path from an enabled trigger');
    if (node.type === TYPES.WEBHOOK && node.parameters?.responseMode === 'responseNode') {
      const hasReply = [...reachable(i)].some(j => nodes[j].type === TYPES.WEBHOOK_REPLY && !nodes[j].disabled);
      if (!hasReply) add('blocker', 'WEBHOOK_RESPONSE_NODE_UNREACHABLE', i, 'Webhook configured for Respond to Webhook but no enabled response node is reachable');
    }
    if (node.retryOnFail && SIDE_EFFECT_PATTERN.test(node.type)) {
      add('review', 'SIDE_EFFECT_RETRY_DUPLICATION', i, 'Verify idempotency before allowing automatic retry on external side effects');
    }
    if (node.type === TYPES.HTTP && !node.parameters?.options?.timeout) {
      add('review', 'HTTP_TIMEOUT_POLICY', i, 'Confirm runtime timeout budget against client demo SLA');
    }
    if (SIDE_EFFECT_PATTERN.test(node.type) && node.continueOnFail) {
      add('review', 'CONTINUE_ON_FAILURE', i, 'Confirm failed external action cannot silently advance success path');
    }
  }
  const blockers = findings.filter(f => f.severity === 'blocker').length;
  const reviews = findings.filter(f => f.severity === 'review').length;
  return Object.freeze({
    schema: 'tj.n8n.pre-demo-static-audit.v1', sourceSha256,
    analyzed: { nodes: nodes.length, enabledTriggers: triggers.length, mainEdges: edges.reduce((s, e) => s + e.size, 0) },
    findings, summary: { blockers, reviews, staticGraphValid: blockers === 0 },
    runtimeQualification: 'NOT_TESTED', clientReady: 'NOT_ESTABLISHED',
    nextGate: 'Run authorized real workflow + integration failure-path acceptance before client demonstration',
  });
}

export async function auditFile(path) {
  const file = await readFile(path);
  if (file.length > LIMIT_BYTES) throw new RangeError('Workflow export exceeds 2 MiB input cap');
  let workflow;
  try { workflow = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(file)); }
  catch { throw new TypeError('Workflow export is not valid UTF-8 JSON'); }
  return auditWorkflow(workflow, { sourceSha256: createHash('sha256').update(file).digest('hex') });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [path, ...args] = process.argv.slice(2);
  if (!path || args.length) { process.stderr.write('Usage: node audit.mjs <exported-n8n-workflow.json>\n'); process.exitCode = 3; }
  else {
    try {
      const report = await auditFile(path);
      process.stdout.write(JSON.stringify(report, null, 2) + '\n');
      if (report.summary.blockers) process.exitCode = 2;
    } catch (error) {
      // Never print a workflow's contents, provider keys, or submitted URL.
      process.stderr.write('Audit input rejected: ' + (error instanceof RangeError ? 'size limit' : 'invalid export') + '\n');
      process.exitCode = 3;
    }
  }
}
