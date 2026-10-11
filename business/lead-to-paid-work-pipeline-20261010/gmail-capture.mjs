#!/usr/bin/env node
// Native connected-Gmail captures -> resumable private mailbox -> existing reply triage.
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SCHEMA = 'commons.gmail-conversion.v1';
const text = value => typeof value === 'string' ? value.trim() : '';
const array = value => Array.isArray(value) ? value : value == null ? [] : [value];
const unique = values => [...new Set(values)];
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const must = (condition, message) => { if (!condition) throw Error(message); };
const stamp = (value, label) => {
  must(typeof value === 'string' && /(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value)), label + ': offset timestamp required');
  return new Date(value).toISOString();
};
const emailPattern = /[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const addresses = value => unique(array(value).flatMap(v => (String(v).match(emailPattern) || []).map(v => v.toLowerCase())));
const key = message => message.accountId + ':' + message.id;
const entity = value => value.replace(/&(?:amp|lt|gt|quot|apos|nbsp|#\d+|#x[0-9a-f]+);/gi, item => {
  const names = {'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'",'&nbsp;':' '};
  if (names[item.toLowerCase()]) return names[item.toLowerCase()];
  const n = item.toLowerCase().startsWith('&#x') ? parseInt(item.slice(3, -1), 16) : parseInt(item.slice(2, -1), 10);
  return Number.isInteger(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : item;
});

function bodyText(payload) {
  const plain = [], html = [];
  let bytes = 0, truncated = false;
  function walk(part, depth = 0) {
    if (!part || depth > 20 || part.filename || part.content_disposition === 'attachment') return;
    const mime = text(part.mime_type || part.mimeType).toLowerCase();
    if (mime === 'text/plain' || mime === 'text/html' || mime === 'message/delivery-status') {
      let value = part.body?.content;
      if (typeof value !== 'string') {
        const data = part.body?.base64_url_content ?? part.body?.data;
        if (typeof data === 'string') value = Buffer.from(data, 'base64url').toString('utf8');
      }
      if (typeof value === 'string') {
        const remaining = 1_048_576 - bytes;
        if (value.length > remaining) { value = value.slice(0, Math.max(0, remaining)); truncated = true; }
        bytes += value.length;
        (mime === 'text/html' ? html : plain).push(value);
      }
    }
    for (const child of part.parts || []) walk(child, depth + 1);
  }
  walk(payload);
  return {body: plain.length ? plain.join('\n') : entity(html.join('\n')
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<(?:br\b[^>]*|\/(?:div|p|li|tr|h[1-6]))\s*>/gi, '\n').replace(/<[^>]*>/g, ' ')), truncated};
}

function unwrap(result) {
  must(result && typeof result === 'object', 'Capture result must be a tool response object');
  must(!result.isError, 'Provider returned an error');
  if (result.structuredContent) return unwrap(result.structuredContent);
  if (result.error || result.error_code) throw Error('Provider error: ' + String(result.error_code || result.error).slice(0, 160));
  if (Array.isArray(result.content)) {
    for (const block of result.content) if (block.type === 'text') {
      try { const parsed = JSON.parse(block.text); if (parsed && typeof parsed === 'object') return unwrap(parsed); } catch {}
    }
    throw Error('Tool response has no structured Gmail data');
  }
  return result;
}

function extractRows(result) {
  const found = [], seen = new Set();
  function walk(value, depth = 0) {
    if (!value || typeof value !== 'object' || depth > 12 || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) { value.forEach(item => walk(item, depth + 1)); return; }
    if (value.id && (value.payload || value.from_ || value.from || value.thread_id || value.threadId) && !Array.isArray(value.messages)) {
      found.push(value); return;
    }
    for (const field of ['emails','messages','threads','responses','response','data','result','structuredContent'])
      if (value[field]) walk(value[field], depth + 1);
  }
  walk(result);
  return found;
}

function normalizeMessage(raw, account, capture) {
  const headers = new Map();
  for (const header of raw.payload?.headers || []) {
    const name = text(header.name).toLowerCase();
    if (!headers.has(name)) headers.set(name, []);
    headers.get(name).push(String(header.value || ''));
  }
  const header = name => (headers.get(name) || []).join(', ');
  const from = addresses(header('from') || raw.from_ || raw.from);
  const to = addresses(header('to') || raw.to || header('delivered-to'));
  must(text(raw.id), 'Provider message ID missing');
  must(from.length === 1 && to.length, 'Full message sender or recipients required');
  const internal = raw.internal_date ?? raw.internalDate;
  const time = internal != null ? new Date(Number(internal)).toISOString() : stamp(raw.email_ts || raw.sentAt, 'Provider message time');
  const labels = raw.label_ids || raw.labelIds || raw.labels;
  must(Array.isArray(labels), 'Provider labels required');
  const body = raw.payload ? bodyText(raw.payload) : {body: text(raw.body), truncated: false};
  const metadataOnly = capture.request?.format === 'metadata' || capture.request?.format === 'minimal' ||
    (raw.payload && !raw.payload.body && !raw.payload.parts);
  const rfcId = header('message-id');
  const references = unique((header('references') + ' ' + header('in-reply-to')).match(/<[^<>\s]+>/g) || []);
  return {
    accountId: account.id, accountEmail: account.email, id: raw.id,
    thread_id: raw.thread_id || raw.threadId || null,
    from: from[0], to, cc: addresses(header('cc') || raw.cc),
    subject: header('subject') || text(raw.subject), labels: unique(labels), email_ts: time,
    snippet: entity(text(raw.snippet)), body: body.body, bodyTruncated: body.truncated,
    autoSubmitted: header('auto-submitted') || text(raw.autoSubmitted),
    precedence: header('precedence'), contentType: header('content-type') || text(raw.payload?.mime_type),
    rfcMessageId: rfcId, references,
    display_url: 'https://mail.google.com/mail/u/?authuser=' + encodeURIComponent(account.email) + '#all/' + encodeURIComponent(raw.id),
    detail: raw.payload ? (metadataOnly ? 'METADATA_HEADERS' : 'FULL_HEADERS') : 'SEARCH_SUMMARY',
    captureIds: [capture.id], firstCapturedAt: capture.capturedAt, lastCapturedAt: capture.capturedAt,
    headersCapturedAt: raw.payload ? capture.capturedAt : null
  };
}

function mergeMessage(before, after) {
  if (!before) return after;
  if(before.thread_id && after.thread_id && before.thread_id !== after.thread_id) {
    const error=Error('Provider message changed thread identity');
    Object.assign(error,{code:'MESSAGE_IDENTITY_CONFLICT',previousThreadId:before.thread_id,incomingThreadId:after.thread_id});
    throw error;
  }
  const newer = Date.parse(after.lastCapturedAt) >= Date.parse(before.lastCapturedAt);
  const rank = message => ({SEARCH_SUMMARY:0,METADATA_HEADERS:1,FULL_HEADERS:2}[message.detail] ?? 0);
  const fuller = rank(after) > rank(before) || (rank(after) === rank(before) && newer);
  const result = {...before};
  if (newer) Object.assign(result, {labels: after.labels, lastCapturedAt: after.lastCapturedAt});
  if (fuller) {
    const labels = result.labels, lastCapturedAt = result.lastCapturedAt;
    Object.assign(result, after, {labels, lastCapturedAt});
  }
  result.firstCapturedAt = [before.firstCapturedAt, after.firstCapturedAt].sort()[0];
  result.captureIds = unique([...before.captureIds, ...after.captureIds]);
  return result;
}

function bindMessages(messages, cases, reviews, issues) {
  const assignments = new Map(), anchors = new Map();
  const register = (m, caseId, via) => {
    const k = key(m);
    if (!assignments.has(k)) assignments.set(k, new Map());
    assignments.get(k).set(caseId, via);
    if (m.rfcMessageId) {
      const anchor = m.accountId + ':' + m.rfcMessageId;
      if (!anchors.has(anchor)) anchors.set(anchor, new Set());
      anchors.get(anchor).add(caseId);
    }
  };
  for (const m of messages) for (const c of cases) for (const binding of c.bindings || []) {
    if (binding.accountId !== m.accountId) continue;
    if ((binding.messageIds || []).includes(m.id)) register(m, c.id, 'EXPLICIT_MESSAGE_ID');
    if (m.thread_id && (binding.threadIds || []).includes(m.thread_id)) register(m, c.id, 'EXPLICIT_THREAD_ID');
  }
  // Automatic tickets often use a separate Gmail thread. Exact RFC references join them.
  for (let round = 0; round < messages.length; round++) {
    let changed = false;
    for (const m of messages) {
      const referenced = unique(m.references.flatMap(ref => [...(anchors.get(m.accountId + ':' + ref) || [])]));
      for (const caseId of referenced) if (!assignments.get(key(m))?.has(caseId)) { register(m, caseId, 'RFC_MESSAGE_REFERENCE'); changed = true; }
    }
    if (!changed) break;
  }
  const reviewByKey = new Map();
  for (const review of reviews || []) {
    must(['INTEREST','DECLINE','NEUTRAL'].includes(review.disposition), 'Explicit human review disposition required');
    must(text(review.accountId) && text(review.messageId) && text(review.reviewer), 'Human review account, provider message and reviewer required');
    const reviewKey = review.accountId + ':' + review.messageId;
    must(!reviewByKey.has(reviewKey), 'Duplicate human review for provider message');
    reviewByKey.set(reviewKey, review);
  }
  const bound = [], unbound = [];
  for (const m of messages) {
    const matches = assignments.get(key(m));
    if (!matches?.size) { unbound.push({accountId:m.accountId,messageId:m.id,threadId:m.thread_id,reason:'CASE_BINDING_NEEDED'}); continue; }
    if (matches.size > 1) { issues.push({code:'AMBIGUOUS_CASE_BINDING',accountId:m.accountId,messageId:m.id,caseIds:[...matches.keys()]}); continue; }
    const [caseId, bindingMethod] = [...matches][0];
    const review = reviewByKey.get(key(m));
    bound.push({...m, caseId, bindingMethod, ...(review ? {humanDisposition:review.disposition, humanReview:review} : {})});
  }
  for (const [reviewKey, review] of reviewByKey) if (!messages.some(m => key(m) === reviewKey)) issues.push({code:'REVIEW_MESSAGE_NOT_CAPTURED',accountId:review.accountId,messageId:review.messageId});
  return {bound, unbound};
}

/** Accept original search, single-message, thread and batch tool results without rewriting rows. */
export function importGmailCaptures(input, {previous, now = new Date()} = {}) {
  must(input && Array.isArray(input.accounts) && Array.isArray(input.cases) && Array.isArray(input.captures), 'accounts[], cases[], captures[] required');
  if (previous) must(previous.schema === SCHEMA, 'Previous state schema mismatch');
  const accounts = new Map();
  for (const account of [...(previous?.accounts || []), ...input.accounts]) {
    must(text(account.id) && addresses(account.email).length === 1 && addresses(account.email)[0] === account.email.toLowerCase(), 'Account id and exact mailbox email required');
    if (accounts.has(account.id)) must(accounts.get(account.id).email === account.email.toLowerCase(), 'Account ID cannot change mailbox identity');
    accounts.set(account.id, {...account,email:account.email.toLowerCase()});
  }
  must(new Set(input.cases.map(c => c.id)).size === input.cases.length, 'Duplicate case ID');
  const messages = new Map((previous?.messages || []).map(m => [key(m), m]));
  const imports = new Map((previous?.imports || []).map(c => [c.id, c]));
  const issues = [...(previous?.captureIssues || [])], continuations = [];
  for (const supplied of input.captures) {
    const account = accounts.get(supplied.accountId);
    must(account, 'Unknown capture account');
    const capture = {...supplied,capturedAt:stamp(supplied.capturedAt,'capturedAt')};
    must(Date.parse(capture.capturedAt) <= now.getTime(), 'Capture timestamp is in the future');
    const digest = hash({accountId:capture.accountId,operation:capture.operation,request:capture.request||{},result:capture.result}); capture.id = text(capture.id) || digest;
    if (imports.has(capture.id)) { must(imports.get(capture.id).sha256 === digest, 'Capture ID reused with different provider result'); continue; }
    let result;
    try { result = unwrap(capture.result); } catch (error) { issues.push({code:'CAPTURE_ERROR',captureId:capture.id,capturedAt:capture.capturedAt,accountId:account.id,operation:capture.operation,request:capture.request||{},detail:error.message}); continue; }
    const rows = extractRows(result);
    const returnedIds = new Set(rows.map(row => row.id));
    for (const expected of array(capture.request?.message_ids || capture.request?.message_id))
      if (!returnedIds.has(expected)) issues.push({code:'REQUESTED_MESSAGE_NOT_RETURNED',captureId:capture.id,accountId:account.id,messageId:expected});
    for (const raw of rows) {
      try {
        const m = normalizeMessage(raw, account, capture);
        must(Date.parse(m.email_ts) <= now.getTime(), 'Provider event is in the future');
        messages.set(key(m), mergeMessage(messages.get(key(m)), m));
      } catch (error) { issues.push({code:error.code==='MESSAGE_IDENTITY_CONFLICT'?error.code:'MESSAGE_READ_REQUIRED',captureId:capture.id,capturedAt:capture.capturedAt,accountId:account.id,messageId:raw.id || null,detail:error.message,...(error.code==='MESSAGE_IDENTITY_CONFLICT'?{previousThreadId:error.previousThreadId,incomingThreadId:error.incomingThreadId}:{})}); }
    }
    const operation = text(capture.operation).replace(/^.*gmail_/, '');
    const cursor = result.next_page_token ?? result.nextPageToken;
    const info = {id:capture.id,sha256:digest,accountId:account.id,capturedAt:capture.capturedAt,operation,request:capture.request || {},rowCount:rows.length,nextPageToken:cursor || null};
    if (cursor) info.continuation = {operation:'search_emails',accountId:account.id,linkId:account.linkId,request:{...info.request,next_page_token:cursor}};
    if (operation.includes('thread') && rows.length >= (capture.request?.max_messages || 20)) info.possibleThreadWindowLimit = true;
    imports.set(capture.id, info);
  }
  for (const item of imports.values()) {
    if (item.continuation && ![...imports.values()].some(later => later.accountId === item.accountId && later.operation === 'search_emails' && later.request.query === item.request.query && later.request.next_page_token === item.nextPageToken)) continuations.push(item.continuation);
    if (item.possibleThreadWindowLimit) issues.push({code:'THREAD_WINDOW_MAY_BE_CAPPED',captureId:item.id,accountId:item.accountId,request:item.request});
  }
  const ordered = [...messages.values()].sort((a,b) => a.email_ts.localeCompare(b.email_ts) || key(a).localeCompare(key(b)));
  const captureIssueCodes = new Set(['CAPTURE_ERROR','MESSAGE_READ_REQUIRED','REQUESTED_MESSAGE_NOT_RETURNED','MESSAGE_IDENTITY_CONFLICT']);
  const unresolved = issues.filter(issue => {
    if(issue.code==='MESSAGE_IDENTITY_CONFLICT') {
      const retained=messages.get(issue.accountId+':'+issue.messageId);
      return !(retained?.detail==='FULL_HEADERS'&&Date.parse(retained.headersCapturedAt)>Date.parse(issue.capturedAt));
    }
    if (issue.code === 'CAPTURE_ERROR') return !imports.has(issue.captureId) &&
      ![...imports.values()].some(item => item.accountId === issue.accountId &&
        item.operation === text(issue.operation).replace(/^.*gmail_/, '') &&
        Date.parse(item.capturedAt) >= Date.parse(issue.capturedAt || '1970-01-01T00:00:00Z') &&
        hash(item.request) === hash(issue.request));
    if (captureIssueCodes.has(issue.code) && issue.messageId) return messages.get(issue.accountId+':'+issue.messageId)?.detail !== 'FULL_HEADERS';
    return true;
  });
  issues.length = 0;
  const issueKeys = new Set();
  for (const issue of unresolved) { const issueKey=hash(issue); if(!issueKeys.has(issueKey)){issueKeys.add(issueKey);issues.push(issue);} }
  const captureIssues = issues.filter(issue=>captureIssueCodes.has(issue.code));
  const reviews = new Map((previous?.reviews || []).map(review => [review.accountId+':'+review.messageId,review]));
  for (const review of input.reviews || []) reviews.set(review.accountId+':'+review.messageId,review);
  const {bound,unbound} = bindMessages(ordered,input.cases,[...reviews.values()],issues);
  for(const m of bound) {
    const conflicts=captureIssues.filter(issue=>issue.code==='MESSAGE_IDENTITY_CONFLICT'&&issue.accountId===m.accountId&&issue.messageId===m.id);
    if(conflicts.length)m.captureIssues=['MESSAGE_IDENTITY_CONFLICT'];
  }
  const needed = ordered.filter(m => m.detail !== 'FULL_HEADERS');
  for (const account of accounts.values()) {
    const ids = unique([...needed.filter(m => m.accountId === account.id).map(m => m.id),...captureIssues.filter(issue=>issue.accountId===account.id&&issue.messageId).map(issue=>issue.messageId)]);
    for (let i=0;i<ids.length;i+=100) continuations.push({operation:'batch_read_email',accountId:account.id,linkId:account.linkId,request:{message_ids:ids.slice(i,i+100)}});
  }
  for (const issue of captureIssues) if (issue.code==='CAPTURE_ERROR') continuations.push({operation:issue.operation,accountId:issue.accountId,linkId:accounts.get(issue.accountId)?.linkId,request:issue.request});
  const coverage = {generatedAt:now.toISOString(),capturedMessages:ordered.length,boundMessages:bound.length,unboundMessages:unbound.length,fullHeaderMessages:ordered.length-needed.length,captureCount:imports.size,continuations,issues,unbound};
  const state = {schema:SCHEMA,generatedAt:now.toISOString(),accounts:[...accounts.values()],imports:[...imports.values()],messages:ordered,reviews:[...reviews.values()],captureIssues};
  const replySnapshot = {accounts:[...accounts.values()],cases:input.cases.map(({bindings,...c})=>c),messages:bound,coverage};
  return {state,replySnapshot,coverage};
}

export async function writeGmailCapture(result, directory) {
  await mkdir(directory,{recursive:true,mode:0o700});
  for (const [filename,value] of [['mailbox-state.json',result.state],['reply-snapshot.json',result.replySnapshot],['mailbox-coverage.json',result.coverage]])
    await writeFile(path.join(directory,filename),JSON.stringify(value,null,2)+'\n',{mode:0o600});
}

async function main() {
  const args=process.argv.slice(2);
  if (!args.length || args.includes('--help')) { console.log('Usage: node gmail-capture.mjs <captures.json> <private-output-dir> [--previous=mailbox-state.json] [--now=ISO]'); return; }
  must(args.length>=2,'Input and private output directory required');
  const input=JSON.parse(await readFile(args[0],'utf8'));
  const previousArg=args.find(v=>v.startsWith('--previous=')),nowArg=args.find(v=>v.startsWith('--now='));
  const previous=previousArg?JSON.parse(await readFile(previousArg.slice(11),'utf8')):undefined;
  const result=importGmailCaptures(input,{previous,now:nowArg?new Date(nowArg.slice(6)):new Date()});
  const destination=path.resolve(args[1]); await writeGmailCapture(result,destination);
  console.log(JSON.stringify({outputDir:destination,messages:result.coverage.capturedMessages,bound:result.coverage.boundMessages,continuations:result.coverage.continuations.length,issues:result.coverage.issues.length}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(error=>{console.error(error.message);process.exitCode=1;});
