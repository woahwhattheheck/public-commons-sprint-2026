#!/usr/bin/env node
// MIT. Operate the original upgrade store locally or through its running private console.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonical, sha256, fail, writeJsonSnapshot } from './common.mjs';
import { collectGrpcUpgrade, readGrpcUpgradeBytes, readGrpcUpgradeJson,
  readGrpcUpgradeDirectory, writeGrpcUpgradeDirectory } from './upgrade-receiving.mjs';

const HELP = [
  'grpc upgrade list (--console-url-file PRIVATE_URL_FILE | --state PRIVATE_WORKSPACE) [--offset 0 --limit 50 --snapshot SHA]',
  'grpc upgrade review CONNECTION --id UUID --base REVISION_SHA (--candidate-revision SHA | --capture UUID --capture-sha SHA) --plan PRIVATE_PLAN_JSON --title TITLE',
  'grpc upgrade open CONNECTION --id UUID [--section summary|full|plan|source|adoption|changes|methods|routes] [--offset 0 --limit 50 --snapshot SHA] [--out NEW_JSON]',
  'grpc upgrade method CONNECTION --id UUID --method /package.Service/Method [--out NEW_JSON]',
  'grpc upgrade adopt CONNECTION --id UUID --review-sha SHA [--out NEW_JSON]',
  'grpc upgrade export CONNECTION --id UUID --review-sha SHA --out PRIVATE_DIRECTORY',
  'grpc upgrade inspect --directory PRIVATE_DIRECTORY [--review-sha SHA] [--verify native|hashes] [--section summary|review|base|candidate|plan]',
  'CONNECTION means exactly one --console-url-file or --state. A running console keeps its original writer lease.',
  'Review IDs are explicit UUIDs. Reopen the same ID after an interrupted reply; changed input needs a new review ID.',
].join('\n');
const SHA = /^[a-f0-9]{64}$/, UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const connections = ['--console-url-file', '--state'], paging = ['--offset', '--limit', '--snapshot'];
const options = {
  list: [...connections, ...paging],
  review: [...connections, '--id', '--base', '--candidate-revision', '--capture', '--capture-sha', '--plan', '--title', '--out'],
  open: [...connections, '--id', '--section', ...paging, '--out'],
  method: [...connections, '--id', '--method', '--out'],
  adopt: [...connections, '--id', '--review-sha', '--out'],
  export: [...connections, '--id', '--review-sha', '--out'],
  inspect: ['--directory', '--review-sha', '--verify', '--section', '--out'],
};
function identifier(value, expression, code) {
  if (typeof value !== 'string' || !expression.test(value)) fail(code);
  return value;
}
const required = (flags, key) => {
  const value = flags.get(key);
  if (!value) fail('GRPC_UPGRADE_REQUIRED_OPTION_' + key.slice(2).replaceAll('-', '_').toUpperCase());
  return value;
};
function page(rows, flags) {
  const offset = Number(flags.get('--offset') ?? 0), limit = Number(flags.get('--limit') ?? 50);
  if (!Array.isArray(rows) || !Number.isSafeInteger(offset) || offset < 0 || offset > rows.length ||
      !Number.isSafeInteger(limit) || limit < 1 || limit > 250) fail('GRPC_UPGRADE_PAGE_INVALID');
  const snapshot = sha256(canonical(rows)), expected = flags.get('--snapshot');
  if (offset && !expected) fail('GRPC_SNAPSHOT_REQUIRED');
  if (expected !== undefined && expected !== snapshot) fail('GRPC_INVENTORY_CHANGED', 409);
  return { total: rows.length, snapshot, offset, items: rows.slice(offset, offset + limit),
    nextOffset: offset + limit < rows.length ? offset + limit : null };
}
function summary(value) {
  return { id: value.id, reviewSha256: value.reviewSha256, title: value.request.title,
    baseRevision: value.request.baseRevision, candidate: value.candidate, baseSelection: value.baseSelection,
    comparison: value.comparison.summary, routes: value.routes.summary, planValidation: value.planValidation,
    currentSelection: value.currentSelection, adoption: value.adoption ?? null, adoptionIntent: value.adoptionIntent ?? null };
}
function section(value, flags) {
  const selected = flags.get('--section') ?? 'summary';
  if (selected === 'summary') return summary(value);
  if (selected === 'full') return value;
  if (selected === 'plan') return value.request.plan;
  if (selected === 'source') return { before: value.before, candidate: value.candidate, source: value.source };
  if (selected === 'adoption') return { id: value.id, reviewSha256: value.reviewSha256,
    baseSelection: value.baseSelection, currentSelection: value.currentSelection,
    adoption: value.adoption ?? null, adoptionIntent: value.adoptionIntent ?? null };
  const rows = selected === 'changes' ? value.comparison.changes : selected === 'methods'
    ? value.comparison.methods : selected === 'routes' ? value.routes.rows : null;
  if (!Array.isArray(rows)) fail('GRPC_UPGRADE_SECTION_INVALID');
  return { id: value.id, reviewSha256: value.reviewSha256, section: selected, ...page(rows, flags) };
}
async function openWorkspace(flags) {
  if (flags.has('--state') === flags.has('--console-url-file')) fail('GRPC_UPGRADE_ONE_CONNECTION_REQUIRED');
  if (flags.has('--state')) {
    const { createGrpcWorkspace } = await import('./workspace/model.mjs');
    return createGrpcWorkspace({ stateDirectory: resolve(flags.get('--state')) });
  }
  const raw = new TextDecoder('utf-8', { fatal: true }).decode(
    await readGrpcUpgradeBytes(resolve(flags.get('--console-url-file')), 4096)).trim();
  let url;
  try { url = new URL(raw); } catch { fail('GRPC_CONNECTION_INVALID'); }
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.username ||
      url.password || url.pathname !== '/' || url.search || !/^#[a-f0-9]{64}$/.test(url.hash))
    fail('GRPC_CONNECTION_INVALID');
  const token = url.hash.slice(1), origin = url.origin;
  const request = async (route, body) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    if (payload !== undefined && Buffer.byteLength(payload) > 17825792) fail('GRPC_DOCUMENT_TOO_LARGE', 413);
    let response;
    try {
      response = await fetch(origin + route, { method: payload === undefined ? 'GET' : 'POST',
        redirect: 'error', signal: AbortSignal.timeout(420000), headers: { origin,
          'x-workspace-token': token, ...(payload === undefined ? {} : { 'content-type': 'application/json' }) },
        ...(payload === undefined ? {} : { body: payload }) });
      const cap = response.ok ? 40 * 1024 * 1024 : 65536, parts = []; let total = 0;
      for await (const chunk of response.body ?? []) {
        total += chunk.length;
        if (total > cap) fail('GRPC_RESPONSE_TOO_LARGE', 413);
        parts.push(chunk);
      }
      const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(parts, total)));
      if (!response.ok) {
        const code = /^[A-Z][A-Z0-9_]+$/.test(value.error ?? '') ? value.error : 'GRPC_ORIGINAL_OPERATOR_REJECTED';
        throw Object.assign(new Error(code), { code, status: response.status,
          ...(typeof value.field === 'string' ? { field: value.field } : {}) });
      }
      return value;
    } catch (error) {
      if (error.status || error.code?.startsWith('GRPC_')) throw error;
      throw Object.assign(new Error('GRPC_OPERATION_INTERRUPTED'), { code: 'GRPC_OPERATION_INTERRUPTED',
        recovery: 'Reopen the same review UUID before retrying its original action.' });
    }
  };
  return {
    state: () => request('/api/state'),
    upgradeReview: body => request('/api/upgrade-review', body),
    upgradeOpen: body => request('/api/upgrade-open', body),
    upgradeMethod: body => request('/api/upgrade-method', body),
    upgradeAdopt: body => request('/api/upgrade-adopt', body),
    open: body => request('/api/open', body),
    reflectionOpen: body => request('/api/reflection-open', body),
    close: async () => {},
  };
}

