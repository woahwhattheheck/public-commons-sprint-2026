// MIT. Install a complete document merchant on the original durable paid Jobs engine.
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {acquireStateLease} from '../../stellar/scf-starforge-20261009/merchant-fleet-gateway/state-lease.mjs';
import {compileJobMerchant, readJobMerchant} from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/jobs/config.mjs';
import {absolute, ownedDirectory, ownedBytes, writeExact, encoded, parse, digest, canonical, plain, need, integer, text}
  from '../../stellar/scf-starforge-20261009/sf101-merchant-receiver/api-application/workspace/configuration.mjs';
import {initialRecord} from '../prepaid-api/records.mjs';
import {
  DOCUMENT_SETUP_SCHEMA, DOCUMENT_PROVIDER_SCHEMA, SOURCE_CHECKED_ON,
  documentProvider, normalizeDocumentProvider, documentInputSchema, defaultDocumentSettings, documentPriceReview
} from './contracts.mjs';

export const DOCUMENT_PLAN_SCHEMA = 'stellar-forge.document-merchant-plan.v1';
export const DOCUMENT_INSTALLATION_SCHEMA = 'stellar-forge.document-merchant-installation.v1';
export const DOCUMENT_REVIEW_SCHEMA = 'stellar-forge.document-merchant-review.v1';
const ROOT = dirname(fileURLToPath(import.meta.url));
const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const REQUEST_FIELDS = new Set(['schema', 'serviceName', 'publicOrigin', 'payment', 'provider',
  'formats', 'pathPrefix', 'workerCount', 'maxPending', 'maxJobs', 'memoryLimitMb', 'inputStorage',
  'intakeKeyEnvironment', 'assembly']);
const fixedFiles = ['application.mjs', 'jobs.json', 'provider.json', 'supplier-price.json', 'customer-setup.json'];
const sourceNames = {html: 'report.html', markdown: 'report.md', 'pdf-set':'ordered-pdfs.json'};
const functionIds = {html: 'renderHtml', markdown: 'renderMarkdown', 'pdf-set':'assemblePdfs'};
const contentTypes = {html: 'text/html', markdown: 'text/markdown', 'pdf-set':'application/json'};
const formatsFor = request => [...request.formats,...(request.assembly?['pdf-set']:[])];
const settingsFor = (provider,format) => format==='pdf-set'?{strict:true}:defaultDocumentSettings(provider);
const json = value => encoded(value).toString('utf8');

/** Complete editable template. Actual origin, settlement asset, recipient and price are merchant selections. */
export function documentSetupTemplate(providerId = 'mintpdf', {anonymous = false, assembly = false} = {}) {
  const provider = documentProvider(providerId);
  need(!anonymous || provider.anonymous, 'DOCUMENT_ANONYMOUS_UNSUPPORTED');
  need(!assembly || providerId === 'pdfmint','DOCUMENT_ASSEMBLY_CONFIGURATION_REQUIRED');
  return {
    schema: DOCUMENT_SETUP_SCHEMA, serviceName: provider.name + ' document merchant', publicOrigin: null,
    payment: {scheme: 'exact', network: 'stellar:testnet', asset: null, payTo: null,
      amount: null, maxTimeoutSeconds: 120},
    provider: {
      schema: DOCUMENT_PROVIDER_SCHEMA, provider: providerId,
      plan: anonymous ? 'anonymous' : 'free', authentication: anonymous ? 'anonymous' : 'bearer',
      ...(anonymous ? {} : {keyEnvironment: provider.defaultKeyEnvironment}),
      maxSourceBytes: provider.maxSourceBytes, maxPdfBytes: 33554432, timeoutMs: 120000
    },
    ...(assembly?{assembly:{payment:{scheme:'exact',network:'stellar:testnet',asset:null,payTo:null,
      amount:null,maxTimeoutSeconds:120}}}:{}),
    formats: [...provider.formats], pathPrefix: '/documents',
    workerCount: 1, maxPending: 32, maxJobs: 10000, memoryLimitMb: 256,
    inputStorage: {maxBytes: 268435456, maxUploads: 1024}, intakeKeyEnvironment: null
  };
}

