#!/usr/bin/env node
import {createHash, randomUUID} from "node:crypto";
import {mkdir, readFile, open, link, unlink} from "node:fs/promises";
import {resolve, dirname, basename, join, relative, isAbsolute, sep} from "node:path";
import {gunzipSync} from "node:zlib";
import {buildInventory} from "./high_quality_water_inventory.mjs";
import {canonicalJson, nativeInventoryInput} from "./high_quality_water_inventory_capture.mjs";

const sha = value => createHash("sha256").update(value).digest("hex");
const json = value => Buffer.from(JSON.stringify(value, null, 2) + "\n");
const item = (path, body) => ({path, bytes: body.byteLength, sha256: sha(body)});
const jsonBody = body => JSON.parse(
  (body[0] === 0x1f && body[1] === 0x8b ? gunzipSync(body) : body).toString("utf8")
);

function argumentsFor(argv) {
  const value = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i]?.startsWith("--") || !argv[i + 1] || argv[i + 1].startsWith("--"))
      throw new Error("Supply --capture or --source-csv, --registry, --mapping and --out");
    if (value[argv[i]]) throw new Error("Repeated option " + argv[i]);
    value[argv[i]] = argv[i + 1];
  }
  for (const key of ["--registry", "--mapping", "--out"])
    if (!value[key]) throw new Error("Missing " + key);
  if (Boolean(value["--capture"]) === Boolean(value["--source-csv"]))
    throw new Error("Supply exactly one of --capture and --source-csv");
  if (value["--source-csv"] && !value["--selection"])
    throw new Error("The CSV route requires --selection");
  if (value["--capture"] && value["--expected-csv-sha256"])
    throw new Error("--expected-csv-sha256 applies to the CSV route");
  for (const key of Object.keys(value))
    if (!["--source-csv", "--capture", "--registry", "--mapping", "--selection",
          "--out", "--expected-csv-sha256"].includes(key))
      throw new Error("Unknown option " + key);
  return value;
}

async function exactWrite(path, body) {
  await mkdir(dirname(path), {recursive: true});
  const pending = path + ".pending-" + randomUUID();
  let stream;
  try {
    stream = await open(pending, "wx");
    await stream.writeFile(body);
    await stream.sync();
    await stream.close();
    stream = null;
    try { await link(pending, path); }
    catch (error) {
      if (error.code !== "EEXIST") throw error;
      if (!(await readFile(path)).equals(Buffer.from(body)))
        throw new Error("Existing output describes different input bytes; use a new output directory: " + path);
    }
  } finally {
    if (stream) await stream.close();
    await unlink(pending).catch(error => { if (error.code !== "ENOENT") throw error; });
  }
}

function sourceMember(root, path) {
  if (typeof path !== "string" || !path || isAbsolute(path))
    throw new Error("The capture member must have a relative path");
  const absolute = resolve(root, path), rel = relative(root, absolute);
  if (!rel || rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel))
    throw new Error("The capture member must remain inside its source directory");
  return absolute;
}

function checkedDescriptor(value) {
  if (!value || typeof value.path !== "string" ||
      !/^[0-9a-f]{64}$/.test(value.sha256) ||
      !Number.isSafeInteger(value.bytes) || value.bytes < 0)
    throw new Error("The retained capture member needs its original path, size and SHA256");
  return value;
}

async function nativeCaptureInput(rootPath, mapping, providedSelection) {
  const capturePath = basename(rootPath) === "capture.json" ? resolve(rootPath) :
    resolve(rootPath, "capture.json");
  const root = dirname(capturePath), captureBody = await readFile(capturePath);
  const capture = jsonBody(captureBody);
  if (capture.schema !== "upstate.classified-water-capture/v1" ||
      capture.acquisition_mode !== "retained-source-adoption")
    throw new Error("Use the completed retained classified-water adoption");
  const layerIds = Object.keys(mapping.layers || {});
  if (layerIds.length !== 1) throw new Error("Select one captured native layer in --mapping");
  const candidates = (capture.layers || []).filter(value => value.id === layerIds[0]);
  if (candidates.length !== 1) throw new Error("The selected native layer is absent or duplicated");
  const layer = candidates[0];
  const retained = new Map(), byPath = new Map();
  const captureFile = {body: captureBody, item: item("inputs/native_capture/capture.json", captureBody)};
  retained.set(captureFile.item.path, captureFile);
  if (!Array.isArray(capture.files)) throw new Error("The original capture lacks its member inventory");
  for (const raw of capture.files) {
    const descriptor = checkedDescriptor(raw);
    if (byPath.has(descriptor.path)) throw new Error("The capture repeats a member path");
    const body = await readFile(sourceMember(root, descriptor.path));
    if (body.byteLength !== descriptor.bytes || sha(body) !== descriptor.sha256)
      throw new Error("Original capture member changed: " + descriptor.path);
    const value = {body, item: item("inputs/native_capture/" + descriptor.path, body),
      descriptor};
    byPath.set(descriptor.path, value);
    retained.set(value.item.path, value);
  }
  const required = path => {
    const value = byPath.get(path);
    if (!value) throw new Error("The capture inventory lacks required member " + path);
    return value;
  };
  const features = required(layer.combined_path), metadata = required(layer.metadata_path);
  const nativeBody = features.body[0] === 0x1f && features.body[1] === 0x8b ?
    gunzipSync(features.body) : features.body;
  if (nativeBody.byteLength !== layer.decoded_bytes || sha(nativeBody) !== layer.decoded_sha256)
    throw new Error("The decoded native collection differs from its captured identity");
  const selectedInputs = (layer.adoption?.retained_input_inventory || [])
    .filter(value => value.role === "selection");
  if (selectedInputs.length !== 1) throw new Error("The capture must retain its original selection input");
  const selectionIdentity = selectedInputs[0];
  const selectedFiles = [...byPath.values()].filter(value =>
    value.descriptor.sha256 === selectionIdentity.sha256 &&
    value.descriptor.bytes === selectionIdentity.bytes &&
    basename(value.descriptor.path) === selectionIdentity.filename);
  if (selectedFiles.length !== 1)
    throw new Error("The original capture selection file is absent or ambiguous");
  const selectedFile = selectedFiles[0], selection = jsonBody(selectedFile.body);
  if (canonicalJson(selection) !== canonicalJson(layer.selection))
    throw new Error("The captured selection and its original retained body differ");
  if (providedSelection) {
    const supplied = await readFile(resolve(providedSelection));
    if (!supplied.equals(selectedFile.body))
      throw new Error("Use the identical adopted selection, or omit --selection to read its retained original");
  }
  const result = nativeInventoryInput(
    JSON.parse(nativeBody.toString("utf8")), jsonBody(metadata.body), layer, selection
  );
  return {
    ...result, selection, retained,
    original: {
      native_capture: captureFile, native_features: features,
      native_metadata: metadata, retained_selection: selectedFile
    }
  };
}

