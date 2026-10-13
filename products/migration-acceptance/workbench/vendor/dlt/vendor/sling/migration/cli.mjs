#!/usr/bin/env node
// SPDX-License-Identifier: MIT
import { link, mkdir, open, readFile, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import {
  MigrationError, listAirbyteConnections, compileMigration, reviewMigration, replicationDocument,
  compareObservations, inventoryDownstream, planDownstreamChanges, applyDownstreamChanges, restoreDownstreamChanges,
} from './index.mjs';
import { requireValue, sha256 } from './common.mjs';

const HELP = 'Sling migration workspace\n\n' +
  'node migration/cli.mjs connections --input CONNECTION.json [--output CONNECTIONS.json]\n' +
  'node migration/cli.mjs compile --input CONNECTION.json --options BINDINGS.json --output DIRECTORY\n' +
  'node migration/cli.mjs review --plan PLAN.json [--output REVIEW.json]\n' +
  'node migration/cli.mjs compare --plan PLAN.json --observations OBSERVATIONS.json --output COMPARISON.json\n' +
  'node migration/cli.mjs inventory --plan PLAN.json --files CONSUMER_FILES.json --output INVENTORY.json\n' +
  'node migration/cli.mjs downstream --plan PLAN.json --files CONSUMER_FILES.json --edits EDITS.json [--comparison COMPARISON.json] --output CHANGES.json\n' +
  'node migration/cli.mjs apply --changes CHANGES.json --root CONSUMER_DIRECTORY\n' +
  'node migration/cli.mjs restore --changes CHANGES.json --root CONSUMER_DIRECTORY\n\n' +
  'CONSUMER_FILES.json maps relative paths to complete UTF-8 file contents.\n' +
  'Original imported files remain unchanged. Compile writes a directory named by its exact plan ID.\n' +
  'Exit codes: 0 complete; 2 a retained plan/comparison needs adaptation; 1 invalid input or operation failure.\n';

function argumentsFor(argv) {
  const [command = 'help', ...tokens] = argv, values = {};
  for (let at = 0; at < tokens.length; at += 1) {
    const key = tokens[at];
    requireValue(key.startsWith('--') && key.length > 2 && at + 1 < tokens.length && !tokens[at + 1].startsWith('--'),
      'invalid_argument', 'Options use --name VALUE.', { argument: key });
    requireValue(!Object.hasOwn(values, key.slice(2)), 'duplicate_argument', 'An option cannot be repeated.', { argument: key });
    values[key.slice(2)] = tokens[++at];
  }
  return { command, values };
}
async function jsonInput(path, name) {
  requireValue(typeof path === 'string' && path.length > 0, 'missing_argument', 'Supply --' + name + '.');
  const bytes = await readFile(resolve(path));
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new MigrationError('invalid_utf8', 'The selected JSON file is not UTF-8.', { path }); }
  try { return { value: JSON.parse(text), sha256: sha256(bytes), path: resolve(path) }; }
  catch (error) { throw new MigrationError('invalid_json', 'The selected file is not valid JSON.', { path, detail: error.message }); }
}
async function saveExact(pathValue, content) {
  const path = resolve(pathValue);
  await mkdir(dirname(path), { recursive: true });
  try {
    const current = await readFile(path);
    requireValue(sha256(current) === sha256(content), 'output_edition_exists',
      'This output path already holds a different edition; select a new destination.', { path });
    return { path, sha256: sha256(current), bytes: current.length, reused: true };
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const temp = path + '.' + randomUUID() + '.tmp';
  const handle = await open(temp, 'wx', 0o600);
  try { await handle.writeFile(content, 'utf8'); await handle.sync(); } finally { await handle.close(); }
  try {
    // A hard link creates the complete immutable destination without replacing any prior edition.
    try { await link(temp, path); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const current = await readFile(path);
      requireValue(sha256(current) === sha256(content), 'output_edition_exists',
        'Another edition reached the destination; preserve it and select a new output path.', { path });
    }
  } finally { await unlink(temp).catch(() => {}); }
  return { path, sha256: sha256(content), bytes: Buffer.byteLength(content, 'utf8'), reused: false };
}
const asJSON = value => JSON.stringify(value, null, 2) + '\n';
async function outputDocument(path, document) {
  if (path == null) { process.stdout.write(asJSON(document)); return null; }
  return saveExact(path, asJSON(document));
}
function outputRequired(value) { requireValue(value, 'missing_argument', 'Supply --output for retained output.'); return value; }
function compact(value) { process.stdout.write(JSON.stringify(value) + '\n'); }

/** Run the real migration command-line application. */
export async function main(argv = process.argv.slice(2)) {
  const { command, values } = argumentsFor(argv);
  if (['help', '--help', '-h'].includes(command)) { process.stdout.write(HELP); return 0; }
  if (command === 'connections') {
    const input = await jsonInput(values.input, 'input');
    const connections = listAirbyteConnections(input.value).map(({ document, ...item }) => item);
    const result = { schema: 'slingdata.connection-selection.v1', source: { path: input.path, sha256: input.sha256 }, connections };
    const saved = await outputDocument(values.output, result);
    if (saved) compact({ command, connections: connections.length, ...saved });
    return 0;
  }
  if (command === 'compile') {
    const input = await jsonInput(values.input, 'input'), bindings = await jsonInput(values.options, 'options');
    const plan = compileMigration(input.value, bindings.value);
    const directory = resolve(outputRequired(values.output), plan.planId);
    const files = [
      await saveExact(resolve(directory, 'plan.json'), asJSON(plan)),
      await saveExact(resolve(directory, 'review.json'), asJSON(reviewMigration(plan))),
      await saveExact(resolve(directory, 'input-selection.json'), asJSON({
        input: { path: input.path, sha256: input.sha256 },
        options: { path: bindings.path, sha256: bindings.sha256 },
        planId: plan.planId,
      })),
    ];
    if (plan.ready) files.push(await saveExact(resolve(directory, 'replication.yaml'), replicationDocument(plan)));
    const queries = plan.selectedStreams.map(stream => ({ streamId: stream.id, ...stream.sql }));
    files.push(await saveExact(resolve(directory, 'comparison-queries.json'), asJSON(queries)));
    compact({ command, ready: plan.ready, planId: plan.planId, streams: plan.selectedStreams.length,
      issues: plan.issues, directory, files });
    return plan.ready ? 0 : 2;
  }
  if (command === 'review') {
    const plan = (await jsonInput(values.plan, 'plan')).value;
    const review = reviewMigration(plan);
    const saved = await outputDocument(values.output, review);
    if (saved) compact({ command, ready: review.ready, ...saved });
    return review.ready ? 0 : 2;
  }
  if (command === 'compare') {
    const plan = (await jsonInput(values.plan, 'plan')).value;
    const observations = (await jsonInput(values.observations, 'observations')).value;
    const options = values['max-examples'] == null ? {} : { maxExamples: Number(values['max-examples']) };
    const report = compareObservations(plan, observations, options);
    const saved = await outputDocument(outputRequired(values.output), report);
    compact({ command, equal: report.equal, readyForCutover: report.readyForCutover,
      planId: report.planId, comparisonId: report.comparisonId,
      streams: report.comparedStreams, errors: report.errors, ...saved });
    return report.readyForCutover ? 0 : 2;
  }
  if (command === 'inventory' || command === 'downstream') {
    const plan = (await jsonInput(values.plan, 'plan')).value;
    const files = (await jsonInput(values.files, 'files')).value;
    let result;
    if (command === 'inventory') result = inventoryDownstream(plan, files);
    else {
      const edits = (await jsonInput(values.edits, 'edits')).value;
      const comparison = values.comparison ? (await jsonInput(values.comparison, 'comparison')).value : null;
      result = planDownstreamChanges(plan, comparison, files, edits);
    }
    const saved = await outputDocument(outputRequired(values.output), result);
    compact({ command, migrationPlanId: plan.planId,
      ...(command === 'downstream' ? { changePlanId: result.changePlanId, readyForApply: result.readyForApply } : {}),
      ...saved });
    return command === 'downstream' && !result.readyForApply ? 2 : 0;
  }
  if (command === 'apply' || command === 'restore') {
    requireValue(values.root, 'missing_argument', 'Supply --root for the selected consumer directory.');
    const plan = (await jsonInput(values.changes, 'changes')).value;
    const result = command === 'apply' ? await applyDownstreamChanges(values.root, plan, { operationId: values['operation-id'] }) :
      await restoreDownstreamChanges(values.root, plan, { operationId: values['operation-id'] });
    compact(result); return 0;
  }
  throw new MigrationError('unknown_command', 'Select a documented migration command.', { command });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().then(code => { process.exitCode = code; }).catch(error => {
    process.stderr.write(JSON.stringify({
      error: error.code || 'migration_failed', message: error.message, details: error.details || {},
    }) + '\n');
    process.exitCode = 1;
  });
}
