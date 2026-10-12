// MIT. Receive one installed OpenAPI application through the original Applications lifecycle.
import { lstat, readFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const ROOT = 'stellar/scf-starforge-20261009/';
const SCHEMA = 'stellar-forge.openapi-managed-reception.v1';
const sha256 = value => createHash('sha256').update(value).digest('hex');
const moduleAt = (root, path) => import(pathToFileURL(join(root, ROOT + path)).href);
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);
function requireValue(value, code) {
  if (!value) throw Object.assign(new Error(code), { code });
}
function pathValue(value) {
  requireValue(typeof value === 'string' && isAbsolute(value) && resolve(value) === value,
    'OPENAPI_RECEIVING_ABSOLUTE_PATH_REQUIRED');
  return value;
}
function argument(args, name, optional = false) {
  const positions = args.flatMap((value, index) => value === name ? [index] : []);
  if (optional && !positions.length) return null;
  requireValue(positions.length === 1 && typeof args[positions[0] + 1] === 'string',
    'OPENAPI_RECEIVING_COMMAND_CHANGED');
  return args[positions[0] + 1];
}
function installSelection(value) {
  return { runtimeDirectory: value.directory, installationId: value.installationId,
    sourceCommit: value.sourceCommit, sourceManifestSha256: value.sourceManifestSha256 };
}
function publicProfiles(rows) {
  return rows.map(row => ({ alias: row.alias, directoryEnv: row.directoryEnv,
    profileSha256: row.profileSha256, source: { sha256: row.source.sha256, scheme: row.source.scheme },
    callbackPath: row.callbackPath, callbackUri: row.callbackUri })).sort((a, b) => a.alias.localeCompare(b.alias));
}
function unauthorized(status) {
  return status?.grant?.id === null && status.grant.state === 'disconnected' &&
    status.grant.review === null && status.grant.hasRefreshToken === false &&
    Array.isArray(status.grant.scopes) && status.grant.scopes.length === 0;
}
async function absent(path) {
  try { await lstat(path); return false; }
  catch (error) { if (error.code !== 'ENOENT') throw error; return true; }
}

/**
 * Consume an actual READY installation and existing initialized, unauthorized
 * OAuth profiles. This receiver performs no provider consent or grant mutation.
 * It does not build, install, alter, or synthesize a runtime descriptor.
 */
