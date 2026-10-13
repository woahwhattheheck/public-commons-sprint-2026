// MIT. Self-contained recipient document built from the maintained exact editor.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { validateCorrectionProposal, correctionProposalPayload } from './public/dcat-correction-exchange.mjs';
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const exactNames = ['parseCorrectionDocument', 'findCorrectionNode', 'correctionRaw', 'correctionTokens',
  'correctionPointer', 'applyCorrectionOperations', 'inspectCorrectionDocument'];
const exchangeNames = ['ISSUE_SCHEMA', 'PROPOSAL_SCHEMA', 'EXCHANGE_LIMITS', 'correctionExchangeCanonical',
  'correctionExchangeBytes', 'correctionExchangeText', 'correctionExchangeBase64', 'correctionExchangeDecode',
  'correctionExchangeHash', 'validateCorrectionIssue', 'newCorrectionProposal', 'validateCorrectionProposal',
  'saveCorrectionProposalEdition', 'readCorrectionProposalFile', 'correctionProposalPayload'];
function isolated(source, names, prelude = '') {
  const body = source.replace(/^import[\s\S]*?;\s*\n/gm, '').replace(/^export /gm, '');
  return '(() => {\n' + prelude + '\n' + body + '\nreturn {' + names.join(',') + '};\n})()';
}
export async function renderDcatCorrectionRecipient({ proposal } = {}) {
  await validateCorrectionProposal(proposal);
  const [exact, exchange, app, style] = await Promise.all([
    readFile(new URL('./public/dcat-correction-json.mjs', import.meta.url), 'utf8'),
    readFile(new URL('./public/dcat-correction-exchange.mjs', import.meta.url), 'utf8'),
    readFile(new URL('./public/dcat-correction-recipient.mjs', import.meta.url), 'utf8'),
    readFile(new URL('./public/dcat-correction-recipient.css', import.meta.url), 'utf8'),
  ]);
  const script = ('const Exact = ' + isolated(exact, exactNames) + ';\nconst Exchange = ' +
    isolated(exchange, exchangeNames, 'const {' + exactNames.join(',') + '} = Exact;') + ';\n' +
    app.replace(/^import[\s\S]*?;\s*\n/gm, '').replace(/^export /gm, '')).replace(/<\/script/gi, '<\\/script');
  const scriptHash = createHash('sha256').update(script).digest('base64');
  const styleHash = createHash('sha256').update(style).digest('base64');
  const policy = "default-src 'none'; script-src 'sha256-" + scriptHash + "'; style-src 'sha256-" +
    styleHash + "'; img-src data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
  return '<!doctype html>\n<html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta http-equiv="Content-Security-Policy" content="' + escape(policy) + '">' +
    '<meta name="referrer" content="no-referrer"><title>' + escape(proposal.issue.label) +
    ' · Catalogue corrections</title><style>' + style + '</style></head><body>' +
    '<header><h1>Catalogue corrections</h1><p>Complete source, attributed recipient editions and a portable return.</p></header>' +
    '<div id="recipient-notice" role="status" aria-live="polite"></div><main id="recipient-app">' +
    '<p>Opening the complete retained catalogue and its original history…</p></main>' +
    '<script id="dcat-correction-return" type="application/octet-stream">' + correctionProposalPayload(proposal) +
    '</script><script>' + script + '</script></body></html>\n';
}
