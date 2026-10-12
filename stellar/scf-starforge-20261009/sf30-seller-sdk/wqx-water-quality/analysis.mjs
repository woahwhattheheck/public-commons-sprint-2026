/**
 * Scientific review of retained WQX 3.0 sample results.
 * Inputs are the original samples.mjs joinCapture() model.
 * Domain interpretation: EPA Detection Limits Best Practices Guide, August 2025:
 * https://www.epa.gov/system/files/documents/2025-09/wqxdetectionlimitsbestpracticesguide_final.pdf
 */
export const WATER_QUALITY_GROUP_FIELDS = Object.freeze([
  'provider','organizationId','locationId','activityType','media','mediaSubdivision',
  'characteristic','sampleFraction','methodSpeciation','unit','statisticalBase','statisticalN',
  'weightBasis','timeBasis','temperatureBasis','particleSizeBasis',
  'methodIdentifier','methodContext','methodName',
  'sampleCollectionMethodIdentifier','sampleCollectionMethodContext',
  'samplePreparationMethodIdentifier','samplePreparationMethodContext',
  'labPreparationMethodIdentifier','labPreparationMethodContext',
  'depthHeight','depthHeightUnit','relativeDepth','resultDepthHeight','resultDepthHeightUnit',
  'resultDepthReference','resultDepthSamplingPoint','resultDepthSamplingPointType',
  'topDepth','topDepthUnit','bottomDepth','bottomDepthUnit'
]);