export async function receiveOpenApiManagedApplication(config, {
  onProgress = () => {}, signal,
} = {}) {
  for (const name of ['runtimeDirectory', 'receptionDirectory']) pathValue(config[name]);
  requireValue(/^[a-f0-9]{40}$/.test(config.expectedSourceCommit ?? '') &&
    /^[a-f0-9]{64}$/.test(config.expectedManifest ?? ''), 'OPENAPI_RECEIVING_INSTALLED_SOURCE_REQUIRED');
  requireValue(config.settings && typeof config.settings === 'object' && !Array.isArray(config.settings),
    'OPENAPI_RECEIVING_SETTINGS_REQUIRED');
  const settings = {
    outputParent: pathValue(config.settings.outputParent),
    port: config.settings.port,
    oauthConnectionsFile: pathValue(config.settings.oauthConnectionsFile),
    environmentFile: pathValue(config.settings.environmentFile),
    allowLoopbackOAuth: config.settings.allowLoopbackOAuth === true,
  };
  requireValue(Number.isInteger(settings.port) && settings.port > 0 && settings.port !== 80 &&
    settings.port <= 65535, 'OPENAPI_RECEIVING_REGISTERED_PORT_REQUIRED');
  if (config.settings.allowLoopbackOAuth !== undefined)
    requireValue(typeof config.settings.allowLoopbackOAuth === 'boolean', 'OPENAPI_RECEIVING_SETTINGS_REQUIRED');
  requireValue(config.legacy && typeof config.legacy === 'object' &&
    /^[a-f0-9]{40}$/.test(config.legacy.expectedSourceCommit ?? '') &&
    /^[a-f0-9]{64}$/.test(config.legacy.expectedManifest ?? ''), 'OPENAPI_RECEIVING_LEGACY_INSTALLATION_REQUIRED');
  pathValue(config.legacy.runtimeDirectory);
  const bootstrapSourceRoot = pathValue(config.bootstrapSourceRoot ??
    join(config.runtimeDirectory, 'package', 'source'));
  const { inspectMerchantRuntime } = await moduleAt(bootstrapSourceRoot, 'sf46-release/runtime-package.mjs');
  const installed = await inspectMerchantRuntime(config.runtimeDirectory,
    { expectedManifest: config.expectedManifest, load: false });
  requireValue(installed.sourceCommit === config.expectedSourceCommit, 'OPENAPI_RECEIVING_SOURCE_CHANGED');
  const legacy = await inspectMerchantRuntime(config.legacy.runtimeDirectory,
    { expectedManifest: config.legacy.expectedManifest, load: false });
  requireValue(legacy.sourceCommit === config.legacy.expectedSourceCommit &&
    await absent(join(legacy.sourceRoot, ROOT + 'sf61-openapi-seller-import/workspace/managed-launch.mjs')),
  'OPENAPI_RECEIVING_LEGACY_SOURCE_REQUIRED');

  const [
    { createRuntimeWorkspace, openRuntimeWorkspace },
    { applicationEnvironment },
    { managedCommandAlive },
    { inspectOpenApiLaunch, startManagedOpenApiWorkspace },
    { startWorkspace },
    { oauthConnectionStatus },
    { makePrivate, privateDirectory, readJSON, saveJSON, operationLease },
  ] = await Promise.all([
    moduleAt(installed.sourceRoot, 'distribution/runtime-workspace/model.mjs'),
    moduleAt(installed.sourceRoot, 'distribution/runtime-workspace/application-command.mjs'),
    moduleAt(installed.sourceRoot, 'distribution/runtime-workspace/managed-workspace.mjs'),
    moduleAt(installed.sourceRoot, 'sf61-openapi-seller-import/workspace/managed-launch.mjs'),
    moduleAt(installed.sourceRoot, 'sf61-openapi-seller-import/workspace/server.mjs'),
    moduleAt(installed.sourceRoot, 'sf30-seller-sdk/oauth-connections/connection.mjs'),
    moduleAt(installed.sourceRoot, 'distribution/runtime-workspace/storage.mjs'),
  ]);
  const environment = await applicationEnvironment(settings.environmentFile);
  const initial = await inspectOpenApiLaunch(settings, { env: environment.environment, allowMissingOutput: true });
  requireValue(initial.binding.profiles.length > 0, 'OPENAPI_RECEIVING_REGISTERED_PROFILES_REQUIRED');
  const checkUnauthorized = async () => {
    for (const profile of initial.binding.profiles) {
      const current = await oauthConnectionStatus(profile.directory.directory,
        { allowLoopback: settings.allowLoopbackOAuth });
      requireValue(current.profileSha256 === profile.profileSha256 && unauthorized(current),
        'OPENAPI_RECEIVING_UNAUTHORIZED_PROFILE_REQUIRED');
    }
  };
  await checkUnauthorized();
  const privateFolder = async path => {
    try { await makePrivate(path); }
    catch (error) { if (error.code !== 'EEXIST') throw error; await privateDirectory(path); }
  };
  await privateFolder(config.receptionDirectory);
  const applicationWorkspace = pathValue(config.applicationWorkspace ??
    join(config.receptionDirectory, 'runtime-workspace'));
  const lease = await operationLease(join(config.receptionDirectory, 'receiving.lock'));
  const receiptPath = join(config.receptionDirectory, 'openapi-managed-reception.json');
  const legacyOutput = join(config.receptionDirectory, 'legacy-projects');
  let journal, model, ownedPass = null, stage = 'OPEN_RECEIVING', result, failure;
  const persist = async () => {
    journal.updatedAt = new Date().toISOString();
    await saveJSON(receiptPath, journal, true);
  };
  const progress = value => onProgress({ stage, applicationId: journal?.applicationId ?? null, ...value });
  const aborted = () => {
    if (signal?.aborted) throw Object.assign(new Error('OPENAPI_RECEIVING_ABORTED'), { code: 'OPENAPI_RECEIVING_ABORTED' });
  };
  const app = async () => {
    const value = (await model.applicationsState()).applications.find(item => item.id === journal.applicationId);
    requireValue(value, 'OPENAPI_RECEIVING_APPLICATION_MISSING');
    return value;
  };
  const rowAlive = async row => Boolean(row?.active ||
    row?.state && await managedCommandAlive(row.state));
  const waitFor = async (label, accept, recover, cleanup = false) => {
    const started = Date.now(), recovered = new Set(); let nextProgress = 0;
    for (;;) {
      if (!cleanup) aborted();
      const value = await app();
      if (await accept(value)) return value;
      const current = value.current ?? value.adoption;
      if (recover && current && !await rowAlive(current) &&
          ['INTERRUPTED', 'QUEUED'].includes(current.phase)) {
        const key = JSON.stringify([current.id, current.phase, current.state]);
        if (!recovered.has(key)) { recovered.add(key); await recover(value); continue; }
      }
      if (!cleanup && (value.phase === 'UNAVAILABLE' || value.phase === 'FAILED' ||
          value.adoption?.phase === 'FAILED'))
        throw Object.assign(new Error('OPENAPI_RECEIVING_ORIGINAL_OPERATION_FAILED'),
          { code: 'OPENAPI_RECEIVING_ORIGINAL_OPERATION_FAILED' });
      if (!cleanup && Date.now() >= nextProgress) {
        progress({ label, phase: value.phase, operationId: current?.id ?? null });
        nextProgress = Date.now() + 15000;
      }
      if (Date.now() - started > (cleanup ? 60000 : 300000))
        throw Object.assign(new Error('OPENAPI_RECEIVING_ORIGINAL_OPERATION_PENDING'),
          { code: 'OPENAPI_RECEIVING_ORIGINAL_OPERATION_PENDING' });
      await delay(500);
    }
  };
  const stopPass = async pass => {
    const existing = (await app()).runs.find(row => row.id === pass.requestId);
    if (!existing) return;
    await model.applicationsStop({ applicationId: journal.applicationId, operationId: pass.requestId });
    const stopped = await waitFor('Drain the original managed OpenAPI host', async value => {
      const row = value.runs.find(item => item.id === pass.requestId);
      return row && !await rowAlive(row) && ['SUCCEEDED', 'CANCELLED'].includes(row.phase);
    }, null, true);
    const row = stopped.runs.find(item => item.id === pass.requestId);
    pass.stoppedAt = new Date().toISOString(); pass.terminalPhase = row.phase;
    pass.applicationPhaseAfterStop = stopped.phase;
    await persist();
  };

  try {
    journal = await readJSON(receiptPath, true);
    const selection = {
      ...installSelection(installed), legacy: installSelection(legacy), applicationWorkspace,
      homeId: config.homeId ?? null, settings,
      environmentSha256: environment.sha256, profiles: publicProfiles(initial.binding.profiles),
    };
    if (journal) {
      requireValue(journal.schema === SCHEMA && equal(journal.selection, selection),
        'OPENAPI_RECEIVING_SELECTION_CHANGED');
    } else {
      requireValue(!initial.binding.output.exists, 'OPENAPI_RECEIVING_NEW_PROJECT_FOLDER_REQUIRED');
      journal = { schema: SCHEMA, createdAt: new Date().toISOString(), selection,
        outputAbsentBeforeReview: true, saveRequestId: randomUUID(),
        passes: [{ name: 'first-open', requestId: randomUUID() }, { name: 'reopen', requestId: randomUUID() }] };
      await saveJSON(receiptPath, journal);
    }
    if (journal.completedAt) return journal;
    if (await absent(join(applicationWorkspace, 'workspace.json'))) {
      requireValue(!config.applicationWorkspace, 'OPENAPI_RECEIVING_EXISTING_APPLICATIONS_WORKSPACE_MISSING');
      await createRuntimeWorkspace({ directory: applicationWorkspace });
    }
    model = await openRuntimeWorkspace({ directory: applicationWorkspace });
    const attached = await model.attach({ directory: installed.directory, label: config.label ?? 'Managed API authoring' });
    journal.runtimeId = attached.runtimeId; await persist();

    if (!journal.legacyReview) {
      stage = 'REVIEW_LEGACY_SOURCE'; aborted();
      const previous = await model.attach({ directory: legacy.directory, label: 'Original plain OpenAPI runtime' });
      const review = await model.applicationsReview({ runtimeId: previous.runtimeId, kind: 'openapi',
        label: 'Original plain OpenAPI selection', settings: { outputParent: legacyOutput, port: 0 } });
      requireValue(review.command.command === 'openapi-workspace' &&
        argument(review.command.args, '--out-parent') === legacyOutput &&
        argument(review.command.args, '--port') === '0' &&
        !review.command.args.includes('--managed-launch-sha256') &&
        !review.command.args.includes('--oauth-connections') && review.command.openapi === undefined,
      'OPENAPI_RECEIVING_LEGACY_COMMAND_CHANGED');
      let rejected = null;
      try {
        await model.applicationsReview({ runtimeId: previous.runtimeId, kind: 'openapi',
          label: 'Managed OAuth requires the current runtime', settings: { ...settings, outputParent: legacyOutput } });
      } catch (error) { rejected = error.code; }
      requireValue(rejected === 'APPLICATION_OPENAPI_NOT_IN_RUNTIME', 'OPENAPI_RECEIVING_LEGACY_OAUTH_NOT_REJECTED');
      journal.legacyReview = { runtimeId: previous.runtimeId, reviewId: review.id, command: review.command.command,
        args: review.command.args, plainLegacyPreserved: true, configuredOAuthRejection: rejected };
      await persist();
    }

    const checkCommand = command => {
      requireValue(command.command === 'openapi-workspace' &&
        argument(command.args, '--out-parent') === settings.outputParent &&
        argument(command.args, '--port') === String(settings.port) &&
        argument(command.args, '--oauth-connections') === settings.oauthConnectionsFile &&
        /^[a-f0-9]{64}$/.test(argument(command.args, '--managed-launch-sha256')) &&
        command.openapi?.schema === 'stellar-forge.openapi-managed-binding.v1' &&
        command.openapi.bindingSha256 === argument(command.args, '--managed-launch-sha256') &&
        command.environmentFile === settings.environmentFile &&
        command.environmentSha256 === selection.environmentSha256 &&
        equal(publicProfiles(command.openapi.profiles), selection.profiles),
      'OPENAPI_RECEIVING_REVIEW_CHANGED');
    };
    if (!journal.configurationReviewId) {
      stage = 'REVIEW_NEW_FOLDER'; aborted();
      const review = await model.applicationsReview({ runtimeId: attached.runtimeId, kind: 'openapi',
        label: config.label ?? 'Managed API authoring',
        ...(config.homeId ? { homeId: config.homeId } : {}), settings });
      checkCommand(review.command);
      requireValue(review.command.createDirectories.includes(settings.outputParent),
        'OPENAPI_RECEIVING_ORIGINAL_FOLDER_CREATION_REQUIRED');
      journal.configurationReviewId = review.id;
      journal.configurationBindingSha256 = review.command.openapi.bindingSha256;
      await persist();
    }
    if (!journal.applicationId) {
      stage = 'SAVE_AND_ADOPT'; aborted();
      const saved = await model.applicationsSave({ requestId: journal.saveRequestId, reviewId: journal.configurationReviewId });
      journal.applicationId = saved.applicationId; journal.configurationRevision = saved.revision;
      journal.adoptionOperationId = saved.connection?.operationId ?? saved.connection?.id ?? null;
      await persist();
      if (saved.connectionError) throw Object.assign(new Error('OPENAPI_RECEIVING_ADOPTION_REQUIRED'),
        { code: saved.connectionError.code ?? 'OPENAPI_RECEIVING_ADOPTION_REQUIRED' });
    }
    await privateDirectory(settings.outputParent);
    const output = await lstat(settings.outputParent);
    const outputIdentity = { device: String(output.dev), inode: String(output.ino) };
    if (journal.outputIdentity) requireValue(equal(journal.outputIdentity, outputIdentity),
      'OPENAPI_RECEIVING_PROJECT_DIRECTORY_CHANGED');
    else { journal.outputIdentity = outputIdentity; await persist(); }

    stage = 'CONNECT_ORIGINAL_RUNTIME'; aborted();
    await model.applicationsConnect({ applicationId: journal.applicationId });
    const recoverAdoption = async value => {
      const operation = value.adoption;
      if (!operation || await rowAlive(operation)) return;
      const response = operation.phase === 'QUEUED' ? await model.resumeQueued(operation.id) :
        await model.recoverManagedOperation(operation.id);
      journal.adoptionRecovery = { at: new Date().toISOString(), operationId: operation.id,
        response: { operationId: response.operationId ?? response.id ?? operation.id, reopened: response.reopened === true } };
      await persist();
    };
    await waitFor('Adopt the original installed runtime', value => Boolean(value.release), recoverAdoption);

    for (const pass of journal.passes) {
      if (pass.stoppedAt) {
        requireValue(pass.opened, 'OPENAPI_RECEIVING_PREVIOUS_PASS_NEEDS_OPERATOR_REVIEW');
        continue;
      }
      aborted();
      await model.close();
      model = await openRuntimeWorkspace({ directory: applicationWorkspace });
      if (!pass.reviewId) {
        stage = 'REVIEW_' + pass.name.toUpperCase();
        const review = await model.applicationsStartReview({ applicationId: journal.applicationId });
        checkCommand(review.command);
        requireValue(!review.command.createDirectories.length, 'OPENAPI_RECEIVING_SAVED_FOLDER_NOT_REOPENED');
        pass.reviewId = review.id; pass.bindingSha256 = review.command.openapi.bindingSha256;
        pass.args = review.command.args; await persist();
      }
      if (!journal.changedReviewRejection) {
        stage = 'REJECT_UNSELECTED_PROJECT_FOLDER';
        const unselected = join(config.receptionDirectory, 'unselected-projects');
        await privateFolder(unselected);
        const changed = [...pass.args]; changed[changed.indexOf('--out-parent') + 1] = unselected;
        let rejected, unexpected;
        try {
          unexpected = await startManagedOpenApiWorkspace(changed, {
            startWorkspace, env: environment.environment, announce: () => {},
          });
        } catch (error) { rejected = error.code; }
        finally { if (unexpected) await unexpected.close(); }
        requireValue(rejected === 'OPENAPI_MANAGED_INPUTS_CHANGED', 'OPENAPI_RECEIVING_STALE_REVIEW_NOT_REJECTED');
        journal.changedReviewRejection = { code: rejected, bindingSha256: pass.bindingSha256,
          changedField: 'outputParent', unselectedOutput: unselected, observedAt: new Date().toISOString() };
        await persist();
      }
      const recoverPass = async () => {
        const response = await model.applicationsRecover({ applicationId: journal.applicationId, operationId: pass.requestId });
        pass.recovery = { at: new Date().toISOString(),
          operationId: response.operationId ?? response.id ?? pass.requestId, reopened: response.reopened === true };
        await persist();
      };
      ownedPass = pass;
      if (!pass.opened) {
        stage = 'START_' + pass.name.toUpperCase();
        const previous = (await app()).runs.find(row => row.id === pass.requestId);
        if (previous) {
          requireValue(!['SUCCEEDED', 'CANCELLED', 'FAILED'].includes(previous.phase),
            'OPENAPI_RECEIVING_PREVIOUS_PASS_NEEDS_OPERATOR_REVIEW');
          if (!await rowAlive(previous)) await recoverPass();
        } else await model.applicationsStart({ applicationId: journal.applicationId,
          requestId: pass.requestId, reviewId: pass.reviewId });
        const running = await waitFor('Original managed OpenAPI startup', async value => {
          const row = value.runs.find(item => item.id === pass.requestId);
          return Boolean(row?.url?.url && await rowAlive(row));
        }, recoverPass);
        const native = running.runs.find(row => row.id === pass.requestId);
        const original = native.url.original;
        requireValue(original?.schema === 'stellar-forge.openapi-workspace-startup.v1' &&
          original.bindingSha256 === pass.bindingSha256 && original.outputParent === settings.outputParent &&
          original.connectionsFile === settings.oauthConnectionsFile &&
          original.profileCount === selection.profiles.length && original.port === settings.port,
        'OPENAPI_RECEIVING_ORIGINAL_STARTUP_REQUIRED');
        const url = new URL(native.privateUrl ?? native.url.url);
        requireValue(url.protocol === 'http:' && url.hostname === '127.0.0.1' &&
          Number(url.port) === settings.port && /^[a-f0-9]{64}$/.test(url.hash.slice(1)),
        'OPENAPI_RECEIVING_PRIVATE_URL_REQUIRED');
        const get = async path => {
          const response = await fetch(new URL(path, url), { headers: { 'x-workspace-token': url.hash.slice(1) },
            signal: AbortSignal.timeout(15000), redirect: 'error' });
          requireValue(response.ok, 'OPENAPI_RECEIVING_ORIGINAL_HTTP_READ_FAILED');
          return response.json();
        };
        const [packages, connections] = await Promise.all([get('/api/packages'), get('/api/oauth/connections')]);
        requireValue(packages.output === settings.outputParent && Array.isArray(packages.packages) &&
          Array.isArray(connections.connections) && connections.callbackOrigin === url.origin &&
          connections.connections.length === selection.profiles.length, 'OPENAPI_RECEIVING_RUNNING_HOST_CHANGED');
        for (const expected of selection.profiles) {
          const row = connections.connections.find(item => item.alias === expected.alias);
          requireValue(row && row.directoryEnv === expected.directoryEnv &&
            row.profileSha256 === expected.profileSha256 && row.callbackPath === expected.callbackPath &&
            row.profile?.source?.sha256 === expected.source.sha256 &&
            row.profile?.source?.scheme === expected.source.scheme && unauthorized(row),
          'OPENAPI_RECEIVING_RUNNING_PROFILE_CHANGED');
        }
        await checkUnauthorized();
        const stillSelected = await inspectOpenApiLaunch(settings, { env: environment.environment });
        requireValue(stillSelected.bindingSha256 === pass.bindingSha256,
          'OPENAPI_RECEIVING_REVIEW_CHANGED');
        pass.opened = { observedAt: new Date().toISOString(), instanceId: original.instanceId,
          startupSha256: sha256(JSON.stringify(original)), privateUrlSha256: sha256(url.href),
          port: settings.port, outputIdentity: journal.outputIdentity,
          profiles: selection.profiles, packages: packages.packages.map(row => row.name),
          packageNamesSha256: sha256(JSON.stringify(packages.packages.map(row => row.name).sort())) };
        await persist(); progress({ operationId: pass.requestId, phase: 'RUNNING', profileCount: selection.profiles.length });
      }
      stage = 'STOP_' + pass.name.toUpperCase();
      await stopPass(pass); ownedPass = null;
      requireValue(pass.applicationPhaseAfterStop === 'STOPPED', 'OPENAPI_RECEIVING_ORIGINAL_HOST_DID_NOT_STOP');
      progress({ operationId: pass.requestId, phase: 'STOPPED' });
    }
    const [first, reopened] = journal.passes;
    requireValue(first.opened.instanceId !== reopened.opened.instanceId &&
      first.opened.privateUrlSha256 !== reopened.opened.privateUrlSha256 &&
      first.opened.packageNamesSha256 === reopened.opened.packageNamesSha256 &&
      first.bindingSha256 === reopened.bindingSha256, 'OPENAPI_RECEIVING_REOPEN_CHANGED');
    await checkUnauthorized();
    stage = 'COMPLETED'; journal.completedAt = new Date().toISOString(); delete journal.issue;
    await persist(); result = journal;
    progress({ phase: 'COMPLETED', receiptPath });
  } catch (error) {
    failure = error;
    if (journal) {
      journal.issue = { stage, at: new Date().toISOString(), code: error.code ?? 'OPENAPI_RECEIVING_FAILED' };
      await persist().catch(() => {});
    }
  } finally {
    const cleanup = [];
    if (ownedPass && model && journal?.applicationId) {
      try { await stopPass(ownedPass); } catch (error) { cleanup.push(error); }
    }
    if (model) { try { await model.close(); } catch (error) { cleanup.push(error); } }
    try { await lease.close(); } catch (error) { cleanup.push(error); }
    if (cleanup.length) throw new AggregateError([...(failure ? [failure] : []), ...cleanup],
      'The original receiving operation or its owned managed host did not finish cleanly.');
  }
  if (failure) throw failure;
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  requireValue(process.argv.length === 3, 'OPENAPI_RECEIVING_CONFIGURATION_REQUIRED');
  const config = JSON.parse(await readFile(resolve(process.argv[2]), 'utf8'));
  const lifetime = new AbortController();
  const stop = () => lifetime.abort();
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
  try {
    const result = await receiveOpenApiManagedApplication(config, {
      signal: lifetime.signal, onProgress: value => process.stdout.write(JSON.stringify(value) + '\n'),
    });
    process.stdout.write(JSON.stringify({ schema: SCHEMA, status: 'COMPLETED',
      applicationId: result.applicationId, sourceCommit: result.selection.sourceCommit,
      sourceManifestSha256: result.selection.sourceManifestSha256,
      legacySourceCommit: result.selection.legacy.sourceCommit,
      changedReviewRejection: result.changedReviewRejection.code,
      operations: result.passes.map(pass => ({ name: pass.name, operationId: pass.requestId,
        openedAt: pass.opened.observedAt, stoppedAt: pass.stoppedAt, port: pass.opened.port })) }) + '\n');
  } finally { process.removeListener('SIGTERM', stop); process.removeListener('SIGINT', stop); }
}
