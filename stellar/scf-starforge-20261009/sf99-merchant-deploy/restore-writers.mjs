// MIT. Explicit retargeting of operator-owned external writer units.
import { constants } from 'node:fs';
import { open, lstat, realpath, readdir, mkdir } from 'node:fs/promises';
import { resolve, isAbsolute, join, dirname, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { unitWord } from './host.mjs';

const SCHEMA = 'stellar-forge.merchant-writer-templates.v1';
const RESULT_SCHEMA = 'stellar-forge.merchant-restored-writers.v1';
const MAX_FILE = 256 * 1024, MAX_TOTAL = 512 * 1024;
const hash = value => createHash('sha256').update(value).digest('hex');
const need = (yes, message) => { if (!yes) throw new Error(message); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fields = (value, allowed, name) => need(object(value) && Object.keys(value).every(key => allowed.includes(key)), 'Invalid ' + name);
const inside = (root, value) => value === root || value.startsWith(root + '/');
const tokenPattern = /\{\{([A-Z][A-Z0-9_]{0,63})\}\}/g;
const validUnit = unit => typeof unit === 'string' && /^[A-Za-z0-9_@:-][A-Za-z0-9_.@:-]*\.(service|timer|socket|path)$/.test(unit);
const execDirectives = new Set(['ExecCondition','ExecStartPre','ExecStart','ExecStartPost','ExecReload','ExecStop','ExecStopPost']);
const pathDirectives = new Set(['ReadWritePaths','ReadOnlyPaths','InaccessiblePaths','ExecPaths','NoExecPaths']);

function absolute(value, name = 'path') {
  need(typeof value === 'string' && isAbsolute(value) && resolve(value) === value && value !== '/' &&
    !/[\x00-\x1f\x7f]/.test(value), 'Normalized absolute ' + name + ' required');
  return value;
}
async function realDirectory(directory) {
  absolute(directory); const info = await lstat(directory);
  need(info.isDirectory() && await realpath(directory) === directory, 'Real directory required: ' + directory);
}
async function pin(file) {
  absolute(file); need(await realpath(file) === file, 'Writer file must not traverse a symlink: ' + file);
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    need(before.isFile() && before.nlink === 1 && before.size <= MAX_FILE, 'Regular bounded writer file required: ' + file);
    const bytes = await handle.readFile(), after = await handle.stat();
    need(bytes.length === before.size && before.size === after.size && before.mtimeMs === after.mtimeMs &&
      before.ctimeMs === after.ctimeMs, 'Writer file changed while reading: ' + file);
    return { bytes, sha256: hash(bytes), mode: before.mode & 0o7777, uid: before.uid, gid: before.gid };
  } finally { await handle.close(); }
}
function text(bytes) {
  const value = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  need(!/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value), 'Writer templates must be plain UTF-8 systemd text');
  return value;
}
function bindingsOf(items) {
  need(Array.isArray(items) && items.length <= 128, 'Explicit writer bindings array required, including an empty array for unchanged reviewed files');
  const names = new Set();
  return items.map(item => {
    fields(item, ['name','path','format','originalStyle','prefix'], 'writer binding');
    need(typeof item.name === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(item.name) && !names.has(item.name), 'Distinct named writer bindings required');
    names.add(item.name); absolute(item.path, 'original writer binding');
    need(['exec-argument','path-list-item','working-directory'].includes(item.format), 'Explicit supported writer binding format required');
    const prefix = item.prefix ?? '';
    need(item.format === 'path-list-item' ? ['','-','+','-+'].includes(prefix) :
      item.format === 'working-directory' ? ['', '-'].includes(prefix) : prefix === '', 'Unsupported writer path prefix');
    const originalStyle = item.format === 'working-directory' ? undefined : item.originalStyle ?? 'quoted';
    need(item.format === 'working-directory' ? item.originalStyle === undefined : ['quoted','bare'].includes(originalStyle), 'Invalid writer originalStyle');
    return { name: item.name, path: item.path, format: item.format,
      ...(originalStyle ? { originalStyle } : {}), ...(prefix ? { prefix } : {}) };
  });
}

