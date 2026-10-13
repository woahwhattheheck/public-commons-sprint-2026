'use strict';

// Selected-case, READ-ONLY connected Gmail retrieval. Original collectors and
// original MIME projection remain the message interpretation boundary.
const { collectGmailSearchPages, projectGmailSearchHeaders } = require('./connected_gmail_search.cjs');
const { projectGmailMessages } = require('./connected_gmail_messages.cjs');
const { needsGmailRawMessage, bindGmailRawMessage } = require('./connected_gmail_raw.cjs');
const METHODS = Object.freeze({ profile: 'mcp__codex_apps__gmail_get_profile',
  search: 'mcp__codex_apps__gmail_search_emails', read: 'mcp__codex_apps__gmail_batch_read_email',
  raw: 'mcp__codex_apps__gmail_read_email' });
const MAILBOXES = Object.freeze({business:null,secondary:null});
const own = (value, key) => Object.hasOwn(value, key);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = code => { const error = new TypeError(code); error.code = code; throw error; };
function bounded(value, maximum, code) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || /[\x00-\x1f\x7f]/.test(value)) fail(code);
  return value;
}
function limit(value, fallback, low, high) {
  value = value === undefined ? fallback : value;
  if (!Number.isSafeInteger(value) || value < low || value > high) fail('INVALID_MAILBOX_LIMIT');
  return value;
}
function ids(value) {
  if (!Array.isArray(value) || value.length > 1000 || value.some(id => typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(id)))
    fail('INVALID_PROVIDER_MESSAGE_IDS');
  return [...new Set(value)];
}

function normalizeCaseMailRequest(input) {
  if (!record(input)) fail('CASE_MAIL_REQUEST_REQUIRED');
  const allowed = ['case_id', 'case_fingerprint', 'query', 'mailboxes', 'known_message_ids', 'continuations', 'limits'];
  if (Object.keys(input).some(key => !allowed.includes(key))) fail('UNKNOWN_CASE_MAIL_FIELD');
  const case_id = bounded(input.case_id, 100, 'CASE_ID_REQUIRED');
  if (!/^[a-zA-Z0-9_-]+$/.test(case_id) || !/^[a-f0-9]{64}$/.test(input.case_fingerprint ?? '')) fail('CASE_FINGERPRINT_REQUIRED');
  const query = bounded(input.query, 8192, 'CASE_QUERY_REQUIRED');
  const mailboxes = input.mailboxes ?? ['business', 'secondary'];
  if (!Array.isArray(mailboxes) || !mailboxes.length || mailboxes.length > 2 ||
      mailboxes.some(key => !own(MAILBOXES, key)) || new Set(mailboxes).size !== mailboxes.length) fail('KNOWN_MAILBOX_SELECTION_REQUIRED');
  const known = input.known_message_ids ?? {}, continuations = input.continuations ?? {}, rawLimits = input.limits ?? {};
  for (const value of [known, continuations, rawLimits]) if (!record(value)) fail('INVALID_CASE_MAIL_OPTIONS');
  if (Object.keys(known).some(key => !mailboxes.includes(key)) || Object.keys(continuations).some(key => !mailboxes.includes(key))) fail('UNSELECTED_MAILBOX_OPTION');
  if (Object.keys(rawLimits).some(key => !['max_pages', 'max_messages', 'page_size'].includes(key))) fail('UNKNOWN_MAILBOX_LIMIT');
  const continuation = {};
  for (const [key, value] of Object.entries(continuations)) continuation[key] = bounded(value, 8192, 'INVALID_NATIVE_PAGE_TOKEN');
  return { case_id, case_fingerprint: input.case_fingerprint, query, mailboxes: [...mailboxes],
    known_message_ids: Object.fromEntries(mailboxes.map(key => [key, ids(known[key] ?? [])])), continuations: continuation,
    limits: { max_pages: limit(rawLimits.max_pages, 10, 1, 10), max_messages: limit(rawLimits.max_messages, 1000, 1, 1000),
      page_size: limit(rawLimits.page_size, 100, 1, 100) } };
}

function profileValue(response, expected) {
  const value = response?.structuredContent;
  if (response?.isError === true || !record(value) || String(value.email ?? '').toLowerCase() !== expected.email ||
      String(value.id ?? '') !== expected.profile_id) fail('CONNECTED_GMAIL_PROFILE_MISMATCH');
  return { id: String(value.id), email: value.email, link_id: expected.link_id };
}

