// MIT. Reopen a product's first immutable record under its already-held original Linux lease.
import {readdir, lstat, rename} from 'node:fs/promises';
import {join} from 'node:path';
import {ownedDirectory, ownedBytes, writeExact, encoded, parse, digest, need}
  from '../../stellar/scf-starforge-20261009/sf101-merchant-receiver/api-application/workspace/configuration.mjs';
import {syncDirectory} from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/node/store.mjs';

const TEMP = /^\.write-([a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})$/;
const RETAINED = /^\.interrupted-write-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

async function retainTemporary(directory, name, expected, lease, limit) {
  const path = join(directory, name), target = join(directory, '.interrupted-write-' + TEMP.exec(name)[1]);
  const body = await ownedBytes(path, limit);
  need(body.equals(expected), 'PREPAID_API_INITIAL_TEMP_CHANGED', 409);
  let existing;
  try {existing = await ownedBytes(target, limit);}
  catch (error) {if (error.code !== 'ENOENT') throw error;}
  need(existing === undefined, 'PREPAID_API_INITIAL_TEMP_NAME_CONFLICT', 409);
  const before = await lstat(path);
  need(before.isFile() && !before.isSymbolicLink() && before.nlink === 1 && !(before.mode & 0o077),
    'PREPAID_API_INITIAL_TEMP_CHANGED', 409);
  lease.assertHeld();
  await rename(path, target); await syncDirectory(directory);
}

/**
 * The original writer creates .write-UUID before rename. A cold process can
 * recover that complete initial record, or preserve its incomplete bytes.
 * No external native action is dispatched before this first record exists.
 */
export async function initialRecord({directory, name, lease, validate, create, maxBytes = 4 * 1024 * 1024}) {
  await ownedDirectory(directory); lease.assertHeld();
  need(/^[a-z][a-z0-9-]*\.json$/.test(name) && typeof validate === 'function' && typeof create === 'function',
    'PREPAID_API_INITIAL_RECORD_REQUIRED');
  const path = join(directory, name);
  let named;
  try {named = await ownedBytes(path, maxBytes);}
  catch (error) {if (error.code !== 'ENOENT') throw error;}
  if (named !== undefined) return validate(parse(named));
  const names = await readdir(directory);
  need(names.every(value => value === 'lease.lock' || TEMP.test(value) || RETAINED.test(value)),
    'PREPAID_API_EMPTY_RECORD_DIRECTORY_REQUIRED', 409);
  const candidates = [];
  for (const value of names.filter(value => TEMP.test(value)).sort()) {
    const body = await ownedBytes(join(directory, value), maxBytes);
    let parsed;
    try {parsed = parse(body);}
    catch {await retainTemporary(directory, value, body, lease, maxBytes); continue;}
    // A complete record for different input is preserved and rejected.
    const selected = validate(parsed);
    need(encoded(selected).equals(body), 'PREPAID_API_INITIAL_RECORD_BYTES_CHANGED', 409);
    candidates.push({name: value, body, selected});
  }
  let record;
  if (candidates.length) {
    // No candidate was named or dispatched. Choose one deterministic complete
    // original record; preserve every other unpublished candidate's bytes.
    record = candidates[0].selected;
    for (const candidate of candidates.slice(1))
      await retainTemporary(directory, candidate.name, candidate.body, lease, maxBytes);
    lease.assertHeld();
    await writeExact(path, candidates[0].body);
    await retainTemporary(directory, candidates[0].name, candidates[0].body, lease, maxBytes);
  } else {
    record = validate(await create());
    const bytes = encoded(record);
    need(bytes.length <= maxBytes, 'PREPAID_API_INITIAL_RECORD_TOO_LARGE', 413);
    lease.assertHeld(); await writeExact(path, bytes);
  }
  const actual = await ownedBytes(path, maxBytes);
  need(digest(actual) === digest(encoded(record)), 'PREPAID_API_INITIAL_RECORD_CHANGED', 409);
  return validate(parse(actual));
}