// Used only to identify complete explicitly selected words, never to rewrite
// arbitrary command strings. Original physical text remains byte-for-byte intact.
function words(value) {
  const result = []; let start = -1, quote = null, escaped = false;
  for (let i = 0; i <= value.length; i++) {
    const c = value[i];
    if (i === value.length || !quote && !escaped && /\s/.test(c)) {
      if (start >= 0) { result.push(value.slice(start, i)); start = -1; }
      if (i === value.length) break;
      continue;
    }
    if (start < 0) start = i;
    if (escaped) { escaped = false; continue; }
    if (c === '\\') { escaped = true; continue; }
    if (quote) { if (c === quote) quote = null; }
    else if (c === '"' || c === "'") quote = c;
  }
  need(!quote && !escaped, 'Selected writer directive has unclosed quoting or escaping');
  return result;
}
function logicalLines(value) {
  const lines = []; let current = '';
  for (let line of value.split('\n')) {
    line = line.replace(/\r$/, '');
    if (/^\s*[#;]/.test(line)) { need(!line.includes('{{') && !line.includes('}}'), 'Writer placeholders cannot appear in comments'); continue; }
    const trailing = line.match(/\\+$/)?.[0].length ?? 0;
    current += trailing % 2 ? line.slice(0, -1) + ' ' : line;
    if (!(trailing % 2)) { lines.push(current); current = ''; }
  }
  need(!current, 'Unfinished writer directive continuation');
  return lines;
}
function commandModifiers(word) {
  let result = '';
  for (let i = 0; i < word.length; i++) {
    let character = word[i];
    if (character === '"' || character === "'") continue;
    if (character === '\\') {
      const escaped = word.slice(i + 1), numeric = escaped.match(/^(?:x([0-9a-fA-F]{2})|u([0-9a-fA-F]{4})|U([0-9a-fA-F]{8})|([0-7]{3}))/);
      if (numeric) {
        const value = numeric[1] ?? numeric[2] ?? numeric[3] ?? numeric[4];
        character = String.fromCodePoint(parseInt(value, numeric[4] ? 8 : 16)); i += numeric[0].length;
      } else {
        const simple = { a: '\x07', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v', s: ' ', '\\': '\\', '"': '"', "'": "'" };
        need(Object.hasOwn(simple, escaped[0]), 'Unsupported escape in selected Exec command prefix');
        character = simple[escaped[0]]; i++;
      }
    }
    if (!'-@:+!'.includes(character)) break;
    result += character;
  }
  return result;
}
function contexts(templateText, bindings) {
  const byName = new Map(bindings.map(binding => [binding.name, binding])), used = new Map();
  need(!templateText.replace(tokenPattern, '').includes('{{') && !templateText.replace(tokenPattern, '').includes('}}'), 'Malformed writer placeholder');
  let section = '';
  for (const line of logicalLines(templateText)) {
    const heading = line.match(/^\s*\[([A-Za-z][A-Za-z0-9-]*)\]\s*$/);
    if (heading) { section = heading[1]; continue; }
    const tokens = [...line.matchAll(tokenPattern)]; if (!tokens.length) continue;
    const assignment = line.match(/^\s*([A-Za-z][A-Za-z0-9]*)\s*=\s*(.*?)\s*$/);
    need(assignment, 'Writer placeholder must be in an explicit unit directive');
    const [, directive, value] = assignment;
    const processSection = ['Service','Socket'].includes(section), parts = words(value);
    for (const match of tokens) {
      const binding = byName.get(match[1]); need(binding, 'Undeclared writer placeholder: ' + match[1]);
      const indices = parts.flatMap((part, index) => part === match[0] ? [index] : []);
      need(indices.length > 0 && parts.every(part => !part.includes(match[0]) || part === match[0]),
        'Writer placeholder must select one whole unquoted argument, list item, or directory value: ' + binding.name);
      let environmentExpansion = false;
      if (binding.format === 'exec-argument') {
        need(processSection && execDirectives.has(directive), 'exec-argument binding requires an Exec directive');
        // systemd expands environment in arguments, not in the executable;
        // the existing colon command prefix disables that later expansion.
        const modes = indices.map(index => {
          let first = 0;
          for (let cursor = 0; cursor < index; cursor++) if (parts[cursor] === ';') first = cursor + 1;
          return index !== first && !commandModifiers(parts[first]).includes(':');
        });
        need(modes.every(mode => mode === modes[0]), 'Use different binding names for an executable and an environment-expanded argument');
        environmentExpansion = modes[0];
      } else if (binding.format === 'path-list-item') {
        need(processSection && pathDirectives.has(directive) || section === 'Unit' &&
          ['RequiresMountsFor','WantsMountsFor'].includes(directive), 'path-list-item binding requires a supported path-list directive');
      } else need(processSection && directive === 'WorkingDirectory' && value === match[0],
        'working-directory binding requires the entire raw WorkingDirectory value');
      need(!used.has(binding.name) || used.get(binding.name) === environmentExpansion,
        'Use different binding names for command contexts with different environment expansion');
      used.set(binding.name, environmentExpansion);
    }
  }
  for (const binding of bindings) need(used.has(binding.name), 'Unused writer binding: ' + binding.name);
  return used;
}
function renderedPath(binding, path, environmentExpansion, original) {
  absolute(path, 'mapped writer binding');
  const prefix = binding.prefix ?? '';
  if (binding.format === 'working-directory') {
    // This is a raw scalar. A terminal '/.' protects a literal final space or
    // backslash from config-line trimming/continuation without changing its path.
    return prefix + (/[\s\\]$/.test(path) ? path + '/.' : path).replaceAll('%', '%%');
  }
  const value = prefix + path;
  if (original && binding.originalStyle === 'bare') {
    need(!/[\s'"\\]/.test(value), 'Selected original bare writer path requires quoting');
    return value.replaceAll('%', '%%').replaceAll('$', () => environmentExpansion ? '$$' : '$');
  }
  return unitWord(value, environmentExpansion);
}
function render(templateText, bindings, paths, original) {
  const modes = contexts(templateText, bindings), byName = new Map(bindings.map(binding => [binding.name, binding]));
  return templateText.replace(tokenPattern, (_token, name) => renderedPath(byName.get(name), paths.get(name), modes.get(name), original));
}
async function installedFiles(directory, unit) {
  const result = [join(directory, unit)], dropins = join(directory, unit + '.d');
  try {
    await realDirectory(dropins);
    for (const name of (await readdir(dropins)).sort()) if (name.endsWith('.conf')) result.push(join(dropins, name));
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return result;
}
function selectedRoot(roots, path) {
  const matches = roots.filter(root => root.kind === 'file' ? root.path === path : inside(root.path, path));
  need(matches.length === 1, 'Writer binding must select exactly one original recovery root: ' + path);
  return matches[0];
}

/** Pin before ingress changes. Persist this serializable result in the original
 * operation journal; resume must reuse it rather than re-pin installed candidates.
 * Actual systemd FragmentPath/DropInPaths must additionally match these exact files.
 * plan.raw.writerTemplates: [{unit, files:[{path,template,bindings:[
 *   {name,path,format,originalStyle?,prefix?}]}]}]. Empty bindings retain reviewed text.
 */
export async function loadWriterTemplates(plan) {
  const units = plan.extraWriterUnits ?? [], entries = plan.raw.writerTemplates ?? [];
  need(Array.isArray(units) && units.length <= 32 && units.every(validUnit) && new Set(units).size === units.length,
    'Distinct declared external writer units required');
  need(Array.isArray(entries) && entries.length === units.length, 'Migration requires a reviewed template for every declared external writer/activation unit');
  const systemdDirectory = absolute(plan.systemdDirectory); await realDirectory(systemdDirectory);
  const roots = [];
  for (const root of plan.recovery.roots) {
    absolute(root.path, 'selected recovery root'); const info = await lstat(root.path);
    need(await realpath(root.path) === root.path && (info.isDirectory() || info.isFile() && info.nlink === 1), 'Real selected recovery root required');
    roots.push({ name: root.name, path: root.path, kind: info.isDirectory() ? 'directory' : 'file' });
  }
  const files = [], seenUnits = new Set(); let total = 0;
  for (const entry of entries) {
    fields(entry, ['unit','files'], 'writer template entry');
    need(units.includes(entry.unit) && !seenUnits.has(entry.unit), 'Each declared writer unit needs exactly one template entry'); seenUnits.add(entry.unit);
    const expected = await installedFiles(systemdDirectory, entry.unit);
    need(Array.isArray(entry.files) && entry.files.length === expected.length && entry.files.length <= 64,
      'Preserve the complete original writer fragment and all original drop-ins: ' + entry.unit);
    const selected = new Set();
    for (const item of entry.files) {
      fields(item, ['path','template','bindings'], 'writer template file');
      absolute(item.path, 'installed writer file'); absolute(item.template, 'reviewed writer template');
      need(expected.includes(item.path) && !selected.has(item.path), 'Select each exact original writer fragment/drop-in once'); selected.add(item.path);
      const original = await pin(item.path), template = await pin(item.template), templateText = text(template.bytes);
      total += original.bytes.length + template.bytes.length; need(total <= MAX_TOTAL, 'Combined writer templates exceed the operation journal limit');
      const bindings = bindingsOf(item.bindings);
      for (const binding of bindings) selectedRoot(roots, binding.path);
      const rendered = Buffer.from(render(templateText, bindings, new Map(bindings.map(binding => [binding.name, binding.path])), true));
      need(rendered.equals(original.bytes), 'Rendering selected ORIGINAL paths must exactly reproduce installed writer bytes: ' + item.path);
      files.push({ unit: entry.unit, path: item.path, template: item.template, templateSha256: template.sha256,
        templateText, bindings, original: { sha256: original.sha256, bytesBase64: original.bytes.toString('base64'),
          mode: original.mode, uid: original.uid, gid: original.gid } });
    }
    need(JSON.stringify(await installedFiles(systemdDirectory, entry.unit)) === JSON.stringify(expected),
      'Original writer drop-in set changed during template selection: ' + entry.unit);
  }
  return { schema: SCHEMA, systemdDirectory, units: [...units], files };
}

async function createFile(file, bytes) {
  const handle = await open(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
}

/** Stage only. No original file, service, unit directory, or state is modified. */
export async function prepareRestoredWriters({ templates, mappings, destination }) {
  need(templates?.schema === SCHEMA && Array.isArray(templates.units) && Array.isArray(templates.files), 'Pinned original writer templates required');
  absolute(templates.systemdDirectory); absolute(destination, 'new restored host destination'); await realDirectory(destination);
  need(Array.isArray(mappings) && mappings.length > 0 && mappings.length <= 20, 'Complete original restored root mappings required');
  for (const mapping of mappings) {
    absolute(mapping.from); absolute(mapping.to);
    need(['file','directory'].includes(mapping.kind) && inside(destination, mapping.to), 'Writer target must belong to the restored destination');
  }
  const prepared = []; let total = 0;
  for (const file of templates.files) {
    need(templates.units.includes(file.unit) && validUnit(file.unit), 'Unexpected pinned writer unit');
    absolute(file.path); absolute(file.template);
    const local = relative(templates.systemdDirectory, file.path);
    need(local === file.unit || dirname(local) === file.unit + '.d' && local.endsWith('.conf'), 'Pinned writer path leaves its original unit');
    const bindings = bindingsOf(file.bindings), templateText = text(Buffer.from(file.templateText));
    const original = Buffer.from(file.original.bytesBase64, 'base64');
    total += original.length + Buffer.byteLength(templateText); need(total <= MAX_TOTAL, 'Pinned writer templates exceed the operation journal limit');
    need(hash(templateText) === file.templateSha256 && hash(original) === file.original.sha256 &&
      Buffer.from(render(templateText, bindings, new Map(bindings.map(binding => [binding.name, binding.path])), true)).equals(original),
      'Pinned writer template/original digest changed');
    const changes = bindings.map(binding => {
      const root = selectedRoot(mappings.map(mapping => ({ ...mapping, path: mapping.from })), binding.path);
      return { ...binding, from: binding.path, to: root.kind === 'file' ? root.to : join(root.to, relative(root.from, binding.path)), root: root.name };
    });
    const bytes = Buffer.from(render(templateText, bindings, new Map(changes.map(change => [change.name, change.to])), false));
    prepared.push({ file, local, bindings, changes, bytes });
  }
  need(new Set(prepared.map(item => item.file.path)).size === prepared.length && templates.units.every(unit => prepared.some(item => item.local === unit)),
    'Pinned writer set must retain every declared unit fragment without duplicate files');
  const directory = join(destination, 'writers'); await mkdir(directory, { mode: 0o700 });
  await mkdir(join(directory, 'units'), { mode: 0o700 }); await mkdir(join(directory, 'templates'), { mode: 0o700 });
  const files = [], nextTemplates = templates.units.map(unit => ({ unit, files: [] }));
  for (const item of prepared) {
    const candidate = join(directory, 'units', item.local), nextTemplate = join(directory, 'templates', item.local);
    if (dirname(item.local) !== '.') {
      for (const base of ['units','templates']) await mkdir(join(directory, base, dirname(item.local)), { mode: 0o700, recursive: true });
    }
    await createFile(candidate, item.bytes); await createFile(nextTemplate, Buffer.from(item.file.templateText));
    const nextBindings = item.changes.map(change => ({ name: change.name, path: change.to, format: change.format,
      ...(change.format === 'working-directory' ? {} : { originalStyle: 'quoted' }), ...(change.prefix ? { prefix: change.prefix } : {}) }));
    nextTemplates.find(entry => entry.unit === item.file.unit).files.push({ path: item.file.path, template: nextTemplate, bindings: nextBindings });
    files.push({ ...item.file, candidate, sha256: hash(item.bytes), bytesBase64: item.bytes.toString('base64'),
      nextTemplate, changes: item.changes });
  }
  const result = { schema: RESULT_SCHEMA, directory, units: [...templates.units], files, nextTemplates,
    mappings: mappings.map(({ name, kind, from, to }) => ({ name, kind, from, to })) };
  await createFile(join(directory, 'writers.json'), Buffer.from(JSON.stringify(result, null, 2) + '\n'));
  // Sync the created tree before the controller records it as a resumable candidate.
  for (const parent of new Set([...files.flatMap(file => [dirname(file.candidate), dirname(file.nextTemplate)]),
    join(directory, 'units'), join(directory, 'templates'), directory, destination])) {
    const handle = await open(parent, constants.O_RDONLY | constants.O_DIRECTORY);
    try { await handle.sync(); } finally { await handle.close(); }
  }
  return result;
}