export async function upgradeMain(args = process.argv.slice(2), { stdout = process.stdout } = {}) {
  if (!args.length || args[0] === '--help') { stdout.write(HELP + '\n'); return; }
  const [command, ...rest] = args, flags = new Map();
  if (!options[command]) throw new TypeError(HELP);
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index], value = rest[index + 1];
    if (!options[command].includes(key) || value === undefined || value.startsWith('--') || flags.has(key))
      fail('GRPC_UPGRADE_OPTIONS_INVALID');
    flags.set(key, value);
  }
  let result, workspace;
  try {
    if (command === 'inspect') {
      const mode = flags.get('--verify') ?? 'native', selected = flags.get('--section') ?? 'summary';
      if (!['native', 'hashes'].includes(mode)) fail('GRPC_UPGRADE_VERIFICATION_INVALID');
      const received = await readGrpcUpgradeDirectory(resolve(required(flags, '--directory')), {
        expectedReviewSha256: flags.get('--review-sha'), native: mode === 'native',
      });
      if (selected === 'summary') result = { ...received.summary, directory: received.directory, files: received.files };
      else if (['review', 'base', 'candidate', 'plan'].includes(selected)) result = received.values[selected];
      else fail('GRPC_UPGRADE_SECTION_INVALID');
    } else {
      workspace = await openWorkspace(flags);
      if (command === 'list') {
        const state = await workspace.state();
        if (!Array.isArray(state.upgrades)) fail('GRPC_UPGRADE_SOURCE_REQUIRED');
        result = { kind: 'upgrades', ...page(state.upgrades, flags) };
      } else {
        const id = identifier(required(flags, '--id'), UUID, 'GRPC_UPGRADE_IDENTIFIER_INVALID');
        if (command === 'review') {
          const retained = flags.get('--candidate-revision'), capture = flags.get('--capture');
          if (Boolean(retained) === Boolean(capture) || retained && flags.has('--capture-sha'))
            fail('GRPC_UPGRADE_ONE_CANDIDATE_REQUIRED');
          const candidate = retained ? { kind: 'revision',
            id: identifier(retained, SHA, 'GRPC_UPGRADE_IDENTIFIER_INVALID') } : { kind: 'reflection',
            id: identifier(capture, UUID, 'GRPC_UPGRADE_IDENTIFIER_INVALID'),
            captureSha256: identifier(required(flags, '--capture-sha'), SHA, 'GRPC_UPGRADE_IDENTIFIER_INVALID') };
          const plan = (await readGrpcUpgradeJson(resolve(required(flags, '--plan')), 262144)).value;
          result = summary(await workspace.upgradeReview({ id,
            baseRevision: identifier(required(flags, '--base'), SHA, 'GRPC_UPGRADE_IDENTIFIER_INVALID'),
            candidate, plan, title: required(flags, '--title') }));
        } else if (command === 'open') result = section(await workspace.upgradeOpen({ id }), flags);
        else if (command === 'method') result = await workspace.upgradeMethod({ id, method: required(flags, '--method') });
        else {
          const expectedReviewSha256 = identifier(required(flags, '--review-sha'), SHA, 'GRPC_UPGRADE_IDENTIFIER_INVALID');
          if (command === 'adopt') {
            const adopted = await workspace.upgradeAdopt({ id, expectedReviewSha256 });
            result = { ...summary(adopted), revision: adopted.revision };
          } else {
            const payload = await collectGrpcUpgrade({
              readUpgrade: id => workspace.upgradeOpen({ id }),
              readRevision: revision => workspace.open({ revision }),
              readReflection: id => workspace.reflectionOpen({ id }),
            }, id, expectedReviewSha256);
            result = await writeGrpcUpgradeDirectory(resolve(required(flags, '--out')), payload);
          }
        }
      }
    }
  } finally { if (workspace) await workspace.close(); }
  if (flags.has('--out') && command !== 'export') {
    const path = resolve(flags.get('--out'));
    await writeJsonSnapshot(path, result, 40 * 1024 * 1024);
    stdout.write(JSON.stringify({ path, sha256: sha256(JSON.stringify(result) + '\n'),
      bytes: Buffer.byteLength(JSON.stringify(result) + '\n') }, null, 2) + '\n');
  } else stdout.write(JSON.stringify(result, null, 2) + '\n');
  return result;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  upgradeMain().catch(error => {
    console.error(JSON.stringify({ error: error.code ?? error.message,
      ...(error.field ? { field: error.field } : {}), ...(error.recovery ? { recovery: error.recovery } : {}) }));
    process.exitCode = 1;
  });
