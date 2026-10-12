// MIT. Original n8n merchant launch, private identity and same-source managed reopening.
import { readFile, realpath } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { canonical, digest, plain } from '../jobs/config.mjs';
import { fail } from './config.mjs';
import { prepareN8nMerchant, inspectN8nMerchant } from './prepare.mjs';
import { serveN8nMerchant } from './merchant.mjs';
import { readPrivate, writePrivate, privateDirectory } from './store.mjs';

export const N8N_LAUNCH_SCHEMA = 'stellar-forge.n8n-merchant-launch.v1';
const SOURCE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const commandSources = ['cli.mjs', 'launch.mjs', 'prepare.mjs', 'merchant.mjs', 'workspace/server.mjs'];

async function sourceSelection(sourceDirectory, launchSourceDirectory) {
  sourceDirectory = resolve(sourceDirectory ?? SOURCE_DIRECTORY);
  launchSourceDirectory = resolve(launchSourceDirectory ?? sourceDirectory);
  if (sourceDirectory !== SOURCE_DIRECTORY || await realpath(sourceDirectory) !== sourceDirectory ||
      await realpath(launchSourceDirectory) !== launchSourceDirectory)
    fail('LAUNCH_SOURCE', 'Use the original selected installed n8n merchant source.', 409);
  const files = [];
  for (const name of commandSources) {
    const selected = await readFile(join(sourceDirectory, name));
    const launched = await readFile(join(launchSourceDirectory, name));
    if (!selected.equals(launched)) fail('LAUNCH_SOURCE', 'The managed command differs from the selected original source: ' + name, 409);
    files.push({ path: name, bytes: selected.length, sha256: digest(selected) });
  }
  return { sourceDirectory, launchSourceDirectory, sourceFiles: files };
}
function operatorAddress(value) {
  let url; try { url = new URL(value); } catch {}
  if (!url || url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.pathname !== '/' ||
      url.search || url.username || url.password || !/^#[a-f0-9]{64}$/.test(url.hash) ||
      Number(url.port || 80) < 1 || Number(url.port || 80) > 65535)
    fail('LAUNCH_ADDRESS', 'Read the original private n8n operator address.', 409);
  return url;
}

export async function startN8nMerchantLaunch({ directory, configPath, sourceDirectory, launchSourceDirectory,
  env = process.env, nativeFactoryPath, startWorker = false, sellerPort = 0, customerPort = 0,
  operatorPort = 0, operationsPort = 0, jobsOperatorPort = 0 } = {}) {
  directory = resolve(directory);
  const selected = await sourceSelection(sourceDirectory, launchSourceDirectory);
  if (configPath) await prepareN8nMerchant({ configPath, directory, resume: true });
  const prepared = await inspectN8nMerchant(directory, { env });
  nativeFactoryPath = nativeFactoryPath ? resolve(nativeFactoryPath) : null;
  const ports = { sellerPort, customerPort, operatorPort, operationsPort, jobsOperatorPort };
  if (Object.values(ports).some(value => !Number.isInteger(value) || value < 0 || value > 65535))
    fail('PORT', 'Choose local service ports from 0 to 65535.');
  const fixedPorts = Object.values(ports).filter(Boolean);
  if (new Set(fixedPorts).size !== fixedPorts.length) fail('PORT', 'Use distinct fixed service ports, or 0 for automatic ports.');
  if (typeof startWorker !== 'boolean') fail('LAUNCH_WORKER', 'Select whether the original worker starts.');
  const session = await serveN8nMerchant({ directory, env, nativeFactoryPath, startWorker, ...ports });
  let closing;
  const privateLaunch = join(directory, 'n8n-launch.json');
  const announcement = {
    schema: N8N_LAUNCH_SCHEMA, state: 'LISTENING', directory, ...selected,
    privateLaunch, pid: process.pid, ppid: process.ppid, instanceId: randomUUID(),
    configurationSha256: prepared.configurationSha256, applicationSha256: prepared.record.applicationSha256,
    nativeFactoryPath, startWorker, requestedPorts: ports, startedAt: new Date().toISOString(),
    url: session.url, seller: session.seller, customer: session.customer,
    operations: session.operations, jobsOperator: session.jobsOperator,
  };
  const close = () => closing ??= (async () => {
    // Write while the original job model still owns its lease. After close a
    // newer launch may own the state, so this process performs no further writes.
    const stopped = { ...announcement, state: 'STOPPING', stoppingAt: new Date().toISOString() };
    const failures = [];
    session.merchant.launch = stopped;
    try { await writePrivate(privateLaunch, Buffer.from(canonical(stopped) + '\n'), { replace: true }); }
    catch (error) { failures.push(error); }
    try { await session.close(); } catch (error) { failures.push(error); }
    if (failures.length) throw new AggregateError(failures, 'The original n8n launch did not finish closing.');
  })();
  try {
    operatorAddress(announcement.url);
    await writePrivate(privateLaunch, Buffer.from(canonical(announcement) + '\n'), { replace: true });
    session.merchant.launch = announcement;
    return { ...session, announcement, close };
  } catch (error) { await close().catch(() => {}); throw error; }
}

