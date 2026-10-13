#!/usr/bin/env node
// MIT. Standalone native MPP product; the original console, payment and receiving owners execute work.
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { need, plain } from '../../stellar/scf-starforge-20261009/distribution/runtime-workspace/storage.mjs';

const HELP = [
  'Native MPP merchant and customer',
  '',
  'Runtime, using the original exact-lock receiver:',
  '  starforge mpp-workspace runtime-template NATIVE_RUNTIME',
  '  starforge mpp-workspace runtime-receive NATIVE_RUNTIME [--cache ARCHIVE_DIR] [--cache-limit-bytes BYTES] [--offline] [--inspect]',
  '',
  'Product setup and lifecycle:',
  '  starforge mpp-workspace init --dir PRIVATE_PRODUCT --runtime NATIVE_RUNTIME [--workspace ORIGINAL_WORKSPACE] [--name NAME]',
  '  starforge mpp-workspace inspect|recover-setup --dir PRIVATE_PRODUCT',
  '  starforge mpp-workspace open|inspect-launch --dir PRIVATE_PRODUCT [--port 0] [--mcp-port 0]',
  '       [--token-env MCP_ACCESS_TOKEN] [--browser-only] [--managed-binding-sha256 REVIEWED_SHA256]',
  '  starforge mpp-workspace profile --dir PRIVATE_PRODUCT --kind merchant|buyer|customer --file PRIVATE_JSON --revision N [--online]',
  '  starforge mpp-workspace customer-register --dir PRIVATE_PRODUCT --alias NAME --file PRIVATE_JSON --revision N [--label NAME]',
  '  starforge mpp-workspace customer-remove --dir PRIVATE_PRODUCT --alias NAME --revision N',
  '',
  'Recurring channel work:',
  '  starforge mpp-workspace channel help',
  '  starforge mpp-workspace channel state --dir PRIVATE_PRODUCT',
  '  starforge mpp-workspace channel OPERATION --dir PRIVATE_PRODUCT --input OPERATION.json',
  '',
  'Original live console:',
  '  starforge mpp-workspace state|catalog|merchant-stop --dir PRIVATE_PRODUCT',
  '  starforge mpp-workspace merchant-start --dir PRIVATE_PRODUCT [--port 8788]',
  '  starforge mpp-workspace delivery-recover --dir PRIVATE_PRODUCT --id ORIGINAL_DELIVERY_ID',
  '  starforge mpp-workspace customer-intake --dir PRIVATE_PRODUCT --file ORIGINAL_CONTRACT_OR_BUNDLE',
  '  starforge mpp-workspace customer-fetch --dir PRIVATE_PRODUCT --origin PUBLIC_HTTPS_ORIGIN [--transport PRIVATE_JSON]',
  '  starforge mpp-workspace customer-review|customer-configure --dir PRIVATE_PRODUCT --file ORIGINAL_DRAFT_OR_REVIEW [--revision N]',
  '  starforge mpp-workspace preview --dir PRIVATE_PRODUCT --profile-id SHA256 --offer-id OFFER [--input INPUTS_JSON]',
  '  starforge mpp-workspace prepare --dir PRIVATE_PRODUCT --profile-id SHA256 --offer-id OFFER --purchase-id ID [--input INPUTS_JSON]',
  '  starforge mpp-workspace purchase|retry-prepare|execute|resume|finalize --dir PRIVATE_PRODUCT --id ORIGINAL_PURCHASE_ID',
  '  starforge mpp-workspace job --dir PRIVATE_PRODUCT --job-id ID [--purchase-id ID] [--wait-ms 30000]',
  '',
  'Complete original receiving:',
  '  starforge mpp-workspace customer-export --dir PRIVATE_PRODUCT --profile-id SHA256 --out CUSTOMER_DIRECTORY [--bundle-sha256 SHA256]',
  '  starforge mpp-workspace customer-receive --file ORIGINAL_BUNDLE_JSON --out CUSTOMER_DIRECTORY [--resume]',
  '  starforge mpp-workspace customer-inspect|customer-resume --out CUSTOMER_DIRECTORY',
  '  starforge mpp-workspace response --dir PRIVATE_PRODUCT --id ORIGINAL_PURCHASE_ID --out FILE [--sha256 SHA256]',
  '  starforge mpp-workspace agent --dir PRIVATE_PRODUCT --tool merchant_mpp_NAME [--input JSON]',
  '  starforge mpp-workspace agent-download --dir PRIVATE_PRODUCT --export-id ID --out DIRECTORY [--manifest-sha256 SHA256]',
  '',
  'The original browser contains the complete merchant and customer workbench.',
  'Managed Applications retains this command’s terminal for original SF36 consent.',
  'Ctrl-C/Stop drains the original merchant agent, jobs, merchant listener and native workspace.',
  'Use products/mpp-workspace/OPERATING.md and RECEIVING.md for full operator/customer handover.',
  ''
].join('\n');
const print = value => process.stdout.write(JSON.stringify(value, null, 2) + '\n');
const report = error => process.stderr.write((error.code ?? 'MPP_PRODUCT_ERROR') + ': ' + error.message + '\n');
function parse(args, valued, switches = []) {
  const values = new Map();
  for (let index = 0; index < args.length; index++) {
    const name = args[index];
    need((valued.includes(name) || switches.includes(name)) && !values.has(name),
      'MPP_PRODUCT_ARGUMENTS', 'Unknown or repeated option: ' + name);
    if (switches.includes(name)) { values.set(name, true); continue; }
    const value = args[++index];
    need(typeof value === 'string' && value && !value.startsWith('--'),
      'MPP_PRODUCT_ARGUMENTS', 'Supply a value for ' + name);
    values.set(name, value);
  }
  return values;
}
const required = (values, name) => {
  need(values.has(name), 'MPP_PRODUCT_ARGUMENTS', 'Supply ' + name + '.'); return values.get(name);
};
const path = (values, name = '--dir') => resolve(required(values, name));
function number(value, label) {
  need(typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value) && Number.isSafeInteger(Number(value)),
    'MPP_PRODUCT_ARGUMENTS', 'Use a nonnegative integer for ' + label);
  return Number(value);
}
async function document(file) {
  const { privateFile, decode } = await import('./workspace.mjs');
  return decode(await privateFile(resolve(file), 3 * 1024 * 1024));
}
/** Keep the same owner available if a native close reports an incomplete drain. */
async function waitForStop(close) {
  await new Promise(resolve => {
    let busy = false;
    const stop = () => {
      if (busy) return; busy = true;
      Promise.resolve().then(close).then(() => {
        process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); resolve();
      }, error => { busy = false; report(error); });
    };
    process.on('SIGINT', stop); process.on('SIGTERM', stop);
  });
}
export async function main(args = process.argv.slice(2)) {
  const [command, ...rest] = args;
  if (!command || ['help', '--help', '-h'].includes(command)) { process.stdout.write(HELP); return 0; }
  if (['runtime-template', 'runtime-receive', 'native'].includes(command)) {
    const original = await import('../../stellar/scf-starforge-20261009/mpp-charge/cli.mjs');
    return original.main(command === 'native' ? rest : [command, ...rest]);
  }
  if (command === 'channel') {
    const channel = await import('../../stellar/scf-starforge-20261009/mpp-channel/cli.mjs');
    return channel.main(rest);
  }
  let client, active;
  try {
    const workspace = await import('./workspace.mjs');
    const clients = await import('./client.mjs');
    if (command === 'init') {
      const values = parse(rest, ['--dir', '--runtime', '--workspace', '--name']);
      print(await workspace.initializeMppProduct({ directory: path(values),
        dependencyRoot: path(values, '--runtime'), ...(values.has('--workspace') ? { workspaceDirectory: path(values, '--workspace') } : {}),
        ...(values.has('--name') ? { name: values.get('--name') } : {}) })); return 0;
    }
    if (['inspect', 'recover-setup'].includes(command)) {
      const values = parse(rest, ['--dir']);
      print(await (command === 'inspect' ? workspace.inspectMppProduct(path(values)) : workspace.recoverMppProductSetup(path(values))));
      return 0;
    }
    if (['open', 'inspect-launch'].includes(command)) {
      const values = parse(rest, ['--dir', '--port', '--mcp-port', '--token-env', '--managed-binding-sha256'], ['--browser-only']);
      const options = { directory: path(values), port: workspace.portNumber(values.get('--port') ?? 0),
        mcpPort: workspace.portNumber(values.get('--mcp-port') ?? 0), browserOnly: values.has('--browser-only'),
        tokenEnv: values.get('--token-env') ?? 'MCP_ACCESS_TOKEN' };
      const managed = await import('./managed.mjs');
      if (command === 'inspect-launch') {
        need(!values.has('--managed-binding-sha256'), 'MPP_PRODUCT_ARGUMENTS');
        print(await managed.inspectMppLaunch(options)); return 0;
      }
      active = values.has('--managed-binding-sha256') ?
        await managed.openMppProductManaged({ ...options, expectedBindingSha256: values.get('--managed-binding-sha256') }) :
        await workspace.openMppProduct(options);
      process.stdout.write('Private native MPP workspace: ' + active.browserUrl + '\n');
      if (active.startup) process.stdout.write(JSON.stringify(active.startup) + '\n');
      else print({ schema: workspace.MPP_PRODUCT_SESSION_SCHEMA, state: active.state, directory: active.directory,
        workspace: active.workspace, browserUrl: active.browserUrl, mcpUrl: active.mcpUrl, console: 'native',
        pid: active.pid, ppid: active.ppid, versions: active.versions });
      await waitForStop(active.close); active = null; return 0;
    }
    if (command === 'profile') {
      const values = parse(rest, ['--dir', '--kind', '--file', '--revision'], ['--online']);
      const directory = path(values), kind = required(values, '--kind'), file = path(values, '--file');
      const revision = number(required(values, '--revision'), '--revision');
      if (values.has('--online')) {
        client = await clients.connectMppProduct({ directory });
        print(await client.configureProfile(kind, await document(file), revision));
      } else print(await workspace.configureMppProfile({ directory, kind, file, expectedRevision: revision }));
      return 0;
    }
    if (['customer-register', 'customer-remove'].includes(command)) {
      const values = parse(rest, ['--dir', '--alias', '--file', '--revision', '--label']);
      print(await workspace.registerMppCustomer({ directory: path(values), customer: required(values, '--alias'),
        ...(command === 'customer-register' ? { file: path(values, '--file'), label: values.get('--label') } : {}),
        expectedRevision: number(required(values, '--revision'), '--revision'), remove: command === 'customer-remove' }));
      return 0;
    }
    if (command === 'customer-receive') {
      const values = parse(rest, ['--file', '--out'], ['--resume']);
      print(await clients.receiveMppCustomer({ file: path(values, '--file'), directory: path(values, '--out'), resume: values.has('--resume') }));
      return 0;
    }
    if (['customer-inspect', 'customer-resume'].includes(command)) {
      const values = parse(rest, ['--out']);
      print(await (command === 'customer-inspect' ? clients.inspectMppCustomer(path(values, '--out')) :
        clients.resumeMppCustomer(path(values, '--out')))); return 0;
    }
    if (command === 'agent' || command === 'agent-download') {
      const values = parse(rest, command === 'agent' ? ['--dir', '--tool', '--input'] :
        ['--dir', '--export-id', '--out', '--manifest-sha256']);
      const agent = await clients.connectMppAgent({ directory: path(values) });
      const result = command === 'agent' ?
        await agent.call(required(values, '--tool'), values.has('--input') ? await document(values.get('--input')) : {}) :
        await agent.download({ exportId: required(values, '--export-id'), directory: path(values, '--out'),
          expectedManifestSha256: values.get('--manifest-sha256') });
      print(result); return 0;
    }
    const allowed = {
      state: [], catalog: [], 'merchant-start': ['--port'], 'merchant-stop': [], 'delivery-recover': ['--id'],
      'customer-intake': ['--file'], 'customer-fetch': ['--origin', '--transport'],
      'customer-review': ['--file', '--revision'], 'customer-configure': ['--file', '--revision'],
      preview: ['--profile-id', '--offer-id', '--input'], prepare: ['--profile-id', '--offer-id', '--purchase-id', '--input'],
      purchase: ['--id'], 'retry-prepare': ['--id'], execute: ['--id'], resume: ['--id'], finalize: ['--id'],
      job: ['--job-id', '--purchase-id', '--wait-ms'],
      'customer-export': ['--profile-id', '--out', '--bundle-sha256'], response: ['--id', '--out', '--sha256']
    };
    need(Object.hasOwn(allowed, command), 'MPP_PRODUCT_ARGUMENTS', 'Use help for the original product commands.');
    const values = parse(rest, ['--dir', ...allowed[command]]);
    client = await clients.connectMppProduct({ directory: path(values) });
    let result;
    if (command === 'state') result = await client.state();
    else if (command === 'catalog') result = await client.catalog();
    else if (command === 'merchant-start') result = await client.startMerchant(workspace.portNumber(values.get('--port') ?? 8788));
    else if (command === 'merchant-stop') result = await client.stopMerchant();
    else if (command === 'delivery-recover') result = await client.recoverDelivery(required(values, '--id'));
    else if (command === 'customer-intake') result = await client.intake(await document(required(values, '--file')));
    else if (command === 'customer-fetch') result = await client.fetchContract(required(values, '--origin'),
      values.has('--transport') ? await document(values.get('--transport')) : undefined);
    else if (command === 'customer-review' || command === 'customer-configure') {
      const saved = await document(required(values, '--file')), profile = saved.profile ?? saved.draft ?? saved;
      const revision = values.has('--revision') ? number(values.get('--revision'), '--revision') : saved.revision;
      result = command === 'customer-review' ? await client.reviewCustomer(profile, revision) : await client.configureCustomer(profile, revision);
    } else if (command === 'preview' || command === 'prepare') {
      const inputs = values.has('--input') ? await document(values.get('--input')) : {};
      need(plain(inputs) && Object.keys(inputs).every(key =>
        (command === 'prepare' ? ['query', 'json', 'challengeId'] : ['query', 'json']).includes(key)),
      'MPP_PRODUCT_ARGUMENTS', 'Use original query, JSON body and optional challengeId fields.');
      const selected = { profileId: required(values, '--profile-id'), offerId: required(values, '--offer-id') };
      result = command === 'preview' ? await client.preview({ ...selected, inputs }) :
        await client.prepare({ ...selected, ...inputs, purchaseId: required(values, '--purchase-id') });
    } else if (command === 'job') {
      const options = { purchaseId: values.get('--purchase-id') };
      result = values.has('--wait-ms') ?
        await client.waitJob(required(values, '--job-id'), { ...options, timeoutMs: number(values.get('--wait-ms'), '--wait-ms') }) :
        await client.job(required(values, '--job-id'), options);
    } else if (command === 'customer-export') {
      result = await client.receiveCustomer({ profileId: required(values, '--profile-id'), directory: path(values, '--out'),
        expectedBundleSha256: values.get('--bundle-sha256') });
    } else if (command === 'response') {
      result = await client.downloadResponse({ purchaseId: required(values, '--id'), path: path(values, '--out'),
        expectedSha256: values.get('--sha256') });
    } else {
      const method = command === 'retry-prepare' ? 'retryPrepare' : command;
      result = await client[method](required(values, '--id'));
    }
    print(result); return 0;
  } catch (error) {
    if (error.close && !active) {
      report(error); await waitForStop(error.close); return 1;
    }
    report(error); return 1;
  } finally { await client?.close(); await active?.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().then(code => { process.exitCode = code; }, error => { report(error); process.exitCode = 1; });
