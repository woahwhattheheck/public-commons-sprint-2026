export const RECEIPT_PREFIX = 'cookie-crumbs:v1';
export const MAX_MEMO_BYTES = 480;

const FIELD_LIMITS = Object.freeze({
  kind: 32,
  subject: 96,
  note: 220,
  id: 32,
});

export function utf8Bytes(value) {
  return new TextEncoder().encode(String(value)).byteLength;
}

export function normalizeField(value, maxChars) {
  const normalized = String(value ?? '')
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized.slice(0, maxChars);
}

function encodeField(name, value) {
  return `${name}=${encodeURIComponent(value)}`;
}

export function composeReceipt({ kind, subject, note = '', createdAt = new Date(), id = '' }) {
  const safeKind = normalizeField(kind, FIELD_LIMITS.kind);
  const safeSubject = normalizeField(subject, FIELD_LIMITS.subject);
  const safeNote = normalizeField(note, FIELD_LIMITS.note);
  const safeId = normalizeField(id, FIELD_LIMITS.id);

  if (!safeKind) throw new Error('Receipt kind is required.');
  if (!safeSubject) throw new Error('Receipt subject is required.');

  const date = createdAt instanceof Date ? createdAt : new Date(createdAt);
  if (Number.isNaN(date.getTime())) throw new Error('Receipt timestamp is invalid.');

  const fields = [
    encodeField('ts', date.toISOString()),
    encodeField('kind', safeKind),
    encodeField('subject', safeSubject),
  ];
  if (safeNote) fields.push(encodeField('note', safeNote));
  if (safeId) fields.push(encodeField('id', safeId));

  const memo = `${RECEIPT_PREFIX}|${fields.join('|')}`;
  const bytes = utf8Bytes(memo);
  if (bytes > MAX_MEMO_BYTES) {
    throw new Error(`Receipt is ${bytes} bytes; keep it at or below ${MAX_MEMO_BYTES} bytes.`);
  }
  return memo;
}

export function parseReceipt(memo) {
  if (typeof memo !== 'string' || !memo.startsWith(`${RECEIPT_PREFIX}|`)) return null;
  const parts = memo.slice(RECEIPT_PREFIX.length + 1).split('|');
  const fields = Object.create(null);

  for (const part of parts) {
    const index = part.indexOf('=');
    if (index <= 0) throw new Error('Malformed Cookie Crumbs field.');
    const key = part.slice(0, index);
    if (!['ts', 'kind', 'subject', 'note', 'id'].includes(key)) {
      throw new Error(`Unknown Cookie Crumbs field: ${key}`);
    }
    if (Object.hasOwn(fields, key)) throw new Error(`Duplicate Cookie Crumbs field: ${key}`);
    fields[key] = decodeURIComponent(part.slice(index + 1));
  }

  if (!fields.ts || !fields.kind || !fields.subject) {
    throw new Error('Cookie Crumbs receipt is missing required fields.');
  }
  const date = new Date(fields.ts);
  if (Number.isNaN(date.getTime())) throw new Error('Cookie Crumbs timestamp is invalid.');

  return {
    version: 1,
    createdAt: date.toISOString(),
    kind: fields.kind,
    subject: fields.subject,
    note: fields.note ?? '',
    id: fields.id ?? '',
    raw: memo,
  };
}

export function parsedTransactionSignedBy(parsedTransaction, walletAddress) {
  const expected = String(walletAddress ?? '').trim();
  if (!expected) return false;
  const accountKeys = parsedTransaction?.transaction?.message?.accountKeys;
  if (!Array.isArray(accountKeys)) return false;

  return accountKeys.some((entry) => {
    if (!entry || entry.signer !== true) return false;
    const key = entry.pubkey ?? entry;
    let address = '';
    try {
      if (typeof key === 'string') address = key;
      else if (typeof key?.toBase58 === 'function') address = key.toBase58();
      else if (typeof key?.toString === 'function') address = key.toString();
    } catch {
      return false;
    }
    return address === expected;
  });
}

export function shortAddress(value, left = 5, right = 5) {
  const text = String(value ?? '');
  if (text.length <= left + right + 3) return text;
  return `${text.slice(0, left)}…${text.slice(-right)}`;
}
