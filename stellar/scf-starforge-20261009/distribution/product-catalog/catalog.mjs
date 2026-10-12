// MIT. Browser-safe views over the original committed product catalogue and reviews.
const CATALOG_SCHEMA = 'stellar-forge.product-catalog.v1';
const SUMMARY_SCHEMA = 'stellar-forge.product-source-summary.v1';
const COMPARISON_SCHEMA = 'stellar-forge.product-comparison.v1';
const PLAN_SCHEMA = 'stellar-forge.product-installation-plan.v1';
const REVIEW_SCHEMA = 'stellar-forge.runtime-source-build-review.v1';
const DISTRIBUTION = 'stellar/scf-starforge-20261009/distribution/';
const OID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const SHA256 = /^[a-f0-9]{64}$/;
const ID = /^[a-z][a-z0-9-]{0,63}$/;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const copy = value => JSON.parse(JSON.stringify(value));
const order = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const unique = values => [...new Set(values)].sort(order);
const requireValue = (condition, code, message) => {
  if (!condition) throw Object.assign(new TypeError(message), { code });
};
const fold = value => String(value ?? '').normalize('NFKC').toLowerCase();

function text(value, label) {
  requireValue(typeof value === 'string' && value.length > 0 && !/[\u0000-\u001f\u007f]/.test(value),
    'PRODUCT_CATALOG_TEXT_REQUIRED', 'Expected ' + label + '.');
  return value;
}
function sourceReview(value) {
  requireValue(plain(value) && value.schema === REVIEW_SCHEMA && OID.test(value.sourceCommit ?? '') &&
    ID.test(value.selection ?? '') && typeof value.repository === 'string' && value.repository.length > 0 &&
    typeof value.title === 'string' && plain(value.commands) && plain(value.exports),
  'PRODUCT_SOURCE_REVIEW_REQUIRED', 'Use the original committed product description or saved source review.');
  return value;
}
function pairs(map) {
  requireValue(plain(map), 'PRODUCT_SOURCE_MAP_REQUIRED', 'Expected original product registrations.');
  return Object.keys(map).sort(order).map(name => ({ name, entry: copy(map[name]) }));
}
function strings(value, label) {
  requireValue(Array.isArray(value) && value.every(item => typeof item === 'string'),
    'PRODUCT_SOURCE_LIST_REQUIRED', 'Expected original ' + label + '.');
  return unique(value);
}
function dependencies(peers = {}) {
  requireValue(plain(peers), 'PRODUCT_RUNTIME_DECLARATIONS_REQUIRED', 'Expected original runtime declarations.');
  return Object.keys(peers).sort(order).map(name => {
    const entry = peers[name], value = typeof entry === 'string' ? { version: entry, probe: name } : entry;
    requireValue(plain(value) && typeof value.version === 'string',
      'PRODUCT_RUNTIME_DECLARATION_INVALID', 'Invalid original runtime dependency: ' + name);
    return { name, version: value.version, probe: value.probe ?? name,
      ...(value.native === undefined ? {} : { native: value.native }) };
  });
}
function runtimeRequirements(review) {
  const original = review.runtimeRequirements;
  requireValue(original === undefined || plain(original),
    'PRODUCT_RUNTIME_REQUIREMENTS_INVALID', 'Expected original runtime requirement maps.');
  const peers = original?.featurePeers ?? {}, manifests = original?.runtimePackageManifests ?? {};
  const resolvedManifests = original?.resolvedManifestPeers ?? {};
  requireValue(plain(peers) && plain(manifests) && plain(resolvedManifests), 'PRODUCT_RUNTIME_REQUIREMENTS_INVALID',
    'Expected original feature declarations and package manifest paths.');
  const names = unique([...(review.features ?? []), ...(original?.featureNames ?? []),
    ...Object.keys(peers), ...Object.keys(manifests)]);
  return {
    described: original !== undefined,
    native: dependencies(original?.nativePeers ?? {}),
    features: names.map(name => ({
      name,
      manifestPath: manifests[name] ?? null,
      // Runtime package manifests take precedence over direct peers. Committed
      // product inspection supplies their original dependency bodies explicitly.
      dependencies: manifests[name] ? dependencies(resolvedManifests[name] ?? {}) : dependencies(peers[name] ?? {}),
      ...(manifests[name] && peers[name] ? { declaredPeers: copy(peers[name]) } : {}),
    })),
  };
}

