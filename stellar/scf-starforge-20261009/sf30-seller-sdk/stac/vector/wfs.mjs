/** Original WFS application download -> retained vector source and native delivery. */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, open, link, unlink, realpath } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { captureVectorSelection, exportVectorCapture, VectorOperationError } from "./index.mjs";
import { parseExactJSON as parse, stringifyExactJSON as encode, ExactNumber } from "./json.mjs";

const need = (yes, code, detail) => { if (!yes) throw new VectorOperationError(code, detail); };
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
function stable(value) {
  if (value instanceof ExactNumber || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(stable);
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
}
const canonical = value => encode(stable(value));
const jsonBytes = value => Buffer.from(encode(value, 2) + "\n");
const plain = value => value && typeof value === "object" && !Array.isArray(value) && !(value instanceof ExactNumber);
async function readOptional(path) {
  try { return await readFile(path); } catch (error) { if (error.code === "ENOENT") return null; throw error; }
}
async function immutable(path, raw) {
  const existing = await readOptional(path);
  if (existing) { need(existing.equals(raw), "VECTOR_WFS_RETAINED_FILE_CONFLICT", path); return; }
  const temporary = path + "." + randomUUID() + ".receiving";
  const file = await open(temporary, "wx", 0o600);
  try {
    await file.writeFile(raw); await file.sync(); await file.close();
    try { await link(temporary, path); }
    catch (error) {
      if (error.code !== "EEXIST") throw error;
      need((await readFile(path)).equals(raw), "VECTOR_WFS_RETAINED_FILE_CONFLICT", path);
    }
    const parent = await open(dirname(path), "r");
    try { await parent.sync(); } finally { await parent.close(); }
  } finally {
    await file.close().catch(() => {});
    await unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error; });
  }
}
function orderBinding(application, view, orderId) {
  need(typeof application.binding?.projectId === "string" && application.binding.projectId,
    "VECTOR_ORIGINAL_WFS_PROJECT_REQUIRED");
  need(plain(view) && view.order?.id === orderId && view.order.state === "READY" && view.complete === true &&
    view.sourceId === view.order.captureId && plain(view.selection) && plain(view.collection),
    "VECTOR_COMPLETE_WFS_ORDER_REQUIRED", orderId);
  need(Number.isSafeInteger(view.rows) && view.rows >= 0 && Number.isSafeInteger(view.pages) && view.pages >= 0,
    "VECTOR_WFS_NATIVE_COUNTS_INVALID");
  return { schema: "starforge.vector-wfs-source.v1", projectId: application.binding.projectId,
    order: view.order, sourceId: view.sourceId, selection: view.selection, collection: view.collection,
    coordinateDescription: view.coordinates, responseCrs: view.responseCrs || [],
    rows: view.rows, pages: view.pages, bytes: view.bytes,
    firstReceivedAt: view.firstReceivedAt, lastReceivedAt: view.lastReceivedAt };
}
function reviewedProfile(binding, sourceId, options) {
  // The original combined WFS GeoJSON may not repeat its native CRS header.
  // Carry the operator's original CRS/axis review explicitly into native I/O.
  need(typeof options.sourceCrs === "string" && options.sourceCrs.trim() &&
    options.coordinateOrder === "x,y", "VECTOR_WFS_COORDINATE_BINDING_REQUIRED",
    { requestedCrs: binding.selection.srsName, responseCrs: binding.responseCrs,
      coordinateDescription: binding.coordinateDescription });
  const profile = parse(encode(options.profile || {
    schema: "starforge.vector-export-profile.v1", formats: ["GPKG", "ESRI Shapefile"],
    layers: {}, shapefile: { longValues: "reference", collections: "split" } }));
  need(profile.schema === "starforge.vector-export-profile.v1" && plain(profile.layers || {}),
    "VECTOR_WFS_EXPORT_PROFILE_REQUIRED");
  profile.layers ||= {};
  const layer = profile.layers[sourceId] ||= {};
  need(!layer.assignSourceCrs || layer.assignSourceCrs === options.sourceCrs,
    "VECTOR_WFS_PROFILE_CRS_CONFLICT");
  layer.assignSourceCrs = options.sourceCrs;
  layer.sourceCoordinateBinding = { schema: "starforge.vector-wfs-coordinate-binding.v1",
    sourceCrs: options.sourceCrs, coordinateOrder: "x,y",
    requestedCrs: binding.selection.srsName, responseCrs: binding.responseCrs,
    coordinateDescription: binding.coordinateDescription };
  return profile;
}

/**
 * Consume only the already-open original application's read/download methods.
 * The source directory retains exact original bytes plus a ready capture/profile.
 */
