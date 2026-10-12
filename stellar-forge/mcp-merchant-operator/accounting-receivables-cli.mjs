#!/usr/bin/env node
// MIT. Original receivables operations with retained requests and complete native file delivery.
import {constants} from 'node:fs';
import {open, mkdir, realpath, lstat, rename, unlink, link} from 'node:fs/promises';
import {createHash, randomUUID} from 'node:crypto';
import {resolve, join, dirname, basename} from 'node:path';
import {pathToFileURL} from 'node:url';
import {acquireStateLease} from '../../stellar/scf-starforge-20261009/merchant-fleet-gateway/state-lease.mjs';
import {writePrivate, privateSupportDirectory} from './host-files.mjs';
import {ACCOUNTING_RECEIVABLES_METHODS, ACCOUNTING_RECEIVABLES_MUTATIONS,
  accountingReceivablesArguments, accountingInvoicePreview, accountingInvoiceIssueArguments,
  accountingPaymentRequestPreview, accountingPaymentRequestArguments, accountingRefundPreview, accountingRefundArguments,
  accountingCreditDispositionPreview, accountingCreditDispositionArguments, accountingBankPostingPreview,
  accountingBankPostingArguments, connectAccountingReceivablesClient}
  from './accounting-receivables-client.mjs';

const REQUEST = 'stellar-forge.accounting-receivables-client-request.v1';
const STATE = 'stellar-forge.accounting-receivables-client-state.v1';
const OPERATIONS = new Set(Object.values(ACCOUNTING_RECEIVABLES_METHODS));
const MUTATIONS = new Set(ACCOUNTING_RECEIVABLES_MUTATIONS);
const PAGED = new Set(['status', 'invoice_preview', 'invoice_detail', 'settlement_ledger', 'payment_list', 'payment_detail', 'refund_list', 'bank_accounts', 'bank_import_list', 'bank_import_detail']);
const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const now = () => new Date().toISOString();
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = (code, message) => Object.assign(new Error(message), {code: 'ACCOUNTING_RECEIVABLES_CLIENT_' + code});
function need(ok, message, code = 'ARGUMENTS') { if (!ok) throw fail(code, message); }
/** Preserve the original public recovery decision with its request identity. */
function problem(error) {
  const result = {code: error?.code ?? 'ERROR', message: String(error?.message ?? error).slice(0, 2000)};
  if (error?.applied === false) result.applied = false;
  if (error?.outcomeUnknown === true) result.outcomeUnknown = true;
  if (error?.reopenRequired === true) result.reopenRequired = true;
  if (Number.isInteger(error?.status)) result.status = error.status;
  if (error?.details !== undefined) result.details = error.details;
  if (plain(error?.commitUncertainty)) result.commitUncertainty = Object.fromEntries(
    ['at', 'action', 'revision', 'causeCode'].filter(key => error.commitUncertainty[key] !== undefined)
      .map(key => [key, error.commitUncertainty[key]]));
  for (const key of ['operationDirectory', 'requestId', 'lookupError', 'releaseError', 'checkpointError'])
    if (error?.[key] !== undefined) result[key] = error[key];
  return result;
}
function exact(value, fields) {
  need(plain(value) && Object.keys(value).every(key => fields.includes(key)),
    'The saved operation contains undeclared fields.', 'REQUEST');
}
function endpoint(url) {
  let value; try { value = new URL(url); }
  catch { throw fail('CONFIGURATION', 'Supply the existing HTTPS or loopback HTTP merchant endpoint.'); }
  need(!value.username && !value.password && !value.search && !value.hash &&
    (value.protocol === 'https:' || value.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(value.hostname)),
    'Use the original HTTPS or loopback HTTP endpoint without credentials, query or fragment.', 'CONFIGURATION');
  return value.href;
}
async function privateDirectory(path) {
  path = resolve(path); await privateSupportDirectory(path);
  const info = await lstat(path);
  need(await realpath(path) === path && (!process.getuid || info.uid === process.getuid()),
    'Use an owner-controlled private directory without symlink ancestors.', 'PRIVATE_DIRECTORY');
  return path;
}
async function readJson(path, maximum = 4_000_000) {
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const info = await file.stat();
    need(info.isFile() && info.nlink === 1 && info.size <= maximum && !(info.mode & 0o077) &&
      (!process.getuid || info.uid === process.getuid()), 'Use the original private regular JSON file.', 'PRIVATE_FILE');
    const bytes = await file.readFile();
    need(bytes.length <= maximum, 'The original operation file grew beyond its size limit.', 'PRIVATE_FILE');
    return JSON.parse(new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(bytes));
  } finally { await file.close(); }
}
async function sourceArguments(kind, value, sourcePath) {
  if (!sourcePath) return value;
  need(['bank_source_inspect', 'bank_source_import'].includes(kind) && plain(value) && !Object.hasOwn(value, 'file'),
    'Use --source only for bank-source-inspect or bank-source-import, with file omitted from the options JSON.');
  const path = resolve(sourcePath), file = await open(path,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const info = await file.stat();
    need(info.isFile() && info.nlink === 1 && info.size > 0 && info.size <= 1_000_000 && !(info.mode & 0o077) &&
      (!process.getuid || info.uid === process.getuid()), 'Use one original private bank source file within 1,000,000 bytes.', 'PRIVATE_FILE');
    const bytes = await file.readFile();
    need(bytes.length > 0 && bytes.length <= 1_000_000, 'The original bank source grew beyond its byte limit.', 'PRIVATE_FILE');
    return {...value, file: {name: basename(path), dataBase64: bytes.toString('base64')}};
  } finally { await file.close(); }
}
async function syncDirectory(directory) {
  const file = await open(directory, constants.O_RDONLY);
  try { await file.sync(); } finally { await file.close(); }
}
function fromPreview(kind, preview, identity) {
  if (kind === 'invoice_issue') return accountingInvoiceIssueArguments(preview, identity);
  if (kind === 'payment_create') return accountingPaymentRequestArguments(preview, identity);
  if (kind === 'refund_commit') return accountingRefundArguments(preview, identity);
  if (kind === 'credit_disposition_apply') return accountingCreditDispositionArguments(preview, identity);
  if (kind === 'bank_receipts_post') return accountingBankPostingArguments(preview, identity);
  throw fail('ARGUMENTS', 'A reviewed preview prepares invoice-issue, payment-create, refund-commit, credit-disposition-apply or bank-receipts-post.');
}
function validateRequest(request) {
  exact(request, ['schema', 'preparedAt', 'url', 'workspace', 'tokenEnv', 'kind', 'arguments', 'preview', 'sha256']);
  const {sha256, ...content} = request;
  need(request.schema === REQUEST && Number.isFinite(Date.parse(request.preparedAt)) &&
    sha(content) === sha256 && endpoint(request.url) === request.url &&
    /^[a-z0-9][a-z0-9_-]{0,63}$/.test(request.workspace ?? '') &&
    /^[A-Za-z_][A-Za-z0-9_]*$/.test(request.tokenEnv ?? ''), 'The retained operation identity changed.', 'REQUEST');
  const args = request.preview === undefined ? accountingReceivablesArguments(request.kind, request.arguments) :
    fromPreview(request.kind, request.preview, request.arguments);
  need(JSON.stringify(args) === JSON.stringify(request.arguments), 'The reviewed original arguments changed.', 'REQUEST');
  return request;
}

