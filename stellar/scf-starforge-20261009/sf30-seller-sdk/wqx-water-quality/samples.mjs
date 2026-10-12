// MIT. Organization-aware WQX3 sample/result joins; native strings and every limit remain intact.
import { readProfiles, canonicalJson, sha256, valueState, recordIdentity, PROFILES } from './provider.mjs';

export const JOIN_SCHEMA = 'starforge.wqx-water-quality-joins.v1';
const own = (record, key) => Object.prototype.hasOwnProperty.call(record, key);
const field = (record, key) => own(record, key) ? record[key] : null;
const present = value => value !== null && value !== undefined && value !== '';
const tuple = values => values.every(present) ? canonicalJson(values) : null;
const base = record => [field(record, 'ProviderName'), field(record, 'Org_Identifier')];
const resultKey = record => tuple([...base(record), field(record, 'Activity_ActivityIdentifier'), field(record, 'Result_MeasureIdentifier')]);
const activityKey = record => tuple([...base(record), field(record, 'Activity_ActivityIdentifier')]);
const stationKey = record => tuple([...base(record), field(record, 'Location_Identifier')]);
const FLAT = Object.freeze({
  provider: 'ProviderName', organizationId: 'Org_Identifier', organizationName: 'Org_FormalName',
  locationId: 'Location_Identifier', locationName: 'Location_Name', locationType: 'Location_Type',
  activityId: 'Activity_ActivityIdentifier', activityIdUserSupplied: 'Activity_ActivityIdentifierUserSupplied',
  resultId: 'Result_MeasureIdentifier', activityType: 'Activity_TypeCode', media: 'Activity_Media', mediaSubdivision: 'Activity_MediaSubdivision',
  date: 'Activity_StartDate', time: 'Activity_StartTime', timeZone: 'Activity_StartTimeZone', endDate: 'Activity_EndDate', endTime: 'Activity_EndTime', endTimeZone: 'Activity_EndTimeZone',
  characteristic: 'Result_Characteristic', characteristicComparable: 'Result_CharacteristicComparable', characteristicGroup: 'Result_CharacteristicGroup', parameterCode: 'USGSpcode',
  sampleFraction: 'Result_SampleFraction', methodSpeciation: 'Result_MethodSpeciation', value: 'Result_Measure', unit: 'Result_MeasureUnit',
  detectionCondition: 'Result_ResultDetectionCondition', valueType: 'Result_MeasureType', qualifier: 'Result_MeasureQualifierCode', status: 'Result_MeasureStatusIdentifier',
  statisticalBase: 'Result_StatisticalBase', statisticalN: 'Result_StatisticalNValue', weightBasis: 'Result_WeightBasis', timeBasis: 'Result_TimeBasis',
  temperatureBasis: 'Result_MeasureTemperatureBasis', particleSizeBasis: 'Result_MeasureParticleSizeBasis',
  methodIdentifier: 'ResultAnalyticalMethod_Identifier', methodContext: 'ResultAnalyticalMethod_IdentifierContext', methodName: 'ResultAnalyticalMethod_Name',
  comparableMethodIdentifier: 'Result_ComparableMethodIdentifier', comparableMethodContext: 'Result_ComparableMethodIdentifierContext', comparableMethodModification: 'Result_ComparableMethodModification',
  sampleCollectionMethodIdentifier: 'SampleCollectionMethod_Identifier', sampleCollectionMethodContext: 'SampleCollectionMethod_IdentifierContext',
  samplePreparationMethodIdentifier: 'SamplePrepMethod_Identifier', samplePreparationMethodContext: 'SamplePrepMethod_IdentifierContext',
  labPreparationMethodIdentifier: 'LabSamplePrepMethod_Identifier', labPreparationMethodContext: 'LabSamplePrepMethod_IdentifierContext',
  labName: 'LabInfo_Name', resultComment: 'DataQuality_ResultComment', lastChangeDate: 'LastChangeDate',
  depthHeight: 'Activity_DepthHeightMeasure', depthHeightUnit: 'Activity_DepthHeightMeasureUnit', relativeDepth: 'Activity_ActivityRelativeDepth',
  resultDepthHeight: 'ResultDepthHeight_Measure', resultDepthHeightUnit: 'ResultDepthHeight_MeasureUnit', resultDepthReference: 'ResultDepthHeight_AltitudeReferencePoint',
  resultDepthSamplingPoint: 'ResultDepthHeight_SamplingPointName', resultDepthSamplingPointType: 'ResultDepthHeight_SamplingPointType',
  topDepth: 'Activity_TopDepthMeasure', topDepthUnit: 'Activity_TopDepthMeasureUnit', bottomDepth: 'Activity_BottomDepthMeasure', bottomDepthUnit: 'Activity_BottomDepthMeasureUnit',
  hydrologicCondition: 'Activity_HydrologicCondition', hydrologicEvent: 'Activity_HydrologicEvent'
});
function indexBy(rows, keyOf = row => row.key) {
  const index = new Map();
  for (const row of rows) { const key = keyOf(row); if (key !== null) { const group = index.get(key) ?? []; group.push(row); index.set(key, group); } }
  return index;
}
function normalizeLimit(envelope, origin, suffix = '') {
  const record = envelope.record, prefix = name => 'DetectionLimit_' + name + suffix;
  const value = field(record, prefix('Measure'));
  return { id: origin === 'profile' ? envelope.id : 'wqx-limit-' + sha256(canonicalJson([envelope.id, suffix])), resultKey: resultKey(record), activityKey: activityKey(record), stationKey: stationKey(record),
    type: field(record, prefix('Type')), value, valueState: valueState(value), unit: field(record, prefix('MeasureUnit')), comment: field(record, prefix('Comment')),
    origin, record, source: { ...envelope.source, ...(suffix ? { columns: ['Type', 'Measure', 'MeasureUnit', 'Comment'].map(prefix) } : {}) },
    duplicate: envelope.duplicate, conflictingDuplicate: envelope.conflictingDuplicate };
}
function embeddedLimits(envelope) {
  const result = [];
  for (const suffix of ['A', 'B']) {
    const limit = normalizeLimit(envelope, 'result-' + suffix, suffix);
    if ([limit.type, limit.value, limit.unit, limit.comment].some(present)) result.push(limit);
  }
  return result;
}
function issue(code, details = {}) { return { code, ...details }; }
function profileCoverage(capture) {
  return Object.fromEntries(PROFILES.map(profile => {
    const resources = capture.resources.filter(row => row.profile === profile);
    return [profile, { selected: resources.length > 0, resources: resources.length, complete: resources.length > 0 && resources.every(row => row.status === 'COMPLETE'), available: resources.filter(row => row.dataAvailable).length,
      rows: resources.filter(row => row.dataAvailable).reduce((sum, row) => sum + row.rowCount, 0),
      failures: resources.filter(row => row.status === 'ERROR').map(row => ({ resourceId: row.id, url: row.url, status: row.responseStatus ?? null, error: row.error ?? null })) }];
  }));
}
function count(values) {
  const result = {};
  for (const value of values) { const key = value === null ? '(absent)' : value === '' ? '(empty)' : String(value); result[key] = (result[key] ?? 0) + 1; }
  return result;
}

