#!/usr/bin/env node
// MIT — One selected caller task, original Inbox authority, complete receiving.
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { Buyer } from '../index.mjs';
import { need, absolute, readJson, writeJson } from '../store.mjs';
import { previewInboxTask, createInboxTask, openInboxTask, openInboxTaskPacket,
  compareInboxTasks } from './inbox-task.mjs';

const HELP = [
  'starforge buyer-inbox-task ACTION [options]',
  '',
  'Original Inbox actions require --runtime SF88_DIR --state NODE_STATE --inbox ORIGINAL_INBOX.',
  'rpc-results --commerce ORIGINAL_COMMERCE_SESSION --intent ORIGINAL_INTENT',
  'rpc-read --commerce ORIGINAL_COMMERCE_SESSION --intent ORIGINAL_INTENT --read-id ORIGINAL_READ_ID --response-sha256 ORIGINAL_SHA [--output NEW_FILE]',
  'preview --spec TASK_SPEC.json [--output NEW_REVIEW.json]',
  'create --spec TASK_SPEC.json --directory TASK_DIR --preview-sha256 REVIEW_SHA',
  'inspect --directory TASK_DIR',
  'review --directory TASK_DIR --intent ORIGINAL_INTENT [--output NEW_REVIEW.json]',
  'execute --directory TASK_DIR --intent ORIGINAL_INTENT --review-file REVIEW.json [--workspace ORIGINAL_WORKSPACE]',
  'recover --directory TASK_DIR --intent ORIGINAL_INTENT',
  'read --directory TASK_DIR --intent ORIGINAL_INTENT [--format file|json|text|csv|ndjson|sse]',
  'receive --directory TASK_DIR --output NEW_PACKET_DIR',
  '',
  'Offline receiving actions:',
  'packet-inspect --packet PACKET_DIR [--task-sha256 EXPECTED_TASK]',
  'packet-read --packet PACKET_DIR --intent ORIGINAL_INTENT [--format file|json|text|csv]',
  'compare --previous PREVIOUS_TASK.json --next NEXT_TASK.json',
  '',
  'Read options: --read-limit BYTES (default 8388608), --csv-headers, --allow-partial.',
  'Preview and create attach existing requests. Execute selects one original intent and native review.',
  'Receive copies every complete saved response; repeat the same output path to continue.',
  'packet-inspect and packet-read use the received files independently of the original runtime.',
].join('\n');

