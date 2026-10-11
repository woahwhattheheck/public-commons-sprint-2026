#!/usr/bin/env node
// MIT. Maintained merchant packages through the original SF46 installation.
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inspectMerchantPackage, prepareMerchantPackage } from './merchant-package.mjs';
import { install, main as productMain } from './product.mjs';

const HELP = `Starforge | managed merchant installation

  starforge installation inspect PACKAGE_DIRECTORY [--expect-manifest SHA256]
  starforge installation prepare PACKAGE_DIRECTORY --out DIRECTORY [--expect-manifest SHA256]
  starforge installation install PACKAGE_DIRECTORY --home DIRECTORY [--activate] [--expect-manifest SHA256]
  starforge installation inspect-runtime RUNTIME_DIRECTORY [--expect-manifest SHA256] [--load]
  starforge installation prepare-runtime RUNTIME_DIRECTORY --out DIRECTORY [--expect-manifest SHA256]
  starforge installation adopt-runtime RUNTIME_DIRECTORY --home DIRECTORY [--activate] [--expect-manifest SHA256]
  starforge installation runtime-status --home DIRECTORY [--release RELEASE_ID] [--load]
  starforge installation status --home DIRECTORY
  starforge installation activate RELEASE_ID --home DIRECTORY
  starforge installation rollback --home DIRECTORY
  starforge installation doctor --home DIRECTORY [--native] [--feature NAME]...
  starforge installation run COMMAND --home DIRECTORY -- ORIGINAL_ARGUMENTS

PACKAGE_DIRECTORY contains the maintained package.json, manifest.json and source/.
--expect-manifest compares the SHA-256 of that original manifest.json file.
prepare retains a complete portable release at a new output directory.
install prepares an owned temporary release and uses the existing SF46 installer.
The first install becomes active; later installs are staged unless --activate is
supplied. The original home/forge.mjs remains the stable installed entry point.

Use run starforge --home DIRECTORY -- init|run|source ... for the maintained
toolkit's workspace commands. status lists every original installed command.
Configuration and merchant state live in home/config and home/state.
adopt-runtime uses an existing READY original runtime installation. Its source,
profile, lockfile and dependency directory stay at their recorded location;
each managed release binds that runtime identity for staging and rollback.
Guide: sf46-release/MANAGED_PACKAGE.md
`;

function requiredPath(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(name + ' is required');
  return value;
}

function optionsFor(args, allowed) {
  const options = { positional: [] };
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (!argument.startsWith('--')) { options.positional.push(argument); continue; }
    if (!allowed.includes(argument)) throw new TypeError('Unknown option: ' + argument + '\n' + HELP);
    if (Object.hasOwn(options, argument)) throw new TypeError('Duplicate option: ' + argument);
    if (argument === '--activate' || argument === '--load') options[argument] = true;
    else {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw new TypeError(argument + ' requires a value');
      options[argument] = value;
    }
  }
  return options;
}

async function destinationPath(input) {
  let path = resolve(input);
  const missing = [];
  for (;;) {
    try { return join(await realpath(path), ...missing); }
    catch (error) {
      if (error.code !== 'ENOENT' || dirname(path) === path) throw error;
      missing.unshift(basename(path)); path = dirname(path);
    }
  }
}

/** Install one inspected package using the original staging/selection lifecycle. */
export async function installMerchantPackage({ packageDirectory, home, activate = false, expectedManifest } = {}) {
  requiredPath(packageDirectory, 'packageDirectory');
  requiredPath(home, 'home');
  if (typeof activate !== 'boolean') throw new TypeError('activate must be a boolean');

  const temporary = await mkdtemp(join(tmpdir(), 'starforge-package-install-'));
  let installed, prepared, failure, cleanup, failed = false;
  try {
    prepared = await prepareMerchantPackage({ packageDirectory, output: join(temporary, 'release'), expectedManifest });
    const destination = await destinationPath(home);
    if (destination === prepared.packageDirectory || destination.startsWith(prepared.packageDirectory + sep))
      throw new Error('Installation must be outside the original merchant package');
    installed = await install(prepared.release, home, { expected: prepared.digest, activate });
  } catch (error) { failed = true; failure = error; }
  try { await rm(temporary, { recursive: true, force: true }); }
  catch (error) {
    cleanup = { state: 'RETAINED', directory: temporary, error: error.message,
      ...(error.code ? { code: error.code } : {}) };
  }
  // A cleanup error must preserve an already completed install or its original
  // failure. Only this invocation's mkdtemp directory is ever removed here.
  if (failed) {
    if (cleanup && failure && typeof failure === 'object' && Object.isExtensible(failure))
      failure.temporaryCleanup = cleanup;
    throw failure;
  }
  return { ...installed, releaseDirectory: join(installed.home, 'releases', installed.releaseId),
    packageName: prepared.packageName, packageVersion: prepared.packageVersion,
    sourceCommit: prepared.sourceCommit, sourceManifestSha256: prepared.sourceManifestSha256,
    ...(cleanup ? { temporaryCleanup: cleanup } : {}) };
}

