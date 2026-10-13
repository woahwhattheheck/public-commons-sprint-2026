// MIT. Operating-plan files use the same model as the Command finder browser.
import { randomUUID } from 'node:crypto';
import { readFile, stat, realpath, open, mkdtemp, link, rm } from 'node:fs/promises';
import { resolve, basename, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadCommandCatalog } from './load.mjs';
import { saveExport, saveTextExport } from './write-json.mjs';
import { inspectOperatingPlan, createOperatingPlan, createOperatingStep, snapshotRegistration,
  operatingPlanDraft, operatingPlanRevision, saveOperatingPlanRevision,
  createOperatingFile, addOperatingFile, removeOperatingFile, operatingFileBytes, operatingFileSummary, OPERATING_FILE_MAX_BYTES, addOperatingStep, compareOperatingPlan,
  summarizeOperatingPlan, receiveOperatingPlan, forkOperatingPlan,
  renderOperatingPlanMarkdown, renderOperatingPlanHTML } from './operating-plan.mjs';

export const OPERATING_PLAN_HELP = [
  'Customer operating plans',
  '',
  'starforge discover plan catalog [--source-root DIRECTORY] [--selection PRODUCT] [--out NEW.json]',
  'starforge discover plan create --title TITLE --out NEW.json [--step command:NAME ...]',
  'starforge discover plan show --file PLAN.json [--revision N] [--format json|markdown|html] [--out NEW]',
  'starforge discover plan draft --file PLAN.json [--revision N] [--out NEW.json]',
  'starforge discover plan edit --file PLAN.json --draft DRAFT.json --out NEW.json',
  'starforge discover plan add --file PLAN.json --step command:NAME [--step ID ...] --out NEW.json',
  'starforge discover plan compare --file PLAN.json [--revision N] [--out NEW.json]',
  'starforge discover plan receive --file INCOMING.json [--existing CURRENT.json] --out NEW.json',
  'starforge discover plan copy --file PLAN.json [--title TITLE] [--id ID] --out NEW.json',
  'starforge discover plan attach --file PLAN.json --step-id STEP --attachment OUTPUT [--attachment OUTPUT ...] [--note TEXT] --out NEW.json',
  'starforge discover plan files --file PLAN.json [--revision N] [--step-id STEP] [--out NEW.json]',
  'starforge discover plan extract --file PLAN.json --step-id STEP --attachment-id ID [--revision N] --out NEW',
  'starforge discover plan remove-file --file PLAN.json --step-id STEP --attachment-id ID --out NEW.json',
  '',
  'Create fields: --id, --title, --customer, --purpose, --period, --owner, --receiving, --notes.',
  'Catalog reads: --source-root DIRECTORY, --selection PRODUCT.',
  'A --step value is an exact Command finder registration ID. Repeated selections are separate task steps.',
  'Create, edit, add, receive, copy, attach, extract and remove-file require a new output filename. Existing files are preserved.',
  'The browser is available at /operating-plan.html when starforge discover serve is running.',
].join('\n');
const ACTIONS = ['catalog', 'create', 'show', 'draft', 'edit', 'add', 'compare', 'receive', 'copy', 'attach', 'files', 'extract', 'remove-file'];
const COMMON = ['file', 'out'];
const FLAGS = {
  catalog: ['source-root', 'selection', 'out'],
  create: ['id', 'title', 'customer', 'purpose', 'period', 'owner', 'receiving', 'notes', 'step', 'source-root', 'selection', 'out'],
  show: [...COMMON, 'revision', 'format'],
  draft: [...COMMON, 'revision'],
  edit: [...COMMON, 'draft'],
  add: [...COMMON, 'step', 'source-root', 'selection'],
  compare: [...COMMON, 'revision', 'source-root', 'selection'],
  receive: [...COMMON, 'existing'],
  copy: [...COMMON, 'title', 'id'],
  attach: [...COMMON, 'step-id', 'attachment', 'note', 'media-type'],
  files: [...COMMON, 'step-id', 'revision'],
  extract: [...COMMON, 'step-id', 'attachment-id', 'revision'],
  'remove-file': [...COMMON, 'step-id', 'attachment-id'],
};
export function parseOperatingPlanArguments(args) {
  const words = [...args];
  if (!words.length || words.includes('--help') || words.includes('-h')) return { action: 'help', options: {} };
  const action = words.shift();
  if (!ACTIONS.includes(action)) throw new TypeError('Unknown operating-plan action: ' + action);
  const options = {}, steps = [], attachments = [];
  while (words.length) {
    const flag = words.shift();
    if (!flag.startsWith('--') || !FLAGS[action].includes(flag.slice(2)))
      throw new TypeError('Unknown option for plan ' + action + ': ' + flag);
    const key = flag.slice(2);
    if (!words.length || words[0].startsWith('--')) throw new TypeError('A value is required for ' + flag);
    const value = words.shift();
    if (key === 'step') steps.push(value);
    else if (key === 'attachment') attachments.push(value);
    else {
      if (Object.hasOwn(options, key)) throw new TypeError('Repeated option: ' + flag);
      options[key] = value;
    }
  }
  if (steps.length) options.steps = steps;
  if (attachments.length) options.attachments = attachments;
  if (!['create', 'catalog'].includes(action) && !options.file) throw new TypeError('--file is required.');
  if (['create', 'edit', 'add', 'receive', 'copy', 'attach', 'extract', 'remove-file'].includes(action) && !options.out)
    throw new TypeError('--out must name a new output file.');
  if (action === 'create' && !options.title) throw new TypeError('--title is required.');
  if (action === 'edit' && !options.draft) throw new TypeError('--draft is required.');
  if (action === 'add' && !steps.length) throw new TypeError('Select at least one --step registration.');
  if (['attach', 'extract', 'remove-file'].includes(action) && !options['step-id'])
    throw new TypeError('--step-id must name an existing operating step.');
  if (['extract', 'remove-file'].includes(action) && !options['attachment-id'])
    throw new TypeError('--attachment-id must name an existing step file.');
  if (action === 'attach' && !attachments.length) throw new TypeError('Select at least one --attachment file.');
  if (options.revision !== undefined) {
    options.revision = Number(options.revision);
    if (!Number.isSafeInteger(options.revision) || options.revision < 1)
      throw new TypeError('--revision must be a positive integer.');
  }
  if (options.format && !['json', 'markdown', 'html'].includes(options.format))
    throw new TypeError('--format must be json, markdown or html.');
  return { action, options };
}
async function readJSON(filename) {
  const target = resolve(filename), info = await stat(target);
  if (!info.isFile() || info.size > 32 * 1024 * 1024) throw new TypeError('Use a regular JSON file up to 32 MiB.');
  const bytes = await readFile(target);
  if (bytes.length > 32 * 1024 * 1024) throw new TypeError('The JSON document exceeds 32 MiB.');
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}
async function currentCatalog(options) {
  return loadCommandCatalog({ sourceRoot: options['source-root'], selection: options.selection });
}
export async function mainOperatingPlan(args = process.argv.slice(2), { log = console.log } = {}) {
  const { action, options } = parseOperatingPlanArguments(args);
  if (action === 'help') { log(OPERATING_PLAN_HELP); return; }
  const original = options.file ? inspectOperatingPlan(await readJSON(options.file)) : null;
  const reportOptions = { revision: options.revision };
  let value, plainText = null;
  if (action === 'catalog') value = await currentCatalog(options);
  else if (action === 'create') {
    const source = options.steps?.length ? await currentCatalog(options) : null;
    const steps = (options.steps ?? []).map(itemId => createOperatingStep({
      id: randomUUID(), selection: snapshotRegistration(source, itemId),
    }));
    value = createOperatingPlan({ id: options.id ?? randomUUID(), title: options.title,
      customer: options.customer, purpose: options.purpose, period: options.period,
      owner: options.owner, receiving: options.receiving, notes: options.notes, steps });
  } else if (action === 'show') {
    value = options.revision === undefined ? original : { plan: summarizeOperatingPlan(original, reportOptions),
      draft: operatingPlanDraft(original, options.revision) };
    if (options.format === 'markdown') plainText = renderOperatingPlanMarkdown(original, reportOptions);
    if (options.format === 'html') plainText = renderOperatingPlanHTML(original, reportOptions);
  } else if (action === 'draft') value = operatingPlanDraft(original, options.revision);
  else if (action === 'edit') value = saveOperatingPlanRevision(original, await readJSON(options.draft));
  else if (action === 'add') {
    const source = await currentCatalog(options); let draft = operatingPlanDraft(original);
    for (const itemId of options.steps) draft = addOperatingStep(draft, createOperatingStep({
      id: randomUUID(), selection: snapshotRegistration(source, itemId),
    }));
    value = saveOperatingPlanRevision(original, draft);
  } else if (action === 'compare') value = compareOperatingPlan(original, await currentCatalog(options), reportOptions);
  else if (action === 'receive') {
    const existing = options.existing ? inspectOperatingPlan(await readJSON(options.existing)) : null;
    const received = receiveOperatingPlan(original, existing); value = received.plan;
  } else if (action === 'copy') value = forkOperatingPlan(original, { id: options.id ?? randomUUID(), title: options.title });
  if (action === 'attach') {
    let draft = operatingPlanDraft(original);
    for (const filename of options.attachments) {
      const target = resolve(filename), info = await stat(target);
      if (!info.isFile() || info.size > OPERATING_FILE_MAX_BYTES)
        throw new TypeError('Choose a complete regular output file within 24 MiB.');
      const content = await readFile(target);
      draft = addOperatingFile(draft, options['step-id'], createOperatingFile({
        id: randomUUID(), name: basename(filename), bytes: content,
        mediaType: options['media-type'], note: options.note,
      }));
    }
    value = saveOperatingPlanRevision(original, draft);
  } else if (action === 'remove-file') {
    value = saveOperatingPlanRevision(original, removeOperatingFile(operatingPlanDraft(original),
      options['step-id'], options['attachment-id']));
  } else if (action === 'files' || action === 'extract') {
    const selected = operatingPlanRevision(original, options.revision);
    const selectedSteps = options['step-id'] ? selected.steps.filter(step => step.id === options['step-id']) : selected.steps;
    if (options['step-id'] && !selectedSteps.length) throw new TypeError('The selected operating step is unavailable.');
    value = { planId: original.id, revision: selected.revision,
      steps: selectedSteps.map(step => ({ id: step.id, title: step.title, files: (step.files ?? []).map(operatingFileSummary) })) };
    if (action === 'extract') {
      const file = selectedSteps[0].files?.find(item => item.id === options['attachment-id']);
      if (!file) throw new TypeError('The selected output file is unavailable in this saved revision.');
      const target = resolve(options.out), content = operatingFileBytes(file);
      const temporary = await mkdtemp(join(dirname(target), '.operating-file-'));
      const prepared = join(temporary, 'complete-output');
      try {
        const output = await open(prepared, 'wx', 0o600);
        try { await output.writeFile(content); await output.sync(); }
        finally { await output.close(); }
        await link(prepared, target);
      } finally { await rm(temporary, { recursive: true, force: true }); }
      const result = { file: target, action, planId: original.id, revision: selected.revision, attachment: operatingFileSummary(file) };
      log(JSON.stringify(result)); return result;
    }
  }
  if (value?.schema === 'stellar-forge.operating-plan.v1' &&
    Buffer.byteLength(JSON.stringify(value, null, 2) + '\n', 'utf8') > 32 * 1024 * 1024)
    throw new TypeError('The complete saved plan and file history exceed the 32 MiB receiving limit. Retain the current plan and choose a smaller complete output.');
  if (options.out) {
    if (plainText !== null) await saveTextExport(options.out, plainText);
    else await saveExport(options.out, value);
    log(JSON.stringify({ file: resolve(options.out), action, planId: value?.id ?? original?.id ?? null,
      revision: value?.revisions?.length ?? options.revision ?? original?.revisions?.length ?? null }));
  } else log(plainText ?? JSON.stringify(value, null, 2));
  return value;
}
if (process.argv[1] && await realpath(resolve(process.argv[1])).then(
  entry => pathToFileURL(entry).href === import.meta.url, () => false))
  mainOperatingPlan().catch(error => { console.error((error.code ? error.code + ': ' : '') + error.message); process.exitCode = 1; });
