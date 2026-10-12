/** OpenAlex retained-cohort analysis. Pure ESM: no network, storage, or dependencies.
 * Source semantics: https://help.openalex.org/data/works/attributes/
 * https://help.openalex.org/data/authorships/ and https://help.openalex.org/data/
 */
const PREFIXES = Object.freeze({works:'W',authors:'A',institutions:'I',sources:'S',topics:'T',funders:'F',publishers:'P',awards:'G'});
const DECISION_STATES = new Set(['include','exclude','undecided']);
const FIELD_NAMES = ['doi','title','publication_year','publication_date','type','language','cited_by_count','authorships','primary_location','open_access','topics','keywords','funders','awards','biblio','is_retracted','updated_date'];
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' ? value : null;
const numeric = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const array = value => Array.isArray(value) ? value : [];
const clone = value => value === undefined ? null : JSON.parse(JSON.stringify(value));
const has = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const compareText = (left, right) => String(left ?? '').localeCompare(String(right ?? ''), 'en');

function entityName(entity) {
  if (!has(PREFIXES, entity)) throw new TypeError('Unsupported research entity: ' + String(entity));
  return entity;
}

/** Canonicalize an OpenAlex identity; never merge records by DOI, title, or name. */
export function researchIdentity(value, {entity = 'works'} = {}) {
  entityName(entity);
  if (isObject(value)) value = value.id ?? value.ids?.openalex;
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^(?:(?:https?:\/\/)?openalex\.org\/)?(?:(works|authors|institutions|sources|topics|funders|publishers|awards)\/)?([WAISTFPG][0-9]+)\/?$/i);
  if (!match || (match[1] && match[1].toLowerCase() !== entity) || match[2][0].toUpperCase() !== PREFIXES[entity]) return null;
  return 'https://openalex.org/' + match[2].toUpperCase();
}

function stable(value) {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (isObject(value)) return '{' + Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => JSON.stringify(key) + ':' + stable(value[key])).join(',') + '}';
  return JSON.stringify(value) ?? 'null';
}

function differentFields(before, after) {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].sort().filter(key => has(before,key) !== has(after,key) || stable(before[key]) !== stable(after[key]));
}

function indexRecords(records, entity) {
  if (!Array.isArray(records)) throw new TypeError('Research records must be an array of original entity objects.');
  const byId = new Map(), duplicates = [], unidentified = [];
  records.forEach((record, index) => {
    const id = researchIdentity(record, {entity});
    if (!id || !isObject(record)) {
      unidentified.push({index,providedId:isObject(record) ? text(record.id ?? record.ids?.openalex) : null,title:isObject(record) ? text(record.title ?? record.display_name) : null,reason:isObject(record) ? 'missing_or_invalid_openalex_id' : 'record_is_not_an_object'});
      return;
    }
    if (byId.has(id)) {
      const first = byId.get(id);
      const changedFields = differentFields({...first.record,id}, {...record,id});
      duplicates.push({id,index,keptIndex:first.index,conflicting:changedFields.length > 0,changedFields});
    } else byId.set(id, {id,index,record});
  });
  return {byId,duplicates,unidentified};
}

export function researchDecision(decisions, id) {
  const raw = decisions instanceof Map ? decisions.get(id) : isObject(decisions) && has(decisions,id) ? decisions[id] : undefined;
  const status = isObject(raw) && DECISION_STATES.has(raw.status) ? raw.status : 'undecided';
  return {status,notes:isObject(raw) && typeof raw.notes === 'string' ? raw.notes : '',tags:isObject(raw) ? array(raw.tags).filter(value => typeof value === 'string') : [],updatedAt:isObject(raw) ? text(raw.updatedAt) : null};
}

function reference(value, entity) {
  const object = isObject(value) ? value : {id:value};
  return {id:researchIdentity(object,{entity}),providerId:text(object.id),name:text(object.display_name),orcid:text(object.orcid),ror:text(object.ror),countryCode:text(object.country_code),type:text(object.type)};
}

function uniqueReferences(values) {
  const seen = new Set(), result = [];
  for (const value of values) {
    if (value.id && seen.has(value.id)) continue;
    if (value.id) seen.add(value.id);
    result.push(value);
  }
  return result;
}

