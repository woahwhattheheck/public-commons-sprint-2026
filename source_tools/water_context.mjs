/**
 * Source-water and classified-reach context for the Upper Savannah application.
 * Pure functions: usable by the existing Node receiver or a browser consumer.
 * Physical model outputs and spatial catchment assignment stay with their owners.
 */
export const HUC_FIELDS = ["huc12_code", "huc12", "HUC12", "HUC_12", "HU_12", "HUC_12_CODE"];
export const PRIORITY_FIELDS = ["huc12_code", "huc12_name", "st_usps", "fy26_status",
  "system_type", "resource_concern", "st_ac", "huc12_ac", "huc12_states",
  "OBJECTID", "last_edited_date"];
export const CLASS_FIELDS = ["OBJECTID", "HYDNAME", "HYDTYPE", "H2OCLASS", "HUC_12",
  "Cnty_Name", "Basin", "MainStem", "Navigable", "Shape_Length"];
const fail = message => { throw new Error(message); };
const huc = value => typeof value === "string" && /^\d{12}$/.test(value)
  ? value : fail("HUC12 must be a twelve-character string: " + JSON.stringify(value));
const records = value => {
  if (value && value.error) fail("Source returned an ArcGIS error: " + JSON.stringify(value.error));
  if (value && value.exceededTransferLimit) fail("Source response is incomplete; receive all pages first.");
  const rows = Array.isArray(value) ? value : value && value.features;
  if (!Array.isArray(rows)) fail("Expected records or an ArcGIS/GeoJSON feature array.");
  return rows.map(row => row.attributes || row.properties || row);
};

export function domainHucs(value, hucField) {
  let rows;
  if (Array.isArray(value)) rows = value;
  else if (Array.isArray(value.huc12s)) rows = value.huc12s;
  else rows = records(value);
  const ids = rows.map(row => {
    if (typeof row === "string") return huc(row);
    const fields = hucField ? [hucField] : HUC_FIELDS;
    const values = fields.filter(key => row[key] !== undefined && row[key] !== null)
      .map(key => huc(row[key]));
    if (!values.length) fail("A model-domain row has no HUC12 field.");
    if (new Set(values).size !== 1) fail("Conflicting HUC12 fields in a model-domain row.");
    return values[0];
  });
  if (!ids.length) fail("Model domain is empty.");
  return [...new Set(ids)].sort();
}

export function priorityRows(value) {
  const seen = new Set();
  const result = records(value).map(row => {
    const out = Object.fromEntries(PRIORITY_FIELDS.map(key => [key, row[key] ?? null]));
    huc(out.huc12_code);
    if (typeof out.st_usps !== "string" || !/^[A-Z]{2}$/.test(out.st_usps))
      fail("Missing state on NRCS source record.");
    const key = out.huc12_code + "/" + out.st_usps;
    if (seen.has(key)) fail("Duplicate NRCS HUC/state record: " + key);
    seen.add(key);
    if (!["Not Selected", "High Priority Area"].includes(out.fy26_status))
      fail("Unexpected FY26 priority status for " + key);
    if (out.system_type !== null && !["Surface", "Ground", "Both"].includes(out.system_type))
      fail("Unexpected source system type for " + key);
    if (out.resource_concern !== null &&
        !["Water Quality", "Water Quantity/Aquifer Depletion", "Both"].includes(out.resource_concern))
      fail("Unexpected resource concern for " + key);
    for (const field of ["st_ac", "huc12_ac"])
      if (out[field] !== null && (!Number.isFinite(out[field]) || out[field] < 0))
        fail("Invalid source area in " + field + " for " + key);
    return out;
  });
  return result.sort((a, b) => a.huc12_code.localeCompare(b.huc12_code) ||
    a.st_usps.localeCompare(b.st_usps));
}

