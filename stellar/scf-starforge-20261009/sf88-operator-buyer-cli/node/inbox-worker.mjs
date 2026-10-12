#!/usr/bin/env node
// MIT — One selected command in the installed original SF88 inbox.
import { mkdtemp, lstat, realpath, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { absolute, digest, intent, object, need, safeCode, readBytes, readJson,
  writeJson, syncDirectory } from './store.mjs';

const SCHEMA = 'stellar-forge.node-buyer-inbox-command.v1';
const INBOX = 'stellar-forge.sf88.buyer-inbox.v1';
const controller = new AbortController();
let signalExit;
const interrupt = () => { signalExit = 130; controller.abort(); };
const terminate = () => { signalExit = 143; controller.abort(); };
process.once('SIGINT', interrupt);
process.once('SIGTERM', terminate);

async function main([runtimeDirectory, inputFile, resultFile, ...extra]) {
  need(extra.length === 0, 'INBOX_WORKER_ARGUMENTS_INVALID');
  runtimeDirectory = absolute(runtimeDirectory);
  const input = await readJson(absolute(inputFile));
  need(input.schema === SCHEMA && typeof input.command === 'string', 'INBOX_WORKER_INPUT_INVALID');
  const original = name => import(pathToFileURL(join(runtimeDirectory, name)).href);
  let queue, native = null, responseFile = null, error = null;
  try {
    need(!controller.signal.aborted, 'OPERATION_ABORTED_BEFORE_START');
    if (input.command === 'inspect-packet') {
      const { inspectOperationHandoff } = await original('operation-handoff.mjs');
      native = await inspectOperationHandoff({ file:absolute(input.file),
        directory:dirname(absolute(inputFile)), acceptIndex:input.accept });
    } else {
      const root = absolute(input.root);
      const { initializeQueue, openQueue, saveQueueReport } = await original('queue.mjs');
      if (input.command === 'create') {
        // The native queue's metadata has no absolute root binding. Publish its
        // complete, empty original structure rather than a partly initialized name.
        const parent = dirname(root);
        need(await realpath(parent) === parent, 'INBOX_CANONICAL_PARENT_REQUIRED');
        const parentInfo = await lstat(parent);
        need(parentInfo.isDirectory() && (process.platform === 'win32' ||
          (parentInfo.mode & 0o077) === 0 && (!process.getuid || parentInfo.uid === process.getuid())),
        'INBOX_PRIVATE_PARENT_REQUIRED');
        let present = false;
        try { await lstat(root); present = true; } catch (problem) { if (problem.code !== 'ENOENT') throw problem; }
        need(!present, 'INBOX_ALREADY_EXISTS_USE_EXISTING');
        const temporary = await mkdtemp(join(parent, '.inbox-create-'));
        try {
          const staged = join(temporary, 'ready');
          await initializeQueue(staged);
          // A complete native inbox is nonempty, so rename cannot replace one.
          await rename(staged, root);
          await syncDirectory(parent);
        } finally { await rm(temporary, { recursive:true, force:true }); }
        queue = await openQueue(root);
        native = { schema:INBOX, root:queue.root };
      } else {
        queue = await openQueue(root);
        if (input.command === 'open') native = { schema:INBOX, root:queue.root };
        else if (input.command === 'list') native = { schema:INBOX, root:queue.root, jobs:await queue.list() };
        else if (input.command === 'enqueue') {
          const file = absolute(input.configFile);
          if (input.expectedConfigSha256 !== undefined)
            need(digest(await readBytes(file)) === input.expectedConfigSha256, 'OPERATION_INPUT_CHANGED');
          native = await queue.enqueue(file);
          if (input.expectedConfigSha256 !== undefined)
            need(native.sourceConfigSha256 === input.expectedConfigSha256, 'INBOX_SOURCE_CONFIG_CHANGED');
          if (input.expectedBodySha256 !== undefined)
            need((native.bodySha256 ?? digest(Buffer.alloc(0))) === input.expectedBodySha256, 'INBOX_SOURCE_BODY_CHANGED');
          if (input.expectedTicketSha256 !== undefined)
            need((native.operationTicket?.sha256 ?? null) === input.expectedTicketSha256, 'INBOX_SOURCE_TICKET_CHANGED');
        } else if (input.command === 'report') {
          const { renderQueueReport } = await original('queue-report.mjs');
          const { readLostOutputQueueViews } = await original('lost-output.mjs');
          native = await saveQueueReport(absolute(input.destination), renderQueueReport({
            jobs:await readLostOutputQueueViews({root:queue.root,workspace:input.workspaceDirectory,
              signal:controller.signal}), queueRoot:queue.root,
            accountingWorkspace:input.workspaceDirectory,
          }));
        } else {
          const intentId = intent(input.intentId);
          if (['inspect-lost-output','recover-lost-output','read-lost-output','export-lost-output'].includes(input.command)) {
            const originalRecovery = await original('lost-output.mjs');
            const options = {root, intentId, workspace:absolute(input.workspaceDirectory),
              signal:controller.signal, environment:process.env};
            for (const name of ['approvedRequestFile','approvedRequest','expectedRequestSha256',
              'expectedAttemptId','expectedConfigSha256','transaction'])
              if (input[name] !== undefined) options[name] = input[name];
            if (input.command === 'inspect-lost-output') {
              const snapshot = await originalRecovery.inspectLostOutputAttempt(options);
              native = {...await queue.show(intentId), lostOutputAttempt:snapshot};
            } else if (input.command === 'recover-lost-output')
              native = await originalRecovery.recoverLostOutput(options);
            else if (input.command === 'read-lost-output') {
              const recovered = await originalRecovery.readLostOutputRecovery(options);
              native = {...await queue.show(intentId), lostOutputFinalization:recovered};
            } else {
              const exported = await originalRecovery.exportLostOutputProof({...options,output:absolute(input.destination)});
              native = {...await queue.show(intentId), lostOutputProof:exported};
            }
          } else if (input.command === 'show') native = await queue.show(intentId);
          else if (input.command === 'response') {
            native = await queue.show(intentId);
            const file = join(root, 'jobs', native.id, 'execution.json');
            need(digest(await readBytes(file)) === native.configSha256, 'INBOX_CONFIG_CHANGED');
            const config = await original('config.mjs');
            responseFile = config.responseFile(await config.config(file));
          } else if (input.command === 'recover') native = await queue.recover(intentId);
          else if (input.command === 'cancel') native = await queue.cancel(intentId);
          else if (input.command === 'execute') {
            const job = await queue.show(intentId), review = input.review;
            need(object(review) && review.root === root && review.intentId === intentId &&
              review.configSha256 === job.configSha256 && review.bodySha256 === job.bodySha256 &&
              review.ticketSha256 === (job.operationTicket?.sha256 ?? null), 'MATCHING_INBOX_REVIEW_REQUIRED');
            native = await queue.run(intentId, { signal:controller.signal,
              ...(input.workspaceDirectory === undefined ? {} : {workspace:input.workspaceDirectory}) });
          } else if (input.command === 'finalize') {
            const { finalizeQueueIntent } = await original('finalization.mjs');
            native = await finalizeQueueIntent({ root, intentId, workspace:input.workspaceDirectory,
              outbox:input.outboxDirectory, merchantRoute:input.merchantRoute, signal:controller.signal });
            if (!['FINALIZED','IDEMPOTENT_FINALIZED'].includes(native.finalization?.result?.outcome) ||
              native.finalizationView?.status !== 'SAVED') process.exitCode = 2;
          } else need(false, 'INBOX_COMMAND_REQUIRED');
          if (input.command === 'execute' && native.lastError) process.exitCode = 2;
        }
      }
    }
  } catch (problem) {
    error = safeCode(problem?.code, 'INBOX_OPERATION_FAILED');
    // The native attempt may already exist. Return its original current view
    // when readable; never clear a marker or dispatch another intent.
    if (queue && input.intentId) {
      try { native = await queue.show(input.intentId); } catch { /* Keep the original error. */ }
    }
    process.exitCode = signalExit ?? 1;
  }
  await writeJson(absolute(resultFile), { schema:SCHEMA, command:input.command,
    root:input.root ?? null, native, responseFile, error }, { exclusive:true });
  if (signalExit !== undefined) process.exitCode = signalExit;
}

main(process.argv.slice(2)).catch(error => {
  process.stderr.write(JSON.stringify({ error:safeCode(error?.code, 'INBOX_WORKER_FAILED'),
    retry:'NO_AUTOMATIC_RETRY' }) + '\n');
  process.exitCode = signalExit ?? 1;
}).finally(() => { process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', terminate); });
