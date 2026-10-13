#!/usr/bin/env node
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  createEdition, reconcile, decideMany, finalize, exportCSV, exportHTML,
  exportSQL, serializeWorkspace, reopenWorkspace, canonicalJSON
} from './supplier-report.mjs';
import {createWorkbookHost,workbookMain,workbookDeliveryMembers} from './review-workbook-host.mjs';
import {reopenSourceEdition,serializeSourceEdition,nativeSourceIdentity} from './source-editions.mjs';
import {readNativeSource,nativeDeliveryMembers,verifyNativeArchive,readSourceBytes,nativeRuntimeDocument,createNativeSourceHost} from './native-source-io.mjs';

const USAGE = [
  'Supplier feed review',
  '',
  '  node supplier-report-cli.mjs compare --baseline baseline.csv --candidate candidate.csv',
  '    --rules rules.json --request REQUEST_ID --out workspace.json',
  '    [--baseline-source SOURCE_ID] [--candidate-source SOURCE_ID]',
  '    [--baseline-captured-at ISO_DATE] [--candidate-captured-at ISO_DATE] [--force]',
  '    [--baseline-format csv|source-json|native-edition|native-archive]',
  '    [--candidate-format csv|source-json|native-edition|native-archive]',
  '    [--baseline-native-sha256 SHA] [--candidate-native-sha256 SHA]',
  '    [--baseline-archive-sha256 SHA] [--candidate-archive-sha256 SHA]',
  '    [--numeric-format source|plain-decimal] [--native-cache DIRECTORY] [--native-directory DATASETTE_DIRECTORY]',
  '',
  '  node supplier-report-cli.mjs native-source --input ORIGINAL --format native-edition|native-archive --out SOURCE.json',
  '    [--id ID] [--source ID] [--captured-at ISO_DATE] [--native-sha256 SHA] [--archive-sha256 SHA]',
  '    [--numeric-format source|plain-decimal] [--native-cache DIRECTORY] [--native-directory DATASETTE_DIRECTORY] [--force]',
  '',
  '  node supplier-report-cli.mjs receive --delivery ORIGINAL_DELIVERY --out-dir NEW_DIRECTORY',
  '    [--native-cache DIRECTORY] [--native-directory DATASETTE_DIRECTORY]',
  '',
  '  node supplier-report-cli.mjs decide --workspace workspace.json --decisions decisions.json',
  '    --reviewer REVIEWER --expected-revision NUMBER --out reviewed.json [--finalize] [--force]',
  '',
  '  node supplier-report-cli.mjs export --workspace reviewed.json --out-dir NEW_DIRECTORY',
  '    [--table-name supplier_feed_accepted] [--workbook-delivery REVIEW_DELIVERY_DIRECTORY]',
  '    [--baseline-native-archive FILE] [--candidate-native-archive FILE]',
  '    [--native-cache DIRECTORY] [--native-directory DATASETTE_DIRECTORY]',
  '',
  '  node supplier-report-cli.mjs inspect --workspace workspace.json',
  '  node supplier-report-cli.mjs serve [--port 8765] [--native-cache DIRECTORY] [--native-directory DATASETTE_DIRECTORY]',
  '',
  '  node supplier-report-cli.mjs workbook-export --workspace WORKSPACE --out REVIEW.xlsx',
  '  node supplier-report-cli.mjs workbook-review --workspace WORKSPACE --returned REVIEW.xlsx --out-dir REVIEW_DIRECTORY',
  '    [--resolutions CHOICES.json] [--reviewed-at ISO_TIMESTAMP] [--python PYTHON_EXECUTABLE]',
  '  node supplier-report-cli.mjs workbook-apply --workspace WORKSPACE --review-dir REVIEW_DIRECTORY',
  '    --operation ORIGINAL_ID --out RESULT_WORKSPACE --delivery-dir NEW_DELIVERY [--finalize] [--force]',
  '  node supplier-report-cli.mjs workbook-receive --packet COMPLETE_PACKET.json --out-dir NEW_DIRECTORY',
  '    (or --delivery-dir ORIGINAL_DELIVERY in place of --packet)',
  '',
  'Workbook file conversion uses the installed Analysis Python environment; see WORKBOOK_REVIEW.md.',
  'CSV timestamps default to file intake; native editions retain their original capture time.',
  'source-json reopens a complete exported edition with its original IDs, rows, metadata and digests.',
  'All input text must be valid UTF-8. Export requires a new directory.',
  '--force permits replacing a regular output file for compare or decide.',
  '--finalize requires all review decisions to produce a conflict-free finalized result.',
  'serve runs the original local workspace; native archive and XLSX conversion use that local host.'
].join('\n');

