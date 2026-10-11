#!/usr/bin/env node
// MIT — Runnable original SF30 generated-client -> original SF88 application.
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { Buyer } from '../index.mjs';
import { readJson } from '../store.mjs';

const usage = `
node examples/customer.mjs review --runtime SF88_DIR --state PRIVATE_DIR \\
  --profile OPERATOR_JSON --client SELLER_CLIENT_MJS --operation OPERATION_ID \\
  --inputs INPUTS_JSON --intent STABLE_ID --max-atomic CEILING [--accept INDEX]
node examples/customer.mjs execute --runtime SF88_DIR --state PRIVATE_DIR --intent STABLE_ID [--output NEW_FILE]
node examples/customer.mjs recover --runtime SF88_DIR --state PRIVATE_DIR --intent STABLE_ID [--output NEW_FILE]
node examples/customer.mjs list --runtime SF88_DIR --state PRIVATE_DIR

Native inbox commands retain --runtime SF88_DIR --state PRIVATE_DIR. --inbox is
the absolute original inbox directory, and --intent selects one saved request:
node examples/customer.mjs inbox-init --runtime SF88_DIR --state PRIVATE_DIR --inbox NEW_PRIVATE_INBOX
node examples/customer.mjs inbox-handoff-review --runtime SF88_DIR --state PRIVATE_DIR --packet PRIVATE_HANDOFF_JSON [--accept INDEX]
node examples/customer.mjs inbox-enqueue-handoff --runtime SF88_DIR --state PRIVATE_DIR --inbox INBOX_DIR
  --profile OPERATOR_JSON --packet PRIVATE_HANDOFF_JSON --accept INDEX
  Optional: --response-max-bytes BYTES --response-stream ndjson|sse --request-timeout-ms MILLISECONDS
node examples/customer.mjs inbox-enqueue --runtime SF88_DIR --state PRIVATE_DIR --inbox INBOX_DIR --intent SAVED_NODE_INTENT
node examples/customer.mjs inbox-enqueue-config --runtime SF88_DIR --state PRIVATE_DIR --inbox INBOX_DIR --config ORIGINAL_BUYER_JSON
node examples/customer.mjs inbox-list --runtime SF88_DIR --state PRIVATE_DIR --inbox INBOX_DIR
node examples/customer.mjs inbox-show --runtime SF88_DIR --state PRIVATE_DIR --inbox INBOX_DIR --intent ID
node examples/customer.mjs inbox-review --runtime SF88_DIR --state PRIVATE_DIR --inbox INBOX_DIR --intent ID
node examples/customer.mjs inbox-execute --runtime SF88_DIR --state PRIVATE_DIR --inbox INBOX_DIR --intent ID
  Optional: --workspace ORIGINAL_OPERATOR_DIR --review-file SAVED_INBOX_REVIEW_JSON
node examples/customer.mjs inbox-cancel --runtime SF88_DIR --state PRIVATE_DIR --inbox INBOX_DIR --intent ID
node examples/customer.mjs inbox-recover --runtime SF88_DIR --state PRIVATE_DIR --inbox INBOX_DIR --intent ID
node examples/customer.mjs inbox-response --runtime SF88_DIR --state PRIVATE_DIR --inbox INBOX_DIR --intent ID
node examples/customer.mjs inbox-download --runtime SF88_DIR --state PRIVATE_DIR --inbox INBOX_DIR --intent ID --output NEW_FILE
node examples/customer.mjs inbox-read --runtime SF88_DIR --state PRIVATE_DIR --inbox INBOX_DIR --intent ID --format json|csv|ndjson|sse
  Optional: --csv-headers true|false --allow-partial true|false --max-record-bytes BYTES --max-records COUNT
  JSON only: --read-limit BYTES. CSV/NDJSON/SSE write one original record per JSONL line.
node examples/customer.mjs inbox-finalize --runtime SF88_DIR --state PRIVATE_DIR --inbox INBOX_DIR --intent ID --workspace ORIGINAL_OPERATOR_DIR
  Optional pair: --outbox MERCHANT_OUTBOX --merchant-route ROUTE_ID
node examples/customer.mjs inbox-report --runtime SF88_DIR --state PRIVATE_DIR --inbox INBOX_DIR --output NEW_PRIVATE_HTML [--workspace ORIGINAL_OPERATOR_DIR]
All inbox commands accept --inbox-report-limit BYTES for their native result file.
Enqueue never executes. inbox-execute invokes native terminal approval for the
selected request once. After interrupted intake use the same saved --intent and
inbox-enqueue; after an attempt use inbox-show/recover/response. inbox-finalize
explicitly continues original financial accounting. INBOX.md covers the full path.

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
  'offset','limit','outbox','merchant-route','command-id',
  'inbox','packet','review-file','response-max-bytes','response-stream','request-timeout-ms',
  'inbox-report-limit','csv-headers','allow-partial','read-limit','max-record-bytes','max-records']);
const accountingActions = ['accounting','accounting-all','accounting-attach','accounting-reopen',
  'finalize','finalize-all','accounting-recover','accounting-export'];
const accountingModes = ['dataset','object'].flatMap(kind => accountingActions.map(action => kind + '-' + action));
const inboxFlags = {
  'inbox-init': ['inbox'],
  'inbox-handoff-review': ['packet','accept'],
  'inbox-enqueue-handoff': ['inbox','packet','accept','profile','response-max-bytes','response-stream','request-timeout-ms'],
  'inbox-enqueue': ['inbox','intent'],
  'inbox-enqueue-config': ['inbox','config'],
  'inbox-list': ['inbox'],
  'inbox-show': ['inbox','intent'],
  'inbox-review': ['inbox','intent'],
  'inbox-execute': ['inbox','intent','workspace','review-file'],
  'inbox-cancel': ['inbox','intent'],
  'inbox-recover': ['inbox','intent'],
  'inbox-response': ['inbox','intent'],
  'inbox-download': ['inbox','intent','output'],
  'inbox-read': ['inbox','intent','format','csv-headers','allow-partial','read-limit','max-record-bytes','max-records'],
  'inbox-finalize': ['inbox','intent','workspace','outbox','merchant-route'],
  'inbox-report': ['inbox','output','workspace'],
};
const inboxModes = Object.keys(inboxFlags);
function integerFlag(flags, name, minimum = 1) {
  const value = flags[name];
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value) ||
      !Number.isSafeInteger(Number(value)) || Number(value) < minimum)
    throw new Error('INBOX_INTEGER_REQUIRED');
  return Number(value);
}
function booleanFlag(flags, name, fallback = false) {
  if (flags[name] === undefined) return fallback;
  if (!['true','false'].includes(flags[name])) throw new Error('INBOX_BOOLEAN_REQUIRED');
  return flags[name] === 'true';
}
async function writeRecord(value) {
  // Retained large streams must respect the consumer's stdout backpressure.
  await new Promise((resolve, reject) => process.stdout.write(JSON.stringify(value) + '\n',
    error => error ? reject(error) : resolve()));
}
async function runInbox(mode, flags, buyer, signal, required) {
  const valid = new Set(['runtime','state','inbox-report-limit', ...inboxFlags[mode]]);
  for (const key of Object.keys(flags)) if (!valid.has(key)) throw new Error('INBOX_ARGUMENT_NOT_USED_BY_COMMAND');
  const options = {signal};
  const show = result => {
    console.log(JSON.stringify(result, null, 2));
    const processResult = result?.process;
    if (processResult && (processResult.errorCode || processResult.exitCode !== 0)) process.exitCode = 2;
    return result;
  };
  try {
    if (mode === 'inbox-handoff-review') {
      show(await buyer.inspectOperationHandoff(resolve(required('packet')), {
        ...options, ...(flags.accept === undefined ? {} : {accept:integerFlag(flags,'accept',0)})
      }));
      return;
    }
    const directory = resolve(required('inbox'));
    const inbox = mode === 'inbox-init' ? await buyer.createInbox({directory,signal}) : buyer.inbox(directory);
    if (mode === 'inbox-init' || mode === 'inbox-list') { show(await inbox.list(options)); return; }
    if (mode === 'inbox-enqueue-handoff') {
      required('profile');
      const responseFile = {
        ...(flags['response-max-bytes'] === undefined ? {} : {maxBytes:integerFlag(flags,'response-max-bytes')}),
        ...(flags['response-stream'] === undefined ? {} : {stream:{format:flags['response-stream']}}),
      };
      if (flags['response-stream'] !== undefined && !['sse','ndjson'].includes(flags['response-stream']))
        throw new Error('INBOX_RESPONSE_STREAM_INVALID');
      const operation = await buyer.fromOperationHandoff(resolve(required('packet')), {
        accept:integerFlag(flags,'accept',0), signal,
        ...(Object.keys(responseFile).length ? {responseFile} : {}),
        ...(flags['request-timeout-ms'] === undefined ? {} : {requestTimeoutMs:integerFlag(flags,'request-timeout-ms')}),
      });
      try { show(await inbox.enqueue(operation, options)); }
      catch (error) { error.intentId = operation.intentId; error.inboxDirectory = directory; throw error; }
      return;
    }
    if (mode === 'inbox-enqueue-config') {
      show(await inbox.enqueueConfig(resolve(required('config')), options)); return;
    }
    if (mode === 'inbox-report') {
      show(await inbox.exportReport(resolve(required('output')), {
        ...options, ...(flags.workspace ? {workspaceDirectory:resolve(flags.workspace)} : {}),
      })); return;
    }
    const id = required('intent');
    if (mode === 'inbox-enqueue') { show(await inbox.enqueue(buyer.operation(id), options)); return; }
    if (mode === 'inbox-review') { show(await inbox.review(id, options)); return; }
    if (['inbox-show','inbox-cancel','inbox-recover'].includes(mode)) {
      show(await inbox[mode.slice('inbox-'.length)](id, options)); return;
    }
    if (mode === 'inbox-execute') {
      const review = flags['review-file'] ? await readJson(resolve(flags['review-file']), 1048576)
        : await inbox.review(id, options);
      const result = show(await inbox.execute(id, {review,signal,
        ...(flags.workspace ? {workspaceDirectory:resolve(flags.workspace)} : {})}));
      if (result.native?.lastError || result.native?.state !== 'ATTEMPT_RECORDED') process.exitCode = 2;
      const outcome = result.native?.outcome;
      if (outcome && (outcome.error || outcome.evidenceError || outcome.responseCleanupError ||
          !Number.isInteger(outcome.httpStatus) || outcome.httpStatus < 200 || outcome.httpStatus >= 300)) process.exitCode = 2;
      return;
    }
    if (mode === 'inbox-finalize') {
      if (Boolean(flags.outbox) !== Boolean(flags['merchant-route'])) throw new Error('INBOX_MERCHANT_FINALIZATION_PAIR_REQUIRED');
      const result = show(await inbox.finalize(id, {signal,workspaceDirectory:resolve(required('workspace')),
        ...(flags.outbox ? {outboxDirectory:resolve(flags.outbox),merchantRoute:flags['merchant-route']} : {})}));
      if (!['FINALIZED','IDEMPOTENT_FINALIZED'].includes(result.native?.finalization?.result?.outcome) ||
          result.native?.finalizationView?.status !== 'SAVED') process.exitCode = 2;
      return;
    }
    const response = await inbox.response(id, options);
    if (!response) {
      const result = await inbox.show(id, options);
      show({intentId:id,response:null,job:result.native,process:result.process,commandDirectory:result.commandDirectory});
      process.exitCode = 2; return;
    }
    if (mode === 'inbox-response' || mode === 'inbox-download') {
      const output = mode === 'inbox-download' ? await response.saveAs(resolve(required('output')), options) : null;
      show({intentId:id,job:response.job,native:response.native,delivery:response.delivery,stream:response.stream,output});
      return;
    }
    const format = required('format');
    if (!['json','csv','ndjson','sse'].includes(format)) throw new Error('INBOX_READ_FORMAT_INVALID');
    if (flags['csv-headers'] !== undefined && format !== 'csv') throw new Error('INBOX_CSV_HEADERS_REQUIRE_CSV');
    if (flags['read-limit'] !== undefined && format !== 'json') throw new Error('INBOX_READ_LIMIT_REQUIRES_JSON');
    if (!['ndjson','sse'].includes(format) && ['allow-partial','max-record-bytes','max-records'].some(key => flags[key] !== undefined))
      throw new Error('INBOX_STREAM_OPTIONS_REQUIRE_STREAM');
    if (format === 'json') {
      await writeRecord(await response.json({...options,
        ...(flags['read-limit'] === undefined ? {} : {limit:integerFlag(flags,'read-limit',0)})}));
    } else {
      const records = format === 'csv' ? response.csvRows({...options,headers:booleanFlag(flags,'csv-headers')})
        : response[format === 'sse' ? 'events' : 'ndjson']({...options,allowPartial:booleanFlag(flags,'allow-partial'),
          ...(flags['max-record-bytes'] === undefined ? {} : {maxRecordBytes:integerFlag(flags,'max-record-bytes')}),
          ...(flags['max-records'] === undefined ? {} : {maxRecords:integerFlag(flags,'max-records')})});
      for await (const record of records) await writeRecord(record);
    }
  } finally { if (signal.aborted) process.exitCode = 130; }
}
async function main([mode, ...args]) {
  if (!mode || mode === '--help') { console.log(usage.trim()); return; }
  if (!['review', 'execute', 'recover', 'list', 'dataset-init','dataset-attach','dataset-run',
    'dataset-status','dataset-recover','dataset-deliver','dataset-rows','dataset-list',
    'object-init','object-attach','object-reopen','object-status','object-run','object-recover','object-download',
    'object-assemble','object-verify','object-copy','object-report','object-list',...accountingModes,...inboxModes].includes(mode)) throw new Error('MODE_INVALID');
  const flags = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]?.slice(2), value = args[index + 1];
    if (!args[index].startsWith('--') || !allowed.has(key) || key in flags || value === undefined)
      throw new Error('ARGUMENTS_INVALID');
    flags[key] = value;
  }
  const required = name => { if (!flags[name]) throw new Error('REQUIRED_ARGUMENT_' + name.toUpperCase().replaceAll('-', '_')); return flags[name]; };
  const buyer = new Buyer({ runtimeDirectory: resolve(required('runtime')), stateDirectory: resolve(required('state')),
    ...(flags.profile ? { operatorProfile: resolve(flags.profile) } : {}),
    ...(flags['inbox-report-limit'] === undefined ? {} : {inboxReportLimit:integerFlag(flags,'inbox-report-limit')}) });
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    if (inboxModes.includes(mode)) { await runInbox(mode, flags, buyer, controller.signal, required); return; }
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
    ...(error.commandId ? {commandId:error.commandId} : {}),
    ...(error.commandDirectory ? {commandDirectory:error.commandDirectory} : {}),
    ...(error.intentId ? {intentId:error.intentId} : {}),
    ...(error.inboxDirectory ? {inboxDirectory:error.inboxDirectory} : {}),
    ...(error.name === 'InboxError' && error.result ? {native:error.result.native,process:error.result.process} : {}),
    ...(error.partialPath ? {partialPath:error.partialPath, destination:error.destination,
      destinationPublished:error.destinationPublished, nextOffset:error.nextOffset} : {}),
    ...(error.progress ? {native:error.progress.native, process:error.progress.process} : {}) }));
  process.exitCode = process.exitCode === 130 ? 130 : 1;
});
