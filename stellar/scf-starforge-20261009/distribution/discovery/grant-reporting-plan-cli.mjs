#!/usr/bin/env node
// MIT. Create an editable customer procedure; native business execution remains with its original owner.
import { readFile, stat, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadCommandCatalog } from './load.mjs';
import { saveExport } from './write-json.mjs';
import { createGrantReportingPlan } from './grant-reporting-plan.mjs';
import { prepareGrantReportingPlan } from './grant-reporting-core.mjs';
import { GRANT_REPORTING_PREPARATION_SCHEMA, grantReportingPreparationInput } from './grant-reporting-input.mjs';
import { summarizeOperatingPlan } from './operating-plan.mjs';

export const GRANT_REPORTING_HELP = [
  'Grant reporting procedure',
  '',
  'starforge grant-reporting-plan create --input INPUT.json --out NEW_PLAN.json',
  '  [--catalog COMPLETE_CATALOG.json | --source-root DIRECTORY --selection PRODUCT]',
  'starforge grant-reporting-plan capture --binding PRIVATE.json --case operation-ID',
  '  --source-project COMPLETE_BOOK.json --input REPORT_FIELDS.json --out NEW_DIRECTORY',
  '  [--expected-version N] [--procedure-selection SELECTION.json]',
  '  [--catalog COMPLETE_CATALOG.json | --source-root DIRECTORY --selection PRODUCT]',
  'starforge grant-reporting-plan capture-show --directory COMPLETE_CAPTURE_DIRECTORY',
  '',
  'Input may be the complete browser preparation, full native case/source-project input, or compact reference input.',
  'The complete preparation retains and verifies all three original JSON files and its saved preview.',
  'For full inputs, --out must be OUTPUT_DIRECTORY/grant-reporting-plan.json, preserving the plan’s command path.',
  'A preparation keeps its captured catalog; a supplied --catalog must match it exactly.',
  'Open the preparation in the browser to intentionally refresh its source selection.',
  '',
  'The input retains the original case/plan IDs and revisions, actual workspace, selected files,',
  'customer/period/receiving notes, a stable procedure ID and savedAt time, and a fixed browser origin.',
  'Each source table explicitly selects its delimiter and header setting. File hashes and lengths',
  'remain declared original references until the receiving operator records the actual result.',
  '',
  'A supplied --catalog is the complete original Command finder catalog, not a search-result export.',
  'Otherwise the maintained catalog loader reads the current installed/source selection.',
  'The catalog must contain grant-workspace, grant-source-tables and discover registrations.',
  'create keeps every generated step planned. capture reads the existing managed Grant case and',
  'retains its exact original book/catalog with the same portable preparation and reporting plan.',
  'An optional original procedure selection prepares grant-procedure.json for grant-procedures save.',
  'capture-show reopens the complete frozen capture and its readable handovers.',
  'The original output is created exclusively. Keep it for the same request; reopen/edit/revise it with',
  'starforge discover plan or the existing Operating plans browser. Full JSON carries every revision.',
].join('\n');

export function parseGrantReportingArguments(args) {
  const words = [...args];
  if (!words.length || words.includes('--help') || words.includes('-h')) return {action: 'help', options: {}};
  const action = words.shift();
  const actions = {
    create:['input', 'out', 'catalog', 'source-root', 'selection'],
    capture:['binding', 'case', 'source-project', 'input', 'out', 'expected-version',
      'procedure-selection', 'catalog', 'source-root', 'selection'],
    'capture-show':['directory'],
  };
  if (!Object.hasOwn(actions, action)) throw new TypeError('Choose create, capture or capture-show; use discover plan for saved plan revisions.');
  const allowed = actions[action], options = {};
  while (words.length) {
    const flag = words.shift(), key = flag.startsWith('--') ? flag.slice(2) : '';
    if (!allowed.includes(key) || Object.hasOwn(options, key)) throw new TypeError('Unknown or repeated option: ' + flag);
    if (!words.length || words[0].startsWith('--')) throw new TypeError('A value is required for ' + flag);
    options[key] = words.shift();
  }
  if (action === 'capture-show') {
    if (!options.directory) throw new TypeError('Use --directory with the complete retained capture.');
    return {action, options};
  }
  if (!options.input || !options.out) throw new TypeError('Use --input with the complete reporting fields and --out with a new output.');
  if (action === 'capture' && (!options.binding || !options.case || !options['source-project']))
    throw new TypeError('Native capture needs the original --binding, --case and --source-project.');
  if (options['expected-version'] !== undefined &&
      (!/^[1-9][0-9]*$/.test(options['expected-version']) || !Number.isSafeInteger(Number(options['expected-version']))))
    throw new TypeError('--expected-version must be a positive safe integer.');
  if (options.catalog && (options['source-root'] || options.selection))
    throw new TypeError('Choose the complete retained --catalog or the original source/selection loader.');
  if (resolve(options.input) === resolve(options.out) || options.catalog && resolve(options.catalog) === resolve(options.out))
    throw new TypeError('Preserve the original input and catalog; choose a separate new output.');
  return {action, options};
}
const canonical = value => value === null || typeof value !== 'object' ? JSON.stringify(value)
  : Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']'
  : '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
