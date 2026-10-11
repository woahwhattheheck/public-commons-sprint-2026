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

node examples/customer.mjs object-init --runtime SF88_DIR --state PRIVATE_DIR --object NAME
  --workspace EXISTING_BUYER_DIR --description MERCHANT_OBJECTS_JSON --object-id ARCHIVE
  --max-total-atomic 3000 [--chunk-bytes 921600]
  Use --config BUYER_JSON for an explicit original operator configuration.
  Explicit plan alternative: --bytes TOTAL --chunk-bytes SIZE --snapshot SHA256
  with optional --sha256 CONTENT_SHA256 --content-type MEDIA_TYPE, without --description/--object-id.
node examples/customer.mjs object-attach --runtime SF88_DIR --state PRIVATE_DIR --object NAME --session EXISTING_SESSION
node examples/customer.mjs object-reopen --runtime SF88_DIR --state PRIVATE_DIR --object NAME
node examples/customer.mjs object-status --runtime SF88_DIR --state PRIVATE_DIR --object NAME [--chunk-offset 0 --chunk-limit 50]
node examples/customer.mjs object-run --runtime SF88_DIR --state PRIVATE_DIR --object NAME
node examples/customer.mjs object-recover --runtime SF88_DIR --state PRIVATE_DIR --object NAME
node examples/customer.mjs object-download --runtime SF88_DIR --state PRIVATE_DIR --object NAME --output PRIVATE_FILE
node examples/customer.mjs object-assemble --runtime SF88_DIR --state PRIVATE_DIR --object NAME --output NEW_PRIVATE_FILE
node examples/customer.mjs object-verify --runtime SF88_DIR --state PRIVATE_DIR --object NAME [--output RECORDED_FILE]
node examples/customer.mjs object-copy --runtime SF88_DIR --state PRIVATE_DIR --object NAME --output RECORDED_FILE --copy NEW_FILE
node examples/customer.mjs object-report --runtime SF88_DIR --state PRIVATE_DIR --object NAME --output NEW_REPORT [--format html|json]
node examples/customer.mjs object-accounting --runtime SF88_DIR --state PRIVATE_DIR --object NAME [--offset 0 --limit 100]
node examples/customer.mjs object-finalize --runtime SF88_DIR --state PRIVATE_DIR --object NAME [--workspace BUYER_DIR]
  Optional: --offset 0 --limit 100 --outbox MERCHANT_OUTBOX --merchant-route ROUTE_ID
node examples/customer.mjs object-list --runtime SF88_DIR --state PRIVATE_DIR

Dataset and object accounting use the same commands below. Replace KIND with
dataset or object, and --KIND with --dataset or --object:
node examples/customer.mjs KIND-accounting --runtime SF88_DIR --state PRIVATE_DIR --KIND NAME [--offset 0 --limit 100]
node examples/customer.mjs KIND-accounting-attach --runtime SF88_DIR --state PRIVATE_DIR --KIND NAME --session EXISTING_SESSION
node examples/customer.mjs KIND-accounting-reopen --runtime SF88_DIR --state PRIVATE_DIR --KIND NAME
node examples/customer.mjs KIND-accounting-all --runtime SF88_DIR --state PRIVATE_DIR --KIND NAME [--limit 100]
node examples/customer.mjs KIND-finalize-all --runtime SF88_DIR --state PRIVATE_DIR --KIND NAME [--workspace BUYER_DIR]
  Optional: --offset NEXT_RANGE --limit 100 --outbox MERCHANT_OUTBOX --merchant-route ROUTE_ID
node examples/customer.mjs KIND-accounting-recover --runtime SF88_DIR --state PRIVATE_DIR --KIND NAME [--command-id ID]
node examples/customer.mjs KIND-accounting-export --runtime SF88_DIR --state PRIVATE_DIR --KIND NAME --output NEW_JSONL
KIND-finalize handles one range. KIND-finalize-all visits the remaining ranges;
each output line is the unchanged original native report and its process result.
Ctrl-C stops before another range starts. accounting-recover reads local command
files only. Accounting export streams all original VIEW ranges to a new file.

