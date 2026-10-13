// MIT. Compose the maintained SCF application into the existing reviewer page.
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { applyGrantDeliveryPlan } from './grant-delivery-plan.mjs';
import { resolve, dirname, join, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { composeGrantEntry } from './grant-entry.mjs';
import { attachGrantSubmission } from './grant-submission.mjs';
import { attachGrantReviewRounds } from './grant-review-round.mjs';
import { attachGrantCompanion } from './grant-companion.mjs';
import { attachSavedProjects } from './saved-projects.mjs';
import { projectPublicGrantMarkdown, projectPublicGrantHtml, projectPublicGrantSourceIndex } from './grant-publication-source.mjs';
import { receiveFinancialApplication, attachFinancialSources } from './grant-financial-operations.mjs';
import { projectGrantMarkdown, receiveGrantCustomerSections, projectGrantSourceIndex, receiveGrantCustomerSources } from './grant-customers.mjs';
import { receiveDatasetteApplication, datasetteSourceSelection, addDatasetteGrantSources, receiveDatasetteExistingWork } from './grant-datasette.mjs';
import { validateGrantProductRegistrations, receiveGrantProductSources } from './grant-product-sources.mjs';

const DEFAULT_DIRECTORY = join(dirname(fileURLToPath(import.meta.url)), 'dist');
const CANONICAL_MANUSCRIPT = 'https://tokenjunkielabs.slack.com/docs/T0BRETUB5TK/F0C86PRE5NF';
const OPERATION = 'SCF-FRED-ECONOMIC-CUSTOMER-APPLICATION-20261012';
const FRED_ROOT = 'stellar/scf-starforge-20261009/sf30-seller-sdk/fred/';
const MERCHANT_ROOT = 'https://github.com/woahwhattheheck/tjlabs-stellar-merchant-workspace/';
const ANSWERS = [
  'Project and requested outcome',
  'Customer problem, need and adoption',
  'Why Stellar and what we contribute',
  'Defined architecture and operating behavior',
  'Working product and demonstrated results',
  'Three funded tranches and six priced deliverables',
  'Threat response and outcome measurement',
  'Delivery capacity, payment timing and sustainability',
  'Applicant, experience and submission',
];
// Accepted headings keep the original answer identities and links across retained source editions.
const ANSWER_HEADINGS = new Map([
  ...ANSWERS.map(title => [title, title]),
  ["Customer problem, first payer and adoption", "Customer problem, need and adoption"],
  ["Why Stellar and how the product differs", "Why Stellar and what we contribute"],
  ["Defined architecture and customer operation", "Defined architecture and operating behavior"],
  ["Working foundation and demonstrated customer results", "Working product and demonstrated results"],
  ["Threat response and measurable acceptance", "Threat response and outcome measurement"],
  ["Capacity, payment timing and sustainability", "Delivery capacity, payment timing and sustainability"],
]);
const ARTICLE = '<article class="application-prose" aria-label="Complete Build application">';
const EXISTING_WORK = '<h2 id="open-the-existing-work">Open the existing work</h2>';
const ECONOMIC_HEADING = '## Recurring economic-report installation';
const COASTAL_HEADING = '## Coastal model-input installation';
const COASTAL_OPERATION = 'SCF-COASTAL-COMMISSIONING-APPLICATION-018A-20261012';
const digest = value => createHash('sha256').update(value).digest('hex');
const gitBlob = value => createHash('sha1').update('blob ' + Buffer.byteLength(value) + '\0').update(value).digest('hex');
const bytes = value => Buffer.byteLength(value);
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const clean = value => String(value).replaceAll('\r\n', '\n').trim() + '\n';
function need(value, message) { if (!value) throw new Error(message); }

function inline(value) {
  const saved = [];
  const retain = html => '\u0001' + (saved.push(html) - 1) + '\u0002';
  let rendered = String(value).replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (_, label, href) => {
    need(/^(https:\/\/|\.{0,2}\/|#)/.test(href), 'Use a source link with an explicit HTTPS or relative route: ' + href);
    return retain('<a href="' + escape(href) + '">' + inline(label) + '</a>');
  });
  rendered = rendered.replace(/\x60([^\x60\n]+)\x60/g, (_, code) => retain('<code>' + escape(code) + '</code>'));
  rendered = escape(rendered).replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  rendered = rendered.replace(/\u0001(\d+)\u0002/g, (_, index) => saved[Number(index)]);
  return rendered;
}
function cells(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map(value => value.trim().replaceAll('\\|', '|'));
}
function headingId(value) {
  const selected = ANSWER_HEADINGS.get(value) ?? value;
  return selected.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-');
}

/** Render the prose, headings and tables used by the maintained application. */
export function renderGrantMarkdown(markdown) {
  const lines = clean(markdown).split('\n'), output = [];
  for (let i = 0; i < lines.length;) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(line.trim())) { output.push('<hr>'); i++; continue; }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      output.push('<h' + heading[1].length + ' id="' + headingId(heading[2]) + '">' + inline(heading[2]) + '</h' + heading[1].length + '>');
      i++; continue;
    }
    if (line.trim().startsWith('|')) {
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(cells(lines[i++]));
      need(rows.length >= 2 && rows[1].every(cell => /^:?-{3,}:?$/.test(cell)), 'Keep a header and separator in each application table.');
      const width = rows[0].length;
      need(width > 0 && rows.every(row => row.length === width), 'Keep all application table columns complete.');
      output.push('<div class="table-scroll" role="region" aria-label="' + escape(rows[0].map(cell => cell.replace(/[*\x60]/g, '')).join(' / ')) + '" tabindex="0"><table><thead><tr>' + rows[0].map(cell => '<th scope="col">' + inline(cell) + '</th>').join('') + '</tr></thead><tbody>' +
        rows.slice(2).map(row => '<tr>' + row.map((cell, column) => column === 0 ? '<th scope="row">' + inline(cell) + '</th>' : '<td>' + inline(cell) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>');
      continue;
    }
    const ordered = line.match(/^(\d+)\.\s+(.+)$/);
    if (ordered) {
      const items = [];
      while (i < lines.length) {
        const item = lines[i].match(/^(\d+)\.\s+(.+)$/);
        if (!item) break;
        const number = Number(item[1]);
        need(Number.isSafeInteger(number) && number >= 0, 'Use a complete ordered step with a valid number.');
        items.push('<li value="' + number + '">' + inline(item[2]) + '</li>');
        i++;
      }
      output.push('<ol>' + items.join('') + '</ol>');
      continue;
    }
    need(!/^(?:\x60{3}|~{3}|>|[-*+]\s|\d+\.\s)/.test(line), 'The reviewer answer uses a prose or table construct that requires an explicit renderer update: ' + line.slice(0,80));
    const paragraph = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,6})\s/.test(lines[i]) && !lines[i].trim().startsWith('|') && !/^(?:\x60{3}|~{3}|>|[-*+]\s|\d+\.\s)/.test(lines[i])) paragraph.push(lines[i++]);
    output.push('<p>' + inline(paragraph.join(' ')) + '</p>');
  }
  return output.join('\n') + '\n';
}

