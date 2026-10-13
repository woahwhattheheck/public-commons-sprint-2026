/** Read the retained native attributes for the classified-water inventory.
 * This module is filesystem-independent; the CLI verifies the original byte identities.
 */
import {csv} from "./high_quality_water_inventory.mjs";

export const INVENTORY_NATIVE_FIELDS = [
  "OBJECTID", "HYDNAME", "Cnty_Name", "HYDTYPE", "H2OCLASS", "HUC_12"
];

export function canonicalJson(value) {
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  if (value !== null && typeof value === "object")
    return "{" + Object.keys(value).sort().map(key =>
      JSON.stringify(key) + ":" + canonicalJson(value[key])).join(",") + "}";
  if (typeof value === "number" && !Number.isFinite(value))
    throw new Error("Source metadata contains a non-finite number");
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("Source metadata contains a non-JSON value");
  return encoded;
}

export function nativeInventoryInput(collection, metadata, layer, selection) {
  if (!collection || !Array.isArray(collection.features))
    throw new Error("The retained native collection needs a complete features array");
  if (collection.exceededTransferLimit)
    throw new Error("The retained native collection reports a transfer limit");
  if (selection.schema !== "upstate.retained-classified-water-selection/v1")
    throw new Error("Use the source selection retained by adoption");
  if (layer.upstream_source_id !== selection.source_id || layer.url !== selection.layer_url)
    throw new Error("The native capture and retained selection identify different source editions");
  const fields = metadata.fields;
  if (!Array.isArray(fields)) throw new Error("Retain the original layer field metadata");
  const oids = fields.filter(field => field.type === "esriFieldTypeOID");
  if (oids.length !== 1 || oids[0].name !== layer.oid_field ||
      oids[0].name !== selection.oid_field)
    throw new Error("The actual metadata-declared OID differs from the captured identity");
  if (oids[0].name !== "OBJECTID")
    throw new Error("This inventory binds the SCHydroClass native OBJECTID field");
  if (collection.objectIdFieldName !== layer.oid_field)
    throw new Error("The assembled native collection declares another OID field");
  if (collection.geometryType !== layer.geometry_type ||
      metadata.geometryType !== layer.geometry_type)
    throw new Error("The source collection and layer have different geometry types");
  const fieldMap = new Map(fields.map(field => [field.name, field.type]));
  for (const name of INVENTORY_NATIVE_FIELDS) {
    if (!fieldMap.has(name)) throw new Error("Original field metadata lacks " + name);
    const expected = name === "OBJECTID" ? "esriFieldTypeOID" : "esriFieldTypeString";
    if (fieldMap.get(name) !== expected)
      throw new Error("Original native inventory field type differs: " + name);
  }
  const collectionFields = new Map((collection.fields || []).map(field => [field.name, field.type]));
  for (const name of INVENTORY_NATIVE_FIELDS)
    if (collectionFields.get(name) !== fieldMap.get(name))
      throw new Error("Native collection field schema differs: " + name);
  if (collection.features.length !== layer.feature_count ||
      collection.features.length !== selection.expected_feature_count)
    throw new Error("Native feature count differs from the captured selection");
  const nulls = Object.fromEntries(INVENTORY_NATIVE_FIELDS.map(name => [name, 0]));
  const seen = new Set(), rows = [];
  for (const feature of collection.features) {
    const attributes = feature?.attributes;
    if (!attributes || typeof attributes !== "object" || Array.isArray(attributes))
      throw new Error("Original native feature lacks its attribute object");
    const oid = attributes.OBJECTID;
    if (!Number.isSafeInteger(oid) || oid < 0 || seen.has(oid))
      throw new Error("The original OBJECTID must be a unique safe integer");
    seen.add(oid);
    const projected = {};
    for (const name of INVENTORY_NATIVE_FIELDS) {
      if (!Object.hasOwn(attributes, name))
        throw new Error("Original native feature omits inventory field " + name);
      const value = attributes[name];
      if (value === null) nulls[name]++;
      if (name !== "OBJECTID" && value !== null && typeof value !== "string")
        throw new Error("Original inventory attribute has an unexpected type: " + name);
      if ((name === "H2OCLASS" || name === "HUC_12") && value === null)
        throw new Error("The original class and publisher HUC must be present");
      projected[name] = value;
    }
    rows.push(projected);
  }
  return {
    csvText: csv(rows, INVENTORY_NATIVE_FIELDS),
    representation: {
      kind: "native-esri-attribute-projection",
      native_oid_field: layer.oid_field,
      source_feature_count: rows.length,
      projected_fields: [...INVENTORY_NATIVE_FIELDS],
      null_source_values: nulls,
      blank_interpretation: "Null text attributes use the existing blank-field inventory semantics; original typed attributes remain in the retained native collection.",
      geometry_transform: "None; the inventory reads attributes only."
    }
  };
}
