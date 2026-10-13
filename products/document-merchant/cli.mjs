#!/usr/bin/env node
// MIT. Provider-specific setup and the original paid Jobs operator command.
import {resolve, dirname, join} from 'node:path';
import {realpathSync} from 'node:fs';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {
  absolute, ownedDirectory, ownedBytes, writeExact, encoded, parse, digest
} from '../../stellar/scf-starforge-20261009/sf101-merchant-receiver/api-application/workspace/configuration.mjs';
import {runJobCommand} from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/jobs/cli.mjs';
import {acquireStateLease} from '../../stellar/scf-starforge-20261009/merchant-fleet-gateway/state-lease.mjs';
import {
  documentProviders, documentPriceReview, documentError
} from './contracts.mjs';
import {
  documentSetupTemplate, prepareDocumentMerchant, inspectDocumentMerchant, readDocumentSetupRequest,
  reviewDocumentMerchant
} from './setup.mjs';
import {readDocumentSupplierUsage} from './renderer.mjs';
import {runDocumentAgentCommand} from './agent-cli.mjs';
import {runDocumentCommissioningCommand} from './commissioning-cli.mjs';
import {runDocumentAssemblyCommand} from './assembly-cli.mjs';
import {runDocumentBatchCommand} from './batch-cli.mjs';
import {runDocumentCompositionCommand} from './composition-cli.mjs';
import {readDocumentServiceSelection, runDocumentServiceCommand} from './launch.mjs';


const HELP = [
  'Starforge document merchant', '',
  'Install and run a complete HTML or Markdown document service on the existing paid Jobs engine.', '',
  '  document-merchant providers',
  '  document-merchant agent --help',
  '  document-merchant commission --help',
  '  document-merchant batch --help',
  '  document-merchant assemble --help',
  '  document-merchant compose --help',
  '  document-merchant compose serve --workspace-options FILE [--provider ID] [--merchant-origin URL]',
  '  document-merchant template --provider mintpdf|snaplab|pdfmint [--anonymous] [--assembly] [--out NEW_FILE]',
  '  document-merchant review --request FILE --directory DIR',
  '  document-merchant prepare --request FILE --directory DIR',
  '  document-merchant inspect --directory DIR',
  '  document-merchant price --directory DIR [--documents N] [--supplier-units N]',
  '  document-merchant usage --directory DIR --out NEW_PRIVATE_FILE',
  '  document-merchant customer-setup --directory DIR [--out NEW_FILE]',
  '  document-merchant inspect-service --directory DIR [--initialize FILE] [service options]',
  '  document-merchant launch --directory DIR [--initialize FILE] [service options]',
  '       [--native-factory MODULE] [--start-worker] [--seller-port N] [--customer-port N]',
  '       [--operator-port N | --port N] [--operations-port N] [--intake-config FILE]',
  '       [--delivery-config FILE] [--delivery-state DIR] [--start-delivery] [--landing PAGE]',
  '  document-merchant serve --directory DIR [original jobs serve options]',
  '  document-merchant jobs --directory DIR COMMAND [original jobs command options]', '',
  'Prepare retains one complete provider application and the original Jobs configuration.',
  'Supply actual merchant payment terms in the template before preparing.',
  'Provider credentials are environment values; configuration names the variable only.',
  'usage performs the documented read-only provider account request and saves its full response.',
  'Snaplab accepts HTML; MintPDF and PDFMint also accept Markdown.', '',
  'launch reviews and prepares or reopens the same setup before starting its original Jobs service.',
  'Applications uses launch with the exact reviewed source and native service choices.',
  'inspect-service reads the complete provider, native price, worker and source selection without starting it.',
  'serve uses the already prepared original Jobs service, factory, worker and customer/operator workspaces.',
  'For native payments include --native-factory MODULE and --start-worker.',
  'jobs forwards the original status, create, work, show, outputs, output-file, retry and cancel operations.',
  'compose serve opens Document production with complete data/template input and the original customer.',
  'The original customer Request application stages the whole source file before checkout.'
].join('\n');
function commandError(message) {return documentError('DOCUMENT_COMMAND_INVALID', message);}
function options(argv, allowed, booleans = []) {
  const out = new Map();
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (!allowed.includes(flag) || out.has(flag)) throw commandError('Unknown or repeated option: ' + flag);
    if (booleans.includes(flag)) {out.set(flag, true); continue;}
    const value = argv[++i];
    if (value === undefined || value.startsWith('--')) throw commandError('Supply a value for ' + flag + '.');
    out.set(flag, value);
  }
  return out;
}
function required(out, flag) {
  if (!out.has(flag)) throw commandError('Supply ' + flag + '.');
  return out.get(flag);
}
function count(out, flag, fallback) {
  const value = out.get(flag);
  if (value === undefined) return fallback;
  if (!/^(?:0|[1-9][0-9]*)$/.test(value)) throw commandError(flag + ' requires a whole nonnegative number.');
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw commandError(flag + ' exceeds the supported count.');
  return number;
}
async function save(path, value) {
  path = absolute(path);
  await ownedDirectory(dirname(path), {create: true});
  const bytes = encoded(value), lease = await acquireStateLease(dirname(path));
  try {
    lease.assertHeld();
    await writeExact(path, bytes);
    return {path, bytes: bytes.length, sha256: digest(bytes)};
  } finally {await lease.close();}
}
function forwarded(argv) {
  const position = argv.indexOf('--directory');
  if (position < 0 || argv.lastIndexOf('--directory') !== position || !argv[position + 1] ||
    argv[position + 1].startsWith('--')) throw commandError('Supply one --directory DIR.');
  const rest = [...argv.slice(0, position), ...argv.slice(position + 2)];
  if (rest.some(value => value === '--config' || value === '--state'))
    throw commandError('The retained document setup selects its original Jobs configuration and state.');
  return {directory: argv[position + 1], rest};
}
const serviceFlags = ['--directory', '--initialize', '--native-factory', '--intake-config',
  '--delivery-config', '--delivery-state', '--seller-port', '--customer-port',
  '--operator-port', '--port', '--operations-port', '--start-worker', '--start-delivery', '--landing'];
