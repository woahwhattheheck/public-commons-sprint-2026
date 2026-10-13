// MIT. Portable correction proposals and exact three-way selection; original JSON editor owns all edits.
import { parseCorrectionDocument, findCorrectionNode, correctionRaw, correctionTokens,
  correctionPointer, applyCorrectionOperations } from './dcat-correction-json.mjs';
export const ISSUE_SCHEMA = 'stellar-forge.dcat-correction-issue.v1';
export const PROPOSAL_SCHEMA = 'stellar-forge.dcat-correction-proposal.v1';
export const EXCHANGE_LIMITS = Object.freeze({ uniqueBytes: 134217728, fileBytes: 134217728,
  packageBytes: 268435456, editions: 256, historyBytes: 33554432, operations: 1000 });
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/, HASH = /^[a-f0-9]{64}$/;
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const need = (ok, code, message = code) => { if (!ok) throw Object.assign(new Error(message), { code }); };
const own = (x, key) => Object.prototype.hasOwnProperty.call(x, key);
const canonical = x => Array.isArray(x) ? x.map(canonical) : object(x) ?
  Object.fromEntries(Object.keys(x).sort().map(k => [k, canonical(x[k])])) : x;
export const correctionExchangeCanonical = x => JSON.stringify(canonical(x));
const text = (x, max, empty = false) => {
  need(typeof x === 'string' && (empty || x.trim()) && x.length <= max, 'DCAT_EXCHANGE_TEXT_INVALID');
  // Use the maintained parser's Unicode check without changing any literal contents.
  parseCorrectionDocument(JSON.stringify(x)); return x;
};
export const correctionExchangeBytes = value => new TextEncoder().encode(value);
export function correctionExchangeText(raw) {
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(raw); }
  catch { need(false, 'DCAT_EXCHANGE_UTF8_INVALID'); }
}
export function correctionExchangeBase64(raw) {
  let out = '';
  for (let i = 0; i < raw.length; i += 24576) {
    let part = ''; for (const byte of raw.subarray(i, i + 24576)) part += String.fromCharCode(byte);
    out += btoa(part);
  }
  return out;
}
export function correctionExchangeDecode(value, maximum = EXCHANGE_LIMITS.packageBytes) {
  need(typeof value === 'string' && value.length <= Math.ceil(maximum / 3) * 4 &&
    value.length % 4 === 0, 'DCAT_EXCHANGE_BASE64_INVALID');
  // Linear checks avoid a repeated-group regexp stack limit on complete catalogues.
  const pad = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  for (let i = 0; i < value.length - pad; i++) {
    const c = value.charCodeAt(i);
    need(c >= 65 && c <= 90 || c >= 97 && c <= 122 || c >= 48 && c <= 57 || c === 43 || c === 47,
      'DCAT_EXCHANGE_BASE64_INVALID');
  }
  let binary; try { binary = atob(value); } catch { need(false, 'DCAT_EXCHANGE_BASE64_INVALID'); }
  need(binary.length <= maximum, 'DCAT_EXCHANGE_FILE_LIMIT');
  const raw = Uint8Array.from(binary, c => c.charCodeAt(0));
  need(correctionExchangeBase64(raw) === value, 'DCAT_EXCHANGE_BASE64_INVALID'); return raw;
}
export async function correctionExchangeHash(raw) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', raw))].map(x => x.toString(16).padStart(2, '0')).join('');
}
const hashValue = (x, hash) => hash(correctionExchangeBytes(correctionExchangeCanonical(x)));
const without = (x, key) => Object.fromEntries(Object.entries(x).filter(([k]) => k !== key));
function attribution(value) {
  text(value.author, 160); text(value.note, 8192);
  need(typeof value.createdAt === 'string' && Number.isFinite(Date.parse(value.createdAt)), 'DCAT_EXCHANGE_DATE_INVALID');
}
function descriptor(value) {
  need(object(value) && typeof value.key === 'string' && value.key.length <= 512 &&
    HASH.test(value.sha256 ?? '') && Number.isSafeInteger(value.bytes) && value.bytes >= 0 &&
    value.bytes <= EXCHANGE_LIMITS.fileBytes, 'DCAT_EXCHANGE_FILE_INVALID');
  text(value.name, 512); text(value.role, 80);
}
export async function validateCorrectionIssue(issue, hash = correctionExchangeHash) {
  need(object(issue) && issue.schema === ISSUE_SCHEMA && UUID.test(issue.id ?? '') &&
    HASH.test(issue.packageSha256 ?? '') && object(issue.baseline) && Array.isArray(issue.history) &&
    issue.history.length > 0 && issue.history.length <= 4096 && Array.isArray(issue.files) &&
    issue.files.length > 0 && issue.files.length <= 16384 && object(issue.blobs), 'DCAT_EXCHANGE_ISSUE_INVALID');
  text(issue.label, 512); text(issue.issuer, 160); text(issue.recipient, 160); text(issue.note, 8192);
  need(Number.isFinite(Date.parse(issue.createdAt)), 'DCAT_EXCHANGE_DATE_INVALID');
  need(await hashValue(without(issue, 'packageSha256'), hash) === issue.packageSha256, 'DCAT_EXCHANGE_ISSUE_HASH');
  const decoded = new Map(), files = new Map(); let total = 0;
  for (const [sha, value] of Object.entries(issue.blobs)) {
    need(HASH.test(sha) && object(value) && Number.isSafeInteger(value.bytes) && value.bytes >= 0 &&
      value.bytes <= EXCHANGE_LIMITS.fileBytes, 'DCAT_EXCHANGE_BLOB_INVALID');
    total += value.bytes; need(total <= EXCHANGE_LIMITS.uniqueBytes, 'DCAT_EXCHANGE_UNIQUE_SIZE');
    const raw = correctionExchangeDecode(value.contentBase64, value.bytes);
    need(raw.length === value.bytes && await hash(raw) === sha, 'DCAT_EXCHANGE_FILE_CHANGED');
    decoded.set(sha, raw);
  }
  const used = new Set();
  for (const file of issue.files) {
    descriptor(file); need(!files.has(file.key), 'DCAT_EXCHANGE_FILE_DUPLICATE');
    const raw = decoded.get(file.sha256);
    need(raw && raw.length === file.bytes, 'DCAT_EXCHANGE_FILE_MISSING');
    used.add(file.sha256); files.set(file.key, { descriptor: file, raw });
  }
  need(used.size === decoded.size, 'DCAT_EXCHANGE_UNDECLARED_BLOB');
  const base = issue.baseline;
  need(UUID.test(base.correctionId ?? '') && UUID.test(base.revisionId ?? '') &&
    HASH.test(base.revisionSha256 ?? '') && HASH.test(base.documentSha256 ?? '') &&
    object(base.source), 'DCAT_EXCHANGE_BASE_INVALID');
  let prior = null, priorText = null; const revisions = new Map();
  for (const item of issue.history) {
    need(object(item) && UUID.test(item.id ?? '') && !revisions.has(item.id) &&
      HASH.test(item.sha256 ?? '') && HASH.test(item.documentSha256 ?? ''), 'DCAT_EXCHANGE_HISTORY_INVALID');
    const recordFile = files.get(item.recordKey), documentFile = files.get(item.documentKey);
    need(recordFile?.descriptor.sha256 === item.sha256 && recordFile.descriptor.bytes === item.bytes &&
      documentFile?.descriptor.sha256 === item.documentSha256 && documentFile.descriptor.bytes === item.documentBytes,
      'DCAT_EXCHANGE_REVISION_FILES');
    let record; try { record = JSON.parse(correctionExchangeText(recordFile.raw)); } catch { need(false, 'DCAT_EXCHANGE_REVISION_JSON'); }
    const documentText = correctionExchangeText(documentFile.raw), parsed = parseCorrectionDocument(documentText);
    need(parsed.root.type === 'object' && record.schema === 'stellar-forge.dcat-correction-revision.v1' &&
      record.correctionId === base.correctionId && record.id === item.id &&
      record.documentSha256 === item.documentSha256 && record.documentBytes === item.documentBytes &&
      record.previousRevisionId === (prior?.id ?? null) && record.previousRevisionSha256 === (prior?.sha256 ?? null) &&
      correctionExchangeCanonical(record.source) === correctionExchangeCanonical(base.source) &&
      record.author === item.author && record.note === item.note && record.kind === item.kind &&
      record.createdAt === item.createdAt && record.requestSha256 === item.requestSha256 &&
      Array.isArray(record.operations) && Array.isArray(record.changes), 'DCAT_EXCHANGE_REVISION_BINDING');
    if (!prior) need(record.kind === 'source' && record.operations.length === 0 &&
      item.documentSha256 === base.source.sha256 && item.documentBytes === base.source.bytes && record.changes.length === 0, 'DCAT_EXCHANGE_ORIGINAL_CHANGED');
    else if (record.kind === 'restore') {
      const target = revisions.get(record.targetRevisionId);
      need(target && target.item.documentSha256 === item.documentSha256 && record.operations.length === 0,
        'DCAT_EXCHANGE_RESTORE_CHANGED');
      const changes = [{ op: 'restore', beforeRevisionId: prior.id, targetRevisionId: target.item.id,
        beforeDocumentSha256: prior.documentSha256, beforeDocumentBytes: prior.documentBytes,
        afterDocumentSha256: target.item.documentSha256, afterDocumentBytes: target.item.documentBytes }];
      need(correctionExchangeCanonical(changes) === correctionExchangeCanonical(record.changes), 'DCAT_EXCHANGE_RESTORE_CHANGED');
    } else {
      need(record.kind === 'edit', 'DCAT_EXCHANGE_REVISION_KIND');
      const applied = record.operations.length ? applyCorrectionOperations(priorText, record.operations) : { text: priorText, changes: [] };
      need(applied.text === documentText &&
        correctionExchangeCanonical(applied.changes) === correctionExchangeCanonical(record.changes), 'DCAT_EXCHANGE_HISTORY_CHANGED');
    }
    revisions.set(item.id, { item, record, text: documentText }); prior = item; priorText = documentText;
  }
  need(prior.id === base.revisionId && prior.sha256 === base.revisionSha256 &&
    prior.documentSha256 === base.documentSha256 && prior.documentBytes === base.documentBytes, 'DCAT_EXCHANGE_BASE_CHANGED');
  return { issue, files, decoded, revisions, text: priorText };
}
export async function newCorrectionProposal(issue, { proposalId, createdAt, author }, hash = correctionExchangeHash) {
  await validateCorrectionIssue(issue, hash);
  need(UUID.test(proposalId ?? ''), 'DCAT_EXCHANGE_PROPOSAL_ID'); text(author, 160);
  return { schema: PROPOSAL_SCHEMA, proposalId, createdAt, issue,
    editions: [], draft: { author, note: '', operations: [], editor: { op: 'replace', path: '', from: '', valueText: '' } } };
}
export async function validateCorrectionProposal(value, hash = correctionExchangeHash) {
  need(object(value) && value.schema === PROPOSAL_SCHEMA && UUID.test(value.proposalId ?? '') &&
    Number.isFinite(Date.parse(value.createdAt)) && Array.isArray(value.editions) &&
    value.editions.length <= EXCHANGE_LIMITS.editions && object(value.draft), 'DCAT_EXCHANGE_PROPOSAL_INVALID');
  const source = await validateCorrectionIssue(value.issue, hash), editions = new Map();
  need(correctionExchangeBytes(correctionExchangeCanonical(value.editions)).length <= EXCHANGE_LIMITS.historyBytes,
    'DCAT_EXCHANGE_EDITION_LIMIT');
  let current = source.text, prior = null;
  for (const edition of value.editions) {
    need(object(edition) && UUID.test(edition.id ?? '') && !editions.has(edition.id) &&
      edition.previousId === (prior?.id ?? null) && edition.previousSha256 === (prior?.editionSha256 ?? null) &&
      HASH.test(edition.editionSha256 ?? '') && HASH.test(edition.documentSha256 ?? ''),
      'DCAT_EXCHANGE_EDITION_INVALID');
    attribution(edition);
    need(await hashValue(without(edition, 'editionSha256'), hash) === edition.editionSha256, 'DCAT_EXCHANGE_EDITION_HASH');
    const applied = applyCorrectionOperations(current, edition.operations), raw = correctionExchangeBytes(applied.text);
    need(raw.length <= EXCHANGE_LIMITS.fileBytes && raw.length === edition.documentBytes &&
      await hash(raw) === edition.documentSha256, 'DCAT_EXCHANGE_EDITION_CHANGED');
    current = applied.text; editions.set(edition.id, { edition, text: current }); prior = edition;
  }
  text(value.draft.author, 160, true); text(value.draft.note, 8192, true);
  need(Array.isArray(value.draft.operations) && value.draft.operations.length <= EXCHANGE_LIMITS.operations &&
    (!value.draft.editor || object(value.draft.editor)), 'DCAT_EXCHANGE_DRAFT_INVALID');
  // Unfinished literal input is retained as text; only saved editions are applicable.
  need(correctionExchangeBytes(correctionExchangeCanonical(value.draft)).length <= EXCHANGE_LIMITS.historyBytes,
    'DCAT_EXCHANGE_DRAFT_LIMIT');
  return { ...source, proposal: value, editions, currentText: current };
}
export async function saveCorrectionProposalEdition(value, input, hash = correctionExchangeHash) {
  const checked = await validateCorrectionProposal(value, hash);
  need(value.editions.length < EXCHANGE_LIMITS.editions && UUID.test(input.id ?? '') &&
    !checked.editions.has(input.id), 'DCAT_EXCHANGE_EDITION_ID'); attribution(input);
  const applied = applyCorrectionOperations(checked.currentText, input.operations), raw = correctionExchangeBytes(applied.text);
  need(raw.length <= EXCHANGE_LIMITS.fileBytes, 'DCAT_EXCHANGE_DOCUMENT_LIMIT');
  const prior = value.editions.at(-1), edition = { id: input.id, previousId: prior?.id ?? null,
    previousSha256: prior?.editionSha256 ?? null, createdAt: input.createdAt, author: input.author, note: input.note,
    operations: input.operations, documentSha256: await hash(raw), documentBytes: raw.length };
  edition.editionSha256 = await hashValue(edition, hash);
  const result = structuredClone(value); result.editions.push(edition);
  result.draft = { author: input.author, note: '', operations: [], editor: { op: 'replace', path: '', from: '', valueText: '' } };
  need(correctionExchangeBytes(correctionExchangeCanonical(result.editions)).length <= EXCHANGE_LIMITS.historyBytes,
    'DCAT_EXCHANGE_EDITION_LIMIT'); return result;
}
export function readCorrectionProposalFile(raw) {
  need(raw.length > 0 && raw.length <= EXCHANGE_LIMITS.packageBytes, 'DCAT_EXCHANGE_PACKAGE_LIMIT');
  const value = correctionExchangeText(raw);
  if (value.trimStart().startsWith('{')) {
    try { return JSON.parse(value); } catch { need(false, 'DCAT_EXCHANGE_PROPOSAL_JSON'); }
  }
  const pattern = /<script id="dcat-correction-return" type="application\/octet-stream">([A-Za-z0-9+/=\r\n]+)<\/script>/g;
  const matches = [...value.matchAll(pattern)];
  need(matches.length === 1, 'DCAT_EXCHANGE_HTML_PAYLOAD');
  try { return JSON.parse(correctionExchangeText(correctionExchangeDecode(matches[0][1].replace(/[\r\n]/g, '')))); }
  catch (error) { if (error.code) throw error; need(false, 'DCAT_EXCHANGE_PROPOSAL_JSON'); }
}
export function correctionProposalPayload(value) {
  return correctionExchangeBase64(correctionExchangeBytes(JSON.stringify(value)));
}
// Histories, rather than inferred identifier matches, prove whether an array's indices stayed fixed.
export function correctionStructuralPaths(source, history) {
  const paths = new Set(); let current = source;
  for (const entry of history) {
    if (entry.kind === 'restore') { paths.add(''); current = entry.text; continue; }
    for (const op of entry.operations ?? []) {
      const document = parseCorrectionDocument(current), tokens = correctionTokens(op.path);
      const parent = tokens.length ? findCorrectionNode(document, correctionPointer(tokens.slice(0, -1))) : null;
      if (['add', 'remove', 'move'].includes(op.op) && parent?.type === 'array')
        paths.add(correctionPointer(tokens.slice(0, -1)));
      if (op.op === 'replace') {
        const node = findCorrectionNode(document, op.path);
        if (node.type === 'object' || node.type === 'array') paths.add(op.path);
      }
      if (op.op === 'move') {
        const from = correctionTokens(op.from), origin = findCorrectionNode(document, correctionPointer(from.slice(0, -1)));
        if (origin.type === 'array') paths.add(correctionPointer(from.slice(0, -1)));
      }
      current = applyCorrectionOperations(current, [op]).text;
    }
  }
  return { paths: [...paths], text: current };
}
export function compareCorrectionProposal({ issuedText, currentText, returnedText, currentHistory, returnedHistory, choices = [] }) {
  const currentTrack = correctionStructuralPaths(issuedText, currentHistory),
    returnedTrack = correctionStructuralPaths(issuedText, returnedHistory);
  need(currentTrack.text === currentText && returnedTrack.text === returnedText, 'DCAT_EXCHANGE_COMPARISON_HISTORY');
  const atomic = new Set([...currentTrack.paths, ...returnedTrack.paths]);
  const b = parseCorrectionDocument(issuedText), c = parseCorrectionDocument(currentText), r = parseCorrectionDocument(returnedText);
  const selected = new Map();
  need(Array.isArray(choices) && choices.length <= 10000, 'DCAT_EXCHANGE_CHOICES_INVALID');
  for (const choice of choices) {
    need(object(choice) && typeof choice.path === 'string' && ['current', 'returned', 'issued'].includes(choice.choice) &&
      !selected.has(choice.path) && Object.keys(choice).every(key => ['path', 'choice'].includes(key)), 'DCAT_EXCHANGE_CHOICE_INVALID');
    correctionTokens(choice.path); selected.set(choice.path, choice.choice);
  }
  const raw = (document, node) => node ? correctionRaw(document, node) : null;
  const value = (document, node) => ({ exists: Boolean(node), type: node?.type ?? null, valueText: raw(document, node) });
  const rows = [], operations = [], consumed = new Set();
  function visit(bn, cn, rn, parts) {
    const path = correctionPointer(parts), bv = raw(b, bn), cv = raw(c, cn), rv = raw(r, rn);
    if (bv === rv || cv === rv) return;
    const allObject = bn?.type === 'object' && cn?.type === 'object' && rn?.type === 'object';
    const allArray = bn?.type === 'array' && cn?.type === 'array' && rn?.type === 'array';
    if (!atomic.has(path) && (allObject || allArray && bn.children.length === cn.children.length && bn.children.length === rn.children.length)) {
      const bm = new Map(bn.children.map(x => [x.key, x.node])), cm = new Map(cn.children.map(x => [x.key, x.node])),
        rm = new Map(rn.children.map(x => [x.key, x.node]));
      for (const key of new Set([...bm.keys(), ...cm.keys(), ...rm.keys()])) visit(bm.get(key), cm.get(key), rm.get(key), [...parts, key]);
      return;
    }
    const conflict = bv !== cv, choice = selected.get(path) ?? (conflict ? null : 'returned');
    if (selected.has(path)) consumed.add(path);
    const reason = atomic.has(path) ? (allArray ? 'array-structure-or-replacement' : 'container-replacement-or-restoration') :
      allArray ? 'array-length-changed' : !bn || !cn || !rn ? 'presence-changed' : 'value-changed';
    rows.push({ path, conflict, reason, issued: value(b, bn), current: value(c, cn), returned: value(r, rn), choice, requiresChoice: !choice });
    if (choice && choice !== 'current') {
      const target = choice === 'issued' ? bn : rn, desired = choice === 'issued' ? bv : rv;
      if (desired !== cv) operations.push(target ? { op: cn ? 'replace' : 'add', path, valueText: desired } : { op: 'remove', path });
    }
  }
  visit(b.root, c.root, r.root, []);
  need(consumed.size === selected.size, 'DCAT_EXCHANGE_CHOICE_STALE', 'A choice no longer refers to this exact comparison.');
  const complete = rows.every(x => !x.requiresChoice);
  let mergedText = complete ? currentText : null;
  if (complete) for (let offset = 0; offset < operations.length; offset += EXCHANGE_LIMITS.operations)
    mergedText = applyCorrectionOperations(mergedText, operations.slice(offset, offset + EXCHANGE_LIMITS.operations)).text;
  return { rows, operations, complete, conflictCount: rows.filter(x => x.conflict).length,
    unresolvedCount: rows.filter(x => x.requiresChoice).length, mergedText,
    arrayPolicy: 'Only retained histories with unchanged array structure permit index-wise field reconciliation. Structural edits or whole-container replacements require a complete subtree choice when both sides changed.' };
}
