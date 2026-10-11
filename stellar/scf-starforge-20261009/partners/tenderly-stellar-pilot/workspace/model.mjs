// MIT. Private operator workspace over the original Tenderly merchant and SF30 ledger.
import { join, resolve } from 'node:path';
import { mkdir, readdir, realpath, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { templatePlan, inspectPlan, prepareProduct, readPreparedProduct, providerRequest, describeResult } from '../product.mjs';
import { createTenderlyApplication, startTenderlyMerchant } from '../application.mjs';
import { acquireRunbookMetadataLease } from '../../../buyer-runbook/runbook.mjs';
import { privateDirectory, newDirectory, readBytes, writeNew, syncDirectory,
  json, parse, sha256, fileBinding, readBoundFiles } from '../../../sf102-cube-paid-query-adapter/onboarding/files.mjs';

const SCHEMA = 'stellar-forge.tenderly-workspace.v1';
const PROFILE = /^p-[a-f0-9]{64}$/;
const REQUEST = /^r-[a-f0-9]{64}$/;
const OPERATION = /^[a-f0-9]{64}$/;
const need = (condition, message, status = 400) => {
  if (!condition) throw Object.assign(new Error(message), { status });
};
const checked = (value, pattern, name) => {
  need(typeof value === 'string' && pattern.test(value), 'Select an existing ' + name);
  return value;
};
const pageLimit = value => {
  need(Number.isSafeInteger(value) && value >= 1 && value <= 100, 'Page size must be 1–100');
  return value;
};
const sameBytes = (a, b) => a.length === b.length && a.equals(b);

/** Snapshots become visible in one rename after all files and their directory are flushed. */
async function publishSnapshot(parent, name, files, metadata) {
  const destination = join(parent, name);
  try { await privateDirectory(destination); return destination; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const temporary = join(parent, '.pending-' + randomUUID());
  await newDirectory(temporary);
  try {
    for (const [file, bytes] of Object.entries(files)) await writeNew(join(temporary, file), bytes);
    await writeNew(join(temporary, 'snapshot.json'), json({
      ...metadata, files: Object.fromEntries(Object.entries(files).map(([file, bytes]) => [file, fileBinding(bytes)])),
    }));
    await syncDirectory(temporary);
    try { await rename(temporary, destination); }
    catch (error) {
      if (!['EEXIST', 'ENOTEMPTY'].includes(error.code)) throw error;
      await privateDirectory(destination);
    }
    await syncDirectory(parent);
    return destination;
  } finally { await rm(temporary, { recursive: true, force: true }); }
}

export async function openTenderlyWorkspace({
  directory, planPath, env = process.env, merchantOptions = {},
} = {}) {
  need(typeof directory === 'string' && directory.length > 0, 'Supply the private workspace directory');
  const root = resolve(directory);
  await mkdir(root, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
  return openExisting();

  async function openExisting() {
    await privateDirectory(root);
    need(await realpath(root) === root, 'Use the original, absolute workspace directory');
    for (const name of ['profiles', 'requests', 'packages']) {
      await mkdir(join(root, name), { mode: 0o700 }).catch(error => {
        if (error.code !== 'EEXIST') throw error;
      });
      await privateDirectory(join(root, name));
    }
    const manifestPath = join(root, 'workspace.json');
    let manifest;
    try { manifest = parse(await readBytes(manifestPath, { privateFile: true, max: 65536 }), 'workspace.json'); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const release = await acquireRunbookMetadataLease(root);
      try {
        try { manifest = parse(await readBytes(manifestPath, { privateFile: true, max: 65536 }), 'workspace.json'); }
        catch (readError) {
          if (readError.code !== 'ENOENT') throw readError;
          manifest = { schema: SCHEMA, id: randomUUID(), createdAt: new Date().toISOString() };
          await writeNew(manifestPath, json(manifest)); await syncDirectory(root);
        }
      } finally { await release(); }
    }
    need(manifest.schema === SCHEMA && /^[a-f0-9-]{36}$/.test(manifest.id ?? ''),
      'This directory is not a Tenderly operator workspace');

    let active = null, closing = false, pending = Promise.resolve(), shutdown;
    const serial = operation => {
      if (closing) return Promise.reject(Object.assign(new Error('Workspace is closing'), { status: 503 }));
      const result = pending.then(operation);
      pending = result.catch(() => {});
      return result;
    };
    const profilePath = id => join(root, 'profiles', checked(id, PROFILE, 'profile'));
    const requestPath = id => join(root, 'requests', checked(id, REQUEST, 'request'));

    async function inspectProfile(id) {
      const path = profilePath(id);
      await privateDirectory(path);
      const saved = parse(await readBytes(join(path, 'snapshot.json'), { privateFile: true, max: 65536 }), 'profile snapshot');
      need(saved.schema === SCHEMA + '.profile' && saved.id === id, 'Invalid saved profile');
      const files = await readBoundFiles(path, saved, ['plan.json']);
      need(id === 'p-' + sha256(files['plan.json']), 'Saved profile identity changed');
      const plan = parse(files['plan.json'], 'plan.json'), review = inspectPlan(plan);
      need(review.planSha256 === saved.planSha256, 'Saved merchant plan changed');
      return { id, label: saved.label, createdAt: saved.createdAt, plan, review, directory: path };
    }
    async function profiles({ before = '', limit = 25 } = {}) {
      pageLimit(limit);
      if (before) checked(before, PROFILE, 'profile cursor');
      const names = (await readdir(join(root, 'profiles'), { withFileTypes: true }))
        .filter(entry => entry.isDirectory() && PROFILE.test(entry.name)).map(entry => entry.name)
        .sort().filter(name => !before || name > before);
      const selected = names.slice(0, limit), records = [];
      for (const id of selected) {
        try {
          const profile = await inspectProfile(id);
          records.push({ id, label: profile.label, createdAt: profile.createdAt,
            serviceName: profile.plan.serviceName, planSha256: profile.review.planSha256,
            networkId: profile.plan.networkId, status: 'SAVED' });
        } catch (error) { records.push({ id, status: 'UNAVAILABLE', error: error.message }); }
      }
      return { records, nextCursor: names.length > selected.length ? selected.at(-1) : null };
    }
    async function saveProfile({ plan, label = '' }) {
      need(typeof label === 'string' && label.length <= 120 && !/[\u0000-\u001f\u007f]/.test(label),
        'Profile name must be up to 120 ordinary characters');
      const review = inspectPlan(plan), bytes = json(review.plan), id = 'p-' + sha256(bytes);
      await publishSnapshot(join(root, 'profiles'), id, { 'plan.json': bytes }, {
        schema: SCHEMA + '.profile', id, label: label.trim() || review.serviceName,
        planSha256: review.planSha256, createdAt: new Date().toISOString(),
      });
      const saved = await inspectProfile(id);
      need(sameBytes(json(saved.plan), bytes), 'Another saved profile has different bytes', 409);
      return saved;
    }
    async function prepare(id) {
      const profile = await inspectProfile(id), destination = join(root, 'packages', id);
      const release = await acquireRunbookMetadataLease(root);
      try {
        const marker = join(destination, 'workspace-package.json');
        try {
          const saved = parse(await readBytes(marker, { privateFile: true, max: 65536 }), 'prepared package');
          const prepared = await readPreparedProduct(destination);
          need(saved.profile === id && prepared.planSha256 === profile.review.planSha256,
            'Prepared package does not match the saved profile', 409);
          return saved;
        } catch (error) { if (error.code !== 'ENOENT') throw error; }
        const result = await prepareProduct({ plan: profile.plan, out: destination });
        const saved = { ...result, schema: SCHEMA + '.package', profile: id,
          createdAt: new Date().toISOString() };
        await writeNew(marker, json(saved)); await syncDirectory(destination);
        return saved;
      } finally { await release(); }
    }
    function selected(id) {
      checked(id, PROFILE, 'profile');
      need(active?.profile.id === id, 'Open this saved profile before operating it', 409);
      return active;
    }
    async function stateDirectory(id) {
      const directory = (await prepare(id)).stateDirectory;
      await privateDirectory(directory);
      need(await realpath(directory) === directory, 'Use the original profile state directory');
      return directory;
    }
    function applicationOptions(profile, directory) {
      return { ...merchantOptions, plan: profile.plan, stateDirectory: directory, env };
    }
    async function openProfile(id) {
      const profile = await inspectProfile(id);
      if (active?.profile.id === id) return status();
      need(!active?.runtime, 'Drain and stop the running merchant before opening another profile', 409);
      if (active) { await active.application.close(); active = null; }
      const directory = await stateDirectory(id);
      const application = await createTenderlyApplication(applicationOptions(profile, directory));
      active = { profile, directory, application, runtime: null };
      return status();
    }
    function status() {
      return {
        workspace: manifest.id, directory: root, profile: active?.profile.id ?? null,
        serviceName: active?.profile.plan.serviceName ?? null,
        state: active?.runtime ? 'RUNNING' : active ? 'OPEN' : 'CLOSED',
        merchant: active?.runtime ? { url: active.runtime.url, mode: active.runtime.mode } : null,
        operations: active?.application.snapshot() ?? null,
      };
    }
    async function start({ profile: id, port = 0, operationsPort = 0 }) {
      const item = selected(id);
      need(!item.runtime, 'The selected merchant is already running', 409);
      for (const value of [port, operationsPort]) need(Number.isInteger(value) && value >= 0 && value <= 65535,
        'Listener ports must be 0–65535');
      await item.application.close(); active = null;
      try {
        const runtime = await startTenderlyMerchant({
          ...applicationOptions(item.profile, item.directory), port, operationsPort,
          historyDirectory: join(item.directory, 'history'),
          availabilityDirectory: join(item.directory, 'availability'),
          ...(merchantOptions.facilitator || merchantOptions.nativeFactory ?
            { deliveryStateDirectory: join(item.directory, 'delivery') } : {}),
        });
        active = { ...item, application: runtime.application, runtime };
      } catch (error) {
        try { active = { ...item, application: await createTenderlyApplication(applicationOptions(item.profile, item.directory)), runtime: null }; }
        catch { /* The exact saved profile and original state remain available for reopening. */ }
        throw error;
      }
      return status();
    }
    async function stop(id) {
      const item = selected(id);
      if (item.runtime) {
        await item.runtime.close(); active = null;
        active = { ...item, application: await createTenderlyApplication(applicationOptions(item.profile, item.directory)), runtime: null };
      }
      return status();
    }
    async function issue({ profile: id, body, id: operationId, subject, expiresAt }) {
      const item = selected(id);
      providerRequest(item.profile.plan, body);
      const operation = await item.application.operations.issue({ body, id: operationId, subject, expiresAt });
      need(OPERATION.test(operation.operationKey ?? ''), 'Original merchant did not return an operation identity', 503);
      const packet = { schema: 'stellar-forge.tenderly-workspace-request.v1', profile: id,
        planSha256: item.profile.review.planSha256, merchant: item.profile.review.route,
        payment: item.profile.plan.payment, body, operation,
        customer: { id: operationId, subject } };
      const bytes = json(packet), requestId = 'r-' + sha256(bytes);
      await publishSnapshot(join(root, 'requests'), requestId, { 'request.json': bytes }, {
        schema: SCHEMA + '.request', id: requestId, profile: id, operationKey: operation.operationKey,
        createdAt: new Date().toISOString(),
      });
      return { id: requestId, packet, createdAt: new Date().toISOString() };
    }
    async function inspectRequest(id) {
      const directory = requestPath(id);
      const manifest = parse(await readBytes(join(directory, 'snapshot.json'), { privateFile: true, max: 65536 }), 'request snapshot');
      need(manifest.schema === SCHEMA + '.request' && manifest.id === id, 'Invalid saved request');
      const files = await readBoundFiles(directory, manifest, ['request.json']);
      need(id === 'r-' + sha256(files['request.json']), 'Saved request identity changed');
      return { id, createdAt: manifest.createdAt, packet: parse(files['request.json'], 'request.json') };
    }
    async function requests({ profile, before = '', limit = 25 }) {
      await inspectProfile(profile); pageLimit(limit);
      if (before) checked(before, REQUEST, 'request cursor');
      const names = (await readdir(join(root, 'requests'), { withFileTypes: true }))
        .filter(entry => entry.isDirectory() && REQUEST.test(entry.name)).map(entry => entry.name)
        .sort().filter(name => !before || name > before);
      const records = []; let last = null, more = false;
      for (const id of names) {
        const saved = await inspectRequest(id);
        if (saved.packet.profile !== profile) continue;
        if (records.length === limit) { more = true; break; }
        records.push({ id, createdAt: saved.createdAt, operationKey: saved.packet.operation.operationKey,
          subject: saved.packet.customer?.subject ?? null }); last = id;
      }
      return { records, nextCursor: more ? last : null };
    }
    async function response({ profile, operationKey }) {
      const item = selected(profile);
      checked(operationKey, OPERATION, 'operation');
      const result = await item.application.operations.response(operationKey);
      need(result, 'Saved operation was not found', 404);
      const bytes = Buffer.isBuffer(result.body) ? result.body : Buffer.from(result.body);
      return { bytes, status: result.status, headers: result.headers,
        sha256: sha256(bytes), summary: describeResult(result), name: 'response.json' };
    }
    async function recover({ profile, ...input }) {
      const item = selected(profile);
      if (input.response) {
        need(typeof input.response.bodyBase64 === 'string' &&
          /^[A-Za-z0-9+/]*={0,2}$/.test(input.response.bodyBase64), 'Supply the original response file');
        const bytes = Buffer.from(input.response.bodyBase64, 'base64');
        need(bytes.toString('base64') === input.response.bodyBase64 &&
          bytes.length <= item.profile.plan.limits.maxResponseBytes, 'Invalid or oversized response file');
        input.response = { status: input.response.status, headers: input.response.headers, body: bytes };
      }
      return item.application.operations.recover(input);
    }
    async function download({ profile, kind, id, observationId }) {
      await inspectProfile(profile);
      if (kind === 'provider-response') {
        const saved = await selected(profile).application.providerRecovery.response({ lookupId: id, observationId });
        return { bytes: saved.bytes, mime: saved.contentType || 'application/octet-stream',
          name: 'tenderly-saved-provider-result.json' };
      }
      if (kind === 'plan') {
        const saved = await inspectProfile(profile);
        return { bytes: json(saved.plan), name: 'plan.json', mime: 'application/json' };
      }
      if (kind === 'request') {
        const saved = await inspectRequest(id);
        need(saved.packet.profile === profile, 'Request belongs to another profile', 409);
        return { bytes: json(saved.packet), name: 'tenderly-request.json', mime: 'application/json' };
      }
      if (kind === 'response') return { ...await response({ profile, operationKey: id }), mime: 'application/json' };
      throw new TypeError('Select an existing plan, request or response');
    }
    const close = () => shutdown ??= (async () => {
      closing = true; await pending;
      if (active?.runtime) await active.runtime.close();
      else if (active) await active.application.close();
      active = null;
    })();
    let initialProfile = null;
    if (planPath) {
      const input = parse(await readBytes(resolve(planPath), { max: 1024 * 1024 }), 'initial merchant plan');
      initialProfile = await saveProfile({ plan: input });
    }
    return {
      root, manifest, close, status,
      bootstrap: async () => ({ schema: SCHEMA, id: manifest.id, directory: root,
        createdAt: manifest.createdAt, template: templatePlan(), initialProfile,
        profiles: await profiles({ limit: 25 }), status: status() }),
      preview: plan => inspectPlan(plan),
      profiles, inspectProfile, requests, inspectRequest,
      saveProfile: value => serial(() => saveProfile(value)),
      prepare: id => serial(() => prepare(id)),
      openProfile: id => serial(() => openProfile(id)),
      start: input => serial(() => start(input)),
      stop: id => serial(() => stop(id)),
      issue: input => serial(() => issue(input)),
      operations: ({ profile, ...options }) => serial(() => selected(profile).application.operations.list(options)),
      operation: ({ profile, operationKey }) => serial(() => selected(profile).application.operations.inspect(operationKey)),
      audit: ({ profile, operationKey, ...options }) => serial(() => selected(profile).application.operations.audit(operationKey, options)),
      response: input => serial(() => response(input)),
      recover: input => serial(() => recover(input)),
      lookupProvider: ({ profile, ...input }) => serial(() => selected(profile).application.providerRecovery.lookup(input)),
      providerLookup: ({ profile, id }) => serial(() => selected(profile).application.providerRecovery.inspect(id)),
      providerLookups: ({ profile, ...input }) => serial(() => selected(profile).application.providerRecovery.list(input)),
      providerResponse: ({ profile, ...input }) => serial(() => selected(profile).application.providerRecovery.response(input)),
      recoverProvider: ({ profile, ...input }) => serial(() => selected(profile).application.providerRecovery.complete(input)),
      download: input => serial(() => download(input)),
    };
  }
}
