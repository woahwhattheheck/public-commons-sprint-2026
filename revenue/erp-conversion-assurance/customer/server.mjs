#!/usr/bin/env node
// MIT. Customer operations compose the maintained conversion browser and service.
import { constants } from 'node:fs';
import { open, lstat, readdir, statfs, rename } from 'node:fs/promises';
import { join, dirname, resolve, basename, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { startConversionWorkspace } from '../scap-workspace/server.mjs';
import { fail } from '../scap-workspace/mapping.mjs';
import { privateDirectory, readPrivate, atomic, need } from '../agx/custody.mjs';
import { acquireStateLease } from '../../../stellar/scf-starforge-20261009/merchant-fleet-gateway/state-lease.mjs';
import { openCustomer, customerSummary, backupCustomer, restoreCustomer,
  createAgentRequest, archiveOperation } from './workspace.mjs';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const RESTORE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const runningStates = new Set(['PREPARING', 'UPLOADING', 'RECEIVING']);
const time = () => new Date().toISOString();
const errorCode = error => String(error.code ?? error.message ?? 'CUSTOMER_OPERATION_FAILED');
const errors = {
  CUSTOMER_COMPARISON_BUSY: 'A comparison is still running. Let it finish, then create the complete backup.',
  CUSTOMER_WORKSPACE_BUSY: 'Another customer operation is active. Refresh its transfer status.',
  SOURCE_CHANGED_DURING_BACKUP: 'Saved customer files changed during capture. Finish those edits, then create a new backup.',
  SOURCE_CHANGED_DURING_COPY: 'The original service changed during adoption. Let the active work finish, then receive it again.',
  ARCHIVE_SHA256_CONFLICT: 'The selected archive differs from its original backup receipt.',
  BACKUP_FILE_CHANGED: 'A file in the selected backup differs from its recorded bytes.',
  BACKUP_INVENTORY_CONFLICT: 'The backup has a different file inventory from its manifest.',
  CUSTOMER_IDENTITY_CONFLICT: 'This backup belongs to a different customer workspace.',
  RESTORE_DESTINATION_EXISTS: 'That installation name already exists. Reopen it or choose a new receiving name.',
  TRANSFER_INTERRUPTED: 'This transfer stopped before completion. Continue the saved transfer to finish from its original files.',
  UPLOAD_SIZE_CONFLICT: 'The received archive size differs from the selected file.',
  INSUFFICIENT_DISK_SPACE: 'This machine needs more free disk space for the complete incoming archive.',
  ENOSPC: 'The machine ran out of disk space while receiving this workspace.',
  '28': 'The machine ran out of disk space while receiving this workspace.',
};
const viewError = error => ({ code: errorCode(error), message: errors[errorCode(error)] ?? 'The customer operation could not finish. Its original transfer status and files remain available.' });
const exists = async path => { try { await lstat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } };
async function ensure(path) {
  try { await privateDirectory(path, true); }
  catch (error) { if (error.code !== 'EEXIST') throw error; await privateDirectory(path); }
}
const tokenId = value => {
  if (typeof value !== 'string' || !UUID.test(value)) fail('TRANSFER_ID_INVALID', 'Use the original customer transfer identifier.');
  return value;
};
async function enoughDisk(path, bytes) {
  const capacity = await statfs(path);
  const available = capacity.bavail * capacity.bsize;
  if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > available)
    fail('INSUFFICIENT_DISK_SPACE', errors.INSUFFICIENT_DISK_SPACE, 413);
}

