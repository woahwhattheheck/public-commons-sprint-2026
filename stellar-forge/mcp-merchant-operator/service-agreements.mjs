// MIT. Complete native agreement operations over the original accounting lease.
import {createHash} from 'node:crypto';
import {RetainedFileReads} from './retained-file-reads.mjs';
import {validateServiceAgreementArguments} from './catalog/service-agreements.mjs';
import {ServiceAgreementWorkspace} from '../../stellar/scf-starforge-20261009/merchant-settlement-accounting/service-agreements/store.mjs';
import {renderCustomerTar} from '../../stellar/scf-starforge-20261009/merchant-settlement-accounting/receivables/core.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const today = () => new Date().toISOString().slice(0, 10);
const fail = (code, message) => Object.assign(new Error(message), {code});
const ARCHIVE_NAME = 'agreement.tar';
export class MerchantServiceAgreements {
  #accounting; #sessions = new Map(); #closing = false; #close;
  #reads = new RetainedFileReads({errorPrefix: 'SERVICE_AGREEMENTS'});
  constructor(accounting) {
    if (typeof accounting?.withServiceAgreementsWorkspace !== 'function' || typeof accounting?.call !== 'function')
      throw fail('SERVICE_AGREEMENTS_ACCOUNTING_REQUIRED', 'Use the original configured accounting owner.');
    this.#accounting = accounting;
  }
  get summary() {
    return {configured: this.#accounting.summary.configured, opened: [...this.#sessions.keys()],
      closing: this.#closing, ...this.#reads.summary};
  }
  async #controller(alias, workspace, initialize = false) {
    const existing = this.#sessions.get(alias);
    if (existing?.workspace === workspace) return existing.ready;
    if (!initialize) throw fail('SERVICE_AGREEMENTS_NOT_OPEN',
      'Open service agreements for this original accounting workspace before operating on them.');
    if (existing) await this.#reads.closeScope(alias);
    const record = {workspace, ready: null};
    record.ready = (async () => {
      const controller = new ServiceAgreementWorkspace(workspace);
      await controller.init();
      return controller;
    })();
    this.#sessions.set(alias, record);
    try { return await record.ready; }
    catch (error) {if (this.#sessions.get(alias) === record) this.#sessions.delete(alias); throw error;}
  }
  async #bundle(controller, agreementId, asOf) {
    const bundle = await controller.exportAgreement(agreementId, {asOf});
    return {...bundle, asOf, files: [...bundle.files, {name: ARCHIVE_NAME, type: 'application/x-tar',
      bytes: renderCustomerTar(bundle.files)}]};
  }
  async #file(controller, workspace, args, kind) {
    const key = JSON.stringify([args.agreementId, kind, args.sourceId ?? null, args.asOf ?? null, args.file]);
    const result = await this.#reads.read({scope: args.workspace, key, kind,
      directory: workspace.directory, readId: args.readId, expectedSha256: args.expectedSha256,
      offset: args.offset ?? 0, limit: args.limit ?? 65536,
      load: async () => {
        if (kind === 'agreement-source') return controller.sourceFile(args.agreementId, args.sourceId, args.file);
        const bundle = await this.#bundle(controller, args.agreementId, args.asOf);
        const selected = bundle.files.find(file => file.name === args.file);
        if (!selected) throw fail('SERVICE_AGREEMENTS_FILE_NOT_FOUND', 'Choose a file from this original agreement export.');
        return selected;
      }});
    return {workspace: args.workspace, agreementId: args.agreementId, kind,
      ...(args.sourceId ? {sourceId: args.sourceId} : {}), ...(args.asOf ? {asOf: args.asOf} : {}), ...result};
  }
  async call(name, args = {}) {
    const action = validateServiceAgreementArguments(name, args);
    if (this.#closing) throw fail('SERVICE_AGREEMENTS_CLOSING', 'The service-agreement provider is closing.');
    if (action === 'workspaces') return this.#accounting.call('merchant_accounting_sources');
    if (action === 'file_release') {
      await this.#reads.release(args.workspace, args.readId);
      return {workspace: args.workspace, readId: args.readId, released: true};
    }
    if (action === 'close') {
      await this.#reads.closeScope(args.workspace);
      const result = await this.#accounting.call('merchant_accounting_close', {workspace: args.workspace});
      this.#sessions.delete(args.workspace);
      return result;
    }
    if (action === 'open') await this.#accounting.call('merchant_accounting_open', {workspace: args.workspace});
    return this.#accounting.withServiceAgreementsWorkspace(args.workspace, async workspace => {
      const controller = await this.#controller(args.workspace, workspace, action === 'open');
      const {workspace: alias, agreementId, ...value} = args;
      if (action === 'open' || action === 'state') return {workspace: alias, ...await controller.state({asOf: args.asOf})};
      if (action === 'agreement') return {workspace: alias, ...await controller.detail(agreementId, {asOf: args.asOf})};
      if (action === 'preview') return {workspace: alias, ...await controller.preview(agreementId,
        {periodId: args.periodId, asOf: args.asOf})};
      if (action === 'create') return {workspace: alias, ...await controller.create(value)};
      if (['amend', 'renew', 'cancel', 'bill'].includes(action))
        return {workspace: alias, ...await controller[action](agreementId, value)};
      if (action === 'source_file') return this.#file(controller, workspace, args, 'agreement-source');
      if (action === 'export') {
        const bundle = await this.#bundle(controller, agreementId, args.asOf ?? today());
        return {workspace: alias, revision: bundle.revision, agreementId: bundle.agreementId,
          asOf: bundle.asOf, files: bundle.files.map(({name, type, bytes}) =>
            ({name, type, bytes: bytes.length, sha256: sha(bytes)}))};
      }
      if (action === 'export_file') return this.#file(controller, workspace, args, 'agreement-export');
      throw fail('SERVICE_AGREEMENTS_UNKNOWN_TOOL', 'Choose a declared service-agreement operation.');
    });
  }
  close() {
    if (!this.#close) {
      this.#closing = true;
      this.#close = this.#reads.close().then(() => {this.#sessions.clear();})
        .catch(error => {this.#close = null; throw error;});
    }
    return this.#close;
  }
}