function normalizeRecord(record, entity, decisions, index) {
  const id = researchIdentity(record,{entity});
  const authorships = array(record.authorships).filter(isObject);
  const authors = authorships.map(item => ({...reference(item.author,'authors'),rawName:text(item.raw_author_name),position:text(item.author_position),isCorresponding:typeof item.is_corresponding === 'boolean' ? item.is_corresponding : null,institutions:uniqueReferences(array(item.institutions).map(value => reference(value,'institutions'))),countries:array(item.countries).filter(value => typeof value === 'string')}));
  const institutions = uniqueReferences([...authors.flatMap(author => author.institutions),...array(record.institutions).map(value => reference(value,'institutions'))]);
  const topics = array(record.topics).filter(isObject).map(item => ({...reference(item,'topics'),score:numeric(item.score),subfield:isObject(item.subfield) ? clone(item.subfield) : null,field:isObject(item.field) ? clone(item.field) : null,domain:isObject(item.domain) ? clone(item.domain) : null}));
  const primary = has(record,'primary_topic') ? record.primary_topic : array(record.topics)[0];
  const primaryTopic = isObject(primary) ? {...reference(primary,'topics'),score:numeric(primary.score),subfield:clone(primary.subfield),field:clone(primary.field),domain:clone(primary.domain)} : null;
  const awards = array(record.awards).filter(isObject).map(item => ({...reference(item,'awards'),funderId:researchIdentity(item.funder_id ?? item.funder?.id,{entity:'funders'}),funderName:text(item.funder_display_name ?? item.funder?.display_name),funderAwardId:text(item.funder_award_id),doi:text(item.doi)}));
  const funders = uniqueReferences([...array(record.funders).map(value => reference(value,'funders')),...awards.filter(item => item.funderId).map(item => reference({id:item.funderId,display_name:item.funderName},'funders'))]);
  const location = isObject(record.primary_location) ? record.primary_location : {};
  const source = isObject(location.source) ? reference(location.source,'sources') : null;
  const openAccess = isObject(record.open_access) ? record.open_access : {};
  const biblio = isObject(record.biblio) ? record.biblio : {};
  const year = Number.isInteger(record.publication_year) && record.publication_year > 0 ? record.publication_year : null;
  return {
    id,providerId:text(record.id ?? record.ids?.openalex),shortId:id.slice(id.lastIndexOf('/') + 1),inputIndex:index,
    title:text(record.title ?? record.display_name),doi:text(record.doi ?? record.ids?.doi),
    publicationYear:year,publicationDate:text(record.publication_date),type:text(record.type),language:text(record.language),
    citedByCount:numeric(record.cited_by_count),providerWorksCount:numeric(record.works_count),
    isOpenAccess:typeof openAccess.is_oa === 'boolean' ? openAccess.is_oa : null,oaStatus:text(openAccess.oa_status),oaUrl:text(openAccess.oa_url),
    isRetracted:typeof record.is_retracted === 'boolean' ? record.is_retracted : null,updatedDate:text(record.updated_date),
    authors,institutions,topics,primaryTopic,funders,awards,source,
    keywords:array(record.keywords).filter(isObject).map(item => ({id:text(item.id),name:text(item.display_name),score:numeric(item.score)})),
    biblio:{volume:text(biblio.volume),issue:text(biblio.issue),firstPage:text(biblio.first_page),lastPage:text(biblio.last_page)},
    containerTitle:isObject(record.volume) ? text(record.volume.display_name) : null,
    landingPageUrl:text(location.landing_page_url),pdfUrl:text(location.pdf_url),countryCode:text(record.country_code),homepageUrl:text(record.homepage_url),
    decision:researchDecision(decisions,id),fieldPresence:Object.fromEntries(FIELD_NAMES.map(field => [field,has(record,field)])),
    authorshipsAtCap:authorships.length >= 100,
    unresolvedAuthors:authors.filter(item => !item.id).length,unresolvedInstitutions:institutions.filter(item => !item.id).length,
    unresolvedTopics:topics.filter(item => !item.id).length,unresolvedFunders:funders.filter(item => !item.id).length
  };
}

