// MIT. One original merchant lifetime for CLI and managed Applications.
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openJobMerchant } from '../model.mjs';
import { startJobSeller } from '../merchant.mjs';
import { startCustomerServer } from '../customer.mjs';
import { startJobsWorkspace } from '../workspace/server.mjs';
import { openResultDelivery } from '../result-delivery/dispatcher.mjs';
import { readDeliveryConfig } from '../result-delivery/config.mjs';
import { canonical, jobError } from '../config.mjs';
import { readJobServiceSelection, assertJobServiceSelection, normalizeJobServiceOptions } from './selection.mjs';
import { JOB_SERVICE_IDENTITY_SCHEMA } from '../workspace/identity.mjs';
import { JOB_SERVICE_LAUNCH_SCHEMA, JOB_SERVICE_EXIT_SCHEMA, assertJobServiceLaunchTarget,
  jobServiceExitPath, writeJobServiceRecord } from './launch.mjs';

const factorySources = new Map();
const now = () => new Date().toISOString();
const fail = (code, status = 409) => { throw jobError(code, status); };
const errorCode = error => typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{0,95}$/.test(error.code)
  ? error.code : error?.name === 'AbortError' ? 'JOB_SERVICE_ABORTED' : 'JOB_SERVICE_FAILED';
function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  promise.catch(() => {});
  return { promise, resolve, reject };
}
function record(selection, { instanceId, startedAt, seller, customer, workspace, delivery }) {
  const operator = workspace.url;
  const links = { jobs: operator, inputs: workspace.inputReceivingUrl, resolutions: workspace.resolutionUrl,
    deliveries: delivery ? workspace.origin + '/deliveries#' + workspace.token : null };
  return {
    schema: JOB_SERVICE_LAUNCH_SCHEMA, state: 'LISTENING', service: 'starforge-paid-jobs',
    instanceId, pid: process.pid, startedAt,
    directory: selection.directory, configPath: selection.configPath,
    runtimeDirectory: selection.runtimeDirectory, source: selection.source,
    applicationPath: selection.applicationPath, sourceBinding: selection.sourceBinding,
    selectionSha256: selection.selectionSha256, requestedPorts: selection.ports,
    startWorker: selection.startWorker, startDelivery: selection.startDelivery,
    nativeFactory: selection.nativeFactory, intakeConfiguration: selection.intake.file,
    deliveryConfiguration: selection.delivery?.file ?? null,
    seller: seller.url, customer: customer.url, operator,
    operations: seller.operations.url, intake: customer.intakeUrl,
    inputReceiving: links.inputs, resolution: links.resolutions, deliveries: links.deliveries,
    deliveryState: delivery ? delivery.snapshot().directory : null,
    mode: seller.mode, landing: selection.landing, entryUrl: links[selection.landing],
  };
}
export function jobServiceAnnouncement(value, privateLaunch = null) {
  return {
    schema: value.schema, state: value.state, service: value.service,
    instanceId: value.instanceId, pid: value.pid, selectionSha256: value.selectionSha256,
    seller: value.seller, customer: value.customer, operator: value.operator,
    operations: value.operations, intake: value.intake, mode: value.mode,
    inputReceiving: value.inputReceiving, resolution: value.resolution,
    deliveries: value.deliveries, deliveryState: value.deliveryState,
    landing: value.landing, entryUrl: value.entryUrl,
    ...(privateLaunch ? { privateLaunch } : {}),
  };
}

/**
 * Opens the original seller/customer/operator/worker under one merchant lease.
 * An AbortSignal closes that same lifetime, including a stop during startup.
 */
