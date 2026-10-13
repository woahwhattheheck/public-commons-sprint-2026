// MIT. Complete customer files and recurring profile through the original Console.
import { open, mkdir, lstat, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, join, sep, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { writeOpenApiWorkflowFile, writeConsoleWorkflowStream, inspectConsoleWorkflowFile } from './openapi-workflow-client.mjs';
import { canonical, digest } from './records.mjs';
import { plain, need, sha, identifier, seal, same } from './workflow-series-records.mjs';

export const SERIES_HANDOVER_SELECTION = 'stellar-forge.merchant-workflow-handover-selection.v1';
export const SERIES_HANDOVER_SCHEMA = 'stellar-forge.merchant-workflow-handover.v1';
const PROFILE_SCHEMA = 'stellar-forge.merchant-operator-profile.v1';
const MAX_PROFILE_BYTES = 128 * 1024 * 1024;
function selected(value, schema) {
  need(plain(value) && value.schema === schema, 'Select the complete original customer handover.');
  const { contentSha256, ...body } = value;
  need(digest(canonical(body)) === sha(contentSha256), 'The selected complete customer handover changed.', 'CONSOLE_SERIES_HANDOVER_CHANGED', 409);
  return value;
}
function relativeName(value) {
  need(typeof value === 'string' && value.length > 0 && value.length <= 4096 && !isAbsolute(value) &&
    !/^[A-Za-z]:/.test(value) && !/[\\\x00-\x1f]/.test(value) &&
    value.split('/').every(part => part && part !== '.' && part !== '..' && Buffer.byteLength(part) <= 255),
    'Retain each original customer filename inside its receiving directory.', 'CONSOLE_SERIES_HANDOVER_PATH');
  return value;
}
async function privateDirectory(path, create = false) {
  path = resolve(path);
  if (create) await mkdir(path, { recursive: true, mode: 0o700 });
  const info = await lstat(path);
  need(info.isDirectory() && !info.isSymbolicLink() && await realpath(path) === path &&
    (process.platform === 'win32' || !(info.mode & 0o077)) &&
    (!process.getuid || info.uid === process.getuid()),
    'Select a private receiving directory owned by the current operator.', 'CONSOLE_SERIES_HANDOVER_PATH');
  return path;
}
async function within(directory, relative, create = false) {
  relativeName(relative);
  const parts = relative.split('/'), name = parts.pop();
  let parent = directory;
  for (const part of parts) {
    parent = join(parent, part);
    if (create) { try { await mkdir(parent, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; } }
    await privateDirectory(parent);
  }
  const path = join(parent, name);
  need(path.startsWith(directory + sep), 'Receive this original file within the selected directory.');
  return path;
}
async function readJson(path, maximum = MAX_PROFILE_BYTES) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    need(before.isFile() && before.size <= maximum && [1, 2].includes(before.nlink) &&
      (process.platform === 'win32' || !(before.mode & 0o077)) &&
      (!process.getuid || before.uid === process.getuid()), 'Read a private complete original JSON file.');
    const bytes = await handle.readFile(), after = await handle.stat();
    need(bytes.length === before.size && after.size === before.size && after.mtimeMs === before.mtimeMs,
      'The original complete JSON file changed during receiving.');
    const descriptor = { bytes: bytes.length, sha256: digest(bytes) };
    await inspectConsoleWorkflowFile(path, descriptor);
    return { value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), ...descriptor };
  } finally { await handle.close(); }
}
async function optionalJson(path) {
  try { return await readJson(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
function customerFiles(archive, ids) {
  const chosen = ids === undefined ? archive.deliveries.filter(value => value.state === 'COMPLETE' &&
    value.workspaceId === archive.sourceWorkspaceId).map(value => value.id) : ids;
  need(Array.isArray(chosen) && chosen.every(value => typeof value === 'string') && new Set(chosen).size === chosen.length,
    'Select each original customer delivery once.');
  return [...chosen].sort().map(id => {
    identifier(id);
    const delivery = archive.deliveries.find(value => value.id === id);
    need(delivery?.profileId === archive.profile.id && delivery.state === 'COMPLETE' &&
      delivery.workspaceId === archive.sourceWorkspaceId && Array.isArray(delivery.files),
      'Complete the selected original customer receiving on this source Console before capturing its files.');
    need(plain(delivery.identity) && digest(canonical(delivery.identity)) === sha(delivery.identitySha256),
      'Retain the original complete customer selection.');
    const names = new Set();
    const files = delivery.files.map(file => {
      need(plain(file) && Number.isSafeInteger(file.bytes) && file.bytes >= 0, 'Retain the original complete customer file size.');
      relativeName(file.name); sha(file.sha256);
      need(!names.has(file.name), 'Each original customer file must have one complete path.'); names.add(file.name);
      return { name: file.name, path: 'customers/' + id + '/files/' + file.name, bytes: file.bytes, sha256: file.sha256 };
    });
    return { id, identity: delivery.identity, identitySha256: delivery.identitySha256, files };
  });
}
function selectionFor(archive, profile, deliveryIds) {
  selected(archive, PROFILE_SCHEMA);
  need(Array.isArray(archive.deliveries) && plain(archive.profile), 'Receive the complete original profile and customer history.');
  const customers = customerFiles(archive, deliveryIds), chosen = new Set(customers.map(value => value.id));
  return seal({ schema: SERIES_HANDOVER_SELECTION, profileId: archive.profile.id, sourceWorkspaceId: archive.sourceWorkspaceId,
    profile: { path: 'profile.json', bytes: profile.bytes, sha256: profile.sha256, contentSha256: archive.contentSha256 },
    customers, otherDeliveries: archive.deliveries.filter(value => !chosen.has(value.id)).map(value => ({
      id: value.id, state: value.state, sourceWorkspaceId: value.workspaceId, identity: value.identity,
      reason: value.state === 'COMPLETE' ? 'Original files remain with their recorded receiving workspace.' :
        'Original receiving is ' + value.state.toLowerCase() + '.'
    })) });
}
async function originalSnapshot(directory, profileId, client) {
  const path = await within(directory, 'profile.json');
  let snapshot = await optionalJson(path);
  if (!snapshot) {
    need(client, 'Capture the complete original profile before reopening its customer files.');
    const packet = await client.exportProfile(profileId);
    need(packet.archive.profile.id === profileId, 'The Console returned another original profile.');
    await writeOpenApiWorkflowFile(path, packet.bytes);
    snapshot = await readJson(path);
  }
  selected(snapshot.value, PROFILE_SCHEMA);
  need(snapshot.value.profile.id === profileId, 'This receiving directory retains another original profile.', 'CONSOLE_SERIES_HANDOVER_CONFLICT', 409);
  return snapshot;
}
function handoverFor(selection) {
  return seal({ schema: SERIES_HANDOVER_SCHEMA, profileId: selection.profileId,
    sourceWorkspaceId: selection.sourceWorkspaceId, selectionSha256: selection.contentSha256,
    profile: selection.profile, customers: selection.customers, otherDeliveries: selection.otherDeliveries,
    files: [selection.profile, ...selection.customers.flatMap(value => value.files)] });
}
async function completeFile(client, directory, delivery, file) {
  const path = await within(directory, file.path, true);
  let existing;
  try { existing = await inspectConsoleWorkflowFile(path, file); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (existing) {
    need(existing.bytes === file.bytes && existing.sha256 === file.sha256,
      'This original customer filename retains different bytes.', 'CONSOLE_SERIES_HANDOVER_CONFLICT', 409);
    return { ...file, state: 'REOPENED', absolutePath: path };
  }
  return client.response('customer-file/' + encodeURIComponent(delivery.id) + '?' +
    new URLSearchParams({ file: file.name }), {}, response => writeConsoleWorkflowStream(path, async handle => {
      need(response.headers.get('x-content-sha256') === file.sha256,
        'The original customer response selected another complete file.', 'CONSOLE_SERIES_HANDOVER_CHANGED', 409);
      const hash = createHash('sha256'); let bytes = 0;
      for await (const chunk of response.body) {
        bytes += chunk.length; need(bytes <= file.bytes, 'The original customer file exceeds its selected complete length.');
        hash.update(chunk); await handle.writeFile(chunk);
      }
      const actual = hash.digest('hex');
      need(bytes === file.bytes && actual === file.sha256,
        'Receive all original customer bytes before completing this file.', 'CONSOLE_SERIES_HANDOVER_CHANGED', 409);
      return { ...file, bytes, sha256: actual, absolutePath: path };
    }));
}
export async function captureWorkflowSeriesHandover(client, { profileId, directory, deliveryIds } = {}) {
  identifier(profileId); need(typeof directory === 'string' && directory, 'Select one private complete customer handover directory.');
  directory = await privateDirectory(directory, true);
  const snapshot = await originalSnapshot(directory, profileId, client);
  const selectionPath = await within(directory, 'selection.json'), retained = await optionalJson(selectionPath);
  const selection = retained ? selected(retained.value, SERIES_HANDOVER_SELECTION) : selectionFor(snapshot.value, snapshot, deliveryIds);
  const expected = selectionFor(snapshot.value, snapshot, selection.customers.map(value => value.id));
  need(same(selection, expected), 'The receiving selection differs from its complete original profile.', 'CONSOLE_SERIES_HANDOVER_CHANGED', 409);
  if (deliveryIds !== undefined) need(same([...deliveryIds].sort(), selection.customers.map(value => value.id)),
    'Continue this original customer selection or select a new receiving directory.', 'CONSOLE_SERIES_HANDOVER_CONFLICT', 409);
  if (!retained) await writeOpenApiWorkflowFile(selectionPath, selection);
  for (const delivery of selection.customers)
    for (const file of delivery.files) await completeFile(client, directory, delivery, file);
  await writeOpenApiWorkflowFile(await within(directory, 'handover.json'), handoverFor(selection));
  return reopenWorkflowSeriesHandover({ directory });
}
export async function reopenWorkflowSeriesHandover({ directory } = {}) {
  need(typeof directory === 'string' && directory, 'Select the complete original receiving directory.');
  directory = await privateDirectory(directory);
  const selection = selected((await readJson(await within(directory, 'selection.json'))).value, SERIES_HANDOVER_SELECTION);
  const snapshot = await originalSnapshot(directory, selection.profileId);
  need(same(selection, selectionFor(snapshot.value, snapshot, selection.customers.map(value => value.id))),
    'The retained complete customer selection changed.', 'CONSOLE_SERIES_HANDOVER_CHANGED', 409);
  const manifest = selected((await readJson(await within(directory, 'handover.json'))).value, SERIES_HANDOVER_SCHEMA);
  need(same(manifest, handoverFor(selection)), 'The complete handover names different original files.');
  const files = [];
  for (const file of manifest.files) {
    const path = await within(directory, file.path), actual = await inspectConsoleWorkflowFile(path, file);
    need(actual.bytes === file.bytes && actual.sha256 === file.sha256,
      'The original complete customer file differs from its manifest.', 'CONSOLE_SERIES_HANDOVER_CHANGED', 409);
    files.push({ ...file, absolutePath: path });
  }
  return { state: 'REOPENED', directory, profileId: manifest.profileId, contentSha256: manifest.contentSha256,
    manifest, profile: snapshot.value, files };
}
export async function receiveWorkflowSeriesHandover(client, input) {
  const received = await reopenWorkflowSeriesHandover(input);
  const imported = await client.importProfile(received.profile);
  return { ...received, imported, workflowSeries: received.profile.workflowSeriesData ?? null };
}
