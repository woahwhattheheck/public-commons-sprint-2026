'use strict';

/** The native Google Groups plain-text failure form retains its returned headers inline. */
function googleGroupsFailure(payload, details) {
  const values = name => (payload?.headers ?? [])
    .filter(h => String(h?.name).toLowerCase() === name)
    .map(h => String(h.value ?? '').trim());
  const emailList = value => [...new Set(String(value).toLowerCase()
    .match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g) ?? [])];
  const ids = value => [...new Set(String(value).match(/<[^<>\s]+@[^<>\s]+>/g) ?? [])];
  const from = emailList(values('from').join(', '));
  if (String(payload?.mime_type ?? payload?.mimeType ?? '').toLowerCase() !== 'text/plain' ||
      details.delivery_status?.length || from.length !== 1 || from[0] !== 'mailer-daemon@googlemail.com' ||
      values('auto-submitted').join(' ').toLowerCase() !== 'auto-replied' ||
      values('subject').join(' ').toLowerCase() !== 'delivery status notification (failure)') return details;

  const text = String(details.body ?? '').replaceAll('\r\n', '\n');
  const marker = '\n----- Original message -----\n';
  const at = text.indexOf(marker);
  if (at < 0 || text.indexOf(marker, at + marker.length) >= 0) return details;
  const notice = text.slice(0, at).trim();
  const failed = /We're writing to let you know that the group you tried to contact \(([a-z0-9._%+-]+)\) may not exist, or you may not have permission to post messages to the group\./i.exec(notice);
  const domain = /https:\/\/support\.google\.com\/a\/([a-z0-9.-]+)\/bin\/topic\.py\?topic=25838(?:[.\s]|$)/i.exec(notice)?.[1]?.toLowerCase();
  if (!failed || !domain || !notice.toLowerCase().endsWith(domain + ' admins')) return details;

  // Read only the returned header section. Quoted message bodies cannot supply
  // recipient or Message-ID fields. Folded original headers retain their values.
  const returned = text.slice(at + marker.length).replace(/^\n+/, '').split(/\n\s*\n/, 1)[0]
    .replace(/\n[ \t]+/g, ' ');
  const fields = new Map();
  for (const line of returned.split('\n')) {
    const split = line.indexOf(':');
    if (split <= 0) continue;
    const key = line.slice(0, split).toLowerCase(), value = line.slice(split + 1).trim();
    fields.set(key, [...(fields.get(key) ?? []), value]);
  }
  const recipients = emailList((fields.get('to') ?? []).join(', '));
  const original = ids((fields.get('message-id') ?? []).join(' '));
  const reply = ids(values('in-reply-to').join(' '));
  const recipient = failed[1].toLowerCase() + '@' + domain;
  if (recipients.length !== 1 || recipients[0] !== recipient ||
      original.length !== 1 || reply.length !== 1 || original[0] !== reply[0]) return details;

  // Google provides no SMTP status code in this form. Preserve that absence.
  // The normal importer still binds this recipient/RFC ID to the exact earlier SENT.
  return {...details, body:notice,
    returned_message_ids:[...new Set([...(details.returned_message_ids ?? []), original[0]])],
    delivery_status:[{recipient, action:'failed', status:'', diagnostic:failed[0]}]};
}

module.exports = {googleGroupsFailure};
