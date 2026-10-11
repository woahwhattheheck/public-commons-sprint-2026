#!/usr/bin/env node
// One explicit original acquisition command; no automatic follow-up payment.
import {readFile} from 'node:fs/promises';
import {AcquisitionWorkspace, AcquisitionError} from '../index.mjs';

const [settingsFile, commandFile, ...extra] = process.argv.slice(2);
if (!settingsFile || !commandFile || extra.length)
  throw new Error('Usage: node acquisitions.mjs /absolute/sdk-settings.json /absolute/command.json');
const settings = JSON.parse(await readFile(settingsFile, 'utf8'));
const {command, parameters:p = {}} = JSON.parse(await readFile(commandFile, 'utf8'));
const workspace = new AcquisitionWorkspace(settings);
const controller = new AbortController();
let interruptedExit = null;
const interrupt = () => {interruptedExit ??= 130; controller.abort();};
const terminate = () => {interruptedExit ??= 143; controller.abort();};
const options = {signal:controller.signal};
const actions = {
  state: () => workspace.state(options),
  attach: () => workspace.attachRun(p.run, options),
  request: () => workspace.request(p.id, options),
  receive: () => workspace.receiveRequest(p.file, {...options, filename:p.filename}),
  'review-request': () => workspace.reviewRequest(p.id, {...p, ...options}),
  'prepare-request': () => workspace.prepareRequest(p.id, {...p, ...options}),
  'paid-file': () => workspace.paidFile(p.id, options),
  'receive-paid-file': () => workspace.receivePaidFile(p.file, {...options, filename:p.filename}),
  'review-paid-file': () => workspace.reviewPaidFile(p.id, {...p, ...options}),
  'prepare-paid-file': () => workspace.preparePaidFile(p.id, {...p, ...options}),
  'retrieve-paid-file': () => workspace.retrievePaidFile(p.id, {...p, ...options}),
  'reset-paid-file': () => workspace.resetPaidFile(p.id, {...p, ...options}),
  'download-paid-file': () => workspace.downloadPaidFile(p.id, p.operationId, p.destination, options),
  'export-paid-file': () => workspace.exportPaidFile(p.id, {...p, ...options}),
  draft: () => workspace.draft(p.id, {...p, ...options}),
  save: () => workspace.save({...p, ...options}),
  initialize: () => workspace.initialize(p.id, {...p, ...options}),
  inspect: () => workspace.inspect(p.id, options),
  execute: () => workspace.execute(p.id, {...p, ...options}),
  recover: () => workspace.recover(p.id, options),
  unlock: () => workspace.unlock(p.id, {...p, ...options}),
  finalize: () => workspace.finalize(p.id, {...p, ...options}),
  'bind-accounting': () => workspace.bindAccounting(p.id, {...p, ...options}),
  preview: () => workspace.preview(p.id, p.operationId, options),
  download: () => workspace.download(p.id, p.operationId, p.destination, options),
  export: () => workspace.export(p.id, {...p, ...options}),
  'export-request': () => workspace.exportRequest(p.id, {...p, ...options}),
  'backup-review': () => workspace.backupReview({...p, ...options}),
  backup: () => workspace.backup({...p, ...options}),
  verify: () => workspace.verify({...p, ...options}),
  restore: () => workspace.restore({...p, ...options}),
};
if (!Object.hasOwn(actions, command)) throw new Error('Choose one command: ' + Object.keys(actions).join(', '));
process.on('SIGINT', interrupt); process.on('SIGTERM', terminate);
try {
  const result = await actions[command]();
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
} catch (error) {
  if (!(error instanceof AcquisitionError)) throw error;
  process.stdout.write(JSON.stringify({code:error.code, result:error.result}, null, 2) + '\n');
  process.exitCode = interruptedExit ?? 2;
} finally {
  process.off('SIGINT', interrupt); process.off('SIGTERM', terminate);
}
