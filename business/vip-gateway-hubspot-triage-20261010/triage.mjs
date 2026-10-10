// MIT. Native HubSpot v3 deals export -> deterministic, read-only management triage.
// No API requests, mutations, LLM calls, recurring jobs, or customer data in source.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const int = (v, fallback, min, max) => Number.isSafeInteger(v) && v >= min && v <= max ? v : fallback;
function timestamp(v) {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v);
  const ms = /^\d{13}$/.test(s) ? Number(s) : Date.parse(s);
  return Number.isFinite(ms) ? ms : null;
}
const asText = (v, fallback = 'UNSET') => typeof v === 'string' && v.trim() ? v.trim().slice(0, 128) : fallback;
const DAY = 86400_000;
function settingsOf(settings) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new TypeError('Config object required');
  const now = timestamp(settings.asOf);
  if (now === null || !Number.isFinite(now)) throw new TypeError('Explicit valid asOf is required');
  const stages = settings.stageStatus;
  if (!stages || typeof stages !== 'object' || !Object.values(stages).every(s=>['open','won','lost'].includes(s))) {
    throw new TypeError('stageStatus must map native HubSpot stage IDs to open/won/lost');
  }
  return {
    now, stages, portalId: /^\d+$/.test(String(settings.portalId ?? '')) ? String(settings.portalId) : null,
    nextField: asText(settings.nextActionProperty,'next_action_date'),
    sourceField: asText(settings.sourceProperty,'hs_analytics_source'),
    qualityField: settings.leadQualityProperty ? asText(settings.leadQualityProperty) : null,
    lastRecordField: asText(settings.lastRecordUpdateProperty,'hs_lastmodifieddate'),
    staleDays:int(settings.staleRecordDays,7,1,90),
    minAgeDays:int(settings.minAgeDays,2,0,30),
    lookbackDays:int(settings.lookbackDays,90,7,730),
    minCohort:int(settings.minCohort,10,5,100),
    maxAlerts:int(settings.maxAlerts,40,1,250),
    maxPerOwner:int(settings.maxPerOwner,5,1,25)
  };
}
function dataOf(raw) {
  const rows = Array.isArray(raw?.results) ? raw.results : Array.isArray(raw) ? raw : null;
  if (!rows || rows.length > 100000 || rows.some(x => !x || typeof x !== 'object' || !x.properties || typeof x.properties !== 'object')) {
    throw new TypeError('Expected native HubSpot deals results[], max 100000, with properties');
  }
  return rows;
}
function normDeal(row, cfg) {
  const p = row.properties, id=String(row.id ?? '');
  if (!/^\d{1,25}$/.test(id)) throw new TypeError('Native numeric HubSpot deal id required');
  const stage = asText(p.dealstage,'');
  const status = cfg.stages[stage];
  if (!status) throw new TypeError('Unknown native stage "'+stage+'"; declare stageStatus');
  const create=timestamp(p.createdate ?? row.createdAt);
  const source=asText(p[cfg.sourceField],'UNKNOWN_SOURCE');
  const quality=cfg.qualityField?asText(p[cfg.qualityField],'UNKNOWN_QUALITY'):'NOT_MEASURED';
  const owner=asText(p.hubspot_owner_id,'UNASSIGNED');
  return {
    id, stage, status, pipeline:asText(p.pipeline,'UNKNOWN_PIPELINE'),
    source, quality, owner, created:create,
    recordChanged:timestamp(p[cfg.lastRecordField] ?? row.updatedAt),
    nextDate:timestamp(p[cfg.nextField])
  };
}
function ageBucket(deal,now) {
  if (deal.created===null) return 'UNKNOWN_AGE';
  const days=Math.max(0,Math.floor((now-deal.created)/DAY));
  return days<30?'00_29d':days<90?'30_89d':'90d_plus';
}
export function triage(nativeDeals, userSettings) {
  const cfg=settingsOf(userSettings), rows=dataOf(nativeDeals);
  const ids=new Set(), deals=[];
  for (const row of rows) {
    const d=normDeal(row,cfg);
    if (ids.has(d.id)) throw new TypeError('Duplicate native deal ID '+d.id);
    ids.add(d.id);
    deals.push(d);
  }
  const candidates=[], cohorts=new Map();
  let unknownAges=0, futureCreated=0, missingNextActions=0, closedInWindow=0;
  for (const d of deals) {
    if (d.created===null) unknownAges++;
    if (d.created!==null && d.created>cfg.now) futureCreated++;
    // Closed cohorts are descriptive, not proof of cause or salesperson performance.
    if (['won','lost'].includes(d.status) && d.created!==null &&
      d.created<=cfg.now && d.created>=cfg.now-cfg.lookbackDays*DAY) {
      const cohort=[d.pipeline,d.source,d.quality,ageBucket(d,cfg.now)].join(' / ');
      const c=cohorts.get(cohort)??{cohort,pipeline:d.pipeline,leadSource:d.source,
        leadQuality:d.quality,ageBucket:ageBucket(d,cfg.now),won:0,lost:0};
      c[d.status]++;
      cohorts.set(cohort,c);
      closedInWindow++;
    }
    if (d.status!=='open' || d.created===null || d.created>cfg.now-cfg.minAgeDays*DAY) continue;
    const reasons=[];
    if (d.nextDate!==null && d.nextDate<cfg.now) reasons.push('OVERDUE_DECLARED_NEXT_ACTION');
    if (d.nextDate===null) {reasons.push('NO_PARSEABLE_DECLARED_NEXT_ACTION_DATE');missingNextActions++;}
    if (d.recordChanged!==null && d.recordChanged<cfg.now-cfg.staleDays*DAY)
      reasons.push('STALE_CRM_RECORD_UPDATE_NOT_CONTACT_PROOF');
    if (!reasons.length) continue;
    let priority=reasons.includes('OVERDUE_DECLARED_NEXT_ACTION')?90:
      reasons.includes('NO_PARSEABLE_DECLARED_NEXT_ACTION_DATE')?60:25;
    if (d.nextDate!==null && d.nextDate<cfg.now)
      priority+=Math.min(10,Math.floor((cfg.now-d.nextDate)/DAY));
    candidates.push({dealId:d.id,ownerId:d.owner,priority,reasons,stage:d.stage,
      pipeline:d.pipeline,leadSource:d.source,leadQuality:d.quality,
      nextActionAt:d.nextDate===null?null:new Date(d.nextDate).toISOString(),
      recordUpdatedAt:d.recordChanged===null?null:new Date(d.recordChanged).toISOString(),
      dealUrl:cfg.portalId?'https://app.hubspot.com/contacts/'+cfg.portalId+'/record/0-3/'+d.id:null,
      action:'HUMAN_REVIEW_ONLY'});
  }
  candidates.sort((a,b)=>b.priority-a.priority || a.dealId.localeCompare(b.dealId));
  const ownerCounts=new Map(),alerts=[];
  for (const x of candidates) {
    if (alerts.length>=cfg.maxAlerts) break;
    const count=ownerCounts.get(x.ownerId)??0;
    if(count>=cfg.maxPerOwner) continue;
    ownerCounts.set(x.ownerId,count+1);
    alerts.push(x);
  }
  const byCohort=[...cohorts.values()].sort((a,b)=>a.cohort.localeCompare(b.cohort)).map(c=>{
    const n=c.won+c.lost;
    return {...c,n,observedWinRate:n>=cfg.minCohort?Number((c.won/n).toFixed(4)):null,
      eligibleForComparison:n>=cfg.minCohort,
      caveat:n<cfg.minCohort?'SMALL_COHORT':
        c.leadQuality==='NOT_MEASURED'||c.leadQuality==='UNKNOWN_QUALITY'?
          'LEAD_QUALITY_NOT_CONTROLLED':'DESCRIPTIVE_NOT_CAUSAL'};
  });
  return {
    schema:'commons.hubspot.deal-triage.v1',
    mode:'READ_ONLY_ORIGINAL_EXPORT',
    asOf:new Date(cfg.now).toISOString(),
    sourceKind:'HubSpot CRM v3 deals GET results or actual owner export in same shape',
    inputCount:deals.length,closedInWindow,unknownAges,futureCreated,
    cohorts:byCohort,
    alerts,
    alertCandidates:candidates.length,
    suppressedAlertCount:candidates.length-alerts.length,
    missingNextActions,
    caps:{maxAlerts:cfg.maxAlerts,maxPerOwner:cfg.maxPerOwner,minCohort:cfg.minCohort},
    judgments:{
      personalizedSalespersonPerformance:'NOT_ESTABLISHED',
      businessCausality:'NOT_ESTABLISHED',
      customerContactActivity:'NOT_INFERRED_FROM_CRM_RECORD_UPDATE',
      actionApproval:'HUMAN_REQUIRED',
      HubSpotWritePerformed:false,
      customerDeliveryConfirmed:false
    }
  };
}
export async function main(args) {
  const options={};
  for(let i=0;i<args.length;i++) {
    const key=args[i], name={'--deals':'deals','--config':'config','--out':'out'}[key];
    if(!name || !args[i+1] || options[name])throw new TypeError('Usage: --deals original.json --config owner-config.json --out NEW.json');
    options[name]=args[++i];
  }
  if(Object.keys(options).length!==3) throw new TypeError('Expected --deals, --config and --out');
  const [raw,settings]=await Promise.all([
    readFile(options.deals,'utf8').then(JSON.parse),
    readFile(options.config,'utf8').then(JSON.parse)
  ]);
  const report=triage(raw,settings);
  await writeFile(options.out,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
  return {out:options.out,deals:report.inputCount,alerts:report.alerts.length,
    suppressed:report.suppressedAlertCount,cohorts:report.cohorts.length};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(v=>process.stdout.write(JSON.stringify(v)+'\n'))
    .catch(e=>{process.stderr.write(String(e.message)+'\n');process.exitCode=1});
}
