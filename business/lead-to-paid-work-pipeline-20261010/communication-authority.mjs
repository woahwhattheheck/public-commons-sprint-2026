// Resolve already-recorded owner authorization for the existing sales workflow.
// A grant describes authority; it does not send, sign, invoice or accept a contract.
const txt = value => typeof value === 'string' ? value.trim() : '';
const list = value => Array.isArray(value) ? value.map(txt).filter(Boolean) : [];
const norm = value => txt(value).normalize('NFKC').toLowerCase();
const unique = values => [...new Set(values)];
export const CONTACT_ACTIONS = Object.freeze(['QUALIFY_PARTNER', 'PROPOSE_WORKSHARE', 'FOLLOW_UP', 'REPLY_TO_PARTNER']);

function address(value) {
  const text = txt(value), found = text.match(/<([^<>\s]+@[^<>\s]+)>/);
  const result = norm(found ? found[1] : text);
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(result) ? result : null;
}

function matches(record, context, exclusion = false) {
  for (const field of ['actions','channels','opportunityIds','recipients','recipientDomains']) {
    if (record[field] !== undefined && (!Array.isArray(record[field]) || !record[field].length || record[field].some(value => typeof value !== 'string' || !value.trim())))
      throw Error('Authority '+field+' must be an array of nonempty strings');
  }
  if ((record.recipients || []).some(value => !address(value))) throw Error('Invalid authority recipient scope');
  if ((record.recipientDomains || []).some(value => !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(value))) throw Error('Invalid authority domain scope');
  const actions = list(record.actions);
  if (!actions.includes(context.action) && !actions.includes('ORDINARY_OUTBOUND_SALES')) return false;
  const channels = list(record.channels);
  if (channels.length && !channels.includes(context.channel)) return false;
  const opportunities = list(record.opportunityIds);
  if (opportunities.length && !opportunities.includes(context.opportunityId)) return false;
  const recipients = list(record.recipients).map(address).filter(Boolean);
  const domains = list(record.recipientDomains).map(norm);
  if (!recipients.length && !domains.length) return true;
  const fits = to => recipients.includes(to) || domains.some(domain => {
    const actual = to.split('@')[1];
    return actual === domain || actual.endsWith('.' + domain);
  });
  return context.recipients.length > 0 && (exclusion ? context.recipients.some(fits) : context.recipients.every(fits));
}

function validAt(record, now) {
  const dated = value => typeof value === 'string' && /(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value));
  if (record.issuedAt && (!dated(record.issuedAt) || Date.parse(record.issuedAt) > now.getTime())) return false;
  if (record.expiresAt && (!dated(record.expiresAt) || Date.parse(record.expiresAt) <= now.getTime())) return false;
  return true;
}

/** OWNER_STANDING and OWNER_EXACT retain their distinct meaning in every output. */
export function resolveCommunicationAuthority(opportunity, policy = {}, now = new Date()) {
  if (!Number.isFinite(now.getTime())) throw Error('Invalid authority assessment time');
  const contact = opportunity.communication || {};
  const action = txt(contact.action) || 'PROPOSE_WORKSHARE';
  if (!CONTACT_ACTIONS.includes(action)) throw Error('Unsupported communication action: ' + action);
  const context = {
    action, channel: txt(contact.channel) || 'email',
    opportunityId: txt(opportunity.buyer?.opportunityId),
    recipients: unique((typeof contact.to === 'string' ? [contact.to] : list(contact.to)).map(address).filter(Boolean))
  };
  if (contact.to !== undefined) {
    const supplied = typeof contact.to === 'string' ? [contact.to] : contact.to;
    if (!Array.isArray(supplied) || supplied.some(value => !address(value))) throw Error('Invalid communication recipient');
  }
  const reasons = [], ignoredAdvisories = [];
  const restrictionSource = txt(contact.restrictionSource).toUpperCase();
  if (contact.doNotContact === true && restrictionSource !== 'AGENT') reasons.push('EXPLICIT_CONTACT_EXCLUSION');
  if (contact.doNotContact === true && restrictionSource === 'AGENT') ignoredAdvisories.push('AGENT_CONTACT_HOLD_NOT_OWNER_AUTHORITY');
  const exclusions = [];
  for (const rule of policy.exclusions || []) {
    if (rule.issuedBy !== 'OWNER') { ignoredAdvisories.push(txt(rule.id) || 'NON_OWNER_EXCLUSION'); continue; }
    if (!txt(rule.reference)) throw Error('Owner exclusion requires its original instruction reference');
    if (validAt(rule, now) && matches(rule, context, true)) exclusions.push({id: txt(rule.id), reference: rule.reference});
  }
  if (exclusions.length) reasons.push('OWNER_CONTACT_EXCLUSION');
  const allowedIds = list(contact.authorizationIds);
  const grants = [];
  for (const grant of policy.grants || []) {
    if (grant.issuedBy !== 'OWNER') { ignoredAdvisories.push(txt(grant.id) || 'NON_OWNER_GRANT'); continue; }
    if (!txt(grant.id) || !txt(grant.reference) || !['STANDING', 'EXACT'].includes(grant.kind)) continue;
    if (allowedIds.length && !allowedIds.includes(grant.id)) continue;
    if (grant.kind === 'EXACT' && !list(grant.recipients).length && !list(grant.opportunityIds).length) continue;
    if (validAt(grant, now) && matches(grant, context)) grants.push(grant);
  }
  grants.sort((a, b) => Number(b.kind === 'EXACT') - Number(a.kind === 'EXACT') || a.id.localeCompare(b.id));
  const grant = grants[0];
  const legacy = contact.ownerApproved === true && !!txt(contact.approvalReceipt);
  const authorized = reasons.length === 0 && (!!grant || legacy);
  if (!grant && !legacy && reasons.length === 0) reasons.push('OWNER_AUTHORIZATION_NOT_RECORDED');
  return {
    authorized, action, channel: context.channel, excluded: exclusions.length > 0 || reasons.includes('EXPLICIT_CONTACT_EXCLUSION'),
    kind: grant ? 'OWNER_' + grant.kind : legacy ? 'OWNER_EXACT_LEGACY' : 'UNRECORDED',
    grantId: grant?.id || null, reference: grant?.reference || (legacy ? contact.approvalReceipt : null),
    reasons, exclusions, ignoredAdvisories: unique(ignoredAdvisories),
    proposalAuthority: authorized && (action === 'PROPOSE_WORKSHARE' ||
      grants.some(g => list(g.actions).includes('PROPOSE_WORKSHARE') || list(g.actions).includes('ORDINARY_OUTBOUND_SALES')))
  };
}
