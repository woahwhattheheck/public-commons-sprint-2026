// MIT. Existing release-manager ownership barrier and original pilot bootstrap.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { attachReleaseCacheControls } from './release-cache.mjs';

const [pilot, directory, instanceId, controlFile] = process.argv.slice(2);
let started = false;
process.once('disconnect', () => { if (!started) process.exit(0); });
process.once('message', async message => {
  if (message?.type !== 'sf82-start' || message.instanceId !== instanceId) process.exit(1);
  started = true; process.disconnect();
  let session, control;
  try {
    const { launch } = await import(pathToFileURL(pilot).href);
    session = await launch(['--resume', directory]);
    if (!session.server?.listening) throw new Error('Original seller stopped before cache attachment.');
    control = await attachReleaseCacheControls(session, { controlFile, routes: message.cacheRoutes });
    const originalClose = session.close.bind(session);
    let closing;
    session.close = () => closing ??= (async () => {
      try { return await originalClose(); } finally { await control?.close(); }
    })();
    if (!session.server.listening) throw new Error('Original seller stopped during cache attachment.');
    const report = JSON.parse(await readFile(join(directory, 'runtime-readiness.json'), 'utf8'));
    process.stdout.write(JSON.stringify({ releaseReady: true, instanceId,
      originalOffersSha256: report.originalOffersSha256,
      originalServiceConfigSha256: report.originalServiceConfigSha256,
      listener: session.url, mode: session.mode, cacheControlAvailable: control !== null }) + '\n');
  } catch {
    await session?.close().catch(() => {}); await control?.close().catch(() => {});
    process.stderr.write('RELEASE_CHILD_START_FAILED\n'); process.exitCode = 1;
  }
});