export function normalizeDocumentSetup(value) {
  need(plain(value) && value.schema === DOCUMENT_SETUP_SCHEMA &&
    Object.keys(value).every(key => REQUEST_FIELDS.has(key)), 'DOCUMENT_SETUP_REQUIRED');
  const provider = normalizeDocumentProvider(value.provider);
  const service = documentProvider(provider.provider);
  const plan = service.plans.find(item => item.id === provider.plan);
  const formats = value.formats ?? service.formats;
  need(Array.isArray(formats) && formats.length > 0 && new Set(formats).size === formats.length &&
    formats.every(format => service.formats.includes(format)), 'DOCUMENT_SETUP_FORMATS_INVALID');
  const prefix = value.pathPrefix ?? '/documents';
  need(typeof prefix === 'string' && /^\/[A-Za-z0-9_.~-]+(?:\/[A-Za-z0-9_.~-]+)*$/.test(prefix) &&
    prefix.length <= 160 && !prefix.startsWith('/jobs') && !prefix.startsWith('/_seller'),
    'DOCUMENT_SETUP_PATH_INVALID');
  const intakeKeyEnvironment = value.intakeKeyEnvironment ?? null;
  need(intakeKeyEnvironment === null || typeof intakeKeyEnvironment === 'string' &&
    /^[A-Z][A-Z0-9_]{2,63}$/.test(intakeKeyEnvironment) && intakeKeyEnvironment !== provider.keyEnvironment,
    'DOCUMENT_INTAKE_ENVIRONMENT_INVALID');
  const inputStorage = value.inputStorage ?? {maxBytes: 268435456, maxUploads: 1024};
  need(plain(inputStorage) && Object.keys(inputStorage).every(key => ['maxBytes', 'maxUploads'].includes(key)),
    'DOCUMENT_INPUT_STORAGE_INVALID');
  if(value.assembly!==undefined)need(service.id==='pdfmint'&&plain(value.assembly)&&
    Object.keys(value.assembly).every(key=>key==='payment')&&plain(value.assembly.payment),
    'DOCUMENT_ASSEMBLY_CONFIGURATION_REQUIRED');
  const request = {
    schema: DOCUMENT_SETUP_SCHEMA,
    serviceName: text(value.serviceName ?? service.name + ' document merchant', 160, 'DOCUMENT_SERVICE_NAME_REQUIRED'),
    publicOrigin: value.publicOrigin, payment: structuredClone(value.payment), provider,
    formats: [...formats].sort(), pathPrefix: prefix,
    workerCount: integer(value.workerCount ?? 1, 1, plan.concurrency ?? 16, 'DOCUMENT_SUPPLIER_CONCURRENCY_EXCEEDED'),
    maxPending: integer(value.maxPending ?? 32, 1, 10000, 'DOCUMENT_QUEUE_LIMIT_INVALID'),
    maxJobs: integer(value.maxJobs ?? 10000, 1, 100000, 'DOCUMENT_JOB_LIMIT_INVALID'),
    memoryLimitMb: integer(value.memoryLimitMb ?? 256, 64, 4096, 'DOCUMENT_WORKER_MEMORY_INVALID'),
    inputStorage: {
      maxBytes: integer(inputStorage.maxBytes ?? 268435456, provider.maxSourceBytes,
        1099511627776, 'DOCUMENT_INPUT_STORAGE_INVALID'),
      maxUploads: integer(inputStorage.maxUploads ?? 1024, 1, 100000, 'DOCUMENT_INPUT_STORAGE_INVALID')
    },
    intakeKeyEnvironment,
    ...(value.assembly===undefined?{}:{assembly:{payment:structuredClone(value.assembly.payment)}})
  };
  // The native compiler validates every original payment term, advertised input, file and output policy.
  compileJobMerchant(jobConfiguration(request), {baseDir: ROOT});
  return request;
}