review performs original offline validation; execute invokes the original approval
and buyer exactly once. recover/list never purchase. Supply only a trusted local
generated client module. Original signer secrets stay in the process environment.
Only dataset-run can acquire new pages. It resumes the same native acquisition;
completed/marked pages are never replayed. Dataset delivery and row consumption
are offline. Inspect the original report independently of its process exit status.
Only object-run/object-download acquire chunks. All finalize commands explicitly invoke
original financial continuation and can read providers/update the existing ledger.
Other object modes are offline and preserve the original session and receipts.
`;
const allowed = new Set(['runtime', 'state', 'profile', 'client', 'operation', 'inputs', 'intent', 'max-atomic', 'accept', 'output',
  'dataset','config','workspace','session','max-pages','max-total-atomic','max-rows','max-page-bytes','snapshot',
  'object','description','object-id','bytes','chunk-bytes','sha256','content-type','chunk-offset','chunk-limit','copy','format',
  'offset','limit','outbox','merchant-route','command-id']);
const accountingActions = ['accounting','accounting-all','accounting-attach','accounting-reopen',
  'finalize','finalize-all','accounting-recover','accounting-export'];
const accountingModes = ['dataset','object'].flatMap(kind => accountingActions.map(action => kind + '-' + action));
async function main([mode, ...args]) {
  if (!mode || mode === '--help') { console.log(usage.trim()); return; }
  if (!['review', 'execute', 'recover', 'list', 'dataset-init','dataset-attach','dataset-run',
    'dataset-status','dataset-recover','dataset-deliver','dataset-rows','dataset-list',
    'object-init','object-attach','object-reopen','object-status','object-run','object-recover','object-download',
    'object-assemble','object-verify','object-copy','object-report','object-list',...accountingModes].includes(mode)) throw new Error('MODE_INVALID');
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
    if (accountingModes.includes(mode)) {
      const kind = mode.startsWith('dataset-') ? 'dataset' : 'object';
      const id = required(kind), action = mode.slice(kind.length + 1);
      let target = buyer[kind](id);
      const integer = (name, minimum) => {
        const value = required(name);
        if (!/^(0|[1-9][0-9]*)$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < minimum)
          throw new Error('ACCOUNTING_INTEGER_REQUIRED');
        return Number(value);
      };
      const options = {signal:controller.signal,
        ...(flags.workspace ? {workspaceDirectory:resolve(flags.workspace)} : {}),
        ...(flags.offset !== undefined ? {offset:integer('offset',0)} : {}),
        ...(flags.limit !== undefined ? {limit:integer('limit',1)} : {}),
        ...(flags.outbox ? {outboxDirectory:resolve(flags.outbox)} : {}),
        ...(flags['merchant-route'] ? {merchantRoute:flags['merchant-route']} : {})};
      const print = (result, multiline = false) => {
        console.log(JSON.stringify({id, ...result.record, process:result.process,
          commandId:result.commandId, commandDirectory:result.commandDirectory, viewStatus:result.viewStatus}, null, multiline ? 2 : undefined));
        if (result.process.errorCode || result.process.exitCode !== 0 || result.native.interrupted) process.exitCode = 2;
      };
      if (action === 'accounting-attach') {
        target = await buyer[kind === 'dataset' ? 'attachDataset' : 'attachObject'](
          {id, directory:resolve(required('session')), accountingOnly:true});
        print(target.lastAccounting, true);
      } else if (action === 'accounting-reopen') print(await target.initializeAccounting(options), true);
      else if (action === 'accounting-recover') {
        const recovered = await target.recoverAccounting(flags['command-id'] ? {commandId:flags['command-id']} : {});
        console.log(JSON.stringify({id, recovery:recovered}, null, 2));
        if (recovered && recovered.status !== 'RECORDED') process.exitCode = 2;
      } else if (action === 'accounting-export') {
        console.log(JSON.stringify({id, ...await target.exportAccounting(resolve(required('output')), options)}, null, 2));
      } else if (action === 'accounting-all' || action === 'finalize-all') {
        for await (const result of target[action === 'finalize-all' ? 'finalizeAll' : 'accountingPages'](options)) print(result);
      } else print(await target[action](options), true);
      if (controller.signal.aborted) process.exitCode = 130;
      return;
    }
    if (mode.startsWith('object-')) {
      if (mode === 'object-list') {
        for await (const acquisition of buyer.listObjects())
          console.log(JSON.stringify({id:acquisition.id, directory:acquisition.directory}));
        return;
      }
      const integer = (name, minimum = 1) => {
        const value = required(name);
        if (!/^(0|[1-9][0-9]*)$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < minimum)
          throw new Error('OBJECT_INTEGER_REQUIRED');
        return Number(value);
      };
      const id = required('object'), options = {signal:controller.signal,
        ...(flags['chunk-offset'] !== undefined ? {chunkOffset:integer('chunk-offset',0)} : {}),
        ...(flags['chunk-limit'] !== undefined ? {chunkLimit:integer('chunk-limit')} : {})};
      let acquisition = buyer.object(id), result;
      if (mode === 'object-init') {
        if (!flags.config && !flags.workspace) throw new Error('OBJECT_CONFIG_OR_WORKSPACE_REQUIRED');
        if (!flags.config && flags.profile) throw new Error('OBJECT_WORKSPACE_PROFILE_UNSUPPORTED');
        if (flags.description && ['bytes','snapshot','sha256','content-type'].some(key => flags[key] !== undefined))
          throw new Error('OBJECT_DESCRIPTION_OR_EXPLICIT_PLAN_REQUIRED');
        if (!flags.description && flags['object-id']) throw new Error('OBJECT_DESCRIPTION_REQUIRED');
        acquisition = await buyer.createObject({id, maxTotalAtomic:required('max-total-atomic'),
          ...(flags.config ? {config:resolve(flags.config)} : {}),
          ...(flags.workspace ? {workspaceDirectory:resolve(flags.workspace)} : {}),
          ...(flags.description ? {descriptionFile:resolve(flags.description),objectId:required('object-id')}
            : {bytes:integer('bytes'),expectedSnapshot:required('snapshot'),chunkBytes:integer('chunk-bytes')}),
          ...(flags['chunk-bytes'] ? {chunkBytes:integer('chunk-bytes')} : {}),
          ...(flags.sha256 ? {expectedSha256:flags.sha256} : {}),
          ...(flags['content-type'] ? {expectedContentType:flags['content-type']} : {})});
        result = acquisition.lastReport;
      } else if (mode === 'object-attach') {
        acquisition = await buyer.attachObject({id, directory:resolve(required('session'))});
        result = acquisition.lastReport;
      } else if (mode === 'object-reopen') result = await acquisition.initialize(options);
      else if (mode === 'object-status') result = await acquisition.inspect(options);
      else if (mode === 'object-run') result = await acquisition.run(options);
      else if (mode === 'object-recover') result = await acquisition.recover(options);
      else if (mode === 'object-report') result = await acquisition.exportReport(resolve(required('output')),
        {...options, format:flags.format ?? 'html'});
      else {
        const delivery = mode === 'object-download' ? await acquisition.download(resolve(required('output')),options)
          : mode === 'object-assemble' ? await acquisition.assemble(resolve(required('output')),options)
            : await acquisition.delivery(flags.output ? resolve(flags.output) : undefined,options);
        const copiedTo = mode === 'object-copy' ? await delivery.saveAs(resolve(required('copy')),options) : null;
        console.log(JSON.stringify({id, path:delivery.path, assembly:delivery.assembly,
          receiptRecorded:delivery.receiptRecorded, process:delivery.report.process, copiedTo},null,2));
        if (delivery.report.process.errorCode || delivery.report.process.exitCode !== 0) process.exitCode = 2;
        return;
      }
      console.log(JSON.stringify({id, ...result.record, process:result.process},null,2));
      if (result.process.errorCode || result.process.exitCode !== 0 ||
        ['RECONCILIATION_REQUIRED','INTERRUPTED'].includes(result.status)) process.exitCode = 2;
      return;
    }
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
  console.error(JSON.stringify({ error: typeof code === 'string' && /^[A-Z0-9_]{1,120}$/.test(code) ? code : 'CUSTOMER_APPLICATION_FAILED',
    retry: 'NO_AUTOMATIC_RETRY', ...(error.acquisition ? {object:error.acquisition.id} : {}),
    ...(error.dataset ? {dataset:error.dataset.id} : {}),
    ...(error.commandId ? {commandId:error.commandId, commandDirectory:error.commandDirectory} : {}),
    ...(error.partialPath ? {partialPath:error.partialPath, destination:error.destination,
      destinationPublished:error.destinationPublished, nextOffset:error.nextOffset} : {}),
    ...(error.progress ? {native:error.progress.native, process:error.progress.process} : {}) }));
  process.exitCode = 1;
});
