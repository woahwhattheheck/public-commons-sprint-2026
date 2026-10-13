#!/usr/bin/env node
/** Native local file preparation; publication/save stays in the original SF47 app. */
import {readFile, mkdir, open, link, unlink, lstat, realpath} from "node:fs/promises";
import {dirname, resolve, join} from "node:path";
import {fileURLToPath} from "node:url";
import {createHash, randomUUID} from "node:crypto";
import {spawnSync} from "node:child_process";
import {bindingTemplate, prepareInstallation, renderWorkorder} from "./prepare-core.mjs";
import {isProfileId, profileCatalog, readProfile} from "./profiles.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const usage = "node prepare.mjs property COMMAND [OPTIONS]\nnode prepare.mjs canadabuys template|prepare [OPTIONS]\nnode prepare.mjs profiles | template|prepare --profile PROFILE --seed ORIGINAL_SEED.json --out PRIVATE_DIRECTORY [--bindings SELECTED_BINDINGS.json]\nnode prepare.mjs sources --selection SOURCE_SELECTION.json --source-root ORIGINAL_FILES --out PRIVATE_DIRECTORY [--python python3]";
function parse(argv) {
  const [command, ...args] = argv;
  if (command === "property" || command === "canadabuys") return {command, argv: args};
  if (command === "profiles") {
    if (args.length) throw new Error(usage);
    return {command};
  }
  if (!["template", "prepare", "sources"].includes(command)) throw new Error(usage);
  const result = {command};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]?.replace(/^--/, "");
    if (!(command === "sources" ? ["selection", "source-root", "out", "python"] : ["profile", "seed", "out", "bindings"]).includes(key) || !args[i + 1] || args[i + 1].startsWith("--") || result[key])
      throw new Error(usage);
    result[key] = args[i + 1];
  }
  if (command === "sources") {
    if (!result.selection || !result["source-root"] || !result.out) throw new Error(usage);
    result.python ??= "python3";
    return result;
  }
  if (!isProfileId(result.profile) || !result.seed || !result.out ||
      (command === "prepare" && !result.bindings) || (command === "template" && result.bindings)) throw new Error(usage);
  return result;
}
const digest = raw => createHash("sha256").update(raw).digest("hex");
const encode = value => Buffer.from(JSON.stringify(value, null, 2) + "\n");
async function readJson(path) {
  const exact = resolve(path);
  const stat = await lstat(exact);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2 * 1024 * 1024)
    throw new Error("Use a complete regular JSON input up to 2 MiB: " + exact);
  const raw = await readFile(exact);
  return {value: JSON.parse(raw.toString("utf8")), source: {path: exact, bytes: raw.length, sha256: digest(raw)}};
}
async function privateDirectory(path) {
  const exact = resolve(path);
  await mkdir(exact, {recursive: true, mode: 0o700});
  const stat = await lstat(exact);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || await realpath(exact) !== exact)
    throw new Error("Use an operator-owned private output directory with mode 0700 and no symbolic-link path.");
  return exact;
}
async function retain(path, raw) {
  try {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink() || !raw.equals(await readFile(path)))
      throw new Error("The retained output differs: " + path);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const temporary = path + "." + randomUUID() + ".tmp";
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(raw); await handle.sync(); await handle.close();
      try { await link(temporary, path); }
      catch (publishError) {
        if (publishError.code !== "EEXIST") throw publishError;
        const stat = await lstat(path);
        if (!stat.isFile() || stat.isSymbolicLink() || !raw.equals(await readFile(path)))
          throw new Error("A concurrent original output differs: " + path);
      }
      const directory = await open(dirname(path), "r");
      try { await directory.sync(); } finally { await directory.close(); }
    } finally { await handle.close().catch(() => {}); await unlink(temporary).catch(() => {}); }
  }
  return {path, bytes: raw.length, sha256: digest(raw)};
}
try {
  const args = parse(process.argv.slice(2));
  if (args.command === "canadabuys") {
    const result = spawnSync(process.execPath, [join(here, "canadabuys-commissioning.mjs"), ...args.argv], {stdio: "inherit", env: process.env});
    if (result.error) throw result.error;
    if (result.signal) throw new Error("Original CanadaBuys preparation ended on " + result.signal + ".");
    process.exitCode = result.status ?? 1;
  } else if (args.command === "property") {
    const result = spawnSync(process.execPath, [join(here, "property-commissioning.mjs"), ...args.argv], {stdio: "inherit", env: process.env});
    if (result.error) throw result.error;
    if (result.signal) throw new Error("Original property preparation ended on " + result.signal + ".");
    process.exitCode = result.status ?? 1;
  } else if (args.command === "profiles") {
    console.log(JSON.stringify({schema: "stellar-forge.installation-workorder-catalog.v1", profiles: profileCatalog()}, null, 2));
  } else if (args.command === "sources") {
    const result = spawnSync(args.python, [join(here, "source-inputs.py"),
      "--selection", resolve(args.selection), "--source-root", resolve(args["source-root"]),
      "--out", resolve(args.out)], {stdio: "inherit", env: process.env});
    if (result.error) throw result.error;
    if (result.signal) throw new Error("Original source preparation ended on " + result.signal + ".");
    process.exitCode = result.status ?? 1;
  } else {
  const seed = await readJson(args.seed);
  const profile = readProfile(args.profile);
  const out = await privateDirectory(args.out);
  if (args.command === "template") {
    const result = bindingTemplate(seed.value, profile.value);
    console.log(JSON.stringify(await retain(join(out, "bindings.json"), encode(result)), null, 2));
  } else {
    const bindings = await readJson(args.bindings);
    const result = prepareInstallation(seed.value, profile.value, bindings.value);
    const document = encode(result.document);
    if (document.length > 128 * 1024) throw new Error("The complete installation exceeds the native 128 KiB document limit.");
    const outputs = [];
    outputs.push(await retain(join(out, "installation-input.json"), document));
    outputs.push(await retain(join(out, "installation-preview-input.json"), encode(result.preview)));
    outputs.push(await retain(join(out, "WORKORDER.md"), Buffer.from(renderWorkorder(result))));
    const preparation = {...result, inputsRead: {seed: seed.source, profile: profile.source, bindings: bindings.source}, outputs};
    delete preparation.document; delete preparation.preview;
    const receipt = await retain(join(out, "preparation.json"), encode(preparation));
    console.log(JSON.stringify({...receipt, outputs, selections: result.selections}, null, 2));
  }
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