const SCHEMAS = {
  compare: {
    required: ['baseline', 'candidate', 'rules', 'request', 'out'],
    optional: ['baseline-source', 'candidate-source', 'baseline-captured-at', 'candidate-captured-at',
      'baseline-format', 'candidate-format', 'baseline-native-sha256', 'candidate-native-sha256',
      'baseline-archive-sha256', 'candidate-archive-sha256', 'numeric-format', 'native-cache', 'native-directory'],
    flags: ['force']
  },
  decide: {
    required: ['workspace', 'decisions', 'reviewer', 'expected-revision', 'out'],
    optional: [], flags: ['force', 'finalize']
  },
  export: { required: ['workspace', 'out-dir'], optional: ['table-name', 'workbook-delivery',
    'baseline-native-archive', 'candidate-native-archive', 'native-cache', 'native-directory'], flags: [] },
  'native-source': { required: ['input', 'format', 'out'], optional: ['id', 'source', 'captured-at',
    'native-sha256', 'archive-sha256', 'numeric-format', 'native-cache', 'native-directory'], flags: ['force'] },
  receive: { required: ['delivery', 'out-dir'], optional: ['native-cache', 'native-directory'], flags: [] },
  inspect: { required: ['workspace'], optional: [], flags: [] },
  serve: { required: [], optional: ['port', 'native-cache', 'native-directory'], flags: [] }
};

function error(message, code = 'CLI_ARGUMENT') {
  return Object.assign(new Error(message), { code });
}

function parseArguments(argv) {
  const [command, ...rest] = argv;
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    return { command: 'help', options: {} };
  }
  const schema = SCHEMAS[command];
  if (!schema) throw error('Unknown command: ' + command);
  const allowed = new Set([...schema.required, ...schema.optional, ...schema.flags]);
  const flags = new Set(schema.flags);
  const options = Object.create(null);
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index];
    if (argument === '--help' || argument === '-h') return { command: 'help', options: {} };
    if (!argument.startsWith('--')) throw error('Unexpected positional argument: ' + argument);
    const separator = argument.indexOf('=');
    const key = argument.slice(2, separator < 0 ? undefined : separator);
    if (!allowed.has(key)) throw error('Unknown option for ' + command + ': --' + key);
    if (Object.hasOwn(options, key)) throw error('Repeated option: --' + key);
    if (flags.has(key)) {
      if (separator >= 0) throw error('--' + key + ' takes no value');
      options[key] = true;
      continue;
    }
    let value = separator < 0 ? rest[++index] : argument.slice(separator + 1);
    if (value === undefined || value === '' || (separator < 0 && value.startsWith('--'))) {
      throw error('Missing value for --' + key);
    }
    options[key] = value;
  }
  for (const key of schema.required) {
    if (!Object.hasOwn(options, key) || !options[key].trim()) throw error('Required option: --' + key);
  }
  return { command, options };
}

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
const stripJSONBOM = value => value.replace(/^\uFEFF/, '');

async function readUTF8(filename) {
  const absolutePath = path.resolve(filename);
  const handle = await fs.open(absolutePath, 'r');
  let bytes;
  let stat;
  try {
    stat = await handle.stat();
    if (!stat.isFile()) throw error('Expected a regular file: ' + absolutePath, 'INPUT_FILE');
    bytes = await handle.readFile();
  } finally {
    await handle.close();
  }
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw error('Input is not valid UTF-8: ' + absolutePath, 'INVALID_UTF8');
  }
  return { text, absolutePath, byteLength: bytes.length, sha256: digest(bytes), modifiedAt: stat.mtime.toISOString() };
}