async function retrieveCaseMail(tools, input, { progress = async () => {}, mailboxConfiguration } = {}) {
  if(!mailboxConfiguration||!['business','secondary'].every(key=>{const m=mailboxConfiguration[key];return m&&typeof m.link_id==='string'&&m.link_id&&/^\d+$/.test(String(m.profile_id))&&typeof m.email==='string'&&m.email.includes('@');}))fail('ORIGINAL_PRIVATE_MAILBOX_CONFIGURATION_REQUIRED');
  const request = normalizeCaseMailRequest(input);
  for (const name of [METHODS.profile, METHODS.search, METHODS.read]) if (typeof tools?.[name] !== 'function') fail('CONNECTED_GMAIL_BINDING_MISSING');
  const started_at = new Date().toISOString();
  const accounts = [];
  // Each account is retained separately. Gmail provider IDs alone are not used
  // to flatten messages across identities or infer the business sender.
  for (const mailbox of request.mailboxes) {
    const expected = mailboxConfiguration[mailbox];
    const account = { mailbox, profile: null, status: 'RUNNING', search: null, search_projection: null,
      exports: [], raw_exports: [], raw_pending_ids: [], unreturned_ids: [], pending_ids: [], issue: null };
    accounts.push(account);
    try {
      await progress({ mailbox, phase: 'PROFILE', messages: 0 });
      const nativeProfile = await tools[METHODS.profile]({ link_id: expected.link_id });
      account.profile_response = nativeProfile;
      account.profile = profileValue(nativeProfile, expected);
      const linkedTools = { [METHODS.search]: args => tools[METHODS.search]({ ...args, link_id: expected.link_id }) };
      await progress({ mailbox, phase: 'SEARCH', messages: 0 });
      account.search = await collectGmailSearchPages(linkedTools, { args: { query: request.query,
        max_results: request.limits.page_size, ...(request.continuations[mailbox] ? { next_page_token: request.continuations[mailbox] } : {}) },
      max_pages: request.limits.max_pages, timeout_ms: 60000, max_response_chars: 8388608, max_total_response_chars: 16777216 });
      account.search_projection = projectGmailSearchHeaders(account.search, { max_messages: 1000,
        max_field_chars: 1000, max_total_header_chars: 64000 });
      const discovered = [];
      // Header display budgets must not silently drop messages to retrieve.
      // IDs come from the collector's retained, successful native page mapping;
      // the original projection remains the source for displayed headers.
      for (const page of account.search.pages.filter(page => page.status === 'ok')) {
        const rows = account.search.responses[page.response_index].structuredContent.emails;
        for (const row of rows) {
          if (typeof row.id === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(row.id)) discovered.push(row.id);
          else account.issue = { code: 'GMAIL_SEARCH_ID_UNAVAILABLE' };
        }
      }
      const selected = [...new Set([...request.known_message_ids[mailbox], ...discovered])];
      const fetchIds = selected.slice(0, request.limits.max_messages);
      account.pending_ids = selected.slice(fetchIds.length);
      for (let index = 0; index < fetchIds.length; index += 100) {
        const batchIds = fetchIds.slice(index, index + 100);
        await progress({ mailbox, phase: 'MESSAGES', messages: index, requested: fetchIds.length });
        let response;
        try { response = await tools[METHODS.read]({ link_id: expected.link_id, message_ids: batchIds }); }
        catch (error) {
          // Retain the interrupted batch and every remaining ID so an operator
          // can resume the same case without repeating successful reads.
          account.pending_ids = [...fetchIds.slice(index), ...account.pending_ids];
          throw error;
        }
        const retained = { batch_index: account.exports.length, requested_ids: batchIds, provider_response: response, projection: null, issue: null };
        account.exports.push(retained);
        try {
          const projection = projectGmailMessages(response, { include_native_metadata: true,
            maxMessages: 100, maxBodyChars: 12000, maxTotalBodyChars: 240000, maxHeaderChars: 1000 });
          const raw = response.structuredContent;
          if (!Array.isArray(raw.responses)) fail('GMAIL_BATCH_RESPONSE_REQUIRED');
          const returned = raw.responses.map(message => message.id);
          if (new Set(returned).size !== returned.length || returned.some(id => !batchIds.includes(id))) fail('GMAIL_BATCH_ID_MISMATCH');
          account.unreturned_ids.push(...batchIds.filter(id => !returned.includes(id)));
          retained.projection = projection;
        } catch (error) { retained.issue = { code: error.code ?? 'GMAIL_MESSAGE_PROJECTION_FAILED' }; }
      }
      // Keep FULL and RAW as separate original provider responses. A FULL
      // projection can omit message/delivery-status bytes even when its human
      // readable notice body is complete. RAW is required only for notices.
      const notices=account.exports.filter(item=>!item.issue)
        .flatMap(item=>item.provider_response.structuredContent.responses).filter(needsGmailRawMessage);
      account.raw_pending_ids=notices.map(message=>message.id);
      for (const message of notices) {
        await progress({mailbox,phase:'RAW_MESSAGES',message_id:message.id,
          messages:account.raw_exports.filter(item=>!item.issue).length,requested:notices.length});
        if (typeof tools?.[METHODS.raw] !== 'function') fail('CONNECTED_GMAIL_RAW_BINDING_MISSING');
        let response;
        try { response=await tools[METHODS.raw]({link_id:expected.link_id,message_id:message.id,format:'raw'}); }
        catch(error) { throw error; } // Pending IDs and successful FULL/RAW responses remain retained.
        const retained={message_id:message.id,provider_response:response,source:null,delivery_sources:[],issue:null};
        account.raw_exports.push(retained);
        try {
          const joined=bindGmailRawMessage(message,response,{mailbox:expected.email});
          retained.source=joined.source;
          retained.delivery_sources=joined.delivery_sources;
          account.raw_pending_ids=account.raw_pending_ids.filter(id=>id!==message.id);
        } catch(error) {
          retained.issue={code:error.code??'GMAIL_RAW_MESSAGE_BINDING_FAILED'};
          throw error; // Preserve the provider failure and remaining work; do not replay it.
        }
      }
      const sourceFinished = account.search.summary.provider_end_observed === true;
      if (!account.issue && !sourceFinished) account.issue = { code: 'GMAIL_SEARCH_' + (account.search.summary.stop_reason ?? 'INCOMPLETE') };
      if (!account.issue) account.issue = account.exports.find(item => item.issue)?.issue ?? null;
      if (!account.issue && account.unreturned_ids.length) account.issue = { code: 'GMAIL_BATCH_IDS_MISSING' };
      if (!account.issue && account.pending_ids.length) account.issue = { code: 'GMAIL_MESSAGE_LIMIT' };
      if (!account.issue && account.raw_pending_ids.length) account.issue = {code:'GMAIL_RAW_MESSAGES_PENDING'};
      account.status = sourceFinished && !account.issue && !account.pending_ids.length && !account.raw_pending_ids.length && !account.unreturned_ids.length &&
        account.exports.every(item => !item.issue) && !['REFUSED', 'UNAVAILABLE', 'NO_SUCCESSFUL_PAGES'].includes(account.search_projection.status)
        ? 'READY' : 'PARTIAL';
      await progress({ mailbox, phase: account.status, messages: account.exports.reduce((sum, item) => sum + (item.projection?.messages?.length ?? 0), 0) });
    } catch (error) {
      account.status = account.exports.length ? 'PARTIAL' : 'FAILED';
      account.issue = { code: typeof error?.code === 'string' ? error.code : 'CONNECTED_MAILBOX_READ_FAILED' };
      await progress({ mailbox, phase: account.status, messages: account.exports.length });
    }
  }
  const summary = { accounts: accounts.length, ready: accounts.filter(account => account.status === 'READY').length,
    partial: accounts.filter(account => account.status === 'PARTIAL').length, failed: accounts.filter(account => account.status === 'FAILED').length,
    messages: accounts.reduce((total, account) => total + account.exports.reduce((sum, item) => sum + (item.projection?.messages?.length ?? 0), 0), 0),
    exports: accounts.reduce((total, account) => total + account.exports.length, 0),
    raw_messages: accounts.reduce((total, account) => total + account.raw_exports.filter(item=>!item.issue).length, 0),
    raw_pending: accounts.reduce((total, account) => total + account.raw_pending_ids.length, 0),
    provider_responses: accounts.reduce((total, account) => total + (account.profile_response ? 1 : 0) + (account.search?.responses.length ?? 0) + account.exports.length + account.raw_exports.length, 0),
    outbound_calls: 0,
    mailboxes: accounts.map(account => ({ mailbox: account.mailbox, status: account.status,
      message_count: account.exports.reduce((sum, item) => sum + (item.projection?.messages?.length ?? 0), 0),
      ...(account.issue ? { issue: account.issue } : {}),
      pending_count: account.pending_ids.length, unreturned_count: account.unreturned_ids.length,
      raw_count: account.raw_exports.filter(item=>!item.issue).length,raw_pending_count:account.raw_pending_ids.length,
      has_next_page: account.search?.next_request !== null && account.search?.next_request !== undefined })) };
  const state = summary.ready === accounts.length ? 'READY' : summary.failed === accounts.length ? 'FAILED' : 'PARTIAL';
  return { schema: 'commons.case_mail_retrieval/v1', state, case_id: request.case_id,
    case_fingerprint: request.case_fingerprint, query: request.query, started_at, finished_at: new Date().toISOString(),
    accounts, summary };
}

module.exports = { METHODS, MAILBOXES, normalizeCaseMailRequest, retrieveCaseMail };
