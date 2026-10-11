// MIT. Browser-local workspace preparation for the original SF30 merchant runtime.
// This module writes configuration and files; the installed toolkit owns execution.

const encoder = new TextEncoder();
const MAX_DATA_BYTES = 1024 * 1024;
const MAX_ATOMIC = (1n << 127n) - 1n;
const SCHEMA = 'stellar-forge.seller-service.v1';
const WORKSPACE_SCHEMA = 'stellar-forge.merchant-workspace.v1';
const DRAFT_SCHEMA = 'stellar-forge.frontdoor-starter.v1';
const EXAMPLE_ASSET = 'UNVERIFIED_DEMO_ASSET';
const EXAMPLE_RECIPIENT = 'UNVERIFIED_DEMO_RECIPIENT';
const REPOSITORY = 'https://github.com/woahwhattheheck/public-commons-sprint-2026';
const BASE = REPOSITORY + '/blob/main/stellar/scf-starforge-20261009/';
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const json = value => JSON.stringify(value, null, 2) + '\n';
const clone = value => JSON.parse(JSON.stringify(value));
const quoted = value => "'" + String(value).replace(/'/g, "'\\''") + "'";

export const SOURCE_CONTRACT = Object.freeze({
  observedAt: '2026-10-11',
  repository: REPOSITORY,
  distributionGuide: BASE + 'distribution/README.md',
  sellerGuide: BASE + 'sf30-seller-sdk/README.md',
  developerGuide: BASE + 'sf30-seller-sdk/DEVELOPER.md',
  paymentOptionsGuide: BASE + 'sf30-seller-sdk/PAYMENT_OPTIONS.md',
  releaseGuide: BASE + 'sf46-release/DISTRIBUTION.md',
  packageHandoff: BASE + 'distribution/README.md',
  packageFilename: 'the-package.tgz',
  sourceBlobs: Object.freeze({
    workspace: 'befb1c91c547cfd37840a4c188ee538a47052195',
    sellerCompiler: '157b296233b6849e074c8f4ed0216dd915fbf216',
    sellerServer: 'bf624aa7cc95a99ff20a1ef51ca0f61b1203d1dd',
    responseFile: '332e84f219644494cc0d3b2c6b089b2641397d6d',
  }),
  nodeMinimum: '22.16',
  serviceSchema: SCHEMA,
  workspaceSchema: WORKSPACE_SCHEMA,
  draftSchema: DRAFT_SCHEMA,
  maximumResources: 64,
  maximumDataBytes: MAX_DATA_BYTES,
  maximumAtomicAmount: String(MAX_ATOMIC),
});

export const INPUT_SCHEMA = Object.freeze({
  folder: 'Portable directory name: 1–64 letters, digits, underscores or hyphens; starts with a letter or digit.',
  network: 'stellar:testnet or stellar:pubnet',
  asset: 'Public SEP-41 asset contract identifier; 1–128 printable characters.',
  payTo: 'Public recipient identifier; 1–128 printable characters.',
  amount: 'Default exact price as a positive decimal atomic-unit string, up to signed i128.',
  maxTimeoutSeconds: 'Integer from 1 through 86400.',
  resources: Object.freeze({
    length: '1–64 resources',
    id: 'Unique 1–64 character ID using letters, digits, underscores and hyphens.',
    path: 'Unique static seller path; no query, fragment, encoded characters or /_seller/ prefix.',
    serviceName: '1–32 printable ASCII characters.',
    description: '1–2048 printable characters.',
    tags: 'Up to 5 unique printable ASCII strings, each 1–32 characters; array or comma-separated text.',
    amount: 'Optional resource-specific atomic price; an empty value uses the shared default.',
    dataText: 'Complete UTF-8 JSON text up to 1 MiB; preserved unchanged in its data file.',
  }),
  importedSeller: 'Optional original dataset-service object retained during edits.',
});

export const DEFAULT_RESOURCE = Object.freeze({
  id: 'dataset', path: '/dataset', serviceName: 'My Dataset API',
  description: 'A JSON data resource served through Stellar Forge.',
  tags: Object.freeze(['dataset']), amount: '10000',
  dataText: '{\n  "dataset": "local-example",\n  "rows": [\n    { "region": "north", "value": 4 },\n    { "region": "south", "value": 7 }\n  ]\n}\n',
});

export const DEFAULT_STARTER = Object.freeze({
  folder: 'merchant', network: 'stellar:testnet',
  asset: EXAMPLE_ASSET, payTo: EXAMPLE_RECIPIENT,
  amount: '10000', maxTimeoutSeconds: 60,
  resources: Object.freeze([DEFAULT_RESOURCE]),
});

export class WorkspaceValidationError extends Error {
  constructor(errors) {
    super(errors.map(error => error.message).join(' '));
    this.name = 'WorkspaceValidationError';
    this.errors = errors;
  }
}

function textField(value, field, name, limit, errors, ascii = false) {
  if (typeof value !== 'string' || !value.trim() || value.length > limit ||
      /[\x00-\x1f\x7f]/.test(value) || ascii && !/^[\x20-\x7e]+$/.test(value)) {
    errors.push({ field, code: 'INVALID_TEXT', message: `${name} must contain 1–${limit} printable${ascii ? ' ASCII' : ''} characters.` });
    return typeof value === 'string' ? value : '';
  }
  return value.trim();
}

function atomic(value, field, errors) {
  if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value) || value.length > 39 || BigInt(value) > MAX_ATOMIC) {
    errors.push({ field, code: 'INVALID_ATOMIC_AMOUNT', message: 'Price must be a positive decimal atomic-unit string no larger than ' + MAX_ATOMIC + '.' });
    return typeof value === 'string' ? value : '';
  }
  return value;
}