async function readJSON(filename) {
  const input = await readUTF8(filename);
  try {
    return { ...input, value: JSON.parse(stripJSONBOM(input.text)) };
  } catch (failure) {
    throw error('Invalid JSON in ' + input.absolutePath + ': ' + failure.message, 'INVALID_JSON');
  }
}

async function loadWorkspace(filename) {
  const input = await readUTF8(filename);
  return { ...input, report: reopenWorkspace(stripJSONBOM(input.text)) };
}

async function atomicWrite(filename, content, { force = false } = {}) {
  const destination = path.resolve(filename);
  const parent = path.dirname(destination);
  await fs.mkdir(parent, { recursive: true });
  if (force) {
    try {
      const existing = await fs.lstat(destination);
      if (!existing.isFile() || existing.isSymbolicLink()) {
        throw error('--force replaces regular files only: ' + destination, 'OUTPUT_TYPE');
      }
    } catch (failure) {
      if (failure.code !== 'ENOENT') throw failure;
    }
  }
  const temporary = path.join(parent, '.' + path.basename(destination) + '.' + randomUUID() + '.tmp');
  let handle;
  try {
    handle = await fs.open(temporary, 'wx', 0o600);
    await handle.writeFile(content, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    if (force) {
      await fs.rename(temporary, destination);
    } else {
      try {
        await fs.link(temporary, destination);
      } catch (failure) {
        if (failure.code === 'EEXIST') {
          throw error('Output already exists; select a new path or use --force: ' + destination, 'OUTPUT_EXISTS');
        }
        throw failure;
      }
      await fs.unlink(temporary);
    }
  } finally {
    if (handle) await handle.close().catch(() => {});
    await fs.unlink(temporary).catch(failure => {
      if (failure.code !== 'ENOENT') throw failure;
    });
  }
  return destination;
}

function summary(report, extra = {}) {
  return {
    requestId: report.requestId,
    comparisonId: report.comparisonId,
    status: report.status,
    revision: report.revision,
    summary: report.summary,
    baseline: {
      id: report.baseline.id, sourceId: report.baseline.sourceId,
      capturedAt: report.baseline.capturedAt, rows: report.baseline.rows.length
    },
    candidate: {
      id: report.candidate.id, sourceId: report.candidate.sourceId,
      capturedAt: report.candidate.capturedAt, rows: report.candidate.rows.length
    },
    ...extra
  };
}

function workspaceText(report) {
  const value = serializeWorkspace(report);
  if (typeof value !== 'string') throw error('Workspace serializer returned a non-text result', 'SERIALIZATION');
  return value.endsWith('\n') ? value : value + '\n';
}

async function editionFromFile(filename, options) {
  const input = await readUTF8(filename);
  const importedAt = new Date().toISOString();
  return createEdition({
    id: options.id,
    sourceId: options.sourceId || pathToFileURL(input.absolutePath).href,
    capturedAt: options.capturedAt || importedAt,
    csv: input.text,
    source: {
      kind: 'local_file', uri: pathToFileURL(input.absolutePath).href,
      filename: path.basename(input.absolutePath), byteLength: input.byteLength,
      sha256: input.sha256, modifiedAt: input.modifiedAt, importedAt
    }
  });
}

async function sourceForComparison(filename,role,options) {
  const format=options[role+'-format'] || 'csv';
  if(format==='source-json'){
    if(options[role+'-source'] || options[role+'-captured-at'] || options[role+'-native-sha256'] || options[role+'-archive-sha256']){
      throw error('A source-json input preserves its original identity, capture time and digests. Select the retained source file without overrides.','SOURCE_IDENTITY_PRESERVED');
    }
    const input=await readUTF8(filename);
    return reopenSourceEdition(input.text);
  }
  if(format==='csv'){
    if(options[role+'-native-sha256'] || options[role+'-archive-sha256']){
      throw error('Native identity hashes require a native-edition or native-archive input for '+role+'.','SOURCE_FORMAT');
    }
    return editionFromFile(filename,{
      id:options.request+':'+role,sourceId:options[role+'-source'],capturedAt:options[role+'-captured-at']
    });
  }
  if(!['native-edition','native-archive'].includes(format)){
    throw error('Source format must be csv, source-json, native-edition or native-archive.','SOURCE_FORMAT');
  }
  return readNativeSource({
    filename,format,id:options.request+':'+role,
    sourceId:options[role+'-source'],capturedAt:options[role+'-captured-at'],
    expectedSha256:options[role+'-native-sha256'],archiveSha256:options[role+'-archive-sha256'],
    numericFormat:options['numeric-format'] || 'source',
    cacheDirectory:options['native-cache'] || path.resolve(options.out)+'.sources',
    nativeDirectory:options['native-directory']
  });
}

async function compareCommand(options) {
  const rulesInput = await readJSON(options.rules);
  const requestId = options.request;
  const baseline = await sourceForComparison(options.baseline,'baseline',options);
  const candidate = await sourceForComparison(options.candidate,'candidate',options);
  const report = reconcile({ requestId, baseline, candidate, rules: rulesInput.value });
  const saved = await atomicWrite(options.out, workspaceText(report), { force: Boolean(options.force) });
  process.stdout.write(json(summary(report, { workspace: saved })));
}

async function nativeSourceCommand(options) {
  const edition=await readNativeSource({
    filename:options.input,format:options.format,id:options.id,sourceId:options.source,
    capturedAt:options['captured-at'],expectedSha256:options['native-sha256'],
    archiveSha256:options['archive-sha256'],numericFormat:options['numeric-format'] || 'source',
    cacheDirectory:options['native-cache'] || path.resolve(options.out)+'.sources',
    nativeDirectory:options['native-directory']
  });
  const output=await atomicWrite(options.out,serializeSourceEdition(edition),{force:Boolean(options.force)});
  process.stdout.write(json({source:output,id:edition.id,sourceId:edition.sourceId,
    capturedAt:edition.capturedAt,rows:edition.rows.length,native:nativeSourceIdentity(edition),
    archive:edition.source.native.archive}));
}

function parseRevision(value) {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) throw error('--expected-revision must be a nonnegative integer');
  const revision = Number(value);
  if (!Number.isSafeInteger(revision)) throw error('--expected-revision exceeds the supported integer range');
  return revision;
}

