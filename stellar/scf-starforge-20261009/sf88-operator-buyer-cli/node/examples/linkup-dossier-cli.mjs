#!/usr/bin/env node
// MIT. Original Linkup saved-purchase receiving and the existing dossier browser.
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Buyer } from '../index.mjs';
import { readBytes, need } from '../store.mjs';
import { openDossierStore } from '../../research-dossiers/dossier.mjs';
import { startDossierWorkspace, loadEditionAdapters } from '../../research-dossiers/server.mjs';
import { createLinkupEditionProvider, receiveLinkupEdition,
  verifyLinkupResearchEnvelope } from './linkup-dossier.mjs';

const help = [
  'Linkup saved purchases → original research dossier',
  '',
  'open --runtime SF88_DIR --state ORIGINAL_BUYER_STATE --workspace-id CUSTOMER_ID',
  '  --dossiers PRIVATE_DOSSIERS [--port 8846] [--edition-adapter ABS_TRUSTED_ADAPTER.mjs]',
  'reference --runtime SF88_DIR --state ORIGINAL_BUYER_STATE --workspace-id CUSTOMER_ID --intent SAVED_INTENT',
  'receive --runtime SF88_DIR --state ORIGINAL_BUYER_STATE --workspace-id CUSTOMER_ID',
  '  --dossiers PRIVATE_DOSSIERS --dossier DOSSIER_ID --question QUESTION_ID',
  '  --intent SAVED_INTENT --label EDITION_LABEL --expected-revision REVISION [--mode retained|reference]',
  'export-envelope --runtime SF88_DIR --state ORIGINAL_BUYER_STATE --workspace-id CUSTOMER_ID',
  '  --intent SAVED_INTENT --out NEW_RESEARCH_ENVELOPE.json',
  'verify-envelope --file ORIGINAL_LINKUP_RESEARCH_ENVELOPE.json',
  '',
  'Receiving recovers a completed purchase; it does not start a merchant request.',
  'Retained mode carries exact original request/response bytes into existing reports and portable JSON.',
  'Reference mode keeps an original purchase handle and uses this provider when the dossier is reopened.',
].join('\n');

function options(args, allowed) {
  const values = {};
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i], value = args[i + 1];
    need(typeof flag === 'string' && flag.startsWith('--') && allowed.includes(flag.slice(2)) &&
      typeof value === 'string' && value.length > 0 && !value.startsWith('--') &&
      !Object.hasOwn(values, flag.slice(2)), 'LINKUP_DOSSIER_ARGUMENT_INVALID');
    values[flag.slice(2)] = value;
  }
  return values;
}
export async function main([mode, ...args] = process.argv.slice(2)) {
  if (!mode || mode === '--help') { console.log(help); return; }
  need(['open', 'reference', 'receive', 'export-envelope', 'verify-envelope'].includes(mode), 'LINKUP_DOSSIER_MODE_INVALID');
  const allowed = mode === 'verify-envelope' ? ['file'] :
    ['runtime', 'state', 'workspace-id', ...(mode === 'reference' ? ['intent'] : mode === 'export-envelope' ? ['intent', 'out'] :
      mode === 'open' ? ['dossiers', 'port', 'edition-adapter'] :
      ['dossiers', 'dossier', 'question', 'intent', 'label', 'expected-revision', 'mode'])];
  const values = options(args, allowed);
  const required = key => { need(values[key], 'LINKUP_DOSSIER_REQUIRED_' + key.toUpperCase().replaceAll('-', '_')); return values[key]; };
  if (mode === 'verify-envelope') {
    console.log(JSON.stringify(verifyLinkupResearchEnvelope(
      await readBytes(resolve(required('file')), 8 * 1024 * 1024)), null, 2)); return;
  }
  const buyer = new Buyer({ runtimeDirectory: resolve(required('runtime')),
    stateDirectory: resolve(required('state')) });
  const provider = createLinkupEditionProvider(buyer, { workspaceId: required('workspace-id') });
  if (mode === 'export-envelope') {
    const envelope = await provider.envelope(required('intent'));
    const receipt = verifyLinkupResearchEnvelope(envelope);
    const output = resolve(required('out'));
    await writeFile(output, JSON.stringify(envelope, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ output, ...receipt }, null, 2)); return;
  }
  if (mode === 'reference') {
    console.log(JSON.stringify(await provider.describe(required('intent')), null, 2)); return;
  }
  if (mode === 'receive') {
    const store = await openDossierStore(resolve(required('dossiers')), { providers: { linkup: provider } });
    const revision = required('expected-revision');
    need(/^[1-9][0-9]{0,7}$/.test(revision), 'EXPECTED_REVISION_REQUIRED');
    const result = await receiveLinkupEdition(store, required('dossier'), { provider,
      questionId: required('question'), intentId: required('intent'), label: required('label'),
      expectedRevision: Number(revision), mode: values.mode ?? 'retained' });
    console.log(JSON.stringify(result, null, 2)); return;
  }
  const adapters = values['edition-adapter'] ? await loadEditionAdapters(resolve(values['edition-adapter'])) : {};
  need(!Object.hasOwn(adapters, 'linkup'), 'LINKUP_EDITION_ADAPTER_ALREADY_CONFIGURED');
  const rawPort = values.port ?? '0';
  need(/^[0-9]{1,5}$/.test(rawPort) && Number(rawPort) <= 65535, 'WORKSPACE_PORT_INVALID');
  const app = await startDossierWorkspace({ directory: resolve(required('dossiers')),
    providers: { ...adapters, linkup: provider }, port: Number(rawPort) });
  console.log(JSON.stringify({ mode: 'RESEARCH_DOSSIER_WORKSPACE', directory: resolve(values.dossiers),
    url: app.url, providers: [...Object.keys(adapters), 'linkup'] }, null, 2));
  let closing;
  const stop = () => closing ??= app.close();
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(error => { console.error(JSON.stringify({ error: error.code ?? 'LINKUP_DOSSIER_FAILED' })); process.exitCode = 1; });
