// MIT. Tenant discovery over the original SF82 enrollment and SF60 signed journal.
import { constants as FS } from 'node:fs';
import { mkdir, lstat, realpath, open as openFile, readdir, rename } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createReleaseDiscoveryConsole } from '../sf82-seller-pilot/release-discovery-console.mjs';
import { inspectReleaseDiscoverySetup, reviewReleaseDiscoverySetup } from '../sf82-seller-pilot/release-discovery-setup.mjs';
import { releaseCatalogStatus, reviewReleaseCatalog, applyReleaseCatalog } from '../sf82-seller-pilot/release-catalog.mjs';
import { requestCatalogOperator } from '../sf60-durable-catalog-transaction/operator.mjs';
import { startExplorer } from '../sf61-bazaar-explorer/server.mjs';

const SCHEMA = 'stellar-forge.fleet-discovery.v1';
const REVIEW = 'stellar-forge.fleet-discovery-review.v1';
const PERMISSIONS = ['allowedOrigins', 'allowedRecipients', 'allowedNetworks', 'allowedSchemes'];
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const canonical = value => Array.isArray(value) ? value.map(canonical) : object(value)
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const hash = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const fail = (code, message = code, status = 409) => { throw Object.assign(new Error(message), { code, status }); };
function keys(value, allowed) {
  if (!object(value) || Object.keys(value).some(key => !allowed.includes(key)))
    fail('FLEET_DISCOVERY_INPUT_INVALID', 'Use the declared merchant and the exact reviewed identity.', 400);
}
function publicSetup(value) {
  if (!value) return null;
  const { directory, connectionFile, policyFile, enrollmentFile, catalogDirectory, workspaceDirectory, ...view } = value;
  return view;
}
function publicCatalog(value) {
  if (!value) return null;
  return { ...value, ...(value.catalog ? { catalog: { ...value.catalog, directory: undefined } } : {}) };
}
function binding(value) {
  return { tenant: value.tenant, host: value.host, slot: value.slot, instanceId: value.instanceId,
    releaseId: value.releaseId, releaseDigest: value.releaseDigest, port: value.port,
    revision: value.revision, digest: value.digest, snapshotId: value.snapshotId };
}
function permissionReview(enrolled, requested) {
  return { enrolled: structuredClone(enrolled), requested: structuredClone(requested),
    additions: Object.fromEntries(PERMISSIONS.map(name => [name,
      requested[name].filter(value => !enrolled[name].includes(value))])),
    covered: PERMISSIONS.every(name => requested[name].every(value => enrolled[name].includes(value))) };
}
async function privateParent(path) {
  try { await mkdir(path, { mode: 0o700 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(path) !== path ||
      (info.mode & 0o077) || process.getuid && info.uid !== process.getuid())
    fail('FLEET_DISCOVERY_PRIVATE_DIRECTORY_REQUIRED', 'Use the original private fleet discovery directory.');
}

/**
 * Host-only callbacks resolve original stores and the exact currently serving
 * session. withServing holds the ORIGINAL gateway mutation guard across writes.
 * No second release store, signing journal or per-slot seller identity is made.
 */
export function createFleetDiscoveryDesk({ directory, tenants, locate, current, withServing, assertOpen }) {
  directory = resolve(directory);
  const parent = join(directory, 'discovery'), recoveryParent = join(directory, 'discovery-recovery');
  const names = new Map(tenants.map(row => [row.id, row]));
  const consoles = new Map(), opening = new Map(), reviews = new Map();
  let closed = false, closePromise;
  const open = () => { assertOpen(); if (closed) fail('FLEET_DISCOVERY_CLOSING', 'The discovery owner is closing.', 503); };
  function tenant(id) {
    open();
    const value = names.get(id);
    if (!value) fail('FLEET_RELEASE_ALIAS_UNKNOWN', 'Choose a merchant declared in this fleet.', 404);
    return value;
  }
  const destination = id => join(parent, id);
  async function exists(id) {
    try { await lstat(destination(id)); return true; }
    catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  }
  async function checkedDirectory(path) {
    const info = await lstat(path, { bigint: true });
    if (!info.isDirectory() || info.isSymbolicLink() || await realpath(path) !== path ||
        info.mode & 0o077n || process.getuid && info.uid !== BigInt(process.getuid()))
      fail('FLEET_DISCOVERY_PRIVATE_DIRECTORY_REQUIRED', 'Preserve the original private discovery directory.');
    return info;
  }
  async function recoveries(id) {
    try { await checkedDirectory(recoveryParent); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    return (await readdir(recoveryParent, { withFileTypes: true }))
      .filter(row => row.isDirectory() && row.name.startsWith(id + '--')).map(row => row.name).sort();
  }
  async function inspectIncomplete(id) {
    tenant(id);
    const path = destination(id), root = await checkedDirectory(path);
    const allowed = new Set(['seller-key.pem', 'seller-public.pem', 'connection.json',
      'policy.json', 'seller-enrollment.json', 'setup.json', 'catalog', 'workspace', 'launches']);
    const entries = (await readdir(path)).sort(), rows = [];
    if (entries.some(name => !allowed.has(name)))
      fail('FLEET_DISCOVERY_RECOVERY_CONTENT_CHANGED', 'Inspect the additional retained files with the original setup owner.');
    for (const name of entries) {
      const filename = join(path, name);
      if (['catalog', 'workspace', 'launches'].includes(name)) {
        const info = await checkedDirectory(filename);
        if ((await readdir(filename)).length)
          fail('FLEET_DISCOVERY_INITIALIZED_STATE_PRESERVED',
            'This directory contains original catalogue or workspace state. Reopen its existing identity.');
        rows.push({ name, type: 'directory', bytes: 0, dev: String(info.dev), ino: String(info.ino),
          mode: String(info.mode), modified: String(info.mtimeNs) });
        continue;
      }
      const file = await openFile(filename, FS.O_RDONLY | (FS.O_NOFOLLOW ?? 0));
      let data;
      try {
        const before = await file.stat({ bigint: true });
        if (!before.isFile() || before.nlink !== 1n || before.mode & 0o077n ||
            process.getuid && before.uid !== BigInt(process.getuid()) || before.size > 8n * 1024n * 1024n)
          fail('FLEET_DISCOVERY_RECOVERY_FILE_INVALID', 'Retain the original bounded private setup files.');
        data = Buffer.alloc(Number(before.size) + 1); let used = 0;
        while (used < data.length) {
          const { bytesRead } = await file.read(data, used, data.length - used, null);
          if (!bytesRead) break;
          used += bytesRead;
        }
        const after = await file.stat({ bigint: true });
        if (used !== Number(before.size) || before.size !== after.size || before.mtimeNs !== after.mtimeNs ||
            before.ino !== after.ino || before.dev !== after.dev)
          fail('FLEET_DISCOVERY_RECOVERY_CHANGED', 'The incomplete setup changed. Inspect its current state again.');
        const bytes = data.subarray(0, used);
        if (name === 'setup.json') {
          let completeJson = false;
          try { JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); completeJson = true; } catch {}
          if (completeJson) fail('FLEET_DISCOVERY_COMPLETED_SETUP_PRESERVED',
            'A completed setup record is retained. Repair or reopen that original enrollment and identity.');
        }
        rows.push({ name, type: 'file', bytes: used, sha256: createHash('sha256').update(bytes).digest('hex'),
          dev: String(before.dev), ino: String(before.ino), mode: String(before.mode), modified: String(before.mtimeNs) });
      } finally { data?.fill(0); await file.close(); }
    }
    const after = await checkedDirectory(path);
    if (root.dev !== after.dev || root.ino !== after.ino || root.mtimeNs !== after.mtimeNs)
      fail('FLEET_DISCOVERY_RECOVERY_CHANGED', 'The incomplete setup changed. Inspect its current state again.');
    return { inspectionId: hash({ tenant: id, dev: String(root.dev), ino: String(root.ino),
      modified: String(root.mtimeNs), rows }), files: rows.map(({ name, type, bytes }) => ({ name, type, bytes })),
      bytes: rows.reduce((sum, row) => sum + row.bytes, 0),
      action: 'PRESERVE_INCOMPLETE_SETUP_AND_ENROLL' };
  }
  async function preserveIncomplete(id, expected) {
    const current = await inspectIncomplete(id);
    if (current.inspectionId !== expected.inspectionId)
      fail('FLEET_DISCOVERY_RECOVERY_CHANGED', 'The incomplete setup changed after review.');
    await privateParent(recoveryParent);
    const retainedSetupId = id + '--' + expected.inspectionId.slice(0, 16) + '--' + randomUUID();
    await rename(destination(id), join(recoveryParent, retainedSetupId));
    for (const path of [parent, recoveryParent]) {
      const handle = await openFile(path, FS.O_RDONLY | (FS.O_DIRECTORY ?? 0));
      try { await handle.sync(); } finally { await handle.close(); }
    }
    return retainedSetupId;
  }
  async function readSetup(id, entry) {
    const value = await inspectReleaseDiscoverySetup(entry.root, { directory: destination(id) });
    if (value.source.publicOrigin !== 'https://' + tenant(id).host)
      fail('FLEET_DISCOVERY_TENANT_CHANGED', 'The retained seller enrollment belongs to a different merchant origin.');
    return value;
  }
  async function existing(id) {
    const declared = tenant(id);
    if (consoles.has(id)) return await exists(id) ? consoles.get(id) : null;
    if (opening.has(id)) return opening.get(id);
    const pending = (async () => {
      if (!await exists(id)) return null;
      // setup.json already pins its exact original release and permissions.
      // Reopen that retained source in a declared slot; no extra anchor journal.
      let last;
      for (const [slot, source] of Object.entries(declared.slots)) {
        try {
          const entry = { root: source.store, anchorSlot: slot,
            console: createReleaseDiscoveryConsole(source.store, { directory: destination(id) }) };
          await readSetup(id, entry);
          consoles.set(id, entry); return entry;
        } catch (error) { last = error; }
      }
      fail('FLEET_DISCOVERY_ANCHOR_UNAVAILABLE',
        'Reopen the retained enrollment and its original release source in this merchant’s declared stores. ' +
        (last?.code ?? 'DISCOVERY_SETUP_UNAVAILABLE'));
    })();
    opening.set(id, pending);
    try { return await pending; } finally { if (opening.get(id) === pending) opening.delete(id); }
  }
  async function required(id) {
    const entry = await existing(id);
    if (!entry) fail('FLEET_DISCOVERY_SETUP_REQUIRED', 'Review the serving merchant and create its tenant enrollment.');
    await readSetup(id, entry);
    return entry;
  }
  async function running(id) {
    const entry = await required(id), state = await entry.console.status();
    if (state.state !== 'RUNNING' || !entry.console.catalogConfig)
      fail('FLEET_DISCOVERY_START_REQUIRED', 'Start this tenant’s retained discovery service.');
    return { entry, config: entry.console.catalogConfig, setup: await readSetup(id, entry), state };
  }
  function keep(value) {
    for (const [id, review] of reviews) if (review.expires <= Date.now()) reviews.delete(id);
    if (reviews.size >= 16) reviews.delete(reviews.keys().next().value);
    const reviewId = randomUUID(), expires = Date.now() + 10 * 60 * 1000;
    const retained = { ...value, reviewId, expires };
    reviews.set(reviewId, retained);
    return { schema: REVIEW, kind: value.kind, reviewId, tenant: value.tenant,
      expiresAt: new Date(expires).toISOString(), serving: value.serving,
      ...(value.enrollment ? { enrollment: publicSetup(value.enrollment) } : {}),
      ...(value.recovery ? { recovery: value.recovery } : {}),
      ...(value.catalog ? { catalog: publicCatalog(value.catalog), permissions: value.permissions } : {}) };
  }
  function take(input, kind) {
    keys(input, ['tenant', 'reviewId']); tenant(input.tenant);
    const value = reviews.get(input.reviewId);
    if (!value || value.kind !== kind || value.tenant !== input.tenant || value.expires <= Date.now())
      fail('FLEET_DISCOVERY_REVIEW_EXPIRED', 'Review the current tenant source and catalogue again.');
    reviews.delete(input.reviewId); return value;
  }
  async function sameServing(saved) {
    const value = await current(saved.tenant, { slot: saved.slot, instanceId: saved.instanceId });
    if (hash(binding(value)) !== hash(saved))
      fail('FLEET_DISCOVERY_SERVING_CHANGED', 'The serving release or gateway revision changed. Review its current offers.');
    return value;
  }
  async function status(input) {
    keys(input, ['tenant']); const declared = tenant(input.tenant);
    const view = { schema: SCHEMA, tenant: declared.id, host: declared.host, state: 'NEW',
      identityScope: 'TENANT', serving: null, enrollment: null, catalog: null,
      retainedIncompleteSetups: await recoveries(declared.id) };
    try { view.serving = binding(await current(declared.id)); }
    catch (error) { view.servingError = { code: error.code ?? error.message }; }
    try {
      const entry = await existing(declared.id);
      if (!entry) return view;
      const setup = await readSetup(declared.id, entry), state = await entry.console.status();
      Object.assign(view, { state: state.state, enrollment: publicSetup(setup), anchorSlot: entry.anchorSlot,
        instanceId: state.instanceId, discoveryOrigin: state.discoveryOrigin, error: state.error,
        consumer: state.state === 'RUNNING' && entry.explorerSource === state.discoveryOrigin && entry.explorer
          ? { state: 'RUNNING', url: entry.explorer.url, source: entry.explorer.source } : { state: 'STOPPED' } });
      if (state.state === 'RUNNING' && view.serving) {
        try {
        const original = await current(declared.id);
        const [catalog, requested] = await Promise.all([
          releaseCatalogStatus(original.store, { config: entry.console.catalogConfig, releaseId: original.releaseId }),
          reviewReleaseDiscoverySetup(original.store, { releaseId: original.releaseId,
            sellerId: setup.sellerId, sourceURL: setup.source.sourceURL }),
        ]);
        view.serving = binding(original); view.catalog = publicCatalog(catalog);
        view.permissions = permissionReview(setup.permissions, requested.permissions);
        } catch (error) { view.catalogError = { code: error.code ?? error.message, message: error.message }; }
      }
    } catch (error) {
      const recovery = await inspectIncomplete(declared.id).catch(() => null);
      view.state = recovery ? 'INCOMPLETE' : 'UNAVAILABLE';
      if (recovery) view.recovery = recovery;
      view.error = { code: error.code ?? error.message, message: error.message };
    }
    return view;
  }
  async function reviewEnrollment(input) {
    keys(input, ['tenant', 'slot', 'instanceId', 'sellerId', 'sourceURL', 'expectedIncompleteId']);
    const declared = tenant(input.tenant);
    let recovery = null;
    if (await exists(declared.id)) {
      recovery = await inspectIncomplete(declared.id);
      if (typeof input.expectedIncompleteId !== 'string' || input.expectedIncompleteId !== recovery.inspectionId)
        fail('FLEET_DISCOVERY_RECOVERY_REVIEW_REQUIRED',
          'Review the exact incomplete setup before preserving it and creating the tenant enrollment.');
    } else if (input.expectedIncompleteId !== undefined)
      fail('FLEET_DISCOVERY_RECOVERY_CHANGED', 'Refresh this tenant’s current setup before recovery.');
    const source = await current(declared.id, { slot: input.slot, instanceId: input.instanceId });
    if (!input.slot || !input.instanceId) fail('FLEET_DISCOVERY_INSTANCE_REQUIRED', 'Select the exact serving instance.', 400);
    const entry = { root: source.store, anchorSlot: source.slot,
      console: createReleaseDiscoveryConsole(source.store, { directory: destination(declared.id) }) };
    const request = { releaseId: source.releaseId, sellerId: input.sellerId,
      ...(input.sourceURL !== undefined ? { sourceURL: input.sourceURL } : {}) };
    const enrollment = recovery ? await reviewReleaseDiscoverySetup(source.store, request) : await entry.console.review(request);
    consoles.set(declared.id, entry);
    return keep({ kind: 'enrollment', tenant: declared.id, serving: binding(source), entry, enrollment, recovery });
  }
  async function createEnrollment(input) {
    const saved = take(input, 'enrollment'), source = await sameServing(saved.serving);
    await privateParent(parent);
    return withServing(saved.serving, async () => {
      let enrollment = saved.enrollment, retainedSetupId = null;
      if (saved.recovery) {
        retainedSetupId = await preserveIncomplete(input.tenant, saved.recovery);
        enrollment = await saved.entry.console.review({ releaseId: saved.enrollment.source.releaseId,
          sellerId: saved.enrollment.sellerId, sourceURL: saved.enrollment.source.sourceURL });
        const proposal = value => ({ sellerId: value.sellerId, source: value.source, permissions: value.permissions });
        if (hash(proposal(enrollment)) !== hash(proposal(saved.enrollment)))
          fail('FLEET_DISCOVERY_SOURCE_CHANGED', 'The original enrollment source changed after recovery review.');
      }
      await saved.entry.console.create({ reviewId: enrollment.id });
      consoles.set(input.tenant, saved.entry);
      return { schema: SCHEMA, tenant: input.tenant, decision: 'ENROLLED',
        serving: binding(source), enrollment: publicSetup(await readSetup(input.tenant, saved.entry)),
        ...(retainedSetupId ? { recovery: { ...saved.recovery, retainedSetupId } } : {}) };
    });
  }
  async function closeExplorer(entry) {
    const held = entry.explorer;
    if (held) {
      try { await held.close(); }
      finally { if (entry.explorer === held) { entry.explorer = null; entry.explorerSource = null; } }
    }
  }
  async function start(input) {
    keys(input, ['tenant']); const entry = await required(input.tenant);
    if ((await entry.console.status()).state !== 'RUNNING') await entry.console.start();
    const state = await entry.console.status();
    if (!entry.explorer || entry.explorerSource !== state.discoveryOrigin) {
      await closeExplorer(entry);
      entry.explorer = await startExplorer({ localUpstream: state.discoveryOrigin, port: 0 });
      entry.explorerSource = state.discoveryOrigin;
    }
    return status(input);
  }
  async function stop(input) {
    keys(input, ['tenant', 'instanceId']); const entry = await required(input.tenant);
    const state = await entry.console.status();
    if (state.instanceId !== input.instanceId || !input.instanceId)
      fail('DISCOVERY_CONSOLE_CONFLICT', 'Refresh the tenant’s exact owned discovery instance.');
    await closeExplorer(entry);
    await entry.console.stop({ instanceId: input.instanceId });
    return status({ tenant: input.tenant });
  }
  async function enrollment(input) {
    keys(input, ['tenant']); const entry = await required(input.tenant);
    return { schema: SCHEMA, tenant: input.tenant, enrollment: await entry.console.enrollment() };
  }
  async function source(input) {
    keys(input, ['tenant', 'slot', 'releaseId']); tenant(input.tenant);
    const selected = locate(input.tenant, input.slot), { config, setup } = await running(input.tenant);
    const [catalog, requested] = await Promise.all([
      releaseCatalogStatus(selected.slot.store, { config, releaseId: input.releaseId }),
      reviewReleaseDiscoverySetup(selected.slot.store, { releaseId: input.releaseId,
        sellerId: setup.sellerId, sourceURL: setup.source.sourceURL }),
    ]);
    return { schema: SCHEMA, tenant: input.tenant, slot: input.slot, source: requested.source,
      catalog: publicCatalog(catalog), permissions: permissionReview(setup.permissions, requested.permissions) };
  }
  async function reviewPublication(input) {
    keys(input, ['tenant', 'slot', 'instanceId', 'action', 'routeId', 'reason', 'sourceSlot', 'sourceReleaseId']);
    if (!input.slot || !input.instanceId) fail('FLEET_DISCOVERY_INSTANCE_REQUIRED', 'Select the exact serving instance.', 400);
    const source = await current(input.tenant, { slot: input.slot, instanceId: input.instanceId });
    const { config, setup } = await running(input.tenant);
    const alternate = input.sourceSlot !== undefined || input.sourceReleaseId !== undefined;
    if (alternate && (input.action !== 'withdraw' || !input.sourceSlot || !input.sourceReleaseId))
      fail('FLEET_DISCOVERY_WITHDRAWAL_SOURCE_REQUIRED',
        'A retained withdrawal uses both its original slot and release ID.', 400);
    const sourceRoot = alternate ? locate(input.tenant, input.sourceSlot).slot.store : source.store;
    const sourceReleaseId = alternate ? input.sourceReleaseId : source.releaseId;
    const requested = await reviewReleaseDiscoverySetup(sourceRoot, {
      releaseId: sourceReleaseId, sellerId: setup.sellerId, sourceURL: setup.source.sourceURL });
    const permissions = permissionReview(setup.permissions, requested.permissions);
    const catalog = await reviewReleaseCatalog(sourceRoot, { config, releaseId: sourceReleaseId,
      action: input.action ?? 'publish', ...(input.routeId !== undefined ? { routeId: input.routeId } : {}),
      ...(input.reason !== undefined ? { reason: input.reason } : {}) });
    return keep({ kind: 'publication', tenant: input.tenant, serving: binding(source), permissions,
      config, catalog, sourceRoot });
  }
  async function applyPublication(input) {
    const saved = take(input, 'publication');
    await sameServing(saved.serving);
    const { config, setup } = await running(input.tenant);
    if (hash(config) !== hash(saved.config)) fail('FLEET_DISCOVERY_AUTHORITY_CHANGED', 'Reopen and review the current tenant signing authority.');
    return withServing(saved.serving, async () => {
      const requested = await reviewReleaseDiscoverySetup(saved.sourceRoot, {
        releaseId: saved.catalog.release.id, sellerId: setup.sellerId, sourceURL: setup.source.sourceURL });
      const permissions = permissionReview(setup.permissions, requested.permissions);
      if (saved.catalog.action === 'publish' && !permissions.covered)
        fail('FLEET_DISCOVERY_PERMISSIONS_CHANGED',
          'The selected offers exceed the retained seller enrollment. Review its exact origin, recipients, networks and schemes.');
      const result = await applyReleaseCatalog(saved.sourceRoot, { config, review: saved.catalog });
      return { schema: SCHEMA, tenant: input.tenant, serving: saved.serving,
        result: { ...result, ...(result.status ? { status: publicCatalog(result.status) } : {}) } };
    });
  }
  async function history(input) {
    keys(input, ['tenant', 'catalogKey']);
    if (typeof input.catalogKey !== 'string' || !input.catalogKey || input.catalogKey.length > 4096)
      fail('FLEET_DISCOVERY_RESOURCE_REQUIRED', 'Select the exact retained catalogue resource.', 400);
    const { config } = await running(input.tenant);
    const current = await requestCatalogOperator({ directory: config.directory, operation: 'lookup',
      input: { catalogKey: input.catalogKey } });
    if (!current.current || current.current.sellerId !== config.sellerId)
      fail('FLEET_DISCOVERY_RESOURCE_UNKNOWN', 'This resource does not belong to the enrolled tenant.', 404);
    const result = await requestCatalogOperator({ directory: config.directory, operation: 'history',
      input: { lifecycleId: current.current.lifecycleId } });
    if (result.journalHead !== current.journalHead)
      fail('RELEASE_CATALOG_CHANGED', 'The catalogue changed during readback. Read this resource again.');
    return { schema: SCHEMA, tenant: input.tenant, catalogKey: input.catalogKey,
      sellerId: config.sellerId, ...result };
  }
  async function consume(input) {
    keys(input, ['tenant', 'view', 'limit', 'offset', 'query', 'cursor', 'network', 'type', 'scheme', 'payTo', 'extensions']);
    const { entry, state } = await running(input.tenant);
    if (!entry.explorer || entry.explorerSource !== state.discoveryOrigin)
      fail('FLEET_DISCOVERY_CONSUMER_REQUIRED', 'Start this tenant’s original buyer explorer.');
    const target = new URL('/api/discovery', entry.explorer.url);
    for (const [name, value] of Object.entries(input)) if (name !== 'tenant') {
      if (!['string', 'number'].includes(typeof value))
        fail('FLEET_DISCOVERY_INPUT_INVALID', 'Use the original list or search page parameters.', 400);
      target.searchParams.set(name, String(value));
    }
    const response = await fetch(target, { redirect: 'error', headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(25000) });
    const page = await response.json();
    if (!response.ok) fail(page.error ?? 'FLEET_DISCOVERY_READ_FAILED', page.reason ?? 'The original discovery page could not be read.', response.status);
    return { schema: SCHEMA, tenant: input.tenant, discoveryOrigin: state.discoveryOrigin,
      buyerExplorerURL: entry.explorer.url, page };
  }
  const close = () => {
    if (!closePromise) {
      closed = true; reviews.clear();
      closePromise = (async () => {
        await Promise.allSettled([...opening.values()]);
        const results = await Promise.allSettled([...consoles.values()].map(async row => {
          try { await closeExplorer(row); } finally { await row.console.close(); }
        }));
        const errors = results.filter(row => row.status === 'rejected').map(row => row.reason);
        if (errors.length) throw new AggregateError(errors, 'Original tenant discovery shutdown failed.');
      })();
    }
    return closePromise;
  };
  return { status, reviewEnrollment, createEnrollment, start, stop, enrollment,
    reviewPublication, applyPublication, source, history, consume, close };
}
