#!/usr/bin/env node
// MIT. One OAI publisher workspace and the original merchant release CLI.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readJson, fault } from '../../postgres/publisher/files.mjs';
import { openOaiPublisher } from './model.mjs';
import { prepareOaiRelease, inspectOaiRelease } from './release.mjs';

const USAGE = String.raw`OAI-PMH publisher — Node 22+, one retained source and dataset version store

  init --dir NEW_DIRECTORY --source SOURCE_JSON --target NEW_VERSION_DIRECTORY
  source --dir DIRECTORY [--source NEXT_EXPORTED_SOURCE_JSON]
  plan --dir DIRECTORY --input PLAN_JSON
  status --dir DIRECTORY [--limit 25] [--plans-offset 0] [--runs-offset 0] [--history-offset 0]
  target --dir DIRECTORY
  extract --dir DIRECTORY --plan NUMBER [--id ORIGINAL_UUID]
  inspect --dir DIRECTORY --id RUN_UUID [--query "limit=20"]
  candidate --dir DIRECTORY --id RUN_UUID
  review --dir DIRECTORY --id RUN_UUID --input REVIEW_JSON
  publish --dir DIRECTORY --id RUN_UUID --review REVIEW_UUID
  recover --dir DIRECTORY --id RUN_UUID
  buyer-offer --dir DIRECTORY --id RUN_UUID --seller ORIGINAL_SELLER --resource RESOURCE [--query "limit=50"]
  buyer-prepare --dir DIRECTORY --id RUN_UUID --seller ORIGINAL_SELLER --resource RESOURCE --input BUYER_JSON
  release-prepare --dir DIRECTORY --input RELEASE_JSON
  release-inspect --package PREPARED_DIRECTORY
  release ORIGINAL_RELEASE_COMMAND ORIGINAL_RELEASE_OPTIONS

Run with: node publisher/cli.mjs COMMAND OPTIONS

SOURCE_JSON is the original Python export-source result's source.json.
PLAN_JSON binds sourceHash from source, title, records, and optional native sort.
Extraction completes in this process; Ctrl-C records cancellation in the same run.
REVIEW_JSON supplies reviewer, note and initialize:true, or the displayed current
expectedSnapshot and expectedRevision. Publish consumes the saved review UUID.
RELEASE_JSON supplies runId, directory, payment, origin, optional path and
expectedCandidateDigest. It packages the same published candidate and version store.
Structured input files are private UTF-8 JSON (mode 0600); retained directories use 0700.

The release command delegates unchanged to the original SF82 CLI. For example:
  release init --store PRIVATE_RELEASE_STORE
  release stage --store PRIVATE_RELEASE_STORE --id EDITION --dataset-package PREPARED_DIRECTORY
  release inspect --store PRIVATE_RELEASE_STORE --id EDITION
  release activate --store PRIVATE_RELEASE_STORE --id EDITION --expect GENERATION
  release run --store PRIVATE_RELEASE_STORE
  release console --store PRIVATE_RELEASE_STORE
  release --help

The original merchant console owns activation, receiving, discovery and customer
handover. Dataset admission, cursors, snapshot selection and payment use the
original SF30/SF82/SF88 implementation.`;

