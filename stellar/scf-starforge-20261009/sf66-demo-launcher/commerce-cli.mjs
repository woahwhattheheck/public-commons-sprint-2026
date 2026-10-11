#!/usr/bin/env node
// MIT. Foreground merchant and buyer operator console; the original CLI approves.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { initializeCommerce, inspectCommerce, openCommerce, probeCommerceReadiness,
  completeCommerceShutdown, commerceErrorCode } from './commerce.mjs';

const HELP = `Original SCF commerce session (Node 22+, full checkout)

  node commerce-cli.mjs init --plan /private/commerce-plan.json --directory /private/NEW-session
  node commerce-cli.mjs inspect --directory /private/session
  node commerce-cli.mjs probe --directory /private/session
  node commerce-cli.mjs start --directory /private/session
  node commerce-cli.mjs start --directory /private/session --execute INTENT [--one-shot]

The foreground console starts the original merchant and operations listeners.
Commands: status | readiness | review INTENT | signer INTENT | execute INTENT |
          cancel INTENT | recover INTENT | retrieve INTENT | quit
The original SF88/SF81 terminal owns payment approval. Reopening uses the same
original inbox, stable intents, reservations, results and saved resource files.
Without a TTY, start prints readiness and stays running until SIGINT/SIGTERM.
--one-shot prints readiness or runs the explicitly selected intent, then closes.
An upstream session with operationControls prints its private merchant recovery
URL at startup; ordinary status output includes only the read-only operations URL.
`;
const print = value => process.stdout.write(JSON.stringify(value, null, 2) + '\n');
function printExecution(value) {
  print(value);
  if (Number.isInteger(value.exitCode) && value.exitCode !== 0) process.exitCode = value.exitCode;
}
function options(args, allowed) {
  const values = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (!allowed.includes(key) || Object.hasOwn(values, key)) throw new Error(HELP);
    if (key === '--one-shot') { values[key] = true; continue; }
    if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(HELP);
    values[key] = args[++i];
  }
  if (!values['--directory']) throw new Error(HELP);
  return values;
}
function stateView(value) {
  return { schema: value.schema, state: value.state, directory: value.directory,
    seller: value.seller ?? { configuration: value.sellerConfig, port: value.sellerPort,
      availabilityDirectory: value.availabilityDirectory ?? null,
      ...(value.python ? { python: value.python } : {}),
      ...(value.upstreams ? { upstreams: value.upstreams } : {}) },
    facilitator: value.facilitator,
    operations: value.operations ? { url: value.operations.url,
      availabilityUrl: value.operations.availabilityUrl ?? null,
      merchantOperationsUrl: value.operations.merchantOperationsUrl ?? null,
      operationControls: value.operations.operationControls === true,
      sessionId: value.operations.traffic.sessionId,
      routes: value.operations.traffic.routes } : null,
    buyers: value.buyers.map(job => ({ intentId: job.operation.intentId, state: job.state,
      method: job.operation.method, url: job.operation.url, merchant: job.merchant ?? null,
      lastError: job.lastError, outcome: job.outcome, recovery: job.recovery,
      evidencePath: job.evidencePath, responseDestination: job.responseDestination, paidFile: job.paidFile ?? null })),
  };
}

