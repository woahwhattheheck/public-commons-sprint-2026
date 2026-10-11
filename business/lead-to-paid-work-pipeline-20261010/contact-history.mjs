// Read the original shared contact registry into the existing operating board.
// The registry remains canonical; this module never reserves, contacts or writes it.
const REPOSITORY = 'woahwhattheheck/commons';
const FOLLOWUP_HOURS = 48;
const text = value => typeof value === 'string' ? value.trim() : '';
const unique = values => [...new Set(values)];
const must = (condition, message) => { if (!condition) throw Error(message); };
const timestamp = (value, label, latest) => {
  must(typeof value === 'string' && /(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value)), label + ': offset timestamp required');
  must(Date.parse(value) <= latest, label + ': future observation');
  return new Date(value).toISOString();
};
const https = value => {
  try { const u = new URL(value); return u.protocol === 'https:' && !!u.hostname && !u.username && !u.password; }
  catch { return false; }
};
function claimPath(value) {
  const match = text(value).match(/^tools\/sales_first_contact\/claims\/v1\/([a-f0-9]{2})\/([a-f0-9]{64})\.json$/);
  must(match && match[1] === match[2].slice(0, 2), 'Original contact-registry path required');
  return value;
}
function requestPath(capture) {
  if (capture.operation === 'first_contact.export') return claimPath(capture.claimPath);
  const source = capture.request?.url;
  must(https(source), 'Original GitHub read request URL required');
  const u = new URL(source);
  let path;
  if (u.hostname === 'raw.githubusercontent.com') {
    const prefix = '/' + REPOSITORY + '/main/';
    must(u.pathname.startsWith(prefix), 'Read the original registry on main');
    path = u.pathname.slice(prefix.length);
  } else {
    const prefix = '/repos/' + REPOSITORY + '/contents/';
    must(u.hostname === 'api.github.com' && u.pathname.startsWith(prefix) && u.searchParams.get('ref') === 'main', 'Read the original registry on main');
    path = u.pathname.slice(prefix.length);
  }
  return claimPath(decodeURIComponent(path));
}
function unpack(result, path, operation, depth = 0) {
  must(result && typeof result === 'object' && depth < 12, 'Original provider result required');
  if (result.error_code === 'NOT_FOUND' && String(result.error_data?.status) === '404') return null;
  must(!result.isError && !result.error && !result.error_code, 'Registry provider read failed');
  if (result.structuredContent) return unpack(result.structuredContent, path, operation, depth + 1);
  if (typeof result.ok === 'boolean' && Number.isInteger(result.status) && Object.hasOwn(result, 'data')) {
    if (result.status === 404 && !result.ok && result.data?.message === 'Not Found') return null;
    must(result.status === 200 && result.ok, 'Registry native HTTP read failed: ' + result.status);
    return unpack(result.data, path, operation, depth + 1);
  }
  if (Array.isArray(result.content)) {
    for (const part of result.content) if (part.type === 'text') {
      let parsed; try { parsed = JSON.parse(part.text); } catch { continue; }
      return unpack(parsed, path, operation, depth + 1);
    }
    throw Error('Registry result has no readable provider data');
  }
  if (result.outcome) {
    const identities = [result.claim_path,result.path].filter(value => value !== undefined);
    must(operation === 'first_contact.export' && result.outcome === 'CONTACT_EXPORT' && identities.length && identities.every(value => value === path), 'Use a completed canonical export whose path matches the requested record');
    if (result.http_status === 404 && result.record === null) return null;
    must(result.http_status === 200 && result.record, 'Canonical export did not read a record');
    return unpack(result.record, path, operation, depth + 1);
  }
  if (result.type === 'file') {
    must(result.path === path && result.encoding === 'base64' && text(result.sha), 'GitHub Contents identity differs from requested record');
    return unpack(JSON.parse(Buffer.from(result.content, 'base64').toString('utf8')), path, operation, depth + 1);
  }
  if (typeof result.content === 'string') return unpack(JSON.parse(result.content), path, operation, depth + 1);
  must(result.protocol === 'commons-first-contact-v1', 'Unknown contact-registry protocol');
  return result;
}
function normalize(record, source) {
  const latest = Date.parse(source.capturedAt);
  must(text(record.case) && record.case.length <= 150, 'Contact record case required');
  const channel = record.channel || 'email';
  must(['email', 'web-form'].includes(channel), 'Unknown contact channel');
  const value = {...source, caseId: record.case, channel, status: record.status, completed: false};
  if (record.status === 'reserved') {
    must(text(record.lease), 'Original reservation lease missing');
    value.reservedAt = timestamp(record.reserved_at, 'reserved_at', latest);
    must(Number.isFinite(Date.parse(record.send_expires_at)) && Date.parse(record.send_expires_at) > Date.parse(value.reservedAt), 'Original reservation expiry missing');
    value.expiresAt = new Date(record.send_expires_at).toISOString();
    return value;
  }
  if (channel === 'email') {
    must(record.status === 'sent' && record.provider === 'gmail' && /^[a-fA-F0-9]{12,40}$/.test(record.provider_message_id || ''), 'Original confirmed Gmail SENT record required');
    return {...value, completed: true, provider: 'gmail', providerMessageId: record.provider_message_id,
      observedAt: timestamp(record.sent_verified_at, 'sent_verified_at', latest)};
  }
  const receipt = record.form_receipt;
  must(record.status === 'submitted' && receipt?.outcome === 'accepted' && /^[a-z0-9][a-z0-9._-]{1,63}$/.test(receipt.provider || ''), 'Original accepted form receipt required');
  must(https(receipt.page_url) && https(receipt.evidence_url) && /^[a-fA-F0-9]{64}$/.test(receipt.evidence_sha256 || ''), 'Saved form confirmation and receipt digest required');
  const observedAt = timestamp(receipt.observed_at, 'form observed_at', latest);
  const providerAcceptedAt = receipt.provider_accepted_at == null ? null : timestamp(receipt.provider_accepted_at, 'provider_accepted_at', Date.parse(observedAt));
  if (receipt.submission_id != null) must(/^[A-Za-z0-9][A-Za-z0-9._:-]{4,159}$/.test(receipt.submission_id), 'Original provider submission ID is invalid');
  return {...value, completed: true, provider: receipt.provider, observedAt, providerAcceptedAt,
    submissionId: receipt.submission_id || null, evidenceUrl: receipt.evidence_url,
    evidenceSha256: receipt.evidence_sha256.toLowerCase(), confirmationUrl: receipt.page_url,
    recordedAt: timestamp(record.recorded_at, 'recorded_at', latest)};
}