async function decideCommand(options) {
  const input = await loadWorkspace(options.workspace);
  const decisionInput = await readJSON(options.decisions);
  if (!Array.isArray(decisionInput.value)) {
    throw error('Decisions JSON must be an array of decision objects', 'DECISIONS_FORMAT');
  }
  let report = input.report;
  const expectedRevision = parseRevision(options['expected-revision']);
  if (report.revision !== expectedRevision) {
    throw error('Workspace revision is ' + report.revision + '; expected ' + expectedRevision, 'REVISION_CONFLICT');
  }
  if (decisionInput.value.length === 0 && !options.finalize) {
    throw error('Provide at least one decision, or use --finalize to require a complete review', 'DECISIONS_EMPTY');
  }
  for (const decision of decisionInput.value) {
    if (!decision || typeof decision !== 'object' || Array.isArray(decision)) {
      throw error('Each decision must be a JSON object', 'DECISIONS_FORMAT');
    }
  }
  if (decisionInput.value.length > 0) {
    report = decideMany(report, decisionInput.value, { reviewer: options.reviewer, expectedRevision });
  }
  if (options.finalize) finalize(report);
  const outputPath = path.resolve(options.out);
  if (outputPath === input.absolutePath && options.force) {
    const currentInput = await readUTF8(input.absolutePath);
    if (currentInput.sha256 !== input.sha256) {
      throw error('Workspace changed while decisions were being prepared; reload it before writing', 'WORKSPACE_CHANGED');
    }
  }
  const saved = await atomicWrite(outputPath, workspaceText(report), { force: Boolean(options.force) });
  process.stdout.write(json(summary(report, { workspace: saved, appliedDecisions: decisionInput.value.length })));
}

function addSourceFile(files, side, edition) {
  if (typeof edition.rawCSV === 'string') {
    files.set(side + '-source.csv', edition.rawCSV);
  } else {
    files.set(side + '-source.json', serializeSourceEdition(edition));
  }
}