/** No result is overwritten by another version, and no foreign organization is joined by a bare ID. */
export async function joinCapture(input) {
  const { capture, profiles } = await readProfiles(input);
  const stations = profiles.Station, activities = profiles.Activity, originals = profiles.Result, limits = profiles.ResultDetectionQuantitationLimit;
  const stationIndex = indexBy(stations), activityIndex = indexBy(activities), resultIndex = indexBy(originals), limitIndex = indexBy(limits, row => resultKey(row.record));
  const coverage = profileCoverage(capture), issues = [], rows = [];
  const add = value => { issues.push(value); return value; };
  for (const envelope of [...stations, ...activities, ...limits]) {
    if (envelope.key === null) add(issue('MISSING_NATIVE_IDENTITY', { profile: envelope.profile, recordId: envelope.id, source: envelope.source }));
    if (envelope.conflictingDuplicate && !envelope.duplicate) add(issue('CONFLICTING_PROFILE_VERSION', { profile: envelope.profile, key: envelope.key, recordId: envelope.id, source: envelope.source }));
  }
  for (const envelope of originals) {
    const original = envelope.record;
    const row = { schema: 'starforge.wqx-sample-result.v1', id: envelope.id, resultKey: envelope.key, activityKey: activityKey(original), stationKey: stationKey(original),
      ...Object.fromEntries(Object.entries(FLAT).map(([name, header]) => [name, field(original, header)])),
      valueState: valueState(field(original, 'Result_Measure')), record: original, recordSha256: envelope.recordSha256, source: envelope.source,
      duplicate: envelope.duplicate, conflictingDuplicate: envelope.conflictingDuplicate, stationRecords: [], activityRecords: [], limits: [], issues: [] };
    const rowIssue = (code, details) => { const value = issue(code, { resultId: row.resultId, recordId: row.id, ...(details ?? {}) }); row.issues.push(value); add(value); };
    if (row.resultKey === null) rowIssue('MISSING_RESULT_IDENTITY');
    if (row.stationKey === null) rowIssue('MISSING_STATION_IDENTITY');
    if (row.activityKey === null) rowIssue('MISSING_ACTIVITY_IDENTITY');
    if (row.conflictingDuplicate) rowIssue('CONFLICTING_RESULT_VERSION', { key: row.resultKey });
    row.stationRecords = stationIndex.get(row.stationKey) ?? [];
    row.activityRecords = activityIndex.get(row.activityKey) ?? [];
    if (coverage.Station.selected && !row.stationRecords.length) rowIssue('STATION_JOIN_MISSING', { key: row.stationKey });
    if (coverage.Activity.selected && !row.activityRecords.length) rowIssue('ACTIVITY_JOIN_MISSING', { key: row.activityKey });
    if (row.stationRecords.some(value => value.conflictingDuplicate)) rowIssue('STATION_JOIN_MULTIPLE_VERSIONS', { key: row.stationKey });
    if (row.activityRecords.some(value => value.conflictingDuplicate)) rowIssue('ACTIVITY_JOIN_MULTIPLE_VERSIONS', { key: row.activityKey });
    for (const activity of row.activityRecords.filter(value => !value.duplicate)) {
      const record = activity.record;
      for (const header of ['Location_Identifier', 'Activity_StartDate', 'Activity_StartTime', 'Activity_StartTimeZone', 'Activity_TypeCode', 'Activity_Media', 'Activity_MediaSubdivision']) {
        const inResult = field(original, header), inActivity = field(record, header);
        if (present(inResult) && present(inActivity) && inResult !== inActivity) rowIssue('ACTIVITY_RESULT_FIELD_DIFFERENCE', { field: header, result: inResult, activity: inActivity, activityRecordId: activity.id });
      }
    }
    const profileLimits = (limitIndex.get(row.resultKey) ?? []).map(value => normalizeLimit(value, 'profile'));
    row.limits = [...profileLimits, ...embeddedLimits(envelope)];
    for (const limit of profileLimits) if (limit.stationKey !== null && row.stationKey !== null && limit.stationKey !== row.stationKey) rowIssue('LIMIT_STATION_DIFFERENCE', { limitId: limit.id, resultStationKey: row.stationKey, limitStationKey: limit.stationKey });
    for (const limit of row.limits) if (present(limit.unit) && present(row.unit) && limit.unit !== row.unit) rowIssue('LIMIT_RESULT_UNIT_DIFFERENCE', { limitId: limit.id, resultUnit: row.unit, limitUnit: limit.unit });
    const embedded = row.limits.filter(value => value.origin !== 'profile');
    const version = limit => canonicalJson([limit.type, limit.value, limit.unit, limit.comment]);
    for (const limit of embedded) {
      limit.matchesProfileLimitIds = profileLimits.filter(value => version(value) === version(limit)).map(value => value.id);
      const comparable = profileLimits.filter(value => value.type === limit.type && value.unit === limit.unit);
      if (comparable.length && !comparable.some(value => value.value === limit.value)) rowIssue('EMBEDDED_PROFILE_LIMIT_DIFFERENCE', { limitId: limit.id, type: limit.type, embeddedValue: limit.value, profileValues: comparable.map(value => value.value) });
    }
    rows.push(row);
  }
  for (const limit of limits) {
    const key = resultKey(limit.record);
    if (key === null || !resultIndex.has(key)) add(issue('LIMIT_RESULT_JOIN_MISSING', { recordId: limit.id, resultKey: key, source: limit.source }));
  }
  const matchedActivityKeys = new Set(rows.map(row => row.activityKey).filter(present));
  const matchedStationKeys = new Set(rows.map(row => row.stationKey).filter(present));
  const uniqueRows = rows.filter(row => !row.duplicate);
  const summary = {
    status: capture.status, results: rows.length, exactUniqueResults: uniqueRows.length, exactDuplicateResults: rows.length - uniqueRows.length,
    conflictingResultVersions: uniqueRows.filter(row => row.conflictingDuplicate).length,
    stations: stations.length, distinctStationIdentities: new Set(stations.map(row => row.key).filter(present)).size,
    activities: activities.length, distinctActivityIdentities: new Set(activities.map(row => row.key).filter(present)).size,
    resultActivityIdentities: matchedActivityKeys.size, resultStationIdentities: matchedStationKeys.size,
    unmatchedActivities: activities.filter(row => row.key !== null && !matchedActivityKeys.has(row.key) && !row.duplicate).length,
    unmatchedStations: stations.filter(row => row.key !== null && !matchedStationKeys.has(row.key) && !row.duplicate).length,
    profileDetectionLimits: limits.length, embeddedDetectionLimits: uniqueRows.reduce((sum, row) => sum + row.limits.filter(limit => limit.origin !== 'profile').length, 0),
    resultsWithLimits: uniqueRows.filter(row => row.limits.length).length,
    activityTypes: count(uniqueRows.map(row => row.activityType)), valueStates: count(uniqueRows.map(row => row.valueState)),
    detectionConditions: count(uniqueRows.map(row => row.detectionCondition)), valueTypes: count(uniqueRows.map(row => row.valueType)), resultStatuses: count(uniqueRows.map(row => row.status)),
    issueCounts: count(issues.map(row => row.code)), profileCoverage: coverage
  };
  return { schema: JOIN_SCHEMA, captureSha256: capture.captureSha256, selection: capture.selection, capture, rows, stations, activities, limits, issues, summary };
}
export const joinWaterQuality = joinCapture;
