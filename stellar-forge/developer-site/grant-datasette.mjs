// MIT. Receive the maintained Datasette installation into the original SCF reviewer.
const HEADING = '## Datasette editions and customer analysis';
const COASTAL = '## Coastal model-input installation\n';
const THREATS = '## 7. Threat response and useful-outcome measurement\n';
const PUBLIC = 'https://github.com/woahwhattheheck/public-commons-sprint-2026/';
const ROOT = 'stellar/scf-starforge-20261009/sf30-seller-sdk/';
const OPERATION = 'SCF-DATASETTE-SOURCE-EDITIONS-07476-20261012';
const PROGRAMME = 'https://tokenjunkielabs.slack.com/archives/C0BTB4SUCP9/p1791818956136219';
const WORK_START = '<!-- datasette-customer-analysis:start -->';
const WORK_END = '<!-- datasette-customer-analysis:end -->';
const clean = value => String(value).replaceAll('\r\n', '\n').trim() + '\n';
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const need = (condition, message) => { if (!condition) throw new Error(message); };

function section(markdown, required) {
  const text = clean(markdown), matches = [...text.matchAll(/^## Datasette editions and customer analysis\n/gm)];
  need(matches.length <= 1 && (!required || matches.length === 1), 'Select one complete Datasette editions and customer analysis subsection.');
  if (!matches.length) return null;
  const start = matches[0].index, contentStart = start + HEADING.length + 1;
  const following = text.slice(contentStart).search(/^#{1,2}\s/m);
  const end = following < 0 ? text.length : contentStart + following;
  return { text, start, end, content: clean(text.slice(start, end)) };
}

/** Keep the exact canonical subsection and every existing companion section. */
export function receiveDatasetteApplication(productAndFinanceMarkdown, manuscript) {
  const incoming = section(manuscript, true), existing = section(productAndFinanceMarkdown, false);
  const companion = clean(productAndFinanceMarkdown);
  if (existing) {
    return clean(companion.slice(0, existing.start) + incoming.content + '\n' + companion.slice(existing.end));
  }
  let at = companion.indexOf(COASTAL);
  if (at < 0) at = companion.indexOf(THREATS);
  need(at >= 0, 'Retain the original product and finance companion, with its coastal or threat-response section.');
  return clean(companion.slice(0, at) + incoming.content + '\n' + companion.slice(at));
}

/** Both heads are explicit because the original publisher and customer are separate source contributions. */
export function datasetteSourceSelection({ analysisCommit = null, publisherCommit = null } = {}) {
  if (analysisCommit === null && publisherCommit === null) return null;
  need(typeof analysisCommit === 'string' && /^[a-f0-9]{40}$/.test(analysisCommit),
    'Select the published Datasette customer source commit.');
  need(typeof publisherCommit === 'string' && /^[a-f0-9]{40}$/.test(publisherCommit),
    'Select the original Datasette source and publisher commit.');
  return { analysisCommit, publisherCommit };
}

function links(selection) {
  const customer = PUBLIC + 'blob/' + selection.analysisCommit + '/' + ROOT + 'datasette-analysis/';
  const publisher = PUBLIC + 'blob/' + selection.publisherCommit + '/' + ROOT + 'datasette/';
  return {
    installation: customer + 'INSTALLATION.md',
    operation: customer + 'README.md',
    sourceManifest: customer + 'examples/wri-geothermal-20261012/manifest.json',
    completeSource: PUBLIC + 'tree/' + selection.analysisCommit + '/' + ROOT + 'datasette-analysis/examples/wri-geothermal-20261012',
    originalReceiving: publisher + 'sources/wri-geothermal-20261012/README.md',
    sourceCli: publisher + 'cli.mjs',
    sourceWorkspace: PUBLIC + 'tree/' + selection.publisherCommit + '/' + ROOT + 'datasette/',
    programme: PROGRAMME,
  };
}

/** Add this source to the composer's existing cloned index; financial and other product fields stay owned there. */
export function addDatasetteGrantSources(index, selection, { canonicalManuscript } = {}) {
  need(index && index.schema === 'stellar-forge.grant-reviewer-source-index.v1' && Array.isArray(index.sources),
    'Use the original grant reviewer source index.');
  const selected = datasetteSourceSelection(selection);
  if (!selected) return [];
  const urls = links(selected);
  const entries = [
    {
      id: 'datasette-customer-analysis', kind: 'maintained-product',
      source_commit: selected.analysisCommit, repository: PUBLIC,
      path: ROOT + 'datasette-analysis/INSTALLATION.md', url: urls.installation,
      operating_guide: urls.operation, complete_source: urls.completeSource,
      original_source_manifest: urls.sourceManifest,
      operator_workflow: 'Receive the reviewed native edition or retained source pages; import into original Analysis; inspect all source rows; save queries, reports and workbooks; export a fresh editable workspace and reopen through original archive receiving.',
      installed_application: 'datasette-analysis', installed_command: 'starforge datasette-analysis',
      python_extra: 'workbooks', application_operation: OPERATION,
      native_receiving_operation: OPERATION, native_receiving_thread: PROGRAMME,
      paid_unit: 'The selected complete table or query edition and advertised analysis resources retain their reviewed source, licence, access and payment terms.',
      retained_source: {
        publisher: 'World Resources Institute', collection: 'Global Power Plant Database',
        selected_fuel: 'Geothermal', records: 189, countries: 22,
        physical_columns: 25, returned_positions: 26, additional_locator: 'rowid',
        disclosed_capacity_mw: '12563.55', records_without_capacity_data_year: 110,
        response_pages: 4, licence: 'Creative Commons Attribution 4.0',
        source_meaning: 'Capacity is a disclosed plant capacity measure. Historical capacity and generation years remain separate from retrieval time; rowid remains a capture locator.',
      },
    },
    {
      id: 'datasette-source-editions', kind: 'maintained-product',
      source_commit: selected.publisherCommit, repository: PUBLIC,
      path: ROOT + 'datasette/cli.mjs', url: urls.sourceCli,
      source_workspace: urls.sourceWorkspace, original_receiving_guide: urls.originalReceiving,
      operator_workflow: 'Review the original table or query, capture every page, select source columns and business key, retain the immutable edition, publish through the original dataset publisher and receive the complete original source history.',
      application_operation: OPERATION, customer_source_commit: selected.analysisCommit,
    },
  ];
  for (const entry of entries) {
    const matches = index.sources.reduce((found, item, i) => item.id === entry.id ? [...found, i] : found, []);
    need(matches.length <= 1, 'Keep one original grant source entry for ' + entry.id);
    if (matches.length) index.sources[matches[0]] = entry; else index.sources.push(entry);
  }
  index.narrative_source = {
    ...index.narrative_source,
    ...(canonicalManuscript ? { canonical_manuscript: canonicalManuscript } : {}),
    datasette_customer_commit: selected.analysisCommit,
    datasette_publisher_commit: selected.publisherCommit,
    datasette_application_operation: OPERATION,
  };
  const basis = ' The selected Datasette source editions and editable customer analysis use the same six funded packages.';
  need(index.product_and_finance && typeof index.product_and_finance.basis === 'string',
    'Retain the original product and finance source record.');
  if (!index.product_and_finance.basis.includes(basis.trim())) index.product_and_finance.basis += basis;
  return entries;
}

/** Present the installation inside the existing tenth section, using its original typography and links. */
export function receiveDatasetteExistingWork(html, selection) {
  const selected = datasetteSourceSelection(selection);
  if (!selected) return html;
  const urls = links(selected);
  const content = [
    WORK_START,
    '<h3 id="open-datasette-customer-analysis">Open Datasette customer Analysis</h3>',
    '<p>The retained WRI geothermal edition contains all 189 source records, 26 returned positions and 22 countries. Its disclosed capacity totals 12,563.55 MW. Original fields, source metadata and historical years accompany the four response pages.</p>',
    '<p>In the installed Datasette runtime, choose <strong>Python &amp; workbooks</strong> and retain the original Python installation with workbook support. Open <strong>Applications → Datasette customer Analysis</strong>, select that installation, the private Analysis directory and its operation ID, then use the existing review, save and start controls. The same workspace provides complete source rows, saved SQL, reports, an Excel workbook and editable archive receiving.</p>',
    '<p><a href="' + escape(urls.installation) + '" target="_blank" rel="noopener noreferrer">Install and open customer Analysis</a> · <a href="' + escape(urls.operation) + '" target="_blank" rel="noopener noreferrer">Operate and receive the editable workspace</a> · <a href="' + escape(urls.completeSource) + '" target="_blank" rel="noopener noreferrer">Complete original WRI source</a> · <a href="' + escape(urls.originalReceiving) + '" target="_blank" rel="noopener noreferrer">Original Datasette edition receiving</a></p>',
    WORK_END,
  ].join('\n') + '\n';
  const text = String(html), starts = text.split(WORK_START).length - 1, ends = text.split(WORK_END).length - 1;
  need(starts === ends && starts <= 1, 'Keep one complete Datasette installation inside the original existing-work section.');
  const existingWork = text.indexOf('<h2 id="open-the-existing-work">');
  need(existingWork >= 0, 'Retain the existing grant reader and its tenth existing-work section.');
  if (starts) {
    const at = text.indexOf(WORK_START), end = text.indexOf(WORK_END, at) + WORK_END.length;
    need(at > existingWork, 'Keep the Datasette installation inside the existing-work section.');
    return text.slice(0, at) + content + text.slice(end).replace(/^\n/, '');
  }
  const at = text.indexOf('<h3 id="continue-from-the-original-source">', existingWork);
  need(at > existingWork, 'Retain the original source continuation in the existing-work section.');
  return text.slice(0, at) + content + text.slice(at);
}
