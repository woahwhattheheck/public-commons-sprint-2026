// MIT. Retain the selected Node 24 runtime and the complete declared application.
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  need, hash, jsonBytes, canonical, directory, confined, writeExact, readJSON,
  fileDescriptor, verifyFile, copyDeclared, exists, syncDirectory, relativeName,
} from './files.mjs';

const execute = promisify(execFile);
export const RUNTIME_SCHEMA = 'paycashless.node-runtime.v1';
export const SOURCE_SCHEMA = 'paycashless.application-source.v1';
export const REQUIRED_APPLICATION_FILES = Object.freeze([
  "README.md",
  "OPERATIONS.md",
  "COMMISSIONING.md",
  "SOURCES.md",
  "PAYCASHLESS_INTEGRATION.json",
  "PAYCASHLESS_MODEL.md",
  "PAYCASHLESS_OPERATOR.md",
  "SETTLEMENT_STREAM.md",
  "examples/configuration.example.json",
  "server.mjs",
  "cli.mjs",
  "worker.mjs",
  "operate-paycashless.mjs",
  "settlement-stream.mjs",
  "lib/workspace.mjs",
  "lib/paycashless.mjs",
  "lib/reports.mjs",
  "lib/catalogue.mjs",
  "lib/native.mjs",
  "lib/provider-auth.mjs",
  "lib/resources.mjs",
  "lib/transport.mjs",
  "lib/validation.mjs",
  "lib/webhooks.mjs",
  "lib/source-json.mjs",
  "lib/decimal.mjs",
  "lib/schema.mjs",
  "lib/files.mjs",
  "lib/archive.mjs",
  "lib/runtime.mjs",
  "lib/receiving.mjs",
  "lib/settlement-sse.mjs",
  "lib/settlement-stream.mjs",
  "web/app.mjs",
  "web/index.html",
  "web/styles.css",
  "web/journal.mjs",
  "web/sha256.mjs",
  "web/payment-display.mjs",
  "sources/paycashless-openapi.json",
  "sources/paycashless-projections.json",
  "sources/horizon-original.json",
  "sources/provider-source-receipts.json"
]);

