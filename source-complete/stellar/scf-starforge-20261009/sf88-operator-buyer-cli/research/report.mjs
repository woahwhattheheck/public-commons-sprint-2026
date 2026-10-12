/** Standalone reports and bibliography exports for retained OpenAlex editions. */
import {withResearchDecisions} from './analysis.mjs';

const label = value => value === null || value === undefined ? '' : String(value);
const html = value => label(value).replace(/[&<>"']/g,char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const list = value => Array.isArray(value) ? value : [];
const oneLine = value => label(value).replace(/[\r\n\u2028\u2029]+/g,' ');
const json = value => JSON.stringify(value,null,2) + '\n';
const integerFormat = new Intl.NumberFormat('en-US');
const count = value => typeof value === 'number' && Number.isFinite(value) ? integerFormat.format(value) : 'Not supplied';
const percent = value => typeof value === 'number' && Number.isFinite(value) ? (value*100).toFixed(1) + '%' : '';
const nameOf = item => item.name ?? item.rawName ?? item.id ?? 'Name not supplied';
const names = values => list(values).map(nameOf);
const ids = values => list(values).map(value => value.id).filter(Boolean);

function httpUrl(value) {
  try {const url = new URL(value);return ['https:','http:'].includes(url.protocol) ? url.href : null;} catch {return null;}
}
function link(url,value) {
  const safe = httpUrl(url);
  return safe ? '<a href="' + html(safe) + '" rel="noopener noreferrer">' + html(value) + '</a>' : html(value);
}
function doiValue(row) {return label(row.doi).replace(/^https?:\/\/(?:dx\.)?doi\.org\//i,'');}
function doiUrl(row) {
  const value = doiValue(row);
  return /^10\.[0-9]{4,9}\//.test(value) ? 'https://doi.org/' + encodeURIComponent(value).replace(/%2F/gi,'/') : null;
}
function anchor(row) {return 'record-' + row.shortId;}

/** RFC 4180 output, with spreadsheet formula prefixes escaped for text cells. */
function csvCell(value) {
  let string = value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (typeof value === 'string' && (/^[\u0000-\u0020]*[=+\-@]/.test(string) || /^[\t\r\n]/.test(string))) string = "'" + string;
  return '"' + string.replace(/"/g,'""') + '"';
}
function csv(columns,rows) {
  return [columns.map(column => csvCell(column.label)).join(','),...rows.map(row => columns.map(column => csvCell(column.value(row))).join(','))].join('\r\n') + '\r\n';
}
const column = (name,key = name) => ({label:name,value:row => row[key]});
const RECORD_COLUMNS = [
  column('openalex_id','id'),column('provider_id','providerId'),column('title'),column('doi'),
  column('publication_year','publicationYear'),column('publication_date','publicationDate'),column('type'),column('language'),
  column('cited_by_count','citedByCount'),column('provider_works_count','providerWorksCount'),
  {label:'authors',value:row => names(row.authors)},{label:'author_ids',value:row => ids(row.authors)},
  {label:'institutions',value:row => names(row.institutions)},{label:'institution_ids',value:row => ids(row.institutions)},
  {label:'primary_source',value:row => row.source?.name},{label:'primary_source_id',value:row => row.source?.id},
  {label:'topics',value:row => names(row.topics)},{label:'topic_ids',value:row => ids(row.topics)},
  {label:'primary_topic',value:row => row.primaryTopic?.name},{label:'primary_topic_id',value:row => row.primaryTopic?.id},
  {label:'funders',value:row => names(row.funders)},{label:'funder_ids',value:row => ids(row.funders)},
  {label:'award_ids',value:row => ids(row.awards)},{label:'keywords',value:row => names(row.keywords)},
  column('is_open_access','isOpenAccess'),column('open_access_status','oaStatus'),column('open_access_url','oaUrl'),
  column('is_retracted','isRetracted'),column('updated_date','updatedDate'),
  {label:'volume',value:row => row.biblio.volume},{label:'issue',value:row => row.biblio.issue},
  {label:'first_page',value:row => row.biblio.firstPage},{label:'last_page',value:row => row.biblio.lastPage},
  {label:'review_status',value:row => row.decision.status},{label:'review_notes',value:row => row.decision.notes},
  {label:'review_tags',value:row => row.decision.tags},{label:'review_updated_at',value:row => row.decision.updatedAt},
  column('authorships_at_provider_cap','authorshipsAtCap'),column('unresolved_author_occurrences','unresolvedAuthors'),
  column('unresolved_institution_occurrences','unresolvedInstitutions'),column('input_index','inputIndex')
];
const GROUP_COLUMNS = [
  column('id'),column('name'),column('record_count','recordCount'),column('work_count','workCount'),
  column('included_record_count','includedRecordCount'),column('included_work_count','includedWorkCount'),column('share_of_retained_records','shareOfRetainedRecords'),
  column('citations_received','citationsReceived'),column('records_with_citation_count','citationRecords'),
  column('country_code','countryCode'),column('type'),column('ror'),column('orcid'),
  {label:'subfield_id',value:row => row.subfield?.id},{label:'subfield_name',value:row => row.subfield?.display_name},
  {label:'field_id',value:row => row.field?.id},{label:'field_name',value:row => row.field?.display_name},
  {label:'domain_id',value:row => row.domain?.id},{label:'domain_name',value:row => row.domain?.display_name},
  column('overlapping'),column('unit'),column('work_ids','workIds'),column('record_ids','recordIds')
];

function tex(value) {
  const escapes = {'\\':'\\textbackslash{}','{':'\\{','}':'\\}','%':'\\%','&':'\\&','_':'\\_','#':'\\#','$':'\\$','~':'\\textasciitilde{}','^':'\\textasciicircum{}'};
  return oneLine(value).replace(/[\\{}%&_#$~^]/g,char => escapes[char]);
}
function bibliographyType(row) {
  return ({article:'article',review:'article',book:'book','book-chapter':'incollection','proceedings-article':'inproceedings',dissertation:'phdthesis',report:'techreport'})[row.type] ?? 'misc';
}
function bibtex(rows) {
  return rows.map(row => {
    const type = bibliographyType(row),fields = [];
    const add = (key,value,{escaped = false} = {}) => {if (value !== null && value !== undefined && value !== '') fields.push('  ' + key + ' = {' + (escaped ? value : tex(value)) + '}');};
    add('title',row.title);
    const authorNames = row.authors.map(author => author.name ?? author.rawName).filter(Boolean);
    if (authorNames.length) add('author',authorNames.map(name => '{' + tex(name) + '}').join(' and '),{escaped:true});
    add('year',row.publicationYear);add('doi',doiValue(row));add('url',doiUrl(row) ?? httpUrl(row.landingPageUrl) ?? row.id);
    if (['article','incollection','inproceedings'].includes(type)) add(type === 'article' ? 'journal' : 'booktitle',type === 'article' ? row.source?.name : row.containerTitle);
    add('volume',row.biblio.volume);add('number',row.biblio.issue);
    const pages = row.biblio.firstPage && row.biblio.lastPage && row.biblio.firstPage !== row.biblio.lastPage ? row.biblio.firstPage + '--' + row.biblio.lastPage : row.biblio.firstPage ?? row.biblio.lastPage;
    add('pages',pages);add('language',row.language);
    add('note','OpenAlex ' + row.shortId + '; review: ' + row.decision.status + (row.isRetracted === true ? '; provider marks retracted' : ''));
    return '@' + type + '{OpenAlex_' + row.shortId + ',\n' + fields.join(',\n') + '\n}';
  }).join('\n\n') + (rows.length ? '\n' : '');
}
function ris(rows) {
  const types = {article:'JOUR',review:'JOUR',book:'BOOK','book-chapter':'CHAP','proceedings-article':'CPAPER',dissertation:'THES',report:'RPRT',dataset:'DATA'};
  return rows.map(row => {
    const fields = [];
    const add = (tag,value) => {if (value !== null && value !== undefined && value !== '') fields.push(tag + '  - ' + oneLine(value));};
    add('TY',types[row.type] ?? 'GEN');add('ID',row.id);add('TI',row.title);
    for (const author of row.authors) add('AU',author.name ?? author.rawName);
    add('PY',row.publicationYear);add('DA',row.publicationDate?.replace(/-/g,'/'));add('T2',row.source?.name);
    add('VL',row.biblio.volume);add('IS',row.biblio.issue);add('SP',row.biblio.firstPage);add('EP',row.biblio.lastPage);
    add('DO',doiValue(row));add('UR',doiUrl(row) ?? httpUrl(row.landingPageUrl) ?? row.id);add('LA',row.language);
    for (const keyword of row.keywords) add('KW',keyword.name);
    for (const tag of row.decision.tags) add('KW',tag);
    add('N1','OpenAlex ' + row.shortId + '; review: ' + row.decision.status + (row.isRetracted === true ? '; provider marks retracted' : ''));
    if (row.decision.notes) add('N1',row.decision.notes);
    fields.push('ER  - ');
    return fields.join('\r\n');
  }).join('\r\n\r\n') + (rows.length ? '\r\n' : '');
}

/** Deferred deterministic serializers. Each file is rendered only when requested. */
export function researchExportPlan(analysis, {title = 'Research edition',query = null,coverage = null,decisions,comparison = null} = {}) {
  const view = withResearchDecisions(analysis,decisions);
  const rows = view.tables.records,selected = rows.filter(row => row.decision.status === 'include');
  const files = {
    'research-analysis.json':() => json({title,query,coverage,analysis:view,...(comparison ? {comparison} : {})}),
    'records.csv':() => csv(RECORD_COLUMNS,rows),
    'selected-records.csv':() => csv(RECORD_COLUMNS,selected),
    'review-decisions.csv':() => csv([column('openalex_id','id'),{label:'status',value:row => row.decision.status},{label:'notes',value:row => row.decision.notes},{label:'tags',value:row => row.decision.tags},{label:'updated_at',value:row => row.decision.updatedAt}],rows),
    'duplicate-occurrences.csv':() => csv([column('id'),column('input_index','index'),column('kept_input_index','keptIndex'),column('conflicting'),column('changed_fields','changedFields')],view.identity.duplicateOccurrences),
    'unidentified-records.csv':() => csv([column('input_index','index'),column('provider_id','providedId'),column('title'),column('reason')],view.identity.unidentifiedRecords),
    'field-coverage.csv':() => csv([column('field'),column('present'),column('missing'),column('null_values','nullValues'),column('empty_arrays','emptyArrays')],view.tables.fieldCoverage)
  };
  for (const [name,table] of Object.entries(view.tables)) if (!['records','fieldCoverage','decisions'].includes(name)) files[name.replace(/[A-Z]/g,char => '-' + char.toLowerCase()) + '.csv'] = () => csv(GROUP_COLUMNS,table);
  if (view.entity === 'works') {
    files['references.bib'] = () => bibtex(rows);files['references.ris'] = () => ris(rows);
    files['selected-references.bib'] = () => bibtex(selected);files['selected-references.ris'] = () => ris(selected);
  }
  if (comparison) {
    files['edition-comparison.json'] = () => json(comparison);
    files['edition-added.csv'] = () => csv(RECORD_COLUMNS,comparison.added);
    files['edition-removed.csv'] = () => csv(RECORD_COLUMNS,comparison.removed);
    files['edition-changed.csv'] = () => csv([column('openalex_id','id'),column('title'),column('changed_fields','changedFields')],comparison.changed);
  }
  files['report.html'] = () => renderResearchReport({title,query,coverage,analysis:view,comparison});
  files['README.txt'] = () => [
    title,'','Entity: ' + view.entity,'Identified records: ' + view.counts.uniqueRecords,
    'Received occurrences: ' + view.counts.recordsReceived,'Retained query coverage: ' + (coverage?.state ?? 'UNSPECIFIED'),
    'Included review decisions: ' + selected.length,'',
    'records.csv includes all identified records; selected files include only status=include.',
    'Each named group CSV carries its exact member IDs and denominator. Groups can overlap.',
    'CSV text cells with spreadsheet formula prefixes receive a leading apostrophe. Exact text remains in research-analysis.json.',
    'BibTeX and RIS use supplied names and bibliographic fields. Missing values are omitted.',
    'The original provider response bytes, query identity and page receipts remain with the originating edition.',
    '',...Object.values(view.methods).filter(value => typeof value === 'string'),'',
    'Source references:',...view.methods.references,''
  ].join('\n');
  return files;
}

/** Complete in-memory bundle for callers that explicitly need all files together. */
export function researchExports(analysis, options) {
  return Object.fromEntries(Object.entries(researchExportPlan(analysis,options)).map(([name,render]) => [name,render()]));
}

function table(headers,body,{className = '',caption = ''} = {}) {
  return '<div class="table-wrap"><table' + (className ? ' class="' + html(className) + '"' : '') + '>' + (caption ? '<caption>' + html(caption) + '</caption>' : '') + '<thead><tr>' + headers.map(value => '<th scope="col">' + html(value) + '</th>').join('') + '</tr></thead><tbody>' + (body.length ? body.join('') : '<tr><td colspan="' + headers.length + '" class="muted">No retained records in this table.</td></tr>') + '</tbody></table></div>';
}
const cells = values => '<tr>' + values.map(value => '<td>' + value + '</td>').join('') + '</tr>';
function recordLinks(ids) {
  return '<details><summary>' + count(ids.length) + ' records</summary><div class="record-links">' + ids.map(id => '<a href="#record-' + html(id.slice(id.lastIndexOf('/') + 1)) + '">' + html(id.slice(id.lastIndexOf('/') + 1)) + '</a>').join(' ') + '</div></details>';
}
function groupSection(id,title,rows,note) {
  return '<section id="' + html(id) + '"><h3>' + html(title) + ' <span class="muted">(' + count(rows.length) + ')</span></h3><p class="table-note">' + html(note) + '</p><details' + (rows.length <= 12 ? ' open' : '') + '><summary>View all groups</summary>' + table(['Group','Records','Share of cohort','Included records','Citations of retained works','Membership'],rows.map(row => cells([
    link(row.id,row.name ?? row.id),count(row.recordCount),percent(row.shareOfRetainedRecords),
    count(row.includedRecordCount ?? row.includedWorkCount),
    row.unit !== 'works' ? '—' : row.citationsReceived === null || row.citationRecords === 0 ? 'Not supplied' : count(row.citationsReceived) + '<span class="muted"> across ' + count(row.citationRecords) + ' records</span>',
    recordLinks(row.recordIds ?? row.workIds ?? [])
  ]))) + '</details></section>';
}
function cohortRow(row,entity = 'works') {
  const search = [row.shortId,row.title,row.doi,...names(row.authors),...names(row.institutions),...names(row.topics),...names(row.funders),row.decision.notes,...row.decision.tags].filter(Boolean).join(' ').toLowerCase();
  const authors = names(row.authors);
  const authorCell = authors.length ? '<details><summary>' + html(authors.slice(0,3).join('; ')) + (authors.length > 3 ? ' +' + (authors.length-3) : '') + '</summary>' + row.authors.map(author => '<div>' + link(author.id,author.name ?? author.rawName ?? 'Name not supplied') + '</div>').join('') + '</details>' : '<span class="muted">Not supplied</span>';
  const bibliography = [row.source?.name,row.biblio.volume ? 'vol. ' + row.biblio.volume : null,row.biblio.issue ? 'no. ' + row.biblio.issue : null,row.biblio.firstPage ? 'p. ' + row.biblio.firstPage + (row.biblio.lastPage && row.biblio.lastPage !== row.biblio.firstPage ? '–' + row.biblio.lastPage : '') : null].filter(Boolean).join(' · ');
  const titleCell = link(row.id,row.title ?? row.shortId) + '<div class="record-id">' + html(row.shortId) + (row.doi ? ' · ' + link(doiUrl(row),row.doi) : '') + '</div>' + (bibliography ? '<div class="muted">' + html(bibliography) + '</div>' : '') + (row.isRetracted === true ? '<strong class="record-flag">Provider marks retracted</strong>' : '');
  const review = '<span class="tag">' + html(row.decision.status) + '</span>' + (row.decision.tags.length ? '<div class="muted">' + html(row.decision.tags.join(', ')) + '</div>' : '') + (row.decision.notes ? '<details><summary>Review note</summary><p class="notes">' + html(row.decision.notes) + '</p></details>' : '');
  if (entity !== 'works') return '<tr id="' + html(anchor(row)) + '" data-cohort-row data-search="' + html(search) + '" data-decision="' + html(row.decision.status) + '"><td>' + titleCell + '</td><td>' + html(row.type ?? 'Not supplied') + '</td><td>' + html(row.countryCode ?? 'Not supplied') + '</td><td class="numeric">' + count(row.providerWorksCount) + '</td><td class="numeric">' + count(row.citedByCount) + '</td><td>' + review + '</td></tr>';
  return '<tr id="' + html(anchor(row)) + '" data-cohort-row data-search="' + html(search) + '" data-decision="' + html(row.decision.status) + '"><td>' + titleCell + '</td><td>' + html(row.publicationYear ?? 'Not supplied') + '</td><td>' + authorCell + '</td><td class="numeric">' + count(row.citedByCount) + '</td><td>' + html(row.oaStatus ?? 'Not supplied') + '</td><td>' + review + '</td></tr>';
}
function comparisonSection(comparison) {
  if (!comparison) return '';
  const compact = rows => table(['OpenAlex ID','Title','Year'],rows.map(row => cells([link(row.id,row.shortId),html(row.title ?? ''),html(row.publicationYear ?? 'Not supplied')])));
  return '<section id="comparison"><h2>Edition changes</h2><p>' + count(comparison.counts.added) + ' added, ' + count(comparison.counts.removed) + ' removed, ' + count(comparison.counts.changed) + ' changed and ' + count(comparison.counts.unchanged) + ' unchanged identified records.</p><p class="table-note">' + html(comparison.method) + '</p><details><summary>Added records</summary>' + compact(comparison.added) + '</details><details><summary>Removed records</summary>' + compact(comparison.removed) + '</details><details><summary>Changed metadata</summary>' + table(['Record','Changed fields','Retained views'],comparison.changed.map(change => cells([
    link(change.id,change.title ?? change.id),html(change.changedFields.join(', ')),
    '<details><summary>Before and after</summary><pre>' + html(json({before:change.before,after:change.after})) + '</pre></details>'
  ]))) + '</details></section>';
}

/** Full standalone HTML, with no external assets, scripts, fonts, or network calls. */
export function renderResearchReport({title = 'Research edition',query = null,coverage = null,analysis,comparison = null} = {}) {
  if (!analysis?.tables?.records) throw new TypeError('A research analysis is required.');
  const {counts,tables} = analysis;
  const state = coverage?.state ?? 'UNSPECIFIED';
  const reviewed = tables.records.filter(row => row.decision.status !== 'undecided' || row.decision.notes || row.decision.tags.length);
  const intro = [
    '<div class="metric"><strong>' + count(counts.uniqueRecords) + '</strong><span>Distinct ' + html(analysis.entity) + '</span></div>',
    '<div class="metric"><strong>' + count(counts.included) + '</strong><span>Included in review</span></div>',
    '<div class="metric"><strong>' + count(counts.recordsReceived) + '</strong><span>Received occurrences</span></div>',
    '<div class="metric"><strong>' + count(analysis.entity === 'works' ? counts.citationCountSum : counts.citationRecords) + '</strong><span>' + (analysis.entity === 'works' ? 'Supplied citations across ' + count(counts.citationRecords) + ' records' : 'Entities with supplied citation counts') + '</span></div>'
  ].join('');
  const overlap = 'Distinct retained works per group; groups overlap. Shares use the identified cohort as denominator.';
  const single = 'Each retained work contributes to at most one group. Unavailable classifications stay explicit.';
  const groups = (analysis.entity === 'works' ? [
    groupSection('authors','Authors',tables.authors,overlap),
    groupSection('institutions','Institutions',tables.institutions,overlap),
    groupSection('topics','Topics',tables.topics,overlap),
    groupSection('primary-topics','Primary topics',tables.primaryTopics,single),
    groupSection('funders','Funders',tables.funders,overlap + ' Counts represent works, with no grant-value estimate.'),
    groupSection('sources','Primary sources',tables.sources,single),
    groupSection('years','Publication years',tables.years,single),
    groupSection('types','Record types',tables.types,'Distinct retained entities per supplied type.'),
    groupSection('languages','Metadata languages',tables.languages,single),
    groupSection('open-access','Open access status',tables.openAccess,single),
    groupSection('countries','Affiliation countries',tables.countries,analysis.entity === 'works' ? overlap : 'Distinct retained entities per supplied country.')
  ] : [groupSection('types','Entity types',tables.types,'Distinct retained entities per supplied type.'),groupSection('countries','Entity countries',tables.countries,'Distinct retained entities per supplied country.')]).join('');
  const metadata = {query,coverage,entity:analysis.entity,identityPolicy:analysis.identity.duplicatePolicy};
  const reviewTable = table(['Record','Decision','Tags','Notes','Updated'],reviewed.map(row => cells([
    '<a href="#' + html(anchor(row)) + '">' + html(row.title ?? row.shortId) + '</a>',
    html(row.decision.status),html(row.decision.tags.join(', ')),'<span class="notes">' + html(row.decision.notes) + '</span>',html(row.decision.updatedAt ?? '')
  ])));
  const quality = table(['Field','Present','Missing','Explicit null','Empty array'],tables.fieldCoverage.map(row => cells([html(row.field),count(row.present),count(row.missing),count(row.nullValues),count(row.emptyArrays)])));
  const duplicateRows = analysis.identity.duplicateOccurrences.map(row => cells([link(row.id,row.id.split('/').pop()),count(row.index),count(row.keptIndex),row.conflicting ? html(row.changedFields.join(', ')) : 'Same retained metadata']));
  return '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>' + html(title) + '</title><style>' +
    ':root{font-family:Arial,Helvetica,sans-serif;color:#202124;background:#fff;font-size:14px;line-height:1.5}*{box-sizing:border-box}body{margin:0}header,main,footer{max-width:1480px;margin:auto;padding:24px 32px}header{border-bottom:2px solid #303236}h1{font-size:30px;line-height:1.2;margin:8px 0 12px}h2{font-size:22px;margin:0 0 12px}h3{font-size:17px;margin:0 0 6px}p{max-width:110ch}a{color:inherit;text-underline-offset:3px;overflow-wrap:anywhere}nav{display:flex;gap:18px;flex-wrap:wrap;margin-top:18px}.eyebrow{font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}.muted,.table-note{color:#61656b}.table-note{font-size:13px;margin:4px 0 12px}.status,.tag{border:1px solid #a5a8ac;padding:2px 7px;display:inline-block;font-size:12px}.metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:0;border:1px solid #b7b9bc;margin:22px 0}.metric{padding:16px;border-right:1px solid #b7b9bc;display:flex;flex-direction:column}.metric:last-child{border:0}.metric strong{font-size:25px;font-weight:600}.metric span{color:#61656b;font-size:12px}section{margin:0 0 30px;padding-top:10px}.table-wrap{overflow:auto;border:1px solid #c3c5c7}table{border-collapse:collapse;width:100%;font-size:13px}th,td{text-align:left;padding:9px 11px;border-bottom:1px solid #d8dadd;vertical-align:top}th{background:#f0f1f2;font-weight:600;white-space:nowrap}tbody tr:last-child td{border-bottom:0}tbody tr:target{outline:2px solid #303236;outline-offset:-2px}.numeric{text-align:right;font-variant-numeric:tabular-nums}.record-id{font-size:11px;color:#62666b;margin-top:4px}.record-flag{display:block;font-size:12px;margin-top:6px}.notes{white-space:pre-wrap;overflow-wrap:anywhere}summary{cursor:pointer;margin:4px 0 8px}details>details{margin-left:12px}pre{max-height:520px;overflow:auto;background:#f5f5f5;border:1px solid #ccc;padding:12px;font-size:12px;white-space:pre-wrap;overflow-wrap:anywhere}.toolbar{display:flex;gap:12px;align-items:end;flex-wrap:wrap;margin:16px 0}.toolbar label{display:flex;flex-direction:column;gap:4px;font-size:12px}.toolbar input,.toolbar select,button{font:inherit;padding:7px 9px;border:1px solid #8b8f94;border-radius:2px;background:#fff;color:inherit}.toolbar input{min-width:260px}button{cursor:pointer}.record-links{display:flex;flex-wrap:wrap;gap:5px;max-width:260px}.record-links a{font-size:11px}.cohort td:first-child{min-width:260px;max-width:550px}.cohort td:nth-child(3){min-width:200px}.cohort td:last-child{min-width:130px}.scope{padding:12px 15px;border-left:3px solid #5d6167;background:#f5f5f5}footer{border-top:1px solid #b7b9bc;font-size:12px}.hidden{display:none!important}@media(max-width:760px){header,main,footer{padding:18px}.metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.metric{border-bottom:1px solid #b7b9bc}h1{font-size:25px}}@media print{header,main,footer{max-width:none;padding:12px}nav,.toolbar,button{display:none!important}.table-wrap{overflow:visible}table{font-size:9px}th,td{padding:4px}pre{max-height:none}details{display:block}.hidden{display:table-row!important}h2,h3{break-after:avoid}tr{break-inside:avoid}a{text-decoration:none}.metrics{break-inside:avoid}}' +
    '</style></head><body><header><div class="eyebrow">Research workspace / OpenAlex</div><h1>' + html(title) + '</h1><p><span class="status">' + html(state) + '</span> · ' + html(query?.label ?? query?.id ?? 'Retained edition') + '</p><nav aria-label="Report sections"><a href="#cohort">Cohort</a><a href="#summaries">Group summaries</a><a href="#review">Review decisions</a>' + (comparison ? '<a href="#comparison">Edition changes</a>' : '') + '<a href="#coverage">Query and coverage</a><a href="#methods">Methods</a></nav></header><main>' +
    '<div class="metrics">' + intro + '</div><p class="scope">This report describes ' + count(counts.uniqueRecords) + ' identified ' + html(analysis.entity) + ' retained in the edition. Provider-reported query total: ' + count(coverage?.totalReported) + '. Coverage: ' + html(state) + (coverage?.reason ? ' — ' + html(coverage.reason) : '') + '.</p>' +
    '<section id="cohort"><h2>Retained cohort</h2><p>' + count(counts.included) + ' included, ' + count(counts.excluded) + ' excluded and ' + count(counts.undecided) + ' undecided. ' + count(counts.duplicates) + ' duplicate occurrences and ' + count(counts.unidentifiedRecords) + ' unidentified records are listed separately.</p>' +
    '<div class="toolbar"><label>Find records<input id="cohort-search" type="search" placeholder="Title, ID, author, institution or review note"></label><label>Review status<select id="cohort-decision"><option value="">All records</option value="include">Include</option><option value="exclude">Exclude</option><option value="undecided">Undecided</option></select></label><button id="print-report" type="button">Print report</button><span id="visible-count" role="status" aria-live="polite">' + count(tables.records.length) + ' visible</span></div>' +
    table(analysis.entity === 'works' ? ['Record','Year','Authors','Citations','Access','Review'] : ['Entity','Type','Country','Provider works count','Provider citation count','Review'],tables.records.map(row => cohortRow(row,analysis.entity)),{className:'cohort'}) + '</section>' +
    '<section id="summaries"><h2>Group summaries</h2><p class="table-note">' + html(analysis.methods.memberships) + '</p>' + groups + '</section>' +
    '<section id="review"><h2>Review decisions</h2><p>Selected bibliography files contain include decisions. Notes and tags retain the workspace’s saved review text.</p>' + reviewTable + '</section>' +
    comparisonSection(comparison) +
    '<section id="coverage"><h2>Query and retrieval coverage</h2><pre>' + html(json(metadata)) + '</pre><h3>Field coverage in identified records</h3>' + quality +
    '<p class="table-note">' + count(counts.authorshipsAtCap) + ' records have at least 100 returned authorships, the documented provider cap. ' + count(counts.unresolvedAuthorOccurrences) + ' author references and ' + count(counts.unresolvedInstitutionOccurrences) + ' institution references have no usable OpenAlex identifier.</p>' +
    '<details><summary>Duplicate occurrences (' + count(counts.duplicates) + ')</summary>' + table(['ID','Occurrence index','Retained index','Difference'],duplicateRows) + '</details>' +
    '<details><summary>Unidentified records (' + count(counts.unidentifiedRecords) + ')</summary>' + table(['Occurrence index','Supplied ID','Title','Reason'],analysis.identity.unidentifiedRecords.map(row => cells([count(row.index),html(row.providedId ?? ''),html(row.title ?? ''),html(row.reason)]))) + '</details></section>' +
    '<section id="methods"><h2>Methods and source definitions</h2>' + Object.entries(analysis.methods).filter(([,value]) => typeof value === 'string').map(([key,value]) => '<p><strong>' + html(key[0].toUpperCase() + key.slice(1)) + '.</strong> ' + html(value) + '</p>').join('') +
    '<ul>' + analysis.methods.references.map(url => '<li>' + link(url,url) + '</li>').join('') + '</ul></section></main><footer>OpenAlex identities connect every summary to the retained cohort. Query and edition metadata above identify the retrieval scope.</footer>' +
    '<script>(function(){"use strict";var search=document.getElementById("cohort-search"),decision=document.getElementById("cohort-decision"),rows=Array.from(document.querySelectorAll("[data-cohort-row]")),status=document.getElementById("visible-count");function filter(){var term=search.value.toLowerCase().trim(),selected=decision.value,visible=0;rows.forEach(function(row){var show=(!term||row.dataset.search.includes(term))&&(!selected||row.dataset.decision===selected);row.classList.toggle("hidden",!show);if(show)visible++;});status.textContent=visible+" of "+rows.length+" visible";}search.addEventListener("input",filter);decision.addEventListener("change",filter);document.getElementById("print-report").addEventListener("click",function(){document.querySelectorAll("details").forEach(function(node){node.open=true;});window.print();});})();</script></body></html>\n';
}