/** Search only original id/title/description text; retain invalid recipe rows by default. */
export function searchProductCatalog(catalog, { query = '', availableOnly = false } = {}) {
  requireValue(plain(catalog) && Array.isArray(catalog.products) && OID.test(catalog.sourceCommit ?? '') &&
    typeof catalog.repository === 'string',
  'PRODUCT_CATALOG_REQUIRED', 'Load the original committed product catalogue first.');
  requireValue(typeof query === 'string' && query.length <= 4096 && typeof availableOnly === 'boolean',
    'PRODUCT_CATALOG_QUERY_INVALID', 'Use a text query and an availableOnly boolean.');
  requireValue(catalog.products.every(product => plain(product) && typeof product.title === 'string'),
    'PRODUCT_CATALOG_ROW_INVALID', 'Expected original product catalogue rows.');
  const normalized = fold(query.trim());
  const tokens = [...normalized.matchAll(/"([^"]+)"|([^\s"]+)/g)].map(match => match[1] ?? match[2]);
  const found = [];
  for (let index = 0; index < catalog.products.length; index++) {
    const product = catalog.products[index];
    if (availableOnly && product.available !== true) continue;
    const id = fold(product.id), title = fold(product.title), description = fold(product.description);
    if (!tokens.every(token => id.includes(token) || title.includes(token) || description.includes(token))) continue;
    const score = (normalized && id === normalized ? 1000 : 0) +
      tokens.reduce((sum, token) => sum + (id === token ? 40 : id.includes(token) ? 12 : 0) +
        (title === token ? 30 : title.startsWith(token) ? 10 : title.includes(token) ? 5 : 0) +
        (description.includes(token) ? 1 : 0), 0);
    found.push({ product, index, score });
  }
  if (tokens.length) found.sort((a, b) => b.score - a.score ||
    order(fold(a.product.title), fold(b.product.title)) ||
    order(a.product.id ?? a.product.path ?? '', b.product.id ?? b.product.path ?? '') || a.index - b.index);
  const products = found.map(item => item.product);
  return { ...catalog, schema: CATALOG_SCHEMA, query: query.trim(),
    total: catalog.products.length, totalProducts: catalog.products.length,
    available: catalog.products.filter(product => product.available === true).length,
    matched: products.length, matchedProducts: products.length, products };
}

/** Normalize a view without changing the original review or its saved identity. */
export function productSourceSummary(value) {
  const review = sourceReview(value), runtime = runtimeRequirements(review);
  const commands = pairs(review.commands), exports = pairs(review.exports);
  const applications = strings(review.applications ?? [], 'Applications names');
  const merchantProviders = strings(review.merchantProviders ?? [], 'merchant provider names');
  const components = strings(review.components ?? [], 'component paths');
  const contributions = copy(review.contributions ?? []).sort((a, b) => order(a.id, b.id));
  const sourceInputs = copy([...(review.distributionInputs ?? []), ...(review.supportingInputs ?? [])]);
  return {
    schema: SUMMARY_SCHEMA, id: review.selection, title: review.title,
    description: review.description ?? '', repository: review.repository, sourceCommit: review.sourceCommit,
    packageName: review.packageName, packageVersion: review.packageVersion,
    readme: review.product?.readme ?? null,
    commands, exports, applications, merchantProviders, components, contributions, runtime, sourceInputs,
    counts: { commands: commands.length, exports: exports.length, applications: applications.length,
      merchantProviders: merchantProviders.length, components: components.length, features: runtime.features.length,
      nativeDependencies: runtime.native.length },
  };
}