const DELIVERY_SOURCE_FILES = [
  'supplier-report-cli.mjs', 'supplier-report.mjs', 'review.html',
  'review-ui.mjs', 'review-ui.css', 'README.md', 'FIELD_GUIDE.md', 'SOURCE_NOTES.md',
  'catalogue-coverage.mjs', 'CATALOGUE_COVERAGE.md',
  'supplier_attachments.py', 'NATIVE_ATTACHMENTS.md',
  'review-workbook.mjs', 'review_workbook.py', 'review-workbook-ui.mjs',
  'review-workbook-host.mjs', 'WORKBOOK_REVIEW.md',
  'datasette-bridge.mjs', 'source-editions.mjs', 'native-source-io.mjs',
  'native-runtime.json', 'NATIVE_EDITION_BRIDGE.md'
];

async function deliverySources() {
  const directory = fileURLToPath(new URL('.', import.meta.url));
  const inputs = await Promise.all(DELIVERY_SOURCE_FILES.map(async filename => {
    const original = await readUTF8(path.join(directory, filename));
    return [filename, original.text];
  }));
  return new Map(inputs);
}

function makeExportFiles(report, tableName, sources) {
  const files = new Map();
  files.set('workspace.json', workspaceText(report));
  files.set('report.json', json(report));
  files.set('rules.json', json(report.rules));
  addSourceFile(files, 'baseline', report.baseline);
  addSourceFile(files, 'candidate', report.candidate);
  files.set('changes.csv', exportCSV(report, { kind: 'changes' }));
  files.set('report.html', exportHTML(report));
  if (report.status === 'reviewed') {
    const result = finalize(report);
    files.set('accepted.csv', exportCSV(report, { kind: 'accepted' }));
    files.set('accepted.sql', exportSQL(report, { tableName }));
    files.set('lineage.json', json({
      requestId: result.requestId, comparisonId: result.comparisonId,
      revision: result.revision, resultDigest: result.resultDigest,
      baselineEditionId: result.baselineEditionId, candidateEditionId: result.candidateEditionId,
      columns: result.columns, rows: result.rows, provenance: result.provenance,
      summary: result.summary
    }));
  }
  for (const filename of DELIVERY_SOURCE_FILES) {
    const content = sources.get(filename);
    if (typeof content !== 'string' || !content.length || files.has(filename)) {
      throw error('The complete installed review source is required: ' + filename, 'DELIVERY_SOURCE_REQUIRED');
    }
    files.set(filename, content);
  }
  for (const [filename, content] of files) {
    if (typeof content !== 'string') throw error('Export is not text: ' + filename, 'EXPORT_FORMAT');
  }
  const manifest = {
    format: 'conapi-supplier-delivery', version: 1,
    requestId: report.requestId, comparisonId: report.comparisonId,
    revision: report.revision, status: report.status, exportedAt: new Date().toISOString(),
    files: [...files].map(([filename, content]) => ({
      filename, bytes: Buffer.byteLength(content, 'utf8'), sha256: digest(Buffer.from(content, 'utf8'))
    }))
  };
  files.set('manifest.json', json(manifest));
  return files;
}

