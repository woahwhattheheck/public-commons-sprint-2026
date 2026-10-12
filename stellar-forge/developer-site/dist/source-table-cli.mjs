#!/usr/bin/env node
// MIT. Native operator entry for the same source-table workspace used in the browser.
import { readFile, writeFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { startSetupServer } from '../serve.mjs';
import {
  LIMITS, createProject, addDocument, addEdition, resetMapping, replaceMapping, freezeReview,
  importProject, inspectSource, decodeSource, selectedEdition, compareReviews, comparisonCsv,
  projectSummary, createTableArchive, SourceTableError,
} from './source-table-workspace.mjs';
import { importWorkspaceDraft } from './onboarding.mjs';

const HELP = 'Stellar Forge source tables\n\n' +
  'serve [--port PORT]\n' +
  'inspect --source FILE [--delimiter comma|tab|semicolon|pipe] [--no-header] [--skip-empty]\n' +
  'init --source FILE --out NEW_PROJECT.json [--name NAME] [--merchant STARTER.json] [--resource ID] [dialect options]\n' +
  'add --project PROJECT.json --source FILE --out NEW_PROJECT.json [--resource ID] [dialect options]\n' +
  'edition --project PROJECT.json --document ID --source FILE --out NEW_PROJECT.json\n' +
  'mapping --project PROJECT.json --document ID [--out NEW_MAPPING.json]\n' +
  'map --project PROJECT.json --document ID --mapping MAPPING.json --out NEW_PROJECT.json\n' +
  'reset-mapping --project PROJECT.json --document ID --out NEW_PROJECT.json [dialect options]\n' +
  'review --project PROJECT.json --document ID --out NEW_PROJECT.json\n' +
  'compare --project PROJECT.json --document ID --baseline REVIEW_ID [--current REVIEW_ID] [--csv] [--out NEW_COMPARISON]\n' +
  'show --project PROJECT.json\n' +
  'export --project PROJECT.json --out NEW_WORKSPACE.zip\n\n' +
  'All saves create a new file. Dialect and mapping decisions, original sources, previous reviews and original merchant payment choices are retained in the project.\n';

function argumentsFor(args) {
  const options = {};
  const flags = new Set(['no-header', 'skip-empty', 'csv', 'help']);
  for (let i = 0; i < args.length; i++) {
    const name = args[i];
    if (!name.startsWith('--') || name.length < 3) throw new Error('Expected an option beginning with --.');
    const key = name.slice(2);
    if (Object.prototype.hasOwnProperty.call(options, key)) throw new Error('Duplicate option --' + key + '.');
    if (flags.has(key)) options[key] = true;
    else { if (i + 1 >= args.length || args[i + 1].startsWith('--')) throw new Error('Provide a value for ' + name + '.'); options[key] = args[++i]; }
  }
  return options;
}
function required(options, name) { if (!options[name]) throw new Error('Provide --' + name + '.'); return options[name]; }
async function readText(path, limit) {
  const details = await stat(path);
  if (!details.isFile() || details.size > limit) throw new Error('Choose a regular file within the documented size limit: ' + path);
  return decodeSource(await readFile(path));
}
async function readProject(path) {
  const details = await stat(path);
  if (!details.isFile() || details.size > LIMITS.projectBytes) throw new Error('The project must be a regular file at most 128 MiB.');
  const data = await readFile(path);
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(data); } catch { throw new Error('The project must be valid UTF-8 JSON.'); }
  return importProject(text);
}
async function save(path, value, protectedPaths = []) {
  if (protectedPaths.some(p => resolve(p) === resolve(path))) throw new Error('Choose a new output path; the original input remains in place.');
  await writeFile(path, value, { flag: 'wx', mode: 0o600 });
  return { path: resolve(path), bytes: typeof value === 'string' ? Buffer.byteLength(value) : value.length };
}
const json = value => JSON.stringify(value, null, 2) + '\n';
const dialect = o => ({ delimiter: o.delimiter, header: !o['no-header'], skipEmptyRecords: Boolean(o['skip-empty']) });
const source = async o => {
  const file = required(o, 'source');
  return { filename: file.replace(/\\/g, '/').split('/').pop(), sourceText: await readText(file, LIMITS.sourceBytes) };
};

