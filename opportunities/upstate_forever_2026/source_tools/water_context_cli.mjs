#!/usr/bin/env node
/**
 * Build a native-importable source bundle from the retained source responses.
 * Usage: node source_tools/water_context_cli.mjs --domain DOMAIN.json[.gz]
 *   --nrcs NRCS.json --classified SCDES.esri.json --out OUTPUT_DIRECTORY
 */
import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import { resolve, join, basename } from "node:path";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { buildContext, priorityRows, classifiedRows, csv, PRIORITY_FIELDS, CLASS_FIELDS } from "./water_context.mjs";

const args = process.argv.slice(2);
const help = "node source_tools/water_context_cli.mjs --domain DOMAIN.json[.gz] --nrcs NRCS.json --classified SCDES.esri.json --out OUTPUT_DIRECTORY [--huc-field FIELD] [--title TITLE]";
if (!args.length || args.includes("--help")) {
  console.log(help);
  process.exit(args.length ? 0 : 2);
}
const known = new Set(["--domain", "--nrcs", "--classified", "--out", "--huc-field", "--title"]);
const flags = {};
for (let i = 0; i < args.length; i += 2) {
  if (!known.has(args[i]) || args[i + 1] === undefined || args[i + 1].startsWith("--"))
    throw new Error("Expected a named option and value. " + help);
  if (flags[args[i]] !== undefined) throw new Error("Duplicate option " + args[i]);
  flags[args[i]] = args[i + 1];
}
for (const key of ["--domain", "--nrcs", "--classified", "--out"])
  if (!flags[key]) throw new Error("Missing " + key + ". " + help);

const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const load = async path => {
  const stored = await readFile(resolve(path));
  const body = stored[0] === 0x1f && stored[1] === 0x8b ? gunzipSync(stored) : stored;
  const value = JSON.parse(body.toString("utf8").replace(/^\uFEFF/, ""));
  return { stored, body, value, basename: basename(path), sha256: hash(body) };
};
const [domain, nrcs, classified] = await Promise.all([
  load(flags["--domain"]), load(flags["--nrcs"]), load(flags["--classified"])
]);
if (classified.value.geometryType !== "esriGeometryPolyline" ||
    !classified.value.features?.every(row => row.geometry?.paths?.length))
  throw new Error("Receive the original SCDES Esri polyline geometry response as --classified.");
const sr = classified.value.spatialReference;
if (![sr?.wkid, sr?.latestWkid].some(value => [3857, 102100].includes(value)))
  throw new Error("The retained SCDES source should declare EPSG:3857 / Esri 102100.");
const context = buildContext(domain.value, nrcs.value, classified.value, {
  hucField: flags["--huc-field"], title: flags["--title"],
  sourceReference: "domain-sha256:" + domain.sha256
});
context.prepared_at = new Date().toISOString();
context.source_bodies = {
  model_domain: { filename: domain.basename, decoded_sha256: domain.sha256 },
  nrcs: { sha256: nrcs.sha256, bytes: nrcs.body.length },
  scdes: { sha256: classified.sha256, bytes: classified.body.length }
};
const output = resolve(flags["--out"]);
await mkdir(join(output, "raw"), { recursive: true });
const inventory = [];
const save = async (path, value, type = "application/json") => {
  const body = Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8");
  const target = join(output, path);
  const temporary = target + ".writing-" + process.pid;
  await writeFile(temporary, body);
  await rename(temporary, target);
  const record = { path, bytes: body.length, sha256: hash(body), media_type: type };
  inventory.push(record);
  return record;
};
const rawNrcs = await save("raw/nrcs-fy26.json", nrcs.body);
const rawScdes = await save("raw/scdes-classified-streams.esri.json", classified.body);
const selectedPriorityRows = priorityRows(nrcs.value).filter(row => context.model_domain_huc12s.includes(row.huc12_code));
const priorityTable = await save("nrcs-priorities-by-state.csv",
  csv(selectedPriorityRows, PRIORITY_FIELDS), "text/csv");
