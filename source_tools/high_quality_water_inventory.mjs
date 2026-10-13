/** Native classified-linework inventory for retained Upper Savannah source.
 * Joins are literal source-review predicates, never legal geometry bindings.
 */
export const FEATURE_INDEX_FIELDS = [
  "object_id", "hydro_type_raw", "class_raw", "publisher_huc12",
  "name_blank", "county_blank", "literal_join_status", "literal_registry_record_ids"
];

export function parseCsv(text) {
  text = text.replace(/^\uFEFF/, "");
  const table = [];
  let row = [], value = "", quoted = false, closedQuote = false;
  const finishCell = () => { row.push(value); value = ""; closedQuote = false; };
  const finishRow = () => { finishCell(); table.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const character = text[i];
    if (quoted) {
      if (character === '"') {
        if (text[i + 1] === '"') { value += '"'; i++; }
        else { quoted = false; closedQuote = true; }
      } else value += character;
      continue;
    }
    if (closedQuote && ![",", "\r", "\n"].includes(character))
      throw new Error("Characters after a closed CSV quote");
    if (character === '"') {
      if (value !== "") throw new Error("Quote inside an unquoted CSV field");
      quoted = true;
    } else if (character === ",") finishCell();
    else if (character === "\n") finishRow();
    else if (character === "\r") {
      if (text[i + 1] === "\n") i++;
      finishRow();
    } else value += character;
  }
  if (quoted) throw new Error("Unterminated quoted CSV field");
  if (value !== "" || row.length || closedQuote) finishRow();
  const header = table.shift();
  if (!header?.length || new Set(header).size !== header.length)
    throw new Error("Missing or repeated CSV column names");
  return table.filter(row => row.some(value => value !== "")).map((row, index) => {
    if (row.length !== header.length) throw new Error("Wrong CSV column count on row " + (index + 2));
    return Object.fromEntries(header.map((name, column) => [name, row[column]]));
  });
}

export function csv(rows, fields) {
  const cell = value => {
    const text = Array.isArray(value) ? value.join("|") : String(value ?? "");
    return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  };
  return [fields.join(","), ...rows.map(row => fields.map(name => cell(row[name])).join(","))].join("\n") + "\n";
}

const normalized = value => String(value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
const count = (target, key) => { target[key] = (target[key] || 0) + 1; };
const sortedCounts = value => Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b, "en")));

