#!/usr/bin/env node
/** Rebuild exact-source gauge/basin context; Node standard library only. */
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import {fileURLToPath} from "node:url";

const hash = body => crypto.createHash("sha256").update(body).digest("hex");
const csvCell = value => { const text = value == null ? "" : String(value); return /[",\r\n]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text; };
const csv = (columns, rows) => [columns.join(","), ...rows.map(row => columns.map(key => csvCell(row[key])).join(","))].join("\n") + "\n";
function geometryStats(geometry) {
  if (!geometry || !["Polygon", "MultiPolygon"].includes(geometry.type)) throw Error("Expected original basin Polygon/MultiPolygon");
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  let rings = 0, vertices = 0;
  const bounds = [Infinity, Infinity, -Infinity, -Infinity];
  for (const polygon of polygons) {
    if (!Array.isArray(polygon) || !polygon.length) throw Error("Empty original polygon");
    for (const ring of polygon) {
      if (!Array.isArray(ring) || ring.length < 4) throw Error("Invalid original ring");
      if (JSON.stringify(ring[0]) !== JSON.stringify(ring.at(-1))) throw Error("Unclosed original ring");
      rings++;
      for (const point of ring) {
        if (point.length < 2 || !point.every(Number.isFinite)) throw Error("Invalid original coordinate");
        if (point[0] < -180 || point[0] > 180 || point[1] < -90 || point[1] > 90) throw Error("Invalid GeoJSON longitude/latitude");
        vertices++;
        bounds[0] = Math.min(bounds[0], point[0]); bounds[1] = Math.min(bounds[1], point[1]);
        bounds[2] = Math.max(bounds[2], point[0]); bounds[3] = Math.max(bounds[3], point[1]);
      }
    }
  }
  return {geometry_type: geometry.type, polygon_count: polygons.length, ring_count: rings, vertex_count: vertices, west: bounds[0], south: bounds[1], east: bounds[2], north: bounds[3]};
}
export function derive(manifest, originals) {
  if (manifest.schema !== "upstate.gauge-basin-originals/v1" || manifest.stations.length !== 13) throw Error("Choose the original thirteen-station source edition");
  const stations = [], catchments = [], bindings = [], seen = new Set();
  for (const station of manifest.stations) {
    const site = station.site_no;
    if (!/^\d{8,15}$/.test(site) || seen.has(site)) throw Error("Invalid or repeated source station");
    seen.add(site);
    const featureSource = manifest.originals.find(row => row.site_no === site && row.role === "Feature");
    const basinSource = manifest.originals.find(row => row.site_no === site && row.role === "BasinWhole");
    if (!featureSource || !basinSource || !originals[featureSource.path] || !originals[basinSource.path]) throw Error("Missing original feature/basin for " + site);
    const featureDocument = JSON.parse(originals[featureSource.path]);
    const basinDocument = JSON.parse(originals[basinSource.path]);
    if (featureDocument.type !== "FeatureCollection" || featureDocument.features?.length !== 1 ||
        basinDocument.type !== "FeatureCollection" || basinDocument.features?.length !== 1) throw Error("Unexpected original feature count");
    const feature = featureDocument.features[0], basin = basinDocument.features[0];
    if (feature.geometry?.type !== "Point" || feature.properties?.identifier !== "USGS-" + site || feature.id !== "USGS-" + site) throw Error("Original station identity mismatch");
    if (!Number.isInteger(feature.properties.comid) || !Number.isFinite(feature.properties.measure)) throw Error("Missing original linear reference");
    if (basinSource.request_parameters.simplified !== false || basinSource.request_parameters.splitCatchment !== false) throw Error("Whole-catchment source flags changed");
    const stats = geometryStats(basin.geometry), id = "nldi-nwissite-USGS-" + site + "-whole";
    const properties = {
      basin_id: id, station_id: "USGS-" + site, site_no: site, ts_id: station.ts_id,
      station_name: feature.properties.name, comid: feature.properties.comid,
      reachcode: feature.properties.reachcode, measure: feature.properties.measure,
      mainstem: feature.properties.mainstem, nwis_huc8: station.nwis.huc_cd,
      nwis_drainage_area_sq_mi: station.nwis.drain_area_va,
      support_kind: "nhdplusv2_upstream_whole_catchments",
      query_simplified: false, query_split_catchment: false,
      feature_original_path: featureSource.path, feature_original_sha256: featureSource.sha256,
      basin_original_path: basinSource.path, basin_original_sha256: basinSource.sha256,
      feature_uri: featureSource.uri, basin_uri: basinSource.uri,
      ...stats
    };
    stations.push({type: "Feature", id: "USGS-" + site, geometry: feature.geometry,
      properties: {...feature.properties, ...properties,
        nwis_decimal_latitude: station.nwis.dec_lat_va,
        nwis_decimal_longitude: station.nwis.dec_long_va,
        nwis_decimal_datum: station.nwis.dec_coord_datum_cd}});
    catchments.push({type: "Feature", id, geometry: basin.geometry, properties});
    bindings.push({...properties,
      nldi_longitude: feature.geometry.coordinates[0], nldi_latitude: feature.geometry.coordinates[1],
      nwis_decimal_latitude: station.nwis.dec_lat_va, nwis_decimal_longitude: station.nwis.dec_long_va,
      nwis_decimal_datum: station.nwis.dec_coord_datum_cd,
      source_start_date: station.begin_date, source_end_date: station.end_date,
      daily_parameter: station.parm_cd, daily_statistic: station.stat_cd});
  }
  const columns = ["basin_id","station_id","site_no","ts_id","station_name","nwis_huc8",
    "comid","reachcode","measure","mainstem","nldi_longitude","nldi_latitude",
    "nwis_decimal_latitude","nwis_decimal_longitude","nwis_decimal_datum","nwis_drainage_area_sq_mi",
    "source_start_date","source_end_date","daily_parameter","daily_statistic","support_kind",
    "query_simplified","query_split_catchment","geometry_type","polygon_count","ring_count","vertex_count",
    "west","south","east","north","feature_original_path","feature_original_sha256","basin_original_path",
    "basin_original_sha256","feature_uri","basin_uri"];
  return {
    "stations.geojson": JSON.stringify({type: "FeatureCollection", name: "Original daily-flow gauge locations", features: stations}) + "\n",
    "upstream-whole-catchments.geojson": JSON.stringify({type: "FeatureCollection", name: "Original full NLDI upstream whole-catchment support", features: catchments}) + "\n",
    "station-basin-bindings.csv": csv(columns, bindings),
    "station-basin-bindings.json": JSON.stringify({schema: "upstate.station-basin-bindings/v1",
      source_edition: manifest.edition, support_kind: "nhdplusv2_upstream_whole_catchments",
      daily_source_ref: manifest.daily_source_ref, original_domain: manifest.original_domain,
      stations: bindings}, null, 2) + "\n"
  };
}
async function main() {
  const [sourceArg, outputArg] = process.argv.slice(2);
  if (!sourceArg || !outputArg) throw Error("Usage: node derive-basins.mjs SOURCE_DIRECTORY OUTPUT_DIRECTORY");
  const root = path.resolve(sourceArg), output = path.resolve(outputArg);
  const manifest = JSON.parse(await fs.readFile(path.join(root, "capture-manifest.json"), "utf8"));
  const originals = {};
  for (const row of manifest.originals) {
    if (!row.path || path.isAbsolute(row.path) || row.path.split("/").some(part => !part || part === ".." || part === ".")) throw Error("Invalid original source member");
    const body = await fs.readFile(path.join(root, row.path));
    if (body.length !== row.bytes || hash(body) !== row.sha256) throw Error("Original bytes differ: " + row.path);
    originals[row.path] = body.toString("utf8");
  }
  const outputs = derive(manifest, originals);
  await fs.mkdir(output, {recursive: true});
  for (const [name, text] of Object.entries(outputs)) {
    const target = path.join(output, name);
    try {
      const existing = await fs.readFile(target, "utf8");
      if (existing !== text) throw Error("Refusing to replace a different derived source edition: " + target);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await fs.writeFile(target, text, {flag: "wx"});
    }
  }
  process.stdout.write(JSON.stringify({stations: manifest.stations.length, originals: manifest.originals.length,
    outputs: Object.fromEntries(Object.entries(outputs).map(([name, text]) => [name, {bytes: Buffer.byteLength(text), sha256: hash(text)}]))}, null, 2) + "\n");
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => {console.error(error.message);process.exitCode = 1;});
