// MIT. OpenSearch workspace controls reuse one original SF82 console and release store.
import { lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { initReleaseStore, inspectRelease, stageRelease, compareReleases, releaseStatus } from '../../../sf82-seller-pilot/releases.mjs';
import { prepareOpenSearchRelease } from '../../../sf82-seller-pilot/release-opensearch.mjs';
import { startReleaseConsole } from '../../../sf82-seller-pilot/release-console.mjs';
import { WorkspaceError, digest } from './store.mjs';

const ACTIONS = {
  open: [], stage: ['packageId', 'id', 'label', 'runtime'], activate: ['id', 'expectedGeneration', 'reason'],
  rollback: ['to', 'expectedGeneration', 'reason'], run: ['expectedGeneration'],
  stop: ['instanceId'], restart: ['instanceId', 'expectedGeneration'], 'generate-client': ['id', 'instanceId'],
};
const REQUIRED = { open: [], stage: ['packageId', 'id'], activate: ['id', 'expectedGeneration'],
  rollback: ['expectedGeneration'], run: ['expectedGeneration'], stop: ['instanceId'],
  restart: ['instanceId', 'expectedGeneration'], 'generate-client': ['id', 'instanceId'] };
const failure = (code, message, status = 409) => new WorkspaceError(code, message, status);
function fields(value, allowed, required = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => !allowed.includes(key)) || required.some(key => !Object.hasOwn(value, key)))
    throw failure('WORKSPACE_DEPLOYMENT_INPUT', 'Supply the declared deployment fields.', 400);
}
export class OpenSearchDeploymentWorkspace {
  constructor(workspace) {
    this.workspace = workspace;
    this.root = join(workspace.store.directory, 'deployment');
    this.console = null; this.opening = null; this.busy = false; this.closing = false; this.tasks = new Map();
  }
  summary() {
    return { schema: 'stellar-forge.opensearch-deployment.v1', root: this.root,
      consoleOpen: Boolean(this.console), busy: this.busy };
  }
  async exists() {
    try {
      const value = await lstat(this.root);
      if (!value.isDirectory() || value.isSymbolicLink()) throw failure('WORKSPACE_DEPLOYMENT_DIRECTORY', 'Use the original workspace deployment directory.');
      return true;
    } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  }
  async open() {
    if (this.console) return this.console;
    if (this.closing || this.workspace.closed) throw failure('WORKSPACE_CLOSING', 'Workspace is closing.', 503);
    if (!this.opening) this.opening = (async () => {
      if (!await this.exists()) await initReleaseStore(this.root);
      const session = await startReleaseConsole(this.root, { port: 0, env: this.workspace.env });
      this.console = session;
      session.closed.finally(() => { if (this.console === session) this.console = null; }).catch(() => {});
      return session;
    })().finally(() => { this.opening = null; });
    return this.opening;
  }
  async request(path, input, { raw = false } = {}) {
    const console = await this.open();
    const response = await fetch(console.url + path, {
      method: input === undefined ? 'GET' : 'POST',
      headers: { 'x-release-token': console.token, ...(input === undefined ? {} : {
        origin: console.url, 'content-type': 'application/json' }) },
      ...(input === undefined ? {} : { body: JSON.stringify(input) }),
      redirect: 'error', signal: AbortSignal.timeout(150000),
    });
    if (!response.ok) {
      const value = await response.json();
      throw failure(value.error ?? 'WORKSPACE_DEPLOYMENT_FAILED', value.message ?? 'The original release action failed.', response.status);
    }
    return raw ? response : response.json();
  }
  async status() {
    const exists = await this.exists();
    const value = this.console ? await this.request('/api/status') : exists ? await releaseStatus(this.root) : {
      schema: 'stellar-forge.seller-release-status.v1', root: this.root,
      state: { generation: 0, active: null, previous: null, history: [] },
      releases: [], invalid: [], runtime: { state: 'STOPPED', observed: null },
    };
    return { ...value, workspaceId: this.workspace.store.id, initialized: exists, deployment: this.summary(),
      console: { managesRunningSeller: false, instanceId: null, ...(value.console ?? {}),
        ...(this.console ? { operatorUrl: this.console.operatorUrl } : {}) } };
  }
  async compare(input) {
    fields(input, ['from', 'to'], ['to']);
    if (!await this.exists()) throw failure('WORKSPACE_RELEASE_REQUIRED', 'Stage a merchant package first.');
    const status = await releaseStatus(this.root);
    return { generation: status.state.generation,
      ...await compareReleases(this.root, input.from || status.state.active, input.to) };
  }
  async stage(input) {
    const item = this.workspace.package(input.packageId);
    const prepared = await prepareOpenSearchRelease(item.directory);
    const expected = item.files.map(({ name, bytes, sha256 }) => ({ name, bytes, sha256 })).sort((a, b) => a.name.localeCompare(b.name));
    const actual = prepared.files.map(({ file, bytes, sha256 }) => ({ name: file.slice('opensearch/package/'.length), bytes, sha256 }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const original = this.workspace.operation(item.requestId);
    const config = this.workspace.configFor(original.draft);
    const declaredBindings = JSON.parse(prepared.retained['bindings.json']);
    if (digest(actual) !== digest(expected) || digest(config) !== item.sourceSha256 ||
        digest(prepared.plan) !== item.planSha256 ||
        digest(prepared.source) !== digest({ ...config, bindings: declaredBindings }))
      throw failure('WORKSPACE_PACKAGE_CHANGED', 'The prepared package differs from its original saved workspace edition.');
    await this.open();
    const release = await stageRelease(this.root, { id: input.id, ...(input.label === undefined ? {} : { label: input.label }),
      opensearchPackage: item.directory, runtime: input.runtime ?? { port: 0 } });
    return { release, preparedPackage: { id: item.id, draftId: item.draftId, draftRevision: item.draftRevision,
      sourceSha256: item.sourceSha256, planSha256: item.planSha256 }, status: await this.status() };
  }
  async run(request) {
    const { action } = request ?? {};
    if (!Object.hasOwn(ACTIONS, action)) throw failure('WORKSPACE_DEPLOYMENT_ACTION', 'Choose an available deployment action.', 400);
    fields(request, ['action', 'requestId', ...ACTIONS[action]], ['action', 'requestId', ...REQUIRED[action]]);
    if (this.closing || this.workspace.closed) throw failure('WORKSPACE_CLOSING', 'Workspace is closing.', 503);
    const reserved = this.workspace.store.transaction(() => {
      const value = this.workspace.store.reserve('deployment-' + action, request);
      if (!value.existing && this.busy) throw failure('WORKSPACE_DEPLOYMENT_BUSY', 'An existing deployment request is running. Its saved result remains available.');
      return value;
    });
    if (reserved.existing) return this.workspace.operation(request.requestId);
    const { requestId, action: ignored, ...input } = request;
    this.busy = true;
    const task = (async () => {
      try {
        let result;
        if (action === 'stage') result = await this.stage(input);
        else if (action === 'open') { await this.open(); result = { status: await this.status() }; }
        else if (action === 'generate-client') {
          const client = await this.request('/api/clients/generate', input);
          result = { client, status: await this.status() };
        } else result = { status: await this.request('/api/' + action, input) };
        this.workspace.store.finish(requestId, result);
      } catch (error) { this.workspace.store.finish(requestId, null, this.workspace.failure(error)); }
      finally { this.busy = false; this.tasks.delete(requestId); this.workspace.active.delete(requestId); }
    })();
    this.tasks.set(requestId, task); this.workspace.active.set(requestId, task);
    task.catch(() => {});
    return this.workspace.operation(requestId);
  }
  async clients(input = {}) {
    fields(input, ['after', 'limit']);
    if (!await this.exists()) return { entries: [], nextAfter: null, ownedSeller: null };
    return this.request('/api/clients?' + new URLSearchParams(input));
  }
  async client(exportId) {
    return this.request('/api/clients/inspect?' + new URLSearchParams({ exportId }));
  }
  async downloadClient(req, res, input) {
    fields(input, ['exportId', 'expectedManifestSha256', 'file', 'expectedSha256'], ['exportId', 'expectedManifestSha256']);
    const response = await this.request('/api/clients/download?' + new URLSearchParams(input), undefined, { raw: true });
    const headers = {};
    for (const name of ['content-type', 'content-length', 'content-disposition', 'cache-control', 'x-content-type-options',
      'x-client-manifest-sha256', 'x-content-sha256', 'etag'])
      if (response.headers.has(name)) headers[name] = response.headers.get(name);
    res.writeHead(response.status, headers);
    await pipeline(Readable.fromWeb(response.body), res);
  }
  async handover(releaseId) {
    const release = await inspectRelease(this.root, releaseId);
    const selected = release.release ?? release;
    if (!selected.opensearch) throw failure('WORKSPACE_RELEASE_KIND', 'Select an OpenSearch release from this workspace.');
    const status = await this.status();
    const q = value => "'" + String(value).replaceAll("'", "'\\''") + "'";
    const lines = [
      '# OpenSearch merchant deployment handover', '',
      'Workspace: ' + this.workspace.store.id,
      'Release: ' + selected.id,
      'Release digest: ' + selected.digest,
      'Generated: ' + new Date().toISOString(), '',
      '## Source and customer contract', '',
      'The deployment retains all eleven original prepared files, including the generated JavaScript client, TypeScript declarations and OpenAPI.',
      'Searches run against the configured OpenSearch endpoint. Each request uses the original point-in-time query, explicit indices, projected fields, limits and stable ordering.', '',
      'Source SHA-256: ' + selected.opensearch.sourceConfigSha256,
      'Plan SHA-256: ' + selected.opensearch.planSha256,
      'Execution SHA-256: ' + selected.opensearch.executionSha256, '',
      'Required environment names: ' + selected.opensearch.environment.join(', '), '',
      '## Operate this installation', '',
      'From stellar/scf-starforge-20261009/sf82-seller-pilot in the installed source distribution:',
      '',
      '    node release-cli.mjs status --store ' + q(this.root),
      '    node release-cli.mjs console --store ' + q(this.root) + ' --port 0', '',
      'Close this workspace before opening a separate console for the same deployment. Its original owner gracefully closes the seller, operations interface and customer readers.',
      'Use Compare to inspect the selected query, public terms and runtime differences. Select the new release at the displayed generation, then Restart selected to drain the current seller and launch it.',
      'Rollback selects the previous retained release. Restart selected then runs that source with a fresh process.', '',
      '## Current selection', '',
      'Generation: ' + status.state.generation,
      'Selected: ' + (status.state.active ?? 'none'),
      'Previous: ' + (status.state.previous ?? 'none'),
      'Runtime: ' + status.runtime.state, '',
      '## Customer files', '',
      'While this console owns the running seller, generate a customer export from its actual OpenAPI. Its saved manifest binds the release digest, seller instance and original file bytes.',
      'Download the complete client archive or individual files. Keep the original deployment directory and its sibling deployment.clients directory together when moving this workspace.',
      'Set the required endpoint/authentication environment values in the receiving host before starting the same retained release.', '',
      'Public seller origin: ' + selected.publicOrigin,
      'Mode: ' + selected.mode, '',
      '## Retained query contracts', '', JSON.stringify(selected.opensearch.queries, null, 2), '',
    ];
    return { type: 'text/markdown; charset=utf-8', filename: selected.id + '-deployment.md', body: lines.join('\n') };
  }
  async close() {
    if (this.closing) return this.closed;
    this.closing = true;
    this.closed = (async () => {
      await Promise.allSettled([...this.tasks.values()]);
      if (this.opening) await this.opening;
      await this.console?.close();
    })();
    return this.closed;
  }
}
