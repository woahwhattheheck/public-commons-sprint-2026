// Run once on the existing merchant operator after receiving the complete source files.
import {readFile} from 'node:fs/promises';
import {resolve, join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const [checkoutArg, originalJobsArg, outputArg] = process.argv.slice(2);
if (!checkoutArg || !originalJobsArg || !outputArg || process.argv.length !== 5)
  throw Error('Usage: node document-native-run.mjs EXISTING_MERCHANT_CHECKOUT ORIGINAL_JOBS_CONFIG NEW_PRIVATE_OUTPUT');
const checkout = resolve(checkoutArg), originalJobs = resolve(originalJobsArg), output = resolve(outputArg);
const from = path => import(pathToFileURL(join(checkout, path)).href);
const owned = await from('stellar/scf-starforge-20261009/sf101-merchant-receiver/api-application/workspace/configuration.mjs');
const {readJobMerchant} = await from('stellar/scf-starforge-20261009/sf30-seller-sdk/jobs/config.mjs');
const api = await from('products/document-merchant/index.mjs');
const {acquireStateLease} = await from('stellar/scf-starforge-20261009/merchant-fleet-gateway/state-lease.mjs');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
await owned.ownedDirectory(output, {create: true});
const lease = await acquireStateLease(output);
try {
lease.assertHeld();
const selected = await readJobMerchant(originalJobs);
const first = Object.keys(selected.raw.functions)[0];
if (!first) throw Error('The selected original merchant has no configured function.');
const chosenPayment = structuredClone(selected.raw.functions[first].payment);
const starting = {
  schema: 'stellar-forge.document-native-run.v1',
  startedAt: new Date().toISOString(), checkout, originalJobs,
  originalMerchant: selected.identity, originalFunction: first,
  providerMode: 'mintpdf anonymous', plannedSupplierRequests: 2,
  sourceFormats: ['html', 'markdown']
};
// An existing start file with different bytes stops another invocation before provider dispatch.
await owned.writeExact(join(output, 'run-start.json'), owned.encoded(starting));
const referencePaths = [
  'products/prepaid-api/records.mjs',
  'stellar/scf-starforge-20261009/sf101-merchant-receiver/api-application/workspace/configuration.mjs',
  'stellar/scf-starforge-20261009/sf88-operator-buyer-cli/job-workspace/cli.mjs'
];
const framework = [];
for (const path of referencePaths) {
  const bytes = await readFile(join(checkout, path));
  framework.push({path, bytes: bytes.length, sha256: digest(bytes), content: bytes.toString('utf8')});
}
await owned.writeExact(join(output, 'original-framework-source.json'), owned.encoded(framework));
const configurations = [];
for (const provider of ['mintpdf', 'snaplab', 'pdfmint']) {
  const request = api.documentSetupTemplate(provider, {anonymous: provider === 'mintpdf'});
  request.publicOrigin = selected.compiled.publicOrigin;
  request.payment = chosenPayment;
  request.serviceName = 'Document merchant commissioning — ' + provider;
  const normalized = api.normalizeDocumentSetup(request);
  const config = api.documentJobConfiguration(normalized);
  const installation = await api.prepareDocumentMerchant({directory: join(output, provider), request});
  const reopened = await api.inspectDocumentMerchant(installation.directory);
  if (JSON.stringify(reopened) !== JSON.stringify(installation)) throw Error('Retained installation differed on reopening.');
  configurations.push({provider, functions: Object.keys(config.functions), installation});
}
await owned.writeExact(join(output, 'installed-configurations.json'), owned.encoded(configurations));
const mint = configurations.find(item => item.provider === 'mintpdf').installation;
const app = await import(pathToFileURL(mint.source.application).href);
const outcomes = [];
const executeFile = promisify(execFile);
for (const format of ['html', 'markdown']) {
  const directory = join(output, 'received-' + format);
  await owned.ownedDirectory(directory, {create: true});
  const name = format === 'html' ? 'report.html' : 'report.md';
  const bytes = await readFile(join(mint.directory, 'examples', name));
  const input = {title: 'Example operations report', taskReference: 'example-operations-report'};
  await owned.writeExact(join(directory, 'supplier-dispatch.json'), owned.encoded({
    provider: mint.provider, format, input, source: {filename: name, bytes: bytes.length, sha256: digest(bytes)},
    endpoint: 'https://mintpdf.dev/v1/pdf', nativeJob: null
  }));
  try {
    // Execute the exact generated application module; native payment is exercised separately through its original operator.
    const result = await app.renderDocumentBytes(mint.provider, format, input, bytes);
    const names = {pdf: 'document.pdf', source: format === 'html' ? 'source.html' : 'source.md',
      request: 'request.json', render: 'render.json'};
    const received = [];
    for (const [slot, body] of Object.entries(result)) {
      await owned.writeExact(join(directory, names[slot]), body);
      received.push({slot, filename: names[slot], bytes: body.length, sha256: digest(body)});
    }
    if (digest(result.source) !== digest(bytes)) throw Error('Received editable source differs from its original.');
    let pdfInspection;
    try {
      const info = await executeFile('pdfinfo', [join(directory, 'document.pdf')], {timeout: 15000, maxBuffer: 1048576});
      const text = await executeFile('pdftotext', ['-layout', join(directory, 'document.pdf'), '-'],
        {timeout: 15000, maxBuffer: 1048576});
      await owned.writeExact(join(directory, 'pdfinfo.txt'), Buffer.from(info.stdout));
      await owned.writeExact(join(directory, 'pdf-text.txt'), Buffer.from(text.stdout));
      pdfInspection = {pdfinfo: info.stdout, textFile: join(directory, 'pdf-text.txt'),
        completeSampleTerms: ['333', '340', 'source', 'report'].map(term => ({term, found: text.stdout.toLowerCase().includes(term)}))};
    } catch (error) {
      pdfInspection = {toolCode: typeof error.code === 'string' ? error.code : null,
        message: 'PDF bytes are retained for the existing operator viewer.'};
    }
    outcomes.push({format, status: 'received', directory, files: received, pdfInspection});
    await owned.writeExact(join(directory, 'received.json'), owned.encoded(outcomes.at(-1)));
  } catch (error) {
    const failure = {format, status: 'supplier_operation_failed', directory,
      code: error.code ?? null, message: String(error.message),
      providerStatus: error.status ?? null, retryAfter: error.retryAfter ?? null,
      providerRequestId: error.providerRequestId ?? null};
    await owned.writeExact(join(directory, 'supplier-error.json'), owned.encoded(failure));
    outcomes.push(failure);
    break;
  }
}
const summary = {...starting, completedAt: new Date().toISOString(),
  configurations: configurations.map(({provider, functions, installation}) =>
    ({provider, functions, setupId: installation.setupId, jobsConfig: installation.jobsConfig,
      source: installation.source})),
  outcomes, frameworkSource: join(output, 'original-framework-source.json'),
  continuation: {
    merchantConfig: mint.jobsConfig, merchantState: mint.merchantState,
    command: ['starforge', 'document-merchant', 'serve', '--directory', mint.directory,
      '--native-factory', 'EXISTING_NATIVE_FACTORY', '--start-worker'],
    customer: 'Use the existing Request application, original buyer operator and the actual merchant HTTPS proxy. Submit the complete sample source, execute its original checkout and receive all four output slots.'
  }
};
await owned.writeExact(join(output, 'run-summary.json'), owned.encoded(summary));
console.log(JSON.stringify(summary, null, 2));
} finally {await lease.close();}