/** Native GitHub file reads or unmodified first_contact.py export responses. */
export function importContactHistory(input, now = new Date()) {
  must(Number.isFinite(now.getTime()) && input && Array.isArray(input.captures), 'captures[] and valid assessment time required');
  const observations = [], issues = [];
  for (const [index, capture] of input.captures.entries()) {
    let path = null;
    try {
      path = requestPath(capture);
      const capturedAt = timestamp(capture.capturedAt, 'capturedAt', now.getTime());
      const record = unpack(capture.result, path, capture.operation);
      const source = {claimPath: path, captureId: text(capture.id) || String(index), capturedAt,
        sourceUrl: capture.request?.url || null, source: capture.operation === 'first_contact.export' ? 'CANONICAL_CLI_EXPORT' : 'NATIVE_GITHUB_READ'};
      observations.push(record ? normalize(record, source) : {...source, status: 'absent', completed: false});
    } catch (error) { issues.push({code: 'CONTACT_RECORD_READ_REQUIRED', claimPath: path, captureId: text(capture?.id) || String(index), detail: error.message}); }
  }
  const paths = unique(observations.map(item => item.claimPath));
  const records = paths.map(path => {
    const items = observations.filter(item => item.claimPath === path).sort((a,b) => Date.parse(b.capturedAt) - Date.parse(a.capturedAt));
    // An observed completed contact remains history if a later read is absent/reserved.
    const completed = items.filter(item => item.completed);
    const record = completed[0] || items[0];
    if (completed.length && !items[0].completed) issues.push({code: 'COMPLETED_CONTACT_CHANGED_IN_REGISTRY', claimPath: path, retainedCaptureId: record.captureId, latestCaptureId: items[0].captureId});
    return record;
  });
  return {generatedAt: now.toISOString(), source: 'OPERATOR_SUPPLIED_CANONICAL_CONTACT_CAPTURES', repository: REPOSITORY,
    captureCount: input.captures.length, observedPaths: paths, records, issues, cases: []};
}