async function exportCommand(options) {
  const input = await loadWorkspace(options.workspace);
  const {report}=input;
  // Generate every requested artifact before opening the destination directory.
  const sources = await deliverySources();
  if(options['native-directory'])sources.set('native-runtime.json',await nativeRuntimeDocument({nativeDirectory:options['native-directory']}));
  const native=await nativeDeliveryMembers(report,{
    directory:path.dirname(input.absolutePath),
    archives:{baseline:options['baseline-native-archive'],candidate:options['candidate-native-archive']},
    cacheDirectory:options['native-cache'],nativeDirectory:options['native-directory']
  });
  const files = makeExportFiles(report, options['table-name'] || 'supplier_feed_accepted', sources);
  if(native.files.length){
    const manifest=JSON.parse(files.get('manifest.json'));files.delete('manifest.json');
    for(const {filename,content} of native.files){
      if(files.has(filename))throw error('Native source duplicates an existing export member: '+filename,'EXPORT_FORMAT');
      files.set(filename,content);
      manifest.files.push({filename,bytes:content.length,sha256:digest(content)});
    }
    manifest.nativeSources=native.sources;
    files.set('manifest.json',json(manifest));
  }
  if (options['workbook-delivery']) {
    const additions = await workbookDeliveryMembers(options['workbook-delivery'], report);
    const manifest = JSON.parse(files.get('manifest.json'));
    files.delete('manifest.json');
    for (const {filename, content} of additions) {
      if (files.has(filename)) throw error('Workbook delivery duplicates an existing export member: ' + filename, 'EXPORT_FORMAT');
      files.set(filename, content);
      const body = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
      manifest.files.push({filename, bytes: body.length, sha256: digest(body)});
    }
    files.set('manifest.json', json(manifest));
  }
  const directory = path.resolve(options['out-dir']);
  await fs.mkdir(path.dirname(directory), { recursive: true });
  try {
    await fs.mkdir(directory);
  } catch (failure) {
    if (failure.code === 'EEXIST') throw error('Export directory already exists; choose a new directory: ' + directory, 'OUTPUT_EXISTS');
    throw failure;
  }
  try {
    for (const [filename, content] of files) {
      await atomicWrite(path.join(directory, filename), content);
    }
  } catch (failure) {
    throw error('Export could not finish in ' + directory + ': ' + failure.message + '. Completion is marked by manifest.json.', failure.code || 'EXPORT_WRITE');
  }
  process.stdout.write(json(summary(report, { directory, files: [...files.keys()] })));
}