/** Generate the existing Jobs contract; no substitute payment or job state is introduced. */
function jobConfiguration(request) {
  const provider = normalizeDocumentProvider(request.provider);
  const functions = {};
  for (const format of formatsFor(request)) {
    const id = functionIds[format];
    need(id, 'DOCUMENT_SETUP_FORMATS_INVALID');
    functions[id] = {
      path: request.pathPrefix + '/' + format,
      description: format==='pdf-set'?
        'Assemble the complete ordered PDFs into one PDF; return every original source byte, request and supplier metadata.':
        'Render the complete customer ' + format.toUpperCase() +
        ' source into a PDF; return the PDF, unchanged source and complete request and renderer metadata.',
      payment: structuredClone(format==='pdf-set'?request.assembly.payment:request.payment),
      inputSchema: documentInputSchema(provider.provider, format),
      example: {title: 'Operations report', taskReference: 'example-document-task',
        settings: settingsFor(provider.provider,format)},
      inputFiles: {slots: {
        source: {required: true, mediaTypes: [contentTypes[format]], maxBytes: provider.maxSourceBytes,
          description: 'Complete editable UTF-8 ' + format.toUpperCase() + ' document.'}
      }, maxTotalBytes: provider.maxSourceBytes},
      timeoutMs: provider.timeoutMs + 15000, maxInputBytes: 262144, maxOutputBytes: 67108864,
      output: {format: 'package', filename: 'document.zip', files: {
        pdf: {filename: 'document.pdf', contentType: 'application/pdf', required: true, maxBytes: provider.maxPdfBytes},
        source: {filename: format==='pdf-set'?'source.json':format === 'html' ? 'source.html' : 'source.md',
          contentType: contentTypes[format], required: true, maxBytes: provider.maxSourceBytes},
        request: {filename: 'request.json', contentType: 'application/json', required: true, maxBytes: 1048576},
        render: {filename: 'render.json', contentType: 'application/json', required: true, maxBytes: 65536}
      }}
    };
  }
  return {
    schema: 'stellar-forge.paid-jobs.v1', application: './application.mjs',
    publicOrigin: request.publicOrigin, serviceName: request.serviceName,
    environment: provider.keyEnvironment ? [provider.keyEnvironment] : [],
    workerCount: request.workerCount, maxPending: request.maxPending, maxJobs: request.maxJobs,
    memoryLimitMb: request.memoryLimitMb, inputFileStorage: structuredClone(request.inputStorage),
    intake: {enabled: true, functions: Object.keys(functions),
      ...(request.intakeKeyEnvironment ? {accessTokenEnvironment: request.intakeKeyEnvironment} : {})},
    functions
  };
}

export function documentJobConfiguration(request) {
  return jobConfiguration(normalizeDocumentSetup(request));
}

