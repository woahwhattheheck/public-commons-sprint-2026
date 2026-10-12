import { stringifyJson } from "./json-codec.mjs";
import { promises as fs } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateState, STATE_MAX_BYTES } from "./model.mjs";
import { clone, digest, sha256, base64, json, fields, hash, integer, need, now, newId } from "./util.mjs";
import { exists, plainRead, createOnlyFile, syncDirectory } from "./files.mjs";

export const LEGACY_APPLICATION_FILES = [
  "LICENSE", "README.md", "OPERATING.md", "MERCHANT.md", "HAYSTACK_CONTRACT.md", "HAYSTACK_LICENSE.txt",
  "RECEIVING.mjs", "app.js", "browser-assets-loader.mjs", "browser-assets.json", "catalog.mjs",
  "cli.mjs", "client.d.mts", "client.mjs", "files.mjs", "fixture-charlie.json", "fixtures.json",
  "haystack-index.d.mts", "haystack-index.mjs", "haystack-types.d.mts", "haystack-types.mjs",
  "index.html", "json-codec.mjs", "mcp.mjs", "merchant-client.mjs", "merchant-tools.mjs", "merchant.mjs", "model.mjs", "package.json", "portable.mjs", "protocol.mjs",
  "reports.mjs", "server.mjs", "store.mjs", "style.css", "util.mjs"
].sort();
export const APPLICATION_FILES = [...LEGACY_APPLICATION_FILES, "corrective-work.mjs", "corrective-reports.mjs", "CORRECTIVE_WORK.md", "CORRECTIVE_RECEIVING.mjs", "CORRECTIVE_BROWSER.mjs"].sort();
export const PACKAGE_FORMAT = "commons.haystack.package.v2";
export const LEGACY_PACKAGE_FORMAT = "commons.haystack.package.v1";
export const PACKAGE_MAX_BYTES = 192 * 1024 * 1024;
const APPLICATION_MAX_BYTES = 32 * 1024 * 1024;
const ROOT = dirname(fileURLToPath(import.meta.url));

