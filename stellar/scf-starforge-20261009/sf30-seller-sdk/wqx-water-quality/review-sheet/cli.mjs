#!/usr/bin/env node
// MIT. CLI over the same private project, source-bound table and native receiving planner.
import { resolve, dirname, extname } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { openWaterQualityProject } from '../project.mjs';
import { readBytes, writeBytes } from '../../../sf88-operator-buyer-cli/node/store.mjs';
import { REVIEW_SHEET_SCHEMA, reviewSheetSource, listReviewSheetTargets, normalizeReviewSheetDocument } from './model.mjs';
import { reviewSheetCsv, reviewSheetTsv, parseReviewSheetCsv, parseReviewSheetTsv } from './csv.mjs';
import { previewReviewSheet, saveReviewSheet, listReviewSheets, readReviewSheet, exportReviewSheet, receiveReviewSheet } from './workflow.mjs';

import { concentrationSourceGroups, prepareConcentrationChoices, concentrationReportForDocument, concentrationReportCsv } from './concentrations.mjs';

const HELP = [
  'Stellar Forge / Open Waters bulk receiving decisions', '',
  'node wqx-water-quality/review-sheet/cli.mjs COMMAND --project /private/water-project [options]', '',
  'source   Read the immutable source identity (--plan PLAN).',
  'targets  Page exact source targets (--plan PLAN [--kind KIND --field FIELD --search TEXT]).',
  'draft    Export an editable sheet (--plan PLAN --format json|csv|tsv --out FILE).',
  'preview  Run the native planner (--document FILE --new-plan NEW_PLAN --out preview.json).',
  'save     Save the reviewed plan (--document FILE --new-plan NEW_PLAN --review REVIEW --preview preview.json).',
  'units    Read exact source-unit groups (--plan PLAN).',
  'standardize  Prepare complete result/limit choices (--document FILE --target-unit UNIT --reason TEXT',
  '         --results IDS_JSON, --from-unit EXACT_UNIT or --reported-limits-only',
  '         --out decisions.json --report report.json).',
  'unit-report  Reopen the full saved conversion (--review REVIEW [--format json|csv] --out FILE).',
  'list     List retained complete and prepared decision reviews.',
  'read     Reopen one original decision review (--review REVIEW).',
  'export   Export --review REVIEW --format FORMAT --out FILE.',
  'receive  Reproduce complete decisions in a private receiving project (--bundle FILE).', '',
  'FORMAT is json, csv, tsv, report, bundle, native-locations, native-results,',
  'native-crosswalk, native-report, native-references or native-bundle.', '',
  'Use --input-format json|csv|tsv to override document filename detection.',
  'draft accepts --document FILE to retain already marked choices while changing table format.',
  'Table filters apply to unmarked rows; every marked choice remains in the exported draft.',
  'targets uses --attention-only true|false (default true), --status all|attention|chosen|unchosen,',
  '--offset N and --limit N (1–1000). Draft tables include all fields by default.',
  'save also accepts --expected-preview SHA256 instead of --preview FILE.',
  'Use a new --new-plan name; the original source plan stays available for comparison.',
  'The first table row binds its exact source. Edit action, value and reason.',
  'keep preserves; clear removes an explicit choice; set writes the exact selected string.',
  'Reference catalogs use JSON string arrays; an empty limit selection retains the original limit.',
  'Changed choices require reasons at native preview/save. Drafts can retain unfinished edits.',
  'Existing output files are preserved. Complete bundles contain the original source and all native outputs.',
  '',
].join('\n');
const definitions = Object.fromEntries([
  'project', 'plan', 'new-plan', 'review', 'document', 'bundle', 'format', 'input-format', 'out',
  'kind', 'field', 'search', 'status', 'attention-only', 'offset', 'limit', 'expected-preview', 'preview',
  'results', 'from-unit', 'target-unit', 'reason', 'report',
].map(name => [name, { type: 'string' }]));
function required(values, name) { if (!values[name]) throw new Error('Provide --' + name); return values[name]; }
function number(value, fallback) {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error('Use a nonnegative integer.');
  return Number(value);
}
function boolean(value, fallback) {
  if (value === undefined) return fallback;
  if (!['true', 'false'].includes(value)) throw new Error('Use true or false.');
  return value === 'true';
}
function filters(values, draft = false) {
  return { kind: values.kind ?? '', field: values.field ?? '', search: values.search ?? '', status: values.status ?? 'all',
    attentionOnly: boolean(values['attention-only'], !draft),
    offset: number(values.offset, 0), limit: number(values.limit, 100) };
}
async function jsonFile(path, maximum = 64 * 1024 * 1024) {
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readBytes(resolve(path), maximum)));
}
async function documentFile(path, format) {
  format ??= extname(path).toLowerCase().slice(1);
  if (!['json', 'csv', 'tsv'].includes(format)) throw new Error('Use a .json, .csv or .tsv document, or --input-format.');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(await readBytes(resolve(path), 64 * 1024 * 1024));
  return format === 'csv' ? parseReviewSheetCsv(text) : format === 'tsv' ? parseReviewSheetTsv(text)
    : normalizeReviewSheetDocument(JSON.parse(text));
}
async function output(value, path) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n');
  if (!path) { process.stdout.write(bytes); return; }
  path = resolve(path); await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeBytes(path, bytes, { exclusive: true });
  process.stdout.write(JSON.stringify({ output: path, bytes: bytes.length }) + '\n');
}
export async function main(argv = process.argv.slice(2)) {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: { ...definitions, 'reported-limits-only': { type: 'boolean' }, help: { type: 'boolean' } } });
  const command = positionals[0] ?? 'help';
  if (values.help || command === 'help') return output(HELP);
  if (positionals.length !== 1) throw new Error('Choose one decision-review command.');
  const project = await openWaterQualityProject(resolve(required(values, 'project')));
  try {
    if (command === 'units') return output(concentrationSourceGroups(await project.readOpenWaters(required(values, 'plan'))), values.out);
    if (command === 'standardize') {
      if (Number(Boolean(values.results)) + Number(values['from-unit'] !== undefined) + Number(Boolean(values['reported-limits-only'])) !== 1)
        throw new Error('Select --results IDS_JSON, --from-unit EXACT_UNIT or --reported-limits-only.');
      const out = resolve(required(values, 'out')), reportOut = resolve(required(values, 'report'));
      if (out === reportOut) throw new Error('Choose distinct decision and complete-report output files.');
      const document = await documentFile(required(values, 'document'), values['input-format']);
      const groups = values.results ? null : concentrationSourceGroups(await project.readOpenWaters(document.sourcePlanId));
      const resultIds = values.results ? await jsonFile(values.results) : values['reported-limits-only'] ? groups.limitOnly.resultIds :
        groups.groups.find(row => row.unit === values['from-unit'])?.resultIds;
      const report = await prepareConcentrationChoices({project, document, resultIds,
        targetUnit:required(values, 'target-unit'), reason:required(values, 'reason')});
      await output(report, reportOut);
      if (report.state !== 'PREPARED') throw Object.assign(new Error('The complete report identifies selected quantities requiring a receiving choice.'), {code:'WQX_CONCENTRATION_REVIEW'});
      return output(report.document, out);
    }
    if (command === 'unit-report') {
      const record = await readReviewSheet({project, reviewId:required(values, 'review')});
      if (record.status !== 'COMPLETE') throw new Error('Complete the saved review before reopening its conversion report.');
      const plan = await project.readOpenWaters(record.document.sourcePlanId), resultPlan = await project.readOpenWaters(record.newPlanId);
      const report = concentrationReportForDocument(plan, record.document, {resultPlan}), format = values.format ?? 'json';
      if (!['json','csv'].includes(format)) throw new Error('Choose json or csv for the complete concentration report.');
      return output(format === 'csv' ? concentrationReportCsv(report) : report, values.out);
    }
    if (command === 'list') return output(await listReviewSheets({ project }), values.out);
    if (command === 'read') return output(await readReviewSheet({ project, reviewId: required(values, 'review') }), values.out);
    if (command === 'export') {
      const file = await exportReviewSheet({ project, reviewId: required(values, 'review'), format: required(values, 'format') });
      return output(file.bytes, required(values, 'out'));
    }
    if (command === 'receive') return output(await receiveReviewSheet({ project,
      bundle: await jsonFile(required(values, 'bundle'), 128 * 1024 * 1024) }), values.out);
    if (['source', 'targets', 'draft'].includes(command)) {
      const plan = await project.readOpenWaters(required(values, 'plan')), source = reviewSheetSource(plan);
      if (command === 'source') return output(source, values.out);
      if (command === 'targets') return output(listReviewSheetTargets(plan, filters(values)), values.out);
      const document = values.document ? await documentFile(values.document, values['input-format'])
        : { schema: REVIEW_SHEET_SCHEMA, sourcePlanId: source.sourcePlanId, sourcePlanSha256: source.sourcePlanSha256, decisions: [] };
      if (document.sourcePlanId !== source.sourcePlanId || document.sourcePlanSha256 !== source.sourcePlanSha256)
        throw new Error('The draft belongs to a different original source plan.');
      const format = values.format ?? 'json';
      if (!['json', 'csv', 'tsv'].includes(format)) throw new Error('Draft format is json, csv or tsv.');
      return output(format === 'json' ? document : (format === 'csv' ? reviewSheetCsv : reviewSheetTsv)(plan, document, filters(values, true)),
        required(values, 'out'));
    }
    if (command === 'preview' || command === 'save') {
      const document = await documentFile(required(values, 'document'), values['input-format']), newPlanId = required(values, 'new-plan');
      if (command === 'preview') return output(await previewReviewSheet({ project, document, newPlanId }), values.out);
      if (values.preview && values['expected-preview']) throw new Error('Choose --preview FILE or --expected-preview SHA256.');
      const expectedPreviewSha256 = values.preview ? (await jsonFile(values.preview)).previewSha256 : required(values, 'expected-preview');
      return output(await saveReviewSheet({ project, document, newPlanId,
        reviewId: required(values, 'review'), expectedPreviewSha256 }), values.out);
    }
    throw new Error('Unknown decision-review command. Run help for the complete command list.');
  } finally { await project.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => { process.stderr.write(JSON.stringify({ error: error.message, code: error.code ?? 'WQX_REVIEW_SHEET_CLI', status: error.status ?? 400 }) + '\n'); process.exitCode = 1; });