async function linkedLibraries(executable) {
  if (process.platform !== 'linux') {
    throw Object.assign(new Error('Native retention currently requires Linux.'),
      { code: 'RUNTIME_PLATFORM_UNSUPPORTED' });
  }
  const { stdout, stderr } = await execute('ldd', [executable], {
    encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin', LANG: 'C' },
  });
  need(!stdout.includes('not found'), 'NATIVE_LIBRARY_MISSING');
  const selected = [];
  for (const line of stdout.split('\n')) {
    const match = line.match(/=>\s+(\/\S+)\s+\(/) ?? line.match(/^\s*(\/\S+)\s+\(/);
    if (match) selected.push(match[1]);
  }
  need(selected.some(file => /ld-linux|ld-musl/.test(path.basename(file))),
    'NATIVE_LOADER_NOT_IDENTIFIED');
  return { files: [...new Set(selected)], stdout, stderr };
}

export async function retainPaycashlessRuntime({
  directory: destination,
  nodeExecutable = process.execPath,
  licenseFiles = [],
} = {}) {
  await directory(destination);
  const manifestPath = path.join(destination, 'manifest.json');
  if (await exists(manifestPath)) return verifyPaycashlessRuntime({ directory: destination });
  nodeExecutable = await fs.realpath(nodeExecutable);
  const { stdout: nodeDescription } = await execute(nodeExecutable, ['-p',
    'JSON.stringify({version:process.version,versions:process.versions,release:process.release,platform:process.platform,arch:process.arch})'],
    { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  const node = JSON.parse(nodeDescription);
  need(Number(node.version.slice(1).split('.')[0]) === 24, 'NODE_24_REQUIRED');
  need(node.platform === process.platform && node.arch === process.arch,
    'NATIVE_RUNTIME_PLATFORM_MISMATCH');
  const libraries = await linkedLibraries(nodeExecutable);
  const originals = [...new Set([nodeExecutable, ...libraries.files, ...licenseFiles])];
  const files = [];
  const bindings = [];
  for (const original of originals) {
    need(path.isAbsolute(original), 'ABSOLUTE_RUNTIME_FILE_REQUIRED');
    const actual = await fs.realpath(original);
    const identity = await fileDescriptor(actual);
    const relative = 'objects/' + identity.sha256;
    if (!files.some(item => item.path === relative)) {
      await copyDeclared(path.dirname(actual),
        { ...identity, path: path.basename(actual) }, destination, relative);
      files.push({ ...identity, path: relative });
    }
    bindings.push({
      original, path: 'installed' + original,
      object: relative, mode: identity.mode,
      kind: original === nodeExecutable ? 'node' :
        licenseFiles.includes(original) ? 'license' : 'library',
    });
  }
  const loader = bindings.find(item => /\/ld-(linux|musl)/.test(item.original));
  need(loader, 'NATIVE_LOADER_NOT_IDENTIFIED');
  const selection = {
    schema: RUNTIME_SCHEMA, node,
    platform: { platform: process.platform, arch: process.arch, release: os.release() },
    files: files.sort((a, b) => a.path.localeCompare(b.path)),
    bindings: bindings.sort((a, b) => a.path.localeCompare(b.path)),
    nodePath: 'installed' + nodeExecutable,
    loaderPath: loader.path,
    libraryDirectories: [...new Set(bindings.filter(item => item.kind === 'library')
      .map(item => path.posix.dirname(item.path)))],
    discovery: { ldd: libraries.stdout, stderr: libraries.stderr },
  };
  const id = hash(Buffer.from(canonical(selection)));
  const manifest = { ...selection, id };
  await writeExact(manifestPath, jsonBytes(manifest));
  await reconstruct(destination, manifest);
  return verifyPaycashlessRuntime({ directory: destination });
}

export async function readPaycashlessRuntimeManifest({
  directory: root, expectedManifestSha256,
} = {}) {
  const bytes = await fs.readFile(await confined(root, 'manifest.json'));
  const manifestSha256 = hash(bytes);
  if (expectedManifestSha256) need(manifestSha256 === expectedManifestSha256,
    'RUNTIME_MANIFEST_MISMATCH');
  const manifest = JSON.parse(bytes);
  need(manifest.schema === RUNTIME_SCHEMA, 'RUNTIME_SCHEMA_MISMATCH');
  const { id, ...selection } = manifest;
  need(hash(Buffer.from(canonical(selection))) === id, 'RUNTIME_ID_MISMATCH');
  const seen = new Set();
  for (const file of manifest.files) {
    need(!seen.has(file.path), 'DUPLICATE_RUNTIME_MEMBER');
    seen.add(file.path);
    need(Number.isInteger(file.mode) && file.mode >= 0 && file.mode <= 0o777,
      'INVALID_RUNTIME_MODE');
  }
  const bindings = new Map();
  for (const binding of manifest.bindings) {
    need(binding.path.startsWith('installed/') && seen.has(binding.object) &&
      !bindings.has(binding.path), 'INVALID_RUNTIME_BINDING');
    need(Number.isInteger(binding.mode) && binding.mode >= 0 && binding.mode <= 0o777,
      'INVALID_RUNTIME_MODE');
    relativeName(binding.path);
    bindings.set(binding.path, binding);
  }
  need(bindings.get(manifest.nodePath)?.kind === 'node' &&
    bindings.get(manifest.loaderPath)?.kind === 'library', 'INVALID_RUNTIME_ENTRYPOINT');
  const directories = [...new Set(manifest.bindings.filter(item => item.kind === 'library')
    .map(item => path.posix.dirname(item.path)))];
  need(canonical(directories) === canonical(manifest.libraryDirectories),
    'INVALID_RUNTIME_LIBRARY_SELECTION');
  need(Number(manifest.node.version.slice(1).split('.')[0]) === 24, 'NODE_24_REQUIRED');
  return { manifest, manifestSha256, bytes };
}

function launcherSource(manifest) {
  const escaped = value => [...value].map(character =>
    [34, 92, 36, 96].includes(character.charCodeAt(0))
      ? String.fromCharCode(92) + character : character).join('');
  const quoted = value => "'" + value.replaceAll("'", "'\"'\"'") + "'";
  return [
    '#!/bin/sh', 'set -eu',
    'root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)',
    'exec "$root"/' + quoted(manifest.loaderPath) + ' --library-path "' +
      manifest.libraryDirectories.map(value => '$root/' + escaped(value)).join(':') +
      '" "$root"/' + quoted(manifest.nodePath) + ' "$@"', '',
  ].join('\n');
}

async function reconstruct(destination, manifest) {
  for (const binding of manifest.bindings) {
    const object = manifest.files.find(item => item.path === binding.object);
    await copyDeclared(destination, object, destination, binding.path);
    await fs.chmod(await confined(destination, binding.path), binding.mode);
  }
  const source = launcherSource(manifest);
  await writeExact(await confined(destination, 'bin/node', true), Buffer.from(source), 0o700);
}

export async function verifyPaycashlessRuntime({
  directory: root, expectedManifestSha256,
} = {}) {
  const selected = await readPaycashlessRuntimeManifest({ directory: root, expectedManifestSha256 });
  const { manifest } = selected;
  need(manifest.platform.platform === process.platform &&
    manifest.platform.arch === process.arch, 'RUNTIME_PLATFORM_MISMATCH');
  for (const file of manifest.files) await verifyFile(root, file);
  for (const binding of manifest.bindings) {
    const descriptor = manifest.files.find(file => file.path === binding.object);
    await verifyFile(root, { ...descriptor, path: binding.path, mode: binding.mode },
      { mode: true });
  }
  const launcher = await fileDescriptor(await confined(root, 'bin/node'));
  need(launcher.sha256 === hash(Buffer.from(launcherSource(manifest))) && launcher.mode === 0o700,
    'RUNTIME_LAUNCHER_MISMATCH');
  return {
    id: manifest.id, directory: root, manifest, manifestSha256: selected.manifestSha256,
    version: manifest.node.version, platform: manifest.platform,
    nodeExecutable: path.join(root, 'bin/node'),
  };
}

export async function restorePaycashlessRuntime({
  sourceDirectory, destination, expectedManifestSha256,
} = {}) {
  const selected = await readPaycashlessRuntimeManifest({
    directory: sourceDirectory, expectedManifestSha256,
  });
  await directory(destination);
  for (const file of selected.manifest.files) {
    await copyDeclared(sourceDirectory, file, destination);
  }
  await writeExact(path.join(destination, 'manifest.json'), selected.bytes);
  await reconstruct(destination, selected.manifest);
  return verifyPaycashlessRuntime({ directory: destination,
    expectedManifestSha256: selected.manifestSha256 });
}

export function publicPaycashlessRuntime(runtime) {
  return {
    id: runtime.id, manifestSha256: runtime.manifestSha256,
    version: runtime.version, platform: runtime.platform,
  };
}

export async function capturePaycashlessSource({ sourceDirectory, destination }) {
  const bytes = await fs.readFile(await confined(sourceDirectory, 'source-files.json'));
  const manifest = JSON.parse(bytes);
  need(manifest.schema === SOURCE_SCHEMA && Array.isArray(manifest.files),
    'APPLICATION_SOURCE_MANIFEST_REQUIRED');
  await directory(destination);
  const names = new Set();
  for (const file of manifest.files) {
    need(!names.has(file.path) && file.path !== 'source-files.json',
      'INVALID_SOURCE_COHORT');
    need(Number.isInteger(file.mode) && file.mode >= 0 && file.mode <= 0o777, 'INVALID_SOURCE_MODE');
    names.add(file.path);
    await copyDeclared(sourceDirectory, file, destination);
  }
  need(REQUIRED_APPLICATION_FILES.every(name => names.has(name)), 'INCOMPLETE_APPLICATION_SOURCE');
  await writeExact(path.join(destination, 'source-files.json'), bytes, 0o644);
  return {
    schema: SOURCE_SCHEMA, manifestSha256: hash(bytes),
    files: [...manifest.files, {
      path: 'source-files.json', bytes: bytes.length, sha256: hash(bytes), mode: 0o644,
    }],
    entrypoints: { server: 'server.mjs', cli: 'cli.mjs', worker:'worker.mjs' },
  };
}
