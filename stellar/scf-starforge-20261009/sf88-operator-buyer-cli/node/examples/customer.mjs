#!/usr/bin/env node
// MIT — Runnable original SF30 generated-client -> original SF88 application.
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { Buyer } from '../index.mjs';

const usage = `
node examples/customer.mjs review --runtime SF88_DIR --state PRIVATE_DIR \\
  --profile OPERATOR_JSON --client SELLER_CLIENT_MJS --operation OPERATION_ID \\
  --inputs INPUTS_JSON --intent STABLE_ID --max-atomic CEILING [--accept INDEX]
node examples/customer.mjs execute --runtime SF88_DIR --state PRIVATE_DIR --intent STABLE_ID [--output NEW_FILE]
node examples/customer.mjs recover --runtime SF88_DIR --state PRIVATE_DIR --intent STABLE_ID [--output NEW_FILE]
node examples/customer.mjs list --runtime SF88_DIR --state PRIVATE_DIR

node examples/customer.mjs dataset-init --runtime SF88_DIR --state PRIVATE_DIR --dataset NAME
  --config BUYER_JSON --max-pages 20 --max-total-atomic 20000 [--snapshot SHA256]
  Use --workspace EXISTING_BUYER_DIR instead of --config to retain its operator keys.
  Optional: --max-rows 1000000 --max-page-bytes 1048576 --profile OPERATOR_JSON
node examples/customer.mjs dataset-attach --runtime SF88_DIR --state PRIVATE_DIR --dataset NAME --session EXISTING_SESSION
node examples/customer.mjs dataset-run --runtime SF88_DIR --state PRIVATE_DIR --dataset NAME
node examples/customer.mjs dataset-status --runtime SF88_DIR --state PRIVATE_DIR --dataset NAME
node examples/customer.mjs dataset-recover --runtime SF88_DIR --state PRIVATE_DIR --dataset NAME
node examples/customer.mjs dataset-deliver --runtime SF88_DIR --state PRIVATE_DIR --dataset NAME [--output DATA_ROOM]
node examples/customer.mjs dataset-rows --runtime SF88_DIR --state PRIVATE_DIR --dataset NAME [--output NEW_JSONL]
node examples/customer.mjs dataset-list --runtime SF88_DIR --state PRIVATE_DIR

review performs original offline validation; execute invokes the original approval
and buyer exactly once. recover/list never purchase. Supply only a trusted local
generated client module. Original signer secrets stay in the process environment.
Only dataset-run can acquire new pages. It resumes the same native acquisition;
completed/marked pages are never replayed. Dataset delivery and row consumption
are offline. Inspect the original report independently of its process exit status.
`;
const allowed = new Set(['runtime', 'state', 'profile', 'client', 'operation', 'inputs', 'intent', 'max-atomic', 'accept', 'output',
  'dataset','config','workspace','session','max-pages','max-total-atomic','max-rows','max-page-bytes','snapshot']);
