#!/usr/bin/env node
// MIT. Receive the original award edition into the maintained research dossier.
import { parseArgs } from 'node:util';
import { isAbsolute, resolve, join } from 'node:path';
import { stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { openDossierStore } from '../../sf88-operator-buyer-cli/research-dossiers/dossier.mjs';
import { startDossierWorkspace } from '../../sf88-operator-buyer-cli/research-dossiers/server.mjs';
import { readBytes, parseJson, writeBytes } from '../../sf88-operator-buyer-cli/node/store.mjs';
import { requireThat, sha, canonical } from './core.mjs';
import { AwardWorkspace } from './workspace.mjs';
import {
  inspectUSAspendingEdition, receiveUSAspendingEdition,
  createUSAspendingEditionProvider, recoverUSAspendingEdition,
} from './dossier.mjs';

const usage = 'USAspending research dossier\n\n' +
  '  inspect --file ORIGINAL_EDITION_JSON\n' +
  '  receive --store DOSSIERS --id DOSSIER_ID --question QUESTION_ID --revision N\n' +
  '          (--award-dir AWARD_WORKSPACE --edition EDITION_ID | --file ORIGINAL_EDITION_JSON)\n' +
  '          [--label TEXT] [--include-reviews] [--out IMPORT_RESULT_JSON]\n' +
  '  recover-edition --store DOSSIERS --id DOSSIER_ID --signature SOURCE_SHA256 --out EDITION_JSON\n' +
  '                  [--question QUESTION_ID]\n' +
  '  open --store DOSSIERS [--award-dir AWARD_WORKSPACE] [--port N]\n\n' +
  'Create questions, edit evidence/findings and export reports with research-dossiers or the operator.\n' +
  'All file and workspace arguments are absolute paths. Existing outputs are preserved.\n';

function absolute(value, name) {
  requireThat(typeof value === 'string' && isAbsolute(value) && resolve(value) === value,
    'ABSOLUTE_PATH_REQUIRED', name + ' must be an absolute normalized path');
  return value;
}
async function awardWorkspace(directory) {
  directory = absolute(directory, '--award-dir');
  requireThat((await stat(join(directory, 'awards.sqlite3'))).isFile(), 'EXISTING_AWARD_WORKSPACE_REQUIRED');
  return new AwardWorkspace(directory, {operator: 'Research dossier receiver'});
}
function importIdentity(result) {
  return {
    schema: result.schema, dossierId: result.dossierId, questionId: result.questionId,
    sourceSignature: result.sourceSignature, metadataEditionId: result.metadataEditionId,
    firstPacketSha256: result.firstPacketSha256, complete: result.complete,
    components: result.components?.map(({component, index, records, dossierEditionId, bytes, sha256}) =>
      ({component, index, records, dossierEditionId, bytes, sha256})),
  };
}
async function save(path, value, {importReceipt = false} = {}) {
  const raw = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value, null, 2) + '\n');
  path = absolute(path, '--out');
  try {
    await writeBytes(path, raw, {exclusive: true});
    return {file: path, bytes: raw.length, sha256: sha(raw), reused: false};
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const original = await readBytes(path, 256 * 1024 * 1024);
    let reusable = original.equals(raw);
    if (!reusable && importReceipt) {
      const first = parseJson(original);
      requireThat(first.complete === true && value.complete === true,
        'EXISTING_IMPORT_RECEIPT_INCOMPLETE');
      reusable = canonical(importIdentity(first)) === canonical(importIdentity(value));
    }
    requireThat(reusable, 'OUTPUT_ALREADY_EXISTS', 'Choose a different output for different content', 409);
    return {file: path, bytes: original.length, sha256: sha(original), reused: true};
  }
}
export async function main(argv = process.argv.slice(2)) {
  const command = argv[0];
  if (!command || ['help', '-h', '--help'].includes(command)) {
    process.stdout.write(usage); return;
  }
  const keys = ['store', 'id', 'question', 'revision', 'award-dir', 'edition', 'file',
    'label', 'out', 'signature', 'port'];
  const {values, tokens} = parseArgs({
    args: argv.slice(1), strict: true, tokens: true,
    options: {...Object.fromEntries(keys.map(key => [key, {type: 'string'}])),
      'include-reviews': {type: 'boolean', default: false}},
  });
  const seen = new Set();
  for (const token of tokens.filter(token => token.kind === 'option')) {
    requireThat(!seen.has(token.name), 'ARGUMENT_REPEATED', token.name); seen.add(token.name);
  }
  const allowed = {
    inspect: ['file'],
    receive: ['store', 'id', 'question', 'revision', 'award-dir', 'edition', 'file', 'label', 'out', 'include-reviews'],
    'recover-edition': ['store', 'id', 'question', 'signature', 'out'],
    open: ['store', 'award-dir', 'port'],
  };
  requireThat(Object.hasOwn(allowed, command) && [...seen].every(key => allowed[command].includes(key)),
    'COMMAND_ARGUMENT_INVALID');
  const readPacket = async () => parseJson(await readBytes(absolute(values.file, '--file'), 256 * 1024 * 1024));
  if (command === 'inspect') {
    const result = inspectUSAspendingEdition(await readPacket());
    process.stdout.write(JSON.stringify(result, null, 2) + '\n'); return result;
  }
  const directory = absolute(values.store, '--store');
  let awards;
  if (values['award-dir']) awards = await awardWorkspace(values['award-dir']);
  if (command === 'open') {
    requireThat(values.port === undefined || /^[0-9]{1,5}$/.test(values.port), 'PORT_INVALID');
    try {
      const app = await startDossierWorkspace({
        directory, port: values.port === undefined ? 0 : Number(values.port),
        providers: awards ? {usaspending: createUSAspendingEditionProvider(awards)} : {},
      });
      process.stdout.write(JSON.stringify({mode: 'USASPENDING_RESEARCH_DOSSIER', url: app.url,
        directory, awardDirectory: awards?.directory ?? null}, null, 2) + '\n');
      let closing = false;
      const close = async () => {
        if (closing) return; closing = true;
        try {await app.close();} finally {awards?.close();}
      };
      process.once('SIGINT', close); process.once('SIGTERM', close);
      return app;
    } catch (error) {awards?.close(); throw error;}
  }
  try {
    const store = await openDossierStore(directory);
    let result;
    if (command === 'receive') {
      requireThat(Boolean(awards) !== Boolean(values.file) &&
        (!awards || typeof values.edition === 'string') &&
        (awards || !values.edition), 'ONE_USASPENDING_SOURCE_REQUIRED');
      requireThat(typeof values.revision === 'string' && /^[1-9][0-9]*$/.test(values.revision),
        'EXPECTED_REVISION_REQUIRED');
      result = await receiveUSAspendingEdition(store, values.id, {
        ...(awards ? {workspace: awards, editionId: values.edition} : {packet: await readPacket()}),
        questionId: values.question, expectedRevision: Number(values.revision),
        includeReviews: values['include-reviews'], label: values.label,
      });
      if (values.out) {
        try {result = {...result, output: await save(values.out, result, {importReceipt: true})};}
        catch (error) {error.usaSpendingImport = result; throw error;}
      }
    } else {
      const exported = await store.exportDossier(values.id, {format: 'json'});
      const packet = recoverUSAspendingEdition(parseJson(Buffer.from(exported.body)), values.signature,
        {questionId: values.question});
      result = {...await save(values.out, packet), editionId: packet.edition.id,
        packetSha256: packet.sha256, sourceSignature: values.signature};
    }
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return result;
  } finally {awards?.close();}
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write(JSON.stringify({error: error.code ?? 'USASPENDING_DOSSIER_FAILED',
      message: error.message, import: error.usaSpendingImport ?? null}) + '\n');
    process.exitCode = 1;
  });
}
