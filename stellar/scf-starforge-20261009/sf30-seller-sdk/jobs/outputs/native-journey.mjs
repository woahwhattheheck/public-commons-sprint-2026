// MIT. Named results through the same original input, approval, merchant and buyer owners.
import assert from 'node:assert/strict';
import { readFile, rename } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { prepareInputFileFixture } from '../inputs/native-journey.mjs';
import { startJobsWorkspace } from '../workspace/server.mjs';
import { runJobCommand } from '../cli.mjs';
import { runJobBuyerCommand } from '../buyer.mjs';
import { runJobWorkspaceCommand } from '../../../sf88-operator-buyer-cli/job-workspace/cli.mjs';
import { runPaidJobClientCommand } from '../../../../../stellar-forge/mcp-merchant-operator/paid-jobs-cli.mjs';
import { readJson, readBytes, writeJson, jsonBytes, digest, exists, privateDirectory } from '../../../sf88-operator-buyer-cli/node/store.mjs';
import { RESULT_PACKAGE_TYPE } from './contract.mjs';
import { inspectResultPackage } from './archive.mjs';
import { reopenResultPackage } from './receive.mjs';

export const OUTPUT_OPERATION = 'SCF-JOB-RESULT-PACKAGES-0B8D-20261012';
const slots = ['exceptions', 'report', 'totals'];

export async function prepareOutputFileFixture({ fixture, immutable }) {
  const original = await prepareInputFileFixture({ fixture, immutable });
  const source = await readFile(new URL('./example-application.mjs', import.meta.url), 'utf8');
  const specifier = "'../inputs/example-application.mjs'";
  assert.equal(source.split(specifier).length, 2);
  // The same retained input application remains immutable; this original wrapper
  // selects that actual source, with a separately bound worker application digest.
  const application = Buffer.from(source.replace(specifier, JSON.stringify(pathToFileURL(original.applicationPath).href)));
  const applicationPath = join(fixture, 'output-application.mjs');
  await immutable(applicationPath, application);
  const example = await readJson(fileURLToPath(new URL('./example-merchant.json', import.meta.url)));
  const configuration = { ...original.configuration, application: applicationPath,
    serviceName: example.serviceName, functions: { reconcile: { ...original.configuration.functions.reconcile,
      description: example.functions.reconcile.description,
      output: example.functions.reconcile.output, maxOutputBytes: example.functions.reconcile.maxOutputBytes } } };
  return { ...original, applicationPath, applicationSha256: digest(application), configuration,
    inputApplication: { path: original.applicationPath, sha256: original.applicationSha256 } };
}

function assertFiles(value) {
  assert.deepEqual(value.map(row => row.slot).sort(), slots);
  assert.equal(new Set(value.map(row => row.filename)).size, 3);
  for (const file of value) {
    assert.match(file.sha256, /^[a-f0-9]{64}$/);
    assert.ok(file.bytes > 0);
  }
}
function assertReport(report, jobId) {
  assert.equal(report.schema, 'supplier-invoice-reconciliation.v1');
  assert.equal(report.jobId, jobId);
  assert.equal(report.records, 6000);
  assert.equal(report.exceptionCount, 4000);
  assert.equal(report.exceptions.length, 20);
  assert.equal(report.omittedExceptions, 3980);
}