async function receiveCommand(options) {
  const originalDirectory=path.resolve(options.delivery),destination=path.resolve(options['out-dir']);
  if(originalDirectory===destination)throw error('Choose a new receiving directory.','OUTPUT_EXISTS');
  const manifestInput=await readJSON(path.join(originalDirectory,'manifest.json'));
  const manifest=manifestInput.value;
  if(!manifest || manifest.format!=='conapi-supplier-delivery' || manifest.version!==1 || !Array.isArray(manifest.files)){
    throw error('Choose a completed supplier delivery with its original manifest.','DELIVERY_MANIFEST');
  }
  const originals=new Map(),descriptors=new Map();
  for(const member of manifest.files){
    if(!member || typeof member.filename!=='string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(member.filename) ||
        member.filename==='manifest.json' || descriptors.has(member.filename) ||
        !Number.isSafeInteger(member.bytes) || member.bytes<0 || !/^[a-f0-9]{64}$/.test(member.sha256)){
      throw error('Every delivery member needs a unique basename and original byte identity.','DELIVERY_MANIFEST');
    }
    const original=await readSourceBytes(path.join(originalDirectory,member.filename));
    if(original.bytes!==member.bytes || original.sha256!==member.sha256){
      throw error('The received delivery member changed: '+member.filename,'DELIVERY_MEMBER_CHANGED');
    }
    descriptors.set(member.filename,member);originals.set(member.filename,original.content);
  }
  const requireMember=filename=>{
    if(!originals.has(filename))throw error('The complete delivery is missing '+filename+'.','DELIVERY_INCOMPLETE');
    return originals.get(filename);
  };
  const decode=filename=>{
    try{return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(requireMember(filename));}
    catch(failure){if(failure.code)throw failure;throw error(filename+' must be complete UTF-8.','INVALID_UTF8');}
  };
  const document=filename=>{
    try{return JSON.parse(stripJSONBOM(decode(filename)));}
    catch(failure){if(failure.code)throw failure;throw error(filename+' must be complete JSON.','INVALID_JSON');}
  };
  const report=reopenWorkspace(stripJSONBOM(decode('workspace.json')));
  for(const key of ['requestId','comparisonId','revision','status']){
    if(manifest[key]!==report[key])throw error('The delivery manifest belongs to another '+key+'.','DELIVERY_IDENTITY');
  }
  if(canonicalJSON(document('report.json'))!==canonicalJSON(report) ||
      canonicalJSON(document('rules.json'))!==canonicalJSON(report.rules)){
    throw error('The report and rules must reproduce the complete received workspace.','DELIVERY_REPORT_CHANGED');
  }
  for(const filename of ['changes.csv','report.html','supplier-report.mjs','supplier-report-cli.mjs',
    'review.html','review-ui.mjs','review-ui.css'])requireMember(filename);
  const nativeSources=manifest.nativeSources || {};
  if(!nativeSources || typeof nativeSources!=='object' || Array.isArray(nativeSources) ||
      Object.keys(nativeSources).some(key=>!['baseline','candidate'].includes(key))){
    throw error('Native source bindings must identify the original baseline and candidate.','DELIVERY_NATIVE_BINDING');
  }
  for(const role of ['baseline','candidate']){
    const edition=report[role];
    if(typeof edition.rawCSV==='string'){
      if(decode(role+'-source.csv')!==edition.rawCSV)throw error('The complete '+role+' CSV changed.','DELIVERY_SOURCE_CHANGED');
    }else{
      const source=reopenSourceEdition(decode(role+'-source.json'));
      if(canonicalJSON(source)!==canonicalJSON(edition))throw error('The complete '+role+' source edition changed.','DELIVERY_SOURCE_CHANGED');
    }
    const identity=nativeSourceIdentity(edition);
    if(identity){
      for(const filename of ['datasette-bridge.mjs','source-editions.mjs','native-source-io.mjs','native-runtime.json'])requireMember(filename);
      const selected=nativeSources[role],filename=role+'-native-source.datasette.json.gz',member=descriptors.get(filename);
      if(!selected || selected.archive!==filename || !member || selected.bytes!==member.bytes ||
          selected.sha256!==member.sha256 || selected.editionSha256!==identity.editionSha256 ||
          selected.captureSha256!==identity.captureSha256){
        throw error('The native '+role+' archive binding differs from its original edition.','DELIVERY_NATIVE_BINDING');
      }
      await verifyNativeArchive(edition,path.join(originalDirectory,filename),{
        cacheDirectory:options['native-cache'] || destination+'.sources',nativeDirectory:options['native-directory']
      });
    }else if(nativeSources[role]){
      throw error('A native archive is bound to a non-native '+role+' source.','DELIVERY_NATIVE_BINDING');
    }
  }
  if(report.status==='reviewed'){
    const result=finalize(report),lineage=document('lineage.json');
    requireMember('accepted.sql');
    if(decode('accepted.csv')!==exportCSV(report,{kind:'accepted'}))throw error('The accepted rows differ from the reviewed workspace.','DELIVERY_ACCEPTED_CHANGED');
    const expected={requestId:result.requestId,comparisonId:result.comparisonId,revision:result.revision,
      resultDigest:result.resultDigest,baselineEditionId:result.baselineEditionId,candidateEditionId:result.candidateEditionId,
      columns:result.columns,rows:result.rows,provenance:result.provenance,summary:result.summary};
    if(canonicalJSON(lineage)!==canonicalJSON(expected))throw error('The accepted lineage differs from the reviewed workspace.','DELIVERY_LINEAGE_CHANGED');
  }else if(['accepted.csv','accepted.sql','lineage.json'].some(filename=>originals.has(filename))){
    throw error('Final accepted outputs require the original reviewed workspace.','DELIVERY_STATUS');
  }
  const finalManifest=await readUTF8(manifestInput.absolutePath);
  if(finalManifest.sha256!==manifestInput.sha256)throw error('The manifest changed during receiving.','DELIVERY_MANIFEST_CHANGED');
  await fs.mkdir(path.dirname(destination),{recursive:true});
  try{await fs.mkdir(destination,{mode:0o700});}
  catch(failure){if(failure.code==='EEXIST')throw error('Receiving directory already exists; choose a new directory: '+destination,'OUTPUT_EXISTS');throw failure;}
  try{
    for(const [filename,content] of originals)await atomicWrite(path.join(destination,filename),content);
    await atomicWrite(path.join(destination,'manifest.json'),manifestInput.text);
  }catch(failure){
    throw error('Receiving could not finish in '+destination+': '+failure.message+'. Completion is marked by manifest.json.',failure.code || 'DELIVERY_WRITE');
  }
  process.stdout.write(json(summary(report,{directory:destination,receivedFrom:originalDirectory,
    manifestSha256:manifestInput.sha256,files:[...originals.keys(),'manifest.json'],nativeSources})));
}

