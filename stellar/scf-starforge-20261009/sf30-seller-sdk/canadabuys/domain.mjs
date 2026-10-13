// MIT. Federal CanadaBuys source semantics; original bilingual columns remain intact.
import { canonical, sha256, safeURL, failure } from './core.mjs';
export const GUIDANCE_URL = 'https://donnees-data.tpsgc-pwgsc.gc.ca/ba2/ac-cb/soutien-support-eng.html';
export const DICTIONARY_URL = 'https://donnees-data.tpsgc-pwgsc.gc.ca/ba2/ac-cb/achatscanada-canadabuys-dd.xml';
export function value(row, ...names) {
  for (const name of names) {
    if (Object.hasOwn(row, name)) return row[name];
    const key = Object.keys(row).find(key => key.toLowerCase() === name.toLowerCase());
    if (key !== undefined) return row[key];
  }
  return '';
}
const bilingual = (row, root, alternatives = []) => ({
  en: value(row, root + '-eng', ...alternatives.map(name => name + '-eng')),
  fr: value(row, root + '-fra', ...alternatives.map(name => name + '-fra'))
});
export const splitCodes = input => [...new Set(String(input || '').split(/[\r\n;,|]+/)
  .map(part => part.trim().replace(/^\*+/, '').trim()).filter(Boolean))];
export const joinKey = input => String(input || '').normalize('NFKC').trim().toUpperCase().replace(/\s+/g, ' ');
export function closingTime(raw, at = Date.now()) {
  const result = { raw: String(raw || ''), utc: null, offset: '-05:00', valid: false, past: null, daysRemaining: null };
  if (!result.raw.trim()) return result;
  const input = result.raw.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(\.\d{1,3})?)?$/.exec(input);
  let milliseconds;
  if (match) {
    const [, year, month, day, hour, minute, second = '00', fraction = ''] = match;
    const y = Number(year), m = Number(month), d = Number(day), h = Number(hour), min = Number(minute), sec = Number(second);
    const local = new Date(Date.UTC(y, m - 1, d, h, min, sec));
    if (local.getUTCFullYear() !== y || local.getUTCMonth() !== m - 1 || local.getUTCDate() !== d ||
        h > 23 || min > 59 || sec > 59) return { ...result, error: 'INVALID_SOURCE_CLOSING_TIME' };
    milliseconds = Date.parse(year + '-' + month + '-' + day + 'T' + hour + ':' + minute + ':' + second + fraction + '-05:00');
  } else if (/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/i.test(input)) {
    milliseconds = Date.parse(input);
    result.offset = /(?:Z|[+-]\d\d:\d\d)$/i.exec(input)[0];
  } else return { ...result, error: 'UNRECOGNIZED_SOURCE_CLOSING_TIME' };
  if (!Number.isFinite(milliseconds)) return { ...result, error: 'INVALID_SOURCE_CLOSING_TIME' };
  const now = typeof at === 'number' ? at : Date.parse(at);
  return { ...result, utc: new Date(milliseconds).toISOString(), valid: true,
    past: Number.isFinite(now) ? milliseconds <= now : null,
    daysRemaining: Number.isFinite(now) ? (milliseconds - now) / 86400000 : null };
}
function originalLinks(row) {
  const documents = [];
  for (const [field, input] of Object.entries(row)) {
    if (!/url|lien|attachment|pieceJointe|pi.ceJointe/i.test(field)) continue;
    for (const raw of String(input).split(/[\r\n,]+/).map(value => value.trim()).filter(Boolean)) {
      const url = safeURL(raw);
      if (url) documents.push({ title: field, url, field, original: raw });
    }
  }
  return documents.filter((item, index) => documents.findIndex(other => other.url === item.url && other.field === item.field) === index);
}
function decimalCents(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;
  const normalized = text.replace(/,/g, '').replace(/^\$/, '');
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const negative = normalized.startsWith('-');
  const [whole, fraction = ''] = normalized.replace(/^-/, '').split('.');
  const cents = (Number(whole) * 100 + Number(fraction.padEnd(2, '0'))) * (negative ? -1 : 1);
  return Number.isSafeInteger(cents) ? cents : null;
}
export const SOSA_DICTIONARY_URL = 'https://donnees-data.tpsgc-pwgsc.gc.ca/ba2/ac-cb/ocama-sosa-dd.xml';
export const SOSA_COLUMNS = ['agreement-number','agreement-type_en','agreement-type_fr','award-date','commodity',
  'commodity-description_en','commodity-description_fr','date-file-published','delivery-point_en','delivery-point_fr',
  'delivery-point-code','end-user-entity_en','end-user-entity_fr','expiry-date','sosa-description_en','sosa-description_fr',
  'supplier-legal-name','supplier-operating-name','supplier-standardized-name'];