/** Retain the complete reviewed request once, including its existing optimistic revision. */
export async function prepareAccountingReceivablesOperation({
  directory, url, workspace, tokenEnv = 'MCP_ACCESS_TOKEN', kind, arguments: value, preview, actor, requestId
} = {}) {
  need(MUTATIONS.has(kind), 'Choose an original receivables mutation.');
  need(preview === undefined ? value !== undefined && actor === undefined && requestId === undefined : value === undefined,
    'Use original arguments, or a complete invoice, payment, refund, disposition or bank posting preview and operator identity.');
  const args = preview === undefined ? accountingReceivablesArguments(kind, value) :
    fromPreview(kind, preview, {actor, requestId: requestId ?? randomUUID()});
  const content = {schema: REQUEST, preparedAt: now(), url: endpoint(url), workspace, tokenEnv,
    kind, arguments: args, ...(preview === undefined ? {} : {preview: structuredClone(preview)})};
  const request = validateRequest({...content, sha256: sha(content)}), text = JSON.stringify(request) + '\n';
  need(Buffer.byteLength(text) <= 8_000_000, 'The complete original request exceeds eight MB.', 'SIZE');
  directory = resolve(directory);
  await privateDirectory(dirname(directory)); await mkdir(directory, {mode: 0o700}); await privateDirectory(directory);
  await writePrivate(join(directory, 'request.json'), text);
  await writePrivate(join(directory, 'state.json'), {schema: STATE, requestSha256: request.sha256,
    phase: 'PREPARED', preparedAt: request.preparedAt, updatedAt: now(), submissionAttempted: false, observation: null});
  await syncDirectory(directory); await syncDirectory(dirname(directory));
  return {directory, kind, requestSha256: request.sha256, arguments: args, phase: 'PREPARED'};
}
async function operation(directory, work) {
  directory = await privateDirectory(directory);
  const lease = await acquireStateLease(directory); let failure;
  try {
    const request = validateRequest(await readJson(join(directory, 'request.json'), 8_000_000));
    const state = await readJson(join(directory, 'state.json'), 32_000_000);
    need(state.schema === STATE && state.requestSha256 === request.sha256 &&
      typeof state.submissionAttempted === 'boolean', 'The operation state belongs to a different request.', 'STATE');
    async function checkpoint(changes) {
      lease.assertHeld(); Object.assign(state, changes, {updatedAt: now()});
      const temporary = join(directory, 'state-' + randomUUID() + '.next');
      try {
        await writePrivate(temporary, state); lease.assertHeld();
        await rename(temporary, join(directory, 'state.json')); await syncDirectory(directory);
      } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
    }
    return await work({directory, request, state, checkpoint});
  } catch (error) { failure = error; throw error; }
  finally {
    try { await lease.close(); }
    catch (error) { if (failure) failure.releaseError = problem(error); else throw error; }
  }
}
/** Read the original request journal first; an explicit execute submits at most one mutation call. */
export async function runAccountingReceivablesOperation({
  directory, execute = false, client: providedClient, environment = process.env, signal
} = {}) {
  need(typeof execute === 'boolean', 'Choose whether to execute the prepared original operation.');
  signal?.throwIfAborted();
  return operation(directory, async context => {
    const {request, state, checkpoint} = context;
    const client = providedClient ?? await connectAccountingReceivablesClient({url: request.url, workspace: request.workspace,
      tokenEnv: request.tokenEnv, environment, signal});
    let failure;
    try {
      need(client.workspace === request.workspace && (!client.endpoint || client.endpoint === request.url),
        'Use the recorded original endpoint and workspace.', 'CONNECTION_BINDING');
      await client.open({requestSignal: signal});
      let observed = await client.reconcileOperation(request.kind, request.arguments, {requestSignal: signal});
      let submitted = false, acknowledged = false;
      if (!observed.found) {
        if (!execute) {
          await checkpoint({phase: 'NOT_OBSERVED', observation: observed});
          return {directory: context.directory, kind: request.kind, found: false,
            previouslyAttempted: state.submissionAttempted, observation: observed};
        }
        await checkpoint({phase: 'SENDING', submissionAttempted: true, sendingAt: now(), sendError: null, lookupError: null});
        try {
          submitted = true;
          observed = {found: true, ...await client.callOperation(request.kind, request.arguments, {requestSignal: signal})};
          acknowledged = true;
        } catch (error) {
          try { await checkpoint({phase: 'UNOBSERVED_REPLY', sendError: problem(error)}); }
          catch (checkpointError) { error.checkpointError = problem(checkpointError); throw error; }
          try { observed = await client.reconcileOperation(request.kind, request.arguments, {timeoutMs: 10000}); }
          catch (lookupError) {
            error.lookupError = problem(lookupError);
            try { await checkpoint({lookupError: problem(lookupError)}); }
            catch (checkpointError) { error.checkpointError = problem(checkpointError); }
            throw error;
          }
          if (!observed.found) throw error;
        }
      }
      await checkpoint({phase: 'OBSERVED', observation: observed, lookupError: null});
      return {directory: context.directory, kind: request.kind, submitted, acknowledged, ...observed};
    } catch (error) {
      failure = error; error.operationDirectory = context.directory; error.requestId = request.arguments.requestId;
      throw error;
    } finally {
      if (!providedClient) try { await client.disconnect(); }
      catch (error) { if (failure) failure.releaseError = problem(error); else throw error; }
    }
  });
}