export async function buildBundle(state, { applicationRoot = ROOT } = {}) {
  validateState(state);
  const application = []; let total = 0;
  for (const name of APPLICATION_FILES) {
    const bytes = await plainRead(join(applicationRoot, name), 8 * 1024 * 1024);
    total += bytes.length; need(total <= APPLICATION_MAX_BYTES, "The complete portable application exceeds 32 MiB.", "HAYSTACK_SIZE", 413);
    application.push({ name, bytes: bytes.length, sha256: sha256(bytes), base64: bytes.toString("base64") });
  }
  const payload = { format: PACKAGE_FORMAT, createdAt: now(), workspace: clone(state), application };
  const bytes = Buffer.from(stringifyJson({ ...payload, payloadSha256: digest(payload) }) + "\n");
  need(bytes.length <= PACKAGE_MAX_BYTES, "The complete delivery exceeds 192 MiB.", "HAYSTACK_SIZE", 413);
  return { bytes, mediaType: "application/json", name: "haystack-" + state.workspaceId + "-r" + state.revision + ".json" };
}
export function verifyBundle(bytes) {
  const raw = Buffer.from(bytes), bundle = json(raw, PACKAGE_MAX_BYTES);
  fields(bundle, ["format", "createdAt", "workspace", "application", "payloadSha256"], ["format", "createdAt", "workspace", "application", "payloadSha256"]);
  need([PACKAGE_FORMAT, LEGACY_PACKAGE_FORMAT].includes(bundle.format), "Choose a complete supported Haystack workspace package.", "HAYSTACK_PACKAGE", 409);
  const inventory = bundle.format === LEGACY_PACKAGE_FORMAT ? LEGACY_APPLICATION_FILES : APPLICATION_FILES;
  need(bundle.format !== LEGACY_PACKAGE_FORMAT || bundle.workspace.correctiveWork === undefined, "Corrective-work history requires its complete v2 application.", "HAYSTACK_APPLICATION", 409);
  const payload = clone(bundle); delete payload.payloadSha256;
  need(hash(bundle.payloadSha256) === digest(payload), "The complete package payload differs.", "HAYSTACK_PACKAGE", 409);
  need(Buffer.byteLength(stringifyJson(bundle.workspace)) <= STATE_MAX_BYTES, "The complete received workspace exceeds 128 MiB.", "HAYSTACK_SIZE", 413);
  validateState(bundle.workspace);
  need(Array.isArray(bundle.application) && bundle.application.length === inventory.length, "The delivery needs every complete portable application file.", "HAYSTACK_APPLICATION", 409);
  const application = new Map(); let total = 0;
  for (const file of bundle.application) {
    fields(file, ["name", "bytes", "sha256", "base64"], ["name", "bytes", "sha256", "base64"]);
    need(inventory.includes(file.name) && !application.has(file.name), "The delivery contains a changed or duplicated application path.", "HAYSTACK_APPLICATION", 409);
    integer(file.bytes, "application bytes", 0, 8 * 1024 * 1024); hash(file.sha256);
    const content = base64(file.base64, 8 * 1024 * 1024);
    need(content.length === file.bytes && sha256(content) === file.sha256, "The complete application source differs: " + file.name, "HAYSTACK_APPLICATION", 409);
    total += content.length; need(total <= APPLICATION_MAX_BYTES, "The complete application exceeds 32 MiB.", "HAYSTACK_SIZE", 413);
    application.set(file.name, content);
  }
  return { state: clone(bundle.workspace), application, packageSha256: sha256(raw), payloadSha256: bundle.payloadSha256, bytes: raw.length };
}
export async function receiveBundle(bytes, destination) {
  const verified = verifyBundle(bytes), target = resolve(destination);
  need(target !== dirname(target), "Choose a new receiving directory.");
  await fs.mkdir(dirname(target), { recursive: true, mode: 0o700 });
  const markerPath = join(target, "receiving.json"), receiptPath = join(target, "received.json");
  let created = false;
  try { await fs.mkdir(target, { mode: 0o700 }); created = true; }
  catch (error) { if (error.code !== "EEXIST") throw error; }
  let marker;
  if (created) {
    marker = { format: "commons.haystack.receiving.v1", installationId: newId(), packageSha256: verified.packageSha256,
      payloadSha256: verified.payloadSha256, workspaceId: verified.state.workspaceId, revision: verified.state.revision, startedAt: now() };
    await createOnlyFile(markerPath, Buffer.from(stringifyJson(marker) + "\n"));
  } else {
    need(await exists(markerPath), "The destination already contains other work. Choose a new receiving directory.", "HAYSTACK_RECEIVE_DESTINATION", 409);
    marker = json(await plainRead(markerPath, 16384), 16384);
    need(marker.format === "commons.haystack.receiving.v1" && marker.packageSha256 === verified.packageSha256 && marker.payloadSha256 === verified.payloadSha256,
      "The original receiving directory belongs to a different delivery.", "HAYSTACK_RECEIVE_DESTINATION", 409);
    if (await exists(receiptPath)) {
      const receipt = json(await plainRead(receiptPath, 16384), 16384);
      need(receipt.packageSha256 === verified.packageSha256 && receipt.installationId === marker.installationId, "The retained receiving receipt differs.", "HAYSTACK_RECEIVE_DESTINATION", 409);
      return { ...receipt, directory: target, replayed: true };
    }
  }
  const applicationDirectory = join(target, "application");
  await fs.mkdir(applicationDirectory, { recursive: true, mode: 0o700 });
  need(!(await fs.lstat(applicationDirectory)).isSymbolicLink(), "Use the original owned application directory.");
  for (const [name, content] of verified.application) await createOnlyFile(join(applicationDirectory, name), content);
  await fs.mkdir(join(target, "deliveries"), { recursive: true, mode: 0o700 });
  await createOnlyFile(join(target, "workspace.json"), Buffer.from(stringifyJson(verified.state) + "\n"));
  const receipt = { ...marker, completedAt: now(), applicationFiles: verified.application.size, bytes: verified.bytes };
  await createOnlyFile(receiptPath, Buffer.from(stringifyJson(receipt) + "\n"));
  await syncDirectory(target);
  return { ...receipt, directory: target, replayed: false };
}
