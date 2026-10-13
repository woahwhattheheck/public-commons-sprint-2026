#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import crypto from 'node:crypto';

const args = process.argv.slice(2);
const position = args.indexOf('--application');
if (position < 0 || !args[position + 1]) throw new Error('Select --application DIRECTORY');
const application = await fs.realpath(path.resolve(args[position + 1]));
const selected = JSON.parse(await fs.readFile(path.join(application, 'package.json'), 'utf8'));
const lockPath = path.join(application, 'package-lock.json');
const lockBytes = await fs.readFile(lockPath);
const lock = JSON.parse(lockBytes);
if (![2, 3].includes(lock.lockfileVersion) || !lock.packages) throw new Error('The actual resolved npm lock is required');
if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('The selected Hocuspocus runtime requires Node 22 or newer');
const requireFromApplication = createRequire(path.join(application, 'package.json'));
const requested = Object.keys({ ...(selected.dependencies || {}), ...(selected.devDependencies || {}), ...(selected.optionalDependencies || {}) }).sort();
const packages = [];
for (const name of requested) {
  const packageFile = path.join(application, 'node_modules', ...name.split('/'), 'package.json');
  let metadata;
  try { metadata = JSON.parse(await fs.readFile(packageFile, 'utf8')); }
  catch (error) {
    if (selected.optionalDependencies?.[name] && error.code === 'ENOENT') continue;
    throw error;
  }
  if (metadata.name !== name) throw new Error('The installed package name differs: ' + name);
  const original = lock.packages['node_modules/' + name];
  if (!original || original.version !== metadata.version) throw new Error('The installed version differs from the original resolved lock: ' + name);
  let entry = null;
  try { entry = requireFromApplication.resolve(name); } catch (error) {
    if (error.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED' && error.code !== 'MODULE_NOT_FOUND') throw error;
  }
  packages.push({ name, version: metadata.version, entry, packageFile,
    packageSha256: crypto.createHash('sha256').update(await fs.readFile(packageFile)).digest('hex'),
    resolved: original.resolved || null, integrity: original.integrity || null });
}
const capabilities = {};
for (const [name, keys] of [
  ['@hocuspocus/server', ['Server', 'Hocuspocus']],
  ['@hocuspocus/provider', ['HocuspocusProvider', 'HocuspocusProviderWebsocket']],
  ['@hocuspocus/transformer', ['TiptapTransformer']],
  ['@tiptap/core', ['Editor', 'getSchema']],
  ['yjs', ['Doc', 'applyUpdate', 'encodeStateAsUpdate']]
]) {
  if (!packages.some(x => x.name === name)) continue;
  const entry = requireFromApplication.resolve(name);
  const module = await import(pathToFileURL(entry).href);
  const candidate = module.default && typeof module.default === 'object' ? { ...module.default, ...module } : module;
  const found = {};
  for (const key of keys) {
    found[key] = typeof candidate[key];
    if (found[key] !== 'function' && !(name === '@hocuspocus/transformer' && found[key] === 'object')) {
      throw new Error('The original native package export is unavailable: ' + name + '.' + key);
    }
  }
  capabilities[name] = found;
}
process.stdout.write(JSON.stringify({
  schema: 'hocuspocus.runtime-inspection.v1', application,
  package: { name: selected.name || null, version: selected.version || null },
  node: { executable: process.execPath, version: process.versions.node, abi: process.versions.modules,
    platform: process.platform, architecture: process.arch },
  lockSha256: crypto.createHash('sha256').update(lockBytes).digest('hex'),
  packages, capabilities
}, null, 2) + '\n');
