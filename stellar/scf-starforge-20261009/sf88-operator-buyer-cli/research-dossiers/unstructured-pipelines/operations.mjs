// MIT. Private managed-provider job operations; original research receiving remains separate.
import { readdir, link } from 'node:fs/promises';
import { isAbsolute, resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as waitForLaunch } from 'node:timers/promises';
import {
  BuyerError, privateDirectory, readBytes, readJson, writeBytes, writeJson,
  jsonBytes, parseJson, digest, need, object, now, safeCode, syncDirectory,
} from '../../node/store.mjs';
import { withPrivateLock } from '../../../sf30-seller-sdk/routescan/quota.mjs';
import {
  CONFIG_SCHEMA, PLAN_SCHEMA, STATE_SCHEMA, SDK_SOURCE, SERVICE_LIMITS, normalizeConfiguration,
  normalizeProfile, publicSource, canonical, boundedJson, jsonDigest,
  requestId as validRequestId, operationId, inputId, outputId, providerId, text,
  validateJob, validateDetails, phaseForJob, pipelineOutputOptions, selectedOutput,
} from './contract.mjs';
import { createPipelineClient } from './client.mjs';

const PREPARATION_SCHEMA = 'stellar-forge.unstructured-pipelines-preparation.v1';
const COMMAND_SCHEMA = 'stellar-forge.unstructured-pipelines-command.v1';
const CAPTURE_SCHEMA = 'stellar-forge.unstructured-pipelines-capture.v1';
const STATE_LIMIT = 64 * 1024 * 1024, PLAN_LIMIT = 2 * 1024 * 1024, COMMAND_LIMIT = 128 * 1024;
const REJECTIONS = new Set([400, 401, 403, 404, 405, 413, 415, 422, 429]);
const PHASES = new Set(['PREPARED', 'SUBMITTING', 'SUBMISSION_UNKNOWN', 'REJECTED', 'ACTIVE', 'COMPLETED', 'STOPPED', 'FAILED']);
const commandId = value => 'cmd_' + digest(validRequestId(value));
const receiptId = (command, leg) => 'rc_' + digest(command.id + '/' + leg);
const localId = request => 'up_' + digest(validRequestId(request));
const errorView = (code, action, fields = {}) => ({ code, action, at: now(), ...fields });
async function optionalJson(path, max) {
  try { return await readJson(path, max); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function immutableBytes(path, body) {
  try { await writeBytes(path, body, { exclusive: true }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const retained = await readBytes(path, body.length);
    need(retained.length === body.length && digest(retained) === digest(body), 'PIPELINE_RETAINED_FILE_CHANGED');
  }
}
const immutableJson = (path, value) => immutableBytes(path, jsonBytes(value));
function inputSelection(value) {
  need(object(value) && Object.keys(value).every(key => ['path', 'filename', 'contentType', 'sourceRef'].includes(key)),
    'PIPELINE_INPUT_INVALID');
  need(typeof value.path === 'string' && isAbsolute(value.path) && !value.path.includes('\0'), 'PIPELINE_INPUT_PATH_INVALID');
  const filename = text(value.filename, 'PIPELINE_FILENAME_INVALID', 512);
  need(!/[\/\\]/u.test(filename) && filename !== '.' && filename !== '..', 'PIPELINE_FILENAME_INVALID');
  const contentType = text(value.contentType ?? 'application/octet-stream', 'PIPELINE_CONTENT_TYPE_INVALID', 256);
  need(/^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+(?:;[ -~]+)?$/.test(contentType), 'PIPELINE_CONTENT_TYPE_INVALID');
  return {
    path: resolve(value.path), filename, contentType,
    ...(value.sourceRef === undefined ? {} : { sourceRef: boundedJson(value.sourceRef, 8192) }),
  };
}
function initialState(plan) {
  return {
    schema: STATE_SCHEMA, id: plan.id, revision: 0, phase: 'PREPARED',
    providerJobId: null, job: null, details: null, outputs: [], cancel: null,
    reconciliation: null, lastError: null, pendingCommandId: null, activeAction: null,
    lastAction: null, jobReceiptId: null, detailsReceiptId: null, jobObservedAt: null,
    detailsObservedAt: null, updatedAt: plan.preparedAt,
  };
}
function jsonResponse(capture) {
  need(capture?.metadata.complete && capture.metadata.status === 200, 'PIPELINE_PROVIDER_RESPONSE_UNAVAILABLE');
  const type = (capture.metadata.headers['content-type'] ?? '').split(';', 1)[0].trim().toLowerCase();
  need(type === 'application/json' || /^application\/[^/;]+\+json$/.test(type), 'PIPELINE_JSON_CONTENT_TYPE_REQUIRED');
  return parseJson(capture.body);
}
function jobFrom(capture, expectedId = null) {
  return validateJob(jsonResponse(capture), expectedId);
}
function captureError(capture, action, fallback, interrupted = false) {
  return errorView(fallback, action, {
    ...(capture ? { status: capture.metadata.status, receiptId: capture.metadata.id } : {}),
    ...(interrupted ? { interrupted: true } : {}),
  });
}
export async function openPipelineOperations({ directory, configuration, env = process.env, fetchImpl } = {}) {
  const config = normalizeConfiguration(configuration), publicIdentity = publicSource(config).identity;
  const root = await privateDirectory(directory), operationsRoot = await privateDirectory(join(root, 'operations'));
  const client = createPipelineClient({ configuration, env, fetchImpl });
  const controllers = new Set(), tasks = new Set(); let closed = false;
  const launchIdentity = { account: config.account, apiUrl: config.apiUrl };
  const launchName = 'account-launch-' + jsonDigest(launchIdentity);
  const launchPath = join(root, launchName + '.json');
  const folder = id => join(operationsRoot, operationId(id));
  const statePath = id => join(folder(id), 'state.json');
  const commandPath = (id, cmd) => {
    need(/^cmd_[a-f0-9]{64}$/.test(cmd), 'PIPELINE_COMMAND_ID_INVALID');
    return join(folder(id), 'commands', cmd + '.json');
  };
  function active() { need(!closed, 'PIPELINE_SESSION_CLOSED'); }
  function track(work) {
    active(); const pending = Promise.resolve().then(() => { active(); return work(); }); tasks.add(pending);
    pending.then(() => tasks.delete(pending), () => tasks.delete(pending)); return pending;
  }
  async function readPlan(id) {
    const plan = await readJson(join(folder(id), 'plan.json'), PLAN_LIMIT);
    need(plan.schema === PLAN_SCHEMA && plan.id === id && object(plan.payload) &&
      plan.id === localId(plan.payload.request.requestId) && plan.sha256 === jsonDigest(plan.payload),
      'PIPELINE_PLAN_CHANGED');
    return plan;
  }
  async function readState(id) {
    const state = await readJson(statePath(id), STATE_LIMIT);
    need(state.schema === STATE_SCHEMA && state.id === id && Number.isSafeInteger(state.revision) &&
      state.revision >= 0 && PHASES.has(state.phase) && Array.isArray(state.outputs), 'PIPELINE_OPERATION_CHANGED');
    return state;
  }
  async function saveState(state) {
    const raw = jsonBytes(state); need(raw.length <= STATE_LIMIT, 'PIPELINE_STATE_LIMIT');
    await writeBytes(statePath(state.id), raw);
  }
  async function privateProfile(plan) {
    const value = await readJson(join(folder(plan.id), 'provider.json'), 5 * 1024 * 1024);
    need(value.schema === CONFIG_SCHEMA && object(value.source) && object(value.profile) &&
      value.source.account === plan.payload.source.account && value.source.apiUrl === plan.payload.source.apiUrl &&
      value.source.configSha256 === plan.payload.source.configSha256, 'PIPELINE_SOURCE_CHANGED');
    const normalized = normalizeProfile(value.profile, plan.payload.limits);
    need(normalized.sha256 === plan.payload.profile.sha256 && normalized.id === plan.payload.profile.id,
      'PIPELINE_PROFILE_CHANGED');
    return value;
  }
  async function matches(plan) {
    const retained = await privateProfile(plan);
    return {
      sourceMatches: retained.source.account === config.account && retained.source.apiUrl === config.apiUrl &&
        retained.source.apiKeyEnv === config.apiKeyEnv,
      profileMatches: config.profiles.some(profile => profile.id === plan.payload.profile.id &&
        profile.sha256 === plan.payload.profile.sha256),
    };
  }
  async function requireSource(plan, requireProfile = false) {
    const current = await matches(plan);
    need(current.sourceMatches, 'PIPELINE_ACCOUNT_SELECTION_CHANGED');
    if (requireProfile) need(current.profileMatches, 'PIPELINE_PROFILE_SELECTION_CHANGED');
    return current;
  }
  async function view(plan, state, running = false, replayed = false) {
    return {
      plan, operation: state, running,
      interrupted: !running && (state.pendingCommandId !== null || state.lastError?.interrupted === true ||
        state.phase === 'SUBMISSION_UNKNOWN'),
      ...await matches(plan), outputOptions: pipelineOutputOptions(state.job),
      ...(replayed ? { replayed: true } : {}),
    };
  }
  async function prepare(args) {
    return track(async () => {
      need(object(args) && Object.keys(args).every(key => ['requestId', 'profileId', 'label', 'context', 'inputs'].includes(key)),
        'PIPELINE_PREPARATION_INVALID');
      const requestId = validRequestId(args.requestId), id = localId(requestId);
      need(Array.isArray(args.inputs) && args.inputs.length > 0 && args.inputs.length <= 128,
        'PIPELINE_INPUTS_REQUIRED');
      need(args.context === undefined || object(args.context), 'PIPELINE_CONTEXT_INVALID');
      const inputs = args.inputs.map(inputSelection);
      const request = {
        requestId, profileId: text(args.profileId, 'PIPELINE_PROFILE_ID_INVALID', 128),
        label: args.label === undefined ? '' : text(args.label, 'PIPELINE_LABEL_INVALID', 512),
        context: args.context === undefined ? {} : boundedJson(args.context, 32768),
      };
      const requestSha256 = jsonDigest({ request, inputs });
      return withPrivateLock(operationsRoot, 'prepare.lock', async () => {
        const dir = await privateDirectory(folder(id));
        const existing = await optionalJson(join(dir, 'plan.json'), PLAN_LIMIT);
        if (existing) {
          const plan = await readPlan(id);
          need(plan.requestSha256 === requestSha256, 'PIPELINE_PREPARE_REQUEST_REUSED');
          return inspect(id, true);
        }
        need(inputs.length <= SERVICE_LIMITS.maxInputs, 'PIPELINE_INPUTS_REQUIRED');
        for (const name of ['inputs', 'commands', 'receipts', 'outputs']) await privateDirectory(join(dir, name));
        let preparation = await optionalJson(join(dir, 'preparation.json'), 6 * 1024 * 1024);
        let copies = [];
        if (preparation) {
          need(preparation.schema === PREPARATION_SCHEMA && preparation.id === id &&
            preparation.requestSha256 === requestSha256, 'PIPELINE_PREPARE_REQUEST_REUSED');
          need(preparation.profile.sha256 === normalizeProfile(preparation.privateProfile, preparation.limits).sha256,
            'PIPELINE_PROFILE_CHANGED');
          need(preparation.inputs.length <= SERVICE_LIMITS.maxInputs &&
            preparation.inputs.every(input => Number.isSafeInteger(input.bytes) && input.bytes > 0 &&
              input.bytes <= SERVICE_LIMITS.maxInputBytes), 'PIPELINE_INPUT_SIZE_INVALID');
        } else {
          need(inputs.length <= config.limits.maxInputs, 'PIPELINE_INPUTS_REQUIRED');
          const profile = config.profiles.find(value => value.id === request.profileId);
          need(profile, 'PIPELINE_PROFILE_NOT_CONFIGURED');
          let total = 0;
          const metadata = [];
          for (let index = 0; index < inputs.length; index++) {
            const selected = inputs[index], body = await readBytes(selected.path, config.limits.maxInputBytes);
            need(body.length > 0, 'PIPELINE_EMPTY_INPUT');
            total += body.length; need(total <= config.limits.maxTotalInputBytes, 'PIPELINE_TOTAL_INPUT_LIMIT');
            const sha256 = digest(body), input = 'in_' + jsonDigest({ index, sha256 });
            metadata.push({
              id: input, index, filename: selected.filename, contentType: selected.contentType,
              bytes: body.length, sha256, file: 'inputs/' + input + '.bin',
              ...(selected.sourceRef === undefined ? {} : { sourceRef: selected.sourceRef }),
            });
            copies.push(body);
          }
          preparation = {
            schema: PREPARATION_SCHEMA, id, requestSha256, request, selectedInputs: inputs,
            preparedAt: now(), source: { ...publicIdentity, apiKeyEnv: config.apiKeyEnv },
            profile: profile.summary, privateProfile: {
              id: profile.id, label: profile.label, requestData: profile.requestData,
            }, inputs: metadata, limits: { ...config.limits },
          };
          await immutableJson(join(dir, 'preparation.json'), preparation);
        }
        for (let index = 0; index < preparation.inputs.length; index++) {
          const metadata = preparation.inputs[index], path = join(dir, metadata.file);
          let retained;
          try { retained = await readBytes(path, metadata.bytes); }
          catch (error) { if (error.code !== 'ENOENT') throw error; }
          if (retained) need(retained.length === metadata.bytes && digest(retained) === metadata.sha256,
            'PIPELINE_PREPARED_INPUT_CHANGED');
          else {
            const body = copies[index] ?? await readBytes(preparation.selectedInputs[index].path, metadata.bytes);
            need(body.length === metadata.bytes && digest(body) === metadata.sha256, 'PIPELINE_INPUT_CHANGED_DURING_PREPARATION');
            await immutableBytes(path, body);
          }
          copies[index] = null;
        }
        await immutableJson(join(dir, 'provider.json'), {
          schema: CONFIG_SCHEMA, source: preparation.source, profile: preparation.privateProfile,
        });
        const payload = {
          request: preparation.request,
          source: {
            account: preparation.source.account, apiUrl: preparation.source.apiUrl,
            configSha256: preparation.source.configSha256,
          },
          profile: preparation.profile, inputs: preparation.inputs, limits: preparation.limits,
          providerContract: SDK_SOURCE,
        };
        const plan = {
          schema: PLAN_SCHEMA, id, sha256: jsonDigest(payload),
          requestSha256, preparedAt: preparation.preparedAt, payload,
        };
        await immutableJson(statePath(id), initialState(plan));
        await immutableJson(join(dir, 'plan.json'), plan);
        return view(plan, await readState(id));
      });
    });
  }

  function capturePaths(id, captureId) {
    need(/^rc_[a-f0-9]{64}$/.test(captureId), 'PIPELINE_RECEIPT_ID_INVALID');
    return { metadata: join(folder(id), 'receipts', captureId + '.json'),
      body: join(folder(id), 'receipts', captureId + '.bin') };
  }
  async function saveCapture(id, command, leg, response) {
    const captureId = receiptId(command, leg), paths = capturePaths(id, captureId);
    const metadata = {
      schema: CAPTURE_SCHEMA, id: captureId, operationId: id, commandId: command.id,
      action: command.kind, leg, method: response.method, path: response.path,
      query: response.query, status: response.status, headers: response.headers,
      complete: response.complete, receivedAt: response.receivedAt, completedAt: response.completedAt,
      bytes: response.body.length, sha256: digest(response.body), file: 'receipts/' + captureId + '.bin',
    };
    // The announced digest plus an exclusively published complete body allow
    // local recovery even if the following state/reply write is interrupted.
    await immutableJson(paths.metadata, metadata);
    await immutableBytes(paths.body, response.body);
    return { metadata, body: response.body };
  }
  async function readCapture(id, command, leg) {
    const captureId = receiptId(command, leg), paths = capturePaths(id, captureId);
    const metadata = await optionalJson(paths.metadata, COMMAND_LIMIT);
    if (!metadata) return null;
    need(metadata.schema === CAPTURE_SCHEMA && metadata.id === captureId && metadata.operationId === id &&
      metadata.commandId === command.id && metadata.leg === leg && typeof metadata.complete === 'boolean' &&
      Number.isSafeInteger(metadata.bytes) && metadata.bytes >= 0 && metadata.bytes <= 256 * 1024 * 1024 &&
      /^[a-f0-9]{64}$/.test(metadata.sha256) && metadata.file === 'receipts/' + captureId + '.bin',
      'PIPELINE_RECEIPT_CHANGED');
    let body;
    try { body = await readBytes(paths.body, metadata.bytes); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    need(body.length === metadata.bytes && digest(body) === metadata.sha256, 'PIPELINE_CAPTURE_CHANGED');
    return { metadata, body };
  }
  async function withCreateLaunch(plan, command, signal, work) {
    let enteredRequest = false;
    try {
      return await withPrivateLock(root, launchName + '.lock', async () => {
        const retained = await optionalJson(launchPath, COMMAND_LIMIT);
        if (retained) {
          need(retained.schema === 'stellar-forge.unstructured-pipelines-launch-spacing.v1' &&
            retained.account === launchIdentity.account && retained.apiUrl === launchIdentity.apiUrl &&
            retained.minimumIntervalMs === SERVICE_LIMITS.minimumLaunchIntervalMs &&
            Number.isSafeInteger(retained.revision) && retained.revision >= 1 &&
            retained.revision < Number.MAX_SAFE_INTEGER &&
            Number.isFinite(Date.parse(retained.reservedAt)), 'PIPELINE_LAUNCH_STATE_INVALID');
          // The prior creator must release this same flock before we acquire it.
          // Waiting after acquisition covers a lost response, process death, and
          // clock changes without assuming a previous reservation was a send.
          await waitForLaunch(SERVICE_LIMITS.minimumLaunchIntervalMs, undefined, { signal });
        }
        if (closed || signal?.aborted)
          throw new BuyerError('PIPELINE_REQUEST_NOT_SENT', { dispatched: false });
        await writeJson(launchPath, {
          schema: 'stellar-forge.unstructured-pipelines-launch-spacing.v1',
          ...launchIdentity, minimumIntervalMs: SERVICE_LIMITS.minimumLaunchIntervalMs,
          revision: (retained?.revision ?? 0) + 1, reservedAt: now(),
          operationId: plan.id, requestId: command.requestId,
        });
        if (closed || signal?.aborted)
          throw new BuyerError('PIPELINE_REQUEST_NOT_SENT', { dispatched: false });
        enteredRequest = true;
        // Hold the account lock through this one create response. Other job
        // reads/cancellations use their own original operation locks.
        return await work();
      });
    } catch (error) {
      if (!enteredRequest) throw new BuyerError(
        error.code === 'ROUTESCAN_RECORD_BUSY' ? 'PIPELINE_LAUNCH_BUSY' :
          closed || signal?.aborted ? 'PIPELINE_REQUEST_NOT_SENT' :
            safeCode(error.code, 'PIPELINE_LAUNCH_NOT_SENT'),
        { dispatched: false });
      throw error;
    }
  }
  async function captureRequest(plan, command, leg, spec, signal) {
    const bounded = { ...spec,
      maxBytes: Math.min(spec.maxBytes ?? config.limits.maxResponseBytes,
        command.kind === 'retain' ? plan.payload.limits.maxOutputBytes : plan.payload.limits.maxResponseBytes),
      timeoutMs: Math.min(config.limits.requestTimeoutMs, plan.payload.limits.requestTimeoutMs),
    };
    try {
      const send = () => client.request(bounded, { signal });
      const response = command.kind === 'submit' && leg === 'primary' ?
        await withCreateLaunch(plan, command, signal, send) : await send();
      return await saveCapture(plan.id, command, leg, response);
    }
    catch (error) {
      if (error.response) return saveCapture(plan.id, command, leg, error.response);
      // Raw errors may contain a provider URL or a request header. Only the
      // typed local code belongs in the state/recovery journal.
      await immutableJson(join(folder(plan.id), 'receipts', receiptId(command, leg) + '.fault.json'), {
        operationId: plan.id, commandId: command.id, leg, at: now(),
        code: safeCode(error.code, 'PIPELINE_REQUEST_FAILED'), dispatched: error.dispatched !== false,
      });
      return null;
    }
  }
  async function readCommand(id, cmd) {
    const command = await readJson(commandPath(id, cmd), COMMAND_LIMIT);
    need(command.schema === COMMAND_SCHEMA && command.id === cmd &&
      command.id === commandId(command.requestId) && command.operationId === id &&
      ['submit', 'refresh', 'cancel', 'reconcile', 'retain'].includes(command.kind) &&
      ['STARTED', 'COMPLETE'].includes(command.status) && Number.isSafeInteger(command.baseRevision) &&
      command.baseRevision >= 0 && command.fingerprint === jsonDigest({ kind: command.kind,
        payload: Object.fromEntries(Object.entries(command.payload).filter(([key]) => key !== 'selection')) }),
      'PIPELINE_COMMAND_CHANGED');
    return command;
  }
  async function publishOutput(plan, state, command, capture) {
    const selection = command.payload.selection, sha256 = capture.metadata.sha256;
    const id = 'out_' + jsonDigest({
      providerJobId: state.providerJobId, fileId: selection.fileId, nodeId: selection.nodeId, sha256,
    });
    const metadata = {
      id, providerJobId: state.providerJobId, fileId: selection.fileId, nodeId: selection.nodeId,
      selectionSource: selection.source, label: selection.label,
      bytes: capture.metadata.bytes, sha256,
      contentType: capture.metadata.headers['content-type'] ?? 'application/octet-stream',
      receivedAt: capture.metadata.receivedAt, receiptId: capture.metadata.id,
      file: 'outputs/' + id + '.bin',
    };
    const destination = join(folder(plan.id), metadata.file), source = capturePaths(plan.id, capture.metadata.id).body;
    try { await link(source, destination); await syncDirectory(join(folder(plan.id), 'outputs')); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const retained = await readBytes(destination, metadata.bytes);
      need(retained.length === metadata.bytes && digest(retained) === sha256, 'PIPELINE_OUTPUT_CHANGED');
    }
    const previous = state.outputs.find(row => row.id === id);
    if (previous) {
      need(previous.sha256 === sha256 && previous.bytes === metadata.bytes, 'PIPELINE_OUTPUT_CHANGED');
      return previous;
    }
    return metadata;
  }
  function applyJob(state, job, capture) {
    need(state.providerJobId === null || state.providerJobId === job.id, 'PIPELINE_JOB_ID_MISMATCH');
    state.providerJobId = job.id; state.job = job; state.phase = phaseForJob(job);
    state.jobReceiptId = capture.metadata.id; state.jobObservedAt = capture.metadata.receivedAt;
    state.details = null; state.detailsReceiptId = null; state.detailsObservedAt = null;
    if (job.status === 'STOPPED' && state.cancel)
      state.cancel = { ...state.cancel, status: 'CONFIRMED', confirmedAt: capture.metadata.receivedAt };
  }
  async function projectCommand(plan, state, command, interrupted) {
    const primary = await readCapture(plan.id, command, 'primary');
    const next = { ...state, outputs: [...state.outputs], revision: state.revision + 1,
      activeAction: null, updatedAt: now(), lastError: null };
    let result = {};
    if (command.kind === 'submit') {
      try {
        const job = jobFrom(primary); applyJob(next, job, primary);
      } catch {
        const fault = primary === null ? await optionalJson(join(folder(plan.id), 'receipts',
          receiptId(command, 'primary') + '.fault.json'), COMMAND_LIMIT) : null;
        if (fault?.dispatched === false) {
          next.phase = 'PREPARED';
          next.lastError = errorView(safeCode(fault.code, 'PIPELINE_REQUEST_NOT_SENT'), command.kind);
        } else if (primary?.metadata.complete && REJECTIONS.has(primary.metadata.status)) {
          next.phase = 'REJECTED';
          next.lastError = captureError(primary, command.kind, 'PIPELINE_CREATE_REJECTED', interrupted);
        } else {
          next.phase = 'SUBMISSION_UNKNOWN';
          next.lastError = captureError(primary, command.kind, 'PIPELINE_SUBMISSION_UNKNOWN', interrupted);
        }
      }
    } else if (command.kind === 'refresh' || command.kind === 'reconcile') {
      try {
        const expected = command.kind === 'reconcile' ? command.payload.providerJobId : state.providerJobId;
        const job = jobFrom(primary, expected);
        applyJob(next, job, primary);
        if (command.kind === 'reconcile') next.reconciliation = {
          requestId: command.requestId, providerJobId: job.id, reason: command.payload.reason,
          selectedAt: primary.metadata.receivedAt, receiptId: primary.metadata.id,
        };
        const detail = await readCapture(plan.id, command, 'details');
        if (detail) {
          try {
            next.details = validateDetails(jsonResponse(detail), job.id);
            next.detailsReceiptId = detail.metadata.id; next.detailsObservedAt = detail.metadata.receivedAt;
          } catch { next.lastError = captureError(detail, command.kind, 'PIPELINE_DETAILS_UNAVAILABLE', interrupted); }
        } else if (command.kind === 'refresh') {
          next.lastError = captureError(null, command.kind, 'PIPELINE_DETAILS_UNAVAILABLE', interrupted);
        }
      } catch {
        next.lastError = captureError(primary, command.kind,
          command.kind === 'reconcile' ? 'PIPELINE_RECONCILIATION_UNAVAILABLE' : 'PIPELINE_JOB_UNAVAILABLE', interrupted);
      }
    } else if (command.kind === 'cancel') {
      const accepted = primary?.metadata.complete && primary.metadata.status === 200;
      const rejected = primary?.metadata.complete && REJECTIONS.has(primary.metadata.status);
      next.cancel = {
        requestId: command.requestId, reason: command.payload.reason, requestedAt: command.createdAt,
        status: accepted ? 'ACKNOWLEDGED' : rejected ? 'REJECTED' : 'UNKNOWN',
        receiptId: primary?.metadata.id ?? null,
      };
      if (accepted) {
        const current = await readCapture(plan.id, command, 'job');
        try { applyJob(next, jobFrom(current, state.providerJobId), current); }
        catch { next.lastError = captureError(current, command.kind, 'PIPELINE_CANCEL_STATUS_UNKNOWN', interrupted); }
      } else next.lastError = captureError(primary, command.kind,
        rejected ? 'PIPELINE_CANCEL_REJECTED' : 'PIPELINE_CANCEL_UNKNOWN', interrupted);
    } else if (command.kind === 'retain') {
      if (primary?.metadata.complete && primary.metadata.status === 200) {
        const output = await publishOutput(plan, next, command, primary);
        if (!next.outputs.some(row => row.id === output.id)) next.outputs.push(output);
        result = { outputId: output.id };
      } else next.lastError = captureError(primary, command.kind, 'PIPELINE_OUTPUT_UNAVAILABLE', interrupted);
    }
    next.lastAction = {
      commandId: command.id, requestId: command.requestId, kind: command.kind,
      finishedAt: next.updatedAt, result, error: next.lastError,
    };
    // Keep this pointer until the corresponding command receipt is durable.
    next.pendingCommandId = command.id;
    await saveState(next);
    await writeJson(commandPath(plan.id, command.id), {
      ...command, status: 'COMPLETE', finishedAt: next.updatedAt,
      appliedRevision: next.revision, result, error: next.lastError,
    });
    next.pendingCommandId = null;
    await saveState(next);
    return next;
  }
  async function recoverPending(plan, state) {
    if (!state.pendingCommandId) return state;
    const command = await readCommand(plan.id, state.pendingCommandId);
    if (state.lastAction?.commandId === command.id) {
      if (command.status !== 'COMPLETE') await writeJson(commandPath(plan.id, command.id), {
        ...command, status: 'COMPLETE', finishedAt: state.lastAction.finishedAt,
        appliedRevision: state.revision, result: state.lastAction.result, error: state.lastAction.error,
      });
      state = { ...state, pendingCommandId: null, activeAction: null };
      await saveState(state); return state;
    }
    // No network dispatch occurs during recovery. A missing create receipt
    // requires explicit selection of the provider's existing job.
    need(command.status === 'STARTED', 'PIPELINE_COMMAND_CHANGED');
    return projectCommand(plan, state, command, true);
  }
  async function inspect(id, replayed = false) {
    active(); operationId(id);
    await privateDirectory(folder(id), { create: false });
    try {
      return await withPrivateLock(folder(id), 'operation.lock', async () => {
        const plan = await readPlan(id), state = await recoverPending(plan, await readState(id));
        return view(plan, state, false, replayed);
      });
    } catch (error) {
      if (error.code !== 'ROUTESCAN_RECORD_BUSY') throw error;
      return view(await readPlan(id), await readState(id), true, replayed);
    }
  }
  async function list() {
    active();
    const entries = await readdir(operationsRoot, { withFileTypes: true }), values = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !/^up_[a-f0-9]{64}$/.test(entry.name)) continue;
      try { values.push(await inspect(entry.name)); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    values.sort((a, b) => b.plan.preparedAt.localeCompare(a.plan.preparedAt) || a.plan.id.localeCompare(b.plan.id));
    return values;
  }
  async function readInput(id, selectedId) {
    active(); inputId(selectedId);
    const plan = await readPlan(operationId(id)), metadata = plan.payload.inputs.find(row => row.id === selectedId);
    need(metadata && metadata.file === 'inputs/' + selectedId + '.bin', 'PIPELINE_INPUT_NOT_FOUND');
    const body = await readBytes(join(folder(id), metadata.file), metadata.bytes);
    need(body.length === metadata.bytes && digest(body) === metadata.sha256, 'PIPELINE_INPUT_CHANGED');
    return { body, metadata: canonical(metadata) };
  }
  async function readOutput(id, selectedId) {
    active(); outputId(selectedId);
    const state = await readState(operationId(id)), metadata = state.outputs.find(row => row.id === selectedId);
    need(metadata && metadata.file === 'outputs/' + selectedId + '.bin', 'PIPELINE_OUTPUT_NOT_FOUND');
    const body = await readBytes(join(folder(id), metadata.file), metadata.bytes);
    need(body.length === metadata.bytes && digest(body) === metadata.sha256, 'PIPELINE_OUTPUT_CHANGED');
    return { body, metadata: canonical(metadata) };
  }

  function note(value, code) {
    need(typeof value === 'string' && value.trim().length > 0 && Buffer.byteLength(value) <= 8192 &&
      !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value), code);
    return value;
  }
  function selectedAction(kind, options) {
    need(object(options), 'PIPELINE_ACTION_OPTIONS_INVALID');
    const allowed = ['requestId', 'expectedRevision', 'signal',
      ...(kind === 'submit' || kind === 'reconcile' ? ['expectedPlanSha256'] : []),
      ...(kind === 'cancel' || kind === 'reconcile' ? ['reason'] : []),
      ...(kind === 'reconcile' ? ['providerJobId'] : []),
      ...(kind === 'retain' ? ['fileId', 'nodeId'] : [])];
    need(Object.keys(options).every(key => allowed.includes(key)), 'PIPELINE_ACTION_OPTIONS_INVALID');
    const id = validRequestId(options.requestId);
    need(Number.isSafeInteger(options.expectedRevision) && options.expectedRevision >= 0, 'PIPELINE_REVISION_REQUIRED');
    if (options.signal !== undefined) need(options.signal instanceof AbortSignal, 'PIPELINE_ABORT_SIGNAL_INVALID');
    const payload = {};
    if (kind === 'submit' || kind === 'reconcile') {
      need(typeof options.expectedPlanSha256 === 'string' && /^[a-f0-9]{64}$/.test(options.expectedPlanSha256),
        'PIPELINE_REVIEWED_PLAN_REQUIRED');
      payload.expectedPlanSha256 = options.expectedPlanSha256;
    }
    if (kind === 'cancel' || kind === 'reconcile') payload.reason = note(options.reason, 'PIPELINE_REASON_REQUIRED');
    if (kind === 'reconcile') payload.providerJobId = providerId(options.providerJobId);
    if (kind === 'retain') {
      payload.fileId = providerId(options.fileId);
      payload.nodeId = options.nodeId === undefined || options.nodeId === null ? null : providerId(options.nodeId);
    }
    return { requestId: id, payload, fingerprint: jsonDigest({ kind, payload }) };
  }
  async function preflight(plan, state, kind, action, options) {
    await requireSource(plan, kind === 'submit');
    if (kind === 'submit' || kind === 'reconcile')
      need(action.payload.expectedPlanSha256 === plan.sha256, 'PIPELINE_REVIEWED_PLAN_CHANGED');
    need(state.revision === options.expectedRevision, 'PIPELINE_REVISION_CHANGED');
    client.ready(); options.signal?.throwIfAborted();
    if (kind === 'submit') {
      need(state.providerJobId === null && ['PREPARED', 'REJECTED'].includes(state.phase),
        'PIPELINE_CREATE_ALREADY_REQUESTED');
      const retained = await privateProfile(plan), inputs = [];
      for (const metadata of plan.payload.inputs) {
        const input = await readInput(plan.id, metadata.id);
        inputs.push({ body: input.body, filename: metadata.filename, contentType: metadata.contentType });
      }
      return { spec: client.prepareCreate(retained.profile.requestData, inputs), payload: action.payload };
    }
    if (kind === 'reconcile') {
      need(state.providerJobId === action.payload.providerJobId ||
        (state.providerJobId === null && state.phase === 'SUBMISSION_UNKNOWN'), 'PIPELINE_RECONCILIATION_NOT_REQUIRED');
      return { spec: client.specForJob(action.payload.providerJobId), payload: action.payload };
    }
    need(state.providerJobId !== null && state.job !== null, 'PIPELINE_PROVIDER_JOB_REQUIRED');
    if (kind === 'refresh') return { spec: client.specForJob(state.providerJobId), payload: action.payload };
    if (kind === 'cancel') {
      need(state.phase === 'ACTIVE', 'PIPELINE_JOB_ALREADY_TERMINAL');
      return { spec: client.specForCancel(state.providerJobId), payload: action.payload };
    }
    const selection = selectedOutput(state.job, action.payload.fileId, action.payload.nodeId);
    return {
      spec: client.specForOutput(state.providerJobId, selection.fileId, selection.nodeId),
      payload: { ...action.payload, selection },
    };
  }
  async function mutate(id, kind, options = {}) {
    operationId(id);
    const action = selectedAction(kind, options);
    return track(async () => {
      await privateDirectory(folder(id), { create: false });
      return withPrivateLock(folder(id), 'operation.lock', async () => {
        const plan = await readPlan(id); let state = await recoverPending(plan, await readState(id));
        const cmd = commandId(action.requestId), existing = await optionalJson(commandPath(id, cmd), COMMAND_LIMIT);
        if (existing) {
          const retained = await readCommand(id, cmd);
          need(retained.fingerprint === action.fingerprint && retained.kind === kind, 'PIPELINE_ACTION_REQUEST_REUSED');
          if (retained.status === 'COMPLETE') return { ...await view(plan, state, false, true),
            actionResult: { requestId: retained.requestId, kind: retained.kind, status: retained.status,
              appliedRevision: retained.appliedRevision, result: retained.result, error: retained.error } };
          // The command journal precedes its durable dispatch marker. This sole
          // gap cannot have sent HTTP and can continue against its original base.
          need(retained.status === 'STARTED' && state.pendingCommandId === null &&
            state.revision === retained.baseRevision, 'PIPELINE_COMMAND_REOPEN_REQUIRED');
        }
        const prepared = await preflight(plan, state, kind, action, options);
        const command = existing ?? {
          schema: COMMAND_SCHEMA, id: cmd, operationId: id, requestId: action.requestId,
          kind, fingerprint: action.fingerprint, payload: prepared.payload, baseRevision: state.revision,
          createdAt: now(), status: 'STARTED',
        };
        if (!existing) await immutableJson(commandPath(id, cmd), command);
        state = { ...state, revision: state.revision + 1, pendingCommandId: cmd,
          activeAction: { commandId: cmd, requestId: action.requestId, kind, startedAt: command.createdAt },
          phase: kind === 'submit' ? 'SUBMITTING' : state.phase, updatedAt: now() };
        await saveState(state);
        const controller = new AbortController(), stop = () => controller.abort(new BuyerError('PIPELINE_REQUEST_ABORTED'));
        controllers.add(controller);
        options.signal?.addEventListener('abort', stop, { once: true });
        if (closed || options.signal?.aborted) stop();
        try {
          const primary = await captureRequest(plan, command, 'primary', prepared.spec, controller.signal);
          if (kind === 'refresh' || kind === 'reconcile') {
            let job;
            try { job = jobFrom(primary, kind === 'reconcile' ? command.payload.providerJobId : state.providerJobId); }
            catch {}
            if (job) await captureRequest(plan, command, 'details', client.specForDetails(job.id), controller.signal);
          } else if (kind === 'cancel' && primary?.metadata.complete && primary.metadata.status === 200) {
            await captureRequest(plan, command, 'job', client.specForJob(state.providerJobId), controller.signal);
          }
          state = await projectCommand(plan, state, command, false);
          return { ...await view(plan, state), actionResult: {
            requestId: command.requestId, kind, status: 'COMPLETE', appliedRevision: state.revision,
            result: state.lastAction.result, error: state.lastAction.error,
          } };
        } finally {
          controllers.delete(controller); options.signal?.removeEventListener('abort', stop);
        }
      });
    });
  }
  async function listProviderJobs(id, { workflowId, status, signal } = {}) {
    operationId(id);
    if (signal !== undefined) need(signal instanceof AbortSignal, 'PIPELINE_ABORT_SIGNAL_INVALID');
    return track(async () => {
      await privateDirectory(folder(id), { create: false });
      return withPrivateLock(folder(id), 'operation.lock', async () => {
        const plan = await readPlan(id);
        await recoverPending(plan, await readState(id)); await requireSource(plan); client.ready();
        const command = { id: commandId('provider-list-' + randomUUID()), kind: 'list' };
        const controller = new AbortController(), stop = () => controller.abort(new BuyerError('PIPELINE_REQUEST_ABORTED'));
        controllers.add(controller); signal?.addEventListener('abort', stop, { once: true });
        if (closed || signal?.aborted) stop();
        try {
          const capture = await captureRequest(plan, command, 'primary', client.specForList({ workflowId, status }), controller.signal);
          let jobs;
          try {
            jobs = jsonResponse(capture);
            need(Array.isArray(jobs), 'PIPELINE_JOB_LIST_INVALID');
            jobs.forEach(job => validateJob(job));
          } catch {
            throw new BuyerError('PIPELINE_PROVIDER_LIST_UNAVAILABLE', {
              receiptId: capture?.metadata.id ?? null, status: capture?.metadata.status ?? null,
            });
          }
          return { jobs, receiptId: capture.metadata.id, receivedAt: capture.metadata.receivedAt,
            workflowId: workflowId ?? null, status: status ?? null };
        } finally {
          controllers.delete(controller); signal?.removeEventListener('abort', stop);
        }
      });
    });
  }
  return {
    directory: root,
    source() { active(); return publicSource(config); },
    prepare, list, inspect, readInput, readOutput, listProviderJobs,
    submit: (id, options) => mutate(id, 'submit', options),
    refresh: (id, options) => mutate(id, 'refresh', options),
    cancel: (id, options) => mutate(id, 'cancel', options),
    reconcile: (id, options) => mutate(id, 'reconcile', options),
    retainOutput: (id, options) => mutate(id, 'retain', options),
    async close() {
      if (closed) return;
      closed = true;
      for (const controller of controllers) controller.abort(new BuyerError('PIPELINE_SESSION_CLOSED'));
      await Promise.allSettled([...tasks]);
    },
  };
}