function fileNames(request) {
  return [...fixedFiles, ...formatsFor(request).flatMap(format =>
    ['examples/' + sourceNames[format], 'examples/' + format + '-request.json'])];
}
function applicationModule(contracts, renderer, request) {
  const localImport = /import \{\n  DOCUMENT_RENDER_SCHEMA, SOURCE_CHECKED_ON, buildDocumentRequest, documentProvider,\n  normalizeDocumentProvider, documentError, requireDocument\n\} from '\.\/contracts\.mjs';\n/;
  need(localImport.test(renderer), 'DOCUMENT_APPLICATION_IMPORT_CHANGED');
  const complete = '// Generated from the complete selected document-merchant source; retained by the original Jobs application SHA.\n' +
    contracts + '\n' + renderer.replace(localImport, '') + '\n' +
    'const installedDocumentProvider = Object.freeze(' + JSON.stringify(request.provider) + ');\n' +
    formatsFor(request).map(format => 'export async function ' + functionIds[format] + '(input, context) {\n' +
      '  return renderPaidDocument(installedDocumentProvider, ' + JSON.stringify(format) + ', input, context);\n}\n').join('\n');
  need(Buffer.byteLength(complete) <= 4194304, 'DOCUMENT_APPLICATION_TOO_LARGE');
  return complete;
}
function customerSetup(request, directory) {
  return {
    schema: 'stellar-forge.document-customer-setup.v1', serviceName: request.serviceName,
    publicOrigin: request.publicOrigin, provider: request.provider.provider,
    catalogOrigin: request.publicOrigin,
    functions: formatsFor(request).map(format => ({
      id: functionIds[format], format, path: request.pathPrefix + '/' + format,
      input: {title: 'Your document title', taskReference: 'Your original task reference',
        settings: settingsFor(request.provider.provider,format)},
      file: {slot: 'source', contentType: contentTypes[format], maxBytes: request.provider.maxSourceBytes},
      sampleFile: join(directory, 'examples', sourceNames[format]),
      sampleInputFile: join(directory, 'examples', format + '-request.json'),
      result: {package: 'document.zip', slots: ['pdf', 'source', 'request', 'render']}
    })),
    payment: structuredClone(request.payment),
    ...(request.assembly?{assemblyPayment:structuredClone(request.assembly.payment)}:{}),
    intakeRequiresAccess: Boolean(request.intakeKeyEnvironment),
    completeWorkflow: [
      'Open the existing customer Request application and load this merchant origin.',
      'Select a document function, set the title and original task reference, and add the whole source file.',
      'Prepare the request and review its original checkout and one-document payment.',
      'Pay through the selected native operator; retain the returned customer request and job.',
      'Receive all four named output files into the original resource library; open the PDF and editable source.'
    ],
    resultMeaning: 'One paid document request delivers one complete PDF and its editable source. Parent tasks retain their original references and completion requirements. Page count, supplier render or cache usage and merchant settlement remain distinct units.'
  };
}
function generatedFiles(request, directory, completeApplication, sourceExamples) {
  const contents = {
    'application.mjs': completeApplication,
    'jobs.json': json(jobConfiguration(request)),
    'provider.json': json(request.provider),
    'supplier-price.json': json(documentPriceReview(request.provider)),
    'customer-setup.json': json(customerSetup(request, directory))
  };
  for (const format of formatsFor(request)) {
    contents['examples/' + sourceNames[format]] = sourceExamples[format];
    contents['examples/' + format + '-request.json'] = json({
      title: 'Example operations report', taskReference: 'example-operations-report',
      settings: settingsFor(request.provider.provider,format)
    });
  }
  return fileNames(request).map(name => {
    const content = contents[name];
    need(typeof content === 'string', 'DOCUMENT_SETUP_SOURCE_REQUIRED');
    return {name, content, bytes: Buffer.byteLength(content), sha256: digest(content)};
  });
}
function validatePlan(plan, directory, inputSha256) {
  need(plain(plan) && plan.schema === DOCUMENT_PLAN_SCHEMA && plan.directory === directory &&
    UUID.test(plan.id) && HASH.test(plan.inputSha256) && (!inputSha256 || plan.inputSha256 === inputSha256) &&
    Number.isFinite(Date.parse(plan.createdAt)) && Array.isArray(plan.files),
    'DOCUMENT_RETAINED_SETUP_CHANGED', 409);
  need(digest(canonical(plan.input)) === plan.inputSha256, 'DOCUMENT_RETAINED_SETUP_CHANGED', 409);
  const request = normalizeDocumentSetup(plan.input);
  need(canonical(request) === canonical(plan.request), 'DOCUMENT_RETAINED_SETUP_CHANGED', 409);
  const names = fileNames(request);
  need(plan.files.length === names.length, 'DOCUMENT_RETAINED_SETUP_CHANGED', 409);
  for (let i = 0; i < names.length; i++) {
    const file = plan.files[i];
    need(file?.name === names[i] && typeof file.content === 'string' &&
      Buffer.byteLength(file.content) === file.bytes && digest(file.content) === file.sha256,
      'DOCUMENT_RETAINED_SETUP_CHANGED', 409);
  }
  const examples = Object.fromEntries(formatsFor(request).map(format =>
    [format, plan.files.find(file => file.name === 'examples/' + sourceNames[format]).content]));
  const generated = generatedFiles(request, directory, plan.files[0].content, examples);
  need(canonical(generated) === canonical(plan.files), 'DOCUMENT_RETAINED_SETUP_CHANGED', 409);
  return plan;
}
async function optional(path) {
  try {return parse(await ownedBytes(path, 8388608));}
  catch (error) {if (error.code === 'ENOENT') return null; throw error;}
}
async function materialized(directory, plan) {
  for (const file of plan.files) {
    const bytes = await ownedBytes(join(directory, file.name), 4194304);
    need(bytes.length === file.bytes && digest(bytes) === file.sha256, 'DOCUMENT_SETUP_FILE_CHANGED', 409);
  }
  const source = await readJobMerchant(join(directory, 'jobs.json'));
  need(source.identity.applicationSha256 === plan.files[0].sha256 &&
    source.identity.configSha256 === plan.files[1].sha256, 'DOCUMENT_SETUP_FILE_CHANGED', 409);
  return source;
}
function description(directory, plan, source) {
  return {
    schema: DOCUMENT_INSTALLATION_SCHEMA, setupId: plan.id, directory, inputSha256: plan.inputSha256,
    sourceCheckedOn: SOURCE_CHECKED_ON, planSha256: digest(encoded(plan)),
    jobsConfig: join(directory, 'jobs.json'), merchantState: join(directory, 'merchant-state'),
    providerConfig: join(directory, 'provider.json'), customerSetup: join(directory, 'customer-setup.json'),
    source: source.identity, provider: plan.request.provider, payment: structuredClone(plan.request.payment),
    functions: Object.keys(source.compiled.functions),
    workerCount: source.compiled.workerCount, maxPending: source.compiled.maxPending,
    environmentNames: [...source.compiled.environment,
      ...(plan.request.intakeKeyEnvironment ? [plan.request.intakeKeyEnvironment] : [])],
    files: plan.files.map(({content, ...file}) => file)
  };
}