export async function startCustomerWorkspace({ directory, port = 0 } = {}) {
  const customer = await openCustomer(directory);
  const transferRoot = join(dirname(customer.root), 'customer-transfers-' + customer.configuration.customerId);
  await ensure(transferRoot);
  const active = new Map(), receivedSessions = new Map();
  let closing = false;
  const transferDirectory = id => join(transferRoot, tokenId(id));
  const recordPath = id => join(transferDirectory(id), 'operation.json');
  function receivingDestination(value) {
    need(value.type === 'restore' && typeof value.destinationName === 'string' &&
      RESTORE_NAME.test(value.destinationName), 'CUSTOMER_TRANSFER_INVALID');
    // Installation names belong to this customer cohort. Historical absolute
    // paths remain in receipts; reopening follows the current real parent.
    return join(dirname(customer.root), value.destinationName);
  }
  async function saved(id) {
    // Atomic replacement can unlink an already-open previous operation record,
    // changing that inode's ctime. Retry this mutable status read through the
    // original strict private-file reader; immutable archives retain its checks.
    for (let attempt = 0; ; attempt++) {
      try {
        const value = JSON.parse(await readPrivate(recordPath(id), 4 * 1024 * 1024));
        need(value.schema === 'erp-reconciliation.customer-transfer.v1' &&
          value.id === id && value.customerId === customer.configuration.customerId,
          'CUSTOMER_TRANSFER_INVALID');
        return value;
      } catch (error) {
        if (error.code !== 'FILE_CHANGED' || attempt === 3) throw error;
        await new Promise(resolve => setImmediate(resolve));
      }
    }
  }
  async function write(value) {
    await atomic(recordPath(value.id), value);
    return value;
  }
  function publicTransfer(value) {
    const result = { id: value.id, type: value.type, state: value.state, createdAt: value.createdAt,
      finishedAt: value.finishedAt, filename: value.filename, destinationName: value.destinationName,
      error: value.error, receipt: value.receipt, recovering: active.has(value.id),
      expectedBytes: value.expectedBytes, sha256: value.sha256 };
    if (value.type === 'backup' && value.state === 'READY')
      result.download = '/api/customer/transfers/' + value.id + '/download';
    return result;
  }
  async function reconcileOriginal(id, { resume = false } = {}) {
    const retained = await saved(id);
    if (retained.state === 'READY') return;
    // One interrupted result gets one automatic reconciliation. Its terminal
    // error settles until the operator explicitly continues that same transfer.
    const attempting = { ...retained, reconciliationAttemptedAt: time() };
    await write(attempting);
    if (retained.type === 'backup') {
      const filename = retained.filename ?? 'customer-' + id + '.zip';
      if (await exists(join(transferDirectory(id), filename))) return reconcileBackup(attempting);
      if (resume) return prepareBackup(attempting);
    } else {
      const incoming = join(transferDirectory(id), 'incoming.zip');
      const incomingStat = await exists(incoming) ? await lstat(incoming) : null;
      if (incomingStat?.size === retained.expectedBytes) return receive(id);
      if (resume) {
        // Keep the interrupted bytes on this same transfer before reopening its
        // original upload plan. Complete archives are always reconciled above.
        if (incomingStat) {
          need(incomingStat.isFile() && !incomingStat.isSymbolicLink(), 'CUSTOMER_TRANSFER_INVALID');
          await rename(incoming, join(transferDirectory(id), 'incoming.partial-' + randomUUID() + '.zip'));
        }
        return write({ ...attempting, state: 'AWAITING_UPLOAD', error: undefined,
          finishedAt: undefined, uploadReopenedAt: time() });
      }
    }
    return write({ ...attempting, state: 'INTERRUPTED', finishedAt: time(),
      error: viewError({ code: 'TRANSFER_INTERRUPTED' }) });
  }
  async function originalStatus(id) {
    const value = await saved(id);
    const interrupted = runningStates.has(value.state);
    const unsettled = ['FAILED', 'INTERRUPTED'].includes(value.state) && !value.reconciliationAttemptedAt;
    if ((interrupted || unsettled) && !active.has(id)) background(id, () => reconcileOriginal(id));
    return value;
  }
  async function createTransfer({ id = randomUUID(), type, ...details }) {
    tokenId(id);
    if (closing) fail('CUSTOMER_CLOSING', 'The customer workspace is closing.', 503);
    if (await exists(transferDirectory(id))) {
      const retained = await saved(id);
      need(retained.type === type && (!details.destinationName || retained.destinationName === details.destinationName),
        'CUSTOMER_TRANSFER_CONFLICT');
      return { value: retained, reused: true };
    }
    await privateDirectory(transferDirectory(id), true);
    const value = { schema: 'erp-reconciliation.customer-transfer.v1', id, customerId: customer.configuration.customerId,
      type, state: type === 'backup' ? 'PREPARING' : 'AWAITING_UPLOAD', createdAt: time(), ...details };
    await atomic(recordPath(id), value, true);
    return { value, reused: false };
  }
  function background(id, task) {
    if (active.has(id)) return active.get(id);
    const hold = Promise.withResolvers();
    active.set(id, hold.promise);
    void (async () => {
      let lease;
      try {
        lease = await acquireStateLease(transferDirectory(id));
        lease.assertHeld();
        await task();
      } catch (error) {
        // A competing host owns its own status. Only this acquired lease may
        // record the outcome of the task it actually ran.
        if (lease) {
          const value = await saved(id);
          await write({ ...value, state: 'FAILED', finishedAt: time(), error: viewError(error) });
        }
      } finally {
        if (lease) await lease.close();
        if (active.get(id) === hold.promise) active.delete(id);
        hold.resolve();
      }
    })().catch(error => {
      if (active.get(id) === hold.promise) active.delete(id);
      hold.resolve();
    });
    return hold.promise;
  }
  async function prepareBackup(value) {
    const id = value.id, filename = 'customer-' + id + '.zip';
    await write({ ...value, state: 'PREPARING', error: undefined, finishedAt: undefined });
    const receipt = await backupCustomer({ directory: customer.root,
      destination: join(transferDirectory(id), filename) });
    await atomic(join(transferDirectory(id), 'backup-receipt.json'), receipt, true);
    return write({ ...value, filename, receipt, state: 'READY', error: undefined, finishedAt: time() });
  }
  async function reconcileBackup(value) {
    const id = value.id, filename = value.filename ?? 'customer-' + id + '.zip';
    const archive = join(transferDirectory(id), filename);
    const receiptPath = join(transferDirectory(id), 'backup-receipt.json');
    let receipt = await exists(receiptPath) ? JSON.parse(await readPrivate(receiptPath, 32768)) : null;
    const verified = await archiveOperation(['verify', '--archive', archive,
      ...(receipt?.sha256 ? ['--sha256', receipt.sha256] : [])]);
    need(verified.customerId === customer.configuration.customerId, 'CUSTOMER_IDENTITY_CONFLICT');
    const size = (await lstat(archive)).size;
    if (receipt) need(receipt.schema === 'erp-reconciliation.customer-backup-receipt.v1' &&
      receipt.customerId === verified.customerId && receipt.backupId === verified.backupId &&
      receipt.manifestSha256 === verified.manifestSha256 && receipt.bytes === size, 'CUSTOMER_TRANSFER_INVALID');
    else {
      receipt = { schema: 'erp-reconciliation.customer-backup-receipt.v1',
        backupId: verified.backupId, customerId: verified.customerId,
        capturedAt: verified.capturedAt, archive, sha256: verified.archiveSha256, bytes: size,
        manifestSha256: verified.manifestSha256, files: verified.files, sourceBytes: verified.sourceBytes };
      await atomic(receiptPath, receipt, true);
    }
    return write({ ...value, filename, receipt, state: 'READY', error: undefined,
      finishedAt: value.finishedAt ?? time(), reconciledAt: time() });
  }
  async function receive(id) {
    const value = await saved(id);
    const destination = receivingDestination(value);
    await write({ ...value, state: 'RECEIVING', error: undefined });
    const archive = join(transferDirectory(id), 'incoming.zip');
    const verified = await archiveOperation(['verify', '--archive', archive,
      ...(value.sha256 ? ['--sha256', value.sha256] : [])]);
    need(verified.customerId === customer.configuration.customerId, 'CUSTOMER_IDENTITY_CONFLICT');
    const receiptPath = join(transferDirectory(id), 'receiving.json');
    let receipt;
    if (await exists(receiptPath)) {
      receipt = JSON.parse(await readPrivate(receiptPath, 32 * 1024 * 1024));
      need(receipt.schema === 'erp-reconciliation.customer-restore-receipt.v1' &&
        receipt.customerId === verified.customerId && receipt.archiveSha256 === verified.archiveSha256 &&
        typeof receipt.directory === 'string' && isAbsolute(receipt.directory) &&
        basename(receipt.directory) === value.destinationName &&
        receipt.manifestSha256 === verified.manifestSha256, 'CUSTOMER_TRANSFER_INVALID');
      if (receipt.directory !== destination) {
        // A relocated interrupted operation must still contain the complete
        // original published customer, before consuming its historical receipt.
        await archiveOperation(['reconcile', '--archive', archive,
          '--destination', destination, '--sha256', verified.archiveSha256]);
      }
      const reopened = await openCustomer(destination);
      need(reopened.configuration.customerId === verified.customerId, 'CUSTOMER_IDENTITY_CONFLICT');
    } else {
      if (await exists(destination)) {
        const matched = await archiveOperation(['reconcile', '--archive', archive,
          '--destination', destination, '--sha256', verified.archiveSha256]);
        receipt = { ...matched, customer: await customerSummary(destination) };
      } else receipt = await restoreCustomer({ archive, directory: destination,
        sha256: verified.archiveSha256 });
      // Receiving is durable before opening or capturing the new browser.
      await atomic(receiptPath, receipt, true);
    }
    const { customer: summary, ...received } = receipt;
    need(summary.customer.customerId === verified.customerId, 'CUSTOMER_IDENTITY_CONFLICT');
    await write({ ...value, state: 'READY', error: undefined, receipt: { ...received,
      customer: { customerId: summary.customer.customerId, name: summary.customer.name },
      counts: { jobs: summary.jobs.length, bundles: summary.bundles.length, reviews: summary.reviews.length } },
      finishedAt: value.finishedAt ?? time() });
  }

  const extension = {
    id: 'customer-installation', browserModule: '/customer-browser.mjs',
    assets: [
      { path: '/customer-browser.mjs', file: new URL('./browser.mjs', import.meta.url), type: 'text/javascript; charset=utf-8' },
      { path: '/customer-style.css', file: new URL('./style.css', import.meta.url), type: 'text/css; charset=utf-8' },
    ],
    async handleRequest({ req, res, url, model, readJson, send }) {
      if (!url.pathname.startsWith('/api/customer/')) return false;
      if (closing) fail('CUSTOMER_CLOSING', 'The customer workspace is closing.', 503);
      try {
        if (req.method === 'GET' && url.pathname === '/api/customer/info') {
          const summary = await customerSummary(customer.root);
          const bindings = (await readdir(join(customer.providerRoot, 'peers', customer.configuration.peer, 'bindings')))
            .filter(name => /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}\.json$/.test(name));
          return send(res, 200, { customer: summary.customer, profile: summary.profile, limits: summary.limits,
            counts: { jobs: summary.jobs.length, bundles: summary.bundles.length, reviews: summary.reviews.length, agentRequests: bindings.length },
            serviceDirectory: customer.serviceDirectory }), true;
        }
        if (req.method === 'GET' && url.pathname === '/api/customer/transfers') {
          const ids = (await readdir(transferRoot)).filter(name => UUID.test(name));
          const values = [];
          for (const id of ids) values.push(publicTransfer(await originalStatus(id)));
          values.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
          return send(res, 200, { transfers: values }), true;
        }
        if (req.method === 'POST' && url.pathname === '/api/customer/request') {
          const body = await readJson(req, 4096);
          const result = await createAgentRequest({ directory: customer.root, jobId: body.jobId });
          return send(res, 200, result), true;
        }
        if (req.method === 'POST' && url.pathname === '/api/customer/backups') {
          const body = await readJson(req, 4096);
          const created = await createTransfer({ id: body.id, type: 'backup' });
          const id = created.value.id;
          if (!created.reused) background(id, async () => prepareBackup(await saved(id)));
          return send(res, 202, publicTransfer(await saved(id))), true;
        }
        if (req.method === 'POST' && url.pathname === '/api/customer/restores') {
          const body = await readJson(req, 4096);
          if (typeof body.destinationName !== 'string' || !RESTORE_NAME.test(body.destinationName))
            fail('RECEIVING_NAME_INVALID', 'Use a new installation name of up to 80 letters, digits, dots, underscores or hyphens.');
          if (body.sha256 !== undefined && body.sha256 !== '' && !/^[a-f0-9]{64}$/.test(body.sha256))
            fail('ARCHIVE_SHA256_INVALID', 'Enter the original 64-character lowercase SHA-256, or leave this field empty.');
          const destination = join(dirname(customer.root), body.destinationName);
          const id = tokenId(body.id);
          if (!await exists(transferDirectory(id))) {
            if (await exists(destination)) fail('RESTORE_DESTINATION_EXISTS', errors.RESTORE_DESTINATION_EXISTS, 409);
            await enoughDisk(transferRoot, body.bytes);
          }
          const created = await createTransfer({ id, type: 'restore', destinationName: body.destinationName,
            destination, expectedBytes: body.bytes, sha256: body.sha256 || null });
          if (created.value.expectedBytes !== body.bytes || created.value.sha256 !== (body.sha256 || null))
            fail('CUSTOMER_TRANSFER_CONFLICT', 'Resume the original selected archive for this receiving operation.', 409);
          return send(res, 202, publicTransfer(created.value)), true;
        }
        const match = /^\/api\/customer\/transfers\/([a-f0-9-]{36})(?:\/(upload|download|open|continue))?$/.exec(url.pathname);
        if (match) {
          const id = tokenId(match[1]), action = match[2];
          if (req.method === 'GET' && !action) return send(res, 200, publicTransfer(await originalStatus(id))), true;
          if (req.method === 'POST' && action === 'continue') {
            await readJson(req, 1024);
            const value = await saved(id);
            if (!['FAILED', 'INTERRUPTED'].includes(value.state) && !runningStates.has(value.state))
              fail('TRANSFER_CONTINUATION_NOT_REQUIRED', 'Open the completed transfer or finish its original upload.', 409);
            background(id, () => reconcileOriginal(id, { resume: true }));
            return send(res, 202, publicTransfer(await saved(id))), true;
          }
          if (req.method === 'POST' && action === 'upload') {
            let value = await saved(id);
            if (value.type !== 'restore') fail('TRANSFER_TYPE_CONFLICT', 'Choose the original receiving operation.');
            if (value.state !== 'AWAITING_UPLOAD') {
              req.resume();
              return send(res, 200, publicTransfer(await originalStatus(id))), true;
            }
            if (!/^application\/zip(?:\s*;.*)?$/i.test(req.headers['content-type'] ?? ''))
              fail('BACKUP_UPLOAD_REQUIRED', 'Upload the selected complete ZIP backup.', 415);
            const length = Number(req.headers['content-length']);
            if (!Number.isSafeInteger(length) || length !== value.expectedBytes)
              fail('UPLOAD_SIZE_CONFLICT', errors.UPLOAD_SIZE_CONFLICT);
            await enoughDisk(transferRoot, length);
            if (closing) fail('CUSTOMER_CLOSING', 'The customer workspace is closing.', 503);
            if (active.has(id)) {
              req.resume();
              return send(res, 202, publicTransfer(await saved(id))), true;
            }
            let output, lease, continued = false;
            const hold = Promise.withResolvers();
            active.set(id, hold.promise);
            try {
              lease = await acquireStateLease(transferDirectory(id));
              value = await saved(id);
              need(value.state === 'AWAITING_UPLOAD', 'CUSTOMER_TRANSFER_CONFLICT');
              await write({ ...value, state: 'UPLOADING' });
              req.setTimeout(600000, () => req.destroy());
              output = await open(join(transferDirectory(id), 'incoming.zip'),
                constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
              let bytes = 0;
              for await (const chunk of req) {
                bytes += chunk.length;
                need(bytes <= length, 'UPLOAD_SIZE_CONFLICT');
                let offset = 0;
                while (offset < chunk.length) {
                  const written = await output.write(chunk, offset, chunk.length - offset, null);
                  need(written.bytesWritten > 0, 'UPLOAD_WRITE_FAILED');
                  offset += written.bytesWritten;
                }
              }
              need(bytes === length, 'UPLOAD_SIZE_CONFLICT');
              await output.sync(); await output.close(); output = null;
              await write({ ...value, state: 'RECEIVING' });
              // Continue the same upload owner and promise through publication;
              // close() can drain this exact operation without losing a suffix.
              continued = true;
              void (async () => {
                try { await receive(id); }
                catch (error) {
                  const current = await saved(id);
                  await write({ ...current, state: 'FAILED', finishedAt: time(), error: viewError(error) });
                } finally {
                  await lease.close();
                  if (active.get(id) === hold.promise) active.delete(id);
                  hold.resolve();
                }
              })().catch(() => {
                if (active.get(id) === hold.promise) active.delete(id);
                hold.resolve();
              });
              return send(res, 202, publicTransfer(await saved(id))), true;
            } catch (error) {
              req.resume();
              if (lease) {
                const current = await saved(id);
                await write({ ...current, state: 'FAILED', finishedAt: time(), error: viewError(error) });
              }
              throw error;
            } finally {
              if (output) await output.close().catch(() => {});
              if (!continued) {
                if (lease) await lease.close();
                if (active.get(id) === hold.promise) active.delete(id);
                hold.resolve();
              }
            }
          }
          if (req.method === 'GET' && action === 'download') {
            const value = await originalStatus(id);
            if (value.type !== 'backup' || value.state !== 'READY')
              fail('BACKUP_NOT_READY', 'Wait for the complete backup to finish before downloading.', 409);
            const path = join(transferDirectory(id), value.filename);
            const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
            try {
              const info = await file.stat();
              need(info.isFile() && !(info.mode & 0o077) && info.uid === process.getuid() &&
                info.size === value.receipt.bytes, 'BACKUP_FILE_CHANGED');
              res.statusCode = 200;
              res.setHeader('Content-Type', 'application/zip');
              res.setHeader('Content-Length', info.size);
              res.setHeader('Content-Disposition', 'attachment; filename="' + value.filename + '"');
              res.setHeader('X-Customer-Archive-Sha256', value.receipt.sha256);
              await pipeline(file.createReadStream({ autoClose: false }), res);
            } finally { await file.close(); }
            return true;
          }
          if (req.method === 'POST' && action === 'open') {
            await readJson(req, 1024);
            const value = await originalStatus(id);
            if (value.type !== 'restore' || value.state !== 'READY')
              fail('RECEIVING_NOT_READY', 'Finish receiving this customer before opening its restored workspace.', 409);
            const destination = receivingDestination(value);
            const selected = await openCustomer(destination);
            need(selected.configuration.customerId === customer.configuration.customerId, 'CUSTOMER_IDENTITY_CONFLICT');
            if (closing) fail('CUSTOMER_CLOSING', 'The customer workspace is closing.', 503);
            let opening = receivedSessions.get(id);
            if (!opening) {
              opening = startCustomerWorkspace({ directory: destination, port: 0 });
              receivedSessions.set(id, opening);
              opening.catch(() => { if (receivedSessions.get(id) === opening) receivedSessions.delete(id); });
            }
            const received = await opening;
            return send(res, 200, { url: received.url, customerId: customer.configuration.customerId,
              destinationName: value.destinationName }), true;
          }
        }
        fail('CUSTOMER_ENDPOINT_NOT_FOUND', 'The customer operation was not found.', 404);
      } catch (error) {
        if (res.headersSent) throw error;
        const known = error.status ? { status: error.status, code: error.code, message: error.message } : null;
        const view = known ?? { status: ['ENOENT'].includes(errorCode(error)) ? 404 : 409, ...viewError(error) };
        send(res, view.status, { error: view.code, message: view.message });
        return true;
      }
    },
  };
  const session = await startConversionWorkspace({ directory: customer.serviceDirectory,
    service: customer.service, profile: customer.profile, port, extension });
  // A complete streamed customer archive can legitimately take longer than the
  // retained host's ordinary JSON request window. Header and body limits remain.
  session.server.requestTimeout = 660000;
  return { ...session, customer, transferRoot, async close() {
    closing = true;
    await session.close();
    while (active.size) await Promise.allSettled([...active.values()]);
    await Promise.allSettled([...receivedSessions.values()].map(async opening => (await opening).close()));
  } };
}

async function main(args) {
  process.umask(0o077);
  const values = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--directory', '--port'].includes(args[i]) || !args[i + 1] || Object.hasOwn(values, args[i]))
      throw new Error('USE_DIRECTORY_AND_OPTIONAL_PORT');
    values[args[i]] = args[i + 1];
  }
  const port = values['--port'] === undefined ? 0 : Number(values['--port']);
  const session = await startCustomerWorkspace({ directory: values['--directory'], port });
  const stop = () => session.close().catch(error => {
    process.stderr.write(JSON.stringify({ error: viewError(error) }) + '\n'); process.exitCode = 1;
  });
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  process.stdout.write(JSON.stringify({ application: 'customer-conversion-workspace',
    customer: session.customer.configuration.name, customerId: session.customer.configuration.customerId,
    directory: session.customer.root, workspace: session.url }) + '\n');
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  main(process.argv.slice(2)).catch(error => {
    process.stderr.write(JSON.stringify({ error: viewError(error) }) + '\n'); process.exitCode = 1;
  });
