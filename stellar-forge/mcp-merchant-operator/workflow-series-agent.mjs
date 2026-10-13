// MIT. Complete recurring customer work through the original native Console.
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { createHash } from 'node:crypto';
import { MerchantWorkflowSeriesClient } from './console/workflow-series-client.mjs';
import { reopenWorkflowSeriesHandover } from './console/workflow-series-handover.mjs';
import { RetainedFileReads } from './retained-file-reads.mjs';
import { WORKFLOW_SERIES_ALIAS, validateWorkflowSeriesAgentArguments } from './catalog/workflow-series.mjs';
import { readWorkflowSeriesPrivateFile, workflowSeriesPrivateDirectory, seriesConnectionFailure } from './workflow-series-connection.mjs';
export { readWorkflowSeriesConfiguration } from './workflow-series-connection.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const need = (value, code, message) => { if (!value) throw seriesConnectionFailure(code, message); };
export class MerchantWorkflowSeriesAgent {
  #config; #environment; #clients = new Map(); #pending = new Set(); #handovers = new Map();
  #controller = new AbortController(); #closing = false; #closed = false; #close;
  #reads = new RetainedFileReads({ errorPrefix: 'WORKFLOW_SERIES_HANDOVER' });
  constructor(config, { environment = process.env } = {}) { this.#config = config; this.#environment = environment; }
  get summary() {
    return { configured: Boolean(this.#config.workflowSeries), ...this.#reads.summary,
      consoles: Object.entries(this.#config.workflowSeries?.consoles ?? {}).map(([console, value]) => ({
        console, label: value.label, workspaceId: value.workspaceId,
        incoming: Object.entries(value.incoming).map(([incoming, entry]) => ({ incoming, contentSha256: entry.expectedContentSha256 })),
      })) };
  }
  #definition(alias) {
    need(typeof alias === 'string' && WORKFLOW_SERIES_ALIAS.test(alias), 'WORKFLOW_SERIES_CONSOLE', 'Select a declared Console alias.');
    const value = this.#config.workflowSeries?.consoles[alias];
    need(value, 'WORKFLOW_SERIES_CONSOLE', 'Select a Console from merchant_workflow_series_connections.');
    return value;
  }
  async #client(alias) {
    const definition = this.#definition(alias);
    if (!this.#clients.has(alias)) {
      const pending = (async () => {
        const url = definition.url ?? (definition.urlFile ?
          new TextDecoder('utf-8', { fatal: true }).decode(await readWorkflowSeriesPrivateFile(definition.urlFile, 4096)).trim() :
          this.#environment[definition.urlEnv]);
        need(!this.#closing, 'WORKFLOW_SERIES_CLOSING', 'The recurring-work connection is closing.');
        return new MerchantWorkflowSeriesClient({ url, tokenEnv: definition.tokenEnv,
          environment: this.#environment, signal: this.#controller.signal });
      })();
      this.#clients.set(alias, pending);
      pending.catch(() => { if (this.#clients.get(alias) === pending) this.#clients.delete(alias); });
    }
    return this.#clients.get(alias);
  }
  async #using(alias, action) {
    const definition = this.#definition(alias), client = await this.#client(alias), host = await client.host();
    need(host.console?.workspaceId === definition.workspaceId, 'WORKFLOW_SERIES_WORKSPACE_CHANGED',
      'The selected URL opened another Console workspace. Restore the declared original workspace or update the host connection explicitly.');
    return action(client, host);
  }
  async #directory(alias, handoverId, create = false) {
    this.#definition(alias);
    need(typeof handoverId === 'string' && WORKFLOW_SERIES_ALIAS.test(handoverId),
      'WORKFLOW_SERIES_HANDOVER_ID', 'Use a stable lowercase customer handover identifier.');
    await workflowSeriesPrivateDirectory(this.#config.exportsDirectory);
    const root = await workflowSeriesPrivateDirectory(join(this.#config.exportsDirectory, 'workflow-series-handovers'), create);
    const owner = await workflowSeriesPrivateDirectory(join(root, alias), create);
    return workflowSeriesPrivateDirectory(join(owner, handoverId), create);
  }
  #scope(alias, selection) {
    need(Boolean(selection.handoverId) !== Boolean(selection.incoming), 'WORKFLOW_SERIES_HANDOVER_SELECTION',
      'Select one retained handoverId or one host-declared incoming handover.');
    if (selection.incoming) need(this.#definition(alias).incoming[selection.incoming],
      'WORKFLOW_SERIES_HANDOVER_SELECTION', 'Select a declared incoming customer handover.');
    return alias + '\0' + (selection.incoming ? 'incoming\0' + selection.incoming : 'captured\0' + selection.handoverId);
  }
  async #selectedDirectory(alias, selection) {
    this.#scope(alias, selection);
    if (!selection.incoming) return { directory: await this.#directory(alias, selection.handoverId) };
    const declared = this.#definition(alias).incoming[selection.incoming];
    return { directory: await workflowSeriesPrivateDirectory(declared.directory), expected: declared.expectedContentSha256 };
  }
  async #describe(alias, selection, received) {
    const files = received.files.map(({ absolutePath, ...file }) => ({ ...file, mediaType:
      file.path.endsWith('.json') ? 'application/json' : 'application/octet-stream' }));
    for (const name of ['selection.json', 'handover.json']) {
      const bytes = await readWorkflowSeriesPrivateFile(join(received.directory, name), 128 * 1024 * 1024);
      files.push({ path: name, bytes: bytes.length, sha256: sha(bytes), mediaType: 'application/json' });
    }
    const result = { state: received.state, console: alias, ...selection, profileId: received.profileId,
      contentSha256: received.contentSha256, manifest: received.manifest, files };
    // The original profile stays complete in profile.json; cached metadata does
    // not duplicate every call and customer byte in each range response.
    this.#handovers.set(this.#scope(alias, selection), { directory: received.directory, result });
    return result;
  }
  async #reopen(alias, selection) {
    const { directory, expected } = await this.#selectedDirectory(alias, selection);
    const received = await reopenWorkflowSeriesHandover({ directory });
    need(expected === undefined || expected === received.contentSha256, 'WORKFLOW_SERIES_HANDOVER_CHANGED',
      'Reopen the complete original incoming handover selected by this host.');
    return this.#describe(alias, selection, received);
  }
  async #file(args) {
    const selection = args.incoming ? { incoming: args.incoming } : { handoverId: args.handoverId };
    const scope = this.#scope(args.console, args);
    if (!this.#handovers.has(scope)) await this.#reopen(args.console, selection);
    const retained = this.#handovers.get(scope);
    need(retained.result.contentSha256 === args.expectedContentSha256, 'WORKFLOW_SERIES_HANDOVER_CHANGED',
      'Select the displayed complete customer handover SHA256.');
    const file = retained.result.files.find(value => value.path === args.file);
    need(file && file.sha256 === args.expectedSha256, 'WORKFLOW_SERIES_HANDOVER_FILE',
      'Select an original manifest member and its displayed SHA256.');
    const result = await this.#reads.read({ scope, key: file.path, kind: 'workflow-series-handover', directory: retained.directory,
      expectedSha256: file.sha256, readId: args.readId, offset: args.offset ?? 0, limit: args.limit ?? 65536,
      load: async () => {
        await workflowSeriesPrivateDirectory(retained.directory);
        // Original reopen validated every member and relative path. The native
        // reader owns this descriptor and verifies all bytes before publication.
        const handle = await open(join(retained.directory, file.path), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        try {
          const stat = await handle.stat();
          need(stat.isFile() && stat.size === file.bytes && !(stat.mode & 0o077) &&
            (typeof process.getuid !== 'function' || stat.uid === process.getuid()), 'WORKFLOW_SERIES_HANDOVER_FILE',
          'Read the original private customer file.');
          return { readonlyFileHandle: handle, bytes: file.bytes, sha256: file.sha256,
            name: basename(file.path), type: file.mediaType };
        } catch (error) { await handle.close(); throw error; }
      } });
    return { console: args.console, ...selection, contentSha256: retained.result.contentSha256,
      path: file.path, ...result };
  }
  async #execute(action, args) {
    if (action === 'connections') return this.summary;
    const { console: alias, ...input } = args;
    this.#definition(alias);
    if (action === 'handover_reopen') return this.#reopen(alias, input);
    if (action === 'handover_file') return this.#file(args);
    if (action === 'handover_file_release') {
      await this.#reads.release(this.#scope(alias, args), args.readId);
      return { console: alias, ...(args.incoming ? { incoming: args.incoming } : { handoverId: args.handoverId }), readId: args.readId, state: 'RELEASED' };
    }
    return this.#using(alias, async (client, host) => {
      switch (action) {
        case 'host': return host;
        case 'profiles': return client.profiles();
        case 'profile': return client.profile(input.id);
        case 'profile_save': return client.createProfile(input);
        case 'profile_bind': return client.bindProfile(input);
        case 'tools': {
          const query = new URLSearchParams();
          for (const [key, value] of Object.entries(input)) query.set(key === 'query' ? 'q' : key === 'profileId' ? 'favorites' : key, String(value));
          return client.console.json('tools?' + query);
        }
        case 'tool': return client.console.json('tool/' + encodeURIComponent(input.name));
        case 'draft': return client.console.json('draft/' + encodeURIComponent(input.id) + (input.revision === undefined ? '' : '?revision=' + input.revision));
        case 'draft_save': return client.console.json('drafts', input.input);
        case 'workflows': return client.console.json('workflows?' + new URLSearchParams({ profile: input.profileId }));
        case 'workflow': return client.console.definition(input.id, input.revision);
        case 'workflow_save': return client.console.saveWorkflow(input.input);
        case 'recipes': return client.console.json('workflow-recipes?' + new URLSearchParams({ profile: input.profileId }));
        case 'recipe_prepare': return client.console.prepare(input.input);
        case 'recipe_install': return client.console.install(input.preparation);
        case 'recipe_installation': return client.console.installation(input.id);
        case 'recipe_export': return client.console.exportRecipe(input.input);
        case 'list': return client.list(input.profileId);
        case 'get': { const { id, ...options } = input; return client.series(id, options); }
        case 'save': return client.saveSeries(input.input);
        case 'calendar': return client.calendar(input);
        case 'agenda': return client.agenda(input);
        case 'agenda_calendar': return client.agendaCalendar(input);
        case 'cycle_prepare': return client.prepareCycle(input);
        case 'cycle_save': return client.saveCycle(input.preparation);
        case 'cycle': return client.cycle(input.id);
        case 'cycle_start_prepare': return client.prepareStart(input.id);
        case 'cycle_start': return client.startCycle(input.preparation);
        case 'cycle_cancel': return client.cancelCycle(input);
        case 'cycle_wait': { const { id, ...options } = input; return client.waitCycle(id, options); }
        case 'run': return client.run(input.id);
        case 'run_pause': return client.pause(input);
        case 'run_resume': return client.resume(input);
        case 'run_resolve': return client.resolve(input);
        case 'run_handover': return client.handover(input);
        case 'call_start': return client.console.json('calls', input.input);
        case 'call': return client.console.json('call/' + encodeURIComponent(input.id));
        case 'call_recovery': return client.console.json('recovery/' + encodeURIComponent(input.id));
        case 'customer_receive': return client.console.json('customers', input.input);
        case 'customer_receive_run': { const { runId, ...options } = input; return client.console.receiveCustomer(runId, options); }
        case 'customer_pause': return client.console.json('customer-pause', { id: input.id });
        case 'customer_wait': { const { profileId, deliveryId, ...options } = input; return client.console.waitCustomer(profileId, deliveryId, options); }
        case 'profile_export': {
          const exported = await client.exportProfile(input.id);
          return { archive: exported.archive, bytes: exported.bytes.length, sha256: exported.sha256 };
        }
        case 'profile_import': return client.importProfile(input.archive);
        case 'handover_capture': {
          const directory = await this.#directory(alias, input.handoverId, true);
          const received = await client.capture({ profileId: input.profileId, directory,
            ...(input.deliveryIds === undefined ? {} : { deliveryIds: input.deliveryIds }) });
          return this.#describe(alias, { handoverId: input.handoverId }, received);
        }
        case 'handover_receive': {
          need(Boolean(input.handoverId) !== Boolean(input.incoming) && !(input.incoming && input.sourceConsole),
            'WORKFLOW_SERIES_HANDOVER_SELECTION', 'Select one retained handover or one host-declared incoming handover.');
          let directory, expected;
          if (input.incoming) {
            const declared = this.#definition(alias).incoming[input.incoming];
            need(declared, 'WORKFLOW_SERIES_HANDOVER_SELECTION', 'Select a declared incoming customer handover.');
            directory = await workflowSeriesPrivateDirectory(declared.directory); expected = declared.expectedContentSha256;
          } else directory = await this.#directory(input.sourceConsole ?? alias, input.handoverId);
          const selected = await reopenWorkflowSeriesHandover({ directory });
          need(expected === undefined || expected === selected.contentSha256, 'WORKFLOW_SERIES_HANDOVER_CHANGED',
            'Receive the complete original incoming handover selected by this host.');
          const original = await this.#describe(input.incoming ? alias : input.sourceConsole ?? alias,
            input.incoming ? { incoming: input.incoming } : { handoverId: input.handoverId }, selected);
          const imported = await client.importProfile(selected.profile);
          return { state: 'RECEIVED', console: alias, profileId: selected.profileId, contentSha256: selected.contentSha256,
            source: input.incoming ? { incoming: input.incoming } : { console: input.sourceConsole ?? alias, handoverId: input.handoverId },
            manifest: selected.manifest, files: original.files, imported, workflowSeries: selected.profile.workflowSeriesData ?? null };
        }
        default: throw seriesConnectionFailure('WORKFLOW_SERIES_AGENT_METHOD', 'Select a declared recurring-work operation.');
      }
    });
  }
  call(name, args = {}) {
    if (this.#closing) return Promise.reject(seriesConnectionFailure('WORKFLOW_SERIES_CLOSING', 'The recurring-work connection is closing.'));
    const action = validateWorkflowSeriesAgentArguments(name, args);
    const pending = Promise.resolve().then(() => this.#execute(action, args));
    this.#pending.add(pending);
    pending.then(() => this.#pending.delete(pending), () => this.#pending.delete(pending));
    return pending;
  }
  requestClose() {
    this.#closing = true; this.#controller.abort();
    for (const pending of this.#clients.values()) void pending.then(client => client.close(), () => {});
  }
  close() {
    if (this.#closed) return Promise.resolve();
    if (this.#close) return this.#close;
    this.requestClose();
    this.#close = (async () => {
      await Promise.allSettled([...this.#clients.values()].map(async pending => (await pending).close()));
      await Promise.allSettled([...this.#pending]);
      await this.#reads.close();
      this.#closed = true;
    })().catch(error => { this.#close = undefined; throw error; });
    return this.#close;
  }
}