export async function runSourceTableCli(args, io = { stdout: process.stdout, stderr: process.stderr }) {
  const command = args[0] || 'help';
  if (command === 'help' || command === '--help') { io.stdout.write(HELP); return 0; }
  const o = argumentsFor(args.slice(1));
  if (o.help) { io.stdout.write(HELP); return 0; }
  const allowed = {
    serve: ['port'],
    inspect: ['source', 'delimiter', 'no-header', 'skip-empty'],
    init: ['source', 'out', 'name', 'merchant', 'resource', 'delimiter', 'no-header', 'skip-empty'],
    add: ['project', 'source', 'out', 'resource', 'delimiter', 'no-header', 'skip-empty'],
    edition: ['project', 'document', 'source', 'out'],
    mapping: ['project', 'document', 'out'],
    map: ['project', 'document', 'mapping', 'out'],
    'reset-mapping': ['project', 'document', 'out', 'delimiter', 'no-header', 'skip-empty'],
    review: ['project', 'document', 'out'],
    compare: ['project', 'document', 'baseline', 'current', 'csv', 'out'],
    show: ['project'],
    export: ['project', 'out'],
  };
  if (!allowed[command]) throw new Error('Unknown command ' + command + '. Use help.');
  for (const key of Object.keys(o)) if (!allowed[command].includes(key)) throw new Error('Unknown option --' + key + ' for ' + command + '.');
  if (command === 'serve') {
    const listener = await startSetupServer({ port: o.port ?? 8787, entry: '/source-tables.html' });
    const close = () => listener.stop().catch(error => { io.stderr.write(json({ error: error.message })); process.exitCode = 1; });
    process.once('SIGINT', close); process.once('SIGTERM', close);
    listener.server.once('close', () => { process.off('SIGINT', close); process.off('SIGTERM', close); });
    io.stdout.write(json({ schema: 'stellar-forge.source-table-listener.v1', url: listener.url, port: listener.port, assets: listener.assets }));
    return 0;
  }
  if (command === 'inspect') {
    const input = await source(o);
    io.stdout.write(json({ filename: input.filename, ...inspectSource(input.sourceText, dialect(o)) })); return 0;
  }
  let project;
  if (command === 'init') {
    const starter = o.merchant ? importWorkspaceDraft(await readText(o.merchant, LIMITS.sourceBytes)) : undefined;
    project = createProject({ name: o.name || 'Source tables', starter });
  } else project = await readProject(required(o, 'project'));
  let result;
  if (command === 'init' || command === 'add') {
    result = await addDocument(project, { ...await source(o), ...dialect(o), resourceId: o.resource }); project = result.project;
  } else if (command === 'edition') {
    result = await addEdition(project, required(o, 'document'), await source(o)); project = result.project;
  } else if (command === 'map') {
    let mapping; try { mapping = JSON.parse(await readText(required(o, 'mapping'), LIMITS.sourceBytes)); } catch (error) { throw new Error('Cannot read the complete mapping: ' + error.message); }
    project = replaceMapping(project, required(o, 'document'), mapping);
  } else if (command === 'reset-mapping') {
    project = resetMapping(project, required(o, 'document'), dialect(o));
  } else if (command === 'review') {
    result = await freezeReview(project, required(o, 'document')); project = result.project;
  } else if (command === 'show') {
    io.stdout.write(json(projectSummary(project))); return 0;
  } else if (command === 'mapping' || command === 'compare') {
    const doc = project.documents.find(d => d.id === required(o, 'document'));
    if (!doc) throw new Error('The selected document is absent.');
    let output;
    if (command === 'mapping') output = json(doc.mapping);
    else { const comparison = compareReviews(doc, required(o, 'baseline'), o.current || doc.selectedReviewId); output = o.csv ? comparisonCsv(comparison) : json(comparison); }
    if (o.out) io.stdout.write(json(await save(o.out, output, [o.project])));
    else io.stdout.write(output);
    return 0;
  } else if (command === 'export') {
    const archive = await createTableArchive(project), receipt = await save(required(o, 'out'), archive.bytes, [o.project]);
    io.stdout.write(json({ ...receipt, summary: archive.workspace.summary })); return 0;
  }
  const receipt = await save(required(o, 'out'), json(project), [o.project, o.source, o.mapping, o.merchant].filter(Boolean));
  io.stdout.write(json({ ...receipt, ...(result ? { documentId: result.documentId, editionId: result.editionId, reviewId: result.review?.id, reused: result.reused } : {}), project: projectSummary(project) }));
  return 0;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runSourceTableCli(process.argv.slice(2)).then(code => { process.exitCode = code; }).catch(error => {
    process.stderr.write(json({ error: error.message, code: error.code || 'SOURCE_TABLE_CLI', ...(error instanceof SourceTableError ? { issues: error.issues, issueCount: error.issueCount, line: error.line, record: error.record } : {}) }));
    process.exitCode = 1;
  });
}