const reachTable = await save("classified-reaches.csv",
  csv(classifiedRows(classified.value), CLASS_FIELDS), "text/csv");
const domainIds = await save("domain-huc12s.json", JSON.stringify(context.model_domain_huc12s, null, 2) + "\n");
const contextFile = await save("water-context.json", JSON.stringify(context, null, 2) + "\n");
const priorityUrl = "https://services.arcgis.com/SXbDpmb7xQkk44JV/ArcGIS/rest/services/Source_Water_Protection_Resource_Concern_FY26/FeatureServer/7";
const classUrl = "https://gis.des.sc.gov/gisserver/rest/services/water/SCHydroClass/MapServer/2";
const sources = {
  schema: "upstate.sources/v1",
  title: "Upper Savannah source-water priorities and classified reaches",
  captured_at: "2026-10-12",
  scope: "Original source inventory joined to the supplied retained HUC12 selection; stream geometry is retained for spatial assignment.",
  notes: [
    "NRCS edition FY26; statuses, source system and resource concern retain state-specific rows.",
    "SCDES mapped classification is provisional; the adopted R.61-69 table provides named reach descriptions.",
    "Source HUC attributes and model WBD HUC editions remain explicit; use actual stream geometry for model-domain clipping.",
    "Original state geometry is retained. The model's chosen analytical CRS controls ground-length calculations."
  ],
  entries: [
    {
      id: "nrcs-source-water-fy26-upper-savannah-20261012",
      title: "NRCS FY26 source-water priority attributes",
      kind: "table", role: "SOURCE_WATER_PRIORITY_CONTEXT",
      ...priorityTable, uri: priorityUrl, vintage: "FY26",
      source_format: "CSV",
      rows: selectedPriorityRows.length,
      original_source_rows: priorityRows(nrcs.value).length,
      units: "Categorical priority, system and concern; area fields in acres",
      companions: [rawNrcs, domainIds]
    },
    {
      id: "scdes-classified-streams-upper-savannah-20261012",
      title: "SCDES classified stream reaches — Upper Savannah source capture",
      kind: "vector", role: "HIGH_QUALITY_WATERS",
      ...rawScdes, uri: classUrl,
      vintage: "Public GIS capture 2026-10-12; publisher dataset edition not stated",
      source_format: "Esri JSON", source_crs: "EPSG:3857",
      observed_at: "2026-10-12", features: classified.value.features.length,
      classification_field: "H2OCLASS", publisher_huc_field: "HUC_12",
      object_id_field: "OBJECTID", mapped_classification_status: "provisional",
      regulatory_reference: "https://des.sc.gov/sites/des/files/Library/Regulations/R.61-69.pdf",
      companions: [reachTable]
    },
    {
      id: "upper-savannah-water-context-" + domain.sha256.slice(0, 12),
      title: "Water source context for the retained HUC selection",
      kind: "document", role: "SOURCE_WATER_CONTEXT",
      ...contextFile, uri: priorityUrl,
      vintage: "Prepared from sources captured 2026-10-12",
      companions: [domainIds]
    }
  ]
};
await save("sources.json", JSON.stringify(sources, null, 2) + "\n");
const fileManifest = {
  schema: "upstate.source-file-manifest/v1",
  native_import_manifest: "sources.json",
  files: inventory.map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 }))
};
await writeFile(join(output, "source-file-manifest.json"), JSON.stringify(fileManifest, null, 2) + "\n", "utf8");
console.log(JSON.stringify({
  output, native_import_manifest: join(output, "sources.json"),
  model_domain_huc_count: context.model_domain_huc_count,
  matched_priority_state_rows: context.nrcs_inventory.matched_state_huc_rows,
  missing_priority_hucs: context.nrcs_inventory.missing_domain_hucs,
  retained_classified_features: context.classified_source_inventory.feature_count
}, null, 2));