const COMMANDS = Object.freeze({
  init: ['dir', 'source', 'target'],
  source: ['dir', 'source'],
  plan: ['dir', 'input'],
  status: ['dir', 'limit', 'plans-offset', 'runs-offset', 'history-offset'],
  target: ['dir'],
  extract: ['dir', 'plan', 'id'],
  inspect: ['dir', 'id', 'query'],
  candidate: ['dir', 'id'],
  review: ['dir', 'id', 'input'],
  publish: ['dir', 'id', 'review'],
  recover: ['dir', 'id'],
  'buyer-offer': ['dir', 'id', 'query', 'seller', 'resource'],
  'buyer-prepare': ['dir', 'id', 'input', 'seller', 'resource'],
  'release-prepare': ['dir', 'input'],
  'release-inspect': ['package'],
});
function parse(args) {
  if (!Array.isArray(args) || args.some(value => typeof value !== 'string')) throw fault('OAI_CLI_ARGUMENTS');
  if (!args.length || args[0] === '--help' || args[0] === 'help') return null;
  const [command, ...rest] = args, allowed = COMMANDS[command];
  if (!allowed) throw fault('OAI_CLI_COMMAND', 'Unknown command; use --help.');
  const options = {};
  for (let index = 0; index < rest.length; index += 2) {
    const name = rest[index].startsWith('--') ? rest[index].slice(2) : '';
    const value = rest[index + 1];
    if (!allowed.includes(name) || Object.hasOwn(options, name) ||
        value === undefined || value.startsWith('--'))
      throw fault('OAI_CLI_OPTION', 'Unknown, duplicate or missing option: ' + rest[index]);
    options[name] = value;
  }
  const required = command === 'release-inspect' ? ['package'] : ['dir'];
  if (command === 'init') required.push('source', 'target');
  if (['plan', 'review', 'buyer-prepare', 'release-prepare'].includes(command)) required.push('input');
  if (command === 'extract') required.push('plan');
  if (['inspect', 'candidate', 'review', 'publish', 'recover', 'buyer-offer', 'buyer-prepare'].includes(command)) required.push('id');
  if (command === 'publish') required.push('review');
  if (command.startsWith('buyer-')) required.push('seller', 'resource');
  for (const name of required) if (!options[name]) throw fault('OAI_CLI_OPTION', 'Supply --' + name + '.');
  for (const name of ['plan', 'limit', 'plans-offset', 'runs-offset', 'history-offset']) {
    if (options[name] !== undefined) {
      if (!/^\d+$/.test(options[name]) || !Number.isSafeInteger(Number(options[name])))
        throw fault('OAI_CLI_OPTION', '--' + name + ' must be a nonnegative integer.');
      options[name] = Number(options[name]);
    }
  }
  return { command, options };
}
const print = value => process.stdout.write(JSON.stringify(value, null, 2) + '\n');
const input = path => readJson(resolve(path), 1024 * 1024);
export async function main(args = process.argv.slice(2)) {
  if (args[0] === 'release') {
    const { main: release } = await import('../../../sf82-seller-pilot/release-cli.mjs');
    return release(args.slice(1));
  }
  const selected = parse(args);
  if (!selected) { process.stdout.write(USAGE + '\n'); return null; }
  const { command, options: o } = selected;
  if (command === 'release-inspect') {
    const result = await inspectOaiRelease(resolve(o.package)); print(result); return result;
  }
  const publisher = await openOaiPublisher({
    directory: resolve(o.dir), create: command === 'init',
    ...(command === 'init' ? { sourceFile: resolve(o.source) } : {}),
    ...(o.target ? { targetDirectory: resolve(o.target) } : {}),
    ...(o.seller ? { seller: o.seller, resource: o.resource } : {}),
  });
  let result;
  try {
    switch (command) {
      case 'init': result = publisher.status(); break;
      case 'source': result = await publisher.source(o.source ? resolve(o.source) : undefined); break;
      case 'plan': result = await publisher.savePlan(await input(o.input)); break;
      case 'status':
        result = publisher.status({ limit: o.limit, plansOffset: o['plans-offset'],
          runsOffset: o['runs-offset'], historyOffset: o['history-offset'] }); break;
      case 'target': result = await publisher.target(); break;
      case 'extract': {
        const operation = publisher.startExtraction(o.plan, o.id ? { id: o.id } : {});
        let interrupted = null;
        const stop = signal => {
          if (interrupted) return; interrupted = signal;
          try { publisher.cancel(operation.id); }
          catch (issue) { if (issue.code !== 'EXTRACTION_NOT_ACTIVE') throw issue; }
        };
        const interrupt = () => stop('SIGINT'), terminate = () => stop('SIGTERM');
        process.once('SIGINT', interrupt); process.once('SIGTERM', terminate);
        try { result = await operation.completion; }
        finally { process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', terminate); }
        if (interrupted) process.exitCode = interrupted === 'SIGINT' ? 130 : 143;
        else if (result.state !== 'READY') process.exitCode = 1;
        break;
      }
      case 'inspect': result = await publisher.inspect(o.id, o.query); break;
      case 'candidate': result = (await publisher.candidate(o.id)).manifest; break;
      case 'review': result = await publisher.review(o.id, await input(o.input)); break;
      case 'publish':
        result = await publisher.publish(o.id, o.review);
        if (result.state !== 'PUBLISHED') process.exitCode = 1;
        break;
      case 'recover': result = await publisher.recover(o.id); break;
      case 'buyer-offer': result = await publisher.buyerOffer(o.id, o.query ?? ''); break;
      case 'buyer-prepare': result = await publisher.prepareBuyer(o.id, await input(o.input)); break;
      case 'release-prepare': result = await prepareOaiRelease(publisher, await input(o.input)); break;
    }
    print(result); return result;
  } finally { await publisher.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(issue => {
    process.stderr.write(JSON.stringify({ error: issue.message, code: issue.code ?? 'OAI_PUBLISHER_FAILED',
      ...(issue.status ? { status: issue.status } : {}) }) + '\n');
    process.exitCode = 1;
  });