const has = (o,k) => Object.prototype.hasOwnProperty.call(o,k);
const text = x => x === null || x === undefined ? '' : String(x);
const word = x => text(x).trim().toLowerCase().replace(/\s+/g,' ');
const json = x => JSON.stringify(x === undefined ? null : x);
function canonical(x) {
  if (Array.isArray(x)) return '[' + x.map(canonical).join(',') + ']';
  if (x && typeof x === 'object') return '{' + Object.keys(x).sort().map(k => json(k)+':'+canonical(x[k])).join(',') + '}';
  return json(x);
}
function shortId(s) {
  let n = 14695981039346656037n;
  for (const c of s) n = BigInt.asUintN(64,(n ^ BigInt(c.codePointAt(0))) * 1099511628211n);
  return n.toString(16).padStart(16,'0');
}
function gcd(a,b) { a=a<0n?-a:a; b=b<0n?-b:b; while(b) [a,b]=[b,a%b]; return a || 1n; }
function ratio(n,d=1n) {
  if (d===0n) return null;
  if (d<0n) { n=-n; d=-d; }
  const g=gcd(n,d); return {n:n/g,d:d/g};
}
function decimal(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const s=String(value).trim(), m=/^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/.exec(s);
  if (!m) return null;
  const frac=m[3] ?? m[4] ?? '', digits=(m[2] || '0')+frac, exponent=Number(m[5] || 0);
  if (digits.length>2048 || !Number.isSafeInteger(exponent) || Math.abs(exponent)>2048) return null;
  const scale=frac.length-exponent;
  let n=BigInt(digits) * (m[1]==='-'?-1n:1n), d=1n;
  if (scale>=0) d=10n**BigInt(scale); else n*=10n**BigInt(-scale);
  return ratio(n,d);
}
function add(a,b) { return ratio(a.n*b.d+b.n*a.d,a.d*b.d); }
function subtract(a,b) { return ratio(a.n*b.d-b.n*a.d,a.d*b.d); }
function compare(a,b) { const d=a.n*b.d-b.n*a.d; return d<0n?-1:d>0n?1:0; }
function formatted(r,precision=12) {
  if (!r) return null;
  const multiplier=10n**BigInt(precision), negative=r.n<0n, magnitude=negative?-r.n:r.n;
  let scaled=magnitude*multiplier/r.d;
  const rem=magnitude*multiplier%r.d;
  if (rem*2n>=r.d) scaled++;
  const integer=scaled/multiplier;
  const fractional=(scaled%multiplier).toString().padStart(precision,'0').replace(/0+$/,'');
  const display=(negative && scaled!==0n?'-':'')+integer.toString()+(fractional?'.'+fractional:'');
  const numeric=Number(display);
  return {numerator:r.n.toString(),denominator:r.d.toString(),display,decimal:display,
    value:Number.isFinite(numeric)?numeric:null,exact:rem===0n,
    displayPrecision:precision,rounding:'half-away-from-zero'};
}
function summarizeNumbers(entries) {
  if (!entries.length) return {count:0,min:null,max:null,mean:null,median:null};
  const sorted=[...entries].sort((a,b)=>compare(a.number,b.number));
  const sum=entries.reduce((a,b)=>add(a,b.number),{n:0n,d:1n}), count=BigInt(entries.length);
  const mid=Math.floor(sorted.length/2);
  const median=sorted.length%2 ? sorted[mid].number : ratio(
    sorted[mid-1].number.n*sorted[mid].number.d+sorted[mid].number.n*sorted[mid-1].number.d,
    2n*sorted[mid-1].number.d*sorted[mid].number.d);
  return {count:entries.length,
    min:{...formatted(sorted[0].number),original:sorted[0].original},
    max:{...formatted(sorted.at(-1).number),original:sorted.at(-1).original},
    mean:formatted(ratio(sum.n,sum.d*count)),median:formatted(median)};
}
function dateValue(value) {
  const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(text(value));
  if (!m) return null;
  const y=Number(m[1]), mo=Number(m[2]), d=Number(m[3]);
  const leap=y%4===0 && (y%100!==0 || y%400===0);
  const lengths=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
  return mo>=1 && mo<=12 && d>=1 && d<=lengths[mo-1] ? m[0] : null;
}
function normalizeWindow(value,name) {
  if (value === null || value === undefined) return null;
  if (!value || typeof value!=='object' || Array.isArray(value)) throw new TypeError(name+' must contain ISO calendar dates');
  const out={start:null,end:null};
  for (const key of ['start','end']) {
    if (value[key]!==null && value[key]!==undefined && value[key]!=='') {
      out[key]=dateValue(value[key]);
      if (!out[key]) throw new TypeError(name+'.'+key+' must be a valid YYYY-MM-DD date');
    }
  }
  if (out.start && out.end && out.start>out.end) throw new RangeError(name+' starts after it ends');
  return out.start || out.end ? out : null;
}
function stringList(value,name) {
  if (value===undefined || value===null) return [];
  if (!Array.isArray(value) || value.some(x=>typeof x!=='string' || !x.trim())) throw new TypeError(name+' must be an array of non-empty strings');
  return [...new Set(value)].sort();
}
export function normalizeAnalysisOptions(options={}) {
  if (!options || typeof options!=='object' || Array.isArray(options)) throw new TypeError('Analysis options must be an object');
  if (options.includeEstimated!==undefined && typeof options.includeEstimated!=='boolean') throw new TypeError('includeEstimated must be boolean');
  return {window:normalizeWindow(options.window,'window'),baselineWindow:normalizeWindow(options.baselineWindow,'baselineWindow'),
    includeEstimated:options.includeEstimated===true,characteristics:stringList(options.characteristics,'characteristics'),
    siteIds:stringList(options.siteIds,'siteIds'),allowedQualifiers:stringList(options.allowedQualifiers,'allowedQualifiers')};
}
function validateModel(model) {
  if (!model || !Array.isArray(model.rows)) throw new TypeError('Expected the joined WQX model with original rows');
  return model;
}
function qualifierCodes(value) {
  const raw=text(value).trim(); if (!raw) return [];
  if (raw.startsWith('[')) {
    try { const v=JSON.parse(raw); if (Array.isArray(v) && v.every(x=>typeof x==='string')) return v.map(x=>x.trim()).filter(Boolean); } catch {}
  }
  return raw.split(/[;,|]/).map(x=>x.trim()).filter(Boolean);
}
function conditionKind(condition) {
  const value=word(condition);
  if (!value || value==='none') return 'none';
  if (value==='not detected' || value.startsWith('not detected at ') || value.startsWith('below ') || value.startsWith('present below ')) return 'left';
  if (value.startsWith('above ') || value.startsWith('present above ')) return 'right';
  if (value.startsWith('between ')) return 'interval';
  if (value==='detected not quantified') return 'unquantified';
  return 'unclassified';
}
function limitInfo(limit) {
  const n=decimal(limit.value);
  return {type:limit.type??null,value:limit.value??null,valueState:limit.valueState??null,unit:limit.unit??null,
    comment:limit.comment??null,origin:limit.origin??null,number:formatted(n),source:limit.source??null,
    duplicate:limit.duplicate===true,conflictingDuplicate:limit.conflictingDuplicate===true,record:limit.record??null};
}
export function classifyWaterQualityResult(row,options={}) {
  const opt=normalizeAnalysisOptions(options), codes=qualifierCodes(row.qualifier), upper=codes.map(x=>x.toUpperCase());
  const estimated=word(row.valueType)==='estimated' || upper.includes('J');
  let censoring=conditionKind(row.detectionCondition);
  const comparator=/^\s*(<=|>=|<|>|≤|≥)\s*(.+?)\s*$/.exec(text(row.value));
  const directBound=comparator ? decimal(comparator[2]) : null;
  const literalKind=comparator && directBound ? (['<','<=','≤'].includes(comparator[1])?'left':'right') : null;
  const inferred=upper.includes('U') || upper.includes('DL') ? 'left' : upper.includes('LTGTE') ? 'interval' : null;
  let conflictingCensoring=false;
  if (literalKind) {
    if (censoring!=='none' && censoring!=='unclassified' && censoring!==literalKind) conflictingCensoring=true;
    else censoring=literalKind;
  }
  if (inferred) {
    if (censoring==='none') censoring=inferred;
    else if ((censoring==='right' && inferred!=='right') || (literalKind && inferred==='interval')) conflictingCensoring=true;
  }
  const number=decimal(row.value), limits=(row.limits || []).map(limitInfo), unknownQualifiers=codes.filter((code,i)=>
    !opt.allowedQualifiers.includes(code) && !['J','U','DL','LTGTE'].includes(upper[i]));
  const valueType=word(row.valueType), unknownValueType=!!valueType && !['actual','estimated'].includes(valueType);
  const isCensored=censoring!=='none', issues=[];
  if (isCensored && !limits.some(x=>x.number) && !directBound) issues.push('Censoring has no numeric reported limit');
  if (conflictingCensoring) issues.push('Source censoring fields disagree');
  if (unknownQualifiers.length) issues.push('Qualified result requires explicit analyst selection');
  if (unknownValueType) issues.push('Result value type is retained outside the numeric summary');
  if (isCensored && number && !estimated) issues.push('Censored result also contains an unlabelled numeric value');
  if (limits.some(x=>x.conflictingDuplicate)) issues.push('Conflicting detection-limit versions are retained');
  let exclusion=null;
  if (row.conflictingDuplicate) exclusion='conflicting result versions';
  else if (row.duplicate) exclusion='duplicate result';
  else if (conflictingCensoring) exclusion='conflicting censoring';
  else if (!number) exclusion=row.value===null || row.value===undefined || text(row.value).trim()===''?'missing numeric value':'non-numeric value';
  else if (unknownQualifiers.length) exclusion='qualified result';
  else if (unknownValueType) exclusion='other result value type';
  else if (isCensored && !estimated) exclusion='censored result';
  else if (estimated && !opt.includeEstimated) exclusion='reported estimate';
  const included=exclusion===null;
  return {classification:conflictingCensoring?'conflicting':isCensored?'censored':estimated?'estimated':number?'measured':
      row.value===null || row.value===undefined || text(row.value).trim()===''?'missing':'text',
    censoring,estimated,qualified:codes.length>0,qualifiers:codes,unknownQualifiers,unknownValueType,
    numeric:formatted(number),included,exclusion,
    bound:directBound?{operator:comparator[1],value:comparator[2],number:formatted(directBound),unit:row.unit??null}:null,
    limits,issues};
}
function sourceRecord(item) {
  if (item && typeof item==='object' && item.record) return item.record;
  if (item && typeof item==='object') return Object.fromEntries(Object.entries(item).filter(([k])=>!['source','duplicate','conflictingDuplicate','issues'].includes(k)));
  return item??null;
}
function semantic(row) {
  return {record:row.record || Object.fromEntries(Object.entries(row).filter(([k])=>!['source','duplicate','conflictingDuplicate','issues','stationRecords','activityRecords','limits'].includes(k))),
    stations:(row.stationRecords || []).map(sourceRecord).map(canonical).sort(),
    activities:(row.activityRecords || []).map(sourceRecord).map(canonical).sort(),
    limits:(row.limits || []).map(x=>({type:x.type??null,value:x.value??null,unit:x.unit??null,comment:x.comment??null,
      origin:x.origin??null,record:x.record??null})).map(canonical).sort()};
}
function resultIdentity(row,index) { return row.resultKey || row.id || canonical([row.provider,row.organizationId,row.activityId,row.resultId,row.source?.sha256,row.source?.index??index]); }
function classifyModel(model,opt) {
  const groups=new Map(), values=model.rows.map((row,index)=>({row,index,key:resultIdentity(row,index),fingerprint:canonical(semantic(row))}));
  for (const value of values) {
    if (!groups.has(value.key)) groups.set(value.key,new Set());
    groups.get(value.key).add(value.fingerprint);
  }
  const seen=new Set();
  return values.map(({row,index,key,fingerprint})=>{
    const duplicateKey=canonical([key,fingerprint]), duplicate=seen.has(duplicateKey) || row.duplicate===true;
    seen.add(duplicateKey);
    const conflictingDuplicate=groups.get(key).size>1 || row.conflictingDuplicate===true;
    const copy={...row,id:row.id || 'result-'+shortId(key)+'-'+index,resultKey:key,duplicate,conflictingDuplicate};
    return {...copy,analysis:classifyWaterQualityResult(copy,opt)};
  });
}
function selected(row,opt,window) {
  if (opt.characteristics.length && !opt.characteristics.includes(text(row.characteristic))) return false;
  if (opt.siteIds.length && !opt.siteIds.includes(text(row.locationId))) return false;
  if (!window) return true;
  const date=dateValue(row.date);
  return !!date && (!window.start || date>=window.start) && (!window.end || date<=window.end);
}
function countsOf(values,key) {
  const map=new Map(); for (const row of values) { const value=row[key]??null, k=canonical(value); const old=map.get(k); if (old) old.count++; else map.set(k,{value,count:1}); }
  return [...map.values()].sort((a,b)=>canonical(a.value).localeCompare(canonical(b.value)));
}
function numberEntry(row) { const number=decimal(row.value); return number?{number,original:row.value}:null; }
function numericRows(rows,predicate) { return rows.filter(predicate).map(numberEntry).filter(Boolean); }
function buildGroup(key,rows) {
  const dimensions=Object.fromEntries(WATER_QUALITY_GROUP_FIELDS.map(field=>[field,rows[0][field]??null]));
  const unique=rows.filter(x=>!x.duplicate && !x.conflictingDuplicate);
  const dates=unique.map(x=>dateValue(x.date)).filter(Boolean).sort();
  const limits=new Map();
  for (const row of unique) for (const value of row.analysis.limits) {
    const k=canonical([value.type,value.unit,value.origin]); if (!limits.has(k)) limits.set(k,{type:value.type,unit:value.unit,origin:value.origin,entries:[],count:0});
    const group=limits.get(k); group.count++; if (value.number) group.entries.push({number:ratio(BigInt(value.number.numerator),BigInt(value.number.denominator)),original:value.value});
  }
  const numeric=rows.filter(x=>x.analysis.included);
  return {id:'group-'+shortId(key),key,label:[dimensions.locationId,dimensions.characteristic,dimensions.sampleFraction,dimensions.unit,dimensions.methodIdentifier].filter(Boolean).join(' · '),
    dimensions,counts:{rows:rows.length,uniqueResults:unique.length,arithmeticRows:numeric.length,
      duplicates:rows.filter(x=>x.duplicate).length,conflicts:rows.filter(x=>x.conflictingDuplicate).length,
      detected:unique.filter(x=>x.analysis.censoring==='none' && !x.analysis.estimated && x.analysis.numeric).length,
      estimated:unique.filter(x=>x.analysis.estimated).length,qualified:unique.filter(x=>x.analysis.qualified).length,
      missing:unique.filter(x=>x.analysis.classification==='missing').length,nonNumeric:unique.filter(x=>x.analysis.classification==='text').length,
      censored:unique.filter(x=>x.analysis.censoring!=='none').length,
      censoring:Object.fromEntries(['left','right','interval','unquantified','unclassified'].map(k=>[k,unique.filter(x=>x.analysis.censoring===k).length]))},
    firstDate:dates[0]??null,lastDate:dates.at(-1)??null,
    summary:summarizeNumbers(numericRows(rows,x=>x.analysis.included)),
    detectedSummary:summarizeNumbers(numericRows(unique,x=>x.analysis.censoring==='none' && !x.analysis.estimated && !x.analysis.unknownQualifiers.length && !x.analysis.unknownValueType)),
    reportedEstimateSummary:summarizeNumbers(numericRows(unique,x=>x.analysis.estimated && x.analysis.classification!=='conflicting' && !x.analysis.unknownQualifiers.length && !x.analysis.unknownValueType)),
    statusCounts:countsOf(unique,'status'),qualifierCounts:countsOf(unique,'qualifier'),conditionCounts:countsOf(unique,'detectionCondition'),
    timeZoneCounts:countsOf(unique,'timeZone'),observationIds:rows.map(x=>x.id),
    limits:[...limits.values()].map(x=>({type:x.type,unit:x.unit,origin:x.origin,count:x.count,summary:summarizeNumbers(x.entries)}))};
}
function analysisPart(model,annotated,opt,window) {
  const observations=annotated.filter(row=>selected(row,opt,window)), index=new Map();
  for (const row of observations) {
    const key=canonical(WATER_QUALITY_GROUP_FIELDS.map(field=>row[field]??null));
    if (!index.has(key)) index.set(key,[]); index.get(key).push(row);
  }
  const groups=[...index.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([key,rows])=>buildGroup(key,rows));
  const unique=observations.filter(x=>!x.duplicate && !x.conflictingDuplicate);
  return {window,inventory:{sourceRows:model.rows.length,selectedRows:observations.length,filteredRows:model.rows.length-observations.length,
    uniqueResults:unique.length,activities:new Set(unique.map(x=>x.activityKey || canonical([x.provider,x.organizationId,x.activityId]))).size,
    stations:new Set(unique.map(x=>x.stationKey || canonical([x.provider,x.organizationId,x.locationId]))).size,groups:groups.length,
    duplicates:observations.filter(x=>x.duplicate).length,conflicts:observations.filter(x=>x.conflictingDuplicate).length,
    estimated:unique.filter(x=>x.analysis.estimated).length,qualified:unique.filter(x=>x.analysis.qualified).length,
    censored:unique.filter(x=>x.analysis.censoring!=='none').length,missing:unique.filter(x=>x.analysis.classification==='missing').length,
    nonNumeric:unique.filter(x=>x.analysis.classification==='text').length,invalidDates:unique.filter(x=>!dateValue(x.date)).length,
    arithmeticRows:observations.filter(x=>x.analysis.included).length,excludedRows:observations.filter(x=>!x.analysis.included).length,
    sourceIssues:Array.isArray(model.issues)?model.issues.length:0},
    groups,observations};
}
function meanRatio(summary) {
  return summary?.mean?ratio(BigInt(summary.mean.numerator),BigInt(summary.mean.denominator)):null;
}
function measurementScale(dimensions) {
  const characteristic=word(dimensions.characteristic), unit=word(dimensions.unit).replace(/\s+/g,'');
  if (characteristic==='ph' || unit==='ph') return {kind:'logarithmic',reason:'pH differences are expressed on the reported logarithmic scale.'};
  if (['degc','degf','°c','°f','celsius','fahrenheit','degreescelsius','degreesfahrenheit'].includes(unit))
    return {kind:'interval',reason:'Temperature on an offset scale is compared by an absolute difference.'};
  const ratioUnits=new Set(['mg/l','ug/l','µg/l','μg/l','ng/l','pg/l','g/l','mg/kg','ug/kg','µg/kg','μg/kg','ng/kg','g/kg',
    'mol/l','mmol/l','umol/l','µmol/l','μmol/l','%','cfu/100ml','mpn/100ml','cells/ml','1/ml',
    'm3/s','m^3/s','ft3/s','ft^3/s','cfs','k','kelvin']);
  if (ratioUnits.has(unit)) return {kind:'ratio',reason:null};
  return {kind:'unclassified',reason:'The retained unit has no selected ratio-scale interpretation; the absolute difference remains available.'};
}
function periodComparisons(current,baseline) {
  const present=new Map(current.groups.map(group=>[group.key,group]));
  const previous=new Map(baseline.groups.map(group=>[group.key,group]));
  return [...new Set([...present.keys(),...previous.keys()])].sort().map(key=>{
    const currentGroup=present.get(key), old=previous.get(key), group=currentGroup || old;
    const a=meanRatio(currentGroup?.summary), b=meanRatio(old?.summary), delta=a && b?subtract(a,b):null;
    const scale=measurementScale(group.dimensions), relative=delta && b.n>0n && scale.kind==='ratio';
    const relativeReason=scale.reason || (b && b.n<=0n?'A positive baseline mean is required for relative change.':null);
    return {groupId:group.id,key:group.key,label:group.label,dimensions:group.dimensions,currentCount:currentGroup?.summary.count??0,
      baselineCount:old?.summary.count??0,currentMean:currentGroup?.summary.mean??null,baselineMean:old?.summary.mean??null,
      change:formatted(delta),changeUnit:group.dimensions.unit==='%'?'percentage points':group.dimensions.unit,
      measurementScale:scale.kind,percentChange:relative?formatted(ratio(delta.n*b.d*100n,delta.d*b.n)):null,
      relativeChangeReason:relative?null:relativeReason,
      comparable:!!(a && b),reason:!currentGroup?'No matching current group':!old?'No matching baseline group':!a || !b?'A period has no selected numeric values':relativeReason};
  });
}
function reviewObservation(row) {
  const {record,stationRecords,activityRecords,limits,analysis,...fields}=row;
  const originalReferences={result:row.source??null,
    stations:(stationRecords || []).map(x=>x.source??null).filter(Boolean),
    activities:(activityRecords || []).map(x=>x.source??null).filter(Boolean)};
  const reviewLimits=(limits || []).map(({record,...limit})=>limit);
  const analysisLimits=(analysis.limits || []).map(({record,source,...limit})=>limit);
  return {...fields,limits:reviewLimits,originalReferences,analysis:{...analysis,limits:analysisLimits}};
}
export function summarizeWaterQuality(input,options={}) {
  const model=validateModel(input), opt=normalizeAnalysisOptions(options), annotated=classifyModel(model,opt);
  const current=analysisPart(model,annotated,opt,opt.window), baseline=opt.baselineWindow?analysisPart(model,annotated,opt,opt.baselineWindow):null;
  return {schema:'wqx-water-quality-analysis/v1',capture:{sha256:model.captureSha256??null,selection:model.selection??null,
      status:model.captureStatus??model.capture?.status??model.status??model.summary?.status??null,summary:model.summary??null},options:opt,
    ...current,observations:current.observations.map(reviewObservation),baseline:baseline?{window:baseline.window,inventory:baseline.inventory,groups:baseline.groups}:null,
    comparison:baseline?periodComparisons(current,baseline):[],
    sourceNotes:[
      'Windows compare the reported local sample dates. Original times and time zones remain attached.',
      'Groups preserve organization, site, sample context, fraction, speciation, unit, statistical basis, analytical/collection/preparation methods and sample-depth context.',
      'Numeric summaries are descriptive arithmetic summaries of the reported measurement scale and use exact decimal fractions. Source estimates enter the selected summary only when includeEstimated is true.',
      'Relative percent change is supplied for recognized ratio units and a positive baseline. pH, offset temperatures and unclassified units retain absolute differences in their original scale.',
      'Censored measurements retain every supplied detection-limit record and source value. Limits are never substituted for observations.',
      'Qualified results require an explicit allowedQualifiers selection, except source-labelled estimates and recognized censoring codes.',
      'Each reviewed observation points to its original result, activity and station records in the retained source graph.'
    ],
    sources:[{title:'EPA Detection Limits Best Practices Guide, August 2025',url:'https://www.epa.gov/system/files/documents/2025-09/wqxdetectionlimitsbestpracticesguide_final.pdf'},
      {title:'Water Quality Portal web services',url:'https://www.waterqualitydata.us/webservices_documentation/'},
      {title:'USGS pH and Water',url:'https://www.usgs.gov/water-science-school/science/ph-and-water'},
      {title:'NIST SI Guide, Chapter 8',url:'https://www.nist.gov/pml/special-publication-811/nist-guide-si-chapter-8'}]};
}
export function compareWaterQualityCaptures(currentInput,previousInput,options={}) {
  const current=validateModel(currentInput), previous=validateModel(previousInput), opt=normalizeAnalysisOptions(options);
  function index(model) {
    const map=new Map();
    classifyModel(model,opt).filter(row=>selected(row,opt,opt.window)).forEach(row=>{
      const key=row.resultKey, fingerprint=canonical(semantic(row)); if (!map.has(key)) map.set(key,new Map());
      if (!map.get(key).has(fingerprint)) map.get(key).set(fingerprint,row);
    }); return map;
  }
  const a=index(current), b=index(previous), added=[],removed=[],changed=[],ambiguous=[],unchanged=[];
  for (const key of [...new Set([...a.keys(),...b.keys()])].sort()) {
    const x=a.get(key),y=b.get(key);
    if (x?.size>1 || y?.size>1 || [...(x?.values() || []),...(y?.values() || [])].some(row=>row.conflictingDuplicate)) {
      ambiguous.push({resultKey:key,currentVersions:x?.size??0,previousVersions:y?.size??0}); continue;
    }
    if (!y) { added.push([...x.values()][0]); continue; }
    if (!x) { removed.push([...y.values()][0]); continue; }
    if ([...x.keys()][0]===[...y.keys()][0]) { unchanged.push(key); continue; }
    const after=[...x.values()][0],before=[...y.values()][0],sa=semantic(after),sb=semantic(before);
    changed.push({resultKey:key,before,after,changedParts:Object.keys(sa).filter(k=>canonical(sa[k])!==canonical(sb[k]))});
  }
  return {schema:'wqx-water-quality-capture-comparison/v1',currentCaptureSha256:current.captureSha256??null,
    previousCaptureSha256:previous.captureSha256??null,selectionEquivalent:canonical(current.selection)===canonical(previous.selection),
    options:opt,counts:{added:added.length,removed:removed.length,changed:changed.length,ambiguous:ambiguous.length,unchanged:unchanged.length},
    added,removed,changed,ambiguous,unchanged};
}
const CSV_FIELDS=Object.freeze(['id','resultKey','activityKey','stationKey','provider','organizationId','locationId','locationName','activityId','resultId',
  'activityType','media','mediaSubdivision','date','time','timeZone','endDate','endTime','endTimeZone',
  'characteristic','characteristicComparable','parameterCode','sampleFraction','methodSpeciation','value','valueState','unit',
  'detectionCondition','valueType','qualifier','status','statisticalBase','statisticalN','weightBasis','timeBasis','temperatureBasis','particleSizeBasis',
  'methodIdentifier','methodContext','methodName','comparableMethodIdentifier','comparableMethodContext','comparableMethodModification',
  'sampleCollectionMethodIdentifier','sampleCollectionMethodContext','samplePreparationMethodIdentifier','samplePreparationMethodContext',
  'labPreparationMethodIdentifier','labPreparationMethodContext','labName','resultComment',
  'depthHeight','depthHeightUnit','relativeDepth','resultDepthHeight','resultDepthHeightUnit','resultDepthReference',
  'resultDepthSamplingPoint','resultDepthSamplingPointType','topDepth','topDepthUnit','bottomDepth','bottomDepthUnit',
  'hydrologicCondition','hydrologicEvent','lastChangeDate','duplicate','conflictingDuplicate']);