async function jsonFile(filename, maximum = 32 * 1024 * 1024) {
  const path = resolve(filename), info = await stat(path);
  if (!info.isFile() || info.size > maximum) throw new TypeError('Use a complete regular UTF-8 JSON file within the selected input size limit.');
  const raw = await readFile(path);
  if (raw.length > maximum) throw new TypeError('The complete JSON input exceeds its selected size limit.');
  return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(raw).replace(/^\uFEFF/, ''));
}
export async function mainGrantReportingPlan(args = process.argv.slice(2), {log = console.log} = {}) {
  const {action, options} = parseGrantReportingArguments(args);
  if (action === 'help') {log(GRANT_REPORTING_HELP); return;}
  if (action === 'capture-show' || action === 'capture') {
    const native = await import('./grant-reporting-native.mjs');
    let result;
    if (action === 'capture-show') result = await native.readGrantReportingCapture(resolve(options.directory));
    else {
      const fields = await jsonFile(options.input), binding = await jsonFile(options.binding);
      const catalogSelection = options.catalog
        ? {catalogFile:resolve(options.catalog)}
        : {catalog:await loadCommandCatalog({sourceRoot:options['source-root'], selection:options.selection})};
      result = await native.captureGrantReportingPlan({
        binding, caseId:options.case, sourceProjectFile:resolve(options['source-project']),
        directory:resolve(options.out), fields, ...catalogSelection,
        ...(options['source-root'] ? {sourceRoot:resolve(options['source-root'])} : {}),
        ...(options.selection ? {sourceSelection:options.selection} : {}),
        ...(options['expected-version'] === undefined ? {} : {expectedVersion:Number(options['expected-version'])}),
        ...(options['procedure-selection'] === undefined ? {}
          : {procedureSelection:await jsonFile(options['procedure-selection'])}),
      });
    }
    log(JSON.stringify({action, directory:result.directory, ...summarizeOperatingPlan(result.plan),
      caseId:result.receipt.selection.case.id, caseVersion:result.receipt.selection.case.version,
      planId:result.receipt.selection.plan.id, planRevision:result.receipt.selection.plan.revision,
      sourceProjectId:result.receipt.selection.sourceProject.id,
      preparationFile:resolve(result.directory, 'reporting-preparation.json'),
      procedureFile:result.procedure ? resolve(result.directory, 'grant-procedure.json') : null,
      nativeConnection:result.receipt.native.closed.state}));
    return result;
  }
  const input = await jsonFile(options.input, 96 * 1024 * 1024);
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Use the complete Grant reporting input object.');
  const output = resolve(options.out);
  if (input.procedureFile !== undefined && resolve(input.procedureFile) !== output)
    throw new TypeError('The original procedureFile must match --out; retain the input/output binding.');
  const portable = input.schema === GRANT_REPORTING_PREPARATION_SCHEMA;
  const full = portable || Object.hasOwn(input, 'paths') || Object.hasOwn(input, 'sourceProject') ||
    Boolean(input.case?.program) || Boolean(input.case?.value?.program);
  const sourceRoot = options['source-root'] ?? input.sourceRoot ?? undefined;
  const selection = options.selection ?? input.sourceSelection ?? undefined;
  let document, selected;
  if (full) {
    const retained = await grantReportingPreparationInput(input);
    const retainedCatalog = retained.input.catalog;
    if (retainedCatalog && (options['source-root'] || options.selection))
      throw new TypeError('This complete input retains its original toolkit catalog. Refresh it in the existing editor before preparing against a different source selection.');
    const supplied = options.catalog ? await jsonFile(options.catalog) : undefined;
    if (retainedCatalog && supplied && canonical(retainedCatalog) !== canonical(supplied))
      throw new TypeError('The supplied catalog differs from the complete preparation. Preserve its saved catalog or prepare a new reviewed procedure.');
    const catalog = retainedCatalog ?? supplied ?? await loadCommandCatalog({sourceRoot, selection});
    const prepared = await prepareGrantReportingPlan(portable ? input : {...input, catalog,
      ...(sourceRoot ? {sourceRoot: resolve(sourceRoot)} : {}),
      ...(selection ? {sourceSelection: selection} : {})});
    if (resolve(prepared.procedureFile) !== output)
      throw new TypeError('Keep the procedure command filename: --out must be ' + prepared.procedureFile + '. Update the entered output directory before preparing a different path.');
    document = prepared.plan;
    selected = {caseId: prepared.selection.case.id, caseVersion: prepared.selection.case.version,
      planId: prepared.selection.plan.id, planRevision: prepared.selection.plan.revision,
      sourceProjectId: prepared.selection.sourceProject.id,
      ...(prepared.selection.originalFiles ? {originalFiles: prepared.selection.originalFiles} : {})};
  } else {
    const catalog = options.catalog ? await jsonFile(options.catalog) : await loadCommandCatalog({sourceRoot, selection});
    document = createGrantReportingPlan({catalog, input: {...input, procedureFile: output,
      ...(options['source-root'] ? {sourceRoot: resolve(options['source-root'])} : {}),
      ...(options.selection ? {sourceSelection: options.selection} : {})}});
    selected = {caseId: input.case.id, caseVersion: input.case.version, planId: input.case.planId,
      planRevision: input.case.planRevision};
  }
  await saveExport(output, document);
  log(JSON.stringify({file: output, action, ...summarizeOperatingPlan(document),
    ...selected, nativeOperationStarted: false}));
  return document;
}
if (process.argv[1] && await realpath(resolve(process.argv[1])).then(
  entry => pathToFileURL(entry).href === import.meta.url, () => false))
  mainGrantReportingPlan().catch(error => {
    console.error(JSON.stringify({error: {code: error.code ?? 'GRANT_REPORTING_PLAN', message: error.message,
      ...(error.details ? {details:error.details} : {}),
      ...(error.closeFailure ? {closeFailure:error.closeFailure} : {})}}));
    process.exitCode = 1;
  });