async function proposedFiles(request, directory) {
  const decode = bytes => new TextDecoder('utf-8', {fatal: true}).decode(bytes);
  const [contracts, renderer] = await Promise.all(['contracts.mjs', 'renderer.mjs']
    .map(name => ownedBytes(join(ROOT, name), 4194304, {privateMode: false}).then(decode)));
  const examples = Object.fromEntries(await Promise.all(formatsFor(request).map(async format =>
    [format, decode(await ownedBytes(join(ROOT, 'examples', sourceNames[format]), 4194304, {privateMode: false}))])));
  return generatedFiles(request, directory, applicationModule(contracts, renderer, request), examples);
}

/**
 * Review the same preparation without creating a directory or changing its files.
 * An interrupted setup reuses the complete original plan and exact generated source.
 */
export async function reviewDocumentMerchant({directory, request} = {}) {
  directory = absolute(directory);
  need(directory !== ROOT && !ROOT.startsWith(directory + '/'), 'DOCUMENT_SOURCE_AND_STATE_MUST_DIFFER');
  let exists = true;
  try {await ownedDirectory(directory);}
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    exists = false;
    await ownedDirectory(dirname(directory));
  }
  const retained = exists ? await optional(join(directory, 'setup.json')) : null;
  const supplied = request === undefined ? undefined : structuredClone(request);
  if (supplied !== undefined) normalizeDocumentSetup(supplied);
  const inputSha256 = supplied === undefined ? undefined : digest(canonical(supplied));
  let input, normalized, files, state;
  if (retained) {
    validatePlan(retained, directory, inputSha256);
    input = structuredClone(retained.input);
    normalized = structuredClone(retained.request);
    files = retained.files;
    const complete = await optional(join(directory, 'setup-complete.json'));
    state = complete ? 'PREPARED' : 'INCOMPLETE';
    for (const file of files) {
      let bytes;
      try {bytes = await ownedBytes(join(directory, file.name), 4194304);}
      catch (error) {
        if (error.code === 'ENOENT' && !complete) continue;
        throw error;
      }
      need(bytes.length === file.bytes && digest(bytes) === file.sha256, 'DOCUMENT_SETUP_FILE_CHANGED', 409);
    }
    if (complete) {
      const source = await materialized(directory, retained);
      need(canonical(complete) === canonical(description(directory, retained, source)),
        'DOCUMENT_SETUP_INCOMPLETE', 409);
    }
  } else {
    need(supplied !== undefined, 'DOCUMENT_CONFIGURATION_REQUIRED', 409);
    input = supplied;
    normalized = normalizeDocumentSetup(input);
    files = await proposedFiles(normalized, directory);
    state = 'NEW';
    // Detect files left by an unrelated setup before the original preparer would
    // attempt its create-once publication. Matching complete files remain usable.
    if (exists) for (const file of files) {
      try {
        const bytes = await ownedBytes(join(directory, file.name), 4194304);
        need(bytes.length === file.bytes && digest(bytes) === file.sha256, 'DOCUMENT_SETUP_FILE_CHANGED', 409);
      } catch (error) {if (error.code !== 'ENOENT') throw error;}
    }
    need(!exists || !await optional(join(directory, 'setup-complete.json')),
      'DOCUMENT_RETAINED_SETUP_CHANGED', 409);
  }
  const configuration = jobConfiguration(normalized);
  return {
    schema: DOCUMENT_REVIEW_SCHEMA, state, directory,
    input, inputSha256: digest(canonical(input)), request: normalized,
    jobsConfig: join(directory, 'jobs.json'), merchantState: join(directory, 'merchant-state'),
    providerConfig: join(directory, 'provider.json'), customerSetup: join(directory, 'customer-setup.json'),
    files: files.map(({content, ...file}) => structuredClone(file)),
    configuration, supplierPrice: documentPriceReview(normalized.provider),
    ...(retained ? {setupId: retained.id, planSha256: digest(encoded(retained))} : {})
  };
}