export function buildInventory(csvText, registry, mapping, selection, inputs = {}) {
  if (selection.schema !== "upstate.retained-classified-water-selection/v1")
    throw new Error("Expected the retained native selection specification");
  if (mapping.schema !== "upstate.classified-water-bindings/v1")
    throw new Error("Expected the native field mapping");
  const entries = Object.entries(mapping.layers);
  if (entries.length !== 1) throw new Error("Select one retained source layer");
  const [layerId, binding] = entries[0];
  if (binding.catalogue_source_id !== selection.source_id)
    throw new Error("Mapping and native selection identify different sources");
  if (!Array.isArray(registry.records)) throw new Error("Expected retained legal registry records");
  const byName = new Map(), countyCodes = new Map();
  for (const [name, code] of Object.entries(binding.county_values ?? {}))
    countyCodes.set(normalized(name), Array.isArray(code) ? code : [code]);
  for (const record of registry.records) {
    const name = normalized(record.waterbody_name);
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(record);
  }
  const sourceRows = parseCsv(csvText);
  const nativeIds = new Set(), literalNames = new Set(), publisherHucs = new Set();
  const classCounts = {}, typeCounts = {}, joinCounts = {}, typeClass = new Map(), hucClass = new Map();
  const classBlanks = {}, coveredRecords = new Set(), literalRecords = new Set();
  const featureIndex = [], reviewGroups = new Map();
  let blankNames = 0, blankCounties = 0;
  for (const row of sourceRows) {
    if (!/^\d+$/.test(row.OBJECTID) || !Number.isSafeInteger(Number(row.OBJECTID)))
      throw new Error("The actual OBJECTID must be a safe native integer");
    const objectId = String(Number(row.OBJECTID));
    if (nativeIds.has(objectId)) throw new Error("Repeated native OBJECTID " + objectId);
    nativeIds.add(objectId);
    if (typeof row.HYDNAME !== "string" || typeof row.Cnty_Name !== "string" || typeof row.HYDTYPE !== "string")
      throw new Error("Missing original name/county/hydro-type fields");
    if (!selection.included_class_codes.includes(row.H2OCLASS))
      throw new Error("Native class lies outside this capture selection");
    if (!/^\d{12}$/.test(row.HUC_12) || !selection.included_huc_prefixes.some(prefix => row.HUC_12.startsWith(prefix)))
      throw new Error("Native publisher HUC lies outside this capture selection");
    const name = normalized(row.HYDNAME), county = normalized(row.Cnty_Name);
    const legalNameRows = name ? byName.get(name) ?? [] : [];
    const legalClassRows = legalNameRows.filter(record => record.class_code === row.H2OCLASS);
    const nativeCounties = countyCodes.get(county) ?? [];
    const legalCountyRows = legalClassRows.filter(record =>
      record.county_codes.some(code => nativeCounties.includes(code)));
    const status = !name ? "blank_native_name" :
      !legalNameRows.length ? "no_literal_registry_name" :
      !legalClassRows.length ? "literal_name_different_class" :
      legalCountyRows.length ? "literal_name_class_county" :
      !county ? "literal_name_class_blank_county" :
      "literal_name_class_different_county";
    const nameBlank = name === "", countyBlank = county === "";
    if (nameBlank) blankNames++; else literalNames.add(name);
    if (countyBlank) blankCounties++;
    publisherHucs.add(row.HUC_12);
    count(classCounts, row.H2OCLASS); count(typeCounts, row.HYDTYPE); count(joinCounts, status);
    const classBlank = classBlanks[row.H2OCLASS] ??= {feature_count: 0, blank_name_count: 0, blank_county_count: 0};
    classBlank.feature_count++; classBlank.blank_name_count += Number(nameBlank); classBlank.blank_county_count += Number(countyBlank);
    for (const [table, key, keys] of [
      [typeClass, JSON.stringify([row.HYDTYPE, row.H2OCLASS]), {hydro_type_raw: row.HYDTYPE, class_raw: row.H2OCLASS}],
      [hucClass, JSON.stringify([row.HUC_12, row.H2OCLASS]), {publisher_huc12: row.HUC_12, class_raw: row.H2OCLASS}]
    ]) {
      const group = table.get(key) ?? {...keys, feature_count: 0, blank_name_count: 0, blank_county_count: 0};
      group.feature_count++; group.blank_name_count += Number(nameBlank); group.blank_county_count += Number(countyBlank);
      table.set(key, group);
    }
    legalNameRows.forEach(record => literalRecords.add(record.id));
    legalCountyRows.forEach(record => coveredRecords.add(record.id));
    featureIndex.push({
      object_id: objectId, hydro_type_raw: row.HYDTYPE, class_raw: row.H2OCLASS,
      publisher_huc12: row.HUC_12, name_blank: nameBlank, county_blank: countyBlank,
      literal_join_status: status, literal_registry_record_ids: legalNameRows.map(record => record.id).sort()
    });
    if (["literal_name_different_class", "literal_name_class_different_county"].includes(status)) {
      const key = JSON.stringify([row.HYDNAME, row.H2OCLASS, row.Cnty_Name, status]);
      const group = reviewGroups.get(key) ?? {
        waterbody_name_raw: row.HYDNAME, class_raw: row.H2OCLASS, county_raw: row.Cnty_Name,
        literal_join_status: status, object_ids: [],
        literal_registry_record_ids: legalNameRows.map(record => record.id).sort()
      };
      group.object_ids.push(objectId); reviewGroups.set(key, group);
    }
  }
  if (sourceRows.length !== selection.expected_feature_count)
    throw new Error("Native source count differs from the selected source edition");
  for (const key of new Set([...Object.keys(classCounts), ...Object.keys(selection.expected_class_counts)]))
    if ((classCounts[key] ?? 0) !== (selection.expected_class_counts[key] ?? 0))
      throw new Error("Native source class counts differ from the selected source edition");
  if (publisherHucs.size !== selection.expected_publisher_huc_count)
    throw new Error("Publisher HUC count differs from the selected source edition");
  featureIndex.sort((a, b) => Number(a.object_id) - Number(b.object_id));
  const profile = {
    schema: "upstate.classified-water-inventory/v1",
    source_id: selection.source_id, layer_id: layerId, source_uri: selection.layer_url,
    source_capture_date: selection.original_capture_date, data_status: binding.data_status,
    legal_edition_status: binding.status, inputs,
    source_selection: {
      where: selection.selection_where, class_codes: selection.included_class_codes,
      publisher_huc_prefixes: selection.included_huc_prefixes,
      scope_note: selection.source_scope_note
    },
    identity: {native_oid_field: "OBJECTID", native_oid_type: "esriFieldTypeOID", oid_alias: "OBJECTID_1",
      separate_nullable_attribute: "OBJECTID_1", source_identity: "Exact source layer URL plus original OBJECTID"},
    feature_count: sourceRows.length, distinct_native_id_count: nativeIds.size,
    publisher_huc_count: publisherHucs.size, nonblank_literal_name_count: literalNames.size,
    blank_name_count: blankNames, blank_county_count: blankCounties,
    class_counts: sortedCounts(classCounts), hydro_type_counts: sortedCounts(typeCounts),
    class_identifier_coverage: classBlanks,
    hydro_type_class_counts: [...typeClass.values()].sort((a, b) =>
      a.hydro_type_raw.localeCompare(b.hydro_type_raw, "en") || a.class_raw.localeCompare(b.class_raw, "en")),
    publisher_huc_class_counts: [...hucClass.values()].sort((a, b) =>
      a.publisher_huc12.localeCompare(b.publisher_huc12, "en") || a.class_raw.localeCompare(b.class_raw, "en")),
    literal_join_counts: sortedCounts(joinCounts),
    selected_registry_record_count: registry.records.length,
    literal_name_registry_record_count: literalRecords.size,
    literal_name_class_county_registry_record_count: coveredRecords.size,
    name_or_county_review_groups: [...reviewGroups.values()],
    index_columns: FEATURE_INDEX_FIELDS,
    metric_labels: {
      feature_count: "Native classified source features",
      line_length: "Classified source linework",
      nonblank_literal_name_count: "Distinct nonblank source names",
      publisher_huc_count: "Publisher HUC12 codes in captured source"
    },
    interpretation: [
      "HYDTYPE values are retained exactly; linework includes banks, shorelines, closure lines and structures as well as stream lines.",
      "Separate banks and shorelines cannot be summarized as stream centerline length; a lake shoreline does not provide lake area.",
      "Source Shape_Length is a Web Mercator source attribute. Native spatial analysis calculates suitable projected lengths separately.",
      "A blank name or county does not remove positively classified source geometry.",
      "Literal registry predicates normalize Unicode, case and whitespace only; they do not infer aliases, receiving waters or legal extent.",
      "literal_registry_record_ids includes all selected legal rows with the same literal normalized name, before class and county comparison.",
      "The selected registry is a scoped 105-row legal source. Absence from it is not a finding that a source water is legally unlisted.",
      "Literal class or county differences are source-review context, not declarations that either source is erroneous.",
      "All source objects remain provisional; explicit legal geometry bindings and the spatial crosswalk retain their separate roles.",
      "Publisher HUC_12 values remain source attributes. Retained native WBD intersection determines current model HUC membership."
    ]
  };
  return {profile, featureIndex, featureIndexCsv: csv(featureIndex, FEATURE_INDEX_FIELDS)};
}
