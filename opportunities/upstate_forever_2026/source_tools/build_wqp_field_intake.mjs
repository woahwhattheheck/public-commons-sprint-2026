import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const FILES = {
  stations: 'three-lake-stations-original.csv',
  activities: 'three-lake-activities-2023-original.csv',
  results: 'three-lake-results-2023-original.csv',
};
const PIN = '901998901297e02412f414dfbac9f0222f5f6f75';
const SOURCE_PREFIX = 'opportunities/upstate_forever_2026/observations/eighteenmile_2023/wqp_20261013/';
const EXPECTED = {
  stations: '85a33ed59d36327d6ec127e9d2f83cf688095103ef887b7ab1d408b45d4ec8e3',
  activities: '8118f52771b1bc87822e821f52c4980bdd8ab3471c8a5b790a9c8129ccf72f85',
  results: '5b22e3de1a4311963b2ed616886273788bd485897f276663157a7137ce0aaa61',
};
const sha256 = text => createHash('sha256').update(text, 'utf8').digest('hex');

export function parseCsv(text){
const rows=[];let row=[],cell="",quoted=false,afterQuote=false;
for(let i=0;i<text.length;i++){const ch=text[i];if(quoted){if(ch==='"'){if(text[i+1]==='"'){cell+='"';i++;}else{quoted=false;afterQuote=true;}}else cell+=ch;continue;}
if(afterQuote&&ch!==','&&ch!=='\r'&&ch!=='\n')throw Error("CSV text after closing quote");
if(ch==='"'){if(cell)throw Error("Quote inside unquoted CSV field");quoted=true;continue;}
if(ch===','){row.push(cell);cell="";afterQuote=false;continue;}
if(ch==='\n'||ch==='\r'){if(ch==='\r'&&text[i+1]==='\n')i++;row.push(cell);rows.push(row);row=[];cell="";afterQuote=false;continue;}
cell+=ch;}
if(quoted)throw Error("Unclosed CSV quote");if(row.length||cell||afterQuote){row.push(cell);rows.push(row);}
if(!rows.length)throw Error("EmptyCSV");const headers=rows.shift();headers[0]=headers[0].replace(/^\uFEFF/,"");if(new Set(headers).size!==headers.length)throw Error("Duplicateheaders");
return{headers,rows:rows.map((r,i)=>{if(r.length!==headers.length)throw Error("Column mismatch row"+(i+2));return Object.fromEntries(headers.map((h,j)=>[h,r[j]]));})};}

function unique(rows, key, label) {
  const mapped = new Map();
  rows.forEach((row, index) => {
    const id = row[key];
    if (!id || mapped.has(id)) throw Error(label + ' requires distinct nonempty ' + key);
    mapped.set(id, { row, index });
  });
  return mapped;
}

function recordedTime(row) {
  const date = row.ActivityStartDate, time = row['ActivityStartTime/Time'];
  const zone = row['ActivityStartTime/TimeZoneCode'];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}:\d{2}$/.test(time))
    throw Error('Original collection time is incomplete: ' + row.ActivityIdentifier);
  // All original source records explicitly say EST, including summer records.
  // Preserve that fixed offset; do not reinterpret the source as civil EDT.
  if (zone !== 'EST') throw Error('This edition requires the original recorded EST code: ' + zone);
  const stamp = date + 'T' + time + '-05:00';
  if (!Number.isFinite(Date.parse(stamp))) throw Error('Invalid original collection timestamp');
  return stamp;
}

