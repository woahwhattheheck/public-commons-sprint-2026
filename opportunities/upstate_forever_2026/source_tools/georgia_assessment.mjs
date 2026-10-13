/**
 * Georgia's original integrated assessment rows, without conflating reaches,
 * stations, HUCs, designated uses or pollutant-specific categories.
 *
 * Input: exact worksheet row objects from the retained publisher workbook.
 * Column bindings are explicit and edition-specific. The workbook/export and
 * optional reach geometry are separate retained source identities.
 */
import {readFile, writeFile, mkdir, copyFile} from 'node:fs/promises';
import {resolve, dirname, basename, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

export const GEORGIA_METHOD = {
  schema: 'upstate.georgia-assessment-method/v1',
  version: '2024-approved-20261013',
  jurisdiction: 'GA',
  assessment_unit: 'publisher_assessed_reach',
  effective_edition: {cycle: 2024, publication_status: 'EPA-approved', approval_date: '2024-09-03'},
  publication_uri: 'https://epd.georgia.gov/water-quality-georgia',
  methodology_uri: 'https://epd.georgia.gov/document/document/finallistingassessmentmethodology2024305b303dpdf/download',
  description_uri: 'https://epd.georgia.gov/document/document/descriptionof305b303dlistofwaters2024updatedocxpdf/download',
  code_key_uri: 'https://epd.georgia.gov/document/document/data-sourcecode-key-abbreviations-2024-list/download',
  highlights_uri: 'https://epd.georgia.gov/document/document/highlights-2024-listpdf/download',
  approval_uri: 'https://epd.georgia.gov/document/document/epa2024303dapprovalletterpdf/download',
  evidence_window: {
    general_years: [2021, 2022, 2023],
    qualifications: [
      'The methodology generally considered 2021–2023, with 2023 availability commonly limited to January–June.',
      'Older assessments may carry forward; continuous historical monitoring and parameter-specific methods can use different periods.',
      'This general methodology window is not an asserted sample date range for an individual row.'
    ]
  },
  categories: {
    '1': {label: 'Supporting designated uses', group: 'supporting', on_303d_list: false},
    '2': {label: 'Some uses supported; other uses lack sufficient information', group: 'assessment_pending', on_303d_list: false},
    '3': {label: 'Insufficient data or information', group: 'assessment_pending', on_303d_list: false},
    '3N': {label: 'Natural conditions require additional assessment', group: 'assessment_pending', on_303d_list: false},
    '4a': {label: 'Impaired; relevant TMDL completed', group: 'not_supporting', on_303d_list: false},
    '4b': {label: 'Impaired; other restoration actions expected to attain standards', group: 'not_supporting', on_303d_list: false},
    '4c': {label: 'Impaired for a reason other than a pollutant', group: 'not_supporting', on_303d_list: false},
    '5': {label: 'Impaired; TMDL required', group: 'not_supporting', on_303d_list: true},
    '5R': {label: 'Advanced restoration plan; TMDL deferred', group: 'not_supporting', on_303d_list: true}
  },
  source_codes: {CSO: 'Combined sewer overflow', I1: 'Industrial point source',
    I2: 'Industrial site runoff', M: 'Municipal point source',
    NP: 'Nonpoint source', UR: 'Urban runoff'},
  join_rules: {
    reach_identity: 'Exact publisher ReachID within the selected edition',
    monitoring_identity: 'Separate organization-qualified monitoring identifier with explicit source association',
    watershed_identity: 'Original polygon intersection or publisher-declared HUC field; never digits extracted from ReachID',
    category_scope: 'Category membership is retained at its source-row scope. No category × cause × use expansion.',
    assessment_scope: 'Overall row status does not assert that every designated use fails.'
  }
};

const required = ['reach_id', 'reach_name', 'basin', 'assessment', 'category'];
const columnNames = ['reach_id', 'reach_name', 'reach_location', 'county', 'basin', 'uses',
  'assessment', 'data_provider', 'causes', 'sources', 'size', 'unit', 'category', 'priority', 'notes'];
const clean = v => v === null || v === undefined ? '' : String(v).trim();
const uniq = values => [...new Set(values)];
const clone = value => JSON.parse(JSON.stringify(value));
const canonicalCategory = v => {
  const s = clean(v).replace(/\s+/g, '');
  if (/^[45][abc]$/i.test(s)) return s[0] + s[1].toLowerCase();
  if (/^(3n|5r)$/i.test(s)) return s.toUpperCase();
  return s;
};
function parseCategories(value) {
  if (!clean(value)) return {values: [], unknown: []};
  const parts = Array.isArray(value) ? value : String(value).split(/[,;\n]+/);
  const values = uniq(parts.map(canonicalCategory).filter(Boolean));
  return {values, unknown: values.filter(v => !GEORGIA_METHOD.categories[v])};
}
function parsePriority(value) {
  const raw = clean(value);
  const tokens = raw ? raw.split(/[,;\n]+/).map(clean).filter(Boolean) : [];
  return {raw, draft_tmdl_years: uniq(tokens.filter(x => /^\d{4}$/.test(x)).map(Number)),
    low: tokens.some(x => /^low$/i.test(x)),
    other: tokens.filter(x => !/^\d{4}$/.test(x) && !/^low$/i.test(x)),
    meaning: 'Publisher planned TMDL-draft year or literal priority label'};
}
function parseCodes(value, dictionary = null) {
  const raw = clean(value);
  const tokens = raw ? uniq(raw.split(/[,;\n]+/).map(clean).filter(Boolean)) : [];
  return tokens.map(code => ({code, label: dictionary?.[code] ?? null}));
}
const causePatterns = [
  ['Bacteria', /\bBacteria\b/gi, 'bacteria_unspecified'],
  ['E. coli', /\bE\.?\s*Coli\b/gi, 'ecoli'],
  ['Enterococci', /\bEnterococci\b/gi, 'enterococci'],
  ['Fecal coliform', /\b(?:FC|Fecal\s+Coliform)\b/gi, 'fecal_coliform'],
  ['Fish community', /\bBio\s*F\b/gi, 'biological_fish'],
  ['Macroinvertebrate community', /\bBio\s*M\b/gi, 'biological_macroinvertebrates'],
  ['Dissolved oxygen', /\b(?:DO|Dissolved\s+Oxygen)\b/gi, 'dissolved_oxygen'],
  ['pH', /\bpH\b/g, 'ph'],
  ['Chlorophyll a', /\bChlorophyll\s*a\b/gi, 'chlorophyll_a'],
  ['Phosphorus', /\b(?:P|Phosphorus)\b/g, 'phosphorus'],
  ['Total nitrogen', /\b(?:TN|Total\s+Nitrogen)\b/gi, 'nitrogen'],
  ['Sediment', /\b(?:Sediment|Sedimentation|TSS|Turbidity)\b/gi, 'sediment_related'],
  ['Fish tissue mercury', /\bFish\s*Tissue\s*\(\s*Mercury\s*\)/gi, 'fish_tissue_mercury'],
  ['Fish tissue PCBs', /\bFish\s*Tissue\s*\(\s*PCBs?\s*\)/gi, 'fish_tissue_pcbs'],
  ['Fish tissue selenium', /\bFish\s*Tissue\s*\(\s*Selenium\s*\)/gi, 'fish_tissue_selenium']
];
function causeMentions(value) {
  const raw = clean(value), result = [];
  for (const [label, pattern, family] of causePatterns) {
    pattern.lastIndex = 0;
    for (const match of raw.matchAll(pattern)) result.push({
      raw: match[0], label, family, start: match.index, end: match.index + match[0].length
    });
  }
  return result.sort((a,b) => a.start - b.start || a.end - b.end);
}
function scopeStatus(raw) {
  const s = clean(raw).replace(/\s+/g, ' ').toLowerCase();
  return ({supporting:'supporting', 'not supporting':'not_supporting',
    'assessment pending':'assessment_pending'})[s] || 'unrecognized';
}
function normalizeSheet(sheet, binding, source, identity) {
  if (!sheet || !Array.isArray(sheet.rows)) throw new Error('Worksheet requires complete rows array');
  if (!binding || typeof binding.columns !== 'object') throw new Error('Select explicit edition-specific columns');
  const columns = binding.columns;
  for (const key of required) if (!columns[key]) throw new Error('Missing column binding: ' + key);
  const configuredHeaders = Object.values(columns).filter(Boolean);
  const observedHeaders = new Set(sheet.columns || sheet.rows.flatMap(r => Object.keys(r.values || r)));
  for (const header of configuredHeaders) if (!observedHeaders.has(header))
    throw new Error('Configured header absent from worksheet ' + sheet.name + ': ' + header);
  const headerRow = binding.header_row ?? sheet.header_row;
  if (!Number.isInteger(headerRow) || headerRow < 1) throw new Error('Exact worksheet header_row is required');
  const records = [], nonAssessmentRows = [], issues = [];
  for (let index = 0; index < sheet.rows.length; index++) {
    const wrapper = sheet.rows[index], raw = wrapper.values ?? wrapper;
    const rowNumber = wrapper.values ? wrapper.row_number : headerRow + index + 1;
    if (!Number.isInteger(rowNumber) || rowNumber <= headerRow)
      throw new Error('Invalid original worksheet row number');
    const read = key => columns[key] ? raw[columns[key]] ?? null : null;
    const reachId = clean(read('reach_id'));
    if (!reachId) {
      if (Object.values(raw).some(v => clean(v))) nonAssessmentRows.push({
        worksheet: sheet.name, source_row: rowNumber, raw: clone(raw)
      });
      continue;
    }
    const native = Object.fromEntries(columnNames.map(key => [key, clone(read(key))]));
    const categories = parseCategories(read('category')), priority = parsePriority(read('priority'));
    const causes = causeMentions(read('causes'));
    const status = scopeStatus(read('assessment'));
    const sourceLocator = {source_id: source.id, source_sha256: source.sha256,
      worksheet: sheet.name, source_row: rowNumber};
    const id = 'ga-' + identity(JSON.stringify([source.sha256, sheet.name, rowNumber, reachId]));
    const rowIssues = [];
    if (categories.unknown.length) rowIssues.push({kind:'unknown_category', values:categories.unknown});
    if (status === 'unrecognized') rowIssues.push({kind:'unrecognized_assessment_status', value:read('assessment')});
    if (!categories.values.length) rowIssues.push({kind:'missing_category'});
    const note = clean(read('notes'));
    const noteYears = uniq((note.match(/\b(?:19|20)\d{2}\b/g) || []).map(Number));
    const record = {
      id, jurisdiction:'GA', assessment_cycle:source.assessment_cycle,
      publication_status:source.publication_status, approval_date:source.approval_date ?? null,
      native_reach_id:reachId, assessment_unit:'publisher_assessed_reach',
      reach_name:clean(read('reach_name')), reach_location:clean(read('reach_location')),
      county_raw:clean(read('county')), basin_raw:clean(read('basin')),
      designated_uses_raw:clean(read('uses')),
      overall_assessment_raw:clean(read('assessment')), overall_assessment:status,
      categories:categories.values.map(code => ({code, ...(GEORGIA_METHOD.categories[code] ||
        {label:null,group:'unrecognized',on_303d_list:null})})),
      on_303d_list:categories.unknown.length ? null :
        categories.values.length ? categories.values.some(code => GEORGIA_METHOD.categories[code].on_303d_list) : null,
      category_cause_use_mapping:'retained_source_row_scope',
      cause_raw:clean(read('causes')), cause_mentions:causes,
      data_providers:parseCodes(read('data_provider')),
      pollutant_sources:parseCodes(read('sources'), GEORGIA_METHOD.source_codes),
      size_raw:read('size'), unit_raw:clean(read('unit')),
      priority, notes:note,
      source_note_years:noteYears,
      source_locator:sourceLocator, native_columns:native, raw:clone(raw),
      geography:{huc12s:[],basis:'not_yet_joined',reach_feature_ids:[]},
      interpretation:{
        bacterial_indicator:causes.some(c => c.family === 'bacteria_unspecified') ?
          'Bacteria can carry an earlier fecal-coliform impairment awaiting indicator-specific assessment.' : null,
        contains_multiple_categories:categories.values.length > 1,
        row_status_does_not_apply_to_every_use:true,
        note_mentions_category: /\bCategory\s*[1-5]/i.test(note),
        priority_note_years_are_separate:true
      }
    };
    records.push(record);
    for (const issue of rowIssues) issues.push({record_id:id, ...sourceLocator, ...issue});
  }
  return {records, nonAssessmentRows, issues};
}

/** Adapt ECHO's complete original XLSX cell export; no workbook reparsing. */
export function adaptOriginalWorkbookCells(manifest, sheetBodies, configuration) {
  if(manifest.schema!=='commons.original-workbook-cells/v1')
    throw new Error('Select the original ECHO workbook-cell export');
  if(manifest.original.sha256!==configuration.source.sha256 ||
     manifest.original.bytes!==configuration.source.bytes)
    throw new Error('Worksheet export and selected original workbook differ');
  const config=clone(configuration), worksheets=[];
  const excelColumn=n=>{
    let text='';while(n>0){n--;text=String.fromCharCode(65+n%26)+text;n=Math.floor(n/26);}return text;
  };
  for(const binding of config.worksheets) {
    const meta=manifest.sheets.filter(s=>s.name===binding.name);
    if(meta.length!==1 || meta[0].kind!=='worksheet') throw new Error('Original worksheet selection is absent or ambiguous');
    const sheet=sheetBodies[meta[0].export.path];
    if(!sheet || sheet.name!==binding.name) throw new Error('Complete original worksheet body is required');
    const header=sheet.rows.find(r=>r.row_index===binding.header_row);
    if(!header) throw new Error('Selected original header row is absent');
    const labels=header.cells.map(c=>({column:excelColumn(c.column_index),text:clean(c.resolved_value)}));
    for(const [field,selected] of Object.entries(binding.columns)) {
      let matches;
      if(typeof selected==='string') matches=labels.filter(c=>c.text===selected);
      else if(selected && typeof selected.column==='string') {
        matches=labels.filter(c=>c.column===selected.column);
        if(matches.length && selected.expected_header!==undefined &&
           matches[0].text!==selected.expected_header)
          throw new Error('Original selected column header differs: '+selected.column);
      } else throw new Error('Bind an exact original header or explicit column coordinate');
      if(matches.length!==1) throw new Error('Original header is absent or ambiguous: '+field);
      binding.columns[field]=matches[0].column;
    }
    worksheets.push({name:sheet.name,header_row:binding.header_row,
      columns:labels.map(c=>c.column),
      original_headers:labels,
      rows:sheet.rows.filter(r=>r.row_index>binding.header_row).map(row=>({
        row_number:row.row_index,
        values:Object.fromEntries(row.cells.map(c=>[excelColumn(c.column_index),c.resolved_value])),
        source_cells:row.cells
      }))});
  }
  return {workbook:{worksheets},configuration:config};
}

/** Normalize complete original worksheet exports using supplied exact headers. */
export function normalizeGeorgiaWorkbook(workbook, configuration, identity) {
  if (typeof identity !== 'function') throw new Error('Supply SHA-256 identity function');
  const source = clone(configuration.source);
  for (const field of ['id','uri','sha256','bytes','assessment_cycle','publication_status'])
    if (source[field] === undefined || source[field] === '') throw new Error('Missing source identity: ' + field);
  if (!Number.isSafeInteger(source.bytes) || source.bytes < 1) throw new Error('Original workbook byte size is required');
  if (!/^[0-9a-f]{64}$/i.test(source.sha256)) throw new Error('Original workbook SHA-256 is required');
  if (source.assessment_cycle !== 2024 || source.publication_status !== 'EPA-approved' ||
      source.approval_date !== '2024-09-03')
    throw new Error('This normalizer implements the original approved 2024 edition; select an edition-specific method for another list');
  if (!Array.isArray(workbook.worksheets)) throw new Error('Input requires worksheets[]');
  const selected = configuration.worksheets;
  if (!Array.isArray(selected) || !selected.length) throw new Error('Select exact original worksheets');
  const output = {schema:'upstate.georgia-assessments/v1', source,
    method:clone(GEORGIA_METHOD), records:[], non_assessment_rows:[], issues:[]};
  const selectedNames = new Set();
  for (const binding of selected) {
    if (selectedNames.has(binding.name)) throw new Error('Duplicate worksheet selection');
    selectedNames.add(binding.name);
    const matches = workbook.worksheets.filter(s => s.name === binding.name);
    if (matches.length !== 1) throw new Error('Original worksheet selection is absent or ambiguous: ' + binding.name);
    const result = normalizeSheet(matches[0], binding, source, identity);
    output.records.push(...result.records);
    output.non_assessment_rows.push(...result.nonAssessmentRows);
    output.issues.push(...result.issues);
  }
  if (new Set(output.records.map(r => r.id)).size !== output.records.length)
    throw new Error('Repeated original worksheet row identity');
  const tally = (rows, key) => {
    const result={}; for(const row of rows) result[row[key]]=(result[row[key]]||0)+1; return result;
  };
  output.summary = {
    selected_worksheets:[...selectedNames], record_count:output.records.length,
    unique_reach_count:new Set(output.records.map(r => r.native_reach_id)).size,
    by_basin:tally(output.records,'basin_raw'), by_assessment:tally(output.records,'overall_assessment'),
    on_303d_record_count:output.records.filter(r => r.on_303d_list === true).length,
    unknown_303d_status_count:output.records.filter(r => r.on_303d_list === null).length,
    non_assessment_row_count:output.non_assessment_rows.length,
    issues_count:output.issues.length,
    geography_basis:'original assessment rows; no HUC or station identity derived from ReachID'
  };
  return output;
}

/**
 * Attach already-computed original reach/polygon relations. Every relation
 * retains its source-native feature ID, geometry source, CRS and measure.
 */
export function attachGeorgiaGeography(bank, relations, domainHucs) {
  if (!Array.isArray(relations) || !Array.isArray(domainHucs)) throw new Error('Relations and original domain HUCs are required');
  const allowed = new Set(domainHucs);
  if (allowed.size !== domainHucs.length || [...allowed].some(h=>typeof h !== 'string' || !/^\d{12}$/.test(h)))
    throw new Error('Domain must provide distinct original 12-digit HUCs');
  const result = clone(bank), byReach = new Map(), seen = new Set();
  for (const relation of relations) {
    for (const field of ['native_reach_id','native_feature_id','huc12','geometry_source_id',
      'geometry_sha256','domain_sha256','source_crs','comparison_crs','measure_unit','relation'])
      if (relation[field] === undefined || relation[field] === '') throw new Error('Relation missing ' + field);
    if (!allowed.has(relation.huc12)) throw new Error('Relation refers outside selected domain');
    if (!['positive_length','positive_area','point_covered','boundary_touch'].includes(relation.relation))
      throw new Error('Unknown geometry relation');
    if (relation.relation.startsWith('positive_') && !(Number(relation.intersection_measure) > 0))
      throw new Error('Positive-dimensional relation needs actual positive measure');
    const key=JSON.stringify([relation.geometry_sha256,relation.native_feature_id,relation.huc12,relation.relation]);
    if(seen.has(key)) throw new Error('Repeated original feature-HUC relationship'); seen.add(key);
    const list=byReach.get(relation.native_reach_id)||[];list.push(clone(relation));byReach.set(relation.native_reach_id,list);
  }
  const joined = new Set();
  for (const record of result.records) {
    const all = byReach.get(record.native_reach_id) || [];
    const included = all.filter(r => r.relation !== 'boundary_touch');
    if(included.length) joined.add(record.native_reach_id);
    record.geography = {
      basis:'original_reach_geometry_intersection',
      huc12s:uniq(included.map(r=>r.huc12)).sort(),
      reach_feature_ids:uniq(included.map(r=>String(r.native_feature_id))),
      relations:all,
      status:included.length ? 'intersects_selected_domain' : all.length ? 'boundary_touch_only' : 'no_selected_relation',
      meaning:'A HUC may contain only part of an assessed reach; its inclusion does not label every water in the HUC.'
    };
  }
  result.geometry_relations=clone(relations);
  result.geographic_summary={
    selected_domain_huc_count:allowed.size,
    intersecting_reach_count:joined.size,
    intersecting_record_count:result.records.filter(r=>r.geography.huc12s.length).length,
    intersecting_huc_count:new Set(result.records.flatMap(r=>r.geography.huc12s)).size,
    supplied_relation_count:relations.length,
    unknown_relation_reach_ids:[...byReach.keys()].filter(id=>!result.records.some(r=>r.native_reach_id===id)).sort()
  };
  return result;
}

/** Existing scientific composer uses [heading, blocks] section tuples. */
export function georgiaReportSection(bank, {basin='Savannah', requireGeography=false, includeReachTable=false}={}) {
  const rows=bank.records.filter(r=>r.basin_raw===basin &&
    (!requireGeography || r.geography.huc12s.length));
  const count=(s)=>rows.filter(r=>r.overall_assessment===s).length;
  const paragraphs=[
    'Georgia approved 2024 assessment context: '+rows.length+' source rows covering '+
      new Set(rows.map(r=>r.native_reach_id)).size+' assessed reaches. EPA approval:3 September 2024.',
    count('supporting')+' rows Supporting; '+count('not_supporting')+
      ' Not Supporting; '+count('assessment_pending')+' Assessment Pending.',
    requireGeography ?
      'Selected reaches intersect the original study-domain polygons. A reach can cross multiple HUCs; row counts and HUC counts measure different things.' :
      'Selection is the publisher Savannah River Basin. Study-domain membership is reported separately when original reach geometry is joined.',
    'Original source format: '+(bank.source.source_format||'original_workbook_rows')+'. GIS capture and workbook editions retain separate source identities.',
    'The overall row assessment can summarize different designated uses and pollutants. Categories, causes, uses and original notes remain together; a mixed row does not mean every use fails.',
    'Bacteria can retain an earlier fecal-coliform impairment while indicator-specific assessment is pending. These listing rows are separate from the current captured E. coli monitoring cohort.'
  ];
  const categoryRows=Object.entries(GEORGIA_METHOD.categories).map(([code,definition])=>{
    const selected=rows.filter(r=>r.categories.some(c=>c.code===code));
    return [code,definition.label,selected.length,
      new Set(selected.map(r=>r.native_reach_id)).size,definition.on_303d_list?'Yes':'No'];
  }).filter(row=>row[2]);
  const blocks=[...paragraphs,{
    kind:'table', columns:['Category','Publisher meaning','Source rows','Unique reaches','303(d)'],
    rows:categoryRows, widths:[.10,.50,.12,.16,.12]
  },'Category counts can overlap when one source row retains multiple categories; they do not sum to a unique total.'];
  if(requireGeography) {
    const hucs=uniq(rows.flatMap(r=>r.geography.huc12s)).sort();
    blocks.push({kind:'table',columns:['Original HUC12','Assessed reaches','Supporting reaches','Impaired reaches','Pending reaches','303(d) reaches'],
      rows:hucs.map(huc=>{
        const selected=rows.filter(r=>r.geography.huc12s.includes(huc));
        const countStatus=status=>new Set(selected.filter(r=>r.overall_assessment===status).map(r=>r.native_reach_id)).size;
        return [huc,new Set(selected.map(r=>r.native_reach_id)).size,
          countStatus('supporting'),countStatus('not_supporting'),countStatus('assessment_pending'),
          new Set(selected.filter(r=>r.on_303d_list===true).map(r=>r.native_reach_id)).size];
      }), widths:[.20,.16,.16,.16,.16,.16]});
    blocks.push('A reach can appear in more than one watershed. Summing watershed rows is not the number of unique reaches in the study.');
  }
  if(includeReachTable) blocks.push({
    kind:'table',
    columns:['Reach ID','Reach / location','Overall assessment','Categories','Cause','HUC relation','Publisher notes'],
    rows:rows.map(r=>[r.native_reach_id,r.reach_name+' — '+r.reach_location,
      r.overall_assessment_raw,r.categories.map(c=>c.code).join(', '),r.cause_raw,
      r.geography.huc12s.join(', ')||r.geography.status||'Not yet joined',r.notes]),
    widths:[.12,.18,.10,.07,.12,.12,.29]
  });
  blocks.push({kind:'links',items:[{title:'Complete original normalized assessment rows and notes',path:'assessments.json'}]});
  return ['Georgia approved 2024 assessed reaches',blocks];
}

/** Normalize original ArcGIS feature responses as their own publisher edition. */
export function normalizeGeorgiaFeatureSources(selection, captureBodies, identity) {
  if(selection.schema!=='upstate.georgia-feature-selection/v1')
    throw new Error('Select original Georgia feature-response captures');
  if(typeof identity!=='function') throw new Error('Supply SHA-256 identity function');
  const edition=selection.source;
  if(!edition?.id || !edition?.uri || !Array.isArray(selection.captures) || !selection.captures.length)
    throw new Error('Retain source identity and original capture selection');
  if(edition?.assessment_cycle!==2024 || edition?.publication_status!=='EPA-approved' ||
     edition?.approval_date!=='2024-09-03')
    throw new Error('Select the approved Georgia2024 publisher edition');
  const columns={reach_id:'ReachID',reach_name:'Name',reach_location:'Location',
    county:'County',basin:'Basin',uses:'Uses',assessment:'Assessment',category:'Category',
    causes:'Cause',sources:'Source',data_provider:'DataSource',size:'Size',unit:'SizeUnit',
    priority:'Priority',notes:'Notes',...(selection.columns||{})};
  const manifestBody=JSON.stringify(selection), source={...clone(edition),
    source_format:'arcgis_feature_response',identity_basis:'ordered_original_capture_manifest',
    sha256:identity(manifestBody),bytes:unescape(encodeURIComponent(manifestBody)).length,
    captures:clone(selection.captures)};
  const bank={schema:'upstate.georgia-assessments/v1',source,method:clone(GEORGIA_METHOD),
    records:[],non_assessment_rows:[],issues:[],original_capture_inventory:[]};
  const seenCapture=new Set(),seenFeature=new Set(),idsByLayer=new Map();
  for(const capture of selection.captures) {
    if(!capture.id || seenCapture.has(capture.id)) throw new Error('Capture IDs must be distinct');
    seenCapture.add(capture.id);
    const text=captureBodies[capture.path];
    if(typeof text!=='string') throw new Error('Missing complete original response '+capture.path);
    if(identity(text)!==capture.sha256 || unescape(encodeURIComponent(text)).length!==capture.bytes)
      throw new Error('Original feature response differs: '+capture.path);
    const original=JSON.parse(text);
    if(original.error || original.exceededTransferLimit) throw new Error('Original feature capture is incomplete');
    if(!Array.isArray(original.features) || !Array.isArray(original.fields))
      throw new Error('Complete original fields and features are required');
    const oid=capture.object_id_field||original.objectIdFieldName;
    if(!oid || original.objectIdFieldName!==oid ||
       !original.fields.some(f=>f.name===oid && f.type==='esriFieldTypeOID'))
      throw new Error('Use the original declared OID field');
    const layer=capture.layer_uri;
    if(!layer) throw new Error('Retain the original layer URI for feature identity');
    const layerIds=idsByLayer.get(layer)||new Set();
    for(const feature of original.features) {
      const featureId=feature.attributes?.[oid], key=JSON.stringify([layer,featureId]);
      if(featureId===null || featureId===undefined || seenFeature.has(key))
        throw new Error('Missing or repeated original feature identity');
      seenFeature.add(key);layerIds.add(featureId);
    }
    idsByLayer.set(layer,layerIds);
    const rowSource={...source,id:capture.id,uri:capture.uri,sha256:capture.sha256,bytes:capture.bytes};
    const rows=original.features.map((feature,index)=>({row_number:index+2,values:feature.attributes}));
    if(rows.some(r=>!r.values || typeof r.values!=='object'))
      throw new Error('Original feature lacks its attribute object');
    const normalized=normalizeSheet({name:capture.id,header_row:1,
      columns:original.fields.map(f=>f.name),rows},
      {columns,header_row:1},rowSource,identity);
    const changedIds=new Map();
    for(const record of normalized.records) {
      const index=record.source_locator.source_row-2, feature=original.features[index],
        featureId=feature.attributes[oid];
      const locator={source_id:capture.id,source_sha256:capture.sha256,
        source_path:capture.path,source_uri:capture.uri,layer_uri:layer,
        native_feature_id:featureId,native_feature_id_field:oid,
        feature_index:index,json_pointer:'/features/'+index+'/attributes'};
      const id='ga-'+identity(JSON.stringify([capture.sha256,locator.json_pointer,record.native_reach_id]));
      changedIds.set(record.id,{id,locator});
      record.id=id;record.source_locator=locator;
      record.native_feature_id=featureId;record.native_feature_id_field=oid;
      record.source_format='arcgis_feature_response';
      record.water_type_raw=feature.attributes.WaterType??null;
      bank.records.push(record);
    }
    for(const row of normalized.nonAssessmentRows) bank.non_assessment_rows.push({
      source_id:capture.id,source_sha256:capture.sha256,
      json_pointer:'/features/'+(row.source_row-2)+'/attributes',raw:row.raw});
    for(const issue of normalized.issues) {
      const mapped=changedIds.get(issue.record_id);
      const {worksheet,source_row,...rest}=issue;
      bank.issues.push({...rest,record_id:mapped?.id,...mapped?.locator});
    }
    bank.original_capture_inventory.push({id:capture.id,path:capture.path,uri:capture.uri,
      layer_uri:layer,bytes:capture.bytes,sha256:capture.sha256,
      object_id_field:oid,original_feature_count:original.features.length,
      geometry_type:original.geometryType??null,spatial_reference:clone(original.spatialReference??null),
      fields:clone(original.fields)});
  }
  for(const inventory of selection.feature_inventories||[]) {
    const text=captureBodies[inventory.path];
    if(typeof text!=='string' || identity(text)!==inventory.sha256 ||
       unescape(encodeURIComponent(text)).length!==inventory.bytes)
      throw new Error('Retain the complete original ID inventory');
    const original=JSON.parse(text), actual=idsByLayer.get(inventory.layer_uri)||new Set();
    if(original.error || !Array.isArray(original.objectIds) ||
       original.objectIdFieldName!==inventory.object_id_field)
      throw new Error('Original ID inventory lacks the declared field');
    const expected=new Set(original.objectIds);
    if(expected.size!==original.objectIds.length || expected.size!==actual.size ||
       [...expected].some(id=>!actual.has(id)))
      throw new Error('Feature responses differ from the original selected ID inventory');
  }
  const tally=key=>bank.records.reduce((counts,row)=>(counts[row[key]]=(counts[row[key]]||0)+1,counts),{});
  bank.summary={record_count:bank.records.length,
    unique_reach_count:new Set(bank.records.map(r=>r.native_reach_id)).size,
    original_feature_count:seenFeature.size,source_format:'arcgis_feature_response',
    by_basin:tally('basin_raw'),by_assessment:tally('overall_assessment'),
    on_303d_record_count:bank.records.filter(r=>r.on_303d_list===true).length,
    unknown_303d_status_count:bank.records.filter(r=>r.on_303d_list===null).length,
    issues_count:bank.issues.length,non_assessment_row_count:bank.non_assessment_rows.length,
    geography_basis:'publisher feature attributes; original study-domain geometry is joined separately'};
  return bank;
}

async function emitGeorgiaFeatureSources(args,inputDocument,input) {
  const sha=value=>createHash('sha256').update(value).digest('hex');
  const root=dirname(resolve(args.input)), output=resolve(args.output), bodies={}, retained=[];
  await mkdir(output,{recursive:true});
  for(const item of [...inputDocument.captures,...(inputDocument.companions||[])]) {
    const path=resolve(root,item.path);
    if(!path.startsWith(root+'/')) throw new Error('Original source path escapes selection directory');
    const body=await readFile(path);
    if(body.length!==item.bytes || sha(body)!==item.sha256)
      throw new Error('Original source changed: '+item.path);
    if(bodies[item.path]!==undefined) throw new Error('Repeated original source path');
    bodies[item.path]=body.toString('utf8');
    const relative='originals/'+item.path,target=resolve(output,relative);
    if(!target.startsWith(output+'/')) throw new Error('Original source path escapes output');
    await mkdir(dirname(target),{recursive:true});await writeFile(target,body);
    retained.push({path:relative,bytes:body.length,sha256:sha(body)});
  }
  let bank=normalizeGeorgiaFeatureSources(inputDocument,bodies,sha);
  if(Boolean(args.relations)!==Boolean(args['domain-hucs']))
    throw new Error('Supply both original relations and domain HUCs');
  if(args.relations) bank=attachGeorgiaGeography(bank,
    JSON.parse(await readFile(args.relations,'utf8')),JSON.parse(await readFile(args['domain-hucs'],'utf8')));
  await writeFile(join(output,'original-feature-selection.json'),input);
  retained.push({path:'original-feature-selection.json',bytes:input.length,sha256:sha(input)});
  const entries=[];
  for(const [path,value,kind,role,title] of [
    ['assessments.json',bank,'table','GEORGIA_ASSESSMENT_REACHES','Georgia2024 original GIS reach assessments'],
    ['report-section.json',georgiaReportSection(bank,{requireGeography:Boolean(args.relations)}),
      'document','REPORT_SECTION','Georgia2024 original GIS assessment context']]) {
    const body=JSON.stringify(value,null,2)+'\n';await writeFile(join(output,path),body);
    entries.push({id:'ga2024-gis-'+path.replace(/[^a-z0-9]+/gi,'-'),title,uri:bank.source.uri,
      vintage:'Georgia2024 approved list; captured GIS publisher edition',kind,role,path,
      bytes:Buffer.byteLength(body),sha256:sha(body),jurisdiction:'GA',assessment_cycle:2024,
      publication_status:'EPA-approved',source_format:'arcgis_feature_response',
      companions:retained});
  }
  await writeFile(join(output,'sources.json'),JSON.stringify({schema:'upstate.sources/v1',
    title:'Georgia2024 original GIS assessment context',captured_at:bank.source.captured_at,
    scope:inputDocument.scope||'Original publisher-selected feature responses',
    notes:'Original publisher GIS captures remain separate from the original workbook edition.',
    entries},null,2)+'\n');
  process.stdout.write(JSON.stringify({output,summary:bank.summary,
    geographic_summary:bank.geographic_summary,manifest:join(output,'sources.json')})+'\n');
}

async function main(argv) {
  const args={};
  for(let i=0;i<argv.length;i+=2) {
    if(!argv[i]?.startsWith('--') || argv[i+1]===undefined) throw new Error('Arguments require --name value');
    args[argv[i].slice(2)]=argv[i+1];
  }
  for(const key of ['input','output'])
    if(!args[key]) throw new Error('Required --'+key);
  const originalInput=await readFile(args.input), selectedInput=JSON.parse(originalInput.toString('utf8'));
  if(selectedInput.schema==='upstate.georgia-feature-selection/v1')
    return emitGeorgiaFeatureSources(args,selectedInput,originalInput);
  for(const key of ['configuration','original-workbook'])
    if(!args[key]) throw new Error('Required --'+key);
  const sha=value=>createHash('sha256').update(value).digest('hex');
  const configuration=JSON.parse(await readFile(args.configuration,'utf8'));
  const original=await readFile(args['original-workbook']);
  if(sha(original)!==configuration.source.sha256 || original.length!==configuration.source.bytes)
    throw new Error('Original workbook bytes differ from selected edition');
  const input=await readFile(args.input), inputDocument=JSON.parse(input.toString('utf8'));
  let workbook=inputDocument, selectedConfiguration=configuration;
  const retainedExportFiles=[];
  if(inputDocument.schema==='commons.original-workbook-cells/v1') {
    const exportRoot=dirname(resolve(args.input)), sheetBodies={};
    const descriptors=[
      ...inputDocument.sheets.map(s=>s.export), inputDocument.shared_strings,
      ...inputDocument.package_members.map(m=>({...m,path:'package/'+m.path}))
    ];
    for(const descriptor of descriptors) {
      const path=resolve(exportRoot,descriptor.path);
      if(!path.startsWith(exportRoot+'/')) throw new Error('Original export member escapes its directory');
      const body=await readFile(path);
      if(body.length!==descriptor.bytes || sha(body)!==descriptor.sha256)
        throw new Error('Original worksheet export member changed: '+descriptor.path);
      retainedExportFiles.push({path:descriptor.path,body});
      if(inputDocument.sheets.some(s=>s.export.path===descriptor.path))
        sheetBodies[descriptor.path]=JSON.parse(body.toString('utf8'));
    }
    const adapted=adaptOriginalWorkbookCells(inputDocument,sheetBodies,configuration);
    workbook=adapted.workbook;selectedConfiguration=adapted.configuration;
  }
  let bank=normalizeGeorgiaWorkbook(workbook,selectedConfiguration,sha);
  bank.worksheet_export={filename:basename(args.input),bytes:input.length,sha256:sha(input),
    schema:inputDocument.schema||'explicit_original_rows',
    original_headers:workbook.worksheets.map(s=>({name:s.name,headers:s.original_headers||s.columns})),
    selected_column_bindings:selectedConfiguration.worksheets};
  if(args.relations || args['domain-hucs']) {
    if(!args.relations || !args['domain-hucs']) throw new Error('Supply both relations and domain-hucs');
    bank=attachGeorgiaGeography(bank,JSON.parse(await readFile(args.relations,'utf8')),
      JSON.parse(await readFile(args['domain-hucs'],'utf8')));
  }
  const output=resolve(args.output);await mkdir(output,{recursive:true});
  const files=[];
  async function emit(name,body,kind,role,title) {
    await writeFile(join(output,name),body);
    files.push({id:'ga2024-'+name.replace(/[^a-z0-9]+/gi,'-'),title,uri:configuration.source.uri,
      vintage:'Georgia 2024; EPA-approved 2024-09-03',kind,role,path:name,
      bytes:Buffer.byteLength(body),sha256:sha(body),jurisdiction:'GA',assessment_cycle:2024,
      publication_status:'EPA-approved',approval_date:'2024-09-03'});
  }
  await emit('assessments.json',JSON.stringify(bank,null,2)+'\n','table','GEORGIA_ASSESSMENT_REACHES','Georgia approved 2024 original assessment rows');
  await emit('report-section.json',JSON.stringify(georgiaReportSection(bank,{
    requireGeography:Boolean(args.relations)}),null,2)+'\n','document','REPORT_SECTION','Georgia approved 2024 jurisdiction context');
  const originalName='original-'+basename(args['original-workbook']);
  await copyFile(args['original-workbook'],join(output,originalName));
  const exportName=retainedExportFiles.length?'original-workbook-export/manifest.json':'original-worksheet-export.json';
  await mkdir(dirname(join(output,exportName)),{recursive:true});
  await writeFile(join(output,exportName),input);
  const retainedExportCompanions=[];
  for(const item of retainedExportFiles) {
    const path='original-workbook-export/'+item.path;
    await mkdir(dirname(join(output,path)),{recursive:true});await writeFile(join(output,path),item.body);
    retainedExportCompanions.push({path,bytes:item.body.length,sha256:sha(item.body)});
  }
  if(retainedExportFiles.length) {
    const path='original-workbook-export/'+inputDocument.original.path;
    const target=resolve(output,path);
    if(!target.startsWith(output+'/')) throw new Error('Original workbook export path escapes output');
    await mkdir(dirname(target),{recursive:true});await writeFile(target,original);
    retainedExportCompanions.push({path,bytes:original.length,sha256:sha(original)});
  }
  const configName='normalization-configuration.json';
  const configBody=JSON.stringify(configuration,null,2)+'\n';
  await writeFile(join(output,configName),configBody);
  for(const entry of files) entry.companions=[
    {path:configName,bytes:Buffer.byteLength(configBody),sha256:sha(configBody)},
    {path:originalName,bytes:original.length,sha256:sha(original)},
    {path:exportName,bytes:input.length,sha256:sha(input)},
    ...retainedExportCompanions
  ];
  const manifest={schema:'upstate.sources/v1',title:'Georgia approved 2024 reach assessment context',
    captured_at:configuration.source.captured_at,scope:'Georgia statewide selected worksheets; report selects publisher Savannah River Basin and original study-domain geometry where joined',
    notes:'Native assessed ReachID is separate from HUC and monitoring station identity.',entries:files};
  await writeFile(join(output,'sources.json'),JSON.stringify(manifest,null,2)+'\n');
  process.stdout.write(JSON.stringify({output,summary:bank.summary,geographic_summary:bank.geographic_summary,manifest:join(output,'sources.json')})+'\n');
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main(process.argv.slice(2)).catch(error=>{console.error(error.stack||error);process.exitCode=1;});
