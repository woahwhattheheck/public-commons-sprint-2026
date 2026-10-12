#!/usr/bin/env node
// MIT. Native recurring briefings use the original project transaction and retained reports.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readBytes, writeBytes } from '../../../sf88-operator-buyer-cli/node/store.mjs';
import { need } from '../model.mjs';
import { jsonBytes } from '../source.mjs';
import {
  saveFredBriefingTemplate, listFredBriefingTemplates, previewFredBriefingSuccessor,
  saveFredBriefingSuccessor, getFredBriefingSuccessor, downloadFredBriefingSuccessor,
} from '../project.mjs';

export const FRED_TEMPLATE_COMMANDS = Object.freeze([
  'template-save', 'templates', 'successor-preview', 'successor-save', 'successor', 'successor-file',
]);
export const FRED_TEMPLATE_USAGE = [
  'Recurring economic briefings',
  '',
  'starforge fred template-save --project ABS --id ID --expected-revision N --review SHA [--name TEXT --window FILE --previous-template ID]',
  'starforge fred templates --project ABS [--out FILE]',
  'starforge fred successor-preview --project ABS --template ID --capture SHA [--anchor DATE --baseline-review SHA --previous-successor ID --note FILE --out FILE]',
  'starforge fred successor-save --project ABS --id ID --expected-revision N --template ID --capture SHA --preview-id SHA [--anchor DATE --baseline-review SHA --previous-successor ID --note FILE --out FILE]',
  'starforge fred successor --project ABS --successor ID [--offset N --limit N --all-comparisons --out FILE]',
  'starforge fred successor-file --project ABS --successor ID --format html|csv|json --out FILE',
  '',
  'A window file uses {"months":12,"anchor":"latest_all","lagMonths":0}.',
  'Preview and save take the same original source, anchor, predecessor and note.',
  'Use the preview identity returned by successor-preview with successor-save.',
  'Use --offset N --limit N --all-comparisons with either preview or successor.',
  'Exports are create-only. Successors retain the original review and can use the existing publish command.',
].join('\n');
const PAGING = ['offset', 'limit', 'all-comparisons'];
const CHOICE = ['template', 'capture', 'anchor', 'baseline-review', 'previous-successor', 'note'];
const OPTIONS = Object.freeze({
  'template-save': ['project', 'id', 'expected-revision', 'review', 'name', 'window', 'previous-template', 'out'],
  templates: ['project', 'out'],
  'successor-preview': ['project', ...CHOICE, ...PAGING, 'out'],
  'successor-save': ['project', 'id', 'expected-revision', 'preview-id', ...CHOICE, ...PAGING, 'out'],
  successor: ['project', 'successor', ...PAGING, 'out'],
  'successor-file': ['project', 'successor', 'format', 'out'],
});
function parse(command, args) {
  const allowed = OPTIONS[command], flags = {};
  need(allowed, 'Choose a recurring briefing command; use fred --help.');
  for (let index = 0; index < args.length; index++) {
    const flag = args[index], name = flag.startsWith('--') ? flag.slice(2) : '';
    need(allowed.includes(name) && !Object.hasOwn(flags, name), 'Unknown or duplicate command option: ' + flag);
    if (name === 'all-comparisons') flags[name] = true;
    else {
      need(typeof args[index + 1] === 'string' && args[index + 1].length > 0 &&
        !args[index + 1].startsWith('--'), 'A value is required for ' + flag + '.');
      flags[name] = args[++index];
    }
  }
  need(flags.project, '--project selects the original economic project.');
  return flags;
}
function integer(value, label, fallback) {
  if (value === undefined && fallback !== undefined) return fallback;
  need(typeof value === 'string' && /^\d+$/.test(value) && Number.isSafeInteger(Number(value)),
    'Choose an integer ' + label + '.');
  return Number(value);
}
async function readText(file, limit) {
  return new TextDecoder('utf-8', { fatal: true }).decode(await readBytes(resolve(file), limit));
}
async function exportResult(value, destination) {
  if (!destination) return value;
  const path = resolve(destination), bytes = Buffer.isBuffer(value) ? value : jsonBytes(value);
  await writeBytes(path, bytes, { exclusive: true });
  return { destination: path, bytes: bytes.length };
}
/** Return the result without printing, for the installed original fred command router. */
export async function runFredTemplateCommand(args) {
  const [command, ...rest] = args, flags = parse(command, rest), directory = resolve(flags.project);
  const common = () => ({ directory, id: flags.id,
    expectedRevision: integer(flags['expected-revision'], 'project revision') });
  const paging = () => ({ offset: integer(flags.offset, 'comparison offset', 0),
    limit: integer(flags.limit, 'comparison page size', 100), changesOnly: flags['all-comparisons'] !== true });
  const choice = async () => {
    need(flags.template && flags.capture, '--template and --capture select the original calendar template and new source.');
    return { directory, templateId: flags.template, captureId: flags.capture,
      anchorDate: flags.anchor ?? null, baselineReviewId: flags['baseline-review'] ?? null,
      previousSuccessorId: flags['previous-successor'] ?? null,
      note: flags.note ? await readText(flags.note, 32000) : '', ...paging() };
  };
  let result;
  switch (command) {
    case 'template-save': {
      need(flags.review, '--review selects the original saved analyst briefing.');
      result = await saveFredBriefingTemplate({ ...common(), reviewId: flags.review, name: flags.name,
        window: flags.window ? JSON.parse(await readText(flags.window, 65536)) : {},
        previousTemplateId: flags['previous-template'] ?? null }); break;
    }
    case 'templates': result = await listFredBriefingTemplates({ directory }); break;
    case 'successor-preview': result = await previewFredBriefingSuccessor(await choice()); break;
    case 'successor-save':
      need(flags['preview-id'], '--preview-id selects the original reviewed successor preview.');
      result = await saveFredBriefingSuccessor({ ...common(), ...await choice(), previewId: flags['preview-id'] }); break;
    case 'successor':
      need(flags.successor, '--successor selects the original saved report successor.');
      result = await getFredBriefingSuccessor({ directory, successorId: flags.successor, ...paging() }); break;
    case 'successor-file': {
      need(flags.successor && flags.out, '--successor and --out select the saved report and create-only destination.');
      need(['html', 'csv', 'json'].includes(flags.format), 'Choose html, csv or json for the report comparison.');
      const file = await downloadFredBriefingSuccessor({ directory, successorId: flags.successor, format: flags.format });
      return { ...await exportResult(file.body, flags.out), contentType: file.contentType, sha256: file.sha256,
        successorId: flags.successor, ...(file.reportId ? { reportId: file.reportId } : {}) };
    }
  }
  return exportResult(result, flags.out);
}
export async function main(args = process.argv.slice(2)) {
  if (!args.length || args.includes('--help') || ['help', '-h'].includes(args[0])) {
    console.log(FRED_TEMPLATE_USAGE); return;
  }
  const result = await runFredTemplateCommand(args);
  console.log(JSON.stringify(result, null, 2));
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => {
    console.error(JSON.stringify({ code: error.code ?? 'FRED_TEMPLATE_COMMAND_FAILED', message: error.message }));
    process.exitCode = 1;
  });
