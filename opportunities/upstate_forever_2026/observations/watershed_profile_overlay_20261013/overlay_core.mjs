/** Preserve original watershed coordinates while joining scalar profile fields. */
import {parseCsv} from "../landcover_observation_profiles_20261013/profiles_core.mjs";

export function buildOverlay(original, profilesText) {
  if (original.geometryType !== "esriGeometryPolygon" ||
      (original.spatialReference?.latestWkid ?? original.spatialReference?.wkid) !== 3857)
    throw Error("Select the retained original EPSG:3857 watershed FeatureSet");
  const parsed = parseCsv(profilesText);
  const byId = new Map();
  for (const row of parsed.rows) {
    if (!/^\d{12}$/.test(row.huc12) || byId.has(row.huc12))
      throw Error("Profile HUC12 identifiers must be unique original strings");
    byId.set(row.huc12, row);
  }
  if (byId.size !== original.features.length || byId.size !== 217)
    throw Error("The complete 217 original profile rows and polygons are required");
  const numeric = new Set(parsed.columns.filter(name =>
    name.endsWith("_ha") || name.endsWith("_cells") ||
    name.endsWith("_count") || name.endsWith("_percent")));
  const used = new Set();
  let vertexCount = 0;
  const features = original.features.map(feature => {
    const id = feature.attributes.huc12, profile = byId.get(id);
    if (!profile || used.has(id)) throw Error("Missing or repeated original HUC12 " + id);
    used.add(id);
    const rings = feature.geometry?.rings;
    if (!Array.isArray(rings) || rings.length !== 1 || rings[0].length < 4 ||
        JSON.stringify(rings[0][0]) !== JSON.stringify(rings[0].at(-1)))
      throw Error("This original edition requires one complete closed ring per HUC12");
    for (const point of rings[0])
      if (point.length !== 2 || !point.every(Number.isFinite))
        throw Error("Original projected vertex is invalid");
    vertexCount += rings[0].length;
    const properties = {
      native_objectid: String(feature.attributes.objectid),
      huc12: id, tohuc: String(feature.attributes.tohuc),
      original_source_id: "upstate-wbd-upstream-domain-20261012"
    };
    for (const [name, value] of Object.entries(profile)) {
      if (numeric.has(name)) {
        const number = Number(value);
        if (value === "" || !Number.isFinite(number))
          throw Error("Profile numerical field is invalid: " + name);
        properties[name] = number;
      } else properties[name] = value;
    }
    return {type:"Feature", id, properties,
      geometry:{type:"Polygon", coordinates:rings}};
  });
  return {
    geojson: {
      type:"FeatureCollection",
      name:"Upper Savannah original watershed land-cover and observation profiles",
      crs:{type:"name", properties:{name:"urn:ogc:def:crs:EPSG::3857"}},
      features
    },
    feature_count: features.length,
    vertex_count: vertexCount,
    numeric_fields: [...numeric].sort()
  };
}
