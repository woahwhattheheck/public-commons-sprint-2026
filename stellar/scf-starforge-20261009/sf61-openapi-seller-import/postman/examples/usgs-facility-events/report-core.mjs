// MIT. Pure customer reporting from retained USGS GeoJSON and explicit facilities.
const numeric = value => typeof value === 'number' && Number.isFinite(value);
const text = value => typeof value === 'string' ? value : '';
const iso = value => Number.isSafeInteger(value) && Math.abs(value) <= 8640000000000000
  ? new Date(value).toISOString() : null;
const byText = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const round = value => Math.round(value * 1000) / 1000;
const escape = value => String(value ?? '').replace(/[&<>"']/g, value =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[value]));

function facilitiesOf(input) {
  if (input?.schema !== 'commons.facility-watch-input.v1' || !Array.isArray(input.facilities) ||
      input.facilities.length < 1 || input.facilities.length > 500)
    throw new TypeError('Supply a facility-watch input with 1–500 explicit facilities.');
  const ids = new Set();
  return input.facilities.map(site => {
    if (!site || typeof site.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(site.id) || ids.has(site.id))
      throw new TypeError('Each facility needs a distinct stable id.');
    if (!text(site.name) || site.name.length > 300 ||
        !numeric(site.latitude) || Math.abs(site.latitude) > 90 ||
        !numeric(site.longitude) || Math.abs(site.longitude) > 180 ||
        !numeric(site.radiusKm) || site.radiusKm <= 0 || site.radiusKm > 20002 ||
        !numeric(site.minimumMagnitude) || site.minimumMagnitude < -10 || site.minimumMagnitude > 10)
      throw new TypeError('Facility ' + site.id + ' needs valid coordinates, radiusKm and minimumMagnitude.');
    ids.add(site.id);
    return {id:site.id, name:site.name, latitude:site.latitude, longitude:site.longitude,
      radiusKm:site.radiusKm, minimumMagnitude:site.minimumMagnitude};
  }).sort((a,b) => byText(a.id,b.id));
}

function eventOf(feature) {
  const p = feature?.properties, coordinates = feature?.geometry?.coordinates;
  if (feature?.type !== 'Feature' || !text(feature.id) || feature.id.length > 200 ||
      !p || typeof p !== 'object' || feature?.geometry?.type !== 'Point' ||
      !Array.isArray(coordinates) || coordinates.length < 2 ||
      !numeric(coordinates[0]) || Math.abs(coordinates[0]) > 180 ||
      !numeric(coordinates[1]) || Math.abs(coordinates[1]) > 90 ||
      !iso(p.time) || !iso(p.updated)) return null;
  return {id:feature.id, time:p.time, updated:p.updated, timeUtc:iso(p.time), updatedUtc:iso(p.updated),
    magnitude:numeric(p.mag) ? p.mag : null, longitude:coordinates[0], latitude:coordinates[1],
    depthKm:numeric(coordinates[2]) ? coordinates[2] : null,
    place:text(p.place), status:text(p.status), eventType:text(p.type),
    url:text(p.url), alert:typeof p.alert === 'string' ? p.alert : null};
}

function distanceKm(a, b) {
  const radians = Math.PI / 180;
  const lat = (b.latitude - a.latitude) * radians;
  const lon = (b.longitude - a.longitude) * radians;
  const h = Math.sin(lat/2) ** 2 +
    Math.cos(a.latitude*radians) * Math.cos(b.latitude*radians) * Math.sin(lon/2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(Math.min(1, h)), Math.sqrt(Math.max(0, 1-h)));
}

export function buildFacilityReport(inputs, facilityInput, options = {}) {
  if (!Array.isArray(inputs) || !inputs.length || inputs.length > 16)
    throw new TypeError('Supply 1–16 retained GeoJSON responses.');
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  if (typeof generatedAt !== 'string' || !Number.isFinite(Date.parse(generatedAt)))
    throw new TypeError('generatedAt must be an ISO timestamp.');
  const facilities = facilitiesOf(facilityInput), events = new Map(), sources = [];
  const issues = [], conflicts = new Set();
  let receivedFeatures = 0, duplicateIds = 0, supersededRevisions = 0, invalidFeatures = 0;
  for (const input of inputs) {
    const document = input?.document;
    if (document?.type !== 'FeatureCollection' || !Array.isArray(document.features))
      throw new TypeError('Input ' + text(input?.name) + ' must be a USGS GeoJSON FeatureCollection.');
    if (receivedFeatures + document.features.length > 100000)
      throw new TypeError('Use a report containing at most 100000 received event rows.');
    if (document.metadata?.status !== undefined && document.metadata.status !== 200)
      throw new TypeError('Input ' + text(input.name) + ' has a non-success provider status.');
    const sourceIndex = sources.length;
    sources.push({name:text(input.name), sha256:text(input.sha256) || null,
      url:text(document.metadata?.url) || null, generatedUtc:iso(document.metadata?.generated),
      returnedFeatures:document.features.length,
      declaredCount:Number.isSafeInteger(document.metadata?.count) ? document.metadata.count : null});
    if (sources[sourceIndex].declaredCount !== null &&
        sources[sourceIndex].declaredCount !== document.features.length)
      issues.push({source:sourceIndex, issue:'Provider count differs from the retained feature count.'});
    for (let index=0; index<document.features.length; index++) {
      receivedFeatures++;
      const event = eventOf(document.features[index]);
      if (!event) {
        invalidFeatures++;
        issues.push({source:sourceIndex, index, id:text(document.features[index]?.id) || null,
          issue:'Event cannot be located or dated from its retained source.'});
        continue;
      }
      event.sources = [sourceIndex];
      const previous = events.get(event.id);
      if (!previous) { events.set(event.id, event); continue; }
      duplicateIds++;
      if (previous.updated !== event.updated) {
        supersededRevisions++;
        if (event.updated > previous.updated) { events.set(event.id, event); conflicts.delete(event.id); }
      } else {
        const comparable = value => JSON.stringify({...value, sources:[]});
        if (comparable(previous) !== comparable(event)) {
          conflicts.add(event.id);
          issues.push({source:sourceIndex, index, id:event.id,
            issue:'Conflicting event contents have the same update timestamp; inspect both retained inputs.'});
        } else previous.sources.push(sourceIndex);
      }
    }
  }
  const usable = [...events.values()].filter(event => !conflicts.has(event.id))
    .sort((a,b) => b.time - a.time || byText(a.id,b.id));
  const unknownMagnitude = usable.filter(event => event.magnitude === null).map(event => event.id);
  const excludedTypes = usable.filter(event => event.eventType !== 'earthquake').map(event => event.id);
  // A single report is an operator document: cap its total rows across all sites.
  // Compute first, then copy only a matching event; broad regions do not allocate
  // facilities × events temporary objects or unbounded rendered output.
  const maximumMatches = 10000;
  let totalMatches = 0;
  const reports = facilities.map(facility => {
    const matches = [];
    for (const event of usable) {
      if (event.eventType !== 'earthquake' || event.magnitude === null ||
          event.magnitude < facility.minimumMagnitude) continue;
      const distance = distanceKm(facility,event);
      if (distance > facility.radiusKm) continue;
      if (totalMatches >= maximumMatches)
        throw new RangeError('This report exceeds 10000 matching facility/event rows. Split the facility list or source time windows into separate reports, or narrow the explicit radius/magnitude thresholds, then use the same retained response files.');
      totalMatches++;
      matches.push({...event,distanceKm:round(distance)});
    }
    return {...facility, matchCount:matches.length, events:matches};
  });
  return {schema:'commons.facility-event-report.v1', generatedAt:new Date(generatedAt).toISOString(),
    attribution:'Source data: U.S. Geological Survey.',
    method:'Great-circle epicentral distance with a 6371 km spherical Earth; threshold comparisons use unrounded distances.',
    scope:'Events within each supplied radius and magnitude threshold, for the retained source windows. Site actions require the operator’s own procedure.',
    sources, counts:{receivedFeatures, uniqueEventIds:events.size, duplicateIds, supersededRevisions,
      invalidFeatures, conflictingEventIds:conflicts.size, unknownMagnitude:unknownMagnitude.length,
      otherEventTypes:excludedTypes.length, facilities:reports.length,
      facilitiesWithMatches:reports.filter(site => site.matchCount > 0).length,
      facilityEventMatches:reports.reduce((sum,site) => sum+site.matchCount,0)},
    excluded:{conflictingEventIds:[...conflicts].sort(byText), unknownMagnitude, otherEventTypes:excludedTypes},
    issues, facilities:reports};
}

export function renderFacilityCsv(report) {
  const headings = ['facility_id','facility_name','radius_km','minimum_magnitude','event_id','event_time_utc',
    'event_updated_utc','magnitude','epicentral_distance_km','event_latitude','event_longitude','depth_km',
    'place','review_status','event_url'];
  const cell = value => {
    let output = String(value ?? '');
    if (typeof value === 'string' && /^[\s]*[=+@\t\r-]/.test(output)) output = "'" + output;
    return '"' + output.replaceAll('"','""') + '"';
  };
  const rows = report.facilities.flatMap(site => site.events.map(event => [
    site.id,site.name,site.radiusKm,site.minimumMagnitude,event.id,event.timeUtc,event.updatedUtc,
    event.magnitude,event.distanceKm,event.latitude,event.longitude,event.depthKm,event.place,event.status,event.url]));
  return [headings,...rows].map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
}

export function renderFacilityHtml(report) {
  const sections = report.facilities.map(site => {
    const rows = site.events.map(event => {
      const url = /^https:\/\/earthquake\.usgs\.gov\//.test(event.url) ? event.url : null;
      const name = escape(event.id);
      return '<tr><td>'+(url?'<a href="'+escape(url)+'" rel="noreferrer">'+name+'</a>':name)+
        '</td><td>'+escape(event.timeUtc)+'</td><td>'+escape(event.magnitude)+'</td><td>'+
        escape(event.distanceKm)+'</td><td>'+escape(event.place)+'</td><td>'+escape(event.status)+
        '</td><td>'+escape(event.updatedUtc)+'</td></tr>';
    }).join('');
    return '<section><h2>'+escape(site.name)+'</h2><p>'+escape(site.id)+' · '+escape(site.radiusKm)+
      ' km radius · magnitude ≥ '+escape(site.minimumMagnitude)+' · '+site.matchCount+' matching events</p>'+
      '<div class="table"><table><thead><tr><th>Event</th><th>Time (UTC)</th><th>Magnitude</th>'+
      '<th>Distance (km)</th><th>Place</th><th>Status</th><th>Updated (UTC)</th></tr></thead><tbody>'+
      (rows||'<tr><td colspan="7">No matching event in the supplied source windows.</td></tr>')+'</tbody></table></div></section>';
  }).join('');
  const sourceRows = report.sources.map(source => '<tr><td>'+escape(source.name)+'</td><td>'+
    escape(source.generatedUtc??'Not supplied')+'</td><td>'+source.returnedFeatures+'</td><td class="hash">'+
    escape(source.sha256??'Not supplied')+'</td></tr>').join('');
  return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<title>Facility event watch</title><style>body{font:15px/1.5 system-ui,sans-serif;color:#171717;background:#f5f5f5;margin:0}'+
    'main{max-width:1400px;margin:auto;padding:28px}h1{font-size:28px;margin:0}h2{font-size:19px;margin:0}p{margin:8px 0}'+
    'header,section{background:white;border:1px solid #ccc;padding:20px;margin-bottom:18px}.table{overflow:auto}'+
    'table{border-collapse:collapse;width:100%;font-size:13px}th,td{text-align:left;border-bottom:1px solid #ddd;padding:9px;vertical-align:top}'+
    'th{background:#eee;white-space:nowrap}a{color:#111;text-decoration:underline}.hash{font-family:monospace;overflow-wrap:anywhere}'+
    '@media(max-width:600px){main{padding:12px}header,section{padding:12px}}</style><main><header><h1>Facility event watch</h1>'+
    '<p>'+escape(report.attribution)+'</p><p>Prepared '+escape(report.generatedAt)+' · '+
    report.counts.facilities+' facilities · '+report.counts.facilityEventMatches+' facility/event matches</p>'+
    '<p>'+escape(report.scope)+'</p><p>'+escape(report.method)+'</p></header>'+sections+
    '<section><h2>Source windows</h2><div class="table"><table><thead><tr><th>Retained response</th>'+
    '<th>Provider generation (UTC)</th><th>Events</th><th>Source SHA-256</th></tr></thead><tbody>'+sourceRows+
    '</tbody></table></div><p>'+report.counts.duplicateIds+' repeated event IDs; '+report.counts.supersededRevisions+
    ' older revisions superseded; '+report.counts.invalidFeatures+' unusable rows; '+
    report.counts.conflictingEventIds+' conflicting IDs; '+report.counts.unknownMagnitude+
    ' events without magnitude; '+report.counts.otherEventTypes+' other event types.</p></section>'+
    (report.issues.length?'<section><h2>Source issues</h2><pre>'+escape(JSON.stringify(report.issues,null,2))+'</pre></section>':'')+
    '</main></html>\n';
}