function stable(value) {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (plain(value)) return '{' + Object.keys(value).sort(order)
    .map(key => JSON.stringify(key) + ':' + stable(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
const SECTION_DEFINITIONS = [
  ['commands', 'Commands', product => product.commands.map(({ name, entry }) => [name, entry])],
  ['exports', 'Package exports', product => product.exports.map(({ name, entry }) => [name, entry])],
  ['applications', 'Applications', product => product.applications.map(name => [name, true])],
  ['merchantProviders', 'Merchant providers', product => product.merchantProviders.map(name => [name, true])],
  ['native', 'Native package declarations', product => product.runtime.native.map(dependency => [dependency.name,
    { version: dependency.version, probe: dependency.probe, ...(dependency.native ? { native: dependency.native } : {}) }])],
  ['features', 'Runtime features', product => product.runtime.features.map(feature => [feature.name,
    { manifestPath: feature.manifestPath, dependencies: feature.dependencies,
      ...(feature.declaredPeers ? { declaredPeers: feature.declaredPeers } : {}) }])],
  ['components', 'Source components', product => product.components.map(name => [name, true])],
];

/** Compare product choices from one immutable catalogue, including changed registration targets. */
export function compareProductSources(reviews) {
  requireValue(Array.isArray(reviews) && reviews.length >= 2, 'PRODUCT_COMPARISON_SELECTIONS_REQUIRED',
    'Choose at least two original product descriptions to compare.');
  const products = reviews.map(productSourceSummary), first = products[0];
  requireValue(products.every(product => product.repository === first.repository &&
    product.sourceCommit === first.sourceCommit), 'PRODUCT_COMPARISON_SOURCE_MISMATCH',
  'Compare products from the same repository and source commit.');
  requireValue(new Set(products.map(product => product.id)).size === products.length,
    'PRODUCT_COMPARISON_DUPLICATE', 'Choose each product once.');
  const sections = SECTION_DEFINITIONS.map(([id, title, entries]) => {
    const maps = products.map(product => new Map(entries(product)));
    const names = unique(maps.flatMap(map => [...map.keys()]));
    const rows = names.map(name => {
      const values = maps.map(map => map.has(name) ? copy(map.get(name)) : null);
      return { name, values, shared: values.every(value => value !== null) &&
        values.every(value => stable(value) === stable(values[0])) };
    });
    return { id, title, rows };
  });
  return { schema: COMPARISON_SCHEMA, repository: first.repository, sourceCommit: first.sourceCommit,
    selections: products.map(product => product.id), products, sections,
    rows: sections.flatMap(section => section.rows.map(row =>
      ({ section: section.id, sectionTitle: section.title, ...row }))) };
}

function absolutePath(value, name) {
  text(value, name);
  requireValue(value.startsWith('/') && !value.split('/').some(part => part === '.' || part === '..'),
    'PRODUCT_PLAN_ABSOLUTE_PATH_REQUIRED', 'Use an absolute ' + name + ' without relative path components.');
  return value.length > 1 ? value.replace(/\/+$/, '') : value;
}
function shellArgument(value) {
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(value) ? value : "'" + value.replace(/'/g, "'\\''") + "'";
}
function commandStep(id, title, argv, requiredInputs, cwd) {
  const dependencies = { prepare: ['buildReceipt'], install: ['prepare'], inspect: ['install'], run: ['install'] };
  return { id, title, argv, cwd, requiredInputs, dependsOn: dependencies[id] ?? [],
    argumentsComplete: requiredInputs.length === 0,
    command: argv ? argv.map(shellArgument).join(' ') : null };
}
function matchingReceipt(value, summary) {
  const receipt = value?.build ?? value;
  requireValue(plain(receipt) && receipt.status === 'PACKAGED' &&
    receipt.sourceCommit === summary.sourceCommit && receipt.packageName === summary.packageName &&
    receipt.packageVersion === summary.packageVersion &&
    (receipt.sourceSelection?.id ?? 'all') === summary.id &&
    SHA256.test(receipt.sha256 ?? ''), 'PRODUCT_PLAN_RECEIPT_MISMATCH',
  'Select the original completed build receipt for this product and source commit.');
  absolutePath(receipt.archive, 'archive path');
  return receipt;
}

/** Prepare exact original command vectors; execution remains with the maintained build and installer. */
export function planProductInstallation(value, options = {}) {
  const review = sourceReview(value), summary = productSourceSummary(review);
  requireValue(plain(options) && Object.keys(options).every(name =>
    ['outputDirectory', 'runtimeDirectory', 'features', 'native', 'operator', 'buildReceipt',
      'entryCommand', 'entryArguments'].includes(name)),
  'PRODUCT_PLAN_OPTIONS_INVALID', 'Use the product installation plan options.');
  const native = options.native ?? false, operator = options.operator ?? false;
  requireValue(typeof native === 'boolean' && typeof operator === 'boolean',
    'PRODUCT_PLAN_SELECTION_INVALID', 'Use native and operator booleans.');
  const features = strings(options.features ?? [], 'selected runtime features');
  const available = new Map(summary.runtime.features.map(feature => [feature.name, feature]));
  requireValue(features.every(name => available.has(name)), 'PRODUCT_PLAN_FEATURE_UNAVAILABLE',
    'Choose features included in the selected product: ' + [...available.keys()].join(', '));
  const repository = absolutePath(review.repository, 'repository path');
  const output = options.outputDirectory === undefined ? null : absolutePath(options.outputDirectory, 'build output path');
  const runtime = options.runtimeDirectory === undefined ? null : absolutePath(options.runtimeDirectory, 'runtime path');
  requireValue(!output || !runtime || output !== runtime, 'PRODUCT_PLAN_DIRECTORY_CONFLICT',
    'Choose separate product build and runtime directories.');
  const receipt = options.buildReceipt === undefined ? null : matchingReceipt(options.buildReceipt, summary);
  const sourceCLI = DISTRIBUTION + 'runtime-install-cli.mjs';
  const buildArgs = output ? ['node', DISTRIBUTION + 'build.mjs', '--repo', repository,
    '--ref', review.sourceCommit, '--selection', review.selection, '--out', output,
    ...(review.offline ? ['--offline'] : []), ...(review.python ? ['--python', review.python] : [])] : null;
  const selectionArgs = [...(native ? ['--native'] : []),
    ...features.flatMap(feature => ['--feature', feature]), ...(operator ? ['--operator'] : [])];
  const prepareArgs = runtime && receipt ? ['node', sourceCLI, 'prepare', '--dir', runtime,
    '--archive', receipt.archive, '--sha256', receipt.sha256, ...selectionArgs] : null;
  const steps = [];
  if (!receipt) steps.push(commandStep('build', 'Build the selected product', buildArgs,
    output ? [] : ['outputDirectory'], repository));
  steps.push(commandStep('prepare', 'Prepare its customer runtime', prepareArgs,
    [...(runtime ? [] : ['runtimeDirectory']), ...(receipt ? [] : ['buildReceipt'])], repository));
  steps.push(commandStep('install', 'Install the selected runtime dependencies',
    runtime ? ['node', sourceCLI, 'install', '--dir', runtime] : null,
    runtime ? [] : ['runtimeDirectory'], repository));
  steps.push(commandStep('inspect', 'Inspect the installed original source',
    runtime ? ['node', sourceCLI, 'inspect', '--dir', runtime, '--source'] : null,
    runtime ? [] : ['runtimeDirectory'], repository));
  if (options.entryCommand !== undefined) {
    const name = text(options.entryCommand, 'original product command');
    requireValue(Object.hasOwn(review.commands, name), 'PRODUCT_PLAN_COMMAND_UNAVAILABLE',
      'Choose an original command included in this product.');
    const args = options.entryArguments ?? [];
    requireValue(Array.isArray(args) && args.every(argument => typeof argument === 'string' &&
      !argument.includes('\u0000')), 'PRODUCT_PLAN_ARGUMENTS_INVALID', 'Expected original command arguments.');
    steps.push(commandStep('run', 'Open the selected original command',
      runtime ? ['node', sourceCLI, 'run', '--dir', runtime, '--', name, ...args] : null,
      runtime ? [] : ['runtimeDirectory'], repository));
  } else requireValue(options.entryArguments === undefined, 'PRODUCT_PLAN_COMMAND_REQUIRED',
    'Select the original command before adding its arguments.');
  return { schema: PLAN_SCHEMA, product: summary, repository, sourceCommit: review.sourceCommit,
    selection: review.selection, outputDirectory: output, runtimeDirectory: runtime,
    runtimeSelection: { native, features, operator },
    selectedRequirements: { native: native ? copy(summary.runtime.native) : [],
      features: features.map(name => copy(available.get(name))) },
    sourceRequirementsDescribed: summary.runtime.described,
    buildReceipt: receipt ? { archive: receipt.archive, sha256: receipt.sha256,
      sourceCommit: receipt.sourceCommit, selection: receipt.sourceSelection?.id ?? 'all',
      packageName: receipt.packageName, packageVersion: receipt.packageVersion } : null,
    steps };
}

const markdownText = value => String(value ?? '').replace(/\\/g, '\\\\').replace(/\|/g, '\\|')
  .replace(/\r?\n/g, ' ').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const table = (headers, rows) => ['| ' + headers.map(markdownText).join(' | ') + ' |',
  '| ' + headers.map(() => '---').join(' | ') + ' |',
  ...rows.map(row => '| ' + row.map(markdownText).join(' | ') + ' |')].join('\n');
const displayValue = value => value === null ? '—' : value === true ? 'Included' :
  typeof value === 'string' ? value : JSON.stringify(value);
const sourceLine = value => 'Source: ' + markdownText(value.repository) + ' @ ' + markdownText(value.sourceCommit) + '.';
function summaryMarkdown(value) {
  const list = values => values.length ? values.map(item => '- ' + markdownText(item)) : ['No registrations.'];
  return ['# ' + markdownText(value.title), '', markdownText(value.description), '', sourceLine(value), '',
    'Product: ' + markdownText(value.id) + '. Package: ' + markdownText(value.packageName) +
      ' ' + markdownText(value.packageVersion) + '.', '',
    ...(value.readme ? ['Guide: ' + markdownText(value.readme), ''] : []),
    '## Commands', '', table(['Command', 'Original entry'], value.commands.map(item => [item.name, item.entry])), '',
    '## Package exports', '', table(['Export', 'Original target'],
      value.exports.map(item => [item.name, displayValue(item.entry)])), '',
    '## Applications', '', ...list(value.applications), '',
    '## Merchant providers', '', ...list(value.merchantProviders), '',
    '## Native package declarations', '',
    table(['Package', 'Declared requirement', 'Original probe', 'Native binding'],
      value.runtime.native.map(item => [item.name, item.version, item.probe, item.native ?? ''])), '',
    '## Runtime features', '', table(['Feature', 'Original manifest', 'Declared requirements and probes'],
      value.runtime.features.map(item => [item.name, item.manifestPath ?? '',
        item.manifestPath ? item.declaredPeers ? JSON.stringify(item.declaredPeers) : 'Read the original manifest' :
          item.dependencies.map(dep => dep.name + '@' + dep.version + ' [' + dep.probe + ']' +
            (dep.native ? ' (' + dep.native + ')' : '')).join('; ')])), '',
    ...(value.runtime.described ? [] : ['Detailed runtime declarations are available from the product detail view.', '']),
    '## Source components', '', ...list(value.components), '',
    '## Source contributions', '', table(['Contribution', 'Original path'],
      value.contributions.map(item => [item.id, item.path])), '',
    '## Original source inputs', '', table(['Path', 'Git blob', 'SHA-256', 'Bytes'],
      value.sourceInputs.map(item => [item.path, item.gitBlob ?? '', item.sha256 ?? '', item.bytes ?? ''])), ''].join('\n');
}

/** Portable operator exports use the same complete values shown in the catalogue. */
export function formatProductCatalogMarkdown(value) {
  requireValue(plain(value), 'PRODUCT_CATALOG_EXPORT_REQUIRED', 'Choose a product catalogue view to export.');
  if (value.schema === SUMMARY_SCHEMA) return summaryMarkdown(value);
  if (value.schema === COMPARISON_SCHEMA) {
    return ['# Product comparison', '', sourceLine(value), '',
      table(['Product', 'Commands', 'Applications', 'Features', 'Guide'],
        value.products.map(product => [product.title + ' (' + product.id + ')', product.counts.commands,
          product.counts.applications, product.counts.features, product.readme ?? ''])), '',
      ...value.sections.flatMap(section => ['## ' + section.title, '',
        table([section.title, ...value.products.map(product => product.id)],
          section.rows.map(row => [row.name, ...row.values.map(displayValue)])), ''])].join('\n');
  }
  if (value.schema === PLAN_SCHEMA) {
    return ['# Installation plan: ' + markdownText(value.product.title), '', sourceLine(value), '',
      'Selection: ' + markdownText(value.selection) + '. Package: ' + markdownText(value.product.packageName) +
        ' ' + markdownText(value.product.packageVersion) + '.', '',
      ...(value.product.readme ? ['Guide: ' + markdownText(value.product.readme), ''] : []),
      'Runtime features: ' + (value.runtimeSelection.features.join(', ') || 'Source only') + '. ' +
        'Native packages: ' + (value.runtimeSelection.native ? 'selected' : 'not selected') + '. ' +
        'Operator profile: ' + (value.runtimeSelection.operator ? 'selected' : 'not selected') + '.', '',
      '## Selected native declarations', '', table(['Package', 'Declared requirement', 'Original probe'],
        value.selectedRequirements.native.map(item => [item.name, item.version, item.probe])), '',
      '## Selected feature declarations', '', table(['Feature', 'Original requirement source'],
        value.selectedRequirements.features.map(item => [item.name, item.manifestPath ??
          item.dependencies.map(dep => dep.name + '@' + dep.version).join('; ')])), '',
      ...(value.buildReceipt ? ['Original archive: ' + markdownText(value.buildReceipt.archive), '',
        'SHA-256: ' + value.buildReceipt.sha256, ''] : []),
      ...value.steps.flatMap(step => ['## ' + step.title, '',
        ...(step.command ? ['Working directory: ' + markdownText(step.cwd), '',
          '~~~sh', step.command, '~~~', ''] :
          ['Provide: ' + step.requiredInputs.map(markdownText).join(', ') + '.', ''])])].join('\n');
  }
  requireValue(Array.isArray(value.products), 'PRODUCT_CATALOG_EXPORT_UNSUPPORTED',
    'Unsupported product catalogue export.');
  return ['# Product catalogue', '', sourceLine(value), '',
    ...(value.query ? ['Search: ' + markdownText(value.query), ''] : []),
    table(['Product', 'Selection', 'Description', 'Source status'],
      value.products.map(product => [product.title, product.id ?? '', product.description ?? '',
        product.available === true ? 'Recipe available' : product.error?.message ?? 'Recipe needs correction'])), ''].join('\n');
}