export function applyContactHistory(opportunities, decisions, input, now, replyReport = null) {
  if (input === undefined) return null;
  const report = importContactHistory(input, now);
  const conversationLanes = new Set(['ACTIVE_CUSTOMER_REPLY','REVIEW_HUMAN_REPLY','CLOSED_DECLINED','RECONNECT_NAMED_CONTACT','FIX_DELIVERY','READ_GMAIL_CONTENT']);
  for (const [index, op] of opportunities.entries()) {
    const paths = op.communication?.contactClaimPaths;
    if (paths === undefined) continue;
    must(Array.isArray(paths) && paths.length && new Set(paths).size === paths.length, 'contactClaimPaths must contain unique original registry paths');
    paths.forEach(claimPath);
    const decision = decisions[index];
    const matching = report.records.filter(record => paths.includes(record.claimPath));
    const completed = matching.filter(record => record.completed).sort((a,b) => Date.parse(b.observedAt) - Date.parse(a.observedAt));
    const reserved = matching.filter(record => record.status === 'reserved');
    const missing = paths.filter(path => !report.observedPaths.includes(path));
    const issues = report.issues.filter(issue => issue.claimPath && paths.includes(issue.claimPath));
    const latest = completed[0];
    let status = 'NO_CONTACT_RECORDED', nextAction = null, engagementLane = null;
    if (latest) {
      const elapsed = (now.getTime() - Date.parse(latest.observedAt)) / 36e5;
      status = latest.channel === 'web-form' ? 'FORM_SUBMITTED' : 'EMAIL_SENT';
      engagementLane = elapsed < FOLLOWUP_HOURS ? 'AWAITING_REPLY' : 'REVIEW_FOLLOWUP';
      nextAction = engagementLane === 'AWAITING_REPLY'
        ? 'Work from the completed contact and prepared workshare; use the actual partner response for the next message.'
        : 'Review the existing completed contact and actual reply history for a useful follow-up; preserve its original first-contact record.';
    } else if (reserved.length) {
      status = 'CONTACT_RESERVED'; engagementLane = 'COORDINATE_CONTACT';
      nextAction = 'Continue the original seat contact coordination. Record its actual outcome, or recover an abandoned reservation through the canonical tool after reviewing contact history.';
    } else if (missing.length || issues.length) {
      status = 'CONTACT_RECORD_READ_REQUIRED'; engagementLane = 'READ_CONTACT_HISTORY';
      nextAction = 'Read the specified current main contact records through the original connector or canonical export and resume this board.';
    }
    const summary = {status, completedContacts: completed.length, channels: unique(completed.map(record => record.channel)),
      providers: unique(completed.map(record => record.provider)), latestObservedAt: latest?.observedAt || null,
      engagementLane, nextAction, reservedContacts: reserved.length, missingReads: missing.length, issueCount: issues.length};
    decision.contactHistory = summary;
    report.cases.push({opportunityKey: decision.key, caseId: op.communication?.caseId || null, claimPaths: paths, ...summary});
    if (!nextAction) continue;
    decision.readyForOwnerApproach = false;
    const reason = latest ? 'FIRST_CONTACT_ALREADY_RECORDED' : reserved.length ? 'FIRST_CONTACT_RESERVED' : 'CONTACT_RECORD_READ_REQUIRED';
    if (!decision.blockers.includes(reason)) decision.blockers.push(reason);
    decision.nextActions = decision.nextActions.filter(action => !action.startsWith('Proceed with the authorized') &&
      !action.startsWith('Owner may authorize one tailored unsent prime approach') && !action.startsWith('Reply snapshot contains no verified send'));
    if (!conversationLanes.has(decision.replyTriage?.engagementLane)) {
      if (!decision.nextActions.includes(nextAction)) decision.nextActions.unshift(nextAction);
      if (latest && decision.replyTriage?.status === 'NO_VERIFIED_SEND') {
        const description = 'No Gmail response is captured for the first contact already recorded in the shared registry.';
        decision.replyTriage.nextAction = description;
        decision.replyTriage.engagementLane = engagementLane; // The operating lane spans channels; Gmail counts and status stay original.
        const replyCase = replyReport?.cases.find(item => item.caseId === op.communication?.caseId);
        if (replyCase) replyCase.nextAction = description;
      }
    }
  }
  return report;
}
