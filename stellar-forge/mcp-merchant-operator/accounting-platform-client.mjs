// MIT. Customer bookkeeping through the merchant's original MCP connection.
// Wire schema: original accounting-platforms.mjs Git blob 8d41dae6fa79514b6658464dc9542ee425844b1e (34 native tools).
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { openMerchantFileClient } from './retained-download.mjs';
import { createAccountingMaintenanceClient } from './accounting-maintenance-client.mjs';

const WIRE_RULES = [{"type":"string","pattern":"^[a-z0-9][a-z0-9_-]{0,63}$"},{"type":"string","pattern":"^[0-9]{1,64}$"},{"type":"string","enum":["sandbox","production"]},{"type":"string","pattern":"^[a-f0-9]{64}$"},{"type":"string","enum":["summary","accounts","snapshot"]},{"type":"integer","minimum":0},{"type":"integer","minimum":1,"maximum":200},{"type":"string","pattern":"^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$"},{"type":"integer","minimum":1},{"type":"string","minLength":1,"maxLength":1000},{"type":"string","minLength":1,"maxLength":80},{"anyOf":[{"type":"string","pattern":"^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$"},{"type":"null"}]},{"type":"string","enum":["summary","plans","handoffs"]},{"type":"string","enum":["summary","accounts"]},{"type":"string","maxLength":500},{"type":"string","enum":["summary","rows","lines","accounts"]},{"type":"string","enum":["summary","rows","lines","responses","files","accounts","native-attempts"]},{"type":"string","maxLength":4000},{"type":"string","minLength":1,"maxLength":4000},{"type":"boolean","enum":[true]},{"type":"string","minLength":1,"maxLength":160},{"type":"string","enum":["summary","errors","issues","rows"]},{"type":"string","enum":["summary","contexts","plans","handoffs"]},{"type":"string","enum":["summary","accounts","files"]},{"type":"string","enum":["components","accounts","reserved"]},{"type":"string","enum":["summary","entries","excluded","journals","lines","baseline","conflicts"]},{"type":"string","enum":["summary","entries","excluded","journals","lines","baseline","operations","captures","returnIntents","returns","files"]},{"type":"string","minLength":1,"maxLength":2000},{"type":"string","enum":["create-drafts","refresh"]},{"type":"string","enum":["summary","indexes","files","journalSources"]},{"type":"string","enum":["summary","journals","lines","issues","unassigned","files"]},{"type":"string","enum":["summary","conflicts","skipped","assignments","results","issues","missingRows"]}];
const WIRE_TOOLS = {"qbo":{"connection":{"fields":{"workspace":0},"required":["workspace"],"readOnly":true},"company-fetch":{"fields":{"workspace":0,"realmId":1,"environment":2,"expectedCompanySha256":3,"view":4,"offset":5,"limit":6},"required":["workspace","realmId","environment"],"readOnly":true},"post-preview":{"fields":{"workspace":0,"planId":7,"revision":8,"id":7,"actor":9,"createdAt":10,"expectedParentId":11},"required":["workspace","planId","revision","id","actor","createdAt","expectedParentId"],"readOnly":true},"post":{"fields":{"workspace":0,"planId":7,"revision":8,"id":7,"actor":9,"createdAt":10,"expectedParentId":11,"previewSha256":3},"required":["workspace","planId","revision","id","actor","createdAt","expectedParentId","previewSha256"],"readOnly":false},"post-resume":{"fields":{"workspace":0,"planId":7,"revision":8,"id":7,"actor":9,"previewSha256":3},"required":["workspace","planId","revision","id","actor","previewSha256"],"readOnly":false},"status":{"fields":{"workspace":0,"view":12,"offset":5,"limit":6},"required":["workspace"],"readOnly":true},"company-preview":{"fields":{"workspace":0,"source":0,"sourceSha256":3,"view":13,"offset":5,"limit":6},"required":["workspace","source"],"readOnly":true},"handoff":{"fields":{"workspace":0,"handoffId":7,"search":14,"offset":5,"limit":6},"required":["workspace","handoffId"],"readOnly":true},"preview":{"fields":{"workspace":0,"source":0,"sourceSha256":3,"companySource":0,"companySourceSha256":3,"view":15,"offset":5,"limit":6},"required":["workspace","source"],"readOnly":true},"create":{"fields":{"workspace":0,"source":0,"sourceSha256":3,"companySource":0,"companySourceSha256":3,"revision":8,"previewSha256":3},"required":["workspace","source","sourceSha256","revision","previewSha256"],"readOnly":false},"plan":{"fields":{"workspace":0,"planId":7,"view":16,"offset":5,"limit":6},"required":["workspace","planId"],"readOnly":true},"review":{"fields":{"workspace":0,"planId":7,"revision":8,"id":7,"actor":9,"note":17,"planSha256":3},"required":["workspace","planId","revision","id","actor","planSha256"],"readOnly":false},"cancel":{"fields":{"workspace":0,"planId":7,"revision":8,"id":7,"actor":9,"note":18,"planSha256":3,"unusedConfirmed":19},"required":["workspace","planId","revision","id","actor","note","planSha256","unusedConfirmed"],"readOnly":false},"response-preview":{"fields":{"workspace":0,"planId":7,"source":0,"sourceSha256":3,"id":7,"name":20,"actor":9,"createdAt":10,"realmId":1,"expectedParentId":11,"view":21,"offset":5,"limit":6},"required":["workspace","planId","source","id","name","actor","createdAt","realmId","expectedParentId"],"readOnly":true},"response-save":{"fields":{"workspace":0,"planId":7,"source":0,"sourceSha256":3,"id":7,"name":20,"actor":9,"createdAt":10,"realmId":1,"expectedParentId":11,"revision":8,"previewSha256":3},"required":["workspace","planId","source","sourceSha256","id","name","actor","createdAt","realmId","expectedParentId","revision","previewSha256"],"readOnly":false},"response-resume":{"fields":{"workspace":0,"planId":7,"responseId":7,"revision":8,"actor":9},"required":["workspace","planId","responseId","revision","actor"],"readOnly":false}},"xero":{"status":{"fields":{"workspace":0,"view":22,"offset":5,"limit":6},"required":["workspace"],"readOnly":true},"context":{"fields":{"workspace":0,"contextId":7,"view":23,"offset":5,"limit":6},"required":["workspace","contextId"],"readOnly":true},"context-preview":{"fields":{"workspace":0,"source":0,"sourceSha256":3,"view":13,"offset":5,"limit":6},"required":["workspace","source"],"readOnly":true},"context-import":{"fields":{"workspace":0,"source":0,"sourceSha256":3,"revision":8,"previewSha256":3},"required":["workspace","source","sourceSha256","revision","previewSha256"],"readOnly":false},"context-capture":{"fields":{"workspace":0,"revision":8,"id":7,"actor":9,"name":20,"tenant":0,"expectedTenantId":7},"required":["workspace","revision","id","actor","name","tenant","expectedTenantId"],"readOnly":false},"source":{"fields":{"workspace":0,"handoffId":7,"contextId":7,"view":24,"offset":5,"limit":6},"required":["workspace","handoffId","contextId"],"readOnly":true},"preview":{"fields":{"workspace":0,"source":0,"sourceSha256":3,"view":25,"journalIndex":5,"offset":5,"limit":6},"required":["workspace","source"],"readOnly":true},"create":{"fields":{"workspace":0,"source":0,"sourceSha256":3,"revision":8,"previewSha256":3},"required":["workspace","source","sourceSha256","revision","previewSha256"],"readOnly":false},"plan":{"fields":{"workspace":0,"planId":7,"view":26,"journalIndex":5,"offset":5,"limit":6},"required":["workspace","planId"],"readOnly":true},"cancel":{"fields":{"workspace":0,"planId":7,"revision":8,"actor":9,"reason":27,"noExternalImport":19},"required":["workspace","planId","revision","actor","reason","noExternalImport"],"readOnly":false},"operate":{"fields":{"workspace":0,"planId":7,"revision":8,"id":7,"actor":9,"tenant":0,"action":28,"planSha256":3},"required":["workspace","planId","revision","id","actor","tenant","action","planSha256"],"readOnly":false},"operation":{"fields":{"workspace":0,"planId":7,"operationId":7,"view":29,"offset":5,"limit":6},"required":["workspace","planId","operationId"],"readOnly":true},"response-preview":{"fields":{"workspace":0,"planId":7,"source":0,"sourceSha256":3,"view":30,"journalIndex":5,"offset":5,"limit":6},"required":["workspace","planId","source"],"readOnly":true},"response-import":{"fields":{"workspace":0,"planId":7,"source":0,"sourceSha256":3,"revision":8,"previewSha256":3},"required":["workspace","planId","source","sourceSha256","revision","previewSha256"],"readOnly":false},"comparison":{"fields":{"workspace":0,"planId":7,"captureId":7,"view":30,"journalIndex":5,"offset":5,"limit":6},"required":["workspace","planId","captureId"],"readOnly":true},"return-preview":{"fields":{"workspace":0,"planId":7,"captureId":7,"id":7,"actor":9,"name":20,"createdAt":10,"expectedParentId":11,"view":31,"offset":5,"limit":6},"required":["workspace","planId","captureId","id","actor","name","createdAt","expectedParentId"],"readOnly":true},"return-apply":{"fields":{"workspace":0,"planId":7,"captureId":7,"id":7,"actor":9,"name":20,"createdAt":10,"expectedParentId":11,"revision":8,"previewSha256":3,"csvSha256":3},"required":["workspace","planId","captureId","id","actor","name","createdAt","expectedParentId","revision","previewSha256","csvSha256"],"readOnly":false},"return-resume":{"fields":{"workspace":0,"planId":7,"captureId":7,"returnId":7,"previewSha256":3},"required":["workspace","planId","captureId","returnId","previewSha256"],"readOnly":false}}};