/** Save complete bytes through the original retained reader and create the destination once. */
export async function downloadAccountingReceivablesFile({
  client, selection, expectedSha256, output, chunkBytes = 65536, maximumBytes = 128_000_000, signal
} = {}) {
  need(client && typeof client.fileChunks === 'function', 'Use the original receivables file consumer.');
  need(Number.isSafeInteger(maximumBytes) && maximumBytes > 0 && maximumBytes <= 128_000_000,
    'Use a complete-file byte limit within the original export size.');
  output = resolve(output);
  const directory = await privateDirectory(dirname(output)), temporary = join(directory, 'receivables-' + randomUUID() + '.partial');
  const handle = await open(temporary, 'wx', 0o600); let metadata, bytes = 0;
  try {
    for await (const chunk of client.fileChunks(selection, {expectedSha256, chunkBytes, signal})) {
      metadata ??= chunk.file;
      need(Number.isSafeInteger(metadata.bytes) && metadata.bytes <= maximumBytes &&
        bytes + chunk.bytes.length <= maximumBytes, 'The original file exceeds the selected byte limit.', 'FILE_SIZE');
      await handle.writeFile(chunk.bytes); bytes += chunk.bytes.length;
    }
    need(metadata && bytes === metadata.bytes, 'The original file snapshot did not finish.', 'FILE_REPLY');
    await handle.sync(); await handle.close(); await link(temporary, output); await unlink(temporary); await syncDirectory(directory);
    return {output, workspace: client.workspace, selection: structuredClone(selection), file: metadata, complete: true};
  } catch (error) { await handle.close().catch(() => {}); await unlink(temporary).catch(() => {}); throw error; }
}
async function savePreview(output, preview) {
  output = resolve(output); const directory = await privateDirectory(dirname(output));
  await writePrivate(output, preview); await syncDirectory(directory); return output;
}
function options(args, allowed) {
  const values = new Map();
  for (let index = 0; index < args.length; index += 2) {
    need(allowed.includes(args[index]) && !values.has(args[index]) && args[index + 1] !== undefined,
      'Use documented option/value pairs without duplicates.');
    values.set(args[index], args[index + 1]);
  }
  return values;
}
function required(values, name) {
  need(values.has(name) && values.get(name), 'Supply ' + name + '.'); return values.get(name);
}
const HELP = `Starforge merchant receivables and invoice collection

  starforge merchant-accounting-receivables open|close|sources
      --url MCP_URL --workspace ALIAS [--token-env NAME]
  starforge merchant-accounting-receivables COMMAND ... --request PRIVATE_ARGUMENTS_JSON
  starforge merchant-accounting-receivables invoice-preview|payment-preview|refund-preview|credit-disposition-preview|bank-posting-preview ...
      --request PRIVATE_SELECTION_JSON [--out NEW_PRIVATE_PREVIEW_JSON]
  starforge merchant-accounting-receivables prepare --dir NEW_PRIVATE_OPERATION
      --url MCP_URL --workspace ALIAS --action MUTATION --request PRIVATE_ARGUMENTS_JSON
  starforge merchant-accounting-receivables prepare --dir NEW_PRIVATE_OPERATION ...
      --action invoice-issue|payment-create|refund-commit|credit-disposition-apply|bank-receipts-post --preview PRIVATE_PREVIEW_JSON
      --actor NAME [--request-id STABLE_ID]
  starforge merchant-accounting-receivables bank-source-inspect|bank-source-import ...
      --request PRIVATE_OPTIONS_JSON [--source PRIVATE_BANK_FILE] [--out NEW_PRIVATE_INSPECTION_JSON]
  starforge merchant-accounting-receivables prepare --dir NEW_PRIVATE_OPERATION ...
      --action bank-source-import --request PRIVATE_OPTIONS_JSON [--source PRIVATE_BANK_FILE]
  starforge merchant-accounting-receivables execute|reconcile --dir PRIVATE_OPERATION
  starforge merchant-accounting-receivables download ... --selection PRIVATE_SELECTION_JSON
      --out NEW_PRIVATE_FILE [--sha256 ORIGINAL_SHA256]
  starforge merchant-accounting-receivables customer-export ... --request PRIVATE_SELECTION_JSON
      [--out NEW_PRIVATE_ACCOUNT_TAR]

Commands:
  status, settings, draft-save, quote-import, invoice-preview, invoice-issue,
  invoice-detail, invoice-void, credit, receipt-record, receipt-void,
  settlement-ledger, settlement-import, allocate, release, customer-export,
  payment-preview, payment-create, payment-list, payment-detail, payment-cancel,
  payment-return, payment-receive, request-lookup, customer-funds,
  refund-preview, refund-commit, refund-list, refund-detail, refund-cancel,
  refund-reverse, refund-return, refund-receive, credit-disposition-preview,
  credit-disposition-apply, bank-accounts, bank-account-save, bank-source-inspect,
  bank-source-import, bank-import-list, bank-import-detail, bank-posting-preview,
  bank-receipts-post, bank-rows-ignore, bank-rows-restore, bank-import-close.

All connection commands accept --url, --workspace and --token-env. The access
token remains in that process environment variable. Inputs are private JSON
files. Mutation requests retain actor, requestId and the original revision.
Use original quoteSource/responseSource aliases configured on this accounting
workspace, or the complete quoteContent/responseContent strings.

invoice-preview returns the complete original document, document SHA, draft
version and workspace revision. payment-preview returns the complete original
wallet proposal and review SHA. --out saves the full preview for review and
preparation. The selected invoice, destination, network, asset, exact amount,
memo, expiry and valuation remain in the original reviewed proposal.

refund-preview and credit-disposition-preview retain the full native proposal,
balance effects, review SHA and current revision. --out saves that review for
prepare. Refund funding selects original credit-bearing allocations; remaining
receipt value stays unapplied. The native preview reports every affected
receipt and invoice before a commit.

customer-funds lists actual customers, available receipt value, eligible
credited allocations, target invoices and retained transfer correction sources.
refund-list --all true preserves the native refunds array and accounting date.
refund-return takes the wallet transaction hash. refund-receive checks that
exact return against the reviewed outgoing source account, destination, asset
and amount. A verified original unposted return can be selected in a new
review through originalRefundId/originalReturnId to record the cash correction.
Dated cancel/reverse operations and their linked replacements retain history.

Bank source commands retain original CSV, OFX or MT940 bytes. --source embeds
one private regular source file up to 1,000,000 bytes into the native JSON;
omit its file property when using --source. Inspection can save the original
headers, sections, row sample and parser findings with --out. MT940 requires
explicit statementOptions; OFX and MT940 use the packaged Python 3.10+ parser.

bank-posting-preview retains exact row splits, proposed receipt corrections,
balance effects, review SHA and revision. Prepare bank-receipts-post from that
complete preview. Split a deposit across actual customers; LINK can match a
portion of an existing original receipt. Native source identities and amounts
remain authoritative. bank-import-detail selects summary, rows, history or
postings; rowStatus, direction and search filter before paging. --all true
requires a non-summary view. Restore rowIds:[] to reopen a closed import.

prepare stores the exact arguments and original connection in a private
operation directory. execute reads the original request journal, then submits
at most one mutation call when the original request is absent. reconcile reads
the original journal. A lost reply gets one source lookup. Subsequent explicit
execute calls reuse the same request ID, argument strings and revision.
Source aliases reconcile against the exact quotation bytes archived by the
original import. An uncertain commit retains the original reopenRequired and
commitUncertainty details with the local operation directory and request ID.

Paged read commands accept --all true to consume every original row at one
revision and accounting date. Select a non-summary view for status,
invoice-detail, payment-detail and bank-import-detail. invoice-preview with --all true selects its
paged line view; ordinary invoice-preview always returns the full document.
payment-detail observations require the original returnId.
payment-return requires a transaction hash; payer is an optional exact account
constraint. payment-receive verifies that returned transaction using the
original native verifier and reports the resulting receipt/allocation or
retained observation.

download reads the exact original file with unchanged selectors, original
readId and SHA-pinned chunks. --sha256 binds a previously reviewed file; without
it the original reader pins its first retained snapshot. Customer account.tar,
issued invoices, credits, archived quotation sources, wallet instructions,
receiving.json and per-return proof.json are available through these selectors.
Refunds use {kind:"receivables-refund",refundId,file}: request/refund/reversal
JSON, HTML and CSV, status.json, receiving.json and proof-OBSERVATION_UUID.json.
Bank files use {kind:"receivables-bank",bankImportId,file}: source.csv/ofx/mt940,
parser-report.json, import.json, rows.json/csv, status.json, reconciliation.json,
and posting-UUID or receipt-UUID JSON, HTML and CSV. The original download
reader pins live reports on their first read and retains exact source bytes.
customer-export --out saves the original native account.tar and returns its
observed file identity. Other customer-export calls return the account inventory.

Ordinary commands release this caller's file reads. close explicitly closes
the original accounting owner. Exit 0: completed, prepared or read.
Exit 3: the original prepared operation is not found. Exit 2: error.
`;

