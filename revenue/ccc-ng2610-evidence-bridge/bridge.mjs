// MIT. CCC NG2610 W3: offline, source-verifiable ServiceNow/AWS/Jira evidence bridge.
// No network, credential, procurement, billing, or ticket mutation capabilities.
import {createHash} from 'node:crypto';
import {readFile, mkdir, writeFile, rename} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

const sha = value => createHash('sha256').update(value).digest('hex');
const fail = message => {throw new Error(message);};
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const object = (value, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label}: expected object`);
  return value;
};
const items = (value, label) => Array.isArray(value) ? value : fail(`${label}: expected array`);
const safeId = (value, label) => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/.test(value)) fail(`${label}: invalid identifier`);
  return value;
};
const exactTime = (value, label) => {
  if (value === '') return '';
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(value))
    fail(`${label}: require ISO-8601 timestamp with explicit timezone`);
  const timestamp = new Date(value);
  if (!Number.isFinite(timestamp.getTime())) fail(`${label}: invalid timestamp`);
  return timestamp.toISOString();
};
const lookup = (record, path, label) => {
  if (typeof path !== 'string' || !/^[A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)*$/.test(path))
    fail(`${label}: invalid explicit field map`);
  let value = record;
  for (const part of path.split('.')) {
    if (!value || typeof value !== 'object' || !own(value, part)) fail(`${label}: missing mapped field`);
    value = value[part];
  }
  // ServiceNow Table API commonly returns {value,display_value}; take explicit value only.
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    if (!own(value, 'value')) fail(`${label}: ambiguous ServiceNow field object`);
    value = value.value;
  }
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean')
    fail(`${label}: mapped field must be scalar`);
  return String(value);
};
const csv = (header, rows) => [header, ...rows].map(row => row.map(v => {
  const value = String(v ?? '');
  // RFC4180 quoting; IDs already checked against spreadsheet formula injection.
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}).join(',')).join('\r\n') + '\r\n';
const entryHash = obj => sha(Buffer.from(JSON.stringify(obj)));
const noDuplicates = (values, label) => {
  if (new Set(values).size !== values.length) fail(`${label}: duplicate identifiers`);
};
function tableRows(data, label) {
  const obj = object(data, label);
  // Table API pagination is an exporter responsibility, not a promise from this tool.
  if (obj.next_page || obj.nextPage || obj.next_token || obj.nextToken || obj.has_more === true)
    fail(`${label}: unconsumed source pagination`);
  return items(obj.result, `${label}.result`).map((record, i) => object(record, `${label} record ${i+1}`));
}
function translate(rows, fields, valueMappings, schema, kind) {
  object(fields, `${kind} explicit fields`);
  const values = valueMappings === undefined ? {} : object(valueMappings, `${kind} value mappings`);
  const converted = rows.map((record, index) => {
    const o = {};
    for (const [target, classification] of Object.entries(schema)) {
      const path = fields[target];
      let value = lookup(record, path, `${kind} ${index+1} ${target}`);
      if (classification === 'id') value = safeId(value, `${kind} ${target}`);
      if (classification === 'date') value = exactTime(value, `${kind} ${target}`);
      if (classification === 'enum') {
        if (!own(values, value) || typeof values[value] !== 'string')
          fail(`${kind} ${target}: source value has no explicit approved translation`);
        value = values[value];
        if (!/^(?:P[1-4]|success|failed|cancelled)$/.test(value)) fail(`${kind}: invalid mapped enum`);
      }
      if (classification === 'maintenance' && !['true','false',''].includes(value))
        fail(`${kind}: maintenance must be explicitly mapped to true, false or empty`);
      o[target] = value;
    }
    return o;
  });
  noDuplicates(converted.map(x => x[Object.keys(schema)[0]]), `${kind} records`);
  return converted.sort((a,b) => a[Object.keys(schema)[0]].localeCompare(b[Object.keys(schema)[0]]));
}
function cloudwatch(data, expected) {
  const obj = object(data,'CloudWatch GetMetricData');
  if (obj.NextToken || (obj.Messages && items(obj.Messages,'global messages').length))
    fail('CloudWatch: outstanding pagination or global warning; complete export first');
  const results = items(obj.MetricDataResults,'MetricDataResults');
  const sourceIds = results.map(x => safeId(object(x,'MetricDataResult').Id,'CloudWatch Id'));
  noDuplicates(sourceIds,'CloudWatch');
  const output = [];
  for (const setting of items(expected,'cloudwatch_series')) {
    const opt = object(setting,'expected series');
    const id = safeId(opt.id,'expected CloudWatch Id');
    const seconds = opt.period_seconds;
    const begin = Date.parse(opt.start), end = Date.parse(opt.end);
    if (!Number.isSafeInteger(seconds) || seconds <= 0 || seconds > 86400 ||
        !Number.isFinite(begin) || !Number.isFinite(end) || end <= begin ||
        (end-begin) % (seconds*1000) !== 0)
      fail(`CloudWatch ${id}: invalid explicit observation window/period`);
    const res = results.find(r => r.Id === id);
    if (!res) fail(`CloudWatch ${id}: expected metric missing`);
    if (res.StatusCode !== 'Complete') fail(`CloudWatch ${id}: ${res.StatusCode} not complete`);
    const timestamps = items(res.Timestamps,'CloudWatch timestamps');
    const values = items(res.Values,'CloudWatch values');
    if (timestamps.length !== values.length) fail(`CloudWatch ${id}: unpaired samples`);
    const points = new Set();
    for (let n=0;n<timestamps.length;n++) {
      const t = timestamps[n];
      // Official GetMetricData API returns Unix seconds; strings are intentionally rejected.
      if (!Number.isSafeInteger(t) || !Number.isFinite(values[n]) ||
          t*1000 < begin || t*1000 >= end || (t*1000-begin) % (seconds*1000) !== 0)
        fail(`CloudWatch ${id}: malformed/out-of-window/unaligned sample`);
      if (points.has(t)) fail(`CloudWatch ${id}: duplicate timestamp`);
      points.add(t);
    }
    const wanted = (end-begin)/(seconds*1000);
    const missing = wanted-points.size;
    if (missing < 0) fail(`CloudWatch ${id}: overfilled series`);
    output.push({id, status:'Complete', points:points.size, expected_points:wanted,
      missing_points:missing, coverage_complete:missing === 0,
      coverage_start:new Date(begin).toISOString(), coverage_end_exclusive:new Date(end).toISOString(),period_seconds:seconds});
  }
  if (new Set(output.map(x=>x.id)).size !== output.length) fail('CloudWatch: repeated expected series');
  return output.sort((a,b)=>a.id.localeCompare(b.id));
}
function reconcileJira(data, mapping, changeRows) {
  const obj = object(data,'Jira issue search');
  if (obj.nextPageToken || obj.isLast === false ||
      (Number.isInteger(obj.total) && obj.total > items(obj.issues,'Jira issues').length))
    fail('Jira: unconsumed source pagination');
  const opt = object(mapping,'jira map');
  const seenIssues = new Set();
  const crossLinks = new Map();
  for (const issue of items(obj.issues,'Jira issues')) {
    const record = object(issue,'Jira issue');
    const key = safeId(record.key,'Jira issue key');
    if (seenIssues.has(key)) fail('Jira: duplicate issue key');
    seenIssues.add(key);
    const externalId = lookup(record,opt.change_link_field,'Jira approved change link');
    if (!externalId) continue;
    safeId(externalId,'Jira change link');
    if (!crossLinks.has(externalId)) crossLinks.set(externalId,[]);
    crossLinks.get(externalId).push(key);
  }
  const known = new Set(changeRows.map(x=>x.change_id));
  const missing = [...known].filter(x=>!crossLinks.has(x)).length;
  const unlinked = [...crossLinks.keys()].filter(x=>!known.has(x)).length;
  return {issues:seenIssues.size, matched_changes:known.size-missing,
    unmatched_servicenow_changes:missing, jira_unknown_changes:unlinked,
    duplicate_links:[...crossLinks.values()].filter(x=>x.length>1).length,
    status:missing===0 && unlinked===0?'LINKS_RECONCILED_NOT_PROOF_OF_CHANGE_SUCCESS':'REVIEW_REQUIRED'};
}
const incidentSchema = {incident_id:'id', priority:'enum', opened_at:'date',investigation_at:'date',
  outage_start_at:'date',outage_end_at:'date',approved_maintenance:'maintenance'};
const changeSchema = {change_id:'id',completed_at:'date',outcome:'enum'};
export function buildEvidence(input) {
  const opt = object(input,'evidence packet');
  const config = object(opt.mapping,'explicit authorized mapping');
  if (config.schema_version !== 1 || config.source_authorized !== true ||
      typeof config.authorization_reference !== 'string' || config.authorization_reference.trim().length < 4)
    fail('Explicit operator permission/source authorization reference required; this does not itself grant access');
  const inc = translate(tableRows(opt.incidents,'ServiceNow incidents'),config.incident_fields,
    config.priority_values,incidentSchema,'ServiceNow incident');
  const ch = translate(tableRows(opt.changes,'ServiceNow changes'),config.change_fields,
    config.change_outcomes,changeSchema,'ServiceNow change');
  const validPriorities = new Set(['P1','P2','P3','P4']);
  for(const item of inc){
    if (!validPriorities.has(item.priority) || !item.opened_at) fail('ServiceNow incident: unmapped priority or opening');
    if (!!item.outage_start_at !== !!item.outage_end_at) fail('ServiceNow incident: unpaired outage');
    if (item.outage_start_at && item.outage_end_at < item.outage_start_at) fail('ServiceNow incident: inverted outage');
    if (item.investigation_at && item.investigation_at < item.opened_at) fail('ServiceNow incident: investigation before opening');
    if (item.outage_start_at && !['true','false'].includes(item.approved_maintenance)) fail('ServiceNow incident: maintenance admission missing');
  }
  for(const item of ch) if(!item.completed_at || !['success','failed','cancelled'].includes(item.outcome))
    fail('ServiceNow change: incomplete completion/outcome');
  const aws = cloudwatch(opt.cloudwatch,config.cloudwatch_series);
  const jira = reconcileJira(opt.jira,config.jira,ch);
  const incText = csv(Object.keys(incidentSchema),inc.map(x=>Object.values(x)));
  const chText = csv(Object.keys(changeSchema),ch.map(x=>Object.values(x)));
  const sourceSha = Object.fromEntries(['incidents','changes','cloudwatch','jira','mapping'].map(key=>[key,entryHash(opt[key])]));
  const problems = [
    ...aws.filter(x=>!x.coverage_complete).map(x=>`AWS_CLOUDWATCH_GAPS:${x.id}`),
    ...(jira.status==='REVIEW_REQUIRED'?['JIRA_CHANGE_LINKS_UNRECONCILED']:[])
  ];
  const manifest = {schema_version:1, month:opt.month, type:'OFFLINE_EVIDENCE_BRIDGE',
    acceptance_status:'NOT_A_CONTRACT_CERTIFICATION_OR_CUSTOMER_MEASUREMENT',
    authorization_reference:config.authorization_reference, source_sha256:sourceSha,
    normalized_sha256:{'incidents.csv':sha(incText),'changes.csv':sha(chText)},
    normalized_counts:{incidents:inc.length,changes:ch.length},
    cloudwatch:aws, jira, exception_codes:problems,
    note:'Feeds the original authorized sla_evidence.py. CloudWatch metric semantics/selection, ServiceNow export completeness, Jira workflow rules, and contract acceptance require independent prime verification.'};
  return {'incidents.csv':incText,'changes.csv':chText,'manifest.json':JSON.stringify(manifest,null,2)+'\n'};
}
async function main(argv) {
  const args = {};
  for (let n=0;n<argv.length;n+=2) {
    if (!argv[n]?.startsWith('--') || !argv[n+1] || own(args,argv[n].slice(2))) fail('CLI: malformed or duplicate arguments');
    args[argv[n].slice(2)] = argv[n+1];
  }
  const keys = ['month','incident-json','change-json','jira-json','cloudwatch-json','mapping','out-dir'];
  if (Object.keys(args).length!==keys.length || keys.some(k=>!own(args,k)))
    fail(`usage: node bridge.mjs --month YYYY-MM --incident-json SOURCE --change-json SOURCE --jira-json SOURCE --cloudwatch-json SOURCE --mapping APPROVED_MAP --out-dir DIRECTORY`);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(args.month)) fail('Invalid YYYY-MM reporting period');
  const packet = {month:args.month};
  for(const [key,arg] of [['incidents','incident-json'],['changes','change-json'],['jira','jira-json'],['cloudwatch','cloudwatch-json'],['mapping','mapping']])
    packet[key] = JSON.parse(await readFile(args[arg],'utf8'));
  const result=buildEvidence(packet);
  await mkdir(args['out-dir'],{recursive:true});
  for (const [name,body] of Object.entries(result)) {
    const target=join(args['out-dir'],name), temp=target+'.tmp-'+process.pid;
    await writeFile(temp,body,{mode:0o600,flag:'wx'});
    await rename(temp,target);
  }
  process.stdout.write(JSON.stringify({written:Object.keys(result),out_dir:args['out-dir'],acceptance:'EVIDENCE_ONLY'})+'\n');
}
if(process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch(e=>{process.stderr.write(`CCC NG2610 W3: ${e.message}\n`);process.exitCode=2;});
}