const PREFIX = 'merchant_accounting_';
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const SHA = /^[a-f0-9]{64}$/;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = (code, message) => Object.assign(new Error(message), { code: 'ACCOUNTING_PLATFORM_CLIENT_' + code });
function need(ok, message, code = 'ARGUMENTS') { if (!ok) throw fail(code, message); }
function canonical(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') { need(Number.isFinite(value), 'Use finite JSON values.'); return JSON.stringify(value); }
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  need(plain(value), 'Use JSON-compatible original values.');
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
}
const digest = value => createHash('sha256').update(canonical(value)).digest('hex');
const identifier = (value, pattern, name) => { need(typeof value === 'string' && pattern.test(value), 'Keep the exact ' + name + '.'); return value; };
const revisionOf = value => value?.revision ?? value?.state?.revision;
const trimXero = value => { need(typeof value === 'string', 'Use the original Xero text value.'); return value.trim(); };
const nativeTool = (platform, action) => PREFIX + platform + '_' + action.replaceAll('-', '_');
const PREVIEWS = {
  qbo: { create: 'preview', 'response-save': 'response-preview', post: 'post-preview' },
  xero: { 'context-import': 'context-preview', create: 'preview', 'response-import': 'response-preview', 'return-apply': 'return-preview' },
};
const INLINE = { qbo: ['review', 'cancel', 'response-resume', 'post-resume'], xero: ['context-capture', 'cancel', 'operate', 'return-resume'] };
const BINDINGS = {
  qbo: { create: ['planId', 'actor', 'createdAt', 'previewSha256'], review: ['planId', 'reviewId', 'requestSha256'],
    cancel: ['planId', 'cancellationId', 'requestSha256'], 'response-save': ['planId', 'responseId', 'responseSha256', 'previewSha256'],
    'response-resume': ['planId', 'responseId', 'responseSha256', 'previewSha256'],
    post: ['planId', 'postId', 'planSha256', 'requestSha256', 'previewSha256'],
    'post-resume': ['planId', 'postId', 'planSha256', 'requestSha256', 'previewSha256'] },
  xero: { 'context-import': ['contextId', 'requestSha256'], 'context-capture': ['contextId', 'tenantId', 'name', 'actor'],
    create: ['planId', 'requestSha256', 'planSha256'], cancel: ['planId', 'planSha256', 'reason'],
    operate: ['planId', 'operationId', 'requestSha256', 'tenantId'],
    'response-import': ['planId', 'captureId', 'actor', 'requestSha256'],
    'return-apply': ['planId', 'captureId', 'returnId', 'previewSha256', 'csvSha256'],
    'return-resume': ['planId', 'captureId', 'returnId', 'previewSha256'] },
};
function matches(value, rule) {
  if (rule.anyOf) return rule.anyOf.some(child => matches(value, child));
  if (rule.enum && !rule.enum.includes(value)) return false;
  if (rule.type === 'null') return value === null;
  if (rule.type === 'integer') return Number.isSafeInteger(value) && (rule.minimum === undefined || value >= rule.minimum) && (rule.maximum === undefined || value <= rule.maximum);
  if (typeof value !== rule.type) return false;
  if (rule.type === 'string') return (rule.minLength === undefined || value.length >= rule.minLength) &&
    (rule.maxLength === undefined || value.length <= rule.maxLength) && (!rule.pattern || new RegExp(rule.pattern).test(value));
  return true;
}
function selectedPlatform(platform) { need(Object.hasOwn(WIRE_TOOLS, platform), 'Choose qbo or xero.'); return platform; }
function wireArguments(platform, action, value) {
  selectedPlatform(platform);
  const schema = WIRE_TOOLS[platform][action];
  need(schema && plain(value) && Object.keys(value).every(key => Object.hasOwn(schema.fields, key)),
    'Use an original declared platform action and only its documented fields.');
  for (const field of schema.required) need(Object.hasOwn(value, field), 'Keep the required original ' + field + '.');
  for (const [field, item] of Object.entries(value)) need(matches(item, WIRE_RULES[schema.fields[field]]), 'Check the declared original ' + field + '.');
  if (value.companySource !== undefined) need(value.companySourceSha256 !== undefined || schema.readOnly, 'Keep the reviewed company source digest.');
  if (value.companySourceSha256 !== undefined) need(value.companySource !== undefined, 'A company digest needs its original source alias.');
  return structuredClone(value);
}
function operationHash(platform, action, args) {
  if (platform === 'qbo' && action === 'review') return digest({ id: args.id, actor: args.actor, note: args.note ?? '', planSha256: args.planSha256 });
  if (platform === 'qbo' && action === 'cancel') return digest({ id: args.id, actor: args.actor, note: args.note, planSha256: args.planSha256, unusedConfirmed: true });
  if (platform === 'qbo' && action === 'response-save') return digest({ id: args.id, createdAt: args.createdAt, name: args.name,
    actor: args.actor, realmId: args.realmId, expectedParentId: args.expectedParentId, responseSha256: args.sourceSha256, previewSha256: args.previewSha256 });
  if (platform === 'xero' && action === 'operate') return digest({ actor: trimXero(args.actor), action: args.action, planSha256: args.planSha256 });
}