/** Exercise actual customer and merchant HTTP file receiving before their hosts close. */
export async function inspectOutputFileCustomer({ fixture, operation, entryId, jobId,
  merchant, model, host, api, immutable }) {
  assert.equal(operation, OUTPUT_OPERATION);
  const row = await merchant.get(jobId), buyer = await api('/api/job-workspace/jobs/' + entryId);
  const selected = await api('/api/job-workspace/jobs/' + entryId + '/outputs');
  assert.equal(selected.received, true);
  assert.equal(selected.package.contentType, RESULT_PACKAGE_TYPE);
  assert.equal(selected.package.sha256, buyer.receipt.delivery.sha256);
  assert.equal(selected.job.id, jobId);
  assert.deepEqual(selected.job.nativeSettlement, row.nativeSettlement);
  assertFiles(selected.files);
  const resources = [], verified = [];
  let report = null;
  for (const file of selected.files) {
    assert.equal(file.resource.status, 'VERIFIED');
    assert.equal(file.resource.job.jobId, jobId);
    assert.equal(file.resource.job.acceptanceSha256, buyer.receipt.acceptanceSha256);
    assert.deepEqual(file.resource.job.nativeSettlement, row.nativeSettlement);
    const ticket = await api('/api/resources/' + file.resourceId + '/download', {});
    const response = await fetch(host.origin + ticket.url);
    assert.equal(response.status, 200);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(bytes.length, file.bytes); assert.equal(digest(bytes), file.sha256);
    const preview = await api('/api/resources/' + file.resourceId + '/preview');
    assert.equal(preview.text, bytes.toString('utf8'));
    if (file.slot === 'report') {
      report = JSON.parse(preview.text); assertReport(report, jobId);
      const note = 'Complete original reconciliation report. CSV totals include every source line.';
      let annotation = file.resource.annotation;
      if (annotation.note !== note) annotation = await api('/api/resources/' + file.resourceId + '/note', {
        expectedRevision: annotation.revision, operationId: operation + ':report-note',
        note, tags: ['invoice', 'report'], starred: true,
      }, 'PATCH');
      file.resource.annotation = annotation;
    } else if (file.slot === 'totals') {
      const lines = preview.text.trimEnd().split('\r\n');
      assert.equal(lines.length, 3);
      assert.equal(lines[0], '"Currency","Lines","PricedLines","UnpricedLines","AllChargedMinor","PricedChargedMinor","ExpectedMinor","VarianceMinor"');
      assert.ok(lines.some(line => line.endsWith(',"1220000","1200000","20000"')));
      assert.ok(lines.some(line => line.endsWith(',"900000","900000","0"')));
    } else {
      assert.equal(preview.text.trimEnd().split('\r\n').length, 21);
      assert.ok(preview.text.includes('"UNKNOWN_SKU"'));
      assert.ok(preview.text.includes('"CURRENCY_MISMATCH"'));
    }
    resources.push(file.resource);
    verified.push({ slot: file.slot, filename: file.filename, bytes: file.bytes,
      sha256: file.sha256, resourceId: file.resourceId });
  }
  let operator;
  try {
    operator = await startJobsWorkspace({ model: merchant, port: 0 });
    const request = async path => fetch(operator.origin + path, {
      headers: { authorization: 'Bearer ' + operator.token, origin: operator.origin } });
    const response = await request('/api/jobs/' + encodeURIComponent(jobId) + '/outputs');
    assert.equal(response.status, 200);
    const description = await response.json();
    assert.equal(description.manifestSha256, selected.manifestSha256);
    assert.equal(description.package.sha256, selected.package.sha256);
    for (const file of verified) {
      const response = await request('/api/jobs/' + encodeURIComponent(jobId) + '/outputs/' + file.slot);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('x-sfjobs-sha256'), file.sha256);
      const bytes = Buffer.from(await response.arrayBuffer());
      assert.equal(bytes.length, file.bytes); assert.equal(digest(bytes), file.sha256);
    }

  } finally { await operator?.close(); }
  const retained = { schema: 'stellar-forge.job-output-http-receiving.v1', operation, jobId, entryId,
    package: selected.package, manifestSha256: selected.manifestSha256,
    policySha256: selected.policySha256, job: selected.job, selectionSha256: selected.selectionSha256,
    directory: selected.directory, buyerDirectory: buyer.directory, files: verified, browser: null };
  await writeJson(join(fixture, 'output-http-receiving.json'), retained);
  return { ...retained, report, resources };
}

export async function reviewOutputFileBrowser({ fixture, model, customer, browserModule, browserExecutable }) {
  if (!browserModule && !browserExecutable) return null;
  assert.ok(browserModule && browserExecutable, 'Select both actual browser module and executable.');
  const selected = await readJson(join(fixture, 'output-http-receiving.json'));
  let merchant;
  try {
    merchant = await startJobsWorkspace({ model, port: 0 });
    const { reviewOutputFileWorkspaces } = await import('./browser-receiving.mjs');
    selected.browser = await reviewOutputFileWorkspaces({ customer, merchant, entryId: selected.entryId,
      jobId: selected.jobId, files: selected.files, directory: join(fixture, 'output-browser'),
      browserModule, browserExecutable });
    await writeJson(join(fixture, 'output-http-receiving.json'), selected);
    return selected.browser;
  } finally { await merchant?.close(); }
}

export function inspectDownloadedOutput(bytes, { expected, job, manifestSha256 }) {
  const packet = inspectResultPackage(bytes, { expected, job });
  assert.equal(packet.manifestSha256, manifestSha256);
  assertFiles(packet.manifest.files);
  assertReport(JSON.parse(packet.file('report')), job.id);
  return packet.describe();
}

