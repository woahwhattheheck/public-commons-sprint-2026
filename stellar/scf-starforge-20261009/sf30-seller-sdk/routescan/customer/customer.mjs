#!/usr/bin/env node
// MIT. Routescan customer workflow on the original SF88 Node buyer and native inbox.
import { readFile, lstat } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

const MODES = new Set(['init','prepare','attach','review','execute','inspect','recover','response','download','json','csv','finalize','report','list']);
const FLAGS = new Set(['runtime','state','inbox','profile','client','operation','inputs','intent','max-atomic','accept','output','workspace','review-file']);
const encode = value => JSON.stringify(value, null, 2) + '\n';
const absolute = (value, name) => {
  if (!value || resolve(value) !== value) throw new Error('Use an absolute ' + name + ' path.');
  return value;
};
async function localJson(path) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 1048576) throw new Error('Use a regular JSON input up to 1 MiB.');
  return JSON.parse(await readFile(path, 'utf8'));
}
function integer(value, fallback) {
  if (value === undefined) return fallback;
  if (!/^(0|[1-9][0-9]*)$/.test(String(value)) || !Number.isSafeInteger(Number(value))) throw new Error('Use a nonnegative integer.');
  return Number(value);
}
function csvCell(value) {
  let text = String(value ?? '');
  // Original JSON is unchanged; spreadsheet formulas are escaped in this derived CSV.
  if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
export function sourceCsv(value) {
  let rows;
  if (Array.isArray(value) && value.every(row => Array.isArray(row) && row.every(cell => typeof cell === 'string'))) {
    const width = value.reduce((maximum, row) => Math.max(maximum, row.length), 2);
    const headers = Array.from({ length: width }, (_, i) =>
      i === 0 ? 'Provider timestamp' : i === 1 ? 'Provider value' : 'Provider column ' + (i + 1));
    rows = [headers, ...value];
  } else if (value && !Array.isArray(value) && typeof value.value === 'string') {
    rows = [['Provider value'], [value.value]];
  } else {
    throw new Error('The retained response is not the provider string-array or total-value schema. Download its original JSON.');
  }
  return rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export class RoutescanCustomer {
  constructor({ runtimeDirectory, stateDirectory, inboxDirectory, operatorProfile } = {}) {
    this.runtimeDirectory = absolute(runtimeDirectory, 'original SF88 runtime');
    this.stateDirectory = absolute(stateDirectory, 'original buyer state');
    this.inboxDirectory = absolute(inboxDirectory, 'original native inbox');
    this.operatorProfile = operatorProfile ? absolute(operatorProfile, 'operator profile') : null;
  }
  async buyer() {
    const { Buyer } = await import(pathToFileURL(join(this.runtimeDirectory, 'node/index.mjs')).href);
    return new Buyer({ runtimeDirectory: this.runtimeDirectory, stateDirectory: this.stateDirectory,
      ...(this.operatorProfile ? { operatorProfile: this.operatorProfile } : {}) });
  }
  async inbox() { return (await this.buyer()).inbox(this.inboxDirectory); }
  async init() { return (await this.buyer()).createInbox({ directory: this.inboxDirectory }).then(inbox => inbox.list()); }
  async prepare({ clientFile, operationId, inputsFile, intentId, maxAtomic, acceptIndex = 0, workspaceDirectory, signal } = {}) {
    if (!workspaceDirectory && !this.operatorProfile) throw new Error('Supply the existing original operator workspace or operator profile before preparing the request.');
    if (!/^[1-9][0-9]*$/.test(maxAtomic ?? '')) throw new Error('Supply the explicit positive atomic-unit ceiling.');
    const clientPath = absolute(clientFile, 'original generated client');
    const { inspectSellerClientExport } = await import(pathToFileURL(join(
      this.runtimeDirectory, '../sf30-seller-sdk/developer/client-export.mjs')).href);
    const retained = await inspectSellerClientExport({ directory: dirname(clientPath) });
    if (retained.state !== 'COMPLETE' || !clientPath.endsWith('/seller-client.mjs'))
      throw new Error('Choose the complete original seller-client export.');
    const buyer = await this.buyer();
    const generated = await import(pathToFileURL(clientPath).href);
    const client = generated.createSellerClient({ buyer });
    const inputs = await localJson(absolute(inputsFile, 'exact request inputs'));
    const request = client.request(operationId, inputs, {
      intentId, maxAtomic, acceptIndex: integer(acceptIndex, 0),
    });
    let operation;
    if (workspaceDirectory) {
      if (typeof buyer.fromWorkspace !== 'function') throw new Error('Use a Stellar Forge release containing the original SF88 native workspace import API.');
      const nativeRequest = {};
      for (const key of ['intentId','url','method','expect','headers','orderReference','ticketFile','ticketHeader'])
        if (request[key] !== undefined) nativeRequest[key] = request[key];
      operation = await buyer.fromWorkspace(absolute(workspaceDirectory, 'original operator workspace'), {
        configuration: { operation: nativeRequest }, intentId: request.intentId, body: request.body, signal,
      });
    } else {
      operation = await buyer.fromRequest(request, { signal });
    }
    try {
      const enqueued = await buyer.inbox(this.inboxDirectory).enqueue(operation);
      return { intentId: operation.intentId, enqueued, review: await buyer.inbox(this.inboxDirectory).review(operation.intentId) };
    } catch (error) {
      error.intentId = operation.intentId;
      error.nextCommand = 'attach';
      throw error;
    }
  }
  async attach(intentId) {
    const buyer = await this.buyer();
    return buyer.inbox(this.inboxDirectory).enqueue(buyer.operation(intentId));
  }
  async review(intentId) { return (await this.inbox()).review(intentId); }
  async inspect(intentId) { return (await this.inbox()).show(intentId); }
  async list() { return (await this.inbox()).list(); }
  async recover(intentId) { return (await this.inbox()).recover(intentId); }
  async execute(intentId, { review, workspaceDirectory, signal } = {}) {
    const inbox = await this.inbox();
    return inbox.execute(intentId, { review: review ?? await inbox.review(intentId), signal,
      ...(workspaceDirectory ? { workspaceDirectory: absolute(workspaceDirectory, 'original operator workspace') } : {}) });
  }
  async response(intentId) { return (await this.inbox()).response(intentId); }
  async download(intentId, destination) {
    const response = await this.response(intentId);
    if (!response) return { intentId, response: null, original: await this.inspect(intentId) };
    return { intentId, native: response.native, delivery: response.delivery,
      output: await response.saveAs(absolute(destination, 'new output')) };
  }
  async data(intentId) {
    const response = await this.response(intentId);
    if (!response) throw new Error('This original intent has no retained response file.');
    return response.json();
  }
  async finalize(intentId, workspaceDirectory) {
    return (await this.inbox()).finalize(intentId, {
      workspaceDirectory: absolute(workspaceDirectory, 'original operator workspace'),
    });
  }
  async report(destination, workspaceDirectory) {
    return (await this.inbox()).exportReport(absolute(destination, 'new report'),
      workspaceDirectory ? { workspaceDirectory: absolute(workspaceDirectory, 'original operator workspace') } : {});
  }
}

const USAGE = [
  'Routescan customer — one original SF88 inbox, usable from Node and Python.',
  '',
  'All commands: --runtime ABS_SF88 --state ABS_BUYER_STATE --inbox ABS_NATIVE_INBOX',
  'init',
  'prepare --workspace ABS_OPERATOR --client ABS_EXPORT/client/seller-client.mjs',
  '        --operation gasSeries --inputs ABS_REQUEST_JSON --intent STABLE_ID --max-atomic AMOUNT [--accept 0]',
  '        --profile ABS_PROFILE is available for profile-based preparation without an operator workspace.',
  'attach --intent STABLE_ID                         Reopen interrupted intake.',
  'review --intent STABLE_ID [--output NEW_JSON]',
  'execute --intent STABLE_ID [--workspace ABS_OPERATOR] [--review-file ABS_REVIEW]',
  'inspect | recover | response | json | csv --intent STABLE_ID',
  'download --intent STABLE_ID --output NEW_FILE',
  'finalize --intent STABLE_ID --workspace ABS_OPERATOR',
  'report --output NEW_HTML [--workspace ABS_OPERATOR]',
  'list',
  '',
  'Inputs are {"query":{"dateFrom":"EXACT_ISO_TIMESTAMP","dateTo":"EXACT_ISO_TIMESTAMP","unit":"day"}}.',
  'Use the exported operation names and supported filters. Preparation and review are offline.',
  'Only execute invokes original terminal approval and purchase. It never retries an attempted intent.',
  'Recover, response, download, json and csv reopen the same saved response without a provider request.',
  'Finalize performs the original accounting continuation for that same purchase.',
  'Node and Python point at this SAME inbox; neither creates a second purchase queue.',
].join('\n');

export async function main(args = process.argv.slice(2)) {
  const [mode, ...rest] = args;
  if (!mode || mode === '--help') { process.stdout.write(USAGE + '\n'); return; }
  if (!MODES.has(mode)) throw new Error('Choose a documented Routescan customer command.');
  const flags = {};
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i]?.slice(2);
    if (!rest[i]?.startsWith('--') || !FLAGS.has(key) || flags[key] !== undefined || rest[i + 1] === undefined)
      throw new Error('Use documented flag/value pairs.');
    flags[key] = rest[i + 1];
  }
  const need = key => { if (!flags[key]) throw new Error('Supply --' + key + '.'); return flags[key]; };
  const customer = new RoutescanCustomer({ runtimeDirectory: need('runtime'), stateDirectory: need('state'),
    inboxDirectory: need('inbox'), operatorProfile: flags.profile });
  const id = ['init','prepare','report','list'].includes(mode) ? null : need('intent');
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  let result;
  try {
    if (mode === 'init') result = await customer.init();
    else if (mode === 'prepare') result = await customer.prepare({ clientFile: need('client'),
      operationId: need('operation'), inputsFile: need('inputs'), intentId: need('intent'),
      maxAtomic: need('max-atomic'), acceptIndex: integer(flags.accept, 0),
      workspaceDirectory: flags.workspace, signal: controller.signal });
    else if (mode === 'execute') result = await customer.execute(id, {
      ...(flags['review-file'] ? { review: await localJson(absolute(flags['review-file'], 'review')) } : {}),
      workspaceDirectory: flags.workspace, signal: controller.signal,
    });
    else if (mode === 'download') result = await customer.download(id, need('output'));
    else if (mode === 'finalize') result = await customer.finalize(id, need('workspace'));
    else if (mode === 'report') result = await customer.report(need('output'), flags.workspace);
    else if (mode === 'json' || mode === 'csv') {
      const data = await customer.data(id);
      process.stdout.write(mode === 'csv' ? sourceCsv(data) : encode(data)); return data;
    } else if (mode === 'response') {
      const response = await customer.response(id);
      result = response ? { intentId: id, job: response.job, native: response.native, delivery: response.delivery, stream: response.stream }
        : { intentId: id, response: null, original: await customer.inspect(id) };
    } else result = await customer[mode](id);
    if (mode === 'review' && flags.output) {
      const { writeFile } = await import('node:fs/promises');
      await writeFile(absolute(flags.output, 'new review output'), encode(result), { flag: 'wx', mode: 0o600 });
    }
    process.stdout.write(encode(result));
    if (result?.process?.errorCode || (result?.process?.exitCode != null && result.process.exitCode !== 0)) process.exitCode = 2;
    if (mode === 'execute') {
      if (result?.native?.lastError || result?.native?.state !== 'ATTEMPT_RECORDED') process.exitCode = 2;
      const outcome = result?.native?.outcome;
      if (outcome && (outcome.error || outcome.evidenceError || outcome.responseCleanupError ||
          !Number.isInteger(outcome.httpStatus) || outcome.httpStatus < 200 || outcome.httpStatus >= 300)) process.exitCode = 2;
    }
    return result;
  } finally {
    process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
    if (controller.signal.aborted) process.exitCode = 130;
  }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => {
    process.stderr.write(encode({ error: error.message, code: error.code || 'ROUTESCAN_CUSTOMER_FAILED',
      ...(error.intentId ? { intentId: error.intentId, nextCommand: error.nextCommand } : {}) }));
    process.exitCode = 1;
  });
}
