#!/usr/bin/env node
// MIT. Native operator entry for the same source-table workspace used in the browser.
import { readFile, writeFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { startSetupServer } from '../serve.mjs';
import {
  LIMITS, createProject, addDocument, addEdition, addDocumentTable, resetMapping, replaceMapping, freezeReview,
  importProject, inspectSource, decodeSource, selectedEdition, compareReviews, comparisonCsv,
  projectSummary, createTableArchive, SourceTableError, recordCorrection, selectedCorrections, sourceRecords, correctionsCsv,
} from './source-table-workspace.mjs';
import { importWorkspaceDraft } from './onboarding.mjs';
import { createDocumentIntake, createDocumentIntakePacket, receiveDocumentIntakePacket } from './source-table-intake.mjs';
import { createDocumentTableSource, validateDocumentTableSource, inspectDocumentTables, projectDocumentTable } from './source-document-tables.mjs';

const HELP = 'Stellar Forge source tables\n\n' +
  'serve [--port PORT]\n' +
  'intake-export --project PROJECT.json --out NEW_PREPARATIONS.json\n' +
  'intake-open --project PROJECT.json --source PREPARATIONS.json --out NEW_PROJECT.json\n' +
  'inspect --source FILE [--delimiter comma|tab|semicolon|pipe] [--no-header] [--skip-empty]\n' +
  'document-inspect --source EXTRACTED_FILE_OR_SOURCE.json [--metadata JSON_FILE] [--out NEW_SOURCE.json]\n' +
  'document-init --source DOCUMENT_SOURCE.json --selection SELECTION.json [--table N] --out NEW_PROJECT.json [--name NAME] [--merchant STARTER.json] [--resource ID] [--filename CSV_NAME]\n' +
  'document-add --project PROJECT.json --source DOCUMENT_SOURCE.json --selection SELECTION.json [--table N] --out NEW_PROJECT.json [--resource ID] [--filename CSV_NAME]\n' +
  'document-edition --project PROJECT.json --document ID --source DOCUMENT_SOURCE.json --selection SELECTION.json [--table N] --out NEW_PROJECT.json [--filename CSV_NAME]\n' +
  'init --source FILE --out NEW_PROJECT.json [--name NAME] [--merchant STARTER.json] [--resource ID] [dialect options]\n' +
  'add --project PROJECT.json --source FILE --out NEW_PROJECT.json [--resource ID] [dialect options]\n' +
  'edition --project PROJECT.json --document ID --source FILE --out NEW_PROJECT.json\n' +
  'mapping --project PROJECT.json --document ID [--out NEW_MAPPING.json]\n' +
  'map --project PROJECT.json --document ID --mapping MAPPING.json --out NEW_PROJECT.json\n' +
  'reset-mapping --project PROJECT.json --document ID --out NEW_PROJECT.json [dialect options]\n' +
  'review --project PROJECT.json --document ID --out NEW_PROJECT.json\n' +
  'compare --project PROJECT.json --document ID --baseline REVIEW_ID [--current REVIEW_ID] [--csv] [--out NEW_COMPARISON]\n' +
  'records --project PROJECT.json --document ID [--offset N] [--limit N]\n' +
  'corrections --project PROJECT.json --document ID [--csv] [--out NEW_HISTORY]\n' +
  'correct --project PROJECT.json --document ID --decision DECISION.json --out NEW_PROJECT.json\n' +
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
  const data=await readFile(path);
  if(limit<=LIMITS.sourceBytes)return decodeSource(data);
  try{return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(data);}catch{throw new Error('Choose a complete valid UTF-8 document preparation file.');}
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


async function documentSource(options, rawAllowed = false) {
  const filename = required(options, 'source'), raw = await readText(filename, LIMITS.projectBytes);
  let saved;
  try { saved = JSON.parse(raw.replace(/^\uFEFF/, '')); } catch {}
  if (saved?.schema === 'stellar-forge.document-table-source.v1') {
    if (options.metadata) throw new Error('The retained source already contains its original metadata.');
    return validateDocumentTableSource(saved);
  }
  if (!rawAllowed) throw new Error('Choose the retained document source JSON produced by document-inspect --out.');
  let metadata = {};
  if (options.metadata) {
    try { metadata = JSON.parse((await readText(options.metadata, LIMITS.sourceBytes)).replace(/^\uFEFF/, '')); }
    catch (error) { throw new Error('Cannot read the document metadata: ' + error.message); }
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw new Error('Document metadata must be an object.');
    for (const key of Object.keys(metadata)) if (!['sourceUrl', 'document', 'extraction', 'tableLocations'].includes(key))
      throw new Error('Unknown document metadata field ' + key + '.');
  }
  return createDocumentTableSource({ ...metadata, filename: filename.replace(/\\/g, '/').split('/').pop(), sourceText: raw });
}
async function documentSelection(options) {
  const value = JSON.parse((await readText(required(options, 'selection'), LIMITS.sourceBytes)).replace(/^\uFEFF/, ''));
  if (Array.isArray(value)) {
    if (!options.table || !/^[1-9]\d*$/.test(options.table)) throw new Error('Use --table N to choose one table from a selections array.');
    const matches = value.filter(item => item.tableIndex === Number(options.table));
    if (matches.length !== 1) throw new Error('The selection file must contain exactly one selection for table ' + options.table + '.');
    return matches[0];
  }
  if (options.table && (!/^[1-9]\d*$/.test(options.table) || value?.tableIndex !== Number(options.table)))
    throw new Error('The selected table number does not match the selection file.');
  return value;
}

export async function runSourceTableCli(args, io = { stdout: process.stdout, stderr: process.stderr }) {
  const command = args[0] || 'help';
  if (command === 'help' || command === '--help') { io.stdout.write(HELP); return 0; }
  const o = argumentsFor(args.slice(1));
  if (o.help) { io.stdout.write(HELP); return 0; }
  const allowed = {
    serve: ['port'],
    'intake-export': ['project', 'out'],
    'intake-open': ['project', 'source', 'out'],
    inspect: ['source', 'delimiter', 'no-header', 'skip-empty'],
    'document-inspect': ['source', 'metadata', 'out'],
    'document-init': ['source', 'selection', 'table', 'out', 'name', 'merchant', 'resource', 'filename'],
    'document-add': ['project', 'source', 'selection', 'table', 'out', 'resource', 'filename'],
    'document-edition': ['project', 'document', 'source', 'selection', 'table', 'out', 'filename'],
    init: ['source', 'out', 'name', 'merchant', 'resource', 'delimiter', 'no-header', 'skip-empty'],
    add: ['project', 'source', 'out', 'resource', 'delimiter', 'no-header', 'skip-empty'],
    edition: ['project', 'document', 'source', 'out'],
    mapping: ['project', 'document', 'out'],
    map: ['project', 'document', 'mapping', 'out'],
    'reset-mapping': ['project', 'document', 'out', 'delimiter', 'no-header', 'skip-empty'],
    review: ['project', 'document', 'out'],
    compare: ['project', 'document', 'baseline', 'current', 'csv', 'out'],
    records: ['project','document','offset','limit'],
    corrections: ['project','document','csv','out'],
    correct: ['project','document','decision','out'],
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
  if (command === 'document-inspect') {
    const retained = await documentSource(o, true), inspected = await inspectDocumentTables(retained);
    const output = { ...inspected, tables: inspected.tables.map(table => ({ tableIndex: table.tableIndex,
      rowCount: table.rowCount, columnCount: table.columnCount, originalCells: table.cells.length,
      location: table.location, unresolvedEntities: table.unresolvedEntities,
      preview: table.rows.slice(0, 20).map(row => ({ row: row.row, cells: row.cells.map(index => table.cells[index]) })) })) };
    if (o.out) output.savedSource = await save(o.out, json(retained), [o.source, o.metadata].filter(Boolean));
    io.stdout.write(json(output)); return 0;
  }
  if (command === 'inspect') {
    const input = await source(o);
    io.stdout.write(json({ filename: input.filename, ...inspectSource(input.sourceText, dialect(o)) })); return 0;
  }
  let project;
  if (command === 'init' || command === 'document-init') {
    const starter = o.merchant ? importWorkspaceDraft(await readText(o.merchant, LIMITS.sourceBytes)) : undefined;
    project = createProject({ name: o.name || 'Source tables', starter });
  } else project = await readProject(required(o, 'project'));
  let result;
  if(command==='intake-export') {
    const packet=await createDocumentIntakePacket(project.documentIntake||createDocumentIntake(),project.documentTableSources||[]);
    io.stdout.write(json(await save(required(o,'out'),json(packet),[o.project])));return 0;
  }
  if(command==='intake-open') {
    const packet=JSON.parse(await readText(required(o,'source'),LIMITS.projectBytes));
    const received=await receiveDocumentIntakePacket(project.documentIntake||createDocumentIntake(),project.documentTableSources||[],packet);
    project.documentIntake=received.intake;project.documentTableSources=received.sources;
    project=await importProject(project);
  }
  if (['document-init', 'document-add', 'document-edition'].includes(command)) {
    const retained = await documentSource(o), selection = await documentSelection(o), projection = await projectDocumentTable(retained, selection);
    result = await addDocumentTable(project, { source: retained, projection, resourceId: o.resource, filename: o.filename,
      ...(command === 'document-edition' ? { documentId: required(o, 'document') } : {}) }); project = result.project;
  } else if (command === 'init' || command === 'add') {
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
  } else if (command === 'correct') {
    const decision=JSON.parse(await readText(required(o,'decision'),LIMITS.sourceBytes));
    project=recordCorrection(project,required(o,'document'),decision);
  } else if (command === 'records' || command === 'corrections') {
    const doc=project.documents.find(row=>row.id===required(o,'document'));
    if(!doc)throw new Error('The selected document is absent.');
    const output=command==='records'?json(sourceRecords(doc,{offset:o.offset===undefined?0:Number(o.offset),limit:o.limit===undefined?20:Number(o.limit)})):
      o.csv?correctionsCsv(selectedCorrections(doc)):json(selectedCorrections(doc));
    if(o.out)io.stdout.write(json(await save(o.out,output,[o.project])));else io.stdout.write(output);
    return 0;
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
  const receipt = await save(required(o, 'out'), json(project), [o.project, o.source, o.mapping, o.merchant, o.selection, o.decision].filter(Boolean));
  io.stdout.write(json({ ...receipt, ...(result ? { documentId: result.documentId, editionId: result.editionId, reviewId: result.review?.id, reused: result.reused, sourceId: result.sourceId, projectionId: result.projectionId } : {}), project: projectSummary(project) }));
  return 0;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runSourceTableCli(process.argv.slice(2)).then(code => { process.exitCode = code; }).catch(error => {
    process.stderr.write(json({ error: error.message, code: error.code || 'SOURCE_TABLE_CLI', ...(error instanceof SourceTableError ? { issues: error.issues, issueCount: error.issueCount, line: error.line, record: error.record } : {}) }));
    process.exitCode = 1;
  });
}
