// MIT. Issue, receive and reconcile original catalogue correction proposals through the existing owner.
import { resolve } from 'node:path';
import { digest, fault } from '../postgres/publisher/files.mjs';
import { sourceBytes, exportRetained } from './dcat-semantic-files.mjs';
export const correctionExchangeCliOptions = {
  'correction-exchanges': ['workspace', 'kind', 'correction', 'offset', 'limit', 'query'],
  'correction-exchange': ['workspace', 'exchange'],
  'correction-proposal': ['workspace', 'proposal'],
  'correction-issue': ['workspace', 'request', 'correction', 'revision', 'document-sha256', 'issuer', 'recipient', 'label', 'note'],
  'correction-receive': ['workspace', 'request', 'file', 'sha256'],
  'correction-reconcile': ['workspace', 'proposal', 'edition', 'expected-revision', 'document-sha256', 'choices', 'choices-sha256', 'offset', 'limit'],
  'correction-adopt': ['workspace', 'request', 'proposal', 'edition', 'expected-revision', 'document-sha256', 'choices', 'choices-sha256', 'preview-sha256', 'author', 'note'],
  'correction-exchange-export': ['workspace', 'kind', 'id', 'key', 'out'],
};
export const correctionExchangeCliUsage = [
  '  dcat correction-exchanges --workspace DIR [--kind issues|proposals|decisions --correction ID --offset 0 --limit 50 --query TEXT]',
  '  dcat correction-exchange --workspace DIR --exchange ID',
  '  dcat correction-proposal --workspace DIR --proposal ID',
  '  dcat correction-issue --workspace DIR --request UUID --correction ID --revision ID --document-sha256 HASH --issuer TEXT --recipient TEXT --label TEXT --note TEXT',
  '  dcat correction-receive --workspace DIR --request UUID --file RETURN.html|RETURN.json --sha256 HASH',
  '  dcat correction-reconcile --workspace DIR --proposal ID --edition ID --expected-revision ID --document-sha256 HASH [--choices FILE.json --choices-sha256 HASH --offset 0 --limit 50]',
  '  dcat correction-adopt --workspace DIR --request UUID --proposal ID --edition ID --expected-revision ID --document-sha256 HASH --preview-sha256 HASH [--choices FILE.json --choices-sha256 HASH] --author TEXT --note TEXT',
  '  dcat correction-exchange-export --workspace DIR --kind issue|recipient|initial-proposal|proposal|decision|file --id UUID [--key ORIGINAL_FILE_KEY] --out FILE',
  'A returned proposal never changes the author draft automatically. Inspect every comparison page and bind its preview SHA256 before adoption. See CORRECTION_EXCHANGES_AGENT.md.',
];
const required = (o, key) => {
  if (typeof o[key] !== 'string' || !o[key]) throw fault('DCAT_COMMAND_ARGUMENTS', 'Supply --' + key + '.');
  return o[key];
};
const integer = (value, fallback) => {
  if (value === undefined) return fallback;
  if (!/^(0|[1-9][0-9]*)$/.test(value) || !Number.isSafeInteger(Number(value)))
    throw fault('DCAT_COMMAND_ARGUMENTS', 'Use a nonnegative page position.');
  return Number(value);
};
async function choices(options) {
  if (options.choices === undefined) {
    if (options['choices-sha256'] !== undefined) throw fault('DCAT_COMMAND_ARGUMENTS', 'Select the choices file with its SHA256.');
    return [];
  }
  const raw = await sourceBytes(resolve(required(options, 'choices')), 33554432);
  const expected = required(options, 'choices-sha256');
  if (!/^[a-f0-9]{64}$/.test(expected) || digest(raw) !== expected) throw fault('DCAT_EXCHANGE_CHOICES_CHANGED', 'Use the exact inspected choices file.');
  let value; try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)); }
  catch { throw fault('DCAT_EXCHANGE_CHOICES_INVALID', 'Use a complete UTF-8 JSON array of explicit path choices.'); }
  if (!Array.isArray(value) || value.length > 10000) throw fault('DCAT_EXCHANGE_CHOICES_INVALID');
  return value;
}
async function selection(o) {
  return { proposalId: required(o, 'proposal'), editionId: required(o, 'edition'),
    expectedRevisionId: required(o, 'expected-revision'), expectedDocumentSha256: required(o, 'document-sha256'),
    choices: await choices(o) };
}
export async function executeDcatCorrectionExchangeCommand(project, command, options) {
  if (command === 'correction-exchanges') return project.listDcatCorrectionExchanges({
    kind: options.kind ?? 'issues', offset: integer(options.offset, 0), limit: integer(options.limit, 50),
    query: options.query ?? '', ...(options.correction ? { correctionId: options.correction } : {}) });
  if (command === 'correction-exchange') return project.dcatCorrectionExchange(required(options, 'exchange'));
  if (command === 'correction-proposal') return project.dcatCorrectionProposal(required(options, 'proposal'));
  if (command === 'correction-issue') return project.issueDcatCorrectionExchange({
    requestId: required(options, 'request'), correctionId: required(options, 'correction'),
    revisionId: required(options, 'revision'), expectedDocumentSha256: required(options, 'document-sha256'),
    issuer: required(options, 'issuer'), recipient: required(options, 'recipient'),
    label: required(options, 'label'), note: required(options, 'note') });
  if (command === 'correction-receive') return project.receiveDcatCorrectionProposal({
    requestId: required(options, 'request'), file: resolve(required(options, 'file')), expectedSha256: required(options, 'sha256') });
  if (command === 'correction-reconcile') return project.previewDcatCorrectionProposal({
    ...await selection(options), offset: integer(options.offset, 0), limit: integer(options.limit, 50) });
  if (command === 'correction-adopt') return project.applyDcatCorrectionProposal({
    ...await selection(options), requestId: required(options, 'request'),
    expectedPreviewSha256: required(options, 'preview-sha256'), author: required(options, 'author'), note: required(options, 'note') });
  if (command === 'correction-exchange-export') {
    const kind = required(options, 'kind');
    if (kind === 'file' ? options.key === undefined : options.key !== undefined)
      throw fault('DCAT_COMMAND_ARGUMENTS', 'Use --key only with kind file and the original issue UUID.');
    const selected = await project.dcatCorrectionExchangeDownload({
      kind, id: required(options, 'id'), ...(options.key === undefined ? {} : { key: options.key }) });
    const out = resolve(required(options, 'out')); await exportRetained(selected, out);
    return { kind, id: selected.id, ...(options.key === undefined ? {} : { key: options.key }),
      out, bytes: selected.bytes, sha256: selected.sha256, mediaType: selected.mediaType };
  }
  throw fault('DCAT_COMMAND_UNKNOWN', 'Choose an installed catalogue correction exchange command.');
}