function validUnicode(value) {
  for (let i = 0; i < value.length; i++) {
    const unit = value.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
  }
  return true;
}

function dataset(value, field, errors) {
  if (typeof value !== 'string' || !validUnicode(value)) {
    errors.push({ field, code: 'INVALID_DATA_TEXT', message: 'Choose or paste a complete UTF-8 JSON file.' });
    return { text: '', bytes: 0 };
  }
  const bytes = encoder.encode(value).byteLength;
  if (bytes > MAX_DATA_BYTES) errors.push({ field, code: 'DATA_TOO_LARGE', message: 'Each original seller JSON response file can contain at most 1 MiB (1,048,576 bytes).' });
  try {
    // Match the original UTF-8 decoder's handling of an initial BOM.
    JSON.parse(value.charCodeAt(0) === 0xfeff ? value.slice(1) : value);
  } catch {
    errors.push({ field, code: 'INVALID_JSON', message: 'The resource data must be valid JSON.' });
  }
  return { text: value, bytes };
}

function importedRoutes(value) {
  const errors = [];
  if (!object(value) || value.schema !== SCHEMA || !Array.isArray(value.routes) || !value.routes.length || value.routes.length > 64) {
    throw new WorkspaceValidationError([{ field: 'importedSeller', code: 'IMPORT_SCHEMA', message: 'Import an original seller-service.v1 configuration with 1–64 dataset routes.' }]);
  }
  const ids = new Set();
  for (const [index, route] of value.routes.entries()) {
    const field = `resources.${index}`;
    if (!object(route) || typeof route.id !== 'string' || ids.has(route.id)) {
      errors.push({ field: field + '.id', code: 'IMPORT_ROUTE', message: 'Every imported resource needs its own original route ID.' });
      continue;
    }
    ids.add(route.id);
    if (!object(route.definition) || own(route, 'offer') || String(route.definition.method).toUpperCase() !== 'GET' ||
        own(route, 'handler') || own(route, 'admit') || own(route, 'responseAsset') ||
        own(route, 'validateInput') && route.validateInput !== false ||
        own(route, 'response') === own(route, 'responseFile')) {
      errors.push({ field, code: 'IMPORT_DATASET_ONLY', message: `Resource ${route.id} needs a declared GET definition and one JSON response or responseFile. Continue other resource types in the original developer workspace.` });
      continue;
    }
    const definition = route.definition;
    const payment = definition.payment ?? definition.paymentOptions?.[0];
    if (!object(payment) || payment.scheme !== 'exact' || own(definition, 'payment') === own(definition, 'paymentOptions') ||
        own(definition, 'paymentOptions') && (!Array.isArray(definition.paymentOptions) || definition.paymentOptions.length !== 1)) {
      errors.push({ field: field + '.amount', code: 'IMPORT_PAYMENT_OPTIONS', message: `Resource ${route.id} has multiple or missing payment choices. Preserve that configuration in the original payment-options workflow.` });
    }
  }
  if (errors.length) throw new WorkspaceValidationError(errors);
  return value.routes;
}