export async function retainWfsVectorSource(application, orderId, sourceDirectory, options = {}) {
  need(typeof application?.query === "function" && typeof application?.download === "function",
    "VECTOR_ORIGINAL_WFS_APPLICATION_REQUIRED");
  need(typeof orderId === "string" && /^[a-f0-9]{64}$/.test(orderId), "VECTOR_WFS_ORDER_ID_REQUIRED");
  need(typeof sourceDirectory === "string" && sourceDirectory, "VECTOR_WFS_SOURCE_DIRECTORY_REQUIRED");
  const before = await application.query("order", { orderId });
  const binding = orderBinding(application, before, orderId);
  const layerIdentity = { projectId: binding.projectId, serviceId: binding.order.sourceId,
    schemaId: binding.order.schemaId, typeName: binding.selection.typeName, srsName: binding.selection.srsName };
  const sourceId = options.sourceId || "wfs-features-" + hash(canonical(layerIdentity)).slice(0, 24);
  const selectionId = options.selectionId || "wfs-order-" + orderId.slice(0, 32);
  for (const id of [sourceId, selectionId]) need(/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/.test(id), "VECTOR_WFS_SOURCE_ID_INVALID");
  const identity = options.identity || { mode: "feature-id" };
  const profile = reviewedProfile(binding, sourceId, options);
  const request = { schema: "starforge.vector-wfs-request.v1", sourceId, selectionId, identity,
    binding, profile };
  const requestSha256 = hash(canonical(request));
  const directory = resolve(sourceDirectory);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  need(await realpath(directory) === directory, "VECTOR_WFS_SOURCE_DIRECTORY_LINK");
  await immutable(resolve(directory, "request.json"), jsonBytes({ requestSha256, request }));
  const receiptPath = resolve(directory, "source-receipt.json");
  let receiptRaw = await readOptional(receiptPath), receipt = receiptRaw ? parse(receiptRaw.toString("utf8")) : null;
  if (receipt) need(receipt.schema === "starforge.vector-wfs-received-source.v1" &&
    receipt.requestSha256 === requestSha256 && receipt.file?.path === "features.geojson" &&
    Number.isSafeInteger(receipt.file.bytes) && receipt.file.bytes >= 0 &&
    /^[a-f0-9]{64}$/.test(receipt.file.sha256) &&
    canonical(receipt.sourceEdition) === canonical(binding), "VECTOR_WFS_ORIGINAL_REQUEST_CONFLICT");
  let raw = receipt ? await readOptional(resolve(directory, receipt.file.path)) : null;
  if (!raw) {
    const download = await application.download("features", { orderId });
    need(download?.bytes instanceof Uint8Array &&
      ["application/geo+json", "application/json"].includes(String(download.type).split(";")[0]),
      "VECTOR_WFS_ORIGINAL_FEATURE_DOWNLOAD_REQUIRED");
    raw = Buffer.from(download.bytes);
    const collection = parse(raw.toString("utf8"));
    need(collection.type === "FeatureCollection" && Array.isArray(collection.features) &&
      collection.features.length === binding.rows && collection.sourceId === binding.sourceId &&
      collection.coordinateDescription === binding.coordinateDescription,
      "VECTOR_WFS_ORIGINAL_FEATURE_BINDING_CHANGED");
    need(collection.features.every(feature => plain(feature) && feature.type === "Feature"),
      "VECTOR_WFS_ORIGINAL_FEATURE_REQUIRED");
    const after = orderBinding(application, await application.query("order", { orderId }), orderId);
    need(canonical(after) === canonical(binding), "VECTOR_WFS_ORDER_CHANGED_DURING_DOWNLOAD");
    const current = { schema: "starforge.vector-wfs-received-source.v1", requestSha256,
      file: { path: "features.geojson", bytes: raw.length, sha256: hash(raw) },
      originalDownload: { name: download.name, type: download.type }, sourceEdition: binding };
    if (receipt) need(canonical(current) === canonical(receipt), "VECTOR_WFS_ORIGINAL_DOWNLOAD_CHANGED");
    else { receipt = current; receiptRaw = jsonBytes(receipt); await immutable(receiptPath, receiptRaw); }
    await immutable(resolve(directory, receipt.file.path), raw);
  }
  need(raw.length === receipt.file.bytes && hash(raw) === receipt.file.sha256,
    "VECTOR_WFS_RETAINED_SOURCE_CHANGED");
  const originalOrder = jsonBytes(binding);
  await immutable(resolve(directory, "original-order.json"), originalOrder);
  const selection = { schema: "starforge.vector-selection.v1", id: selectionId, sourceEdition: binding,
    sources: [{ id: sourceId, ...receipt.file, driver: "GeoJSON", identity,
      members: [{ path: "original-order.json", bytes: originalOrder.length, sha256: hash(originalOrder) }] }] };
  await immutable(resolve(directory, "profile.json"), jsonBytes(profile));
  await immutable(resolve(directory, "selection.json"), jsonBytes(selection));
  return { sourceDirectory: directory, sourceId, selection, profile,
    selectionFile: resolve(directory, "selection.json"), profileFile: resolve(directory, "profile.json"),
    sourceFile: receipt.file, sourceReceipt: receipt, requestSha256 };
}

/** Complete the same original WFS order through capture, reviewed native export and reopen. */
export async function materializeWfsOrderVectors(application, orderId, options = {}) {
  need(options.sourceDirectory && options.captureDirectory && options.directory && options.operationId,
    "VECTOR_WFS_OUTPUT_DIRECTORIES_REQUIRED");
  const source = await retainWfsVectorSource(application, orderId, options.sourceDirectory, options);
  const captured = await captureVectorSelection(source.selection, options.captureDirectory,
    { ...options, sourceRoot: source.sourceDirectory });
  const exported = await exportVectorCapture(captured.directory, options.directory, source.profile,
    options.operationId, options);
  return { source, capture: captured, export: exported };
}
