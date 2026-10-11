// MIT. Offline template/configuration compiler. Never contacts a procurement platform.
import { readFile, mkdir, writeFile, mkdtemp, rename, rm, lstat } from 'node:fs/promises';
import { dirname, basename, resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const nonempty = v => typeof v === 'string' && v.trim().length > 0;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const help = `Usage:
  node template-library.mjs inspect
  node template-library.mjs render --context example-context.json --out /new/output/directory

Outputs seven review-copy Markdown documents, a configuration map and a handover.
No network, platform API, signatures, bidder submission, scheduler or AI service.
Output is create-only. Supplied text is copied literally, not evaluated.
Missing input remains visible as an unresolved field rather than fabricated content.`;

async function jsonFile(path, maxBytes = 1024 * 1024) {
  const info = await lstat(path);
  if (!info.isFile() || info.size > maxBytes) throw new TypeError('Input must be a regular JSON file within the size limit');
  const bytes = await readFile(path);
  if (bytes.length > maxBytes) throw new RangeError('Input exceeds size limit');
  return { value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), sha256: digest(bytes) };
}
function literal(value) {
  // Keep paragraphs but prevent user data from turning into active Markdown links/HTML.
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('\\', '\\\\').replace(/([`*_{}\[\]()#+!|])/g, '\\$1');
}
export async function loadKit() {
  const loaded = await jsonFile(join(here, 'template-kit.json'));
  const kit = loaded.value;
  if (kit.schema !== 'tjl.procurement-template-kit.v1' || !Array.isArray(kit.templates) || kit.templates.length !== 7)
    throw new TypeError('Expected the seven-template configuration kit');
  const ids = new Set();
  for (const t of kit.templates) {
    if (!isObject(t) || !/^[a-z][a-z0-9-]{1,70}$/.test(t.id) || ids.has(t.id) || !nonempty(t.title) ||
        !Array.isArray(t.required_fields) || !Array.isArray(t.sections) || !Array.isArray(t.approved_clause_keys) ||
        !Array.isArray(t.attachment_prompts) || !Array.isArray(t.proposed_workflow)) throw new TypeError('Invalid template blueprint');
    if (t.required_fields.some(x => !/^[a-z][a-z0-9_]{0,80}$/.test(x)) ||
        t.approved_clause_keys.some(x => !/^[a-z][a-z0-9_]{0,80}$/.test(x)) ||
        t.sections.some(x => !isObject(x) || !nonempty(x.heading) || !t.required_fields.includes(x.field)))
      throw new TypeError('Invalid template fields');
    ids.add(t.id);
  }
  return { kit, sha256: loaded.sha256 };
}
function contextValue(value, kit) {
  if (!isObject(value) || value.schema !== 'tjl.procurement-template-context.v1' ||
      !['operator', 'demonstration'].includes(value.mode) || !isObject(value.fields) || !isObject(value.clauses) ||
      Object.keys(value).some(k => !['schema', 'mode', 'fields', 'clauses'].includes(k)))
    throw new TypeError('Invalid template context');
  const fields = new Set(kit.templates.flatMap(t => t.required_fields));
  const clauses = new Set(kit.templates.flatMap(t => t.approved_clause_keys));
  for (const [key, text] of Object.entries(value.fields)) {
    if (!fields.has(key) || typeof text !== 'string' || text.length > 50000) throw new TypeError(`Invalid field: ${key}`);
  }
  for (const [key, clause] of Object.entries(value.clauses)) {
    if (!clauses.has(key) || !isObject(clause) || Object.keys(clause).some(k => !['text', 'source_reference', 'approved_by'].includes(k)) ||
        ['text', 'source_reference', 'approved_by'].some(k => typeof clause[k] !== 'string' || clause[k].length > 50000))
      throw new TypeError(`Invalid clause entry: ${key}`);
  }
  return value;
}
export async function renderLibrary({ contextPath, outPath } = {}) {
  const { kit, sha256: kitSha } = await loadKit();
  const loaded = await jsonFile(resolve(contextPath));
  const context = contextValue(loaded.value, kit);
  const destination = resolve(outPath);
  const parent = dirname(destination);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  // Reserve the final directory first: a second writer cannot replace an earlier kit.
  await mkdir(destination, { mode: 0o700 });
  const staging = await mkdtemp(join(parent, `.${basename(destination)}-`));
  let published = false;
  try {
    const map = { schema: 'tjl.procurement-configuration-map.v1', mode: context.mode,
      status: 'DRAFT_CONFIGURATION_COPY_NOT_A_BID', source: kit.source,
      kitSha256: kitSha, contextSha256: loaded.sha256, templates: [] };
    for (const t of kit.templates) {
      const missing = [];
      const field = key => {
        if (!nonempty(context.fields[key])) { missing.push(`field:${key}`); return `[TO COMPLETE: ${key}]`; }
        return literal(context.fields[key]);
      };
      const lines = [`# ${t.title}`, '', '**DRAFT CONFIGURATION COPY — NOT A BID OR AUTHORIZED PUBLICATION**', '',
        context.mode === 'demonstration' ? '**FICTIONAL DEMONSTRATION INPUTS. Do not submit or treat as approved agency content.**' : '**Operator input. Review against agency-approved text and the selected platform before use.**', '',
        t.purpose, '', '## Identification', '',
        `Agency: ${field('agency')}`, '', `Project: ${field('project_title')}`, '',
        `Solicitation: ${field('solicitation_id')}`, '', `Procurement contact: ${field('procurement_contact')}`, '',
        '## Submission or handling instructions', '', field('approved_submission_instructions'), ''];
      for (const section of t.sections) lines.push(`## ${section.heading}`, '', field(section.field), '');
      lines.push('## Supplied clause library', '');
      for (const key of t.approved_clause_keys) {
        const clause = context.clauses[key];
        lines.push(`### ${key.replaceAll('_', ' ')}`, '');
        if (!clause || !nonempty(clause.text) || !nonempty(clause.source_reference) || !nonempty(clause.approved_by)) {
          missing.push(`clause:${key}`); lines.push(`[TO COMPLETE: agency-selected clause ${key}, source reference and approval attribution]`, '');
        } else lines.push(literal(clause.text), '', `Source supplied by operator: ${literal(clause.source_reference)}`, '',
          `Approval attribution supplied by operator: ${literal(clause.approved_by)}`, '');
      }
      lines.push('## Attachment prompts', '', ...t.attachment_prompts.map(x => `- ${x}`), '',
        '## Configuration handover', '', 'The following workflow is a proposed operator mapping, not an implemented platform automation.', '',
        ...t.proposed_workflow.map((x, i) => `${i + 1}. ${x}`), '',
        'Keep protected attachments separate from public release copies. Use actual platform permissions and approved publication instructions.', '');
      const bytes = lines.join('\n');
      const filename = t.id + '.md';
      await writeFile(join(staging, filename), bytes, { flag: 'wx', mode: 0o600 });
      map.templates.push({ id: t.id, title: t.title, file: filename, sha256: digest(bytes),
        fields: t.required_fields, clauses: t.approved_clause_keys, unresolved: [...new Set(missing)],
        proposed_workflow: t.proposed_workflow, attachments: t.attachment_prompts,
        platform_configuration: 'NOT_PERFORMED' });
    }
    map.unresolvedCount = map.templates.reduce((n, t) => n + t.unresolved.length, 0);
    await writeFile(join(staging, 'configuration-map.json'), JSON.stringify(map, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    await writeFile(join(staging, 'HANDOVER.md'), `# Configuration handover\n\nMode: ${context.mode}. Seven review copies; ${map.unresolvedCount} unresolved field/clause references.\n\n` +
      'The seven families are a proposed selection, not a district-mandated list. Confirm the actual selection and approval roles, then transfer reviewed text into the selected platform using its supported operator interface. No API or import compatibility is assumed.\n\n' +
      'A zero unresolved count means text fields are present, not that legal language, authority, dates, security or platform conformance have been verified. There are no signatures, submission actions or paid services in this tool.\n\n' +
      'For each platform template, preserve the actual template ID, responsible operator, source clause version, permission mapping, attachment handling and a rendered review copy. Show the two operators how to prepare, amend, archive and publish through their approved roles.\n', { flag: 'wx', mode: 0o600 });
    // The reserved directory is empty and owned by this call; rename replaces only it.
    await rename(staging, destination); published = true;
    return { created: destination, templates: map.templates.length, unresolved: map.unresolvedCount, mode: context.mode };
  } finally {
    if (!published) { await rm(staging, { recursive: true, force: true }); await rm(destination, { recursive: true, force: true }); }
  }
}
export async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === '--help') { console.log(help); return; }
  if (args.length === 1 && args[0] === 'inspect') {
    const { kit, sha256 } = await loadKit();
    console.log(JSON.stringify({ schema: kit.schema, status: kit.status, sha256, basis: kit.basis,
      templates: kit.templates.map(t => ({ id: t.id, title: t.title, fields: t.required_fields, clauses: t.approved_clause_keys })) }, null, 2)); return;
  }
  if (args.length !== 5 || args[0] !== 'render') throw new TypeError('Use --help for commands');
  const options = {};
  for (let i = 1; i < args.length; i += 2) {
    if (!['--context', '--out'].includes(args[i]) || Object.hasOwn(options, args[i]) || !args[i + 1]) throw new TypeError('Invalid options');
    options[args[i]] = args[i + 1];
  }
  if (!options['--context'] || !options['--out']) throw new TypeError('Both --context and --out are required');
  console.log(JSON.stringify(await renderLibrary({ contextPath: options['--context'], outPath: options['--out'] })));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => { console.error(`Template library: ${error.message}`); process.exitCode = 1; });