/** Import supported original JSON routes without flattening their metadata. */
export function importDatasetConfig(sellerInput, { dataFiles = {}, folder = 'merchant' } = {}) {
  let seller;
  try { seller = typeof sellerInput === 'string' ? JSON.parse(sellerInput.replace(/^\uFEFF/, '')) : clone(sellerInput); }
  catch { throw new WorkspaceValidationError([{ field: 'importedSeller', code: 'IMPORT_JSON', message: 'Choose a complete original seller.json file.' }]); }
  const routes = importedRoutes(seller);
  const paymentFor = route => route.definition.payment ?? route.definition.paymentOptions[0];
  const firstPayment = paymentFor(routes[0]);
  if (!object(firstPayment) || routes.some(route => {
    const payment = paymentFor(route);
    return !object(payment) || payment.scheme !== 'exact' ||
      ['network', 'asset', 'payTo', 'maxTimeoutSeconds'].some(key => payment[key] !== firstPayment[key]);
  })) throw new WorkspaceValidationError([{ field: 'importedSeller', code: 'IMPORT_SHARED_TERMS', message: 'These resources use different payment rails or timeouts. Keep their original independent terms in the native developer workspace.' }]);
  const missingDataFiles = [];
  const resources = routes.map((route, index) => {
    let dataText;
    if (own(route, 'response')) dataText = json(route.response);
    else {
      const path = route.responseFile;
      dataText = dataFiles instanceof Map ? dataFiles.get(path) ?? dataFiles.get(String(path).replace(/^\.\//, '')) :
        own(dataFiles, path) ? dataFiles[path] : dataFiles[String(path).replace(/^\.\//, '')];
      if (typeof dataText !== 'string') {
        dataText = '';
        missingDataFiles.push({ index, id: route.id, originalPath: path, field: `resources.${index}.dataText` });
      }
    }
    return { id: route.id, path: route.path, serviceName: route.definition.serviceName ?? route.id,
      description: route.definition.description, tags: clone(route.definition.tags ?? []),
      amount: paymentFor(route).amount, dataText };
  });
  return { input: { folder, network: firstPayment.network, asset: firstPayment.asset, payTo: firstPayment.payTo,
    amount: firstPayment.amount, maxTimeoutSeconds: firstPayment.maxTimeoutSeconds, resources, importedSeller: seller },
    missingDataFiles };
}

export function validateWorkspaceInput(input = {}) {
  const errors = [];
  if (!object(input)) return { valid: false, errors: [{ field: 'input', code: 'INPUT_OBJECT', message: 'Workspace input must be an object.' }] };
  let importedSeller = null;
  if (input.importedSeller !== undefined && input.importedSeller !== null) {
    try { importedSeller = clone(input.importedSeller); importedRoutes(importedSeller); }
    catch (error) { errors.push(...(error.errors ?? [{ field: 'importedSeller', code: 'IMPORT_JSON', message: 'Imported seller configuration must contain ordinary JSON.' }])); }
  }
  const base = { ...DEFAULT_STARTER, ...input };
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(base.folder ?? ''))
    errors.push({ field: 'folder', code: 'INVALID_FOLDER', message: 'Use a directory name of 1–64 letters, digits, underscores or hyphens, starting with a letter or digit.' });
  if (!['stellar:testnet', 'stellar:pubnet'].includes(base.network))
    errors.push({ field: 'network', code: 'INVALID_NETWORK', message: 'Choose stellar:testnet or stellar:pubnet.' });
  const asset = textField(base.asset, 'asset', 'Asset', 128, errors);
  const payTo = textField(base.payTo, 'payTo', 'Recipient', 128, errors);
  const amount = atomic(base.amount, 'amount', errors);
  const timeout = typeof base.maxTimeoutSeconds === 'string' && /^[0-9]+$/.test(base.maxTimeoutSeconds) ? Number(base.maxTimeoutSeconds) : base.maxTimeoutSeconds;
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 86400)
    errors.push({ field: 'maxTimeoutSeconds', code: 'INVALID_TIMEOUT', message: 'Timeout must be a whole number from 1 through 86400 seconds.' });
  // Keep the former single-resource shape useful to small consuming UIs.
  const supplied = own(input, 'resources') ? input.resources : own(input, 'dataText') ? [{ ...DEFAULT_RESOURCE, ...input }] : base.resources;
  if (!Array.isArray(supplied) || supplied.length < 1 || supplied.length > 64)
    errors.push({ field: 'resources', code: 'RESOURCE_COUNT', message: 'A merchant workspace needs 1–64 resources.' });
  const ids = new Set(), filenames = new Set(), paths = new Set();
  const resources = (Array.isArray(supplied) ? supplied.slice(0, 64) : []).map((resource, index) => {
    const prefix = `resources.${index}`;
    const r = object(resource) ? resource : {};
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(r.id ?? ''))
      errors.push({ field: prefix + '.id', code: 'INVALID_ID', message: 'Resource ID must use 1–64 letters, digits, underscores or hyphens.' });
    else if (ids.has(r.id) || filenames.has(r.id.toLowerCase()))
      errors.push({ field: prefix + '.id', code: 'DUPLICATE_ID', message: 'Choose a unique resource ID, including its letter case on the exported filesystem.' });
    ids.add(r.id); if (typeof r.id === 'string') filenames.add(r.id.toLowerCase());
    let validPath = typeof r.path === 'string' && /^\/[A-Za-z0-9_.~/-]*$/.test(r.path) &&
      r.path !== '/_seller' && !r.path.startsWith('/_seller/') && !r.path.includes('//');
    if (validPath) validPath = new URL(r.path, 'https://seller.example').pathname === r.path;
    if (!validPath) errors.push({ field: prefix + '.path', code: 'INVALID_PATH', message: 'Use a static canonical path such as /dataset, without query, fragment, dot segments or the /_seller/ prefix.' });
    else if (paths.has(r.path)) errors.push({ field: prefix + '.path', code: 'DUPLICATE_PATH', message: 'Every resource needs its own request path.' });
    paths.add(r.path);
    const serviceName = textField(r.serviceName, prefix + '.serviceName', 'Service name', 32, errors, true);
    const description = textField(r.description, prefix + '.description', 'Description', 2048, errors);
    const tags = typeof r.tags === 'string' ? r.tags.split(',').map(tag => tag.trim()).filter(Boolean) : r.tags ?? [];
    if (!Array.isArray(tags) || tags.length > 5 || tags.some(tag => typeof tag !== 'string' || !/^[\x20-\x7e]{1,32}$/.test(tag) || !tag.trim()) ||
        new Set(Array.isArray(tags) ? tags.map(tag => String(tag).toLowerCase()) : []).size !== tags.length)
      errors.push({ field: prefix + '.tags', code: 'INVALID_TAGS', message: 'Use at most five unique printable ASCII tags, each 1–32 characters.' });
    const price = r.amount === undefined || r.amount === '' ? amount : atomic(r.amount, prefix + '.amount', errors);
    const data = dataset(r.dataText, prefix + '.dataText', errors);
    return { id: r.id, path: r.path, serviceName, description, tags: Array.isArray(tags) ? tags : [],
      amount: price, dataText: data.text, dataBytes: data.bytes };
  });
  const value = { folder: base.folder, network: base.network, asset, payTo, amount,
    maxTimeoutSeconds: timeout, resources, importedSeller };
  return { valid: errors.length === 0, errors, ...(errors.length ? {} : { value }) };
}

function buildConfig(value) {
  const previous = new Map((value.importedSeller?.routes ?? []).map(route => [route.id, route]));
  const routes = value.resources.map(resource => {
    const route = previous.has(resource.id) ? clone(previous.get(resource.id)) : {};
    const definition = route.definition ?? {};
    const oldPayment = definition.payment ?? definition.paymentOptions?.[0] ?? {};
    const payment = { ...oldPayment, scheme: 'exact', network: value.network, asset: value.asset,
      payTo: value.payTo, amount: resource.amount, maxTimeoutSeconds: value.maxTimeoutSeconds };
    // A retained one-choice paymentOptions declaration stays in its original form.
    const paymentKey = own(definition, 'paymentOptions') ? 'paymentOptions' : 'payment';
    const nextDefinition = { ...definition, method: 'GET', serviceName: resource.serviceName,
      description: resource.description, tags: [...resource.tags], [paymentKey]: paymentKey === 'paymentOptions' ? [payment] : payment };
    delete nextDefinition.url;
    delete route.response;
    return { ...route, id: resource.id, path: resource.path, definition: nextDefinition,
      responseFile: './data/' + resource.id + '.json' };
  });
  return { ...(value.importedSeller ?? {}), schema: SCHEMA, routes };
}

function commandsFor(value) {
  const archive = '/absolute/path/to/' + SOURCE_CONTRACT.packageFilename;
  const workspace = './' + value.folder;
  return {
    install: `npm install --ignore-scripts --offline --omit=optional --no-audit --no-fund ${quoted(archive)}\nnpx --no-install starforge doctor`,
    run: `npx --no-install starforge run --workspace ${quoted(workspace)} -- --port 0`,
    inspect: ["STARFORGE_SELLER_URL='PASTE_SELLER_URL_FROM_STARTUP'",
      'curl -i "$STARFORGE_SELLER_URL/_seller/health"',
      'curl -i "$STARFORGE_SELLER_URL/_seller/offers"',
      ...value.resources.map(resource => `curl -i "$STARFORGE_SELLER_URL${resource.path}"`)].join('\n'),
    nativeDependencies: "npm install --ignore-scripts --no-audit --no-fund @x402/core@2.28.0 @x402/stellar@2.28.0 @x402/extensions@2.28.0 '@stellar/stellar-sdk@^16.3.0'\nnpx --no-install starforge doctor --native",
    nativeRun: `npx --no-install starforge run --workspace ${quoted(workspace)} -- --port 0 --facilitator 'https://your-facilitator.example/facilitator'`,
    buildPackage: 'node stellar/scf-starforge-20261009/distribution/build.mjs --out /absolute/new-release-directory --ref HEAD',
    source: 'npx --no-install starforge source',
  };
}

function readme(value, commands) {
  const rows = value.resources.map(resource => `| \`${resource.id}\` | \`GET ${resource.path}\` | \`${resource.amount}\` | \`data/${resource.id}.json\` | ${resource.dataBytes} |`).join('\n');
  return `# ${value.folder}: Stellar Forge merchant workspace\n\nThis workspace runs through the original Starforge merchant toolkit. It contains ${value.resources.length} configured JSON resource${value.resources.length === 1 ? '' : 's'} and the selected source data. Data files retain their original UTF-8 bytes.\n\n## Install the toolkit\n\nUse Node.js ${SOURCE_CONTRACT.nodeMinimum} or later. Obtain or build the source archive using the maintained [distribution guide](${SOURCE_CONTRACT.distributionGuide}). This is an npm-compatible local archive; it is not a package published to a registry.\n\nThe original packager prints the archive path, selected source commit, version and SHA-256 receipt. Keep that receipt with the archive you install. Use the source manifest to identify the native commands actually included in that version.\n\nFrom the application directory that contains this extracted ${value.folder} directory, replace /absolute/path/to/the-package.tgz with the actual archive path and run:\n\n\`\`\`sh\n${commands.install}\n\`\`\`\n\nThe workspace is already initialized; use it directly:\n\n\`\`\`sh\n${commands.run}\n\`\`\`\n\nTwo original startup messages print the seller URL and the operations dashboard URL. Open the dashboard, or open the seller URL followed by /_seller/docs. Its /_seller/openapi.json is generated from these exact routes. Ctrl-C shuts down the original processes.\n\n## Resources\n\n| ID | Request | Exact atomic price | Data file | Bytes |\n| --- | --- | --- | --- | --- |\n${rows}\n\nShared network: \`${value.network}\`. Asset: \`${value.asset}\`. Recipient: \`${value.payTo}\`. Timeout: ${value.maxTimeoutSeconds} seconds. Atomic amounts stay decimal strings.\n\nThe startup command serves native HTTP 402 challenges. It does not configure payment processing. The default UNVERIFIED_DEMO_ASSET and UNVERIFIED_DEMO_RECIPIENT are deliberately nonpayable example markers. Replace them with the merchant's public payment identifiers before configuring the native facilitator. Data is loaded once at startup; edit a data file and restart to load its new snapshot. The default challenge-only mode does not release the data.\n\nCopy the actual seller URL from startup before making these local inspection requests:\n\n\`\`\`sh\n${commands.inspect}\n\`\`\`\n\n## Configure native operation\n\nUse the merchant's original payment terms and configured facilitator. Install the original documented optional dependencies in the consuming application:\n\n\`\`\`sh\n${commands.nativeDependencies}\n\`\`\`\n\nReplace the example facilitator URL with the configured endpoint:\n\n\`\`\`sh\n${commands.nativeRun}\n\`\`\`\n\nThe original SDK and facilitator perform verification and settlement. The browser that prepared these files does not connect to either. Doctor checks local runtime/dependency availability.\n\n## Continue development\n\n- seller.json: the original seller-service.v1 configuration.\n- workspace.json: the original merchant-workspace.v1 dataset descriptor.\n- data/: original JSON source files named by resource ID.\n- starter-input.json: reopen this editable front-door draft to revise the workspace.\n- .private/: local operator material, excluded from Git by .gitignore.\n\nSupported imported metadata and explicit output examples are preserved. Selected data is never added to advertised examples. Other native resource types continue in the original developer workspace.\n\n[Seller guide](${SOURCE_CONTRACT.sellerGuide}) · [Developer workspace](${SOURCE_CONTRACT.developerGuide}) · [Payment choices](${SOURCE_CONTRACT.paymentOptionsGuide}) · [Portable release operations](${SOURCE_CONTRACT.releaseGuide})\n\nTo produce an immutable toolkit archive from a committed checkout, run from its repository root:\n\n\`\`\`sh\n${commands.buildPackage}\n\`\`\`\n\nThat command runs the original source packager. The output directory must be new. Use the printed archive path with the installation command above. Inspect the installed package's source manifest with:\n\n\`\`\`sh\n${commands.source}\n\`\`\`\n`;
}

export function createDatasetWorkspace(input = {}) {
  const validation = validateWorkspaceInput(input);
  if (!validation.valid) throw new WorkspaceValidationError(validation.errors);
  const value = validation.value;
  const config = buildConfig(value);
  const configText = json(config);
  if (encoder.encode(configText).length > MAX_DATA_BYTES)
    throw new WorkspaceValidationError([{ field: 'importedSeller', code: 'CONFIG_TOO_LARGE', message: 'The original seller configuration must fit within 1 MiB. Reduce retained examples or metadata.' }]);
  const workspace = { schema: WORKSPACE_SCHEMA, template: 'dataset', packageVersion: null, sourceCommit: null };
  const draft = { schema: DRAFT_SCHEMA, ...value,
    resources: value.resources.map(({ dataBytes, ...resource }) => resource) };
  if (!draft.importedSeller) delete draft.importedSeller;
  const commands = commandsFor(value);
  const entry = (path, content) => ({ path: value.folder + '/' + path, content });
  const files = [entry('seller.json', configText), entry('workspace.json', json(workspace)),
    ...value.resources.map(resource => entry('data/' + resource.id + '.json', resource.dataText)),
    entry('starter-input.json', json(draft)), entry('README.md', readme(value, commands)),
    entry('.gitignore', '.private/\nnode_modules/\n'), entry('.private/.gitkeep', '')];
  return { files, config, workspace, commands, draft,
    summary: { folder: value.folder, resourceCount: value.resources.length,
      totalDataBytes: value.resources.reduce((total, resource) => total + resource.dataBytes, 0),
      network: value.network, asset: value.asset, payTo: value.payTo,
      maxTimeoutSeconds: value.maxTimeoutSeconds,
      nonpayableExample: value.asset === EXAMPLE_ASSET || value.payTo === EXAMPLE_RECIPIENT,
      source: SOURCE_CONTRACT,
      resources: value.resources.map(({ dataText, tags, description, ...resource }) => resource) } };
}

/** Reopen an exported draft; validation is returned separately for editable files. */
export function importWorkspaceDraft(text) {
  let draft;
  try { draft = JSON.parse(text.replace(/^\uFEFF/, '')); }
  catch { throw new WorkspaceValidationError([{ field: 'draft', code: 'DRAFT_JSON', message: 'Choose a complete starter-input.json file.' }]); }
  if (!object(draft) || draft.schema !== DRAFT_SCHEMA)
    throw new WorkspaceValidationError([{ field: 'draft', code: 'DRAFT_SCHEMA', message: 'This is not a Stellar Forge front-door workspace draft.' }]);
  return draft;
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ value >>> 1 : value >>> 1;
  return value >>> 0;
});
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 255] ^ crc >>> 8;
  return (crc ^ 0xffffffff) >>> 0;
}

