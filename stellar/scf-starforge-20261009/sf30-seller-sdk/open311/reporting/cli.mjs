#!/usr/bin/env node
// MIT. Installed service reporting commands.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { openWorkspace, receiveWorkspace } from './workspace.mjs';
import { serveReporting } from './server.mjs';
import { fail } from './calendar.mjs';

const HELP = 'open311-reporting <init|state|import|profile|build|review-import|review-apply|export|receive|operation|compare|serve>\n' +
  'All commands select --workspace DIR. Mutations use --file FILE --request-id ID --expected-revision N.\n' +
  'export uses --report ID --kind json|csv|html|review --out FILE; --kind workspace exports everything.\n' +
  'receive --file PACKAGE.json initializes an empty destination. serve uses --host 127.0.0.1 --port 0.\n';
function args(argv) {
  const [command, ...rest] = argv, values = {};
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i];
    if (!key?.startsWith('--') || !rest[i + 1] || rest[i + 1].startsWith('--') || Object.hasOwn(values, key.slice(2)))
      fail('INVALID_ARGUMENT', 'Options require exactly one explicit value: ' + (key ?? ''));
    values[key.slice(2)] = rest[i + 1];
  }
  return { command, values };
}
function required(values, key) { if (!values[key]) fail('MISSING_ARGUMENT', 'Supply --' + key + '.'); return values[key]; }
const revision = value => {
  const number = Number(value);
  if (value === undefined || !/^\d+$/.test(String(value)) || !Number.isSafeInteger(number)) fail('INVALID_REVISION', 'Supply an integer --expected-revision.');
  return number;
};
export async function main(argv = process.argv.slice(2), { output = value => process.stdout.write(typeof value === 'string' ? value : JSON.stringify(value) + '\n') } = {}) {
  const { command, values } = args(argv);
  if (!command || command === 'help' || command === '--help') { output(HELP); return null; }
  const directory = resolve(required(values, 'workspace'));
  if (command === 'serve') {
    const running = await serveReporting({ directory, host: values.host ?? '127.0.0.1', port: values.port ?? 0,
      expectedWorkspaceId: values['expected-workspace-id'], expectedBindingSha256: values['expected-binding-sha256'] });
    output(running.launch);
    const stop = async () => { await running.close(); process.exitCode = 0; };
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    return running;
  }
  if (command === 'receive') {
    const workspace = openWorkspace(directory);
    try {
      const result = workspace.receive(await readFile(required(values, 'file'), 'utf8'),
        { requestId: values['request-id'], expectedRevision: values['expected-revision'] === undefined ? 0 : revision(values['expected-revision']) });
      output(result); return result;
    } finally { workspace.close(); }
  }
  const workspace = openWorkspace(directory, { create: command === 'init' });
  try {
    let result;
    if (command === 'init' || command === 'state') result = workspace.state();
    else if (command === 'operation') result = workspace.operation(required(values, 'request-id'));
    else if (command === 'compare') result = workspace.compare(required(values, 'before'), required(values, 'after'));
    else if (command === 'export') {
      const exported = workspace.exportFile({ kind: required(values, 'kind'), reportId: values.report ?? null,
        ...(values['expected-revision'] !== undefined ? { expectedRevision: revision(values['expected-revision']) } : {}) });
      const filename = resolve(required(values, 'out')); await mkdir(dirname(filename), { recursive: true });
      await writeFile(filename, exported.body, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
      result = { filename, contentType: exported.contentType, bytes: Buffer.byteLength(exported.body) };
    } else {
      const originalText = await readFile(required(values, 'file'), 'utf8');
      const control = { requestId: required(values, 'request-id'), expectedRevision: revision(values['expected-revision']) };
      if (command === 'import') result = workspace.importSource({ ...control, originalText });
      else if (command === 'profile') result = workspace.putProfile({ ...control, profile: JSON.parse(originalText) });
      else if (command === 'build') result = workspace.build({ ...control, definition: JSON.parse(originalText) });
      else if (command === 'review-import') result = workspace.importReview({ ...control, originalText });
      else if (command === 'review-apply') result = workspace.applyReview({ ...control, selection: JSON.parse(originalText) });
      else fail('UNKNOWN_COMMAND', 'Unknown reporting command. Use open311-reporting help.');
    }
    output(result); return result;
  } finally { workspace.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { process.stderr.write(JSON.stringify({ code: error.code ?? 'REPORTING_ERROR', message: error.message, details: error.details ?? null }) + '\n'); process.exitCode = 1; });
}
