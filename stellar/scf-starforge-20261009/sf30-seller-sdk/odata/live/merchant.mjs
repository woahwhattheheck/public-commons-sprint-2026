// MIT. One original seller, operations listener, and persistent continuation identity.
import { constants } from 'node:fs';
import { mkdir, lstat, open, readFile, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { startSellerService } from '../../serve.mjs';
import { startSellerOperations } from '../../operations/server.mjs';
import { createODataApplication } from './application.mjs';
import { openOutbox,instrumentNativeSettlement } from '../../../sf98-merchant-delivery/outbox.mjs';

export async function privateDirectory(path) {
  const absolute = resolve(path);
  await mkdir(absolute,{ recursive:true,mode:0o700 });
  const info = await lstat(absolute);
  if (!info.isDirectory() || info.mode & 0o077 || await realpath(absolute) !== absolute)
    throw new TypeError('Use a private regular directory (mode 0700) without symbolic links');
  return absolute;
}
export async function retainedCursorKey(directory) {
  const root = await privateDirectory(directory), path = join(root,'odata-cursor.key');
  let handle;
  try {
    handle = await open(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
    try { await handle.writeFile(randomBytes(32)); await handle.sync(); } finally { await handle.close(); }
  } catch (error) { if (error.code !== 'EEXIST') throw error; }
  handle = await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size !== 32 || info.mode & 0o077) throw new TypeError('Retained OData cursor key must be a private 32-byte file');
    const bytes = await handle.readFile();
    if (bytes.length !== 32) throw new TypeError('Cursor key changed while opening');
    return bytes;
  } finally { await handle.close(); }
}
export async function startODataMerchant({ plan, catalog, directory, env = process.env,
  port = 0, operationsPort = 0, nativeFactory = null, allowLoopback = false, lookup,
  historyRetentionDays = 90, navigationOrigin = null } = {}) {
  const root = await privateDirectory(directory), cursorKey = await retainedCursorKey(root);
  const application = createODataApplication(plan,catalog,{ cursorKey,env,allowLoopback,lookup });
  const outbox=await openOutbox(join(root,'delivery'));
  const settlementFactory=nativeFactory?async compiled=>instrumentNativeSettlement(await nativeFactory(compiled),{compiled,outbox}):null;
  let seller, operations, closing;
  try {
    seller = await startSellerService({ config:application.config, handlers:application.handlers,
      port,nativeFactory:settlementFactory,availabilityDirectory:join(root,'availability') });
    seller.upstreamSnapshot = application.snapshot;
    operations = await startSellerOperations(seller,{ port:operationsPort,
      historyDirectory:join(root,'history'),historyRetentionDays,deliveryOutbox:outbox,navigationOrigin });
  } catch (error) {
    await seller?.close().catch(() => {}); await operations?.close().catch(() => {});
    await application.close().catch(() => {}); throw error;
  }
  const close = () => closing ??= (async () => {
    let failure;
    try { await seller.close(); } catch (error) { failure = error; }
    try { await operations.close(); } catch (error) { failure ??= error; }
    try { await application.close(); } catch (error) { failure ??= error; }
    if (failure) throw failure;
  })();
  return { ...seller,application,operations,outbox,directory:root,close };
}
