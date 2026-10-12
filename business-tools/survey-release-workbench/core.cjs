/* Survey Release Workbench — deterministic source, review and release engine. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.SurveyRelease = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const hashTools = (function () {
function ascii(s){const a=new Uint8Array(s.length);for(let i=0;i<s.length;i++){const c=s.charCodeAt(i);if(c>127)throw Error("Expected original ASCII bytes");a[i]=c;}return a;}
function sha256(a){const K=[0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];const h=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];if(a.length>=0x20000000)throw Error("Hash input too large");const b=new Uint8Array(Math.ceil((a.length+9)/64)*64);b.set(a);b[a.length]=128;const bits=a.length*8;for(let j=0;j<4;j++)b[b.length-1-j]=(bits>>>(j*8))&255;const ro=(v,n)=>(v>>>n)|(v<<(32-n));const w=new Uint32Array(64);for(let off=0;off<b.length;off+=64){for(let i=0;i<16;i++){const p=off+i*4;w[i]=((b[p]<<24)|(b[p+1]<<16)|(b[p+2]<<8)|b[p+3])>>>0;}for(let i=16;i<64;i++){let v=w[i-15],u=w[i-2];w[i]=((ro(v,7)^ro(v,18)^(v>>>3))+w[i-16]+(ro(u,17)^ro(u,19)^(u>>>10))+w[i-7])>>>0;}let [A,B,C,D,E,F,G,H]=h;for(let i=0;i<64;i++){const t1=(H+(ro(E,6)^ro(E,11)^ro(E,25))+((E&F)^((~E)&G))+K[i]+w[i])>>>0;const t2=((ro(A,2)^ro(A,13)^ro(A,22))+((A&B)^(A&C)^(B&C)))>>>0;H=G;G=F;F=E;E=(D+t1)>>>0;D=C;C=B;B=A;A=(t1+t2)>>>0;}for(const [i,v]of [A,B,C,D,E,F,G,H].entries())h[i]=(h[i]+v)>>>0;}return h.map(v=>v.toString(16).padStart(8,"0")).join("");}
const crcTable=Array.from({length:256},(_,i)=>{let c=i;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
function crc32(a){let c=0xffffffff;for(const v of a)c=crcTable[(c^v)&255]^(c>>>8);return (c^0xffffffff)>>>0;}
function cat(parts){const out=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let pos=0;for(const p of parts){out.set(p,pos);pos+=p.length;}return out;}
function zip(files){const parts=[],central=[];let offset=0;const u16=(a,v)=>a.push(v&255,(v>>>8)&255),u32=(a,v)=>a.push(v&255,(v>>>8)&255,(v>>>16)&255,(v>>>24)&255);for(const f of files){const name=ascii(f.name),raw=f.raw,crc=crc32(raw),head=[];u32(head,0x04034b50);for(const n of [20,0,0,0,10273])u16(head,n);for(const n of [crc,raw.length,raw.length])u32(head,n);u16(head,name.length);u16(head,0);const local=cat([new Uint8Array(head),name,raw]);parts.push(local);const c=[];u32(c,0x02014b50);for(const n of [788,20,0,0,0,10273])u16(c,n);for(const n of [crc,raw.length,raw.length])u32(c,n);for(const n of [name.length,0,0,0,0])u16(c,n);u32(c,(0o100600<<16)>>>0);u32(c,offset);central.push(cat([new Uint8Array(c),name]));offset+=local.length;}const directory=cat(central),end=[];u32(end,0x06054b50);for(const n of [0,0,files.length,files.length])u16(end,n);u32(end,directory.length);u32(end,offset);u16(end,0);return cat([...parts,directory,new Uint8Array(end)]);}
function base64(a){const alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";let s="";for(let i=0;i<a.length;i+=3){const n=(a[i]<<16)|((a[i+1]??0)<<8)|(a[i+2]??0);s+=alphabet[(n>>>18)&63]+alphabet[(n>>>12)&63]+(i+1<a.length?alphabet[(n>>>6)&63]:"=")+(i+2<a.length?alphabet[n&63]:"=");}return s;}
return {ascii,sha256,crc32,zip,base64};
  })();
function utf8(s){if(typeof TextEncoder!=="undefined")return new TextEncoder().encode(s);const a=[];for(const c of s){const p=c.codePointAt(0);if(p<128)a.push(p);else if(p<2048)a.push(192|(p>>6),128|(p&63));else if(p<65536)a.push(224|(p>>12),128|((p>>6)&63),128|(p&63));else a.push(240|(p>>18),128|((p>>12)&63),128|((p>>6)&63),128|(p&63));}return Uint8Array.from(a);}
function sha1(data){const length=data.length,n=Math.ceil((length+9)/64)*64,b=new Uint8Array(n);b.set(data);b[length]=128;let bitLength=length*8;for(let i=0;i<8;i++){b[n-1-i]=bitLength&255;bitLength=Math.floor(bitLength/256);}let h=[0x67452301,0xefcdab89,0x98badcfe,0x10325476,0xc3d2e1f0];const rol=(x,n)=>(x<<n)|(x>>>(32-n));for(let off=0;off<n;off+=64){const w=new Int32Array(80);for(let i=0;i<16;i++)w[i]=(b[off+4*i]<<24)|(b[off+4*i+1]<<16)|(b[off+4*i+2]<<8)|b[off+4*i+3];for(let i=16;i<80;i++)w[i]=rol(w[i-3]^w[i-8]^w[i-14]^w[i-16],1);let[a,c,d,e,f]=h;for(let i=0;i<80;i++){const fn=i<20?((c&d)|(~c&e)):i<40?(c^d^e):i<60?((c&d)|(c&e)|(d&e)):(c^d^e),k=i<20?0x5a827999:i<40?0x6ed9eba1:i<60?0x8f1bbcdc:0xca62c1d6;const temp=(rol(a,5)+fn+f+k+w[i])|0;f=e;e=d;d=rol(c,30);c=a;a=temp;}h=[(h[0]+a)|0,(h[1]+c)|0,(h[2]+d)|0,(h[3]+e)|0,(h[4]+f)|0];}return h.map(x=>(x>>>0).toString(16).padStart(8,"0")).join("");}
  const digest = text => hashTools.sha256(utf8(text));
  const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
  function canonical(value) {
    if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
    if (value && typeof value === "object") return "{" + Object.keys(value).sort().map(k => JSON.stringify(k) + ":" + canonical(value[k])).join(",") + "}";
    const out = JSON.stringify(value);
    if (out === undefined) throw new Error("Case contains an unsupported value.");
    return out;
  }
  function fail(message) { throw new Error(message); }
  function json(text, path) {
    try { return JSON.parse(text); } catch (error) { fail("Cannot read JSON in " + path + ": " + error.message); }
  }
  function safePath(path) {
    return typeof path === "string" && path.length > 0 && !path.startsWith("/") &&
      !path.includes("\\") && path.split("/").every(p => p !== "" && p !== "." && p !== "..");
  }
  function arrays(data, fields, path) {
    if (!data || typeof data !== "object") fail(path + ": expected parallel arrays.");
    let length = null;
    for (const field of fields) {
      if (!Array.isArray(data[field])) fail(path + ": missing array " + field);
      if (length === null) length = data[field].length;
      else if (length !== data[field].length) fail(path + ": array lengths differ at " + field);
    }
    return length || 0;
  }
  function sourceIdentity(manifest) {
    return "source-" + digest(canonical(manifest)).slice(0, 24);
  }
  function validateSources(manifest, texts) {
    if (!manifest || manifest.schema !== "survey-source-manifest/v1") fail("Unsupported source manifest.");
    if (!manifest.profile || manifest.profile.adapter !== "nyc-ehdp-parallel-arrays/v1") fail("Unsupported data adapter.");
    if (!Array.isArray(manifest.files) || !manifest.files.length) fail("Source manifest has no files.");
    const seen = new Set();
    for (const f of manifest.files) {
      if (!safePath(f.path) || seen.has(f.path)) fail("Invalid or repeated source path: " + f.path);
      seen.add(f.path);
      if (!own(texts, f.path) || typeof texts[f.path] !== "string") fail("Missing original source: " + f.path);
      const bytes = utf8(texts[f.path]);
      if (bytes.length !== f.bytes || hashTools.sha256(bytes) !== f.sha256) fail("Source bytes differ from manifest: " + f.path);
      if (f.git_sha1) {
        const header = utf8("blob " + bytes.length + "\0"), joined = new Uint8Array(header.length + bytes.length);
        joined.set(header); joined.set(bytes, header.length);
        if (sha1(joined) !== f.git_sha1) fail("Original Git object differs: " + f.path);
      }
    }
    for (const path of Object.keys(texts)) if (!seen.has(path)) fail("Unlisted source file: " + path);
    return sourceIdentity(manifest);
  }
  function makeCase(manifest, sourceTexts, createdAt) {
    validateSources(manifest, sourceTexts);
    const result = {
      schema: "survey-release-case/v1",
      case_id: sourceIdentity(manifest),
      created_at: createdAt || new Date().toISOString(),
      manifest: JSON.parse(canonical(manifest)),
      source_texts: Object.assign({}, sourceTexts),
      review_events: []
    };
    buildModel(result, true);
    return result;
  }
  function openCase(input) {
    const result = typeof input === "string" ? json(input, "saved case") : JSON.parse(canonical(input));
    if (!result || result.schema !== "survey-release-case/v1") fail("Choose a Survey Release Workbench case.");
    const actual = validateSources(result.manifest, result.source_texts);
    if (result.case_id !== actual) fail("Case identifier differs from its original sources.");
    const model = buildModel(result, true);
    validateReview(result, model);
    return result;
  }
  function buildModel(savedCase, sourcesAlreadyChecked) {
    if (!sourcesAlreadyChecked) validateSources(savedCase.manifest, savedCase.source_texts);
    const p = savedCase.manifest.profile, read = path => {
      if (!own(savedCase.source_texts, path)) fail("Profile references missing source " + path);
      return json(savedCase.source_texts[path], path);
    };
    const metadata = read(p.metadata_path), periods = read(p.periods_path), geo = read(p.geography_path);
    if (!Array.isArray(metadata) || !Array.isArray(periods)) fail("Metadata and time periods must be arrays.");
    const wanted = new Set(p.indicator_ids.map(String));
    if (wanted.size !== p.indicator_ids.length) fail("The profile repeats an indicator.");
    const indicators = new Map(), measures = new Map(), periodMap = new Map(), geographies = new Map();
    for (const indicator of metadata) {
      if (!wanted.has(String(indicator.IndicatorID))) continue;
      if (indicators.has(String(indicator.IndicatorID))) fail("Repeated indicator metadata.");
      indicators.set(String(indicator.IndicatorID), indicator);
      for (const m of indicator.Measures || []) {
        const key = JSON.stringify([indicator.IndicatorID, m.MeasureID]);
        if (measures.has(key)) fail("Repeated measure metadata " + key);
        measures.set(key, m);
      }
    }
    if (indicators.size !== wanted.size) fail("One or more selected indicators have no metadata.");
    for (const period of periods) {
      if (periodMap.has(String(period.TimePeriodID))) fail("Repeated time period metadata.");
      periodMap.set(String(period.TimePeriodID), period);
    }
    const geoLength = arrays(geo, ["GeoType", "GeoID", "Name"], p.geography_path);
    for (let n = 0; n < geoLength; n++) {
      const key = JSON.stringify([geo.GeoType[n], geo.GeoID[n]]);
      if (geographies.has(key)) fail("Repeated geography lookup key " + key);
      geographies.set(key, {type: geo.GeoType[n], id: geo.GeoID[n], name: geo.Name[n], borough: geo.Borough ? geo.Borough[n] : null, source_path: p.geography_path});
    }
    if (p.geography_supplement_path) {
      const supplement = read(p.geography_supplement_path);
      if (supplement.schema !== "survey-geography-supplement/v1" || !Array.isArray(supplement.rows)) fail("Unsupported geography supplement.");
      for (const g of supplement.rows) {
        const key = JSON.stringify([g.type, g.id]);
        if (geographies.has(key)) fail("Geography supplement would replace an original lookup: " + key);
        if (!g.name || !g.source_reference) fail("Supplementary geography needs a name and source reference.");
        geographies.set(key, Object.assign({}, g, {source_path: p.geography_supplement_path}));
      }
    }
    const rows = [], rowMap = new Map(), problems = [], groups = new Map();
    const required = ["MeasureID", "GeoID", "GeoType", "TimePeriodID", "Value", "CI", "Note", "DisplayValue"];
    for (const indicatorId of [...wanted].sort((a, b) => Number(a) - Number(b))) {
      const path = p.indicator_paths[indicatorId];
      const data = read(path), n = arrays(data, required, path);
      for (let k = 0; k < n; k++) {
        const indicator = indicators.get(indicatorId), measure = measures.get(JSON.stringify([indicator.IndicatorID, data.MeasureID[k]]));
        const period = periodMap.get(String(data.TimePeriodID[k]));
        if (!measure) fail(path + ": unknown measure " + data.MeasureID[k]);
        if (!period) fail(path + ": unknown time period " + data.TimePeriodID[k]);
        const id = JSON.stringify([indicator.IndicatorID, data.MeasureID[k], data.GeoType[k], data.GeoID[k], data.TimePeriodID[k]]);
        if (rowMap.has(id)) fail("Repeated observation key: " + id);
        const g = geographies.get(JSON.stringify([data.GeoType[k], data.GeoID[k]]));
        const note = data.Note[k] == null ? "" : String(data.Note[k]);
        const display = data.DisplayValue[k] == null ? "" : String(data.DisplayValue[k]);
        const suppressed = display === "**" || /\bsuppressed\b/i.test(note);
        const flags = [];
        if (suppressed) flags.push("suppressed");
        else if (note) flags.push("source-caution");
        if (!display && !suppressed) flags.push("no-published-value");
        if (!g) flags.push("geography-label-unresolved");
        if (!(measure.AvailableGeoTypes || []).includes(data.GeoType[k])) flags.push("historical-geography");
        if (!(measure.AvailableTimePeriodIDs || []).includes(data.TimePeriodID[k])) flags.push("period-outside-current-metadata");
        const cut = /^\d{4}$/.test(String(measure.TrendNoCompare)) ? Date.UTC(Number(measure.TrendNoCompare), 0, 1) : null;
        const era = cut === null ? "unspecified" : period.end_period < cut ? "before-" + measure.TrendNoCompare : period.start_period >= cut ? "from-" + measure.TrendNoCompare : "spans-" + measure.TrendNoCompare;
        if (era.startsWith("spans-")) flags.push("spans-methodology-break");
        const row = {
          id, indicator_id: indicator.IndicatorID, measure_id: data.MeasureID[k],
          geo_type: data.GeoType[k], geo_id: data.GeoID[k], period_id: data.TimePeriodID[k],
          raw_value: data.Value[k], display_value: display, source_ci: data.CI[k] == null ? "" : String(data.CI[k]),
          published_ci: suppressed ? "" : data.CI[k] == null ? "" : String(data.CI[k]),
          source_note: note, suppressed, era, flags, source_path: path, source_index: k
        };
        rows.push(row); rowMap.set(id, row);
        if (flags.length) problems.push({row_id: id, flags: flags.slice()});
        const groupKey = JSON.stringify([row.indicator_id, row.measure_id, row.geo_type, row.geo_id]);
        if (!groups.has(groupKey)) groups.set(groupKey, []);
        groups.get(groupKey).push(row);
      }
    }
    for (const group of groups.values()) group.sort((a, b) => periodMap.get(String(a.period_id)).start_period - periodMap.get(String(b.period_id)).start_period || a.period_id - b.period_id);
    return {manifest: savedCase.manifest, rows, rowMap, indicators, measures, periods: periodMap, geographies, groups, problems};
  }
  function reviewState(savedCase) {
    const state = new Map();
    for (const event of savedCase.review_events) {
      const previous = state.get(event.row_id);
      // An annotation changes the note, not the last explicit publication decision.
      const disposition = event.action === "annotate" ? (previous ? previous.disposition : "include") : event.action;
      const dispositionNote = event.action === "annotate" ? (previous ? previous.disposition_note : "") : event.note;
      state.set(event.row_id, Object.assign({}, event, {disposition, disposition_note: dispositionNote}));
    }
    return state;
  }
  function validateReview(savedCase, model) {
    if (!Array.isArray(savedCase.review_events)) fail("Saved case is missing its review history.");
    let previous = savedCase.case_id;
    for (const event of savedCase.review_events) {
      const payload = Object.assign({}, event); delete payload.event_id;
      if (event.previous !== previous || event.event_id !== digest(canonical(payload))) fail("Review history differs from its saved sequence.");
      if (!model.rowMap.has(event.row_id)) fail("Review references an observation outside this case.");
      if (!["include", "exclude", "annotate"].includes(event.action) || typeof event.note !== "string") fail("Unsupported review action.");
      previous = event.event_id;
    }
    return previous;
  }
  function recordReview(savedCase, model, rowId, action, note, at) {
    if (!model.rowMap.has(rowId)) fail("Choose an observation from this case.");
    if (!["include", "exclude", "annotate"].includes(action)) fail("Choose include, exclude or annotate.");
    note = String(note || "").trim();
    if (action === "exclude" && !note) fail("Add a reason so the exclusion survives handoff.");
    const last = savedCase.review_events[savedCase.review_events.length - 1];
    if (last && last.row_id === rowId && last.action === action && last.note === note) return last;
    const payload = {previous: last ? last.event_id : savedCase.case_id, row_id: rowId, action, note, at: at || new Date().toISOString()};
    const event = Object.assign({event_id: digest(canonical(payload))}, payload);
    savedCase.review_events.push(event);
    return event;
  }
  function describe(model, row) {
    const indicator = model.indicators.get(String(row.indicator_id));
    const measure = model.measures.get(JSON.stringify([row.indicator_id, row.measure_id]));
    const period = model.periods.get(String(row.period_id));
    const geography = model.geographies.get(JSON.stringify([row.geo_type, row.geo_id]));
    return {indicator, measure, period, geography};
  }
  function matches(model, row, filters, review) {
    filters = filters || {};
    const fields = {indicator_ids: "indicator_id", measure_ids: "measure_id", geo_types: "geo_type", geo_ids: "geo_id", period_ids: "period_id", eras: "era"};
    for (const [name, key] of Object.entries(fields)) {
      const values = filters[name]; if (Array.isArray(values) && values.length && !values.map(String).includes(String(row[key]))) return false;
    }
    const decision = review && review.get(row.id);
    if (filters.review === "excluded" && (!decision || decision.disposition !== "exclude")) return false;
    if (filters.review === "included" && decision && decision.disposition === "exclude") return false;
    if (filters.review === "reviewed" && !decision) return false;
    if (filters.flag && !row.flags.includes(filters.flag)) return false;
    if (filters.search) {
      const d = describe(model, row), text = [d.indicator.IndicatorName, d.measure.MeasureName, d.geography && d.geography.name, d.period.TimePeriod, row.geo_type, row.geo_id, row.source_note, decision && decision.note].join(" ").toLowerCase();
      if (!text.includes(String(filters.search).toLowerCase())) return false;
    }
    return true;
  }
  function selectedRows(model, savedCase, filters) {
    const review = reviewState(savedCase);
    return model.rows.filter(row => matches(model, row, filters, review));
  }
  function summary(model, savedCase) {
    const review = reviewState(savedCase), byFlag = {}, byGeo = {}, byEra = {};
    let excluded = 0;
    for (const row of model.rows) {
      for (const flag of row.flags) byFlag[flag] = (byFlag[flag] || 0) + 1;
      byGeo[row.geo_type] = (byGeo[row.geo_type] || 0) + 1;
      byEra[row.era] = (byEra[row.era] || 0) + 1;
      if (review.get(row.id)?.disposition === "exclude") excluded++;
    }
    return {observations: model.rows.length, indicators: model.indicators.size, measures: model.measures.size,
      source_files: savedCase.manifest.files.length, source_bytes: savedCase.manifest.files.reduce((n, f) => n + f.bytes, 0),
      reviewed_observations: review.size, review_events: savedCase.review_events.length, excluded_observations: excluded,
      included_observations: model.rows.length - excluded, flags: byFlag, geographies: byGeo, eras: byEra};
  }
  function csvCell(value) {
    let s = value == null ? "" : String(value);
    // A leading apostrophe prevents formula execution when this file is opened in a spreadsheet.
    // Exact unmodified text remains available in release.json and the original source case.
    const trimmed = s.trimStart();
    const negativeNumber = /^-(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(trimmed);
    if (/^[=+@\t\r\n]/.test(s) || /^[=+@]/.test(trimmed) || (trimmed.startsWith("-") && !negativeNumber)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  }
  const columns = ["row_id","indicator_id","indicator","measure_id","measure","measurement_type","display_type","geography_type","geography_id","geography","borough","period_id","period","period_start_utc","period_end_utc","published_value","confidence_interval","source_note","methodology_era","review_action","review_disposition","review_note","review_disposition_note","source_path","source_row_index","flags"];
  function publicRow(model, row, decision) {
    const d = describe(model, row);
    return {
      row_id: row.id, indicator_id: row.indicator_id, indicator: d.indicator.IndicatorName, measure_id: row.measure_id, measure: d.measure.MeasureName,
      measurement_type: d.measure.MeasurementType, display_type: d.measure.DisplayType || "",
      geography_type: row.geo_type, geography_id: row.geo_id, geography: d.geography ? d.geography.name : row.geo_type + " / " + row.geo_id,
      borough: d.geography ? d.geography.borough || "" : "", period_id: row.period_id, period: d.period.TimePeriod,
      period_start_utc: Number.isFinite(d.period.start_period) ? new Date(d.period.start_period).toISOString().slice(0,10) : "",
      period_end_utc: Number.isFinite(d.period.end_period) ? new Date(d.period.end_period).toISOString().slice(0,10) : "",
      published_value: row.display_value, confidence_interval: row.published_ci, source_note: row.source_note, methodology_era: row.era,
      trend_no_compare: d.measure.TrendNoCompare == null ? "" : String(d.measure.TrendNoCompare),
      how_calculated: d.measure.how_calculated, source: d.measure.Sources,
      review_action: decision ? decision.action : "unchanged", review_disposition: decision ? decision.disposition : "include",
      review_note: decision ? decision.note : "", review_disposition_note: decision ? decision.disposition_note : "",
      source_path: row.source_path, source_row_index: row.source_index, flags: row.flags.join(";")
    };
  }
  function release(savedCase, model, filters) {
    validateReview(savedCase, model);
    const state = reviewState(savedCase), chosen = selectedRows(model, savedCase, filters), excluded = [], rows = [];
    for (const row of chosen) {
      const decision = state.get(row.id), out = publicRow(model, row, decision);
      if (decision && decision.disposition === "exclude") excluded.push(out); else rows.push(out);
    }
    const payload = {
      schema: "survey-publication/v1", case_id: savedCase.case_id, source_id: sourceIdentity(savedCase.manifest),
      review_revision: savedCase.review_events.length ? savedCase.review_events[savedCase.review_events.length - 1].event_id : savedCase.case_id,
      title: savedCase.manifest.title, source_commit: savedCase.manifest.commit, filters: filters || {},
      columns: columns.slice(), rows: rows.map(row => columns.map(c => row[c])), exclusions: excluded.map(row => columns.map(c => row[c])),
      dictionary: {
        indicators: [...model.indicators.values()].map(i => ({id:i.IndicatorID,name:i.IndicatorName,description:i.IndicatorDescription})),
        measures: [...model.measures.entries()].map(([key,m]) => ({key:JSON.parse(key),definition:m})),
        periods: [...model.periods.values()],
        geographies: [...model.geographies.values()]
      },
      methodology_sources: savedCase.manifest.methodology_sources || [],
      publication_rules: [
        "published_value preserves the source DisplayValue, including suppression and caution markers.",
        "Confidence intervals are carried from the source; suppressed observations have no published confidence interval.",
        "Review actions do not edit original estimates, confidence intervals or source notes.",
        "Geography types and measurement types remain distinct. No geographic crosswalk is inferred.",
        "No weighting, confidence interval, p-value or complex-survey estimate is calculated by this workbench."
      ]
    };
    const edition = "edition-" + digest(canonical(payload)).slice(0, 24);
    const csv = columns.map(csvCell).join(",") + "\r\n" + rows.map(row => columns.map(c => csvCell(row[c])).join(",")).join("\r\n") + (rows.length ? "\r\n" : "");
    const output = Object.assign({edition_id: edition}, payload);
    const jsonText = canonical(output) + "\n";
    const codebookColumns = ["indicator_id","indicator","measure_id","measure","measurement_type","display_type","how_calculated","source","trend_no_compare"];
    const codebookRows = [...model.measures.entries()].map(([key,m]) => {
      const [indicator_id, measure_id] = JSON.parse(key);
      return {indicator_id, indicator:model.indicators.get(String(indicator_id)).IndicatorName, measure_id, measure:m.MeasureName, measurement_type:m.MeasurementType, display_type:m.DisplayType || "", how_calculated:m.how_calculated, source:m.Sources, trend_no_compare:m.TrendNoCompare || ""};
    });
    const codebook = codebookColumns.map(csvCell).join(",") + "\r\n" + codebookRows.map(row => codebookColumns.map(c => csvCell(row[c])).join(",")).join("\r\n") + "\r\n";
    return {edition_id: edition, json: jsonText, csv, codebook, manifest: {
      schema: "survey-release-edition/v1", edition_id: edition, case_id: savedCase.case_id,
      review_revision: payload.review_revision, rows: rows.length, exclusions: excluded.length,
      files: [{path:"release.csv", bytes:utf8(csv).length, sha256:digest(csv)}, {path:"release.json", bytes:utf8(jsonText).length, sha256:digest(jsonText)}, {path:"codebook.csv",bytes:utf8(codebook).length,sha256:digest(codebook)}]
    }, publication: output};
  }
  function compareRows(model, left, right) {
    const a = describe(model, left), b = describe(model, right), reasons = [];
    if (left.indicator_id !== right.indicator_id || left.measure_id !== right.measure_id) reasons.push("Choose the same indicator and measurement definition.");
    if (left.geo_type !== right.geo_type || left.geo_id !== right.geo_id) reasons.push("Choose the same geography type and identifier.");
    if (a.period.start_period <= b.period.end_period && b.period.start_period <= a.period.end_period) reasons.push("The periods overlap.");
    if (left.era !== right.era || left.era.startsWith("spans-") || right.era.startsWith("spans-")) reasons.push("The source marks a methodology break between these periods.");
    if (left.suppressed || right.suppressed || typeof left.raw_value !== "number" || typeof right.raw_value !== "number") reasons.push("One or both estimates are suppressed or missing.");
    const imputation = /[Bb]eginning in (\d{4}),[^.]*imput/.exec(a.measure.how_calculated || "");
    if (imputation) {
      const cut = Date.UTC(Number(imputation[1]), 0, 1);
      const sides = p => p.end_period < cut ? -1 : p.start_period >= cut ? 1 : 0;
      if (sides(a.period) !== sides(b.period) || !sides(a.period) || !sides(b.period)) reasons.push("The measure changes its missing-response imputation in " + imputation[1] + ".");
    }
    return {comparable: !reasons.length, reasons, left_id:left.id, right_id:right.id, left_period:a.period.TimePeriod, right_period:b.period.TimePeriod,
      difference: reasons.length ? null : Number((right.raw_value - left.raw_value).toPrecision(12)),
      unit:a.measure.MeasurementType, note:"This is a descriptive difference in source units. It is not a significance test; source cautions and confidence intervals still apply."};
  }
  function compareCases(leftCase, rightCase) {
    const left = buildModel(leftCase), right = buildModel(rightCase);
    const leftReview = reviewState(leftCase), rightReview = reviewState(rightCase), changes = [];
    const signatures = m => ({indicators:new Map([...m.indicators].map(([k,v])=>{const metadata=Object.assign({},v);delete metadata.Measures;return [k,canonical(metadata)];})),measures:new Map([...m.measures].map(([k,v])=>[k,canonical(v)])),periods:new Map([...m.periods].map(([k,v])=>[k,canonical(v)])),geographies:new Map([...m.geographies].map(([k,v])=>[k,canonical(v)]))});
    const leftSignatures=signatures(left),rightSignatures=signatures(right);
    for (const id of new Set([...left.rowMap.keys(), ...right.rowMap.keys()])) {
      const a = left.rowMap.get(id), b = right.rowMap.get(id);
      if (!a || !b) { changes.push({row_id:id, kind:!a ? "added" : "removed"}); continue; }
      const fields = ["raw_value","display_value","source_ci","source_note","era"];
      const changed = fields.filter(key => a[key] !== b[key]);
      const measureKey=JSON.stringify([a.indicator_id,a.measure_id]),geoKey=JSON.stringify([a.geo_type,a.geo_id]);
      if (leftSignatures.indicators.get(String(a.indicator_id)) !== rightSignatures.indicators.get(String(b.indicator_id))) changed.push("indicator_metadata");
      if (leftSignatures.measures.get(measureKey) !== rightSignatures.measures.get(measureKey)) changed.push("measure_metadata");
      if (leftSignatures.periods.get(String(a.period_id)) !== rightSignatures.periods.get(String(b.period_id))) changed.push("period_metadata");
      if (leftSignatures.geographies.get(geoKey) !== rightSignatures.geographies.get(geoKey)) changed.push("geography_metadata");
      const ra = leftReview.get(id), rb = rightReview.get(id);
      const reviewSignature = r => r ? {action:r.action,disposition:r.disposition,note:r.note,disposition_note:r.disposition_note} : null;
      if (canonical(reviewSignature(ra)) !== canonical(reviewSignature(rb))) changed.push("review");
      if (changed.length) changes.push({row_id:id, kind:"changed", fields:changed});
    }
    return {left_case_id:leftCase.case_id, right_case_id:rightCase.case_id, changes,
      counts:changes.reduce((n, r) => {n[r.kind]++; return n;}, {added:0,removed:0,changed:0})};
  }
  function zipFiles(files, deflate) {
    const parts=[], directory=[]; let offset=0;
    const put16=(a,v)=>a.push(v&255,(v>>>8)&255),put32=(a,v)=>a.push(v&255,(v>>>8)&255,(v>>>16)&255,(v>>>24)&255);
    const join=list=>{const out=new Uint8Array(list.reduce((n,a)=>n+a.length,0));let i=0;for(const a of list){out.set(a,i);i+=a.length;}return out;};
    const seen=new Set();
    for(const f of files){
      if(!safePath(f.name)||!/^[\x20-\x7e]+$/.test(f.name)||seen.has(f.name))fail("Invalid or repeated delivery filename.");
      seen.add(f.name);const name=utf8(f.name),raw=typeof f.content==="string"?utf8(f.content):f.content;
      const compressed=deflate?deflate(raw):raw,packed=compressed.length<raw.length?compressed:raw,method=packed===raw?0:8,crc=hashTools.crc32(raw),head=[];
      put32(head,0x04034b50);for(const v of [20,0,method,0,33])put16(head,v);
      for(const v of [crc,packed.length,raw.length])put32(head,v);put16(head,name.length);put16(head,0);
      const local=join([Uint8Array.from(head),name,packed]);parts.push(local);
      const c=[];put32(c,0x02014b50);for(const v of [788,20,0,method,0,33])put16(c,v);
      for(const v of [crc,packed.length,raw.length])put32(c,v);for(const v of [name.length,0,0,0,0])put16(c,v);
      put32(c,(0o100644<<16)>>>0);put32(c,offset);directory.push(join([Uint8Array.from(c),name]));offset+=local.length;
    }
    const central=join(directory),end=[];put32(end,0x06054b50);for(const v of [0,0,files.length,files.length])put16(end,v);
    put32(end,central.length);put32(end,offset);put16(end,0);return join([...parts,central,Uint8Array.from(end)]);
  }
  return {zipFiles,canonical,digest,utf8,safePath,validateSources,sourceIdentity,makeCase,openCase,buildModel,recordReview,reviewState,validateReview,describe,selectedRows,summary,publicRow,release,compareRows,compareCases};
});