/** Validate the original small command/binding; no native request or ID is generated. */
export function accountingPlatformOperation(value) {
  need(plain(value?.command) && typeof value.command.tool === 'string' && plain(value.binding), 'Retain the complete original command and binding.', 'PREVIEW');
  const match = value.command.tool.match(/^merchant_accounting_(qbo|xero)_([a-z_]+)$/);
  need(match, 'Use an original QuickBooks or Xero command.', 'PREVIEW');
  const platform = match[1], action = match[2].replaceAll('_', '-'), fields = BINDINGS[platform][action];
  need(fields && !WIRE_TOOLS[platform][action].readOnly, 'Choose a reviewed native mutation.', 'PREVIEW');
  const args = wireArguments(platform, action, value.command.arguments), binding = structuredClone(value.binding);
  need(Object.keys(binding).length === fields.length && fields.every(field => Object.hasOwn(binding, field)),
    'Keep every original operation binding without additional fields.', 'PREVIEW');
  for (const [field, item] of Object.entries(binding)) {
    if (field.endsWith('Id')) identifier(item, UUID, field + ' UUID');
    else if (field.endsWith('Sha256')) identifier(item, SHA, field + ' digest');
    else need(typeof item === 'string', 'Keep original binding text.', 'PREVIEW');
  }
  const equal = (a, b) => need(a === b, 'The command differs from its reviewed original identity or source digest.', 'BINDING');
  if (args.planId !== undefined) equal(binding.planId, args.planId);
  if (args.captureId !== undefined) equal(binding.captureId, args.captureId);
  if (binding.previewSha256 !== undefined && args.previewSha256 !== undefined) equal(binding.previewSha256, args.previewSha256);
  if (action === 'create' && platform === 'xero') equal(binding.planSha256, args.previewSha256);
  if (action === 'context-import') equal(binding.requestSha256, args.previewSha256);
  if (action === 'context-capture') { equal(binding.tenantId, args.expectedTenantId); equal(binding.contextId, args.id); equal(binding.actor, trimXero(args.actor)); equal(binding.name, trimXero(args.name)); }
  if (action === 'review') { equal(binding.reviewId, args.id); equal(binding.requestSha256, operationHash(platform, action, args)); }
  if (action === 'cancel' && platform === 'qbo') { equal(binding.cancellationId, args.id); equal(binding.requestSha256, operationHash(platform, action, args)); }
  if (action === 'cancel' && platform === 'xero') equal(binding.reason, trimXero(args.reason));
  if (action === 'operate') { equal(binding.operationId, args.id); equal(binding.requestSha256, operationHash(platform, action, args)); }
  if (action === 'response-save') { equal(binding.responseId, args.id); equal(binding.responseSha256, args.sourceSha256); }
  if (action === 'response-resume') equal(binding.responseId, args.responseId);
  if (action === 'post' || action === 'post-resume') equal(binding.postId, args.id);
  if (action === 'return-apply') { equal(binding.returnId, args.id); equal(binding.csvSha256, args.csvSha256); }
  if (action === 'return-resume') equal(binding.returnId, args.returnId);
  return { platform, action, command: { tool: nativeTool(platform, action), arguments: args }, binding };
}
export function accountingPlatformActions(platform) {
  selectedPlatform(platform);
  return Object.entries(WIRE_TOOLS[platform]).map(([action, value]) => ({ action, readOnly: value.readOnly,
    required: value.required.filter(field => field !== 'workspace'), fields: Object.keys(value.fields).filter(field => field !== 'workspace'),
    previewAction: Object.entries(PREVIEWS[platform]).find(([, read]) => read === action)?.[0] ?? null }));
}

