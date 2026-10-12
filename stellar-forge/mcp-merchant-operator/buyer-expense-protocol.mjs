// MIT. Shared customer tool contract; original SF36 methods retain all financial semantics.
import { MAX_RETAINED_CHUNK_BYTES } from './retained-file-reads.mjs';
export const PREFIX = 'merchant_buyer_expense_';
const hash = value => createHash('sha256').update(value).digest('hex');
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const own = (value, key) => Object.hasOwn(value, key);
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
  ['workspaces', 'List the host-declared expense workspaces and original ledger aliases.', {}, [], true],
  ['open', 'Explicitly open the original private expense server and its native lifetime lease. Opening does not capture a ledger.', workspace, ['workspace'], false],
  ['state', 'Read the original workspace revision and a paged source, cost-center, period or asset-label view.', { ...workspace, view: enums(['summary', 'sources', 'centers', 'periods', 'labels']), ...range }, ['workspace'], true],
  ['items', 'Find native expense rows and exact coding status in the original statement projection.', { ...workspace, query: text(300, false), sourceId: record, status: enums(['ABSENT','RESERVED','UNCODED','STALE','CODED']), ...range }, ['workspace'], true],
  ['item', 'Inspect one original expense, or page its retained coding editions.', { ...workspace, id: record, view: enums(['current','history']), ...range }, ['workspace','id'], true],
  ['captures', 'Page the original captures for a registered source.', { ...workspace, sourceId: record, ...range }, ['workspace','sourceId'], true],
  ['capture_status', 'Inspect the selected original capture and its paged source changes.', { ...workspace, id: record, ...range }, ['workspace','id'], true],
  ['ledger_register', 'Capture and register one host-declared read-only original SF36 ledger. Retain requestId before submission.', { ...mutation, ledger: alias, name: text(160), provenance: text(6000, false) }, ['workspace','requestId','expectedRevision','ledger'], false],
  ['capture', 'Capture a registered source only when its original locator is declared by this host.', { ...mutation, sourceId: record }, ['workspace','requestId','expectedRevision','sourceId'], false],
  ['source_rebind', 'Rebind a source to a declared original ledger, preserving the native request-continuity check.', { ...mutation, sourceId: record, ledger: alias, operator: actor, reason: text(3000) }, ['workspace','requestId','expectedRevision','sourceId','ledger','operator','reason'], false],
  ['capture_review', 'Accept or reject the actual retained source edition with a named reviewer and reason.', { ...mutation, id: record, decision: enums(['ACCEPT','REJECT']), operator: actor, reason: text(3000) }, ['workspace','requestId','expectedRevision','id','decision','operator','reason'], false],
  ['center_save', 'Save an original cost center with its native revision check.', { ...mutation, payload: center }, ['workspace','requestId','expectedRevision','payload'], false],
  ['labels_save', 'Save explicitly supplied native asset labels and scales. Amounts remain exact original base-unit strings.', { ...mutation, payload: labels }, ['workspace','requestId','expectedRevision','payload'], false],
  ['period_save', 'Save an original nonoverlapping accounting period.', { ...mutation, payload: period }, ['workspace','requestId','expectedRevision','payload'], false],
  ['coding_save', 'Save a reviewed original allocation whose base-unit lines exactly equal its settled actual.', { ...mutation, id: record, payload: coding }, ['workspace','requestId','expectedRevision','id','payload'], false],
  ['disposition', 'Resolve a displayed original period issue using its current basis and allowed disposition.', { ...mutation, periodId: record,
    payload: object({ item_id: text(160,false), code: text(240), basis: sha, kind: text(100), reason, operator: actor }, ['item_id','code','basis','kind','reason','operator']) }, ['workspace','requestId','expectedRevision','periodId','payload'], false],
  ['period_report', 'Read a current original period summary or page its exact allocations, exposures, exceptions or native groups.', { ...workspace, id: record, view: enums(['summary','allocations','outstanding_reservations','issues','totals','by_cost_center','by_project','outstanding_totals','source_captures']), ...range }, ['workspace','id'], true],
  ['period_review', 'Save the named reviewer, capacity and conclusion against the current native period context.', { ...mutation, id: record, reviewer: actor, role: actor, notes: text(6000) }, ['workspace','requestId','expectedRevision','id','reviewer','role','notes'], false],
  ['period_close', 'Issue the original ready period using its exact retained review. Same requestId returns the original committed close.', { ...mutation, id: record, reviewId: record }, ['workspace','requestId','expectedRevision','id','reviewId'], false],
  ['period_reopen', 'Reopen the original closed period with a recorded owner and reason, preserving earlier issued editions.', { ...mutation, id: record, operator: actor, reason }, ['workspace','requestId','expectedRevision','id','operator','reason'], false],
  ['history', 'Page retained period reviews and closes, original activity or successful customer request identities.', { ...workspace, kind: enums(['period','activity','requests']), periodId: record, ...range }, ['workspace','kind'], true],
  ['review', 'Inspect a retained original review and page its frozen data.', { ...workspace, id: record, view: enums(['summary','allocations','outstanding_reservations','issues','totals','by_cost_center','by_project','outstanding_totals','source_captures']), ...range }, ['workspace','id'], true],
  ['issued', 'Inspect a frozen original accountant edition and page its retained data.', { ...workspace, id: record, view: enums(['summary','allocations','outstanding_reservations','issues','totals','by_cost_center','by_project','outstanding_totals','source_captures']), ...range }, ['workspace','id'], true],
  ['request', 'Recover the exact original committed response for a saved requestId after an interrupted reply or restart.', { ...workspace, requestId: request }, ['workspace','requestId'], true],
  ['export', 'Retain an exact original project, accountant packet, source capture or issued view under a stable exportId. Projects require the inspected workspace revision.', { ...workspace, exportId: alias, kind: enums(['project','accountant','capture','issued-json','issued-html']), recordId: record, expectedRevision: number }, ['workspace','exportId','kind'], false],
  ['exports', 'Page saved expense export requests and completed files after restart.', range, [], true],
  ['export_status', 'Reopen the original export request and retained completion manifest without opening a ledger.', { exportId: alias }, ['exportId'], true],
  ['manifest', 'Inspect the exact completion-manifest file for the maintained resumable download client.', { exportId: alias }, ['exportId'], true],
  ['file', 'Read SHA-pinned chunks of a saved original expense export or its manifest.', { exportId: alias, file: text(200), expectedManifestSha256: sha, expectedSha256: sha, readId: record, offset: number, limit: {type:'integer',minimum:1,maximum:MAX_RETAINED_CHUNK_BYTES} }, ['exportId','file','expectedManifestSha256'], true],
  ['file_release', 'Release this host-owned temporary file-read snapshot.', { exportId: alias, readId: record }, ['exportId','readId'], true],
  ['close', 'Close only the named expense-server instance owned by this MCP host, draining accepted work and releasing its original lease.', { ...workspace, instanceId: record }, ['workspace','instanceId'], false]
];
export function buyerExpenseTools(tool) {
  return SPECS.map(([name, description, properties, required, readOnly]) =>
    tool(PREFIX + name, description, properties, required, { readOnly, idempotent: true }));
}
export const BUYER_EXPENSE_ACTIONS = Object.freeze(Object.fromEntries(SPECS.map(([name, description, properties, required, readOnly]) =>
  [name, { description, inputSchema: object(properties, required), readOnly }])));

