// MIT. The original native operator inside the retained Applications lifecycle.
import {lstat, realpath} from 'node:fs/promises';
import {join, dirname, basename} from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {inspectMerchantRuntime} from '../../sf46-release/runtime-package.mjs';
import {APPLICATION_PROVIDER_SCHEMA, observeApplicationStartup}
  from '../../distribution/runtime-workspace/application-provider.mjs';
import {absolute, need, plain, recordId, operationId, readJSON, regular, digest, privateDirectory}
  from '../../distribution/runtime-workspace/storage.mjs';
import {createNativeOperatorClient} from './client.mjs';

const SOURCE = 'stellar/scf-starforge-20261009/native-facilitator/workspace';
const COMMAND = 'native-facilitator-operator';
const LAUNCH = 'stellar-forge.native-operator-launch.v1';

export function nativeOperatorApplication(common, field) {
  return {id:COMMAND, command:COMMAND, title:'Native Stellar facilitator', terminal:false,
    requiredSource:SOURCE + '/application-provider.mjs',
    description:'Review and reopen native payment profiles, run their original backend, inspect durable Bazaar resources and receive a complete catalog view.',
    fields:[
      field('directory', 'Private operator profile directory', 'path', true,
        'Reopen the original operator directory containing profiles/.'),
      field('ownershipDirectory', 'Shared signer ownership directory', 'path', true,
        'Use the same original host directory as every native facilitator sharing these Stellar signing accounts.'),
      field('create', 'Create missing private leaf directories', 'boolean', false,
        'Each parent must already exist. Existing profiles and ownership records stay in their original directories.'),
      ...common]};
}

export async function prepareNativeOperator(settings, {inputPath, runtimeDirectory} = {}) {
  need(typeof inputPath === 'function', 'APPLICATION_NATIVE_OPERATOR_INPUTS_REQUIRED');
  const inputs = [], createDirectories = [], retained = new Set();
  for (const name of ['directory', 'ownershipDirectory']) {
    const selected = await inputPath(absolute(settings[name]), 'directory', settings.create === true, true);
    if (!retained.has(selected.path)) {
      inputs.push(selected); retained.add(selected.path);
      if (!selected.exists) createDirectories.push(selected.path);
    }
  }
  const runtime = await inspectMerchantRuntime(absolute(runtimeDirectory), {load:false, source:false});
  for (const name of ['server.mjs','store.mjs','controller.mjs','client.mjs','catalog-receiving.mjs']) {
    inputs.push(await inputPath(join(runtime.sourceRoot, SOURCE, name), 'file'));
  }
  const args = ['--directory', settings.directory, '--ownership-directory', settings.ownershipDirectory];
  if (settings.create === true) args.push('--create');
  return {args, inputs, createDirectories};
}

function selectedArguments(request) {
  need(Array.isArray(request.args), 'APPLICATION_NATIVE_OPERATOR_ARGUMENTS_CHANGED');
  const fields = new Map(), allowed = new Set(['--directory','--ownership-directory','--port']);
  let create = false;
  for (let at = 0; at < request.args.length; at++) {
    const flag = request.args[at];
    if (flag === '--create') {
      need(!create, 'APPLICATION_NATIVE_OPERATOR_ARGUMENTS_CHANGED'); create = true; continue;
    }
    need(allowed.has(flag) && !fields.has(flag) && typeof request.args[at + 1] === 'string' &&
      request.args[at + 1], 'APPLICATION_NATIVE_OPERATOR_ARGUMENTS_CHANGED');
    fields.set(flag, request.args[++at]);
  }
  const directory = absolute(fields.get('--directory'));
  const ownershipDirectory = absolute(fields.get('--ownership-directory'));
  const port = Number(fields.get('--port') ?? 0);
  need(Number.isSafeInteger(port) && port >= 0 && port <= 65535, 'APPLICATION_NATIVE_OPERATOR_PORT_CHANGED');
  return {directory, ownershipDirectory, port};
}