function integer(value, fallback) {
  if (value === undefined) return fallback;
  need(/^(0|[1-9][0-9]*)$/.test(value), 'TASK_ARGUMENT_INVALID');
  const parsed = Number(value);
  need(Number.isSafeInteger(parsed), 'TASK_ARGUMENT_INVALID');
  return parsed;
}
const json = value => process.stdout.write(JSON.stringify(value, null, 2) + '\n');
function output(chunk) {
  return new Promise((resolve, reject) => process.stdout.write(chunk, error => error ? reject(error) : resolve()));
}
async function readResponse(response, values, signal) {
  need(response, 'TASK_RESULT_UNAVAILABLE');
  const format = values.format ?? 'file';
  const options = { signal, limit: integer(values['read-limit'], 8388608) };
  if (format === 'file') return json(await response.verify({ signal }));
  if (format === 'json') return json(await response.json(options));
  if (format === 'text') {
    const bytes = await response.bytes(options);
    return output(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  }
  let records;
  if (format === 'csv') records = response.csvRows({ headers: values['csv-headers'] ?? false, signal });
  else if (format === 'ndjson' && typeof response.ndjson === 'function')
    records = response.ndjson({ allowPartial: values['allow-partial'] ?? false, signal });
  else if (format === 'sse' && typeof response.events === 'function')
    records = response.events({ allowPartial: values['allow-partial'] ?? false, signal });
  else need(false, 'TASK_READ_FORMAT_INVALID');
  for await (const record of records) await output(JSON.stringify(record) + '\n');
}

export async function main(args = process.argv.slice(2)) {
  const stringOptions = ['runtime', 'state', 'inbox', 'spec', 'output', 'directory', 'preview-sha256',
    'intent', 'review-file', 'workspace', 'format', 'read-limit', 'packet', 'task-sha256', 'previous', 'next',
    'commerce', 'read-id', 'response-sha256'];
  const options = Object.fromEntries(stringOptions.map(key => [key, { type: 'string' }]));
  for (const key of ['help', 'csv-headers', 'allow-partial']) options[key] = { type: 'boolean' };
  const { values, positionals } = parseArgs({ args, options, strict: true, allowPositionals: true });
  if (values.help) { process.stdout.write(HELP + '\n'); return 0; }
  need(positionals.length === 1, 'TASK_ACTION_REQUIRED');
  const action = positionals[0], controller = new AbortController();
  const abort = () => controller.abort();
  process.once('SIGINT', abort); process.once('SIGTERM', abort);
  const signal = controller.signal;
  try {
    if (action === 'compare') {
      const previous = await readJson(absolute(values.previous), 128 * 1024 * 1024);
      const next = await readJson(absolute(values.next), 128 * 1024 * 1024);
      json(compareInboxTasks(previous, next)); return 0;
    }
    if (action === 'packet-inspect' || action === 'packet-read') {
      const packet = await openInboxTaskPacket({ directory: absolute(values.packet),
        expectedTaskSha256: values['task-sha256'], signal });
      if (action === 'packet-inspect') json(packet);
      else await readResponse(packet.response(values.intent), values, signal);
      return 0;
    }
    need(['rpc-results', 'rpc-read', 'preview', 'create', 'inspect', 'review', 'execute', 'recover', 'read', 'receive'].includes(action),
      'TASK_ACTION_INVALID');
    const buyer = new Buyer({ runtimeDirectory: absolute(values.runtime), stateDirectory: absolute(values.state) });
    const inbox = buyer.inbox(absolute(values.inbox));
    if (action === 'rpc-results') {
      json(await inbox.rpcResponses(values.intent, { commerceDirectory:absolute(values.commerce), signal }));
      return 0;
    }
    if (action === 'rpc-read') {
      const response = await inbox.rpcResponse(values.intent, {
        commerceDirectory:absolute(values.commerce), readId:values['read-id'],
        expectedResponseSha256:values['response-sha256'], signal,
      });
      need(response, 'TASK_RESULT_UNAVAILABLE');
      if (values.output) {
        const destination = await response.saveAs(absolute(values.output), { signal });
        json({ path:destination, ...await response.verify({ signal }), recovery:response.recovery });
      } else await readResponse(response, values, signal);
      return 0;
    }
    if (action === 'preview' || action === 'create') {
      const spec = await readJson(absolute(values.spec), 4 * 1024 * 1024);
      const input = { inbox, task: spec.task, selections: spec.selections, predecessor: spec.predecessor, signal };
      if (action === 'preview') {
        const preview = await previewInboxTask(input);
        if (values.output) await writeJson(absolute(values.output), preview, { exclusive: true });
        json(preview); return 0;
      }
      const saved = await createInboxTask({ ...input, directory: absolute(values.directory),
        expectedPreviewSha256: values['preview-sha256'] });
      json({ directory: saved.directory, ...saved.record }); return 0;
    }
    const task = await openInboxTask({ inbox, directory: absolute(values.directory),
      expectedTaskSha256: values['task-sha256'] });
    if (action === 'inspect') json(await task.inspect({ signal }));
    else if (action === 'review') {
      const review = await task.review(values.intent, { signal });
      if (values.output) await writeJson(absolute(values.output), review, { exclusive: true });
      json(review);
    } else if (action === 'execute') {
      const review = await readJson(absolute(values['review-file']), 16 * 1024 * 1024);
      const result = await task.execute(values.intent, { review, signal,
        ...(values.workspace === undefined ? {} : { workspaceDirectory: absolute(values.workspace) }) });
      json(result);
      if (result.result && result.result.process.exitCode !== 0) return 2;
    } else if (action === 'recover') json(await task.recover(values.intent, { signal }));
    else if (action === 'read') await readResponse(await task.response(values.intent, { signal }), values, signal);
    else if (action === 'receive') json(await task.receive({ directory: absolute(values.output), signal }));
    return signal.aborted ? 130 : 0;
  } catch (error) {
    if (signal.aborted) return 130;
    throw error;
  } finally {
    process.removeListener('SIGINT', abort); process.removeListener('SIGTERM', abort);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.exitCode = await main(); }
  catch (error) {
    process.stderr.write(JSON.stringify({ error: error.code ?? 'TASK_COMMAND_FAILED',
      ...(error.commandDirectory ? { commandDirectory: error.commandDirectory } : {}) }) + '\n');
    process.exitCode = ['TASK_RESULTS_PENDING', 'TASK_RESULT_UNAVAILABLE'].includes(error.code) ? 2 : 1;
  }
}