async function main([mode, ...args]) {
  if (!mode || mode === '--help') { console.log(usage.trim()); return; }
  if (!['review', 'execute', 'recover', 'list', 'dataset-init','dataset-attach','dataset-run',
    'dataset-status','dataset-recover','dataset-deliver','dataset-rows','dataset-list'].includes(mode)) throw new Error('MODE_INVALID');
  const flags = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]?.slice(2), value = args[index + 1];
    if (!args[index].startsWith('--') || !allowed.has(key) || key in flags || value === undefined)
      throw new Error('ARGUMENTS_INVALID');
    flags[key] = value;
  }
  const required = name => { if (!flags[name]) throw new Error('REQUIRED_ARGUMENT_' + name.toUpperCase().replaceAll('-', '_')); return flags[name]; };
  const buyer = new Buyer({ runtimeDirectory: resolve(required('runtime')), stateDirectory: resolve(required('state')),
    ...(flags.profile ? { operatorProfile: resolve(flags.profile) } : {}) });
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    if (mode.startsWith('dataset-')) {
      if (mode === 'dataset-list') {
        for await (const dataset of buyer.listDatasets())
          console.log(JSON.stringify({id:dataset.id, ...await dataset.inspect()}));
        return;
      }
      const id = required('dataset');
      let dataset = buyer.dataset(id);
      if (mode === 'dataset-init') {
        if (Boolean(flags.config) === Boolean(flags.workspace)) throw new Error('DATASET_ONE_CONFIG_SOURCE_REQUIRED');
        if (flags.workspace && flags.profile) throw new Error('DATASET_WORKSPACE_PROFILE_UNSUPPORTED');
        const integer = name => {
          if (!/^[1-9][0-9]*$/.test(required(name))) throw new Error('DATASET_INTEGER_REQUIRED');
          return Number(flags[name]);
        };
        dataset = await buyer.createDataset({id,
          ...(flags.workspace ? {workspaceDirectory:resolve(flags.workspace)} : {config:resolve(flags.config)}),
          maxPages:integer('max-pages'), maxTotalAtomic:required('max-total-atomic'),
          ...(flags['max-rows'] ? {maxRows:integer('max-rows')} : {}),
          ...(flags['max-page-bytes'] ? {maxPageBytes:integer('max-page-bytes')} : {}),
          ...(flags.snapshot ? {expectedSnapshot:flags.snapshot} : {})});
      } else if (mode === 'dataset-attach') {
        dataset = await buyer.attachDataset({id, directory:resolve(required('session'))});
      }
      if (mode === 'dataset-deliver' || mode === 'dataset-rows') {
        const delivery = await dataset.deliver(mode === 'dataset-deliver' && flags.output
          ? resolve(flags.output) : undefined, {signal:controller.signal});
        if (mode === 'dataset-deliver') console.log(JSON.stringify(delivery.report, null, 2));
        else if (flags.output) console.log(JSON.stringify({output:await delivery.file('dataset.jsonl').saveAs(
          resolve(flags.output), {signal:controller.signal}), dataset:delivery.manifest.dataset}));
        else for await (const row of delivery.rows({signal:controller.signal})) console.log(JSON.stringify(row));
        return;
      }
      const result = mode === 'dataset-run' ? await dataset.run({signal:controller.signal})
        : mode === 'dataset-recover' ? await dataset.recover({signal:controller.signal})
          : await dataset.inspect({signal:controller.signal});
      console.log(JSON.stringify({id, ...result}, null, 2));
      if (result.process.errorCode || result.process.exitCode !== 0 ||
        ['RECONCILIATION_REQUIRED','PAGE_LIMIT_REACHED','TOTAL_CAP_REACHED'].includes(result.native.status)) process.exitCode = 2;
      return;
    }
    if (mode === 'list') {
      for await (const operation of buyer.list()) console.log(JSON.stringify(await operation.inspect()));
      return;
    }
    if (mode === 'review') {
      const generated = await import(pathToFileURL(resolve(required('client'))).href);
      const client = generated.createSellerClient({ buyer });
      const inputs = JSON.parse(await readFile(resolve(required('inputs')), 'utf8'));
      const authorization = { intentId: required('intent'), maxAtomic: required('max-atomic'),
        ...(flags.accept === undefined ? {} : { acceptIndex: Number(flags.accept) }) };
      const operation = await buyer.fromRequest(client.request(required('operation'), inputs, authorization));
      console.log(JSON.stringify(await operation.review(), null, 2));
      return;
    }
    const operation = buyer.operation(required('intent'));
    const result = mode === 'execute'
      ? await operation.execute({ review: await operation.review(), signal: controller.signal })
      : await operation.recover();
    if (!result) { console.log(JSON.stringify(await operation.inspect(), null, 2)); return; }
    const output = flags.output ? await result.saveAs(resolve(flags.output), { signal: controller.signal }) : null;
    console.log(JSON.stringify({ intentId: operation.intentId, status: result.status,
      httpStatus: result.native.httpStatus, ok: result.ok, delivery: result.delivery,
      recovered: result.record.recovered, runtimeError: result.record.runtimeError, output }, null, 2));
    if (!result.ok) process.exitCode = 2;
  } finally { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }
}
main(process.argv.slice(2)).catch(error => {
  const code = error?.code ?? error?.message;
  console.error(JSON.stringify({ error: typeof code === 'string' && /^[A-Z0-9_]{1,120}$/.test(code) ? code : 'CUSTOMER_APPLICATION_FAILED', retry: 'NO_AUTOMATIC_RETRY' }));
  process.exitCode = 1;
});