/** Check the original immutable review and its selected source/configuration files. */
export async function verifyNativeReviewedInputs(request, operationDirectory, command) {
  if (request.command !== command || !request.applicationId) return null;
  const directory = absolute(operationDirectory), root = dirname(dirname(directory));
  const applicationId = recordId(request.applicationId), id = operationId(basename(directory));
  const run = await readJSON(join(root, 'applications', applicationId, 'runs', id + '.json'));
  need(run.applicationId === applicationId && run.id === id && run.request.command === command &&
    isDeepStrictEqual(run.request.args, request.args), 'APPLICATION_NATIVE_OPERATOR_RUN_CHANGED');
  const review = await readJSON(join(root, 'application-reviews', recordId(run.reviewId) + '.json'));
  need(review.schema === 'stellar-forge.application-start-review.v1' &&
    review.applicationId === applicationId && review.command.command === command &&
    isDeepStrictEqual(review.command.args, request.args) && Array.isArray(review.command.inputs),
  'APPLICATION_NATIVE_OPERATOR_REVIEW_CHANGED');
  for (const input of review.command.inputs) {
    if (input.kind === 'file') {
      need(typeof input.sha256 === 'string' &&
        digest(await regular(absolute(input.path), 4 * 1024 * 1024)) === input.sha256,
      'APPLICATION_NATIVE_OPERATOR_SOURCE_CHANGED');
    }
  }
  return review;
}
export async function verifyNativeReviewedDirectories(review, paths) {
  for (const path of new Set(paths)) {
    const input = review.command.inputs.find(value => value.path === path && value.kind === 'directory');
    need(input?.exists === true, 'APPLICATION_NATIVE_OPERATOR_DIRECTORY_CHANGED');
    await privateDirectory(path);
    const current = await lstat(path);
    need(await realpath(path) === path && current.dev === input.dev && current.ino === input.ino,
      'APPLICATION_NATIVE_OPERATOR_DIRECTORY_CHANGED');
  }
}
/** Keep the same native profile and signing-account directory check before its child. */
export async function verifyNativeOperatorLaunch(request, operationDirectory) {
  if (request.command !== COMMAND || !request.applicationId) return;
  const selected = selectedArguments(request);
  const review = await verifyNativeReviewedInputs(request, operationDirectory, COMMAND);
  await verifyNativeReviewedDirectories(review, [selected.directory, selected.ownershipDirectory]);
}

/** Match one authenticated original listener to its retained process and directories. */
export async function nativeOperatorStartup(request, text, context = {}) {
  if (request.command !== COMMAND || !request.applicationId || typeof text !== 'string' ||
    text.length > 16384 || !text.startsWith('{"mode":"NATIVE_FACILITATOR_OPERATOR",')) return null;
  let launch; try {launch = JSON.parse(text);} catch {return null;}
  if (!plain(launch) || launch.mode !== 'NATIVE_FACILITATOR_OPERATOR' || launch.schema !== LAUNCH) return null;
  const selected = selectedArguments(request);
  need(launch.directory === selected.directory && launch.ownershipDirectory === selected.ownershipDirectory &&
    typeof launch.instanceId === 'string' && /^[a-f0-9-]{36}$/.test(launch.instanceId) &&
    Number.isSafeInteger(launch.pid) && launch.pid > 0 &&
    Number.isSafeInteger(context.pid) && context.pid > 0 &&
    (launch.pid === context.pid || launch.ppid === context.pid),
  'APPLICATION_NATIVE_OPERATOR_STARTUP_CHANGED');
  const client = createNativeOperatorClient({operatorUrl:launch.operatorUrl});
  const port = Number(new URL(client.origin).port || 80);
  need(selected.port === 0 || selected.port === port, 'APPLICATION_NATIVE_OPERATOR_PORT_CHANGED');
  const status = await client.status({signal:AbortSignal.timeout(5000)});
  const original = status.workspace;
  need(plain(original) && original.schema === LAUNCH && original.instanceId === launch.instanceId &&
    original.directory === selected.directory && original.ownershipDirectory === selected.ownershipDirectory &&
    original.pid === launch.pid && original.ppid === launch.ppid && original.startedAt === launch.startedAt,
  'APPLICATION_NATIVE_OPERATOR_LISTENER_CHANGED');
  return {url:launch.operatorUrl, original:{schema:LAUNCH, instanceId:original.instanceId,
    directory:original.directory, ownershipDirectory:original.ownershipDirectory,
    pid:original.pid, ppid:original.ppid, startedAt:original.startedAt}};
}

export default {
  schema:APPLICATION_PROVIDER_SCHEMA, id:COMMAND, order:175,
  catalog({common, field}) {return [nativeOperatorApplication(common, field)];},
  prepare(type, settings, context) {return prepareNativeOperator(settings, context);},
  matchRequest(request) {return !request.pythonCommand && request.command === COMMAND;},
  verifyLaunch:verifyNativeOperatorLaunch,
  createObserver(request, directory, context) {
    return observeApplicationStartup(request, directory, text => {
      if (!text.startsWith('{"mode":"NATIVE_FACILITATOR_OPERATOR",')) return null;
      return () => nativeOperatorStartup(request, text, context);
    });
  },
};
