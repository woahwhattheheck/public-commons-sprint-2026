#!/usr/bin/env node
// MIT. One private service, original comparison workspace and retained IRIS desk.
import { readFile, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openReconciliationService } from '../../service/service.mjs';
import { startConversionWorkspace } from '../../scap-workspace/server.mjs';
import { openIrisWorkbench } from './workbench.mjs';
import { createIrisExtension } from './extension.mjs';

const HELP = `IRIS filing workbench — Node.js 22+, Python 3, Linux flock

node revenue/erp-conversion-assurance/profiles/ers-iris-2026/cli.mjs COMMAND \
  --directory /private/retained-service [OPTIONS]

serve                 --port 8470
list                  [--after ID] [--limit 25] [--family FILING]
show                  --filing FILING
intake                --filing FILING --input filing.xml
                      [--family EXISTING_FILING]
                      [--parent-filing FILING --parent-decision DECISION]
                      [--prepared-record-map child-record-map.json]
                      [--validation configured|structure]
project               --filing FILING --revision N --projection ID --mapping map.json
response              --filing FILING --revision N --input response.xml [--select true]
select-response       --filing FILING --revision N --response RESPONSE
failure               --filing FILING --revision N --input error.xml
                      --http-status 400 --operation intake|acknowledgment
evidence              --filing FILING --revision N --evidence ID --input original-file
plan                  --filing FILING --revision N --action ACTION
                      [--selection selection.json] [--submission-ids ids.json]
                      [--failure FAILURE] [--reason pre-receipt|xml-schema]
                      [--evidence ID]
binding               --filing FILING --projection ID
rebuild-lineage        --filing FILING --revision N
link-comparison       --filing FILING --revision N --projection ID
                      --job JOB --report-sha256 SHA256
download              --filing FILING --kind xml|projection|mapping|response|decision
                      [--id SELECTOR] --output NEW_FILE
export                --filing FILING --destination NEW_PRIVATE_DIRECTORY

Actions: recover-receipt, resend, replace, refile-original, correct, wrong-form,
legacy-correction. Refile-original uses a new filing date.
Selection JSON is [{"submissionId":"...","recordId":"..."}]; submission IDs
JSON is ["..."] for an explicitly selected replacement scope.

Optional trusted runtime settings:
  --python EXECUTABLE          --xsd /private/schema/entry.xsd
  --schema-root /private/schema
  --max-artifact-bytes NUMBER  --native-timeout-ms NUMBER
Original service limits, supplied consistently when reopening:
  --max-input-bytes NUMBER     --max-report-bytes NUMBER
  --timeout-ms NUMBER          --max-heap-mib NUMBER

Mutations require the revision returned by show. A conflict returns the current
revision and stops; inspect the current response before submitting again.
The browser URL carries a private capability in its fragment. Native filing and
response artifacts stay inside this service directory.\n`;
const FLAGS = {
  '--directory': 'directory', '--port': 'port', '--python': 'python', '--xsd': 'xsd', '--schema-root': 'schemaRoot',
  '--max-artifact-bytes': 'maxArtifactBytes', '--native-timeout-ms': 'nativeTimeoutMs',
  '--max-input-bytes': 'maxInputBytes', '--max-report-bytes': 'maxReportBytes', '--timeout-ms': 'timeoutMs', '--max-heap-mib': 'maxHeapMiB',
  '--filing': 'filingId', '--family': 'familyId', '--revision': 'expectedRevision', '--input': 'input', '--projection': 'projectionId',
  '--mapping': 'mapping', '--response': 'responseId', '--select': 'select', '--http-status': 'httpStatus', '--operation': 'operation',
  '--evidence': 'evidenceId', '--action': 'action', '--selection': 'selectionPath', '--submission-ids': 'submissionIdsPath',
  '--failure': 'failureId', '--reason': 'reason', '--job': 'jobId', '--report-sha256': 'reportSha256', '--destination': 'destination',
  '--kind': 'kind', '--id': 'selector', '--output': 'output', '--parent-filing': 'parentFiling', '--parent-decision': 'parentDecision',
  '--validation': 'validation', '--after': 'after', '--limit': 'limit',
  '--prepared-record-map': 'preparedRecordMapPath',
};
const NUMBERS = new Set(['port', 'maxArtifactBytes', 'nativeTimeoutMs', 'maxInputBytes', 'maxReportBytes', 'timeoutMs', 'maxHeapMiB', 'expectedRevision', 'httpStatus', 'limit']);
const PATHS = new Set(['directory', 'xsd', 'schemaRoot', 'input', 'mapping', 'selectionPath', 'submissionIdsPath', 'preparedRecordMapPath', 'destination', 'output']);
const REQUIRED = {
  serve: [], list: [], show: ['filingId'], intake: ['filingId', 'input'], project: ['filingId', 'expectedRevision', 'projectionId', 'mapping'],
  response: ['filingId', 'expectedRevision', 'input'], 'select-response': ['filingId', 'expectedRevision', 'responseId'],
  failure: ['filingId', 'expectedRevision', 'input', 'httpStatus', 'operation'], evidence: ['filingId', 'expectedRevision', 'evidenceId', 'input'],
  plan: ['filingId', 'expectedRevision', 'action'], binding: ['filingId', 'projectionId'],
  'rebuild-lineage': ['filingId', 'expectedRevision'],
  'link-comparison': ['filingId', 'expectedRevision', 'projectionId', 'jobId', 'reportSha256'],
  download: ['filingId', 'kind', 'output'], export: ['filingId', 'destination'],
};
const parse = args => {
  const [command, ...rest] = args, options = {};
  if (!Object.hasOwn(REQUIRED, command)) throw new Error('Use a supported command; --help lists the complete workflow.');
  for (let index = 0; index < rest.length; index += 2) {
    const key = FLAGS[rest[index]], value = rest[index + 1];
    if (!key || value === undefined || value.startsWith('--') || Object.hasOwn(options, key)) throw new Error('An option is missing, repeated or unsupported.');
    if (NUMBERS.has(key)) { if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error('Use a nonnegative integer for numeric options.'); options[key] = Number(value); }
    else if (key === 'select') { if (!['true', 'false'].includes(value)) throw new Error('--select accepts true or false.'); options[key] = value === 'true'; }
    else options[key] = PATHS.has(key) ? resolve(value) : value;
  }
  for (const key of ['directory', ...REQUIRED[command]]) if (options[key] === undefined) throw new Error(`The command requires ${Object.keys(FLAGS).find(flag => FLAGS[flag] === key)}.`);
  if (Boolean(options.parentFiling) !== Boolean(options.parentDecision)) throw new Error('Provide both --parent-filing and --parent-decision.');
  return { command, options };
};
const picked = (options, names) => Object.fromEntries(names.filter(name => options[name] !== undefined).map(name => [name, options[name]]));
async function readSelection(path) { const bytes = await readFile(path); if (bytes.length > 1024 * 1024) throw new Error('Selection JSON exceeds 1 MiB.'); const value = JSON.parse(bytes); if (!Array.isArray(value)) throw new Error('Selection JSON must be an array.'); return value; }