export async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && ['help', '--help'].includes(args[0])) {
    process.stdout.write(HELP); return;
  }
  const [command, ...rest] = args;
  if (command === 'init') {
    const opts = options(rest, ['--plan', '--directory']);
    if (!opts['--plan']) throw new Error(HELP);
    return print(stateView(await initializeCommerce({ planFile: resolve(opts['--plan']),
      directory: resolve(opts['--directory']) })));
  }
  if (command === 'inspect') {
    const opts = options(rest, ['--directory']);
    return print(stateView(await inspectCommerce(resolve(opts['--directory']))));
  }
  if (command === 'probe') {
    const opts = options(rest, ['--directory']);
    const readiness = await probeCommerceReadiness(resolve(opts['--directory']));
    print(readiness);
    if (!readiness.ready) process.exitCode = 2;
    return;
  }
  if (command !== 'start') throw new Error(HELP);
  const opts = options(rest, ['--directory', '--execute', '--one-shot']);
  const session = await openCommerce(resolve(opts['--directory']));
  const stopped = new AbortController();
  let closeResult, closing, reader, interrupted = false;
  const stop = () => closing ??= (async () => {
    stopped.abort(); reader?.close();
    closeResult = await completeCommerceShutdown(session, session.close(), {
      onWaiting: native => print({ mode: 'WAITING_FOR_ACCEPTED_NATIVE_WORK', facilitator: native }),
    });
  })();
  const interrupt = () => { interrupted = true; void stop().catch(() => {}); };
  process.on('SIGINT', interrupt); process.on('SIGTERM', interrupt);
  try {
    print(stateView(await session.status()));
    if (session.operations.operationControlUrl)
      print({merchantOperationControlUrl:session.operations.operationControlUrl});
    if (session.operations.availabilityControlUrl)
      print({availabilityControlUrl:session.operations.availabilityControlUrl});
    if (opts['--execute']) printExecution(await session.execute(opts['--execute']));
    if (opts['--one-shot'] || stopped.signal.aborted) return;
    if (!process.stdin.isTTY) {
      if (!stopped.signal.aborted) await new Promise(done => stopped.signal.addEventListener('abort', done, { once: true }));
      return;
    }
    process.stdout.write('Commands: status, readiness, review ID, signer ID, execute ID, cancel ID, recover ID, retrieve ID, quit\n');
    while (!stopped.signal.aborted) {
      // Release this reader before the original Python approval opens /dev/tty.
      reader = createInterface({ input: process.stdin, output: process.stdout });
      let line;
      try { line = await reader.question('commerce> ', { signal: stopped.signal }); }
      catch (error) { if (stopped.signal.aborted) break; throw error; }
      finally { reader.close(); reader = null; }
      const words = line.trim().split(/\s+/);
      if (words.length === 1 && words[0] === 'quit') break;
      try {
        if (words.length === 1 && words[0] === 'status') print(stateView(await session.status()));
        else if (words.length === 1 && words[0] === 'readiness') print(await session.probeReadiness());
        else if (words.length === 2 && words[0] === 'review') print((await session.review(words[1])).original);
        else if (words.length === 2 && words[0] === 'signer') print((await session.checkSigner(words[1])).original);
        else if (words.length === 2 && words[0] === 'execute') printExecution(await session.execute(words[1]));
        else if (words.length === 2 && words[0] === 'cancel') print(await session.cancel(words[1]));
        else if (words.length === 2 && words[0] === 'recover') print(await session.recover(words[1]));
        else if (words.length === 2 && words[0] === 'retrieve') print(await session.retrieve(words[1]));
        else if (words[0]) process.stdout.write('Use status, readiness, review ID, signer ID, execute ID, cancel ID, recover ID, retrieve ID, or quit.\n');
      } catch (error) { print({ error: commerceErrorCode(error) }); }
    }
  } finally {
    try { await stop(); }
    finally { process.off('SIGINT', interrupt); process.off('SIGTERM', interrupt); }
    print({ state: closeResult?.state ?? 'STOPPED', inboxRetained: true,
      directory: resolve(opts['--directory']), interrupted,
      drained: closeResult?.drained, shutdown: closeResult?.shutdown,
      ...(closeResult?.upstreams ? { upstreams: closeResult.upstreams } : {}),
      ...(closeResult?.nativeCompletion ? { nativeCompletion: closeResult.nativeCompletion } : {}),
      ...(closeResult?.python ? { python: closeResult.python } : {}) });
    if (closeResult?.drained === false) {
      // Shared signer ownership has completed before this legacy forced exit.
      process.exitCode = 2;
      setTimeout(() => process.exit(2), 20);
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write(JSON.stringify({ error: commerceErrorCode(error),
      ...(error.message === HELP ? { usage: HELP } : {}) }) + '\n');
    process.exitCode = 1;
  });
}