export function classifiedRows(value) {
  const seen = new Set();
  return records(value).map(row => {
    const out = Object.fromEntries(CLASS_FIELDS.map(key => [key, row[key] ?? null]));
    if (!Number.isInteger(out.OBJECTID)) fail("Classified reach is missing its source OBJECTID.");
    if (seen.has(out.OBJECTID)) fail("Duplicate classified-reach OBJECTID: " + out.OBJECTID);
    seen.add(out.OBJECTID);
    if (!["ORW", "ONRW", "TN", "TPGT", "TPT"].includes(out.H2OCLASS))
      fail("This high-quality-water capture contains another class: " + out.H2OCLASS);
    huc(out.HUC_12);
    return out;
  }).sort((a, b) => a.OBJECTID - b.OBJECTID);
}

export function csv(rows, fields) {
  const cell = value => {
    if (value === null || value === undefined) return "";
    const s = String(value);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return fields.join(",") + "\n" +
    rows.map(row => fields.map(field => cell(row[field])).join(",")).join("\n") + "\n";
}

export function buildContext(domain, nrcsSource, classifiedSource, options = {}) {
  const ids = domainHucs(domain, options.hucField);
  const wanted = new Set(ids);
  const priorities = priorityRows(nrcsSource);
  const reaches = classifiedRows(classifiedSource);
  const byHuc = new Map();
  for (const row of priorities) {
    if (!byHuc.has(row.huc12_code)) byHuc.set(row.huc12_code, []);
    byHuc.get(row.huc12_code).push(row);
  }
  const groups = new Map();
  const classes = {};
  for (const row of reaches) {
    const key = row.HUC_12 + "/" + row.H2OCLASS;
    if (!groups.has(key)) groups.set(key, {
      publisher_huc12: row.HUC_12, class_code: row.H2OCLASS, feature_count: 0, named_feature_count: 0
    });
    const group = groups.get(key);
    group.feature_count += 1;
    group.named_feature_count += String(row.HYDNAME ?? "").trim() ? 1 : 0;
    classes[row.H2OCLASS] = (classes[row.H2OCLASS] || 0) + 1;
  }
  const hucs = ids.map(id => {
    const stateRows = byHuc.get(id) || [];
    return {
      huc12: id,
      nrcs_coverage: stateRows.length ? "matched_source_rows" : "not_covered",
      nrcs_edition: "FY26",
      nrcs_state_rows: stateRows,
      nrcs_priority_states: stateRows.filter(row => row.fy26_status === "High Priority Area")
        .map(row => row.st_usps)
    };
  });
  return {
    schema: "upstate.water-context/v1",
    title: options.title || "Upper Savannah source-water context",
    source_reference: options.sourceReference || null,
    model_domain_huc12s: ids,
    model_domain_huc_count: ids.length,
    nrcs_inventory: {
      edition: "FY26", state_huc_rows: priorities.length,
      unique_source_hucs: byHuc.size,
      matched_state_huc_rows: priorities.filter(row => wanted.has(row.huc12_code)).length,
      missing_domain_hucs: hucs.filter(row => !row.nrcs_state_rows.length).map(row => row.huc12),
      outside_domain_state_huc_rows: priorities.filter(row => !wanted.has(row.huc12_code)).length
    },
    hucs,
    classified_source_inventory: {
      feature_count: reaches.length,
      unique_source_hucs: new Set(reaches.map(row => row.HUC_12)).size,
      class_counts: classes,
      source_huc_class_counts: [...groups.values()].sort((a, b) =>
        a.publisher_huc12.localeCompare(b.publisher_huc12) || a.class_code.localeCompare(b.class_code)),
      assignment: "Original source HUC attributes; bind current model membership by spatial intersection.",
      geometry_role: "Classified stream reaches",
      source_crs: "EPSG:3857"
    },
    interpretation: {
      nrcs_status: "Keep state rows, system type and resource concern together; a missing row differs from Not Selected.",
      nrcs_area: "st_ac is the state portion; huc12_ac describes the whole HUC and repeats on cross-state rows.",
      designation: "A mapped classified reach identifies receiving water; identify its contributing land with the native hydrologic network.",
      length: "Shape_Length is publisher Web Mercator length; calculate analytical ground length in the selected study CRS."
    }
  };
}
