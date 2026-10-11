#!/usr/bin/env node
// MIT. Explicit selected-source runtime profile commands.
import { readFile, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runtimeCatalog, resolveRuntimeProfile, createRuntimeProfile, verifyRuntimeProfile, inspectRuntimeProfile } from './runtime-profile.mjs';

const help = `Starforge runtime profiles

  runtime-profile catalog [--source-root ORIGINAL_SOURCE_DIRECTORY]
  runtime-profile resolve [--source-root DIRECTORY] [--native] [--feature NAME] [--pin PACKAGE@VERSION] [--operator]
  runtime-profile create --directory NEW_DIRECTORY [same selection options]
  runtime-profile inspect --profile FILE --directory APPLICATION_DIRECTORY [--source-root DIRECTORY] [--load] [--python EXECUTABLE]
  runtime-profile show --profile FILE

Features and versions come from the selected original merchant distribution.
Repeated --feature/--pin options select independent features/packages.
--operator includes the original Linux/Python/flock host requirements.
--load imports the selected installed entries in one isolated Node process.
Declared SQLite readiness always operates an isolated in-memory database, including
without --load, so importing an unbuilt native module cannot report READY.
create saves profile.json and package.json. It does not invoke npm.`;
function options(args, allowed, flags = []) {
  const values = { features: [], pins: {} };
  const seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (!allowed.includes(key) || seen.has(key) && !['--feature', '--pin'].includes(key))
      throw new TypeError('Unknown or repeated option: ' + key);
    seen.add(key);
    if (flags.includes(key)) { values[key] = true; continue; }
    const value = args[++i];
    if (!value || value.startsWith('--')) throw new TypeError('Missing value for ' + key);
    if (key === '--feature') values.features.push(value);
    else if (key === '--pin') {
      const split = value.lastIndexOf('@');
      if (split <= 0 || !value.slice(split + 1) || Object.hasOwn(values.pins, value.slice(0, split)))
        throw new TypeError('Expected one exact PACKAGE@VERSION pin per selected package');
      values.pins[value.slice(0, split)] = value.slice(split + 1);
    } else values[key] = value;
  }
  return values;
}
export async function main(args = process.argv.slice(2)) {
  const [command, ...rest] = args;
  const print = value => console.log(JSON.stringify(value, null, 2));
  if (!command || command === '--help' || command === 'help') { console.log(help); return; }
  if (command === 'catalog') {
    const opts = options(rest, ['--source-root']);
    return print(await runtimeCatalog({ sourceRoot: opts['--source-root'] }));
  }
  if (command === 'resolve' || command === 'create') {
    const opts = options(rest, ['--source-root', '--native', '--feature', '--pin', '--operator', ...(command === 'create' ? ['--directory'] : [])], ['--native', '--operator']);
    const selection = { sourceRoot: opts['--source-root'], native: Boolean(opts['--native']),
      features: opts.features, pins: opts.pins, operator: Boolean(opts['--operator']) };
    return print(command === 'create' ? await createRuntimeProfile({ directory: opts['--directory'], ...selection }) : await resolveRuntimeProfile(selection));
  }
  if (command === 'show' || command === 'inspect') {
    const opts = options(rest, command === 'show' ? ['--profile'] : ['--profile', '--directory', '--source-root', '--load', '--python'], ['--load']);
    if (!opts['--profile']) throw new TypeError('--profile FILE is required');
    const profile = verifyRuntimeProfile(JSON.parse(await readFile(opts['--profile'], 'utf8')));
    if (command === 'show') return print(profile);
    const result = await inspectRuntimeProfile(profile, { directory: opts['--directory'], sourceRoot: opts['--source-root'], load: Boolean(opts['--load']), python: opts['--python'] });
    print(result);
    if (!result.ready) process.exitCode = 1;
    return;
  }
  throw new TypeError('Unknown runtime profile command: ' + command);
}
if (process.argv[1] && await realpath(resolve(process.argv[1])).then(entry => pathToFileURL(entry).href === import.meta.url, () => false))
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
