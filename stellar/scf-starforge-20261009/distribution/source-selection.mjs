// MIT. Select complete source-owned capabilities for the original distribution.
import { productPackageMetadata } from './product-package.mjs';

export const sourceSelectionDirectory = 'stellar/scf-starforge-20261009/distribution/selections';
export const sourceSelectionSchema = 'stellar-forge.distribution-source-selection.v1';
const contributionDirectory = 'stellar/scf-starforge-20261009/distribution/contributions';
const idPattern = /^[a-z][a-z0-9-]{0,63}$/;
const baseFields = ['commands', 'exports', 'features', 'applicationProviders', 'merchantProviders', 'browserAssets'];
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const copy = value => JSON.parse(JSON.stringify(value));
const need = (condition, message) => {
  if (!condition) throw Object.assign(new TypeError(message), { code: 'DISTRIBUTION_SELECTION_INVALID' });
};
const put = (object, name, value) => Object.defineProperty(object, name,
  { value, enumerable: true, writable: true, configurable: true });

function identifier(value, label) {
  need(typeof value === 'string' && idPattern.test(value) && value !== 'all' && value !== 'base',
    'Invalid source selection ' + label);
  return value;
}
function sourcePath(value, label) {
  need(typeof value === 'string' && value.length > 0 && value.length <= 1024 &&
    !/[\u0000-\u0020\u007f\\?#%:*]/.test(value) &&
    value.split('/').every(part => part && part !== '.' && part !== '..'),
  'Invalid selected original source path: ' + label);
  return value;
}
function list(value, label, validate = entry => {
  need(typeof entry === 'string' && entry.length > 0 && entry.length <= 1024,
    'Expected selected ' + label + ' names');
}) {
  need(Array.isArray(value) && value.length <= 2048, 'Expected a source selection array: ' + label);
  const seen = new Set();
  for (const entry of value) {
    validate(entry, label);
    need(!seen.has(entry), 'Duplicate selected ' + label + ': ' + entry);
    seen.add(entry);
  }
  return [...value];
}

/** "all" is an explicit full build; an omitted selection preserves the default. */
export function sourceSelectionPath(id) {
  if (id === undefined || id === 'all') return null;
  return sourceSelectionDirectory + '/' + identifier(id, 'ID') + '.json';
}

/** The recipe is original committed source, never an unbound generated manifest. */
export function validateSourceSelection(value, path) {
  need(plain(value) && value.schema === sourceSelectionSchema &&
    Object.keys(value).every(key => ['schema', 'id', 'title', 'description', 'base',
      'contributions', 'components', 'supportFiles', 'excludeFiles', 'product'].includes(key)),
  'Unsupported distribution source selection');
  identifier(value.id, 'ID');
  if (path !== undefined) need(path === sourceSelectionPath(value.id),
    'Source selection ID differs from its original filename');
  need(typeof value.title === 'string' && value.title.trim() === value.title &&
    value.title.length > 0 && value.title.length <= 160 && !/[\u0000-\u001f\u007f]/.test(value.title),
  'Expected a single-line source selection title');
  if (value.description !== undefined) need(typeof value.description === 'string' &&
    value.description.length <= 1024 && !/[\u0000-\u001f\u007f]/.test(value.description),
  'Expected a single-line source selection description');
  need(plain(value.base) && Object.keys(value.base).every(key => baseFields.includes(key)),
    'Select existing base registration names');
  need(Object.hasOwn(value.base, 'commands') && Object.hasOwn(value.base, 'exports'),
    'Source selections explicitly name their base commands and exports');
  for (const field of baseFields) {
    if (value.base[field] === undefined) continue;
    list(value.base[field], field, field === 'browserAssets' ? sourcePath : undefined);
  }
  list(value.contributions, 'contribution', identifier);
  list(value.components, 'component', sourcePath);
  list(value.supportFiles, 'support file', sourcePath);
  if (value.excludeFiles !== undefined) list(value.excludeFiles, 'excluded file', sourcePath);
  need(value.components.length > 0, 'A source selection needs at least one complete original component');
  if (value.product !== undefined) productPackageMetadata(value.product);
  return copy(value);
}

export function selectedContributionPaths(paths, selection) {
  const recipe = validateSourceSelection(selection);
  const available = new Set(paths);
  return recipe.contributions.map(id => {
    const path = contributionDirectory + '/' + id + '.json';
    need(available.has(path), 'Selected original contribution is missing: ' + id);
    return path;
  }).sort();
}
function selectMap(original, names, label) {
  const result = Object.create(null);
  for (const name of names ?? []) {
    need(Object.hasOwn(original ?? {}, name), 'Unknown selected base ' + label + ': ' + name);
    put(result, name, copy(original[name]));
  }
  return result;
}

/** Filter declarations before composing; unrelated contribution conflicts stay outside this build. */
export function selectDistributionSources({ base, contributions, selection }) {
  const recipe = validateSourceSelection(selection);
  need(plain(base) && Array.isArray(contributions), 'Expected original distribution declarations');
  const selected = copy(base);
  selected.components = [...recipe.components];
  selected.supportFiles = [...recipe.supportFiles];
  selected.excludeFiles = [...new Set([...(base.excludeFiles ?? []), ...(recipe.excludeFiles ?? [])])];
  selected.commands = selectMap(base.commands, recipe.base.commands, 'command');
  selected.exports = selectMap(base.exports, recipe.base.exports, 'export');
  selected.commandDescriptions = Object.fromEntries(Object.entries(base.commandDescriptions ?? {})
    .filter(([name]) => Object.hasOwn(selected.commands, name)));
  for (const field of ['applicationProviders', 'merchantProviders'])
    selected[field] = selectMap(base[field], recipe.base[field], field);
  selected.featurePeers = Object.create(null);
  selected.runtimePackageManifests = Object.create(null);
  for (const name of recipe.base.features ?? []) {
    need(Object.hasOwn(base.featurePeers ?? {}, name) || Object.hasOwn(base.runtimePackageManifests ?? {}, name),
      'Unknown selected base runtime feature: ' + name);
    if (Object.hasOwn(base.featurePeers ?? {}, name)) put(selected.featurePeers, name, copy(base.featurePeers[name]));
    if (Object.hasOwn(base.runtimePackageManifests ?? {}, name))
      put(selected.runtimePackageManifests, name, base.runtimePackageManifests[name]);
  }
  const browser = new Map((base.browserAssets ?? []).map(entry => [entry.server, entry]));
  selected.browserAssets = (recipe.base.browserAssets ?? []).map(server => {
    need(browser.has(server), 'Unknown selected base browser server: ' + server);
    return copy(browser.get(server));
  });
  // Native peers and original exclusions remain; the recipe may omit explicit files.
  // Runtime-profile still chooses which native dependencies to install.
  if (recipe.product !== undefined) selected.product = copy(recipe.product);
  const wanted = selectedContributionPaths(contributions.map(entry => entry.path), recipe);
  const byPath = new Map(contributions.map(entry => [entry.path, entry]));
  need(byPath.size === contributions.length, 'Duplicate original contribution source');
  return { base: selected, contributions: wanted.map(path => byPath.get(path)), selection: recipe };
}

/** Installed and resumed packages bind the same original recipe bytes as their other inputs. */
export function validateSourceSelectionRecord(value) {
  need(plain(value) && Object.keys(value).every(key =>
    ['id', 'title', 'path', 'gitBlob', 'sha256', 'bytes'].includes(key)),
  'Invalid retained source selection record');
  identifier(value.id, 'ID');
  need(value.path === sourceSelectionPath(value.id) &&
    typeof value.title === 'string' && value.title.length > 0 && value.title.length <= 160 &&
    /^[0-9a-f]{40}$/.test(value.gitBlob ?? '') && /^[0-9a-f]{64}$/.test(value.sha256 ?? '') &&
    Number.isSafeInteger(value.bytes) && value.bytes > 0 && value.bytes <= 1024 * 1024,
  'Retained source selection identity is incomplete');
  return value;
}

export function retainedSourceSelectionId(value) {
  return value === undefined ? 'all' : validateSourceSelectionRecord(value).id;
}

/** A continuation may omit the flag; an explicit different product needs its own output. */
export function requireSourceSelectionMatch(retained, requested) {
  if (requested === undefined) return retainedSourceSelectionId(retained);
  sourceSelectionPath(requested);
  if (retainedSourceSelectionId(retained) !== requested)
    throw Object.assign(new Error('The selected product differs from this original distribution. Use its retained selection or a new output directory.'),
      { code: 'DISTRIBUTION_SOURCE_SELECTION_CONFLICT' });
  return requested;
}