const csvCell=value=>'"'+text(value).replaceAll('"','""')+'"';
export function waterQualityObservationCsv(model,options={}) {
  const report=summarizeWaterQuality(model,options), originals=new Map(classifyModel(validateModel(model),normalizeAnalysisOptions(options)).map(row=>[row.id,row])), fields=[...CSV_FIELDS,'analysis_classification','analysis_censoring','analysis_included','analysis_exclusion',
    'limits_json','issues_json','original_result_json','original_activity_json','original_station_json','source_url','source_sha256','source_body_file','source_row'];
  const lines=[fields.map(csvCell).join(',')];
  for (const row of report.observations) lines.push([...CSV_FIELDS.map(k=>row[k]??''),row.analysis.classification,row.analysis.censoring,row.analysis.included,row.analysis.exclusion??'',
    json(row.limits || []),json([...(row.issues || []),...row.analysis.issues]),json(originals.get(row.id)?.record),json(originals.get(row.id)?.activityRecords || []),json(originals.get(row.id)?.stationRecords || []),
    row.source?.url??'',row.source?.sha256??'',row.source?.bodyFile??'',row.source?.index??''].map(csvCell).join(','));
  return lines.join('\r\n')+'\r\n';
}
function stationCoordinates(row) {
  const records=(row.stationRecords || []).map(sourceRecord);
  const geometries=[];
  for (const record of records) {
    const coordinates=[
      [record.Location_Latitude,record.Location_Longitude,record.Location_HorzCoordReferenceSystemDatum],
      [record.Location_LatitudeStandardized,record.Location_LongitudeStandardized,record.Location_HorzCoordStandardizedDatum],
      [record.Location_LatitudeMeasure ?? record.LatitudeMeasure,record.Location_LongitudeMeasure ?? record.LongitudeMeasure,
       record.Location_HorizontalCoordinateReferenceSystemDatumName ?? record.HorizontalCoordinateReferenceSystemDatumName]
    ];
    for (const [latitude,longitude,datum] of coordinates) {
      const lat=decimal(latitude),lon=decimal(longitude);
      if (!lat || !lon || !['wgs84','wgs 84','epsg:4326'].includes(word(datum))) continue;
      const y=Number(latitude),x=Number(longitude);
      if (Number.isFinite(x)&&Number.isFinite(y)&&x>=-180&&x<=180&&y>=-90&&y<=90) geometries.push([x,y]);
    }
  }
  const unique=[...new Map(geometries.map(g=>[json(g),g])).values()];
  return unique.length===1?{type:'Point',coordinates:unique[0]}:null;
}
export function waterQualityObservationGeoJson(model,options={}) {
  const report=summarizeWaterQuality(model,options), originals=new Map(classifyModel(validateModel(model),normalizeAnalysisOptions(options)).map(row=>[row.id,row]));
  return {type:'FeatureCollection',capture:report.capture,analysisOptions:report.options,
    coordinateNote:'Geometry uses an unambiguous original WGS84 station coordinate. Other datums and missing/conflicting coordinates remain in properties with null geometry.',
    features:report.observations.map(row=>({type:'Feature',id:row.id,geometry:stationCoordinates(originals.get(row.id) || row),properties:{...row,originalStationRecords:originals.get(row.id)?.stationRecords || []}}))};
}
const html=value=>text(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function metric(value) { return value?.display??'—'; }
function sourceLink(value,label) {
  try { const u=new URL(value); if (u.protocol==='https:' || u.protocol==='http:') return '<a href="'+html(u.href)+'">'+html(label || value)+'</a>'; } catch {}
  return html(label || value);
}
export function renderWaterQualityReport(report,{title='Water quality review',note=''}={}) {
  if (!report || report.schema!=='wqx-water-quality-analysis/v1') throw new TypeError('Expected a saved water quality analysis report');
  const inv=report.inventory, parts=['<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+html(title)+'</title>',
    '<style>body{font:14px/1.5 system-ui,sans-serif;color:#222;background:#fff;margin:32px;max-width:1440px}h1,h2{font-weight:600}h1{font-size:26px}h2{font-size:19px;margin-top:32px}p{max-width:100ch}table{border-collapse:collapse;width:100%;font-size:12px}th,td{border:1px solid #ccc;padding:7px;text-align:left;vertical-align:top}th{background:#eee}a{color:inherit}code{overflow-wrap:anywhere}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:11px}.scroll{overflow:auto}.note{white-space:pre-wrap;border-left:3px solid #888;padding:12px;background:#f4f4f4}.muted{color:#555}@media print{body{margin:12mm}.scroll{overflow:visible}details{break-inside:avoid}}</style><body>',
    '<h1>'+html(title)+'</h1><p>Capture <code>'+html(report.capture.sha256 || 'unidentified')+'</code></p>',
    '<p>'+inv.selectedRows+' source rows · '+inv.uniqueResults+' unique results · '+inv.activities+' sampling activities · '+inv.stations+' sites · '+inv.groups+' scientific groups.</p>',
    '<p>'+inv.arithmeticRows+' selected numeric measurements · '+inv.censored+' censored results · '+inv.estimated+' source estimates · '+inv.qualified+' qualified results · '+inv.duplicates+' duplicate rows · '+inv.conflicts+' conflicting rows.</p>'];
  if (note) parts.push('<h2>Analyst decision</h2><div class="note">'+html(note)+'</div>');
  parts.push('<h2>Analysis selection</h2><pre>'+html(JSON.stringify(report.options,null,2))+'</pre>',
    '<h2>Comparable scientific groups</h2><div class="scroll"><table><thead><tr><th>Site / characteristic / method</th><th>Fraction / unit</th><th>Results / selected</th><th>Minimum</th><th>Maximum</th><th>Mean</th><th>Median</th><th>Censored / estimated / qualified</th></tr></thead><tbody>');
  for (const group of report.groups) parts.push('<tr><td>'+html(group.dimensions.locationId)+'<br>'+html(group.dimensions.characteristic)+'<br>'+html(group.dimensions.methodContext)+' / '+html(group.dimensions.methodIdentifier)+'</td><td>'+html(group.dimensions.sampleFraction)+'<br>'+html(group.dimensions.unit)+'</td><td>'+group.counts.uniqueResults+' / '+group.summary.count+'</td><td>'+metric(group.summary.min)+'</td><td>'+metric(group.summary.max)+'</td><td>'+metric(group.summary.mean)+'</td><td>'+metric(group.summary.median)+'</td><td>'+group.counts.censored+' / '+group.counts.estimated+' / '+group.counts.qualified+'</td></tr>');
  parts.push('</tbody></table></div>');
  if (report.baseline) {
    parts.push('<h2>Period comparison</h2><p>Only identical scientific groups are compared. Sampling counts remain visible alongside the mean change.</p><div class="scroll"><table><tr><th>Group</th><th>Current n / mean</th><th>Baseline n / mean</th><th>Change</th><th>Percent change</th></tr>');
    for (const row of report.comparison) parts.push('<tr><td>'+html(row.label)+'</td><td>'+row.currentCount+' / '+metric(row.currentMean)+'</td><td>'+row.baselineCount+' / '+metric(row.baselineMean)+'</td><td>'+metric(row.change)+' '+html(row.changeUnit)+'</td><td>'+metric(row.percentChange)+(row.percentChange?'%':'')+(row.relativeChangeReason?'<br>'+html(row.relativeChangeReason):'')+'</td></tr>');
    parts.push('</table></div>');
  }
  parts.push('<h2>Original results and detection limits</h2><div class="scroll"><table><tr><th>Date / site</th><th>Characteristic</th><th>Original result</th><th>Condition / qualifier</th><th>Reported limits</th><th>Use in summary / original source</th></tr>');
  for (const row of report.observations) {
    const limits=(row.limits || []).map(limit=>html(limit.type)+' · '+html(limit.value)+' '+html(limit.unit)+' ['+html(limit.origin)+']').join('<br>');
    parts.push('<tr><td>'+html(row.date)+' '+html(row.time)+' '+html(row.timeZone)+'<br>'+html(row.locationId)+'</td><td>'+html(row.characteristic)+'<br>'+html(row.sampleFraction)+'</td><td>'+html(row.value)+' '+html(row.unit)+'<br>'+html(row.valueType)+'</td><td>'+html(row.detectionCondition)+'<br>'+html(row.qualifier)+'</td><td>'+limits+'</td><td>'+html(row.analysis.included?'Included':row.analysis.exclusion)+'<br>'+sourceLink(row.source?.url,'Original result page')+'<br><code>'+html(row.resultId)+'</code></td></tr>');
  }
  parts.push('</table></div><h2>Methods and source interpretation</h2><ul>');
  for (const item of report.sourceNotes) parts.push('<li>'+html(item)+'</li>');
  parts.push('</ul><p>'+report.sources.map(source=>sourceLink(source.url,source.title)).join(' · ')+'</p></body></html>');
  return parts.join('\n');
}
