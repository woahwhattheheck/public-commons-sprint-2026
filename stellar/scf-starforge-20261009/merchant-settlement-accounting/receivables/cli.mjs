#!/usr/bin/env node
// MIT. One operator entrypoint over the original accounting lease and receivables controller.
import {constants} from 'node:fs';
import {createHash} from 'node:crypto';
import {open, mkdir, lstat} from 'node:fs/promises';
import {isAbsolute, join, resolve, dirname, basename} from 'node:path';
import {pathToFileURL} from 'node:url';
import {openAccountingWorkspace} from '../workspace/store.mjs';
import {accountingWorkspaceBinding} from '../workspace/binding.mjs';
import {ReceivablesWorkspace, RECEIVABLE_REQUEST_BYTES} from './store.mjs';
import {json, need} from './core.mjs';

const HELP = 'Merchant receivables\n\n' +
  'starforge receivables serve --directory /private/accounting [--port 8448]\n' +
  'starforge receivables state --directory /private/accounting [--as-of YYYY-MM-DD]\n' +
  'starforge receivables detail --directory /private/accounting --id UUID [--as-of YYYY-MM-DD]\n' +
  'starforge receivables preview --directory /private/accounting --id UUID\n' +
  'starforge receivables ledger --directory /private/accounting --run UUID [--customer UUID] [--offset 0] [--limit 100]\n' +
  'starforge receivables apply --directory /private/accounting --action ACTION --input /private/request.json [--id UUID]\n' +
  'starforge receivables file --directory /private/accounting --id UUID --name invoice.html --out /private/new-file.html\n' +
  'starforge receivables export --directory /private/accounting --customer UUID --out /private/new-account-export [--as-of YYYY-MM-DD]\n\n' +
  'Stellar invoice payment requests:\n' +
  'starforge receivables payment-requests --directory /private/accounting [--invoice UUID] [--customer UUID] [--as-of YYYY-MM-DD] [--offset 0] [--limit 100]\n' +
  'starforge receivables payment-preview --directory /private/accounting --invoice UUID --input /private/payment-terms.json [--out /private/review.json]\n' +
  'starforge receivables payment-create --directory /private/accounting --invoice UUID --input /private/reviewed-payment-request.json\n' +
  'starforge receivables payment-request --directory /private/accounting --id UUID [--as-of YYYY-MM-DD]\n' +
  'starforge receivables payment-return --directory /private/accounting --id UUID --input /private/wallet-return.json\n' +
  'starforge receivables payment-receive --directory /private/accounting --id UUID --input /private/receive-payment.json\n' +
  'starforge receivables payment-cancel --directory /private/accounting --id UUID --input /private/withdrawal.json\n' +
  'starforge receivables payment-file --directory /private/accounting --id UUID --name payment-request.html --out /private/new-request.html\n\n' +
  'Customer credit and order release:\n' +
  'starforge receivables credit-control --directory /private/accounting [--customer UUID] [--search TEXT]\n' +
  'starforge receivables credit-policy --directory /private/accounting --id UUID\n' +
  'starforge receivables credit-policy-save --directory /private/accounting --input /private/policy.json\n' +
  'starforge receivables credit-assess --directory /private/accounting --invoice UUID --input /private/workspace.json [--out /private/assessment.json]\n' +
  'starforge receivables credit-decision-save --directory /private/accounting --invoice UUID --input /private/reviewed-decision.json\n' +
  'starforge receivables credit-decision --directory /private/accounting --id UUID\n' +
  'starforge receivables credit-withdraw --directory /private/accounting --id UUID --input /private/withdrawal.json\n' +
  'starforge receivables credit-decision-file --directory /private/accounting --id UUID --name decision.html --out /private/new-decision.html\n' +
  'starforge receivables credit-control-operation --directory /private/accounting --request ORIGINAL_REQUEST_ID\n' +
  'Issue through the original apply --action issue command with the reviewed invoice and creditDecisionId. Assessments use the current account date.\n\n' +
  'Cash receipt planning:\n' +
  'starforge receivables cash-plans --directory /private/accounting [--status ACTIVE] [--search TEXT]\n' +
  'starforge receivables cash-plan --directory /private/accounting --id UUID [--edition UUID]\n' +
  'starforge receivables cash-plan-preview --directory /private/accounting --input /private/assumptions.json [--out /private/review.json]\n' +
  'starforge receivables cash-plan-save --directory /private/accounting --input /private/reviewed-plan.json\n' +
  'starforge receivables cash-plan-archive|cash-plan-reopen --directory /private/accounting --id UUID --input /private/status.json\n' +
  'starforge receivables cash-plan-file --directory /private/accounting --id UUID [--edition UUID] --name plan.html --out /private/new-plan.html\n' +
  'starforge receivables cash-plan-compare --directory /private/accounting --input /private/compare.json\n' +
  'starforge receivables cash-plan-comparison-file --directory /private/accounting --input /private/compare.json --name comparison.csv --out /private/new-comparison.csv\n' +
  'starforge receivables cash-plan-operation --directory /private/accounting --request ORIGINAL_REQUEST_ID\n\n' +
  'Collections casework:\n' +
  'starforge receivables collections --directory /private/accounting [--as-of YYYY-MM-DD] [--customer UUID] [--owner NAME] [--status OPEN]\n' +
  'starforge receivables collection --directory /private/accounting --id UUID [--as-of YYYY-MM-DD]\n' +
  'starforge receivables collection-save --directory /private/accounting --input /private/case.json\n' +
  'starforge receivables collection-activity|collection-close|collection-reopen --directory /private/accounting --id UUID --input /private/activity.json\n' +
  'starforge receivables collection-reminder --directory /private/accounting --id UUID [--as-of YYYY-MM-DD]\n' +
  'starforge receivables collection-file --directory /private/accounting --id UUID --name case.html --out /private/new-case.html [--as-of YYYY-MM-DD]\n' +
  'starforge receivables collections-export --directory /private/accounting --name collections.csv --out /private/new-collections.csv [--as-of YYYY-MM-DD]\n' +
  'starforge receivables collection-operation --directory /private/accounting --request ORIGINAL_REQUEST_ID\n' +
  'Case mutations retain workspaceId, revision, actor and requestId; existing cases also retain expectedVersion. Activities use explicit effectiveDate and original contact occurredDate.\n\n' +
  'Customer refunds and credit disposition:\n' +
  'starforge receivables funds --directory /private/accounting [--customer UUID] [--as-of YYYY-MM-DD]\n' +
  'starforge receivables refunds --directory /private/accounting [--customer UUID] [--receipt UUID] [--status RECORDED] [--as-of YYYY-MM-DD] [--offset 0] [--limit 100]\n' +
  'starforge receivables refund --directory /private/accounting --id UUID [--as-of YYYY-MM-DD]\n' +
  'starforge receivables refund-preview --directory /private/accounting --input /private/refund-terms.json [--out /private/refund-review.json]\n' +
  'starforge receivables refund-commit --directory /private/accounting --input /private/reviewed-refund.json\n' +
  'starforge receivables refund-cancel|refund-reverse|refund-return|refund-receive --directory /private/accounting --id UUID --input /private/operation.json\n' +
  'starforge receivables refund-file --directory /private/accounting --id UUID --name refund.html --out /private/new-refund.html\n' +
  'starforge receivables credit-disposition-preview --directory /private/accounting --input /private/disposition.json [--out /private/disposition-review.json]\n' +
  'starforge receivables credit-disposition-apply --directory /private/accounting --input /private/reviewed-disposition.json\n\n' +
  'Bank statements and remittances:\n' +
  'starforge receivables bank-accounts --directory /private/accounting [--status ACTIVE] [--search TEXT] [--offset 0] [--limit 100]\n' +
  'starforge receivables bank-account-save --directory /private/accounting --input /private/account.json\n' +
  'starforge receivables bank-source-inspect|bank-source-import --directory /private/accounting --input /private/source-options.json [--source /private/original-statement.csv] [--out /private/inspection.json]\n' +
  'starforge receivables bank-imports --directory /private/accounting [--account UUID] [--status OPEN] [--search TEXT] [--offset 0] [--limit 100]\n' +
  'starforge receivables bank-import --directory /private/accounting --id UUID [--view rows] [--row-status UNASSIGNED] [--direction CREDIT] [--search TEXT] [--offset 0] [--limit 100]\n' +
  'starforge receivables bank-posting-preview --directory /private/accounting --id UUID --input /private/row-splits.json [--out /private/posting-review.json]\n' +
  'starforge receivables bank-receipts-post|bank-rows-ignore|bank-rows-restore|bank-import-close --directory /private/accounting --id UUID --input /private/operation.json\n' +
  'starforge receivables bank-file --directory /private/accounting --id UUID --name source.csv --out /private/new-source.csv\n\n' +
  'Actions: settings, customer, draft, import-quote, issue, credit, void-invoice, receipt, import-settlement, allocate, release, void-receipt, payment-create, payment-cancel, payment-return, payment-receive, refund-commit, refund-cancel, refund-reverse, refund-return, refund-receive, credit-disposition-apply, bank-account-save, bank-source-import, bank-receipts-post, bank-rows-ignore, bank-rows-restore, bank-import-close.\n' +
  'Mutation JSON supplies the current revision, operator actor and a stable requestId. Draft updates also supply expectedVersion; issue supplies the reviewed previewSha256.\n' +
  'Payment preview JSON holds the proposal and reviewSha256. To create it, retain those fields and its revision, and add actor and requestId. Payment command JSON uses the same mutation context as apply.\n' +
  'Payment files: payment-request.json, payment-request.html, payment-request.uri, status.json, receiving.json and proof-RETURN_UUID.json.\n' +
  'Refund and disposition previews save the exact proposal, reviewSha256 and revision. Commit JSON retains those fields and adds actor and a stable requestId.\n' +
  'Refund return JSON carries the wallet transaction; receiving verifies the reviewed source account, destination, network and exact amount.\n' +
  'Refund files include request/refund/reversal JSON, HTML and CSV, status.json, receiving.json and proof-OBSERVATION_UUID.json.\n' +
  'Bank --source embeds the exact original file bytes, up to 1,000,000 bytes, into the request; omit file in the options JSON when using it. CSV needs its original layout; MT940 needs explicit statementOptions. OFX and MT940 use the packaged Python 3.10+ standard-library parser.\n' +
  'Bank posting previews retain proposal, balanceEffects, reviewSha256 and revision. Commit retains the reviewed proposal/reviewSha256/revision and adds actor and stable requestId. Split amounts must total the original cash credit.\n' +
  'bank-rows-restore with rowIds:[] reopens the original closed import. Bank files include original source, parser-report.json, import.json, rows.json/csv, status.json, reconciliation.json and posting/receipt documents.\n' +
  'Reopen the initialized accounting directory. To initialize merchant accounting, also pass --outbox /private/outbox --proof-dir /private/proofs --terms /private/terms.json.\n';

