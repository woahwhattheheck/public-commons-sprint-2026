#!/usr/bin/env node
// MIT — The original buyer acquires; this command organizes its returned research.
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { readBytes, parseJson, writeBytes, need } from '../node/store.mjs';
import { openDossierStore } from './dossier.mjs';

const usage = 'Research dossiers\n\n' +
  '  create --store DIR --title TEXT [--description TEXT]\n' +
  '  list|get --store DIR [--id ID] [--revision N]\n' +
  '  question --store DIR --id ID --text TEXT --revision N\n' +
  '  receive --store DIR --id ID --question ID --file JSON --provider openalex|research --label TEXT --revision N\n' +
  '  attach --store DIR --id ID --question ID --file REFERENCE_JSON --provider valyu --label TEXT --revision N [--edition-adapter MODULE]\n' +
  '  import-buyer --store DIR --id ID --question ID --buyer-state DIR --runtime DIR --intent ID --provider openalex|research --label TEXT --revision N\n' +
  '  note --store DIR --id ID --source ID --selected true|false --note TEXT --classification supports|contradicts|background|unreviewed --revision N\n' +
  '  finding --store DIR --id ID --file FINDING_JSON --revision N\n' +
  '  compare --store DIR --id ID --before N --after N\n' +
  '  export --store DIR --id ID --format json|md|html --out FILE\n' +
  '  reopen --store DIR --file PORTABLE_JSON\n';

export async function main(argv = process.argv.slice(2)) {
  const command = argv[0];
  if (!command || ['help', '--help', '-h'].includes(command)) { process.stdout.write(usage); return; }
  const keys = ['store', 'id', 'title', 'description', 'text', 'revision', 'question', 'file',
    'provider', 'label', 'source-reference', 'source', 'selected', 'note', 'classification',
    'before', 'after', 'format', 'out', 'edition-adapter', 'buyer-state', 'runtime', 'intent'];
  const { values } = parseArgs({ args: argv.slice(1), options: Object.fromEntries(keys.map(key => [key, { type: 'string' }])), strict: true });
  need(values.store, 'STORE_REQUIRED');
  let providers = {};
  if (values['edition-adapter']) {
    const installed = await import(pathToFileURL(resolve(values['edition-adapter'])).href);
    providers = installed.providers;
    need(providers && typeof providers === 'object', 'EDITION_PROVIDERS_INVALID');
  }
  const store = await openDossierStore(resolve(values.store), { providers });
  const revision = values.revision === undefined ? undefined : Number(values.revision);
  const input = async () => parseJson(await readBytes(resolve(values.file), 256 * 1024 * 1024));
  let result;
  switch (command) {
    case 'create': result = await store.create({ title: values.title, description: values.description ?? '' }); break;
    case 'list': result = await store.list(); break;
    case 'get': result = await store.get(values.id, { revision }); break;
    case 'question': result = await store.addQuestion(values.id, { text: values.text, expectedRevision: revision }); break;
    case 'receive':
      result = await store.receive(values.id, { questionId: values.question, label: values.label,
        provider: values.provider ?? 'research', rawBytes: await readBytes(resolve(values.file), 64 * 1024 * 1024),
        sourceReference: values['source-reference'] ?? '', expectedRevision: revision }); break;
    case 'attach':
      result = await store.receiveReference(values.id, { questionId: values.question, label: values.label,
        provider: values.provider, reference: await input(), expectedRevision: revision }); break;
    case 'import-buyer': {
      const { Buyer } = await import('../node/client.mjs');
      const buyer = new Buyer({ stateDirectory: resolve(values['buyer-state']), runtimeDirectory: resolve(values.runtime) });
      const saved = await buyer.operation(values.intent).recover();
      need(saved, 'ORIGINAL_RESULT_NOT_RECORDED');
      result = await store.receiveBuyerResult(values.id, { result: saved, intentId: values.intent,
        questionId: values.question, label: values.label, provider: values.provider ?? 'research',
        sourceReference: values['source-reference'] ?? '', expectedRevision: revision });
      break;
    }
    case 'note':
      need(['true', 'false'].includes(values.selected), 'SELECTION_REQUIRED');
      result = await store.selectEvidence(values.id, { sourceId: values.source, selected: values.selected === 'true',
        note: values.note ?? '', classification: values.classification ?? 'unreviewed', expectedRevision: revision }); break;
    case 'finding': result = await store.addFinding(values.id, { ...await input(), expectedRevision: revision }); break;
    case 'compare': result = await store.compare(values.id, { before: Number(values.before), after: Number(values.after) }); break;
    case 'export': {
      const exported = await store.exportDossier(values.id, { format: values.format ?? 'json' });
      const destination = resolve(values.out);
      await writeBytes(destination, Buffer.from(exported.body), { exclusive: true });
      result = { file: destination, contentType: exported.contentType, bytes: Buffer.byteLength(exported.body) };
      break;
    }
    case 'reopen': result = await store.reopen(await input()); break;
    default: throw Object.assign(new Error('COMMAND_UNKNOWN'), { code: 'COMMAND_UNKNOWN' });
  }
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { process.stderr.write(JSON.stringify({ error: error.code ?? 'DOSSIER_COMMAND_FAILED' }) + '\n'); process.exitCode = 1; });
}