export async function startIrisWorkspace(options = {}) {
  const service = options.service ?? await openReconciliationService(picked(options, ['directory', 'maxInputBytes', 'maxReportBytes', 'timeoutMs', 'maxHeapMiB']));
  const workbench = await openIrisWorkbench({ ...picked(options, ['directory', 'python', 'xsd', 'schemaRoot', 'maxArtifactBytes', 'nativeTimeoutMs']), service });
  try {
    const profile = JSON.parse(await readFile(new URL('profile.json', import.meta.url), 'utf8'));
    const session = await startConversionWorkspace({ directory: options.directory, port: options.port ?? 8470, profile, service, extension: createIrisExtension(workbench) });
    let closing;
    const close = () => closing ??= (async () => { try { await session.close(); } finally { await workbench.close(); } })();
    return { ...session, service, workbench, close };
  } catch (error) { await workbench.close(); throw error; }
}

export async function main(args = process.argv.slice(2), { write = text => process.stdout.write(text) } = {}) {
  if (!args.length || args.includes('--help')) { write(HELP); return null; }
  const { command, options } = parse(args);
  if (command === 'serve') {
    const session = await startIrisWorkspace(options);
    const stop = () => session.close().catch(() => { process.exitCode = 1; });
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    write(JSON.stringify({ application: 'iris-filing-workbench', directory: options.directory, workspace: session.url,
      profile: session.model.profile.id, filingConfiguration: session.workbench.configuration, comparisonConfiguration: session.model.configuration }) + '\n');
    return { ...session, close: async () => { process.off('SIGINT', stop); process.off('SIGTERM', stop); await session.close(); } };
  }
  const service = await openReconciliationService(picked(options, ['directory', 'maxInputBytes', 'maxReportBytes', 'timeoutMs', 'maxHeapMiB']));
  const workbench = await openIrisWorkbench({ ...picked(options, ['directory', 'python', 'xsd', 'schemaRoot', 'maxArtifactBytes', 'nativeTimeoutMs']), service });
  try {
    let result;
    if (command === 'list') result = await workbench.listFilings(picked(options, ['limit', 'after', 'familyId']));
    if (command === 'show') result = await workbench.getFiling(options.filingId);
    if (command === 'intake') result = await workbench.intake({ ...options, ...(options.parentFiling ? { parent: { filingId: options.parentFiling, decisionId: options.parentDecision } } : {}),
      ...(options.preparedRecordMapPath ? { preparedRecordMap: await readSelection(options.preparedRecordMapPath) } : {}) });
    if (command === 'project') result = await workbench.project(options);
    if (command === 'response') result = await workbench.importResponse(options);
    if (command === 'select-response') result = await workbench.selectResponse(options);
    if (command === 'failure') result = await workbench.importFailure(options);
    if (command === 'evidence') result = await workbench.retainEvidence(options);
    if (command === 'plan') result = await workbench.plan({ ...options,
      ...(options.selectionPath ? { selection: await readSelection(options.selectionPath) } : {}),
      ...(options.submissionIdsPath ? { submissionIds: await readSelection(options.submissionIdsPath) } : {}) });
    if (command === 'binding') result = await workbench.binding(options);
    if (command === 'rebuild-lineage') result = await workbench.rebuildLineage(options);
    if (command === 'link-comparison') result = await workbench.linkComparison(options);
    if (command === 'download') {
      const artifact = await workbench.download(options.filingId, options.kind, options.selector);
      const f = await open(options.output, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try { await f.writeFile(artifact.bytes); await f.sync(); } finally { await f.close(); }
      result = { output: options.output, sha256: artifact.sha256, bytes: artifact.bytes.length };
    }
    if (command === 'export') result = await workbench.exportHandoff(options);
    write(JSON.stringify(result) + '\n'); return result;
  } finally { await workbench.close(); }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  main().catch(error => {
    const code = typeof error.code === 'string' && /^[A-Z][A-Z0-9_]+$/.test(error.code) ? error.code : 'IRIS_COMMAND_FAILED';
    process.stderr.write(JSON.stringify({ error: code, message: error.name === 'IrisWorkbenchError' || code === 'IRIS_COMMAND_FAILED'
      ? error.message : 'The command could not complete. Reopen its original retained inputs.', ...(error.details ? { details: error.details } : {}) }) + '\n');
    process.exitCode = code === 'IRIS_REVISION_CONFLICT' ? 3 : 1;
  });