/** Extract the original front answer from a freshly acquired canonical manuscript. */
export function extractReviewerApplication(manuscript) {
  const value = clean(manuscript);
  const start = value.indexOf('# Reviewer application\n');
  const end = value.indexOf('# Detailed application and source material\n', start + 1);
  need(start >= 0 && end > start, 'Select the complete canonical manuscript with its reviewer and detailed-application headings.');
  return clean(value.slice(start, end));
}

/** Replace this product subsection while preserving every other companion section. */
export function receiveEconomicApplication(productAndFinanceMarkdown, manuscript) {
  const source = clean(manuscript), start = source.indexOf(ECONOMIC_HEADING + '\n');
  need(start >= 0, 'The selected canonical manuscript needs the recurring economic-report installation subsection.');
  const after = source.slice(start + ECONOMIC_HEADING.length + 1);
  const next = after.search(/^#{1,2}\s/m);
  const economic = clean(source.slice(start, next < 0 ? source.length : start + ECONOMIC_HEADING.length + 1 + next));
  const companion = clean(productAndFinanceMarkdown), current = companion.indexOf(ECONOMIC_HEADING + '\n');
  if (current >= 0) {
    const tail = companion.slice(current + ECONOMIC_HEADING.length + 1), following = tail.search(/^#{1,2}\s/m);
    return clean(companion.slice(0, current) + economic + '\n' +
      (following < 0 ? '' : companion.slice(current + ECONOMIC_HEADING.length + 1 + following)));
  }
  const place = companion.indexOf('## 7. Threat response and useful-outcome measurement\n');
  need(place >= 0, 'Retain the existing product-and-finance companion and its threat-response section.');
  return clean(companion.slice(0, place) + economic + '\n' + companion.slice(place));
}

/** Retain the complete selected coastal installation in the same companion. */
export function receiveCoastalApplication(productAndFinanceMarkdown, manuscript) {
  const source = clean(manuscript), starts = [...source.matchAll(/^## Coastal model-input installation\n/gm)];
  need(starts.length === 1, 'Select one complete coastal model-input installation subsection from the canonical manuscript.');
  const start = starts[0].index, after = source.slice(start + COASTAL_HEADING.length + 1);
  const next = after.search(/^#{1,2}\s/m);
  const coastal = clean(source.slice(start, next < 0 ? source.length : start + COASTAL_HEADING.length + 1 + next));
  const companion = clean(productAndFinanceMarkdown);
  const existing = [...companion.matchAll(/^## Coastal model-input installation\n/gm)];
  need(existing.length <= 1, 'Keep one coastal installation in the original companion.');
  if (existing.length) {
    const current = existing[0].index, tail = companion.slice(current + COASTAL_HEADING.length + 1);
    const following = tail.search(/^#{1,2}\s/m);
    return clean(companion.slice(0, current) + coastal + '\n' +
      (following < 0 ? '' : companion.slice(current + COASTAL_HEADING.length + 1 + following)));
  }
  const place = companion.indexOf('## 7. Threat response and useful-outcome measurement\n');
  need(place >= 0, 'Retain the original companion and its threat-response section.');
  return clean(companion.slice(0, place) + coastal + '\n' + companion.slice(place));
}

/** Keep the selected answer wording beside its original stable section link. */
function receiveApplicationNavigation(templateHtml, headings) {
  const startTag = '<nav aria-label="Application sections"><ol>';
  const begin = templateHtml.indexOf(startTag), end = templateHtml.indexOf('</nav>', begin);
  need(begin >= 0 && end > begin, 'Retain the existing application section navigation.');
  let navigation = templateHtml.slice(begin, end);
  for (const title of headings) {
    const id = headingId(title);
    const links = [...navigation.matchAll(new RegExp('<a href="#' + id + '">[\\s\\S]*?</a>', 'g'))];
    need(links.length === 1, 'Retain one original section link for the application answer: ' + title);
    navigation = navigation.replace(links[0][0], '<a href="#' + id + '">' + inline(title) + '</a>');
  }
  return templateHtml.slice(0, begin) + navigation + templateHtml.slice(end);
}

/** Pure composition; the caller chooses whether and where the result is written. */
export function composeGrantApplication({
  applicationMarkdown, productAndFinanceMarkdown, templateHtml, sourceIndex,
  fredCommit, coopsCommit = null, financeCommit = null, datasetteCommit = null, datasettePublisherCommit = null, canonicalManuscript = CANONICAL_MANUSCRIPT,
  productRegistrations = [],
}) {
  need(typeof fredCommit === 'string' && /^[a-f0-9]{40}$/.test(fredCommit), 'Select the actual merged economic product commit.');
  need(coopsCommit === null || (typeof coopsCommit === 'string' && /^[a-f0-9]{40}$/.test(coopsCommit)), 'Select the actual merged coastal product commit.');
  const application = projectPublicGrantMarkdown(projectGrantMarkdown(applyGrantDeliveryPlan(applicationMarkdown), { application: true }));
  const companion = projectPublicGrantMarkdown(projectGrantMarkdown(productAndFinanceMarkdown));
  const datasetteSelection = datasetteSourceSelection({ analysisCommit: datasetteCommit, publisherCommit: datasettePublisherCommit });
  if (datasetteSelection) need(companion.includes('## Datasette editions and customer analysis\n'), 'Retain the selected complete Datasette installation with its source commits.');
  if (coopsCommit) need(companion.includes(COASTAL_HEADING + '\n'), 'Retain the selected complete coastal installation with its source commit.');
  need(!application.includes('{{') && !companion.includes('{{'), 'Resolve all application source placeholders before composition.');
  const headings = [...application.matchAll(/^## (.+)$/gm)].map(match => match[1]);
  need(JSON.stringify(headings.map(title => ANSWER_HEADINGS.get(title))) === JSON.stringify(ANSWERS), 'Retain the complete nine application answer identities in their existing order, using an accepted source heading.');
  need(application.includes('38,000') && application.includes('400') && application.includes('150'), 'Retain the selected grant amount, delivery hours and duration.');
  const articleAt = templateHtml.indexOf(ARTICLE), existingAt = templateHtml.indexOf(EXISTING_WORK, articleAt);
  need(articleAt >= 0 && existingAt > articleAt, 'Use the complete existing grant.html shell and existing-work section.');
  const answer = application.slice(application.indexOf('## '));
  const renderedAnswer = renderGrantMarkdown(answer).replace(
    /href="\.\/(product-and-finance\.md|source-index\.json)(?=["#?])/g,
    'href="./grant-data/$1'
  );
  let html = receiveDatasetteExistingWork(templateHtml.slice(0, articleAt) + ARTICLE + renderedAnswer + templateHtml.slice(existingAt), datasetteSelection || {});
  html = receiveApplicationNavigation(html, headings);
  let index = JSON.parse(JSON.stringify(sourceIndex));
  need(index.schema === 'stellar-forge.grant-reviewer-source-index.v1', 'Use the original application source-index schema.');
  index.application = { ...index.application, bytes: bytes(application), sha256: digest(application), git_blob: gitBlob(application), canonical_manuscript: canonicalManuscript };
  index.product_and_finance = { ...index.product_and_finance, bytes: bytes(companion), sha256: digest(companion), git_blob: gitBlob(companion),
    basis: 'Complete maintained product and finance companion. Accepted customer installations share the existing six funded packages and original cost assumptions.' };
  const source = {
    id: 'economic-recurring', kind: 'maintained-product',
    source_commit: fredCommit, repository: MERCHANT_ROOT,
    path: FRED_ROOT + 'TEMPLATES.md',
    url: MERCHANT_ROOT + 'blob/' + fredCommit + '/' + FRED_ROOT + 'TEMPLATES.md',
    operator_workflow: 'Retained source, analyst review, calendar template, successor comparison, saved report, existing merchant publication, complete project receiving.',
    paid_unit: 'One selected advertised briefing.html or briefing.json resource; additional advertised files and observation pages retain their own requests and prices.',
    application_operation: OPERATION,
  };
  const previous = index.sources.findIndex(item => item.id === source.id);
  if (previous >= 0) index.sources[previous] = source; else index.sources.push(source);
  index.narrative_source = { ...index.narrative_source, canonical_manuscript: canonicalManuscript,
    current_application_sha256: digest(application), economic_product_commit: fredCommit, economic_application_operation: OPERATION };
  let coastalSource = null;
  if (coopsCommit) {
    coastalSource = {
      id: 'coastal-model-input', kind: 'maintained-product',
      source_commit: coopsCommit, repository: MERCHANT_ROOT,
      path: 'products/coops/OPERATING.md',
      url: MERCHANT_ROOT + 'blob/' + coopsCommit + '/products/coops/OPERATING.md',
      study_guide: MERCHANT_ROOT + 'blob/' + coopsCommit + '/stellar/scf-starforge-20261009/sf30-seller-sdk/coops/STUDIES.md',
      receiving_guide: MERCHANT_ROOT + 'blob/' + coopsCommit + '/stellar/scf-starforge-20261009/sf30-seller-sdk/coops/python/RECEIVING.md',
      operator_workflow: 'Original station responses, reviewed editions and study mapping, complete release, returned-file comparison and explicit receiving, native queries and Python offline receiving.',
      paid_unit: 'One selected advertised model-input resource, such as the complete released study CSV; other files and query pages retain their own advertised access and request terms.',
      application_operation: COASTAL_OPERATION,
      native_receiving_operation: 'COOPS-LA-JOLLA-STUDY-RECEIVING-018A-20261012-01',
      native_receiving_status: 'Registered original operating run in progress.',
    };
    const coastalAt = index.sources.findIndex(item => item.id === coastalSource.id);
    if (coastalAt >= 0) index.sources[coastalAt] = coastalSource; else index.sources.push(coastalSource);
    index.narrative_source.coastal_product_commit = coopsCommit;
    index.narrative_source.coastal_application_operation = COASTAL_OPERATION;
  }
  const datasetteSources = addDatasetteGrantSources(index, datasetteSelection || {}, { canonicalManuscript });
  const selectedFinanceCommit = financeCommit || index.narrative_source?.financial_product_commit || null;
  let financialSources = null, financialOperation = null;
  if (selectedFinanceCommit) {
    const attached = attachFinancialSources(index, { financeCommit: selectedFinanceCommit, productAndFinanceMarkdown: companion });
    index = attached.sourceIndex;
    financialSources = attached.financialSources;
    financialOperation = attached.financialOperation;
  }
  // Register complete canonical source identities before projecting reader links.
  receiveGrantCustomerSources(index, productAndFinanceMarkdown);
  receiveGrantProductSources(index, productAndFinanceMarkdown, productRegistrations);
  index = projectGrantSourceIndex(index);
  const reviewerEntry = composeGrantEntry(html);
  const submission = attachGrantSubmission({ templateHtml: reviewerEntry.html, sourceIndex: index });
  const reviewRound = attachGrantReviewRounds(submission);
  const companionReader = attachGrantCompanion(reviewRound);
  html = projectPublicGrantHtml(attachSavedProjects(companionReader.templateHtml));
  index = projectPublicGrantSourceIndex(companionReader.sourceIndex);
  const indexText = JSON.stringify(index, null, 2) + '\n';
  const files = {
    'grant.html': html,
    'grant-data/application.md': application,
    'grant-data/product-and-finance.md': companion,
    'grant-data/source-index.json': indexText,
  };
  return { files, sourcePins: Object.fromEntries(Object.entries(files).map(([path, body]) => ['/' + path, gitBlob(body)])),
    application: index.application, productAndFinance: index.product_and_finance, economicSource: source, coastalSource, financialSources, financialOperation, datasetteSources, reviewerEntry: reviewerEntry.entry, submissionWorkspace: index.submission_workspace, submissionReviewRound: index.submission_review_round, companionReader: index.companion_reader };
}

function argumentsFor(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i];
    need(['--directory', '--manuscript', '--fred-commit', '--coops-commit', '--finance-commit', '--datasette-commit', '--datasette-publisher-commit', '--source-pins-output', '--product-registrations-directory', '--product-registration'].includes(name) && i + 1 < argv.length,
      'Use --directory <existing dist>, --manuscript <canonical.md>, --fred-commit <merged sha>, optional --coops-commit <merged sha>, --finance-commit <merged sha>, paired --datasette-commit <customer sha> / --datasette-publisher-commit <publisher sha> and --source-pins-output <file>, optional --product-registrations-directory <directory>, and repeatable --product-registration <file.json>.');
    if (name === '--product-registration') {
      (options[name] ||= []).push(argv[++i]);
      continue;
    }
    need(!Object.hasOwn(options, name), 'Use each composition option once: ' + name);
    options[name] = argv[++i];
  }
  return options;
}

/** Read the complete selected declaration files; product authors own one file each. */
async function readProductRegistrations(options) {
  const sourceDirectory = dirname(fileURLToPath(import.meta.url));
  const defaultDirectory = join(sourceDirectory, 'grant-products');
  const directory = resolve(options['--product-registrations-directory'] || defaultDirectory);
  const entries = await readdir(directory, { withFileTypes: true });
  const files = entries.filter(entry => entry.isFile() && entry.name.endsWith('.json'))
    .map(entry => join(directory, entry.name)).sort();
  files.push(...(options['--product-registration'] || []).map(file => resolve(file)));
  const selected = [...new Set(files)];
  const registrations = await Promise.all(selected.map(async file => {
    const body = await readFile(file, 'utf8');
    let document;
    try { document = JSON.parse(body); }
    catch (error) { throw new Error('Read the complete product declaration ' + basename(file) + ': ' + error.message); }
    need(document && typeof document === 'object' && !Array.isArray(document), 'Use a product declaration object in ' + basename(file) + '.');
    return { ...document, definition: {
      path: dirname(file) === resolve(defaultDirectory) ? 'grant-products/' + basename(file) : basename(file),
      bytes: bytes(body), sha256: digest(body), git_blob: gitBlob(body),
    } };
  }));
  return validateGrantProductRegistrations(registrations);
}

export async function runGrantComposition(argv = process.argv.slice(2)) {
  const options = argumentsFor(argv), directory = resolve(options['--directory'] || DEFAULT_DIRECTORY);
  const [applicationMarkdown, productAndFinanceMarkdown, templateHtml, indexText, composerSource, customerSource, a2aSource, deliverySource, reviewerEntrySource, companionSource, productRegistrySource, productRegistryCoreSource, productRegistrations] = await Promise.all([
    readFile(join(directory, 'grant-data/application.md'), 'utf8'),
    readFile(join(directory, 'grant-data/product-and-finance.md'), 'utf8'),
    readFile(join(directory, 'grant.html'), 'utf8'),
    readFile(join(directory, 'grant-data/source-index.json'), 'utf8'),
    readFile(fileURLToPath(import.meta.url), 'utf8'),
    readFile(new URL('./grant-customers.mjs', import.meta.url), 'utf8'),
    readFile(new URL('./grant-a2a.mjs', import.meta.url), 'utf8'),
    readFile(new URL('./grant-delivery-plan.mjs', import.meta.url), 'utf8'),
    readFile(new URL('./grant-entry.mjs', import.meta.url), 'utf8'),
    readFile(new URL('./grant-companion.mjs', import.meta.url), 'utf8'),
    readFile(new URL('./grant-product-sources.mjs', import.meta.url), 'utf8'),
    readFile(new URL('./dist/grant-product-sources-core.mjs', import.meta.url), 'utf8'),
    readProductRegistrations(options),
  ]);
  const index = JSON.parse(indexText);
  const manuscript = options['--manuscript'] ? await readFile(resolve(options['--manuscript']), 'utf8') : null;
  // The section receiver also projects links. Capture original source identities
  // from the full manuscript before receiving its accepted customer sections.
  if (manuscript) {
    receiveGrantCustomerSources(index, manuscript);
    receiveGrantProductSources(index, manuscript, productRegistrations);
  }
  const coopsCommit = options['--coops-commit'] || index.narrative_source?.coastal_product_commit || null;
  const financeCommit = options['--finance-commit'] || index.narrative_source?.financial_product_commit || null;
  const datasetteCommit = options['--datasette-commit'] || index.narrative_source?.datasette_customer_commit || null;
  const datasettePublisherCommit = options['--datasette-publisher-commit'] || index.narrative_source?.datasette_publisher_commit || null;
  const datasetteSelection = datasetteSourceSelection({ analysisCommit: datasetteCommit, publisherCommit: datasettePublisherCommit });
  let companion = manuscript ? receiveEconomicApplication(productAndFinanceMarkdown, manuscript) : productAndFinanceMarkdown;
  if (manuscript && coopsCommit) companion = receiveCoastalApplication(companion, manuscript);
  if (manuscript && datasetteSelection) companion = receiveDatasetteApplication(companion, manuscript);
  if (manuscript && financeCommit) companion = receiveFinancialApplication(companion, manuscript);
  if (manuscript) companion = receiveGrantCustomerSections(companion, manuscript);
  const selectedApplication = manuscript ? extractReviewerApplication(manuscript) : applicationMarkdown;
  index.narrative_source = { ...index.narrative_source, composition: {
    ...index.narrative_source?.composition,
    renderer_git_blob: gitBlob(composerSource), projector_git_blob: gitBlob(customerSource), a2a_projector_git_blob: gitBlob(a2aSource), delivery_plan_git_blob: gitBlob(deliverySource),
    reviewer_entry_git_blob: gitBlob(reviewerEntrySource), companion_projector_git_blob: gitBlob(companionSource),
    product_registration_projector_git_blob: gitBlob(productRegistrySource),
    product_registration_core_git_blob: gitBlob(productRegistryCoreSource),
    ...(manuscript ? { canonical_front_sha256: digest(selectedApplication), canonical_front_bytes: bytes(selectedApplication) } : {}),
  } };
  const result = composeGrantApplication({
    applicationMarkdown: selectedApplication,
    productAndFinanceMarkdown: companion, templateHtml, sourceIndex: index,
    fredCommit: options['--fred-commit'] || index.narrative_source?.economic_product_commit,
    coopsCommit, financeCommit, datasetteCommit, datasettePublisherCommit, productRegistrations,
  });
  for (const [path, body] of Object.entries(result.files)) await writeFile(join(directory, path), body);
  if (options['--source-pins-output']) await writeFile(resolve(options['--source-pins-output']), JSON.stringify(result.sourcePins, null, 2) + '\n');
  return { sourcePins: result.sourcePins, application: result.application, productAndFinance: result.productAndFinance, economicSource: result.economicSource, coastalSource: result.coastalSource, financialSources: result.financialSources, financialOperation: result.financialOperation, datasetteSources: result.datasetteSources, reviewerEntry: result.reviewerEntry, submissionWorkspace: result.submissionWorkspace, submissionReviewRound: result.submissionReviewRound, companionReader: result.companionReader };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runGrantComposition().then(result => process.stdout.write(JSON.stringify(result, null, 2) + '\n')).catch(error => {
    process.stderr.write(error.message + '\n'); process.exitCode = 1;
  });
}