export async function main(args = process.argv.slice(2)) {
  const [command, ...rest] = args;
  if (!command || ['help', '--help', '-h'].includes(command) ||
      rest.length === 1 && ['--help', '-h'].includes(rest[0])) {
    console.log(HELP); return 0;
  }
  if (['status', 'activate', 'rollback', 'doctor', 'run'].includes(command)) {
    const separator = command === 'run' ? rest.indexOf('--') : -1;
    if (!(separator < 0 ? rest : rest.slice(0, separator)).includes('--home'))
      throw new TypeError(command + ' requires --home DIRECTORY\n' + HELP);
    return productMain(args);
  }

  const runtimeOptions = { 'inspect-runtime': ['--expect-manifest', '--load'],
    'prepare-runtime': ['--out', '--expect-manifest'],
    'adopt-runtime': ['--home', '--activate', '--expect-manifest'],
    'runtime-status': ['--home', '--release', '--load'] };
  if (Object.hasOwn(runtimeOptions, command)) {
    const options = optionsFor(rest, runtimeOptions[command]);
    const runtime = await import('./runtime-package.mjs');
    let result;
    if (command === 'runtime-status') {
      if (options.positional.length) throw new TypeError('runtime-status accepts --home and optional --release, --load');
      result = await runtime.inspectInstalledRuntime({ home: requiredPath(options['--home'], '--home'),
        releaseId: options['--release'], load: options['--load'] ?? false });
    } else {
      if (options.positional.length !== 1) throw new TypeError(command + ' requires one original runtime directory\n' + HELP);
      const directory = requiredPath(options.positional[0], 'runtime directory');
      const expectedManifest = options['--expect-manifest'];
      if (command === 'inspect-runtime') result = await runtime.inspectMerchantRuntime(directory, {
        expectedManifest, load: options['--load'] ?? false });
      else if (command === 'prepare-runtime') result = await runtime.prepareMerchantRuntime({ directory,
        output: requiredPath(options['--out'], '--out'), expectedManifest });
      else result = await runtime.adoptMerchantRuntime({ directory, home: requiredPath(options['--home'], '--home'),
        activate: options['--activate'] ?? false, expectedManifest });
    }
    console.log(JSON.stringify(result, null, 2));
    return 0;
  }

  const allowed = { inspect: ['--expect-manifest'], prepare: ['--out', '--expect-manifest'],
    install: ['--home', '--activate', '--expect-manifest'] };
  if (!Object.hasOwn(allowed, command)) throw new TypeError('Unknown installation command: ' + command + '\n' + HELP);
  const options = optionsFor(rest, allowed[command]);
  if (options.positional.length !== 1) throw new TypeError(command + ' requires one package directory\n' + HELP);
  const packageDirectory = requiredPath(options.positional[0], 'package directory');
  const expectedManifest = options['--expect-manifest'];
  let result;
  if (command === 'inspect') result = await inspectMerchantPackage(packageDirectory, { expectedManifest });
  else if (command === 'prepare') result = await prepareMerchantPackage({ packageDirectory,
    output: requiredPath(options['--out'], '--out'), expectedManifest });
  else result = await installMerchantPackage({ packageDirectory, home: requiredPath(options['--home'], '--home'),
    activate: options['--activate'] ?? false, expectedManifest });
  console.log(JSON.stringify(result, null, 2));
  return 0;
}

if (process.argv[1] && await realpath(resolve(process.argv[1])).then(
  entry => pathToFileURL(entry).href === import.meta.url, () => false))
  main().then(code => { process.exitCode = code; }).catch(error => {
    console.error(error?.message ?? String(error));
    if (error?.temporaryCleanup) console.error(JSON.stringify({ temporaryCleanup: error.temporaryCleanup }, null, 2));
    process.exitCode = 1;
  });