export function validateBuyerExpenseArguments(action,args) {
  const definition=BUYER_EXPENSE_ACTIONS[action];
  const invalid=message=>{throw Object.assign(new Error(message),{code:'BUYER_EXPENSE_ARGUMENTS'});};
  if(!definition)invalid('Choose an original buyer expense action.');
  function visit(value,spec,path) {
    if(spec.enum&&!spec.enum.includes(value))invalid(path+' must use a declared choice.');
    if(spec.type==='object'){
      if(value===null||typeof value!=='object'||Array.isArray(value))invalid(path+' must be an object.');
      if(Object.keys(value).some(k=>!Object.hasOwn(spec.properties,k))||(spec.required??[]).some(k=>!Object.hasOwn(value,k)))invalid(path+' needs exactly its declared fields.');
      for(const [k,v] of Object.entries(value))visit(v,spec.properties[k],path+'.'+k);
    }else if(spec.type==='array'){
      if(!Array.isArray(value)||(spec.minItems!==undefined&&value.length<spec.minItems)||(spec.maxItems!==undefined&&value.length>spec.maxItems))invalid(path+' must be an array within its declared count.');
      value.forEach((v,i)=>visit(v,spec.items,path+'['+i+']'));
    }else if(spec.type==='integer'){
      if(!Number.isSafeInteger(value)||(spec.minimum!==undefined&&value<spec.minimum)||(spec.maximum!==undefined&&value>spec.maximum))invalid(path+' must be an exact whole number within its declared range.');
    }else if(spec.type==='string'){
      if(typeof value!=='string'||(spec.minLength!==undefined&&value.length<spec.minLength)||(spec.maxLength!==undefined&&value.length>spec.maxLength)||(spec.pattern&&!new RegExp(spec.pattern).test(value)))invalid(path+' must preserve its declared original string format.');
    }else if(spec.type==='boolean'&&typeof value!=='boolean')invalid(path+' must be a boolean.');
  }
  visit(args,definition.inputSchema,action);return definition;
}