function serviceOptions(out) {
  if (out.has('--port') && out.has('--operator-port'))
    throw commandError('Select --port or --operator-port for the same original private operator.');
  const result = {
    directory: absolute(required(out, '--directory')),
    sellerPort: count(out, '--seller-port', 0), customerPort: count(out, '--customer-port', 0),
    operatorPort: count(out, out.has('--port') ? '--port' : '--operator-port', 0),
    operationsPort: count(out, '--operations-port', 0),
    startWorker: out.has('--start-worker'), startDelivery: out.has('--start-delivery'),
    landing: out.get('--landing') ?? 'jobs'
  };
  for (const [name, flag] of [['configurationFile', '--initialize'],
    ['nativeFactoryPath', '--native-factory'], ['intakeConfigPath', '--intake-config'],
    ['deliveryConfigPath', '--delivery-config'], ['deliveryDirectory', '--delivery-state']]) {
    if (out.has(flag)) result[name] = absolute(out.get(flag));
  }
  return result;
}
export async function runDocumentCommand(argv = process.argv.slice(2), {print = value => console.log(value)} = {}) {
  if (!argv.length || argv.length === 1 && ['--help', '-h', 'help'].includes(argv[0])) return print(HELP);
  const [command, ...tail] = argv;
  if (command === 'agent') return runDocumentAgentCommand(tail,{print});
  if (command === 'commission') return runDocumentCommissioningCommand(tail,{print});
  if (command === 'assemble') return runDocumentAssemblyCommand(tail,{print});
  if (command === 'batch') return runDocumentBatchCommand(tail,{print});
  if (command === 'compose') return runDocumentCompositionCommand(tail,{print});
  const emit = value => print(JSON.stringify(value, null, 2));
  if (command === 'providers') {
    if (tail.length) throw commandError('providers takes no options.');
    return emit(documentProviders());
  }
  if (command === 'template') {
    const out = options(tail, ['--provider', '--anonymous', '--assembly', '--out'], ['--anonymous', '--assembly']);
    const value = documentSetupTemplate(required(out, '--provider'), {anonymous: out.has('--anonymous'), assembly: out.has('--assembly')});
    return emit(out.has('--out') ? await save(out.get('--out'), value) : value);
  }
  if (command === 'prepare' || command === 'review') {
    const out = options(tail, ['--request', '--directory']);
    const input = {
      request: await readDocumentSetupRequest(required(out, '--request')),
      directory: required(out, '--directory')
    };
    return emit(await (command === 'prepare' ? prepareDocumentMerchant(input) : reviewDocumentMerchant(input)));
  }
  if (command === 'launch' || command === 'inspect-service') {
    const out = options(tail, [...serviceFlags, ...(command === 'launch'
      ? ['--managed-source', '--expected-selection', '--managed-launch'] : [])],
    ['--start-worker', '--start-delivery']);
    const selected = serviceOptions(out);
    if (command === 'inspect-service') return emit(await readDocumentServiceSelection(selected));
    const launchSourceDirectory = dirname(fileURLToPath(import.meta.url));
    const sourceDirectory = out.has('--managed-source') ? absolute(out.get('--managed-source')) : launchSourceDirectory;
    const original = sourceDirectory === launchSourceDirectory ? {runDocumentServiceCommand} :
      await import(pathToFileURL(join(sourceDirectory, 'launch.mjs')).href);
    if (typeof original.runDocumentServiceCommand !== 'function')
      throw commandError('Select the complete original document service source.');
    return original.runDocumentServiceCommand(selected, {
      print, launchSourceDirectory, expectedSelection: out.get('--expected-selection'),
      launchFile: out.has('--managed-launch') ? absolute(out.get('--managed-launch')) : null
    });
  }
  if (command === 'serve' || command === 'jobs') {
    const selected = forwarded(tail);
    const installation = await inspectDocumentMerchant(selected.directory);
    let operation, rest;
    if (command === 'serve') {operation = 'serve'; rest = selected.rest;}
    else {
      [operation, ...rest] = selected.rest;
      if (!operation || operation.startsWith('--')) throw commandError('Supply the original Jobs command.');
    }
    if (['inputs', 'delivery', 'receiver', 'recovery'].includes(operation))
      throw commandError('Use the original jobs ' + operation + ' command with jobsConfig and merchantState from inspect.');
    return runJobCommand([operation, '--config', installation.jobsConfig, '--state', installation.merchantState,
      ...rest], {print});
  }
  const allowed = {
    inspect: ['--directory'], price: ['--directory', '--documents', '--supplier-units'],
    usage: ['--directory', '--out'], 'customer-setup': ['--directory', '--out']
  };
  if (!Object.hasOwn(allowed, command)) throw commandError('Choose a command from --help.');
  const out = options(tail, allowed[command]);
  const installation = await inspectDocumentMerchant(required(out, '--directory'));
  if (command === 'inspect') return emit(installation);
  if (command === 'price') {
    const documents = count(out, '--documents', 1);
    return emit({
      ...documentPriceReview(installation.provider,
        {documents, supplierUnits: count(out, '--supplier-units', documents)}),
      merchantPaymentPerDocument: installation.payment,
      customerTaskUnits: {documentRequests: documents, outputPackages: documents, parentTaskCount: null},
      meaning: 'Each document request has one merchant payment and one output package. Parent-task count comes from the original task references and complete customer acceptance. Supplier units may differ for cache hits or explicit rerenders.'
    });
  }
  if (command === 'usage') {
    const destination = required(out, '--out');
    const result = await readDocumentSupplierUsage(installation.provider);
    const saved = await save(destination, result);
    return emit({provider: result.provider, observedAt: result.observedAt,
      originalAccountUrl: result.url, retainedAccountResponse: saved});
  }
  const value = parse(await ownedBytes(installation.customerSetup, 1048576));
  return emit(out.has('--out') ? await save(out.get('--out'), value) : value);
}
function invokedDirectly() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url));
  } catch {return false;}
}
if (invokedDirectly()) {
  runDocumentCommand().catch(error => {
    console.error(error.code ? error.code + ': ' + error.message : error.message);
    process.exitCode = 1;
  });
}