/** Repeated identical setup reopens its original files under the original Linux state lease. */
export async function prepareDocumentMerchant({directory, request}) {
  directory = absolute(directory);
  need(directory !== ROOT && !ROOT.startsWith(directory + '/'), 'DOCUMENT_SOURCE_AND_STATE_MUST_DIFFER');
  const input = structuredClone(request);
  normalizeDocumentSetup(input);
  const inputSha256 = digest(canonical(input));
  await ownedDirectory(directory, {create: true});
  const lease = await acquireStateLease(directory);
  try {
    lease.assertHeld();
    const plan = await initialRecord({
      directory, name: 'setup.json', lease,
      validate: value => validatePlan(value, directory, inputSha256),
      create: async () => {
        const normalized = normalizeDocumentSetup(input);
        return {
          schema: DOCUMENT_PLAN_SCHEMA, id: randomUUID(), createdAt: new Date().toISOString(),
          directory, input, inputSha256, request: normalized,
          files: await proposedFiles(normalized, directory)
        };
      }
    });
    for (const file of plan.files) {
      lease.assertHeld();
      await ownedDirectory(dirname(join(directory, file.name)), {create: true});
      await writeExact(join(directory, file.name), Buffer.from(file.content));
    }
    const source = await materialized(directory, plan);
    const result = description(directory, plan, source);
    await writeExact(join(directory, 'setup-complete.json'), encoded(result));
    return result;
  } finally {await lease.close();}
}
export async function inspectDocumentMerchant(directory) {
  directory = await ownedDirectory(absolute(directory));
  const plan = validatePlan(await optional(join(directory, 'setup.json')), directory);
  const source = await materialized(directory, plan), result = description(directory, plan, source);
  const complete = await optional(join(directory, 'setup-complete.json'));
  need(complete && canonical(complete) === canonical(result), 'DOCUMENT_SETUP_INCOMPLETE', 409);
  return result;
}
export async function readDocumentSetupRequest(path) {
  return parse(await ownedBytes(absolute(path), 65536));
}
