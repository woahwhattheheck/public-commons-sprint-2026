#!/usr/bin/env node
// MIT. Installed entrypoint for the original pinned Census customer workflow.
import { constants } from 'node:fs';
import * as fs from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const sourceNames = ['operator-browser-journey.mjs', 'original-customer-continuation.mjs', 'run-installed-customer.mjs'];
const variables = new Map([
  ['--workspace', 'SCF_CENSUS_WORKSPACE'],
  ['--merchant-package', 'SCF_MERCHANT_PACKAGE'],
  ['--rust-binary', 'SCF_RUST_BINARY'],
  ['--playwright', 'SCF_PLAYWRIGHT_MODULE'],
  ['--chromium', 'SCF_CHROMIUM'],
  ['--python', 'SCF_PYTHON'],
]);
const help = `Census workbook customer

Usage:
  starforge census-workbook-customer prepare --workspace PATH
  starforge census-workbook-customer run --workspace PATH [runtime options]

prepare copies the three original scripts into an owned private workspace.
A repeated prepare verifies the same files and preserves completed customer state.
run prepares that workspace, then invokes the original browser, Analysis and Rust workflow.

Runtime options (the existing SCF_* environment variables also work):
  --merchant-package PATH  Original e287 installation with the two cf1e writer postimages
  --rust-binary PATH       Released 712ae7f7 Linux x86_64 Rust buyer executable
  --playwright PATH        Existing Playwright ESM entrypoint
  --chromium PATH          Existing Chromium executable
  --python PATH           Existing Python 3.11+ executable (default: python3)
  --workspace PATH        Private customer directory; required for prepare and run
  --help                  Print this help without opening a workspace

The installed README identifies exact source, runtime and public workbook hashes.
Use the same workspace to continue the retained customer. The original runner verifies
the selected e287 manifest, cf1e files, Rust executable and both Census workbooks.
`;

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

async function readRegular(path) {
  const handle = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    if (!(await handle.stat()).isFile()) fail('CUSTOMER_SOURCE_NOT_FILE', 'Customer source must be a regular file.');
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

async function canonicalTarget(path) {
  const remaining = [];
  for (let current = path; ; current = dirname(current)) {
    try { return resolve(await fs.realpath(current), ...remaining); }
    catch (error) {
      if (error.code !== 'ENOENT' || dirname(current) === current) throw error;
      remaining.unshift(basename(current));
    }
  }
}

async function prepare(workspace) {
  let originalEntry;
  try { originalEntry = await fs.lstat(workspace); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (originalEntry && (!originalEntry.isDirectory() || originalEntry.isSymbolicLink())) {
    fail('CUSTOMER_WORKSPACE_NOT_DIRECTORY', 'The customer workspace must be a real directory.');
  }
  workspace = await canonicalTarget(workspace);
  const canonicalSource = await fs.realpath(here);
  const insideSource = relative(canonicalSource, workspace);
  if (!insideSource || (!insideSource.startsWith('..' + sep) && insideSource !== '..' && !isAbsolute(insideSource))) {
    fail('CUSTOMER_WORKSPACE_IN_SOURCE', 'Choose a customer workspace outside the installed source directory.');
  }
  await fs.mkdir(workspace, { recursive: true, mode: 0o700 });
  const directory = await fs.lstat(workspace);
  if (!directory.isDirectory() || directory.isSymbolicLink()) fail('CUSTOMER_WORKSPACE_NOT_DIRECTORY', 'The customer workspace must be a real directory.');
  await fs.chmod(workspace, 0o700);
  const files = [];
  for (const name of sourceNames) {
    const bytes = await readRegular(join(here, name));
    const sha256 = hash(bytes);
    const destination = join(workspace, name);
    let existing;
    try { existing = await readRegular(destination); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (existing !== undefined) {
      if (hash(existing) !== sha256 || existing.length !== bytes.length) fail('CUSTOMER_SOURCE_CHANGED', name + ' differs from this installed customer. Retain its source and state together.');
    } else {
      const temporary = join(workspace, '.census-source-' + randomUUID());
      const handle = await fs.open(temporary, 'wx', 0o600);
      try {
        try {
          await handle.writeFile(bytes);
          await handle.sync();
        } finally {
          await handle.close();
        }
        try { await fs.link(temporary, destination); }
        catch (error) { if (error.code !== 'EEXIST') throw error; }
        const retained = await readRegular(destination);
        if (hash(retained) !== sha256 || retained.length !== bytes.length) fail('CUSTOMER_SOURCE_CHANGED', name + ' was created by a different customer source.');
      } finally {
        await fs.unlink(temporary);
      }
    }
    files.push({ name, bytes: bytes.length, sha256 });
  }
  const handle = await fs.open(workspace, constants.O_RDONLY | constants.O_DIRECTORY);
  try { await handle.sync(); } finally { await handle.close(); }
  return { schema: 'stellar-forge.census-customer-preparation.v1', workspace, files };
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.length || args.includes('--help') || args.includes('-h')) {
    process.stdout.write(help);
    return;
  }
  const mode = args.shift();
  if (!['prepare', 'run'].includes(mode)) fail('CUSTOMER_COMMAND_REQUIRED', 'Choose prepare or run. Use --help for the complete command.');
  const supplied = new Set();
  while (args.length) {
    const option = args.shift(), variable = variables.get(option);
    if (!variable || supplied.has(option)) fail('CUSTOMER_OPTION_INVALID', 'Unknown or repeated customer option: ' + option);
    const value = args.shift();
    if (!value || value.startsWith('--')) fail('CUSTOMER_OPTION_VALUE_REQUIRED', option + ' needs a path.');
    supplied.add(option);
    process.env[variable] = resolve(value);
  }
  const workspaceValue = process.env.SCF_CENSUS_WORKSPACE;
  if (!workspaceValue) fail('CUSTOMER_WORKSPACE_REQUIRED', 'Set --workspace or SCF_CENSUS_WORKSPACE to an owned directory.');
  const workspace = resolve(workspaceValue);
  if (mode === 'run') {
    for (const name of ['SCF_MERCHANT_PACKAGE', 'SCF_RUST_BINARY', 'SCF_PLAYWRIGHT_MODULE', 'SCF_CHROMIUM']) {
      if (!process.env[name]) fail('CUSTOMER_RUNTIME_REQUIRED', name + ' is required. Use --help for its matching option.');
    }
  }
  const result = await prepare(workspace);
  process.env.SCF_CENSUS_WORKSPACE = result.workspace;
  if (mode === 'prepare') {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return;
  }
  await import(pathToFileURL(join(result.workspace, 'run-installed-customer.mjs')).href);
}

try { await main(); }
catch (error) {
  process.stderr.write(JSON.stringify({ code: error.code || 'CENSUS_CUSTOMER_FAILED', message: error.message }) + '\n');
  process.exitCode = 1;
}