function groups(rows, select, {overlap = true, unit = 'works', order = 'count'} = {}) {
  const entries = new Map();
  for (const row of rows) {
    const seen = new Set();
    for (const membership of select(row)) {
      if (!membership || membership.id === null || membership.id === undefined || seen.has(String(membership.id))) continue;
      const id = String(membership.id);
      seen.add(id);
      let group = entries.get(id);
      if (!group) {
        group = {...membership,id,name:membership.name ?? id,workCount:0,recordCount:0,includedRecordCount:0,includedWorkCount:0,citationsReceived:0,citationRecords:0,workIds:[],recordIds:[]};
        entries.set(id,group);
      }
      if (!group.name && membership.name) group.name = membership.name;
      group.workCount += 1;
      group.recordCount += 1;
      group.includedRecordCount += row.decision.status === 'include' ? 1 : 0;
      group.includedWorkCount += row.decision.status === 'include' ? 1 : 0;
      if (row.citedByCount !== null && unit === 'works') {group.citationsReceived += row.citedByCount;group.citationRecords += 1;}
      group.workIds.push(row.id);
      group.recordIds.push(row.id);
    }
  }
  const values = [...entries.values()].map(group => ({...group,citationsReceived:unit === 'works' && group.citationRecords > 0 ? group.citationsReceived : null,shareOfRetainedRecords:rows.length ? group.recordCount / rows.length : 0,unit,overlapping:overlap,...(unit === 'works' ? {} : {workCount:null,includedWorkCount:null,citationsReceived:null,citationRecords:null,workIds:[]})}));
  values.sort(order === 'year' ? (a,b) => a.id === 'unknown' ? 1 : b.id === 'unknown' ? -1 : Number(a.id)-Number(b.id) : (a,b) => b.recordCount-a.recordCount || compareText(a.name,b.name) || compareText(a.id,b.id));
  return values;
}

function decisionTable(rows, entity) {
  return ['include','exclude','undecided'].map(status => {
    const selected = rows.filter(row => row.decision.status === status);
    return {id:status,name:status,recordCount:selected.length,workCount:entity === 'works' ? selected.length : null,recordIds:selected.map(row => row.id),shareOfRetainedRecords:rows.length ? selected.length/rows.length : 0,overlapping:false,unit:entity};
  });
}

function countsFor(rows, intake, entity) {
  const citations = rows.filter(row => row.citedByCount !== null);
  return {
    recordsReceived:intake.recordsReceived,uniqueRecords:rows.length,duplicates:intake.duplicates.length,
    conflictingDuplicates:intake.duplicates.filter(item => item.conflicting).length,unidentifiedRecords:intake.unidentified.length,
    included:rows.filter(row => row.decision.status === 'include').length,excluded:rows.filter(row => row.decision.status === 'exclude').length,undecided:rows.filter(row => row.decision.status === 'undecided').length,
    citationCountSum:entity === 'works' && citations.length ? citations.reduce((sum,row) => sum+row.citedByCount,0) : null,
    citationRecords:citations.length,citationRecordsMissing:rows.length-citations.length,
    openAccessRecords:rows.filter(row => row.isOpenAccess === true).length,openAccessUnknown:rows.filter(row => row.isOpenAccess === null).length,
    retractedRecords:rows.filter(row => row.isRetracted === true).length,retractionStatusUnknown:rows.filter(row => row.isRetracted === null).length,
    authorshipsAtCap:rows.filter(row => row.authorshipsAtCap).length,
    unresolvedAuthorOccurrences:rows.reduce((sum,row) => sum+row.unresolvedAuthors,0),
    unresolvedInstitutionOccurrences:rows.reduce((sum,row) => sum+row.unresolvedInstitutions,0)
  };
}

