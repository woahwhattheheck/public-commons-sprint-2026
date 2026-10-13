// MIT. Complete saved review and workshare reports.
import { failure, safeURL } from './core.mjs';
import { encodeCsv } from './csv.mjs';
const escape = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const money = (cents, currency) => currency + ' ' + (cents / 100).toFixed(2);
const link = url => safeURL(url) ? '<a href="' + escape(safeURL(url)) + '">' + escape(url) + '</a>' : escape(url);
function renderWorkshare(workshare) {
  return '<section><h3>' + escape(workshare.title || 'Workshare') + '</h3><p>' + escape(workshare.partner)
    + ' · ' + escape(workshare.status) + ' · revision ' + workshare.revision + '</p><dl>'
    + ['owner', 'scope', 'deliverables', 'partnerResponsibilities', 'inputs', 'acceptance', 'availableFrom', 'deliveryDays', 'estimatedHours', 'partnerHours', 'note']
      .map(field => '<dt>' + escape(field) + '</dt><dd><pre>' + escape(workshare[field]) + '</pre></dd>').join('')
    + '</dl><p>Entered fee: ' + escape(money(workshare.feeCents, workshare.currency))
    + '. Entered costs: ' + escape(money(workshare.totals.costCents, workshare.currency))
    + '. Fee less entered costs: ' + escape(money(workshare.totals.marginBeforeLaborCents, workshare.currency)) + '.</p>'
    + '<h4>Milestones</h4><table><thead><tr><th>Delivery</th><th>Due</th><th>Amount</th><th>Acceptance</th></tr></thead><tbody>'
    + workshare.milestones.map(row => '<tr><td>' + escape(row.title) + '</td><td>' + escape(row.due)
      + '</td><td>' + escape(money(row.amountCents, workshare.currency)) + '</td><td>' + escape(row.acceptance) + '</td></tr>').join('')
    + '</tbody></table><h4>Original source context</h4><pre>' + escape(JSON.stringify(workshare.sourceContext, null, 2)) + '</pre></section>';
}
export function renderReport(data, { format = 'json' } = {}) {
  const name = 'canadabuys-' + data.workspace.id.slice(0, 12) + '-r' + data.workspace.revision;
  const report = { schema: 'starforge.canadabuys.report.v1', generatedAt: new Date().toISOString(), ...data };
  if (format === 'json') return { filename: name + '.json', mime: 'application/json; charset=utf-8', body: JSON.stringify(report, null, 2) + '\n' };
  if (format === 'csv') {
    const columns = ['noticeId', 'referenceNumber', 'solicitationNumber', 'titleEnglish', 'titleFrench', 'buyerEnglish', 'buyerFrench',
      'noticeTypeEnglish', 'sourceStatus', 'sourceClosingTime', 'closingOffset', 'closingUTC', 'presentInLatestOpenFeed',
      'sourceId', 'entryId', 'rowNumber', 'disposition', 'shortlisted', 'owner', 'nextAction', 'note', 'qualification',
      'workshareIds', 'noticeURL', 'documents', 'descriptionEnglish', 'descriptionFrench'];
    const rows = data.notices.map(notice => {
      const s = notice.summary, review = notice.review;
      return { noticeId: notice.id, referenceNumber: s.referenceNumber, solicitationNumber: s.solicitationNumber,
        titleEnglish: s.title.en, titleFrench: s.title.fr, buyerEnglish: s.buyer.en, buyerFrench: s.buyer.fr,
        noticeTypeEnglish: s.noticeType.en, sourceStatus: s.status.en, sourceClosingTime: s.closing.raw,
        closingOffset: s.closing.offset, closingUTC: s.closing.utc, presentInLatestOpenFeed: notice.presentInLatestOpenFeed,
        sourceId: notice.currentEntry.sourceId, entryId: notice.currentEntry.id, rowNumber: notice.currentEntry.rowNumber,
        disposition: review.disposition, shortlisted: review.shortlisted, owner: review.owner, nextAction: review.nextAction, note: review.note,
        qualification: JSON.stringify(review.qualification), workshareIds: data.workshares.filter(workshare => workshare.noticeId === notice.id).map(workshare => workshare.id).join(';'),
        noticeURL: s.noticeURL, documents: JSON.stringify(s.documents), descriptionEnglish: s.description.en, descriptionFrench: s.description.fr };
    });
    return { filename: name + '.csv', mime: 'text/csv; charset=utf-8', body: encodeCsv(columns, rows, { spreadsheetSafe: true }) };
  }
  if (format !== 'html') throw failure('INVALID_REPORT_FORMAT', 'Choose json, csv or html');
  const sections = data.notices.map(notice => {
    const s = notice.summary;
    return '<article><h2>' + escape(s.title.en || s.title.fr) + '</h2><p>' + escape(s.solicitationNumber)
      + ' · ' + escape(s.buyer.en) + ' · ' + escape(s.noticeType.en) + ' · ' + escape(s.status.en) + '</p>'
      + '<p>Closing time: ' + escape(s.closing.raw) + ' (source ' + escape(s.closing.offset) + '); UTC ' + escape(s.closing.utc || 'unavailable') + '</p>'
      + '<p>Present in latest open feed: ' + escape(notice.presentInLatestOpenFeed === null ? 'no open feed captured' : notice.presentInLatestOpenFeed) + '</p>'
      + '<h3>English description</h3><pre>' + escape(s.description.en) + '</pre><h3>Description française</h3><pre>' + escape(s.description.fr) + '</pre>'
      + '<h3>Original links</h3><ul>' + s.documents.map(document => '<li>' + escape(document.title) + ': ' + link(document.url) + '</li>').join('') + '</ul>'
      + '<h3>Review</h3><pre>' + escape(JSON.stringify(notice.review, null, 2)) + '</pre>'
      + '<h3>Original editions</h3>' + notice.history.map(entry => '<details><summary>' + escape(entry.sourceId) + ' · record ' + entry.rowNumber
        + ' · ' + escape(entry.rowSha256) + '</summary><pre>' + escape(JSON.stringify(entry.row, null, 2)) + '</pre></details>').join('')
      + '<h3>Award candidates and supply instruments</h3><pre>' + escape(JSON.stringify({ awardGroups: notice.awardGroups || [], awards: notice.awards, supplyArrangements: notice.supplyArrangements }, null, 2)) + '</pre>'
      + data.workshares.filter(workshare => workshare.noticeId === notice.id).map(renderWorkshare).join('') + '</article>';
  }).join('');
  const body = '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<title>CanadaBuys procurement review</title><style>body{font:15px/1.5 system-ui,sans-serif;color:#191919;background:#fff;max-width:1120px;margin:36px auto;padding:0 24px}'
    + 'h1,h2,h3{line-height:1.2}article{border-top:2px solid #333;margin-top:30px;padding-top:20px}section{border:1px solid #999;padding:16px;margin:20px 0}'
    + 'pre{font:13px/1.5 ui-monospace,monospace;white-space:pre-wrap;overflow-wrap:anywhere}table{border-collapse:collapse;width:100%}th,td{border:1px solid #aaa;text-align:left;padding:8px}'
    + 'dt{font-weight:650}dd{margin:0 0 12px}a{color:inherit}details{margin:10px 0}@media print{body{margin:0}article{break-before:page}details>pre{display:block}}</style>'
    + '<h1>' + escape(data.workspace.title) + '</h1><p>Workspace ' + escape(data.workspace.id) + ' · revision ' + data.workspace.revision
    + ' · report ' + escape(report.generatedAt) + '</p><p>' + data.notices.length + ' selected notices · ' + data.workshares.length
    + ' saved workshares. Original currency, tax-inclusive award amounts and cumulative contract values remain separate.</p>' + sections
    + '<h2>Retained sources</h2><pre>' + escape(JSON.stringify(data.sources, null, 2)) + '</pre></html>';
  return { filename: name + '.html', mime: 'text/html; charset=utf-8', body };
}