export function buildWqpFieldIntake(sourceTexts, { createdAt } = {}) {
  if (typeof createdAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(createdAt)
      || !Number.isFinite(Date.parse(createdAt))) throw Error('Supply the actual preparation timestamp in UTC.');
  const tables = {}, sourceLinks = [];
  for (const [kind, file] of Object.entries(FILES)) {
    const text = sourceTexts[file];
    if (typeof text !== 'string' || sha256(text) !== EXPECTED[kind])
      throw Error('Original WQP source changed or is absent: ' + file);
    tables[kind] = parseCsv(text);
    sourceLinks.push({
      id: 'wqp-original-' + kind, kind: 'original_public_observation_source',
      label: 'Original WQP ' + kind + ' CSV',
      reference: 'https://raw.githubusercontent.com/woahwhattheheck/public-commons-sprint-2026/' + PIN + '/' + SOURCE_PREFIX + file,
      sha256: EXPECTED[kind],
      bytes: new TextEncoder().encode(text).length,
      filename: file,
      source_uri: 'https://www.waterqualitydata.us/',
      source_rows: tables[kind].rows.length,
    });
  }
  const stationIndex = unique(tables.stations.rows, 'MonitoringLocationIdentifier', 'Stations');
  const activityIndex = unique(tables.activities.rows, 'ActivityIdentifier', 'Activities');
  if (stationIndex.size !== 3 || activityIndex.size !== 88 || tables.results.rows.length !== 88)
    throw Error('Original three-lake edition has changed.');
  const resultCounts = { numeric: 0, censored: 0 };
  const resultActivities = new Set();
  for (const row of tables.results.rows) {
    const match = activityIndex.get(row.ActivityIdentifier);
    if (!match || match.row.MonitoringLocationIdentifier !== row.MonitoringLocationIdentifier)
      throw Error('Result lacks its exact original activity/site join: ' + row.ActivityIdentifier);
    for (const field of ['ActivityStartDate', 'ActivityStartTime/Time', 'ActivityStartTime/TimeZoneCode'])
      if (match.row[field] !== row[field]) throw Error('Result/activity collection times differ.');
    const condition = row.ResultDetectionConditionText;
    if (condition === 'Present Above Quantification Limit') {
      if (!row.ResultMeasureValue.trim() || !Number.isFinite(Number(row.ResultMeasureValue)))
        throw Error('Original numeric result is absent or invalid.');
      resultCounts.numeric++;
    } else if (condition === 'Below Reporting Limit') {
      if (row.ResultMeasureValue !== '') throw Error('Original censored result unexpectedly has a numeric value.');
      if (row['DetectionQuantitationLimitMeasure/MeasureUnitCode'] !== 'ug/L')
        throw Error('Original reporting-limit unit changed.');
      resultCounts.censored++;
    } else throw Error('Unmapped original detection condition: ' + condition);
    resultActivities.add(row.ActivityIdentifier);
  }
  if (resultActivities.size !== activityIndex.size || resultCounts.numeric !== 82 || resultCounts.censored !== 6)
    throw Error('Original result coverage has changed.');
  const plan = {
    schema: 'upstate.implementation-plan/v1',
    id: 'eighteenmile-2023-original-lake-samples',
    revision: 0,
    title: 'Eighteenmile 2023 — original lake samples',
    description: 'Historical SCDES sampling records at SV-838, SV-839 and SV-840, recovered from the Water Quality Portal. The sites and original sample activities are ready to receive their original laboratory CSV through the maintained fieldwork importer.',
    start_date: tables.activities.rows.map(row => row.ActivityStartDate).sort()[0],
    currency: 'USD', working_days: [1, 2, 3, 4, 5], holidays: [],
    created_at: createdAt, updated_at: createdAt,
    source_links: sourceLinks, candidates: [], tasks: [], budget_lines: [],
    sites: [], monitoring_plans: [], visits: [], activities: [], observations: [],
    source_preparation: {
      schema: 'upstate.wqp-field-intake/v1',
      prepared_at: createdAt, original_commit: PIN,
      original_source_directory: SOURCE_PREFIX,
      original_result_rows: 88, expected_numeric_results: 82, expected_censored_results: 6,
      event_interpretation: 'Each native visit represents one original station/collection-time event. Its completed timestamp is the original sample collection timestamp, and its original sample activities retain their individual source rows.',
      time_interpretation: 'The original recorded timezone is EST. Native timestamps retain fixed UTC-05:00; source date, clock and timezone strings remain intact in every original activity record.',
      coordinate_interpretation: 'Original station coordinates retain NAD83 in their source record and coordinate_reference_system.',
    },
  };
  for (const [id, { row, index }] of stationIndex) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(id)) throw Error('Station identifier cannot enter the native plan.');
    if (row.HorizontalCoordinateReferenceSystemDatumName !== 'NAD83')
      throw Error('Original coordinate datum changed.');
    const latitude = Number(row.LatitudeMeasure), longitude = Number(row.LongitudeMeasure);
    if (!row.LatitudeMeasure.trim() || !row.LongitudeMeasure.trim() || !Number.isFinite(latitude)
        || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180)
      throw Error('Original station coordinates are invalid.');
    plan.sites.push({
      id, label: row.MonitoringLocationName + ' — ' + row.MonitoringLocationDescriptionText,
      source_ref: 'wqp-original-stations', latitude, longitude,
      coordinate_reference_system: 'EPSG:4269', original_station: row,
      original_source: { source_link_id: 'wqp-original-stations', csv_record: index + 1 },
    });
  }
  const visits = new Map(), ids = new Set();
  for (const [sourceId, { row, index }] of activityIndex) {
    const siteId = row.MonitoringLocationIdentifier;
    if (!stationIndex.has(siteId)) throw Error('Activity lacks its original station.');
    const collectedAt = recordedTime(row);
    const eventKey = JSON.stringify([siteId, row.ActivityStartDate, row['ActivityStartTime/Time'], row['ActivityStartTime/TimeZoneCode']]);
    let visit = visits.get(eventKey);
    if (!visit) {
      visit = {
        id: 'wqp-visit-' + sha256(eventKey).slice(0, 24), site_id: siteId,
        status: 'complete', visited_at: collectedAt,
        observer: row.ActivityConductingOrganizationText || '',
        notes: 'Historical collection event from the original WQP activity records.',
        evidence_refs: [], original_activity_identifiers: [],
      };
      visits.set(eventKey, visit); plan.visits.push(visit);
    }
    visit.evidence_refs.push(sourceId);
    visit.original_activity_identifiers.push(sourceId);
    const id = 'wqp-activity-' + sha256(sourceId).slice(0, 24);
    if (ids.has(id)) throw Error('Native activity identity collision.');
    ids.add(id);
    const item = {
      id, visit_id: visit.id, site_id: siteId, kind: 'sample',
      sample_id: sourceId, collected_at: collectedAt,
      notes: row.ActivityCommentText || '',
      original_activity: row,
      original_source: { source_link_id: 'wqp-original-activities', csv_record: index + 1 },
    };
    if (row['SampleCollectionMethod/MethodIdentifier'])
      item.method = row['SampleCollectionMethod/MethodIdentifier'];
    plan.activities.push(item);
  }
  const mapping = {
    schema: 'upstate.implementation-lab-mapping/v1',
    delimiter: ',', encoding: 'utf-8-sig',
    columns: {
      sample_id: 'ActivityIdentifier', site_id: 'MonitoringLocationIdentifier',
      parameter: 'CharacteristicName', original_text: 'ResultMeasureValue',
      value: 'ResultMeasureValue', result_type: 'ResultDetectionConditionText',
      unit: 'ResultMeasure/MeasureUnitCode', fraction: 'ResultSampleFractionText',
      qualifier: 'ResultDetectionConditionText',
      method: 'ResultAnalyticalMethod/MethodIdentifier', qa_status: 'ResultStatusIdentifier',
      notes: 'ResultCommentText',
    },
    fallback_columns: {
      original_text: ['ResultDetectionConditionText'],
      unit: ['DetectionQuantitationLimitMeasure/MeasureUnitCode'],
    },
    constants: {},
    result_type_values: {
      'Present Above Quantification Limit': 'numeric',
      'Below Reporting Limit': 'censored',
    },
    decimal_separator: '.', fill_missing_collection_times: false, row_actions: {},
  };
  const coverage = {
    schema: 'upstate.wqp-field-intake-coverage/v1',
    source_hashes: EXPECTED, plan_id: plan.id, sites: plan.sites.length,
    collection_events: plan.visits.length, sample_activities: plan.activities.length,
    expected_csv_rows: tables.results.rows.length, expected_result_types: resultCounts,
    source_mapping: 'Every raw result maps by exact ActivityIdentifier and MonitoringLocationIdentifier.',
    limit_interpretation: 'Original Lower Reporting Limit type, value and unit stay in the retained CSV. This preparation does not relabel that field as a detection limit or quantitation limit.',
  };
  return { plan, mapping, coverage };
}