/** Use an initialized original MCP caller. Accounting and provider execution stay native. */
export function createAccountingPlatformClient({ workspace, platform, call } = {}) {
  selectedPlatform(platform); identifier(workspace, /^[a-z0-9][a-z0-9_-]{0,63}$/, 'configured workspace alias');
  need(typeof call === 'function', 'Supply the existing structured-result MCP call function.');
  const maintenance = createAccountingMaintenanceClient({ workspace, call }), pending = new Set(), ownedOperations = new Map();
  let transitioning = false, closed = false, closePromise;
  function accepting() { need(!closed && !transitioning, 'Finish the active drain before another call; this caller may already be closed.', 'CLOSED'); }
  async function tracked(action) {
    accepting(); const result = Promise.resolve().then(action); pending.add(result);
    try { return await result; } finally { pending.delete(result); }
  }
  async function transition(operation, permanent = false) {
    accepting(); transitioning = true;
    try { await Promise.allSettled([...pending]); return await operation(); }
    finally { transitioning = false; if (permanent) closed = true; }
  }
  function invoke(name, args = {}, options) {
    need(typeof name === 'string' && name.startsWith(PREFIX) && plain(args) &&
      (args.workspace === undefined || args.workspace === workspace), 'Use this original workspace alias.');
    return tracked(async () => {
      const value = await call(name, { ...structuredClone(args), workspace }, options);
      need(plain(value), 'The original merchant returned no structured result.', 'REPLY');
      if (name === PREFIX + 'file' && UUID.test(value.readId ?? '') && value.nextOffset !== null) maintenance.registerFileRead(value.readId);
      if (name === nativeTool('xero', 'operate') && UUID.test(value.operation?.id ?? ''))
        ownedOperations.set(args.planId + ':' + value.operation.id, { planId: args.planId, operationId: value.operation.id });
      if ([nativeTool('qbo', 'post'), nativeTool('qbo', 'post-resume')].includes(name)) {
        const nativePost = value.nativePost ?? value.record?.nativePost;
        if (UUID.test(nativePost?.id ?? '')) ownedOperations.set(args.planId + ':' + nativePost.id,
          { planId: args.planId, operationId: nativePost.id });
      }
      return value;
    });
  }
  function chosen(value) {
    const operation = accountingPlatformOperation(value);
    need(operation.platform === platform && operation.command.arguments.workspace === workspace,
      'Use the prepared platform and original workspace alias.', 'CONNECTION_BINDING');
    return operation;
  }
  function read(action, args = {}, options) {
    need(plain(args) && (args.workspace === undefined || args.workspace === workspace), 'Keep this selected original workspace alias.');
    need(WIRE_TOOLS[platform][action]?.readOnly, 'Choose a declared read; mutations use an explicitly prepared command.');
    return invoke(nativeTool(platform, action), wireArguments(platform, action, { ...args, workspace }), options);
  }
  async function findPage(action, args, view, predicate, options) {
    let offset = 0, expectedTotal, expectedRevision;
    for (;;) {
      const result = await read(action, { ...args, view, offset, limit: 200 }, options), page = result.page;
      need(plain(page) && page.view === view && page.offset === offset && Array.isArray(page.items) &&
        Number.isSafeInteger(page.total) && page.total >= 0 && page.items.length <= 200,
        'The original retained inventory page is inconsistent.', 'REPLY');
      const currentRevision = revisionOf(result);
      expectedTotal ??= page.total; expectedRevision ??= currentRevision;
      need(page.total === expectedTotal && currentRevision === expectedRevision,
        'The native workspace changed between pages. Reopen this same retained inventory.', 'OBSERVATION_CHANGED');
      const matches = page.items.filter(predicate);
      need(matches.length <= 1, 'The original inventory repeats the selected identity.', 'REPLY');
      if (matches.length) return { result, item: matches[0] };
      offset += page.items.length;
      if (offset === page.total) return { result, item: null };
      need(page.items.length > 0 && offset < page.total, 'The original inventory did not advance through its retained count.', 'REPLY');
    }
  }
  async function selectedTenant(alias, options) {
    const result = await client.sources(options);
    const source = result.workspaces?.find(value => value.workspace === workspace);
    const tenant = source?.platforms?.xero?.tenants?.find(value => value.alias === alias);
    need(tenant && UUID.test(tenant.tenantId), 'Choose the original host-declared Xero tenant alias.', 'TENANT');
    return tenant.tenantId;
  }
  async function inlinePreview(action, value, options) {
    need(INLINE[platform].includes(action), 'Use an action with a native preview or the documented original-record review.');
    need(plain(value) && (value.workspace === undefined || value.workspace === workspace), 'Keep this selected original workspace alias.');
    const args = wireArguments(platform, action, { ...value, workspace });
    let binding, observed;
    if (platform === 'qbo') {
      observed = await read('plan', { planId: args.planId }, options);
      need(observed.record?.id === args.planId, 'The original journal identity differs.', 'REPLY');
      if (action === 'review' || action === 'cancel') {
        need(observed.record.integrity?.sha256 === args.planSha256, 'Keep the exact retained QuickBooks journal digest.', 'BINDING');
        binding = { planId: args.planId, [action === 'review' ? 'reviewId' : 'cancellationId']: args.id,
          requestSha256: operationHash(platform, action, args) };
      } else if (action === 'post-resume') {
        const nativePost = observed.record.nativePost;
        need(nativePost?.id === args.id && nativePost.previewSha256 === args.previewSha256,
          'Choose the exact retained native QuickBooks posting and review digest.', 'BINDING');
        binding = { planId: args.planId, postId: nativePost.id, planSha256: nativePost.planSha256,
          requestSha256: nativePost.requestSha256, previewSha256: nativePost.previewSha256 };
      } else {
        const selected = await findPage('plan', { planId: args.planId }, 'responses', row => row.id === args.responseId, options);
        need(selected.item, 'Choose the retained original response ID.', 'RESPONSE_NOT_FOUND');
        observed = selected.result;
        binding = { planId: args.planId, responseId: args.responseId, responseSha256: selected.item.responseSha256,
          previewSha256: selected.item.resultSha256 };
      }
    } else if (action === 'context-capture') {
      const tenantId = await selectedTenant(args.tenant, options);
      need(tenantId === args.expectedTenantId, 'The host alias differs from the reviewed original Xero tenant.', 'TENANT');
      binding = { contextId: args.id, tenantId, name: trimXero(args.name), actor: trimXero(args.actor) };
      observed = { tenant: args.tenant, tenantId, action: 'Read the original organization and accounts, then retain this context UUID.' };
    } else {
      observed = await read('plan', { planId: args.planId }, options);
      need(observed.record?.id === args.planId && SHA.test(observed.record.planSha256 ?? ''), 'The original Xero plan identity differs.', 'REPLY');
      if (action === 'cancel') binding = { planId: args.planId, planSha256: observed.record.planSha256, reason: trimXero(args.reason) };
      if (action === 'operate') {
        const tenantId = await selectedTenant(args.tenant, options);
        need(observed.record.planSha256 === args.planSha256 && observed.plan.context?.tenantId === tenantId,
          'Keep the exact retained Xero plan and its original tenant alias.', 'BINDING');
        binding = { planId: args.planId, operationId: args.id, requestSha256: operationHash(platform, action, args), tenantId };
      }
      if (action === 'return-resume') {
        const selected = await findPage('plan', { planId: args.planId }, 'returnIntents', row => row.id === args.returnId, options);
        need(selected.item && selected.item.captureId === args.captureId && selected.item.previewSha256 === args.previewSha256,
          'Choose the exact retained accountant return intent.', 'BINDING');
        observed = selected.result;
        binding = { planId: args.planId, captureId: args.captureId, returnId: args.returnId, previewSha256: args.previewSha256 };
      }
    }
    const operation = accountingPlatformOperation({ command: { tool: nativeTool(platform, action), arguments: args }, binding });
    return { ...operation, reviewOrigin: 'CLIENT_REVIEW_OF_ORIGINAL_NATIVE_RECORD', observed };
  }
  async function observe(operation, options) {
    const { action, binding: b, command: { arguments: args } } = operation;
    const missing = () => ({ found: false, platform, action, binding: b, pending: false });
    const found = value => ({ found: true, platform, action, binding: b, pending: false, ...value });
    const same = (condition, message) => need(condition, message, 'NATIVE_BINDING');
    if (platform === 'qbo') {
      let result;
      try { result = await read('plan', { planId: b.planId }, options); }
      catch (error) { if (action === 'create' && error.code === 'QBO_PLAN_NOT_FOUND') return missing(); throw error; }
      same(result.record?.id === b.planId, 'The original QuickBooks plan ID differs.');
      const record = result.record;
      if (action === 'post' || action === 'post-resume') {
        const nativePost = record.nativePost;
        if (!nativePost) return missing();
        same(nativePost.id === b.postId && nativePost.requestId === b.postId && nativePost.planId === b.planId &&
          nativePost.planSha256 === b.planSha256 && nativePost.requestSha256 === b.requestSha256 && nativePost.previewSha256 === b.previewSha256,
          'The journal retains a different original native posting request.');
        if (action === 'post') same(nativePost.actor === args.actor && nativePost.createdAt === args.createdAt,
          'The original native posting has a different reviewed operator or timestamp.');
        same(['PREPARED', 'RUNNING', 'UNCERTAIN', 'RETRYABLE', 'RECEIVED', 'BOOKED', 'FAULT', 'CONFLICT'].includes(nativePost.status),
          'The native posting returned an unknown status.');
        return found({ ...result, nativePost, pending: !['BOOKED', 'FAULT', 'CONFLICT'].includes(nativePost.status),
          executionRequired: action === 'post-resume' && nativePost.status !== 'BOOKED',
          providerContinuation: nativePost.status === 'BOOKED' ? null : 'EXPLICIT_NATIVE_POST_RESUME' });
      }
      if (action === 'create') {
        same(record.integrity?.sha256 === b.previewSha256 && record.actor === b.actor && record.createdAt === b.createdAt,
          'The journal UUID belongs to another reviewed plan.'); return found(result);
      }
      if (action === 'review' || action === 'cancel') {
        const entry = action === 'review' ? record.review : record.cancellation;
        if (!entry) return missing();
        const selectedId = action === 'review' ? b.reviewId : b.cancellationId;
        same(entry.id === selectedId && entry.requestSha256 === b.requestSha256, 'The journal retains a different review or cancellation request.');
        return found({ ...result, retainedDecision: entry });
      }
      const selected = await findPage('plan', { planId: b.planId }, 'responses', row => row.id === b.responseId, options);
      if (!selected.item) return missing();
      const response = selected.item;
      same(response.responseSha256 === b.responseSha256 && response.resultSha256 === b.previewSha256 &&
        (action !== 'response-save' || response.requestSha256 === operationHash(platform, action, args)),
        'The retained response UUID belongs to another source or reviewed result.');
      const resultValue = found({ ...selected.result, response, pending: response.status === 'PENDING' });
      if (resultValue.pending) resultValue.continuation = { tool: nativeTool(platform, 'response-resume'),
        arguments: { workspace, planId: b.planId, responseId: b.responseId, revision: selected.result.revision, actor: args.actor } };
      return resultValue;
    }
    if (action === 'context-import' || action === 'context-capture') {
      let result;
      try { result = await read('context', { contextId: b.contextId }, options); }
      catch (error) { if (error.code === 'XERO_CONTEXT_NOT_FOUND') return missing(); throw error; }
      same(result.record?.id === b.contextId, 'The retained original context ID differs.');
      same(action === 'context-import' ? result.record.requestSha256 === b.requestSha256 :
        result.record.tenantId === b.tenantId && result.record.actor === b.actor && result.record.name === b.name,
      'The context UUID belongs to another original organization import.');
      return found(result);
    }
    if (action === 'operate') {
      let result;
      try { result = await read('operation', { planId: b.planId, operationId: b.operationId }, options); }
      catch (error) { if (error.code === 'XERO_OPERATION_NOT_FOUND') return missing(); throw error; }
      same(result.operation?.id === b.operationId && result.operation.requestSha256 === b.requestSha256,
        'The retained operation UUID belongs to another original action or plan.');
      same(['RUNNING', 'COMPLETE', 'FAILED', 'INTERRUPTED'].includes(result.operation.status), 'The native operation returned an unknown status.');
      return found({ ...result, pending: result.operation.status === 'RUNNING' });
    }
    if (action === 'response-import') {
      let result;
      try { result = await read('comparison', { planId: b.planId, captureId: b.captureId }, options); }
      catch (error) { if (error.code === 'XERO_CAPTURE_NOT_FOUND') return missing(); throw error; }
      same(result.comparison?.id === b.captureId && result.comparison.actor === b.actor &&
        result.comparison.source?.requestSha256 === b.requestSha256, 'The retained capture UUID belongs to another response-file set.');
      return found(result);
    }
    let result;
    try { result = await read('plan', { planId: b.planId }, options); }
    catch (error) { if (action === 'create' && error.code === 'XERO_PLAN_NOT_FOUND') return missing(); throw error; }
    same(result.record?.id === b.planId, 'The original Xero plan ID differs.');
    if (action === 'create') {
      same(result.record.planSha256 === b.planSha256 && result.record.requestSha256 === b.requestSha256,
        'The plan UUID belongs to another native source or reviewed request.'); return found(result);
    }
    if (action === 'cancel') {
      same(result.record.planSha256 === b.planSha256, 'The selected original plan changed.');
      if (!result.record.cancelledAt) return missing();
      same(result.record.cancellationReason === b.reason, 'This plan has a different retained cancellation reason.');
      return found({ ...result, cancellationIdentityBasis: 'Original plan UUID and retained reason; native record does not expose the cancelling actor.' });
    }
    const selected = await findPage('plan', { planId: b.planId }, 'returnIntents', row => row.id === b.returnId, options);
    if (!selected.item) return missing();
    const intent = selected.item;
    same(intent.captureId === b.captureId && intent.previewSha256 === b.previewSha256, 'The original return intent has different source or review identity.');
    const saved = await findPage('plan', { planId: b.planId }, 'returns', row => row.returnId === b.returnId, options);
    if (saved.item) {
      same(saved.item.captureId === b.captureId && saved.item.sourceReturnSha256 === b.previewSha256,
        'The original accountant return link differs from the reviewed return.');
      return found({ ...saved.result, intent, link: saved.item });
    }
    const resultValue = found({ ...selected.result, intent, pending: true });
    resultValue.continuation = { tool: nativeTool(platform, 'return-resume'),
      arguments: { workspace, planId: b.planId, captureId: b.captureId, returnId: b.returnId, previewSha256: b.previewSha256 } };
    return resultValue;
  }
  const client = {
    workspace, platform,
    sources: options => invoke(PREFIX + 'sources', {}, options),
    open: options => invoke(PREFIX + 'open', {}, options),
    read,
    status: (args = {}, options) => read('status', args, options),
    plan: (args, options) => read('plan', args, options),
    handoff: (args, options) => read('handoff', args, options),
    companyPreview: (args, options) => read('company-preview', args, options),
    connection: options => read('connection', {}, options),
    companyFetch: (args, options) => read('company-fetch', args, options),
    context: (args, options) => read('context', args, options),
    source: (args, options) => read('source', args, options),
    comparison: (args, options) => read('comparison', args, options),
    operation: (args, options) => read('operation', args, options),
    async preview(action, args = {}, options) {
      const previewAction = PREVIEWS[platform][action];
      const result = previewAction ? await read(previewAction, args, options) : await inlinePreview(action, args, options);
      const operation = chosen(result);
      need(operation.action === action, 'The preview returned a different native command.', 'PREVIEW');
      return { ...result, platform, action };
    },
    command(value, options) { const operation = chosen(value); return invoke(operation.command.tool, operation.command.arguments, options); },
    /** Reads original IDs; recover:true may finish the same pending accountant return, never a provider request. */
    async reconcile(value, { recover = false, onRecovery, ...options } = {}) {
      need(typeof recover === 'boolean' && (onRecovery === undefined || typeof onRecovery === 'function'), 'Use an explicit original-return recovery option.');
      const operation = chosen(value), result = await observe(operation, options);
      if (!recover || !result.continuation) return result;
      await onRecovery?.(structuredClone(result.continuation));
      await invoke(result.continuation.tool, result.continuation.arguments, options);
      return { ...(await observe(operation, options)), recoveryAttempted: true };
    },
    async waitForOperation(value, { maxWaitMs = 30000, pollMs = 1000, signal } = {}) {
      const operation = chosen(value);
      need(platform === 'xero' && operation.action === 'operate' && Number.isSafeInteger(maxWaitMs) && maxWaitMs >= 0 && maxWaitMs <= 300000 &&
        Number.isSafeInteger(pollMs) && pollMs >= 250 && pollMs <= 30000, 'Wait on an existing Xero operation for up to five minutes.');
      const deadline = Date.now() + maxWaitMs;
      for (;;) {
        signal?.throwIfAborted(); const result = await client.reconcile(operation, { requestSignal: signal });
        if (!result.found || !result.pending || Date.now() >= deadline) return result;
        await delay(Math.min(pollMs, Math.max(0, deadline - Date.now())), undefined, { signal });
      }
    },
    retainedOperations: () => [...ownedOperations.values()],
    registerFileRead(readId) { accepting(); return maintenance.registerFileRead(readId); },
    releaseFile: (readId, options) => maintenance.releaseFile(readId, options),
    drainFileReads: () => transition(() => maintenance.drainFileReads()),
    async *fileChunks(selection, options) {
      accepting(); need(plain(selection) && (selection.kind === undefined || selection.kind === platform), 'Choose a file from this original platform.');
      const iterator = maintenance.fileChunks({ ...selection, kind: platform }, options);
      try { for (;;) { accepting(); const item = await iterator.next(); if (item.done) return; yield item.value; } }
      finally { await iterator.return?.(); }
    },
    maintenanceStatus: (args, options) => tracked(() => maintenance.status(args, options)),
    maintenanceJob: (jobId, options) => tracked(() => maintenance.job(jobId, options)),
    maintenanceCommand(kind, args, options) {
      accepting(); return kind === 'pause' ? transition(() => maintenance.command(kind, args, options)) : tracked(() => maintenance.command(kind, args, options));
    },
    disconnect() {
      if (!closePromise) {
        accepting(); closePromise = transition(async () => ({ ...(await maintenance.drainFileReads()),
          retainedOperations: [...ownedOperations.values()], workspaceClosed: false }), true);
      }
      return closePromise;
    },
    close(options) {
      if (!closePromise) { accepting(); closePromise = transition(() => maintenance.closeWorkspace(options), true); }
      return closePromise;
    },
  };
  return Object.freeze(client);
}
export async function connectAccountingPlatformClient({ workspace, platform, ...options } = {}) {
  selectedPlatform(platform);
  const connection = await openMerchantFileClient({ ...options, errorPrefix: 'ACCOUNTING_PLATFORM', clientName: 'starforge-accounting-platforms' });
  return Object.freeze({ ...createAccountingPlatformClient({ workspace, platform, call: connection.call }), endpoint: connection.endpoint });
}