/** Continue only after checkout/input/resolution/MCP hosts have drained. No new purchase. */
export async function finishOutputFileReceiving({ checkoutResult }) {
  const source = resolve(checkoutResult), completed = await readJson(source, 1048576);
  assert.equal(completed.operation, OUTPUT_OPERATION);
  assert.equal(completed.result, 'PASS');
  assert.equal(completed.agent.result, 'PASS');
  const fixture = completed.fixtureDirectory, output = join(fixture, 'output-native-result.json');
  const http = await readJson(join(fixture, 'output-http-receiving.json'));
  const jobId = http.jobId, entryId = completed.checkout.jobEntryId;
  assert.equal(http.entryId, entryId);
  const merchantArgs = ['--config', join(fixture, 'merchant.json'), '--state', join(fixture, 'merchant-state'), '--id', jobId];
  const cli = async (run, args) => {
    const values = [];
    await run(args, { print: value => values.push(typeof value === 'string' ? JSON.parse(value) : value) });
    assert.equal(values.length, 1);
    return values[0];
  };
  const before = await cli(runJobCommand, ['show', ...merchantArgs]);
  const outbox = join(fixture, 'merchant-state', 'outbox', 'events.ndjson');
  const originalOutboxSha256 = digest(await readBytes(outbox, 67108864));
  const merchant = await cli(runJobCommand, ['outputs', ...merchantArgs]);
  assert.equal(merchant.manifestSha256, http.manifestSha256);
  const totals = http.files.find(file => file.slot === 'totals');
  const csvPath = join(fixture, 'merchant-currency-totals.csv');
  if (!await exists(csvPath))
    await cli(runJobCommand, ['output-file', ...merchantArgs, '--slot', 'totals', '--out', csvPath]);
  const csv = await readBytes(csvPath);
  assert.equal(csv.length, totals.bytes); assert.equal(digest(csv), totals.sha256);
  const customer = await cli(runJobWorkspaceCommand,
    ['outputs', '--state', completed.customerWorkspace, '--entry', entryId]);
  assert.equal(customer.received, true);
  assert.deepEqual(customer.files.map(file => file.resourceId), http.files.map(file => file.resourceId));
  // Use the exact retained buyer selected by the existing customer catalog.
  const shown = await cli(runJobWorkspaceCommand,
    ['show', '--state', completed.customerWorkspace, '--entry', entryId]);
  assert.equal(shown.directory, http.buyerDirectory);
  const portable = join(fixture, 'portable-output-files');
  const buyerDirectory = await exists(portable) ? portable : join(fixture, 'buyer-output-files');
  const buyer = await runJobBuyerCommand(['receive-outputs', '--state', shown.directory, '--out', buyerDirectory]);
  assert.equal(buyer.package.sha256, http.package.sha256); assertFiles(buyer.files);
  const again = await runJobBuyerCommand(['receive-outputs', '--state', shown.directory, '--out', buyerDirectory]);
  assert.equal(again.reusedFiles, 3);
  if (buyerDirectory !== portable) await rename(buyerDirectory, portable);
  const reopened = await runJobBuyerCommand(['reopen-outputs', '--state', shown.directory, '--out', portable]);
  assert.equal(reopened.selectionSha256, buyer.selectionSha256);
  assertFiles((await reopenResultPackage({ directory: portable, expected: http.package, job: http.job })).files);
  const agent = completed.agent;
  const mcp = await cli(runPaidJobClientCommand, ['jobs', 'outputs', '--dir', agent.offline.directory,
    '--out', join(fixture, 'mcp-output-files'), '--manifest-sha256', agent.manifestSha256]);
  assert.equal(mcp.exportId, agent.exportId);
  assert.equal(mcp.outputs.package.sha256, http.package.sha256);
  assert.deepEqual(mcp.outputs.job.nativeSettlement, http.job.nativeSettlement);
  const mcpAgain = await cli(runPaidJobClientCommand, ['jobs', 'outputs', '--dir', agent.offline.directory,
    '--out', join(fixture, 'mcp-output-files'), '--manifest-sha256', agent.manifestSha256]);
  assert.equal(mcpAgain.outputs.reusedFiles, 3);
  const offline = await cli(runPaidJobClientCommand, ['jobs', 'reopen', '--dir', agent.offline.directory,
    '--manifest-sha256', agent.manifestSha256]);
  assert.equal(offline.outputs.manifestSha256, http.manifestSha256);
  const after = await cli(runJobCommand, ['show', ...merchantArgs]);
  assert.deepEqual(after, before);
  assert.equal(digest(await readBytes(outbox, 67108864)), originalOutboxSha256);
  const result = { schema: 'stellar-forge.job-output-native-result.v1', operation: OUTPUT_OPERATION,
    result: 'PASS', jobId, entryId, fixtureDirectory: fixture, package: http.package,
    manifestSha256: http.manifestSha256, files: http.files, nativeSettlement: http.job.nativeSettlement,
    merchant: { csvPath, bytes: csv.length, sha256: digest(csv) },
    customer: { directory: customer.directory, selectionSha256: customer.selectionSha256 },
    buyer: reopened, mcp: mcpAgain, originalOutboxSha256, browser: http.browser,
    lifecycle: ['original two-file request and native approval', 'one worker result with three named files',
      'merchant and customer HTTP member download', 'original Library notes and collection receiving',
      'same customer restart', 'merchant and buyer CLI receiving', 'portable files reopen',
      'complete original MCP export and offline output receiving', 'unchanged paid job and settlement'] };
  await writeJson(output, result);
  return { ...result, output };
}