export function parseReceivablesArguments(argv) {
  const [command = 'help', ...rest] = argv, flags = {};
  const known = new Set(["directory","outbox","proof-dir","terms","recovered-dir","port","as-of","id","run","invoice","customer","receipt","status","account","view","row-status","direction","search","source","offset","limit","action","input","name","out","expected-workspace-id","expected-sources-sha256","owner","request",'edition']);
  for (let i = 0; i < rest.length; i += 2) {
    need(/^--[a-z-]+$/.test(rest[i]) && known.has(rest[i].slice(2)) && rest[i + 1] !== undefined && !rest[i + 1].startsWith('--'),
      'INVALID_RECEIVABLES_ARGUMENT', 'Use a documented option followed by its value.');
    const key = rest[i].slice(2);
    need(!Object.hasOwn(flags, key), 'DUPLICATE_RECEIVABLES_ARGUMENT', 'Supply each option once.');
    flags[key] = rest[i + 1];
  }
  return {command, flags};
}
function absolute(value, label) {
  need(typeof value === 'string' && isAbsolute(value) && value === resolve(value) && value !== '/',
    'ABSOLUTE_PATH_REQUIRED', 'Use an absolute normalized ' + label + ' path.');
  return value;
}
async function input(path) {
  const handle = await open(absolute(path, 'request'), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = await handle.stat();
    need(stat.isFile() && stat.size > 0 && stat.size <= RECEIVABLE_REQUEST_BYTES, 'INVALID_RECEIVABLE_INPUT', 'Select one regular request JSON file within the request limit.');
    return JSON.parse(await handle.readFile('utf8'));
  } finally { await handle.close(); }
}
async function bankSourceInput(path, sourcePath) {
  const value = await input(path);
  need(value !== null && typeof value === 'object' && !Array.isArray(value), 'INVALID_BANK_SOURCE_INPUT', 'Use one original source options object.');
  if (!sourcePath) return value;
  need(!Object.hasOwn(value, 'file'), 'DUPLICATE_BANK_SOURCE', 'Choose the source file in JSON or --source.');
  const handle = await open(absolute(sourcePath, 'bank source'), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const stat = await handle.stat();
    need(stat.isFile() && stat.size > 0 && stat.size <= 1_000_000, 'BANK_SOURCE_SIZE', 'Choose one original regular bank source file within 1,000,000 bytes.');
    const bytes = await handle.readFile();
    need(bytes.length > 0 && bytes.length <= 1_000_000, 'BANK_SOURCE_SIZE', 'The original bank source exceeds 1,000,000 bytes.');
    return {...value, file: {name: basename(sourcePath), dataBase64: bytes.toString('base64')}};
  } finally { await handle.close(); }
}
async function newFile(path, bytes) {
  path = absolute(path, 'output');
  const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
}
export async function runReceivablesCli(argv = process.argv.slice(2)) {
  const {command, flags} = parseReceivablesArguments(argv);
  if (command === 'help' || command === '--help') { process.stdout.write(HELP); return; }
  const options = {directory: absolute(flags.directory, 'accounting workspace')};
  for (const [flag, key] of [['outbox','outboxDir'], ['proof-dir','proofDir'], ['terms','termsFile'], ['recovered-dir','recoveredDir']])
    if (flags[flag]) options[key] = absolute(flags[flag], flag);
  if (flags['expected-workspace-id']) options.expectedWorkspaceId = flags['expected-workspace-id'];
  if (flags['expected-sources-sha256']) options.expectedSourcesSha256 = flags['expected-sources-sha256'];
  const asOf = flags['as-of'];
  if (command === 'serve') {
    const port = Number(flags.port ?? 8448);
    need(Number.isInteger(port) && port >= 0 && port <= 65535, 'INVALID_RECEIVABLES_PORT', 'Use an available local port from zero to 65535.');
    const {createReceivablesServer} = await import('./server.mjs');
    const running = await createReceivablesServer({...options, port});
    const binding = accountingWorkspaceBinding(running.workspace.directory, running.workspace.state);
    process.stdout.write(JSON.stringify({schema: 'stellar-forge.merchant-receivables-startup.v1', directory: running.workspace.directory,
      workspaceId: binding.workspaceId, sourcesSha256: binding.sourcesSha256, url: running.url}) + '\n');
    let closing = false;
    const close = async () => { if (closing) return; closing = true; await running.close(); };
    process.once('SIGINT', () => close().catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; }));
    process.once('SIGTERM', () => close().catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; }));
    return running;
  }
  const workspace = await openAccountingWorkspace(options);
  try {
    const receivables = await new ReceivablesWorkspace(workspace).init();
    let result;
    if (command === 'state') result = await receivables.state({asOf});
    else if (command === 'credit-control') result=await receivables.creditControl({customerId:flags.customer,search:flags.search});
    else if (command === 'credit-policy') result=await receivables.creditPolicy(flags.id);
    else if (command === 'credit-policy-save') result=await receivables.saveCreditPolicy(await input(flags.input));
    else if (command === 'credit-assess') {
      result=await receivables.previewCreditAssessment(flags.invoice,await input(flags.input));
      if(flags.out)await newFile(flags.out,Buffer.from(json(result)));
    }
    else if (command === 'credit-decision-save') result=await receivables.saveCreditDecision(flags.invoice,await input(flags.input));
    else if (command === 'credit-decision') result=await receivables.creditDecision(flags.id);
    else if (command === 'credit-withdraw') result=await receivables.withdrawCreditDecision(flags.id,await input(flags.input));
    else if (command === 'credit-control-operation') result=await receivables.creditControlOperation(flags.request);
    else if (command === 'credit-decision-file') {
      const file=await receivables.creditDecisionFile(flags.id,flags.name);
      await newFile(flags.out,file.bytes);
      result={path:flags.out,name:file.name,bytes:file.bytes.length,type:file.type,sha256:createHash('sha256').update(file.bytes).digest('hex')};
    }
    else if (command === 'cash-plans') result=await receivables.cashPlans({status:flags.status,search:flags.search});
    else if (command === 'cash-plan') result=await receivables.cashPlan(flags.id,{editionId:flags.edition});
    else if (command === 'cash-plan-preview') {
      result=await receivables.previewCashPlan(await input(flags.input));
      if(flags.out)await newFile(flags.out,Buffer.from(json(result)));
    }
    else if (command === 'cash-plan-save') result=await receivables.saveCashPlan(await input(flags.input));
    else if (command === 'cash-plan-archive') result=await receivables.archiveCashPlan(flags.id,await input(flags.input));
    else if (command === 'cash-plan-reopen') result=await receivables.reopenCashPlan(flags.id,await input(flags.input));
    else if (command === 'cash-plan-compare') result=await receivables.compareCashPlans(await input(flags.input));
    else if (command === 'cash-plan-operation') result=await receivables.cashPlanOperation(flags.request);
    else if (command === 'cash-plan-file' || command === 'cash-plan-comparison-file') {
      const file=command==='cash-plan-file'?await receivables.cashPlanFile(flags.id,flags.name,{editionId:flags.edition}):
        await receivables.cashPlanComparisonFile(flags.name,await input(flags.input));
      await newFile(flags.out,file.bytes);
      result={path:flags.out,name:file.name,bytes:file.bytes.length,type:file.type,sha256:createHash('sha256').update(file.bytes).digest('hex')};
    }
    else if (command === 'collections') result = await receivables.collectionCases({asOf,customerId:flags.customer,owner:flags.owner,status:flags.status,search:flags.search});
    else if (command === 'collection') result = await receivables.collectionCase(flags.id,{asOf});
    else if (command === 'collection-save') result = await receivables.saveCollectionCase(await input(flags.input));
    else if (command === 'collection-activity') result = await receivables.recordCollectionActivity(flags.id,await input(flags.input));
    else if (command === 'collection-close') result = await receivables.closeCollectionCase(flags.id,await input(flags.input));
    else if (command === 'collection-reopen') result = await receivables.reopenCollectionCase(flags.id,await input(flags.input));
    else if (command === 'collection-reminder') result = await receivables.collectionReminder(flags.id,{asOf});
    else if (command === 'collection-operation') result = await receivables.collectionOperation(flags.request);
    else if (command === 'collection-file' || command === 'collections-export') {
      const file = command === 'collection-file' ? await receivables.collectionFile(flags.id,flags.name,{asOf}) :
        await receivables.collectionsFile(flags.name,{asOf,customerId:flags.customer,owner:flags.owner,status:flags.status,search:flags.search});
      await newFile(flags.out,file.bytes);
      result = {path:flags.out,name:file.name,bytes:file.bytes.length,type:file.type,sha256:createHash('sha256').update(file.bytes).digest('hex')};
    }
    else if (command === 'detail') result = await receivables.detail(flags.id, {asOf});
    else if (command === 'preview') result = await receivables.preview(flags.id);
    else if (command === 'ledger') result = await receivables.ledger({runId: flags.run, customerId: flags.customer, offset: flags.offset, limit: flags.limit});
    else if (command === 'bank-accounts') result = await receivables.bankAccounts({
      status: flags.status, search: flags.search, offset: flags.offset, limit: flags.limit});
    else if (command === 'bank-account-save') result = await receivables.saveBankAccount(await input(flags.input));
    else if (command === 'bank-source-inspect' || command === 'bank-source-import') {
      const value = await bankSourceInput(flags.input, flags.source);
      result = await receivables[command === 'bank-source-inspect' ? 'inspectBankSource' : 'importBankSource'](value);
      if (flags.out) await newFile(flags.out, Buffer.from(json(result)));
    } else if (command === 'bank-imports') result = await receivables.bankImports({
      accountId: flags.account, status: flags.status, search: flags.search, offset: flags.offset, limit: flags.limit});
    else if (command === 'bank-import') result = await receivables.bankImport(flags.id, {
      view: flags.view, rowStatus: flags['row-status'], direction: flags.direction,
      search: flags.search, offset: flags.offset, limit: flags.limit});
    else if (command === 'bank-posting-preview') {
      result = await receivables.previewBankPosting(flags.id, await input(flags.input));
      if (flags.out) await newFile(flags.out, Buffer.from(json(result)));
    } else if (command === 'bank-receipts-post') result = await receivables.postBankReceipts(flags.id, await input(flags.input));
    else if (command === 'bank-rows-ignore') result = await receivables.ignoreBankRows(flags.id, await input(flags.input));
    else if (command === 'bank-rows-restore') result = await receivables.restoreBankRows(flags.id, await input(flags.input));
    else if (command === 'bank-import-close') result = await receivables.closeBankImport(flags.id, await input(flags.input));
    else if (command === 'bank-file') {
      const file = await receivables.bankImportFile(flags.id, flags.name);
      await newFile(flags.out, file.bytes);
      result = {path: flags.out, name: file.name, bytes: file.bytes.length, type: file.type,
        sha256: createHash('sha256').update(file.bytes).digest('hex')};
    }
    else if (command === 'funds') result = await receivables.customerFunds({customerId: flags.customer, asOf});
    else if (command === 'refunds') result = await receivables.refunds({
      customerId: flags.customer, receiptId: flags.receipt, status: flags.status, asOf,
      offset: flags.offset, limit: flags.limit,
    });
    else if (command === 'refund') result = await receivables.refund(flags.id, {asOf});
    else if (command === 'refund-preview' || command === 'credit-disposition-preview') {
      const method = command === 'refund-preview' ? 'previewRefund' : 'previewCreditDisposition';
      result = await receivables[method](await input(flags.input));
      if (flags.out) await newFile(flags.out, Buffer.from(json(result)));
    } else if (command === 'refund-commit') result = await receivables.commitRefund(await input(flags.input));
    else if (command === 'credit-disposition-apply') result = await receivables.applyCreditDisposition(await input(flags.input));
    else if (command === 'refund-cancel') result = await receivables.cancelRefund(flags.id, await input(flags.input));
    else if (command === 'refund-reverse') result = await receivables.reverseRefund(flags.id, await input(flags.input));
    else if (command === 'refund-return') result = await receivables.reportRefundReturn(flags.id, await input(flags.input));
    else if (command === 'refund-receive') result = await receivables.receiveRefund(flags.id, await input(flags.input));
    else if (command === 'refund-file') {
      const file = await receivables.refundFile(flags.id, flags.name);
      await newFile(flags.out, file.bytes);
      result = {path: flags.out, name: file.name, bytes: file.bytes.length, type: file.type,
        sha256: createHash('sha256').update(file.bytes).digest('hex')};
    }
    else if (command === 'payment-requests') result = await receivables.paymentRequests({
      invoiceId: flags.invoice, customerId: flags.customer, status: flags.status, asOf, offset: flags.offset, limit: flags.limit,
    });
    else if (command === 'payment-request') result = await receivables.paymentRequest(flags.id, {asOf});
    else if (command === 'payment-preview') {
      result = await receivables.previewPaymentRequest(flags.invoice, await input(flags.input));
      if (flags.out) await newFile(flags.out, Buffer.from(json(result)));
    } else if (command === 'payment-create') result = await receivables.createPaymentRequest(flags.invoice, await input(flags.input));
    else if (command === 'payment-return') result = await receivables.reportPaymentReturn(flags.id, await input(flags.input));
    else if (command === 'payment-receive') result = await receivables.receivePaymentRequest(flags.id, await input(flags.input));
    else if (command === 'payment-cancel') result = await receivables.cancelPaymentRequest(flags.id, await input(flags.input));
    else if (command === 'payment-file') {
      const file = await receivables.paymentRequestFile(flags.id, flags.name);
      await newFile(flags.out, file.bytes);
      result = {path: flags.out, name: file.name, bytes: file.bytes.length, type: file.type,
        sha256: createHash('sha256').update(file.bytes).digest('hex')};
    } else if (command === 'apply') {
      const value = flags.action === 'bank-source-import' ? await bankSourceInput(flags.input, flags.source) : await input(flags.input);
      const direct = {settings: 'settings', customer: 'saveCustomer', draft: 'saveDraft', 'import-quote': 'importQuote',
        receipt: 'receipt', 'import-settlement': 'importSettlement', allocate: 'allocate',
        'refund-commit': 'commitRefund', 'credit-disposition-apply': 'applyCreditDisposition',
        'bank-account-save': 'saveBankAccount', 'bank-source-import': 'importBankSource'};
      const selected = {issue: 'issue', credit: 'credit', 'void-invoice': 'voidInvoice', release: 'release', 'void-receipt': 'voidReceipt',
        'payment-create': 'createPaymentRequest', 'payment-cancel': 'cancelPaymentRequest',
        'payment-return': 'reportPaymentReturn', 'payment-receive': 'receivePaymentRequest',
        'refund-cancel': 'cancelRefund', 'refund-reverse': 'reverseRefund',
        'refund-return': 'reportRefundReturn', 'refund-receive': 'receiveRefund',
        'bank-receipts-post': 'postBankReceipts', 'bank-rows-ignore': 'ignoreBankRows',
        'bank-rows-restore': 'restoreBankRows', 'bank-import-close': 'closeBankImport'};
      if (Object.hasOwn(direct, flags.action)) result = await receivables[direct[flags.action]](value);
      else if (Object.hasOwn(selected, flags.action)) result = await receivables[selected[flags.action]](flags.id, value);
      else need(false, 'UNKNOWN_RECEIVABLE_ACTION', 'Choose a documented mutation action.');
    } else if (command === 'file') {
      const file = await receivables.file(flags.id, flags.name);
      await newFile(flags.out, file.bytes);
      result = {path: flags.out, bytes: file.bytes.length, type: file.type};
    } else if (command === 'export') {
      const output = absolute(flags.out, 'customer export'), resultFiles = await receivables.exportCustomer(flags.customer, {asOf});
      const parent = await lstat(dirname(output));
      need(parent.isDirectory() && !parent.isSymbolicLink(), 'INVALID_EXPORT_PARENT', 'Choose an existing output parent directory.');
      await mkdir(output, {mode: 0o700}); // Exclusive directory prevents overwriting another export.
      for (const file of resultFiles.files) {
        need(/^(?:documents\/)?[A-Za-z0-9._-]+$/.test(file.name), 'INVALID_EXPORT_NAME', 'The original export filename is invalid.');
        if (file.name.startsWith('documents/')) await mkdir(join(output, 'documents'), {mode: 0o700}).catch(error => { if (error.code !== 'EEXIST') throw error; });
        await newFile(join(output, file.name), file.bytes);
      }
      result = {directory: output, asOf: resultFiles.value.asOf, customerId: flags.customer,
        revision: resultFiles.revision, files: resultFiles.files.map(file => ({name: file.name, bytes: file.bytes.length}))};
    } else need(false, 'UNKNOWN_RECEIVABLES_COMMAND', 'Choose a documented receivables command.');
    process.stdout.write(json(result)); return result;
  } finally { await workspace.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  runReceivablesCli().catch(error => { process.stderr.write(json({error: {code: error.code ?? 'RECEIVABLES_FAILED', message: error.message,...(error.details?{details:error.details}:{})}})); process.exitCode = 1; });