async function serveCommand(options) {
  const rawPort = options.port || '8765';
  if (!/^[0-9]+$/.test(rawPort)) throw error('--port must be an integer');
  const port = Number(rawPort);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw error('--port must be between 1 and 65535');
  const directory = fileURLToPath(new URL('.', import.meta.url));
  const workbookHost = createWorkbookHost();
  const nativeHost=createNativeSourceHost({cacheDirectory:options['native-cache'],nativeDirectory:options['native-directory'],directory});
  const allowed = new Map([
    ['/', ['review.html', 'text/html; charset=utf-8']],
    ['/review.html', ['review.html', 'text/html; charset=utf-8']],
    ['/supplier-report.mjs', ['supplier-report.mjs', 'text/javascript; charset=utf-8']],
    ['/source-editions.mjs', ['source-editions.mjs', 'text/javascript; charset=utf-8']],
    ['/review-ui.mjs', ['review-ui.mjs', 'text/javascript; charset=utf-8']],
    ['/review-ui.css', ['review-ui.css', 'text/css; charset=utf-8']],
    ['/review-workbook.mjs', ['review-workbook.mjs', 'text/javascript; charset=utf-8']],
    ['/review-workbook-ui.mjs', ['review-workbook-ui.mjs', 'text/javascript; charset=utf-8']]
  ]);
  const server = createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'no-store');
    if (await workbookHost.handle(request, response)) return;
    if (await nativeHost.handle(request, response)) return;
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' });
      response.end('Method not allowed');
      return;
    }
    let pathname;
    try { pathname = new URL(request.url, 'http://127.0.0.1').pathname; }
    catch { response.writeHead(400); response.end('Invalid request'); return; }
    const entry = allowed.get(pathname);
    if (!entry) { response.writeHead(404); response.end('Not found'); return; }
    try {
      const body = await fs.readFile(path.join(directory, entry[0]));
      response.writeHead(200, { 'Content-Type': entry[1], 'Content-Length': body.length });
      response.end(request.method === 'HEAD' ? undefined : body);
    } catch (failure) {
      response.writeHead(failure.code === 'ENOENT' ? 404 : 500, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end(failure.code === 'ENOENT' ? 'Package file is missing' : 'Could not read package file');
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  process.stdout.write('Supplier review: http://127.0.0.1:' + port + '/\nPress Ctrl+C to stop.\n');
  server.on('error', failure => {
    process.stderr.write(json({ error: failure.code || 'SERVER_ERROR', message: failure.message }));
    process.exitCode = 1;
  });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      const stopped = new Promise(resolve => server.close(resolve));
      Promise.all([stopped, workbookHost.close(), nativeHost.close()]).then(() => { process.exitCode = 0; }, failure => {
        process.stderr.write(json({error: failure.code || 'SERVER_CLOSE', message: failure.message})); process.exitCode = 1;
      });
    });
  }
}

async function main() {
  if (['workbook-export', 'workbook-review', 'workbook-apply', 'workbook-receive'].includes(process.argv[2])) {
    process.stdout.write(json(await workbookMain(process.argv.slice(2)))); return;
  }
  const { command, options } = parseArguments(process.argv.slice(2));
  if (command === 'help') process.stdout.write(USAGE + '\n');
  else if (command === 'compare') await compareCommand(options);
  else if (command === 'decide') await decideCommand(options);
  else if (command === 'native-source') await nativeSourceCommand(options);
  else if (command === 'receive') await receiveCommand(options);
  else if (command === 'export') await exportCommand(options);
  else if (command === 'inspect') {
    const { report } = await loadWorkspace(options.workspace);
    process.stdout.write(json(summary(report)));
  } else if (command === 'serve') await serveCommand(options);
}

main().catch(failure => {
  process.stderr.write(json({ error: failure.code || 'CLI_ERROR', message: failure.message }));
  process.exitCode = 1;
});
