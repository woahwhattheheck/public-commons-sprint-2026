#!/usr/bin/env node
// MIT. Explicit original buyer actions and offline retained-result consumption.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { TenderlyCustomer, openExport } from './client.mjs';
import { createSelection } from './selection.mjs';
import { readJson, writeJson } from '../../../sf88-operator-buyer-cli/node/store.mjs';

const HELP = [
  'Tenderly native customer', '',
  'selection --plan ORIGINAL_MERCHANT_PLAN --out NEW_CUSTOMER_SELECTION',
  'import --runtime SF88_DIR --state PRIVATE_DIR --profile BUYER_PROFILE',
  '       --handoff ORIGINAL_HANDOFF --accept INDEX --selection CUSTOMER_SELECTION',
  '       (or --config ORIGINAL_BUYER_CONFIG instead of --handoff/--accept)',
  'attach --runtime SF88_DIR --state PRIVATE_DIR --intent ID --selection CUSTOMER_SELECTION',
  'review|execute|status|recover --runtime SF88_DIR --state PRIVATE_DIR --intent ID',
  'export --runtime SF88_DIR --state PRIVATE_DIR --intent ID --out CUSTOMER_EXPORT',
  'analyze --runtime SF88_DIR --state PRIVATE_DIR --intent ID --workspace ANALYSIS_DIR [--label TITLE]',
  'list --runtime SF88_DIR --state PRIVATE_DIR',
  'open-export --directory CUSTOMER_EXPORT', '',
  "Use the merchant's generated selection to pin its EVM network and exact resource.",
  'The advanced --network EVM_ID choice can replace --selection for an independently',
  'reviewed route. Native original terminal approval, policy and spending ledger',
  'govern execute. All other commands retain/review existing input or read saved data.',
  'Export resumes its own interrupted directory and publishes manifest.json last.',
  'Reopening an existing intent uses recover; it preserves the original attempt.', ''
].join('\n');
const allowed = {
  selection: ['plan', 'out'],
  import: ['runtime', 'state', 'profile', 'handoff', 'accept', 'config', 'selection', 'network'],
  attach: ['runtime', 'state', 'intent', 'selection', 'network'],
  review: ['runtime', 'state', 'intent'], execute: ['runtime', 'state', 'intent'],
  status: ['runtime', 'state', 'intent'], recover: ['runtime', 'state', 'intent'],
  export: ['runtime', 'state', 'intent', 'out'], list: ['runtime', 'state'],
  analyze: ['runtime', 'state', 'intent', 'workspace', 'label'],
  'open-export': ['directory'],
};
const fail = code => { throw Object.assign(new Error(code), { code }); };
const show = value => process.stdout.write(JSON.stringify(value, null, 2) + '\n');

export async function main([mode, ...args] = process.argv.slice(2)) {
  if (!mode || mode === '--help') { process.stdout.write(HELP); return; }
  if (!Object.hasOwn(allowed, mode)) fail('TENDERLY_CUSTOMER_MODE_INVALID');
  const flags = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]?.slice(2), value = args[index + 1];
    if (!args[index]?.startsWith('--') || !allowed[mode].includes(key) || key in flags ||
      value === undefined || value.startsWith('--')) fail('TENDERLY_CUSTOMER_ARGUMENT_INVALID');
    flags[key] = value;
  }
  const required = key => flags[key] || fail('TENDERLY_REQUIRED_' + key.toUpperCase().replaceAll('-', '_'));
  if (mode === 'selection') {
    const selection = createSelection(await readJson(resolve(required('plan'))));
    await writeJson(resolve(required('out')), selection, { exclusive: true });
    show({ file: resolve(flags.out), ...selection }); return;
  }
  if (mode === 'open-export') {
    const saved = await openExport(resolve(required('directory')));
    show({ directory: saved.directory, intentId: saved.manifest.intentId,
      simulation: saved.simulation, native: saved.record.native,
      files: saved.manifest.files }); return;
  }
  const customer = new TenderlyCustomer({ runtimeDirectory: resolve(required('runtime')),
    stateDirectory: resolve(required('state')),
    ...(flags.profile ? { operatorProfile: resolve(flags.profile) } : {}) });
  if (mode === 'list') {
    for await (const operation of customer.list()) show(await operation.inspect());
    return;
  }
  const selection = () => {
    if (Boolean(flags.selection) === Boolean(flags.network)) fail('TENDERLY_ONE_NETWORK_SELECTION_REQUIRED');
    return flags.selection ? { selection: resolve(flags.selection) } : { networkId: flags.network };
  };
  let operation;
  if (mode === 'import') {
    if (Boolean(flags.config) === Boolean(flags.handoff)) fail('TENDERLY_ONE_ORIGINAL_SOURCE_REQUIRED');
    if (flags.handoff) {
      if (!/^(0|[1-9][0-9]*)$/.test(required('accept')) || !Number.isSafeInteger(Number(flags.accept)))
        fail('TENDERLY_EXPLICIT_PAYMENT_SELECTION_REQUIRED');
      operation = await customer.fromOperationHandoff(resolve(flags.handoff),
        { ...selection(), accept: Number(flags.accept) });
    } else {
      if (flags.accept) fail('TENDERLY_PAYMENT_SELECTION_ALREADY_IN_CONFIG');
      operation = await customer.fromConfig(resolve(flags.config), selection());
    }
    show({ intentId: operation.intentId, directory: operation.directory, ...await operation.review() }); return;
  }
  operation = mode === 'attach' ? await customer.attach(required('intent'), selection())
    : customer.operation(required('intent'));
  if (mode === 'review' || mode === 'attach') { show(await operation.review()); return; }
  if (mode === 'status') { show(await operation.inspect()); return; }
  const controller = new AbortController(), stop = () => controller.abort();
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    const result = mode === 'execute' ? await operation.execute({ review: await operation.review(), signal: controller.signal })
      : await operation.recover();
    if (!result) { show({ ...await operation.inspect(), result: null }); process.exitCode = 2; return; }
    if (mode === 'export') {
      show(await result.export(resolve(required('out')), { signal: controller.signal })); return;
    }
    if (mode === 'analyze') {
      const capture = await result.analyze({ workspace: resolve(required('workspace')), label: flags.label ?? '' });
      show({ id: capture.id, analysisPath: capture.analysisPath, record: capture.record }); return;
    }
    const simulation = result.delivery.status === 'SAVED' ? await result.summary() : null;
    show({ intentId: operation.intentId, simulation, native: result.native,
      process: { exitCode: result.record.exitCode, runtimeError: result.record.runtimeError },
      delivery: result.delivery });
    if (!simulation) process.exitCode = 2;
  } finally {
    process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
    if (controller.signal.aborted) process.exitCode = 130;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => {
    const code = error?.code;
    show({ error: typeof code === 'string' && /^[A-Z0-9_]{1,120}$/.test(code)
      ? code : 'TENDERLY_CUSTOMER_OPERATION_FAILED' });
    process.exitCode = 1;
  });
