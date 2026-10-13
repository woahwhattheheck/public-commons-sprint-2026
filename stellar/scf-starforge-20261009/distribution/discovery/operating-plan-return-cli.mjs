// MIT. Complete return reviews use the same source model as the browser.
import { randomUUID } from 'node:crypto';
import { readFile, stat, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { saveExport, saveTextExport } from './write-json.mjs';
import { createOperatingPlanReturn, inspectOperatingPlanReturn, compareOperatingPlanReturn,
  reviseOperatingPlanReturn, decideOperatingPlanReturn, applyOperatingPlanReturn,
  renderOperatingPlanReturnHTML, OPERATING_RETURN_MAX_BYTES, OPERATING_RETURN_PLAN_MAX_BYTES } from './operating-plan-return.mjs';

import { inspectOperatingReturnWorking, renderOperatingReturnWorkbook, OPERATING_RETURN_WORKBOOK_ASSETS,
  OPERATING_RETURN_WORKING_MAX_BYTES } from './operating-plan-return-workbook.mjs';

export const OPERATING_RETURN_HELP = [
  'Returned customer procedure review', '',
  'starforge discover plan-return prepare --current CURRENT.json --incoming RETURNED.json --out NEW.json',
  '  [--id ID] [--reviewer NAME] [--notes TEXT | --notes-file UTF8.txt]',
  'starforge discover plan-return show --file REVIEW.json [--format json|html] [--out NEW]',
  'starforge discover plan-return details --file REVIEW.json --out NEW.json',
  '  [--reviewer NAME] [--notes TEXT | --notes-file UTF8.txt]',
  'starforge discover plan-return decide --file REVIEW.json --key CHANGE_KEY --take CHOICE --out NEW.json',
  '  [--value-file JSON_VALUE.json] [--note TEXT | --note-file UTF8.txt]',
  'starforge discover plan-return complete --file REVIEW.json --current CURRENT.json --out NEW_REVIEW.json',
  '  [--saved-at UTC_ISO_TIME]',
  'starforge discover plan-return export --file REVIEW.json --format review|plan|html|workbook --out NEW', '',
  'Choices: current, incoming, base, custom, automatic.',
  'show lists exact change keys, complete original/current/returned values, unresolved choices and proposed work.',
  'A custom choice reads a JSON value from --value-file; a text value is a JSON string.',
  'automatic removes a recorded choice and returns that change to its original proposal.',
  'Every selected step ID must appear once in a custom final order, including [] when no steps remain.',
  'complete retains both whole histories, reviewer choices and the exact original-format result in one file.',
  'export --format plan extracts that completed result for the original Operating plans or GrantOps receiver.',
  'export --format workbook accepts a complete review or Working review JSON, including unfinished choice text.',
  'The one HTML file contains the original editor and complete source; it opens offline and exports the complete return.',
  'A complete review is immutable; prepare a new review to change later work.',
  'Every --out is a new create-only file. Existing files and the supplied --current remain intact.',
  'JSON plans are limited to 32 MiB each; complete review JSON is limited to 128 MiB.',
  'The browser is /operating-plan-return.html on the original Command finder listener.',
].join('\n');
const ACTIONS = ['prepare', 'show', 'details', 'decide', 'complete', 'export'];
const FLAGS = {
  prepare: ['current', 'incoming', 'out', 'id', 'reviewer', 'notes', 'notes-file'],
  show: ['file', 'format', 'out'],
  details: ['file', 'out', 'reviewer', 'notes', 'notes-file'],
  decide: ['file', 'key', 'take', 'value-file', 'note', 'note-file', 'out'],
  complete: ['file', 'current', 'saved-at', 'out'],
  export: ['file', 'format', 'out'],
};
export function parseOperatingReturnArguments(args) {
  const words = [...args];
  if (!words.length || words.includes('--help') || words.includes('-h')) return { action: 'help', options: {} };
  const action = words.shift(), options = {};
  if (!ACTIONS.includes(action)) throw new TypeError('Unknown returned-procedure action: ' + action);
  while (words.length) {
    const flag = words.shift();
    if (!flag.startsWith('--') || !FLAGS[action].includes(flag.slice(2)))
      throw new TypeError('Unknown option for plan-return ' + action + ': ' + flag);
    const key = flag.slice(2);
    if (Object.hasOwn(options, key)) throw new TypeError('Repeated option: ' + flag);
    if (!words.length || words[0].startsWith('--')) throw new TypeError('A value is required for ' + flag);
    options[key] = words.shift();
  }
  const required = action === 'prepare' ? ['current', 'incoming', 'out'] :
    action === 'show' ? ['file'] : action === 'complete' ? ['file', 'current', 'out'] :
    action === 'decide' ? ['file', 'key', 'take', 'out'] :
    action === 'export' ? ['file', 'format', 'out'] : ['file', 'out'];
  for (const key of required) if (!options[key]) throw new TypeError('--' + key + ' is required.');
  for (const key of ['note', 'notes']) if (options[key] !== undefined && options[key + '-file'] !== undefined)
    throw new TypeError('Choose --' + key + ' or --' + key + '-file.');
  if (action === 'details' && !['reviewer', 'notes', 'notes-file'].some(key => options[key] !== undefined))
    throw new TypeError('Provide the reviewing operator or review notes.');
  if (action === 'show' && options.format && !['json', 'html'].includes(options.format))
    throw new TypeError('show --format must be json or html.');
  if (action === 'export' && !['review', 'plan', 'html', 'workbook'].includes(options.format))
    throw new TypeError('export --format must be review, plan, html or workbook.');
  if (action === 'decide') {
    if (!['current', 'incoming', 'base', 'custom', 'automatic'].includes(options.take))
      throw new TypeError('--take must be current, incoming, base, custom or automatic.');
    if ((options.take === 'custom') !== (options['value-file'] !== undefined))
      throw new TypeError('Only a custom choice requires --value-file containing its complete JSON value.');
    if (options.take === 'automatic' && (options.note !== undefined || options['note-file'] !== undefined))
      throw new TypeError('automatic removes the choice and its note; omit --note and --note-file.');
  }
  return { action, options };
}
async function readText(filename, maximum) {
  const target = filename instanceof URL ? filename : resolve(filename), info = await stat(target);
  if (!info.isFile() || info.size > maximum) throw new TypeError('Use a regular file within the stated size limit: ' + target);
  const bytes = await readFile(target);
  if (bytes.length > maximum) throw new TypeError('The file grew beyond its size limit: ' + target);
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}
async function readJSON(filename, maximum) { return JSON.parse(await readText(filename, maximum)); }
async function detail(options, key) {
  return options[key + '-file'] !== undefined ? readText(options[key + '-file'], 128 * 1024) : options[key];
}
export async function mainOperatingReturn(args = process.argv.slice(2), { log = console.log } = {}) {
  const { action, options } = parseOperatingReturnArguments(args);
  if (action === 'help') { log(OPERATING_RETURN_HELP); return; }
  const workbookInput = action === 'export' && options.format === 'workbook'
    ? inspectOperatingReturnWorking(await readJSON(options.file, OPERATING_RETURN_WORKING_MAX_BYTES)) : null;
  const original = workbookInput?.review ??
    (options.file ? inspectOperatingPlanReturn(await readJSON(options.file, OPERATING_RETURN_MAX_BYTES)) : null);
  let value, outputText, completion = null;
  if (action === 'prepare') {
    const current = await readJSON(options.current, OPERATING_RETURN_PLAN_MAX_BYTES);
    const incoming = await readJSON(options.incoming, OPERATING_RETURN_PLAN_MAX_BYTES);
    value = createOperatingPlanReturn(current, incoming, { id: options.id ?? randomUUID(),
      reviewer: options.reviewer ?? '', notes: await detail(options, 'notes') ?? '' });
  } else if (action === 'show') {
    value = compareOperatingPlanReturn(original);
    if (options.format === 'html') outputText = renderOperatingPlanReturnHTML(original);
  } else if (action === 'details') {
    const updates = {};
    if (options.reviewer !== undefined) updates.reviewer = options.reviewer;
    const notes = await detail(options, 'notes');
    if (notes !== undefined) updates.notes = notes;
    value = reviseOperatingPlanReturn(original, updates);
  } else if (action === 'decide') {
    const choice = options.take === 'automatic' ? null : {
      take: options.take, note: await detail(options, 'note') ?? '',
      ...(options.take === 'custom' ? { value: await readJSON(options['value-file'], OPERATING_RETURN_PLAN_MAX_BYTES) } : {}),
    };
    value = decideOperatingPlanReturn(original, options.key, choice);
  } else if (action === 'complete') {
    completion = applyOperatingPlanReturn(original, {
      current: await readJSON(options.current, OPERATING_RETURN_PLAN_MAX_BYTES),
      ...(options['saved-at'] ? { savedAt: options['saved-at'] } : {}),
    });
    value = completion.review;
  } else {
    value = original;
    if (options.format === 'plan') {
      if (!original.completion) throw new TypeError('Complete this review before exporting its reviewed operating plan.');
      value = original.completion.plan;
    }
    if (options.format === 'html') outputText = renderOperatingPlanReturnHTML(original);
    if (options.format === 'workbook') {
      const sources = Object.fromEntries(await Promise.all(OPERATING_RETURN_WORKBOOK_ASSETS.map(async asset => {
        const body = await readText(new URL(asset.file, import.meta.url), 4 * 1024 * 1024);
        return [asset.key, body];
      })));
      outputText = renderOperatingReturnWorkbook(workbookInput, sources);
    }
  }
  if (options.out) {
    if (outputText !== undefined) await saveTextExport(options.out, outputText);
    else await saveExport(options.out, value);
    const review = value?.schema === original?.schema ? value : original;
    log(JSON.stringify({ action, file: resolve(options.out), reviewId: value?.reviewId ?? review?.id ?? value?.id,
      ...(completion ? { resultRevision: completion.review.completion.plan.revisions.length,
        currentRevision: completion.plan.revisions.length, alreadyPresent: completion.alreadyPresent,
        addedRevisions: completion.addedRevisions } : {}) }));
  } else log(outputText ?? JSON.stringify(value, null, 2));
  return value;
}
if (process.argv[1] && await realpath(resolve(process.argv[1])).then(
  entry => pathToFileURL(entry).href === import.meta.url, () => false))
  mainOperatingReturn().catch(error => {
    console.error((error.code ? error.code + ': ' : '') + error.message); process.exitCode = 1;
  });
