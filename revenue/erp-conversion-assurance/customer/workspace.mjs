// Customer installation and complete receiving around the retained service and AGX adapter.
import { lstat, readFile, readdir, rm } from 'node:fs/promises';
import { join, dirname, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { openReconciliationService } from '../service/service.mjs';
import { validateProfile } from '../scap-workspace/mapping.mjs';
import { initializePeer, openPeer, peerDirectory, bindRetainedJob } from '../agx/provider.mjs';
import { privateDirectory, readPrivate, atomic, need, SHA, JOB } from '../agx/custody.mjs';
import { acquireStateLease } from '../../../stellar/scf-starforge-20261009/merchant-fleet-gateway/state-lease.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const CUSTOMER = 'erp-reconciliation.customer.v1';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const profileDefault = join(here, 'finance-profile.json');
const exists = async path => { try { await lstat(path); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } };
const asPath = value => { need(typeof value === 'string' && isAbsolute(value), 'ABSOLUTE_PRIVATE_DIRECTORY_REQUIRED'); return resolve(value); };

async function command(file, args, { env = {}, allowed = [0], timeout = 600000 } = {}) {
  return new Promise((accept, reject) => {
    const child = spawn(file, args, {
      env: { PATH: process.env.PATH ?? '/usr/bin:/bin', PYTHONDONTWRITEBYTECODE: '1', ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '', timedOut = false, ended = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, timeout);
    const hardStop = setTimeout(() => { if (!ended) child.kill('SIGKILL'); }, timeout + 5000);
    child.stdout.on('data', data => { stdout += data; if (stdout.length > 32 * 1024 * 1024) child.kill('SIGKILL'); });
    child.stderr.on('data', data => { if (stderr.length < 32768) stderr += data; });
    child.once('error', error => { ended = true; clearTimeout(timer); clearTimeout(hardStop); reject(error); });
    child.once('close', code => {
      ended = true; clearTimeout(timer); clearTimeout(hardStop);
      if (timedOut) return reject(Object.assign(new Error('CUSTOMER_OPERATION_TIMEOUT'), { code: 'CUSTOMER_OPERATION_TIMEOUT' }));
      if (!allowed.includes(code)) {
        let details;
        try { details = JSON.parse(stderr.trim()); } catch { details = null; }
        const failure = details?.error?.code ?? 'CUSTOMER_OPERATION_FAILED';
        return reject(Object.assign(new Error(String(failure)), { code: String(failure), operationExit: code }));
      }
      try { accept({ code, value: stdout.trim() ? JSON.parse(stdout) : null }); }
      catch { reject(Object.assign(new Error('CUSTOMER_RESULT_INVALID'), { code: 'CUSTOMER_RESULT_INVALID' })); }
    });
  });
}

export async function archiveOperation(args, options = {}) {
  const python = options.python ?? process.env.ERP_CUSTOMER_PYTHON ?? 'python3';
  return (await command(python, [join(here, 'archive.py'), ...args], options)).value;
}

async function ownRuntime(root) {
  const runtime = join(root, 'runtime');
  try { await privateDirectory(runtime, true); }
  catch (error) { if (error.code !== 'EEXIST') throw error; await privateDirectory(runtime); }
  return runtime;
}

async function withCustomerLease(root, callback) {
  let lease;
  try { lease = await acquireStateLease(await ownRuntime(root)); }
  catch (error) {
    if (error.message === 'FLEET_STATE_ALREADY_OWNED') {
      throw Object.assign(new Error('CUSTOMER_WORKSPACE_BUSY'), { code: 'CUSTOMER_WORKSPACE_BUSY' });
    }
    throw error;
  }
  try { lease.assertHeld(); return await callback(); }
  finally { await lease.close(); }
}

// The original queue and worker leases prevent a comparison from starting or
// changing its retained state while its complete private copy is captured.
async function withIdleServices(directories, callback) {
  const leases = [];
  try {
    for (const directory of [...new Set(directories)].sort()) {
      await readPrivate(join(directory, 'service.json'), 4096);
      leases.push(await acquireStateLease(join(directory, 'runtime', 'queue')));
      leases.push(await acquireStateLease(join(directory, 'runtime')));
    }
    for (const lease of leases) lease.assertHeld();
    return await callback();
  } catch (error) {
    if (error.message === 'FLEET_STATE_ALREADY_OWNED') {
      throw Object.assign(new Error('CUSTOMER_COMPARISON_BUSY'), { code: 'CUSTOMER_COMPARISON_BUSY' });
    }
    throw error;
  } finally { for (const lease of leases.reverse()) await lease.close(); }
}

function checkConfiguration(config) {
  need(config?.schema === CUSTOMER && typeof config.customerId === 'string' &&
    /^[a-f0-9-]{36}$/.test(config.customerId) && typeof config.name === 'string' &&
    config.name.trim().length > 0 && config.name.length <= 160 &&
    SHA.test(config.peer ?? '') && SHA.test(config.profileSha256 ?? '') &&
    typeof config.createdAt === 'string' && Number.isFinite(Date.parse(config.createdAt)),
    'CUSTOMER_CONFIGURATION_INVALID');
}

export async function openCustomer(directory) {
  const root = asPath(directory);
  await privateDirectory(root);
  const config = JSON.parse(await readPrivate(join(root, 'customer.json'), 16384));
  checkConfiguration(config);
  const profileBytes = await readPrivate(join(root, 'profile.json'), 262144);
  need(hash(profileBytes) === config.profileSha256, 'CUSTOMER_PROFILE_CHANGED');
  const profile = validateProfile(JSON.parse(profileBytes));
  const providerRoot = join(root, 'provider');
  const selected = await openPeer(providerRoot, config.peer);
  return { root, configuration: config, profile, profilePath: join(root, 'profile.json'),
    providerRoot, agxHome: join(root, 'agx-home'),
    serviceDirectory: peerDirectory(providerRoot, config.peer), service: selected.service };
}

export async function createCustomer({
  directory, name, peer, profile = profileDefault, limits = {}, adoptService,
  adoptProvider, adoptAgxHome, python,
} = {}) {
  const root = asPath(directory);
  need(typeof name === 'string' && name.trim().length > 0 && name.trim().length <= 160,
    'CUSTOMER_NAME_REQUIRED');
  need(SHA.test(peer ?? ''), 'APPROVED_CALLER_PUBLIC_KEY_REQUIRED');
  await privateDirectory(dirname(root));
  const rawProfile = await readFile(resolve(profile));
  need(rawProfile.length <= 262144, 'PROFILE_LIMIT_EXCEEDED');
  validateProfile(JSON.parse(rawProfile));
  let sourceService = null, original = null;
  if (adoptService || adoptProvider) {
    sourceService = adoptService ? asPath(adoptService) : peerDirectory(asPath(adoptProvider), peer);
    await privateDirectory(sourceService);
    await readPrivate(join(sourceService, 'service.json'), 4096);
    await readPrivate(join(sourceService, 'hmac.key'), 256);
    original = await openReconciliationService({ directory: sourceService });
    need(Object.entries(limits).every(([key, value]) => original.configuration[key] === value),
      'SERVICE_CONFIGURATION_MISMATCH');
  }
  await privateDirectory(root, true);
  try {
    const providerRoot = join(root, 'provider');
    const effective = original ? Object.fromEntries(['maxInputBytes', 'maxReportBytes', 'timeoutMs', 'maxHeapMiB']
      .map(key => [key, original.configuration[key]])) : limits;
    await initializePeer(providerRoot, peer, effective);
    const agxHome = join(root, 'agx-home');
    let importReceipt = null;
    if (sourceService) {
      const receivingService = peerDirectory(providerRoot, peer);
      // This directory was created by this new installation; the original source
      // root remains available through its existing operator.
      await rm(receivingService, { recursive: true });
      importReceipt = await withIdleServices([sourceService], async () => {
        const serviceCopy = await archiveOperation(['copy', '--source', sourceService,
          '--destination', receivingService], { python });
        let bindingsCopy = null;
        if (adoptProvider) {
          const from = join(asPath(adoptProvider), 'peers', peer, 'bindings');
          const to = join(providerRoot, 'peers', peer, 'bindings');
          await privateDirectory(from);
          await rm(to, { recursive: true });
          bindingsCopy = await archiveOperation(['copy', '--source', from, '--destination', to], { python });
        }
        return { schema: 'erp-reconciliation.customer-adoption.v1',
          sourceService, serviceCopy, bindingsCopy, adoptedAt: new Date().toISOString() };
      });
      await openReconciliationService({ directory: receivingService });
    }
    if (adoptAgxHome) {
      const copied = await archiveOperation(['copy', '--source', asPath(adoptAgxHome),
        '--destination', agxHome], { python });
      importReceipt = { ...importReceipt, agxIdentityCopy: copied };
    } else await privateDirectory(agxHome, true);
    await ownRuntime(root);
    await atomic(join(root, 'profile.json'), rawProfile, true);
    const configuration = { schema: CUSTOMER, customerId: randomUUID(), name: name.trim(), peer,
      createdAt: new Date().toISOString(), profileSha256: hash(rawProfile),
      providerProfile: 'provider',
      adopted: !!sourceService };
    if (importReceipt) await atomic(join(root, 'adoption.json'), importReceipt, true);
    await atomic(join(root, 'customer.json'), configuration, true);
    const customer = await openCustomer(root);
    // Validate every copied binding against the original service before this
    // installation is presented as ready.
    for (const file of await readdir(join(providerRoot, 'peers', peer, 'bindings'))) {
      need(/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}\.json$/.test(file), 'AGX_BINDING_INVALID');
      const binding = JSON.parse(await readPrivate(join(providerRoot, 'peers', peer, 'bindings', file), 4096));
      need(binding.schema === 'erp-reconciliation.agx-binding.v1' && binding.peer === peer &&
        binding.jobId + '.json' === file && SHA.test(binding.bundleId ?? ''), 'AGX_BINDING_INVALID');
      await customer.service.getBundle(binding.bundleId);
      try { const job = await customer.service.getJob(binding.jobId);
        need(job.bundleId === binding.bundleId, 'JOB_INPUT_CONFLICT'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    return customer;
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}

export async function customerSummary(directory) {
  const customer = await openCustomer(directory);
  const jobs = [], bundles = [];
  let after = '';
  do {
    const page = await customer.service.listJobs({ limit: 1000, after });
    jobs.push(...page.jobs); after = page.nextCursor ?? '';
  } while (after);
  after = '';
  do {
    const page = await customer.service.listBundles({ limit: 1000, after });
    bundles.push(...page.bundles); after = page.nextCursor ?? '';
  } while (after);
  const reviews = [];
  for (const job of jobs) {
    for (const review of await customer.service.getReviews(job.jobId)) reviews.push(review);
  }
  return { schema: 'erp-reconciliation.customer-summary.v1',
    customer: customer.configuration, directory: customer.root,
    serviceDirectory: customer.serviceDirectory, limits: customer.service.configuration,
    profile: { id: customer.profile.id, title: customer.profile.title },
    jobs, bundles, reviews };
}

export async function backupCustomer({ directory, destination, python } = {}) {
  const customer = await openCustomer(directory);
  const target = asPath(destination);
  return withCustomerLease(customer.root, async () => {
    const peers = (await readdir(join(customer.providerRoot, 'peers'))).filter(name => SHA.test(name)).sort();
    const services = [];
    for (const peer of peers) {
      const selected = await openPeer(customer.providerRoot, peer);
      services.push(peerDirectory(customer.providerRoot, selected.peer));
    }
    return withIdleServices(services, () => archiveOperation(['snapshot',
      '--source', customer.root, '--archive', target], { python }));
  });
}

export async function restoreCustomer({ archive, directory, sha256, python } = {}) {
  const args = ['restore', '--archive', asPath(archive), '--destination', asPath(directory)];
  if (sha256) args.push('--sha256', sha256);
  const receipt = await archiveOperation(args, { python });
  const summary = await customerSummary(directory);
  need(summary.customer.customerId === receipt.customerId, 'CUSTOMER_IDENTITY_CONFLICT');
  return { ...receipt, customer: summary };
}

export async function createAgentRequest({ directory, jobId, destination } = {}) {
  need(JOB.test(jobId ?? ''), 'INVALID_JOB_ID');
  const customer = await openCustomer(directory);
  const job = await customer.service.getJob(jobId);
  return withCustomerLease(customer.root, () => bindRetainedJob(
    customer.providerRoot, customer.configuration.peer,
    { jobId, bundleId: job.bundleId, requestOut: destination ? asPath(destination) : undefined }));
}

export function customerLaunchArguments(customer, port = 0) {
  need(Number.isInteger(port) && port >= 0 && port <= 65535, 'INVALID_PORT');
  return [join(here, 'server.mjs'), '--directory', customer.root, '--port', String(port)];
}