export async function readN8nMerchantLaunch({ directory, sourceDirectory, launchSourceDirectory, pid,
  instanceId, nativeFactoryPath, startWorker } = {}) {
  directory = resolve(directory);
  await privateDirectory(directory, { create: false });
  const selected = await sourceSelection(sourceDirectory, launchSourceDirectory);
  const privateLaunch = join(directory, 'n8n-launch.json');
  const ready = JSON.parse(await readPrivate(privateLaunch, 65536));
  const prepared = await inspectN8nMerchant(directory);
  if (!plain(ready) || ready.schema !== N8N_LAUNCH_SCHEMA || ready.state !== 'LISTENING' ||
      ready.directory !== directory || ready.privateLaunch !== privateLaunch ||
      ready.sourceDirectory !== selected.sourceDirectory || ready.launchSourceDirectory !== selected.launchSourceDirectory ||
      canonical(ready.sourceFiles) !== canonical(selected.sourceFiles) ||
      ready.configurationSha256 !== prepared.configurationSha256 || ready.applicationSha256 !== prepared.record.applicationSha256 ||
      !Number.isSafeInteger(ready.pid) || ready.pid < 1 || !Number.isSafeInteger(ready.ppid) || ready.ppid < 1 ||
      typeof ready.instanceId !== 'string' || !/^[0-9a-f-]{36}$/.test(ready.instanceId) ||
      pid !== undefined && ready.pid !== pid || instanceId !== undefined && ready.instanceId !== instanceId ||
      nativeFactoryPath !== undefined && ready.nativeFactoryPath !== (nativeFactoryPath ? resolve(nativeFactoryPath) : null) ||
      startWorker !== undefined && ready.startWorker !== startWorker)
    fail('LAUNCH_CHANGED', 'Reopen the current original merchant launch for this selected source and directory.', 409);
  try { process.kill(ready.pid, 0); } catch { fail('LAUNCH_CLOSED', 'Start the saved original merchant to open its operator.', 409); }
  const url = operatorAddress(ready.url), token = url.hash.slice(1);
  const response = await fetch(url.origin + '/api/launch', {
    redirect: 'error', headers: { authorization: 'Bearer ' + token, origin: url.origin },
    signal: AbortSignal.timeout(10000),
  });
  if (response.status !== 200) fail('LAUNCH_CLOSED', 'The original private operator did not return its current launch.', 409);
  const chunks = []; let size = 0;
  for await (const chunk of response.body ?? []) {
    size += chunk.byteLength;
    if (size > 65536) fail('LAUNCH_CHANGED', 'The private launch response exceeded its original limit.', 409);
    chunks.push(Buffer.from(chunk));
  }
  let live;
  try { live = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { fail('LAUNCH_CHANGED', 'The original private operator returned an invalid launch record.', 409); }
  if (canonical(live) !== canonical(ready)) fail('LAUNCH_CHANGED', 'The original private operator now belongs to a different launch.', 409);
  return ready;
}