function main(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    if (!['--source', '--output', '--created-at'].includes(key) || !argv[i + 1])
      throw Error('Use --source ORIGINAL_WQP_DIRECTORY --output NEW_DIRECTORY --created-at UTC_TIMESTAMP.');
    if (options[key]) throw Error('Duplicate option: ' + key);
    options[key] = argv[i + 1];
  }
  if (!options['--source'] || !options['--output'] || !options['--created-at'])
    throw Error('Use --source ORIGINAL_WQP_DIRECTORY --output NEW_DIRECTORY --created-at UTC_TIMESTAMP.');
  const source = path.resolve(options['--source']), output = path.resolve(options['--output']);
  if (fs.existsSync(output)) throw Error('Choose a new output directory to preserve an existing field package.');
  const sourceTexts = Object.fromEntries(Object.values(FILES).map(file => [file, fs.readFileSync(path.join(source, file), 'utf8')]));
  const built = buildWqpFieldIntake(sourceTexts, { createdAt: options['--created-at'] });
  fs.mkdirSync(output, { recursive: true });
  for (const [name, value] of Object.entries({ 'plan.json': built.plan, 'mapping.json': built.mapping, 'coverage.json': built.coverage }))
    fs.writeFileSync(path.join(output, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
  for (const [file, text] of Object.entries(sourceTexts))
    fs.writeFileSync(path.join(output, file), text, { encoding: 'utf8', flag: 'wx' });
  process.stdout.write(JSON.stringify({ output, ...built.coverage }, null, 2) + '\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