export async function openJobService(rawOptions, {
  env = process.env, signal, expectedSelection, expectedRuntime, launchFile = null,
} = {}) {
  const options = normalizeJobServiceOptions(rawOptions);
  if (expectedSelection !== undefined && !/^[a-f0-9]{64}$/.test(expectedSelection))
    fail('JOB_SERVICE_EXPECTED_SELECTION_INVALID', 400);
  if (signal !== undefined && !(signal instanceof AbortSignal)) fail('JOB_SERVICE_SIGNAL_INVALID', 400);
  const stop = new AbortController();
  const stopped = signal ? AbortSignal.any([stop.signal, signal]) : stop.signal;
  const completed = deferred(), instanceId = randomUUID(), startedAt = now();
  let model, seller, customer, workspace, delivery, selection, launch;
  let phase = 'review-source', ready = false, stopping = false, closing, failure = null, ownsLaunch = false;
  const sessions = [];
  const check = () => stopped.throwIfAborted();
  const onAbort = () => { if (ready && !stopping) close().catch(() => {}); };
  stopped.addEventListener('abort', onAbort, { once: true });

  function close() {
    if (closing) return closing;
    stopping = true;
    stop.abort(jobError('JOB_SERVICE_STOPPED', 409));
    closing = (async () => {
      const errors = [];
      // Close admission on every original listener before releasing the merchant.
      const draining = [...sessions].reverse().map(session => {
        try { return session.close(); } catch (error) { return Promise.reject(error); }
      });
      if (delivery) {
        try { draining.push(delivery.close()); } catch (error) { draining.push(Promise.reject(error)); }
      }
      for (const outcome of await Promise.allSettled(draining))
        if (outcome.status === 'rejected') errors.push(outcome.reason);
      try { await model?.close(); } catch (error) { errors.push(error); }
      stopped.removeEventListener('abort', onAbort);
      const outcome = {
        schema: JOB_SERVICE_EXIT_SCHEMA, instanceId, pid: process.pid, startedAt, closedAt: now(),
        state: failure || errors.length ? 'FAILED' : 'STOPPED', phase,
        directory: selection?.directory ?? options.directory,
        configPath: selection?.configPath ?? options.configPath,
        selectionSha256: selection?.selectionSha256 ?? null,
        error: failure ? errorCode(failure) : null, closeErrors: errors.map(errorCode),
      };
      // This file belongs to the maintained managed operation, whose worker is still alive.
      if (ownsLaunch) {
        try { await writeJobServiceRecord(jobServiceExitPath(dirname(launchFile)), outcome); }
        catch (error) { errors.push(error); }
      }
      if (errors.length) {
        const error = new AggregateError(errors, 'Original job service did not fully drain.');
        error.code = 'JOB_SERVICE_CLOSE_FAILED'; completed.reject(error); throw error;
      }
      completed.resolve(outcome);
      return outcome;
    })();
    return closing;
  }

  try {
    check();
    if (launchFile) { await assertJobServiceLaunchTarget(launchFile); ownsLaunch = true; }
    selection = assertJobServiceSelection(await readJobServiceSelection(options), expectedSelection);
    if (expectedRuntime !== undefined && selection.runtimeDirectory !== expectedRuntime)
      fail('JOB_SERVICE_RUNTIME_CHANGED');
    check(); phase = 'open-merchant';
    model = await openJobMerchant({ configPath: selection.configPath, directory: selection.directory, env });
    check();
    const bound = assertJobServiceSelection(await readJobServiceSelection(options), selection.selectionSha256);
    const original = await model.snapshot();
    if (canonical(original.source) !== canonical(bound.source) || original.directory !== bound.directory ||
        original.configPath !== bound.configPath) fail('JOB_SERVICE_OWNER_CHANGED');
    let nativeFactory = null;
    if (selection.nativeFactory) {
      phase = 'load-native-factory';
      const { path, sha256 } = selection.nativeFactory, previous = factorySources.get(path);
      if (previous !== undefined && previous !== sha256) fail('JOB_SERVICE_FACTORY_RESTART_REQUIRED');
      const imported = await import(pathToFileURL(path).href);
      factorySources.set(path, sha256);
      nativeFactory = imported.nativeFactory ?? imported.default;
      if (typeof nativeFactory !== 'function') fail('JOB_SERVICE_NATIVE_FACTORY_REQUIRED', 400);
      assertJobServiceSelection(await readJobServiceSelection(options), selection.selectionSha256);
    }
    check(); phase = 'open-seller';
    seller = await startJobSeller(model, { port: selection.ports.seller, nativeFactory,
      operationsPort: selection.ports.operations });
    sessions.push(seller);
    check(); phase = 'open-customer';
    customer = await startCustomerServer({ model, port: selection.ports.customer,
      intakeConfig: selection.intake.configuration, env });
    sessions.push(customer);
    if (selection.delivery) {
      check(); phase = 'open-delivery';
      delivery = await openResultDelivery({ model,
        config: await readDeliveryConfig(selection.delivery.file.path),
        directory: selection.delivery.directory, env });
    }
    check(); phase = 'open-workspace';
    workspace = await startJobsWorkspace({ model, delivery, port: selection.ports.operator,
      serviceIdentity: { schema: JOB_SERVICE_IDENTITY_SCHEMA, instanceId, selectionSha256: selection.selectionSha256 } });
    sessions.push(workspace);
    assertJobServiceSelection(await readJobServiceSelection(options), selection.selectionSha256);
    if (selection.startWorker) { check(); phase = 'start-worker'; await model.startWorker(); }
    if (selection.startDelivery) { check(); phase = 'start-delivery'; await delivery.start(); }
    check(); phase = 'write-launch';
    launch = record(selection, { instanceId, startedAt, seller, customer, workspace, delivery });
    if (launchFile) await writeJobServiceRecord(launchFile, launch);
    check(); phase = 'listening'; ready = true;
    return { model, seller, customer, workspace, delivery, selection, launch,
      launchFile, closed: completed.promise, close };
  } catch (error) {
    failure = stopped.aborted && (error === stopped.reason || error?.name === 'AbortError') ? null : error;
    try { await close(); }
    catch (cleanup) { throw new AggregateError([error, cleanup], 'Original job service startup and cleanup failed.'); }
    throw error;
  }
}

/** Foreground command over the same owner; signal handlers are installed before source/startup work. */
export async function runJobServiceCommand(options, {
  print = value => console.log(value), expectedSelection, expectedRuntime, launchFile = null, signal,
} = {}) {
  const stop = new AbortController();
  const selected = signal ? AbortSignal.any([signal, stop.signal]) : stop.signal;
  const interrupt = () => stop.abort(jobError('JOB_SERVICE_STOPPED', 409));
  process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
  let service;
  try {
    service = await openJobService(options, { signal: selected, expectedSelection, expectedRuntime, launchFile });
    selected.throwIfAborted();
    print(JSON.stringify(jobServiceAnnouncement(service.launch, launchFile)));
    return await service.closed;
  } catch (error) {
    if (selected.aborted && (error === selected.reason || error?.name === 'AbortError')) return;
    throw error;
  } finally {
    process.off('SIGINT', interrupt); process.off('SIGTERM', interrupt);
    await service?.close();
  }
}