/** Deterministic stored ZIP, with UTF-8 names and unchanged file bytes. */
export function zipWorkspace(files) {
  if (!Array.isArray(files) || !files.length || files.length > 65535) throw new TypeError('Supply a nonempty file list.');
  const names = new Set();
  const entries = files.map(file => {
    if (!object(file) || typeof file.path !== 'string' || file.path.includes('\\') || file.path.startsWith('/') ||
        /[\x00-\x1f\x7f]/.test(file.path) || file.path.split('/').some(part => !part || part === '.' || part === '..') || names.has(file.path))
      throw new TypeError('ZIP files need unique canonical relative paths.');
    names.add(file.path);
    const name = encoder.encode(file.path);
    if (name.length > 65535) throw new RangeError('ZIP filename exceeds the format limit.');
    const content = typeof file.content === 'string' ? encoder.encode(file.content) : file.content;
    if (!(content instanceof Uint8Array) || content.length > 0xffffffff) throw new TypeError('ZIP content must be text or byte arrays within the format limit.');
    return { name, content, crc: crc32(content) };
  });
  const localSize = entries.reduce((size, entry) => size + 30 + entry.name.length + entry.content.length, 0);
  const centralSize = entries.reduce((size, entry) => size + 46 + entry.name.length, 0);
  if (localSize + centralSize + 22 > 0xffffffff) throw new RangeError('Workspace exceeds the classic ZIP size limit.');
  const output = new Uint8Array(localSize + centralSize + 22);
  const view = new DataView(output.buffer);
  const u16 = (offset, value) => view.setUint16(offset, value, true);
  const u32 = (offset, value) => view.setUint32(offset, value, true);
  let local = 0, central = localSize;
  for (const entry of entries) {
    u32(local, 0x04034b50); u16(local + 4, 20); u16(local + 6, 0x800);
    u16(local + 8, 0); u16(local + 10, 0); u16(local + 12, 33);
    u32(local + 14, entry.crc); u32(local + 18, entry.content.length); u32(local + 22, entry.content.length);
    u16(local + 26, entry.name.length); u16(local + 28, 0);
    output.set(entry.name, local + 30); output.set(entry.content, local + 30 + entry.name.length);
    u32(central, 0x02014b50); u16(central + 4, 0x314); u16(central + 6, 20);
    u16(central + 8, 0x800); u16(central + 10, 0); u16(central + 12, 0); u16(central + 14, 33);
    u32(central + 16, entry.crc); u32(central + 20, entry.content.length); u32(central + 24, entry.content.length);
    u16(central + 28, entry.name.length); u16(central + 30, 0); u16(central + 32, 0);
    u16(central + 34, 0); u16(central + 36, 0); u32(central + 38, (0o100600 << 16) >>> 0); u32(central + 42, local);
    output.set(entry.name, central + 46);
    local += 30 + entry.name.length + entry.content.length;
    central += 46 + entry.name.length;
  }
  u32(central, 0x06054b50); u16(central + 4, 0); u16(central + 6, 0);
  u16(central + 8, entries.length); u16(central + 10, entries.length);
  u32(central + 12, centralSize); u32(central + 16, localSize); u16(central + 20, 0);
  return output;
}