/** Analyze rows in retained edition page order. First occurrence of each ID wins. */
export function analyzeResearch(records, {entity = 'works',decisions = {}} = {}) {
  entityName(entity);
  const indexed = indexRecords(records,entity);
  const rows = [...indexed.byId.values()].map(item => normalizeRecord(item.record,entity,decisions,item.index));
  const works = entity === 'works';
  const options = {unit:entity};
  const membership = select => works ? groups(rows,select,options) : [];
  const single = select => groups(rows,select,{...options,overlap:false});
  const originals = [...indexed.byId.values()].map(item => item.record);
  const selectedFields = works ? FIELD_NAMES : ['display_name','works_count','cited_by_count','country_code','type','homepage_url','updated_date'];
  const fieldCoverage = selectedFields.map(field => ({
    field,present:originals.filter(record => has(record,field)).length,
    missing:originals.filter(record => !has(record,field)).length,
    nullValues:originals.filter(record => has(record,field) && record[field] === null).length,
    emptyArrays:originals.filter(record => Array.isArray(record[field]) && record[field].length === 0).length
  }));
  const tables = {
    records:rows,
    authors:membership(row => row.authors.filter(item => item.id).map(({id,providerId,name,orcid}) => ({id,providerId,name,orcid}))),
    institutions:membership(row => row.institutions.filter(item => item.id)),
    topics:membership(row => row.topics.filter(item => item.id).map(({id,providerId,name,subfield,field,domain}) => ({id,providerId,name,subfield,field,domain}))),
    primaryTopics:works ? groups(rows,row => row.primaryTopic?.id ? [{id:row.primaryTopic.id,name:row.primaryTopic.name,subfield:row.primaryTopic.subfield,field:row.primaryTopic.field,domain:row.primaryTopic.domain}] : [],{...options,overlap:false}) : [],
    funders:membership(row => row.funders.filter(item => item.id)),
    sources:works ? groups(rows,row => row.source?.id ? [row.source] : [],{...options,overlap:false}) : [],
    years:works ? groups(rows,row => [{id:row.publicationYear ?? 'unknown',name:row.publicationYear === null ? 'Not supplied' : String(row.publicationYear)}],{...options,overlap:false,order:'year'}) : [],
    types:single(row => [{id:row.type ?? 'unknown',name:row.type ?? 'Not supplied'}]),
    languages:works ? single(row => [{id:row.language ?? 'unknown',name:row.language ?? 'Not supplied'}]) : [],
    openAccess:works ? single(row => [{id:row.oaStatus ?? 'unknown',name:row.oaStatus ?? 'Not supplied'}]) : [],
    countries:works ? membership(row => [...new Set([...row.authors.flatMap(author => author.countries),...row.institutions.map(item => item.countryCode).filter(Boolean)])].map(code => ({id:code,name:code}))) : single(row => [{id:row.countryCode ?? 'unknown',name:row.countryCode ?? 'Not supplied'}]),
    decisions:decisionTable(rows,entity),fieldCoverage
  };
  const intake = {recordsReceived:records.length,duplicates:indexed.duplicates,unidentified:indexed.unidentified};
  const presentIds = new Set(rows.map(row => row.id));
  const decisionEntries = decisions instanceof Map ? [...decisions.keys()] : isObject(decisions) ? Object.keys(decisions) : [];
  return {
    schema:'sf88.research-analysis.v1',entity,counts:countsFor(rows,intake,entity),tables,
    identity:{key:'canonical_openalex_id',duplicatePolicy:'first_occurrence_in_edition_page_order',duplicateOccurrences:indexed.duplicates,unidentifiedRecords:indexed.unidentified},
    review:{decisionKey:'canonical_openalex_id',orphanDecisionIds:decisionEntries.filter(id => !presentIds.has(id)),selection:'include'},
    methods:{
      scope:'Distinct identified ' + entity + ' retained in this edition.',
      memberships:works ? 'Each identified work contributes at most once to each group. Author, institution, topic, funder and country groups overlap; their counts must not be added to obtain cohort size.' : 'Each identified retained entity contributes at most once to each applicable group. Provider works_count and cited_by_count remain per-entity metadata; overlapping research portfolios are not pooled.',
      citations:works ? 'Citation sums use supplied cited_by_count values for distinct retained works. Missing values stay missing. These are provider citation counts at retrieval, not citations between cohort members.' : 'Provider citation counts remain in individual entity rows. They may refer to overlapping works and are not summed across entities.',
      authors:'Author and institution groups use identifiers, never matching names. Authorships can be capped at 100 in the provider response. Unresolved references remain visible on each record.',
      funding:'Funder groups combine current funders and awards.funder_id, deduplicated within each work. Work membership counts do not measure grant amounts.',
      topics:'Topics are provider classifications. Primary topic is the explicit primary_topic or first returned topics entry, as documented by OpenAlex.',
      coverage:'Query coverage is supplied separately by the edition collector. Retained counts do not establish that an entire query has been retrieved.',
      bibliography:'Bibliography fields come from retained metadata. Supplied author names are kept verbatim; family names and missing bibliographic fields are not inferred.',
      references:['https://help.openalex.org/data/works/attributes/','https://help.openalex.org/data/authorships/','https://help.openalex.org/data/works/citations/','https://help.openalex.org/data/','https://help.openalex.org/api/paging/']
    }
  };
}

