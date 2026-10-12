#!/usr/bin/env node
// MIT. The installed economic-editions command invokes the original application.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readBytes, writeBytes } from '../../sf88-operator-buyer-cli/node/store.mjs';
import { readPrivateJson } from '../routescan/quota.mjs';
import { Buyer } from '../../sf88-operator-buyer-cli/node/index.mjs';
import { need, operationId } from './model.mjs';
import { jsonBytes } from './source.mjs';
import { initializeFredProject, fredProjectView, configureFredProject, importFredCapture,
  acquireFredCapture, selectFredCapture, combineFredTables, getFredCapture, reviewFredCapture, compareFredCaptures,
  publishFredReview, selectFredPublication, exportFredProject, receiveFredProject, abandonFredOperation } from './project.mjs';
import { startFredMerchant, prepareFredPurchase, executeFredPurchase, recoverFredPurchase, exportFredPurchase } from './merchant.mjs';
import { startFredWorkspace } from './workspace.mjs';
import { runFredReceiver, readFredReceiver } from './receiver.mjs';

export const USAGE = "Economic editions — original FRED source, merchant and customer\n\nstarforge fred receiver --project ABS --config PRIVATE_JSON [--phase run|browser|status]\nstarforge fred receiver --project ABS --id ID --phase status\nstarforge fred init --project ABS --title TEXT --selection FILE [--api-key-env NAME]\nstarforge fred show --project ABS\nstarforge fred serve --project ABS [--port N] [--buyer-config FILE] [--facilitator URL]\nstarforge fred configure --project ABS --id ID --expected-revision N --selection FILE\nstarforge fred capture --project ABS --id ID --expected-revision N\nstarforge fred import --project ABS --id ID --expected-revision N --source CAPTURE_JSON\nstarforge fred select --project ABS --id ID --expected-revision N --capture SHA\nstarforge fred combine --project ABS --id ID --expected-revision N --captures SHA,SHA\nstarforge fred review --project ABS --id ID --expected-revision N --capture SHA [--policy FILE] [--note FILE]\nstarforge fred compare --project ABS --before SHA --after SHA [--out FILE]\nstarforge fred source --project ABS --capture SHA --out FILE\nstarforge fred publish --project ABS --id ID --expected-revision N --review SHA --origin HTTPS --payment FILE [--path PATH]\nstarforge fred merchant --project ABS --publication SHA [--port N] [--facilitator URL]\nstarforge fred prepare --project ABS --publication SHA --intent ID [--query QUERY] [--file MEMBER] [--previous FILE] [--accept N] [--out FILE]\nstarforge fred buy --project ABS --publication SHA --intent ID --buyer-config FILE\nstarforge fred recover --project ABS --publication SHA --intent ID --buyer-config FILE\nstarforge fred delivery --project ABS --publication SHA --intent ID --buyer-config FILE --out FILE\nstarforge fred export --project ABS --out FILE\nstarforge fred receive --project ABS_EMPTY --source PROJECT_JSON\nstarforge fred abandon --project ABS --id ID --expected-revision N --pending ID\n\nUse the SAME id/revision to resume a pending capture. Original approvals occur in\nthe launch terminal. --allow-local-facilitator explicitly permits a configured\n127.0.0.1 HTTP facilitator. Omit --facilitator for original challenge-only serving.\nFile exports are create-only. Existing projects reopen with show or serve.";
const optionsFor = {
  receiver: ['project','config','phase','id'],
  init: ['project','title','selection','api-key-env'], show: ['project'],
  serve: ['project','port','buyer-config','facilitator','allow-local-facilitator'],
  configure: ['project','id','expected-revision','selection'], capture: ['project','id','expected-revision'],
  import: ['project','id','expected-revision','source'], combine: ['project','id','expected-revision','captures'], select: ['project','id','expected-revision','capture'],
  review: ['project','id','expected-revision','capture','policy','note'], compare: ['project','before','after','out'],
  source: ['project','capture','out'], publish: ['project','id','expected-revision','review','origin','path','payment'],
  merchant: ['project','publication','port','facilitator','allow-local-facilitator'],
  prepare: ['project','publication','intent','query','file','previous','accept','out'],
  buy: ['project','publication','intent','buyer-config'], recover: ['project','publication','intent','buyer-config'],
  delivery: ['project','publication','intent','buyer-config','out'], export: ['project','out'],
  receive: ['project','source'], abandon: ['project','id','expected-revision','pending'],
};
function options(command, args) {
  const allowed = optionsFor[command]; need(allowed, 'Unknown command; use fred --help.');
  const output = {};
  for (let index = 0; index < args.length; index++) {
    const flag = args[index]; need(flag.startsWith('--') && allowed.includes(flag.slice(2)) && !Object.hasOwn(output, flag.slice(2)),
      'Unknown or duplicate command option: ' + flag);
    const name = flag.slice(2);
    if (name === 'allow-local-facilitator') output[name] = true;
    else { need(args[index + 1] && !args[index + 1].startsWith('--'), 'Value required for ' + flag); output[name] = args[++index]; }
  }
  need(output.project, '--project is required.'); return output;
}
function integer(value, name, fallback) {
  if (value === undefined && fallback !== undefined) return fallback;
  need(typeof value === 'string' && /^\d+$/.test(value) && Number.isSafeInteger(Number(value)), name + ' must be an integer.');
  return Number(value);
}
async function fileJson(path, limit = 128 * 1024 * 1024) {
  need(typeof path === 'string' && path.length > 0, 'A source file is required.');
  const bytes = await readBytes(resolve(path), limit);
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}
async function exported(value, destination) {
  if (!destination) return value;
  const path = resolve(destination), bytes = Buffer.isBuffer(value) ? value : jsonBytes(value);
  await writeBytes(path, bytes, { exclusive: true }); return { destination: path, bytes: bytes.length };
}
async function foreground(session) {
  console.log(JSON.stringify({ state: 'LISTENING', url: session.url,
    ...(session.mode ? { mode: session.mode } : {}), ...(session.editionId ? { editionId: session.editionId } : {}) }));
  await new Promise((done, reject) => {
    let stopping = false;
    const close = async () => {
      if (stopping) return; stopping = true;
      process.removeListener('SIGINT', close); process.removeListener('SIGTERM', close);
      try { await session.close(); done(); } catch (error) { reject(error); }
    };
    process.once('SIGINT', close); process.once('SIGTERM', close);
  });
  return { state: 'CLOSED' };
}
export async function main(args = process.argv.slice(2)) {
  if (!args.length || args.includes('--help') || ['help','-h'].includes(args[0])) { console.log(USAGE); return; }
  const [command, ...rest] = args, flags = options(command, rest), directory = resolve(flags.project);
  const common = () => ({ directory, id: flags.id, expectedRevision: integer(flags['expected-revision'], 'Project revision') });
  const selected = () => selectFredPublication(directory, flags.publication);
  const buyer = async () => { need(flags['buyer-config'], '--buyer-config is required.'); return new Buyer(await readPrivateJson(resolve(flags['buyer-config']), 65536)).ready(); };
  let result;
  switch (command) {
    case 'receiver': {
      if (flags.phase === 'status' && flags.id) { result = await readFredReceiver({ directory, id: flags.id }); break; }
      need(flags.config, '--config selects the existing private receiver settings.');
      const abort = new AbortController(), stop = () => abort.abort();
      process.once('SIGINT', stop); process.once('SIGTERM', stop);
      try { result = await runFredReceiver({ directory, configFile: resolve(flags.config), phase: flags.phase ?? 'run',
        signal: abort.signal, onProgress: value => console.error(JSON.stringify(value)) }); }
      finally { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }
      break;
    }
    case 'init': result = await initializeFredProject({ directory, title: flags.title,
      selection: await fileJson(flags.selection, 65536), apiKeyEnv: flags['api-key-env'] ?? 'FRED_API_KEY' }); break;
    case 'show': result = await fredProjectView(directory); break;
    case 'configure': result = await configureFredProject({ ...common(), selection: await fileJson(flags.selection, 65536) }); break;
    case 'capture': {
      const abort = new AbortController(), stop = () => abort.abort();
      process.once('SIGINT', stop); process.once('SIGTERM', stop);
      try { result = await acquireFredCapture({ ...common(), signal: abort.signal }); }
      finally { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }
      break;
    }
    case 'import': result = await importFredCapture({ ...common(), capture: await fileJson(flags.source) }); break;
    case 'combine': result = await combineFredTables({ ...common(), captureIds: (flags.captures ?? '').split(',').map(value => value.trim()) }); break;
    case 'select': result = await selectFredCapture({ ...common(), captureId: flags.capture }); break;
    case 'review': result = await reviewFredCapture({ ...common(), captureId: flags.capture,
      policy: flags.policy ? await fileJson(flags.policy, 65536) : {},
      note: flags.note ? new TextDecoder('utf-8', { fatal: true }).decode(await readBytes(resolve(flags.note), 32000)) : '' }); break;
    case 'compare': result = await exported(await compareFredCaptures({ directory, before: flags.before, after: flags.after }), flags.out); break;
    case 'source': need(flags.out, '--out is required.'); result = await exported(await getFredCapture(directory, flags.capture), flags.out); break;
    case 'publish': result = await publishFredReview({ ...common(), reviewId: flags.review, origin: flags.origin,
      path: flags.path ?? '/economic-data', payment: await fileJson(flags.payment, 16384) }); break;
    case 'serve': result = await foreground(await startFredWorkspace({ directory, port: integer(flags.port, 'Port', 0),
      buyerConfig: flags['buyer-config'], facilitator: flags.facilitator, allowLocalFacilitator: flags['allow-local-facilitator'] === true })); break;
    case 'merchant': result = await foreground(await startFredMerchant({ directory: await selected(), port: integer(flags.port, 'Port', 0),
      facilitator: flags.facilitator, allowLocalFacilitator: flags['allow-local-facilitator'] === true })); break;
    case 'prepare': result = await exported(await prepareFredPurchase({ directory: await selected(), intentId: flags.intent,
      query: new URLSearchParams(flags.query ?? ''), file: flags.file ?? null,
      previous: flags.previous ? await fileJson(flags.previous, 131072) : null, acceptIndex: integer(flags.accept, 'Payment alternative', 0) }), flags.out); break;
    case 'buy': {
      const root = await selected(); operationId(flags.intent);
      const purchase = await fileJson(resolve(root, 'customer-requests', flags.intent, 'prepared.json'), 131072);
      const value = await executeFredPurchase({ directory: root, buyer: await buyer(), purchase });
      const { result: native, ...plain } = value; result = plain; break;
    }
    case 'recover': {
      const value = await recoverFredPurchase({ directory: await selected(), buyer: await buyer(), intentId: flags.intent });
      const { result: native, ...plain } = value; result = plain; break;
    }
    case 'delivery': {
      need(flags.out, '--out is required.');
      const value = await exportFredPurchase({ directory: await selected(), buyer: await buyer(), intentId: flags.intent });
      result = { ...(await exported(value.bytes, flags.out)), contentType: value.contentType }; break;
    }
    case 'export': need(flags.out, '--out is required.'); result = await exported(await exportFredProject({ directory }), flags.out); break;
    case 'receive': result = await receiveFredProject({ directory, bundle: await fileJson(flags.source, 256 * 1024 * 1024) }); break;
    case 'abandon': result = await abandonFredOperation({ ...common(), pendingId: flags.pending }); break;
  }
  console.log(JSON.stringify(result, null, 2)); return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => { console.error(JSON.stringify({ code: error.code ?? 'FRED_COMMAND_FAILED', message: error.message,
    ...(error.retryAt ? { retryAt: error.retryAt } : {}) })); process.exitCode = 1; });
