#!/usr/bin/env node
// MIT. Laboratory operator commands use the original MCP, source and retained transfer engines.
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, open, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { labWorkspaceTools } from './catalog/lab-edd-workspaces.mjs';
import { initializeLabWorkspaceMerchant } from './lab-edd-setup.mjs';
import { openLaboratoryWorkspaceClient, uploadLaboratoryInput, downloadLaboratoryFile,
  reopenLaboratoryDownload, receiveLaboratoryReply, downloadLaboratoryReview } from './lab-edd-client.mjs';

export const LABORATORY_AGENT_HELP = `Laboratory EDD operator

  tools [OPERATION]
  init --options PRIVATE_SETUP_JSON
  call OPERATION --url MCP_URL --workspace ALIAS [--input ARGUMENTS_JSON] [--out REPLY_JSON]
  upload --url MCP_URL --workspace ALIAS --path ORIGINAL_FILE --input-id STABLE_ID
         [--name ORIGINAL_NAME] [--content-type MIME] [--sha256 SHA] [--out REPLY_JSON]
  download --url MCP_URL --workspace ALIAS --file FILE_DESCRIPTOR_JSON --out PRIVATE_DIRECTORY
  receive-reply --url MCP_URL --workspace ALIAS --input COMPLETE_REPLY_JSON --out PRIVATE_DIRECTORY
  download-review --url MCP_URL --workspace ALIAS --review-id SAVED_ID --sha256 REVIEW_SHA --out PRIVATE_DIRECTORY
  reopen --directory PRIVATE_DOWNLOAD [--sha256 SHA]
  receive --configuration ORIGINAL_RECEIVING_JSON --directory PRIVATE_OUTPUT

Options:
  --token-env ENV             Original MCP bearer variable (default MCP_ACCESS_TOKEN).
  --timeout-ms INTEGER        Timeout for one original MCP request, at most 1,800,000 ms.
  --chunk-bytes INTEGER       Original transfer chunk size, at most 65,536 bytes.
  --out FILE                 Retain the complete exact command result instead of abbreviating it.

OPERATION is a merchant_lab_* tool or its short name (inspect, preview, review_apply, ...).
Use input JSON for complete source-bound decisions and IDs. Larger table documents use upload +
table_import or documentRefs. A COMPLETE_FILE response points to the entire native response;
receive-reply downloads it through the same original verified chunk transport. prepare/execute
keep their original native task and payment journals; an interrupted payment uses recover.
`;
const json = value => JSON.stringify(value, null, 2) + '\n';
function number(value, maximum, label) {
  if (value === undefined) return undefined;
  if (!/^[1-9][0-9]*$/.test(value) || Number(value) > maximum) throw Error('Use the supported integer for ' + label + '.');
  return Number(value);
}
async function input(path, maximum = 2097152) {
  if (!path) throw Error('Select the complete original input JSON file.');
  const raw = await readFile(resolve(path));
  if (raw.length > maximum) throw Error('The command JSON exceeds its original size allowance; upload the complete table as a file.');
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
}
async function output(path, value) {
  const raw = Buffer.from(json(value));
  if (!path) { process.stdout.write(raw); return; }
  const selected = resolve(path);
  await mkdir(dirname(selected), { recursive: true, mode: 0o700 });
  let handle;
  try { handle = await open(selected, 'wx', 0o600); await handle.writeFile(raw); await handle.sync(); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    if (!(await readFile(selected)).equals(raw)) throw Error('This command output file already retains a different original result.');
  } finally { await handle?.close(); }
  process.stdout.write(json({ path: selected, bytes: raw.length }));
}
export async function main(argv = process.argv.slice(2), { signal } = {}) {
  const parsed = parseArgs({ args: argv, allowPositionals: true, strict: true, options: {
    help: { type: 'boolean' }, options: { type: 'string' }, url: { type: 'string' }, workspace: { type: 'string' },
    input: { type: 'string' }, file: { type: 'string' }, out: { type: 'string' }, path: { type: 'string' },
    'input-id': { type: 'string' }, name: { type: 'string' }, 'content-type': { type: 'string' },
    sha256: { type: 'string' }, 'review-id': { type: 'string' }, directory: { type: 'string' },
    configuration: { type: 'string' }, 'token-env': { type: 'string' },
    'timeout-ms': { type: 'string' }, 'chunk-bytes': { type: 'string' },
  } });
  const { values, positionals } = parsed, [command, operation] = positionals;
  if (!command || values.help || command === 'help') { process.stdout.write(LABORATORY_AGENT_HELP); return { help: true }; }
  if (positionals.length > (command === 'call' || command === 'tools' ? 2 : 1)) throw Error('Use the declared laboratory command arguments.');
  const options = { signal, timeoutMs: number(values['timeout-ms'], 1800000, 'request deadline'),
    chunkSize: number(values['chunk-bytes'], 65536, 'transfer chunk bytes') };
  if (command === 'tools') {
    const tools = labWorkspaceTools((name, description, properties, required, annotations) =>
      ({ name, description, inputSchema: { type: 'object', properties, required, additionalProperties: false }, annotations }));
    const selected = operation ? tools.filter(value => value.name === (operation.startsWith('merchant_lab_') ? operation : 'merchant_lab_' + operation)) : tools;
    if (!selected.length) throw Error('Select a declared laboratory operation.');
    const result = { tools: selected }; await output(values.out, result); return result;
  }
  if (command === 'init') {
    const result = await initializeLabWorkspaceMerchant(await input(values.options));
    await output(values.out, result); return result;
  }
  if (command === 'reopen') {
    const result = await reopenLaboratoryDownload({ directory: values.directory, expectedSha256: values.sha256 });
    await output(values.out, result); return result;
  }
  if (command === 'receive') {
    const { receiveLaboratoryOperator } = await import('./lab-edd-receiving.mjs');
    const result = await receiveLaboratoryOperator({ configuration: values.configuration, directory: values.directory, signal });
    await output(values.out, result); return result;
  }
  const client = await openLaboratoryWorkspaceClient({ url: values.url, workspace: values.workspace,
    tokenEnv: values['token-env'], signal });
  try {
    let result;
    if (command === 'call') {
      if (!operation) throw Error('Choose one complete original laboratory operation.');
      result = await client.call(operation.startsWith('merchant_lab_') ? operation : 'merchant_lab_' + operation,
        values.input ? await input(values.input) : {}, options);
      await output(values.out, result);
    } else if (command === 'upload') {
      result = await uploadLaboratoryInput(client, { path: values.path, inputId: values['input-id'], name: values.name,
        contentType: values['content-type'], expectedSha256: values.sha256 }, options);
      await output(values.out, result);
    } else if (command === 'download') {
      const descriptor = await input(values.file);
      result = await downloadLaboratoryFile(client, { file: descriptor.file ?? descriptor, directory: values.out }, options);
      await output(undefined, result);
    } else if (command === 'receive-reply') {
      const reply = await input(values.input), complete = await receiveLaboratoryReply(client, reply,
        { directory: values.out, signal, timeoutMs: options.timeoutMs });
      result = complete.download ? { status: 'COMPLETE', download: complete.download } : { status: 'INLINE', value: complete.value };
      await output(undefined, result);
    } else if (command === 'download-review') {
      result = await downloadLaboratoryReview(client, { reviewId: values['review-id'],
        expectedReviewSha256: values.sha256, directory: values.out }, options);
      await output(undefined, result);
    } else throw Error('Choose one of the declared laboratory commands; use --help.');
    return result;
  } finally { client.close(); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const controller = new AbortController();
  const stop = () => controller.abort(new Error('Laboratory operator cancelled.'));
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  main(process.argv.slice(2), { signal: controller.signal }).catch(error => {
    process.stderr.write(json({ error: error.code ?? error.name, message: error.message, details: error.details ?? error.detail }));
    process.exitCode = 1;
  }).finally(() => { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); });
}