/** Apply the workspace's current review map without changing retained metadata. */
export function withResearchDecisions(analysis, decisions) {
  if (!analysis?.tables?.records || !analysis.identity) throw new TypeError('A research analysis is required.');
  if (decisions === undefined) return analysis;
  const rows = analysis.tables.records.map(row => ({...row,decision:researchDecision(decisions,row.id)}));
  const included = new Set(rows.filter(row => row.decision.status === 'include').map(row => row.id));
  const tables = Object.fromEntries(Object.entries(analysis.tables).map(([key,values]) => [key,key === 'records' ? rows : key === 'decisions' ? decisionTable(rows,analysis.entity) : values.map(row => row.recordIds || row.workIds ? {...row,includedRecordCount:(row.recordIds ?? row.workIds).filter(id => included.has(id)).length,includedWorkCount:analysis.entity === 'works' ? row.workIds.filter(id => included.has(id)).length : null} : row)]));
  const intake = {recordsReceived:analysis.counts.recordsReceived,duplicates:analysis.identity.duplicateOccurrences,unidentified:analysis.identity.unidentifiedRecords};
  const ids = new Set(rows.map(row => row.id));
  const keys = decisions instanceof Map ? [...decisions.keys()] : isObject(decisions) ? Object.keys(decisions) : [];
  return {...analysis,tables,counts:countsFor(rows,intake,analysis.entity),review:{...analysis.review,orphanDecisionIds:keys.filter(id => !ids.has(id))}};
}

/** Compare the exact retained metadata of two editions by canonical identity. */
export function compareResearch(beforeRecords, afterRecords, {entity = 'works'} = {}) {
  entityName(entity);
  const before = indexRecords(beforeRecords,entity),after = indexRecords(afterRecords,entity);
  const added = [],removed = [],changed = [];
  let unchanged = 0;
  for (const [id,item] of after.byId) {
    if (!before.byId.has(id)) {added.push(normalizeRecord(item.record,entity,{},item.index));continue;}
    const prior = before.byId.get(id);
    const changedFields = differentFields({...prior.record,id},{...item.record,id});
    if (!changedFields.length) {unchanged += 1;continue;}
    changed.push({id,title:text(item.record.title ?? item.record.display_name),changedFields,before:normalizeRecord(prior.record,entity,{},prior.index),after:normalizeRecord(item.record,entity,{},item.index)});
  }
  for (const [id,item] of before.byId) if (!after.byId.has(id)) removed.push(normalizeRecord(item.record,entity,{},item.index));
  return {
    schema:'sf88.research-comparison.v1',entity,counts:{before:before.byId.size,after:after.byId.size,added:added.length,removed:removed.length,changed:changed.length,unchanged},
    added,removed,changed,
    identity:{key:'canonical_openalex_id',duplicatePolicy:'first_occurrence_in_edition_page_order',beforeDuplicates:before.duplicates,afterDuplicates:after.duplicates,beforeUnidentified:before.unidentified,afterUnidentified:after.unidentified},
    method:'Added and removed mean membership changes between the retained editions. Changed means at least one supplied metadata field differs after canonicalizing the primary ID. Query identity and completeness belong to the edition metadata.'
  };
}
