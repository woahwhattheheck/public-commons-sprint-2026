#!/usr/bin/env node
/** Complete native vector CLI, usable directly or by the original Starforge dispatcher. */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runVectorCommand, captureStacVectors, materializeStacVectors } from "./index.mjs";
import { parseExactJSON, stringifyExactJSON } from "./json.mjs";

export const VECTOR_HELP = "Native vector capture, export, comparison and receiving\n\nUse the Python environment containing the selected Fiona/GDAL runtime:\n  node stac/vector/cli.mjs COMMAND [options] --python /absolute/venv/bin/python\n\n  capabilities\n  capture --selection ORIGINAL_SELECTION.json --source-root DIR --out CAPTURE_DIR\n  inspect --directory CAPTURE_DIR\n  export --capture CAPTURE_DIR --out EXPORT_DIR --operation-id ID [--profile PROFILE.json]\n  open --directory EXPORT_DIR [--expected-manifest-sha256 SHA256]\n  receive --directory EXPORT_DIR --out NEW_RECEIVER\n  compare --before CAPTURE_OR_EXPORT --after CAPTURE_OR_EXPORT --out COMPARISON_DIR --operation-id ID\n  open-comparison --directory COMPARISON_DIR\n  changes --directory COMPARISON_DIR [--offset 0] [--limit 100] [--layer ID] [--status ADDED|REMOVED|CHANGED]\n  receive-comparison --directory COMPARISON_DIR --out NEW_RECEIVER\n  bundle --directory EXPORT_OR_COMPARISON --out COMPLETE_PACKAGE.zip\n  receive-bundle --input COMPLETE_PACKAGE.zip --out NEW_RECEIVER\n                 [--expected-archive-sha256 SHA256] [--expected-manifest-sha256 SHA256]\n  stac-capture --directory ORIGINAL_PORTABLE_STAC_DIR --out CAPTURE_DIR\n               [--assets ORIGINAL_SELECTED_PATHS.json] [--selection-id ID]\n  stac-materialize --directory ORIGINAL_CUSTOMER_DIR --portable NEW_PORTABLE_DIR\n                   --capture CAPTURE_DIR --out NATIVE_EXPORT_DIR --operation-id ID\n                   [--assets ORIGINAL_SELECTED_PATHS.json] [--profile PROFILE.json] [--selection-id ID]\n  serve --root OWNED_DATA_ROOT [--control-root DIR] [--port 0]\n\nEvery source descriptor includes original path, bytes and SHA-256. Capture reads\nthose original retained files. GeoPackage/Shapefile export retains all original\nfeatures, fields and geometry along with explicit native mappings and complete\ndriver readback. Reusing the same destination requires its original request.\nAn export profile changes output representation; it preserves original source.\n\nAll commands accept --log-directory DIR to retain the exact native request,\nresponse, stderr and exit result. --expected-manifest-sha256 binds the selected\noriginal artifact. The server returns its local session URL and stays running.\nIts path controls are relative to the selected --root.\n\nOriginal Starforge dispatch may prefix these commands with vector-, for example\nvector-export or vector-serve.\n";
function required(flags, name) {
  if (typeof flags[name] !== "string" || !flags[name]) throw new Error("--" + name + " is required");
  return flags[name];
}
function integer(flags, name, fallback) {
  if (flags[name] === undefined) return fallback;
  if (!/^\d+$/.test(String(flags[name])) || !Number.isSafeInteger(Number(flags[name])))
    throw new Error("--" + name + " must be a nonnegative integer");
  return Number(flags[name]);
}
function parse(argv) {
  const flags = {}, positionals = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) { positionals.push(arg); continue; }
    const equal = arg.indexOf("=");
    const key = arg.slice(2, equal < 0 ? undefined : equal);
    if (Object.hasOwn(flags, key)) throw new Error("Repeated flag --" + key);
    if (equal >= 0) flags[key] = arg.slice(equal + 1);
    else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith("--")) flags[key] = argv[++i];
    else flags[key] = true;
  }
  if (positionals.length > 1) throw new Error("Only one command is accepted");
  return { command: positionals[0] || "help", flags };
}
export async function runVectorCommandCLI({ command, flags = {} }) {
  command = command.replace(/^vector-/, "");
  if (command === "help" || flags.help) return { text: VECTOR_HELP };
  const options = { python: flags.python, logDirectory: flags["log-directory"] };
  if (command === "serve") {
    const { startVectorServer } = await import("./server.mjs");
    const running = await startVectorServer({ root: required(flags, "root"), python: flags.python,
      controlRoot: flags["control-root"], port: integer(flags, "port", 0) });
    const result = { url: running.url, root: running.operator.root, python: running.operator.python };
    return { result, outputJson: stringifyExactJSON(result, 2), close: running.close };
  }
  if (["stac-capture", "stac-materialize"].includes(command)) {
    const selected = flags.assets ? parseExactJSON(await readFile(resolve(required(flags, "assets")), "utf8")) : undefined;
    const common = { ...options, assetPaths: selected, selectionId: flags["selection-id"],
      expectedManifestSha256: flags["expected-manifest-sha256"] };
    const result = command === "stac-capture"
      ? await captureStacVectors(required(flags, "directory"), required(flags, "out"), common)
      : await materializeStacVectors(required(flags, "directory"), { ...common,
          portableDirectory: required(flags, "portable"), captureDirectory: required(flags, "capture"),
          directory: required(flags, "out"), operationId: required(flags, "operation-id"), profile: flags.profile });
    return { result, outputJson: stringifyExactJSON(result, 2) };
  }
  const request = { command };
  if (flags["expected-manifest-sha256"]) request.expectedManifestSha256 = flags["expected-manifest-sha256"];
  if (command === "capture") Object.assign(request, {
    selectionFile: required(flags, "selection"), sourceRoot: required(flags, "source-root"), directory: required(flags, "out") });
  else if (command === "export") Object.assign(request, {
    captureDirectory: required(flags, "capture"), directory: required(flags, "out"),
    operationId: required(flags, "operation-id"), ...(flags.profile ? { profileFile: flags.profile } : {}) });
  else if (["inspect", "open", "open-comparison", "changes", "bundle"].includes(command)) {
    request.directory = required(flags, "directory");
    if (command === "bundle") request.archivePath = required(flags, "out");
    if (command === "changes") Object.assign(request, { offset: integer(flags, "offset", 0),
      limit: integer(flags, "limit", 100), layerId: flags.layer, status: flags.status });
  } else if (["receive", "receive-comparison"].includes(command)) Object.assign(request, {
    sourceDirectory: required(flags, "directory"), directory: required(flags, "out") });
  else if (command === "receive-bundle") Object.assign(request, {
    archivePath: required(flags, "input"), directory: required(flags, "out"),
    expectedArchiveSha256: flags["expected-archive-sha256"] });
  else if (command === "compare") Object.assign(request, {
    beforeDirectory: required(flags, "before"), afterDirectory: required(flags, "after"),
    directory: required(flags, "out"), operationId: required(flags, "operation-id"),
    beforeManifestSha256: flags["before-manifest-sha256"], afterManifestSha256: flags["after-manifest-sha256"] });
  else if (command !== "capabilities") throw new Error("Unknown native vector command: " + command);
  const result = await runVectorCommand(request, options);
  return { result, outputJson: stringifyExactJSON(result, 2) };
}
export async function runVectorCLI(argv = process.argv.slice(2)) {
  const value = await runVectorCommandCLI(parse(argv));
  process.stdout.write(value.text || value.outputJson + "\n");
  if (value.close) await new Promise((yes, no) => {
    let closing = false;
    const done = () => { if (closing) return; closing = true;
      process.removeListener("SIGINT", done); process.removeListener("SIGTERM", done);
      value.close().then(yes, no); };
    process.once("SIGINT", done); process.once("SIGTERM", done);
  });
  return value;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  runVectorCLI().catch(exc => {
    process.stderr.write(stringifyExactJSON({ ok: false, error: { code: exc.code || exc.name, detail: exc.detail || exc.message },
      native: exc.native }, 2) + "\n");
    process.exitCode = 2;
  });
}
