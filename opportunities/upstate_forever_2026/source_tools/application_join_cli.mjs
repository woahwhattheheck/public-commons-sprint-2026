#!/usr/bin/env node
/** Compose existing application carriers and original joins into a complete source edition. */
import {readFileSync, mkdirSync, mkdtempSync, openSync, writeFileSync, fsyncSync,
        closeSync, linkSync, unlinkSync, rmdirSync, lstatSync} from "node:fs";
import {resolve, dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import {readSourceLayer, layerFromDocument, composeApplication, composeSourceJoins, sourceCompositionBank,
        transportJSON} from "./application_join.mjs";
import {encodeApplicationCarrier, sha256Bytes, utf8Encode} from "./carrier_codec.mjs";
import {encodeApplicationArchive} from "./application_archive.mjs";

const usage = `Usage:
  node source_tools/application_join_cli.mjs BASE
    [--overlay COMPLETE_COMPONENT] [--join ORIGINAL_INTEGRATION_JSON] ...
    --edition NAME [--operation-id ID]
    [--source-map FILE.json] [--carrier FILE.md] [--zip FILE.zip]
    [--join-bank RECOVERABLE_SOURCE.json]

Overlays and joins apply in their command-line order. BASE must be an original
complete application source map or its complete Canvas carrier. A join changes
only its named literal source spans. Readable original JSON and gzip/base64
Canvas carriers are accepted. Output names are immutable; an identical existing
file is reused. --join-bank retains full edited preimages, literal hooks, guards,
consumer checks and complete postimages; receive it through the same --overlay path.
The command prints the resulting file locations and identities.
`;

function read(path) { return readFileSync(resolve(path), "utf8"); }

function publish(path, data) {
  const target = resolve(path), parent = dirname(target);
  mkdirSync(parent, {recursive: true});
  const bytes = typeof data === "string" ? Buffer.from(data, "utf8") : Buffer.from(data);
  try {
    const existing = lstatSync(target);
    if (!existing.isFile() || existing.isSymbolicLink() || !readFileSync(target).equals(bytes))
      throw Error("A different output already exists: " + target);
    return {path: target, bytes: bytes.length, sha256: sha256Bytes(bytes), reused: true};
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const scratch = mkdtempSync(join(parent, ".application-join-"));
  const pending = join(scratch, "source");
  try {
    const fd = openSync(pending, "wx", 0o600);
    try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
    try { linkSync(pending, target); }
    catch (error) {
      if (error.code !== "EEXIST" || !lstatSync(target).isFile() ||
          lstatSync(target).isSymbolicLink() || !readFileSync(target).equals(bytes)) throw error;
    }
    const directory = openSync(parent, "r");
    try { fsyncSync(directory); } finally { closeSync(directory); }
  } finally {
    try { unlinkSync(pending); } catch (error) { if (error.code !== "ENOENT") throw error; }
    rmdirSync(scratch);
  }
  return {path: target, bytes: bytes.length, sha256: sha256Bytes(bytes), reused: false};
}

export function main(argv = process.argv.slice(2)) {
  if (argv.includes("--help") || argv.includes("-h")) { process.stdout.write(usage); return 0; }
  const steps = [], options = {}, joins = [];
  let base;
  for (let index = 0; index < argv.length; index++) {
    const key = argv[index];
    if (!key.startsWith("--") && !base) { base = key; continue; }
    if (!["--overlay", "--join", "--edition", "--operation-id", "--source-map", "--carrier", "--zip", "--join-bank"].includes(key))
      throw Error("Unknown argument: " + key);
    const value = argv[++index];
    if (!value || value.startsWith("--")) throw Error("Choose a value for " + key);
    if (key === "--overlay" || key === "--join") steps.push({kind: key.slice(2), path: value});
    else {
      if (options[key] !== undefined) throw Error("Duplicate argument: " + key);
      options[key] = value;
    }
  }
  if (!base || !options["--edition"]) throw Error(usage);
  if (!["--source-map", "--carrier", "--zip", "--join-bank"].some(key => options[key])) throw Error("Choose an output path.\n" + usage);
  const edition = options["--edition"], operationId = options["--operation-id"] || null;
  const layers = [readSourceLayer(read(base), {label: resolve(base)})];
  for (const step of steps) {
    const text = read(step.path);
    if (step.kind === "overlay") layers.push(readSourceLayer(text, {label: resolve(step.path)}));
    else {
      const current = composeApplication(layers, {edition, operationId});
      const integration = transportJSON(text);
      const joined = composeSourceJoins(layerFromDocument(current), integration,
                                       {label: resolve(step.path)});
      layers.push(joined.layer);
      joins.push(joined);
    }
  }
  const document = composeApplication(layers, {edition, operationId});
  if (options["--join-bank"] && !joins.length)
    throw Error("--join-bank needs at least one --join plan");
  const outputs = {};
  if (options["--join-bank"])
    outputs.join_bank = publish(options["--join-bank"], JSON.stringify(sourceCompositionBank(joins), null, 2) + "\n");
  if (options["--source-map"])
    outputs.source_map = publish(options["--source-map"], JSON.stringify(document, null, 2) + "\n");
  if (options["--carrier"])
    outputs.carrier = publish(options["--carrier"], encodeApplicationCarrier(document).markdown);
  if (options["--zip"])
    outputs.archive = publish(options["--zip"], encodeApplicationArchive(document).bytes);
  process.stdout.write(JSON.stringify({edition, source_ref: document.source_ref,
    files: Object.keys(document.files).length,
    source_bytes: Object.values(document.file_metadata).reduce((sum, item) => sum + item.bytes, 0),
    layers: document.assembly.layers, outputs}, null, 2) + "\n");
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(); }
  catch (error) {
    process.stderr.write(JSON.stringify({error: error.message, ...(error.report ? {conflict_report: error.report} : {})}) + "\n");
    process.exitCode = 1;
  }
}