function summarizeArrangement(row) {
  const pair = root => ({ en: value(row, root + '_en'), fr: value(row, root + '_fr') });
  const agreementNumber = value(row, 'agreement-number'), agreementType = pair('agreement-type');
  const description = pair('sosa-description'), endUser = pair('end-user-entity');
  const names = { legal: value(row, 'supplier-legal-name'), operating: value(row, 'supplier-operating-name'),
    standardized: value(row, 'supplier-standardized-name') };
  const commodity = { raw: value(row, 'commodity'), codes: splitCodes(value(row, 'commodity')), scheme: 'unspecified',
    description: pair('commodity-description'), definitionURL: SOSA_DICTIONARY_URL };
  const start = value(row, 'award-date'), end = value(row, 'expiry-date');
  return {
    referenceNumber: agreementNumber, solicitationNumber: '', title: description, description, buyer: endUser,
    noticeType: agreementType, status: { en: '', fr: '' }, closing: closingTime('', NaN),
    publicationDate: value(row, 'date-file-published'), updatedDate: '', amendmentNumber: '',
    regions: { delivery: pair('delivery-point'), opportunity: { en: '', fr: '' } },
    categories: [], commodityCodes: [], unspsc: [], documents: originalLinks(row), noticeURL: '',
    noticeURLs: { en: '', fr: '' }, supplier: names.legal || names.operating, supplierNames: { en: '', fr: '' },
    instrumentType: agreementType, amendmentType: { en: '', fr: '' }, contractNumber: '',
    contractValue: { raw: '', cents: null, currency: '', rawCurrency: '', currencyBasis: 'unspecified', includesTaxes: false },
    totalContractValue: { raw: '', cents: null, cumulative: true },
    contractDates: { awarded: '', start, end },
    arrangement: { agreementNumber, agreementType, startDate: start, expiryDate: end,
      sourcePublicationDate: value(row, 'date-file-published'), supplier: names, commodity,
      delivery: { code: value(row, 'delivery-point-code'), description: pair('delivery-point') }, endUser,
      dictionaryURL: SOSA_DICTIONARY_URL },
    stream: 'supply-arrangements'
  };
}
export function sourceSupplierNames(summary) {
  // Standardized names group related legal entities; they never assert supplier identity.
  return [...new Set([summary.supplier, summary.supplierNames?.en, summary.supplierNames?.fr,
    summary.arrangement?.supplier.legal, summary.arrangement?.supplier.operating].filter(Boolean))];
}
export function sourceCommodityCodes(summary) {
  return [
    ...(summary.commodityCodes || []).map(code => ({ scheme: 'GSIN', code })),
    ...(summary.unspsc || []).map(code => ({ scheme: 'UNSPSC', code })),
    ...(summary.arrangement?.commodity.codes || []).map(code => ({ scheme: 'SOSA:unspecified', code }))
  ];
}
export function summarize(row, stream, at = Date.now()) {
  if (stream === 'supply-arrangements') return summarizeArrangement(row);
  const referenceNumber = value(row, 'referenceNumber-numeroReference');
  const solicitationNumber = value(row, 'solicitationNumber-numeroSollicitation');
  const title = bilingual(row, 'title-titre');
  const description = bilingual(row, stream === 'awards' ? 'awardDescription-descriptionAttribution' : 'tenderDescription-descriptionAppelOffres', ['description-description', 'description']);
  const buyer = bilingual(row, 'contractingEntityName-nomEntitContractante', ['contractingEntityName-nomEntiteContractante',
    'contractingEntityName-nomEntitContractante', 'contractingEntityName-nomEntite', 'contractingEntity-entiteContractante',
    'contractingOrganization-organisationContractante', 'procuringEntity-entiteProcuratrice']);
  const documents = originalLinks(row);
  const noticeURL = safeURL(value(row, 'noticeURL-URLavis-eng', 'noticeURL-avisURL-eng', 'noticeURL-URLAvis-eng', 'url-lien-eng')) || '';
  const closing = closingTime(value(row, 'tenderClosingDate-appelOffresDateCloture'), at);
  const contractCurrency = value(row, 'contractCurrency-contratMonnaie').trim();
  const awardValue = value(row, 'contractValue-valeurContrat', 'contractAmount-montantContrat', 'awardValue-valeurAttribution');
  return {
    referenceNumber, solicitationNumber, title, description, buyer,
    noticeType: bilingual(row, 'solicitationType-typeSollicitation', ['noticeType-avisType', 'noticeType-typeAvis']),
    status: bilingual(row, stream === 'awards' ? 'awardStatus-attributionStatut' : 'tenderStatus-appelOffresStatut'),
    closing, publicationDate: value(row, 'publicationDate-datePublication', 'tenderPublicationDate-appelOffresDatePublication'),
    updatedDate: value(row, 'amendmentDate-dateModification', 'dateAmended-dateModifiee'),
    amendmentNumber: value(row, 'amendmentNumber-numeroModification'),
    regions: { delivery: bilingual(row, 'regionsOfDelivery-regionsLivraison', ['regionOfDelivery-regionLivraison']),
      opportunity: bilingual(row, 'regionsOfOpportunity-regionsPossibilite', ['regionsOfOpportunity-regionAppelOffres', 'regionOfOpportunity-regionPossibilite']) },
    categories: splitCodes(value(row, 'procurementCategory-categorieApprovisionnement')),
    commodityCodes: splitCodes(value(row, 'gsin-nibs', 'GSIN-NIBS')),
    unspsc: splitCodes(value(row, 'unspsc')),
    documents, noticeURL, noticeURLs: { en: noticeURL,
      fr: safeURL(value(row, 'noticeURL-URLavis-fra', 'noticeURL-avisURL-fra', 'url-lien-fra')) || '' },
    supplier: value(row, 'supplierLegalName-nomLegalFournisseur-eng', 'supplierName-nomFournisseur', 'supplierLegalName-nomLegalFournisseur', 'supplier-fournisseur') || value(row, 'supplierLegalName-nomLegalFournisseur-fra'),
    supplierNames: bilingual(row, 'supplierLegalName-nomLegalFournisseur'),
    instrumentType: bilingual(row, 'instrumentType-typeInstrument'),
    amendmentType: bilingual(row, 'amendmentType-typeModification'),
    contractNumber: value(row, 'contractNumber-numeroContrat'),
    contractValue: { raw: awardValue, cents: decimalCents(awardValue), currency: contractCurrency || (stream === 'awards' ? 'CAD' : ''),
      currencyBasis: contractCurrency ? 'source' : stream === 'awards' ? 'official-default-CAD' : 'unspecified', rawCurrency: contractCurrency, includesTaxes: stream === 'awards' },
    totalContractValue: { raw: value(row, 'totalContractValue-valeurTotaleContrat'), cents: decimalCents(value(row, 'totalContractValue-valeurTotaleContrat')), cumulative: true },
    contractDates: { awarded: value(row, 'contractAwardDate-dateAttributionContrat'), start: value(row, 'contractStartDate-contratDateDebut'), end: value(row, 'contractEndDate-dateFinContrat') },
    stream
  };
}
export function noticeIdentity(row) {
  const reference = value(row, 'referenceNumber-numeroReference').trim();
  const solicitation = value(row, 'solicitationNumber-numeroSollicitation').trim();
  if (reference) return 'notice-' + sha256(canonical(['reference', reference])).slice(0, 24);
  if (!solicitation) throw failure('NOTICE_IDENTITY_REQUIRED', 'Tender record has neither a reference nor solicitation number', 422);
  const buyer = Object.entries(row).filter(([field]) => /contracting.*(?:name|nom)|entity.*name|entit.*nom/i.test(field));
  return 'notice-' + sha256(canonical(['solicitation', solicitation, buyer])).slice(0, 24);
}
// Immutable entry summaries depend on source values; live notice views supply their own clock.
export function prepareEntries(parsed, source, at = NaN) {
  const tender = source.stream.endsWith('tenders');
  return parsed.rows.map(({ rowNumber, row }) => {
    const summary = summarize(row, source.stream, at);
    const id = 'entry-' + sha256(source.id + '\n' + rowNumber).slice(0, 32);
    return { id, sourceId: source.id, rowNumber, row, summary,
      kind: tender ? 'tender' : source.stream === 'awards' ? 'award' : 'arrangement',
      noticeId: tender ? noticeIdentity(row) : null,
      solicitationKey: joinKey(summary.solicitationNumber),
      referenceKey: joinKey(summary.referenceNumber),
      importedAt: source.retrievedAt,
      rowSha256: sha256(canonical(row))
    };
  });
}
export function entryOrder(a, b) {
  const date = entry => Date.parse(entry.summary.updatedDate || entry.summary.publicationDate || '') || 0;
  const amendment = entry => /^\d+$/.test(entry.summary.amendmentNumber) ? Number(entry.summary.amendmentNumber) : 0;
  return date(b) - date(a) || amendment(b) - amendment(a)
    || String(b.importedAt).localeCompare(String(a.importedAt)) || a.id.localeCompare(b.id);
}
export function matchProfile(notice, profile = {}, at = Date.now()) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) throw failure('INVALID_PROFILE', 'Profile must be an object');
  const summary = notice.summary;
  const terms = input => Array.isArray(input) ? input.map(value => String(value).toLowerCase().trim()).filter(Boolean) : [];
  const body = [summary.title.en, summary.title.fr, summary.description.en, summary.description.fr,
    summary.buyer.en, summary.buyer.fr].join('\n').toLowerCase();
  const evidence = [], reasons = [];
  const include = terms(profile.keywords), exclude = terms(profile.excludeKeywords);
  const hits = include.filter(term => body.includes(term));
  if (include.length && !hits.length) reasons.push('No selected keyword occurs in the retained title, description or buyer');
  for (const term of hits) evidence.push({ type: 'keyword', value: term, source: 'title/description/buyer' });
  for (const term of exclude.filter(term => body.includes(term))) reasons.push('Excluded keyword occurs: ' + term);
  const categories = terms(profile.categories);
  const categoryHits = summary.categories.filter(code => categories.includes(code.toLowerCase()));
  if (categories.length && !categoryHits.length) reasons.push('No selected procurement category matches');
  for (const code of categoryHits) evidence.push({ type: 'category', value: code, source: 'procurementCategory-categorieApprovisionnement' });
  for (const [key, field, scheme] of [['gsin','commodityCodes','GSIN'],['unspsc','unspsc','UNSPSC']]) {
    if (profile[key] !== undefined && (!Array.isArray(profile[key]) || profile[key].some(code => typeof code !== 'string')))
      throw failure('INVALID_PROFILE', key + ' must be an array of exact source codes');
    const requested = (profile[key] || []).map(joinKey).filter(Boolean);
    const matched = summary[field].filter(code => requested.includes(joinKey(code)));
    if (requested.length && !matched.length) reasons.push('No selected exact ' + scheme + ' code matches');
    for (const code of matched) evidence.push({ type: 'commodity-code', scheme, value: code, source: field });
  }
  if (profile.openOnly !== false && notice.presentInLatestOpenFeed === false)
    reasons.push('Notice is absent from the most recently observed complete open feed');
  const close = closingTime(summary.closing.raw, at);
  if (profile.openOnly !== false && (summary.status.en.toLowerCase() !== 'open' || !close.valid || close.past === true))
    reasons.push('Notice is not currently open with a future closing time');
  if (profile.minimumDays !== undefined) {
    if (!Number.isFinite(profile.minimumDays) || profile.minimumDays < 0) throw failure('INVALID_PROFILE', 'minimumDays must be nonnegative');
    if (!close.valid || close.daysRemaining < profile.minimumDays) reasons.push('Closing time does not provide the selected preparation interval');
  }
  return { noticeId: notice.id, matches: reasons.length === 0, evidence, reasons, evaluatedAt: new Date(at).toISOString() };
}
