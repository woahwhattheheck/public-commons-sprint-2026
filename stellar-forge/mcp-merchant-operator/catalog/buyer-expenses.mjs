// MIT. Original tool metadata; provider runtimes load only when selected.
import { MAX_RETAINED_CHUNK_BYTES } from '../retained-file-contracts.mjs';

const PREFIX = 'merchant_buyer_expense_';

const alias = { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,63}$' };

const record = { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$' };

const request = { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$' };

const sha = { type: 'string', pattern: '^[0-9a-f]{64}$' };

const number = { type: 'integer', minimum: 0 };

const text = (maximum, required = true) => ({ type: 'string', minLength: required ? 1 : 0, maxLength: maximum });

const object = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });

const date = { type: 'string', pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' };

const range = { offset: number, limit: { type: 'integer', minimum: 1, maximum: 200 } };

const workspace = { workspace: alias };

const mutation = { ...workspace, requestId: request, expectedRevision: number };

const actor = text(240);

const reason = text(4000);

const center = object({ id: record, code: text(100), name: text(200), active: { type: 'boolean' } }, ['code', 'name']);

const period = object({ id: record, name: text(200), from_day: date, through_day: date }, ['name', 'from_day', 'through_day']);

const coding = object({ basis: sha, recognition_date: date, operator: actor, memo: text(4000, false),
  allocations: { type: 'array', minItems: 1, maxItems: 100, items: object({
    center_id: record, amount: { type: 'string', pattern: '^[0-9]+$' },
    project: text(160, false), account_code: text(120, false), memo: text(1000, false)
  }, ['center_id', 'amount']) } }, ['basis', 'recognition_date', 'operator', 'allocations']);

const labels = object({ assets: { type: 'array', items: object({
  network: text(200), asset: text(200), symbol: text(24), decimals: { type: 'integer', minimum: 0, maximum: 30 }
}, ['network', 'asset', 'symbol', 'decimals']) } }, ['assets']);

const enums = values => ({ type: 'string', enum: values });

const SPECS = [
  ['workspaces', 'List the host-declared expense workspaces, original SF36 ledgers, MCP quote sources, exact customer receipts and accountant-return aliases.', {}, [], true],
  ['open', 'Explicitly open the original private expense server and its native lifetime lease. Opening does not capture a source or initiate payment.', workspace, ['workspace'], false],
  ['state', 'Read the original workspace revision and a paged source, cost-center, period or asset-label view.', { ...workspace, view: enums(['summary', 'sources', 'centers', 'periods', 'labels']), ...range }, ['workspace'], true],
  ['items', 'Find native expense rows and exact coding status in the original statement projection.', { ...workspace, query: text(300, false), sourceId: record, status: enums(['ABSENT','RESERVED','UNCODED','STALE','CODED','PAYMENT_UNRESOLVED','FAILED_TRANSACTION','NO_SIGNED_DISPATCH','OBSERVATION_REVIEW','SPENDING_SOURCE_REVIEW','NO_PAYMENT_REQUIRED','ACCOUNTING_UNRESOLVED']), ...range }, ['workspace'], true],
  ['item', 'Inspect one original expense, or page its retained coding editions.', { ...workspace, id: record, view: enums(['current','history']), ...range }, ['workspace','id'], true],
  ['refund_packets', 'Page original customer return receipts and retained source-review decisions, including native accounting exports.', { ...workspace, ...range }, ['workspace'], true],
  ['refund_packet', 'Inspect an original receipt, all native decisions and verified returns, optional store-currency mapping, and matching retained buyer payments.', { ...workspace, id: record }, ['workspace','id'], true],
  ['refund_capture', 'Receive one host-declared customer packet through the unchanged Woo refund receiver. It retains source bytes without any merchant write or new payment.', { ...mutation, refundSource: alias }, ['workspace','requestId','expectedRevision','refundSource'], false],
  ['node_preview', 'Inspect the exact host-declared original Node operation accounting export using its original source/result validators. No ledger or payment operation is run.', {...workspace,nodeSource:alias,operator:actor}, ['workspace','nodeSource','operator'], true],
  ['node_capture', 'Retain the previewed original Node accounting export as a pending source capture in the same expense Store. Review it with capture_review; unpaid and unfinalized results create no allocated expense.', {...mutation,nodeSource:alias,operator:actor,previewSha256:sha}, ['workspace','requestId','expectedRevision','nodeSource','operator','previewSha256'], false],
  ['adjustment_capture', 'Capture a host-declared unchanged original AdjustmentWorkspace export and selected payment/job event. It retains every native decision and verified return without merchant writes or a new payment.', { ...mutation, adjustmentSource: alias }, ['workspace','requestId','expectedRevision','adjustmentSource'], false],
  ['refund_review', 'Accept or reject an original receipt, explicitly bind a proof-backed purchase, or retain a reference-only export without creating expense or returned units.', { ...mutation, id: record,
    payload: object({decision:enums(['ACCEPT','REJECT']),operator:actor,reason,purchase_item_id:record,register_original_purchase:{type:'boolean'}},['decision','operator','reason'])
  }, ['workspace','requestId','expectedRevision','id','payload'], false],
  ['credits', 'Page verified native buyer returns with their original source status, optional independent store-currency credit and operation context.', {...workspace,...range}, ['workspace'], true],
  ['credit', 'Inspect one original return, original purchase allocation, contributing returns or retained coding editions.', {...workspace,id:record,view:enums(['current','history']),...range}, ['workspace','id'], true],
  ['credit_coding_save', 'Allocate the exact original native return against remaining original purchase dimensions; retain the same request ID for recovery.', {...mutation,id:record,payload:coding}, ['workspace','requestId','expectedRevision','id','payload'], false],
  ['captures', 'Page the original captures for a registered source.', { ...workspace, sourceId: record, ...range }, ['workspace','sourceId'], true],
  ['capture_status', 'Inspect the selected original capture and its paged source changes.', { ...workspace, id: record, ...range }, ['workspace','id'], true],
  ['ledger_register', 'Capture and register one host-declared read-only original SF36 ledger. Retain requestId before submission.', { ...mutation, ledger: alias, name: text(160), provenance: text(6000, false) }, ['workspace','requestId','expectedRevision','ledger'], false],
  ['mcp_register', 'Capture and register one host-declared original MCP quote store through its read-only native snapshot reader. Saved native transfer observations remain distinct from buyer response and quote price.', { ...mutation, quoteSource: alias, name: text(160), provenance: text(6000, false) }, ['workspace','requestId','expectedRevision','quoteSource'], false],
  ['governed_mcp_register', 'Capture a host-declared original governed MCP descriptor: original quotes and retained native bindings joined to the complete original SF36 ledger. Outstanding reservations and original settled units remain distinct from saved quote observations.', { ...mutation, governedSource: alias, name: text(160), provenance: text(6000, false) }, ['workspace','requestId','expectedRevision','governedSource'], false],
  ['capture', 'Capture a registered source only when its original locator is declared by this host.', { ...mutation, sourceId: record }, ['workspace','requestId','expectedRevision','sourceId'], false],
  ['source_rebind', 'Rebind the same original source type to exactly one declared ledger, quoteSource or governedSource alias, preserving native identity continuity.', { ...mutation, sourceId: record, ledger: alias, quoteSource: alias, governedSource: alias, operator: actor, reason: text(3000) }, ['workspace','requestId','expectedRevision','sourceId','operator','reason'], false],
  ['capture_review', 'Accept or reject the actual retained source edition with a named reviewer and reason.', { ...mutation, id: record, decision: enums(['ACCEPT','REJECT']), operator: actor, reason: text(3000) }, ['workspace','requestId','expectedRevision','id','decision','operator','reason'], false],
  ['center_save', 'Save an original cost center with its native revision check.', { ...mutation, payload: center }, ['workspace','requestId','expectedRevision','payload'], false],
  ['labels_save', 'Save explicitly supplied native asset labels and scales. Amounts remain exact original base-unit strings.', { ...mutation, payload: labels }, ['workspace','requestId','expectedRevision','payload'], false],
  ['period_save', 'Save an original nonoverlapping accounting period.', { ...mutation, payload: period }, ['workspace','requestId','expectedRevision','payload'], false],
  ['coding_save', 'Save a reviewed original allocation whose base-unit lines exactly equal its settled actual.', { ...mutation, id: record, payload: coding }, ['workspace','requestId','expectedRevision','id','payload'], false],
  ['disposition', 'Resolve a displayed original period issue using its current basis and allowed disposition.', { ...mutation, periodId: record,
    payload: object({ item_id: text(160,false), code: text(240), basis: sha, kind: text(100), reason, operator: actor }, ['item_id','code','basis','kind','reason','operator']) }, ['workspace','requestId','expectedRevision','periodId','payload'], false],
  ['period_report', 'Read a current original period summary or page its exact allocations, exposures, exceptions or native groups.', { ...workspace, id: record, view: enums(['summary','allocations','outstanding_reservations','issues','totals','by_cost_center','by_project','outstanding_totals','source_captures','native_payment_outcomes','credit_allocations','credit_totals','net_totals','credit_by_cost_center','net_by_cost_center','merchant_credit_outcomes','merchant_adjustment_outcomes']), ...range }, ['workspace','id'], true],
  ['period_review', 'Save the named reviewer, capacity and conclusion against the current native period context.', { ...mutation, id: record, reviewer: actor, role: actor, notes: text(6000) }, ['workspace','requestId','expectedRevision','id','reviewer','role','notes'], false],
  ['period_close', 'Issue the original ready period using its exact retained review. Same requestId returns the original committed close.', { ...mutation, id: record, reviewId: record }, ['workspace','requestId','expectedRevision','id','reviewId'], false],
  ['period_reopen', 'Reopen the original closed period with a recorded owner and reason, preserving earlier issued editions.', { ...mutation, id: record, operator: actor, reason }, ['workspace','requestId','expectedRevision','id','operator','reason'], false],
  ['history', 'Page retained period reviews and closes, original activity or successful customer request identities.', { ...workspace, kind: enums(['period','activity','requests']), periodId: record, ...range }, ['workspace','kind'], true],
  ['review', 'Inspect a retained original review and page its frozen data.', { ...workspace, id: record, view: enums(['summary','allocations','outstanding_reservations','issues','totals','by_cost_center','by_project','outstanding_totals','source_captures','native_payment_outcomes','credit_allocations','credit_totals','net_totals','credit_by_cost_center','net_by_cost_center','merchant_credit_outcomes','merchant_adjustment_outcomes']), ...range }, ['workspace','id'], true],
  ['issued', 'Inspect a frozen original accountant edition and page its retained data.', { ...workspace, id: record, view: enums(['summary','allocations','outstanding_reservations','issues','totals','by_cost_center','by_project','outstanding_totals','source_captures','native_payment_outcomes','credit_allocations','credit_totals','net_totals','credit_by_cost_center','net_by_cost_center','merchant_credit_outcomes','merchant_adjustment_outcomes']), ...range }, ['workspace','id'], true],
  ['accountant_returns', 'Page accepted bookkeeping returns for the exact frozen buyer period, preserving prior handoffs and original return identities.', {...workspace,closeId:record,...range}, ['workspace','closeId'], true],
  ['accountant_return', 'Read one accepted buyer bookkeeping return or page its original allocation references and accountant revision chain.', {...workspace,id:record,view:enums(['summary','rows','revisions']),...range}, ['workspace','id'], true],
  ['accountant_preview', 'Review a host-declared SHA-pinned accountant return against its original issued buyer source and currently accepted handoffs. This does not change financial facts.', {...workspace,closeId:record,accountantSource:alias}, ['workspace','closeId','accountantSource'], true],
  ['accountant_return_save', 'Accept the reviewed original accountant return into the existing buyer Store transaction. Retain requestId for exact committed-response recovery.', {...mutation,closeId:record,accountantSource:alias,previewSha256:sha,operator:text(160),name:text(160),reason:text(2000,false),supersedes:{type:'array',maxItems:200,items:record}}, ['workspace','requestId','expectedRevision','closeId','accountantSource','previewSha256','operator','name','supersedes'], false],
  ['request', 'Recover the exact original committed response for a saved requestId after an interrupted reply or restart.', { ...workspace, requestId: request }, ['workspace','requestId'], true],
  ['export', 'Retain an exact original project, accountant packet, source capture or issued view under a stable exportId. Complete projects and bookkeeping packets require the inspected workspace revision.', { ...workspace, exportId: alias, kind: enums(['project','accountant','capture','issued-json','issued-html','refund-packet','buyer-accountant-source','bookkeeping','accountant-return','node-operation']), recordId: record, expectedRevision: number }, ['workspace','exportId','kind'], false],
  ['exports', 'Page saved expense export requests and completed files after restart.', range, [], true],
  ['export_status', 'Reopen the original export request and retained completion manifest without opening a ledger.', { exportId: alias }, ['exportId'], true],
  ['manifest', 'Inspect the exact completion-manifest file for the maintained resumable download client.', { exportId: alias }, ['exportId'], true],
  ['file', 'Read SHA-pinned chunks of a saved original expense export or its manifest.', { exportId: alias, file: text(200), expectedManifestSha256: sha, expectedSha256: sha, readId: record, offset: number, limit: {type:'integer',minimum:1,maximum:MAX_RETAINED_CHUNK_BYTES} }, ['exportId','file','expectedManifestSha256'], true],
  ['file_release', 'Release this host-owned temporary file-read snapshot.', { exportId: alias, readId: record }, ['exportId','readId'], true],
  ['close', 'Close only the named expense-server instance owned by this MCP host, draining accepted work and releasing its original lease.', { ...workspace, instanceId: record }, ['workspace','instanceId'], false]
];

function buyerExpenseTools(tool) {
  return SPECS.map(([name, description, properties, required, readOnly]) =>
    tool(PREFIX + name, description, properties, required, { readOnly, idempotent: true }));
}

export { buyerExpenseTools, SPECS, PREFIX, workspace, enums, range, text, record, mutation, alias, object, actor, reason, coding, center, labels, period, sha, request, number, date };