/** CLI calls share one original accounting session and never rewrite mutation JSON. */
export async function main(args = process.argv.slice(2)) {
  if (!args.length || args.length === 1 && ['--help', 'help'].includes(args[0])) {
    process.stdout.write(HELP); return;
  }
  const [command, ...rest] = args, connectionFields = ['--url', '--workspace', '--token-env']; let result;
  if (command === 'prepare') {
    const values = options(rest, ['--dir', ...connectionFields, '--action', '--request', '--preview', '--actor', '--request-id', '--source']);
    const kind = required(values, '--action').replaceAll('-', '_'), previewMode = values.has('--preview');
    need(previewMode ? !values.has('--request') && !values.has('--source') : values.has('--request') && !values.has('--actor') && !values.has('--request-id'),
      'Use --request, or use --preview with --actor and an optional --request-id.');
    result = await prepareAccountingReceivablesOperation({
      directory: required(values, '--dir'), url: required(values, '--url'), workspace: required(values, '--workspace'),
      tokenEnv: values.get('--token-env') ?? 'MCP_ACCESS_TOKEN', kind,
      ...(previewMode ? {preview: await readJson(resolve(required(values, '--preview')), 4_000_000),
        actor: required(values, '--actor'), requestId: values.get('--request-id')} :
        {arguments: await sourceArguments(kind, await readJson(resolve(required(values, '--request')), 4_000_000), values.get('--source'))})
    });
  } else if (command === 'execute' || command === 'reconcile') {
    const values = options(rest, ['--dir']);
    result = await runAccountingReceivablesOperation({directory: required(values, '--dir'), execute: command === 'execute'});
  } else {
    const kind = command.replaceAll('-', '_'), native = OPERATIONS.has(kind);
    need(native || ['open', 'close', 'sources', 'download'].includes(command), 'Choose a documented receivables command.');
    const extra = command === 'download' ? ['--selection', '--sha256', '--out'] : native ?
      ['--request', ...(PAGED.has(kind) ? ['--all'] : []),
        ...(['bank_source_inspect', 'bank_source_import'].includes(kind) ? ['--source'] : []),
        ...(['invoice_preview', 'payment_preview', 'refund_preview', 'credit_disposition_preview', 'bank_posting_preview', 'bank_source_inspect', 'bank_source_import', 'customer_export'].includes(kind) ? ['--out'] : [])] : [];
    const values = options(rest, [...connectionFields, ...extra]);
    const all = values.has('--all');
    if (all) need(values.get('--all') === 'true' && !values.has('--out'),
      'Use --all true for a complete original paged view.');
    const client = await connectAccountingReceivablesClient({url: required(values, '--url'),
      workspace: required(values, '--workspace'), tokenEnv: values.get('--token-env') ?? 'MCP_ACCESS_TOKEN'});
    let failure;
    try {
      if (command === 'close') result = await client.closeWorkspace();
      else if (command === 'sources') result = await client.sources();
      else {
        result = await client.open();
        if (native) {
          if (!['status', 'payment_list', 'customer_funds', 'refund_list', 'bank_accounts', 'bank_import_list'].includes(kind)) required(values, '--request');
          const input = await sourceArguments(kind, values.has('--request') ? await readJson(resolve(values.get('--request')), 4_000_000) : {}, values.get('--source'));
          if (all && kind === 'bank_import_detail') need(['rows', 'history', 'postings'].includes(input.view),
            'Select rows, history or postings for a complete original bank import view.');
          if (all) result = await client.listAll(kind, kind === 'invoice_preview' ? {...input, view: 'lines'} : input);
          else if (kind === 'invoice_preview') {
            const preview = accountingInvoicePreview(await client.previewInvoice(input));
            result = values.has('--out') ? {output: await savePreview(values.get('--out'), preview),
              invoiceId: preview.invoiceId, previewSha256: preview.previewSha256,
              expectedVersion: preview.expectedVersion, revision: preview.revision} : preview;
          } else if (kind === 'payment_preview') {
            const preview = accountingPaymentRequestPreview(await client.previewPaymentRequest(input));
            result = values.has('--out') ? {output: await savePreview(values.get('--out'), preview),
              invoiceId: preview.proposal.invoice.id, paymentRequestId: preview.proposal.id,
              reviewSha256: preview.reviewSha256, revision: preview.revision} : preview;
          } else if (kind === 'refund_preview' || kind === 'credit_disposition_preview') {
            const review = kind === 'refund_preview' ? accountingRefundPreview : accountingCreditDispositionPreview;
            const method = kind === 'refund_preview' ? 'previewRefund' : 'previewCreditDisposition';
            const preview = review(await client[method](input));
            result = values.has('--out') ? {output: await savePreview(values.get('--out'), preview),
              receiptId: preview.proposal.receiptId, customerId: preview.proposal.customerId,
              ...(kind === 'refund_preview' ? {refundId: preview.proposal.id} : {creditDispositionId: preview.proposal.id}),
              reviewSha256: preview.reviewSha256, revision: preview.revision} : preview;
          } else if (kind === 'bank_posting_preview') {
            const preview = accountingBankPostingPreview(await client.previewBankPosting(input));
            result = values.has('--out') ? {output: await savePreview(values.get('--out'), preview),
              bankImportId: preview.proposal.bankImportId, bankPostingId: preview.proposal.id,
              reviewSha256: preview.reviewSha256, revision: preview.revision} : preview;
          } else if (kind === 'bank_source_inspect') {
            const inspection = await client.inspectBankSource(input);
            result = values.has('--out') ? {output: await savePreview(values.get('--out'), inspection),
              source: inspection.source, accountId: inspection.accountId,
              sectionId: inspection.sectionId, revision: inspection.revision} : inspection;
          } else if (kind === 'customer_export' && values.has('--out')) {
            const account = await client.customerExport(input);
            result = {customerId: account.customerId, asOf: account.asOf,
              ...await downloadAccountingReceivablesFile({client, selection: account.packet, output: values.get('--out')})};
          } else {
            try { result = await client.callOperation(kind, input); }
            catch (error) {
              if (MUTATIONS.has(kind)) {
                error.requestId = input.requestId;
                try {
                  const observed = await client.reconcileOperation(kind, input, {timeoutMs: 10000});
                  if (observed.found) result = observed; else throw error;
                } catch (lookupError) {
                  if (lookupError !== error) error.lookupError = problem(lookupError);
                  throw error;
                }
              } else throw error;
            }
            if (kind === 'bank_source_import' && values.has('--out')) {
              const output = await savePreview(values.get('--out'), result); result = {...result, output};
            }
          }
        } else if (command === 'download') result = await downloadAccountingReceivablesFile({
          client, selection: await readJson(resolve(required(values, '--selection')), 65536),
          expectedSha256: values.get('--sha256'), output: required(values, '--out')
        });
      }
    } catch (error) { failure = error; throw error; }
    finally {
      try { await client.disconnect(); }
      catch (error) { if (failure) failure.releaseError = problem(error); else throw error; }
    }
  }
  process.stdout.write(JSON.stringify(result) + '\n');
  if (result?.found === false) process.exitCode = 3;
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => { process.stderr.write(JSON.stringify({error: problem(error)}) + '\n'); process.exitCode = 2; });