async function main() {
  const args = argumentsFor(process.argv.slice(2)), original = {}, retained = new Map();
  for (const [key, option] of [["legal_registry", "--registry"], ["native_mapping", "--mapping"]]) {
    const path = resolve(args[option]), body = await readFile(path);
    const value = {body, item: item("inputs/" + key + "/" + basename(path), body)};
    original[key] = value;
    retained.set(value.item.path, value);
  }
  const mapping = jsonBody(original.native_mapping.body);
  const registry = jsonBody(original.legal_registry.body);
  let selection, csvText, representation = null;
  if (args["--capture"]) {
    const native = await nativeCaptureInput(args["--capture"], mapping, args["--selection"]);
    selection = native.selection;
    csvText = native.csvText;
    representation = native.representation;
    Object.assign(original, native.original);
    for (const [path, value] of native.retained) retained.set(path, value);
  } else {
    for (const [key, option] of [["classified_csv", "--source-csv"], ["retained_selection", "--selection"]]) {
      const path = resolve(args[option]), body = await readFile(path);
      const value = {body, item: item("inputs/" + key + "/" + basename(path), body)};
      original[key] = value;
      retained.set(value.item.path, value);
    }
    if (args["--expected-csv-sha256"] && original.classified_csv.item.sha256 !== args["--expected-csv-sha256"])
      throw new Error("The original classified CSV differs from the expected source edition");
    selection = jsonBody(original.retained_selection.body);
    csvText = original.classified_csv.body.toString("utf8");
  }
  const inputOrder = args["--capture"] ?
    ["native_capture", "native_features", "native_metadata", "retained_selection", "legal_registry", "native_mapping"] :
    ["classified_csv", "legal_registry", "native_mapping", "retained_selection"];
  const inputs = Object.fromEntries(inputOrder.map(name => [name, original[name].item]));
  const result = buildInventory(csvText, registry, mapping, selection, inputs);
  if (representation) result.profile.input_representation = representation;
  const out = resolve(args["--out"]);
  const profileName = "scdes-schydroclass-20261012.attribute-profile.json";
  const indexName = "scdes-schydroclass-20261012.feature-index.csv";
  const profileBody = json(result.profile), indexBody = Buffer.from(result.featureIndexCsv);
  const inputMembers = args["--capture"] ? [...retained.values()] : inputOrder.map(name => original[name]);
  const files = [item(profileName, profileBody), item(indexName, indexBody),
    ...inputMembers.map(value => value.item)];
  const manifest = {
    schema: "upstate.sources/v1", title: "Retained classified-water source inventory",
    entries: [{
      id: selection.source_id + "-attribute-inventory",
      title: "Classified source linework types and source-review associations",
      kind: "table", role: "HIGH_QUALITY_WATER_SOURCE_INVENTORY",
      uri: selection.layer_url, vintage: selection.original_capture_date,
      ...files[0], data_status: mapping.layers[result.profile.layer_id].data_status,
      source_id: selection.source_id, source_layer_id: result.profile.layer_id,
      feature_index: indexName, feature_count: result.featureIndex.length,
      source_selection: result.profile.source_selection,
      ...(args["--capture"] ? {input_mode: "retained-native-capture"} : {}),
      companions: files.slice(1)
    }],
    notes: [
      args["--capture"] ?
        "The complete capture inventory, original native collection and metadata, adopted selection, legal registry and current mapping are retained as exact companions." :
        "Original source CSV, selected legal registry, native mapping and capture selection are retained as exact companions.",
      "Source-review predicates do not create legal geometry bindings or remove classified geometry."
    ]
  };
  for (const value of retained.values()) await exactWrite(join(out, value.item.path), value.body);
  await exactWrite(join(out, indexName), indexBody);
  await exactWrite(join(out, profileName), profileBody);
  await exactWrite(join(out, "sources.json"), json(manifest));
  process.stdout.write(JSON.stringify({
    output: out, source_manifest: join(out, "sources.json"), source_id: selection.source_id,
    layer_id: result.profile.layer_id, input_mode: args["--capture"] ? "retained-native-capture" : "retained-csv",
    feature_count: result.featureIndex.length,
    class_counts: result.profile.class_counts, hydro_type_counts: result.profile.hydro_type_counts,
    literal_join_counts: result.profile.literal_join_counts
  }, null, 2) + "\n");
}
main().catch(error => { process.stderr.write(error.stack + "\n"); process.exitCode = 1; });
